/**
 * init.ts — init 命令的选项与结果
 */

/** init 命令的选项 */
export interface InitOptions {
  /** 项目根目录（默认 process.cwd()） */
  cwd?: string;
}

/** init 命令的结果（均为绝对路径） */
export interface InitResult {
  root: string;
  ftmlDir: string;
}
