/**
 * session.js — 上次打开的页面（项目 + 文件）
 *
 * 存在 localStorage，浏览器/桌面版共用；下次启动且没有外部打开目标时自动恢复。
 */

const LAST_OPENED_KEY = 'ftml:last-opened';

/** 打开文件成功后记录；下次启动自动打开 */
export function rememberLastOpened(projectId, filePath) {
  if (!projectId || !filePath) return;
  try {
    localStorage.setItem(LAST_OPENED_KEY, JSON.stringify({ projectId, filePath }));
  } catch { /* 隐私模式/配额不足：忽略 */ }
}

/** 读取上次打开记录；不存在或损坏返回 null */
export function readLastOpened() {
  try {
    const raw = localStorage.getItem(LAST_OPENED_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.projectId !== 'string' || typeof v.filePath !== 'string') return null;
    return { projectId: v.projectId, filePath: v.filePath };
  } catch {
    return null;
  }
}

export function clearLastOpened() {
  try {
    localStorage.removeItem(LAST_OPENED_KEY);
  } catch { /* 忽略 */ }
}
