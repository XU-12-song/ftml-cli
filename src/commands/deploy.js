/**
 * deploy — 创建大版本 + 推送线上 + submit（一步部署）
 *
 *   ftml deploy -m "部署说明" [--site <site>] [--page <page>] [--no-validate] [--no-push]
 *
 * 流程（message 必填，与 submit 一致）：
 *   1. build → validate（默认）
 *   2. 创建大版本 x：git commit + tag v<x>，把当前状态固化成版本快照
 *   3. 推送远端：有 origin 时 git push，无远端则跳过（不视为失败）
 *   4. 发布到 Wikidot（把构建产物 edit 回页面）
 *   5. 执行一次 submit：本地 git commit + 生成小版本 x.1
 */

import fs from 'node:fs';
import { build } from './build.js';
import { validate } from './validate.js';
import { submit, requireMessage, appendHistory } from './submit.js';
import { loadConfig, saveProjectMeta } from '../infra/config.js';
import { projectGit, commitAll, isRepo, tagCommit, pushCurrent } from '../infra/git.js';
import { assertGitReady } from '../infra/gitenv.js';
import { addMajor, nextMajorVersion, writeMajorSnapshot } from '../domain/versions.js';
import { pushPageSource } from '../infra/wikidot.js';

export async function deploy(options) {
  const config = loadConfig(options);
  const message = requireMessage(options, 'deploy');

  // 1. 构建 + 校验
  const r = await build(options);
  console.log(`构建完成 → ${r.output}（${r.bytes} 字节）`);

  if (!options.noValidate) {
    const ok = await validate({ ...options, source: r.output, noBuild: true });
    if (ok !== 0) {
      throw new Error('校验未通过，中止部署');
    }
  }

  // 2. 创建大版本
  await assertGitReady({ root: config.root });
  const git = projectGit(config.root);
  if (!(await isRepo(git))) {
    throw new Error('当前项目不是 git 仓库，无法部署。请先运行 `ftml init` 初始化');
  }

  const majorVersion = nextMajorVersion(config.root);
  const tag = `v${majorVersion}`;
  const { hash } = await commitAll(git, message);
  await tagCommit(git, tag);
  console.log(`✓ 创建大版本 ${majorVersion}（${tag}）`);

  // 3. 推送远端（无 origin 时跳过）
  if (!options.noPush) {
    const pushed = await pushCurrent(git);
    console.log(pushed.pushed
      ? `✓ 已推送远端 ${pushed.remote}/${pushed.branch ?? 'HEAD'}`
      : `· ${pushed.reason}`);
  }

  // 4. 发布到 Wikidot，并留下大版本快照（revert 时线上要回到这一版）
  const source = fs.readFileSync(r.output, 'utf8');
  const siteName = options.site || config.site;
  const pageName = options.page || config.page;
  const { revisionsCount, compat } = await pushPageSource({
    siteName,
    pageName,
    source,
    comment: message,
    clientFactory: options.clientFactory,
  });
  if (compat.changed) {
    console.log(`· 为兼容 Wikidot 自动补全 ${compat.changes.length} 处行内闭合`);
  }
  writeMajorSnapshot(config.root, majorVersion, source);
  addMajor(config.root, { commit: hash, message, tag, wikidotVersion: revisionsCount });
  appendHistory(config.root, {
    commit_hash: hash,
    comment: message,
    version: majorVersion,
    wikidotVersion: revisionsCount,
    type: 'major',
  });
  saveProjectMeta(config.sourceAbs, { site: siteName, page: pageName, lastRev: revisionsCount }, config.root);
  console.log(`✓ 已发布 ${siteName}:${pageName}（修订 ${revisionsCount}）`);

  // 5. 一次 submit：本地提交 + 小版本号
  const sub = await submit({ ...options, noBuild: true, source: r.output, message });
  console.log(`✓ 部署完成：大版本 ${majorVersion} → 小版本 ${sub.version}`);
  return { majorVersion, minorVersion: sub.version, hash, revisionsCount };
}
