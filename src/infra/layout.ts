/**
 * layout.ts — 目标站点页面结构（`_template`）的抓取、解析与缓存
 *
 * 预览需要与真实站点一致的外壳：结构取自
 * `https://www.<site>.wikidot.com/_template` 的 `#container`，正文放进
 * `#page-content`、标题放进 `#page-title`。解析时把这两个位置替换成 marker，
 * 渲染时只做字符串替换，避免每次整篇重载都重新解析/序列化远端 HTML。
 *
 * 缓存分两层：
 *   - 进程内 memo（readSiteLayout 命中后常驻）
 *   - 磁盘 ~/.ftml-cli/cache/layout/<site>.json
 * 只在缓存缺失或显式 refresh 时联网；过期缓存继续可用，保证“仅切换站点才重新获取”。
 *
 * 容器里的 `<script>` 与 `on*` 属性会被移除：`_template` 带有 Wikidot/分析脚本，
 * 在预览 iframe（同源）里执行只会报错甚至导航跳走。
 */

import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { homeCacheDir } from './paths.js';
import type {
  LayoutCacheEntry,
  SiteLayout,
  SiteLayoutOptions,
  SiteLayoutRefreshResult,
} from '../types/infra/layout.ts';

/** 未选择目标站点时使用的默认沙盒站 */
export const DEFAULT_SITE = 'scpsandboxcn';

/** 正文 / 标题在 containerStructure 里的占位 marker */
export const CONTENT_MARKER = '<!--ftml:layout:content-->';
export const TITLE_MARKER = '<!--ftml:layout:title-->';

// v2：解析时补齐顶栏 <a> 包裹；旧缓存不含该结构，必须失效重抓
const CACHE_VERSION = 2 as const;
const FETCH_TIMEOUT_MS = 8000;
const SITE_NAME_RE = /^[a-z0-9-]+$/;
const ABSOLUTE_REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** 进程内缓存；key 为归一化站点名 */
const memo = new Map<string, SiteLayout>();

/**
 * 站点名归一化：空 → 默认沙盒站；支持 `https://www.scp-cn.wikidot.com/...`
 * 之类的输入；非法字符回落到默认站点（预览不应因目标配置异常而中断）。
 */
export function normalizeSiteName(input?: string | null): string {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return DEFAULT_SITE;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // 协议
  s = s.replace(/^www\./, '');
  s = s.replace(/\/.*$/, ''); // 路径
  s = s.replace(/\.wikidot\.com$/, '');
  return SITE_NAME_RE.test(s) ? s : DEFAULT_SITE;
}

function siteOrigin(site: string): string {
  // Wikidot 站点域名没有 www 前缀（加 www 会命中错误的 TLS 证书）
  return `https://${site}.wikidot.com`;
}

function templateUrl(site: string): string {
  return `${siteOrigin(site)}/_template`;
}

function layoutCacheDir(): string {
  return path.join(homeCacheDir(), 'layout');
}

function cachePathFor(site: string): string {
  return path.join(layoutCacheDir(), `${site}.json`);
}

/** 相对 URL → 站点绝对地址；已是绝对/特殊引用则原样返回 */
function absolutizeRef(ref: string, site: string): string {
  if (!ref || ABSOLUTE_REF.test(ref)) return ref;
  try {
    return new URL(ref, `${siteOrigin(site)}/`).href;
  } catch {
    return ref;
  }
}

/** 从 `#internal-style` 中提取 theme 注释标记之后的 @import URL */
function extractThemes(styleHtml: string | null | undefined, site: string): string[] {
  const css = String(styleHtml ?? '');
  const marker = '/* theme */';
  const at = css.indexOf(marker);
  const section = at >= 0 ? css.slice(at + marker.length) : css;
  const re = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*[^;]*;/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    const ref = (m[2] ?? m[4] ?? '').trim();
    if (!ref) continue;
    const abs = absolutizeRef(ref, site);
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

/**
 * 解析 `_template` 的 HTML 为 SiteLayout。
 * 缺少 `#container` 或 `#page-content` 时返回 null（调用方回退硬编码外壳）。
 */
export function parseSiteLayoutHtml(site: string, html: string): SiteLayout | null {
  const name = normalizeSiteName(site);
  const $ = load(String(html ?? ''), { xml: false }, false);

  const container = $('#container').first();
  if (!container.length) return null;

  const content = container.find('#page-content').first();
  if (!content.length) return null;

  // 标题缺失时补一个，保证 marker 总能落地
  if (!container.find('#page-title').length) {
    content.before('<div id="page-title"></div>');
  }
  container.find('#page-title').first().html(TITLE_MARKER);
  content.html(CONTENT_MARKER);

  // 顶栏的展开/折叠标签由 Wikidot 的前端脚本在运行时包上 <a>；预览不执行远端脚本，
  // 这里提前补上同样的锚点，否则顶栏只有裸文本，主题里的 #top-bar li a 样式全部失效。
  container.find('#top-bar .top-bar > ul > li').each((_, el) => {
    const li = $(el);
    const leading: AnyNode[] = [];
    let hasAnchor = false;
    for (const node of li.contents().toArray()) {
      if (node.type === 'tag' && node.name === 'ul') break;
      if (node.type === 'tag' && node.name === 'a') { hasAnchor = true; break; }
      leading.push(node);
    }
    if (hasAnchor) return;
    if (!leading.some((n) => n.type === 'text' && n.data.trim())) return;
    const anchor = $('<a href="#"></a>');
    li.prepend(anchor);
    for (const node of leading) anchor.append(node);
  });

  // 远端脚本与内联事件在预览里无意义且不安全
  container.find('script').remove();
  container.find('*').add(container).each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs;
    if (!attribs) return;
    for (const attr of Object.keys(attribs)) {
      if (/^on/i.test(attr)) delete attribs[attr];
    }
  });

  // 容器里的相对链接在 Blob URL 文档中会指向本地服务，统一补成站点绝对地址
  container.find('[href], [src], [action]').each((_, el) => {
    const node = el as { attribs?: Record<string, string> };
    const attribs = node.attribs;
    if (!attribs) return;
    for (const attr of ['href', 'src', 'action']) {
      const value = attribs[attr];
      if (value == null) continue;
      // javascript: 链接在预览里没有实际功能，且同源 iframe 中可能被误触执行
      if (/^\s*javascript:/i.test(value)) {
        delete attribs[attr];
        continue;
      }
      attribs[attr] = absolutizeRef(value, name);
    }
  });

  const themes = extractThemes($('#internal-style').first().html(), name);
  const containerStructure = container.html();
  if (!containerStructure) return null;

  return { site: name, containerStructure, themes };
}

/** 读取磁盘缓存；不存在/损坏/旧版本返回 null */
function readDisk(site: string): SiteLayout | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePathFor(site), 'utf8')) as LayoutCacheEntry;
    if (raw.v !== CACHE_VERSION) return null;
    if (typeof raw.containerStructure !== 'string' || !raw.containerStructure) return null;
    if (!Array.isArray(raw.themes)) return null;
    return { site, containerStructure: raw.containerStructure, themes: raw.themes };
  } catch {
    return null;
  }
}

function writeDisk(layout: SiteLayout): void {
  const p = cachePathFor(layout.site);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const entry: LayoutCacheEntry = {
    v: CACHE_VERSION,
    site: layout.site,
    fetchedAt: Date.now(),
    containerStructure: layout.containerStructure,
    themes: layout.themes,
  };
  fs.writeFileSync(p, JSON.stringify(entry), 'utf8');
}

/**
 * 同步读取布局：进程内 memo → 磁盘（容忍过期），不联网。
 */
export function readSiteLayout(site?: string | null): SiteLayout | null {
  const name = normalizeSiteName(site);
  const hit = memo.get(name);
  if (hit) return hit;
  const disk = readDisk(name);
  if (disk) memo.set(name, disk);
  return disk;
}

async function fetchLayout(site: string, fetchImpl: typeof fetch): Promise<SiteLayout> {
  const response = await fetchImpl(templateUrl(site), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (!html.trim()) throw new Error('空响应');
  const layout = parseSiteLayoutHtml(site, html);
  if (!layout) throw new Error('页面结构解析失败：缺少 #container 或 #page-content');
  writeDisk(layout);
  memo.set(site, layout);
  return layout;
}

/**
 * 获取布局：有缓存（且未要求 refresh）直接返回；否则按需联网。
 * 联网失败时回退旧缓存；完全没有则返回 null（调用方使用硬编码外壳）。
 */
export async function getSiteLayout(
  site?: string | null,
  { fetchImpl = globalThis.fetch, allowNetwork = true, refresh = false }: SiteLayoutOptions = {},
): Promise<SiteLayout | null> {
  const name = normalizeSiteName(site);
  const cached = readSiteLayout(name);
  if (cached && !refresh) return cached;
  if (!allowNetwork) return cached;
  const result = await refreshSiteLayout(name, { fetchImpl, allowNetwork });
  return result.layout ?? cached;
}

/**
 * 强制联网刷新布局。失败不抛：返回旧缓存（可能为 null）与错误信息。
 */
export async function refreshSiteLayout(
  site?: string | null,
  { fetchImpl = globalThis.fetch, allowNetwork = true }: SiteLayoutOptions = {},
): Promise<SiteLayoutRefreshResult> {
  const name = normalizeSiteName(site);
  if (!allowNetwork) return { layout: readSiteLayout(name) };
  try {
    return { layout: await fetchLayout(name, fetchImpl) };
  } catch (e) {
    return {
      layout: readSiteLayout(name),
      error: (e as Error)?.message ?? String(e),
    };
  }
}

/** 清空进程内与磁盘缓存（测试用） */
export function clearLayoutCache(): void {
  memo.clear();
  fs.rmSync(layoutCacheDir(), { recursive: true, force: true });
}
