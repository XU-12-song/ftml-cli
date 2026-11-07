/**
 * preview.ts — preview 命令的选项与结果
 */

import type { ConfigCliOptions } from '../infra/config.ts';

/** preview 命令的选项 */
export interface PreviewCommandOptions extends ConfigCliOptions {
  /** 生成后用系统浏览器打开 */
  open?: boolean;
}

/** preview 命令的结果 */
export interface PreviewCommandResult {
  /** 完整 HTML 文档 */
  html: string;
  /** 收集到的 CSS 样式块 */
  styles: string[];
  /** 产出文档的 UTF-8 字节数 */
  bytes: number;
}
