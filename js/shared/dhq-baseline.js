// ══════════════════════════════════════════════════════════════════
// js/shared/dhq-baseline.js — window.App.DhqBaseline
//
// DHQ's OWN projected stat line for a player-week, built without any
// outside projection (owner ruling 2026-09-20: take Sleeper's number out
// of the equation). Two halves:
//
//   VOLUME      how many targets, touches, attempts, tackles or kicks the
//               player gets. Supplied by the caller (the matchup inputs
//               layer projects it from the team's pace, the player's share
//               of the ball, injured teammates and the depth chart).
//   EFFICIENCY  what each one is worth: catch rate, yards per target,
//               yards per carry, touchdown rate, completion rate, pick
//               rate, sacks per game, make rate. Pooled from the player's
//               recent weeks (counted double), this season and last season,
//               and pulled toward the position norm by a fixed number of
//               "phantom" opportunities so a two-game sample cannot run
//               wild. PFF grades tilt the yardage rates: a 90-grade
//               receiver earns more per target than a 55.
//
// The result is a stat line in Sleeper's stat keys, so every league's
// scoring settings score it exactly as they score a box score.
//
// Pure: no fetching, no globals beyond App. Testable in Node:
//     node --test js/shared/dhq-baseline.test.js
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // Position norms a thin sample is pulled toward, and the number of
    // phantom opportunities (K) that pull carries.
    const NORM = {
        // Receivers and tight ends by usage rank (2023-25, 96 team-seasons a
        // rank, 11,779 WR1 targets): the norm a player's own rates are
        // pulled toward is his rank's, not one league bucket (owner ruling
        // 2026-09-22). The plain entry is the fallback with no rank.
        WR: { catch: 0.64, ypt: 8.0, tdpt: 0.045, K: 40, byRank: {
            1: { catch: 0.654, ypt: 8.37, tdpt: 0.053 }, 2: { catch: 0.625, ypt: 8.01, tdpt: 0.053 }, 3: { catch: 0.611, ypt: 7.78, tdpt: 0.045 },
            4: { catch: 0.616, ypt: 7.48, tdpt: 0.044 }, 5: { catch: 0.598, ypt: 6.82, tdpt: 0.045 } } },
        TE: { catch: 0.70, ypt: 7.2, tdpt: 0.050, K: 40, byRank: {
            1: { catch: 0.723, ypt: 7.56, tdpt: 0.049 }, 2: { catch: 0.724, ypt: 7.13, tdpt: 0.050 }, 3: { catch: 0.712, ypt: 6.56, tdpt: 0.050 } } },
        RB: { ypc: 4.2, tdpc: 0.030, catch: 0.76, ypt: 6.2, tdpt: 0.020, carryShare: 0.80, K: 60 },
        QB: { cmp: 0.65, ypa: 7.0, tdpa: 0.045, intpa: 0.022, rushAttPg: 3.0, rypc: 4.5, rtdpc: 0.04, K: 100 },
        DL: { soloShare: 0.62, sackPg: 0.35, intPg: 0.01, pdPg: 0.15, ffPg: 0.06, K: 8 },
        LB: { soloShare: 0.62, sackPg: 0.18, intPg: 0.04, pdPg: 0.25, ffPg: 0.06, K: 8 },
        DB: { soloShare: 0.75, sackPg: 0.04, intPg: 0.06, pdPg: 0.60, ffPg: 0.04, K: 8 },
        // Kickers by distance (2024-25 league totals): share of attempts
        // from each range, the make rate there, and the yards a make earns.
        K: { fgaPg: 2.0, xpaPg: 2.3, xpPct: 0.95, K: 12, Kb: 8,
             buckets: ['0_19', '20_29', '30_39', '40_49', '50p'],
             attShare: { '0_19': 0.003, '20_29': 0.200, '30_39': 0.270, '40_49': 0.280, '50p': 0.247 },
             makeRate: { '0_19': 0.99, '20_29': 0.975, '30_39': 0.935, '40_49': 0.805, '50p': 0.695 },
             ydsPerMake: { '0_19': 18, '20_29': 26, '30_39': 34.5, '40_49': 43.5, '50p': 55 } },
    };
    const FUMBLE_PER_TOUCH = 0.006;

    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

    // Pool stat lines with weights into one set of counts.
    function pool(samples) {
        const out = {};
        for (const s of samples || []) {
            if (!s || !s.line) continue;
            const w = s.weight == null ? 1 : s.weight;
            for (const [k, v] of Object.entries(s.line)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = (out[k] || 0) + v * w;
        }
        return out;
    }
    // A rate with shrinkage: (made + K·norm) / (tried + K).
    function rate(made, tried, norm, K) { return (num(made) + K * norm) / (num(tried) + K); }
    // A per-game rate with shrinkage on games.
    function perGame(total, games, norm, K) { return (num(total) + K * norm) / (num(games) + K); }
    // PFF grade → multiplier on yardage rates. 65 is neutral; ±25 grade
    // points move the rate about ±10%.
    function gradeTilt(grade) { const g = Number(grade); return Number.isFinite(g) && g > 0 ? clamp(1 + (g - 65) / 250, 0.85, 1.15) : 1; }

    // input: { position, volume, samples:[{line, weight}], grades:{...}, teamImplied }
    //   volume — WR/TE: targets; RB: touches; QB: pass attempts; IDP: tackles; K: null (uses samples)
    //   grades — PFF: { route, run, pass, elusive, def, prush, cov, tkl, fg }
    function buildLine(input) {
        const P = String(input.position || '').toUpperCase();
        let n = NORM[P];
        if (!n) return null;
        // his rank's norm when the position has one (rank beyond the table takes the last row)
        const rk = Number(input.rank);
        if (n.byRank && Number.isFinite(rk) && rk >= 1) { const keys = Object.keys(n.byRank).map(Number); n = Object.assign({}, n, n.byRank[Math.min(Math.round(rk), Math.max.apply(null, keys))]); }
        const c = pool(input.samples);
        const g = input.grades || {};
        const vol = input.volume != null ? Math.max(0, Number(input.volume)) : null;
        const line = {};
        const why = [];

        if (P === 'WR' || P === 'TE') {
            if (vol == null) return null;
            const catchR = rate(c.rec, c.rec_tgt, n.catch, n.K);
            const ypt = rate(c.rec_yd, c.rec_tgt, n.ypt, n.K) * gradeTilt(g.route || g.off);
            const tdpt = rate(c.rec_td, c.rec_tgt, n.tdpt, n.K * 2);
            line.rec_tgt = vol; line.rec = vol * catchR; line.rec_yd = vol * ypt; line.rec_td = vol * tdpt;
            // a little rushing for gadget receivers
            if (num(c.rush_att) > 0 && num(c.gp) > 0) { const ra = num(c.rush_att) / num(c.gp); line.rush_att = ra; line.rush_yd = ra * rate(c.rush_yd, c.rush_att, 5.0, 10); line.rush_td = ra * rate(c.rush_td, c.rush_att, 0.02, 20); }
            line.fum_lost = (line.rec + num(line.rush_att)) * FUMBLE_PER_TOUCH;
            why.push(vol.toFixed(1) + ' targets · ' + Math.round(catchR * 100) + '% caught · ' + ypt.toFixed(1) + ' yds/target · ' + (tdpt * 100).toFixed(1) + '% TD');
        } else if (P === 'RB') {
            if (vol == null) return null;
            const touches = num(c.rush_att) + num(c.rec_tgt);
            const carryShare = rate(c.rush_att, touches, n.carryShare, 20);
            const carries = vol * carryShare, tg = vol * (1 - carryShare);
            const ypc = rate(c.rush_yd, c.rush_att, n.ypc, n.K) * gradeTilt(g.run || g.off);
            const tdpc = rate(c.rush_td, c.rush_att, n.tdpc, n.K * 2);
            const catchR = rate(c.rec, c.rec_tgt, n.catch, 25);
            const ypt = rate(c.rec_yd, c.rec_tgt, n.ypt, 25) * gradeTilt(g.route || g.off);
            const tdpt = rate(c.rec_td, c.rec_tgt, n.tdpt, 50);
            line.rush_att = carries; line.rush_yd = carries * ypc; line.rush_td = carries * tdpc;
            line.rec_tgt = tg; line.rec = tg * catchR; line.rec_yd = tg * ypt; line.rec_td = tg * tdpt;
            line.fum_lost = vol * FUMBLE_PER_TOUCH;
            why.push(carries.toFixed(1) + ' carries at ' + ypc.toFixed(1) + ' · ' + tg.toFixed(1) + ' targets · ' + ((tdpc * carries + tdpt * tg)).toFixed(2) + ' TD');
        } else if (P === 'QB') {
            if (vol == null) return null;
            const cmp = rate(c.pass_cmp, c.pass_att, n.cmp, n.K);
            const ypa = rate(c.pass_yd, c.pass_att, n.ypa, n.K) * gradeTilt(g.pass || g.off);
            const tdpa = rate(c.pass_td, c.pass_att, n.tdpa, n.K * 2);
            const intpa = rate(c.pass_int, c.pass_att, n.intpa, n.K * 2);
            const rushAtt = perGame(c.rush_att, c.gp, n.rushAttPg, 4);
            const rypc = rate(c.rush_yd, c.rush_att, n.rypc, 30) * gradeTilt(g.run);
            const rtdpc = rate(c.rush_td, c.rush_att, n.rtdpc, 40);
            line.pass_att = vol; line.pass_cmp = vol * cmp; line.pass_yd = vol * ypa; line.pass_td = vol * tdpa; line.pass_int = vol * intpa;
            line.rush_att = rushAtt; line.rush_yd = rushAtt * rypc; line.rush_td = rushAtt * rtdpc;
            line.fum_lost = (vol * 0.004) + rushAtt * FUMBLE_PER_TOUCH;
            why.push(vol.toFixed(1) + ' attempts · ' + ypa.toFixed(1) + ' yds/att · ' + (tdpa * 100).toFixed(1) + '% TD · ' + rushAtt.toFixed(1) + ' rushes');
        } else if (P === 'DL' || P === 'LB' || P === 'DB') {
            if (vol == null) return null;
            const solo = rate(c.idp_tkl_solo, c.idp_tkl, n.soloShare, 20);
            const sacks = perGame(c.idp_sack, c.gp, n.sackPg, n.K) * gradeTilt(g.prush);
            const ints = perGame(c.idp_int, c.gp, n.intPg, n.K * 2);
            const pds = perGame(c.idp_pass_def, c.gp, n.pdPg, n.K) * gradeTilt(g.cov);
            const ffs = perGame(c.idp_ff, c.gp, n.ffPg, n.K * 2);
            const tfl = perGame(c.idp_tkl_loss, c.gp, P === 'DB' ? 0.15 : 0.45, n.K);
            const qbh = perGame(c.idp_qb_hit, c.gp, P === 'DL' ? 0.6 : P === 'LB' ? 0.25 : 0.05, n.K);
            line.idp_tkl = vol; line.idp_tkl_solo = vol * solo; line.idp_tkl_ast = vol * (1 - solo);
            line.idp_sack = sacks; line.idp_int = ints; line.idp_pass_def = pds; line.idp_ff = ffs; line.idp_tkl_loss = tfl; line.idp_qb_hit = qbh;
            line.idp_fum_rec = perGame(c.idp_fum_rec, c.gp, 0.03, n.K * 2);
            why.push(vol.toFixed(1) + ' tackles (' + Math.round(solo * 100) + '% solo) · ' + sacks.toFixed(2) + ' sacks · ' + pds.toFixed(2) + ' PD · ' + ints.toFixed(2) + ' INT');
        } else if (P === 'K') {
            // Field goals by distance (owner ruling 2026-09-21): attempts per
            // game, split across the five ranges by his own attempt mix
            // (eight or more attempts on record, else the league mix), and a
            // make rate for each range from his own makes and misses there,
            // pulled toward the league rate with eight phantom kicks. So a
            // kicker who is automatic inside 40 and shaky from 50 reads that
            // way, and his 50-plus tries are worth what they really are.
            const fga = perGame(c.fga, c.gp, n.fgaPg, n.K);
            const tilt = gradeTilt(g.fg) >= 1 ? 1 + (gradeTilt(g.fg) - 1) * 0.5 : 1 - (1 - gradeTilt(g.fg)) * 0.5;
            const att = {}, ownAtt = {};
            let ownTotal = 0;
            for (const b of n.buckets) { ownAtt[b] = num(c['fgm_' + b]) + num(c['fgmiss_' + b]); ownTotal += ownAtt[b]; }
            for (const b of n.buckets) att[b] = fga * (ownTotal >= 8 ? ownAtt[b] / ownTotal : n.attShare[b]);
            let fgm = 0, fgmiss = 0, yds = 0, over30 = 0;
            const pcts = [];
            for (const b of n.buckets) {
                const pct = clamp(rate(c['fgm_' + b], ownAtt[b], n.makeRate[b], n.Kb) * tilt, 0, 1);
                const made = att[b] * pct, missed = att[b] - made;
                line['fgm_' + b] = made; line['fgmiss_' + b] = missed;
                fgm += made; fgmiss += missed; yds += made * n.ydsPerMake[b]; over30 += made * Math.max(0, n.ydsPerMake[b] - 30);
                if (b !== '0_19') pcts.push(b.replace('_', '-').replace('p', '+') + ' ' + Math.round(pct * 100) + '%');
            }
            line.fga = fga; line.fgm = fgm; line.fgmiss = fgmiss;
            line.fgm_yds = yds; line.fgm_yds_over_30 = over30;
            line.fgm_50_59 = line.fgm_50p * 0.9; line.fgm_60p = line.fgm_50p * 0.1;
            line.fgmiss_50_59 = line.fgmiss_50p * 0.9; line.fgmiss_60p = line.fgmiss_50p * 0.1;
            const xpa = perGame(c.xpa, c.gp, n.xpaPg, n.K);
            const xpPct = rate(c.xpm, c.xpa, n.xpPct, 12);
            line.xpa = xpa; line.xpm = xpa * xpPct; line.xpmiss = xpa * (1 - xpPct);
            why.push(fga.toFixed(1) + ' FG att at ' + Math.round(fga > 0 ? fgm / fga * 100 : 0) + '% (' + pcts.join(', ') + ' · ' + Math.round(fgm > 0 ? yds / fgm : 0) + ' yds a make) · ' + xpa.toFixed(1) + ' XP att');
        }
        for (const k of Object.keys(line)) line[k] = +line[k].toFixed(3);
        return { line, why: why.join(' · ') };
    }

    // Score a line with a league's rules. TE premium (bonus_rec_te) is
    // position-aware, so it is added here; everything else is a straight
    // weighted sum over the scoring keys, like a box score.
    function scoreLine(line, scoring, position) {
        if (!line) return null;
        let t = 0;
        for (const k of Object.keys(scoring || {})) { const v = Number(line[k]); if (Number.isFinite(v) && v) t += v * (Number(scoring[k]) || 0); }
        if (String(position).toUpperCase() === 'TE' && scoring && Number(scoring.bonus_rec_te)) t += Number(scoring.bonus_rec_te) * num(line.rec);
        return +t.toFixed(2);
    }

    App.DhqBaseline = App.DhqBaseline || { NORM, buildLine, scoreLine, pool, rate, perGame, gradeTilt };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.DhqBaseline;
})(typeof window !== 'undefined' ? window : globalThis);
