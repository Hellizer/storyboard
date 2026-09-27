/**
 * Лента миниатюр истории сцены: загрузка, рендер, выбор, удаление.
 */
import { $ } from '../../infra/dom.js';
import { historyImageUrl } from './utils.js';

let ctx = null;             // { projectName, sceneId, deps }
let historyCache = [];
let activeHistoryId = null;
let onSelectCallback = null;
let onDeleteCallback = null;

export function setHistoryContext(projectName, sceneId, deps) {
  ctx = { projectName, sceneId, deps };
}

export function setHistoryCallbacks(onSelect, onDelete) {
  onSelectCallback = onSelect;
  onDeleteCallback = onDelete;
}

export function setActiveHistoryId(id) {
  activeHistoryId = id;
}

export async function loadAndRenderHistory() {
  if (!ctx) return;
  try {
    const items = await fetch(
      `/api/projects/${encodeURIComponent(ctx.projectName)}/scenes/${encodeURIComponent(ctx.sceneId)}/history`
    ).then(r => r.json());
    historyCache = items;
    renderHistoryStrip();
  } catch (e) {
    console.warn('[scene/history] не удалось загрузить историю:', e);
  }
}

export function renderHistoryStrip() {
  const container = $('sceneHistory');
  if (!container) return;

  if (!historyCache.length) {
    container.innerHTML = '<div class="scene-history-empty">нет сгенерированных вариантов</div>';
    return;
  }

  container.innerHTML = '';

  for (const entry of historyCache) {
    const el = document.createElement('div');
    el.className = 'scene-history-item';
    if (entry.task_id === activeHistoryId) el.classList.add('active');
    if (entry.status === 'error') el.classList.add('status-error');
    if (entry.status === 'cancelled') el.classList.add('status-cancelled');

    const hasImage = entry.image && entry.image.filename;
    const inner = hasImage
      ? `<img src="${historyImageUrl(ctx.projectName, ctx.sceneId, entry.task_id)}" alt="">`
      : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:10px;">${entry.status}</div>`;

    el.innerHTML = `
      ${inner}
      <button class="history-item-delete" title="Удалить">✕</button>
    `;

    el.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('history-item-delete')) return;
      if (onSelectCallback) onSelectCallback(entry);
    });

    el.querySelector('.history-item-delete').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (onDeleteCallback) onDeleteCallback(entry);
    });

    container.appendChild(el);
  }

  // Скроллим к активному
  setTimeout(() => {
    const active = container.querySelector('.scene-history-item.active');
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, 50);
}

export function getHistoryEntry(taskId) {
  return historyCache.find(e => e.task_id === taskId) || null;
}
