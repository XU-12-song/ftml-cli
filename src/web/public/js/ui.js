/**
 * ui.js — 侧边栏列表 / 高亮 / 诊断与 include 摘要等展示工具
 */
import { el, state } from './dom.js';

/**
 * 渲染侧边栏列表。
 * label/sub 由调用方决定显示文本与次要说明；openPath 计算点击打开的文件相对路径，
 * onOpen 为实际打开函数（由 editor 注入，避免 ui 反向依赖 editor）。
 */
export function renderList(ul, items, label, sub, openPath, onOpen) {
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
    li.addEventListener('click', () => onOpen(target));
    ul.appendChild(li);
  }
}

export function highlightActive() {
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

export function showDiagnostics(diags, report = '', problems = null) {
  const list = problems ?? diags ?? [];
  const errors = list.filter((p) => p.severity === 'error').length;
  const warnings = list.filter((p) => p.severity !== 'error' && p.severity !== 'info').length;
  const infos = list.filter((p) => p.severity === 'info').length;

  if (list.length === 0) {
    el.statusDiag.textContent = '';
    el.statusDiag.title = '';
    el.statusDiag.classList.remove('has-error', 'has-warning');
    return;
  }
  const parts = [];
  if (errors) parts.push(`${errors} 错误`);
  if (warnings) parts.push(`${warnings} 警告`);
  if (infos) parts.push(`${infos} 信息`);
  el.statusDiag.textContent = `渲染: ${parts.join(' / ')}`;
  // 悬停查看带源码上下文的 wdpr 诊断详情；点击打开问题列表
  el.statusDiag.title = report || '点击查看问题列表';
  el.statusDiag.classList.toggle('has-error', errors > 0);
  el.statusDiag.classList.toggle('has-warning', errors === 0 && warnings > 0);
}

const SEV_LABEL = { error: '错误', warning: '警告', info: '信息' };

/** 单条问题 DOM：行:列 + 严重度 + 消息（点击跳转）+ 可展开堆栈 */
function problemItem(p) {
  const li = document.createElement('li');
  li.className = `problem problem-${SEV_LABEL[p.severity] ? p.severity : 'warning'}`;

  const head = document.createElement('div');
  head.className = 'problem-head';

  const pos = p.position?.start;
  const loc = document.createElement('span');
  loc.className = 'problem-loc';
  loc.textContent = pos && Number.isFinite(pos.line) ? `${pos.line}:${pos.column ?? 1}` : '—';
  head.appendChild(loc);

  const sev = document.createElement('span');
  sev.className = 'problem-sev';
  sev.textContent = SEV_LABEL[p.severity] || '警告';
  head.appendChild(sev);

  const msg = document.createElement('span');
  msg.className = 'problem-msg';
  msg.textContent = p.message || '';
  head.appendChild(msg);

  if (p.bundled) {
    const badge = document.createElement('span');
    badge.className = 'problem-badge';
    badge.textContent = '打包';
    badge.title = '该位置映射自 @wdprlib 打包产物，为近似值';
    head.appendChild(badge);
  }
  li.appendChild(head);

  const canJump = pos && Number.isFinite(pos.offset);
  if (canJump) {
    li.classList.add('jumpable');
    li.title = '点击跳转到源码';
    li.addEventListener('click', (e) => {
      if (e.target.closest('details')) return; // 展开堆栈时不要触发跳转
      const from = pos.offset;
      const end = p.position?.end?.offset;
      el.editor.revealRange(from, Number.isFinite(end) ? Math.max(from, end) : from);
    });
  }

  if (p.file) {
    const f = document.createElement('div');
    f.className = 'problem-file';
    f.textContent = p.file;
    li.appendChild(f);
  }

  if (p.stack) {
    const details = document.createElement('details');
    details.className = 'problem-stack';
    const summary = document.createElement('summary');
    summary.textContent = p.bundled ? '堆栈（含打包帧映射）' : '堆栈';
    details.appendChild(summary);
    const pre = document.createElement('pre');
    pre.textContent = p.stack;
    details.appendChild(pre);
    li.appendChild(details);
  }
  return li;
}

/** 渲染统一问题列表（render 结果里的 problems） */
export function renderProblems(problems) {
  state.problems = Array.isArray(problems) ? problems : [];
  el.problemsList.innerHTML = '';
  if (state.problems.length === 0) {
    el.problemsSummary.textContent = '没有渲染问题。';
    return;
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const p of state.problems) {
    const k = SEV_LABEL[p.severity] ? p.severity : 'warning';
    counts[k] += 1;
  }
  const parts = [];
  if (counts.error) parts.push(`${counts.error} 错误`);
  if (counts.warning) parts.push(`${counts.warning} 警告`);
  if (counts.info) parts.push(`${counts.info} 信息`);
  el.problemsSummary.textContent = `${parts.join(' / ')}（点击条目跳转到源码）`;
  for (const p of state.problems) el.problemsList.appendChild(problemItem(p));
}

export function openProblems() {
  if (el.problemsDialog && !el.problemsDialog.open) el.problemsDialog.showModal();
}

if (el.statusDiag) {
  el.statusDiag.addEventListener('click', () => {
    if (state.problems.length) openProblems();
  });
}
if (el.problemsClose) {
  el.problemsClose.addEventListener('click', () => el.problemsDialog.close());
}

/** include 来源摘要：本地文件 / 磁盘缓存 / 远程拉取 / 未命中 */
export function includeSummary() {
  const inc = state.lastIncludes;
  if (!inc || inc.length === 0) return '';
  const count = (from) => inc.filter((i) => i.from === from).length;
  const parts = [];
  if (count('local')) parts.push(`本地 ${count('local')}`);
  if (count('cache')) parts.push(`缓存 ${count('cache')}`);
  if (count('remote')) parts.push(`远程 ${count('remote')}`);
  if (count('miss')) parts.push(`未命中 ${count('miss')}`);
  return parts.length ? ` · include: ${parts.join(' / ')}` : '';
}
