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

    // A week's payload counts as published when a real number of rows carry
    // projected volume (attempts, targets, kicks, tackles) or points — not just
    // the draft-ADP placeholder every player row carries year-round.
    const VOLUME_FIELDS = ['pts_ppr', 'pts_half_ppr', 'pts_std', 'pass_att', 'rush_att', 'rec_tgt', 'fga', 'xpm', 'idp_tkl', 'idp_sack'];
    function looksPublished(byPid) {
        if (!byPid || typeof byPid !== 'object') return false;
        let live = 0;
        for (const pid in byPid) {
            const row = byPid[pid];
            if (row && VOLUME_FIELDS.some(k => Number(row[k]) > 0) && ++live >= 50) return true;
        }
        return false;
    }

    // Owner report 2026-10-12 (Monday night): once a game ends, Sleeper
    // drops that game's players from the week's projections, so by Monday
    // night only the last game's ~30 players were left. The payload failed
    // the published check and every other player lost his line. The rows
    // this device has seen this week are kept (one week, live rows only)
    // and merged back under the fresh payload: fresh rows win, rows Sleeper
    // has since dropped come back as they were.
    const KEEP_KEY = 'dhq_sleeper_week_v1';
    function liveRows(byPid) {
        const out = {};
        if (!byPid || typeof byPid !== 'object') return out;
        for (const pid in byPid) { const row = byPid[pid]; if (row && VOLUME_FIELDS.some(k => Number(row[k]) > 0)) out[pid] = row; }
        return out;
    }
    function keptRows(key) {
        try { const k = JSON.parse(root.localStorage.getItem(KEEP_KEY) || 'null'); return k && k.key === key && k.rows ? k.rows : null; } catch (e) { return null; }
    }
    function keepRows(key, rows) {
        try { root.localStorage.setItem(KEEP_KEY, JSON.stringify({ key, rows })); } catch (e) { /* storage full or blocked: the fresh payload still works */ }
    }
    // Only a player whose game has already kicked off gets a kept row back:
    // a player Sleeper drops BEFORE his game (ruled out, lost his role) must
    // stay dropped (truth law). Kickoffs come from the week's game context;
    // without it nothing is restored.
    function kickedOff(pid, wk, now) {
        const p = ((root.S || {}).players || {})[pid];
        const bt = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek;
        const g = p && p.team && bt ? bt[String(p.team).toUpperCase() + '|' + wk] : null;
        const t = g && g.kickoff ? Date.parse(g.kickoff) : NaN;
        return Number.isFinite(t) && t <= (now || Date.now());
    }
    function withKept(key, byPid, now) {
        const kept = keptRows(key);
        if (!kept) return byPid;
        const wk = String(key).split('|')[1];
        const fresh = liveRows(byPid);
        const back = {};
        for (const pid in kept) if (!fresh[pid] && kickedOff(pid, wk, now)) back[pid] = kept[pid];
        return Object.keys(back).length ? Object.assign({}, byPid || {}, back) : byPid;
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
            let byPid = await fetchWeek(yr, wk);
            // Sleeper returns a row for every player even before it has
            // published the week's lines — placeholder rows with an ADP and
            // no volume. A payload like that is NOT the week's projections:
            // it must not be handed to the projector (every surface would fall
            // back to estimates) and must not be marked done. The shared cache
            // can hold such a payload for hours, so go straight to the network
            // once before giving up (owner report 2026-09-17).
            if (!looksPublished(byPid)) {
                try {
                    const r = await fetch(SLEEPER + '/projections/nfl/regular/' + yr + '/' + wk);
                    if (r.ok) byPid = await r.json();
                } catch (e) { /* keep the cached payload for the check below */ }
            }
            byPid = withKept(key, byPid);
            if (looksPublished(byPid)) {
                keepRows(key, Object.assign({}, keptRows(key) || {}, liveRows(byPid)));
                WP.setProjections(wk, byPid);
                _done[key] = true;
                try { root.dispatchEvent && root.dispatchEvent(new CustomEvent('wr:proj-updated', { detail: { week: wk, season: yr } })); } catch (e) { /* no window */ }
                return wk;
            }
        } catch (e) { if (root.wrLog) root.wrLog('sleeperProj.load', e); }
        return null;
    }

    App.SleeperProj = App.SleeperProj || { loadCurrent, targetWeek, targetSeason, _done, _withKept: withKept, _liveRows: liveRows };
})(typeof window !== 'undefined' ? window : globalThis);
