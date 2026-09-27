/**
 * Экран генерации сцены.
 * Не создаёт WebSocket сам — отправляет задачи в generation.js
 * и подписывается на события. Прогресс — в глобальном хедере.
 */
import { api } from '../api.js';
import { $ } from '../ui.js';
import { openPanelForScene, closePanel } from '../panel.js';
import { generation } from '../generation.js';

let currentSceneId = null;
let deps = null;
let unsubscribers = [];

let promptSaveTimer = null;

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


export async function showSceneGeneration(projectName, sceneId, dependencies) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-scene-gen').classList.add('active');

  currentSceneId = sceneId;
  deps = dependencies;

  // Сброс таймера промпта от прошлой сцены
    if (promptSaveTimer) {
      clearTimeout(promptSaveTimer);
      promptSaveTimer = null;
    }

  const scene = deps.getScene(sceneId);
  if (!scene) {
    $('genSceneTitle').textContent = 'Сцена не найдена';
    return;
  }

  $('genSceneTitle').textContent = scene.title || 'Сцена';
  $('genScenePrompt').value = scene.prompt || '';
  $('genSceneSeed').value = '';
  $('genSceneApplied').innerHTML = '';
  $('genSceneStatus').textContent = '';

  // Описание сцены (полоса сверху)
  const descBar = $('genSceneDescriptionBar');
  const descText = $('genSceneDescription');
  if (scene.description && scene.description.trim()) {
    descText.textContent = scene.description;
    descBar.classList.remove('hidden');
  } else {
    descBar.classList.add('hidden');
  }

  // Превью последней картинки
  renderScenePreview(scene);

  // Статус — если для сцены уже есть задача
  updateSceneStatus(sceneId);

  // Панель настроек
  await openPanelForScene(sceneId);

  $('genScenePrompt').focus();
}


export function closeSceneGeneration() {
  // Отписываемся от событий generation, чтобы не копились обработчики
  for (const unsub of unsubscribers) {
    try { unsub(); } catch {}
  }
  unsubscribers = [];
}


function buildComfyViewUrl(img) {
  const p = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || '',
    type_: img.type || 'output',
  });
  return `/api/comfy/view?${p}`;
}


function renderScenePreview(scene) {
  const preview = $('genScenePreview');
  if (scene.last_image && scene.last_image.filename) {
    preview.innerHTML = `<img src="${buildComfyViewUrl(scene.last_image)}" alt="result">`;
  } else {
    preview.innerHTML = 'здесь появится картинка';
  }
}

function pickSeed() {
  const field = $('genSceneSeed');
  const v = field ? field.value.trim() : '';
  if (!v) return Math.floor(Math.random() * 2147483647);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : Math.floor(Math.random() * 2147483647);
}

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

async function generate() {
  if (!currentSceneId || !deps) return;

  // Форсим сохранение промпта, если debounce ещё не сработал
  await flushPromptSave();

  // Seed: из поля или рандомный (генерируется на фронте)
  const seed = pickSeed();

  // Отправляем минимальный набор. Бэк сам соберёт остальное.
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

  $('genScenePreview').innerHTML = 'генерация...';
  $('genSceneStatus').textContent = 'отправка в очередь...';
  $('genSceneStatus').style.color = '#888';
  $('genSceneApplied').innerHTML = '';

  updateSceneStatus(currentSceneId);
}


function onTaskEvent(task) {
  if (!task || task.sceneId !== currentSceneId) return;
  updateSceneStatus(currentSceneId);

  // Если задача завершилась с картинкой — сохраняем в сцену и показываем превью
  if (task.status === 'done' && task.image && task.image.filename) {
    deps.save(currentSceneId, { last_image: task.image });
    const preview = $('genScenePreview');
    preview.innerHTML = `<img src="${buildComfyViewUrl(task.image)}" alt="result">`;
  }
}


export function initSceneGenerationView(navigateBack) {
  const btnBack = $('btnGenBackToGraph');
  if (btnBack) {
    btnBack.addEventListener('click', async () => {
         if (deps && currentSceneId) {
           try {
             await flushPromptSave();
           } catch (e) {
             console.warn('[scene] не удалось сохранить промпт:', e);
           }
         }
         closeSceneGeneration();
         closePanel();
         navigateBack();
       });
  }

  const promptField = $('genScenePrompt');
    if (promptField) {
      promptField.addEventListener('input', schedulePromptSave);
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

  // Подписки на события generation
  unsubscribers.push(generation.on('task-updated', onTaskEvent));
  unsubscribers.push(generation.on('task-started', onTaskEvent));
  unsubscribers.push(generation.on('task-finished', onTaskEvent));

  // Обновления сцены (из панели настроек)
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
