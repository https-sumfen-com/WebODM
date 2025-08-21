import React from 'React';
import $ from 'jquery';

class CloudUploadButton extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            uploading: false,
            showModal: false,
            ipConfig: '192.168.3.249', // TODO: 配置IP地址
            buttonHidden: false // 控制按钮是否隐藏
        };
    }

    componentDidMount() {
        // 监听来自iframe的消息
        window.addEventListener('message', this.handleMessage);
        // 生成唯一的组件ID
        this.componentId = `cloud-upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    componentWillUnmount() {
        // 清理事件监听器
        window.removeEventListener('message', this.handleMessage);
    }

    handleUpload = () => {
        this.setState({ showModal: true });
    }

    // 获取报告详情数据
    fetchReportDetail = async (projectId, taskId) => {
        try {
            const response = await $.ajax({
                url: `http://${this.state.ipConfig}:7700/api/odm/get_report_detail`,
                type: 'GET',
                data: {
                    project_id: projectId,
                    task_id: taskId
                },
                dataType: 'json'
            });
            return response.data || response;
        } catch (error) {
            console.error('获取报告详情失败:', error);
            return null;
        }
    };

    // 上传报告到云端
    uploadReport = async (projectId, taskId, reportNo, taskName) => {
        try {
            const response = await $.ajax({
                url: `http://${this.state.ipConfig}:7700/api/odm/upload_report`,
                type: 'POST',
                contentType: 'application/json',
                headers: {
                    'cid': '288',
                    'token': '4bdce9615061e3fa596106e7c743adea'
                },
                data: JSON.stringify({
                    project_id: projectId,
                    task_id: taskId,
                    report_no: reportNo,
                    task_name: taskName,
                    "algo_name": "ndvi"
                }),
                dataType: 'json'
            });
            return response;
        } catch (error) {
            console.error('上传报告失败:', error);
            throw error;
        }
    };

    // 处理来自 iframe 的消息
    handleMessage = async (event) => {
        const { type, data } = event.data;

        // 只处理来自当前组件对应iframe的消息
        const iframe = document.getElementById(`cloudUploadIframe-${this.componentId}`);
        if (!iframe || !this.state.showModal || event.source !== iframe.contentWindow) {
            return;
        }

        if (type === 'IFRAME_LOADED') {
            // 获取task的project_id和task_id
            const projectId = this.props.task.project || this.props.task.projectId;
            const taskId = this.props.task.id;
            // TODO 测试写死
            // const projectId = 1;
            // const taskId = '137ad9bd-9e37-4906-9295-eaa38103ec3c';

            // 通过接口获取reportData
            const reportData = await this.fetchReportDetail(projectId, taskId);
            console.log('reportData', {
                ...this.props.task, report_info: reportData, project: projectId, id: taskId, "extent": [
                    119.81511421989497,
                    50.434494193280884,
                    119.82348153509822,
                    50.44223444074079
                ]
            });
            // 发送task信息到iframe TODO 临时写死extent
            this.sendDataToIframe({
                type: 'MESSAGE_DATA',
                data: {
                    reportData: {
                        ...this.props.task, report_info: reportData, project: projectId, id: taskId
                    }, // 优先使用接口数据
                }
            });
        } else if (type === 'UPLOADED') {
            if (data.code === 1) {
                // 调用上传报告接口
                const projectId = this.props.task.project || this.props.task.projectId;
                const taskId = this.props.task.id;
                // TODO 测试写死
                // const projectId = 1;
                // const taskId = '137ad9bd-9e37-4906-9295-eaa38103ec3c';
                const reportNo = data.data.report_no;

                console.log('开始上传报告到云端:', reportNo);

                try {
                    await this.uploadReport(projectId, taskId, reportNo, this.props.task.name);
                    console.log('报告上传成功:', reportNo);
                    setTimeout(() => {
                        // 调用refresh方法刷新任务状态
                        if (this.props.onRefresh) {
                            this.props.onRefresh();
                        }
                        // 隐藏当前按钮
                        this.setState({ buttonHidden: true });
                    }, 1000);
                } catch (error) {
                    console.error('报告上传失败:', error);
                }

                setTimeout(() => {
                    this.setState({ showModal: false });
                }, 1000);
            }
        }
    };

    // 发送数据到iframe
    sendDataToIframe = (message) => {
        const iframe = document.getElementById(`cloudUploadIframe-${this.componentId}`);
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(message, '*');
        }
    };

    closeModal = () => {
        this.setState({ showModal: false });
    };

    // 获取iframe URL地址
    getIframeUrl = () => {
        // if (isDevelopment) {
        // return 'http://192.168.3.59:8080/#/growthMap';
        // } else {
        return 'http://172.17.0.1:8088/#/growthMap';
        // }
    };

    render() {
        const { disabled } = this.props;
        const { uploading, showModal, buttonHidden } = this.state;
        
        // 如果按钮被隐藏，返回null
        if (buttonHidden) {
            return null;
        }

        return (
            <>
                <button
                    type="button"
                    className="btn btn-sm btn-info"
                    onClick={this.handleUpload}
                    disabled={disabled || uploading}
                >
                    <i className="fa fa-cloud-upload"></i>
                    <span className="hidden-xs">
                        {uploading ? ' 上传中...' : ' 上传到云端'}
                    </span>
                </button>

                {/* 上传弹窗 */}
                {showModal && (
                    <div className="modal fade in" style={{ display: 'block' }} tabIndex="-1">
                        <div className="modal-dialog" style={{ width: '100%', height: '100vh', margin: 0, maxWidth: 'none', display: 'flex', flexDirection: 'column' }}>
                            <div className="modal-content" style={{ flexShrink: 1, flexGrow: 1, border: 'none', borderRadius: 0, display: 'flex', flexDirection: 'column' }}>
                                <div className="modal-header" style={{ flexShrink: 0, flexGrow: 0 }}>
                                    <button
                                        type="button"
                                        className="close"
                                        onClick={this.closeModal}
                                        aria-label="Close"
                                    >
                                        <span aria-hidden="true">&times;</span>
                                    </button>
                                    <h4 className="modal-title">上传到云端</h4>
                                </div>
                                <div className="modal-body" style={{ padding: 0, flexShrink: 1, flexGrow: 1, overflow: 'hidden', maxHeight: 10000 }}>
                                    <iframe
                                        id={`cloudUploadIframe-${this.componentId}`}
                                        src={this.getIframeUrl()}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            border: 'none',
                                            overflow: 'hidden'
                                        }}
                                        title="云端上传"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 模态框背景遮罩 */}
                {showModal && (
                    <div className="modal-backdrop fade in"></div>
                )}
            </>
        );
    }
}

export default CloudUploadButton;