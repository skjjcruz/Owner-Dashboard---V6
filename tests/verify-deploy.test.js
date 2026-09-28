// Run with:  node --test tests/verify-deploy.test.js
// scripts/verify-deploy.cjs against a local Pages-like server (query string
// ignored, like GitHub Pages) with a switchable deploy state.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { verify, verifyOnce, scriptSrcs, metaBuild } = require('../scripts/verify-deploy.cjs');

const h = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
const BUILD = 'b200-0123456789';
const files = {
  'js/core.js': 'window.core = 1;\n',
  'js/app.js': 'window.app = 2;\n',
  'reconai-shared/tier.js': 'window.tier = 3;\n',
};
const page = (build, appHash = h(files['js/app.js'])) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="dhq-build" content="${build}">
<script src="js/core.js?v=${h(files['js/core.js'])}"></script>
<script src="https://cdn.example.com/lib.js"></script></head>
<body><script type="text/wr-deferred" src="js/app.js?v=${appHash}"></script></body></html>`;
const landing = build => `<html><head><meta name="dhq-build" content="${build}"><script src="js/core.js?v=${h(files['js/core.js'])}"></script></head></html>`;
function versionJson(build) {
  const idx = page(build), land = landing(build);
  return {
    build, builtAt: new Date().toISOString(),
    pages: {
      'index.html': [`js/core.js?v=${h(files['js/core.js'])}`, `js/app.js?v=${h(files['js/app.js'])}`, 'reconai-shared/tier.js?v=stamp00001'],
      'landing.html': [`js/core.js?v=${h(files['js/core.js'])}`],
    },
    assets: {
      'js/core.js': h(files['js/core.js']), 'js/app.js': h(files['js/app.js']), 'reconai-shared/tier.js': h(files['reconai-shared/tier.js']),
      'index.html': h(idx), 'landing.html': h(land),
    },
  };
}

let state = 'ok', hits = [];
const server = http.createServer((req, res) => {
  let p = new URL(req.url, 'http://x').pathname.replace(/^\//, '') || 'index.html';
  hits.push(p);
  const send = (code, body) => { res.writeHead(code, { 'Cache-Control': 'max-age=600' }); res.end(body); };
  if (state === 'old-version' && p === 'version.json') return send(200, JSON.stringify(versionJson('b199-aaaaaaaaaa')));
  if (p === 'version.json') return send(200, JSON.stringify(versionJson(BUILD)));
  if (p === 'index.html') return send(200, page(state === 'stale-index' ? 'b199-aaaaaaaaaa' : BUILD));
  if (p === 'landing.html') return send(200, landing(BUILD));
  if (state === 'app-404' && p === 'js/app.js') return send(404, 'nf');
  if (state === 'app-stale' && p === 'js/app.js') return send(200, 'window.app = 1; // old\n');
  if (state === 'tier-hang' && p === 'reconai-shared/tier.js') return; // never answers
  if (files[p]) return send(200, files[p]);
  send(404, 'nf');
});
let url;
test.before(() => new Promise(r => server.listen(0, '127.0.0.1', () => { url = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.closeAllConnections(); server.close(); });
const quiet = { log: () => {} };

test('helpers: same-origin scripts only; meta build', () => {
  assert.deepEqual(scriptSrcs(page(BUILD)), [`js/core.js?v=${h(files['js/core.js'])}`, `js/app.js?v=${h(files['js/app.js'])}`]);
  assert.equal(metaBuild(page(BUILD)), BUILD);
  assert.equal(metaBuild('<html></html>'), null);
});

test('fully served build: ok — pages ("/" too) and every asset fetched once', async () => {
  state = 'ok'; hits = [];
  const r = await verify({ url, build: BUILD, timeoutMs: 0, ...quiet });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(r.pages, 3, 'index.html, /, landing.html');
  assert.equal(r.assets, 3);
  assert.ok(hits.includes('reconai-shared/tier.js'), 'version.json-listed assets are checked too');
});

test('one asset 404 → fails naming it', async () => {
  state = 'app-404';
  const r = await verify({ url, build: BUILD, timeoutMs: 0, ...quiet });
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, [`js/app.js?v=${h(files['js/app.js'])}: HTTP 404`]);
});

test('stale bytes behind a new ?v= → content hash mismatch', async () => {
  state = 'app-stale';
  const r = await verifyOnce({ url, build: BUILD });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /js\/app\.js\?v=\w+: content hash \w+, expected \w+ \(stale or wrong file\)/);
});

test('version.json / page still on the old build', async () => {
  state = 'old-version';
  let r = await verifyOnce({ url, build: BUILD });
  assert.deepEqual([r.stage, r.problems], ['version', [`version.json serves b199-aaaaaaaaaa, expected ${BUILD}`]]);
  state = 'stale-index';
  r = await verifyOnce({ url, build: BUILD });
  assert.ok(r.problems.includes(`index.html: serves build b199-aaaaaaaaaa, expected ${BUILD}`), r.problems.join('; '));
  assert.ok(r.problems.includes(`/: serves build b199-aaaaaaaaaa, expected ${BUILD}`));
});

test('a stalled asset times out instead of hanging the run', async () => {
  state = 'tier-hang';
  const r = await verifyOnce({ url, build: BUILD, requestTimeoutMs: 300 });
  assert.deepEqual(r.problems, ['reconai-shared/tier.js?v=stamp00001: timeout']);
});

test('polls until the deploy lands, then passes', async () => {
  state = 'app-404';
  setTimeout(() => { state = 'ok'; }, 250);
  const lines = [];
  const r = await verify({ url, build: BUILD, timeoutMs: 5000, intervalMs: 100, log: l => lines.push(l) });
  assert.equal(r.ok, true);
  assert.ok(lines.length >= 2, 'reported the failing pass first');
});

test('CLI: exit 0 when served, 1 with a clear report when not', async () => {
  const cli = path.join(__dirname, '..', 'scripts', 'verify-deploy.cjs');
  const run = () => new Promise(resolve => {
    const p = spawn(process.execPath, [cli, '--url', url, '--build', BUILD, '--timeout', '0'], { env: { ...process.env, GITHUB_ACTIONS: '' } });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
  });
  state = 'ok';
  let r = await run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /OK: .* serves b200-0123456789/);
  state = 'app-404';
  r = await run();
  assert.equal(r.code, 1);
  assert.match(r.out, /FAILED: .* is not serving b200-0123456789 completely/);
  assert.match(r.out, /js\/app\.js\?v=\w+: HTTP 404/);
});
