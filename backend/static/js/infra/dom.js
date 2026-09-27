/**
 * Базовые DOM-утилиты.
 */

export function $(id) {
  return document.getElementById(id);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;',
  })[c]);
}
