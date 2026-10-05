/**
 * cm-semantics.js — CM6 语义层装饰的纯计算（不依赖 CodeMirror / DOM，可单测）
 *
 * 基础着色（cm-lexer.js）只按形状给 token 上色，是容忍半成品的行式扫描。
 * 本模块在它之上做需要「全局知识」的判断，输出绝对偏移区间，供 cm-editor.js
 * 转成 Decoration：
 *
 *   1. diagnosticRanges    —— 服务端 wdpr 的结构诊断（未闭合块 / 块级误用）→ 波浪线
 *   2. unknownMacroRanges  —— 不认识且非模板的 `[[name]]` → 警示色
 *   3. templateCallKeyRanges —— `[[tmpl k=v]]` 里模板未声明的键 → 提示波浪线
 *   4. templatePlaceholderRanges —— `.ftmx` body 里未声明的 `{ key }` → 提示波浪线
 *   5. macroBracketPairs / bracketPairAt —— `[[` ↔ 它自己的 `]]` 配对高亮
 *
 * 「认识的名字」口径：Wikidot 原生标签（BUILTIN_MACROS）∪ 当前项目模板名。
 * 两者都在服务端已知（sidebar 已把模板名与 keys 下发），因此无需再做一趟解析。
 */

/** lexTokens 依赖的词法器（与基础着色同一份，保证惰性区/注释/字面量口径一致） */
import { token, startState } from './cm-lexer.js';

/**
 * Wikidot 原生标签（开/闭同一个名字）。取自 scp-jp wikidot-syntax 参考：
 * 01-core-syntax（§18–26）、06/07（行首必需标签表）。用户自定义模板名由调用方并入。
 */
export const BUILTIN_MACROS = new Set([
  // 容器 / 块
  'div', 'div_', 'span', 'span_', 'note', 'code', 'collapsible', 'tabview', 'tab',
  'toc', 'footnoteblock', 'footnote', 'table', 'row', 'cell', 'hcell', 'gallery', 'math',
  // 媒体 / 嵌入
  'html', 'embed', 'embedvideo', 'embedaudio', 'iframe', 'image',
  // 引用 / 模块 / 尺寸
  'include', 'module', 'size', 'style', 'component',
  // 列表 / 锚点变体
  'a', 'a_', 'ul', 'ul_', 'ol', 'ol_',
  // 按钮 / 社交 / 用户
  'button', 'social', 'user', '*user',
  // 条件
  'iftags', 'iftag', '#if', '#ifexpr', '#expr',
  // 块位置（符号标签）
  '<', '>', '=', '==',
]);

/* ------------------------------------------------------------------ *
 * 词法切分：把整篇源码喂给 cm-lexer，得到带绝对偏移的 token 序列
 * ------------------------------------------------------------------ */

/** CodeMirror StringStream 的最小替身：单行、按需前进/匹配 */
function makeStream(line) {
  let pos = 0;
  return {
    string: line,
    get pos() { return pos; },
    set pos(v) { pos = v; },
    sol() { return pos === 0; },
    eol() { return pos >= line.length; },
    peek() { return pos < line.length ? line[ pos ] : undefined; },
    next() { return pos < line.length ? line[ pos++ ] : undefined; },
    skipToEnd() { pos = line.length; },
    match(pat) {
      const rest = line.slice(pos);
      if (typeof pat === 'string') {
        if (rest.startsWith(pat)) { pos += pat.length; return pat; }
        return null;
      }
      const m = pat.exec(rest);
      if (m && m.index === 0) { pos += m[ 0 ].length; return m[ 0 ]; }
      return null;
    },
  };
}

/**
 * 整篇源码 → [{ type, from, to }]。type 为词法器 token 名（可能是 null）。
 * 跨行状态由词法器自身的 state 承载，因此与编辑器里的着色完全一致。
 */
export function lexTokens(source) {
  const out = [];
  const state = startState();
  const lines = String(source ?? '').split('\n');
  let base = 0;
  for (const line of lines) {
    const s = makeStream(line);
    let guard = 0;
    while (s.pos < line.length) {
      const start = s.pos;
      const type = token(s, state);
      if (s.pos === start) s.pos++; // 防御：绝不空转
      out.push({ type, from: base + start, to: base + s.pos });
      if (++guard > 100000) break;
    }
    base += line.length + 1; // +1 补 '\n'
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * [[ … ]] 配对
 * ------------------------------------------------------------------ */

/**
 * 把「名字相同的开标签 ↔ 闭标签」配成对。
 *
 * Wikidot 里 `[[div]]…[[/div]]` 才是语义上的一对，而不是 `[[` 配最近的那个 `]]`。
 * 这里维护一个开标签栈，遇到 `[[/name]]` 时向下找最近同名开标签配对（容忍嵌套/交错）。
 * 惰性区（code/html/embed/style）的闭标签是一个含 `]]` 的整体 token，需特别拆名字。
 * 自闭合标签（`[[toc]]` / `[[module …]]` 等）根本没有闭标签，自然不会产生配对。
 *
 * @returns {Array<{openFrom,openTo,closeFrom,closeTo}>} 开/闭标签的完整区间（含 `[[` / `]]`）
 */
export function macroBracketPairs(source) {
  const toks = lexTokens(source);
  const stack = [];   // 未闭合的开标签 { name, from, to }
  const pairs = [];
  let pendingOpen = null;   // 开标签名已读，等它的 `]]`
  let pendingClose = null;  // 闭标签名已读，等它的 `]]`

  for (const t of toks) {
    const text = source.slice(t.from, t.to);
    if (t.type === 'macro-delim') {
      if (text === ']]') {
        if (pendingOpen) {
          pendingOpen.to = t.to;
          stack.push(pendingOpen);
          pendingOpen = null;
        } else if (pendingClose) {
          pendingClose.to = t.to;
          closePair(stack, pairs, pendingClose);
          pendingClose = null;
        }
      }
      continue;
    }
    if (t.type === 'macro' || t.type === 'block-marker') {
      pendingOpen = { name: text, from: t.from - 2, to: null };
      continue;
    }
    if (t.type === 'macro-close') {
      pendingClose = { name: text, from: t.from - 3, to: null }; // -3 回退 `[[/`
    }
  }
  pairs.sort((a, b) => a.openFrom - b.openFrom);
  return pairs;
}

/** 从开标签栈里找最近同名项配对（找不到说明该闭标签没有对应开标签） */
function closePair(stack, pairs, close) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[ i ].name === close.name) {
      const open = stack.splice(i, 1)[ 0 ];
      pairs.push({ openFrom: open.from, openTo: open.to, closeFrom: close.from, closeTo: close.to });
      return;
    }
  }
}

/**
 * 光标落在某个标签（开或闭）区间内时，返回两者的完整区间；否则 null。
 * @param {number} pos 光标绝对偏移
 * @param {Array} [pairs] 预先算好的 macroBracketPairs（避免重复扫描）
 */
export function bracketPairAt(pos, pairs) {
  for (const p of pairs) {
    const onOpen = pos >= p.openFrom && pos <= p.openTo;
    const onClose = pos >= p.closeFrom && pos <= p.closeTo;
    if (onOpen || onClose) {
      return {
        open: { from: p.openFrom, to: p.openTo },
        close: { from: p.closeFrom, to: p.closeTo },
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 诊断 → 偏移区间
 * ------------------------------------------------------------------ */

/** 行首偏移表，用于 line/column → 绝对偏移 */
function lineStarts(source) {
  const starts = [ 0 ];
  for (let i = 0; i < source.length; i++) if (source[ i ] === '\n') starts.push(i + 1);
  return starts;
}

function offsetAt(source, starts, line, col) {
  const li = Math.max(0, Math.min(starts.length - 1, (line ?? 1) - 1));
  return Math.min(source.length, starts[ li ] + Math.max(0, (col ?? 1) - 1));
}

/** 把细小的诊断区间扩到整条标签（找同行的 `]]`），让波浪线盖住 `[[div]]` 而非只盖 `[[` */
function widenToTagEnd(source, to) {
  const nl = source.indexOf('\n', to);
  const limit = nl === -1 ? source.length : nl;
  const close = source.indexOf(']]', to);
  if (close !== -1 && close + 2 <= limit) return close + 2;
  return to;
}

/**
 * wdpr 诊断 → 装饰区间。位置优先用 wdpr 给的绝对 offset，缺失/越界时回退 line/column。
 * @returns {Array<{from,to,severity,code,message}>} 已按 from 排序
 */
export function diagnosticRanges(source, diagnostics = []) {
  const starts = lineStarts(source);
  const out = [];
  for (const d of diagnostics) {
    if (!d) continue;
    const s = d.position?.start;
    let from = Number.isFinite(s?.offset)
      ? s.offset
      : offsetAt(source, starts, s?.line, s?.column);
    from = Math.max(0, Math.min(source.length, from));
    if (from >= source.length) continue;

    let to = Number.isFinite(d.position?.end?.offset)
      ? d.position.end.offset
      : (d.position?.end ? offsetAt(source, starts, d.position.end.line, d.position.end.column) : from + 2);
    if (!(to > from)) to = from + 2;
    to = Math.max(from + 1, Math.min(source.length, widenToTagEnd(source, to)));

    out.push({
      from,
      to,
      severity: d.severity === 'error' ? 'error' : 'warning',
      code: d.code,
      message: d.message,
    });
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}

/* ------------------------------------------------------------------ *
 * 未知宏
 * ------------------------------------------------------------------ */

/**
 * 不在 knownNames（原生标签 ∪ 模板名）里的 `[[name]]` 开标签。
 * 闭标签不单独报——避免与服务的「未闭合块」诊断重复。
 * @param {Set<string>} knownNames
 * @returns {Array<{from,to,name}>}
 */
export function unknownMacroRanges(source, knownNames) {
  const out = [];
  for (const t of lexTokens(source)) {
    if (t.type !== 'macro' && t.type !== 'block-marker') continue;
    const name = source.slice(t.from, t.to); // 名字 token 已是纯名字（`[[` 单独成分隔符）
    if (!name || name.startsWith('/') || knownNames.has(name)) continue;
    out.push({ from: t.from, to: t.to, name });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 模板键校验
 * ------------------------------------------------------------------ */

/** 与 parse-ftmx.js:splitTagTokens 同口径：含 `=` 且非以 `=` 开头 → 字面属性，否则为声明键 */
function declaredKeysFromInner(inner) {
  const tokens = inner.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const keys = [];
  for (const t of tokens.slice(1)) {
    if (/^\S+=/.test(t) && !/^=[^=]/.test(t)) continue;
    keys.push(t);
  }
  return keys;
}

/**
 * 解析 `.ftmx` 头部 `[[元素 键1 键2 class="x"]]`，返回声明键。
 * 不是模板头（文件不以 [[…]] 开头）时返回 null。
 * @returns {{ element: string|null, keys: string[] } | null}
 */
export function templateHeaderKeys(source) {
  const text = String(source ?? '').trim();
  const m = text.match(/^\[\[([^\]\[]*?)\]\]/);
  if (!m) return null;
  const inner = m[ 1 ].trim();
  if (!inner) return { element: null, keys: [] };
  const element = (inner.match(/"[^"]*"|'[^']*'|\S+/) || [ '' ])[ 0 ];
  return { element, keys: declaredKeysFromInner(inner) };
}

/** 用等长空白替换若干区间，保持偏移不变，便于在原文上安全匹配 */
function blankSpans(source, spans) {
  let out = source;
  for (const [ re, flags ] of spans) {
    out = out.replace(re, (m) => ' '.repeat(m.length));
    void flags;
  }
  return out;
}

/**
 * `.ftmx` body 中引用了但头部未声明的 `{ key }`（`children` 视为内置）。
 * 口径对齐 core/expand.js:renderTemplate——只跳过 `[[style]]` 块与转义 `\{ \} \\`，
 * 其它 `{…}` 若不在声明键内，展开时会直接报错，这里提前给出提示。
 */
export function templatePlaceholderRanges(source, declaredKeys = []) {
  const declared = new Set([ ...declaredKeys, 'children' ]);
  const masked = blankSpans(source, [
    [ /\[\[style\s*\]\][\s\S]*?\[\[\/style\]\]/g ],
  ]);
  const re = /\\(?:\\|\{|\})|\{([^{}\n]+?)\}/g;
  const out = [];
  let m;
  while ((m = re.exec(masked)) !== null) {
    if (m[ 1 ] === undefined) continue; // 转义分支
    const key = m[ 1 ].trim();
    if (!key || declared.has(key)) continue;
    const lead = m[ 1 ].length - m[ 1 ].trimStart().length;
    const from = m.index + 1 + lead;
    out.push({ from, to: from + key.length, key });
  }
  return out;
}

/**
 * `.ftml` 里 `[[模板名 k=v]]` 传了模板未声明的键。只在「名字确实是当前项目的模板」时检查，
 * 因此不会误伤原生标签的自由属性。
 * @param {Map<string, string[]>|Record<string,string[]>} templateKeys 模板名 → 声明键
 * @returns {Array<{from,to,name,key}>}
 */
export function templateCallKeyRanges(source, templateKeys) {
  const lookup = templateKeys instanceof Map
    ? templateKeys
    : new Map(Object.entries(templateKeys || {}));
  const toks = lexTokens(source);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[ i ];
    if (t.type !== 'macro' && t.type !== 'block-marker') continue;
    const name = source.slice(t.from, t.to);
    if (!lookup.has(name)) continue;
    const declared = new Set([ ...(lookup.get(name) || []), 'children' ]);

    // 该开标签的结束 `]]`
    let delim = null;
    for (let j = i + 1; j < toks.length; j++) {
      if (toks[ j ].type === 'macro-delim') { delim = toks[ j ]; break; }
    }
    if (!delim) continue; // 半截输入，跳过

    const inner = source.slice(t.to, delim.from);
    const attrs = inner.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    let cursor = t.to;
    for (const tk of attrs) {
      const at = source.indexOf(tk, cursor);
      if (at === -1) continue;
      cursor = at + tk.length;
      const eq = tk.indexOf('=');
      if (eq <= 0) continue; // 无值 token：由 expand 另行报错，这里不越权
      const key = tk.slice(0, eq);
      if (!/^[A-Za-z_][\w.-]*$/.test(key)) continue; // 只提示像键名的
      if (declared.has(key)) continue;
      out.push({ from: at, to: at + key.length, name, key });
    }
  }
  return out;
}

/** 装饰区间排序（RangeSetBuilder 要求按 from 升序） */
export function sortRanges(ranges) {
  return ranges.slice().sort((a, b) => a.from - b.from || a.to - b.to);
}
