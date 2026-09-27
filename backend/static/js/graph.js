/**
 * Граф сцен. Canvas-based редактор.
 * Каждая сцена — узел с названием. Потом будет превью варианта.
 */

const NODE_RADIUS = 55;
const NODE_CARD_W = 120;
const NODE_CARD_H = 90;
const EDGE_HIT_TOLERANCE = 8;

export class SceneGraph {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.projectName = options.projectName || null;

    this.scenes = [];
    this.edges = [];
    this.selectedId = null;

    this.panX = 0;
    this.panY = 0;
    this.scale = 1;

    this.isPanning = false;
    this.isDraggingNode = null;
    this.isDrawingEdge = null;
    this.tempEdge = null;

    this.draggingState = null;

    this.callbacks = {
      onOpenScene: options.onOpenScene || (() => {}),
      onChange: options.onChange || (() => {}),
      onCreateScene: options.onCreateScene || null,
    };

    this._bindEvents();
    this._resize();

    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(canvas.parentElement || canvas);
    } else {
      window.addEventListener('resize', () => this._resize());
    }
  }

  // ---------- Публичное API ----------

  setData(scenes, edges) {
      this.scenes = scenes || [];
      this.edges = edges || [];
      this._ensureThumbs();
      this.draw();
    }

  getData() {
      return {
        scenes: this.scenes.map(s => ({
          id: s.id,
          x: s.x,
          y: s.y,
          title: s.title || 'Сцена',
          description: s.description || '',
          prompt: s.prompt || '',
          preset: s.preset || null,
          configured: s.configured === true,
          last_image: s.last_image || null,
          local_values: s.local_values || {},
        })),
        edges: this.edges.map(e => ({
          id: e.id,
          from: e.from,
          to: e.to,
          label: e.label || '',
        })),
      };
  }

  addScene(x, y, title = 'Новая сцена') {
      const id = 'scene_' + Math.random().toString(36).slice(2, 10);
      const scene = {
        id, x, y, title,
        description: '',
        prompt: '',
        preset: null,
        configured: false,
        last_image: null,
      };
      this.scenes.push(scene);
      this.selectedId = id;
      this.draw();
      this._emitChange();
      return scene;
    }

  removeScene(id) {
    this.scenes = this.scenes.filter(s => s.id !== id);
    this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.draw();
    this._emitChange();
  }

  updateScene(id, patch) {
    const s = this.scenes.find(x => x.id === id);
    if (!s) return;
    Object.assign(s, patch);
    this._ensureThumbs();
    this.draw();
    this._emitChange();
  }

  getScene(id) {
    return this.scenes.find(s => s.id === id) || null;
  }

  addEdge(from, to, label = '') {
    if (from === to) return null;
    if (this.edges.some(e => e.from === from && e.to === to)) return null;
    const id = 'edge_' + Math.random().toString(36).slice(2, 8);
    this.edges.push({ id, from, to, label });
    this.draw();
    this._emitChange();
    return id;
  }

  centerView() {
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;
    this.draw();
  }

  // ---------- Внутреннее ----------

  _emitChange() {
    if (this.callbacks.onChange) this.callbacks.onChange();
  }

  _resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.draw();
  }

  _screenToWorld(sx, sy) {
    return {
      x: (sx - this.panX) / this.scale,
      y: (sy - this.panY) / this.scale,
    };
  }

  _hitNode(wx, wy) {
    for (let i = this.scenes.length - 1; i >= 0; i--) {
      const s = this.scenes[i];
      const d = Math.hypot(s.x - wx, s.y - wy);
      if (d < NODE_RADIUS) return s;
    }
    return null;
  }

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('mousedown', (e) => this._onDown(e));
    window.addEventListener('mousemove', (e) => this._onMove(e));
    window.addEventListener('mouseup', (e) => this._onUp(e));
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    c.addEventListener('dblclick', (e) => this._onDblClick(e));
    window.addEventListener('keydown', (e) => this._onKeyDown(e));

    // Контекстное меню отключаем на canvas — ПКМ не нужен
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _getLocal(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onDown(e) {
    const { x: sx, y: sy } = this._getLocal(e);
    const world = this._screenToWorld(sx, sy);

    if (e.button === 0 && e.shiftKey) {
      const node = this._hitNode(world.x, world.y);
      if (node) {
        this.isDrawingEdge = node.id;
        this.tempEdge = { fromId: node.id, x: world.x, y: world.y };
        this.draw();
        return;
      }
    }

    if (e.button === 0) {
      const node = this._hitNode(world.x, world.y);
      if (node) {
        this.selectedId = node.id;
        this.isDraggingNode = node.id;
        this.draggingState = {
          offsetX: node.x - world.x,
          offsetY: node.y - world.y,
        };
        this.draw();
        return;
      }
    }

    // Пустое место — панорамирование
    if (e.button === 0) {
      this.selectedId = null;
      this.isPanning = true;
      this.draggingState = {
        startX: sx,
        startY: sy,
        panStartX: this.panX,
        panStartY: this.panY,
      };
      this.draw();
    }
  }

  _onMove(e) {
    const { x: sx, y: sy } = this._getLocal(e);
    const world = this._screenToWorld(sx, sy);

    if (this.isDrawingEdge) {
      this.tempEdge.x = world.x;
      this.tempEdge.y = world.y;
      this.draw();
      return;
    }

    if (this.isDraggingNode) {
      const node = this.scenes.find(s => s.id === this.isDraggingNode);
      if (node) {
        node.x = world.x + this.draggingState.offsetX;
        node.y = world.y + this.draggingState.offsetY;
        this.draw();
      }
      return;
    }

    if (this.isPanning) {
      this.panX = this.draggingState.panStartX + (sx - this.draggingState.startX);
      this.panY = this.draggingState.panStartY + (sy - this.draggingState.startY);
      this.draw();
    }
  }

  _onUp(e) {
    if (this.isDrawingEdge) {
      const { x: sx, y: sy } = this._getLocal(e);
      const world = this._screenToWorld(sx, sy);
      const target = this._hitNode(world.x, world.y);

      if (target) {
        this.addEdge(this.isDrawingEdge, target.id);
      } else if (this.callbacks.onCreateScene) {
        // Shift+drag в пустоту → создать узел и связь
        const fromId = this.isDrawingEdge;
        const newScene = this.addScene(world.x, world.y);
        this.addEdge(fromId, newScene.id);
        this.callbacks.onCreateScene(newScene);
      }

      this.isDrawingEdge = null;
      this.tempEdge = null;
      this.draw();
    }

    if (this.isDraggingNode) {
      this.isDraggingNode = null;
      this.draggingState = null;
      this._emitChange();  // сохраняем после перетаскивания
    }

    if (this.isPanning) {
      this.isPanning = false;
      this.draggingState = null;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const { x: sx, y: sy } = this._getLocal(e);
    const before = this._screenToWorld(sx, sy);

    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    this.scale = Math.max(0.3, Math.min(3.0, this.scale * factor));

    const after = this._screenToWorld(sx, sy);
    this.panX += (after.x - before.x) * this.scale;
    this.panY += (after.y - before.y) * this.scale;

    this.draw();
  }

  _onDblClick(e) {
    const { x: sx, y: sy } = this._getLocal(e);
    const world = this._screenToWorld(sx, sy);

    const node = this._hitNode(world.x, world.y);
    if (node) {
      if (this.callbacks.onOpenScene) this.callbacks.onOpenScene(node.id);
      return;
    }

    // Двойной клик по пустому месту — создать сцену
    this.addScene(world.x, world.y);
  }

  _onKeyDown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Игнорируем, если в фокусе input/textarea
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (this.selectedId) {
        if (confirm('Удалить сцену?')) {
          this.removeScene(this.selectedId);
        }
        e.preventDefault();
      }
    }
  }

  // ---------- Отрисовка ----------

  draw() {
    const ctx = this.ctx;
    const W = this.cssWidth;
    const H = this.cssHeight;

    ctx.save();
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    this._drawGrid(ctx);

    // Рёбра
    for (const edge of this.edges) {
      this._drawEdge(ctx, edge);
    }

    // Временная линия при Shift+drag
    if (this.isDrawingEdge && this.tempEdge) {
      const from = this.scenes.find(s => s.id === this.tempEdge.fromId);
      if (from) {
        ctx.save();
        ctx.strokeStyle = '#ffaa66';
        ctx.setLineDash([6 / this.scale, 6 / this.scale]);
        ctx.lineWidth = 2 / this.scale;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(this.tempEdge.x, this.tempEdge.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Узлы
    for (const scene of this.scenes) {
      this._drawNode(ctx, scene);
    }

    ctx.restore();
  }

  _drawGrid(ctx) {
    const gridSize = 100;
    const startX = -this.panX / this.scale;
    const startY = -this.panY / this.scale;
    const endX = startX + this.cssWidth / this.scale;
    const endY = startY + this.cssHeight / this.scale;

    ctx.save();
    ctx.strokeStyle = '#252525';
    ctx.lineWidth = 1 / this.scale;
    for (let x = Math.floor(startX / gridSize) * gridSize; x <= endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }
    for (let y = Math.floor(startY / gridSize) * gridSize; y <= endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  _ensureThumbs() {
    for (const scene of this.scenes) {
      if (scene.last_image && scene.last_image.history_id) {
        const url = `/api/projects/${encodeURIComponent(this.projectName || '')}/scenes/${encodeURIComponent(scene.id)}/history/${encodeURIComponent(scene.last_image.history_id)}/image`;
        if (!scene._thumbCache || scene._thumbCache.src !== url) {
          const img = new Image();
          img.onload = () => this.draw();
          img.src = url;
          scene._thumbCache = img;
        }
      }
    }
  }

  _drawNode(ctx, scene) {
    const isSelected = scene.id === this.selectedId;
    const hasImage = scene.last_image && scene.last_image.history_id;

    if (hasImage) {
      // Прямоугольник с превью.
      // Пропорции — из last_image (как было при генерации),
      // а не из текущих local_values (их могли поменять).
      const li = scene.last_image || {};
      const w = li.width || 1152;
      const h = li.height || 896;

      let cardW, cardH;
      if (w > h) { cardW = 120; cardH = 90; }
      else if (w < h) { cardW = 90; cardH = 120; }
      else { cardW = 120; cardH = 120; }

      const x0 = scene.x - cardW / 2;
      const y0 = scene.y - cardH / 2;

      // Фон
      ctx.save();
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(x0, y0, cardW, cardH);

      // Превью (если закешировано)
      if (scene._thumbCache && scene._thumbCache.complete && scene._thumbCache.naturalWidth > 0) {
        ctx.drawImage(scene._thumbCache, x0, y0, cardW, cardH);
      }

      // Рамка
      ctx.strokeStyle = isSelected ? '#4a8aca' : '#4a4a5a';
      ctx.lineWidth = (isSelected ? 3 : 2) / this.scale;
      ctx.strokeRect(x0, y0, cardW, cardH);

      // Название снизу
      ctx.font = `${10 / this.scale}px 'Segoe UI', sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const title = scene.title || 'Сцена';
      const maxLen = 16;
      const display = title.length > maxLen ? title.slice(0, maxLen - 1) + '…' : title;
      ctx.fillText(display, scene.x, y0 + cardH + 4 / this.scale);

      ctx.restore();
    } else {
      // Круг с названием
      ctx.save();
      ctx.beginPath();
      ctx.arc(scene.x, scene.y, NODE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#2d4a6a' : '#2a2a38';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#4a8aca' : '#4a4a5a';
      ctx.lineWidth = (isSelected ? 3 : 2) / this.scale;
      ctx.stroke();

      ctx.font = `${12 / this.scale}px 'Segoe UI', sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const title = scene.title || 'Сцена';
      const maxLen = 14;
      const display = title.length > maxLen ? title.slice(0, maxLen - 1) + '…' : title;
      ctx.fillText(display, scene.x, scene.y);
      ctx.restore();
    }
  }

  _drawEdge(ctx, edge) {
    const from = this.scenes.find(s => s.id === edge.from);
    const to = this.scenes.find(s => s.id === edge.to);
    if (!from || !to) return;

    // Считаем точки на границе окружностей, чтобы стрелка не залезала внутрь
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;

    const ux = dx / len;
    const uy = dy / len;
    const x1 = from.x + ux * NODE_RADIUS;
    const y1 = from.y + uy * NODE_RADIUS;
    const x2 = to.x - ux * (NODE_RADIUS + 4);
    const y2 = to.y - uy * (NODE_RADIUS + 4);

    ctx.save();
    ctx.strokeStyle = '#4a4a5a';
    ctx.lineWidth = 2 / this.scale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Стрелка
    const angle = Math.atan2(uy, ux);
    const arrowSize = 10 / this.scale;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - arrowSize * Math.cos(angle - Math.PI / 6),
      y2 - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      x2 - arrowSize * Math.cos(angle + Math.PI / 6),
      y2 - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = '#4a4a5a';
    ctx.fill();

    // Подпись связи
    if (edge.label) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      ctx.font = `${11 / this.scale}px 'Segoe UI', sans-serif`;
      ctx.fillStyle = '#888';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const padding = 4 / this.scale;
      const metrics = ctx.measureText(edge.label);
      const tw = metrics.width;
      const th = 14 / this.scale;

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(mx - tw / 2 - padding, my - th / 2, tw + padding * 2, th);

      ctx.fillStyle = '#888';
      ctx.fillText(edge.label, mx, my);
    }

    ctx.restore();
  }
}
