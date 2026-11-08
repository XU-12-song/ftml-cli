/**
 * onboarding.js — 首次启动引导
 *
 * 没有任何已注册项目时，不再直接弹出目录选择器，而是展示一个欢迎面板：
 * 新建仓库 / 添加已有项目 / 登录 Wikidot。三个动作失败或取消后如果仍然没有项目，
 * 面板会再次出现，避免用户被丢在空白编辑器里。
 */
import { el, state } from './dom.js';
import { openAddProject, openNewRepo } from './projects.js';
import { toggleLogin } from './auth.js';

/** 显示欢迎面板（已有项目时默认跳过；force 用于命令面板手动打开） */
export function showWelcome(force = false) {
  if (!el.welcomeDialog || (state.projects.length > 0 && !force) || el.welcomeDialog.open) return;
  el.welcomeDialog.showModal();
}

/** 关闭面板 → 执行动作 → 仍然没有项目就重新提示 */
async function runFromWelcome(action) {
  el.welcomeDialog.close();
  await action();
  if (state.projects.length === 0) showWelcome();
}

export function initOnboarding() {
  el.welcomeNewRepo?.addEventListener('click', () => runFromWelcome(openNewRepo));
  el.welcomeAddProject?.addEventListener('click', () => runFromWelcome(openAddProject));
  el.welcomeLogin?.addEventListener('click', () => {
    el.welcomeDialog.close();
    toggleLogin();
  });
  el.welcomeClose?.addEventListener('click', () => el.welcomeDialog.close());
}
