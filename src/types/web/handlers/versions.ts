/**
 * versions.ts — 版本清单与提交/部署/回退 API 的类型
 */

import type { VersionRow } from '../../domain/versions.ts';
import type { CapturedLog } from './shared.ts';

/** 提交/部署/回退共用的请求体 */
export interface VersionActionBody {
  source?: string;
  path?: string;
  site?: string;
  page?: string;
  message?: string;
  /** submit 的 --no-build */
  noBuild?: boolean;
  /** deploy 的 --no-validate */
  noValidate?: boolean;
  /** revert 的 --no-wikidot */
  noWikidot?: boolean;
  /** revert 的目标版本号 / git 修订 */
  to?: string;
}

/** 版本清单返回值 */
export interface ProjectVersionsResult {
  versions: VersionRow[];
}

/** 提交/部署/回退/初始化的返回值 */
export interface VersionActionResult {
  ok: true;
  logs: CapturedLog[];
}
