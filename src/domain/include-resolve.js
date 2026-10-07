/**
 * include-resolve.js — [[include]] pageRef → 本地镜像文件
 *
 * 本地镜像按「页面全名 ↔ 文件路径」一一对应：`component:box` → `component/box.ftml`。
 * 渲染（preview）与发布（publish）共用同一套候选规则，避免「预览能解析、发布解析不到」
 * 这类口径漂移。纯路径逻辑，不依赖 parser/render。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 把 include 的 pageRef 解析为本地 .ftml 文件。
 *
 * 候选路径（按顺序，以 baseDir 为基准）：
 *   同站 include：
 *     1. page 中的 `:` 换成 `/`：`component:box` → `component/box.ftml`
 *     2. 原样：`component:box` → `component:box.ftml`
 *   跨站 include（site ≠ 当前站点）：按本地镜像解析
 *     1. `<site>/<page 斜杠化>`：`:scp-wiki-cn:theme:parallel` → `scp-wiki-cn/theme/parallel.ftml`
 *     2. `<site>/<page 原样>` → `scp-wiki-cn/theme:parallel.ftml`
 *     3. `<page 斜杠化>`（主题等常见镜像布局）：→ `theme/parallel.ftml`
 *     4. `<page 原样>` → `theme:parallel.ftml`
 *
 * 解析结果限制在 baseDir 内，拒绝 `../` 越界；找不到返回 null（渲染为"页面不存在"占位）。
 *
 * @param {{ site: string|null, page: string }} pageRef
 * @param {string} baseDir 基准目录（镜像根）
 * @param {string} [currentSite] 当前页面所属站点，用于判断是否跨站
 * @returns {string|null} 文件绝对路径，找不到返回 null
 */
export function resolveIncludeFile(pageRef, baseDir, currentSite) {
  const { site, page } = pageRef;
  const slashRef = page.replaceAll(':', '/');
  const crossSite = Boolean(site) && site !== currentSite;
  const candidates = crossSite
    ? [
      path.join(baseDir, site, `${slashRef}.ftml`),
      path.join(baseDir, site, `${page}.ftml`),
      path.join(baseDir, `${slashRef}.ftml`),
      path.join(baseDir, `${page}.ftml`),
    ]
    : [
      path.join(baseDir, `${slashRef}.ftml`),
      path.join(baseDir, `${page}.ftml`),
    ];
  for (const p of candidates) {
    const abs = path.resolve(p);
    if (!abs.startsWith(path.resolve(baseDir) + path.sep) && abs !== path.resolve(baseDir)) {
      continue; // 越界路径跳过（防御 page 名含 ../）
    }
    if (existsSync(abs)) return abs;
  }
  return null;
}
