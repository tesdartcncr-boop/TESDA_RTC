from fastapi import WebSocket


class ConnectionManager:
  def __init__(self) -> None:
    self.active_connections: set[WebSocket] = set()

  async def connect(self, websocket: WebSocket) -> None:
    await websocket.accept()
    self.active_connections.add(websocket)

  def disconnect(self, websocket: WebSocket) -> None:
    self.active_connections.discard(websocket)

  async def broadcast(self, payload: dict) -> None:
    connections = tuple(self.active_connections)
    if not connections:
      return

    stale_connections: list[WebSocket] = []
    for connection in connections:
      try:
        await connection.send_json(payload)
      except Exception:
        stale_connections.append(connection)

    for stale in stale_connections:
      self.disconnect(stale)

  async def heartbeat(self) -> None:
    if self.active_connections:
      await self.broadcast({"type": "system.heartbeat", "message": "Connection active"})


manager = ConnectionManager()


async def publish_event(event_type: str, message: str, payload: dict | None = None) -> None:
  event_payload = {
    "type": event_type,
    "message": message,
    "payload": payload or {}
  }
  await manager.broadcast(event_payload)
