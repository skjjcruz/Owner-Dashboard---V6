// ══════════════════════════════════════════════════════════════════
// js/shared/faab-league.js — window.App.FaabLeague (boot-loaded, plain JS)
//
// ONE answer to "does this league bid on waivers?" for every surface
// (Free Agency, Flash Brief, Home widgets, Alex, league header). Before
// this, most surfaces asked `waiver_budget > 0` — but Sleeper stores a $100
// budget on EVERY league, including rolling / reverse-standings waiver
// leagues, so those leagues were told "You've got $100 FAAB left" while the
// FA tab (correctly) said "rolling waivers — no bids".
//
//   isFaabLeague(league)   budget > 0 AND (Sleeper) settings.waiver_type 2.
//                          Platforms that send no waiver_type (ESPN / MFL /
//                          Yahoo imports) decide on an imported budget alone —
//                          today none import one, so they read "no FAAB".
//   faab(league, roster)   { isFaab, budget, spent, remaining, platform }
//                          budget/remaining are 0 when !isFaab.
//   waiverLabel(league)    'FAAB' | 'rolling waivers' | 'reverse-standings
//                          waivers' | 'waivers' — for plain-language notes.
//   platformOf(league)     'sleeper' | 'espn' | 'mfl' | 'yahoo'
//
// Pure, no fetches, no storage. js/shared/waiver-tools.js (lazy "fa"
// group) delegates here when loaded.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    function platformOf(league) {
        const lg = league || {};
        try {
            const reg = App.Platforms || root.Platforms;
            const prov = reg && reg.getForLeague ? reg.getForLeague(lg) : null;
            if (prov && prov.id) return String(prov.id);
        } catch (e) { /* fall through to the league's own markers */ }
        if (lg._platform) return String(lg._platform);
        if (lg._mfl || lg._source === 'mfl' || lg._mfl_id) return 'mfl';
        if (lg._espn || lg._source === 'espn') return 'espn';
        if (lg._yahoo || lg._source === 'yahoo') return 'yahoo';
        return 'sleeper';
    }

    function isFaabLeague(league) {
        const st = (league && league.settings) || {};
        const budget = Number(st.waiver_budget) || 0;
        if (!(budget > 0)) return false;
        if (st.waiver_type == null || st.waiver_type === '') return true;
        return Number(st.waiver_type) === 2;
    }

    function faab(league, roster) {
        const on = isFaabLeague(league);
        const st = (league && league.settings) || {};
        const budget = on ? (Number(st.waiver_budget) || Number(roster && roster.settings && roster.settings.waiver_budget) || 0) : 0;
        const spent = on ? (Number(roster && roster.settings && roster.settings.waiver_budget_used) || 0) : 0;
        return { isFaab: on, budget, spent, remaining: on ? Math.max(0, budget - spent) : 0, platform: platformOf(league) };
    }

    function waiverLabel(league) {
        if (isFaabLeague(league)) return 'FAAB';
        const wt = league && league.settings && league.settings.waiver_type;
        if (platformOf(league) !== 'sleeper' || wt == null || wt === '') return 'waivers';
        return Number(wt) === 1 ? 'reverse-standings waivers' : 'rolling waivers';
    }

    App.FaabLeague = App.FaabLeague || { isFaabLeague, faab, waiverLabel, platformOf };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.FaabLeague;
})(typeof window !== 'undefined' ? window : globalThis);
