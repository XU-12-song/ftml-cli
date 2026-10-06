/**
 * completion.js — FTML 编辑器补全源（@codemirror/autocomplete 的 CompletionSource）
 *
 * 取代原先手写的浮层（已删的 autocomplete.js）。候选全部来自内存结构，同步、无网络：
 *   state.templates / state.components / state.sources / state.snippets（dom.js）
 *   WIKI_DEFS / WIKI_MODULES / WIKI_BY_NAME（wiki.js）
 *   lexTokens（cm-semantics.js，仅 `[[/` 闭合补全用，取其未闭合开标签栈）
 *
 * 触发上下文（按顺序判定，命中即返回）：
 *   1. [[component src="…   → 组件文件路径
 *   2. [[include …          → 组件 + 本地源文件页名
 *   3. [[name …             → 模板声明键 / 内置标签属性 / module 模块名（跳过已填过的键；
 *                             属性补成 `key=""` 且光标落在引号内，module 名不带引号）
 *   4. [[/…                 → 闭合标签补全（扫描未闭合的开标签）
 *   5. [[前缀               → 项目模板名（优先）+ 内置 Wikidot 标签
 *   6. 裸单词               → 自定义 snippet 前缀、comp./tmpl. 命名空间、组件/模板全标签、
 *                             内置 Wikidot 标签（`div` 直接补成 `[[div]]…[[/div]]`；标签候选
 *                             只认 ≥3 字符的前缀，避免 `in`/`co` 这类日常词一闪一闪）
 *
 * 排序在源里自己做（fuzzyScore），因此结果带 `filter: false`，让 CM6 原样保留顺序。
 * 注意：filter:false 时不能用 validFor（只在过滤路径生效），所以本源必须每次击键重算——
 * 好在全是同步内存查询，代价可忽略。
 */
import { snippetCompletion } from '../vendor/cm6/cm6.js';
import { state } from './dom.js';
import { WIKI_MODULES, WIKI_DEFS, WIKI_BY_NAME, wikiInsertAfterOpen } from './wiki.js';
import { lexTokens, pairKey } from './cm-semantics.js';

/* ------------------------------------------------------------------ *
 * snippet 语法转换：Ace `$0/$1` → CM6 `${}`/`${1}`
 * ------------------------------------------------------------------ */

/**
 * Ace 占位符 → CM6 snippet 模板：`$0`（最终光标）→ `${}`，`$N` → `${N}`。
 * 不修改 snippets.js 的数据格式——磁盘上的 snippets.json / Ace .snippets 导入导出保持原样。
 */
function aceToCmSnippet(tpl) {
  const SENTINEL = '\u0000'; // 暂存 Ace 的 `\$` 转义，避免被当成占位符
  return String(tpl ?? '')
    .replace(/\\\$/g, SENTINEL)
    .replace(/\$(\d+)/g, (_, n) => (n === '0' ? '${}' : '${' + n + '}'))
    .replace(new RegExp(SENTINEL, 'g'), '$');
}

/** CM6 snippet 里把字面量 `{`/`}` 转义（`{ key }` 这类模板占位符不能被当成字段） */
function escapeSnippetLiteral(s) {
  return String(s ?? '').replace(/[{}]/g, (m) => '\\' + m);
}

/* ------------------------------------------------------------------ *
 * 模糊匹配
 * ------------------------------------------------------------------ */

/**
 * 子序列模糊打分：`clps` 命中 `collapsible`。连续命中、词/大小写边界、起始靠前都加分。
 * 完全不匹配（子序列都不成立）返回 -1。
 */
function fuzzyScore(query, label) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const l = String(label).toLowerCase();
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[ i ] !== q[ qi ]) continue;
    let s = 1;
    if (i === prev + 1) s += 2;                                       // 连续命中
    if (i === 0 || /[-_. /]/.test(l[ i - 1 ]) || /[A-Z]/.test(label[ i ])) s += 3; // 边界
    score += s;
    prev = i;
    qi++;
  }
  if (qi < q.length) return -1;
  score += Math.max(0, 8 - l.indexOf(q[ 0 ])); // 起始越靠前越高
  if (l === q) score += 20; // 完全相同优先于更长的模糊命中（`tab` 排在 `tabview` 前）
  return score;
}

/**
 * 按 (分组, 模糊分, 原序) 排序并裁剪。空 query 时按原顺序（Ctrl+Space 场景）。
 * @param {number} from  替换起点（本上下文内所有候选共用）
 * @param {Array<{option, key, group, prefixOnly?}>} entries
 *        prefixOnly：该条只认前缀匹配（不跑模糊子序列），用于压低裸词补全的噪声
 * @param {string} query
 * @returns {{from, options, filter:false}|null}
 */
function makeResult(from, entries, query) {
  const scored = [];
  const q = query ? query.toLowerCase() : '';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[ i ];
    if (q && e.prefixOnly && !String(e.key).toLowerCase().startsWith(q)) continue;
    const s = query ? fuzzyScore(query, e.key) : 0;
    if (s < 0) continue;
    scored.push({ e, i, s });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => (a.e.group - b.e.group) || (b.s - a.s) || (a.i - b.i));
  return { from, options: scored.map((x) => x.e.option), filter: false };
}

/* ------------------------------------------------------------------ *
 * [[/ 闭合补全：未闭合开标签栈
 * ------------------------------------------------------------------ */

function isPairable(name) {
  if (state.templates.has(name)) return true;
  const w = WIKI_BY_NAME.get(name);
  return Boolean(w && w.close !== 'single');
}

/**
 * 扫描 [0, pos) 的词法 token，返回仍未闭合的开标签名（外→内）。
 * 名字先过 pairKey 去掉 `_` 变体后缀（`[[div_]]` 用 `[[/div]]` 闭合，见 cm-semantics.js），
 * 栈里存归一化后的名字，据此产出的闭合候选才与 macroBracketPairs 的高亮口径一致。
 */
function openStackAt(source, pos) {
  const stack = [];
  let pending = null; // 开标签名已读，等它的 `]]`
  for (const t of lexTokens(source)) {
    if (t.from >= pos) break;
    const text = source.slice(t.from, t.to);
    if (t.type === 'macro-delim') {
      if (text === ']]' && pending) { stack.push(pending); pending = null; }
      continue;
    }
    if (t.type === 'macro' || t.type === 'block-marker') {
      const name = pairKey(text);
      pending = isPairable(name) ? name : null;
      continue;
    }
    if (t.type === 'macro-close') {
      const name = pairKey(text);
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[ i ] === name) { stack.splice(i, 1); break; }
      }
      pending = null;
    }
  }
  return stack;
}

/* ------------------------------------------------------------------ *
 * 候选构造
 * ------------------------------------------------------------------ */

function componentOption(c) {
  const path = `components/${c}.ftml`;
  // 触发处已经打了一半 `src="`，收尾的 `"` 由候选补上，省掉手打
  return { label: path, detail: '组件', type: 'text', apply: path + '"' };
}

function templateTagOption(n, keys) {
  const tpl = aceToCmSnippet(`[[${n}]]\n$0\n[[/${n}]]`);
  return snippetCompletion(tpl, { label: n, detail: keys.length ? keys.join(' ') : '模板', type: 'template' });
}

function builtinTagOption(w) {
  // 开头的 `[[` 由候选自己补：`[[前缀` 的替换起点落在 `[[`，Ctrl+Space 兜底处也可能没有 `[[`。
  // （wikiInsertAfterOpen 只返回 `[[` 之后的文本，与模板候选的写法保持一致。）
  const tpl = aceToCmSnippet('[[' + wikiInsertAfterOpen(w));
  return snippetCompletion(tpl, { label: w.n, detail: w.desc, type: 'tag' });
}

function fullComponentOption(c) {
  const tpl = aceToCmSnippet(`[[component src="components/${c}.ftml"]][[/component]]$0`);
  return snippetCompletion(tpl, { label: `组件 ${c}`, detail: `components/${c}.ftml`, type: 'text' });
}

function fullTemplateOption(n, keys) {
  const tpl = aceToCmSnippet(`[[${n}]]$0[[/${n}]]`);
  return snippetCompletion(tpl, { label: `模板 ${n}`, detail: keys.length ? keys.join(' ') : '', type: 'template' });
}

/** 模板 + 内置标签（模板在前、同名去重），供 `[[前缀` 与 Ctrl+Space 兜底共用 */
function tagEntries() {
  const entries = [];
  const seen = new Set();
  for (const [ n, keys ] of state.templates) {
    seen.add(n);
    entries.push({ key: n, group: 0, option: templateTagOption(n, keys) });
  }
  for (const w of WIKI_DEFS) {
    if (seen.has(w.n)) continue;
    entries.push({ key: w.n, group: 1, option: builtinTagOption(w) });
  }
  return entries;
}

/**
 * 标签名 → 可补的键。mode 'attr' 的条目补 `key=""`（光标落在引号里），mode 'module'
 * 补模块名本身（`[[module CSS]]`，模块名既没有 `=` 也不带引号）。
 *
 * `_` 变体（`[[div_]]` / `[[span_]]`）与基名共用同一套属性键，所以查表前先过 pairKey；
 * WIKI_DEFS 只收录基名，不比对就直接查不到。
 */
function attrKeysFor(name) {
  if (state.templates.has(name)) return { keys: state.templates.get(name), mode: 'attr' };
  const wiki = WIKI_BY_NAME.get(pairKey(name));
  if (!wiki) return null;
  if (wiki.n === 'module') return { keys: WIKI_MODULES, mode: 'module' };
  return { keys: wiki.attrs || [], mode: 'attr' };
}

/* ------------------------------------------------------------------ *
 * 补全源
 * ------------------------------------------------------------------ */

/**
 * @param {import('@codemirror/autocomplete').CompletionContext} context
 * @returns {{from, options, filter:false}|null}
 */
export function ftmlCompletion(context) {
  // 1. 组件路径: [[component src="
  const mComp = context.matchBefore(/\[\[component\s+src="[^"]*$/);
  if (mComp) {
    const q = mComp.text.slice(mComp.text.lastIndexOf('"') + 1);
    const from = context.pos - q.length;
    const r = makeResult(
      from,
      state.components.map((c) => ({ key: `components/${c}.ftml`, group: 0, option: componentOption(c) })),
      q
    );
    if (r) return r;
  }

  // 2. 包含: [[include …（组件 + 本地源文件）
  const mInc = context.matchBefore(/\[\[include[ \t]+[^\]]*$/);
  if (mInc) {
    const tail = mInc.text.slice('[[include'.length);
    const q = (tail.match(/[^\s]*$/)?.[ 0 ]) || '';
    const from = context.pos - q.length;
    const entries = [
      ...state.components.map((c) => ({ key: `components/${c}`, group: 0, option: { label: `components/${c}`, detail: '组件', type: 'text', apply: `components/${c}` } })),
      ...state.sources.map((s) => ({ key: s, group: 1, option: { label: s, detail: '页面', type: 'text', apply: s } })),
    ];
    const r = makeResult(from, entries, q);
    if (r) return r;
  }

  // 3. 标签键: [[name 已输入键…（跳过头部里已出现的键）
  const mAttr = context.matchBefore(/\[\[([A-Za-z][\w:-]*)[ \t]+[^\]]*$/);
  if (mAttr) {
    // matchBefore 只返回 {from,to,text}，没有捕获组，名字得自己从 text 里切
    const name = /^\[\[([A-Za-z][\w:-]*)/.exec(mAttr.text)?.[ 1 ];
    const spec = name && attrKeysFor(name);
    if (spec && spec.keys.length) {
      const tail = mAttr.text.slice(2 + name.length);
      const q = (tail.match(/[^\s=]*$/)?.[ 0 ]) || '';
      const used = new Set();
      for (const mm of tail.matchAll(/([A-Za-z][\w:-]*)[ \t]*=/g)) used.add(mm[ 1 ].toLowerCase());
      const entries = spec.keys
        .filter((k) => !used.has(k.toLowerCase()))
        .map((k) => (spec.mode === 'module'
          ? { key: k, group: 0, option: { label: k, detail: '模块', type: 'namespace', apply: k } }
          : { key: k, group: 0, option: snippetCompletion(escapeSnippetLiteral(k) + '="${}"', { label: `${k}=`, detail: '属性', type: 'property' }) }));
      const r = makeResult(context.pos - q.length, entries, q);
      if (r) return r;
    }
  }

  // 4. 闭合标签: [[/…（列出未闭合的开标签）
  const mClose = context.matchBefore(/\[\[\/([A-Za-z][\w:-]*)?$/);
  if (mClose) {
    const q = mClose.text.slice(3); // 去掉 `[[/`
    const from = context.pos - q.length;
    // 只算 `[[/` 之前的部分，避免把正在输入的闭标签本身当成已闭合
    const stack = openStackAt(context.state.doc.toString(), from - 3);
    const entries = stack.map((n) => ({ key: n, group: 0, option: { label: n, detail: '闭合', type: 'tag', apply: `${n}]]` } }));
    const r = makeResult(from, entries, q);
    if (r) return r;
  }

  // 5. 标签名: [[前缀（模板优先，内置兜底）；前缀可为空，刚敲完 `[[` 即列出全部
  const mTag = context.matchBefore(/\[\[([A-Za-z][\w:-]*)?$/);
  if (mTag) {
    const r = makeResult(mTag.from, tagEntries(), mTag.text.slice(2));
    if (r) return r;
  }

  // 6. 裸单词：snippet / 命名空间 / 组件·模板全标签（末尾允许一个 `.`，好让 `comp.` 立刻出候选）
  const mWord = context.matchBefore(/[A-Za-z][\w:-]*(?:\.[A-Za-z][\w:-]*)*\.?$/);
  if (mWord) {
    const word = mWord.text;
    const from = mWord.from;
    const prev = from > 0 ? context.state.sliceDoc(from - 1, from) : '';
    const entries = [];

    // 6a. 命名空间 comp./tmpl. → 实时列出该命名空间下的候选
    const ns = state.snippets.find((s) => s.kind && word.startsWith(s.prefix));
    if (ns) {
      const rest = word.slice(ns.prefix.length);
      if (ns.kind === 'component') {
        for (const c of state.components) entries.push({ key: c, group: 0, option: fullComponentOption(c) });
      } else if (ns.kind === 'template') {
        for (const [ n, keys ] of state.templates) entries.push({ key: n, group: 0, option: fullTemplateOption(n, keys) });
      }
      const r = makeResult(from, entries, rest);
      if (r) return r;
    }

    // 6b. 自定义 snippet：word 含完整前缀 → 剩余部分作 $1 参数；正在敲前缀（≥2 字符）也列出
    for (const snip of state.snippets) {
      if (snip.kind) continue;
      let param = null;
      if (word.startsWith(snip.prefix) && word !== snip.prefix) param = word.slice(snip.prefix.length);
      else if (word.length >= 2 && snip.prefix.startsWith(word)) param = '';
      if (param === null) continue;
      let tpl = aceToCmSnippet(snip.template);
      if (param) tpl = tpl.replace(/\$\{1\}/g, escapeSnippetLiteral(param));
      entries.push({
        // 已带参数时用整词当 key：前缀后面的参数不在 label 里，用前缀做模糊匹配必然失败
        key: param ? word : snip.prefix,
        group: 1,
        option: snippetCompletion(tpl, { label: snip.description || snip.prefix, detail: snip.prefix, type: 'method' }),
      });
    }

    // 6c. 裸单词前缀匹配组件/模板名；排除属性/值上下文（css 值、引号内容等）避免误弹
    if (word.length >= 2 && !word.includes('.') && !/[:."'=,[/]/.test(prev)) {
      for (const c of state.components) entries.push({ key: c, group: 2, option: fullComponentOption(c) });
      for (const [ n, keys ] of state.templates) entries.push({ key: n, group: 2, option: fullTemplateOption(n, keys) });
      // 6d. 内置 Wikidot 标签：不打 `[[` 也补全（`div` → `[[div]]…[[/div]]`，`code` → 代码块骨架）。
      //     这里只认前缀——裸词上用模糊子序列会命中一大片日常英文（`to` 命中 toc/footnote），
      //     前缀匹配能把误弹压到「确实打的是标签名」。模板同名的不重复给（前面已按模板插入）。
      //     另要求 ≥3 字符：内置标签名最短就是 3（div/code/toc），而 2 字符前缀全是日常词
      //     （`in`→include、`co`→code、`no`→note、`ta`→tabview），正文里一闪一闪很吵。
      if (word.length >= 3) {
        for (const w of WIKI_DEFS) {
          if (state.templates.has(w.n)) continue;
          entries.push({ key: w.n, group: 3, prefixOnly: true, option: builtinTagOption(w) });
        }
      }
    }

    const r = makeResult(from, entries, word);
    if (r) return r;
  }

  // Ctrl+Space：光标处没有可识别上下文时，按当前词兜底列出模板 / 内置标签
  if (context.explicit) {
    const wm = context.matchBefore(/[A-Za-z][\w:-]*$/);
    const from = wm ? wm.from : context.pos;
    const word = wm ? wm.text : '';
    // 主动触发就该弹东西：当前词一个都不匹配时退回完整列表，而不是静默关掉
    return makeResult(from, tagEntries(), word) || makeResult(from, tagEntries(), '');
  }

  return null;
}
