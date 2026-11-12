/**
 * toast.js — 非阻塞提示
 *
 * 用于网络抓取失败这类不该打断编辑、也不该占用状态栏的错误。
 * 同一 key 在本次页面会话内只提示一次，避免自动预览反复触发。
 */
import { el } from './dom.js';

const seen = new Set();
const DEFAULT_TIMEOUT_MS = 12000;

function dismiss(node) {
  if (!node.isConnected) return;
  node.classList.add('toast-out');
  setTimeout(() => node.remove(), 180);
}

/** 每会话只显示一次；key 建议用「类型 + 站点」 */
export function showToastOnce(key, message, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  if (!el.toastContainer || seen.has(key)) return;
  seen.add(key);

  const node = document.createElement('div');
  node.className = 'toast toast-warn';
  node.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', '关闭提示');
  close.textContent = '×';
  close.addEventListener('click', () => dismiss(node));

  node.append(text, close);
  el.toastContainer.appendChild(node);

  if (timeout > 0) setTimeout(() => dismiss(node), timeout);
}
