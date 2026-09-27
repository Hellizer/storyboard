/**
 * Модалка создания/редактирования кубика.
 *
 * Простой кубик: text.
 * Мульти-кубик: parts (id кубиков — простых или других composite).
 *
 * Вложенность composite в composite разрешена, циклы запрещены.
 * В списке подкубиков недоступны сам кубик и все его ПРЕДКИ (защита от цикла).
 * Потомки доступны — иначе нельзя было бы редактировать существующие части.
 *
 * Порядок частей задаётся явно (кнопки ↑/↓) и сохраняется как есть.
 */
import { $ } from '../infra/dom.js';
import { api } from '../core/api.js';
import { confirmDialog } from '../infra/dialogs.js';
import { toast } from '../infra/toast.js';

let currentCube = null;
let currentOptions = null;
let editingId = null;
let initialized = false;

// Порядок выбранных частей (массив id). Сохраняется при submit.
let selectedParts = [];


export function openCubeEditor(cube, options) {
  currentCube = cube;
  currentOptions = options || {};
  editingId = cube?.id || null;

  const modal = $('cubeEditorModal');
  if (!modal) return;

  $('cubeEditorTitle').textContent = editingId
    ? 'Редактировать кубик'
    : 'Новый кубик';

  $('cubeName').value = cube?.name || '';
  $('cubeColor').value = cube?.color || '#8b3a3a';
  $('cubePinned').checked = !!cube?.pinned;
  $('cubeText').value = cube?.text || '';

  setupCategorySelect(cube?.category || '');

  const isComposite = cube?.type === 'composite';
  const typeValue = isComposite ? 'composite' : 'simple';
  document
    .querySelectorAll('input[name="cubeType"]')
    .forEach(r => {
      r.checked = r.value === typeValue;
      r.disabled = !!editingId;
    });

  selectedParts = (cube?.parts || []).slice();

  updateTypeVisibility();
  renderParts();

  $('btnCubeDelete').style.display = editingId ? '' : 'none';
  $('cubeEditorError').textContent = '';

  modal.classList.add('open');
  setTimeout(() => $('cubeName').focus(), 50);
}


function closeEditor() {
  $('cubeEditorModal').classList.remove('open');
  currentCube = null;
  currentOptions = null;
  editingId = null;
  selectedParts = [];
}


function updateTypeVisibility() {
  const type = document.querySelector('input[name="cubeType"]:checked')?.value || 'simple';
  $('cubeTextGroup').style.display = type === 'simple' ? '' : 'none';
  $('cubePartsGroup').style.display = type === 'composite' ? '' : 'none';
}


// ---------- категория: select + опция «новая» ----------

const NEW_CATEGORY_VALUE = '__new__';

function setupCategorySelect(currentCategory) {
  const sel = $('cubeCategorySelect');
  const inputRow = $('cubeCategoryNewRow');
  const input = $('cubeCategoryNew');

  sel.innerHTML = '';

  const categories = currentOptions.categories || [];
  const known = categories.includes(currentCategory) && currentCategory !== '';

  for (const cat of categories) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    sel.appendChild(opt);
  }

  const newOpt = document.createElement('option');
  newOpt.value = NEW_CATEGORY_VALUE;
  newOpt.textContent = '+ новая категория…';
  sel.appendChild(newOpt);

  if (currentCategory && !known) {
    sel.value = NEW_CATEGORY_VALUE;
    inputRow.style.display = '';
    input.value = currentCategory;
  } else if (currentCategory) {
    sel.value = currentCategory;
    inputRow.style.display = 'none';
    input.value = '';
  } else {
    sel.value = categories[0] || NEW_CATEGORY_VALUE;
    inputRow.style.display = sel.value === NEW_CATEGORY_VALUE ? '' : 'none';
    input.value = '';
  }

  if (!sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => {
      inputRow.style.display =
        sel.value === NEW_CATEGORY_VALUE ? '' : 'none';
      if (sel.value === NEW_CATEGORY_VALUE) {
        input.focus();
      }
    });
  }
}


function readCategoryFromForm() {
  const sel = $('cubeCategorySelect');
  if (sel.value === NEW_CATEGORY_VALUE) {
    return $('cubeCategoryNew').value.trim();
  }
  return sel.value.trim();
}


// ---------- подкубики: запрет предков, reorder ----------

/**
 * Запрещены: сам кубик + все его ПРЕДКИ (транзитивно).
 * Цикл возникает, если в B добавить A, а A (транзитивно) содержит B.
 */
function collectForbiddenIds(cubeId, allCubes) {
  const forbidden = new Set();
  if (!cubeId) return forbidden;

  const parents = {};
  for (const c of allCubes) {
    if (c.type !== 'composite') continue;
    for (const pid of c.parts || []) {
      if (!parents[pid]) parents[pid] = [];
      parents[pid].push(c.id);
    }
  }

  const queue = [cubeId];
  forbidden.add(cubeId);
  while (queue.length) {
    const id = queue.shift();
    for (const parentId of parents[id] || []) {
      if (!forbidden.has(parentId)) {
        forbidden.add(parentId);
        queue.push(parentId);
      }
    }
  }
  return forbidden;
}


function renderParts() {
  const list = $('cubePartsList');
  list.innerHTML = '';

  const all = currentOptions.allCubes || [];
  const forbidden = collectForbiddenIds(editingId, all);
  const candidates = all.filter(c => !forbidden.has(c.id));
  const candidateIds = new Set(candidates.map(c => c.id));
  const byId = {};
  for (const c of candidates) byId[c.id] = c;

  selectedParts = selectedParts.filter(id => candidateIds.has(id));

  const availableIds = candidates
    .filter(c => !selectedParts.includes(c.id))
    .map(c => c.id);

  if (candidates.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cubes-empty cubes-empty-small';
    empty.textContent = 'нет кубиков, доступных для добавления';
    list.appendChild(empty);
    return;
  }

  if (selectedParts.length > 0) {
    list.appendChild(makePartHeader('Выбрано (порядок важен)'));
    selectedParts.forEach((id, idx) => {
      list.appendChild(makeSelectedRow(id, idx, byId[id]));
    });
  }

  if (availableIds.length > 0) {
    list.appendChild(makePartHeader('Доступно'));
    for (const id of availableIds) {
      list.appendChild(makeAvailableRow(id, byId[id]));
    }
  }
}


function makePartHeader(text) {
  const el = document.createElement('div');
  el.className = 'cube-parts-section-header';
  el.textContent = text;
  return el;
}


function makeSelectedRow(id, idx, cube) {
  const row = document.createElement('div');
  row.className = 'cube-part-row cube-part-row-selected';

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'cube-part-order-btn';
  upBtn.textContent = '↑';
  upBtn.title = 'Вверх';
  upBtn.disabled = idx === 0;
  upBtn.addEventListener('click', () => {
    if (idx === 0) return;
    const [moved] = selectedParts.splice(idx, 1);
    selectedParts.splice(idx - 1, 0, moved);
    renderParts();
  });
  row.appendChild(upBtn);

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'cube-part-order-btn';
  downBtn.textContent = '↓';
  downBtn.title = 'Вниз';
  downBtn.disabled = idx === selectedParts.length - 1;
  downBtn.addEventListener('click', () => {
    if (idx === selectedParts.length - 1) return;
    const [moved] = selectedParts.splice(idx, 1);
    selectedParts.splice(idx + 1, 0, moved);
    renderParts();
  });
  row.appendChild(downBtn);

  const name = document.createElement('span');
  name.className = 'cube-part-row-name';
  const suffix = cube.type === 'composite' ? ' · мульти' : '';
  name.textContent = `${cube.name} · ${cube.category}${suffix}`;
  row.appendChild(name);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'cube-part-order-btn cube-part-remove-btn';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Убрать';
  removeBtn.addEventListener('click', () => {
    selectedParts = selectedParts.filter(x => x !== id);
    renderParts();
  });
  row.appendChild(removeBtn);

  return row;
}


function makeAvailableRow(id, cube) {
  const row = document.createElement('div');
  row.className = 'cube-part-row cube-part-row-available';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'cube-part-add-btn';
  addBtn.textContent = '+';
  addBtn.title = 'Добавить';
  addBtn.addEventListener('click', () => {
    if (!selectedParts.includes(id)) {
      selectedParts.push(id);
      renderParts();
    }
  });
  row.appendChild(addBtn);

  const name = document.createElement('span');
  name.className = 'cube-part-row-name';
  const suffix = cube.type === 'composite' ? ' · мульти' : '';
  name.textContent = `${cube.name} · ${cube.category}${suffix}`;
  row.appendChild(name);

  return row;
}


// ---------- сохранение/удаление ----------

async function save() {
  const err = $('cubeEditorError');
  err.textContent = '';

  const name = $('cubeName').value.trim();
  if (!name) {
    err.textContent = 'Имя не может быть пустым';
    return;
  }

  const category = readCategoryFromForm();
  if (!category) {
    err.textContent = 'Категория не может быть пустой';
    return;
  }
  if (/[,;\n\r\t]/.test(category)) {
    err.textContent = 'Категория — одно слово без запятых и точек с запятой';
    return;
  }

  const type = document.querySelector('input[name="cubeType"]:checked')?.value || 'simple';

  const payload = {
    name,
    category,
    color: $('cubeColor').value,
    pinned: $('cubePinned').checked,
  };

  if (type === 'composite') {
    payload.type = 'composite';
    payload.parts = selectedParts.slice();
  } else {
    payload.text = $('cubeText').value.trim();
  }

  try {
    if (editingId) {
      await api.cubes.update(editingId, payload);
    } else {
      await api.cubes.create(payload);
    }
    const cb = currentOptions.onSaved;
    const wasEdit = !!editingId;
    closeEditor();
    toast.success(wasEdit ? 'Кубик обновлён' : 'Кубик создан');
    if (cb) cb();
  } catch (e) {
    err.textContent = e.message;
  }
}


async function doDelete() {
  if (!editingId) return;
  const name = currentCube?.name || '';
  const ok = await confirmDialog({
    title: 'Удаление кубика',
    message: `Удалить кубик «${name}»?`,
    confirmText: 'Удалить',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.cubes.delete(editingId);
    const cb = currentOptions.onDeleted;
    closeEditor();
    toast.success('Кубик удалён');
    if (cb) cb();
  } catch (e) {
    $('cubeEditorError').textContent = e.message;
  }
}


export function initCubeEditor() {
  if (initialized) return;
  initialized = true;

  const modal = $('cubeEditorModal');
  if (!modal) return;

  $('btnCubeEditorClose').addEventListener('click', closeEditor);
  $('btnCubeCancel').addEventListener('click', closeEditor);
  $('btnCubeSave').addEventListener('click', save);
  $('btnCubeDelete').addEventListener('click', doDelete);

  document
    .querySelectorAll('input[name="cubeType"]')
    .forEach(r => r.addEventListener('change', updateTypeVisibility));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeEditor();
    }
  });
}
