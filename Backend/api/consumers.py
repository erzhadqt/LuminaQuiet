import asyncio
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import NoiseLog, Session

class NoiseConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()
        
        # Add the device to a global broadcast group
        # This allows the frontend to easily listen to "frontend_clients" for live data
        await self.channel_layer.group_add("frontend_clients", self.channel_name)
        
        # Automatically push the current active session state down to the ESP32
        await self.send_current_session()

    async def disconnect(self, close_code):
        # Remove from group when ESP32 disconnects
        await self.channel_layer.group_discard("frontend_clients", self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            
            # 1. Handle Ping
            if data.get("action") == "ping":
                await self.send(text_data=json.dumps({"type": "pong"}))
                return

            # 2. Handle Live Noise Log from ESP32
            if "average_level" in data:
                # Broadcast this exact live data to all listening Frontends immediately!
                await self.channel_layer.group_send(
                    "frontend_clients",
                    {
                        "type": "live_noise_update",
                        "data": data
                    }
                )

                # Save it in the background so the live feed is never delayed.
                asyncio.create_task(self.save_noise_log(data))
                
        except json.JSONDecodeError:
            print("Received invalid JSON over WebSocket")
        except Exception as e:
            print(f"Error processing WS message: {e}")

    # --- Group Send Event Handlers ---
    async def live_noise_update(self, event):
        # Send the broadcasted data down the WebSocket to frontend clients
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
                from_state=data.get("from_state"),
                to_state=data.get("to_state"),
                state=data.get("state"),
                average_level=data.get("average_level"),
                raw_level=data.get("raw_level"),
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
            return {
                "type": "session_started",
                "session": {
                    "id": session.id,
                    "quiet_threshold": session.quiet_threshold,
                    "medium_threshold": session.medium_threshold,
                    "high_threshold": session.high_threshold,
                    "buzzer_on_loud": getattr(session, 'buzzer_on_loud', True)
                }
            }
        return {"type": "session_stopped"}

    async def send_current_session(self):
        """Pushes the active session payload to the connected client."""
        payload = await self.get_active_session_payload()
        await self.send(text_data=json.dumps(payload))