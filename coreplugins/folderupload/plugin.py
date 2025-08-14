from app.plugins import PluginBase, MountPoint
from django.http import HttpResponse
from django.template.loader import render_to_string

class Plugin(PluginBase):
    def include_js_files(self):
        return ['main.js', 'load_task_list.js']
    
    def build_jsx_components(self):
        return ['NewTaskButton.jsx', 'UploadTaskList.jsx']
    
    def app_mount_points(self):
        return [
            MountPoint('load_task_list.js$', self.load_task_list_view)
        ]
    
    def load_task_list_view(self, request):
        """动态生成load_task_list.js文件"""
        js_content = """
// 使用PluginsAPI方式初始化全局上传任务列表组件
PluginsAPI.Dashboard.addNewTaskButton([
    'folderupload/build/UploadTaskList.js'
], function(args, UploadTaskList) {
    // 确保只初始化一次
    if (!window.FolderUploadTaskListInitialized) {
        window.FolderUploadTaskListInitialized = true;
        
        // 创建容器
        const container = document.createElement('div');
        container.id = 'folder-upload-task-list-container';
        document.body.appendChild(container);
        
        // 渲染组件
        ReactDOM.render(
            React.createElement(UploadTaskList, {
                taskManager: window.FolderUploadTaskManager
            }),
            container
        );
        
        console.log('FolderUpload TaskList initialized');
    }
    
    // 返回null，因为这不是真正的按钮
    return null;
});
        """
        
        response = HttpResponse(js_content, content_type='application/javascript')
        return response