/**
 * Кастомные confirm/alert/prompt вместо браузерных.
 *
 * Все три функции возвращают Promise:
 *   confirmDialog(opts) → Promise<boolean>
 *   alertDialog(opts)   → Promise<void>
 *   promptDialog(opts)  → Promise<string | null>
 *
 * Контейнер создаётся лениво, один на всё приложение.
 * Enter = подтвердить, Esc / клик по backdrop = отменить.
 */

const dialogRegistry = {
  active: null,   // { resolve, kind, cancelValue }
  backdrop: null,
};


function ensureBackdrop() {
  if (dialogRegistry.backdrop) return dialogRegistry.backdrop;

  const el = document.createElement('div');
  el.className = 'dialog-backdrop';
  el.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <h3 class="dialog-title"></h3>
        <button type="button" class="icon-btn dialog-close" title="Закрыть">✕</button>
      </div>
      <div class="dialog-body">
        <div class="dialog-message"></div>
        <input type="text" class="dialog-input" />
      </div>
      <div class="dialog-footer">
        <button type="button" class="icon-btn dialog-cancel">Отмена</button>
        <button type="button" class="icon-btn primary dialog-confirm">ОК</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  // Клик по backdrop — отмена
  el.addEventListener('click', (e) => {
    if (e.target === el && dialogRegistry.active) {
      doClose(dialogRegistry.active.cancelValue);
    }
  });

  dialogRegistry.backdrop = el;
  return el;
}


function doClose(result) {
  const ctx = dialogRegistry.active;
  if (!ctx) return;
  dialogRegistry.active = null;
  dialogRegistry.backdrop.classList.remove('open');
  ctx.resolve(result);
}


function doConfirm() {
  const ctx = dialogRegistry.active;
  if (!ctx) return;
  if (ctx.kind === 'prompt') {
    const input = dialogRegistry.backdrop.querySelector('.dialog-input');
    const v = (input.value || '').trim();
    doClose(v || null);
  } else {
    doClose(true);
  }
}


function doCancel() {
  const ctx = dialogRegistry.active;
  if (!ctx) return;
  doClose(ctx.cancelValue);
}


// Esc — отмена. Enter — подтверждение.
document.addEventListener('keydown', (e) => {
  if (!dialogRegistry.active) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    doCancel();
  } else if (e.key === 'Enter') {
    const input = dialogRegistry.backdrop.querySelector('.dialog-input');
    const isPromptInput = dialogRegistry.active.kind === 'prompt'
      && document.activeElement === input;
    // В prompt Enter из поля — подтвердить.
    // В confirm/alert Enter где угодно — подтвердить.
    // Игнорируем Enter, если фокус на кнопке «Отмена» — пусть сработает клик.
    const cancelBtn = dialogRegistry.backdrop.querySelector('.dialog-cancel');
    if (document.activeElement === cancelBtn) return;

    e.preventDefault();
    doConfirm();
  }
});


function show(options) {
  const opts = Object.assign({
    kind: 'confirm',              // 'confirm' | 'alert' | 'prompt'
    title: '',
    message: '',
    confirmText: 'ОК',
    cancelText: 'Отмена',
    danger: false,
    defaultValue: '',
    placeholder: '',
  }, options || {});

  const backdrop = ensureBackdrop();
  const titleEl   = backdrop.querySelector('.dialog-title');
  const msgEl     = backdrop.querySelector('.dialog-message');
  const inputEl   = backdrop.querySelector('.dialog-input');
  const confirmEl = backdrop.querySelector('.dialog-confirm');
  const cancelEl  = backdrop.querySelector('.dialog-cancel');
  const closeEl   = backdrop.querySelector('.dialog-close');

  titleEl.textContent = opts.title || '';
  titleEl.style.display = opts.title ? '' : 'none';

  msgEl.textContent = opts.message || '';
  msgEl.style.display = opts.message ? '' : 'none';

  if (opts.kind === 'prompt') {
    inputEl.style.display = '';
    inputEl.value = opts.defaultValue || '';
    inputEl.placeholder = opts.placeholder || '';
  } else {
    inputEl.style.display = 'none';
    inputEl.value = '';
  }

  confirmEl.textContent = opts.confirmText;
  confirmEl.classList.toggle('danger', !!opts.danger);
  confirmEl.classList.toggle('primary', !opts.danger);

  cancelEl.textContent = opts.cancelText;
  cancelEl.style.display = opts.kind === 'alert' ? 'none' : '';

  closeEl.style.display = opts.kind === 'alert' ? '' : 'none';

  // Свежие обработчики (клон убирает старые)
  const newConfirm = confirmEl.cloneNode(true);
  const newCancel  = cancelEl.cloneNode(true);
  const newClose   = closeEl.cloneNode(true);
  confirmEl.parentNode.replaceChild(newConfirm, confirmEl);
  cancelEl.parentNode.replaceChild(newCancel, cancelEl);
  closeEl.parentNode.replaceChild(newClose, closeEl);

  backdrop.querySelector('.dialog-confirm').addEventListener('click', doConfirm);
  backdrop.querySelector('.dialog-cancel').addEventListener('click', doCancel);
  backdrop.querySelector('.dialog-close').addEventListener('click', doCancel);

  let cancelValue;
  if (opts.kind === 'prompt') cancelValue = null;
  else if (opts.kind === 'confirm') cancelValue = false;
  else cancelValue = undefined;

  return new Promise((resolve) => {
    dialogRegistry.active = { resolve, kind: opts.kind, cancelValue };
    backdrop.classList.add('open');

    setTimeout(() => {
      if (opts.kind === 'prompt') {
        const inp = backdrop.querySelector('.dialog-input');
        inp.focus();
        inp.select();
      } else {
        backdrop.querySelector('.dialog-confirm').focus();
      }
    }, 30);
  });
}


export function confirmDialog(options) {
  return show(Object.assign({ kind: 'confirm' }, options || {}));
}

export function alertDialog(options) {
  return show(Object.assign({ kind: 'alert', confirmText: 'ОК' }, options || {}));
}

export function promptDialog(options) {
  return show(Object.assign({ kind: 'prompt' }, options || {}));
}
