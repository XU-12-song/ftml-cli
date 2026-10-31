/**
 * module-placeholders.js — 快速预览用的合成 module 数据
 *
 * 预览追求快：不联网、不读盘，直接用设置里的样本值生成 ListPages /
 * ListUsers / TagCloud / Rate 的占位数据，让排版接近线上。
 *
 * 这里返回的函数与 @wdprlib/parser 的 dataProvider hook 签名一致，
 * 由 module-data.js 统一按模式挑选。
 */

import { DEFAULT_MODULE_PLACEHOLDERS } from '../domain/settings.js';

/** 模板里的 {n} 替换为行号（从 1 开始） */
function withIndex(template, n) {
  return String(template ?? '').replaceAll('{n}', String(n));
}

/** 标签串 → 数组（逗号 / 空白都算分隔） */
function splitTags(raw) {
  return String(raw ?? '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function placeholderSite(page) {
  const name = page?.site || 'preview';
  return {
    title: name === 'preview' ? '预览站点' : name,
    name,
    domain: `${name}.wikidot.com`,
  };
}

function placeholderUser(n, titles = false) {
  return titles
    ? { id: 1000 + n, name: withIndex('示例用户 {n}', n), unixName: `example-user-${n}` }
    : { id: 1000 + n, name: `example-user-${n}`, unixName: `example-user-${n}` };
}

/**
 * 生成 ListPages 占位数据。
 * @param {object} query NormalizedListPagesQuery
 * @param {object} opts
 */
function buildListPages(query, opts) {
  const cfg = opts.placeholders.listPages;
  const cap = opts.caps.listPagesMaxRows;
  const limit = Number.isFinite(query?.limit) ? query.limit : cap;
  const count = Math.max(0, Math.min(cfg.count, limit, cap));
  const site = placeholderSite(opts.page);
  const date = new Date(cfg.date);

  const pages = [];
  for (let i = 1; i <= count; i++) {
    const text = cfg.text;
    const name = `placeholder-${i}`;
    // ±1 评分口径：percent = (points + votes) / (2 * votes) * 100
    const votes = Math.max(5, Math.abs(cfg.rating) + 2);
    const percent = Math.min(100, Math.max(0, Math.round(((cfg.rating + votes) / (2 * votes)) * 100)));
    pages.push({
      name,
      category: '_default',
      fullname: name,
      title: withIndex(cfg.title, i),
      createdAt: date,
      createdBy: placeholderUser(i),
      updatedAt: date,
      updatedBy: placeholderUser(i),
      parentName: undefined,
      parentCategory: undefined,
      parentFullname: undefined,
      parentTitle: undefined,
      tags: splitTags(cfg.tags),
      hiddenTags: [],
      content: text,
      readableText: text,
      firstParagraph: text,
      formData: {},
      formRaw: {},
      formLabel: {},
      formHint: {},
      children: 0,
      comments: 0,
      size: text.length,
      rating: cfg.rating,
      ratingVotes: votes,
      ratingPercent: percent,
      revisions: 1,
      metadata: {},
      customRates: {},
    });
  }

  return {
    pages,
    totalCount: pages.length,
    site,
  };
}

function buildListUsers(requirement, opts) {
  const cfg = opts.placeholders.listUsers;
  const n = (Number(requirement?.id) || 0) + 1;
  return {
    user: {
      number: 1000 + n,
      title: withIndex(cfg.title, n),
      name: withIndex(cfg.name, n),
    },
  };
}

/** Wikidot 的 category 归一化：小写、空白/下划线转连字符 */
export function toUnixCategory(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function buildTagCloud(requirement, opts) {
  const cfg = opts.placeholders.tagCloud;
  const limit = Math.min(
    Number.isFinite(requirement?.limit) ? requirement.limit : cfg.count,
    opts.caps.tagCloudMaxTags
  );
  const count = Math.max(0, Math.min(cfg.count, limit));
  if (count === 0) return { status: 'ok', tags: [], category: null };

  let names = splitTags(cfg.tags);
  if (names.length === 0) {
    names = Array.from({ length: count }, (_, i) => `标签${i + 1}`);
  }
  const span = cfg.maxWeight - cfg.minWeight;
  const tags = names.slice(0, count).map((tag, i) => ({
    tag,
    weight: count <= 1 ? cfg.maxWeight : Math.round(cfg.maxWeight - (span * i) / (count - 1)),
  }));

  return {
    status: 'ok',
    tags,
    category: requirement?.category ? toUnixCategory(requirement.category) : null,
  };
}

function buildRatings(refs, opts) {
  const cfg = opts.placeholders.rate;
  const percent = cfg.votes > 0
    ? Math.min(100, Math.max(0, Math.round(((cfg.score + cfg.votes) / (2 * cfg.votes)) * 100)))
    : 0;
  return refs.map((ref) => ({
    ref,
    label: ref.kind === 'custom' ? ref.axisKey : '评分',
    allowedVotes: [1, -1],
    canVote: false,
    canCancel: false,
    currentVote: null,
    aggregate: { points: cfg.score, votes: cfg.votes, percent },
  }));
}

/**
 * 构造占位 dataProvider。
 * @param {{ placeholders?: object, page?: object, caps?: object }} opts
 */
export function buildPlaceholderFetchers(opts = {}) {
  const placeholders = opts.placeholders ?? DEFAULT_MODULE_PLACEHOLDERS;
  const ctx = { placeholders, page: opts.page, caps: opts.caps };
  return {
    fetchListPages: async (query) => buildListPages(query, ctx),
    fetchListUsers: async (requirement) => buildListUsers(requirement, ctx),
    fetchTagCloud: async (requirement) => buildTagCloud(requirement, ctx),
    fetchRatings: async (refs) => buildRatings(refs, ctx),
  };
}

/**
 * ListUsers 在 Wikidot 里只返回当前登录用户一行；占位模式想看多行布局时，
 * 把模块块复制 N 份（仅预览、仅当 count > 1）。
 */
export function applyListUsersRepeat(source, count) {
  if (!Number.isFinite(count) || count <= 1) return source;
  const re = /\[\[\s*module\s+listusers\b[^\]]*\]\][\s\S]*?\[\[\s*\/\s*module\s*\]\]/gi;
  return String(source).replace(re, (block) => Array.from({ length: count }, () => block).join('\n'));
}
