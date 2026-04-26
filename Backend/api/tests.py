import json
import math
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import DeviceConfig, NoiseLog, Session


class CurrentNoiseApiTests(TestCase):
    def test_post_creates_log_and_returns_payload(self):
        payload = {
            "device_id": "esp32-a",
            "average_level": 63,
            "raw_level": 1810,
            "status": "Medium",
            "state": "Medium",
            "sensor_values": [1700, 1800, 1900],
            "thresholds": {"quiet": 800, "medium": 1200, "loud": 2200},
            "baseline_level": 650,
            "uptime_ms": 15000,
            "wifi_rssi": -58,
        }

        response = self.client.post(
            reverse("current_noise"),
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(NoiseLog.objects.count(), 1)
        self.assertEqual(NoiseLog.objects.first().average_level, 63)
        self.assertEqual(NoiseLog.objects.first().sensor_values, [1700, 1800, 1900])

        data = response.json()["data"]
        self.assertEqual(data["type"], "noise_data")
        self.assertEqual(data["device_id"], "esp32-a")
        self.assertEqual(data["sensor_values"], [1700, 1800, 1900])
        self.assertEqual(data["buzzer_on_loud"], False)

    def test_get_returns_latest_snapshot(self):
        NoiseLog.objects.create(average_level=40, raw_level=900, sensor_values=[900, 880, 910], status="Quiet")
        NoiseLog.objects.create(average_level=70, raw_level=2500, sensor_values=[2300, 2400, 2500], status="Loud/Warning")

        response = self.client.get(reverse("current_noise"))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["average_level"], 70)
        self.assertEqual(data["status"], "Loud/Warning")
        self.assertEqual(data["sensor_values"], [2300, 2400, 2500])
        self.assertEqual(data["type"], "noise_data")
        self.assertIn("config", data)

    def test_get_history_respects_limit(self):
        for i in range(5):
            NoiseLog.objects.create(average_level=50 + i, raw_level=1000 + i, status="Medium")

        response = self.client.get(reverse("current_noise") + "?history=1&limit=3")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 3)
        self.assertEqual(len(data["items"]), 3)
        self.assertIn("sensor_values", data["items"][0])
        self.assertIn("config", data)


class DeviceConfigApiTests(TestCase):
    def test_get_device_config_returns_defaults(self):
        response = self.client.get(reverse("device_config"))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["type"], "config_update")
        self.assertEqual(data["config"]["quiet_threshold"], 800)
        self.assertEqual(data["config"]["medium_threshold"], 1500)
        self.assertEqual(data["config"]["loud_threshold"], 2500)
        self.assertIn("thresholds_db", data["config"])
        self.assertEqual(data["config"]["calibration"]["a"], 70.0)
        self.assertEqual(data["config"]["calibration"]["b"], -160.0)
        self.assertEqual(data["config"]["buzzer_on_loud"], False)

    def test_post_device_config_updates_and_persists(self):
        payload = {
            "thresholds": {
                "quiet": 900,
                "medium": 1600,
                "loud": 2700,
            },
            "calibration": {
                "a": 68.5,
                "b": -150.2,
            },
            "buzzer_on_loud": True,
        }

        response = self.client.post(
            reverse("device_config"),
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["config"]["quiet_threshold"], 900)
        self.assertEqual(data["config"]["medium_threshold"], 1600)
        self.assertEqual(data["config"]["loud_threshold"], 2700)
        self.assertEqual(data["config"]["calibration"]["a"], 68.5)
        self.assertEqual(data["config"]["calibration"]["b"], -150.2)
        self.assertEqual(data["config"]["buzzer_on_loud"], True)

        config = DeviceConfig.get_solo()
        self.assertEqual(config.quiet_threshold, 900)
        self.assertEqual(config.medium_threshold, 1600)
        self.assertEqual(config.loud_threshold, 2700)
        self.assertEqual(config.calibration_a, 68.5)
        self.assertEqual(config.calibration_b, -150.2)
        self.assertEqual(config.buzzer_on_loud, True)

    def test_post_device_config_rejects_invalid_order(self):
        payload = {
            "thresholds": {
                "quiet": 2000,
                "medium": 1200,
                "loud": 2500,
            }
        }

        response = self.client.post(
            reverse("device_config"),
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)

    def test_calibrate_device_config_from_reference_samples(self):
        target_a = 28.0
        target_b = -20.0
        samples = []
        for adc in [120, 300, 800, 1400, 2300, 3500]:
            samples.append(
                {
                    "adc": adc,
                    "spl_db": target_a * math.log10(adc) + target_b,
                }
            )

        response = self.client.post(
            reverse("device_config_calibrate"),
            data=json.dumps({"samples": samples}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "calibrated")
        self.assertEqual(payload["sample_count"], len(samples))
        self.assertLess(payload["rmse_db"], 0.001)

        config = DeviceConfig.get_solo()
        self.assertAlmostEqual(config.calibration_a, target_a, places=3)
        self.assertAlmostEqual(config.calibration_b, target_b, places=3)

    def test_calibrate_device_config_rejects_invalid_samples(self):
        response = self.client.post(
            reverse("device_config_calibrate"),
            data=json.dumps({"samples": [{"adc": 0, "spl_db": 60}]}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())


class SessionModelTests(TestCase):
    def test_prevents_overlapping_sessions(self):
        Session.objects.create(
            started_at=timezone.now(),
            duration_seconds=600,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2000,
            is_active=True,
        )

        with self.assertRaises(ValidationError):
            Session.objects.create(
                started_at=timezone.now() + timedelta(seconds=60),
                duration_seconds=300,
                quiet_threshold=850,
                medium_threshold=1300,
                high_threshold=2100,
                is_active=True,
            )

    def test_allows_overlap_with_inactive_sessions(self):
        Session.objects.create(
            started_at=timezone.now(),
            duration_seconds=600,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2000,
            is_active=False,
        )

        session = Session.objects.create(
            started_at=timezone.now() + timedelta(seconds=60),
            duration_seconds=300,
            quiet_threshold=850,
            medium_threshold=1300,
            high_threshold=2100,
            is_active=True,
        )

        self.assertTrue(session.is_active)


class SessionApiTests(TestCase):
    def test_list_sessions_returns_all_sessions(self):
        older = Session.objects.create(
            started_at=timezone.now() - timedelta(hours=2),
            duration_seconds=900,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2100,
            is_active=False,
        )
        newer = Session.objects.create(
            started_at=timezone.now() - timedelta(hours=1),
            duration_seconds=1200,
            quiet_threshold=850,
            medium_threshold=1300,
            high_threshold=2200,
            is_active=False,
        )

        NoiseLog.objects.create(
            session=older,
            average_level=82,
            raw_level=3000,
            previous_status="Medium",
            status="High",
        )

        response = self.client.get(reverse("list_sessions"))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 2)
        self.assertEqual(payload["items"][0]["id"], newer.id)
        self.assertEqual(payload["items"][1]["id"], older.id)
        self.assertEqual(payload["items"][1]["high_event_count"], 1)

    def test_start_session_creates_active_session(self):
        payload = {
            "duration_seconds": 900,
            "thresholds": {
                "quiet": 900,
                "medium": 1600,
                "high": 2600,
            },
        }

        response = self.client.post(
            reverse("start_session"),
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Session.objects.filter(is_active=True).count(), 1)
        data = response.json()
        self.assertEqual(data["status"], "started")
        self.assertEqual(data["session"]["thresholds"]["high"], 2600)
        self.assertIn("thresholds_db", data["session"])
        self.assertTrue(data["session"]["buzzer_on_loud"])

    def test_start_session_accepts_db_thresholds(self):
        payload = {
            "duration_seconds": 900,
            "thresholds_db": {
                "quiet": 55,
                "medium": 68,
                "high": 80,
            },
        }

        response = self.client.post(
            reverse("start_session"),
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["status"], "started")
        self.assertEqual(data["session"]["thresholds_db"]["quiet"], 55)
        self.assertEqual(data["session"]["thresholds_db"]["medium"], 68)
        self.assertEqual(data["session"]["thresholds_db"]["high"], 80)

        session = Session.objects.get(pk=data["session"]["id"])
        self.assertTrue(session.quiet_threshold < session.medium_threshold < session.high_threshold)

    def test_start_session_rejects_when_active_exists(self):
        Session.objects.create(
            duration_seconds=600,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2000,
            is_active=True,
        )

        payload = {
            "duration_seconds": 600,
            "thresholds": {"quiet": 850, "medium": 1300, "high": 2200},
        }
        response = self.client.post(
            reverse("start_session"),
            data=json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

    def test_current_session_returns_idle_without_active_session(self):
        response = self.client.get(reverse("current_session"))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["status"], "idle")

    def test_current_session_returns_active_payload(self):
        Session.objects.create(
            duration_seconds=600,
            quiet_threshold=820,
            medium_threshold=1400,
            high_threshold=2300,
            is_active=True,
        )

        response = self.client.get(reverse("current_session"))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "active")
        self.assertEqual(data["session"]["thresholds"]["medium"], 1400)
        self.assertTrue(data["session"]["buzzer_on_loud"])

    def test_stop_session_marks_active_session_inactive(self):
        session = Session.objects.create(
            duration_seconds=600,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2100,
            is_active=True,
        )

        response = self.client.post(reverse("stop_session"))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "stopped")
        self.assertEqual(payload["session"]["id"], session.id)
        session.refresh_from_db()
        self.assertFalse(session.is_active)
        self.assertLessEqual(session.ends_at, timezone.now())

    def test_can_start_new_session_after_stop(self):
        existing_session = Session.objects.create(
            duration_seconds=3600,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2100,
            is_active=True,
        )

        stop_response = self.client.post(reverse("stop_session"))
        self.assertEqual(stop_response.status_code, 200)

        start_payload = {
            "duration_seconds": 900,
            "thresholds": {
                "quiet": 850,
                "medium": 1300,
                "high": 2200,
            },
        }
        start_response = self.client.post(
            reverse("start_session"),
            data=json.dumps(start_payload),
            content_type="application/json",
        )

        self.assertEqual(start_response.status_code, 201)
        existing_session.refresh_from_db()
        self.assertFalse(existing_session.is_active)
        self.assertEqual(Session.objects.filter(is_active=True).count(), 1)

    def test_stop_session_returns_idle_when_no_active_session(self):
        response = self.client.post(reverse("stop_session"))

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["status"], "idle")

    def test_create_log_requires_active_session(self):
        response = self.client.post(
            reverse("create_log"),
            data=json.dumps({"state": "High"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(NoiseLog.objects.count(), 0)

    def test_create_log_dedupes_repeated_state(self):
        Session.objects.create(
            duration_seconds=600,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2100,
            is_active=True,
        )

        payload = {
            "device_id": "esp32-luminaquiet-01",
            "from_state": "Medium",
            "to_state": "High",
            "average_level": 84,
            "raw_level": 3100,
            "sensor_values": [3011, 3122, 3201],
            "quiet_duration_ms": 1200,
        }

        first = self.client.post(
            reverse("create_log"),
            data=json.dumps(payload),
            content_type="application/json",
        )
        second = self.client.post(
            reverse("create_log"),
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["status"], "ignored")
        self.assertEqual(second.json()["data"]["type"], "live_sample")
        self.assertEqual(second.json()["data"]["sensor_values"], [3011, 3122, 3201])
        self.assertEqual(NoiseLog.objects.count(), 1)

    def test_create_log_persists_quiet_duration(self):
        session = Session.objects.create(
            duration_seconds=600,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2100,
            is_active=True,
        )

        payload = {
            "device_id": "esp32-luminaquiet-01",
            "from_state": "High",
            "to_state": "Quiet",
            "average_level": 41,
            "raw_level": 950,
            "sensor_values": [920, 940, 965],
            "quiet_duration_ms": 4500,
        }

        response = self.client.post(
            reverse("create_log"),
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        created = NoiseLog.objects.get(session=session)
        self.assertEqual(created.quiet_duration_ms, 4500)
        self.assertEqual(created.sensor_values, [920, 940, 965])
        self.assertEqual(created.previous_status, "High")
        self.assertEqual(created.status, "Quiet")

    def test_get_logs_returns_session_only_details_with_threshold_hits(self):
        session = Session.objects.create(
            duration_seconds=600,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2100,
            is_active=True,
        )

        other_session = Session.objects.create(
            started_at=timezone.now() + timedelta(hours=2),
            duration_seconds=600,
            quiet_threshold=850,
            medium_threshold=1300,
            high_threshold=2200,
            is_active=False,
        )

        NoiseLog.objects.create(
            session=other_session,
            device_id="esp32-luminaquiet-99",
            average_level=55,
            raw_level=1400,
            sensor_values=[1300, 1200, 1250],
            previous_status="Quiet",
            status="Medium",
            quiet_duration_ms=900,
        )

        self.client.post(
            reverse("create_log"),
            data=json.dumps(
                {
                    "device_id": "esp32-luminaquiet-01",
                    "from_state": "Quiet",
                    "to_state": "Medium",
                    "average_level": 67,
                    "raw_level": 1700,
                    "sensor_values": [1600, 1690, 1710],
                    "quiet_duration_ms": 1100,
                }
            ),
            content_type="application/json",
        )
        self.client.post(
            reverse("create_log"),
            data=json.dumps(
                {
                    "device_id": "esp32-luminaquiet-01",
                    "from_state": "Medium",
                    "to_state": "High",
                    "average_level": 82,
                    "raw_level": 2900,
                    "sensor_values": [2820, 2910, 2950],
                    "quiet_duration_ms": 0,
                }
            ),
            content_type="application/json",
        )

        response = self.client.get(reverse("create_log") + f"?session_id={session.id}&limit=50")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["session"]["id"], session.id)
        self.assertEqual(data["count"], 2)
        self.assertTrue(all(item["session_id"] == session.id for item in data["items"]))
        self.assertIsNotNone(data["threshold_hits"]["medium_reached_at"])
        self.assertIsNotNone(data["threshold_hits"]["high_reached_at"])

    def test_get_logs_high_only_returns_high_events(self):
        session = Session.objects.create(
            duration_seconds=600,
            quiet_threshold=800,
            medium_threshold=1200,
            high_threshold=2100,
            is_active=True,
        )

        NoiseLog.objects.create(
            session=session,
            average_level=58,
            raw_level=1500,
            previous_status="Quiet",
            status="Medium",
        )
        NoiseLog.objects.create(
            session=session,
            average_level=83,
            raw_level=3100,
            previous_status="Medium",
            status="High",
        )
        NoiseLog.objects.create(
            session=session,
            average_level=86,
            raw_level=3200,
            previous_status="High",
            status="Loud/Warning",
        )

        response = self.client.get(reverse("create_log") + f"?session_id={session.id}&high_only=1")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["high_only"])
        self.assertEqual(payload["count"], 2)
        self.assertTrue(all("high" in item["status"].lower() or "loud" in item["status"].lower() for item in payload["items"]))
        self.assertIsNone(payload["threshold_hits"]["medium_reached_at"])
        self.assertIsNotNone(payload["threshold_hits"]["high_reached_at"])
