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

// Minimal in-memory IndexedDB: enough of the API for the archive adapter.
function fakeIDB() {
    const data = new Map(); let opens = 0; let version = 0;
    const later = fn => setTimeout(fn, 0);
    const store = {
        indexNames: { contains: n => n === 'savedAt' && version >= 2 },
        put(v) { data.set(v.id, structuredClone(v)); },
        get(k) { const r = {}; later(() => { r.result = structuredClone(data.get(k)); r.onsuccess?.(); }); return r; },
        count() { const r = {}; later(() => { r.result = data.size; r.onsuccess?.(); }); return r; },
        createIndex() {},
        index() { return { openCursor() {
            const r = {}; const keys = [...data.values()].sort((a, b) => a.savedAt - b.savedAt).map(v => v.id); let i = 0;
            const step = () => later(() => { const id = keys[i]; r.result = id === undefined ? null : { delete: () => data.delete(id), continue: () => { i++; step(); } }; r.onsuccess?.(); });
            step(); return r; } }; },
    };
    const db = { objectStoreNames: { contains: () => version >= 1 }, createObjectStore: () => store, close() {},
        transaction() { const tx = { objectStore: () => store }; later(() => later(() => later(() => tx.oncomplete?.()))); return tx; } };
    return { data, opens: () => opens, api: { open(name, v) { opens++; const req = { result: db, transaction: { objectStore: () => store } }; later(() => { if (version < v) { version = v; req.onupgradeneeded?.(); } req.onsuccess?.(); }); return req; } } };
}

test('review nits: pruning walks the savedAt index (no full-store read); a failed open is retried after a minute', async () => {
    const fake = fakeIDB();
    let clock = 1000;
    const r = { setTimeout, clearTimeout, indexedDB: fake.api, Date: { now: () => clock } }; r.window = r; vm.createContext(r);
    vm.runInContext(src('league-wire-cache.js'), r);
    for (let i = 0; i < 102; i++) fake.data.set('old' + i, { id: 'old' + i, version: 1, savedAt: i, season: {} });
    const season = { league: { league_id: 'newest', season: '2025', status: 'complete', rosters: [{ roster_id: 1, owner_id: 'a' }], users: [] }, weeks: [], bracket: [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1, extra: 'x' }] };
    clock = 5000;
    assert.equal(await r.WrWireArchiveCache.write(season), true);
    await new Promise(res => setTimeout(res, 20));
    assert.equal(fake.data.size, 100, 'bounded to 100');
    assert(!fake.data.has('old0') && !fake.data.has('old2') && fake.data.has('old3') && fake.data.has('newest'), 'oldest entries pruned');
    const back = await r.WrWireArchiveCache.read('newest');
    assert.deepEqual(JSON.parse(JSON.stringify(back.bracket)), [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 }], 'bracket kept compactly with the season');
    // Retry: open throws once; the adapter backs off 60s, then tries again.
    let throwing = true; const f2 = fakeIDB(); let calls = 0;
    const flaky = { open(...a) { calls++; if (throwing) throw Error('denied'); return f2.api.open(...a); } };
    const r2 = { setTimeout, clearTimeout, indexedDB: flaky, Date: { now: () => clock } }; r2.window = r2; vm.createContext(r2);
    vm.runInContext(src('league-wire-cache.js'), r2);
    assert.equal(await r2.WrWireArchiveCache.read('x'), null);
    throwing = false;
    assert.equal(await r2.WrWireArchiveCache.read('x'), null); assert.equal(calls, 1, 'no hammering within the back-off');
    clock += 61000;
    assert.equal(await r2.WrWireArchiveCache.write(season), true, 'storage recovers later in the session');
    assert.equal(calls, 2);
});
