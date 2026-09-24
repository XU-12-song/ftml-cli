/**
 * handlers/index.js — web 编辑器 JSON API 处理器的统一出口
 *
 * 按域拆到同目录各模块，这里聚合成单一命名空间，server.js 的
 * `import * as handlers` 与路由表（route → handler）保持不变。
 *
 * 每个 handler 拿到 { root, query, body, env }；env 供测试注入 fake wikidot
 * client（env.injectClient），生产走真实 createClient。
 */

export { HttpError, resolveInProject, captureLogs } from './shared.js';
export {
  listProjects,
  createProject,
  deleteProject,
  createFtmlProject,
} from './projects.js';
export {
  getSidebar,
  readProjectFile,
  saveProjectFile,
  saveTargetPage,
} from './files.js';
export {
  renderProjectFile,
  validateProjectFile,
} from './render.js';
export {
  listProjectVersions,
  deployProject,
  revertProject,
  initProject,
} from './versions.js';
export {
  listSnippets,
  saveSnippet,
  deleteSnippet,
  importSnippets,
  exportSnippets,
  listIncludeCache,
  clearIncludeCache,
} from './snippets.js';
export { getSettings, saveSettings, gitEnv } from './settings.js';
export { authStatus, authLogin, authLogout } from './auth.js';
