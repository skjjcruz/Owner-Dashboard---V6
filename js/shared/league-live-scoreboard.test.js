// Run with:  node --test js/shared/league-live-scoreboard.test.js
// Render checks for js/components/league-live-scoreboard.js, ported from C2
// tests/league-live-scoreboard.js (2026-09-27) with our copy, plus: teams
// whose week has not begun read "—" (never a fake 0-0), unscheduled weeks,
// and the ESPN/MFL note from the Game Day section.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const Babel = require('@babel/standalone');

let hooks = [], index = 0, board;
const React = {
    useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useEffect() {}, useMemo(fn) { return fn(); }, useRef(v) { return { current: v }; }, useCallback(fn) { return fn; },
    memo(fn) { return fn; }, Fragment: 'Fragment',
    createElement(type, props, ...children) { return { type, props: props || {}, children }; },
};
const App = {
    LeagueLiveScores: {
        INTERVAL: 30000, supported: l => !l._platform || l._platform === 'sleeper',
        currentWeek: () => 2, useScores: () => board,
        rosterPoints: row => row.points ?? null,
        playerPoints: (row, pid) => row.players_points?.[pid] ?? null,
    },
    Chopped: { isChopped: league => league.settings?.type === 3, isAliveInWeek: (row, week) => !row.settings?.eliminated || week <= row.settings.eliminated },
};
const scope = { React, window: { App }, document: { getElementById: () => null } };
vm.createContext(scope);
vm.runInContext(Babel.transform(fs.readFileSync(path.join(__dirname, '../components/league-live-scoreboard.js'), 'utf8'), { presets: ['react'] }).code, scope);

const rows = [
    { roster_id: 1, matchup_id: 1, points: 0, starters: ['p1'], players_points: { p1: 0 } },
    { roster_id: 2, matchup_id: 1, points: -2, starters: ['p2'], players_points: { p2: -2 } },
    { roster_id: 3, matchup_id: 2, points: null, starters: ['p3'] },
];
const props = { currentLeague: { league_id: 'A', season: '2026', rosters: rows }, myRoster: rows[2], getOwnerName: id => `Owner ${id}`, getPlayerName: id => id };
function nodes(tree) { return tree == null || typeof tree === 'boolean' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree !== 'object' ? [tree] : [tree, ...nodes(tree.children)]; }
function text(tree) { return nodes(tree).filter(n => typeof n !== 'object').join(''); }
function render(extra = {}) { index = 0; return scope.window.LeagueLiveScoreboard({ ...props, ...extra }); }
const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && text(n).includes(label));

test('C2: own matchup first, real zero/negative scores, missing stays missing, week pick, stale disclosure', () => {
    hooks = [];
    board = { status: 'ready', supported: true, rows, groups: [{ matchupId: 1, teams: rows.slice(0, 2) }, { matchupId: 2, teams: [rows[2]] }], updatedAt: Date.now() };
    let tree = render();
    const cards = nodes(tree).filter(n => n.type === 'article');
    assert(text(cards[0]).includes('Owner 3'), 'Own matchup sorts first');
    assert(text(tree).includes('0.00') && text(tree).includes('-2.00'), 'Zero and negative scores remain actual values');
    assert(text(cards[0]).includes('—'), 'Missing score stays missing');
    assert(text(cards[0]).includes('No opponent this week'), 'Unpaired team does not invent opponent');
    nodes(tree).find(n => n.type === 'select').props.onChange({ target: { value: '7' } });
    assert.equal(nodes(render()).find(n => n.type === 'select').props.value, 7);
    assert.equal(nodes(render({ currentLeague: { ...props.currentLeague, league_id: 'B' } })).find(n => n.type === 'select').props.value, 2, 'Switching league resets week');
    board = { ...board, status: 'stale', error: 'offline' };
    assert(text(render()).includes('last successful update'), 'Stale scores are disclosed');
});

test('C2: chopped ladder excludes eliminated teams and has no head-to-head', () => {
    board = { status: 'ready', supported: true, rows, groups: [{ matchupId: 1, teams: rows.slice(0, 2) }, { matchupId: 2, teams: [rows[2]] }], updatedAt: Date.now(), error: null };
    hooks = [];
    const tree = render({ currentLeague: { ...props.currentLeague, settings: { type: 3 }, rosters: rows.map(r => ({ ...r, settings: r.roster_id === 3 ? { eliminated: 1 } : {} })) } });
    assert(text(tree).includes('Weekly scoring race'));
    assert.equal(nodes(tree).filter(n => n.type === 'article').length, 2, 'Previously chopped team excluded');
    assert(!text(tree).includes('No opponent'), 'Chopped does not show head-to-head');
    const desktopChopped = render({ currentLeague: { ...props.currentLeague, settings: { type: 3 } }, myRoster: rows[1] });
    assert(text(nodes(desktopChopped).find(n => n.type === 'article')).includes('Owner 1'), 'Chopped order stays score-ranked even when a lower-scoring team is mine');
});

test('C2: phone shows your game first; every league score is one tap away; tap opens the breakdown', () => {
    scope.window.WR = { useViewport: () => ({ isPhone: true }) };
    hooks = [];
    let tree = render();
    assert.equal(nodes(tree).filter(n => n.type === 'article').length, 1);
    assert(text(nodes(tree).find(n => n.type === 'article')).includes('Owner 3'));
    button(tree, 'All 2 games').props.onClick();
    tree = render();
    assert.equal(nodes(tree).filter(n => n.type === 'article').length, 2);
    assert(text(tree).includes('0.00') && text(tree).includes('-2.00'));
    button(tree, 'Matchup breakdown').props.onClick();
    tree = render();
    assert(text(tree).includes('Hide breakdown') && text(tree).includes('Actual'), 'breakdown shows starters with actual points');
    delete scope.window.WR;
});

test('never a fake 0-0: teams whose week has not begun read "—"', () => {
    hooks = [];
    const pre = [{ roster_id: 1, matchup_id: 1, points: 0, starters: ['p1'] }, { roster_id: 2, matchup_id: 1, points: 0, starters: ['p2'] }];
    board = { status: 'ready', supported: true, rows: pre, groups: [{ matchupId: 1, teams: pre }], updatedAt: Date.now(), error: null };
    const tree = render({ board, startedIds: new Set(), myRoster: pre[0] });
    assert(!text(tree).includes('0.00'), 'no 0.00 before kickoff');
    assert(text(tree).includes('Not started'));
    const live = render({ board, startedIds: new Set(['1', '2']), myRoster: pre[0] });
    assert(text(live).includes('0.00'), 'a started team at zero shows its real 0.00');
});

test('unscheduled week (all rows unpaired, not chopped) says so instead of N bye cards', () => {
    hooks = [];
    const loose = [{ roster_id: 1, matchup_id: null, points: 0 }, { roster_id: 2, matchup_id: null, points: 0 }];
    board = { status: 'ready', supported: true, rows: loose, groups: loose.map(r => ({ matchupId: null, teams: [r] })), updatedAt: Date.now(), error: null };
    const tree = render();
    assert.equal(nodes(tree).filter(n => n.type === 'article').length, 0);
    assert(text(tree).includes('has not posted matchups'));
});

test('unsupported (ESPN/MFL): honest Sleeper-only note, no subscription, no crash', () => {
    hooks = [];
    board = { supported: false, status: 'unsupported', rows: [], groups: [] };
    assert(text(render()).includes('Sleeper leagues only'));
    hooks = [];
    const section = scope.window.WrAroundTheLeague({ currentLeague: { league_id: 'espn_1', _platform: 'espn', season: '2026' }, myRoster: null, playersData: {} });
    assert(text(section).includes('Sleeper leagues only for now'));
});

test('breakdown with no NFL schedule: a plain 0 reads "—", real scores (incl. negatives) show; no-team players say so', () => {
    scope.window.WR = { useViewport: () => ({ isPhone: true }) };
    hooks = [];
    const r = [
        { roster_id: 1, matchup_id: 1, points: 5, starters: ['a', 'b', 'c'], players_points: { a: 0, b: -1.28, c: 6.28 } },
        { roster_id: 2, matchup_id: 1, points: 0, starters: ['d'], players_points: { d: 0 } },
    ];
    board = { status: 'ready', supported: true, rows: r, groups: [{ matchupId: 1, teams: r }], updatedAt: Date.now(), error: null };
    const pd = { a: { position: 'QB', team: 'BUF' }, b: { position: 'K', team: 'DAL' }, c: { position: 'WR', team: 'KC' }, d: { position: 'RB', team: '' } };
    let tree = render({ board, playersData: pd, myRoster: r[0] });
    button(tree, 'Matchup breakdown').props.onClick();
    tree = render({ board, playersData: pd, myRoster: r[0] });
    const t = text(tree);
    assert(t.includes('-1.28') && t.includes('6.28'));
    assert(!/Actual[^]*0\.00/.test(t.split('Hide breakdown')[1] || ''), 'no 0.00 player rows while the schedule is unknown');
    hooks = [];
    tree = render({ board, playersData: pd, myRoster: r[0], games: [{ home: 'BUF', away: 'MIA', state: 'pre', kickoff: '2099-01-01T00:00Z' }] });
    button(tree, 'Matchup breakdown').props.onClick();
    tree = render({ board, playersData: pd, myRoster: r[0], games: [{ home: 'BUF', away: 'MIA', state: 'pre', kickoff: '2099-01-01T00:00Z' }] });
    assert(text(tree).includes('No NFL team'), 'a teamless player is not labelled BYE');
    assert(text(tree).includes('BYE'), 'a player whose team has no game this week is BYE');
    delete scope.window.WR;
});

test('week picker covers only the league’s real weeks', () => {
    hooks = [];
    board = { status: 'ready', supported: true, rows, groups: [{ matchupId: 1, teams: rows.slice(0, 2) }], updatedAt: Date.now(), error: null };
    const opts = lg => nodes(render({ currentLeague: { ...props.currentLeague, settings: lg } })).filter(n => n.type === 'option').map(n => n.props.value);
    assert.deepEqual(opts({ playoff_week_start: 15, playoff_teams: 6, playoff_round_type: 0 }), Array.from({ length: 17 }, (_, i) => i + 1));
    assert.equal(opts({ playoff_week_start: 15, playoff_teams: 4, playoff_round_type: 2 }).at(-1), 18);
    assert.equal(opts({ playoff_week_start: 14, playoff_teams: 4, playoff_round_type: 0 }).at(-1), 15);
    assert.equal(opts({ playoff_week_start: 0, type: 3 }).at(-1), 18);
    assert.equal(opts({ start_week: 3, playoff_week_start: 15, playoff_teams: 6 })[0], 2, 'the selected week is always offered');
});

test('relay outage polls only inside NFL game windows (US Eastern)', () => {
    const w = scope.window.WrAroundTheLeague._inNflWindow;
    assert.equal(w(Date.parse('2026-09-27T18:00:00Z'), 3), true, 'Sun 2pm ET');
    assert.equal(w(Date.parse('2026-09-29T18:00:00Z'), 3), false, 'Tue 2pm ET');
    assert.equal(w(Date.parse('2026-10-02T01:00:00Z'), 4), true, 'Thu 9pm ET');
    assert.equal(w(Date.parse('2026-10-01T16:00:00Z'), 4), false, 'Thu noon ET');
    assert.equal(w(Date.parse('2026-12-19T20:00:00Z'), 15), true, 'late-season Sat');
    assert.equal(w(Date.parse('2026-10-03T20:00:00Z'), 4), false, 'early-season Sat');
});

test('standings panel with a missing engine shows a note instead of crashing', () => {
    hooks = [];
    const saved = App.LeagueLiveTable; delete App.LeagueLiveTable;
    const t = text(scope.window.LeagueLiveStandingsPanel({ currentLeague: props.currentLeague, board }));
    assert(t.includes('Standings are unavailable'));
    if (saved) App.LeagueLiveTable = saved;
});
