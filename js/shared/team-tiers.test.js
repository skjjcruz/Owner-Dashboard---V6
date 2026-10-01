// Run with:  node --test js/shared/team-tiers.test.js
// League-relative team tiers (owner ruling 2026-10-01, "Option A, win-now
// only"). The engine lives in DHQ-Shared/team-assess.js, vendored into
// reconai-shared/ by `npm run sync:shared`: tiers rank the league on 50%
// Roster Health percentile + 50% standings percentile (Health only before
// games), banded ELITE = top ceil(N/6), CONTENDER to 45%, CROSSROADS to 75%.
// Fixtures marked REAL are live Sleeper data (week 4, 2026) captured by the
// headless harness that runs this same engine.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const SHARED = path.join(ROOT, 'reconai-shared');

function store() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, key: i => Array.from(m.keys())[i] ?? null, get length() { return m.size; } };
}
function loadEngine() {
    const ctx = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        localStorage: store(), sessionStorage: store(), setTimeout, clearTimeout,
        location: { hostname: 'localhost', search: '', href: 'http://localhost/', pathname: '/' },
        navigator: { userAgent: 'node' }, addEventListener() {}, removeEventListener() {},
        document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    };
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const f of ['constants.js', 'utils.js', 'team-assess.js']) {
        vm.runInContext(fs.readFileSync(path.join(SHARED, f), 'utf8'), ctx, { filename: f });
    }
    return ctx;
}
const ENGINE = loadEngine();
const TT = ENGINE.App.TeamTiers;
const clone = o => JSON.parse(JSON.stringify(o));

// [rosterId, user, W, L, T, PF, Roster Health, weekly lineup pts, panic, eliminated?]
const toTeams = rows => rows.map(([rosterId, user, wins, losses, ties, pf, healthScore, weeklyPts, panic, elim]) => ({
    rosterId, user, wins, losses, ties, pf, healthScore, weeklyPts, panic,
    eliminated: !!elim,
    // Standalone (legacy absolute) tier, as assessTeam produced it.
    tier: healthScore >= 90 ? 'ELITE' : healthScore >= 80 ? 'CONTENDER' : healthScore >= 70 ? 'CROSSROADS' : 'REBUILDING',
}));
// REAL: The Psycho League, 16 teams, week 4 2026.
const PSYCHO = toTeams([[1, 'BigLoco', 1, 2, 0, 532.14, 79, 205.9, 3], [2, 'GasMan612', 1, 2, 0, 723.66, 96, 262.4, 2], [3, 'KevinAudio', 1, 2, 0, 698.29, 98, 285.8, 1], [4, 'iMacduff', 2, 1, 0, 645.76, 97, 263.3, 1], [5, 'bwit13', 1, 2, 0, 609.27, 91, 237.3, 2], [6, 'Huskerwildcat', 2, 1, 0, 594.02, 93, 250.7, 1], [7, 'TWhy123', 3, 0, 0, 728.15, 100, 277.1, 0], [8, 'MangaMaw', 0, 3, 0, 452.75, 83, 236.2, 2], [9, 'Malibooch', 1, 2, 0, 511.02, 93, 244.3, 2], [10, 'DJAlexB', 1, 2, 0, 575.48, 92, 237.7, 2], [11, 'Guero0801', 2, 1, 0, 550.17, 79, 199.7, 2], [12, 'Cacapoopoopeepeepnts', 1, 2, 0, 551.08, 87, 230.9, 3], [13, 'skjjcruz', 2, 1, 0, 641.66, 97, 262.5, 1], [14, 'COVIDFaceMasks', 2, 1, 0, 739.38, 100, 290.1, 0], [15, 'mwitkowski', 2, 1, 0, 765.39, 98, 280.1, 0], [16, 'MattLicari', 2, 1, 0, 650.1, 97, 268.2, 1]]);
// REAL: CTB Shootout (Sleeper chopped league), 18 teams, 3 chopped.
const SHOOTOUT = toTeams([[1, 'shrews180', 0, 0, 0, 303.22, 87, 101, 0], [2, 'mwitkowski', 0, 0, 0, 254.94, 89, 112.8, 0], [3, 'BigLoco', 0, 0, 0, 253.7, 87, 84.5, 1], [4, 'MWohler', 0, 0, 0, 271.08, 91, 90.5, 1], [5, 'MangaMaw', 0, 0, 0, 268.24, 95, 97.8, 0], [6, 'Ellusionism', 0, 0, 0, 263.5, 91, 103.7, 0], [7, 'DanDeanda', 0, 0, 0, 179.14, 64, 71.4, 2], [8, 'GreatBrownbino', 0, 0, 0, 342.84, 93, 111.8, 0], [9, 'saints805', 0, 0, 0, 251.32, 75, 77.1, 2], [10, 'bwit13', 0, 0, 0, 197.3, 72, 66, 2], [11, 'coolade357', 0, 0, 0, 179.24, 78, 76.9, 2], [12, 'skjjcruz', 0, 0, 0, 276.06, 87, 104.9, 0], [13, 'barridropemoff', 0, 0, 0, 215.38, 72, 73.3, 2], [14, 'Kerbizz', 0, 0, 0, 288.7, 87, 101.2, 0], [15, 'rid15', 0, 0, 0, 181.4, 77, 75, 2], [16, 'PatD05', 0, 0, 0, 112.58, 0, 0, 2, 1], [17, 'Badmthrfckr9', 0, 0, 0, 37.7, 0, 0, 2, 1], [18, 'jose111jejs', 0, 0, 0, 172.68, 0, 0, 2, 1]]);

const dist = list => list.filter(a => !a.eliminated).reduce((d, a) => { d[a.tier] = (d[a.tier] || 0) + 1; return d; }, {});
const byUser = (list, u) => list.find(a => a.user === u);
// N distinct teams, team i strictly better than team i+1 on both halves.
const ladder = n => Array.from({ length: n }, (_, i) => ({ rosterId: i + 1, healthScore: 100 - i, weeklyPts: 200 - i, wins: n - i, losses: i, ties: 0, pf: 1000 - i * 10, panic: 0 }));

test('bands: ELITE = ceil(N/6), CONTENDER to 45%, CROSSROADS to 75% at N = 12, 16, 18', () => {
    assert.deepEqual({ ...TT.bandCounts(12) }, { elite: 2, contender: 5, crossroads: 9, n: 12 });
    assert.deepEqual({ ...TT.bandCounts(16) }, { elite: 3, contender: 7, crossroads: 12, n: 16 });
    assert.deepEqual({ ...TT.bandCounts(18) }, { elite: 3, contender: 8, crossroads: 14, n: 18 });
    for (const [n, want] of [[12, { ELITE: 2, CONTENDER: 3, CROSSROADS: 4, REBUILDING: 3 }], [16, { ELITE: 3, CONTENDER: 4, CROSSROADS: 5, REBUILDING: 4 }], [18, { ELITE: 3, CONTENDER: 5, CROSSROADS: 6, REBUILDING: 4 }]]) {
        const list = TT.assignLeagueTiers(ladder(n));
        assert.deepEqual(dist(list), want, 'N=' + n);
        list.forEach(a => { assert.equal(a.tierOf, n); assert.equal(a.tierRank, a.rosterId); });
    }
    // Tiny leagues never produce an empty top band or a band past N.
    assert.equal(TT.tierForRank(1, 1), 'ELITE');
    assert.deepEqual({ ...TT.bandCounts(2) }, { elite: 1, contender: 1, crossroads: 2, n: 2 });
    assert.equal(TT.tierForRank(0, 12), null);
});

test('REAL Psycho (16): 3 ELITE = TWhy123, COVIDFaceMasks, mwitkowski; skjjcruz CONTENDER #7 of 16', () => {
    const list = TT.assignLeagueTiers(clone(PSYCHO), { leagueStatus: 'in_season' });
    assert.deepEqual(dist(list), { ELITE: 3, CONTENDER: 4, CROSSROADS: 5, REBUILDING: 4 });
    assert.deepEqual(list.filter(a => a.tier === 'ELITE').map(a => a.user).sort(), ['COVIDFaceMasks', 'TWhy123', 'mwitkowski']);
    const me = byUser(list, 'skjjcruz');
    assert.equal(me.tier, 'CONTENDER');
    assert.equal(me.tierRank, 7);
    assert.equal(me.tierOf, 16);
    assert.equal(me.tierBasis, 'health+standings');
    // The old absolute cut called 12 of these 16 teams ELITE.
    assert.equal(PSYCHO.filter(a => a.tier === 'ELITE').length, 12);
});

test('ties: identical teams share a percentile and order by roster id; a composite tie falls to Roster Health', () => {
    const twin = { healthScore: 95, weeklyPts: 180, wins: 2, losses: 1, ties: 0, pf: 600, panic: 0 };
    const base = [{ rosterId: 3, ...twin }, { rosterId: 1, ...twin }, ...ladder(6).map(a => ({ ...a, rosterId: a.rosterId + 10, healthScore: 80 - a.rosterId, wins: 0, losses: 3 }))];
    const a1 = TT.assignLeagueTiers(clone(base));
    const a2 = TT.assignLeagueTiers(clone(base).reverse());
    const order = l => l.slice().sort((x, y) => x.tierRank - y.tierRank).map(a => a.rosterId);
    assert.deepEqual(order(a1), order(a2), 'input order never changes the ranking');
    const t1 = a1.find(a => a.rosterId === 1), t3 = a1.find(a => a.rosterId === 3);
    assert.equal(t1.tierScore, t3.tierScore);
    assert.deepEqual([t1.tierRank, t3.tierRank], [1, 2]);
    // REAL three-way composite tie in Shootout (each 3/14): Roster Health
    // decides — coolade357 (78) > rid15 (77) > barridropemoff (72).
    const s = TT.assignLeagueTiers(clone(SHOOTOUT));
    const three = ['coolade357', 'rid15', 'barridropemoff'].map(u => byUser(s, u));
    assert.equal(new Set(three.map(a => a.tierScore)).size, 1);
    assert.deepEqual(three.map(a => a.tierRank), [11, 12, 13]);
    assert.deepEqual(three.map(a => a.tier), ['CROSSROADS', 'REBUILDING', 'REBUILDING']);
});

test('before any games (and in the offseason) the tier is Roster Health only', () => {
    const pre = clone(PSYCHO).map(a => ({ ...a, wins: 0, losses: 0, ties: 0, pf: 0 }));
    const list = TT.assignLeagueTiers(pre);
    assert.ok(list.every(a => a.tierBasis === 'health'));
    const order = list.slice().sort((x, y) => x.tierRank - y.tierRank).map(a => a.user);
    // Health, then lineup points: COVID 100/290.1, TWhy 100/277.1, KevinAudio 98/285.8 …
    assert.deepEqual(order.slice(0, 4), ['COVIDFaceMasks', 'TWhy123', 'KevinAudio', 'mwitkowski']);
    // A completed season's record is last year's — offseason ignores it.
    const off = TT.assignLeagueTiers(clone(PSYCHO), { leagueStatus: 'complete' });
    assert.ok(off.every(a => a.tierBasis === 'health'));
    assert.deepEqual(off.slice().sort((x, y) => x.tierRank - y.tierRank).map(a => a.user), order);
    // A chopped league has no W-L: points for alone switches standings on.
    assert.ok(TT.assignLeagueTiers(clone(SHOOTOUT)).filter(a => !a.eliminated).every(a => a.tierBasis === 'health+standings'));
});

test('chopped league: only teams still alive are ranked; chopped teams keep their own tier', () => {
    const list = TT.assignLeagueTiers(clone(SHOOTOUT));
    assert.deepEqual(dist(list), { ELITE: 3, CONTENDER: 4, CROSSROADS: 4, REBUILDING: 4 });
    const alive = list.filter(a => !a.eliminated);
    assert.equal(alive.length, 15);
    alive.forEach(a => assert.equal(a.tierOf, 15));
    const chopped = list.filter(a => a.eliminated);
    assert.deepEqual(chopped.map(a => a.user), ['PatD05', 'Badmthrfckr9', 'jose111jejs']);
    chopped.forEach(a => {
        assert.equal(a.tierRank, null);
        assert.equal(a.tierBasis, 'eliminated');
        assert.equal(a.tier, 'REBUILDING'); // their standalone tier (Health 0), untouched
        assert.equal(a.window, 'REBUILDING');
    });
    assert.equal(byUser(list, 'skjjcruz').tier, 'CONTENDER');
    assert.equal(byUser(list, 'GreatBrownbino').tierRank, 1);
});

test('assessAllTeams marks Sleeper-chopped rosters (settings.eliminated) and ranks the rest', () => {
    const rosters = Array.from({ length: 8 }, (_, i) => ({ roster_id: i + 1, owner_id: 'u' + (i + 1), players: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 100 - i * 5, ...(i >= 6 ? { eliminated: i - 4, locked: 1 } : {}) } }));
    const league = { league_id: 'L', season: '2026', status: 'in_season', roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'], settings: { type: 3 } };
    const all = ENGINE.App.assessAllTeams(rosters, {}, {}, league, [], []);
    assert.equal(all.length, 8);
    const elim = all.filter(a => a.eliminated).map(a => a.rosterId).sort();
    assert.deepEqual(elim, [7, 8]);
    all.filter(a => !a.eliminated).forEach(a => assert.equal(a.tierOf, 6));
    all.filter(a => a.eliminated).forEach(a => assert.equal(a.tierRank, null));
    // Six alive teams with equal (empty-roster) Health: points for decides.
    assert.deepEqual(all.filter(a => !a.eliminated).sort((x, y) => x.tierRank - y.tierRank).map(a => a.rosterId), [1, 2, 3, 4, 5, 6]);
});

test('tier -> window: re-derived from the NEW tier', () => {
    assert.equal(TT.windowForTier('ELITE', 5), 'CONTENDING');
    assert.equal(TT.windowForTier('CONTENDER', 1), 'CONTENDING');
    assert.equal(TT.windowForTier('CONTENDER', 2), 'TRANSITIONING');
    assert.equal(TT.windowForTier('CROSSROADS', 0), 'TRANSITIONING');
    assert.equal(TT.windowForTier('REBUILDING', 0), 'REBUILDING');
    // Psycho: Malibooch is ELITE by the old Health cut (93) — window was
    // CONTENDING. Ranked 13th of 16 he is REBUILDING, and so is his window.
    const list = TT.assignLeagueTiers(clone(PSYCHO).map(a => ({ ...a, window: TT.windowForTier(a.tier, a.panic) })));
    const m = byUser(list, 'Malibooch');
    assert.equal(m.tier, 'REBUILDING');
    assert.equal(m.window, 'REBUILDING');
    list.forEach(a => assert.equal(a.window, TT.windowForTier(a.tier, a.panic)));
    // KevinAudio: CONTENDER at panic 1 → CONTENDING; GasMan612: CROSSROADS → TRANSITIONING.
    assert.equal(byUser(list, 'KevinAudio').window, 'CONTENDING');
    assert.equal(byUser(list, 'GasMan612').window, 'TRANSITIONING');
});

test('brief-pulse: the recalibration is not announced as a tier shift; a real move is', () => {
    const ctx = { console: { log() {}, warn() {}, error() {} }, localStorage: store(), setTimeout, clearTimeout, App: { TeamTiers: { rev: 1 } } };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'shared', 'brief-pulse.js'), 'utf8'), ctx, { filename: 'brief-pulse.js' });
    const BP = ctx.WR.BriefPulse;
    const curr = BP.snapshotFromState({ fingerprint: 'f', players: ['a'], record: '2-1', tier: 'CONTENDER', rank: 13 });
    assert.equal(curr.tierRev, 1);
    // A baseline written before the change: no tierRev, old absolute tier.
    const oldBase = { fingerprint: 'f0', players: ['a'], record: '2-1', tier: 'ELITE', rank: 13 };
    assert.equal(BP.computeChange(oldBase, curr, {}).changes.filter(c => c.type === 'tier').length, 0);
    // The baseline is re-stamped once, then a later real move is announced.
    BP.saveSnapshot('L', oldBase);
    assert.equal(BP.rebaselineTier('L', curr), true);
    assert.equal(BP.rebaselineTier('L', curr), false);
    const saved = BP.loadSnapshot('L');
    assert.deepEqual([saved.tier, saved.tierRev, saved.record, saved.fingerprint], ['CONTENDER', 1, '2-1', 'f0']);
    const moved = { ...curr, tier: 'CROSSROADS' };
    const tierChanges = BP.computeChange(saved, moved, {}).changes.filter(c => c.type === 'tier');
    assert.equal(tierChanges.length, 1);
    assert.match(tierChanges[0].text, /CONTENDER to CROSSROADS/);
});
