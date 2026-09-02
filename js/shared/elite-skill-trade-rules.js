// ══════════════════════════════════════════════════════════════════
// elite-skill-trade-rules.js — elite RB/WR/TE package rules
// (owner ruling 2026-09-02: "Elite Offensive Players require top dollar")
//
// The finder matched packages on value bands alone, so a league-best RB
// could be "bought" with a 1st plus a rank-20 DB used as arithmetic
// filler. These rules gate ONLY finder-generated ideas; the manual Trade
// Builder stays untouched and un-warned — owner's table, owner's call.
//
// Elite = the app's existing elite badge (isElite: 7000+ DHQ or top-5 at
// position), restricted here to RB/WR/TE — elite QBs are governed by
// qb-trade-rules.js. Non-elite players trade on plain value as before.
//
// A qualifying package (the side going TO the elite player's owner)
// needs ANY of:
//   • two 1st-round picks
//   • a 1st-round pick + a starter-quality OFFENSIVE player
//   • a 1st-round pick + an elite IDP
//   • an elite offensive player coming back (star-for-star; QB counts)
//   • two or more starter-quality offensive players + at least one pick
// A single bare 1st is ALWAYS rejected (owner ruling). Non-elite IDPs
// and Ks never satisfy anything — they may ride along, but they are
// decoration, not payment. FAAB never pays. Rules fail OPEN on any
// error — a broken lookup must never blank the finder.
//
// Pure + dependency-injected so tests/run.js can drill it without a DOM:
//   WrEliteSkillRules.build({ scores, playersData, isElite(pid),
//                             starterRole(player), normPos })
//     → { violates(input), isEliteSkill(pid) }
//   input: { givePlayers, givePicks, receivePlayers, receivePicks } where
//   players are {pid,pos,value,type?} and picks are {round}.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    var SKILL_POS = { RB: 1, WR: 1, TE: 1 };
    var OFF_POS = { QB: 1, RB: 1, WR: 1, TE: 1 };
    var IDP_POS = { DL: 1, LB: 1, DB: 1 };

    function build(ctx) {
        var scores = (ctx && ctx.scores) || {};
        var playersData = (ctx && ctx.playersData) || {};
        var isElite = (ctx && ctx.isElite) || function (pid) { return (scores[pid] || 0) >= 7000; };
        var starterRole = (ctx && ctx.starterRole) || function () { return null; };

        function isEliteSkill(pid, pos) {
            if (!SKILL_POS[pos]) return false;
            try { return !!isElite(pid); } catch (e) { return false; }
        }

        function isStarterQualityOff(a) {
            if (!a || a.type === 'pick' || !OFF_POS[a.pos]) return false;
            try { if (starterRole(playersData[a.pid])) return true; } catch (e) { /* roles optional */ }
            return (a.value || 0) >= 2000;
        }

        function packageSatisfies(elitePid, sidePlayers, sidePicks) {
            var others = [], picks = sidePicks || [];
            (sidePlayers || []).forEach(function (x) {
                if (x && x.type !== 'pick' && String(x.pid) !== String(elitePid)) others.push(x);
            });
            var firsts = 0;
            for (var k = 0; k < picks.length; k++) { if ((Number(picks[k].round) || 99) === 1) firsts++; }
            if (firsts >= 2) return true;
            for (var s = 0; s < others.length; s++) {
                var x = others[s];
                if (OFF_POS[x.pos] && isElite(x.pid)) return true; // star-for-star
            }
            if (firsts >= 1) {
                for (var a1 = 0; a1 < others.length; a1++) {
                    if (isStarterQualityOff(others[a1])) return true;
                    if (IDP_POS[others[a1].pos] && isElite(others[a1].pid)) return true;
                }
            }
            if (picks.length >= 1) {
                var sqOff = 0;
                for (var a2 = 0; a2 < others.length; a2++) { if (isStarterQualityOff(others[a2])) sqOff++; }
                if (sqOff >= 2) return true;
            }
            return false;
        }

        function sideViolates(eliteSidePlayers, payPlayers, payPicks) {
            for (var i = 0; i < (eliteSidePlayers || []).length; i++) {
                var a = eliteSidePlayers[i];
                if (!a || a.type === 'pick' || !isEliteSkill(a.pid, a.pos)) continue;
                if (!packageSatisfies(a.pid, payPlayers, payPicks)) return true;
            }
            return false;
        }

        function violates(input) {
            try {
                if (!input) return false;
                // An elite skill player I RECEIVE must be paid for by my give
                // side; one I SEND must be paid for by their give side.
                if (sideViolates(input.receivePlayers, input.givePlayers, input.givePicks)) return true;
                if (sideViolates(input.givePlayers, input.receivePlayers, input.receivePicks)) return true;
                return false;
            } catch (e) { return false; } // fail open
        }

        return {
            violates: violates,
            isEliteSkill: function (pid) {
                var p = playersData[pid];
                return isEliteSkill(pid, p && p.position ? String(p.position).toUpperCase() : '');
            },
        };
    }

    root.WrEliteSkillRules = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
