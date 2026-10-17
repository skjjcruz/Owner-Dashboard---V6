// js/shared/server-build.js — tell the engine server which Sleeper leagues a
// member uses, so it builds them ahead of time (owner go-ahead 2026-10-17,
// transition step 1; Lab, website and app since 2026-10-17). Fire and forget:
// it never throws, never waits on anything and changes nothing on screen.
// Each league is sent at most once a day per device; the server queues only
// real Sleeper leagues (server/supabase/functions/dhq-request).
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const URL = 'https://hovnqztlbsgsywrbidbh.supabase.co/functions/v1/dhq-request';
    const KEY = 'dhq_server_build_v1';
    const EVERY = 20 * 60 * 60 * 1000;

    function sentLog() {
        try { return JSON.parse(root.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function note(ids) {
        try {
            if (typeof root.fetch !== 'function') return;
            const now = Date.now(), log = sentLog();
            // Sleeper league ids only (ESPN / MFL ids carry a prefix).
            const fresh = [...new Set((ids || []).map(String).filter(id => /^\d{10,20}$/.test(id)))]
                .filter(id => !(log[id] && now - log[id] < EVERY)).slice(0, 30);
            if (!fresh.length) return;
            fresh.forEach(id => { log[id] = now; });
            Object.keys(log).forEach(id => { if (now - log[id] > 7 * EVERY) delete log[id]; });
            try { root.localStorage.setItem(KEY, JSON.stringify(log)); } catch (e) { /* storage full or off */ }
            root.fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagues: fresh }), credentials: 'omit', keepalive: true }).catch(() => {});
        } catch (e) { /* never break the app */ }
    }

    App.ServerBuild = App.ServerBuild || { note, _key: KEY };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.ServerBuild;
})(typeof window !== 'undefined' ? window : globalThis);
