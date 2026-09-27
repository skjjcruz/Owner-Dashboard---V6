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
    const ctx = {
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
    const fire = (el, kind) => el[kind === 'load' ? 'onload' : 'onerror']();
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
    assert.match(await settle(p), /timed out after 45000ms/);
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

test('retry after a network error re-requests only what failed', async () => {
    const env = makeEnv(['a.js', 'b.js', 'c.js']);
    const p1 = env.ctx.wrLoadModuleGroup('fa');
    env.fire(env.injected[0], 'load');
    env.fire(env.injected[1], 'error');
    assert.match(await settle(p1), /failed to load/);
    // c.js executes after b.js failed — it may have crashed at IIFE entry, so
    // it is NOT counted as done.
    env.fire(env.injected[2], 'load');
    await tick();
    const p2 = env.ctx.wrLoadModuleGroup('fa');
    const again = env.injected.slice(3).map(el => el.src);
    assert.deepEqual(again, ['b.js', 'c.js'], 'a.js ran fine and is skipped; b.js and c.js run again, in order');
    env.injected.slice(3).forEach(el => env.fire(el, 'load'));
    assert.equal(await settle(p2), 'resolved');
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
