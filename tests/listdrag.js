#!/usr/bin/env node
// Contract test for WR.listDrag — the transform-based row reorder behind the
// Draft-tab board's finger drags (js/components/wr-primitives.js).
//
// The fixture mirrors the real board: a sticky table header, fixed-height grid
// rows carrying data-reorder-key, and a non-keyed ROUND divider mid-list. It
// is wired exactly the way js/draft-room.js wires it — row dragstart → start,
// CONTAINER dragover → over, CONTAINER drop → target()/end() + commit, row
// dragend → end — and driven with synthetic DragEvents against the real
// engine source. No app boot, no network.
//
// Behavior pinned here (owner calls, 2026-08-18/19):
//   • A drop lands the player in the open slot under the finger, so nudging
//     him ONE row down works — the 2026-08-19 screen recording showed the old
//     insert-before-hovered-row rule made that a no-op.
//   • The landing spot and everything below it step DOWN to make room.
//     Nothing ever slides up.
//   • The list's LAYOUT is never mutated mid-drag — WebKit ends a native drag
//     whose source folds, hides, or reflows (three shipped regressions).
//
// Run: PLAYWRIGHT_CHROME_PATH=<chrome> node tests/listdrag.js
'use strict';
const fs = require('fs');
const path = require('path');

let chromium;
try {
  chromium = require('playwright').chromium;
} catch (_e) {
  try {
    chromium = require('@playwright/test').chromium;
  } catch (_e2) {
    console.log('SKIP listDrag - playwright is not installed.');
    process.exit(0);
  }
}

const ROOT = path.join(__dirname, '..');
const PRIMITIVES = fs.readFileSync(path.join(ROOT, 'js', 'components', 'wr-primitives.js'), 'utf8');
const ROW_H = 43; // 42px row + 1px border — the engine slides by measured height

const FIXTURE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: monospace; background: #121217; color: #eee; }
  #list { min-width: 100%; }
  .hdr { position: sticky; top: 0; height: 34px; background: #222; z-index: 1; }
  .row { display: grid; grid-template-columns: 40px 1fr; align-items: center; min-height: 42px; height: 42px; border-bottom: 1px solid #333; }
  .brk { height: 30px; background: #1a1408; color: #d4af37; font-size: 10px; }
</style></head><body>
<div id="list"><div class="hdr">HDR</div></div>
<script>
  window.React = {
    createElement: function () { return null; }, Fragment: {},
    useState: function (v) { return [v, function () {}]; }, useEffect: function () {},
    useMemo: function (f) { return f(); }, useRef: function (v) { return { current: v }; },
    useCallback: function (f) { return f; },
  };
<\/script>
<script>__PRIMITIVES__<\/script>
<script>
  let order = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  let dragPid = null;
  const list = document.getElementById('list');
  function render() {
    list.querySelectorAll('.row, .brk').forEach(el => el.remove());
    order.forEach((key, i) => {
      if (i === 6) { const b = document.createElement('div'); b.className = 'brk'; b.textContent = 'ROUND 2'; list.appendChild(b); }
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('data-reorder-key', key);
      row.draggable = true;
      row.innerHTML = '<span>' + (i + 1) + '</span><span>' + key + '</span>';
      row.addEventListener('dragstart', e => {
        dragPid = key;
        window.WR.listDrag.start(row);
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); } catch (_) {}
      });
      row.addEventListener('dragend', () => { window.WR.listDrag.end(); dragPid = null; });
      // Row-level dragover/drop mirror production: iOS Safari never fires
      // a 'drop' when only an ancestor carries them (reproduced in WebKit
      // 2026-08-19 — the owner could move a player but not drop him).
      row.addEventListener('dragover', e => { e.preventDefault(); window.WR.listDrag.over(e.clientY); });
      row.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); commit(); });
      list.appendChild(row);
    });
  }
  function commit() {
    const t = window.WR.listDrag.target();
    window.WR.listDrag.end();
    if (!t || !dragPid) { dragPid = null; return; }
    const displayed = order.filter(p => p !== dragPid);
    const targetPid = t.appended ? null : displayed[t.k];
    if (targetPid === undefined) { dragPid = null; return; }
    const next = order.filter(p => p !== dragPid);
    if (targetPid == null) next.push(dragPid);
    else next.splice(next.indexOf(targetPid), 0, dragPid);
    order = next; dragPid = null; render();
  }
  // Container copy = the past-the-last-row fallback only.
  list.addEventListener('dragover', e => { e.preventDefault(); window.WR.listDrag.over(e.clientY); });
  list.addEventListener('drop', e => { e.preventDefault(); commit(); });
  render();
  window.__api = {
    order: () => order.join(','),
    rowY: (key, frac) => { const r = document.querySelector('[data-reorder-key="' + key + '"]').getBoundingClientRect(); return r.top + r.height * frac; },
    transforms: () => { const o = {}; document.querySelectorAll('#list > *').forEach(el => { if (el.style.transform) o[el.getAttribute('data-reorder-key') || el.className] = el.style.transform; }); return o; },
    offsetTops: () => Array.from(document.querySelectorAll('.row')).map(r => r.offsetTop).join(','),
    srcOpacity: (key) => document.querySelector('[data-reorder-key="' + key + '"]').style.opacity,
    drag: {
      start: (key) => { document.querySelector('[data-reorder-key="' + key + '"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() })); },
      over: (y) => { document.getElementById('list').dispatchEvent(new DragEvent('dragover', { bubbles: true, clientY: y, dataTransfer: new DataTransfer() })); },
      drop: (y) => {
        const el = (y == null) ? document.getElementById('list')
          : (document.elementFromPoint(20, y) || document.getElementById('list')).closest('[data-reorder-key]') || document.getElementById('list');
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: new DataTransfer() }));
      },
      end: (key) => { const row = document.querySelector('[data-reorder-key="' + key + '"]'); if (row) row.dispatchEvent(new DragEvent('dragend', { bubbles: true })); },
    },
  };
<\/script>
</body></html>`;

const DOWN = 'translateY(' + ROW_H + 'px)';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined,
    args: (process.env.PLAYWRIGHT_CHROME_ARGS || '').split(' ').filter(Boolean),
  });
  let passed = 0, failures = 0;
  const check = (name, ok, detail) => {
    if (ok) { passed++; process.stdout.write('.'); }
    else { failures++; console.log('\nFAIL ' + name + (detail ? ' — ' + detail : '')); }
  };
  const boot = async () => {
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', e => { failures++; console.log('\nPAGEERROR: ' + e.message); });
    await page.setContent(FIXTURE.replace('__PRIMITIVES__', PRIMITIVES.replace(/<\/script>/g, '<\\/script>')), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.WR && window.WR.listDrag && window.__api);
    return page;
  };
  const api = (page, expr) => page.evaluate(expr);

  // 1. The move from the owner's screen recording: nudge one row down.
  {
    const page = await boot();
    await api(page, `__api.drag.start('A')`);
    await page.waitForTimeout(30); // the source fade is deferred one tick
    await api(page, `__api.drag.over(__api.rowY('B', 0.8))`);
    const mid = await api(page, `({ t: __api.transforms(), op: __api.srcOpacity('A'), tops: __api.offsetTops() })`);
    check('one-down: landing spot steps down', mid.t['C'] === DOWN, JSON.stringify(mid.t));
    check('one-down: the passed row stays put', !mid.t['B'], JSON.stringify(mid.t));
    check('one-down: round divider steps down with the pack', mid.t['brk'] === DOWN, JSON.stringify(mid.t));
    check('one-down: nothing ever slides up', !Object.values(mid.t).some(v => v.indexOf('-') >= 0), JSON.stringify(mid.t));
    check('one-down: source faded, not hidden', mid.op === '0', 'opacity=' + mid.op);
    const preTops = await api(page, `__api.offsetTops()`);
    await api(page, `__api.drag.drop()`); await api(page, `__api.drag.end('A')`);
    const after = await api(page, `({ o: __api.order(), t: __api.transforms(), op: __api.srcOpacity('A') })`);
    check('one-down: A lands one spot down', after.o === 'B,A,C,D,E,F,G,H,I,J,K,L', after.o);
    check('one-down: transforms cleaned up', Object.keys(after.t).length === 0, JSON.stringify(after.t));
    check('one-down: source opacity restored', after.op === '', 'op=' + after.op);
    check('one-down: layout never mutated mid-drag', preTops === mid.tops, 'mid=' + mid.tops);
    await page.context().close();
  }
  // 2. The player's own spot is a no-op — nothing may slide.
  {
    const page = await boot();
    await api(page, `__api.drag.start('A')`);
    await api(page, `__api.drag.over(__api.rowY('B', 0.2))`);
    const t = await api(page, `__api.transforms()`);
    check('own-spot: nothing slides', Object.keys(t).length === 0, JSON.stringify(t));
    await api(page, `__api.drag.drop()`); await api(page, `__api.drag.end('A')`);
    check('own-spot: order unchanged', (await api(page, `__api.order()`)) === 'A,B,C,D,E,F,G,H,I,J,K,L');
    await page.context().close();
  }
  // 3. Two rows down.
  {
    const page = await boot();
    await api(page, `__api.drag.start('A')`);
    await api(page, `__api.drag.over(__api.rowY('C', 0.8))`);
    const t = await api(page, `__api.transforms()`);
    check('two-down: D steps down', t['D'] === DOWN, JSON.stringify(t));
    check('two-down: passed rows stay put', !t['B'] && !t['C'], JSON.stringify(t));
    await api(page, `__api.drag.drop()`); await api(page, `__api.drag.end('A')`);
    check('two-down: A lands below C', (await api(page, `__api.order()`)) === 'B,C,A,D,E,F,G,H,I,J,K,L');
    await page.context().close();
  }
  // 4. Dragging up: the target and the rows under it step down.
  {
    const page = await boot();
    await api(page, `__api.drag.start('E')`);
    await api(page, `__api.drag.over(__api.rowY('B', 0.2))`);
    const t = await api(page, `__api.transforms()`);
    check('up: B, C, D step down', t['B'] === DOWN && t['C'] === DOWN && t['D'] === DOWN && Object.keys(t).length === 3, JSON.stringify(t));
    await api(page, `__api.drag.drop()`); await api(page, `__api.drag.end('E')`);
    check('up: E takes B spot, B shifts down', (await api(page, `__api.order()`)) === 'A,E,B,C,D,F,G,H,I,J,K,L');
    await page.context().close();
  }
  // 5. Past the last row: append to the very bottom.
  {
    const page = await boot();
    await api(page, `__api.drag.start('A')`);
    await api(page, `__api.drag.over(__api.rowY('L', 0.9) + 60)`);
    await api(page, `__api.drag.drop()`); await api(page, `__api.drag.end('A')`);
    check('append: A to the very bottom', (await api(page, `__api.order()`)) === 'B,C,D,E,F,G,H,I,J,K,L,A');
    await page.context().close();
  }
  // 6. Crossing the round divider: only rows at/below the slot move.
  {
    const page = await boot();
    await api(page, `__api.drag.start('A')`);
    await api(page, `__api.drag.over(__api.rowY('H', 0.8))`);
    const t = await api(page, `__api.transforms()`);
    check('divider-cross: I steps down', t['I'] === DOWN, JSON.stringify(t));
    check('divider-cross: divider above the slot stays put', !t['brk'], JSON.stringify(t));
    await api(page, `__api.drag.drop()`); await api(page, `__api.drag.end('A')`);
    const after = await api(page, `({ o: __api.order(), t: __api.transforms() })`);
    check('divider-cross: order right', after.o === 'B,C,D,E,F,G,H,A,I,J,K,L', after.o);
    check('divider-cross: transforms cleaned up', Object.keys(after.t).length === 0, JSON.stringify(after.t));
    await page.context().close();
  }
  // 7. Cancelled drag (dragend with no drop): everything restored.
  {
    const page = await boot();
    await api(page, `__api.drag.start('D')`);
    await page.waitForTimeout(30);
    await api(page, `__api.drag.over(__api.rowY('G', 0.8))`);
    await api(page, `__api.drag.end('D')`);
    const s = await api(page, `({ o: __api.order(), t: __api.transforms(), op: __api.srcOpacity('D') })`);
    check('cancel: order unchanged', s.o === 'A,B,C,D,E,F,G,H,I,J,K,L', s.o);
    check('cancel: transforms cleared', Object.keys(s.t).length === 0, JSON.stringify(s.t));
    check('cancel: source opacity restored', s.op === '', 'op=' + s.op);
    await page.context().close();
  }
  // 8. Page scrolled: container-content geometry keeps the slot honest.
  {
    const page = await boot();
    await page.setViewportSize({ width: 500, height: 300 });
    await page.evaluate(() => window.scrollTo(0, 150));
    await api(page, `__api.drag.start('F')`);
    await api(page, `__api.drag.over(__api.rowY('H', 0.8))`);
    await api(page, `__api.drag.drop()`); await api(page, `__api.drag.end('F')`);
    check('scrolled: F lands below H', (await api(page, `__api.order()`)) === 'A,B,C,D,E,G,H,F,I,J,K,L', await api(page, `__api.order()`));
    await page.context().close();
  }

  await browser.close();
  console.log('\n' + (failures === 0 ? 'PASS' : 'FAIL') + ' listDrag - ' + passed + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
