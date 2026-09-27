"""
HR-MoA Storyboard Backend.
Тонкая точка входа: подключает роутеры, статику, ComfyClient, QueueManager.
"""
import os
from pathlib import Path

import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config
from comfy import comfy
from task_queue import queue
from routes import tasks as queue_routes
from routes import comfy as comfy_routes
from routes import projects as projects_routes
from routes import presets as presets_routes
from routes import workflow as workflow_routes


config.ensure_dirs()

PORT = config.PORT
STATIC_DIR = Path(__file__).resolve().parent / "static"


class StaticFilesNoCache(StaticFiles):
    MIME_MAP = {
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
    }

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        ext = os.path.splitext(str(full_path))[1].lower()
        if ext in self.MIME_MAP:
            response.headers["content-type"] = self.MIME_MAP[ext]
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    queue_routes.init_ws_hub()
    await comfy.start()
    print("[backend] startup complete")
    yield
    # shutdown
    await comfy.stop()
    print("[backend] shutdown complete")
app = FastAPI(title="HR-MoA Storyboard", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Статика
app.mount("/static", StaticFilesNoCache(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")


# Роутеры
app.include_router(queue_routes.router)
app.include_router(queue_routes.ws_router)
app.include_router(comfy_routes.router)
app.include_router(projects_routes.router)
app.include_router(presets_routes.router)
app.include_router(workflow_routes.router)


if __name__ == "__main__":
    print(f"[backend] HR-MoA Storyboard на http://localhost:{PORT}")
    print(f"[backend] ComfyUI URL: {config.get_comfy_url()}")
    print(f"[backend] Проекты: {config.PROJECTS_DIR}")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
