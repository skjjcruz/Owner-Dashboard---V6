// Run with:  node --test js/shared/ask-tools-league.test.js
// League-wide AI tools (ask-tools-league.js) on a tiny fake Sleeper league:
// 4 teams, week 4 of a 5-week regular season, one earlier season on Sleeper.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = p => p;
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
globalThis.dispatchEvent = globalThis.dispatchEvent || (() => true);

const settings = { type: 2, playoff_teams: 2, playoff_week_start: 6, playoff_round_type: 0, playoff_seed_type: 0, trade_deadline: 11, waiver_type: 2, waiver_budget: 100, waiver_bid_min: 1, taxi_slots: 3, taxi_years: 2, taxi_allow_vets: 0, reserve_slots: 2, draft_rounds: 4, divisions: 0 };
const users = [1, 2, 3, 4].map(i => ({ user_id: 'u' + i, display_name: 'owner' + i, metadata: { team_name: 'Team ' + ['', 'Alpha', 'Bravo', 'Charlie', 'Delta'][i] } }));
const rec = (w, l, f, fa, extra) => Object.assign({ wins: w, losses: l, ties: 0, fpts: f, fpts_decimal: 0, fpts_against: fa, waiver_position: 5 - w, waiver_budget_used: 10 * w }, extra || {});
const baseRosters = () => [
    { roster_id: 1, owner_id: 'u1', players: ['p1'], starters: ['p1'], settings: rec(2, 1, 300, 290) },
    { roster_id: 2, owner_id: 'u2', players: ['p2'], starters: ['p2'], settings: rec(2, 1, 310, 280) },
    { roster_id: 3, owner_id: 'u3', players: ['p3'], starters: ['p3'], settings: rec(1, 2, 280, 300) },
    { roster_id: 4, owner_id: 'u4', players: ['p4'], starters: ['p4'], settings: rec(1, 2, 270, 310) },
];
globalThis.S = {
    currentLeagueId: 'L', myRosterId: 1, myUserId: 'u1', platform: 'sleeper', season: '2026', currentWeek: 4,
    nflState: { season: '2026', week: 4, season_type: 'regular' },
    leagues: [{ league_id: 'L', name: 'Tiny League', roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN'], settings, scoring_settings: { pass_td: 4, pass_yd: 0.04, rec: 1, rush_yd: 0.1, bonus_rec_te: 0.5, fg_0_19: 3, idp_tkl: 0 } }],
    leagueUsers: users,
    rosters: baseRosters(),
    players: { p1: { full_name: 'Player One', position: 'QB', team: 'KC' }, p2: { full_name: 'Player Two', position: 'QB', team: 'BUF' }, p3: { full_name: 'Player Three', position: 'QB', team: 'DAL' }, p4: { full_name: 'Player Four', position: 'QB', team: 'PHI' } },
};
App.LI = { playerScores: { p1: 5000, p2: 4000, p3: 3000, p4: 2000 } };
globalThis.assessAllTeamsFromGlobal = () => S.rosters.map((r, i) => ({ rosterId: r.roster_id, tier: i < 2 ? 'CONTENDER' : 'REBUILDING', window: i < 2 ? 'CONTENDING' : 'REBUILDING', powerRank: i + 1, totalDHQ: 5000 - i * 1000 }));

// ── Sleeper, stubbed ────────────────────────────────────────────────
const m = (a, b, pa, pb, id) => [{ roster_id: a, matchup_id: id, points: pa, starters: [] }, { roster_id: b, matchup_id: id, points: pb, starters: [] }];
const weeksL = {
    1: [...m(1, 2, 110, 100, 1), ...m(3, 4, 95, 90, 2)],
    2: [...m(1, 3, 90, 100, 1), ...m(2, 4, 105, 99, 2)],
    3: [...m(1, 2, 120, 98, 1), ...m(3, 4, 88, 101, 2)],
    4: [...m(1, 4, 0, 0, 1), ...m(2, 3, 0, 0, 2)],
    5: [...m(1, 3, 0, 0, 1), ...m(2, 4, 0, 0, 2)],
};
// Last season (league P): u1 had roster 2, u2 had roster 1 — the series is
// counted by manager, not roster slot. u1 beat u2 in week 1 and in the final.
const weeksP = { 1: [...m(2, 1, 120, 80, 1), ...m(3, 4, 90, 91, 2)], 2: [...m(2, 3, 100, 101, 1), ...m(1, 4, 100, 90, 2)] };
const rostersP = [{ roster_id: 1, owner_id: 'u2', settings: rec(1, 1, 180, 220) }, { roster_id: 2, owner_id: 'u1', settings: rec(1, 1, 220, 181) }, { roster_id: 3, owner_id: 'u3', settings: rec(2, 0, 191, 190) }, { roster_id: 4, owner_id: 'u4', settings: rec(0, 2, 181, 190) }];
let sleeperUp = true;
function route(url) {
    let x;
    if ((x = url.match(/\/league\/(\w+)\/matchups\/(\d+)$/))) return (x[1] === 'L' ? weeksL : weeksP)[x[2]] || [];
    if ((x = url.match(/\/league\/(\w+)\/rosters$/))) return x[1] === 'L' ? S.rosters : rostersP;
    if ((x = url.match(/\/league\/(\w+)\/users$/))) return users;
    if ((x = url.match(/\/league\/(\w+)\/winners_bracket$/))) return x[1] === 'P' ? [{ r: 1, m: 1, t1: 1, t2: 2, w: 2, l: 1, p: 1 }] : [];
    if ((x = url.match(/\/league\/(\w+)$/))) return x[1] === 'L' ? { league_id: 'L', season: '2026', previous_league_id: 'P', settings } : x[1] === 'P' ? { league_id: 'P', season: '2025', previous_league_id: null, status: 'complete', settings: { playoff_week_start: 3, playoff_teams: 2 } } : null;
    return null;
}
globalThis.fetch = async url => { const d = sleeperUp ? route(String(url)) : null; return d == null ? { ok: false, status: 404, json: async () => null } : { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(d)) }; };
globalThis.fetchMatchups = async (lid, w) => (lid === 'L' ? weeksL : weeksP)[w] || [];

// Projections: each roster's lone starter projects 100 + 5 × roster id.
App.WeeklyProj = {
    currentWeek: () => 4,
    optimalForRoster: r => { const pid = 'p' + r.roster_id; return { optimal: { starters: [{ pid }], slots: [{ pid }] }, projections: { [pid]: { points: { median: 100 + 5 * r.roster_id, floor: 80, ceiling: 140 } } } }; },
};
require('./faab-league.js');
require('./chopped.js');
require('./matchup.js');
require('./luck-engine.js');
require('./playoff-odds.js');
require('../utils/schedule-engine.js');
require('./league-history.js');
const T = require('./ask-tools.js');
require('./ask-tools-league.js');
const run = (name, args) => T.run(name, args || {});

test('all six league tools register with a plain description and an object schema', () => {
    const names = ['get_league_info', 'get_standings', 'get_schedule', 'get_playoff_odds', 'get_league_history', 'get_head_to_head'];
    const defs = T.defs();
    for (const n of names) {
        const d = defs.find(x => x.name === n);
        assert.ok(d, n + ' registered');
        assert.ok(d.description.length > 40 && d.description.length < 450, n + ' description');
        assert.equal(d.parameters.type, 'object');
    }
    assert.match(defs.find(x => x.name === 'get_head_to_head').parameters.properties.team_b.description, /Team name, owner name, roster id, or "me"/);
});

test('league info: format, scoring by group (non-zero only), rules and the league docs', async () => {
    globalThis._leagueDocsContext = 'Rule 1. '.repeat(400);
    const r = await run('get_league_info');
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.league, 'Tiny League');
    assert.equal(r.type, 'dynasty');
    assert.equal(r.phase, 'in_season');
    assert.equal(r.teams, 4);
    assert.equal(r.roster_slots.BN, 2);
    assert.equal(r.scoring.passing.pass_td, 4);
    assert.equal(r.scoring.receiving.rec, 1);
    assert.equal(r.scoring.bonuses.bonus_rec_te, 0.5);
    assert.equal(r.scoring.idp, undefined, 'zero-point keys are left out');
    assert.equal(r.rules.playoffs.teams, 2);
    assert.equal(r.rules.playoffs.start_week, 6);
    assert.equal(r.rules.trade_deadline_week, 11);
    assert.deepEqual(r.rules.waivers, { type: 'FAAB', faab_budget: 100, min_bid: 1 });
    assert.equal(r.rules.taxi.vets_allowed, false);
    assert.ok(r.league_docs.length <= 1520 && /trimmed/.test(r.league_docs));
    delete globalThis._leagueDocsContext;
});

test('standings: Sleeper order (wins, then points for), seeds, value, FAAB, waiver order and luck', async () => {
    const r = await run('get_standings');
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.teams.map(t => t.roster_id), [2, 1, 3, 4]);
    const me = r.teams.find(t => t.roster_id === 1);
    assert.match(me.team, /Team Alpha \(owner1\) \[me\]/);
    assert.equal(me.playoff_seed, 2);
    assert.equal(me.record.points_against, 290);
    assert.equal(me.faab_left, 80);
    assert.equal(me.waiver_position, 3);
    assert.equal(me.tier, 'CONTENDER');
    assert.equal(me.all_play, '6-3', 'beat 2 of 3 teams in each of 3 weeks');
    assert.equal(typeof me.luck, 'number');
});

test('schedule: results for played weeks, win chances ahead, projected record', async () => {
    const r = await run('get_schedule');
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.weeks.length, 5);
    assert.deepEqual(r.weeks[0], { week: 1, opponent: r.weeks[0].opponent, result: 'W', score: '110-100', status: 'played' });
    assert.match(r.weeks[0].opponent, /Team Bravo/);
    assert.equal(r.weeks[1].result, 'L');
    const w4 = r.weeks[3];
    assert.equal(w4.status, 'this week');
    assert.ok(w4.win_chance_pct > 0 && w4.win_chance_pct < 100);
    assert.match(r.projected_final_record, /^\d+(\.\d)?-\d+(\.\d)?$/);
    const other = await run('get_schedule', { team: 'Delta' });
    assert.match(other.team, /Team Delta/);
});

test('playoff odds: every team simulated, spots and current seeding', async () => {
    const r = await run('get_playoff_odds');
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.playoff_spots, 2);
    assert.equal(r.current_seeding.length, 2);
    assert.equal(r.odds.length, 4);
    const total = r.odds.reduce((s, x) => s + x.playoff_pct, 0);
    assert.ok(total >= 195 && total <= 205, 'two playoff spots → ~200% across teams, got ' + total);
    assert.ok(r.my_leverage_this_week && r.my_leverage_this_week.week === 4);
});

test('history: champions mapped to managers, brackets, all-time records', async () => {
    const r = await run('get_league_history');
    assert.equal(r.error, undefined, r.error);
    const s25 = r.seasons.find(s => s.season === '2025');
    assert.ok(s25, JSON.stringify(r));
    assert.equal(s25.champion, 'Team Alpha');
    assert.equal(s25.runner_up, 'Team Bravo');
    assert.deepEqual(s25.bracket, ['Championship: Team Alpha beat Team Bravo'], 'bracket roster ids are that season\'s, mapped to its managers');
    const alpha = r.all_time.find(x => x.manager === 'Team Alpha');
    assert.equal(alpha.titles, 1);
    assert.equal(r.all_time[0].manager, 'Team Alpha', 'title winners first');
    const one = await run('get_league_history', { season: '2025' });
    assert.equal(one.seasons.length, 1);
    assert.ok(one.season_records.every(x => x.finish));
    const none = await run('get_league_history', { season: '1999' });
    assert.match(none.error, /No history found for season 1999/);
});

test('head-to-head: this season\'s meetings plus the all-time series by manager', async () => {
    const r = await run('get_head_to_head', { team_b: 'owner2' });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.this_season.record_for_team_a, '2-0');
    assert.deepEqual(r.this_season.meetings.map(g => g.week), [1, 3]);
    assert.equal(r.all_time.regular_season_record_for_team_a, '3-0', 'last season\'s week-1 win counts though the roster ids swapped');
    assert.equal(r.all_time.playoff_record_for_team_a, '1-0');
    assert.equal(r.all_time.playoff_meetings[0].game, 'championship');
    assert.deepEqual(r.all_time.past_seasons_both_in_league, ['2025']);
});

test('clean errors: unknown team, same team, nothing loaded', async () => {
    assert.match((await run('get_head_to_head', { team_b: 'Zzyzx' })).error, /No team in this league matches "Zzyzx"/);
    assert.match((await run('get_head_to_head', { team_b: 'me' })).error, /same team/);
    const save = S.rosters; const saveLg = S.leagues;
    S.rosters = []; S.leagues = [];
    for (const n of ['get_league_info', 'get_standings', 'get_schedule', 'get_playoff_odds', 'get_league_history', 'get_head_to_head']) {
        const r = await run(n, { team_b: 'x' });
        assert.ok(r.error && /No league is open/.test(r.error), n + ': ' + JSON.stringify(r));
    }
    S.rosters = save; S.leagues = saveLg;
});

test('a chopped league says plainly there are no playoffs or head-to-head games', async () => {
    const saveSt = S.leagues[0].settings;
    S.leagues[0].settings = Object.assign({}, saveSt, { type: 3 });
    S.rosters[3].settings.eliminated = 2;
    const po = await run('get_playoff_odds');
    assert.equal(po.playoffs, false);
    assert.equal(po.alive.length, 3);
    assert.match((await run('get_head_to_head', { team_b: 'Bravo' })).error, /chopped/);
    const st = await run('get_standings', { include_luck: false });
    assert.equal(st.teams.find(t => t.roster_id === 4).eliminated_week, 2);
    assert.equal(st.playoff_spots, 0);
    S.leagues[0].settings = saveSt; delete S.rosters[3].settings.eliminated;
});

test('MFL: no all-time series, this season from pre-loaded weekly scores', async () => {
    S.platform = 'mfl';
    S.weeklyScores = { 1: [{ rosterId: 1, points: 110, matchupId: 1 }, { rosterId: 2, points: 100, matchupId: 1 }], 2: [{ rosterId: 1, points: 90, matchupId: 1 }, { rosterId: 3, points: 100, matchupId: 1 }] };
    const r = await run('get_head_to_head', { team_b: 'Bravo' });
    assert.equal(r.this_season.record_for_team_a, '1-0');
    assert.equal(r.all_time, undefined);
    assert.match(r.note, /only available for Sleeper/);
    const hist = await run('get_league_history');
    assert.ok(hist.error || hist.seasons, 'answers or says why');
    S.platform = 'sleeper'; delete S.weeklyScores;
});
