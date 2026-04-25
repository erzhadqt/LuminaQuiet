import json

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import DeviceConfig, NoiseLog

GROUP_NAME = "noise_updates"


def coerce_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def coerce_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def parse_json_payload(raw_body):
    if raw_body is None:
        return {}
    if isinstance(raw_body, dict):
        return raw_body
    if isinstance(raw_body, (bytes, bytearray)):
        raw_body = raw_body.decode("utf-8")
    if isinstance(raw_body, str):
        if not raw_body.strip():
            return {}
        return json.loads(raw_body)
    return {}


def _validate_thresholds(quiet_threshold, medium_threshold, loud_threshold):
    if not 0 <= quiet_threshold <= 4095:
        raise ValueError("quiet threshold must be between 0 and 4095")
    if not 0 <= medium_threshold <= 4095:
        raise ValueError("medium threshold must be between 0 and 4095")
    if not 0 <= loud_threshold <= 4095:
        raise ValueError("loud threshold must be between 0 and 4095")

    if not (quiet_threshold < medium_threshold < loud_threshold):
        raise ValueError("threshold ordering must satisfy quiet < medium < loud")


def _parse_sensor_values(values):
    if not isinstance(values, list):
        return []
    return [coerce_int(value, 0) for value in values[:8]]


def serialize_config(config):
    return {
        "quiet_threshold": config.quiet_threshold,
        "medium_threshold": config.medium_threshold,
        "loud_threshold": config.loud_threshold,
        "buzzer_on_loud": config.buzzer_on_loud,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
        "thresholds": {
            "quiet": config.quiet_threshold,
            "medium": config.medium_threshold,
            "loud": config.loud_threshold,
        },
    }


def get_device_config_payload():
    return serialize_config(DeviceConfig.get_solo())


def update_device_config(raw_payload):
    payload = parse_json_payload(raw_payload)
    config = DeviceConfig.get_solo()

    incoming_thresholds = payload.get("thresholds", payload)

    quiet_threshold = coerce_int(
        incoming_thresholds.get("quiet", incoming_thresholds.get("quiet_threshold", config.quiet_threshold)),
        config.quiet_threshold,
    )
    medium_threshold = coerce_int(
        incoming_thresholds.get("medium", incoming_thresholds.get("medium_threshold", config.medium_threshold)),
        config.medium_threshold,
    )
    loud_threshold = coerce_int(
        incoming_thresholds.get("loud", incoming_thresholds.get("loud_threshold", config.loud_threshold)),
        config.loud_threshold,
    )

    buzzer_on_loud = coerce_bool(
        payload.get("buzzer_on_loud", payload.get("buzzerEnabled", config.buzzer_on_loud)),
        config.buzzer_on_loud,
    )

    _validate_thresholds(quiet_threshold, medium_threshold, loud_threshold)

    config.quiet_threshold = quiet_threshold
    config.medium_threshold = medium_threshold
    config.loud_threshold = loud_threshold
    config.buzzer_on_loud = buzzer_on_loud
    config.save(update_fields=[
        "quiet_threshold",
        "medium_threshold",
        "loud_threshold",
        "buzzer_on_loud",
        "updated_at",
    ])

    return serialize_config(config)


def create_noise_event(raw_payload):
    payload = parse_json_payload(raw_payload)
    config = DeviceConfig.get_solo()

    average_level = coerce_int(payload.get("average_level"), 0)
    raw_level = coerce_int(payload.get("raw_level"), 0)
    status = str(payload.get("status") or payload.get("state") or "Unknown")[:50]
    device_id = str(payload.get("device_id", "esp32-node"))[:64]
    state = str(payload.get("state") or status)[:50]

    baseline_level = coerce_int(payload.get("baseline_level"), 0)
    uptime_ms = coerce_int(payload.get("uptime_ms"), 0)
    wifi_rssi = coerce_int(payload.get("wifi_rssi"), 0)
    sensor_values = _parse_sensor_values(payload.get("sensor_values", []))

    log = NoiseLog.objects.create(
        device_id=device_id,
        average_level=average_level,
        raw_level=raw_level,
        sensor_values=sensor_values,
        previous_status=str(payload.get("previous_status") or payload.get("from_state") or "")[:50],
        status=status,
        quiet_duration_ms=max(0, coerce_int(payload.get("quiet_duration_ms"), 0)),
    )

    config_payload = serialize_config(config)

    return {
        "type": "noise_data",
        "id": log.id,
        "device_id": device_id,
        "average_level": average_level,
        "raw_level": raw_level,
        "status": status,
        "state": state,
        "baseline_level": baseline_level,
        "thresholds": config_payload["thresholds"],
        "buzzer_on_loud": config_payload["buzzer_on_loud"],
        "config": config_payload,
        "sensor_values": sensor_values,
        "uptime_ms": uptime_ms,
        "wifi_rssi": wifi_rssi,
        "timestamp": log.timestamp.isoformat(),
    }


def build_config_event(config_payload=None, source="server"):
    payload = config_payload or get_device_config_payload()
    return {
        "type": "config_update",
        "source": source,
        "config": payload,
        "thresholds": payload["thresholds"],
        "buzzer_on_loud": payload["buzzer_on_loud"],
        "timestamp": payload.get("updated_at"),
    }


def broadcast_group_event(handler_name, payload):
    channel_layer = get_channel_layer()
    if not channel_layer:
        return

    async_to_sync(channel_layer.group_send)(
        GROUP_NAME,
        {
            "type": handler_name,
            "data": payload,
        },
    )


def broadcast_noise_event(payload):
    broadcast_group_event("send_noise_data", payload)


def broadcast_config_event(payload):
    broadcast_group_event("send_config_update", payload)
