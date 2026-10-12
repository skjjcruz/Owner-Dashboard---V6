// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-calendar.js — window.WrWireCalendar
// "The edition publishes when the NFL week is finished." Ported from C2
// (1be683d) and merged with our own rollover (5e0fa14).
//
// Two independent signals say a fantasy week is over:
//   1. Sleeper's league.settings.last_scored_leg (ours, 5e0fa14) — Sleeper
//      marks the week scored, usually Tuesday or Wednesday.
//   2. Every NFL game of Sleeper's display week is final (C2) — Monday
//      night, minutes after the last whistle. Checked with OUR ESPN-direct
//      scoreboard (WrWireNfl.loadWeek → loadScoreboard, shared cache) and
//      C2's strict raw-response check. The relay can be hours old, so a relay
//      copy never counts as final.
// The Wire uses the LATER of the two (rolloverWeek + settledWeek). Until
// Sleeper's own calendar rolls, an early edition is "provisional": the page
// says all NFL games are final but stat corrections can still change scores.
// Nothing here changes the NFL week used by lineups, waivers or projections.
//
//   load({ signal, force }) → { nfl, completedWeek, provisional, checkedAt,
//     scoreboardUnavailable? }   (C2's API; reads /state/nfl fresh)
//   period(league, calendarOrNfl) → { start, end, week, live, provisional }
//     (C2's API; needs WrWireStories.bounds)
//   rolloverWeek(league, calendar) → the week the Wire may treat as "this
//     week" from signal 2, or 0 when it gives no advance (Dynasty HQ).
// A scoreboard outage keeps a completion already verified for that week
// (with its original check time) and otherwise falls back to the provider's
// cutoff; new contradictory evidence revokes it.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const verified = new WeakMap();
    const canceled = signal => {
        if (signal?.aborted) { const error = Error('Request canceled.'); error.name = 'AbortError'; throw error; }
    };
    // One stable default so the remembered-completion cache (keyed by
    // fetcher) survives between calls.
    const defaultFetch = (...args) => root.fetch(...args);
    const providerWeek = nfl => Math.max(1, Math.min(18, Number(nfl.display_week || nfl.week) || 1));
    async function loadState(signal, fetcher) {
        canceled(signal);
        const controller = new root.AbortController();
        let timedOut = false;
        const cancel = () => controller.abort();
        signal?.addEventListener?.('abort', cancel, { once: true });
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 18000);
        try {
            const response = await fetcher('https://api.sleeper.app/v1/state/nfl', { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
            canceled(signal);
            if (!response.ok) throw Error('The league calendar could not load.');
            const nfl = await response.json();
            canceled(signal);
            if (timedOut) throw Error('The league calendar took too long to load.');
            return nfl;
        } catch (error) {
            canceled(signal);
            if (timedOut) throw Error('The league calendar took too long to load.');
            throw error;
        } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', cancel); }
    }
    async function load({ signal, force = false, fetcher = defaultFetch, now = Date.now } = {}) {
        const nfl = await loadState(signal, fetcher);
        const week = Number(nfl?.display_week || nfl?.week);
        if (!/^\d{4}$/.test(String(nfl?.season || '')) || !['pre', 'regular', 'post', 'off'].includes(nfl?.season_type) || (nfl.season_type === 'regular' && (!Number.isInteger(week) || week < 1 || week > 18))) throw Error('The league calendar could not be verified.');
        let checkedAt = now(), scoreboardUnavailable = false;
        let completedWeek = nfl.season_type === 'regular' ? week - 1 : 0, provisional = false;
        if (nfl.season_type === 'regular' && root.WrWireNfl?.loadWeek) {
            if (!verified.has(fetcher)) verified.set(fetcher, new Map());
            const cache = verified.get(fetcher), key = `${nfl.season}|regular|${week}`;
            try {
                const scores = await root.WrWireNfl.loadWeek({ phase: { season: nfl.season, week, seasontype: 2 }, signal, force, fetcher, now });
                canceled(signal);
                if (scores.completionVerified === true) {
                    completedWeek = week; provisional = true;
                    if (Number.isFinite(scores.checkedAt)) checkedAt = Math.min(checkedAt, scores.checkedAt);
                    cache.set(key, { completedWeek, checkedAt });
                    while (cache.size > 8) cache.delete(cache.keys().next().value);
                } else cache.delete(key); // New contradictory evidence supersedes an earlier final.
            } catch (error) {
                canceled(signal); if (error?.name === 'AbortError') throw error;
                scoreboardUnavailable = true;
                const prior = cache.get(key);
                if (prior) { completedWeek = prior.completedWeek; provisional = true; checkedAt = prior.checkedAt; }
            }
        }
        return { nfl, completedWeek, provisional, checkedAt, ...(scoreboardUnavailable ? { scoreboardUnavailable: true } : {}) };
    }
    function period(league, calendarOrNfl = {}) {
        const calendar = calendarOrNfl?.nfl ? calendarOrNfl : null, nfl = calendar?.nfl || calendarOrNfl;
        const range = root.WrWireStories.bounds(league);
        if (Number(nfl.season) > 0 && Number(league.season) > Number(nfl.season)) return { start: range.start, end: range.start - 1, week: range.start, live: false, provisional: false };
        const historical = Number(league.season) < Number(nfl.season);
        const sameSeason = String(league.season) === String(nfl.season);
        const postseason = sameSeason && nfl.season_type === 'post';
        const current = providerWeek(nfl);
        const advance = sameSeason && nfl.season_type === 'regular' && calendar?.provisional === true && Number(calendar.completedWeek) === current;
        const week = historical || postseason ? range.end + 1 : nfl.season_type === 'regular' ? current + (advance ? 1 : 0) : 1;
        return { start: range.start, end: Math.min(range.end, week - 1), week, live: !historical && !postseason && sameSeason,
            provisional: !!advance && current >= range.start && current <= range.end };
    }
    // Dynasty HQ: signal 2 as a plain week number for our existing rollover
    // (App.LeagueLiveScores.settledWeek). The Wire takes max(settled, this).
    // Only for the league's own season, in the regular season, when the
    // display week itself was verified final. Playoff weeks roll the same way
    // (the board shows them labelled as playoffs).
    function rolloverWeek(league, calendar) {
        const nfl = calendar?.nfl;
        if (!nfl || calendar.provisional !== true || nfl.season_type !== 'regular') return 0;
        if (String(league?.season || '') !== String(nfl.season)) return 0;
        const current = providerWeek(nfl);
        if (Number(calendar.completedWeek) !== current) return 0;
        return Math.min(18, current + 1);
    }
    root.WrWireCalendar = { load, period, rolloverWeek };
})(typeof window !== 'undefined' ? window : globalThis);
