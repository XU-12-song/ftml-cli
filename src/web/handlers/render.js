/**
 * handlers/render.js — 渲染与校验
 *
 * 展开模板 → @wdprlib 渲染 → 完整沙盒文档（不写 dist）；validate 只跑诊断。
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../../infra/config.js';
import { loadTemplates, expand } from '../../core/expand.js';
import { renderPreview } from '../../render/preview.js';
import { buildPreviewDocument } from '../../render/preview-page.js';
import { buildPageContext } from '../../render/context.js';
import { formatDiagnostics } from '../../render/diagnostics.js';
import { diagnosticToProblem, errorToProblem, sortProblems } from '../../render/problems.js';
import { collectProblems } from '../../commands/validate.js';
import { createClient } from '../../infra/wikidot.js';
import { loadSettings } from '../../domain/settings.js';
import { HttpError, resolveInProject, findProject, latestOnly } from './shared.js';

/** 渲染失败时的统一返回：不抛 500，把异常转成 problems 让前端定位 */
function failedRender(source, relPath, err, settings, projectRoot) {
  return {
    html: null,
    styles: null,
    diagnostics: [],
    diagnosticReport: '',
    includes: [],
    settings,
    problems: sortProblems([ errorToProblem(err, { source, file: relPath, cwd: projectRoot }) ]),
  };
}

/** 保存 + 渲染：读文件 → 展开模板 → @wdprlib 渲染 → 完整文档（不写 dist） */
export async function renderProjectFile(id, body, env = {}) {
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
      return failedRender(text, relPath, e, settings, p.root);
    }

    const page = buildPageContext({ site: config.site, page: config.page });

    const allowNetwork = body?.allowNetwork ?? settings.useRemoteInclude;

    let client = env.injectClient ?? null;
    let ownsClient = false;
    if (!client && allowNetwork) {
      try {
        client = await createClient();
        ownsClient = true;
      } catch {
        client = null; // 无凭证：远程 include 解析关闭，渲染占位
      }
    }

    try {
      checkpoint(); // 联网建客户端期间若已有更新的请求，放弃本次
      const { html, styles, htmlBlocks, diagnostics, includes } = await renderPreview(expanded, {
        page,
        styleMode: body?.styleMode ?? settings.renderStyleMode,
        includeBaseDir: path.dirname(config.sourceAbs),
        includeTemplates: templates,
        client,
        allowNetwork,
      });
      const document = buildPreviewDocument({ html, htmlBlocks, title: config.page || page.fullName });
      // 诊断来自 @wdprlib；附上带源码上下文的可读文本供前端展示
      const diagnosticReport = formatDiagnostics(diagnostics, expanded, { file: relPath });
      // @wdprlib 诊断 → 统一 problem（带偏移，前端可点击跳转）
      const problems = sortProblems(
        diagnostics.map((d) => diagnosticToProblem(d, expanded, { file: relPath }))
      );
      return { html: document, styles, diagnostics, diagnosticReport, includes, settings, problems };
    } catch (e) {
      if (e?.superseded) throw e; // 被更新的请求取代：交回 409 处理，不能当成渲染问题
      // 渲染期异常同样不做 500：转成 problems，保留堆栈供前端展开
      return failedRender(text, relPath, e, settings, p.root);
    } finally {
      if (ownsClient) await client.close?.();
    }
  });
}

export async function validateProjectFile(id, body) {
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
