// Run with:  node --test js/shared/chop-odds.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
require('./chopped.js');
require('./chop-odds.js');

// Four living teams in a chopped league, two weeks played at the same form.
const league = { league_id: 'C', settings: { type: 3, last_chopped_leg: 6 } };
const rosters = [1, 2, 3, 4].map(id => ({ roster_id: id, settings: {} }));
const ledger = { rows: rosters.map(r => ({ rosterId: r.roster_id, weekly: [{ week: 1, pts: 100 }, { week: 2, pts: 110 }] })) };

test('from form alone, four even teams share this week\'s chop risk', () => {
    const r = App.ChopOdds.simulate({ league, rosters, ledger, week: 3, myRosterId: 1, sims: 4000 });
    assert.equal(r.weekSource, null);
    for (const row of r.rows) assert.ok(Math.abs(row.chopThisWeekPct - 25) <= 4, row.rosterId + ': ' + row.chopThisWeekPct);
});

test('DHQ this week: the team whose set lineup projects lowest is on the block', () => {
    const weekDists = { week: 3, byRoster: { 1: { mean: 120, sd: 10 }, 2: { mean: 120, sd: 10 }, 3: { mean: 120, sd: 10 }, 4: { mean: 80, sd: 10 } } };
    const r = App.ChopOdds.simulate({ league, rosters, ledger, week: 3, myRosterId: 1, sims: 4000, weekDists });
    assert.equal(r.weekSource, 'dhq');
    assert.equal(r.rows[0].rosterId, 4, 'most at risk first');
    assert.ok(r.rows[0].chopThisWeekPct >= 95, 'team 4: ' + r.rows[0].chopThisWeekPct);
    assert.ok(r.me.chopThisWeekPct <= 2, 'me: ' + r.me.chopThisWeekPct);
});

test('weekDists for a different week leaves this week on form', () => {
    const weekDists = { week: 4, byRoster: { 4: { mean: 80, sd: 10 } } };
    const r = App.ChopOdds.simulate({ league, rosters, ledger, week: 3, myRosterId: 1, sims: 4000, weekDists });
    assert.equal(r.weekSource, null);
    const t4 = r.rows.find(x => x.rosterId === 4);
    assert.ok(Math.abs(t4.chopThisWeekPct - 25) <= 4);
});

test('last_chopped_leg is the latest chop so far, not the finish line', () => {
    // Sleeper, CTB Shootout week 3: 18 teams, chopped in weeks 1 and 2, last_chopped_leg 2.
    const lg = { league_id: 'CTB', settings: { type: 3, last_chopped_leg: 2 } };
    const rs = Array.from({ length: 18 }, (_, i) => ({ roster_id: i + 1, settings: i === 16 ? { eliminated: 1 } : i === 15 ? { eliminated: 2 } : {} }));
    const r = App.ChopOdds.simulate({ league: lg, rosters: rs, ledger: { rows: [] }, week: 3, myRosterId: 1, sims: 2000 });
    assert.equal(r.weeks[0], 3);
    assert.equal(r.weeks[r.weeks.length - 1], 17, '16 alive at week 3: the last chop is week 17');
    const risk = r.rows.filter(x => x.alive).reduce((s, x) => s + x.chopThisWeekPct, 0);
    assert.ok(Math.abs(risk - 100) < 1, 'somebody goes this week: ' + risk);
});
