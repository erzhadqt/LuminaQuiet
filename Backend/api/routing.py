# Backend/api/routing.py
from django.urls import path
from . import consumers

websocket_urlpatterns = [
    path('ws/noise/', consumers.NoiseConsumer.as_asgi()),
]