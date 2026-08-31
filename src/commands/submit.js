/**
 * submit — 构建产物提交到 Wikidot + 本地 git 提交
 *
 *   ftml submit [-m "编辑注释"] [--site <site>] [--page <page>] [--source <file>] [--no-build]
 *
 * 默认先 build 再提交（除非 --no-build，直接提交 output 文件）。
 * 成功后：
 *   - 本地 git commit（记录与线上提交的对应关系）
 *   - 追加 .ftml/history.json
 *   - 把 site/page/lastRev 写入 .ftml/<源文件名>.json 元数据
 */

import fs from 'node:fs';
import path from 'node:path';
import { build } from './build.js';
import { loadConfig, saveProjectMeta } from '../utils/config.js';
import { createClient, getSite, getPage, editPage } from '../utils/wikidot.js';
import { projectGit, commitAll } from '../utils/git.js';
import { historyPath } from '../utils/paths.js';

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

export async function submit(options) {
  const config = loadConfig(options);

  // 构建产物
  let fileAbs;
  if (options.noBuild) {
    fileAbs = options.source
      ? path.resolve(options.source)
      : config.outputAbs;
    if (!fs.existsSync(fileAbs)) {
      throw new Error(`产物不存在: ${fileAbs}。请先运行 ftml build 或用 --source 指定文件`);
    }
  } else {
    const r = await build(options);
    fileAbs = r.output;
  }
  const source = fs.readFileSync(fileAbs, 'utf8');

  const siteName = options.site || config.site;
  const pageName = options.page || config.page;
  const comment = options.message || 'ftml-cli 提交';

  const client = await createClient();
  try {
    const site = await getSite(client, siteName);
    const page = await getPage(site, pageName);
    if (!page) {
      throw new Error(`页面不存在: ${pageName}。请先创建页面再提交`);
    }

    await editPage(page, { source, comment });
    const { revisionsCount } = page;

    // 本地 git 提交（记录与线上对应关系）
    const git = projectGit(config.root);
    const { hash } = await commitAll(git, comment);
    appendHistory(config.root, {
      commit_hash: hash,
      comment,
      wikidotVersion: revisionsCount,
    });

    // 站点/页面元数据落盘：.ftml/<源文件名>.json
    saveProjectMeta(config.sourceAbs, {
      site: siteName,
      page: pageName,
      lastRev: revisionsCount,
    }, config.root);

    console.log(`✓ 已提交 ${siteName}:${pageName}（${Buffer.byteLength(source, 'utf8')} 字节，注释: ${comment}）`);
  } finally {
    await client.close?.();
  }
}
