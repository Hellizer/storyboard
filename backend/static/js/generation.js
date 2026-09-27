/**
 * Тонкий клиент очереди на бэкенде.
 * Слушает WS /ws/app, локально ничего не хранит (только кэш для рендера).
 */
let ws = null;
let tasks = [];
let active = null;
const listeners = new Map();

function emit(event, data) {
  const subs = listeners.get(event);
  if (!subs) return;
  for (const cb of subs) {
    try { cb(data); } catch (e) { console.error('[generation] listener error:', e); }
  }
}

function ensureWs() {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws/app`);

  ws.onopen = () => console.log('[generation] ws/app connected');
  ws.onclose = () => {
    console.warn('[generation] ws/app closed, reconnect in 2s');
    setTimeout(ensureWs, 2000);
  };
  ws.onerror = () => console.warn('[generation] ws/app error');
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleServerMessage(msg);
  };
  return ws;
}

function handleServerMessage(msg) {
  const type = msg.type;
  const data = msg.data;

  if (type === 'snapshot') {
    tasks = data.tasks || [];
    active = data.active || null;
    emit('snapshot', { tasks, active });
    return;
  }

  if (type === 'task-added') {
    tasks.push(data);
    emit('task-added', data);
  } else if (type === 'task-updated' || type === 'task-started' || type === 'task-finished') {
    const i = tasks.findIndex(t => t.id === data.id);
    if (i >= 0) tasks[i] = data;
    else tasks.push(data);
    if (data.status === 'running') active = data;
    if (type === 'task-finished') active = null;
    emit(type, data);
    emit('task-updated', data);

    // Отдельное событие — «сцена обновилась извне».
    // На него подписывается граф и перерисовывает узел.
    if (type === 'task-finished' && data.status === 'done' &&
        data.sceneId && data.projectName && data.image?.history_id) {
      emit('scene-changed', {
        projectName: data.projectName,
        sceneId: data.sceneId,
        last_image: {
          history_id: data.image.history_id,
          width: data.image.width || 1152,
          height: data.image.height || 896,
        },
      });
    }
  } else if (type === 'task-removed') {
    tasks = tasks.filter(t => t.id !== data);
    emit('task-removed', data);
  }
}

export const generation = {
  on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return () => listeners.get(event)?.delete(cb);
  },

  async init() {
    ensureWs();
    try {
      const d = await fetch('/api/queue').then(r => r.json());
      tasks = d.tasks || [];
      active = d.active || null;
      emit('snapshot', { tasks, active });
    } catch (e) {
      console.warn('[generation] initial load failed:', e);
    }
  },

  getAll() { return tasks.slice(); },
  getActive() { return active; },

  getForScene(sceneId) {
    if (active && active.sceneId === sceneId) return active;
    const q = tasks.filter(t => t.sceneId === sceneId && t.status === 'queued');
    if (q.length) return q[q.length - 1];
    const done = tasks.filter(t => t.sceneId === sceneId);
    return done.length ? done[done.length - 1] : null;
  },

  async submit(task) {
      return await fetch('/api/queue/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(task),
      }).then(r => r.json());
    },

  async remove(id) {
    return await fetch(`/api/queue/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async cancel(id) {
    return await fetch(`/api/queue/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },
};
