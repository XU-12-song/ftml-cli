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
    const next = r.next || null;
    if (rows.length === 0) {
      el.versionsHint.textContent = next
        ? `暂无版本记录。下一次「提交」会创建小版本 ${next.minor}，「部署」会创建大版本 ${next.major}。`
        : '暂无版本记录：deploy 创建大版本，submit 创建小版本。';
      return;
    }
    el.versionsHint.textContent = next
      ? `下一个版本：提交 → ${next.minor}；部署 → 大版本 ${next.major}（tag v${next.major}）。回退到小版本 x.y 时线上回到大版本 x。`
      : '回退大版本 x：本地与线上都回到 x。回退小版本 x.y：本地回到 x.y，线上回到大版本 x。';
    const majorSet = new Set(rows.filter((x) => x.kind === 'major').map((x) => x.version));
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

      const time = document.createElement('td');
      time.className = 'ver-commit';
      time.textContent = fmtVersionTime(v.createdAt);
      time.title = v.createdAt || '';

      const online = document.createElement('td');
      const onlineText = v.kind === 'major'
        ? `大版本 ${v.version} 快照`
        : majorSet.has(v.major)
          ? `大版本 ${v.major} 快照`
          : '该提交重建（未部署）';
      online.textContent = onlineText;
      online.title = v.kind === 'major'
        ? '本地与线上都回到该版本'
        : majorSet.has(v.major)
          ? `线上没有小版本 ${v.version} 的快照，会回到大版本 ${v.major} 发布时的内容`
          : '该项目尚未部署过大版本，线上会用该小版本的提交重建';

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

      tr.append(ver, kind, commit, time, online, msg, actions);
      el.versionsBody.appendChild(tr);
    }
  } catch (e) {
    el.versionsHint.textContent = `加载失败: ${e.message}`;
  }
}

/** ISO 时间 → 本地「YYYY-MM-DD HH:mm」；解析失败原样返回 */
function fmtVersionTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function revertToVersion(v) {
  const online = v.kind === 'major'
    ? `本地与线上都回到大版本 ${v.version}（tag v${v.version}）的发布内容。`
    : v.major === '0'
      ? '线上会用该小版本的提交重建（项目尚未部署过大版本）。'
      : `本地回到小版本 ${v.version}；线上回到大版本 ${v.major} 的快照（小版本本身没有线上快照）。`;
  if (!confirm(`回退到版本 ${v.version}？\n${online}\n\n本地会 git revert 提交 ${String(v.commit || '').slice(0, 7)}。`)) return;
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
