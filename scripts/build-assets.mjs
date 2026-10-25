/**
 * build-assets.mjs — 从 SVG masters 生成 PNG / ICO
 *
 *   npm run assets:build
 *
 * 生成物提交到仓库；CI 不运行本脚本（避免字体/平台差异导致图片漂移）。
 * 需要本机有 Segoe UI（封面文字），Windows 自带。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTERS = path.join(ROOT, 'assets', 'masters');
const ICONS = path.join(ROOT, 'assets', 'icons');
const COVER = path.join(ROOT, 'assets', 'cover');

const ICO_SIZES = {
  app: [16, 24, 32, 48, 64, 128, 256],
  file: [16, 24, 32, 48, 64, 128, 256],
  tray: [16, 24, 32],
};

function renderPng(master, width) {
  const svg = fs.readFileSync(path.join(MASTERS, master), 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'transparent',
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  });
  return Buffer.from(resvg.render().asPng());
}

function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function writePng(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  const { width, height } = pngSize(buf);
  console.log(`  ${path.relative(ROOT, file)}  ${width}x${height}`);
}

async function writeIco(file, master, sizes) {
  const buffers = sizes.map((size) => renderPng(master, size));
  const ico = await pngToIco(buffers);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ico);
  console.log(`  ${path.relative(ROOT, file)}  ${sizes.join('/')}`);
}

async function main() {
  console.log('app icon:');
  writePng(path.join(ICONS, 'app', 'ftml-256.png'), renderPng('app-icon.svg', 256));
  writePng(path.join(ICONS, 'app', 'ftml-512.png'), renderPng('app-icon.svg', 512));
  writePng(path.join(ICONS, 'app', 'ftml-1024.png'), renderPng('app-icon.svg', 1024));
  await writeIco(path.join(ICONS, 'app', 'ftml.ico'), 'app-icon.svg', ICO_SIZES.app);

  console.log('file icon:');
  writePng(path.join(ICONS, 'file', 'ftml-file-256.png'), renderPng('file-icon.svg', 256));
  await writeIco(path.join(ICONS, 'file', 'ftml.ico'), 'file-icon.svg', ICO_SIZES.file);

  console.log('tray icon:');
  writePng(path.join(ICONS, 'tray', 'tray-16.png'), renderPng('tray-icon.svg', 16));
  writePng(path.join(ICONS, 'tray', 'tray-32.png'), renderPng('tray-icon.svg', 32));
  await writeIco(path.join(ICONS, 'tray', 'tray.ico'), 'tray-icon.svg', ICO_SIZES.tray);

  console.log('cover:');
  writePng(path.join(COVER, 'ftml-cover-1600x900.png'), renderPng('cover-1600x900.svg', 1600));
  writePng(path.join(COVER, 'ftml-cover-1280x640.png'), renderPng('cover-1280x640.svg', 1280));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
