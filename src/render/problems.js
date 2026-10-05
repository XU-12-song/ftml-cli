/**
 * problems.js — 把渲染过程中的两类问题统一成一种可展示/可跳转的结构
 *
 * 数据来源有两种，形状不同：
 *   1. @wdprlib 诊断：{severity, code, message, position:{start,end}, relatedPosition?}
 *   2. 抛出的异常：expand / parse-ftmx 抛出的 FtmlError（带 code/offset/file）或任意 Error
 *
 * 二者都归一到：
 *   { severity, code, message, file, position, stack, bundled, relatedPosition? }
 *
 * position 与 @wdprlib 同口径（1 起算的 line/column + 绝对 offset），前端据此在编辑器里跳转。
 * stack 经 render/stack.js 美化（含 @wdprlib 打包帧 → 源文件近似映射），仅异常条目有。
 */

import path from 'node:path';
import { FtmlError, positionRange } from '../core/errors.js';
import { mapStack } from './stack.js';

/** 归一 wdpr 的 severity：error 保持，其余一律 warning；info 保留为 info */
function normSeverity(s) {
  return s === 'error' || s === 'info' ? s : 'warning';
}

/** 缺 offset 时用 line/column 在 source 上补一个，便于前端按偏移跳转 */
function withOffset(pos, source) {
  if (!pos?.start) return null;
  const start = { ...pos.start };
  if (!Number.isFinite(start.offset)) {
    start.offset = lineColumnToOffset(source, start.line, start.column);
  }
  const end = { ...(pos.end ?? start) };
  if (!Number.isFinite(end.offset)) {
    end.offset = start.offset;
  }
  return { start, end };
}

/** line/column（1 起算）→ 绝对偏移；source 缺失或行号非法时回退 0 */
function lineColumnToOffset(source, line, column) {
  if (!source) return 0;
  let off = 0;
  for (let l = 1; l < (line ?? 1); l++) {
    const nl = source.indexOf('\n', off);
    if (nl === -1) return source.length;
    off = nl + 1;
  }
  return Math.min(source.length, off + Math.max(0, (column ?? 1) - 1));
}

/**
 * @wdprlib Diagnostic → problem。
 * @param {object} d
 * @param {string} source 诊断坐标所属源码（此处为展开后的文本）
 * @param {{ file?: string|null }} [opts]
 */
export function diagnosticToProblem(d, source, { file = null } = {}) {
  if (!d) return null;
  const position = withOffset(d.position, source);
  return {
    severity: normSeverity(d.severity),
    code: d.code ?? 'diagnostic',
    message: d.message ?? '',
    file,
    position,
    relatedPosition: withOffset(d.relatedPosition, source),
    stack: null,
    bundled: false,
  };
}

/**
 * 异常 → problem。FtmlError 的 offset 只在「错误就发生在当前源文件」时才换算位置，
 * 组件文件的偏移与调用方源码坐标系不同，只报文件名不报偏移（避免跳错）。
 *
 * @param {Error} err
 * @param {{ source?: string, file?: string|null, cwd?: string }} [opts]
 */
export function errorToProblem(err, { source = '', file = null, cwd = process.cwd() } = {}) {
  const fe = err instanceof FtmlError ? err : null;
  let loc = fe?.file ?? file;
  if (loc && path.isAbsolute(loc)) {
    const rel = path.relative(cwd, loc);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) loc = rel.split(path.sep).join('/');
  }

  const sameFile = !fe?.file || fe.file === file || (loc != null && loc === file);
  let position = null;
  if (sameFile && Number.isFinite(fe?.offset) && source) {
    position = positionRange(source, fe.offset, fe.offset + 2);
  }

  const { text, hasBundled } = mapStack(err?.stack ?? String(err), { cwd });
  return {
    severity: 'error',
    code: fe?.code ?? 'internal-error',
    message: err?.message ?? String(err),
    file: loc,
    position,
    stack: text,
    bundled: hasBundled,
  };
}

/**
 * 合并 + 排序（有位置的按 offset 升序，无位置的排后面）。
 * @param {Array} problems
 */
export function sortProblems(problems) {
  return problems
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const ao = a.position?.start?.offset;
      const bo = b.position?.start?.offset;
      if (Number.isFinite(ao) && Number.isFinite(bo)) return ao - bo;
      if (Number.isFinite(ao)) return -1;
      if (Number.isFinite(bo)) return 1;
      return 0;
    });
}

/** 统计各严重度数量 */
export function countProblems(problems) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const p of problems) counts[normSeverity(p.severity)] += 1;
  return counts;
}
