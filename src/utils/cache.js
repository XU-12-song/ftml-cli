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

/** 列出全部缓存的页面条目 [{ site, page, bytes, mtime }] */
export function listPageCache(dir = homeCacheDir()) {
  const out = [];
  let sites;
  try {
    sites = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const s of sites) {
    if (!s.isDirectory()) continue;
    const siteDir = path.join(dir, s.name);
    for (const f of fs.readdirSync(siteDir)) {
      if (!f.endsWith('.ftml')) continue;
      const abs = path.join(siteDir, f);
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      out.push({
        site: s.name,
        page: f.slice(0, -'.ftml'.length).replaceAll('/', ':'),
        bytes: st.size,
        mtime: st.mtime.toISOString(),
      });
    }
  }
  return out.sort((a, b) => a.site.localeCompare(b.site) || a.page.localeCompare(b.page));
}

/** 清空页面源码缓存；返回删除的文件数 */
export function clearPageCache(dir = homeCacheDir()) {
  const n = listPageCache(dir).length;
  fs.rmSync(dir, { recursive: true, force: true });
  return n;
}
