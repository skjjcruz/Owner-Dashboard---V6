// Run with:  node --test js/shared/matchup-inputs.test.js
// Covers the pieces of MatchupInputs that work on plain stat tables
// (no network): kick and punt returns.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.POS_GROUPS = App.POS_GROUPS || { QB: ['QB'], RB: ['RB', 'FB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], DL: ['DE', 'DT', 'NT', 'DL'], LB: ['LB', 'OLB', 'ILB', 'MLB'], DB: ['CB', 'S', 'SS', 'FS', 'DB'] };
const I = require('./matchup-inputs.js');

// A team that has played two games this season: 8 kickoff returns, 3
// punt returns. Last season the same team: 68 KR and 34 PR in 17 games.
const teamCur = { gp: 2, kr: 8, kr_yd: 200, pr: 3, pr_yd: 30 };
const teamPri = { gp: 17, kr: 68, kr_yd: 1700, pr: 34, pr_yd: 340 };
const mkOpts = (me, mePri) => ({
    statsData: { TEAM_KC: teamCur, ret: me },
    priorData: { TEAM_KC: teamPri, ret: mePri },
    playersData: { ret: { team: 'KC', position: 'WR' } },
});
const week2 = { week: 2, stats: { TEAM_KC: { gp: 1, kr: 4, kr_yd: 100, pr: 1, pr_yd: 10 }, ret: { gp: 1, kr: 4, kr_yd: 100, pr: 1, pr_yd: 10 } } };

test('the man who took every return, this season and last, gets the team pace', () => {
    const r = I.returnLine('ret', { team: 'KC' }, 'KC', mkOpts({ gp: 2, kr: 8, kr_yd: 200, pr: 3, pr_yd: 30 }, { gp: 17, kr: 68, kr_yd: 1700, pr: 34, pr_yd: 340 }), { recentWeeks: [week2] });
    assert.ok(r, 'returner found');
    // team KR per game: (8 + 4 x 4.0) / (2 + 4) = 4.0; all his
    assert.equal(r.line.kr, 4);
    // team PR per game: (3 + 4 x 2.0) / 6 = 1.83; all his
    assert.equal(r.line.pr, 1.83);
    // yards a return shrink toward the league rate (25 own vs 25.9 norm)
    assert.ok(r.line.kr_yd > 95 && r.line.kr_yd < 105, 'kr yards ' + r.line.kr_yd);
    assert.ok(r.line.pr_yd > 17.5 && r.line.pr_yd < 19.5, 'pr yards ' + r.line.pr_yd);
    assert.ok(r.line.st_td > 0 && r.line.st_td < 0.1, 'a sliver of touchdown');
    assert.match(r.why, /4\.0 KR \(100% of team, 100% last game\)/);
});

test('a teammate who never returned a kick gets no return line', () => {
    const other = { week: 2, stats: { TEAM_KC: week2.stats.TEAM_KC, ret: { gp: 1, rec: 2 } } };
    const r = I.returnLine('ret', { team: 'KC' }, 'KC', mkOpts({ gp: 2, rec: 4 }, { gp: 17, rec: 40 }), { recentWeeks: [other] });
    assert.equal(r, null);
});

test('last game counts half: the new returner who took all of last week is at half share on a fresh season', () => {
    // no season row, no prior row for him; last game he took all 4 KR
    const r = I.returnLine('ret', { team: 'KC' }, 'KC', mkOpts(null, null), { recentWeeks: [week2] });
    assert.ok(r);
    // season share 0, last game 100% → 50% of 4.0 a game
    assert.equal(r.line.kr, 2);
    assert.match(r.why, /50% of team, 100% last game/);
});

test('week one: last season\'s returner keeps his share before a game is played', () => {
    const opts = mkOpts(null, { gp: 17, kr: 34, kr_yd: 850, pr: 34, pr_yd: 340 });
    opts.statsData = { ret: null };   // no team row yet
    const r = I.returnLine('ret', { team: 'KC' }, 'KC', opts, { recentWeeks: [] });
    assert.ok(r);
    // half the kickoff returns and all the punt returns at last season's pace
    assert.equal(r.line.kr, 2);
    assert.equal(r.line.pr, 2);
});

test('last season\'s share counts only for the team he returned for', () => {
    // the snapshot says KC's returns last season went to someone else
    globalThis.DhqUsage = { teams: { KC: { returns: { season: 2025, kr: { other: { n: 34, share: 1 } }, krTotal: 34, pr: { other: { n: 34, share: 1 } }, prTotal: 34 } } } };
    try {
        const opts = mkOpts(null, { gp: 17, kr: 34, kr_yd: 850, pr: 34, pr_yd: 340 });
        opts.statsData = { ret: null };
        assert.equal(I.returnLine('ret', { team: 'KC' }, 'KC', opts, { recentWeeks: [] }), null, 'his old-team returns do not follow him');
        // but the man the snapshot names keeps his share
        globalThis.DhqUsage.teams.KC.returns.kr.ret = { n: 17, share: 0.5 };
        const r = I.returnLine('ret', { team: 'KC' }, 'KC', opts, { recentWeeks: [] });
        assert.equal(r.line.kr, 2);
        assert.equal(r.line.pr, undefined);
    } finally { delete globalThis.DhqUsage; }
});

test('recent points from a supplied table: last three weeks he scored, before this week', () => {
    const wpp = { 1: { a: 10 }, 2: { a: 0 }, 3: { a: 20 }, 4: { a: 99 } };
    assert.equal(I.recentPPGFrom(wpp, 'a', 4, 3), 15);   // weeks 3, 2, 1; the zero is skipped; week 4 is not yet played
    assert.equal(I.recentPPGFrom(wpp, 'b', 4, 3), null);
});

// ── Audit of weeks 1-3 2026: typical week, kickers, defenders ──────────
require('./dhq-baseline.js');
const HALF = { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2,
    fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, fgmiss: -1, xpm: 1, xpmiss: -1,
    idp_tkl_solo: 1, idp_tkl_ast: 0.5, idp_tkl_loss: 1, idp_sack: 2, idp_qb_hit: 1, idp_int: 3, idp_pass_def: 1, idp_ff: 2, idp_fum_rec: 2 };
const base = (pid, player, grp, role, week) => I.dhqBaselineFor(pid, player, grp, role, { scoring: HALF, statsData: {}, priorData: {}, playersData: { [pid]: player } }, { week: week || 3, recentWeeks: [] });

test('a kicker with no games on record starts from the league-average kicker, not zero', () => {
    const b = base('k1', { team: 'NYJ', position: 'K' }, 'K', null, 1);
    assert.ok(b, 'has a line (used to be null, which projected 0)');
    assert.ok(b.mean > 6.5 && b.mean < 10, 'about a league-average kicker: ' + b.mean);
    assert.equal(b.median, b.mean, 'kickers show the average');
});

test('receivers show the typical week: three quarters of the expected TD points come off, sliding to a quarter at 9+ targets', () => {
    const low = base('w1', { team: 'KC', position: 'WR' }, 'WR', { projTargets: 5, posRank: 2 });
    const high = base('w2', { team: 'KC', position: 'WR' }, 'WR', { projTargets: 10, posRank: 1 });
    assert.ok(low.line.rec_tgt <= 7 && high.line.rec_tgt >= 9, 'targets ' + low.line.rec_tgt + ' / ' + high.line.rec_tgt);
    const cut = (b) => b.mean - b.median, td = (b) => b.line.rec_td * 6;
    assert.ok(Math.abs(cut(low) - 0.75 * td(low)) < 0.02, 'low cut ' + cut(low) + ' td pts ' + td(low));
    assert.ok(Math.abs(cut(high) - 0.25 * td(high)) < 0.02, 'high cut ' + cut(high) + ' td pts ' + td(high));
});

test('every back is shaded for his touchdown-skewed weeks, the lead back included', () => {
    const rb1 = base('r1', { team: 'KC', position: 'RB' }, 'RB', { projTargets: 18, posRank: 1 });
    const rb2 = base('r2', { team: 'KC', position: 'RB' }, 'RB', { projTargets: 8, posRank: 2 });
    for (const b of [rb1, rb2]) {
        const lam = (b.line.rush_td || 0) + (b.line.rec_td || 0);
        assert.ok(Math.abs((b.mean - b.median) - 0.5 * 6 * lam * Math.exp(-lam)) < 0.02, 'cut ' + (b.mean - b.median) + ' λ ' + lam);
        assert.ok(b.median < b.mean);
    }
});

test('a lineman\'s big plays follow his snaps, and his typical week keeps 60% of them', () => {
    const part = base('d1', { team: 'KC', position: 'DE' }, 'DL', { projTargets: 1, posRank: 3, snapScale: { snap: 0.12 } });
    const full = base('d2', { team: 'KC', position: 'DE' }, 'DL', { projTargets: 1, posRank: 1, snapScale: { snap: 0.8 } });
    assert.ok(part.line.idp_sack < full.line.idp_sack / 3, 'a 12%-snap backup is not charged a starter\'s sacks: ' + part.line.idp_sack + ' vs ' + full.line.idp_sack);
    assert.ok(full.median < full.mean, 'typical week under the average for a lineman');
});

test('a backup quarterback projects zero, average and typical week alike', () => {
    const b = base('q2', { team: 'KC', position: 'QB' }, 'QB', { projTargets: 30, posRank: 2, backupQb: true });
    assert.deepEqual([b.median, b.mean], [0, 0]);
});

// Raiders-style room: a star tight end out for weeks 1-2, back in week 3;
// the backup filled in. 30 team targets a game.
const roomFixture = () => {
    const wk = (w, bow, may) => ({ week: w, stats: Object.assign({ TEAM_LV: { gp: 1, rec_tgt: 30 }, wr1: { gp: 1, rec_tgt: 10 }, may: { gp: 1, rec_tgt: may } }, bow != null ? { bow: { gp: 1, rec_tgt: bow } } : {}) });
    const playersData = { bow: { team: 'LV', position: 'TE' }, may: { team: 'LV', position: 'TE' }, wr1: { team: 'LV', position: 'WR' } };
    const opts = {
        playersData,
        statsData: { TEAM_LV: { gp: 3, rec_tgt: 90 }, bow: { gp: 1, rec_tgt: 12 }, may: { gp: 3, rec_tgt: 18 }, wr1: { gp: 3, rec_tgt: 30 } },
        priorData: { TEAM_LV: { gp: 17, rec_tgt: 510 }, bow: { gp: 12, rec_tgt: 90 }, may: { gp: 17, rec_tgt: 34 }, wr1: { gp: 17, rec_tgt: 170 } },
    };
    const ctx = { week: 4, depth: null, recentWeeks: [wk(1, null, 8), wk(2, null, 8), wk(3, 12, 2)] };
    return { opts, ctx, role: (pid) => I.roleFor(pid, playersData[pid], playersData[pid].position, 'LV', opts, ctx) };
};

test('a week he missed is not a vote on his share: 12 of 30 targets in his one game is 40%', () => {
    const r = roomFixture().role('bow');
    assert.ok(Math.abs(r.earnedShare - 0.4) < 0.005, 'earned ' + r.earnedShare + ' (the missed weeks as zeros made it 24%)');
});

test('the backup who filled in keeps only what he got with the starter back', () => {
    const r = roomFixture().role('may');
    assert.ok(Math.abs(r.earnedShare - 2 / 30) < 0.005, 'earned ' + r.earnedShare + ' (his fill-in weeks made it 20%)');
});

test('a star tight end is not cut by the tight-end room; the backup still is', () => {
    const f = roomFixture();
    const bow = f.role('bow'), may = f.role('may');
    assert.ok(bow.trackShare >= 0.18, 'track ' + bow.trackShare);
    assert.equal(bow.roomScale, 1);
    assert.ok(may.roomScale < 1, 'backup room scale ' + may.roomScale);
});

test('a starter is not reset by a lesser teammate\'s return', () => {
    // wr1 (a third of the targets last year) played weeks 1-2 and missed
    // week 3; the tight end came back in week 3. wr1 keeps his own games.
    const playersData = { bow: { team: 'LV', position: 'TE' }, wr1: { team: 'LV', position: 'WR' } };
    const wk = (w, bow, wr1) => ({ week: w, stats: Object.assign({ TEAM_LV: { gp: 1, rec_tgt: 30 } }, bow != null ? { bow: { gp: 1, rec_tgt: bow } } : {}, wr1 != null ? { wr1: { gp: 1, rec_tgt: wr1 } } : {}) });
    const opts = {
        playersData,
        statsData: { TEAM_LV: { gp: 3, rec_tgt: 90 }, bow: { gp: 1, rec_tgt: 8 }, wr1: { gp: 2, rec_tgt: 20 } },
        priorData: { TEAM_LV: { gp: 17, rec_tgt: 510 }, bow: { gp: 12, rec_tgt: 90 }, wr1: { gp: 17, rec_tgt: 170 } },
    };
    const ctx = { week: 4, depth: null, recentWeeks: [wk(1, null, 10), wk(2, null, 10), wk(3, 8, null)] };
    const r = I.roleFor('wr1', playersData.wr1, 'WR', 'LV', opts, ctx);
    assert.ok(Math.abs(r.earnedShare - 1 / 3) < 0.005, 'earned ' + r.earnedShare);
});

test('last week\'s Out counts as playing until this week\'s final report; IR and a no-line Out stay out', () => {
    const now = Date.parse('2026-10-05T14:00:00Z');
    const lines = { p1: { rec_tgt: 8 }, p3: { rec_tgt: 8 } };
    const saved = App.WeeklyProj;
    App.WeeklyProj = { _ctx: { byTeamWeek: { 'MIN|5': { kickoff: '2026-10-11T17:00Z' }, 'WAS|5': { kickoff: '2026-10-06T00:15Z' } } }, projLine: (pid) => lines[pid] || null };
    try {
        const ctx = { week: 5, now };
        assert.equal(I.statusOf({ player_id: 'p1', team: 'MIN', injury_status: 'Out' }, ctx), '', 'Sunday game, Monday morning, Sleeper still has a line: playing');
        assert.equal(I.statusOf({ player_id: 'p2', team: 'MIN', injury_status: 'Out' }, ctx), 'OUT', 'no Sleeper line: expected to miss it');
        assert.equal(I.statusOf({ player_id: 'p3', team: 'MIN', injury_status: 'IR' }, ctx), 'IR', 'IR keeps its zero');
        assert.equal(I.statusOf({ player_id: 'p3', team: 'WAS', injury_status: 'Out' }, ctx), 'OUT', 'inside 44 hours the tag is this week\'s');
        assert.equal(I.statusOf({ player_id: 'p1', team: 'MIN', injury_status: 'Out' }, { week: 5, now: Date.parse('2026-10-09T23:00:00Z') }), 'OUT', 'Friday night: the final report is out');
    } finally { App.WeeklyProj = saved; }
});

// A star receiver hurt early in week 3 (12% of the snaps) and out in week 4.
const starFixture = () => {
    const row = (tgt, snp) => ({ gp: 1, rec_tgt: tgt, off_snp: snp, tm_off_snp: 60 });
    const wk = (w, jj, other) => ({ week: w, stats: Object.assign({ TEAM_MIN: { gp: 1, rec_tgt: 30 }, wr2: row(other, 50) }, jj ? { jj } : {}) });
    const playersData = { jj: { player_id: 'jj', team: 'MIN', position: 'WR' }, wr2: { player_id: 'wr2', team: 'MIN', position: 'WR' } };
    const opts = {
        playersData,
        statsData: { TEAM_MIN: { gp: 4, rec_tgt: 120 }, jj: { gp: 3, rec_tgt: 20, off_snp: 115, tm_off_snp: 180 }, wr2: { gp: 4, rec_tgt: 30, off_snp: 200, tm_off_snp: 240 } },
        priorData: { TEAM_MIN: { gp: 17, rec_tgt: 510 }, jj: { gp: 17, rec_tgt: 170, off_snp: 900, tm_off_snp: 1000 }, wr2: { gp: 17, rec_tgt: 51, off_snp: 500, tm_off_snp: 1000 } },
    };
    const ctx = { week: 5, depth: null, recentWeeks: [wk(2, row(9, 54), 6), wk(3, row(2, 7), 8), wk(4, null, 16)] };
    return { role: (pid) => I.roleFor(pid, playersData[pid], 'WR', 'MIN', opts, ctx) };
};

test('a game he left hurt is not a vote on his share: only his healthy games count', () => {
    const r = starFixture().role('jj');
    assert.ok(Math.abs(r.earnedShare - 9 / 30) < 0.005, 'earned ' + r.earnedShare + ' (the 12%-snap game and the missed week made it about 12%)');
});

test('a returning star takes his whole share; the room cut falls on the others', () => {
    const f = starFixture();
    const jj = f.role('jj');
    assert.equal(jj.returningStar, true);
    assert.equal(jj.roomScale, 1);
});
