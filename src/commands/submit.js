/**
 * submit — 把构建产物提交到 Wikidot 页面
 *
 *   ftml submit [-m "编辑注释"] [--site <site>] [--page <page>] [--source <file>] [--no-build]
 *
 * 默认先 build 再提交（除非 --no-build，直接提交 output 文件）。
 * -m/--message: 编辑注释（必填，避免无说明的提交）
 */

import fs from 'node:fs';
import path from 'node:path';
import { build } from './build.js';
import { loadConfig } from '../utils/config.js';
import { createClient, getSite, getPage, editPage } from '../utils/wikidot.js';

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
    console.log(`✓ 已提交 ${siteName}:${pageName}（${source.length} 字节，注释: ${comment}）`);
  } finally {
    await client.close?.();
  }
}
