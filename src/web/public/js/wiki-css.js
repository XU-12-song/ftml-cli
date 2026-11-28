/**
 * wiki-css.js — Wikidot/SCP 版式 CSS 静态词汇表 + 纯工具函数
 *
 * 为 css-completion.js 提供离线候选数据（全部同步内存、无网络、不依赖 DOM/CM6，
 * 因此可在 node 单测中直接 import）。运行时候选的另一路（预览 iframe 真实 DOM
 * id/class 与 <style> 变量扫描）在 css-completion.js 里，本文件只做静态回退。
 *
 * 内容：
 *   - CSS_PROPERTIES      属性名（常用度序）
 *   - CSS_PROPERTY_VALUES 按属性枚举的值（键 = CSS 属性名，kebab-case）
 *   - COLOR_KEYWORDS      颜色关键字（color/background 等属性值用）
 *   - GENERIC_VALUES      通用值关键字（inherit/initial…）
 *   - CSS_UNITS           单位（数字后补单位用）
 *   - CSS_AT_RULES        at-rule
 *   - CSS_ELEMENTS        常用元素选择器
 *   - CSS_PSEUDO          伪类/伪元素（不带冒号）
 *   - WIKI_SELECTORS      内置 Wikidot/SCP DOM 地图（站点外壳 id、评分组件、
 *                         折叠块、tabview(yui)、脚注、image-block 等选择器）
 *   - BHL_VARIABLES       Black Highlighter 常用 CSS 变量（回退池，运行时以
 *                         iframe <style> 扫描结果为准）
 *   - WIKI_CSS_SNIPPETS   常用版式片段（移动端断点 / #side-bar / 评分组件 /
 *                         折叠块 / tab / 脚注 / BHL 变量覆盖）
 *   - fuzzyScore / makeResult / valuesForProperty …
 */

/* ------------------------------------------------------------------ *
 * 属性名
 * ------------------------------------------------------------------ */

export const CSS_PROPERTIES = [
  // 盒模型 / 布局
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'float', 'clear', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // flex / grid
  'flex', 'flex-direction', 'flex-wrap', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-content', 'align-self', 'order', 'gap', 'row-gap', 'column-gap',
  'grid', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-area',
  // 边框 / 轮廓
  'border', 'border-width', 'border-style', 'border-color',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'border-collapse', 'border-spacing',
  'outline', 'outline-color', 'outline-style', 'outline-width',
  // 背景
  'background', 'background-color', 'background-image', 'background-repeat',
  'background-position', 'background-size', 'background-attachment',
  // 字体 / 文本
  'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'white-space', 'word-break', 'word-wrap',
  'overflow-wrap', 'text-align', 'text-align-last', 'text-decoration', 'text-decoration-line',
  'text-decoration-color', 'text-transform', 'text-indent', 'text-shadow', 'text-overflow',
  'vertical-align', 'direction', 'tab-size',
  // 列表 / 表格 / 内容
  'list-style', 'list-style-type', 'list-style-position', 'list-style-image',
  'content', 'counter-reset', 'counter-increment', 'quotes',
  'table-layout', 'caption-side', 'empty-cells', 'object-fit', 'object-position',
  // 视觉效果
  'overflow', 'overflow-x', 'overflow-y', 'visibility', 'opacity',
  'box-shadow', 'filter', 'backdrop-filter', 'mix-blend-mode',
  'transform', 'transform-origin', 'perspective',
  'transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
  'animation', 'animation-name', 'animation-duration', 'animation-timing-function',
  'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode',
  // 交互 / 其他
  'cursor', 'pointer-events', 'user-select', 'resize', 'scroll-behavior',
  'image-rendering', 'aspect-ratio', 'columns', 'column-count', 'column-width',
];

/** 属性名快速判定表 */
export const CSS_PROPERTY_SET = new Set(CSS_PROPERTIES);

/* ------------------------------------------------------------------ *
 * 属性值枚举（键 = CSS 属性名）
 * ------------------------------------------------------------------ */

export const CSS_PROPERTY_VALUES = {
  'display': ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'table', 'table-cell', 'table-row', 'flow-root', 'none', 'contents'],
  'position': ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  'float': ['left', 'right', 'none', 'inline-start', 'inline-end'],
  'clear': ['none', 'left', 'right', 'both'],
  'box-sizing': ['content-box', 'border-box'],
  'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
  'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'justify-content': ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'],
  'align-items': ['stretch', 'flex-start', 'flex-end', 'center', 'baseline'],
  'align-content': ['stretch', 'flex-start', 'flex-end', 'center', 'space-between', 'space-around'],
  'align-self': ['auto', 'stretch', 'flex-start', 'flex-end', 'center', 'baseline'],
  'text-align': ['left', 'right', 'center', 'justify', 'start', 'end'],
  'vertical-align': ['baseline', 'top', 'middle', 'bottom', 'text-top', 'text-bottom', 'sub', 'super'],
  'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'],
  'word-break': ['normal', 'break-all', 'keep-all', 'break-word'],
  'overflow': ['visible', 'hidden', 'clip', 'scroll', 'auto'],
  'overflow-x': ['visible', 'hidden', 'clip', 'scroll', 'auto'],
  'overflow-y': ['visible', 'hidden', 'clip', 'scroll', 'auto'],
  'visibility': ['visible', 'hidden', 'collapse'],
  'border-style': ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset', 'hidden'],
  'border-collapse': ['collapse', 'separate'],
  'background-repeat': ['repeat', 'repeat-x', 'repeat-y', 'no-repeat', 'space', 'round'],
  'background-size': ['auto', 'cover', 'contain'],
  'background-attachment': ['scroll', 'fixed', 'local'],
  'font-weight': ['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
  'font-style': ['normal', 'italic', 'oblique'],
  'text-transform': ['none', 'capitalize', 'uppercase', 'lowercase', 'full-width'],
  'text-decoration-line': ['none', 'underline', 'overline', 'line-through'],
  'list-style-type': ['disc', 'circle', 'square', 'decimal', 'decimal-leading-zero', 'lower-roman', 'upper-roman', 'lower-alpha', 'upper-alpha', 'none'],
  'list-style-position': ['inside', 'outside'],
  'table-layout': ['auto', 'fixed'],
  'caption-side': ['top', 'bottom'],
  'object-fit': ['fill', 'contain', 'cover', 'none', 'scale-down'],
  'cursor': ['auto', 'default', 'pointer', 'crosshair', 'move', 'text', 'wait', 'progress', 'help', 'not-allowed', 'grab', 'grabbing', 'zoom-in', 'zoom-out', 'col-resize', 'row-resize'],
  'pointer-events': ['auto', 'none'],
  'user-select': ['auto', 'none', 'text', 'all', 'contain'],
  'resize': ['none', 'both', 'horizontal', 'vertical'],
  'scroll-behavior': ['auto', 'smooth'],
  'direction': ['ltr', 'rtl'],
  'image-rendering': ['auto', 'crisp-edges', 'pixelated'],
  'animation-direction': ['normal', 'reverse', 'alternate', 'alternate-reverse'],
  'animation-fill-mode': ['none', 'forwards', 'backwards', 'both'],
  'animation-iteration-count': ['infinite'],
  'transition-timing-function': ['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'],
  'flex-shrink': ['0', '1'],
  'flex-grow': ['0', '1'],
};

/** 颜色类属性：值候选追加颜色关键字与变量 */
export const CSS_COLOR_PROPERTIES = new Set([
  'color', 'background', 'background-color', 'border-color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', 'text-shadow', 'box-shadow', 'fill', 'stroke', 'caret-color',
]);

export const COLOR_KEYWORDS = [
  'transparent', 'currentcolor',
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'violet',
  'gray', 'grey', 'silver', 'maroon', 'olive', 'lime', 'aqua', 'cyan', 'magenta',
  'navy', 'teal', 'gold', 'pink', 'brown', 'beige', 'ivory', 'khaki', 'coral',
  'crimson', 'indigo', 'salmon', 'tan', 'tomato', 'wheat', 'whitesmoke', 'seashell',
];

/** 通用值关键字（几乎所有属性可用的兜底值） */
export const GENERIC_VALUES = ['inherit', 'initial', 'unset', 'revert'];

/** 数字后的单位候选 */
export const CSS_UNITS = ['px', 'em', 'rem', '%', 'vh', 'vw', 'vmin', 'vmax', 'pt', 'ch', 'ex', 'cm', 'mm', 'in', 'deg', 's', 'ms', 'fr'];

/** at-rule（`@` 前缀补全用） */
export const CSS_AT_RULES = ['@media', '@supports', '@keyframes', '@import', '@font-face', '@page', '@layer', '@container', '@charset'];

/** 常用元素选择器 */
export const CSS_ELEMENTS = [
  'body', 'div', 'span', 'a', 'p', 'br', 'hr', 'img', 'iframe',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'blockquote', 'pre', 'code', 'em', 'strong', 'sup', 'sub', 'small', 'del', 'ins', 'mark', 'abbr', 'cite', 'kbd', 'samp',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'label', 'fieldset', 'legend',
  'header', 'footer', 'main', 'section', 'article', 'aside', 'nav', 'figure', 'figcaption', 'details', 'summary',
];

/** 伪类 / 伪元素（不带冒号；应用时按需补 `:` 或 `::`） */
export const CSS_PSEUDO_CLASSES = [
  'hover', 'focus', 'active', 'visited', 'link', 'focus-visible', 'focus-within',
  'first-child', 'last-child', 'only-child', 'nth-child()', 'nth-last-child()',
  'first-of-type', 'last-of-type', 'not()', 'is()', 'where()', 'has()',
  'empty', 'checked', 'disabled', 'enabled', 'required', 'target', 'root',
];

export const CSS_PSEUDO_ELEMENTS = ['before', 'after', 'first-line', 'first-letter', 'placeholder', 'selection', 'marker'];

/* ------------------------------------------------------------------ *
 * 内置 Wikidot/SCP DOM 地图（静态回退；运行时与 iframe 扫描结果合并）
 * ------------------------------------------------------------------ */

export const WIKI_SELECTORS = [
  // 站点外壳（Sigma-9 / BHL 通用骨架 id）
  '#page-content', '#main-content', '#content-wrap', '#container', '#container-wrap', '#container-wrap-wrap',
  '#header', '#top-bar', '#side-bar', '#footer', '#license-area', '#html-body', '#skrollr-body',
  '#page-title', '#page-tags', '#action-area', '#search-top-box', '#login-status', '#toc', '#toc-list',
  // 评分组件
  '.page-rate-widget-box', '.rate-box', '.rate-points', '.rate-up', '.rate-down', '.rate-cancel', '.rate-buttons', '.page-tags',
  // 折叠块
  '.collapsible-block', '.collapsible-block-folded', '.collapsible-block-unfolded',
  '.collapsible-block-link', '.collapsible-block-content', '.collapsible-block-title',
  // tabview（Wikidot tabview 的 yui 结构）
  '.yui-navset', '.yui-nav', '.yui-content', '.yui-navset .yui-nav .selected', '.yui-navset .yui-nav a', '.yui-navset .yui-content .yui-content',
  // 脚注
  '.footnotes-footer', '.footnote-footer', '.footnoteref', '.footnoteblock',
  // 图片块
  '.image-block', '.scp-image-block', '.scp-image-caption',
  // 其他常见
  '.hovertip', '.error-block', '.bibcite', '.note', '.notes', '.page-source',
];

/** Black Highlighter 常用变量（静态回退池；运行时扫描 iframe <style> 为准） */
export const BHL_VARIABLES = [
  '--header-title', '--header-subtitle', '--logo-image',
  '--body-font', '--header-font', '--title-font', '--mono-font',
  '--swatch-primary', '--swatch-secondary-color', '--swatch-text-general', '--swatch-background',
  '--swatch-menubg-color', '--swatch-menutext-color',
  '--swatch-topmenu-bg-color', '--swatch-topmenu-text-color', '--swatch-border-color',
  '--link-color', '--visited-link-color', '--hover-link-color', '--new-page-color',
  '--sidebar-width-on-desktop',
];

/* ------------------------------------------------------------------ *
 * 常用版式片段（key 用于模糊匹配，css 为插入文本）
 * ------------------------------------------------------------------ */

export const WIKI_CSS_SNIPPETS = [
  { key: 'mobile-768', detail: '移动端断点', css: '@media (max-width: 768px) {\n  \n}' },
  { key: 'mobile-480', detail: '移动端断点', css: '@media (max-width: 480px) {\n  #page-content {\n    font-size: 90%;\n  }\n}' },
  { key: 'desktop-1024', detail: '桌面断点', css: '@media (min-width: 1024px) {\n  \n}' },
  { key: 'rate-widget', detail: '评分组件', css: '.page-rate-widget-box {\n  \n}' },
  { key: 'rate-points', detail: '评分分数', css: '.page-rate-widget-box .rate-points {\n  \n}' },
  { key: 'side-bar', detail: '侧边栏', css: '#side-bar {\n  \n}' },
  { key: 'collapsible', detail: '折叠块', css: '.collapsible-block {\n  \n}\n.collapsible-block-link {\n  \n}\n.collapsible-block-content {\n  \n}' },
  { key: 'tabview', detail: 'tab 选项卡', css: '.yui-navset .yui-nav {\n  \n}\n.yui-navset .yui-content {\n  \n}' },
  { key: 'footnote', detail: '脚注区', css: '.footnotes-footer {\n  \n}' },
  { key: 'bhl-vars', detail: 'BHL 变量覆盖', css: ':root {\n  --header-title: "标题";\n  --header-subtitle: "副标题";\n  --body-font: monospace;\n}' },
  { key: 'image-block', detail: '图片块', css: '.scp-image-block {\n  \n}\n.scp-image-caption {\n  \n}' },
];

/* ------------------------------------------------------------------ *
 * 模糊匹配 / 候选组装（与 completion.js 同一套打分口径，但本文件
 * 不依赖 CM6/dom.js，可在单测中独立运行）
 * ------------------------------------------------------------------ */

/**
 * 子序列模糊打分：`clps` 命中 `collapsible`。连续命中、词/大小写边界、起始靠前加分。
 * 完全不匹配返回 -1。
 */
export function fuzzyScore(query, label) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const l = String(label).toLowerCase();
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[ i ] !== q[ qi ]) continue;
    let s = 1;
    if (i === prev + 1) s += 2;                                        // 连续命中
    if (i === 0 || /[-_. /]/.test(l[ i - 1 ]) || /[A-Z]/.test(label[ i ])) s += 3; // 边界
    score += s;
    prev = i;
    qi++;
  }
  if (qi < q.length) return -1;
  score += Math.max(0, 8 - l.indexOf(q[ 0 ]));
  if (l === q) score += 20;
  return score;
}

/**
 * 按 (分组, 模糊分, 原序) 排序并裁剪。filter:false 由调用方声明——
 * 顺序在源里已排好，CM6 不再做二次过滤。
 * @param {number} from 替换起点
 * @param {Array<{key, group, option, prefixOnly?}>} entries
 * @param {string} query
 * @param {number} [cap] 候选上限（默认 2000）
 * @returns {{from, options, filter:false}|null}
 */
export function makeResult(from, entries, query, cap = 2000) {
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
  return { from, options: scored.slice(0, cap).map((x) => x.e.option), filter: false };
}

/** 按属性名取枚举值候选（未知属性返回空数组） */
export function valuesForProperty(prop) {
  return CSS_PROPERTY_VALUES[ String(prop || '').toLowerCase() ] || [];
}
