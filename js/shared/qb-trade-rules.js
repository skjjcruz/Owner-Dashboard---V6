// ══════════════════════════════════════════════════════════════════
// qb-trade-rules.js — QB trade composition rules (owner ruling 2026-09-02)
//
// In big and 2-QB formats the QB is the most valuable piece on the field,
// and a package for a startable QB must LOOK like it. These rules gate
// ONLY finder-generated ideas; the manual Trade Builder is deliberately
// untouched and un-warned — whatever an owner hand-builds is on the owner.
//
// Tiers by league-wide QB value rank inside the starting pool
// (pool = teams × starting QB slots incl. superflex; 32 in a 16-team SF):
//   elite/mid = top 62.5% of the pool (1–20 of 32) · low = the rest of the
//   pool (21–32) · beyond the pool = backup/stash, exempt from all rules.
//
// A qualifying package (the side going TO the QB's owner) needs ANY of:
//   ELITE/MID QB:
//     • a 1st-round pick — but an ELITE-badge QB (owner ruling 2026-09-02)
//       never moves for a single bare 1st: two 1sts, or a 1st plus a
//       starter-quality player or elite IDP
//     • a startable-QB swap PLUS extras (a pick, or a starter-quality player)
//     • an elite offensive player (QB/RB/WR/TE)
//     • an elite IDP plus at least one draft pick
//     • two or more starter-quality players (any mix, offense or IDP)
//   LOW-TIER QB:
//     • a 1st- or 2nd-round pick
//     • a starter-quality offensive skill player (a startable QB counts —
//       it is never a downgrade from that bar)
//     • an elite IDP
// FAAB alone never qualifies. Rules fail OPEN on any error — a broken
// lookup must never blank the finder.
//
// Pure + dependency-injected so tests/run.js can drill it without a DOM:
//   WrQbTradeRules.build({ scores, playersData, rosterPositions, teams,
//                          isElite(pid), starterRole(player) })
//     → { violates(input), tierOf(pid), pool }
//   input: { givePlayers, givePicks, receivePlayers, receivePicks } where
//   players are {pid,pos,value,type?} and picks are {round}.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    var OFF_POS = { QB: 1, RB: 1, WR: 1, TE: 1 };
    var IDP_POS = { DL: 1, LB: 1, DB: 1 };

    function build(ctx) {
        var scores = (ctx && ctx.scores) || {};
        var playersData = (ctx && ctx.playersData) || {};
        var rp = (ctx && ctx.rosterPositions) || [];
        var teams = (ctx && ctx.teams) || 16;
        var isElite = (ctx && ctx.isElite) || function (pid) { return (scores[pid] || 0) >= 7000; };
        var starterRole = (ctx && ctx.starterRole) || function () { return null; };
        var normPos = (ctx && ctx.normPos) || function (p) { return String(p || '').toUpperCase(); };

        // Starting-QB pool: hard QB slots + one per superflex-style slot.
        var qbHard = 0, sfSlots = 0;
        for (var i = 0; i < rp.length; i++) {
            if (rp[i] === 'QB') qbHard++;
            else if (rp[i] === 'SUPER_FLEX' || rp[i] === 'SUPERFLEX' || rp[i] === 'OP') sfSlots++;
        }
        var pool = Math.max(teams, teams * (Math.max(1, qbHard) + (sfSlots > 0 ? 1 : 0)));
        var eliteMidLine = Math.round(pool * 0.625);

        // League-wide QB rank by value, computed once per build.
        var rankMap = {};
        (function () {
            var qbs = [];
            for (var pid in scores) {
                if (scores[pid] > 0 && normPos(playersData[pid] && playersData[pid].position) === 'QB') qbs.push(pid);
            }
            qbs.sort(function (a, b) { return scores[b] - scores[a]; });
            for (var j = 0; j < qbs.length; j++) rankMap[qbs[j]] = j + 1;
        })();

        function tierOf(pid) {
            var rank = rankMap[String(pid)];
            if (!rank || rank > pool) return null;      // outside the pool — exempt
            // Rank alone isn't startable: a thin scored pool can rank a true
            // backup inside the line. He must also LOOK startable — real value
            // or a live NFL starting role.
            var startable = (scores[pid] || 0) >= 2000;
            if (!startable) {
                try { startable = !!starterRole(playersData[pid]); } catch (e) { /* roles optional */ }
            }
            if (!startable) return null;                // backup/stash — exempt
            return rank <= eliteMidLine ? 'elitemid' : 'low';
        }

        function isStarterQuality(a) {
            if (!a || a.type === 'pick') return false;
            try { if (starterRole(playersData[a.pid])) return true; } catch (e) { /* roles optional */ }
            return (a.value || 0) >= 2000;
        }

        function packageSatisfies(tier, qbPid, sidePlayers, sidePicks) {
            var others = [], picks = sidePicks || [];
            (sidePlayers || []).forEach(function (x) {
                if (x && x.type !== 'pick' && String(x.pid) !== String(qbPid)) others.push(x);
            });
            var hasRound = function (max) {
                for (var k = 0; k < picks.length; k++) { if ((Number(picks[k].round) || 99) <= max) return true; }
                return false;
            };
            if (tier === 'elitemid') {
                // Owner ruling 2026-09-02: an ELITE-badge QB never moves for
                // a single bare 1st. Two 1sts pay; a single 1st needs a real
                // piece (starter-quality player or elite IDP) beside it. Mid
                // QBs keep the single-1st door.
                var firsts = 0;
                for (var f = 0; f < picks.length; f++) { if ((Number(picks[f].round) || 99) === 1) firsts++; }
                var badgeElite = false;
                try { badgeElite = !!isElite(String(qbPid)); } catch (e0) { /* badge optional */ }
                if (firsts >= (badgeElite ? 2 : 1)) return true;
                if (badgeElite && firsts >= 1) {
                    for (var f2 = 0; f2 < others.length; f2++) {
                        if (isStarterQuality(others[f2])) return true;
                        if (IDP_POS[others[f2].pos] && isElite(others[f2].pid)) return true;
                    }
                }
                var qbValue = scores[String(qbPid)] || 0;
                for (var s = 0; s < others.length; s++) {
                    var x = others[s];
                    if (x.pos === 'QB' && tierOf(x.pid)) {
                        // QB-for-QB swap. Paying with an EQUAL-OR-BETTER QB is
                        // payment enough on its own; the side receiving the
                        // BETTER QB owes extras (a pick or a starter-quality
                        // player) alongside the lesser one.
                        if ((scores[String(x.pid)] || x.value || 0) >= qbValue) return true;
                        if (picks.length >= 1) return true;
                        for (var e2 = 0; e2 < others.length; e2++) {
                            if (others[e2] !== x && isStarterQuality(others[e2])) return true;
                        }
                    }
                }
                for (var a1 = 0; a1 < others.length; a1++) {
                    if (OFF_POS[others[a1].pos] && isElite(others[a1].pid)) return true;
                }
                if (picks.length >= 1) {
                    for (var a2 = 0; a2 < others.length; a2++) {
                        if (IDP_POS[others[a2].pos] && isElite(others[a2].pid)) return true;
                    }
                }
                var sq = 0;
                for (var a3 = 0; a3 < others.length; a3++) { if (isStarterQuality(others[a3])) sq++; }
                return sq >= 2;
            }
            // low tier
            if (hasRound(2)) return true;
            for (var b1 = 0; b1 < others.length; b1++) {
                if (OFF_POS[others[b1].pos] && isStarterQuality(others[b1])) return true;
            }
            for (var b2 = 0; b2 < others.length; b2++) {
                if (IDP_POS[others[b2].pos] && isElite(others[b2].pid)) return true;
            }
            return false;
        }

        function sideViolates(qbSidePlayers, payPlayers, payPicks) {
            for (var i2 = 0; i2 < (qbSidePlayers || []).length; i2++) {
                var a = qbSidePlayers[i2];
                if (!a || a.type === 'pick' || a.pos !== 'QB') continue;
                var tier = tierOf(a.pid);
                if (!tier) continue;
                if (!packageSatisfies(tier, a.pid, payPlayers, payPicks)) return true;
            }
            return false;
        }

        function violates(input) {
            try {
                if (!input) return false;
                // A startable QB I RECEIVE must be paid for by my give side;
                // one I SEND must be paid for by their give side.
                if (sideViolates(input.receivePlayers, input.givePlayers, input.givePicks)) return true;
                if (sideViolates(input.givePlayers, input.receivePlayers, input.receivePicks)) return true;
                return false;
            } catch (e) { return false; } // fail open
        }

        return { violates: violates, tierOf: tierOf, pool: pool, eliteMidLine: eliteMidLine };
    }

    root.WrQbTradeRules = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
