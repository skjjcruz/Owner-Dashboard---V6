// ══════════════════════════════════════════════════════════════════
// js/utils/schedule-engine.js — window.App.Schedule
// Full-season schedule + win projection + bye-week watch for Game Day.
//
// buildSeason({ league, myRoster, playersData, statsData, stats2025Data })
//   → Promise<{ weeks: [{week, oppName, oppRosterId, isPast, isCurrent,
//                          winPct, margin, myProj, oppProj, result, bye,
//                          byes:{count, unfilled, thin, pids}}],
//                summary: {record, projRecord, projWins, projLosses,
//                          projPF, winPct, remainingWeeks, week},
//                byeWatch: [{week, count, unfilled, reason, pids, positions}],
//                scheduleUnset: bool }>
//
// Opponents come from App.Matchup.resolveSeasonOpponents (Sleeper + MFL).
// Each upcoming matchup is projected with App.WeeklyProj.optimalForRoster
// (median) + App.Matchup.forecast; completed weeks use actual scores when the
// platform exposes them. Bye watch = which of the user's ideal starters are on
// bye each week (+ whether a full lineup can still be fielded) — works with or
// without a posted schedule, so it powers the pre-season planning view too.
// Warroom-local util (direct <script> tag), no vendored mirror.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const _cache = {};                 // cacheKey -> { ts, data }
    const TTL_MS = 8 * 60 * 1000;

    function currentWeek() {
        return (App.WeeklyProj && App.WeeklyProj.currentWeek && App.WeeklyProj.currentWeek()) || 1;
    }

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

    // NFL byes are team-level, so derive a { TEAM: byeWeek } map from the player
    // DB (Sleeper populates player.bye_week; MFL players inherit it via the
    // Sleeper crosswalk). This also covers uncrosswalked MFL 'mfl_' players — we
    // fall back to their team's bye — with no connector change.
    function buildTeamBye(playersData) {
        const map = {};
        if (!playersData) return map;
        for (const pid in playersData) {
            const p = playersData[pid];
            const bw = p && Number(p.bye_week);
            if (p && p.team && bw > 0) {
                const t = String(p.team).toUpperCase();
                if (!map[t]) map[t] = bw;
            }
        }
        return map;
    }

    async function buildSeason(opts) {
        opts = opts || {};
        const league = opts.league || {};
        const myRoster = opts.myRoster || null;
        const M = App.Matchup, WP = App.WeeklyProj;
        if (!myRoster || !M || !WP || !M.resolveSeasonOpponents) return null;

        const myRosterId = myRoster.roster_id;
        const leagueId = league.league_id || league.id || '';
        const curWk = currentWeek();
        const pws = Number(league.settings && league.settings.playoff_week_start) || 15;
        const lastReg = Math.max(1, Math.min(18, pws - 1));
        const weeks = [];
        for (let w = 1; w <= lastReg; w++) weeks.push(w);

        const startersKey = ((myRoster.starters) || []).join(',');
        const playersData = opts.playersData;
        const rosterKey = ((myRoster.players) || []).length;   // roster size (bye watch keys off the whole roster)
        const cacheKey = [leagueId, myRosterId, curWk, lastReg, startersKey, rosterKey].join('|');
        const hit = _cache[cacheKey];
        if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

        const rostersById = {};
        (league.rosters || []).forEach(r => { rostersById[String(r.roster_id)] = r; });

        const oppMap = await M.resolveSeasonOpponents({ league, myRosterId, weeks });
        const scheduleUnset = Object.keys(oppMap).length === 0;      // no posted matchups (pre-season)
        const projOpts = {
            playersData,
            statsData: opts.statsData,
            priorData: opts.stats2025Data || opts.priorData,
            objective: 'median',
        };

        // Bye resolution + the user's "ideal starters" reference. Week 1 rarely
        // has NFL byes, so the week-1 optimal is a clean bye-agnostic core lineup.
        const teamBye = buildTeamBye(playersData);
        const resolveBye = (pid) => {
            const p = playersData && playersData[pid];
            if (!p) return 0;
            return Number(p.bye_week) || teamBye[String(p.team || '').toUpperCase()] || 0;
        };
        let coreStarterPids = [];
        try {
            const core = WP.optimalForRoster(myRoster, league, { ...projOpts, week: 1 });
            coreStarterPids = ((core.optimal && core.optimal.starters) || []).map(s => String(s.pid));
        } catch (e) { if (root.wrLog) root.wrLog('schedule.core', e); }

        let futureWins = 0, futureLosses = 0, futurePF = 0, winPctSum = 0, winPctCount = 0;

        const rows = weeks.map(w => {
            const entry = oppMap[w];
            const noOpp = !entry;                                 // no matchup scheduled this week
            const oppRoster = entry ? rostersById[String(entry.oppRosterId)] : null;
            const isPast = w < curWk;
            const isCurrent = w === curWk;
            let winPct = null, margin = null, myProj = null, oppProj = null, result = null, mine = null;

            // My per-week optimal (current + future) powers BOTH the forecast and
            // the bye check (unfilled starting slots). Past weeks don't need it.
            if (!isPast) {
                try { mine = WP.optimalForRoster(myRoster, league, { ...projOpts, week: w }); }
                catch (e) { if (root.wrLog) root.wrLog('schedule.mine', e); }
            }

            if (entry && oppRoster) {
                // Only completed weeks count as final — live points mid-week
                // stay on the forecast path instead of stamping a W/L.
                const hasActual = isPast && (entry.myPts > 0 || entry.oppPts > 0);
                if (hasActual) {
                    result = entry.myPts > entry.oppPts ? 'W' : entry.myPts < entry.oppPts ? 'L' : 'T';
                    myProj = Math.round(entry.myPts * 10) / 10;
                    oppProj = Math.round(entry.oppPts * 10) / 10;
                } else if (mine) {
                    try {
                        const theirs = WP.optimalForRoster(oppRoster, league, { ...projOpts, week: w });
                        const myDist = M.dist(mine.optimal.starters.map(s => s.pid), mine.projections, 'median');
                        const oppDist = M.dist(theirs.optimal.starters.map(s => s.pid), theirs.projections, 'median');
                        const fc = M.forecast(myDist, oppDist);
                        // winPct null = a side had no projectable players — no
                        // forecast for this week (don't paint a 99% "win").
                        if (fc.winPct != null) {
                            winPct = fc.winPct; margin = fc.margin; myProj = fc.projMe; oppProj = fc.projOpp;
                            if (!isPast) {
                                futureWins += fc.winPct / 100;
                                futureLosses += (100 - fc.winPct) / 100;
                                futurePF += fc.projMe;
                                winPctSum += fc.winPct; winPctCount++;
                            }
                        }
                    } catch (e) { if (root.wrLog) root.wrLog('schedule.projectWeek', e); }
                }
            }

            // Bye watch: how many of my ideal starters are on bye this week, and
            // can I still fill every starting slot (unfilled = a real hole)?
            let byeCount = 0, unfilled = 0, byePids = [];
            if (!isPast) {
                byePids = coreStarterPids.filter(pid => resolveBye(pid) === w);
                byeCount = byePids.length;
                if (mine && mine.optimal && mine.optimal.slots) unfilled = mine.optimal.slots.filter(s => !s.pid).length;
            }
            const thin = unfilled > 0 || byeCount >= 2;

            return {
                week: w, bye: noOpp,
                oppRosterId: entry && entry.oppRosterId,
                oppName: oppRoster ? rosterName(oppRoster, league) : (noOpp ? 'BYE' : '—'),
                isPast, isCurrent, winPct, margin, myProj, oppProj, result,
                byes: { count: byeCount, unfilled, thin, pids: byePids },
            };
        });

        // Bye watch summary: the worst upcoming weeks (holes first, then most byes).
        const byeWatch = rows
            .filter(r => !r.isPast && (r.byes.count > 0 || r.byes.unfilled > 0))
            .sort((a, b) => (b.byes.unfilled - a.byes.unfilled) || (b.byes.count - a.byes.count) || (a.week - b.week))
            .slice(0, 3)
            .map(r => ({
                week: r.week, count: r.byes.count, unfilled: r.byes.unfilled, pids: r.byes.pids,
                // 'bye' = bye starters drive the flag; 'gap' = slots are empty
                // for non-bye reasons (position unrostered, players OUT).
                reason: r.byes.count > 0 ? 'bye' : 'gap',
                positions: r.byes.pids.map(pid => {
                    const p = playersData && playersData[pid];
                    return (App.normPos && App.normPos(p && p.position)) || (p && p.position) || '?';
                }),
            }));

        const st = (myRoster.settings) || {};
        const wins = Number(st.wins) || 0, losses = Number(st.losses) || 0, ties = Number(st.ties) || 0;
        const pf = Number(st.fpts) || 0;
        const projWins = wins + futureWins;
        const projLosses = losses + futureLosses;
        const r1 = n => Math.round(n * 10) / 10;

        const summary = {
            week: curWk,
            record: wins + '-' + losses + (ties ? '-' + ties : ''),
            projWins: r1(projWins),
            projLosses: r1(projLosses),
            projRecord: r1(projWins) + '-' + r1(projLosses) + (ties ? '-' + ties : ''),
            projPF: r1(pf + futurePF),
            // Forward-looking only: average of remaining-week forecasts. No
            // record-percentage fallback — a season record is not a "WIN%".
            winPct: winPctCount ? Math.round(winPctSum / winPctCount) : null,
            remainingWeeks: winPctCount,
        };

        const data = { weeks: rows, summary, byeWatch, scheduleUnset };
        // Only cache once the roster/stat data is actually loaded — a bye watch
        // (or any projected/actual result) means the core lineup resolved.
        const hasSignal = byeWatch.length > 0 || coreStarterPids.length > 0
            || rows.some(r => (r.myProj || 0) > 0 || (r.oppProj || 0) > 0 || r.result);
        if (hasSignal) _cache[cacheKey] = { ts: Date.now(), data };
        return data;
    }

    App.Schedule = App.Schedule || { buildSeason, buildTeamBye, _cache };
})(typeof window !== 'undefined' ? window : globalThis);
