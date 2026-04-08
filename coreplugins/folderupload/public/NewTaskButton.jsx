import React from "React";
import PropTypes from "prop-types";
import NewTaskPanel from "webodm/components/NewTaskPanel";
import CanvasSelect from "canvas-select";
import config from "./config";

class NewTaskButton extends React.Component {
  static propTypes = {
    projectId: PropTypes.number.isRequired,
    onNewTaskAdded: PropTypes.func,
    taskManager: PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props);
    this.state = {
      processing: false,
      showTypeSelection: false, // 显示类型选择弹窗
      selectedTypes: [], // 默认全选
      rgbFiles: [], // RGB文件数组（JPG）
      multispectralFiles: [], // 多光谱文件数组（TIF）
      showLoading: false,
      showTaskPanel: false,
      currentTaskType: null, // 当前创建任务的类型
      folderName: "",
      folderFullPath: "",
      samplingDate: "", // 采样日期
      pendingTaskTypes: [], // 待创建的任务类型队列
      // 标定相关状态
      showCalibrationModal: false,
      folderSelectPhase: null, // 'reconstruction' | 'calibrationFolder' | 'calibrationTif'
      calibrationTifPath: "",
      calibrationPolygonPoints: [],
      calibrationFolderPath: "",
      calibrationGroups: [],
      calibrationValues: {},
      calibrationData: null,
      calibrationAuth: "",
      currentCalibrationSelection: { groupId: null, band: null },
      calibrationTifDataUrl: "",
      calibrationTifLoading: false,
      showDrawingTip: false,
      polygonCommitted: false,
      activeGroupIndex: 0,
      // TIF缓存相关状态
      tifCache: {}, // 存储TIF文件的base64缓存 {filePath: base64DataUrl}
      tifCacheLoading: false, // 是否正在预加载TIF缓存
      tifCacheProgress: 0, // 缓存进度 0-100
      channelPolygons: {},
      bandLoading: false,
      showLargeTifConfirm: false,
      largeTifCount: 0,
      pendingCalibrationItems: [],
      pendingCalibrationAuth: "",
      calibrationErrors: {},
      // 控制是否启用用户交互触发的实时校验（加载/切换TIF时默认不校验，待用户操作后再开启）
      validationActivated: false,
      // 样方相关状态
      showQuadratModal: false,
      quadratFolderPath: "",
      quadratSize: "100",
      quadratGeometryType: "square",
    };

    // 绑定事件监听器
    this.dealFile = this.dealFile.bind(this);

    // 生成唯一实例ID
    this.instanceId = `newtaskbutton_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    // 标定画布容器
    this.calibrationCanvasRef = React.createRef();
    this._csUpdating = false;
    // 抑制下一次 Canvas 事件触发的校验（用于加载/切换TIF后的首次updated）
    this._suppressNextValidation = false;
    // 异步加载的取消与跟踪控制
    this._activeXhrs = new Set();
    this._cancelOps = false; // 关闭弹窗时置为 true，阻止后续回调更新状态
    this._preloadToken = 0; // 预加载的序列令牌，防止旧回调污染状态
    this._bandToken = 0; // 通道加载的序列令牌
  }

  handleNewTask = () => {
    // 首先显示类型选择弹窗
    this.setState({ showTypeSelection: true });
  };

  handleTypeSelectionConfirm = () => {
    if (this.state.selectedTypes.length === 0) {
      alert("请至少选择一种类型");
      return;
    }

    this.setState({ showTypeSelection: false });
    this.selectFolderAndProcess();
  };

  handleTypeSelectionCancel = () => {
    this.setState({ showTypeSelection: false });
  };

  handleTypeChange = (type) => {
    const { selectedTypes } = this.state;
    if (selectedTypes.includes(type)) {
      // 取消选择
      this.setState({
        selectedTypes: selectedTypes.filter((t) => t !== type),
      });
    } else {
      // 添加选择
      this.setState({
        selectedTypes: [...selectedTypes, type],
      });
    }
  };

  componentDidMount() {
    // 添加事件监听器
    window.addEventListener("getFileData", this.dealFile);
    window.addEventListener("getFilesRaw", this.dealFile);
  }

  componentWillUnmount() {
    // 移除事件监听器
    window.removeEventListener("getFileData", this.dealFile);
    window.removeEventListener("getFilesRaw", this.dealFile);

    // 如果当前实例是活跃实例，清除标记
    if (window.activeTaskPanelInstance === this.instanceId) {
      window.activeTaskPanelInstance = null;
    }
  }

  // 切换文件夹或重新选择标定文件夹时，清空所有标定相关数据
  resetCalibrationState = () => {
    // 同时取消所有转换/加载操作
    this._cancelOps = true;
    try {
      if (this._activeXhrs && this._activeXhrs.size) {
        this._activeXhrs.forEach((xhr) => {
          try {
            xhr.abort();
          } catch (e) {}
        });
        this._activeXhrs.clear();
      }
    } catch (e) {
      console.warn("中断加载请求失败:", e);
    }
    try {
      if (this.canvasSelect && this.canvasSelect.destroy) {
        this.canvasSelect.destroy();
      }
    } catch (e) {
      console.warn("销毁 CanvasSelect 失败:", e);
    }
    this.canvasSelect = null;
    this._csUpdating = false;
    this.setState({
      calibrationTifPath: "",
      calibrationPolygonPoints: [],
      calibrationFolderPath: "",
      calibrationGroups: [],
      calibrationValues: {},
      calibrationData: null,
      calibrationAuth: "",
      currentCalibrationSelection: { groupId: null, band: null },
      calibrationTifDataUrl: "",
      calibrationTifLoading: false,
      showDrawingTip: false,
      polygonCommitted: false,
      activeGroupIndex: 0,
      tifCache: {},
      tifCacheLoading: false,
      tifCacheProgress: 0,
      channelPolygons: {},
      bandLoading: false,
      showLargeTifConfirm: false,
      largeTifCount: 0,
      pendingCalibrationItems: [],
      pendingCalibrationAuth: "",
      calibrationErrors: {},
      validationActivated: false,
    });
  };

  selectFolderAndProcess = () => {
    try {
      // 显示loading弹窗
      // this.setState({
      //     showLoading: true,
      //     processing: true
      // });

      console.log("触发文件选择器");

      // 通过CustomEvent打开文件选择器
      this.setState({ folderSelectPhase: "reconstruction" });
      window.dispatchEvent(
        new CustomEvent("openFile", {
          detail: { type: "getPath" },
        }),
      );
    } catch (error) {
      console.error("打开文件选择器时出错:", error);
      alert("打开文件选择器时出错: " + error.message);
      this.setState({
        showLoading: false,
        processing: false,
      });
    }
  };

  dealFile = (event) => {
    try {
      const { detail } = event;
      console.log("收到文件数据:", detail);

      if (detail.cmd === "getPath" && detail.path) {
        const fullPath = detail.path;
        console.log("获取到全路径:", fullPath, detail);

        // 根据选择目的进行处理
        const purpose = this.state.folderSelectPhase;
        if (purpose === "quadratFolder") {
          this.setState(
            { quadratFolderPath: fullPath, folderSelectPhase: null },
            () => {
              console.log("[样方] 文件夹已选择:", this.state.quadratFolderPath);
            },
          );
          return;
        } else if (purpose === "calibrationFolder") {
          // 选择用于辐射校正的文件夹
          this.setState(
            {
              calibrationFolderPath: fullPath,
              folderSelectPhase: null,
            },
            () => {
              console.log(
                "标定文件夹选择完成:",
                this.state.calibrationFolderPath,
              );
              // 请求列出该文件夹内的TIF文件（需要宿主支持该事件）
              try {
                window.dispatchEvent(
                  new CustomEvent("openFile", {
                    detail: { type: "getFolderFiles", path: fullPath },
                  }),
                );
              } catch (e) {
                console.warn("无法请求列出文件:", e);
              }
            },
          );
          return;
        } else if (purpose === "calibrationTif") {
          // 选择用于绘制多边形的标定板TIF
          this.setState(
            {
              calibrationTifPath: fullPath,
              folderSelectPhase: null,
            },
            () => {
              console.log("标定板TIF已选择:", this.state.calibrationTifPath);
              // 此处可初始化CanvasSelect，等待弹窗渲染完成
              setTimeout(() => {
                if (
                  this.calibrationCanvasRef &&
                  this.calibrationCanvasRef.current
                ) {
                  try {
                    // 具体库初始化留给宿主环境，当前仅记录TIF路径
                    console.log("CanvasSelect容器已就绪");
                  } catch (e) {
                    console.warn("初始化CanvasSelect失败:", e);
                  }
                }
              }, 0);
            },
          );
          return;
        }

        // 默认：选择重建文件夹
        const pathParts = fullPath.replace(/\\/g, "/").split("/");
        const folderName =
          pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

        // 解析文件夹名称，提取采样日期和地块名
        const { samplingDate, plotName } = this.parseFolderName(folderName);

        // 更新状态
        // 切换主文件夹时，清空所有标定数据
        this.resetCalibrationState();
        this.setState(
          {
            folderName: plotName,
            folderFullPath: fullPath,
            samplingDate: samplingDate,
            showLoading: false,
            processing: false,
          },
          () => {
            console.log("状态更新完成:");
            console.log("文件夹名称:", this.state.folderName);
            console.log("全路径:", this.state.folderFullPath);
            console.log("采样日期:", this.state.samplingDate);

            // 需要标定的类型：多光谱或热红外
            const needsCalibration =
              this.state.selectedTypes.includes("multispectral") ||
              this.state.selectedTypes.includes("thermal-infrared");
            if (needsCalibration) {
              this.openCalibrationModal();
            } else {
              this.prepareTaskCreation();
            }
          },
        );
      } else if (detail.cmd === "getFilesRaw" && Array.isArray(detail.list)) {
        const list = detail.list || [];
        const auth = detail.auth || "";
        console.log("收到文件列表:", list);

        const purpose = this.state.folderSelectPhase;
        const RAW_BASE = `${config.RAW_API_URL}/api/raw`;

        if (purpose === "calibrationTif") {
          const tifItem = list.find((it) => /\.tif$/i.test(it.name)) || list[0];
          if (!tifItem) {
            alert("未选择任何文件");
            return;
          }
          const fullUrl = RAW_BASE + tifItem.path + (auth ? "?" + auth : "");
          this.setState(
            {
              calibrationTifPath: fullUrl,
              calibrationAuth: auth,
              folderSelectPhase: null,
            },
            () => {
              console.log("标定板TIF已选择:", this.state.calibrationTifPath);
            },
          );
          return;
        } else if (purpose === "calibrationFolder") {
          // 记录标定文件夹路径（取首个条目的父目录）并解析分组
          const firstPath = list[0] && list[0].path ? list[0].path : "";
          const folderPath = firstPath
            ? firstPath.replace(/\\/g, "/").split("/").slice(0, -1).join("/")
            : "";
          // 切换标定文件夹时，清空所有标定数据
          this.resetCalibrationState();
          this.setState(
            {
              calibrationAuth: auth,
              calibrationFolderPath: folderPath,
              folderSelectPhase: null,
            },
            () => {
              const tifCount = (list || []).filter((it) => {
                const name = typeof it === "string" ? it : it && it.name;
                return name && /\.tif$/i.test(name);
              }).length;
              if (tifCount > 20) {
                this.setState({
                  showLargeTifConfirm: true,
                  largeTifCount: tifCount,
                  pendingCalibrationItems: list,
                  pendingCalibrationAuth: auth,
                });
              } else {
                this.parseTifGroups(list, auth);
              }
            },
          );
          return;
        }

        // 默认处理：尝试解析分组
        this.parseTifGroups(list, auth);
      } else {
        console.error("无效的文件数据:", detail);
        this.setState({
          showLoading: false,
          processing: false,
        });
        alert("获取文件路径失败");
      }
    } catch (error) {
      console.error("处理文件数据时出错:", error);
      this.setState({
        showLoading: false,
        processing: false,
      });
      alert("处理文件数据时出错: " + error.message);
    }
  };

  prepareTaskCreation = () => {
    const { selectedTypes } = this.state;
    const pendingTaskTypes = [];

    console.log("准备任务创建队列:");
    console.log("选择的类型:", selectedTypes);

    // 根据选择的类型直接创建任务队列，不依赖文件数组
    if (selectedTypes.includes("rgb")) {
      pendingTaskTypes.push("rgb");
      console.log("添加RGB任务到队列");
    }

    if (selectedTypes.includes("multispectral")) {
      pendingTaskTypes.push("multispectral");
      console.log("添加多光谱任务到队列");
    }

    if (selectedTypes.includes("thermal-infrared")) {
      pendingTaskTypes.push("thermal-infrared");
      console.log("添加热红外任务到队列");
    }

    console.log("最终任务队列:", pendingTaskTypes);

    if (pendingTaskTypes.length === 0) {
      alert("请至少选择一种数据类型");
      return;
    }

    // 检查是否已有其他实例在显示任务面板
    if (
      window.activeTaskPanelInstance &&
      window.activeTaskPanelInstance !== this.instanceId
    ) {
      // alert('已有任务面板正在使用中，请稍后再试');
      return;
    }

    // 设置当前实例为活跃实例
    window.activeTaskPanelInstance = this.instanceId;

    this.setState(
      {
        pendingTaskTypes: pendingTaskTypes,
        currentTaskType: pendingTaskTypes[0],
        showTaskPanel: true,
      },
      () => {
        console.log(
          "任务队列初始化完成，当前任务:",
          this.state.currentTaskType,
        );
      },
    );
  };

  handleTaskSave = (taskInfo) => {
    console.log(`${this.state.currentTaskType}任务信息:`, taskInfo);

    // 创建上传任务
    const uploadTask = {
      id: `${this.state.currentTaskType}_${Date.now()}`,
      name: taskInfo.name,
      type: this.state.currentTaskType,
      projectId: this.props.projectId,
      folderPath: this.state.folderFullPath, // 使用文件夹路径而不是文件数组
      options: taskInfo.options,
      selectedNode: taskInfo.selectedNode,
      resizeMode: taskInfo.resizeMode,
      resizeSize: taskInfo.resizeSize,
      samplingDate:
        this.state.samplingDate || new Date().toISOString().split("T")[0], // 如果没有采样日期则使用当前日期
      plotName: this.state.folderName, // 地块名
      status: "pending",
    };

    const quadratDimensionCm = Number(this.state.quadratSize);
    if (
      this.state.currentTaskType === "multispectral" &&
      this.state.quadratFolderPath &&
      Number.isFinite(quadratDimensionCm) &&
      quadratDimensionCm > 0
    ) {
      uploadTask.samplePlot = {
        src_folder: this.state.quadratFolderPath,
        geometry_type:
          this.state.quadratGeometryType === "circle" ? "circle" : "square",
        dimension_cm: quadratDimensionCm,
      };
    }

    // 组装辐射板标定数据 radiometric（分组为二维数组），仅当存在 calibrationGroups 时生成
    try {
      const groups = Array.isArray(this.state.calibrationGroups)
        ? this.state.calibrationGroups
        : [];
      if (groups.length) {
        const radiometric = groups.map((group) => {
          const result = [];
          const files = group && group.files ? group.files : {};
          Object.keys(files).forEach((band) => {
            const url = files[band];
            // 从完整URL提取相对路径（去掉主机与查询参数），例如 http://host/api/raw/reflector/0001_MS_G.TIF?auth=xxx -> reflector/0001_MS_G.TIF
            const picture =
              typeof url === "string"
                ? url
                    .replace(/^https?:\/\/[^/]+\/api\/raw\//, "")
                    .replace(/\?.*$/, "")
                : "";
            const key = `${group.groupId}_${band}`;
            const coords =
              this.state.channelPolygons && this.state.channelPolygons[key]
                ? this.state.channelPolygons[key]
                : [];
            const pv =
              this.state.calibrationValues &&
              this.state.calibrationValues[group.groupId]
                ? this.state.calibrationValues[group.groupId][band]
                : "";
            const panel_reflectance =
              pv !== "" && pv !== undefined && pv !== null ? Number(pv) : null;
            result.push({
              name: band,
              picture: picture,
              coords: Array.isArray(coords) ? coords : [],
              panel_reflectance: panel_reflectance,
            });
          });
          return result;
        });
        uploadTask.radiometric = radiometric;
      }
    } catch (e) {
      console.warn("组装 radiometric 数据失败:", e);
    }

    // 添加到全局上传任务管理器
    this.props.taskManager.addTask(uploadTask);

    console.log("任务已添加到全局上传队列:", uploadTask);

    // 从队列中移除当前任务类型
    const remainingTypes = this.state.pendingTaskTypes.slice(1);
    console.log("剩余任务队列:", remainingTypes);

    if (remainingTypes.length > 0) {
      // 还有其他任务需要创建
      console.log(`准备创建下一个任务: ${remainingTypes[0]}`);
      this.setState(
        {
          pendingTaskTypes: remainingTypes,
          currentTaskType: remainingTypes[0],
          // showTaskPanel保持true，继续显示下一个任务面板
        },
        () => {
          console.log(
            "状态更新完成，当前任务类型:",
            this.state.currentTaskType,
          );
        },
      );
    } else {
      // 所有任务都创建完成
      console.log("所有任务创建完成");
      // 清除活跃实例标记
      if (window.activeTaskPanelInstance === this.instanceId) {
        window.activeTaskPanelInstance = null;
      }
      this.setState({
        showTaskPanel: false,
        currentTaskType: null,
        pendingTaskTypes: [],
      });
      this.props.onNewTaskAdded();
    }
  };

  handleTaskCancel = () => {
    // 清除活跃实例标记
    if (window.activeTaskPanelInstance === this.instanceId) {
      window.activeTaskPanelInstance = null;
    }
    this.setState({
      showTaskPanel: false,
      currentTaskType: null,
      pendingTaskTypes: [],
    });
  };

  getCurrentFiles = () => {
    // 由于使用CustomEvent方式，这里返回空数组
    // 实际文件会在NewTaskPanel中通过getFilesRaw回调获取
    return [1];
  };

  getCurrentTaskName = () => {
    const { currentTaskType, folderName } = this.state;
    if (currentTaskType === "rgb") {
      return `${folderName}_RGB`;
    } else if (currentTaskType === "multispectral") {
      return `${folderName}_多光谱`;
    } else if (currentTaskType === "thermal-infrared") {
      return `${folderName}_热红外`;
    }
    return folderName;
  };

  handleCloseLoading = () => {
    this.setState({ showLoading: false, processing: false });
  };

  // 解析文件夹名称，提取采样日期和地块名
  parseFolderName = (folderName) => {
    try {
      // DJI格式: DJI_202506110941_001_大疆智慧农业平台_地块名xxxx
      const djiMatch = folderName.match(
        /^DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_\d+_.*?[_-](.+)$/,
      );
      if (djiMatch) {
        const year = djiMatch[1];
        const month = djiMatch[2];
        const day = djiMatch[3];
        const plotName = djiMatch[6];

        // 验证日期有效性
        const date = new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
        );
        if (
          date.getFullYear() == year &&
          date.getMonth() == month - 1 &&
          date.getDate() == day
        ) {
          return {
            samplingDate: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
            plotName: plotName.trim(),
          };
        }
      }

      // 通用格式匹配（支持下划线_和中横线-作为分隔符）
      const patterns = [
        // 格式1: YYYYMMDD[_-]地块名 (如: 20231215_A1, 20231215-A1)
        { regex: /^(\d{4})(\d{2})(\d{2})[_-](.+)$/, dateFirst: true },
        // 格式2: YYYY-MM-DD[_-]地块名 (如: 2023-12-15_A1, 2023-12-15-A1)
        { regex: /^(\d{4})-(\d{2})-(\d{2})[_-](.+)$/, dateFirst: true },
        // 格式3: YYYYMMDDHHMM[_-]地块名 (如: 202312151030_A1, 202312151030-A1)
        { regex: /^(\d{4})(\d{2})(\d{2})\d{4}[_-](.+)$/, dateFirst: true },
        // 格式4: 地块名[_-]YYYYMMDD (如: A1_20231215, A1-20231215)
        { regex: /^(.+)[_-](\d{4})(\d{2})(\d{2})$/, dateFirst: false },
        // 格式5: 地块名[_-]YYYY-MM-DD (如: A1_2023-12-15, A1-2023-12-15)
        { regex: /^(.+)[_-](\d{4})-(\d{2})-(\d{2})$/, dateFirst: false },
        // 格式6: 地块名[_-]YYYYMMDDHHMM (如: A1_202312151030, A1-202312151030)
        { regex: /^(.+)[_-](\d{4})(\d{2})(\d{2})\d{4}$/, dateFirst: false },
        // 格式7: YYYY.MM.DD[_-]地块名 (如: 2023.12.15_A1, 2023.12.15-A1)
        { regex: /^(\d{4})\.(\d{2})\.(\d{2})[_-](.+)$/, dateFirst: true },
        // 格式8: 地块名[_-]YYYY.MM.DD (如: A1_2023.12.15, A1-2023.12.15)
        { regex: /^(.+)[_-](\d{4})\.(\d{2})\.(\d{2})$/, dateFirst: false },
        // 格式9: YYYY/MM/DD[_-]地块名 (如: 2023/12/15_A1, 2023/12/15-A1)
        { regex: /^(\d{4})\/(\d{2})\/(\d{2})[_-](.+)$/, dateFirst: true },
        // 格式10: 地块名[_-]YYYY/MM/DD (如: A1_2023/12/15, A1-2023/12/15)
        { regex: /^(.+)[_-](\d{4})\/(\d{2})\/(\d{2})$/, dateFirst: false },
      ];

      for (const pattern of patterns) {
        const match = folderName.match(pattern.regex);
        if (match) {
          let year, month, day, plotName;

          if (pattern.dateFirst) {
            // 日期在前的格式
            year = match[1];
            month = match[2];
            day = match[3];
            plotName = match[4];
          } else {
            // 日期在后的格式
            plotName = match[1];
            year = match[2];
            month = match[3];
            day = match[4];
          }

          // 验证日期有效性
          const date = new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
          );
          if (
            date.getFullYear() == year &&
            date.getMonth() == month - 1 &&
            date.getDate() == day
          ) {
            return {
              samplingDate: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
              plotName: plotName.trim(),
            };
          }
        }
      }

      // 尝试提取任何可能的日期格式
      const datePatterns = [
        /(\d{4})(\d{2})(\d{2})/, // YYYYMMDD
        /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
        /(\d{4})\.(\d{2})\.(\d{2})/, // YYYY.MM.DD
        /(\d{4})\/(\d{2})\/(\d{2})/, // YYYY/MM/DD
      ];

      for (const datePattern of datePatterns) {
        const dateMatch = folderName.match(datePattern);
        if (dateMatch) {
          const year = dateMatch[1];
          const month = dateMatch[2];
          const day = dateMatch[3];

          // 验证日期有效性
          const date = new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
          );
          if (
            date.getFullYear() == year &&
            date.getMonth() == month - 1 &&
            date.getDate() == day
          ) {
            // 尝试提取地块名（移除日期部分）
            let plotName = folderName
              .replace(datePattern, "")
              .replace(/[_-]+/g, "")
              .replace(/^[_-]|[_-]$/g, "");
            if (!plotName) {
              plotName = folderName; // 如果无法提取地块名，使用完整文件夹名
            }

            return {
              samplingDate: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
              plotName: plotName.trim(),
            };
          }
        }
      }

      // 如果没有匹配到任何格式，返回原文件夹名作为地块名，采样日期使用当前日期
      console.log("无法解析文件夹名称格式，使用默认值:", folderName);
      return {
        samplingDate: new Date().toISOString().split("T")[0], // 使用当前日期
        plotName: folderName,
      };
    } catch (error) {
      console.error("解析文件夹名称时出错:", error);
      return {
        samplingDate: new Date().toISOString().split("T")[0], // 异常时使用当前日期
        plotName: folderName,
      };
    }
  };

  // 打开辐射板标定弹窗
  openCalibrationModal = () => {
    this._cancelOps = false; // 打开弹窗时允许异步操作
    this.setState({ showCalibrationModal: true }, () => {
      console.log("标定弹窗已打开");
    });
  };

  // 打开样方弹窗（仅多光谱，标定完成后调用）
  openQuadratModal = () => {
    this.setState(
      {
        showQuadratModal: true,
        quadratFolderPath: "",
        quadratSize: "100",
        quadratGeometryType: "square",
      },
      () => {
        console.log("样方弹窗已打开");
      },
    );
  };

  // 选择样方文件夹
  selectQuadratFolder = () => {
    this.setState({ folderSelectPhase: "quadratFolder" });
    try {
      window.dispatchEvent(
        new CustomEvent("openFile", { detail: { type: "getPath" } }),
      );
    } catch (e) {
      console.error("选择样方文件夹失败:", e);
    }
  };

  // 跳过样方步骤，直接进入任务创建
  skipQuadratAndProceed = () => {
    console.log("[样方] 已跳过样方选择");
    this.setState(
      {
        showQuadratModal: false,
        quadratFolderPath: "",
        quadratSize: "",
        quadratGeometryType: "square",
      },
      () => {
        this.prepareTaskCreation();
      },
    );
  };

  // 确认样方信息，进入任务创建
  confirmQuadratAndProceed = () => {
    const { quadratFolderPath, quadratSize, quadratGeometryType } = this.state;
    console.log("[样方] 样方文件夹路径:", quadratFolderPath);
    console.log("[样方] 几何类型:", quadratGeometryType);
    console.log("[样方] 尺寸 (cm):", quadratSize);
    this.setState({ showQuadratModal: false }, () => {
      this.prepareTaskCreation();
    });
  };

  // 关闭标定弹窗（不执行标定，直接创建任务），并取消所有转换/加载
  skipCalibrationAndProceed = () => {
    this._cancelOps = true;
    try {
      if (this._activeXhrs && this._activeXhrs.size) {
        this._activeXhrs.forEach((xhr) => {
          try {
            xhr.abort();
          } catch (e) {}
        });
        this._activeXhrs.clear();
      }
    } catch (e) {
      console.warn("中断加载请求失败:", e);
    }
    this.setState(
      {
        calibrationData: null,
        showCalibrationModal: false,
        tifCacheLoading: false,
        bandLoading: false,
        calibrationTifLoading: false,
      },
      () => {
        if (this.state.selectedTypes.includes("multispectral")) {
          this.openQuadratModal();
        } else {
          this.prepareTaskCreation();
        }
      },
    );
  };

  // 设置标定文件夹
  selectCalibrationFolder = () => {
    this.setState({ folderSelectPhase: "calibrationFolder" });
    try {
      // 使用 getFilesRaw：宿主返回 { list: [...], auth }
      window.dispatchEvent(
        new CustomEvent("openFile", { detail: { type: "getFilesRaw" } }),
      );
    } catch (e) {
      console.error("选择标定文件夹失败:", e);
    }
  };

  // 选择标定板TIF（已不再使用左侧单独上传TIF，仅保留方法以兼容旧逻辑）
  selectCalibrationTif = () => {
    alert("请在右侧分组内点击通道以加载对应TIF到左侧进行标注");
  };

  // 大数据量提示的处理
  handleLargeTifContinue = () => {
    const items = this.state.pendingCalibrationItems || [];
    const auth = this.state.pendingCalibrationAuth || "";
    this.setState({ showLargeTifConfirm: false }, () => {
      this.parseTifGroups(items, auth);
    });
  };

  handleLargeTifReselect = () => {
    this.setState({ showLargeTifConfirm: false }, () => {
      this.resetCalibrationState();
      this.selectCalibrationFolder();
    });
  };

  // 是否为纯热红外标定模式
  isThermalCalibration = () => {
    const types = this.state.selectedTypes || [];
    return types.includes("thermal-infrared") && !types.includes("multispectral");
  };

  // 当前标定通道列表
  getCalibrationBands = () => {
    return this.isThermalCalibration() ? ["T"] : ["G", "R", "RE", "NIR"];
  };

  // 解析TIF分组，支持两种输入：
  // 1) 字符串数组（文件名）
  // 2) 对象数组（{ name, path, extension, ... }），并可传入 auth
  parseTifGroups = (items, auth) => {
    try {
      this._cancelOps = false;
      const RAW_BASE = `${config.RAW_API_URL}/api/raw/`;
      const groupsMap = {};
      const isThermal = this.isThermalCalibration();
      console.log("[parseTifGroups] selectedTypes:", this.state.selectedTypes, "isThermal:", isThermal);
      (items || []).forEach((it) => {
        let name = null;
        let path = null;
        if (typeof it === "string") {
          name = it;
          path = it;
        } else if (it && typeof it === "object") {
          name = it.name;
          path = it.path;
        }
        if (!name || !/\.tif$/i.test(name)) return;
        if (isThermal) {
          // 热红外：匹配 _T.TIF 结尾的文件，前缀作为分组id
          const m = name.match(/^(.+)_T\.TIF$/i);
          console.log("[Thermal] 文件名:", name, "匹配结果:", m);
          if (m) {
            const gid = m[1];
            if (!groupsMap[gid]) groupsMap[gid] = { groupId: gid, files: {} };
            const url = RAW_BASE + path + (auth ? "?auth=" + auth : "");
            groupsMap[gid].files["T"] = url;
          }
        } else {
          // 多光谱：匹配 _MS_(G|NIR|R|RE).TIF
          const m = name.match(/^(DJI_\d{14}_\d{4})_MS_(G|NIR|R|RE)\.TIF$/i);
          if (m) {
            const gid = m[1];
            const band = m[2].toUpperCase();
            if (!groupsMap[gid]) groupsMap[gid] = { groupId: gid, files: {} };
            const url = RAW_BASE + path + (auth ? "?auth=" + auth : "");
            groupsMap[gid].files[band] = url;
          }
        }
      });
      const groups = Object.values(groupsMap);
      const calibVals = {};
      const defaultBands = isThermal ? { T: "" } : { G: "", R: "", RE: "", NIR: "" };
      groups.forEach((g) => {
        calibVals[g.groupId] = calibVals[g.groupId] || { ...defaultBands };
      });
      this.setState({
        calibrationGroups: groups,
        calibrationValues: { ...this.state.calibrationValues, ...calibVals },
        activeGroupIndex: 0,
      });

      // 预加载所有TIF文件的base64数据
      this.preloadTifCache(groups);
    } catch (e) {
      console.error("分组tif文件失败:", e);
    }
  };

  // 单通道校验：计算该组/通道的错误（若该通道无文件，返回 null 以移除错误）
  computeChannelError = (
    groupId,
    band,
    values,
    polygons,
    groups,
    overrideCoords,
  ) => {
    try {
      const g = (groups || []).find((x) => x.groupId === groupId);
      if (!g || !g.files || !g.files[band]) return null; // 无文件不校验
      const pv = values && values[groupId] ? values[groupId][band] : "";
      const num = pv === "" ? NaN : Number(pv);
      const valMissing = pv === "" || pv === undefined || pv === null;
      const isThermal = (this.state.selectedTypes || []).includes("thermal-infrared") &&
        !(this.state.selectedTypes || []).includes("multispectral");
      const valInvalid = isThermal
        ? !isFinite(num) || num < -40 || num > 150
        : !isFinite(num) || num < 0 || num > 1;
      const key = `${groupId}_${band}`;
      const coords =
        overrideCoords !== undefined
          ? overrideCoords
          : polygons && polygons[key]
            ? polygons[key]
            : [];
      const polyMissing = !Array.isArray(coords) || coords.length < 3;
      return { valMissing, valInvalid, polyMissing };
    } catch (e) {
      console.warn("computeChannelError 失败:", e);
      return { valMissing: true, valInvalid: true, polyMissing: true };
    }
  };

  // 更新错误字典：根据 err 为 null 进行清除，否则写入
  upsertCalibrationError = (errors, groupId, band, err) => {
    const next = { ...(errors || {}) };
    if (!err) {
      if (next[groupId]) {
        const { [band]: _, ...restBands } = next[groupId];
        if (Object.keys(restBands).length > 0) next[groupId] = restBands;
        else delete next[groupId];
      }
    } else {
      next[groupId] = { ...(next[groupId] || {}), [band]: err };
    }
    return next;
  };

  // 更新标定值（实时校验 0-1 数字，并联动当前通道的多边形校验）
  handleCalibrationValueChange = (groupId, band, value) => {
    this.setState((prev) => {
      const newCalibValues = {
        ...prev.calibrationValues,
        [groupId]: {
          ...(prev.calibrationValues[groupId] || {}),
          [band]: value,
        },
      };
      const err = this.computeChannelError(
        groupId,
        band,
        newCalibValues,
        prev.channelPolygons,
        prev.calibrationGroups,
      );
      const newErrors = this.upsertCalibrationError(
        prev.calibrationErrors,
        groupId,
        band,
        err,
      );
      return {
        calibrationValues: newCalibValues,
        calibrationErrors: newErrors,
        validationActivated: true,
      };
    });
  };

  // 右侧点击通道时，加载对应TIF到左侧并重置多边形
  handleBandClick = (groupId, band) => {
    try {
      const group = (this.state.calibrationGroups || []).find(
        (g) => g.groupId === groupId,
      );
      const url = group && group.files && group.files[band];
      if (!url) {
        alert("该分组该通道无TIF");
        return;
      }
      const idx = (this.state.calibrationGroups || []).findIndex(
        (g) => g.groupId === groupId,
      );
      // 优先从缓存获取TIF数据
      const cachedDataUrl = this.getTifFromCache(url);
      if (cachedDataUrl) {
        // 使用缓存数据
        this.setState(
          {
            calibrationTifPath: url,
            currentCalibrationSelection: { groupId, band },
            calibrationPolygonPoints: [],
            calibrationTifDataUrl: cachedDataUrl,
            calibrationTifLoading: false,
            bandLoading: false,
            polygonCommitted: false,
            showDrawingTip: false,
            activeGroupIndex: idx >= 0 ? idx : this.state.activeGroupIndex,
          },
          () => {
            console.log("从缓存加载TIF:", url);
            const key = this.getChannelKey(groupId, band);
            const saved = key ? this.state.channelPolygons[key] || [] : [];
            this.initCanvasSelect(cachedDataUrl, saved);
          },
        );
      } else {
        // 缓存中没有，需要重新加载
        this.setState(
          {
            calibrationTifPath: url,
            currentCalibrationSelection: { groupId, band },
            calibrationPolygonPoints: [],
            calibrationTifDataUrl: "",
            calibrationTifLoading: true,
            bandLoading: true,
            polygonCommitted: false,
            showDrawingTip: false,
            activeGroupIndex: idx >= 0 ? idx : this.state.activeGroupIndex,
          },
          () => {
            console.log("缓存未命中，重新加载TIF:", url);
            this.loadTiffToDataUrl(url);
          },
        );
      }
    } catch (e) {
      console.error("选择通道TIF失败:", e);
    }
  };

  // 删除当前分组：清除该分组所有数据（值、坐标、选择、索引）
  handleDeleteGroup = (groupId) => {
    try {
      this.setState(
        (prev) => {
          const groups = (prev.calibrationGroups || []).filter(
            (g) => g.groupId !== groupId,
          );
          const cv = { ...prev.calibrationValues };
          delete cv[groupId];
          const cp = { ...prev.channelPolygons };
          Object.keys(cp).forEach((k) => {
            if (k && k.startsWith(`${groupId}_`)) delete cp[k];
          });
          // 计算新的活动索引
          const removedIdx = (prev.calibrationGroups || []).findIndex(
            (g) => g.groupId === groupId,
          );
          let newActive = prev.activeGroupIndex || 0;
          if (removedIdx >= 0) {
            if (newActive > removedIdx) newActive = newActive - 1;
            else if (newActive === removedIdx)
              newActive = Math.max(0, newActive - 1);
          }
          // 清除当前选择
          let sel = prev.currentCalibrationSelection;
          if (sel && sel.groupId === groupId)
            sel = { groupId: null, band: null };
          const ce = { ...(prev.calibrationErrors || {}) };
          delete ce[groupId];
          return {
            calibrationGroups: groups,
            calibrationValues: cv,
            channelPolygons: cp,
            calibrationErrors: ce,
            activeGroupIndex: newActive,
            currentCalibrationSelection: sel,
          };
        },
        () => {
          // 如果当前选择被清除，重置左侧画布与TIF
          const sel = this.state.currentCalibrationSelection || {};
          if (!sel.groupId) {
            try {
              if (this.canvasSelect && this.canvasSelect.setData)
                this.canvasSelect.setData([]);
            } catch (e) {}
            this.setState({
              calibrationTifDataUrl: "",
              calibrationTifPath: "",
              polygonCommitted: false,
              calibrationPolygonPoints: [],
            });
          }
        },
      );
    } catch (e) {
      console.warn("删除分组失败:", e);
    }
  };

  // 使用 tiff.js 将 tif 转为 base64 并更新 state（支持关闭弹窗时的取消）
  loadTiffToDataUrl = (path) => {
    try {
      const TiffLib =
        (typeof window !== "undefined" ? window.Tiff : null) ||
        (typeof Tiff !== "undefined" ? Tiff : null);
      if (!TiffLib) {
        console.warn("tiff.js 未加载，直接使用原始路径显示可能失败");
        this.setState({
          calibrationTifDataUrl: "",
          calibrationTifLoading: false,
        });
        return;
      }
      const xhr = new XMLHttpRequest();
      const token = ++this._bandToken; // 为本次通道加载打标
      xhr.responseType = "arraybuffer";
      xhr.open("GET", path, true);
      this._activeXhrs.add(xhr);
      xhr.onload = () => {
        // 若已关闭弹窗或令牌不匹配（说明已切换到新的加载），则丢弃回调
        if (this._cancelOps || token !== this._bandToken) {
          try {
            this._activeXhrs.delete(xhr);
          } catch (_) {}
          return;
        }
        try {
          const tiff = new TiffLib({ buffer: xhr.response });
          const dataUrl = tiff.toDataURL();
          try {
            this._activeXhrs.delete(xhr);
          } catch (_) {}
          this.setState(
            {
              calibrationTifDataUrl: dataUrl,
              calibrationTifLoading: false,
              bandLoading: false,
            },
            () => {
              const sel = this.state.currentCalibrationSelection || {};
              const key = this.getChannelKey(sel.groupId, sel.band);
              const saved = key ? this.state.channelPolygons[key] || [] : [];
              this.initCanvasSelect(dataUrl, saved);
            },
          );
        } catch (e) {
          console.error("TIFF 解码失败:", e);
          try {
            this._activeXhrs.delete(xhr);
          } catch (_) {}
          this.setState({
            calibrationTifDataUrl: "",
            calibrationTifLoading: false,
            bandLoading: false,
          });
        }
      };
      xhr.onerror = (e) => {
        if (this._cancelOps || token !== this._bandToken) {
          try {
            this._activeXhrs.delete(xhr);
          } catch (_) {}
          return;
        }
        console.error("TIFF 加载失败:", e);
        try {
          this._activeXhrs.delete(xhr);
        } catch (_) {}
        this.setState({
          calibrationTifDataUrl: "",
          calibrationTifLoading: false,
          bandLoading: false,
        });
      };
      xhr.onabort = () => {
        // 中断时不再更新任何状态
        try {
          this._activeXhrs.delete(xhr);
        } catch (_) {}
      };
      xhr.send();
    } catch (e) {
      console.error("加载 TIFF 发生异常:", e);
      this.setState({
        calibrationTifDataUrl: "",
        calibrationTifLoading: false,
        bandLoading: false,
      });
    }
  };

  // 预加载所有TIF文件的base64数据并缓存（支持关闭弹窗时的取消）
  preloadTifCache = (groups) => {
    if (!groups || groups.length === 0) return;

    this.setState({ tifCacheLoading: true, tifCacheProgress: 0 });

    const TiffLib =
      (typeof window !== "undefined" ? window.Tiff : null) ||
      (typeof Tiff !== "undefined" ? Tiff : null);
    if (!TiffLib) {
      console.warn("tiff.js 未加载，无法预加载TIF缓存");
      this.setState({ tifCacheLoading: false });
      return;
    }

    const token = ++this._preloadToken; // 为本次预加载打标

    // 收集所有需要加载的TIF文件URL
    const allUrls = [];
    groups.forEach((group) => {
      Object.values(group.files).forEach((url) => {
        if (url && !allUrls.includes(url)) {
          allUrls.push(url);
        }
      });
    });

    if (allUrls.length === 0) {
      this.setState({ tifCacheLoading: false });
      return;
    }

    const cache = {};
    let loadedCount = 0;

    const loadSingleTif = (url) => {
      return new Promise((resolve) => {
        if (this._cancelOps || token !== this._preloadToken) {
          return resolve(false);
        }
        const xhr = new XMLHttpRequest();
        xhr.responseType = "arraybuffer";
        xhr.open("GET", url, true);
        this._activeXhrs.add(xhr);
        xhr.onload = () => {
          if (this._cancelOps || token !== this._preloadToken) {
            try {
              this._activeXhrs.delete(xhr);
            } catch (_) {}
            return resolve(false);
          }
          try {
            const tiff = new TiffLib({ buffer: xhr.response });
            const dataUrl = tiff.toDataURL();
            cache[url] = dataUrl;
            try {
              this._activeXhrs.delete(xhr);
            } catch (_) {}
            resolve(true);
          } catch (e) {
            console.error("TIFF 解码失败:", url, e);
            try {
              this._activeXhrs.delete(xhr);
            } catch (_) {}
            resolve(false);
          }
        };
        xhr.onerror = (e) => {
          try {
            this._activeXhrs.delete(xhr);
          } catch (_) {}
          if (this._cancelOps || token !== this._preloadToken) {
            return resolve(false);
          }
          console.error("TIFF 加载失败:", url, e);
          resolve(false);
        };
        xhr.onabort = () => {
          try {
            this._activeXhrs.delete(xhr);
          } catch (_) {}
          resolve(false);
        };
        xhr.send();
      });
    };

    // 并发加载所有TIF文件
    const loadPromises = allUrls.map((url) =>
      loadSingleTif(url).then((success) => {
        // 若已取消，则不再更新进度
        if (this._cancelOps || token !== this._preloadToken) {
          return false;
        }
        loadedCount++;
        const progress = Math.round((loadedCount / allUrls.length) * 100);
        this.setState({ tifCacheProgress: progress });
        return success;
      }),
    );

    Promise.all(loadPromises).then(() => {
      if (this._cancelOps || token !== this._preloadToken) {
        // 被取消或已切换，不更新任何状态
        return;
      }
      this.setState({
        tifCache: cache,
        tifCacheLoading: false,
        tifCacheProgress: 100,
      });
      console.log(
        `TIF缓存预加载完成，共加载 ${Object.keys(cache).length}/${allUrls.length} 个文件`,
      );

      // 如果尚未选择任何通道，默认选中第一个分组的第一个可用通道（按UI顺序：G/R/RE/NIR）
      const currentSel = this.state.currentCalibrationSelection || {};
      if (!currentSel.groupId && groups && groups.length > 0) {
        const firstGroup = groups[0];
        const bandOrder = this.getCalibrationBands();
        let band = null;
        if (firstGroup.files) {
          // 按固定顺序优先选择
          band = bandOrder.find((b) => firstGroup.files[b]) || null;
          // 兜底：若上述顺序都不存在，则选第一个有值的键
          if (!band) {
            const keys = Object.keys(firstGroup.files);
            band = keys.find((k) => firstGroup.files[k]) || null;
          }
        }
        if (band) {
          // 在setState回调中调用，确保tifCache已更新后命中缓存
          this.setState({ activeGroupIndex: 0 }, () => {
            this.handleBandClick(firstGroup.groupId, band);
          });
        }
      }
    });
  };

  // 从缓存获取TIF的base64数据
  getTifFromCache = (url) => {
    return this.state.tifCache[url] || null;
  };

  // 生成当前通道的唯一键
  getChannelKey = (groupId, band) => {
    if (!groupId || !band) return null;
    return `${groupId}_${band}`;
  };

  // 初始化并使用 CanvasSelect 显示 base64 背景图并采集多边形
  initCanvasSelect = (dataUrl, polygonCoor = null) => {
    try {
      // 加载/切换TIF时，先关闭实时校验，待用户操作后再开启
      this._suppressNextValidation = true;
      this.setState({ validationActivated: false });
      // 将 canvas 尺寸设置为容器大小，保证铺满
      const canvasEl =
        this.calibrationCanvasRef && this.calibrationCanvasRef.current
          ? this.calibrationCanvasRef.current
          : typeof document !== "undefined"
            ? document.querySelector(".calibration-canvas")
            : null;
      if (canvasEl && canvasEl.parentElement) {
        const parent = canvasEl.parentElement;
        canvasEl.width = parent.clientWidth;
        canvasEl.height = parent.clientHeight;
      }

      const CanvasSelectLib =
        (typeof window !== "undefined" ? window.CanvasSelect : null) ||
        CanvasSelect;
      if (!CanvasSelectLib) {
        console.warn("CanvasSelect 未加载");
        return;
      }
      if (!this.canvasSelect) {
        this.canvasSelect = new CanvasSelectLib(".calibration-canvas");
        // 监听 updated 事件，限制为单个多边形，并同步点位
        this.canvasSelect.on("updated", (allShapesData) => {
          try {
            const polys = (allShapesData || []).filter(
              (s) => s && s.type === 2,
            );
            if (polys.length > 1 && !this._csUpdating) {
              const last = polys[polys.length - 1];
              // 使用防重入标记并异步调用，避免updated事件递归触发导致栈溢出
              this._csUpdating = true;
              setTimeout(() => {
                try {
                  if (this.canvasSelect && this.canvasSelect.setData) {
                    this.canvasSelect.setData([last]);
                  }
                } finally {
                  this._csUpdating = false;
                }
              }, 0);
            }
            const lastPoly = polys.length ? polys[polys.length - 1] : null;
            const coor = lastPoly ? lastPoly.coor : [];
            const sel = this.state.currentCalibrationSelection || {};
            const key = this.getChannelKey(sel.groupId, sel.band);
            if (key) {
              this.setState((prev) => {
                const newChannelPolygons = {
                  ...prev.channelPolygons,
                  [key]: coor,
                };
                // 加载/切换TIF后的首次updated或尚未激活校验时，不做表单校验，仅同步坐标
                if (this._suppressNextValidation || !prev.validationActivated) {
                  if (this._suppressNextValidation)
                    this._suppressNextValidation = false;
                  return {
                    calibrationPolygonPoints: coor,
                    channelPolygons: newChannelPolygons,
                  };
                }
                const err = this.computeChannelError(
                  sel.groupId,
                  sel.band,
                  prev.calibrationValues,
                  newChannelPolygons,
                  prev.calibrationGroups,
                  coor,
                );
                const newErrors = this.upsertCalibrationError(
                  prev.calibrationErrors,
                  sel.groupId,
                  sel.band,
                  err,
                );
                return {
                  calibrationPolygonPoints: coor,
                  channelPolygons: newChannelPolygons,
                  calibrationErrors: newErrors,
                };
              });
            } else {
              this.setState({ calibrationPolygonPoints: coor });
            }
          } catch (e) {
            console.warn("解析 CanvasSelect 多边形失败:", e);
          }
        });
        // 当标注被添加（创建完成）时，切换为选择模式，隐藏提示，并显示重新绘制按钮
        this.canvasSelect.on("add", (newShape, allShapesData) => {
          try {
            if (newShape && newShape.type === 2) {
              const coor = Array.isArray(newShape.coor) ? newShape.coor : [];
              const sel = this.state.currentCalibrationSelection || {};
              const key = this.getChannelKey(sel.groupId, sel.band);
              if (key) {
                this.setState((prev) => {
                  const newChannelPolygons = {
                    ...prev.channelPolygons,
                    [key]: coor,
                  };
                  const err = this.computeChannelError(
                    sel.groupId,
                    sel.band,
                    prev.calibrationValues,
                    newChannelPolygons,
                    prev.calibrationGroups,
                    coor,
                  );
                  const newErrors = this.upsertCalibrationError(
                    prev.calibrationErrors,
                    sel.groupId,
                    sel.band,
                    err,
                  );
                  return {
                    calibrationPolygonPoints: coor,
                    showDrawingTip: false,
                    polygonCommitted: true,
                    channelPolygons: newChannelPolygons,
                    calibrationErrors: newErrors,
                    // 用户圈定多边形，开启实时校验
                    validationActivated: true,
                  };
                });
              } else {
                this.setState({
                  calibrationPolygonPoints: coor,
                  showDrawingTip: false,
                  polygonCommitted: true,
                });
              }
              if (this.canvasSelect.createType !== 0) {
                this.canvasSelect.createType = 0; // 选择模式
                if (this.canvasSelect.update) this.canvasSelect.update();
              }
            }
          } catch (e) {
            console.warn("处理 add 事件失败:", e);
          }
        });
        // 背景图加载完成时关闭 loading，并在图像可绘制后再显示绘制提示
        this.canvasSelect.on("load", () => {
          const sel = this.state.currentCalibrationSelection || {};
          const key = this.getChannelKey(sel.groupId, sel.band);
          const saved = key ? this.state.channelPolygons[key] || [] : [];
          const hasPoly = Array.isArray(saved) && saved.length > 0;
          this.setState({
            calibrationTifLoading: false,
            showDrawingTip: !hasPoly,
            polygonCommitted: !!hasPoly,
          });
        });
      }
      // 切图时清空旧标注数据
      if (this.canvasSelect.setData) {
        this.canvasSelect.setData([]);
      }
      // 设置背景图并启用多边形标注
      this.canvasSelect.setImage(dataUrl);
      this.canvasSelect.createType = 2; // 多边形创建模式
      this.canvasSelect.showCross = true;
      this.canvasSelect.lineWidth = 2;
      this.canvasSelect.ctrlRadius = 4;

      // 如果提供了已保存的多边形，恢复显示
      if (
        polygonCoor &&
        Array.isArray(polygonCoor) &&
        polygonCoor.length > 0 &&
        this.canvasSelect.setData
      ) {
        this._csUpdating = true;
        try {
          this.canvasSelect.setData([{ type: 2, coor: polygonCoor }]);
          this.setState({
            calibrationPolygonPoints: polygonCoor,
            polygonCommitted: true,
            showDrawingTip: false,
          });
        } finally {
          this._csUpdating = false;
        }
      } else {
        // 初始化时仅清空点位与提交状态，绘制提示在背景图加载完成（load 事件）后再显示
        this.setState({
          calibrationPolygonPoints: [],
          polygonCommitted: false,
        });
      }
    } catch (e) {
      console.error("初始化 CanvasSelect 失败:", e);
    }
  };

  handleReDrawDefect = () => {
    try {
      if (this.canvasSelect) {
        // 清空数据，恢复到多边形创建模式
        if (this.canvasSelect.setData) this.canvasSelect.setData([]);
        this.canvasSelect.createType = 2;
        this.canvasSelect.readonly = false;
        if (this.canvasSelect.update) this.canvasSelect.update();
      }
      const sel = this.state.currentCalibrationSelection || {};
      const key = this.getChannelKey(sel.groupId, sel.band);
      if (key) {
        this.setState((prev) => {
          const cp = { ...prev.channelPolygons };
          delete cp[key];
          const err = this.computeChannelError(
            sel.groupId,
            sel.band,
            prev.calibrationValues,
            cp,
            prev.calibrationGroups,
            [],
          );
          const newErrors = this.upsertCalibrationError(
            prev.calibrationErrors,
            sel.groupId,
            sel.band,
            err,
          );
          return {
            calibrationPolygonPoints: [],
            showDrawingTip: true,
            polygonCommitted: false,
            channelPolygons: cp,
            calibrationErrors: newErrors,
            validationActivated: true,
          };
        });
      } else {
        this.setState({
          calibrationPolygonPoints: [],
          showDrawingTip: true,
          polygonCommitted: false,
          validationActivated: true,
        });
      }
    } catch (e) {
      console.warn("重新绘制初始化失败:", e);
    }
  };

  // 关闭标定弹窗（同时取消所有转换/加载操作）
  handleCloseCalibrationModal = () => {
    // 置取消标志，并中断所有活跃的XHR
    this._cancelOps = true;
    try {
      if (this._activeXhrs && this._activeXhrs.size) {
        this._activeXhrs.forEach((xhr) => {
          try {
            xhr.abort();
          } catch (e) {}
        });
        this._activeXhrs.clear();
      }
    } catch (e) {
      console.warn("中断加载请求失败:", e);
    }

    this.setState(
      {
        showCalibrationModal: false,
        tifCacheLoading: false,
        tifCacheProgress: 0,
        calibrationTifLoading: false,
        bandLoading: false,
      },
      () => {
        try {
          if (this.canvasSelect && this.canvasSelect.destroy) {
            this.canvasSelect.destroy();
          }
        } catch (e) {
          console.warn("销毁 CanvasSelect 失败:", e);
        }
        this.canvasSelect = null;
        this.setState({
          calibrationTifDataUrl: "",
          calibrationPolygonPoints: [],
        });
      },
    );
  };

  // 表单校验：各组有文件的通道必须填写反射率并圈定多边形
  validateCalibration = () => {
    const groups = this.state.calibrationGroups || [];
    const errors = {};
    let hasError = false;
    const bands = this.getCalibrationBands();
    const values = this.state.calibrationValues || {};
    const polygons = this.state.channelPolygons || {};
    groups.forEach((g) => {
      bands.forEach((band) => {
        const err = this.computeChannelError(
          g.groupId,
          band,
          values,
          polygons,
          groups,
        );
        // 仅当存在实际错误（任一标志为 true）时记录错误；无文件（err===null）或全部为 false 均视为无错
        const isErr = !!(
          err &&
          (err.valMissing || err.valInvalid || err.polyMissing)
        );
        if (isErr) {
          hasError = true;
          errors[g.groupId] = errors[g.groupId] || {};
          errors[g.groupId][band] = err;
        }
      });
    });
    this.setState({ calibrationErrors: errors });
    // 将焦点切到第一个有错误的分组
    if (hasError) {
      const firstErrGid = Object.keys(errors)[0];
      const idx = groups.findIndex((x) => x.groupId == firstErrGid);
      if (idx >= 0) this.setState({ activeGroupIndex: idx });
      console.warn(
        "本地校验未通过，阻止继续。错误分组：",
        firstErrGid,
        "错误详情：",
        errors[firstErrGid],
      );
    }
    return !hasError;
  };

  // 远程校验：当本地规则通过后，调用后端接口校验多边形区域合法性
  remoteValidateRadiometric = async () => {
    const endpoint = `${config.ODM_API_URL}/api/odm/surface_reflectance`;
    const groups = this.state.calibrationGroups || [];
    const values = this.state.calibrationValues || {};
    const polygons = this.state.channelPolygons || {};
    const bands = this.getCalibrationBands();

    // 构建需要远程校验的 ITEM 列表（仅当本地校验通过时才发送）
    const requests = [];
    const itemsMeta = [];
    groups.forEach((g) => {
      bands.forEach((band) => {
        const url = g.files && g.files[band];
        if (!url) return; // 无文件不校验
        const key = `${g.groupId}_${band}`;
        const coords = polygons[key] || [];
        const pv = values[g.groupId] ? values[g.groupId][band] : "";
        const num = pv === "" ? NaN : Number(pv);
        const valMissing = pv === "" || pv === undefined || pv === null;
        const isThermal = (this.state.selectedTypes || []).includes("thermal-infrared") &&
          !(this.state.selectedTypes || []).includes("multispectral");
        const valInvalid = isThermal
          ? !isFinite(num) || num < -40 || num > 150
          : !isFinite(num) || num < 0 || num > 1;
        const polyMissing = !Array.isArray(coords) || coords.length < 3;
        if (!valMissing && !valInvalid && !polyMissing) {
          const picture =
            typeof url === "string"
              ? url
                  .replace(/^https?:\/\/[^/]+\/api\/raw\//, "")
                  .replace(/\?.*$/, "")
              : "";
          const item = { name: band, picture, coords, panel_reflectance: num };
          // 记录meta用于失败时定位具体分组/通道（如后续需要联动UI）
          itemsMeta.push({ groupId: g.groupId, band });
          requests.push(
            fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(item),
            })
              .then((res) => {
                console.log(
                  `[远程校验] ${g.groupId}-${band} 响应状态:`,
                  res.status,
                );
                return { ok: res.status === 200, status: res.status };
              })
              .catch((err) => {
                console.error(`[远程校验] ${g.groupId}-${band} 请求错误:`, err);
                return { ok: false, error: err };
              }),
          );
        }
      });
    });

    console.log(
      "[远程校验] 待校验项数量:",
      requests.length,
      "meta:",
      itemsMeta,
    );
    if (!requests.length) return []; // 没有可校验的项
    const results = await Promise.all(requests);
    const failed = [];
    results.forEach((r, idx) => {
      const meta = itemsMeta[idx];
      if (!r || !r.ok) failed.push({ ...meta, status: r && r.status });
    });
    console.log("[远程校验] 失败项:", failed);
    return failed; // 返回失败的分组/通道列表
  };

  applyCalibrationAndProceed = () => {
    console.log("点击重建并校准");
    // 校验：各组的反射率和多边形为必填
    if (!this.validateCalibration()) {
      // 显示错误提示（依靠行内红色文字与红色边框），阻止继续
      return;
    }
    console.log("本地校验通过，继续校验远程");
    // 本地校验通过后，进行远程校验
    this.remoteValidateRadiometric()
      .then((failedList) => {
        if (Array.isArray(failedList) && failedList.length > 0) {
          // 远程校验失败：在对应表单下方提示并标红，逻辑与本地校验一致
          this.setState((prev) => {
            const nextErrors = { ...(prev.calibrationErrors || {}) };
            failedList.forEach(({ groupId, band }) => {
              const prevBandErr =
                nextErrors[groupId] && nextErrors[groupId][band]
                  ? nextErrors[groupId][band]
                  : {
                      valMissing: false,
                      valInvalid: false,
                      polyMissing: false,
                    };
              nextErrors[groupId] = {
                ...(nextErrors[groupId] || {}),
                [band]: { ...prevBandErr, remoteInvalid: true },
              };
            });
            // 将焦点切到第一个失败分组
            const first = failedList[0];
            const groups = prev.calibrationGroups || [];
            const idx = groups.findIndex(
              (x) => x.groupId === (first && first.groupId),
            );
            if (idx >= 0) {
              return { calibrationErrors: nextErrors, activeGroupIndex: idx };
            }
            return { calibrationErrors: nextErrors };
          });
          // 弹出统一提示（同时行内也会标红）
          // alert('标定框选区域无效，请重新调整多边形框选区域');
          return; // 阻止继续
        }
        console.log("[远程校验] 全部通过，继续重建任务");
        const data = {
          tifPath: this.state.calibrationTifPath,
          polygon: this.state.calibrationPolygonPoints,
          calibrationFolder: this.state.calibrationFolderPath,
          groups: this.state.calibrationGroups,
          values: this.state.calibrationValues,
        };
        // 关闭弹窗并继续，也需要取消所有在途的转换/加载，避免旧回调继续执行
        this._cancelOps = true;
        try {
          if (this._activeXhrs && this._activeXhrs.size) {
            this._activeXhrs.forEach((xhr) => {
              try {
                xhr.abort();
              } catch (e) {}
            });
            this._activeXhrs.clear();
          }
        } catch (e) {
          console.warn("中断加载请求失败:", e);
        }
        this.setState(
          {
            calibrationData: data,
            showCalibrationModal: false,
            tifCacheLoading: false,
            bandLoading: false,
            calibrationTifLoading: false,
          },
          () => {
            if (this.state.selectedTypes.includes("multispectral")) {
              this.openQuadratModal();
            } else {
              this.prepareTaskCreation();
            }
          },
        );
      })
      .catch(() => {
        // alert('标定框选区域无效，请重新调整多边形框选区域');
        // 远程校验失败时，不关闭弹窗，不继续处理
      });
  };

  createModal = (content) => {
    const modalOverlay = React.createElement(
      "div",
      {
        style: {
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0,0,0,0.5)",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      },
      content,
    );

    return modalOverlay;
  };

  render() {
    const {
      processing,
      showLoading,
      showTaskPanel,
      showTypeSelection,
      selectedTypes,
      folderName,
      currentTaskType,
    } = this.state;
    const currentFiles = this.getCurrentFiles();
    const currentTaskName = this.getCurrentTaskName();

    return React.createElement("div", { style: { display: "inline-block" } }, [
      // 主按钮
      React.createElement(
        "button",
        {
          key: "button",
          type: "button",
          className: "btn btn-sm btn-warning",
          style: {
            marginLeft: "10px",
          },

          onClick: this.handleNewTask,
          disabled: processing,
        },
        [
          React.createElement("i", { key: "icon", className: "fa fa-plus" }),
          React.createElement(
            "span",
            {
              key: "text",
              className: "hidden-xs",
            },
            processing ? " 处理中..." : " 新建分析任务",
          ),
        ],
      ),

      // 大数据量确认弹窗
      this.state.showLargeTifConfirm
        ? this.createModal(
            React.createElement(
              "div",
              {
                key: "large-tif-confirm",
                style: {
                  background: "white",
                  borderRadius: "8px",
                  padding: "20px",
                  width: "520px",
                },
              },
              [
                React.createElement(
                  "div",
                  {
                    key: "title",
                    style: {
                      fontSize: "16px",
                      fontWeight: 600,
                      marginBottom: "12px",
                    },
                  },
                  "待标定数据过大，请确认是否选择正确",
                ),
                React.createElement(
                  "div",
                  {
                    key: "desc",
                    style: { color: "#555", marginBottom: "16px" },
                  },
                  `检测到 ${this.state.largeTifCount || 0} 个 TIF 文件`,
                ),
                React.createElement(
                  "div",
                  {
                    key: "actions",
                    style: {
                      display: "flex",
                      gap: "8px",
                      justifyContent: "flex-end",
                    },
                  },
                  [
                    React.createElement(
                      "button",
                      {
                        key: "reselect",
                        className: "btn btn-sm btn-default",
                        onClick: this.handleLargeTifReselect,
                      },
                      "重新选择",
                    ),
                    React.createElement(
                      "button",
                      {
                        key: "continue",
                        className: "btn btn-sm btn-primary",
                        onClick: this.handleLargeTifContinue,
                      },
                      "继续标定",
                    ),
                  ],
                ),
              ],
            ),
          )
        : null,

      // 标定弹窗
      this.state.showCalibrationModal && !this.state.showLargeTifConfirm
        ? this.createModal(
            React.createElement(
              "div",
              {
                key: "calibration-modal",
                style: {
                  background: "white",
                  borderRadius: "8px",
                  padding: "20px",
                  width: "90vw",
                  height: "84vh",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  zIndex: 100000,
                },
              },
              [
                // 标题区域
                React.createElement(
                  "div",
                  {
                    key: "calib-header",
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "12px",
                    },
                  },
                  [
                    React.createElement(
                      "div",
                      {
                        key: "title-left",
                        style: { fontSize: "18px", fontWeight: 600 },
                      },
                      `辐射校准：${this.state.folderName || ""}`,
                    ),
                    React.createElement(
                      "button",
                      {
                        key: "close",
                        className: "btn btn-sm btn-link",
                        onClick: this.handleCloseCalibrationModal,
                      },
                      "关闭",
                    ),
                  ],
                ),

                // 内容区域：左右布局
                React.createElement(
                  "div",
                  {
                    key: "calib-body",
                    style: {
                      display: "flex",
                      gap: "16px",
                      flex: 1,
                      minHeight: 0,
                    },
                  },
                  [
                    // 左侧：多边形绘制（不再单独上传TIF，通过右侧点击通道进行渲染）
                    React.createElement(
                      "div",
                      {
                        key: "left",
                        style: {
                          flex: "1 1 auto",
                          minWidth: "0",
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                          position: "relative",
                        },
                      },
                      [
                        React.createElement(
                          "div",
                          {
                            key: "left-title",
                            style: { fontWeight: 600, marginBottom: "8px" },
                          },
                          "标定板TIF多边形绘制",
                        ),
                        React.createElement(
                          "div",
                          {
                            key: "left-info",
                            style: { color: "#666", marginBottom: "8px" },
                          },
                          this.state.calibrationTifPath
                            ? `当前查看：标定板 ${(this.state.activeGroupIndex || 0) + 1}` +
                                ` / ${this.state.currentCalibrationSelection?.band || "-"}`
                            : "请在右侧选择分组中的通道以显示TIF",
                        ),
                        React.createElement(
                          "div",
                          {
                            key: "canvas-container",
                            style: {
                              border: "1px solid #ddd",
                              borderRadius: "4px",
                              background: "#fafafa",
                              position: "relative",
                              overflow: "hidden",
                              flex: "1 1 auto",
                              minHeight: "300px",
                            },
                          },
                          [
                            React.createElement("canvas", {
                              key: "calib-canvas",
                              className: "calibration-canvas",
                              ref: this.calibrationCanvasRef,
                            }),
                            // 绘制引导提示
                            this.state.showDrawingTip
                              ? React.createElement(
                                  "div",
                                  {
                                    key: "draw-tip",
                                    style: {
                                      position: "absolute",
                                      left: "50%",
                                      transform: "translateX(-50%)",
                                      top: "10px",
                                      background: "rgba(0,0,0,0.6)",
                                      color: "#fff",
                                      padding: "6px 10px",
                                      borderRadius: "4px",
                                      fontSize: "12px",
                                      zIndex: 1000,
                                      pointerEvents: "none",
                                    },
                                  },
                                  "请用鼠标左键点击进行绘制，双击或点击第一个点可以完成绘制",
                                )
                              : null,
                            // 重新绘制按钮（仅在创建完成后显示），定位于右下角
                            this.state.polygonCommitted
                              ? React.createElement(
                                  "button",
                                  {
                                    key: "redraw-btn",
                                    className: "btn btn-xs btn-primary",
                                    style: {
                                      position: "absolute",
                                      right: "10px",
                                      bottom: "10px",
                                    },
                                    onClick: this.handleReDrawDefect,
                                  },
                                  "缺陷重新绘制",
                                )
                              : null,
                            !this.state.calibrationTifDataUrl &&
                            this.state.calibrationTifLoading
                              ? React.createElement(
                                  "div",
                                  {
                                    key: "loading",
                                    style: {
                                      position: "absolute",
                                      inset: 0,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: "#666",
                                    },
                                  },
                                  "正在加载TIFF...",
                                )
                              : null,
                          ],
                        ),
                        React.createElement(
                          "div",
                          {
                            key: "ops-tip",
                            style: {
                              marginTop: "8px",
                              fontSize: "12px",
                              color: "#555",
                            },
                          },
                          [
                            React.createElement(
                              "div",
                              { key: "op1" },
                              "1. 按住鼠标右键并拖动;",
                            ),
                            React.createElement(
                              "div",
                              { key: "op2" },
                              "2. 使用鼠标滚轮进行缩放;",
                            ),
                          ],
                        ),
                        // 未选择文件夹时的左侧占位提示（居中大字）
                        !this.state.calibrationFolderPath
                          ? React.createElement(
                              "div",
                              {
                                key: "left-placeholder",
                                style: {
                                  position: "absolute",
                                  inset: 0,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: "20px",
                                  fontWeight: 600,
                                  color: "#495057",
                                  background: "#fff",
                                  zIndex: 5,
                                },
                              },
                              "请选择标定板后进行操作",
                            )
                          : null,
                        // 左侧loading覆盖层（预加载或通道转换时）
                        this.state.tifCacheLoading || this.state.bandLoading
                          ? React.createElement(
                              "div",
                              {
                                key: "left-loading-overlay",
                                style: {
                                  position: "absolute",
                                  inset: 0,
                                  background: "rgba(255,255,255,0.6)",
                                  zIndex: 10,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#333",
                                  fontSize: "14px",
                                },
                              },
                              this.state.tifCacheLoading
                                ? `正在加载TIF... ${this.state.tifCacheProgress || 0}%`
                                : "正在加载通道...",
                            )
                          : null,
                      ],
                    ),

                    // 右侧：辐射校正与分组（Tab）
                    React.createElement(
                      "div",
                      {
                        key: "right",
                        style: {
                          width: "420px",
                          display: "flex",
                          flexDirection: "column",
                          height: "100%",
                          position: "relative",
                        },
                      },
                      [
                        React.createElement(
                          "div",
                          {
                            key: "right-title",
                            style: {
                              fontWeight: 600,
                              marginBottom: "16px",
                              color: "#333",
                            },
                          },
                          "辐射校正",
                        ),

                        // 未选择文件夹时显示大卡片选择按钮
                        !this.state.calibrationFolderPath
                          ? React.createElement(
                              "div",
                              {
                                key: "folder-selection-card",
                                style: {
                                  flex: 1,
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background:
                                    "linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)",
                                  border: "2px dashed #dee2e6",
                                  borderRadius: "12px",
                                  padding: "40px 20px",
                                  cursor: "pointer",
                                  transition: "all 0.3s ease",
                                  ":hover": {
                                    borderColor: "#007bff",
                                    background:
                                      "linear-gradient(135deg, #f0f8ff 0%, #e6f3ff 100%)",
                                  },
                                },
                                onClick: this.selectCalibrationFolder,
                              },
                              [
                                React.createElement(
                                  "div",
                                  {
                                    key: "icon",
                                    style: {
                                      fontSize: "48px",
                                      color: "#6c757d",
                                      marginBottom: "16px",
                                    },
                                  },
                                  "📁",
                                ),
                                React.createElement(
                                  "div",
                                  {
                                    key: "title",
                                    style: {
                                      fontSize: "18px",
                                      fontWeight: "600",
                                      color: "#495057",
                                      marginBottom: "8px",
                                    },
                                  },
                                  "选择标定文件夹",
                                ),
                                React.createElement(
                                  "div",
                                  {
                                    key: "subtitle",
                                    style: {
                                      fontSize: "14px",
                                      color: "#6c757d",
                                      textAlign: "center",
                                      lineHeight: "1.5",
                                      marginBottom: "20px",
                                    },
                                  },
                                  "点击选择包含标定板TIF文件的文件夹",
                                ),
                                React.createElement(
                                  "div",
                                  {
                                    key: "tip",
                                    style: {
                                      fontSize: "12px",
                                      color: "#be7611ff",
                                      textAlign: "center",
                                      lineHeight: "1.4",
                                      padding: "12px 16px",
                                    },
                                  },
                                  "如需辐射校正请选择标定板进行标定，否则可以跳过",
                                ),
                              ],
                            )
                          : React.createElement(
                              "div",
                              {
                                key: "folder-actions",
                                style: {
                                  display: "flex",
                                  gap: "8px",
                                  alignItems: "center",
                                  marginBottom: "8px",
                                },
                              },
                              [
                                React.createElement(
                                  "button",
                                  {
                                    key: "select-folder",
                                    className: "btn btn-sm btn-primary",
                                    onClick: this.selectCalibrationFolder,
                                  },
                                  "重新选择",
                                ),
                                React.createElement(
                                  "span",
                                  {
                                    key: "folder-path",
                                    style: {
                                      color: "#666",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      maxWidth: "320px",
                                    },
                                  },
                                  this.state.calibrationFolderPath,
                                ),
                              ],
                            ),
                        React.createElement(
                          "div",
                          {
                            key: "tabbar",
                            style: {
                              display: "flex",
                              gap: "8px",
                              borderBottom: "1px solid #e9ecef",
                              paddingBottom: "8px",
                              marginBottom: "16px",
                            },
                          },
                          (this.state.calibrationGroups || []).length === 0
                            ? React.createElement(
                                "div",
                                {
                                  key: "nogroups",
                                  style: { color: "#6c757d", fontSize: "12px" },
                                },
                                "未检测到可用分组（需选择含TIF的文件夹）",
                              )
                            : (this.state.calibrationGroups || []).map((g, i) =>
                                React.createElement(
                                  "div",
                                  {
                                    key: "tab-" + g.groupId,
                                    onClick: () =>
                                      this.setState({ activeGroupIndex: i }),
                                    style: {
                                      padding: "8px 12px",
                                      borderRadius: "6px",
                                      cursor: "pointer",
                                      background:
                                        this.state.activeGroupIndex === i
                                          ? "#007bff"
                                          : "#f8f9fa",
                                      color:
                                        this.state.activeGroupIndex === i
                                          ? "#fff"
                                          : "#495057",
                                      fontSize: "13px",
                                      fontWeight:
                                        this.state.activeGroupIndex === i
                                          ? "600"
                                          : "400",
                                      border:
                                        this.state.activeGroupIndex === i
                                          ? "1px solid #007bff"
                                          : "1px solid #dee2e6",
                                      transition: "all 0.2s ease",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                    },
                                  },
                                  [
                                    `标定板${i + 1}`,
                                    React.createElement(
                                      "span",
                                      {
                                        key: "del-" + g.groupId,
                                        title: "删除本分组",
                                        style: {
                                          marginLeft: "auto",
                                          color:
                                            this.state.activeGroupIndex === i
                                              ? "#fff"
                                              : "#dc3545",
                                          borderRadius: "4px",
                                          padding: "0 6px",
                                        },
                                        onClick: (e) => {
                                          e.stopPropagation();
                                          this.handleDeleteGroup(g.groupId);
                                        },
                                      },
                                      "✕",
                                    ),
                                  ],
                                ),
                              ),
                        ),
                        // 面板：显示当前标定板的通道列表（缩略图+系数）
                        React.createElement(
                          "div",
                          {
                            key: "panel",
                            style: { overflowY: "auto", paddingRight: "4px" },
                          },
                          [
                            ...(() => {
                              const groups = this.state.calibrationGroups || [];
                              const idx = this.state.activeGroupIndex || 0;
                              const g = groups[idx];
                              if (!g)
                                return [
                                  React.createElement(
                                    "div",
                                    {
                                      key: "empty",
                                      style: {
                                        color: "#999",
                                        fontSize: "12px",
                                      },
                                    },
                                    "未检测到可用分组（需选择含TIF的文件夹）",
                                  ),
                                ];
                              const bands = this.getCalibrationBands();
                              return bands.map((band) => {
                                const selected =
                                  this.state.currentCalibrationSelection &&
                                  this.state.currentCalibrationSelection
                                    .groupId === g.groupId &&
                                  this.state.currentCalibrationSelection
                                    .band === band;
                                const imgUrl = g.files && g.files[band];
                                const label =
                                  band === "T"
                                    ? "温度"
                                    : band === "G"
                                      ? "绿"
                                      : band === "R"
                                        ? "红"
                                        : band === "RE"
                                          ? "红边"
                                          : "近红外";
                                return React.createElement(
                                  "div",
                                  {
                                    key: `row-${g.groupId}-${band}`,
                                    style: {
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "12px",
                                      marginBottom: "12px",
                                      cursor: imgUrl
                                        ? "pointer"
                                        : "not-allowed",
                                      padding: "12px",
                                      border: selected
                                        ? "2px solid #007bff"
                                        : this.state.calibrationErrors &&
                                            this.state.calibrationErrors[
                                              g.groupId
                                            ] &&
                                            this.state.calibrationErrors[
                                              g.groupId
                                            ][band] &&
                                            (this.state.calibrationErrors[
                                              g.groupId
                                            ][band].polyMissing ||
                                              this.state.calibrationErrors[
                                                g.groupId
                                              ][band].remoteInvalid)
                                          ? "2px solid #dc3545"
                                          : "1px solid #e9ecef",
                                      borderRadius: "8px",
                                      background: selected ? "#f0f8ff" : "#fff",
                                      transition: "all 0.2s ease",
                                      boxShadow: selected
                                        ? "0 2px 8px rgba(0, 123, 255, 0.15)"
                                        : "0 1px 3px rgba(0, 0, 0, 0.1)",
                                    },
                                    onClick: () =>
                                      imgUrl &&
                                      this.handleBandClick(g.groupId, band),
                                  },
                                  [
                                    React.createElement("img", {
                                      key: "thumb",
                                      src:
                                        this.getTifFromCache(imgUrl) ||
                                        imgUrl ||
                                        "",
                                      alt: label,
                                      style: {
                                        width: "72px",
                                        height: "72px",
                                        objectFit: "cover",
                                        background: "#f5f5f5",
                                        borderRadius: "4px",
                                        border: "1px solid #ddd",
                                      },
                                    }),
                                    React.createElement(
                                      "div",
                                      { key: "meta", style: { flex: 1 } },
                                      [
                                        React.createElement(
                                          "div",
                                          {
                                            key: "label",
                                            style: {
                                              color: "#495057",
                                              fontSize: "14px",
                                              fontWeight: "500",
                                              marginBottom: "6px",
                                            },
                                          },
                                          label,
                                        ),
                                        React.createElement("input", {
                                          key: "input",
                                          type: "number",
                                          step: (selectedTypes.includes("thermal-infrared") && !selectedTypes.includes("multispectral")) ? "1" : "0.01",
                                          min: (selectedTypes.includes("thermal-infrared") && !selectedTypes.includes("multispectral")) ? "-40" : "0",
                                          max: (selectedTypes.includes("thermal-infrared") && !selectedTypes.includes("multispectral")) ? "150" : "1",
                                          placeholder: (selectedTypes.includes("thermal-infrared") && !selectedTypes.includes("multispectral")) ? "温度值(°C)" : "反射率系数",
                                          value:
                                            (this.state.calibrationValues[
                                              g.groupId
                                            ] &&
                                              this.state.calibrationValues[
                                                g.groupId
                                              ][band]) ||
                                            "",
                                          onChange: (e) =>
                                            this.handleCalibrationValueChange(
                                              g.groupId,
                                              band,
                                              e.target.value,
                                            ),
                                          className: "form-control",
                                          style: {
                                            width: "100%",
                                            background: "#fff",
                                            color: "#495057",
                                            border:
                                              this.state.calibrationErrors &&
                                              this.state.calibrationErrors[
                                                g.groupId
                                              ] &&
                                              this.state.calibrationErrors[
                                                g.groupId
                                              ][band] &&
                                              (this.state.calibrationErrors[
                                                g.groupId
                                              ][band].valMissing ||
                                                this.state.calibrationErrors[
                                                  g.groupId
                                                ][band].valInvalid)
                                                ? "1px solid #dc3545"
                                                : "1px solid #ced4da",
                                            borderRadius: "4px",
                                            fontSize: "13px",
                                          },
                                        }),
                                        // 错误提示：反射率
                                        this.state.calibrationErrors &&
                                        this.state.calibrationErrors[
                                          g.groupId
                                        ] &&
                                        this.state.calibrationErrors[g.groupId][
                                          band
                                        ] &&
                                        (this.state.calibrationErrors[
                                          g.groupId
                                        ][band].valMissing ||
                                          this.state.calibrationErrors[
                                            g.groupId
                                          ][band].valInvalid)
                                          ? React.createElement(
                                              "div",
                                              {
                                                key: `valerr-${g.groupId}-${band}`,
                                                style: {
                                                  color: "#dc3545",
                                                  fontSize: "12px",
                                                  marginTop: "4px",
                                                },
                                              },
                                              this.state.calibrationErrors[
                                                g.groupId
                                              ][band].valMissing
                                                ? (selectedTypes.includes("thermal-infrared") && !selectedTypes.includes("multispectral") ? "请填写温度值" : "请填写反射率系数")
                                                : (selectedTypes.includes("thermal-infrared") && !selectedTypes.includes("multispectral") ? "温度取值需在-40~150°C之间" : "反射率取值需在0-1之间"),
                                            )
                                          : null,
                                        // 错误提示：多边形
                                        this.state.calibrationErrors &&
                                        this.state.calibrationErrors[
                                          g.groupId
                                        ] &&
                                        this.state.calibrationErrors[g.groupId][
                                          band
                                        ] &&
                                        this.state.calibrationErrors[g.groupId][
                                          band
                                        ].polyMissing
                                          ? React.createElement(
                                              "div",
                                              {
                                                key: `polyerr-${g.groupId}-${band}`,
                                                style: {
                                                  color: "#dc3545",
                                                  fontSize: "12px",
                                                  marginTop: "4px",
                                                },
                                              },
                                              "请在左侧圈定多边形",
                                            )
                                          : null,
                                        this.state.calibrationErrors &&
                                        this.state.calibrationErrors[
                                          g.groupId
                                        ] &&
                                        this.state.calibrationErrors[g.groupId][
                                          band
                                        ] &&
                                        this.state.calibrationErrors[g.groupId][
                                          band
                                        ].remoteInvalid
                                          ? React.createElement(
                                              "div",
                                              {
                                                key: `remoteerr-${g.groupId}-${band}`,
                                                style: {
                                                  color: "#dc3545",
                                                  fontSize: "12px",
                                                  marginTop: "4px",
                                                },
                                              },
                                              "标定框所选区域无法提取有效值，请调整区域/反射率系数",
                                            )
                                          : null,
                                      ],
                                    ),
                                  ],
                                );
                              });
                            })(),
                          ],
                        ),
                        this.state.tifCacheLoading || this.state.bandLoading
                          ? React.createElement(
                              "div",
                              {
                                key: "right-loading-overlay",
                                style: {
                                  position: "absolute",
                                  inset: 0,
                                  background: "rgba(255,255,255,0.6)",
                                  zIndex: 10,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#333",
                                  fontSize: "14px",
                                },
                              },
                              this.state.tifCacheLoading
                                ? `正在加载TIF... ${this.state.tifCacheProgress || 0}%`
                                : "正在加载通道...",
                            )
                          : null,
                      ],
                    ),
                  ],
                ),

                // 底部操作区
                React.createElement(
                  "div",
                  {
                    key: "footer",
                    style: {
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                      marginTop: "12px",
                    },
                  },
                  [
                    React.createElement(
                      "button",
                      {
                        key: "skip",
                        className: "btn btn-sm btn-default",
                        onClick: this.skipCalibrationAndProceed,
                      },
                      "跳过并重建",
                    ),
                    React.createElement(
                      "button",
                      {
                        key: "apply",
                        className: "btn btn-sm btn-success",
                        onClick: this.applyCalibrationAndProceed,
                      },
                      "重建并校准",
                    ),
                  ],
                ),
              ],
            ),
          )
        : null,

      // 类型选择弹窗
      showTypeSelection
        ? this.createModal(
            React.createElement(
              "div",
              {
                key: "type-selection-modal",
                style: {
                  background: "white",
                  borderRadius: "8px",
                  padding: "30px",
                  minWidth: "400px",
                  zIndex: 999999,
                },
              },
              [
                React.createElement(
                  "h3",
                  {
                    key: "title",
                    style: { marginBottom: "20px", textAlign: "center" },
                  },
                  "目标拼接类型",
                ),
                React.createElement(
                  "div",
                  {
                    key: "options",
                    style: {
                      marginBottom: "20px",
                      display: "flex",
                      gap: "15px",
                    },
                  },
                  [
                    React.createElement(
                      "div",
                      {
                        key: "rgb-card",
                        onClick: () => this.handleTypeChange("rgb"),
                        style: {
                          flex: 1,
                          padding: "15px",
                          border: selectedTypes.includes("rgb")
                            ? "2px solid #007bff"
                            : "2px solid #e0e0e0",
                          borderRadius: "8px",
                          cursor: "pointer",
                          textAlign: "center",
                          backgroundColor: selectedTypes.includes("rgb")
                            ? "#f0f8ff"
                            : "#ffffff",
                          transition: "all 0.3s ease",
                          boxShadow: selectedTypes.includes("rgb")
                            ? "0 2px 8px rgba(0,123,255,0.2)"
                            : "0 1px 3px rgba(0,0,0,0.1)",
                          position: "relative",
                        },
                      },
                      [
                        selectedTypes.includes("rgb")
                          ? React.createElement(
                              "div",
                              {
                                key: "rgb-check",
                                style: {
                                  position: "absolute",
                                  top: "8px",
                                  right: "8px",
                                  width: "20px",
                                  height: "20px",
                                  backgroundColor: "#007bff",
                                  borderRadius: "50%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                },
                              },
                              React.createElement("i", {
                                className: "fa fa-check",
                                style: {
                                  color: "white",
                                  fontSize: "12px",
                                },
                              }),
                            )
                          : null,
                        React.createElement(
                          "div",
                          {
                            key: "rgb-icon",
                            style: {
                              fontSize: "24px",
                              marginBottom: "8px",
                              color: selectedTypes.includes("rgb")
                                ? "#007bff"
                                : "#666",
                            },
                          },
                          "📷",
                        ),
                        React.createElement(
                          "div",
                          {
                            key: "rgb-title",
                            style: {
                              fontWeight: "bold",
                              marginBottom: "4px",
                              color: selectedTypes.includes("rgb")
                                ? "#007bff"
                                : "#333",
                            },
                          },
                          "RGB数据",
                        ),
                        React.createElement(
                          "div",
                          {
                            key: "rgb-desc",
                            style: {
                              fontSize: "12px",
                              color: "#666",
                            },
                          },
                          "JPG格式",
                        ),
                      ],
                    ),
                    React.createElement(
                      "div",
                      {
                        key: "multispectral-card",
                        onClick: () => this.handleTypeChange("multispectral"),
                        style: {
                          flex: 1,
                          padding: "15px",
                          border: selectedTypes.includes("multispectral")
                            ? "2px solid #007bff"
                            : "2px solid #e0e0e0",
                          borderRadius: "8px",
                          cursor: "pointer",
                          textAlign: "center",
                          backgroundColor: selectedTypes.includes(
                            "multispectral",
                          )
                            ? "#f0f8ff"
                            : "#ffffff",
                          transition: "all 0.3s ease",
                          boxShadow: selectedTypes.includes("multispectral")
                            ? "0 2px 8px rgba(0,123,255,0.2)"
                            : "0 1px 3px rgba(0,0,0,0.1)",
                          position: "relative",
                        },
                      },
                      [
                        selectedTypes.includes("multispectral")
                          ? React.createElement(
                              "div",
                              {
                                key: "multispectral-check",
                                style: {
                                  position: "absolute",
                                  top: "8px",
                                  right: "8px",
                                  width: "20px",
                                  height: "20px",
                                  backgroundColor: "#007bff",
                                  borderRadius: "50%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                },
                              },
                              React.createElement("i", {
                                className: "fa fa-check",
                                style: {
                                  color: "white",
                                  fontSize: "12px",
                                },
                              }),
                            )
                          : null,
                        React.createElement(
                          "div",
                          {
                            key: "multispectral-icon",
                            style: {
                              fontSize: "24px",
                              marginBottom: "8px",
                              color: selectedTypes.includes("multispectral")
                                ? "#007bff"
                                : "#666",
                            },
                          },
                          "🌈",
                        ),
                        React.createElement(
                          "div",
                          {
                            key: "multispectral-title",
                            style: {
                              fontWeight: "bold",
                              marginBottom: "4px",
                              color: selectedTypes.includes("multispectral")
                                ? "#007bff"
                                : "#333",
                            },
                          },
                          "多光谱数据",
                        ),
                        React.createElement(
                          "div",
                          {
                            key: "multispectral-desc",
                            style: {
                              fontSize: "12px",
                              color: "#666",
                            },
                          },
                          "TIF格式",
                        ),
                      ],
                    ),
                    React.createElement(
                      "div",
                      {
                        key: "thermal-card",
                        onClick: () =>
                          this.handleTypeChange("thermal-infrared"),
                        style: {
                          flex: 1,
                          padding: "15px",
                          border: selectedTypes.includes("thermal-infrared")
                            ? "2px solid #007bff"
                            : "2px solid #e0e0e0",
                          borderRadius: "8px",
                          cursor: "pointer",
                          textAlign: "center",
                          backgroundColor: selectedTypes.includes(
                            "thermal-infrared",
                          )
                            ? "#f0f8ff"
                            : "#ffffff",
                          transition: "all 0.3s ease",
                          boxShadow: selectedTypes.includes("thermal-infrared")
                            ? "0 2px 8px rgba(0,123,255,0.2)"
                            : "0 1px 3px rgba(0,0,0,0.1)",
                          position: "relative",
                        },
                      },
                      [
                        selectedTypes.includes("thermal-infrared")
                          ? React.createElement(
                              "div",
                              {
                                key: "thermal-check",
                                style: {
                                  position: "absolute",
                                  top: "8px",
                                  right: "8px",
                                  width: "20px",
                                  height: "20px",
                                  backgroundColor: "#007bff",
                                  borderRadius: "50%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                },
                              },
                              React.createElement("i", {
                                className: "fa fa-check",
                                style: {
                                  color: "white",
                                  fontSize: "12px",
                                },
                              }),
                            )
                          : null,
                        React.createElement(
                          "div",
                          {
                            key: "thermal-icon",
                            style: {
                              fontSize: "24px",
                              marginBottom: "8px",
                              color: selectedTypes.includes("thermal-infrared")
                                ? "#007bff"
                                : "#666",
                            },
                          },
                          "\uD83C\uDF21\uFE0F",
                        ),
                        React.createElement(
                          "div",
                          {
                            key: "thermal-title",
                            style: {
                              fontWeight: "bold",
                              marginBottom: "4px",
                              color: selectedTypes.includes("thermal-infrared")
                                ? "#007bff"
                                : "#333",
                            },
                          },
                          "\u70ED\u7EA2\u5916\u6570\u636E",
                        ),
                        React.createElement(
                          "div",
                          {
                            key: "thermal-desc",
                            style: {
                              fontSize: "12px",
                              color: "#666",
                            },
                          },
                          "TIF\u683C\u5F0F",
                        ),
                      ],
                    ),
                  ],
                ),
                React.createElement(
                  "div",
                  {
                    key: "tips",
                    style: {
                      marginBottom: "20px",
                      padding: "15px",
                      backgroundColor: "#f8f9fa",
                      borderRadius: "6px",
                      fontSize: "13px",
                      lineHeight: "1.6",
                      color: "#666",
                      width: 800,
                    },
                  },
                  [
                    React.createElement(
                      "div",
                      {
                        key: "tip-title",
                        style: {
                          fontWeight: "bold",
                          marginBottom: "8px",
                          color: "#333",
                        },
                      },
                      "使用说明：",
                    ),
                    React.createElement(
                      "div",
                      {
                        key: "tip1",
                        style: { marginBottom: "6px" },
                      },
                      "1. 目标类型支持多选，如果多选程序将会自动创建RGB+多光谱+热红外多个拼接任务；",
                    ),
                    React.createElement(
                      "div",
                      {
                        key: "tip2",
                        style: { marginBottom: "6px" },
                      },
                      "2. 选中文件夹后程序将自动把选中文件夹内(含子文件夹)JPG格式图片、TIF格式图片分别归类到RGB拼接任务、多光谱拼接任务；",
                    ),
                    React.createElement(
                      "div",
                      {
                        key: "tip3",
                      },
                      "3. 任务名称跟采样日期通过识别选中文件夹的名称自动生成，文件夹命名规范如：DJI_202506110941_001_大疆智慧农业平台_地块名xxxx，202506110941将转换为采样日期：2025-06-11, 地块名xxxx将自动拼接后缀_RGB/多光谱作为任务名；",
                    ),
                  ],
                ),
                React.createElement(
                  "div",
                  {
                    key: "buttons",
                    style: { textAlign: "right" },
                  },
                  [
                    React.createElement(
                      "button",
                      {
                        key: "cancel",
                        type: "button",
                        className: "btn btn-default",
                        onClick: this.handleTypeSelectionCancel,
                        style: { marginRight: 10 },
                      },
                      "取消",
                    ),
                    React.createElement(
                      "button",
                      {
                        key: "confirm",
                        type: "button",
                        className: "btn btn-primary",
                        onClick: this.handleTypeSelectionConfirm,
                      },
                      "确定",
                    ),
                  ],
                ),
              ],
            ),
          )
        : null,

      // Loading弹窗
      showLoading
        ? this.createModal(
            React.createElement(
              "div",
              {
                key: "loading-modal",
                style: {
                  background: "white",
                  borderRadius: "8px",
                  padding: "30px",
                  textAlign: "center",
                  minWidth: "300px",
                  zIndex: 999999,
                },
              },
              [
                React.createElement(
                  "div",
                  {
                    key: "spinner",
                    style: {
                      fontSize: "24px",
                      marginBottom: "15px",
                    },
                  },
                  React.createElement("i", {
                    className: "fa fa-spinner fa-spin",
                  }),
                ),
                React.createElement(
                  "h4",
                  {
                    key: "title",
                    style: { marginBottom: "10px" },
                  },
                  "文件分析中...",
                ),
                React.createElement(
                  "p",
                  {
                    key: "folder",
                    style: { color: "#666" },
                  },
                  `正在分析文件夹: ${folderName}`,
                ),
                React.createElement(
                  "button",
                  {
                    key: "cancel",
                    type: "button",
                    className: "btn btn-default btn-sm",
                    onClick: this.handleCloseLoading,
                    style: { marginTop: "15px" },
                  },
                  "取消",
                ),
              ],
            ),
          )
        : null,

      // 样方弹窗（仅多光谱，标定完成后）
      this.state.showQuadratModal
        ? this.createModal(
            React.createElement(
              "div",
              {
                key: "quadrat-modal",
                style: {
                  background: "white",
                  borderRadius: "8px",
                  padding: "24px",
                  width: "480px",
                  zIndex: 100000,
                },
              },
              [
                // 标题
                React.createElement(
                  "div",
                  {
                    key: "quadrat-title",
                    style: {
                      fontSize: "16px",
                      fontWeight: 600,
                      marginBottom: "20px",
                    },
                  },
                  "上传样方文件夹（可选）",
                ),

                // 选择文件夹
                React.createElement(
                  "div",
                  {
                    key: "quadrat-folder-row",
                    style: { marginBottom: "16px" },
                  },
                  [
                    React.createElement(
                      "label",
                      {
                        key: "folder-label",
                        style: {
                          display: "block",
                          fontWeight: 500,
                          marginBottom: "6px",
                        },
                      },
                      "样方文件夹",
                    ),
                    React.createElement(
                      "div",
                      {
                        key: "folder-input-row",
                        style: {
                          display: "flex",
                          gap: "8px",
                          alignItems: "center",
                        },
                      },
                      [
                        React.createElement("input", {
                          key: "folder-path-display",
                          type: "text",
                          className: "form-control input-sm",
                          readOnly: true,
                          placeholder: "未选择文件夹",
                          value: this.state.quadratFolderPath,
                          style: { flex: 1 },
                        }),
                        React.createElement(
                          "button",
                          {
                            key: "folder-select-btn",
                            type: "button",
                            className: "btn btn-sm btn-default",
                            onClick: this.selectQuadratFolder,
                          },
                          "选择文件夹",
                        ),
                      ],
                    ),
                  ],
                ),

                // 样方大小
                React.createElement(
                  "div",
                  { key: "quadrat-size-row", style: { marginBottom: "24px" } },
                  [
                    React.createElement(
                      "label",
                      {
                        key: "geometry-type-label",
                        style: {
                          display: "block",
                          fontWeight: 500,
                          marginBottom: "6px",
                        },
                      },
                      "几何类型",
                    ),
                    React.createElement(
                      "select",
                      {
                        key: "geometry-type-select",
                        className: "form-control input-sm",
                        value: this.state.quadratGeometryType,
                        onChange: (e) =>
                          this.setState({
                            quadratGeometryType: e.target.value,
                          }),
                        style: { width: "100%", marginBottom: "12px" },
                      },
                      [
                        React.createElement(
                          "option",
                          { key: "square", value: "square" },
                          "方形",
                        ),
                        React.createElement(
                          "option",
                          { key: "circle", value: "circle" },
                          "圆形",
                        ),
                      ],
                    ),
                    React.createElement(
                      "label",
                      {
                        key: "size-label",
                        style: {
                          display: "block",
                          fontWeight: 500,
                          marginBottom: "6px",
                        },
                      },
                      "样方尺寸 (cm)",
                    ),
                    React.createElement("input", {
                      key: "size-input",
                      type: "number",
                      className: "form-control input-sm",
                      placeholder: "请输入样方尺寸，单位：厘米",
                      min: "0",
                      step: "0.1",
                      value: this.state.quadratSize,
                      onChange: (e) =>
                        this.setState({ quadratSize: e.target.value }),
                      style: { width: "100%" },
                    }),
                  ],
                ),

                // 操作按钮
                React.createElement(
                  "div",
                  {
                    key: "quadrat-footer",
                    style: {
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                    },
                  },
                  [
                    React.createElement(
                      "button",
                      {
                        key: "skip",
                        type: "button",
                        className: "btn btn-sm btn-default",
                        onClick: this.skipQuadratAndProceed,
                      },
                      "跳过",
                    ),
                    React.createElement(
                      "button",
                      {
                        key: "confirm",
                        type: "button",
                        className: "btn btn-sm btn-primary",
                        onClick: this.confirmQuadratAndProceed,
                      },
                      "确认",
                    ),
                  ],
                ),
              ],
            ),
          )
        : null,

      // NewTaskPanel弹窗
      showTaskPanel
        ? this.createModal(
            React.createElement(
              "div",
              {
                key: "task-panel-modal",
                style: {
                  background: "white",
                  borderRadius: "8px",
                  padding: "20px",
                  maxWidth: "800px",
                  maxHeight: "80vh",
                  overflow: "auto",
                  width: "90%",
                  zIndex: 999999,
                },
              },
              [
                React.createElement(
                  "div",
                  {
                    key: "task-info",
                    style: {
                      background: "#f0f8ff",
                      padding: "10px",
                      borderRadius: "4px",
                      marginBottom: "15px",
                      textAlign: "center",
                    },
                  },
                  `正在创建${currentTaskType === "rgb" ? "RGB" : "多光谱"}任务`,
                ),
                React.createElement(NewTaskPanel, {
                  key: `new-task-panel-${currentTaskType}`,
                  onSave: this.handleTaskSave,
                  onCancel: this.handleTaskCancel,
                  suggestedTaskName: (hasGPSCallback) => {
                    return Promise.resolve(currentTaskName);
                  },
                  filesCount: currentFiles.length,
                  showResize: true,
                  showAlign: false,
                  isFileFolder: true,
                  projectId: this.props.projectId,
                  getFilesRaw: () => {
                    // 返回文件夹路径信息，让NewTaskPanel处理文件获取
                    return {
                      folderPath: this.state.folderFullPath,
                      taskType: this.state.currentTaskType,
                    };
                  },
                }),
              ],
            ),
          )
        : null,
    ]);
  }
}

export default NewTaskButton;
