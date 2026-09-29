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

test('receivers show the typical week: three quarters of the expected TD points come off', () => {
    const b = base('w1', { team: 'KC', position: 'WR' }, 'WR', { projTargets: 8, posRank: 1 });
    const td = b.line.rec_td * 6;
    assert.ok(Math.abs(b.median - (b.mean - 0.75 * td)) < 0.02, 'median ' + b.median + ' mean ' + b.mean + ' td pts ' + td);
    assert.ok(b.median < b.mean);
});

test('a lead back keeps his average; a backup is shaded for his zero-heavy weeks', () => {
    const rb1 = base('r1', { team: 'KC', position: 'RB' }, 'RB', { projTargets: 18, posRank: 1 });
    const rb2 = base('r2', { team: 'KC', position: 'RB' }, 'RB', { projTargets: 8, posRank: 2 });
    assert.equal(rb1.median, rb1.mean);
    assert.ok(rb2.median < rb2.mean);
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
