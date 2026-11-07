/**
 * server.ts — web HTTP 服务器（express）的类型
 */

/** Electron 模式安全层配置 */
export interface SecurityOptions {
  /** 会话 token（查询参数换取 HttpOnly cookie） */
  token: string;
  /** 实际监听端口（启动后回填） */
  port: number;
}

/** createServer 的可选项 */
export interface CreateServerOptions {
  /** 覆盖静态目录（默认 src/web/public） */
  publicDir?: string;
  /** 启用安全层；null/省略表示浏览器模式 */
  security?: SecurityOptions | null;
}
