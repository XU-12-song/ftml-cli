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
}

export function initProjects() {
  el.projectSelect.addEventListener('change', () => {
    state.projectId = el.projectSelect.value || null;
    state.filePath = null;
    el.fileSelect.value = '';
    if (state.projectId) {
      refreshSidebar();
      clearEditor();
    } else {
      clearEditor();
    }
  });

  // 顶栏控件已移除，以下动作函数统一由命令面板（Ctrl+K）调用
}

/** 添加已有项目：输入目录绝对路径 */
export async function openAddProject() {
  const root = await openNameDialog('添加项目（输入目录绝对路径）', '', '添加');
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

/** 新建 ftml 仓库（~/.ftml-cli/projects/<名称>） */
export async function openNewRepo() {
  const name = await openNameDialog('新建 ftml 仓库（建在 ~/.ftml-cli/projects 分区）', '仓库名（如 my-scp-page）', '创建');
  if (!name) return;
  try {
    setStatus('创建仓库…');
    const r = await api('POST', '/api/projects/create', { name });
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
