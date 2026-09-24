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

export function showDiagnostics(diags) {
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warnings = diags.filter((d) => d.severity !== 'error').length;
  el.statusDiag.textContent =
    diags.length === 0 ? '' : `渲染: ${errors} 错误 / ${warnings} 警告`;
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
