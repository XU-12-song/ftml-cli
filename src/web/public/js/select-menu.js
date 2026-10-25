/**
 * select-menu.js — 给顶栏原生 <select> 套一层可主题化的下拉浮层
 *
 * 原生 <option> 列表由操作系统绘制，CSS 无法改样式（Windows 上尤其突兀）。
 * 这里保留 <select> 作为数据源与 change 事件源，只在鼠标点开时拦截默认弹层，
 * 用同源 HTML 菜单渲染选项，因此不影响 projects.js / editor.js 里现有的
 * innerHTML / value / addEventListener('change') 逻辑。
 *
 * 交互：
 *   - 鼠标：点击控件开/关；点击选项写入 value 并派发 change
 *   - 键盘：↑/↓/Home/End 移动，Enter/Space 选择，Esc 关闭，Tab 关闭
 *   - 点击外部 / 窗口 resize / 页面滚动 → 关闭
 *   - 触屏设备（(hover: none)）保留原生选择器，体验更好
 */
import { el } from './dom.js';

const useNative = window.matchMedia?.('(hover: none)')?.matches ?? false;

let menu = null;
let ownerSelect = null;
let items = [];       // [{ node, option }]
let activeIndex = -1;

function closeMenu() {
  if (!menu) return;
  menu.remove();
  ownerSelect?.setAttribute('aria-expanded', 'false');
  menu = null;
  ownerSelect = null;
  items = [];
  activeIndex = -1;
}

function setActive(index) {
  if (!items.length) return;
  activeIndex = Math.max(0, Math.min(items.length - 1, index));
  items.forEach((it, i) => it.node.classList.toggle('active', i === activeIndex));
  items[activeIndex].node.scrollIntoView({ block: 'nearest' });
}

function choose(option) {
  if (!ownerSelect || option.disabled) return;
  const select = ownerSelect;
  const changed = select.value !== option.value;
  select.value = option.value;
  closeMenu();
  select.focus();
  // 与原生 select 一致：值未变化不触发 change
  if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
}

function buildOption(option, index) {
  const node = document.createElement('div');
  node.className = 'select-menu-item' + (option.disabled ? ' disabled' : '');
  node.setAttribute('role', 'option');
  node.setAttribute('aria-selected', String(option === ownerSelect.options[ownerSelect.selectedIndex]));
  if (option.disabled) node.setAttribute('aria-disabled', 'true');

  const label = document.createElement('span');
  label.className = 'select-menu-label';
  label.textContent = option.label || option.textContent || '';
  const check = document.createElement('span');
  check.className = 'select-menu-check';
  check.textContent = '✓';
  check.setAttribute('aria-hidden', 'true');
  node.append(label, check);

  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    choose(option);
  });
  node.addEventListener('pointermove', () => {
    if (!items[index]?.node.classList.contains('disabled')) setActive(index);
  });
  return { node, option };
}

function positionMenu(select) {
  const rect = select.getBoundingClientRect();
  menu.style.minWidth = `${Math.max(rect.width, 140)}px`;
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);

  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const gap = 4;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - mw - 8);
  const below = rect.bottom + gap;
  const top = below + mh <= window.innerHeight - 8
    ? below
    : Math.max(8, rect.top - mh - gap);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = 'visible';
}

function openMenu(select) {
  closeMenu();
  ownerSelect = select;

  menu = document.createElement('div');
  menu.className = 'select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', select.getAttribute('aria-label') || '');

  const options = [...select.options].filter((o) => !o.hidden);
  items = [];
  if (options.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'select-menu-item disabled';
    empty.textContent = '（无可选项）';
    menu.appendChild(empty);
  } else {
    options.forEach((option, i) => {
      const it = buildOption(option, i);
      items.push(it);
      menu.appendChild(it.node);
    });
  }

  select.setAttribute('aria-expanded', 'true');
  positionMenu(select);

  const selected = options.findIndex((o) => o === select.options[select.selectedIndex]);
  setActive(selected >= 0 ? selected : 0);
}

function toggle(select) {
  if (ownerSelect === select) closeMenu();
  else openMenu(select);
}

function initOne(select) {
  if (!select) return;
  select.setAttribute('aria-haspopup', 'listbox');
  select.setAttribute('aria-expanded', 'false');

  // 触屏：不拦截，交给系统原生选择器
  if (useNative) return;

  select.addEventListener('mousedown', (e) => {
    // 阻止原生 option 弹层；焦点仍交给 select，便于键盘继续操作
    e.preventDefault();
    select.focus();
    toggle(select);
  });

  select.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (menu) { e.preventDefault(); closeMenu(); }
      return;
    }
    if (!menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu(select);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIndex + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : items.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (items[activeIndex]) choose(items[activeIndex].option);
    } else if (e.key === 'Tab') {
      closeMenu();
    } else if (e.key.length === 1) {
      closeMenu(); // 打字时交回原生 select 的 type-ahead
    }
  });
}

/** 全局接线：两个顶栏下拉 + 关闭时机 */
export function initSelectMenus() {
  initOne(el.projectSelect);
  initOne(el.fileSelect);
  if (useNative) return;

  document.addEventListener('pointerdown', (e) => {
    if (!menu) return;
    if (menu.contains(e.target) || e.target === ownerSelect) return;
    closeMenu();
  }, true);

  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', (e) => {
    if (menu && !menu.contains(e.target)) closeMenu();
  }, true);
  window.addEventListener('blur', closeMenu);
}
