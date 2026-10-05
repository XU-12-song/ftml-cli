/**
 * layout.js — 视图布局：移动端侧边栏抽屉、上下分栏、禅模式
 *
 * 禅模式（zen）：只保留编辑区与预览，隐藏顶栏/侧边栏/状态栏。
 *   进入：顶栏「禅」按钮（移动端）或 Ctrl+Shift+F（桌面端）
 *   退出：浮动「退出禅模式」按钮 或 Esc
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

/** 切换编辑器/预览的左右与上下布局 */
export function toggleLayout() {
  $('main').classList.toggle('layout-bottom');
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
