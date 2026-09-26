// Run with:  node --test js/shared/live-update.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const LU = require('./live-update.js');

const V1 = 'b135-aaaaaaaaaa', V2 = 'b136-bbbbbbbbbb';
const MIN = 60000;
const flush = () => new Promise(r => setTimeout(r, 0));

// A fake page: clock, visibility, guard, version.json, served HTML, storage.
function rig(opts = {}) {
  const f = {
    t: 1_000_000, own: 'own' in opts ? opts.own : V1, hidden: false, unsafe: null,
    latest: { build: V2, critical: false }, fetchFails: false, served: V2,
    hist: [], navs: [], tracks: [], timers: [], fetches: 0, tune: opts.tune || null,
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
    after: (ms, fn) => f.timers.push({ ms, fn, once: true }),
    every: (ms, fn) => f.timers.push({ ms, fn }),
  };
  f.u = LU.createUpdater(env, () => f.tune); // live tuning, like window.WR_UPDATE_TUNING
  f.tick = ms => { f.t += ms; };
  f.why = () => f.hist.map(h => h.why);
  return f;
}
// Load the page, let the load check see the current build, then deploy V2.
async function booted(opts) {
  const f = rig(opts);
  f.latest = { build: V1 };
  f.u.start();
  f.tick(10000); await f.u.check('load');
  if (opts && opts.noDeploy) return f;
  f.latest = opts && opts.critical ? { build: V2, critical: true } : { build: V2 };
  f.tick(20000); await f.u.check('focus');        // the page learns about the deploy
  await f.u.beat();
  return f;
}
// Advance the clock in 15s heartbeats (timers running normally).
async function run(f, ms) { for (let t = 0; t < ms; t += 15000) { f.tick(15000); await f.u.beat(); } }

// ── pure logic ───────────────────────────────────────────────────────────────
test('pending detection: only a different, well-formed build is pending', () => {
  assert.equal(LU.isPending(V1, { build: V2 }), true);
  assert.equal(LU.isPending(V1, { build: V1 }), false);
  assert.equal(LU.isPending(V1, null), false);
  assert.equal(LU.isPending(V1, { build: '' }), false);
  assert.equal(LU.isPending(null, { build: V2 }), false, 'unstamped page never pending');
});

test('policy table (silent): away ≥ 2 min, resume after ≥ 2 min, idle ≥ 5 min; critical shortens', () => {
  const c = LU.CFG;
  const base = { own: V1, latest: { build: V2 }, hidden: false, hiddenFor: 0, resumeAway: null, idleFor: 0, unsafe: null, loop: null };
  const d = s => LU.decide({ ...base, ...s }, c);
  assert.deepEqual(d({ hidden: true, hiddenFor: 2 * MIN }), { act: 'reload', why: 'hidden' });
  assert.equal(d({ hidden: true, hiddenFor: 119000 }).act, 'wait', 'hidden < 2 min: wait');
  assert.deepEqual(d({ resumeAway: 2 * MIN }), { act: 'reload', why: 'resume' });
  assert.equal(d({ resumeAway: 90000 }).act, 'wait', 'quick app-switch never reloads');
  assert.deepEqual(d({ idleFor: 5 * MIN }), { act: 'reload', why: 'idle' });
  assert.deepEqual(d({ idleFor: 4 * MIN }), { act: 'wait', why: 'active' });
  assert.equal(d({ own: null }).why, 'dev');
  assert.equal(d({ latest: { build: V1 } }).why, 'current');
  for (const u of ['typing', 'modal', 'live-draft', 'hold:x']) {
    assert.deepEqual(d({ hidden: true, hiddenFor: 60 * MIN, unsafe: u }), { act: 'wait', why: u });
    assert.equal(d({ resumeAway: 60 * MIN, idleFor: 60 * MIN, unsafe: u }).act, 'wait');
  }
  assert.equal(d({ hidden: true, hiddenFor: 60 * MIN, loop: 'stale' }).act, 'none');
  const crit = { latest: { build: V2, critical: true } };
  assert.equal(d({ ...crit, resumeAway: 0 }).why, 'resume', 'critical: any resume');
  assert.equal(d({ ...crit, hidden: true, hiddenFor: 0 }).why, 'hidden');
  assert.equal(d({ ...crit, idleFor: 60000 }).why, 'idle', 'critical: idle ≥ 60s');
  assert.equal(d({ ...crit, idleFor: 59000 }).act, 'wait');
  assert.equal(d({ ...crit, idleFor: 60 * MIN, unsafe: 'modal' }).act, 'wait', 'critical still honours the guard');
});

test('loop guard: stale target waits 10 min, max 3 reloads per hour', () => {
  const cfg = LU.CFG, now = 10_000_000;
  const tried = [{ from: V1, to: V2, at: now - 60_000 }];
  assert.equal(LU.loopBlock(tried, V1, V2, now, cfg), 'stale');
  assert.equal(LU.loopBlock(tried, V1, V2, now + cfg.staleMs, cfg), null);
  assert.equal(LU.loopBlock(tried, V1, 'b137-c', now, cfg), null, 'a newer deploy is a new target');
  const three = [1, 2, 3].map(i => ({ from: 'x' + i, to: 'y' + i, at: now - i * 60_000 }));
  assert.equal(LU.loopBlock(three, V1, V2, now, cfg), 'rate');
  assert.equal(LU.loopBlock(three, V1, V2, now + 3_600_000, cfg), null);
});

// ── controller over the fake page ────────────────────────────────────────────
test('dev / unstamped page: inert — no timers, no fetch, no reload', async () => {
  const f = rig({ own: null });
  assert.equal(f.u.start(), false);
  assert.equal(f.timers.length, 0);
  await f.u.check('load'); await f.u.resume(10 * MIN);
  assert.equal(f.fetches, 0);
  assert.equal(f.navs.length, 0);
});

test('start: load check after ~10s and a 15s heartbeat; no UI surface in the API', () => {
  const f = rig();
  assert.equal(f.u.start(), true);
  assert.deepEqual(f.timers.map(x => x.ms), [10000, 15000]);
  for (const k of ['toast', 'apply', 'dismiss', 'overlay']) assert.equal(f.u[k], undefined, k);
});

test('(c) visible and in use: no reload until 5 min without interaction', async () => {
  const f = await booted();
  for (let i = 0; i < 20; i++) { await run(f, MIN); f.u.touch(); }
  assert.equal(f.navs.length, 0, '20 minutes of use: never reloaded');
  await run(f, 4 * MIN);
  assert.equal(f.navs.length, 0, '4 min idle: still waiting');
  await run(f, MIN);
  assert.deepEqual(f.navs, [{ mode: 'reload', target: V2 }]);
  assert.deepEqual(f.why(), ['idle']);
});

test('(a) hidden: no immediate reload; reloads once hidden ≥ 2 min with timers running', async () => {
  const f = await booted();
  f.u.touch(); f.hidden = true;
  await f.u.hide();
  assert.equal(f.navs.length, 0, 'not on hide');
  assert.equal(f.u.st.latest.build, V2, 'but it learned about the deploy');
  await run(f, 105000);
  assert.equal(f.navs.length, 0, 'hidden 1m45s: waiting');
  await run(f, 15000);
  assert.equal(f.navs.length, 1);
  assert.deepEqual(f.why(), ['hidden']);
});

test('(a) hidden with nothing pending: no refetch every beat', async () => {
  const f = await booted({ noDeploy: true });
  f.hidden = true; f.tick(20000); await f.u.hide();
  const n = f.fetches;
  for (let i = 0; i < 8; i++) { f.tick(15000); await f.u.beat(); }
  assert.equal(f.fetches, n, '2 min of hidden beats, no fetch');
  f.tick(4 * MIN); await f.u.beat();
  assert.equal(f.fetches, n + 1, 'polls again at the 5-min cadence');
});

test('(b) resume after ≥ 2 min away → reload; quick app-switch never reloads', async () => {
  const f = await booted();
  f.u.touch(); f.hidden = true; await f.u.hide();
  f.tick(30000); f.hidden = false; await f.u.resume();
  assert.equal(f.navs.length, 0, '30s app-switch');
  f.u.touch(); f.hidden = true; f.tick(1000); await f.u.hide();
  f.tick(3 * MIN); f.hidden = false; // iOS: timers frozen, so the hidden-beat never ran
  await f.u.resume();
  assert.equal(f.navs.length, 1);
  assert.deepEqual(f.why(), ['resume']);
});

test('(b) resume counts only until the user touches something', async () => {
  const f = await booted();
  f.u.touch(); f.hidden = true; await f.u.hide();
  f.tick(3 * MIN); f.hidden = false; f.unsafe = 'modal';
  await f.u.resume();
  assert.equal(f.navs.length, 0, 'guard blocked the resume reload');
  f.tick(2000); f.u.touch(); f.unsafe = null;
  f.tick(1000); await f.u.beat();
  assert.equal(f.navs.length, 0, 'user is now active: back to the idle rule');
});

test('(b) heartbeat gap > 60s (iOS froze timers, no event) is a resume with away = gap', async () => {
  const f = await booted();
  f.u.touch();
  f.tick(15000); await f.u.beat();
  assert.equal(f.navs.length, 0);
  f.tick(5 * MIN); await f.u.beat();
  assert.equal(f.navs.length, 1);
  assert.deepEqual(f.why(), ['resume']);

  const g = await booted();                        // 90s gap: woke, but away < 2 min
  g.u.touch(); g.tick(90000); await g.u.beat();
  assert.equal(g.navs.length, 0);

  const h = await booted();                        // visibilitychange already handled the resume:
  h.latest = { build: V1 };                        // the next (late) beat must not re-resume
  h.u.touch(); h.hidden = true; await h.u.hide();
  h.tick(30000); h.hidden = false; await h.u.resume();
  h.latest = { build: V2 }; h.tick(10000); h.u.touch(); await h.u.beat();
  assert.equal(h.navs.length, 0);
});

test('focus after hidden counts as the resume', async () => {
  const f = await booted();
  f.u.touch(); f.hidden = true; await f.u.hide();
  f.tick(3 * MIN); f.hidden = false;
  await f.u.focus();
  assert.deepEqual(f.why(), ['resume']);
});

test('guards: focused input / modal / live draft / hold block every automatic reload', async () => {
  for (const reason of ['typing', 'modal', 'live-draft', 'draft-board', 'ai']) {
    const f = await booted();
    f.u.touch(); f.unsafe = reason; f.hidden = true; await f.u.hide();
    await run(f, 3 * MIN);
    assert.equal(f.navs.length, 0, reason + ' blocks the hidden reload');
    f.hidden = false; await f.u.resume();
    assert.equal(f.navs.length, 0, reason + ' blocks the resume reload');
    await run(f, 10 * MIN);
    assert.equal(f.navs.length, 0, reason + ' blocks the idle reload');
    f.unsafe = null; await run(f, 15000);
    assert.equal(f.navs.length, 1, reason + ': applied at the next beat once safe');
  }
  const f = await booted();
  f.u.hold('live-draft'); await run(f, 10 * MIN);
  assert.equal(f.navs.length, 0);
  f.u.release('live-draft'); await flush();
  assert.equal(f.navs.length, 1, 'release lets the idle update through');
});

test('guard re-verified after the prefetch: user starts typing mid-apply → abort', async () => {
  const f = await booted();
  f.u.hold('x'); await run(f, 6 * MIN);
  const p = f.u.release('x');                      // idle ≥ 5 min → apply() starts, prefetch in flight
  f.unsafe = 'typing';
  await p;
  assert.equal(f.navs.length, 0);
  assert.equal(f.u.st.applying, false);
});

test('loop protection: stale reload waits 10 min, then cache-busts', async () => {
  const f = rig();
  f.hist = [{ from: V1, to: V2, at: f.t - 60000, why: 'hidden', mode: 'reload', rep: 1 }]; // came back still on V1
  f.u.start(); f.tick(10000); await f.u.check('load');
  await run(f, 8 * MIN);                           // idle long enough, but the target just failed
  assert.equal(f.navs.length, 0, 'CDN lag: no second reload within 10 min');
  await run(f, MIN);
  assert.deepEqual(f.navs, [{ mode: 'bust', target: V2 }], 'retry bypasses caches with ?lu=');
});

test('served HTML still old → cache-bust navigation instead of a pointless reload', async () => {
  const f = await booted();
  f.served = V1;
  await run(f, 5 * MIN);
  assert.deepEqual(f.navs, [{ mode: 'bust', target: V2 }]);
});

test('rate limit: never more than 3 auto reloads per hour', async () => {
  const f = rig();
  f.hist = [1, 2, 3].map(i => ({ from: 'x', to: 'y' + i, at: f.t - i * 1000, rep: 1 }));
  f.u.start(); f.tick(10000); await f.u.check('load');
  await run(f, 10 * MIN);
  assert.equal(f.navs.length, 0);
});

test('critical: any resume, or 60s idle, applies it', async () => {
  const f = await booted({ critical: true });
  f.u.touch(); f.hidden = true; f.unsafe = 'modal'; await f.u.hide();
  f.tick(5000); f.hidden = false; f.unsafe = null; await f.u.resume();
  assert.deepEqual(f.why(), ['resume'], '5s away is enough');

  const g = await booted({ critical: true });
  g.u.touch(); await run(g, 45000);
  assert.equal(g.navs.length, 0);
  await run(g, 15000);
  assert.deepEqual(g.why(), ['idle']);
});

test('WR_UPDATE_TUNING overrides thresholds live', async () => {
  const f = await booted();
  f.tune = { idleMs: 5000 };
  f.u.touch(); f.tick(4000); await f.u.beat();
  assert.equal(f.navs.length, 0);
  f.tick(1500); await f.u.beat();                  // (a 1s heartbeat in the browser e2e)
  assert.deepEqual(f.why(), ['idle']);
  const g = await booted({ tune: { minAwayMs: 3000 } });
  g.u.touch(); g.hidden = true; await g.u.hide();
  g.tick(3500); g.hidden = false; await g.u.resume();
  assert.deepEqual(g.why(), ['resume']);
});

test('errors back off quietly; online retries immediately', async () => {
  const f = rig();
  f.u.start(); f.fetchFails = true;
  await f.u.check('load');
  assert.equal(f.navs.length, 0, '404 is silent');
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
