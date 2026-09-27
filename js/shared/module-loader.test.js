// Run with:  node --test js/shared/module-loader.test.js
// js/module-loader.js against a tiny fake DOM: a stalled bundle times out
// instead of spinning forever, a failed group can be retried, and a retry
// never runs a module twice.
/* global setImmediate */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'module-loader.js'), 'utf8');

function makeEnv(srcs) {
    const timers = [];
    const injected = []; // every <script> the loader appended, in order
    const deferred = srcs.map(src => ({ getAttribute: (a) => (a === 'type' ? 'text/wr-deferred' : a === 'src' ? src : null) }));
    const events = [];
    const listeners = {};
    const ctx = {
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
        clearTimeout: (t) => { if (t) t.cleared = true; },
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        Event: function (type) { this.type = type; },
        document: {
            querySelectorAll: () => deferred,
            createElement: () => ({ parentNode: null }),
            head: {
                appendChild(el) { el.parentNode = this; injected.push(el); },
                removeChild(el) { el.parentNode = null; },
            },
        },
    };
    ctx.window = ctx;
    ctx.dispatchEvent = (e) => events.push(e.type);
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    const fire = (el, kind, message) => {
        if (kind === 'throw') { // top-level throw: window 'error' for that file, then load
            (listeners.error || []).forEach(fn => fn({ filename: el.src, message: message || 'TypeError: Cannot destructure DraftCC.styles' }));
            return el.onload();
        }
        return el[kind === 'load' ? 'onload' : 'onerror']();
    };
    const fireTimeout = () => timers.filter(t => !t.cleared && t.ms === 45000).forEach(t => { t.cleared = true; t.fn(); });
    return { ctx, injected, timers, events, fire, fireTimeout };
}

const settle = (p) => p.then(() => 'resolved', (e) => 'rejected: ' + e.message);
const tick = () => new Promise(r => setImmediate(r));

test('all scripts load: group resolves once and announces itself', async () => {
    const env = makeEnv(['a.js', 'b.js']);
    const p = env.ctx.wrLoadModuleGroup('trade');
    assert.equal(env.injected.length, 2);
    env.injected.forEach(el => env.fire(el, 'load'));
    assert.equal(await settle(p), 'resolved');
    assert.equal(env.ctx.wrModuleGroupLoaded('trade'), true);
    assert.deepEqual(env.events, ['wr:module-group-loaded']);
    assert.equal(env.ctx.wrLoadModuleGroup('trade'), p, 'a loaded group stays memoised');
});

test('a stalled bundle rejects after 45s instead of hanging on Loading…', async () => {
    const env = makeEnv(['a.js', 'b.js']);
    const p = env.ctx.wrLoadModuleGroup('draft');
    env.fire(env.injected[0], 'load'); // b.js never settles
    env.fireTimeout();
    assert.match(await settle(p), /stalled: nothing arrived for 45000ms/);
    assert.equal(env.ctx.wrModuleGroupLoaded('draft'), false);
});

test('retry after a timeout waits on the stalled tag instead of injecting a twin', async () => {
    const env = makeEnv(['a.js', 'b.js']);
    const p1 = env.ctx.wrLoadModuleGroup('draft');
    env.fire(env.injected[0], 'load');
    env.fireTimeout();
    await settle(p1);
    const p2 = env.ctx.wrLoadModuleGroup('draft');
    assert.notEqual(p2, p1, 'the failed promise was dropped, so this is a real retry');
    assert.equal(env.injected.length, 2, 'no second a.js (already ran) and no twin b.js (still queued)');
    env.fire(env.injected[1], 'load'); // the slow original finally lands
    assert.equal(await settle(p2), 'resolved');
    assert.equal(env.ctx.__wrDraftLoaded, true);
});

test('retry after a network error re-runs the failed script and everything after it, never what ran before', async () => {
    const env = makeEnv(['a.js', 'b.js', 'c.js']);
    const p1 = env.ctx.wrLoadModuleGroup('fa');
    env.fire(env.injected[0], 'load');
    env.fire(env.injected[1], 'error');
    assert.match(await settle(p1), /failed to load/);
    env.fire(env.injected[2], 'load'); // c.js ran WITHOUT b.js — may be broken
    await tick();
    const p2 = env.ctx.wrLoadModuleGroup('fa');
    await tick();
    assert.deepEqual(env.injected.slice(3).map(el => el.src), ['b.js', 'c.js'], 'a.js (ran before the failure) is not run twice');
    env.injected.slice(3).forEach(el => env.fire(el, 'load'));
    assert.equal(await settle(p2), 'resolved');
});

test('a script that throws while starting counts as a failure, and the retry re-runs it and the tail', async () => {
    const env = makeEnv(['styles.js', 'board.js', 'room.js', 'picks.js']);
    const p1 = env.ctx.wrLoadModuleGroup('draft');
    env.fire(env.injected[0], 'load');
    env.fire(env.injected[1], 'throw'); // e.g. DraftCC.styles missing
    assert.match(await settle(p1), /threw while starting: board\.js/);
    env.fire(env.injected[2], 'load');
    env.fire(env.injected[3], 'load');
    await tick();
    assert.equal(env.ctx.wrModuleGroupLoaded('draft'), false, 'a group with a crashed module is not "loaded"');
    const p2 = env.ctx.wrLoadModuleGroup('draft');
    await tick();
    assert.deepEqual(env.injected.slice(4).map(el => el.src), ['board.js', 'room.js', 'picks.js']);
    env.injected.slice(4).forEach(el => env.fire(el, 'load'));
    assert.equal(await settle(p2), 'resolved');
    assert.equal(env.ctx.__wrDraftLoaded, true);
    // Next load after success: nothing re-run.
    assert.equal(await settle(env.ctx.wrLoadModuleGroup('draft')), 'resolved');
    assert.equal(env.injected.length, 7);
});

test('tail scripts still in flight are waited for, never duplicated, then re-run in order', async () => {
    const env = makeEnv(['a.js', 'b.js', 'c.js']);
    const p1 = env.ctx.wrLoadModuleGroup('trade');
    env.fire(env.injected[0], 'load');
    env.fire(env.injected[1], 'error'); // c.js is still downloading
    await settle(p1);
    const p2 = env.ctx.wrLoadModuleGroup('trade');
    await tick();
    assert.equal(env.injected.length, 3, 'nothing injected while c.js is still in the queue');
    env.fire(env.injected[2], 'load'); // the old c.js lands (ran without b.js)
    await tick(); await tick();
    assert.deepEqual(env.injected.slice(3).map(el => el.src), ['b.js', 'c.js'], 'then b.js and c.js, in order');
    env.injected.slice(3).forEach(el => env.fire(el, 'load'));
    assert.equal(await settle(p2), 'resolved');
});

const REDECLARED = "Uncaught SyntaxError: Identifier 'DRAFT_WR_KEYS' has already been declared";

test('re-running a file with top-level const that already ran fine: its first run stands, the group loads', async () => {
    const env = makeEnv(['styles.js', 'scouting.js', 'draft-room.js', 'picks.js']);
    const p1 = env.ctx.wrLoadModuleGroup('draft');
    env.fire(env.injected[0], 'load');
    env.fire(env.injected[1], 'error');
    await settle(p1);
    env.fire(env.injected[2], 'load'); // draft-room.js ran fine the first time
    env.fire(env.injected[3], 'load');
    await tick();
    const p2 = env.ctx.wrLoadModuleGroup('draft');
    await tick();
    const tail = env.injected.slice(4);
    assert.deepEqual(tail.map(el => el.src), ['scouting.js', 'draft-room.js', 'picks.js']);
    env.fire(tail[0], 'load');
    env.fire(tail[1], 'throw', REDECLARED); // the engine refuses the second evaluation
    env.fire(tail[2], 'load');
    assert.equal(await settle(p2), 'resolved');
});

test('a top-level-const file that CRASHED on its first run can only be redone by a reload', async () => {
    const env = makeEnv(['styles.js', 'draft-room.js']);
    const p1 = env.ctx.wrLoadModuleGroup('draft');
    env.fire(env.injected[0], 'load');
    env.fire(env.injected[1], 'throw');
    await settle(p1);
    const p2 = env.ctx.wrLoadModuleGroup('draft');
    await tick();
    env.fire(env.injected[2], 'throw', REDECLARED);
    const err = await p2.then(() => null, e => e);
    assert.ok(err && err.reloadRequired, 'group error says a reload is needed');
    assert.equal(env.ctx.wrModuleGroupLoaded('draft'), false);
});

test('an error from some other file is not blamed on a deferred script', async () => {
    const env = makeEnv(['a.js']);
    const p = env.ctx.wrLoadModuleGroup('alex');
    const el = env.injected[0];
    const realSrc = el.src; el.src = 'other.js'; // error event names a different file
    env.fire(el, 'throw'); el.src = realSrc;
    assert.equal(await settle(p), 'resolved');
});

test('the 45s clock is a stall timer: every script that lands restarts it', async () => {
    const env = makeEnv(['a.js', 'b.js', 'c.js']);
    const p = env.ctx.wrLoadModuleGroup('draft');
    env.fire(env.injected[0], 'load');
    await tick();
    env.fire(env.injected[1], 'load');
    await tick();
    const live = env.timers.filter(t => !t.cleared && t.ms === 45000);
    assert.equal(live.length, 1, 'exactly one armed stall timer, restarted on progress');
    env.fire(env.injected[2], 'load');
    assert.equal(await settle(p), 'resolved');
    assert.equal(env.timers.filter(t => !t.cleared && t.ms === 45000).length, 0, 'no timer left behind');
});

test('a group that finishes AFTER the stall rejection is still marked loaded and announced', async () => {
    const env = makeEnv(['free-agency.js']);
    const p = env.ctx.wrLoadModuleGroup('fa');
    env.fireTimeout(); // nothing for 45s → the tab shows its retry UI
    assert.match(await settle(p), /stalled/);
    assert.equal(env.ctx.wrModuleGroupLoaded('fa'), false);
    env.fire(env.injected[0], 'load'); // the request finally answers (e.g. at 57s)
    await tick();
    assert.equal(env.ctx.wrModuleGroupLoaded('fa'), true);
    assert.deepEqual(env.events, ['wr:module-group-loaded'], 'surfaces waiting on the event recover by themselves');
    assert.equal(await settle(env.ctx.wrLoadModuleGroup('fa')), 'resolved', 'later calls resolve at once');
    assert.equal(env.injected.length, 1, 'nothing re-requested');
});

test('a failed load is not cached forever', async () => {
    const env = makeEnv(['a.js']);
    const p1 = env.ctx.wrLoadModuleGroup('alex');
    env.fire(env.injected[0], 'error');
    await settle(p1);
    const p2 = env.ctx.wrLoadModuleGroup('alex');
    assert.equal(env.injected.length, 2);
    env.fire(env.injected[1], 'load');
    assert.equal(await settle(p2), 'resolved');
});

test('raw dev mode (nothing deferred) resolves immediately', async () => {
    const env = makeEnv([]);
    assert.equal(await settle(env.ctx.wrLoadModuleGroup('compare')), 'resolved');
    assert.equal(env.timers.length, 0, 'no timeout armed');
});
