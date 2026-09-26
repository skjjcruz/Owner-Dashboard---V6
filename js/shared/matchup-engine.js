// ══════════════════════════════════════════════════════════════════
// js/shared/matchup-engine.js — window.App.MatchupEngine
//
// DHQ PROJECTED POINTS for one player in one week.
//
// The idea in one sentence: start from a baseline number of points
// (Sleeper's published line scored through the league's rules, or the
// engine's own estimate when Sleeper has none), then move that number
// up or down by ten weighted factors that decide whether a player
// succeeds in a given matchup. The result is shown BESIDE Sleeper's
// number, never in place of it (owner ruling 2026-09-19).
//
// HOW A FACTOR WORKS
//   Every factor turns its raw inputs into a score from -1 (worst case)
//   to +1 (best case). 0 means neutral or "no data". The score is then
//   turned into a multiplier:
//
//       multiplier = 1 + score × (weight / 100) × SWING
//
//   so a factor with weight 22 and SWING 0.5 can move the projection by
//   at most ±11%, and a factor with weight 8 by at most ±4%. All ten
//   multipliers are multiplied together and applied to the baseline.
//
// THE FACTORS AND THEIR WEIGHTS (owner ruling 2026-09-19, sum = 100)
//   role        22  depth-chart rank at his position, projected share of the ball, snaps
//   health      14  injury tag, practice report, weeks since return
//   opponent    14  opposing defense (or offense, for IDP) vs this position
//   game        12  implied total, spread, home / away / overseas, weather
//   coaching     8  staff quality, this team's staff vs the opponent's
//   h2h          8  team-vs-team history, division games count double
//   trench       8  offensive line vs defensive line (best line wins)
//   trend        8  last three weeks vs season average
//   cast         8  supporting cast: is his quarterback (or, for a QB,
//                   his receivers and back) healthy and the real starter?
//                   Lines are left out on purpose; the trench factor has them.
//   luck         3  touchdown rate vs what is sustainable (regression)
//
// This file is PURE: it never fetches anything. Feeds (Sleeper, ESPN,
// PFF snapshot) build the input object; this file only does the math,
// so every line of it can be unit-tested in Node:
//     node --test js/shared/matchup-engine.test.js
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const WEIGHTS = {
        role: 18,
        health: 11,
        opponent: 12,
        game: 10,
        coaching: 8,
        h2h: 8,
        trench: 8,
        trend: 8,
        cast: 8,
        oppHealth: 6,
        luck: 3,
    };

    // Weights when the baseline is DHQ's own projection (owner ruling
    // 2026-09-20). Role's ball share already lives inside that baseline,
    // so role shrinks and the freed weight goes to the two factors that
    // missed Thursday night's shootout: opponent and game environment.
    const WEIGHTS_DHQ = {
        role: 12, health: 11, opponent: 18, game: 12, coaching: 8, h2h: 8, trench: 8, trend: 8, cast: 6, oppHealth: 6, luck: 3,
    };

    // How far a factor at full strength may move the number, as a share
    // of its weight. 0.5 means "weight 22 → up to ±11%".
    const SWING = 0.5;

    const LABELS = {
        role: 'Role & opportunity',
        health: 'Health',
        opponent: 'Opponent vs position',
        game: 'Game environment',
        coaching: 'Coaching staff',
        h2h: 'Head-to-head history',
        trench: 'Trench edge (OL vs DL)',
        trend: 'Trend line',
        cast: 'Supporting cast',
        oppHealth: 'Opponent health',
        luck: 'Luck & regression',
    };

    const LEAGUE_AVG_IMPLIED = 22.5;   // average NFL implied team total
    const OUT_STATUSES = new Set(['OUT', 'IR', 'PUP', 'SUS', 'NA', 'DNP', 'BYE', 'COV']);
    const PASS_GAME_POSITIONS = new Set(['QB', 'WR', 'TE']);
    const IDP_POSITIONS = new Set(['DL', 'LB', 'DB']);

    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    // null and blank mean missing, never zero (a kicker with no matchup rank
    // was reading as rank 0, an elite unit, and losing 9% every week).
    function num(v) { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
    function pos(input) { return String(input && input.position || '').toUpperCase(); }

    // ── Factor scorers ───────────────────────────────────────────────
    // Each returns { score: -1..1 | null, note: 'plain-English reason' }.
    // null score = no data → treated as neutral (0) and flagged in `why`.

    // ── Role & opportunity ───────────────────────────────────────────
    // Three parts, each -1..1: where he sits on his team's depth chart at
    // his position, the share of his team's ball he is projected to get
    // (targets, touches, attempts or tackles), and his snap share. Early in
    // the season the depth chart carries more weight because one game of
    // targets is noise; from the third game on the ball share takes over.
    // A WR2 is a real starter; an RB2 is usually a backup; a TE2 rarely
    // matters — the tables say so.
    const RANK_EFFECT = {
        QB: [1, -1], RB: [1, -0.25, -1], WR: [1, 0.35, -0.4, -1], TE: [1, -0.6, -1], K: [1, -1],
        DL: [1, -0.5, -1], LB: [1, -0.5, -1], DB: [1, -0.5, -1],
    };
    // Ball share that reads as the bottom and the top of the scale.
    const SHARE_SCALE = { QB: [0.5, 1], RB: [0.10, 0.55], WR: [0.05, 0.28], TE: [0.04, 0.20], DL: [0.02, 0.10], LB: [0.04, 0.16], DB: [0.03, 0.12] };
    const SHARE_LABEL = { targets: 'team targets', touches: 'team touches', attempts: 'pass attempts', tackles: 'team tackles' };
    function rankEffect(P, rank) {
        const t = RANK_EFFECT[P] || [1, -0.4, -1];
        return t[Math.min(t.length, Math.max(1, Math.round(rank))) - 1];
    }
    function shareEffect(P, share) {
        const sc = SHARE_SCALE[P];
        if (!sc || share == null) return null;
        return clamp(((share - sc[0]) / (sc[1] - sc[0])) * 2 - 1, -1, 1);
    }
    const ordinal = (n) => { const m = n % 100, d = n % 10; return n + ((m >= 11 && m <= 13) ? 'th' : d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'); };
    const pct = (v) => Math.round(v * 100) + '%';

    function scoreRole(input) {
        const r = input.role;
        if (!r) return { score: null, note: 'No depth-chart data' };
        const P = pos(input);
        if (P === 'K' || P === 'DEF') return { score: null, note: 'No role split at this position' };
        const rank = num(r.posRank);
        const share = num(r.share);
        const snap = num(r.snapShare);
        const parts = [];
        const notes = [];
        const early = num(r.gamesPlayed) != null && num(r.gamesPlayed) < 3;
        if (rank != null) {
            parts.push({ w: early ? 0.55 : 0.40, s: rankEffect(P, rank) });
            let n = (P === 'K' ? 'K' : P) + Math.round(rank) + ' on the depth chart';
            if (r.slotNote) n += ' (' + r.slotNote + ')';
            if (r.backupQb) n += ' (backup, projected zero unless the starter is out)';
            if (Array.isArray(r.promotedPast) && r.promotedPast.length && num(r.listedRank) != null) n += ' (listed ' + P + Math.round(num(r.listedRank)) + ', next man up: ' + r.promotedPast.join(', ') + ' out)';
            else if (r.fullback) n += ' (fullback)';
            notes.push(n);
        }
        const se = shareEffect(P, share);
        if (se != null) {
            parts.push({ w: early ? 0.25 : 0.40, s: se });
            let n = pct(share) + ' of ' + (SHARE_LABEL[r.shareBasis] || 'team touches');
            if (num(r.shareRank) != null) n += ' (' + ordinal(Math.round(r.shareRank)) + ' on team)';
            notes.push(n);
        }
        if (snap != null) {
            parts.push({ w: 0.20, s: clamp((snap - 0.5) * 2, -1, 1) });
            notes.push(pct(snap) + ' of snaps');
        }
        if (!parts.length) return { score: null, note: 'No depth-chart data' };
        const wsum = parts.reduce((a, b) => a + b.w, 0);
        const score = clamp(parts.reduce((a, b) => a + b.w * b.s, 0) / wsum, -1, 1);
        if (num(r.projTargets) != null) {
            const unit = r.shareBasis === 'touches' ? 'touches' : r.shareBasis === 'attempts' ? 'attempts' : r.shareBasis === 'tackles' ? 'tackles' : 'targets';
            let n = Number(r.projTargets).toFixed(1) + ' projected ' + unit;
            if (num(r.freedTargets) >= 0.3) n += ' (+' + Number(r.freedTargets).toFixed(1) + ' freed by injured teammates)';
            if (r.snapGate && num(r.snapGate.snap) != null) n += ' (trimmed: ' + Math.round(num(r.snapGate.snap) * 100) + '% of snaps last game)';
            if (r.snapScale && num(r.snapScale.snap) != null) n += ' (x' + Number(r.snapScale.factor).toFixed(2) + ' for ' + Math.round(num(r.snapScale.snap) * 100) + '% of snaps last game)';
            if (num(r.sleeperTargets) != null) n += ', Sleeper ' + Number(r.sleeperTargets).toFixed(1);
            notes.push(n);
        }
        return { score, note: notes.join(' · ') };
    }

    function scoreHealth(input) {
        if (!input.health) return { score: null, note: 'No injury report' };
        const h = input.health;
        const status = String(h.status || '').trim().toUpperCase();
        if (OUT_STATUSES.has(status)) return { score: -1, note: status === 'BYE' ? 'Bye week' : 'Ruled out (' + status + ')', out: true };
        // A Doubtful player misses far more often than he plays, so for a
        // lineup call he is out (owner ruling 2026-09-19: the tool had put
        // two Doubtful players in a "would start" list).
        if (status === 'D' || status === 'DOUBTFUL') return { score: -1, note: 'Doubtful, treated as out', out: true };
        let s = 0;
        const notes = [];
        if (status === 'Q' || status === 'QUESTIONABLE') { s -= 0.35; notes.push('Questionable'); }
        const practice = String(h.practice || '').toUpperCase();
        if (practice === 'DNP') { s -= 0.2; notes.push('Did not practice'); }
        else if (practice === 'LP') { s -= 0.1; notes.push('Limited in practice'); }
        const back = num(h.weeksSinceReturn);
        if (back === 0) { s -= 0.25; notes.push('First game back'); }
        else if (back === 1) { s -= 0.1; notes.push('Second game back'); }
        if (!notes.length) notes.push('Healthy');
        return { score: clamp(s, -1, 1), note: notes.join(' · ') };
    }

    // rankVsPos: 1 = toughest unit against this position, 32 = softest.
    function scoreOpponent(input) {
        const o = input.opponent || {};
        const rank = num(o.rankVsPos);
        if (rank == null) return { score: null, note: 'No matchup rank yet' };
        // a kicker's matchup is the whole defense, and it matters half as much
        const s = clamp((rank - 16.5) / 15.5, -1, 1) * (pos(input) === 'K' ? 0.5 : 1);
        const who = o.abbr ? ' vs ' + o.abbr : '';
        const label = s >= 0.5 ? 'Soft matchup' : s >= 0.15 ? 'Favorable matchup' : s > -0.15 ? 'Neutral matchup' : s > -0.5 ? 'Tough matchup' : 'Elite unit';
        // detail: the evidence behind the rank (points allowed, PFF unit
        // grade, last season, team quality), built by the inputs layer.
        return { score: s, note: label + who + ' (rank ' + Math.round(rank) + ' of 32)' + (o.detail ? ' · ' + o.detail : '') };
    }

    function scoreGame(input) {
        const g = input.game;
        if (!g) return { score: null, note: 'No game info yet' };
        const P = pos(input);
        let s = 0;
        const notes = [];
        const implied = num(g.impliedTotal);
        if (implied != null && implied > 0) {
            if (P === 'K' && input.baselineSource === 'dhq') notes.push('Implied ' + implied.toFixed(1) + ' pts (already in the baseline)');
            else { s += clamp((implied - LEAGUE_AVG_IMPLIED) / 7.5, -1, 1) * 0.6; notes.push('Implied ' + implied.toFixed(1) + ' pts'); }
        }
        const spread = num(g.spread); // negative = this team favored
        if (spread != null) {
            const favored = clamp(-spread / 14, -1, 1);
            // Favorites run out the clock (good for RB); underdogs throw (mild
            // help to the passing game). Kickers and IDP are left alone.
            if (P === 'RB') s += favored * 0.25;
            else if (PASS_GAME_POSITIONS.has(P)) s -= favored * 0.15;
            notes.push(spread <= 0 ? 'Favored by ' + Math.abs(spread) : 'Underdog by ' + spread);
        }
        if (g.international) { s -= 0.15; notes.push('Overseas game'); }
        else if (g.neutral) { notes.push('Neutral site'); }
        else if (g.home === true) { s += 0.2; notes.push('Home'); }
        else if (g.home === false) { s -= 0.2; notes.push('Away'); }
        const w = g.weather;
        if (w && !w.indoor) {
            const d = String(w.display || w.condition || '').toLowerCase();
            const cold = num(w.tempF) != null && num(w.tempF) <= 25;
            const bad = /wind|rain|snow|storm/.test(d) || cold;
            if (bad && P !== 'RB' && !IDP_POSITIONS.has(P)) { s -= 0.3; notes.push('Weather: ' + (w.display || w.condition || 'cold')); }
        }
        if (!notes.length) return { score: null, note: 'No game info yet' };
        return { score: clamp(s, -1, 1), note: notes.join(' · ') };
    }

    // team / opp: staff scores 0..1 (built by the ESPN feed from tenure,
    // win rate and playoff history). Better staff than the opponent → plus.
    function scoreCoaching(input) {
        const c = input.coaching || {};
        const mine = num(c.team), theirs = num(c.opp);
        if (mine == null || theirs == null) return { score: null, note: 'No coaching data' };
        const s = clamp((mine - theirs) * 2, -1, 1);
        const label = s > 0.3 ? 'Staff edge' : s < -0.3 ? 'Staff disadvantage' : 'Even staffs';
        return { score: s, note: label + ' (' + Math.round(mine * 100) + ' vs ' + Math.round(theirs * 100) + ')' };
    }

    // Team-vs-team history from the PLAYER'S team's point of view.
    // games / wins / avgMargin over the recent meetings; division = true
    // makes the effect count more (they meet twice a year, it is a rivalry).
    function scoreH2h(input) {
        const h = input.h2h || {};
        const games = num(h.games) || 0;
        if (games < 2) return { score: null, note: 'Not enough recent meetings' };
        const wins = num(h.wins) || 0;
        const margin = num(h.avgMargin) || 0;
        let s = ((wins / games) - 0.5) * 2 * 0.6 + clamp(margin / 14, -1, 1) * 0.4;
        s *= Math.min(1, games / 4);           // two meetings say less than four
        if (h.division) s *= 1.25;             // division bully / division victim
        s = clamp(s, -1, 1);
        const rec = wins + '-' + (games - wins);
        const label = s > 0.35 ? 'Owns this matchup' : s < -0.35 ? 'Gets bullied here' : 'Even history';
        return { score: s, note: label + ' (' + rec + ' last ' + games + (h.division ? ', division' : '') + ')' };
    }

    // mine / theirs: 0..100 unit grades from the PLAYER'S side of the ball.
    // Offense: my OL vs their DL. IDP: my DL vs their OL. Feeds pick the pair.
    // t.score (-1..1) is the league-ranked gap built by the inputs layer:
    // my line's percentile among 32 teams minus their front's. Without it,
    // fall back to the raw grade gap. mineRank / theirsRank feed the note.
    function scoreTrench(input) {
        const t = input.trench || {};
        const mine = num(t.mine), theirs = num(t.theirs);
        if (mine == null || theirs == null) return { score: null, note: 'No line grades' };
        const s = num(t.score) != null ? clamp(num(t.score), -1, 1) : clamp((mine - theirs) / 40, -1, 1);
        const label = s > 0.25 ? 'Wins the trenches' : s < -0.25 ? 'Loses the trenches' : 'Even in the trenches';
        const rk = (r) => num(r) != null ? ' (' + ordinal(Math.round(r)) + ')' : '';
        const what = t.mineLabel && t.theirsLabel ? t.mineLabel + ' ' + Math.round(mine) + rk(t.mineRank) + ' vs ' + t.theirsLabel + ' ' + Math.round(theirs) + rk(t.theirsRank) : Math.round(mine) + rk(t.mineRank) + ' vs ' + Math.round(theirs) + rk(t.theirsRank);
        return { score: s, note: label + ': ' + what };
    }

    function scoreTrend(input) {
        const t = input.trend || {};
        const last3 = num(t.last3), season = num(t.season);
        if (last3 == null || season == null || season < 2) return { score: null, note: 'Not enough games' };
        const ratio = last3 / season;
        const s = clamp((ratio - 1) * 2, -1, 1);
        const label = s > 0.3 ? 'Heating up' : s < -0.3 ? 'Cooling off' : 'Steady';
        return { score: s, note: label + ' (' + last3.toFixed(1) + ' last 3 vs ' + season.toFixed(1) + ' season)' };
    }

    // ── Supporting cast ──────────────────────────────────────────────
    // input.cast = { qb: { name, status, grade, backup }, pieces: [{ name, pos, rank, share, status }] }
    //   qb      the quarterback who will actually start for the player's team
    //           (backup: true when the depth-chart QB1 is out and QB2 starts)
    //   pieces  for a quarterback: his WR1-3, TE1 and RB1 with each one's
    //           share of the team's targets/touches and injury status
    // Lines are never in here; the trench factor already grades them.
    const CAST_OUT = { OUT: 1, IR: 1, PUP: 1, SUS: 1, NA: 1, COV: 1, D: 0.85, Q: 0.3 };
    function castStatusWeight(status) { return CAST_OUT[String(status || '').trim().toUpperCase()] || 0; }
    function scoreCast(input) {
        const c = input.cast;
        if (!c) return { score: null, note: 'No supporting-cast data' };
        const P = pos(input);
        if (IDP_POSITIONS.has(P) || P === 'DEF') return { score: null, note: 'No supporting-cast rule at this position' };
        if (P === 'QB') {
            const pieces = (c.pieces || []).filter(p => p && num(p.share) != null);
            if (!pieces.length) return { score: null, note: 'No supporting-cast data' };
            let lost = 0, down = 0;
            const gone = [];
            for (const p of pieces) {
                const w = castStatusWeight(p.status);
                if (!w) continue;
                lost += num(p.share) * w;
                down += w;
                gone.push((p.pos || '') + (p.rank ? p.rank : '') + ' ' + (p.name || '') + ' ' + (w >= 0.85 ? 'out' : 'questionable') + ' (' + Math.round(num(p.share) * 100) + '%)');
            }
            // Cumulative, not linear (owner ruling 2026-09-20): losing one
            // favorite target barely registers because the throws go
            // somewhere else; the second loss hurts; by the third he is
            // throwing to the bottom of the depth chart. The share lost is
            // squared, and each man down past the first adds a step.
            //   one WR1 at 25%          → about -0.01
            //   WR1 + WR2 (40%)         → about -0.55
            //   WR1 + WR2 + TE1 (55%)   → -1 (bottom)
            const score = clamp(0.25 - 4.1 * lost * lost - 0.15 * Math.max(0, down - 1), -1, 0.25);
            const note = gone.length
                ? (Math.round(down) >= 2 ? Math.round(down) + ' weapons down, ' : '') + Math.round(lost * 100) + '% of his targets out: ' + gone.join(', ')
                : 'All his weapons in: ' + pieces.map(p => (p.pos || '') + (p.rank || '')).join(', ');
            return { score, note };
        }
        // Everyone else lives and dies with the quarterback under center.
        const qb = c.qb;
        if (!qb) return { score: null, note: 'No quarterback data' };
        const w = castStatusWeight(qb.status);
        const grade = num(qb.grade) > 0 ? num(qb.grade) : null;   // 0 = not graded yet
        const quality = grade != null ? clamp((grade - 65) / 25, -1, 1) * 0.5 : 0;
        let score, note;
        if (qb.backup) { score = clamp(-0.6 + quality * 0.5, -1, -0.3); note = 'Backup QB ' + (qb.name || '') + ' starting' + (grade != null ? ' (grade ' + Math.round(grade) + ')' : '') + (qb.starterOut ? ' · ' + qb.starterOut + ' out' : ''); }
        else if (w >= 0.85) { score = -0.9; note = 'QB1 ' + (qb.name || '') + ' out'; }
        else if (w > 0) { score = clamp(quality - 0.35, -1, 1); note = 'QB1 ' + (qb.name || '') + ' questionable' + (grade != null ? ' (grade ' + Math.round(grade) + ')' : ''); }
        else { score = quality; note = 'QB1 ' + (qb.name || '') + ' healthy' + (grade != null ? ' (grade ' + Math.round(grade) + ')' : ''); }
        return { score, note };
    }

    // Opponent health (owner ruling 2026-09-21): the other side of the
    // ball at less than full strength is a lift. Offensive players read the
    // opponent's secondary and front; defenders read the opponent's
    // quarterback, line and skill starters. A unit's damage is the share of
    // its starters lost (out 1, doubtful 0.85, questionable 0.3), and a
    // fifth of a unit gone is already a solid lift. Full strength sits a
    // hair below zero so the factor does not lift everyone.
    function unitDamage(u) {
        if (!u || !(num(u.starters) > 0)) return null;
        return clamp((num(u.lost) || 0) / num(u.starters), 0, 1);
    }
    function unitText(label, u) {
        if (!u) return null;
        const d = unitDamage(u) || 0;
        if (d <= 0) return null;
        return label + ' ' + (Math.round(num(u.lost) * 10) / 10) + ' of ' + u.starters + ' starters down (' + (u.names || []).join(', ') + ')';
    }
    function scoreOppHealth(input) {
        const o = input.oppHealth;
        if (!o) return { score: null, note: 'No opponent health data' };
        const P = pos(input);
        const lift = (d) => d == null ? 0 : clamp(d * 2.5, 0, 1);
        let mix = null;
        const parts = [];
        if (o.side === 'offense') {
            // a defender facing a backup quarterback, a patched line, or missing weapons
            const qbLost = o.qb ? (num(o.qb.lost) || 0) : 0;
            const qbPart = qbLost >= 0.85 ? 1 : qbLost > 0 ? 0.3 : 0;
            const ol = lift(unitDamage(o.ol)), sk = lift(unitDamage(o.skill));
            if (P === 'DL') mix = 0.5 * qbPart + 0.5 * ol;
            else if (P === 'DB') mix = 0.5 * qbPart + 0.5 * sk;
            else mix = 0.3 * qbPart + 0.4 * ol + 0.3 * sk;
            if (o.qb && qbLost >= 0.85) parts.push('Backup QB ' + (o.qb.backup || '') + ' starting (' + o.qb.name + ' out)');
            else if (o.qb && qbLost > 0) parts.push('QB1 ' + o.qb.name + ' questionable');
            const t1 = unitText('line', o.ol), t2 = unitText('skill', o.skill);
            if (t1) parts.push(t1); if (t2) parts.push(t2);
        } else {
            const db = lift(unitDamage(o.db));
            const front = lift(unitDamage(o.dl != null || o.lb != null ? { starters: (num(o.dl && o.dl.starters) || 0) + (num(o.lb && o.lb.starters) || 0), lost: (num(o.dl && o.dl.lost) || 0) + (num(o.lb && o.lb.lost) || 0) } : null));
            if (P === 'RB') mix = 0.65 * front + 0.35 * db;
            else if (P === 'K') mix = 0.5 * front + 0.5 * db;
            else mix = 0.6 * db + 0.4 * front;
            const t1 = unitText('secondary', o.db), t2 = unitText('front', { starters: (num(o.dl && o.dl.starters) || 0) + (num(o.lb && o.lb.starters) || 0), lost: (num(o.dl && o.dl.lost) || 0) + (num(o.lb && o.lb.lost) || 0), names: [].concat(o.dl && o.dl.names || [], o.lb && o.lb.names || []) });
            if (t1) parts.push(t1); if (t2) parts.push(t2);
        }
        if (mix == null) return { score: null, note: 'No opponent health data' };
        const score = clamp(mix - 0.1, -0.1, 1);
        const note = parts.length ? (o.team ? o.team + ': ' : '') + parts.join(' · ') : (o.team || 'Opponent') + ' at full strength';
        return { score, note };
    }

    // A player scoring touchdowns far above the rate his usage supports is
    // due to cool off; one far below is due to warm up (half as strong).
    function scoreLuck(input) {
        const l = input.luck || {};
        const rate = num(l.tdRate), exp = num(l.expectedTdRate);
        if (rate == null || exp == null || exp <= 0) return { score: null, note: 'No regression data' };
        const diff = (rate - exp) / exp;
        let s;
        if (diff > 0) s = -clamp(diff, 0, 1);
        else s = clamp(-diff, 0, 1) * 0.5;
        const label = s < -0.3 ? 'Running hot, due to cool' : s > 0.2 ? 'Running cold, due to pop' : 'Sustainable';
        return { score: s, note: label };
    }

    const SCORERS = {
        role: scoreRole,
        health: scoreHealth,
        opponent: scoreOpponent,
        game: scoreGame,
        coaching: scoreCoaching,
        h2h: scoreH2h,
        trench: scoreTrench,
        trend: scoreTrend,
        cast: scoreCast,
        oppHealth: scoreOppHealth,
        luck: scoreLuck,
    };

    // ── Put it together ──────────────────────────────────────────────
    function weightsFor(input) {
        if (input && input.weights) return input.weights;
        return input && input.baselineSource === 'dhq' ? WEIGHTS_DHQ : WEIGHTS;
    }
    function factorScores(input) {
        const W = weightsFor(input);
        return Object.keys(W).map(key => {
            const r = SCORERS[key](input || {}) || {};
            const score = r.score == null ? null : clamp(Number(r.score) || 0, -1, 1);
            const mult = 1 + (score || 0) * (W[key] / 100) * SWING;
            return {
                key,
                label: LABELS[key],
                weight: W[key],
                score,
                mult: +mult.toFixed(4),
                impactPct: +(((mult - 1) * 100).toFixed(1)),
                note: r.note || '',
                out: !!r.out,
                hasData: score != null,
            };
        });
    }

    function gradeFor(mult) {
        if (mult >= 1.12) return 'A';
        if (mult >= 1.05) return 'B';
        if (mult >= 0.96) return 'C';
        if (mult >= 0.88) return 'D';
        return 'F';
    }

    // The lineup solver still makes the final call; this verdict is the
    // quick read a row can show before the owner opens the "why" panel.
    function verdictFor(grade, available) {
        if (!available) return 'out';
        if (grade === 'A' || grade === 'B') return 'start';
        if (grade === 'C') return 'flex';
        return 'sit';
    }

    // input.baseline: { median, floor, ceiling } league-scored points.
    function project(input) {
        input = input || {};
        const factors = factorScores(input);
        const out = factors.some(f => f.out);
        let mult = 1;
        for (const f of factors) mult *= f.mult;
        mult = +mult.toFixed(4);

        const base = input.baseline || {};
        const bMed = num(base.median) || 0;
        const bFloor = num(base.floor) != null ? num(base.floor) : bMed * 0.75;
        const bCeil = num(base.ceiling) != null ? num(base.ceiling) : bMed * 1.25;
        // Available means healthy enough to play; a baseline of zero is a
        // projection of zero, not an OUT (a TE4 with no snaps still dresses).
        const available = !out && num(base.median) != null;

        // Doubtful/questionable players keep their ceiling but lose floor:
        // the risk is that they play little or leave early.
        const health = factors.find(f => f.key === 'health');
        const floorPenalty = health && health.score != null && health.score < 0 ? Math.min(0.3, -health.score * 0.3) : 0;

        // Questionable players sit out roughly one game in five; trim the
        // whole line for that chance, on top of the health factor's nudge.
        // Same 0.92 the app's start/sit engine uses.
        const st = String(input.health && input.health.status || '').trim().toUpperCase();
        const availMult = (st === 'Q' || st === 'QUESTIONABLE') ? 0.92 : 1;
        const points = available ? {
            median: +(bMed * mult * availMult).toFixed(2),
            floor: +(bFloor * mult * availMult * (1 - floorPenalty)).toFixed(2),
            ceiling: +(bCeil * mult * availMult).toFixed(2),
        } : { median: 0, floor: 0, ceiling: 0 };

        const grade = available ? gradeFor(mult) : 'F';
        const verdict = available && points.median <= 0 ? 'sit' : verdictFor(grade, available);
        const why = factors
            .filter(f => f.hasData)
            .sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct))
            .map(f => ({ key: f.key, label: f.label, impactPct: f.impactPct, note: f.note }));
        const missing = factors.filter(f => !f.hasData).map(f => f.key);

        return {
            pid: input.pid,
            week: input.week,
            position: pos(input),
            available,
            baseline: { median: bMed, floor: +bFloor.toFixed(2), ceiling: +bCeil.toFixed(2), source: input.baselineSource || 'estimate', why: input.baselineWhy || '' },
            weights: weightsFor(input),
            mult,
            points,
            grade,
            verdict,
            factors,
            why,
            missing,
        };
    }

    App.MatchupEngine = App.MatchupEngine || {
        WEIGHTS, WEIGHTS_DHQ, SWING, LABELS,
        factorScores, weightsFor, project, gradeFor, verdictFor,
        scorers: SCORERS, rankEffect, shareEffect, RANK_EFFECT, SHARE_SCALE,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.MatchupEngine;
})(typeof window !== 'undefined' ? window : globalThis);
