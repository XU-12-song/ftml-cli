/**
 * cm-editor.js — CodeMirror 6 编辑器工厂 + 兼容 textarea 的门面
 *
 * 设计
 *  - **基础着色**：StreamLanguage 直接包 cm-lexer.js 的纯词法器；token 名 → Tag 的
 *    映射走 StreamLanguage 的 tokenTable，颜色由 HighlightStyle 决定。
 *  - **textarea 门面**：老代码（editor.js / preview.js）是按
 *    `<textarea id="editor">` 的 API 写的。这里返回一个 facade，转发 value /
 *    selectionStart / setRangeText / setSelectionRange / addEventListener / composing
 *    等最常用的成员，从而把迁移改动降到最低。
 *  - **补全**：交给 @codemirror/autocomplete（completion.js 提供候选源）。方向键/回车/
 *    Esc 由它自带的 completionKeymap（Prec.highest）接管，无需再包 domEventHandlers。
 *
 * 真正创建视图的是 `createFtmlEditor({ parent, doc })`，返回 { view, facade }。
 */

import {
  EditorView,
  EditorState,
  StreamLanguage,
  syntaxHighlighting,
  HighlightStyle,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  indentOnInput,
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
  placeholder,
  autocompletion,
  tags,
  Decoration,
  ViewPlugin,
  RangeSetBuilder,
  StateField,
  StateEffect,
} from '../vendor/cm6/cm6.js';
import { token, startState } from './cm-lexer.js';
import { ftmlCompletion } from './completion.js';
import {
  BUILTIN_MACROS,
  diagnosticRanges,
  unknownMacroRanges,
  templateCallKeyRanges,
  templateHeaderKeys,
  templatePlaceholderRanges,
  macroBracketPairs,
  bracketPairAt,
} from './cm-semantics.js';

/** 词法器 token 名 → lezer Tag（StreamLanguage.tokenTable） */
const TOKEN_TAGS = {
  'block-marker': tags.tagName,
  'macro': tags.macroName,
  'macro-close': tags.tagName,
  'macro-attr': tags.attributeName,
  'macro-op': tags.operator,
  'macro-string': tags.string,
  'macro-value': tags.atom,
  'macro-delim': tags.bracket,
  'inert': tags.content,
  'comment': tags.comment,
  'literal': tags.literal,
  'link': tags.link,
  'heading': tags.heading,
  'strong': tags.strong,
  'emphasis': tags.emphasis,
  'strike': tags.strikethrough,
  'mono': tags.monospace,
  'table': tags.contentSeparator,
};

/** 配色：与 style.css 的 CSS 变量同色系（深色主题） */
const ftmlHighlightStyle = HighlightStyle.define([
  // 标签名（开 `[[div]]` 与闭 `[[/div]]` 同色）→ VSCode entity.name.tag
  { tag: tags.macroName, color: '#569cd6' },
  { tag: tags.tagName, color: '#569cd6' },
  { tag: tags.attributeName, color: '#9CDCFE' },                // 键 → variable
  { tag: tags.operator, color: '#d4d4d4' },                     // = 与 |
  { tag: tags.string, color: '#ce9178' },                       // "…"
  { tag: tags.atom, color: '#b5cea8' },                         // 裸值/数字
  { tag: tags.bracket, color: '#6b7280' },                      // `[[` / `]]` 分隔符（与标签名不同色）
  { tag: tags.content, color: '#d4d4d4' },                      // 惰性区原文（内容为白）
  { tag: tags.comment, color: '#6A9955', fontStyle: 'italic' },
  { tag: tags.literal, color: '#c4a7e7' },                      // @@…@@ / @<…>@
  { tag: tags.link, color: '#4f8cff', textDecoration: 'underline' },
  { tag: tags.heading, color: '#d6d8dc', fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, color: '#c4a7e7' },
  { tag: tags.contentSeparator, color: '#8a8f98' },             // || 表格
]);

/** CM6 深色主题（尺寸/字体交给 style.css 的 .cm-editor 规则，这里只管配色） */
const cmTheme = EditorView.theme({
  '&': { color: 'var(--fg)', backgroundColor: 'var(--bg)', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': {
    caretColor: 'var(--fg)',
    fontFamily: '"SF Mono", Consolas, "JetBrains Mono", Menlo, monospace',
    padding: '12px 0',
  },
  '.cm-line': { padding: '0 12px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#3a5a8c80',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg)',
    color: 'var(--fg-dim)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
  // 语义层：未知宏 / wdpr 诊断 / 模板键 / 括号配对
  '.cm-ftml-unknown': { color: '#f7768e', textDecoration: 'underline dotted #f7768e' },
  '.cm-ftml-error': { textDecoration: 'underline wavy #f7768e', textUnderlineOffset: '2px' },
  '.cm-ftml-warn': { textDecoration: 'underline wavy #e0af68', textUnderlineOffset: '2px' },
  '.cm-ftml-bracket': { backgroundColor: 'rgba(79, 140, 255, 0.30)', borderRadius: '2px' },
}, { dark: true });

/* ------------------------------------------------------------------ *
 * 语义层：整篇「全局知识」的判断 → Decoration
 *
 * 基础着色是逐行、无状态的；这里叠加需要通读全文的检查：
 *   - wdpr 结构诊断（未闭合块 / 块级误用）→ 波浪线
 *   - 不认识且非模板的 [[name]] → 警示色
 *   - 模板调用未声明的键 / 模板体未声明的 { key } → 波浪线
 *   - 光标处 [[ ↔ ]] 配对高亮
 * 文档变更后防抖 200ms 重算（语义计算要扫全文，不能每键一次）；
 * 光标移动只重算括号配对，复用已缓存的 token 配对。
 * ------------------------------------------------------------------ */

/** 装饰类型（class 由 cmTheme 定义） */
const unknownMark = Decoration.mark({ class: 'cm-ftml-unknown' });
const errorMark = Decoration.mark({ class: 'cm-ftml-error' });
const warnMark = Decoration.mark({ class: 'cm-ftml-warn' });
const bracketMark = Decoration.mark({ class: 'cm-ftml-bracket' });

/** 宿主 → 语义层的数据通道 */
const setDiagnosticsEffect = StateEffect.define();
const setTemplatesEffect = StateEffect.define();
const setKindEffect = StateEffect.define();
/** 防抖计时器到点后自派发，触发插件重算 */
const recomputeEffect = StateEffect.define();

const SEMANTIC_DEBOUNCE_MS = 200;

/** 跨 update 保存的语义输入（模板表 / 诊断 / 文件类型） */
const semanticData = StateField.define({
  create: () => ({ templates: new Map(), diagnostics: [], kind: 'source' }),
  update(val, tr) {
    let next = val;
    for (const e of tr.effects) {
      if (e.is(setDiagnosticsEffect)) next = { ...next, diagnostics: e.value || [] };
      else if (e.is(setTemplatesEffect)) next = { ...next, templates: e.value || new Map() };
      else if (e.is(setKindEffect)) next = { ...next, kind: e.value || 'source' };
    }
    return next;
  },
});

/** 把语义区间排序后装进 RangeSet（装饰器与 RangeSetBuilder 都要求 from 升序） */
function rangesToSet(ranges) {
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder();
  for (const r of ranges) builder.add(r.from, r.to, r.deco);
  return builder.finish();
}

class SemanticLayer {
  constructor(view) {
    this.timer = null;
    this.derive(view);
    this.decorations = this.finish(view);
  }

  /** 扫全文重算「与光标无关」的区间，并缓存括号配对表 */
  derive(view) {
    this.doc = view.state.doc.toString();
    const { templates, diagnostics, kind } = view.state.field(semanticData);
    this.pairs = macroBracketPairs(this.doc);

    const ranges = [];
    for (const r of diagnosticRanges(this.doc, diagnostics)) {
      ranges.push({ from: r.from, to: r.to, deco: r.severity === 'error' ? errorMark : warnMark });
    }

    const known = new Set(BUILTIN_MACROS);
    for (const name of templates.keys()) known.add(name);
    for (const r of unknownMacroRanges(this.doc, known)) {
      ranges.push({ from: r.from, to: r.to, deco: unknownMark });
    }

    for (const r of templateCallKeyRanges(this.doc, templates)) {
      ranges.push({ from: r.from, to: r.to, deco: warnMark });
    }

    if (kind === 'template') {
      const header = templateHeaderKeys(this.doc);
      if (header) {
        for (const r of templatePlaceholderRanges(this.doc, header.keys)) {
          ranges.push({ from: r.from, to: r.to, deco: warnMark });
        }
      }
    }
    this.ranges = ranges;
  }

  /** 叠加光标处括号配对，产出最终 DecorationSet */
  finish(view) {
    const ranges = this.ranges.slice();
    const pair = bracketPairAt(view.state.selection.main.head, this.pairs);
    if (pair) {
      ranges.push({ from: pair.open.from, to: pair.open.to, deco: bracketMark });
      ranges.push({ from: pair.close.from, to: pair.close.to, deco: bracketMark });
    }
    return rangesToSet(ranges);
  }

  update(u) {
    const effectful = u.transactions.some((tr) => tr.effects.length > 0);
    const recompute = effectful && u.transactions.some((tr) => tr.effects.some((e) => e.is(recomputeEffect)));
    const dataChanged = u.startState.field(semanticData) !== u.state.field(semanticData);

    if (recompute || dataChanged) {
      clearTimeout(this.timer);
      this.timer = null;
      this.derive(u.view);
      this.decorations = this.finish(u.view);
      return;
    }
    if (u.docChanged) {
      // 立即清空，避免旧偏移落在新文档上；随后防抖重算
      this.pairs = [];
      this.ranges = [];
      this.decorations = Decoration.none;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        u.view.dispatch({ effects: recomputeEffect.of(null) });
      }, SEMANTIC_DEBOUNCE_MS);
      return;
    }
    if (u.selectionSet) this.decorations = this.finish(u.view);
  }

  destroy() { clearTimeout(this.timer); }
}

const semanticPlugin = ViewPlugin.fromClass(SemanticLayer, {
  decorations: (v) => v.decorations,
});

/** StreamParser 规格：直接复用纯词法器（跨行状态由其自带的 state 承载） */
const ftmlStreamParser = {
  name: 'ftml',
  startState,
  token,
  tokenTable: TOKEN_TAGS,
};

/**
 * 建一个 FTML 编辑器。
 * @param {object} opts
 * @param {HTMLElement} opts.parent  宿主容器（#editor-container）
 * @param {string} [opts.doc]        初始文本
 * @param {string} [opts.placeholder] 空文档时的提示文案
 * @returns {{ view: EditorView, facade: object }}
 */
export function createFtmlEditor({ parent, doc = '', placeholder: hint = '' } = {}) {
  /** 各类 DOM 事件处理器（老代码用 addEventListener 注册） */
  const handlers = { input: [] };
  let suppress = false; // 程序化改 doc 时不触发 input（对齐 textarea 的 value= 语义）

  const emit = (type, arg) => {
    for (const h of handlers[ type ].slice()) h(arg);
  };

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        EditorView.lineWrapping,
        hint ? placeholder(hint) : [],
        StreamLanguage.define(ftmlStreamParser),
        syntaxHighlighting(ftmlHighlightStyle),
        semanticData,
        semanticPlugin,
        autocompletion({
          override: [ ftmlCompletion ],
          activateOnTyping: true,
          closeOnBlur: true,
          maxRenderedOptions: 12,
          icons: true,
        }),
        cmTheme,
        keymap.of([ ...defaultKeymap, ...historyKeymap, indentWithTab ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !suppress) emit('input');
        }),
      ],
    }),
  });

  /** 整篇替换（程序化，不触发 input） */
  function setDoc(text) {
    const str = text == null ? '' : String(text);
    suppress = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: str },
      selection: { anchor: 0 },
    });
    suppress = false;
  }

  const facade = {
    view,

    // ---- textarea 兼容成员 ----
    get value() { return view.state.doc.toString(); },
    set value(text) { setDoc(text); },

    get selectionStart() { return view.state.selection.main.head; },
    get selectionEnd() { return view.state.selection.main.anchor; },

    get composing() { return view.composing; },

    focus() { view.focus(); },

    getBoundingClientRect() { return view.dom.getBoundingClientRect(); },

    addEventListener(type, handler) {
      if (handlers[ type ]) handlers[ type ].push(handler);
    },
    removeEventListener(type, handler) {
      const arr = handlers[ type ];
      if (!arr) return;
      const i = arr.indexOf(handler);
      if (i >= 0) arr.splice(i, 1);
    },

    /** 对齐 HTMLTextAreaElement.setRangeText（程序化，不触发 input） */
    setRangeText(insert, from, to, mode = 'preserve') {
      const len = insert.length;
      let selection;
      if (mode === 'end') selection = { anchor: from + len };
      else if (mode === 'start') selection = { anchor: from };
      else if (mode === 'select') selection = { anchor: from, head: from + len };
      else selection = { anchor: from + len };
      suppress = true;
      view.dispatch({
        changes: { from, to, insert },
        selection,
        scrollIntoView: true,
      });
      suppress = false;
    },

    /** 对齐 HTMLTextAreaElement.setSelectionRange */
    setSelectionRange(anchor, head = anchor) {
      view.dispatch({ selection: { anchor, head } });
    },

    /** 光标视口坐标（相对 view.dom 左上角） */
    coordsAtCaret() {
      const head = view.state.selection.main.head;
      const c = view.coordsAtPos(head);
      if (!c) return { x: 0, y: 0, lineHeight: 16 };
      const r = view.dom.getBoundingClientRect();
      return {
        x: c.left - r.left,
        y: c.top - r.top,
        lineHeight: Math.max(1, c.bottom - c.top),
      };
    },

    // ---- 语义层数据通道（由宿主在渲染/刷新侧边栏后注入）----

    /** 注入 wdpr 结构诊断（render 结果里的 diagnostics） */
    setDiagnostics(diags) {
      view.dispatch({ effects: setDiagnosticsEffect.of(diags || []) });
    },

    /** 注入当前项目模板名 → 声明键表（sidebar 的 templates） */
    setTemplates(map) {
      const m = map instanceof Map ? new Map(map) : new Map(Object.entries(map || {}));
      view.dispatch({ effects: setTemplatesEffect.of(m) });
    },

    /** 标记当前文件类型：'template'（.ftmx，检查 { key }）或 'source' */
    setFileKind(kind) {
      view.dispatch({ effects: setKindEffect.of(kind || 'source') });
    },

    /** 选中区间并滚动到可见（问题列表点击跳转用）；越界自动收敛到文档范围 */
    revealRange(from, to = from) {
      const len = view.state.doc.length;
      const f = Math.max(0, Math.min(from ?? 0, len));
      const t = Math.max(f, Math.min(to ?? f, len));
      view.dispatch({
        selection: { anchor: f, head: t },
        scrollIntoView: true,
      });
      view.focus();
    },
  };

  return { view, facade };
}
