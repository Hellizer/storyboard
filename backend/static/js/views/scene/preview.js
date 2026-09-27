/**
 * Большая картинка активного варианта + модалка полного размера.
 */
import { $ } from '../../infra/dom.js';
import { historyImageUrl } from './utils.js';

let ctx = null;  // { projectName, sceneId, activeHistoryId }

export function initPreview() {
  const bigPreview = $('genScenePreview');
  if (bigPreview) {
    bigPreview.addEventListener('click', () => {
      if (ctx && ctx.activeHistoryId) {
        openImageViewer(historyImageUrl(ctx.projectName, ctx.sceneId, ctx.activeHistoryId));
      }
    });
  }

  const closeBtn = $('btnImageViewerClose');
  if (closeBtn) closeBtn.addEventListener('click', closeImageViewer);

  const viewerModal = $('imageViewerModal');
  if (viewerModal) {
    viewerModal.addEventListener('click', (e) => {
      if (e.target.id === 'imageViewerModal') closeImageViewer();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('imageViewerModal')?.classList.contains('open')) {
      closeImageViewer();
    }
  });
}

export function setPreviewContext(projectName, sceneId) {
  if (!ctx) ctx = {};
  ctx.projectName = projectName;
  ctx.sceneId = sceneId;
}

export function renderBigPreview(activeHistoryId) {
  if (!ctx) return;
  ctx.activeHistoryId = activeHistoryId;

  const preview = $('genScenePreview');
  if (!preview) return;

  if (activeHistoryId) {
    preview.innerHTML = `<img src="${historyImageUrl(ctx.projectName, ctx.sceneId, activeHistoryId)}" alt="result">`;
  } else {
    preview.innerHTML = 'здесь появится картинка';
  }
}

export function openImageViewer(url) {
  const modal = $('imageViewerModal');
  const img = $('imageViewerImg');
  if (!modal || !img) return;
  img.src = url;
  modal.classList.add('open');
}

export function closeImageViewer() {
  const modal = $('imageViewerModal');
  const img = $('imageViewerImg');
  if (!modal) return;
  modal.classList.remove('open');
  if (img) img.src = '';
}
