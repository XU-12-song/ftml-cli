/**
 * theme.js — 配色主题：解析 / 应用 / 持久化 / 顶栏切换
 *
 * 三套配色：
 *   calm  「Calm Docs IDE」浅色纸墨（默认）
 *   dark  「雾蓝夜」
 *   light 「暖纸白」
 * 另支持 auto（跟随系统），供设置面板选择。
 *
 * 生效链路：
 *   1. index.html <head> 的内联脚本先按 localStorage / 系统偏好设置
 *      <html data-theme>，避免首屏闪白/闪黑；
 *   2. initTheme() 读取同一偏好，同步按钮、meta 与 CM6 编辑器；
 *   3. 顶栏按钮按「纸墨 → 深色 → 浅色」循环，立即写入 localStorage
 *      并异步同步服务端 settings（settings.json），换端口/换浏览器后仍可恢复。
 *
 * 主题只影响编辑器外壳；预览 iframe 保留 Wikidot 主题的原样呈现。
 */
import { el, state } from './dom.js';
import { api } from './api.js';

const STORAGE_KEY = 'ftml-theme';
const VALID = new Set(['calm', 'auto', 'dark', 'light']);
const DEFAULT_PREF = 'calm';

const THEME_LABEL = {
  calm: 'Calm Docs IDE',
  dark: '雾蓝夜',
  light: '暖纸白',
};

/** 顶栏按钮的循环顺序：纸墨 → 深色 → 浅色 → 纸墨 */
const THEME_ORDER = ['calm', 'dark', 'light'];

const systemLight = window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null;

/** 偏好 → 实际生效主题（auto 解析为系统当前配色；其余原样返回） */
export function resolveTheme(pref) {
  if (pref === 'calm' || pref === 'light' || pref === 'dark') return pref;
  return systemLight?.matches ? 'light' : 'dark';
}

/** 浅色系主题（calm / light）需要通知 CM6 与原生外壳使用浅色语义 */
export function isLightTheme(theme) {
  return theme === 'calm' || theme === 'light';
}

function nextTheme(effective) {
  const i = THEME_ORDER.indexOf(effective);
  return THEME_ORDER[(i < 0 ? 0 : i + 1) % THEME_ORDER.length];
}

function updateMeta(effective) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const color = effective === 'dark' ? '#171a1f'
    : effective === 'light' ? '#f5f3ef'
      : '#f0eee7';
  meta.setAttribute('content', color);
}

function updateButton(effective) {
  const btn = el.themeBtn;
  if (!btn) return;
  const next = nextTheme(effective);
  btn.title = `切换到${THEME_LABEL[next]}主题`;
  btn.setAttribute('aria-label', `切换到${THEME_LABEL[next]}主题`);
  btn.dataset.theme = effective;
}

/**
 * 应用主题偏好。
 * @param {'calm'|'auto'|'dark'|'light'} pref
 * @param {object} [opts]
 * @param {boolean} [opts.persist=true]     写入 localStorage（用于防闪烁缓存）
 * @param {boolean} [opts.syncServer=true]  异步提交到服务端 settings
 */
export function applyTheme(pref, { persist = true, syncServer = true } = {}) {
  const next = VALID.has(pref) ? pref : DEFAULT_PREF;
  state.settings.theme = next;

  const effective = resolveTheme(next);
  document.documentElement.dataset.theme = effective;
  document.documentElement.dataset.themePref = next;

  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* 隐私模式忽略 */ }
  }
  if (el.settingsTheme) el.settingsTheme.value = next;

  updateMeta(effective);
  updateButton(effective);

  // CM6：换主题只需重配 Compartment，不重建编辑器（保留光标/撤销栈）
  state.editor?.setTheme?.(effective);

  // 桌面版：让 Windows 原生标题栏/菜单跟随应用主题（浏览器模式 no-op）
  window.ftmlDesktop?.setTheme?.(effective);

  if (syncServer) {
    api('POST', '/api/settings', { theme: next }).catch(() => {
      // 同步失败不影响本地体验；下次保存设置会再次带上 theme
    });
  }
}

/** 循环切换配色（命令面板与顶栏按钮共用），返回下一套主题名称 */
export function cycleTheme() {
  const effective = resolveTheme(state.settings.theme);
  const next = nextTheme(effective);
  applyTheme(next);
  return THEME_LABEL[next];
}

/** 启动时接线：读取初始偏好、绑定顶栏按钮与系统主题变化 */
export function initTheme() {
  let pref = document.documentElement.dataset.themePref;
  if (!VALID.has(pref)) {
    try { pref = localStorage.getItem(STORAGE_KEY) || DEFAULT_PREF; } catch { pref = DEFAULT_PREF; }
  }
  // 不重复写 localStorage / 不向服务端回写：设置加载后会再做一次权威同步
  applyTheme(pref, { persist: false, syncServer: false });

  el.themeBtn?.addEventListener('click', () => cycleTheme());

  systemLight?.addEventListener?.('change', () => {
    if (state.settings.theme === 'auto') {
      applyTheme('auto', { persist: false, syncServer: false });
    }
  });
}

export { THEME_LABEL };
