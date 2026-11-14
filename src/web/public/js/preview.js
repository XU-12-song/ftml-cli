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
import { showDiagnostics, includeSummary, renderProblems } from './ui.js';
import { showToastOnce } from './toast.js';

/** 本会话出现过布局/主题网络失败：手动「联网刷新」才需要重试它们 */
let networkRetryNeeded = false;

const PREVIEW_TARGET_KEY = 'ftml-preview-target:';

/** 路径比较（Windows 大小写 / 分隔符不敏感） */
function samePath(a, b) {
  const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** 项目首页：优先根目录 index.ftml，其次任意子目录下的 index.ftml */
function findIndexSource() {
  const sources = state.sources || [];
  return sources.find((s) => s.toLowerCase() === 'index.ftml')
    || sources.find((s) => s.toLowerCase().endsWith('/index.ftml'))
    || null;
}

/** 当前预览目标文件（项目没有 index.ftml 时回退到当前编辑文件） */
export function previewTargetPath() {
  if (state.previewMode === 'follow') return state.filePath || null;
  if (state.previewMode === 'custom') return state.previewPath || state.filePath || null;
  return findIndexSource() || state.filePath || null;
}

/** 每个项目单独记住预览目标，避免切换项目后互相影响 */
let prefLoadedFor = null;
function ensurePreviewTargetPref(projectId) {
  if (prefLoadedFor === projectId) return;
  prefLoadedFor = projectId || null;
  state.previewMode = 'index';
  state.previewPath = null;
  if (!projectId) return;
  try {
    const raw = localStorage.getItem(PREVIEW_TARGET_KEY + projectId);
    const p = raw ? JSON.parse(raw) : null;
    if (p?.mode === 'index' || p?.mode === 'follow' || p?.mode === 'custom') {
      state.previewMode = p.mode;
    }
    if (typeof p?.path === 'string' && p.path) state.previewPath = p.path;
  } catch {
    /* 损坏的偏好直接忽略，使用默认首页 */
  }
}

function savePreviewTargetPref() {
  if (!state.projectId) return;
  try {
    localStorage.setItem(PREVIEW_TARGET_KEY + state.projectId, JSON.stringify({
      mode: state.previewMode,
      path: state.previewPath || undefined,
    }));
  } catch {
    /* localStorage 不可用（隐私模式等）时仅本次会话生效 */
  }
}

/** 刷新预览目标下拉：项目首页 / 跟随当前编辑 / 指定任意源文件 */
export function refreshPreviewTargetOptions() {
  const select = el.previewTarget;
  if (!select) return;
  ensurePreviewTargetPref(state.projectId);

  const sources = state.sources || [];
  const index = findIndexSource();

  if (!state.projectId) {
    select.innerHTML = '';
    select.appendChild(new Option('（无项目）', ''));
    select.disabled = true;
    return;
  }
  select.disabled = sources.length === 0;

  // 记住的指定文件已被删除/改名：回退到项目首页，避免渲染 404
  if (state.previewMode === 'custom'
      && !sources.some((s) => samePath(s, state.previewPath))) {
    state.previewMode = 'index';
    state.previewPath = null;
    savePreviewTargetPref();
  }

  select.innerHTML = '';
  select.appendChild(new Option(index ? `项目首页 · ${index}` : '项目首页（未找到 index.ftml，回退当前文件）', '@index'));
  select.appendChild(new Option('跟随当前编辑文件', '@follow'));
  if (!index) select.options[0].disabled = true;

  for (const src of sources) {
    if (index && samePath(src, index)) continue; // 首页项已代表该文件
    select.appendChild(new Option(src, src));
  }

  if (state.previewMode === 'custom' && state.previewPath) {
    select.value = state.previewPath;
  } else if (state.previewMode === 'follow') {
    select.value = '@follow';
  } else {
    select.value = '@index';
  }
}

/** 预览目标下拉的 change 事件：特殊值 @index / @follow，其余为指定源文件 */
function onPreviewTargetChange() {
  const v = el.previewTarget.value;
  if (v === '@index') setPreviewTarget('index');
  else if (v === '@follow') setPreviewTarget('follow');
  else if (v) setPreviewTarget('custom', v);
}

/** 装配预览工具条（main.js 启动时调用一次） */
export function initPreviewTarget() {
  el.previewTarget?.addEventListener('change', onPreviewTargetChange);
  refreshPreviewTargetOptions();
}

/** 切换预览目标并立即重渲染 */
export function setPreviewTarget(mode, path = null) {
  state.previewMode = mode === 'follow' || mode === 'custom' ? mode : 'index';
  state.previewPath = mode === 'custom' ? path : null;
  savePreviewTargetPref();
  refreshPreviewTargetOptions();
  render();
}


export async function saveFile(relPath, source) {
  await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/save`, { path: relPath, source });
}

/** 把编辑器当前内容落盘（render/validate/deploy/revert 都从磁盘读，必须先存） */
export async function persistEditor() {
  if (!state.projectId || !state.filePath) return;
  await saveFile(state.filePath, el.editor.value);
}

/**
 * 合并两路诊断供编辑器画波浪线：
 *   - diagnostics：@wdprlib 渲染诊断（展开后的文本）
 *   - problems：统一问题列表，含 expand 阶段的 FtmlError（如组件文件读不到）
 * 只保留带 position 的条目；按 code + 位置 + 文案去重。
 */
function mergeDiagnostics(diagnostics, problems) {
  const out = [];
  const seen = new Set();
  for (const d of [...(diagnostics || []), ...(problems || [])]) {
    const s = d?.position?.start;
    if (!s) continue;
    const key = `${d.code ?? ''}|${s.offset ?? `${s.line}:${s.column}`}|${d.message ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
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
 * 站点名归一化（与 src/infra/layout.ts 的 normalizeSiteName 同口径）：
 * 用于比较「当前外壳站点」与输入框，避免 URL 写法导致每次渲染都整篇重载。
 */
export function layoutKey(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return 'scpsandboxcn';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.wikidot\.com$/, '');
  return /^[a-z0-9-]+$/.test(s) ? s : 'scpsandboxcn';
}

/**
 * 渲染预览目标页面（默认项目首页 index.ftml，可切换为当前编辑文件或指定源文件）。
 * @param {{ remote?: boolean, forceFull?: boolean, resolveModules?: boolean, refreshLayout?: boolean }} [opts]
 *   remote=true 时允许联网解析远程 [[include]]（手动刷新路径）；默认 false：
 *   只解析本地文件 + 磁盘缓存，落盘即预览不再等网络。
 *   forceFull=true 时强制整篇重载（补丁失败后的回退路径）。
 *   resolveModules=true 时一次性真实解析 module（命令面板显式触发，不写入 state）。
 *   refreshLayout=true 时显式重抓站点结构与主题（手动重试网络失败）。
 */
export async function render({ remote = false, forceFull = false, resolveModules = false, refreshLayout = false } = {}) {
  const previewPath = previewTargetPath();
  if (!state.projectId || !previewPath) return;
  const previewingCurrent = samePath(previewPath, state.filePath);
  // 最新者胜：先取消上一次在飞的渲染，并立刻占住槽位（否则后发者会漏掉它的控制器）
  const ac = new AbortController();
  abortInflightRender();
  state.renderAbort = ac;

  // 切换目标站点 → 外壳必须整篇重载（结构不同）；服务端布局/主题缓存优先，
  // 只有该站点从没缓存过才会等待联网。其余情况保持「只补丁 #page-content」。
  const siteKey = layoutKey(el.siteInput.value);
  const layoutChanged = state.layoutSite != null && state.layoutSite !== siteKey;
  const wantFull = forceFull || refreshLayout || layoutChanged || !previewShellReady();

  try {
    // 当前编辑内容始终落盘：预览目标可能通过 include 引用正在编辑的组件/模板，
    // 不落盘的话预览看到的仍是旧内容。
    if (state.filePath) await persistEditor();
    if (ac.signal.aborted) return;
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/render`, {
      path: previewPath,
      site: el.siteInput.value.trim() || undefined,
      page: el.pageInput.value.trim() || undefined,
      allowNetwork: remote, // 仅手动刷新联网；自动预览走本地 + 磁盘缓存
      resolveModules,       // 一次性真实解析 module；仅本次请求有效
      refreshLayout,        // 显式重试站点布局/主题网络抓取
      full: wantFull,
    }, { signal: ac.signal });

    if (ac.signal.aborted) return; // 期间又有更新，本次结果作废
    const warnings = r.warnings || [];
    if (warnings.length) {
      networkRetryNeeded = true;
      showRenderWarnings(warnings);
    } else if (refreshLayout && (r.html != null || r.fragment != null)) {
      networkRetryNeeded = false; // 手动重试已恢复（渲染本身失败时保留待重试状态）
    }
    if (r.layoutSite) state.layoutSite = r.layoutSite;

    state.lastIncludes = r.includes || [];
    // 诊断只回填到「正在预览的那个文件」：预览首页/指定文件时，编辑器里可能
    // 开着另一个文件，把目标文件的诊断画到当前文件上会错位。
    if (previewingCurrent) {
      renderProblems(r.problems || []);
      showDiagnostics(r.diagnostics || [], r.diagnosticReport || '', r.problems || []);
      // 语义层波浪线：同时覆盖 wdpr 诊断与 expand 阶段的组件/模板错误
      el.editor.setDiagnostics(mergeDiagnostics(r.diagnostics, r.problems));
    }

    // 模板展开 / 渲染失败：服务端 html 与 fragment 均为 null，不刷新预览；
    // 只在状态栏提示，不自动弹窗打断输入
    if (r.html == null && r.fragment == null) {
      const first = (r.problems || [])[0];
      // 不自动弹问题面板：编辑防抖渲染在输入中途失败时会抢走焦点、打断输入。
      // 下方状态栏仍显示错误数与可点击入口。
      setStatus(`渲染失败：${first?.message ?? '未知错误'}（${fmtTime()}）`);
      setError(`渲染失败：${first?.message ?? '未知错误'}（点击状态栏「渲染」查看问题）`);
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
      await render({ remote, forceFull: true, resolveModules });
      return;
    }

    // 远程请求已发出但没有可用客户端（未登录/凭证失效）：状态栏直接说清楚，
    // 否则只会看到「未命中」，很容易误判成网络问题。
    const noClient = (r.diagnostics || []).some((d) => d.code === 'remote-include-no-client');
    const moduleFallback = resolveModules && r.moduleResolution?.fallback;
    if (moduleFallback) {
      setError('模块真实解析未完全成功：失败项已回退占位数据（详见渲染问题）');
    } else {
      setError(noClient
        ? '远程 include 需要登录 Wikidot：请点击右上角账号按钮登录后重试'
        : '');
    }

    const misses = (state.lastIncludes || []).filter((i) => i.from === 'miss').length;
    const hint = !remote && misses > 0
      ? '（有未命中的远程 include，点顶栏「联网刷新」补拉）'
      : '';
    const moduleNote = resolveModules ? '，模块已真实解析' : '';
    const targetNote = previewingCurrent ? '' : ` · 预览 ${previewPath}`;
    setStatus(`已保存并渲染（${fmtTime()}）${targetNote}${includeSummary()}${moduleNote}${hint}`);
  } catch (e) {
    // 被更新的渲染取代（客户端已中止 / 服务端 409）：静默，交回给后发的那次
    if (isAbortError(e) || e?.superseded || ac.signal.aborted) return;
    setError(e.message);
  } finally {
    if (state.renderAbort === ac) state.renderAbort = null;
  }
}

/** 布局/主题网络失败：渲染已回退，toast 只做说明；同一站点每会话一次 */
function showRenderWarnings(warnings) {
  for (const w of warnings || []) {
    if (!w?.message) continue;
    showToastOnce(`${w.code}:${w.site ?? ''}`, w.message);
  }
}

/** 手动刷新：允许联网解析远程 [[include]]（顶栏「联网刷新」/ Ctrl+Alt+Shift+R） */
export function renderRemote() {
  clearTimeout(state.saveTimer);
  // 仅在出现过布局/主题网络失败时重试；正常刷新 include 不必重抓站点资源。
  return render({ remote: true, refreshLayout: networkRetryNeeded });
}

/**
 * 一次性真实解析 module：联网拉取 ListPages / ListUsers / TagCloud / Rate 数据。
 * 只影响本次渲染；之后任何编辑/自动预览都会回到占位模式。
 */
export async function resolveModulesReal() {
  if (!state.projectId || !state.filePath) return;
  const ok = confirm(
    '真实解析会联网拉取 ListPages / ListUsers / TagCloud / Rate 数据，可能需要较长时间。\n' +
    '仅对本次渲染生效，之后编辑会自动恢复占位数据。是否继续？'
  );
  if (!ok) return;
  clearTimeout(state.saveTimer);
  return render({ remote: true, resolveModules: true });
}

export function scheduleSaveRender() {
  clearTimeout(state.saveTimer);
  if (!state.settings.autoPreview) return; // 关闭自动预览：仍可用保存按钮/Ctrl+S
  state.saveTimer = setTimeout(render, state.settings.previewIntervalMs);
}
