"""
CRUD проектов. Файловая структура в ~/.storyboard/projects/.
"""
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from fastapi.responses import FileResponse
from history import history

from config import PROJECTS_DIR


router = APIRouter(prefix="/api/projects", tags=["projects"])

PROJECTS_INDEX = PROJECTS_DIR / "index.json"

_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1F]')
_RESERVED = {
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
}


def _validate_name(name: str) -> str:
    if not isinstance(name, str):
        raise HTTPException(400, "имя должно быть строкой")
    name = name.strip()
    if not name:
        raise HTTPException(400, "имя не может быть пустым")
    if len(name) > 100:
        raise HTTPException(400, "имя длиннее 100 символов")
    if _FORBIDDEN.search(name):
        raise HTTPException(400, 'имя содержит запрещённые символы')
    if name in (".", ".."):
        raise HTTPException(400, "недопустимое имя")
    if name[-1] in (".", " "):
        raise HTTPException(400, "имя не может заканчиваться точкой или пробелом")
    if name.lower() in _RESERVED:
        raise HTTPException(400, f"имя «{name}» зарезервировано системой")
    return name


def _load_index() -> list:
    if not PROJECTS_INDEX.exists():
        return []
    return json.loads(PROJECTS_INDEX.read_text(encoding="utf-8"))


def _save_index(items: list) -> None:
    PROJECTS_INDEX.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _project_dir(name: str) -> Path:
    return PROJECTS_DIR / name


def _name_taken(name: str, exclude: str | None = None) -> bool:
    lname = name.lower()
    for item in _load_index():
        if exclude and item["name"].lower() == exclude.lower():
            continue
        if item["name"].lower() == lname:
            return True
    return False


@router.get("")
async def list_projects():
    return _load_index()


class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""


@router.post("")
async def create_project(req: CreateProjectRequest):
    name = _validate_name(req.name)
    if _name_taken(name):
        raise HTTPException(409, f"проект «{name}» уже существует")

    now = datetime.utcnow().isoformat() + "Z"
    project = {
        "id": name,
        "name": name,
        "description": req.description,
        "created": now,
        "modified": now,
        "default_preset": None,
        "scenes": [],
        "edges": [],
    }

    pdir = _project_dir(name)
    pdir.mkdir(parents=True, exist_ok=False)
    (pdir / "scenes").mkdir(exist_ok=True)
    (pdir / "history").mkdir(exist_ok=True)
    (pdir / "project.json").write_text(
        json.dumps(project, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    items = _load_index()
    items.append({
        "id": name, "name": name, "modified": now,
        "scene_count": 0, "image_count": 0,
    })
    _save_index(items)
    return project


@router.get("/{name}")
async def get_project(name: str):
    name = unquote(name)
    path = _project_dir(name) / "project.json"
    if not path.exists():
        raise HTTPException(404, "project not found")
    return json.loads(path.read_text(encoding="utf-8"))


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    default_preset: str | None = None
    scenes: list | None = None
    edges: list | None = None


@router.put("/{name}")
async def update_project(name: str, req: UpdateProjectRequest):
    name = unquote(name)
    pdir = _project_dir(name)
    pjson = pdir / "project.json"
    if not pjson.exists():
        raise HTTPException(404, "project not found")

    project = json.loads(pjson.read_text(encoding="utf-8"))
    old_name = project["name"]

    if req.name is not None and req.name.strip() != old_name:
        new_name = _validate_name(req.name)
        if _name_taken(new_name, exclude=old_name):
            raise HTTPException(409, f"проект «{new_name}» уже существует")
        new_dir = _project_dir(new_name)
        if new_dir.exists():
            raise HTTPException(409, f"папка «{new_name}» уже существует")

        shutil.move(str(pdir), str(new_dir))
        project["name"] = new_name
        project["id"] = new_name

        items = _load_index()
        for item in items:
            if item["name"] == old_name:
                item["name"] = new_name
                item["id"] = new_name
                break
        _save_index(items)

    if req.description is not None:
        project["description"] = req.description
    if req.default_preset is not None:
        project["default_preset"] = req.default_preset
    if req.scenes is not None:
        project["scenes"] = req.scenes
    if req.edges is not None:
        project["edges"] = req.edges

    project["modified"] = datetime.utcnow().isoformat() + "Z"

    target_dir = _project_dir(project["name"])
    (target_dir / "project.json").write_text(
        json.dumps(project, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    items = _load_index()
    for item in items:
        if item["name"] == project["name"]:
            item["modified"] = project["modified"]
            break
    _save_index(items)

    return project

# ---------------------------------------------------------------------------
# История сцены
# ---------------------------------------------------------------------------

@router.get("/{name}/scenes/{scene_id}/history")
async def get_scene_history(name: str, scene_id: str):
    name = unquote(name)
    return history.get_all(name, scene_id)


@router.get("/{name}/scenes/{scene_id}/history/{history_id}/image")
async def get_history_image(name: str, scene_id: str, history_id: str):
    name = unquote(name)
    path = history.image_path(name, scene_id, history_id)
    if path is None or not path.exists():
        raise HTTPException(404, "image not found")
    return FileResponse(path, media_type="image/png")


@router.delete("/{name}/scenes/{scene_id}/history/{history_id}")
async def delete_history_entry(name: str, scene_id: str, history_id: str):
    name = unquote(name)

    # Запомним, был ли этот вариант активным
    pjson = _project_dir(name) / "project.json"
    was_active = False
    if pjson.exists():
        project = json.loads(pjson.read_text(encoding="utf-8"))
        for scene in project.get("scenes", []):
            if scene.get("id") != scene_id:
                continue
            li = scene.get("last_image") or {}
            if li.get("history_id") == history_id:
                was_active = True
            break

    ok = await history.delete(name, scene_id, history_id)
    if not ok:
        raise HTTPException(404, "history entry not found")

    # Если удалили активный вариант — выбираем следующий по свежести
    if was_active and pjson.exists():
        project = json.loads(pjson.read_text(encoding="utf-8"))
        remaining = history.get_all(name, scene_id)  # свежие сверху
        next_entry = remaining[0] if remaining else None

        for scene in project.get("scenes", []):
            if scene.get("id") != scene_id:
                continue
            if next_entry is not None:
                next_image = next_entry.get("image") or {}
                next_values = next_entry.get("values") or {}
                scene["last_image"] = {
                    "history_id": next_entry["task_id"],
                    "width": next_image.get("width", next_values.get("width", 1152)),
                    "height": next_image.get("height", next_values.get("height", 896)),
                }
                values = next_entry.get("values") or {}
                if "prompt" in values:
                    scene["prompt"] = values["prompt"]
                lv = dict(values)
                lv.pop("prompt", None)
                lv.pop("filename_prefix", None)
                scene["local_values"] = lv
            else:
                # Нет больше вариантов — превью пустое,
                # но prompt/local_values оставляем от последнего
                scene["last_image"] = None
            break

        project["modified"] = datetime.utcnow().isoformat() + "Z"
        pjson.write_text(
            json.dumps(project, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    return {"ok": True}

class SelectHistoryRequest(BaseModel):
    pass


@router.post("/{name}/scenes/{scene_id}/history/{history_id}/select")
async def select_history_image(name: str, scene_id: str, history_id: str):
    """Сделать запись активной: восстанавливает prompt и local_values."""
    name = unquote(name)

    entry = history.get_one(name, scene_id, history_id)
    if entry is None:
        raise HTTPException(404, "history entry not found")

    pjson = _project_dir(name) / "project.json"
    if not pjson.exists():
        raise HTTPException(404, "project not found")

    project = json.loads(pjson.read_text(encoding="utf-8"))
    found = False

    for scene in project.get("scenes", []):
        if scene.get("id") != scene_id:
            continue

        # Восстанавливаем prompt и local_values из записи
        values = entry.get("values") or {}
        if "prompt" in values:
            scene["prompt"] = values["prompt"]

        # local_values — все поля кроме prompt
        lv = dict(values)
        lv.pop("prompt", None)
        lv.pop("filename_prefix", None)
        scene["local_values"] = lv

        # Активная картинка
        # Активная картинка — с пропорциями из записи
        entry_image = entry.get("image") or {}
        scene["last_image"] = {
            "history_id": history_id,
            "width": entry_image.get("width", values.get("width", 1152)),
            "height": entry_image.get("height", values.get("height", 896)),
        }
        found = True
        break

    if not found:
        raise HTTPException(404, "scene not found")

    project["modified"] = datetime.utcnow().isoformat() + "Z"
    pjson.write_text(
        json.dumps(project, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"ok": True}

@router.delete("/{name}")
async def delete_project(name: str):
    name = unquote(name)
    pdir = _project_dir(name)
    if pdir.exists():
        shutil.rmtree(pdir)

    items = _load_index()
    items = [x for x in items if x["name"] != name]
    _save_index(items)
    return {"ok": True}
