"""
Эндпоинты, работающие с ComfyUI: статус, view, списки, interrupt, free.
"""
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from comfy import comfy
from config import get_comfy_url


router = APIRouter(prefix="/api/comfy", tags=["comfy"])


@router.get("/status")
async def status():
    return await comfy.status()


@router.post("/interrupt")
async def interrupt():
    ok = await comfy.interrupt()
    return {"ok": ok}


@router.post("/free")
async def free(payload: dict | None = None):
    if payload is None:
        payload = {"unload_models": True, "free_memory": True}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{get_comfy_url()}/free", json=payload)
        return {"ok": r.status_code == 200}


@router.get("/view")
async def view(filename: str, subfolder: str = "", type_: str = "output"):
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(
            f"{get_comfy_url()}/view",
            params={"filename": filename, "subfolder": subfolder, "type": type_},
        )
        if r.status_code != 200:
            raise HTTPException(r.status_code, "comfy view failed")
        return StreamingResponse(
            iter([r.content]),
            media_type=r.headers.get("content-type", "image/png"),
        )


@router.get("/loras")
async def loras(refresh: bool = False):
    try:
        info = await comfy.object_info(force=refresh)
    except Exception as e:
        raise HTTPException(503, f"ComfyUI недоступен: {e}")
    node = info.get("LoraLoaderModelOnly")
    if not node:
        raise HTTPException(404, "LoraLoaderModelOnly не найден")
    try:
        return {"loras": node["input"]["required"]["lora_name"][0]}
    except (KeyError, IndexError, TypeError):
        raise HTTPException(500, "не удалось извлечь список LoRA")


@router.get("/models")
async def models(refresh: bool = False):
    try:
        info = await comfy.object_info(force=refresh)
    except Exception as e:
        raise HTTPException(503, f"ComfyUI недоступен: {e}")
    node = info.get("UNETLoader")
    if not node:
        raise HTTPException(404, "UNETLoader не найден")
    try:
        return {"models": node["input"]["required"]["unet_name"][0]}
    except (KeyError, IndexError, TypeError):
        raise HTTPException(500, "не удалось извлечь список моделей")


@router.get("/samplers")
async def samplers(refresh: bool = False):
    try:
        info = await comfy.object_info(force=refresh)
    except Exception as e:
        raise HTTPException(503, f"ComfyUI недоступен: {e}")
    node = info.get("KSampler")
    if not node:
        raise HTTPException(404, "KSampler не найден")
    try:
        return {"samplers": node["input"]["required"]["sampler_name"][0]}
    except (KeyError, IndexError, TypeError):
        raise HTTPException(500, "не удалось извлечь список sampler'ов")


@router.get("/schedulers")
async def schedulers(refresh: bool = False):
    try:
        info = await comfy.object_info(force=refresh)
    except Exception as e:
        raise HTTPException(503, f"ComfyUI недоступен: {e}")
    node = info.get("KSampler")
    if not node:
        raise HTTPException(404, "KSampler не найден")
    try:
        return {"schedulers": node["input"]["required"]["scheduler"][0]}
    except (KeyError, IndexError, TypeError):
        raise HTTPException(500, "не удалось извлечь список scheduler'ов")
