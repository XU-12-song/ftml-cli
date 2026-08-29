/**
 * escape.mjs — FTML 字面化转义
 *
 * string 类型的模板值在插入前做转义，使渲染结果与原文一致：
 *  - `[[` → `[[]]`（wikidot 标准字面转义，渲染时显示为 `[[` 而不触发元素）
 *  - 其他字符（`]]`、`=` 等）不影响字面显示，无需处理
 */

export function escapeString(v) {
  return String(v).replace(/\[\[/g, '[[]]');
}
