/**
 * Промпт сцены: textarea + автосохранение + seed + размер шрифта.
 */
import { $ } from '../../infra/dom.js';
import { debounce } from '../../infra/debounce.js';

const FONT_KEY = 'storyboard.promptFontSize';
const FONT_MIN = 10;
const FONT_MAX = 22;

let ctx = null;  // { sceneId, deps }
let saveDebounced = null;
let promptFontSize = null;  // текущий размер в px или null (CSS-дефолт)


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

  initPromptFontSize();
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


// ---------- размер шрифта промпта ----------

function readStoredFontSize() {
  try {
    const raw = localStorage.getItem(FONT_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX) return n;
  } catch {}
  return null;
}


function getCurrentFontSizePx() {
  const field = $('genScenePrompt');
  if (!field) return 13;
  const v = Math.round(parseFloat(getComputedStyle(field).fontSize));
  return Number.isFinite(v) && v > 0 ? v : 13;
}


function applyPromptFontSize(px) {
  const field = $('genScenePrompt');
  if (!field) return;

  if (px == null) {
    field.style.fontSize = '';
  } else {
    field.style.fontSize = px + 'px';
  }

  const current = px ?? getCurrentFontSizePx();
  const inc = $('btnPromptFontInc');
  const dec = $('btnPromptFontDec');
  if (inc) inc.disabled = current >= FONT_MAX;
  if (dec) dec.disabled = current <= FONT_MIN;
}


function setPromptFontSize(px) {
  const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, px));
  promptFontSize = clamped;
  applyPromptFontSize(clamped);
  try {
    localStorage.setItem(FONT_KEY, String(clamped));
  } catch {}
}


function initPromptFontSize() {
  const stored = readStoredFontSize();
  if (stored != null) {
    promptFontSize = stored;
    applyPromptFontSize(stored);
  } else {
    promptFontSize = null;
    applyPromptFontSize(null);
  }

  const inc = $('btnPromptFontInc');
  const dec = $('btnPromptFontDec');

  if (inc) {
    inc.addEventListener('click', () => {
      const base = promptFontSize ?? getCurrentFontSizePx();
      setPromptFontSize(base + 1);
    });
  }
  if (dec) {
    dec.addEventListener('click', () => {
      const base = promptFontSize ?? getCurrentFontSizePx();
      setPromptFontSize(base - 1);
    });
  }
}
