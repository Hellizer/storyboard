/**
 * Точка входа. Роутинг и инициализация модулей.
 *
 * Активные модули:
 *   router.js             — хэш-роутер
 *   views/projects.js     — экран списка проектов
 *   views/project.js      — экран проекта (граф сцен)
 *   views/scene.js        — экран генерации сцены
 *   panel.js              — боковая панель настроек сцены
 *   presets_manager.js    — модалка управления пресетами
 *   generation.js         — клиент глобальной очереди (WS /ws/app)
 *   queue_ui.js           — UI хедера и панели очереди
 *   ui.js                 — общие утилиты UI
 *
 * Удалены (не используются):
 *   comfy.js, state.js, presets.js, settings.js
 */
import { addRoute, setNotFound, initRouter, navigate } from './core/router.js';
import { showProjectsList, initProjectsView } from './views/projects.js';
import {
  showProject, initProjectView,
  getSceneFromGraph, updateSceneInGraph,
  getProjectName, getProjectDefaultPreset,
  deleteSceneFromGraph,
} from './views/project.js';
import {
  showSceneGeneration, closeSceneGeneration, initSceneGenerationView,
} from './views/scene/index.js';
import { initPresetsManager } from './components/presets_manager.js';
import { initScenePanel } from './components/panel.js';
import { generation } from './core/generation.js';
import { initQueueUI } from './core/queue_ui.js';


function init() {
  // Отключаем автокомплит на всех полях ввода
  document.querySelectorAll('input, textarea').forEach(el => {
    el.setAttribute('autocomplete', 'off');
  });

  // 1. Инициализация экранов и обработчиков
  initProjectsView();
  initProjectView();
  initPresetsManager();
  initQueueUI();

  // 2. Глобальная очередь — подключение к /ws/app и загрузка снапшота
  generation.init();

  // 3. Боковая панель настроек сцены
  initScenePanel({
    getScene: getSceneFromGraph,
    updateScene: updateSceneInGraph,
    getProjectDefaultPreset: getProjectDefaultPreset,
    deleteScene: async (sceneId) => {
      await deleteSceneFromGraph(sceneId);
      closeSceneGeneration();
      navigate(`/project/${encodeURIComponent(getProjectName())}`);
    },
  });

  // 4. Экран генерации сцены
  initSceneGenerationView(
    () => {
      closeSceneGeneration();
      navigate(`/project/${encodeURIComponent(getProjectName())}`);
    }
  );

  // 5. Маршруты
  addRoute(/^\/project\/([^\/]+)\/scene\/([^\/]+)$/, async (pName, sId) => {
    const projectName = decodeURIComponent(pName);

    // Сначала грузим проект и граф — без них сцены не существует
    try {
      await showProject(projectName);
    } catch (e) {
      console.error('[main] не удалось загрузить проект для сцены:', e);
      window.location.hash = '/';
      return;
    }

    // Теперь граф есть, можно показать сцену
    showSceneGeneration(projectName, sId, {
      getScene: getSceneFromGraph,
      updateScene: updateSceneInGraph,
      save: async (sceneId, patch) => {
        await updateSceneInGraph(sceneId, patch);
      },
      getProjectDefaultPreset: getProjectDefaultPreset,
      getProjectName: getProjectName,
    });
  });

  addRoute(/^\/project\/([^\/]+)$/, showProject);
  addRoute(/^\/?$/, showProjectsList);
  setNotFound(() => { window.location.hash = '/'; });

  initRouter();

  console.log('[main] инициализация завершена');
}


// Ловим необработанные promise rejection, чтобы не терять ошибки
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UNHANDLED PROMISE]', e.reason);
  if (e.reason && e.reason.stack) {
    console.error('[stack]', e.reason.stack);
  }
});


init();
