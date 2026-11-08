/**
 * deploy — 创建大版本 + 推送线上 + submit（一步部署）
 *
 *   ftml deploy -m "部署说明" [--site <site>] [--page <page>] [--no-validate] [--no-push] [--no-deps]
 *
 * 流程（message 必填，与 submit 一致）：
 *   1. build → validate（默认）
 *   2. 创建大版本 x：git commit + tag v<x>，把当前状态固化成版本快照
 *   3. 推送远端：有 origin 时 git push，无远端则跳过（不视为失败）
 *   4. 发布到 Wikidot：连同入口 `[[include]]` 到的**本地镜像依赖页**一起发布，
 *      并把引用名归一到线上全名（`components/box` → `components:box`）。见 domain/publish.js
 *   5. 执行一次 submit：本地 git commit + 生成小版本 x.1
 *
 * 依赖发布在同一登录会话里依次写多个页面（withClient 统一关闭），叶子在前。
 * `--no-deps` 只发入口页（旧行为），不做依赖闭包与引用名重写。
 */

import fs from 'node:fs';
import path from 'node:path';
import { build } from './build.js';
import { validate } from './validate.js';
import { submit, requireMessage, appendHistory } from './submit.js';
import { loadConfig, saveProjectMeta } from '../infra/config.js';
import { projectGit, commitAll, isRepo, tagCommit, pushCurrent } from '../infra/git.js';
import { assertGitReady } from '../infra/gitenv.js';
import { addMajor, nextMajorVersion, writeMajorSnapshot } from '../domain/versions.js';
import { isNegated } from '../infra/flags.js';
import { pushPageSource, upsertPageSource, withClient, getSite } from '../infra/wikidot.js';
import { buildPublishPlan, rewriteDepSource, describeConflicts } from '../domain/publish.js';
import { isInteractive, confirm } from '../infra/prompt.js';
import type { PublishPlan } from '../types/domain/publish.ts';
import type { DeployOptions, DeployResult } from '../types/commands/deploy.ts';

export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const config = loadConfig(options);
  const message = requireMessage(options, 'deploy');

  // 目标页面先校验：缺 site/page 时在构建 / 创建版本之前就报错，避免白忙一场
  const siteName = options.site || config.site;
  const pageName = options.page || config.page;
  if (!siteName || !pageName) {
    throw new Error(
      '缺少部署目标。请先设置 site/page：命令面板 →「目标页面设置」，' +
      '或使用 --site <站点> --page <页面>，也可以写进配置文件'
    );
  }

  // git 环境在构建前体检：缺 git / 身份时直接给出修复命令
  await assertGitReady({ root: config.root });
  const git = projectGit(config.root);
  if (!(await isRepo(git))) {
    throw new Error('当前项目不是 git 仓库，无法部署。请先运行 `ftml init` 初始化');
  }

  // 1. 构建 + 校验
  const r = await build(options);
  console.log(`构建完成 → ${r.output}（${r.bytes} 字节）`);

  if (!isNegated(options, 'validate')) {
    const ok = await validate({ ...options, source: r.output, noBuild: true });
    if (ok !== 0) {
      throw new Error('校验未通过，中止部署');
    }
  }

  // 2. 依赖闭包：入口 [[include]] 到的本地镜像页一并发布，并把引用名归一到线上全名。
  // 冲突（同文件两名 / 两名两文件 / 依赖撞入口名）说明本地镜像不自洽，宁可中止。
  const source = fs.readFileSync(r.output, 'utf8');
  let plan: PublishPlan | null = null;
  let entrySource = source;
  const noDeps = isNegated(options, 'deps');
  if (!noDeps) {
    plan = await buildPublishPlan({
      entrySource: source,
      entryDir: path.dirname(config.sourceAbs),
      currentSite: siteName,
      entryName: pageName,
      templatesDir: config.templatesDirAbs,
    });
    if (plan.conflicts.length) {
      throw new Error(`依赖闭包存在冲突，中止部署：\n${describeConflicts(plan.conflicts)}`);
    }
    entrySource = plan.entry;
  }

  // 3. 预检摘要 + 确认（仅交互式终端；脚本 / web 不阻塞）
  const majorVersion = nextMajorVersion(config.root);
  const tag = `v${majorVersion}`;
  console.log('部署预检:');
  console.log(`  目标页面: ${siteName}:${pageName}`);
  console.log(`  版本: 大版本 ${majorVersion}（tag ${tag}），随后自动提交小版本 ${majorVersion}.1`);
  console.log(`  git 推送: ${isNegated(options, 'push') ? '关闭' : '开启（有 origin 时）'}`);
  console.log(`  依赖页: ${noDeps ? '仅入口页（--no-deps）' : plan?.pages.length ? `${plan.pages.length} 个` : '无'}`);
  if (!options.yes && isInteractive()) {
    if (!(await confirm('继续部署?', true))) throw new Error('已取消部署');
  }

  // 4. 创建大版本
  const { hash } = await commitAll(git, message);
  await tagCommit(git, tag);
  console.log(`✓ 创建大版本 ${majorVersion}（${tag}）`);

  // 5. 推送远端（无 origin 时跳过）
  if (!isNegated(options, 'push')) {
    const pushed = await pushCurrent(git);
    console.log(pushed.pushed
      ? `✓ 已推送远端 ${pushed.remote}/${pushed.branch ?? 'HEAD'}`
      : `· ${pushed.reason}`);
  }

  // 6. 发布到 Wikidot，并留下大版本快照（revert 时线上要回到这一版）
  const { revisionsCount, compat, depChanges } = await withClient(options.clientFactory, async (client) => {
    let depChanges = 0;
    if (plan?.pages.length) {
      const site = await getSite(client, siteName); // 同一会话复用，依赖页 + 入口只登录一次
      for (const p of plan.pages) {
        const dep = await upsertPageSource({
          site,
          pageName: p.name,
          source: rewriteDepSource(plan, p.source),
          comment: message,
        });
        depChanges += dep.compat.changes.length;
        console.log(`  ${dep.created ? '＋新建' : '↑更新'}依赖页 ${p.name}`);
      }
    }
    const res = await pushPageSource({ siteName, pageName, source: entrySource, comment: message, client });
    return { ...res, depChanges };
  });
  if (plan?.pages.length) {
    console.log(`✓ 已发布 ${plan.pages.length} 个依赖页${depChanges ? `（自动补全 ${depChanges} 处行内闭合）` : ''}`);
  }
  if (compat.changes.length) {
    console.log(`· 为兼容 Wikidot 自动补全 ${compat.changes.length} 处行内闭合`);
  }
  writeMajorSnapshot(config.root, majorVersion, entrySource);
  addMajor(config.root, { commit: hash ?? '', message, tag, wikidotVersion: revisionsCount });
  appendHistory(config.root, {
    commit_hash: hash,
    comment: message,
    version: majorVersion,
    wikidotVersion: revisionsCount,
    type: 'major',
  });
  saveProjectMeta(config.sourceAbs, { site: siteName, page: pageName, lastRev: revisionsCount }, config.root);
  console.log(`✓ 已发布 ${siteName}:${pageName}（修订 ${revisionsCount}）`);

  // 7. 一次 submit：本地提交 + 小版本号
  const sub = await submit({ ...options, noBuild: true, source: r.output, message });
  console.log(`✓ 部署完成：大版本 ${majorVersion} → 小版本 ${sub.version}`);
  return { majorVersion, minorVersion: sub.version, hash, revisionsCount };
}
