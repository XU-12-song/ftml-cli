/**
 * snippets.js — 自定义代码片段管理
 *
 * 片段持久化在服务端 ~/.ftml-cli/snippets/snippets.json（Ace/TextMate .snippets 互转），
 * 内置 comp./tmpl. 命名空间片段只存在于内存，不落盘、不参与导入导出。
 */
import { el, state } from './dom.js';
import { api, setError, setStatus } from './api.js';

export const BUILTIN_SNIPPETS = [
  { prefix: 'comp.', kind: 'component', template: '[[component src="components/$1.ftml"]][[/component]]$0', description: '组件' },
  { prefix: 'tmpl.', kind: 'template', template: '[[$1]]$0[[/$1]]', description: '模板' },
];

/** 服务端片段记录 → 补全用条目（body → template，name 兜底 prefix） */
function normalizeSnippet(s) {
  const prefix = s.prefix || s.name || '';
  return {
    name: s.name || prefix,
    prefix,
    template: s.body ?? s.template ?? '',
    description: s.description || s.name || prefix,
  };
}

export async function loadSnippets() {
  let custom = [];
  try {
    const r = await api('GET', '/api/snippets');
    custom = (r.snippets || []).map(normalizeSnippet);
  } catch (e) {
    setError(`读取代码片段失败: ${e.message}`);
  }
  state.snippets = BUILTIN_SNIPPETS.concat(custom);
  renderSnippetList();
}

let editingSnippetPrefix = null; // 正在编辑的片段前缀（null = 新建）

function renderSnippetList() {
  el.snippetList.innerHTML = '';
  const custom = state.snippets
    .filter((s) => !s.kind)
    .sort((a, b) => (a.prefix || a.name).localeCompare(b.prefix || b.name));
  if (custom.length === 0) {
    const li = document.createElement('li');
    li.className = 'sb-muted';
    li.textContent = '（无自定义片段，点 ＋ 新建或 ⭳ 导入）';
    el.snippetList.appendChild(li);
    return;
  }
  for (const s of custom) {
    const key = s.prefix || s.name;
    const li = document.createElement('li');
    li.className = 'snip-row';
    const name = document.createElement('span');
    name.className = 'snip-name';
    name.textContent = s.description || key;
    name.title = s.body || s.template || '';
    const code = document.createElement('span');
    code.className = 'snip-prefix';
    code.textContent = key;
    code.title = '触发前缀';
    const del = document.createElement('button');
    del.className = 'sb-del';
    del.textContent = '✕';
    del.title = '删除此片段';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSnippet(key);
    });
    li.appendChild(name);
    li.appendChild(code);
    li.appendChild(del);
    li.addEventListener('click', () => openSnippetDialog(s));
    el.snippetList.appendChild(li);
  }
}

function openSnippetDialog(s) {
  editingSnippetPrefix = s ? (s.prefix || s.name) : null;
  el.snippetDialogTitle.textContent = s ? '编辑代码片段' : '新建代码片段';
  el.snippetDesc.value = s ? (s.description || '') : '';
  el.snippetPrefix.value = s ? (s.prefix || s.name) : '';
  el.snippetTemplate.value = s ? (s.body || s.template || '') : '';
  el.snippetDel.classList.toggle('hidden', !s);
  el.snippetDialog.showModal();
  el.snippetPrefix.focus();
}

async function saveSnippet() {
  const prefix = el.snippetPrefix.value.trim();
  const body = el.snippetTemplate.value.trim();
  const description = el.snippetDesc.value.trim();
  if (!prefix || !body) {
    setError('触发前缀与模板不能为空');
    return;
  }
  if (BUILTIN_SNIPPETS.some((b) => prefix.startsWith(b.prefix))) {
    setError(`前缀 "${prefix}" 与内置 ${BUILTIN_SNIPPETS.map((b) => b.prefix).join('/')} 命名空间冲突，请换一个`);
    return;
  }
  try {
    await api('POST', '/api/snippets', { name: prefix, prefix, body, description });
    await loadSnippets();
    el.snippetDialog.close();
    setStatus(`片段 "${prefix}" 已保存`);
  } catch (e) {
    setError(e.message);
  }
}

async function deleteSnippet(name) {
  if (!confirm(`删除片段 "${name}"？`)) return;
  try {
    await api('DELETE', `/api/snippets/${encodeURIComponent(name)}`);
    await loadSnippets();
    setStatus(`片段 "${name}" 已删除`);
  } catch (e) {
    setError(e.message);
  }
}

export function initSnippets() {
  el.addSnippetBtn.addEventListener('click', () => openSnippetDialog(null));
  el.snippetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSnippet();
  });
  el.snippetDel.addEventListener('click', () => {
    if (editingSnippetPrefix) deleteSnippet(editingSnippetPrefix);
    el.snippetDialog.close();
  });

  // 导入 Ace .snippets 文件（浏览器读文本 → 服务端合并持久化）
  el.importSnippetBtn.addEventListener('click', () => el.snippetFile.click());
  el.snippetFile.addEventListener('change', async () => {
    const file = el.snippetFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const r = await api('POST', '/api/snippets/import', { text, source: file.name });
      await loadSnippets();
      setStatus(`已导入 ${file.name}：新增 ${r.added} / 更新 ${r.updated}，共 ${r.total} 条`);
    } catch (e) {
      setError(`导入失败: ${e.message}`);
    } finally {
      el.snippetFile.value = '';
    }
  });

  // 导出全部片段为 .snippets 文件
  el.exportSnippetBtn.addEventListener('click', async () => {
    try {
      const r = await api('GET', '/api/snippets/export');
      const blob = new Blob([r.text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ftml.snippets';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('已导出片段文件');
    } catch (e) {
      setError(`导出失败: ${e.message}`);
    }
  });
}
