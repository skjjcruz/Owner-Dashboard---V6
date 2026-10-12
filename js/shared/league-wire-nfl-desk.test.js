// Run with:  node --test js/shared/league-wire-nfl-desk.test.js
// C2's NFL desk upgrade MERGED into our WrWireNfl (tests/league-wire-nfl.cjs
// and tests/league-wire-nfl-ui.cjs @1be683d, ported): game recaps, quarter
// stories only when the quarters add up, standouts, per-game player boxes
// (Sleeper first, ESPN's public summary read directly — never our relay,
// which has no event=<id>), and the strict "week is final" check. Our
// existing API (loadScoreboard / weekStats / liveWeekStats / relaySafe) is
// covered by league-wire-nfl.test.js and must keep passing unchanged.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const babel = require('@babel/standalone');
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

function load(fetchImpl) {
    const root = { console, setTimeout, clearTimeout, AbortController, Date, Intl, fetch: fetchImpl || (async () => { throw Error('no network'); }), App: {} };
    root.window = root; vm.createContext(root);
    vm.runInContext(read('js/shared/nfl-context.js'), root);
    vm.runInContext(read('js/shared/league-wire-nfl.js'), root);
    return root;
}
const game = { id: '401772510', season: '2025', week: 1, seasontype: 2, kickoff: '2025-09-05T00:20Z', home: 'PHI', away: 'DAL', homeName: 'Philadelphia Eagles', awayName: 'Dallas Cowboys', homeScore: 24, awayScore: 20, completed: true, state: 'post', shortDetail: 'Final', homePeriods: [7, 14, 3, 0].map((value, i) => ({ period: i + 1, value })), awayPeriods: [7, 13, 0, 0].map((value, i) => ({ period: i + 1, value })) };
const athlete = (id, displayName, stats) => ({ athlete: { id, displayName }, stats });
const summary = { header: { id: game.id, competitions: [{ status: { type: { completed: true, state: 'post', shortDetail: 'Final' } }, competitors: [{ id: '21', homeAway: 'home', score: '24', team: { id: '21', abbreviation: 'PHI', displayName: game.homeName } }, { id: '6', homeAway: 'away', score: '20', team: { id: '6', abbreviation: 'DAL', displayName: game.awayName } }] }] }, boxscore: { players: [
    { team: { id: '21' }, statistics: [{ name: 'rushing', keys: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'], labels: ['CAR', 'YDS', 'TD'], descriptions: ['Carries', 'Rushing yards', 'Touchdowns'], athletes: [athlete('4040715', 'Jalen Hurts', ['14', '62', '2'])] }] },
    { team: { id: '6' }, statistics: [{ name: 'receiving', keys: ['receptions', 'receivingYards', 'receivingTouchdowns', 'receivingTargets'], labels: ['REC', 'YDS', 'TD', 'TGTS'], athletes: [athlete('4241389', 'CeeDee Lamb', ['7', '110', '0', '13'])] }] },
] } };
const player = (id, first, last, team, opponent, stats) => ({ category: 'stat', date: '2025-09-04', week: 1, season: '2025', season_type: 'regular', team, opponent, game_id: '202510126', player_id: id, player: { first_name: first, last_name: last, position: 'QB', team: 'NYJ' }, stats });
const rows = [player('6904', 'Jalen', 'Hurts', 'PHI', 'DAL', { pass_att: 23, pass_cmp: 19, pass_yd: 152, rush_att: 14, rush_yd: 62, rush_td: 2 }), player('6786', 'CeeDee', 'Lamb', 'DAL', 'PHI', { rec: 7, rec_tgt: 13, rec_yd: 110 })];

test('C2 parsers + recaps: verified joins, original teams, missing ≠ zero, substantive quarter stories only when they add up', () => {
    const api = load().WrWireNfl;
    for (const fn of ['loadScoreboard', 'weekStats', 'liveWeekStats', 'relaySafe']) assert.equal(typeof api[fn], 'function', 'our API is kept: ' + fn);
    const box = api.parseSummary(summary, game);
    assert.equal(box.teams[0].abbr, 'DAL');
    assert.match(api.recap(game, box).spotlight.join(' '), /Jalen Hurts ran for 62 yards and 2 touchdowns on 14 carries/);
    assert.match(api.recap(game, box).spotlight.join(' '), /7 passes for 110 yards on 13 targets/);
    const missing = clone(summary); missing.boxscore.players[0].statistics[0].athletes[0].stats = ['14', '62'];
    assert.equal(api.parseSummary(missing, game).teams[1].groups[0].players[0].values[2], null);
    assert.throws(() => api.parseSummary(summary, { ...game, id: '401772511' }), /unavailable/);
    assert.throws(() => api.parseSummary(summary, { ...game, away: 'NYG' }), /does not match/);
    const duplicate = clone(summary); duplicate.boxscore.players.push(duplicate.boxscore.players[0]);
    assert.throws(() => api.parseSummary(duplicate, game), /duplicate teams/);
    const sleeper = api.parseSleeper(rows, game);
    assert.equal(sleeper.statsSource, 'Sleeper');
    assert.match(sleeper.source, /^https:\/\/api\.sleeper\.app\/stats\/nfl\/2025\/1\?season_type=regular$/, 'a host already in our CSP (api.sleeper.app)');
    assert.equal(sleeper.teams[1].abbr, 'PHI', 'original game team overrides current player team');
    assert.equal(sleeper.teams[0].groups.find(g => g.id === 'receiving').players[0].stats.receivingTouchdowns, null, 'omitted zero values are unavailable, never invented');
    assert.throws(() => api.parseSleeper(rows, { ...game, week: 2 }), /matched/);
    assert.throws(() => api.parseSleeper(rows, { ...game, kickoff: '2025-09-12T00:20Z' }), /matched/);
    assert.throws(() => api.parseSleeper(rows.slice(0, 1), game), /both teams/);
    assert.throws(() => api.parseSleeper([...rows, { ...rows[0], stats: { pass_yd: 900 } }], game), /Conflicting/);
    assert.equal(api.recap({ ...game, completed: false }).headline, '');
    assert.equal(api.recap({ ...game, homeScore: null }).headline, '');
    assert.match(api.recap({ ...game, homeScore: 20 }).headline, /20–20 tie/);
    assert.equal(api.recap({ ...game, homeScore: 20 }).body, '');
    const comeback = { ...game, homeScore: 24, awayScore: 17, homePeriods: [0, 0, 7, 17].map((value, i) => ({ value, period: i + 1 })), awayPeriods: [7, 3, 7, 0].map((value, i) => ({ value, period: i + 1 })) };
    assert.match(api.recap(comeback).body, /10-point deficit after three quarters/);
    assert.equal(api.recap({ ...comeback, homeScore: 25 }).body, '', 'inconsistent quarter totals cannot support a swing');
    assert.equal(api.recap({ ...comeback, homePeriods: comeback.homePeriods.slice(1) }).body, '');
    assert.equal(api.recap({ ...game, homeScore: 25 }, box).spotlight.length, 0, 'mismatched score snapshots never enrich the result');
    const withLeaders = { ...game, leaders: [{ category: 'Passing', name: 'QB One', team: 'PHI', stats: '200 YDS' }, { category: 'Receiving', name: 'WR One', team: 'DAL', stats: '7-110 YDS' }] };
    assert.deepEqual([...api.recap(withLeaders).spotlight], ['WR One: 7-110 YDS (DAL).'], 'without a box, ESPN’s own game leader is the standout');
});

test('loadBoxScore: Sleeper first on api.sleeper.app, ESPN summary DIRECT as fallback, never the relay; cached, cancellable', async () => {
    const urls = [];
    let mode = 'ok';
    const root = load(async (url, options) => {
        urls.push(url);
        assert.equal(options.credentials, 'omit');
        if (/api\.sleeper\.app\/stats\/nfl\//.test(url)) return { ok: true, json: async () => (mode === 'ok' ? clone(rows) : []) };
        if (/site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/summary\?event=401772510$/.test(url)) return mode === 'down' ? { ok: false, status: 500 } : { ok: true, json: async () => clone(summary) };
        throw Error('unexpected ' + url);
    });
    let relayCalls = 0; root.App.NflContext.loadScoreboard = async () => { relayCalls++; return []; };
    const api = root.WrWireNfl;
    const a = await api.loadBoxScore({ game });
    assert.equal(a.statsSource, 'Sleeper'); assert.equal(urls.length, 1);
    assert.equal(urls[0], 'https://api.sleeper.app/stats/nfl/2025/1?season_type=regular');
    const b = await api.loadBoxScore({ game });
    assert.equal(urls.length, 1, 'cached'); assert.equal(b.checkedAt, a.checkedAt, 'cached reads keep the real request time');
    await api.loadBoxScore({ game, force: true }); assert.equal(urls.length, 2, 'refresh bypasses the cache');
    mode = 'nosleeper';
    const fallback = await api.loadBoxScore({ game, force: true });
    assert.equal(fallback.statsSource, 'ESPN');
    assert(urls.some(u => /site\.api\.espn\.com\/.*summary\?event=401772510$/.test(u)), 'ESPN read directly');
    mode = 'down';
    await assert.rejects(api.loadBoxScore({ game, force: true }), /unavailable right now/);
    assert(!urls.some(u => /nfl-scoreboard|event=.*&|\/api\//.test(u)), 'never through our relay');
    assert.equal(relayCalls, 0);
    await assert.rejects(api.loadBoxScore({ game: { ...game, id: 'bad' } }), /verified game ID/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api.loadBoxScore({ game, signal: controller.signal, force: true }), { name: 'AbortError' });
});

test('C2 completedSchedule: only an exactly-scoped, all-final raw week verifies (mutation table)', () => {
    const api = load().WrWireNfl;
    const parse = data => { const r = load(); return r.App.NflContext.parseScores(data); };
    const phase = { season: '2026', week: 3, seasontype: 2 };
    const finalStatus = { type: { completed: true, state: 'post', name: 'STATUS_FINAL' } };
    const event = (id, teams, date) => ({ id, date, season: { year: 2026, type: 2 }, week: { number: 3 }, status: clone(finalStatus), competitions: [{ id, date, status: clone(finalStatus), competitors: teams.map(([teamId, abbreviation], i) => ({ id: teamId, homeAway: i ? 'away' : 'home', score: i ? '0' : '21', team: { id: teamId, abbreviation } })) }] });
    const schedule = { season: { year: 2026, type: 2 }, week: { number: 3 }, events: [event('401872001', [['1', 'BUF'], ['2', 'NE']], '2026-09-28T23:00Z'), event('401872002', [['3', 'DAL'], ['4', 'PHI']], '2026-09-29T00:30Z')] };
    const verify = data => api.completedSchedule(data, phase, parse(data));
    assert.equal(verify(schedule), true, 'all games in a Monday doubleheader final; zero scores remain valid');
    for (const [label, mutate] of [
        ['empty schedule', d => { d.events = []; }],
        ['unfinished second game', d => { d.events[1].competitions[0].status.type = { completed: false, state: 'in', name: 'STATUS_IN_PROGRESS' }; }],
        ['future game', d => { d.events[1].competitions[0].status.type = { completed: false, state: 'pre', name: 'STATUS_SCHEDULED' }; }],
        ['postponed final flag', d => { d.events[1].competitions[0].status.type.name = 'STATUS_POSTPONED'; }],
        ['canceled final flag', d => { d.events[1].status.type.name = 'STATUS_CANCELED'; }],
        ['truthy nonboolean completion', d => { d.events[1].competitions[0].status.type.completed = 'true'; }],
        ['wrong response year', d => { d.season.year = 2025; }],
        ['wrong response week', d => { d.week.number = 2; }],
        ['wrong response phase', d => { d.season.type = 1; }],
        ['missing response scope', d => { delete d.week; }],
        ['wrong event week', d => { d.events[1].week.number = 2; }],
        ['duplicate event', d => { d.events[1] = clone(d.events[0]); }],
        ['mismatched competition', d => { d.events[1].competitions[0].id = '401879999'; }],
        ['duplicate team', d => { d.events[1].competitions[0].competitors[1] = clone(d.events[0].competitions[0].competitors[1]); }],
        ['unknown team', d => { d.events[1].competitions[0].competitors[1].team.abbreviation = 'BAD'; }],
        ['missing score', d => { delete d.events[1].competitions[0].competitors[1].score; }],
        ['negative NFL score', d => { d.events[1].competitions[0].competitors[1].score = '-1'; }],
    ]) { const data = clone(schedule); mutate(data); assert.equal(verify(data), false, label + ' cannot advance an edition'); }
    const tie = clone(schedule); tie.events[1].competitions[0].competitors.forEach(team => { team.score = '21'; });
    assert.equal(verify(tie), true, 'a final tied game is complete');
});

// ── UI ──
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('Player stats UI: nothing fetched until tapped; cancel on close / game change; stale box kept on a failed refresh; standouts', async () => {
    let cursor = 0, props = { game }, tree;
    const slots = [], effects = [], calls = [];
    const React = {
        createElement: (type, p, ...children) => ({ type, props: p || {}, children: children.flat(Infinity) }), Fragment: 'fragment',
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useEffect: (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
    };
    const real = load().WrWireNfl;
    const window = { AbortController, WrWireNfl: { recap: real.recap, loadBoxScore: args => new Promise((resolve, reject) => calls.push({ ...args, resolve, reject })) } };
    const ctx = { React, window }; vm.createContext(ctx); vm.runInContext(babel.transform(read('js/components/league-wire-nfl.js'), { presets: ['react'] }).code, ctx);
    const render = update => { props = { ...props, ...update }; cursor = 0; tree = window.WrNflPlayerStats(props); return tree; };
    const flush = () => { while (effects.length) effects.shift()(); };
    const toggle = () => nodes(tree).find(n => n.props.className === 'wr-nfl-open-box').props.onClick();
    render(); flush(); await settle(); assert.equal(calls.length, 0, 'opening the scoreboard does not fetch player boxes');
    assert.match(text(tree), /Load player stats/);
    const btn = nodes(tree).find(n => n.props.className === 'wr-nfl-open-box'); assert.equal(btn.type, 'button');
    toggle(); render(); flush(); await settle(); assert.equal(calls.length, 1); assert.equal(calls[0].force, false);
    calls[0].resolve({ ...real.parseSleeper(rows, game), checkedAt: 1 }); await settle(); tree = render();
    assert(nodes(tree).some(n => n.type?.name === 'WrNflPlayerBox'));
    assert.match(text(tree), /Standouts/); assert.match(text(tree), /Jalen Hurts ran for 62 yards and 2 touchdowns/);
    nodes(tree).find(n => n.type === 'button' && /Refresh player stats/.test(text(n))).props.onClick(); render(); flush(); await settle(); assert.equal(calls[1].force, true);
    calls[1].reject(Error('Player stats for this game are unavailable right now. Try again later.')); await settle(); tree = render();
    assert.match(text(tree), /unavailable right now/); assert.match(text(tree), /last player stats that loaded/); assert(nodes(tree).some(n => n.type?.name === 'WrNflPlayerBox'));
    nodes(tree).find(n => n.type === 'button' && text(n) === 'Try again').props.onClick(); render(); flush(); await settle(); const pending = calls[2];
    toggle(); render(); flush(); assert(pending.signal.aborted, 'closing cancels the request');
    toggle(); render(); flush(); await settle(); const old = calls[3];
    tree = render({ game: { ...game, id: '401772511', week: 2 } }); assert(!nodes(tree).some(n => n.type?.name === 'WrNflPlayerBox'), 'a different game hides the old box before effects'); flush(); assert(old.signal.aborted);
    slots.forEach(s => s?.cleanup?.());
    // The player table itself: team + category pickers, dashes for missing.
    cursor = 0; const boxTree = window.WrNflPlayerBox({ data: { ...real.parseSleeper(rows, game), checkedAt: 1 } });
    assert.match(text(boxTree), /Player stats: Sleeper/); assert.match(text(boxTree), /not fantasy points/);
    assert(nodes(boxTree).some(n => n.props['aria-label'] === 'Box score team')); assert(!nodes(boxTree).some(n => n.type === 'img'));
});

test('NFL desk card: recap headline + quarter story + leader standout; player stats only for scored games with a phase', () => {
    const slots = []; let cursor = 0;
    const React = { createElement: (type, p, ...children) => ({ type, props: p || {}, children: children.flat(Infinity) }), Fragment: 'fragment',
        useState: i => { const k = cursor++; if (!(k in slots)) slots[k] = i; return [slots[k], () => {}]; }, useRef: v => ({ current: v }), useMemo: fn => fn(), useCallback: fn => fn, useEffect: () => {} };
    const real = load().WrWireNfl;
    const window = { App: {}, WrWireNfl: real, WrNflPlayerStats: function WrNflPlayerStats() { return null; }, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
    const ctx = { React, window, document: { hidden: false, addEventListener() {}, removeEventListener() {} }, console, setTimeout, clearTimeout, AbortController };
    vm.createContext(ctx); vm.runInContext(babel.transform(read('js/components/league-wire.js'), { presets: ['react'] }).code, ctx);
    const comeback = { ...game, homeScore: 24, awayScore: 17, homePeriods: [0, 0, 7, 17].map((value, i) => ({ value, period: i + 1 })), awayPeriods: [7, 3, 7, 0].map((value, i) => ({ value, period: i + 1 })), leaders: [{ category: 'Receiving', name: 'WR One', team: 'DAL', stats: '7-110 YDS' }] };
    const live = { ...game, id: '401772599', completed: false, state: 'in', liveUnavailable: true, homeScore: null, awayScore: null, shortDetail: 'In progress', kickoff: '2025-09-07T17:00Z' };
    const tree = window.WrNflDesk({ desk: { phase: { season: '2025', week: 1, seasontype: 2 }, previousPhase: null, current: { status: 'ready', source: 'espn', checkedAt: 1, games: [comeback, live] }, previous: { status: 'ready', games: [] } } });
    const t = text(tree);
    assert.match(t, /Philadelphia Eagles beat Dallas Cowboys, 24–17 ?\./);
    assert.match(t, /erased a 10-point deficit after three quarters/);
    assert.match(t, /WR One: 7-110 YDS \(DAL\)\./);
    const stats = nodes(tree).filter(n => n.type?.name === 'WrNflPlayerStats');
    assert.equal(stats.length, 1, 'only the scored game offers player stats (no box for an unverified live game)');
    assert.deepEqual([stats[0].props.game.season, stats[0].props.game.week, stats[0].props.game.seasontype], ['2025', 1, 2], 'the phase rides along for Sleeper’s weekly file');
    assert.match(t, /Player box scores load only when you ask/);
});
