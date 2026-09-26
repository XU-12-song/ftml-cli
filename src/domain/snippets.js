/**
 * snippets.js — 自定义代码片段（用户级持久化 + Ace/TextMate .snippets 导入导出）
 *
 *   存储：~/.ftml-cli/snippets/*.json       ← 目录下所有 .json 都会被读取并合并
 *   导入：Ace 编辑器 .snippets 文本格式（与 /public/.acode-snippets/*.snippets 一致）
 *
 *        snippet 卡片
 *        	[[card title="${1:标题}"]]
 *        	${0}
 *        	[[/card]]
 *
 *   规则：
 *     - `snippet <名称>` 开头的行定义一个新片段，其后缩进行为片段正文；
 *     - `#` 开头的行是注释，忽略；
 *     - 正文里的 `${n:默认值}` / `$n` / `$0` 为 Ace 制表位（tabstop），原样保留，
 *       由前端编辑器在插入时展开；`${n}` 无默认值，`$n` 简写。
 *
 *   片段对象：{ name, prefix, description, body, source, _file? }
 *     _file 是内部字段，记录片段来源文件名，用于「按文件写回」；对外可忽略。
 */

import fs from 'node:fs';
import path from 'node:path';
import { snippetsDir } from '../infra/paths.js';

const DEFAULT_FILE = 'snippets.json';

/** 列出目录下所有 .json 文件（绝对路径） */
export function listSnippetFiles() {
  try {
    return fs.readdirSync(snippetsDir())
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .map((f) => path.join(snippetsDir(), f));
  } catch {
    return [];
  }
}

/**
 * 读取目录下所有 .json 片段并合并。
 * 每个条目带上 `_file` 字段（来源文件名），便于后续写回。
 */
export function loadSnippets() {
  const out = [];
  for (const abs of listSnippetFiles()) {
    const base = path.basename(abs);
    try {
      const arr = JSON.parse(fs.readFileSync(abs, 'utf8'));
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        if (!s || typeof s !== 'object') continue;
        out.push({ ...s, _file: s._file || base });
      }
    } catch {
      /* 单个文件损坏时跳过，不影响其它文件 */
    }
  }
  return out;
}

/**
 * 写入片段。
 *
 * @param {Array} list
 * @param {object} [opts]
 * @param {string} [opts.file]  指定单一文件名（仅写这一个文件，丢弃结构）
 * @param {boolean} [opts.group] 强制按 _file 分组写回（默认行为）
 *
 * 默认行为（不传 file）：按片段自带的 `_file` 分组写回各自文件；
 * 目录中已存在但本次不再出现的 .json 会被写成空数组（保留文件，避免误删）。
 */
export function saveSnippets(list, opts = {}) {
  const dir = snippetsDir();
  fs.mkdirSync(dir, { recursive: true });

  const writeOne = (fname, arr) => {
    const p = path.join(dir, fname);
    const clean = arr.map(({ _file, ...rest }) => rest);
    fs.writeFileSync(p, JSON.stringify(clean, null, 2) + '\n', 'utf8');
  };

  // 1) 指定单文件：全部塞进去
  if (opts.file) {
    writeOne(opts.file, list);
    return list;
  }

  // 2) 默认：按 _file 分组写回
  const groups = new Map();
  for (const s of list) {
    const f = s._file || DEFAULT_FILE;
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(s);
  }
  // 目录里已有但本次分组没有的文件 → 写空
  for (const abs of listSnippetFiles()) {
    const base = path.basename(abs);
    if (!groups.has(base)) groups.set(base, []);
  }
  for (const [f, arr] of groups) writeOne(f, arr);
  return list;
}

const NAME_RE = /^snippet\s+(.+?)\s*$/;

/** 解析 Ace/TextMate .snippets 文本为片段数组 */
export function parseSnippetsText(text) {
  const out = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const body = current.lines.join('\n').replace(/\s+$/, '');
    if (body.trim()) out.push({ name: current.name, body });
    current = null;
  };
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = NAME_RE.exec(line);
    if (m) {
      push();
      current = { name: m[1], lines: [] };
      continue;
    }
    if (!current) continue;
    if (line.trim().startsWith('#')) continue;
    if (line.trim() === '') { current.lines.push(''); continue; }
    current.lines.push(line.replace(/^(\t| {4})/, ''));
  }
  push();
  return out;
}

/** 把片段数组序列化为 Ace .snippets 文本 */
export function formatSnippetsText(list) {
  return list
    .map((s) => {
      const body = String(s.body ?? '').split('\n').map((l) => (l ? `\t${l}` : '')).join('\n');
      return `snippet ${s.name}\n${body}`;
    })
    .join('\n\n') + '\n';
}

/** 片段唯一键：优先 prefix，否则 name */
function keyOf(s) {
  return String(s.prefix || s.name || '').trim();
}

/**
 * 合并导入：同 key 覆盖，否则追加。
 *
 * @param {Array}  incoming
 * @param {string} source  来源标记（文件名/描述）
 * @param {object} [opts]
 * @param {string} [opts.file]  新片段写入哪个文件（默认 'snippets.json'）
 */
export function mergeSnippets(incoming, source = 'import', opts = {}) {
  const targetFile = opts.file || DEFAULT_FILE;
  const list = loadSnippets();
  const index = new Map(list.map((s, i) => [keyOf(s), i]));
  let added = 0;
  let updated = 0;

  for (const raw of incoming) {
    const name = String(raw.name ?? '').trim();
    if (!name) continue;
    const entry = {
      name,
      prefix: String(raw.prefix ?? raw.name ?? '').trim(),
      description: String(raw.description ?? '').trim(),
      body: String(raw.body ?? ''),
      source,
    };
    const k = keyOf(entry);
    if (index.has(k)) {
      const i = index.get(k);
      // 保留原有 _file，覆盖其它字段
      list[i] = { ...list[i], ...entry };
      updated += 1;
    } else {
      index.set(k, list.length);
      list.push({ ...entry, _file: targetFile });
      added += 1;
    }
  }

  saveSnippets(list, opts);   // 默认按 _file 分组
  return { added, updated, total: list.length, snippets: list };
}

/** 导入 Ace .snippets 文本 */
export function importSnippetsText(text, source = 'import', opts = {}) {
  const parsed = parseSnippetsText(text);
  return mergeSnippets(parsed, source, opts);
}

/** 读取磁盘上的 .snippets 文件并导入 */
export function importSnippetsFile(file, opts = {}) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  return importSnippetsText(fs.readFileSync(abs, 'utf8'), path.basename(abs), opts);
}

/** 新增/更新单条片段 */
export function upsertSnippet(input, opts = {}) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw new Error('片段名称不能为空');
  const entry = {
    name,
    prefix: String(input.prefix ?? name).trim(),
    description: String(input.description ?? '').trim(),
    body: String(input.body ?? ''),
    source: input.source ?? 'user',
  };
  return mergeSnippets([entry], entry.source, opts);
}

/** 删除片段（按 prefix 或 name 匹配） */
export function removeSnippet(name, opts = {}) {
  const k = String(name).trim();
  const list = loadSnippets();
  const kept = list.filter((s) => keyOf(s) !== k && String(s.name) !== k);
  if (kept.length === list.length) throw new Error(`片段不存在: ${k}`);
  saveSnippets(kept, opts);
  return { removed: list.length - kept.length, snippets: kept };
}

/** 导出为 Ace .snippets 文本（前端下载用） */
export function exportSnippetsText() {
  return formatSnippetsText(loadSnippets());
}