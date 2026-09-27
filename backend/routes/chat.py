"""Роутер чата с LLM.

HTTP:
  GET  /api/chat/history?scope=...&project=...&scene=...
  POST /api/chat/clear?scope=...&project=...&scene=...

WS:
  /ws/chat
    Клиент → сервер:
      {"type": "send", "scope", "project", "scene",
       "text", "images": [{kind, name|data}], "enable_thinking": false}
      {"type": "cancel"}
    Сервер → клиент:
      {"type": "start", "user_message": {...}}
      {"type": "chunk", "text": "..."}
      {"type": "done",  "message": {...}}
      {"type": "cancelled"}
      {"type": "error", "error": "..."}
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

import chat as chat_mod


router = APIRouter(prefix="/api/chat", tags=["chat"])
ws_router = APIRouter()


# ---------- HTTP ----------

@router.get("/history")
def get_history(
    scope: str,
    project: str | None = None,
    scene: str | None = None,
):
    try:
        messages = chat_mod.load_history(scope, project, scene)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"messages": messages}


@router.post("/clear")
def clear_chat(
    scope: str,
    project: str | None = None,
    scene: str | None = None,
):
    try:
        chat_mod.clear_history(scope, project, scene)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


# ---------- WS ----------

@ws_router.websocket("/ws/chat")
async def chat_ws(ws: WebSocket):
    await ws.accept()
    active_task: asyncio.Task | None = None

    async def cancel_active():
        nonlocal active_task
        if active_task and not active_task.done():
            active_task.cancel()
            try:
                await active_task
            except (asyncio.CancelledError, Exception):
                pass
        active_task = None

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "error": "invalid json"})
                continue

            kind = msg.get("type")

            if kind == "send":
                await cancel_active()
                active_task = asyncio.create_task(_handle_send(ws, msg))
            elif kind == "cancel":
                await cancel_active()
                await ws.send_json({"type": "cancelled"})
            else:
                await ws.send_json({
                    "type": "error",
                    "error": f"unknown message type: {kind!r}",
                })
    except WebSocketDisconnect:
        await cancel_active()
    except Exception as e:
        await cancel_active()
        try:
            await ws.send_json({"type": "error", "error": str(e)})
        except Exception:
            pass


async def _handle_send(ws: WebSocket, msg: dict):
    scope = msg.get("scope") or "scene"
    project = msg.get("project")
    scene = msg.get("scene")
    text = (msg.get("text") or "").strip()
    raw_images = msg.get("images") or []
    enable_thinking = bool(msg.get("enable_thinking", False))

    if not text and not raw_images:
        await ws.send_json({"type": "error", "error": "empty message"})
        return

    try:
        # Нормализуем картинки: chat_upload декодируем и сохраняем.
        normalized = chat_mod.save_incoming_images(raw_images, project, scene)

        history = chat_mod.load_history(scope, project, scene)
        user_msg = chat_mod.append_message(
            scope, "user", text, normalized, project, scene,
        )

        api_messages = chat_mod._history_to_api(
            history + [user_msg], project, scene,
        )

        await ws.send_json({
            "type": "start",
            "user_message": user_msg,
        })

        full_text = ""
        async for channel, piece in chat_mod.stream_completion(
            api_messages, enable_thinking=enable_thinking,
        ):
            if channel == "content":
                full_text += piece
            await ws.send_json({
                "type": "chunk",
                "text": piece,
                "channel": channel,
            })

    except asyncio.CancelledError:
        raise
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "error": str(e)})
        except Exception:
            pass
