// ══════════════════════════════════════════════════════════════════
// js/shared/nfl-context.js — window.App.NflContext
// Loads the weekly NFL matchup context (opponent + home/away, Vegas
// implied total/spread, and weather) and feeds it to App.WeeklyProj so
// projections become matchup/weather-aware. Source: ESPN's public
// scoreboard (schedule + odds + weather in one call), fetched THROUGH a
// same-origin proxy (the browser is CORS-blocked from ESPN directly):
//   dev  → /api/nfl-scoreboard  (serve-static.cjs)
//   prod → the nfl-scoreboard Supabase edge fn (endpoint() below).
// Degrades to a no-op (neutral projections) if the proxy is unavailable.
// Live-score API (C2 port, 2026-09-27): parseScores, loadScoreboard,
// loadScores, gameStatus, currentPhase, previousPhase — consumed by the
// league scoreboard (js/components/league-live-scoreboard.js) and The Wire.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const _done = {}; // `${season}|${week}` already loaded
    const _fail = {}; // `${season}|${week}` → { count, until } — failure backoff
    const FAIL_MAX_TRIES = 3;               // attempts per week key per page load
    const FAIL_COOLDOWN_MS = 5 * 60 * 1000; // wait between failed attempts

    // ESPN uses a few abbreviations that differ from Sleeper/MFL — normalize so
    // context keys match each player's team. (LAR/LAC/LV already align.)
    const ESPN_TO_SLEEPER = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
    function normTeam(a) { a = String(a || '').toUpperCase(); return ESPN_TO_SLEEPER[a] || a; }

    function endpoint() {
        // Explicit config wins; localhost keeps the dev proxy (serve-static.cjs);
        // every deployed page goes to the Supabase relay — GitHub Pages serves
        // no /api, which is why this fetch 404-ed in production for months.
        try {
            var cfg = root.DYNASTY_HQ_CONFIG || (root.App && root.App.CONFIG) || (root.OD && root.OD.CONFIG) || {};
            if (cfg.endpoints && cfg.endpoints.nflScoreboard) return cfg.endpoints.nflScoreboard;
            var host = (root.location && root.location.hostname) || '';
            if (host === 'localhost' || host === '127.0.0.1') return '/api/nfl-scoreboard';
            var base = cfg.functionsBase || 'https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1';
            return String(base).replace(/\/+$/, '') + '/nfl-scoreboard';
        } catch (e) { return '/api/nfl-scoreboard'; }
    }

    // ESPN scoreboard → { `${TEAM}|${week}`: { opp, home, vegas:{impliedTotal,spread,opp}, weather } }
    function parse(espn, week) {
        const out = {};
        const events = (espn && espn.events) || [];
        events.forEach(ev => {
            const comp = ev.competitions && ev.competitions[0];
            if (!comp) return;
            const cs = comp.competitors || [];
            const home = cs.find(c => c.homeAway === 'home');
            const away = cs.find(c => c.homeAway === 'away');
            const hAbbr = normTeam(home && home.team && home.team.abbreviation);
            const aAbbr = normTeam(away && away.team && away.team.abbreviation);
            if (!hAbbr || !aAbbr) return;

            const indoor = !!(comp.venue && comp.venue.indoor);
            const w = comp.weather;
            const weather = indoor ? { indoor: true }
                : (w ? { temp: (w.temperature != null ? Number(w.temperature) : (w.highTemperature != null ? Number(w.highTemperature) : null)), display: w.displayValue || '', condId: w.conditionId } : null);

            // Odds → game total + favorite/line (parse details, which names the favorite).
            const odds = comp.odds && comp.odds[0];
            let total = null, favAbbr = null, line = null;
            if (odds) {
                if (odds.overUnder != null) total = Number(odds.overUnder);
                const det = odds.details ? String(odds.details) : '';
                if (/\beven\b|\bpk\b|pick/i.test(det)) line = 0;
                const m = det.match(/([A-Z]{2,4})\s*(-?\d+(?:\.\d+)?)/);
                if (m) { favAbbr = normTeam(m[1]); line = Math.abs(Number(m[2])); }   // "WSH -3" names Washington as WAS here
                if (line == null && odds.spread != null) { line = Math.abs(Number(odds.spread)); favAbbr = Number(odds.spread) < 0 ? hAbbr : aAbbr; }
            }

            function teamCtx(meAbbr, oppAbbr, isHome) {
                let impliedTotal = null, spread = null;
                if (total != null && line != null && favAbbr) {
                    const fav = meAbbr === favAbbr;
                    impliedTotal = total / 2 + (fav ? line / 2 : -line / 2);
                    spread = fav ? -line : line;
                } else if (total != null) {
                    impliedTotal = total / 2;
                }
                const vegas = impliedTotal != null
                    ? { impliedTotal: Math.round(impliedTotal * 10) / 10, spread: spread, opp: oppAbbr }
                    : (oppAbbr ? { opp: oppAbbr } : null);
                return { opp: oppAbbr, home: isHome, vegas: vegas, weather: weather, kickoff: (comp && comp.date) || ev.date || null };
            }
            out[hAbbr + '|' + week] = teamCtx(hAbbr, aAbbr, true);
            out[aAbbr + '|' + week] = teamCtx(aAbbr, hAbbr, false);
        });
        return out;
    }

    // seasontype is ESPN's: 1 = preseason, 2 = regular, 3 = postseason. It
    // defaults to 2 so every existing caller (load/loadCurrent → projection
    // context) sends the byte-identical URL and fetch call it always did;
    // only the live-score callers below pass it (and an abort signal). The
    // relay (nfl-scoreboard edge fn / serve-static dev proxy) already
    // validates and forwards seasontype 1-4.
    function fetchWeek(week, season, seasontype, signal) {
        const st = Number(seasontype) || 2;
        let u = endpoint() + '?week=' + week + '&seasontype=' + st;
        if (season) u += '&season=' + season;
        const req = signal ? fetch(u, { signal }) : fetch(u);
        return req.then(r => { if (!r.ok) throw new Error('scoreboard ' + r.status); return r.json(); });
    }

    // ── Live NFL game state (port of C2's scoreboard additions) ──────────
    // ESPN scoreboard → [{ id, home, away, homeScore, awayScore, kickoff,
    // state 'pre'|'in'|'post', shortDetail, completed, statusName, ... }]
    // for anything that wants "what's the score / has it kicked off" rather
    // than the matchup-context shape parse() builds for projections.
    // NOTE (prod): the nfl-scoreboard relay caches each week for up to 3h,
    // so state/score can lag on deployed pages; kickoff times never do.
    // Callers that need "has this game started" should use gameStatus(),
    // which also treats a passed kickoff as 'locked'.
    const numericScore = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    function scorePeriods(team) {
        return ((team && team.linescores) || []).map((line, i) => ({ period: Number(line.period) || i + 1, value: numericScore(line.value) }));
    }
    function parseScores(espn) {
        const events = (espn && espn.events) || [];
        return events.map(ev => {
            const comp = ev.competitions && ev.competitions[0];
            const cs = (comp && comp.competitors) || [];
            const home = cs.find(c => c.homeAway === 'home');
            const away = cs.find(c => c.homeAway === 'away');
            const status = (comp && comp.status) || ev.status || {};
            const type = status.type || {};
            const teams = new Map(cs.map(c => [String(c.id || (c.team && c.team.id)), normTeam(c.team && c.team.abbreviation)]));
            const leaders = ((comp && comp.leaders) || []).filter(c => ['passingYards', 'rushingYards', 'receivingYards'].includes(c.name))
                .flatMap(c => (c.leaders || []).map(l => ({
                    category: c.name === 'passingYards' ? 'Passing' : c.name === 'rushingYards' ? 'Rushing' : 'Receiving',
                    name: l.athlete && (l.athlete.displayName || l.athlete.fullName),
                    team: teams.get(String((l.team && l.team.id) || (l.athlete && l.athlete.team && l.athlete.team.id))) || '',
                    stats: l.displayValue || '',
                })))
                .filter(l => l.name && l.stats);
            const eventId = String(ev.id || (comp && comp.id) || '');
            return {
                id: eventId,
                homeName: (home && home.team && (home.team.displayName || home.team.abbreviation)) || '',
                awayName: (away && away.team && (away.team.displayName || away.team.abbreviation)) || '',
                homePeriods: scorePeriods(home), awayPeriods: scorePeriods(away), leaders,
                broadcasts: [...new Set(((comp && comp.broadcasts) || []).flatMap(b => b.names || []))],
                boxScoreUrl: /^\d+$/.test(eventId) ? 'https://www.espn.com/nfl/boxscore/_/gameId/' + eventId : null,
                home: normTeam(home && home.team && home.team.abbreviation),
                away: normTeam(away && away.team && away.team.abbreviation),
                homeScore: numericScore(home && home.score),
                awayScore: numericScore(away && away.score),
                kickoff: (comp && comp.date) || ev.date || null,
                statusName: type.name || '',
                state: type.state || 'pre',            // 'pre' | 'in' | 'post'
                shortDetail: type.shortDetail || '',    // "Q3 4:12", "Final", "1:00 PM"
                completed: !!type.completed,
            };
        }).filter(g => g.home && g.away);
    }

    // 'final' | 'live' | 'locked' (kickoff passed, not reported in progress) |
    // 'upcoming' | 'unknown'. Unknown/postponed schedules never authorize a
    // lineup change.
    function gameStatus(game, now) {
        if (!game) return 'unknown';
        if (/POSTPONED|CANCEL|SUSPEND|DELAY/i.test(game.statusName || '')) return 'unknown';
        if (game.completed) return 'final';
        if (game.state === 'post') return 'unknown';
        if (game.state === 'in') return 'live';
        const kickoff = Date.parse(game.kickoff || '');
        if (!Number.isFinite(kickoff)) return 'unknown';
        if (kickoff <= (now == null ? Date.now() : now)) return 'locked';
        return game.state === 'pre' ? 'upcoming' : 'unknown';
    }

    // One in-flight/cached request per (season, seasontype, week) for 60s,
    // shared by every caller. Rejects on failure (never caches a failure).
    const scoreCache = new Map();
    function loadScoreboard(week, season, seasontype) {
        const key = (season || '') + '|' + (Number(seasontype) || 2) + '|' + week;
        const cached = scoreCache.get(key);
        if (cached && Date.now() - cached.at < 60000) return cached.promise;
        const Ctl = root.AbortController;
        const controller = Ctl ? new Ctl() : null;
        const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
        const promise = fetchWeek(week, season, seasontype, controller ? controller.signal : undefined).then(data => {
            if (!data || !Array.isArray(data.events)) throw new Error('Invalid NFL scoreboard');
            return parseScores(data);
        }).catch(error => { scoreCache.delete(key); throw error; })
            .finally(() => { if (timeout !== null) clearTimeout(timeout); });
        scoreCache.set(key, { at: Date.now(), promise });
        // Only a few recent weeks need to remain in memory.
        if (scoreCache.size > 8) scoreCache.delete(scoreCache.keys().next().value);
        return promise;
    }
    // Never rejects: [] on failure. Logged once per week key per page load —
    // pollers retry every minute or so and must not spam the error log.
    const _scoreLogged = new Set();
    function loadScores(week, season, seasontype) {
        return loadScoreboard(week, season, seasontype).catch(e => {
            const key = (season || '') + '|' + (Number(seasontype) || 2) + '|' + week;
            if (!_scoreLogged.has(key)) { _scoreLogged.add(key); if (root.wrLog) root.wrLog('nflContext.loadScores', e); }
            return [];
        });
    }

    // Sleeper's nflState is the authoritative "where are we in the NFL
    // calendar" source (season_type: 'pre' | 'regular' | 'post' + its own week
    // counter, which restarts per phase). Mapped to ESPN's seasontype so the
    // scoreboard is asked for the games actually being played right now — in
    // August that is preseason, not regular-season week 1.
    function currentPhase() {
        const st = (root.S && root.S.nflState) || {};
        const type = String(st.season_type || 'regular').toLowerCase();
        const stWeek = Number(st.week) || Number(st.display_week) || 1;
        if (type === 'pre') return { seasontype: 1, week: stWeek, isPre: true, season: st.season };
        if (type === 'post') return { seasontype: 3, week: stWeek, isPost: true, season: st.season };
        const regWeek = Number(App.WeeklyProj && App.WeeklyProj.currentWeek && App.WeeklyProj.currentWeek()) || stWeek;
        return { seasontype: 2, week: regWeek, season: st.season };
    }

    function previousPhase(phase) {
        if (!phase) return null;
        if (Number(phase.week) > 1) return Object.assign({}, phase, { week: Number(phase.week) - 1 });
        if (Number(phase.seasontype) === 3) return { season: phase.season, seasontype: 2, week: 18 };
        // Opening week has no earlier games in this phase. Do not silently
        // label preseason or last year's games as last week's regular season.
        return null;
    }

    // Load one or more weeks and feed App.WeeklyProj.setContext. Caches per
    // (season, week). Returns the merged byTeamWeek map (or {} on failure).
    async function load(weeks, season) {
        const WP = App.WeeklyProj;
        if (!WP) return {};
        season = Number(season || (root.S && root.S.season) || (root.S && root.S.nflState && root.S.nflState.season) || 0) || 0;
        const list = (Array.isArray(weeks) ? weeks : [weeks]).map(Number).filter(w => w > 0 && w <= 18);
        const byTeamWeek = {};
        for (const wk of list) {
            const key = season + '|' + wk;
            if (_done[key]) continue;
            const f = _fail[key];
            if (f && (f.count >= FAIL_MAX_TRIES || Date.now() < f.until)) continue;
            try {
                const espn = await fetchWeek(wk, season);
                Object.assign(byTeamWeek, parse(espn, wk));
                _done[key] = true;
                delete _fail[key];
            } catch (e) {
                // Back off instead of retrying forever: a hot caller (e.g. a
                // re-rendering scouting tab) must not turn one dead endpoint
                // into hundreds of fetches — one logged error per week key.
                const g = _fail[key] = _fail[key] || { count: 0, until: 0 };
                g.count += 1;
                g.until = Date.now() + FAIL_COOLDOWN_MS;
                if (g.count === 1 && root.wrLog) root.wrLog('nflContext.load', e);
            }
        }
        if (Object.keys(byTeamWeek).length && WP.setContext) WP.setContext({ byTeamWeek });
        return byTeamWeek;
    }

    function loadCurrent(season) {
        const WP = App.WeeklyProj;
        const wk = WP && WP.currentWeek ? WP.currentWeek() : 1;
        return load([wk], season);
    }

    App.NflContext = App.NflContext || { load, loadCurrent, parse, parseScores, loadScores, loadScoreboard, gameStatus, currentPhase, previousPhase, endpoint, _done };
})(typeof window !== 'undefined' ? window : globalThis);
