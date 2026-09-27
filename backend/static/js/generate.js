import { state } from './state.js';
import { $, setStatus, setProgress, showPreview, setApplied } from './ui.js';
import { submitGeneration, watchGeneration, formatApplied } from './comfy.js';

/**
 * Получить seed: либо из поля ввода, либо случайный.
 */
function pickSeed() {
  const v = $('seed').value.trim();
  if (!v) return Math.floor(Math.random() * 2147483647);
  return parseInt(v, 10);
}

/**
 * Основная функция генерации.
 */
export async function generate() {
  const btn = $('btnGenerate');

  btn.disabled = true;
  setProgress(0);
  showPreview('генерация...');
  setApplied('');

  const values = {
    prompt: $('prompt').value,
    negative: state.workflowConfig.negative,
    seed: pickSeed(),
    steps: state.workflowConfig.steps,
    cfg: state.workflowConfig.cfg,
    shift: state.workflowConfig.shift,
    width: state.workflowConfig.width,
    height: state.workflowConfig.height,
    lora_name: state.workflowConfig.lora_name,
    lora_strength: state.workflowConfig.lora_strength,
    filename_prefix: `storyboard\\test_${Date.now()}_`,
  };

  setStatus('отправка в ComfyUI...');

  let resp;
  try {
    resp = await submitGeneration(values);
  } catch (e) {
    setStatus('Ошибка бэкенда: ' + e.message, true);
    showPreview('ошибка');
    btn.disabled = false;
    return;
  }

  const {prompt_id, client_id, applied, skipped} = resp;
  setStatus(`prompt_id: ${prompt_id.slice(0, 8)}...`);
  setApplied(formatApplied(applied, skipped));

  watchGeneration(
    client_id,
    prompt_id,
    () => { btn.disabled = false; },
    () => { btn.disabled = false; },
  );
}
