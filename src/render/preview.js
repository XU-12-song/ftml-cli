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
import { DEFAULT_MODULE_CAPS } from './module-caps.js';
import { applyListUsersRepeat } from './module-placeholders.js';
import { createModuleDataProvider } from './module-data.js';

// 解析逻辑在 domain（发布路径也要用同一套规则），这里转出保持既有 import 路径可用。
export { resolveIncludeFile };

/**
 * 页面名归一化（与 @wdprlib/render 的 normalizePageName 同口径）。
 * renderer 传给 resolvePageExistence 的目标已归一化，已知页面也要归一化后再比较。
 */
function normalizePageName(page) {
  let name = Array.from(String(page ?? '').trim().replace(/^\//, '').normalize('NFKC'), (c) =>
    c.toLowerCase()
  ).join('').replace(/[^\p{L}\p{N}:_-]/gu, '-');
  const category = name.lastIndexOf(':');
  if (category !== -1) {
    name = name.slice(0, category).replace(/:/g, '-') + name.slice(category);
  }
  name = name
    .replace(/(?<!^|:)_/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-*([:_])-*/g, '$1')
    .replace(/^:|:$/g, '');
  return name.startsWith('_default:') ? name.slice(9) : name;
}

/** 只报一次的远程不可用警告（同一类原因不随 include 数量刷屏） */
function pushWarningOnce(warnings, warning) {
  if (!warnings.some((w) => w.code === warning.code)) warnings.push(warning);
}

const INDENTED_INCLUDE_RE = /^[ \t]+\[\[\s*include(?=\s|\]|$)/i;

/**
 * 找出「行首带空白」的 [[include]]。
 *
 * Wikidot 只在行首识别 include；前面有空格/制表符时整行会被当作普通文本，
 * 解析器根本不会调用 dataProvider——表现为「没报错、也没拉取」。这里显式告警，
 * 避免用户误以为是网络或缓存问题。跳过 [[code]] 块与 [!-- --] 注释。
 */
export function findIndentedIncludes(source) {
  const out = [];
  const lines = String(source ?? '').split(/\r\n|\r|\n/);
  let inCode = false;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inComment) {
      if (line.includes('--]')) inComment = false;
      continue;
    }
    if (/^\s*\[\[\/code\s*\]\]/i.test(line)) { inCode = false; continue; }
    if (/^\s*\[\[code(?:\s|\]|$)/i.test(line)) { inCode = true; continue; }
    if (inCode) continue;
    if (line.includes('[!--') && !line.includes('--]')) { inComment = true; continue; }

    const visible = line.replace(/\[!--[\s\S]*?--\]/g, '');
    const m = visible.match(INDENTED_INCLUDE_RE);
    if (!m) continue;
    const column = m[0].indexOf('[[') + 1;
    out.push({
      severity: 'warning',
      code: 'include-indented',
      message: '[[include]] 必须从行首开始；前导空白会让 Wikidot 直接忽略该行',
      position: {
        start: { line: i + 1, column },
        end: { line: i + 1, column: column + 2 },
      },
    });
  }
  return out;
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
 * @param {object} [opts.client] 已登录的 @ukwhatn/wikidot 客户端
 * @param {Array} opts.warnings 收集远程拉取失败的警告诊断
 * @param {boolean} [opts.allowNetwork] 是否允许联网补拉（false 时只用磁盘缓存）
 * @returns {Promise<{ source: string|null, from: 'cache'|'remote'|'miss' }>}
 */
async function fetchRemoteInclude(pageRef, {
  page,
  client,
  warnings,
  allowNetwork = true,
  clientError = null,
}) {
  const siteName = pageRef.site ?? page?.site;
  const label = pageRef.site ? `${pageRef.site}:${pageRef.page}` : pageRef.page;
  if (!siteName) {
    if (allowNetwork) {
      pushWarningOnce(warnings, {
        severity: 'warning',
        code: 'remote-include-no-site',
        message: `无法联网解析 [[include ${pageRef.page}]]：缺少站点名。请设置目标站点，或使用 :site:page 形式`,
        position: null,
      });
    }
    return { source: null, from: 'miss' };
  }
  // 1. 磁盘缓存命中 → 直接用（离线也能解析 include）
  const cached = readPageCache(siteName, pageRef.page);
  if (cached != null) return { source: cached, from: 'cache' };
  // 2. 未命中 → 网络拉取，成功后写回缓存
  if (!allowNetwork) return { source: null, from: 'miss' };
  if (!client) {
    // 联网刷新已被明确请求，却没有可用的客户端：把原因说清楚，不要静默 miss
    pushWarningOnce(warnings, {
      severity: 'warning',
      code: 'remote-include-no-client',
      message: `无法联网解析远程 [[include ${label}]]：${clientError?.message || '未登录 Wikidot，请先点击账号按钮登录'}`,
      position: null,
    });
    return { source: null, from: 'miss' };
  }
  try {
    const siteObj = await getSite(client, siteName);
    const pageObj = await getPage(siteObj, pageRef.page);
    if (!pageObj) {
      warnings.push({
        severity: 'warning',
        code: 'remote-include-not-found',
        message: `远程页面不存在或无权访问: ${siteName}:${pageRef.page}`,
        position: null,
      });
      return { source: null, from: 'miss' };
    }
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
 * @param {Error|null} [options.clientError] 客户端创建失败的原因（allowNetwork 但未登录时用于诊断）
 * @returns {{ html, styles, htmlBlocks, diagnostics, includes, dependencies }}
 *   includes: 本次渲染解析的 [[include]] 列表 [{ site, page, from }]（from: local/cache/remote/miss）
 */
export async function renderPreview(
  ftml,
  {
    page,
    styleMode = 'inline',
    includeBaseDir,
    includeTemplates,
    client,
    allowNetwork = true,
    clientError = null,
    moduleMode = 'placeholder',
    modulePlaceholders,
    moduleCaps = DEFAULT_MODULE_CAPS,
  } = {}
) {
  const settings = { ...createSettings('page'), allowStyleElements: true };
  const remoteWarnings = [];
  const sourceWarnings = findIndentedIncludes(ftml);
  const includes = [];

  // ListUsers 在 Wikidot 里只有当前用户一行；占位模式允许复制块来观察多行布局。
  const source = moduleMode === 'placeholder'
    ? applyListUsersRepeat(ftml, modulePlaceholders?.listUsers?.count)
    : ftml;

  const moduleData = createModuleDataProvider({
    mode: moduleMode,
    placeholders: modulePlaceholders,
    page,
    client,
    clientError,
    caps: moduleCaps,
  });

  const includeFetcher = includeBaseDir || client
    ? async (pageRef) => {
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
          clientError,
        });
        includes.push({ ...label, from: r.from });
        if (r.source == null) return null;
        // 先展开模板/组件，再交回 parser 解析（嵌套 include 由 parser 迭代展开）
        return includeTemplates
          ? expand(r.source, includeTemplates, { baseDir: includeBaseDir })
          : r.source;
      }
    : null;

  const dataProvider = {
    ...(includeFetcher ? { fetchInclude: includeFetcher } : {}),
    ...moduleData.fetchers,
  };
  const doc = await processWikitext(source, {
    page: page ?? { fullName: 'preview', unixName: 'preview', tags: [] },
    settings,
    dataProvider,
  });

  // 已知存在的页面：当前页 + ListPages（真实或占位）返回的页面。
  // 不传时 renderer 会把所有页面链接标成 newpage（红链）。
  if (page?.fullName) moduleData.knownPages.add(page.fullName);
  const knownPages = new Set(
    [...moduleData.knownPages].map(normalizePageName).filter(Boolean)
  );
  const result = await renderWikitext(doc, {
    styleMode,
    resolvers: {
      resolvePageExistence: async (targets) => new Set(targets.filter((t) => knownPages.has(t))),
    },
  });
  // 注：Wikidot 处理顺序型分歧（embed-structural-escape）的检测只在 validate
  // 路径（collectProblems）里跑，不进热渲染路径——它需要额外一趟 tokenize，
  // 而渲染期结果与它无关（见 compat/divergence.js）。
  return {
    html: result.html,
    htmlBlocks: result.htmlBlocks,
    styles: result.styles,
    diagnostics: [
      ...sourceWarnings,
      ...(result.diagnostics ?? doc.diagnostics ?? []),
      ...remoteWarnings,
      ...moduleData.warnings,
    ],
    includes,
    dependencies: doc.dependencies ?? [],
    moduleResolution: {
      mode: moduleMode,
      fallback: moduleData.summary.fallback,
      warnings: moduleData.warnings,
      summary: moduleData.summary,
    },
  };
}
