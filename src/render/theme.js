/**
 * theme.js — 预览沙盒主题样式表的本地化
 *
 * 预览文档原先靠两条远程 `@import` 引入基础主题（CloudFront base/style.css）与
 * 沙盒主题（sigma9_ch_sandbox.min.css）。`@import` 是**异步、不阻塞渲染**的样式表
 * 加载：网络慢或失败时浏览器先按「无样式」渲染文档，页面就整体显示为纯黑白——
 * 这正是「渲染后有概率变黑白」（重载时命中/未命中不定）。网络失败时更会一直保持。
 *
 * 这里把两份 CSS 取回并**内联**进预览文档的 `<style id="internal-style">`，
 * 使着色不再依赖渲染时刻的网络。主题 CSS 用相对路径引用图片（base 主题里有
 * `url(../images/...)`），内联后基准变成预览文档自身，因此取回时把相对 url()
 * 重写为绝对地址。样式表里还嵌套了 `@import`（FontAwesome / Google 字体 /
 * colstyle 模块），这些也一并递归取回展开——否则内联后会因「@import 必须在所有
 * 规则之前」被浏览器丢弃，图标与字体静默失效。字体图片文件本身仍按需远程加载，
 * 那不影响配色。
 *
 * 磁盘缓存：~/.ftml-cli/cache/theme/<sha1(url)>.json（含 fetchedAt，TTL 24h）。
 * 分工——
 *   readThemeCss()    同步，只读缓存（新鲜或过期都用），不联网。渲染路径用。
 *   refreshThemeCss() 异步，联网刷新缓存。web 启动与 `ftml preview` 用。
 * 拿不到缓存时退回原来的远程 @import（见 preview-page.js），行为与改动前一致。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { homeCacheDir } from '../infra/paths.js';

/** 预览文档依赖的两份主题样式表（base 主题 + 沙盒主题） */
export const THEME_SOURCES = [
  'https://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--theme/base/css/style.css',
  'https://sigma9.scpwikicn.com/cn/cn/sigma9_ch_sandbox.min.css',
];

/** 缓存有效期：24h（CloudFront 的 max-age 同为 86400000 秒） */
const TTL_MS = 24 * 60 * 60 * 1000;
/** 单次抓取超时：刷新失败就沿用旧缓存，不能让启动/预览卡住 */
const FETCH_TIMEOUT_MS = 8000;

/** 主题缓存目录：~/.ftml-cli/cache/theme */
export function themeCacheDir() {
  return path.join(homeCacheDir(), 'theme');
}

/** URL → 缓存文件（内容 JSON: { url, fetchedAt, css }） */
function cachePathFor(url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  return path.join(themeCacheDir(), `${hash}.json`);
}

/** 已是绝对/特殊引用的 url() 不动；其余按样式表自身地址解析 */
const ABSOLUTE_REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** 把相对 url(...) 重写为绝对地址（内联后基准会变成预览文档） */
export function absolutizeUrls(css, baseUrl) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _q, ref) => {
    if (ABSOLUTE_REF.test(ref)) return whole;
    try {
      return `url("${new URL(ref, baseUrl).href}")`;
    } catch {
      return whole; // 解析不了就保持原样，交给浏览器
    }
  });
}

/** 读缓存条目；不存在/损坏返回 null */
function readEntry(url) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePathFor(url), 'utf8'));
    return raw && typeof raw.css === 'string' ? raw : null;
  } catch {
    return null;
  }
}

/** 写缓存条目（失败不影响本次使用） */
function writeEntry(url, css) {
  const p = cachePathFor(url);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ url, fetchedAt: Date.now(), css }), 'utf8');
}

/** 是否仍在 TTL 内 */
function isFresh(entry, now = Date.now()) {
  return Boolean(entry) && now - entry.fetchedAt < TTL_MS;
}

/**
 * 同步读取主题 CSS，只走磁盘缓存（新鲜优先，过期也用），**不联网**。
 * 供渲染热路径使用：拿到什么就渲染什么，不引入等待。
 *
 * @param {object} [opts]
 * @param {string[]} [opts.sources]
 * @param {boolean} [opts.requireFresh] true 时过期缓存视为未命中
 * @returns {{ css: string, missing: string[] }} css 为空串表示缓存不全，调用方应退回 @import
 */
export function readThemeCss({ sources = THEME_SOURCES, requireFresh = false } = {}) {
  const parts = [];
  const missing = [];
  for (const url of sources) {
    const entry = readEntry(url);
    const usable = requireFresh ? isFresh(entry) : Boolean(entry);
    if (!usable) {
      missing.push(url);
      continue;
    }
    parts.push(absolutizeUrls(entry.css, url));
  }
  // 只要有一份缺失就整体作废：半套主题比明确的「退回 @import」更容易让人误判
  if (missing.length) return { css: '', missing };
  return { css: parts.join('\n'), missing: [] };
}

/** @import 规则（url(...) 与裸字符串两种写法），末尾可带媒体条件 */
const IMPORT_RE = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)([^;]*);/gi;
/** @import 递归展开的最大深度：既防环，也防病态嵌套 */
const MAX_IMPORT_DEPTH = 4;

/**
 * 把样式表里的 `@import` 递归取回并**就地展开**为实际规则。
 *
 * 为什么必须展开：内联进 <style> 后，若把带 `@import` 的样式表整段放到其它规则
 * 之后，那几条 `@import` 会因「必须位于所有规则之前」而被浏览器直接丢弃——字体
 * 图标（FontAwesome）、自定义字体、colstyle 模块都会静默失效。展开成实际规则后
 * 不再有顺序约束，也不再依赖渲染时刻的网络。
 *
 * 单条取回失败不拖垮整份主题：该条置空（等价于原本就加载不到），其余照常内联。
 * 已出现过的地址会被跳过（去重 + 防循环引用）。
 */
async function resolveImports(css, baseUrl, fetchImpl, seen, depth = 0) {
  if (depth >= MAX_IMPORT_DEPTH) return css;
  const parts = [];
  const tasks = [];
  let last = 0;
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(css)) !== null) {
    parts.push(css.slice(last, m.index));
    last = m.index + m[0].length;
    tasks.push({ index: parts.length, ref: m[2] ?? m[4], media: (m[5] || '').trim() });
    parts.push(''); // 占位，稍后就地替换为展开后的内容
  }
  if (!tasks.length) return css;
  parts.push(css.slice(last));

  await Promise.all(
    tasks.map(async (t) => {
      let abs = null;
      try {
        abs = ABSOLUTE_REF.test(t.ref) ? t.ref : new URL(t.ref, baseUrl).href;
      } catch {
        abs = null; // 解析不了：丢弃该条
      }
      if (!abs || seen.has(abs)) return;
      seen.add(abs);
      try {
        const res = await fetchImpl(abs, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let inner = await res.text();
        inner = absolutizeUrls(inner, abs); // 展开后基准变成预览文档，相对引用先补全
        inner = await resolveImports(inner, abs, fetchImpl, seen, depth + 1);
        parts[t.index] = t.media ? `@media ${t.media}{${inner}}` : inner;
      } catch {
        // 单条失败不影响整份主题：留空即可（等价于这条本来就加载不到）
        parts[t.index] = '';
      }
    })
  );
  return parts.join('');
}

/** 抓一份样式表并展开其中的 @import；成功写缓存（存的是展开后的 CSS）并返回 */
async function fetchOne(url, fetchImpl, seen = new Set()) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();
  if (!raw.trim()) throw new Error('空响应');
  let css = absolutizeUrls(raw, url);
  css = await resolveImports(css, url, fetchImpl, seen);
  writeEntry(url, css);
  return css;
}

/**
 * 联网刷新主题缓存（并发抓取），随后按 readThemeCss 的规则返回可用 CSS。
 * 单份失败只记入 errors，不影响另一份；拿不到就用过期缓存/退回 @import。
 *
 * @param {object} [opts]
 * @param {string[]} [opts.sources]
 * @param {Function} [opts.fetchImpl] 便于测试注入
 * @returns {Promise<{ css: string, fetched: string[], errors: Array<{url,message}> }>}
 */
export async function refreshThemeCss({ sources = THEME_SOURCES, fetchImpl = globalThis.fetch } = {}) {
  const fetched = [];
  const errors = [];
  // 两份主题 + 各自的 @import 共用一个 seen：同一地址只取一次，也防顶部样式表被嵌套重复拉取
  const seen = new Set(sources);
  await Promise.all(
    sources.map(async (url) => {
      try {
        await fetchOne(url, fetchImpl, seen);
        fetched.push(url);
      } catch (e) {
        errors.push({ url, message: e?.message ?? String(e) });
      }
    })
  );
  return { css: readThemeCss({ sources }).css, fetched, errors };
}
