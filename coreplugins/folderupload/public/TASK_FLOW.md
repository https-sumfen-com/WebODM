# 新建任务功能流程文档

> 最后更新：2026-03-02
> 相关文件：`NewTaskButton.jsx` / `UploadTaskList.jsx` / `CloudUploadButton.jsx`

---

## 一、整体流程概览

```
用户点击"新建任务"
    │
    ▼
[1] 类型选择弹窗
    选择 RGB / 多光谱 / 两者
    │
    ▼
[2] 文件夹选择（重建数据）
    解析地块名、采样日期
    │
    ├─── RGB ────────────────────────────────────────┐
    │                                                │
    ▼                                                │
[3] 辐射板标定弹窗（仅多光谱）                       │
    选择标定文件夹 → 解析 TIF 分组                   │
    预加载 TIF → 绘制多边形 → 输入反射率             │
    （或跳过标定）                                   │
    │                                                │
    ▼                                                │
[3.5] 上传样方文件夹（仅多光谱）                     │
    选择文件夹 + 填写样方大小(m)                     │
    （可跳过）                                       │
    │                                                │
    └──────────────────┬──────────────────────────── ┘
                       ▼
                [4] 任务参数配置面板
                    任务名、处理选项、节点
                    │
                    ▼
                [5] 提交任务
                    加入全局任务队列
                    │
                    ▼
                [6] 自动上传执行
                    创建 WebODM 任务 → 提交外部 ODM API
                    │
                    ▼
                [7] 任务列表展示进度
```

---

## 二、各阶段详细说明

### 阶段 1：类型选择

- **触发**：用户点击项目列表中的"新建任务"按钮
- **组件**：`NewTaskButton` → `showTypeSelection = true`
- **选项**：RGB（JPG）、多光谱（TIF）、两者都选（默认）
- **确认后**：进入文件夹选择阶段

---

### 阶段 2：文件夹选择（重建数据）

- **触发**：`selectFolderAndProcess()` → 触发 Electron `openFile` 事件
- **解析逻辑**：
  - 从文件夹名提取 **地块名**（`folderName`）
  - 从文件夹名提取 **采样日期**（`samplingDate`，ISO 8601 格式）
- **文件验证**：
  - RGB：扫描 `*.jpg / *.jpeg`，为空则报错
  - 多光谱：扫描 `*.tif / *.tiff`，为空则报错
- **完成后**：
  - 若包含多光谱 → 打开标定弹窗
  - 仅 RGB → 直接进入任务配置面板

---

### 阶段 3：辐射板标定（仅多光谱）

#### 3.1 选择标定文件夹

```
selectCalibrationFolder()
    → 触发 "getFilesRaw" 获取文件列表
    → parseTifGroups(items)  按 DJI 命名格式分组
    → preloadTifCache(groups)  并发预加载所有 TIF
```

**DJI 文件命名格式**：
```
DJI_20250311100000_0001_MS_G.TIF
│    │              │    │   └─ 波段：G / R / RE / NIR
│    │              │    └───── 多光谱标记 MS
│    │              └────────── 序列号（组 ID）
│    └───────────────────────── 时间戳
└────────────────────────────── DJI 标记
```

> TIF 文件超过 20 个时弹出二次确认。

#### 3.2 绘制多边形

```
用户点击波段按钮 (G / R / RE / NIR)
    → 优先读取 tifCache，缓存未命中则 XHR 加载
    → 使用 tiff.js 解码 TIF 为 base64 DataURL
    → initCanvasSelect() 初始化多边形绘图工具
    → 用户点击画布设置顶点（至少 3 个）
    → 完成绘制：channelPolygons[`${groupId}_${band}`] = coords
```

#### 3.3 输入反射率值

- 格式：`0.0 – 1.0` 浮点数
- 存储：`calibrationValues[groupId][band]`
- 实时校验（`validationActivated = true` 后开启）：
  | 错误类型 | 条件 |
  |----------|------|
  | `valMissing` | 未填写反射率 |
  | `valInvalid` | 不在 0–1 范围 |
  | `polyMissing` | 多边形顶点 < 3 |

#### 3.4 跳过标定

- `skipCalibrationAndProceed()` → 清空标定数据 → 继续任务创建
- 提交时 `radiometric` 字段为空

---

### 阶段 3.5：上传样方文件夹（仅多光谱）

- **触发**：标定弹窗关闭后（无论"跳过并重建"还是"重建并校准"）自动弹出
- **表单项**：
  - **选择文件夹**：触发 `openFile` 事件（`folderSelectPhase: 'quadratFolder'`），回调更新 `quadratFolderPath`
  - **样方大小 (m)**：数字输入框，存储到 `quadratSize`
- **操作**：
  - **跳过**：`skipQuadratAndProceed()` → 清空样方数据 → `prepareTaskCreation()`
  - **确认**：`confirmQuadratAndProceed()` → 控制台输出路径和大小 → `prepareTaskCreation()`
- **暂不提交**：数据仅 `console.log`，不附加到上传任务对象

---

### 阶段 4：任务参数配置

- **组件**：`NewTaskPanel` → 内嵌 `EditTaskForm`
- **可配置项**：
  - 任务名称（默认：`{地块名}_{类型}`）
  - ODM 处理选项（`options`）
  - 处理节点（`processing_node`）
  - 图像缩放（`resize_to`）
- **多类型队列**：若同时创建 RGB + 多光谱，依次弹出两次配置面板（`pendingTaskTypes` 队列）

---

### 阶段 5：提交任务到队列

`handleTaskSave(taskInfo)` 组装上传任务对象：

```javascript
{
  id: `${type}_${timestamp}`,
  name: `${folderName}_RGB` 或 `${folderName}_多光谱`,
  type: 'rgb' | 'multispectral',
  folderPath: '/path/to/folder',
  samplingDate: '2025-03-11T10:00:00',
  options: [...],
  processingNode: nodeId,
  radiometric: [...]  // 仅多光谱且已标定时存在
}
```

→ `FolderUploadTaskManager.addTask(task)` → 触发所有监听器

---

### 阶段 6：自动上传执行

`UploadTaskList` 监听任务队列变化（`handleTasksUpdate`），依次处理：

#### 步骤 1：创建 WebODM 任务

```
POST /api/projects/{projectId}/tasks/
Body: {
  name, options, processing_node,
  auto_processing_node, partial: true, resize_to
}
Response: { id (UUID), status, ... }
```

#### 步骤 2：提交到外部 ODM API

```
POST http://localhost:7700/api/odm/create_odm_job
Body: {
  odm_project_id, odm_task_id,
  odm_job_name, odm_job_type: 'rgb' | 'multispectral',
  odm_src_folder, odm_samplinge_time,
  odm_host, radiometric, odm_create_at
}
```

#### 任务状态流转

| 状态 | 说明 |
|------|------|
| `creating` | 正在调用 WebODM API |
| `submitted` | 已提交到外部 ODM |
| `completed` | 外部 ODM 确认接收 |
| `error` | 任意步骤失败，保留错误信息 |

---

### 阶段 7：任务列表展示

`UploadTaskList` 展示本地任务进度，每 10 秒轮询外部服务：

```
GET http://localhost:7700/api/odm/get_odm_jobs
```

**Tab 分组**：
- 上传中 / 已完成 / 失败（本地）
- 云端（`mainTab: 'cloud'`）

---

## 三、组件关系图

```
Dashboard
  └─ ProjectListItem
       └─ NewTaskButton          ← 入口，管理整个创建流程
            ├─ NewTaskPanel      ← 任务参数配置（来自 webodm/components）
            └─ 标定弹窗（内联）

FolderUploadTaskManager          ← 全局任务状态（window 挂载）
  └─ UploadTaskList              ← 监听队列，执行上传，展示进度
       └─ CloudUploadButton      ← 云端上传入口
```

---

## 四、外部服务地址（config.js）

| 常量 | 地址 | 用途 |
|------|------|------|
| `WEBODM_URL` | `http://localhost:8000` | WebODM 主服务 |
| `ODM_API_URL` | `http://localhost:7700` | ODM 作业管理 API |
| `RAW_API_URL` | `http://localhost:5555` | 原始文件读取（TIF 预览） |
| `DEVICE_API_URL` | `http://localhost:5000` | 设备/云端服务 |

---

## 五、RGB vs 多光谱 差异对比

| 特性 | RGB | 多光谱 |
|------|-----|--------|
| 文件类型 | `.jpg / .jpeg` | `.tif / .tiff` |
| 文件位深 | 8bit | 16bit（不支持 PIL 缩放） |
| 标定流程 | 无 | 辐射板标定（可跳过） |
| `radiometric` 字段 | 不存在 | 二维数组 |
| 文件命名规范 | 无 | DJI 格式 |
| `odm_job_type` | `rgb` | `multispectral` |

---

## 六、关键状态变量速查

| 变量 | 类型 | 说明 |
|------|------|------|
| `showTypeSelection` | bool | 类型选择弹窗可见性 |
| `selectedTypes` | array | `['rgb', 'multispectral']` |
| `folderName` | string | 解析后的地块名 |
| `samplingDate` | string | ISO 8601 采样日期 |
| `pendingTaskTypes` | array | 待依次创建的任务类型队列 |
| `showCalibrationModal` | bool | 标定弹窗可见性 |
| `calibrationGroups` | array | 解析后的 TIF 分组列表 |
| `calibrationValues` | object | `{groupId: {band: value}}` |
| `channelPolygons` | object | `{"groupId_band": [[x,y],...]}` |
| `tifCache` | object | TIF base64 缓存 |
| `validationActivated` | bool | 首次绘制后开启实时校验 |

---

## 七、错误处理要点

| 场景 | 处理方式 |
|------|----------|
| 文件夹内无 JPG/TIF | 报错，任务标记 `error` |
| TIF 文件 > 20 个 | 弹出确认对话框 |
| TIF 解码失败 | `calibrationTifDataUrl = ''`，继续可用 |
| 多边形 < 3 个顶点 | `polyMissing` 错误，阻止保存 |
| 反射率超出 0–1 | `valInvalid` 错误，阻止保存 |
| 弹窗关闭时 | `_cancelOps = true`，中止所有 XHR 请求 |
| 外部 ODM API 失败 | 任务状态 `error`，保留错误信息展示 |