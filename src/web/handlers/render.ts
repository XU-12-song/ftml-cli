/**
 * handlers/render.js — 渲染与校验
 *
 * 展开模板 → @wdprlib 渲染 → 完整沙盒文档（不写 dist）；validate 只跑诊断。
 *
 * 返回形状由 body.full 控制：
 *   full !== false（默认）→ html = 完整文档，供首次加载（CLI/测试同样走这条）
 *   full === false        → html = null，只回正文片段 fragment + styles/htmlBlocks/title，
 *                           供前端原地补丁（见 preview-page.js 的 __ftmlPatch）
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../../infra/config.js';
import { loadTemplates, expand } from '../../core/expand.js';
import { renderPreview } from '../../render/preview.js';
import { buildPreviewDocument } from '../../render/preview-page.js';
import {
  getThemeRefreshFailure,
  readThemeCss,
  refreshThemeCss,
  refreshThemeCssInBackground,
  THEME_SOURCES,
} from '../../render/theme.js';
import {
  getLayoutFailure,
  getSiteLayout,
  normalizeSiteName,
  refreshSiteLayout,
} from '../../infra/layout.js';
import { buildPageContext } from '../../render/context.js';
import { formatDiagnostics } from '../../render/diagnostics.js';
import { diagnosticToProblem, errorToProblem, sortProblems } from '../../render/problems.js';
import { collectProblems } from '../../commands/validate.js';
import { createClient } from '../../infra/wikidot.js';
import { loadSettings } from '../../domain/settings.js';
import { HttpError, resolveInProject, findProject, latestOnly, SupersededError } from './shared.js';
import type { Settings } from '../../types/domain/settings.ts';
import type { CollectedProblems } from '../../types/commands/validate.ts';
import type { HandlerEnv } from '../../types/web/handlers/shared.ts';
import type {
  RenderBody,
  RenderResult,
  RenderWarning,
  ValidateBody,
} from '../../types/web/handlers/render.ts';

/**
 * 首次缺主题缓存时，最多等这么久拿错误信息（拿不到就继续后台抓取）。
 * 网络被阻断时通常很快失败，可以当场 toast；慢网络则立即回退，不拖住预览。
 */
const THEME_INITIAL_WAIT_MS = 1000;

function delay(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    // 不让等待计时器拖住进程退出
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
  });
}

function themeErrorText(errors: { url: string; message: string }[]): string {
  return errors
    .map((e) => {
      let host = e.url;
      try { host = new URL(e.url).host; } catch { /* 保留原 URL */ }
      return `${host}：${e.message}`;
    })
    .join('；');
}

/** 渲染失败时的统一返回：不抛 500，把异常转成 problems 让前端定位 */
function failedRender(
  source: string,
  relPath: string,
  err: Error,
  settings: Settings,
  projectRoot: string,
): RenderResult {
  return {
    html: null,
    fragment: null, // 与「成功但只回片段」区分：前端据此判定渲染失败
    styles: null,
    diagnostics: [],
    diagnosticReport: '',
    includes: [],
    settings,
    problems: sortProblems([ errorToProblem(err, { source, file: relPath, cwd: projectRoot }) ]),
  };
}

/** 保存 + 渲染：读文件 → 展开模板 → @wdprlib 渲染 → 完整文档（不写 dist） */
export async function renderProjectFile(
  id: string,
  body: RenderBody,
  env: HandlerEnv = {},
): Promise<RenderResult> {
  const p = findProject(id);
  const relPath = body?.path;
  if (!relPath) throw new HttpError(400, '缺少 path');
  const abs = resolveInProject(p.root, relPath);
  if (!fs.existsSync(abs)) throw new HttpError(404, `文件不存在: ${relPath}`);

  // 同一(项目,文件)上只保留最新一次渲染：连发时旧的直接放弃，避免 CPU 白做+排队拖后
  return latestOnly(`${p.id}::${relPath}`, async (checkpoint) => {
    const text = fs.readFileSync(abs, 'utf8');

    const config = loadConfig({
      root: p.root,
      source: relPath,
      site: body.site,
      page: body.page,
    });
    const templates = await loadTemplates(config.templatesDirAbs);
    checkpoint(); // 等磁盘期间若已有更新的渲染请求，放弃本次

    const settings = loadSettings();

    // 模板展开失败（缺参数 / 循环 / 组件读不到等）不抛 500：转成 problems 让前端跳转到出错行
    let expanded;
    try {
      expanded = expand(text, templates, {
        baseDir: path.dirname(config.sourceAbs),
        file: relPath,
      });
    } catch (e) {
      return failedRender(text, relPath, e as Error, settings, p.root);
    }

    const page = buildPageContext({ site: config.site, page: config.page });

    // 编辑态默认不联网：自动预览只解析本地 .ftml + 磁盘缓存，避免每次落盘都
    // 建客户端登录 + 发远程请求。只有前端显式请求（手动刷新 allowNetwork:true）
    // 才联网，且仍受 settings.useRemoteInclude 总开关约束。
    const allowNetwork = body?.allowNetwork === true && settings.useRemoteInclude;
    // 真实解析 module 是一次性、显式触发的联网操作，与 include 的联网开关相互独立。
    const resolveModules = body?.resolveModules === true;

    let client = env.injectClient ?? null;
    let clientError: Error | null = null;
    let ownsClient = false;
    if (!client && (allowNetwork || resolveModules)) {
      try {
        // clientFactory 供测试注入（与 versions/deploy 的注入方式一致）
        client = await (env.clientFactory ?? createClient)();
        ownsClient = true;
      } catch (e) {
        client = null;
        // 不要静默：把「为什么连不上远程」带到诊断里，前端问题面板会展示
        clientError = e as Error;
      }
    }

    try {
      checkpoint(); // 联网建客户端期间若已有更新的请求，放弃本次
      const { html, styles, htmlBlocks, diagnostics, includes, moduleResolution } = await renderPreview(expanded, {
        page,
        styleMode: (body?.styleMode ?? settings.renderStyleMode) as 'inline' | 'separate',
        includeBaseDir: path.dirname(config.sourceAbs),
        includeTemplates: templates,
        client,
        allowNetwork,
        clientError,
        moduleMode: resolveModules ? 'real' : 'placeholder',
        modulePlaceholders: settings.modulePlaceholders,
      });
      const title = config.page || page.fullName;
      const wantFull = body?.full !== false;
      const warnings: RenderWarning[] = [];
      let document: string | null = null;
      let layoutSite: string | undefined;
      if (wantFull) {
        // 站点结构/主题只在完整文档时处理：片段补丁路径保持零网络、零磁盘布局读取。
        layoutSite = normalizeSiteName(config.site);
        const fetchImpl = env.fetchImpl;
        // 缓存优先：有缓存立即返回（过期则后台刷新）；只有完全没有缓存才等待。
        // refreshLayout 仅用于显式的「强制同步」，普通站点切换不再触发。
        // 某站点本会话已失败时不再等待下一次超时，直接回退内置外壳。
        const refreshed = body?.refreshLayout
          ? await refreshSiteLayout(layoutSite, { fetchImpl })
          : null;
        const layout = refreshed ? refreshed.layout : await getSiteLayout(layoutSite, { fetchImpl });
        if (!layout) {
          const reason = refreshed?.error ?? getLayoutFailure(layoutSite);
          if (reason) {
            warnings.push({
              code: 'layout-network-error',
              site: layoutSite,
              message: `无法获取站点「${layoutSite}」的页面结构（${reason}）。已使用内置外壳继续；本会话不再自动重试，可用「联网刷新」重试。`,
            });
          }
        }
        checkpoint(); // 联网获取布局期间若已有更新的请求，放弃本次

        // 主题缓存优先：命中就直接内联；缺失或过期时先用远程 @import 立即出图，
        // 同时后台抓取整条 @import 链，下一次整篇重载再使用内联缓存。
        const themeSources = layout?.themes?.length ? layout.themes : THEME_SOURCES;
        let theme = readThemeCss({ sources: themeSources });
        if (body?.refreshLayout) {
          const refreshedTheme = await refreshThemeCss({ sources: themeSources, fetchImpl });
          theme = readThemeCss({ sources: themeSources });
          if (refreshedTheme.errors.length) {
            warnings.push({
              code: 'theme-network-error',
              site: layoutSite,
              message: `无法获取站点「${layoutSite}」的主题样式（${themeErrorText(refreshedTheme.errors)}）。已回退远程/默认样式，可用「联网刷新」重试。`,
            });
          }
        } else if (theme.missing.length || theme.stale) {
          const knownFailure = getThemeRefreshFailure(themeSources);
          if (theme.missing.length && knownFailure) {
            warnings.push({
              code: 'theme-network-error',
              site: layoutSite,
              message: `无法获取站点「${layoutSite}」的主题样式（${knownFailure}）。已回退远程/默认样式；本会话不再自动重试，可用「联网刷新」重试。`,
            });
          } else {
            const task = refreshThemeCssInBackground({ sources: themeSources, fetchImpl });
            // 只影响提示时机，不影响回退：最多等一小会儿拿错误，拿不到就继续后台抓。
            if (theme.missing.length && task) {
              const result = await Promise.race([ task, delay(THEME_INITIAL_WAIT_MS) ]);
              if (result?.errors.length) {
                warnings.push({
                  code: 'theme-network-error',
                  site: layoutSite,
                  message: `无法获取站点「${layoutSite}」的主题样式（${themeErrorText(result.errors)}）。已回退远程/默认样式；本会话不再自动重试，可用「联网刷新」重试。`,
                });
              }
            }
          }
        }
        document = buildPreviewDocument({
          html,
          htmlBlocks,
          styles,
          title,
          themeCss: theme.css,
          layout,
          themeSources,
        });
      }
      // 诊断来自 @wdprlib；附上带源码上下文的可读文本供前端展示
      const diagnosticReport = formatDiagnostics(diagnostics, expanded, { file: relPath });
      // @wdprlib 诊断 → 统一 problem（带偏移，前端可点击跳转）
      const problems = sortProblems(
        diagnostics.map((d) => diagnosticToProblem(d, expanded, { file: relPath }))
      );
      return {
        html: document,
        fragment: html,
        htmlBlocks,
        styles,
        title,
        diagnostics,
        diagnosticReport,
        includes,
        settings,
        moduleResolution,
        problems,
        layoutSite,
        warnings,
      };
    } catch (e) {
      if (e instanceof SupersededError) throw e; // 被更新的请求取代：交回 409 处理，不能当成渲染问题
      // 渲染期异常同样不做 500：转成 problems，保留堆栈供前端展开
      return failedRender(text, relPath, e as Error, settings, p.root);
    } finally {
      if (ownsClient) await client?.close?.();
    }
  });
}

export async function validateProjectFile(id: string, body: ValidateBody): Promise<CollectedProblems> {
  const p = findProject(id);
  const relPath = body?.path;
  if (!relPath) throw new HttpError(400, '缺少 path');
  const abs = resolveInProject(p.root, relPath);
  if (!fs.existsSync(abs)) throw new HttpError(404, `文件不存在: ${relPath}`);
  const text = fs.readFileSync(abs, 'utf8');
  const config = loadConfig({ root: p.root, source: relPath });
  const templates = await loadTemplates(config.templatesDirAbs);
  return collectProblems(text, templates, path.dirname(config.sourceAbs));
}
