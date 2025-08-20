import React from 'React';
import PropTypes from 'prop-types';
import NewTaskPanel from 'webodm/components/NewTaskPanel';

class NewTaskButton extends React.Component {
    static propTypes = {
        projectId: PropTypes.number.isRequired,
        onNewTaskAdded: PropTypes.func,
        taskManager: PropTypes.object.isRequired
    }

    constructor(props) {
        super(props);
        this.state = {
            processing: false,
            showTypeSelection: false, // 显示类型选择弹窗
            selectedTypes: ['rgb', 'multispectral'], // 默认全选
            rgbFiles: [], // RGB文件数组（JPG）
            multispectralFiles: [], // 多光谱文件数组（TIF）
            showLoading: false,
            showTaskPanel: false,
            currentTaskType: null, // 当前创建任务的类型
            folderName: '',
            folderFullPath: '',
            samplingDate: '', // 采样日期
            pendingTaskTypes: [] // 待创建的任务类型队列
        };
        
        // 绑定事件监听器
        this.dealFile = this.dealFile.bind(this);
        
        // 生成唯一实例ID
        this.instanceId = `newtaskbutton_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    handleNewTask = () => {
        // 首先显示类型选择弹窗
        this.setState({ showTypeSelection: true });
    }

    handleTypeSelectionConfirm = () => {
        if (this.state.selectedTypes.length === 0) {
            alert('请至少选择一种类型');
            return;
        }

        this.setState({ showTypeSelection: false });
        this.selectFolderAndProcess();
    }

    handleTypeSelectionCancel = () => {
        this.setState({ showTypeSelection: false });
    }

    handleTypeChange = (type) => {
        const { selectedTypes } = this.state;
        if (selectedTypes.includes(type)) {
            // 取消选择
            this.setState({
                selectedTypes: selectedTypes.filter(t => t !== type)
            });
        } else {
            // 添加选择
            this.setState({
                selectedTypes: [...selectedTypes, type]
            });
        }
    }

    componentDidMount() {
        // 添加事件监听器
        window.addEventListener("getFileData", this.dealFile);
    }

    componentWillUnmount() {
        // 移除事件监听器
        window.removeEventListener("getFileData", this.dealFile);
        
        // 如果当前实例是活跃实例，清除标记
        if (window.activeTaskPanelInstance === this.instanceId) {
            window.activeTaskPanelInstance = null;
        }
    }

    selectFolderAndProcess = () => {
        try {
            // 显示loading弹窗
            // this.setState({
            //     showLoading: true,
            //     processing: true
            // });

            console.log('触发文件选择器');
            
            // 通过CustomEvent打开文件选择器
            window.dispatchEvent(
                new CustomEvent("openFile", {
                    detail: { type: "getPath" },
                })
            );
        } catch (error) {
            console.error('打开文件选择器时出错:', error);
            alert('打开文件选择器时出错: ' + error.message);
            this.setState({
                showLoading: false,
                processing: false
            });
        }
    }

    dealFile = (event) => {
        try {
            const { detail } = event;
            console.log('收到文件数据:', detail);

            if (detail.cmd === 'getPath' && detail.path) {
                const fullPath = detail.path;
                console.log('获取到全路径:', fullPath);

                // 从路径中提取文件夹名称
                const pathParts = fullPath.replace(/\\/g, '/').split('/');
                const folderName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

                // 解析文件夹名称，提取采样日期和地块名
                const { samplingDate, plotName } = this.parseFolderName(folderName);

                // 更新状态
                this.setState({
                    folderName: plotName,
                    folderFullPath: fullPath,
                    samplingDate: samplingDate,
                    showLoading: false,
                    processing: false
                }, () => {
                    console.log('状态更新完成:');
                    console.log('文件夹名称:', this.state.folderName);
                    console.log('全路径:', this.state.folderFullPath);
                    console.log('采样日期:', this.state.samplingDate);
                    
                    // 准备任务创建队列
                    this.prepareTaskCreation();
                });
            } else {
                console.error('无效的文件数据:', detail);
                this.setState({
                    showLoading: false,
                    processing: false
                });
                alert('获取文件路径失败');
            }
        } catch (error) {
            console.error('处理文件数据时出错:', error);
            this.setState({
                showLoading: false,
                processing: false
            });
            alert('处理文件数据时出错: ' + error.message);
        }
    }

    prepareTaskCreation = () => {
        const { selectedTypes } = this.state;
        const pendingTaskTypes = [];

        console.log('准备任务创建队列:');
        console.log('选择的类型:', selectedTypes);

        // 根据选择的类型直接创建任务队列，不依赖文件数组
        if (selectedTypes.includes('rgb')) {
            pendingTaskTypes.push('rgb');
            console.log('添加RGB任务到队列');
        }

        if (selectedTypes.includes('multispectral')) {
            pendingTaskTypes.push('multispectral');
            console.log('添加多光谱任务到队列');
        }

        console.log('最终任务队列:', pendingTaskTypes);

        if (pendingTaskTypes.length === 0) {
            alert('请至少选择一种数据类型');
            return;
        }

        // 检查是否已有其他实例在显示任务面板
        if (window.activeTaskPanelInstance && window.activeTaskPanelInstance !== this.instanceId) {
            // alert('已有任务面板正在使用中，请稍后再试');
            return;
        }

        // 设置当前实例为活跃实例
        window.activeTaskPanelInstance = this.instanceId;

        this.setState({
            pendingTaskTypes: pendingTaskTypes,
            currentTaskType: pendingTaskTypes[0],
            showTaskPanel: true
        }, () => {
            console.log('任务队列初始化完成，当前任务:', this.state.currentTaskType);
        });
    }

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
            samplingDate: this.state.samplingDate || new Date().toISOString().split('T')[0], // 如果没有采样日期则使用当前日期
            plotName: this.state.folderName, // 地块名
            status: 'pending'
        };

        // 添加到全局上传任务管理器
        this.props.taskManager.addTask(uploadTask);

        console.log('任务已添加到全局上传队列:', uploadTask);

        // 从队列中移除当前任务类型
        const remainingTypes = this.state.pendingTaskTypes.slice(1);
        console.log('剩余任务队列:', remainingTypes);

        if (remainingTypes.length > 0) {
            // 还有其他任务需要创建
            console.log(`准备创建下一个任务: ${remainingTypes[0]}`);
            this.setState({
                pendingTaskTypes: remainingTypes,
                currentTaskType: remainingTypes[0]
                // showTaskPanel保持true，继续显示下一个任务面板
            }, () => {
                console.log('状态更新完成，当前任务类型:', this.state.currentTaskType);
            });
        } else {
            // 所有任务都创建完成
            console.log('所有任务创建完成');
            // 清除活跃实例标记
            if (window.activeTaskPanelInstance === this.instanceId) {
                window.activeTaskPanelInstance = null;
            }
            this.setState({
                showTaskPanel: false,
                currentTaskType: null,
                pendingTaskTypes: []
            });
        }
    }

    handleTaskCancel = () => {
        // 清除活跃实例标记
        if (window.activeTaskPanelInstance === this.instanceId) {
            window.activeTaskPanelInstance = null;
        }
        this.setState({
            showTaskPanel: false,
            currentTaskType: null,
            pendingTaskTypes: []
        });
    }

    getCurrentFiles = () => {
        // 由于使用CustomEvent方式，这里返回空数组
        // 实际文件会在NewTaskPanel中通过getFiles回调获取
        return [1];
    }

    getCurrentTaskName = () => {
        const { currentTaskType, folderName } = this.state;
        if (currentTaskType === 'rgb') {
            return `${folderName}_RGB`;
        } else if (currentTaskType === 'multispectral') {
            return `${folderName}_多光谱`;
        }
        return folderName;
    }

    handleCloseLoading = () => {
        this.setState({ showLoading: false, processing: false });
    }

    // 解析文件夹名称，提取采样日期和地块名
    parseFolderName = (folderName) => {
        try {
            // DJI格式: DJI_202506110941_001_大疆智慧农业平台_地块名xxxx
            const djiMatch = folderName.match(/^DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_\d+_.*?[_-](.+)$/);
            if (djiMatch) {
                const year = djiMatch[1];
                const month = djiMatch[2];
                const day = djiMatch[3];
                const plotName = djiMatch[6];

                // 验证日期有效性
                const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                if (date.getFullYear() == year &&
                    date.getMonth() == month - 1 &&
                    date.getDate() == day) {
                    return {
                        samplingDate: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
                        plotName: plotName.trim()
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
                { regex: /^(.+)[_-](\d{4})\/(\d{2})\/(\d{2})$/, dateFirst: false }
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
                    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    if (date.getFullYear() == year &&
                        date.getMonth() == month - 1 &&
                        date.getDate() == day) {
                        return {
                            samplingDate: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
                            plotName: plotName.trim()
                        };
                    }
                }
            }

            // 尝试提取任何可能的日期格式
            const datePatterns = [
                /(\d{4})(\d{2})(\d{2})/,  // YYYYMMDD
                /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
                /(\d{4})\.(\d{2})\.(\d{2})/, // YYYY.MM.DD
                /(\d{4})\/(\d{2})\/(\d{2})/ // YYYY/MM/DD
            ];

            for (const datePattern of datePatterns) {
                const dateMatch = folderName.match(datePattern);
                if (dateMatch) {
                    const year = dateMatch[1];
                    const month = dateMatch[2];
                    const day = dateMatch[3];

                    // 验证日期有效性
                    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    if (date.getFullYear() == year &&
                        date.getMonth() == month - 1 &&
                        date.getDate() == day) {

                        // 尝试提取地块名（移除日期部分）
                        let plotName = folderName.replace(datePattern, '').replace(/[_-]+/g, '').replace(/^[_-]|[_-]$/g, '');
                        if (!plotName) {
                            plotName = folderName; // 如果无法提取地块名，使用完整文件夹名
                        }

                        return {
                            samplingDate: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
                            plotName: plotName.trim()
                        };
                    }
                }
            }

            // 如果没有匹配到任何格式，返回原文件夹名作为地块名，采样日期使用当前日期
            console.log('无法解析文件夹名称格式，使用默认值:', folderName);
            return {
                samplingDate: new Date().toISOString().split('T')[0], // 使用当前日期
                plotName: folderName
            };

        } catch (error) {
            console.error('解析文件夹名称时出错:', error);
            return {
                samplingDate: new Date().toISOString().split('T')[0], // 异常时使用当前日期
                plotName: folderName
            };
        }
    }

    createModal = (content) => {
        const modalOverlay = React.createElement('div', {
            style: {
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.5)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }
        }, content);

        return modalOverlay;
    }

    render() {
        const { processing, showLoading, showTaskPanel, showTypeSelection, selectedTypes, folderName, currentTaskType } = this.state;
        const currentFiles = this.getCurrentFiles();
        const currentTaskName = this.getCurrentTaskName();

        return React.createElement('div', { style: { display: 'inline-block' } }, [

            // 主按钮
            React.createElement('button', {
                key: 'button',
                type: 'button',
                className: 'btn btn-sm btn-warning',
                style: {
                    marginLeft: '10px'
                },

                onClick: this.handleNewTask,
                disabled: processing
            }, [
                React.createElement('i', { key: 'icon', className: 'fa fa-plus' }),
                React.createElement('span', {
                    key: 'text',
                    className: 'hidden-xs'
                }, processing ? ' 处理中...' : ' 新建分析任务')
            ]),

            // 类型选择弹窗
            showTypeSelection ? this.createModal(
                React.createElement('div', {
                    key: 'type-selection-modal',
                    style: {
                        background: 'white',
                        borderRadius: '8px',
                        padding: '30px',
                        minWidth: '400px',
                        zIndex: 999999
                    }
                }, [
                    React.createElement('h3', {
                        key: 'title',
                        style: { marginBottom: '20px', textAlign: 'center' }
                    }, '选择数据类型'),
                    React.createElement('div', {
                        key: 'options',
                        style: { marginBottom: '20px' }
                    }, [
                        React.createElement('label', {
                            key: 'rgb-label',
                            style: { display: 'block', marginBottom: '10px', cursor: 'pointer' }
                        }, [
                            React.createElement('input', {
                                key: 'rgb-checkbox',
                                type: 'checkbox',
                                checked: selectedTypes.includes('rgb'),
                                onChange: () => this.handleTypeChange('rgb'),
                                style: { marginRight: '8px' }
                            }),
                            'RGB数据 (JPG格式)'
                        ]),
                        React.createElement('label', {
                            key: 'multispectral-label',
                            style: { display: 'block', cursor: 'pointer' }
                        }, [
                            React.createElement('input', {
                                key: 'multispectral-checkbox',
                                type: 'checkbox',
                                checked: selectedTypes.includes('multispectral'),
                                onChange: () => this.handleTypeChange('multispectral'),
                                style: { marginRight: '8px' }
                            }),
                            '多光谱数据 (TIF格式)'
                        ])
                    ]),
                    React.createElement('div', {
                        key: 'buttons',
                        style: { textAlign: 'right' }
                    }, [
                        React.createElement('button', {
                            key: 'cancel',
                            type: 'button',
                            className: 'btn btn-default',
                            onClick: this.handleTypeSelectionCancel,
                            style: { marginRight: '10px' }
                        }, '取消'),
                        React.createElement('button', {
                            key: 'confirm',
                            type: 'button',
                            className: 'btn btn-primary',
                            onClick: this.handleTypeSelectionConfirm
                        }, '确定')
                    ])
                ])
            ) : null,

            // Loading弹窗
            showLoading ? this.createModal(
                React.createElement('div', {
                    key: 'loading-modal',
                    style: {
                        background: 'white',
                        borderRadius: '8px',
                        padding: '30px',
                        textAlign: 'center',
                        minWidth: '300px',
                        zIndex: 999999
                    }
                }, [
                    React.createElement('div', {
                        key: 'spinner',
                        style: {
                            fontSize: '24px',
                            marginBottom: '15px'
                        }
                    }, React.createElement('i', {
                        className: 'fa fa-spinner fa-spin'
                    })),
                    React.createElement('h4', {
                        key: 'title',
                        style: { marginBottom: '10px' }
                    }, '文件分析中...'),
                    React.createElement('p', {
                        key: 'folder',
                        style: { color: '#666' }
                    }, `正在分析文件夹: ${folderName}`),
                    React.createElement('button', {
                        key: 'cancel',
                        type: 'button',
                        className: 'btn btn-default btn-sm',
                        onClick: this.handleCloseLoading,
                        style: { marginTop: '15px' }
                    }, '取消')
                ])
            ) : null,

            // NewTaskPanel弹窗
            showTaskPanel ? this.createModal(
                React.createElement('div', {
                    key: 'task-panel-modal',
                    style: {
                        background: 'white',
                        borderRadius: '8px',
                        padding: '20px',
                        maxWidth: '800px',
                        maxHeight: '80vh',
                        overflow: 'auto',
                        width: '90%',
                        zIndex: 999999
                    }
                }, [
                    React.createElement('div', {
                        key: 'task-info',
                        style: {
                            background: '#f0f8ff',
                            padding: '10px',
                            borderRadius: '4px',
                            marginBottom: '15px',
                            textAlign: 'center'
                        }
                    }, `正在创建${currentTaskType === 'rgb' ? 'RGB' : '多光谱'}任务`),
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
                        getFiles: () => {
                            // 返回文件夹路径信息，让NewTaskPanel处理文件获取
                            return {
                                folderPath: this.state.folderFullPath,
                                taskType: this.state.currentTaskType
                            };
                        }
                    })
                ])
            ) : null
        ]);
    }
}

export default NewTaskButton;