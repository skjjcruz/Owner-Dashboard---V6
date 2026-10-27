'use strict';
const test = require('node:test');
const assert = require('node:assert');

const LID = '1312100327931019264';
const pv = {}; for (let i = 1; i <= 64; i++) pv[i] = { value: 10000 - i * 100 };
function intel(n) {
    const playerScores = {}, playerMeta = {};
    for (let i = 0; i < n; i++) { playerScores['p' + i] = 5000 - i; playerMeta['p' + i] = {}; }
    return { playerScores, playerMeta, dhqPickValues: pv, ownerProfiles: {}, rookieProspects: 413 };
}
function body(over) {
    return Object.assign({ league_id: LID, season: '2026', built_at: new Date(Date.now() - 20 * 60000).toISOString(), engine_version: 'headless-4', intel: intel(200) }, over || {});
}

// A stand-in for dhq-engine.js: LI, LI_LOADED and the device's own loader.
function load(opts) {
    const o = opts || {};
    const store = Object.assign({}, o.store);
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    const fetches = [];
    globalThis.fetch = (url) => { fetches.push(url); return o.fetch ? o.fetch(url) : Promise.resolve({ ok: true, json: () => Promise.resolve(body()) }); };
    const events = [];
    globalThis.DhqEvents = { emit: (n, d) => events.push([n, d]) };
    delete globalThis._liLoading;
    const App = globalThis.App = { S: { currentLeagueId: LID, season: '2026', nflState: { season_type: 'regular' }, rosters: o.rosters || [{ players: ['p1', 'p2'] }, { players: ['p3'] }], players: { p1: { position: 'RB' }, p2: { position: 'WR' }, p3: { position: 'QB' } } } };
    const device = { calls: 0, cache: !!o.cache, brain: 0 };
    let LI = {}, loaded = false;
    Object.defineProperty(App, 'LI', { get: () => LI, set: v => { LI = v; }, configurable: true });
    Object.defineProperty(App, 'LI_LOADED', { get: () => loaded, set: v => { loaded = v; }, configurable: true });
    App.loadLICache = async () => { if (device.cache) { LI = { cached: true }; loaded = true; } return device.cache; };
    App.computeOneBrain = async () => { device.brain++; };
    const engine = async function () { device.calls++; LI = { device: true }; loaded = true; };
    if (o.engineFirst) App.loadLeagueIntel = engine;
    delete require.cache[require.resolve('./server-intel.js')];
    const SI = require('./server-intel.js');
    if (!o.engineFirst) App.loadLeagueIntel = engine;   // dhq-engine.js loading after this file
    return { App, SI, device, fetches, events, store };
}
const tick = () => new Promise(r => setTimeout(r, 5));

test('uses the server build and skips the device computation', async () => {
    const { App, device, fetches, events } = load();
    await App.loadLeagueIntel();
    await tick();
    assert.equal(device.calls, 0);
    assert.equal(fetches.length, 1);
    assert.ok(fetches[0].endsWith('?league=' + LID));
    assert.equal(App.LI_LOADED, true);
    assert.equal(Object.keys(App.LI.playerScores).length, 200);
    assert.equal(App.LI_SOURCE.source, 'server');
    assert.deepEqual(events, [['li:loaded', { source: 'server' }]]);
    assert.equal(device.brain, 1, 'the assessment brain runs, as after a fresh build');
});

test('wraps the loader whichever file loads first', async () => {
    const { App, device } = load({ engineFirst: true });
    await App.loadLeagueIntel();
    assert.equal(device.calls, 0);
    assert.equal(App.LI_SOURCE.source, 'server');
});

test('a valid device cache still wins; only this week\'s projections come from the server', async () => {
    const { App, device, fetches } = load({ cache: true });
    await App.loadLeagueIntel();
    await tick();
    assert.deepEqual(fetches.map(u => u.split('?')[1]), ['league=' + LID + '&part=proj']);
    assert.equal(device.calls, 0);
    assert.equal(App.LI.cached, true);
});

test('falls back to the device on a 404, a network error or a timeout-style abort', async () => {
    for (const f of [() => Promise.resolve({ ok: false, status: 404 }), () => Promise.reject(new Error('offline')), () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))]) {
        const { App, device } = load({ fetch: f });
        await App.loadLeagueIntel();
        assert.equal(device.calls, 1);
        assert.equal(App.LI.device, true);
    }
});

test('rejects a stale, foreign, wrong-season, incomplete or roster-short build', async () => {
    const S = { currentLeagueId: LID, season: '2026', nflState: { season_type: 'regular' }, rosters: [{ players: ['p1'] }], players: { p1: { position: 'RB' } } };
    const { SI } = load();
    const now = Date.now();
    assert.equal(SI._reject(body(), S, now), '');
    assert.match(SI._reject(body({ built_at: new Date(now - 3 * 3600e3).toISOString() }), S, now), /built 180 min ago/);
    assert.equal(SI._reject(body({ built_at: new Date(now - 3 * 3600e3).toISOString() }), Object.assign({}, S, { nflState: { season_type: 'off' } }), now), '', 'offseason allows 8 hours');
    assert.equal(SI._reject(body({ league_id: '1389388885716385792' }), S, now), 'other league');
    assert.match(SI._reject(body({ season: '2025' }), S, now), /season/);
    assert.match(SI._reject(body({ engine_version: 'v9' }), S, now), /engine/);
    assert.equal(SI._reject(body({ intel: { playerScores: {} } }), S, now), 'incomplete');
    assert.equal(SI._reject(body({ intel: intel(50) }), S, now), 'too few players');
    assert.equal(SI._reject(body({ intel: Object.assign(intel(200), { rookieProspects: 0 }) }), S, now), 'no rookie class');
    const few = { currentLeagueId: LID, season: '2026', nflState: {}, rosters: [{ players: ['x1', 'p1', 'p2', 'p3'] }] };
    assert.equal(SI._reject(body(), few, now), '', 'a few unvalued bench players are normal');
    const many = { currentLeagueId: LID, season: '2026', nflState: {}, rosters: [{ players: ['x1', 'x2', 'p1', 'p2'] }] };
    assert.match(SI._reject(body(), many, now), /2 of 4 rostered players missing/);
});

test('a rejected build falls back to the device', async () => {
    const { App, device } = load({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body({ season: '2025' })) }) });
    await App.loadLeagueIntel();
    assert.equal(device.calls, 1);
});

test('the off switch and non-Sleeper leagues use the device', async () => {
    let r = load({ store: { dhq_server_li_off: '1' } });
    await r.App.loadLeagueIntel();
    assert.equal(r.fetches.length, 0); assert.equal(r.device.calls, 1);
    r = load();
    r.App.S.currentLeagueId = 'espn_687493_2026';
    await r.App.loadLeagueIntel();
    assert.equal(r.fetches.length, 0); assert.equal(r.device.calls, 1);
});

test('two callers at once share one server call', async () => {
    const { App, fetches, device } = load();
    await Promise.all([App.loadLeagueIntel(), App.loadLeagueIntel()]);
    assert.equal(fetches.length, 1);
    assert.equal(device.calls, 0);
});

test('the pick-value curve matches the engine formula', () => {
    const { SI } = load();
    const fn = SI._pickValueFn(pv, 16, 2026);
    assert.equal(fn(2026, 1, 1), 9900);
    assert.equal(fn(2026, 2, 3), pv[19].value);
    assert.equal(fn(2027, 1, 8), Math.round(pv[8].value * 0.88));
    assert.equal(fn(2026, 1, 0), pv[8].value, 'no slot reads mid-round');
});

test('the build\'s assessments and DNA ride along with the values (Phase A1)', async () => {
    const assess = { assessments: [{ rosterId: 1, healthScore: 80 }], dna: { 1: { label: 'x' } }, rosters: [{ roster_id: 1, players: ['p1', 'p2'], settings: { wins: 1, losses: 0, ties: 0, fpts: 100 } }] };
    let r = load({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body({ assess })) }) });
    await r.App.loadLeagueIntel();
    assert.equal(r.App.ServerAssess.leagueId, LID);
    assert.equal(r.App.ServerAssess.li, r.App.LI, 'tied to this build\'s values');
    assert.deepEqual(r.App.ServerAssess.assessments, assess.assessments);
    assert.deepEqual(r.App.ServerAssess.rosters, assess.rosters);
    assert.equal(r.App.ServerBrain, null, 'no brain in this build');
    const brain = { ledger: { teams: {} }, intent: { byRosterId: {} }, brain: { leagueId: LID } };
    r = load({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body({ assess, brain })) }) });
    await r.App.loadLeagueIntel();
    assert.deepEqual(r.App.ServerBrain.ledger, brain.ledger);
    assert.deepEqual(r.App.ServerBrain.brain, brain.brain);
    assert.equal(r.App.ServerBrain.leagueId, LID);
    r = load();
    await r.App.loadLeagueIntel();
    assert.equal(r.App.ServerAssess, null, 'an older build without them: the device assesses');
});

test('this week\'s DHQ projections ride along when the build is fresh (Phase A3)', async () => {
    const proj = (ageMin) => ({ week: 8, built_at: new Date(Date.now() - ageMin * 60000).toISOString(), players: {}, app: { model: 'abc123def456', results: { p1: { median: 12.1, mean: 12.6 } }, none: ['p9'], inj: {} } });
    let adopted = 0;
    let r = load({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body({ dhq_proj: proj(20) })) }) });
    r.App.DhqProj = { adoptServer: () => { adopted++; } };
    await r.App.loadLeagueIntel();
    assert.equal(r.App.ServerProj.leagueId, LID);
    assert.equal(r.App.ServerProj.week, 8);
    assert.equal(r.App.ServerProj.app.model, 'abc123def456');
    assert.equal(adopted, 1, 'waiting players take the server\'s numbers');
    r = load({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body({ dhq_proj: proj(200) })) }) });
    await r.App.loadLeagueIntel();
    assert.equal(r.App.ServerProj, undefined, 'over two hours old: the device projects');
    r = load({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body({ dhq_proj: { week: 8, players: {} } })) }) });
    await r.App.loadLeagueIntel();
    assert.equal(r.App.ServerProj, undefined, 'an older build without the app results: the device projects');
    r = load({ cache: true, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ league_id: LID, built_at: proj(5).built_at, dhq_proj: proj(5) }) }) });
    await r.App.loadLeagueIntel();
    await tick();
    assert.equal(r.App.ServerProj.week, 8, 'values from the cache, projections from the server');
});
