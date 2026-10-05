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
import { collectProblems } from '../../commands/validate.js';
import { createClient } from '../../infra/wikidot.js';
import { loadSettings } from '../../domain/settings.js';
import { HttpError, resolveInProject, findProject } from './shared.js';

/** 保存 + 渲染：读文件 → 展开模板 → @wdprlib 渲染 → 完整文档（不写 dist） */
export async function renderProjectFile(id, body, env = {}) {
  const p = findProject(id);
  const relPath = body?.path;
  if (!relPath) throw new HttpError(400, '缺少 path');
  const abs = resolveInProject(p.root, relPath);
  if (!fs.existsSync(abs)) throw new HttpError(404, `文件不存在: ${relPath}`);
  const text = fs.readFileSync(abs, 'utf8');

  const config = loadConfig({
    root: p.root,
    source: relPath,
    site: body.site,
    page: body.page,
  });
  const templates = await loadTemplates(config.templatesDirAbs);
  const expanded = expand(text, templates, { baseDir: path.dirname(config.sourceAbs) });

  const page = buildPageContext({ site: config.site, page: config.page });

  const settings = loadSettings();
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
    return { html: document, styles, diagnostics, diagnosticReport, includes, settings };
  } finally {
    if (ownsClient) await client.close?.();
  }
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
