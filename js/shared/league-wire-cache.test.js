// Run with:  node --test js/shared/league-wire-cache.test.js
// Ported from C2 tests/league-wire-cache.cjs (2026-09-27) + Dynasty HQ
// additions: indexedDB property access throwing, open errors (private mode),
// and quota/abort on write all degrade to "not cached", never a crash.
/* global structuredClone */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const src = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

test('C2 persistent archive: reload reuse, manual recheck, corrupt / wrong-league recovery, cancellation, storage denial', async () => {
    const disk = new Map();
    const row = (rid, points) => ({ roster_id: rid, points, matchup_id: 1, starters: ['p'], players_points: { p: 5, bench: 8 } });
    const older = { league_id: 'old', season: '2025', status: 'complete', previous_league_id: null, settings: { playoff_week_start: 2 }, rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }], users: [{ user_id: 'a', display_name: 'A' }] };
    const current = { league_id: 'current', season: '2026' };
    let calls = [];
    const fetcher = async url => { calls.push(url); const p = url.split('/league/')[1]; const body = { current: { ...current, previous_league_id: 'old' }, old: older, 'old/rosters': older.rosters, 'old/users': older.users, 'old/matchups/1': [row(1, 20), row(2, 10)] }[p]; return { ok: !!body, json: async () => body }; };
    function runtime(store = disk) {
        const root = { console, setTimeout, clearTimeout, AbortController, fetch: fetcher, WrWireArchiveCache: { read: async id => structuredClone(store.get(id)), write: async s => { if (s.league.status === 'complete') store.set(s.league.league_id, structuredClone(s)); } } };
        root.window = root; vm.createContext(root);
        for (const file of ['league-live-scores', 'league-live-table', 'league-wire-journal']) vm.runInContext(src(`${file}.js`), root);
        return root;
    }
    const first = await runtime().WrWireStories.loadArchive({ league: current, fetcher });
    assert(first.complete); assert(disk.has('old')); assert.equal(calls.length, 5);
    calls = [];
    const reopened = await runtime().WrWireStories.loadArchive({ league: current, fetcher });
    assert(reopened.complete); assert.equal(calls.length, 1, 'new browser context fetches only current lineage; no historical endpoints');
    assert.equal(reopened.seasons[0].weeks[0].rows[0].points, 20);
    calls = [];
    await runtime().WrWireStories.loadArchive({ league: current, fetcher, force: true });
    assert.equal(calls.length, 5, 'explicit recheck bypasses historical cache');
    const corrupt = new Map([['old', { ...first.seasons[0], weeks: [{ week: 1, rows: [row(1, 999)] }] }]]);
    calls = [];
    const recovered = await runtime(corrupt).WrWireStories.loadArchive({ league: current, fetcher });
    assert.equal(calls.length, 5); assert.equal(recovered.seasons[0].weeks[0].rows[0].points, 20, 'incomplete stored scores are fetched again');
    const wrong = new Map([['old', { ...first.seasons[0], league: { ...older, league_id: 'other' } }]]);
    calls = []; await runtime(wrong).WrWireStories.loadArchive({ league: current, fetcher }); assert.equal(calls.length, 5, 'cache identity checked');
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(runtime().WrWireStories.loadArchive({ league: current, signal: aborted.signal, fetcher }), /interrupted/);
    // Storage adapter denial through its public methods.
    const storage = { setTimeout, clearTimeout, indexedDB: { open() { throw Error('denied'); } } }; storage.window = storage; vm.createContext(storage);
    vm.runInContext(src('league-wire-cache.js'), storage);
    assert.equal(await storage.WrWireArchiveCache.read('old'), null);
    assert.equal(await storage.WrWireArchiveCache.write(first.seasons[0]), false);
});

test('Dynasty HQ: private mode / blocked storage / quota never throw', async () => {
    const make = indexedDB => { const r = { setTimeout, clearTimeout }; Object.defineProperty(r, 'indexedDB', indexedDB); r.window = r; vm.createContext(r); vm.runInContext(src('league-wire-cache.js'), r); return r.WrWireArchiveCache; };
    const complete = { league: { league_id: 'x', season: '2025', status: 'complete', rosters: [{ roster_id: 1, owner_id: 'a' }], users: [] }, weeks: [] };
    // Sandboxed iframe: touching window.indexedDB throws SecurityError.
    const throwing = make({ get() { throw Error('SecurityError'); } });
    assert.equal(await throwing.read('x'), null); assert.equal(await throwing.write(complete), false);
    // Firefox private mode: open() fires onerror.
    const erroring = make({ value: { open() { const req = {}; setTimeout(() => req.onerror?.()); return req; } } });
    assert.equal(await erroring.read('x'), null); assert.equal(await erroring.write(complete), false);
    // Quota: put() throws inside the transaction.
    const db = { transaction() { const tx = { objectStore: () => ({ put() { throw Object.assign(Error('QuotaExceededError'), { name: 'QuotaExceededError' }); }, get() { const r = {}; setTimeout(() => { r.result = undefined; r.onsuccess?.(); }); return r; } }) }; return tx; }, close() {} };
    const quota = make({ value: { open() { const req = { result: db }; setTimeout(() => req.onsuccess?.()); return req; } } });
    assert.equal(await quota.write(complete), false);
    assert.equal(await quota.read('x'), null);
    // Active seasons are never persisted.
    assert.equal(await quota.write({ ...complete, league: { ...complete.league, status: 'in_season' } }), false);
});
