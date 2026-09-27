/**
 * Таб «Кубики» на экране сцены.
 *
 * Загружает библиотеку через /api/cubes, рендерит чипы категорий,
 * список с пиннингом и раскрытием composite-кубиков (в т.ч. вложенных).
 * Клик по кубику — вставка текста в конец промпта сцены.
 */
import { api } from '../../core/api.js';
import { $ } from '../../infra/dom.js';
import { openCubeEditor } from '../../components/cube_editor.js';

let cubesCache = [];
let categoriesCache = [];
let activeCategory = 'all';
let searchQuery = '';
const expandedComposites = new Set();

let initialized = false;


export function initCubes() {
  if (initialized) return;
  initialized = true;

  const search = $('cubesSearch');
  if (search) {
    search.addEventListener('input', () => {
      searchQuery = search.value;
      renderList();
    });
  }

  const btnCreate = $('btnCubeCreate');
  if (btnCreate) {
    btnCreate.addEventListener('click', () => {
      openCubeEditor(null, {
        categories: categoriesCache,
        allCubes: cubesCache,
        onSaved: refreshCubes,
        onDeleted: refreshCubes,
      });
    });
  }

  const btnRefresh = $('btnCubesRefresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => refreshCubes());
  }

  const tabBtn = document.querySelector('.scene-tab[data-tab="cubes"]');
  if (tabBtn) {
    tabBtn.addEventListener('click', () => {
      if (cubesCache.length === 0 && categoriesCache.length === 0) {
        refreshCubes();
      }
    });
  }
}


export function showCubes() {
  if (cubesCache.length === 0 && categoriesCache.length === 0) {
    refreshCubes();
  } else {
    renderCategories();
    renderList();
  }
}


async function refreshCubes() {
  try {
    const data = await api.cubes.list();
    cubesCache = data.cubes || [];
    categoriesCache = data.categories || [];
    renderCategories();
    renderList();
  } catch (e) {
    console.error('[cubes] не удалось загрузить:', e);
    const container = $('cubesList');
    if (container) {
      container.innerHTML = '<div class="cubes-empty">ошибка загрузки</div>';
    }
  }
}


// ---------- категории ----------

function renderCategories() {
  const container = $('cubesCategories');
  if (!container) return;
  container.innerHTML = '';

  const counts = { all: cubesCache.length };
  for (const c of cubesCache) {
    counts[c.category] = (counts[c.category] || 0) + 1;
  }

  const chips = [{ id: 'all', label: 'Все', count: counts.all }];
  for (const cat of categoriesCache) {
    const count = counts[cat] || 0;
    if (count === 0 && cat !== activeCategory) continue;
    chips.push({ id: cat, label: cat, count });
  }

  for (const chip of chips) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cubes-chip';
    if (chip.id === activeCategory) el.classList.add('active');
    el.innerHTML = `${chip.label} <span class="cubes-chip-count">${chip.count}</span>`;
    el.addEventListener('click', () => {
      activeCategory = chip.id;
      renderCategories();
      renderList();
    });
    container.appendChild(el);
  }
}


// ---------- список ----------

function renderList() {
  const container = $('cubesList');
  if (!container) return;
  container.innerHTML = '';

  const q = searchQuery.trim().toLowerCase();
  const hasQuery = q.length > 0;

  const pinned = cubesCache.filter(c => c.pinned);
  const rest = cubesCache.filter(c => !c.pinned);

  const filteredRest = (!hasQuery && activeCategory !== 'all')
    ? rest.filter(c => c.category === activeCategory)
    : rest;

  const filterSearch = (arr) => hasQuery
    ? arr.filter(c => matchesSearch(c, q))
    : arr;

  const pinnedVisible = filterSearch(pinned);
  const restVisible = filterSearch(filteredRest);

  if (pinnedVisible.length === 0 && restVisible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cubes-empty';
    empty.textContent = hasQuery ? 'ничего не найдено' : 'кубиков нет';
    container.appendChild(empty);
    return;
  }

  if (pinnedVisible.length > 0) {
    container.appendChild(makeSectionHeader('Закреплённые'));
    for (const c of pinnedVisible) {
      container.appendChild(renderCubeTree(c, hasQuery, 0));
    }
  }

  if (restVisible.length > 0) {
    if (pinnedVisible.length > 0) {
      container.appendChild(makeSectionHeader('Все'));
    }
    for (const c of restVisible) {
      container.appendChild(renderCubeTree(c, hasQuery, 0));
    }
  }
}


function makeSectionHeader(text) {
  const el = document.createElement('div');
  el.className = 'cubes-section-header';
  el.textContent = text;
  return el;
}


/**
 * Поиск совпадений внутри кубика и всех его потомков (рекурсивно).
 * Ищет по имени и тексту.
 */
function matchesSearch(cube, q, visited = new Set()) {
  if (visited.has(cube.id)) return false;
  visited.add(cube.id);

  if ((cube.name || '').toLowerCase().includes(q)) return true;
  if (cube.text && cube.text.toLowerCase().includes(q)) return true;

  if (cube.type === 'composite') {
    for (const pid of cube.parts || []) {
      const p = cubesCache.find(c => c.id === pid);
      if (!p) continue;
      if (matchesSearch(p, q, visited)) return true;
    }
  }
  return false;
}


/**
 * Рекурсивно отрисовать кубик и его раскрытые подкубики.
 * depth: 0 — верхний уровень, >0 — вложенный.
 */
function renderCubeTree(cube, forceExpanded, depth = 0) {
  const wrapper = document.createElement('div');
  wrapper.className = 'cube-wrapper';
  if (depth > 0) wrapper.classList.add('cube-wrapper-nested');

  const row = renderCubeRow(cube, forceExpanded, depth);
  wrapper.appendChild(row);

  if (cube.type === 'composite') {
    const isExpanded = forceExpanded || expandedComposites.has(cube.id);
    if (isExpanded) {
      const parts = document.createElement('div');
      parts.className = 'cube-parts';

      for (const pid of cube.parts || []) {
        const part = cubesCache.find(c => c.id === pid);
        if (!part) continue;
        parts.appendChild(renderCubeTree(part, forceExpanded, depth + 1));
      }

      if (!parts.children.length) {
        const empty = document.createElement('div');
        empty.className = 'cubes-empty cubes-empty-small';
        empty.textContent = 'пустой мульти-кубик';
        parts.appendChild(empty);
      }
      wrapper.appendChild(parts);
    }
  }

  return wrapper;
}


function renderCubeRow(cube, forceExpanded, depth) {
  const row = document.createElement('div');
  row.className = 'cube-row';
  if (cube.type === 'composite') row.classList.add('cube-row-composite');
  if (depth > 0) row.classList.add('cube-row-part');

  const bar = document.createElement('div');
  bar.className = 'cube-color-bar';
  bar.style.background = cube.color || '#666';
  row.appendChild(bar);

  if (cube.type === 'composite') {
    const isExpanded = forceExpanded || expandedComposites.has(cube.id);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cube-toggle';
    toggle.textContent = isExpanded ? '▼' : '▶';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expandedComposites.has(cube.id)) {
        expandedComposites.delete(cube.id);
      } else {
        expandedComposites.add(cube.id);
      }
      renderList();
    });
    row.appendChild(toggle);
  } else {
    const spacer = document.createElement('div');
    spacer.className = 'cube-toggle-spacer';
    row.appendChild(spacer);
  }

  const main = document.createElement('div');
  main.className = 'cube-main';

  const name = document.createElement('div');
  name.className = 'cube-name';
  name.textContent = cube.name;
  main.appendChild(name);

  const text = document.createElement('div');
  text.className = 'cube-text';
  if (cube.type === 'composite') {
    const n = (cube.parts || []).length;
    text.textContent = `${n} ${plural(n, 'часть', 'части', 'частей')}`;
  } else {
    text.textContent = cube.text || '';
  }
  main.appendChild(text);

  main.addEventListener('click', () => onCubeClick(cube));
  row.appendChild(main);

  row.appendChild(renderActions(cube));
  return row;
}


function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}


function renderActions(cube) {
  const actions = document.createElement('div');
  actions.className = 'cube-actions';

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'cube-action-btn';
  pinBtn.title = cube.pinned ? 'Открепить' : 'Закрепить';
  pinBtn.textContent = cube.pinned ? '★' : '☆';
  pinBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await api.cubes.update(cube.id, { pinned: !cube.pinned });
      const idx = cubesCache.findIndex(c => c.id === cube.id);
      if (idx >= 0) cubesCache[idx].pinned = !cube.pinned;
      renderCategories();
      renderList();
    } catch (err) {
      console.warn('[cubes] не удалось изменить пиннинг:', err);
    }
  });
  actions.appendChild(pinBtn);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'cube-action-btn';
  editBtn.title = 'Редактировать';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCubeEditor(cube, {
      categories: categoriesCache,
      allCubes: cubesCache,
      onSaved: refreshCubes,
      onDeleted: refreshCubes,
    });
  });
  actions.appendChild(editBtn);

  return actions;
}


// ---------- вставка в промпт ----------

async function onCubeClick(cube) {
  const text = resolveCubeText(cube);
  if (!text) return;
  insertTextIntoPrompt(text);
  try {
    const d = await api.cubes.touch(cube.id);
    const idx = cubesCache.findIndex(c => c.id === cube.id);
    if (idx >= 0 && d && d.cube) cubesCache[idx] = d.cube;
  } catch (e) {
    console.warn('[cubes] touch не удался:', e);
  }
}


/**
 * Рекурсивно собрать текст кубика.
 * visited защищает от бесконечного цикла, если в базе каким-то образом
 * оказалась циклическая ссылка (бэк такого не допускает, но подстрахуемся).
 */
function resolveCubeText(cube, visited = new Set()) {
  if (!cube) return '';
  if (visited.has(cube.id)) return '';
  visited.add(cube.id);

  if (cube.type === 'composite') {
    return (cube.parts || [])
      .map(id => cubesCache.find(c => c.id === id))
      .filter(Boolean)
      .map(p => resolveCubeText(p, visited))
      .filter(Boolean)
      .join(', ');
  }
  return (cube.text || '').trim();
}


function insertTextIntoPrompt(text) {
  const field = $('genScenePrompt');
  if (!field) return;

  const value = field.value || '';
  const start = field.selectionStart ?? value.length;
  const end = field.selectionEnd ?? value.length;

  const before = value.slice(0, start);
  const after = value.slice(end);

  const insertion = (text || '').trim();
  if (!insertion) return;

  // Запятая перед вставкой — если слева есть непробельный текст
  // и он не заканчивается запятой. Если заканчивается — просто пробел.
  let prefix = '';
  const beforeTrimmed = before.replace(/\s+$/, '');
  if (beforeTrimmed.length > 0) {
    if (beforeTrimmed.endsWith(',')) {
      prefix = ' ';
    } else {
      prefix = ', ';
    }
  }

  // Запятая после вставки — если справа есть непробельный текст
  // и он не начинается с запятой.
  let suffix = '';
  const afterTrimmed = after.replace(/^\s+/, '');
  if (afterTrimmed.length > 0 && !afterTrimmed.startsWith(',')) {
    suffix = ', ';
  }

  const newValue = before + prefix + insertion + suffix + after;
  field.value = newValue;

  // Курсор — сразу после вставленного блока и добавленной запятой-суффикса.
  const cursorPos = (before + prefix + insertion + suffix).length;
  field.setSelectionRange(cursorPos, cursorPos);
  field.focus();

  // Триггерим автосохранение prompt.js
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
