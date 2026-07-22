// js/shared/sync-manager.js — window.WR.Sync — central stale-while-revalidate manager.
//
// League data (rosters, matchups, transactions, NFL state) was fetched exactly once
// per league-open and rendered forever; the only "refresh" was the sidebar button or
// a full page reload. WR.Sync owns the revalidation POLICY: it decides WHEN to sync
// (tab return, focus, in-season interval) and delegates HOW to a revalidator that the
// league surface registers (league-detail wires provider.hydrate() → applyHydrated).
//
// Triggers:
//   - visibilitychange→visible / window focus, only when stale(), throttled to 1/30s
//     (same pattern as dhq-shared/strategy.js's focus sync, wider throttle)
//   - a 10-min interval, only while the tab is visible AND the league is in-season
//     (offseason data moves slowly — focus revalidation alone covers it)
//   - explicit refresh(reason) calls (manual button, draft-complete, etc.) bypass
//     the stale() gate but never overlap: refresh() no-ops while a sync is running.
//
// With no revalidator registered (hub view, league closed) everything no-ops and
// lastSyncedAt stays null. Each successful sync dispatches
// CustomEvent('wr:data-synced', {detail:{leagueId, reason, at}}) — same window-event
// convention as wr:gm-mode-changed / wr:weekly-points-loaded.
(function () {
    'use strict';

    const STALE_MS = 5 * 60 * 1000;          // league data is stale after 5 min
    const TRIGGER_THROTTLE_MS = 30 * 1000;   // focus+visibility fire together on tab return — collapse to one sync
    const INTERVAL_MS = 10 * 60 * 1000;      // in-season background tick

    let _revalidator = null;   // async (reason) => void — registered by the league surface
    let _lastSyncedAt = null;  // ms epoch of last successful sync; null = no league data loaded
    let _isSyncing = false;
    let _lastTriggerAt = 0;    // shared throttle for focus/visibility triggers
    const _listeners = [];

    function stale() {
        return _lastSyncedAt === null || (Date.now() - _lastSyncedAt) >= STALE_MS;
    }

    function inSeason() {
        // Prefer the league-skin phase contract; fall back to raw NFL state.
        const skin = window.App?.LeagueSkin?.getCurrent?.();
        if (skin?.phase && skin.phase !== 'unknown') return skin.phase === 'in_season';
        return window.S?.nflState?.season_type === 'regular';
    }

    async function refresh(reason) {
        if (_isSyncing) return;                          // never overlap syncs
        if (typeof _revalidator !== 'function') return;  // no league open — nothing to sync
        _isSyncing = true;
        const why = reason || 'manual';
        try {
            await _revalidator(why);
            _lastSyncedAt = Date.now();
            const detail = { leagueId: window.S?.currentLeagueId || null, reason: why, at: _lastSyncedAt };
            _listeners.forEach(fn => { try { fn(detail); } catch (e) { window.wrLog?.('sync.listener', e); } });
            window.dispatchEvent(new CustomEvent('wr:data-synced', { detail }));
        } catch (e) {
            // Failed sync: keep the old lastSyncedAt so the staleness readout stays honest.
            window.wrLog?.('sync.refresh:' + why, e);
        } finally {
            _isSyncing = false;
        }
    }

    // Subscribe to successful syncs. Returns an unsubscribe fn.
    function onSync(fn) {
        if (typeof fn !== 'function') return () => {};
        _listeners.push(fn);
        return () => {
            const i = _listeners.indexOf(fn);
            if (i >= 0) _listeners.splice(i, 1);
        };
    }

    // The league surface registers its background re-hydrator here after a full
    // load (so registration time == last full sync), and unregisters with null
    // on league close — which resets lastSyncedAt: no league, no data age.
    function registerRevalidator(fn) {
        _revalidator = typeof fn === 'function' ? fn : null;
        _lastSyncedAt = _revalidator ? Date.now() : null;
    }

    function _onReturnTrigger(reason) {
        const now = Date.now();
        if (now - _lastTriggerAt < TRIGGER_THROTTLE_MS) return;
        if (!stale()) return;
        _lastTriggerAt = now;
        refresh(reason);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') _onReturnTrigger('visibility');
    });
    window.addEventListener('focus', () => _onReturnTrigger('focus'));

    // Hidden-tab ticks are skipped — the visibility trigger catches up on return.
    setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (!inSeason()) return;
        if (!stale()) return;
        refresh('interval');
    }, INTERVAL_MS);

    window.WR = window.WR || {};
    window.WR.Sync = {
        STALE_MS,
        get lastSyncedAt() { return _lastSyncedAt; },
        get isSyncing() { return _isSyncing; },
        stale,
        refresh,
        onSync,
        registerRevalidator,
    };
})();
