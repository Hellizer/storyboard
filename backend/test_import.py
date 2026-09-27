"""
Проверка автогенерации адаптера из workflow.
Запуск: py test_import.py
"""
import json
import sys
from pathlib import Path

# Импортируем модуль из той же папки
sys.path.insert(0, str(Path(__file__).resolve().parent))

from workflow_import import generate_adapter


def main():
    backend_dir = Path(__file__).parent
    template_path = backend_dir / "templates" / "simple_anima.json"
    output_path = backend_dir / "adapters" / "simple_anima.json"
    output_path.parent.mkdir(exist_ok=True)

    if not template_path.exists():
        print(f"[ERROR] Не найден файл: {template_path}")
        sys.exit(1)

    workflow = json.loads(template_path.read_text(encoding="utf-8"))

    print(f"[test] Читаю: {template_path.name}")
    print(f"[test] Узлов в workflow: {len(workflow)}")
    print()

    result = generate_adapter(workflow)
    mapping = result["mapping"]
    info = result["import_info"]

    print("=" * 60)
    print("MAPPING:")
    print("=" * 60)
    for key, spec in mapping.items():
        nid = spec.get("node_id", "?")
        print(f"  {key:20s} → #{nid} {spec['class_type']}.{spec['field']}")
    print()

    print("=" * 60)
    print("FOUND:")
    print("=" * 60)
    for item in info["found"]:
        print(f"  ✓ {item}")
    print()

    if info["missing"]:
        print("MISSING:")
        for item in info["missing"]:
            print(f"  ✗ {item}")
        print()

    if info["notes"]:
        print("NOTES:")
        for item in info["notes"]:
            print(f"  ! {item}")
        print()

    # Сохраняем адаптер
    adapter = {
        "name": output_path.stem,
        "description": f"Автоматически сгенерирован из {template_path.name}",
        "mapping": mapping,
        "import_info": info,
    }
    output_path.write_text(
        json.dumps(adapter, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[test] Адаптер сохранён: {output_path}")


if __name__ == "__main__":
    main()
