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

/** 当前 HEAD 提交 hash；仓库尚无提交时返回 null */
export async function headHash(git) {
  try {
    return (await git.revparse([ 'HEAD' ])).trim();
  } catch {
    return null;
  }
}

/**
 * add('.') + commit。
 *
 * 工作区无改动时不产生空提交，直接返回当前 HEAD（skipped: true）——
 * deploy/submit 会连续提交多次（.ftml/ 与 dist/ 都在 .gitignore 里，
 * 中间步骤常常确实无改动），空提交会让 git 直接报错。
 */
export async function commitAll(git, message) {
  await git.add('.');
  const st = await git.status();
  if (st.staged.length === 0) {
    return { hash: await headHash(git), skipped: true };
  }
  const res = await git.commit(message);
  return { hash: res.commit, skipped: false };
}

/** 读取某次提交中的文件内容（文件不在该提交中时抛错） */
export async function showFileAt(git, commit, relPath) {
  return git.show([ `${commit}:${relPath}` ]);
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

/** 最近 n 条提交（新→旧），元素含 hash / message / date */
export async function recentLog(git, n = 20) {
  const log = await git.log({ n });
  return (log.all ?? []).map((c) => ({ hash: c.hash, message: c.message, date: c.date }));
}

/** 当前分支名；仓库尚无提交（unborn HEAD）时返回 null */
export async function currentBranch(git) {
  try {
    const name = (await git.raw([ 'rev-parse', '--abbrev-ref', 'HEAD' ])).trim();
    return name === 'HEAD' ? null : name;
  } catch {
    return null;
  }
}

/** 是否存在指定远端 */
export async function hasRemote(git, name = 'origin') {
  try {
    const remotes = await git.getRemotes(true);
    return remotes.some((r) => r.name === name);
  } catch {
    return false;
  }
}

/** 打标签（已存在则强制指向当前提交），返回标签名 */
export async function tagCommit(git, tag) {
  await git.raw([ 'tag', '-f', tag ]);
  return tag;
}

/**
 * 推送当前分支到远端。
 * 未配置远端时返回 { pushed:false, reason } 而不是抛错（本地项目无远端属正常情况）。
 */
export async function pushCurrent(git, { remote = 'origin', branch } = {}) {
  if (!(await hasRemote(git, remote))) {
    return { pushed: false, reason: `未配置远端 ${remote}，跳过推送` };
  }
  const target = branch || (await currentBranch(git));
  try {
    if (target) {
      await git.push(remote, target, [ '--set-upstream' ]);
    } else {
      await git.push(remote, undefined, [ '--set-upstream' ]);
    }
    return { pushed: true, remote, branch: target };
  } catch (e) {
    return { pushed: false, reason: `推送 ${remote} 失败: ${e.stderr || e.message}` };
  }
}
