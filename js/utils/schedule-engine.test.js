// Run with:  node --test js/utils/schedule-engine.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};

// Week 3, three weeks of schedule: week 1 played, week 3 this week, week 4 ahead.
const sleeperFc = { winPct: 60, margin: 5, projMe: 120, projOpp: 115 };
const dhqFc = { winPct: 24, margin: -17.4, projMe: 221.5, projOpp: 238.9 };
let dhqCalls = [];
App.WeeklyProj = {
    currentWeek: () => 3,
    optimalForRoster: () => ({ optimal: { starters: [{ pid: 'a' }], slots: [{ pid: 'a' }] }, projections: {} }),
};
App.Matchup = {
    dist: () => ({ mean: 0, sd: 1, n: 1 }),
    forecast: () => sleeperFc,
    resolveSeasonOpponents: async () => ({ 1: { oppRosterId: 2, myPts: 100, oppPts: 90 }, 3: { oppRosterId: 2 }, 4: { oppRosterId: 2 } }),
};
App.DhqProj = {
    week: () => 3, stamp: () => 'k:1',
    matchup: (mine, opp) => { dhqCalls.push(mine); return { fc: dhqFc, oppCur: 238.9 }; },
};
require('./schedule-engine.js');

const league = { league_id: 'L', settings: { playoff_week_start: 5 }, roster_positions: ['QB'], rosters: [{ roster_id: 2, starters: ['z'] }] };
const me = { roster_id: 1, starters: ['a', 'b'], players: ['a', 'b', 'c'], settings: { wins: 1, losses: 0, fpts: 100 } };

test('this week runs on DHQ, later weeks stay on Sleeper', async () => {
    const out = await App.Schedule.buildSeason({ league, myRoster: me, playersData: {} });
    const w3 = out.weeks.find(r => r.week === 3), w4 = out.weeks.find(r => r.week === 4);
    assert.equal(w3.source, 'dhq');
    assert.equal(w3.winPct, 24, 'the week 3 row matches the This Week matchup box');
    assert.equal(w3.myProj, 221.5);
    assert.equal(w4.source, 'sleeper');
    assert.equal(w4.winPct, 60);
    assert.deepEqual(dhqCalls[0], ['a', 'b'], 'saved starters when no working lineup is passed');
    assert.equal(out.summary.projPF, +(100 + 221.5 + 120).toFixed(1));
});

test('the lineup set on Game Day drives the DHQ forecast', async () => {
    dhqCalls = [];
    await App.Schedule.buildSeason({ league, myRoster: me, playersData: {}, myStarters: ['a', 'c'] });
    assert.deepEqual(dhqCalls[0], ['a', 'c']);
});

test('before DHQ has the week it falls back to Sleeper', async () => {
    App.DhqProj.matchup = () => null; App.DhqProj.stamp = () => 'k:0';
    const out = await App.Schedule.buildSeason({ league, myRoster: me, playersData: {} });
    const w3 = out.weeks.find(r => r.week === 3);
    assert.equal(w3.source, 'sleeper');
    assert.equal(w3.winPct, 60);
});
