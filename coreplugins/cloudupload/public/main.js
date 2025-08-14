PluginsAPI.Dashboard.addTaskActionButton(
    ['cloudupload/build/CloudUploadButton.js'],
    function(args, CloudUploadButton) {
        // 只有当任务状态为完成（40）时才显示按钮
        if (args.task.status !== 40) {
            return null;
        }
        
        return React.createElement(CloudUploadButton, {
            task: args.task,
            disabled: args.disabled
        });
    }
);