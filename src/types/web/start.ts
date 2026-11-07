/**
 * start.ts — web 服务器启动生命周期的类型
 */

import type { Server } from 'node:http';
import type { HandlerEnv } from './handlers/shared.ts';

/** startWebServer 的可选项 */
export interface StartWebServerOptions {
  /** 可选：注册并作为默认项目 */
  root?: string | null;
  /** 默认 3000；0 表示随机端口 */
  port?: number | string | null;
  /** 默认 127.0.0.1 */
  host?: string;
  /** 透传给 handlers（测试注入 fake client） */
  env?: HandlerEnv;
  /** 覆盖静态目录（默认 src/web/public） */
  publicDir?: string | null;
  /** 设置后启用 Electron 模式安全层 */
  sessionToken?: string | null;
  /** 是否启动前预热主题缓存 */
  warmTheme?: boolean;
}

/** startWebServer 的返回值 */
export interface WebServerController {
  server: Server;
  url: string;
  host: string;
  port: number;
  token: string | null;
  projectRoot: string | null;
  close: () => Promise<void>;
}
