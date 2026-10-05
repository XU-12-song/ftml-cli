/**
 * mtime-cache.js — 进程内「按修改时间复用」缓存
 *
 * 把「读盘 + 解析/展开」这类昂贵且反复发生的工作摊销掉：只要文件的
 * mtime 与大小没变，就复用上次的结果；文件真被改动就自动失效。
 *
 * 缓存只活在当前进程内（web 服务复用同一进程；CLI 单次运行无影响），
 * 不落盘、不跨进程。命名空间用于隔离不同用途，避免键空间互相污染。
 *
 * 注：mtime 粒度因文件系统而异（ext4 为纳秒，少数为秒级）。极端情况下
 * 同一毫秒内、同大小的原地改写可能漏检；编辑器保存都会推进 mtime，
 * 该情形仅理论存在。需要绝对正确时调用方可传 `extra` 附加失效键。
 */

import fs from 'node:fs';

/** namespace -> Map<absPath, { sig, extra, value }> */
const stores = new Map();

function storeOf(ns, create = true) {
  let s = stores.get(ns);
  if (!s && create) {
    s = new Map();
    stores.set(ns, s);
  }
  return s;
}

/** 文件签名（mtimeMs + size）；文件不存在返回 null */
export function fileSignature(abs) {
  try {
    const st = fs.statSync(abs);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
}

/**
 * 按文件签名复用计算结果。
 *
 * @param {string} ns 命名空间
 * @param {string} abs 文件绝对路径
 * @param {() => any} compute 未命中时的计算（同步）
 * @param {string} [extra] 附加失效键：与缓存记录不一致即作废（如模板表签名）
 * @returns {any} compute 的返回值；文件不存在返回 null
 */
export function memoByFile(ns, abs, compute, extra = '') {
  const sig = fileSignature(abs);
  if (sig === null) {
    storeOf(ns, false)?.delete(abs);
    return null;
  }
  const store = storeOf(ns);
  const hit = store.get(abs);
  if (hit && hit.sig === sig && hit.extra === extra) return hit.value;
  const value = compute();
  store.set(abs, { sig, extra, value });
  return value;
}

/** 清空缓存：传入命名空间只清该用途，省略则全清（测试/诊断用） */
export function clearMtimeCache(ns) {
  if (ns) stores.delete(ns);
  else stores.clear();
}
