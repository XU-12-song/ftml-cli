/**
 * projects.js — 项目注册表：列表 / 添加 / git 初始化 / 新建 ftml 仓库
 */
import { el, state } from './dom.js';
import { api, setError, setStatus, fmtTime, showLog } from './api.js';
import { openNameDialog } from './dialogs.js';
import { refreshSidebar, clearEditor } from './editor.js';

export async function loadProjects() {
  try {
    state.projects = await api('GET', '/api/projects');
  } catch (e) {
    state.projects = [];
    setError(`加载项目失败: ${e.message}`);
  }
  el.projectSelect.innerHTML = '';
  if (state.projects.length === 0) {
    el.projectSelect.appendChild(new Option('（无项目，添加…）', ''));
  }
  for (const p of state.projects) {
    el.projectSelect.appendChild(new Option(p.name, p.id));
  }
  if (state.projectId && state.projects.some((p) => p.id === state.projectId)) {
    el.projectSelect.value = state.projectId;
  } else {
    el.projectSelect.value = '';
    state.projectId = null;
    state.filePath = null;
  }
  // 桌面版：同步托盘「最近项目」菜单
  window.ftmlDesktop?.projectsChanged?.();
}

export function initProjects() {
  el.projectSelect.addEventListener('change', () => {
    state.projectId = el.projectSelect.value || null;
    state.filePath = null;
    el.fileSelect.value = '';
    clearEditor();

    // 没有项目时下拉只有「（无项目，添加…）」占位项：直接进入添加流程
    if (!state.projectId) {
      openAddProject();
      return;
    }
    refreshSidebar();
  });

  // 顶栏控件已移除，以下动作函数统一由命令面板（Ctrl+K）调用
}

/** 添加已有项目：桌面版用原生目录选择，浏览器版输入绝对路径 */
export async function openAddProject() {
  const bridge = window.ftmlDesktop;
  const root = bridge?.pickDirectory
    ? await bridge.pickDirectory({ title: '添加 ftml 项目' })
    : await openNameDialog('添加项目（输入目录绝对路径）', '', '添加');
  if (!root) return;
  try {
    await api('POST', '/api/projects', { root });
    await loadProjects();
    const p = state.projects.find((x) => x.root === root || x.id === root);
    if (p) {
      state.projectId = p.id;
      el.projectSelect.value = p.id;
      await refreshSidebar();
    }
  } catch (e) {
    setError(e.message);
  }
}

/** 从工作区列表移除当前项目（仅取消注册，不删除任何文件） */
export async function removeCurrentProject() {
  if (!state.projectId) return;
  const current = state.projects.find((p) => p.id === state.projectId);
  const name = current?.name || state.projectId;
  if (!confirm(`从工作区列表移除「${name}」？\n不会删除任何文件。`)) return;

  try {
    await api('DELETE', `/api/projects/${encodeURIComponent(state.projectId)}`);
    state.projectId = null;
    state.filePath = null;
    clearEditor();
    await loadProjects();

    // 自动切到剩余的第一个项目；没有则停在空状态
    if (state.projects.length) {
      const next = state.projects[0];
      state.projectId = next.id;
      el.projectSelect.value = next.id;
      await refreshSidebar();
    }
    setStatus(`已从工作区移除 ${name}`);
  } catch (e) {
    setError(e.message);
  }
}

/** 在当前目录初始化 git 项目 */
export async function initGitProject() {
  if (!state.projectId) return;
  try {
    setStatus('初始化项目…');
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/init`);
    await refreshSidebar();
    showLog('ftml init', r.logs);
    setStatus(`已初始化（${fmtTime()}）`);
  } catch (e) {
    setError(e.message);
  }
}

/** 新建 ftml 仓库（默认 ~/.ftml-cli/projects/<名称>；桌面版可选父目录） */
export async function openNewRepo() {
  const name = await openNameDialog('新建 ftml 仓库（建在 ~/.ftml-cli/projects 分区）', '仓库名（如 my-scp-page）', '创建');
  if (!name) return;

  // 桌面版允许用原生选择器改父目录；取消则保持默认分区
  let parent = null;
  if (window.ftmlDesktop?.pickDirectory) {
    parent = await window.ftmlDesktop.pickDirectory({
      title: '选择新仓库的父目录（取消则使用默认分区）',
    });
  }

  try {
    setStatus('创建仓库…');
    const r = await api('POST', '/api/projects/create', parent ? { name, parent } : { name });
    await loadProjects();
    state.projectId = r.root;
    el.projectSelect.value = r.root;
    showLog('新建仓库', r.logs || []);
    await refreshSidebar();
    setStatus(`已创建仓库 ${r.name}（${r.root}）`);
  } catch (e) {
    setError(e.message);
  }
}
