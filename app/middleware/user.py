from django.contrib.auth import login
from django.contrib.auth.models import User
from django.utils.deprecation import MiddlewareMixin

from webodm import settings


class LoginDefault(MiddlewareMixin):
    def process_request(self, request):
        if settings.SINGLE_USER_MODE and not request.user.is_authenticated:
            if User.objects.filter(is_superuser=True).count() == 0:
                User.objects.create_superuser('admin', 'admin@localhost', 'admin')

            login(request, User.objects.get(username="admin"), 'django.contrib.auth.backends.ModelBackend')

    def process_response(self, request, response):
        return response
