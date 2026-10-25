/**
 * web-start.test.js — startWebServer 生命周期与 Electron 模式安全层
 *
 * 这些用例不需要 Electron：验证随机端口、静态资源、token cookie 引导、
 * Origin / Host 校验和幂等关闭。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startWebServer } from '../src/web/start.js';
import { makeTmpDir, cleanup, withHome } from './helpers/fixtures.js';

function projectFixture() {
  return makeTmpDir({
    '.ftmlrc.json': JSON.stringify({ site: 'scp-cn', page: 'hello' }),
    'index.ftml': '[[div]]hello[[/div]]\n',
  });
}

test('startWebServer：port 0 启动、静态资源/API 可用、close 后拒绝连接', async () => {
  const root = projectFixture();
  try {
    await withHome(async () => {
      const ctl = await startWebServer({ root, port: 0, warmTheme: false });
      assert.ok(ctl.port > 0);
      assert.ok(ctl.url.includes(`:${ctl.port}`));

      const html = await fetch(`${ctl.url}/`);
      assert.equal(html.status, 200);
      assert.match(await html.text(), /id="preview"/);

      const css = await fetch(`${ctl.url}/style.css`);
      assert.equal(css.status, 200);
      assert.match(css.headers.get('content-type'), /text\/css/);

      const projects = await fetch(`${ctl.url}/api/projects`);
      assert.equal(projects.status, 200);
      const list = await projects.json();
      assert.ok(list.some((p) => p.id === root));

      await ctl.close();
      await assert.rejects(() => fetch(`${ctl.url}/`));
    });
  } finally {
    cleanup(root);
  }
});

test('startWebServer：sessionToken 模式下 token 换 cookie、Origin/Host 校验', async () => {
  const root = projectFixture();
  try {
    await withHome(async () => {
      const ctl = await startWebServer({
        root,
        port: 0,
        warmTheme: false,
        sessionToken: 'test-token',
      });
      const base = ctl.url;

      // 无 cookie → 401
      const denied = await fetch(`${base}/api/projects`);
      assert.equal(denied.status, 401);

      // ?ftml_token=… → 302 + set-cookie；保留 project/file，去掉 token
      const boot = await fetch(`${base}/?ftml_token=test-token&project=abc&file=x.ftml`, {
        redirect: 'manual',
      });
      assert.equal(boot.status, 302);
      const setCookie = boot.headers.get('set-cookie') || '';
      assert.match(setCookie, /ftml_session=test-token/);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Strict/i);
      const location = boot.headers.get('location') || '';
      assert.match(location, /project=abc/);
      assert.match(location, /file=x\.ftml/);
      assert.ok(!location.includes('ftml_token'));

      const cookie = setCookie.split(';')[0];

      // 带 cookie → 200，并带 CSP / nosniff
      const ok = await fetch(`${base}/api/projects`, { headers: { cookie } });
      assert.equal(ok.status, 200);
      assert.match(ok.headers.get('content-security-policy') || '', /default-src 'self'/);
      assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');

      // 异源写请求 → 403
      const evil = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ root }),
      });
      assert.equal(evil.status, 403);

      // 同源写请求 → 200
      const same = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ root }),
      });
      assert.equal(same.status, 200);

      // 非法 Host → 403（fetch 无法自定义 Host，用 http.request）
      const hostStatus = await new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port: ctl.port,
          path: '/',
          headers: { Host: 'evil.example', cookie },
        }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(hostStatus, 403);

      await ctl.close();
    });
  } finally {
    cleanup(root);
  }
});
