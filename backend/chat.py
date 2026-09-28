"""Чат с LLM (llama-server, OpenAI-совместимый API, router mode).

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

Стриминг (SSE):
- POST /v1/chat/completions со stream=true, header X-Conversation-Id.
- НИКАКИХ idle-таймаутов на чтение. Пока llama-server считает
  промпт-процессинг (10+ сек на 1656 токенов), сокет молчит — и это
  нормально, а не повод рвать соединение.
- При обрыве соединения (RST/FIN от ОС) делаем POST /v1/streams/lookup:
  - стрим завершён → выходим;
  - стрим жив → GET /v1/stream?conv_id=X&from=N и продолжаем читать
    с байта N (сервер буферизирует SSE-ответ по conversation_id);
  - lookup не отвечает → пробуем резюм один раз, потом сдаёмся.
- Позиция N инкрементируется по каждой полной SSE-строке (включая
  комментарии и пустые строки), чтобы резюм стартовал с границы
  события, а не в середине line.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
import uuid
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import quote

import aiohttp
import httpx

from config import PROJECTS_DIR, USER_DIR, get_llama_url


# ---------- llama-server (router mode) ----------

_models_cache: list[dict] = []
_models_cache_ts: float = 0.0
_MODELS_CACHE_TTL = 5.0


async def list_models(force: bool = False) -> list[dict]:
    """Список моделей из router mode. Кеш на 5 секунд."""
    global _models_cache, _models_cache_ts
    now = time.time()
    if not force and _models_cache and (now - _models_cache_ts) < _MODELS_CACHE_TTL:
        return _models_cache

    base = get_llama_url().rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{base}/models")
            r.raise_for_status()
            data = r.json().get("data") or []
    except Exception as e:
        print(f"[chat] /models failed: {e}")
        return _models_cache

    _models_cache = data
    _models_cache_ts = now
    return data


async def get_active_model_id() -> str | None:
    """Id первой доступной модели (router mode возвращает ровно одну)."""
    models = await list_models()
    if not models:
        return None
    return models[0].get("id")


async def unload_model() -> bool:
    """POST /models/unload — выгружает модель из VRAM, процесс жив."""
    model_id = await get_active_model_id()
    if not model_id:
        return False

    base = get_llama_url().rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{base}/models/unload",
                json={"model": model_id},
            )
            global _models_cache_ts
            _models_cache_ts = 0.0
            if r.status_code in (200, 400, 404):
                return True
            print(f"[chat] unload {r.status_code}: {r.text[:200]}")
            return False
    except Exception as e:
        print(f"[chat] unload failed: {e}")
        return False


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
    if not data_url or not data_url.startswith("data:"):
        return None
    try:
        header, b64 = data_url.split(",", 1)
    except ValueError:
        return None
    if ";base64" not in header:
        return None
    try:
        mime = header[5:].split(";")[0]
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
    chat_upload  → декодировать base64 и сохранить файл.
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

    if not blocks or (len(blocks) == 1 and blocks[0].get("type") == "text"):
        return text
    return blocks


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


# ---------- streaming ----------

async def check_stream_done(stream_identity: str) -> bool | None:
    """Спросить у router'а, жив ли стрим по conversation_id.

    Возвращает:
      False — стрим ещё идёт (is_done=false), можно резюмить;
      True  — стрим завершён на сервере;
      None  — не удалось узнать (endpoint молчит, ошибка, пустой ответ).
    """
    base = get_llama_url().rstrip("/")
    url = f"{base}/v1/streams/lookup"
    payload = {"conversation_ids": [stream_identity]}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(url, json=payload)
            if r.status_code != 200:
                return None
            data = r.json()
            if not isinstance(data, list) or not data:
                return None
            cid_base = stream_identity.split("::", 1)[0]
            for item in data:
                cid = item.get("conversation_id") or ""
                if cid == stream_identity or cid.split("::", 1)[0] == cid_base:
                    return bool(item.get("is_done"))
            return None
    except Exception:
        return None


async def _iter_sse(
    content: aiohttp.StreamReader,
) -> AsyncIterator[tuple]:
    """Разобрать SSE-поток в события.

    Yield'ит кортежи:
      ("bytes", n)         — прочитано n байт (полная SSE-строка),
      ("content", text)    — дельта обычного контента,
      ("thinking", text)   — дельта reasoning_content,
      ("done",)            — finish_reason или [DONE].

    Позиция "bytes" инкрементируется по каждой ПОЛНОЙ строке — включая
    пустые и комментарии. Это делает резюм через ?from=N безопасным:
    N всегда указывает на границу строки, а не в середину.
    """
    while True:
        try:
            line_bytes = await content.readline()
        except (aiohttp.ClientError, ConnectionError, OSError):
            return

        if not line_bytes:
            # EOF — соединение закрыто.
            return

        line = line_bytes.decode("utf-8", errors="replace").rstrip("\r\n")

        # События этой строки (если есть) — выпускаем ДО "bytes",
        # чтобы при резюме повтор был, а не потеря.
        if line and not line.startswith(":"):
            if line.startswith("data:"):
                chunk = line[5:].strip()
                if chunk == "[DONE]":
                    yield ("bytes", len(line_bytes))
                    yield ("done",)
                    return

                try:
                    obj = json.loads(chunk)
                except json.JSONDecodeError:
                    obj = None

                if obj is not None:
                    try:
                        choice = obj["choices"][0]
                    except (KeyError, IndexError, TypeError):
                        choice = None

                    if choice is not None:
                        delta = choice.get("delta") or {}
                        text = delta.get("content") or ""
                        reasoning = delta.get("reasoning_content") or ""

                        if text:
                            yield ("content", text)
                        if reasoning:
                            yield ("thinking", reasoning)

                        if choice.get("finish_reason"):
                            yield ("bytes", len(line_bytes))
                            yield ("done",)
                            return

        # Строка отработана — фиксируем позицию.
        yield ("bytes", len(line_bytes))


def _build_resume_url(base: str, stream_identity: str, from_byte: int) -> str:
    return (
        f"{base}/v1/stream"
        f"?conv_id={quote(stream_identity, safe='')}&from={int(from_byte)}"
    )


async def stream_completion(
    messages: list[dict],
    *,
    conversation_id: str,
    temperature: float = 0.9,
    max_tokens: int = 1024,
    enable_thinking: bool = False,
) -> AsyncIterator[tuple[str, str]]:
    model_id = await get_active_model_id()
    if not model_id:
        raise RuntimeError("llama-server: no models available")

    base = get_llama_url().rstrip("/")
    stream_identity = f"{conversation_id}::{model_id}"

    payload = {
        "model": model_id,
        "messages": messages,
        "stream": True,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "sse_ping_interval": 1,
        "chat_template_kwargs": {"enable_thinking": bool(enable_thinking)},
    }
    headers = {"X-Conversation-Id": stream_identity}

    # НИКАКИХ idle-таймаутов на чтение. Пока llama-server считает
    # промпт-процессинг, сокет молчит — ждём. Мёртвое соединение убьёт
    # сам TCP (RST/FIN), и мы это поймаем как ClientError.
    timeout = aiohttp.ClientTimeout(
        total=None,
        sock_connect=120.0,
        sock_read=None,
    )

    bytes_received = 0
    attempt = 0

    async with aiohttp.ClientSession(timeout=timeout) as session:
        while True:
            attempt += 1
            got_bytes = False

            try:
                if attempt == 1:
                    req = session.post(
                        f"{base}/v1/chat/completions",
                        json=payload,
                        headers=headers,
                    )
                else:
                    resume_url = _build_resume_url(
                        base, stream_identity, bytes_received,
                    )
                    req = session.get(resume_url, headers=headers)

                async with req as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        if attempt == 1:
                            raise RuntimeError(
                                f"llama-server {resp.status}: {body[:300]}"
                            )
                        # Резюм не удался — выходим тихо, что успели, уже отдали.
                        print(f"[chat] resume HTTP {resp.status}: {body[:200]}")
                        return

                    async for event in _iter_sse(resp.content):
                        kind = event[0]

                        if kind == "bytes":
                            bytes_received += event[1]
                            got_bytes = True
                        elif kind == "done":
                            return
                        elif kind == "content":
                            yield ("content", event[1])
                        elif kind == "thinking":
                            if enable_thinking:
                                yield ("thinking", event[1])

            except (aiohttp.ClientError, ConnectionError, OSError) as e:
                # Соединение умерло. Это не "таймаут", это RST/FIN от ОС —
                # TCP сам сообщил, что стрим порван.
                print(f"[chat] stream attempt #{attempt} interrupted: {e}")
            except RuntimeError:
                # Ошибка первого запроса — не глушим, пробрасываем.
                raise

            # Сюда попадаем после EOF или разрыва.
            if attempt > 1 and not got_bytes:
                print("[chat] resume produced no new bytes, giving up")
                return

            # Жив ли стрим на сервере?
            status = await check_stream_done(stream_identity)

            if status is True:
                # Стрим завершён на сервере — дочитывать нечего.
                return

            if status is None:
                # Lookup молчит. Первый обрыв — попробуем резюм вслепую
                # один раз. Повторный обрыв с неудачным lookup — сдаёмся.
                if attempt > 1:
                    return

            # status is False  → стрим жив, резюмим с bytes_received.
            # status is None и attempt == 1 → пробуем вслепую.
            print(
                f"[chat] resuming stream from byte {bytes_received} "
                f"(attempt #{attempt})"
            )
            continue
