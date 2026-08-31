/**
 * init — 初始化 ftml 项目
 *
 *   ftml init
 *
 * 在当前目录建立项目结构（幂等，可重复执行）：
 *   .ftml/                  隐藏数据目录（Windows 上设隐藏属性）
 *     history.json          提交历史（[]）
 *   .gitignore              dist/ 与 .ftml/
 *   .ftmlrc.json            {}（配置占位，合法 JSON）
 *   components/  templates/
 *   git init                （若当前目录还不是 git 仓库）
 *
 * site/page 元数据按源文件名存放：.ftml/index.json ↔ index.ftml（submit 时写入）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { hideSync } from 'hidefile';
import { projectFtmlDir, historyPath } from '../utils/paths.js';
import { projectGit, isRepo } from '../utils/git.js';

export async function init(options = {}) {
  const root = path.resolve(options.cwd || process.cwd());
  const ftmlDir = projectFtmlDir(root);

  // 1. 隐藏数据目录 .ftml/
  fs.mkdirSync(ftmlDir, { recursive: true });
  if (process.platform === 'win32') {
    hideSync(ftmlDir); // POSIX 下 dot 前缀即隐藏，Windows 需要设置隐藏属性
  }

  // 2. history.json
  const hist = historyPath(root);
  if (!fs.existsSync(hist)) fs.writeFileSync(hist, '[]\n', 'utf8');

  // 3. 目录
  fs.mkdirSync(path.join(root, 'components'), { recursive: true });
  fs.mkdirSync(path.join(root, 'templates'), { recursive: true });

  // 4. .gitignore（幂等：不存在则建，缺少条目则补）
  const gi = path.join(root, '.gitignore');
  const giLines = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split('\n') : [];
  for (const entry of [ 'dist/', '.ftml/' ]) {
    if (!giLines.some((l) => l.trim() === entry)) giLines.push(entry);
  }
  fs.writeFileSync(gi, giLines.join('\n').replace(/\n+$/, '') + '\n', 'utf8');

  // 5. .ftmlrc.json（合法 JSON 占位）
  const rc = path.join(root, '.ftmlrc.json');
  if (!fs.existsSync(rc)) fs.writeFileSync(rc, '{}\n', 'utf8');

  // 6. git init
  const git = projectGit(root);
  if (!(await isRepo(git))) await git.init();

  console.log(`✓ 已初始化 ftml 项目: ${root}`);
  return { root, ftmlDir };
}
