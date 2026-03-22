from django.db import models

# Create your models here.

class NoiseLog(models.Model):
    timestamp = models.DateTimeField(auto_now_add=True)
    average_level = models.IntegerField()
    raw_level = models.IntegerField(default=0)
    status = models.CharField(max_length=50, default="Quiet")

    class Meta:
        ordering = ['-timestamp'] # Latest logs appear first

    def __str__(self):
        return f"{self.average_level} dB at {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}"