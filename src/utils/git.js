/**
 * git.js — git 操作封装（simple-git，命令统一走这里）
 *
 * submit: add('.') + commit；revert: 真 git revert（生成反向提交）。
 */

import simpleGit from 'simple-git';

export { simpleGit };

/** 以某目录为根创建 git 句柄 */
export function projectGit(root) {
  return simpleGit(root);
}

/** add('.') + commit，返回 { hash } */
export async function commitAll(git, message) {
  await git.add('.');
  const res = await git.commit(message);
  return { hash: res.commit };
}

/** 真 git revert：对某提交做反向提交（--no-edit），返回新提交 hash */
export async function gitRevert(git, rev = 'HEAD') {
  await git.raw([ 'revert', '--no-edit', rev ]);
  const log = await git.log({ n: 1 });
  return log.latest?.hash;
}

/** 工作区是否干净（revert 前置要求：有未提交改动会失败） */
export async function isClean(git) {
  const st = await git.status();
  return st.isClean();
}

/** 是否为 git 仓库 */
export async function isRepo(git) {
  return git.checkIsRepo();
}
