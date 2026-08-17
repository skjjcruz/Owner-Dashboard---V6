#!/usr/bin/env node
// Unit tests for js/shared/chopped.js (Sleeper CHOPPED / last-man-standing
// leagues) plus the league-skin contract and the FAAB elimination fix.
//
// Fixtures mirror a REAL league verified against the Sleeper API: 18 teams,
// $10,000 FAAB, trades disabled, playoff_teams null / playoff_week_start 0,
// last_chopped_leg 17, one chop per week, roster.settings.eliminated carrying
// the week each team went out.
'use strict';

const assert = require('assert');
const Chopped = require('../js/shared/chopped.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Fixtures ────────────────────────────────────────────────────────
const CHOP_LEAGUE = {
  league_id: 'CHOP', name: '🪓 Shootout', season: '2026', total_rosters: 18,
  roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'FLEX', 'FLEX', 'FLEX'],
  scoring_settings: { rec: 0.5, rec_yd: 0.1, rec_td: 6 },
  settings: { type: 3, last_chopped_leg: 17, waiver_budget: 10000, disable_trades: 1, playoff_week_start: 0, leg: 6, max_keepers: 1 },
};
const REDRAFT_LEAGUE = {
  league_id: 'RD', name: 'Normal', total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN'],
  scoring_settings: { rec: 0.5 },
  settings: { type: 0, playoff_week_start: 15, playoff_teams: 6, waiver_budget: 100 },
};
// 5 teams: three chopped (weeks 1,2,3), two alive.
const ROSTERS = [
  { roster_id: 1, owner_id: 'u1', players: [], settings: { eliminated: 1, locked: 1, waiver_budget_used: 0 } },
  { roster_id: 2, owner_id: 'u2', players: [], settings: { eliminated: 2, locked: 1, waiver_budget_used: 300 } },
  { roster_id: 3, owner_id: 'u3', players: [], settings: { eliminated: 3, locked: 1, waiver_budget_used: 8000 } },
  { roster_id: 4, owner_id: 'u4', players: ['p1', 'p2'], settings: { waiver_budget_used: 5000 } },
  { roster_id: 5, owner_id: 'u5', players: ['p3', 'p4'], settings: { waiver_budget_used: 9000 } },
];

// ── Detection ───────────────────────────────────────────────────────
test('isChopped: reads Sleeper type 3, not a heuristic', () => {
  assert.strictEqual(Chopped.isChopped(CHOP_LEAGUE), true);
  assert.strictEqual(Chopped.isChopped(REDRAFT_LEAGUE), false);
  assert.strictEqual(Chopped.isChopped(null), false);
  assert.strictEqual(Chopped.isChopped({ settings: {} }), false);
});
test('isChopped: honors a normalized/overridden type string', () => {
  assert.strictEqual(Chopped.isChopped({ type: 'chopped', settings: {} }), true);
  assert.strictEqual(Chopped.isChopped({ type: 'guillotine', settings: {} }), true);
  assert.strictEqual(Chopped.isChopped({ type: 'dynasty', settings: {} }), false);
});
test('lastChoppedLeg: exposed, null when absent', () => {
  assert.strictEqual(Chopped.lastChoppedLeg(CHOP_LEAGUE), 17);
  assert.strictEqual(Chopped.lastChoppedLeg(REDRAFT_LEAGUE), null);
});

// ── Elimination ─────────────────────────────────────────────────────
test('eliminatedWeek: the week the team was chopped, null while alive', () => {
  assert.strictEqual(Chopped.eliminatedWeek(ROSTERS[0]), 1);
  assert.strictEqual(Chopped.eliminatedWeek(ROSTERS[2]), 3);
  assert.strictEqual(Chopped.eliminatedWeek(ROSTERS[3]), null);
  assert.strictEqual(Chopped.isEliminated(ROSTERS[3]), false);
  assert.strictEqual(Chopped.isEliminated(ROSTERS[0]), true);
});
test('isAliveInWeek: a team chopped in week 3 WAS alive in week 3', () => {
  const r = ROSTERS[2];  // eliminated: 3
  assert.strictEqual(Chopped.isAliveInWeek(r, 2), true, 'playing in week 2');
  assert.strictEqual(Chopped.isAliveInWeek(r, 3), true, 'its week-3 score is what chopped it');
  assert.strictEqual(Chopped.isAliveInWeek(r, 4), false, 'gone by week 4');
  assert.strictEqual(Chopped.isAliveInWeek(r), false, 'no week = right now = dead');
  assert.strictEqual(Chopped.isAliveInWeek(ROSTERS[3], 9), true, 'never chopped');
});
test('aliveRosters / eliminatedRosters partition the league', () => {
  assert.deepStrictEqual(Chopped.aliveRosters(ROSTERS).map(r => r.roster_id), [4, 5]);
  assert.deepStrictEqual(Chopped.eliminatedRosters(ROSTERS).map(r => r.roster_id), [1, 2, 3]);
  assert.deepStrictEqual(Chopped.aliveRosters(ROSTERS, 2).map(r => r.roster_id), [2, 3, 4, 5], 'as of week 2');
});

// ── State ───────────────────────────────────────────────────────────
test('state: full picture with the chop order sorted by week', () => {
  const s = Chopped.state({ league: CHOP_LEAGUE, rosters: ROSTERS, week: 6 });
  assert.strictEqual(s.isChopped, true);
  assert.strictEqual(s.teams, 5);
  assert.strictEqual(s.aliveCount, 2);
  assert.strictEqual(s.choppedCount, 3);
  assert.deepStrictEqual(s.order.map(o => o.week), [1, 2, 3]);
  assert.strictEqual(s.lastChoppedLeg, 17);
  assert.strictEqual(s.nextChopWeek, 6, 'chops still running');
  assert.strictEqual(s.survivorRosterId, null, 'two alive — nobody has won');
});
test('state: crowns a survivor only when everyone else is chopped', () => {
  const finished = ROSTERS.slice(0, 4).concat([
    { roster_id: 5, owner_id: 'u5', players: ['p3'], settings: { waiver_budget_used: 9000 } },
  ]).map(r => (r.roster_id === 4 ? { ...r, players: [], settings: { eliminated: 4, locked: 1 } } : r));
  const s = Chopped.state({ league: CHOP_LEAGUE, rosters: finished });
  assert.strictEqual(s.aliveCount, 1);
  assert.strictEqual(s.survivorRosterId, 5);
});
test('state: past the last chopped leg there is no next chop', () => {
  const s = Chopped.state({ league: CHOP_LEAGUE, rosters: ROSTERS, week: 18 });
  assert.strictEqual(s.nextChopWeek, null);
});
test('state: a non-chopped league reports isChopped false and no survivor', () => {
  const s = Chopped.state({ league: REDRAFT_LEAGUE, rosters: [{ roster_id: 1, players: ['a'], settings: {} }] });
  assert.strictEqual(s.isChopped, false);
  assert.strictEqual(s.survivorRosterId, null);
});

// ── League skin contract ────────────────────────────────────────────
global.window = globalThis;
window.App = window.App || {};
window.WR = window.WR || {};
require('../js/league-skin.js');
const Skin = window.App.LeagueSkin;

test('skin: type 3 resolves to "chopped", not the raw number', () => {
  const s = Skin.build({ league: CHOP_LEAGUE, rosters: ROSTERS });
  assert.strictEqual(s.type, 'chopped');
  assert.strictEqual(s.typeMeta.label, 'Chopped', 'was rendering the literal "3"');
  assert.strictEqual(s.typeMeta.family, 'survival');
});
test('skin: chopped rides the SEASONAL branch — keeps the features it needs', () => {
  const f = Skin.build({ league: CHOP_LEAGUE, rosters: ROSTERS, nflState: { season_type: 'regular', week: 6 } }).features;
  assert.strictEqual(f.showRestOfSeasonValue, true, 'values are rest-of-season, never dynasty');
  assert.strictEqual(f.showWaiverPlanner, true, 'waivers ARE the game here');
  assert.strictEqual(f.showDynastyValue, false);
  assert.strictEqual(f.showAgeCurve, false);
  assert.strictEqual(f.showFuturePicks, false);
  // The live league carries a vestigial max_keepers:1 from being cloned —
  // keeper controls must not ride in on that. Chopped rosters go to waivers.
  assert.strictEqual(f.showKeepers, false, 'nothing to keep in a chopped league');
  assert.strictEqual(f.showKeeperControls, false);
});
test('skin: a real keeper league still gets its keeper controls', () => {
  const keeperLg = { ...REDRAFT_LEAGUE, settings: { ...REDRAFT_LEAGUE.settings, type: 1, max_keepers: 2 } };
  const f = Skin.build({ league: keeperLg, rosters: [] }).features;
  assert.strictEqual(f.showKeepers, true);
  assert.strictEqual(f.showKeeperControls, true);
});
test('skin: chopped suppresses trades, matchups, standings and playoff odds', () => {
  const f = Skin.build({ league: CHOP_LEAGUE, rosters: ROSTERS }).features;
  assert.strictEqual(f.showTrades, false);
  assert.strictEqual(f.showMatchup, false);
  assert.strictEqual(f.showStandings, false);
  assert.strictEqual(f.showPlayoffOdds, false);
  assert.strictEqual(f.showElimination, true);
});
test('skin: the new suppressors default TRUE for every existing format', () => {
  const f = Skin.build({ league: REDRAFT_LEAGUE, rosters: [] }).features;
  assert.strictEqual(f.showTrades, true);
  assert.strictEqual(f.showMatchup, true);
  assert.strictEqual(f.showStandings, true);
  assert.strictEqual(f.showPlayoffOdds, true);
  assert.strictEqual(f.showElimination, false);
});
test('skin: showTrades also respects a league that simply disabled trading', () => {
  const noTrades = { ...REDRAFT_LEAGUE, settings: { ...REDRAFT_LEAGUE.settings, disable_trades: 1 } };
  assert.strictEqual(Skin.build({ league: noTrades, rosters: [] }).features.showTrades, false);
});
test('skin: chopped vocabulary speaks survival, not trading', () => {
  const v = Skin.build({ league: CHOP_LEAGUE, rosters: ROSTERS }).vocabulary;
  assert.strictEqual(v.valueShortLabel, 'ROS');
  assert.strictEqual(v.marketLabel, 'Waiver Pool');
  assert.strictEqual(v.strategyLabel, 'Survival Plan');
  assert.ok(/chopped/i.test(v.rosterEmptyLabel), 'empty roster reads as chopped, not "not drafted"');
});

// ── FAAB: the ghost-rival fix ───────────────────────────────────────
const Faab = require('../js/shared/faab-engine.js');
test('faab: chopped teams are not counted as rivals', () => {
  const league = { ...CHOP_LEAGUE, rosters: ROSTERS, users: [] };
  const txns = [];
  for (let w = 1; w <= 6; w++) {
    txns.push({ type: 'waiver', status: 'complete', leg: w, roster_ids: [4], adds: { x: 4 }, settings: { waiver_bid: 500 } });
    txns.push({ type: 'waiver', status: 'complete', leg: w, roster_ids: [5], adds: { y: 5 }, settings: { waiver_bid: 900 } });
    txns.push({ type: 'waiver', status: 'failed', leg: w, roster_ids: [4], adds: { z: 4 }, settings: { waiver_bid: 400 } });
  }
  const out = Faab.analyze({
    league, myRosterId: 4, playersData: { p1: { position: 'RB' }, p3: { position: 'RB' } },
    txns, targetPos: 'RB', targetStrength: 0.8,
  });
  assert.ok(out, 'analysis produced');
  const ids = out.rivals.map(r => String(r.rosterId)).sort();
  assert.deepStrictEqual(ids, ['5'], 'only the one LIVE opponent — three corpses excluded');
  assert.ok(!out.rivals.some(r => r.engaged && [1, 2, 3].includes(Number(r.rosterId))), 'no chopped team is engaged');
});
test('faab: league spend averages over LIVE teams only', () => {
  const league = { ...CHOP_LEAGUE, rosters: ROSTERS, users: [] };
  const txns = [{ type: 'waiver', status: 'complete', leg: 1, roster_ids: [5], adds: { y: 5 }, settings: { waiver_bid: 900 } }];
  const out = Faab.analyze({ league, myRosterId: 4, playersData: {}, txns, targetPos: 'RB', targetStrength: 0.5 });
  // Live teams 4 and 5 used 5000 and 9000 of 10000 → 50% and 90% → mean 70%.
  // Including the three corpses (0%, 3%, 80%) would drag it to ~44%.
  assert.strictEqual(out.leagueSpentPct, 70, 'corpses would have dragged this down');
});
test('faab: an ordinary redraft league is completely unaffected', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'a', players: ['p1'], settings: { waiver_budget_used: 10 } },
    { roster_id: 2, owner_id: 'b', players: ['p2'], settings: { waiver_budget_used: 30 } },
  ];
  const league = { ...REDRAFT_LEAGUE, rosters, users: [] };
  const txns = [{ type: 'waiver', status: 'complete', leg: 1, roster_ids: [2], adds: { q: 2 }, settings: { waiver_bid: 20 } }];
  const out = Faab.analyze({ league, myRosterId: 1, playersData: { p2: { position: 'RB' } }, txns, targetPos: 'RB', targetStrength: 0.5 });
  assert.strictEqual(out.rivals.length, 1, 'the one opponent is still a rival');
  assert.strictEqual(out.leagueSpentPct, 20, '(10 + 30) / 2');
});

// ── Summary ─────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.log('FAIL: ' + failed + ' of ' + (passed + failed) + ' tests failed');
  failures.forEach(f => console.log('  - ' + f.name + ': ' + (f.e && f.e.message)));
  process.exit(1);
}
console.log('PASS: ' + passed + ' tests');
