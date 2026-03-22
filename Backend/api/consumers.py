import json
from channels.generic.websocket import AsyncWebsocketConsumer

class NoiseConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Join a broadcast group called "noise_updates"
        self.group_name = "noise_updates"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        # Leave the group when React disconnects
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    # Receive message from the group broadcast and send it to React
    async def send_noise_data(self, event):
        data = event['data']
        # Send data to WebSocket
        await self.send(text_data=json.dumps(data))