/**
 * problems.ts — 渲染问题（诊断 / 异常）归一化后的类型
 */

import type { Position } from '@wdprlib/parser';

export type ProblemSeverity = 'error' | 'warning' | 'info';

/** 可展示 / 可跳转的问题条目 */
export interface Problem {
  severity: ProblemSeverity;
  code: string;
  message: string;
  file: string | null;
  position: Position | null;
  relatedPosition?: Position | null;
  stack: string | null;
  bundled: boolean;
}

/** 各严重度计数 */
export interface ProblemCounts {
  error: number;
  warning: number;
  info: number;
}

/** diagnosticToProblem 的可选项 */
export interface DiagnosticToProblemOptions {
  file?: string | null;
}

/** errorToProblem 的可选项 */
export interface ErrorToProblemOptions {
  source?: string;
  file?: string | null;
  cwd?: string;
}
