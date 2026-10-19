// js/shared/server-intel.js — open a league with the engine server's build
// instead of computing it on the device (transition step 3, owner go-ahead
// 2026-10-19; Lab only for now). The server builds every member's league
// hourly (every 15 minutes in game windows) with the same engine files, and
// its values match the device's (3,894 of 3,894 players, 2026-10-19).
//
// It wraps App.loadLeagueIntel: a valid device cache still wins (unchanged),
// then the server's build is tried, then the device computes as it always
// has. The server copy is used only when it is this league and season,
// recent enough (the same 2h in season / 8h offseason the device cache
// allows) and covers the league's rosters; anything else, a slow answer or
// a failed fetch falls through to the device. Only league values and
// history come from here: projections, lineups, injuries and live points are
// still read live from Sleeper on the device.
//
// Off switch for one device: localStorage dhq_server_li_off = '1'.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const URL = 'https://hovnqztlbsgsywrbidbh.supabase.co/functions/v1/dhq-league?league=';
    const TIMEOUT = 8000;
    const TTL_IN_SEASON = 2 * 60 * 60 * 1000, TTL = 8 * 60 * 60 * 1000;

    function off() { try { return root.localStorage.getItem('dhq_server_li_off') === '1'; } catch (e) { return false; } }
    function state() { return App.S || root.S || null; }

    // The same pick-value curve a fresh build attaches (dhq-engine.js STEP 7):
    // functions don't travel, so it is rebuilt from the league's slot values.
    function pickValueFn(dhqPickValues, totalTeams, curYear) {
        return (season, round, pickInRound) => {
            const yr = parseInt(season) || curYear;
            const pick = (round - 1) * totalTeams + Math.min(pickInRound || Math.ceil(totalTeams / 2), totalTeams);
            const base = dhqPickValues[pick]?.value || dhqPickValues[pick - 1]?.value || dhqPickValues[pick + 1]?.value || 0;
            return Math.round(base * Math.pow(0.88, Math.max(0, yr - curYear)));
        };
    }

    // Why a server build can't stand in for the device's, or '' when it can.
    function reject(body, S, now) {
        const lid = String(S.currentLeagueId || '');
        if (!body || typeof body !== 'object') return 'no body';
        if (String(body.league_id) !== lid) return 'other league';
        if (String(body.season || '') !== String(S.season || '')) return 'season ' + body.season + ' vs ' + S.season;
        if (!/^headless-/.test(String(body.engine_version || ''))) return 'engine ' + body.engine_version;
        const age = now - Date.parse(body.built_at);
        const ttl = S.nflState?.season_type === 'regular' ? TTL_IN_SEASON : TTL;
        if (!(age >= -5 * 60 * 1000 && age < ttl)) return 'built ' + Math.round(age / 60000) + ' min ago';
        const I = body.intel;
        if (!I || typeof I !== 'object' || !I.playerScores || !I.playerMeta || !I.dhqPickValues) return 'incomplete';
        if (Object.keys(I.playerScores).length < 100) return 'too few players';
        // Built with the incoming rookie class, as a device values rookies
        // (server builds before 2026-10-19 lacked it: 97 young players differed).
        if (!(Number(I.rookieProspects) > 0)) return 'no rookie class';
        // The engine leaves deep-bench rookies and backups unvalued on the
        // device too (22 of 867 rostered in the Psycho league), so only a build
        // missing a quarter of the league's rostered players is refused.
        const rostered = [...new Set((S.rosters || []).flatMap(r => (r.players || []).map(String)))];
        const missing = rostered.filter(pid => !(pid in I.playerScores));
        if (rostered.length && missing.length > rostered.length * 0.25) return missing.length + ' of ' + rostered.length + ' rostered players missing';
        return '';
    }

    let pending = null;
    async function fromServer() {
        const S = state();
        const lid = String(S?.currentLeagueId || '');
        if (!S || !/^\d{10,20}$/.test(lid) || !(S.rosters || []).length) return false;   // Sleeper leagues only
        const t0 = Date.now();
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT) : null;
        let body;
        try {
            const r = await root.fetch(URL + lid, { credentials: 'omit', signal: ctl ? ctl.signal : undefined });
            if (!r.ok) { console.log('[ServerIntel] league not built on the server (' + r.status + '); computing on device'); return false; }
            body = await r.json();
        } finally { if (timer) clearTimeout(timer); }
        const S2 = state();
        if (!S2 || String(S2.currentLeagueId) !== lid || App.LI_LOADED) return false;   // moved on, or loaded meanwhile
        const why = reject(body, S2, Date.now());
        if (why) { console.log('[ServerIntel] server build not used (' + why + '); computing on device'); return false; }
        const LI = body.intel;
        LI.dhqPickValueFn = pickValueFn(LI.dhqPickValues, S2.rosters.length || 16, parseInt(S2.season) || new Date().getFullYear());
        App.LI = LI;
        App.LI_LOADED = true;
        App.LI_SOURCE = { source: 'server', built_at: body.built_at, ms: Date.now() - t0 };
        console.log('[ServerIntel] LeagueIntel loaded from the server: ' + Object.keys(LI.playerScores).length + ' players, built ' + Math.round((Date.now() - Date.parse(body.built_at)) / 60000) + ' min ago, ' + (Date.now() - t0) + ' ms');
        // As a fresh build does: tell the app, then run the assessment brain.
        setTimeout(() => { try { if (root.DhqEvents) root.DhqEvents.emit('li:loaded', { source: 'server' }); } catch (e) { /* no-op */ } }, 0);
        if (typeof App.computeOneBrain === 'function') App.computeOneBrain(S2).catch(e => root.dhqLog?.('oneBrain', e));
        return true;
    }

    function wrap(orig) {
        if (typeof orig !== 'function' || orig.__serverIntel) return orig;
        const wrapped = async function () {
            if (App.LI_LOADED) return;
            if (off() || root._liLoading || typeof root.fetch !== 'function') return orig.apply(this, arguments);
            // The device's own cache first, exactly as before.
            try { if (typeof App.loadLICache === 'function' && await App.loadLICache()) return; } catch (e) { /* fall through */ }
            if (App.LI_LOADED) return;
            if (!pending) pending = fromServer().catch(e => { console.log('[ServerIntel] ' + (e && e.name === 'AbortError' ? 'server slow' : 'server unavailable') + '; computing on device'); return false; }).finally(() => { pending = null; });
            if (await pending) return;
            if (App.LI_LOADED) return;
            return orig.apply(this, arguments);
        };
        wrapped.__serverIntel = true;
        wrapped.__orig = orig;
        return wrapped;
    }

    // dhq-engine.js may load before or after this file: whichever way, the
    // function it publishes is the wrapped one.
    let current = wrap(App.loadLeagueIntel);
    try {
        Object.defineProperty(App, 'loadLeagueIntel', {
            configurable: true, enumerable: true,
            get() { return current; },
            set(fn) { current = wrap(fn); },
        });
    } catch (e) { /* App frozen: the device path stays as it was */ }

    App.ServerIntel = { _reject: reject, _pickValueFn: pickValueFn, _fromServer: fromServer, _wrap: wrap };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.ServerIntel;
})(typeof window !== 'undefined' ? window : globalThis);
