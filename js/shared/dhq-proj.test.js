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
