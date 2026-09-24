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
 * preview（保存/渲染）→ autocomplete · editor → 各业务面板（projects / versions /
 * snippets / settings / git / auth）→ layout · main（装配与启动）。
 */
import { el, state } from './dom.js';
import { initProjects, loadProjects } from './projects.js';
import { initEditor, refreshSidebar } from './editor.js';
import { initSnippets, loadSnippets } from './snippets.js';
import { initSettings, loadSettings } from './settings.js';
import { initVersions } from './versions.js';
import { initGit, checkGitEnv } from './git.js';
import { initAuth, refreshAuth } from './auth.js';
import { initLayout } from './layout.js';

async function boot() {
  // 设置（自动预览间隔等）与代码片段均由服务端持久化，启动时拉取
  await loadSettings();
  await loadSnippets();

  await loadProjects();
  await refreshAuth();
  await checkGitEnv();
  if (state.projects.length === 0) {
    el.addProjectBtn.click();
  }
  if (state.projectId) {
    await refreshSidebar();
  }
}

// 先装配各面板的事件监听，再拉取初始数据
initLayout();
initProjects();
initEditor();
initSnippets();
initSettings();
initVersions();
initGit();
initAuth();

boot();
