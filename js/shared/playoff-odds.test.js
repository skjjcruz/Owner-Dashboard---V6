// Run with:  node --test js/shared/playoff-odds.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
require('./playoff-odds.js');

// Four even teams, two weeks played, weeks 3-4 left.
const row = (id) => ({ rosterId: id, name: 'T' + id, wins: 1, losses: 1, ties: 0, pf: 220, weekly: [{ week: 1, pts: 100 }, { week: 2, pts: 120 }] });
const ledger = { rows: [row(1), row(2), row(3), row(4)] };
const league = { settings: { playoff_teams: 2 }, rosters: [] };
const futurePairs = { 3: [[1, 2], [3, 4]], 4: [[1, 3], [2, 4]] };

test('without weekDists this week is a coin flip from past scores', () => {
    const r = App.PlayoffOdds.simulate({ league, ledger, futurePairs, myRosterId: 1, sims: 4000 });
    assert.ok(Math.abs(r.leverage.winPct - 50) <= 4, 'even teams → about 50%: ' + r.leverage.winPct);
    assert.equal(r.weekSource, null);
    assert.equal(r.leverage.source, 'history');
});

test('weekDists replaces only that week: a DHQ favourite wins week 3, week 4 stays even', () => {
    const weekDists = { week: 3, myWinPct: 88, byRoster: { 1: { mean: 140, sd: 12 }, 2: { mean: 110, sd: 12 }, 3: { mean: 110, sd: 12 }, 4: { mean: 110, sd: 12 } } };
    const r = App.PlayoffOdds.simulate({ league, ledger, futurePairs, myRosterId: 1, sims: 4000, weekDists });
    assert.ok(r.leverage.winPct >= 90, 'week 3 drawn from DHQ: ' + r.leverage.winPct);
    assert.equal(r.weekSource, 'dhq');
    assert.equal(r.weekWinPct, 88, 'the matchup box number rides through for display');
    const me = r.rows.find(x => x.rosterId === 1);
    assert.ok(me.projWins > 2.3 && me.projWins < 3.1, 'about one more win plus a coin flip: ' + me.projWins);
});

test('weekDists for another week leaves the current week alone', () => {
    const weekDists = { week: 4, byRoster: { 1: { mean: 140, sd: 12 } } };
    const r = App.PlayoffOdds.simulate({ league, ledger, futurePairs, myRosterId: 1, sims: 4000, weekDists });
    assert.equal(r.weekSource, null);
    assert.ok(Math.abs(r.leverage.winPct - 50) <= 4);
});
