import React from 'React';
import PropTypes from 'prop-types';
import $ from 'jquery';
import csrf from 'webodm/django/csrf';
import ResizeModes from 'webodm/classes/ResizeModes';
import { _, interpolate } from 'webodm/classes/gettext';

class UploadTaskList extends React.Component {
    static propTypes = {
        taskManager: PropTypes.object.isRequired,
        onNewTaskAdded: PropTypes.func
    }

    constructor(props) {
        super(props);
        this.state = {
            expanded: false,
            tasks: [],
            ipConfig: '192.168.3.249', // TODO
            // ipConfig: 'localhost',
            uploadingTasks: new Map(), // taskId -> upload state
            odmTasks: [], // 从ODM接口获取的任务列表
            reportTasks: [], // 从get_reports接口获取的云端任务列表
            activeTab: 'uploading', // 'uploading', 'completed', 'failed', 'cloud'
            mainTab: 'local' // 'local', 'cloud' - 主要功能切换
        };

        // 绑定监听器
        this.handleTasksUpdate = this.handleTasksUpdate.bind(this);
        this.refreshInterval = null;
    }

    handleTasksUpdate = (tasks) => {
        this.setState({ tasks });
        
        // 处理新任务的上传
        tasks.forEach(task => {
            // 只处理临时任务（pending状态且不是来自ODM的任务）
            if (task.status !== 'pending') {
                return;
            }
            
            // 使用文件夹路径+任务名称作为唯一标识符
            const taskKey = `${task.folderPath}_${task.name}`;
            
            // 检查是否已经在上传队列中
            const isAlreadyUploading = Array.from(this.state.uploadingTasks.values())
                .some(ut => `${ut.folderPath}_${ut.name}` === taskKey);
            
            // 只有真正的临时任务才会被提交创建
            if (!isAlreadyUploading) {
                // TODO 临时写死projectid =1
                // task.projectId = 1;
                this.startTaskUpload(task);
            }
        });
    }

    componentDidMount() {
        // 添加任务更新监听器
        this.props.taskManager.addListener(this.handleTasksUpdate);

        // 初始化任务列表
        this.setState({ tasks: this.props.taskManager.tasks });

        // 开始定时刷新ODM任务列表
        this.startRefreshTimer();

        // 立即获取一次任务列表
        this.fetchOdmTasks();
        this.fetchReportTasks();
    }

    componentWillUnmount() {
        // 移除监听器
        this.props.taskManager.removeListener(this.handleTasksUpdate);

        // 清除定时器
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
    }

    componentDidUpdate(prevState) {
        // 由于任务列表完全由ODM接口数据驱动，不再需要在这里处理临时任务上传
        // 避免因列表刷新触发重复调用startTaskUpload的问题
    }

    // 开始定时刷新ODM任务列表
    startRefreshTimer = () => {
        this.refreshInterval = setInterval(() => {
            this.fetchOdmTasks();
            this.fetchReportTasks(); // 默认同时查询两个接口
        }, 10000); // 每3秒刷新一次
    }

    // 获取ODM任务列表
    fetchOdmTasks = async () => {
        try {
            const response = await $.ajax({
                url: `http://${this.state.ipConfig}:7700/api/odm/get_odm_jobs?only_running=false`,
                type: 'GET',
                dataType: 'json'
            });

            this.setState({ odmTasks: response.data || response || [] });
        } catch (error) {
            console.error('获取ODM任务列表失败:', error);
        }
    }

    // 获取云端报告任务列表
    fetchReportTasks = async () => {
        try {
            const response = await $.ajax({
                url: `http://${this.state.ipConfig}:7700/api/odm/get_reports`,
                type: 'GET',
                data: {
                    only_running: false
                },
                dataType: 'json'
            });

            this.setState({ reportTasks: response.data || response || [] });
        } catch (error) {
            console.error('获取云端报告任务列表失败:', error);
        }
    }

    // 提交任务到ODM接口
    submitToOdmApi = async (task, webodmTaskResponse) => {
        try {
            const submitData = {
                odm_project_id: task.projectId,
                odm_task_id: webodmTaskResponse ? webodmTaskResponse.id.toString() : task.id.toString(),
                odm_job_name: task.name,
                odm_job_type: task.type === 'rgb' ? 'rgb' : 'multispectral',
                odm_src_folder: task.folderPath,
                odm_samplinge_time: task.samplingDate ? new Date(task.samplingDate).toISOString() : new Date().toISOString(),
                odm_host: `http://${this.state.ipConfig}:8000` || window.location.origin,
                radiometric: task.radiometric || null,
                odm_create_at: new Date().toISOString()
            };

            const response = await $.ajax({
                url: `http://${this.state.ipConfig}:7700/api/odm/create_odm_job`,
                contentType: 'application/json',
                data: JSON.stringify(submitData),
                dataType: 'json',
                type: 'POST'
            });

            return response;
        } catch (error) {
            console.error('提交到ODM接口失败:', error);
            throw error;
        }
    }

    startTaskUpload = async (task) => {
        console.log('开始上传任务:', task.name);

        // 检查任务是否已经在处理中，避免重复创建
        const taskKey = `${task.folderPath}_${task.name}`;
        const isAlreadyUploading = Array.from(this.state.uploadingTasks.values())
            .some(ut => `${ut.folderPath}_${ut.name}` === taskKey);

        if (isAlreadyUploading) {
            console.log('任务已在处理中，跳过:', task.name);
            return;
        }

        // 初始化上传状态
        const uploadState = {
            id: task.id,
            name: task.name,
            type: task.type,
            status: 'creating', // creating, submitted, completed, error
            progress: 0,
            totalCount: 1, // 文件夹任务只有一个单位
            error: null,
            startTime: Date.now(),
            folderPath: task.folderPath,
            plotName: task.plotName,
            samplingDate: task.samplingDate,
            createdTime: new Date().toISOString()
        };

        this.setState(prevState => ({
            uploadingTasks: new Map(prevState.uploadingTasks.set(task.id, uploadState))
        }));

        try {
            // 1. 创建WebODM任务
            const taskResponse = await this.createTask(task);

            this.updateTaskState(task.id, {
                status: 'submitted',
                taskId: taskResponse.id
            });

            // 2. 调用submitToOdmApi提交任务信息
            await this.submitToOdmApi(task, taskResponse);

            // 3. 移除临时任务，然后刷新ODM任务列表
            this.setState(prevState => {
                const newMap = new Map(prevState.uploadingTasks);
                newMap.delete(task.id);
                return { uploadingTasks: newMap };
            });

            // 从全局任务管理器中移除任务
            this.props.taskManager.removeTask(task.id);

            // 刷新ODM任务列表，由接口数据完全接管
            this.fetchOdmTasks();

            console.log('任务提交完成:', task.name);

            // 触发onNewTaskAdded回调
            if (this.props.onNewTaskAdded) {
                this.props.onNewTaskAdded();
            }

            // 触发页面刷新事件
            const refreshEvent = new CustomEvent('folderUploadTaskComplete', {
                detail: { task, taskResponse }
            });
            document.dispatchEvent(refreshEvent);

        } catch (error) {
            console.error('任务上传失败:', error);

            const standardError = this.getStandardErrorMessage(task.type);

            this.updateTaskState(task.id, {
                status: 'error',
                error: standardError
            });

            // 更新任务状态为错误
            this.props.taskManager.updateTask(task.id, {
                status: 'error',
                error: standardError
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
            url: `http://${this.state.ipConfig}:8000/api/projects/${task.projectId}/tasks/`,
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

    // 映射ODM接口状态到本地状态
    mapOdmStatus = (odmStatus) => {
        switch (odmStatus) {
            case 'PENDING':
            case 'RUNNING':
                return 'uploading';
            case 'COMPLETED':
                return 'completed';
            case 'FAILED':
                return 'error';
            case 'CANCELED':
                return 'error';
            default:
                return 'creating';
        }
    }

    // 映射报告任务状态到本地状态
    mapReportStatus = (reportStatus) => {
        switch (reportStatus) {
            case 'PENDING':
                return 'pedding';
            case 'RUNNING':
                return 'uploading';
            case 'COMPLETED':
                return 'completed';
            case 'FAILED':
                return 'error';
            case 'CANCELED':
                return 'error';
            default:
                return 'creating';
        }
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

    setActiveTab = (tab) => {
        this.setState({ activeTab: tab });
    }

    setMainTab = (tab) => {
        this.setState({ mainTab: tab, activeTab: 'uploading' });
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

    // 取消上传任务
    cancelTask = async (task) => {
        try {
            const response = await $.ajax({
                url: `http://${this.state.ipConfig}:7700/api/odm/cancel_odm_job?project_id=${task.projectId || 1}&task_id=${task.taskId}`,
                type: 'GET',
                dataType: 'json'
            });

            console.log('任务取消成功:', response);
            // 刷新任务列表
            this.fetchOdmTasks();
        } catch (error) {
            console.error('取消任务失败:', error);
            alert('取消任务失败: ' + (error.responseJSON?.message || error.message || '未知错误'));
        }
    }

    // 移除任务
    removeOdmTask = async (task) => {
        if (!confirm(`确定要删除任务 "${task.name}" 吗？`)) {
            return;
        }

        try {
            const response = await $.ajax({
                url: `http://${this.state.ipConfig}:7700/api/odm/remove_odm_job?project_id=${task.projectId || 1}&task_id=${task.taskId}`,
                type: 'GET',
                dataType: 'json'
            });

            console.log('任务删除成功:', response);
            // 刷新任务列表
            this.fetchOdmTasks();
        } catch (error) {
            console.error('删除任务失败:', error);
            alert('删除任务失败: ' + (error.responseJSON?.message || error.message || '未知错误'));
        }
    }

    getStatusText = (status) => {
        switch (status) {
            case 'creating': return '创建任务中...';
            case 'uploading': return '处理中...';
            case 'submitted': return '提交中...';
            case 'completed': return '已完成';
            case 'error': return '上传失败';
            default: return '等待中...';
        }
    }

    getStatusIcon = (status) => {
        switch (status) {
            case 'creating':
            case 'uploading':
            case 'submitted':
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

    getTaskBackgroundColor = (status) => {
        switch (status) {
            case 'error':
            case 'failed':
                return '#fff5f5';
            case 'completed':
                return '#f0f8f0';
            case 'uploading':
            case 'processing':
                return '#f0f8ff';
            default:
                return '#f9f9f9';
        }
    }

    getEmptyStateText = (activeTab) => {
        switch (activeTab) {
            case 'uploading':
                return '暂无上传中的任务';
            case 'completed':
                return '暂无已完成的任务';
            case 'failed':
                return '暂无失败的任务';
            default:
                return '暂无任务';
        }
    }

    getStandardErrorMessage = (taskType) => {
        const fileExtension = taskType === 'rgb' ? 'jpg' : 'tif';
        return `文件夹内没有${fileExtension}文件`;
    }

    formatDateTime = (dateTimeStr) => {
        if (!dateTimeStr) return '';
        
        try {
            const date = new Date(dateTimeStr);
            if (isNaN(date.getTime())) return dateTimeStr; // 如果无法解析，返回原字符串
            
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            
            return `${year}-${month}-${day} ${hours}:${minutes}`;
        } catch (error) {
            return dateTimeStr; // 异常时返回原字符串
        }
    }

    render() {
        const { expanded, tasks, uploadingTasks, odmTasks, reportTasks, activeTab, mainTab } = this.state;
        const uploadingTasksList = Array.from(uploadingTasks.values());

        // 根据主功能tab决定使用哪个数据源
        let allTasks = [];
        const addedTaskKeys = new Set();
        
        if (mainTab === 'local') {
            // 使用ODM任务数据
            odmTasks.forEach(odmTask => {
                const taskKey = odmTask.odm_task_id;
                if (!addedTaskKeys.has(taskKey)) {
                    addedTaskKeys.add(taskKey);
                    allTasks.push({
                        id: odmTask.run_id || odmTask.id,
                        name: odmTask.odm_job_name,
                        type: odmTask.odm_job_type || 'rgb',
                        status: this.mapOdmStatus(odmTask.state),
                        progress: odmTask.progress || 0,
                        totalCount: odmTask.odm_image_count || 0,
                        uploadedCount: Math.floor((odmTask.progress || 0) / 100 * (odmTask.odm_image_count || 0)),
                        error: odmTask.err_msg,
                        taskId: odmTask.odm_task_id,
                        projectId: odmTask.odm_project_id || 1,
                        folderPath: odmTask.odm_folder_path,
                        plotName: odmTask.odm_job_name,
                        samplingDate: odmTask.odm_samplinge_time,
                        createdTime: odmTask.odm_create_at || odmTask.created_at
                    });
                }
            });
        } else {
            // 使用云端报告任务数据
            reportTasks.forEach(reportTask => {
                const taskKey = reportTask.job.odm_task_id;
                if (!addedTaskKeys.has(taskKey)) {
                    addedTaskKeys.add(taskKey);
                    allTasks.push({
                        id: reportTask.id,
                        name: reportTask.job && reportTask.job.odm_job_name, // 使用odm_task_id作为任务名
                        type: reportTask.algo_name || 'ndvi',
                        status: this.mapReportStatus(reportTask.state),
                        progress: reportTask.progress || 0,
                        totalCount: 1, // 云端任务没有文件计数概念
                        uploadedCount: reportTask.progress >= 100 ? 1 : 0,
                        error: reportTask.err_msg,
                        taskId: reportTask.job.odm_task_id,
                        projectId: reportTask.odm_project_id || 1,
                        createdTime: reportTask.create_at,
                        updateTime: reportTask.update_at,
                        areaMu: reportTask.area_mu,
                        minValue: reportTask.min_value,
                        maxValue: reportTask.max_value,
                        mean: reportTask.mean,
                        stddev: reportTask.stddev
                    });
                }
            });
        }

        // 按状态分类任务
        const activeUploadTasks = allTasks.filter(t => t.status === 'uploading');
        const completedTasks = allTasks.filter(t => t.status === 'completed');
        const failedTasks = allTasks.filter(t => t.status === 'error');
        // 获取当前标签页的任务列表
        const getCurrentTasks = () => {
            switch (activeTab) {
                case 'uploading': return activeUploadTasks;
                case 'completed': return completedTasks;
                case 'failed': return failedTasks;
                default: return activeUploadTasks;
            }
        };
        
        const currentTasks = getCurrentTasks();
        const totalTasks = activeUploadTasks.length + completedTasks.length + failedTasks.length;
        
        // 计算本地和云端uploading状态的任务数量
        const localUploadingTasks = [];
        const cloudUploadingTasks = [];
        const localTaskKeys = new Set();
        const cloudTaskKeys = new Set();
        
        // 统计本地uploading任务
        odmTasks.forEach(odmTask => {
            const taskKey = odmTask.odm_task_id;
            const status = this.mapOdmStatus(odmTask.state);
            if (!localTaskKeys.has(taskKey) && status === 'uploading') {
                localTaskKeys.add(taskKey);
                localUploadingTasks.push(odmTask);
            }
        });
        
        // 统计云端uploading任务
        reportTasks.forEach(reportTask => {
            const taskKey = reportTask.odm_task_id;
            const status = this.mapReportStatus(reportTask.state);
            if (!cloudTaskKeys.has(taskKey) && status === 'uploading') {
                cloudTaskKeys.add(taskKey);
                cloudUploadingTasks.push(reportTask);
            }
        });
        
        const localTaskCount = localUploadingTasks.length;
        const cloudTaskCount = cloudUploadingTasks.length;

        return React.createElement('div', {
            className: `upload-task-list ${expanded ? 'expanded' : 'collapsed'}`,
            style: {
                position: 'fixed',
                bottom: '60px',
                right: '20px',
                zIndex: 1000,
                backgroundColor: 'white',
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: expanded ? '450px' : '200px',
                maxWidth: '550px',
                maxHeight: expanded ? '650px' : 'auto'
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
                }, expanded ? `${mainTab === 'local' ? '上传任务' : '云端任务'} (${totalTasks})` : `本地(${localTaskCount})   云端(${cloudTaskCount})`),
                React.createElement('i', {
                    key: 'toggle-icon',
                    className: `fa fa-chevron-${expanded ? 'down' : 'up'}`,
                    style: { fontSize: '12px', color: '#666' }
                })
            ]),

            // 主功能切换栏
            expanded ? React.createElement('div', {
                key: 'main-tab-nav',
                style: {
                    display: 'flex',
                    borderBottom: '1px solid #ddd',
                    backgroundColor: '#f8f9fa'
                }
            }, [
                React.createElement('button', {
                    key: 'local-tab',
                    type: 'button',
                    style: {
                        flex: 1,
                        padding: '12px 16px',
                        border: 'none',
                        backgroundColor: mainTab === 'local' ? '#007bff' : 'transparent',
                        color: mainTab === 'local' ? 'white' : '#666',
                        fontSize: '13px',
                        cursor: 'pointer',
                        borderRadius: '0',
                        fontWeight: mainTab === 'local' ? 'bold' : 'normal'
                    },
                    onClick: () => this.setMainTab('local')
                }, '新建任务上传'),
                React.createElement('button', {
                    key: 'cloud-tab',
                    type: 'button',
                    style: {
                        flex: 1,
                        padding: '12px 16px',
                        border: 'none',
                        backgroundColor: mainTab === 'cloud' ? '#007bff' : 'transparent',
                        color: mainTab === 'cloud' ? 'white' : '#666',
                        fontSize: '13px',
                        cursor: 'pointer',
                        borderRadius: '0',
                        fontWeight: mainTab === 'cloud' ? 'bold' : 'normal'
                    },
                    onClick: () => this.setMainTab('cloud')
                }, '上传到云端')
            ]) : null,

            // Tab导航栏（状态切换）
            expanded ? React.createElement('div', {
                key: 'tab-nav',
                style: {
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '12px 16px',
                    backgroundColor: 'transparent'
                }
            }, [
                React.createElement('div', {
                    key: 'tab-container',
                    style: {
                        display: 'flex',
                        backgroundColor: '#f1f3f4',
                        borderRadius: '20px',
                        padding: '4px',
                        width: 'auto',
                        minWidth: '280px'
                    }
                }, [
                    React.createElement('button', {
                        key: 'uploading-tab',
                        type: 'button',
                        style: {
                            flex: 1,
                            padding: '8px 12px',
                            border: 'none',
                            backgroundColor: activeTab === 'uploading' ? '#007bff' : 'transparent',
                            color: activeTab === 'uploading' ? 'white' : '#666',
                            fontSize: '11px',
                            cursor: 'pointer',
                            borderRadius: '16px',
                            fontWeight: activeTab === 'uploading' ? 'bold' : 'normal',
                            transition: 'all 0.2s ease',
                            margin: '0 2px'
                        },
                        onClick: () => this.setActiveTab('uploading')
                    }, `上传中 (${activeUploadTasks.length})`),
                    React.createElement('button', {
                        key: 'completed-tab',
                        type: 'button',
                        style: {
                            flex: 1,
                            padding: '8px 12px',
                            border: 'none',
                            backgroundColor: activeTab === 'completed' ? '#28a745' : 'transparent',
                            color: activeTab === 'completed' ? 'white' : '#666',
                            fontSize: '11px',
                            cursor: 'pointer',
                            borderRadius: '16px',
                            fontWeight: activeTab === 'completed' ? 'bold' : 'normal',
                            transition: 'all 0.2s ease',
                            margin: '0 2px'
                        },
                        onClick: () => this.setActiveTab('completed')
                    }, `已完成 (${completedTasks.length})`),
                    React.createElement('button', {
                        key: 'failed-tab',
                        type: 'button',
                        style: {
                            flex: 1,
                            padding: '8px 12px',
                            border: 'none',
                            backgroundColor: activeTab === 'failed' ? '#dc3545' : 'transparent',
                            color: activeTab === 'failed' ? 'white' : '#666',
                            fontSize: '11px',
                            cursor: 'pointer',
                            borderRadius: '16px',
                            fontWeight: activeTab === 'failed' ? 'bold' : 'normal',
                            transition: 'all 0.2s ease',
                            margin: '0 2px'
                        },
                        onClick: () => this.setActiveTab('failed')
                    }, `上传失败 (${failedTasks.length})`)
                ])
            ]) : null,

            // 任务列表内容区域
            expanded ? React.createElement('div', {
                key: 'task-content',
                style: {
                    height: '480px',
                    overflowY: 'auto',
                    padding: '0'
                }
            }, [
                // 当前标签页的任务列表
                currentTasks.length > 0 ? React.createElement('div', {
                    key: 'current-tasks',
                    style: {
                        padding: '8px'
                    }
                }, currentTasks.map(task =>
                    React.createElement('div', {
                        key: task.id,
                        className: 'task-item',
                        style: {
                            padding: '12px',
                            marginBottom: '8px',
                            border: '1px solid #eee',
                            borderRadius: '6px',
                            backgroundColor: this.getTaskBackgroundColor(task.status)
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
                                    key: 'details',
                                    style: { fontSize: '11px', color: '#666' }
                                }, mainTab === 'local' ? [
                                    `${task.type === 'rgb' ? 'RGB' : '多光谱'} • ${task.totalCount} 文件`,
                                    task.createdTime ? ` • ${this.formatDateTime(task.createdTime)}` : ''
                                ].join('') : [
                                    `${task.type.toUpperCase()} • 面积: ${task.areaMu ? task.areaMu.toFixed(2) + '亩' : '未知'}`,
                                    task.createdTime ? ` • ${this.formatDateTime(task.createdTime)}` : ''
                                ].join(''))
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

                        // 进度条（仅上传中的任务显示）
                        (activeTab === 'uploading' && (task.status === 'uploading' || task.status === 'processing') && task.progress > 0) ? React.createElement('div', {
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

                        // 错误信息（仅失败标签页显示）
                        (activeTab === 'failed' && task.error) ? React.createElement('div', {
                            key: 'error',
                            style: {
                                color: '#dc3545',
                                fontSize: '11px',
                                marginTop: '4px',
                                padding: '8px',
                                backgroundColor: '#f8d7da',
                                borderRadius: '4px',
                                border: '1px solid #f5c6cb'
                            }
                        }, task.error) : null,

                        // 操作按钮（仅本地任务显示）
                        (mainTab === 'local' && (activeTab === 'uploading' || activeTab === 'completed' || activeTab === 'failed')) ? React.createElement('div', {
                            key: 'actions',
                            style: { textAlign: 'right', marginTop: '8px' }
                        }, [
                            // 取消按钮（仅上传中显示）
                            activeTab === 'uploading' ? React.createElement('button', {
                                key: 'cancel',
                                type: 'button',
                                className: 'btn btn-xs btn-warning',
                                onClick: () => this.cancelTask(task),
                                style: { fontSize: '10px', padding: '4px 8px', marginRight: '5px' }
                            }, '取消') : null,
                            // 删除按钮（已完成和失败显示）
                            (activeTab === 'completed' || activeTab === 'failed') ? React.createElement('button', {
                                key: 'remove',
                                type: 'button',
                                className: 'btn btn-xs btn-danger',
                                onClick: () => this.removeOdmTask(task),
                                style: { fontSize: '10px', padding: '4px 8px' }
                            }, '删除') : null
                        ]) : null,

                        // 云端任务额外信息
                        (mainTab === 'cloud' && activeTab === 'completed' && task.status === 'completed') ? React.createElement('div', {
                            key: 'cloud-info',
                            style: {
                                marginTop: '8px',
                                padding: '8px',
                                backgroundColor: '#f8f9fa',
                                borderRadius: '4px',
                                fontSize: '10px',
                                color: '#666'
                            }
                        }, [
                            React.createElement('div', { key: 'stats' }, [
                                `均值: ${task.mean ? task.mean.toFixed(3) : 'N/A'} | `,
                                `标准差: ${task.stddev ? task.stddev.toFixed(3) : 'N/A'} | `,
                                `范围: ${task.minValue ? task.minValue.toFixed(2) : 'N/A'} ~ ${task.maxValue ? task.maxValue.toFixed(2) : 'N/A'}`
                            ].join(''))
                        ]) : null
                    ])
                )) : React.createElement('div', {
                    key: 'empty-state',
                    style: {
                        padding: '40px 20px',
                        textAlign: 'center',
                        color: '#999',
                        fontSize: '12px'
                    }
                }, this.getEmptyStateText(activeTab))
            ]) : null
        ]);
    }
}

export default UploadTaskList;