/**
 * session.ts — 进程内 Wikidot 会话层的选项类型
 */

import type { Client } from '@ukwhatn/wikidot';
import type { ClientFactory } from './wikidot.ts';

/**
 * getClient / withSession 的注入选项。
 *
 * 两条注入路径都「绕过凭证单例，且不拥有、不关闭」：
 *   - injectClient：直接使用给定客户端，一次性，完全不进会话层缓存；
 *   - clientFactory：以工厂引用为键复用其产出的客户端（同一工厂只调用一次，
 *     并发共享 in-flight），客户端进入会话层缓存但生命周期归调用方。
 *
 * 都不传时走凭证指纹单例（username + domain），登录只发生一次，
 * 由 resetSession / disposeSession 收尾。
 */
export interface SessionOptions {
  /** 注入客户端（测试 / 调用方自管生命周期用） */
  injectClient?: Client;
  /** 客户端工厂（测试注入用；默认凭证登录单例） */
  clientFactory?: ClientFactory;
}
