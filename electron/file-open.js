/**
 * file-open.js — 文件关联相关的纯函数（不依赖 Electron，可单测）
 *
 * Windows 双击 .ftml 时，路径会出现在 process.argv / second-instance argv。
 * 这里负责从混合参数里找出真实文件，并把文件映射到项目根 + 相对路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import { findConfigDir } from '../src/infra/paths.js';

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
 * .ftml 文件 → { project, file }。
 * project 优先取向上找到的配置文件目录，否则用文件父目录；file 为相对路径。
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

  const root = findConfigDir(path.dirname(abs)) ?? path.dirname(abs);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return { project: root, file: rel };
}
