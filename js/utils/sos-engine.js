// ══════════════════════════════════════════════════════════════════
// js/utils/sos-engine.js — NFL Strength of Schedule pipeline
//
// Derives the full NFL schedule from Sleeper weekly stats (by matching
// each team's off_yd against the opposing team's opp_off_yd), then
// computes per-team defense rankings by fantasy position using actual
// fantasy points allowed each week.
//
// Data source:
//   GET /stats/nfl/regular/{season}/{week}  — player + team stats
//   18 parallel fetches, sessionStorage-cached per week (24hr TTL)
//
// Rank convention (per position):
//   1  = best defense (fewest fantasy pts allowed = hardest matchup)
//   32 = worst defense (most pts allowed = easiest matchup)
//
// Public API (window.App.SOS):
//   .initialize(season, playersData, onReady)   — async; call once
//   .getPlayerSOS(pid, pos, team, currentWeek)  — sync; { avgRank, label, color }
//   .getTeamSOS(starters, playersData, currentWeek) — sync; { avgRank, label, color }
//   .defenseRankings  — { KC:{vsQB:3,vsRB:25,...}, ... } or null
//   .schedule         — { 1:{BUF:'MIA',MIA:'BUF',...}, 2:{...}, ... } or null
//   .ready            — boolean; true once first initialize() resolves
// ══════════════════════════════════════════════════════════════════

(function () {
    const SLEEPER_BASE  = 'https://api.sleeper.app/v1';
    const NFL_WEEKS     = 18;
    const CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours

    // Fantasy positions we compute SOS for (K excluded — rarely dynasty-relevant)
    const SOS_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

    // ── Lightweight position normalizer (mirrors window.App.normPos) ──────────
    function normPos(pos) {
        if (!pos) return null;
        if (pos === 'DE' || pos === 'DT' || pos === 'NT' || pos === 'IDL' || pos === 'EDGE') return 'DL';
        if (pos === 'CB' || pos === 'S' || pos === 'SS' || pos === 'FS') return 'DB';
        if (pos === 'OLB' || pos === 'ILB' || pos === 'MLB') return 'LB';
        return pos;
    }

    // ── Storage helpers (sessionStorage, TTL-guarded) ─────────────────────────
    function getCached(key) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
            return obj.data;
        } catch { return null; }
    }
    function setCache(key, data) {
        try {
            sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
        } catch { /* storage full — skip */ }
    }

    // ── Fetch a single week's player + team stats ─────────────────────────────
    async function fetchWeeklyStats(season, week) {
        const cacheKey = `wr_sos_wk_${season}_${week}`;
        const cached = getCached(cacheKey);
        if (cached) return cached;
        try {
            const resp = await fetch(`${SLEEPER_BASE}/stats/nfl/regular/${season}/${week}`);
            if (!resp.ok) return {};
            const data = await resp.json();
            setCache(cacheKey, data);
            return data;
        } catch (e) {
            window.wrLog?.('sos.fetchWeek', e);
            return {};
        }
    }

    // ── Derive weekly schedule from team-level stats ──────────────────────────
    // Each team's off_yd equals their opponent's opp_off_yd; match pairs.
    // Teams on bye are absent from the data entirely (not present with 0s).
    // Returns: { BUF: 'MIA', MIA: 'BUF', KC: 'BAL', BAL: 'KC', ... }
    function deriveWeekSchedule(weekData) {
        const teams = Object.entries(weekData)
            .filter(([k]) => k.startsWith('TEAM_'))
            .map(([k, v]) => ({
                abbrev: k.slice(5),            // 'TEAM_BUF' → 'BUF'
                offYd:  v.off_yd     || 0,
                oppYd:  v.opp_off_yd || 0,
            }));

        const schedule = {};
        const matched  = new Set();

        for (let i = 0; i < teams.length; i++) {
            if (matched.has(i)) continue;
            for (let j = i + 1; j < teams.length; j++) {
                if (matched.has(j)) continue;
                const a = teams[i], b = teams[j];
                // Both teams must have played (off_yd > 0) and the cross-match must hold
                if (a.offYd > 0 && a.offYd === b.oppYd && b.offYd === a.oppYd) {
                    schedule[a.abbrev] = b.abbrev;
                    schedule[b.abbrev] = a.abbrev;
                    matched.add(i);
                    matched.add(j);
                    break;
                }
            }
        }
        return schedule;
    }

    // ── Accumulate defense points per position per week ───────────────────────
    // For each player this week: their fantasy pts go into the OPPONENT team's
    // "allowed" bucket for their position.
    function accumulateWeekPoints(defAllowed, weekData, weekSchedule, playersData) {
        Object.entries(weekData).forEach(([pid, stats]) => {
            if (pid.startsWith('TEAM_')) return;
            const pts = stats.pts_half_ppr;
            if (!pts || pts <= 0) return;

            const pd  = playersData[pid];
            if (!pd?.team) return;
            const team = pd.team;                 // e.g. 'BUF'
            const pos  = normPos(pd.position);
            if (!SOS_POSITIONS.includes(pos)) return;

            const opponent = weekSchedule[team];
            if (!opponent) return;                 // player's team on bye or unmatched

            if (!defAllowed[opponent])             defAllowed[opponent] = {};
            if (!defAllowed[opponent][pos])        defAllowed[opponent][pos] = { total: 0, games: 0 };
            defAllowed[opponent][pos].total += pts;
            defAllowed[opponent][pos].games += 1;  // one player-game
        });
    }

    // ── Build final per-position defense rankings ─────────────────────────────
    // Returns: { KC: { vsQB:3, vsRB:25, vsWR:8, vsTE:18, avgQB:17.4, ... }, ... }
    function buildRankings(defAllowed) {
        // Compute average pts allowed per player-game appearance for each team+pos
        const avgAllowed = {};
        Object.entries(defAllowed).forEach(([team, posMap]) => {
            avgAllowed[team] = {};
            SOS_POSITIONS.forEach(pos => {
                const bucket = posMap[pos];
                avgAllowed[team][pos] = bucket && bucket.games > 0
                    ? bucket.total / bucket.games : 0;
            });
        });

        const allTeams = Object.keys(avgAllowed);
        const rankings = {};
        allTeams.forEach(t => { rankings[t] = {}; });

        SOS_POSITIONS.forEach(pos => {
            // Sort ascending: fewest pts allowed = rank 1 (best defense = hardest matchup)
            const sorted = allTeams
                .filter(t => avgAllowed[t][pos] > 0)
                .sort((a, b) => avgAllowed[a][pos] - avgAllowed[b][pos]);

            sorted.forEach((team, idx) => {
                rankings[team][`vs${pos}`]  = idx + 1;
                rankings[team][`avg${pos}`] = +avgAllowed[team][pos].toFixed(1);
            });

            // Teams with no data (no player-game appearances against them) → neutral rank 16
            allTeams.filter(t => !rankings[t][`vs${pos}`]).forEach(t => {
                rankings[t][`vs${pos}`]  = 16;
                rankings[t][`avg${pos}`] = 0;
            });
        });

        return rankings;
    }

    // ── sosLabel — human-readable label + color for a SOS rank ────────────────
    function sosLabel(rank) {
        if (rank >= 25) return { label: 'Easy',      color: 'var(--k-2ecc71, #2ecc71)' };
        if (rank >= 20) return { label: 'Favorable', color: 'var(--k-1abc9c, #1abc9c)' };
        if (rank >= 12) return { label: 'Neutral',   color: 'var(--silver)' };
        if (rank >=  7) return { label: 'Tough',     color: 'var(--k-f0a500, #f0a500)' };
        return              { label: 'Hard',      color: 'var(--k-e74c3c, #e74c3c)' };
    }

    // ── Module state ──────────────────────────────────────────────────────────
    let _defenseRankings = null;
    let _schedule        = null;          // { week: { TEAM: oppTEAM, ... } }
    let _initSeason      = null;
    let _initPromise     = null;

    // ── initialize ────────────────────────────────────────────────────────────
    // Fetches 18 weeks of stats in parallel, derives schedule, computes rankings.
    // Safe to call multiple times; deduplicates via _initPromise.
    // onReady: optional callback fired when data is available (for React re-renders)
    async function initialize(season, playersData, onReady) {
        // If already initialised for this season, just fire callback and return
        if (_defenseRankings && _schedule && _initSeason === season) {
            onReady?.();
            return;
        }
        // Deduplicate concurrent calls
        if (_initPromise) { await _initPromise; onReady?.(); return; }

        _initPromise = _doInitialize(season, playersData).then(() => {
            _initPromise = null;
            onReady?.();
        }).catch(e => {
            _initPromise = null;
            window.wrLog?.('sos.initialize', e);
        });

        await _initPromise;
    }

    async function _doInitialize(season, playersData) {
        const defCacheKey  = `wr_sos_def_${season}`;
        const schCacheKey  = `wr_sos_sch_${season}`;

        const cachedDef = getCached(defCacheKey);
        const cachedSch = getCached(schCacheKey);
        if (cachedDef && cachedSch) {
            _defenseRankings = cachedDef;
            _schedule        = cachedSch;
            _initSeason      = season;
            window.App.SOS.ready = true;
            return;
        }

        // Fetch all weeks in parallel; fall back to season-1 if season has no data
        let allWeekData = await Promise.all(
            Array.from({ length: NFL_WEEKS }, (_, i) => fetchWeeklyStats(season, i + 1))
        );

        // If this season hasn't started yet (all empty), try season - 1
        const hasData = allWeekData.some(wd => Object.keys(wd).length > 10);
        if (!hasData) {
            const prevSeason = String(parseInt(season) - 1);
            allWeekData = await Promise.all(
                Array.from({ length: NFL_WEEKS }, (_, i) => fetchWeeklyStats(prevSeason, i + 1))
            );
        }

        // Build schedule + accumulate defense points
        const fullSchedule = {};
        const defAllowed   = {};

        allWeekData.forEach((weekData, idx) => {
            if (!weekData || Object.keys(weekData).length < 10) return;
            const week         = idx + 1;
            const weekSchedule = deriveWeekSchedule(weekData);
            if (Object.keys(weekSchedule).length === 0) return;

            fullSchedule[week] = weekSchedule;
            accumulateWeekPoints(defAllowed, weekData, weekSchedule, playersData);
        });

        if (Object.keys(defAllowed).length === 0) {
            window.wrLog?.('sos.initialize', 'No defense data accumulated — SOS unavailable');
            return;
        }

        const rankings = buildRankings(defAllowed);

        setCache(defCacheKey, rankings);
        setCache(schCacheKey, fullSchedule);

        _defenseRankings = rankings;
        _schedule        = fullSchedule;
        _initSeason      = season;
        window.App.SOS.ready = true;
    }

    // ── getPlayerSOS ──────────────────────────────────────────────────────────
    // pos: canonical position string (QB, RB, WR, TE)
    // team: NFL team abbreviation (e.g. 'KC')
    // currentWeek: 1-18 for in-season remaining schedule; 0 or falsy = full-season avg
    // Returns: { avgRank, label, color } or null if data unavailable
    function getPlayerSOS(pid, pos, team, currentWeek) {
        if (!_defenseRankings || !_schedule || !team) return null;
        const nPos    = normPos(pos);
        if (!SOS_POSITIONS.includes(nPos)) return null;
        const rankKey = `vs${nPos}`;

        let totalRank = 0, count = 0;

        const weeks = currentWeek
            ? Object.keys(_schedule).filter(w => parseInt(w) > currentWeek)
            : Object.keys(_schedule);

        weeks.forEach(w => {
            const opp = _schedule[w]?.[team];
            if (!opp) return;
            const rank = _defenseRankings[opp]?.[rankKey];
            if (rank) { totalRank += rank; count++; }
        });

        if (count === 0) return null;
        const avgRank = Math.round(totalRank / count);
        return { avgRank, ...sosLabel(avgRank) };
    }

    // ── getTeamSOS ────────────────────────────────────────────────────────────
    // Average SOS across the provided starter PIDs (filters to fantasy positions).
    function getTeamSOS(starters, playersData, currentWeek) {
        if (!_defenseRankings || !starters?.length) return null;
        let total = 0, count = 0;

        starters.forEach(pid => {
            if (!pid || pid === '0') return;
            const pd  = playersData?.[pid];
            if (!pd?.team) return;
            const pos = normPos(pd.position);
            if (!SOS_POSITIONS.includes(pos)) return;
            const sos = getPlayerSOS(pid, pos, pd.team, currentWeek);
            if (sos) { total += sos.avgRank; count++; }
        });

        if (count === 0) return null;
        const avgRank = Math.round(total / count);
        return { avgRank, ...sosLabel(avgRank) };
    }

    // ── Expose on window.App ──────────────────────────────────────────────────
    window.App = window.App || {};
    window.App.SOS = {
        ready: false,
        initialize,
        getPlayerSOS,
        getTeamSOS,
        getWeekStats: fetchWeeklyStats,   // public accessor over the cached weekly stats (reused by the game-log engine)
        get defenseRankings() { return _defenseRankings; },
        get schedule()        { return _schedule; },
    };

})();
