/**
 * Debounce с возможностью форсировать вызов (flush) или отменить (cancel).
 * Пример:
 *   const save = debounce(() => saveNow(), 800);
 *   input.oninput = save;           // обычный вызов с задержкой
 *   button.onclick = save.flush;    // немедленный вызов, отменив таймер
 */
export function debounce(fn, ms) {
  let timer = null;
  function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, ms);
  }
  debounced.flush = function (...args) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fn.apply(this, args);
  };
  debounced.cancel = function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}
