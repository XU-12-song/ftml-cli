/**
 * auth.js — Wikidot 登录状态与登录/登出弹窗
 */
import { el } from './dom.js';
import { api, setStatus } from './api.js';

export async function refreshAuth() {
  try {
    const s = await api('GET', '/api/auth/status');
    if (s.loggedIn) {
      el.authStatus.textContent = `${s.username} ✓`;
      el.authStatus.classList.add('logged-in');
      el.loginBtn.textContent = '退出';
    } else {
      el.authStatus.textContent = '未登录';
      el.authStatus.classList.remove('logged-in');
      el.loginBtn.textContent = '登录';
    }
  } catch {
    el.authStatus.textContent = '未登录';
  }
}

export function initAuth() {
  el.loginBtn.addEventListener('click', async () => {
    const status = await api('GET', '/api/auth/status').catch(() => null);
    if (status?.loggedIn) {
      await api('POST', '/api/auth/logout');
      refreshAuth();
      return;
    }
    el.loginUsername.value = '';
    el.loginPassword.value = '';
    el.loginDialog.showModal();
    el.loginUsername.focus();
  });

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
