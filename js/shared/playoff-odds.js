// ══════════════════════════════════════════════════════════════════
// js/shared/playoff-odds.js — window.App.PlayoffOdds
// Monte Carlo season simulation: playoff / bye / title odds for every roster,
// plus this-week leverage for the user's team.
//
//   fetchFuturePairs({ league, fromWeek, toWeek })
//     → Promise<{ [week]: [[rosterIdA, rosterIdB], …] }>   (Sleeper posts the
//       full-season pairings up front, so future weeks resolve pre-game)
//
//   simulate({ league, ledger, futurePairs, myRosterId, sims, seed })
//     → { rows: [{ rosterId, name, playoffPct, byePct, titlePct, avgSeed,
//                  projWins, projLosses }],                 // sorted by playoffPct
//         playoffTeams, byeSlots, usedDivisions,
//         leverage: { week, ifWin, ifLose, current } | null,
//         simCount }
//
// Model, stated honestly: each roster's weekly score ~ Normal(mean, sd) fitted
// from its ACTUAL weekly scores this season (recent games weighted heavier),
// sampled independently per week. Standings tiebreak = record then points-for
// (Sleeper's default). Division winners are seeded first when the league has
// real divisions. The bracket is single-elimination with byes for the top
// seeds. No strength-of-schedule or injury adjustment inside the sim — the
// fitted distributions carry the roster's real scoring profile, nothing more.
// Deterministic RNG (seeded) so the same inputs always report the same odds.
//
//   playoffSos({ starters, playersData, weeks })
//     → { byPos: { QB: { avgRank, tag }, … },
//         weeks: [{ week, byPos: { QB: { team, opp, rank, tag } } }],
//         coverage }   // 0..1 — how many starter-weeks had a resolvable opp
// Opponents come from App.WeeklyProj's context (nfl-context multi-week load)
// with the SOS-derived schedule as fallback; ranks from App.SOS. tag: EASY =
// bottom-third defense vs that position, HARD = top-third.
//
// ledger comes from App.Luck.build — the same weekly-score matrix powers both.
// Pure compute + small fetch helper; Node-testable. Warroom-local.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // ── Deterministic RNG (mulberry32 + Box-Muller) ──────────────────
    function rng(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    function gaussPair(rand) {
        let u = 0, v = 0;
        while (u === 0) u = rand();
        while (v === 0) v = rand();
        const r = Math.sqrt(-2 * Math.log(u));
        return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
    }

    // ── Data ─────────────────────────────────────────────────────────
    async function fetchFuturePairs(opts) {
        const league = (opts && opts.league) || {};
        const lid = league.league_id || league.id;
        const from = Number(opts && opts.fromWeek) || 1;
        const to = Number(opts && opts.toWeek) || from;
        const out = {};
        if (!lid || typeof root.fetchMatchups !== 'function') return out;
        const weeks = [];
        for (let w = from; w <= Math.min(to, 18); w++) weeks.push(w);
        await Promise.all(weeks.map(async w => {
            try {
                const rows = await root.fetchMatchups(lid, w);
                const byM = {};
                (rows || []).forEach(r => {
                    if (r.matchup_id == null) return;
                    (byM[r.matchup_id] = byM[r.matchup_id] || []).push(r.roster_id);
                });
                const pairs = Object.values(byM).filter(p => p.length === 2);
                if (pairs.length) out[w] = pairs;
            } catch (e) { /* skip week */ }
        }));
        return out;
    }

    // Score distribution per roster from its actual weekly points. Recent games
    // (last 4) weigh 1.5×. Early-season guards: blend toward the league mean
    // until ~4 games exist, floor the sd — 2 quiet weeks must not read as a
    // 3-point-sd metronome.
    // NOTE (chopped leagues): a team with zero weekly rows falls back to
    // {mean: leagueMean} below, i.e. an eliminated team keeps "competing" as a
    // league-average club. Chopped leagues suppress playoff odds entirely
    // (features.showPlayoffOdds === false), so this path is unreachable there;
    // survival odds get their own simulator rather than bending this one.
    function fitDists(ledgerRows) {
        const all = [];
        ledgerRows.forEach(t => t.weekly.forEach(g => all.push(g.pts)));
        const leagueMean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 100;
        const dists = {};
        ledgerRows.forEach(t => {
            const pts = t.weekly.map(g => g.pts);
            const n = pts.length;
            if (!n) { dists[String(t.rosterId)] = { mean: leagueMean, sd: 25 }; return; }
            const recent = new Set(t.weekly.slice(-4).map(g => g.week));
            let wSum = 0, mSum = 0;
            t.weekly.forEach(g => { const w = recent.has(g.week) ? 1.5 : 1; wSum += w; mSum += g.pts * w; });
            let mean = mSum / wSum;
            const anchor = Math.min(n, 4) / 4;                 // 0..1 confidence in own data
            mean = mean * anchor + leagueMean * (1 - anchor);
            const varSum = pts.reduce((s, p) => s + (p - mean) * (p - mean), 0);
            const sd = Math.max(12, n >= 3 ? Math.sqrt(varSum / (n - 1)) : 25);
            dists[String(t.rosterId)] = { mean, sd };
        });
        return dists;
    }

    // Bracket helper: seeds (1-indexed array of rosterIds, best first) →
    // championship win probability accumulator via the same score dists.
    function runBracket(seeds, dists, sample, titleWins) {
        let field = seeds.slice();
        // Byes: pad to the next power of two — top seeds sit out round 1.
        const size = Math.pow(2, Math.ceil(Math.log2(Math.max(2, field.length))));
        const byes = size - field.length;
        // Standard bracket order: 1 plays the worst non-bye seed, etc.
        let round = field.slice(byes);                          // non-bye seeds play round 1
        const sitting = field.slice(0, byes);
        while (round.length > 1 || sitting.length) {
            const winners = [];
            // Pair best remaining vs worst remaining.
            const pool = round.slice();
            while (pool.length > 1) {
                const a = pool.shift(), b = pool.pop();
                const pa = sample(dists[String(a)]), pb = sample(dists[String(b)]);
                winners.push(pa >= pb ? a : b);
            }
            if (pool.length) winners.push(pool[0]);
            // Byes re-enter after round 1, then reseed best-vs-worst again.
            round = sitting.concat(winners).sort((x, y) => seeds.indexOf(x) - seeds.indexOf(y));
            sitting.length = 0;
            if (round.length === 1) break;
        }
        if (round.length === 1) titleWins[String(round[0])] = (titleWins[String(round[0])] || 0) + 1;
    }

    // ── Simulation ───────────────────────────────────────────────────
    function simulate(opts) {
        const league = (opts && opts.league) || {};
        const ledger = (opts && opts.ledger) || { rows: [] };
        const futurePairs = (opts && opts.futurePairs) || {};
        const myId = opts && opts.myRosterId != null ? String(opts.myRosterId) : null;
        const sims = Math.max(500, Math.min(20000, Number(opts && opts.sims) || 10000));
        const rand = rng(Number(opts && opts.seed) || 42);

        const rows = ledger.rows || [];
        if (rows.length < 2) return null;
        const st = league.settings || {};
        const playoffTeams = Math.max(2, Math.min(rows.length, Number(st.playoff_teams) || 6));
        // Bye slots = seeds that skip round 1 of a power-of-two bracket.
        const byeSlots = (Math.pow(2, Math.ceil(Math.log2(playoffTeams))) - playoffTeams) || 0;

        // Divisions: only when the league declares them AND rosters carry one.
        const nDiv = Number(st.divisions) || 0;
        const divOf = {};
        let divTagged = 0;
        (league.rosters || []).forEach(r => {
            const d = r.settings && Number(r.settings.division);
            if (d > 0) { divOf[String(r.roster_id)] = d; divTagged++; }
        });
        const usedDivisions = nDiv >= 2 && divTagged >= rows.length;

        const dists = fitDists(rows);
        const futureWeeks = Object.keys(futurePairs).map(Number).sort((a, b) => a - b);
        const curWeek = futureWeeks.length ? futureWeeks[0] : null;

        // Gaussian sampler that recycles Box-Muller pairs.
        let spare = null;
        const gauss = () => {
            if (spare != null) { const s = spare; spare = null; return s; }
            const [g1, g2] = gaussPair(rand);
            spare = g2; return g1;
        };
        const sample = d => Math.max(30, d.mean + d.sd * gauss());

        const acc = {};
        rows.forEach(t => { acc[String(t.rosterId)] = { playoff: 0, bye: 0, title: 0, seedSum: 0, winSum: 0 }; });
        const lev = myId ? { winPlayoff: 0, winN: 0, losePlayoff: 0, loseN: 0 } : null;

        for (let s = 0; s < sims; s++) {
            const wins = {}, pf = {};
            rows.forEach(t => { wins[String(t.rosterId)] = t.wins + t.ties / 2; pf[String(t.rosterId)] = t.pf; });

            let myCurResult = null;
            for (const w of futureWeeks) {
                for (const pair of futurePairs[w]) {
                    const a = String(pair[0]), b = String(pair[1]);
                    if (!dists[a] || !dists[b]) continue;
                    const pa = sample(dists[a]), pb = sample(dists[b]);
                    pf[a] += pa; pf[b] += pb;
                    if (pa >= pb) wins[a] += 1; else wins[b] += 1;
                    if (myId && w === curWeek && (a === myId || b === myId)) {
                        myCurResult = (a === myId ? pa >= pb : pb > pa) ? 'W' : 'L';
                    }
                }
            }

            // Standings: record, then PF (Sleeper default tiebreak).
            const order = rows.map(t => String(t.rosterId))
                .sort((x, y) => wins[y] - wins[x] || pf[y] - pf[x]);

            let seeds;
            if (usedDivisions) {
                const winners = [];
                const byDiv = {};
                order.forEach(id => { const d = divOf[id]; if (!byDiv[d]) { byDiv[d] = true; winners.push(id); } });
                const rest = order.filter(id => !winners.includes(id));
                seeds = winners.concat(rest).slice(0, playoffTeams);
            } else {
                seeds = order.slice(0, playoffTeams);
            }

            seeds.forEach((id, i) => {
                acc[id].playoff += 1;
                acc[id].seedSum += i + 1;
                if (i < byeSlots) acc[id].bye += 1;
            });
            rows.forEach(t => { acc[String(t.rosterId)].winSum += wins[String(t.rosterId)]; });

            const titleWins = {};
            runBracket(seeds, dists, sample, titleWins);
            for (const id of Object.keys(titleWins)) acc[id].title += titleWins[id];

            if (lev && myCurResult) {
                const made = seeds.includes(myId) ? 1 : 0;
                if (myCurResult === 'W') { lev.winN++; lev.winPlayoff += made; }
                else { lev.loseN++; lev.losePlayoff += made; }
            }
        }

        const pct = n => Math.round((n / sims) * 100);
        const out = rows.map(t => {
            const a = acc[String(t.rosterId)];
            const projWins = a.winSum / sims;
            // Games from THIS roster's own counted weeks, not row[0]'s — a
            // roster added mid-season has fewer, and borrowing the first
            // roster's count would hand it phantom losses.
            const totalReg = t.weekly.length + futureWeeks.length;
            return {
                rosterId: t.rosterId,
                name: t.name,
                record: t.wins + '-' + t.losses + (t.ties ? '-' + t.ties : ''),
                playoffPct: pct(a.playoff),
                byePct: byeSlots ? pct(a.bye) : null,
                titlePct: pct(a.title),
                avgSeed: a.playoff ? Math.round((a.seedSum / a.playoff) * 10) / 10 : null,
                projWins: Math.round(projWins * 10) / 10,
                projLosses: Math.round((totalReg - projWins) * 10) / 10,
            };
        }).sort((a, b) => b.playoffPct - a.playoffPct || b.titlePct - a.titlePct);

        let leverage = null;
        if (lev && lev.winN + lev.loseN > sims * 0.5) {
            const me = out.find(r => String(r.rosterId) === myId);
            leverage = {
                week: curWeek,
                ifWin: Math.round((lev.winPlayoff / Math.max(1, lev.winN)) * 100),
                ifLose: Math.round((lev.losePlayoff / Math.max(1, lev.loseN)) * 100),
                current: me ? me.playoffPct : null,
            };
        }

        return { rows: out, playoffTeams, byeSlots, usedDivisions, leverage, simCount: sims };
    }

    // ── Playoff-weeks SOS ────────────────────────────────────────────
    const TAG = rank => rank == null ? null : rank >= 22 ? 'EASY' : rank <= 11 ? 'HARD' : 'NEUT';
    function playoffSos(opts) {
        const starters = (opts && opts.starters) || [];   // [{pid, pos, team}]
        const weeks = (opts && opts.weeks) || [];
        const ranks = App.SOS && App.SOS.defenseRankings;
        const ctx = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek;
        const sched = App.SOS && App.SOS.schedule;
        if (!ranks || !weeks.length) return null;

        const oppOf = (team, week) => {
            const T = String(team || '').toUpperCase();
            const c = ctx && ctx[T + '|' + week];
            if (c && c.opp) return String(c.opp).toUpperCase();
            return (sched && sched[week] && sched[week][T]) ? String(sched[week][T]).toUpperCase() : null;
        };

        const POS = ['QB', 'RB', 'WR', 'TE'];
        const weekRows = [];
        const posAgg = {}; POS.forEach(p => { posAgg[p] = { sum: 0, n: 0 }; });
        let have = 0, want = 0;

        for (const w of weeks) {
            const byPos = {};
            for (const p of POS) {
                const mine = starters.filter(s => s.pos === p && s.team);
                if (!mine.length) continue;
                want++;
                // Aggregate across my starters at this position (they may be on
                // different NFL teams) — average the opponent rank.
                let sum = 0, n = 0, sampleTeam = null, sampleOpp = null;
                for (const s of mine) {
                    const opp = oppOf(s.team, w);
                    const rank = opp && ranks[opp] && ranks[opp]['vs' + p];
                    if (rank > 0) { sum += rank; n++; sampleTeam = s.team; sampleOpp = opp; }
                }
                if (!n) continue;
                have++;
                const avg = sum / n;
                byPos[p] = { team: sampleTeam, opp: sampleOpp, rank: Math.round(avg), tag: TAG(avg) };
                posAgg[p].sum += avg; posAgg[p].n++;
            }
            weekRows.push({ week: w, byPos });
        }

        const byPos = {};
        POS.forEach(p => {
            if (posAgg[p].n) {
                const avg = posAgg[p].sum / posAgg[p].n;
                byPos[p] = { avgRank: Math.round(avg), tag: TAG(avg) };
            }
        });
        return { byPos, weeks: weekRows, coverage: want ? have / want : 0 };
    }

    App.PlayoffOdds = App.PlayoffOdds || { fetchFuturePairs, fitDists, simulate, playoffSos, rng };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.PlayoffOdds;
})(typeof window !== 'undefined' ? window : globalThis);
