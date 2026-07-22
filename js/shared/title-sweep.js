// ══════════════════════════════════════════════════════════════════
// js/shared/title-sweep.js — account-wide championship sweep
//
// The masthead titles row needs EVERY title the signed-in owner has won
// on Sleeper — including leagues they have since left, which the
// previous_league_id chain walk (league-history.js) can never reach.
// This module sweeps the account itself: for each NFL season it asks
// /user/<id>/leagues/nfl/<season> (all leagues the user was in that
// year, membership be damned), then resolves each completed league's
// champion from league.metadata.latest_league_winner_roster_id first
// and the winners bracket as fallback.
//
// Past seasons are immutable, so any season whose leagues are all
// complete is cached forever (localStorage dhq_titles_v1_<userId>);
// only the in-progress season is ever re-checked (6h TTL).
//
//   window.DhqTitleSweep.getCached(userId) -> { titles, doneSeasons }
//   window.DhqTitleSweep.sweep(userId, onUpdate) -> Promise (one at a time;
//       onUpdate fires after each season lands with the same shape)
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const SLEEPER = 'https://api.sleeper.app/v1';
    const FIRST_SEASON = 2017; // Sleeper's first NFL season
    const OPEN_TTL = 6 * 60 * 60 * 1000;
    const KEY = (uid) => 'dhq_titles_v1_' + uid;
    const PAUSE_MS = 250;
    let running = null;

    function fetchJson(url) {
        return fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    function pause(ms) { return new Promise(r => setTimeout(r, ms)); }

    // The NFL season that would still be in progress: a season isn't fully
    // decided until its playoffs end in January of the following year.
    function latestSeason() {
        const now = new Date();
        return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
    }

    function readStore(uid) {
        try {
            const raw = localStorage.getItem(KEY(uid));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch { return null; }
    }
    function writeStore(uid, store) {
        try { localStorage.setItem(KEY(uid), JSON.stringify(store)); } catch {}
    }

    function champRosterFromBracket(bracket) {
        if (!Array.isArray(bracket) || !bracket.length) return null;
        const placed = bracket.find(b => b.p === 1 && b.w != null);
        if (placed) return placed.w;
        const maxR = Math.max(...bracket.map(b => b.r || 0));
        const finals = bracket.filter(b => (b.r || 0) === maxR && b.w != null);
        return finals.length === 1 ? finals[0].w : null;
    }

    // Did this user win this (completed) league? Returns the title entry or null.
    async function checkLeague(uid, league) {
        let champRid = league?.metadata?.latest_league_winner_roster_id;
        if (champRid != null) champRid = Number(champRid);
        if (champRid == null || Number.isNaN(champRid)) {
            const bracket = await fetchJson(SLEEPER + '/league/' + league.league_id + '/winners_bracket');
            champRid = champRosterFromBracket(bracket);
        }
        if (champRid == null) return null;
        const rosters = await fetchJson(SLEEPER + '/league/' + league.league_id + '/rosters');
        const champ = Array.isArray(rosters) ? rosters.find(r => Number(r.roster_id) === Number(champRid)) : null;
        if (!champ) return null;
        const isMine = String(champ.owner_id) === String(uid) ||
            (Array.isArray(champ.co_owners) && champ.co_owners.some(c => String(c) === String(uid)));
        if (!isMine) return null;
        return { year: String(league.season), league: league.name, leagueId: league.league_id };
    }

    async function sweepSeason(uid, season, store) {
        const leagues = await fetchJson(SLEEPER + '/user/' + uid + '/leagues/nfl/' + season);
        if (!Array.isArray(leagues)) return false; // network miss — retry next sweep
        let allComplete = true;
        const found = [];
        for (const lg of leagues) {
            if (lg.status !== 'complete') { allComplete = false; continue; }
            try {
                const t = await checkLeague(uid, lg);
                if (t) found.push(t);
            } catch { allComplete = false; }
            await pause(PAUSE_MS);
        }
        store.seasons[season] = found;
        // A season only locks forever once every league in it is complete —
        // otherwise it re-sweeps on the open-season TTL.
        if (allComplete) {
            if (!store.doneSeasons.includes(String(season))) store.doneSeasons.push(String(season));
        }
        store.fetchedAt = Date.now();
        writeStore(uid, store);
        return true;
    }

    function toResult(store) {
        const titles = [];
        Object.keys(store.seasons || {}).forEach(season => {
            (store.seasons[season] || []).forEach(t => titles.push(t));
        });
        titles.sort((a, b) => Number(b.year) - Number(a.year));
        return { titles, doneSeasons: (store.doneSeasons || []).slice() };
    }

    function getCached(uid) {
        const store = readStore(uid);
        return store ? toResult(store) : { titles: [], doneSeasons: [] };
    }

    function sweep(uid, onUpdate) {
        if (!uid) return Promise.resolve(getCached(uid));
        if (running) return running;
        running = (async () => {
            const store = readStore(uid) || { seasons: {}, doneSeasons: [], fetchedAt: 0 };
            const last = latestSeason();
            const openIsFresh = store.fetchedAt && (Date.now() - store.fetchedAt < OPEN_TTL);
            for (let season = last; season >= FIRST_SEASON; season--) {
                const s = String(season);
                const locked = store.doneSeasons.includes(s);
                if (locked) continue;                       // immutable, already swept
                if (store.seasons[s] && openIsFresh) continue; // open season, fresh enough
                const ok = await sweepSeason(uid, season, store);
                if (ok && typeof onUpdate === 'function') {
                    try { onUpdate(toResult(store)); } catch {}
                }
            }
            return toResult(store);
        })().finally(() => { running = null; });
        return running;
    }

    window.DhqTitleSweep = { sweep, getCached };
})();
