"""
REST + WebSocket для глобальной очереди задач.
WS /ws/app транслирует все события queue и comfy клиентам.
"""
import asyncio
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from task_queue import queue


router = APIRouter(prefix="/api/queue", tags=["queue"])


class SubmitTaskRequest(BaseModel):
    projectName: str
    sceneId: str
    seed: int | None = None


@router.post("/submit")
async def submit_task(req: SubmitTaskRequest):
    try:
        task = await queue.submit(
            project_name=req.projectName,
            scene_id=req.sceneId,
            seed=req.seed,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return task


@router.get("")
async def get_queue():
    """Текущее состояние очереди (для восстановления после F5)."""
    return {
        "tasks": queue.get_all(),
        "active": queue.active,
    }


@router.delete("/{task_id}")
async def remove_task(task_id: str):
    ok = await queue.remove(task_id)
    if not ok:
        raise HTTPException(404, "task not found or is running")
    return {"ok": True}


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str):
    ok = await queue.cancel(task_id)
    if not ok:
        raise HTTPException(404, "task not found or not running")
    return {"ok": True}


# ---------- WebSocket /ws/app ----------
# Отдельный роут, вне /api/queue, чтобы URL был коротким.

ws_router = APIRouter()


class AppWsHub:
    """Раздаёт события всем подключённым клиентам."""
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def register(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)
        # Отправляем снапшот текущего состояния
        try:
            await ws.send_text(json.dumps({
                "type": "snapshot",
                "data": {
                    "tasks": queue.get_all(),
                    "active": queue.active,
                },
            }, default=str))
        except Exception:
            pass

    def unregister(self, ws: WebSocket):
        self.clients.discard(ws)

    async def broadcast(self, event: str, data):
        if not self.clients:
            return
        payload = json.dumps({"type": event, "data": data}, default=str)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = AppWsHub()


@ws_router.websocket("/ws/app")
async def ws_app(websocket: WebSocket):
    await hub.register(websocket)
    try:
        while True:
            # Нам нечего принимать, но нужно держать соединение
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        hub.unregister(websocket)


# Подписываем hub на события queue
async def _relay(event: str, data):
    await hub.broadcast(event, data)


def init_ws_hub():
    """Вызывается один раз при старте приложения."""
    queue.on("task-added", lambda d: _relay("task-added", d))
    queue.on("task-updated", lambda d: _relay("task-updated", d))
    queue.on("task-started", lambda d: _relay("task-started", d))
    queue.on("task-finished", lambda d: _relay("task-finished", d))
    queue.on("task-removed", lambda d: _relay("task-removed", d))
