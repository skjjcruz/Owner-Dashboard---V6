// js/shared/txn-store.js — per-league transaction persistence (P0-a data pipeline).
//
// Sleeper transactions are fetched per-week and, today, only for the single open league
// (window.S.transactions, set by provider.hydrate). Empire / cross-league features need
// every league's transactions without re-hydrating each one. This caches a league's
// full weekly transaction set in localStorage (keyed by league+season, TTL'd) and exposes
// readers. It is the substrate for cross-league recent-activity and (later) Owner DNA,
// which is derived from trade history.
//
// fetchLeagueTxns/getCached/recentTrades are on-demand and cheap. hydrateLeagues() does a
// background all-leagues sweep but is OPT-IN — callers (Command Bridge, DNA build) invoke
// it deliberately; it is intentionally not wired into the critical page-load path.
(function () {
    'use strict';

    const KEY = (lid, season) => 'dhq_txns_' + lid + '_' + season;
    const TTL_MS = 6 * 60 * 60 * 1000;  // 6h — transactions are append-only within a week

    function store() { return window.App && window.App.DhqStorage; }

    function ctx() {
        const ns = (window.S && window.S.nflState) || (window.App && window.App.LI && window.App.LI.nflState) || {};
        const season = String(ns.season || (window.S && window.S.currentSeason) || new Date().getFullYear());
        const week = Number(ns.display_week || ns.week || 0);
        const offseason = !ns.season_type || ns.season_type === 'off' || week <= 1;
        return { season, week, offseason };
    }

    // Sync read of the cached transaction array for a league (current season by default).
    function getCached(lid, season) {
        const st = store(); if (!st || !lid) return [];
        season = season || ctx().season;
        const c = st.get(KEY(lid, season), null);
        return (c && Array.isArray(c.txns)) ? c.txns : [];
    }

    // Fetch + persist all weekly transactions for one league/season. Returns the txn array.
    // Serves from cache when fresh (within TTL) unless opts.force.
    async function fetchLeagueTxns(lid, opts) {
        opts = opts || {};
        const st = store();
        const c = ctx();
        const season = opts.season || c.season;
        const key = KEY(lid, season);
        if (st && !opts.force) {
            const cached = st.get(key, null);
            if (cached && cached.ts && (Date.now() - cached.ts) < TTL_MS && Array.isArray(cached.txns)) {
                return cached.txns;
            }
        }
        if (typeof window.fetchTransactions !== 'function') return getCached(lid, season);
        // Offseason: scan all 18 weeks for offseason trades; in-season: up to current week.
        const maxWeek = c.offseason ? 18 : Math.min(18, c.week || 18);
        const fetches = [];
        for (let w = 0; w <= maxWeek; w++) {
            fetches.push(Promise.resolve(window.fetchTransactions(lid, w)).catch(() => []));
        }
        const results = await Promise.all(fetches);
        const txns = results.flat().filter(t => t && t.type && t.status !== 'failed');
        if (st) {
            try { st.set(key, { ts: Date.now(), season, txns }); }
            catch (e) { if (window.dhqLog) window.dhqLog('txns.cache', e); }
        }
        return txns;
    }

    // Background-populate every given league's cache (yields between leagues so a heavy
    // league can't freeze the caller; respects per-league TTL). Returns { [lid]: txns }.
    async function hydrateLeagues(leagues, opts) {
        const out = {};
        for (const l of (leagues || [])) {
            const lid = l && (l.id || l.league_id);
            if (!lid) continue;
            await new Promise(r => setTimeout(r, 0));
            try { out[lid] = await fetchLeagueTxns(lid, opts); } catch (e) { out[lid] = getCached(lid); }
        }
        return out;
    }

    // Most-recent completed trades for a league (newest first), from cache.
    function recentTrades(lid, limit) {
        return getCached(lid)
            .filter(t => t.type === 'trade')
            .sort((a, b) => (b.status_updated || b.created || 0) - (a.status_updated || a.created || 0))
            .slice(0, limit || 10);
    }

    window.WrTxns = { fetchLeagueTxns, hydrateLeagues, getCached, recentTrades };
})();
