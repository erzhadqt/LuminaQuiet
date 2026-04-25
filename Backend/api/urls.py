# Backend/api/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('current-noise', views.current_noise, name='current_noise_no_slash'),
    path('current-noise/', views.current_noise, name='current_noise'),
    path('device-config', views.device_config, name='device_config_no_slash'),
    path('device-config/', views.device_config, name='device_config'),
    path('sessions/start', views.start_session, name='start_session_no_slash'),
    path('sessions/start/', views.start_session, name='start_session'),
    path('sessions/stop', views.stop_session, name='stop_session_no_slash'),
    path('sessions/stop/', views.stop_session, name='stop_session'),
    path('sessions/current', views.current_session, name='current_session_no_slash'),
    path('sessions/current/', views.current_session, name='current_session'),
    path('logs', views.create_log, name='create_log_no_slash'),
    path('logs/', views.create_log, name='create_log'),
]