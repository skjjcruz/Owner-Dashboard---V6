// Run with:  node --test js/shared/league-wire-desks.test.js
// The Wire's Records + Trends desks. Engine assertions ported from C2
// (tests/league-wire-desks.cjs, tests/league-wire-trends-scope.cjs @1be683d);
// the UI checks run our re-themed components through @babel/standalone.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const babel = require('@babel/standalone');
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

function engines() {
    const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
    for (const name of ['identity', 'records', 'trends']) vm.runInContext(read(`js/shared/league-wire-${name}.js`), ctx);
    return ctx;
}
const league = { league_id: '100', season: '2026', settings: {}, scoring_settings: { factor: 2 }, rosters: [{ roster_id: 1, owner_id: 'a', players: ['a', 'b', 'c', 'd', 'e'] }], users: [{ user_id: 'a', display_name: 'Owner A', metadata: { team_name: 'Team A' } }] };
const previous = { league_id: '99', season: '2025', rosters: [{ roster_id: 8, owner_id: 'a' }], users: [{ user_id: 'a', display_name: 'Owner A', metadata: { team_name: 'Old A' } }] };

test('C2 records: standing records, verified zero, owner scope across slots, historical sources', () => {
    const ctx = engines();
    const holder = { rosterId: 1, week: 2, points: 0 };
    const edition = { completedThrough: 2, high: 0, records: [holder], stories: [], archive: { high: 99, records: [{ season: '2025', week: 4, ownerId: 'a', ownerName: 'Owner A', teamName: 'Old A' }], margin: 30, margins: [{ season: '2025', week: 4, ownerId: 'b', name: 'Owner B' }], seasons: ['2025', '2026'], allSeasons: ['2025', '2026'] } };
    const book = ctx.WrWireRecords.build({ league, edition, priorSeasons: [{ league: previous }] });
    assert.equal(book.cards.length, 3, 'record book is independent of record-breaking news');
    assert.equal(book.cards[0].value, 0, 'verified zero is a record, not missing evidence');
    assert.equal(book.cards[0].holders[0].ownerName, 'Owner A');
    assert.equal(book.cards[1].holders[0].sourceUrl, 'https://api.sleeper.app/v1/league/99/matchups/4');
    assert.equal(ctx.WrWireRecords.filter(book, { ownerFilter: { ownerId: 'a', rosterId: 1 }, season: '2026' }).length, 2, 'owner follows across changed roster slots');
    assert.equal(ctx.WrWireRecords.filter(book, { ownerFilter: { ownerId: null, rosterId: 1 }, season: '2026' }).length, 1, 'unknown owner cannot inherit old roster history');
    assert.equal(ctx.WrWireRecords.filter(book, { search: 'Old A' }).length, 1);
    // Dynasty HQ: our journal's archive holders carry rosterId (no ownerId) —
    // the owner is resolved from THAT season's rosters, not today's.
    const ours = { completedThrough: 3, high: 140, records: [{ rosterId: 1, week: 3, points: 140 }], archive: { high: 150, records: [{ season: '2025', week: 6, rosterId: 8, name: 'Old A', points: 150 }], margin: null, margins: [], seasons: ['2025', '2026'], allSeasons: ['2025', '2026'] } };
    const ourBook = ctx.WrWireRecords.build({ league, edition: ours, priorSeasons: [{ league: previous }] });
    assert.equal(ourBook.cards.length, 2, 'a missing margin record is no card (never a made-up 0)');
    assert.equal(ourBook.cards[1].holders[0].ownerName, 'Owner A');
    assert.equal(ourBook.cards[1].holders[0].teamName, 'Old A', 'the season’s own team name is kept');
    assert.equal(ourBook.cards[1].holders[0].sourceUrl, 'https://api.sleeper.app/v1/league/99/matchups/6');
    assert.equal(ctx.WrWireRecords.filter(ourBook, { ownerFilter: { ownerId: 'a', rosterId: 1 }, season: '2026' }).length, 2);
    assert.equal(ourBook.cards[0].scope, '2026 · through Week 3');
});

test('C2 trends: windows, league scoring, real zero/negative, missing ≠ zero, bounded loading, cancellation', async () => {
    const ctx = engines(), trends = ctx.WrWireTrends;
    assert.deepEqual([...trends.windowFor(1)], []);
    assert.deepEqual([...trends.windowFor(2)], [1, 2]);
    assert.deepEqual([...trends.windowFor(9)], [4, 5, 6, 7, 8, 9]);
    const players = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(pid => [pid, { full_name: pid.toUpperCase(), position: 'RB' }]));
    const weeks = [1, 2, 3, 4].map(week => ({ week, stats: { a: { gp: 1, pts: week < 3 ? 5 : 10 }, b: { gp: 1, pts: week < 3 ? 0 : -3 }, c: { gp: 1, pts: week < 3 ? 12 : 5 }, d: { gp: 0, pts: 999 }, ...(week !== 2 ? { e: { gp: 1, pts: 100 } } : {}) } }));
    const calculate = (raw, scoring) => raw.pts * scoring.factor;
    const result = trends.build({ league, throughWeek: 4, weeks: [...weeks, { week: 5, stats: { a: { gp: 1, pts: 9999 } } }], players, calculate });
    assert.equal(result.rows.find(row => row.pid === 'a').delta, 10, 'league scoring and selected completed-week cutoff apply');
    assert.equal(result.rows.find(row => row.pid === 'b').delta, -6, 'real zero and negative scores count');
    assert(!result.rows.some(row => ['d', 'e'].includes(row.pid)), 'absences and missing observations do not become zero');
    const activeOnly = weeks.map(entry => ({ week: entry.week, stats: { a: { gms_active: 1, pos_rank_ppr: 999, pts: entry.week < 3 ? 10 : 0 } } }));
    assert.equal(trends.build({ league, throughWeek: 4, weeks: activeOnly, players, calculate }).rows.length, 0, 'being active without a recorded appearance cannot create zero-point games');
    assert.match(trends.build({ league, throughWeek: 4, weeks: weeks.slice(1), players, calculate }).reason, /could not load/);
    // App.SOS.getWeekStats answers {} on a failed read: that is missing, not zeros.
    assert.match(trends.build({ league, throughWeek: 4, weeks: weeks.map((w, i) => i === 3 ? { week: 4, stats: {} } : w), players, calculate }).reason, /could not load/);
    const one = { league_id: 'one', season: '2026', rosters: [{ roster_id: 1, players: ['p'] }, { roster_id: 2, players: [] }], scoring_settings: { rec: 1 } };
    const onePlayers = { p: { full_name: 'Real Player', position: 'WR' } };
    const build = (opts = {}) => trends.build({ league: one, throughWeek: 2, weeks: [{ week: 1, stats: { p: { gp: 1, rec: 0 } } }, { week: 2, stats: { p: { gp: 1, rec: 4 } } }], players: onePlayers, calculate: (raw, scoring) => (raw.rec || 0) * scoring.rec, ...opts });
    assert.equal(build().rows[0].prior, 0, 'recorded zero is retained');
    assert.equal(build().rows[0].delta, 4);
    for (const scoring of [null, {}, { rec: '1' }]) assert.match(build({ league: { ...one, scoring_settings: scoring } }).reason, /scoring is unavailable/);
    assert.equal(build({ league: { ...one, scoring_settings: { rec: 0 } } }).reason, '', 'verified zero-point rule remains valid');
    const calls = []; let concurrent = 0, peak = 0;
    await trends.load({ league, throughWeek: 4, players, calculate, getWeekStats: async (season, week, type) => { calls.push([season, week, type]); concurrent++; peak = Math.max(peak, concurrent); await Promise.resolve(); concurrent--; return weeks[week - 1].stats; } });
    assert.equal(calls.length, 4); assert(peak <= 2); assert(calls.every(call => call[0] === '2026' && call[2] === 'regular'));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(() => trends.load({ league, throughWeek: 4, players, calculate, signal: abort.signal, getWeekStats: () => { throw Error('Should not fetch'); } }), { name: 'AbortError' });
});

// ── UI harness (minimal hooks; components are called as functions) ──
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function ui(file, extraWindow = {}) {
    let cursor = 0;
    const slots = [], effects = [], timers = new Set();
    const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }), Fragment: 'fragment',
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useRef: initial => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useMemo: fn => fn(),
        useEffect: (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } } };
    const window = { AbortController, ...extraWindow };
    const ctx = { React, window, console, setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn) };
    vm.createContext(ctx); vm.runInContext(babel.transform(read(file), { presets: ['react'] }).code, ctx);
    return { window, timers, reset() { cursor = 0; }, flush() { while (effects.length) effects.shift()(); }, unmount() { slots.forEach(s => s?.cleanup?.()); } };
}

test('Trends panel: loads on mount only, same-week trade hides stale rows, account/edition isolation, cancellation, team label', async () => {
    const shared = engines();
    const one = { league_id: 'one', season: '2026', rosters: [{ roster_id: 1, players: ['p'] }, { roster_id: 2, players: [] }], scoring_settings: { rec: 1 } };
    const players = { p: { full_name: 'Real Player', position: 'WR' } };
    const build = (lg = one) => shared.WrWireTrends.build({ league: lg, throughWeek: 2, weeks: [{ week: 1, stats: { p: { gp: 1, rec: 0 } } }, { week: 2, stats: { p: { gp: 1, rec: 4 } } }], players, calculate: (raw, scoring) => (raw.rec || 0) * scoring.rec });
    const calls = [];
    const h = ui('js/components/league-wire-trends.js', { WrWireTrends: { load: args => new Promise((resolve, reject) => calls.push({ ...args, resolve, reject })) } });
    let props = { league: one, players, throughWeek: 2, accountScope: 'a', nameFor: rid => 'Team ' + rid };
    const render = update => { props = { ...props, ...update }; h.reset(); return h.window.WrWireTrendsPanel(props); };
    render(); h.flush(); await settle(); assert.equal(calls.length, 1);
    calls[0].resolve(build()); await settle();
    let tree = render(); assert.match(text(tree), /Real Player/); assert.match(text(tree), /WR · Team 1/, 'the fantasy team is named');
    assert.match(text(tree), /\+ ?4\.00 fantasy pts per game/);
    const traded = { ...one, rosters: [{ roster_id: 1, players: [] }, { roster_id: 2, players: ['p'] }] };
    assert.doesNotMatch(text(render({ league: traded, teamFilter: '1' })), /Real Player/, 'same-week ownership change hides old rows before effects'); h.flush(); await settle(); assert.equal(calls.length, 2);
    calls[1].resolve(build(traded)); await settle(); assert.doesNotMatch(text(render()), /Real Player/);
    assert.match(text(render({ teamFilter: '2' })), /Real Player/);
    assert.doesNotMatch(text(render({ accountScope: 'b' })), /Real Player/); h.flush(); await settle(); assert.equal(calls.length, 3);
    render({ throughWeek: 3 }); h.flush(); assert(calls[2].signal.aborted, 'edition change cancels stale work'); await settle();
    calls[3].resolve({ rows: [], range: [], priorWeeks: [], recentWeeks: [], reason: 'This league’s scoring is unavailable. Refresh to try again.' }); await settle();
    tree = render(); assert.match(text(tree), /scoring is unavailable/); assert.match(text(tree), /Retry recent stats/);
    h.unmount(); assert(calls[3].signal.aborted, "unmount cancels the request");
});

test('Record book UI: owner + team + receipt link; filters; honest empty states; no images', () => {
    const shared = engines();
    const edition = { completedThrough: 3, high: 140.5, records: [{ rosterId: 1, week: 3, points: 140.5 }], archive: { high: 150, records: [{ season: '2025', week: 6, rosterId: 8, name: 'Old A', points: 150 }], margin: 40, margins: [{ season: '2025', week: 2, rosterId: 8, name: 'Old A', points: 40 }], seasons: ['2025', '2026'], allSeasons: ['2025', '2026'] } };
    const book = shared.WrWireRecords.build({ league, edition, priorSeasons: [{ league: previous }], complete: true });
    const h = ui('js/components/league-wire-records.js', { WrWireRecords: shared.WrWireRecords });
    const tree = h.window.WrWireRecordBook({ book, league: { ...league, name: 'Sample League' } });
    const t = text(tree);
    assert.match(t, /Sample League record book/); assert.match(t, /140\.50/); assert.match(t, /Owner A/); assert.match(t, /Old A/); assert.match(t, /2025 · Week 6/);
    assert.match(t, /Largest archived win/); assert.match(t, /point margin/);
    assert(nodes(tree).some(n => n.type === 'a' && n.props.href === 'https://api.sleeper.app/v1/league/99/matchups/6'));
    assert(!nodes(tree).some(n => n.type === 'img'), 'no logos or avatars');
    assert.match(text(h.window.WrWireRecordBook({ book, league, search: 'nobody here' })), /No record holders match/);
    assert.match(text(h.window.WrWireRecordBook({ book: { cards: [] }, league })), /Records appear after the first completed week/);
});
