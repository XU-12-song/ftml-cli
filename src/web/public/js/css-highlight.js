/**
 * css-highlight.js — CSS 上下文语法高亮（CM6 ViewPlugin + Decoration）
 *
 * 覆盖与补全相同的四个上下文（css-completion.js 的 cssRegions）：
 *   [[module CSS]] / [[style]] 正文、任意 style="…" 属性值、[[html]] 内 <style>。
 *
 * 实现取舍：不改动 FTML 词法器（cm-lexer.js），而是在其上叠加一层装饰。
 * 原因是这些区域在 FTML 词法里分别是惰性区 / 纯文本 / 属性字符串，改造词法器
 * 影响面大且会牵动既有着色测试；装饰层则复用已测试的区域判定，四类上下文统一处理。
 *
 * 颜色用内联 style 引用主题变量 --syn-*（与 FTML 高亮同一套配色），
 * 因此三套主题（calm/dark/light）自动切换，也不受 HighlightStyle 类规则顺序影响。
 *
 * 性能：整篇扫描（lexTokens）在文档变更后防抖 120ms 重算；期间旧装饰经
 * DecorationSet.map 跟随编辑变更，输入不闪。区间总数上限 20000。
 */

import { Decoration, ViewPlugin, RangeSetBuilder } from '../vendor/cm6/cm6.js';
import { cssRegions } from './css-completion.js';
import { cssTokenRanges } from './css-tokenize.js';

/** kind → 主题变量（沿用 FTML 的语法配色） */
const KIND_COLORS = {
  selector: 'var(--syn-tag)',
  property: 'var(--syn-attr)',
  number: 'var(--syn-atom)',
  string: 'var(--syn-string)',
  comment: 'var(--syn-comment)',
  atrule: 'var(--syn-heading)',
  variable: 'var(--syn-atom)',
  important: 'var(--syn-op)',
  brace: 'var(--syn-bracket)',
};

/** kind → 装饰（内联 style 保证覆盖基础 token 颜色） */
const MARKS = {};
for (const [ kind, color ] of Object.entries(KIND_COLORS)) {
  MARKS[ kind ] = Decoration.mark({
    class: 'cm-css-' + kind,
    attributes: { style: 'color:' + color + (kind === 'comment' ? ';font-style:italic' : '') },
  });
}

const MAX_RANGES = 20000;
const REBUILD_DELAY = 120;

/**
 * 整篇文档 → 装饰集。导出供潜在测试/调试；纯计算，不依赖 view。
 * @param {string} doc
 */
export function buildCssDecorations(doc) {
  const src = String(doc ?? '');
  const { blocks, attrSpans } = cssRegions(src, null);
  const ranges = [];

  for (const r of blocks) {
    // [[style]] / [[module CSS]] / <style> 正文都从选择器开始
    for (const tok of cssTokenRanges(src.slice(r.from, r.to), 'selector')) {
      ranges.push({ from: r.from + tok.from, to: r.from + tok.to, kind: tok.kind });
    }
  }
  for (const s of attrSpans) {
    // style="…" 属性值里只有声明（没有选择器）
    for (const tok of cssTokenRanges(src.slice(s.from, s.to), 'decl')) {
      ranges.push({ from: s.from + tok.from, to: s.from + tok.to, kind: tok.kind });
    }
  }

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder();
  let prev = null;
  let count = 0;
  for (const r of ranges) {
    if (!MARKS[ r.kind ]) continue;
    if (prev && prev.from === r.from && prev.to === r.to && prev.kind === r.kind) continue;
    prev = r;
    builder.add(r.from, r.to, MARKS[ r.kind ]);
    if (++count >= MAX_RANGES) break;
  }
  return builder.finish();
}

/** CM6 插件：文档变更后防抖重算，期间映射旧装饰 */
export const cssHighlightPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = buildCssDecorations(view.state.doc.toString());
    this.timer = null;
    this.destroyed = false;
  }

  update(u) {
    if (!u.docChanged) return;
    // 先让旧装饰跟随变更（避免输入瞬间整篇掉色/错位）
    this.decorations = this.decorations.map(u.changes);
    if (this.timer) clearTimeout(this.timer);
    const view = u.view;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.destroyed || !view.dom) return;
      this.decorations = buildCssDecorations(view.state.doc.toString());
      view.dispatch({}); // 空事务触发重绘，读取新的 decorations
    }, REBUILD_DELAY);
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}, {
  decorations: (v) => v.decorations,
});
