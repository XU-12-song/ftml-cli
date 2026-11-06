
/**
 * include-refs.js — [[include]] 引用名的解析与重写（发布路径用）
 *
 * 发布到 Wikidot 时，本地镜像的引用名必须与线上页面名一致，`[[include X]]` 才能解析。
 * 本地引用名可能写成路径形式（`components/box`），线上 Wikidot 页面全名却是冒号形式
 * （`components:box`）；`remotePageName()` 负责这一步归一名（`/` → `:`）。
 *
 * 引用语法与 `@wdprlib/parser` 的 include 指令保持一致（见
 * node_modules/@wdprlib/parser/.../include/directive.ts）：
 *   - 目标取第一个 `|` 之前那段里的首个非空白 token
 *   - `:site:page:with:colons` → { site: 'site', page: 'page:with:colons' }
 *   - 其余 → { site: null, page: target }
 *
 * 只扫描**行首**的 `[[include]]`——Wikidot 也只在行首解析 include（其余位置
 * 是纯文本），重写它们没有意义，反而会破坏缩进展示的文档示例。
 */
import type { IncludeRewriteMap, PageRef, ScannedIncludeRef } from "../types/domain/include.ts";
/** `[[include` 出现在行首（后接空白或直接 `]]`），避免命中 `[[includex]]` 这类别的标签 */
const INCLUDE_AT_LINE_START = /^\[\[include(?=[ \t\]]|$)/gm;

/** @description 
*`[[` / `]]` 括号深度扫描，找到开标签真正的结束位置（args 值里出现 `[[...]]` 时不误截断） 
*/
function findTagEnd(text:string, openIdx:number):number {
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
 * @description 解析 include 目标串为站点 + 页面名
 *  target 如 `component:box` / `:scp-wiki-cn:theme:parallel`
 */
export function splitPageRef(target:string):PageRef {
  const t = String(target ?? '');
  if (t.startsWith(':')) {
    const rest = t.slice(1);
    const colon = rest.indexOf(':');
    if (colon !== -1) return { site: rest.slice(0, colon), page: rest.slice(colon + 1) };
  }
  return { site: null, page: t };
}

/**
 * @description 本地引用名 → 线上 Wikidot 页面全名。
 * 路径形式归一到冒号形式：`components/box` → `components:box`；
 * 已是冒号形式则原样返回（`component:box`）。
 */
export function remotePageName(page:string):string {
  return String(page)
    .replace(/^[:\/]+/, '')
    .replaceAll('/', ':');
}

/**
 * @description 把一条引用的目标渲染回线上写法：同站（无 site 或 site === currentSite）用
 * 归一名；跨站保留 `:site:page` 前缀并只归一 page 部分。
 */
export function canonicalTarget(ref:PageRef, currentSite:string):string {
  const page = remotePageName(ref.page);
  return ref.site && ref.site !== currentSite ? `:${ref.site}:${page}` : page;
}

/**
 * @description
 *   扫描文本中所有行首 `[[include ...]]`，返回引用位置与解析结果。
 *   start/end 指向**目标 token**在 text 中的区间（便于就地替换），不是整个标签。
 */
export function scanIncludeRefs(text: string): ScannedIncludeRef[] {
  const src = String(text);
  const refs: ScannedIncludeRef[] = [];
  
  INCLUDE_AT_LINE_START.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INCLUDE_AT_LINE_START.exec(src)) !== null) {
    const openIdx = match.index;
    const tagEnd = findTagEnd(src, openIdx);
    
    // 未闭合，跳出
    if (tagEnd === -1) break; 
   
    const innerStart = openIdx + 2;
    const inner = src.slice(innerStart, tagEnd-2);
    const targetRegex = /^include\s+([^|\s]+)/;
    const targetMatch = targetRegex.exec(inner);

    // 容错：如果不匹配（比如 [[ include ... ]] 或者没写页面名），直接跳过
    if (!targetMatch) {
      INCLUDE_AT_LINE_START.lastIndex = tagEnd;
      continue;
    }

    const target = targetMatch[1];
    
    // targetMatch[0] 是诸如 "include 页面名" 的完整匹配串
    // 它的长度减去 target 的长度，就是在 inner 中 target 的相对偏移量
    const targetStartOffset = targetMatch[0].length - target.length;
    
    // 计算在原始字符串 src 中的绝对索引
    const absoluteStart = innerStart + targetStartOffset;
    const absoluteEnd = absoluteStart + target.length;

    refs.push({
      start: absoluteStart,
      end: absoluteEnd,
      raw: target, // 原始目标名
      target: target,
      ...splitPageRef(target)
    });

    // 从标签之后继续，避免把 args 里的 [[include 当成新标签
    INCLUDE_AT_LINE_START.lastIndex = tagEnd; 
  }

  return refs;
}
/**
 * @description
 * 在部署至 wikidot 时按映射重写文本里的 include 目标名。映射里没有的目标原样保留。
 * 从后往前替换，偏移不受影响。
 */
export function rewriteIncludeRefs(text:string, map:IncludeRewriteMap) {
  const get = map instanceof Map ? (k:string) => map.get(k) : (k:string) => map[k];
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
