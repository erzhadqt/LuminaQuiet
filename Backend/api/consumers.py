# Backend/api/consumers.py
import asyncio
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .realtime import GROUP_NAME
from .models import NoiseLog, Session

class NoiseConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()
        
        # Join the shared noise broadcast group used by HTTP session/config events.
        await self.channel_layer.group_add(GROUP_NAME, self.channel_name)
        
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
                # FIX: Broadcast immediately so React UI gauge updates in real-time
                await self.channel_layer.group_send(
                    GROUP_NAME,
                    {
                        "type": "live_noise_update",
                        "data": data
                    }
                )

                # FIX: Await the DB save to prevent Python Garbage Collection 
                # from killing the un-referenced asyncio task in production
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

            NoiseLog.objects.create(
                session=session,
                device_id=data.get("device_id", "unknown"),
                # FIX: Map the JSON payload keys to the correct Django Model fields
                previous_status=data.get("from_state", ""),
                status=data.get("to_state", data.get("state", "Unknown")),
                average_level=data.get("average_level", 0),
                raw_level=data.get("raw_level", 0),
                quiet_duration_ms=data.get("quiet_duration_ms", 0),
                uptime_ms=data.get("uptime_ms", 0),
                wifi_rssi=data.get("wifi_rssi", 0),
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