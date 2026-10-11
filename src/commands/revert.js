/**
 * revert — 按版本号回退（本地 git revert + 线上回到对应版本）
 *
 *   ftml revert --list                       列出可回退的版本（含 commit message）
 *   ftml revert --to <x|y>                   回退到版本号（推荐）
 *   ftml revert --to <hash|HEAD~n> [--no-wikidot] [--auto-commit] [--rebuild]
 *
 * 版本号语义：
 *   --to x      本地把工作区整体退回大版本 x 的内容（反向提交 x 之后的所有提交）；
 *               线上回到大版本 x 的内容
 *   --to x.y    本地把工作区整体退回小版本 x.y 的内容（反向提交 x.y 之后的所有提交）；
 *               线上回到「大版本 x 创建时提交的版本」（读 .ftml/versions/<x>.ftml 快照）
 *   --to <rev>  退化为按 git 修订回退（hash / HEAD~n 透传给 git revert，即撤销该提交）
 *
 * 未指定 --to 时默认 HEAD（撤销最近一次提交），保持旧行为。
 * site/page 优先级：命令行 > 配置文件 > .ftml/<源文件名>.json 元数据
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveProjectMeta } from '../infra/config.js';
import { pushPageSource } from '../infra/wikidot.js';
import { projectGit, commitAll, gitRevert, isRepo, isClean, showFileAt, headHash } from '../infra/git.js';
import { loadTemplates, expand } from '../core/expand.js';
import { appendHistory } from './submit.js';
import { build } from './build.js';
import {
  isVersionSpec,
  resolveVersionTarget,
  listVersions,
  readMajorSnapshot,
} from '../domain/versions.js';
import { isNegated } from '../infra/flags.js';

/** 打印版本列表（revert --list） */
export function printVersions(root) {
  const rows = listVersions(root);
  if (rows.length === 0) {
    console.log('（暂无版本记录。deploy 创建大版本，submit 创建小版本）');
    return rows;
  }
  console.log('版本    类型   提交      说明');
  for (const r of rows) {
    const kind = r.kind === 'major' ? '大版本' : '小版本';
    const commit = (r.commit ?? '-').slice(0, 7);
    console.log(`${r.version.padEnd(6)}  ${kind}  ${commit}  ${r.message}`);
  }
  return rows;
}

/**
 * 求「线上应回到的内容」。
 * 优先读大版本快照；快照缺失时从 git 历史取回该版本源文件重新展开。
 */
async function remoteSourceForVersion(config, target, git) {
  const snap = readMajorSnapshot(config.root, target.remoteVersion);
  if (snap != null) return { source: snap, from: `大版本 ${target.remoteVersion} 快照` };
  try {
    const rel = path.relative(config.root, config.sourceAbs);
    const raw = await showFileAt(git, target.remoteCommit, rel);
    const templates = await loadTemplates(config.templatesDirAbs);
    const source = expand(raw, templates, { baseDir: path.dirname(config.sourceAbs) });
    return { source, from: `提交 ${String(target.remoteCommit).slice(0, 7)} 源文件重建` };
  } catch {
    return null;
  }
}

export async function revert(options) {
  const config = loadConfig(options);
  const siteName = options.site || config.site;
  const pageName = options.page || config.page;
  const to = options.to || 'HEAD';

  if (options.list) {
    return { versions: printVersions(config.root) };
  }

  const git = projectGit(config.root);
  if (!(await isRepo(git))) {
    throw new Error('当前项目不是 git 仓库，无法 revert。请先运行 `ftml init` 初始化');
  }
  if (!(await isClean(git))) {
    if (options.autoCommit) {
      // web 编辑器自动保存导致工作区常脏：先自动提交，再 revert
      await commitAll(git, 'ftml-cli revert 前自动提交');
    } else {
      throw new Error('工作区有未提交的改动。请先 commit 或 stash 再 revert');
    }
  }

  // 版本号 → git 提交
  const target = isVersionSpec(to) ? resolveVersionTarget(config.root, to) : null;
  if (target && !target.commit) {
    throw new Error(`版本 ${to} 没有记录对应的 git 提交，无法回退`);
  }
  const head = await headHash(git);

  // 版本号回退 = 把「该版本之后的所有提交」整体反向提交，使工作区回到该版本的
  // 内容。只反向 target 那一笔是错的：那等于「撤销这一版做过的事」——若该版本是
  // 新增了某文件，回退反而会把它删掉（dist/index.ftml 被上层改动时即 modify/delete
  // 冲突）。按 git 修订回退（--to <hash>）保持单笔语义，即撤销该提交。
  let hash;
  if (target && target.commit === head) {
    hash = head;
    console.log(`· 当前已是版本 ${to}，跳过本地 git revert`);
  } else {
    const gitTarget = target ? `${target.commit}..HEAD` : to;
    hash = await gitRevert(git, gitTarget, {
      message: `revert ${to}`,
      // 版本回退只回退「内容」：.ftml/ 是版本账本，不能跟着倒回去（否则
      // versions.json 会被删成空，revert 完版本列表就没了）
      keepFrom: target ? head : undefined,
      keepPaths: [ '.ftml' ],
    });
    console.log(`✓ 已 git revert ${to}（${String(gitTarget).slice(0, 7)} → 新提交 ${String(hash).slice(0, 7)}）`);
  }

  // dist/ 被 .gitignore 忽略，git revert 不会恢复产物：
  // 版本回退必须重建，普通回退沿用 --rebuild 行为
  if (options.rebuild || target) {
    await build(options);
  } else if (!fs.existsSync(config.outputAbs)) {
    throw new Error(`构建产物不存在: ${config.outputAbs}。请先运行 ftml build 或加 --rebuild`);
  }

  if (isNegated(options, 'wikidot')) {
    console.log('· 已跳过线上回退（--no-wikidot）');
    appendHistory(config.root, { commit_hash: hash, comment: `revert ${to}`, type: 'revert' });
    return { hash, versions: listVersions(config.root) };
  }

  if (!siteName || !pageName) {
    throw new Error('缺少 site/page，无法回退线上。请配置或在命令行指定 --site/--page');
  }

  // 线上内容：版本回退取该版本快照；普通回退用重建后的产物
  let remote = { source: fs.readFileSync(config.outputAbs, 'utf8'), from: '本地构建产物' };
  if (target) {
    const resolved = await remoteSourceForVersion(config, target, git);
    if (resolved) {
      remote = resolved;
    } else {
      console.log(`警告: 未找到大版本 ${target.remoteVersion} 的快照，线上回退使用当前重建产物`);
    }
  }

  const comment = `ftml revert ${to}`;
  const { revisionsCount, compat } = await pushPageSource({
    siteName,
    pageName,
    source: remote.source,
    comment,
    clientFactory: options.clientFactory,
  });
  if (compat.changed) {
    console.log(`· 为兼容 Wikidot 自动补全 ${compat.changes.length} 处行内闭合`);
  }

  appendHistory(config.root, {
    commit_hash: hash,
    comment,
    version: to,
    wikidotVersion: revisionsCount,
    type: 'revert',
  });
  saveProjectMeta(config.sourceAbs, { site: siteName, page: pageName, lastRev: revisionsCount }, config.root);
  console.log(`✓ 已回退 ${to}（本地 ${String(hash).slice(0, 7)}），线上 ${siteName}:${pageName} 回到 ${remote.from}`);
  return { hash, versions: listVersions(config.root) };
}
