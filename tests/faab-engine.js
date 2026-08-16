#!/usr/bin/env node
// Unit tests for the FAAB Command bid engine. Ported from the lab
// (WarRoom-sandbox tests/redraft-engines.js, FAAB section) — the fixture is
// deliberately tuned: team 2 has $20 left (budget-respect assertion), team 3
// has one healthy RB against two RB slots (HIGH need), and the third case's
// sampleSize of 15 lands exactly on MIN_SAMPLE with a failed $30 claim
// included, so dropping failed-claim evidence fails immediately.
'use strict';

const assert = require('assert');

globalThis.fetch = () => Promise.resolve({ ok: false });

const Faab = require('../js/shared/faab-engine.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push({ name, e }); console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// ── FAAB ────────────────────────────────────────────────────────────
function faabLeague() {
  return {
    settings: { waiver_budget: 100, divisions: 0 },
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    rosters: [1, 2, 3, 4].map(id => ({
      roster_id: id, owner_id: 'u' + id,
      settings: { waiver_budget_used: id === 2 ? 80 : 30 },
      players: id === 3 ? ['rb1'] : ['rb1', 'rb2', 'rb3'],   // team 3 thin at RB
    })),
    users: [1, 2, 3, 4].map(id => ({ user_id: 'u' + id, display_name: 'Team ' + id })),
  };
}
const faabPlayers = {
  rb1: { position: 'RB', injury_status: '' },
  rb2: { position: 'RB', injury_status: '' },
  rb3: { position: 'RB', injury_status: 'OUT' },
};
function bidTxn(rosterId, bid, week, failed) {
  return { type: 'waiver', status: failed ? 'failed' : 'complete', leg: week, settings: { waiver_bid: bid }, roster_ids: [rosterId], adds: { ['p' + week + rosterId]: rosterId } };
}

test('faab: cold start flags small samples and still produces a legal plan', () => {
  const a = Faab.analyze({ league: faabLeague(), myRosterId: 1, txns: [bidTxn(2, 10, 3)], playersData: faabPlayers, targetPos: 'RB', targetStrength: 0.6 });
  assert.ok(a.coldStart, 'under MIN_SAMPLE → coldStart');
  assert.ok(a.rec.bid >= a.minBid && a.rec.bid <= a.myLeft, 'rec within legal range');
  assert.ok(a.ladder.length >= 3, 'ladder has rungs');
});

test('faab: ladder win probabilities are monotonic and rivals respect budgets', () => {
  const txns = [];
  for (let w = 1; w <= 6; w++) { txns.push(bidTxn(2, 8 + w, w), bidTxn(3, 20 + w, w), bidTxn(4, 5, w, true)); }
  const a = Faab.analyze({ league: faabLeague(), myRosterId: 1, txns, playersData: faabPlayers, targetPos: 'RB', targetStrength: 0.7 });
  assert.ok(!a.coldStart, '18 bids clears MIN_SAMPLE');
  for (let i = 1; i < a.ladder.length; i++) {
    assert.ok(a.ladder[i].winPct >= a.ladder[i - 1].winPct, 'bigger bid never lowers win odds');
  }
  for (const r of a.rivals) assert.ok(r.estBid <= r.faabLeft, 'no rival bids money they do not have');
  const thin = a.rivals.find(r => r.rosterId === 3);
  assert.strictEqual(thin.need, 'HIGH', 'team 3 (one healthy RB, two RB slots) reads HIGH need');
});

test('faab: Sleeper waiver_bid_min floors every number (owner league: $13 minimum)', () => {
  const lg = faabLeague();
  lg.settings.waiver_bid_min = 13;   // Sleeper's real field name — NOT waiver_budget_min
  const a = Faab.analyze({ league: lg, myRosterId: 1, txns: [bidTxn(2, 10, 3)], playersData: faabPlayers, targetPos: 'RB', targetStrength: 0.6 });
  assert.strictEqual(a.minBid, 13, 'league minimum read from waiver_bid_min');
  assert.ok(a.rec.bid >= 13, 'recommendation never dips under the league minimum');
  assert.ok(a.ladder.every(l => l.bid >= 13), 'every ladder rung is a legal bid');
});

test('faab: failed claims count as bid evidence', () => {
  const txns = [];
  for (let w = 1; w <= 5; w++) { txns.push(bidTxn(2, 10, w), bidTxn(3, 12, w), bidTxn(4, 30, w, true)); }
  const a = Faab.analyze({ league: faabLeague(), myRosterId: 1, txns, playersData: faabPlayers, targetPos: 'RB', targetStrength: 0.5 });
  assert.strictEqual(a.sampleSize, 15, 'winning AND losing bids are all evidence');
  assert.ok(a.comps.every(c => c.bid !== 30), 'comps show WINNING bids only');
});

console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
  process.exit(1);
}
