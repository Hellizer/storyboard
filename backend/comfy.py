"""
Клиент ComfyUI. Один WS на весь бэкенд.
Держит соединение постоянно, рассылает события подписчикам.
"""
import asyncio
import json
import uuid

import httpx
import websockets

from config import get_comfy_url


class ComfyClient:
    def __init__(self):
        self.url = get_comfy_url()
        self.ws_url = self.url.replace("http://", "ws://").replace("https://", "wss://")
        self.client_id = "backend_" + str(uuid.uuid4())[:8]
        self._ws = None
        self._task = None
        self._running = False
        self._listeners = {}
        self._http = httpx.AsyncClient(timeout=30)

    # ---------- подписки ----------
    def on(self, event: str, callback):
        self._listeners.setdefault(event, []).append(callback)

    async def _emit(self, event: str, data=None):
        for cb in self._listeners.get(event, []):
            try:
                result = cb(data)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                print(f"[comfy] listener error on '{event}': {e}")

    # ---------- жизненный цикл ----------
    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._ws_loop())
        print(f"[comfy] client started, id={self.client_id}")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await self._http.aclose()

    # ---------- WS-цикл ----------
    async def _ws_loop(self):
        while self._running:
            try:
                async with websockets.connect(
                    f"{self.ws_url}/ws?clientId={self.client_id}",
                    max_size=2 ** 24,
                ) as ws:
                    self._ws = ws
                    print(f"[comfy] ws connected")
                    await self._emit("connected")
                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                        except Exception:
                            continue
                        await self._handle_message(msg)
            except Exception as e:
                print(f"[comfy] ws error: {e}")
                await self._emit("disconnected", str(e))
                self._ws = None
                if self._running:
                    await asyncio.sleep(2)

    async def _handle_message(self, msg: dict):
        t = msg.get("type")
        if not t:
            return

        if t == "progress":
            await self._emit("progress", msg.get("data"))
        elif t == "executing":
            await self._emit("executing", msg.get("data"))
        elif t == "executed":
            await self._emit("executed", msg.get("data"))
        elif t == "execution_start":
            await self._emit("execution_start", msg.get("data"))
        elif t == "execution_success":
            await self._emit("execution_success", msg.get("data"))
        elif t in ("execution_error", "execution_interrupted"):
            await self._emit("error", msg.get("data"))
        else:
            await self._emit("other", msg)

    # ---------- HTTP-методы ----------
    async def submit(self, workflow: dict) -> dict:
        r = await self._http.post(
            f"{self.url}/prompt",
            json={"prompt": workflow, "client_id": self.client_id},
        )
        if r.status_code != 200:
            raise RuntimeError(f"ComfyUI rejected ({r.status_code}): {r.text}")
        return r.json()

    async def interrupt(self) -> bool:
        try:
            r = await self._http.post(f"{self.url}/interrupt")
            return r.status_code == 200
        except Exception as e:
            print(f"[comfy] interrupt failed: {e}")
            return False

    async def status(self) -> dict:
        try:
            r = await self._http.get(f"{self.url}/queue")
            q = r.json()
            return {
                "connected": True,
                "running": len(q.get("queue_running", [])),
                "pending": len(q.get("queue_pending", [])),
            }
        except Exception as e:
            return {"connected": False, "error": str(e)}

    async def object_info(self, force: bool = False) -> dict:
        import time
        now = time.time()
        if not force and hasattr(self, "_oi_cache") and now - self._oi_ts < 60:
            return self._oi_cache
        r = await self._http.get(f"{self.url}/object_info")
        r.raise_for_status()
        self._oi_cache = r.json()
        self._oi_ts = now
        return self._oi_cache


comfy = ComfyClient()
