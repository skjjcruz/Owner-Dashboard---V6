// Run with:  node --test js/shared/fa-board-role.test.js
// The shared Free Agency action board (js/free-agency.js, the plain-JS part
// above the UDFA craze — the same function the Flash Brief calls): role
// check, FAAB-only bid estimates, and the estimate label.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'free-agency.js'), 'utf8');
const head = src.slice(0, src.indexOf('    // ── UDFA craze'));

// Sleeper's published weekly lines (the recommendation truth gate): every
// fixture player but 'unknown' has one.
const LINES = { starter: 17.2, backup: 6.1, back: 9.4, k1: 8, qb2: 15, rb9: 11 };
const weeklyProj = () => ({ displayWeek: () => 3, projectPlayer: (pid) => (LINES[pid] != null ? { points: { median: LINES[pid] } } : null) });

function load(scores, extraWindow) {
    const extra = extraWindow || {};
    const app = Object.assign({ LI: { playerScores: scores }, normPos: p => p, WeeklyProj: weeklyProj() }, extra.App || {});
    const window = Object.assign({ WR: {}, S: {} }, extra, { App: app });
    const ctx = vm.createContext({ window, console, localStorage: { getItem: () => null } });
    // Boot script (the bid model), then the pure helper, exactly as index.html
    // and the "fa" module group order them.
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'faab-engine.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'waiver-tools.js'), 'utf8'), ctx);
    vm.runInContext(head, ctx);
    return ctx;
}

const players = {
    starter: { full_name: 'Available Starter', position: 'QB', team: 'AAA', depth_chart_position: 'QB', depth_chart_order: 1 },
    backup: { full_name: 'Backup Qb', position: 'QB', team: 'BBB', depth_chart_position: 'QB', depth_chart_order: 2, age: 23 },
    unknown: { full_name: 'Unknown Role', position: 'QB', team: 'CCC' },
    back: { full_name: 'Some Back', position: 'RB', team: 'DDD', depth_chart_order: 2 },
};
const scores = { starter: 3000, backup: 9000, unknown: 8000, back: 2000 };
const roster = { roster_id: 1, players: [], settings: { waiver_budget_used: 10 } };
const baseLeague = { league_id: 'L', roster_positions: ['QB', 'RB', 'BN'], rosters: [roster] };

function board(ctx, type, extraSettings) {
    const league = { ...baseLeague, settings: { type, waiver_type: 2, waiver_budget: 100, ...(extraSettings || {}) } };
    return ctx.buildFreeAgencyActionBoard({ currentLeague: league, leagueSkin: { type: ({ 0: 'redraft', 2: 'dynasty' })[type] }, myRoster: roster, playersData: players });
}

test('redraft: a backup or unknown-role QB is never a recommendation, but stays in the market', () => {
    const ctx = load(scores);
    const b = board(ctx, 0);
    assert(b.availablePlayers.some(x => x.pid === 'backup'), 'backup still searchable');
    assert(!b.actionBoardPlayers.some(x => x.pid === 'backup'));
    assert(!b.actionBoardPlayers.some(x => x.pid === 'unknown'));
    assert(!b.priorityAdds.some(x => x.pid === 'backup'));
    assert(b.actionBoardPlayers.some(x => x.pid === 'starter'), 'a listed starter remains possible');
    assert(b.actionBoardPlayers.some(x => x.pid === 'back'), 'the role gate is QB-only');
    assert.equal(b.gmHiddenCount, 0, 'role-filtered players are not counted as hidden by GM filters');
});

test('dynasty: a backup QB is a stash — never "fills your QB deficit"', () => {
    const ctx = load(scores);
    const b = board(ctx, 2);
    const bk = b.actionBoardPlayers.find(x => x.pid === 'backup');
    assert(bk, 'dynasty keeps the stash');
    assert.equal(bk.fit.short, 'Stash');
    assert.equal(bk.fit.backup, true);
    assert.equal(bk.fit.need, null);
    assert.match(bk.why, /Backup quarterback/);
    assert.doesNotMatch(bk.why, /deficit|thin/);
});

test('bid estimate: FAAB leagues only, always flagged as an estimate, from the league bid model', () => {
    const ctx = load(scores);
    const faab = board(ctx, 0).actionBoardPlayers.find(x => x.pid === 'starter');
    assert(faab.faab, 'FAAB league gets a bid estimate');
    assert.equal(faab.faab.estimate, true);
    assert.equal(faab.faab.basis, 'faab-model', 'the model in faab-engine.js, not a value formula');
    assert(faab.faab.lo <= faab.faab.sug && faab.faab.sug <= faab.faab.hi, 'the range brackets the model bid');
    assert.equal(faab.faab.coldStart, true, 'no bid history in the fixture → league-median mode, and it says so');
    const rolling = board(ctx, 0, { waiver_type: 0 }).actionBoardPlayers.find(x => x.pid === 'starter');
    assert.equal(rolling.faab, null, 'rolling waivers carry a $100 budget on Sleeper but never bid');
});

// The live bug (2026-09-27, CTB The One at 390px): the phone hero said
// "EST. BID $7–14" and FAAB Command, right under it, said "ESTIMATE $26" for
// the same player — two estimators. Now every surface reads faModelBid, so
// the hero (priorityAdds[0].faab), the board rows (actionBoardPlayers[].faab)
// and FAAB Command (faModelBid for the picked target) must be the one number.
test('hero, waiver-board rows and FAAB Command agree on one estimate for the same player', () => {
    const bid = (rid, amt, wk, failed) => ({ type: 'waiver', status: failed ? 'failed' : 'complete', leg: wk, settings: { waiver_bid: amt }, roster_ids: [rid], adds: { ['x' + wk + rid]: rid } });
    const txns = [];
    for (let w = 1; w <= 6; w++) txns.push(bid(2, 8 + w, w), bid(3, 20 + w, w), bid(3, 5, w, true));
    const rivals = [
        { roster_id: 2, owner_id: 'u2', players: [], settings: { waiver_budget_used: 20 } },   // QB need, budget
        { roster_id: 3, owner_id: 'u3', players: [], settings: { waiver_budget_used: 90 } },   // QB need, $10 left
    ];
    const league = { ...baseLeague, rosters: [roster, ...rivals], settings: { type: 0, waiver_type: 2, waiver_budget: 100 } };
    const ctx = load(scores, { WrTxns: { getCached: () => txns.filter(t => t.status !== 'failed'), getFailedWaivers: () => txns.filter(t => t.status === 'failed') } });
    const b = ctx.buildFreeAgencyActionBoard({ currentLeague: league, leagueSkin: { type: 'redraft' }, myRoster: roster, playersData: players });
    const hero = b.priorityAdds[0];
    assert(hero && hero.faab, 'the top add carries an estimate');
    assert.equal(hero.faab.coldStart, false, '18 logged bids → the league history is the model');
    const row = b.actionBoardPlayers.find(x => x.pid === hero.pid);
    assert.deepEqual([row.faab.sug, row.faab.lo, row.faab.hi], [hero.faab.sug, hero.faab.lo, hero.faab.hi], 'board row = hero');
    // FAAB Command's call for the picked target (pid / pos / dhq off the same row).
    const cmd = ctx.faModelBid({ league, myRoster: roster, playersData: players, pid: hero.pid, pos: hero.pos });
    assert.deepEqual([cmd.sug, cmd.lo, cmd.hi], [hero.faab.sug, hero.faab.lo, hero.faab.hi], 'FAAB Command = hero');
    assert.equal(cmd.analysis.rec.bid, hero.faab.sug, 'the printed "$N" in FAAB Command is the hero\'s model bid');
    // And it is the engine's own number, with the engine's own inputs.
    const raw = ctx.window.App.Faab.estimate({ league, myRosterId: 1, txns, playersData: players, targetPid: hero.pid, targetPos: hero.pos, dhq: hero.dhq });
    assert.deepEqual([raw.sug, raw.lo, raw.hi], [hero.faab.sug, hero.faab.lo, hero.faab.hi], 'App.Faab.estimate = hero');
    assert(hero.faab.lo <= hero.faab.sug && hero.faab.sug <= hero.faab.hi);
    assert.equal(hero.faab.competitors, 2, 'both rivals have a QB need and a legal budget ($1 minimum) — the drawer\'s competition read comes off the same model');
});

test('the board still works if the waiver-tools helper failed to load', () => {
    const window = { App: { LI: { playerScores: scores }, normPos: p => p, WeeklyProj: weeklyProj() }, WR: {}, S: {} };
    const ctx = vm.createContext({ window, console, localStorage: { getItem: () => null } });
    vm.runInContext(head, ctx);
    const b = ctx.buildFreeAgencyActionBoard({ currentLeague: { ...baseLeague, settings: { type: 0, waiver_type: 2, waiver_budget: 100 } }, myRoster: roster, playersData: players });
    assert(b.actionBoardPlayers.length > 0);
});

test('truth gate: no Sleeper line or no depth slot → never a recommendation (same gate as the FA tab); the UDFA craze opts out', () => {
    const ctx = load({ ...scores, noline: 5000 });
    const pd = { ...players, noline: { full_name: 'No Line', position: 'RB', team: 'EEE', depth_chart_order: 1 } };
    const league = { ...baseLeague, settings: { type: 2, waiver_type: 2, waiver_budget: 100 } };
    const b = ctx.buildFreeAgencyActionBoard({ currentLeague: league, leagueSkin: { type: 'dynasty' }, myRoster: roster, playersData: pd });
    assert(b.availablePlayers.some(x => x.pid === 'noline'), 'still in the market');
    assert(!b.actionBoardPlayers.some(x => x.pid === 'noline'), 'not ranked without a published line');
    const craze = ctx.buildFreeAgencyActionBoard({ currentLeague: league, leagueSkin: { type: 'dynasty' }, myRoster: roster, playersData: pd, skipTruthGate: true });
    assert(craze.actionBoardPlayers.some(x => x.pid === 'noline'), 'skipTruthGate keeps him (undrafted rookies have no line in May)');
});

// Review B1 (2026-09-28): the Flash Brief's board priced candidates off raw
// dynasty DHQ (App.LI.playerScores) while the FA tab and the Home widget used
// App.PlayerValue.getValue (ROS in redraft) — CTB The One: Sam Darnold $24–29
// on FA vs $14–17 in the brief. Now faValueOf is the one resolver: the board's
// pool, faModelBid (which ignores any caller value) and the widget all read it.
test('redraft: brief board, FA tab pool, FAAB Command and the Home widget price the same player off ONE value', () => {
    const ros = { starter: 5200, back: 900, backup: 400, qb2: 4100 };   // ROS ≠ dynasty DHQ
    const lscores = { ...scores, qb2: 1200 };
    const pd = { ...players, qb2: { full_name: 'Other Qb', position: 'QB', team: 'FFF', depth_chart_position: 'QB', depth_chart_order: 1 } };
    const bid = (rid, amt, wk) => ({ type: 'waiver', status: 'complete', leg: wk, settings: { waiver_bid: amt }, roster_ids: [rid], adds: { ['x' + wk + rid]: rid } });
    const txns = []; for (let w = 1; w <= 8; w++) txns.push(bid(2, 6 + w, w), bid(3, 18 + w, w));
    const rivals = [2, 3].map(id => ({ roster_id: id, owner_id: 'u' + id, players: [], settings: { waiver_budget_used: 25 } }));
    const league = { ...baseLeague, rosters: [roster, ...rivals], settings: { type: 0, waiver_type: 2, waiver_budget: 100 } };
    const skin = { type: 'redraft' };
    let ensured = 0;
    const PlayerValue = { getValue: (pid, o) => (o && o.skin && o.skin.type === 'redraft' ? (ros[pid] ?? 0) : (lscores[pid] || 0)), ensureRos: () => { ensured++; return null; } };
    const WrTxns = { getCached: () => txns, getFailedWaivers: () => [] };
    const ctx = load(lscores, { App: { PlayerValue }, WrTxns });
    const b = ctx.buildFreeAgencyActionBoard({ currentLeague: league, leagueSkin: skin, myRoster: roster, playersData: pd });
    assert(ensured > 0, 'the board builds ROS itself — the brief can run before Free Agency was ever opened');
    // Pool: the FA tab builds from faBuildAvailable — the board IS that pool.
    const rostered = { has: () => false };
    const tabPool = ctx.faBuildAvailable({ playersData: pd, statsData: {}, prevStatsData: {}, currentLeague: league, skin, rostered, isDraftProspect: () => false, leaguePosSet: null });
    assert.deepEqual(b.availablePlayers.map(x => [x.pid, x.dhq]), tabPool.map(x => [x.pid, x.dhq]), 'brief board pool = FA tab pool');
    assert.equal(b.availablePlayers.find(x => x.pid === 'starter').dhq, 5200, 'ROS, not the raw 3000 DHQ');
    // Ranking follows ROS too: qb2 (DHQ 1200, ROS 4100) outranks back (DHQ 2000, ROS 900).
    const order = b.actionBoardPlayers.map(x => x.pid);
    assert(order.indexOf('qb2') < order.indexOf('back'));
    const hero = b.priorityAdds[0];
    assert.equal(hero.pid, 'starter');
    // FAAB Command / FA tab rows: faModelBid resolves the value itself and
    // IGNORES a caller's value — a wrong dhq can't produce a second number.
    const cmd = ctx.faModelBid({ league, myRoster: roster, playersData: pd, pid: 'starter', pos: 'QB', skin, dhq: 3000 });
    assert.deepEqual([cmd.sug, cmd.lo, cmd.hi], [hero.faab.sug, hero.faab.lo, hero.faab.hi], 'FAAB Command / FA tab = brief');
    assert.equal(cmd.dhq, 5200);
    // Home widget fallback path (fa group not loaded): the engine on the same
    // resolver value and the same cached history.
    const widget = ctx.window.App.Faab.estimate({ league, myRosterId: 1, txns, playersData: pd, targetPid: 'starter', targetPos: 'QB', dhq: PlayerValue.getValue('starter', { skin }) });
    assert.deepEqual([widget.sug, widget.lo, widget.hi], [hero.faab.sug, hero.faab.lo, hero.faab.hi], 'Home widget = brief');
    // Pricing off the raw DHQ would have been a different number — the bug.
    const stale = ctx.window.App.Faab.estimate({ league, myRosterId: 1, txns, playersData: pd, targetPid: 'starter', targetPos: 'QB', dhq: 3000 });
    assert.notDeepEqual([stale.sug, stale.lo, stale.hi], [hero.faab.sug, hero.faab.lo, hero.faab.hi], 'fixture really separates the two values');
});

test('estimate refreshes when the rosters are replaced IN PLACE on the same league object (review S1)', () => {
    const ctx = load(scores);
    const league = { ...baseLeague, rosters: [{ ...roster, settings: { waiver_budget_used: 36 } }, { roster_id: 2, players: [], settings: { waiver_budget_used: 0 } }], settings: { type: 0, waiver_type: 2, waiver_budget: 100 } };
    const before = ctx.faModelBid({ league, myRoster: league.rosters[0], playersData: players, pid: 'starter', pos: 'QB' });
    assert.equal(before.myLeft, 64);
    league.rosters = [{ ...roster, settings: { waiver_budget_used: 96 } }, league.rosters[1]];   // league-detail.js refresh
    const after = ctx.faModelBid({ league, myRoster: league.rosters[0], playersData: players, pid: 'starter', pos: 'QB' });
    assert.equal(after.myLeft, 4, 'not the memoised $64');
    assert(after.hi <= 4);
});

test('no estimate outside a Sleeper FAAB league, whatever the caller asks (review N4)', () => {
    const ctx = load(scores);
    const espn = { ...baseLeague, _platform: 'espn', settings: { waiver_budget: 100 } };
    assert.equal(ctx.faModelBid({ league: espn, myRoster: roster, playersData: players, pid: 'starter', pos: 'QB' }), null);
    const b = ctx.buildFreeAgencyActionBoard({ currentLeague: espn, myRoster: roster, playersData: players });
    assert(b.actionBoardPlayers.every(x => x.faab == null));
});

test('bid-history fetch: a cache hit is not announced as a change (review N1); new claims are', async () => {
    let cached = [{ type: 'waiver', status: 'complete', settings: { waiver_bid: 5 } }];
    const events = [];
    const WrTxns = { getCached: () => cached, getFailedWaivers: () => [], fetchLeagueTxns: async () => cached };
    const ctx = load(scores, { WrTxns, dispatchEvent: (e) => events.push(e) });
    ctx.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
    const league = { ...baseLeague, settings: { type: 0, waiver_type: 2, waiver_budget: 100 } };
    const v0 = vm.runInContext('_faTxnsVersion', ctx);
    await ctx.faEnsureBidHistory(league);
    assert.equal(vm.runInContext('_faTxnsVersion', ctx), v0, 'the estimates were already reading this cache — nothing to recompute');
    assert.equal(events.length, 0);
    cached = cached.concat({ type: 'waiver', status: 'complete', settings: { waiver_bid: 9 } });
    await ctx.faEnsureBidHistory(league);
    assert.equal(vm.runInContext('_faTxnsVersion', ctx), v0 + 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'wr:fa-txns-updated');
});
