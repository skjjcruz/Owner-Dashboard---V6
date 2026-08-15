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

    function _cacheKey(year) { return 'wr_adp_market_v2_' + year; } // v2: map now includes K/DEF

    function _readCache(year) {
        try {
            const raw = localStorage.getItem(_cacheKey(year));
            if (!raw) return null;
            const cached = JSON.parse(raw);
            if (Date.now() - (cached._ts || 0) >= CACHE_TTL_MS) return null;
            if (!cached.map || !Object.keys(cached.map).length) return null; // never serve a cached empty map
            return cached.map;
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
        // MFL pins its CORS header to its own www hosts (live-checked
        // 2026-08-15), so a direct browser fetch from our origin dies
        // silently. Route through the same mfl-proxy Edge Function the MFL
        // league importer uses (reconai-shared/mfl-api.js), resolved at call
        // time because this module loads before the supabase client. Direct
        // fetch stays as the fallback for same-origin/dev contexts.
        let data = null;
        const proxyBase = root.OD?.SUPABASE_URL || root.App?.SUPABASE_URL || null;
        const anonKey = root.OD?.SUPABASE_ANON || root.App?.SUPABASE_ANON || null;
        if (proxyBase && anonKey) {
            const token = root.OD?.getSessionToken?.() || null;
            const r = await fetch(proxyBase + '/functions/v1/mfl-proxy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + (token || anonKey),
                    'apikey': anonKey,
                },
                body: JSON.stringify({ url }),
            });
            if (!r || !r.ok) return [];
            data = await r.json();
        } else {
            const r = await fetch(url);
            if (!r || !r.ok) return [];
            data = await r.json();
        }
        const rows = data && data.adp && data.adp.player;
        if (Array.isArray(rows)) return rows;
        return rows ? [rows] : [];
    }

    async function _fetchMflDirectory(year) {
        // MFL's player directory (id -> "Last, First"/position/team) — the
        // K/DEF join needs it because FantasyCalc's bridge is offense-only,
        // so kickers and defenses could never resolve a sleeperId through it
        // (owner report 2026-08-15: the K column showed camp legs).
        const url = 'https://api.myfantasyleague.com/' + year + '/export?TYPE=players&JSON=1';
        let data = null;
        const proxyBase = root.OD?.SUPABASE_URL || root.App?.SUPABASE_URL || null;
        const anonKey = root.OD?.SUPABASE_ANON || root.App?.SUPABASE_ANON || null;
        if (proxyBase && anonKey) {
            const token = root.OD?.getSessionToken?.() || null;
            const r = await fetch(proxyBase + '/functions/v1/mfl-proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || anonKey), 'apikey': anonKey },
                body: JSON.stringify({ url }),
            });
            if (!r || !r.ok) return {};
            data = await r.json();
        } else {
            const r = await fetch(url);
            if (!r || !r.ok) return {};
            data = await r.json();
        }
        const rows = data && data.players && data.players.player;
        const arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
        const byId = {};
        arr.forEach(row => { if (row && row.id) byId[String(row.id)] = row; });
        return byId;
    }

    const MFL_TEAM_FIX = { NEP: 'NE', GBP: 'GB', KCC: 'KC', NOS: 'NO', SFO: 'SF', TBB: 'TB', LVR: 'LV', JAC: 'JAX' };
    function _normName(x) { return String(x || '').toLowerCase().replace(/[^a-z]/g, ''); }
    // Join K/DEF ADP rows to Sleeper ids by name+team / team. Needs the
    // Sleeper player DB (window.S.players), which loads after this module —
    // callers retry until it lands. Returns true once the join ran.
    function _enrichKD(map, adpRows, dirById) {
        const src = root.S && root.S.players;
        if (!src || !Object.keys(src).length) return false;
        const kIndex = {};
        Object.keys(src).forEach(sid => {
            const d = src[sid] || {};
            if (d.position === 'K') kIndex[_normName(d.last_name) + _normName(d.first_name) + '|' + (d.team || '')] = sid;
        });
        (adpRows || []).forEach(row => {
            const m = dirById[String(row && row.id)];
            if (!m) return;
            const pos = m.position;
            if (pos !== 'PK' && pos !== 'Def' && pos !== 'TMDF') return;
            if (Number(row.draftsSelectedIn) < 3) return; // single-draft flukes
            const team = MFL_TEAM_FIX[m.team] || m.team || '';
            let sid = null;
            if (pos === 'PK') {
                const parts = String(m.name || '').split(', ');
                sid = kIndex[_normName(parts[0]) + _normName(parts[1]) + '|' + team] || null;
            } else if (src[team] && src[team].position === 'DEF') {
                sid = team; // Sleeper keys team defenses by team code
            }
            const adpVal = Number(row.averagePick);
            if (sid && adpVal > 0 && !map[sid]) {
                map[sid] = { adp: adpVal, rank: Number(row.rank) || null, draftsSelectedIn: Number(row.draftsSelectedIn) || null };
            }
        });
        return true;
    }

    async function _buildAdpMap(year) {
        const [bridge, adpRows, dirById] = await Promise.all([_buildMflToSleeperBridge(), _fetchMflAdp(year), _fetchMflDirectory(year)]);
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
        // K/DEF join — immediately when the Sleeper DB is up, else retried by
        // the caller via _retryEnrichKD once it loads.
        if (!_enrichKD(map, adpRows, dirById)) {
            _pendingKD = { adpRows, dirById };
        }
        return map;
    }

    let _pendingKD = null;
    let _kdTimer = null;
    function _retryEnrichKD(year) {
        if (!_pendingKD || _kdTimer) return;
        let tries = 0;
        _kdTimer = setInterval(() => {
            tries += 1;
            if (!_pendingKD || tries > 20) { clearInterval(_kdTimer); _kdTimer = null; return; }
            if (_map && _enrichKD(_map, _pendingKD.adpRows, _pendingKD.dirById)) {
                _pendingKD = null;
                clearInterval(_kdTimer); _kdTimer = null;
                _writeCache(year, _map);
                try { root.dispatchEvent(new CustomEvent('wr:adp-loaded', { detail: { year, cached: false, kd: true } })); } catch (e) { /* headless */ }
            }
        }, 3000);
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
                // An empty map is a transient failure, not an answer — leave
                // _map unset so the next fetchRedraftAdp call retries instead
                // of pinning dashes for the whole session (the module loads
                // before the supabase client, so the eager warm-up can miss
                // the proxy and come back empty).
                if (!map || !Object.keys(map).length) return _map || {};
                _map = map;
                _year = year;
                _writeCache(year, map);
                try { root.dispatchEvent(new CustomEvent('wr:adp-loaded', { detail: { year, cached: false } })); } catch (e) { /* headless */ }
                _retryEnrichKD(year);
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
