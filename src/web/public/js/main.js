/**
 * main.js — ftml web 编辑器前端入口（原生 ESM，零依赖）
 *
 * 状态: 项目列表 / 当前项目 + 源文件 / 模板·组件表（自动补全数据源）
 * 主流程: 编辑 → 防抖（间隔可配）保存 → 渲染 → iframe 刷新预览
 *
 * 功能：
 * - 自定义 snippets：侧边栏增删改，服务端持久化 + Ace .snippets 导入导出
 * - 自动补全：snippets / 组件模板名 / 内置 Wikidot 语法（`[[` 上下文合并候选）
 * - 部署（大版本）/ 版本列表与按版本回退 / 校验 / 保存
 * - 新建 ftml 仓库（服务端 ~/.ftml-cli/projects 分区）
 * - git 环境体检（启动自动检测 + 「环境」按钮看安装/配置提示）
 * - 编辑器设置（自动预览间隔、样式模式、include 联网开关 + 缓存管理）
 *
 * 模块划分：dom（元素/状态）→ api（请求/状态栏）→ ui · dialogs · wiki →
 * preview（保存/渲染）→ completion · editor → 各业务面板（projects / versions /
 * snippets / settings / git / auth）→ layout · main（装配与启动）。
 */
import { el, state } from './dom.js';
import { api, setError } from './api.js';
import { initProjects, loadProjects, openAddProject, removeCurrentProject } from './projects.js';
import { initEditor, refreshSidebar, openFile } from './editor.js';
import { initSnippets, loadSnippets } from './snippets.js';
import { initSettings, loadSettings } from './settings.js';
import { initVersions } from './versions.js';
import { initGit, checkGitEnv } from './git.js';
import { initAuth, refreshAuth } from './auth.js';
import { initLayout } from './layout.js';
import { initTarget } from './target.js';
import { initPalette } from './palette.js';
import { initKeymap } from './keymap.js';
import { initTheme } from './theme.js';
import { initSelectMenus } from './select-menu.js';

/** 规范化路径用于比较（Windows 大小写与分隔符不敏感） */
function samePath(a, b) {
  const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** 读取 Electron 文件关联传入的 ?project=&file=，并立即从地址栏清掉 */
function readOpenTargetFromLocation() {
  const params = new URLSearchParams(location.search);
  const project = params.get('project');
  const file = params.get('file');
  if (params.has('project') || params.has('file') || params.has('ftml_token')) {
    params.delete('project');
    params.delete('file');
    params.delete('ftml_token');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
  }
  return project ? { project, file: file || null } : null;
}

/** 注册项目 → 选中 → 刷新侧栏 → 打开文件 */
async function applyOpenTarget(target) {
  if (!target?.project) return false;
  try {
    await api('POST', '/api/projects', { root: target.project });
  } catch (e) {
    setError(`打开项目失败: ${e.message}`);
    return false;
  }
  await loadProjects();
  const entry = state.projects.find((p) => samePath(p.root, target.project) || samePath(p.id, target.project));
  if (!entry) {
    setError(`项目未注册: ${target.project}`);
    return false;
  }
  state.projectId = entry.id;
  el.projectSelect.value = entry.id;
  await refreshSidebar();
  if (target.file) await openFile(target.file);
  return true;
}

/** 桌面版：接收运行中再次双击 .ftml / 打开项目的请求 */
async function initDesktopBridge() {
  const bridge = window.ftmlDesktop;
  if (!bridge) return;
  bridge.onOpenFile?.((target) => {
    applyOpenTarget(target).catch((e) => setError(e.message));
  });
  try {
    const pending = await bridge.rendererReady?.();
    if (pending) await applyOpenTarget(pending);
  } catch {
    /* 旧版本壳或 IPC 不可用 */
  }
}

async function boot() {
  const initialTarget = readOpenTargetFromLocation();

  // 设置（自动预览间隔等）与代码片段均由服务端持久化，启动时拉取
  await loadSettings();
  await loadSnippets();

  await loadProjects();
  await refreshAuth();
  await checkGitEnv();

  const opened = initialTarget ? await applyOpenTarget(initialTarget) : false;
  if (!opened) {
    if (state.projects.length === 0) {
      await openAddProject(); // 无项目时引导添加
    }
    if (state.projectId) {
      await refreshSidebar();
    }
  }

  await initDesktopBridge();
}

// 先确定配色，再建编辑器（CM6 创建时即读取生效主题）
initTheme();

// 先装配各面板的事件监听，再拉取初始数据
initSelectMenus({ onRemoveProject: removeCurrentProject });
initLayout();
initTarget();
initProjects();
initEditor();
initSnippets();
initSettings();
initVersions();
initGit();
initAuth();
initPalette();
initKeymap();

boot().catch((e) => setError(e.message));
