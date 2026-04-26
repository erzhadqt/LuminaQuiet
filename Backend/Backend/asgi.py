"""
ASGI config for Backend project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/4.2/howto/deployment/asgi/
"""

import os
from django.core.asgi import get_asgi_application

# 1. Set the Django settings module
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'Backend.settings')

# 2. Initialize Django setup immediately
# This MUST happen BEFORE importing any channels or routing code!
django_asgi_app = get_asgi_application()

# 3. Now it is safe to import Channels and your custom routing code
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from api.routing import websocket_urlpatterns

# 4. Define your application
application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AuthMiddlewareStack(
        URLRouter(
            websocket_urlpatterns
        )
    ),
})