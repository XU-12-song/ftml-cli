/**
 * handlers/auth.js — Wikidot 凭证（登录 / 登出 / 状态）
 */

import fs from 'node:fs';
import { Client } from '@ukwhatn/wikidot';

import { getCredentials, saveCredentials } from '../../infra/credentials.js';
import { credentialsPath } from '../../infra/paths.js';
import { resetSession } from '../../infra/session.js';
import { HttpError } from './shared.js';
import type {
  AuthLoginBody,
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusResult,
} from '../../types/web/handlers/auth.ts';

export function authStatus(): AuthStatusResult {
  const creds = getCredentials();
  return {
    loggedIn: !!creds,
    username: creds?.username ?? null,
    source: creds?.source ?? null,
  };
}

export async function authLogin(body: AuthLoginBody): Promise<AuthLoginResult> {
  if (!body?.username || !body?.password) {
    throw new HttpError(400, '缺少用户名或密码');
  }
  const result = await Client.create({ username: body.username, password: body.password });
  if (!result.isOk()) {
    throw new HttpError(401, `登录失败: ${result.error}`);
  }
  await result.value.close?.();
  saveCredentials({ username: body.username, password: body.password });
  // 凭证变化：丢弃旧会话，后续部署/渲染按新凭证重新登录
  await resetSession();
  return { ok: true, username: body.username };
}

export async function authLogout(): Promise<AuthLogoutResult> {
  try {
    fs.rmSync(credentialsPath(), { force: true });
  } catch {
    /* 文件不存在 */
  }
  // 凭证已删除：当前进程内会话一并失效
  await resetSession();
  return { ok: true };
}
