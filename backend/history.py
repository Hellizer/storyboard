"""
История генераций. Пишет JSON-файл на сцену:
    projects/<project>/history/<scene_id>.json

Каждая запись — одна завершённая генерация (успех / ошибка / отмена).
"""
import json
import time
from pathlib import Path

from config import PROJECTS_DIR


class History:
    def _path(self, project_name: str, scene_id: str) -> Path:
        return PROJECTS_DIR / project_name / "history" / f"{scene_id}.json"

    def _load(self, project_name: str, scene_id: str) -> list:
        path = self._path(project_name, scene_id)
        if not path.exists():
            return []
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []

    def _save(self, project_name: str, scene_id: str, items: list) -> None:
        path = self._path(project_name, scene_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(items, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    async def append(self, task: dict) -> None:
        """Записать завершённую задачу в историю сцены."""
        project_name = task.get("projectName")
        scene_id = task.get("sceneId")
        if not project_name or not scene_id:
            return

        # Компактная запись: только то, что нужно для воспроизведения/отката
        entry = {
            "task_id": task.get("id"),
            "title": task.get("title"),
            "created_at": task.get("createdAt"),
            "started_at": task.get("startedAt"),
            "finished_at": task.get("finishedAt"),
            "status": task.get("status"),
            "error": task.get("error"),
            "prompt": (task.get("values") or {}).get("prompt"),
            "seed": (task.get("values") or {}).get("seed"),
            "values": task.get("values") or {},
            "image": task.get("image"),
        }

        items = self._load(project_name, scene_id)
        items.append(entry)
        self._save(project_name, scene_id, items)

    def get_all(self, project_name: str, scene_id: str) -> list:
        return self._load(project_name, scene_id)


history = History()
