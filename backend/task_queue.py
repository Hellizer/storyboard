"""
Глобальная очередь задач генерации. Один экземпляр на бэкенд.
Подписана на ComfyClient, свои изменения рассылает подписчикам (WS /ws/app).
"""
import asyncio
import json
import time
from typing import Optional

from comfy import comfy
import config
from config import TEMPLATES_DIR, ADAPTERS_DIR, PROJECTS_DIR
from workflow_apply import apply_adapter


class QueueManager:
    def __init__(self):
        self.tasks: list[dict] = []
        self.active: Optional[dict] = None
        self._id_counter = 0
        self._scene_counters: dict[str, int] = {}
        self._listeners = {}

        # Подписки на ComfyClient
        comfy.on("progress", self._on_progress)
        comfy.on("executing", self._on_executing)
        comfy.on("executed", self._on_executed)
        comfy.on("execution_success", self._on_success)
        comfy.on("error", self._on_error)

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
                print(f"[queue] listener error on '{event}': {e}")

    # ---------- публичное API ----------
    async def submit(self, project_name: str, scene_id: str, seed=None) -> dict:
        # 1. Читаем проект

        project_path = PROJECTS_DIR / project_name / "project.json"
        if not project_path.exists():
            raise ValueError(f"project not found: {project_name}")

        project = json.loads(project_path.read_text(encoding="utf-8"))

        # 2. Ищем сцену
        scene = None
        for s in project.get("scenes", []):
            if s.get("id") == scene_id:
                scene = s
                break
        if scene is None:
            raise ValueError(f"scene not found: {scene_id}")

        # 3. Настройки сцены + промпт
        lv = scene.get("local_values") or {}
        prompt = scene.get("prompt", "")

        # 4. Seed
        if seed is None or seed == "":
            seed = int(time.time() * 1000) % 2147483647
        try:
            seed = int(seed)
        except Exception:
            seed = int(time.time() * 1000) % 2147483647

        # 5. Собираем values
        values = {
            "prompt": prompt,
            "negative": lv.get("negative", ""),
            "seed": seed,
            "steps": lv.get("steps", 20),
            "cfg": lv.get("cfg", 8),
            "sampler_name": lv.get("sampler_name", "euler"),
            "scheduler": lv.get("scheduler", "normal"),
            "shift": lv.get("shift", 2.5),
            "width": lv.get("width", 1152),
            "height": lv.get("height", 896),
            "lora_name": lv.get("lora_name", ""),
            "lora_strength": lv.get("lora_strength", 0.8),
            "filename_prefix": f"storyboard\\scene_{scene_id}_{int(time.time())}_",
        }
        if lv.get("unet_name"):
            values["unet_name"] = lv["unet_name"]

        # 6. Template/adapter из пресета сцены или проекта
        preset_name = scene.get("preset") or project.get("default_preset")
        template = "simple_anima"
        adapter = "simple_anima"

        if preset_name:
            try:
                preset_path = config.resolve_preset_path(preset_name)
                if preset_path is not None:
                    preset = json.loads(preset_path.read_text(encoding="utf-8"))
                    template = preset.get("template", template)
                    adapter = preset.get("adapter", adapter)
            except Exception as e:
                print(f"[queue] не удалось загрузить пресет '{preset_name}': {e}")

        # 7. Формируем задачу
        n = self._scene_counters.get(scene_id, 0) + 1
        self._scene_counters[scene_id] = n
        self._id_counter += 1
        task_id = f"task_{self._id_counter}_{int(time.time() * 1000)}"

        title = f"{project_name} · {scene.get('title', 'Сцена')} · #{n}"

        task = {
            "id": task_id,
            "title": title,
            "sceneId": scene_id,
            "sceneTitle": scene.get("title", "Сцена"),
            "projectName": project_name,
            "template": template,
            "adapter": adapter,
            "values": values,
            "status": "queued",
            "progress": 0,
            "image": None,
            "error": None,
            "promptId": None,
            "applied": None,
            "skipped": None,
            "createdAt": time.time(),
            "startedAt": None,
            "finishedAt": None,
        }
        self.tasks.append(task)
        await self._emit("task-added", task)
        asyncio.create_task(self._run_next())
        return task

    def get_all(self) -> list[dict]:
        return self.tasks

    def get(self, task_id: str) -> Optional[dict]:
        for t in self.tasks:
            if t["id"] == task_id:
                return t
        return None

    async def remove(self, task_id: str) -> bool:
        for i, t in enumerate(self.tasks):
            if t["id"] == task_id and t["status"] != "running":
                del self.tasks[i]
                await self._emit("task-removed", task_id)
                return True
        return False

    async def cancel(self, task_id: str) -> bool:
        if not self.active or self.active["id"] != task_id:
            return False
        ok = await comfy.interrupt()
        if ok:
            self.active["status"] = "cancelled"
            self.active["error"] = "interrupted by user"
            await self._finish_active()
        return ok

    def clear_finished(self):
        # Пусть будет, но фронт её не дёргает
        self.tasks = [t for t in self.tasks if t["status"] == "queued" or t is self.active]

    # ---------- внутреннее ----------
    def _build_title(self, data: dict, n: int) -> str:
        project = data.get("projectName") or "?"
        scene = data.get("sceneTitle") or "Сцена"
        return f"{project} · {scene} · #{n}"

    async def _run_next(self):
        if self.active:
            return
        next_task = None
        for t in self.tasks:
            if t["status"] == "queued":
                next_task = t
                break
        if not next_task:
            return

        self.active = next_task
        next_task["status"] = "running"
        next_task["startedAt"] = time.time()
        next_task["progress"] = 0

        await self._emit("task-started", next_task)

        # Собираем workflow
        try:
            template_path = TEMPLATES_DIR / f"{next_task['template']}.json"
            adapter_path = ADAPTERS_DIR / f"{next_task['adapter']}.json"
            if not template_path.exists():
                raise RuntimeError(f"template {next_task['template']} not found")
            if not adapter_path.exists():
                raise RuntimeError(f"adapter {next_task['adapter']} not found")

            template = json.loads(template_path.read_text(encoding="utf-8"))
            adapter = json.loads(adapter_path.read_text(encoding="utf-8"))
            workflow, report = apply_adapter(template, adapter, next_task["values"])

            next_task["applied"] = report["applied"]
            next_task["skipped"] = report["skipped"]
        except Exception as e:
            next_task["status"] = "error"
            next_task["error"] = f"workflow error: {e}"
            await self._finish_active()
            return

        # Отправляем в ComfyUI
        try:
            resp = await comfy.submit(workflow)
            next_task["promptId"] = resp["prompt_id"]
            await self._emit("task-updated", next_task)
        except Exception as e:
            next_task["status"] = "error"
            next_task["error"] = f"submit failed: {e}"
            await self._finish_active()

    # ---------- обработчики событий ComfyUI ----------
    async def _on_progress(self, data):
        if not self.active or not data:
            return
        value = data.get("value", 0)
        max_ = data.get("max", 1)
        if max_ > 0:
            self.active["progress"] = int(round(value / max_ * 100))
            await self._emit("task-updated", self.active)

    async def _on_executing(self, data):
        if not self.active or not data:
            return
        if data.get("node") is None:
            self.active["progress"] = 100
            await self._emit("task-updated", self.active)

    async def _on_executed(self, data):
        if not self.active or not data:
            return
        imgs = (data.get("output") or {}).get("images") or []
        if imgs:
            self.active["image"] = {
                "filename": imgs[0].get("filename"),
                "subfolder": imgs[0].get("subfolder", ""),
                "type": imgs[0].get("type", "output"),
            }
            await self._emit("task-updated", self.active)

    async def _on_success(self, data):
        if not self.active:
            return
        self.active["status"] = "done"
        self.active["progress"] = 100
        await self._finish_active()

    async def _on_error(self, data):
        if not self.active:
            return
        self.active["status"] = "error"
        self.active["error"] = str(data)[:500] if data else "unknown error"
        await self._finish_active()

    async def _finish_active(self):
        finished = self.active
        self.active = None
        finished["finishedAt"] = time.time()
        await self._emit("task-finished", finished)

        # Хук в историю — заработает, когда history.py появится
        try:
            from history import history
            await history.append(finished)
        except ImportError:
            pass
        except Exception as e:
            print(f"[queue] history write failed: {e}")

        # Следующая задача
        await asyncio.sleep(0.2)
        asyncio.create_task(self._run_next())


queue = QueueManager()
