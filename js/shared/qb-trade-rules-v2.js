// ══════════════════════════════════════════════════════════════════
// qb-trade-rules-v2.js — six-tier QB trade composition rules
// (owner rulings 2026-09-02, MODEL STAGE — the live site still runs v1)
//
// Tiers by league-wide QB value rank inside the starting pool
// (32 in a 16-team superflex):
//   Elite+  ranks 1–5      Elite  6–10      Mid+  11–15
//   Mid     16–25          Low    26–30     Bottom 31–32
// Outside the pool, or not startable (no real value and no NFL starting
// job) = backup, exempt from all rules.
//
// AGE RULE: a QB aged 40+ prices at MID for trade purposes no matter
// where he scores — no owner mortgages the future for one year.
//
// Price floors (the side going TO the QB's owner needs ANY listed):
//   Elite+ : two 1sts + a starter-quality player · 1st + elite offensive player
//   Elite  : two 1sts · 1st + elite offensive player ·
//            1st + elite IDP + an additional pick
//   Mid+   : 1st + starting offensive skill player · 1st + elite IDP ·
//            1st + 2nd
//   Mid    : a 1st · starting offensive skill player + 2nd · elite IDP + 2nd
//   Low    : a 1st · 2nd + a starter (offense or defense)
//   Bottom : 2nd + a starter (offense or defense)
//
// SWAPS: an incoming startable QB of the SAME or better tier is payment
// enough on its own. One tier down bridges with a pick (a 1st when the
// target is Elite+/Elite/Mid+, a 2nd below that). Two or more tiers down
// = pay the full ladder price, with the lesser QB counting as a starting
// offensive skill piece.
//
// FAAB never pays. Rules fail OPEN on any error.
//
// Pure + dependency-injected (same pattern as v1):
//   WrQbTradeRulesV2.build({ scores, playersData, rosterPositions, teams,
//                            isElite(pid), starterRole(player), normPos,
//                            ageOf(pid)? })
//     → { violates(input), tierOf(pid), pool }
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    var OFF_POS = { QB: 1, RB: 1, WR: 1, TE: 1 };
    var IDP_POS = { DL: 1, LB: 1, DB: 1 };
    var TIER_IDX = { 'elite+': 0, 'elite': 1, 'mid+': 2, 'mid': 3, 'low': 4, 'bottom': 5 };

    function build(ctx) {
        var scores = (ctx && ctx.scores) || {};
        var playersData = (ctx && ctx.playersData) || {};
        var rp = (ctx && ctx.rosterPositions) || [];
        var teams = (ctx && ctx.teams) || 16;
        var isElite = (ctx && ctx.isElite) || function (pid) { return (scores[pid] || 0) >= 7000; };
        var starterRole = (ctx && ctx.starterRole) || function () { return null; };
        var normPos = (ctx && ctx.normPos) || function (p) { return String(p || '').toUpperCase(); };
        var ageOf = (ctx && ctx.ageOf) || function (pid) { var p = playersData[pid]; return (p && p.age) || null; };
        var isScarce = (ctx && ctx.isScarce) || function () { return false; };

        var qbHard = 0, sfSlots = 0;
        for (var i = 0; i < rp.length; i++) {
            if (rp[i] === 'QB') qbHard++;
            else if (rp[i] === 'SUPER_FLEX' || rp[i] === 'SUPERFLEX' || rp[i] === 'OP') sfSlots++;
        }
        var pool = Math.max(teams, teams * (Math.max(1, qbHard) + (sfSlots > 0 ? 1 : 0)));

        var rankMap = {};
        (function () {
            var qbs = [];
            for (var pid in scores) {
                if (scores[pid] > 0 && normPos(playersData[pid] && playersData[pid].position) === 'QB') qbs.push(pid);
            }
            qbs.sort(function (a, b) { return scores[b] - scores[a]; });
            for (var j = 0; j < qbs.length; j++) rankMap[qbs[j]] = j + 1;
        })();

        // Tier boundaries scale with pool size; at pool 32 they land exactly
        // on the owner's table (5/10/15/25/30/32).
        function tierForRank(rank) {
            if (rank <= Math.round(pool * 5 / 32)) return 'elite+';
            if (rank <= Math.round(pool * 10 / 32)) return 'elite';
            if (rank <= Math.round(pool * 15 / 32)) return 'mid+';
            if (rank <= Math.round(pool * 25 / 32)) return 'mid';
            if (rank <= Math.round(pool * 30 / 32)) return 'low';
            return 'bottom';
        }

        function tierOf(pid) {
            var rank = rankMap[String(pid)];
            if (!rank || rank > pool) {
                // A QB holding a LIVE NFL starting job never falls out of the
                // ladder (owner ruling: Rodgers must trip it). Ranked below
                // the pool, he enters at Bottom — priced, not free.
                if (rank) {
                    try { if (starterRole(playersData[pid])) return 'bottom'; } catch (e0) { }
                }
                return null;
            }
            var startable = (scores[pid] || 0) >= 2000;
            if (!startable) {
                try { startable = !!starterRole(playersData[pid]); } catch (e) { /* roles optional */ }
            }
            if (!startable) return null; // backup/stash — exempt
            var tier = tierForRank(rank);
            // Age rule: 40+ prices at Mid no matter the scoring tier.
            var age = null;
            try { age = ageOf(String(pid)); } catch (e2) { }
            if (age != null && age >= 40 && TIER_IDX[tier] < TIER_IDX.mid) tier = 'mid';
            // Scarcity bump (owner ruling 2026-09-02): a QB his own roster
            // can't cover losing prices ONE TIER UP — a bare 1st never buys
            // an irreplaceable mid QB.
            try {
                if (isScarce(String(pid))) {
                    var TIERS = ['elite+', 'elite', 'mid+', 'mid', 'low', 'bottom'];
                    tier = TIERS[Math.max(0, TIER_IDX[tier] - 1)];
                }
            } catch (e3) { }
            return tier;
        }

        function isStarterQuality(a) { // offense or defense, never K/pick
            if (!a || a.type === 'pick' || a.pos === 'K' || a.pos === 'DEF') return false;
            try { if (starterRole(playersData[a.pid])) return true; } catch (e) { /* roles optional */ }
            return (a.value || 0) >= 2000;
        }
        function isStartingOffSkill(a) { return !!(a && a.type !== 'pick' && OFF_POS[a.pos] && isStarterQuality(a)); }
        function isEliteOff(a) { try { return !!(a && a.type !== 'pick' && OFF_POS[a.pos] && isElite(a.pid)); } catch (e) { return false; } }
        function isEliteIdp(a) { try { return !!(a && a.type !== 'pick' && IDP_POS[a.pos] && isElite(a.pid)); } catch (e) { return false; } }

        function packageSatisfies(tier, qbPid, sidePlayers, sidePicks) {
            var others = [], picks = sidePicks || [];
            (sidePlayers || []).forEach(function (x) {
                if (x && x.type !== 'pick' && String(x.pid) !== String(qbPid)) others.push(x);
            });
            var firsts = 0, seconds = 0;
            for (var k = 0; k < picks.length; k++) {
                var rd = Number(picks[k].round) || 99;
                if (rd === 1) firsts++;
                else if (rd === 2) seconds++;
            }
            var hasFirst = firsts >= 1;
            var hasSecondOrBetter = firsts + seconds >= 1;

            // ── Swap lane: an incoming startable QB pays by tier distance.
            var ti = TIER_IDX[tier];
            for (var s = 0; s < others.length; s++) {
                var x = others[s];
                if (x.pos !== 'QB') continue;
                var xt = tierOf(x.pid);
                if (!xt) continue;
                var d = TIER_IDX[xt] - ti;
                if (d <= 0) return true;                       // same or better tier — even swap
                if (d === 1) {                                  // one tier down + a bridge pick
                    if (ti <= TIER_IDX['mid+'] ? hasFirst : hasSecondOrBetter) return true;
                }
                // two+ tiers down: no shortcut — falls through to the ladder,
                // where the lesser QB counts as a starting offensive skill piece.
            }

            var anyStarter = others.some(isStarterQuality);
            var anyOffSkill = others.some(isStartingOffSkill);
            var anyEliteOff = others.some(isEliteOff);
            var anyEliteIdp = others.some(isEliteIdp);

            if (tier === 'elite+') {
                if (firsts >= 2 && anyStarter) return true;
                if (hasFirst && anyEliteOff) return true;
                return false;
            }
            if (tier === 'elite') {
                if (firsts >= 2) return true;
                if (hasFirst && anyEliteOff) return true;
                if (hasFirst && anyEliteIdp && picks.length >= 2) return true;
                return false;
            }
            if (tier === 'mid+') {
                if (hasFirst && anyOffSkill) return true;
                if (hasFirst && anyEliteIdp) return true;
                if (hasFirst && picks.length >= 2 && seconds + firsts >= 2) return true; // 1st + 2nd (or better)
                return false;
            }
            if (tier === 'mid') {
                if (hasFirst) return true;
                if (anyOffSkill && hasSecondOrBetter) return true;
                if (anyEliteIdp && hasSecondOrBetter) return true;
                return false;
            }
            if (tier === 'low') {
                if (hasFirst) return true;
                if (hasSecondOrBetter && anyStarter) return true;
                return false;
            }
            // bottom
            return hasSecondOrBetter && anyStarter;
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
                if (sideViolates(input.receivePlayers, input.givePlayers, input.givePicks)) return true;
                if (sideViolates(input.givePlayers, input.receivePlayers, input.receivePicks)) return true;
                return false;
            } catch (e) { return false; } // fail open
        }

        return { violates: violates, tierOf: tierOf, pool: pool };
    }

    root.WrQbTradeRulesV2 = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
