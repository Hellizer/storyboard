/**
 * Экран генерации сцены.
 * Большая картинка + лента истории снизу.
 */
import { api } from '../api.js';
import { $ } from '../ui.js';
import { openPanelForScene, closePanel } from '../panel.js';
import { generation } from '../generation.js';

let currentSceneId = null;
let deps = null;
let unsubscribers = [];
let promptSaveTimer = null;
let historyCache = [];
let activeHistoryId = null;


// ---------- пути к картинкам ----------

function historyImageUrl(history_id) {
  const projectName = deps.getProjectName();
  return `/api/projects/${encodeURIComponent(projectName)}/scenes/${encodeURIComponent(currentSceneId)}/history/${encodeURIComponent(history_id)}/image`;
}


// ---------- показ сцены ----------

export async function showSceneGeneration(projectName, sceneId, dependencies) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-scene-gen').classList.add('active');

  currentSceneId = sceneId;
  deps = dependencies;

  const scene = deps.getScene(sceneId);
  if (!scene) {
    $('genSceneTitle').textContent = 'Сцена не найдена';
    return;
  }

  if (promptSaveTimer) {
    clearTimeout(promptSaveTimer);
    promptSaveTimer = null;
  }

  $('genSceneTitle').textContent = scene.title || 'Сцена';
  $('genScenePrompt').value = scene.prompt || '';
  $('genSceneSeed').value = '';
  $('genSceneApplied').innerHTML = '';
  $('genSceneStatus').textContent = '';

  // Описание сцены
  const descBar = $('genSceneDescriptionBar');
  const descText = $('genSceneDescription');
  if (scene.description && scene.description.trim()) {
    descText.textContent = scene.description;
    descBar.classList.remove('hidden');
  } else {
    descBar.classList.add('hidden');
  }

  // Большая картинка активного варианта
  activeHistoryId = scene.last_image?.history_id || null;
  renderBigPreview();

  // Статус задачи
  updateSceneStatus(sceneId);

  // Панель настроек
  await openPanelForScene(sceneId);

  // Загружаем историю
  await loadAndRenderHistory();

  $('genScenePrompt').focus();
}


export function closeSceneGeneration() {
  for (const unsub of unsubscribers) {
    try { unsub(); } catch {}
  }
  unsubscribers = [];
}


// ---------- большая картинка ----------

function renderBigPreview() {
  const preview = $('genScenePreview');
  if (activeHistoryId) {
    preview.innerHTML = `<img src="${historyImageUrl(activeHistoryId)}" alt="result">`;
  } else {
    preview.innerHTML = 'здесь появится картинка';
  }
}


// ---------- история ----------

async function loadAndRenderHistory() {
  try {
    const items = await fetch(
      `/api/projects/${encodeURIComponent(deps.getProjectName())}/scenes/${encodeURIComponent(currentSceneId)}/history`
    ).then(r => r.json());
    historyCache = items;
    renderHistoryStrip();
  } catch (e) {
    console.warn('[scene] не удалось загрузить историю:', e);
  }
}


function renderHistoryStrip() {
  const container = $('sceneHistory');

  if (!historyCache.length) {
    container.innerHTML = '<div class="scene-history-empty">нет сгенерированных вариантов</div>';
    return;
  }

  // Свежие слева
  const items = historyCache.slice();

  container.innerHTML = '';
  for (const entry of items) {
    const el = document.createElement('div');
    el.className = 'scene-history-item';
    if (entry.task_id === activeHistoryId) el.classList.add('active');
    if (entry.status === 'error') el.classList.add('status-error');
    if (entry.status === 'cancelled') el.classList.add('status-cancelled');

    const hasImage = entry.image && entry.image.filename;
    let inner = '';
    if (hasImage) {
      const url = historyImageUrl(entry.task_id);
      inner = `<img src="${url}" alt="">`;
    } else {
      inner = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#555;font-size:10px;">${entry.status}</div>`;
    }

    el.innerHTML = `
      ${inner}
      <button class="history-item-delete" title="Удалить">✕</button>
    `;

    // Клик — сделать активным
    el.addEventListener('click', async (ev) => {
      if (ev.target.classList.contains('history-item-delete')) return;
      await selectHistoryEntry(entry.task_id);
    });

    // Клик на delete
    el.querySelector('.history-item-delete').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await deleteHistoryEntry(entry.task_id);
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


async function selectHistoryEntry(history_id) {
  if (history_id === activeHistoryId) return;
  try {
    await fetch(
      `/api/projects/${encodeURIComponent(deps.getProjectName())}/scenes/${encodeURIComponent(currentSceneId)}/history/${encodeURIComponent(history_id)}/select`,
      { method: 'POST' }
    ).then(r => r.json());

    // Seed — восстанавливаем из записи в кеше
    const entry = historyCache.find(e => e.task_id === history_id);
    if (entry && entry.seed != null) {
      $('genSceneSeed').value = entry.seed;
    }

    // Перезагружаем проект — local_values и prompt уже обновлены на бэке
    await reloadCurrentScene();
  } catch (e) {
    console.warn('[scene] не удалось выбрать вариант:', e);
  }
}


async function deleteHistoryEntry(history_id) {
  if (!confirm('Удалить этот вариант?')) return;
  try {
    await fetch(
      `/api/projects/${encodeURIComponent(deps.getProjectName())}/scenes/${encodeURIComponent(currentSceneId)}/history/${encodeURIComponent(history_id)}`,
      { method: 'DELETE' }
    );
    // Перезагружаем историю и сцену
    await loadAndRenderHistory();
    await reloadCurrentScene();
  } catch (e) {
    console.warn('[scene] не удалось удалить вариант:', e);
  }
}


/**
 * Перечитать сцену из проекта на бэке (её last_image, prompt, local_values
 * могли поменяться после select/delete).
 */
async function reloadCurrentScene() {
  try {
    const project = await api.projects.get(deps.getProjectName());
    // Находим сцену в свежем проекте
    const scenes = project.scenes || [];
    const fresh = scenes.find(s => s.id === currentSceneId);
    if (!fresh) return;

    // Обновляем граф
    if (deps.updateScene) {
      await deps.updateScene(currentSceneId, {
        prompt: fresh.prompt || '',
        local_values: fresh.local_values || {},
        last_image: fresh.last_image || null,
      });
    }

    // Обновляем UI
    $('genScenePrompt').value = fresh.prompt || '';
    activeHistoryId = fresh.last_image?.history_id || null;

    // Панель настроек — перезагружаем значения
    await openPanelForScene(currentSceneId);

    renderBigPreview();
    renderHistoryStrip();
  } catch (e) {
    console.warn('[scene] не удалось перезагрузить сцену:', e);
  }
}


// ---------- промпт: debounce ----------

function schedulePromptSave() {
  if (promptSaveTimer) clearTimeout(promptSaveTimer);
  promptSaveTimer = setTimeout(async () => {
    if (!currentSceneId || !deps) return;
    try {
      await deps.save(currentSceneId, { prompt: $('genScenePrompt').value });
    } catch (e) {
      console.warn('[scene] не удалось сохранить промпт:', e);
    }
  }, 800);
}

function flushPromptSave() {
  if (promptSaveTimer) {
    clearTimeout(promptSaveTimer);
    promptSaveTimer = null;
  }
  if (!currentSceneId || !deps) return Promise.resolve();
  return deps.save(currentSceneId, { prompt: $('genScenePrompt').value });
}


// ---------- статус задачи ----------

function updateSceneStatus(sceneId) {
  const statusEl = $('genSceneStatus');
  const task = generation.getForScene(sceneId);

  if (!task) {
    statusEl.textContent = '';
    statusEl.style.color = '#888';
    return;
  }

  if (task.status === 'queued') {
    statusEl.textContent = 'в очереди';
    statusEl.style.color = '#888';
  } else if (task.status === 'running') {
    statusEl.textContent = `выполняется · ${task.progress || 0}%`;
    statusEl.style.color = '#4a8aca';
  } else if (task.status === 'done') {
    statusEl.textContent = 'готово';
    statusEl.style.color = '#5a5';
  } else if (task.status === 'error') {
    statusEl.textContent = 'ошибка: ' + (task.error || 'unknown');
    statusEl.style.color = '#c66';
  } else if (task.status === 'cancelled') {
    statusEl.textContent = 'отменено';
    statusEl.style.color = '#888';
  }
}


// ---------- генерация ----------

function pickSeed() {
  const field = $('genSceneSeed');
  const v = field ? field.value.trim() : '';
  if (!v) return Math.floor(Math.random() * 2147483647);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : Math.floor(Math.random() * 2147483647);
}


async function generate() {
  if (!currentSceneId || !deps) return;

  await flushPromptSave();

  const seed = pickSeed();

  try {
    await generation.submit({
      projectName: deps.getProjectName(),
      sceneId: currentSceneId,
      seed,
    });
  } catch (e) {
    $('genSceneStatus').textContent = 'Ошибка: ' + e.message;
    $('genSceneStatus').style.color = '#c66';
    return;
  }

  $('genSceneStatus').textContent = 'отправка в очередь...';
  $('genSceneStatus').style.color = '#888';

  updateSceneStatus(currentSceneId);
}


// ---------- события задачи ----------

function onTaskEvent(task) {
  if (!task || task.sceneId !== currentSceneId) return;
  updateSceneStatus(currentSceneId);

  if (task.status === 'done' && task.image && task.image.history_id) {
    activeHistoryId = task.image.history_id;
    deps.save(currentSceneId, {
      last_image: {
        history_id: task.image.history_id,
        width: task.image.width || task.values?.width || 1152,
        height: task.image.height || task.values?.height || 896,
      },
    });
    renderBigPreview();
    loadAndRenderHistory();
  }
}


// ---------- модалка полного размера ----------

function openImageViewer(url) {
  $('imageViewerImg').src = url;
  $('imageViewerModal').classList.add('open');
}

function closeImageViewer() {
  $('imageViewerModal').classList.remove('open');
  $('imageViewerImg').src = '';
}


// ---------- инициализация ----------

export function initSceneGenerationView(navigateBack) {
  const btnBack = $('btnGenBackToGraph');
  if (btnBack) {
    btnBack.addEventListener('click', async () => {
      if (deps && currentSceneId) {
        try { await flushPromptSave(); } catch (e) {}
      }
      closeSceneGeneration();
      closePanel();
      navigateBack();
    });
  }

  const btnRand = $('btnGenSceneRandomSeed');
  if (btnRand) {
    btnRand.addEventListener('click', () => {
      $('genSceneSeed').value = Math.floor(Math.random() * 2147483647);
    });
  }

  const btnGen = $('btnGenSceneGenerate');
  if (btnGen) {
    btnGen.addEventListener('click', generate);
  }

  // Промпт — автосохранение
  const promptField = $('genScenePrompt');
  if (promptField) {
    promptField.addEventListener('input', schedulePromptSave);
  }

  // Клик по большой картинке — модалка
  const bigPreview = $('genScenePreview');
  if (bigPreview) {
    bigPreview.addEventListener('click', () => {
      if (activeHistoryId) {
        openImageViewer(historyImageUrl(activeHistoryId));
      }
    });
  }

  // Закрытие модалки
  $('btnImageViewerClose').addEventListener('click', closeImageViewer);
  $('imageViewerModal').addEventListener('click', (e) => {
    if (e.target.id === 'imageViewerModal') closeImageViewer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('imageViewerModal').classList.contains('open')) {
      closeImageViewer();
    }
  });

  // Подписки на события generation
  unsubscribers.push(generation.on('task-updated', onTaskEvent));
  unsubscribers.push(generation.on('task-started', onTaskEvent));
  unsubscribers.push(generation.on('task-finished', onTaskEvent));

  // Обновления сцены из панели
  window.addEventListener('scene-updated', (e) => {
    if (e.detail?.sceneId !== currentSceneId) return;
    const scene = deps?.getScene(currentSceneId);
    if (!scene) return;
    $('genSceneTitle').textContent = scene.title || 'Сцена';

    const descBar = $('genSceneDescriptionBar');
    const descText = $('genSceneDescription');
    if (scene.description && scene.description.trim()) {
      descText.textContent = scene.description;
      descBar.classList.remove('hidden');
    } else {
      descBar.classList.add('hidden');
    }
  });
}
