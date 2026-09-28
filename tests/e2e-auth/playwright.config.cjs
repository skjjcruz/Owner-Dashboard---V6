'use strict';
// Playwright config for the sign-in / sign-out / session / identity E2E suite.
// Run through tests/e2e-auth/run.cjs (npm run test:e2e-auth), which resolves
// Playwright, picks a free port and passes it in E2E_AUTH_PORT.
const fs = require('fs');
const path = require('path');
const { defineConfig } = require('playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
if (!process.env.E2E_AUTH_PORT) process.env.E2E_AUTH_PORT = String(41000 + (process.pid % 15000));
const PORT = Number(process.env.E2E_AUTH_PORT);
// Directory the site is served from (default: this working tree).
const SITE_ROOT = process.env.E2E_AUTH_SITE_ROOT || ROOT;

// Use Playwright's own Chromium when it is installed for this Playwright
// version; otherwise fall back to the container's /opt/pw-browsers/chromium.
function chromiumPath() {
  if (process.env.E2E_CHROMIUM) return process.env.E2E_CHROMIUM;
  try {
    const { chromium } = require('playwright');
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return undefined;
  } catch { /* fall through */ }
  return fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}

// The native app is a bare WKWebView: an iOS UA with Mobile/15E148 and no
// "Safari/" token (landing/connect detectSurface() → 'ios_app').
const IPHONE_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD_APP_UA = 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

module.exports = defineConfig({
  testDir: path.join(__dirname, 'specs'),
  testMatch: /.*\.spec\.cjs$/,
  outputDir: path.join(ROOT, 'output', 'e2e-auth'),
  globalSetup: path.join(__dirname, 'lib', 'global-setup.cjs'),
  fullyParallel: true,
  workers: process.env.E2E_AUTH_WORKERS ? Number(process.env.E2E_AUTH_WORKERS) : 3,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['list'], ['json', { outputFile: path.join(ROOT, 'output', 'e2e-auth', 'results.json') }]]
    : [['list'], ['json', { outputFile: path.join(ROOT, 'output', 'e2e-auth', 'results.json') }]],
  use: {
    headless: true,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: chromiumPath(),
      // dhq.test → 127.0.0.1 so the site runs on a non-localhost host (gates ON).
      // No proxy: every non-app request is intercepted by page routes anyway.
      args: ['--host-resolver-rules=MAP dhq.test 127.0.0.1', '--no-proxy-server'],
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 860 } } },
    { name: 'iphone-app', grep: /@native/, use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_APP_UA } },
    { name: 'ipad-app', grep: /@native/, use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_APP_UA } },
  ],
  webServer: {
    command: `node scripts/serve-static.cjs --host=127.0.0.1 --port=${PORT} --root=${JSON.stringify(SITE_ROOT)} --compile`,
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}/landing.html`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
