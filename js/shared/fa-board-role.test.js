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

function load(scores) {
    const window = { App: { LI: { playerScores: scores }, normPos: p => p }, WR: {}, S: {} };
    const ctx = vm.createContext({ window, console, localStorage: { getItem: () => null } });
    // Pure helper first, exactly as the "fa" module group orders them.
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

test('bid estimate: FAAB leagues only, always flagged as an estimate', () => {
    const ctx = load(scores);
    const faab = board(ctx, 0).actionBoardPlayers.find(x => x.pid === 'starter');
    assert(faab.faab, 'FAAB league gets the formula range');
    assert.equal(faab.faab.estimate, true);
    assert.equal(faab.faab.basis, 'dhq-formula');
    const rolling = board(ctx, 0, { waiver_type: 0 }).actionBoardPlayers.find(x => x.pid === 'starter');
    assert.equal(rolling.faab, null, 'rolling waivers carry a $100 budget on Sleeper but never bid');
});

test('the board still works if the waiver-tools helper failed to load', () => {
    const window = { App: { LI: { playerScores: scores }, normPos: p => p }, WR: {}, S: {} };
    const ctx = vm.createContext({ window, console, localStorage: { getItem: () => null } });
    vm.runInContext(head, ctx);
    const b = ctx.buildFreeAgencyActionBoard({ currentLeague: { ...baseLeague, settings: { type: 0, waiver_type: 2, waiver_budget: 100 } }, myRoster: roster, playersData: players });
    assert(b.actionBoardPlayers.length > 0);
});
