// Run with:  node --test js/shared/nfl-context.test.js
// The C2 live-score additions (parseScores, gameStatus, loadScoreboard,
// loadScores, currentPhase, previousPhase) and the guarantee that the
// existing projection-context path (load/loadCurrent/parse/endpoint) is
// unchanged for its callers (dhq-proj, player-card, season-odds, calendar).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');

function load(fetchImpl) {
    const calls = [];
    const root = {
        location: { hostname: 'dhqfootball.com' },
        AbortController, setTimeout, clearTimeout,
        fetch: (...args) => { calls.push(args); return fetchImpl(...args); },
    };
    root.window = root;
    const ctx = vm.createContext({ window: root, AbortController, setTimeout, clearTimeout, console, fetch: root.fetch });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'nfl-context.js'), 'utf8'), ctx);
    return { root, NC: root.App.NflContext, calls };
}
const espn = {
    events: [
        { id: '401', date: '2026-09-27T17:00Z', competitions: [{ date: '2026-09-27T17:00Z', status: { type: { state: 'in', shortDetail: 'Q2 3:10', completed: false, name: 'STATUS_IN_PROGRESS' } },
            competitors: [{ homeAway: 'home', score: '14', team: { abbreviation: 'WSH', displayName: 'Washington' } }, { homeAway: 'away', score: '', team: { abbreviation: 'JAC' } }] }] },
        { id: '402', competitions: [{ date: '2026-09-28T00:20Z', status: { type: { state: 'pre' } }, competitors: [{ homeAway: 'home', team: { abbreviation: 'KC' } }, { homeAway: 'away', team: { abbreviation: 'LV' } }] }] },
    ],
};
const ok = body => Promise.resolve({ ok: true, json: async () => body });

test('existing API is intact and load() sends the identical request', async () => {
    const { NC, root, calls } = load(() => ok(espn));
    for (const k of ['load', 'loadCurrent', 'parse', 'endpoint', '_done']) assert.ok(k in NC, k);
    assert.equal(NC.endpoint(), 'https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/nfl-scoreboard');
    root.App.WeeklyProj = { setContext: () => {}, currentWeek: () => 3 };
    const map = await NC.load([3], 2026);
    assert.ok(map['WAS|3'] && map['JAX|3'], 'ESPN abbreviations normalized');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 1, 'fetch(url) — no init object, as before');
    assert.equal(calls[0][0], 'https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/nfl-scoreboard?week=3&seasontype=2&season=2026');
});

test('parseScores: normalized teams, numeric-or-null scores, state', () => {
    const { NC } = load(() => ok(espn));
    const games = NC.parseScores(espn);
    assert.equal(games.length, 2);
    assert.equal(games[0].home, 'WAS'); assert.equal(games[0].away, 'JAX');
    assert.equal(games[0].homeScore, 14); assert.equal(games[0].awayScore, null, 'blank score stays missing, never 0');
    assert.equal(games[0].state, 'in'); assert.equal(games[1].state, 'pre');
    assert.equal(games[0].boxScoreUrl, 'https://www.espn.com/nfl/boxscore/_/gameId/401');
});

test('gameStatus: live / final / locked by kickoff / upcoming / postponed', () => {
    const { NC } = load(() => ok(espn));
    const kick = Date.parse('2026-09-28T00:20Z');
    assert.equal(NC.gameStatus({ state: 'in' }), 'live');
    assert.equal(NC.gameStatus({ completed: true, state: 'post' }), 'final');
    assert.equal(NC.gameStatus({ state: 'pre', kickoff: '2026-09-28T00:20Z' }, kick - 1), 'upcoming');
    assert.equal(NC.gameStatus({ state: 'pre', kickoff: '2026-09-28T00:20Z' }, kick + 1), 'locked');
    assert.equal(NC.gameStatus({ state: 'pre', kickoff: '2026-09-28T00:20Z', statusName: 'STATUS_POSTPONED' }, kick - 1), 'unknown');
    assert.equal(NC.gameStatus(null), 'unknown');
});

test('loadScoreboard: one shared request per week for 60s; failures are not cached', async () => {
    let fail = true;
    const { NC, calls } = load(() => fail ? Promise.resolve({ ok: false, status: 502 }) : ok(espn));
    assert.equal(JSON.stringify(await NC.loadScores(3, '2026', 2)), '[]', 'loadScores never rejects');
    fail = false;
    const [a, b] = await Promise.all([NC.loadScoreboard(3, '2026', 2), NC.loadScoreboard(3, '2026', 2)]);
    assert.equal(a, b);
    assert.equal(calls.length, 2, 'failure retried, success shared');
    assert.ok(calls[1][1] && calls[1][1].signal, 'live loads are abortable');
    assert.match(calls[1][0], /week=3&seasontype=2&season=2026$/);
    await NC.loadScoreboard(1, '2026', 1);
    assert.match(calls[2][0], /seasontype=1/);
});

test('currentPhase / previousPhase', () => {
    const { NC, root } = load(() => ok(espn));
    root.S = { nflState: { season: '2026', season_type: 'pre', week: 2 } };
    assert.deepEqual({ ...NC.currentPhase() }, { seasontype: 1, week: 2, isPre: true, season: '2026' });
    root.S.nflState = { season: '2026', season_type: 'regular', week: 3 };
    root.App.WeeklyProj = { currentWeek: () => 3 };
    assert.equal(NC.currentPhase().week, 3);
    assert.equal(NC.previousPhase({ seasontype: 2, week: 3 }).week, 2);
    assert.equal(NC.previousPhase({ seasontype: 2, week: 1 }), null, 'never relabel preseason as last week');
    assert.deepEqual({ ...NC.previousPhase({ seasontype: 3, week: 1, season: '2026' }) }, { season: '2026', seasontype: 2, week: 18 });
});
