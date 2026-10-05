/**
 * versions.js — 版本列表与按版本回退
 *
 * 回退大版本 x：本地 revert 该提交，线上回到大版本 x 的内容。
 * 回退小版本 x.y：本地 revert 该提交，线上回到大版本 x 创建时的内容（由后端决定）。
 */
import { el, state } from './dom.js';
import { api, setError, setStatus, fmtTime, showLog } from './api.js';
import { persistEditor } from './preview.js';
import { openFile } from './editor.js';

/** 打开版本列表（含 commit message），可回退到大版本 x 或小版本 x.y */
export async function openVersionsDialog() {
  if (!state.projectId) {
    setError('请先选择项目');
    return;
  }
  el.versionsDialog.showModal();
  await loadVersions();
}

export async function loadVersions() {
  el.versionsBody.innerHTML = '';
  el.versionsHint.textContent = '读取中…';
  try {
    const r = await api('GET', `/api/projects/${encodeURIComponent(state.projectId)}/versions`);
    const rows = r.versions || [];
    if (rows.length === 0) {
      el.versionsHint.textContent = '暂无版本记录：deploy 创建大版本，submit 创建小版本。';
      return;
    }
    el.versionsHint.textContent =
      '回退大版本 x：本地 revert 该提交，线上回到大版本 x 的内容。回退小版本 x.y：本地 revert 该提交，线上回到大版本 x 创建时的内容。';
    for (const v of rows) {
      const tr = document.createElement('tr');

      const ver = document.createElement('td');
      ver.textContent = v.version;
      ver.className = v.kind === 'major' ? 'ver-major' : 'ver-minor';

      const kind = document.createElement('td');
      kind.textContent = v.kind === 'major' ? '大版本' : '小版本';

      const commit = document.createElement('td');
      commit.className = 'ver-commit';
      commit.textContent = v.commit ? String(v.commit).slice(0, 7) : '-';
      commit.title = v.commit || '';

      const msg = document.createElement('td');
      msg.textContent = v.message || '';
      msg.title = v.message || '';

      const actions = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'btn btn-danger';
      btn.textContent = '回退';
      btn.title = `回退到 ${v.version}`;
      btn.disabled = !v.commit;
      btn.addEventListener('click', () => revertToVersion(v));
      actions.appendChild(btn);

      tr.append(ver, kind, commit, msg, actions);
      el.versionsBody.appendChild(tr);
    }
  } catch (e) {
    el.versionsHint.textContent = `加载失败: ${e.message}`;
  }
}

async function revertToVersion(v) {
  if (!confirm(`回退到版本 ${v.version}？\n本地将 git revert 提交 ${String(v.commit || '').slice(0, 7)}，并按版本语义回推线上。`)) return;
  const site = el.siteInput.value.trim();
  const page = el.pageInput.value.trim();
  try {
    await persistEditor();
    setStatus(`回退中（${v.version}）…`);
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/revert`, {
      path: state.filePath, site: site || undefined, page: page || undefined, to: v.version,
    });
    el.versionsDialog.close();
    showLog(`回退到 ${v.version}`, r.logs);
    setStatus(`已回退到 ${v.version}（${fmtTime()}）`);
    await openFile(state.filePath);
  } catch (e) {
    setError(e.message);
    showLog('回退失败', [ { kind: 'error', msg: e.message } ]);
  }
}

export function initVersions() {
  // 打开入口在命令面板（Ctrl+Alt+V）
  el.versionsRefresh.addEventListener('click', loadVersions);
  el.versionsClose.addEventListener('click', () => el.versionsDialog.close());
}
