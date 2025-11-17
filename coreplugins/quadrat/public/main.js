PluginsAPI.Map.willAddControls([
    'quadrat/build/app.js',
    'quadrat/build/app.css'
], function(args, App){
    (async function(){
        const map = args.map
        const apiBase = window.QUADRAT_API_BASE || 'http://localhost:7700'
        let project_id = null, task_id = null
        let task = null
        for (let l in map._layers){
            const layer = map._layers[l]
            const meta = layer && layer[Symbol.for('meta')]
            if (meta && meta.task){ task = meta.task; break }
        }
        if (task){ project_id = task.project; task_id = task.id }
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
