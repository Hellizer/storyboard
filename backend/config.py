"""
Конфигурация путей и настроек.
Пользовательские данные — в ~/.storyboard/.
Дефолтные assets — в репозитории.
"""
import os
from pathlib import Path
import shutil


# Корень репозитория (там где backend/)
REPO_ROOT = Path(__file__).resolve().parent

# Дефолтные asset'ы (в репо, коммитятся)
TEMPLATES_DIR = REPO_ROOT / "templates"
ADAPTERS_DIR = REPO_ROOT / "adapters"
DEFAULT_PRESETS_DIR = REPO_ROOT / "presets"

# Пользовательские данные — в домашней директории
# Можно переопределить через переменную окружения STORYBOARD_HOME
_home_override = os.environ.get("STORYBOARD_HOME")
USER_DIR = Path(_home_override).expanduser() if _home_override else Path.home() / ".storyboard"

PROJECTS_DIR = USER_DIR / "projects"
USER_PRESETS_DIR = USER_DIR / "presets"
CONFIG_FILE = USER_DIR / "config.json"
CUBES_FILE = USER_DIR / "cubes.json"

# ComfyUI по умолчанию
DEFAULT_COMFY_URL = "http://localhost:8188"

# llama-server по умолчанию (OpenAI-совместимый API)
DEFAULT_LLAMA_URL = "http://localhost:8080"

# Порт нашего бэкенда
PORT = int(os.environ.get("STORYBOARD_PORT", "9000"))

def _migrate_presets_from_repo():
    """
    Переместить пресеты из репо в пользовательскую папку.
    Выполняется один раз при первом запуске.
    """
    if not DEFAULT_PRESETS_DIR.exists():
        return
    for p in DEFAULT_PRESETS_DIR.glob("*.json"):
        target = USER_PRESETS_DIR / p.name
        if target.exists():
            # Пользовательский уже есть — реповый просто удаляем
            p.unlink()
            continue
        try:
            shutil.move(str(p), str(target))
            print(f"[config] миграция пресета: {p.name}")
        except Exception as e:
            print(f"[config] не удалось мигрировать {p.name}: {e}")

def ensure_dirs():
    """Создать все необходимые директории при старте."""
    for d in (
        TEMPLATES_DIR,
        ADAPTERS_DIR,
        DEFAULT_PRESETS_DIR,
        PROJECTS_DIR,
        USER_PRESETS_DIR,
    ):
        d.mkdir(parents=True, exist_ok=True)
    _migrate_presets_from_repo()

def load_user_config() -> dict:
    """Загрузить пользовательский конфиг (если есть)."""
    if not CONFIG_FILE.exists():
        return {}
    try:
        import json
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_user_config(data: dict) -> None:
    """Сохранить пользовательский конфиг."""
    import json
    CONFIG_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_comfy_url() -> str:
    """Вернуть URL ComfyUI: из конфига или дефолт."""
    cfg = load_user_config()
    return cfg.get("comfy_url", DEFAULT_COMFY_URL)

def get_llama_url() -> str:
    """Вернуть URL llama-server: из конфига или дефолт."""
    cfg = load_user_config()
    return cfg.get("llama_url", DEFAULT_LLAMA_URL)

def list_presets() -> list[str]:
    """Список пресетов — только из пользовательской папки."""
    names = set()
    if USER_PRESETS_DIR.exists():
        for p in USER_PRESETS_DIR.glob("*.json"):
            names.add(p.stem)
    return sorted(names)


def resolve_preset_path(name: str) -> Path | None:
    """Найти файл пресета в пользовательской папке."""
    path = USER_PRESETS_DIR / f"{name}.json"
    if path.exists():
        return path
    return None


def save_preset(name: str, data: dict) -> Path:
    """Сохранить пресет в пользовательскую директорию."""
    import json
    safe = "".join(c for c in name if c.isalnum() or c in "-_ ")
    if not safe:
        raise ValueError("invalid preset name")
    path = USER_PRESETS_DIR / f"{safe}.json"
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def delete_preset(name: str) -> bool:
    """Удалить пользовательский пресет. Дефолтные не удаляются."""
    safe = "".join(c for c in name if c.isalnum() or c in "-_ ")
    if not safe:
        return False
    path = USER_PRESETS_DIR / f"{safe}.json"
    if path.exists():
        path.unlink()
        return True
    return False
