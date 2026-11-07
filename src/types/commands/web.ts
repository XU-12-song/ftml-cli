/**
 * web.ts — web 命令的选项
 */

/** web 命令的选项 */
export interface WebOptions {
  /** 默认打开并注册的项目目录 */
  root?: string;
  /** 监听端口（commander 解析为字符串） */
  port?: string | number;
  /** 监听地址 */
  host?: string;
  /** 启动后用系统浏览器打开 */
  open?: boolean;
}
