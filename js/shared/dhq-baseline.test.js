// Run with:  node --test js/shared/dhq-baseline.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('./dhq-baseline.js');

const HALF = { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2, fgm: 3, xpm: 1, idp_tkl_solo: 1, idp_tkl_ast: 0.5, idp_sack: 2, idp_int: 3, idp_pass_def: 1, idp_ff: 2 };

test('a receiver with a long track record projects near his own rates', () => {
    // 100 targets, 70 catches, 900 yards, 6 TD → catch .70, 9.0 ypt, 6% TD
    const r = B.buildLine({ position: 'WR', volume: 8, samples: [{ line: { rec_tgt: 100, rec: 70, rec_yd: 900, rec_td: 6, gp: 10 }, weight: 1 }] });
    assert.ok(r.line.rec > 5.3 && r.line.rec < 5.6, 'catch rate pulled a little toward .64: ' + r.line.rec);
    assert.ok(r.line.rec_yd > 68 && r.line.rec_yd < 72, 'ypt pulled a little toward 8.0: ' + r.line.rec_yd);
    assert.ok(r.line.rec_td > 0.4 && r.line.rec_td < 0.5);
    assert.match(r.why, /8\.0 targets/);
    assert.ok(B.scoreLine(r.line, HALF, 'WR') > 12);
});

test('a two-game sample is pulled hard toward the position norm', () => {
    // 10 targets, 9 catches, 200 yards, 3 TD — absurd rates that must not survive
    const r = B.buildLine({ position: 'WR', volume: 8, samples: [{ line: { rec_tgt: 10, rec: 9, rec_yd: 200, rec_td: 3, gp: 2 } }] });
    const ypt = r.line.rec_yd / 8, tdpt = r.line.rec_td / 8;
    assert.ok(ypt < 11, 'yards per target regressed: ' + ypt);
    assert.ok(tdpt < 0.08, 'touchdown rate regressed: ' + tdpt);
});

test('no history at all projects the position norm', () => {
    const r = B.buildLine({ position: 'TE', volume: 5, samples: [] });
    assert.ok(Math.abs(r.line.rec / 5 - 0.70) < 1e-9);
    assert.ok(Math.abs(r.line.rec_yd / 5 - 7.2) < 1e-9);
});

test('PFF grade tilts yardage but not touchdowns', () => {
    const lo = B.buildLine({ position: 'WR', volume: 8, samples: [], grades: { route: 50 } });
    const hi = B.buildLine({ position: 'WR', volume: 8, samples: [], grades: { route: 90 } });
    assert.ok(hi.line.rec_yd > lo.line.rec_yd);
    assert.equal(hi.line.rec_td, lo.line.rec_td);
    assert.equal(B.gradeTilt(65), 1);
    assert.ok(B.gradeTilt(200) <= 1.15 && B.gradeTilt(0) >= 0.85);
});

test('a back splits touches into carries and targets by his own split', () => {
    const r = B.buildLine({ position: 'RB', volume: 20, samples: [{ line: { rush_att: 150, rec_tgt: 50, rush_yd: 700, rush_td: 6, rec: 40, rec_yd: 300, rec_td: 1, gp: 10 } }] });
    assert.ok(r.line.rush_att > 14 && r.line.rush_att < 16, 'about three quarters carries: ' + r.line.rush_att);
    assert.ok(Math.abs(r.line.rush_att + r.line.rec_tgt - 20) < 1e-6);
    assert.ok(r.line.rush_yd > 55 && r.line.rush_yd < 75);
});

test('a quarterback line has passing and rushing', () => {
    const r = B.buildLine({ position: 'QB', volume: 34, samples: [{ line: { pass_att: 300, pass_cmp: 200, pass_yd: 2300, pass_td: 18, pass_int: 6, rush_att: 40, rush_yd: 200, rush_td: 2, gp: 9 } }] });
    assert.ok(r.line.pass_yd > 240 && r.line.pass_yd < 270, r.line.pass_yd);
    assert.ok(r.line.pass_td > 1.6 && r.line.pass_td < 2.2);
    assert.ok(r.line.rush_att > 3 && r.line.rush_att < 5);
    assert.ok(B.scoreLine(r.line, HALF, 'QB') > 18);
});

test('a defender line comes from projected tackles plus his sack and coverage rates', () => {
    const r = B.buildLine({ position: 'LB', volume: 9, samples: [{ line: { idp_tkl: 80, idp_tkl_solo: 50, idp_sack: 3, idp_int: 1, idp_pass_def: 4, idp_ff: 1, gp: 9 } }] });
    assert.ok(Math.abs(r.line.idp_tkl_solo + r.line.idp_tkl_ast - 9) < 1e-6);
    assert.ok(r.line.idp_sack > 0.2 && r.line.idp_sack < 0.35);
    assert.ok(B.scoreLine(r.line, HALF, 'LB') > 8);
});

test('a kicker line needs no volume input', () => {
    const r = B.buildLine({ position: 'K', samples: [{ line: { fga: 20, fgm: 18, xpa: 25, xpm: 25, gp: 9, fgm_20_29: 5, fgm_30_39: 6, fgm_40_49: 5, fgm_50p: 2 } }] });
    assert.ok(r.line.fgm > 1.7 && r.line.fgm < 2.1, r.line.fgm);
    const spread = ['fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50p'].reduce((s, k) => s + r.line[k], 0);
    assert.ok(Math.abs(spread - r.line.fgm) < 0.01, 'distance buckets add up to the makes');
});

test('TE premium is applied when the league has one', () => {
    const r = B.buildLine({ position: 'TE', volume: 6, samples: [] });
    const plain = B.scoreLine(r.line, HALF, 'TE');
    const prem = B.scoreLine(r.line, Object.assign({ bonus_rec_te: 0.5 }, HALF), 'TE');
    assert.ok(prem > plain);
});

test('recent weeks counted double pull the rates toward the hot hand', () => {
    const season = { line: { rec_tgt: 60, rec: 36, rec_yd: 420, rec_td: 2, gp: 6 } };       // 7.0 ypt
    const hot = { line: { rec_tgt: 30, rec: 24, rec_yd: 360, rec_td: 3, gp: 3 }, weight: 2 }; // 12 ypt
    const a = B.buildLine({ position: 'WR', volume: 8, samples: [season] });
    const b = B.buildLine({ position: 'WR', volume: 8, samples: [season, hot] });
    assert.ok(b.line.rec_yd > a.line.rec_yd);
});

test('a kicker line pays in every scoring style a league uses', () => {
    const r = B.buildLine({ position: 'K', samples: [{ line: { fga: 20, fgm: 18, xpa: 25, xpm: 25, gp: 9, fgm_20_29: 5, fgm_30_39: 6, fgm_40_49: 5, fgm_50p: 2, fgm_yds: 700, fgm_yds_over_30: 180 } }] });
    const buckets = B.scoreLine(r.line, { fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, fgmiss: -1, xpm: 1 }, 'K');
    const yards = B.scoreLine(r.line, { fgm_yds: 0.1, fgmiss: -1, xpm: 1 }, 'K');
    const longBuckets = B.scoreLine(r.line, { fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50_59: 5, fgm_60p: 6, xpm: 1 }, 'K');
    assert.ok(buckets > 6 && buckets < 12, 'bucket leagues: ' + buckets);
    assert.ok(yards > 6 && yards < 12, 'yards-per-make leagues: ' + yards);
    assert.ok(Math.abs(longBuckets - buckets) < 1.5, '50-59/60+ leagues pay about the same as 50+ leagues: ' + longBuckets + ' vs ' + buckets);
    assert.ok(Math.abs(r.line.fgm_50_59 + r.line.fgm_60p - r.line.fgm_50p) < 0.002, '50-59 plus 60+ adds up to 50+');
    assert.ok(r.line.fgm_yds / r.line.fgm > 35 && r.line.fgm_yds / r.line.fgm < 40, 'yards a make from his own distance mix: ' + r.line.fgm_yds / r.line.fgm);
});

test('make rate is by distance: automatic inside 40, shaky from 50, reads that way', () => {
    // 40 attempts on record: perfect inside 40, 4 of 10 from 50+
    const hist = { fga: 40, fgm: 34, xpa: 30, xpm: 30, gp: 17, fgm_20_29: 10, fgm_30_39: 10, fgm_40_49: 10, fgm_50p: 4, fgmiss_50p: 6 };
    const r = B.buildLine({ position: 'K', samples: [{ line: hist }] });
    const pct = (b) => r.line['fgm_' + b] / (r.line['fgm_' + b] + r.line['fgmiss_' + b]);
    assert.ok(pct('20_29') > 0.97 && pct('30_39') > 0.95, 'near automatic inside 40: ' + pct('20_29') + ' ' + pct('30_39'));
    assert.ok(pct('50p') > 0.45 && pct('50p') < 0.60, 'his 40% from 50+ pulled toward the 69.5% norm: ' + pct('50p'));
    assert.ok(Math.abs(r.line.fgm_20_29 + r.line.fgm_30_39 + r.line.fgm_40_49 + r.line.fgm_50p + r.line.fgm_0_19 - r.line.fgm) < 0.01, 'range makes add up');
    assert.ok(Math.abs(r.line.fgm + r.line.fgmiss - r.line.fga) < 0.01, 'makes plus misses equal attempts');
    assert.match(r.why, /50\+ \d+%/);
    // the same kicker with his 50+ tries flipped to makes projects more points in a yards league
    const good = B.buildLine({ position: 'K', samples: [{ line: Object.assign({}, hist, { fgm: 40, fgm_50p: 10, fgmiss_50p: 0 }) }] });
    assert.ok(B.scoreLine(good.line, { fgm_yds: 0.1, xpm: 1, fgmiss: -1 }, 'K') > B.scoreLine(r.line, { fgm_yds: 0.1, xpm: 1, fgmiss: -1 }, 'K'));
});

test('a receiver with no history is pulled toward his rank, not one league norm', () => {
    const wr1 = B.buildLine({ position: 'WR', volume: 8, samples: [], rank: 1 });
    const wr3 = B.buildLine({ position: 'WR', volume: 8, samples: [], rank: 3 });
    const wr7 = B.buildLine({ position: 'WR', volume: 8, samples: [], rank: 7 });
    const none = B.buildLine({ position: 'WR', volume: 8, samples: [] });
    const pts = (r) => B.scoreLine(r.line, { rec: 0.5, rec_yd: 0.1, rec_td: 6 }, 'WR');
    assert.ok(pts(wr1) > pts(wr3) && pts(wr3) > pts(wr7), 'WR1 > WR3 > WR7 per target: ' + pts(wr1) + ' ' + pts(wr3) + ' ' + pts(wr7));
    assert.ok(Math.abs(pts(wr1) / 8 - 1.48) < 0.03, 'a WR1 target is worth about 1.48 half-PPR: ' + pts(wr1) / 8);
    assert.ok(Math.abs(pts(none) / 8 - 1.39) < 0.03, 'no rank keeps the old league norm: ' + pts(none) / 8);
    assert.ok(Math.abs(wr7.line.rec_yd / 8 - 6.82) < 1e-6, 'rank past the table takes the last row');
});
