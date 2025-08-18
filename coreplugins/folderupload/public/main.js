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