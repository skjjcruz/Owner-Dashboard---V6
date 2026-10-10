// Run with:  node --test js/shared/ask-tools-moves.test.js
// Ask tools: transactions, trade grading, partners, owner profiles, draft.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = p => p;

globalThis.S = {
    currentLeagueId: 'L', myRosterId: 13, myUserId: 'me', season: '2026', currentWeek: 6, platform: 'sleeper',
    leagues: [{ league_id: 'L', name: 'The Psycho League', settings: { draft_rounds: 4, num_teams: 2 }, roster_positions: ['QB', 'WR', 'FLEX'] }],
    leagueUsers: [{ user_id: 'me', display_name: 'skjjcruz', metadata: { team_name: 'Dirty Mike' } }, { user_id: 'them', display_name: 'Gas', metadata: { team_name: 'GasMan612' } }],
    rosters: [
        { roster_id: 13, owner_id: 'me', players: ['jt', 'sutton', 'dak', 'nabers'], starters: ['dak', 'sutton'], settings: { wins: 4, losses: 1 } },
        { roster_id: 2, owner_id: 'them', players: ['puka', 'mcb', 'henry', 'kincaid'], starters: [], settings: { wins: 1, losses: 4 } },
    ],
    players: {
        jt: { full_name: 'Jonathan Taylor', position: 'RB', team: 'IND', age: 27 },
        sutton: { full_name: 'Courtland Sutton', position: 'WR', team: 'DEN', age: 30 },
        dak: { full_name: 'Dak Prescott', position: 'QB', team: 'DAL', age: 33 },
        nabers: { full_name: 'Malik Nabers', position: 'WR', team: 'NYG', age: 23 },
        puka: { full_name: 'Puka Nacua', position: 'WR', team: 'LAR', age: 25 },
        mcb: { full_name: 'Trey McBride', position: 'TE', team: 'ARI', age: 26 },
        kincaid: { full_name: 'Dalton Kincaid', position: 'TE', team: 'BUF', age: 26 },
        henry: { full_name: 'Derrick Henry', position: 'RB', team: 'BAL', age: 32 },
        fa1: { full_name: 'Tyler Badie', position: 'RB', team: 'DEN', age: 26 },
    },
    tradedPicks: [{ season: '2027', round: 1, roster_id: 2, owner_id: 13, previous_owner_id: 2 }],
    transactions: {
        w5: [
            { transaction_id: 't1', type: 'waiver', status: 'complete', leg: 5, created: Date.UTC(2026, 9, 1), roster_ids: [13], adds: { fa1: 13 }, drops: { sutton: 13 }, settings: { waiver_bid: 37 } },
            { transaction_id: 't2', type: 'free_agent', status: 'complete', leg: 5, created: Date.UTC(2026, 9, 2), roster_ids: [2], adds: { kincaid: 2 }, drops: null },
            { transaction_id: 't3', type: 'waiver', status: 'failed', leg: 5, created: Date.UTC(2026, 9, 1), roster_ids: [2], adds: { fa1: 2 }, settings: { waiver_bid: 20 } },
        ],
    },
};
App.LI = {
    playerScores: { jt: 4288, sutton: 938, dak: 4019, nabers: 6500, puka: 7091, mcb: 2881, kincaid: 2400, henry: 2096, fa1: 410 },
    playerMeta: { puka: { peakYrsLeft: 3 } },
    dhqPickValueFn: (season, round) => Math.round(({ 1: 6000, 2: 3000, 3: 1500, 4: 700 })[round] * Math.pow(0.88, Math.max(0, Number(season) - 2026))),
    dhqPickValues: { 2: { hitRate: 40, starterRate: 60 } },
    tradeHistory: [
        { season: '2025', week: 8, ts: Date.UTC(2025, 9, 20), roster_ids: [13, 2], sides: { 13: { players: ['puka'], picks: [], totalValue: 7091 }, 2: { players: ['jt'], picks: [{ season: '2026', round: 2 }], totalValue: 4288 + 3000 } }, fairness: 97, winner: 2, valueDiff: 197, valueDiffPct: 2.7 },
        { season: '2024', week: 3, ts: Date.UTC(2024, 8, 20), roster_ids: [13, 2], sides: { 13: { players: ['dak'], picks: [], totalValue: 4019 }, 2: { players: ['henry'], picks: [], totalValue: 2096 } }, fairness: 52, winner: 13, valueDiff: 1923, valueDiffPct: 47.8 },
    ],
    ownerProfiles: {
        2: { trades: 2, tradesWon: 0, tradesLost: 1, tradesFair: 1, avgValueDiff: -860, picksAcquired: 1, picksSold: 0, posAcquired: { RB: 2 }, posSold: { WR: 1, QB: 1 }, targetPos: 'RB', dna: 'Balanced', partners: { 13: 2 }, weekTiming: { early: 1, mid: 1, late: 0 }, seasonActivity: { 2024: 1, 2025: 1 } },
    },
    draftOutcomes: [
        { season: '2024', round: 1, pick_no: 1, roster_id: 13, pid: 'nabers', name: 'Malik Nabers', pos: 'WR', isHit: true, isStarter: true, seasonsAvailable: 2, bestTotal: 280.4 },
        { season: '2024', round: 1, pick_no: 2, roster_id: 2, pid: 'x', name: 'Bust Guy', pos: 'RB', isHit: false, isStarter: false, seasonsAvailable: 2, bestTotal: 40 },
        { season: '2025', round: 2, pick_no: 3, roster_id: 2, pid: 'kincaid', name: 'Dalton Kincaid', pos: 'TE', isHit: false, isStarter: true, seasonsAvailable: 1, bestTotal: 150 },
    ],
    hitRateByRound: { 1: { total: 2, hits: 1, starters: 1, rate: 50, eliteRate: 50, bestPos: [{ pos: 'WR', rate: 100, total: 2, starters: 1, hits: 1 }] } },
};
const mine = { tier: 'CONTENDER', window: 'CONTENDING', healthScore: 87, panic: 1, needs: [{ pos: 'TE', urgency: 'deficit' }], strengths: ['WR'], posAssessment: { TE: { status: 'deficit' }, WR: { status: 'surplus', sortedIds: ['nabers', 'sutton'], nflStarterIds: ['nabers'], minQuality: 1 }, RB: { status: 'ok', sortedIds: ['jt'], nflStarterIds: ['jt'], minQuality: 1 } } };
const theirs = { rosterId: 2, teamName: 'GasMan612', tier: 'REBUILDING', window: 'REBUILDING', panic: 3, needs: [{ pos: 'WR', urgency: 'thin' }], strengths: ['TE'], posAssessment: { TE: { status: 'surplus', sortedIds: ['mcb', 'kincaid'], minQuality: 1 }, WR: { status: 'thin', sortedIds: ['puka'] } } };
globalThis.assessTeamFromGlobal = rid => (String(rid) === '13' ? mine : String(rid) === '2' ? theirs : null);
globalThis.assessAllTeamsFromGlobal = () => [Object.assign({ rosterId: 13 }, mine), theirs];
// The shared assessor's builder, simplified: 2027 picks, rounds 1-2.
globalThis.buildPicksByOwner = (rosters, lg, tp) => {
    const out = {};
    rosters.forEach(r => { out[r.roster_id] = []; });
    rosters.forEach(r => [1, 2].forEach(rd => {
        const moved = tp.find(p => Number(p.season) === 2027 && p.round === rd && p.roster_id === r.roster_id && p.owner_id !== r.roster_id);
        out[moved ? moved.owner_id : r.roster_id].push({ year: 2027, round: rd, originalOwnerRid: r.roster_id });
    }));
    return out;
};
globalThis.RookieData = { getProspects: () => [{ rank: 1, name: 'Jeremiah Smith', pos: 'WR', college: 'Ohio State', tierLabel: 'Elite' }, { rank: 2, name: 'Some Back', pos: 'RB' }] };
// A stand-in for DHQ-Shared/trade-engine.js (same function shapes).
App.TradeEngine = {
    fairnessGrade: (give, get) => { const r = get / Math.max(give, 1); return r >= 1.3 ? { grade: 'A+', label: 'Steal' } : r >= 0.95 ? { grade: 'B', label: 'Fair' } : { grade: 'F', label: 'Bad Trade' }; },
    calcOwnerPosture: () => ({ key: 'SELLER', label: 'Active Seller', desc: 'Moving assets for futures.' }),
    calcPsychTaxes: () => [{ name: 'Need Fulfillment', impact: 12 }, { name: 'Endowment Effect', impact: -6 }],
    calcAcceptanceLikelihood: () => 42,
    calcComplementarity: () => 50,
};
require('./ask-tools.js');
require('./ask-tools-moves.js');
const T = App.AskTools;
const run = (n, a) => T.run(n, a);

test('registers the five tools with descriptions and schemas', () => {
    const names = T.defs().map(d => d.name);
    for (const n of ['get_transactions', 'evaluate_trade', 'find_trade_partners', 'get_owner_profile', 'get_draft_info']) assert.ok(names.includes(n), n);
    T.defs().forEach(d => { assert.ok(d.description.length > 20); assert.equal(d.parameters.type, 'object'); });
});

test('parses picks in the ways people write them', () => {
    const P = T._moves.parsePick;
    assert.deepEqual(P('2027 1st'), { year: 2027, round: 1, slot: null, from: null });
    assert.equal(P('2026 1.03').slot, 3);
    assert.equal(P("Gas's 2027 2nd").from, 2);
    assert.equal(P('2027 round 3').round, 3);
    assert.equal(P('Puka Nacua'), null);
});

test('get_transactions: waiver claim with the FAAB bid; failed claims are left out', async () => {
    const r = await run('get_transactions', { type: 'waiver' });
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].faab_bid, 37);
    assert.equal(r.rows[0].adds[0].name, 'Tyler Badie');
    assert.match(r.rows[0].team, /Dirty Mike/);
    const who = await run('get_transactions', { player: 'Dalton Kincaid' });
    assert.equal(who.rows[0].type, 'free_agent');
    assert.match(who.rows[0].team, /GasMan612/);
});

test('get_transactions: every trade I\'ve made, with who won and my record', async () => {
    const r = await run('get_transactions', { type: 'trade', team: 'me' });
    assert.equal(r.rows.length, 2);
    assert.deepEqual(r.trade_record_for_team, { won: 1, lost: 0, fair: 1 });
    assert.equal(r.rows[0].season, '2025');
    assert.equal(r.rows[0].result_for_team, 'fair');
    const taylor = await run('get_transactions', { type: 'trade', team: 'me', player: 'Taylor' });
    assert.equal(taylor.rows.length, 1);
    assert.ok(taylor.rows[0].sides.some(s => s.got_picks.includes('2026 2nd')));
});

test('evaluate_trade: values, grade, acceptance, DNA and plain-English psychology', async () => {
    const r = await run('evaluate_trade', { give: ['Malik Nabers'], get: ['Trey McBride', '2027 1st'] });
    assert.equal(r.partner.includes('GasMan612'), true);
    assert.equal(r.totals.give, 6500);
    assert.equal(r.totals.get, 2881 + Math.round(6000 * 0.88));
    assert.equal(r.grade.grade, 'B'); // 8161 / 6500 = 1.26 in the stand-in's bands
    assert.equal(r.accept_chance_pct, 42);
    assert.equal(r.partner_posture.key, 'SELLER');
    assert.ok(r.psychology.some(p => p.effect === 'helps' && /fills a position they need/.test(p.means)));
    assert.ok(r.fit.for_me.some(l => /McBride fills a TE need/.test(l)));
    // The 2027 1st Gas "has" was traded to me already: flagged.
    assert.ok((r.warnings || []).some(w => /2027 1st/.test(w)));
    assert.ok(r.partner_dna.key);
});

test('evaluate_trade: unknown names get a plain reason', async () => {
    const r = await run('evaluate_trade', { give: ['Zzyzx Qwerty'], get: ['Puka Nacua'] });
    assert.match(r.error, /Couldn't match: Zzyzx Qwerty/);
});

test('find_trade_partners: buy a TE from the team with a surplus that needs my WR', async () => {
    const r = await run('find_trade_partners', {});
    assert.equal(r.mode, 'buy');
    assert.deepEqual(r.want, ['TE']);
    const p = r.partners[0];
    assert.match(p.team, /GasMan612/);
    assert.equal(p.targets[0].name, 'Trey McBride');
    assert.ok(p.you_could_offer[0].startsWith('Courtland Sutton'));
    assert.match(p.why, /surplus at TE/);
    assert.equal(p.past_trades_with_you, 2);
    const s = await run('find_trade_partners', { mode: 'sell' });
    assert.equal(s.mode, 'sell');
    assert.deepEqual(s.partners[0].their_needs, ['WR']);
});

test('get_owner_profile: record, partners, positions and biggest win/loss', async () => {
    const r = await run('get_owner_profile', { team: 'Gas' });
    assert.match(r.team, /GasMan612/);
    assert.equal(r.trading.lost, 1);
    assert.equal(r.trading.partners[0].trades, 2);
    assert.deepEqual(r.trading.positions_bought, ['RB 2']);
    assert.equal(r.recent_trades.length, 2);
    assert.equal(r.trades_with_me, 2);
    assert.equal(r.this_season.free_agent_adds, 1);
    assert.equal(r.team_read.window, 'REBUILDING');
});

test('get_draft_info: picks owned, values, results, hit rates, prospects', async () => {
    const r = await run('get_draft_info', {});
    const me = r.picks_by_team.find(t => /Dirty Mike/.test(t.team));
    assert.equal(me.count, 3);
    assert.ok(me.picks.some(p => /2027 1st \(from GasMan612/.test(p)));
    assert.equal(r.pick_values.by_round[0].mid, Math.round(6000 * 0.88));
    assert.equal(r.draft_results.rows[0].season, '2025');
    assert.equal(r.draft_results.rows.find(x => x.player === 'Malik Nabers').result, 'hit (elite season)');
    assert.equal(r.hit_rates_by_round[0].starter_rate_pct, 50);
    assert.equal(r.rookie_prospects[0].name, 'Jeremiah Smith');
    const one = await run('get_draft_info', { team: 'Gas', section: 'results' });
    assert.equal(one.draft_results.found, 2);
    assert.equal(one.picks, undefined);
});
