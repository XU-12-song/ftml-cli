/**
 * handlers/versions.js — 版本清单 + 提交 / 部署 / 回退 / 初始化
 *
 * submit/deploy/revert 复用 CLI 命令，用 captureLogs 把进度回传前端；
 * web 侧路径一律先按项目根解析（底层命令对相对 source 是相对 cwd 解析的）。
 */

import path from 'node:path';

import { submit } from '../../commands/submit.js';
import { deploy } from '../../commands/deploy.js';
import { revert } from '../../commands/revert.js';
import { init } from '../../commands/init.js';
import { listVersions, nextMajorVersion, nextMinorVersion } from '../../domain/versions.js';
import { captureLogs, findProject } from './shared.js';
import type { HandlerEnv } from '../../types/web/handlers/shared.ts';
import type {
  ProjectVersionsResult,
  VersionActionBody,
  VersionActionResult,
} from '../../types/web/handlers/versions.ts';

export function listProjectVersions(id: string): ProjectVersionsResult {
  const p = findProject(id);
  return {
    versions: listVersions(p.root),
    next: {
      major: nextMajorVersion(p.root),
      minor: nextMinorVersion(p.root).version,
    },
  };
}

/** 提交小版本：本地 git commit + 小版本号递增，不联网、不发布（发布走 deploy） */
export async function submitProject(id: string, body: VersionActionBody): Promise<VersionActionResult> {
  const p = findProject(id);
  const rel = body?.source || body?.path;
  const source = rel ? path.resolve(p.root, rel) : undefined;
  const { logs } = await captureLogs(() =>
    submit({
      root: p.root,
      source,
      site: body?.site,
      page: body?.page,
      message: body?.message,
      noBuild: body?.noBuild,
    })
  );
  return { ok: true, logs };
}

export async function deployProject(
  id: string,
  body: VersionActionBody,
  env: HandlerEnv = {},
): Promise<VersionActionResult> {
  const p = findProject(id);
  const rel = body?.source || body?.path;
  const source = rel ? path.resolve(p.root, rel) : undefined;
  const { logs } = await captureLogs(() =>
    deploy({
      root: p.root,
      source,
      site: body?.site,
      page: body?.page,
      message: body?.message,
      noValidate: body?.noValidate,
      clientFactory: env.injectClient ? () => env.injectClient! : undefined,
    })
  );
  return { ok: true, logs };
}

export async function revertProject(
  id: string,
  body: VersionActionBody,
  env: HandlerEnv = {},
): Promise<VersionActionResult> {
  const p = findProject(id);
  const rel = body?.source || body?.path;
  const source = rel ? path.resolve(p.root, rel) : undefined;
  const { logs } = await captureLogs(() =>
    revert({
      root: p.root,
      source,
      site: body?.site,
      page: body?.page,
      to: body?.to || 'HEAD',
      noWikidot: !!body?.noWikidot,
      autoCommit: true, // web 自动保存导致工作区常脏
      rebuild: true,    // dist/ 被 gitignore，git revert 后重建产物再回推
      clientFactory: env.injectClient ? () => env.injectClient! : undefined,
    })
  );
  return { ok: true, logs };
}

export async function initProject(id: string): Promise<VersionActionResult> {
  const p = findProject(id);
  const { logs } = await captureLogs(() => init({ cwd: p.root }));
  return { ok: true, logs };
}
