/**
 * inline-scope.js — 规则 close-inline-at-block-end（见 divergence.js:
 * inline-scope-cross-block）
 *
 * 不变量 C：每个行内标签都在其所属块内被显式闭合。
 *
 * 为什么用词法记号而不是正则或 wdpr 诊断：
 *  - 正则无法正确跳过 [[code]]、引号、注释里的伪标签；
 *  - wdpr 诊断在大文件上存在 position↔offset 漂移（见分歧表 bug 条目），
 *    且 #78 的假诊断本身就是我们要绕开的现象。
 * 词法器（tokenize）是 context-free、线性、位置可靠的，正好用来做标签配对。
 *
 * 实现：扫描 [[name ...]] / [[/name]] 记号，维护嵌套栈。
 *  - 块闭标签到来时，位于其上方仍未闭合的【行内】标签 → 在该闭标签前
 *    按最内层优先补上闭合标签（这正是真实文件里实证有效的修复）。
 *  - 未闭合的【块】标签不自动补（那是真实结构错误，只报告不静默改写）。
 *  - 无匹配开标签的游离闭标签不删除，只报告。
 * 只增不删 ⇒ 转换幂等。
 */

import { tokenize } from '@wdprlib/parser';
import { INLINE_TAGS } from './divergence.js';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** offset → {line, column}（1 基） */
function makeLocator(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') starts.push(i + 1);
  }
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };
}

/**
 * 从记号流提取元素开/闭事件（含精确 offset）。
 * 开标签：BLOCK_OPEN ... BLOCK_CLOSE（按嵌套深度找配对的 BLOCK_CLOSE，
 *   名字取深度 1 处的首个 IDENTIFIER；这样 [[span style="x"]] 与
 *   值内含 [[...]] 的标签都能正确取界）。
 * 闭标签：BLOCK_END_OPEN IDENTIFIER BLOCK_CLOSE。
 */
export function elementEvents(tokens) {
  const events = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    if (t.type === 'BLOCK_OPEN') {
      let depth = 1;
      let j = i + 1;
      let name = null;
      while (j < tokens.length && depth > 0) {
        const u = tokens[j];
        if (u.type === 'BLOCK_OPEN') depth++;
        else if (u.type === 'BLOCK_CLOSE') depth--;
        else if (depth === 1 && name === null && u.type === 'IDENTIFIER') name = u.value;
        j++;
      }
      if (depth !== 0) break; // 记号流不完整（源本身残缺）→ 停止
      if (name && NAME_RE.test(name)) {
        events.push({
          kind: 'open',
          name,
          start: t.position.start.offset,
          end: tokens[j - 1].position.end.offset,
        });
      }
      i = j;
      continue;
    }

    if (t.type === 'BLOCK_END_OPEN') {
      let j = i + 1;
      let name = null;
      while (j < tokens.length && tokens[j].type !== 'BLOCK_CLOSE') {
        if (name === null && tokens[j].type === 'IDENTIFIER') name = tokens[j].value;
        j++;
      }
      if (j < tokens.length && name && NAME_RE.test(name)) {
        events.push({
          kind: 'close',
          name,
          start: t.position.start.offset,
          end: tokens[j].position.end.offset,
        });
      }
      i = j + 1;
      continue;
    }

    i++;
  }
  return events;
}

/**
 * 强制不变量 C。
 *
 * @param {string} src 源码
 * @param {{ inlineTags?: Set<string> }} [opts]
 * @returns {{ src: string, changes: Array, diagnostics: Array }}
 *   changes: 每次插入闭合标签的记录（含原坐标系 line/column）
 *   diagnostics: 未闭合块 / 游离闭标签的警告（wdpr Diagnostic 形状）
 */
export function enforceInlineScope(src, { inlineTags = INLINE_TAGS } = {}) {
  const locate = makeLocator(src);
  const events = elementEvents(tokenize(src));
  const stack = [];
  const changes = [];
  const diagnostics = [];
  /** offset -> 待插入的闭合标签（最内层在前） */
  const insertions = new Map();

  const noteUnclosed = (frame, reason) => {
    const loc = locate(frame.start);
    diagnostics.push({
      severity: 'warning',
      code: 'unclosed-block',
      message: `[[${frame.name}]] ${reason}`,
      position: {
        start: { ...loc, offset: frame.start },
        end: { ...loc, offset: frame.start },
      },
    });
  };

  const queueClose = (frame, atOffset) => {
    const arr = insertions.get(atOffset) ?? [];
    arr.push(frame.name);
    insertions.set(atOffset, arr);
    const loc = locate(atOffset);
    changes.push({
      rule: 'close-inline-at-block-end',
      action: 'close-inline',
      tag: frame.name,
      offset: atOffset,
      line: loc.line,
      column: loc.column,
    });
  };

  for (const ev of events) {
    if (ev.kind === 'open') {
      stack.push({ name: ev.name, inline: inlineTags.has(ev.name), start: ev.start });
      continue;
    }

    // 闭标签：找最近的同名开标签
    let k = -1;
    for (let p = stack.length - 1; p >= 0; p--) {
      if (stack[p].name === ev.name) {
        k = p;
        break;
      }
    }
    if (k === -1) {
      const loc = locate(ev.start);
      diagnostics.push({
        severity: 'warning',
        code: 'stray-inline-close',
        message: `闭合标签 [[/${ev.name}]] 没有匹配的开标签`,
        position: {
          start: { ...loc, offset: ev.start },
          end: { ...loc, offset: ev.start },
        },
      });
      continue;
    }

    const crossing = stack.splice(k); // 匹配到的开标签及其上方全部
    const matched = crossing.shift();
    // 同一点插入时最内层先闭 → crossing 末端（最内层）先产出
    for (let p = crossing.length - 1; p >= 0; p--) {
      const f = crossing[p];
      if (f.inline) queueClose(f, ev.start);
      else noteUnclosed(f, `在 [[/${matched.name}]] 之前仍未闭合`);
    }
  }

  // 文件末尾仍开着的：行内补闭，块只报告
  for (let p = stack.length - 1; p >= 0; p--) {
    const f = stack[p];
    if (f.inline) queueClose(f, src.length);
    else noteUnclosed(f, '未闭合');
  }

  // 从后往前落盘，避免 offset 位移
  let out = src;
  for (const off of [...insertions.keys()].sort((a, b) => b - a)) {
    const text = insertions.get(off).map((name) => `[[/${name}]]`).join('');
    out = out.slice(0, off) + text + out.slice(off);
  }

  return { src: out, changes, diagnostics };
}
