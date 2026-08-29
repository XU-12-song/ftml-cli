/**
 * expand.js — FTML 模板展开器
 *
 * 扫描 .ftml 源文本：
 *   - 遇到 `[[name ...]]` 且 name 命中已加载模板表 → 视为模板调用，递归展开
 *   - 遇到 `[[style]]...[[/style]]` → CSS 块，收集后统一输出为 [[module CSS]]
 *   - 其他元素（div/span/include/image 等原生 wikidot 元素）原样透传
 *
 * 模板调用属性值：
 *   - 带引号（'v' 或 "v"）→ string 类型：FTML 转义后作为字面文本插入
 *   - 不带引号 → ftml 类型：原样插入（可含 wiki 语法）
 *   - children（调用开/闭标签之间的内容）→ 总是 ftml，原样插入
 *
 * CSS（[[style]] 块）：
 *   - 顶层 / children 中的 [[style]]：内容原样收集
 *   - 模板 body 中的 [[style]]：CSS 内 { 已声明键 } 会被替换为调用参数，
 *     其余 { ... } 视为 CSS 语法原样保留（避免与 .a { color: red } 冲突）
 *   - 所有块按出现顺序合并，展开结果开头输出一个 [[module CSS]]
 *
 * 安全：深度上限 32 + 调用栈查重（循环模板调用直接报错）
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { escapeString } from './escape.js';
import { parseFtmx } from './parse-ftmx.js';

export const MAX_DEPTH = 32;

/**
 * 将标签 inner 按 token 切分：
 *  - 引号内整体作为一个 token（引号保留）
 *  - 无引号但值含 [[...]]（如 content=[[note]]hi[[/note]]）→ 整体作为一个 token
 *  - 其余按空白切分
 */
function splitTokens(inner) {
  const tokens = [];
  let i = 0;
  const n = inner.length;
  while (i < n) {
    // 跳过空白
    while (i < n && /\s/.test(inner[i])) i++;
    if (i >= n) break;
    let start = i;
    if (inner[i] === '"' || inner[i] === "'") {
      // 引号 token
      const q = inner[i];
      i++;
      while (i < n && inner[i] !== q) i++;
      i++; // 越过闭合引号
      tokens.push(inner.slice(start, i));
      continue;
    }
    // 普通 token：引号段整体跳过；遇 ]]（外层闭标签）停；支持值内的 [[...]]
    let bracketDepth = 0;
    while (i < n) {
      if (inner[i] === '"' || inner[i] === "'") {
        const q = inner[i];
        i++;
        while (i < n && inner[i] !== q) i++;
        i++;
        continue;
      }
      if (inner.startsWith('[[', i)) {
        bracketDepth++;
        i += 2;
        continue;
      }
      if (inner.startsWith(']]', i)) {
        if (bracketDepth > 0) {
          bracketDepth--;
          i += 2;
          continue;
        }
        break; // 这是外层闭标签，停下
      }
      if (/\s/.test(inner[i]) && bracketDepth === 0) break;
      i++;
    }
    tokens.push(inner.slice(start, i));
  }
  return tokens;
}

/** 解析调用处开标签内属性：[[name k1='v' k2=v2 ...]] → { name, attrs } */
function parseCallTag(inner) {
  const tokens = splitTokens(inner);

  const name = tokens[0];
  const attrs = [];
  for (const t of tokens.slice(1)) {
    const eq = t.indexOf('=');
    if (eq === -1) {
      throw new Error(`模板调用 [[${name}]] 出现无值参数: ${t}`);
    }
    const key = t.slice(0, eq);
    let raw = t.slice(eq + 1);
    let type = 'ftml';
    if (
      (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
      (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
    ) {
      type = 'string';
      raw = raw.slice(1, -1);
    }
    attrs.push({ key, value: raw, type });
  }
  return { name, attrs };
}

/**
 * 用括号深度找到 [[ 标签真正的结束位置（]] 之后）。
 * 值内含 [[...]]（如 content=[[note]]hi[[/note]]）时不会被误截断。
 * @param {string} src
 * @param {number} openIdx 指向 '[['
 * @returns {number} 结束位置（']]' 之后），未闭合返回 -1
 */
function findTagEnd(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  const n = src.length;
  while (i < n - 1) {
    if (src[i] === '[' && src[i + 1] === '[') {
      depth++;
      i += 2;
      continue;
    }
    if (src[i] === ']' && src[i + 1] === ']') {
      depth--;
      if (depth === 0) return i + 2;
      i += 2;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * 从 openEnd 之后找与开标签配对的 `[[/name]]` 闭合标签位置（支持嵌套同名调用）。
 * @param {string} src
 * @param {number} openEnd 开标签结束位置（']]' 之后）
 * @param {string} name
 * @returns {number} 闭合标签 '[[/' 的位置；未找到返回 -1
 */
function findClosingTag(src, openEnd, name) {
  let cursor = openEnd;
  let depth = 0;
  for (;;) {
    const nextOpen = src.indexOf('[[', cursor);
    if (nextOpen === -1) return -1;
    const nextEnd = findTagEnd(src, nextOpen);
    if (nextEnd === -1) return -1;
    const tagInner = src.slice(nextOpen + 2, nextEnd - 2).trim();
    const nm = tagInner.match(/^([^\s=]+)/);
    if (nm && nm[1] === name) {
      depth++;
      cursor = nextEnd;
      continue;
    }
    if (nm && nm[1] === '/' + name) {
      if (depth === 0) return nextOpen;
      depth--;
      cursor = nextEnd;
      continue;
    }
    cursor = nextEnd;
  }
}

/**
 * 展开文本中的模板调用与组件引用
 * @param {string} src 源 FTML
 * @param {Map<string, object>} templates name → parseFtmx 结果
 * @param {{ baseDir?: string }} [opts] opts.baseDir = 解析 [[component]] 相对路径的基准目录（默认 CWD）
 * @returns {string} 展开后的 FTML（无模板残留；[[style]] 已并入开头的 [[module CSS]]）
 */
/** 收集 CSS 块：相同内容只保留第一次出现（模板被多次调用时其 [[style]] 只输出一次） */
function pushCss(ctx, css) {
  const block = css.trim();
  if (!ctx.css.includes(block)) ctx.css.push(block);
}

export function expand(src, templates, opts = {}) {
  const ctx = { css: [], baseDir: opts.baseDir || process.cwd() };
  const text = expandInner(src, templates, [], 0, ctx, []);
  return assembleResult(text, ctx.css);
}

/** 收集到的 CSS 块组装进输出：非空时在结果开头生成一个 [[module CSS]] */
function assembleResult(text, cssBlocks) {
  if (cssBlocks.length === 0) return text;
  const css = cssBlocks.join('\n\n');
  return `[[module CSS]]\n${css}\n[[/module]]\n\n${text}`;
}

/** CSS 内占位符替换：只替换调用方传入的键，其余 { ... } 视为 CSS 语法原样保留 */
const CSS_PLACEHOLDER_RE = /\{\s*([\w-]+)\s*\}/g;

function replaceCssPlaceholders(css, values) {
  return css.replace(CSS_PLACEHOLDER_RE, (m, key) => {
    if (!values.has(key)) return m;
    const v = values.get(key);
    return v.type === 'string' ? escapeString(v.value) : v.value;
  });
}

/**
 * @param {string} src
 * @param {Map} templates
 * @param {string[]} stack 当前模板调用栈（防循环）
 * @param {number} depth
 * @param {{ css: string[], baseDir: string }} ctx CSS 块 + 组件相对路径基准目录
 * @param {string[]} fileStack 当前组件文件绝对路径栈（防循环依赖）
 */
function expandInner(src, templates, stack, depth, ctx, fileStack) {
  if (depth > MAX_DEPTH) {
    throw new Error(`模板嵌套超过最大深度 ${MAX_DEPTH}`);
  }

  let out = '';
  let i = 0;
  while (i < src.length) {
    const openIdx = src.indexOf('[[', i);
    if (openIdx === -1) {
      out += src.slice(i);
      break;
    }

    // 标签前的普通文本原样输出（对所有分支统一处理）
    out += src.slice(i, openIdx);

    // 找到 [[name ...]] 真正的结束位置（值内含 [[...]] 时不误截断）
    const tagEnd = findTagEnd(src, openIdx);
    if (tagEnd === -1) {
      // 未闭合的 [[ 视为普通文本
      out += src.slice(openIdx);
      break;
    }

    const inner = src.slice(openIdx + 2, tagEnd - 2).trim();
    const m = inner.match(/^([^\s=]+)/);
    if (!m) {
      // 空标签 [[]] 或内容不合法 → 原样保留
      out += src.slice(openIdx, tagEnd);
      i = tagEnd;
      continue;
    }

    const name = m[1];

    // ---- [[code]]...[[/code]] 代码块：原样透传（块内模板调用是文档示例，不展开） ----
    if (name === 'code') {
      const closeIdx = src.indexOf('[[/code]]', tagEnd);
      if (closeIdx === -1) {
        throw new Error(`[[code]] 缺少闭合标签 [[/code]]`);
      }
      const end = findTagEnd(src, closeIdx);
      out += src.slice(openIdx, end);
      i = end;
      continue;
    }

    // ---- [[style]] CSS 块：收集，不输出到正文 ----
    if (name === 'style') {
      const closeIdx = findClosingTag(src, tagEnd, 'style');
      if (closeIdx === -1) {
        throw new Error(`[[style]] 缺少闭合标签 [[/style]]`);
      }
      pushCss(ctx, src.slice(tagEnd, closeIdx));
      i = findTagEnd(src, closeIdx);
      continue;
    }

    // ---- [[component src="..."]][[/component]]：按文件引用组件（无参数，children 必须为空） ----
    if (name === 'component') {
      const { attrs } = parseCallTag(inner);
      if (attrs.length !== 1 || attrs[0].key !== 'src') {
        throw new Error(
          `[[component]] 只接受一个 src 参数（无自定义参数），收到: ${
            attrs.length === 0 ? '(无)' : attrs.map((a) => a.key).join(', ')
          }`
        );
      }

      const childEnd = findClosingTag(src, tagEnd, 'component');
      if (childEnd === -1) {
        throw new Error(`[[component]] 缺少闭合标签 [[/component]]`);
      }
      const childrenRaw = src.slice(tagEnd, childEnd);
      if (childrenRaw.trim() !== '') {
        throw new Error(`[[component]] 的 children 必须为空，不允许子内容`);
      }

      const absPath = path.resolve(ctx.baseDir, attrs[0].value);
      if (fileStack.includes(absPath)) {
        throw new Error(
          `组件循环依赖: ${fileStack.concat(absPath).join(' -> ')}`
        );
      }

      let fileSrc;
      try {
        fileSrc = readFileSync(absPath, 'utf8');
      } catch (e) {
        throw new Error(`无法读取组件文件 ${absPath}: ${e.message}`);
      }

      const rendered = expandInner(
        fileSrc,
        templates,
        stack,
        depth + 1,
        { css: ctx.css, baseDir: path.dirname(absPath) },
        fileStack.concat(absPath)
      );

      out += rendered;
      i = findTagEnd(src, childEnd);
      continue;
    }

    const tmpl = templates.get(name);

    if (!tmpl) {
      // 非模板元素（原生 wikidot 或用户自定义但未定义）→ 原样透传
      out += src.slice(openIdx, tagEnd);
      i = tagEnd;
      continue;
    }

    // ---- 这是一个模板调用 ----
    if (stack.includes(name)) {
      throw new Error(
        `模板循环调用检测到: ${stack.concat(name).join(' -> ')}`
      );
    }

    // 解析属性
    const { attrs } = parseCallTag(inner);

    // 找配对的闭合标签 [[/name]]
    const childEnd = findClosingTag(src, tagEnd, name);
    if (childEnd === -1) {
      throw new Error(`模板调用 [[${name}]] 缺少闭合标签 [[/${name}]]`);
    }

    const childrenRaw = src.slice(tagEnd, childEnd);

    // 收集属性到 map
    const values = new Map();
    for (const a of attrs) values.set(a.key, { ...a });

    // 展开 children（支持嵌套模板调用）
    const childrenExpanded = expandInner(
      childrenRaw,
      templates,
      stack.concat(name),
      depth + 1,
      ctx,
      fileStack
    );

    // 渲染模板
    const rendered = renderTemplate(
      tmpl,
      templates,
      values,
      childrenExpanded,
      name,
      ctx,
      stack,
      fileStack,
      depth
    );

    out += rendered;
    // childEnd 指向 [[/name]] 的 [[ 位置，找到它的结束
    i = findTagEnd(src, childEnd); // childEnd 是 [[/name]] 的 [[ 位置
  }

  return out;
}

/**
 * 用调用参数渲染模板 body
 *
 * 占位符与转义用一个正则统一处理：
 *   - 单个 \ 转义 \{ 或 \} → 输出字面字符，不当作占位符
 *   - 两个连续 \\ → 字面反斜杠
 *   - { 键名 } → 替换为参数值
 */
const PLACEHOLDER_RE = /\\(?:\\|\{|\})|\{([^{}\n]+?)\}/g;

function renderTemplate(tmpl, templates, values, childrenExpanded, name, ctx, stack, fileStack, depth) {
  const { element, literalAttrs, keys, body } = tmpl;

  // 模板 body 中不允许组件引用：组件是文件级复用，请写在调用层 .ftml 中
  if (/\[\[component\b/.test(body)) {
    throw new Error(
      `模板 [[${name}]] 的 body 中不允许使用 [[component]]，请把组件引用放在调用层 .ftml 中`
    );
  }

  // 提取 body 中的 [[style]]...[[/style]] 块：CSS 收集（占位符只替换已声明键），块本身不输出
  const styleBlocks = [];
  const strippedBody = body.replace(
    /\[\[style\s*\]\]([\s\S]*?)\[\[\/style\]\]/g,
    (m, css) => {
      styleBlocks.push(css);
      return '';
    }
  );
  for (const css of styleBlocks) {
    pushCss(ctx, replaceCssPlaceholders(css, values));
  }

  const renderedBody = strippedBody.replace(PLACEHOLDER_RE, (full, keyRaw) => {
    if (keyRaw === undefined) {
      // 转义分支：\\ → \，\{ → {，\} → }
      return full === '\\\\' ? '\\' : full[1];
    }
    const key = keyRaw.trim();
    if (key === 'children') {
      return childrenExpanded;
    }
    if (!values.has(key)) {
      throw new Error(
        `模板 [[${name}]] 调用缺少参数 { ${key} }（模板声明: ${keys.join(', ') || '(无)'}）`
      );
    }
    const v = values.get(key);
    return v.type === 'string' ? escapeString(v.value) : v.value;
  });

  // 模板 body 内嵌套的模板调用在此展开（先替换占位符，再展开嵌套调用；
  // stack 带上当前模板名，body 内自引用/循环会被检测）
  const expandedBody = expandInner(
    renderedBody,
    templates,
    stack.concat(name),
    depth + 1,
    ctx,
    fileStack
  );

  // 组装输出
  let out = '';
  if (element !== null) {
    out += `[[${element}`;
    for (const a of literalAttrs) out += ` ${a}`;
    out += ']]';
    out += expandedBody;
    out += `[[/${element}]]`;
  } else {
    out += expandedBody; // 空名根 [[]]：只输出 body
  }
  return out;
}

/**
 * 从目录加载全部 .ftmx 模板
 * @param {string} dir 模板目录
 * @returns {Promise<Map<string, object>>}
 */
export async function loadTemplates(dir) {
  const { readdir, readFile } = await import('node:fs/promises');
  const map = new Map();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return map; // 目录不存在 → 空模板表
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.ftmx')) continue;
    const name = e.name.slice(0, -'.ftmx'.length);
    const src = await readFile(path.join(dir, e.name), 'utf8');
    map.set(name, parseFtmx(src, name));
  }
  return map;
}

/**
 * 检查展开结果是否仍有未展开的模板调用残留
 * @param {string} out 展开结果
 * @param {Map} templates 模板表
 */
export function findUnresolved(out, templates) {
  const found = [];
  let i = 0;
  while (i < out.length) {
    const openIdx = out.indexOf('[[', i);
    if (openIdx === -1) break;
    const tagEnd = findTagEnd(out, openIdx);
    if (tagEnd === -1) break;
    const inner = out.slice(openIdx + 2, tagEnd - 2).trim();
    const m = inner.match(/^([^\s=]+)/);
    if (m && m[1] === 'code') {
      // [[code]] 块内的模板调用是文档示例，不算残留
      const closeIdx = out.indexOf('[[/code]]', tagEnd);
      if (closeIdx === -1) {
        i = tagEnd;
        continue;
      }
      i = findTagEnd(out, closeIdx);
      continue;
    }
    if (m && templates.has(m[1])) found.push(m[1]);
    i = tagEnd;
  }
  return found;
}
