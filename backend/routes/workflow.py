"""
Шаблоны, адаптеры, импорт workflow, дефолтные значения из шаблона.
"""
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import TEMPLATES_DIR, ADAPTERS_DIR
from workflow_apply import find_by_meta
from workflow_import import generate_adapter_file


router = APIRouter(prefix="/api/workflow", tags=["workflow"])


def _load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/templates")
async def list_templates():
    items = sorted(p.stem for p in TEMPLATES_DIR.glob("*.json"))
    return {"templates": items}


@router.get("/adapters")
async def list_adapters():
    items = sorted(p.stem for p in ADAPTERS_DIR.glob("*.json"))
    return {"adapters": items}


class ImportWorkflowRequest(BaseModel):
    template: str
    overwrite: bool = False


@router.post("/import")
async def import_workflow(req: ImportWorkflowRequest):
    template_path = TEMPLATES_DIR / f"{req.template}.json"
    adapter_path = ADAPTERS_DIR / f"{req.template}.json"

    if not template_path.exists():
        raise HTTPException(404, f"template {req.template} not found")
    if adapter_path.exists() and not req.overwrite:
        raise HTTPException(409, "adapter already exists. Use overwrite=true.")

    try:
        adapter = generate_adapter_file(template_path, adapter_path)
    except Exception as e:
        raise HTTPException(500, f"import failed: {e}")

    return adapter


@router.get("/template_defaults")
async def template_defaults(template: str = "simple_anima"):
    path = TEMPLATES_DIR / f"{template}.json"
    if not path.exists():
        raise HTTPException(404, f"template {template} not found")
    wf = _load_json(path)

    def get_val(class_type, title, field, default=None):
        _, node = find_by_meta(wf, class_type, title)
        if node is None:
            return default
        return node["inputs"].get(field, default)

    return {
        "prompt": get_val("CLIPTextEncode", "CLIP Text Encode (Prompt)", "text", ""),
        "negative": get_val("CLIPTextEncode", "CLIP Text Encode (Prompt)", "text", ""),
        "steps": get_val("KSampler", None, "steps", 20),
        "cfg": get_val("KSampler", None, "cfg", 8),
        "width": get_val("EmptyLatentImage", None, "width", 1152),
        "height": get_val("EmptyLatentImage", None, "height", 896),
        "lora_name": get_val("LoraLoaderModelOnly", None, "lora_name", ""),
        "lora_strength": get_val("LoraLoaderModelOnly", None, "strength_model", 0.8),
        "shift": get_val("ModelSamplingAuraFlow", None, "shift", 2.5),
    }
