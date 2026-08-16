// ══════════════════════════════════════════════════════════════════
// js/shared/luck-engine.js — window.App.Luck
// All-play records, expected wins, and schedule luck for every roster in a
// league, from the weekly matchup scores the platform already exposes.
//
//   fetchWeeklyScores({ league, throughWeek })
//     → Promise<{ [week]: [{ rosterId, points, matchupId }] }>
//     (Sleeper via the cached window.fetchMatchups; a pre-loaded
//      S.weeklyScores map covers anything else. Weeks with no real scores
//      — all zeros — are dropped, so mid-fetch current weeks don't count.)
//
//   buildLedger({ league, weeklyScores })
//     → { rows: [{ rosterId, name, wins, losses, ties, allPlayW, allPlayL,
//                  allPlayPct, expWins, luck, pf, weekly: [{week, pts, result,
//                  allPlayW, allPlayL, median}] }],   // sorted by record
//         weeks: [numbers actually counted] }
//
// All-play: each week, a team "beats" every team it outscored that week.
// Expected wins = all-play win rate × games played — the record a team would
// hold against an average schedule. Luck = actual wins − expected wins.
// Pure compute + a small fetch helper, Node-testable (buildLedger is pure).
// Warroom-local (direct <script> tag), no vendored mirror.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    function rosterName(roster, league) {
        if (!roster) return '—';
        const users = (league && league.users) || [];
        const u = users.find(x => String(x.user_id) === String(roster.owner_id));
        return (roster.metadata && roster.metadata.team_name)
            || roster._team_name
            || (u && u.metadata && u.metadata.team_name)
            || (u && u.display_name)
            || ('Team ' + roster.roster_id);
    }

    // ── Data ─────────────────────────────────────────────────────────
    // Weekly scores for every roster. Sleeper: one cached matchups call per
    // completed week. A week only counts once at least two rosters have real
    // (non-zero) points — an unplayed or in-progress week must not hand
    // everyone an 0-11 all-play line.
    async function fetchWeeklyScores(opts) {
        const league = (opts && opts.league) || {};
        const lid = league.league_id || league.id;
        const cur = (App.WeeklyProj && App.WeeklyProj.currentWeek && App.WeeklyProj.currentWeek()) || 1;
        const through = Math.min(Number((opts && opts.throughWeek) || (cur - 1)), 18);
        const out = {};
        if (!lid || through < 1) return out;

        // Pre-loaded map (MFL/ESPN/Yahoo adapters, tests): { week: [{rosterId, points}] }
        const pre = (root.S && root.S.weeklyScores) || league.weeklyScores;
        if (pre && typeof pre === 'object' && !Array.isArray(pre)) {
            for (const k of Object.keys(pre)) {
                const w = Number(k);
                if (w >= 1 && w <= through && Array.isArray(pre[k])) out[w] = pre[k];
            }
            if (Object.keys(out).length) return out;
        }

        if (typeof root.fetchMatchups !== 'function') return out;
        const weeks = [];
        for (let w = 1; w <= through; w++) weeks.push(w);
        await Promise.all(weeks.map(async w => {
            try {
                const rows = await root.fetchMatchups(lid, w);
                const mapped = (rows || []).map(r => ({
                    rosterId: r.roster_id,
                    points: Number(r.points) || 0,
                    matchupId: r.matchup_id != null ? r.matchup_id : null,
                }));
                if (mapped.filter(r => r.points > 0).length >= 2) out[w] = mapped;
            } catch (e) { /* skip week */ }
        }));
        return out;
    }

    // ── Compute ──────────────────────────────────────────────────────
    function buildLedger(opts) {
        const league = (opts && opts.league) || {};
        const weekly = (opts && opts.weeklyScores) || {};
        const rosters = league.rosters || [];
        const weeks = Object.keys(weekly).map(Number).filter(w => w > 0).sort((a, b) => a - b);

        const byId = {};
        rosters.forEach(r => {
            byId[String(r.roster_id)] = {
                rosterId: r.roster_id,
                name: rosterName(r, league),
                wins: 0, losses: 0, ties: 0,
                allPlayW: 0, allPlayL: 0, allPlayT: 0,
                pf: 0,
                weekly: [],
            };
        });

        for (const w of weeks) {
            const rows = (weekly[w] || []).filter(r => byId[String(r.rosterId)]);
            if (rows.length < 2) continue;
            const pts = rows.map(r => Number(r.points) || 0).sort((a, b) => a - b);
            const median = pts.length % 2
                ? pts[(pts.length - 1) / 2]
                : (pts[pts.length / 2 - 1] + pts[pts.length / 2]) / 2;

            for (const r of rows) {
                const me = byId[String(r.rosterId)];
                const myPts = Number(r.points) || 0;
                let apW = 0, apL = 0, apT = 0;
                for (const o of rows) {
                    if (String(o.rosterId) === String(r.rosterId)) continue;
                    const op = Number(o.points) || 0;
                    if (myPts > op) apW++; else if (myPts < op) apL++; else apT++;
                }
                me.allPlayW += apW; me.allPlayL += apL; me.allPlayT += apT;
                me.pf += myPts;

                // Head-to-head result from the matchup pairing when present.
                let result = null;
                if (r.matchupId != null) {
                    const opp = rows.find(o => String(o.rosterId) !== String(r.rosterId) && String(o.matchupId) === String(r.matchupId));
                    if (opp) {
                        const op = Number(opp.points) || 0;
                        result = myPts > op ? 'W' : myPts < op ? 'L' : 'T';
                        if (result === 'W') me.wins++; else if (result === 'L') me.losses++; else me.ties++;
                    }
                }
                me.weekly.push({ week: w, pts: Math.round(myPts * 10) / 10, result, allPlayW: apW, allPlayL: apL, median: Math.round(median * 10) / 10 });
            }
        }

        const rows = Object.values(byId).map(t => {
            const apGames = t.allPlayW + t.allPlayL + t.allPlayT;
            const gp = t.weekly.length;
            const allPlayPct = apGames ? (t.allPlayW + t.allPlayT / 2) / apGames : 0;
            const expWins = allPlayPct * gp;
            return {
                ...t,
                pf: Math.round(t.pf * 10) / 10,
                allPlayPct: Math.round(allPlayPct * 1000) / 1000,
                expWins: Math.round(expWins * 10) / 10,
                // Ties count half in "actual" so a tie-heavy record isn't read as luck.
                luck: Math.round(((t.wins + t.ties / 2) - expWins) * 10) / 10,
            };
        }).sort((a, b) => (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pf - a.pf);

        return { rows, weeks };
    }

    // Convenience: fetch + build in one call.
    async function build(opts) {
        const weeklyScores = await fetchWeeklyScores(opts);
        return { ...buildLedger({ league: (opts && opts.league) || {}, weeklyScores }), weeklyScores };
    }

    App.Luck = App.Luck || { fetchWeeklyScores, buildLedger, build, rosterName };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Luck;
})(typeof window !== 'undefined' ? window : globalThis);
