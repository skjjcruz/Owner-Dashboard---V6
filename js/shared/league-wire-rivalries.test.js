// Run with:  node --test js/shared/league-wire-rivalries.test.js
// Ported from C2 tests/league-wire-rivalries.cjs (2026-09-27; C2's
// App.AccountStorage is still honoured when installed, as there) + Dynasty HQ
// storage: localStorage via DhqStorage, scoped per account (else Sleeper user,
// else guest) and per league; a guest's picks carry into a later sign-in.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const babel = require('@babel/standalone');
test('C2 selected rivalries: persistence, isolation, renewals, editing, removal, save failures, previews/recaps, owner continuity', () => {
    const storage = new Map(); let account = 'first', failSave = false, events = 0;
    const root = { App: { AccountStorage: { get: (key, fallback) => storage.get(account + key) ?? fallback, set: (key, value) => { if (failSave) return false; storage.set(account + key, JSON.parse(JSON.stringify(value))); return true; } } }, CustomEvent: class { constructor(type) { this.type = type; } }, dispatchEvent: () => events++, addEventListener() {}, removeEventListener() {} };
    const ctx = vm.createContext({ window: root, console });
    const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8'), ctx);
    load('js/shared/league-live-scores.js'); load('js/shared/league-wire-rivalries.js'); load('js/shared/league-wire-journal.js');
    const api = root.WrWireRivalries;
    const league = { league_id: 'L', season: '2026', settings: { playoff_week_start: 5 }, rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }, { roster_id: 3, owner_id: 'c' }, { roster_id: 4, owner_id: 'd' }], users: [{ user_id: 'a', display_name: 'Alpha' }, { user_id: 'b', display_name: 'Bravo' }] };
    api.set(league, ['b', 'a'], '  Family feud  ');
    api.set(league, ['a', 'b'], 'Updated feud');
    assert.equal(api.list(league).length, 1, 'reversed pairs update rather than duplicate');
    assert.equal(api.list(league)[0].name, 'Updated feud');
    assert.throws(() => api.set(league, ['a', 'a'], ''), /different teams/);
    assert.throws(() => api.set(league, ['a', 'outsider'], ''), /current managers/);
    assert.equal(api.list({ ...league, league_id: 'other' }).length, 0);
    account = 'second'; assert.equal(api.list(league).length, 0, 'account isolation'); account = 'first';
    load('js/shared/league-wire-rivalries.js'); assert.equal(root.WrWireRivalries.list(league).length, 1, 'reload keeps selections');
    const renewed = { ...league, league_id: 'next', previous_league_id: 'L' };
    assert.equal(api.list(renewed).length, 1, 'provider-linked renewal inherits');
    api.remove(renewed, ['b', 'a']); assert.equal(api.list(renewed).length, 0, 'empty override does not resurrect inherited pairs'); assert.equal(api.list(league).length, 1);
    failSave = true; assert.throws(() => api.remove(league, ['a', 'b']), /could not be saved/); assert.equal(api.list(league).length, 1); failSave = false;
    assert.equal(events, 3, 'only successful saves emit a refresh');
    const row = (roster_id, points, matchup_id = 1) => ({ roster_id, points, matchup_id });
    const weeks = [{ week: 1, rows: [row(1, 100), row(2, 90), row(3, 80, 2), row(4, 70, 2)] }];
    const build = extra => root.WrWireStories.build({ league, start: 1, end: 1, weeks, nameFor: rid => 'Team ' + rid, rivalries: api.list(league), board: { week: 2, rows: weeks[0].rows }, ...extra });
    let result = build();
    assert(result.previews.some(s => s.followedRivalry && s.text.startsWith('Updated feud:')));
    assert.equal(result.rivals.filter(r => r.followed).length, 1, 'manual and discovered pair merge');
    assert(result.previews.some(s => !s.followedRivalry), 'automatic discovery remains');
    assert(result.stories.some(s => s.kind === 'recap' && s.followedRivalry && s.weight === 84));
    const noGames = build({ end: 0, weeks: [], board: { week: 1, rows: weeks[0].rows } });
    assert.equal(noGames.previews.length, 1, 'selection can flag a first meeting');
    assert.match(noGames.previews[0].body, /No completed regular-season meetings/);
    assert.equal(noGames.previews[0].metric, undefined, 'unknown series is not a fabricated 0-0');
    result = build({ board: { week: 2, rows: [row(1, 0), row(3, 0), row(2, 0, 2), row(4, 0, 2)] } });
    assert.equal(result.previews.filter(s => s.followedRivalry).length, 0, 'not playing means no fake preview');
    assert.equal(result.rivals.filter(r => r.followed && !r.scheduled).length, 1, 'still on watch list between meetings');
    assert.equal(build({ headToHead: false }).rivals.length, 0);
    assert.equal(build({ board: { week: 5, rows: weeks[0].rows } }).previews.length, 0, 'no regular-season preview for playoffs');
    const replacement = { ...league, rosters: league.rosters.map(r => r.roster_id === 1 ? { ...r, owner_id: 'replacement' } : r) };
    assert(!build({ league: replacement }).stories.some(s => s.followedRivalry), 'new owner never inherits a rivalry by roster slot');
    assert(!build({ league: replacement }).rivals.some(r => r.followed));

    // Editor: failed saves keep the form and persisted selection; successful edits/removal refresh.
    let cursor = 0; const states = []; let effects = []; const holds = []; root.App.LiveUpdate = { hold: r => holds.push('hold:' + r), release: r => holds.push('release:' + r) };
    ctx.React = { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useEffect(fn) { effects.push(fn); }, useRef: initial => { const i = cursor++; if (!(i in states)) states[i] = { current: initial }; return states[i]; }, useMemo: fn => fn(), createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) };
    vm.runInContext(babel.transform(fs.readFileSync(path.join(__dirname, '..', 'components', 'league-wire-rivalries.js'), 'utf8'), { presets: ['react'] }).code, ctx);
    const render = () => { cursor = 0; effects = []; const out = root.WrWireRivalryEditor({ league }); effects.forEach(fn => fn()); return out; };
    const nodes = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(nodes)] : [];
    const text = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : n.children.map(text).join(' ');
    let tree = render();
    nodes(tree).find(n => n.type === 'button' && text(n).startsWith('Edit')).props.onClick(); tree = render();
    nodes(tree).find(n => n.props['aria-label'] === 'Rivalry name').props.onChange({ target: { value: 'Renamed feud' } }); tree = render();
    failSave = true; nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); tree = render();
    assert(nodes(tree).some(n => n.props.role === 'alert')); assert.equal(api.list(league)[0].name, 'Updated feud');
    failSave = false; nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); tree = render();
    assert.equal(api.list(league)[0].name, 'Renamed feud'); assert.match(text(tree), /Rivalry saved/);
    nodes(tree).find(n => n.type === 'button' && text(n).startsWith('Remove')).props.onClick(); assert.equal(api.list(league).length, 0);
    assert.equal(holds[0], 'hold:wire-rivalry', 'an unsaved edit holds the live-update reload');
    assert.equal(holds.filter(h => h.startsWith('hold')).length, 1, 'held once while dirty');
    assert(holds.includes('release:wire-rivalry'), 'released once saved');
    assert(!holds.slice(0, 1).includes('release:wire-rivalry'), 'never released before it was held');
    void ('PASS selected rivalries: persistence, isolation, renewals, editing, removal, save failures, real previews/recaps and owner continuity');
});

test('Dynasty HQ storage: per-account + per-league keys, guest carry-over, quota failure, change event', () => {
    const store = new Map(); let failing = false, events = 0;
    const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { if (failing) throw Object.assign(Error('QuotaExceededError'), { name: 'QuotaExceededError' }); store.set(k, String(v)); }, removeItem: k => store.delete(k) };
    const root = { localStorage, S: { myUserId: '111' }, OD: { getCurrentUserId: () => null }, CustomEvent: class { constructor(type) { this.type = type; } }, dispatchEvent: () => events++ };
    const ctx = vm.createContext({ window: root, console });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'league-wire-rivalries.js'), 'utf8'), ctx);
    const api = root.WrWireRivalries;
    const league = { league_id: '900', rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }] };
    assert.equal(api.scope(), 'sleeper:111', 'guest connected by Sleeper username');
    api.set(league, ['a', 'b'], 'Derby');
    assert.deepEqual([...store.keys()], ['wr_wire_rivalries_v1:sleeper:111:900']);
    assert(store.keys().next().value.includes('wire_rivalries_v1:'), 'storage events from other tabs are recognisable');
    assert.equal(events, 1);
    // Signing in: the account sees the guest's picks until it saves its own.
    root.OD.getCurrentUserId = () => 'acct-1';
    assert.equal(api.scope(), 'account:acct-1');
    assert.equal(api.list(league)[0].name, 'Derby', 'guest selections carry into the account');
    api.set(league, ['a', 'b'], 'Renamed');
    assert(store.has('wr_wire_rivalries_v1:account:acct-1:900'));
    assert.equal(JSON.parse(store.get('wr_wire_rivalries_v1:sleeper:111:900')).pairs[0].name, 'Derby', 'the guest copy is never rewritten');
    // A different account on the same device and Sleeper login sees only the guest copy, never acct-1's.
    root.OD.getCurrentUserId = () => 'acct-2';
    assert.equal(api.list(league)[0].name, 'Derby');
    assert.equal(api.list({ ...league, league_id: '901' }).length, 0, 'per league');
    failing = true;
    assert.throws(() => api.set(league, ['a', 'b'], 'x'), /could not be saved/);
    assert.equal(events, 2, 'failed saves do not announce a change');
    // No account, no Sleeper user: a plain guest scope still works.
    failing = false; root.OD.getCurrentUserId = () => null; root.S = {};
    assert.equal(api.scope(), 'guest');
});

test('review S2: carry-over works for app league objects without previous_league_id', () => {
    const store = new Map();
    const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    const root = { localStorage, S: { myUserId: '7' }, CustomEvent: class { constructor(t) { this.type = t; } }, dispatchEvent() {} };
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'league-wire-rivalries.js'), 'utf8'), vm.createContext({ window: root, console }));
    const api = root.WrWireRivalries;
    const rosters = [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }];
    const last = { league_id: 'S25', season: '2025', previous_league_id: 'S24', rosters };
    api.set(last, ['a', 'b'], 'Old feud');
    const appLeague = { id: 'S26', season: '2026', rosters }; // app.js shape: no previous_league_id key
    const archive = [{ league: { league_id: 'S24', season: '2024', previous_league_id: null } }, { league: last }];
    assert.equal(api.list(appLeague, archive)[0].name, 'Old feud', 'inherited from the newest earlier linked season');
    assert.equal(api.list(appLeague, []).length, 0, 'no archive yet → nothing guessed');
    assert.equal(api.list({ ...appLeague, previous_league_id: null }, archive).length, 0, 'an explicit “no predecessor” is respected');
});
