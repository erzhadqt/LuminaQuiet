import json
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .realtime import (
    build_config_event,
    create_noise_event,
    get_device_config_payload,
    update_device_config,
)


class NoiseConsumer(AsyncWebsocketConsumer):
    GROUP_NAME = "noise_updates"

    async def connect(self):
        # Join shared group used by telemetry broadcasts.
        self.group_name = self.GROUP_NAME
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(text_data=json.dumps({"type": "connection", "status": "connected"}))
        config_payload = await self._load_device_config()
        await self.send(text_data=json.dumps(build_config_event(config_payload, source="connect")))

    async def disconnect(self, close_code):
        # Leave the group when React disconnects
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            payload = json.loads(text_data)
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({"type": "error", "message": "Invalid JSON payload"}))
            return

        action = payload.get("action")

        if action == "ping":
            await self.send(text_data=json.dumps({"type": "pong"}))
            return

        if action == "get_config":
            config_payload = await self._load_device_config()
            await self.send(text_data=json.dumps(build_config_event(config_payload, source="request")))
            return

        if action == "update_config":
            try:
                config_payload = await self._update_device_config(payload)
                event = build_config_event(config_payload, source="ws")
                await self.channel_layer.group_send(
                    self.group_name,
                    {
                        "type": "send_config_update",
                        "data": event,
                    },
                )
            except ValueError as exc:
                await self.send(text_data=json.dumps({"type": "error", "message": str(exc)}))
            return

        if action == "noise_data":
            try:
                noise_event = await self._create_noise_event(payload)
                await self.channel_layer.group_send(
                    self.group_name,
                    {
                        "type": "send_noise_data",
                        "data": noise_event,
                    },
                )
            except ValueError as exc:
                await self.send(text_data=json.dumps({"type": "error", "message": str(exc)}))
            return

        await self.send(text_data=json.dumps({"type": "error", "message": "Unsupported action"}))

    # Receive message from the group broadcast and send it to React
    async def send_noise_data(self, event):
        data = event['data']
        # Send data to WebSocket
        await self.send(text_data=json.dumps(data))

    async def send_config_update(self, event):
        data = event['data']
        await self.send(text_data=json.dumps(data))

    @database_sync_to_async
    def _load_device_config(self):
        return get_device_config_payload()

    @database_sync_to_async
    def _update_device_config(self, payload):
        return update_device_config(payload)

    @database_sync_to_async
    def _create_noise_event(self, payload):
        return create_noise_event(payload)