from app.plugins import MountPoint
from app.plugins import PluginBase

class Plugin(PluginBase):
    def include_js_files(self):
        return ['main.js']

    def build_jsx_components(self):
        return ['app.jsx']

    def api_mount_points(self):
        return []
