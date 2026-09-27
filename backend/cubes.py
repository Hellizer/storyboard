"""Библиотека кубиков — текстовых фрагментов промпта.

Модель данных:
- Простой кубик: { id, name, category, text, color, pinned, last_used, created, modified }
- Мульти-кубик:  { id, name, category, type: "composite", parts: [...], color, ... }

Правила:
- Вложенность composite в composite РАЗРЕШЕНА, но циклы (А→Б→А) запрещены.
- Удаление любого кубика вычищает его id из parts всех composite,
  где он упоминается как часть (в т.ч. composite из composite).
- Удаление composite не трогает его бывшие подкубики.
- id генерирует бэк: slug от name + короткий суффикс при коллизии.
- Категория — одиночный слаг. Всё после первого разделителя (',', ';',
  перевода строки) отрезается. Пустая категория → DEFAULT_CATEGORIES[0].

Файл: ~/.storyboard/cubes.json
Схема: { "cubes": [...], "categories": [...] }
"""

from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any

from config import CUBES_FILE


DEFAULT_CATEGORIES = [
    "character",
    "location",
    "style",
    "atmosphere",
    "clothes",
    "details",
]

_PALETTE = [
    "#8b3a3a",
    "#3a5f8b",
    "#3a8b5f",
    "#8b7a3a",
    "#6b3a8b",
    "#8b3a6b",
    "#3a8b8b",
    "#8b5f3a",
]

_CATEGORY_SPLIT_RE = re.compile(r"[,;\n\r\t]+")


# ---------- storage ----------

def _empty() -> dict:
    return {"cubes": [], "categories": list(DEFAULT_CATEGORIES)}


def _sanitize_category(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return DEFAULT_CATEGORIES[0]
    s = _CATEGORY_SPLIT_RE.split(s, maxsplit=1)[0].strip()
    if not s:
        return DEFAULT_CATEGORIES[0]
    return s[:48]


def _recompute_categories(data: dict) -> list[str]:
    used = {c["category"] for c in data["cubes"]}
    result = list(DEFAULT_CATEGORIES)
    for cat in sorted(used):
        if cat not in result:
            result.append(cat)
    return result


def _load() -> dict:
    if not CUBES_FILE.exists():
        return _empty()
    try:
        data = json.loads(CUBES_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return _empty()
    if not isinstance(data, dict):
        return _empty()
    data.setdefault("cubes", [])

    changed = False
    for c in data["cubes"]:
        raw_cat = c.get("category", "")
        clean = _sanitize_category(raw_cat)
        if clean != raw_cat:
            c["category"] = clean
            changed = True

    data["categories"] = _recompute_categories(data)

    if changed:
        try:
            _save_raw(data)
        except OSError:
            pass

    return data


def _save_raw(data: dict) -> None:
    CUBES_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CUBES_FILE.with_suffix(CUBES_FILE.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(CUBES_FILE)


def _save(data: dict) -> None:
    _save_raw(data)


# ---------- helpers ----------

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = _SLUG_RE.sub("_", s).strip("_")
    return (s or "cube")[:32]


def _make_id(name: str, existing: set[str]) -> str:
    base = _slugify(name)
    if base not in existing:
        return base
    return f"{base}_{uuid.uuid4().hex[:4]}"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _find(cubes: list[dict], cube_id: str) -> dict | None:
    for c in cubes:
        if c["id"] == cube_id:
            return c
    return None


def _is_composite(cube: dict) -> bool:
    return cube.get("type") == "composite"


def _cleanup_parts(cubes: list[dict], removed_id: str) -> None:
    """Вычистить removed_id из parts всех composite.

    Вызывается при удалении ЛЮБОГО кубика (и простого, и composite),
    потому что и простой, и composite могут быть чьими-то частями.
    """
    now = _now_ms()
    for c in cubes:
        if _is_composite(c) and removed_id in c.get("parts", []):
            c["parts"] = [p for p in c["parts"] if p != removed_id]
            c["modified"] = now


def _walk_reaches(cubes_by_id: dict, start_id: str, target_id: str, seen: set) -> bool:
    """True, если от start_id можно дойти до target_id по цепочке parts."""
    if start_id in seen:
        return False
    seen.add(start_id)
    if start_id == target_id:
        return True
    node = cubes_by_id.get(start_id)
    if node is None or node.get("type") != "composite":
        return False
    for child in node.get("parts", []):
        if _walk_reaches(cubes_by_id, child, target_id, seen):
            return True
    return False


def _validate_parts(cubes: list[dict], parts: list[str], current_id: str | None = None) -> list[str]:
    """Проверить, что все parts существуют и не создают цикл.

    current_id — id кубика, которому мы назначаем parts (None при создании,
    так как новый кубик ещё нигде не упомянут — цикл невозможен).
    """
    by_id = {c["id"]: c for c in cubes}

    clean: list[str] = []
    for pid in parts:
        if by_id.get(pid) is None:
            raise ValueError(f"part not found: {pid}")
        if pid in clean:
            continue  # дедуп на всякий случай
        clean.append(pid)

    if current_id is None:
        return clean

    # 1) кубик не может быть частью самого себя
    if current_id in clean:
        raise ValueError("cube cannot contain itself")

    # 2) ни от одной из новых частей нельзя дойти обратно до current_id
    for pid in clean:
        if _walk_reaches(by_id, pid, current_id, set()):
            raise ValueError("cyclic reference")

    return clean


# ---------- public API ----------

def list_all() -> dict:
    data = _load()
    return {"cubes": data["cubes"], "categories": data["categories"]}


def create(payload: dict) -> dict:
    data = _load()
    name = (payload.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    category = _sanitize_category(payload.get("category") or "")
    wants_composite = payload.get("type") == "composite"

    existing_ids = {c["id"] for c in data["cubes"]}
    cube_id = _make_id(name, existing_ids)
    now = _now_ms()

    cube: dict[str, Any] = {
        "id": cube_id,
        "name": name,
        "category": category,
    }

    if wants_composite:
        cube["type"] = "composite"
        # При создании current_id=None — новый кубик ещё не в базе,
        # на него никто не мог сослаться, цикл невозможен.
        cube["parts"] = _validate_parts(data["cubes"], payload.get("parts") or [])
    else:
        cube["text"] = (payload.get("text") or "").strip()

    cube["color"] = payload.get("color") or _PALETTE[len(data["cubes"]) % len(_PALETTE)]
    cube["pinned"] = bool(payload.get("pinned", False))
    cube["last_used"] = now
    cube["created"] = now
    cube["modified"] = now

    data["cubes"].append(cube)
    data["categories"] = _recompute_categories(data)
    _save(data)
    return cube


def update(cube_id: str, payload: dict) -> dict:
    data = _load()
    cube = _find(data["cubes"], cube_id)
    if cube is None:
        raise KeyError(cube_id)

    if "name" in payload:
        name = (payload["name"] or "").strip()
        if not name:
            raise ValueError("name cannot be empty")
        cube["name"] = name

    if "category" in payload:
        cube["category"] = _sanitize_category(payload["category"] or "")

    if payload.get("color"):
        cube["color"] = payload["color"]

    if "pinned" in payload:
        cube["pinned"] = bool(payload["pinned"])

    if _is_composite(cube) and "parts" in payload:
        # Здесь current_id передаём — циклы надо проверять именно при изменении.
        cube["parts"] = _validate_parts(data["cubes"], payload["parts"] or [], current_id=cube_id)

    if not _is_composite(cube) and "text" in payload:
        cube["text"] = (payload["text"] or "").strip()

    cube["modified"] = _now_ms()
    data["categories"] = _recompute_categories(data)
    _save(data)
    return cube


def delete(cube_id: str) -> None:
    data = _load()
    cube = _find(data["cubes"], cube_id)
    if cube is None:
        raise KeyError(cube_id)
    data["cubes"] = [c for c in data["cubes"] if c["id"] != cube_id]
    # Всегда чистим ссылки на удалённый id во всех composite.
    # (И простой кубик, и composite могут быть чьими-то частями.)
    _cleanup_parts(data["cubes"], cube_id)
    data["categories"] = _recompute_categories(data)
    _save(data)


def touch(cube_id: str) -> dict:
    data = _load()
    cube = _find(data["cubes"], cube_id)
    if cube is None:
        raise KeyError(cube_id)
    cube["last_used"] = _now_ms()
    _save(data)
    return cube
