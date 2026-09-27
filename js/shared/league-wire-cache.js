// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-cache.js — window.WrWireArchiveCache
// The Wire's on-device archive of COMPLETED Sleeper seasons (ported from C2,
// 2026-09-27). Completed seasons are public historical evidence: keep them on
// this device so a return visit re-reads no historical endpoints. Active-season
// scores are never persisted here (write() refuses anything not 'complete').
// IndexedDB database 'wr-wire-archive' (store 'seasons', keyPath 'id'); no
// other Dynasty HQ store uses that name ('warroom', 'dhq_blob_store',
// 'reconai-sleeper', 'reconai-mfl' are the others). Bounded to 100 seasons.
// Storage denial (private mode, blocked site data, quota, a stalled open) is
// non-fatal: read() resolves null, write() resolves false, and the Wire simply
// fetches from Sleeper again. A failed open is retried after 60s. v2 adds a
// savedAt index (pruning walks only the oldest keys) and stores each season's
// winners_bracket for championship history.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    let opening = null, retryAt = 0;
    const MAX = 100;
    function database() {
        let idb = null;
        try { idb = root.indexedDB; } catch (_) { idb = null; } // property access throws in some sandboxes
        if (!idb) return Promise.resolve(null);
        if (opening) return opening;
        // A failed/stalled open is retried after a minute instead of disabling
        // the archive for the whole session (review nit).
        if (Date.now() < retryAt) return Promise.resolve(null);
        let failed = false, attempt = null;
        attempt = new Promise(resolve => {
            let done = false;
            const finish = db => {
                if (done) { db?.close(); return; }
                done = true; clearTimeout(timer);
                if (!db) { retryAt = Date.now() + 60000; failed = true; if (attempt && opening === attempt) opening = null; }
                resolve(db);
            };
            const timer = setTimeout(() => finish(null), 1500);
            try {
                // v2 adds a savedAt index so pruning never reads the whole store.
                const request = idb.open('wr-wire-archive', 2);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    const store = db.objectStoreNames.contains('seasons') ? request.transaction.objectStore('seasons') : db.createObjectStore('seasons', { keyPath: 'id' });
                    if (!store.indexNames.contains('savedAt')) store.createIndex('savedAt', 'savedAt');
                };
                request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = null; }; finish(request.result); };
                request.onerror = request.onblocked = () => finish(null);
            } catch (_) { finish(null); }
        });
        if (!failed) opening = attempt;
        return attempt;
    }
    async function read(id) {
        const db = await database();
        if (!db) return null;
        return new Promise(resolve => {
            try {
                const tx = db.transaction('seasons');
                tx.onabort = () => resolve(null);
                const request = tx.objectStore('seasons').get(String(id));
                request.onsuccess = () => resolve(request.result?.version === 1 ? request.result.season : null);
                request.onerror = () => resolve(null);
            } catch (_) { resolve(null); }
        });
    }
    function compact(season) {
        const league = season.league;
        return { league: { ...league,
            rosters: league.rosters.map(r => ({ roster_id: r.roster_id, owner_id: r.owner_id })),
            users: league.users.map(u => ({ user_id: u.user_id, display_name: u.display_name, username: u.username, avatar: u.avatar, metadata: { team_name: u.metadata?.team_name } })),
        }, ...(Array.isArray(season.bracket) ? { bracket: season.bracket.map(b => ({ r: b.r, m: b.m, t1: b.t1 ?? null, t2: b.t2 ?? null, w: b.w ?? null, l: b.l ?? null, p: b.p ?? null })) } : {}),
        weeks: season.weeks.map(w => ({ week: w.week, rows: w.rows.map(r => ({ roster_id: r.roster_id, matchup_id: r.matchup_id, points: r.points, custom_points: r.custom_points,
            starters: r.starters || [], players_points: Object.fromEntries((r.starters || []).filter(pid => typeof r.players_points?.[pid] === 'number').map(pid => [pid, r.players_points[pid]])),
        })) })) };
    }
    async function write(season) {
        if (season?.league?.status !== 'complete') return false;
        const db = await database();
        if (!db) return false;
        return new Promise(resolve => {
            try {
                const tx = db.transaction('seasons', 'readwrite'), store = tx.objectStore('seasons');
                store.put({ id: String(season.league.league_id), version: 1, savedAt: Date.now(), season: compact(season) });
                // A bounded device cache (old entries can always be fetched
                // again): count, then walk only the oldest keys via the index.
                const counting = store.count();
                counting.onsuccess = () => {
                    let excess = counting.result - MAX;
                    if (excess <= 0 || !store.indexNames?.contains?.('savedAt')) return;
                    const cursor = store.index('savedAt').openCursor();
                    cursor.onsuccess = () => { const c = cursor.result; if (!c || excess-- <= 0) return; c.delete(); c.continue(); };
                };
                tx.oncomplete = () => resolve(true);
                tx.onerror = tx.onabort = () => resolve(false);
            } catch (_) { resolve(false); }
        });
    }
    root.WrWireArchiveCache = { read, write };
})(typeof window !== 'undefined' ? window : globalThis);
