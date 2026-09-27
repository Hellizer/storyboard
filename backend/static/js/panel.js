/**
 * Панель настроек сцены.
 * Локальные значения хранятся в scene.local_values.
 * Кнопка «Обновить пресет» переносит их в выбранный пресет.
 */
import { api } from './api.js';
import { $ } from './ui.js';

let currentSceneId = null;
let deps = null;
let comfyCache = { models: [], loras: [], samplers: [], schedulers: [] };
let presetNamesCache = [];
let isDirty = false;
let saveTimer = null;


export function initScenePanel(dependencies) {
  deps = dependencies;

  $('btnTogglePanel').addEventListener('click', togglePanel);
  $('btnPanelClose').addEventListener('click', closePanel);

  $('panelPresetSelect').addEventListener('change', onPresetChange);
  $('btnPanelSaveAsPreset').addEventListener('click', saveAsNewPreset);
  $('btnPanelUpdatePreset').addEventListener('click', updateCurrentPreset);
  $('btnPanelDeleteScene').addEventListener('click', deleteScene);

  // Все поля — автосохранение
  const fieldIds = [
    'panelModel', 'panelLora', 'panelLoraStrength',
    'panelWidth', 'panelHeight', 'panelSteps', 'panelCfg',
    'panelShift', 'panelSampler', 'panelScheduler',
    'panelSceneTitle', 'panelSceneDescription',
    'panelNegative',
  ];
  for (const id of fieldIds) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('input', onFieldChange);
    el.addEventListener('change', onFieldChange);
  }

  const swapBtn = $('btnSwapWH');
  if (swapBtn) {
    swapBtn.addEventListener('click', async () => {
      const w = $('panelWidth');
      const h = $('panelHeight');
      const tmp = w.value;
      w.value = h.value;
      h.value = tmp;
      // автосохранение
      const values = readValuesFromFields();
      await deps.updateScene(currentSceneId, { local_values: values });
      isDirty = true;
      updateDirtyHint();
    });
  }

  // Ctrl+P — toggle, Escape — закрыть
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      if (!$('view-scene-gen').classList.contains('active')) return;
      e.preventDefault();
      togglePanel();
    }
    if (e.key === 'Escape') {
      const p = $('scenePanel');
      if (p && !p.classList.contains('hidden')) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          closePanel();
        }
      }
    }
  });
}


export function isPanelOpen() {
  const p = $('scenePanel');
  return p && !p.classList.contains('hidden');
}

export function togglePanel() {
  const p = $('scenePanel');
  if (p.classList.contains('hidden')) {
    p.classList.remove('hidden');
    localStorage.setItem('panel_open', '1');
  } else {
    closePanel();
  }
}

export function closePanel() {
  const p = $('scenePanel');
  p.classList.add('hidden');
  localStorage.setItem('panel_open', '0');
}


async function loadComfyLists() {
  try { comfyCache.models = (await api.comfy.models()).models || []; } catch {}
  try { comfyCache.loras = (await api.comfy.loras()).loras || []; } catch {}
  try { comfyCache.samplers = (await api.comfy.samplers()).samplers || []; } catch {}
  try { comfyCache.schedulers = (await api.comfy.schedulers()).schedulers || []; } catch {}
}


function fillSelect(el, items, current, emptyLabel = '(не выбрано)') {
  el.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = emptyLabel;
  el.appendChild(empty);

  let found = false;
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    el.appendChild(opt);
    if (item === current) found = true;
  }
  if (current && !found) {
    const opt = document.createElement('option');
    opt.value = current;
    opt.textContent = `⚠ ${current} (нет в ComfyUI)`;
    el.appendChild(opt);
    el.value = current;
  } else {
    el.value = current || '';
  }
}


export async function openPanelForScene(sceneId) {
  currentSceneId = sceneId;
  const scene = deps.getScene(sceneId);
  if (!scene) return;

  await loadComfyLists();
  presetNamesCache = await api.presets.list();

  // Селект пресетов
  const sel = $('panelPresetSelect');
  sel.innerHTML = '';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(наследовать от проекта)';
  sel.appendChild(noneOpt);
  for (const name of presetNamesCache) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.value = scene.preset || '';

  // Инициализация local_values из пресета (если ещё нет)
  if (!scene.local_values) {
    const pName = scene.preset || deps.getProjectDefaultPreset();
    let values = {};
    if (pName) {
      try {
        const preset = await api.presets.get(pName);
        values = preset.values || {};
      } catch {}
    }
    await deps.updateScene(sceneId, { local_values: values });
    scene.local_values = values;
  }

  // Поля сцены
  $('panelSceneTitle').value = scene.title || '';
  $('panelSceneDescription').value = scene.description || '';

  // Поля настроек
  writeValuesToFields(scene.local_values);

  isDirty = false;
  updateDirtyHint();

  // Восстанавливаем состояние панели из localStorage
  if (localStorage.getItem('panel_open') === '1') {
    $('scenePanel').classList.remove('hidden');
  }
}


function writeValuesToFields(v) {
  fillSelect($('panelModel'), comfyCache.models, v.unet_name || '', '(по умолчанию)');
  fillSelect($('panelLora'), comfyCache.loras, v.lora_name || '', '(без LoRA)');
  $('panelLoraStrength').value = v.lora_strength ?? 0.8;
  $('panelWidth').value = v.width ?? 1152;
  $('panelHeight').value = v.height ?? 896;
  $('panelSteps').value = v.steps ?? 20;
  $('panelCfg').value = v.cfg ?? 8;
  $('panelShift').value = v.shift ?? 2.5;
  fillSelect($('panelSampler'), comfyCache.samplers, v.sampler_name || 'euler', '(по умолчанию)');
  fillSelect($('panelScheduler'), comfyCache.schedulers, v.scheduler || 'normal', '(по умолчанию)');
  $('panelNegative').value = v.negative || '';
}


function readValuesFromFields() {
  return {
    unet_name: $('panelModel').value || '',
    lora_name: $('panelLora').value || '',
    lora_strength: parseFloat($('panelLoraStrength').value) || 0.8,
    width: parseInt($('panelWidth').value, 10) || 1152,
    height: parseInt($('panelHeight').value, 10) || 896,
    steps: parseInt($('panelSteps').value, 10) || 20,
    cfg: parseFloat($('panelCfg').value) || 8,
    shift: parseFloat($('panelShift').value) || 2.5,
    sampler_name: $('panelSampler').value || 'euler',
    scheduler: $('panelScheduler').value || 'normal',
    negative: $('panelNegative').value,
  };
}


function onFieldChange(e) {
  if (!currentSceneId) return;
  isDirty = true;
  updateDirtyHint();

  const sceneFields = ['panelSceneTitle', 'panelSceneDescription'];
  const isSceneField = sceneFields.includes(e.target.id);

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (isSceneField) {
      const title = $('panelSceneTitle').value.trim() || 'Сцена';
      const description = $('panelSceneDescription').value;
      await deps.updateScene(currentSceneId, { title, description });
      const scene = deps.getScene(currentSceneId);
      if (scene) $('genSceneTitle').textContent = scene.title || 'Сцена';
    } else {
      const values = readValuesFromFields();
      await deps.updateScene(currentSceneId, { local_values: values });
    }
  }, 800);
}


function updateDirtyHint() {
  const hint = $('panelPresetHint');
  if (isDirty) {
    hint.textContent = 'есть несохранённые изменения в пресет';
    hint.classList.add('dirty');
  } else {
    hint.textContent = '';
    hint.classList.remove('dirty');
  }
}


async function onPresetChange(e) {
  const newPreset = e.target.value;
  const scene = deps.getScene(currentSceneId);
  if (!scene) return;

  if (isDirty) {
    if (!confirm('Несохранённые изменения будут потеряны. Продолжить?')) {
      e.target.value = scene.preset || '';
      return;
    }
  }

  await deps.updateScene(currentSceneId, { preset: newPreset || null });

  // Подгружаем values из нового пресета (или из пресета проекта)
  const pName = newPreset || deps.getProjectDefaultPreset();
  let values = {};
  if (pName) {
    try {
      const preset = await api.presets.get(pName);
      values = preset.values || {};
    } catch {}
  }
  await deps.updateScene(currentSceneId, { local_values: values });
  scene.local_values = values;

  writeValuesToFields(values);
  isDirty = false;
  updateDirtyHint();
}


async function updateCurrentPreset() {
  const presetName = $('panelPresetSelect').value;
  if (!presetName) {
    alert('Сначала выберите пресет в списке (наследование от проекта не перезаписывается)');
    return;
  }
  if (!confirm(`Сохранить текущие значения в пресет «${presetName}»?`)) return;

  const values = readValuesFromFields();
  try {
    const preset = await api.presets.get(presetName);
    preset.values = values;
    await api.presets.save(presetName, preset);
    isDirty = false;
    updateDirtyHint();
    alert(`Пресет «${presetName}» обновлён`);
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}


async function saveAsNewPreset() {
  const current = $('panelPresetSelect').value;
  const name = prompt('Имя нового пресета:', (current || 'preset') + ' copy');
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  const existing = await api.presets.list();
  if (existing.includes(trimmed)) {
    alert('Пресет с таким именем уже существует');
    return;
  }

  // Берём template/adapter из текущего пресета (или дефолт)
  let template = 'simple_anima';
  let adapter = 'simple_anima';
  if (current) {
    try {
      const p = await api.presets.get(current);
      template = p.template || template;
      adapter = p.adapter || adapter;
    } catch {}
  }

  const values = readValuesFromFields();
  const payload = { template, adapter, values };

  try {
    await api.presets.save(trimmed, payload);
    await deps.updateScene(currentSceneId, { preset: trimmed });
    presetNamesCache = await api.presets.list();
    refreshPresetSelect(trimmed);
    isDirty = false;
    updateDirtyHint();
    alert(`Создан пресет «${trimmed}»`);
  } catch (e) {
    alert('Ошибка: ' + e.message);
  }
}


function refreshPresetSelect(current) {
  const sel = $('panelPresetSelect');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(наследовать от проекта)';
  sel.appendChild(none);
  for (const name of presetNamesCache) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.value = current || '';
}


async function deleteScene() {
  if (!currentSceneId) return;
  if (!confirm('Удалить эту сцену?')) return;
  await deps.deleteScene(currentSceneId);
  closePanel();
}
