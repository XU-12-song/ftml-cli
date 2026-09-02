/**
 * app.js — ftml web 编辑器前端（原生 JS，零依赖）
 *
 * 状态: 项目列表 / 当前项目 + 源文件 / 模板·组件表（自动补全数据源）
 * 主流程: 编辑 → 防抖 600ms 保存 → 渲染 → iframe.srcdoc 刷新预览
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

  renderList(el.templateList, data.templates, (t) => t.name, (t) => t.keys.join(' '), `templates/${t.name}.ftmx`);
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

// ---------------- 新建模板 / 组件 ----------------
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
  const skeleton = `[[div class="page-block"]][[/div]]\n`;
  try {
    await saveFile(file, skeleton);
    setStatus(`已创建组件 ${name}`);
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

async function render() {
  if (!state.projectId || !state.filePath) return;
  try {
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

// ---------------- 自动补全 ----------------
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

  // 2. 模板键: [[name 已输入键…
  m = /\[\[([A-Za-z][A-Za-z0-9:_-]*)(\s+[^\]]*)$/.exec(before);
  if (m && state.templates.has(m[ 1 ])) {
    const token = (m[ 2 ].match(/[^\s=]*$/)?.[ 0 ]) || '';
    const items = state.templates.get(m[ 1 ])
      .filter((k) => k.startsWith(token))
      .map((k) => ({ label: `${k}=`, insert: `${k}=`, kind: 'key' }));
    return { items, replaceFrom: before.length - token.length };
  }

  // 3. 模板名: [[前缀
  m = /\[\[([A-Za-z][A-Za-z0-9:_-]*)$/.exec(before);
  if (m) {
    const items = [ ...state.templates.keys() ]
      .filter((n) => n.startsWith(m[ 1 ]))
      .map((n) => {
        const keys = state.templates.get(n);
        return { label: n, sub: keys.join(' '), insert: n, kind: 'name' };
      });
    return { items, replaceFrom: before.length - m[ 1 ].length };
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
    d.textContent = item.label;
    if (item.sub) {
      const s = document.createElement('span');
      s.className = 'ac-keys';
      s.textContent = item.sub;
      d.appendChild(s);
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
  } else {
    // 用补全内容替换触发文本（[replaceFrom, caret)）
    ta.setRangeText(item.insert, ac.replaceFrom, caret, 'end');
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
