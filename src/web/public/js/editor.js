/**
 * editor.js — 编辑器核心：侧边栏刷新 / 文件打开保存 / 编辑事件 / 校验与部署
 */
import { el, state } from './dom.js';
import { api, setError, setStatus, fmtTime, showLog } from './api.js';
import { renderList, highlightActive, renderProblems } from './ui.js';
import { openNameDialog, openPromptDialog } from './dialogs.js';
import { saveFile, persistEditor, render, scheduleSaveRender } from './preview.js';
import { updateAutocomplete, hideAutocomplete, handleAcKeydown } from './autocomplete.js';
import { createFtmlEditor } from './cm-editor.js';

/** 新页面/组件的默认骨架（多行：[[div]] 独占一行才被 @wdprlib/parser 解析为块标签） */
export const STARTER_SOURCE = `[[div class="page-block"]]

[[/div]]
`;

function targetKey() {
  return `ftml:target:${state.projectId}:${state.filePath}`;
}

export async function refreshSidebar() {
  if (!state.projectId) return;
  const data = await api('GET', `/api/projects/${encodeURIComponent(state.projectId)}/sidebar`);
  state.templates.clear();
  for (const t of data.templates) state.templates.set(t.name, t.keys);
  el.editor.setTemplates(state.templates); // 语义层：未知宏 / 模板键校验
  state.components = data.components.map((c) => c.name);
  state.sources = data.sources;
  state.isRepo = data.isRepo;

  el.initProjectBtn.classList.toggle('hidden', data.isRepo);
  if (!data.isRepo) {
    el.initProjectBtn.textContent = `初始化 git（${data.name}）`;
  }

  renderList(el.templateList, data.templates, (t) => t.name, (t) => t.keys.join(' '), (t) => `templates/${t.name}.ftmx`, openFile);
  renderList(el.componentList, data.components, (c) => c.name, null, (c) => `components/${c}.ftml`, openFile);
  renderList(el.sourceList, data.sources, (s) => s, null, (s) => s, openFile);

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

export async function openFile(relPath) {
  if (!state.projectId || !relPath) return;
  try {
    const data = await api('GET', `/api/projects/${encodeURIComponent(state.projectId)}/file?path=${encodeURIComponent(relPath)}`);
    state.filePath = data.path;
    el.editor.value = data.source;
    el.editor.setFileKind(state.filePath.endsWith('.ftmx') ? 'template' : 'source');
    el.editor.setDiagnostics([]); // 旧文件的诊断作废，等本次 render 回填
    renderProblems([]);           // 旧文件的问题列表同样作废
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

export function clearEditor() {
  el.editor.value = '';
  el.editor.setFileKind('source');
  el.editor.setDiagnostics([]);
  renderProblems([]);
  el.preview.srcdoc = '';
  state.filePath = null;
  el.statusDiag.textContent = '';
  setStatus('就绪');
  highlightActive();
}

export function initEditor() {
  // 建 CM6 视图并挂上门面，后续所有 el.editor.* 调用都走门面
  const { facade } = createFtmlEditor({
    parent: el.editorContainer,
    placeholder: '选择或新建一个文件开始编辑…',
  });
  el.editor = facade;

  el.fileSelect.addEventListener('change', () => {
    if (el.fileSelect.value) openFile(el.fileSelect.value);
  });

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

  el.saveBtn.addEventListener('click', () => {
    if (!state.projectId || !state.filePath) {
      setError('请先打开一个文件');
      return;
    }
    clearTimeout(state.saveTimer);
    render();
  });

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

  // ---------------- 校验 ----------------
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

  // ---------------- 部署 ----------------
  // deploy = 创建大版本 + 推送远端 + 发布 Wikidot + 一次 submit，与 submit 一样必须填 message
  el.deployBtn.addEventListener('click', async () => {
    if (!state.projectId || !state.filePath) return;
    const site = el.siteInput.value.trim();
    const page = el.pageInput.value.trim();
    if (!site || !page) {
      setError('部署前请先填写站点与页面');
      return;
    }
    const message = await openPromptDialog({
      title: '部署（创建大版本）',
      label: '提交说明（必填，写入 git commit 与版本记录）',
      placeholder: '如：发布 v1 正式版',
      okText: '部署',
    });
    if (!message) return;
    try {
      await persistEditor();
      setStatus('部署中…');
      const r = await api('POST', `/api/projects/${encodeURIComponent(state.projectId)}/deploy`, {
        path: state.filePath, site, page, message,
      });
      showLog('部署输出', r.logs);
      setStatus('部署完成（' + fmtTime() + '）');
    } catch (e) {
      setError(e.message);
      showLog('部署失败', [ { kind: 'error', msg: e.message } ]);
    }
  });

  // ---------------- 新建模板 / 组件 / 源文件 ----------------
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
}
