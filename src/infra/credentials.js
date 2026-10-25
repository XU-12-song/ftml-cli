/**
 * credentials.js — Wikidot 凭证管理
 *
 * 凭证来源（优先级从高到低）：
 *   1. 环境变量 WIKIDOT_USERNAME / WIKIDOT_PASSWORD
 *   2. ~/.ftml-cli/credentials.json（login 命令写入，权限 0600）
 *
 * 也支持读取项目根目录 .env（dotenv），便于本地开发。
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { credentialsPath } from './paths.js';

// dotenv 只在真正读取环境凭证时加载一次；Electron 主进程不会在启动阶段
// 因为 import 本模块而读取 cwd 下的 .env。
let dotenvLoaded = false;
function loadDotenvOnce() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try { dotenv.config(); } catch { /* 无 .env / 读取失败都忽略 */ }
}

/** 从环境变量读取凭证 */
export function envCredentials() {
  loadDotenvOnce();
  const username = process.env.WIKIDOT_USERNAME;
  const password = process.env.WIKIDOT_PASSWORD;
  if (username && password) return { username, password, source: 'env' };
  return null;
}

/** 从 ~/.ftml-cli/credentials.json 读取凭证（尊重 FTML_CLI_HOME） */
export function fileCredentials() {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf8');
    const data = JSON.parse(raw);
    if (data.username && data.password) {
      return { username: data.username, password: data.password, source: 'file' };
    }
  } catch {
    /* 文件不存在或损坏 → 返回 null */
  }
  return null;
}

/** 按优先级获取凭证 */
export function getCredentials() {
  return envCredentials() ?? fileCredentials();
}

/** 保存凭证到文件（0600） */
export function saveCredentials({ username, password }) {
  const p = credentialsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({ username, password }, null, 2) + '\n',
    { mode: 0o600 }
  );
}

export function hasCredentials() {
  return getCredentials() !== null;
}
