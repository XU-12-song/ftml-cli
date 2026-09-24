/**
 * handlers.js — web 编辑器 JSON API 处理器
 *
 * 复用 CLI 命令/工具函数作为引擎；每个 handler 拿到 { root, query, body, env }，
 * env 供测试注入 fake wikidot client（env.injectClient），生产走真实 createClient。
 */

import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@ukwhatn/wikidot';

import { loadProjects, addProject, removeProject } from './projects.js';
import { loadConfig, saveProjectMeta } from '../utils/config.js';
import { loadTemplates, expand } from '../core/expand.js';
import { parseFtmx } from '../core/parse-ftmx.js';
import { renderPreview } from '../utils/preview.js';
import { buildPreviewDocument } from '../utils/preview-page.js';
import { buildPageContext } from '../commands/preview.js';
import { deploy } from '../commands/deploy.js';
import { revert } from '../commands/revert.js';
import { listVersions } from '../utils/versions.js';
import { collectProblems } from '../commands/validate.js';
import { init } from '../commands/init.js';
import { createClient } from '../utils/wikidot.js';
import { projectGit, isRepo, isClean } from '../utils/git.js';
import { detectGitEnv } from '../utils/gitenv.js';
import { loadSettings, saveSettings as writeSettings } from '../utils/settings.js';
import {
  loadSnippets,
  upsertSnippet,
  removeSnippet,
  importSnippetsText,
  exportSnippetsText,
} from '../utils/snippets.js';
import { projectsBaseDir } from '../utils/paths.js';
import { listPageCache, clearPageCache } from '../utils/cache.js';
import {
  getCredentials,
  saveCredentials,
  CREDENTIALS_PATH,
} from '../utils/credentials.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 项目根内的路径解析（防目录穿越） */
export function resolveInProject(root, relPath) {
  const base = path.resolve(root);
  const abs = path.resolve(base, relPath);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new HttpError(400, `路径越界: ${relPath}`);
  }
  return abs;
}

/** 运行 fn 时捕获 console 输出（CLI 命令的进度/诊断反馈给前端） */
export async function captureLogs(fn) {
  const logs = [];
  const push = (kind) => (msg) => {
    logs.push({ kind, msg: typeof msg === 'string' ? msg : String(msg) });
  };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = push('log');
  console.warn = push('warn');
  console.error = push('error');
  try {
    return { logs, result: await fn() };
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  }
}

/** 递归收集项目内 .ftml 源文件（跳过构建/模板/组件/隐藏目录） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'templates', 'components', '.ftml']);
function scanFtmLFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scanFtmLFiles(p, out);
    else if (e.name.endsWith('.ftml')) out.push(p);
  }
  return out;
}

function findProject(id) {
  const list = loadProjects();
  const p = list.find((x) => x.id === id);
  if (!p) throw new HttpError(404, `项目未注册: ${id}`);
  return p;
}

// ---------------- projects ----------------

export async function listProjects() {
  const list = loadProjects();
  const results = await Promise.all(list.map(async (p) => {
    // 目录已不存在（被删/移动）：跳过 git 探测（simple-git 对不存在目录直接抛错）
    if (!fs.existsSync(p.root) || !fs.statSync(p.root).isDirectory()) return null;
    const g = projectGit(p.root);
    const isRepoResult = await isRepo(g).catch(() => false);
    return {
      ...p,
      isRepo: isRepoResult,
      isClean: isRepoResult ? await isClean(g).catch(() => false) : true,
    };
  }));
  return results.filter(Boolean);
}

export async function createProject(body) {
  if (!body || !body.root) throw new HttpError(400, '缺少 root');
  return addProject(body.root);
}

export async function deleteProject(id) {
  findProject(id);
  return removeProject(id);
}

// ---------------- project-scoped ----------------

/** 侧边栏：模板/组件/源文件 + git 状态（自动补全数据源） */
export async function getSidebar(id) {
  const p = findProject(id);
  const { root } = p;
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new HttpError(410, `项目目录不存在，请在列表中移除: ${root}`);
  }
  const config = loadConfig({ root });

  const templates = [];
  const tplDir = config.templatesDirAbs;
  if (fs.existsSync(tplDir)) {
    for (const f of fs.readdirSync(tplDir)) {
      if (!f.endsWith('.ftmx')) continue;
      const name = f.slice(0, -'.ftmx'.length);
      let keys = [];
      try {
        keys = parseFtmx(fs.readFileSync(path.join(tplDir, f), 'utf8'), name).keys;
      } catch {
        /* 模板文件损坏：keys 留空，仍可在编辑器里查看 */
      }
      templates.push({ name, keys, path: path.relative(root, path.join(tplDir, f)) });
    }
  }

  const componentsDir = path.join(root, 'components');
  const components = fs.existsSync(componentsDir)
    ? fs.readdirSync(componentsDir)
        .filter((f) => f.endsWith('.ftml'))
        .map((f) => ({ name: f.slice(0, -'.ftml'.length), path: path.relative(root, path.join(componentsDir, f)) }))
    : [];

  const sources = scanFtmLFiles(root).map((p) => path.relative(root, p));
  const git = projectGit(root);
  const isGit = await isRepo(git);

  return {
    root,
    name: p.name,
    templates,
    components,
    sources,
    isRepo: isGit,
    isClean: isGit ? await isClean(git) : true,
  };
}

export function readProjectFile(id, relPath) {
  const p = findProject(id);
  if (!relPath) throw new HttpError(400, '缺少 path');
  const abs = resolveInProject(p.root, relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new HttpError(404, `文件不存在: ${relPath}`);
  }
  return { path: relPath, source: fs.readFileSync(abs, 'utf8') };
}

export function saveProjectFile(id, body) {
  const p = findProject(id);
  const relPath = body?.path;
  if (!relPath) throw new HttpError(400, '缺少 path');
  if (typeof body.source !== 'string') throw new HttpError(400, '缺少 source');
  const abs = resolveInProject(p.root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body.source, 'utf8');
  return { path: relPath };
}

/** 保存 + 渲染：读文件 → 展开模板 → @wdprlib 渲染 → 完整文档（不写 dist） */
export async function renderProjectFile(id, body, env = {}) {
  const p = findProject(id);
  const relPath = body?.path;
  if (!relPath) throw new HttpError(400, '缺少 path');
  const abs = resolveInProject(p.root, relPath);
  if (!fs.existsSync(abs)) throw new HttpError(404, `文件不存在: ${relPath}`);
  const text = fs.readFileSync(abs, 'utf8');

  const config = loadConfig({
    root: p.root,
    source: relPath,
    site: body.site,
    page: body.page,
  });
  const templates = await loadTemplates(config.templatesDirAbs);
  const expanded = expand(text, templates, { baseDir: path.dirname(config.sourceAbs) });

  const page = buildPageContext({ site: config.site, page: config.page });

  const settings = loadSettings();
  const allowNetwork = body?.allowNetwork ?? settings.useRemoteInclude;

  let client = env.injectClient ?? null;
  let ownsClient = false;
  if (!client && allowNetwork) {
    try {
      client = await createClient();
      ownsClient = true;
    } catch {
      client = null; // 无凭证：远程 include 解析关闭，渲染占位
    }
  }

  try {
    const { html, styles, htmlBlocks, diagnostics, includes } = await renderPreview(expanded, {
      page,
      styleMode: body?.styleMode ?? settings.renderStyleMode,
      includeBaseDir: path.dirname(config.sourceAbs),
      includeTemplates: templates,
      client,
      allowNetwork,
    });
    const document = buildPreviewDocument({ html, htmlBlocks, title: config.page || page.fullName });
    return { html: document, styles, diagnostics, includes, settings };
  } finally {
    if (ownsClient) await client.close?.();
  }
}

export async function validateProjectFile(id, body) {
  const p = findProject(id);
  const relPath = body?.path;
  if (!relPath) throw new HttpError(400, '缺少 path');
  const abs = resolveInProject(p.root, relPath);
  if (!fs.existsSync(abs)) throw new HttpError(404, `文件不存在: ${relPath}`);
  const text = fs.readFileSync(abs, 'utf8');
  const config = loadConfig({ root: p.root, source: relPath });
  const templates = await loadTemplates(config.templatesDirAbs);
  return collectProblems(text, templates, path.dirname(config.sourceAbs));
}

/** 保存 site/page 到 .ftml/<源文件名>.json 元数据（前端目标页面设置） */
export function saveTargetPage(id, body) {
  const p = findProject(id);
  const relPath = body?.path || 'index.ftml';
  const abs = resolveInProject(p.root, relPath);
  if (!fs.existsSync(abs)) throw new HttpError(404, `文件不存在: ${relPath}`);
  const fields = {};
  if (body.site) fields.site = body.site;
  if (body.page) fields.page = body.page;
  if (body.lastRev !== undefined) fields.lastRev = body.lastRev;
  saveProjectMeta(abs, fields, p.root);
  return loadConfig({ root: p.root, source: relPath });
}

export async function deployProject(id, body, env = {}) {
  const p = findProject(id);
  // 相对路径按项目根解析（底层命令对相对 source 是相对 cwd 解析的）
  const rel = body?.source || body?.path;
  const source = rel ? path.resolve(p.root, rel) : undefined;
  const { logs } = await captureLogs(() =>
    deploy({
      root: p.root,
      source,
      site: body?.site,
      page: body?.page,
      message: body?.message,
      noValidate: body?.noValidate,
      clientFactory: env.injectClient ? () => env.injectClient : undefined,
    })
  );
  return { ok: true, logs };
}

export async function revertProject(id, body, env = {}) {
  const p = findProject(id);
  const rel = body?.source || body?.path;
  const source = rel ? path.resolve(p.root, rel) : undefined;
  const { logs } = await captureLogs(() =>
    revert({
      root: p.root,
      source,
      site: body?.site,
      page: body?.page,
      to: body?.to || 'HEAD',
      noWikidot: !!body?.noWikidot,
      autoCommit: true, // web 自动保存导致工作区常脏
      rebuild: true,    // dist/ 被 gitignore，git revert 后重建产物再回推
      clientFactory: env.injectClient ? () => env.injectClient : undefined,
    })
  );
  return { ok: true, logs };
}

export async function initProject(id, env = {}) {
  const p = findProject(id);
  const { logs } = await captureLogs(() => init({ cwd: p.root }));
  return { ok: true, logs };
}

// ---------------- auth ----------------

export function authStatus() {
  const creds = getCredentials();
  return {
    loggedIn: !!creds,
    username: creds?.username ?? null,
    source: creds?.source ?? null,
  };
}

export async function authLogin(body) {
  if (!body?.username || !body?.password) {
    throw new HttpError(400, '缺少用户名或密码');
  }
  const result = await Client.create({ username: body.username, password: body.password });
  if (!result.isOk()) {
    throw new HttpError(401, `登录失败: ${result.error}`);
  }
  await result.value.close?.();
  saveCredentials({ username: body.username, password: body.password });
  return { ok: true, username: body.username };
}

export async function authLogout() {
  try {
    fs.rmSync(CREDENTIALS_PATH, { force: true });
  } catch {
    /* 文件不存在 */
  }
  return { ok: true };
}

// ---------------- git 环境 ----------------

/**
 * 检测 git 环境（是否安装、user.name/user.email 是否配置、是否仓库）。
 * root 省略时检测进程 cwd。
 */
export async function gitEnv(root) {
  const cwd = root ? path.resolve(root) : process.cwd();
  if (root && !fs.existsSync(cwd)) throw new HttpError(404, `目录不存在: ${cwd}`);
  return detectGitEnv({ root: cwd });
}

// ---------------- 全局设置 ----------------

export function getSettings() {
  return loadSettings();
}

export function saveSettings(patch) {
  if (!patch || typeof patch !== 'object') throw new HttpError(400, '缺少设置内容');
  return writeSettings(patch);
}

// ---------------- 代码片段 ----------------

export function listSnippets() {
  return { snippets: loadSnippets() };
}

export function saveSnippet(body) {
  if (!body?.name) throw new HttpError(400, '缺少片段名称');
  return upsertSnippet(body);
}

export function deleteSnippet(name) {
  try {
    return removeSnippet(decodeURIComponent(name));
  } catch (e) {
    throw new HttpError(404, e.message);
  }
}

/** 导入 Ace .snippets：body.text 直接给内容，或 body.file 给磁盘路径 */
export function importSnippets(body) {
  if (typeof body?.text === 'string' && body.text.trim()) {
    return importSnippetsText(body.text, body.source || 'web-import');
  }
  if (typeof body?.file === 'string' && body.file.trim()) {
    const abs = path.resolve(body.file);
    if (!fs.existsSync(abs)) throw new HttpError(404, `文件不存在: ${abs}`);
    return importSnippetsText(fs.readFileSync(abs, 'utf8'), path.basename(abs));
  }
  throw new HttpError(400, '缺少导入内容（text 或 file）');
}

/** 导出全部片段为 Ace .snippets 文本 */
export function exportSnippets() {
  return { text: exportSnippetsText() };
}

// ---------------- 新建 ftml 仓库 ----------------

const REPO_NAME_RE = /^[A-Za-z0-9._\u4e00-\u9fa5-]+$/;

const STARTER_FTML = `[[div class="content"]]
这里是新仓库的起始页面，用 FTML 编写。
[[/div]]
`;

/**
 * 在「FTML 仓库分区」下新建并初始化一个 ftml 仓库。
 *
 *   body.name    仓库名（必填，单层目录名）
 *   body.parent  自定义分区目录（可选，默认 ~/.ftml-cli/projects）
 *
 * 目标根目录 = <parent>/<name>；已存在且非空时报错，避免覆盖用户内容。
 */
export async function createFtmlProject(body) {
  const name = String(body?.name ?? '').trim();
  if (!name) throw new HttpError(400, '缺少仓库名');
  if (!REPO_NAME_RE.test(name) || name === '.' || name === '..') {
    throw new HttpError(400, `仓库名不合法: ${name}（仅字母/数字/中划线/下划线/点/中文）`);
  }
  const parent = body?.parent ? path.resolve(body.parent) : projectsBaseDir();
  const root = path.resolve(parent, name);
  if (path.dirname(root) !== parent) throw new HttpError(400, '路径越界');

  if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
    throw new HttpError(409, `目录已存在且非空: ${root}`);
  }
  fs.mkdirSync(root, { recursive: true });

  const { logs } = await captureLogs(() => init({ cwd: root }));

  // 起始源文件（不存在才写，便于对已初始化目录复用）
  const starter = path.join(root, 'index.ftml');
  if (!fs.existsSync(starter)) fs.writeFileSync(starter, STARTER_FTML, 'utf8');

  addProject(root);
  return { ok: true, root, name, logs };
}

// ---------------- 项目版本 ----------------

export function listProjectVersions(id) {
  const p = findProject(id);
  return { versions: listVersions(p.root) };
}

// ---------------- include 缓存 ----------------

/** 列出远程 include 的磁盘缓存条目 */
export function listIncludeCache() {
  return { entries: listPageCache() };
}

/** 清空远程 include 缓存 */
export function clearIncludeCache() {
  return { removed: clearPageCache() };
}
