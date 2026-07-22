// ══════════════════════════════════════════════════════════════════
// js/shared/sleeper-proj.js — window.App.SleeperProj
// Loads Sleeper's OWN published weekly projection stat lines for the
// upcoming week and feeds them to App.WeeklyProj.setProjections, so the
// Proj column (and start/sit) shows the exact number the owner sees in
// the Sleeper app — scored through their league's rules. One voice.
//
// Source: Sleeper's public projections endpoint (CORS-open, same host the
// app already uses for stats):
//   https://api.sleeper.app/v1/projections/nfl/regular/{season}/{week}
// Returns a pid → statLine map (same shape as season stats: pass_yd,
// pass_td, rec, … plus pts_ppr/half_ppr/std), so App.calcRawPts scores it
// directly. Degrades to a no-op (home-grown engine) if unavailable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const _done = {}; // `${season}|${week}` already loaded
    const SLEEPER = 'https://api.sleeper.app/v1';

    function targetWeek() {
        const WP = App.WeeklyProj;
        return (WP && WP.currentWeek) ? WP.currentWeek() : 1;
    }
    function targetSeason(season) {
        const s = root.S || {};
        const y = Number(season || (s.nflState && s.nflState.season) || s.season || 0);
        return y > 0 ? y : new Date().getFullYear();
    }

    async function fetchWeek(season, week) {
        // Prefer the shared Sleeper API (IndexedDB cache / dedupe) when present.
        if (root.Sleeper && root.Sleeper.fetchWeekProjections) return root.Sleeper.fetchWeekProjections(season, week);
        const r = await fetch(SLEEPER + '/projections/nfl/regular/' + season + '/' + week);
        if (!r.ok) throw new Error('projections ' + r.status);
        return r.json();
    }

    // Load the upcoming week's Sleeper projections and hand them to WeeklyProj.
    // Cached per (season, week). Returns the loaded week, or null on failure.
    async function loadCurrent(season) {
        const WP = App.WeeklyProj;
        if (!WP || !WP.setProjections) return null;
        const wk = targetWeek();
        const yr = targetSeason(season);
        const key = yr + '|' + wk;
        if (_done[key]) return wk;
        try {
            const byPid = await fetchWeek(yr, wk);
            if (byPid && typeof byPid === 'object' && Object.keys(byPid).length) {
                WP.setProjections(wk, byPid);
                _done[key] = true;
                try { root.dispatchEvent && root.dispatchEvent(new CustomEvent('wr:proj-updated', { detail: { week: wk, season: yr } })); } catch (e) { /* no window */ }
                return wk;
            }
        } catch (e) { if (root.wrLog) root.wrLog('sleeperProj.load', e); }
        return null;
    }

    App.SleeperProj = App.SleeperProj || { loadCurrent, targetWeek, targetSeason, _done };
})(typeof window !== 'undefined' ? window : globalThis);
