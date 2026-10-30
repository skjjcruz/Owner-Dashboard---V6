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

test('projSettled: the projection engine can wait for this week\'s numbers (A8)', async () => {
    const proj = { week: 8, built_at: new Date().toISOString(), players: {}, app: { model: 'm1', results: { p1: { median: 1, mean: 1 } }, none: [], inj: {} } };
    let r = load({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body({ dhq_proj: proj })) }) });
    assert.equal(r.SI.projSettled(LID), null, 'nothing asked for yet');
    const go = r.App.loadLeagueIntel();
    assert.equal(await r.SI.projSettled(LID), true);
    await go;
    r = load({ cache: true, fetch: () => Promise.resolve({ ok: false, status: 404 }) });
    await r.App.loadLeagueIntel();
    assert.equal(await r.SI.projSettled(LID), false, 'the server had none: the page computes');
    assert.equal(r.SI.projSettled('999999999999'), null, 'another league');
});

test('later weeks come from dhq-league?part=later, once per league (Phase A3)', async () => {
    const later = { cur: 7, model: 'abc123def456', built_at: new Date().toISOString(), weeks: { 8: { p1: [10, 11, 6, 16, 'x'] } }, inj: {} };
    let r = load({ fetch: (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(/part=later/.test(u) ? { league_id: LID, dhq_later: later } : body()) }) });
    const a = await r.SI.later(LID);
    assert.equal(a.league_id, LID);
    assert.deepEqual(a.weeks, later.weeks);
    await r.SI.later(LID);
    assert.equal(r.fetches.filter(u => /part=later/.test(u)).length, 1, 'kept, not asked again');
    r = load({ fetch: () => Promise.resolve({ ok: false, status: 404 }) });
    assert.equal(await r.SI.later(LID), null, 'none built: the device projects');
    assert.equal(await r.SI.later('mfl_123'), null, 'Sleeper leagues only');
});

test('a league the server is building for the first time: asks again until its values land', async () => {
    let n = 0;
    const { App, SI, device, fetches } = load({ fetch: () => (++n < 3 ? Promise.resolve({ ok: false, status: 404 }) : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body()) })) });
    SI._wait.poll = 5;
    App.ServerBuild = { building: async () => true };
    await App.loadLeagueIntel();
    assert.equal(device.calls, 0);
    assert.equal(fetches.length, 3);
    assert.ok(/&t=\d+$/.test(fetches[2]), 'asked again past any cache');
    assert.equal(App.LI_SOURCE.source, 'server');
    assert.ok(App.LI_SOURCE.waited >= 0);
});

test('a first build that doesn\'t land in time, or a league the server didn\'t take: the device computes', async () => {
    for (const taken of [true, false]) {
        const { App, SI, device, fetches } = load({ fetch: () => Promise.resolve({ ok: false, status: 404 }) });
        SI._wait.poll = 5; SI._wait.ms = 40;
        App.ServerBuild = { building: async () => taken };
        await App.loadLeagueIntel();
        assert.equal(device.calls, 1);
        assert.equal(App.LI.device, true);
        if (!taken) assert.equal(fetches.length, 1, 'no waiting when the server never took it');
        else assert.ok(fetches.length > 1);
    }
});

test('the member moves to another league while waiting: nothing is loaded for the old one', async () => {
    const { App, SI, device } = load({ fetch: () => Promise.resolve({ ok: false, status: 404 }) });
    SI._wait.poll = 5; SI._wait.ms = 2000;
    App.ServerBuild = { building: async () => true };
    setTimeout(() => { App.S.currentLeagueId = '1389388885716385792'; }, 20);
    await App.loadLeagueIntel();
    assert.equal(App.LI_SOURCE, undefined);
    assert.equal(device.calls, 1, 'the loader then runs for the league on screen, as before');
});

test('waits only while the server is building the league (or briefly while it is queued)', async () => {
    const nf = queue => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not built', queue }) });
    for (const [queue, waits] of [['building', true], ['pending', true], [null, false], ['failed', false]]) {
        const { App, SI, device, fetches } = load({ fetch: () => nf(queue) });
        SI._wait.poll = 5; SI._wait.ms = 60; SI._wait.pending = 30;
        App.ServerBuild = { building: async () => true };
        await App.loadLeagueIntel();
        assert.equal(device.calls, 1, queue + ': the device computes in the end');
        assert.equal(fetches.length > 1, waits, queue + (waits ? ' waits' : ' does not wait'));
    }
});

test('remote compute: posts the gathered league, waits for the server, returns its values', async () => {
    const calls = [];
    let polls = 0;
    const { App, SI } = load({ fetch: (url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body()) }) });
    globalThis.fetch = (url, init) => {
        calls.push([url, init && init.method, init && init.body]);
        if (init && init.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'abc' }) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(++polls < 2 ? { status: 'building' } : { status: 'done', intel: intel(150) }) });
    };
    SI._computeWait.poll = 5;
    const S = { currentLeagueId: 'espn_1_2026', season: '2026', platform: 'espn', rosters: [{ roster_id: 1, players: ['4046', 'espn_9'] }],
        players: { 4046: { position: 'QB' }, 4047: { position: 'WR', _espn_id: 77 }, espn_9: { position: 'RB' } }, leagues: [{ league_id: 'espn_1_2026', scoring_settings: {} }] };
    const LI = await App.remoteComputeLeagueIntel({ S, platform: 'espn', gathered: { leagueId: 'espn_1_2026', chain: [], allDraftPicks: [] } });
    assert.equal(Object.keys(LI.playerScores).length, 150);
    assert.equal(typeof LI.dhqPickValueFn, 'function');
    assert.equal(App.LI_SOURCE.source, 'server-compute');
    const sent = JSON.parse(calls[0][2]);
    assert.equal(sent.league_key, 'espn_1_2026');
    assert.deepEqual(Object.keys(sent.payload.players).sort(), ['4047', 'espn_9'], 'only records the server lacks or a platform laid over Sleeper\'s');
    assert.ok(calls.slice(1).every(c => /\?id=abc$/.test(c[0])));
});

test('remote compute: a failed or refused compute rejects (no values rather than wrong ones)', async () => {
    const { App, SI } = load();
    SI._computeWait.poll = 5;
    const S = { currentLeagueId: LID, season: '2026', rosters: [], players: {}, leagues: [{ league_id: LID }] };
    globalThis.fetch = () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: 'busy' }) });
    await assert.rejects(App.remoteComputeLeagueIntel({ S, gathered: { leagueId: LID } }), /not accepted/);
    globalThis.fetch = (u, init) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(init && init.method === 'POST' ? { id: 'x' } : { status: 'failed', error: 'boom' }) });
    await assert.rejects(App.remoteComputeLeagueIntel({ S, gathered: { leagueId: LID } }), /compute failed/);
});
