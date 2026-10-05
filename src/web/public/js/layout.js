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

function setZen(on) {
  zen = on;
  document.body.classList.toggle('zen', on);
  el.zenExit?.classList.toggle('hidden', !on);
  if (!on) {
    // 退出后把焦点还给编辑器，方便继续输入
    el.editor?.focus();
  }
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

  layoutToggle?.addEventListener('click', () => {
    $('main').classList.toggle('layout-bottom');
  });

  // ---- 禅模式 ----
  el.zenBtn?.addEventListener('click', () => {
    closeDrawer(); // 移动端：进禅模式时收起抽屉
    setZen(true);
  });
  el.zenExit?.addEventListener('click', () => setZen(false));

  window.addEventListener('keydown', (e) => {
    // Ctrl+Shift+F：切换禅模式（与浏览器/编辑器默认快捷键无冲突）
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      setZen(!zen);
      return;
    }
    // Esc：仅在禅模式下用于退出
    if (e.key === 'Escape' && zen) setZen(false);
  });
}
