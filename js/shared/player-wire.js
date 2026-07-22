// ══════════════════════════════════════════════════════════════════
// player-wire.js — the journalism layer (WR.PlayerWire)
//
// Phase 2 of the Player Summary initiative. On card open, fetch the
// player's current professionally written Rotowire paragraph from ESPN's
// public athlete-overview endpoint and hand it to the card to render
// ABOVE the DHQ Composer paragraph (Phase 1), with attribution + date.
//
// Design (the composer stays the floor — this layer only ever adds):
//   • ID resolution: Sleeper's own espn_id first; when absent, a
//     FantasyCalc crosswalk (sleeperId → espnId, cached 7 days) backfills
//     the mapping — that covers stars like Puka Nacua whose Sleeper
//     record ships without an espn_id.
//   • Caching: per-player 24h localStorage cache (the blurb updates on
//     Rotowire's cadence, not per-minute), plus a 6h negative cache so a
//     player with no coverage doesn't refetch on every open. In-flight
//     dedupe so a double-open fires one request.
//   • Fail-safe: any failure — no id, no coverage, network down, CORS
//     closed, quota-full storage — resolves to null and the card simply
//     shows the composer paragraph alone. This layer can never break a
//     card, only enrich it.
//
// Plain JS (no JSX); fetch + localStorage are injectable for the VM
// contract suite (brief-pulse pattern). Exposed as window.WR.PlayerWire.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (typeof window !== 'undefined') window.WR = window.WR || {};

    var WIRE_KEY = 'dhq_wire_v1:';            // + espnId → { ts, headline, story, published } | { ts, empty:true }
    var XWALK_STORE = 'dhq_wire_crosswalk_v1'; // { ts, map: { sleeperId: espnId }, mkt: { sleeperId: {v,t,or,pr} } }
    var WIRE_TTL = 24 * 60 * 60 * 1000;       // blurbs refresh on news cadence
    var EMPTY_TTL = 6 * 60 * 60 * 1000;       // uncovered players: retry a few times a day
    var XWALK_TTL = 24 * 60 * 60 * 1000;      // carries market values too (Phase 3) — daily refresh
    var MAX_STORY = 1400;                     // hard cap so a card never gets an essay

    var OVERVIEW_URL = function (espnId) {
        return 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/' + espnId + '/overview';
    };
    // Fixed cheap params — we only need the sleeperId→espnId columns, not values.
    var XWALK_URL = 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1';

    // ── Injectable environment (tests stub these) ────────────────────
    var env = {
        fetchJson: function (url) {
            return fetch(url, { headers: { accept: 'application/json' } })
                .then(function (r) { return r.ok ? r.json() : null; })
                .catch(function () { return null; });
        },
        store: {
            get: function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (_) { return null; } },
            set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* quota — non-fatal */ } },
        },
        now: function () { return Date.now(); },
    };

    // ── Date label: "Fri Jul 17 08:16:46 PDT 2026" → "Jul 17" ────────
    function dateLabel(published) {
        if (!published) return '';
        var m = /([A-Z][a-z]{2})\s+(\d{1,2})/.exec(String(published));
        if (m) return m[1] + ' ' + m[2];
        try {
            var d = new Date(published);
            if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch (_) { /* fall through */ }
        return '';
    }

    // ── Extract the Rotowire read from an ESPN overview payload ──────
    function extract(overview) {
        var r = overview && overview.rotowire;
        if (!r || typeof r !== 'object') return null;
        var story = String(r.story || r.description || '').trim();
        if (story.length < 80) return null;   // a real paragraph, not a fragment
        if (story.length > MAX_STORY) story = story.slice(0, MAX_STORY - 1).replace(/\s+\S*$/, '') + '…';
        return {
            story: story,
            headline: String(r.headline || '').trim(),
            published: String(r.published || '').trim(),
            dateLabel: dateLabel(r.published),
            source: 'Rotowire via ESPN',
        };
    }

    // ── espnId resolution + market data: one FantasyCalc fetch/day ───
    // The same rows carry both the sleeperId→espnId mapping (for the wire)
    // and the market read (value, 30-day trend, ranks) the composer's
    // market sentence uses. Resolves { map, mkt }.
    var _xwalkPromise = null;
    function loadCrosswalkFull() {
        var cached = env.store.get(XWALK_STORE);
        if (cached && cached.ts && (env.now() - cached.ts) < XWALK_TTL && cached.map) {
            return Promise.resolve({ map: cached.map, mkt: cached.mkt || {} });
        }
        if (_xwalkPromise) return _xwalkPromise;
        _xwalkPromise = env.fetchJson(XWALK_URL).then(function (rows) {
            _xwalkPromise = null;
            if (!Array.isArray(rows) || !rows.length) {
                return { map: (cached && cached.map) || {}, mkt: (cached && cached.mkt) || {} };
            }
            var map = {}, mkt = {};
            rows.forEach(function (row) {
                var pl = row && row.player;
                if (!pl || !pl.sleeperId) return;
                var sid = String(pl.sleeperId);
                if (pl.espnId) map[sid] = String(pl.espnId);
                mkt[sid] = {
                    v: row.value || 0,
                    t: row.trend30Day || 0,
                    or: row.overallRank || 0,
                    pr: row.positionRank || 0,
                };
            });
            env.store.set(XWALK_STORE, { ts: env.now(), map: map, mkt: mkt });
            return { map: map, mkt: mkt };
        });
        return _xwalkPromise;
    }
    function loadCrosswalk() { return loadCrosswalkFull().then(function (r) { return r.map; }); }

    // marketFor(pid) → { value, trend30Day, overallRank, positionRank } | null
    function marketFor(pid) {
        if (!pid) return Promise.resolve(null);
        return loadCrosswalkFull().then(function (r) {
            var m = r.mkt && r.mkt[String(pid)];
            if (!m || !(m.v > 0)) return null;
            return { value: m.v, trend30Day: m.t || 0, overallRank: m.or || 0, positionRank: m.pr || 0 };
        }).catch(function () { return null; });
    }

    // ── Name-search fallback (IDP gap) ───────────────────────────────
    // FantasyCalc's universe is offense-only, so defensive players whose
    // Sleeper record lacks an espn_id would never get the wire. ESPN's
    // player search (same allowlisted host) closes that: match strictly by
    // normalized full name + sport, extract the athlete id from the uid.
    // A near-match is rejected — the wrong player's news is worse than none.
    var NAME_STORE = 'dhq_wire_nameid_v1:';   // + pid → { ts, id } | { ts, none:true }
    var NAME_TTL = 7 * 24 * 60 * 60 * 1000;   // ids are static once found
    var NAME_MISS_TTL = 24 * 60 * 60 * 1000;  // misses retried daily (rookies get added)
    function _normName(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
    function searchIdByName(pid, playersData) {
        var rec = playersData && playersData[pid];
        var name = rec && (rec.full_name || ((rec.first_name || '') + ' ' + (rec.last_name || '')).trim());
        if (!name) return Promise.resolve(null);
        var key = NAME_STORE + pid;
        var cached = env.store.get(key);
        if (cached && cached.ts) {
            var age = env.now() - cached.ts;
            if (cached.id && age < NAME_TTL) return Promise.resolve(String(cached.id));
            if (cached.none && age < NAME_MISS_TTL) return Promise.resolve(null);
        }
        var url = 'https://site.web.api.espn.com/apis/search/v2?limit=5&query=' + encodeURIComponent(name);
        return env.fetchJson(url).then(function (res) {
            var id = null;
            var want = _normName(name);
            var groups = (res && res.results) || [];
            for (var i = 0; i < groups.length && !id; i++) {
                if (!groups[i] || groups[i].type !== 'player') continue;
                var items = groups[i].contents || [];
                for (var j = 0; j < items.length; j++) {
                    var it = items[j];
                    if (!it || it.sport !== 'football') continue;
                    if (_normName(it.displayName) !== want) continue;
                    var m = /~a:(\d+)/.exec(String(it.uid || ''));
                    if (m) { id = m[1]; break; }
                }
            }
            if (id) env.store.set(key, { ts: env.now(), id: id });
            else if (res) env.store.set(key, { ts: env.now(), none: true });
            // A null response (network failure) is not cached — next open retries.
            return id;
        });
    }

    function resolveEspnId(pid, playersData) {
        var rec = playersData && playersData[pid];
        var own = rec && rec.espn_id;
        if (own) return Promise.resolve(String(own));
        return loadCrosswalk().then(function (map) {
            if (map[String(pid)]) return map[String(pid)];
            return searchIdByName(pid, playersData);
        });
    }

    // ── fetchRead(pid, playersData) → Promise<read|null> ─────────────
    var _inflight = {};
    function fetchRead(pid, playersData) {
        if (!pid) return Promise.resolve(null);
        if (_inflight[pid]) return _inflight[pid];
        var p = resolveEspnId(pid, playersData).then(function (espnId) {
            if (!espnId) return null;
            var key = WIRE_KEY + espnId;
            var cached = env.store.get(key);
            if (cached && cached.ts) {
                var age = env.now() - cached.ts;
                if (cached.empty && age < EMPTY_TTL) return null;
                if (!cached.empty && age < WIRE_TTL && cached.story) {
                    return { story: cached.story, headline: cached.headline || '', published: cached.published || '', dateLabel: dateLabel(cached.published), source: 'Rotowire via ESPN' };
                }
            }
            return env.fetchJson(OVERVIEW_URL(espnId)).then(function (overview) {
                var read = overview ? extract(overview) : null;
                if (read) env.store.set(key, { ts: env.now(), story: read.story, headline: read.headline, published: read.published });
                else if (overview) env.store.set(key, { ts: env.now(), empty: true });
                // A null overview (network/CORS failure) is NOT negative-cached —
                // the next open should retry.
                return read;
            });
        }).catch(function () { return null; });
        _inflight[pid] = p.then(function (r) { delete _inflight[pid]; return r; }, function () { delete _inflight[pid]; return null; });
        return _inflight[pid];
    }

    var api = {
        fetchRead: fetchRead,
        extract: extract,
        dateLabel: dateLabel,
        loadCrosswalk: loadCrosswalk,
        marketFor: marketFor,
        _env: env,          // injectable for the contract suite
    };
    if (typeof window !== 'undefined') window.WR.PlayerWire = api;
})();
