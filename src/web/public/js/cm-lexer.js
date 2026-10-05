/**
 * cm-lexer.js — FTML 基础着色词法器（纯函数，不依赖 CodeMirror，可单测）
 *
 * 设计要点
 *  - **容错的行式扫描**：编辑器里随时是半成品/半截标签，绝不能像解析器那样报错。
 *    这里只按形状给 token 上色，不认识的一律当普通文本。
 *  - **惰性区**：`[[code]]` / `[[html]]` / `[[embed*]]` / `[[style]]` 体内原样不解析
 *    （Wikidot 语义；style 体内是裸 CSS），所以整段按 `inert` 输出，内部记号不触发着色。
 *  - **跨行状态**：注释 `[!-- --]`、字面量 `@@ @@`、惰性区都需要跨行记忆。
 *  - token 名是任意字符串，具体颜色由 cm-editor.js 的 tokenTable / HighlightStyle 决定。
 *
 * 该模块导出 `startState` / `token` 两个符合 CodeMirror StreamParser 约定的函数，
 * 以及 `INERT_CONTAINERS`。token(stream, state) 需配合一个 StringStream
 * （提供 match/next/peek/sol/eol/pos/string/skipToEnd）。
 */

/**
 * 体内原样保留、不解析的块级容器。
 * Wikidot: code/html/embed/embedvideo/embedaudio；style 的体内是裸 CSS
 * （expand.js 原样收集为 [[module CSS]]），同样不该按 FTML 着色。
 */
export const INERT_CONTAINERS = new Set(['code', 'html', 'embed', 'embedvideo', 'embedaudio', 'style']);

/** 行内成对记号：开记号 → token 名 */
const INLINE_MARKERS = [
  ['**', 'strong'],
  ['//', 'emphasis'],
  ['__', 'emphasis'],
  ['^^', 'emphasis'],
  [',,', 'emphasis'],
  ['--', 'strike'],
  ['{{', 'mono'],
  ['}}', 'mono'],
  ['||', 'table'],
];

/** 块级标签（行首独占一行才解析为块）——用于把行首宏标为 block-marker（弱化显示） */
export const BLOCK_TAGS = new Set([
  'div', 'note', 'code', 'collapsible', 'tabview', 'table', 'row', 'gallery',
  'math', 'html', 'embed', 'embedvideo', 'embedaudio', 'footnoteblock', 'module',
  'style', 'component',
]);

export function startState() {
  return {
    inert: null, inMacro: false, pendingInert: null, comment: false, literal: false,
    // `[[` / `[[/` 已消费，下一个 token 是标签名（尖括号/圆括号拆成两个 token，
    // 好让 `[[` 与标签名用不同配色；名字读完即清空）
    macroPhase: null,
    macroClose: false,   // 当前标签是闭标签 `[[/name]]`
    blockStart: false,   // `[[` 位于行首（配合 BLOCK_TAGS 决定是否块级弱化）
  };
}

/** 标签名（`[[` 或 `[[/` 已被单独消费）；名字可能为空（半截输入） */
function readMacroName(stream) {
  const m = /^(#?[A-Za-z][A-Za-z0-9:_-]*)/.exec(stream.string.slice(stream.pos));
  if (m) {
    for (let i = 0; i < m[1].length; i++) stream.next();
    return m[1];
  }
  const sym = /^([<>=]+)/.exec(stream.string.slice(stream.pos));
  if (sym) {
    for (let i = 0; i < sym[1].length; i++) stream.next();
    return sym[1];
  }
  return '';
}

function inertToken(stream, state) {
  const close = `[[/${state.inert}]]`;
  const idx = stream.string.indexOf(close, stream.pos);
  if (idx === -1) {
    stream.skipToEnd();
    return 'inert';
  }
  while (stream.pos < idx) stream.next();
  return 'inert';
}

/** 宏参数上下文：逐个吃掉空白/键/=/字符串/值，直到 `]]` */
function macroArgsToken(stream, state) {
  if (stream.match(']]')) {
    state.inMacro = false;
    if (state.pendingInert) {
      state.inert = state.pendingInert;
      state.pendingInert = null;
    }
    return 'macro-delim';
  }
  if (stream.match(/^\s+/)) return null;
  if (stream.match(/^[A-Za-z_][A-Za-z0-9_:.-]*(?==)/)) return 'macro-attr';
  if (stream.match('=')) return 'macro-op';
  if (stream.match(/^"[^"]*"/)) return 'macro-string';
  if (stream.match('|')) return 'macro-op';
  if (stream.match(/^[^\s\]|"]+/)) return 'macro-value';
  stream.next();
  return 'macro-value';
}

/** `[[` / `[[/` 已消费：读标签名，返回名字 token（开标签 `macro`/`block-marker`，闭标签 `macro-close`） */
function macroNameToken(stream, state) {
  const isClose = state.macroClose;
  const blockStart = state.blockStart;
  state.macroClose = false;
  state.blockStart = false;

  const name = readMacroName(stream);
  state.inMacro = true;
  if (!name) return macroArgsToken(stream, state); // 半截 `[[`：交给参数扫描吃掉 `]]` 等
  if (isClose) return 'macro-close';
  if (INERT_CONTAINERS.has(name)) state.pendingInert = name;
  return blockStart && BLOCK_TAGS.has(name) ? 'block-marker' : 'macro';
}

export function token(stream, state) {
  // 跨行的注释放/字面量优先
  if (state.comment) {
    if (stream.match(/^[^]*?--\]/)) { state.comment = false; return 'comment'; }
    stream.skipToEnd();
    return 'comment';
  }
  if (state.literal) {
    if (stream.match(/^[^]*?@@/)) { state.literal = false; return 'literal'; }
    stream.skipToEnd();
    return 'literal';
  }
  if (state.inert) {
    // 恰好走到闭标签起点：退出惰性区，让常规分支把 `[[/`、名字、`]]` 拆成三个 token
    const close = `[[/${state.inert}]]`;
    if (stream.string.slice(stream.pos, stream.pos + close.length) === close) {
      state.inert = null;
    } else {
      return inertToken(stream, state);
    }
  }
  // `[[` / `[[/` 已作为分隔符单独产出，本次调用读标签名
  if (state.macroPhase === 'name') { state.macroPhase = null; return macroNameToken(stream, state); }
  if (state.inMacro) return macroArgsToken(stream, state);

  const ch = stream.peek();
  if (ch == null) { stream.next(); return null; }

  if (stream.match('[!--')) { state.comment = true; return 'comment'; }
  if (stream.match('@@')) { state.literal = true; return 'literal'; }
  if (stream.match('@<')) {
    if (!stream.match(/^[^]*?>@/)) stream.skipToEnd();
    return 'literal';
  }
  if (stream.match('[[[')) {
    stream.match(/^[^]*?\]\]\]/);
    return 'link';
  }
  if (stream.match('[[')) {
    // `[[` / `[[/` 只吃掉分隔符本身；标签名下一次调用交给 macroNameToken，
    // 这样 `[[` 与 `div` 会拿到各自的 token 名（不同配色）。
    state.blockStart = stream.pos === 2;      // `[[` 紧贴行首
    state.macroClose = !!stream.match('/');    // 闭标签 `[[/`
    state.macroPhase = 'name';
    return 'macro-delim';
  }
  if (stream.match('====')) return 'heading';

  for (const [marker, tok] of INLINE_MARKERS) {
    if (stream.match(marker)) return tok;
  }

  stream.next();
  return null;
}
