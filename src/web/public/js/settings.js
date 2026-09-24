/**
 * settings.js — 编辑器设置（服务端持久化）与 include 磁盘缓存管理
 */
import { el, state } from './dom.js';
import { api, setError, setStatus } from './api.js';

export function applySettings(s) {
  state.settings = { ...state.settings, ...s };
  el.settingsInterval.value = state.settings.previewIntervalMs;
  el.settingsAutopreview.checked = !!state.settings.autoPreview;
  el.settingsRemoteinclude.checked = !!state.settings.useRemoteInclude;
  el.settingsStylemode.value = state.settings.renderStyleMode;
}

export async function loadSettings() {
  try {
    applySettings(await api('GET', '/api/settings'));
  } catch (e) {
    setError(`读取设置失败: ${e.message}`);
  }
}

async function refreshCacheInfo() {
  try {
    const r = await api('GET', '/api/include-cache');
    const entries = r.entries || [];
    const bytes = entries.reduce((n, e) => n + (e.bytes || 0), 0);
    el.cacheInfo.textContent = entries.length === 0
      ? '（空）'
      : `${entries.length} 个页面 / ${(bytes / 1024).toFixed(1)} KB`;
  } catch {
    el.cacheInfo.textContent = '（读取失败）';
  }
}

async function openSettingsDialog() {
  await loadSettings();
  await refreshCacheInfo();
  el.settingsDialog.showModal();
}

export function initSettings() {
  el.settingsBtn.addEventListener('click', openSettingsDialog);

  el.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {
      previewIntervalMs: Number(el.settingsInterval.value),
      autoPreview: el.settingsAutopreview.checked,
      useRemoteInclude: el.settingsRemoteinclude.checked,
      renderStyleMode: el.settingsStylemode.value,
    };
    try {
      applySettings(await api('POST', '/api/settings', patch));
      el.settingsDialog.close();
      setStatus(`设置已保存（预览间隔 ${state.settings.previewIntervalMs}ms）`);
    } catch (err) {
      setError(err.message);
    }
  });

  el.cacheClear.addEventListener('click', async () => {
    if (!confirm('清空 include 磁盘缓存？下次渲染将重新联网拉取。')) return;
    try {
      const r = await api('DELETE', '/api/include-cache');
      await refreshCacheInfo();
      setStatus(`已清空 include 缓存（${r.removed} 条）`);
    } catch (e) {
      setError(e.message);
    }
  });
}
