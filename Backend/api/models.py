from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

# Create your models here.


class DeviceConfig(models.Model):
    singleton_key = models.CharField(max_length=32, unique=True, default="default")
    quiet_threshold = models.IntegerField(default=800)
    medium_threshold = models.IntegerField(default=1500)
    loud_threshold = models.IntegerField(default=2500)
    # Empirical mapping coefficients: dB = a * log10(adc) + b
    calibration_a = models.FloatField(default=70.0)
    calibration_b = models.FloatField(default=-160.0)
    buzzer_on_loud = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Device Configuration"
        verbose_name_plural = "Device Configuration"

    @classmethod
    def get_solo(cls):
        config, _ = cls.objects.get_or_create(singleton_key="default")
        return config

    def __str__(self):
        buzzer_state = "on" if self.buzzer_on_loud else "off"
        return (
            f"Q:{self.quiet_threshold} M:{self.medium_threshold} "
            f"L:{self.loud_threshold} buzzer:{buzzer_state}"
        )


class Session(models.Model):
    started_at = models.DateTimeField(default=timezone.now)
    duration_seconds = models.PositiveIntegerField()
    ends_at = models.DateTimeField(editable=False)

    quiet_threshold = models.IntegerField(default=800)
    medium_threshold = models.IntegerField(default=1500)
    high_threshold = models.IntegerField(default=2500)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-started_at"]

    def clean(self):
        errors = {}

        if self.duration_seconds <= 0:
            errors["duration_seconds"] = "duration_seconds must be greater than 0"

        if not 0 <= self.quiet_threshold <= 4095:
            errors["quiet_threshold"] = "quiet_threshold must be between 0 and 4095"
        if not 0 <= self.medium_threshold <= 4095:
            errors["medium_threshold"] = "medium_threshold must be between 0 and 4095"
        if not 0 <= self.high_threshold <= 4095:
            errors["high_threshold"] = "high_threshold must be between 0 and 4095"

        if not (self.quiet_threshold < self.medium_threshold < self.high_threshold):
            errors["high_threshold"] = "threshold ordering must satisfy quiet < medium < high"

        if self.started_at and self.duration_seconds > 0:
            computed_end = self.started_at + timedelta(seconds=self.duration_seconds)
            overlaps = Session.objects.exclude(pk=self.pk).filter(
                is_active=True,
                started_at__lt=computed_end,
                ends_at__gt=self.started_at,
            )
            if overlaps.exists():
                errors["started_at"] = "session overlaps with an existing session"

        if self.is_active:
            active_exists = Session.objects.exclude(pk=self.pk).filter(
                is_active=True,
                ends_at__gt=timezone.now(),
            )
            if active_exists.exists():
                errors["is_active"] = "another active session already exists"

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.started_at is None:
            self.started_at = timezone.now()
        self.ends_at = self.started_at + timedelta(seconds=self.duration_seconds)
        self.full_clean()
        super().save(*args, **kwargs)

    @classmethod
    def deactivate_expired(cls):
        now = timezone.now()
        cls.objects.filter(is_active=True, ends_at__lte=now).update(is_active=False)

    @classmethod
    def get_active(cls):
        cls.deactivate_expired()
        return cls.objects.filter(is_active=True, ends_at__gt=timezone.now()).order_by("started_at").first()

    def __str__(self):
        return (
            f"Session #{self.pk or 'new'} "
            f"Q/M/H={self.quiet_threshold}/{self.medium_threshold}/{self.high_threshold} "
            f"active={self.is_active}"
        )


class NoiseLog(models.Model):
    session = models.ForeignKey(
        Session,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="logs",
    )
    device_id = models.CharField(max_length=64, default="esp32-luminaquiet-01")
    timestamp = models.DateTimeField(auto_now_add=True)
    average_level = models.IntegerField()
    raw_level = models.IntegerField(default=0)
    sensor_values = models.JSONField(default=list, blank=True)
    previous_status = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=50, default="Quiet")
    quiet_duration_ms = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-timestamp'] # Latest logs appear first

    def __str__(self):
        return (
            f"{self.device_id} {self.previous_status}->{self.status} "
            f"at {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}"
        )