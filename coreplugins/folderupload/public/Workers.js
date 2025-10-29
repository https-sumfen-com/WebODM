import $ from 'jquery';
// const IP = '192.168.3.249'; // TODO: 配置IP地址
const IP = 'localhost';

// 统一的 CustomEvent 下载方法
const downloadWithCustomEvent = (downloadUrl, options = {}) => {
    const { 
        ip = IP, 
        port = '8000', 
        useFullUrl = false 
    } = options;
    
    let fullDownloadUrl;
    
    if (useFullUrl) {
        // 如果传入的是完整URL，直接使用
        fullDownloadUrl = downloadUrl;
    } else {
        // 否则构建完整URL
        fullDownloadUrl = `http://${ip}:${port}/${downloadUrl}`;
    }
    
    // 派发 CustomEvent
    window.dispatchEvent(
        new CustomEvent("openFile", {
            detail: { type: "saveFile", files: [fullDownloadUrl] },
        })
    );
};

export default {
    waitForCompletion: (celery_task_id, cb, progress_cb) => {
        const checkUrl = `http://${IP}:8000/api/workers/check/`;
        let errorCount = 0;
        let url = checkUrl + celery_task_id;

        const check = () => {
          $.ajax({
              type: 'GET',
              url
          }).done(result => {
              if (result.error){
                cb(result.error);
              }else if (result.ready){
                cb();
              }else{
                if (typeof progress_cb === "function" && result.progress !== undefined && result.status !== undefined){
                    progress_cb(result.status, result.progress);
                }
                // Retry
                setTimeout(() => check(), 2000);
              }
          }).fail(error => {
              console.warn(error);
              if (errorCount++ < 10) setTimeout(() => check(), 2000);
              else cb(error.statusText);
          });
        };
    
        check();
    },

    downloadFile: (celery_task_id, filename = "") => {
        const downUrl = `api/workers/get/${celery_task_id}?filename=${filename}`;
        downloadWithCustomEvent(downUrl);
    },

    // 导出统一的下载方法供外部使用
    downloadWithCustomEvent: downloadWithCustomEvent,

    getOutput: (celery_task_id, cb, getUrl = `http://${IP}:8000/api/workers/get/`) => {
        let url = getUrl + celery_task_id;
        $.ajax({
            type: 'GET',
            url: url
        }).done(result => {
            if (result.error) cb(result.error);
            else if (result.output !== undefined) cb(null, result.output);
            else cb(new Error("Invalid response: " + JSON.stringify(result)));
        }).fail(cb);
    }
};