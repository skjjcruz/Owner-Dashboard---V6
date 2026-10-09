// ══════════════════════════════════════════════════════════════════
// js/shared/game-locks.js — window.App.GameLocks
// Whose game has kicked off this week, and what he scored.
//
// Owner report 2026-10-09: Game Day said "Replace KaVontae Turpin with
// Raheim Sanders" the morning after Turpin played Thursday night. Sleeper
// locks a player the moment his game kicks off; the optimizer did not know.
// This module reads two small Sleeper feeds and answers, for any player:
//   · his game's state this week: 'upcoming' | 'live' | 'final' | 'bye'
//   · locked: true once kickoff has passed (live or final)
//   · pts: his actual points this week in the league's scoring (from the
//     league's live matchups), once his game has started
// Every lineup surface reads it: both optimizers pin a locked starter in
// his slot at his actual points and never pull a locked bench player in;
// the Game Day screen won't let a locked slot be changed.
//
//   load(leagueId, season, week) → Promise<boolean changed>   (memo 30 s)
//   state(pid) → { status, locked, pts, label, opp } | null
//   isLocked(pid) / actual(pid) / ready() / stamp()
// Fires 'wr:locks-updated' when the answer changes. Never rejects: if
// Sleeper is unreachable nothing is locked (the old behaviour).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const SL = 'https://api.sleeper.app/v1';
    const st = { key: '', at: 0, week: 0, games: {}, points: {}, inflight: null, sig: '' };
    const S = () => root.S || {};
    const currentWeekNow = () => week();

    function teamOf(pid) {
        const p = (S().players || {})[pid];
        if (p && p.team) return String(p.team).toUpperCase();
        // Team defenses are keyed by their abbreviation.
        return /^[A-Z]{2,3}$/.test(String(pid)) ? String(pid) : '';
    }
    function getJson(url) {
        return fetch(url).then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); });
    }

    function load(leagueId, season, week) {
        season = Number(season) || 0; week = Number(week) || 0;
        // Never read a week the app is not on (see state()).
        if (!season || !week || week !== currentWeekNow()) return Promise.resolve(false);
        const key = (leagueId || '') + '|' + season + '|' + week;
        const prevKey = st.key;
        if (st.key === key && Date.now() - st.at < 55000) return st.inflight || Promise.resolve(false);
        const job = Promise.all([
            getJson(SL + '/scores/nfl/regular/' + season + '/' + week).catch(() => null),
            leagueId ? getJson(SL + '/league/' + leagueId + '/matchups/' + week).catch(() => null) : Promise.resolve(null),
        ]).then(([scores, matchups]) => {
            const games = {};
            (Array.isArray(scores) ? scores : []).forEach(g => {
                const m = (g && g.metadata) || {};
                const h = String(m.home_team || '').toUpperCase(), a = String(m.away_team || '').toUpperCase();
                if (!h || !a) return;
                const started = !!m.has_started || (!!g.status && g.status !== 'pre_game');
                const over = !!m.is_over || g.status === 'complete';
                const live = started && !over;
                const status = over ? 'final' : live ? 'live' : 'upcoming';
                const clock = live && m.quarter_num ? 'Q' + m.quarter_num + (m.time_remaining ? ' ' + m.time_remaining : '') : '';
                const base = { status, locked: started, kick: Number(g.start_time) || 0, clock };
                games[h] = Object.assign({ opp: a, home: true }, base);
                games[a] = Object.assign({ opp: h, home: false }, base);
            });
            const points = {};
            (Array.isArray(matchups) ? matchups : []).forEach(r => {
                const pp = (r && r.players_points) || {};
                Object.keys(pp).forEach(pid => { points[pid] = Number(pp[pid]) || 0; });
            });
            // Keep the last good read if a feed failed this time.
            if (Object.keys(games).length || prevKey !== key) { st.games = games; st.week = week; }
            if (Object.keys(points).length || prevKey !== key) st.points = points;
            st.key = key; st.at = Date.now();
            const sig = Object.keys(st.games).filter(t => st.games[t].locked).sort().map(t => t + st.games[t].status).join(',') + '|' + Object.keys(st.points).length + ':' + Object.values(st.points).reduce((x, y) => x + y, 0).toFixed(2);
            const changed = sig !== st.sig;
            st.sig = sig;
            if (changed && root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent('wr:locks-updated'));
            return changed;
        }).catch(() => false).finally(() => { st.inflight = null; });
        st.key = key; st.at = Date.now(); st.inflight = job;
        return job;
    }

    function state(pid) {
        // Only answer for the week the app is on now (browser check
        // 2026-10-09: a cold load read week 1 before the app knew it was
        // week 5, and every starter showed locked with week-1 points).
        if (!pid || !Object.keys(st.games).length || st.week !== week()) return null;
        const team = teamOf(String(pid));
        if (!team) return null;
        const g = st.games[team];
        if (!g) return { status: 'bye', locked: false, pts: null, label: 'BYE', opp: null };
        const pts = g.locked ? (String(pid) in st.points ? st.points[String(pid)] : 0) : null;
        const label = g.status === 'final' ? 'FINAL' : g.status === 'live' ? ('LIVE' + (g.clock ? ' ' + g.clock : '')) : '';
        return { status: g.status, locked: !!g.locked, pts, label, opp: g.opp, home: g.home, kick: g.kick };
    }
    const isLocked = pid => { const s = state(pid); return !!(s && s.locked); };
    const actual = pid => { const s = state(pid); return s && s.locked ? s.pts : null; };
    const ready = () => Object.keys(st.games).length > 0 && st.week === week();
    const stamp = () => st.sig;

    // Load for the league the app has open, and keep it fresh while the page
    // is open (once a minute: games lock and points move on Sundays).
    function league() {
        const s = S(), id = String(s.currentLeagueId || '');
        const lg = id ? (s.leagues || []).find(l => String(l.league_id || l.id) === id) : null;
        return lg ? { id, season: lg.season || s.season || (s.nflState && s.nflState.season) } : null;
    }
    // The week the app is on, or 0 while it doesn't know yet (before the
    // league loads, the app's own week reads a placeholder 1).
    function week() {
        const s = S(), WP = App.WeeklyProj;
        if (!(Number(s.currentWeek) > 0) && !(s.nflState && (s.nflState.week || s.nflState.display_week))) return 0;
        return Number((WP && WP.currentWeek && WP.currentWeek()) || s.currentWeek || s.nflState.display_week || s.nflState.week || 0);
    }
    // Wait until the league and its week are actually known, then follow
    // the week: a check every 5 s is free (load() reuses a read for 55 s).
    function tick() { const lg = league(); if (lg && week()) load(lg.id, lg.season, week()); }
    function boot() {
        setInterval(tick, 5000);
    }

    App.GameLocks = App.GameLocks || { load, state, isLocked, actual, ready, stamp, teamOf, _st: st };
    if (typeof document !== 'undefined') boot();
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.GameLocks;
})(typeof window !== 'undefined' ? window : globalThis);
