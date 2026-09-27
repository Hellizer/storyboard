/**
 * Клиент чата с LLM. Один WS на всё приложение.
 *
 * Подписки: on('start'|'chunk'|'done'|'cancelled'|'error'|'open'|'close', cb)
 * Отправка: send({scope, project, scene, text, images, enable_thinking})
 */
import { openChatWs } from './api.js';   // добавим ниже в api.js

let ws = null;
let reconnectTimer = null;
let isOpen = false;

const listeners = new Map();   // event → Set<cb>

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const cb of set) {
    try { cb(payload); } catch (e) { console.error('[chat] listener error:', e); }
  }
}

export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event)?.delete(cb);
}

function ensureWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  ws = openChatWs();

  ws.addEventListener('open', () => {
    isOpen = true;
    emit('open');
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    emit(msg.type, msg);
  });

  ws.addEventListener('close', () => {
    isOpen = false;
    emit('close');
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(ensureWs, 1500);
  });

  ws.addEventListener('error', () => {
    // close придёт следом — там и реконнект
  });
}

export function connect() {
  ensureWs();
}

export function send(payload) {
  ensureWs();
  const doSend = () => ws.send(JSON.stringify({ type: 'send', ...payload }));
  if (isOpen) {
    doSend();
  } else {
    // ждём open один раз
    const off = on('open', () => { off(); doSend(); });
  }
}

export function cancel() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'cancel' }));
}
