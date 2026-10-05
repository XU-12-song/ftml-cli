/**
 * preview.js — 文件落盘与 iframe 预览渲染
 *
 * render/validate/deploy/revert 都从磁盘读，因此渲染前必须先把编辑器内容存盘。
 */
import { el, state } from './dom.js';
import { api, setError, setStatus, fmtTime, isAbortError } from './api.js';
import { showDiagnostics, includeSummary, renderProblems, openProblems } from './ui.js';

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

/** 中止在飞的渲染请求（结果已过时；也避免服务端继续做无用功） */
function abortInflightRender() {
  state.renderAbort?.abort();
  state.renderAbort = null;
}

export async function render() {
  if (!state.projectId || !state.filePath) return;
  // 最新者胜：先取消上一次在飞的渲染，并立刻占住槽位（否则后发者会漏掉它的控制器）
  const ac = new AbortController();
  abortInflightRender();
  state.renderAbort = ac;

  try {
    await persistEditor(); // 落盘不加 signal：即便本次渲染被取代，最新内容也应写入磁盘
    if (ac.signal.aborted) return;
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/render`, {
      path: state.filePath,
      site: el.siteInput.value.trim() || undefined,
      page: el.pageInput.value.trim() || undefined,
    }, { signal: ac.signal });

    if (ac.signal.aborted) return; // 期间又有更新，本次结果作废

    state.lastIncludes = r.includes || [];
    renderProblems(r.problems || []);
    showDiagnostics(r.diagnostics || [], r.diagnosticReport || '', r.problems || []);
    el.editor.setDiagnostics(r.diagnostics || []); // 语义层：结构诊断波浪线

    // 模板展开 / 渲染失败：服务端返回 html=null，不刷新预览；
    // 问题面板已给出出错行与（映射过的）堆栈，直接弹出
    if (!r.html) {
      const first = (r.problems || [])[0];
      setStatus(`渲染失败：${first?.message ?? '未知错误'}（${fmtTime()}）`);
      openProblems();
      return;
    }

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

    setStatus(`已保存并渲染（${fmtTime()}）${includeSummary()}`);
  } catch (e) {
    // 被更新的渲染取代（客户端已中止 / 服务端 409）：静默，交回给后发的那次
    if (isAbortError(e) || e?.superseded || ac.signal.aborted) return;
    setError(e.message);
  } finally {
    if (state.renderAbort === ac) state.renderAbort = null;
  }
}

export function scheduleSaveRender() {
  clearTimeout(state.saveTimer);
  if (!state.settings.autoPreview) return; // 关闭自动预览：仍可用保存按钮/Ctrl+S
  state.saveTimer = setTimeout(render, state.settings.previewIntervalMs);
}
