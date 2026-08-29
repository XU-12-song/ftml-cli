/**
 * revert — 从 Wikidot 拉取线上版本，覆盖本地（或恢复历史修订）
 *
 *   ftml revert [--site <site>] [--page <page>] [--to <revNo|id>] [--output <file>]
 *
 * 默认：拉取页面当前线上源码，覆盖本地 source（即撤销本地改动，恢复线上）。
 * --to: 指定历史修订号（revNo），拉取该版本的源码并覆盖本地。
 * --output: 不覆盖本地 source，而是写到指定文件。
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../utils/config.js';
import {
  createClient,
  getSite,
  getPage,
  fetchPageSource,
  fetchRevisions,
  fetchRevisionSource,
} from '../utils/wikidot.js';

export async function revert(options) {
  const config = loadConfig(options);
  const siteName = options.site || config.site;
  const pageName = options.page || config.page;

  const client = await createClient();
  try {
    const site = await getSite(client, siteName);
    const page = await getPage(site, pageName);
    if (!page) {
      throw new Error(`页面不存在: ${pageName}`);
    }

    let source;
    let label;
    if (options.to !== undefined) {
      const revisions = await fetchRevisions(page);
      const rev = revisions.find(
        (r) => String(r.revNo) === String(options.to) || String(r.id) === String(options.to)
      );
      if (!rev) {
        const nums = revisions.map((r) => r.revNo).slice(0, 10).join(', ');
        throw new Error(`找不到修订 ${options.to}。最近的修订号: ${nums}`);
      }
      source = await fetchRevisionSource(rev);
      label = `修订 #${rev.revNo}`;
    } else {
      source = await fetchPageSource(page);
      label = '线上当前版本';
    }

    if (source == null) {
      throw new Error('线上版本源码为空');
    }

    // 写出
    if (options.output) {
      const outAbs = path.resolve(options.output);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, source, 'utf8');
      console.log(`✓ 已写入 ${outAbs}（${label}，${source.length} 字节）`);
    } else {
      fs.writeFileSync(config.sourceAbs, source, 'utf8');
      console.log(`✓ 已用 ${label} 覆盖本地 ${config.sourceAbs}`);
    }
  } finally {
    await client.close?.();
  }
}
