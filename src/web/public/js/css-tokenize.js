/**
 * css-tokenize.js — CSS 迷你着色扫描（纯函数，不依赖 CM6/DOM，可单测）
 *
 * 输入一段 CSS 文本（[[module CSS]] / [[style]] 正文、style="…" 属性值、
 * [[html]] 内 <style> 正文），输出相对区间 [{from,to,kind}]：
 *
 *   kind: 'selector' 选择器文本        'property' 属性名
 *         'number'   数字/单位/hex      'string'  字符串
 *         'comment'  注释               'atrule'  @media/@supports…
 *         'variable' var(--x)           'important' !important
 *         'brace'    { }
 *
 * 只求"够用"的分类：容错半成品（未闭合注释/字符串/括号），绝不抛异常。
 * 颜色映射在 css-highlight.js（浏览器侧 ViewPlugin）里。
 */

import { CSS_PROPERTY_SET } from './wiki-css.js';

/**
 * @param {string} text CSS 文本
 * @param {'selector'|'decl'} [mode] 起始上下文：块正文从选择器开始；style="…" 从声明开始
 * @returns {Array<{from:number,to:number,kind:string}>}
 */
export function cssTokenRanges(text, mode = 'selector') {
  const src = String(text ?? '');
  const n = src.length;
  const out = [];
  if (!n) return out;

  let i = 0;
  let state = mode === 'decl' ? 'block' : 'selector'; // selector | block | value
  let depth = 0;
  let guard = 0;

  const push = (from, to, kind) => {
    if (to > from) out.push({ from, to, kind });
  };

  while (i < n) {
    if (++guard > 200000) break; // 防御：病态输入绝不空转
    const c = src[ i ];

    // 注释 /* … */
    if (c === '/' && src[ i + 1 ] === '*') {
      const end = src.indexOf('*/', i + 2);
      const to = end === -1 ? n : end + 2;
      push(i, to, 'comment');
      i = to;
      continue;
    }

    // 字符串 "…" / '…'（不跨行，容忍未闭合）
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[ j ] !== c && src[ j ] !== '\n') {
        if (src[ j ] === '\\') j++;
        j++;
      }
      const to = j < n && src[ j ] === c ? j + 1 : j;
      push(i, to, 'string');
      i = to > i ? to : i + 1;
      continue;
    }

    if (c === '{') {
      depth++;
      push(i, i + 1, 'brace');
      state = 'block';
      i++;
      continue;
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1);
      push(i, i + 1, 'brace');
      state = depth > 0 ? 'block' : 'selector';
      i++;
      continue;
    }
    if (c === ';') {
      if (state === 'value') state = 'block';
      i++;
      continue;
    }

    // at-rule（选择器位置）
    if (c === '@' && state === 'selector') {
      const m = /^@[A-Za-z-]+/.exec(src.slice(i));
      if (m) {
        push(i, i + m[ 0 ].length, 'atrule');
        i += m[ 0 ].length;
        continue;
      }
    }

    // 选择器：到 { / 注释 / 字符串为止（@media (...) 的参数也一并算作选择器文本）。
    // 先跳过前导空白，标记不含行首缩进。
    if (state === 'selector') {
      while (i < n && /\s/.test(src[ i ])) i++;
      if (i >= n) break;
      const d0 = src[ i ];
      // 跳过空白后正好落在注释/字符串起点：交给下一轮顶部处理，
      // 否则会吞掉注释的 `/` 或引号，把整段注释误标成选择器。
      if ((d0 === '/' && src[ i + 1 ] === '*') || d0 === '"' || d0 === "'") continue;
      let j = i;
      while (j < n) {
        const d = src[ j ];
        if (d === '{' || (d === '/' && src[ j + 1 ] === '*') || d === '"' || d === "'") break;
        j++;
      }
      let end = j;
      while (end > i && /\s/.test(src[ end - 1 ])) end--;
      if (end > i) push(i, end, 'selector');
      i = j > i ? j : i + 1;
      continue;
    }

    // 声明区：属性名（含自定义属性 --x）
    if (state === 'block') {
      if (/\s/.test(c)) { i++; continue; }
      const rest = src.slice(i);
      const m = /^(--[\w-]+|[A-Za-z][\w-]*)\s*:/.exec(rest);
      if (m && (m[ 1 ].startsWith('--') || CSS_PROPERTY_SET.has(m[ 1 ].toLowerCase()))) {
        push(i, i + m[ 1 ].length, 'property');
        i += m[ 1 ].length;
        state = 'value';
        continue;
      }
      // 嵌套选择器（@media 体内）：扫到 { ; } / 注释 / 字符串；
      // 命中 { 则把这段标为选择器，否则交回顶部处理（注释/字符串不吞）。
      let j = i;
      while (j < n && src[ j ] !== '{' && src[ j ] !== ';' && src[ j ] !== '}' &&
             !(src[ j ] === '/' && src[ j + 1 ] === '*') && src[ j ] !== '"' && src[ j ] !== "'") j++;
      if (j < n && src[ j ] === '{') {
        let end = j;
        while (end > i && /\s/.test(src[ end - 1 ])) end--;
        if (end > i) push(i, end, 'selector');
        i = j; // 交给下一轮的 { 处理
      } else {
        i = j > i ? j : i + 1;
      }
      continue;
    }

    // 值：var(--x) / !important / 数字与单位 / hex；其余逐字跳过
    const rest = src.slice(i);
    let m = /^var\(\s*(--[\w-]+)\s*\)?/.exec(rest);
    if (m) {
      push(i, i + m[ 0 ].length, 'variable'); // 整个 var(--x) 同色
      i += m[ 0 ].length;
      continue;
    }
    m = /^!important\b/.exec(rest);
    if (m) {
      push(i, i + m[ 0 ].length, 'important');
      i += m[ 0 ].length;
      continue;
    }
    m = /^(?:#[0-9a-fA-F]{3,8}\b|-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|%|vh|vw|vmin|vmax|pt|pc|ch|ex|cm|mm|in|deg|rad|turn|s|ms|fr)?)/.exec(rest);
    if (m) {
      push(i, i + m[ 0 ].length, 'number');
      i += m[ 0 ].length;
      continue;
    }
    i++;
  }

  return out;
}
