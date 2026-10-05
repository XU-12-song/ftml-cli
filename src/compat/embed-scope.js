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
 * 判定：仅当某个块闭标签在 embed/html 体内【找不到配对的开标签】时告警——
 * body 内自带的平衡标签对（如 [[span]]x[[/span]]）不算逃逸。
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
 * 扫描源码，报告可能突破 HTML 收容的块闭合记号。
 *
 * @param {string} src 已展开的 FTML 源码（与线上提交的同一形态）
 * @param {{ rawContainers?: Set<string> }} [opts]
 * @returns {Array<object>} wdpr 形状的诊断（severity/code/message/position）
 */
export function detectEmbedStructuralEscape(src, { rawContainers = RAW_CONTAINERS } = {}) {
  const locate = makeLocator(src);
  const events = elementEvents(tokenize(src));
  const diagnostics = [];
  /** 当前开着的块栈（仅名字） */
  const stack = [];

  const innermostRaw = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (rawContainers.has(stack[i])) return stack[i];
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

  for (const ev of events) {
    if (ev.kind === 'open') {
      stack.push(ev.name);
      continue;
    }

    // 闭标签：找最近的同名开标签
    let k = -1;
    for (let p = stack.length - 1; p >= 0; p--) {
      if (stack[p] === ev.name) {
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

    // 配对成功：被跨过（未闭合）的帧里若有 raw 容器，说明这个闭标签
    // 关闭的是 raw 容器【之外】的结构 → 逃逸
    for (let p = stack.length - 1; p > k; p--) {
      if (rawContainers.has(stack[p])) {
        warn(stack[p], ev.name, ev);
        break;
      }
    }
    stack.length = k; // 弹出 匹配帧及其上方全部
  }

  return diagnostics;
}
