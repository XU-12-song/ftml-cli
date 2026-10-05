/**
 * diagnostics.js — 把 @wdprlib 的 Diagnostic 渲染为带上下文的可读文本
 *
 * 解析已经完全由 @wdprlib 完成，这里只消费 parser/render 产出的 Diagnostic
 * 结构本体，不再自行猜测错误：
 *
 *   { severity: 'error'|'warning'|'info', code, message,
 *     position: Position, relatedPosition?: Position }
 *   Position = { start: {line,column,offset}, end: {line,column,offset} }
 *
 * 输出：严重度 + 位置(line:column) + 机器码 + 原文片段 + 插入符下划线；
 * 若 wdpr 给出了 relatedPosition（如未闭合块的开标签位置），一并标出。
 */

const SEVERITY = {
  error: { label: '错误', mark: '✖' },
  warning: { label: '警告', mark: '⚠' },
  info: { label: '提示', mark: 'ℹ' },
};

/** 单行显示长度上限，超出右侧截断，避免超长行淹没终端 */
const MAX_LINE = 200;

function splitLines(source) {
  return String(source ?? '').split(/\r\n|\r|\n/);
}

function severityOf(d) {
  return SEVERITY[d?.severity] ?? SEVERITY.warning;
}

function locLabel(file, point) {
  if (!point || !Number.isFinite(point.line)) return file || '(未知位置)';
  const prefix = file ? `${file}:` : '';
  return `${prefix}${point.line}:${point.column ?? 1}`;
}

/** 渲染一段源码片段 + 插入符下划线；pos 缺失返回 null */
function excerpt(srcLines, pos, gutterWidth) {
  const start = pos?.start;
  if (!start || !Number.isFinite(start.line)) return null;
  const raw = srcLines[start.line - 1] ?? '';
  const startCol = Math.max(1, start.column ?? 1);

  let underline;
  const end = pos.end;
  if (end && end.line === start.line) {
    underline = Math.max(1, (end.column ?? startCol + 1) - startCol);
  } else if (end && Number.isFinite(end.line)) {
    underline = Math.max(1, raw.length - startCol + 1);
  } else {
    underline = 1;
  }

  const shown = raw.length > MAX_LINE ? `${raw.slice(0, MAX_LINE)}…` : raw;
  const gutter = String(start.line).padStart(gutterWidth);
  const pad = ' '.repeat(gutterWidth);
  const caretPad = ' '.repeat(startCol - 1);
  return [
    `  ${gutter} | ${shown}`,
    `  ${pad} | ${caretPad}${'^'.repeat(underline)}`,
  ].join('\n');
}

/**
 * 格式化单条 wdpr 诊断。
 *
 * @param {object} d @wdprlib Diagnostic
 * @param {string} source 诊断位置所指的源码（与 position 同一坐标系）
 * @param {{ file?: string }} [opts] 位置前缀显示的文件名
 * @returns {string}
 */
export function formatDiagnostic(d, source, { file = '' } = {}) {
  const srcLines = splitLines(source);
  const sev = severityOf(d);
  const header = `${sev.mark} ${sev.label} ${locLabel(file, d.position?.start)} (${d.code})`;

  const startLine = d.position?.start?.line ?? 1;
  const relatedLine = d.relatedPosition?.start?.line ?? 1;
  const gutterWidth = String(Math.max(startLine, relatedLine)).length;

  const parts = [header, `  ${d.message}`];
  const main = excerpt(srcLines, d.position, gutterWidth);
  if (main) parts.push(main);

  if (d.relatedPosition?.start) {
    parts.push(`  相关位置 ${locLabel(file, d.relatedPosition.start)}`);
    const rel = excerpt(srcLines, d.relatedPosition, gutterWidth);
    if (rel) parts.push(rel);
  }
  return parts.join('\n');
}

/**
 * 格式化一组 wdpr 诊断，供 CLI 输出。
 *
 * @param {Array<object>} diagnostics @wdprlib Diagnostic[]
 * @param {string} source 源码（与诊断位置同一坐标系）
 * @param {{ file?: string }} [opts]
 * @returns {string} 无诊断时返回空串
 */
export function formatDiagnostics(diagnostics, source, opts = {}) {
  if (!diagnostics || diagnostics.length === 0) return '';
  return diagnostics.map((d) => formatDiagnostic(d, source, opts)).join('\n\n');
}
