/**
 * module-resolve.js — 一次性真实解析 module（联网）
 *
 * 只在用户从命令面板显式触发时使用。每个 fetcher 都按 @wdprlib/parser 的
 * dataProvider 签名返回数据；失败由 module-data.js 捕获并回退占位。
 *
 * 覆盖 wdpr 暴露 hook 的模块：ListPages / ListUsers / TagCloud / Rate。
 * Backlinks / Categories / PageTree 没有 hook，不在这里处理。
 */

import {
  SearchPagesQuery,
  PageCollection,
} from '@ukwhatn/wikidot';
import { parse } from '@wdprlib/parser';
import { extractReadableText, extractFirstParagraph, countCharacters } from '@wdprlib/ast';
import { getSite, getPage } from '../infra/wikidot.js';
import { dirtToIdeal } from '../compat/index.js';

/** WikidotResult → 值；失败抛错（由 module-data 捕获） */
function unwrap(result, what) {
  if (!result.isOk()) throw new Error(`${what}失败: ${result.error}`);
  return result.value;
}

function userInfo(user) {
  if (!user) return undefined;
  return { id: user.id ?? 0, name: user.name ?? '', unixName: user.unixName ?? user.name ?? '' };
}

function currentCategory(page) {
  const full = String(page?.fullName ?? '');
  const i = full.lastIndexOf(':');
  return i === -1 ? '_default' : full.slice(0, i);
}

function dateSelector(v) {
  if (!v) return undefined;
  switch (v.type) {
    case 'year':
      return String(v.year);
    case 'month':
      return `${v.year}.${String(v.month).padStart(2, '0')}`;
    case 'comparison':
      return `${v.op}${v.date}`;
    case 'relative':
      return `last ${v.count} ${v.unit}`;
    default:
      return undefined;
  }
}

function numericSelector(v) {
  if (!v) return undefined;
  return v.op === '=' ? String(v.value) : `${v.op}${v.value}`;
}

function categorySelector(cat, page) {
  if (!cat) return undefined;
  const parts = [];
  if (cat.all) {
    parts.push('*');
  } else {
    if (cat.current) parts.push(currentCategory(page));
    for (const c of cat.include ?? []) if (c) parts.push(c);
  }
  for (const c of cat.exclude ?? []) if (c) parts.push(`-${c}`);
  return parts.length ? parts.join(' ') : undefined;
}

function tagsSelector(tags) {
  if (!tags) return undefined;
  const parts = [];
  if (tags.special === 'same-visible') parts.push('=');
  else if (tags.special === 'same-all') parts.push('==');
  else if (tags.special === 'none') parts.push('-');
  for (const t of tags.all ?? []) parts.push(`+${t}`);
  for (const t of tags.any ?? []) parts.push(t);
  for (const t of tags.none ?? []) parts.push(`-${t}`);
  return parts.length ? parts.join(' ') : undefined;
}

function parentSelector(parent) {
  if (!parent) return undefined;
  switch (parent.type) {
    case 'none':
      return '-';
    case 'same':
      return '=';
    case 'different':
      return '-=';
    case 'children':
      return '.';
    case 'page':
      return parent.name;
    default:
      return undefined;
  }
}

/**
 * NormalizedListPagesQuery → @ukwhatn/wikidot 的 SearchPagesQueryParams。
 * 导出供单测；不抛错，不支持的特性通过 warnings 记录。
 */
export function toSearchPagesParams(query, page, caps, warnings = []) {
  const limit = Math.max(
    0,
    Math.min(Number.isFinite(query?.limit) ? query.limit : caps.listPagesMaxRows, caps.listPagesMaxRows)
  );
  const perPage = Math.max(1, Math.min(query?.perPage ?? limit ?? 20, 250));
  const params = {
    pagetype: query?.pagetype === '*' ? undefined : query?.pagetype,
    category: categorySelector(query?.category, page),
    tags: tagsSelector(query?.tags),
    parent: parentSelector(query?.parent),
    linkTo: query?.linkTo,
    createdAt: dateSelector(query?.createdAt),
    updatedAt: dateSelector(query?.updatedAt),
    createdBy: query?.createdBy,
    rating: numericSelector(query?.rating),
    votes: numericSelector(query?.votes),
    name: query?.name,
    fullname: query?.fullname,
    range: query?.range === '.' ? page?.fullName : query?.range,
    offset: Number.isFinite(query?.offset) ? Math.max(0, query.offset) : 0,
    limit,
    perPage,
  };

  if (query?.ratingAxis) {
    warnings.push({
      severity: 'warning',
      code: 'module-real-listpages-rating-axis',
      message: `ListPages 自定义评分轴 ${query.ratingAxis} 暂不支持真实解析，已按主评分处理`,
      position: null,
    });
  }

  if (query?.order) {
    let { field, direction } = query.order;
    if (field === 'metadata') {
      warnings.push({
        severity: 'warning',
        code: 'module-real-listpages-order-metadata',
        message: `ListPages 按 metadata ${query.order.key} 排序暂不支持，已改用 title asc`,
        position: null,
      });
      field = 'title';
      direction = 'asc';
    }
    if (query.reverse) direction = direction === 'asc' ? 'desc' : 'asc';
    params.order = `${field} ${direction}`;
  }

  for (const key of Object.keys(params)) {
    if (params[key] === undefined) delete params[key];
  }
  return params;
}

const CONTENT_VARS = new Set([
  'content', 'content_n', 'preview', 'preview_n', 'excerpt', 'summary', 'first_paragraph',
]);

function needsContent(requirement) {
  return Boolean(
    requirement?.needsReadableText ||
    (requirement?.contentSectionIndices?.length ?? 0) > 0 ||
    (requirement?.previewLengths?.length ?? 0) > 0 ||
    (requirement?.neededVariables ?? []).some((v) => CONTENT_VARS.has(v))
  );
}

function estimatePercent(points, votes) {
  if (!votes) return 0;
  return Math.min(100, Math.max(0, Math.round(((points + votes) / (2 * votes)) * 100)));
}

function pageToPageData(p) {
  const parentFullname = p.parentFullname ?? undefined;
  const sep = parentFullname ? parentFullname.indexOf(':') : -1;
  return {
    name: p.name,
    category: p.category,
    fullname: p.fullname,
    title: p.title,
    createdAt: p.createdAt,
    createdBy: userInfo(p.createdBy),
    updatedAt: p.updatedAt,
    updatedBy: userInfo(p.updatedBy),
    commentedAt: p.commentedAt ?? undefined,
    commentedBy: userInfo(p.commentedBy),
    parentName: parentFullname ? (sep === -1 ? parentFullname : parentFullname.slice(sep + 1)) : undefined,
    parentCategory: parentFullname ? (sep === -1 ? '_default' : parentFullname.slice(0, sep)) : undefined,
    parentFullname,
    parentTitle: undefined,
    tags: p.tags ?? [],
    hiddenTags: [],
    children: p.childrenCount ?? 0,
    comments: p.commentsCount ?? 0,
    size: p.size ?? 0,
    rating: p.rating ?? 0,
    ratingVotes: p.votesCount ?? 0,
    ratingPercent: p.ratingPercent ?? estimatePercent(p.rating ?? 0, p.votesCount ?? 0),
    revisions: p.revisionsCount ?? 0,
    formData: {},
    formRaw: {},
    formLabel: {},
    formHint: {},
    metadata: {},
    customRates: {},
  };
}

async function enrichSources(site, pages, max, warnings) {
  const targets = pages.slice(0, max);
  if (targets.length === 0) return;
  if (pages.length > max) {
    warnings.push({
      severity: 'warning',
      code: 'module-real-listpages-source-capped',
      message: `ListPages 需要正文的页面超过 ${max} 个，仅前 ${max} 个填充正文`,
      position: null,
    });
  }
  try {
    let coll = new PageCollection(site, targets);
    if (targets.some((p) => p.id === null || p.id === undefined)) {
      coll = unwrap(await coll.getPageIds(), '批量读取页面 ID');
    }
    unwrap(await coll.getPageSources(), '批量读取页面源码');
    for (const p of targets) {
      const raw = p.source?.wikiText;
      if (typeof raw !== 'string') continue;
      const ideal = dirtToIdeal(raw).src;
      p._previewText = ideal;
      try {
        const { ast } = parse(ideal);
        p._readableText = extractReadableText(ast);
        p._firstParagraph = extractFirstParagraph(ast);
        p._charCount = countCharacters(p._readableText);
      } catch {
        // 单页解析失败不影响其它页面；正文留空
      }
    }
  } catch (e) {
    warnings.push({
      severity: 'warning',
      code: 'module-real-listpages-source-failed',
      message: `ListPages 读取正文失败，正文相关变量将为空: ${e.message}`,
      position: null,
    });
  }
}

/** ListPages 真实数据 */
export async function fetchRealListPages(query, requirement, ctx, opts) {
  if (!opts.client) throw new Error('未登录 Wikidot，无法真实解析 ListPages');
  const site = await getSite(opts.client, ctx.page?.site);
  const params = toSearchPagesParams(query, ctx.page, opts.caps, opts.warnings);
  const collection = unwrap(await site.pages.search(params), '查询 ListPages');
  const pages = Array.from(collection).slice(0, params.limit ?? opts.caps.listPagesMaxRows);

  let totalCount = pages.length;
  try {
    const body = {
      ...new SearchPagesQuery(params).asDict(),
      moduleName: 'list/ListPagesModule',
      module_body: '%%total%%',
    };
    const res = unwrap(await site.amcRequestSingle(body), '统计 ListPages');
    const m = /(\d+)/.exec(String(res.body ?? ''));
    if (m) totalCount = Number.parseInt(m[1], 10);
  } catch (e) {
    opts.warnings.push({
      severity: 'warning',
      code: 'module-real-listpages-total-failed',
      message: `ListPages 总数统计失败，使用当前行数: ${e.message}`,
      position: null,
    });
  }

  if (needsContent(requirement)) {
    await enrichSources(site, pages, opts.caps.listPagesSourceMax, opts.warnings);
  }

  const out = pages.map((p) => {
    const data = pageToPageData(p);
    if (p._previewText !== undefined) {
      data.content = p._previewText;
      data.readableText = p._readableText ?? '';
      data.firstParagraph = p._firstParagraph ?? '';
      if (p._charCount !== undefined) data.size = p._charCount;
    }
    return data;
  });

  if ((requirement?.metadataKeys?.length ?? 0) > 0 || (requirement?.formFields?.length ?? 0) > 0) {
    opts.warnings.push({
      severity: 'warning',
      code: 'module-real-listpages-unsupported',
      message: 'ListPages 的 metadata / form 数据暂不提供，相关变量为空',
      position: null,
    });
  }

  return {
    pages: out,
    totalCount,
    site: { title: site.title, name: site.unixName, domain: site.domain },
  };
}

/** ListUsers 真实数据（Wikidot 本身只支持当前登录用户） */
export async function fetchRealListUsers(_requirement, _ctx, opts) {
  const me = opts?.client?.me ?? null;
  if (!me) throw new Error('未登录 Wikidot，无法真实解析 ListUsers');
  return {
    user: {
      number: me.id,
      title: me.displayName || me.name,
      name: me.unixName || me.name,
    },
  };
}

function stripTags(html) {
  return String(html ?? '').replace(/<[^>]*>/g, '');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 从 Wikidot TagCloud HTML 解析标签与权重（font-size 百分比作为相对权重） */
export function parseTagAnchors(html, limit) {
  const out = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(String(html ?? ''))) !== null && out.length < limit) {
    const attrs = m[1];
    if (!/\bclass="[^"]*\btag\b[^"]*"/i.test(attrs)) continue;
    const style = /\bstyle="([^"]*)"/i.exec(attrs)?.[1] ?? '';
    const size = /font-size:\s*([\d.]+)\s*%/i.exec(style)?.[1];
    const tag = decodeEntities(stripTags(m[2])).trim();
    if (!tag) continue;
    out.push({ tag, weight: size ? Number(size) : 1 });
  }
  return out;
}

/** TagCloud 真实数据：让 Wikidot 自己渲染模块，再解析标签与相对字号 */
export async function fetchRealTagCloud(requirement, _ctx, opts) {
  if (!opts.client) throw new Error('未登录 Wikidot，无法真实解析 TagCloud');
  const site = await getSite(opts.client, opts.page?.site);
  const limit = Math.max(0, Math.min(requirement?.limit ?? opts.caps.tagCloudMaxTags, opts.caps.tagCloudMaxTags));
  if (limit === 0) return { status: 'ok', tags: [], category: null };

  const rawCategory = String(requirement?.category ?? '').replace(/["\]\[]/g, '');
  const source = `[[module TagCloud limit="${limit}"${rawCategory ? ` category="${rawCategory}"` : ''}]]`;
  const page = opts.page ?? {};
  const res = unwrap(await site.amcRequestSingle({
    moduleName: 'edit/PagePreviewModule',
    mode: 'page',
    page_unix_name: page.fullName || page.unixName || 'preview',
    revision_id: null,
    title: '',
    source,
  }), '获取 TagCloud');

  const body = String(res.body ?? '');
  if (/can not be found/i.test(stripTags(body))) {
    return { status: 'category-not-found', category: String(requirement?.category ?? '') };
  }
  return {
    status: 'ok',
    tags: parseTagAnchors(body, limit),
    category: requirement?.category ? String(requirement.category).trim().toLowerCase().replace(/[\s_]+/g, '-') : null,
  };
}

/** Rate / CustomRate 真实数据 */
export async function fetchRealRatings(refs, ctx, opts) {
  if (!opts.client) throw new Error('未登录 Wikidot，无法真实解析 Rate');
  const site = await getSite(opts.client, ctx.page?.site);
  const fullName = ctx.page?.fullName;
  if (!fullName || fullName === 'preview') {
    throw new Error('未设置页面名，无法读取评分');
  }
  const page = await getPage(site, fullName);
  if (!page) throw new Error(`页面不存在或无权访问: ${fullName}`);

  let currentVote = null;
  try {
    const votes = unwrap(await page.getVotes(), '读取投票');
    const vote = opts.client.me ? votes.findByUser(opts.client.me) : undefined;
    if (vote && [-1, 0, 1].includes(Number(vote.value))) currentVote = Number(vote.value);
  } catch (e) {
    opts.warnings.push({
      severity: 'warning',
      code: 'module-real-rate-votes-failed',
      message: `读取当前用户投票失败: ${e.message}`,
      position: null,
    });
  }

  const points = page.rating ?? 0;
  const votes = page.votesCount ?? 0;
  const percent = page.ratingPercent ?? estimatePercent(points, votes);

  return refs.map((ref) => {
    if (ref.kind === 'custom') {
      opts.warnings.push({
        severity: 'warning',
        code: 'module-real-custom-rate-unsupported',
        message: `自定义评分 ${ref.axisKey} 暂不支持真实解析，已使用占位值`,
        position: null,
      });
      return {
        ref,
        label: ref.axisKey,
        allowedVotes: [1, -1],
        canVote: false,
        canCancel: false,
        currentVote: null,
        aggregate: { points: 0, votes: 0, percent: 0 },
      };
    }
    return {
      ref,
      label: '评分',
      allowedVotes: [1, -1],
      canVote: Boolean(opts.client.me),
      canCancel: currentVote !== null,
      currentVote,
      aggregate: { points, votes, percent },
    };
  });
}
