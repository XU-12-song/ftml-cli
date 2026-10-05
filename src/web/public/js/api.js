/**
 * api.js — JSON API 封装与状态栏 / 日志弹窗输出
 */
import { el } from './dom.js';

export async function api(method, url, body, { signal } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    Object.assign(err, data); // 保留 superseded 等标记供调用方判断
    throw err;
  }
  return data;
}

/** fetch 被 AbortController 中止时抛出的错误 */
export function isAbortError(e) {
  return e?.name === 'AbortError';
}

export function setError(msg) {
  el.statusError.textContent = msg || '';
}

export function setStatus(msg) {
  el.statusText.textContent = msg;
}

export function fmtTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function showLog(title, logs) {
  el.logDialogTitle.textContent = title;
  el.logContent.innerHTML = '';
  for (const l of logs) {
    const div = document.createElement('div');
    div.className = l.kind === 'error' ? 'log-err' : l.kind === 'warn' ? 'log-warn' : '';
    div.textContent = l.msg;
    el.logContent.appendChild(div);
  }
  el.logDialog.showModal();
}

el.logClose.addEventListener('click', () => el.logDialog.close());
