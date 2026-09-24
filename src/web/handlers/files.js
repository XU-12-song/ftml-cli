/**
 * handlers/files.js — 项目作用域的文件树与文件读写
 *
 * sidebar（自动补全数据源）、读/写源文件、保存目标 site/page 元数据。
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadConfig, saveProjectMeta } from '../../infra/config.js';
import { parseFtmx } from '../../core/parse-ftmx.js';
import { projectGit, isRepo, isClean } from '../../infra/git.js';
import { HttpError, resolveInProject, findProject } from './shared.js';

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
