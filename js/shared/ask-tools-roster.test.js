// Run with:  node --test js/shared/ask-tools-roster.test.js
// roster_plan + get_waiver_plan (one drop rule, IR fallback values),
// fixtures modeled on the Psycho League, roster 13, week 5 (live Sleeper
// data and DHQ values read 2026-10-10; see the research in cuts.md and
// free-agency.md).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = p => p;
const _st = setTimeout;
globalThis.setTimeout = (f, ms, ...a) => { const t = _st(f, ms, ...a); if (t && t.unref) t.unref(); return t; };

const STARTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DL', 'LB', 'DB', 'IDP_FLEX'];
const BENCH = ['hill', 'knight', 'davis', 'carr', 'donald', 'hendrickson', 'fitz', 'gsmith', 'vidal'];
const STARTERS = ['dak', 'jt', 'henry', 'pickens', 'adams', 'andrews', 'meyers', 'staff', 'santos', 'hemingway', 'oluokun', 'masses', 'lassiter'];
const P = (full_name, position, team, extra) => Object.assign({ full_name, position, team, active: true, status: 'Active' }, extra || {});
globalThis.S = {
    currentLeagueId: 'L', myRosterId: 13, myUserId: 'me', season: '2026', currentWeek: 5, platform: 'sleeper',
    nflState: { season: '2026', season_type: 'regular', week: 5, display_week: 5, season_start_date: '2026-09-09' },
    leagues: [{
        league_id: 'L', name: 'Psycho', roster_positions: STARTS.concat(BENCH.map(() => 'BN')),
        settings: { type: 2, waiver_budget: 3012, waiver_bid_min: 13, waiver_type: 2, reserve_slots: 10, reserve_allow_out: 0, reserve_allow_doubtful: 0, reserve_allow_na: 0, reserve_allow_sus: 0, reserve_allow_cov: 1, reserve_allow_dnr: 0, taxi_slots: 10, taxi_years: 3, taxi_deadline: 4, taxi_allow_vets: 1, playoff_week_start: 15 },
    }],
    leagueUsers: [{ user_id: 'me', display_name: 'skjjcruz', metadata: { team_name: 'Dirty Mike' } }, { user_id: 'them', display_name: 'Malibooch' }],
    rosters: [
        { roster_id: 13, owner_id: 'me', players: STARTERS.concat(BENCH, ['garrett', 'conner', 'levis', 'wright', 'ponds']), starters: STARTERS.slice(), reserve: ['garrett', 'conner'], taxi: ['levis', 'wright', 'ponds'], settings: { waiver_budget_used: 1297 } },
        { roster_id: 2, owner_id: 'them', players: ['anderson', 'hutch', 'crosby', 'hunter', 'bosa', 'jha', 'jones', 'kamara', 'montgomery', 'mcgowan'], starters: [], settings: { waiver_budget_used: 413 } },
    ],
    players: {
        dak: P('Dak Prescott', 'QB', 'DAL', { depth_chart_order: 1, age: 33, years_exp: 10 }),
        staff: P('Matthew Stafford', 'QB', 'LAR', { depth_chart_order: 1, age: 38, years_exp: 17 }),
        jt: P('Jonathan Taylor', 'RB', 'IND', { depth_chart_order: 1, age: 27, years_exp: 7 }),
        henry: P('Derrick Henry', 'RB', 'BAL', { depth_chart_order: 1, age: 32, years_exp: 10 }),
        pickens: P('George Pickens', 'WR', 'DAL', { age: 25, years_exp: 4 }),
        adams: P('Davante Adams', 'WR', 'LAR', { age: 33, years_exp: 12 }),
        meyers: P('Jakobi Meyers', 'WR', 'JAX', { age: 29, years_exp: 7 }),
        andrews: P('Mark Andrews', 'TE', 'BAL', { age: 31, years_exp: 8 }),
        santos: P('Cairo Santos', 'K', 'CHI', { age: 34, years_exp: 12 }),
        hemingway: P('Tonka Hemingway', 'DL', 'LV', { age: 24, years_exp: 2 }),
        oluokun: P('Foyesade Oluokun', 'LB', 'JAX', { age: 31, years_exp: 8 }),
        masses: P('Hezekiah Masses', 'DB', 'LV', { age: 22, years_exp: 1 }),
        lassiter: P('Kamari Lassiter', 'DB', 'HOU', { age: 23, years_exp: 2 }),
        hill: P('Justice Hill', 'RB', 'BAL', { depth_chart_order: 2, age: 28, years_exp: 7 }),
        knight: P('Zonovan Knight', 'RB', 'ARI', { depth_chart_order: 3, age: 25, years_exp: 4 }),
        davis: P('Isaiah Davis', 'RB', 'NYJ', { depth_chart_order: 2, age: 24, years_exp: 2 }),
        vidal: P('Kimani Vidal', 'RB', 'LAC', { depth_chart_order: 3, age: 25, years_exp: 2 }),
        carr: P('Derek Carr', 'QB', null, { age: 34, years_exp: 11, injury_status: 'NA' }),
        donald: P('Aaron Donald', 'DL', 'LAR', { depth_chart_order: 1, age: 35, years_exp: 12 }),
        hendrickson: P('Trey Hendrickson', 'DL', 'BAL', { depth_chart_order: 1, age: 31, years_exp: 9, injury_status: 'Out' }),
        fitz: P('Ryan Fitzgerald', 'K', 'CAR', { age: 26, years_exp: 1 }),
        gsmith: P('Genesis Smith', 'DB', 'LAC', { age: 21, years_exp: 0 }),
        garrett: P('Myles Garrett', 'DL', 'LAR', { status: 'Inactive', injury_status: 'IR', age: 30, years_exp: 9, depth_chart_order: 1 }),
        conner: P('James Conner', 'RB', 'ARI', { status: 'Inactive', injury_status: 'IR', age: 31, years_exp: 9, depth_chart_order: 4 }),
        levis: P('Will Levis', 'QB', 'NYJ', { age: 27, years_exp: 3 }),
        wright: P('Jacardia Wright', 'RB', 'SEA', { age: 26, years_exp: 1, injury_status: 'Out' }),
        ponds: P("D'Angelo Ponds", 'DB', 'NYJ', { age: 21, years_exp: 0 }),
        // Rival + league peers (values/ppg/ages as read from DHQ 2026-10-10)
        anderson: P('Will Anderson', 'DL', 'HOU', { age: 25 }), hutch: P('Aidan Hutchinson', 'DL', 'DET', { age: 26 }),
        crosby: P('Maxx Crosby', 'DL', 'LV', { age: 29 }), hunter: P('Danielle Hunter', 'DL', 'HOU', { age: 31 }),
        bosa: P('Nick Bosa', 'DL', 'SF', { age: 28 }), jha: P('Josh Hines-Allen', 'DL', 'JAX', { age: 29 }),
        jones: P('Aaron Jones', 'RB', 'MIN', { age: 31 }), kamara: P('Alvin Kamara', 'RB', 'NO', { age: 31 }),
        montgomery: P('David Montgomery', 'RB', 'HOU', { age: 29 }),
        mcgowan: P('Seth McGowan', 'RB', 'IND', { depth_chart_order: 2, age: 23 }),
        // Free agents
        parrish: P('Jacob Parrish', 'DB', 'TB', { depth_chart_order: 1, age: 22, years_exp: 1 }),
        bennett: P('Stetson Bennett', 'QB', 'LAR', { depth_chart_order: 2, age: 28, years_exp: 3 }),
        howell: P('Sam Howell', 'QB', 'DAL', { depth_chart_order: 2, age: 26, years_exp: 4 }),
        hawes: P('Hawes', 'TE', 'BUF', { age: 25, years_exp: 2 }),
        cle: P('Cleveland Browns', 'DEF', 'CLE'),
        sneed: P("L'Jarius Sneed", 'DB', 'TEN'), willlee: P('Will Lee', 'DB', 'NYJ'), mccollum: P('Zyon McCollum', 'DB', 'TB'), robertson: P('Mike Robertson', 'DB', 'ARI'), oldclaim: P('Offseason Guy', 'DB', 'MIA'),
    },
};
const SC = {
    dak: 4012, staff: 2090, jt: 4285, henry: 2141, pickens: 2625, adams: 1528, meyers: 1452, andrews: 1364, santos: 484, hemingway: 1204, oluokun: 1307, masses: 2241, lassiter: 1416,
    hill: 318, knight: 100, davis: 62, vidal: 304, carr: 300, hendrickson: 799, fitz: 90, gsmith: 1299, garrett: 0, conner: 0, levis: 2039,
    anderson: 3811, hutch: 2194, crosby: 1673, hunter: 1426, bosa: 1782, jha: 1326, jones: 1070, kamara: 784, montgomery: 1362,
    parrish: 1252, bennett: 350, howell: 250, hawes: 269, cle: 500,
};
const M = (ppg, age, extra) => Object.assign({ ppg, age, statusCode: 'active' }, extra || {});
App.LI = {
    playerScores: SC,
    playerMeta: {
        garrett: M(15.7, 30, { statusCode: 'inactive', statusReason: 'Inactive', peakYrsLeft: 0 }), conner: M(8.7, 31, { statusCode: 'inactive', peakYrsLeft: 0 }),
        anderson: M(11.6, 25), hutch: M(8.6, 26), crosby: M(8.1, 29), hunter: M(7.4, 31), bosa: M(8.1, 28), jha: M(6.5, 29), hendrickson: M(4.3, 31, { peakYrsLeft: 0 }), hemingway: M(5.9, 24, { peakYrsLeft: 5 }),
        jones: M(9.4, 31), kamara: M(7.7, 31), montgomery: M(8.2, 29), henry: M(15.9, 32, { peakYrsLeft: 0 }), hill: M(3.4, 28, { peakYrsLeft: 0, trend: -43 }), jt: M(22, 27),
        knight: M(0.7, 25, { peakYrsLeft: 0, trend: -92 }), davis: M(0.4, 24, { peakYrsLeft: 1, trend: -92 }), vidal: M(4.7, 25, { peakYrsLeft: 0, trend: -54 }),
        fitz: M(10.6, 26, { peakYrsLeft: 9 }), carr: M(0, 34, { peakYrsLeft: 0 }), gsmith: M(7.5, 21, { peakYrsLeft: 6 }),
        parrish: M(13.5, 22, { peakYrsLeft: 6 }), bennett: M(1, 28, { peakYrsLeft: 2 }), howell: M(1, 26, { peakYrsLeft: 2 }), hawes: M(0.7, 25, { peakYrsLeft: 2 }),
    },
};
const PROJ = { davis: 6.5, vidal: 5.7, hill: 5.6, donald: 4.2, parrish: 7, hawes: 0.7, jt: 22.4, henry: 22.3 };
App.DhqProj = { get: pid => (PROJ[pid] != null ? { median: PROJ[pid] } : null) };
globalThis.assessTeamFromGlobal = rid => (String(rid) === '13' ? { tier: 'CONTENDER', window: 'CONTENDING', needs: [{ pos: 'TE', urgency: 'deficit' }, { pos: 'DB', urgency: 'thin' }], strengths: [] } : null);
// Bids: offseason claims (before 2026-09-09) at the $13 minimum and a $300
// outlier, then in-season DB wins (Sneed $47, Will Lee $55, McCollum $65,
// Robertson $101) plus other in-season bids.
const D = (m, d) => Date.UTC(2026, m - 1, d);
const W = (pid, bid, leg, created, status, rid) => ({ type: 'waiver', status: status || 'complete', leg, created, roster_ids: [rid || 2], adds: { [pid]: rid || 2 }, settings: { waiver_bid: bid } });
const TX = [];
for (let i = 0; i < 30; i++) TX.push(W(i % 2 ? 'oldclaim' : 'knight', 13, 1, D(4, 1 + i % 28)));
TX.push(W('oldclaim', 300, 1, D(8, 20)));
TX.push(W('sneed', 47, 2, D(9, 16)), W('willlee', 55, 3, D(9, 23)), W('mccollum', 65, 4, D(9, 30)), W('robertson', 101, 5, D(10, 7)));
for (let i = 0; i < 14; i++) TX.push(W('hawes', 20 + i * 5, 2 + (i % 4), D(9, 16 + i)));
TX.push(W('robertson', 90, 5, D(10, 7), 'failed', 13));
globalThis.WrTxns = { getCached: () => TX.filter(t => t.status !== 'failed'), getFailedWaivers: () => TX.filter(t => t.status === 'failed') };
require('./faab-engine.js');
const AT = require('./ask-tools.js');
require('./ask-tools-players.js');
const AR = require('./ask-tools-roster.js');

test('registers roster_plan and get_waiver_plan', () => {
    const names = AT.defs().map(d => d.name);
    assert.ok(names.includes('roster_plan'));
    assert.ok(names.includes('get_waiver_plan'));
});

test('IR fallback: an Inactive (IR) player valued 0 gets a peer value, never 0', () => {
    const g = AR.valueRead('garrett');
    assert.equal(g.value_source, 'ir_fallback');
    assert.equal(g.value, 1426);               // median of Crosby 1673, Hunter 1426, Hines-Allen 1326, Bosa 1782, Hendrickson 799
    assert.match(g.basis, /Maxx Crosby 1673/);
    const c = AR.valueRead('conner');
    assert.equal(c.value_source, 'ir_fallback');
    assert.equal(c.value, 1070);               // Jones 1070, Kamara 784, Montgomery 1362, Henry 2141, Hill 318
    const d = AR.valueRead('donald');
    assert.equal(d.value_source, 'unscored');
    assert.equal(d.value, null);
    assert.deepEqual(AR.valueRead('knight'), { value: 100, value_source: 'dhq' });
});

test('roster_plan: full roster, Carr first, IR and taxi never cut, value gaps kept', async () => {
    const r = await AT.run('roster_plan', {});
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.roster_count, { active: 22, max: 22, open: 0, taxi: 3, taxi_max: 10, ir: 2, ir_max: 10 });
    assert.equal(r.decision, 'full');
    assert.match(r.recommendation, /Derek Carr/);
    const cuts = r.cut_candidates.map(c => c.player);
    assert.equal(cuts[0], 'Derek Carr');
    assert.deepEqual(cuts.slice(1, 4), ['Ryan Fitzgerald', 'Zonovan Knight', 'Isaiah Davis']);   // backup K (Santos starts), then the low-upside RBs
    for (const never of ['Myles Garrett', 'James Conner', 'Aaron Donald', 'Will Levis', 'Jacardia Wright', "D'Angelo Ponds", 'Justice Hill', 'Genesis Smith', 'Trey Hendrickson', 'Dak Prescott', 'Cairo Santos']) assert.ok(!cuts.includes(never), never + ' must not be a cut');
    const keep = Object.fromEntries(r.keep_despite_low_value.map(k => [k.player, k]));
    assert.equal(keep['Myles Garrett'].value_source, 'ir_fallback');
    assert.equal(keep['Myles Garrett'].value, 1426);
    assert.match(keep['Myles Garrett'].reason, /IR stash/);
    assert.match(keep['Justice Hill'].reason, /Handcuff.*Derrick Henry/);
    assert.match(keep['Aaron Donald'].reason, /NFL role/);
    assert.equal(keep['Genesis Smith'], undefined);           // 1,299 isn't "low value"; he's kept by the young-upside rule
    assert.match(AR.cutPlan(S.rosters[0]).keep.find(k => k.pid === 'gsmith').reason, /Young upside/);
    assert.match(keep['Jacardia Wright'].reason, /taxi slot/);
});

test('roster_plan: OUT is not IR-eligible here; taxi deadline passed; taxi is not depth', async () => {
    const r = await AT.run('roster_plan', {});
    const hend = r.ir_moves.find(m => m.player === 'Trey Hendrickson');
    assert.equal(hend.eligible, false);
    assert.match(hend.why, /reserve_allow_out = 0/);
    assert.ok(!r.ir_moves.some(m => m.player === 'Myles Garrett'));
    const gs = r.taxi_moves.find(m => m.player === 'Genesis Smith');
    assert.equal(gs.eligible, false);
    assert.match(gs.why, /deadline was week 4/);
    assert.equal(r.depth.RB.active_healthy, 6);   // JT, Henry, Hill, Knight, Davis, Vidal; not Conner (IR) or Wright (taxi)
    assert.ok(r.method.length > 50 && r.rules_applied.length >= 5);
});

test('roster_plan: IR-eligible bench player goes to IR first; an ineligible IR player must be activated', async () => {
    const me = S.rosters[0];
    const saved = JSON.stringify({ players: me.players, reserve: me.reserve });
    S.players.etienne = P('Travis Etienne', 'RB', 'NO', { injury_status: 'IR', age: 27 });
    SC.etienne = 0;
    me.players = me.players.concat('etienne');
    let r = await AT.run('roster_plan', {});
    assert.equal(r.decision, 'cut_now');                   // 23 active of 22
    assert.match(r.recommendation, /Travis Etienne to IR/);
    const et = r.ir_moves.find(m => m.player === 'Travis Etienne');
    assert.equal(et.eligible, true);
    S.players.conner.injury_status = null;               // healthy but still on IR
    r = await AT.run('roster_plan', {});
    assert.equal(r.decision, 'activate_from_ir');
    assert.match(r.recommendation, /James Conner/);
    S.players.conner.injury_status = 'IR';
    Object.assign(me, JSON.parse(saved));
    delete S.players.etienne;
});

test('get_waiver_plan: every add paired with an active-roster drop; handcuffs; TE is a trade', async () => {
    const r = await AT.run('get_waiver_plan', {});
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.decision, 'add');
    const names = r.adds.map(x => x.player.name);
    assert.ok(names.includes('Sam Howell') && names.includes('Stetson Bennett'), names.join(','));
    assert.ok(names.includes('Jacob Parrish'));
    assert.ok(!names.includes('Cleveland Browns'), 'no DEF slot');
    const active = new Set(['hill', 'knight', 'davis', 'carr', 'donald', 'hendrickson', 'fitz', 'gsmith', 'vidal'].map(p => S.players[p].full_name));
    const used = new Set();
    r.adds.forEach(x => {
        assert.ok(x.drop && x.drop.player, x.player.name + ' has no drop');
        assert.ok(active.has(x.drop.player), x.drop.player + ' is not an active bench player');
        assert.ok(!used.has(x.drop.player), 'drop reused');
        used.add(x.drop.player);
        assert.notEqual(x.drop.value_source, 'ir_fallback');
    });
    assert.equal(r.adds.find(x => x.player.name === 'Sam Howell').drop.player, 'Derek Carr');
    assert.ok(r.adds.find(x => x.player.name === 'Stetson Bennett').handcuff);
    for (const never of ['Justice Hill', 'Aaron Donald', 'Genesis Smith', 'Trey Hendrickson', 'Myles Garrett', 'Will Levis']) assert.ok(!used.has(never), never);
    assert.ok(r.do_not_add.some(d => /TE is a deficit.*trade/.test(d.why)));
    assert.ok(r.evidence.some(e => /Jonathan Taylor's backup Seth McGowan is on .*trade/.test(e)));
    assert.match(r.recommendation, /^Claim .* and drop /);
});

test('get_waiver_plan: bids from in-season comps only, within the pace cap', async () => {
    const r = await AT.run('get_waiver_plan', {});
    assert.equal(r.faab.left, 1715);
    assert.equal(r.faab.min_bid, 13);
    assert.equal(r.faab.weeks_left, 9);
    assert.equal(r.faab.per_week, 191);
    assert.equal(r.faab.max_single_bid, 286);
    const par = r.adds.find(x => x.player.name === 'Jacob Parrish');
    const compNames = par.bid.comps.map(c => c.player);
    assert.ok(!compNames.includes('Offseason Guy'), 'offseason claims excluded');
    assert.deepEqual(par.bid.comps.map(c => c.bid), [101, 65, 55, 47]);
    assert.ok(par.bid.open >= 13 && par.bid.open <= par.bid.max && par.bid.max <= 286);
    assert.ok(par.bid.max >= 60, 'max reaches the position median of in-season wins (' + par.bid.max + ')');
    const ben = r.adds.find(x => x.player.name === 'Stetson Bennett');
    assert.equal(ben.bid.open, 13);                        // stash-level: league minimum
    assert.ok(r.evidence.some(e => /31 offseason claims left out/.test(e)));
});

test('get_waiver_plan: DEF filtered when the league has no DEF slot; open spot means no drop', async () => {
    const def = await AT.run('get_waiver_plan', { position: 'DEF' });
    assert.equal(def.decision, 'no_slot');
    assert.equal(def.adds.length, 0);
    const lg = S.leagues[0];
    lg.roster_positions = lg.roster_positions.concat('BN');
    const r = await AT.run('get_waiver_plan', { position: 'DB' });
    assert.equal(r.adds[0].player.name, 'Jacob Parrish');
    assert.equal(r.adds[0].drop.player, null);
    assert.match(r.adds[0].drop.why, /open active spot/);
    lg.roster_positions.pop();
});

test('get_waiver_bid: offseason claims are excluded from the bid history', async () => {
    const r = await AT.run('get_waiver_bid', { player: 'Jacob Parrish' });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.in_season_bids.offseason_claims_excluded, 31);
    assert.equal(r.in_season_bids.count, 19);
    assert.equal(r.in_season_bids.since, '2026-09-09');
    assert.deepEqual(r.recent_winning_bids_at_position.map(c => c.player), ['Mike Robertson', 'Zyon McCollum', 'Will Lee', "L'Jarius Sneed"]);
    assert.match(r.based_on, /in-season/);
});

// Owner ruling 2026-10-10: "Davis is a keeper, Breece Hall is out this week, he's up as an RB2."
test('roster_plan: next man up is never a cut (Breece Hall out, Isaiah Davis moves up)', async () => {
    // As Sleeper lists it live: the injured starter drops to depth 5, Allen is 1, Davis 2.
    S.players.breece = P('Breece Hall', 'RB', 'NYJ', { depth_chart_order: 5, age: 25, injury_status: 'Out' });
    S.players.allen = P('Braelon Allen', 'RB', 'NYJ', { depth_chart_order: 1, age: 22 });
    App.LI.playerScores.breece = 3900;
    S.players = Object.assign({}, S.players);   // new object: the depth index rebuilds
    try {
        const r = await AT.run('roster_plan', {});
        assert.ok(!r.cut_candidates.some(c => c.player === 'Isaiah Davis'), 'Davis must not be a cut');
        const k = r.keep_despite_low_value.find(x => x.player === 'Isaiah Davis');
        assert.ok(k, JSON.stringify(r.keep_despite_low_value.map(x => x.player)));
        assert.match(k.reason, /Next man up: Breece Hall \(Out\) is out, so he moves up to NYJ RB2/);
    } finally { delete S.players.breece; delete S.players.allen; delete App.LI.playerScores.breece; S.players = Object.assign({}, S.players); }
});
