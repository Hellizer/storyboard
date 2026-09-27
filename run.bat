@echo off
setlocal
cd /d "%~dp0"

echo.
echo [Storyboard] HR-MoA Storyboard launcher
echo.

REM Проверяем Python
where py >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python launcher "py" not found in PATH.
    echo Install Python 3.10+ from https://www.python.org/downloads/
    pause
    exit /b 1
)

REM Устанавливаем зависимости (быстро, если уже стоят)
echo [Storyboard] Installing requirements...
py -m pip install -q -r requirements.txt
if errorlevel 1 (
    echo [ERROR] pip install failed.
    pause
    exit /b 1
)

REM Запускаем бэкенд
echo [Storyboard] Starting backend on http://localhost:9000
echo [Storyboard] Press Ctrl+C to stop.
echo.
cd backend
py main.py

endlocal
