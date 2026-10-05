/**
 * git.js — git 环境体检（安装 / user 配置 / 仓库状态）
 */
import { el, state } from './dom.js';
import { api, setError, setStatus, fmtTime, showLog } from './api.js';

export function fetchGitEnv() {
  const q = state.projectId ? `?root=${encodeURIComponent(state.projectId)}` : '';
  return api('GET', '/api/git-env' + q);
}

/** 体检结果 → 日志行（问题在前、修复命令紧随其后） */
export function gitEnvLogs(r) {
  const logs = [
    { kind: r.installed ? 'log' : 'error', msg: `git: ${r.installed ? `已安装（${r.version}）` : '未安装'}` },
    { kind: 'log', msg: `user.name: ${r.userName || '（未配置）'}` },
    { kind: 'log', msg: `user.email: ${r.userEmail || '（未配置）'}` },
    { kind: 'log', msg: `当前目录是 git 仓库: ${r.isRepo ? '是' : '否'}` },
  ];
  for (const p of r.problems || []) logs.push({ kind: 'error', msg: `✖ ${p}` });
  for (const h of r.hints || []) logs.push({ kind: 'warn', msg: `→ 修复：${h}` });
  if ((r.problems || []).length === 0) logs.push({ kind: 'log', msg: '✓ git 环境就绪' });
  return logs;
}

/** 启动时自动体检：有问题时在状态栏提示，命令面板里的「git 环境检测」看详情与修复命令 */
export async function checkGitEnv() {
  try {
    const r = await fetchGitEnv();
    state.gitEnv = r;
    if (!r.installed) {
      setError('未检测到 git，提交/部署/回退不可用。命令面板（Ctrl+K）→ git 环境检测');
      el.paletteBtn?.classList.add('btn-warn');
    } else if ((r.problems || []).length) {
      setError(`${r.problems.join('；')}。命令面板（Ctrl+K）→ git 环境检测查看修复命令`);
      el.paletteBtn?.classList.add('btn-warn');
    }
  } catch {
    /* 体检失败不阻塞编辑器启动 */
  }
}

/** 打开 git 环境检测日志（命令面板调用） */
export async function runDoctor() {
  try {
    const r = await fetchGitEnv();
    state.gitEnv = r;
    showLog('git 环境检测', gitEnvLogs(r));
    setStatus('git 环境检测完成（' + fmtTime() + '）');
  } catch (e) {
    setError(e.message);
  }
}

export function initGit() {
  // 入口在命令面板（Ctrl+Alt+H）；env 异常时 checkGitEnv 会给面板按钮加警示色
}
