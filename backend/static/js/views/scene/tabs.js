/**
 * Переключение табов правой области сцены: [Превью][Чат][Кубики]
 */

let activeTab = 'preview';

export function setActiveTab(name) {
  activeTab = name;
  document.querySelectorAll('.scene-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.scene-tab-pane').forEach(p => {
    p.classList.toggle('active', p.dataset.tab === name);
  });
}

export function getActiveTab() {
  return activeTab;
}

export function initTabs() {
  document.querySelectorAll('.scene-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      setActiveTab(tab.dataset.tab);
    });
  });
}
