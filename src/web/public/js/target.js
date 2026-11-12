/**
 * target.js — 部署目标页面（站点 / 页面）：状态栏指示器 + 设置对话框
 *
 * site/page 是**项目级**配置，存 `.ftmlrc.json` 等项目配置文件（服务端读写）。
 * 打开项目/切换项目时从项目配置加载；保存时写回项目配置。
 * 输入框沿用 id `site-input` / `page-input`，preview.js / versions.js 直接读取。
 */
import { el, state } from './dom.js';
import { api, setError, setStatus, fmtTime } from './api.js';
import { render } from './preview.js';

function clearInputs() {
  el.siteInput.value = '';
  el.pageInput.value = '';
}

/** 从项目配置加载目标；切换项目时调用，旧请求返回后会被丢弃 */
export async function loadProjectTarget() {
  if (!state.projectId) {
    clearInputs();
    refreshTargetIndicator();
    return;
  }
  const projectId = state.projectId;
  try {
    const r = await api('GET', `/api/projects/${encodeURIComponent(projectId)}/target`);
    if (state.projectId !== projectId) return; // 期间已切换项目
    el.siteInput.value = r.site || '';
    el.pageInput.value = r.page || '';
    refreshTargetIndicator();
  } catch (e) {
    if (state.projectId !== projectId) return;
    clearInputs();
    refreshTargetIndicator();
    setError(`读取目标页面失败: ${e.message}`);
  }
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
  if (!state.projectId) {
    setError('请先选择项目');
    return;
  }
  el.targetDialog.showModal();
  el.siteInput.focus();
}

export async function saveTarget() {
  if (!state.projectId) {
    setError('请先选择项目');
    return;
  }
  const site = el.siteInput.value.trim();
  const page = el.pageInput.value.trim();
  try {
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/target`, {
      site, page,
    });
    // 以服务端规范化后的值为准（空串表示清除）
    el.siteInput.value = r.site || '';
    el.pageInput.value = r.page || '';
    refreshTargetIndicator();
    el.targetDialog.close();
    setStatus(`目标页面已保存到项目配置（${fmtTime()}）`);
    if (state.filePath) await render();
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
