// Run with:  node --test js/shared/dhq-proj.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = (p) => ({ DE: 'DL', DT: 'DL', NT: 'DL', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', OLB: 'LB', ILB: 'LB', MLB: 'LB' }[p] || p);
const D = require('./dhq-proj.js');

// The owner's Psycho IDP slots, week 3 (2026-09-24)
globalThis.S = { players: {
    nwosu: { position: 'LB', fantasy_positions: ['DL', 'LB'] }, carter: { position: 'LB', fantasy_positions: ['DL', 'LB'] },
    hall: { position: 'DE', fantasy_positions: ['DL'] }, donald: { position: 'DT', fantasy_positions: ['DL'] },
    oluokun: { position: 'LB', fantasy_positions: ['LB'] }, bush: { position: 'LB', fantasy_positions: ['LB'] },
    mwilson: { position: 'LB', fantasy_positions: ['LB'] }, deablo: { position: 'LB', fantasy_positions: ['LB'] },
    ewilson: { position: 'LB', fantasy_positions: ['LB'] },
} };
const slots = [
    { idx: 0, elig: ['DL'] }, { idx: 1, elig: ['DL'] }, { idx: 2, elig: ['DL'] },
    { idx: 3, elig: ['LB'] }, { idx: 4, elig: ['LB'] },
    { idx: 5, elig: ['DL', 'LB', 'DB'] }, { idx: 6, elig: ['DL', 'LB', 'DB'] }, { idx: 7, elig: ['DL', 'LB', 'DB'] },
];
const current = { 0: 'nwosu', 1: 'carter', 2: 'hall', 3: 'oluokun', 4: 'bush', 5: 'donald', 6: 'mwilson', 7: 'deablo' };

test('benching a DL for an LB takes the two moves it needs, no more', () => {
    const best = ['nwosu', 'carter', 'donald', 'oluokun', 'bush', 'ewilson', 'mwilson', 'deablo'];
    const out = D.assignSlots(best, slots, current);
    assert.equal(out[2], 'donald', 'Donald slides into the DL slot Hall leaves');
    assert.equal(out[5], 'ewilson', 'Wilson takes the IDP FLEX Donald leaves');
    assert.equal(out[4], 'bush', 'Bush stays at LB');
    const moved = Object.keys(out).filter(k => out[k] !== current[k]);
    assert.deepEqual(moved.sort(), ['2', '5']);
});

test('an LB never lands in a DL slot', () => {
    const best = ['nwosu', 'carter', 'ewilson', 'oluokun', 'bush', 'donald', 'mwilson', 'deablo'];
    const out = D.assignSlots(best, slots, current);
    for (const k of [0, 1, 2]) assert.ok(['nwosu', 'carter', 'donald', 'hall'].includes(out[k]), 'DL slot ' + k + ' holds ' + out[k]);
});

test('a lineup that cannot fit the slots returns null', () => {
    const best = ['oluokun', 'bush', 'mwilson', 'deablo', 'ewilson', 'hall', 'donald', 'nwosu'];   // only 3 DL-eligible for 3 DL + fine, but 5 pure LBs for 2 LB + 3 flex = fits; make it fail:
    const tooManyLb = ['oluokun', 'bush', 'mwilson', 'deablo', 'ewilson', 'carter', 'hall', 'x'];
    globalThis.S.players.x = { position: 'LB', fantasy_positions: ['LB'] };
    assert.equal(D.assignSlots(tooManyLb, slots, current), null);
    assert.ok(D.assignSlots(best, slots, current));
});

test('weekDists prices every team in this week\'s games, mine from my Game Day lineup', () => {
    const saved = { S: globalThis.S, WP: App.WeeklyProj };
    require('./matchup.js');
    globalThis.S = { currentLeagueId: 'L', leagues: [{ league_id: 'L', scoring_settings: {} }], players: {} };
    App.WeeklyProj = { displayWeek: () => 3 };
    const st = D._st;
    D.get('x');   // settles the league/week key
    Object.assign(st.results, { a: { median: 20, floor: 14, ceiling: 27 }, b: { median: 10, floor: 7, ceiling: 13 }, c: { median: 30, floor: 21, ceiling: 40 }, z: { median: 25, floor: 18, ceiling: 33 } });
    const lg = { rosters: [{ roster_id: 1, starters: ['a', 'b'] }, { roster_id: 2, starters: ['z'] }] };
    const wd = D.weekDists(lg, [[1, 2]], 3, 1, ['c']);
    assert.equal(wd.week, 3);
    assert.equal(wd.byRoster['1'].mean, 30, 'my working lineup (c), not the saved one (a + b)');
    assert.equal(wd.byRoster['2'].mean, 25);
    const fc = App.Matchup.forecast(App.Matchup.dist(['c'], { c: { points: { median: 30, floor: 21, ceiling: 40 } } }, 'median'), App.Matchup.dist(['z'], { z: { points: { median: 25, floor: 18, ceiling: 33 } } }, 'median'));
    assert.equal(wd.myWinPct, fc.winPct, 'same number the matchup box shows');
    assert.equal(D.weekDists(lg, [[1, 2]], 4, 1, ['c']), null, 'another week: DHQ has no numbers for it');
    delete st.results.z;
    assert.equal(D.weekDists(lg, [[1, 2]], 3, 1, ['c']), null, 'waits until every team is projected');
    globalThis.S = saved.S; App.WeeklyProj = saved.WP;
});

test('rosterDists prices every living team for a chopped week', () => {
    const saved = { S: globalThis.S, WP: App.WeeklyProj };
    globalThis.S = { currentLeagueId: 'L', leagues: [{ league_id: 'L', scoring_settings: {} }], players: {} };
    App.WeeklyProj = { displayWeek: () => 3 };
    const st = D._st;
    D.get('x');
    Object.assign(st.results, { a: { median: 20, floor: 14, ceiling: 27 }, b: { median: 10, floor: 7, ceiling: 13 }, z: { median: 25, floor: 18, ceiling: 33 } });
    const lg = { rosters: [{ roster_id: 1, starters: ['a', 'b'] }, { roster_id: 2, starters: ['z'] }, { roster_id: 3, starters: ['q'] }] };
    const wd = D.rosterDists(lg, ['1', '2'], 3, 1, null);
    assert.equal(wd.byRoster['1'].mean, 30, 'saved starters when no Game Day lineup is given');
    assert.equal(wd.byRoster['2'].mean, 25);
    assert.equal(D.rosterDists(lg, ['1', '2', '3'], 3, 1, null), null, 'waits for every living team');
    globalThis.S = saved.S; App.WeeklyProj = saved.WP;
});

test('totals add the average week; each player still shows his typical week', () => {
    const saved = { S: globalThis.S, WP: App.WeeklyProj };
    globalThis.S = { currentLeagueId: 'L', leagues: [{ league_id: 'L', scoring_settings: {} }], players: {} };
    App.WeeklyProj = { displayWeek: () => 3 };
    D.get('x');
    Object.assign(D._st.results, { m1: { median: 9, mean: 11, floor: 6, ceiling: 15 }, m2: { median: 4, mean: 5, floor: 2, ceiling: 7 } });
    assert.equal(D.fmt('m1'), '9.0', 'shown: typical week');
    assert.equal(D.totalNum(['m1', 'm2']), 16, 'total: 11 + 5, the averages');
    assert.equal(D.teamDist(['m1', 'm2']).mean, 16);
    globalThis.S = saved.S; App.WeeklyProj = saved.WP;
});

test('a starter DHQ can\'t project keeps its slot', () => {
    // CTB The One, 2026-09-26: Apply Optimal moved "Minnesota Vikings → Empty".
    // A team defense has no DHQ projection; that is not the same as "won't play".
    const saved = { S: globalThis.S, WP: App.WeeklyProj, SS: App.StartSit };
    App.StartSit = require('./startsit-engine.js');
    globalThis.S = { currentLeague: null, currentLeagueId: 'L', leagues: [{ league_id: 'L', scoring_settings: {} }], players: {
        qb1: { position: 'QB', team: 'ARI', fantasy_positions: ['QB'] }, qb2: { position: 'QB', team: 'JAX', fantasy_positions: ['QB'] },
        min: { position: 'DEF', team: 'MIN', fantasy_positions: ['DEF'] }, tb: { position: 'DEF', team: 'TB', fantasy_positions: ['DEF'] },
        wr1: { position: 'WR', team: 'LV', fantasy_positions: ['WR'] }, wrOut: { position: 'WR', team: 'PIT', fantasy_positions: ['WR'] },
    } };
    App.WeeklyProj = { displayWeek: () => 3 };
    const st = D._st;
    D.get('x');
    Object.assign(st.results, { qb1: { median: 12 }, qb2: { median: 15 }, min: null, tb: null, wr1: { median: 9 }, wrOut: { median: 0 } });
    const league = { roster_positions: ['QB', 'WR', 'DEF', 'BN', 'BN', 'BN'] };
    const roster = { players: ['qb1', 'qb2', 'min', 'tb', 'wr1', 'wrOut'], starters: ['qb1', 'wrOut', 'min'] };

    const best = D.optimalFor(roster, league.roster_positions);
    const def = best.starters.find(s => s.slot === 'DEF');
    assert.ok(def, 'the DEF slot is not left empty');
    assert.equal(def.pid, 'min', 'the defense in the slot stays in it');
    assert.equal(def.held, true);
    assert.equal(best.total, 24, 'the held defense adds nothing to the DHQ total (qb2 15 + wr1 9)');

    const chk = D.lineupCheck(roster, league);
    assert.equal(chk.placed[2], 'min', 'lineup check keeps the defense in its slot');
    assert.equal(chk.placed[0], 'qb2', 'a player DHQ does project is still upgraded');
    assert.equal(chk.placed[1], 'wr1', 'a starter DHQ projects at 0 (out) is still replaced');
    assert.ok(!chk.delta.benchInstead.includes('min'), 'no "bench the defense" call');
    assert.ok(chk.delta.startInstead.every(s => s.pid !== 'tb'), 'no other defense pushed in on no number');

    // Working lineup with the other defense in the slot: that one stays.
    const chk2 = D.lineupCheck(roster, league, { 0: 'qb1', 1: 'wr1', 2: 'tb' });
    assert.equal(chk2.placed[2], 'tb');

    // A cut player (no NFL team) is not held: he really can't play.
    globalThis.S.players.min = { position: 'DEF', team: null, fantasy_positions: ['DEF'] };
    const best2 = D.optimalFor(roster, league.roster_positions);
    assert.ok(!best2.starters.some(s => s.pid === 'min'));
    globalThis.S = saved.S; App.WeeklyProj = saved.WP; App.StartSit = saved.SS;
});

// ── Snapshot data from another origin (website port 2026-09-29) ─────────
test('a snapshot that fails to load is set aside; the engine still loads', async () => {
    const saved = { doc: globalThis.document, ME: App.MatchupEngine, DB: App.DhqBaseline, MI: App.MatchupInputs, pff: globalThis.DhqPffMatchup, use: globalThis.DhqUsage };
    delete App.MatchupEngine; delete App.DhqBaseline; delete App.MatchupInputs;
    delete globalThis.DhqPffMatchup; delete globalThis.DhqUsage;
    const asked = [];
    globalThis.document = {
        createElement: () => ({}),
        head: { appendChild: (s) => {
            asked.push(s.src);
            setTimeout(() => {
                if (/pff-matchup-snapshot/.test(s.src)) return s.onerror();   // blocked or down
                if (/matchup-engine/.test(s.src)) App.MatchupEngine = {};
                if (/dhq-baseline/.test(s.src)) App.DhqBaseline = {};
                if (/matchup-inputs\.js/.test(s.src)) App.MatchupInputs = {};
                if (/usage-snapshot/.test(s.src)) globalThis.DhqUsage = { season: 2026, built: '2026-09-29T10:54:44Z' };
                s.onload();
            }, 0);
        } },
    };
    D._st.deps = null; D._st.error = null; D._st.data = {};
    await D._loadDeps();
    assert.equal(D._st.error, null, 'the load did not fail');
    assert.ok(asked.some(u => /^https:\/\/skjjcruz\.github\.io\/DHQ-Web-Page\/data\/usage-snapshot\.js\?v=/.test(u)), 'data comes from the Lab origin off the Lab: ' + asked.join(' '));
    assert.ok(asked.some(u => /^js\/shared\/matchup-engine\.js\?v=/.test(u)), 'engine files come from this origin');
    const s = D._checkData(2026);
    assert.equal(s['data/pff-matchup-snapshot.js'].ok, false);
    assert.match(s['data/pff-matchup-snapshot.js'].why, /could not load/);
    assert.equal(s['data/usage-snapshot.js'].ok, true);
    assert.deepEqual(D.dataStatus()['data/pff-matchup-snapshot.js'], s['data/pff-matchup-snapshot.js']);
    globalThis.document = saved.doc; App.MatchupEngine = saved.ME; App.DhqBaseline = saved.DB; App.MatchupInputs = saved.MI;
    globalThis.DhqPffMatchup = saved.pff; globalThis.DhqUsage = saved.use;
    D._st.deps = null; D._st.data = {};
});

test('a snapshot built for another season is dropped, not used', () => {
    const saved = { pff: globalThis.DhqPffMatchup, use: globalThis.DhqUsage };
    globalThis.DhqPffMatchup = { season: 2026, built: '2026-12-30T00:00:00Z', teams: {} };
    globalThis.DhqUsage = { season: 2027, built: '2027-08-01T00:00:00Z', teams: {} };
    D._st.data = {};
    const s = D._checkData(2027);
    assert.equal(s['data/pff-matchup-snapshot.js'].ok, false);
    assert.match(s['data/pff-matchup-snapshot.js'].why, /built for 2026/);
    assert.equal(globalThis.DhqPffMatchup, null, 'the engine now reads PFF as missing');
    assert.equal(s['data/usage-snapshot.js'].ok, true);
    globalThis.DhqPffMatchup = saved.pff; globalThis.DhqUsage = saved.use; D._st.data = {};
});

// ── Truth law (review 2026-09-29): no Sleeper line this week, no DHQ number ──
test('once Sleeper\'s week is in, a player it does not project shows 0, typical and average alike', () => {
    const saved = { S: globalThis.S, WP: App.WeeklyProj };
    const sc = { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rec: 0.5, rec_yd: 0.1, fgm: 3, xpm: 1, idp_tkl: 1 };
    globalThis.S = { currentLeagueId: 'T', leagues: [{ league_id: 'T', scoring_settings: sc }], players: {} };
    const lines = { qb1: { pass_yd: 240, pass_att: 33 }, kOff: null, adp: { adp_dd_ppr: 1000 }, ptsOnly: { pts_ppr: 0.2, fum_rec_td: 0.01 } };
    let ready = true;
    App.WeeklyProj = { displayWeek: () => 4, hasProjWeek: () => ready, projLine: (pid) => lines[pid] || null };
    D.get('x');
    Object.assign(D._st.results, { qb1: { median: 18, mean: 18 }, kOff: { median: 8.2, mean: 8.2 }, adp: { median: 5.8, mean: 5.8 }, ptsOnly: { median: 1.1, mean: 1.3 } });
    assert.equal(D.fmt('qb1'), '18.0', 'Sleeper projects him: DHQ\'s number stands');
    assert.equal(D.fmt('kOff'), '0.0', 'no Sleeper line at all');
    assert.equal(D.get('adp').mean, 0, 'an ADP placeholder is not a projection');
    assert.equal(D.get('ptsOnly').mean, 0, 'a line with nothing this league scores');
    assert.equal(D.get('kOff').noSleeper, true);
    assert.equal(D.totalNum(['qb1', 'kOff', 'adp']), 18, 'totals add nothing for them');
    assert.equal(D.dataStatus().sleeper.ok, true);
    // Sleeper's week did not load: nobody is zeroed, and the status says so.
    ready = false;
    assert.equal(D.fmt('kOff'), '8.2');
    assert.equal(D.totalNum(['qb1', 'kOff']), 26.2);
    assert.equal(D.dataStatus().sleeper.ok, false);
    globalThis.S = saved.S; App.WeeklyProj = saved.WP;
});

test('choices run on the average week: availability and start-instead points', () => {
    const saved = { S: globalThis.S, WP: App.WeeklyProj, SS: App.StartSit };
    globalThis.S = { currentLeagueId: 'U', leagues: [{ league_id: 'U', scoring_settings: {} }], players: {
        lb1: { position: 'LB', team: 'KC', fantasy_positions: ['LB'] }, lb2: { position: 'LB', team: 'KC', fantasy_positions: ['LB'] } } };
    App.WeeklyProj = { displayWeek: () => 4 };
    App.StartSit = { normSlot: s => s, FLEX_ALLOWED: {}, BASE_POSITIONS: new Set(['LB']),
        optimalLineupWeekly: (list) => { const best = list.filter(x => x.available).sort((a, b) => b.pts - a.pts)[0]; return best ? { starters: [{ pid: best.pid, slot: 'LB' }], total: best.pts } : { starters: [], total: 0 }; } };
    D.get('x');
    // a part-timer whose typical week rounds to 0 but whose average is 0.4
    Object.assign(D._st.results, { lb1: { median: 0, mean: 0.4 }, lb2: null });
    const best = D.optimalFor({ players: ['lb1', 'lb2'], starters: ['0'] }, ['LB', 'BN']);
    assert.equal(best.starters[0].pid, 'lb1', 'a player with an average above 0 can be started');
    globalThis.S = saved.S; App.WeeklyProj = saved.WP; App.StartSit = saved.SS;
});
