/**
 * Панель чата с LLM. Один экземпляр, один WS.
 *
 * Контекст (scope/project/scene) задаётся через showChat().
 */
import { $ } from '../infra/dom.js';
import { api } from '../core/api.js';
import { connect, on, send, cancel } from '../core/chat.js';
import { confirmDialog } from '../infra/dialogs.js';
import { renderMarkdownLite } from '../infra/markdown.js';

const THINKING_KEY = 'storyboard.chat.thinking';
const FONT_KEY = 'storyboard.chatFontSize';
const FONT_MIN = 10;
const FONT_MAX = 22;

let currentCtx = null;              // { scope, project, scene }
let messages = [];                  // локальный кеш истории
let pending = null;                 // { userMsg, assistantId, text, thinking, el }
let enableThinking = false;
let attachedImages = [];            // [{ kind, name }] или [{ kind:'chat_upload', data, name? }]
let chatFontSize = null;
let initialized = false;


function imageUrlFor(img) {
  if (!currentCtx?.project || !currentCtx?.scene) return '';
  const p = encodeURIComponent(currentCtx.project);
  const s = encodeURIComponent(currentCtx.scene);
  if (img.kind === 'scene_image') {
    const taskId = (img.name || '').replace(/\.[^.]+$/, '');
    return `/api/projects/${p}/scenes/${s}/history/${encodeURIComponent(taskId)}/image`;
  }
  return `/api/projects/${p}/scenes/${s}/chat_uploads/${encodeURIComponent(img.name)}`;
}


export function initChatPanel() {
  if (initialized) return;
  initialized = true;

  connect();

  // Thinking toggle
  const btnThink = $('chatHeaderThinking');
  if (btnThink) {
    enableThinking = localStorage.getItem(THINKING_KEY) === '1';
    btnThink.classList.toggle('active', enableThinking);
    btnThink.addEventListener('click', () => {
      enableThinking = !enableThinking;
      localStorage.setItem(THINKING_KEY, enableThinking ? '1' : '0');
      btnThink.classList.toggle('active', enableThinking);
    });
  }

  // Clear
  const btnClear = $('chatHeaderClear');
  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      if (!currentCtx) return;
      const ok = await confirmDialog({
        title: 'Очистка чата',
        message: 'Удалить всю историю этого чата?',
        confirmText: 'Очистить',
        danger: true,
      });
      if (!ok) return;
      await api.chat.clear(currentCtx.scope, currentCtx.project, currentCtx.scene);
      messages = [];
      renderMessages();
    });
  }

  // Send
  const btnSend = $('chatSend');
  if (btnSend) btnSend.addEventListener('click', doSend);

  // Stop
  const btnStop = $('chatStop');
  if (btnStop) btnStop.addEventListener('click', () => {
    cancel();
  });

  // Enter — отправить, Shift+Enter — перенос
  const input = $('chatInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    // Ctrl+V — вставка картинки
    input.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile();
          if (file) {
            e.preventDefault();
            readFileAsAttachment(file);
          }
        }
      }
    });
  }

  // Drag&drop из истории сцены
  const panel = $('chatPanel');
  if (panel) {
    panel.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-storyboard-image')) {
        e.preventDefault();
        panel.classList.add('chat-drop-active');
      }
    });
    panel.addEventListener('dragleave', (e) => {
      if (e.target === panel) panel.classList.remove('chat-drop-active');
    });
    panel.addEventListener('drop', (e) => {
      panel.classList.remove('chat-drop-active');
      const raw = e.dataTransfer.getData('application/x-storyboard-image');
      if (!raw) return;
      e.preventDefault();
      try {
        const img = JSON.parse(raw);
        if (img && img.kind && img.name) {
          attachImage(img);
        }
      } catch {}
    });
  }

  // Подписки на события chat.js
  on('start', onStreamStart);
  on('chunk', onStreamChunk);
  on('done', onStreamDone);
  on('cancelled', onStreamCancelled);
  on('error', onStreamError);

  initChatFontSize();
}


// ---------- переключение контекста ----------

export async function showChat(ctx) {
  currentCtx = ctx;
  clearAttachments();
  setStreaming(false);

  const panel = $('chatPanel');
  if (panel) panel.setAttribute('data-scope', ctx.scope);

  await reloadHistory();
}


async function reloadHistory() {
  if (!currentCtx) return;
  try {
    const d = await api.chat.history(currentCtx.scope, currentCtx.project, currentCtx.scene);
    messages = d.messages || [];
  } catch (e) {
    console.warn('[chat] не удалось загрузить историю:', e);
    messages = [];
  }
  renderMessages();
}


// ---------- рендер ----------

function renderMessages() {
  const box = $('chatMessages');
  if (!box) return;
  box.innerHTML = '';

  if (!messages.length && !pending) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'начни диалог с ассистентом';
    box.appendChild(empty);
    return;
  }

  for (const m of messages) box.appendChild(renderMessage(m));
  if (pending) box.appendChild(pending.el);
  scrollToBottom(true);
}


function renderMessage(m) {
  const el = document.createElement('div');
  el.className = `chat-msg chat-msg-${m.role}`;

  const head = document.createElement('div');
  head.className = 'chat-msg-head';
  head.textContent = m.role === 'user' ? 'вы' : 'ассистент';
  el.appendChild(head);

  if (m.role === 'user' && m.images?.length) {
    const imgs = document.createElement('div');
    imgs.className = 'chat-msg-images';
    for (const img of m.images) {
      const wrap = document.createElement('div');
      wrap.className = 'chat-msg-image';
      const i = document.createElement('img');
      i.src = imageUrlFor(img);
      i.alt = img.name || '';
      i.draggable = false;
      wrap.appendChild(i);
      imgs.appendChild(wrap);
    }
    el.appendChild(imgs);
  }

  if (m.text) {
    const body = document.createElement('div');
    body.className = 'chat-msg-body';
    body.innerHTML = renderMarkdownLite(m.text);
    el.appendChild(body);
  }

  return el;
}


function scrollToBottom(force = false) {
  const box = $('chatMessages');
  if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (force || nearBottom) {
    box.scrollTop = box.scrollHeight;
  }
}


// ---------- отправка ----------

function doSend() {
  if (!currentCtx) return;
  const input = $('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text && !attachedImages.length) return;
  if (pending) return;

  const imagesForSend = attachedImages.map(it => {
    if (it.kind === 'chat_upload') {
      return { kind: 'chat_upload', data: it.data };
    }
    return { kind: 'scene_image', name: it.name };
  });

  // Локально показываем user-сообщение (с превьюшками, если они есть)
  const localImages = attachedImages.map(it => ({
    kind: it.kind,
    name: it.name,
  }));

  const userMsg = {
    id: 'local-' + Date.now(),
    role: 'user',
    text,
    ts: Date.now(),
    images: localImages,
  };
  messages.push(userMsg);
  renderMessages();

  // Очищаем поле и аттачи
  input.value = '';
  clearAttachments();

  // Готовим пузырь ассистента
  startAssistantBubble();

  send({
    scope: currentCtx.scope,
    project: currentCtx.project,
    scene: currentCtx.scene,
    text,
    images: imagesForSend,
    enable_thinking: enableThinking,
  });

  setStreaming(true);
}


function startAssistantBubble() {
  const el = document.createElement('div');
  el.className = 'chat-msg chat-msg-assistant';

  const head = document.createElement('div');
  head.className = 'chat-msg-head';
  head.textContent = 'ассистент';
  el.appendChild(head);

  // Скрытый спойлер для thinking
  const thinkWrap = document.createElement('details');
  thinkWrap.className = 'chat-thinking';
  thinkWrap.style.display = 'none';
  const sum = document.createElement('summary');
  sum.textContent = '🧠 размышления';
  const thinkBody = document.createElement('div');
  thinkBody.className = 'chat-thinking-body';
  thinkWrap.appendChild(sum);
  thinkWrap.appendChild(thinkBody);
  el.appendChild(thinkWrap);

  const body = document.createElement('div');
  body.className = 'chat-msg-body';
  el.appendChild(body);

  const cursor = document.createElement('span');
  cursor.className = 'chat-cursor';
  cursor.textContent = '▊';
  body.appendChild(cursor);

  pending = {
    el,
    body,
    cursor,
    thinkWrap,
    thinkBody,
    text: '',
    thinking: '',
  };

  // ВАЖНО: сразу добавляем пузырь в DOM,
  // чтобы стриминг-чанки были видны пользователю.
  const box = $('chatMessages');
  if (box) {
    box.appendChild(el);
    scrollToBottom(true);
  }
}


// ---------- события стриминга ----------

function onStreamStart(msg) {
  // user-сообщение уже отрисовано локально, но сервер вернул своё с id.
  // Обновим последнее user-сообщение id'шником.
  if (msg.user_message) {
    const last = messages.findLast?.(m => m.role === 'user')
      || [...messages].reverse().find(m => m.role === 'user');
    if (last && last.id?.startsWith?.('local-')) {
      last.id = msg.user_message.id;
    }
  }
}


function onStreamChunk(msg) {
  if (!pending) return;
  const channel = msg.channel || 'content';
  const text = msg.text || '';
  if (!text) return;

  if (channel === 'thinking') {
    pending.thinking += text;
    pending.thinkWrap.style.display = '';
    // Thinking рендерим как plain text — там чаще всего просто рассуждения.
    pending.thinkBody.textContent = pending.thinking;
  } else {
    pending.text += text;
    pending.body.innerHTML = renderMarkdownLite(pending.text);
    pending.body.appendChild(pending.cursor);
  }
  scrollToBottom();
}


function onStreamDone(msg) {
  if (!pending) return;
  const finalText = (msg.message?.text || pending.text || '').trim();
  const el = pending.el;

  // Убираем курсор, ставим финальный текст
  if (finalText) {
      pending.body.innerHTML = renderMarkdownLite(finalText);
    } else {
      pending.body.textContent = '(пустой ответ)';
    }

  const doneMessage = msg.message || {
    id: 'local-assistant-' + Date.now(),
    role: 'assistant',
    text: finalText,
    ts: Date.now(),
  };
  messages.push(doneMessage);
  pending = null;
  setStreaming(false);
  renderMessages();
}


function onStreamCancelled() {
  if (!pending) return;
  // Если что-то уже пришло — оставим как есть
  const partial = pending.text.trim();
  if (partial) {
    messages.push({
      id: 'local-assistant-' + Date.now(),
      role: 'assistant',
      text: partial,
      ts: Date.now(),
    });
  }
  pending = null;
  setStreaming(false);
  renderMessages();
}


function onStreamError(msg) {
  const err = msg.error || 'неизвестная ошибка';
  if (pending) {
    pending.body.textContent = '';
    const errEl = document.createElement('div');
    errEl.className = 'chat-msg-error';
    errEl.textContent = 'ошибка: ' + err;
    pending.el.appendChild(errEl);
    pending = null;
  } else {
    const box = $('chatMessages');
    if (box) {
      const errEl = document.createElement('div');
      errEl.className = 'chat-msg-error';
      errEl.textContent = 'ошибка: ' + err;
      box.appendChild(errEl);
      scrollToBottom(true);
    }
  }
  setStreaming(false);
}


function setStreaming(on) {
  const btnSend = $('chatSend');
  const btnStop = $('chatStop');
  if (btnSend) btnSend.style.display = on ? 'none' : '';
  if (btnStop) btnStop.style.display = on ? '' : 'none';
}


// ---------- вложения ----------

function attachImage(img) {
  attachedImages.push(img);
  renderAttachments();
}

function clearAttachments() {
  attachedImages = [];
  renderAttachments();
}

function renderAttachments() {
  const box = $('chatAttachments');
  if (!box) return;
  box.innerHTML = '';
  if (!attachedImages.length) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';

  attachedImages.forEach((img, idx) => {
    const el = document.createElement('div');
    el.className = 'chat-attach-item';

    const thumb = document.createElement('img');
    if (img.kind === 'chat_upload') {
      thumb.src = img.data;
    } else {
      thumb.src = imageUrlFor(img);
    }
    el.appendChild(thumb);

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'chat-attach-remove';
    rm.textContent = '✕';
    rm.title = 'Убрать';
    rm.addEventListener('click', () => {
      attachedImages.splice(idx, 1);
      renderAttachments();
    });
    el.appendChild(rm);

    box.appendChild(el);
  });
}


function readFileAsAttachment(file) {
  const reader = new FileReader();
  reader.onload = () => {
    attachImage({
      kind: 'chat_upload',
      data: reader.result,
      name: file.name || 'pasted.png',
    });
  };
  reader.readAsDataURL(file);
}



// ---------- размер шрифта сообщений чата ----------

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
  const box = $('chatMessages');
  if (!box) return 13;
  const v = Math.round(parseFloat(getComputedStyle(box).fontSize));
  return Number.isFinite(v) && v > 0 ? v : 13;
}


function applyChatFontSize(px) {
  const box = $('chatMessages');
  if (!box) return;

  if (px == null) {
    // Снять переопределение — вернуться к значениям из tokens.css.
    box.style.removeProperty('--fz');
    box.style.removeProperty('--fz-sm');
    box.style.removeProperty('--fz-xs');
    box.style.removeProperty('--fz-md');
  } else {
    // Все правила внутри #chatMessages построены на этих переменных,
    // поэтому достаточно переопределить их локально.
    // Производные размеры держим с теми же отступами, что в tokens.css:
    //   --fz=13, --fz-md=12, --fz-sm=11, --fz-xs=10
    box.style.setProperty('--fz',    px + 'px');
    box.style.setProperty('--fz-md', Math.max(9, px - 1) + 'px');
    box.style.setProperty('--fz-sm', Math.max(9, px - 2) + 'px');
    box.style.setProperty('--fz-xs', Math.max(8, px - 3) + 'px');
  }

  const current = px ?? getCurrentFontSizePx();
  const inc = $('chatFontInc');
  const dec = $('chatFontDec');
  if (inc) inc.disabled = current >= FONT_MAX;
  if (dec) dec.disabled = current <= FONT_MIN;
}


function setChatFontSize(px) {
  const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, px));
  chatFontSize = clamped;
  applyChatFontSize(clamped);
  try {
    localStorage.setItem(FONT_KEY, String(clamped));
  } catch {}
}


function initChatFontSize() {
  const stored = readStoredFontSize();
  if (stored != null) {
    chatFontSize = stored;
    applyChatFontSize(stored);
  } else {
    chatFontSize = null;
    applyChatFontSize(null);
  }

  const inc = $('chatFontInc');
  const dec = $('chatFontDec');

  if (inc) {
    inc.addEventListener('click', () => {
      const base = chatFontSize ?? getCurrentFontSizePx();
      setChatFontSize(base + 1);
    });
  }
  if (dec) {
    dec.addEventListener('click', () => {
      const base = chatFontSize ?? getCurrentFontSizePx();
      setChatFontSize(base - 1);
    });
  }
}
