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

function load(scores, extraWindow) {
    const window = Object.assign({ App: { LI: { playerScores: scores }, normPos: p => p }, WR: {}, S: {} }, extraWindow || {});
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
    const cmd = ctx.faModelBid({ league, myRoster: roster, playersData: players, pid: hero.pid, pos: hero.pos, dhq: hero.dhq });
    assert.deepEqual([cmd.sug, cmd.lo, cmd.hi], [hero.faab.sug, hero.faab.lo, hero.faab.hi], 'FAAB Command = hero');
    assert.equal(cmd.analysis.rec.bid, hero.faab.sug, 'the printed "$N" in FAAB Command is the hero\'s model bid');
    // And it is the engine's own number, with the engine's own inputs.
    const raw = ctx.window.App.Faab.estimate({ league, myRosterId: 1, txns, playersData: players, targetPid: hero.pid, targetPos: hero.pos, dhq: hero.dhq });
    assert.deepEqual([raw.sug, raw.lo, raw.hi], [hero.faab.sug, hero.faab.lo, hero.faab.hi], 'App.Faab.estimate = hero');
    assert(hero.faab.lo <= hero.faab.sug && hero.faab.sug <= hero.faab.hi);
    assert.equal(hero.faab.competitors, 2, 'both rivals have a QB need and a legal budget ($1 minimum) — the drawer\'s competition read comes off the same model');
});

test('the board still works if the waiver-tools helper failed to load', () => {
    const window = { App: { LI: { playerScores: scores }, normPos: p => p }, WR: {}, S: {} };
    const ctx = vm.createContext({ window, console, localStorage: { getItem: () => null } });
    vm.runInContext(head, ctx);
    const b = ctx.buildFreeAgencyActionBoard({ currentLeague: { ...baseLeague, settings: { type: 0, waiver_type: 2, waiver_budget: 100 } }, myRoster: roster, playersData: players });
    assert(b.actionBoardPlayers.length > 0);
});
