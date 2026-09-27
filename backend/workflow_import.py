"""
Автогенерация адаптеров из экспортированных workflow ComfyUI.

Пользователь:
  1. Собирает workflow в ComfyUI.
  2. Экспортирует через Save → API Format (.json).
  3. Кладёт в backend/templates/<имя>.json.
  4. В UI нажимает «Импортировать workflow».

Мы:
  - Ищем ключевые узлы (KSampler, CLIPTextEncode, UNETLoader и т.д.).
  - Разрешаем ссылки (positive → узел с текстом).
  - Собираем адаптер — маппинг «значение → узел + поле».
  - В каждом маппинге сохраняем node_id, чтобы избежать путаницы
    при нескольких узлах одного class_type.

Поддерживаемые узлы (родные ComfyUI):
  - KSampler, KSamplerAdvanced
  - UNETLoader, CheckpointLoaderSimple
  - CLIPLoader, CLIPTextEncode, PrimitiveStringMultiline
  - VAELoader
  - EmptyLatentImage
  - LoraLoaderModelOnly, LoraLoader
  - ModelSamplingAuraFlow, ModelSamplingSD3, ModelSamplingFlux
  - SaveImage, PreviewImage
"""
import json
from pathlib import Path
from typing import Optional


# Какие class_type считаются «сэмплерами»
SAMPLER_TYPES = ("KSampler", "KSamplerAdvanced")

# Какие class_type умеют хранить текст промпта
TEXT_TYPES = ("CLIPTextEncode", "PrimitiveStringMultiline")

# Какие поля берём из текстовых узлов
TEXT_FIELDS = {
    "CLIPTextEncode": "text",
    "PrimitiveStringMultiline": "value",
}


def _find_first(workflow: dict, class_type: str) -> tuple[Optional[str], Optional[dict]]:
    """Найти первый узел с указанным class_type."""
    for nid, node in workflow.items():
        if isinstance(node, dict) and node.get("class_type") == class_type:
            return nid, node
    return None, None


def _find_first_of(workflow: dict, class_types: tuple) -> tuple[Optional[str], Optional[dict]]:
    """Найти первый узел из списка class_type."""
    for ct in class_types:
        nid, node = _find_first(workflow, ct)
        if node is not None:
            return nid, node
    return None, None


def _resolve_link(value) -> Optional[str]:
    """
    Извлечь ID узла из ссылки вида ["168", 0].
    Возвращает None, если value не ссылка.
    """
    if isinstance(value, list) and len(value) >= 1:
        return str(value[0])
    return None


def _get_text_target(workflow: dict, link_value) -> Optional[tuple[str, str, str]]:
    """
    По ссылке (или прямой строке) определить узел и поле с текстом.
    Возвращает (node_id, class_type, field_name) или None.
    """
    target_id = _resolve_link(link_value)
    if target_id is None:
        return None

    node = workflow.get(target_id)
    if not isinstance(node, dict):
        return None

    class_type = node.get("class_type")
    if class_type not in TEXT_TYPES:
        return None

    field = TEXT_FIELDS.get(class_type)
    if field is None:
        return None

    return target_id, class_type, field


def generate_adapter(workflow: dict) -> dict:
    """
    Сгенерировать адаптер из workflow.

    Возвращает:
        {
            "mapping": {...},
            "import_info": {
                "found": [...],
                "missing": [...],
                "notes": [...]
            }
        }
    """
    mapping = {}
    found = []
    missing = []
    notes = []

    # --- Сэмплер ---
    sampler_id, sampler = _find_first_of(workflow, SAMPLER_TYPES)
    if sampler is None:
        missing.append("sampler (KSampler / KSamplerAdvanced)")
    else:
        found.append(f"sampler: {sampler['class_type']} #{sampler_id}")
        ins = sampler.get("inputs", {})
        ct = sampler["class_type"]

        # steps
        if "steps" in ins:
            mapping["steps"] = {
                "node_id": sampler_id,
                "class_type": ct,
                "field": "steps",
            }

        # cfg
        if "cfg" in ins:
            mapping["cfg"] = {
                "node_id": sampler_id,
                "class_type": ct,
                "field": "cfg",
            }
        # sampler_name
        if "sampler_name" in ins:
            mapping["sampler_name"] = {
                "node_id": sampler_id,
                "class_type": ct,
                "field": "sampler_name",
            }

        # scheduler
        if "scheduler" in ins:
            mapping["scheduler"] = {
                "node_id": sampler_id,
                "class_type": ct,
                "field": "scheduler",
            }

        # seed — только если это int, а не ссылка
        seed_val = ins.get("seed")
        if isinstance(seed_val, int):
            mapping["seed"] = {
                "node_id": sampler_id,
                "class_type": ct,
                "field": "seed",
            }
        elif seed_val is not None:
            notes.append(
                "seed — ссылка на другой узел, будет использоваться его дефолт"
            )

        # positive → текст
        pos_target = _get_text_target(workflow, ins.get("positive"))
        if pos_target:
            pos_id, pos_ct, pos_field = pos_target
            mapping["prompt"] = {
                "node_id": pos_id,
                "class_type": pos_ct,
                "field": pos_field,
            }
            found.append(f"prompt: {pos_ct} #{pos_id}")
        else:
            missing.append("prompt (positive)")

        # negative → текст
        neg_target = _get_text_target(workflow, ins.get("negative"))
        if neg_target:
            neg_id, neg_ct, neg_field = neg_target
            mapping["negative"] = {
                "node_id": neg_id,
                "class_type": neg_ct,
                "field": neg_field,
            }
            found.append(f"negative: {neg_ct} #{neg_id}")
        else:
            missing.append("negative")

    # --- UNETLoader / CheckpointLoader ---
    unet_id, unet = _find_first(workflow, "UNETLoader")
    if unet is not None:
        mapping["unet_name"] = {
            "node_id": unet_id,
            "class_type": "UNETLoader",
            "field": "unet_name",
        }
        found.append(f"model: UNETLoader #{unet_id}")
    else:
        ckpt_id, ckpt = _find_first(workflow, "CheckpointLoaderSimple")
        if ckpt is not None:
            mapping["unet_name"] = {
                "node_id": ckpt_id,
                "class_type": "CheckpointLoaderSimple",
                "field": "ckpt_name",
            }
            found.append(f"model: CheckpointLoaderSimple #{ckpt_id}")
        else:
            notes.append("модель не найдена (ни UNETLoader, ни CheckpointLoaderSimple)")

    # --- EmptyLatentImage ---
    latent_id, latent = _find_first(workflow, "EmptyLatentImage")
    if latent is not None:
        mapping["width"] = {
            "node_id": latent_id,
            "class_type": "EmptyLatentImage",
            "field": "width",
        }
        mapping["height"] = {
            "node_id": latent_id,
            "class_type": "EmptyLatentImage",
            "field": "height",
        }
        found.append(f"latent: EmptyLatentImage #{latent_id}")
    else:
        missing.append("width / height (EmptyLatentImage)")

    # --- LoRA ---
    lora_id, lora = _find_first_of(workflow, ("LoraLoaderModelOnly", "LoraLoader"))
    if lora is not None:
        ct = lora["class_type"]
        mapping["lora_name"] = {
            "node_id": lora_id,
            "class_type": ct,
            "field": "lora_name",
        }
        mapping["lora_strength"] = {
            "node_id": lora_id,
            "class_type": ct,
            "field": "strength_model",
        }
        found.append(f"LoRA: {ct} #{lora_id}")

    # --- ModelSampling ---
    sampling_id, sampling = _find_first_of(
        workflow,
        ("ModelSamplingAuraFlow", "ModelSamplingSD3", "ModelSamplingFlux"),
    )
    if sampling is not None:
        ct = sampling["class_type"]
        if "shift" in sampling.get("inputs", {}):
            mapping["shift"] = {
                "node_id": sampling_id,
                "class_type": ct,
                "field": "shift",
            }
            found.append(f"shift: {ct} #{sampling_id}")

    # --- SaveImage ---
    save_id, save = _find_first_of(workflow, ("SaveImage", "PreviewImage"))
    if save is not None:
        ct = save["class_type"]
        if ct == "SaveImage" and "filename_prefix" in save.get("inputs", {}):
            mapping["filename_prefix"] = {
                "node_id": save_id,
                "class_type": "SaveImage",
                "field": "filename_prefix",
            }
            found.append(f"save: SaveImage #{save_id}")

    return {
        "mapping": mapping,
        "import_info": {
            "found": found,
            "missing": missing,
            "notes": notes,
        },
    }


def generate_adapter_file(template_path, output_path) -> dict:
    """
    Прочитать workflow, сгенерировать адаптер, сохранить.
    Возвращает отчёт с полями mapping и import_info.
    """
    template_path = Path(template_path)
    output_path = Path(output_path)

    if not template_path.exists():
        raise FileNotFoundError(f"template not found: {template_path}")

    workflow = json.loads(template_path.read_text(encoding="utf-8"))
    result = generate_adapter(workflow)

    adapter = {
        "name": output_path.stem,
        "description": f"Автоматически сгенерирован из {template_path.name}",
        "mapping": result["mapping"],
        "import_info": result["import_info"],
    }

    output_path.write_text(
        json.dumps(adapter, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return adapter
