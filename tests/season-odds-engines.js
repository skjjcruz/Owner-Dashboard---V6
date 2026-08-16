#!/usr/bin/env node
// Unit tests for the Season Odds engines: luck ledger (all-play / expected
// wins) and the playoff-odds Monte Carlo. Ported from the lab
// (WarRoom-sandbox tests/redraft-engines.js) with the FAAB and weekly-proj
// sections left behind until those engines are ported. All pure-compute
// paths — no network (fetch is stubbed so nothing can self-warm).
'use strict';

const assert = require('assert');

globalThis.fetch = () => Promise.resolve({ ok: false });

const Luck = require('../js/shared/luck-engine.js');
const Odds = require('../js/shared/playoff-odds.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── Luck ledger ─────────────────────────────────────────────────────
// 4 teams, 3 weeks, hand-checkable scores. Matchups: (1v2), (3v4) each week.
const luckLeague = {
  rosters: [1, 2, 3, 4].map(id => ({ roster_id: id, owner_id: 'u' + id })),
  users: [1, 2, 3, 4].map(id => ({ user_id: 'u' + id, display_name: 'Team ' + id })),
};
const weeklyScores = {
  1: [{ rosterId: 1, points: 130, matchupId: 'a' }, { rosterId: 2, points: 100, matchupId: 'a' },
      { rosterId: 3, points: 120, matchupId: 'b' }, { rosterId: 4, points: 90, matchupId: 'b' }],
  2: [{ rosterId: 1, points: 80, matchupId: 'a' }, { rosterId: 2, points: 110, matchupId: 'a' },
      { rosterId: 3, points: 125, matchupId: 'b' }, { rosterId: 4, points: 85, matchupId: 'b' }],
  3: [{ rosterId: 1, points: 140, matchupId: 'a' }, { rosterId: 2, points: 95, matchupId: 'a' },
      { rosterId: 3, points: 60, matchupId: 'b' }, { rosterId: 4, points: 100, matchupId: 'b' }],
};

test('luck: all-play records match hand computation', () => {
  const { rows } = Luck.buildLedger({ league: luckLeague, weeklyScores });
  const t1 = rows.find(r => r.rosterId === 1);
  // W1: 130 beats 100,120,90 → 3-0. W2: 80 beats none → 0-3. W3: 140 beats all → 3-0.
  assert.strictEqual(t1.allPlayW, 6, 'team1 all-play wins');
  assert.strictEqual(t1.allPlayL, 3, 'team1 all-play losses');
  assert.strictEqual(t1.wins, 2, 'team1 H2H wins (W1, W3)');
  assert.strictEqual(t1.losses, 1, 'team1 H2H losses (W2)');
});

test('luck: expected wins and luck are consistent', () => {
  const { rows } = Luck.buildLedger({ league: luckLeague, weeklyScores });
  for (const r of rows) {
    const apGames = r.allPlayW + r.allPlayL + r.allPlayT;
    assert.strictEqual(apGames, 9, 'each team plays 3 opponents × 3 weeks');
    assert.ok(Math.abs(r.expWins - r.allPlayPct * 3) < 0.06, 'expWins ≈ allPlayPct × games');
    assert.ok(Math.abs(r.luck - (r.wins + r.ties / 2 - r.expWins)) < 0.06, 'luck = actual − expected');
  }
  // League luck sums to ~0 only when H2H games all pair inside the counted set — true here.
  const total = rows.reduce((s, r) => s + r.luck, 0);
  assert.ok(Math.abs(total) < 0.21, 'league luck sums to ~0, got ' + total);
});

test('luck: unplayed weeks are dropped by the fetch gate, zero-score rows still count in compute', () => {
  const withDead = { ...weeklyScores, 4: [{ rosterId: 1, points: 0, matchupId: 'a' }, { rosterId: 2, points: 0, matchupId: 'a' }] };
  // buildLedger trusts its input; the "≥2 real scores" gate lives in fetchWeeklyScores.
  const { weeks } = Luck.buildLedger({ league: luckLeague, weeklyScores: withDead });
  assert.deepStrictEqual(weeks, [1, 2, 3, 4]);
});

// ── Playoff odds ────────────────────────────────────────────────────
function oddsFixture() {
  const ledger = Luck.buildLedger({ league: luckLeague, weeklyScores });
  // Make team 1 dominant going forward by feeding it a fat scoring history.
  ledger.rows.forEach(r => {
    if (r.rosterId === 1) r.weekly = r.weekly.map(g => ({ ...g, pts: 150 }));
    if (r.rosterId === 4) r.weekly = r.weekly.map(g => ({ ...g, pts: 70 }));
  });
  const futurePairs = { 4: [[1, 3], [2, 4]], 5: [[1, 4], [2, 3]] };
  return { ledger, futurePairs };
}

test('odds: deterministic for a fixed seed', () => {
  const { ledger, futurePairs } = oddsFixture();
  const league = { ...luckLeague, settings: { playoff_teams: 2 } };
  const a = Odds.simulate({ league, ledger, futurePairs, myRosterId: 1, sims: 2000, seed: 7 });
  const b = Odds.simulate({ league, ledger, futurePairs, myRosterId: 1, sims: 2000, seed: 7 });
  assert.deepStrictEqual(a.rows, b.rows, 'same seed → same odds');
});

test('odds: dominant team clears the field; probabilities are coherent', () => {
  const { ledger, futurePairs } = oddsFixture();
  const league = { ...luckLeague, settings: { playoff_teams: 2 } };
  const r = Odds.simulate({ league, ledger, futurePairs, myRosterId: 1, sims: 4000, seed: 11 });
  const t1 = r.rows.find(x => x.rosterId === 1);
  const t4 = r.rows.find(x => x.rosterId === 4);
  assert.ok(t1.playoffPct > 85, 'dominant team makes playoffs, got ' + t1.playoffPct);
  assert.ok(t4.playoffPct < 30, 'weak team mostly misses, got ' + t4.playoffPct);
  const titleSum = r.rows.reduce((s, x) => s + x.titlePct, 0);
  assert.ok(titleSum >= 97 && titleSum <= 103, 'title odds sum ≈ 100, got ' + titleSum);
  const playoffSum = r.rows.reduce((s, x) => s + x.playoffPct, 0);
  assert.ok(Math.abs(playoffSum - 200) <= 4, '2 playoff slots → playoff pcts sum ≈ 200, got ' + playoffSum);
});

test('odds: leverage brackets the unconditional probability', () => {
  const { ledger, futurePairs } = oddsFixture();
  const league = { ...luckLeague, settings: { playoff_teams: 2 } };
  const r = Odds.simulate({ league, ledger, futurePairs, myRosterId: 2, sims: 4000, seed: 3 });
  assert.ok(r.leverage, 'leverage computed for a team with a current-week game');
  assert.ok(r.leverage.ifWin >= r.leverage.current, 'winning cannot hurt');
  assert.ok(r.leverage.ifLose <= r.leverage.current, 'losing cannot help');
  assert.ok(r.leverage.ifWin > r.leverage.ifLose, 'leverage is a real spread');
});

test('odds: division winners are seeded when rosters carry divisions', () => {
  const { ledger, futurePairs } = oddsFixture();
  const league = {
    ...luckLeague,
    settings: { playoff_teams: 2, divisions: 2 },
    rosters: luckLeague.rosters.map(r => ({ ...r, settings: { division: r.roster_id <= 2 ? 1 : 2 } })),
  };
  const r = Odds.simulate({ league, ledger, futurePairs, sims: 2000, seed: 5 });
  assert.ok(r.usedDivisions, 'division seeding engaged');
  // Team 3 is the only real competition in division 2 (team 4 is weak): with 2
  // slots and 2 divisions, team 3 makes it far more often than open seeding.
  const t3 = r.rows.find(x => x.rosterId === 3);
  assert.ok(t3.playoffPct > 55, 'division winner slot lifts team 3, got ' + t3.playoffPct);
});

// ── Async: the weekly-score fetch contract ──────────────────────────
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

(async () => {
  // Analytics passes an explicit throughWeek for a FINISHED season, because
  // currentWeek() reads the live NFL week (1 all offseason) and would report
  // zero played weeks. That contract is what makes the end-of-year luck recap
  // work, so pin it.
  await testAsync('luck: fetchWeeklyScores honors explicit throughWeek and drops dead weeks', async () => {
    const calls = [];
    globalThis.fetchMatchups = (lid, w) => {
      calls.push(w);
      // Weeks 1–3 played; 4–5 all zeros (unplayed) → must be dropped, so an
      // in-progress or future week can't hand everyone an 0-11 all-play line.
      if (w >= 4) return Promise.resolve([{ roster_id: 1, points: 0, matchup_id: 'a' }, { roster_id: 2, points: 0, matchup_id: 'a' }]);
      return Promise.resolve([{ roster_id: 1, points: 100 + w, matchup_id: 'a' }, { roster_id: 2, points: 90, matchup_id: 'a' }]);
    };
    try {
      const league = { league_id: 'L1', rosters: luckLeague.rosters, users: luckLeague.users };
      const got = await Luck.fetchWeeklyScores({ league, throughWeek: 5 });
      assert.deepStrictEqual(calls.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5], 'fetches every week up to throughWeek');
      assert.deepStrictEqual(Object.keys(got).map(Number).sort((a, b) => a - b), [1, 2, 3], 'weeks without two real scores are dropped');
    } finally { delete globalThis.fetchMatchups; }
  });

  await testAsync('luck: no matchups fetcher → empty ledger, never a throw', async () => {
    const league = { league_id: 'L1', rosters: luckLeague.rosters, users: luckLeague.users };
    const got = await Luck.fetchWeeklyScores({ league, throughWeek: 4 });
    assert.deepStrictEqual(got, {}, 'degrades to no weeks');
    const { rows, weeks } = Luck.buildLedger({ league, weeklyScores: got });
    assert.deepStrictEqual(weeks, [], 'no weeks counted');
    assert.strictEqual(rows.length, 4, 'still returns a row per roster');
    assert.ok(rows.every(r => r.expWins === 0 && r.luck === 0), 'zero games → zero expected wins, zero luck');
  });

  console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
    process.exit(1);
  }
})();
