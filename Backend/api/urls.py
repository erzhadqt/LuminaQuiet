# Backend/api/urls.py
from django.urls import path
from . import views

urlpatterns = [
    path('current-noise', views.current_noise, name='current_noise_no_slash'),
    path('current-noise/', views.current_noise, name='current_noise'),
]