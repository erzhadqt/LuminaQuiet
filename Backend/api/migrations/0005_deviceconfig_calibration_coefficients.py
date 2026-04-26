from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0004_noiselog_sensor_values"),
    ]

    operations = [
        migrations.AddField(
            model_name="deviceconfig",
            name="calibration_a",
            field=models.FloatField(default=70.0),
        ),
        migrations.AddField(
            model_name="deviceconfig",
            name="calibration_b",
            field=models.FloatField(default=-160.0),
        ),
    ]
