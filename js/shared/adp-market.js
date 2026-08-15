// ══════════════════════════════════════════════════════════════════
// js/shared/adp-market.js — window.App.getRedraftAdp / fetchRedraftAdp
//
// Real market ADP (average draft position) shown ALONGSIDE DHQ on draft
// boards — a "market says / DHQ says" companion column. Display only:
// never feeds DHQ, ROS value, or any pricing calculation.
//
// Source: MFL's public ADP export (no auth needed) —
//   https://api.myfantasyleague.com/{year}/export?TYPE=adp&JSON=1
// keyed by MFL's own numeric player id.
//
// ID bridge: rather than hand-building a name/team crosswalk, we reuse
// FantasyCalc's own redraft-values response — every row already carries
// both `player.mflId` and `player.sleeperId`. A generic call is enough
// (we only read the id pair off each row, never `value`).
//
//   fetchRedraftAdp()   → Promise<{ [sleeperId]: {adp, rank, draftsSelectedIn} }>
//     Fetches + joins the map once, caches it in localStorage for ~18h
//     (inside the 12-24h band), and re-fetches on cache miss/expiry.
//     Concurrent callers share the same in-flight promise.
//   getRedraftAdp(sid)  → {adp, rank, draftsSelectedIn} | null
//     Synchronous — null until the fetch has landed, or if MFL has no
//     ADP entry for that player.
//   Fires window.dispatchEvent(new CustomEvent('wr:adp-loaded', { detail }))
//   once the map is ready — mirrors dhq-shared/player-value.js's
//   'wr:ros-market-loaded' pattern, so a mounted React draft board can
//   force a re-render when data lands after first paint.
//
// Kicked off eagerly (fire-and-forget) on script load so it is warm by
// the time a draft screen mounts — not lazily on first getter call.
//
// Scope note (enforced by callers, not this module): only redraft and
// chopped league types show this column. MFL's own IS_KEEPER=1 and
// IS_KEEPER=DYNASTY params return zero picks (live-verified 2026-08-10)
// — there is no real keeper/dynasty ADP signal anywhere today, so this
// module only ever fetches the default (redraft) export.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const CACHE_TTL_MS = 18 * 60 * 60 * 1000; // ~18h — inside the 12-24h band

    let _map = null;       // { [sleeperId]: {adp, rank, draftsSelectedIn} } once loaded
    let _year = null;      // year the current _map/_fetching promise is for
    let _fetching = null;  // in-flight promise, de-dupes concurrent callers

    // Same precedence the rest of the app uses to derive the active MFL
    // season (see league-skin.js buildLeagueProfile / draft-room.js /
    // league-detail.js): active league's own season first, then the global
    // window.S.season, then the locally-stored MFL connection year, then a
    // clock fallback. Never hardcoded.
    function _currentYear() {
        try {
            return String(
                root.S?.currentLeague?.season
                || root.S?.season
                || (root.localStorage && root.localStorage.getItem('mfl_year'))
                || new Date().getFullYear()
            );
        } catch (e) {
            return String(new Date().getFullYear());
        }
    }

    function _cacheKey(year) { return 'wr_adp_market_' + year; }

    function _readCache(year) {
        try {
            const raw = localStorage.getItem(_cacheKey(year));
            if (!raw) return null;
            const cached = JSON.parse(raw);
            if (Date.now() - (cached._ts || 0) >= CACHE_TTL_MS) return null;
            return cached.map || null;
        } catch (e) {
            return null;
        }
    }

    function _writeCache(year, map) {
        try {
            // Skip caching empty results — an empty map is far more likely a
            // transient fetch hiccup than "no ADP data exists"; caching it
            // would poison the cache for the full TTL window (mirrors the
            // same guard in dhq-shared/mfl-api.js buildCrosswalk).
            if (!map || !Object.keys(map).length) return;
            localStorage.setItem(_cacheKey(year), JSON.stringify({ map, _ts: Date.now() }));
        } catch (e) {}
    }

    // FantasyCalc redraft values give us a clean mflId -> sleeperId bridge
    // for free — every row carries both ids. This call is only for the id
    // bridge, not for values, so a generic shape (numQbs/numTeams/ppr) is
    // fine; it does not need to match any particular league's settings.
    async function _buildMflToSleeperBridge() {
        const url = 'https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1';
        const r = await fetch(url);
        if (!r || !r.ok) return {};
        const rows = await r.json();
        const bridge = {};
        (Array.isArray(rows) ? rows : []).forEach(d => {
            const mflId = d && d.player && d.player.mflId;
            const sid = d && d.player && d.player.sleeperId;
            if (mflId && sid) bridge[String(mflId)] = String(sid);
        });
        return bridge;
    }

    async function _fetchMflAdp(year) {
        const url = 'https://api.myfantasyleague.com/' + year + '/export?TYPE=adp&JSON=1';
        const r = await fetch(url);
        if (!r || !r.ok) return [];
        const data = await r.json();
        const rows = data && data.adp && data.adp.player;
        if (Array.isArray(rows)) return rows;
        return rows ? [rows] : [];
    }

    async function _buildAdpMap(year) {
        const [bridge, adpRows] = await Promise.all([_buildMflToSleeperBridge(), _fetchMflAdp(year)]);
        const map = {};
        adpRows.forEach(row => {
            const mflId = row && row.id;
            const sid = mflId != null ? bridge[String(mflId)] : null;
            if (!sid) return;
            const adp = Number(row.averagePick);
            if (!(adp > 0)) return;
            map[sid] = {
                adp,
                rank: Number(row.rank) || null,
                draftsSelectedIn: Number(row.draftsSelectedIn) || null,
            };
        });
        return map;
    }

    async function fetchRedraftAdp() {
        const year = _currentYear();

        if (_map && _year === year) return _map;
        if (_fetching && _year === year) return _fetching;

        const cached = _readCache(year);
        if (cached) {
            _map = cached;
            _year = year;
            try { root.dispatchEvent(new CustomEvent('wr:adp-loaded', { detail: { year, cached: true } })); } catch (e) { /* headless */ }
            return _map;
        }

        _year = year;
        _fetching = _buildAdpMap(year)
            .then(map => {
                _map = map;
                _year = year;
                _writeCache(year, map);
                try { root.dispatchEvent(new CustomEvent('wr:adp-loaded', { detail: { year, cached: false } })); } catch (e) { /* headless */ }
                return map;
            })
            .catch(() => {
                // Leave _map as-is (null or a prior year's map) so getRedraftAdp
                // fails closed to "not loaded" rather than caching a failure.
                return _map || {};
            })
            .finally(() => { _fetching = null; });
        return _fetching;
    }

    // Synchronous getter for React render paths — never blocks, never
    // triggers a fetch itself. Returns null until the map has landed, or
    // when MFL simply has no ADP entry for this player.
    function getRedraftAdp(sid) {
        if (!_map || sid == null) return null;
        return _map[String(sid)] || null;
    }

    App.fetchRedraftAdp = fetchRedraftAdp;
    App.getRedraftAdp = getRedraftAdp;

    // Warm the cache eagerly (fire-and-forget) so it's ready by the time a
    // draft screen mounts, rather than lazily on first getter call. Guarded
    // to real browser contexts so a Node `require()` of this module (e.g.
    // future unit tests) never fires a live network call as a side effect.
    if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        fetchRedraftAdp().catch(() => {});
    }

    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = { fetchRedraftAdp, getRedraftAdp };
})(typeof window !== 'undefined' ? window : globalThis);
