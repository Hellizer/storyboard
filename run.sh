#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo
echo "[Storyboard] HR-MoA Storyboard launcher"
echo

# Проверяем Python
if command -v python3 >/dev/null 2>&1; then
    PY=python3
elif command -v python >/dev/null 2>&1; then
    PY=python
else
    echo "[ERROR] Python not found. Install Python 3.10+."
    exit 1
fi

# Устанавливаем зависимости
echo "[Storyboard] Installing requirements..."
$PY -m pip install -q -r requirements.txt

# Запускаем бэкенд
echo "[Storyboard] Starting backend on http://localhost:9000"
echo "[Storyboard] Press Ctrl+C to stop."
echo
cd backend
exec $PY main.py
