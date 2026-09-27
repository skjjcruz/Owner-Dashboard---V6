// ══════════════════════════════════════════════════════════════════
// js/shared/league-live-table.js — window.App.LeagueLiveTable
// Context for the live standings table. The score subscription remains shared
// with the scoreboard; completed weeks form a separate, reusable baseline.
// Ported from C2 (WarRoom-sandbox, 2026-09-27). Public API and shapes are
// C2's (The Wire's journal/portfolio call loadHistory directly):
//   loadHistory({ league, week, signal?, force?, fetcher?, now? })
//     → Promise<{ priorWeeks: [{ week, rows }], updatedAt, unplayedFrom }>  (weeks start..week-1,
//       ending before the first unplayed week)
//   startedRosters({ rows, games, playersData, historical?, now? }) → [rosterId]
//   useContext({ league, board, playersData, enabled?, games? })
//     → { enabled, historical, future, currentWeek, lastReg, history, startedRosterIds, refresh }
// Adaptations for Dynasty HQ:
//   • Completed weeks reuse App.Matchup's per-(league, week) Sleeper cache
//     when no custom fetcher is passed and the call is not forced — Game
//     Day's schedule rail already loads those same weeks through it, so the
//     standings table adds no duplicate requests.
//   • The completed-week baseline is kept 15 minutes (C2: 5). Finished weeks
//     only move on stat corrections; a forced refresh still bypasses it.
//   • startedRosters() also counts a passed kickoff as "started": the prod
//     nfl-scoreboard relay caches game state for up to 3h, kickoff times never
//     go stale.
//   • An UNPLAYED week is not a completed week (review B1, 2026-09-27): a
//     week where every team scored 0 (or where Sleeper's rows carry lineups
//     and nobody started anyone — a pre-draft / not-yet-started league) would
//     otherwise count as all-ties with 0.00 points. loadHistory() stops at the
//     first unplayed week: priorWeeks holds only the weeks before it, and the
//     result adds unplayedFrom (that week, else null). Callers that need every
//     week (live standings) then fall back to Sleeper's official records.
//     unplayedWeek(rows) is exported for the same rule elsewhere.
//   • LRU cap of 40 history entries (was unbounded).
//   • useContext({ enabled:false }) keeps the hook mounted but idle, so a
//     collapsed/hidden standings view costs no requests; useContext({ games })
//     reuses the caller's NFL schedule instead of polling the relay itself.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const historyCache = new Map();
    const HISTORY_TTL = 15 * 60 * 1000;
    const HISTORY_MAX = 40;
    // Every team on 0, or lineups present and nobody started → not played yet.
    function unplayedWeek(rows) {
        if (!Array.isArray(rows) || !rows.length) return false;
        if (rows.every(r => App.LeagueLiveScores.rosterPoints(r) === 0)) return true;
        return rows.every(r => Array.isArray(r.starters)) && !rows.some(r => r.starters.some(pid => pid != null && String(pid) !== '0' && String(pid) !== ''));
    }
    const response = rows => ({ ok: true, json: async () => rows });

    async function loadHistory({ league, week, signal, force = false, fetcher, now = Date.now }) {
        const start = Math.max(1, Number(league.settings?.start_week) || 1);
        const lid = league.league_id || league.id;
        const key = `${lid}|${league.season}|${start}|${week}`;
        const cached = historyCache.get(key);
        if (!force && cached && now() - cached.updatedAt < HISTORY_TTL) return cached;
        // Shared cache first (no custom fetcher, not forced): App.Matchup's
        // in-flight-deduped rows. Anything else goes to the network.
        const shared = !fetcher && !force && App.Matchup && typeof App.Matchup.sleeperWeekRows === 'function' ? App.Matchup.sleeperWeekRows : null;
        const get = fetcher || root.fetch.bind(root);
        const weeks = Array.from({ length: Math.max(0, week - start) }, (_, i) => start + i);
        const priorWeeks = [];
        let cursor = 0;
        async function worker() {
            while (cursor < weeks.length) {
                const w = weeks[cursor++];
                if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
                const res = shared ? response(await shared(lid, w))
                    : await get(`https://api.sleeper.app/v1/league/${encodeURIComponent(lid)}/matchups/${w}`, { cache: 'no-store', signal });
                if (!res.ok) throw new Error('Completed weeks could not load.');
                const rows = await res.json();
                if (!Array.isArray(rows) || !rows.length || rows.some(r => !r || r.roster_id == null)) throw new Error('A completed week is unavailable.');
                const ids = new Set(rows.map(r => String(r.roster_id)));
                if (ids.size !== rows.length || rows.some(r => App.LeagueLiveScores.rosterPoints(r) == null)
                    || (league.rosters?.length && (ids.size !== league.rosters.length || league.rosters.some(r => !ids.has(String(r.roster_id)))))) throw new Error('A completed week is incomplete.');
                priorWeeks.push({ week: w, rows });
            }
        }
        await Promise.all(Array.from({ length: Math.min(4, weeks.length) }, worker));
        priorWeeks.sort((a, b) => a.week - b.week);
        const cut = priorWeeks.findIndex(w => unplayedWeek(w.rows));
        const unplayedFrom = cut >= 0 ? priorWeeks[cut].week : null;
        if (cut >= 0) priorWeeks.length = cut;
        const result = { priorWeeks, updatedAt: now(), unplayedFrom };
        historyCache.delete(key);
        historyCache.set(key, result);
        while (historyCache.size > HISTORY_MAX) historyCache.delete(historyCache.keys().next().value);
        return result;
    }

    function startedRosters({ rows = [], games = [], playersData = {}, historical = false, now } = {}) {
        const startedTeams = new Set();
        const clock = now == null ? Date.now() : now;
        games.forEach(game => {
            if (/POSTPONED|CANCEL|SUSPEND|DELAY/i.test(game.statusName || '')) return;
            const kickoff = Date.parse(game.kickoff || '');
            if (game.state === 'in' || game.completed || (Number.isFinite(kickoff) && kickoff <= clock)) { startedTeams.add(game.home); startedTeams.add(game.away); }
        });
        return rows.filter(row => {
            if (!row || row.roster_id == null) return false;
            if (historical) return true;
            const points = App.LeagueLiveScores.rosterPoints(row);
            if (points != null && points !== 0) return true;
            return (row.starters || []).some(pid => {
                if (!pid || String(pid) === '0') return false;
                const actual = App.LeagueLiveScores.playerPoints(row, pid);
                return (actual != null && actual !== 0) || startedTeams.has(playersData[pid]?.team);
            });
        }).map(row => String(row.roster_id));
    }

    function useContext({ league, board, playersData, enabled: wanted, games: givenGames }) {
        // givenGames (optional array): the caller's NFL schedule for this week.
        // When passed, the hook never calls NflContext itself (no extra relay load).
        const externalGames = Array.isArray(givenGames);
        const React = root.React;
        const id = league?.league_id || league?.id || '';
        const season = String(league?.season || '');
        const week = board.week;
        const currentWeek = App.LeagueLiveScores.currentWeek(league);
        const liveSeason = Number(root.S?.nflState?.season) || new Date().getFullYear();
        const historical = Number(season) < liveSeason || (Number(season) === liveSeason && week < currentWeek);
        const future = Number(season) > liveSeason || (Number(season) === liveSeason && week > currentWeek);
        const playoffStart = Number(league?.settings?.playoff_week_start);
        const lastReg = playoffStart > 0 ? playoffStart - 1 : 18;
        const enabled = wanted !== false && App.LeagueLiveScores.supported(league) && !App.Chopped?.isChopped?.(league) && week <= lastReg && !future;
        const key = `${id}|${season}|${week}|${enabled}`;
        const [revision, setRevision] = React.useState(0);
        const [history, setHistory] = React.useState({ key: '', status: 'loading', priorWeeks: [] });
        const [nfl, setNfl] = React.useState({ key: '', games: [] });
        React.useEffect(() => {
            if (!enabled) return undefined;
            let alive = true, pending = false;
            let controller;
            const refresh = async (force = false) => {
                if (!alive || pending || root.document.hidden) return;
                pending = true;
                controller = new root.AbortController();
                const timeout = root.setTimeout(() => controller?.abort(), 20000);
                setHistory(old => ({ key, status: old.key === key && old.updatedAt ? 'refreshing' : 'loading', priorWeeks: old.key === key ? old.priorWeeks : [], updatedAt: old.key === key ? old.updatedAt : null }));
                const nflRequest = historical || externalGames ? Promise.resolve([]) : Promise.resolve().then(() => App.NflContext?.loadScores?.(week, season, 2) || [])
                    .then(games => { if (alive) setNfl({ key, games }); }).catch(() => {});
                try {
                    const result = await loadHistory({ league, week, signal: controller.signal, force });
                    if (alive) setHistory({ key, status: 'ready', ...result });
                } catch (_) {
                    if (alive) setHistory(old => ({ ...old, key, status: old.updatedAt ? 'stale' : 'error' }));
                } finally {
                    root.clearTimeout(timeout);
                    pending = false;
                }
                await nflRequest;
            };
            refresh(revision > 0);
            const onVisible = () => { if (!root.document.hidden) refresh(); };
            const timer = root.setInterval(onVisible, 60000);
            root.document.addEventListener('visibilitychange', onVisible);
            return () => { alive = false; controller?.abort(); root.clearInterval(timer); root.document.removeEventListener('visibilitychange', onVisible); };
        }, [key, revision]);
        const currentHistory = history.key === key ? history : { status: 'loading', priorWeeks: [] };
        return {
            enabled, historical, future, currentWeek, lastReg, history: currentHistory,
            startedRosterIds: startedRosters({ rows: board.rows, games: externalGames ? givenGames : nfl.key === key ? nfl.games : [], playersData, historical }),
            refresh: () => setRevision(n => n + 1),
        };
    }
    App.LeagueLiveTable = { loadHistory, startedRosters, useContext, unplayedWeek };
})(typeof window !== 'undefined' ? window : globalThis);
