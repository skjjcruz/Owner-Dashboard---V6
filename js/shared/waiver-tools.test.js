// Run with:  node --test js/shared/waiver-tools.test.js
// Free Agency waiver tools (C2 wave port): bid evidence, role check,
// streaming/season upgrades, the 2-week trend, and per-game signature stats.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.calcRawPts = (line, sc) => { let t = 0; for (const k of Object.keys(sc || {})) if (Number.isFinite(line[k])) t += line[k] * sc[k]; return t; };
require('./startsit-engine.js');
require('./stat-catalog.js');
require('./league-stats.js');
const M = require('./fa-market-data.js');
const W = require('./waiver-tools.js');

// ── Bid evidence ────────────────────────────────────────────────────
const league = { league_id: 'one', settings: { type: 0, waiver_type: 2, waiver_budget: 100 } };
const tx = (id, bid, extra = {}) => ({ transaction_id: id, type: 'waiver', status: 'complete', adds: { q: 1 }, settings: { waiver_bid: bid }, ...extra });

test('bid evidence: middle 50% of completed winning bids, deduped, position-normalised', () => {
    const txns = [0, 5, 10, 15, 20].map((b, i) => tx(String(i), b));
    const noise = [txns[0], tx('lost', 99, { status: 'failed' }), tx('other', 90, { league_id: 'two' }), tx('nobid', null), tx('multi', 80, { adds: { q: 1, r: 1 } }), tx('over', 500)];
    const e = W.bidEvidence(txns.concat(noise), league, 'DL', { q: { position: 'DE' }, r: { position: 'DE' } });
    assert.equal(e.sampleSize, 5);
    assert.equal(e.enough, true);
    assert.deepEqual([e.low, e.median, e.high], [5, 10, 15]);
    assert.match(e.basis, /history, not a prediction/);
});

test('bid evidence: fewer than five bids reports the count and no range', () => {
    const e = W.bidEvidence([1, 2, 3, 4].map(b => tx('t' + b, b)), league, 'QB', { q: { position: 'QB' } });
    assert.equal(e.sampleSize, 4);
    assert.equal(e.enough, false);
    assert.equal(e.low, null);
    assert.equal(e.median, null);
    assert.equal(W.bidEvidence([], league, 'QB', {}).sampleSize, 0);
    assert.equal(W.bidEvidence(null, league, 'QB', null).low, null);
});

test('FAAB league: waiver_type 2 with a budget; rolling waivers carry a budget but no bids', () => {
    assert.equal(W.isFaabLeague(league), true);
    assert.equal(W.isFaabLeague({ settings: { waiver_type: 0, waiver_budget: 100 } }), false, 'Sleeper rolling waivers still store a $100 budget');
    assert.equal(W.isFaabLeague({ settings: { waiver_type: 1, waiver_budget: 100 } }), false);
    assert.equal(W.isFaabLeague({ settings: { waiver_budget: 200 } }), true, 'no waiver_type → budget decides');
    assert.equal(W.isFaabLeague({ settings: { type: 2, player_copies: 1 } }), false, 'MFL import: no budget');
    assert.equal(W.isFaabLeague(null), false);
});

test('platform: explicit markers win, Sleeper is the default', () => {
    assert.equal(W.leaguePlatform({ _platform: 'espn' }), 'espn');
    assert.equal(W.leaguePlatform({ _source: 'mfl' }), 'mfl');
    assert.equal(W.leaguePlatform({ league_id: '1' }), 'sleeper');
    assert.equal(W.isBestBall({ settings: { best_ball: 1 } }, 'redraft'), true);
    assert.equal(W.isBestBall({ settings: {} }, 'best_ball'), true);
    assert.equal(W.isBestBall({ settings: { best_ball: 0 } }, 'redraft'), false);
});

// ── Role check ──────────────────────────────────────────────────────
test('role: a backup QB is never a seasonal pickup, and only ever a stash in dynasty', () => {
    const starter = { position: 'QB', depth_chart_position: 'QB', depth_chart_order: 1 };
    const backup = { position: 'QB', depth_chart_position: 'QB', depth_chart_order: 3 };
    const unknown = { position: 'QB' };
    assert.deepEqual(W.roleRead(starter, { seasonal: true }), { eligible: true, backup: false, reason: null });
    assert.equal(W.roleRead(backup, { seasonal: true }).eligible, false);
    assert.match(W.roleRead(backup, { seasonal: true }).reason, /stash, not a starter/);
    assert.equal(W.roleRead(backup, { seasonal: false }).eligible, true, 'dynasty stash stays addable');
    assert.equal(W.roleRead(backup, { seasonal: false }).backup, true, '…but is flagged as a backup');
    assert.equal(W.roleRead(unknown, { seasonal: true }).eligible, false);
    assert.equal(W.roleRead({ position: 'RB', depth_chart_order: 2 }, { seasonal: true }).eligible, true, 'only QB depth is a role gate');
});

// ── Streaming & season upgrades ─────────────────────────────────────
function world() {
    const pd = {
        myqb: { full_name: 'My QB', position: 'QB', team: 'KC' },
        myrb1: { full_name: 'My RB1', position: 'RB', team: 'KC' },
        myrb2: { full_name: 'My RB2', position: 'RB', team: 'DAL' },
        mywr: { full_name: 'My WR', position: 'WR', team: 'SF' },
        mybench: { full_name: 'Bench Guy', position: 'WR', team: 'NYJ' },
        myhurt: { full_name: 'Hurt Star', position: 'RB', team: 'BUF', injury_status: 'IR' },
        fa_rb: { full_name: 'FA Back', position: 'RB', team: 'LV' },
        fa_out: { full_name: 'Out Back', position: 'RB', team: 'LV', injury_status: 'Out' },
        fa_bye: { full_name: 'Bye Back', position: 'RB', team: 'DEN' },
        fa_noline: { full_name: 'No Line', position: 'RB', team: 'MIA' },
        fa_wr: { full_name: 'FA Wideout', position: 'WR', team: 'ATL' },
    };
    const proj = { myqb: 20, myrb1: 14, myrb2: 6, mywr: 11, mybench: 4, fa_rb: 12, fa_out: 15, fa_wr: 9 };
    // fa_bye: projectPlayer says unavailable; fa_noline: requireSleeper → null
    const projOf = pid => pid === 'fa_bye' ? { pts: 13, available: false } : (proj[pid] != null ? { pts: proj[pid], available: true } : null);
    const value = { myqb: 5000, myrb1: 4000, myrb2: 900, mywr: 3000, mybench: 500, myhurt: 6000, fa_rb: 1200, fa_out: 1500, fa_bye: 1500, fa_noline: 800, fa_wr: 700 };
    const league = { roster_positions: ['QB', 'RB', 'RB', 'WR', 'FLEX', 'BN'] };
    const roster = { players: ['myqb', 'myrb1', 'myrb2', 'mywr', 'mybench', 'myhurt'], reserve: [] };
    const candidates = ['fa_rb', 'fa_out', 'fa_bye', 'fa_noline', 'fa_wr'].map(pid => ({ pid }));
    return { pd, projOf, valueOf: pid => value[pid] ?? null, league, roster, candidates };
}

test('streams: full roster → best legal drop, measured against the best lineup', () => {
    const w = world();
    const r = W.streamUpgrades({ roster: w.roster, league: w.league, playersData: w.pd, candidates: w.candidates, projOf: w.projOf, valueOf: w.valueOf, horizon: 'week' });
    assert.equal(r.ok, true);
    assert.equal(r.openSpot, false);
    // before: QB20 + RB14 + RB6 + WR11 + FLEX4 = 55; add FA RB 12 → RB12 replaces RB6, flex = RB6 → 20+14+12+11+6 = 63 (drop bench WR 4)
    assert.equal(r.week.before, 55);
    const top = r.rows[0];
    assert.equal(top.pid, 'fa_rb');
    assert.equal(top.weekGain, 8);
    assert.equal(top.drop.pid, 'mybench', 'lowest-value non-injured player that keeps the lineup whole');
    const ids = r.rows.map(x => x.pid);
    assert(!ids.includes('fa_out'), 'an OUT player is never a this-week pickup');
    assert(!ids.includes('fa_bye'), 'a bye / unavailable projection is never a this-week pickup');
    assert(!ids.includes('fa_noline'), 'no published Sleeper line, no recommendation');
    assert(r.rows.every(x => x.drop == null || x.drop.pid !== 'myhurt'), 'never suggests cutting an injured player');
});

test('streams: an open roster spot needs no drop; protected players are never dropped', () => {
    const w = world();
    const openLeague = { roster_positions: w.league.roster_positions.concat('BN') };
    const r = W.streamUpgrades({ roster: w.roster, league: openLeague, playersData: w.pd, candidates: w.candidates, projOf: w.projOf, valueOf: w.valueOf });
    assert.equal(r.openSpot, true);
    assert.equal(r.rows[0].drop, null);
    const p = W.streamUpgrades({ roster: w.roster, league: w.league, playersData: w.pd, candidates: w.candidates, projOf: w.projOf, valueOf: w.valueOf, protectedPids: ['mybench'] });
    assert(p.rows.every(x => !x.drop || x.drop.pid !== 'mybench'));
});

test('streams: never trades a more valuable player for a one-week bump', () => {
    const w = world();
    // Only drop worth less than the add is allowed; make the bench guy valuable.
    const r = W.streamUpgrades({ roster: w.roster, league: w.league, playersData: w.pd, candidates: w.candidates, projOf: w.projOf, valueOf: pid => (pid === 'mybench' ? 99999 : w.valueOf(pid)) });
    const rb = r.rows.find(x => x.pid === 'fa_rb');
    assert(rb, 'still found via another legal drop');
    assert.notEqual(rb.drop.pid, 'mybench');
    assert(rb.drop && w.valueOf(rb.drop.pid) <= w.valueOf('fa_rb'));
});

test('streams: dropping the only player at a slot is refused even when points say yes', () => {
    const pd = { k: { position: 'K', team: 'KC' }, wr: { position: 'WR', team: 'KC' }, fa: { position: 'WR', team: 'SF' } };
    const league = { roster_positions: ['WR', 'K'] };
    const r = W.streamUpgrades({ roster: { players: ['k', 'wr'] }, league, playersData: pd, candidates: [{ pid: 'fa' }], projOf: pid => ({ k: { pts: 2, available: true }, wr: { pts: 3, available: true }, fa: { pts: 20, available: true } })[pid], valueOf: () => 1 });
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].drop.pid, 'wr', 'drops the WR it replaces, never the only kicker');
});

test('streams: chopped roster with no bench, IDP and superflex slots solve', () => {
    const pd = {
        qb: { position: 'QB', team: 'A' }, qb2: { position: 'QB', team: 'B' }, lb: { position: 'LB', team: 'C' }, de: { position: 'DE', team: 'D', fantasy_positions: ['DL', 'LB'] },
        faqb: { position: 'QB', team: 'E' }, fadl: { position: 'DT', team: 'F' },
    };
    const proj = { qb: 18, qb2: 9, lb: 7, de: 5, faqb: 15, fadl: 8 };
    const r = W.streamUpgrades({
        roster: { players: ['qb', 'qb2', 'lb', 'de'] }, league: { roster_positions: ['QB', 'SUPER_FLEX', 'LB', 'IDP_FLEX'] },
        playersData: pd, candidates: [{ pid: 'faqb' }, { pid: 'fadl' }],
        projOf: pid => proj[pid] != null ? { pts: proj[pid], available: true } : null, valueOf: () => 1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.openSpot, false, 'no bench: every add is a swap');
    const qb = r.rows.find(x => x.pid === 'faqb');
    assert.equal(qb.drop.pid, 'qb2');
    assert.equal(qb.weekGain, 6);
    const dl = r.rows.find(x => x.pid === 'fadl');
    assert.equal(dl.drop.pid, 'de', 'a DT fills IDP_FLEX');
    assert.equal(dl.weekGain, 3);
});

test('streams: season horizon ranks by rest-of-season lineup points', () => {
    const w = world();
    const ros = { myqb: 200, myrb1: 150, myrb2: 60, mywr: 120, mybench: 30, fa_rb: 90, fa_wr: 140, fa_out: 100, fa_bye: 110 };
    const r = W.streamUpgrades({ roster: w.roster, league: w.league, playersData: w.pd, candidates: w.candidates, projOf: w.projOf, rosOf: pid => ros[pid] ?? 0, valueOf: () => 1, horizon: 'season' });
    assert.equal(r.season.before, 200 + 150 + 60 + 120 + 30);
    assert.equal(r.rows[0].pid, 'fa_wr', 'the ROS leader tops the season view');
    assert(r.rows[0].rosGain > 0);
    assert.equal(typeof r.rows[0].weekGain, 'number', 'the week number still rides along');
});

test('streams: roster overage or missing engine → honest no-op', () => {
    const w = world();
    const tiny = { roster_positions: ['QB', 'RB'] };
    assert.equal(W.streamUpgrades({ roster: w.roster, league: tiny, playersData: w.pd, candidates: w.candidates, projOf: w.projOf }).reason, 'overage');
    assert.equal(W.streamUpgrades({ roster: null, league: w.league }).reason, 'roster');
});

// ── Trend sparkline data ────────────────────────────────────────────
test('trend: real games only, league-scored, nothing under two games', async () => {
    W._reset();
    const weeks = {
        1: { a: { gp: 1, rec: 5, rec_yd: 50 }, b: { gp: 1, rec: 2 }, c: { gms_active: 1 } },
        2: { a: { gp: 1, rec: 8, rec_yd: 110 }, c: { gp: 1, rec: 1 }, TEAM_KC: { gp: 1 } },
    };
    App.SOS = { getWeekStats: (s, w) => Promise.resolve(weeks[w] || {}) };
    assert.deepEqual(W.completedWeeks(3, 2), [1, 2]);
    assert.deepEqual(W.completedWeeks(1, 2), []);
    const landed = await W.loadWeeks('2026', [1, 2]);
    assert.equal(landed, true);
    const scoring = { rec: 1, rec_yd: 0.1 };
    assert.deepEqual(W.trendFor('a', { season: '2026', weeks: [1, 2], scoring, playersData: { a: { position: 'WR' } } }), [{ week: 1, pts: 10 }, { week: 2, pts: 19 }]);
    assert.deepEqual(W.trendFor('b', { season: '2026', weeks: [1, 2], scoring }), [], 'one game is not a trend');
    assert.deepEqual(W.trendFor('c', { season: '2026', weeks: [1, 2], scoring }), [], 'active but no snap (gp absent) is not a game');
    const te = W.trendFor('a', { season: '2026', weeks: [1, 2], scoring: { rec: 1, bonus_rec_te: 0.5 }, position: 'TE' });
    assert.deepEqual(te.map(x => x.pts), [7.5, 12], 'TE premium applies');
    assert.equal(await W.loadWeeks('2026', [1, 2]), false, 'second load is served from memory');
    delete App.SOS;
});

test('trend: a failed week is not cached as data', async () => {
    W._reset();
    let calls = 0;
    App.SOS = { getWeekStats: () => { calls++; return Promise.resolve({}); } };
    assert.equal(await W.loadWeeks('2025', [4]), false);
    assert.equal(W.weekRows('2025', 4), null);
    await W.loadWeeks('2025', [4]);
    assert.equal(calls, 1, 'a failed read backs off for a minute instead of hammering Sleeper');
    delete App.SOS;
});

// ── Per-game signature stats (C2 fa-market-data contract) ───────────
test('signature stats: rates from season counts, per-game counts, "—" when missing', () => {
    const qb = { gp: 4, pass_cmp: 60, pass_att: 100, pass_yd: 850, cmp_pct: 240, pass_ypa: 34 };
    assert.equal(M.signature('QB', 0, qb).value, 0.6);
    assert.equal(M.signature('QB', 0, qb).text, '60.0%');
    assert.equal(M.signature('QB', 1, qb).value, 8.5, 'YPA is not divided by games');
    const targets = M.signature('WR', 0, { gp: 4, rec_tgt: 13 });
    assert.equal(targets.text, '3.3');
    assert.equal(targets.short, 'TGT/G');
    assert.equal(M.signature('WR', 1, { gp: 4, off_snp: 90, tm_off_snp: 200 }).text, '45.0%');
    assert.equal(M.signature('DE', 0, { gp: 2, idp_tkl_solo: 0, idp_tkl_ast: 0 }).text, '0.0', 'a real zero stays a zero');
    assert.equal(M.signature('WR', 0, { rec_tgt: 13 }).text, '—', 'no games played → no per-game number');
    assert.equal(M.signature('WR', 0, {}).text, '—');
    assert.equal(M.signature('DEF', 0, {}), null, 'no invented stat for team defense');
});

// ── Game locks (review 2026-09-27) ──────────────────────────────────
const gs = (g, now) => { if (g.completed) return 'final'; if (g.state === 'in') return 'live'; const k = Date.parse(g.kickoff); return k <= now ? 'locked' : 'upcoming'; };

test('lock board: kickoff schedule → per-team locks; no schedule → conservative in the game window', () => {
    const now = Date.parse('2026-09-27T17:41:00Z'); // Sunday, 1pm ET games under way
    const games = [
        { home: 'KC', away: 'LV', kickoff: '2026-09-27T17:00:00Z', state: 'in' },
        { home: 'SF', away: 'LAR', kickoff: '2026-09-27T20:25:00Z', state: 'pre' },
        { home: 'BUF', away: 'MIA', kickoff: '2026-09-25T00:15:00Z', state: 'post', completed: true },
    ];
    const b = W.lockBoard(games, gs, now);
    assert.equal(b.known, true);
    assert.equal(b.lockedTeam('KC'), true);
    assert.equal(b.lockedTeam('BUF'), true, 'final is locked');
    assert.equal(b.lockedTeam('SF'), false);
    assert.equal(b.lockedTeam('NYJ'), false, 'bye team: nothing to lock');
    assert.equal(b.started, true);
    assert.equal(b.allFinal, false);
    assert.equal(W.lockBoard(games.map(g => ({ ...g, completed: true })), gs, now).allFinal, true);
    const none = W.lockBoard([], gs, now);
    assert.equal(none.known, false);
    assert.equal(none.lockedTeam('SF'), true, 'Sunday with no schedule: treat as possibly locked');
    assert.equal(W.lockBoard([], gs, Date.parse('2026-09-30T15:00:00Z')).lockedTeam('SF'), false, 'Wednesday: no games');
});

test('streams: locked players are never added or dropped for this week; locked starters keep their slot', () => {
    const w = world();
    const teams = { LV: true };   // fa_rb's game (LV) has kicked off
    const lockedOf = pid => !!teams[w.pd[pid] && w.pd[pid].team];
    const r = W.streamUpgrades({ roster: w.roster, league: w.league, playersData: w.pd, candidates: w.candidates, projOf: w.projOf, valueOf: w.valueOf, horizon: 'week', lockedOf });
    assert(!r.rows.some(x => x.pid === 'fa_rb'), 'a locked free agent is not a this-week pickup');
    // Lock my bench WR: he can no longer be the drop.
    const r2 = W.streamUpgrades({ roster: w.roster, league: w.league, playersData: w.pd, candidates: w.candidates, projOf: w.projOf, valueOf: w.valueOf, horizon: 'week', lockedOf: pid => pid === 'mybench' });
    assert(r2.rows.every(x => !x.drop || x.drop.pid !== 'mybench'));
    // Locked starter in the RB slot (starters order = QB,RB,RB,WR,FLEX).
    const roster = { ...w.roster, starters: ['myqb', 'myrb1', 'myrb2', 'mywr', 'mybench'] };
    const r3 = W.streamUpgrades({ roster, league: w.league, playersData: w.pd, candidates: w.candidates, projOf: w.projOf, valueOf: w.valueOf, horizon: 'week', lockedOf: pid => pid === 'myrb2' });
    assert.equal(r3.week.lockedStarters, 1);
    const rb = r3.rows.find(x => x.pid === 'fa_rb');
    // myrb2 (6) is locked in his RB slot: the FA back (12) can only take the FLEX from the bench WR (4) → +8 still, via FLEX.
    assert(rb && rb.weekGain === 8, 'gain counts only open slots');
    assert(!rb.drop || rb.drop.pid !== 'myrb2', 'a locked starter is never the drop');
    // Season view keeps a locked free agent, flagged.
    const ros = { myqb: 200, myrb1: 150, myrb2: 60, mywr: 120, mybench: 30, fa_rb: 90, fa_wr: 140 };
    const r4 = W.streamUpgrades({ roster: w.roster, league: w.league, playersData: w.pd, candidates: w.candidates, projOf: w.projOf, rosOf: pid => ros[pid] ?? 0, valueOf: () => 1, horizon: 'season', lockedOf });
    const lk = r4.rows.find(x => x.pid === 'fa_rb');
    assert(lk && lk.locked === true);
});

test('faab-league: one definition, platform-aware', () => {
    const F = require('./faab-league.js');
    assert.equal(F.isFaabLeague({ settings: { waiver_type: 2, waiver_budget: 100 } }), true);
    assert.equal(F.isFaabLeague({ settings: { waiver_type: 0, waiver_budget: 100 } }), false);
    assert.deepEqual(F.faab({ settings: { waiver_type: 0, waiver_budget: 100 } }, { settings: { waiver_budget_used: 30 } }), { isFaab: false, budget: 0, spent: 0, remaining: 0, platform: 'sleeper' });
    assert.equal(F.faab({ settings: { waiver_type: 2, waiver_budget: 100 } }, { settings: { waiver_budget_used: 30 } }).remaining, 70);
    assert.equal(F.waiverLabel({ settings: { waiver_type: 0, waiver_budget: 100 } }), 'rolling waivers');
    assert.equal(F.waiverLabel({ settings: { waiver_type: 1, waiver_budget: 100 } }), 'reverse-standings waivers');
    assert.equal(F.waiverLabel({ _platform: 'espn', settings: {} }), 'waivers');
    assert.equal(W.isFaabLeague({ settings: { waiver_type: 0, waiver_budget: 100 } }), false, 'waiver-tools delegates / agrees');
});
