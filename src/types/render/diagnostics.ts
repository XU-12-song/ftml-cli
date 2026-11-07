/**
 * diagnostics.ts — 诊断格式化相关类型
 */

import type { Diagnostic, Position } from '@wdprlib/parser';

/**
 * 渲染管线中实际出现的诊断：wdpr 本体的 position 必填，
 * 但 include / module 产生的告警允许 position 为空，这里统一放宽。
 */
export type RenderDiagnostic = Omit<Diagnostic, 'position' | 'relatedPosition'> & {
  position: Position | null;
  relatedPosition?: Position | null;
};

/** formatDiagnostic / formatDiagnostics 的可选项 */
export interface DiagnosticFormatOptions {
  /** 位置前缀显示的文件名 */
  file?: string;
}
