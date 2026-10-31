/**
 * git.js — git 操作封装（simple-git，命令统一走这里）
 *
 * submit: add('.') + commit；revert: 真 git revert（生成反向提交）。
 */

import { simpleGit } from 'simple-git';

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

/** 是否停在「revert 半途」（冲突现场）——REVERT_HEAD 存在即表示有未完成的 revert */
async function inProgressRevert(git) {
  try {
    await git.raw([ 'rev-parse', '--verify', '--quiet', 'REVERT_HEAD' ]);
    return true;
  } catch {
    return false;
  }
}

/** 取 git 报错里最有用的一行（冲突路径等），避免把整段 hint 抛给用户 */
function revertErrorLine(e) {
  const text = String(e.stderr || e.message || '').trim();
  const line = text.split('\n').find((l) => l.trim() && !l.startsWith('hint:'));
  return line || '未知原因';
}

/**
 * 真 git revert：把某提交 / 提交区间反向应用，最后统一提交一次，返回新提交 hash。
 *
 * 用 --no-commit 而不是 --no-edit：区间回退（如 `8508c8b..HEAD`）会命中多笔提交，
 * git 默认一笔一个反向提交，这里合并成单独一次提交，日志更干净；无改动时
 * commitAll 会跳过空提交并返回当前 HEAD（回退到当前版本即静默 no-op）。
 *
 * 冲突处理：git revert 撞上冲突会「停在半路」（工作区留下冲突标记、仓库进入
 * reverting 状态），下一次命令会被 git 拒绝。这里一律 abort 还原工作区再抛错——
 * 绝不把卡死的仓库留给调用方。
 *
 * @param {object} git
 * @param {string} [rev]
 * @param {object} [options]
 * @param {string} [options.message]  反向提交说明
 * @param {string} [options.keepFrom] 回退前的提交：从它取回 keepPaths，覆盖 revert 的影响
 * @param {string[]} [options.keepPaths] 不参与回退的路径（版本账本等），需配 keepFrom
 */
export async function gitRevert(git, rev = 'HEAD', { message, keepFrom, keepPaths = [] } = {}) {
  try {
    await git.raw([ 'revert', '--no-commit', rev ]);
  } catch (e) {
    if (await inProgressRevert(git)) {
      await git.raw([ 'revert', '--abort' ]);
      throw new Error(`git revert ${rev} 冲突，已还原工作区（未做任何改动）：${revertErrorLine(e)}`);
    }
    throw new Error(`git revert ${rev} 失败：${revertErrorLine(e)}`);
  }
  if (keepFrom && keepPaths.length > 0) {
    // 版本账本 .ftml/ 跟着每次提交一起进了 git，区间回退会把账本一并倒回去（甚至
    // 删掉）——回退的是「内容」，账本必须留下。从回退前的提交把账本取回覆盖。
    try {
      await git.raw([ 'checkout', keepFrom, '--', ...keepPaths ]);
    } catch {
      // 回退前的提交里没有这些路径（项目首次提交前无 .ftml/）——无需保留
    }
  }
  const { hash } = await commitAll(git, message ?? `Revert ${rev}`);
  return hash;
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
 * @param {object} git
 * @param {object} [options]
 * @param {string} [options.remote]
 * @param {string} [options.branch]
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
