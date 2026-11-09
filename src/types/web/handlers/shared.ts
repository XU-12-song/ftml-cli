/**
 * shared.ts — web API 处理器的公用类型
 */

import type { Client } from '@ukwhatn/wikidot';
import type { ClientFactory } from '../../infra/wikidot.ts';

/** handlers 共用的环境（server 透传，测试可注入 fake client） */
export interface HandlerEnv {
  /** 测试注入的已登录客户端 */
  injectClient?: Client;
  /** 测试注入的客户端工厂 */
  clientFactory?: ClientFactory;
  /** 测试注入的 fetch（站点结构/主题抓取） */
  fetchImpl?: typeof fetch;
}

/** captureLogs 捕获的一条控制台输出 */
export interface CapturedLog {
  kind: 'log' | 'warn' | 'error';
  msg: string;
}

/** captureLogs 的返回值 */
export interface CapturedRun<T> {
  logs: CapturedLog[];
  result: T;
}

/** latestOnly 的任务签名 */
export type LatestOnlyTask<T> = (checkpoint: () => void) => Promise<T>;
