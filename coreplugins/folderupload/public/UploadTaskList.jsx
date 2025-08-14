import React from 'React';
import PropTypes from 'prop-types';
import $ from 'jquery';
import csrf from 'webodm/django/csrf';
import ResizeModes from 'webodm/classes/ResizeModes';
import { _, interpolate } from 'webodm/classes/gettext';

class UploadTaskList extends React.Component {
    static propTypes = {
        taskManager: PropTypes.object.isRequired
    }

    constructor(props) {
        super(props);
        this.state = {
            expanded: false,
            tasks: [],
            uploadingTasks: new Map() // taskId -> upload state
        };
        
        // 绑定监听器
        this.handleTasksUpdate = this.handleTasksUpdate.bind(this);
    }
    
    handleTasksUpdate = (tasks) => {
        this.setState({ tasks });
    }

    componentDidMount() {
        // 添加任务更新监听器
        this.props.taskManager.addListener(this.handleTasksUpdate);
        
        // 初始化任务列表
        this.setState({ tasks: this.props.taskManager.tasks });
    }
    
    componentWillUnmount() {
        // 移除监听器
        this.props.taskManager.removeListener(this.handleTasksUpdate);
    }

    componentDidUpdate(prevState) {
        // 检查是否有新任务需要开始上传
        this.state.tasks.forEach(task => {
            if (!this.state.uploadingTasks.has(task.id) && task.status === 'pending') {
                this.startTaskUpload(task);
            }
        });
    }

    startTaskUpload = async (task) => {
        console.log('开始上传任务:', task.name);
        
        // 初始化上传状态
        const uploadState = {
            id: task.id,
            name: task.name,
            type: task.type,
            status: 'creating', // creating, uploading, committing, completed, error
            progress: 0,
            uploadedCount: 0,
            totalCount: task.files.length,
            totalBytes: task.files.reduce((sum, f) => sum + f.size, 0),
            uploadedBytes: 0,
            error: null,
            startTime: Date.now()
        };

        this.setState(prevState => ({
            uploadingTasks: new Map(prevState.uploadingTasks.set(task.id, uploadState))
        }));

        try {
            // 1. 创建任务
            const taskResponse = await this.createTask(task);
            
            this.updateTaskState(task.id, {
                status: 'uploading',
                taskId: taskResponse.id
            });

            // 2. 上传文件
            await this.uploadFiles(task, taskResponse.id);

            this.updateTaskState(task.id, {
                status: 'committing'
            });

            // 3. 提交任务
            await this.commitTask(task.projectId, taskResponse.id);

            this.updateTaskState(task.id, {
                status: 'completed',
                progress: 100
            });

            console.log('任务上传完成:', task.name);
            
            // 从全局任务管理器中移除任务
            this.props.taskManager.removeTask(task.id);
            
            // 触发页面刷新事件（如果有的话）
            const refreshEvent = new CustomEvent('folderUploadTaskComplete', {
                detail: { task, taskResponse }
            });
            document.dispatchEvent(refreshEvent);

        } catch (error) {
            console.error('任务上传失败:', error);
            
            this.updateTaskState(task.id, {
                status: 'error',
                error: error.message || '上传失败1'
            });

            // 更新任务状态为错误
            this.props.taskManager.updateTask(task.id, {
                status: 'error',
                error: error.message || '上传失败'
            });
        }
    }

    createTask = async (task) => {
        const formData = {
            name: task.name,
            options: task.options || [],
            processing_node: task.selectedNode?.id,
            auto_processing_node: task.selectedNode?.key === "auto" || !task.selectedNode,
            partial: true
        };

        if (task.resizeMode === ResizeModes.YES) {
            formData.resize_to = task.resizeSize;
        }

        const response = await $.ajax({
            url: `/api/projects/${task.projectId}/tasks/`,
            contentType: 'application/json',
            data: JSON.stringify(formData),
            dataType: 'json',
            type: 'POST',
            headers: {
                'X-CSRFToken': csrf.token
            }
        });

        return response;
    }

    uploadFiles = async (task, taskId) => {
        const files = task.files;
        let uploadedBytes = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append('images', file);

            await new Promise((resolve, reject) => {
                $.ajax({
                    url: `/api/projects/${task.projectId}/tasks/${taskId}/upload/`,
                    data: formData,
                    processData: false,
                    contentType: false,
                    type: 'POST',
                    headers: {
                        'X-CSRFToken': csrf.token
                    },
                    xhr: () => {
                        const xhr = new XMLHttpRequest();
                        xhr.upload.addEventListener('progress', (e) => {
                            if (e.lengthComputable) {
                                const fileProgress = (e.loaded / e.total) * file.size;
                                const totalProgress = (uploadedBytes + fileProgress) / this.state.uploadingTasks.get(task.id).totalBytes * 100;
                                
                                this.updateTaskState(task.id, {
                                    progress: Math.round(totalProgress),
                                    uploadedBytes: uploadedBytes + e.loaded
                                });
                            }
                        });
                        return xhr;
                    }
                }).done(() => {
                    uploadedBytes += file.size;
                    this.updateTaskState(task.id, {
                        uploadedCount: i + 1,
                        uploadedBytes: uploadedBytes
                    });
                    resolve();
                }).fail(reject);
            });
        }
    }

    commitTask = async (projectId, taskId) => {
        await $.ajax({
            url: `/api/projects/${projectId}/tasks/${taskId}/commit/`,
            contentType: 'application/json',
            type: 'POST',
            headers: {
                'X-CSRFToken': csrf.token
            }
        });
    }

    updateTaskState = (taskId, updates) => {
        this.setState(prevState => {
            const newMap = new Map(prevState.uploadingTasks);
            const currentState = newMap.get(taskId);
            if (currentState) {
                newMap.set(taskId, { ...currentState, ...updates });
            }
            return { uploadingTasks: newMap };
        });
    }

    toggleExpanded = () => {
        this.setState({ expanded: !this.state.expanded });
    }

    removeTask = (taskId) => {
        // 从本地上传状态中移除
        this.setState(prevState => {
            const newMap = new Map(prevState.uploadingTasks);
            newMap.delete(taskId);
            return { uploadingTasks: newMap };
        });

        // 从全局任务管理器中移除
        this.props.taskManager.removeTask(taskId);
    }

    getStatusText = (status) => {
        switch (status) {
            case 'creating': return '创建任务中...';
            case 'uploading': return '上传中...';
            case 'committing': return '提交中...';
            case 'completed': return '已完成';
            case 'error': return '上传失败';
            default: return '等待中...';
        }
    }

    getStatusIcon = (status) => {
        switch (status) {
            case 'creating':
            case 'uploading':
            case 'committing':
                return 'fa fa-spinner fa-spin';
            case 'completed':
                return 'fa fa-check-circle text-success';
            case 'error':
                return 'fa fa-exclamation-circle text-danger';
            default:
                return 'fa fa-clock-o';
        }
    }

    formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatDuration = (ms) => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
        } else if (minutes > 0) {
            return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
        } else {
            return `${seconds}s`;
        }
    }

    render() {
        const { expanded, tasks, uploadingTasks } = this.state;
        const uploadingTasksList = Array.from(uploadingTasks.values());
        const activeTasks = uploadingTasksList.filter(t => t.status !== 'completed');
        const completedTasks = uploadingTasksList.filter(t => t.status === 'completed');
        
        return React.createElement('div', {
            className: `upload-task-list ${expanded ? 'expanded' : 'collapsed'}`,
            style: {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: 1000,
                backgroundColor: 'white',
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: expanded ? '400px' : '200px',
                maxWidth: '500px',
                maxHeight: expanded ? '600px' : 'auto'
            }
        }, [
            // 标题栏
            React.createElement('div', {
                key: 'header',
                className: 'upload-header',
                style: {
                    padding: '12px 16px',
                    borderBottom: expanded ? '1px solid #eee' : 'none',
                    cursor: 'pointer',
                    backgroundColor: '#f8f9fa',
                    borderRadius: expanded ? '8px 8px 0 0' : '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                },
                onClick: this.toggleExpanded
            }, [
                React.createElement('div', {
                    key: 'title',
                    style: { fontWeight: 'bold', fontSize: '14px' }
                }, `上传任务 (${activeTasks.length})`),
                React.createElement('i', {
                    key: 'toggle-icon',
                    className: `fa fa-chevron-${expanded ? 'down' : 'up'}`,
                    style: { fontSize: '12px', color: '#666' }
                })
            ]),

            // 任务列表
            expanded ? React.createElement('div', {
                key: 'task-list',
                className: 'task-list',
                style: {
                    maxHeight: '500px',
                    overflowY: 'auto',
                    padding: '8px'
                }
            }, [
                // 活跃任务
                ...activeTasks.map(task => 
                    React.createElement('div', {
                        key: task.id,
                        className: 'task-item',
                        style: {
                            padding: '12px',
                            marginBottom: '8px',
                            border: '1px solid #eee',
                            borderRadius: '6px',
                            backgroundColor: task.status === 'error' ? '#fff5f5' : '#f9f9f9'
                        }
                    }, [
                        React.createElement('div', {
                            key: 'task-header',
                            style: {
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: '8px'
                            }
                        }, [
                            React.createElement('div', {
                                key: 'task-info',
                                style: { flex: 1 }
                            }, [
                                React.createElement('div', {
                                    key: 'name',
                                    style: { fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' }
                                }, task.name),
                                React.createElement('div', {
                                    key: 'type',
                                    style: { fontSize: '11px', color: '#666' }
                                }, `${task.type === 'rgb' ? 'RGB' : '多光谱'} • ${task.totalCount} 文件`)
                            ]),
                            React.createElement('div', {
                                key: 'status',
                                style: { display: 'flex', alignItems: 'center' }
                            }, [
                                React.createElement('i', {
                                    key: 'status-icon',
                                    className: this.getStatusIcon(task.status),
                                    style: { marginRight: '6px', fontSize: '12px' }
                                }),
                                React.createElement('span', {
                                    key: 'status-text',
                                    style: { fontSize: '11px' }
                                }, this.getStatusText(task.status))
                            ])
                        ]),

                        // 进度条
                        task.status === 'uploading' ? React.createElement('div', {
                            key: 'progress',
                            style: { marginBottom: '8px' }
                        }, [
                            React.createElement('div', {
                                key: 'progress-bar-container',
                                style: {
                                    width: '100%',
                                    height: '6px',
                                    backgroundColor: '#e9ecef',
                                    borderRadius: '3px',
                                    overflow: 'hidden'
                                }
                            }, [
                                React.createElement('div', {
                                    key: 'progress-bar',
                                    style: {
                                        width: `${task.progress}%`,
                                        height: '100%',
                                        backgroundColor: '#007bff',
                                        transition: 'width 0.3s ease'
                                    }
                                })
                            ]),
                            React.createElement('div', {
                                key: 'progress-text',
                                style: {
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: '10px',
                                    color: '#666',
                                    marginTop: '4px'
                                }
                            }, [
                                React.createElement('span', {
                                    key: 'progress-percent'
                                }, `${task.progress}%`),
                                React.createElement('span', {
                                    key: 'progress-files'
                                }, `${task.uploadedCount}/${task.totalCount}`)
                            ])
                        ]) : null,

                        // 错误信息
                        task.error ? React.createElement('div', {
                            key: 'error',
                            style: {
                                color: '#dc3545',
                                fontSize: '11px',
                                marginTop: '4px'
                            }
                        }, task.error) : null,

                        // 操作按钮
                        task.status === 'error' || task.status === 'completed' ? React.createElement('div', {
                            key: 'actions',
                            style: { textAlign: 'right', marginTop: '8px' }
                        }, [
                            React.createElement('button', {
                                key: 'remove',
                                type: 'button',
                                className: 'btn btn-xs btn-default',
                                onClick: () => this.removeTask(task.id),
                                style: { fontSize: '10px' }
                            }, '移除')
                        ]) : null
                    ])
                ),

                // 已完成任务（折叠显示）
                completedTasks.length > 0 ? React.createElement('div', {
                    key: 'completed-section',
                    style: {
                        marginTop: '12px',
                        paddingTop: '12px',
                        borderTop: '1px solid #eee'
                    }
                }, [
                    React.createElement('div', {
                        key: 'completed-header',
                        style: {
                            fontSize: '12px',
                            color: '#666',
                            marginBottom: '8px',
                            fontWeight: 'bold'
                        }
                    }, `已完成 (${completedTasks.length})`),
                    ...completedTasks.slice(-3).map(task => // 只显示最近3个
                        React.createElement('div', {
                            key: task.id,
                            style: {
                                padding: '8px 12px',
                                marginBottom: '4px',
                                backgroundColor: '#f0f8f0',
                                borderRadius: '4px',
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }
                        }, [
                            React.createElement('span', {
                                key: 'name'
                            }, task.name),
                            React.createElement('i', {
                                key: 'check',
                                className: 'fa fa-check text-success',
                                style: { fontSize: '10px' }
                            })
                        ])
                    )
                ]) : null
            ]) : null
        ]);
    }
}

export default UploadTaskList;