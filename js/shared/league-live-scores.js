// ══════════════════════════════════════════════════════════════════
// js/shared/league-live-scores.js — window.App.LeagueLiveScores
// Shared Sleeper scoreboard polling. Fantasy totals come from the league's
// scored matchup feed, never generic NFL points or a projection estimate.
// Ported from C2 (WarRoom-sandbox, 2026-09-27). Public API and shapes are
// C2's, so The Wire / League Central consume it unchanged:
//   INTERVAL, supported(league), currentWeek(league), rosterPoints(row),
//   playerPoints(row, pid), groupRows(rows), createClient(env),
//   useScores({ league, week?, enabled? }) → { status, week, supported,
//     rows, groups, updatedAt, error, refresh }
// Additions (backward compatible — omitted = C2 behaviour):
//   • supported() also reads our `_platform` marker (ESPN/MFL/Yahoo → false).
//   • subscribe(league, week, listener, { interval }) / useScores({ interval })
//     choose the poll cadence per subscriber; the shared entry polls at the
//     FASTEST positive interval among its subscribers, never faster than
//     INTERVAL (30s). interval 0 = fetch when stale, no timer (e.g. a Game
//     Day with no NFL game in progress). handle.setInterval(ms) changes it
//     without re-subscribing (no abort, no flash).
//   • Returning to a visible page refreshes only when the snapshot is at
//     least INTERVAL old (C2 refreshed unconditionally).
// One client per page: every subscriber of a league+week shares one request
// and one timer. Timers stop while the page is hidden and when the last
// subscriber leaves. In-memory only — nothing is written to storage.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const INTERVAL = 30000;
    const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    function supported(league) {
        if (!league || !(league.league_id || league.id)) return false;
        if (league._mfl || league._mflLeagueId || league._espn || league._yahoo) return false;
        const provider = String(league._platform || league.platform || league.provider || '').toLowerCase();
        return (!provider || provider === 'sleeper') && !/^(mfl|espn|yahoo|manual|demo)_/.test(String(league.league_id || league.id));
    }
    function currentWeek(league) {
        const state = root.S || {}, nfl = state.nflState || {};
        const season = Number(league && league.season);
        const liveSeason = Number(nfl.season) || new Date().getFullYear();
        const clamp = w => Math.max(1, Math.min(18, Math.floor(Number(w) || 1)));
        if (season && season !== liveSeason) return season < liveSeason ? clamp(league.settings?.leg || 18) : 1;
        if (nfl.season_type && nfl.season_type !== 'regular') {
            return nfl.season_type === 'post' ? 18 : clamp(league?.settings?.leg || 1);
        }
        return clamp(nfl.display_week || nfl.week || state.currentWeek || league?.settings?.leg || 1);
    }
    function rosterPoints(row) {
        return number(row?.custom_points) ?? number(row?.points);
    }
    function playerPoints(row, pid) {
        return number(row?.players_points?.[String(pid)]);
    }
    function groupRows(rows) {
        const groups = new Map();
        (rows || []).forEach(row => {
            if (row?.roster_id == null) return;
            const key = row.matchup_id == null ? 'bye:' + row.roster_id : 'matchup:' + row.matchup_id;
            if (!groups.has(key)) groups.set(key, { key, matchupId: row.matchup_id ?? null, teams: [] });
            groups.get(key).teams.push(row);
        });
        return Array.from(groups.values());
    }
    const empty = (week, isSupported) => ({ status: isSupported ? 'idle' : 'unsupported', week, supported: isSupported, rows: [], groups: [], updatedAt: null, error: null });
    // A subscriber's cadence: undefined → C2's INTERVAL; 0/null/false → no
    // timer; anything else is clamped up to INTERVAL (never poll faster).
    const cadence = value => value === undefined ? INTERVAL : !value ? 0 : Math.max(INTERVAL, Number(value) || INTERVAL);

    // Factory permits deterministic lifecycle/failure testing without a browser.
    function createClient(options) {
        const env = options || {};
        const fetcher = env.fetch || ((...args) => root.fetch(...args));
        const now = env.now || Date.now;
        const schedule = env.setTimeout || root.setTimeout.bind(root);
        const cancel = env.clearTimeout || root.clearTimeout.bind(root);
        const doc = env.document === undefined ? root.document : env.document;
        const entries = new Map();
        function entry(league, week) {
            const id = String(league.league_id || league.id), key = id + '|' + week;
            if (!entries.has(key)) entries.set(key, { id, week, state: empty(week, true), listeners: new Map(), pending: null, timer: null, controller: null });
            return entries.get(key);
        }
        function emit(e) { Array.from(e.listeners.keys()).forEach(fn => { if (e.listeners.has(fn)) fn(e.state); }); }
        function pollEvery(e) {
            let best = 0;
            e.listeners.forEach(ms => { if (ms > 0 && (!best || ms < best)) best = ms; });
            return best;
        }
        function later(e) {
            if (e.timer !== null) cancel(e.timer);
            e.timer = null;
            const every = pollEvery(e);
            if (every && !doc?.hidden) e.timer = schedule(() => { e.timer = null; refresh(e); }, every);
        }
        const stale = e => e.state.updatedAt === null || now() - e.state.updatedAt >= INTERVAL;
        function refresh(e) {
            if (e.pending) return e.pending;
            e.state = { ...e.state, status: e.state.updatedAt !== null ? 'refreshing' : 'loading', error: null };
            emit(e);
            const Controller = root.AbortController;
            e.controller = Controller ? new Controller() : null;
            const timeout = e.controller ? schedule(() => e.controller?.abort(), 15000) : null;
            e.pending = Promise.resolve().then(() => fetcher('https://api.sleeper.app/v1/league/' + encodeURIComponent(e.id) + '/matchups/' + e.week, { cache: 'no-store', ...(e.controller ? { signal: e.controller.signal } : {}) }))
                .then(response => { if (!response.ok) throw new Error('Scores could not be refreshed.'); return response.json(); })
                .then(rows => {
                    if (!Array.isArray(rows) || rows.some(row => !row || row.roster_id == null)) throw new Error('Score data is unavailable.');
                    e.state = { ...e.state, status: 'ready', rows, groups: groupRows(rows), updatedAt: now(), error: null };
                })
                .catch(() => { e.state = { ...e.state, status: e.state.updatedAt !== null ? 'stale' : 'error', error: 'Could not refresh Sleeper scores. Try again shortly.' }; })
                .finally(() => {
                    if (timeout !== null) cancel(timeout);
                    e.pending = null; e.controller = null;
                    emit(e); later(e);
                });
            return e.pending;
        }
        function subscribe(league, week, listener, opts) {
            if (!supported(league)) { listener(empty(week, false)); const off = () => {}; off.setInterval = () => {}; return off; }
            const e = entry(league, week);
            e.listeners.set(listener, cadence(opts && opts.interval));
            listener(e.state);
            if (!doc?.hidden && stale(e)) refresh(e);
            else later(e);
            const visibility = () => {
                if (!e.listeners.has(listener)) return;
                if (doc.hidden) { if (e.timer !== null) cancel(e.timer); e.timer = null; }
                else if (stale(e)) refresh(e);
                else later(e);
            };
            doc?.addEventListener('visibilitychange', visibility);
            const off = () => {
                e.listeners.delete(listener);
                doc?.removeEventListener('visibilitychange', visibility);
                if (!e.listeners.size) {
                    if (e.timer !== null) cancel(e.timer);
                    e.timer = null;
                    e.controller?.abort();
                } else later(e);
            };
            // Change this subscriber's cadence in place (no abort, no refetch
            // unless it switches polling on while the snapshot is stale).
            off.setInterval = ms => {
                if (!e.listeners.has(listener)) return;
                const next = cadence(ms);
                if (e.listeners.get(listener) === next) return;
                e.listeners.set(listener, next);
                if (e.pending) return; // finally → later() picks up the new cadence
                if (next && !doc?.hidden && stale(e)) refresh(e);
                else later(e);
            };
            return off;
        }
        return { subscribe, refresh: (league, week) => supported(league) ? refresh(entry(league, week)) : Promise.resolve() };
    }
    let client;
    function useScores(opts) {
        const { league, enabled = true } = opts || {};
        const week = Math.max(1, Math.min(18, Math.floor(Number(opts?.week) || currentWeek(league))));
        const isSupported = supported(league), id = league?.league_id || league?.id || '';
        const key = id + '|' + week + '|' + isSupported + '|' + enabled;
        const interval = opts && 'interval' in opts ? opts.interval : undefined;
        const React = root.React;
        const [result, setResult] = React.useState(() => ({ key, state: empty(week, isSupported) }));
        const handle = React.useRef(null);
        const intervalRef = React.useRef(interval);
        intervalRef.current = interval;
        React.useEffect(() => {
            if (!enabled) { setResult({ key, state: empty(week, isSupported) }); return undefined; }
            client = client || createClient();
            let active = true;
            const unsubscribe = client.subscribe(league, week, state => { if (active) setResult({ key, state }); }, { interval: intervalRef.current });
            handle.current = unsubscribe;
            return () => { active = false; handle.current = null; unsubscribe(); };
        }, [key]);
        React.useEffect(() => { handle.current?.setInterval?.(interval); }, [interval]);
        const refresh = React.useCallback(() => {
            if (!enabled || !isSupported) return Promise.resolve();
            client = client || createClient();
            return client.refresh(league, week);
        }, [key]);
        return { ...(result.key === key ? result.state : empty(week, isSupported)), refresh };
    }
    App.LeagueLiveScores = { INTERVAL, supported, currentWeek, rosterPoints, playerPoints, groupRows, createClient, useScores };
})(typeof window !== 'undefined' ? window : globalThis);
