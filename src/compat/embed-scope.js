/**
 * embed-scope.js — 检测 [[embed]]/[[html]] 体内裸露的块闭合记号
 * （见 divergence.js: embed-structural-escape）
 *
 * 现象：真实 Wikidot 分阶段处理源码，[[collapsible]]/[[div]] 等模块先于
 * [[embed]]/内联 HTML 展开。因此出现在 embed 体内的 [[/collapsible]] 会在
 * 前一阶段提前闭合外层折叠块，之后 embed 再吃掉下半截，输出 HTML 比源少一层
 * 嵌套；浏览器向下自动补标签，把 #main-content 降级为 #action-area 的兄弟，
 * 折叠块于是吞掉其后全部内容（含页脚）。
 *
 * 为什么只【告警】不【改写】：
 *  - 该现象依赖服务端处理顺序 + 浏览器 HTML 自动修复，客户端渲染器（wdpr）
 *    单趟解析、无分阶段展开，无法复现；本地预览永远"看起来正常"。
 *  - 有作者把这种逃逸当 hack 用，自动改写源码会破坏页面。
 * 故这里只做静态检测，产出 wdpr 形状的诊断交给渲染期报告。
 *
 * 判定（两种形状）：
 *  1. 块闭标签在 embed/html 体内【找不到配对的开标签】——body 内自带的平衡
 *     标签对（如 [[span]]x[[/span]]）不算逃逸，只有游离闭合才告警。
 *  2. 内联 HTML 开标签在 embed/html 体内被空行截断（如 `<iframe src="␊␊">`）——
 *     空行是 Wikidot 的源码分段边界，被切开的标签同样输出不平衡 HTML。
 */

import { tokenize } from '@wdprlib/parser';
import { elementEvents } from './inline-scope.js';

/** 原样保留 body 的块：其体内的裸闭合记号才可能突破收容 */
export const RAW_CONTAINERS = new Set(['embed', 'embedvideo', 'embedaudio', 'html']);

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
 * 扫描一段文本，找出被空行截断的内联 HTML 开标签。
 *
 * 空行（`\n[ \t]*\n`）是 Wikidot 的源码分段边界；一个开标签在闭合 `>` 之前
 * 跨过空行，会被分段切开，输出不平衡 HTML（见分歧 embed-structural-escape）。
 *
 * @param {string} text 容器 body 文本
 * @param {number} base text 在源中的起始 offset
 * @returns {Array<{start:number,end:number,tag:string}>} 源坐标
 */
function scanBlankLineSplitTags(text, base) {
  const hits = [];
  const blankLineAt = (j) => {
    let k = j + 1;
    while (k < text.length && (text[k] === ' ' || text[k] === '\t' || text[k] === '\r')) k++;
    return text[k] === '\n';
  };
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    if (!/[a-zA-Z]/.test(text[lt + 1] ?? '')) {
      i = lt + 1; // 只看开标签（跳过 </、<!--、<!DOCTYPE 等）
      continue;
    }
    const name = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(text.slice(lt + 1))[0];
    let j = lt + 1;
    let quote = null;
    let splitAt = -1;
    while (j < text.length) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break; // 标签正常闭合，未跨空行
      }
      if (c === '\n' && splitAt === -1 && blankLineAt(j)) splitAt = j;
      j++;
    }
    if (splitAt !== -1) {
      hits.push({ start: base + lt, end: base + Math.min(j + 1, text.length), tag: name });
    }
    i = j < text.length ? j + 1 : text.length;
  }
  return hits;
}

/**
 * 扫描源码，报告可能突破 HTML 收容的块闭合记号或跨空行截断的标签。
 *
 * @param {string} src 已展开的 FTML 源码（与线上提交的同一形态）
 * @param {{ rawContainers?: Set<string> }} [opts]
 * @returns {Array<object>} wdpr 形状的诊断（severity/code/message/position）
 */
export function detectEmbedStructuralEscape(src, { rawContainers = RAW_CONTAINERS } = {}) {
  const locate = makeLocator(src);
  const events = elementEvents(tokenize(src));
  const diagnostics = [];
  /** 当前开着的块栈：{ name, bodyStart } */
  const stack = [];
  /** 已扫描过 body 的容器（bodyStart），避免同一容器重复扫描 */
  const scanned = new Set();
  /** 已告警的空行截断标签起点（源 offset）：嵌套 raw 容器的 body 相互包含，
   *  同一处命中会被内外层各扫一遍，按偏移去重保证只报一次 */
  const warnedAt = new Set();

  const innermostRaw = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (rawContainers.has(stack[i].name)) return stack[i].name;
    }
    return null;
  };

  const warn = (container, closeName, ev) => {
    const start = locate(ev.start);
    const end = locate(ev.end);
    diagnostics.push({
      severity: 'warning',
      code: 'embed-structural-escape',
      message:
        `[[/${closeName}]] 出现在 [[${container}]] 体内且无配对开标签：` +
        `真实 Wikidot 会先用它闭合外层结构，再由 [[${container}]] 吞掉下半截，` +
        `可能导致折叠块吃掉其后内容（见分歧 embed-structural-escape）`,
      position: {
        start: { ...start, offset: ev.start },
        end: { ...end, offset: ev.end },
      },
    });
  };

  /** 扫描某个 raw 容器 body 里被空行截断的标签，逐个告警 */
  const scanBody = (frame, endOffset) => {
    if (scanned.has(frame.bodyStart)) return;
    scanned.add(frame.bodyStart);
    for (const hit of scanBlankLineSplitTags(src.slice(frame.bodyStart, endOffset), frame.bodyStart)) {
      if (warnedAt.has(hit.start)) continue; // 已被更内层容器报过
      warnedAt.add(hit.start);
      const start = locate(hit.start);
      const end = locate(hit.end);
      diagnostics.push({
        severity: 'warning',
        code: 'embed-structural-escape',
        message:
          `<${hit.tag}> 标签在 [[${frame.name}]] 体内被空行截断：` +
          `空行是 Wikidot 的源码分段边界，标签被切开后会输出不平衡 HTML，` +
          `可能破坏页面结构（见分歧 embed-structural-escape）`,
        position: {
          start: { ...start, offset: hit.start },
          end: { ...end, offset: hit.end },
        },
      });
    }
  };

  for (const ev of events) {
    if (ev.kind === 'open') {
      stack.push({ name: ev.name, bodyStart: ev.end });
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
      // 无配对开标签：若身处某个 raw 容器内，它就是在逃逸
      const container = innermostRaw();
      if (container) warn(container, ev.name, ev);
      continue;
    }

    // 将被这个闭标签弹出（含被跨过）的 raw 容器：先扫其 body 里的空行截断标签
    for (let p = stack.length - 1; p >= k; p--) {
      if (rawContainers.has(stack[p].name)) scanBody(stack[p], ev.start);
    }

    // 配对成功：被跨过（未闭合）的帧里若有 raw 容器，说明这个闭标签
    // 关闭的是 raw 容器【之外】的结构 → 逃逸
    for (let p = stack.length - 1; p > k; p--) {
      if (rawContainers.has(stack[p].name)) {
        warn(stack[p].name, ev.name, ev);
        break;
      }
    }
    stack.length = k; // 弹出 匹配帧及其上方全部
  }

  // 收尾：文件结束时仍开着的 raw 容器，body 一直到文件尾
  for (let p = stack.length - 1; p >= 0; p--) {
    if (rawContainers.has(stack[p].name)) scanBody(stack[p], src.length);
  }

  return diagnostics;
}
