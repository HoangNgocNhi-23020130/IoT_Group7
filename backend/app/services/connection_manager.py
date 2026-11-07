"""WebSocket Connection Manager for real-time frontend streaming."""

from __future__ import annotations

import logging
from typing import Any, Dict, List
from fastapi import WebSocket

logger = logging.getLogger("marine.ws")


class ConnectionManager:
    """Manages active WebSocket client connections and broadcasts real-time events."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Total clients: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Remaining clients: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast a JSON message to all connected clients. Purges dead sockets."""
        dead_sockets: List[WebSocket] = []
        for socket in self.active_connections:
            try:
                await socket.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket client: {e}")
                dead_sockets.append(socket)

        for dead in dead_sockets:
            self.disconnect(dead)


ws_manager = ConnectionManager()
