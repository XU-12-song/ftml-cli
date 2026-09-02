/**
 * preview.js — 用 @wdprlib/parser + @wdprlib/render 把展开后的 FTML 渲染为 HTML
 *
 * 管线: processWikitext(source, { page, settings, dataProvider }) → renderWikitext(doc, { styleMode })
 *
 * 关键点:
 * - settings 必须 `allowStyleElements: true`，否则 [[module CSS]] 收集到的样式会被丢弃
 * - styleMode: 'inline' 把收集到的 CSS 以 <style> 追加在 HTML 末尾（单个自包含文件）
 * - page 上下文可选：提供了 site/page 才能正确解析相对链接、站内引用
 * - [[include]]：提供 includeBaseDir 后按本地 .ftml 文件解析（见 resolveIncludeFile），
 *   读到的源码先走 expand 展开模板/组件，再交给 parser 渲染。嵌套 include 由 parser
 *   文本级迭代展开（includeMaxIterations 限制轮数）——注意 Wikidot 规则：[[include]]
 *   必须出现在行首
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { processWikitext } from '@wdprlib/parser';
import { renderWikitext, createSettings } from '@wdprlib/render';
import { expand } from '../core/expand.js';
import { getSite, getPage, fetchPageSource } from './wikidot.js';
import { readPageCache, writePageCache } from './cache.js';
/**
 * 把 include 的 pageRef 解析为本地 .ftml 文件。
 *
 * 候选路径（按顺序，以 baseDir 为基准）：
 *   同站 include：
 *     1. page 中的 `:` 换成 `/`：`component:box` → `component/box.ftml`
 *     2. 原样：`component:box` → `component:box.ftml`
 *   跨站 include（site ≠ 当前站点）：按本地镜像解析
 *     1. `<site>/<page 斜杠化>`：`:scp-wiki-cn:theme:parallel` → `scp-wiki-cn/theme/parallel.ftml`
 *     2. `<site>/<page 原样>` → `scp-wiki-cn/theme:parallel.ftml`
 *     3. `<page 斜杠化>`（主题等常见镜像布局）：→ `theme/parallel.ftml`
 *     4. `<page 原样>` → `theme:parallel.ftml`
 *
 * 解析结果限制在 baseDir 内，拒绝 `../` 越界；找不到返回 null（渲染为"页面不存在"占位）。
 *
 * @param {{ site: string|null, page: string }} pageRef
 * @param {string} baseDir 基准目录（源文件所在目录）
 * @param {string} [currentSite] 当前页面所属站点，用于判断是否跨站
 * @returns {string|null} 文件绝对路径，找不到返回 null
 */
export function resolveIncludeFile(pageRef, baseDir, currentSite) {
  const { site, page } = pageRef;
  const slashRef = page.replaceAll(':', '/');
  const crossSite = Boolean(site) && site !== currentSite;
  const candidates = crossSite
    ? [
      path.join(baseDir, site, `${slashRef}.ftml`),
      path.join(baseDir, site, `${page}.ftml`),
      path.join(baseDir, `${slashRef}.ftml`),
      path.join(baseDir, `${page}.ftml`),
    ]
    : [
      path.join(baseDir, `${slashRef}.ftml`),
      path.join(baseDir, `${page}.ftml`),
    ];
  for (const p of candidates) {
    const abs = path.resolve(p);
    if (!abs.startsWith(path.resolve(baseDir) + path.sep) && abs !== path.resolve(baseDir)) {
      continue; // 越界路径跳过（防御 page 名含 ../）
    }
    if (existsSync(abs)) return abs;
  }
  return null;
}

/**
 * 远程回退：本地找不到 include 时，用已登录的 Wikidot 客户端拉取页面源码。
 *
 * 磁盘缓存（~/.ftml-cli/cache/<site>/<page>.ftml，跨项目共享）优先：
 * 命中直接返回；未命中才走网络，拉取成功后写回缓存。
 *
 * 站点名取 pageRef.site ?? page.site（同站 include 用当前页面所属站点）。
 * 页面不存在或请求失败返回 null（渲染「页面不存在」占位），失败信息记为警告诊断。
 *
 * @param {{ site: string|null, page: string }} pageRef
 * @param {object} opts
 * @param {object} [opts.page] 页面上下文（提供当前站点名）
 * @param {object} opts.client 已登录的 @ukwhatn/wikidot 客户端
 * @param {Array} opts.warnings 收集远程拉取失败的警告诊断
 * @returns {Promise<string|null>}
 */
async function fetchRemoteInclude(pageRef, { page, client, warnings }) {
  const siteName = pageRef.site ?? page?.site;
  if (!siteName || !client) return null;
  const label = pageRef.site ? `${pageRef.site}:${pageRef.page}` : pageRef.page;

  // 1. 磁盘缓存命中 → 直接返回
  const cached = readPageCache(siteName, pageRef.page);
  if (cached != null) return cached;

  // 2. 未命中 → 网络拉取，成功后写回缓存
  try {
    const siteObj = await getSite(client, siteName);
    const pageObj = await getPage(siteObj, pageRef.page);
    if (!pageObj) return null;
    const source = await fetchPageSource(pageObj);
    writePageCache(siteName, pageRef.page, source);
    return source;
  } catch (e) {
    warnings.push({
      severity: 'warning',
      code: 'remote-include-failed',
      message: `远程拉取 [[include ${label}]] 失败: ${e.message}`,
      position: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
    });
    return null;
  }
}

/**
 * 渲染 FTML 源码为 HTML。
 *
 * @param {string} ftml 展开后的 FTML 源码
 * @param {object} [options]
 * @param {object} [options.page] 页面上下文（WikitextPageContext）：fullName/unixName/tags/site/domain
 * @param {'inline'|'separate'} [options.styleMode] inline=样式内联进 HTML；separate=单独收集到 styles
 * @param {string} [options.includeBaseDir] 解析 [[include]] 的基准目录；省略则本地解析关闭
 * @param {Map} [options.includeTemplates] 模板表，include 目标源码展开模板时使用
 * @param {object} [options.client] 已登录的 @ukwhatn/wikidot 客户端；提供后本地找不到的 include 自动远程拉取
 * @returns {{ html: string, styles: string[], diagnostics: Array }}
 */
export async function renderPreview(
  ftml,
  { page, styleMode = 'inline', includeBaseDir, includeTemplates, client } = {}
) {
  const settings = { ...createSettings('page'), allowStyleElements: true };
  const remoteWarnings = [];

  const dataProvider = includeBaseDir || client
    ? {
      fetchInclude: async (pageRef) => {
        // 1. 本地文件（基准目录内 .ftml）
        let source = null;
        let fileAbs = null;
        if (includeBaseDir) {
          fileAbs = resolveIncludeFile(pageRef, includeBaseDir, page?.site);
          if (fileAbs) source = readFileSync(fileAbs, 'utf8');
        }
        // 2. 本地缺失 → 已登录客户端远程拉取（页面源码；模板随后统一展开）
        if (source == null && client) {
          source = await fetchRemoteInclude(pageRef, { page, client, warnings: remoteWarnings });
        }
        if (source == null) return null;
        // 先展开模板/组件，再交回 parser 解析（嵌套 include 由 parser 迭代展开）
        return includeTemplates
          ? expand(source, includeTemplates, { baseDir: fileAbs ? path.dirname(fileAbs) : includeBaseDir })
          : source;
      },
    }
    : undefined;

  const doc = await processWikitext(ftml, {
    page: page ?? { fullName: 'preview', unixName: 'preview', tags: [] },
    settings,
    dataProvider,
  });

  const result = await renderWikitext(doc, { styleMode });

  return {
    html: result.html,
    styles: result.styles,
    diagnostics: [...(result.diagnostics ?? doc.diagnostics ?? []), ...remoteWarnings],
  };
}