#!/usr/bin/env node
'use strict';
// Launcher for the sign-in lifecycle E2E suite:  npm run test:e2e-auth [-- <playwright args>]
//
// Resolves Playwright from the repo's node_modules first, then NODE_PATH,
// then the global npm root (the container ships it globally, not in this
// repo), picks a free port, and runs `playwright test` with this folder's
// config. Never installs browsers.
const { spawn, execSync } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');

function candidates() {
  const out = [path.join(ROOT, 'node_modules')];
  for (const p of (process.env.NODE_PATH || '').split(path.delimiter)) if (p) out.push(p);
  try { out.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch { /* no npm */ }
  return out;
}

function findPlaywright() {
  for (const dir of candidates()) {
    const pkg = path.join(dir, 'playwright', 'package.json');
    if (fs.existsSync(pkg)) return { dir, cli: path.join(dir, 'playwright', 'cli.js'), version: require(pkg).version };
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

(async () => {
  const pw = findPlaywright();
  if (!pw) {
    console.error('[e2e-auth] Playwright not found. Install it (npm i -D playwright) or put it on NODE_PATH. Browsers are not installed by this script.');
    process.exit(2);
  }
  const port = process.env.E2E_AUTH_PORT || String(await freePort());
  // --ref=<git ref>: serve a clean snapshot of that commit instead of the
  // working tree (useful while someone else is editing the app). The
  // gitignored vendor mirror reconai-shared/ is copied from the working tree.
  let argv = process.argv.slice(2);
  const refArg = argv.find(a => a.startsWith('--ref='));
  // --shared-ref=<ref>: with --ref, vendor DHQ-Shared at that ref (from
  // $DHQ_SHARED_SOURCE or ../DHQ-Shared) instead of copying reconai-shared/.
  const sharedArg = argv.find(a => a.startsWith('--shared-ref='));
  argv = argv.filter(a => a !== refArg && a !== sharedArg);
  let siteRoot = process.env.E2E_AUTH_SITE_ROOT || '';
  if (refArg) {
    const ref = refArg.slice('--ref='.length);
    const sha = execSync(`git rev-parse ${ref}`, { cwd: ROOT }).toString().trim();
    siteRoot = path.join(require('os').tmpdir(), 'dhq-e2e-auth-site-' + sha.slice(0, 12));
    fs.rmSync(siteRoot, { recursive: true, force: true });
    fs.mkdirSync(siteRoot, { recursive: true });
    execSync(`git archive --format=tar ${sha} | tar -x -C "${siteRoot}"`, { cwd: ROOT, shell: '/bin/sh' });
    const vendor = path.join(siteRoot, 'reconai-shared');
    if (sharedArg) {
      const sref = sharedArg.slice('--shared-ref='.length);
      const src = process.env.DHQ_SHARED_SOURCE || path.resolve(ROOT, '..', 'DHQ-Shared');
      const ssha = execSync(`git rev-parse ${sref}`, { cwd: src }).toString().trim();
      fs.mkdirSync(vendor, { recursive: true });
      execSync(`git archive --format=tar ${ssha} | tar -x -C "${vendor}"`, { cwd: src, shell: '/bin/sh' });
      console.log(`[e2e-auth] reconai-shared = ${src} @ ${sref} (${ssha.slice(0, 9)})`);
    } else if (fs.existsSync(path.join(ROOT, 'reconai-shared'))) {
      fs.cpSync(path.join(ROOT, 'reconai-shared'), vendor, { recursive: true });
    }
    console.log(`[e2e-auth] serving snapshot of ${ref} (${sha.slice(0, 9)}) from ${siteRoot}`);
  }
  const env = { ...process.env, E2E_AUTH_PORT: port, E2E_AUTH_SITE_ROOT: siteRoot, NODE_PATH: [pw.dir, process.env.NODE_PATH].filter(Boolean).join(path.delimiter) };
  if (!env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
  console.log(`[e2e-auth] playwright ${pw.version} from ${pw.dir}; serving on 127.0.0.1:${port} as http://dhq.test:${port}/`);
  const args = [pw.cli, 'test', '-c', path.join(__dirname, 'playwright.config.cjs'), ...argv];
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
  child.on('exit', code => process.exit(code == null ? 1 : code));
})();
