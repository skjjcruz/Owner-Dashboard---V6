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

// ── estimate(): the one bid estimate every surface prints (bidfix) ────
test('estimate: the range is the model\'s own band around rec, never a second formula', () => {
  const txns = [];
  for (let w = 1; w <= 6; w++) { txns.push(bidTxn(2, 8 + w, w), bidTxn(3, 20 + w, w), bidTxn(4, 5, w, true)); }
  const args = { league: faabLeague(), myRosterId: 1, txns, playersData: faabPlayers, targetPos: 'RB' };
  const e = Faab.estimate({ ...args, dhq: 4200 });
  const a = Faab.analyze({ ...args, targetStrength: 0.7 });
  assert.strictEqual(e.basis, 'faab-model');
  assert.strictEqual(e.estimate, true);
  assert.strictEqual(e.sug, a.rec.bid, 'dhq 4200 → strength 0.7 → the same rec analyze() gives');
  assert.ok(e.lo <= e.sug && e.sug <= e.hi, 'band brackets the recommendation');
  assert.ok(e.lo >= a.minBid && e.hi <= a.myLeft, 'band is legal money');
  // The band is read off the same win curve: lo first clears 45%, hi first clears 80%.
  assert.ok(a.band.lo === e.lo && a.band.hi === e.hi);
  assert.strictEqual(e.analysis.rec.bid, e.sug, 'the full analysis rides along for FAAB Command');
  assert.ok(Array.isArray(e.analysis.rivals) && e.analysis.rivals.length === 3);
  // In this fixture 80% odds are out of reach under the spend cap, so the top
  // of the band IS the cap — and the text says so (review N7).
  assert.strictEqual(e.hiCapped, true);
  assert.strictEqual(e.hi, Math.round(a.myLeft * 0.65), 'hi = the SPEND_CAP of my remaining');
  assert.strictEqual(Faab.formatRange(e), '$' + e.lo + '–' + e.hi + ' (your cap)');
  assert.strictEqual(Faab.formatRange(e, '-', { capLabel: false }), '$' + e.lo + '-' + e.hi, 'compact cells drop the words');
});

test('needAt: a single-slot position that is filled is not a need (K / DEF / 1-QB) — review S4', () => {
  const lg = { roster_positions: ['QB', 'RB', 'RB', 'K', 'BN'] };
  const pd = { k1: { position: 'K' }, k2: { position: 'K', injury_status: 'IR' }, q1: { position: 'QB' } };
  assert.strictEqual(Faab.needAt({ players: ['k1'] }, 'K', lg, pd), 'LOW', 'one healthy kicker for one K slot → not in the market');
  assert.strictEqual(Faab.needAt({ players: ['k2'] }, 'K', lg, pd), 'HIGH', 'his only kicker is on IR → a real hole');
  assert.strictEqual(Faab.needAt({ players: [] }, 'K', lg, pd), 'HIGH');
  assert.strictEqual(Faab.needAt({ players: ['q1'] }, 'QB', lg, pd), 'LOW', '1-QB league, starter healthy, no values → not in the market');
  // With values: a filled single slot engages (MED) only for an upgrade.
  const val = { q1: 3000, k1: 900 };
  const ctxUp = { playerValue: pid => val[pid] || 0, targetValue: 4000 };
  const ctxDown = { playerValue: pid => val[pid] || 0, targetValue: 2500 };
  assert.strictEqual(Faab.needAt({ players: ['q1'] }, 'QB', lg, pd, ctxUp), 'MED', 'target out-values his starter → he may bid');
  assert.strictEqual(Faab.needAt({ players: ['q1'] }, 'QB', lg, pd, ctxDown), 'LOW', 'not an upgrade → sits it out');
  // Multi-slot positions keep the old read (exactly filled = one injury from a hole).
  assert.strictEqual(Faab.needAt({ players: ['rb1', 'rb2'] }, 'RB', lg, faabPlayers), 'HIGH');
  // A kicker with every rival's K slot filled is uncontested → the league minimum.
  const kl = faabLeague();
  kl.roster_positions = ['QB', 'RB', 'RB', 'WR', 'K', 'BN'];
  kl.rosters.forEach(r => { r.players = r.players.concat('k1'); });
  const e = Faab.estimate({ league: kl, myRosterId: 1, txns: [], playersData: { ...faabPlayers, k1: { position: 'K' } }, targetPos: 'K', dhq: 2000 });
  assert.deepStrictEqual([e.sug, e.lo, e.hi], [1, 1, 1]);
  assert.strictEqual(e.analysis.rivals.filter(r => r.engaged).length, 0);
  // …unless he is an upgrade on their kickers: then they're in the market (MED).
  const up = Faab.estimate({ league: kl, myRosterId: 1, txns: [], playersData: { ...faabPlayers, k1: { position: 'K' } }, targetPos: 'K', dhq: 2000, playerValue: () => 800 });
  assert.ok(up.analysis.rivals.filter(r => r.engaged).every(r => r.need === 'MED') && up.analysis.rivals.some(r => r.engaged));
  assert.ok(up.sug > 1, 'an upgrade is contested');
});

test('limits: out of FAAB is told apart from "no FAAB" (review S3)', () => {
  const lg = faabLeague(); lg.settings.waiver_bid_min = 5; lg.rosters[0].settings.waiver_budget_used = 97;
  assert.deepStrictEqual(Faab.limits({ league: lg, myRosterId: 1 }), { budget: 100, minBid: 5, myLeft: 3, exhausted: true });
  assert.strictEqual(Faab.estimate({ league: lg, myRosterId: 1, txns: [], playersData: faabPlayers, targetPos: 'RB', dhq: 3000 }), null);
  assert.strictEqual(Faab.limits({ league: { settings: {} }, myRosterId: 1 }), null, 'no budget → not a FAAB league');
  assert.strictEqual(Faab.limits({ league: lg, myRosterId: 1, minBidOverride: 2 }).exhausted, false, 'GM Strategy minimum override wins');
});

test('estimate: rec is the smallest bid clearing the target (binary search = the old linear scan)', () => {
  const txns = [];
  for (let w = 1; w <= 6; w++) { txns.push(bidTxn(2, 8 + w, w), bidTxn(3, 20 + w, w)); }
  for (const s of [0.2, 0.5, 0.7, 0.95]) {
    const a = Faab.analyze({ league: faabLeague(), myRosterId: 1, txns, playersData: faabPlayers, targetPos: 'RB', targetStrength: s });
    // Rebuild winPct from the published rivals to check rec independently.
    const winPct = B => { let p = 1; for (const r of a.rivals) { if (!r.engaged) continue; const sg = Math.max(2, 0.25 * r.estBid, 0.12 * a.marketBid); const u = 1 / (1 + Math.exp(-(B - r.estBid) / sg)); const pe = r.need === 'HIGH' ? 0.85 : 0.5; p *= (1 - pe) + pe * u; } return Math.min(0.97, Math.round(p * 100) / 100); };
    if (!a.rec.capped) {
      assert.ok(winPct(a.rec.bid) >= 0.6, 'rec clears the target');
      assert.ok(a.rec.bid === a.minBid || winPct(a.rec.bid - 1) < 0.6, 'and one dollar less does not');
    }
    assert.ok(a.band.lo <= a.rec.bid && a.rec.bid <= a.band.hi);
  }
});

test('estimate: uncontested → the band collapses onto the league minimum; no budget → null', () => {
  const lg = faabLeague();
  lg.settings.waiver_bid_min = 13;
  lg.rosters = lg.rosters.filter(r => r.roster_id === 1);           // nobody else to bid
  const e = Faab.estimate({ league: lg, myRosterId: 1, txns: [], playersData: faabPlayers, targetPos: 'RB', dhq: 3000 });
  assert.deepStrictEqual([e.sug, e.lo, e.hi], [13, 13, 13]);
  assert.strictEqual(Faab.formatRange(e), '$13', 'a collapsed band prints as one number');
  assert.strictEqual(e.coldStart, true);
  const broke = faabLeague();
  broke.settings.waiver_bid_min = 13;
  broke.rosters[0].settings.waiver_budget_used = 95;                 // $5 left, $13 minimum
  assert.strictEqual(Faab.estimate({ league: broke, myRosterId: 1, txns: [], playersData: faabPlayers, targetPos: 'RB', dhq: 3000 }), null, 'no legal bid left → no estimate');
  assert.strictEqual(Faab.estimate({ league: { settings: { waiver_budget: 0 } }, myRosterId: 1, txns: [], targetPos: 'RB', dhq: 3000 }), null, 'not a FAAB league');
});

test('estimate: a $10,000 guillotine budget resolves in one pass (search, not a walk)', () => {
  const lg = faabLeague();
  lg.settings.waiver_budget = 10000; lg.settings.waiver_bid_min = 10;
  lg.rosters = Array.from({ length: 18 }, (_, i) => ({ roster_id: i + 1, owner_id: 'u' + (i + 1), settings: { waiver_budget_used: 1000 + i * 200 }, players: ['rb1'] }));
  const txns = [];
  for (let w = 1; w <= 6; w++) for (let r = 2; r <= 18; r++) txns.push(bidTxn(r, 200 + r * 30 + w * 10, w));
  const t = Date.now();
  const e = Faab.estimate({ league: lg, myRosterId: 1, txns, playersData: faabPlayers, targetPos: 'RB', dhq: 5900 });
  assert.ok(Date.now() - t < 50, 'fast');
  assert.ok(e.lo >= 10 && e.lo <= e.sug && e.sug <= e.hi && e.hi <= e.myLeft);
});

console.log('\n' + (failed ? 'FAIL' : 'PASS') + ' ' + (passed + failed) + ' tests — ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  failures.forEach(f => console.error('\n✗ ' + f.name + '\n' + (f.e && f.e.stack)));
  process.exit(1);
}
