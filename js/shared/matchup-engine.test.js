// Run with:  node --test js/shared/matchup-engine.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./matchup-engine.js');

const BASE = { median: 15, floor: 11, ceiling: 21 };
const projectWith = (extra) => E.project(Object.assign({ pid: 'x', week: 3, position: 'WR', baseline: BASE, baselineSource: 'sleeper' }, extra));

test('weights sum to 100 and match the owner ruling', () => {
    const sum = Object.values(E.WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
    assert.deepEqual(E.WEIGHTS, { role: 18, health: 11, opponent: 12, game: 10, coaching: 8, h2h: 8, trench: 8, trend: 8, cast: 8, oppHealth: 6, luck: 3 });
});

test('no factor data at all → projection equals the baseline, grade C, every factor listed as missing', () => {
    const p = projectWith({});
    assert.equal(p.mult, 1);
    assert.deepEqual(p.points, { median: 15, floor: 11, ceiling: 21 });
    assert.equal(p.grade, 'C');
    assert.equal(p.verdict, 'flex');
    assert.equal(p.baseline.source, 'sleeper');
    assert.equal(p.missing.length, 11);
    assert.equal(p.why.length, 0);
});

test('a ruled-out or bye player projects zero and is unavailable', () => {
    for (const status of ['OUT', 'IR', 'BYE', 'SUS']) {
        const p = projectWith({ health: { status } });
        assert.equal(p.available, false, status);
        assert.deepEqual(p.points, { median: 0, floor: 0, ceiling: 0 });
        assert.equal(p.verdict, 'out');
    }
});

test('questionable trims the number and cuts the floor harder than the ceiling', () => {
    const p = projectWith({ health: { status: 'Q' } });
    assert.ok(p.points.median < 15 * 0.92 + 1e-9, 'flat availability trim plus the factor');
    assert.ok(p.points.floor / 11 < p.points.ceiling / 21, 'floor loses more than ceiling');
    assert.equal(p.available, true);
});

test('doubtful is treated as out for the lineup call', () => {
    const p = projectWith({ health: { status: 'Doubtful' } });
    assert.equal(p.available, false);
    assert.equal(p.verdict, 'out');
    assert.deepEqual(p.points, { median: 0, floor: 0, ceiling: 0 });
    assert.match(p.factors.find(f => f.key === 'health').note, /Doubtful, treated as out/);
});

test('a factor can never move the number more than weight × SWING percent', () => {
    // role has the biggest weight (22) → max ±11%
    const best = projectWith({ role: { posRank: 1, share: 0.3, snapShare: 1 } });
    const worst = projectWith({ role: { posRank: 4, share: 0, snapShare: 0 } });
    assert.ok(best.mult <= 1 + 0.22 * E.SWING + 1e-9);
    assert.ok(worst.mult >= 1 - 0.22 * E.SWING - 1e-9);
    assert.ok(best.mult > 1 && worst.mult < 1);
});

test('softest defense lifts, toughest defense drops, middle is neutral', () => {
    const soft = projectWith({ opponent: { abbr: 'CAR', rankVsPos: 32 } });
    const tough = projectWith({ opponent: { abbr: 'BAL', rankVsPos: 1 } });
    const mid = projectWith({ opponent: { abbr: 'DAL', rankVsPos: 16.5 } });
    assert.ok(soft.points.median > 15);
    assert.ok(tough.points.median < 15);
    assert.equal(mid.mult, 1);
    assert.match(soft.why[0].note, /Soft matchup vs CAR/);
});

test('division bully history helps every player on that team, and hurts the victim', () => {
    const bully = projectWith({ h2h: { games: 6, wins: 6, avgMargin: 12, division: true } });
    const victim = projectWith({ h2h: { games: 6, wins: 0, avgMargin: -12, division: true } });
    const nonDiv = projectWith({ h2h: { games: 6, wins: 6, avgMargin: 12, division: false } });
    assert.ok(bully.mult > 1);
    assert.ok(victim.mult < 1);
    assert.ok(bully.mult > nonDiv.mult, 'division games count more');
    assert.match(bully.why[0].note, /Owns this matchup \(6-0 last 6, division\)/);
    // one meeting is not history
    assert.equal(projectWith({ h2h: { games: 1, wins: 1 } }).mult, 1);
});

test('established staff vs green staff is an edge; even staffs are neutral', () => {
    const edge = projectWith({ coaching: { team: 0.9, opp: 0.3 } });
    const even = projectWith({ coaching: { team: 0.6, opp: 0.6 } });
    assert.ok(edge.mult > 1);
    assert.equal(even.mult, 1);
    assert.match(edge.why[0].note, /Staff edge/);
});

test('trench edge works from the player\'s side of the ball, including IDP', () => {
    const olWins = projectWith({ position: 'RB', trench: { mine: 80, theirs: 55 } });
    const dlWins = projectWith({ position: 'DL', trench: { mine: 85, theirs: 50 } });
    const dlLoses = projectWith({ position: 'DL', trench: { mine: 50, theirs: 85 } });
    assert.ok(olWins.mult > 1);
    assert.ok(dlWins.mult > 1);
    assert.ok(dlLoses.mult < 1);
});

test('game environment: implied total, spread by position, home/away, overseas, weather', () => {
    const shootout = projectWith({ game: { impliedTotal: 30 } });
    const slog = projectWith({ game: { impliedTotal: 15 } });
    assert.ok(shootout.mult > 1 && slog.mult < 1);

    const favRB = projectWith({ position: 'RB', game: { spread: -10 } });
    const favWR = projectWith({ position: 'WR', game: { spread: -10 } });
    assert.ok(favRB.mult > 1, 'big favorite helps the RB');
    assert.ok(favWR.mult < 1, 'big favorite slightly hurts the passing game');

    assert.ok(projectWith({ game: { home: true } }).mult > projectWith({ game: { home: false } }).mult);
    assert.ok(projectWith({ game: { international: true } }).mult < 1);

    const windyWR = projectWith({ position: 'WR', game: { weather: { display: 'Wind 25 mph' } } });
    const windyRB = projectWith({ position: 'RB', game: { weather: { display: 'Wind 25 mph' } } });
    const domeWR = projectWith({ position: 'WR', game: { weather: { display: 'Wind 25 mph', indoor: true } } });
    assert.ok(windyWR.mult < 1);
    assert.equal(windyRB.mult, 1);
    assert.equal(domeWR.mult, 1);
});

test('trend: hot last three weeks lifts, cold drops, tiny sample is ignored', () => {
    assert.ok(projectWith({ trend: { last3: 20, season: 14 } }).mult > 1);
    assert.ok(projectWith({ trend: { last3: 8, season: 14 } }).mult < 1);
    assert.equal(projectWith({ trend: { last3: 5, season: 1 } }).mult, 1);
});

test('luck: unsustainable touchdown rate is a penalty, drought is a smaller boost', () => {
    const hot = projectWith({ luck: { tdRate: 0.12, expectedTdRate: 0.06 } });
    const cold = projectWith({ luck: { tdRate: 0.0, expectedTdRate: 0.06 } });
    assert.ok(hot.mult < 1);
    assert.ok(cold.mult > 1);
    assert.ok(Math.abs(hot.mult - 1) > Math.abs(cold.mult - 1));
});

test('grades follow the multiplier thresholds', () => {
    assert.equal(E.gradeFor(1.2), 'A');
    assert.equal(E.gradeFor(1.06), 'B');
    assert.equal(E.gradeFor(1.0), 'C');
    assert.equal(E.gradeFor(0.9), 'D');
    assert.equal(E.gradeFor(0.8), 'F');
    assert.equal(E.verdictFor('A', true), 'start');
    assert.equal(E.verdictFor('C', true), 'flex');
    assert.equal(E.verdictFor('F', true), 'sit');
    assert.equal(E.verdictFor('A', false), 'out');
});

test('the "why" list is sorted by impact and only lists factors that had data', () => {
    const p = projectWith({
        role: { posRank: 1, share: 0.25, snapShare: 0.9 },
        opponent: { rankVsPos: 30 },
        luck: { tdRate: 0.06, expectedTdRate: 0.06 },
    });
    assert.deepEqual(p.why.map(w => w.key), ['role', 'opponent', 'luck']);
    assert.equal(p.missing.length, 8);
    for (let i = 1; i < p.why.length; i++) assert.ok(Math.abs(p.why[i - 1].impactPct) >= Math.abs(p.why[i].impactPct));
});

test('a full stacked best case and worst case stay inside sane bounds', () => {
    const best = projectWith({
        role: { posRank: 1, share: 0.3, snapShare: 1 }, health: { status: '' }, opponent: { rankVsPos: 32 },
        game: { impliedTotal: 31, home: true }, coaching: { team: 1, opp: 0 }, h2h: { games: 6, wins: 6, avgMargin: 20, division: true },
        trench: { mine: 95, theirs: 40 }, trend: { last3: 25, season: 12 }, cast: { qb: { name: 'Q', status: '', grade: 92 } }, luck: { tdRate: 0, expectedTdRate: 0.06 },
    });
    const worst = projectWith({
        role: { posRank: 4, share: 0, snapShare: 0 }, health: { status: 'D', practice: 'DNP', weeksSinceReturn: 0 }, opponent: { rankVsPos: 1 },
        game: { impliedTotal: 14, home: false, international: true, weather: { display: 'Snow' } }, coaching: { team: 0, opp: 1 }, h2h: { games: 6, wins: 0, avgMargin: -20, division: true },
        trench: { mine: 40, theirs: 95 }, trend: { last3: 4, season: 12 }, cast: { qb: { name: 'Q', status: 'OUT', grade: 40 } }, luck: { tdRate: 0.2, expectedTdRate: 0.06 },
    });
    assert.equal(best.grade, 'A');
    assert.equal(worst.grade, 'F');
    assert.ok(best.mult < 1.6, 'best case ' + best.mult);
    assert.ok(worst.mult > 0.5, 'worst case ' + worst.mult);
    assert.ok(best.points.floor <= best.points.median && best.points.median <= best.points.ceiling);
});

test('role: WR1 with the targets beats WR2; a WR2 getting WR1 volume closes the gap', () => {
    const wr1 = projectWith({ role: { posRank: 1, share: 0.26, snapShare: 0.9, gamesPlayed: 6 } });
    const wr2 = projectWith({ role: { posRank: 2, share: 0.15, snapShare: 0.85, gamesPlayed: 6 } });
    const wr2hot = projectWith({ role: { posRank: 2, share: 0.27, snapShare: 0.85, gamesPlayed: 6 } });
    const wr3 = projectWith({ role: { posRank: 3, share: 0.08, snapShare: 0.6, gamesPlayed: 6 } });
    assert.ok(wr1.mult > wr2.mult && wr2.mult > wr3.mult);
    assert.ok(wr2hot.mult > wr2.mult, 'volume lifts the WR2');
    assert.ok((wr2hot.mult - wr2.mult) > (wr1.mult - wr2hot.mult), 'volume closes most of the gap; the chart still counts');
});

test('role: an RB2 is a backup but a WR2 is a starter', () => {
    assert.ok(E.rankEffect('RB', 2) < 0);
    assert.ok(E.rankEffect('WR', 2) > 0);
    assert.equal(E.rankEffect('TE', 1), 1);
    assert.equal(E.rankEffect('QB', 2), -1);
    assert.equal(E.rankEffect('WR', 9), -1, 'deeper than the table is the bottom');
});

test('role: early season leans on the depth chart, later the ball share takes over', () => {
    const chartSaysNo = { posRank: 3, share: 0.28, snapShare: 0.8 };
    const early = projectWith({ role: Object.assign({ gamesPlayed: 1 }, chartSaysNo) });
    const later = projectWith({ role: Object.assign({ gamesPlayed: 8 }, chartSaysNo) });
    assert.ok(later.mult > early.mult, 'the targets count for more once there are enough games');
});

test('role: the why note reads depth chart, share, snaps and projected targets', () => {
    const p = projectWith({ role: { posRank: 2, share: 0.27, shareRank: 1, shareBasis: 'targets', snapShare: 0.84, projTargets: 7.4, sleeperTargets: 6.5, gamesPlayed: 5 } });
    const note = p.factors.find(f => f.key === 'role').note;
    assert.equal(note, 'WR2 on the depth chart · 27% of team targets (1st on team) · 84% of snaps · 7.4 projected targets, Sleeper 6.5');
});

test('role: only snaps known still scores, nothing known is no data', () => {
    assert.ok(projectWith({ role: { snapShare: 0.95 } }).mult > 1);
    assert.equal(projectWith({ role: {} }).mult, 1);
    assert.ok(projectWith({ role: {} }).missing.includes('role'));
});

test('role: kickers and team defenses sit the factor out', () => {
    assert.equal(projectWith({ position: 'K', role: { posRank: 1 } }).mult, 1);
    assert.equal(projectWith({ position: 'DEF', role: { posRank: 1 } }).mult, 1);
});

test('opponent note carries the evidence behind the rank', () => {
    const p = projectWith({ opponent: { abbr: 'KC', rankVsPos: 7, detail: '7th in pts to RBs · run D 61 (14th) · 2-0, PFF 3rd' } });
    assert.equal(p.factors.find(f => f.key === 'opponent').note, 'Elite unit vs KC (rank 7 of 32) · 7th in pts to RBs · run D 61 (14th) · 2-0, PFF 3rd');
});

test('trench uses the league-ranked score when given and shows both ranks', () => {
    const ranked = projectWith({ position: 'RB', trench: { mine: 84, theirs: 61, score: 0.4, mineRank: 2, theirsRank: 14, mineLabel: 'IND run block', theirsLabel: 'KC run D' } });
    const raw = projectWith({ position: 'RB', trench: { mine: 84, theirs: 61 } });
    assert.equal(ranked.factors.find(f => f.key === 'trench').note, 'Wins the trenches: IND run block 84 (2nd) vs KC run D 61 (14th)');
    assert.ok(ranked.mult !== raw.mult, 'the ranked score is what counts when present');
    assert.ok(projectWith({ position: 'RB', trench: { mine: 60, theirs: 60, score: -0.9 } }).mult < 1);
});

test('a DHQ-built baseline uses the DHQ weight set, which also sums to 100', () => {
    assert.equal(Object.values(E.WEIGHTS_DHQ).reduce((a, b) => a + b, 0), 100);
    const p = E.project({ position: 'WR', baseline: BASE, baselineSource: 'dhq', role: { posRank: 1, snapShare: 1 }, opponent: { rankVsPos: 32 } });
    assert.equal(p.weights.role, 12);
    assert.equal(p.weights.cast, 6);
    assert.equal(p.factors.find(f => f.key === 'opponent').weight, 18);
    assert.equal(p.baseline.source, 'dhq');
    const q = E.project({ position: 'WR', baseline: BASE, baselineSource: 'sleeper', opponent: { rankVsPos: 32 } });
    assert.equal(q.factors.find(f => f.key === 'opponent').weight, 12);
});

test('supporting cast: a receiver with his QB1 out takes the full hit, a backup QB is a big minus, a healthy good QB is a plus', () => {
    const out = projectWith({ cast: { qb: { name: 'Star', status: 'Out', grade: 85 } } });
    const backup = projectWith({ cast: { qb: { name: 'Clipboard', status: '', grade: 55, backup: true } } });
    const q = projectWith({ cast: { qb: { name: 'Star', status: 'Q', grade: 85 } } });
    const good = projectWith({ cast: { qb: { name: 'Star', status: '', grade: 85 } } });
    const meh = projectWith({ cast: { qb: { name: 'Guy', status: '', grade: 60 } } });
    assert.ok(out.mult < backup.mult && backup.mult < q.mult && q.mult < good.mult, [out.mult, backup.mult, q.mult, good.mult].join(' < '));
    assert.ok(good.mult > 1 && meh.mult < 1);
    assert.match(backup.factors.find(f => f.key === 'cast').note, /Backup QB Clipboard starting/);
});

test('supporting cast: losing one favorite target barely registers, losses pile up fast', () => {
    const cast = (statuses) => ({ pieces: [
        { name: 'A', pos: 'WR', rank: 1, share: 0.25, status: statuses[0] || '' },
        { name: 'B', pos: 'WR', rank: 2, share: 0.15, status: statuses[1] || '' },
        { name: 'C', pos: 'TE', rank: 1, share: 0.15, status: statuses[2] || '' },
        { name: 'D', pos: 'RB', rank: 1, share: 0.10, status: '' }] });
    const s = (statuses) => projectWith({ position: 'QB', cast: cast(statuses) }).factors.find(f => f.key === 'cast').score;
    const full = s([]), one = s(['OUT']), two = s(['OUT', 'OUT']), three = s(['OUT', 'OUT', 'OUT']);
    assert.ok(full > 0, 'full cast is a small plus');
    assert.ok(Math.abs(one) < 0.1, 'one WR1 out is close to nothing: ' + one);
    assert.ok(two < -0.4 && two > -0.8, 'two down hurts: ' + two);
    assert.equal(three, -1, 'three down is the bottom');
    assert.ok((two - one) < (one - full) * -1 || (three - two) < (two - one), 'each loss costs more than the last');
    const note = projectWith({ position: 'QB', cast: cast(['OUT', 'Q']) }).factors.find(f => f.key === 'cast').note;
    assert.match(note, /^\d+% of his targets out: WR1 A out \(25%\), WR2 B questionable \(15%\)$/);
    assert.match(projectWith({ position: 'QB', cast: cast(['OUT', 'OUT']) }).factors.find(f => f.key === 'cast').note, /^2 weapons down, 40% of his targets out/);
});

test('supporting cast sits out for defenders and kickers keep the QB rule', () => {
    assert.equal(projectWith({ position: 'LB', cast: { qb: { name: 'Q', status: 'OUT' } } }).mult, 1);
    assert.ok(projectWith({ position: 'K', cast: { qb: { name: 'Q', status: 'OUT' } } }).mult < 1);
});

test('role note says when a player is the next man up or a fullback', () => {
    const base = { position: 'QB', role: { posRank: 1, listedRank: 2, promotedPast: ['Sam Darnold'], gamesPlayed: 1 } };
    const r = E.scorers.role(base);
    assert.match(r.note, /QB1 on the depth chart \(listed QB2, next man up: Sam Darnold out\)/);
    const fb = E.scorers.role({ position: 'RB', role: { posRank: 4, listedRank: 1, fullback: true, gamesPlayed: 1 } });
    assert.match(fb.note, /RB4 on the depth chart \(fullback\)/);
    assert.ok(fb.score < r.score, 'a fullback reads as a deep backup, a promoted starter as the starter');
});

test('opponent health lifts a receiver facing a patched secondary and a defender facing a backup QB', () => {
    const S = E.scorers.oppHealth;
    const full = S({ position: 'WR', oppHealth: { team: 'MIA', side: 'defense', db: { starters: 5, lost: 0, names: [] }, dl: { starters: 4, lost: 0, names: [] }, lb: { starters: 3, lost: 0, names: [] } } });
    assert.ok(full.score <= 0 && full.score > -0.2, 'full strength sits a hair under zero: ' + full.score);
    assert.match(full.note, /full strength/);
    const thin = S({ position: 'WR', oppHealth: { team: 'MIA', side: 'defense', db: { starters: 5, lost: 2, names: ['A out', 'B out'] }, dl: { starters: 4, lost: 0, names: [] }, lb: { starters: 3, lost: 0, names: [] } } });
    assert.ok(thin.score > 0.4, 'two of five secondary starters out is a real lift: ' + thin.score);
    assert.match(thin.note, /secondary 2 of 5 starters down \(A out, B out\)/);
    const rb = S({ position: 'RB', oppHealth: { team: 'MIA', side: 'defense', db: { starters: 5, lost: 2, names: ['A out', 'B out'] }, dl: { starters: 4, lost: 0, names: [] }, lb: { starters: 3, lost: 0, names: [] } } });
    assert.ok(rb.score < thin.score, 'a back cares less about the secondary than a receiver does');
    const dl = S({ position: 'DL', oppHealth: { team: 'SEA', side: 'offense', qb: { name: 'Sam Darnold', lost: 1, backup: 'Drew Lock' }, ol: { starters: 5, lost: 0, names: [] }, skill: { starters: 5, lost: 0, names: [] } } });
    assert.ok(dl.score > 0.3, 'a pass rusher facing a backup quarterback: ' + dl.score);
    assert.match(dl.note, /Backup QB Drew Lock starting \(Sam Darnold out\)/);
    assert.equal(S({ position: 'QB' }).score, null);
    assert.ok(E.WEIGHTS.oppHealth === 6 && E.WEIGHTS_DHQ.oppHealth === 6);
});
