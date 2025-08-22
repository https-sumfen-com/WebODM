import logging
import requests

from app.plugins import PluginBase, Menu, MountPoint
from django.utils.translation import gettext as _
from django.shortcuts import render
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django import forms
from . import config

logger = logging.getLogger('app.logger')


class ConfigurationForm(forms.Form):
    callback_url = forms.URLField(
        label='Callback URL',
        help_text='Enter the callback URL of the gereport app',
        required=True,
    )

    def test_settings(self, request):
        try:
            logger.info("Testing callback URL %s, please wait...", self.cleaned_data.get('callback_url'))
            response = requests.get(self.cleaned_data.get('callback_url'), timeout=3)

            if response.status_code == 200:
                messages.success(request, "Send request successfully")
        except requests.exceptions.RequestException as e:
            messages.error(request, f'An error occured: {e}')

    def save_settings(self):
        config.save(self.cleaned_data)


class Plugin(PluginBase):
    def main_menu(self):
        return [Menu(_("Generate Report"), self.public_url(""), "fa fa-location-arrow")]

    def include_css_files(self):
        return ['style.css']

    def app_mount_points(self):

        @login_required
        def index(request):
            if request.method == "POST":
                form = ConfigurationForm(request.POST)
                test_configuration = request.POST.get("test_configuration")

                if form.is_valid():
                    if test_configuration:
                        form.test_settings(request)
                    else:
                        form.save_settings()
                        messages.success(request, "Settings applied successfully!")
            else:
                config_data = config.load()

                form = ConfigurationForm(initial=config_data)

            return render(request, self.template_path('index.html'), {'form': form, 'title': 'Generate Report'})

        return [
            MountPoint('$', index),
        ]
