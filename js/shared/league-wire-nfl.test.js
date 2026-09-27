// Run with:  node --test js/shared/league-wire-nfl.test.js
// The Wire's NFL desk sources (js/shared/league-wire-nfl.js) and the desk /
// page components' honesty: ESPN direct is labelled fresh; the relay fallback
// (cached up to 3h in production) keeps only finals + kickoffs; ESPN/MFL
// leagues get a note and zero requests.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const babel = require('@babel/standalone');

const espnEvent = (id, state, completed, home, away) => ({ id, date: '2026-09-27T17:00:00Z', competitions: [{ status: { type: { name: completed ? 'STATUS_FINAL' : state === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED', state, completed, shortDetail: completed ? 'Final' : state === 'in' ? 'Q2 3:00' : '1:00 PM' } },
    competitors: [{ id: '1', homeAway: 'home', team: { abbreviation: 'KC', displayName: 'Kansas City Chiefs' }, score: String(home), linescores: [{ period: 1, value: home }] }, { id: '2', homeAway: 'away', team: { abbreviation: 'BUF', displayName: 'Buffalo Bills' }, score: String(away), linescores: [{ period: 1, value: away }] }],
    leaders: [{ name: 'passingYards', leaders: [{ athlete: { displayName: 'Sample Passer' }, team: { id: '1' }, displayValue: '200 YDS' }] }] }] });
const scoreboard = { events: [espnEvent('1', 'post', true, 27, 20), espnEvent('2', 'in', false, 10, 7), espnEvent('3', 'pre', false, '', '')] };

function load({ fetch, relay }) {
    const root = { console, setTimeout, clearTimeout, AbortController, fetch, App: {} };
    root.window = root; vm.createContext(root);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'nfl-context.js'), 'utf8'), root);
    if (relay) root.App.NflContext.loadScoreboard = relay;
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'league-wire-nfl.js'), 'utf8'), root);
    return root;
}

test('ESPN direct: fresh, labelled, cached per week, failures not cached', async () => {
    const urls = [];
    const root = load({ fetch: async url => { urls.push(url); return { ok: true, json: async () => scoreboard }; } });
    const res = await root.WrWireNfl.loadScoreboard(3, '2026', 2);
    assert.equal(res.source, 'espn');
    assert(Number.isFinite(res.checkedAt));
    assert.match(urls[0], /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/scoreboard\?week=3&seasontype=2&dates=2026$/);
    const live = res.games.find(g => g.state === 'in');
    assert.equal(live.homeScore, 10, 'a direct read keeps the live score');
    assert.equal(res.games.find(g => g.state === 'pre').homeScore, null, 'an unplayed game is never 0-0');
    await root.WrWireNfl.loadScoreboard(3, '2026', 2);
    assert.equal(urls.length, 1, 'one request per week per refresh window');
});

test('Relay fallback: finals and kickoffs only — never a possibly 3-hour-old live score', async () => {
    let relayCalls = 0;
    const parsedFromRelay = () => { relayCalls++; const root = load({ fetch: async () => ({ ok: true, json: async () => scoreboard }) }); return root.App.NflContext.parseScores(scoreboard); };
    const root = load({ fetch: async () => { throw Error('blocked'); }, relay: async () => parsedFromRelay() });
    const res = await root.WrWireNfl.loadScoreboard(3, '2026', 2);
    assert.equal(res.source, 'relay'); assert.equal(relayCalls, 1);
    const final = res.games.find(g => g.completed), live = res.games.find(g => g.id === '2'), pre = res.games.find(g => g.id === '3');
    assert.equal(final.homeScore, 27, 'final scores cannot go stale');
    assert.equal(live.liveUnavailable, true);
    assert.equal(live.homeScore, null); assert.equal(live.awayScore, null);
    assert.equal(live.leaders.length, 0, 'stale in-game leaders are dropped too');
    assert.equal(pre.kickoff, '2026-09-27T17:00:00Z', 'kickoff times survive');
    const dead = load({ fetch: async () => { throw Error('blocked'); }, relay: async () => { throw Error('relay down'); } });
    await assert.rejects(dead.WrWireNfl.loadScoreboard(3, '2026', 2));
});

test('Weekly stats: regular season via App.SOS; pre/post fetch their own phase (never regular stats under a PRE label)', async () => {
    const urls = [];
    const root = load({ fetch: async url => { urls.push(url); return { ok: true, json: async () => ({ p1: { pass_yd: 100 } }) }; } });
    root.App.SOS = { getWeekStats: async (s, w) => ({ via: 'sos', s, w }) };
    assert.equal((await root.WrWireNfl.weekStats('2026', 3, 'regular')).via, 'sos');
    assert.equal(urls.length, 0);
    await root.WrWireNfl.weekStats('2026', 2, 'pre');
    assert.equal(urls[0], 'https://api.sleeper.app/v1/stats/nfl/pre/2026/2');
    await root.WrWireNfl.weekStats('2026', 2, 'pre');
    assert.equal(urls.length, 1, 'cached');
    const failing = load({ fetch: async () => ({ ok: false }) });
    assert.equal(Object.keys(await failing.WrWireNfl.weekStats('2026', 1, 'post')).length, 0);
});

// Minimal hook harness for the page component.
function componentHarness(league, extra = {}) {
    const calls = [];
    const slots = []; let cursor = 0; const effects = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
        Fragment: 'fragment',
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
        useRef: initial => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
    };
    const window = { App: {}, fetch: async url => { calls.push(url); throw Error('unexpected network: ' + url); }, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }), S: {}, ...extra };
    const ctx = { React, window, document: { hidden: false, addEventListener() {}, removeEventListener() {} }, console, setTimeout, clearTimeout, AbortController };
    vm.createContext(ctx);
    for (const f of ['league-live-scores', 'league-live-table', 'league-wire-reading', 'league-wire-journal']) vm.runInContext(fs.readFileSync(path.join(__dirname, `${f}.js`), 'utf8').replace('typeof window !== \'undefined\' ? window : globalThis', 'window'), ctx);
    window.App.LeagueLiveScores.useScores = () => ({ week: 3, rows: [], status: 'idle', error: null });
    vm.runInContext(babel.transform(fs.readFileSync(path.join(__dirname, '..', 'components', 'league-wire.js'), 'utf8'), { presets: ['react'] }).code, ctx);
    const render = () => { cursor = 0; return window.WrLeagueWire({ currentLeague: league, standings: [], transactions: [], playersData: {}, sleeperUserId: '123' }); };
    return { render, effects, calls, window };
}
const nodes = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(nodes)] : [];
const text = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : n.children.map(text).join(' ');

test('Page: ESPN / MFL leagues get an honest note and make zero requests', async () => {
    for (const league of [{ id: 'espn_687493_2026', _platform: 'espn', season: '2026', name: 'ESPN league' }, { id: 'mfl_10005_2026', _mfl: true, season: '2026', name: 'MFL league' }]) {
        const h = componentHarness(league);
        const tree = h.render();
        h.effects.forEach(fn => fn());
        await new Promise(r => setTimeout(r, 10));
        assert.match(text(tree), /covers connected Sleeper leagues only/);
        assert(!nodes(tree).some(n => n.props?.className === 'wr-journal-nav'), 'no sections for an uncovered platform');
        assert.equal(h.calls.length, 0, league.name + ' made no requests');
    }
});

test('Page: Sleeper league renders the edition inline — no ticker, no dialog shell', () => {
    const h = componentHarness({ league_id: '999', season: '2026', name: 'Sample', settings: { playoff_week_start: 15 }, rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }], users: [] });
    const tree = h.render();
    assert.equal(tree.type, 'section');
    assert.match(tree.props.className, /wr-journal-page/);
    assert(!nodes(tree).some(n => n.type === 'dialog'), 'the edition is a page, not a modal');
    assert(!nodes(tree).some(n => /wr-wire-headline|wr-wire-mobile-launch/.test(n.props?.className || '')), 'no rotating ticker or phone launcher');
    assert(nodes(tree).some(n => n.props?.className === 'wr-journal-nav'));
    assert.match(text(tree), /gathering completed scores/);
});

test('NFL desk: relay copies say "live score unavailable" and show no number; ESPN copies carry a check time', () => {
    const h = componentHarness({ id: 'x', _platform: 'espn' });
    const Desk = h.window.WrNflDesk;
    const game = { id: '2', home: 'KC', away: 'BUF', homeName: 'Chiefs', awayName: 'Bills', homeScore: null, awayScore: null, state: 'in', completed: false, liveUnavailable: true, shortDetail: 'In progress', kickoff: '2026-09-27T17:00:00Z' };
    const relayTree = Desk({ desk: { phase: { season: '2026', seasontype: 2, week: 3 }, previousPhase: null, current: { status: 'ready', games: [game], source: 'relay', checkedAt: 1 }, previous: { status: 'ready', games: [] } } });
    assert.match(text(relayTree), /In progress · live score unavailable/);
    assert.match(text(relayTree), /live scores are unavailable right now/);
    assert(!/\b10\b/.test(text(relayTree)));
    assert(!nodes(relayTree).some(n => n.props?.className === 'wr-nfl-box'), 'no box score for an unverified live game');
    const fresh = Desk({ desk: { phase: { season: '2026', seasontype: 2, week: 3 }, previousPhase: null, current: { status: 'ready', games: [{ ...game, liveUnavailable: false, homeScore: 10, awayScore: 7, shortDetail: 'Q2 3:00' }], source: 'espn', checkedAt: Date.parse('2026-09-27T17:40:00Z') }, previous: { status: 'ready', games: [] } } });
    assert.match(text(fresh), /ESPN scoreboard · checked/);
    assert.match(text(fresh), /Q2 3:00/);
});
