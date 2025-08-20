import React from 'React';

class CloudUploadButton extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            uploading: false,
            showModal: false
        };
    }
    
    componentDidMount() {
        // 监听来自iframe的消息
        window.addEventListener('message', this.handleMessage);
    }
    
    componentWillUnmount() {
        // 清理事件监听器
        window.removeEventListener('message', this.handleMessage);
    }
    
    handleUpload = () => {
        this.setState({ showModal: true });
    }
    
    // 处理来自 iframe 的消息
    handleMessage = (event) => {
        const { type, data } = event.data;
        if (type === 'IFRAME_LOADED') {
            // 发送task信息到iframe
            this.sendDataToIframe({
                type: 'MESSAGE_DATA',
                data: {
                    reportData: this.props.task.reportData || {}, // 从props获取task信息
                    bounds: this.props.task.bounds // 从props获取task信息
                }
            });
        } else if (type === 'UPLOADED') {
            if (data.code === 1) {
                // TODO: 调用本地资源推送到oss
                console.log('TODO: 上传到OSS', data);
                
                setTimeout(() => {
                    this.setState({ showModal: false });
                    // 可以在这里触发刷新或其他回调
                    if (this.props.onUploadComplete) {
                        this.props.onUploadComplete(data);
                    }
                }, 1000);
            }
        }
    };
    
    // 发送数据到iframe
    sendDataToIframe = (message) => {
        const iframe = document.getElementById('cloudUploadIframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(message, '*');
        }
    };
    
    closeModal = () => {
        this.setState({ showModal: false });
    };
    
    // 获取iframe URL地址
    getIframeUrl = () => {
        // 检测是否为开发环境
        const isDevelopment = window.location.hostname === 'localhost' || 
                             window.location.hostname === '127.0.0.1' ||
                             window.location.port === '8000';
        
        // if (isDevelopment) {
        //     return 'http://192.168.3.59:8080/#/growthMap';
        // } else {
            return 'http://172.17.0.1:8088/#/growthMap';
        // }
    };
    
    render() {
        const { disabled } = this.props;
        const { uploading, showModal } = this.state;
        
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
                                <div className="modal-body" style={{ padding: 0, flexShrink: 1, flexGrow: 1,overflow: 'hidden', maxHeight: 10000}}>
                                    <iframe 
                                        id="cloudUploadIframe"
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