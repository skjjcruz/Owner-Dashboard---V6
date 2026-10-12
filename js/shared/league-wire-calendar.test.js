// Run with:  node --test js/shared/league-wire-calendar.test.js
// "The edition publishes when the NFL week is finished" — C2's calendar
// (tests/league-wire-calendar.cjs @1be683d, ported) merged with our
// last_scored_leg rollover: the Wire takes the LATER of the two signals, the
// "all final" check runs on OUR ESPN-direct loader, and a relay copy never
// counts as final.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const babel = require('@babel/standalone');
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function calendarRoot() {
    const root = { Date, AbortController, setTimeout, clearTimeout, WrWireStories: { bounds: league => ({ start: Number(league.settings?.start_week) || 1, end: Math.min(18, (Number(league.settings?.playoff_week_start) || 19) - 1) }) } };
    vm.createContext(root); vm.runInContext(read('js/shared/league-wire-calendar.js'), root);
    return root;
}

test('C2 calendar: verified Tuesday rollover, provider fallback, correction window, season bounds, cancellation', async () => {
    const root = calendarRoot();
    const api = root.WrWireCalendar, league = { season: '2026', settings: { playoff_week_start: 15 } };
    const nfl = { season: '2026', season_type: 'regular', week: 4, leg: 4, display_week: 3 };
    const stateFetcher = async () => ({ ok: true, json: async () => ({ ...nfl }) });
    let scoreCalls = 0, final = true, fail = false;
    root.WrWireNfl = { loadWeek: async options => {
        scoreCalls++; assert.deepEqual(plain(options.phase), { season: '2026', week: 3, seasontype: 2 });
        assert.equal(options.force, true);
        if (fail) throw Error('Scoreboard unavailable');
        return { completionVerified: final };
    } };
    const fresh = await api.load({ fetcher: stateFetcher, force: true, now: () => 12345 });
    assert.equal(fresh.completedWeek, 3); assert.equal(fresh.provisional, true); assert.equal(fresh.checkedAt, 12345);
    assert.deepEqual(plain(fresh.nfl), nfl, 'the provider state stays intact');
    assert.deepEqual(plain(api.period(league, fresh)), { start: 1, end: 3, week: 4, live: true, provisional: true }, 'Tuesday can publish Week 3 and preview Week 4 before display_week rolls');
    final = false;
    const ongoing = await api.load({ fetcher: stateFetcher, force: true });
    assert.equal(ongoing.completedWeek, 2); assert.equal(ongoing.provisional, false);
    fail = true;
    const unavailable = await api.load({ fetcher: stateFetcher, force: true });
    assert.equal(unavailable.completedWeek, 2); assert.equal(unavailable.provisional, false, 'a scoreboard outage falls back to the provider cutoff');
    assert.equal(unavailable.scoreboardUnavailable, true);
    fail = false; final = true;
    await api.load({ fetcher: stateFetcher, force: true, now: () => 23456 });
    fail = true;
    const retained = await api.load({ fetcher: stateFetcher, force: true, now: () => 34567 });
    assert.equal(retained.completedWeek, 3); assert.equal(retained.provisional, true); assert.equal(retained.scoreboardUnavailable, true);
    assert.equal(retained.checkedAt, 23456, 'an outage retains the original completion check time, not a fresh claim');
    fail = false; final = false;
    await api.load({ fetcher: stateFetcher, force: true });
    fail = true;
    assert.equal((await api.load({ fetcher: stateFetcher, force: true })).completedWeek, 2, 'successful contradictory evidence revokes remembered completion');
    assert.equal(scoreCalls, 7);
    const rolled = { nfl: { ...nfl, display_week: 4 }, completedWeek: 3, provisional: false };
    assert.deepEqual(plain(api.period(league, rolled)), { start: 1, end: 3, week: 4, live: true, provisional: false }, 'the provider rollover does not advance twice');
    assert.equal(api.period({ ...league, season: '2025' }, fresh).provisional, false, 'current scoreboard evidence does not mark archives provisional');
    assert.deepEqual(plain(api.period({ ...league, season: '2027' }, fresh)), { start: 1, end: 0, week: 1, live: false, provisional: false });
    const afterRegular = { nfl: { ...nfl, display_week: 15 }, completedWeek: 15, provisional: true };
    assert.equal(api.period(league, afterRegular).end, 14, 'later NFL finals do not extend league regular-season records');
    for (const phase of ['pre', 'post', 'off']) {
        const state = { season: '2026', season_type: phase, week: 1 };
        const result = await api.load({ fetcher: async () => ({ ok: true, json: async () => state }) });
        assert.equal(result.provisional, false); assert.equal(scoreCalls, 7, phase + ' does not consult regular-season completion');
    }
    for (const invalid of [{}, { ...nfl, season: 'invalid' }, { ...nfl, display_week: 0, week: 0 }, { ...nfl, display_week: 19 }, { ...nfl, season_type: 'unknown' }]) {
        await assert.rejects(api.load({ fetcher: async () => ({ ok: true, json: async () => invalid }) }), /calendar could not be verified/);
    }
    await assert.rejects(api.load({ fetcher: async () => ({ ok: false }) }), /calendar could not load/);
    await assert.rejects(api.load({ fetcher: async () => { throw Error('Offline'); } }), /Offline/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api.load({ signal: controller.signal, fetcher: stateFetcher }), { name: 'AbortError' });
    root.WrWireNfl.loadWeek = async () => { const error = Error('Canceled'); error.name = 'AbortError'; throw error; };
    await assert.rejects(api.load({ fetcher: stateFetcher }), { name: 'AbortError' });
});

test('Dynasty HQ: rolloverWeek is the C2 signal as a week number; the Wire uses the LATER of it and last_scored_leg', () => {
    const { WrWireCalendar: api } = calendarRoot();
    const league = { season: '2026', settings: { playoff_week_start: 15 } };
    const nfl = { season: '2026', season_type: 'regular', week: 5, display_week: 5 };
    assert.equal(api.rolloverWeek(league, { nfl, completedWeek: 5, provisional: true }), 6, 'Monday night: every week-5 game final → this week is 6');
    assert.equal(api.rolloverWeek(league, { nfl, completedWeek: 4, provisional: false }), 0, 'games still to play: no advance');
    assert.equal(api.rolloverWeek(league, { nfl: { ...nfl, display_week: 6 }, completedWeek: 5, provisional: true }), 0, 'once Sleeper rolls, nothing extra');
    assert.equal(api.rolloverWeek({ ...league, season: '2025' }, { nfl, completedWeek: 5, provisional: true }), 0, 'another season never inherits it');
    assert.equal(api.rolloverWeek(league, { nfl: { ...nfl, season_type: 'post' }, completedWeek: 5, provisional: true }), 0);
    assert.equal(api.rolloverWeek(league, { nfl: { ...nfl, display_week: 18 }, completedWeek: 18, provisional: true }), 18, 'never past week 18');
    assert.equal(api.rolloverWeek(league, null), 0);
});

test('loadWeek runs on our ESPN-direct loader: strict raw check verifies a week; a relay copy never does', async () => {
    const fin = { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } };
    const event = (id, teams) => ({ id, date: '2026-10-12T00:15Z', season: { year: 2026, type: 2 }, week: { number: 5 }, status: fin, competitions: [{ id, date: '2026-10-12T00:15Z', status: fin, competitors: teams.map(([tid, ab], i) => ({ id: tid, homeAway: i ? 'away' : 'home', score: i ? '17' : '24', team: { id: tid, abbreviation: ab, displayName: ab } })) }] });
    const espn = { season: { year: 2026, type: 2 }, week: { number: 5 }, events: [event('401872001', [['1', 'BUF'], ['2', 'NE']]), event('401872002', [['3', 'DAL'], ['4', 'PHI']])] };
    const urls = [];
    const make = fetchImpl => {
        const root = { console, setTimeout, clearTimeout, AbortController, Date, fetch: fetchImpl, App: {} }; root.window = root; vm.createContext(root);
        vm.runInContext(read('js/shared/nfl-context.js'), root);
        root.App.NflContext.loadScoreboard = async () => { urls.push('relay'); return root.App.NflContext.parseScores(espn); };
        vm.runInContext(read('js/shared/league-wire-nfl.js'), root);
        return root;
    };
    const direct = make(async url => { urls.push(url); return { ok: true, json: async () => JSON.parse(JSON.stringify(espn)) }; });
    const week = await direct.WrWireNfl.loadWeek({ phase: { season: '2026', week: 5, seasontype: 2 } });
    assert.equal(week.completionVerified, true); assert.equal(week.source, 'espn');
    assert.match(urls[0], /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/scoreboard\?week=5&seasontype=2&dates=2026$/);
    const board = await direct.WrWireNfl.loadScoreboard(5, '2026', 2);
    assert.equal(urls.length, 1, 'the NFL desk and the calendar share one cached read');
    assert.equal(board.completionVerified, true);
    urls.length = 0;
    const relay = make(async () => { throw new Error('blocked'); });
    const fallback = await relay.WrWireNfl.loadWeek({ phase: { season: '2026', week: 5, seasontype: 2 } });
    assert.equal(fallback.source, 'relay'); assert.equal(fallback.completionVerified, false, 'a possibly 3-hour-old relay copy never publishes an edition');
    await assert.rejects(direct.WrWireNfl.loadWeek({ phase: { season: '2026', week: 0, seasontype: 2 } }), /could not be verified/);
});

// ── The page: later signal wins; honest provisional note; no polling while hidden ──
test('Wire page: calendar advance beats a stale last_scored_leg; note shows; hidden pages do not poll', async () => {
    const slots = []; let cursor = 0; const effects = []; const timers = new Map(); const listeners = new Set();
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }), Fragment: 'fragment',
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
        useRef: initial => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useMemo: fn => fn(), useCallback: fn => fn,
        useEffect: (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || !deps || deps.some((v, n) => v !== old.deps[n])) { slots[i] = { deps: deps || [], cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
    };
    const document = { hidden: false, addEventListener: (n, fn) => listeners.add(fn), removeEventListener: (n, fn) => listeners.delete(fn) };
    const calendarCalls = [], scoreWeeks = [];
    const window = { App: {}, fetch: async () => ({ ok: true, json: async () => ({ settings: { last_scored_leg: 4 } }) }), addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }),
        S: { nflState: { season: '2026', season_type: 'regular', week: 5, display_week: 5 } }, AbortController };
    let id = 0;
    const ctx = { React, window, document, console, AbortController, setTimeout: (fn, ms) => { const k = ++id; timers.set(k, { fn, ms }); return k; }, clearTimeout: k => timers.delete(k) };
    vm.createContext(ctx);
    for (const f of ['league-live-scores', 'league-live-table', 'league-wire-reading', 'league-wire-journal', 'league-wire-calendar']) vm.runInContext(read(`js/shared/${f}.js`).replace('typeof window !== \'undefined\' ? window : globalThis', 'window'), ctx);
    window.WrWireStories.loadArchive = async () => ({ seasons: [], complete: true });
    const history = [];
    window.App.LeagueLiveTable.loadHistory = args => new Promise(resolve => history.push({ ...args, resolve }));
    window.App.LeagueLiveScores.useScores = args => { scoreWeeks.push(args.week); return { week: args.week, rows: [], status: 'idle', error: null, updatedAt: 1, refresh() {} }; };
    window.WrWireCalendar.load = args => new Promise(resolve => calendarCalls.push({ ...args, resolve }));
    vm.runInContext(babel.transform(read('js/components/league-wire.js'), { presets: ['react'] }).code, ctx);
    const league = { league_id: '777', season: '2026', name: 'Calendar League', settings: { playoff_week_start: 15, last_scored_leg: 4 }, rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }], users: [] };
    const props = { currentLeague: league, standings: [], transactions: [], playersData: {}, sleeperUserId: '1' };
    const render = () => { cursor = 0; return window.WrLeagueWire(props); };
    const flush = () => { while (effects.length) effects.shift()(); };
    render(); flush(); await Promise.resolve();
    assert.equal(scoreWeeks.at(-1), 5, 'last_scored_leg 4 → this week is 5 (our rollover)');
    assert.equal(calendarCalls.length, 1, 'the calendar is checked when the Wire opens');
    calendarCalls[0].resolve({ nfl: window.S.nflState, completedWeek: 5, provisional: true, checkedAt: 1 });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    render();
    assert.equal(scoreWeeks.at(-1), 6, 'every week-5 NFL game final → the Wire moves on before Sleeper does');
    flush();
    assert.equal(history.at(-1).week, 6, 'the edition now reads completed weeks through 5');
    const rows = (a, b) => [{ roster_id: 1, matchup_id: 1, points: a, starters: ['p1'], players_points: { p1: a } }, { roster_id: 2, matchup_id: 1, points: b, starters: ['p2'], players_points: { p2: b } }];
    history.at(-1).resolve({ priorWeeks: [1, 2, 3, 4, 5].map(week => ({ week, rows: rows(100 + week, 90) })), updatedAt: 3 });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const text = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : (n.children || []).map(text).join(' ');
    const page = text(render()).replace(/\s+/g, ' ');
    assert.match(page, /All NFL games in Week 5 are final; stat corrections can still change the scores/, 'C2’s honest note while ahead of Sleeper');
    assert.match(page, /Results through Week 5/);
    assert([...timers.values()].some(t => t.ms === 5 * 60000), 'rechecks every 5 minutes while visible');
    document.hidden = true; [...listeners].forEach(fn => fn());
    assert(![...timers.values()].some(t => t.ms === 5 * 60000), 'no calendar polling while hidden');
    const before = calendarCalls.length; document.hidden = false; [...listeners].forEach(fn => fn());
    assert.equal(calendarCalls.length, before + 1, 'returning to the page rechecks');
    // An older calendar (not final) never pulls the Wire BEHIND last_scored_leg.
    calendarCalls.at(-1).resolve({ nfl: window.S.nflState, completedWeek: 4, provisional: false, checkedAt: 2 });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    render(); assert.equal(scoreWeeks.at(-1), 5);
    slots.forEach(s => s?.cleanup?.());
    assert.equal(listeners.size, 0, 'unmount removes the visibility listener');
});
