/**
 * preview.js — 文件落盘与 iframe 预览渲染
 *
 * render/validate/deploy/revert 都从磁盘读，因此渲染前必须先把编辑器内容存盘。
 *
 * 更新策略（热补丁）：预览外壳（43KB 内联 runtime + 两条远程样式表）只在
 * iframe 文档就绪前整篇加载一次。此后每次渲染只向服务端要正文片段
 * （full:false），调用 iframe 内的 window.__ftmlPatch 原地替换 #page-content，
 * 省掉整篇重载的 runtime 重解析与远程样式表重发。外壳不可用（尚未加载完 /
 * 用户点了预览里的链接导航走了）时自动退回整篇重载。
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

/** 预览外壳是否已就绪（同源 Blob 文档，脚本已执行出 __ftmlPatch） */
function previewShellReady() {
  try {
    return typeof el.preview.contentWindow?.__ftmlPatch === 'function';
  } catch {
    return false; // 跨源/未加载：当作不可补丁
  }
}

/** 原地应用片段；返回 false 表示外壳不可用，调用方应退回整篇重载 */
function patchPreview(payload) {
  try {
    return el.preview.contentWindow.__ftmlPatch(payload) !== false;
  } catch {
    return false;
  }
}

/** 整篇重载：Blob URL 代替 srcdoc，让 #fragment 能在 iframe 内部正确解析 */
function loadFullDocument(documentHtml) {
  const blob = new Blob([documentHtml], { type: 'text/html;charset=utf-8' });
  const nextUrl = URL.createObjectURL(blob);

  // 释放上一个 URL（此时旧文档已卸载，安全）
  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);

  el.preview.addEventListener('load', () => {
    URL.revokeObjectURL(nextUrl);
    if (currentPreviewUrl === nextUrl) currentPreviewUrl = null;
  }, { once: true });

  currentPreviewUrl = nextUrl;
  el.preview.removeAttribute('srcdoc');   // 防止残留 srcdoc 覆盖
  el.preview.src = nextUrl;
}

/**
 * 渲染当前文件。
 * @param {{ remote?: boolean, forceFull?: boolean }} [opts]
 *   remote=true 时允许联网解析远程 [[include]]（手动刷新路径）；默认 false：
 *   只解析本地文件 + 磁盘缓存，落盘即预览不再等网络。
 *   forceFull=true 时强制整篇重载（补丁失败后的回退路径）。
 */
export async function render({ remote = false, forceFull = false } = {}) {
  if (!state.projectId || !state.filePath) return;
  // 最新者胜：先取消上一次在飞的渲染，并立刻占住槽位（否则后发者会漏掉它的控制器）
  const ac = new AbortController();
  abortInflightRender();
  state.renderAbort = ac;

  // 外壳就绪 → 只要能补丁的正文片段；否则要完整文档整篇加载
  const wantFull = forceFull || !previewShellReady();

  try {
    await persistEditor(); // 落盘不加 signal：即便本次渲染被取代，最新内容也应写入磁盘
    if (ac.signal.aborted) return;
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/render`, {
      path: state.filePath,
      site: el.siteInput.value.trim() || undefined,
      page: el.pageInput.value.trim() || undefined,
      allowNetwork: remote, // 仅手动刷新联网；自动预览走本地 + 磁盘缓存
      full: wantFull,
    }, { signal: ac.signal });

    if (ac.signal.aborted) return; // 期间又有更新，本次结果作废

    state.lastIncludes = r.includes || [];
    renderProblems(r.problems || []);
    showDiagnostics(r.diagnostics || [], r.diagnosticReport || '', r.problems || []);
    el.editor.setDiagnostics(r.diagnostics || []); // 语义层：结构诊断波浪线

    // 模板展开 / 渲染失败：服务端 html 与 fragment 均为 null，不刷新预览；
    // 问题面板已给出出错行与（映射过的）堆栈，直接弹出
    if (r.html == null && r.fragment == null) {
      const first = (r.problems || [])[0];
      setStatus(`渲染失败：${first?.message ?? '未知错误'}（${fmtTime()}）`);
      openProblems();
      return;
    }

    if (wantFull) {
      loadFullDocument(r.html);
    } else if (!patchPreview({
      html: r.fragment,
      styles: r.styles,
      htmlBlocks: r.htmlBlocks,
      title: r.title,
    })) {
      // 外壳刚好被卸载/导航走：退回整篇重载（forceFull 阻断二次递归）
      await render({ remote, forceFull: true });
      return;
    }

    const misses = (state.lastIncludes || []).filter((i) => i.from === 'miss').length;
    const hint = !remote && misses > 0 ? '（有未命中的远程 include，Ctrl+Shift+R 联网补拉）' : '';
    setStatus(`已保存并渲染（${fmtTime()}）${includeSummary()}${hint}`);
  } catch (e) {
    // 被更新的渲染取代（客户端已中止 / 服务端 409）：静默，交回给后发的那次
    if (isAbortError(e) || e?.superseded || ac.signal.aborted) return;
    setError(e.message);
  } finally {
    if (state.renderAbort === ac) state.renderAbort = null;
  }
}

/** 手动刷新：允许联网解析远程 [[include]]（Ctrl+Shift+R / 工具栏按钮） */
export function renderRemote() {
  clearTimeout(state.saveTimer);
  return render({ remote: true });
}

export function scheduleSaveRender() {
  clearTimeout(state.saveTimer);
  if (!state.settings.autoPreview) return; // 关闭自动预览：仍可用保存按钮/Ctrl+S
  state.saveTimer = setTimeout(render, state.settings.previewIntervalMs);
}
