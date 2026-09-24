/**
 * submit — 本地提交：git commit + 创建小版本号
 *
 *   ftml submit -m "提交说明" [--site <site>] [--page <page>] [-s <file>] [--no-build]
 *
 * 只做本地两件事（线上发布交给 deploy）：
 *   1. 把当前工作区 git commit
 *   2. 在该大版本下递增一个小版本号 x.y（写入 .ftml/versions.json）
 *
 * dist/ 被 .gitignore 忽略，构建产物只作本地校验/预览用，不进 git。
 * 提交前做 git 环境体检（git 是否存在、user.name/user.email 是否配置）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { build } from './build.js';
import { loadConfig } from '../infra/config.js';
import { projectGit, commitAll, isRepo } from '../infra/git.js';
import { assertGitReady } from '../infra/gitenv.js';
import { addMinor, nextMinorVersion } from '../domain/versions.js';
import { historyPath } from '../infra/paths.js';

/** 追加一条提交历史（history.json 为 JSON 数组，幂等读-改-写） */
export function appendHistory(root, entry) {
  const p = historyPath(root);
  let arr = [];
  try {
    arr = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    arr = [];
  }
  arr.push(entry);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}

/** 取提交说明：缺失时抛错（submit/deploy 都要求填写） */
export function requireMessage(options, command) {
  const message = String(options.message ?? '').trim();
  if (!message) {
    throw new Error(`${command} 需要填写提交说明。请用 -m "说明" 指定`);
  }
  return message;
}

export async function submit(options) {
  const config = loadConfig(options);
  const message = requireMessage(options, 'submit');

  // 构建：生成校验/预览用产物（dist/ 不进 git）
  if (!options.noBuild) {
    const r = await build(options);
    console.log(`构建完成 → ${r.output}`);
  } else if (options.source && !fs.existsSync(path.resolve(options.source))) {
    throw new Error(`指定文件不存在: ${path.resolve(options.source)}`);
  }

  await assertGitReady({ root: config.root });
  const git = projectGit(config.root);
  if (!(await isRepo(git))) {
    throw new Error('当前项目不是 git 仓库，无法提交。请先运行 `ftml init` 初始化');
  }

  const { version } = nextMinorVersion(config.root);
  const { hash, skipped } = await commitAll(git, message);
  const entry = addMinor(config.root, { commit: hash, message });
  appendHistory(config.root, {
    commit_hash: hash,
    comment: message,
    version: entry.version,
    type: 'submit',
  });

  const short = hash ? hash.slice(0, 7) : '（空仓库）';
  console.log(
    skipped
      ? `✓ 无文件改动，创建小版本 ${entry.version}（沿用提交 ${short}）`
      : `✓ 已本地提交（${short}），创建小版本 ${entry.version}`
  );
  return { version: entry.version, hash, skipped, plannedVersion: version };
}
