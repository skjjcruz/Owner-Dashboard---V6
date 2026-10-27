// Run with:  node --test js/shared/server-assess.test.js
// Phase A1 (2026-10-27): team assessments and owner DNA come from the engine
// server's build when they describe the league exactly as the device holds
// it (team-assess.js _serverAssessments, analytics-engine.js
// computeWeightedDNA). Any change since the build computes on the device.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHARED = path.join(__dirname, '..', '..', 'reconai-shared');
function store() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, key: i => Array.from(m.keys())[i] ?? null, get length() { return m.size; } };
}
function engine() {
    const ctx = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        localStorage: store(), sessionStorage: store(), setTimeout, clearTimeout,
        location: { hostname: 'localhost', search: '', href: 'http://localhost/', pathname: '/' },
        navigator: { userAgent: 'node' }, addEventListener() {}, removeEventListener() {},
        document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    };
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const f of ['constants.js', 'utils.js', 'team-assess.js', 'analytics-engine.js']) vm.runInContext(fs.readFileSync(path.join(SHARED, f), 'utf8'), ctx, { filename: f });
    const LI = { playerScores: { a: 5000, b: 3000, c: 4000, d: 2000 }, playerMeta: {}, ownerProfiles: {}, tradeHistory: [], builtAt: 1 };
    ctx.App.LI = LI; ctx.App.LI_LOADED = true;
    const rosters = [
        { roster_id: 1, owner_id: 'u1', players: ['a', 'b'], settings: { wins: 2, losses: 1, ties: 0, fpts: 300 } },
        { roster_id: 2, owner_id: 'u2', players: ['c', 'd'], settings: { wins: 1, losses: 2, ties: 0, fpts: 250 } },
    ];
    ctx.S = { currentLeagueId: 'L1', season: '2026', rosters, players: { a: { position: 'QB' }, b: { position: 'RB' }, c: { position: 'WR' }, d: { position: 'TE' } }, playerStats: {}, leagueUsers: [], tradedPicks: [], leagues: [{ league_id: 'L1', roster_positions: ['QB', 'RB', 'WR', 'TE'], settings: {} }] };
    ctx.App.S = ctx.S;
    const served = [{ rosterId: 1, healthScore: 11, tier: 'SERVER' }, { rosterId: 2, healthScore: 22, tier: 'SERVER' }];
    ctx.App.ServerAssess = { leagueId: 'L1', li: LI, assessments: served, dna: { 1: { label: 'server dna' }, 2: null }, rosters: JSON.parse(JSON.stringify(rosters)) };
    return ctx;
}

test('the server\'s assessments serve while the league matches the build', () => {
    const E = engine();
    const all = E.App.assessAllTeamsFromGlobal();
    assert.deepEqual(all.map(a => a.tier), ['SERVER', 'SERVER']);
    assert.equal(E.App.assessTeamFromGlobal(2).healthScore, 22);
    assert.deepEqual(E.computeWeightedDNA(1), { label: 'server dna' });
    assert.equal(E.computeWeightedDNA(2), null);
});

test('a roster move, a scored week or other values: the device assesses', () => {
    for (const change of [
        E => { E.S.rosters[0].players = ['a', 'b', 'd']; },
        E => { E.S.rosters[1].settings.wins = 2; },
        E => { E.S.rosters[1].settings.fpts = 260; },
        E => { E.App.LI = Object.assign({}, E.App.LI, { builtAt: 2 }); },
        E => { E.App.LI._projectedYear = 2028; },
        E => { E.S.currentLeagueId = 'L2'; },
        E => { E.App.ServerAssess = null; },
    ]) {
        const E = engine();
        change(E);
        const all = E.App.assessAllTeamsFromGlobal();
        assert.ok(all.length === 2 && all.every(a => a.tier !== 'SERVER'), String(change));
    }
    const E = engine();
    E.App.LI = Object.assign({}, E.App.LI, { builtAt: 2 });
    assert.equal(E.computeWeightedDNA(1), null, 'no profile on the device: its own answer, not the server\'s');
});
