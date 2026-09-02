/**
 * preview — 构建并把展开后的 FTML 渲染为 HTML 预览
 *
 *   ftml preview [-s <source>] [-o <preview.html>] [-t <templates>] [--site <site>] [--page <page>] [--open]
 *
 * 流程: build（展开模板，产物写入配置的 output）→ 读回展开 FTML → @wdprlib 渲染为 HTML。
 * 始终写入文件：默认输出为 build 产物的同名 .html（dist/index.ftml → dist/index.html），
 * -o 覆盖；--open 用系统浏览器打开。
 */

import fs from 'node:fs';
import path from 'node:path';
import { build } from './build.js';
import { loadTemplates } from '../core/expand.js';
import { loadConfig } from '../utils/config.js';
import { renderPreview } from '../utils/preview.js';
import { buildPreviewDocument } from '../utils/preview-page.js';
import { createClient } from '../utils/wikidot.js';

/** 构造渲染用的页面上下文（未配置 site/page 时给占位值） */
export function buildPageContext({ site, page }) {
  const fullName = page || 'preview';
  const unixName = fullName.includes(':') ? fullName.slice(fullName.lastIndexOf(':') + 1) : fullName;
  return {
    fullName,
    unixName,
    tags: [],
    site: site || undefined,
    domain: site ? `${site}.wikidot.com` : undefined,
    urlPath: fullName === 'preview' ? undefined : `/${fullName}`,
  };
}

export async function preview(options) {
  const config = loadConfig(options);

  // 1. 展开模板（复用 build，产物写配置的 output）
  const r = await build(options);
  const ftml = fs.readFileSync(r.output, 'utf8');

  // 2. 渲染 HTML（include 以源文件目录为基准解析本地 .ftml）
  const page = buildPageContext({
    site: options.site || config.site,
    page: options.page || config.page,
  });
  const templates = await loadTemplates(config.templatesDirAbs);

  // 本地找不到的 include 自动用已登录客户端远程拉取；未登录则跳过（渲染占位）
  let client = null;
  try {
    client = await createClient();
  } catch {
    client = null; // 无凭证：远程 include 解析关闭
  }

  const { html, styles, diagnostics } = await renderPreview(ftml, {
    page,
    includeBaseDir: path.dirname(r.input),
    includeTemplates: templates,
    client,
  });

  if (client) {
    try {
      await client.close();
    } catch {
      // 登出失败不阻断预览
    }
  }

  // 3. 报告解析/渲染诊断（不阻断输出）
  for (const d of diagnostics) {
    const loc = d.position?.start ? `:${d.position.start.line}` : '';
    console.error(`警告${loc}: ${d.message}（${d.code}）`);
  }

  // 4. 输出：默认 build 产物同目录的 .html（如 dist/index.ftml → dist/index.html）。
  //    用 buildPreviewDocument 包装为完整文档：@wdprlib/render 只给正文 fragment，
  //    缺 <meta charset>/<body>，浏览器打开会乱码；再内联 @wdprlib/runtime 让
  //    tabview/collapsible/脚注等小部件在浏览器里可交互
  const defaultOut = config.outputAbs.endsWith('.ftml')
    ? config.outputAbs.slice(0, -'.ftml'.length) + '.html'
    : config.outputAbs + '.html';
  const outAbs = options.output ? path.resolve(options.output) : defaultOut;
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const document = buildPreviewDocument({
    html,
    title: config.page || page.fullName,
  });
  fs.writeFileSync(outAbs, document, 'utf8');
  const size = Buffer.byteLength(document, 'utf8');
  const stylesNote = styles.length ? `，${styles.length} 段样式` : '';
  console.log(`✓ 预览已生成 → ${outAbs}（${size} 字节${stylesNote}）`);
  if (options.open) {
    await openInBrowser(outAbs);
  }

  return { html: document, styles, bytes: Buffer.byteLength(document, 'utf8') };
}

/** 用系统默认浏览器打开文件（跨平台） */
async function openInBrowser(fileAbs) {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);
  const url = `file://${fileAbs}`;
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      await execAsync(`open "${url}"`);
    } else if (platform === 'win32') {
      await execAsync(`start "" "${url}"`);
    } else {
      await execAsync(`xdg-open "${url}"`);
    }
  } catch (e) {
    console.error(`警告: 打开浏览器失败（${e.message}），预览文件仍在 ${fileAbs}`);
  }
}
