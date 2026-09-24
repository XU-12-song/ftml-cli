/**
 * preview.js — 文件落盘与 iframe 预览渲染
 *
 * render/validate/deploy/revert 都从磁盘读，因此渲染前必须先把编辑器内容存盘。
 */
import { el, state } from './dom.js';
import { api, setError, setStatus, fmtTime } from './api.js';
import { showDiagnostics, includeSummary } from './ui.js';

export async function saveFile(relPath, source) {
  await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/save`, { path: relPath, source });
}

/** 把编辑器当前内容落盘（render/validate/deploy/revert 都从磁盘读，必须先存） */
export async function persistEditor() {
  if (!state.projectId || !state.filePath) return;
  await saveFile(state.filePath, el.editor.value);
}

// 保存上一次的 blob URL，方便 revoke
let currentPreviewUrl = null;

export async function render() {
  if (!state.projectId || !state.filePath) return;
  try {
    await persistEditor();
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/render`, {
      path: state.filePath,
      site: el.siteInput.value.trim() || undefined,
      page: el.pageInput.value.trim() || undefined,
    });

    // 用 Blob URL 代替 srcdoc，让 #fragment 能在 iframe 内部正确解析
    const blob = new Blob([r.html], { type: 'text/html;charset=utf-8' });
    const nextUrl = URL.createObjectURL(blob);

    // 释放上一个 URL（此时旧文档已卸载，安全）
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);

    // load 后再 revoke 也可以，但 unload 后 revoke 更保险：
    // 浏览器已经把文档加载进内存，revoke 不影响已加载页面的内部导航
    el.preview.addEventListener('load', () => {
      URL.revokeObjectURL(nextUrl);
      if (currentPreviewUrl === nextUrl) currentPreviewUrl = null;
    }, { once: true });

    currentPreviewUrl = nextUrl;
    el.preview.removeAttribute('srcdoc');   // 防止残留 srcdoc 覆盖
    el.preview.src = nextUrl;

    state.lastIncludes = r.includes || [];
    showDiagnostics(r.diagnostics || []);
    setStatus(`已保存并渲染（${fmtTime()}）${includeSummary()}`);
  } catch (e) {
    setError(e.message);
  }
}

export function scheduleSaveRender() {
  clearTimeout(state.saveTimer);
  if (!state.settings.autoPreview) return; // 关闭自动预览：仍可用保存按钮/Ctrl+S
  state.saveTimer = setTimeout(render, state.settings.previewIntervalMs);
}
