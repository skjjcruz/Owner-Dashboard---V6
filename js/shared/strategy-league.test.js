// Run with:  node --test js/shared/strategy-league.test.js
// GM strategy must not leak between leagues (shared strategy.js + gm-mode.js),
// and strategies already saved on users' devices must keep working.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const STRATEGY_SRC = fs.readFileSync(path.join(ROOT, 'reconai-shared', 'strategy.js'), 'utf8');
const GM_MODE_SRC = fs.readFileSync(path.join(__dirname, 'gm-mode.js'), 'utf8');
const GLOBAL_KEY = 'dhq_gm_strategy_v1';

function makeEnv(seed) {
    const data = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    const localStorage = {
        getItem: k => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => { data.set(k, String(v)); },
        removeItem: k => { data.delete(k); },
    };
    const listeners = {};
    const ctx = {
        localStorage,
        console,
        setTimeout: () => 0,
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        document: { readyState: 'complete', addEventListener() {} },
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        removeEventListener() {},
        dispatchEvent: (e) => (listeners[e.type] || []).forEach(fn => fn(e)),
    };
    ctx.window = ctx;
    const bus = {};
    ctx.DhqEvents = { on: (n, fn) => { (bus[n] = bus[n] || []).push(fn); }, emit: (n, d) => (bus[n] || []).forEach(fn => fn(d)) };
    ctx.App = {
        WR_KEYS: { GM_STRATEGY: id => 'wr_gm_strategy_' + id },
        WrStorage: {
            get: (k, fb = null) => { const v = localStorage.getItem(k); if (v === null) return fb; try { return JSON.parse(v); } catch { return v; } },
            set: (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)),
        },
    };
    vm.createContext(ctx);
    vm.runInContext(STRATEGY_SRC, ctx);
    vm.runInContext(GM_MODE_SRC, ctx);
    return { ctx, data, read: k => JSON.parse(data.get(k)) };
}

test('a plan stamped for league A never reaches league B', () => {
    const env = makeEnv({
        [GLOBAL_KEY]: { mode: 'rebuild', leagueId: 'A', aggression: 'conservative', lastSyncedAt: 200, version: 4 },
        wr_gm_strategy_B: { mode: 'win_now', leagueId: 'B', aggression: 'aggressive', lastSyncedAt: 100 },
    });
    const G = env.ctx.GMStrategy, M = env.ctx.WR.GmMode;
    assert.equal(G.getStrategy('A').mode, 'rebuild');
    assert.equal(G.getStrategy('B'), null, 'another league\'s plan is not returned');
    assert.equal(M.getMode('B'), 'win_now');
    assert.equal(M.effects('B').aggressionKey, 'aggressive');
    assert.equal(M.effects('A').mode, 'rebuild');
    // A league with no plan of its own gets no plan — not league A's.
    assert.equal(M.effects('C').hasStrategy, false);
    assert.equal(M.promptBlock('C'), '');
});

test('no-arg reads (Scout, gm-engine fallback) still see the one stored strategy', () => {
    const env = makeEnv({ [GLOBAL_KEY]: { mode: 'rebuild', leagueId: 'A' } });
    assert.equal(env.ctx.GMStrategy.getStrategy().mode, 'rebuild');
    assert.equal(env.ctx.GMStrategy.getStrategy('').mode, 'rebuild');
});

test('nothing saved: getStrategy(leagueId) keeps returning the default object', () => {
    const env = makeEnv({});
    const s = env.ctx.GMStrategy.getStrategy('A');
    assert.ok(s && typeof s === 'object');
    assert.equal(s.mode, 'balanced_rebuild');
});

test('migration: an old unstamped plan is not lost', () => {
    // Before the stamp existed. League A was opened before (league-detail
    // copied the plan into A's record); league N never was.
    const legacy = { mode: 'win_now', aggression: 'aggressive', lastSyncedAt: 500, version: 3 };
    const env = makeEnv({
        [GLOBAL_KEY]: legacy,
        wr_gm_strategy_A: { ...legacy, riskTolerance: 'moderate', leagueId: 'A' },
    });
    const M = env.ctx.WR.GmMode;
    assert.equal(M.getMode('A'), 'win_now', 'A keeps what it showed before (its own copy)');
    assert.equal(M.getMode('N'), 'win_now', 'a never-opened league still gets the legacy plan');
    assert.equal(env.ctx.GMStrategy.getStrategy('A'), null, 'A reads its own record, not the shared one');
    assert.equal(env.read(GLOBAL_KEY).leagueId, undefined, 'reads never write/stamp');
});

test('migration: a newer unstamped save (e.g. from Scout) still reaches every league', () => {
    const env = makeEnv({
        [GLOBAL_KEY]: { mode: 'rebuild', lastSyncedAt: 900, version: 5 },
        wr_gm_strategy_A: { mode: 'win_now', leagueId: 'A', lastSyncedAt: 500 },
    });
    assert.equal(env.ctx.WR.GmMode.getMode('A'), 'rebuild');
});

test('after a save in league B, league A keeps its own plan and stops following B', () => {
    const legacy = { mode: 'compete', lastSyncedAt: 500, version: 3, faFilters: { minDhq: 3000 } };
    const env = makeEnv({
        [GLOBAL_KEY]: legacy,
        wr_gm_strategy_A: { ...legacy, leagueId: 'A' },
        wr_gm_strategy_B: { ...legacy, leagueId: 'B' },
    });
    const M = env.ctx.WR.GmMode;
    M.applyPreset('B', 'rebuild');
    const stored = env.read(GLOBAL_KEY);
    assert.equal(stored.leagueId, 'B', 'the save stamps the shared plan');
    assert.equal(stored.mode, 'rebuild');
    assert.equal(M.getMode('B'), 'rebuild');
    assert.equal(M.getMode('A'), 'compete', 'A is untouched');
    assert.equal(M.effects('A').faFilters.minDhq, 3000);
});

test('saving for another league does not inherit the stored league\'s extra fields', () => {
    const env = makeEnv({ [GLOBAL_KEY]: { mode: 'rebuild', leagueId: 'A', faFilters: { minDhq: 5000 }, version: 7 } });
    const saved = env.ctx.GMStrategy.saveStrategy({ mode: 'win_now', leagueId: 'B' });
    assert.equal(saved.leagueId, 'B');
    assert.equal(saved.faFilters, null, 'A\'s FA filters stay with A');
    assert.equal(saved.version, 8, 'version keeps climbing for cross-device sync');
    // Scout-style save (no leagueId) keeps merging over the stored plan.
    const scout = env.ctx.GMStrategy.saveStrategy({ aggression: 'aggressive' });
    assert.equal(scout.leagueId, 'B');
    assert.equal(scout.mode, 'win_now');
});

test('the in-memory "last strategy" fallback is league-checked too', () => {
    const env = makeEnv({});
    env.ctx._wrGmStrategy = { mode: 'rebuild', leagueId: 'A' };
    assert.equal(env.ctx.WR.GmMode.effects('B').hasStrategy, false);
    assert.equal(env.ctx.WR.GmMode.effects('A').mode, 'rebuild');
});

test('a remote sync of league A\'s plan does not become the open league B\'s in-memory plan', () => {
    const env = makeEnv({});
    env.ctx.S = { currentLeagueId: 'B' };
    env.ctx._wrGmStrategy = { mode: 'win_now', leagueId: 'B' };
    env.ctx.DhqEvents.emit('strategy:changed', { mode: 'rebuild', leagueId: 'A' });
    assert.equal(env.ctx._wrGmStrategy.leagueId, 'B');
    env.ctx.DhqEvents.emit('strategy:changed', { mode: 'compete', leagueId: 'B' });
    assert.equal(env.ctx._wrGmStrategy.mode, 'compete');
});
