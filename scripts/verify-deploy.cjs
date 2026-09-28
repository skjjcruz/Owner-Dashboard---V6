#!/usr/bin/env node
// verify-deploy.cjs — prove the LIVE site serves this build completely.
//
// Runs after the Pages deploy step (.github/workflows/deploy.yml) and locally:
//
//   node scripts/verify-deploy.cjs                       # CNAME site vs dist-deploy/version.json
//   node scripts/verify-deploy.cjs --url http://127.0.0.1:3002 --expect dist-deploy/version.json
//   node scripts/verify-deploy.cjs --build b145-0123456789 --timeout 300
//
// Until the deadline (default 5 min) it repeatedly:
//   1. fetches version.json (cache-busted, like live-update.js) until its build
//      is the expected one;
//   2. fetches every self-updating page (plain URL, as users get it; index.html
//      also as "/") and checks its <meta name="dhq-build"> and content hash;
//   3. fetches every same-origin script those pages boot with — version.json's
//      `pages` lists plus the <script src> in the served HTML — at the exact
//      URL browsers request, and compares the sha256[:10] of the bytes with
//      version.json's `assets` map (else the ?v= build hash).
// All good → exit 0. Still wrong at the deadline → a clear report, exit 1.
// Why: 2026-09-28 "website down" — a page reloaded onto a build whose new
// script wasn't served yet sat on "Module Load Error" with nothing reported.

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const hash = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    o[m[1]] = m[2] != null ? m[2] : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return o;
}

function siteFromCname() {
  try {
    const host = fs.readFileSync(path.join(ROOT, 'CNAME'), 'utf8').trim().split(/\s+/)[0];
    return host ? `https://${host}` : null;
  } catch (e) { return null; }
}

function metaBuild(html) {
  const m = /<meta\s+name=["']dhq-build["']\s+content=["']([^"']+)["']/i.exec(html || '');
  return m ? m[1] : null;
}

function scriptSrcs(html) {
  const out = [], re = /<script\b[^>]*?\bsrc=(["'])([^"']+)\1/gi;
  let m;
  while ((m = re.exec(html || ''))) if (!/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(m[2])) out.push(m[2]);
  return out;
}

const assetPath = u => u.split(/[?#]/)[0].replace(/^\.?\//, '');

async function get(url, timeoutMs) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, buf };
  } catch (e) {
    return { status: 0, error: e && e.name === 'TimeoutError' ? 'timeout' : String((e && e.cause && e.cause.code) || (e && e.message) || e) };
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

// One full pass. Returns { ok, stage, problems[], build, pages, assets }.
async function verifyOnce(opts) {
  const base = opts.url.replace(/\/+$/, '') + '/';
  const t = opts.requestTimeoutMs || 20000;
  const problems = [];
  const vr = await get(`${base}version.json?verify=${Date.now()}`, t);
  if (vr.status !== 200) return { ok: false, stage: 'version', problems: [`version.json: ${vr.error || 'HTTP ' + vr.status}`] };
  let live;
  try { live = JSON.parse(vr.buf.toString('utf8')); } catch (e) { return { ok: false, stage: 'version', problems: ['version.json: not JSON'] }; }
  const want = opts.build || (opts.expected && opts.expected.build) || live.build;
  if (live.build !== want) return { ok: false, stage: 'version', problems: [`version.json serves ${live.build}, expected ${want}`] };

  const ref = opts.expected && opts.expected.pages ? opts.expected : live; // the map to trust
  const map = ref.assets || {};
  const pageNames = Object.keys(ref.pages || {}).length ? Object.keys(ref.pages) : ['index.html'];
  const urls = new Map(); // asset url -> expected hash
  const addAsset = u => { if (!urls.has(u)) { const v = /[?&]v=([0-9a-f]{10})(?:&|$)/.exec(u); urls.set(u, map[assetPath(u)] || (v ? v[1] : null)); } };

  const pageUrls = [];
  for (const p of pageNames) {
    pageUrls.push({ page: p, url: base + p });
    if (p === 'index.html') pageUrls.push({ page: p, url: base });
  }
  await pool(pageUrls, opts.concurrency || 8, async ({ page, url }) => {
    const r = await get(url, t);
    const label = url === base ? '/' : page;
    if (r.status !== 200) { problems.push(`${label}: ${r.error || 'HTTP ' + r.status}`); return; }
    const html = r.buf.toString('utf8'), b = metaBuild(html);
    if (b !== want) problems.push(`${label}: serves build ${b || '(none)'}, expected ${want}`);
    else if (map[page] && hash(r.buf) !== map[page]) problems.push(`${label}: content hash ${hash(r.buf)}, expected ${map[page]}`);
    for (const u of scriptSrcs(html)) addAsset(u);
  });
  for (const p of pageNames) for (const u of (ref.pages && ref.pages[p]) || []) addAsset(u);

  const list = [...urls];
  await pool(list, opts.concurrency || 8, async ([u, expect]) => {
    const r = await get(base + u.replace(/^\.?\//, ''), t);
    if (r.status !== 200) { problems.push(`${u}: ${r.error || 'HTTP ' + r.status}`); return; }
    if (expect && hash(r.buf) !== expect) problems.push(`${u}: content hash ${hash(r.buf)}, expected ${expect} (stale or wrong file)`);
  });
  problems.sort();
  return { ok: problems.length === 0, stage: problems.length ? 'assets' : 'done', problems, build: want, pages: pageUrls.length, assets: list.length };
}

// Poll until everything checks out or the deadline passes.
async function verify(opts) {
  const log = opts.log || console.log;
  const deadline = Date.now() + (opts.timeoutMs != null ? opts.timeoutMs : 300000);
  let last, pass = 0;
  for (;;) {
    pass++;
    last = await verifyOnce(opts);
    if (last.ok) {
      log(`[verify-deploy] OK: ${opts.url} serves ${last.build} — ${last.pages} pages, ${last.assets} assets, all 200 with matching hashes (pass ${pass})`);
      return last;
    }
    const left = deadline - Date.now();
    log(`[verify-deploy] pass ${pass}: ${last.problems.length} problem(s) at ${last.stage} — ${last.problems.slice(0, 3).join('; ')}${last.problems.length > 3 ? ' …' : ''}`);
    if (left <= 0) break;
    await sleep(Math.min(opts.intervalMs || 10000, left));
  }
  return last;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const url = a.url || process.env.DHQ_SITE_URL || siteFromCname();
  if (!url) { console.error('[verify-deploy] no --url and no CNAME'); process.exit(2); }
  let expected = null;
  const expectPath = a.expect || (fs.existsSync(path.join(ROOT, 'dist-deploy', 'version.json')) ? path.join(ROOT, 'dist-deploy', 'version.json') : null);
  if (expectPath && !a.build) {
    try { expected = JSON.parse(fs.readFileSync(path.resolve(expectPath), 'utf8')); } catch (e) { console.error(`[verify-deploy] cannot read ${expectPath}: ${e.message}`); process.exit(2); }
  }
  const num = (v, d) => (v != null && v !== '' && Number.isFinite(+v) && +v >= 0 ? +v : d);
  const opts = {
    url, expected, build: a.build || null,
    timeoutMs: num(a.timeout, 300) * 1000, intervalMs: num(a.interval, 10) * 1000,
    concurrency: Math.max(1, num(a.concurrency, 8)), requestTimeoutMs: num(a['request-timeout'], 20) * 1000,
  };
  console.log(`[verify-deploy] ${url}: waiting up to ${opts.timeoutMs / 1000}s for ${opts.build || (expected && expected.build) || 'the live build'} to be fully served`);
  const r = await verify(opts);
  if (r.ok) return;
  const gh = !!process.env.GITHUB_ACTIONS;
  console.error('');
  console.error(`[verify-deploy] FAILED: ${url} is not serving ${r.build || opts.build || (expected && expected.build)} completely after ${opts.timeoutMs / 1000}s.`);
  console.error('Running pages will NOT reload onto it (live-update checks the same files), but anyone opening the site now may get a broken or mixed build.');
  for (const p of r.problems) console.error(`  - ${p}`);
  if (gh) console.log(`::error title=Deploy verification failed::${r.problems.length} problem(s): ${r.problems.slice(0, 5).join(' | ')}`);
  process.exit(1);
}

module.exports = { verify, verifyOnce, metaBuild, scriptSrcs, siteFromCname };
if (require.main === module) main().catch(e => { console.error('[verify-deploy] crashed:', e); process.exit(1); });
