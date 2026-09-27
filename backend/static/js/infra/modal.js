/**
 * Механика модальных окон.
 */
import { $ } from './dom.js';

export function openModal(id) {
  const el = $(id);
  if (el) el.classList.add('open');
}

export function closeModal(id) {
  const el = $(id);
  if (el) el.classList.remove('open');
}

/**
 * Навесить обработчики на табы внутри модалки.
 * Работает для любой группы с классом .tab.
 */
export function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById('tab-' + tab.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
}
