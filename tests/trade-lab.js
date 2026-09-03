// ══════════════════════════════════════════════════════════════════
// tests/trade-lab.js — Trade Lab suite (owner rulings 2026-09-03)
//
// Covers the lab-only behavioral model: the ruled 243 bars, the points
// ledger's optimal fill and league-relative soft spots, the intent
// classifier's paper-run thresholds, and the terrain-model invariants
// (the lab shell mirrors production, production never references lab
// files, the gate and noindex are present). No network: feeds are
// injected fixtures.
// ══════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');

let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg) {
    if (cond) { passed++; } else { failed++; failures.push('  ✗ ' + msg); }
}
function test(name, fn) {
    try { fn(); } catch (e) { failed++; failures.push('  ✗ ' + name + ' threw: ' + e.message); }
}

const g = {};
new Function('window', fs.readFileSync('js/lab/points-ledger.js', 'utf8'))(g);
new Function('window', fs.readFileSync('js/lab/intent-reads.js', 'utf8'))(g);

(async () => {
    // ── Ruled bars ──
    test('bars: the ruled 2026-09-03 table', () => {
        const B = g.WrLabPointsLedger.BARS;
        const total = Object.values(B).reduce((s, v) => s + v, 0);
        ok(total === 243, 'bars sum to exactly 243 (got ' + total + ')');
        ok(B.DL === 22 && B.LB === 14 && B.DB === 21 && B.IDP === 18, 'defensive trim applied (DL22/LB14/DB21/IDP18)');
        ok(B.QB === 22 && B.RB === 39 && B.WR === 40 && B.FLEX === 28, 'freed points moved to QB/RB/WR/FLEX');
    });

    test('slot shape: superflex + IDP league parses', () => {
        const s = g.WrLabPointsLedger._slotShape(
            ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', 'K',
                'DL', 'DL', 'DL', 'LB', 'LB', 'DB', 'DB', 'DB', 'IDP_FLEX', 'IDP_FLEX', 'IDP_FLEX', 'BN', 'BN', 'IR', 'TAXI']);
        ok(s.dedicated.QB === 1 && s.dedicated.RB === 2 && s.dedicated.WR === 3 && s.dedicated.DB === 3, 'dedicated counts');
        ok(s.flexN === 3 && s.sfN === 1 && s.idpN === 3, 'flex/superflex/idp-flex counts');
    });

    // ── Points ledger on a fixture league ──
    const scoring = { pass_td: 4, rush_td: 6, rec: 0.5 };
    const proj = {
        qbA: { pass_td: 34 },            // 8/wk
        qbB: { pass_td: 17 },            // 4/wk
        rbA: { rush_td: 17 },            // 6/wk
        wrA: { rec: 170 },               // 5/wk
        wrB: { rec: 34 },                // 1/wk
        noProj: {},
    };
    const prevStats = { fallbackRb: { rush_td: 8, gp: 8 } }; // 6/game
    const fetchJson = url => {
        if (url.includes('/projections/')) return Promise.resolve(proj);
        if (url.includes('/stats/')) return Promise.resolve(prevStats);
        throw new Error('unexpected fetch ' + url);
    };
    const league = {
        league_id: 'LAB_TEST', season: '2026',
        scoring_settings: scoring,
        roster_positions: ['QB', 'WR', 'FLEX', 'BN'],
    };
    const positions = { qbA: 'QB', qbB: 'QB', rbA: 'RB', wrA: 'WR', wrB: 'WR', noProj: 'WR', fallbackRb: 'RB' };
    const rosters = [
        { roster_id: 1, players: ['qbA', 'wrA', 'rbA', 'wrB'] },
        { roster_id: 2, players: ['qbB', 'wrB', 'fallbackRb', 'noProj'] },
    ];
    const led = await g.WrLabPointsLedger.load({ league, rosters, posOf: p => positions[p], fetchJson });

    test('ledger: optimal fill takes the best per slot', () => {
        const t1 = led.teams[1];
        ok(Math.abs(t1.groupPts.QB - 8) < 1e-9, 'QB slot gets the 8/wk QB');
        ok(Math.abs(t1.groupPts.WR - 5) < 1e-9, 'WR slot gets the 5/wk WR');
        ok(Math.abs(t1.groupPts.FLEX - 6) < 1e-9, 'FLEX takes the best remaining (the RB), not a worse WR');
    });
    test('ledger: fallback and zero paths', () => {
        const t2 = led.teams[2];
        ok(Math.abs(t2.groupPts.FLEX - 6) < 1e-9, 'no projection → last season actuals per game played');
        ok(t2.groupPts.WR < 1.01, 'a no-feed player scores 0, never invented');
    });
    test('ledger: relative reads and soft spots', () => {
        const t2 = led.teams[2];
        ok(t2.rank.QB === 2 && led.teams[1].rank.QB === 1, 'group ranks ordered by group points');
        ok(t2.soft.includes('QB') || t2.soft.includes('WR'), 'soft spots are the lowest league-relative groups');
        ok(led.teams[1].pctOfBar > t2.pctOfBar, 'stronger roster shows the higher share of pace');
    });
    test('ledger: one load per league (session cache)', () => {
        const again = g.WrLabPointsLedger.load({ league, rosters, posOf: p => positions[p], fetchJson: () => { throw new Error('must not refetch'); } });
        ok(again && typeof again.then === 'function', 'second load returns the cached promise without refetching');
    });

    // ── Intent reads on a fixture league (paper-run thresholds) ──
    const iLeague = {
        league_id: 'INTENT_TEST', season: '2026', previous_league_id: 'PREV',
        settings: { waiver_budget: 100 },
    };
    const iRosters = [
        { roster_id: 1, owner_id: 'winU', settings: { waiver_budget_used: 40 } },   // strong, capital spent
        { roster_id: 2, owner_id: 'rebU', settings: { waiver_budget_used: 10 } },   // weak, stockpiling
        { roster_id: 3, owner_id: 'quietU', settings: { waiver_budget_used: 0 } },  // near-zero activity
        { roster_id: 4, owner_id: 'midU', settings: { waiver_budget_used: 20 } },   // middling
    ];
    // Premium picks: rebU holds his own 6 plus winU's next-year 1st and 2nd (8/6).
    const tradedPicks = [];
    ['2027'].forEach(season => [1, 2].forEach(round => tradedPicks.push({ season, round, roster_id: 1, owner_id: 2 })));
    const txnWeek = uidRids => uidRids.map(rid => ({ status: 'complete', type: 'waiver', roster_ids: [rid] }));
    const prevRosters = iRosters.map(r => ({ roster_id: r.roster_id, owner_id: r.owner_id }));
    const iFetch = url => {
        if (url.includes('/traded_picks')) return Promise.resolve(tradedPicks);
        if (url.includes('/league/PREV/rosters')) return Promise.resolve(prevRosters);
        if (url.includes('/transactions/')) {
            // every prev-season week: actives transact, quietU never does
            return Promise.resolve(url.includes('/league/PREV/')
                ? txnWeek([1, 1, 2, 2, 4]) : txnWeek([1, 2]));
        }
        throw new Error('unexpected fetch ' + url);
    };
    const iLedger = { teams: { 1: { pctOfBar: 0.81 }, 2: { pctOfBar: 0.53 }, 3: { pctOfBar: 0.77 }, 4: { pctOfBar: 0.72 } } };
    const intent = await g.WrLabIntentReads.read({ league: iLeague, rosters: iRosters, ledger: iLedger, fetchJson: iFetch });

    test('intent: the four classes fall out of behavior alone', () => {
        ok(intent.byRosterId[1].cls === 'win_now', 'strong roster + spent capital reads win-now (got ' + intent.byRosterId[1].cls + ')');
        ok(intent.byRosterId[2].cls === 'rebuilding', 'weak roster + 8/6 premium picks reads rebuilding (got ' + intent.byRosterId[2].cls + ')');
        ok(intent.byRosterId[3].cls === 'caretaker', 'near-zero activity reads caretaker (got ' + intent.byRosterId[3].cls + ')');
        ok(intent.byRosterId[4].cls === 'competing', 'middling everything reads competing (got ' + intent.byRosterId[4].cls + ')');
    });
    test('intent: receipts and soft lines only — no banners', () => {
        ok(intent.byRosterId[2].receipts.some(r => r.includes('8/6')), 'rebuilder receipt shows the pick stockpile');
        const lines = Object.values(intent.byRosterId).map(r => r.softLine.toLowerCase());
        ok(lines.every(l => !l.includes('rebuild') || l.includes('future')), 'soft lines speak behavior, not class labels');
        ok(Object.values(intent.byRosterId).every(r => r.softLine && r.softLine.length < 60), 'every owner carries a short soft line');
    });

    // ── Terrain-model invariants ──
    test('shell: the lab mirrors production and production never loads lab code', () => {
        const lab = fs.readFileSync('trade-lab.html', 'utf8');
        const idx = fs.readFileSync('index.html', 'utf8');
        ok(lab.includes('TRADE LAB GATE') && lab.includes("u !== 'skjjcruz' && u !== 'bigloco'"), 'owner gate present');
        ok(lab.includes('noindex'), 'noindex meta present');
        ok(lab.includes('js/trade-calc-lab.js') && !/js\/trade-calc\.js/.test(lab), 'lab loads the lab engine, never production trade-calc.js');
        ok(lab.includes('js/lab/points-ledger.js') && lab.includes('js/lab/intent-reads.js') && lab.includes('js/shared/qb-trade-rules-v2.js'), 'lab modules wired');
        ok(lab.includes('>LAB<'), 'corner tag reads LAB');
        ok(!idx.includes('trade-calc-lab') && !idx.includes('js/lab/'), 'production index.html references no lab file');
        const deploy = fs.readFileSync('scripts/build-deploy.cjs', 'utf8');
        ok(deploy.includes("'trade-lab.html'"), 'deploy build processes the lab entry');
    });
    test('engine: lab file carries the wiring, production engine untouched', () => {
        const labEng = fs.readFileSync('js/trade-calc-lab.js', 'utf8');
        const prodEng = fs.readFileSync('js/trade-calc.js', 'utf8');
        ok(labEng.includes('WrLabPointsLedger') && labEng.includes('WrLabIntentReads') && labEng.includes('WrQbTradeRulesV2'), 'lab engine wires ledger, intent and v2 QB rules');
        ok((labEng.match(/\/\/ LAB/g) || []).length >= 8, 'every lab edit is tagged for the P3 graft');
        ok(!prodEng.includes('WrLabPointsLedger') && !prodEng.includes('labModel'), 'production trade-calc.js has zero lab code');
    });

    console.log('');
    if (failures.length) console.log(failures.join('\n') + '\n');
    const status = failed > 0 ? '✗' : '✓';
    console.log(`${status} trade-lab: ${passed + failed} checks — ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('✗ trade-lab suite crashed:', e.message); process.exit(1); });
