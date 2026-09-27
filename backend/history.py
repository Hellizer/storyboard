"""
История генераций и хранилище картинок сцены.

Структура на диске:
    ~/.storyboard/projects/<project>/scenes/<scene_id>/
    ├── history.json           — список записей
    └── images/
        ├── <task_id>.png
        └── ...

Каждая запись в history.json содержит:
    - task_id
    - prompt, seed, values (полный набор параметров генерации)
    - status (done / error / cancelled)
    - created_at, started_at, finished_at
    - image: {filename} или None
"""
import json
import time
from pathlib import Path

from config import PROJECTS_DIR


class History:
    # ---------- пути ----------
    def _scene_dir(self, project_name: str, scene_id: str) -> Path:
        return PROJECTS_DIR / project_name / "scenes" / scene_id

    def _history_path(self, project_name: str, scene_id: str) -> Path:
        return self._scene_dir(project_name, scene_id) / "history.json"

    def _images_dir(self, project_name: str, scene_id: str) -> Path:
        return self._scene_dir(project_name, scene_id) / "images"

    def image_path(self, project_name: str, scene_id: str, history_id: str):
        """Вернуть путь к файлу картинки или None."""
        d = self._images_dir(project_name, scene_id)
        if not d.exists():
            return None
        for ext in (".png", ".jpg", ".jpeg", ".webp"):
            p = d / f"{history_id}{ext}"
            if p.exists():
                return p
        return None

    # ---------- чтение/запись ----------
    def _load(self, project_name: str, scene_id: str) -> list:
        path = self._history_path(project_name, scene_id)
        if not path.exists():
            return []
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[history] не удалось прочитать {path}: {e}")
            return []

    def _save(self, project_name: str, scene_id: str, items: list) -> None:
        path = self._history_path(project_name, scene_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(items, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ---------- публичное API ----------
    def get_all(self, project_name: str, scene_id: str) -> list:
        """Список записей, свежие сверху."""
        items = self._load(project_name, scene_id)
        items.sort(key=lambda x: x.get("finished_at") or 0, reverse=True)
        return items

    async def save_image(self, project_name: str, scene_id: str,
                         history_id: str, image_bytes: bytes,
                         extension: str = ".png") -> dict | None:
        """Сохранить байты картинки в папку сцены."""
        try:
            d = self._images_dir(project_name, scene_id)
            d.mkdir(parents=True, exist_ok=True)
            filename = f"{history_id}{extension}"
            path = d / filename
            path.write_bytes(image_bytes)
            return {"filename": filename}
        except Exception as e:
            print(f"[history] не удалось сохранить картинку {history_id}: {e}")
            return None

    async def append(self, task: dict) -> None:
        """Добавить запись о завершённой задаче."""
        project_name = task.get("projectName")
        scene_id = task.get("sceneId")
        if not project_name or not scene_id:
            return

        image = task.get("image") or {}
        # image в задаче хранит {"filename": "..."} после сохранения

        entry = {
            "task_id": task.get("id"),
            "title": task.get("title"),
            "prompt": (task.get("values") or {}).get("prompt"),
            "seed": (task.get("values") or {}).get("seed"),
            "values": task.get("values") or {},
            "status": task.get("status"),
            "error": task.get("error"),
            "created_at": task.get("createdAt"),
            "started_at": task.get("startedAt"),
            "finished_at": task.get("finishedAt"),
            "image": image if image.get("filename") else None,
        }

        items = self._load(project_name, scene_id)
        # Если запись с таким task_id уже есть — перезаписываем
        for i, it in enumerate(items):
            if it.get("task_id") == entry["task_id"]:
                items[i] = entry
                break
        else:
            items.append(entry)

        self._save(project_name, scene_id, items)

    def get_one(self, project_name: str, scene_id: str, history_id: str) -> dict | None:
        """Найти одну запись по task_id."""
        for it in self._load(project_name, scene_id):
            if it.get("task_id") == history_id:
                return it
        return None

    async def delete(self, project_name: str, scene_id: str,
                     history_id: str) -> bool:
        """Удалить запись и её файл."""
        items = self._load(project_name, scene_id)
        filtered = [it for it in items if it.get("task_id") != history_id]
        if len(filtered) == len(items):
            return False

        # Удаляем файл
        path = self.image_path(project_name, scene_id, history_id)
        if path and path.exists():
            try:
                path.unlink()
            except Exception as e:
                print(f"[history] не удалось удалить файл {path}: {e}")

        self._save(project_name, scene_id, filtered)
        return True


history = History()
