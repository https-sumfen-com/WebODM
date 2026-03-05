# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

WebODM is a **Django + React** web application for processing drone imagery. It acts as a UI and orchestration layer on top of [NodeODM](https://github.com/OpenDroneMap/NodeODM), which runs the actual photogrammetry pipeline (ODM).

Key components:
- **`app/`** — Django application: models, REST API, views, Celery tasks, and all frontend static files
- **`app/api/`** — Django REST Framework viewsets and serializers (projects, tasks, processingnodes, tiler, etc.)
- **`app/models/`** — Django models: `project.py`, `task.py`, `plugin.py`, `preset.py`, `setting.py`, `theme.py`
- **`app/static/app/js/`** — React frontend code; main entrypoints are `Dashboard.jsx`, `MapView.jsx`, `ModelView.jsx`, `Console.jsx`, `main.jsx`
- **`app/static/app/js/components/`** — Shared React components used across the app and plugins
- **`app/plugins/`** — Plugin infrastructure: `plugin_base.py`, `signals.py`, `data_store.py`, `mount_point.py`
- **`coreplugins/`** — Built-in plugins bundled with this fork (including custom `folderupload` and `quadrat`)
- **`webodm/`** — Django project config: `settings.py`, `urls.py`, `wsgi.py`
- **`worker/`** — Celery background tasks
- **`nodeodm/`** — NodeODM API client and models

**Data flow**: Browser → Django API → Celery worker → NodeODM API → ODM processing engine

**Task scheduling**: Celery handles background work (image resizing, result processing). Communication with NodeODM uses a custom ad-hoc scheduler (REST polling, not Celery).

## Development Commands

### Docker-based (recommended)
```bash
./webodm.sh start           # Start production-like environment
./webodm.sh start --dev     # Start with hot-reload (webpack watch + livereload)
./webodm.sh stop
./webodm.sh update
```

### Native Development
```bash
# Start Django dev server (no gunicorn)
./start.sh --no-gunicorn

# Start Celery background worker (required)
./worker.sh start

# Start celery beat scheduler (optional)
./worker.sh scheduler start
```

### Frontend Build
```bash
# Development build with watch
npx webpack --mode development --watch

# Production build
npx webpack --mode production

# Build a specific plugin's JSX (from plugin's public/ directory)
cd coreplugins/<plugin-name>/public
npm install
npx webpack --mode production
```

### Database Migrations
```bash
python manage.py migrate
python manage.py makemigrations
python manage.py collectstatic --noinput
```

## Testing

```bash
# Run all tests (Django + Jest)
npm test

# Run only Jest (JS) tests
npm run qtest

# Run a specific Django test module
python manage.py test app.tests.test_api
python manage.py test app.tests.test_api_task

# Run a single Jest test file
npx jest app/static/app/js/tests/Dashboard.test.jsx
```

Django test files live in `app/tests/`. Jest test files live in `app/static/app/js/tests/`.

## Plugin System

Plugins extend WebODM without modifying core code. Each plugin in `coreplugins/<name>/` or `app/media/plugins/<name>/` has:

- `plugin.py` — extends `PluginBase`, defines `include_js_files()`, `build_jsx_components()`, `app_mount_points()`, `api_mount_points()`
- `manifest.json` — plugin metadata
- `public/` — JSX/JS source files, compiled to `public/build/` via a local `webpack.config.js`

Plugin webpack configs reference WebODM's root `node_modules` via path-based hacks and must use `libraryTarget: "amd"`. The `webodm` alias in plugin webpack resolves to `app/static/app/js/` (the shared React components).

**This fork's custom plugins:**
- `folderupload` — Replaces the default "New Task" button. Supports folder selection, RGB/multispectral task types, a calibration workflow (polygon drawing on TIF bands), and cloud upload. Built components: `NewTaskButton.jsx`, `UploadTaskList.jsx`, `CloudUploadButton.jsx`.
- `quadrat` — Sample plot (样方) visualization in map view.

## Configuration

Local settings override: create `webodm/local_settings.py` (gitignored). This is the standard place for database credentials in native installs.

Key environment variables:
- `WO_DEBUG` — `YES`/`NO` (default `YES`)
- `WO_DEV` — `YES`/`NO`
- `WO_BROKER` — Redis URL (default `redis://localhost`)
- `WO_DATABASE_*` — `NAME`, `USER`, `PASSWORD`, `HOST`, `PORT`
- `WO_SSL` — `YES`/`NO`
- `WO_SECRET_KEY` — Django secret key

## Tech Stack Versions

- Python 3 / Django with PostGIS backend
- React 16 (externalized as global — not bundled via npm in core app)
- Webpack 5 for bundling
- Celery + Redis for background tasks
- PostgreSQL + PostGIS for geospatial data
- GDAL ≥ 3 for raster/vector processing
- JWT authentication via `rest_framework_jwt`
- Django REST Framework with `rest_framework_nested` for nested routers

## REST API Structure

Base path: `/api/`

- `GET/POST /api/projects/` — Projects list
- `GET/POST /api/projects/{id}/tasks/` — Tasks under a project
- `GET /api/projects/{id}/tasks/{id}/download/{asset}` — Download task outputs
- `GET /api/projects/{id}/tasks/{id}/{tile_type}/tiles/{z}/{x}/{y}` — Map tile serving
- `POST /api/token-auth/` — JWT token authentication
- `GET /api/plugins/{plugin_name}/...` — Plugin-specific API endpoints

API docs: http://localhost:8000/api/schema/
