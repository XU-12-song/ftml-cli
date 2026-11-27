/**
 * publish-state.ts — 部署发布状态（.ftml/publish-state.json）
 *
 * 记录「每个页面最后一次成功发布的源码 hash + 线上修订号」。部署时按
 * 最终提交源码 hash + 预取到的远程 revision 判断：两者都与记录一致说明
 * 线上就是这版内容，跳过 edit（ Wikidot edit 不更新 Page.revisionsCount，
 * 盲目重发既慢又制造无意义修订）。
 *
 * 文件只作为加速缓存：损坏 / 版本不符 / 临时目录缺失时一律视为空记录，
 * 最多退化为「全量重新发布」，不影响正确性。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { PublishState, PublishStatePage } from '../types/infra/publish-state.ts';

/** publish-state.json 路径（项目根 .ftml/ 下） */
export function publishStatePath(root: string): string {
  return path.join(root, '.ftml', 'publish-state.json');
}

/** 读取发布状态；文件缺失 / 损坏 / 版本不符时返回空记录 */
export function loadPublishState(root: string): PublishState {
  try {
    const data = JSON.parse(fs.readFileSync(publishStatePath(root), 'utf8')) as PublishState;
    if (data && data.version === 1 && data.pages && typeof data.pages === 'object') {
      return data;
    }
  } catch {
    /* 不存在或损坏 → 空记录 */
  }
  return { version: 1, pages: {} };
}

/** 写回发布状态（自动建 .ftml/ 目录） */
export function savePublishState(root: string, state: PublishState): void {
  const p = publishStatePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** 发布状态里页面记录的键：`<site>:<page>` */
export function publishStateKey(site: string, page: string): string {
  return `${site}:${page}`;
}

/** 最终提交源码的 hash（sha256 hex） */
export function hashSource(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

/** 判断「预取到的远程页面 + 已记录状态」是否等于要提交的内容（可跳过 edit） */
export function canSkipPublish(
  record: PublishStatePage | undefined,
  remote: { revisionsCount: number } | null | undefined,
  hash: string,
): boolean {
  if (!record || record.hash !== hash) return false;
  if (!remote) return false;
  return remote.revisionsCount === record.revision;
}
