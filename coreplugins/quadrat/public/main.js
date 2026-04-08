// 开发模式检测
let isDev = false;
const DEV_API_BASE = "http://192.168.3.249:7700";
const DEV_PROJECT_ID = 2;
const DEV_TASK_ID = "271ad056-716e-4a81-a75d-be6ba1904818";

PluginsAPI.Map.willAddControls(
  ["quadrat/build/app.js", "quadrat/build/app.css"],
  function (args, App) {
    (async function () {
      const map = args.map;
      const apiBase = isDev
        ? DEV_API_BASE
        : window.QUADRAT_API_BASE || "http://localhost:7700";
      var tasks = [];
      var ids = {};

      for (var i = 0; i < args.tiles.length; i++) {
        var task = args.tiles[i].meta.task;
        if (!ids[task.id]) {
          tasks.push(task);
          ids[task.id] = true;
        }
      }

      let project_id = null,
        task_id = null;
      if (isDev) {
        // 开发模式：使用固定配置
        project_id = DEV_PROJECT_ID;
        task_id = DEV_TASK_ID;
        console.log("[DEV] Using fixed credentials:", {
          project_id,
          task_id,
          apiBase,
        });
      } else {
        // 生产模式：从任务中获取
        if (tasks.length === 1) {
          project_id = tasks[0].project;
          task_id = tasks[0].id;
        }
      }

      try {
        const r = await fetch(
          `${apiBase}/api/odm/get_report_detail?project_id=${encodeURIComponent(project_id || "")}&task_id=${encodeURIComponent(task_id || "")}`,
        );
        if (r.ok) {
          const data = await r.json();
          if (data) {
            // 注入开发配置的 task（如果在开发模式）
            const injectedTask = isDev
              ? { project: project_id, id: task_id }
              : tasks[0] || null;
            new App(map, injectedTask);
            return;
          }
        }
      } catch (e) {
        console.error("Quadrat plugin error:", e);
      }
      console.warn("Quadrat plugin hidden: no report detail found");
    })();
  },
);
