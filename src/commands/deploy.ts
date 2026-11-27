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
 * 依赖发布在同一登录会话里依次写多个页面（withSession：结束不 close，
 * 会话过期自动重登重试一次），叶子在前。依赖页 getPage 并行预取、edit
 * 并发上限 3；发布状态记录在 .ftml/publish-state.json，源码 hash 与远程
 * 修订号都未变化时跳过 edit。
 * `--no-deps` 只发入口页（旧行为），不做依赖闭包与引用名重写。
 */

import fs from 'node:fs';
import path from 'node:path';
import { build } from './build.js';
import { validate } from './validate.js';
import { submit, requireMessage, appendHistory } from './submit.js';
import { loadConfig, saveProjectMeta, saveProjectTarget } from '../infra/config.js';
import { projectGit, commitAll, isRepo, tagCommit, pushCurrent } from '../infra/git.js';
import { assertGitReady } from '../infra/gitenv.js';
import { addMajor, nextMajorVersion, writeMajorSnapshot } from '../domain/versions.js';
import { isNegated } from '../infra/flags.js';
import { pushPageSource, upsertPageSource, getSite, getPage, prefetchPages } from '../infra/wikidot.js';
import { withSession, invalidatePage } from '../infra/session.js';
import {
  canSkipPublish,
  hashSource,
  loadPublishState,
  publishStateKey,
  savePublishState,
} from '../infra/publish-state.js';
import { buildPublishPlan, rewriteDepSource, describeConflicts } from '../domain/publish.js';
import { isInteractive, confirm } from '../infra/prompt.js';
import type { PublishPlan } from '../types/domain/publish.ts';
import type { CompatSummary } from '../types/infra/wikidot.ts';
import type { DeployOptions, DeployResult } from '../types/commands/deploy.ts';

/** 依赖页 edit 并发上限；同一页面串行（计划内页面名唯一，冲突已在构建时拒绝） */
const DEPLOY_EDIT_CONCURRENCY = 3;

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
  //    客户端生命周期统一走会话层：操作结束不 close；同一会话只登录一次；
  //    会话过期自动重登并只重试一次。CLI 与 Web 走同一段代码（Web 仅 captureLogs 包装）。
  //    clientFactory 注入（测试 / web）绕过凭证单例，不拥有、不关闭。
  const { revisionsCount, compat, depChanges, depPublished } = await withSession(async (client) => {
    const state = loadPublishState(config.root);
    const updates: Record<string, { hash: string; revision: number }> = {};
    let depChanges = 0;
    let depPublished = 0;

    // Site 走会话 TTL 缓存：连续部署第二次查询为 0
    const site = await getSite(client, siteName);

    // 依赖页 + 入口页并行预取（会话缓存命中则零请求；不存在得到 null，不进缓存）
    const depNames = (plan?.pages ?? []).map((p) => p.name);
    const prefetched = await prefetchPages(site, [...depNames, pageName]);

    if (plan?.pages.length) {
      // 同一页面串行：plan.pages 名字唯一（构建计划已拒绝重名冲突），此处仅防御性去重
      const seen = new Set<string>();
      const targets = plan.pages.filter((p) => {
        if (seen.has(p.name)) return false;
        seen.add(p.name);
        return true;
      });
      await runLimited(targets, DEPLOY_EDIT_CONCURRENCY, async (p) => {
        const finalSource = rewriteDepSource(plan, p.source);
        const hash = hashSource(finalSource);
        const key = publishStateKey(siteName, p.name);
        const record = state.pages[key];
        if (record && canSkipPublish(record, prefetched.get(p.name), hash)) {
          console.log(`  · 依赖页 ${p.name} 未变化（修订 ${record.revision}），跳过`);
          return;
        }
        const dep = await upsertPageSource({
          site,
          pageName: p.name,
          source: finalSource,
          comment: message,
        });
        depChanges += dep.compat.changes.length;
        depPublished++;
        console.log(`  ${dep.created ? '＋新建' : '↑更新'}依赖页 ${p.name}`);
        // 依赖页修订号按本地递增记录（Page.edit 不更新 revisionsCount，取不到权威值）
        const base = dep.created ? 0 : prefetched.get(p.name)?.revisionsCount ?? 0;
        updates[key] = { hash, revision: base + 1 };
        console.log(`  · 依赖页 ${p.name} 修订号按本地递增记录为 ${base + 1}`);
      });
      // 依赖页发布成功即写回（入口失败时下次部署也不会重发已发布的依赖页）
      if (Object.keys(updates).length) {
        savePublishState(config.root, { version: 1, pages: { ...state.pages, ...updates } });
      }
    }

    // 入口页
    const entryKey = publishStateKey(siteName, pageName);
    const entryHash = hashSource(entrySource);
    const entryRecord = state.pages[entryKey];
    let revisionsCount: number;
    let entryCompat: CompatSummary;
    if (entryRecord && canSkipPublish(entryRecord, prefetched.get(pageName), entryHash)) {
      console.log(`  · 入口页 ${pageName} 未变化（修订 ${entryRecord.revision}），跳过发布`);
      revisionsCount = entryRecord.revision;
      entryCompat = { changed: false, changes: [], diagnostics: [] };
    } else {
      const res = await pushPageSource({ siteName, pageName, source: entrySource, comment: message, client });
      entryCompat = res.compat;
      // 入口页发布后重新拉取一次以获得权威 revisionsCount（edit 不更新该字段）
      try {
        invalidatePage(siteName, pageName);
        const fresh = await getPage(site, pageName);
        revisionsCount = fresh?.revisionsCount ?? res.revisionsCount;
      } catch {
        revisionsCount = res.revisionsCount; // 重新拉取失败退回 edit 返回值（可能偏小）
      }
      updates[entryKey] = { hash: entryHash, revision: revisionsCount };
      savePublishState(config.root, { version: 1, pages: { ...state.pages, ...updates } });
    }
    return { revisionsCount, compat: entryCompat, depChanges, depPublished };
  }, { clientFactory: options.clientFactory });
  if (plan?.pages.length) {
    const skippedDeps = plan.pages.length - depPublished;
    const notes: string[] = [];
    if (skippedDeps > 0) notes.push(`${skippedDeps} 个未变化跳过`);
    if (depChanges) notes.push(`自动补全 ${depChanges} 处行内闭合`);
    console.log(`✓ 已发布 ${plan.pages.length} 个依赖页${notes.length ? `（${notes.join('，')}）` : ''}`);
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
  // 目标站点/页面是项目级配置：部署成功后写回项目配置；lastRev 仍按文件记录
  saveProjectTarget(config.root, siteName, pageName);
  saveProjectMeta(config.sourceAbs, { lastRev: revisionsCount }, config.root);
  console.log(`✓ 已发布 ${siteName}:${pageName}（修订 ${revisionsCount}）`);

  // 7. 一次 submit：本地提交 + 小版本号
  const sub = await submit({ ...options, noBuild: true, source: r.output, message });
  console.log(`✓ 部署完成：大版本 ${majorVersion} → 小版本 ${sub.version}`);
  return { majorVersion, minorVersion: sub.version, hash, revisionsCount };
}

/**
 * 有上限的并行执行：按数组顺序启动任务，最多 limit 个同时在跑；
 * 某个任务失败后不再启动新任务（已在跑的跑完），错误原样上抛（不吞）。
 */
async function runLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let stopped = false;
  const worker = async (): Promise<void> => {
    while (!stopped) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await fn(items[i]);
      } catch (e) {
        stopped = true; // 失败后不再启动新任务；错误继续向上抛
        throw e;
      }
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
}
