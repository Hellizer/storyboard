"""Роутер /api/cubes/* — CRUD библиотеки кубиков."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import cubes


router = APIRouter(prefix="/api/cubes", tags=["cubes"])


class CubePayload(BaseModel):
    name: str | None = None
    category: str | None = None
    type: str | None = None
    text: str | None = None
    parts: list[str] | None = None
    color: str | None = None
    pinned: bool | None = None


@router.get("")
def list_cubes():
    return cubes.list_all()


@router.post("")
def create_cube(payload: CubePayload):
    try:
        cube = cubes.create(payload.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"cube": cube}


@router.put("/{cube_id}")
def update_cube(cube_id: str, payload: CubePayload):
    try:
        cube = cubes.update(cube_id, payload.model_dump(exclude_none=True))
    except KeyError:
        raise HTTPException(status_code=404, detail="cube not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"cube": cube}


@router.delete("/{cube_id}")
def delete_cube(cube_id: str):
    try:
        cubes.delete(cube_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="cube not found")
    return {"ok": True}


@router.post("/{cube_id}/touch")
def touch_cube(cube_id: str):
    try:
        cube = cubes.touch(cube_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="cube not found")
    return {"cube": cube}
