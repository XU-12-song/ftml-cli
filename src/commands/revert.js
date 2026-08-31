/**
 * revert — 真 git revert + 把恢复后的产物回推 Wikidot
 *
 *   ftml revert [--to <commit>] [--site <site>] [--page <page>] [--no-wikidot]
 *
 * 同时做两件事：
 *   1. git revert <commit>（默认 HEAD）：生成反向提交，恢复源文件与构建产物到上版
 *   2. 把恢复后的构建产物 edit 回 Wikidot 页面（与 submit 对称，即线上也回退）
 *
 * --to: 指定 git 提交（hash / HEAD~n 等，透传给 git revert）
 * --no-wikidot: 只做本地 git revert，不回推线上
 * site/page 优先级：命令行 > 配置文件 > .ftml/<源文件名>.json 元数据
 */

import fs from 'node:fs';
import { loadConfig, saveProjectMeta } from '../utils/config.js';
import { createClient, getSite, getPage, editPage } from '../utils/wikidot.js';
import { projectGit, gitRevert, isRepo, isClean } from '../utils/git.js';
import { appendHistory } from './submit.js';

export async function revert(options) {
  const config = loadConfig(options);
  const siteName = options.site || config.site;
  const pageName = options.page || config.page;
  const rev = options.to || 'HEAD';

  // 1. git revert
  const git = projectGit(config.root);
  if (!(await isRepo(git))) {
    throw new Error('当前项目不是 git 仓库，无法 revert。请先运行 `ftml init` 初始化');
  }
  if (!(await isClean(git))) {
    throw new Error('工作区有未提交的改动。请先 commit 或 stash 再 revert');
  }
  if (!fs.existsSync(config.outputAbs)) {
    throw new Error(`构建产物不存在: ${config.outputAbs}。请先运行 ftml build`);
  }

  const hash = await gitRevert(git, rev);

  // revert 后构建产物已被 git 恢复，读回即为上版
  const source = fs.readFileSync(config.outputAbs, 'utf8');

  // 2. 回推 Wikidot
  if (!options.noWikidot) {
    if (!siteName || !pageName) {
      throw new Error('缺少 site/page，无法回推 Wikidot。请配置或在命令行指定 --site/--page');
    }
    const client = await createClient();
    try {
      const site = await getSite(client, siteName);
      const page = await getPage(site, pageName);
      if (!page) {
        throw new Error(`页面不存在: ${pageName}`);
      }
      const comment = `ftml revert ${rev}`;
      await editPage(page, { source, comment });
      const { revisionsCount } = page;

      appendHistory(config.root, {
        commit_hash: hash,
        comment,
        wikidotVersion: revisionsCount,
        type: 'revert',
      });
      saveProjectMeta(config.sourceAbs, {
        site: siteName,
        page: pageName,
        lastRev: revisionsCount,
      }, config.root);
      console.log(`✓ 已 git revert ${rev}（${hash}）并回推 ${siteName}:${pageName}`);
    } finally {
      await client.close?.();
    }
  } else {
    console.log(`✓ 已 git revert ${rev}（${hash}，跳过回推线上）`);
  }
}
