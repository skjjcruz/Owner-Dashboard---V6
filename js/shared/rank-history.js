// ══════════════════════════════════════════════════════════════════
// rank-history.js — the league's power-rank memory (WR.RankHistory)
//
// The engine computes today's power table and forgets yesterday's, so
// nothing could ever say "COVIDFaceMasks climbed two spots" or draw an
// up/down arrow on YOUR RANK (owner build 2026-09-02). This keeps a
// dated copy of the FULL league rank table — 16 numbers a day, capped
// at 14 days — locally and in the same cloud channel the brief snapshot
// uses, so both surfaces share one memory.
//
//   record(leagueId, assessments) — save/refresh today's table (cheap,
//     self-correcting: intraday recomputes overwrite today's entry).
//   sync(leagueId, onMerged)      — merge the cloud copy in, best-effort.
//   myDelta(leagueId, rosterId)   — {delta, prevRank, currRank} vs the
//     previous recorded day, else null. delta > 0 = climbed.
//   movers(leagueId, opts)        — [{rosterId,name,from,to,delta}] for
//     the latest day vs the previous, biggest absolute move first.
//
// Plain JS, no JSX. Every failure degrades to "no history" — callers
// render nothing rather than break.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    var KEY = 'dhq_rank_hist_v1:';      // + leagueId
    var MAX_DAYS = 14;

    function _today() {
        try { return new Date().toISOString().slice(0, 10); } catch (_) { return ''; }
    }
    function _load(leagueId) {
        try {
            var raw = localStorage.getItem(KEY + (leagueId || '_'));
            var h = raw ? JSON.parse(raw) : null;
            return (h && Array.isArray(h.days)) ? h : { days: [] };
        } catch (_) { return { days: [] }; }
    }
    function _save(leagueId, hist) {
        try { localStorage.setItem(KEY + (leagueId || '_'), JSON.stringify(hist)); } catch (_) { /* non-fatal */ }
        try { window.OD?.saveLeagueDoc?.(leagueId || '_', 'rankhist', hist); } catch (_) { /* non-fatal */ }
    }

    // The sorted roster-id set of a rank table — the league's fingerprint.
    // Two tables belong to the same league only when these match.
    function _ridSet(ranks) {
        return Object.keys(ranks || {}).sort().join(',');
    }

    // Save (or refresh) today's table from a finished assessment pass.
    //
    // CONTAMINATION GUARD (bug 2026-09-04): on a league switch the widget can
    // briefly hold the NEW league's id with the OLD league's assessments, and
    // this function happily filed a 12-team league's table under the 16-team
    // league's key. The next morning's brief then compared the two and
    // invented "Pontiac Aztek slipped 14 spots". Two defenses:
    //   1. opts.expectedRosterIds — the caller says which roster ids the
    //      league actually has; a table with a different set is refused.
    //   2. Self-pruning — any stored day whose roster set differs from the
    //      table being recorded is dropped, so history already poisoned
    //      cleans itself on the next legitimate record.
    function record(leagueId, assessments, opts) {
        try {
            if (!leagueId || !Array.isArray(assessments) || assessments.length < 4) return;
            var ranks = {}, names = {}, complete = true;
            assessments.forEach(function (a) {
                if (!a || a.rosterId == null || !a.powerRank) { complete = false; return; }
                ranks[String(a.rosterId)] = a.powerRank;
                names[String(a.rosterId)] = a.teamName || a.ownerName || ('Team ' + a.rosterId);
            });
            if (!complete || !Object.keys(ranks).length) return;
            var set = _ridSet(ranks);
            var expected = opts && Array.isArray(opts.expectedRosterIds) && opts.expectedRosterIds.length
                ? opts.expectedRosterIds.map(String).sort().join(',')
                : null;
            if (expected && set !== expected) return; // not this league's table — refuse
            var today = _today();
            if (!today) return;
            var hist = _load(leagueId);
            // Self-prune: drop stored days from a different roster set.
            var before = hist.days.length;
            hist.days = hist.days.filter(function (d) { return d && _ridSet(d.ranks) === set; });
            var pruned = before !== hist.days.length;
            var last = hist.days[hist.days.length - 1];
            if (last && last.date === today) {
                if (!pruned && JSON.stringify(last.ranks) === JSON.stringify(ranks)) return; // unchanged
                last.ranks = ranks; last.names = names;                            // intraday refresh
            } else {
                hist.days.push({ date: today, ranks: ranks, names: names });
            }
            while (hist.days.length > MAX_DAYS) hist.days.shift();
            _save(leagueId, hist);
        } catch (_) { /* memory is a bonus, never a blocker */ }
    }

    // Merge the cloud copy (the other surface's memory) into this device's.
    function sync(leagueId, onMerged) {
        try {
            if (!leagueId || !window.OD?.loadLeagueDoc) return;
            window.OD.loadLeagueDoc(leagueId, 'rankhist').then(function (doc) {
                if (!doc || !Array.isArray(doc.days) || !doc.days.length) return;
                var hist = _load(leagueId);
                var byDate = {};
                hist.days.forEach(function (d) { byDate[d.date] = d; });
                var merged = false;
                doc.days.forEach(function (d) {
                    if (d && d.date && !byDate[d.date]) { byDate[d.date] = d; merged = true; }
                });
                if (!merged) return;
                var days = Object.keys(byDate).sort().map(function (k) { return byDate[k]; });
                while (days.length > MAX_DAYS) days.shift();
                try { localStorage.setItem(KEY + leagueId, JSON.stringify({ days: days })); } catch (_) {}
                if (typeof onMerged === 'function') onMerged();
            }).catch(function (e) { window.wrLog?.('rankHistory.cloudLoad', e); });
        } catch (_) { /* non-fatal */ }
    }

    // The two most recent DIFFERENT days, newest first. null when history is
    // a single day deep — there is nothing honest to compare yet. Days whose
    // roster set differs from the latest day are never compared (same
    // contamination guard as record: cross-league days say nothing honest).
    function _lastTwoDays(leagueId) {
        var hist = _load(leagueId);
        if (hist.days.length < 2) return null;
        var curr = hist.days[hist.days.length - 1];
        var prev = hist.days[hist.days.length - 2];
        if (_ridSet(curr.ranks) !== _ridSet(prev.ranks)) return null;
        return { curr: curr, prev: prev };
    }

    // Your own move since the previous recorded day. delta > 0 = climbed.
    function myDelta(leagueId, rosterId) {
        try {
            var two = _lastTwoDays(leagueId);
            if (!two) return null;
            var rid = String(rosterId);
            var currRank = two.curr.ranks[rid], prevRank = two.prev.ranks[rid];
            if (!currRank || !prevRank) return null;
            return { delta: prevRank - currRank, prevRank: prevRank, currRank: currRank, sinceDate: two.prev.date };
        } catch (_) { return null; }
    }

    // League movers, latest day vs previous, biggest absolute move first.
    function movers(leagueId, opts) {
        try {
            var two = _lastTwoDays(leagueId);
            if (!two) return [];
            var exclude = opts && opts.excludeRosterId != null ? String(opts.excludeRosterId) : null;
            var out = [];
            Object.keys(two.curr.ranks).forEach(function (rid) {
                if (exclude && rid === exclude) return;
                var to = two.curr.ranks[rid], from = two.prev.ranks[rid];
                if (!to || !from || to === from) return;
                out.push({ rosterId: rid, name: (two.curr.names && two.curr.names[rid]) || ('Team ' + rid), from: from, to: to, delta: from - to });
            });
            out.sort(function (a, b) {
                var d = Math.abs(b.delta) - Math.abs(a.delta);
                return d !== 0 ? d : (b.delta - a.delta); // ties: climbs over slides
            });
            return out;
        } catch (_) { return []; }
    }

    window.WR.RankHistory = { record: record, sync: sync, myDelta: myDelta, movers: movers };
})();
