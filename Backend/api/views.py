from django.shortcuts import render

import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from .models import NoiseLog

@csrf_exempt
def current_noise(request):
    if request.method == 'POST':
        try:
            body = json.loads(request.body)
            average_level = body.get('average_level', 0)
            raw_level = body.get('raw_level', 0)
            status = body.get('status', 'Unknown')

            # 1. Save to Database
            log = NoiseLog.objects.create(
                average_level=average_level,
                raw_level=raw_level,
                status=status
            )

            # 2. Broadcast to WebSockets
            channel_layer = get_channel_layer()
            data_to_send = {
                "average_level": average_level,
                "raw_level": raw_level,
                "status": status,
                "timestamp": log.timestamp.isoformat()
            }
            
            async_to_sync(channel_layer.group_send)(
                "noise_updates",
                {
                    "type": "send_noise_data", # Matches the method in consumers.py
                    "data": data_to_send
                }
            )

            return JsonResponse({"message": "Data saved and broadcasted"}, status=201)
            
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=400)
            
    # Keep the GET method if you still want to fetch the initial state on page load
    elif request.method == 'GET':
        latest_log = NoiseLog.objects.first()
        if latest_log:
            data = {"average_level": latest_log.average_level, "status": latest_log.status}
        else:
            data = {"average_level": 0, "status": "No Data"}
        return JsonResponse(data)