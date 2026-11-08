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
import { spawnSync } from 'node:child_process';
import { projectFtmlDir, historyPath } from '../infra/paths.js';
import { projectGit, isRepo } from '../infra/git.js';
import { STARTER_FTML } from '../core/starter.js';
import type { InitOptions, InitResult } from '../types/commands/init.ts';

/**
 * Windows 上给目录设置隐藏属性。
 * 不用 hidefile/winattr/fswin（原生模块在 Electron 里需要按 ABI 重建），
 * 直接调用系统自带 attrib；失败只告警，不影响项目初始化。
 */
function hideDirOnWindows(dir: string): void {
  if (process.platform !== 'win32') return;
  const attrib = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'attrib.exe');
  const r = spawnSync(attrib, [ '+H', dir ], { windowsHide: true, stdio: 'ignore' });
  if (r.error || r.status !== 0) {
    console.warn(`警告: 无法设置隐藏属性: ${dir}`);
  }
}

export async function init(options: InitOptions = {}): Promise<InitResult> {
  const root = path.resolve(options.cwd || process.cwd());
  const ftmlDir = projectFtmlDir(root);

  // 1. 隐藏数据目录 .ftml/
  fs.mkdirSync(ftmlDir, { recursive: true });
  hideDirOnWindows(ftmlDir); // POSIX 下 dot 前缀即隐藏，Windows 需要设置隐藏属性

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

  // 7. 起始源文件：目录里还没有任何 .ftml 时补一个 index.ftml，
  // 这样 init 之后可以直接 preview / web，而不是先撞上 ENOENT。
  const starter = path.join(root, 'index.ftml');
  let createdSource = false;
  const hasSource = fs.existsSync(starter)
    || fs.readdirSync(root).some((f) => f.endsWith('.ftml') && fs.statSync(path.join(root, f)).isFile());
  if (!hasSource) {
    fs.writeFileSync(starter, STARTER_FTML, 'utf8');
    createdSource = true;
  }

  console.log(`✓ 已初始化 ftml 项目: ${root}`);
  if (createdSource) console.log(`  已创建起始源文件: ${path.relative(root, starter)}`);
  console.log('');
  console.log('下一步：');
  console.log('  ftml preview --open     本地预览');
  console.log('  ftml web --open         图形编辑器');
  console.log('  ftml login              登录 Wikidot（发布前需要）');
  console.log('  ftml deploy -m "首次发布" --site <站点> --page <页面>');
  console.log('文档: https://github.com/XU-12-song/ftml-cli/blob/master/docs/getting-started.md');
  return { root, ftmlDir };
}
