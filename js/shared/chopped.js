// ══════════════════════════════════════════════════════════════════
// js/shared/chopped.js — window.App.Chopped
// Elimination state for Sleeper CHOPPED leagues (the native guillotine /
// last-man-standing format, settings.type === 3).
//
// Every week the LOWEST-scoring team is chopped and its entire roster is
// released to waivers; the last team standing wins. There are no head-to-head
// matchups, no playoffs, and usually no trading.
//
// Sleeper marks this natively and we read it rather than infer it:
//   league.settings.type            3
//   league.settings.last_chopped_leg  last week a chop happens (e.g. 17)
//   league.settings.leg / last_scored_leg   current / last scored week
//   roster.settings.eliminated      THE WEEK that roster was chopped (absent
//                                   while alive) — verified against a
//                                   reconstructed 2025 ladder, 17/17 exact
//   roster.settings.locked          1 once chopped
//
// Pure + synchronous: callers pass the league and its rosters. No fetching.
// The point of this module is that "is this team dead?" has exactly ONE
// answer in the codebase — several engines were treating a chopped team's
// empty roster as a live, fully-funded, high-need rival.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const CHOPPED_TYPE = 3;

    function settingsOf(o) { return (o && o.settings) || {}; }

    // Native flag first. `last_chopped_leg` is a chopped-only setting and
    // corroborates it, but type is authoritative — a commissioner could in
    // principle clear the leg without changing the format.
    function isChopped(league) {
        if (!league) return false;
        const s = settingsOf(league);
        if (Number(s.type) === CHOPPED_TYPE) return true;
        // Explicit override / already-normalized skins.
        const t = String(league.type || league.league_type || '').toLowerCase();
        return t === 'chopped' || t === 'guillotine';
    }

    function lastChoppedLeg(league) {
        const n = Number(settingsOf(league).last_chopped_leg);
        return n > 0 ? n : null;
    }

    // The week this roster was chopped, or null while it's alive.
    function eliminatedWeek(roster) {
        const n = Number(settingsOf(roster).eliminated);
        return n > 0 ? n : null;
    }
    function isEliminated(roster) { return eliminatedWeek(roster) != null; }

    // Alive AS OF a given week: a team chopped in week 4 was still playing
    // during week 4 (its week-4 score is what killed it), so it counts as
    // alive for any week <= 4. Omit `week` to mean "alive right now".
    function isAliveInWeek(roster, week) {
        const w = eliminatedWeek(roster);
        if (w == null) return true;
        const wk = Number(week);
        return wk > 0 ? wk <= w : false;
    }

    function aliveRosters(rosters, week) {
        return (rosters || []).filter(r => isAliveInWeek(r, week));
    }
    function eliminatedRosters(rosters) {
        return (rosters || []).filter(isEliminated);
    }

    // The full picture for a league, in one call.
    function state(opts) {
        opts = opts || {};
        const league = opts.league || null;
        const rosters = opts.rosters || (league && league.rosters) || [];
        const chopped = isChopped(league);
        const week = Number(opts.week) || null;
        const order = eliminatedRosters(rosters)
            .map(r => ({ rosterId: r.roster_id, week: eliminatedWeek(r) }))
            .sort((a, b) => a.week - b.week);
        const alive = aliveRosters(rosters, null);
        return {
            isChopped: chopped,
            teams: (rosters || []).length,
            aliveCount: alive.length,
            aliveRosterIds: alive.map(r => r.roster_id),
            choppedCount: order.length,
            order,
            lastChoppedLeg: lastChoppedLeg(league),
            // Only a finished league has a survivor; mid-season "1 alive" can't
            // happen, but guard anyway rather than crowning someone early.
            survivorRosterId: (chopped && alive.length === 1 && order.length === (rosters || []).length - 1)
                ? alive[0].roster_id : null,
            // Next chop lands on the current week while the format is still
            // executing; null once the last chopped leg has passed.
            nextChopWeek: (chopped && week && lastChoppedLeg(league) && week <= lastChoppedLeg(league)) ? week : null,
        };
    }

    const api = {
        CHOPPED_TYPE,
        isChopped, lastChoppedLeg,
        eliminatedWeek, isEliminated, isAliveInWeek,
        aliveRosters, eliminatedRosters,
        state,
    };
    App.Chopped = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
