import { processWikitext } from "@wdprlib/parser";
import { renderWikitext } from "@wdprlib/render";

const source = `
[[div]]
[[div]]
[[html]]
<div>hi</div>
[[/html]]
[[/div]]
[[/div]]
`
// 1. 处理 Wikitext，获取完整的文档对象
const document = await processWikitext(source, {
  page: { fullName: "docs:start", unixName: "start", tags: ["docs"] },
  dataProvider: { /* 提供 fetchInclude, fetchListPages 等方法 */ }
});
console.log(document.ast.elements[0].data.contents)
// 2. 渲染文档对象为 HTML
const result = await renderWikitext(document, { styleMode: "separate" });
// result.html 包含 HTML，result.styles 包含样式，result.diagnostics 包含诊断信息
console.log(`${JSON.stringify(result.htmlBlocks)}`)