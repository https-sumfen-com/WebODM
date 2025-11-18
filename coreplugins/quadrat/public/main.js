PluginsAPI.Map.willAddControls([
    'quadrat/build/app.js',
    'quadrat/build/app.css'
], function(args, App){
    (async function(){
        const map = args.map
        const apiBase = window.QUADRAT_API_BASE || 'http://localhost:7700'
        var tasks = [];
        var ids = {};
        
        for (var i = 0; i < args.tiles.length; i++){
            var task = args.tiles[i].meta.task;
            if (!ids[task.id]){
                tasks.push(task);
                ids[task.id] = true;
            }
        }
        console.log(tasks)
        if (tasks.length === 1){ project_id = tasks[0].project; task_id = tasks[0].id }
        try{
            const r = await fetch(`${apiBase}/api/odm/get_report_detail?project_id=${encodeURIComponent(project_id||'')}&task_id=${encodeURIComponent(task_id||'')}`)
            if (r.ok){
                const data = await r.json()
                if (data){ new App(map); return }
            }
        }catch(e){}
        console.warn('Quadrat plugin hidden: no report detail found')
    })()
});
