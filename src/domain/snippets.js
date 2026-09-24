/**
 * snippets.js — 自定义代码片段（用户级持久化 + Ace/TextMate .snippets 导入导出）
 *
 *   存储：~/.ftml-cli/snippets/snippets.json
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
 *   片段对象：{ name, prefix, description, body, source }
 */

import fs from 'node:fs';
import path from 'node:path';
import { snippetsDir } from '../infra/paths.js';

function snippetsFile() {
  return path.join(snippetsDir(), 'snippets.json');
}

/** 读取全部片段；文件缺失/损坏返回 [] */
export function loadSnippets() {
  try {
    const arr = JSON.parse(fs.readFileSync(snippetsFile(), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 写入全部片段（自动建目录） */
export function saveSnippets(list) {
  const p = snippetsFile();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(list, null, 2) + '\n', 'utf8');
  return list;
}

const NAME_RE = /^snippet\s+(.+?)\s*$/;

/**
 * 解析 Ace/TextMate .snippets 文本为片段数组。
 * @param {string} text
 * @returns {{name:string, body:string}[]}
 */
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
    if (!current) continue;              // 片段定义之前的内容（含注释）忽略
    if (line.trim().startsWith('#')) continue; // 注释
    if (line.trim() === '') { current.lines.push(''); continue; }
    // 去掉统一的一级缩进（Tab 或 4 空格）
    current.lines.push(line.replace(/^(\t| {4})/, ''));
  }
  push();
  return out;
}

/** 把片段数组序列化为 Ace .snippets 文本（导入格式的逆操作） */
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
 * @param {Array} incoming 解析出的片段（可带 prefix/description）
 * @param {string} source 来源标记（文件名）
 */
export function mergeSnippets(incoming, source = 'import') {
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
      list[index.get(k)] = { ...list[index.get(k)], ...entry };
      updated += 1;
    } else {
      index.set(k, list.length);
      list.push(entry);
      added += 1;
    }
  }
  saveSnippets(list);
  return { added, updated, total: list.length, snippets: list };
}

/** 导入 Ace .snippets 文本 */
export function importSnippetsText(text, source = 'import') {
  const parsed = parseSnippetsText(text);
  return mergeSnippets(parsed, source);
}

/** 读取磁盘上的 .snippets 文件并导入 */
export function importSnippetsFile(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  return importSnippetsText(fs.readFileSync(abs, 'utf8'), path.basename(abs));
}

/** 新增/更新单条片段 */
export function upsertSnippet(input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw new Error('片段名称不能为空');
  const entry = {
    name,
    prefix: String(input.prefix ?? name).trim(),
    description: String(input.description ?? '').trim(),
    body: String(input.body ?? ''),
    source: input.source ?? 'user',
  };
  return mergeSnippets([ entry ], entry.source);
}

/** 删除片段（按 prefix 或 name 匹配） */
export function removeSnippet(name) {
  const k = String(name).trim();
  const list = loadSnippets();
  const kept = list.filter((s) => keyOf(s) !== k && String(s.name) !== k);
  if (kept.length === list.length) throw new Error(`片段不存在: ${k}`);
  saveSnippets(kept);
  return { removed: list.length - kept.length, snippets: kept };
}

/** 导出为 Ace .snippets 文本（前端下载用） */
export function exportSnippetsText() {
  return formatSnippetsText(loadSnippets());
}
