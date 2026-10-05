/**
 * autocomplete.js — 编辑器自动补全
 *
 * 触发场景（detectTrigger）：
 *   1. [[component src="  → 组件文件路径
 *   2. [[name 已输入键…   → 模板声明键 / 内置标签属性 / module 模块名
 *   3. [[前缀             → 模板名（优先）+ 内置 Wikidot 标签
 *   4. 裸单词             → 自定义 snippet 前缀、comp./tmpl. 命名空间、组件/模板名
 */
import { $, el, state } from './dom.js';
import { WIKI_MODULES, WIKI_DEFS, WIKI_BY_NAME, wikiItem } from './wiki.js';
import { scheduleSaveRender } from './preview.js';

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

  // ===== 自定义 snippets + 直接输入名字补全（实时候选列表） =====
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
    const named = [];
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

export function updateAutocomplete() {
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
  const { x, y, lineHeight } = el.editor.coordsAtCaret();
  const mainRect = $('main').getBoundingClientRect();
  const edRect = el.editor.getBoundingClientRect();
  const left = edRect.left - mainRect.left + x + 4;
  const top = edRect.top - mainRect.top + y + lineHeight + 4;
  el.autocomplete.style.left = Math.max(4, left) + 'px';
  el.autocomplete.style.top = top + 'px';
}

export function hideAutocomplete() {
  state.ac = null;
  el.autocomplete.classList.add('hidden');
}

export function pickAutocomplete(idx) {
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

export function handleAcKeydown(e) {
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
