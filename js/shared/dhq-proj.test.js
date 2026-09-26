// Run with:  node --test js/shared/dhq-proj.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = (p) => ({ DE: 'DL', DT: 'DL', NT: 'DL', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', OLB: 'LB', ILB: 'LB', MLB: 'LB' }[p] || p);
const D = require('./dhq-proj.js');

// The owner's Psycho IDP slots, week 3 (2026-09-24)
globalThis.S = { players: {
    nwosu: { position: 'LB', fantasy_positions: ['DL', 'LB'] }, carter: { position: 'LB', fantasy_positions: ['DL', 'LB'] },
    hall: { position: 'DE', fantasy_positions: ['DL'] }, donald: { position: 'DT', fantasy_positions: ['DL'] },
    oluokun: { position: 'LB', fantasy_positions: ['LB'] }, bush: { position: 'LB', fantasy_positions: ['LB'] },
    mwilson: { position: 'LB', fantasy_positions: ['LB'] }, deablo: { position: 'LB', fantasy_positions: ['LB'] },
    ewilson: { position: 'LB', fantasy_positions: ['LB'] },
} };
const slots = [
    { idx: 0, elig: ['DL'] }, { idx: 1, elig: ['DL'] }, { idx: 2, elig: ['DL'] },
    { idx: 3, elig: ['LB'] }, { idx: 4, elig: ['LB'] },
    { idx: 5, elig: ['DL', 'LB', 'DB'] }, { idx: 6, elig: ['DL', 'LB', 'DB'] }, { idx: 7, elig: ['DL', 'LB', 'DB'] },
];
const current = { 0: 'nwosu', 1: 'carter', 2: 'hall', 3: 'oluokun', 4: 'bush', 5: 'donald', 6: 'mwilson', 7: 'deablo' };

test('benching a DL for an LB takes the two moves it needs, no more', () => {
    const best = ['nwosu', 'carter', 'donald', 'oluokun', 'bush', 'ewilson', 'mwilson', 'deablo'];
    const out = D.assignSlots(best, slots, current);
    assert.equal(out[2], 'donald', 'Donald slides into the DL slot Hall leaves');
    assert.equal(out[5], 'ewilson', 'Wilson takes the IDP FLEX Donald leaves');
    assert.equal(out[4], 'bush', 'Bush stays at LB');
    const moved = Object.keys(out).filter(k => out[k] !== current[k]);
    assert.deepEqual(moved.sort(), ['2', '5']);
});

test('an LB never lands in a DL slot', () => {
    const best = ['nwosu', 'carter', 'ewilson', 'oluokun', 'bush', 'donald', 'mwilson', 'deablo'];
    const out = D.assignSlots(best, slots, current);
    for (const k of [0, 1, 2]) assert.ok(['nwosu', 'carter', 'donald', 'hall'].includes(out[k]), 'DL slot ' + k + ' holds ' + out[k]);
});

test('a lineup that cannot fit the slots returns null', () => {
    const best = ['oluokun', 'bush', 'mwilson', 'deablo', 'ewilson', 'hall', 'donald', 'nwosu'];   // only 3 DL-eligible for 3 DL + fine, but 5 pure LBs for 2 LB + 3 flex = fits; make it fail:
    const tooManyLb = ['oluokun', 'bush', 'mwilson', 'deablo', 'ewilson', 'carter', 'hall', 'x'];
    globalThis.S.players.x = { position: 'LB', fantasy_positions: ['LB'] };
    assert.equal(D.assignSlots(tooManyLb, slots, current), null);
    assert.ok(D.assignSlots(best, slots, current));
});

test('weekDists prices every team in this week\'s games, mine from my Game Day lineup', () => {
    const saved = { S: globalThis.S, WP: App.WeeklyProj };
    require('./matchup.js');
    globalThis.S = { currentLeagueId: 'L', leagues: [{ league_id: 'L', scoring_settings: {} }], players: {} };
    App.WeeklyProj = { displayWeek: () => 3 };
    const st = D._st;
    D.get('x');   // settles the league/week key
    Object.assign(st.results, { a: { median: 20, floor: 14, ceiling: 27 }, b: { median: 10, floor: 7, ceiling: 13 }, c: { median: 30, floor: 21, ceiling: 40 }, z: { median: 25, floor: 18, ceiling: 33 } });
    const lg = { rosters: [{ roster_id: 1, starters: ['a', 'b'] }, { roster_id: 2, starters: ['z'] }] };
    const wd = D.weekDists(lg, [[1, 2]], 3, 1, ['c']);
    assert.equal(wd.week, 3);
    assert.equal(wd.byRoster['1'].mean, 30, 'my working lineup (c), not the saved one (a + b)');
    assert.equal(wd.byRoster['2'].mean, 25);
    const fc = App.Matchup.forecast(App.Matchup.dist(['c'], { c: { points: { median: 30, floor: 21, ceiling: 40 } } }, 'median'), App.Matchup.dist(['z'], { z: { points: { median: 25, floor: 18, ceiling: 33 } } }, 'median'));
    assert.equal(wd.myWinPct, fc.winPct, 'same number the matchup box shows');
    assert.equal(D.weekDists(lg, [[1, 2]], 4, 1, ['c']), null, 'another week: DHQ has no numbers for it');
    delete st.results.z;
    assert.equal(D.weekDists(lg, [[1, 2]], 3, 1, ['c']), null, 'waits until every team is projected');
    globalThis.S = saved.S; App.WeeklyProj = saved.WP;
});

test('rosterDists prices every living team for a chopped week', () => {
    const saved = { S: globalThis.S, WP: App.WeeklyProj };
    globalThis.S = { currentLeagueId: 'L', leagues: [{ league_id: 'L', scoring_settings: {} }], players: {} };
    App.WeeklyProj = { displayWeek: () => 3 };
    const st = D._st;
    D.get('x');
    Object.assign(st.results, { a: { median: 20, floor: 14, ceiling: 27 }, b: { median: 10, floor: 7, ceiling: 13 }, z: { median: 25, floor: 18, ceiling: 33 } });
    const lg = { rosters: [{ roster_id: 1, starters: ['a', 'b'] }, { roster_id: 2, starters: ['z'] }, { roster_id: 3, starters: ['q'] }] };
    const wd = D.rosterDists(lg, ['1', '2'], 3, 1, null);
    assert.equal(wd.byRoster['1'].mean, 30, 'saved starters when no Game Day lineup is given');
    assert.equal(wd.byRoster['2'].mean, 25);
    assert.equal(D.rosterDists(lg, ['1', '2', '3'], 3, 1, null), null, 'waits for every living team');
    globalThis.S = saved.S; App.WeeklyProj = saved.WP;
});

test('a starter DHQ can\'t project keeps its slot', () => {
    // CTB The One, 2026-09-26: Apply Optimal moved "Minnesota Vikings → Empty".
    // A team defense has no DHQ projection; that is not the same as "won't play".
    const saved = { S: globalThis.S, WP: App.WeeklyProj, SS: App.StartSit };
    App.StartSit = require('./startsit-engine.js');
    globalThis.S = { currentLeague: null, currentLeagueId: 'L', leagues: [{ league_id: 'L', scoring_settings: {} }], players: {
        qb1: { position: 'QB', team: 'ARI', fantasy_positions: ['QB'] }, qb2: { position: 'QB', team: 'JAX', fantasy_positions: ['QB'] },
        min: { position: 'DEF', team: 'MIN', fantasy_positions: ['DEF'] }, tb: { position: 'DEF', team: 'TB', fantasy_positions: ['DEF'] },
        wr1: { position: 'WR', team: 'LV', fantasy_positions: ['WR'] }, wrOut: { position: 'WR', team: 'PIT', fantasy_positions: ['WR'] },
    } };
    App.WeeklyProj = { displayWeek: () => 3 };
    const st = D._st;
    D.get('x');
    Object.assign(st.results, { qb1: { median: 12 }, qb2: { median: 15 }, min: null, tb: null, wr1: { median: 9 }, wrOut: { median: 0 } });
    const league = { roster_positions: ['QB', 'WR', 'DEF', 'BN', 'BN', 'BN'] };
    const roster = { players: ['qb1', 'qb2', 'min', 'tb', 'wr1', 'wrOut'], starters: ['qb1', 'wrOut', 'min'] };

    const best = D.optimalFor(roster, league.roster_positions);
    const def = best.starters.find(s => s.slot === 'DEF');
    assert.ok(def, 'the DEF slot is not left empty');
    assert.equal(def.pid, 'min', 'the defense in the slot stays in it');
    assert.equal(def.held, true);
    assert.equal(best.total, 24, 'the held defense adds nothing to the DHQ total (qb2 15 + wr1 9)');

    const chk = D.lineupCheck(roster, league);
    assert.equal(chk.placed[2], 'min', 'lineup check keeps the defense in its slot');
    assert.equal(chk.placed[0], 'qb2', 'a player DHQ does project is still upgraded');
    assert.equal(chk.placed[1], 'wr1', 'a starter DHQ projects at 0 (out) is still replaced');
    assert.ok(!chk.delta.benchInstead.includes('min'), 'no "bench the defense" call');
    assert.ok(chk.delta.startInstead.every(s => s.pid !== 'tb'), 'no other defense pushed in on no number');

    // Working lineup with the other defense in the slot: that one stays.
    const chk2 = D.lineupCheck(roster, league, { 0: 'qb1', 1: 'wr1', 2: 'tb' });
    assert.equal(chk2.placed[2], 'tb');

    // A cut player (no NFL team) is not held: he really can't play.
    globalThis.S.players.min = { position: 'DEF', team: null, fantasy_positions: ['DEF'] };
    const best2 = D.optimalFor(roster, league.roster_positions);
    assert.ok(!best2.starters.some(s => s.pid === 'min'));
    globalThis.S = saved.S; App.WeeklyProj = saved.WP; App.StartSit = saved.SS;
});
