/**
 * Простые тосты вместо alert('Сохранено').
 *
 * Использование:
 *   import { toast } from '../infra/toast.js';
 *   toast.success('Сохранено');
 *   toast.error('Не удалось загрузить');
 *   toast.info('Скопировано в буфер');
 *   toast.warning('ComfyUI недоступен');
 *
 * Контейнер создаётся лениво, один на всё приложение.
 * По умолчанию 2500 мс, error/warning — 5000 мс.
 */

const DEFAULT_DURATION = 2500;
const LONG_DURATION = 5000;

let container = null;


function ensureContainer() {
  if (container) return container;
  const el = document.createElement('div');
  el.className = 'toast-container';
  document.body.appendChild(el);
  container = el;
  return el;
}


function show(kind, message, duration) {
  const parent = ensureContainer();

  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  }[kind] || 'ℹ';
  el.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  el.appendChild(text);

  parent.appendChild(el);

  // Появление
  requestAnimationFrame(() => el.classList.add('toast-in'));

  const close = () => {
    if (!el.parentNode) return;
    el.classList.remove('toast-in');
    el.classList.add('toast-out');
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 200);
  };

  el.addEventListener('click', close);

  const t = duration != null
    ? duration
    : (kind === 'error' || kind === 'warning' ? LONG_DURATION : DEFAULT_DURATION);

  if (t > 0) setTimeout(close, t);

  return close;
}


export const toast = {
  success: (msg, duration) => show('success', msg, duration),
  error:   (msg, duration) => show('error',   msg, duration),
  warning: (msg, duration) => show('warning', msg, duration),
  info:    (msg, duration) => show('info',    msg, duration),
};
