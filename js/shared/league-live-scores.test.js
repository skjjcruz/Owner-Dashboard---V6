// Run with:  node --test js/shared/league-live-scores.test.js
// Ported from C2 tests/league-live-scores.js (2026-09-27) + our additions:
// per-subscriber cadence (interval), in-place setInterval, _platform.
/* global setImmediate */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./league-live-scores.js');
const L = globalThis.App.LeagueLiveScores;
const league = { league_id: '123', season: '2026' };
const rows = [{ roster_id: 1, matchup_id: 1, points: 0 }, { roster_id: 2, matchup_id: '1', points: -1 }, { roster_id: 3, matchup_id: null }, { roster_id: 4, matchup_id: null }];

function harness() {
    const h = { clock: 1000, calls: 0, fail: false, release: null, timers: new Map(), events: new Set(), timerId: 0 };
    h.doc = { hidden: false, addEventListener: (_, cb) => h.events.add(cb), removeEventListener: (_, cb) => h.events.delete(cb) };
    h.client = L.createClient({
        now: () => h.clock,
        document: h.doc,
        setTimeout: (cb, delay) => { const id = ++h.timerId; h.timers.set(id, { cb, delay }); return id; },
        clearTimeout: id => h.timers.delete(id),
        fetch: () => { h.calls++; return new Promise(resolve => { h.release = () => resolve({ ok: !h.fail, json: async () => rows }); }); },
    });
    h.polls = ms => [...h.timers.values()].filter(t => t.delay === ms).length;
    return h;
}

test('C2: scoring helpers, grouping and season/week selection', () => {
    assert.equal(L.rosterPoints({ points: 10, custom_points: 0 }), 0);
    assert.equal(L.playerPoints({ players_points: { a: -2, b: 0 } }, 'a'), -2);
    assert.equal(L.playerPoints({ players_points: { b: 0 } }, 'b'), 0);
    assert.equal(L.playerPoints({}, 'a'), null);
    assert.equal(L.rosterPoints({ points: null }), null);
    assert.equal(L.supported({ league_id: '123', _espn: true }), false);
    assert.deepEqual(L.groupRows(rows).map(g => g.teams.length), [2, 1, 1]);
    globalThis.S = { nflState: { season: '2026', week: 2, display_week: 2, season_type: 'regular' } };
    assert.equal(L.currentWeek(league), 2);
    assert.equal(L.currentWeek({ season: '2025', settings: { leg: 17 } }), 17);
    assert.equal(L.currentWeek({ season: '2027' }), 1);
    globalThis.S.nflState.season_type = 'post';
    assert.equal(L.currentWeek(league), 18);
    globalThis.S.nflState.season_type = 'regular';
});

test('our leagues: _platform marker, MFL/ESPN/Yahoo ids are unsupported', () => {
    assert.equal(L.supported({ league_id: '1', _platform: 'espn' }), false);
    assert.equal(L.supported({ id: 'mfl_10005_2026', _platform: 'mfl' }), false);
    assert.equal(L.supported({ league_id: '1', _platform: 'sleeper' }), true);
    assert.equal(L.supported({ league_id: '1312100327931019264' }), true);
    assert.equal(L.supported(null), false);
});

test('C2: sharing, stale recovery, visibility and cleanup', async () => {
    const h = harness(), first = [], second = [];
    const off1 = h.client.subscribe(league, 2, s => first.push(s));
    const off2 = h.client.subscribe(league, 2, s => second.push(s));
    await Promise.resolve();
    assert.equal(h.calls, 1, 'concurrent subscribers share a request');
    const pending = h.client.refresh(league, 2); h.release(); await pending;
    assert.equal(first.at(-1).status, 'ready');
    assert.equal(second.at(-1).updatedAt, 1000);
    assert.equal(h.polls(30000), 1, 'one shared poll');
    h.clock += 30000; h.fail = true;
    const failure = h.client.refresh(league, 2); await Promise.resolve(); h.release(); await failure;
    assert.equal(first.at(-1).status, 'stale');
    assert.equal(first.at(-1).updatedAt, 1000, 'failed attempts never advance freshness');
    assert.deepEqual(first.at(-1).rows, rows, 'retain the last successful scores');
    h.doc.hidden = true; h.events.forEach(cb => cb());
    assert.equal(h.timers.size, 0, 'hidden pages pause polling');
    h.doc.hidden = false; h.fail = false; h.events.forEach(cb => cb()); await Promise.resolve();
    assert.equal(h.calls, 3, 'return to page shares one refresh');
    const resumed = h.client.refresh(league, 2); h.release(); await resumed;
    off1(); assert.equal(h.events.size, 1);
    const count = first.length;
    off2(); assert.equal(h.events.size, 0); assert.equal(h.timers.size, 0, 'last unsubscribe clears polling');
    const next = h.client.refresh(league, 2); await Promise.resolve(); h.release(); await next;
    assert.equal(first.length, count, 'unmounted subscribers get no later updates');
    assert.equal(h.timers.size, 0, 'manual refresh without subscribers does not leave a timer');
    let unsupported;
    h.client.subscribe({ id: 'espn_2' }, 1, state => { unsupported = state; })();
    assert.equal(unsupported.status, 'unsupported');
});

test('cadence: interval 0 fetches once and never polls; a fresh return does not refetch', async () => {
    const h = harness(), seen = [];
    const off = h.client.subscribe(league, 3, s => seen.push(s), { interval: 0 });
    await Promise.resolve(); h.release(); await new Promise(r => setImmediate(r));
    assert.equal(h.calls, 1);
    assert.equal(seen.at(-1).status, 'ready');
    assert.equal(h.polls(30000), 0, 'no timer while no game is live');
    h.clock += 10000; h.doc.hidden = true; h.events.forEach(cb => cb()); h.doc.hidden = false; h.events.forEach(cb => cb());
    assert.equal(h.calls, 1, 'returning within 30s reuses the snapshot');
    h.clock += 30000; h.events.forEach(cb => cb()); await Promise.resolve();
    assert.equal(h.calls, 2, 'returning after 30s refreshes once');
    h.release(); await new Promise(r => setImmediate(r));
    assert.equal(h.polls(30000), 0);
    off();
});

test('cadence: switching polling on in place, fastest subscriber wins, never under 30s', async () => {
    const h = harness();
    const off = h.client.subscribe(league, 4, () => {}, { interval: 0 });
    await Promise.resolve(); h.release(); await new Promise(r => setImmediate(r));
    assert.equal(h.calls, 1);
    off.setInterval(30000);
    assert.equal(h.calls, 1, 'fresh snapshot: no immediate refetch');
    assert.equal(h.polls(30000), 1, 'kickoff turns the shared poll on');
    const other = h.client.subscribe(league, 4, () => {}, { interval: 120000 });
    assert.equal(h.polls(30000), 1, 'fastest positive cadence is kept');
    off.setInterval(0);
    assert.equal(h.polls(120000), 1, 'the remaining subscriber sets the cadence');
    assert.equal(h.polls(30000), 0);
    other.setInterval(5000);
    assert.equal(h.polls(30000), 1, 'requests faster than 30s are clamped to 30s');
    off(); other();
    assert.equal(h.timers.size, 0);
    // A stale snapshot switching on refreshes right away.
    const off2 = h.client.subscribe(league, 4, () => {}, { interval: 0 });
    h.clock += 60000;
    off2.setInterval(30000); await Promise.resolve();
    assert.equal(h.calls, 2);
    h.release(); await new Promise(r => setImmediate(r));
    off2();
});
