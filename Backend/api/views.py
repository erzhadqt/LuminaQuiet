import json
import math
from django.core.exceptions import ValidationError
from django.db.models import Count, Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import NoiseLog, Session
from .realtime import (
    db_to_adc,
    build_config_event,
    broadcast_config_event,
    broadcast_noise_event,
    create_noise_event,
    get_device_config_payload,
    map_thresholds_to_db,
    update_device_config,
)


def _truthy(value):
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _as_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_sensor_values(values):
    if not isinstance(values, list):
        return []
    return [_as_int(value, 0) for value in values[:8]]


def _as_float(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _fit_log_calibration(samples):
    cleaned = []
    for sample in samples or []:
        if not isinstance(sample, dict):
            continue
        adc = _as_float(sample.get("adc"), None)
        spl_db = _as_float(sample.get("spl_db"), None)
        if adc is None or spl_db is None:
            continue
        if adc <= 0:
            continue
        cleaned.append((adc, spl_db))

    if len(cleaned) < 2:
        raise ValueError("At least 2 valid samples are required (adc > 0, numeric spl_db)")

    n = float(len(cleaned))
    sum_x = 0.0
    sum_y = 0.0
    sum_x2 = 0.0
    sum_xy = 0.0

    for adc, spl_db in cleaned:
        x = math.log10(adc)
        y = spl_db
        sum_x += x
        sum_y += y
        sum_x2 += x * x
        sum_xy += x * y

    denominator = n * sum_x2 - sum_x * sum_x
    if abs(denominator) < 1e-9:
        raise ValueError("Samples do not span enough ADC range to fit calibration")

    calibration_a = (n * sum_xy - sum_x * sum_y) / denominator
    calibration_b = (sum_y - calibration_a * sum_x) / n

    if not math.isfinite(calibration_a) or not math.isfinite(calibration_b):
        raise ValueError("Calibration fit failed: non-finite coefficients")
    if calibration_a <= 0:
        raise ValueError("Calibration fit failed: slope must be positive")

    residual_sum = 0.0
    for adc, spl_db in cleaned:
        estimated = calibration_a * math.log10(adc) + calibration_b
        diff = estimated - spl_db
        residual_sum += diff * diff

    rmse_db = math.sqrt(residual_sum / n)
    return calibration_a, calibration_b, rmse_db, int(n)


def _state_bucket(state_value):
    state = str(state_value or "").strip().lower()
    if not state:
        return ""
    if "high" in state or "loud" in state or "warning" in state:
        return "high"
    if "medium" in state and "low" not in state:
        return "medium"
    return ""


def _is_high_state(state_value):
    return _state_bucket(state_value) == "high"


def _session_payload(session):
    remaining_seconds = max(0, int((session.ends_at - timezone.now()).total_seconds()))
    config_payload = get_device_config_payload()
    calibration = config_payload.get("calibration") or {}
    calibration_a = float(calibration.get("a", 70.0))
    calibration_b = float(calibration.get("b", -160.0))
    thresholds_db = map_thresholds_to_db(
        session.quiet_threshold,
        session.medium_threshold,
        session.high_threshold,
        calibration_a,
        calibration_b,
    )

    return {
        "id": session.id,
        "is_active": session.is_active,
        "started_at": session.started_at.isoformat(),
        "ends_at": session.ends_at.isoformat(),
        "duration_seconds": session.duration_seconds,
        "remaining_seconds": remaining_seconds,
        "quiet_threshold": session.quiet_threshold,
        "medium_threshold": session.medium_threshold,
        "high_threshold": session.high_threshold,
        "quiet_threshold_db": thresholds_db["quiet"],
        "medium_threshold_db": thresholds_db["medium"],
        "high_threshold_db": thresholds_db["high"],
        "thresholds_db": thresholds_db,
        "calibration": {
            "a": calibration_a,
            "b": calibration_b,
        },
        "buzzer_on_loud": True,
        "thresholds": {
            "quiet": session.quiet_threshold,
            "medium": session.medium_threshold,
            "high": session.high_threshold,
        },
    }


def _session_started_event(session):
    return {
        "type": "session_started",
        "session": _session_payload(session),
        "timestamp": timezone.now().isoformat(),
        "reason": "started_by_admin",
    }


def _build_log_payload(log):
    return {
        "id": log.id,
        "type": "state_change",
        "session_id": log.session_id,
        "device_id": log.device_id,
        "from_state": log.previous_status,
        "to_state": log.status,
        "status": log.status,
        "average_level": log.average_level,
        "raw_level": log.raw_level,
        "db_level": getattr(log, 'db_level', 0.0),
        "sensor_values": list(log.sensor_values or []),
        "quiet_duration_ms": log.quiet_duration_ms,
        "timestamp": log.timestamp.isoformat(),
    }


def _build_live_payload(session, device_id, current_state, payload, sensor_values):
    return {
        "id": None,
        "type": "live_sample",
        "session_id": session.id,
        "device_id": device_id,
        "from_state": current_state,
        "to_state": current_state,
        "status": current_state,
        "average_level": _as_int(payload.get("average_level"), 0),
        "raw_level": _as_int(payload.get("raw_level"), 0),
        "db_level": _as_float(payload.get("db_level"), 0.0),
        "sensor_values": sensor_values,
        "quiet_duration_ms": max(0, _as_int(payload.get("quiet_duration_ms"), 0)),
        "uptime_ms": max(0, _as_int(payload.get("uptime_ms"), 0)),
        "wifi_rssi": _as_int(payload.get("wifi_rssi"), 0),
        "timestamp": timezone.now().isoformat(),
    }


def _compute_threshold_hits(session):
    medium_reached_at = None
    high_reached_at = None

    for status_value, timestamp in (
        NoiseLog.objects.filter(session=session)
        .order_by("timestamp")
        .values_list("status", "timestamp")
    ):
        bucket = _state_bucket(status_value)
        if bucket == "medium" and medium_reached_at is None:
            medium_reached_at = timestamp
        if bucket == "high" and high_reached_at is None:
            high_reached_at = timestamp
        if medium_reached_at and high_reached_at:
            break

    return {
        "medium_reached_at": medium_reached_at.isoformat() if medium_reached_at else None,
        "high_reached_at": high_reached_at.isoformat() if high_reached_at else None,
    }


@csrf_exempt
@require_http_methods(["GET", "POST"])
def current_noise(request):
    if request.method == 'POST':
        try:
            noise_event = create_noise_event(request.body)
            broadcast_noise_event(noise_event)
            return JsonResponse({"message": "Data saved and broadcasted", "data": noise_event}, status=201)

        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON payload"}, status=400)
        except ValueError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=400)

    if request.method == 'GET':
        config_payload = get_device_config_payload()

        if _truthy(request.GET.get('history')):
            try:
                limit = int(request.GET.get('limit', 50))
            except ValueError:
                limit = 50
            limit = max(1, min(limit, 500))

            logs = NoiseLog.objects.all()[:limit]
            items = [
                {
                    "id": log.id,
                    "session_id": log.session_id,
                    "device_id": log.device_id,
                    "average_level": log.average_level,
                    "raw_level": log.raw_level,
                    "sensor_values": list(log.sensor_values or []),
                    "previous_status": log.previous_status,
                    "status": log.status,
                    "quiet_duration_ms": log.quiet_duration_ms,
                    "timestamp": log.timestamp.isoformat(),
                }
                for log in logs
            ]
            return JsonResponse({"items": items, "count": len(items), "config": config_payload})

        latest_log = NoiseLog.objects.first()
        if latest_log:
            data = {
                "id": latest_log.id,
                "session_id": latest_log.session_id,
                "device_id": latest_log.device_id,
                "average_level": latest_log.average_level,
                "raw_level": latest_log.raw_level,
                "sensor_values": list(latest_log.sensor_values or []),
                "previous_status": latest_log.previous_status,
                "status": latest_log.status,
                "quiet_duration_ms": latest_log.quiet_duration_ms,
                "timestamp": latest_log.timestamp.isoformat(),
                "type": "noise_data",
            }
        else:
            data = {
                "id": None,
                "average_level": 0,
                "raw_level": 0,
                "sensor_values": [],
                "status": "No Data",
                "timestamp": None,
                "type": "noise_data",
            }

        data["thresholds"] = config_payload["thresholds"]
        data["buzzer_on_loud"] = config_payload["buzzer_on_loud"]
        data["config"] = config_payload

        return JsonResponse(data)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def device_config(request):
    if request.method == "GET":
        config_payload = get_device_config_payload()
        return JsonResponse(build_config_event(config_payload, source="http"))

    try:
        config_payload = update_device_config(request.body)
        event = build_config_event(config_payload, source="http")
        broadcast_config_event(event)
        return JsonResponse(event, status=200)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON payload"}, status=400)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=400)


@csrf_exempt
@require_http_methods(["POST"])
def calibrate_device_config(request):
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON payload"}, status=400)

    samples = payload.get("samples")
    if not isinstance(samples, list):
        return JsonResponse({"error": "samples must be a list"}, status=400)

    try:
        calibration_a, calibration_b, rmse_db, sample_count = _fit_log_calibration(samples)
        config_payload = update_device_config(
            {
                "calibration": {
                    "a": calibration_a,
                    "b": calibration_b,
                }
            }
        )
        event = build_config_event(config_payload, source="calibration")
        broadcast_config_event(event)

        return JsonResponse(
            {
                "status": "calibrated",
                "sample_count": sample_count,
                "rmse_db": round(rmse_db, 4),
                "calibration": config_payload["calibration"],
                "config": config_payload,
            },
            status=200,
        )
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)


@api_view(["POST"])
def start_session(request):
    Session.deactivate_expired()
    if Session.objects.filter(is_active=True).exists():
        return Response(
            {
                "status": "active_exists",
                "detail": "A session is already active. End it before starting a new one.",
            },
            status=status.HTTP_409_CONFLICT,
        )

    payload = request.data or {}
    thresholds = payload.get("thresholds", {})
    thresholds_db = payload.get("thresholds_db", {})
    config_payload = get_device_config_payload()
    calibration = config_payload.get("calibration") or {}
    calibration_a = float(calibration.get("a", 70.0))
    calibration_b = float(calibration.get("b", -160.0))

    duration_seconds = _as_int(payload.get("duration_seconds"), 0)

    has_db_thresholds = any(
        value is not None
        for value in (
            payload.get("quiet_threshold_db"),
            payload.get("medium_threshold_db"),
            payload.get("high_threshold_db"),
            thresholds_db.get("quiet"),
            thresholds_db.get("medium"),
            thresholds_db.get("high"),
        )
    )

    if has_db_thresholds:
        try:
            quiet_db = float(payload.get("quiet_threshold_db", thresholds_db.get("quiet")))
            medium_db = float(payload.get("medium_threshold_db", thresholds_db.get("medium")))
            high_db = float(payload.get("high_threshold_db", thresholds_db.get("high")))
        except (TypeError, ValueError):
            return Response(
                {
                    "errors": {
                        "thresholds_db": ["thresholds_db values must be valid numbers"]
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        quiet_threshold = db_to_adc(quiet_db, calibration_a, calibration_b)
        medium_threshold = db_to_adc(medium_db, calibration_a, calibration_b)
        high_threshold = db_to_adc(high_db, calibration_a, calibration_b)
    else:
        quiet_threshold = _as_int(
            payload.get("quiet_threshold", thresholds.get("quiet")),
            800,
        )
        medium_threshold = _as_int(
            payload.get("medium_threshold", thresholds.get("medium")),
            1500,
        )
        high_threshold = _as_int(
            payload.get("high_threshold", thresholds.get("high")),
            2500,
        )

    try:
        session = Session(
            duration_seconds=duration_seconds,
            quiet_threshold=quiet_threshold,
            medium_threshold=medium_threshold,
            high_threshold=high_threshold,
            is_active=True,
        )
        session.save()
    except ValidationError as exc:
        return Response({"errors": exc.message_dict}, status=status.HTTP_400_BAD_REQUEST)

    broadcast_noise_event(_session_started_event(session))

    return Response(
        {
            "status": "started",
            "session": _session_payload(session),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
def stop_session(request):
    session = Session.get_active()
    if not session:
        return Response(
            {
                "status": "idle",
                "detail": "No active session to stop.",
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    stopped_at = timezone.now()
    Session.objects.filter(pk=session.pk).update(
        is_active=False,
        ends_at=stopped_at,
    )
    session.refresh_from_db()

    # Push immediate stop signal to websocket subscribers (dashboard/ESP32).
    broadcast_noise_event(
        {
            "type": "session_stopped",
            "session_id": session.id,
            "timestamp": stopped_at.isoformat(),
            "reason": "stopped_by_admin",
        }
    )

    return Response(
        {
            "status": "stopped",
            "session": _session_payload(session),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
def current_session(request):
    session = Session.get_active()
    if not session:
        return Response(
            {
                "status": "idle",
                "detail": "No active session.",
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    return Response(
        {
            "status": "active",
            "session": _session_payload(session),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
def list_sessions(request):
    Session.deactivate_expired()

    high_filter = (
        Q(logs__status__icontains="high")
        | Q(logs__status__icontains="loud")
        | Q(logs__status__icontains="warning")
    )
    sessions = (
        Session.objects.order_by("-started_at")
        .annotate(log_count=Count("logs"), high_event_count=Count("logs", filter=high_filter))
    )

    items = []
    for session in sessions:
        payload = _session_payload(session)
        payload["log_count"] = session.log_count
        payload["high_event_count"] = session.high_event_count
        items.append(payload)

    return Response(
        {
            "status": "ok",
            "items": items,
            "count": len(items),
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET", "POST"])
def create_log(request):
    if request.method == "GET":
        Session.deactivate_expired()

        requested_session_id = _as_int(request.query_params.get("session_id"), -1)
        if requested_session_id > 0:
            session = Session.objects.filter(pk=requested_session_id).first()
        else:
            session = Session.get_active()

        if not session:
            return Response(
                {
                    "status": "idle",
                    "detail": "No session found for this request.",
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        limit = max(1, min(_as_int(request.query_params.get("limit"), 150), 500))
        high_only = _truthy(request.query_params.get("high_only"))

        logs = NoiseLog.objects.filter(session=session)
        if high_only:
            logs = logs.filter(
                Q(status__icontains="high")
                | Q(status__icontains="loud")
                | Q(status__icontains="warning")
            )
        logs = list(logs.order_by("-timestamp")[:limit])

        medium_reached_at = None
        high_reached_at = None
        if high_only:
            oldest_high = logs[-1] if logs else None
            high_reached_at = oldest_high.timestamp.isoformat() if oldest_high else None
        else:
            threshold_hits = _compute_threshold_hits(session)
            medium_reached_at = threshold_hits["medium_reached_at"]
            high_reached_at = threshold_hits["high_reached_at"]

        return Response(
            {
                "status": "ok",
                "session": _session_payload(session),
                "high_only": high_only,
                "threshold_hits": {
                    "medium_reached_at": medium_reached_at,
                    "high_reached_at": high_reached_at,
                },
                "items": [_build_log_payload(log) for log in logs],
                "count": len(logs),
            },
            status=status.HTTP_200_OK,
        )

    session = Session.get_active()
    if not session:
        return Response(
            {
                "status": "idle",
                "detail": "No active session. Log rejected.",
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    payload = request.data or {}
    device_id = str(payload.get("device_id") or "esp32-luminaquiet-01")[:64]
    to_state = str(
        payload.get("to_state")
        or payload.get("state")
        or payload.get("status")
        or ""
    )[:50]

    if not to_state:
        return Response(
            {"error": "state or to_state is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    previous = NoiseLog.objects.filter(
        session=session,
        device_id=device_id,
    ).first()

    previous_state = str(
        payload.get("from_state")
        or payload.get("previous_state")
        or (previous.status if previous else "")
    )[:50]

    sensor_values = _parse_sensor_values(payload.get("sensor_values"))
    if not sensor_values and previous:
        sensor_values = list(previous.sensor_values or [])

    if previous and previous.status == to_state:
        live_payload = _build_live_payload(
            session=session,
            device_id=device_id,
            current_state=previous.status,
            payload=payload,
            sensor_values=sensor_values,
        )
        broadcast_noise_event(live_payload)

        return Response(
            {
                "status": "ignored",
                "reason": "duplicate_state",
                "state": to_state,
                "session_id": session.id,
                "data": live_payload,
            },
            status=status.HTTP_200_OK,
        )

    quiet_duration_ms = max(0, _as_int(payload.get("quiet_duration_ms"), 0))
    log = NoiseLog.objects.create(
        session=session,
        device_id=device_id,
        average_level=_as_int(payload.get("average_level"), 0),
        raw_level=_as_int(payload.get("raw_level"), 0),
        sensor_values=sensor_values,
        previous_status=previous_state,
        status=to_state,
        quiet_duration_ms=quiet_duration_ms,
    )

    event_payload = _build_log_payload(log)
    event_payload["uptime_ms"] = max(0, _as_int(payload.get("uptime_ms"), 0))
    event_payload["wifi_rssi"] = _as_int(payload.get("wifi_rssi"), 0)
    broadcast_noise_event(event_payload)

    return Response(
        {
            "status": "logged",
            "data": event_payload,
        },
        status=status.HTTP_201_CREATED,
    )
