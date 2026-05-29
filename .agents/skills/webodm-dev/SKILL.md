---
name: webodm-dev
description: WebODM 开发技能。处理任何 WebODM 相关的开发任务时使用，包括：后端 Django/DRF API 开发、前端 React 组件开发、插件开发、Celery 任务、NodeODM 集成、地图/瓦片功能、以及理解项目架构。当用户提及 WebODM、plugins、coreplugins、folderupload、quadrat、task 处理流程、NodeODM 等关键词时触发。
---

# WebODM 开发指南

## 架构速览

WebODM = **Django** (后端 API + Celery 任务) + **React 16** (前端 SPA) + **NodeODM** (实际摄影测量引擎)

```
浏览器 → Django REST API → Celery Worker → NodeODM → ODM 引擎
```

**关键组件目录：**

| 目录 | 作用 |
|------|------|
| `app/api/` | Django REST Framework 视图集和序列化器 |
| `app/models/` | Django 模型 (project, task, plugin, preset, setting, theme) |
| `app/static/app/js/` | React 前端代码，入口：`Dashboard.jsx`、`MapView.jsx`、`ModelView.jsx` |
| `app/static/app/js/components/` | 可复用 React 组件，也供插件使用 |
| `app/plugins/` | 插件基础设施 (plugin_base.py, signals.py, data_store.py) |
| `coreplugins/` | 内置插件（本 fork 的自定义插件在此） |
| `webodm/` | Django 项目配置 (settings.py, urls.py) |
| `worker/` | Celery 后台任务 |
| `nodeodm/` | NodeODM API 客户端和模型 |

**任务调度架构：**
- Celery → 后台任务（图片缩放、结果处理）
- Ad-hoc REST 轮询 → NodeODM 通信（灵活性更高，支持断点续传）

---

## 本 Fork 的自定义插件

### `coreplugins/folderupload/`
替换默认的"新建任务"按钮，扩展功能：
- 支持文件夹选择、RGB / 多光谱任务类型
- 标定工作流（在 TIF 波段上绘制多边形）
- 云上传
- 关键组件：`NewTaskButton.jsx`、`UploadTaskList.jsx`、`CloudUploadButton.jsx`

### `coreplugins/quadrat/`
地图视图中的样方（样地）可视化。

---

## 开发命令速查

```bash
# Docker 开发（推荐）
./webodm.sh start --dev          # 热重载（webpack watch + livereload）
./webodm.sh start --dev --dev-watch-plugins    # 热重载（webpack watch + livereload + 插件调试）
./webodm.sh stop
./webodm.sh test                 # 运行所有测试

# 原生开发
./start.sh --no-gunicorn         # Django 开发服务器
./worker.sh start                # Celery worker（必须）
./worker.sh scheduler start      # Celery beat（可选）

# 前端构建
npx webpack --mode development --watch    # 监听模式
npx webpack --mode production             # 生产构建

# 插件前端构建（在插件的 public/ 目录下）
cd coreplugins/<plugin-name>/public
npm install
npx webpack --mode production

# 数据库
python manage.py migrate
python manage.py makemigrations
python manage.py collectstatic --noinput
```

### 测试

```bash
npm test                                              # Django + Jest 全部
npm run qtest                                         # 仅 Jest
python manage.py test app.tests.test_api              # 单个 Django 模块
npx jest app/static/app/js/tests/Dashboard.test.jsx  # 单个 Jest 文件
```

---

## REST API 结构

**Base:** `/api/`  
**认证：** JWT，头部传 `Authorization: JWT <token>`

| 端点 | 说明 |
|------|------|
| `GET/POST /api/projects/` | 项目列表 |
| `GET/POST /api/projects/{id}/tasks/` | 项目下的任务 |
| `PATCH /api/projects/{id}/tasks/{id}/` | 更新任务 |
| `POST /api/projects/{id}/tasks/{id}/cancel/` | 取消任务 |
| `POST /api/projects/{id}/tasks/{id}/restart/` | 重启任务 |
| `GET /api/projects/{id}/tasks/{id}/download/{asset}` | 下载结果资产 |
| `GET /api/projects/{id}/tasks/{id}/output/` | 获取控制台输出 |
| `GET /api/projects/{id}/tasks/{id}/orthophoto/tiles/{z}/{x}/{y}.png` | 地图瓦片 |
| `POST /api/token-auth/` | JWT 认证 |
| `GET /api/plugins/{plugin_name}/...` | 插件专属端点 |

**任务状态码：** QUEUED=10, RUNNING=20, FAILED=30, COMPLETED=40, CANCELED=50

**可下载资产：** `all.zip`, `orthophoto.tif`, `orthophoto.png`, `orthophoto.mbtiles`, `textured_model.zip`, `georeferenced_model.las`, `georeferenced_model.ply`, `georeferenced_model.csv`

---

## 插件开发核心模式

```python
# plugin.py 基本结构
from app.plugins import PluginBase, Menu, MountPoint

class Plugin(PluginBase):
    def main_menu(self):
        return [Menu(_("My Plugin"), self.public_url(""), "fa fa-cog fa-fw")]

    def app_mount_points(self):
        @login_required
        def my_view(request):
            return render(request, self.template_path("hello.html"), {})
        return [MountPoint('$', my_view)]

    def api_mount_points(self):
        # 自定义 REST API 端点
        return [MountPoint('my-endpoint/', MyAPIView.as_view())]

    def include_js_files(self):
        return ['main.js']    # 每个页面都加载

    def build_jsx_components(self):
        return ['app.jsx']    # webpack 构建的 JSX

    def include_css_files(self):
        return ['style.css']
```

**插件目录结构：**
```
coreplugins/my-plugin/
├── disabled           # 存在则默认禁用
├── __init__.py
├── manifest.json
├── plugin.py
├── requirements.txt   # pip 依赖
├── public/
│   ├── app.jsx
│   ├── webpack.config.js
│   └── package.json   # npm 依赖
└── templates/
    └── hello.html
```

**webpack 关键配置：** 必须使用 `libraryTarget: "amd"`，`webodm` alias 指向 `app/static/app/js/`

**客户端钩子：**
```javascript
// 常用钩子
PluginsAPI.App.Ready          // DOM 加载完成
PluginsAPI.Dashboard.addTaskActionButton  // 任务操作按钮
PluginsAPI.Dashboard.addNewTaskButton     // 新建任务按钮区
PluginsAPI.Map.willAddControls            // Leaflet 控件
PluginsAPI.Map.addActionButton            // 地图操作按钮

// 用法
PluginsAPI.Map.willAddControls(['/plugins/my-plugin/build/app.js'], function(args, App) {
    // args.map = Leaflet map 实例
});
```

**服务端信号：**
```python
from app.plugins.signals import task_completed

@receiver(task_completed)
def on_complete(sender, task_id, **kwargs):
    if get_current_plugin(only_active=True) is None:
        return
    # 处理逻辑
```

**异步长任务：**
```python
# 服务端
from app.plugins.worker import run_function_async

def my_long_task(param, progress_callback=None):
    import time  # 必须在函数内部 import
    progress_callback("进行中...", 50)
    return {'output': 'result'}

celery_task_id = run_function_async(my_long_task, param="value").task_id
```
```javascript
// 客户端
import Workers from 'webodm/classes/Workers';
Workers.waitForCompletion(task_id, onError, onProgress);
Workers.getOutput(task_id, (error, result) => { ... });
```

---

## 配置

**本地覆盖设置：** 创建 `webodm/local_settings.py`（已 gitignore）

**关键环境变量：**
```
WO_DEBUG=YES/NO
WO_DEV=YES/NO
WO_BROKER=redis://localhost
WO_DATABASE_NAME/USER/PASSWORD/HOST/PORT
WO_SSL=YES/NO
WO_SECRET_KEY=...
```

---

## 按需加载文档（使用 webfetch 获取详细内容）

根据当前任务，**使用 `webfetch` 工具按需获取以下页面**：

| 场景 | 获取 URL |
|------|----------|
| 插件开发（完整文档） | `https://docs.webodm.org/plugin-development-guide/` |
| 系统架构深入理解 | `https://docs.webodm.org/architecture/` |
| 开发环境搭建 | `https://docs.webodm.org/contributing/` |
| API 完整使用示例 | `https://docs.webodm.org/quickstart/` |
| Task API 参考 | `https://docs.webodm.org/reference/task/` |
| Project API 参考 | `https://docs.webodm.org/reference/project/` |
| Processing Node API | `https://docs.webodm.org/reference/processingnode/` |
| 认证 API | `https://docs.webodm.org/reference/authentication/` |
| 权限系统 | `https://docs.webodm.org/reference/permissions/` |
| 错误处理 | `https://docs.webodm.org/reference/handlingerrors/` |

**何时按需加载：**
- 用户问到某个 API 端点的详细参数 → 获取对应 reference 页
- 需要实现插件功能 → 获取 plugin-development-guide
- 报 API 错误不确定原因 → 获取 handlingerrors
- 需要配置 Processing Node → 获取 processingnode reference

---

## 常见开发模式

### 新增 Django API 端点
1. 在 `app/api/` 添加 viewset
2. 在 `app/api/urls.py` 注册路由
3. 若需嵌套路由使用 `rest_framework_nested`

### 新增 React 组件
- 放在 `app/static/app/js/components/`
- 遵循 React 16 类组件或函数组件风格（项目混用）
- SCSS 样式文件放 `app/static/app/js/css/`
- 运行 `npx webpack --mode development --watch` 实时编译

### 添加 Celery 后台任务
- 定义在 `worker/` 目录
- 使用 `@shared_task` 装饰器
- 任务通过 Redis broker 分发

### 调试 NodeODM 通信
- 查看 `nodeodm/` 目录了解 API 客户端
- NodeODM 默认运行在 `localhost:3000`
- REST 轮询机制，非 Celery

### 插件开发重载技巧
修改 `app/boot.py` 添加并移除空行，强制 WebODM 重新发现插件（无需重启 Docker）
