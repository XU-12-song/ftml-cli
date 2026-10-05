/**
 * target.js — 部署目标页面（站点 / 页面）：状态栏指示器 + 设置对话框
 *
 * 输入框沿用 id `site-input` / `page-input`，只是从顶栏移入对话框，
 * 因此 preview.js / versions.js 里对 el.siteInput / el.pageInput 的引用无需改动。
 */
import { el, state } from './dom.js';
import { api, setError, setStatus, fmtTime } from './api.js';

/** 每个「项目 + 文件」各记一份目标，存 localStorage */
export function targetKey() {
  return `ftml:target:${state.projectId}:${state.filePath}`;
}

/** 打开文件时恢复该文件记住的目标页面，并刷新状态栏指示器 */
export function applyStoredTarget() {
  const raw = localStorage.getItem(targetKey());
  if (raw) {
    try {
      const { site, page } = JSON.parse(raw);
      if (site) el.siteInput.value = site;
      if (page) el.pageInput.value = page;
    } catch { /* 记录损坏则忽略 */ }
  }
  refreshTargetIndicator();
}

/** 状态栏右侧：镜像当前站点 / 页面；未设置时为灰色提示 */
export function refreshTargetIndicator() {
  const site = el.siteInput.value.trim();
  const page = el.pageInput.value.trim();
  if (site && page) {
    el.targetIndicator.textContent = `${site} / ${page}`;
    el.targetIndicator.classList.add('set');
  } else if (site || page) {
    el.targetIndicator.textContent = `${site || '…'} / ${page || '…'}`;
    el.targetIndicator.classList.add('set');
  } else {
    el.targetIndicator.textContent = '未设目标';
    el.targetIndicator.classList.remove('set');
  }
}

export function openTargetDialog() {
  if (!state.projectId || !state.filePath) {
    setError('请先打开一个文件');
    return;
  }
  el.targetDialog.showModal();
  el.siteInput.focus();
}

export async function saveTarget() {
  if (!state.projectId || !state.filePath) return;
  const site = el.siteInput.value.trim();
  const page = el.pageInput.value.trim();
  try {
    await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/target`, {
      path: state.filePath, site, page,
    });
    if (site || page) localStorage.setItem(targetKey(), JSON.stringify({ site, page }));
    refreshTargetIndicator();
    el.targetDialog.close();
    setStatus(`目标页面已保存（${fmtTime()}）`);
  } catch (e) {
    setError(e.message);
  }
}

export function initTarget() {
  el.targetIndicator?.addEventListener('click', openTargetDialog);
  el.targetSaveBtn?.addEventListener('click', saveTarget);
  // 输入即时镜像到状态栏，关闭对话框也不丢
  el.siteInput?.addEventListener('input', refreshTargetIndicator);
  el.pageInput?.addEventListener('input', refreshTargetIndicator);
}
