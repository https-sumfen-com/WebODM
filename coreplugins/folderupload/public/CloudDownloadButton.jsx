import React from 'React';
import $ from 'jquery';
import Workers from './Workers';

class CloudDownloadButton extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            downloading: false,
            // ipConfig: '192.168.3.249', // TODO: 配置IP地址
            ipConfig: 'localhost',
            progress: null,
            error: ""
        };
    }

    // 多光谱类型的资源文件下载
    handleMultispectralDownload = async (resourceKey, resourceItem) => {
        const { record } = this.props;
        const { ipConfig } = this.state;
        
        this.setState({ downloading: true });
        
        try {
            // 构建下载URL，使用7700端口
            const ip = ipConfig;
            const downUrl = `${record.output_dir}/${resourceItem.tif}`;
            
            // 使用 Workers 中的统一下载方法
            Workers.downloadWithCustomEvent(downUrl, { 
                ip: ip, 
                port: '7700' 
            });
            
        } catch (error) {
            console.error('多光谱下载错误:', error);
            alert('下载失败，请稍后重试');
        } finally {
            this.setState({ downloading: false });
        }
    }

    // 获取token,Cid
    GetTokenCid = (type) => {
        var system_config = "";
        var company_config = "";
        var user_config = "";

        if (window.localStorage.getItem('system_config')) {
            let systemConfig = window.localStorage.getItem('system_config');
            system_config = systemConfig ? JSON.parse(systemConfig) : "";
        }
        if (window.localStorage.getItem('userInfo')) {
            let userInfo = window.localStorage.getItem('userInfo');
            user_config = userInfo ? JSON.parse(userInfo) : "";
        }
        if (window.localStorage.getItem('companyInfo')) {
            let companyInfo = window.localStorage.getItem('companyInfo');
            company_config = companyInfo ? JSON.parse(companyInfo) : "";
        }

        let value = {
            token: system_config?.token || 'f5da30d4b4bf782a005a1e6b3b180bd8',
            cid: (company_config && company_config?.id) ? company_config.id : '288',
            "entity-id": window.localStorage.getItem('entity-id') || '1',
            "terminal-id": window.localStorage.getItem('terminal-id') || '410',
            service_type_name: 'growth_trend_analysis'  //传入：growth_trend_analysis（长势分析）  或 3d_phenotype（三维表型）
        }
        return value[type];
    }

    // RGB下载功能 - 使用原有下载逻辑
    handleRgbDownload = () => {
        const { task } = this.props;
        const { ipConfig } = this.state;
        
        this.setState({ downloading: true, error: "", progress: null });
        
        const projectId = task.project || task.projectId;
        // TODO 测试写死
        const taskId = task.id;
        const url = `http://${ipConfig}:8000/api/projects/${projectId}/tasks/${taskId}/orthophoto/export`;
        
        const data = {
            format: 'gtiff',
            epsg: '4326'
        };
        
        this.exportReq = $.ajax({
            type: 'POST',
            url: url,
            data: data
        }).done(result => {
            if (result.celery_task_id) {
                Workers.waitForCompletion(result.celery_task_id, error => {
                    if (error) {
                        this.setState({ downloading: false, error });
                    } else {
                        this.setState({ downloading: false });
                        Workers.downloadFile(result.celery_task_id, result.filename);
                    }
                }, (_, progress) => {
                    this.setState({ progress });
                });
            } else if (result.url) {
                // Simple download - 使用 Workers 统一下载方法
                this.setState({ downloading: false });
                const downUrl = `${result.url}?filename=${result.filename}`;
                Workers.downloadWithCustomEvent(downUrl, { useFullUrl: true });
            } else if (result.error) {
                this.setState({ downloading: false, error: result.error });
            } else {
                let error = `Invalid JSON response: ${JSON.stringify(result)}`;
                this.setState({ downloading: false, error });
            }
        }).fail(error => {
            error = (error.responseJSON || {})[0] || JSON.stringify(error);
            this.setState({ downloading: false, error });
        });
    }

    // DSM下载功能 - 使用原有下载逻辑
    handleDsmDownload = () => {
        const { task } = this.props;
        const { ipConfig } = this.state;
        
        this.setState({ downloading: true, error: "", progress: null });
        
        const projectId = task.project || task.projectId;
        // TODO 测试写死
        const taskId = task.id;
        const url = `http://${ipConfig}:8000/api/projects/${projectId}/tasks/${taskId}/dsm/export`;
        
        const data = {
            hillshade: '6',
            color_map: 'viridis',
            format: 'gtiff',
            epsg: '4326'
        };
        
        this.exportReq = $.ajax({
            type: 'POST',
            url: url,
            data: data
        }).done(result => {
            if (result.celery_task_id) {
                Workers.waitForCompletion(result.celery_task_id, error => {
                    if (error) {
                        this.setState({ downloading: false, error });
                    } else {
                        this.setState({ downloading: false });
                        Workers.downloadFile(result.celery_task_id, result.filename);
                    }
                }, (_, progress) => {
                    this.setState({ progress });
                });
            } else if (result.url) {
                // Simple download - 使用 Workers 统一下载方法
                this.setState({ downloading: false });
                const downUrl = `${result.url}?filename=${result.filename}`;
                Workers.downloadWithCustomEvent(downUrl, { useFullUrl: true });
            } else if (result.error) {
                this.setState({ downloading: false, error: result.error });
            } else {
                let error = `Invalid JSON response: ${JSON.stringify(result)}`;
                this.setState({ downloading: false, error });
            }
        }).fail(error => {
            error = (error.responseJSON || {})[0] || JSON.stringify(error);
            this.setState({ downloading: false, error });
        });
    }

    componentWillUnmount() {
        if (this.exportReq) this.exportReq.abort();
    }

    render() {
        const { disabled, record, task } = this.props;
        const { downloading, progress, error } = this.state;

        // 判断作业类型
        const isRgbType = record?.job?.odm_job_type === 'rgb';
        const isMultispectralType = record?.job?.odm_job_type === 'multispectral';
        const resourceFiles = record?.resource_files || {};
        
        // 判断是否有DSM资源
        const hasDsm = task?.available_assets?.includes('dsm.tif');

        return (
            <div style={{display: 'inline-block'}}>
                <div className="btn-group">
                    <button
                        type="button"
                        className="btn btn-sm btn-success dropdown-toggle"
                        data-toggle="dropdown"
                        disabled={disabled || downloading}
                        aria-haspopup="true"
                        aria-expanded="false"
                    >
                        <i className="fa fa-download"></i>
                        <span className="hidden-xs">
                            {downloading ? (progress ? ` 下载中...` : ' 下载中...') : ' 下载'}
                        </span>
                        <span className="caret" style={{marginLeft: '10px'}}></span>
                    </button>
                    
                    <ul className="dropdown-menu dropdown-menu-left">
                        {isRgbType && (
                            <li>
                                <a href="#" onClick={(e) => {
                                    e.preventDefault();
                                    this.handleRgbDownload();
                                }}>
                                    RGB下载
                                </a>
                            </li>
                        )}
                        
                        {isRgbType && hasDsm && (
                            <li>
                                <a href="#" onClick={(e) => {
                                    e.preventDefault();
                                    this.handleDsmDownload();
                                }}>
                                    DSM下载
                                </a>
                            </li>
                        )}
                        
                        {isMultispectralType && Object.keys(resourceFiles).map(resourceKey => {
                            const resourceItem = resourceFiles[resourceKey];
                            if (resourceItem.tif) {
                                return (
                                    <li key={resourceKey}>
                                        <a href="#" onClick={(e) => {
                                            e.preventDefault();
                                            this.handleMultispectralDownload(resourceKey, resourceItem);
                                        }}>
                                            {resourceKey}_TIF下载
                                        </a>
                                    </li>
                                );
                            }
                            return null;
                        })}
                        
                        {isMultispectralType && hasDsm && (
                            <li>
                                <a href="#" onClick={(e) => {
                                    e.preventDefault();
                                    this.handleDsmDownload();
                                }}>
                                    DSM下载
                                </a>
                            </li>
                        )}
                        
                        {!isRgbType && !isMultispectralType && (
                            <li>
                                <a href="#" className="disabled">
                                    暂无可下载内容
                                </a>
                            </li>
                        )}
                    </ul>
                </div>
                
                {error && (
                    <div className="alert alert-warning alert-dismissible" style={{marginTop: '10px'}}>
                        <button type="button" className="close" onClick={() => this.setState({error: ""})}>
                            <span>&times;</span>
                        </button>
                        <strong>下载错误:</strong> {error}
                    </div>
                )}
            </div>
        );
    }
}

export default CloudDownloadButton;