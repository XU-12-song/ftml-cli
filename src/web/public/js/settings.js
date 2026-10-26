/**
 * settings.js — 编辑器设置（服务端持久化）与 include 磁盘缓存管理
 */
import { el, state } from './dom.js';
import { api, setError, setStatus } from './api.js';
import { applyTheme } from './theme.js';
import { render } from './preview.js';

function applyPlaceholderSettings(mp) {
  const p = mp || state.settings.modulePlaceholders;
  el.settingsMpLpCount.value = p.listPages.count;
  el.settingsMpLpTitle.value = p.listPages.title;
  el.settingsMpLpText.value = p.listPages.text;
  el.settingsMpLpTags.value = p.listPages.tags;
  el.settingsMpLpDate.value = String(p.listPages.date).slice(0, 10);
  el.settingsMpLpRating.value = p.listPages.rating;
  el.settingsMpLuCount.value = p.listUsers.count;
  el.settingsMpLuName.value = p.listUsers.name;
  el.settingsMpLuTitle.value = p.listUsers.title;
  el.settingsMpTcCount.value = p.tagCloud.count;
  el.settingsMpTcTags.value = p.tagCloud.tags;
  el.settingsMpTcMinweight.value = p.tagCloud.minWeight;
  el.settingsMpTcMaxweight.value = p.tagCloud.maxWeight;
  el.settingsMpRateScore.value = p.rate.score;
  el.settingsMpRateVotes.value = p.rate.votes;
}

function readPlaceholderSettings() {
  return {
    listPages: {
      count: Number(el.settingsMpLpCount.value),
      title: el.settingsMpLpTitle.value,
      text: el.settingsMpLpText.value,
      tags: el.settingsMpLpTags.value,
      date: el.settingsMpLpDate.value,
      rating: Number(el.settingsMpLpRating.value),
    },
    listUsers: {
      count: Number(el.settingsMpLuCount.value),
      name: el.settingsMpLuName.value,
      title: el.settingsMpLuTitle.value,
    },
    tagCloud: {
      count: Number(el.settingsMpTcCount.value),
      tags: el.settingsMpTcTags.value,
      minWeight: Number(el.settingsMpTcMinweight.value),
      maxWeight: Number(el.settingsMpTcMaxweight.value),
    },
    rate: {
      score: Number(el.settingsMpRateScore.value),
      votes: Number(el.settingsMpRateVotes.value),
    },
  };
}

export function applySettings(s) {
  state.settings = { ...state.settings, ...s };
  el.settingsInterval.value = state.settings.previewIntervalMs;
  el.settingsAutopreview.checked = !!state.settings.autoPreview;
  el.settingsRemoteinclude.checked = !!state.settings.useRemoteInclude;
  el.settingsStylemode.value = state.settings.renderStyleMode;
  if (el.settingsTheme) el.settingsTheme.value = state.settings.theme || 'auto';
  applyPlaceholderSettings(state.settings.modulePlaceholders);
  // 服务端设置里的主题为准（启动时覆盖 localStorage 缓存），不再回写服务端
  if (s.theme) applyTheme(s.theme, { syncServer: false });
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

/** 打开设置对话框：先拉最新设置与缓存信息（命令面板调用） */
export async function openSettings() {
  await loadSettings();
  await refreshCacheInfo();
  el.settingsDialog.showModal();
}

export function initSettings() {
  // 入口在命令面板（Ctrl+,）
  el.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {
      previewIntervalMs: Number(el.settingsInterval.value),
      autoPreview: el.settingsAutopreview.checked,
      useRemoteInclude: el.settingsRemoteinclude.checked,
      renderStyleMode: el.settingsStylemode.value,
      theme: el.settingsTheme.value,
      modulePlaceholders: readPlaceholderSettings(),
    };
    try {
      applySettings(await api('POST', '/api/settings', patch));
      el.settingsDialog.close();
      setStatus(`设置已保存（预览间隔 ${state.settings.previewIntervalMs}ms）`);
      // 占位数据变化需要立即反映到预览（服务端每次渲染都会重新读取设置）
      if (state.projectId && state.filePath) render();
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
