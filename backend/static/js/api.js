/**
 * Все запросы к бэкенду. Одна точка входа для сети.
 *
 * Структура:
 *   api.comfy      — статус ComfyUI, view, списки LoRA/моделей/сэмплеров
 *   api.queue      — очередь задач (глобальная, живёт на бэкенде)
 *   api.workflow   — шаблоны, адаптеры, импорт
 *   api.presets    — CRUD пресетов
 *   api.projects   — CRUD проектов
 */

const API = "";  // тот же origin


// ---------- внутреннее ----------

async function request(method, path, body = null) {
  const opts = {
    method,
    headers: body ? {"Content-Type": "application/json"} : {},
  };
  if (body) opts.body = JSON.stringify(body);

  const r = await fetch(API + path, opts);
  if (!r.ok) {
    let detail = "";
    try {
      const d = await r.json();
      detail = d.detail || JSON.stringify(d);
    } catch {
      detail = await r.text();
    }
    throw new Error(`${method} ${path} → ${r.status}: ${detail}`);
  }

  // 204 / пустой ответ
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  return r.json();
}


export const api = {

  // ============================================================
  // ComfyUI — статус, view, списки значений
  // ============================================================
  comfy: {
    status: () => request("GET", "/api/comfy/status"),

    interrupt: () => request("POST", "/api/comfy/interrupt"),

    free: (payload = null) =>
      request("POST", "/api/comfy/free", payload),

    loras: (refresh = false) =>
      request("GET", `/api/comfy/loras${refresh ? "?refresh=true" : ""}`),

    models: (refresh = false) =>
      request("GET", `/api/comfy/models${refresh ? "?refresh=true" : ""}`),

    samplers: (refresh = false) =>
      request("GET", `/api/comfy/samplers${refresh ? "?refresh=true" : ""}`),

    schedulers: (refresh = false) =>
      request("GET", `/api/comfy/schedulers${refresh ? "?refresh=true" : ""}`),
  },


  // ============================================================
  // Очередь задач (живёт на бэкенде)
  // ============================================================
  queue: {
    get: () => request("GET", "/api/queue"),

    submit: (task) => request("POST", "/api/queue/submit", task),

    remove: (id) =>
      request("DELETE", `/api/queue/${encodeURIComponent(id)}`),

    cancel: (id) =>
      request("POST", `/api/queue/${encodeURIComponent(id)}/cancel`),
  },


  // ============================================================
  // Workflow: шаблоны, адаптеры, импорт, дефолты
  // ============================================================
  workflow: {
    templates: () => request("GET", "/api/workflow/templates"),

    adapters: () => request("GET", "/api/workflow/adapters"),

    import: (template, overwrite = false) =>
      request("POST", "/api/workflow/import", { template, overwrite }),

    templateDefaults: (template = "simple_anima") =>
      request("GET",
        `/api/workflow/template_defaults?template=${encodeURIComponent(template)}`),
  },


  // ============================================================
  // Пресеты
  // ============================================================
  presets: {
    list: () => request("GET", "/api/presets"),

    get: (name) =>
      request("GET", `/api/presets/${encodeURIComponent(name)}`),

    save: (name, data) =>
      request("POST", `/api/presets/${encodeURIComponent(name)}`, data),

    delete: (name) =>
      request("DELETE", `/api/presets/${encodeURIComponent(name)}`),
  },


  // ============================================================
  // Проекты
  // ============================================================
  projects: {
    list: () => request("GET", "/api/projects"),

    create: (name, description = "") =>
      request("POST", "/api/projects", { name, description }),

    get: (name) =>
      request("GET", `/api/projects/${encodeURIComponent(name)}`),

    update: (name, payload) =>
      request("PUT", `/api/projects/${encodeURIComponent(name)}`, payload),

    delete: (name) =>
      request("DELETE", `/api/projects/${encodeURIComponent(name)}`),
  },

};


// ============================================================
// Утилиты
// ============================================================

/**
 * URL картинки из ComfyUI через прокси бэкенда.
 * @param {{filename: string, subfolder?: string, type?: string}} img
 */
export function comfyViewUrl(img) {
  const p = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || "",
    type_: img.type || "output",
  });
  return `/api/comfy/view?${p}`;
}


/**
 * Открыть WS для очереди (глобальный, один на приложение).
 * Используется внутри generation.js. Здесь — вспомогательная функция.
 */
export function openAppWs() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${proto}//${location.host}/ws/app`);
}
