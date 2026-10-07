/**
 * include-refs.js — [[include]] 引用名的解析与重写（发布路径用）
 *
 * 发布到 Wikidot 时，本地镜像的引用名必须与线上页面名一致，`[[include X]]` 才能解析。
 * 本地引用名可能写成路径形式（`components/box`），线上 Wikidot 页面全名却是冒号形式
 * （`components:box`）；`remotePageName()` 负责这一步归一名（`/` → `:`）。
 *
 * 引用语法与 @wdprlib/parser 的 include 指令保持一致（见
 * node_modules/@wdprlib/parser/.../include/directive.ts）：
 *   - 目标取第一个 `|` 之前那段里的首个非空白 token
 *   - `:site:page:with:colons` → { site: 'site', page: 'page:with:colons' }
 *   - 其余 → { site: null, page: target }
 *
 * 只扫描**行首**的 `[[include]]`——Wikidot 也只在行首解析 include（其余位置
 * 是纯文本），重写它们没有意义，反而会破坏缩进展示的文档示例。
 */

/** `[[include` 出现在行首（后接空白或直接 `]]`），避免命中 `[[includex]]` 这类别的标签 */
const INCLUDE_AT_LINE_START = /^\[\[include(?=[ \t\]]|$)/gm;

/** `[[` / `]]` 括号深度扫描，找到开标签真正的结束位置（args 值里出现 `[[...]]` 时不误截断） */
function findTagEnd(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length - 1; i++) {
    if (text.startsWith('[[', i)) {
      depth++;
      i++;
      continue;
    }
    if (text.startsWith(']]', i)) {
      depth--;
      if (depth === 0) return i + 2;
      i++;
    }
  }
  return -1;
}

/**
 * 解析 include 目标串为站点 + 页面名（与 wdpr parseIncludePageRef 同口径）。
 * @param {string} target 如 `component:box` / `:scp-wiki-cn:theme:parallel`
 * @returns {{ site: string! | null, page: string }}
 */
export function splitPageRef(target) {
  const t = String(target ?? '');
  if (t.startsWith(':')) {
    const rest = t.slice(1);
    const colon = rest.indexOf(':');
    if (colon !== -1) return { site: rest.slice(0, colon), page: rest.slice(colon + 1) };
  }
  return { site: null, page: t };
}

/**
 * 本地引用名 → 线上 Wikidot 页面全名。
 * 路径形式归一到冒号形式：`components/box` → `components:box`；
 * 已是冒号形式则原样返回（`component:box`）。
 * @param {string} page
 */
export function remotePageName(page) {
  return String(page ?? '')
    .replace(/^[:\/]+/, '')
    .replaceAll('/', ':');
}

/**
 * 把一条引用的目标渲染回线上写法：同站（无 site 或 site === currentSite）用
 * 归一名；跨站保留 `:site:page` 前缀并只归一 page 部分。
 * @param {{ site: string|null, page: string }} ref
 * @param {string} [currentSite]
 */
export function canonicalTarget(ref, currentSite) {
  const page = remotePageName(ref.page);
  return ref.site && ref.site !== currentSite ? `:${ref.site}:${page}` : page;
}

/**
 * 扫描文本中所有行首 `[[include ...]]`，返回引用位置与解析结果。
 * @param {string} text
 * @returns {Array<{ start: number, end: number, raw: string, target: string, site: string|null, page: string }>}
 *   start/end 指向**目标 token**在 text 中的区间（便于就地替换），不是整个标签。
 */
export function scanIncludeRefs(text) {
  const src = String(text ?? '');
  const refs = [];
  INCLUDE_AT_LINE_START.lastIndex = 0;
  let m;
  while ((m = INCLUDE_AT_LINE_START.exec(src)) !== null) {
    const openIdx = m.index;
    const tagEnd = findTagEnd(src, openIdx);
    if (tagEnd === -1) break; // 未闭合的 `[[`：余下都不认
    const inner = src.slice(openIdx + 2, tagEnd - 2); // 形如 `include component:box |k=v`
    const body = inner.slice('include'.length);
    const pipe = body.indexOf('|');
    const head = pipe === -1 ? body : body.slice(0, pipe);
    const lead = head.length - head.trimStart().length;
    const tok = /^\S+/.exec(head.trimStart());
    if (!tok) continue; // `[[include]]` 没有目标，跳过
    const target = tok[0];
    const start = openIdx + 2 + 'include'.length + lead;
    refs.push({ start, end: start + target.length, raw: target, target, ...splitPageRef(target) });
    INCLUDE_AT_LINE_START.lastIndex = tagEnd; // 从标签之后继续，避免把 args 里的 `[[include` 当成新标签
  }
  return refs;
}

/**
 * 按映射重写文本里的 include 目标名。映射里没有的目标原样保留。
 * 从后往前替换，偏移不受影响。
 * @param {string} text
 * @param {Map<string, string>|Record<string, string>} map 原引用名 → 新引用名
 */
export function rewriteIncludeRefs(text, map) {
  const get = map instanceof Map ? (k) => map.get(k) : (k) => map[k];
  const src = String(text ?? '');
  const edits = [];
  for (const ref of scanIncludeRefs(src)) {
    const next = get(ref.target);
    if (next !== undefined && next !== ref.target) edits.push({ start: ref.start, end: ref.end, next });
  }
  if (!edits.length) return src;
  let out = src;
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.start) + e.next + out.slice(e.end);
  }
  return out;
}
