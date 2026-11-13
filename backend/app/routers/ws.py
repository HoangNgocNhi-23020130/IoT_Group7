"""WebSocket Streaming Router for Real-time Dashboard updates."""

from __future__ import annotations

import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.connection_manager import ws_manager

logger = logging.getLogger("marine.ws_router")
router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Real-time WebSocket stream for Web Console dashboards."""
    await ws_manager.connect(websocket)
    try:
        # Keep connection alive and listen for client messages (e.g. heartbeat ping)
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket client error: {e}")
        ws_manager.disconnect(websocket)

