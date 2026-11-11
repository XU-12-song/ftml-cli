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
import { loadConfig } from '../infra/config.js';
import { renderPreview } from '../render/preview.js';
import { buildPreviewDocument } from '../render/preview-page.js';
import { readThemeCss, refreshThemeCssInBackground, THEME_SOURCES } from '../render/theme.js';
import { getSiteLayout, normalizeSiteName } from '../infra/layout.js';
import { buildPageContext } from '../render/context.js';
import { formatDiagnostics } from '../render/diagnostics.js';
import { createClient } from '../infra/wikidot.js';
import { loadSettings } from '../domain/settings.js';
import type { Client } from '@ukwhatn/wikidot';
import type {
  PreviewCommandOptions,
  PreviewCommandResult,
} from '../types/commands/preview.ts';

export async function preview(
  options: PreviewCommandOptions
): Promise<PreviewCommandResult> {
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
  let client: Client | null = null;
  try {
    client = await createClient();
  } catch {
    client = null; // 无凭证：远程 include 解析关闭
  }

  const { html, htmlBlocks, styles, diagnostics } = await renderPreview(ftml, {
    page,
    includeBaseDir: path.dirname(r.input),
    includeTemplates: templates,
    client,
    modulePlaceholders: loadSettings().modulePlaceholders,
  });

  if (client) {
    try {
      await client.close();
    } catch {
      // 登出失败不阻断预览
    }
  }

  // 3. 报告解析/渲染诊断（不阻断输出）
  //    诊断完全来自 @wdprlib（parser/render 的 Diagnostic），这里连同
  //    severity / position / relatedPosition 一起还原成带源码上下文的输出
  const report = formatDiagnostics(diagnostics, ftml, { file: r.output });
  if (report) console.error(report);

  // 4. 输出：默认 build 产物同目录的 .html（如 dist/index.ftml → dist/index.html）。
  //    用 buildPreviewDocument 包装为完整文档：@wdprlib/render 只给正文 fragment，
  //    缺 <meta charset>/<body>，浏览器打开会乱码；再内联 @wdprlib/runtime 让
  //    tabview/collapsible/脚注等小部件在浏览器里可交互
  const defaultOut = config.outputAbs.endsWith('.ftml')
    ? config.outputAbs.slice(0, -'.ftml'.length) + '.html'
    : config.outputAbs + '.html';
  const outAbs = options.output ? path.resolve(options.output) : defaultOut;
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  // 目标站点结构：缓存优先（只有无缓存才联网），失败回退内置沙盒外壳。
  const layoutSite = normalizeSiteName(options.site || config.site);
  const layout = await getSiteLayout(layoutSite);
  const themeSources = layout?.themes?.length ? layout.themes : THEME_SOURCES;

  // 主题缓存命中就直接内联；缺失时输出文件先用远程 @import（浏览器打开时自行加载），
  // 同时在后台抓取整条 @import 链，下一次生成即可用上缓存。
  const { css: themeCss, missing: themeMissing } = readThemeCss({ sources: themeSources });
  if (themeMissing.length) {
    refreshThemeCssInBackground({ sources: themeSources });
  }
  const document = buildPreviewDocument({
    html,
    htmlBlocks,
    styles, // 之前漏传：styles 只进了上面的提示语，CSS 实际没写进产出文件
    title: config.page || page.fullName,
    themeCss,
    layout,
    themeSources,
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
async function openInBrowser(fileAbs: string): Promise<void> {
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
    console.error(`警告: 打开浏览器失败（${(e as Error).message}），预览文件仍在 ${fileAbs}`);
  }
}
