from django.contrib import admin
from .models import DeviceConfig, NoiseLog, Session

# Register your models here.

admin.site.register(NoiseLog)


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "started_at",
        "ends_at",
        "duration_seconds",
        "quiet_threshold",
        "medium_threshold",
        "high_threshold",
        "is_active",
    )
    readonly_fields = ("started_at", "ends_at", "created_at")
    list_filter = ("is_active",)


@admin.register(DeviceConfig)
class DeviceConfigAdmin(admin.ModelAdmin):
    list_display = (
        "singleton_key",
        "quiet_threshold",
        "medium_threshold",
        "loud_threshold",
        "buzzer_on_loud",
        "updated_at",
    )
    readonly_fields = ("updated_at",)
