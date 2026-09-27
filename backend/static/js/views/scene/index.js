/**
 * Экран генерации сцены.
 * Координирует prompt, preview, history, tabs, cubes.
 */
import { api } from '../../core/api.js';
import { $ } from '../../infra/dom.js';
import { openPanelForScene, closePanel } from '../../components/panel.js';
import { generation } from '../../core/generation.js';
import { initCubeEditor } from '../../components/cube_editor.js';
import { confirmDialog } from '../../infra/dialogs.js';

import { initTabs, setActiveTab } from './tabs.js';
import {
  initPrompt, showPrompt, flushPromptSave, setPromptText, setSeedValue,
} from './prompt.js';
import {
  initPreview, setPreviewContext, renderBigPreview,
} from './preview.js';
import {
  setHistoryContext, setHistoryCallbacks, setActiveHistoryId,
  loadAndRenderHistory, renderHistoryStrip, getHistoryEntry,
} from './history.js';
import { initCubes, showCubes } from './cubes.js';
import { initChatPanel, showChat } from '../../components/chat_panel.js';
import { pickSeed } from './utils.js';

let currentSceneId = null;
let deps = null;
let unsubscribers = [];


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

  $('genSceneTitle').textContent = scene.title || 'Сцена';
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

  // Промпт
  showPrompt(scene, sceneId, deps);

  // Превью
  setPreviewContext(deps.getProjectName(), sceneId);
  const activeHistoryId = scene.last_image?.history_id || null;
  renderBigPreview(activeHistoryId);

  // История
  setHistoryContext(deps.getProjectName(), sceneId, deps);
  setActiveHistoryId(activeHistoryId);
  await loadAndRenderHistory();

  // Кубики (ленивая загрузка при первом заходе)
  showCubes();

  // Чат (контекст текущей сцены)
  showChat({
    scope: 'scene',
    project: deps.getProjectName(),
    scene: sceneId,
  });

  // Статус задачи
  updateSceneStatus(sceneId);

  // Панель настроек
  await openPanelForScene(sceneId);

  // Табы
  setActiveTab('preview');

  $('genScenePrompt').focus();
}


export function closeSceneGeneration() {
  for (const unsub of unsubscribers) {
    try { unsub(); } catch {}
  }
  unsubscribers = [];
}


// ---------- статус задачи ----------

function updateSceneStatus(sceneId) {
  const statusEl = $('genSceneStatus');
  if (!statusEl) return;
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

async function generate() {
  if (!currentSceneId || !deps) return;

  await flushPromptSave();

  const seed = pickSeed($('genSceneSeed'));

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


// ---------- обработчики истории ----------

async function onHistorySelect(entry) {
  if (!entry || !currentSceneId) return;
  try {
    await fetch(
      `/api/projects/${encodeURIComponent(deps.getProjectName())}/scenes/${encodeURIComponent(currentSceneId)}/history/${encodeURIComponent(entry.task_id)}/select`,
      { method: 'POST' }
    ).then(r => r.json());

    // Seed подставляем из записи
    if (entry.seed != null) setSeedValue(entry.seed);

    await reloadCurrentScene();
  } catch (e) {
    console.warn('[scene] не удалось выбрать вариант:', e);
  }
}

async function onHistoryDelete(entry) {
  if (!entry || !currentSceneId) return;
  const ok = await confirmDialog({
    title: 'Удаление варианта',
    message: 'Удалить этот вариант?',
    confirmText: 'Удалить',
    danger: true,
  });
  if (!ok) return;
  try {
    await fetch(
      `/api/projects/${encodeURIComponent(deps.getProjectName())}/scenes/${encodeURIComponent(currentSceneId)}/history/${encodeURIComponent(entry.task_id)}`,
      { method: 'DELETE' }
    );
    await loadAndRenderHistory();
    await reloadCurrentScene();
  } catch (e) {
    console.warn('[scene] не удалось удалить вариант:', e);
  }
}


async function reloadCurrentScene() {
  try {
    const project = await api.projects.get(deps.getProjectName());
    const fresh = (project.scenes || []).find(s => s.id === currentSceneId);
    if (!fresh) return;

    if (deps.updateScene) {
      await deps.updateScene(currentSceneId, {
        prompt: fresh.prompt || '',
        local_values: fresh.local_values || {},
        last_image: fresh.last_image || null,
      });
    }

    setPromptText(fresh.prompt || '');
    const activeId = fresh.last_image?.history_id || null;
    renderBigPreview(activeId);
    setActiveHistoryId(activeId);
    renderHistoryStrip();

    await openPanelForScene(currentSceneId);
  } catch (e) {
    console.warn('[scene] не удалось перезагрузить сцену:', e);
  }
}


// ---------- события задачи ----------

function onTaskEvent(task) {
  if (!task || task.sceneId !== currentSceneId) return;
  updateSceneStatus(currentSceneId);

  if (task.status === 'done' && task.image && task.image.history_id) {
    const activeId = task.image.history_id;
    deps.save(currentSceneId, {
      last_image: {
        history_id: activeId,
        width: task.image.width || task.values?.width || 1152,
        height: task.image.height || task.values?.height || 896,
      },
    });
    renderBigPreview(activeId);
    setActiveHistoryId(activeId);
    loadAndRenderHistory();
  }
}


// ---------- инициализация ----------

export function initSceneGenerationView(navigateBack) {
  initTabs();
  initPrompt();
  initPreview();
  initCubes();
  initCubeEditor();
  initChatPanel();

  setHistoryCallbacks(onHistorySelect, onHistoryDelete);

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

  const btnGen = $('btnGenSceneGenerate');
  if (btnGen) {
    btnGen.addEventListener('click', generate);
  }

  unsubscribers.push(generation.on('task-updated', onTaskEvent));
  unsubscribers.push(generation.on('task-started', onTaskEvent));
  unsubscribers.push(generation.on('task-finished', onTaskEvent));

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
