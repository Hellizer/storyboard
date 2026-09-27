/**
 * Модалка управления пресетами. Полный CRUD.
 * Используется из настроек проекта и (потом) из рабочего экрана.
 */
import { api } from '../core/api.js';
import { $ } from '../infra/dom.js';
import { confirmDialog, alertDialog, promptDialog } from '../infra/dialogs.js';
import { toast } from '../infra/toast.js';

let currentPresetName = null;  // какой пресет сейчас открыт в форме
let allPresets = [];
let currentOnClose = null;

const comfyCache = {
  loras: null,
  models: null,
  samplers: null,
  schedulers: null,
  lorasError: null,
  modelsError: null,
  samplersError: null,
  schedulersError: null,
};

let templatesCache = [];
let adaptersCache = [];

async function loadTemplatesAndAdapters() {
  try {
    const d = await api.workflow.templates();
    templatesCache = d.templates || [];
  } catch (e) {
    templatesCache = [];
  }
  try {
    const d = await api.workflow.adapters();
    adaptersCache = d.adapters || [];
  } catch (e) {
    adaptersCache = [];
  }
}

async function loadComfyLists(force = false) {
  if (force || comfyCache.loras === null) {
    try {
      const d = await api.comfy.loras();
      comfyCache.loras = d.loras || [];
      comfyCache.lorasError = null;
    } catch (e) {
      comfyCache.loras = [];
      comfyCache.lorasError = e.message;
    }
  }
  if (force || comfyCache.models === null) {
    try {
      const d = await api.comfy.models();
      comfyCache.models = d.models || [];
      comfyCache.modelsError = null;
    } catch (e) {
      comfyCache.models = [];
      comfyCache.modelsError = e.message;
    }
  }
  if (force || comfyCache.samplers === null) {
      try {
        const d = await api.comfy.samplers();
        comfyCache.samplers = d.samplers || [];
        comfyCache.samplersError = null;
      } catch (e) {
        comfyCache.samplers = [];
        comfyCache.samplersError = e.message;
      }
    }
  if (force || comfyCache.schedulers === null) {
      try {
        const d = await api.comfy.schedulers();
        comfyCache.schedulers = d.schedulers || [];
        comfyCache.schedulersError = null;
      } catch (e) {
        comfyCache.schedulers = [];
        comfyCache.schedulersError = e.message;
      }
    }
}

function fillSelect(sel, items, currentValue, emptyLabel = "(не выбрано)") {
  sel.innerHTML = '';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = emptyLabel;
  sel.appendChild(emptyOpt);

  let found = false;
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    sel.appendChild(opt);
    if (item === currentValue) found = true;
  }

  if (currentValue && !found) {
    const opt = document.createElement('option');
    opt.value = currentValue;
    opt.textContent = `⚠ ${currentValue} (нет в ComfyUI)`;
    sel.appendChild(opt);
    sel.value = currentValue;
  } else {
    sel.value = currentValue || '';
  }
}

/**
 * Открыть модалку управления пресетами.
 */
export async function openPresetsManager(onClose = null) {
  currentOnClose = onClose;

  await loadComfyLists();
  await loadTemplatesAndAdapters();
  await refreshList();

  if (allPresets.length > 0) {
    selectPreset(allPresets[0].name);
  } else {
    selectPreset(null);
  }

  $('presetsManagerModal').classList.add('open');
}

function closeManager() {
  $('presetsManagerModal').classList.remove('open');
  const cb = currentOnClose;
  currentOnClose = null;
  if (cb) cb();
}

async function refreshList() {
  try {
    const names = await api.presets.list();
    allPresets = [];
    for (const name of names) {
      try {
        const p = await api.presets.get(name);
        allPresets.push({ name, data: p });
      } catch (e) {
        console.warn(`[presets] не удалось прочитать ${name}:`, e);
      }
    }
  } catch (e) {
    console.error('[presets] не удалось получить список:', e);
    allPresets = [];
  }
  renderList();
}

function renderList() {
  const list = $('presetsList');
  list.innerHTML = '';

  if (allPresets.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'preset-list-empty';
    empty.textContent = 'нет пресетов';
    list.appendChild(empty);
    return;
  }

  for (const p of allPresets) {
    const item = document.createElement('div');
    item.className = 'preset-list-item';
    if (p.name === currentPresetName) item.classList.add('active');
    item.textContent = p.name;
    item.addEventListener('click', () => selectPreset(p.name));
    list.appendChild(item);
  }
}

function selectPreset(name) {
  currentPresetName = name;

  if (name === null) {
    $('presetForm').style.display = 'none';
    $('presetFormEmpty').style.display = 'block';
  } else {
    const preset = allPresets.find(p => p.name === name);
    if (!preset) return;

    $('presetForm').style.display = 'block';
    $('presetFormEmpty').style.display = 'none';

    const d = preset.data || {};
    const v = d.values || {};
    $('pmName').value = preset.name;
    $('pmTemplate').value = d.template || 'Scene';
    $('pmAdapter').value = d.adapter || 'anima_base';

    const modelSel = $('pmModel');
    fillSelect(modelSel, comfyCache.models || [], v.unet_name || '',
               '(модель по умолчанию)');
    if (comfyCache.modelsError) {
      modelSel.title = 'ComfyUI недоступен: ' + comfyCache.modelsError;
    }

    const loraSel = $('pmLoraName');
    fillSelect(loraSel, comfyCache.loras || [], v.lora_name || '',
               '(без LoRA)');
    if (comfyCache.lorasError) {
      loraSel.title = 'ComfyUI недоступен: ' + comfyCache.lorasError;
    }

    const tplSel = $('pmTemplate');
    fillSelect(tplSel, templatesCache, d.template || 'default',
               '(выбери шаблон)');
    if (!templatesCache.length) {
      tplSel.title = 'Нет шаблонов в backend/templates/';
    }

    const adpSel = $('pmAdapter');
    fillSelect(adpSel, adaptersCache, d.adapter || 'default',
               '(выбери адаптер)');
    if (!adaptersCache.length) {
      adpSel.title = 'Нет адаптеров в backend/adapters/';
    }

    const samplerSel = $('pmSamplerName');
    fillSelect(samplerSel, comfyCache.samplers || [],
               v.sampler_name || 'euler', '(по умолчанию)');

    const schedulerSel = $('pmScheduler');
    fillSelect(schedulerSel, comfyCache.schedulers || [],
               v.scheduler || 'normal', '(по умолчанию)');

    $('pmSteps').value = v.steps ?? 14;
    $('pmCfg').value = v.cfg ?? 1.5;
    $('pmShift').value = v.shift ?? 2.49;
    $('pmLoraStrength').value = v.lora_strength ?? 0.8;
    $('pmWidth').value = v.width ?? 1152;
    $('pmHeight').value = v.height ?? 896;
    $('pmNegative').value = v.negative || '';
    $('pmError').textContent = '';
  }

  renderList();
}

async function importWorkflow() {
  const templateName = $('pmTemplate').value;
  if (!templateName) {
    await alertDialog({
      title: 'Импорт workflow',
      message: 'Сначала выбери шаблон.',
    });
    return;
  }

  const adapterExists = adaptersCache.includes(templateName);
  if (adapterExists) {
    const ok = await confirmDialog({
      title: 'Перезапись адаптера',
      message: `Адаптер для «${templateName}» уже существует. Перезаписать?`,
      confirmText: 'Перезаписать',
      danger: true,
    });
    if (!ok) return;
  }

  try {
    const result = await api.workflow.import(templateName, adapterExists);
    await alertDialog({
      title: 'Импорт завершён',
      message: `Найдено узлов: ${result.import_info.found.length}\n` +
               `Пропущено: ${result.import_info.missing.length}`,
    });
    await loadTemplatesAndAdapters();
    const adpSel = $('pmAdapter');
    fillSelect(adpSel, adaptersCache, templateName, '(выбери адаптер)');
  } catch (e) {
    await alertDialog({
      title: 'Ошибка импорта',
      message: e.message,
    });
  }
}

async function createNewPreset() {
  const name = await promptDialog({
    title: 'Новый пресет',
    message: 'Имя нового пресета:',
    defaultValue: 'My Preset 2',
    confirmText: 'Создать',
  });
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  if (allPresets.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
    await alertDialog({
      title: 'Пресет уже существует',
      message: `Пресет с именем «${trimmed}» уже есть.`,
    });
    return;
  }

  const empty = {
    template: 'Scene',
    adapter: 'anima_base',
    values: {
      steps: 14,
      cfg: 1.5,
      shift: 2.49,
      width: 1152,
      height: 896,
      lora_name: '',
      lora_strength: 0.8,
      negative: '',
    },
  };

  try {
    await api.presets.save(trimmed, empty);
    await refreshList();
    selectPreset(trimmed);
    toast.success(`Пресет «${trimmed}» создан`);
  } catch (e) {
    await alertDialog({
      title: 'Ошибка создания',
      message: e.message,
    });
  }
}

async function saveCurrentPreset() {
  if (currentPresetName === null) return;

  const newName = $('pmName').value.trim();
  if (!newName) {
    $('pmError').textContent = 'Имя не может быть пустым';
    $('pmError').style.color = '#ff8888';
    return;
  }

  if (newName.toLowerCase() !== currentPresetName.toLowerCase()) {
    const dup = allPresets.find(
      p => p.name.toLowerCase() === newName.toLowerCase() &&
           p.name !== currentPresetName
    );
    if (dup) {
      $('pmError').textContent = 'Пресет с таким именем уже существует';
      $('pmError').style.color = '#ff8888';
      return;
    }
  }

  const payload = {
    template: $('pmTemplate').value.trim() || 'Scene',
    adapter: $('pmAdapter').value.trim() || 'anima_base',
    values: {
      unet_name: $('pmModel').value || '',
      steps: parseInt($('pmSteps').value, 10) || 20,
      cfg: parseFloat($('pmCfg').value) || 8,
      sampler_name: $('pmSamplerName').value || 'euler',
      scheduler: $('pmScheduler').value || 'normal',
      shift: parseFloat($('pmShift').value) || 2.5,
      lora_name: $('pmLoraName').value || '',
      lora_strength: parseFloat($('pmLoraStrength').value) || 0.8,
      width: parseInt($('pmWidth').value, 10) || 1152,
      height: parseInt($('pmHeight').value, 10) || 896,
      negative: $('pmNegative').value,
    },
  };

  const oldName = currentPresetName;
  const renamed = newName !== oldName;

  try {
    if (renamed) {
      await api.presets.save(newName, payload);
      await api.presets.delete(oldName);
      currentPresetName = newName;
    } else {
      await api.presets.save(newName, payload);
    }

    await refreshList();
    selectPreset(currentPresetName);

    toast.success(
      renamed
        ? `Пресет «${oldName}» переименован в «${newName}»`
        : `Пресет «${newName}» сохранён`
    );
  } catch (e) {
    $('pmError').textContent = e.message;
    $('pmError').style.color = '#ff8888';
    toast.error('Не удалось сохранить пресет: ' + e.message);
  }
}

async function deleteCurrentPreset() {
  if (currentPresetName === null) return;
  const nameToDelete = currentPresetName;
  const ok = await confirmDialog({
    title: 'Удаление пресета',
    message: `Удалить пресет «${nameToDelete}»?`,
    confirmText: 'Удалить',
    danger: true,
  });
  if (!ok) return;

  try {
    await api.presets.delete(nameToDelete);
    currentPresetName = null;
    await refreshList();
    if (allPresets.length > 0) {
      selectPreset(allPresets[0].name);
    } else {
      selectPreset(null);
    }
    toast.success(`Пресет «${nameToDelete}» удалён`);
  } catch (e) {
    await alertDialog({
      title: 'Ошибка удаления',
      message: e.message,
    });
  }
}

export function initPresetsManager() {
  const modal = $('presetsManagerModal');
  if (!modal) return;

  $('btnPresetsClose').addEventListener('click', closeManager);
  $('btnPresetsCreate').addEventListener('click', createNewPreset);
  $('btnPresetsSave').addEventListener('click', saveCurrentPreset);
  $('btnPresetsDelete').addEventListener('click', deleteCurrentPreset);
  $('btnRefreshComfyLists').addEventListener('click', async () => {
      await loadComfyLists(true);
      const name = currentPresetName;
      if (name !== null) {
        selectPreset(name);
      }
    });
  $('btnPresetsImport').addEventListener('click', importWorkflow);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeManager();
    }
  });
}
