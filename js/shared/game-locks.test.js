// Run with:  node --test js/shared/game-locks.test.js
// Owner report 2026-10-09: Game Day said "Replace KaVontae Turpin with Raheim
// Sanders" the morning after Turpin played Thursday night. A player whose
// game has kicked off is locked in Sleeper: he stays put and counts his
// actual points, and nobody locked can come off the bench.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = (p) => p;

// Thursday night DAL @ TB is final; Sunday's games have not started.
const SCORES = [
    { status: 'complete', start_time: 1, metadata: { home_team: 'DAL', away_team: 'TB', has_started: true, is_over: true } },
    { status: 'pre_game', start_time: 2, metadata: { home_team: 'LAR', away_team: 'BUF', has_started: false, is_over: false } },
    { status: 'in_game', start_time: 3, metadata: { home_team: 'BAL', away_team: 'ATL', has_started: true, is_in_progress: true, is_over: false, quarter_num: 2, time_remaining: '4:12' } },
];
const MATCHUPS = [{ roster_id: 1, players_points: { turpin: 8.7, pickens: 11.2, henry: 6.1 } }];
globalThis.fetch = async (url) => ({ ok: true, json: async () => (/\/scores\//.test(url) ? SCORES : MATCHUPS) });

globalThis.S = { nflState: { week: 5, season_type: 'regular' }, players: {
    turpin: { position: 'WR', team: 'DAL' }, pickens: { position: 'WR', team: 'DAL' },
    sanders: { position: 'RB', team: 'LAR' }, adams: { position: 'WR', team: 'LAR' },
    henry: { position: 'RB', team: 'BAL' }, byeguy: { position: 'WR', team: 'NYJ' },
} };
const GL = require('./game-locks.js');

test('game state, lock and actual points per player', async () => {
    const changed = await GL.load('L', 2026, 5);
    assert.equal(changed, true);
    assert.deepEqual(
        { s: GL.state('turpin').status, l: GL.isLocked('turpin'), p: GL.actual('turpin'), label: GL.state('turpin').label },
        { s: 'final', l: true, p: 8.7, label: 'FINAL' });
    assert.equal(GL.state('henry').status, 'live');
    assert.equal(GL.state('henry').label, 'LIVE Q2 4:12');
    assert.equal(GL.actual('henry'), 6.1, 'a live game counts the points so far');
    assert.equal(GL.isLocked('sanders'), false);
    assert.equal(GL.actual('sanders'), null, 'an upcoming player has no actual yet');
    assert.equal(GL.state('byeguy').status, 'bye');
    assert.equal(GL.isLocked('byeguy'), false);
    assert.equal(await GL.load('L', 2026, 5), false, 'a repeat read inside 55 s changes nothing');
    assert.equal(await GL.load('L', 2026, 1), false, 'a week the app is not on is never read');
    assert.equal(GL.state('turpin').status, 'final', 'and the current week still answers');
});

test('nothing is locked while the app does not know its week', () => {
    const saved = globalThis.S.nflState;
    globalThis.S.nflState = null;
    assert.equal(GL.state('turpin'), null);
    assert.equal(GL.ready(), false);
    globalThis.S.nflState = saved;
});

test('the Sleeper-numbers optimizer keeps a locked starter and never starts a locked bench player', async () => {
    await GL.load('L', 2026, 5);
    App.StartSit = require('./startsit-engine.js');
    const WP = require('./weekly-proj.js');
    // Sleeper lines: Sanders (RB) out-projects Turpin, and Pickens (locked, benched) out-projects Adams.
    const lines = { turpin: { rec: 1, pts_ppr: 3.1 }, sanders: { rush_yd: 50, pts_ppr: 9 }, adams: { rec: 5, pts_ppr: 5 }, pickens: { rec: 6, pts_ppr: 13 } };
    WP.setProjections(5, lines);
    const league = { league_id: 'L', roster_positions: ['WR', 'FLEX', 'BN', 'BN'], scoring_settings: { pts_ppr: 1 } };
    const roster = { roster_id: 1, players: ['turpin', 'sanders', 'adams', 'pickens'], starters: ['adams', 'turpin'] };
    const playersData = {
        turpin: { position: 'WR', team: 'DAL', fantasy_positions: ['WR'] }, sanders: { position: 'RB', team: 'LAR', fantasy_positions: ['RB'] },
        adams: { position: 'WR', team: 'LAR', fantasy_positions: ['WR'] }, pickens: { position: 'WR', team: 'DAL', fantasy_positions: ['WR'] },
    };
    App.calcRawPts = (line, sc) => Object.keys(sc).reduce((t, k) => t + (Number(line[k]) || 0) * sc[k], 0);
    globalThis.calcFantasyPts = App.calcRawPts;
    const r = WP.optimalForRoster(roster, league, { playersData, week: 5, sleeperOnly: true });
    const ids = r.optimal.starters.map(s => s.pid).sort();
    assert.ok(ids.includes('turpin'), 'Turpin stays: his game is final');
    assert.ok(!ids.includes('pickens'), 'Pickens cannot come in: his game is over too');
    const turpin = r.optimal.starters.find(s => s.pid === 'turpin');
    assert.equal(turpin.slot, 'FLEX', 'he stays in the slot he was in');
    assert.equal(turpin.pts, 8.7, 'and counts his actual points');
    assert.ok(ids.includes('adams'), 'the open WR slot goes to the best unlocked WR');
});

test('the DHQ optimizer and its slot placement respect locks', async () => {
    await GL.load('L', 2026, 5);
    const D = require('./dhq-proj.js');
    globalThis.S = Object.assign(globalThis.S, { currentLeagueId: 'L', leagues: [{ league_id: 'L', scoring_settings: {} }] });
    Object.assign(globalThis.S.players, {
        turpin: { position: 'WR', team: 'DAL', fantasy_positions: ['WR'] }, pickens: { position: 'WR', team: 'DAL', fantasy_positions: ['WR'] },
        sanders: { position: 'RB', team: 'LAR', fantasy_positions: ['RB'] }, adams: { position: 'WR', team: 'LAR', fantasy_positions: ['WR'] },
    });
    App.WeeklyProj = Object.assign({}, App.WeeklyProj, { displayWeek: () => 5 });
    D.get('x');
    Object.assign(D._st.results, { turpin: { median: 6.3 }, sanders: { median: 9 }, adams: { median: 5 }, pickens: { median: 13 } });
    const league = { roster_positions: ['WR', 'FLEX', 'BN', 'BN'] };
    const roster = { players: ['turpin', 'sanders', 'adams', 'pickens'], starters: ['adams', 'turpin'] };
    const best = D.optimalFor(roster, league.roster_positions);
    const ids = best.starters.map(s => s.pid);
    assert.ok(ids.includes('turpin') && !ids.includes('sanders') && !ids.includes('pickens'), 'locked Turpin held, locked Pickens left out: ' + ids);
    assert.equal(best.total, 13.7, 'Adams 5 + Turpin actual 8.7');
    assert.equal(D.totalNum(['turpin', 'adams']), 13.7, 'totals use actual points for a locked player');
    const chk = D.lineupCheck(roster, league);
    assert.equal(chk.placed[1], 'turpin', 'lineup check keeps Turpin in FLEX');
    assert.ok(!chk.delta.benchInstead.includes('turpin'), 'no "replace Turpin" call');
    // Slot placement never moves a locked player, even when a move would fit.
    const placed = D.assignSlots(['turpin', 'adams'], [{ idx: 0, elig: ['WR'] }, { idx: 1, elig: ['RB', 'WR', 'TE'] }], { 0: 'adams', 1: 'turpin' });
    assert.equal(placed[1], 'turpin');
});
