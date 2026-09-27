import { api } from '../core/api.js';
import { $ } from '../infra/dom.js';
import {
  validateProjectName,
  checkProjectNameAvailable,
} from '../core/validate.js';
import { openPresetsManager } from '../components/presets_manager.js';
import { SceneGraph } from '../graph.js';
import { navigate } from '../core/router.js';
import { generation } from '../core/generation.js';

let currentProject = null;
let graph = null;
let saveTimer = null;

// ============================================================
// Показ проекта (граф)
// ============================================================

export async function showProject(encodedName) {
  const name = decodeURIComponent(encodedName);

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-project').classList.add('active');

  const titleEl = $('projectTitle');
  titleEl.textContent = '...';

  try {
    currentProject = await api.projects.get(name);
    titleEl.textContent = currentProject.name;
  } catch (e) {
    titleEl.textContent = 'Ошибка загрузки';
    console.error('[project]', e);
    return;
  }

  if (!graph) {
    const canvas = $('graphCanvas');
    graph = new SceneGraph(canvas, {
      onOpenScene: openSceneEditor,
      onChange: scheduleSave,
      onCreateScene: (scene) => openSceneEditor(scene.id),
      projectName: currentProject.name,
    });
  }

  graph.setData(currentProject.scenes || [], currentProject.edges || []);
  graph.projectName = currentProject.name;
  graph.centerView();
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 500);
}

async function doSave() {
  if (!currentProject || !graph) return;
  const data = graph.getData();
  try {
    await api.projects.update(currentProject.name, {
      scenes: data.scenes,
      edges: data.edges,
    });
    currentProject.scenes = data.scenes;
    currentProject.edges = data.edges;
  } catch (e) {
    console.error('[project] не удалось сохранить граф:', e);
  }
}

// ============================================================
// Открытие сцены
// ============================================================

function openSceneEditor(sceneId) {
  const scene = graph.getScene(sceneId);
  if (!scene) return;
  navigate(`/project/${encodeURIComponent(currentProject.name)}/scene/${sceneId}`);
}

// ============================================================
// Инициализация
// ============================================================

export function initProjectView() {
  $('btnBackToProjects').addEventListener('click', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      doSave();
    }
    window.location.hash = '/';
  });

  $('btnProjectSettings').addEventListener('click', openProjectSettings);
  $('btnAddScene').addEventListener('click', () => {
    const center = {
      x: -graph.panX / graph.scale + graph.cssWidth / 2 / graph.scale,
      y: -graph.panY / graph.scale + graph.cssHeight / 2 / graph.scale,
    };
    const scene = graph.addScene(center.x, center.y);
    openSceneEditor(scene.id);
  });

  // Настройки проекта
  $('btnCancelProjectSettings').addEventListener('click', () => {
    $('projectSettingsModal').classList.remove('open');
  });
  $('btnCancelProjectSettings2').addEventListener('click', () => {
    $('projectSettingsModal').classList.remove('open');
  });
  $('btnSaveProjectSettings').addEventListener('click', saveProjectSettings);
  $('btnDeleteProjectFromSettings').addEventListener('click', deleteProjectFromSettings);
  $('btnOpenPresetsManager').addEventListener('click', async () => {
    await openPresetsManager(async () => {
      await reloadProjectPresetSelect();
    });
  });

  // Подписка на обновления сцен из очереди
  generation.on('scene-changed', (e) => {
    if (!graph) return;
    const { projectName, sceneId, last_image } = e;
    if (currentProject && projectName !== currentProject.name) return;
    const scene = graph.getScene(sceneId);
    if (!scene) return;
    graph.updateScene(sceneId, { last_image });
  });
}

// ============================================================
// Настройки проекта
// ============================================================

async function reloadProjectPresetSelect() {
  const sel = $('projectSettingsPreset');
  if (!sel) return;

  sel.innerHTML = '<option value="">(не выбран)</option>';

  try {
    const list = await api.presets.list();
    for (const name of list) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }

    const projectPreset = (currentProject && currentProject.default_preset) || '';
    if (projectPreset && list.includes(projectPreset)) {
      sel.value = projectPreset;
    } else if (projectPreset) {
      const opt = document.createElement('option');
      opt.value = projectPreset;
      opt.textContent = `⚠ ${projectPreset} (не найден)`;
      sel.appendChild(opt);
      sel.value = projectPreset;
    } else {
      sel.value = '';
    }
  } catch (e) {
    console.warn('[project] не удалось обновить список пресетов:', e);
  }
}

async function openProjectSettings() {
  if (!currentProject) return;

  $('projectSettingsName').value = currentProject.name;
  $('projectSettingsDescription').value = currentProject.description || '';
  $('projectSettingsError').textContent = '';

  await reloadProjectPresetSelect();

  $('projectSettingsModal').classList.add('open');
  $('projectSettingsName').focus();
}

async function saveProjectSettings() {
  if (!currentProject) return;

  const newName = $('projectSettingsName').value.trim();
  const newDescription = $('projectSettingsDescription').value;
  const newPreset = $('projectSettingsPreset').value || null;
  const errEl = $('projectSettingsError');
  errEl.textContent = '';

  const nameErr = validateProjectName(newName);
  if (nameErr) {
    errEl.textContent = nameErr;
    return;
  }

  if (newName.toLowerCase() !== currentProject.name.toLowerCase()) {
    try {
      const all = await api.projects.list();
      const dupErr = checkProjectNameAvailable(newName, all, currentProject.name);
      if (dupErr) {
        errEl.textContent = dupErr;
        return;
      }
    } catch (e) {
      errEl.textContent = 'Не удалось проверить дубли: ' + e.message;
      return;
    }
  }

  try {
    const updated = await api.projects.update(currentProject.name, {
      name: newName,
      description: newDescription,
      default_preset: newPreset,
    });
    currentProject = updated;
    $('projectTitle').textContent = updated.name;
    $('projectSettingsModal').classList.remove('open');

    if (window.location.hash !== `#/project/${encodeURIComponent(updated.name)}`) {
      window.location.hash = `/project/${encodeURIComponent(updated.name)}`;
    }
  } catch (e) {
    errEl.textContent = e.message;
  }
}

async function deleteProjectFromSettings() {
  if (!currentProject) return;
  if (!confirm(`Удалить проект «${currentProject.name}»?\nВсе сцены и изображения будут удалены безвозвратно.`)) return;

  try {
    await api.projects.delete(currentProject.name);
    $('projectSettingsModal').classList.remove('open');
    window.location.hash = '/';
  } catch (e) {
    $('projectSettingsError').textContent = e.message;
  }
}

// ============================================================
// Экспорт для views/scene.js
// ============================================================

export function getSceneFromGraph(sceneId) {
  return graph ? graph.getScene(sceneId) : null;
}

export async function updateSceneInGraph(sceneId, patch) {
  if (!graph) return;
  graph.updateScene(sceneId, patch);
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  await doSave();
}

export function getProjectName() {
  return currentProject ? currentProject.name : null;
}

export function getProjectDefaultPreset() {
  return currentProject ? currentProject.default_preset : null;
}

export async function deleteSceneFromGraph(sceneId) {
  if (!graph) return;
  graph.removeScene(sceneId);
  await doSave();
}
