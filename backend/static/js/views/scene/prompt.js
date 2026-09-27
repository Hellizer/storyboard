/**
 * Промпт сцены: textarea + автосохранение + seed.
 */
import { $ } from '../../infra/dom.js';
import { debounce } from '../../infra/debounce.js';

let ctx = null;  // { sceneId, deps }
let saveDebounced = null;

export function initPrompt() {
  saveDebounced = debounce(async () => {
    if (!ctx || !ctx.sceneId) return;
    try {
      await ctx.deps.save(ctx.sceneId, { prompt: $('genScenePrompt').value });
    } catch (e) {
      console.warn('[scene/prompt] не удалось сохранить промпт:', e);
    }
  }, 800);

  const promptField = $('genScenePrompt');
  if (promptField) {
    promptField.addEventListener('input', saveDebounced);
  }

  const btnRand = $('btnGenSceneRandomSeed');
  if (btnRand) {
    btnRand.addEventListener('click', () => {
      $('genSceneSeed').value = Math.floor(Math.random() * 2147483647);
    });
  }
}

/**
 * Показать сцену: заполнить textarea промптом из сцены, сбросить seed.
 */
export function showPrompt(scene, sceneId, deps) {
  ctx = { sceneId, deps };
  if (saveDebounced) saveDebounced.cancel();

  const promptField = $('genScenePrompt');
  if (promptField) promptField.value = scene.prompt || '';

  const seedField = $('genSceneSeed');
  if (seedField) seedField.value = '';
}

/**
 * Форсировать сохранение промпта, если debounce ещё не сработал.
 */
export function flushPromptSave() {
  if (saveDebounced) {
    return saveDebounced.flush();
  }
  return Promise.resolve();
}

/**
 * Установить поле промпта (для случаев восстановления из истории).
 */
export function setPromptText(text) {
  const promptField = $('genScenePrompt');
  if (promptField) promptField.value = text || '';
}

/**
 * Установить поле seed (для случаев восстановления из истории).
 */
export function setSeedValue(value) {
  const seedField = $('genSceneSeed');
  if (seedField) seedField.value = value != null ? value : '';
}

export function getPromptText() {
  return $('genScenePrompt')?.value || '';
}
