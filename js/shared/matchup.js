// ══════════════════════════════════════════════════════════════════
// js/shared/matchup.js — window.App.Matchup
// Weekly head-to-head: resolve the user's opponent for a given week, and
// forecast the game (projected scores + win probability) from each team's
// projected lineup distribution (mean from medians, variance from the
// floor↔ceiling bands). Reuses App.WeeklyProj projections.
//   resolveOpponentRosterId({league, myRosterId, week}) → Promise<id|null>
//   dist(starterPids, projections)  → { mean, sd, n }
//   forecast(myDist, oppDist)       → { winPct, projMe, projOpp, margin }
//     (winPct/margin are null when either side has no projectable players)
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // Standard-normal CDF (Abramowitz & Stegun 26.2.17). P(Z ≤ z).
    function normCdf(z) {
        const t = 1 / (1 + 0.2316419 * Math.abs(z));
        const d = 0.3989422804014327 * Math.exp(-z * z / 2);
        const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
        return z > 0 ? 1 - p : p;
    }

    // Team scoring distribution from a set of starters' projections. Mean = sum
    // of medians; per-player sd ≈ half the floor↔ceiling band; team variance =
    // sum of player variances (treated independent).
    function dist(starterPids, projections, key) {
        const obj = key || 'median';
        let mean = 0, varSum = 0, n = 0;
        (starterPids || []).forEach(pid => {
            const p = projections && projections[pid];
            if (!p || !p.points || p.available === false) return;
            const pts = p.points;
            const med = pts[obj] != null ? pts[obj] : (pts.median || 0);
            const f = pts.floor != null ? pts.floor : med;
            const c = pts.ceiling != null ? pts.ceiling : med;
            const sd = Math.max(0.5, (c - f) / 2);
            mean += med; varSum += sd * sd; n++;
        });
        // n = contributing players — 0 means "no data", not "projects 0".
        return { mean: Math.round(mean * 10) / 10, sd: Math.sqrt(varSum), n };
    }

    // P(my team outscores opponent), plus projected (expected) scores + margin.
    // No forecast when either side has zero contributing players (n===0): an
    // empty/unprojectable lineup is "no data", not a 0-point projection, so a
    // confident 1%/99% would be wrong on both ends.
    function forecast(myDist, oppDist) {
        if (!myDist.n || !oppDist.n) {
            return { winPct: null, projMe: myDist.mean, projOpp: oppDist.mean, margin: null };
        }
        const denom = Math.sqrt(myDist.sd * myDist.sd + oppDist.sd * oppDist.sd) || 1;
        const z = (myDist.mean - oppDist.mean) / denom;
        return {
            winPct: Math.max(1, Math.min(99, Math.round(normCdf(z) * 100))),
            projMe: myDist.mean,
            projOpp: oppDist.mean,
            margin: Math.round((myDist.mean - oppDist.mean) * 10) / 10,
        };
    }

    function _mflProxyGet(url) {
        const cfg = (App && App.CONFIG) || (root.OD && root.OD.CONFIG) || {};
        const proxy = (cfg.endpoints && cfg.endpoints.mflProxy) || '/api/mfl-proxy';
        const anon = cfg.supabaseAnon || (root.OD && root.OD.SUPABASE_ANON) || (App && App.SUPABASE_ANON);
        const token = (root.OD && root.OD.getSessionToken && root.OD.getSessionToken()) || null;
        const headers = { 'Content-Type': 'application/json' };
        if (anon) { headers['Authorization'] = 'Bearer ' + (token || anon); headers['apikey'] = anon; }
        return fetch(proxy, { method: 'POST', headers, body: JSON.stringify({ url }) }).then(r => { if (!r.ok) throw new Error('mfl proxy ' + r.status); return r.json(); });
    }

    function _platform(league) {
        if (!league) return 'unknown';
        if (league._mfl || String(league.id || '').startsWith('mfl_') || league._mflLeagueId) return 'mfl';
        if (league._espn) return 'espn';
        if (league._yahoo) return 'yahoo';
        return 'sleeper';
    }

    // Cache Sleeper weekly matchup rows per (league, week). resolveOpponentRosterId
    // is re-invoked on every lineup-tab revisit (and overlaps with what other tabs
    // fetch), yet the roster→matchup mapping is stable through the week. In-memory
    // with in-flight dedup; 5-min TTL. Errors are not cached.
    const _matchupRowsCache = {};      // 'lid|week' -> { ts, rows }
    const _matchupRowsInflight = {};
    function _fetchSleeperMatchups(lid, week) {
        const k = lid + '|' + week;
        const hit = _matchupRowsCache[k];
        if (hit && Date.now() - hit.ts < 5 * 60 * 1000) return Promise.resolve(hit.rows);
        if (_matchupRowsInflight[k]) return _matchupRowsInflight[k];
        _matchupRowsInflight[k] = fetch('https://api.sleeper.app/v1/league/' + lid + '/matchups/' + week)
            .then(r => r.ok ? r.json() : [])
            .then(rows => { rows = rows || []; _matchupRowsCache[k] = { ts: Date.now(), rows }; return rows; })
            .catch(() => [])
            .finally(() => { delete _matchupRowsInflight[k]; });
        return _matchupRowsInflight[k];
    }

    // Resolve the opponent roster_id for (league, myRosterId, week). Returns null
    // when no matchup is scheduled / data unavailable. Sleeper + MFL supported;
    // a generic window.S.matchups fallback covers anything that pre-populates it.
    async function resolveOpponentRosterId(opts) {
        const league = opts.league || {};
        const myRosterId = String(opts.myRosterId != null ? opts.myRosterId : '');
        const week = Number(opts.week) || 1;
        if (!myRosterId) return null;
        const plat = _platform(league);
        try {
            if (plat === 'sleeper') {
                const lid = league.league_id || league.id;
                const rows = await _fetchSleeperMatchups(lid, week);
                const mine = (rows || []).find(r => String(r.roster_id) === myRosterId);
                if (!mine || mine.matchup_id == null) return null;
                const opp = rows.find(r => String(r.roster_id) !== myRosterId && String(r.matchup_id) === String(mine.matchup_id));
                return opp ? opp.roster_id : null;
            }
            if (plat === 'mfl') {
                const lid = league._mflLeagueId || String(league.id || '').replace(/^mfl_/, '').replace(/_\d+$/, '');
                const yr = league.season || (root.S && root.S.mflYear) || new Date().getFullYear();
                const key = (root.S && root.S._mflApiKey) || '';
                const url = 'https://api.myfantasyleague.com/' + yr + '/export?TYPE=schedule&L=' + lid + '&W=' + week + '&JSON=1' + (key ? '&APIKEY=' + encodeURIComponent(key) : '');
                const d = await _mflProxyGet(url);
                let ws = d && d.schedule && d.schedule.weeklySchedule;
                if (Array.isArray(ws)) ws = ws.find(w => Number(w.week) === week) || ws[0];
                const matchups = ws && ws.matchup ? (Array.isArray(ws.matchup) ? ws.matchup : [ws.matchup]) : [];
                for (const m of matchups) {
                    const fr = m && m.franchise ? (Array.isArray(m.franchise) ? m.franchise : [m.franchise]) : [];
                    const ids = fr.map(f => String(f.id));
                    if (ids.includes(myRosterId)) { const o = ids.find(id => id !== myRosterId); return o || null; }
                }
                return null;
            }
            // Generic: a pre-loaded matchups map { week: [{roster_id, matchup_id}] }.
            const m = (root.S && root.S.matchups && root.S.matchups[week]) || (league.matchups && league.matchups[week]);
            if (Array.isArray(m)) {
                const mine = m.find(r => String(r.roster_id) === myRosterId);
                if (mine && mine.matchup_id != null) {
                    const opp = m.find(r => String(r.roster_id) !== myRosterId && String(r.matchup_id) === String(mine.matchup_id));
                    return opp ? opp.roster_id : null;
                }
            }
        } catch (e) { if (root.wrLog) root.wrLog('matchup.resolveOpponent', e); }
        return null;
    }

    // Resolve opponents for a SET of weeks in one go — powers the season
    // schedule rail. Returns { [week]: { oppRosterId, myPts, oppPts } } (pts are
    // actuals for completed weeks, 0 for upcoming). Sleeper fans out one cached
    // fetch per week; MFL pulls the whole weeklySchedule in a single export.
    async function resolveSeasonOpponents(opts) {
        const league = opts.league || {};
        const myRosterId = String(opts.myRosterId != null ? opts.myRosterId : '');
        const weeks = (opts.weeks || []).map(Number).filter(w => w > 0);
        const out = {};
        if (!myRosterId || !weeks.length) return out;
        const plat = _platform(league);
        try {
            if (plat === 'sleeper') {
                const lid = league.league_id || league.id;
                await Promise.all(weeks.map(async wk => {
                    const rows = await _fetchSleeperMatchups(lid, wk);
                    const mine = (rows || []).find(r => String(r.roster_id) === myRosterId);
                    if (!mine || mine.matchup_id == null) return;
                    const opp = rows.find(r => String(r.roster_id) !== myRosterId && String(r.matchup_id) === String(mine.matchup_id));
                    if (opp) out[wk] = { oppRosterId: opp.roster_id, myPts: Number(mine.points) || 0, oppPts: Number(opp.points) || 0 };
                }));
                return out;
            }
            if (plat === 'mfl') {
                const lid = league._mflLeagueId || String(league.id || '').replace(/^mfl_/, '').replace(/_\d+$/, '');
                const yr = league.season || (root.S && root.S.mflYear) || new Date().getFullYear();
                const key = (root.S && root.S._mflApiKey) || '';
                const url = 'https://api.myfantasyleague.com/' + yr + '/export?TYPE=schedule&L=' + lid + '&JSON=1' + (key ? '&APIKEY=' + encodeURIComponent(key) : '');
                const d = await _mflProxyGet(url);
                let wsArr = d && d.schedule && d.schedule.weeklySchedule;
                if (!Array.isArray(wsArr)) wsArr = wsArr ? [wsArr] : [];
                const want = new Set(weeks);
                wsArr.forEach(ws => {
                    const wk = Number(ws.week);
                    if (!want.has(wk)) return;
                    const matchups = ws.matchup ? (Array.isArray(ws.matchup) ? ws.matchup : [ws.matchup]) : [];
                    for (const m of matchups) {
                        const fr = m && m.franchise ? (Array.isArray(m.franchise) ? m.franchise : [m.franchise]) : [];
                        const ids = fr.map(f => String(f.id));
                        if (ids.includes(myRosterId)) {
                            const o = ids.find(id => id !== myRosterId);
                            if (o) {
                                const me = fr.find(f => String(f.id) === myRosterId), him = fr.find(f => String(f.id) === o);
                                out[wk] = { oppRosterId: o, myPts: Number(me && me.score) || 0, oppPts: Number(him && him.score) || 0 };
                            }
                            break;
                        }
                    }
                });
                return out;
            }
            // Generic fallback: resolve week-by-week.
            await Promise.all(weeks.map(async wk => {
                const id = await resolveOpponentRosterId({ league, myRosterId, week: wk });
                if (id != null) out[wk] = { oppRosterId: id, myPts: 0, oppPts: 0 };
            }));
        } catch (e) { if (root.wrLog) root.wrLog('matchup.resolveSeason', e); }
        return out;
    }

    App.Matchup = App.Matchup || { normCdf, dist, forecast, resolveOpponentRosterId, resolveSeasonOpponents, _platform };
})(typeof window !== 'undefined' ? window : globalThis);
