/**
 * stack.js — 把 JS 堆栈美化成带源码定位的文本，并把 @wdprlib 打包产物帧映射回源文件
 *
 * 背景：@wdprlib/* 的 dist/index.js 是未压缩的 bundle，没有 source map，但每个源文件
 * 前都有一行 section 标记：
 *
 *     // packages/parser/src/lexer/tokens.ts
 *     function createToken(...) { ... }
 *
 * 因此拿到一个 dist 行号后，可以二分找到它所属的源文件 section，再用「行号落点相对
 * section 起点的偏移」近似出源码位置（transpile 会略微移位，故用 ~ 标注为近似）。
 *
 * 非 wdpr 的帧（本项目源码 / node: 内置）原样保留，只把 cwd 下的绝对路径转成相对路径。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** `    at fn (path:line:col)` / `    at path:line:col` */
const FRAME_RE = /^\s*at\s+(?:(.+?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/;

/** @wdprlib/<pkg>/dist/<file>.js（允许前后缀路径） */
const BUNDLED_RE = /^(.*?[\\/])?@wdprlib[\\/]([^\\/]+)[\\/]dist[\\/]([^\\/]+\.js)$/;

/** section 标记行：`// packages/<pkg>/src/....ts` */
const MARKER_RE = /^\/\/\s+(packages\/(.+?)\.(?:ts|js|mts|cts))\s*$/;

/** dist 路径 → 已排序的 section 表 [{line, src}]，进程内缓存 */
const markerCache = new Map();

/** 读取 dist 文件建立 section 表；文件读不到返回空数组（降级为不映射） */
function markersFor(distPath) {
  if (markerCache.has(distPath)) return markerCache.get(distPath);
  let table = [];
  try {
    const lines = readFileSync(distPath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = MARKER_RE.exec(lines[i]);
      if (m) table.push({ line: i + 1, src: m[1] });
    }
  } catch {
    table = [];
  }
  markerCache.set(distPath, table);
  return table;
}

/** 找最后一个 line <= target 的 section；没有则返回 null */
function sectionFor(distPath, line) {
  const table = markersFor(distPath);
  if (table.length === 0) return null;
  let lo = 0;
  let hi = table.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid].line <= line) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (found === -1) return null;
  const sec = table[found];
  return { src: sec.src, offset: line - sec.line, sectionStart: sec.line };
}

/** `packages/parser/src/x.ts` → `@wdprlib/parser/src/x.ts` */
function displaySrc(src) {
  return src.startsWith('packages/') ? '@wdprlib/' + src.slice('packages/'.length) : src;
}

/**
 * 美化一行堆栈帧。返回 { text, bundled }；不是帧则返回 null。
 * @param {string} line
 * @param {{ cwd?: string }} opts
 */
function formatFrame(line, { cwd = process.cwd() } = {}) {
  const m = FRAME_RE.exec(line);
  if (!m) return null;
  const [, fn, loc, lineNo, colNo] = m;

  // node: 内部帧（eval/proc 等）——压缩成单行，不参与映射
  const bundled = BUNDLED_RE.exec(loc);
  if (bundled) {
    const distPath = loc;
    const pkg = bundled[2];
    const sec = sectionFor(distPath, Number(lineNo));
    const where = sec
      ? `${displaySrc(sec.src)} ~L${sec.offset} (打包 dist 第 ${lineNo} 行)`
      : `@wdprlib/${pkg}/dist ${lineNo}:${colNo}（未找到源段）`;
    return { text: `    at ${fn ? `${fn} → ` : ''}${where}`, bundled: true };
  }

  // 本项目 / 其它依赖：把 cwd 下的绝对路径转相对，读起来短一些
  let display = loc;
  if (path.isAbsolute(loc)) {
    const rel = path.relative(cwd, loc);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) display = rel.split(path.sep).join('/');
  }
  return { text: `    at ${fn ? `${fn} (` : ''}${display}:${lineNo}:${colNo}${fn ? ')' : ''}`, bundled: false };
}

/**
 * 美化整段堆栈。
 * @param {string} stack Error#stack
 * @param {{ cwd?: string, maxFrames?: number }} [opts]
 * @returns {{ text: string, hasBundled: boolean }}
 */
export function mapStack(stack, { cwd = process.cwd(), maxFrames = 40 } = {}) {
  const raw = String(stack ?? '').split('\n');
  const out = [];
  let hasBundled = false;
  let frames = 0;
  for (const line of raw) {
    if (!line.trim().startsWith('at ')) {
      // 首行的 "Error: msg" 原样保留（只保留第一条）
      if (out.length === 0 && line.trim()) out.push(line.trimEnd());
      continue;
    }
    if (frames >= maxFrames) { out.push('    …（更多帧已省略）'); break; }
    const f = formatFrame(line, { cwd });
    if (!f) { out.push(line.trimEnd()); continue; }
    if (f.bundled) hasBundled = true;
    out.push(f.text);
    frames++;
  }
  return { text: out.join('\n'), hasBundled };
}

/** 测试 / 诊断用：清空 dist section 缓存 */
export function clearStackCache() {
  markerCache.clear();
}
