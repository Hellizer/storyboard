/**
 * Простой хэш-роутер. Работает с window.location.hash.
 */

const routes = [];
let notFound = () => {};

export function addRoute(pattern, handler) {
  routes.push({ pattern, handler });
}

export function setNotFound(handler) {
  notFound = handler;
}

export function navigate(path) {
  if (window.location.hash.slice(1) === path) {
    // Тот же путь — вручную вызываем handle, чтобы перерисовать
    handleRoute();
  } else {
    window.location.hash = path;
  }
}

function handleRoute() {
  const hash = window.location.hash.slice(1) || "/";
  for (const { pattern, handler } of routes) {
    const m = hash.match(pattern);
    if (m) {
      handler(...m.slice(1));
      return;
    }
  }
  notFound();
}

export function initRouter() {
  window.addEventListener("hashchange", handleRoute);
  handleRoute();
}
