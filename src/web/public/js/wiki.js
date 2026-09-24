/**
 * wiki.js — 内置 Wikidot 语法补全表
 *
 * 只收录标准 Wikidot 可解析的 [[...]] 标签（依据 scp-jp wikidot-syntax 参考）。
 * close: 'block'  = 块级标签，开/闭各独占一行（否则不解析）
 *        'pair'   = 行内配对标签
 *        'single' = 自闭合标签（无配对）
 * arg:   需要参数的标签：arg===true 时选中后光标停在参数位（可续输），
 *        为字符串时作为示例参数插入开标签内。
 * attrs: 在 `[[name 已输入…` 内部可补全的属性键（case 2）。
 *
 * 说明：[[module]] 的模块名（CSS/ListPages…）与 SCP 站点专用 include
 *（:scp-xx: 前缀）不在默认表内——模块名由 WIKI_MODULES 提供。
 */
export const WIKI_MODULES = [
  'CSS', 'ListPages', 'CountPages', 'Rate', 'Comments', 'NewPage',
  'TagCloud', 'PageTree', 'PageCalendar', 'Redirect', 'Backlinks',
  'WantedPages', 'Members', 'Categories',
];

export const WIKI_DEFS = [
  { n: 'div', close: 'block', attrs: [ 'class', 'style', 'id' ], desc: '块容器（SCP 排版常用，可配 class/style）' },
  { n: 'span', close: 'pair', attrs: [ 'class', 'style', 'id' ], desc: '行内容器' },
  { n: 'size', close: 'pair', arg: '150%', desc: '字号（150% / larger / 18px…）' },
  { n: 'note', close: 'block', desc: '注记块（引用框效果，SCP 常用）' },
  { n: 'code', close: 'block', attrs: [ 'type' ], desc: '代码块（内容原样不解析）' },
  { n: 'collapsible', close: 'block', attrs: [ 'show', 'hide', 'hideLocation', 'folded' ], desc: '折叠块（不可嵌套）' },
  { n: 'tabview', close: 'block', desc: '选项卡容器（内放 tab）' },
  { n: 'tab', close: 'pair', arg: '标题', desc: '单个选项卡（标题参数，置于 tabview 内）' },
  { n: 'toc', close: 'single', desc: '目录' },
  { n: 'footnote', close: 'pair', desc: '脚注（悬浮小窗显示内容）' },
  { n: 'footnoteblock', close: 'single', desc: '脚注列位置（可选）' },
  { n: 'include', close: 'single', arg: true, desc: '包含页面/组件（必须行首）' },
  { n: 'image', close: 'single', arg: true, attrs: [ 'link', 'alt', 'title', 'width', 'height', 'style', 'class', 'size' ], desc: '图片（link 前加 * = 新窗打开）' },
  { n: 'iframe', close: 'single', arg: true, attrs: [ 'width', 'height', 'style', 'class', 'scrolling', 'align' ], desc: '嵌入 iframe' },
  { n: 'module', close: 'single', arg: true, desc: '模块（CSS / ListPages / Rate…）' },
  { n: 'table', close: 'block', attrs: [ 'class', 'style' ], desc: '表格（内放 row/cell）' },
  { n: 'row', close: 'block', desc: '表格行（置于 table 内）' },
  { n: 'cell', close: 'pair', attrs: [ 'colspan', 'rowspan', 'style' ], desc: '单元格（置于 row 内，表头用 hcell）' },
  { n: 'gallery', close: 'block', attrs: [ 'size', 'order', 'viewer' ], desc: '图片画廊（行首）' },
  { n: 'math', close: 'block', desc: '块级公式（MathJax）' },
];

export const WIKI_BY_NAME = new Map(WIKI_DEFS.map((w) => [ w.n, w ]));

/** [[ 之后要插入的文本（$0 = 选中后光标位置；不含开头的 [[） */
export function wikiInsertAfterOpen(w) {
  if (w.close === 'block') return `${w.n}]]\n$0\n[[/${w.n}]]`;
  if (w.close === 'pair') {
    if (w.arg !== undefined) return `${w.n} ${w.arg}]]$0[[/${w.n}]]`;
    return `${w.n}]]$0[[/${w.n}]]`;
  }
  // single：自闭合；arg===true 光标停在参数位
  if (w.arg) return `${w.n} $0]]`;
  return `${w.n}]]$0`;
}

export function wikiItem(w) {
  return { label: w.n, sub: w.desc, insert: wikiInsertAfterOpen(w), kind: 'wd' };
}
