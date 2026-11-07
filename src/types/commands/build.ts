/**
 * build.ts — build 命令的选项与结果
 */

import type { ConfigCliOptions } from '../infra/config.ts';

/** build 命令的选项（与配置覆盖项一致） */
export type BuildOptions = ConfigCliOptions;

/** build 命令的结果（均为绝对路径） */
export interface BuildResult {
  input: string;
  output: string;
  /** 产物的 UTF-8 字节数 */
  bytes: number;
}
