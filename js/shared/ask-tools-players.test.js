// Run with:  node --test js/shared/ask-tools-players.test.js
// Player + waiver tools the member's own AI calls (App.AskTools).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = p => p;
// The registry's timeout races (15s) would otherwise hold the process open.
const _st = setTimeout;
globalThis.setTimeout = (f, ms, ...a) => { const t = _st(f, ms, ...a); if (t && t.unref) t.unref(); return t; };

const now = new Date();
const daysAgo = d => new Date(now.getTime() - d * 864e5).toISOString();
globalThis.S = {
    currentLeagueId: 'L', myRosterId: 13, myUserId: 'me', season: '2026', currentWeek: 6, platform: 'sleeper',
    leagues: [{ league_id: 'L', name: 'Psycho', roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN'], settings: { waiver_budget: 100, waiver_type: 2, waiver_bid_min: 1 }, scoring_settings: { rec: 1 } }],
    leagueUsers: [{ user_id: 'me', display_name: 'skjjcruz', metadata: { team_name: 'Dirty Mike' } }, { user_id: 'them', display_name: 'Gas', metadata: { team_name: 'GasMan612' } }],
    rosters: [
        { roster_id: 13, owner_id: 'me', players: ['sutton', 'jt', 'dak'], starters: ['dak', 'jt', 'sutton'], settings: { waiver_budget_used: 40, waiver_position: 2 } },
        { roster_id: 2, owner_id: 'them', players: ['puka', 'camsutton'], starters: ['puka'], settings: { waiver_budget_used: 10, waiver_position: 1 } },
    ],
    players: {
        sutton: { full_name: 'Courtland Sutton', position: 'WR', team: 'DEN', age: 30, years_exp: 8, college: 'SMU', number: 14, depth_chart_order: 1, depth_chart_position: 'LWR', active: true },
        jt: { full_name: 'Jonathan Taylor', position: 'RB', team: 'IND', age: 27, active: true },
        dak: { full_name: 'Dak Prescott', position: 'QB', team: 'DAL', age: 33, active: true },
        puka: { full_name: 'Puka Nacua', position: 'WR', team: 'LAR', age: 25, active: true },
        camsutton: { full_name: 'Cam Sutton', position: 'DB', team: 'PIT', age: 31, active: true },
        fa1: { full_name: 'Michael Carter', position: 'RB', team: 'TEN', age: 27, active: true },
        fa2: { full_name: 'Tyler Badie', position: 'RB', team: 'DEN', age: 26, active: true, injury_status: 'Questionable', injury_body_part: 'Ankle' },
        fa3: { full_name: 'Troy Franklin', position: 'WR', team: 'DEN', age: 22, active: true },
        cle: { full_name: 'Cleveland Browns', position: 'DEF', team: 'CLE', active: true },
        k1: { full_name: 'Free Kicker', position: 'K', team: 'NYG', active: true },
    },
    weeklyPlayerPoints: { 1: { sutton: 12.4, jt: 20 }, 2: { sutton: 8.1 }, 3: { sutton: 0 } },
    playerStats: { sutton: { gp: 5, rec: 22, rec_yd: 301, rec_td: 2, rush_yd: 0 } },
};
App.LI = {
    playerScores: { sutton: 938, jt: 4288, dak: 4019, puka: 7091, fa1: 333, fa2: 410, fa3: 1500, cle: 900, k1: 800 },
    playerMeta: { sutton: { ppg: 11.23, peakYrsLeft: 0, trend: -68, ageCurvePhase: 'decline', lastYearPPG: 13.1, careerPPG: 12.2, roleLabel: 'WR1', fcValue: 2100.4, fcRank: 120 } },
    tradeHistory: [{ season: '2025', week: 4, ts: 2, roster_ids: [13, 2], sides: { 13: { players: ['sutton'], picks: [] }, 2: { players: [], picks: [{ season: '2026', round: 2 }] } } }],
    faabByPos: { RB: { count: 9, avg: 12.333, median: 10, p75: 18 } },
};
App.DhqProj = { get: pid => ({ sutton: { median: 8.4, floor: 3, ceiling: 15 }, fa1: { median: 6.1 }, fa2: { median: 9.2 }, fa3: { median: 7.7 } })[pid] || null };
App.GameLocks = { state: pid => (pid === 'sutton' ? { status: 'pre', opp: 'KC', home: true, locked: false, label: 'Sun 4:25' } : null) };
App.getPlayerAction = pid => (pid === 'sutton' ? { label: 'Sell High', reason: 'Veteran decline band and production slipping' } : { label: 'Hold', reason: 'Hold.' });
App.PlayerNews = {
    get: async pids => {
        const out = {};
        pids.forEach(pid => { out[pid] = []; });
        if (out.sutton) out.sutton = [{ kind: 'injury', link: 'player', headline: 'Sutton limited Wednesday', published_at: daysAgo(1), source: 'ESPN', url: 'u1' }, { kind: 'news', link: 'player', headline: 'Old story', published_at: daysAgo(30), url: 'u0' }];
        if (out.fa3) out.fa3 = [{ kind: 'coaching', link: 'team', why: 'DEN play-calling', headline: 'Broncos change play-caller', published_at: daysAgo(2), url: 'u2' }];
        if (out.fa2) out.fa2 = [{ kind: 'coaching', link: 'team', why: 'DEN play-calling', headline: 'Broncos change play-caller', published_at: daysAgo(2), url: 'u2' }];
        return out;
    },
    label: () => '',
};
globalThis.WR = { PlayerWire: { fetchRead: async () => ({ story: 'Sutton caught 5 of 7 targets.', headline: 'Sutton steady', published: daysAgo(2), source: 'Rotowire via ESPN' }) } };
globalThis.Sleeper = { fetchTrending: async type => (type === 'add' ? [{ player_id: 'cle', count: 50000 }, { player_id: 'fa3', count: 9000 }, { player_id: 'puka', count: 10 }] : [{ player_id: 'fa1', count: 400 }]) };
globalThis.assessTeamFromGlobal = () => null;
require('./faab-engine.js');
const AT = require('./ask-tools.js');
require('./ask-tools-players.js');
require('./ask-tools-roster.js');

test('registers the six player tools with descriptions and schemas', () => {
    const names = AT.defs().map(d => d.name);
    for (const n of ['get_player', 'compare_players', 'search_players', 'get_waiver_report', 'get_waiver_bid', 'get_waiver_plan', 'get_news']) assert.ok(names.includes(n), n);
    AT.defs().forEach(d => { assert.ok(d.description.length > 20); assert.equal(d.parameters.type, 'object'); });
});

test('get_player: bio, owner, ranks, call, season log, trades, news and report', async () => {
    const r = await AT.run('get_player', { player: 'Courtland Sutton' });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.name, 'Courtland Sutton');
    assert.equal(r.bio.college, 'SMU');
    assert.match(r.owner, /Dirty Mike/);
    assert.equal(r.slot, 'starter');
    assert.equal(r.pos_rank, 'WR3');
    assert.deepEqual(r.depth, { order: 1, position: 'LWR' });
    assert.equal(r.call.call, 'Sell High');
    assert.equal(r.this_week.opp, 'vs KC');
    assert.equal(r.this_week.proj, 8.4);
    assert.equal(r.outlook.weighted_ppg, 11.2);
    assert.equal(r.outlook.fantasycalc.value, 2100);
    assert.equal(r.season.games, 2);
    assert.equal(r.season.total, 20.5);
    assert.equal(r.season_stats.rec_yd, 301);
    assert.equal(r.season_stats.rush_yd, undefined);
    assert.equal(r.trades_in_this_league[0].to, 'Dirty Mike');
    assert.deepEqual(r.trades_in_this_league[0].sent_back, ['2026 round 2 pick']);
    assert.equal(r.news[0].headline, 'Sutton limited Wednesday');
    assert.match(r.report.report, /5 of 7/);
});

test('get_player: shared last name goes to my player and lists the other', async () => {
    const r = await AT.run('get_player', { player: 'Sutton' });
    assert.equal(r.name, 'Courtland Sutton');
    assert.ok(r.alternatives.some(x => /Cam Sutton/.test(x)));
    const none = await AT.run('get_player', { player: 'Nobody Atall' });
    assert.match(none.error, /No player matches/);
});

test('compare_players: rows side by side, unknown names reported', async () => {
    const r = await AT.run('compare_players', { players: ['Courtland Sutton', 'Puka Nacua', 'Zzzz Qqqq'] });
    assert.equal(r.players.length, 2);
    assert.equal(r.players[1].value, 7091);
    assert.equal(r.players[0].season.ppg, 10.3);
    assert.deepEqual(r.not_found, ['Zzzz Qqqq']);
    const one = await AT.run('compare_players', { players: ['Puka Nacua'] });
    assert.ok(one.error);
});

test('search_players: free-agent RBs by value and by this week; mine; FLEX; youngest', async () => {
    const byVal = await AT.run('search_players', { position: 'RB', availability: 'free_agents' });
    assert.deepEqual(byVal.players.map(p => p.name), ['Tyler Badie', 'Michael Carter']);
    assert.equal(byVal.players[0].rank, 1);
    const wk = await AT.run('search_players', { position: 'FLEX', availability: 'free_agents', sort: 'this_week', limit: 2 });
    assert.deepEqual(wk.players.map(p => p.name), ['Tyler Badie', 'Troy Franklin']);
    const mine = await AT.run('search_players', { availability: 'mine' });
    assert.deepEqual(mine.players.map(p => p.name), ['Jonathan Taylor', 'Dak Prescott', 'Courtland Sutton']);
    const young = await AT.run('search_players', { sort: 'age', nfl_team: 'den', limit: 1 });
    assert.equal(young.players[0].name, 'Troy Franklin');
    const bad = await AT.run('search_players', { position: 'XX' });
    assert.match(bad.error, /Unknown position/);
});

test('get_waiver_report: best available, trending, FAAB, waiver order, league pays', async () => {
    const r = await AT.run('get_waiver_report', {});
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.best_available.RB.by_value[0].name, 'Tyler Badie');
    assert.equal(r.trending_adds[0].here, 'available');
    assert.match(r.trending_adds[1].here, /GasMan612/);
    assert.equal(r.trending_drops[0].name, 'Michael Carter');
    assert.equal(r.my_faab.left, 60);
    assert.deepEqual(r.faab_left_by_team.map(t => t.left), [90, 60]);
    assert.match(r.waiver_order[0].team, /GasMan612/);
    assert.equal(r.league_pays_by_position.RB.avg, 12.3);
});

test('get_waiver_bid: the FAAB model\'s bid, range, win chance, my FAAB', async () => {
    const r = await AT.run('get_waiver_bid', { player: 'Tyler Badie' });
    assert.equal(r.error, undefined, r.error);
    assert.ok(r.suggested_bid >= 1 && r.suggested_bid <= 60);
    assert.ok(r.range_lo <= r.suggested_bid && r.suggested_bid <= r.range_hi);
    assert.equal(typeof r.win_chance_pct, 'number');
    assert.equal(r.my_faab.left, 60);
    assert.match(r.based_on, /defaults/);
    const owned = await AT.run('get_waiver_bid', { player: 'Puka Nacua' });
    assert.match(owned.error, /not a free agent/);
});

test('get_news: team news deduped across teammates, old stories dropped, newest first', async () => {
    const r = await AT.run('get_news', { nfl_team: 'DEN' });
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.items.map(i => i.headline), ['Sutton limited Wednesday', 'Broncos change play-caller']);
    assert.equal(r.items[1].players.length, 2);
    const p = await AT.run('get_news', { players: ['Puka Nacua'] });
    assert.equal(p.items.length, 0);
    assert.ok(p.note);
});

test('free-agent lists only show positions this league can start (no DEF or K slot here)', async () => {
    const rep = await AT.run('get_waiver_report', {});
    assert.ok(!rep.trending_adds.some(x => x.pos === 'DEF'), 'trending DEF filtered');
    assert.ok(!rep.best_available.DEF && !rep.best_available.K);
    const def = await AT.run('get_waiver_report', { position: 'DEF' });
    assert.match(def.note, /no DEF slot/);
    const fa = await AT.run('search_players', { availability: 'free_agents', limit: 40 });
    assert.ok(!fa.players.some(p => p.pos === 'DEF' || p.pos === 'K'), fa.players.map(p => p.pos).join(','));
    const sDef = await AT.run('search_players', { position: 'DEF', availability: 'free_agents' });
    assert.equal(sDef.matches, 0);
    assert.match(sDef.note, /no DEF slot/);
    const all = await AT.run('search_players', { sort: 'value', limit: 40 });
    assert.ok(all.players.some(p => p.pos === 'DEF'), 'league-wide rankings still list everyone');
    const plan = await AT.run('get_waiver_plan', { position: 'DEF' });
    assert.equal(plan.decision, 'no_slot');
});

test('get_waiver_bid: offseason claims never price an in-season bid', async () => {
    const saved = globalThis.WrTxns;
    S.nflState = { season: '2026', season_type: 'regular', season_start_date: '2026-09-09' };
    const w = (bid, leg, created, status) => ({ type: 'waiver', status: status || 'complete', leg, created, roster_ids: [2], adds: { fa1: 2 }, settings: { waiver_bid: bid } });
    const tx = [];
    for (let i = 0; i < 20; i++) tx.push(w(1, 1, Date.UTC(2026, 3, 1 + i)));        // April claims, filed under leg 1
    tx.push(w(1, 1, undefined));                                                      // no timestamp, leg 1: offseason
    tx.push(w(30, 2, Date.UTC(2026, 8, 16)), w(40, 3, Date.UTC(2026, 8, 23)), w(50, 4, undefined), w(20, 4, Date.UTC(2026, 8, 30), 'failed'));
    globalThis.WrTxns = { getCached: () => tx.filter(t => t.status !== 'failed'), getFailedWaivers: () => tx.filter(t => t.status === 'failed') };
    try {
        const r = await AT.run('get_waiver_bid', { player: 'Tyler Badie' });
        assert.equal(r.error, undefined, r.error);
        assert.equal(r.in_season_bids.offseason_claims_excluded, 21);
        assert.equal(r.in_season_bids.count, 4);
        assert.deepEqual(r.recent_winning_bids_at_position.map(c => c.bid), [40, 30, 50]);
    } finally { globalThis.WrTxns = saved; delete S.nflState; }
});
