/**
 * layout.js — 视图布局：移动端侧边栏抽屉、上下分栏、编辑/预览分隔条、禅模式
 *
 * 分隔条：
 *   - 左右布局：横向拖动（↔ / col-resize）
 *   - 上下布局：纵向拖动（↕ / row-resize）
 *   - 方向键微调（Shift 加速），双击恢复 50%
 *   - 两种布局各自记忆比例（localStorage）
 *
 * 禅模式（zen）：只保留编辑区与预览，隐藏顶栏/侧边栏/状态栏。
 */
import { $, el } from './dom.js';

/** 当前是否处于禅模式（与 body.zen 保持同步） */
let zen = false;

/** 切换禅模式：只保留编辑区与预览 */
export function toggleZen() {
  setZen(!zen);
}

function setZen(on) {
  zen = on;
  document.body.classList.toggle('zen', on);
  el.zenExit?.classList.toggle('hidden', !on);
  if (!on) {
    // 退出后把焦点还给编辑器，方便继续输入
    el.editor?.focus();
  }
}

/* ------------------------------------------------------------------ *
 * 编辑区 / 预览分隔条
 * ------------------------------------------------------------------ */

const SPLIT_MIN_PX = 180;
const SPLIT_STEP = 0.02;
const SPLIT_STEP_FAST = 0.1;

let mainEl = null;
let splitterEl = null;
let axis = 'x';       // x = 左右布局；y = 上下布局
let ratio = 0.5;      // 编辑区占比
let dragging = false;

function splitKey() {
  return `ftml-split-${axis}`;
}

function isStacked() {
  return !!mainEl && getComputedStyle(mainEl).flexDirection === 'column';
}

function clampRatio(value) {
  const size = axis === 'x' ? mainEl?.clientWidth : mainEl?.clientHeight;
  const min = size > 0 ? Math.min(0.45, SPLIT_MIN_PX / size) : 0.12;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(min, Math.min(1 - min, n));
}

function setRatio(value, { persist = false } = {}) {
  if (!mainEl || !splitterEl) return;
  ratio = clampRatio(value);
  mainEl.style.setProperty('--editor-grow', String(ratio));
  mainEl.style.setProperty('--preview-grow', String(1 - ratio));
  splitterEl.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  if (persist) {
    try { localStorage.setItem(splitKey(), ratio.toFixed(4)); } catch { /* 忽略 */ }
  }
}

/** 根据当前 flex 方向更新分隔条轴向、光标与记忆比例 */
function applySplitAxis() {
  if (!mainEl || !splitterEl) return;
  axis = isStacked() ? 'y' : 'x';
  splitterEl.dataset.axis = axis;
  splitterEl.setAttribute('aria-orientation', axis === 'y' ? 'horizontal' : 'vertical');
  splitterEl.setAttribute('aria-valuemin', '12');
  splitterEl.setAttribute('aria-valuemax', '88');

  let saved = NaN;
  try { saved = Number(localStorage.getItem(splitKey())); } catch { /* 忽略 */ }
  setRatio(Number.isFinite(saved) && saved > 0 && saved < 1 ? saved : 0.5);
}

function ratioFromPointer(e) {
  const rect = mainEl.getBoundingClientRect();
  const srect = splitterEl.getBoundingClientRect();
  const total = axis === 'x'
    ? rect.width - srect.width
    : rect.height - srect.height;
  if (total <= 0) return 0.5;
  const pos = axis === 'x'
    ? e.clientX - rect.left - srect.width / 2
    : e.clientY - rect.top - srect.height / 2;
  return pos / total;
}

function startDrag(e) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  dragging = true;
  splitterEl.classList.add('dragging');
  mainEl.classList.add('resizing');
  document.body.classList.add(axis === 'x' ? 'split-resizing-x' : 'split-resizing-y');
  try { splitterEl.setPointerCapture?.(e.pointerId); } catch { /* 忽略 */ }
  setRatio(ratioFromPointer(e));
}

function moveDrag(e) {
  if (!dragging) return;
  e.preventDefault();
  setRatio(ratioFromPointer(e));
}

function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  splitterEl.classList.remove('dragging');
  mainEl.classList.remove('resizing');
  document.body.classList.remove('split-resizing-x', 'split-resizing-y');
  try { splitterEl.releasePointerCapture?.(e.pointerId); } catch { /* 忽略 */ }
  setRatio(ratio, { persist: true });
}

function onSplitterKey(e) {
  const step = e.shiftKey ? SPLIT_STEP_FAST : SPLIT_STEP;
  let next = ratio;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = 1;
  else if (axis === 'x' && e.key === 'ArrowLeft') next -= step;
  else if (axis === 'x' && e.key === 'ArrowRight') next += step;
  else if (axis === 'y' && e.key === 'ArrowUp') next -= step;
  else if (axis === 'y' && e.key === 'ArrowDown') next += step;
  else return;

  e.preventDefault();
  setRatio(next, { persist: true });
}

function initSplitter() {
  mainEl = $('main');
  splitterEl = $('splitter');
  if (!mainEl || !splitterEl) return;

  splitterEl.addEventListener('pointerdown', startDrag);
  splitterEl.addEventListener('pointermove', moveDrag);
  splitterEl.addEventListener('pointerup', endDrag);
  splitterEl.addEventListener('pointercancel', endDrag);
  splitterEl.addEventListener('lostpointercapture', endDrag);
  // 指针在窗口外释放 / 窗口失焦时也要结束拖动，避免 cursor 与 pointer-events 卡住
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', () => endDrag({}));
  splitterEl.addEventListener('keydown', onSplitterKey);
  splitterEl.addEventListener('dblclick', () => setRatio(0.5, { persist: true }));

  // 窗口尺寸变化后重新收敛最小比例；布局切换由 toggleLayout 负责
  window.addEventListener('resize', () => setRatio(ratio));
  window.matchMedia?.('(max-width: 768px)')?.addEventListener?.('change', applySplitAxis);

  applySplitAxis();
}

/** 切换编辑器/预览的左右与上下布局 */
export function toggleLayout() {
  $('main').classList.toggle('layout-bottom');
  applySplitAxis();
}

export function initLayout() {
  const menuToggle = $('menu-toggle');
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  const layoutToggle = $('layout-toggle');

  const closeDrawer = () => {
    sidebar.classList.remove('open');
    overlay.classList.add('hidden');
  };

  menuToggle?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('hidden');
  });
  overlay?.addEventListener('click', closeDrawer);

  layoutToggle?.addEventListener('click', toggleLayout);

  // ---- 编辑/预览分隔条 ----
  initSplitter();

  // ---- 禅模式 ----
  el.zenBtn?.addEventListener('click', () => {
    closeDrawer(); // 移动端：进禅模式时收起抽屉
    setZen(true);
  });
  el.zenExit?.addEventListener('click', () => setZen(false));

  // Ctrl+Shift+F 切禅由 keymap.js 统一派发；这里只管 Esc 退出
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && zen) setZen(false);
  });
}
