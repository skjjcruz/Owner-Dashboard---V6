// Run with:  node --test js/shared/live-update.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LU = require('./live-update.js');

const V1 = 'b135-aaaaaaaaaa', V2 = 'b136-bbbbbbbbbb';

// A fake page: clock, visibility, guard, version.json, served HTML, storage, UI.
function rig(opts = {}) {
  const f = {
    t: 1_000_000, own: 'own' in opts ? opts.own : V1, hidden: false, unsafe: null,
    latest: { build: V2, critical: false }, fetchFails: false, served: V2,
    hist: [], navs: [], tracks: [], toasts: [], overlay: false, timers: [], fetches: 0,
  };
  const env = {
    now: () => f.t,
    own: () => f.own,
    hidden: () => f.hidden,
    unsafe: () => f.unsafe,
    fetchLatest: () => { f.fetches++; return f.fetchFails ? Promise.reject(new Error('404')) : Promise.resolve(f.latest); },
    prefetch: () => Promise.resolve(f.served),
    navigate: (mode, target) => f.navs.push({ mode, target }),
    track: opts.track || ((name, meta) => f.tracks.push({ name, meta })),
    store: { get: () => JSON.parse(JSON.stringify(f.hist)), set: v => { f.hist = JSON.parse(JSON.stringify(v)); } },
    ui: {
      toast: o => f.toasts.push(o), hideToast: () => f.toasts.push('hide'),
      overlay: on => { f.overlay = on; },
    },
    after: (ms, fn) => f.timers.push({ ms, fn, once: true }),
    every: (ms, fn) => f.timers.push({ ms, fn }),
  };
  const u = LU.createUpdater(env, opts.tune);
  f.u = u;
  f.lastToast = () => f.toasts[f.toasts.length - 1];
  f.tick = ms => { f.t += ms; };
  return f;
}

// ── pure logic ───────────────────────────────────────────────────────────────
test('pending detection: only a different, well-formed build is pending', () => {
  assert.equal(LU.isPending(V1, { build: V2 }), true);
  assert.equal(LU.isPending(V1, { build: V1 }), false);
  assert.equal(LU.isPending(V1, null), false);
  assert.equal(LU.isPending(V1, { build: '' }), false);
  assert.equal(LU.isPending(V1, { tag: 'b136' }), false);
  assert.equal(LU.isPending(null, { build: V2 }), false, 'unstamped page never pending');
});

test('policy table: hidden → reload, fresh resume → overlay reload, active → toast', () => {
  const base = { own: V1, latest: { build: V2 }, hidden: false, fresh: false, unsafe: null, loop: null, dismissed: false, criticalDue: false };
  assert.deepEqual(LU.decide({ ...base, hidden: true }), { act: 'reload', why: 'hidden' });
  assert.deepEqual(LU.decide({ ...base, fresh: true }), { act: 'reload', overlay: true, why: 'resume' });
  assert.equal(LU.decide(base).act, 'toast');
  assert.equal(LU.decide({ ...base, dismissed: true }).act, 'wait');
  assert.equal(LU.decide({ ...base, own: null }).why, 'dev');
  assert.equal(LU.decide({ ...base, latest: { build: V1 } }).why, 'current');
  // guard beats every auto path
  assert.deepEqual(LU.decide({ ...base, hidden: true, unsafe: 'typing' }), { act: 'wait', why: 'typing' });
  assert.equal(LU.decide({ ...base, fresh: true, unsafe: 'modal' }).act, 'toast', 'unsafe resume only offers the toast');
  assert.equal(LU.decide({ ...base, hidden: true, loop: 'stale' }).act, 'none');
  // critical: countdown toast, then reload once due and safe
  const crit = { ...base, latest: { build: V2, critical: true } };
  assert.deepEqual(LU.decide(crit), { act: 'toast', critical: true, why: 'active' });
  assert.equal(LU.decide({ ...crit, criticalDue: true }).why, 'critical');
  assert.equal(LU.decide({ ...crit, criticalDue: true, unsafe: 'live-draft' }).act, 'toast');
  assert.equal(LU.decide({ ...crit, criticalDue: true, dismissed: true }).act, 'reload', '× cannot defer a critical update past its countdown');
});

test('loop guard: stale target waits 10 min, max 3 reloads per hour', () => {
  const cfg = LU.CFG, now = 10_000_000;
  const tried = [{ from: V1, to: V2, at: now - 60_000 }];
  assert.equal(LU.loopBlock(tried, V1, V2, now, cfg), 'stale', 'reloaded for V2 but still on V1');
  assert.equal(LU.loopBlock(tried, V1, V2, now + cfg.staleMs, cfg), null, 'retry after 10 min');
  assert.equal(LU.loopBlock(tried, V1, 'b137-c', now, cfg), null, 'a newer deploy is a new target');
  const three = [1, 2, 3].map(i => ({ from: 'x' + i, to: 'y' + i, at: now - i * 60_000 }));
  assert.equal(LU.loopBlock(three, V1, V2, now, cfg), 'rate');
  assert.equal(LU.loopBlock(three, V1, V2, now + 3_600_000, cfg), null, 'window slides');
});

// ── controller over the fake page ────────────────────────────────────────────
test('dev / unstamped page: inert — no timers, no fetch, no reload', async () => {
  const f = rig({ own: null });
  assert.equal(f.u.start(), false);
  assert.equal(f.timers.length, 0);
  await f.u.check('load');
  await f.u.resume('visible');
  assert.equal(f.fetches, 0);
  assert.equal(f.navs.length, 0);
});

test('start: load check after ~10s and a 15s heartbeat', () => {
  const f = rig();
  assert.equal(f.u.start(), true);
  assert.deepEqual(f.timers.map(x => x.ms), [10000, 15000]);
});

test('(c) active user: toast, no reload; Refresh applies now; × dismisses until next resume', async () => {
  const f = rig();
  f.u.start();
  f.u.touch();
  f.tick(10000);
  await f.u.check('load');
  assert.equal(f.navs.length, 0, 'never reloads under an active user');
  assert.deepEqual(f.lastToast(), { critical: false, secs: null });
  f.u.dismiss();
  assert.equal(f.lastToast(), 'hide');
  f.tick(20000);
  await f.u.check('focus');
  assert.equal(f.lastToast(), 'hide', 'dismissed toast stays away');
  await f.u.apply();
  assert.equal(f.navs.length, 1, 'Refresh applies immediately');
  assert.equal(f.hist[0].why, 'manual');
});

test('(a) pending then page hidden → reload immediately, no overlay', async () => {
  const f = rig();
  f.u.start(); f.u.touch(); f.tick(10000);
  await f.u.check('load');
  f.hidden = true;
  await f.u.hidden();
  assert.deepEqual(f.navs, [{ mode: 'reload', target: V2 }]);
  assert.equal(f.overlay, false);
  assert.deepEqual(f.hist.map(h => [h.from, h.to, h.why]), [[V1, V2, 'hidden']]);
});

test('(b) resume with no interaction → overlay + reload; interaction after resume → toast', async () => {
  const f = rig();
  f.u.start(); f.u.touch(); f.tick(60000);
  await f.u.resume('visible');
  assert.equal(f.overlay, true, '"Updating DHQ…" shown');
  assert.equal(f.navs.length, 1);

  const g = rig();
  g.u.start(); g.tick(60000);
  g.u.st.latest = { build: V2 }; // already known pending
  g.u.st.resumeAt = g.t; g.tick(4000); g.u.touch(); // user tapped 4s after resume
  await g.u.check('focus');
  assert.equal(g.navs.length, 0);
  assert.equal(g.lastToast().critical, false);
});

test('(b) heartbeat gap > 60s (timers frozen by iOS) is treated as a resume', async () => {
  const f = rig();
  f.u.start(); f.u.touch();
  f.latest = { build: V1 };
  f.tick(10000); await f.u.check('load');          // load check: current
  f.tick(5000); await f.u.beat();                  // normal beat: nothing
  assert.equal(f.fetches, 1);
  f.latest = { build: V2 };                        // deploy lands while backgrounded
  f.tick(5 * 60000);                               // app sat in background, timers frozen
  await f.u.beat();
  assert.equal(f.fetches, 2, 'woke → checked');
  assert.equal(f.overlay, true);
  assert.equal(f.navs.length, 1, 'untouched since wake → overlay reload');
  assert.equal(f.hist[0].why, 'resume');

  const g = rig();                                 // woke, but user already interacting & typing
  g.u.start(); g.tick(120000); g.unsafe = 'typing';
  await g.u.beat();
  assert.equal(g.navs.length, 0);
  assert.equal(g.lastToast().critical, false);

  const h = rig();                                 // visibilitychange already handled the resume:
  h.u.start(); h.latest = { build: V1 };           // the next (late) beat must not re-arm "fresh"
  h.tick(120000); await h.u.resume('visible');
  h.tick(5000); h.u.touch(); h.latest = { build: V2 };
  h.tick(10000); await h.u.beat();
  assert.equal(h.navs.length, 0);
});

test('periodic check every 5 min only while visible', async () => {
  const f = rig({ tune: { wakeGapMs: 1e12 } });
  f.u.start();
  f.u.st.lastCheck = f.t;
  f.hidden = true; f.tick(6 * 60000); await f.u.beat();
  assert.equal(f.fetches, 0, 'hidden: no polling');
  f.hidden = false; await f.u.beat();
  assert.equal(f.fetches, 1);
});

test('guard: focused input / modal / hold block every automatic reload', async () => {
  for (const reason of ['typing', 'modal', 'live-draft', 'draft-board', 'ai']) {
    const f = rig();
    f.u.start(); f.unsafe = reason; f.hidden = true;
    await f.u.check('hidden');
    assert.equal(f.navs.length, 0, reason + ' blocks the hidden reload');
    f.hidden = false; f.tick(60000);
    await f.u.resume('visible');
    assert.equal(f.navs.length, 0, reason + ' blocks the resume reload');
    f.unsafe = null; f.hidden = true;               // safe again → next trigger applies
    await f.u.hidden();
    assert.equal(f.navs.length, 1, 'retried at the next trigger once safe');
  }
  const f = rig();
  f.u.start(); f.u.hold('live-draft'); f.hidden = true;
  await f.u.check('hidden');
  assert.equal(f.navs.length, 0);
  f.u.release('live-draft');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(f.navs.length, 1, 'release lets the pending hidden update through');
});

test('guard re-verified after the prefetch: user starts typing mid-apply → abort', async () => {
  const f = rig();
  f.u.start(); f.tick(60000);
  const env = f.u; // prefetch resolves after we flip unsafe
  f.u.st.latest = { build: V2 };
  f.hidden = true;
  const p = env.evaluate('hidden');
  f.unsafe = 'typing';
  await p;
  assert.equal(f.navs.length, 0);
  assert.equal(f.overlay, false);
});

test('loop protection end-to-end: stale reload waits 10 min, then cache-busts', async () => {
  const f = rig();
  f.hist = [{ from: V1, to: V2, at: f.t - 60000, why: 'hidden', mode: 'reload', rep: 1 }]; // came back still on V1
  f.u.start(); f.hidden = true;
  await f.u.check('hidden');
  assert.equal(f.navs.length, 0, 'CDN lag: no second reload within 10 min');
  f.tick(10 * 60000);
  await f.u.hidden();
  assert.deepEqual(f.navs, [{ mode: 'bust', target: V2 }], 'retry bypasses caches with ?lu=');
});

test('served HTML still old → cache-bust navigation instead of a pointless reload', async () => {
  const f = rig();
  f.served = V1;
  f.u.start(); f.hidden = true;
  await f.u.check('hidden');
  assert.deepEqual(f.navs, [{ mode: 'bust', target: V2 }]);
});

test('rate limit: never more than 3 auto reloads per hour', async () => {
  const f = rig();
  f.hist = [1, 2, 3].map(i => ({ from: 'x', to: 'y' + i, at: f.t - i * 1000, rep: 1 }));
  f.u.start(); f.hidden = true;
  await f.u.check('hidden');
  assert.equal(f.navs.length, 0);
});

test('critical: 30s countdown toast, then applies while active once safe', async () => {
  const f = rig();
  f.latest = { build: V2, critical: true };
  f.u.start(); f.u.touch(); f.tick(10000);
  await f.u.check('load');
  assert.deepEqual(f.lastToast(), { critical: true, secs: 30 });
  const ticker = f.timers.find(x => x.ms === 1000);
  assert.ok(ticker, 'countdown ticker armed');
  f.tick(10000); ticker.fn();
  assert.deepEqual(f.lastToast(), { critical: true, secs: 20 });
  f.unsafe = 'modal'; f.tick(25000); ticker.fn();
  assert.equal(f.navs.length, 0, 'due, but a sheet is open');
  assert.deepEqual(f.lastToast(), { critical: true, secs: 0 });
  f.unsafe = null; f.tick(1000); await ticker.fn();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(f.navs.length, 1);
  assert.equal(f.hist[0].why, 'critical');
  assert.equal(ticker.fn(), false, 'ticker stops');
});

test('critical: × hides the toast but the countdown still applies it', async () => {
  const f = rig();
  f.latest = { build: V2, critical: true };
  f.u.start(); f.u.touch(); f.tick(10000);
  await f.u.check('load');
  const ticker = f.timers.find(x => x.ms === 1000);
  f.u.dismiss();
  f.tick(5000); ticker.fn();
  assert.equal(f.lastToast(), 'hide', 'stays dismissed');
  assert.equal(f.navs.length, 0);
  f.tick(26000); await ticker.fn();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(f.navs.length, 1, 'applied once due');
});

test('errors back off quietly; online retries immediately', async () => {
  const f = rig();
  f.u.start(); f.fetchFails = true;
  await f.u.check('load');
  assert.equal(f.navs.length + f.toasts.filter(t => t !== 'hide').length, 0, '404 is silent');
  f.tick(60000); await f.u.check('focus');
  assert.equal(f.fetches, 1, 'backed off (5 min)');
  f.tick(60000); await f.u.check('online');
  assert.equal(f.fetches, 2, 'online bypasses back-off');
  f.tick(6 * 60000); await f.u.check('focus');
  assert.equal(f.fetches, 2, 'second failure doubles the back-off (10 min)');
  f.fetchFails = false; f.tick(5 * 60000); await f.u.check('focus');
  assert.equal(f.fetches, 3);
  assert.equal(f.u.st.errors, 0, 'reset on success');
});

test('after the reload: logs live_update_applied once, with from/to/trigger', () => {
  const f = rig({ own: V2 });
  f.hist = [{ from: V1, to: V2, at: f.t - 5000, why: 'resume', mode: 'reload' }];
  f.u.start();
  assert.deepEqual(f.tracks, [{ name: 'live_update_applied', meta: { from: V1, to: V2, landed: V2, ok: true, trigger: 'resume', mode: 'reload' } }]);
  f.u.arrived();
  assert.equal(f.tracks.length, 1, 'once');

  const g = rig({ own: V1 });                      // reload landed on the old page: not applied
  g.hist = [{ from: V1, to: V2, at: g.t - 5000, why: 'hidden', mode: 'reload' }];
  g.u.start();
  assert.equal(g.tracks.length, 0);
});

test('tracking failure never breaks the updater', () => {
  const f = rig({ own: V2, track: () => { throw new Error('no db'); } });
  f.hist = [{ from: V1, to: V2, at: f.t - 5000, why: 'resume', mode: 'reload' }];
  assert.equal(f.u.start(), true);
  assert.equal(f.hist[0].rep, 1);
});
