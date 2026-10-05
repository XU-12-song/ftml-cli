/**
 * palette.js — Ctrl+K 命令面板：模糊过滤 / 键盘导航 / 分组 / 置灰
 *
 * 零依赖：数据来自 commands.js 的 COMMANDS；不可用命令仍展示但置灰，
 * 让用户看得到功能与前置条件（如未打开文件时的「保存并渲染」）。
 */
import { el } from './dom.js';
import { COMMANDS } from './commands.js';
import { setError } from './api.js';

let items = [];    // 当前可见命令 [{ c, disabled, score }]
let selected = -1; // items 中的索引

/** 命令是否可用（enabled 抛错视为不可用，避免面板整体挂掉） */
function isDisabled(c) {
  if (!c.enabled) return false;
  try { return !c.enabled(); } catch { return true; }
}

function resolvedTitle(c) {
  return typeof c.title === 'function' ? c.title() : c.title;
}

/**
 * 子序列模糊匹配：query 的字符须按序出现在 text 中。
 * 返回 -1 表示不匹配；分数越高越靠前（连续命中、词首命中加分）。
 */
function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = (text || '').toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += streak + (ti === 0 ? 3 : 0);
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : -1;
}

/** 过滤 + 排序：空查询保持注册顺序；有查询则按分数（可用者优先） */
function compute(query) {
  if (!query) return COMMANDS.map((c) => ({ c, disabled: isDisabled(c), score: 0 }));
  const out = [];
  for (const c of COMMANDS) {
    const s = Math.max(
      fuzzyScore(query, resolvedTitle(c)),
      fuzzyScore(query, c.keywords) - 2,
      fuzzyScore(query, c.group) - 4,
    );
    if (s >= 0) out.push({ c, disabled: isDisabled(c), score: s });
  }
  out.sort((a, b) => (a.disabled - b.disabled) || (b.score - a.score));
  return out;
}

function firstEnabled() {
  return items.findIndex((it) => !it.disabled);
}

function move(dir) {
  if (!items.length) return;
  let i = selected;
  for (let n = 0; n < items.length; n++) {
    i = (i + dir + items.length) % items.length;
    if (!items[i].disabled) { selected = i; break; }
  }
  paintSelection();
}

function paintSelection() {
  const lis = el.paletteList.querySelectorAll('.palette-item');
  lis.forEach((li) => li.classList.toggle('sel', Number(li.dataset.index) === selected));
  lis[selected]?.scrollIntoView({ block: 'nearest' });
}

function render() {
  el.paletteList.innerHTML = '';
  const grouped = !el.paletteInput.value.trim();
  let lastGroup = null;
  items.forEach((it, i) => {
    const group = it.c.group;
    if (grouped && group !== lastGroup) {
      lastGroup = group;
      const head = document.createElement('li');
      head.className = 'palette-group';
      head.textContent = group;
      el.paletteList.appendChild(head);
    }
    const li = document.createElement('li');
    li.className = 'palette-item';
    li.dataset.index = String(i);
    if (it.disabled) li.classList.add('disabled');

    const title = document.createElement('span');
    title.className = 'palette-title';
    title.textContent = resolvedTitle(it.c);
    li.appendChild(title);

    // 快捷键常显（置灰项也显示，便于先记住键位）
    if (it.c.key) {
      const k = document.createElement('span');
      k.className = 'palette-key';
      k.textContent = it.c.key;
      li.appendChild(k);
    }
    if (it.disabled) {
      const note = document.createElement('span');
      note.className = 'palette-note';
      note.textContent = '不可用';
      li.appendChild(note);
    }

    if (!it.disabled) li.addEventListener('click', () => runAt(i));
    el.paletteList.appendChild(li);
  });

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'palette-empty';
    empty.textContent = '没有匹配的命令';
    el.paletteList.appendChild(empty);
  }
  paintSelection();
}

function update(query) {
  items = compute(query);
  selected = firstEnabled();
  render();
}

async function runAt(i) {
  const it = items[i];
  if (!it || it.disabled) return;
  el.paletteDialog.close();
  try {
    await it.c.run();
  } catch (e) {
    setError(e.message);
  }
}

export function openPalette() {
  if (!el.paletteDialog || el.paletteDialog.open) return;
  el.paletteInput.value = '';
  update('');
  el.paletteDialog.showModal();
  el.paletteInput.focus();
}

function onKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
  if (e.key === 'Enter') { e.preventDefault(); runAt(selected); return; }
  if (e.key === 'Tab') e.preventDefault(); // 焦点留在输入框
}

export function initPalette() {
  el.paletteBtn?.addEventListener('click', openPalette);
  el.paletteInput?.addEventListener('input', () => update(el.paletteInput.value));
  el.paletteInput?.addEventListener('keydown', onKey);
  // 点按对话框外的遮罩区域关闭
  el.paletteDialog?.addEventListener('click', (e) => {
    if (e.target === el.paletteDialog) el.paletteDialog.close();
  });

  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key !== 'k' && e.key !== 'K') return;
    // 其它弹窗打开时让位（面板自身除外，Ctrl+K 在面板里是关闭）
    const open = document.querySelector('dialog[open]');
    if (open && open !== el.paletteDialog) return;
    e.preventDefault();
    if (el.paletteDialog.open) el.paletteDialog.close();
    else openPalette();
  });
}
