"""Чат с LLM (llama-server, OpenAI-совместимый API).

Хранение истории по уровням:
- global:    ~/.storyboard/chat.json
- project:   ~/.storyboard/projects/<name>/chat.json
- scene:     ~/.storyboard/projects/<name>/scenes/<id>/chat.json

Формат сообщения:
    { "id": "...", "role": "user"|"assistant", "text": "...",
      "images": [{"kind": "scene_image"|"chat_upload", "name": "..."}],
      "ts": 1790509394823 }

Картинки:
- scene_image — файл в scenes/<id>/images/<name>
- chat_upload — файл в scenes/<id>/chat_uploads/<name>
При отправке в LLM бэк читает файлы, кодирует в base64, подставляет
data-URL. Сами файлы в chat.json не дублируются.

Клиент llama-server: POST /v1/chat/completions со stream=true (SSE).
Thinking отключается через chat_template_kwargs.enable_thinking.
Если включён — reasoning_content сливается в общий поток.
"""

from __future__ import annotations

import base64
import json
import time
import uuid
from pathlib import Path
from typing import AsyncIterator

import httpx

from config import PROJECTS_DIR, USER_DIR, get_llama_url


# ---------- пути ----------

def _scene_dir(project: str, scene: str) -> Path:
    return PROJECTS_DIR / project / "scenes" / scene


def chat_path(
    scope: str,
    project: str | None = None,
    scene: str | None = None,
) -> Path:
    if scope == "global":
        return USER_DIR / "chat.json"
    if scope == "project":
        if not project:
            raise ValueError("project required for scope=project")
        return PROJECTS_DIR / project / "chat.json"
    if scope == "scene":
        if not project or not scene:
            raise ValueError("project and scene required for scope=scene")
        return _scene_dir(project, scene) / "chat.json"
    raise ValueError(f"unknown scope: {scope!r}")


# ---------- storage ----------

def _load_raw(path: Path) -> dict:
    if not path.exists():
        return {"messages": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"messages": []}
    if not isinstance(data, dict):
        return {"messages": []}
    data.setdefault("messages", [])
    return data


def _save_raw(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(path)


def load_history(
    scope: str,
    project: str | None = None,
    scene: str | None = None,
) -> list[dict]:
    return _load_raw(chat_path(scope, project, scene)).get("messages", [])


def append_message(
    scope: str,
    role: str,
    text: str,
    images: list[dict] | None = None,
    project: str | None = None,
    scene: str | None = None,
) -> dict:
    path = chat_path(scope, project, scene)
    data = _load_raw(path)

    msg = {
        "id": uuid.uuid4().hex[:12],
        "role": role,
        "text": text or "",
        "ts": int(time.time() * 1000),
    }
    if images:
        msg["images"] = list(images)

    data["messages"].append(msg)
    _save_raw(path, data)
    return msg


def clear_history(
    scope: str,
    project: str | None = None,
    scene: str | None = None,
) -> None:
    _save_raw(chat_path(scope, project, scene), {"messages": []})


# ---------- images (VL) ----------

_MIME_BY_EXT = {
    "jpg": "jpeg",
    "jpeg": "jpeg",
    "png": "png",
    "webp": "webp",
    "gif": "gif",
}


def _encode_file(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    b64 = base64.b64encode(raw).decode("ascii")
    ext = path.suffix.lower().lstrip(".")
    mime = _MIME_BY_EXT.get(ext, "png")
    return f"data:image/{mime};base64,{b64}"


def _parse_data_url(data_url: str) -> tuple[bytes, str] | None:
    """'data:image/png;base64,...' → (bytes, 'png') или None."""
    if not data_url or not data_url.startswith("data:"):
        return None
    try:
        header, b64 = data_url.split(",", 1)
    except ValueError:
        return None
    if ";base64" not in header:
        return None
    try:
        mime = header[5:].split(";")[0]  # 'image/png'
        ext = mime.split("/", 1)[1].lower()
        if ext == "jpeg":
            ext = "jpg"
        raw = base64.b64decode(b64)
    except Exception:
        return None
    return raw, ext


def _image_path(
    item: dict,
    project: str | None,
    scene: str | None,
) -> Path | None:
    """Найти физический файл картинки по элементу из messages."""
    if not project or not scene:
        return None
    kind = item.get("kind")
    name = item.get("name")
    if not name:
        return None
    base = _scene_dir(project, scene)
    if kind == "scene_image":
        return base / "images" / name
    if kind == "chat_upload":
        return base / "chat_uploads" / name
    return None


def save_incoming_images(
    incoming: list[dict],
    project: str | None,
    scene: str | None,
) -> list[dict]:
    """Нормализовать список картинок из запроса.

    scene_image  → оставить как есть.
    chat_upload  → декодировать base64 и сохранить файл, вернуть
                   {"kind": "chat_upload", "name": "<uuid>.png"}.
    """
    result: list[dict] = []
    for item in incoming or []:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")

        if kind == "scene_image":
            name = item.get("name")
            if name:
                result.append({"kind": "scene_image", "name": name})
            continue

        if kind == "chat_upload":
            data_url = item.get("data")
            parsed = _parse_data_url(data_url) if data_url else None
            if parsed is None:
                continue
            raw, ext = parsed
            if not scene or not project:
                continue
            upload_dir = _scene_dir(project, scene) / "chat_uploads"
            upload_dir.mkdir(parents=True, exist_ok=True)
            fname = f"{uuid.uuid4().hex[:12]}.{ext}"
            (upload_dir / fname).write_bytes(raw)
            result.append({"kind": "chat_upload", "name": fname})
            continue

    return result


def _build_user_content(
    text: str,
    images: list[dict],
    project: str | None,
    scene: str | None,
) -> list[dict] | str:
    """Собрать content для user-сообщения.

    Без картинок — просто строка.
    С картинками — список блоков (text + image_url).
    """
    if not images:
        return text

    blocks: list[dict] = []
    if text:
        blocks.append({"type": "text", "text": text})

    for item in images:
        path = _image_path(item, project, scene)
        if path is None:
            continue
        url = _encode_file(path)
        if url:
            blocks.append({
                "type": "image_url",
                "image_url": {"url": url},
            })

    # Если ни одна картинка не подгрузилась — отдаём просто текст.
    if not blocks or (len(blocks) == 1 and blocks[0].get("type") == "text"):
        return text
    return blocks


# ---------- LLM client ----------

def _history_to_api(
    messages: list[dict],
    project: str | None,
    scene: str | None,
) -> list[dict]:
    out: list[dict] = []
    for m in messages:
        role = m.get("role")
        text = m.get("text") or ""
        images = m.get("images") or []
        if role == "user":
            content = _build_user_content(text, images, project, scene)
            out.append({"role": "user", "content": content})
        elif role == "assistant":
            out.append({"role": "assistant", "content": text})
    return out


async def stream_completion(
    messages: list[dict],
    *,
    temperature: float = 0.9,
    max_tokens: int = 1024,
    enable_thinking: bool = False,
) -> AsyncIterator[tuple[str, str]]:
    """Отправить в llama-server, вернуть чанки (channel, text).

    channel = "content"  — обычный ответ.
    channel = "thinking" — reasoning_content (только при enable_thinking).
    """
    base = get_llama_url().rstrip("/")
    url = f"{base}/v1/chat/completions"

    payload = {
        "model": "llama",
        "messages": messages,
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "chat_template_kwargs": {"enable_thinking": bool(enable_thinking)},
    }

    timeout = httpx.Timeout(600.0, connect=10.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, json=payload) as r:
            if r.status_code != 200:
                body = (await r.aread()).decode("utf-8", errors="replace")
                raise RuntimeError(f"llama-server {r.status_code}: {body[:300]}")

            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if chunk == "[DONE]":
                    break
                try:
                    obj = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                try:
                    delta = obj["choices"][0]["delta"]
                except (KeyError, IndexError, TypeError):
                    continue

                content = delta.get("content") or ""
                if content:
                    yield ("content", content)

                if enable_thinking:
                    reasoning = delta.get("reasoning_content") or ""
                    if reasoning:
                        yield ("thinking", reasoning)
