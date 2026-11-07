/**
 * validate.ts — validate 命令与 collectProblems 的类型
 */

import type { ConfigCliOptions } from '../infra/config.ts';
import type { TemplatesMap } from '../core/template.ts';

/** validate 命令的选项 */
export interface ValidateOptions extends ConfigCliOptions {
  /** deploy 内部复用构建产物时不再构建 */
  noBuild?: boolean;
}

/** collectProblems 的返回值 */
export interface CollectedProblems {
  errors: string[];
  warnings: string[];
}

/** 退出码：0 = 通过，1 = 有错误 */
export type ValidateResult = 0 | 1;

/** collectProblems 的输入 */
export interface CollectProblemsInput {
  src: string;
  templates: TemplatesMap;
  baseDir: string;
}
