/**
 * layout.js — 移动端侧边栏抽屉与上下分栏切换
 */
import { $ } from './dom.js';

export function initLayout() {
  const menuToggle = $('menu-toggle');
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  const layoutToggle = $('layout-toggle');

  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('hidden');
    });
  }
  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.add('hidden');
    });
  }
  if (layoutToggle) {
    layoutToggle.addEventListener('click', () => {
      $('main').classList.toggle('layout-bottom');
    });
  }
}
