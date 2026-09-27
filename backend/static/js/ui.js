/**
 * Общие UI-утилиты. Без бизнес-логики.
 */

export function $(id) {
  return document.getElementById(id);
}

export function setStatus(msg, isError = false) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#ff8888' : '#888';
}

export function setProgress(pct) {
  const wrap = $('progressWrap');
  const bar = $('progressBar');
  if (!wrap || !bar) return;
  wrap.style.display = 'block';
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  bar.style.width = clamped + '%';
  bar.textContent = clamped + '%';
}

export function hideProgress() {
  const wrap = $('progressWrap');
  if (wrap) wrap.style.display = 'none';
}

export function showPreview(html) {
  const el = $('preview');
  if (el) el.innerHTML = html;
}

export function setApplied(html) {
  const el = $('applied');
  if (el) el.innerHTML = html;
}

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
 * Работает для любой группы с классом .tab внутри контейнера.
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
