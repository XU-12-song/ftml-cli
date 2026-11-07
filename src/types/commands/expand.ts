/**
 * expand.ts — expand 命令的选项与结果
 */

/** expand 命令的选项 */
export interface ExpandCommandOptions {
  source?: string;
  output?: string;
  /** commander 把 --templates 解析到 templates */
  templates?: string;
  templatesDir?: string;
}

/** expand 命令的结果 */
export interface ExpandCommandResult {
  /** 展开结果的 UTF-8 字节数 */
  bytes: number;
}
