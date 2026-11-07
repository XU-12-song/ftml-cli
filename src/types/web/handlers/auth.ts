/**
 * auth.ts — Wikidot 凭证相关 API 的类型
 */

import type { CredentialSource } from '../../infra/credentials.ts';

/** authStatus 的返回值 */
export interface AuthStatusResult {
  loggedIn: boolean;
  username: string | null;
  source: CredentialSource | null;
}

/** authLogin 的请求体 */
export interface AuthLoginBody {
  username?: string;
  password?: string;
}

/** authLogin 的返回值 */
export interface AuthLoginResult {
  ok: true;
  username: string;
}

/** authLogout 的返回值 */
export interface AuthLogoutResult {
  ok: true;
}
