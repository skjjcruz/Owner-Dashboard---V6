// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-rivalries.js — window.WrWireRivalries
// Personal rivalry selections ("follow these two managers") for The Wire.
// Ported from C2 (2026-09-27). Selections are OWNER pairs (Sleeper user ids),
// never roster slots, so a replacement manager never inherits a rivalry.
//
// Storage (Dynasty HQ adaptation — C2 used App.AccountStorage, which V6 does
// not have): localStorage through window.DhqStorage (quota janitor + boolean
// success), falling back to raw localStorage.
//   key  wr_wire_rivalries_v1:<scope>:<leagueId>
//   scope  'account:<Dynasty HQ user id>' when signed in, else
//          'sleeper:<Sleeper user id>' for a guest connected by username,
//          else 'guest'. So two Dynasty HQ accounts on one device never see
//          each other's picks, and a guest's picks survive the live-update
//          reload (localStorage, not React state).
//   value { version: 1, pairs: [{ owners: [a, b] (sorted), name }] } ≤ 50.
// A guest who later signs in keeps their picks: list() reads the Sleeper-
// scoped copy when the account scope has none; the next save writes the
// account-scoped key (the Sleeper copy is left as-is, never deleted).
// A renewed league (Sleeper previous_league_id chain) inherits the previous
// season's selections until it saves its own. When the league object has no
// previous_league_id key (our app's league objects), the newest earlier
// season from the Wire's linked archive is used as the predecessor.
// Exposes: list, set, remove, pairKey, scope, key.
// Tests may install root.App.AccountStorage ({ owner, get, set }) exactly as
// C2 did; when present it takes precedence.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const PREFIX = 'wr_wire_rivalries_v1:';
    const pairKey = owners => owners.map(String).sort().join(':');
    const idOf = league => String(league?.league_id || league?.id || '');

    function accountId() {
        try { const id = root.OD?.getCurrentUserId?.(); return id ? String(id) : ''; } catch (_) { return ''; }
    }
    function sleeperId() {
        try { const id = root.S?.myUserId; return id != null && id !== '' ? String(id) : ''; } catch (_) { return ''; }
    }
    // Private-preference scope for the person using this device right now.
    function scope() {
        const custom = root.App?.AccountStorage?.owner?.();
        if (custom) return String(custom);
        const account = accountId();
        if (account) return 'account:' + account;
        const sleeper = sleeperId();
        return sleeper ? 'sleeper:' + sleeper : 'guest';
    }
    const key = (league, forScope) => PREFIX + (forScope || scope()) + ':' + encodeURIComponent(idOf(league));

    function readRaw(storageKey) {
        const custom = root.App?.AccountStorage;
        if (custom?.get) return custom.get(storageKey, null);
        try {
            if (root.DhqStorage?.get) return root.DhqStorage.get(storageKey, null);
            const raw = root.localStorage?.getItem(storageKey);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }
    function writeRaw(storageKey, value) {
        const custom = root.App?.AccountStorage;
        if (custom?.set) return custom.set(storageKey, value) === true;
        try {
            if (root.DhqStorage?.set) return root.DhqStorage.set(storageKey, value) === true;
            root.localStorage.setItem(storageKey, JSON.stringify(value));
            return true;
        } catch (_) { return false; }
    }
    // The stored selection for one league id: this scope first, then (for a
    // signed-in account with nothing saved yet) the same person's guest copy.
    function readSaved(league) {
        const saved = readRaw(key(league));
        if (saved) return saved;
        if (root.App?.AccountStorage?.get) return null;
        const sleeper = sleeperId();
        if (accountId() && sleeper) return readRaw(key(league, 'sleeper:' + sleeper));
        return null;
    }

    function clean(rows) {
        if (!Array.isArray(rows)) return [];
        const seen = new Set();
        return rows.filter(r => r && Array.isArray(r.owners) && r.owners.length === 2 && r.owners.every(o => typeof o === 'string' && o.length > 0) && r.owners[0] !== r.owners[1])
            .map(r => ({ owners: r.owners.slice().sort(), name: typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '' }))
            .filter(r => { const id = pairKey(r.owners); if (seen.has(id)) return false; seen.add(id); return true; }).slice(0, 50);
    }
    function list(league, priorSeasons = []) {
        if (!idOf(league)) return [];
        // Only follow provider-linked season IDs, never matching league names.
        const linked = new Map((priorSeasons || []).map(s => [String(s.league.league_id || s.league.id), s.league]));
        let current = league;
        const seen = new Set();
        while (current && !seen.has(idOf(current))) {
            seen.add(idOf(current));
            const saved = readSaved(current);
            if (saved?.version === 1 && Array.isArray(saved.pairs)) return clean(saved.pairs);
            let previous = current.previous_league_id;
            // Dynasty HQ league objects don't carry previous_league_id (app.js
            // builds them from the user's league list). The archive's seasons
            // ARE the provider-linked chain, so the newest earlier one is this
            // league's predecessor (review S2).
            if (current === league && !Object.prototype.hasOwnProperty.call(league, 'previous_league_id')) {
                const year = Number(league.season);
                const earlier = (priorSeasons || []).map(s => s.league).filter(l => l && (!year || Number(l.season) < year)).sort((a, b) => Number(b.season) - Number(a.season))[0];
                previous = earlier ? (earlier.league_id || earlier.id) : null;
            }
            current = previous ? linked.get(String(previous)) || (seen.has(String(previous)) ? null : { league_id: previous }) : null;
        }
        return [];
    }
    function save(league, pairs) {
        if (!idOf(league)) throw Error('Choose a league first.');
        const value = { version: 1, pairs: clean(pairs) };
        if (writeRaw(key(league), value) !== true) throw Error('Your rivalries could not be saved. Check that browser storage is available on this device, then try again.');
        try { root.dispatchEvent?.(new root.CustomEvent('wr:wire-rivalries-changed')); } catch (_) { /* event API unavailable — the save still succeeded */ }
        return value.pairs;
    }
    function set(league, owners, name, priorSeasons = []) {
        const eligible = new Set((league.rosters || []).map(r => String(r.owner_id || '')).filter(Boolean));
        if (!Array.isArray(owners) || owners.length !== 2 || owners.some(o => !eligible.has(String(o))) || String(owners[0]) === String(owners[1])) throw Error('Choose two different teams with current managers.');
        const id = pairKey(owners), rows = list(league, priorSeasons).filter(r => pairKey(r.owners) !== id);
        if (rows.length >= 50) throw Error('Remove a rivalry before adding another.');
        return save(league, rows.concat({ owners: owners.map(String), name }));
    }
    const remove = (league, owners, priorSeasons = []) => save(league, list(league, priorSeasons).filter(r => pairKey(r.owners) !== pairKey(owners)));
    root.WrWireRivalries = { list, set, remove, pairKey, scope, key };
})(typeof window !== 'undefined' ? window : globalThis);
