/**
 * cache.js — 用户级磁盘缓存（~/.ftml-cli/cache/，跨 ftml 项目共享）
 *
 * 结构：<cache>/<site>/<page 斜杠化>.ftml
 * 当前缓存远程拉取的页面源码（[[include]] 解析的第三级来源）。
 * 目录按站点划分、文件名与 Wikidot 命名空间一致，便于以后增加其它缓存类型。
 */

import fs from 'node:fs';
import path from 'node:path';
import { homeCacheDir } from './paths.js';

/** 缓存文件路径：<site>/<page:→/>.ftml */
export function cacheFilePath(site, page) {
  const slash = page.replaceAll(':', '/');
  return path.join(homeCacheDir(), site, `${slash}.ftml`);
}

/** 读取页面源码缓存；不存在返回 null */
export function readPageCache(site, page) {
  try {
    return fs.readFileSync(cacheFilePath(site, page), 'utf8');
  } catch {
    return null;
  }
}

/** 写入页面源码缓存（自动建目录） */
export function writePageCache(site, page, source) {
  const p = cacheFilePath(site, page);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, source, 'utf8');
}
