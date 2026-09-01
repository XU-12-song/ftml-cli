/**
 * preview-page.js — 把 @wdprlib/render 的裸 HTML fragment 包装为完整预览文档
 *
 * @wdprlib/render 输出的是正文片段（无 <html>/<head>/<meta charset>），直接在浏览器打开
 * 中文会乱码、也没有任何客户端交互。这里补全文档外壳，并注入 @wdprlib/runtime：
 *
 *   <script type="module">（内联 runtime 源码 + initWdprRuntime() 引导）放在 body 末尾，
 *   让 tabview / collapsible / TOC / 脚注 / 折叠列表 / 画廊灯箱 / 数学 / 日期 / 邮箱 在
 *   浏览器里可用。runtime 源码自包含（无外部 import），运行时随预览文件一起走，无需网络。
 *
 * runtime 源码通过 import.meta.resolve('@wdprlib/runtime') 在构建时读取并内联。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 小部件基础样式。runtime 只自带 gallery 的 CSS（STYLE_TEXT 注入），
 * collapsible / tabview / TOC / 脚注 / 折叠列表 / hovertip 需要这层基础样式才能正常显示。
 */
export const WIDGET_CSS = `
/* —— collapsible —— */
.collapsible-block { margin: 0.6em 0; }
.collapsible-block .collapsible-block-link {
  cursor: pointer; color: #0366d6; text-decoration: none; border-bottom: 1px dotted #0366d6;
}
.collapsible-block .collapsible-block-unfolded-link { margin-bottom: 0.4em; }
.collapsible-block .collapsible-block-unfolded-link .collapsible-block-link { font-size: 0.85em; }

/* —— tabview —— */
.yui-navset { margin: 0.6em 0; }
.yui-navset .yui-nav {
  list-style: none; margin: 0 0 -1px; padding: 0; display: flex; flex-wrap: wrap;
  border-bottom: 1px solid #d0d7de;
}
.yui-navset .yui-nav li { margin: 0 3px -1px 0; }
.yui-navset .yui-nav li a {
  display: block; padding: 5px 14px; text-decoration: none; color: #444;
  background: #f6f8fa; border: 1px solid transparent; border-bottom: none;
  border-radius: 4px 4px 0 0;
}
.yui-navset .yui-nav li.selected a { background: #fff; border-color: #d0d7de; color: #111; font-weight: 600; }
.yui-navset .yui-content { border: 1px solid #d0d7de; border-top: none; padding: 0.7em 1em; }

/* —— 脚注 —— */
a.footnoteref { color: #0366d6; font-weight: 600; text-decoration: none; }
.footnote-footer { border-top: 1px solid #d0d7de; margin-top: 1.2em; padding-top: 0.5em; font-size: 0.9em; color: #444; }
.footnote-footer .footnote { margin: 0.35em 0; }
#odialog-hovertips .hovertip {
  background: #fff; border: 1px solid #d0d7de; border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15); padding: 0.6em 0.9em; font-size: 0.9em;
  max-width: 32rem;
}
#odialog-hovertips .hovertip .content > :first-child { margin-top: 0; }
#odialog-hovertips .hovertip .content > :last-child { margin-bottom: 0; }

/* —— TOC —— */
#toc {
  border: 1px solid #d0d7de; border-radius: 6px; padding: 0.6em 1em; background: #f6f8fa;
  margin: 0.6em 0;
}
#toc .title { font-weight: 600; margin-bottom: 0.35em; }
#toc #toc-list a { color: #0366d6; text-decoration: none; }
#toc #toc-list a:hover { text-decoration: underline; }
#toc #toc-action-bar { float: right; font-size: 0.85em; }
#toc #toc-action-bar a { color: #0366d6; margin-left: 0.5em; cursor: pointer; text-decoration: none; }

/* —— 折叠列表 —— */
.foldable-list-container .foldable-list-toggle { cursor: pointer; color: #0366d6; }
`.trim();

let runtimeSourceCache = null;

/** @wdprlib/runtime 的源码（node_modules 里读一次，模块级缓存） */
function runtimeSource() {
  if (runtimeSourceCache == null) {
    const url = import.meta.resolve('@wdprlib/runtime');
    runtimeSourceCache = readFileSync(fileURLToPath(url), 'utf8');
  }
  return runtimeSourceCache;
}

/**
 * 把渲染结果包装成完整预览文档。
 *
 * @param {object} opts
 * @param {string} opts.html @wdprlib/render 输出的正文 fragment（styleMode: 'inline'，
 *                           [[module CSS]] 已含在 html 里）
 * @param {Array<string>} [opts.styles] 收集到的 CSS 段（单独以 <style> 追加）
 * @param {string} [opts.title] 文档标题（默认 "ftml preview"）
 * @returns {string} 完整 HTML 文档字符串
 */
export function buildPreviewDocument({ html, styles = [], title = 'ftml preview' }) {
  const styleTags = styles.map((s) => `<style>${s}</style>`).join('\n');
  const runtimeInline = runtimeSource()
    // 防注入：源码里出现 `</script` 会把内联 <script> 提前截断
    .replace(/<\/script/gi, '<\\/script');

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
${styleTags}
<style>
${WIDGET_CSS}
</style>
</head>
<body>
<div id="page-content">
${html}
</div>
<script type="module">
${runtimeInline}
initWdprRuntime({ root: document.getElementById('page-content') });
</script>
</body>
</html>
`;
}
