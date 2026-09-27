"""
CRUD пресетов.
"""
import json
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException

import config


router = APIRouter(prefix="/api/presets", tags=["presets"])


@router.get("")
async def list_presets():
    return config.list_presets()


@router.get("/{name}")
async def get_preset(name: str):
    name = unquote(name)
    path = config.resolve_preset_path(name)
    if path is None:
        raise HTTPException(404, f"preset {name} not found")
    return json.loads(path.read_text(encoding="utf-8"))


@router.post("/{name}")
async def save_preset(name: str, data: dict):
    name = unquote(name)
    try:
        path = config.save_preset(name, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "name": path.stem}


@router.delete("/{name}")
async def delete_preset(name: str):
    name = unquote(name)
    if not config.delete_preset(name):
        raise HTTPException(404, "preset not found or is read-only")
    return {"ok": True}
