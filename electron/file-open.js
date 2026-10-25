/**
 * file-open.js — 文件关联相关的纯函数（不依赖 Electron，可单测）
 *
 * Windows 双击 .ftml 时，路径会出现在 process.argv / second-instance argv。
 * 这里负责从混合参数里找出真实文件，并把文件映射到项目根 + 相对路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import { findConfigDir } from '../src/infra/paths.js';

/**
 * 判断目录是否像一个 ftml 项目：
 *   - 强标记：配置文件 / .ftml 数据目录
 *   - 弱标记：templates + components 同时存在（避免把任意含 templates 的目录当项目）
 */
const CONFIG_MARKERS = [ '.ftmlrc.json', 'ftml.config.json', '.ftmlrc', '.ftml' ];
const PROJECT_DIRS = [ 'templates', 'components' ];

export function looksLikeFtmlProject(dir) {
  if (CONFIG_MARKERS.some((name) => fs.existsSync(path.join(dir, name)))) return true;
  return PROJECT_DIRS.every((name) => fs.existsSync(path.join(dir, name)));
}

/**
 * 从文件所在目录向上寻找项目根（最多 4 层）。
 * 命中配置/项目标记返回该目录；否则回退文件父目录并标记为非项目。
 */
export function findFtmlProjectRoot(start) {
  const config = findConfigDir(start);
  if (config) return { root: config, isProject: true };

  let dir = path.resolve(start);
  for (let depth = 0; depth <= 4; depth++) {
    if (looksLikeFtmlProject(dir)) return { root: dir, isProject: true };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { root: path.resolve(start), isProject: false };
}

/** 从 Electron/命令行 argv 中找出第一个存在的 .ftml 文件（绝对路径） */
export function findFtmlFileArg(argv = []) {
  for (const arg of argv) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    if (!/\.ftml$/i.test(arg)) continue;
    try {
      const abs = path.resolve(arg);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    } catch {
      /* 无法访问的参数忽略 */
    }
  }
  return null;
}

/**
 * .ftml 文件 → { project, file, isProject }。
 * project 优先取向上找到的配置文件目录，否则用文件父目录；file 为相对路径。
 * isProject=false 表示只是松散文件，Electron 会在注册前询问用户。
 * 越界（理论上不会）或文件不可读时返回 null。
 */
export function resolveOpenTarget(filePath) {
  if (!filePath) return null;
  let abs;
  try {
    abs = path.resolve(filePath);
    if (!fs.statSync(abs).isFile()) return null;
  } catch {
    return null;
  }

  const located = findFtmlProjectRoot(path.dirname(abs));
  const rel = path.relative(located.root, abs).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return {
    project: located.root,
    file: rel,
    isProject: located.isProject,
  };
}
