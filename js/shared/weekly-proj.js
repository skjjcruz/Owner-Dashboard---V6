// ══════════════════════════════════════════════════════════════════
// js/shared/weekly-proj.js — window.App.WeeklyProj
// Client accessor that turns whatever weekly context we have into
// league-scored start/sit projections via the shared App.StartSit engine.
//
// PROGRESSIVE ENHANCEMENT: works TODAY off local data (season stats +
// recent weekly-points form), with neutral matchup/Vegas. When the
// refresh-projections edge function + player_week_projections table land,
// setContext() feeds real DvP/Vegas/injury and the same code path lights up.
//
// All scoring flows through calcFantasyPts(statLine, scoring) so every
// league's exact rules (PPR / SF / IDP / yardage bonuses) are honored.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const SS = () => App.StartSit;

    // External weekly context, keyed by `${nflTeam}|${week}`: { dvpMult, vegas:{impliedTotal,spread,opp}, injury:{pid:status} }.
    // Empty until the edge function populates it — projections stay neutral.
    // projLines: Sleeper's own published weekly projection stat lines, keyed
    // `${week}|${pid}`. When present, the displayed projection IS Sleeper's
    // number scored through the league's exact rules — the single source of
    // truth the owner sees in the Sleeper app ("one voice, many mediums").
    const _ctx = { byTeamWeek: {}, byPid: {}, projLines: {} };

    function setContext(ctx) {
        if (!ctx) return;
        if (ctx.byTeamWeek) Object.assign(_ctx.byTeamWeek, ctx.byTeamWeek);
        if (ctx.byPid) Object.assign(_ctx.byPid, ctx.byPid);
    }

    // Feed Sleeper's weekly projection lines (pid → statLine) for one week.
    function setProjections(week, byPid) {
        if (!byPid || typeof byPid !== 'object') return;
        const w = Number(week) || 0;
        for (const pid of Object.keys(byPid)) {
            if (byPid[pid]) _ctx.projLines[w + '|' + pid] = byPid[pid];
        }
    }
    function projLine(pid, week) {
        return _ctx.projLines[(Number(week) || 0) + '|' + pid] || null;
    }
    function teamWeekCtx(team, week) {
        return _ctx.byTeamWeek[`${String(team || '').toUpperCase()}|${week}`] || null;
    }

    // Opponent NFL team for a player's team in a given week — prefers the live
    // NFL context (ESPN scoreboard), then falls back to the SOS engine's
    // derived schedule so FUTURE weeks (no live context yet) still resolve an
    // opponent for matchup grading + the season schedule rail.
    function opponentTeam(team, week, ctx) {
        const T = String(team || '').toUpperCase();
        if (ctx && ctx.opp) return String(ctx.opp).toUpperCase();
        const sch = App.SOS && App.SOS.schedule;
        return (sch && sch[week] && sch[week][T]) ? String(sch[week][T]).toUpperCase() : null;
    }

    // Defense-vs-position multiplier from the SOS engine's per-position defense
    // rankings (1 = toughest defense → suppress production; 32 = softest →
    // boost). Neutral (1.0) until App.SOS.initialize() resolves, and for
    // positions SOS doesn't rank (K/DEF/IDP). This is the real DvP layer the
    // engine was built for — no backend projections table required.
    function dvpMultFor(oppTeam, pos) {
        const ranks = App.SOS && App.SOS.defenseRankings;
        if (!ranks || !oppTeam) return 1;
        const P = String(pos || '').toUpperCase();
        if (P !== 'QB' && P !== 'RB' && P !== 'WR' && P !== 'TE') return 1;
        const rank = ranks[oppTeam] && ranks[oppTeam]['vs' + P];
        if (!(rank > 0)) return 1;
        // rank 16.5 → 1.0 · rank 1 (toughest) → ~0.86 · rank 32 (softest) → ~1.14
        const mult = 1 + ((rank - 16.5) / 15.5) * 0.14;
        return Math.max(0.82, Math.min(1.18, mult));
    }

    function currentWeek() {
        const s = root.S || {};
        const w = Number(s.currentWeek || s.nflState?.display_week || s.nflState?.week || 0);
        return w > 0 ? w : 1;
    }

    // Weekly actuals are stored league-scored as weeklyPlayerPoints[week][pid].
    // Returns [{week, pts}] ascending for a player (only weeks with a value).
    function weeklyHistory(pid) {
        const wpp = (root.S && root.S.weeklyPlayerPoints) || {};
        const out = [];
        for (const k of Object.keys(wpp)) {
            const w = Number(k); if (!(w > 0)) continue;
            const pts = wpp[k] && wpp[k][pid];
            if (pts != null) out.push({ week: w, pts: Number(pts) });
        }
        out.sort((a, b) => a.week - b.week);
        return out;
    }

    // Rolling PPG over the last `lastN` PLAYED weeks (>0 pts), plus season
    // high/low. lastN === 'season' (or huge) → full-season average.
    function formStats(pid, lastN) {
        const hist = weeklyHistory(pid);
        if (!hist.length) return null;
        const played = hist.filter(g => g.pts > 0.1);
        const pool = played.length ? played : hist;
        const n = (lastN === 'season' || !lastN) ? pool.length : Math.max(1, Number(lastN));
        const recent = [...pool].sort((a, b) => b.week - a.week).slice(0, n);
        const avg = recent.reduce((s, g) => s + g.pts, 0) / (recent.length || 1);
        return {
            rollingPPG: +avg.toFixed(1),
            high: +Math.max(...pool.map(g => g.pts)).toFixed(1),
            low: +Math.min(...pool.map(g => g.pts)).toFixed(1),
            games: pool.length,
            recentCount: recent.length,
        };
    }

    // Recent-form points average over the last `lookback` completed weeks.
    function recentPPG(pid, week, lookback) {
        const wpp = (root.S && root.S.weeklyPlayerPoints) || null;
        if (!wpp) return null;
        const weeks = Object.keys(wpp).map(Number).filter(w => w > 0 && w < week).sort((a, b) => b - a).slice(0, lookback || 3);
        if (!weeks.length) return null;
        const vals = weeks.map(w => Number(wpp[w] && wpp[w][pid]) || 0).filter(v => v > 0);
        if (!vals.length) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    // Build a per-game baseline STAT LINE for a player: blend current-season
    // and prior-season per-game lines, then nudge by recent-form ratio.
    function buildBaseline(pid, season, prior, scoring, week) {
        const ss = SS();
        const seasonGp = Number(season && season.gp) || 0;
        const seasonLine = ss.perGameLine(season, seasonGp);
        const priorLine = ss.perGameLine(prior, Number(prior && prior.gp) || 0);

        // Lean on prior early in the year; lean on this season as games accrue.
        const seasonW = Math.min(seasonGp, 6) / 6 * 0.75 + (seasonGp > 0 ? 0.05 : 0);
        const priorW = 0.35;
        let line = ss.blendLines([{ line: seasonLine, weight: seasonW }, { line: priorLine, weight: priorW }]);
        if (!line) return null;

        // Recent-form multiplier (hot/cold) from weekly points vs season PPG.
        if (App.calcPPG && season) {
            const seasonPPG = App.calcPPG(season, scoring);
            const recent = recentPPG(pid, week, 3);
            if (seasonPPG > 2 && recent != null) {
                const factor = Math.max(0.7, Math.min(1.4, recent / seasonPPG));
                line = ss.scaleLine(line, factor);
            }
        }
        return line;
    }

    function isByeOrOut(player, ctx, pid, week) {
        const sleeperStatus = (player && player.injury_status) || '';
        const ctxStatus = ctx && ctx.injury && ctx.injury[pid];
        if (Number(player && player.bye_week) === week) return 'BYE';
        return ctxStatus || sleeperStatus || '';
    }

    // Project one player for a given week, scored through `scoring`.
    function projectPlayer(pid, { playersData, statsData, priorData, scoring, week }) {
        const ss = SS();
        if (!ss || !pid) return null;
        const player = (playersData && playersData[pid]) || null;
        const pos = (App.normPos && App.normPos(player && player.position)) || (player && player.position) || '';
        const season = (statsData && statsData[pid]) || null;
        const prior = (priorData && priorData[pid]) || null;
        const baseline = buildBaseline(pid, season, prior, scoring, week);

        const team = player && player.team;
        const ctx = teamWeekCtx(team, week);
        const oppTeam = opponentTeam(team, week, ctx);
        const injuryStatus = isByeOrOut(player, ctx, pid, week);

        // Blend any live-context DvP with the SOS-derived defense-vs-position
        // multiplier (real DvP layer). Neutral 1.0 when SOS isn't ready.
        const ctxDvp = ctx && Number.isFinite(ctx.dvpMult) ? ctx.dvpMult : 1;
        const dvpMult = (ctxDvp !== 1 ? ctxDvp : 1) * dvpMultFor(oppTeam, pos);

        const proj = ss.projectPlayerWeek({
            pid, week, position: pos, baseline,
            dvpMult,
            vegas: ctx ? ctx.vegas : null,
            weather: ctx ? ctx.weather : null,
            opponent: ctx
                ? { abbr: ctx.opp, home: ctx.home, impliedTotal: ctx.vegas && ctx.vegas.impliedTotal, spread: ctx.vegas && ctx.vegas.spread }
                : (oppTeam ? { abbr: oppTeam } : null),
            injuryStatus,
            roleNote: ctx ? ctx.roleNote : '',
        });
        const scored = ss.scoreProjection(proj, scoring);

        // ── One voice: prefer Sleeper's published weekly projection ──
        // The home-grown baseline (season stats + form) is our progressive-
        // enhancement fallback. When Sleeper has actually published a weekly
        // projection for this player, score ITS stat line through the league's
        // exact rules (same calc path as actuals) and make that the number —
        // so the Proj column matches, to the decimal, what the owner sees in
        // Sleeper. We keep the engine's floor/ceiling SHAPE by re-centering the
        // band on Sleeper's median, so start/sit bands stay sensible.
        const sLine = projLine(pid, week);
        if (sLine && scored && scored.points && App.calcRawPts) {
            let sp = App.calcRawPts(sLine, scoring);
            if (sp != null && Number.isFinite(sp)) {
                // TE-premium (bonus_rec_te) is position-aware, so calcRawPts (which
                // is position-blind) can't apply it — mirror scoreProjection here.
                const teBonus = (pos === 'TE' && scoring && Number(scoring.bonus_rec_te)) ? Number(scoring.bonus_rec_te) : 0;
                if (teBonus && Number.isFinite(sLine.rec)) sp += teBonus * sLine.rec;
                sp = Math.max(0, +sp.toFixed(2));
                const pts = scored.points;
                const cur = Number(pts.median) || 0;
                if (cur > 0.5) {
                    const ratio = sp / cur;
                    pts.median = sp;
                    pts.floor = +((Number(pts.floor) || cur * 0.75) * ratio).toFixed(2);
                    pts.ceiling = +((Number(pts.ceiling) || cur * 1.25) * ratio).toFixed(2);
                } else {
                    // Engine had no baseline (rookie / no prior-season line) — build
                    // a default band around Sleeper's median so the value still shows.
                    pts.median = sp;
                    pts.floor = +(sp * 0.75).toFixed(2);
                    pts.ceiling = +(sp * 1.28).toFixed(2);
                }
                scored.projSource = 'sleeper';
                // A published projection means Sleeper expects the player to play.
                // Only a real BYE/OUT status (already on the projection) keeps it
                // unavailable; a null-baseline "unavailable" is now backfilled.
                if (sp > 0 && scored.available === false && !scored.injuryStatus) scored.available = true;
            }
        }
        return scored;
    }

    function projectRoster(playerIds, opts) {
        const out = {};
        (playerIds || []).forEach(pid => { const p = projectPlayer(pid, opts); if (p) out[pid] = p; });
        return out;
    }

    // GM mode → optimization objective. win_now plays it safe (floor),
    // rebuild chases upside (ceiling), everyone else optimizes the median.
    function objectiveForMode(mode) {
        if (mode === 'win_now') return 'floor';
        if (mode === 'rebuild') return 'ceiling';
        return 'median';
    }
    function modeFor(leagueId) {
        try { return (App.WR && App.WR.GmMode && App.WR.GmMode.effects(leagueId).mode) || (root.WR && root.WR.GmMode && root.WR.GmMode.effects(leagueId).mode) || 'compete'; }
        catch (e) { return 'compete'; }
    }

    // Optimal weekly lineup for a roster + the delta vs current starters.
    // roster: { players:[], starters:[], reserve:[], taxi:[] }
    function optimalForRoster(roster, currentLeague, opts) {
        const ss = SS();
        opts = opts || {};
        const scoring = (currentLeague && currentLeague.scoring_settings) || {};
        const rosterPositions = (currentLeague && currentLeague.roster_positions) || [];
        const week = opts.week || currentWeek();
        const leagueId = (currentLeague && (currentLeague.league_id || currentLeague.id)) || '';
        const mode = opts.mode || modeFor(leagueId);
        const objective = opts.objective || objectiveForMode(mode);

        const resSet = new Set((roster && roster.reserve) || []);
        const taxiSet = new Set((roster && roster.taxi) || []);
        const ids = ((roster && roster.players) || []).filter(id => id && !resSet.has(id) && !taxiSet.has(id));

        const projections = projectRoster(ids, { playersData: opts.playersData, statsData: opts.statsData, priorData: opts.priorData, scoring, week });
        const scoreOf = pid => { const p = projections[pid]; return p && p.available ? (p.points[objective] || 0) : 0; };

        const players = ids.map(pid => {
            const p = projections[pid];
            const pl = opts.playersData && opts.playersData[pid];
            return { pid, pos: (App.normPos && App.normPos(pl && pl.position)) || (pl && pl.position) || '', available: !!(p && p.available), pts: scoreOf(pid) };
        });

        const optimal = ss.optimalLineupWeekly(players, rosterPositions);
        const delta = ss.lineupDelta((roster && roster.starters) || [], optimal, scoreOf);
        return { week, mode, objective, scoring, projections, optimal, delta };
    }

    App.WeeklyProj = App.WeeklyProj || {
        setContext, setProjections, projLine, currentWeek, recentPPG, weeklyHistory, formStats, buildBaseline,
        projectPlayer, projectRoster, optimalForRoster,
        objectiveForMode, modeFor,
        _ctx,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.WeeklyProj;
})(typeof window !== 'undefined' ? window : globalThis);
