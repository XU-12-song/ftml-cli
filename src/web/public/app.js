/**
 * app.js — ftml web 编辑器前端（原生 JS，零依赖）
 *
 * 状态: 项目列表 / 当前项目 + 源文件 / 模板·组件表（自动补全数据源）
 * 主流程: 编辑 → 防抖 600ms 保存 → 渲染 → iframe.srcdoc 刷新预览
 *
 * 新增功能：
 * - 自定义 snippets 管理（侧边栏增删改，localStorage 持久化）
 * - 自定义 snippets / 组件模板名：输入即列实时候选，预览将插入的完整标签
 * - 内置常用 Wikidot 语法默认补全（`[[` 上下文合并候选，项目模板优先）
 * - 保存按钮（移动端适配）
 */

'use strict';

// ---------------- DOM ----------------
const $ = (id) => document.getElementById(id);

const el = {
  projectSelect: $('project-select'),
  addProjectBtn: $('add-project-btn'),
  initProjectBtn: $('init-project-btn'),
  fileSelect: $('file-select'),
  siteInput: $('site-input'),
  pageInput: $('page-input'),
  saveTargetBtn: $('save-target-btn'),
  validateBtn: $('validate-btn'),
  deployBtn: $('deploy-btn'),
  revertBtn: $('revert-btn'),
  authStatus: $('auth-status'),
  loginBtn: $('login-btn'),
  templateList: $('template-list'),
  componentList: $('component-list'),
  sourceList: $('source-list'),
  newTemplateBtn: $('new-template-btn'),
  newComponentBtn: $('new-component-btn'),
  newSourceBtn: $('new-source-btn'),
  editor: $('editor'),
  autocomplete: $('autocomplete'),
  preview: $('preview'),
  statusText: $('status-text'),
  statusDiag: $('status-diagnostics'),
  statusError: $('status-error'),
  nameDialog: $('name-dialog'),
  nameDialogTitle: $('name-dialog-title'),
  nameInput: $('name-input'),
  loginDialog: $('login-dialog'),
  loginUsername: $('login-username'),
  loginPassword: $('login-password'),
  logDialog: $('log-dialog'),
  logDialogTitle: $('log-dialog-title'),
  logContent: $('log-content'),
  logClose: $('log-close'),
  saveBtn: $('save-btn'),
  addSnippetBtn: $('add-snippet-btn'),
  snippetList: $('snippet-list'),
  snippetDialog: $('snippet-dialog'),
  snippetDialogTitle: $('snippet-dialog-title'),
  snippetForm: $('snippet-form'),
  snippetDesc: $('snippet-desc'),
  snippetPrefix: $('snippet-prefix'),
  snippetTemplate: $('snippet-template'),
  snippetDel: $('snippet-del'),
};

// ---------------- 状态 ----------------
const state = {
  projects: [],
  projectId: null,   // 当前项目 id（绝对路径）
  filePath: null,    // 当前文件相对路径
  templates: new Map(), // 模板名 → keys[]
  components: [],      // 组件名[]
  sources: [],
  isRepo: false,
  saveTimer: null,
  ac: null, // 当前自动补全 { items, kind, replaceFrom, onPick }
  creatingStarter: false, // 空项目自动创建 index.ftml 的防重入锁
  snippets: [], // 自定义代码片段
};

// ---------------- API ----------------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setError(msg) {
  el.statusError.textContent = msg || '';
}
function setStatus(msg) {
  el.statusText.textContent = msg;
}

function fmtTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function showLog(title, logs) {
  el.logDialogTitle.textContent = title;
  el.logContent.innerHTML = '';
  for (const l of logs) {
    const div = document.createElement('div');
    div.className = l.kind === 'error' ? 'log-err' : l.kind === 'warn' ? 'log-warn' : '';
    div.textContent = l.msg;
    el.logContent.appendChild(div);
  }
  el.logDialog.showModal();
}
el.logClose.addEventListener('click', () => el.logDialog.close());

// ---------------- 项目 ----------------
async function loadProjects() {
  try {
    state.projects = await api('GET', '/api/projects');
  } catch (e) {
    state.projects = [];
    setError(`加载项目失败: ${e.message}`);
  }
  el.projectSelect.innerHTML = '';
  if (state.projects.length === 0) {
    el.projectSelect.appendChild(new Option('（无项目，添加…）', ''));
  }
  for (const p of state.projects) {
    el.projectSelect.appendChild(new Option(p.name, p.id));
  }
  if (state.projectId && state.projects.some((p) => p.id === state.projectId)) {
    el.projectSelect.value = state.projectId;
  } else {
    el.projectSelect.value = '';
    state.projectId = null;
    state.filePath = null;
  }
}

el.projectSelect.addEventListener('change', () => {
  state.projectId = el.projectSelect.value || null;
  state.filePath = null;
  el.fileSelect.value = '';
  if (state.projectId) {
    refreshSidebar();
    clearEditor();
  } else {
    clearEditor();
  }
});

el.addProjectBtn.addEventListener('click', () => {
  openNameDialog('添加项目（输入目录绝对路径）', '', '添加').then(async (root) => {
    if (!root) return;
    try {
      await api('POST', '/api/projects', { root });
      await loadProjects();
      const p = state.projects.find((x) => x.root === root || x.id === root);
      if (p) {
        state.projectId = p.id;
        el.projectSelect.value = p.id;
        await refreshSidebar();
      }
    } catch (e) {
      setError(e.message);
    }
  });
});

el.initProjectBtn.addEventListener('click', async () => {
  if (!state.projectId) return;
  try {
    setStatus('初始化项目…');
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/init`);
    await refreshSidebar();
    showLog('ftml init', r.logs);
    setStatus(`已初始化（${fmtTime()}）`);
  } catch (e) {
    setError(e.message);
  }
});

// ---------------- 侧边栏 / 文件 ----------------
async function refreshSidebar() {
  if (!state.projectId) return;
  const data = await api('GET', `/api/projects/${encodeURIComponent(state.projectId)}/sidebar`);
  state.templates.clear();
  for (const t of data.templates) state.templates.set(t.name, t.keys);
  state.components = data.components.map((c) => c.name);
  state.sources = data.sources;
  state.isRepo = data.isRepo;

  el.initProjectBtn.classList.toggle('hidden', data.isRepo);
  if (!data.isRepo) {
    el.initProjectBtn.textContent = `初始化 git（${data.name}）`;
  }

  renderList(el.templateList, data.templates, (t) => t.name, (t) => t.keys.join(' '), (t) => `templates/${t.name}.ftmx`);
  renderList(el.componentList, data.components, (c) => c.name, null, (c) => `components/${c.name}.ftml`);
  renderList(el.sourceList, data.sources, (s) => s, null, (s) => s);

  // 刷新源文件下拉
  const prev = state.filePath;
  el.fileSelect.innerHTML = '';
  for (const s of data.sources) {
    el.fileSelect.appendChild(new Option(s, s));
  }
  if (prev && data.sources.includes(prev)) {
    el.fileSelect.value = prev;
  } else if (state.filePath) {
    state.filePath = null;
    clearEditor();
  }

  // 空项目：自动创建 index.ftml 并打开，避免"看不到源文件列表/无法预览"
  if (data.sources.length === 0 && !state.filePath && !state.creatingStarter) {
    state.creatingStarter = true;
    try {
      await saveFile('index.ftml', STARTER_SOURCE);
      setStatus('项目为空，已自动创建 index.ftml');
      await refreshSidebar();
      await openFile('index.ftml');
    } catch (e) {
      setError(`自动创建 index.ftml 失败: ${e.message}`);
    } finally {
      state.creatingStarter = false;
    }
  }
}

function renderList(ul, items, label, sub, openPath) {
  ul.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = label(item);
    if (sub) {
      const s = document.createElement('span');
      s.className = 'sb-keys';
      s.textContent = sub(item);
      li.appendChild(s);
    }
    const target = openPath(item);
    li.addEventListener('click', () => openFile(target));
    ul.appendChild(li);
  }
}

el.fileSelect.addEventListener('change', () => {
  if (el.fileSelect.value) openFile(el.fileSelect.value);
});

async function openFile(relPath) {
  if (!state.projectId || !relPath) return;
  try {
    const data = await api('GET', `/api/projects/${encodeURIComponent(state.projectId)}/file?path=${encodeURIComponent(relPath)}`);
    state.filePath = data.path;
    el.editor.value = data.source;
    el.fileSelect.value = data.path;
    highlightActive();
    // 恢复本地记住的目标页面
    const t = localStorage.getItem(targetKey());
    if (t) {
      try {
        const { site, page } = JSON.parse(t);
        if (site) el.siteInput.value = site;
        if (page) el.pageInput.value = page;
      } catch { /* ignore */ }
    }
    el.editor.focus();
    setStatus('已打开 ' + relPath);
    render();
  } catch (e) {
    setError(e.message);
  }
}

function clearEditor() {
  el.editor.value = '';
  el.preview.srcdoc = '';
  state.filePath = null;
  el.statusDiag.textContent = '';
  setStatus('就绪');
  highlightActive();
}

function targetKey() {
  return `ftml:target:${state.projectId}:${state.filePath}`;
}

function highlightActive() {
  const path = state.filePath;
  const mark = (ul, target) => {
    for (const li of ul.children) {
      li.classList.toggle('active', li.textContent === target);
    }
  };
  mark(el.sourceList, path);
  if (path?.startsWith('templates/')) mark(el.templateList, path.slice('templates/'.length, -'.ftmx'.length));
  if (path?.startsWith('components/')) mark(el.componentList, path.slice('components/'.length, -'.ftml'.length));
}

// ---------------- 新建模板 / 组件 / 源文件 ----------------
/** 新页面/组件的默认骨架（多行：[[div]] 独占一行才被 @wdprlib/parser 解析为块标签） */
const STARTER_SOURCE = `[[div class="page-block"]]

[[/div]]
`;

function openNameDialog(title, placeholder, okText) {
  return new Promise((resolve) => {
    el.nameDialogTitle.textContent = title;
    el.nameInput.value = '';
    el.nameInput.placeholder = placeholder || '';
    el.nameDialog.querySelector('#name-dialog-ok').textContent = okText || '创建';
    el.nameDialog.showModal();
    el.nameInput.focus();
    // 提交（点击"创建"或回车）→ resolve 输入值；Esc/取消 → resolve('')
    el.nameDialog.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = el.nameInput.value.trim();
      el.nameDialog.close();
      resolve(v);
    };
    el.nameDialog.onclose = () => {
      if (el.nameDialog.returnValue === 'cancel') resolve('');
    };
  });
}

el.newTemplateBtn.addEventListener('click', async () => {
  const name = await openNameDialog('新建模板', '模板名（如 box）', '创建');
  if (!name) return;
  const file = `templates/${name}.ftmx`;
  const skeleton = `[[div class="block"]]\n{ children }\n[[/div]]\n`;
  try {
    await saveFile(file, skeleton);
    setStatus(`已创建模板 ${name}`);
    await refreshSidebar();
    openFile(file);
  } catch (e) {
    setError(e.message);
  }
});

el.newComponentBtn.addEventListener('click', async () => {
  const name = await openNameDialog('新建组件', '组件名（如 box）', '创建');
  if (!name) return;
  const file = `components/${name}.ftml`;
  try {
    await saveFile(file, STARTER_SOURCE);
    setStatus(`已创建组件 ${name}`);
    await refreshSidebar();
    openFile(file);
  } catch (e) {
    setError(e.message);
  }
});

el.newSourceBtn.addEventListener('click', async () => {
  const name = await openNameDialog('新建页面（源文件）', '页面名（如 index）', '创建');
  if (!name) return;
  let file = name.trim();
  if (!file) return;
  if (!file.endsWith('.ftml')) file += '.ftml';
  try {
    await saveFile(file, STARTER_SOURCE);
    setStatus(`已创建页面 ${file}`);
    await refreshSidebar();
    openFile(file);
  } catch (e) {
    setError(e.message);
  }
});

// ---------------- 保存 + 渲染 ----------------
async function saveFile(relPath, source) {
  await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/save`, { path: relPath, source });
}

/** 把编辑器当前内容落盘（render/validate/deploy/revert 都从磁盘读，必须先存） */
async function persistEditor() {
  if (!state.projectId || !state.filePath) return;
  await saveFile(state.filePath, el.editor.value);
}

async function render() {
  if (!state.projectId || !state.filePath) return;
  try {
    await persistEditor();
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/render`, {
      path: state.filePath,
      site: el.siteInput.value.trim() || undefined,
      page: el.pageInput.value.trim() || undefined,
    });
    el.preview.srcdoc = r.html;
    showDiagnostics(r.diagnostics || []);
    setStatus(`已保存并渲染（${fmtTime()}）`);
  } catch (e) {
    setError(e.message);
  }
}

function scheduleSaveRender() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(render, 600);
}

el.editor.addEventListener('input', () => {
  setError('');
  hideAutocomplete();
  // 输入即刷新候选（IME 组合中不弹，compositionend 再刷）
  if (!el.editor.composing) setTimeout(updateAutocomplete, 0);
  scheduleSaveRender();
});

el.editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    clearTimeout(state.saveTimer);
    render();
    return;
  }
  if (state.ac) return handleAcKeydown(e);
  hideAutocomplete();
  setTimeout(updateAutocomplete, 0);
});

el.editor.addEventListener('click', () => setTimeout(updateAutocomplete, 0));
el.editor.addEventListener('keyup', () => setTimeout(updateAutocomplete, 0));
el.editor.addEventListener('compositionend', () => setTimeout(updateAutocomplete, 0));

// ---------------- 诊断显示 ----------------
function showDiagnostics(diags) {
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.filter((d) => d.severity !== 'error').length;
  el.statusDiag.textContent =
    diags.length === 0 ? '' : `渲染: ${errors} 错误 / ${warnings} 警告`;
}

// ---------------- 目标页面 ----------------
el.saveTargetBtn.addEventListener('click', async () => {
  if (!state.projectId || !state.filePath) return;
  const site = el.siteInput.value.trim();
  const page = el.pageInput.value.trim();
  try {
    await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/target`, {
      path: state.filePath, site, page,
    });
    if (site || page) localStorage.setItem(targetKey(), JSON.stringify({ site, page }));
    setStatus(`目标页面已保存（${fmtTime()}）`);
  } catch (e) {
    setError(e.message);
  }
});

// ---------------- 校验 / 部署 / 回退 ----------------
el.validateBtn.addEventListener('click', async () => {
  if (!state.projectId || !state.filePath) return;
  try {
    await persistEditor();
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/validate`, { path: state.filePath });
    const { errors, warnings } = r;
    if (errors.length === 0 && warnings.length === 0) {
      setStatus('校验通过');
      el.statusDiag.textContent = '✓ 通过';
    } else {
      el.statusDiag.textContent = `校验: ${errors.length} 错误 / ${warnings.length} 警告`;
      const logs = [
        ...warnings.map((m) => ({ kind: 'warn', msg: `⚠ ${m}` })),
        ...errors.map((m) => ({ kind: 'error', msg: `✖ ${m}` })),
      ];
      showLog('校验结果', logs);
    }
  } catch (e) {
    setError(e.message);
  }
});

el.deployBtn.addEventListener('click', async () => {
  if (!state.projectId || !state.filePath) return;
  const site = el.siteInput.value.trim();
  const page = el.pageInput.value.trim();
  if (!site || !page) {
    setError('部署前请先填写站点与页面');
    return;
  }
  try {
    await persistEditor();
    setStatus('部署中…');
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/deploy`, {
      path: state.filePath, site, page,
    });
    showLog('部署输出', r.logs);
    setStatus('部署完成（' + fmtTime() + '）');
  } catch (e) {
    setError(e.message);
    showLog('部署失败', [ { kind: 'error', msg: e.message } ]);
  }
});

el.revertBtn.addEventListener('click', async () => {
  if (!state.projectId) return;
  const site = el.siteInput.value.trim();
  const page = el.pageInput.value.trim();
  try {
    await persistEditor();
    setStatus('回退中…');
    const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/revert`, {
      path: state.filePath, site, page,
    });
    showLog('回退输出', r.logs);
    setStatus('回退完成（' + fmtTime() + '）');
  } catch (e) {
    setError(e.message);
    showLog('回退失败', [ { kind: 'error', msg: e.message } ]);
  }
});

// ---------------- 登录 ----------------
async function refreshAuth() {
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

// ---------------- 代码片段管理 ----------------
/** 只持久化用户自定义片段（带 kind 的内置 comp./tmpl. 不落盘） */
function persistSnippets() {
  const custom = state.snippets.filter((s) => !s.kind);
  localStorage.setItem('ftml:snippets', JSON.stringify(custom));
}

let editingSnippetPrefix = null; // 正在编辑的片段前缀（null = 新建）

function renderSnippetList() {
  el.snippetList.innerHTML = '';
  const custom = state.snippets.filter((s) => !s.kind).sort((a, b) => a.prefix.localeCompare(b.prefix));
  if (custom.length === 0) {
    const li = document.createElement('li');
    li.className = 'sb-muted';
    li.textContent = '（无自定义片段，点 ＋ 新建）';
    el.snippetList.appendChild(li);
    return;
  }
  for (const s of custom) {
    const li = document.createElement('li');
    li.className = 'snip-row';
    const name = document.createElement('span');
    name.className = 'snip-name';
    name.textContent = s.description || s.prefix;
    name.title = s.template;
    const code = document.createElement('span');
    code.className = 'snip-prefix';
    code.textContent = s.prefix;
    code.title = '触发前缀';
    const del = document.createElement('button');
    del.className = 'sb-del';
    del.textContent = '✕';
    del.title = '删除此片段';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSnippet(s.prefix);
    });
    li.appendChild(name);
    li.appendChild(code);
    li.appendChild(del);
    li.addEventListener('click', () => openSnippetDialog(s));
    el.snippetList.appendChild(li);
  }
}

function openSnippetDialog(s) {
  editingSnippetPrefix = s ? s.prefix : null;
  el.snippetDialogTitle.textContent = s ? '编辑代码片段' : '新建代码片段';
  el.snippetDesc.value = s ? (s.description || '') : '';
  el.snippetPrefix.value = s ? s.prefix : '';
  el.snippetTemplate.value = s ? s.template : '';
  el.snippetDel.classList.toggle('hidden', !s);
  el.snippetDialog.showModal();
  el.snippetPrefix.focus();
}

function saveSnippet() {
  const prefix = el.snippetPrefix.value.trim();
  const template = el.snippetTemplate.value.trim();
  const description = el.snippetDesc.value.trim();
  if (!prefix || !template) {
    setError('触发前缀与模板不能为空');
    return;
  }
  const builtin = state.snippets.find((s) => s.kind && s.prefix === prefix);
  if (builtin) {
    setError(`前缀 "${prefix}" 与内置 comp./tmpl. 冲突，请换一个`);
    return;
  }
  state.snippets = state.snippets.filter((s) => s.kind || s.prefix !== prefix);
  state.snippets.push({ prefix, template, description: description || prefix });
  persistSnippets();
  renderSnippetList();
  el.snippetDialog.close();
  setStatus(`片段 "${prefix}" 已保存`);
}

function deleteSnippet(prefix) {
  if (!confirm(`删除片段 "${prefix}"？`)) return;
  state.snippets = state.snippets.filter((s) => s.kind || s.prefix !== prefix);
  persistSnippets();
  renderSnippetList();
  setStatus(`片段 "${prefix}" 已删除`);
}

el.addSnippetBtn.addEventListener('click', () => openSnippetDialog(null));
el.snippetForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveSnippet();
});
el.snippetDel.addEventListener('click', () => {
  if (editingSnippetPrefix) deleteSnippet(editingSnippetPrefix);
  el.snippetDialog.close();
});

// ---------------- 内置 Wikidot 语法默认补全 ----------------
// 只收录标准 Wikidot 可解析的 [[...]] 标签（依据 scp-jp wikidot-syntax 参考）。
// close: 'block'  = 块级标签，开/闭各独占一行（否则不解析）
//        'pair'   = 行内配对标签
//        'single' = 自闭合标签（无配对）
// arg:   需要参数的标签：arg===true 时选中后光标停在参数位（可续输），
//        为字符串时作为示例参数插入开标签内。
// attrs: 在 `[[name 已输入…` 内部可补全的属性键（case 2）。
// 说明：[[module]] 的模块名（CSS/ListPages…）与 SCP 站点专用 include
//（:scp-xx: 前缀）不在默认表内——模块名由 WIKI_MODULES 提供。
const WIKI_MODULES = [
  'CSS', 'ListPages', 'CountPages', 'Rate', 'Comments', 'NewPage',
  'TagCloud', 'PageTree', 'PageCalendar', 'Redirect', 'Backlinks',
  'WantedPages', 'Members', 'Categories',
];

const WIKI_DEFS = [
  { n: 'div', close: 'block', attrs: [ 'class', 'style', 'id' ], desc: '块容器（SCP 排版常用，可配 class/style）' },
  { n: 'span', close: 'pair', attrs: [ 'class', 'style', 'id' ], desc: '行内容器' },
  { n: 'size', close: 'pair', arg: '150%', desc: '字号（150% / larger / 18px…）' },
  { n: 'note', close: 'block', desc: '注记块（引用框效果，SCP 常用）' },
  { n: 'code', close: 'block', attrs: [ 'type' ], desc: '代码块（内容原样不解析）' },
  { n: 'collapsible', close: 'block', attrs: [ 'show', 'hide', 'hideLocation', 'folded' ], desc: '折叠块（不可嵌套）' },
  { n: 'tabview', close: 'block', desc: '选项卡容器（内放 tab）' },
  { n: 'tab', close: 'pair', arg: '标题', desc: '单个选项卡（标题参数，置于 tabview 内）' },
  { n: 'toc', close: 'single', desc: '目录' },
  { n: 'footnote', close: 'pair', desc: '脚注（悬浮小窗显示内容）' },
  { n: 'footnoteblock', close: 'single', desc: '脚注列位置（可选）' },
  { n: 'include', close: 'single', arg: true, desc: '包含页面/组件（必须行首）' },
  { n: 'image', close: 'single', arg: true, attrs: [ 'link', 'alt', 'title', 'width', 'height', 'style', 'class', 'size' ], desc: '图片（link 前加 * = 新窗打开）' },
  { n: 'iframe', close: 'single', arg: true, attrs: [ 'width', 'height', 'style', 'class', 'scrolling', 'align' ], desc: '嵌入 iframe' },
  { n: 'module', close: 'single', arg: true, desc: '模块（CSS / ListPages / Rate…）' },
  { n: 'table', close: 'block', attrs: [ 'class', 'style' ], desc: '表格（内放 row/cell）' },
  { n: 'row', close: 'block', desc: '表格行（置于 table 内）' },
  { n: 'cell', close: 'pair', attrs: [ 'colspan', 'rowspan', 'style' ], desc: '单元格（置于 row 内，表头用 hcell）' },
  { n: 'gallery', close: 'block', attrs: [ 'size', 'order', 'viewer' ], desc: '图片画廊（行首）' },
  { n: 'math', close: 'block', desc: '块级公式（MathJax）' },
];

const WIKI_BY_NAME = new Map(WIKI_DEFS.map((w) => [ w.n, w ]));

/** [[ 之后要插入的文本（$0 = 选中后光标位置；不含开头的 [[） */
function wikiInsertAfterOpen(w) {
  if (w.close === 'block') return `${w.n}]]\n$0\n[[/${w.n}]]`;
  if (w.close === 'pair') {
    if (w.arg !== undefined) return `${w.n} ${w.arg}]]$0[[/${w.n}]]`;
    return `${w.n}]]$0[[/${w.n}]]`;
  }
  // single：自闭合；arg===true 光标停在参数位
  if (w.arg) return `${w.n} $0]]`;
  return `${w.n}]]$0`;
}

function wikiItem(w) {
  return { label: w.n, sub: w.desc, insert: wikiInsertAfterOpen(w), kind: 'wd' };
}

// ---------------- 自动补全（增强版） ----------------
function textBeforeCaret() {
  return el.editor.value.slice(0, el.editor.selectionStart);
}

function detectTrigger() {
  const before = textBeforeCaret();
  let m;

  // 1. 组件路径: [[component src="
  m = /\[\[component\s+src="([^"]*)$/.exec(before);
  if (m) {
    const items = state.components
      .filter((c) => c.startsWith(m[ 1 ]))
      .map((c) => ({ label: `components/${c}.ftml`, insert: `components/${c}.ftml"`, kind: 'component' }));
    return { items, replaceFrom: before.length - m[ 1 ].length };
  }

  // 2. 标签键: [[name 已输入键…
  //    - 项目模板的声明键（.ftmx keys）
  //    - 内置标签的常见属性键（class/style/…）
  //    - module 特例：补全模块名（CSS / ListPages / …）
  m = /\[\[([A-Za-z][A-Za-z0-9:_-]*)(\s+[^\]]*)$/.exec(before);
  const wiki = m ? WIKI_BY_NAME.get(m[ 1 ]) : null;
  if (m && (state.templates.has(m[ 1 ]) || wiki)) {
    const token = (m[ 2 ].match(/[^\s=]*$/)?.[ 0 ]) || '';
    if (state.templates.has(m[ 1 ])) {
      const items = state.templates.get(m[ 1 ])
        .filter((k) => k.startsWith(token))
        .map((k) => ({ label: `${k}=`, insert: `${k}=`, kind: 'key' }));
      return { items, replaceFrom: before.length - token.length };
    }
    if (wiki.n === 'module') {
      const items = WIKI_MODULES
        .filter((x) => x.toLowerCase().startsWith(token.toLowerCase()))
        .map((x) => ({ label: x, insert: x, kind: 'wd' }));
      return { items, replaceFrom: before.length - token.length };
    }
    const items = (wiki.attrs || [])
      .filter((k) => k.startsWith(token))
      .map((k) => ({ label: `${k}=`, insert: `${k}=`, kind: 'key' }));
    if (items.length) return { items, replaceFrom: before.length - token.length };
  }

  // 3. 标签名: [[前缀 — 项目模板优先，内置 Wikidot 标签兜底（同名去重）
  m = /\[\[([A-Za-z][A-Za-z0-9:_-]*)$/.exec(before);
  if (m) {
    const items = [];
    const seen = new Set();
    for (const n of state.templates.keys()) {
      if (n.startsWith(m[ 1 ])) {
        seen.add(n);
        const keys = state.templates.get(n);
        items.push({ label: n, sub: keys.join(' '), insert: n, kind: 'name' });
      }
    }
    for (const w of WIKI_DEFS) {
      if (seen.has(w.n) || !w.n.startsWith(m[ 1 ])) continue;
      items.push(wikiItem(w));
    }
    return { items, replaceFrom: before.length - m[ 1 ].length };
  }

  // ===== 新增：自定义 snippets + 直接输入名字补全（实时候选列表） =====
  // 提取光标前最后一个单词（支持点号，如 comp.box）
  const wordMatch = /([A-Za-z][A-Za-z0-9:_-]*(?:\.[A-Za-z][A-Za-z0-9:_-]*)*)$/.exec(before);
  if (wordMatch) {
    const word = wordMatch[0];
    const start = before.length - word.length;

    // 构造候选：label 为条目名，preview 显示"将插入的完整标签"
    const compItem = (c) => {
      const insert = `[[component src="components/${c}.ftml"]][[/component]]$0`;
      return { label: `组件 ${c}`, preview: insert.replace(/\$0/g, ''), insert, kind: 'fulltag' };
    };
    const tplItem = (n, keys) => {
      const insert = `[[${n}]]$0[[/${n}]]`;
      const preview = keys.length ? `[[${n} ${keys.join(' ')}]] … [[/${n}]]` : `[[${n}]] … [[/${n}]]`;
      return { label: `模板 ${n}`, preview, insert, kind: 'fulltag' };
    };

    // 4a. 命名空间前缀（comp./tmpl.）→ 实时列出该命名空间下的候选
    const ns = state.snippets.find((s) => s.kind && word.startsWith(s.prefix));
    if (ns) {
      const rest = word.slice(ns.prefix.length);
      const items = [];
      if (ns.kind === 'component') {
        for (const c of state.components) if (c.startsWith(rest)) items.push(compItem(c));
      } else if (ns.kind === 'template') {
        for (const [n, keys] of state.templates) if (n.startsWith(rest)) items.push(tplItem(n, keys));
      }
      if (items.length) return { items: items.slice(0, 12), replaceFrom: start };
    }

    const snipItem = (snip, param) => {
      // 无 $0 且含 $1（本次不带参数展开）→ caret 停在 $1 原位置，直接补参数
      const has0 = snip.template.includes('$0');
      const caret = (!has0 && snip.template.includes('$1') && !param)
        ? snip.template.indexOf('$1') : -1;
      const insert = snip.template.replace(/\$1/g, param);
      return {
        label: snip.description || snip.prefix,
        preview: insert.replace(/\$0/g, ''),
        insert, kind: 'snippet', caret,
      };
    };

    // 4b. 自定义 snippets：列出所有匹配当前输入的前缀（键入即预览）。
    //     - word 已含完整前缀 → 剩余部分作为 $1 参数
    //     - 正在敲前缀本身（prefix 开头匹配 word，≥2 字符）→ 也列出，选中后光标落在参数位
    const snips = [];
    for (const snip of state.snippets) {
      if (snip.kind) continue;
      if (word.startsWith(snip.prefix) && word !== snip.prefix) {
        snips.push(snipItem(snip, word.slice(snip.prefix.length)));
      } else if (word.length >= 2 && snip.prefix.startsWith(word)) {
        snips.push(snipItem(snip, ''));
      }
    }

    // 4c. 裸单词前缀匹配组件/模板名 → 边输入边列候选。
    //      ≥2 字符、且前一字符不是属性/值上下文（css 值、引号内容等），避免误弹
    const prev = start > 0 ? before[start - 1] : '';
    let named = [];
    if (word.length >= 2 && !word.includes('.') && !/[:."'=,[/]/.test(prev)) {
      for (const c of state.components) if (c.startsWith(word)) named.push(compItem(c));
      for (const [n, keys] of state.templates) if (n.startsWith(word)) named.push(tplItem(n, keys));
    }

    // 片段与组件/模板名候选合并成同一份实时候选列表
    const items = snips.concat(named);
    if (items.length) return { items: items.slice(0, 12), replaceFrom: start };
  }

  return null;
}

function updateAutocomplete() {
  const trigger = detectTrigger();
  if (!trigger || trigger.items.length === 0) {
    hideAutocomplete();
    return;
  }
  state.ac = trigger;
  state.ac.selected = 0;
  el.autocomplete.innerHTML = '';
  trigger.items.forEach((item, i) => {
    const d = document.createElement('div');
    if (item.preview !== undefined) {
      // 两行条目：名字 + 将插入的完整标签预览
      d.className = 'ac-item';
      const l = document.createElement('span');
      l.className = 'ac-label';
      l.textContent = item.label;
      const p = document.createElement('span');
      p.className = 'ac-preview';
      p.textContent = item.preview;
      d.appendChild(l);
      d.appendChild(p);
    } else {
      d.textContent = item.label;
      if (item.sub) {
        const s = document.createElement('span');
        s.className = 'ac-keys';
        s.textContent = item.sub;
        d.appendChild(s);
      }
    }
    d.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pickAutocomplete(i);
    });
    el.autocomplete.appendChild(d);
  });
  renderAcSelection();
  positionAutocomplete();
  el.autocomplete.classList.remove('hidden');
}

function renderAcSelection() {
  [ ...el.autocomplete.children ].forEach((d, i) => {
    d.classList.toggle('sel', i === state.ac.selected);
  });
}

function positionAutocomplete() {
  const { x, y, lineHeight } = caretCoords(el.editor);
  const mainRect = $('main').getBoundingClientRect();
  const edRect = el.editor.getBoundingClientRect();
  const left = edRect.left - mainRect.left + x + 4;
  const top = edRect.top - mainRect.top + y + lineHeight + 4;
  el.autocomplete.style.left = Math.max(4, left) + 'px';
  el.autocomplete.style.top = top + 'px';
}

function hideAutocomplete() {
  state.ac = null;
  el.autocomplete.classList.add('hidden');
}

function pickAutocomplete(idx) {
  const ac = state.ac;
  if (!ac) return;
  const item = ac.items[ idx ];
  const ta = el.editor;
  const caret = ta.selectionStart;
  if (item.kind === 'name') {
    // 插入结果为 `[[name ]]`，caret 移到 name 之后（name 后空一格再 ]]）
    ta.setRangeText(item.insert + ' ]]', ac.replaceFrom, caret, 'end');
    const nameEnd = ac.replaceFrom + item.insert.length;
    ta.setSelectionRange(nameEnd, nameEnd);
  } else if (typeof item.caret === 'number' && item.caret >= 0) {
    // 自定义 snippet 无参数展开：光标停在 $1 原位置（标签内部参数位），方便直接输入
    ta.setRangeText(item.insert, ac.replaceFrom, caret, 'end');
    ta.setSelectionRange(ac.replaceFrom + item.caret, ac.replaceFrom + item.caret);
  } else {
    // 用补全内容替换触发文本（[replaceFrom, caret)）；支持 $0 占位符定位光标
    const pos = item.insert.indexOf('$0');
    if (pos !== -1) {
      const insert = item.insert.replace(/\$0/g, '');
      ta.setRangeText(insert, ac.replaceFrom, caret, 'end');
      // 光标落在 $0 位置：替换起点 + 占位符下标（此前文本长度不变）
      ta.setSelectionRange(ac.replaceFrom + pos, ac.replaceFrom + pos);
    } else {
      ta.setRangeText(item.insert, ac.replaceFrom, caret, 'end');
    }
  }
  hideAutocomplete();
  scheduleSaveRender();
}

function handleAcKeydown(e) {
  const items = state.ac.items;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.ac.selected = (state.ac.selected + 1) % items.length;
    renderAcSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.ac.selected = (state.ac.selected - 1 + items.length) % items.length;
    renderAcSelection();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    pickAutocomplete(state.ac.selected);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideAutocomplete();
  } else {
    hideAutocomplete();
    setTimeout(updateAutocomplete, 0);
  }
}

// caret 坐标（隐藏 mirror div 测量）
function caretCoords(ta) {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    tabSize: cs.tabSize,
    padding: cs.padding,
    left: '0',
    top: '0',
  });
  const w = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  mirror.style.width = Math.max(0, w) + 'px';
  document.body.appendChild(mirror);

  const before = ta.value.slice(0, ta.selectionStart);
  mirror.textContent = before;
  const lineHeight = parseFloat(cs.lineHeight) || Math.round(parseFloat(cs.fontSize) * 1.6);
  const y = Math.max(0, mirror.scrollHeight - lineHeight);

  const span = document.createElement('span');
  span.textContent = before.slice(before.lastIndexOf('\n') + 1) + '\u200b';
  mirror.textContent = '';
  mirror.appendChild(span);
  const x = span.offsetWidth;

  mirror.remove();
  return { x, y, lineHeight };
}

// ---------------- 启动 ----------------
async function boot() {
  // 初始化 snippets（默认 + 用户自定义 localStorage 'ftml:snippets'）
  const defaultSnippets = [
    { prefix: 'comp.', kind: 'component', template: '[[component src="components/$1.ftml"]][[/component]]$0', description: '组件' },
    { prefix: 'tmpl.', kind: 'template', template: '[[$1]]$0[[/$1]]', description: '模板' },
  ];
  let custom = [];
  try {
    custom = JSON.parse(localStorage.getItem('ftml:snippets')) || [];
  } catch { /* ignore */ }
  state.snippets = defaultSnippets.concat(custom);
  renderSnippetList();

  el.saveBtn.addEventListener('click', () => {
    if (!state.projectId || !state.filePath) {
      setError('请先打开一个文件');
      return;
    }
    clearTimeout(state.saveTimer);
    render();
  });
  await loadProjects();
  await refreshAuth();
  if (state.projects.length === 0) {
    el.addProjectBtn.click();
  }
  if (state.projectId) {
    await refreshSidebar();
  }
}

boot();

