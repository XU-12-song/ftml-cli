/**
 * handlers/projects.js — 项目注册表与「FTML 仓库」新建
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadProjects, addProject, removeProject } from '../projects.js';
import { projectsBaseDir } from '../../infra/paths.js';
import { init } from '../../commands/init.js';
import { projectGit, isRepo, isClean } from '../../infra/git.js';
import { HttpError, captureLogs, findProject } from './shared.js';

// ---------------- 注册表 ----------------

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
