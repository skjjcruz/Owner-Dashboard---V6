#!/usr/bin/env node
// build-trade-lab.cjs — regenerate trade-lab.html from index.html.
//
// The Trade Lab is the owner's terrain model (ruling 2026-09-03): the full app,
// pixel-identical to production, except the Trade Center runs the behavioral
// model (js/trade-calc-lab.js) instead of js/trade-calc.js. It is generated —
// never hand-edited — so the mirror cannot drift from the real page: any change
// to index.html is picked up by re-running `node scripts/build-trade-lab.cjs`
// (wired into the deploy build).
//
// Transforms applied, in order:
//   1. Access gate at the very top of <head>: only the owner's logins
//      (skjjcruz / bigloco in od_auth_v1) may render the page; everyone else is
//      bounced to the real app before any module loads. No localhost bypass —
//      the E2E rig seeds real auth, so the rig exercises the real gate.
//   2. <meta name="robots" noindex,nofollow> — the page is unlinked AND unlisted.
//   3. js/trade-calc.js -> js/trade-calc-lab.js (same data-wr-defer="trade" tag,
//      so the module loader path is identical to production).
//   4. Lab-only model modules injected as plain scripts before the engine:
//      six-tier QB rules v2, the GM engine, the points ledger, intent reads.
//   5. Corner build tag reads LAB — the one deliberate difference from "exact",
//      so the owner can always tell which world a screenshot came from.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'trade-lab.html');
const LAB_STAMP = '20260903lab1'; // bump when lab-only modules change

let html = fs.readFileSync(SRC, 'utf8');
const must = (cond, msg) => { if (!cond) { console.error('[build-trade-lab] FAILED: ' + msg); process.exit(1); } };

// 1. Owner gate — first thing inside <head>, before the CSP-adjacent scripts.
const GATE = `
    <!-- TRADE LAB GATE: this page renders only for the owner's logins. -->
    <script>
    (function () {
      try {
        var a = JSON.parse(localStorage.getItem('od_auth_v1') || 'null');
        var u = ((a && (a.sleeperUsername || a.username)) || '').toLowerCase();
        if (u !== 'skjjcruz' && u !== 'bigloco') {
          document.documentElement.style.display = 'none';
          window.location.replace('index.html');
        }
      } catch (e) {
        document.documentElement.style.display = 'none';
        window.location.replace('index.html');
      }
    })();
    </script>`;
must(html.includes('<head>'), '<head> not found');
html = html.replace('<head>', '<head>' + GATE);

// 2. noindex — right after the viewport meta.
const vp = html.match(/<meta name="viewport"[^>]*>/);
must(vp, 'viewport meta not found');
html = html.replace(vp[0], vp[0] + '\n    <meta name="robots" content="noindex,nofollow">');

// 3. Swap the trade engine. Keep every attribute (type="text/babel",
//    data-wr-defer="trade") so loading semantics match production exactly.
const engineTag = html.match(/<script type="text\/babel" data-wr-defer="trade" src="js\/trade-calc\.js\?v=[^"]*"><\/script>/);
must(engineTag, 'trade-calc.js script tag not found (index.html layout changed?)');
html = html.replace(engineTag[0],
  `<script type="text/babel" data-wr-defer="trade" src="js/trade-calc-lab.js?v=${LAB_STAMP}"></script>`);
must(!/js\/trade-calc\.js/.test(html), 'a reference to js/trade-calc.js survived the swap');

// 4. Lab model modules — plain scripts, right beside the v1 rules production loads.
const anchor = html.match(/<script src="js\/shared\/elite-skill-trade-rules\.js\?v=[^"]*"><\/script>/);
must(anchor, 'elite-skill-trade-rules.js tag not found');
html = html.replace(anchor[0], anchor[0] + `
<script src="js/shared/qb-trade-rules-v2.js?v=${LAB_STAMP}"></script>
<script src="js/shared/gm-trade-engine.js?v=${LAB_STAMP}"></script>
<script src="js/lab/points-ledger.js?v=${LAB_STAMP}"></script>
<script src="js/lab/intent-reads.js?v=${LAB_STAMP}"></script>`);

// 5. Corner tag: LAB, gold-tinted so it never reads as a production build code.
const tag = html.match(/(<div id="dhq-build-tag"[^>]*>)b\d+(<\/div>)/);
must(tag, 'dhq-build-tag not found');
html = html.replace(tag[0], tag[1].replace('rgba(255,255,255,0.30)', 'rgba(212,175,55,0.55)') + 'LAB' + tag[2]);

fs.writeFileSync(OUT, html, 'utf8');
console.log('[build-trade-lab] wrote trade-lab.html (' + html.length + ' bytes, stamp ' + LAB_STAMP + ')');
