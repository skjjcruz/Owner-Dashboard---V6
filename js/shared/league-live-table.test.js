// Run with:  node --test js/shared/league-live-table.test.js
// Ported from C2 tests/league-live-table.cjs (2026-09-27). Changes: the
// completed-week TTL is 15 min (C2: 5), and our additions — App.Matchup's
// shared week rows are reused (no duplicate Game Day fetches), a passed
// kickoff counts as "started", and useContext({ enabled:false }) is idle.
/* global setImmediate */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');

function load() {
    const root = { fetch: async () => { throw Error('Unexpected network call'); }, setTimeout, clearTimeout, setInterval, clearInterval, AbortController };
    const context = { window: root, AbortController, console };
    vm.createContext(context);
    for (const file of ['league-live-scores.js', 'league-live-table.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
    return root;
}
const fixture = suffix => ({ league_id: '123456789012' + suffix, season: '2026', rosters: [{ roster_id: 1 }, { roster_id: 2 }], settings: {} });
const rows = [{ roster_id: 1, points: 0 }, { roster_id: 2, points: -3.5 }];
const response = data => ({ ok: true, json: async () => data });
const plain = value => JSON.parse(JSON.stringify(value));

test('C2: bounded/cached history, incomplete/error/abort recovery, started roster evidence, effect cleanup', async () => {
    const root = load(), E = root.App.LeagueLiveTable;
    let calls = 0;
    const opening = await E.loadHistory({ league: fixture('01'), week: 1, fetcher: async () => { calls++; return response(rows); } });
    assert.equal(calls, 0, 'Week 1 needs no historical requests');
    assert.deepEqual(plain(opening.priorWeeks), []);
    let active = 0, peak = 0, tick = 1000;
    const seen = [];
    const league = fixture('02');
    const fetcher = async (url, opts) => { active++; peak = Math.max(peak, active); const week = Number(url.split('/').at(-1)); seen.push(week); assert.equal(opts.cache, 'no-store'); await new Promise(resolve => setImmediate(resolve)); active--; return response(rows); };
    const loaded = await E.loadHistory({ league, week: 9, fetcher, now: () => tick });
    assert.deepEqual(plain(loaded.priorWeeks.map(r => r.week)), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(seen.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], 'Never request current or future week');
    assert(peak <= 4 && peak > 1, 'Historical requests use bounded parallelism');
    await E.loadHistory({ league, week: 9, fetcher, now: () => tick }); assert.equal(seen.length, 8, 'Successful history reused within TTL');
    await E.loadHistory({ league, week: 9, force: true, fetcher, now: () => tick }); assert.equal(seen.length, 16, 'Explicit force bypasses cache');
    tick += 300001; await E.loadHistory({ league, week: 9, fetcher, now: () => tick }); assert.equal(seen.length, 16, 'Still fresh after 5 min (15-min TTL)');
    tick += 600000; await E.loadHistory({ league, week: 9, fetcher, now: () => tick }); assert.equal(seen.length, 24, 'Expired history refreshes');
    const delayed = fixture('03'); delayed.settings.start_week = 3; const delayedWeeks = [];
    await E.loadHistory({ league: delayed, week: 5, fetcher: async url => { delayedWeeks.push(Number(url.split('/').at(-1))); return response(rows); } });
    assert.deepEqual(delayedWeeks.sort(), [3, 4], 'Respect late league start');

    const badPayloads = [null, {}, [], [null], [{ points: 10 }], [{ roster_id: 1, points: 5 }], [{ roster_id: 1 }, { roster_id: 2, points: 5 }]];
    for (let i = 0; i < badPayloads.length; i++) {
        const badLeague = fixture('bad' + i); let attempts = 0;
        await assert.rejects(E.loadHistory({ league: badLeague, week: 2, fetcher: async () => { attempts++; return response(badPayloads[i]); } }), 'Invalid/incomplete history rejects');
        await E.loadHistory({ league: badLeague, week: 2, fetcher: async () => { attempts++; return response(rows); } });
        assert.equal(attempts, 2, 'A failed response never becomes the cached baseline');
    }
    const errorLeague = fixture('http');
    await assert.rejects(E.loadHistory({ league: errorLeague, week: 2, fetcher: async () => ({ ok: false, status: 500 }) }));
    let recovered = 0; await E.loadHistory({ league: errorLeague, week: 2, fetcher: async () => { recovered++; return response(rows); } }); assert.equal(recovered, 1);
    const abortLeague = fixture('abort'), controller = new AbortController(); controller.abort();
    await assert.rejects(E.loadHistory({ league: abortLeague, week: 2, signal: controller.signal, fetcher: async (_url, opts) => { assert(opts.signal.aborted); throw Object.assign(Error('Aborted'), { name: 'AbortError' }); } }));
    await E.loadHistory({ league: abortLeague, week: 2, fetcher: async () => response(rows) });

    const data = { live: { team: 'BUF' }, final: { team: 'CHI' }, delayed: { team: 'DAL' }, scheduled: { team: 'KC' }, bench: { team: 'BUF' } };
    const games = [{ home: 'BUF', away: 'NYJ', state: 'in' }, { home: 'CHI', away: 'GB', completed: true, state: 'post' }, { home: 'DAL', away: 'WAS', state: 'in', statusName: 'STATUS_DELAYED' }, { home: 'KC', away: 'LV', state: 'pre' }];
    const rosterRows = [
        { roster_id: 1, points: 0, starters: ['live'], players_points: { live: 0 } },
        { roster_id: 2, points: 0, starters: ['final'] },
        { roster_id: 3, points: 0, starters: ['delayed'] },
        { roster_id: 4, points: 0, starters: ['scheduled'], players_points: { bench: 10 } },
        { roster_id: 5, points: -2, starters: [] },
        { roster_id: 6, points: 10, custom_points: 0, starters: [] },
        { roster_id: 7, points: 0, custom_points: -1, starters: [] },
        { roster_id: 8, points: 0, starters: ['unknown'], players_points: { unknown: -0.5 } },
        { roster_id: 9, points: 0, starters: ['0', null] },
        { roster_id: 10, points: '10', starters: [] },
    ];
    assert.deepEqual(plain(E.startedRosters({ rows: rosterRows, games, playersData: data })), ['1', '2', '5', '7', '8'], 'Started evidence uses real numeric scoring and starters only; scheduled/delayed/bench are insufficient');
    assert.deepEqual(plain(E.startedRosters({ rows: rosterRows, historical: true })), rosterRows.map(r => String(r.roster_id)));
    assert.deepEqual(plain(E.startedRosters({})), []);
    assert.deepEqual(plain(E.startedRosters({ rows: [{ roster_id: 1 }], games: [], playersData: {} })), []);

    // A disappearing table cancels its active request/timer/listener and never
    // applies a late response to the new league's UI.
    let effect, signal, stateWrites = 0, clearCount = 0, removed = 0;
    root.React = { useState: initial => [initial, () => stateWrites++], useEffect: fn => { effect = fn; } };
    root.S = { nflState: { season: '2026', week: 2, season_type: 'regular' } };
    root.document = { hidden: false, addEventListener() {}, removeEventListener() { removed++; } };
    root.setTimeout = () => 42; root.clearTimeout = () => {}; root.setInterval = () => 9; root.clearInterval = () => { clearCount++; };
    root.App.NflContext = { loadScores: async () => [] };
    root.fetch = (_url, opts) => { signal = opts.signal; return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(Error('Aborted'), { name: 'AbortError' })))); };
    E.useContext({ league: fixture('99'), board: { week: 2, rows: [] }, playersData: {} });
    const cleanup = effect(); assert.equal(typeof cleanup, 'function'); assert(signal && !signal.aborted);
    const writesBeforeCleanup = stateWrites; cleanup(); await new Promise(resolve => setImmediate(resolve));
    assert(signal.aborted); assert.equal(clearCount, 1); assert.equal(removed, 1); assert.equal(stateWrites, writesBeforeCleanup, 'No async state writes after cleanup');

    // enabled:false keeps the hook idle (collapsed standings cost nothing).
    effect = null;
    const idle = E.useContext({ league: fixture('98'), board: { week: 2, rows: [] }, playersData: {}, enabled: false });
    assert.equal(idle.enabled, false);
    assert.equal(effect(), undefined, 'no request, timer or listener');
});

test('completed weeks reuse App.Matchup rows (no duplicate Game Day fetches)', async () => {
    const root = load(), E = root.App.LeagueLiveTable;
    const asked = [];
    root.App.Matchup = { sleeperWeekRows: async (lid, w) => { asked.push(lid + '|' + w); return rows; } };
    const league = fixture('m1');
    const r = await E.loadHistory({ league, week: 4 });
    assert.deepEqual(asked.sort(), [league.league_id + '|1', league.league_id + '|2', league.league_id + '|3']);
    assert.deepEqual(plain(r.priorWeeks.map(x => x.week)), [1, 2, 3]);
    // Shared-cache failure ([] rows) is refused, never zeroed.
    root.App.Matchup.sleeperWeekRows = async () => [];
    await assert.rejects(E.loadHistory({ league: fixture('m2'), week: 3 }));
    // A forced refresh or a custom fetcher goes to the network instead.
    let net = 0;
    await E.loadHistory({ league: fixture('m3'), week: 3, force: true, fetcher: async () => { net++; return response(rows); } });
    assert.equal(net, 2);
});

test('a passed kickoff counts as started (the prod NFL relay can lag on game state)', () => {
    const root = load(), E = root.App.LeagueLiveTable;
    const kick = Date.parse('2026-09-27T17:00:00Z');
    const games = [{ home: 'BUF', away: 'LAC', state: 'pre', kickoff: '2026-09-27T17:00Z' }, { home: 'KC', away: 'LV', state: 'pre', kickoff: '2026-09-28T00:20Z' }];
    const pd = { a: { team: 'BUF' }, b: { team: 'KC' } };
    const r = [{ roster_id: 1, points: 0, starters: ['a'] }, { roster_id: 2, points: 0, starters: ['b'] }];
    assert.deepEqual(plain(E.startedRosters({ rows: r, games, playersData: pd, now: kick - 1 })), []);
    assert.deepEqual(plain(E.startedRosters({ rows: r, games, playersData: pd, now: kick + 1 })), ['1']);
    const postponed = [{ ...games[0], statusName: 'STATUS_POSTPONED' }];
    assert.deepEqual(plain(E.startedRosters({ rows: r, games: postponed, playersData: pd, now: kick + 1 })), []);
});

test('useContext({ games }) reuses the caller schedule and never calls the relay', async () => {
    const root = load(), E = root.App.LeagueLiveTable;
    let relay = 0, effect;
    root.React = { useState: initial => [initial, () => {}], useEffect: fn => { effect = fn; } };
    root.S = { nflState: { season: '2026', week: 2, season_type: 'regular' } };
    root.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    root.setTimeout = () => 1; root.clearTimeout = () => {}; root.setInterval = () => 2; root.clearInterval = () => {};
    root.App.NflContext = { loadScores: async () => { relay++; return []; } };
    root.App.Matchup = { sleeperWeekRows: async () => rows };
    const pd = { a: { team: 'BUF' } };
    const games = [{ home: 'BUF', away: 'LAC', state: 'in' }];
    const ctx = E.useContext({ league: fixture('g1'), board: { week: 2, rows: [{ roster_id: 1, points: 0, starters: ['a'] }, { roster_id: 2, points: 0, starters: [] }] }, playersData: pd, games });
    assert.deepEqual(plain(ctx.startedRosterIds), ['1'], 'started evidence from the given games');
    const cleanup = effect(); await new Promise(r => setImmediate(r)); cleanup();
    assert.equal(relay, 0);
});

test('review B1: an unplayed week (all 0.00, or no one started) ends the completed baseline — never 0-0 ties', async () => {
    const root = load(), E = root.App.LeagueLiveTable;
    const league = { league_id: '140244429948798', season: '2026', rosters: [{ roster_id: 1 }, { roster_id: 2 }], settings: {} };
    const played = [{ roster_id: 1, points: 101.5, starters: ['a'] }, { roster_id: 2, points: 90, starters: ['b'] }];
    const zeros = [{ roster_id: 1, points: 0, starters: [] }, { roster_id: 2, points: 0, starters: [] }];
    const emptyLineups = [{ roster_id: 1, points: 0.5, starters: ['0', null] }, { roster_id: 2, points: 0, starters: [] }];
    const byWeek = { 1: played, 2: zeros, 3: played };
    const res = await E.loadHistory({ league, week: 4, fetcher: async url => response(byWeek[Number(url.split('/').pop())]) });
    assert.deepEqual(plain(res.priorWeeks.map(w => w.week)), [1], 'stops at the first unplayed week');
    assert.equal(res.unplayedFrom, 2);
    const pre = await E.loadHistory({ league: { ...league, league_id: '140244429948799' }, week: 3, fetcher: async () => response(zeros) });
    assert.equal(pre.priorWeeks.length, 0, 'a pre-draft league has no completed weeks');
    assert.equal(pre.unplayedFrom, 1);
    assert.equal(E.unplayedWeek(emptyLineups), true, 'lineups present but nobody started');
    assert.equal(E.unplayedWeek(played), false);
    assert.equal(E.unplayedWeek([{ roster_id: 1, points: 0 }, { roster_id: 2, points: -3.5 }]), false, 'a real negative score is a played week');
    assert.equal(E.unplayedWeek([{ roster_id: 1, points: 12 }, { roster_id: 2, points: 0 }]), false, 'one idle team does not void the week');
    // Standings then fall back to official records instead of all-tie rows.
    const sctx = { window: { App: {} }, console };
    vm.createContext(sctx);
    for (const file of ['league-live-scores.js', 'league-live-standings.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sctx);
    const table = sctx.window.App.LeagueLiveStandings.compute({ league: { ...league, settings: { start_week: 1, playoff_week_start: 15 } }, priorWeeks: pre.priorWeeks, board: { week: 3, rows: zeros }, week: 3, currentWeek: 3 });
    assert.equal(table.status, 'official');
    assert(table.rows.every(r => r.ties === 0), 'no invented ties');
});
