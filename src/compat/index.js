/**
 * compat — 理想 FTML ↔ Wikidot(脏) 双向兼容层
 *
 *   dirtToIdeal(src)  Wikidot 脏源码 → 理想 FTML（导入/远程拉取后规范化）
 *   idealToDirt(src)  理想 FTML     → Wikidot 兼容源码（部署/提交前保证可解析）
 *
 * 两个方向共用同一条不变量 C（见 inline-scope.js）：行内标签必须在所属块内
 * 显式闭合。区别只在语义定位：
 *   dirt→ideal 修复 Wikidot 宽松语法留下的未闭合行内标签；
 *   ideal→dirt 对一个本应已满足 C 的理想源做防御性保证（合法输入上是恒等变换）。
 *
 * 后续新增分歧时：先在 divergence.js 登记，再在此处按 rule id 挂上实现。
 */

import { enforceInlineScope } from './inline-scope.js';
import { DIRECTION } from './divergence.js';

export * from './divergence.js';
export { detectEmbedStructuralEscape, RAW_CONTAINERS } from './embed-scope.js';

/**
 * @param {string} src
 * @param {string} direction DIRECTION.*
 * @param {object} [opts] 透传给规则（如 inlineTags）
 * @returns {{ src, changed, direction, changes, diagnostics }}
 */
function normalize(src, direction, opts) {
  const r = enforceInlineScope(src, opts);
  return {
    src: r.src,
    changed: r.src !== src,
    direction,
    changes: r.changes.map((c) => ({ ...c, direction })),
    diagnostics: r.diagnostics,
  };
}

/** Wikidot 脏源码 → 理想 FTML */
export function dirtToIdeal(src, opts = {}) {
  return normalize(src, DIRECTION.DIRT_TO_IDEAL, opts);
}

/** 理想 FTML → Wikidot 兼容源码 */
export function idealToDirt(src, opts = {}) {
  return normalize(src, DIRECTION.IDEAL_TO_DIRT, opts);
}
