import json
import asyncio
import redis.asyncio as redis
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from django.conf import settings

from .realtime import GROUP_NAME
from .models import NoiseLog, Session

# Initialize async Redis client. 
# Defaults to localhost, but can be overridden in your settings.py via REDIS_URL
REDIS_URL = getattr(settings, 'REDIS_URL')
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)

class NoiseConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()
        
        # Join the shared noise broadcast group used by HTTP session/config events.
        await self.channel_layer.group_add(GROUP_NAME, self.channel_name)
        
        # --- OPTIMIZATION: Initialize in-memory throttle state ---
        self.last_state = None
        self.last_db_level = 0.0
        
        # --- OPTIMIZATION: Serve Latest State to React Instantly ---
        # Instead of waiting for the ESP32 to break the 2dB threshold, 
        # we fetch the last known state from Redis so the dashboard populates instantly.
        try:
            # Note: For multiple ESP32s, you would extract the device_id from the WS URL path
            latest_data = await redis_client.hgetall("device:esp32-luminaquiet-01:latest")
            if latest_data:
                # Cast string fields back to their appropriate Python types
                latest_data["db_level"] = float(latest_data.get("db_level", 0.0))
                latest_data["raw_level"] = int(latest_data.get("raw_level", 0))
                latest_data["average_level"] = int(latest_data.get("average_level", 0))
                
                await self.send(text_data=json.dumps({
                    "type": "live_noise_update",
                    "data": latest_data
                }))
        except Exception as e:
            print(f"Redis fetch error on connect: {e}")

        # Automatically push the current active session state down to the ESP32
        await self.send_current_session()

    async def disconnect(self, close_code):
        # Remove from the shared broadcast group when the socket disconnects.
        await self.channel_layer.group_discard(GROUP_NAME, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            
            # 1. Handle Ping
            if data.get("action") == "ping":
                await self.send(text_data=json.dumps({"type": "pong"}))
                return

            # 2. Handle Live Noise Log from ESP32
            if "average_level" in data:
                device_id = data.get("device_id", "unknown")
                current_state = data.get("to_state", data.get("state", "Unknown"))
                current_db = float(data.get("db_level", 0.0))

                # --- OPTIMIZATION: THROTTLE GATEKEEPER ---
                # Check memory before touching Redis or the Database
                state_changed = current_state != self.last_state
                db_changed = abs(current_db - self.last_db_level) > 2.0

                if state_changed or db_changed:
                    # Update local consumer memory
                    self.last_state = current_state
                    self.last_db_level = current_db

                    # Inject server timestamp if missing
                    if "timestamp" not in data:
                        data["timestamp"] = timezone.now().isoformat()
                    
                    # Ensure unified 'state' key exists for UI consistency
                    data["state"] = current_state

                    # --- OPTIMIZATION: PIPELINED REDIS WRITE ---
                    redis_key = f"device:{device_id}:latest"
                    
                    async with redis_client.pipeline() as pipe:
                        # Update the hash and reset the expiration TTL in one atomic trip
                        pipe.hset(redis_key, mapping={
                            "db_level": current_db,
                            "state": current_state,
                            "timestamp": data["timestamp"],
                            "raw_level": data.get("raw_level", 0),
                            "average_level": data.get("average_level", 0),
                            "session_id": data.get("session_id", -1)
                        })
                        pipe.expire(redis_key, 10)  # 10 second TTL
                        await pipe.execute()

                    # Broadcast immediately so React UI gauge updates in real-time
                    await self.channel_layer.group_send(
                        GROUP_NAME,
                        {
                            "type": "live_noise_update",
                            "data": data
                        }
                    )

                    # Let the database handle its own strict deduplication logic
                    await self.save_noise_log(data)
                
        except json.JSONDecodeError:
            print("Received invalid or truncated JSON over WebSocket")
        except Exception as e:
            print(f"Error processing WS message: {e}")

    # --- Group Send Event Handlers ---
    
    async def live_noise_update(self, event):
        # Send the broadcasted data down the WebSocket to frontend clients
        await self.send(text_data=json.dumps(event["data"]))

    async def send_noise_data(self, event):
        """Handler for noise data broadcasts originating from realtime.py/views.py"""
        await self.send(text_data=json.dumps(event["data"]))

    async def send_config_update(self, event):
        """Handler for config updates originating from realtime.py/views.py"""
        await self.send(text_data=json.dumps(event["data"]))

    # --- Database Helpers ---
    @database_sync_to_async
    def save_noise_log(self, data):
        """Asynchronously saves the ESP32 payload to the PostgreSQL database."""
        try:
            session_id = data.get("session_id")
            session = Session.objects.filter(id=session_id).first() if session_id and session_id != -1 else None

            device_id = data.get("device_id", "unknown")
            to_state = data.get("to_state", data.get("state", "Unknown"))

            # ARCHITECTURE FIX: State Deduplication
            # Prevent the ESP32 from spamming the DB with thousands of duplicate logs.
            # Only save a new database row if the state has actually transitioned.
            previous_log = NoiseLog.objects.filter(session=session, device_id=device_id).order_by('-timestamp').first()
            if previous_log and previous_log.status == to_state:
                return # Skip saving to keep DB clean

            NoiseLog.objects.create(
                session=session,
                device_id=device_id,
                previous_status=data.get("from_state", ""),
                status=to_state,
                average_level=data.get("average_level", 0),
                raw_level=data.get("raw_level", 0),
                db_level=float(data.get("db_level", 0.0)),
                quiet_duration_ms=data.get("quiet_duration_ms", 0),
                sensor_values=data.get("sensor_values", [])
            )
        except Exception as e:
            print(f"Database Error saving NoiseLog: {e}")

    @database_sync_to_async
    def get_active_session_payload(self):
        """Fetches the current active session and formats it exactly how the ESP32 expects it."""
        session = Session.get_active()
        if session:
            from .models import DeviceConfig
            from .realtime import map_thresholds_to_db

            config = DeviceConfig.get_solo()
            thresholds_db = map_thresholds_to_db(
                session.quiet_threshold, 
                session.medium_threshold, 
                session.high_threshold, 
                config.calibration_a, 
                config.calibration_b
            )
            return {
                "type": "session_started",
                "session": {
                    "id": session.id,
                    "quiet_threshold": session.quiet_threshold,
                    "medium_threshold": session.medium_threshold,
                    "high_threshold": session.high_threshold,
                    "quiet_threshold_db": thresholds_db["quiet"],
                    "medium_threshold_db": thresholds_db["medium"],
                    "high_threshold_db": thresholds_db["high"],
                    "buzzer_on_loud": getattr(session, 'buzzer_on_loud', True)
                }
            }
        return {"type": "session_stopped"}

    async def send_current_session(self):
        """Pushes the active session payload to the connected client."""
        payload = await self.get_active_session_payload()
        await self.send(text_data=json.dumps(payload))