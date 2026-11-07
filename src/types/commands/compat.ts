/**
 * compat.ts — compat 命令的选项与结果
 */

/** compat 命令的选项 */
export interface CompatCommandOptions {
  source?: string;
  output?: string;
  /** Wikidot 源码 → 理想 FTML */
  toIdeal?: boolean;
  /** 理想 FTML → Wikidot 兼容源码 */
  toDirt?: boolean;
  /** 只列出语言分歧表 */
  list?: boolean;
}

/** 退出码：0 = 无错误级诊断，1 = 有 */
export type CompatCommandResult = 0 | 1;
