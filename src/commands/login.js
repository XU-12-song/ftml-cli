/**
 * login — 登录 Wikidot 并保存凭证
 *
 *   ftml login [--env]
 *
 * --env: 从环境变量 WIKIDOT_USERNAME / WIKIDOT_PASSWORD 读取，并写入凭证文件
 * 无 --env: 交互式输入用户名/密码（密码不回显）
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Client } from '@ukwhatn/wikidot';
import {
  envCredentials,
  saveCredentials,
  CREDENTIALS_PATH,
} from '../utils/credentials.js';

async function promptHidden(query) {
  // readline 不支持不回显，退化为普通输入（本地使用）
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(query);
  rl.close();
  return answer;
}

export async function login(options) {
  let username;
  let password;

  const env = envCredentials();
  if (options.env && env) {
    ({ username, password } = env);
    console.log(`从环境变量读取凭证: ${username}`);
  } else if (options.env && !env) {
    throw new Error(
      '环境变量未完整设置，需要 WIKIDOT_USERNAME 和 WIKIDOT_PASSWORD'
    );
  } else {
    username = await promptHidden('Wikidot 用户名: ');
    if (!username.trim()) throw new Error('用户名不能为空');
    password = await promptHidden('密码: ');
    if (!password) throw new Error('密码不能为空');
  }

  const result = await Client.create({ username, password });
  if (!result.isOk()) {
    throw new Error(`登录失败: ${result.error}`);
  }

  saveCredentials({ username, password });
  console.log(`登录成功（${result.value.username}），凭证已保存到 ${CREDENTIALS_PATH}`);
}
