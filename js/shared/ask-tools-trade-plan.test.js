// Run with:  node --test js/shared/ask-tools-trade-plan.test.js
// trade_plan and the verdict-first evaluate_trade on a fixture shaped like
// the live Psycho League (Sleeper 1312100327931019264, checked 2026-10-10):
// superflex; the member (skjjcruz, 3-1) holds his 2029 1st and TWhy123's
// 2027 2nd but not his own 2027 or 2028 1st; bwit13 is 1-3, sold Olave,
// G. Wilson, LaPorta and Dobbins for 8 picks this season and listed Jordan
// Love, Barkley, Pittman and Addison. Values are a snapshot (Love 3,574).
// The trade engine stand-in copies the real formulas from
// dhq-shared/trade-engine.js (posture, psych taxes, acceptance, grade).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = p => p;

const R = (roster_id, owner_id, players, wins, losses, fpts) => ({ roster_id, owner_id, players, starters: [], settings: { wins, losses, fpts } });
const P = (full_name, position, team, age, depth_chart_order) => ({ full_name, position, team, age, depth_chart_order });
globalThis.S = {
    currentLeagueId: 'PSY', myRosterId: 13, myUserId: 'u13', season: '2026', currentWeek: 5, platform: 'sleeper',
    drafts: [{ season: '2026', status: 'complete' }],
    leagues: [{ league_id: 'PSY', name: 'The Psycho League', status: 'in_season', settings: { draft_rounds: 3, num_teams: 6 }, roster_positions: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'] }],
    leagueUsers: [['u13', 'skjjcruz'], ['u5', 'bwit13'], ['u4', 'TWhy123'], ['u7', 'Malibooch'], ['u9', 'DJAlexB'], ['u16', 'MangaMaw']].map(([user_id, display_name]) => ({ user_id, display_name })),
    rosters: [
        R(13, 'u13', ['stafford', 'andrews', 'pickens', 'jt', 'jwill', 'kick'], 3, 1, 520),
        R(5, 'u5', ['love', 'barkley', 'pittman', 'addison', 'dart', 'jsmith'], 1, 3, 380),
        R(4, 'u4', ['olave', 'gwilson'], 4, 0, 560),
        R(7, 'u7', ['laporta'], 1, 3, 400),
        R(9, 'u9', ['dobbins', 'lawrence'], 2, 2, 450),
        R(16, 'u16', [], 0, 4, 350),
    ],
    players: {
        stafford: P('Matthew Stafford', 'QB', 'LAR', 38, 1), andrews: P('Mark Andrews', 'TE', 'BAL', 31, 1), pickens: P('George Pickens', 'WR', 'DAL', 25, 1),
        jt: P('Jonathan Taylor', 'RB', 'IND', 27, 1), jwill: P('Jaylen Williams', 'RB', 'ATL', 23, 2), kick: P('Brandon Aubrey', 'K', 'DAL', 30, 1),
        love: P('Jordan Love', 'QB', 'GB', 27, 1), barkley: P('Saquon Barkley', 'RB', 'PHI', 29, 1), pittman: P('Michael Pittman', 'WR', 'IND', 29, 1),
        addison: P('Jordan Addison', 'WR', 'MIN', 24, 2), dart: Object.assign(P('Jaxson Dart', 'QB', 'NYG', 23, 4), { injury_status: 'IR' }), jsmith: P('Jonnu Smith', 'TE', 'PIT', 31, 1),
        olave: P('Chris Olave', 'WR', 'NO', 26, 1), gwilson: P('Garrett Wilson', 'WR', 'NYJ', 26, 1), laporta: P('Sam LaPorta', 'TE', 'DET', 25, 1),
        dobbins: P('J.K. Dobbins', 'RB', 'DEN', 27, 1), lawrence: P('Trevor Lawrence', 'QB', 'JAX', 27, 1),
    },
    // Sleeper traded_picks: roster_id = original owner, owner_id = holder now.
    tradedPicks: [
        { season: '2027', round: 1, roster_id: 13, owner_id: 4 }, { season: '2028', round: 1, roster_id: 13, owner_id: 9 },
        { season: '2027', round: 2, roster_id: 13, owner_id: 7 }, { season: '2027', round: 3, roster_id: 13, owner_id: 9 },
        { season: '2028', round: 2, roster_id: 13, owner_id: 16 }, { season: '2028', round: 3, roster_id: 13, owner_id: 16 },
        { season: '2027', round: 2, roster_id: 4, owner_id: 13 },
        { season: '2027', round: 1, roster_id: 4, owner_id: 5 }, { season: '2028', round: 1, roster_id: 4, owner_id: 5 }, { season: '2029', round: 1, roster_id: 4, owner_id: 5 },
        { season: '2027', round: 2, roster_id: 7, owner_id: 5 }, { season: '2028', round: 3, roster_id: 7, owner_id: 5 },
        { season: '2027', round: 1, roster_id: 9, owner_id: 5 }, { season: '2028', round: 2, roster_id: 9, owner_id: 5 }, { season: '2027', round: 3, roster_id: 16, owner_id: 5 },
    ],
};
const pk = (season, round, from, to) => ({ season, round, roster_id: from, owner_id: to, previous_owner_id: from });
S.transactions = { w5: [
    { transaction_id: 'b1', type: 'trade', status: 'complete', leg: 5, created: Date.UTC(2026, 9, 9), roster_ids: [5, 4], adds: { olave: 4, gwilson: 4 }, drops: { olave: 5, gwilson: 5 }, draft_picks: [pk('2027', 1, 4, 5), pk('2028', 1, 4, 5), pk('2029', 1, 4, 5)] },
    { transaction_id: 'b2', type: 'trade', status: 'complete', leg: 3, created: Date.UTC(2026, 8, 23), roster_ids: [5, 7], adds: { laporta: 7 }, drops: { laporta: 5 }, draft_picks: [pk('2027', 2, 7, 5), pk('2028', 3, 7, 5)] },
    { transaction_id: 'b3', type: 'trade', status: 'complete', leg: 1, created: Date.UTC(2026, 8, 8), roster_ids: [5, 9], adds: { dobbins: 9 }, drops: { dobbins: 5 }, draft_picks: [pk('2027', 1, 9, 5), pk('2028', 2, 9, 5), pk('2027', 3, 16, 5)] },
] };
App.LI = {
    playerScores: { stafford: 2090, andrews: 2400, pickens: 5200, jt: 4288, jwill: 2600, kick: 300, love: 3574, barkley: 3100, pittman: 1900, addison: 3300, dart: 2800, jsmith: 900, olave: 4800, gwilson: 4700, laporta: 3900, dobbins: 1500, lawrence: 4128 },
    playerMeta: { stafford: { peakYrsLeft: 0 }, andrews: { peakYrsLeft: 0 }, pickens: { peakYrsLeft: 5 }, jt: { peakYrsLeft: 0 }, jwill: { peakYrsLeft: 5 }, love: { peakYrsLeft: 5 }, barkley: { peakYrsLeft: 0 }, pittman: { peakYrsLeft: 1 }, addison: { peakYrsLeft: 6 }, dart: { peakYrsLeft: 8 }, lawrence: { peakYrsLeft: 5 }, jsmith: { peakYrsLeft: 0 } },
    // Engine-shaped pick curve: by slot (1 = best), 12% a year from 2026.
    dhqPickValueFn: (season, round, slot) => {
        const top = { 1: 7000, 2: 3000, 3: 1500 }[round], bottom = { 1: 4000, 2: 2000, 3: 900 }[round];
        return Math.round((top - (top - bottom) * ((slot || 3) - 1) / 5) * Math.pow(0.88, Math.max(0, Number(season) - 2026)));
    },
    tradeHistory: [],
    ownerProfiles: {},
};
const A = {
    13: { tier: 'CONTENDER', window: 'CONTENDING', panic: 1, needs: [{ pos: 'QB', urgency: 'thin' }], strengths: ['RB'], posAssessment: {} },
    5: { tier: 'CROSSROADS', window: 'CROSSROADS', panic: 4, needs: [], strengths: [], posAssessment: {} },
    9: { tier: 'CROSSROADS', window: 'CROSSROADS', panic: 1, needs: [], strengths: [], posAssessment: {} },
};
globalThis.assessTeamFromGlobal = rid => A[String(rid)] || { tier: 'CROSSROADS', window: 'CROSSROADS', panic: 1, needs: [], strengths: [], posAssessment: {} };
globalThis.assessAllTeamsFromGlobal = () => S.rosters.map(r => Object.assign({ rosterId: r.roster_id }, globalThis.assessTeamFromGlobal(r.roster_id)));
// The shared assessor's builder (team-assess.js buildPicksByOwner), same
// logic: 2027-2029 (the 2026 draft is done), rounds 1-3.
const realBuilder = (rosters, lg, tp) => {
    const out = {};
    rosters.forEach(r => {
        out[r.roster_id] = [];
        [2027, 2028, 2029].forEach(y => { for (let rd = 1; rd <= 3; rd++) {
            if (!tp.some(p => Number(p.season) === y && p.round === rd && p.roster_id === r.roster_id && p.owner_id !== p.roster_id)) out[r.roster_id].push({ year: y, round: rd, originalOwnerRid: r.roster_id });
            tp.filter(p => Number(p.season) === y && p.round === rd && p.owner_id === r.roster_id && p.owner_id !== p.roster_id).forEach(p => out[r.roster_id].push({ year: y, round: rd, originalOwnerRid: p.roster_id }));
        } });
    });
    return out;
};
globalThis.buildPicksByOwner = realBuilder;
// Trade engine stand-in: the real formulas.
const POSTURES = {
    DESPERATE: { key: 'DESPERATE', label: 'Desperate', desc: 'Panic-mode — will overpay for immediate help.' },
    BUYER: { key: 'BUYER', label: 'Active Buyer', desc: 'Contender upgrading — open to deals, fair value required.' },
    NEUTRAL: { key: 'NEUTRAL', label: 'Neutral', desc: 'No strong directional push. Fair offers only.' },
    SELLER: { key: 'SELLER', label: 'Active Seller', desc: 'Moving assets for futures. Buy at a discount.' },
    LOCKED: { key: 'LOCKED', label: 'Locked In', desc: 'Satisfied roster, high attachment. Very hard to move.' },
};
App.TradeEngine = {
    calcOwnerPosture(a, dna) {
        if (!a) return POSTURES.NEUTRAL;
        if (a.panic >= 4) return POSTURES.DESPERATE;
        if (a.tier === 'REBUILDING' || dna === 'ACCEPTOR') return POSTURES.SELLER;
        if (a.tier === 'ELITE' && a.panic <= 1) return POSTURES.LOCKED;
        if ((a.tier === 'CONTENDER' || a.tier === 'CROSSROADS') && a.panic >= 2) return POSTURES.BUYER;
        return POSTURES.NEUTRAL;
    },
    calcPsychTaxes(mine, theirs, dna, posture) {
        const t = [];
        const e = { FLEECER: 10, DOMINATOR: 28, STALWART: 20, ACCEPTOR: 5, DESPERATE: 15, NONE: 12 }[dna] || 12;
        t.push({ name: 'Endowment Effect', impact: -Math.round(e / 2) });
        if (theirs && theirs.panic >= 3) t.push({ name: 'Panic Premium', impact: 8 + (theirs.panic - 2) * 6 });
        const need = (theirs.needs || []).slice(0, 3).map(n => n.pos);
        if (need.some(p => (mine.strengths || []).includes(p))) t.push({ name: 'Need Fulfillment', impact: 12 });
        t.push(mine.window !== theirs.window ? { name: 'Window Alignment', impact: 8 } : { name: 'Window Friction', impact: -5 });
        if (posture && posture.key === 'LOCKED') t.push({ name: 'Locked Roster Tax', impact: -12 });
        else if (posture && posture.key === 'SELLER') t.push({ name: 'Seller Momentum', impact: 10 });
        return t;
    },
    calcAcceptanceLikelihood(give, get, dna, taxes, mA, tA, opts) {
        let l = 50;
        const a = Number(give) || 0, b = Number(get) || 0;
        if (a > 0 || b > 0) {
            const mx = Math.max(a, b, 1), raw = (taxes || []).reduce((s, x) => s + (Number(x.impact) || 0), 0);
            const cx = Math.max(0, ((opts && opts.totalPieces) || 0) - 4) * 5;
            l = 50 + Math.round(((a - b) + ((raw - cx) / 200) * mx) / mx * 200);
        }
        return Math.round(Math.max(5, Math.min(95, l)));
    },
    fairnessGrade(my, their) {
        const r = their / Math.max(my, 1);
        return r >= 1.3 ? { grade: 'A+', label: 'Steal' } : r >= 1.15 ? { grade: 'A', label: 'Clear Win' } : r >= 1.05 ? { grade: 'B+', label: 'Slight Win' } : r >= 0.95 ? { grade: 'B', label: 'Fair' } : r >= 0.85 ? { grade: 'C', label: 'Slight Loss' } : r >= 0.75 ? { grade: 'D', label: 'Overpay' } : { grade: 'F', label: 'Bad Trade' };
    },
    calcComplementarity: () => 0,
};
// Sleeper's trade block (league_players feed): bwit13's listings.
globalThis.fetch = async (url, opts) => {
    assert.match(String(url), /api\.sleeper\.app\/graphql/);
    assert.match(JSON.parse(opts.body).query, /league_players/);
    return { ok: true, json: async () => ({ data: { league_players: ['love', 'barkley', 'pittman', 'addison'].map(player_id => ({ player_id, metadata: null, settings: { otb: 1, otb_added_at: Date.UTC(2026, 9, 9) } })) } }) };
};
require('./ask-tools.js');
require('./ask-tools-moves.js');
const T = App.AskTools;
const run = (n, a) => T.run(n, a);
const PICKY = /\b(1st|2nd|3rd|pick|picks|round)\b/i;

test('bwit13 reads REBUILDING (sold for picks, vets listed, 1-3) and a seller, not "desperate"', async () => {
    const it = await T._moves.ownerIntent(S.rosters[1]);
    assert.equal(it.mode, 'REBUILDING');
    assert.ok(it.evidence.some(e => /8 draft picks/.test(e)), it.evidence.join(' | '));
    // Love (QB, 27) is listed but is not a veteran; Barkley (RB 29) and Pittman (WR 29) are.
    assert.deepEqual(it._vetsListed.map(pid => S.players[pid].full_name).sort(), ['Michael Pittman', 'Saquon Barkley']);
    const r = await run('evaluate_trade', { give: ['2029 1st'], get: ['Jordan Love'] });
    assert.equal(r.partner_posture.key, 'SELLER');
    assert.ok(!r.psychology.some(p => p.factor === 'Panic Premium'), 'a rebuilder\'s panic is not a reason to pay for help now');
    assert.equal(r.verdict.partner_mode, 'rebuilding');
});

test('pick slots: the worst team\'s next-draft 1st projects early; later drafts are discounted, the next one is not', () => {
    const pv = T._moves.pickValue;
    assert.equal(T._moves.nextDraftYear(), 2027);
    const manga = pv(2027, 1, null, 16), bwit = pv(2027, 1, null, 5), dj = pv(2027, 1, null, 9), twhy = pv(2027, 1, null, 4);
    assert.ok(manga > bwit && bwit > dj && dj > twhy, [manga, bwit, dj, twhy].join(' > '));
    assert.equal(manga, 7000);                          // slot 1, no year discount
    assert.equal(pv(2027, 1, 3), 5800);                 // a mid 2027 1st: no discount
    assert.equal(pv(2028, 1, null, 16), Math.round(5800 * 0.88));    // later draft: mid, less 12%
    assert.equal(pv(2029, 1, null, 13), Math.round(5800 * 0.88 * 0.88));
});

test('my assets are only what I own; the 2027 1st I traded is never offered', async () => {
    const r = await run('trade_plan', { target: 'Jordan Love', give: ['2027 1st'] });
    assert.ok(!r.error, r.error);
    assert.deepEqual(r.my_assets.picks.filter(p => p.round === 1).map(p => p.year), [2029]);
    assert.ok(r.my_assets.picks.some(p => p.year === 2027 && p.round === 2 && /TWhy123/.test(p.original_owner)));
    assert.ok(r.do_not_offer.some(d => /2027 1st/.test(d.asset) && /TWhy123 holds it/.test(d.reason)), JSON.stringify(r.do_not_offer));
    r.offers.forEach(o => assert.ok(!o.give.some(g => /^2027 1st/.test(g)), o.give.join(' + ')));
    assert.ok(['counter', 'pass'].includes(r.decision), r.decision);
    const e = await run('evaluate_trade', { give: ['2027 1st'], get: ['Jordan Love'] });
    assert.equal(e.verdict.decision, 'pass');
    assert.match(e.verdict.call, /TWhy123 does/);
});

test('a pick with an unknown holder is never treated as mine (ownership not loaded)', async () => {
    globalThis.buildPicksByOwner = undefined;
    try {
        const e = await run('evaluate_trade', { give: ['2029 1st'], get: ['Jordan Love'] });
        assert.equal(e.headliner.offer_has_it, false);
        assert.equal(e.verdict.confidence, 'low');
        assert.ok(e.warnings.some(w => /Couldn't confirm you own 2029 1st/.test(w)));
        const p = await run('trade_plan', { target: 'Jordan Love' });
        assert.deepEqual(p.my_assets.picks, []);
        assert.equal(p.offers.length, 0);
        assert.equal(p.decision, 'no_fit');
        assert.equal(p.confidence, 'low');
    } finally { globalThis.buildPicksByOwner = realBuilder; }
});

// Owner ruling 2026-10-10 (Love test): a rebuilder won't trade a young
// starting QB for a 1st three drafts away; it takes a next-draft 1st plus
// a little something (a 2nd or a nice player).
test('young SF starting QB from a rebuilder: a next-draft 1st plus a little more; a far-off 1st is not the headliner', async () => {
    const r = await run('trade_plan', { target: 'Jordan Love' });
    assert.ok(!r.error, r.error);
    assert.match(r.price_floor.headliner_needed, /^a 2027 1st \(a rebuilder also wants a 2nd or a solid young player on top\)/);
    assert.match(r.price_floor.rule, /superflex/);
    // The member's only 1st is a 2029: nothing he owns meets the price.
    assert.equal(r.offers.length, 0);
    assert.equal(r.decision, 'no_fit');
    assert.match(r.recommendation, /Your 2029 1st is too far off for a rebuilder/);
    assert.match(r.recommendation, /2027 1st/);
    const far = await run('evaluate_trade', { give: ['2029 1st', '2027 2nd from TWhy123'], get: ['Jordan Love'] });
    assert.equal(far.headliner.offer_has_it, false);
    assert.ok(far.headliner.notes.some(n => /too far off/.test(n)), JSON.stringify(far.headliner));
    // The rule itself: next-draft 1st alone isn't enough from a rebuilder; plus a 2nd it is.
    const { headlinerMet, headlinerRuleFor } = T._moves;
    const rule = headlinerRuleFor({ kind: 'player', pid: 'love', pos: 'QB', age: 27, value: 3574 });
    const t = { value: 3574 };
    const p27 = { kind: 'pick', round: 1, year: 2027, holder: 13, label: '2027 1st' }, s27 = { kind: 'pick', round: 2, year: 2027, holder: 13, label: '2027 2nd' };
    const p28 = { kind: 'pick', round: 1, year: 2028, holder: 13, label: '2028 1st' }, s28 = { kind: 'pick', round: 2, year: 2028, holder: 13, label: '2028 2nd' };
    assert.equal(headlinerMet(rule, t, [p27], 13, 'REBUILDING').ok, false);
    assert.equal(headlinerMet(rule, t, [p27, s27], 13, 'REBUILDING').ok, true);
    assert.equal(headlinerMet(rule, t, [p28, s27], 13, 'REBUILDING').ok, false, 'a 2028 1st spends its add standing in for a 2027');
    assert.equal(headlinerMet(rule, t, [p28, s27, s28], 13, 'REBUILDING').ok, true);
    assert.equal(headlinerMet(rule, t, [p27], 13, 'CONTENDING').ok, true, 'the add is a rebuilder\'s ask');
    // A young WR (Pickens) alone doesn't buy a QB: no headliner.
    const e = await run('evaluate_trade', { give: ['George Pickens'], get: ['Jordan Love'] });
    assert.equal(e.headliner.offer_has_it, false);
    assert.equal(e.verdict.decision, 'counter');
    assert.ok(e.accept_chance_pct <= 10);
});

test('Stafford + Andrews for Love: a rebuilder doesn\'t want aging vets, low chance, counter with my 2029 1st', async () => {
    const r = await run('trade_plan', { target: 'Jordan Love', give: ['Matthew Stafford', 'Mark Andrews'] });
    assert.ok(!r.error, r.error);
    assert.equal(r.partner.mode, 'rebuilding');
    assert.equal(r.decision, 'pass');
    assert.ok(r.your_offer.accept_chance_pct <= 10, String(r.your_offer.accept_chance_pct));
    assert.equal(r.your_offer.headliner_met, false);
    for (const n of ['Matthew Stafford', 'Mark Andrews']) assert.ok(r.do_not_offer.some(d => d.asset.startsWith(n)), n);
    assert.ok(r.partner.wont_take.some(w => /age cliff/.test(w)));
    r.offers.forEach(o => assert.ok(!o.give.some(g => /Stafford|Andrews|Jonathan Taylor/.test(g)), o.give.join(' + ')));
    assert.match(r.recommendation, /^Don't send Matthew Stafford \+ Mark Andrews/);
    assert.match(r.recommendation, /2027 1st/);
    // Same deal through evaluate_trade: the same answer.
    const e = await run('evaluate_trade', { give: ['Matthew Stafford', 'Mark Andrews'], get: ['Jordan Love'] });
    assert.equal(e.verdict.decision, 'counter');
    assert.ok(e.verdict.accept_chance_pct <= 10);
    assert.match(e.partner_view.verdict, /not appealing/);
});

test('acceptance runs on what the partner values: piling on vets doesn\'t raise it', async () => {
    const e = await run('evaluate_trade', { give: ['Matthew Stafford', 'Mark Andrews', 'Jonathan Taylor'], get: ['Jordan Love'] });
    // 8,778 of raw value for a 3,574 player: the value-only curve says 95%.
    assert.equal(e.accept_chance_on_value_only_pct, 95);
    assert.ok(e.accept_chance_pct <= 10);
    assert.ok(e.partner_view.worth_to_them < e.partner_view.what_they_give_up_as_they_see_it);
    // With no headliner cap in play: a young piece the rebuilder wants beats a bigger raw pile of vets.
    const young = await run('evaluate_trade', { give: ['Jaylen Williams'], get: ['Michael Pittman'] });
    const vets = await run('evaluate_trade', { give: ['Mark Andrews', 'Matthew Stafford'], get: ['Michael Pittman'] });
    assert.ok(2090 + 2400 > 2600, 'the vets are more raw value');
    assert.ok(young.accept_chance_pct >= vets.accept_chance_pct, young.accept_chance_pct + ' vs ' + vets.accept_chance_pct);
});

test('2029 1st alone for Love: a rebuilder won\'t take a 1st three drafts away for a young starting QB', async () => {
    const e = await run('evaluate_trade', { give: ['2029 1st'], get: ['Jordan Love'] });
    assert.equal(Object.keys(e)[0], 'verdict');
    assert.equal(e.verdict.decision, 'counter');
    assert.equal(e.headliner.offer_has_it, false);
    assert.ok(e.verdict.accept_chance_pct <= 10, String(e.verdict.accept_chance_pct));
    assert.match(e.grade.basis, /raw value/);
    assert.ok(!e.balance, 'the fix is the headliner, not balance');
});

test('balance when the member overpays a rebuilder: their veterans, never their picks', async () => {
    const e = await run('evaluate_trade', { give: ['Jaylen Williams'], get: ['Michael Pittman'] });
    assert.ok(e.balance && e.balance.options.length, JSON.stringify(e.balance));
    assert.match(e.balance.how, /won't give picks back/);
    e.balance.options.forEach(o => assert.doesNotMatch(o, PICKY));
    assert.ok(e.balance.options[0].includes('on their block'));
});

test('listed vets cost their owner less; Love (listed, not a vet) only the listing discount', async () => {
    const r = await run('trade_plan', { target: 'Saquon Barkley' });
    assert.ok(!r.error, r.error);
    assert.ok(r.price_floor.their_price <= Math.round(3100 * 0.5), String(r.price_floor.their_price));
    assert.match(r.price_floor.headliner_needed, /^none/);
    const love = await run('trade_plan', { target: 'Jordan Love' });
    assert.equal(love.price_floor.their_price, Math.round(3574 * 0.85));
});

test('Trevor Lawrence (DJAlexB, contending) for my 2029 1st + TWhy123\'s 2027 2nd: at market', async () => {
    const e = await run('evaluate_trade', { give: ['2029 1st', '2027 2nd from TWhy123'], get: ['Trevor Lawrence'] });
    assert.ok(!e.error, e.error);
    assert.equal(e.headliner.offer_has_it, true);
    assert.equal(e.verdict.decision, 'offer');
    assert.equal(e.verdict.partner_mode, 'contending');   // DJAlexB bought Dobbins with three picks this season
    assert.equal(e.warnings, undefined);
});

test('trade_plan answer shape and comparables from this season\'s league trades', async () => {
    const r = await run('trade_plan', { partner: 'bwit13' });
    assert.ok(!r.error, r.error);
    assert.deepEqual(Object.keys(r).slice(0, 3), ['decision', 'confidence', 'recommendation']);
    assert.match(r.evidence[0], /most valuable player on .*trade block/);
    assert.ok(r.comparables.length >= 1);
    assert.ok(r.rules_applied.length >= 5 && typeof r.method === 'string');
    assert.ok(r.offers.length <= 3);
    const bad = await run('trade_plan', { target: 'Jordan Love', partner: 'DJAlexB' });
    assert.match(bad.error, /is on bwit13/);
});
