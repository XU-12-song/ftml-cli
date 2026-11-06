/**
 * versions.ts — 版本清单（大版本 / 小版本）的数据结构
 */

/** @description 大版本记录（对应一次 git commit + tag） */
export interface MajorVersionEntry {
  /** 大版本号（数字字符串） */
  version: string;
  /** 对应的 git 提交 */
  commit: string;
  /** git tag，未创建时为 null */
  tag: string | null;
  /** 版本说明 */
  message: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
  /** 创建时线上（Wikidot）的修订号 */
  wikidotVersion: number | null;
}

/** @description 小版本记录（归属最近一次大版本） */
export interface MinorVersionEntry {
  /** 小版本号 `x.y` */
  version: string;
  /** 所属大版本号 */
  major: string;
  /** 对应的 git 提交 */
  commit: string;
  /** 版本说明 */
  message: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
}

/** @description 版本清单文件内容 */
export interface VersionsData {
  major: MajorVersionEntry[];
  minor: MinorVersionEntry[];
}

/** @description 版本类型 */
export type VersionKind = "major" | "minor";

/** @description 展示用版本行（新版本在前） */
export interface VersionRow {
  version: string;
  kind: VersionKind;
  /** 所属大版本号（大版本行即自身） */
  major: string;
  commit: string;
  message: string;
  createdAt: string;
  wikidotVersion: number | null;
}

/** @description 追加小版本所需信息 */
export interface AddMinorInput {
  commit: string;
  message?: string;
}

/** @description 追加大版本所需信息 */
export interface AddMajorInput {
  commit: string;
  message?: string;
  tag?: string | null;
  wikidotVersion?: number | null;
}

/** @description 下一个待创建的小版本号及其所属大版本 */
export interface MinorVersionPointer {
  version: string;
  major: string;
}

interface VersionTargetBase {
  /** 本地回退目标提交 */
  commit: string;
  /** 线上回退目标提交 */
  remoteCommit: string;
  /** 线上回退目标版本号 */
  remoteVersion: string;
}

/** @description 回退目标：大版本 */
export interface MajorVersionTarget extends VersionTargetBase {
  kind: "major";
  entry: MajorVersionEntry;
}

/** @description 回退目标：小版本 */
export interface MinorVersionTarget extends VersionTargetBase {
  kind: "minor";
  entry: MinorVersionEntry;
}

/** @description 版本号解析出的回退目标 */
export type VersionTarget = MajorVersionTarget | MinorVersionTarget;
