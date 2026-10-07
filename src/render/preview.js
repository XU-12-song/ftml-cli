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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { processWikitext } from '@wdprlib/parser';
import { renderWikitext, createSettings } from '@wdprlib/render';
import { expand, templatesSignature } from '../core/expand.js';
import { getSite, getPage, fetchPageSource } from '../infra/wikidot.js';
import { readPageCache, writePageCache } from '../infra/cache.js';
import { memoByFile } from '../infra/mtime-cache.js';
import { resolveIncludeFile } from '../domain/include-resolve.js';

// 解析逻辑在 domain（发布路径也要用同一套规则），这里转出保持既有 import 路径可用。
export { resolveIncludeFile };

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
 * @param {object} [opts.client] 已登录的 @ukwhatn/wikidot 客户端
 * @param {Array} opts.warnings 收集远程拉取失败的警告诊断
 * @param {boolean} [opts.allowNetwork] 是否允许联网补拉（false 时只用磁盘缓存）
 * @returns {Promise<{ source: string|null, from: 'cache'|'remote'|'miss' }>}
 */
async function fetchRemoteInclude(pageRef, { page, client, warnings, allowNetwork = true }) {
  const siteName = pageRef.site ?? page?.site;
  if (!siteName) return { source: null, from: 'miss' };
  const label = pageRef.site ? `${pageRef.site}:${pageRef.page}` : pageRef.page;

  // 1. 磁盘缓存命中 → 直接用（离线也能解析 include）
  const cached = readPageCache(siteName, pageRef.page);
  if (cached != null) return { source: cached, from: 'cache' };

  // 2. 未命中 → 网络拉取，成功后写回缓存
  if (!client || !allowNetwork) return { source: null, from: 'miss' };
  try {
    const siteObj = await getSite(client, siteName);
    const pageObj = await getPage(siteObj, pageRef.page);
    if (!pageObj) return { source: null, from: 'miss' };
    const source = await fetchPageSource(pageObj);
    writePageCache(siteName, pageRef.page, source);
    return { source, from: 'remote' };
  } catch (e) {
    warnings.push({
      severity: 'warning',
      code: 'remote-include-failed',
      message: `远程拉取 [[include ${label}]] 失败: ${e.message}`,
      position: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
    });
    return { source: null, from: 'miss' };
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
 * @param {boolean} [options.allowNetwork] 是否允许联网补拉远程 include（默认 true；false 时只用磁盘缓存）
 * @returns {{ html, styles, htmlBlocks, diagnostics, includes, dependencies }}
 *   includes: 本次渲染解析的 [[include]] 列表 [{ site, page, from }]（from: local/cache/remote/miss）
 */
export async function renderPreview(
  ftml,
  { page, styleMode = 'inline', includeBaseDir, includeTemplates, client, allowNetwork = true } = {}
) {
  const settings = { ...createSettings('page'), allowStyleElements: true };
  const remoteWarnings = [];
  const includes = [];

  const dataProvider = includeBaseDir || client
    ? {
      fetchInclude: async (pageRef) => {
        const label = { site: pageRef.site ?? page?.site ?? null, page: pageRef.page };
        // 1. 本地文件（基准目录内 .ftml）
        if (includeBaseDir) {
          const fileAbs = resolveIncludeFile(pageRef, includeBaseDir, page?.site);
          if (fileAbs) {
            includes.push({ ...label, from: 'local', path: fileAbs });
            // fetchInclude 是热渲染路径里唯一反复发生的「读盘 + 展开」点：
            // 按文件 mtime/size 复用；模板表变化经 extra 键使缓存失效。
            return memoByFile(
              'include',
              fileAbs,
              () => {
                const raw = readFileSync(fileAbs, 'utf8');
                return includeTemplates
                  ? expand(raw, includeTemplates, { baseDir: path.dirname(fileAbs) })
                  : raw;
              },
              includeTemplates ? templatesSignature(includeTemplates) : ''
            );
          }
        }
        // 2. 本地缺失 → 磁盘缓存 / 已登录客户端远程拉取（模板随后统一展开）
        const r = await fetchRemoteInclude(pageRef, {
          page,
          client,
          warnings: remoteWarnings,
          allowNetwork,
        });
        includes.push({ ...label, from: r.from });
        if (r.source == null) return null;
        // 先展开模板/组件，再交回 parser 解析（嵌套 include 由 parser 迭代展开）
        return includeTemplates
          ? expand(r.source, includeTemplates, { baseDir: includeBaseDir })
          : r.source;
      },
    }
    : undefined;
  const doc = await processWikitext(ftml, {
    page: page ?? { fullName: 'preview', unixName: 'preview', tags: [] },
    settings,
    dataProvider,
  });

  const result = await renderWikitext(doc, { styleMode });
  // 注：Wikidot 处理顺序型分歧（embed-structural-escape）的检测只在 validate
  // 路径（collectProblems）里跑，不进热渲染路径——它需要额外一趟 tokenize，
  // 而渲染期结果与它无关（见 compat/divergence.js）。
  return {
    html: result.html,
    htmlBlocks: result.htmlBlocks,
    styles: result.styles,
    diagnostics: [
      ...(result.diagnostics ?? doc.diagnostics ?? []),
      ...remoteWarnings,
    ],
    includes,
    dependencies: doc.dependencies ?? [],
  };
}
