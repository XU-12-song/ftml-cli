/**
 * publish.ts — 发布依赖闭包：把入口页 `[[include]]` 到的**本地镜像页**一并发布
 *
 * 背景：Wikidot 的 `[[include X]]` 在渲染时按**页面全名**去站上找页面 X。本地项目里
 * X 往往以路径镜像存放（`components/box` ↔ `components/box.ftml`），线上全名却是冒号
 * 形式（`components:box`）。所以发布要做两件事：
 *
 *   1. **重写引用名**：把入口（以及各依赖）里的 `[[include 本地名]]` 改成线上全名，
 *      线上才能解析——`remotePageName()` 负责 `/` → `:` 归一。
 *   2. **带上依赖**：入口引用到的本地页必须一起发布，否则线上依然是「页面不存在」占位。
 *      递归收集传递依赖，**叶子在前**（先建被引用的页，再建引用者）。
 *
 * 只收集**本地镜像页**（`resolveIncludeFile` 命中，即项目目录内的 .ftml）。命中
 * cache/remote/miss 的引用属于别处维护的页面，不重复发布——所以这里的闭包天然
 * 就是「这个项目该负责的页面集合」。
 *
 * 重写也只对「指向本地镜像页」的引用生效：Wikidot 页面名允许含 `/`，若对
 * 纯远程引用blindly 做 `/` → `:`，反而会把别人已有的页面名改坏。本地镜像的
 * 名字↔路径对应关系才是我们确知的口径。
 *
 * 依赖页**不**改成绝对 `:site:` 写法：那些页是给别人复用的，改写会破坏别人的本地
 * 镜像；只做 `/` → `:` 归一（对合法页面名是恒等变换，只有路径形式的引用会被修正）。
 *
 * 本模块是纯逻辑（读盘 + 展开，不联网），真正的上传在 infra/wikidot.js。
 */

import fs from 'node:fs';
import path from 'node:path';
import { expand, loadTemplates } from '../core/expand.ts';
import { resolveIncludeFile } from './include-resolve.ts';
import { scanIncludeRefs, canonicalTarget, rewriteIncludeRefs } from './include-refs.ts';
import type { AbsolutePath, SourceText } from '../types/common.ts';
import type {
  BuildPublishPlanOptions,
  PublishConflict,
  PublishPage,
  PublishPlan,
} from '../types/domain/publish.ts';

/**
 * 收集发布计划。
 *
 * @param opts.entrySource 入口构建产物（已展开模板/组件）
 * @param opts.entryDir 镜像根（= 入口源文件所在目录），所有 include 都相对它解析
 * @param opts.currentSite 当前站点名，用于判断同站/跨站
 * @param opts.entryName 入口页的线上全名；若依赖重名会记冲突（防依赖覆盖入口）
 * @param opts.templatesDir 模板目录（未传 templates 时按它加载）
 * @param opts.templates 已加载的模板表（复用以免重复读盘）
 */
export async function buildPublishPlan({
  entrySource,
  entryDir,
  currentSite,
  entryName,
  templatesDir,
  templates,
}: BuildPublishPlanOptions): Promise<PublishPlan> {
  const tpl = templates ?? (await loadTemplates(templatesDir));
  const rewrites = new Map<string, string>();
  const pages: PublishPage[] = [];
  const conflicts: PublishConflict[] = [];
  const fileToName = new Map<AbsolutePath, string>();
  const nameToFile = new Map<string, AbsolutePath>();

  const walk = (source: SourceText): void => {
    for (const ref of scanIncludeRefs(source)) {
      // 先判本地镜像命中——只有它是「我们确知名字↔路径」的引用，才敢动引用名。
      // 纯远程引用（Wikidot 页面名允许含 `/`）blindly 归一反而会改坏别人的页名。
      const file = resolveIncludeFile(ref, entryDir, currentSite);
      if (!file) continue; // 非本地镜像页（远程/缓存/缺失）：归属别人，不发布也不改写
      const abs = path.resolve(file);

      const name = canonicalTarget(ref, currentSite);
      if (ref.target !== name) rewrites.set(ref.target, name);

      // 同一文件被两种引用名指到（如 `:s:p:q` 与同站的 `s:p:q`）：线上到底是哪个页面说不清
      const seenName = fileToName.get(abs);
      if (seenName !== undefined) {
        if (seenName !== name) {
          conflicts.push({ kind: 'file-alias', file: abs, names: [seenName, name] });
        }
        continue;
      }
      // 两个不同文件要发布成同一个线上页面名：后一个会覆盖前一个
      const seenFile = nameToFile.get(name);
      if (seenFile !== undefined && seenFile !== abs) {
        conflicts.push({ kind: 'name-clash', name, files: [seenFile, abs] });
        continue;
      }
      if (entryName && name === entryName) {
        conflicts.push({ kind: 'entry-cycle', name, file: abs });
        continue;
      }

      fileToName.set(abs, name);
      nameToFile.set(name, abs);
      const built = expand(fs.readFileSync(abs, 'utf8'), tpl, { baseDir: path.dirname(abs) });
      walk(built); // 先递归，保证 pages 里被引用者排在引用者之前
      pages.push({ name, file: abs, source: built });
    }
  };

  walk(String(entrySource ?? ''));
  return {
    entry: rewriteIncludeRefs(String(entrySource ?? ''), rewrites),
    pages,
    rewrites,
    conflicts,
  };
}

/** 把依赖页源码按计划重写引用名（与 entry 同一张映射表） */
export function rewriteDepSource(plan: PublishPlan, source: SourceText): SourceText {
  return rewriteIncludeRefs(source, plan.rewrites);
}

/** 冲突转成可读的多行文本，供 CLI 报错 */
export function describeConflicts(conflicts: readonly PublishConflict[]): string {
  return conflicts.map(describeConflict).join('\n');
}

function describeConflict(conflict: PublishConflict): string {
  switch (conflict.kind) {
    case 'file-alias':
      return `· 同一文件被两种引用名指到：${conflict.names.join(' / ')} ← ${conflict.file}`;
    case 'name-clash':
      return `· 两个文件要发布成同一个页面名 ${conflict.name}：${conflict.files.join(' / ')}`;
    case 'entry-cycle':
      return `· 依赖页名与入口页重名：${conflict.name} ← ${conflict.file}`;
  }
}
