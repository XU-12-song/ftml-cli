/**
 * handlers/settings.js — 全局设置 + git 环境探测
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadSettings, saveSettings as writeSettings } from '../../domain/settings.js';
import { detectGitEnv } from '../../infra/gitenv.js';
import { HttpError } from './shared.js';

export function getSettings() {
  return loadSettings();
}

export function saveSettings(patch) {
  if (!patch || typeof patch !== 'object') throw new HttpError(400, '缺少设置内容');
  return writeSettings(patch);
}

/**
 * 检测 git 环境（是否安装、user.name/user.email 是否配置、是否仓库）。
 * root 省略时检测进程 cwd。
 */
export async function gitEnv(root) {
  const cwd = root ? path.resolve(root) : process.cwd();
  if (root && !fs.existsSync(cwd)) throw new HttpError(404, `目录不存在: ${cwd}`);
  return detectGitEnv({ root: cwd });
}
