// 全局上传任务管理器 - 确保只初始化一次
if (!window.FolderUploadTaskManager) {
    window.FolderUploadTaskManager = {
        tasks: [],
        listeners: [],
        
        addTask: function(task) {
            this.tasks.push(task);
            this.notifyListeners();
        },
        
        removeTask: function(taskId) {
            this.tasks = this.tasks.filter(t => t.id !== taskId);
            this.notifyListeners();
        },
        
        updateTask: function(taskId, updates) {
            const taskIndex = this.tasks.findIndex(t => t.id === taskId);
            if (taskIndex !== -1) {
                this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...updates };
                this.notifyListeners();
            }
        },
        
        addListener: function(callback) {
            this.listeners.push(callback);
        },
        
        removeListener: function(callback) {
            this.listeners = this.listeners.filter(l => l !== callback);
        },
        
        notifyListeners: function() {
            this.listeners.forEach(callback => callback(this.tasks));
        }
    };
}

// 注册NewTaskButton组件
PluginsAPI.Dashboard.addNewTaskButton(
    ['folderupload/build/NewTaskButton.js'],
    function(args, NewTaskButton) {
        return React.createElement(NewTaskButton, {
            onNewTaskAdded: args.onNewTaskAdded,
            projectId: args.projectId,
            taskManager: window.FolderUploadTaskManager
        });
    }
);
// 检查是否存在上传记录的函数
const checkUploadRecord = async (projectId, taskId) => {
    try {
        const response = await $.ajax({
            // url: `http://192.168.3.249:7700/api/odm/get_report_detail`,
            url: `http://localhost:7700/api/odm/get_report_detail`,
            type: 'GET',
            data: {
                project_id: projectId,
                task_id: taskId
            },
            dataType: 'json',
            fail: function(xhr, status, error) {
                console.error('检查上传记录失败:', error);
            }
        });
        console.log('response', response);
        return response && (response.data || response);
    } catch (error) {
        console.error('检查上传记录失败:', error);
        return null;
    }
};

// 注册CloudUploadButton组件
PluginsAPI.Dashboard.addTaskActionButton(
    ['folderupload/build/CloudUploadButton.js'],
    function(args, CloudUploadButton) {
        // 只有当任务状态为完成（40）时才显示按钮
        if (args.task.status !== 40) {
            return null;
        }
        
        // 创建一个包装组件来处理异步检查
        class CloudUploadButtonWrapper extends React.Component {
            constructor(props) {
                super(props);
                this.state = {
                    hasUploadRecord: null, // null表示正在检查，true表示有记录，false表示无记录
                    isChecking: true
                };
            }
            
            componentDidMount() {
                this.checkRecord();
            }
            
            async checkRecord() {
                const projectId = args.task.project;
                const taskId = args.task.id;
                
                const record = await checkUploadRecord(projectId, taskId);
                console.log('record', record);
                this.setState({
                    hasUploadRecord: record && record.state !== 'RUNNING' && record.state !== 'COMPLETED',
                    isChecking: false
                });
            }
            
            render() {
                // 如果正在检查，不显示按钮
                if (this.state.isChecking) {
                    return null;
                }
                
                // 如果存在上传记录，不显示按钮
                if (!this.state.hasUploadRecord) {
                    return null;
                }
                
                // 如果没有上传记录，显示按钮
                return React.createElement(CloudUploadButton, {
                    task: args.task,
                    disabled: args.disabled,
                    onRefresh: this.props.onRefresh
                });
            }
        }
        
        return React.createElement(CloudUploadButtonWrapper, {
            onRefresh: args.onRefresh
        });
    }
);