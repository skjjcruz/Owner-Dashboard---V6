// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-nfl.js — window.WrWireNfl
// The Wire's NFL desk sources (Dynasty HQ addition, 2026-09-27).
//
// Why not App.NflContext.loadScoreboard alone: on deployed pages that goes
// through our nfl-scoreboard relay, which caches ESPN for up to 3 hours — a
// game in progress would show a score hours old under a "live" label. C2 read
// it unlabelled. The Wire instead:
//   1. reads ESPN's public scoreboard DIRECTLY (site.api.espn.com is in the
//      CSP connect-src and answers with Access-Control-Allow-Origin: *;
//      ESPN's own cache is ~8s). Parsed with App.NflContext.parseScores so
//      the game shape is identical. Result is labelled source 'espn' with
//      the time we checked it.
//   2. if that fails (offline, blocked, ESPN down) falls back to the relay,
//      but then keeps ONLY what cannot be stale: finished games' final
//      scores and kickoff times. In-progress games lose their score and
//      leaders (marked liveUnavailable) — the desk says "live score
//      unavailable" rather than showing an hours-old number.
// Cached 50s per (season, type, week) so the desk's one-minute refresh is
// one request per week shown; a week whose games are all final is kept 6h;
// failures are never cached.
//
//   loadScoreboard(week, season, seasontype) → Promise<{ games, source:
//     'espn'|'relay', checkedAt }>  (rejects only if both sources fail)
//   liveWeekStats(season, week, type) → Promise<{ stats, at }> — fresh
//     Sleeper stats for the week in progress (55s memory cache).
//   weekStats(season, week, type) → Promise<{pid: stats}> — Sleeper weekly
//     NFL stats. Regular season reuses App.SOS.getWeekStats (session
//     cached); preseason/postseason fetch Sleeper's /stats/nfl/{pre|post}
//     directly, because our SOS helper only knows the regular season and
//     would return regular-season numbers under a "PRE"/"POST" label.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const TTL = 50000;
    const FINAL_TTL = 6 * 3600000;
    const LIVE_TTL = 55000;
    const liveCache = new Map();
    const cache = new Map();
    const statsCache = new Map();
    const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

    function timed(url, ms) {
        const Ctl = root.AbortController;
        const controller = Ctl ? new Ctl() : null;
        const timer = controller ? root.setTimeout(() => controller.abort(), ms) : null;
        return root.fetch(url, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) })
            .finally(() => { if (timer !== null) root.clearTimeout(timer); });
    }
    function parse(data) {
        const NC = root.App?.NflContext;
        if (!data || !Array.isArray(data.events) || !NC?.parseScores) throw new Error('Invalid NFL scoreboard');
        return NC.parseScores(data);
    }
    // Relay copy: only what a 3-hour-old snapshot can still say truthfully.
    function relaySafe(game) {
        if (game.completed) return game;
        if (game.state === 'in' || game.state === 'post') {
            return { ...game, homeScore: null, awayScore: null, homePeriods: [], awayPeriods: [], leaders: [], shortDetail: 'In progress', liveUnavailable: true, completed: false, state: 'in' };
        }
        return game;
    }
    function loadScoreboard(week, season, seasontype) {
        const type = Number(seasontype) || 2;
        const key = (season || '') + '|' + type + '|' + week;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < (hit.ttl || TTL)) return hit.promise;
        const direct = ESPN + '?week=' + encodeURIComponent(week) + '&seasontype=' + type + (season ? '&dates=' + encodeURIComponent(season) : '');
        const promise = timed(direct, 12000)
            .then(r => { if (!r.ok) throw new Error('ESPN ' + r.status); return r.json(); })
            .then(data => ({ games: parse(data), source: 'espn', checkedAt: Date.now() }))
            .catch(() => {
                const NC = root.App?.NflContext;
                if (!NC?.loadScoreboard) throw new Error('NFL scores unavailable');
                return NC.loadScoreboard(week, season, type).then(games => ({ games: games.map(relaySafe), source: 'relay', checkedAt: Date.now() }));
            })
            .catch(error => { cache.delete(key); throw error; });
        const entry = { at: Date.now(), promise, ttl: TTL };
        // A week whose games are ALL final never changes again (review S5):
        // keep it for hours instead of re-downloading it every minute.
        promise.then(res => { if (res.games.length && res.games.every(g => g.completed)) entry.ttl = FINAL_TTL; }, () => {});
        cache.set(key, entry);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        return promise;
    }
    function weekStats(season, week, type) {
        const kind = type === 'pre' || type === 'post' ? type : 'regular';
        if (kind === 'regular') {
            const SOS = root.App?.SOS;
            return SOS?.getWeekStats ? Promise.resolve(SOS.getWeekStats(season, week)) : Promise.resolve({});
        }
        const key = season + '|' + kind + '|' + week;
        if (statsCache.has(key)) return statsCache.get(key);
        const promise = timed('https://api.sleeper.app/v1/stats/nfl/' + kind + '/' + encodeURIComponent(season) + '/' + encodeURIComponent(week), 15000)
            .then(r => { if (!r.ok) throw new Error('stats ' + r.status); return r.json(); }).then(d => d || {})
            .catch(() => { statsCache.delete(key); return {}; });
        statsCache.set(key, promise);
        if (statsCache.size > 6) statsCache.delete(statsCache.keys().next().value);
        return promise;
    }
    // The IN-PROGRESS week (review S4): App.SOS caches a week for 24h in
    // sessionStorage, which would freeze Sunday's numbers at whenever they were
    // first read. Fresh Sleeper stats instead (≤1 request/55s per week, in
    // memory only), returned with the time they were read so callers can say
    // "as of". App.SOS itself is untouched for its other callers.
    function liveWeekStats(season, week, type) {
        const kind = type === 'pre' || type === 'post' ? type : 'regular';
        const key = season + '|' + kind + '|' + week;
        const hit = liveCache.get(key);
        if (hit && Date.now() - hit.at < LIVE_TTL) return hit.promise;
        const at = Date.now();
        const promise = timed('https://api.sleeper.app/v1/stats/nfl/' + kind + '/' + encodeURIComponent(season) + '/' + encodeURIComponent(week), 15000)
            .then(r => { if (!r.ok) throw new Error('stats ' + r.status); return r.json(); })
            .then(d => ({ stats: d || {}, at }))
            .catch(error => { liveCache.delete(key); throw error; });
        liveCache.set(key, { at, promise });
        if (liveCache.size > 4) liveCache.delete(liveCache.keys().next().value);
        return promise;
    }
    root.WrWireNfl = { loadScoreboard, weekStats, liveWeekStats, relaySafe };
})(typeof window !== 'undefined' ? window : globalThis);
