/**
 * versions.js — 版本清单（大版本 / 小版本）
 *
 * 语义（与 deploy/submit/revert 对应）：
 *   submit  本地 git commit + 递增一个小版本号  x.y
 *   deploy  创建大版本 x（对齐一次 git commit + tag），推送远端，再走一次 submit
 *   revert  按版本号回退：本地 revert 到该版本对应的 git hash，
 *           其中回退到小版本 x.y 时，线上（Wikidot）回到大版本 x 创建时提交的版本
 *
 * 清单文件：<root>/.ftml/versions.json
 *   {
 *     "major": [ { version:"1", commit, tag, message, createdAt, wikidotVersion } ],
 *     "minor": [ { version:"1.1", major:"1", commit, message, createdAt } ]
 *   }
 *
 * 大版本从 1 开始；小版本属于最近一次大版本，编号从 1 递增；
 * 尚未 deploy 过的项目小版本落在 "0" 大版本下（0.1、0.2 …）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { versionsPath } from './paths.js';

const EMPTY = () => ({ major: [], minor: [] });

/**
 * 大版本快照文件：<root>/.ftml/versions/<x>.ftml
 *
 * 内容是该大版本创建时推到线上的构建产物全文。revert 到 x.y 时线上要回到
 * 「大版本 x 创建时提交的版本」，直接读快照最可靠——dist/ 被 gitignore，
 * 无法从 git 历史里取回产物。
 */
export function majorSnapshotPath(root, majorVersion) {
  return path.join(path.dirname(versionsPath(root)), 'versions', `${majorVersion}.ftml`);
}

/** 写入大版本快照 */
export function writeMajorSnapshot(root, majorVersion, source) {
  const p = majorSnapshotPath(root, majorVersion);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, source, 'utf8');
  return p;
}

/** 读取大版本快照；不存在返回 null */
export function readMajorSnapshot(root, majorVersion) {
  try {
    return fs.readFileSync(majorSnapshotPath(root, majorVersion), 'utf8');
  } catch {
    return null;
  }
}

/** 读取版本清单；文件缺失/损坏返回空结构 */
export function loadVersions(root) {
  try {
    const data = JSON.parse(fs.readFileSync(versionsPath(root), 'utf8'));
    return {
      major: Array.isArray(data.major) ? data.major : [],
      minor: Array.isArray(data.minor) ? data.minor : [],
    };
  } catch {
    return EMPTY();
  }
}

/** 写入版本清单（自动建目录） */
export function saveVersions(root, data) {
  const p = versionsPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** 最新大版本号（数字，无大版本时为 0） */
export function latestMajor(data) {
  return data.major.reduce((max, e) => Math.max(max, Number(e.version) || 0), 0);
}

/** 下一个大版本号（字符串） */
export function nextMajorVersion(root) {
  return String(latestMajor(loadVersions(root)) + 1);
}

/** 下一个小版本号（字符串 x.y，归属最近的大版本） */
export function nextMinorVersion(root) {
  const data = loadVersions(root);
  const major = String(latestMajor(data) || 0);
  const n = data.minor.filter((e) => e.major === major).length + 1;
  return { version: `${major}.${n}`, major };
}

/** 追加一条大版本记录 */
export function addMajor(root, { commit, message, tag, wikidotVersion }) {
  const data = loadVersions(root);
  const entry = {
    version: String(latestMajor(data) + 1),
    commit,
    tag: tag ?? null,
    message: message ?? '',
    createdAt: new Date().toISOString(),
    wikidotVersion: wikidotVersion ?? null,
  };
  data.major.push(entry);
  saveVersions(root, data);
  return entry;
}

/** 追加一条小版本记录 */
export function addMinor(root, { commit, message }) {
  const data = loadVersions(root);
  const { version, major } = nextMinorVersion(root);
  const entry = {
    version,
    major,
    commit,
    message: message ?? '',
    createdAt: new Date().toISOString(),
  };
  data.minor.push(entry);
  saveVersions(root, data);
  return entry;
}

/** 合并成展示用列表（新版本在前），带 kind/大版本归属 */
export function listVersions(root) {
  const data = loadVersions(root);
  const rows = [
    ...data.major.map((e) => ({
      version: e.version,
      kind: 'major',
      major: e.version,
      commit: e.commit,
      message: e.message,
      createdAt: e.createdAt,
      wikidotVersion: e.wikidotVersion ?? null,
    })),
    ...data.minor.map((e) => ({
      version: e.version,
      kind: 'minor',
      major: e.major,
      commit: e.commit,
      message: e.message,
      createdAt: e.createdAt,
      wikidotVersion: null,
    })),
  ];
  return rows.sort((a, b) => {
    const [ aM, aN ] = a.version.split('.').map(Number);
    const [ bM, bN ] = b.version.split('.').map(Number);
    return bM - aM || (bN || 0) - (aN || 0);
  });
}

/** 版本号格式：`x` 或 `x.y` */
export function isVersionSpec(spec) {
  return /^\d+(\.\d+)?$/.test(String(spec ?? '').trim());
}

/**
 * 把版本号解析为回退目标。
 *
 * @param {string} root
 * @param {string} spec `x`（大版本）或 `x.y`（小版本）
 * @returns {{ kind:'major'|'minor', entry:object, commit:string, remoteCommit:string|null,
 *            remoteVersion:string }} 解析结果
 * @throws {Error} 版本不存在时
 */
export function resolveVersionTarget(root, spec) {
  const s = String(spec).trim();
  const data = loadVersions(root);

  if (s.includes('.')) {
    const entry = data.minor.find((e) => e.version === s);
    if (!entry) throw new Error(`版本不存在: ${s}（可用 ftml revert --list 查看版本列表）`);
    // 线上回到大版本创建时提交的版本；没有对应大版本时退回该小版本自身
    const majorEntry = data.major.find((e) => e.version === entry.major);
    return {
      kind: 'minor',
      entry,
      commit: entry.commit,
      remoteCommit: majorEntry?.commit ?? entry.commit,
      remoteVersion: majorEntry ? majorEntry.version : entry.version,
    };
  }

  const majorEntry = data.major.find((e) => e.version === s);
  if (!majorEntry) throw new Error(`大版本不存在: ${s}（可用 ftml revert --list 查看版本列表）`);
  return {
    kind: 'major',
    entry: majorEntry,
    commit: majorEntry.commit,
    remoteCommit: majorEntry.commit,
    remoteVersion: majorEntry.version,
  };
}
