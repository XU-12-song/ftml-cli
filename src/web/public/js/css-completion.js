/**
 * css-completion.js — CSS 补全源（@codemirror/autocomplete 的 CompletionSource）
 *
 * 为版式作者在 CSS 上下文里提供候选，全部同步内存、无网络：
 *   1. 当前预览真实 DOM（el.preview iframe 的 id/class）—— 跨域/重载时回退静态表；
 *   2. 文档内主题/模块 CSS 变量（iframe 的 #internal-style、#ftml-styles 等
 *      <style> 文本中的 `--x:`）—— 用于 `var(--` 补全，回退 BHL 变量池；
 *   3. Wikidot/SCP 词汇 + MDN 常用 CSS（wiki-css.js 静态表）。
 *
 * 上下文判定（isCssContext，纯函数、优先级高于所有 FTML 规则）：
 *   - [[module CSS]] … [[/module]] 正文（未闭合也生效）；
 *   - [[style]] … [[/style]] 正文（未闭合也生效）；
 *   - 任意 [[… style="…"]] 属性值内（键名必须是 style；lexTokens + 正则判定）；
 *   - [[html]] 内的 <style>…</style>。
 *
 * 关键协作约定：CM6 `override` 下的多个 source 是**合并结果**（无短路），
 * 因此 ftmlCompletion 自身也用 isCssContext 守卫退出——CSS 值里的 `/`
 * （12px/1.5、grid 1/2）由此不再触发闭合标签简写，裸词 FTML 标签也不再
 * 混进 CSS 正文。
 *
 * 纯函数（isCssContext / parseCssFragment / parseCssVars / filterSelectorNoise /
 * dedupeCap）不依赖 DOM 与 CodeMirror，可在 node 单测中直接调用；
 * DOM 扫描走惰性 getElementById('preview') + setCssDomProvider 注入钩子，
 * 模块顶层不触碰 document。
 */

import { lexTokens } from './cm-semantics.js';
import {
  CSS_PROPERTIES,
  CSS_PROPERTY_SET,
  CSS_PROPERTY_VALUES,
  CSS_COLOR_PROPERTIES,
  COLOR_KEYWORDS,
  GENERIC_VALUES,
  CSS_UNITS,
  CSS_AT_RULES,
  CSS_ELEMENTS,
  CSS_PSEUDO_CLASSES,
  CSS_PSEUDO_ELEMENTS,
  WIKI_SELECTORS,
  BHL_VARIABLES,
  WIKI_CSS_SNIPPETS,
  makeResult,
  valuesForProperty,
} from './wiki-css.js';

/** 候选上限（需求：候选去重后 ≤ 2000） */
const MAX_CANDIDATES = 2000;
/** DOM/变量扫描缓存时效 */
const DOM_CACHE_TTL = 2000;
/** 元素名快速判定（伪类上下文用：`a:` 是伪类、`font-stretch:` 不是） */
const ELEMENT_SET = new Set(CSS_ELEMENTS);

/* ------------------------------------------------------------------ *
 * 上下文区域：[[module CSS]] / [[style]] / style="…" / [[html]] <style>
 * ------------------------------------------------------------------ */

/**
 * style 属性值区间（基于开标签参数区文本）。返回文档绝对偏移区间。
 * 带引号：区间在引号内；引号未闭合：区间到参数区末尾；无引号：到空白为止。
 */
function styleAttrSpans(argsText, base) {
  const spans = [];
  const re = /(^|[\s;"'])style\s*=\s*/gi;
  let m;
  while ((m = re.exec(argsText)) !== null) {
    const valStart = m.index + m[ 0 ].length;
    const q = argsText[ valStart ];
    if (q === '"' || q === "'") {
      const end = argsText.indexOf(q, valStart + 1);
      const from = base + valStart + 1;
      const to = end === -1 ? base + argsText.length : base + end;
      if (to > from) spans.push({ from, to });
      if (end === -1) break;
      re.lastIndex = end + 1; // 跳过引号内容，继续找下一个 style=
    } else {
      let end = valStart;
      while (end < argsText.length && !/\s/.test(argsText[ end ])) end++;
      if (end > valStart) spans.push({ from: base + valStart, to: base + end });
    }
  }
  return spans;
}

/** [[html]] 体内 <style>…</style> 的内容区间 */
function htmlStyleSpans(blocks, src, from, to) {
  const body = src.slice(from, to);
  const lower = body.toLowerCase();
  const re = /<style\b[^>]*>/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    const innerFrom = from + m.index + m[ 0 ].length;
    const closeIdx = lower.indexOf('</style', m.index + m[ 0 ].length);
    const innerTo = closeIdx === -1 ? to : from + closeIdx;
    if (innerTo > innerFrom) blocks.push({ type: 'html-style', from: innerFrom, to: innerTo });
    if (closeIdx === -1) break;
    const closeEnd = body.indexOf('>', closeIdx);
    re.lastIndex = closeEnd === -1 ? body.length : closeEnd + 1;
  }
}

/** 开区域类型 → 期望的闭标签名 */
function closeNameFor(type) {
  return type === 'module-css' ? 'module' : type; // style → style, html → html
}

/**
 * 扫描整篇源码，产出 CSS 上下文区域。纯函数（lexTokens 本身无 DOM 依赖）。
 *
 * 词法状态机：[[ / [[/ 开启一个标签头，标签名 token 落定后参数区随之展开，
 * `]]` 收尾——module + CSS 参数 → module-css 区；style → style 区；
 * html → 扫 <style> 子区；其余开标签只提取 style="…" 属性区，不打断已开的区块
 * （module CSS 正文里出现 [[div]] 属于 CSS 文本，不能中断区域）。
 *
 * @param {string} source 完整源码
 * @param {number} [pos] 光标位置：最后一个未闭合开标签的参数区按 pos 截断
 *        （正在打属性值时也要能给出上下文）
 * @returns {{ blocks: Array<{type,from,to}>, attrSpans: Array<{from,to}> }}
 */
export function cssRegions(source, pos = null) {
  const src = String(source ?? '');
  const toks = lexTokens(src);
  const blocks = [];
  const attrSpans = [];
  let pending = null; // { close, name, nameEnd, delimFrom, argsEnd }
  let open = null;    // { type, bodyFrom }

  for (const t of toks) {
    const text = src.slice(t.from, t.to);
    if (t.type === 'macro-delim') {
      if (text === '[[' || text === '[[/') {
        pending = { close: text === '[[/', name: null, nameEnd: -1, delimFrom: t.from, argsEnd: -1 };
        continue;
      }
      if (text === ']]') {
        if (pending && pending.name) {
          const base = pending.name.replace(/_+$/, '').toLowerCase();
          if (pending.close) {
            // 闭合标签：关闭已开的区块
            if (open && base === closeNameFor(open.type)) {
              if (open.type === 'html') htmlStyleSpans(blocks, src, open.bodyFrom, pending.delimFrom);
              else blocks.push({ type: open.type, from: open.bodyFrom, to: pending.delimFrom });
              open = null;
            }
          } else {
            // 开标签：检查是否是 CSS/HTML 区块。参数区 = 标签名之后 → 当前 `]]` 之前
            const args = src.slice(pending.nameEnd, t.from);
            for (const s of styleAttrSpans(args, pending.nameEnd)) attrSpans.push(s);
            if (base === 'module' && /^\s*css\b/i.test(args)) open = { type: 'module-css', bodyFrom: t.to };
            else if (base === 'style') open = { type: 'style', bodyFrom: t.to };
            else if (base === 'html') open = { type: 'html', bodyFrom: t.to };
            // 其它标签：不动 open（[[module CSS]] 体内的 [[div]] 属于 CSS 文本）
          }
        }
        pending = null;
        continue;
      }
      continue;
    }
    if (pending && pending.name === null &&
        (t.type === 'macro' || t.type === 'block-marker' || t.type === 'macro-close')) {
      pending.name = text;
      pending.nameEnd = t.to;
      continue;
    }
    if (pending && pending.nameEnd >= 0) {
      pending.argsEnd = t.to; // 参数区 token（含裸文本），供未闭合标签的增量判定用
    }
  }

  // 未闭合的开标签（正在打属性值/参数）：参数区按已见 token 与 pos 的较大者截断
  if (pending && !pending.close && pending.name && pending.nameEnd >= 0) {
    const p = pos === null ? src.length : Math.max(0, Math.min(src.length, pos));
    const end = Math.min(src.length, Math.max(pending.argsEnd, pending.nameEnd, p));
    if (end > pending.nameEnd) {
      const args = src.slice(pending.nameEnd, end);
      for (const s of styleAttrSpans(args, pending.nameEnd)) attrSpans.push(s);
    }
  }

  // 未闭合的区块开到文件尾（正在写 CSS、还没打 [[/module]] 也要给候选）
  if (open) {
    if (open.type === 'html') htmlStyleSpans(blocks, src, open.bodyFrom, src.length);
    else blocks.push({ type: open.type, from: open.bodyFrom, to: src.length });
  }

  return { blocks, attrSpans };
}

/**
 * 光标是否落在 CSS 上下文中。命中返回 { type }，否则 null。
 * @param {string} source 完整源码
 * @param {number} pos 光标绝对偏移
 * @returns {{ type: 'module-css'|'style'|'attr-style'|'html-style' }|null}
 */
export function isCssContext(source, pos) {
  const src = String(source ?? '');
  if (typeof pos !== 'number' || !Number.isFinite(pos)) return null;
  const p = Math.max(0, Math.min(src.length, Math.floor(pos)));
  const { blocks, attrSpans } = cssRegions(src, p);
  for (const s of attrSpans) {
    if (p >= s.from && p <= s.to) return { type: 'attr-style' };
  }
  for (const b of blocks) {
    if (p >= b.from && p <= b.to) return { type: b.type };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 纯工具：变量解析 / 噪声过滤 / 去重上限（导出供单测）
 * ------------------------------------------------------------------ */

/**
 * 从 CSS 文本提取自定义属性名（`--x:` 定义处）。防御性限量，避免病态输入卡死。
 * @returns {string[]} 去重后的变量名（含 `--` 前缀）
 */
export function parseCssVars(text) {
  const s = String(text ?? '');
  const out = new Set();
  const re = /(--[\w-]+)\s*:/g;
  let m;
  let guard = 0;
  while ((m = re.exec(s)) !== null) {
    out.add(m[ 1 ]);
    if (++guard > 5000) break;
  }
  return [ ...out ];
}

/**
 * 过滤 DOM 扫描噪声：随机 tab id（wiki-tab-0-1 等）、随机 hex、纯数字、
 * 非法标识符、单字符名。
 * @param {string[]} names 未加 #/. 前缀的裸 id/class 名
 */
export function filterSelectorNoise(names) {
  const NOISE = [
    /^wiki-tab(-\d+)+$/i,  // Wikidot tabview 生成的随机 tab id
    /^tab-\d+(-\d+)?$/i,
    /^ui-tab(-\d+)*$/i,
    /^[0-9a-f]{8,}$/i,     // 随机 hex（统计/埋点节点）
    /^\d+$/,               // 纯数字
  ];
  const out = [];
  for (const raw of names) {
    const n = String(raw ?? '').trim();
    if (n.length < 2 || n.length > 64) continue;
    if (!/^[A-Za-z_][\w-]*$/.test(n)) continue; // 必须是合法 CSS 标识符
    let noisy = false;
    for (const re of NOISE) { if (re.test(n)) { noisy = true; break; } }
    if (!noisy) out.push(n);
  }
  return out;
}

/** 去重 + 截断到 cap（默认 2000），保持首次出现顺序 */
export function dedupeCap(list, cap = MAX_CANDIDATES) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 光标处 CSS 片段解析（纯函数，决定给哪一类候选）
 * ------------------------------------------------------------------ */

/**
 * 解析光标前的 CSS 片段。
 * @param {string} source 完整源码
 * @param {number} pos 光标绝对偏移
 * @param {string} ctxType isCssContext 的 type
 * @returns {{ kind: 'atrule'|'var'|'units'|'value'|'pseudo'|'property'|'selector'|'mixed',
 *             query: string, from: number, property: string|null }}
 */
export function parseCssFragment(source, pos, ctxType) {
  const src = String(source ?? '');
  const p = Math.max(0, Math.min(src.length, Math.floor(pos)));
  const lineStart = src.lastIndexOf('\n', p - 1) + 1;
  const before = src.slice(Math.max(lineStart, p - 400), p);

  // 1. @at-rule
  let m = /@[\w-]*$/.exec(before);
  if (m) return { kind: 'atrule', query: m[ 0 ], from: p - m[ 0 ].length, property: null };

  // 2. var(--…
  m = /\bvar\(\s*(--[\w-]*)?$/.exec(before);
  if (m) {
    const q = m[ 1 ] || '';
    return { kind: 'var', query: q, from: p - q.length, property: null };
  }

  // 3. 声明值 prop: value（边界：; { } 或行首）。`12px/1.5` 的 `/` 属于值的一部分，
  //    解析结果仍是 value——绝不会被当成选择器或触发其它补全。
  const declStart = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}')) + 1;
  const decl = before.slice(declStart);
  m = /^(-?[A-Za-z][\w-]*)\s*:\s*([^;{}]*)$/.exec(decl);
  if (m && CSS_PROPERTY_SET.has(m[ 1 ].toLowerCase())) {
    const prop = m[ 1 ].toLowerCase();
    const val = m[ 2 ];
    if (/^-?\d+$/.test(val)) return { kind: 'units', query: val, from: p - val.length, property: prop };
    return { kind: 'value', query: val, from: p - val.length, property: prop };
  }

  // 4. 伪类/伪元素：`sel:` 之后的部分。只认元素名或 `.`/`#` 开头的选择器，
  //    未知属性名（不在表里的 `font-stretch:` 等）不算伪类。
  m = /([#.]?)([\w-]+)(::?)([\w-]*)$/.exec(decl);
  if (m && (m[ 1 ] !== '' || ELEMENT_SET.has(m[ 2 ]))) {
    return { kind: 'pseudo', query: m[ 4 ], from: p - m[ 4 ].length, property: null };
  }

  // 5. 正在输入的词（可带 . # 前缀）
  m = /[.#]?[\w-]*$/.exec(decl);
  const query = m ? m[ 0 ] : '';
  const from = p - query.length;

  if (query.startsWith('.') || query.startsWith('#')) {
    return { kind: 'selector', query, from, property: null };
  }
  if (ctxType !== 'attr-style' &&
      (/[\s>+~,]$/.test(decl) || /[>+~[]/.test(decl.slice(0, decl.length - query.length)))) {
    // 组合选择器中：`div > `、`a, ` 等（style 属性值里没有选择器概念，
    // 且 FTML 的 [[ 也不能被当成选择器标点）
    return { kind: 'selector', query, from, property: null };
  }
  if (!query) {
    // 空位（{ 后、行首）：属性/选择器/片段都可能
    return { kind: 'mixed', query: '', from: p, property: null };
  }
  // 裸词：style 属性里必然是属性名；块上下文里属性优先、选择器/片段兜底
  return { kind: 'mixed', query, from, property: null };
}

/* ------------------------------------------------------------------ *
 * 预览 DOM / 变量扫描（惰性 + 2 秒缓存 + 失败回退静态表）
 * ------------------------------------------------------------------ */

/** 测试/宿主注入钩子：默认按 id 找 el.preview 指向的 iframe */
let domProvider = null;

/**
 * 注入预览 iframe 提供器（浏览器侧无需调用——默认从 document 取 #preview）。
 * @param {(() => (HTMLIFrameElement|null)) | null} fn
 */
export function setCssDomProvider(fn) {
  domProvider = typeof fn === 'function' ? fn : null;
}

function previewIframe() {
  try {
    if (domProvider) return domProvider();
    if (typeof document === 'undefined') return null; // node 单测环境
    return document.getElementById('preview');
  } catch (e) {
    return null;
  }
}

/** 收集 iframe 文档里的全部 id/class（含站点外壳与正文节点） */
function scanDomSelectors(doc) {
  const ids = [];
  const classes = [];
  const nodes = doc.querySelectorAll('[id],[class]');
  for (const n of nodes) {
    try {
      const id = n.getAttribute('id');
      if (id) ids.push(id);
      const cls = n.getAttribute('class');
      if (cls) for (const c of cls.split(/\s+/)) if (c) classes.push(c);
    } catch (e) { /* 单个节点异常不影响整体 */ }
  }
  const pick = (list, prefix) => filterSelectorNoise(list)
    .slice(0, MAX_CANDIDATES)
    .map((n) => prefix + n);
  return [ ...pick(ids, '#'), ...pick(classes, '.') ];
}

/** 收集 iframe 文档内 <style>（#internal-style / #ftml-styles 等）中的变量 */
function scanDocVariables(doc) {
  const texts = [];
  try {
    for (const style of doc.querySelectorAll('style')) {
      const t = style.textContent;
      if (t) texts.push(t);
    }
    // 保险：非 <style> 载体（理论上不会出现）也按 id 取一次
    for (const id of [ 'internal-style', 'ftml-styles' ]) {
      const n = doc.getElementById(id);
      const t = n && n.textContent;
      if (t && !texts.includes(t)) texts.push(t);
    }
  } catch (e) { /* 部分节点不可访问时用已收集的 */ }
  const out = new Set();
  for (const t of texts) for (const v of parseCssVars(t)) out.add(v);
  return [ ...out ];
}

let domCache = { at: 0, selectors: null, variables: null };

/**
 * 取选择器/变量池：实时扫描 iframe，跨域/重载/缺失时回退静态表（WIKI_SELECTORS
 * 与 BHL_VARIABLES 总是并入池底，保证离线可用）。结果缓存 2 秒。
 */
function getDomData() {
  const now = Date.now();
  if (domCache.selectors && now - domCache.at < DOM_CACHE_TTL) return domCache;

  const selectors = new Set(WIKI_SELECTORS);
  const variables = new Set(BHL_VARIABLES);
  try {
    const frame = previewIframe();
    const doc = frame && (frame.contentDocument || (frame.contentWindow && frame.contentWindow.document));
    if (doc && doc.body) {
      for (const s of scanDomSelectors(doc)) selectors.add(s);
      for (const v of scanDocVariables(doc)) variables.add(v);
    }
  } catch (e) { /* 跨域或重载中：回退静态表，绝不抛异常 */ }

  domCache = {
    at: now,
    selectors: dedupeCap([ ...selectors ], MAX_CANDIDATES),
    variables: dedupeCap([ ...variables ].sort(), MAX_CANDIDATES),
  };
  return domCache;
}

/* ------------------------------------------------------------------ *
 * 候选构造
 * ------------------------------------------------------------------ */

const opt = (label, detail, type, apply) => ({ label, detail, type, apply: apply ?? label });

/**
 * 属性候选：补成 `position: ;`，光标落在 `: ` 与 `;` 之间，省掉手打冒号和分号。
 * 用 Completion.apply 函数精确控制插入文本与光标位置（同步、无 snippet 依赖）。
 */
function propertyEntry(p) {
  return {
    key: p,
    group: 0,
    option: {
      label: p,
      detail: '属性',
      type: 'property',
      apply(view, _completion, from, to) {
        const head = p + ': ';
        view.dispatch({
          changes: { from, to, insert: head + ';' },
          selection: { anchor: from + head.length },
        });
      },
    },
  };
}

function selectorEntries(selectors) {
  const entries = selectors.map((sel, i) => ({
    key: sel,
    group: sel.startsWith('#') || sel.startsWith('.') ? 1 : 2,
    option: opt(sel, sel.startsWith('#') ? 'id' : sel.startsWith('.') ? 'class' : '元素', 'class'),
  }));
  return entries;
}

function propertyEntries() {
  return CSS_PROPERTIES.map(propertyEntry);
}

function atruleEntries() {
  return CSS_AT_RULES.map((a) => ({
    key: a,
    group: 7,
    option: opt(a, 'at-rule', 'keyword', a === '@media' || a === '@supports'
      ? a + ' () {\n  \n}'
      : a + ' {\n  \n}'),
  }));
}

function varEntries(variables) {
  return variables.map((v) => ({
    key: v,
    group: 4,
    option: opt(v, 'CSS 变量', 'variable', v + ')'),
  }));
}

function valueEntries(property, variables) {
  const entries = [];
  let group = 5;
  for (const v of valuesForProperty(property)) {
    entries.push({ key: v, group, option: opt(v, '值', 'value') });
  }
  if (CSS_COLOR_PROPERTIES.has(property)) {
    for (const c of COLOR_KEYWORDS) entries.push({ key: c, group: 5, option: opt(c, '颜色', 'value') });
    for (const v of variables) {
      entries.push({ key: 'var(' + v + ')', group: 6, option: opt('var(' + v + ')', '变量', 'variable') });
    }
  }
  for (const g of GENERIC_VALUES) entries.push({ key: g, group: 6, option: opt(g, '关键字', 'value') });
  return entries;
}

function unitEntries(query) {
  return CSS_UNITS.map((u) => ({
    key: query + u,
    group: 6,
    option: opt(query + u, '单位', 'unit'),
  }));
}

function pseudoEntries() {
  const entries = [];
  for (const p of CSS_PSEUDO_CLASSES) entries.push({ key: p, group: 3, option: opt(':' + p, '伪类', 'class') });
  for (const p of CSS_PSEUDO_ELEMENTS) entries.push({ key: p, group: 3, option: opt('::' + p, '伪元素', 'class') });
  return entries;
}

function snippetEntries() {
  return WIKI_CSS_SNIPPETS.map((s) => ({
    key: s.key,
    group: 8,
    option: opt(s.key, s.detail, 'snippet', s.css),
  }));
}

/** 块上下文空位/裸词：属性 + 选择器 + 元素 + 片段一起给（属性排最前） */
function mixedEntries(selectors) {
  return [ ...propertyEntries(), ...selectorEntries(selectors), ...snippetEntries() ];
}

/* ------------------------------------------------------------------ *
 * 补全源
 * ------------------------------------------------------------------ */

/**
 * CSS 补全源。结构与 ftmlCompletion 一致（同步返回 {from, options, filter:false}）。
 * 非 CSS 上下文返回 null（交还 FTML 源）；CSS 上下文里即使没有匹配候选也返回
 * 空结果对象——与 ftmlCompletion 的 isCssContext 守卫双保险，杜绝 FTML 候选混入。
 *
 * @param {import('@codemirror/autocomplete').CompletionContext} context
 * @returns {{from, options, filter:false}|null}
 */
export function cssCompletion(context) {
  const src = context.state.doc.toString();
  const pos = context.pos;
  const ctx = isCssContext(src, pos);
  if (!ctx) return null;

  const frag = parseCssFragment(src, pos, ctx.type);
  const dom = getDomData();

  let entries;
  switch (frag.kind) {
    case 'atrule':    entries = atruleEntries(); break;
    case 'var':       entries = varEntries(dom.variables); break;
    case 'units':     entries = unitEntries(frag.query); break;
    case 'value':     entries = valueEntries(frag.property, dom.variables); break;
    case 'pseudo':    entries = pseudoEntries(); break;
    case 'property':  entries = propertyEntries(); break;
    case 'selector':  entries = selectorEntries(dom.selectors); break;
    case 'mixed':     entries = ctx.type === 'attr-style' ? propertyEntries() : mixedEntries(dom.selectors); break;
    default:          entries = [];
  }

  const result = makeResult(frag.from, entries, frag.query, MAX_CANDIDATES);
  return result || { from: frag.from, options: [], filter: false };
}
