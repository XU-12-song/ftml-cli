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
 * insert: 覆盖默认插入骨架（如 component 需要 src=…，不套用 block 的通用形状）。
 * 名字带 `_` 后缀（div_/span_/a_/ul_/ol_）是「不加段落包裹」变体，闭合时**用不带下划线的
 * 名字**（`[[div_]]…[[/div]]`，见 cm-semantics.js:pairKey），wikiCloseName 负责还原。
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
  // 容器 / 文本
  { n: 'div', close: 'block', attrs: [ 'class', 'style', 'id' ], desc: '块容器（SCP 排版常用，可配 class/style）' },
  { n: 'div_', close: 'block', attrs: [ 'class', 'style', 'id' ], desc: '块容器（不加段落包裹，闭合用 [[/div]]）' },
  { n: 'span', close: 'pair', attrs: [ 'class', 'style', 'id' ], desc: '行内容器' },
  { n: 'span_', close: 'pair', attrs: [ 'class', 'style', 'id' ], desc: '行内容器（不加段落包裹，闭合用 [[/span]]）' },
  { n: 'a', close: 'pair', attrs: [ 'href', 'target', 'class', 'style' ], desc: '超链接（href=…）' },
  { n: 'a_', close: 'pair', attrs: [ 'href', 'target', 'class', 'style' ], desc: '超链接（不加段落包裹，闭合用 [[/a]]）' },
  { n: 'size', close: 'pair', arg: '150%', desc: '字号（150% / larger / 18px…）' },
  { n: 'note', close: 'block', desc: '注记块（引用框效果，SCP 常用）' },
  { n: 'code', close: 'block', attrs: [ 'type' ], desc: '代码块（内容原样不解析）' },
  { n: 'collapsible', close: 'block', attrs: [ 'show', 'hide', 'hideLocation', 'folded' ], desc: '折叠块（不可嵌套）' },
  { n: 'tabview', close: 'block', desc: '选项卡容器（内放 tab）' },
  { n: 'tab', close: 'pair', arg: '标题', desc: '单个选项卡（标题参数，置于 tabview 内）' },
  { n: 'html', close: 'block', desc: '原始 HTML 块（内容不解析）' },
  { n: 'style', close: 'block', desc: 'CSS 样式块（编译为 module CSS）' },
  { n: 'component', insert: 'component src="$0"]][[/component]]', desc: '组件调用（src=components/x.ftml）' },
  { n: 'toc', close: 'single', desc: '目录' },
  { n: 'footnote', close: 'pair', desc: '脚注（悬浮小窗显示内容）' },
  { n: 'footnoteblock', close: 'single', attrs: [ 'title' ], desc: '脚注列位置（可选）' },
  { n: 'bibliography', close: 'block', attrs: [ 'title' ], desc: '参考文献列表' },
  // 媒体 / 嵌入
  { n: 'image', close: 'single', arg: true, attrs: [ 'link', 'alt', 'title', 'width', 'height', 'style', 'class', 'size' ], desc: '图片（link 前加 * = 新窗打开）' },
  { n: 'iframe', close: 'single', arg: true, attrs: [ 'width', 'height', 'style', 'class', 'scrolling', 'align' ], desc: '嵌入 iframe' },
  { n: 'embed', close: 'block', desc: '嵌入脚本/HTML（内容不解析）' },
  { n: 'embedvideo', close: 'block', desc: '嵌入视频（内容放 iframe 等）' },
  { n: 'embedaudio', close: 'block', desc: '嵌入音频（内容不解析）' },
  { n: 'gallery', close: 'block', attrs: [ 'size', 'order', 'viewer' ], desc: '图片画廊（行首）' },
  { n: 'math', close: 'block', desc: '块级公式（MathJax）' },
  // 列表
  { n: 'ul', close: 'block', desc: '无序列表（内放 li）' },
  { n: 'ul_', close: 'block', desc: '无序列表（不加段落包裹，闭合用 [[/ul]]）' },
  { n: 'ol', close: 'block', desc: '有序列表（内放 li）' },
  { n: 'ol_', close: 'block', desc: '有序列表（不加段落包裹，闭合用 [[/ol]]）' },
  { n: 'li', close: 'pair', attrs: [ 'class', 'style' ], desc: '列表项（置于 ul/ol 内）' },
  // 表格
  { n: 'table', close: 'block', attrs: [ 'class', 'style' ], desc: '表格（内放 row/cell）' },
  { n: 'row', close: 'block', desc: '表格行（置于 table 内）' },
  { n: 'cell', close: 'pair', attrs: [ 'colspan', 'rowspan', 'style' ], desc: '单元格（置于 row 内，表头用 hcell）' },
  { n: 'hcell', close: 'pair', attrs: [ 'colspan', 'rowspan', 'style' ], desc: '表头单元格（置于 row 内）' },
  // 引用 / 条件 / 交互
  { n: 'include', close: 'single', arg: true, desc: '包含页面/组件（必须行首）' },
  { n: 'module', close: 'single', arg: true, desc: '模块（CSS / ListPages / Rate…）' },
  { n: 'iftags', close: 'block', arg: '+tag1 -tag2', desc: '按标签显示（+含 -不含）' },
  { n: 'iftag', close: 'pair', arg: true, desc: '按标签显示（单标签）' },
  { n: 'button', close: 'single', arg: true, attrs: [ 'text', 'class', 'style' ], desc: '按钮（edit / set-tags / newpage…）' },
  { n: 'social', close: 'single', desc: '社交分享按钮' },
  { n: 'user', close: 'single', arg: true, desc: '用户名（链接到用户页）' },
];

export const WIKI_BY_NAME = new Map(WIKI_DEFS.map((w) => [ w.n, w ]));

/** 配对用闭合名：`_` 变体用不带下划线的名字闭合（`[[div_]]…[[/div]]`） */
export function wikiCloseName(w) {
  return w.n.endsWith('_') ? w.n.slice(0, -1) : w.n;
}

/** [[ 之后要插入的文本（$0 = 选中后光标位置；不含开头的 [[） */
export function wikiInsertAfterOpen(w) {
  if (w.insert !== undefined) return w.insert;
  const close = wikiCloseName(w);
  if (w.close === 'block') {
    return w.arg !== undefined
      ? `${w.n} ${w.arg}]]\n$0\n[[/${close}]]`
      : `${w.n}]]\n$0\n[[/${close}]]`;
  }
  if (w.close === 'pair') {
    return w.arg !== undefined
      ? `${w.n} ${w.arg}]]$0[[/${close}]]`
      : `${w.n}]]$0[[/${close}]]`;
  }
  // single：自闭合；arg===true 光标停在参数位
  if (w.arg) return `${w.n} $0]]`;
  return `${w.n}]]$0`;
}
