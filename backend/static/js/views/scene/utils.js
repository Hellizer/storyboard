/**
 * Общие утилиты экрана сцены.
 */

export function historyImageUrl(projectName, sceneId, history_id) {
  return `/api/projects/${encodeURIComponent(projectName)}/scenes/${encodeURIComponent(sceneId)}/history/${encodeURIComponent(history_id)}/image`;
}

export function pickSeed(seedField) {
  const v = seedField ? seedField.value.trim() : '';
  if (!v) return Math.floor(Math.random() * 2147483647);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : Math.floor(Math.random() * 2147483647);
}
