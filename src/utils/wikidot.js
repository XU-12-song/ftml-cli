/**
 * wikidot.js — @ukwhatn/wikidot 封装
 *
 * 提供登录客户端创建、站点/页面获取、提交、拉取版本等操作，
 * 统一把 WikidotResult 错误转成抛出的 Error。
 */

import { Client } from '@ukwhatn/wikidot';
import { getCredentials } from './credentials.js';

function unwrap(result, what) {
  if (!result.isOk()) {
    throw new Error(`${what}失败: ${result.error}`);
  }
  return result.value;
}

/** 创建已登录客户端（凭证来自 env 或 credentials 文件） */
export async function createClient() {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      '未找到 Wikidot 凭证。请先运行 `ftml login` 或设置环境变量 WIKIDOT_USERNAME / WIKIDOT_PASSWORD'
    );
  }
  const result = await Client.create({
    username: creds.username,
    password: creds.password,
  });
  if (!result.isOk()) {
    throw new Error(`登录失败: ${result.error}`);
  }
  return result.value;
}

/** 获取站点对象 */
export async function getSite(client, siteName) {
  if (!siteName) {
    throw new Error('缺少站点名。请在配置文件中设置 site 或使用 --site 选项');
  }
  return unwrap(await client.site.get(siteName), '获取站点');
}

/** 获取页面对象（不存在时返回 null） */
export async function getPage(site, pageName) {
  if (!pageName) {
    throw new Error('缺少页面名。请在配置文件中设置 page 或使用 --page 选项');
  }
  return unwrap(await site.page.get(pageName), '获取页面');
}

/** 编辑页面：source 为完整 FTML 源码，comment 为编辑注释 */
export async function editPage(page, { source, comment }) {
  return unwrap(await page.edit({ source, comment }), '提交');
}

/** 拉取页面当前源码 */
export async function fetchPageSource(page) {
  const src = unwrap(await page.getSource(), '读取页面源码');
  return src ?? '';
}

/** 列出页面修订历史（最新在前） */
export async function fetchRevisions(page) {
  const coll = unwrap(await page.getRevisions(), '获取修订历史');
  return coll.items ?? coll ?? [];
}

/** 拉取某个修订的源码 */
export async function fetchRevisionSource(rev) {
  return unwrap(await rev.getSource(), '读取修订源码');
}

/** 把页面回退到某个修订 */
export async function revertPage(rev) {
  return unwrap(await rev.revert(), '回退');
}
