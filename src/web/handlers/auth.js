/**
 * handlers/auth.js — Wikidot 凭证（登录 / 登出 / 状态）
 */

import fs from 'node:fs';
import { Client } from '@ukwhatn/wikidot';

import {
  getCredentials,
  saveCredentials,
  CREDENTIALS_PATH,
} from '../../infra/credentials.js';
import { HttpError } from './shared.js';

export function authStatus() {
  const creds = getCredentials();
  return {
    loggedIn: !!creds,
    username: creds?.username ?? null,
    source: creds?.source ?? null,
  };
}

export async function authLogin(body) {
  if (!body?.username || !body?.password) {
    throw new HttpError(400, '缺少用户名或密码');
  }
  const result = await Client.create({ username: body.username, password: body.password });
  if (!result.isOk()) {
    throw new HttpError(401, `登录失败: ${result.error}`);
  }
  await result.value.close?.();
  saveCredentials({ username: body.username, password: body.password });
  return { ok: true, username: body.username };
}

export async function authLogout() {
  try {
    fs.rmSync(CREDENTIALS_PATH, { force: true });
  } catch {
    /* 文件不存在 */
  }
  return { ok: true };
}
