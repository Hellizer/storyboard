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
