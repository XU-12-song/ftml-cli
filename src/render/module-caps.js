/**
 * module-caps.js — 真实解析 module 时的抓取上限
 *
 * 一次性真实解析是用户显式触发、允许较慢的操作，但仍必须有硬上限，
 * 防止 ListPages 在大站点上翻页 / 逐页取源码把预览拖死。
 */
export const DEFAULT_MODULE_CAPS = Object.freeze({
  /** ListPages 单次最多渲染多少行 */
  listPagesMaxRows: 20,
  /** 需要正文时最多补取多少页源码 */
  listPagesSourceMax: 5,
  /** TagCloud 最多取多少个标签 */
  tagCloudMaxTags: 50,
});
