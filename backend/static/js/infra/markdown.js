/**
 * Минимальный Markdown для чата: bold, italic, inline code, code block.
 *
 * Принцип: сначала экранируем HTML, потом применяем regex.
 * Так LLM не может протащить <script> или что-то подобное.
 *
 * Порядок применения важен:
 *   1. code block (```...```) — до инлайн-кода
 *   2. inline code (`...`)
 *   3. bold (**text**)
 *   4. italic (*text*) — после bold, иначе *bold* попытается съесть **
 */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMarkdownLite(text) {
  if (!text) return '';

  let s = escapeHtml(text);

  // 1. Code blocks: ```...``` (многострочные, ленивое совпадение)
  s = s.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre class="md-code-block">${code.replace(/^\n/, '')}</pre>`;
  });

  // 2. Inline code: `...` (не трогаем уже обёрнутое в <pre>)
  s = s.replace(/`([^`\n]+)`/g, '<code class="md-code-inline">$1</code>');

  // 3. Bold: **text** или __text__
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');

  // 4. Italic: *text* или _text_ (с защитой от жадного совпадения с bold)
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');

  return s;
}
