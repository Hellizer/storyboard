/**
 * UI глобальной очереди: хедер + выпадающая панель.
 *
 * Никаких решений не принимает — только отрисовка состояния,
 * которое приходит из generation.js (WS /ws/app).
 */
import { generation } from './generation.js';
import { $ } from '../infra/dom.js';

let queueOpen = false;


// ---------- форматирование ----------

function formatElapsed(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 'с';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + 'м ' + sec + 'с';
}


function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;',
  })[c]);
}


// ---------- рендер одного элемента очереди ----------

function buildTaskEl(task) {
  const el = document.createElement('div');
  el.className = 'queue-item status-' + task.status;
  el.dataset.taskId = task.id;

  // Превью
  let thumbHtml = '';
  if (task.image && task.image.history_id && task.projectName && task.sceneId) {
    const url = `/api/projects/${encodeURIComponent(task.projectName)}/scenes/${encodeURIComponent(task.sceneId)}/history/${encodeURIComponent(task.image.history_id)}/image`;
    thumbHtml = `<img src="${url}" alt="">`;
  } else if (task.status === 'running') {
    thumbHtml = '<span>⚙</span>';
  } else if (task.status === 'queued') {
    thumbHtml = '<span>⏱</span>';
  } else if (task.status === 'error' || task.status === 'cancelled') {
    thumbHtml = '<span>✕</span>';
  } else {
    thumbHtml = '<span>▢</span>';
  }

  // Подпись
  let sub = '';
  if (task.status === 'queued') {
    sub = 'в очереди';
  } else if (task.status === 'running') {
    sub = `выполняется · ${task.progress || 0}%`;
  } else if (task.status === 'done') {
    const elapsed = task.startedAt && task.finishedAt
      ? formatElapsed((task.finishedAt - task.startedAt) * 1000)
      : '';
    sub = `готово${elapsed ? ' · ' + elapsed : ''}`;
  } else if (task.status === 'error') {
    sub = 'ошибка: ' + (task.error || 'unknown');
  } else if (task.status === 'cancelled') {
    sub = 'отменено';
  }

  const isRunning = task.status === 'running';

  el.innerHTML = `
    <div class="queue-item-thumb">${thumbHtml}</div>
    <div class="queue-item-info">
      <div class="queue-item-title">${escapeHtml(task.title || '(без названия)')}</div>
      <div class="queue-item-sub">${escapeHtml(sub)}</div>
      ${isRunning ? `
        <div class="queue-item-progress">
          <div class="queue-item-progress-bar" style="width:${task.progress || 0}%"></div>
        </div>
      ` : ''}
    </div>
    <div class="queue-item-actions">
      ${isRunning
        ? `<button class="icon-btn small" data-action="cancel" title="Прервать">⛔</button>`
        : `<button class="icon-btn small" data-action="remove" title="Убрать">✕</button>`}
    </div>
  `;

  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'remove') {
        await generation.remove(task.id);
      } else if (action === 'cancel') {
        await generation.cancel(task.id);
      }
    });
  });

  // Клик по элементу — перейти к сцене
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-action]')) return;
    if (!task.projectName || !task.sceneId) return;
    window.location.hash = `/project/${encodeURIComponent(task.projectName)}/scene/${task.sceneId}`;
    closeQueue();
  });

  return el;
}


// ---------- рендер панели ----------

function renderQueue() {
  const body = $('queueBody');
  if (!body) return;
  const all = generation.getAll();

  if (all.length === 0) {
    body.innerHTML = '<div class="queue-empty">Очередь пуста</div>';
    return;
  }

  // Порядок: running → queued (FIFO) → finished (свежие сверху)
  const running = all.filter(t => t.status === 'running');
  const queued = all.filter(t => t.status === 'queued');
  const finished = all
    .filter(t => t.status === 'done' || t.status === 'error' || t.status === 'cancelled')
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));

  body.innerHTML = '';
  for (const t of [...running, ...queued, ...finished]) {
    body.appendChild(buildTaskEl(t));
  }
}


// ---------- рендер хедера ----------

function renderHeader() {
  const all = generation.getAll();
  const active = generation.getActive();
  const queued = all.filter(t => t.status === 'queued');

  const badge = $('ghQueueBadge');
  const status = $('ghQueueStatus');
  const btn = $('btnGlobalQueue');

  const total = queued.length + (active ? 1 : 0);

  if (active) {
    badge.textContent = String(total);
    badge.classList.remove('hidden');
    status.textContent = `выполняется · ${active.progress || 0}%`;
    btn.classList.add('running');
  } else if (queued.length) {
    badge.textContent = String(queued.length);
    badge.classList.remove('hidden');
    status.textContent = `в очереди: ${queued.length}`;
    btn.classList.remove('running');
  } else {
    badge.classList.add('hidden');
    status.textContent = 'очередь пуста';
    btn.classList.remove('running');
  }
}


// ---------- общий апдейт ----------

function refresh() {
  renderHeader();
  if (queueOpen) renderQueue();
}


// ---------- открытие/закрытие панели ----------

function openQueue() {
  queueOpen = true;
  $('queuePanel').classList.remove('hidden');
  renderQueue();
}

function closeQueue() {
  queueOpen = false;
  $('queuePanel').classList.add('hidden');
}


// ---------- публичное API ----------

export function initQueueUI() {
  // Кнопка хедера — toggle панели
  $('btnGlobalQueue').addEventListener('click', () => {
    if (queueOpen) closeQueue();
    else openQueue();
  });

  $('btnQueueClose').addEventListener('click', closeQueue);

  // Клик вне панели — закрыть
  document.addEventListener('click', (e) => {
    if (!queueOpen) return;
    if (e.target.closest('#queuePanel')) return;
    if (e.target.closest('#btnGlobalQueue')) return;
    closeQueue();
  });

  // Escape — закрыть
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && queueOpen) closeQueue();
  });

  // Подписки на события generation — один обработчик на всё
  generation.on('snapshot', refresh);
  generation.on('task-added', refresh);
  generation.on('task-updated', refresh);
  generation.on('task-started', refresh);
  generation.on('task-finished', refresh);
  generation.on('task-removed', refresh);

  // Первичная отрисовка
  refresh();
}
