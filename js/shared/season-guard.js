// js/shared/season-guard.js — automatic season-rollover cache hygiene.
//
// 2026-08-06 incident: Sleeper flipped to the 2026 league season and devices
// carrying the previous season's cached league data (intel, history, power
// pins, transactions, players blob) served surfaces a mixed old/new snapshot —
// the Intel Brief and league hub misbehaved until the owner manually ran
// Refresh Data. Fresh profiles were immune, which is why clean-room testing
// passed while veteran devices failed.
//
// This guard runs once per boot, off the critical path: it asks Sleeper which
// league season is current, compares against the season this device last saw,
// and on a mismatch clears exactly what the sidebar "Refresh Data" button
// clears (plus the season-scoped stores), then reloads once so every surface
// rebuilds from fresh data. Auth, profile, and preference keys are never
// touched. Any failure inside the guard is swallowed — it must never be the
// thing that breaks boot.
(function () {
    'use strict';
    var MARKER_KEY = 'dhq_season_marker_v1';
    var RELOAD_GUARD = 'dhq_season_sweep_reloaded_v1'; // sessionStorage — one reload max
    var SWEEP_PREFIXES = [
        'dhq_leagueintel_',   // cached league intelligence builds
        'dhq_hist_',          // cached league history
        'dhq_power_pin_v2:',  // pinned power-ranking snapshots (stale-season ranks)
        'dhq_txns_'           // season-keyed transaction stores (old-season rows)
    ];

    function sweepLocalStorage() {
        var doomed = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i) || '';
                for (var p = 0; p < SWEEP_PREFIXES.length; p++) {
                    if (k.indexOf(SWEEP_PREFIXES[p]) === 0) { doomed.push(k); break; }
                }
            }
            for (var d = 0; d < doomed.length; d++) localStorage.removeItem(doomed[d]);
        } catch (e) { /* storage blocked — nothing to sweep */ }
        return doomed.length;
    }

    // Delete only the cached players blob from the shared IDB kv store — the
    // rest of the 'warroom' database is left alone.
    function sweepPlayersCache() {
        try {
            if (typeof window.indexedDB === 'undefined') return;
            var req = window.indexedDB.open('warroom', 1);
            req.onsuccess = function () {
                try {
                    var db = req.result;
                    if (!db.objectStoreNames.contains('kv')) { db.close(); return; }
                    var tx = db.transaction('kv', 'readwrite');
                    tx.objectStore('kv').delete('fw_players_cache');
                    tx.oncomplete = function () { db.close(); };
                    tx.onerror = function () { db.close(); };
                } catch (e) { /* non-fatal */ }
            };
        } catch (e) { /* non-fatal */ }
    }

    function run() {
        var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = ctl ? setTimeout(function () { ctl.abort(); }, 10000) : null;
        fetch('https://api.sleeper.app/v1/state/nfl', ctl ? { signal: ctl.signal } : undefined)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (st) {
                if (timer) clearTimeout(timer);
                var season = st && st.season ? String(st.season) : '';
                if (!season) return;
                var seen = null;
                try { seen = localStorage.getItem(MARKER_KEY); } catch (e) { return; }
                if (seen === season) return;
                try { localStorage.setItem(MARKER_KEY, season); } catch (e) {}
                if (seen === null) return; // fresh device — nothing stale to sweep
                var removed = sweepLocalStorage();
                sweepPlayersCache();
                try {
                    if (!sessionStorage.getItem(RELOAD_GUARD)) {
                        sessionStorage.setItem(RELOAD_GUARD, '1');
                        window.location.reload();
                    }
                } catch (e) { /* no sessionStorage — skip the reload, sweep still done */ }
                void removed;
            })
            .catch(function () { if (timer) clearTimeout(timer); /* offline — try next boot */ });
    }

    try { run(); } catch (e) { /* the guard must never break boot */ }
})();
