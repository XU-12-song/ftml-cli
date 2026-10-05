/**
 * auth.js — Wikidot 登录状态与登录/登出弹窗
 */
import { el, state } from './dom.js';
import { api, setStatus } from './api.js';

/** 账号按钮：未登录显示 👤；已登录显示用户名 */
export async function refreshAuth() {
  try {
    const s = await api('GET', '/api/auth/status');
    state.auth = { loggedIn: !!s.loggedIn, username: s.username || '' };
  } catch {
    state.auth = { loggedIn: false, username: '' };
  }
  const { loggedIn, username } = state.auth;
  if (loggedIn) {
    el.accountBtn.textContent = `👤 ${username}`;
    el.accountBtn.classList.add('logged-in');
    el.accountBtn.title = `已登录 ${username}，点击退出`;
  } else {
    el.accountBtn.textContent = '👤';
    el.accountBtn.classList.remove('logged-in');
    el.accountBtn.title = '登录 Wikidot';
  }
}

/** 已登录则退出，否则弹出登录框（命令面板与账号按钮共用） */
export async function toggleLogin() {
  const status = await api('GET', '/api/auth/status').catch(() => null);
  if (status?.loggedIn) {
    await api('POST', '/api/auth/logout');
    await refreshAuth();
    setStatus('已退出登录');
    return;
  }
  el.loginUsername.value = '';
  el.loginPassword.value = '';
  el.loginDialog.showModal();
  el.loginUsername.focus();
}

export function initAuth() {
  el.accountBtn?.addEventListener('click', toggleLogin);

  el.loginDialog.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const username = el.loginUsername.value.trim();
    const password = el.loginPassword.value;
    if (!username || !password) return;
    try {
      await api('POST', '/api/auth/login', { username, password });
      el.loginDialog.close();
      await refreshAuth();
      setStatus(`已登录 ${username}`);
    } catch (err) {
      el.loginDialog.querySelector('#login-username').placeholder = err.message;
    }
  };
}
