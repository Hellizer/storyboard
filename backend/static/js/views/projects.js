/**
 * Экран со списком проектов.
 */
import { api } from '../api.js';
import { navigate } from '../router.js';
import { validateProjectName, checkProjectNameAvailable } from '../validate.js';
import { $ } from '../ui.js';

let cachedProjects = [];

export async function showProjectsList() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-projects').classList.add('active');

  const grid = $('projectsGrid');
  const empty = $('projectsEmpty');
  grid.innerHTML = '';

  try {
    cachedProjects = await api.projects.list();
  } catch (e) {
    grid.innerHTML = `<div class="error">Ошибка загрузки: ${e.message}</div>`;
    return;
  }

  if (cachedProjects.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  for (const p of cachedProjects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-card-title">${escapeHtml(p.name)}</div>
      <div class="project-card-meta">
        ${p.scene_count || 0} сцен · ${p.image_count || 0} изобр.
      </div>
      <div class="project-card-date">${formatDate(p.modified)}</div>
      <button class="project-card-delete" title="Удалить">✕</button>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('project-card-delete')) return;
      navigate(`/project/${encodeURIComponent(p.name)}`);
    });
    card.querySelector('.project-card-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Удалить проект «${p.name}»?\nВсе сцены и изображения будут удалены.`)) return;
      try {
        await api.projects.delete(p.name);
        showProjectsList();
      } catch (err) {
        alert('Ошибка удаления: ' + err.message);
      }
    });
    grid.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;',
  })[c]);
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function initProjectsView() {
  const modal = $('newProjectModal');
  const input = $('newProjectName');
  const errEl = $('newProjectError');

  $('btnNewProject').addEventListener('click', () => {
    input.value = '';
    errEl.textContent = '';
    modal.classList.add('open');
    input.focus();
  });

  $('btnCancelNewProject').addEventListener('click', () => {
    modal.classList.remove('open');
  });
  $('btnCancelNewProject2').addEventListener('click', () => {
    modal.classList.remove('open');
  });

  async function tryCreate() {
    const name = input.value;
    errEl.textContent = '';

    const err = validateProjectName(name);
    if (err) {
      errEl.textContent = err;
      return;
    }

    const dupErr = checkProjectNameAvailable(name, cachedProjects);
    if (dupErr) {
      errEl.textContent = dupErr;
      return;
    }

    try {
      await api.projects.create(name.trim());
      modal.classList.remove('open');
      navigate(`/project/${encodeURIComponent(name.trim())}`);
    } catch (e) {
      errEl.textContent = e.message;
    }
  }

  $('btnCreateProject').addEventListener('click', tryCreate);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryCreate();
  });

  // Live-валидация при вводе
  input.addEventListener('input', () => {
    const err = validateProjectName(input.value);
    errEl.textContent = err || '';
  });
}
