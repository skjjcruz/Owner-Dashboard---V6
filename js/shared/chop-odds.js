// ══════════════════════════════════════════════════════════════════
// js/shared/chop-odds.js — window.App.ChopOdds
// Monte Carlo SURVIVAL simulation for Sleeper CHOPPED leagues.
//
//   simulate({ league, rosters, ledger, week, seedMeans, sims, seed })
//     → { rows: [{ rosterId, name, alive, eliminatedWeek,
//                  chopThisWeekPct, survivePct, winPct,
//                  expWeeksLeft, expChopWeek, curve: [{week, alivePct}] }],
//         me, aliveCount, lastChoppedLeg, weeks, simCount, basis }
//
// The model, stated plainly:
//  · Each LIVING team's weekly score ~ Normal(mean, sd), fitted from its own
//    actual weekly scores (recent weeks weighted heavier), exactly as the
//    playoff simulator does. Teams with no played weeks fall back to a caller-
//    supplied projected mean (seedMeans) — in the preseason that is the ONLY
//    signal there is, and pretending otherwise would make every team identical.
//  · Each simulated week: draw a score for every living team, the LOWEST is
//    chopped. Repeat to lastChoppedLeg (or until one team remains).
//  · Nothing else. No schedule, no matchups — there are none in this format.
//
// Why this and not playoff odds: chopped leagues have no bracket, so the only
// question that matters is "am I still here next week?". Playoff odds would
// invent a 6-team field and seed it off 0-0 records.
//
// expWeeksLeft is the sum of survival probabilities over the remaining weeks —
// the honest horizon for valuing a player in this format (a stash is worthless
// if you are unlikely to be alive to play him).
//
// KNOWN LIMIT — backtested on a real 2025 chopped league (18 teams). Standing
// at week 10 with 9 alive and fitting on weeks 1-9 only:
//   · NEAR TERM is good — two of the three most-endangered teams were chopped
//     in the very next two weeks (weeks 10 and 11).
//   · LONG RANGE is weak — Spearman(expWeeksLeft, actual elimination week)
//     was just 0.22 across the 9 survivors.
// The reason is structural: this simulator freezes each team's scoring
// distribution, but chopped leagues hand a full roster to the waiver pool
// every week, so teams actively rebuild. Treat chopThisWeekPct as the
// trustworthy output and winPct over a 17-week horizon as a soft prior.
// Surfaces should lead with this-week risk, not the title number.
//
// Deterministic RNG (seeded) so identical inputs always report identical odds.
// Pure compute. Warroom-local, Node-testable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const DEFAULT_SIMS = 4000;
    const DEFAULT_SD = 24;          // league-typical weekly spread when unknown
    const RECENT_WEIGHT = 1.5;      // last-4 weeks count heavier in the fit
    const MIN_SD = 8;               // never simulate a team as a metronome

    // ── Deterministic RNG (mulberry32 + Box-Muller) ──────────────────
    function rng(seed) {
        let a = (seed >>> 0) || 1;
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    function gauss(rand) {
        let u = 0, v = 0;
        while (u === 0) u = rand();
        while (v === 0) v = rand();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    function rosterName(roster, league) {
        if (!roster) return '—';
        const users = (league && league.users) || [];
        const u = users.find(x => String(x.user_id) === String(roster.owner_id));
        return (roster.metadata && roster.metadata.team_name)
            || (u && u.metadata && u.metadata.team_name)
            || (u && u.display_name)
            || ('Team ' + roster.roster_id);
    }

    // Fit {mean, sd} per roster from played weeks; fall back to a projected
    // mean when the team has no games yet (preseason).
    function fitDists(ledgerRows, seedMeans, allMeanHint) {
        const dists = {};
        const all = [];
        (ledgerRows || []).forEach(t => (t.weekly || []).forEach(g => all.push(g.pts)));
        const leagueMean = all.length
            ? all.reduce((a, b) => a + b, 0) / all.length
            : null;
        (ledgerRows || []).forEach(t => {
            const id = String(t.rosterId);
            const pts = (t.weekly || []).map(g => g.pts);
            if (!pts.length) {
                const seeded = seedMeans && seedMeans[id];
                dists[id] = {
                    mean: Number(seeded) || leagueMean || Number(allMeanHint) || 100,
                    sd: DEFAULT_SD,
                    basis: seeded != null ? 'projected' : 'league-average',
                };
                return;
            }
            const recent = new Set((t.weekly || []).slice(-4).map(g => g.week));
            let wSum = 0, mSum = 0;
            (t.weekly || []).forEach(g => {
                const w = recent.has(g.week) ? RECENT_WEIGHT : 1;
                wSum += w; mSum += g.pts * w;
            });
            const mean = mSum / wSum;
            const varc = pts.reduce((s, p) => s + (p - mean) * (p - mean), 0) / Math.max(1, pts.length - 1);
            dists[id] = { mean, sd: Math.max(MIN_SD, Math.sqrt(varc) || DEFAULT_SD), basis: 'played' };
        });
        return dists;
    }

    function simulate(opts) {
        opts = opts || {};
        const league = opts.league || {};
        const rosters = opts.rosters || league.rosters || [];
        const Chopped = App.Chopped;
        if (!Chopped || !Chopped.isChopped(league)) return null;
        if (!rosters.length) return null;

        const week = Number(opts.week) || 1;
        const lastLeg = Chopped.lastChoppedLeg(league) || 17;
        // Weeks still to be played, inclusive of the current one.
        const weeks = [];
        for (let w = week; w <= lastLeg; w++) weeks.push(w);

        const living = rosters.filter(r => !Chopped.isEliminated(r));
        const ledgerRows = (opts.ledger && opts.ledger.rows) || [];
        const byId = {};
        ledgerRows.forEach(r => { byId[String(r.rosterId)] = r; });
        // Every living roster needs a row, even with zero played weeks.
        const rows = living.map(r => byId[String(r.roster_id)] || { rosterId: r.roster_id, weekly: [] });
        const dists = fitDists(rows, opts.seedMeans);

        const ids = living.map(r => String(r.roster_id));
        const n = ids.length;
        const sims = Math.max(1, Number(opts.sims) || DEFAULT_SIMS);
        const rand = rng(Number(opts.seed) || 20260805);

        // Tallies
        const chopThisWeek = {}, wins = {}, aliveAt = {}, sumWeeksLeft = {}, sumChopWeek = {}, chopped = {};
        ids.forEach(id => {
            chopThisWeek[id] = 0; wins[id] = 0; sumWeeksLeft[id] = 0; sumChopWeek[id] = 0; chopped[id] = 0;
            aliveAt[id] = weeks.map(() => 0);
        });

        // Already down to one? Nothing left to simulate.
        if (n <= 1) {
            const only = ids[0];
            if (only) { wins[only] = sims; aliveAt[only] = weeks.map(() => sims); sumWeeksLeft[only] = sims * weeks.length; }
        } else {
            for (let s = 0; s < sims; s++) {
                const alive = new Set(ids);
                for (let wi = 0; wi < weeks.length; wi++) {
                    // Credit survival BEFORE this week's chop resolves.
                    alive.forEach(id => { aliveAt[id][wi]++; sumWeeksLeft[id]++; });
                    if (alive.size <= 1) {
                        // Winner already decided: they play out the calendar,
                        // so credit the REMAINING weeks too rather than
                        // truncating their horizon at the clinching week.
                        for (let rest = wi + 1; rest < weeks.length; rest++) {
                            alive.forEach(id => { aliveAt[id][rest]++; sumWeeksLeft[id]++; });
                        }
                        break;
                    }
                    let lowId = null, lowPts = Infinity;
                    alive.forEach(id => {
                        const d = dists[id] || { mean: 100, sd: DEFAULT_SD };
                        const pts = d.mean + gauss(rand) * d.sd;
                        if (pts < lowPts) { lowPts = pts; lowId = id; }
                    });
                    if (lowId != null) {
                        alive.delete(lowId);
                        chopped[lowId]++;
                        sumChopWeek[lowId] += weeks[wi];
                        if (wi === 0) chopThisWeek[lowId]++;
                    }
                }
                if (alive.size === 1) alive.forEach(id => { wins[id]++; });
            }
        }

        const pct = v => Math.round((v / sims) * 1000) / 10;
        const out = rosters.map(r => {
            const id = String(r.roster_id);
            const isAlive = !Chopped.isEliminated(r);
            if (!isAlive) {
                return {
                    rosterId: r.roster_id, name: rosterName(r, league), alive: false,
                    eliminatedWeek: Chopped.eliminatedWeek(r),
                    chopThisWeekPct: 0, survivePct: 0, winPct: 0,
                    expWeeksLeft: 0, expChopWeek: null, curve: [], basis: 'chopped',
                };
            }
            const survived = sims - chopped[id];
            return {
                rosterId: r.roster_id,
                name: rosterName(r, league),
                alive: true,
                eliminatedWeek: null,
                chopThisWeekPct: pct(chopThisWeek[id]),
                // P(never chopped through the last chopped leg)
                survivePct: pct(survived),
                winPct: pct(wins[id]),
                expWeeksLeft: Math.round((sumWeeksLeft[id] / sims) * 10) / 10,
                expChopWeek: chopped[id] ? Math.round((sumChopWeek[id] / chopped[id]) * 10) / 10 : null,
                curve: weeks.map((w, wi) => ({ week: w, alivePct: pct(aliveAt[id][wi]) })),
                basis: (dists[id] && dists[id].basis) || 'league-average',
            };
        }).sort((a, b) => {
            if (a.alive !== b.alive) return a.alive ? -1 : 1;
            if (!a.alive) return (b.eliminatedWeek || 0) - (a.eliminatedWeek || 0);
            return b.chopThisWeekPct - a.chopThisWeekPct;   // most endangered first
        });

        const myId = opts.myRosterId != null ? String(opts.myRosterId) : null;
        const result = {
            rows: out,
            me: myId ? out.find(r => String(r.rosterId) === myId) || null : null,
            aliveCount: n,
            lastChoppedLeg: lastLeg,
            weeks,
            simCount: sims,
            // 'played' once anybody has real scores; 'projected' preseason.
            basis: rows.some(r => (r.weekly || []).length) ? 'played' : 'projected',
        };
        // Cache per league so the value model and the FAAB engine can read the
        // horizon synchronously (they can't await a simulation mid-render).
        // Only cache a run that knows whose team is whose.
        if (myId) cacheSim(league.league_id || league.id, result);
        return result;
    }

    // The honest ROS horizon in this format: how many more weeks you can
    // expect to actually play. Falls back to the calendar when odds are absent.
    function survivalHorizon(sim, fallbackWeeks) {
        if (sim && sim.me && sim.me.alive && sim.me.expWeeksLeft > 0) return sim.me.expWeeksLeft;
        return Number(fallbackWeeks) || 0;
    }

    // Last simulation per league, so synchronous consumers (the value model,
    // the FAAB engine) can read the horizon without re-simulating or being
    // made async. Written by simulate(); nothing else mutates it.
    const _last = {};
    function cached(leagueId) { return _last[String(leagueId || '')] || null; }
    function cacheSim(leagueId, sim) { if (leagueId) _last[String(leagueId)] = sim; }
    // Horizon for a league straight from the cache — the one call a sync
    // consumer needs. Returns null when nothing has been simulated yet, so
    // callers can keep their calendar default rather than guessing.
    function horizonFor(leagueId, fallbackWeeks) {
        const sim = cached(leagueId);
        if (!sim) return (fallbackWeeks == null ? null : Number(fallbackWeeks));
        return survivalHorizon(sim, fallbackWeeks);
    }

    const api = { simulate, fitDists, survivalHorizon, cached, horizonFor, DEFAULT_SIMS, DEFAULT_SD };
    App.ChopOdds = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
