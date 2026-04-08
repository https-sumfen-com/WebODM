// ============================================================
// 统一 IP / 端口配置 —— 修改 HOST 即可切换所有地址
// ============================================================
let isDev = false;
window.SFPRO_CONFIG =
  window.SFPRO_CONFIG ||
  (function () {
    const HOST = isDev ? "192.168.3.249" : "localhost";
    return {
      HOST,
      WEBODM_URL: "http://" + HOST + ":8000",
      ODM_API_URL: "http://" + HOST + ":7700",
      RAW_API_URL: "http://" + HOST + ":5555",
      DEVICE_API_URL: "http://" + HOST + ":5000",
    };
  })();

// 全局上传任务管理器 - 确保只初始化一次
if (!window.FolderUploadTaskManager) {
  window.FolderUploadTaskManager = {
    tasks: [],
    listeners: [],

    addTask: function (task) {
      this.tasks.push(task);
      this.notifyListeners();
    },

    removeTask: function (taskId) {
      this.tasks = this.tasks.filter((t) => t.id !== taskId);
      this.notifyListeners();
    },

    updateTask: function (taskId, updates) {
      const taskIndex = this.tasks.findIndex((t) => t.id === taskId);
      if (taskIndex !== -1) {
        this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...updates };
        this.notifyListeners();
      }
    },

    addListener: function (callback) {
      this.listeners.push(callback);
    },

    removeListener: function (callback) {
      this.listeners = this.listeners.filter((l) => l !== callback);
    },

    notifyListeners: function () {
      this.listeners.forEach((callback) => callback(this.tasks));
    },
  };
}

// 注册NewTaskButton组件
PluginsAPI.Dashboard.addNewTaskButton(
  ["folderupload/build/NewTaskButton.js"],
  function (args, NewTaskButton) {
    return React.createElement(NewTaskButton, {
      onNewTaskAdded: args.onNewTaskAdded,
      projectId: args.projectId,
      taskManager: window.FolderUploadTaskManager,
    });
  },
);
// 检查是否存在上传记录的函数
const checkUploadRecord = async (projectId, taskId) => {
  // 使用全局缓存避免重复API调用
  const cacheKey = `upload_${projectId}_${taskId}`;
  if (window.ODMRecordCache && window.ODMRecordCache[cacheKey] !== undefined) {
    console.log("使用缓存的上传记录:", window.ODMRecordCache[cacheKey]);
    return window.ODMRecordCache[cacheKey];
  }

  try {
    const response = await $.ajax({
      url: window.SFPRO_CONFIG.ODM_API_URL + "/api/odm/get_report_detail",
      type: "GET",
      data: {
        project_id: projectId,
        task_id: taskId,
      },
      dataType: "json",
      timeout: 10000,
    });
    console.log("upload response", response);

    const record = response && (response.data || response);

    // 缓存结果
    if (!window.ODMRecordCache) {
      window.ODMRecordCache = {};
    }
    window.ODMRecordCache[cacheKey] = record;

    return record;
  } catch (error) {
    console.error("检查上传记录失败:", error);

    // 缓存失败结果
    if (!window.ODMRecordCache) {
      window.ODMRecordCache = {};
    }
    window.ODMRecordCache[cacheKey] = null;

    return null;
  }
};

// 注册CloudUploadButton组件
PluginsAPI.Dashboard.addTaskActionButton(
  ["folderupload/build/CloudUploadButton.js"],
  function (args, CloudUploadButton) {
    // 只有当任务状态为完成（40）时才显示按钮
    if (args.task.status !== 40) {
      return null;
    }

    // 创建一个包装组件来处理异步检查并传递record
    class CloudUploadButtonWrapper extends React.Component {
      constructor(props) {
        super(props);
        this.state = {
          record: null,
          isChecking: true,
        };
      }

      componentDidMount() {
        console.log("==================云端按钮=================");
        this.checkRecord();
      }

      async checkRecord() {
        const projectId = args.task.project;
        // TODO 写死测试
        const taskId = args.task.id;

        const record = await checkUploadRecord(projectId, taskId);
        console.log("record", record);
        this.setState({
          record: record,
          isChecking: false,
        });
      }

      render() {
        // 如果正在检查，不显示按钮
        if (this.state.isChecking) {
          return null;
        }

        // 总是渲染CloudUploadButton，让它内部决定显示什么
        return React.createElement(CloudUploadButton, {
          task: args.task,
          record: this.state.record,
          disabled: args.disabled,
          onRefresh: this.props.onRefresh,
        });
      }
    }

    return React.createElement(CloudUploadButtonWrapper, {
      onRefresh: args.onRefresh,
    });
  },
);
