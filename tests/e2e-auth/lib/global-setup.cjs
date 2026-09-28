'use strict';
// Warm serve-static's --compile cache (Babel transpiles every text/babel
// script of index.html on first request) so the first tests don't pay the
// multi-second compile inside their 8 s I1 budget.
const fs = require('fs');
const path = require('path');

module.exports = async function globalSetup() {
  const port = Number(process.env.E2E_AUTH_PORT);
  const root = process.env.E2E_AUTH_SITE_ROOT || path.resolve(__dirname, '..', '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*type="text\/babel"[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const base = `http://127.0.0.1:${port}/`;
  await fetch(base + 'index.html').then(r => r.text()).catch(() => {});
  for (let i = 0; i < srcs.length; i += 8) {
    await Promise.all(srcs.slice(i, i + 8).map(s => fetch(base + s.replace(/^\.?\//, '')).then(r => r.text()).catch(() => {})));
  }
};
