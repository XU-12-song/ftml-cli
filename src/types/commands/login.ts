/**
 * login.ts — login 命令的选项
 */

/** login 命令的选项 */
export interface LoginOptions {
  /** 从环境变量 WIKIDOT_USERNAME / WIKIDOT_PASSWORD 读取 */
  env?: boolean;
}
