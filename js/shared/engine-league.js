// ══════════════════════════════════════════════════════════════════
// js/shared/engine-league.js — window.App.EngineLeague (Lab)
//
// Engine move, step 2 (owner go-ahead 2026-10-13): the server builds every
// Sleeper league a member opens, not just the leagues connected to a
// member's AI. This tells the engine project (dhq-league) which league is
// open: the public Sleeper league id and nothing else. Once a day per
// league per device is enough to keep it on the server's build list; the
// server builds a newly seen league within about 15 minutes.
//
//   App.EngineLeague.status(leagueId) → Promise<{ status, built_at } | null>
//
// Never throws and never blocks the page: a failed call is simply retried
// the next day.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const URL_BASE = 'https://hovnqztlbsgsywrbidbh.supabase.co/functions/v1/dhq-league';
    const STAMP_KEY = 'dhq_engine_league_seen_v1';
    const DAY = 24 * 3600 * 1000;
    const isSleeperId = id => /^\d{8,24}$/.test(String(id || ''));

    function stamps() { try { return JSON.parse(root.localStorage.getItem(STAMP_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function stamp(id) {
        try {
            const s = stamps(); s[id] = Date.now();
            Object.keys(s).forEach(k => { if (Date.now() - s[k] > 30 * DAY) delete s[k]; });
            root.localStorage.setItem(STAMP_KEY, JSON.stringify(s));
        } catch (e) { /* storage blocked: it just reports again next time */ }
    }

    async function status(leagueId) {
        if (!isSleeperId(leagueId) || typeof root.fetch !== 'function') return null;
        try {
            const r = await root.fetch(URL_BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ league_id: String(leagueId), platform: 'sleeper' }) });
            if (!r.ok) return null;
            const j = await r.json();
            stamp(String(leagueId));
            return j;
        } catch (e) { return null; }
    }

    // Watch the open league; report each Sleeper league once a day.
    let last = null;
    function check() {
        const S = root.S || {};
        const id = S.currentLeagueId ? String(S.currentLeagueId) : null;
        if (!id || id === last) return;
        last = id;
        if (!isSleeperId(id)) return;
        const seen = stamps()[id];
        if (seen && Date.now() - seen < DAY) return;
        status(id);
    }
    if (root.setInterval && root.document) {
        root.setTimeout(check, 8000);
        root.setInterval(check, 20000);
    }

    App.EngineLeague = App.EngineLeague || { status, _check: check };
})(typeof window !== 'undefined' ? window : globalThis);
