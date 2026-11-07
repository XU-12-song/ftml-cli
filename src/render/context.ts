/**
 * context — 构造 @wdprlib 渲染所需的页面上下文
 *
 * CLI（ftml preview）与 web 渲染端点共用；未配置 site/page 时给占位值，
 * 使解析器在没有真实页面信息时也能渲染。
 */

import type { WikitextPageContext } from '@wdprlib/ast';
import type { PageContextOptions } from '../types/render/context.ts';

export function buildPageContext({ site, page }: PageContextOptions = {}): WikitextPageContext {
  const fullName = page || 'preview';
  const unixName = fullName.includes(':') ? fullName.slice(fullName.lastIndexOf(':') + 1) : fullName;
  return {
    fullName,
    unixName,
    tags: [],
    site: site || undefined,
    domain: site ? `${site}.wikidot.com` : undefined,
    urlPath: fullName === 'preview' ? undefined : `/${fullName}`,
  };
}
