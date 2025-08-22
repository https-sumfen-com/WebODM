def load():
    from app.plugins.functions import get_current_plugin
    plugin = get_current_plugin(only_active=True)
    data_store = plugin.get_global_data_store()

    return {
        'callback_url': data_store.get_string('callback_url', default="http://172.17.0.1:7700/api/odm/generate_report")
    }


def save(data: dict):
    from app.plugins.functions import get_current_plugin
    plugin = get_current_plugin(only_active=True)
    data_store = plugin.get_global_data_store()

    data_store.set_string('callback_url', data.get('callback_url'))
