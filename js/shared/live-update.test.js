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
    t: 1_790_000_000_000, own: 'own' in opts ? opts.own : V1, hidden: false, unsafe: null,
    latest: { build: V2, critical: false }, fetchFails: false, served: V2,
    hist: [], navs: [], tracks: [], timers: [], fetches: 0, tune: opts.tune || null,
  };
  const env = {
    now: () => f.t,
    own: () => f.own,
    hidden: () => f.hidden,
    unsafe: () => (typeof f.unsafe === 'function' ? f.unsafe() : f.unsafe),
    fetchLatest: () => { f.fetches++; if (f.fetchImpl) return f.fetchImpl(); return f.fetchFails ? Promise.reject(new Error('404')) : Promise.resolve(f.latest); },
    prefetch: () => { f.prefetches = (f.prefetches || 0) + 1; return f.prefetchImpl ? f.prefetchImpl() : Promise.resolve(f.served); },
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
  assert.deepEqual(f.tracks, [{ name: 'live_update_applied', meta: { from: V1, to: V2, landed: V2, ok: true, why: 'resume', trigger: 'resume', mode: 'reload' } }]);
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

// ── QA hardening (2026-09-26): unsaved work, offline, clocks, stalls ─────────
const HOUR = 60 * MIN;
const never = () => new Promise(() => {});
const fire = (f, ms) => f.timers.filter(x => x.once && x.ms === ms && !x.fired).forEach(x => { x.fired = true; x.fn(); });

test('offline / 404 page: the prefetch fails → never navigate; retry after a minute', async () => {
  const f = await booted();
  f.prefetchImpl = () => Promise.reject(new TypeError('Failed to fetch'));
  f.u.touch(); await run(f, 5 * MIN);
  assert.equal(f.prefetches, 1, 'idle reached: one attempt');
  assert.equal(f.navs.length, 0, 'a reload now would land on an error page');
  await run(f, 45000);
  assert.equal(f.prefetches, 1, 'no HTML re-fetch every heartbeat while unreachable');
  await run(f, 30000);
  assert.equal(f.prefetches, 2, 'retried after a minute');
  await run(f, 90000);
  assert.equal(f.prefetches, 2, 'second failure: back-off doubles to 2 min');
  f.prefetchImpl = null;
  await run(f, 45000);
  assert.deepEqual(f.why(), ['idle'], 'back online: applies');
});

test('stalled page prefetch: times out (20s) instead of wedging apply() forever', async () => {
  const f = await booted();
  f.prefetchImpl = never;
  f.u.touch(); await run(f, 4 * MIN + 45000);
  f.tick(15000); const p = f.u.beat();            // idle ≥ 5 min → apply(), prefetch hangs
  await flush();
  assert.equal(f.u.st.applying, true);
  fire(f, LU.CFG.prefetchTimeoutMs);
  const d = await p;
  assert.equal(d.act + ':' + d.why, 'wait:unreachable');
  assert.equal(f.u.st.applying, false, 'released by the timeout');
  assert.equal(f.navs.length, 0);
  f.prefetchImpl = null;
  await run(f, 75000);
  assert.equal(f.navs.length, 1);
});

test('stalled version.json probe: a newer probe runs after 30s; the stale answer is ignored', async () => {
  const f = rig();
  f.u.start();
  let late;
  f.fetchImpl = () => new Promise(r => { late = r; });
  f.tick(10000); f.u.check('load'); await flush();
  assert.equal(f.u.st.busy, true);
  f.fetchImpl = null; f.latest = { build: V1 };
  f.tick(20000); await f.u.check('focus');
  assert.equal(f.fetches, 1, 'still inside the 30s window: no second probe');
  f.tick(15000); await f.u.check('focus');
  assert.equal(f.fetches, 2, 'the hung probe no longer blocks checks');
  late({ build: 'b999-stale' }); await flush();
  assert.equal(f.u.st.latest.build, V1, 'superseded answer dropped');
});

test('clock set backwards: polling, the idle rule and the loop guard keep working', async () => {
  const f = await booted();
  f.t -= 24 * HOUR;                                // user / NTP moves the clock back a day
  await run(f, 5 * MIN + 15000);
  assert.deepEqual(f.why(), ['idle'], 'idle measured in real elapsed time');
  const g = rig();                                 // history written "tomorrow" no longer rate-limits
  g.hist = [1, 2, 3].map(i => ({ from: 'x', to: 'y' + i, at: g.t + 24 * HOUR - i * 1000, rep: 1 }));
  g.u.start(); g.tick(10000); await g.u.check('load');
  await run(g, 6 * MIN);
  assert.equal(g.navs.length, 1);
  const h = await booted({ noDeploy: true });      // polling resumes at once after the jump
  const n = h.fetches;
  h.t -= 2 * HOUR; await run(h, 6 * MIN);
  assert.ok(h.fetches > n, 'still polls');
});

test('deploy that REVERTS to an older build still reloads (ids differ)', async () => {
  const f = rig({ own: V2 });
  f.served = V1; f.latest = { build: V2 }; f.u.start(); f.tick(10000); await f.u.check('load');
  f.latest = { build: V1 }; f.tick(20000); await f.u.check('focus');
  await run(f, 5 * MIN + 15000);
  assert.deepEqual(f.navs, [{ mode: 'reload', target: V1 }]);
});

test('critical must be boolean true ("false" / "1" strings are not critical)', () => {
  const base = { own: V1, hidden: false, hiddenFor: 0, resumeAway: 5000, idleFor: 0, unsafe: null, loop: null };
  assert.equal(LU.decide({ ...base, latest: { build: V2, critical: 'false' } }, LU.CFG).act, 'wait');
  assert.equal(LU.decide({ ...base, latest: { build: V2, critical: true } }, LU.CFG).act, 'reload');
});

test('holds: block every trigger; re-hold keeps the start time; release on unmount lets it through', async () => {
  const f = await booted();
  f.u.hold('gameday-lineup');
  const at = f.u.st.holds['gameday-lineup'].at;
  f.tick(1000); f.u.hold('gameday-lineup');
  assert.equal(f.u.st.holds['gameday-lineup'].at, at, 'a re-render re-hold does not reset the age');
  f.u.touch(); f.hidden = true; await f.u.hide();
  await run(f, 10 * MIN);
  f.hidden = false; await f.u.resume(); await run(f, 10 * MIN);
  assert.equal(f.navs.length, 0);
  f.u.release('gameday-lineup'); await flush();
  assert.deepEqual(f.why(), ['idle']);
});

test('predicate hold (plain pages): blocks while fn() is truthy; a throwing fn counts as held', async () => {
  const f = await booted();
  let dirty = true;
  f.u.hold('connect-form', () => dirty);
  await run(f, 10 * MIN);
  assert.equal(f.navs.length, 0);
  dirty = false; await run(f, 15000);
  assert.equal(f.navs.length, 1);
  const g = await booted();
  g.u.hold('broken', () => { throw new Error('x'); });
  await run(g, 10 * MIN);
  assert.equal(g.navs.length, 0, 'unknown state: keep holding');
});

test('hard cap: a hold on work untouched ≥ 2 h is ignored only after ≥ 30 min away', async () => {
  const f = await booted();
  f.u.hold('strategy-editor');
  await run(f, 3 * HOUR);                          // left on screen, untouched: idle rule never overrides a hold
  assert.equal(f.navs.length, 0, 'visible idle never beats a hold');
  f.hidden = true; await f.u.hide();
  f.tick(29 * MIN); f.hidden = false; await f.u.resume();
  assert.equal(f.navs.length, 0, 'away 29 min: still held');
  f.hidden = true; await f.u.hide();
  f.tick(31 * MIN); f.hidden = false; await f.u.resume();
  assert.deepEqual(f.why(), ['resume'], 'stale hold + long absence: update applies');

  const g = await booted();                        // touched recently → the work is fresh
  g.u.hold('trade-builder');
  await run(g, 3 * HOUR); g.u.touch();
  g.hidden = true; await g.u.hide(); g.tick(40 * MIN); g.hidden = false; await g.u.resume();
  assert.equal(g.navs.length, 0, 'work touched 40 min ago stays protected');

  const h = await booted();                        // the cap never overrides a live guard
  h.u.hold('x'); await run(h, 3 * HOUR); h.unsafe = 'typing';
  h.hidden = true; await h.u.hide(); h.tick(HOUR); h.hidden = false; await h.u.resume();
  assert.equal(h.navs.length, 0);
});

test('a throwing guard or a corrupted reload log never throws out of the updater', async () => {
  const f = await booted();
  f.unsafe = () => { throw new Error('dom gone'); };
  await run(f, 6 * MIN);
  assert.equal(f.navs.length, 0, 'unknown guard state: wait');
  const g = rig();
  g.hist = { not: 'an array' };
  assert.equal(g.u.start(), true);
  g.tick(10000); await g.u.check('load');
  assert.equal(LU.loopBlock({ bad: 1 }, V1, V2, 0, LU.CFG), null);
});

test('hidden with no visibility event (hiddenAt unset): starts counting at the next beat', async () => {
  const f = await booted();
  f.u.touch(); f.hidden = true;                    // no hide() call
  await run(f, 2 * MIN + 30000);
  assert.deepEqual(f.why(), ['hidden']);
});

// ── Deploy safety (2026-09-28 "website down" incident) ───────────────────────
const iso = ms => new Date(ms).toISOString();

test('settle: a version.json built < 4 min ago is ignored unless critical', () => {
  const c = LU.CFG, now = 1_790_000_000_000;
  const base = { own: V1, hidden: true, hiddenFor: 60 * MIN, resumeAway: null, idleFor: 60 * MIN, unsafe: null, loop: null };
  const d = (latest, seenAt = 0) => LU.decide({ ...base, latest, age: LU.buildAge(latest, seenAt, now) }, c);
  assert.deepEqual(d({ build: V2, builtAt: iso(now - 3 * MIN) }), { act: 'wait', why: 'settling' });
  assert.deepEqual(d({ build: V2, builtAt: iso(now - 4 * MIN) }), { act: 'reload', why: 'hidden' });
  assert.equal(d({ build: V2, builtAt: iso(now - 30000), critical: true }).why, 'hidden', 'critical skips the settle');
  assert.equal(d({ build: V2 }).why, 'hidden', 'no builtAt (older build): no settle wait');
  assert.equal(d({ build: V2, builtAt: 'garbage' }).why, 'hidden');
  // Client clock 1 h behind: builtAt looks like the future; time since first seen still settles it.
  const ahead = { build: V2, builtAt: iso(now + HOUR) };
  assert.equal(d(ahead, now - MIN).why, 'settling');
  assert.equal(d(ahead, now - 4 * MIN).why, 'hidden');
  assert.equal(LU.buildAge({ build: V2, builtAt: iso(now - MIN) }, now - 5 * MIN, now), 5 * MIN, 'the longer of the two');
});

test('settle: the controller holds a fresh deploy for 4 min, then applies it', async () => {
  const f = await booted({ noDeploy: true });
  f.latest = { build: V2, builtAt: iso(f.t) };      // deploy lands right now
  f.tick(20000); await f.u.check('focus');
  f.u.touch(); f.hidden = true; await f.u.hide();
  await run(f, 3 * MIN);
  assert.equal(f.navs.length, 0, 'hidden 3 min, but the build is < 4 min old');
  await run(f, MIN);
  assert.deepEqual(f.why(), ['hidden']);
});

test('idle rule: a user who just came back is reading, not idle (incident repro)', async () => {
  // Mirrors the 16:40:06 reload: away 13 min, a guard held the resume reload,
  // it cleared 20 s later with no touch since — the old rule saw 13 min idle.
  const f = await booted();
  f.u.touch();
  f.tick(30000); f.hidden = true; await f.u.hide();
  f.tick(13 * MIN); f.hidden = false; f.unsafe = 'modal';
  const r = await f.u.resume();
  assert.equal(r.act, 'wait');
  f.tick(20000); f.unsafe = null;
  const b = await f.u.beat();
  assert.equal(f.navs.length, 0, 'not reloaded 20 s after coming back');
  assert.equal(b.why, 'active');
  await run(f, 4 * MIN);
  assert.equal(f.navs.length, 0, 'still reading 4 min later');
  await run(f, MIN);
  assert.deepEqual(f.why(), ['idle'], 'five untouched minutes after the return: idle applies');
});

test('idle rule: resumeAt vs activity — the later one wins', () => {
  const f = rig();
  f.u.start();
  f.u.st.latest = { build: V2 };
  f.u.st.activity = f.t - 10 * MIN; f.u.st.resumeAt = f.t - MIN;
  assert.equal(f.u.evaluate('beat').why, 'active', 'returned 1 min ago, last touch 10 min ago');
  f.u.st.activity = f.t - MIN; f.u.st.resumeAt = f.t - 10 * MIN;
  assert.equal(f.u.evaluate('beat').why, 'active', 'touched 1 min ago');
});

// Asset check -----------------------------------------------------------------
const ASSETS = { 'js/app.js': 'aaaaaaaaaa', 'js/core.js': 'bbbbbbbbbb', 'reconai-shared/tier.js': 'cccccccccc' };
const LATEST = {
  build: V2, assets: ASSETS,
  pages: { 'index.html': ['js/core.js?v=bbbbbbbbbb', 'js/app.js?v=aaaaaaaaaa', 'reconai-shared/tier.js?v=stamp12345'] },
};

test('assetList: version.json pages/assets first, else the fetched HTML scripts', () => {
  assert.deepEqual(LU.assetList(LATEST, 'index.html', null).map(a => [a.path, a.hash]), [
    ['js/core.js', 'bbbbbbbbbb'], ['js/app.js', 'aaaaaaaaaa'], ['reconai-shared/tier.js', 'cccccccccc'],
  ]);
  const html = `<script src="vendor/react.js?v=0123456789"></script>
    <script type="text/wr-deferred" data-wr-defer="alex" src="js/tabs/x.js?v=20260928deploy1"></script>
    <script src="https://cdn.example.com/lib.js"></script><script src="//cdn.example.com/b.js"></script>
    <script src="/js/root.js?v=abcdefabcd"></script><script src="vendor/react.js?v=0123456789"></script>`;
  assert.deepEqual(LU.assetList({ build: V2 }, 'landing.html', html), [
    { url: 'vendor/react.js?v=0123456789', path: 'vendor/react.js', hash: '0123456789' },
    { url: 'js/tabs/x.js?v=20260928deploy1', path: 'js/tabs/x.js', hash: null },
    { url: '/js/root.js?v=abcdefabcd', path: 'js/root.js', hash: 'abcdefabcd' },
  ], 'same-origin only, deduped; a ?v= build hash doubles as the expected hash');
  assert.deepEqual(LU.assetList({ build: V2 }, 'index.html', null), [], 'no map and no HTML: nothing to check');
});

function served(table) { // url -> { status, hash } | 'hang' | Error
  const calls = [];
  const fetchAsset = a => {
    calls.push(a.url);
    const r = table[a.path];
    if (r === 'hang') return never();
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r || { status: 200, hash: ASSETS[a.path] });
  };
  return { calls, fetchAsset };
}

test('checkAssets: all served with the right bytes → ok', async () => {
  const s = served({});
  const r = await LU.checkAssets(LU.assetList(LATEST, 'index.html'), s.fetchAsset, { concurrency: 2, timeoutMs: 1000 });
  assert.deepEqual(r, { ok: true, checked: 3 });
  assert.equal(s.calls.length, 3);
});

test('checkAssets: one 404 → fails naming the asset', async () => {
  const s = served({ 'js/app.js': { status: 404 } });
  const r = await LU.checkAssets(LU.assetList(LATEST, 'index.html'), s.fetchAsset, { concurrency: 1, timeoutMs: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.why, 'http-404');
  assert.equal(r.url, 'js/app.js?v=aaaaaaaaaa');
});

test('checkAssets: stale bytes (CDN still on the old file) → hash mismatch', async () => {
  const s = served({ 'js/core.js': { status: 200, hash: 'oldoldoldo' } });
  const r = await LU.checkAssets(LU.assetList(LATEST, 'index.html'), s.fetchAsset, {});
  assert.deepEqual([r.ok, r.why, r.url], [false, 'hash', 'js/core.js?v=bbbbbbbbbb']);
  const noHash = await LU.checkAssets([{ url: 'a.js', path: 'a.js', hash: null }], () => Promise.resolve({ status: 200, hash: 'x' }), {});
  assert.equal(noHash.ok, true, 'nothing to compare against: status only');
});

test('checkAssets: a stalled asset times out; a network error fails', async () => {
  const s = served({ 'reconai-shared/tier.js': 'hang' });
  const r = await LU.checkAssets(LU.assetList(LATEST, 'index.html'), s.fetchAsset, { concurrency: 6, timeoutMs: 20 });
  assert.deepEqual([r.ok, r.why, r.checked], [false, 'timeout', 2]);
  const e = served({ 'js/core.js': new TypeError('Failed to fetch') });
  assert.equal((await LU.checkAssets(LU.assetList(LATEST, 'index.html'), e.fetchAsset, {})).why, 'error');
  assert.deepEqual(await LU.checkAssets([], e.fetchAsset, {}), { ok: true, checked: 0 });
});

test('checkAssets: concurrency is bounded', async () => {
  let live = 0, peak = 0;
  const list = Array.from({ length: 20 }, (_, i) => ({ url: 'f' + i + '.js', path: 'f' + i + '.js', hash: null }));
  const r = await LU.checkAssets(list, () => { live++; peak = Math.max(peak, live); return new Promise(res => setTimeout(() => { live--; res({ status: 200 }); }, 2)); }, { concurrency: 4 });
  assert.equal(r.ok, true);
  assert.equal(peak, 4);
});

test('pre-reload check: a missing asset blocks the reload; retries back off 1, 2, 4 min; then applies', async () => {
  const f = await booted();
  let bad = 'http-404 js/app.js?v=aaaaaaaaaa', verifies = 0;
  const u = LU.createUpdater({
    now: () => f.t, own: () => V1, hidden: () => f.hidden, unsafe: () => null,
    fetchLatest: () => Promise.resolve({ build: V2 }), prefetch: () => Promise.resolve(V2),
    verify: (target, latest, servedBuild) => { verifies++; assert.equal(target, V2); assert.equal(servedBuild, V2); return Promise.resolve(bad); },
    navigate: (mode, target) => f.navs.push({ mode, target }), track() {},
    store: { get: () => [], set() {} }, after: () => {}, every: () => {},
  }, null);
  u.start(); f.tick(10000); await u.check('load');
  const beat = async ms => { for (let t = 0; t < ms; t += 15000) { f.tick(15000); await u.beat(); } };
  await beat(5 * MIN);
  assert.equal(verifies, 1);
  assert.equal(f.navs.length, 0, '404 on the new build: no reload');
  assert.deepEqual(u.st.lastFail.why + ' ' + u.st.lastFail.detail, 'assets http-404 js/app.js?v=aaaaaaaaaa');
  await beat(MIN); assert.equal(verifies, 2, 'retried after 1 min');
  await beat(MIN); assert.equal(verifies, 2, 'then waits 2 min');
  await beat(MIN); assert.equal(verifies, 3);
  await beat(3 * MIN); assert.equal(verifies, 3, 'then 4 min');
  bad = null;
  await beat(MIN + 15000);
  assert.equal(verifies, 4);
  assert.deepEqual(f.navs, [{ mode: 'reload', target: V2 }], 'fully served: applies');
});

test('pre-reload check: an asset check over budget counts as not ready', async () => {
  const f = await booted();
  f.u.touch();
  const timers = [];
  const u = LU.createUpdater({
    now: () => f.t, own: () => V1, hidden: () => false, unsafe: () => null,
    fetchLatest: () => Promise.resolve({ build: V2 }), prefetch: () => Promise.resolve(V2),
    verify: () => never(),
    navigate: (mode, target) => f.navs.push({ mode, target }), track() {},
    store: { get: () => [], set() {} }, after: (ms, fn) => timers.push({ ms, fn }), every: () => {},
  }, null);
  u.start(); f.tick(10000); await u.check('load');
  f.tick(6 * MIN); const p = u.beat();
  await flush(); await flush();
  const budget = timers.find(x => x.ms === LU.CFG.assetBudgetMs);
  assert.ok(budget, 'budget timer armed');
  budget.fn();
  const d = await p;
  assert.deepEqual([d.act, d.why, d.detail], ['wait', 'assets', 'budget']);
  assert.equal(f.navs.length, 0);
  assert.equal(u.st.applying, false);
});

test('surface: iOS shell only on iPhone/iPad/iPod or iPad desktop mode — not a Mac webview', () => {
  const wk = 'Mozilla/5.0 (%s) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  assert.equal(LU.surfaceOf({ userAgent: wk.replace('%s', 'iPhone; CPU iPhone OS 18_7 like Mac OS X') }), 'ios_app');
  assert.equal(LU.surfaceOf({ userAgent: wk.replace('%s', 'Macintosh; Intel Mac OS X 10_15_7'), platform: 'MacIntel', maxTouchPoints: 5 }), 'ios_app', 'iPad desktop mode');
  assert.equal(LU.surfaceOf({ userAgent: wk.replace('%s', 'Macintosh; Intel Mac OS X 10_15_7'), platform: 'MacIntel', maxTouchPoints: 0 }), 'web', 'Mac app webview');
  assert.equal(LU.surfaceOf({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1' }), 'web', 'mobile Safari');
  assert.equal(LU.surfaceOf({}), 'web');
});

test('live_update_applied carries why (reason), trigger (legacy copy) and via (the check that ran)', () => {
  const f = rig({ own: V2 });
  f.hist = [{ from: V1, to: V2, at: f.t - 5000, why: 'idle', via: 'beat', mode: 'reload' }];
  f.u.start();
  assert.deepEqual(f.tracks[0].meta, { from: V1, to: V2, landed: V2, ok: true, why: 'idle', trigger: 'idle', mode: 'reload', via: 'beat' });
});
