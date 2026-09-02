// ══════════════════════════════════════════════════════════════════
// gm-trade-engine.js — the GM-brain trade recommendation engine
// (owner blueprint 2026-09-02: "start at the very beginning — surgery,
// not bandaids")
//
// MODEL STAGE: this module is NOT wired into the website yet. It exists
// to run mock recommendations against a live league snapshot for owner
// review before any transition.
//
// The old finder asked "what's a roughly even swap the partner would
// accept?" — this engine asks the GM's question: "what move makes MY
// team better, that the market would realistically allow?" Every
// recommendation must survive the five-step chain:
//
//   1. READ THE REPORT — needs / resources / protected come straight
//      from the shared health assessment (one brain).
//   2. COST-BENEFIT — a deal must improve my projected starting lineup
//      (or my draft capital, when my window says rebuild). Sidegrades die.
//   3. SHOP WHERE THE MARKET MAKES SENSE — partners whose needs mirror
//      mine, and only targets that are genuinely starter-quality.
//   4. BUILD UNDER THE RULES — packages pass the QB rules, elite rules,
//      and a no-junk-filler standard; every piece must be real payment
//      (fills the partner's need, or is liquid starter-quality/elite).
//   5. RECOMMEND OR SHUT UP — nothing clears the bar ⇒ empty board.
//      That is advice, not failure.
//
// Owner DNA / psych taxes are deliberately HELD OUT of this engine
// (owner ruling: they stay on the manual Trade Builder for now); the
// acceptance check here is plain value + need-fit reality.
//
// Pure + dependency-injected (same pattern as qb-trade-rules.js):
//   WrGmTradeEngine.build(ctx) → { ledger(rosterId), recommend(), config }
//   ctx = {
//     myRosterId, rosterPositions, teams: [{ rosterId, ownerId, teamName,
//       assessment: { posAssessment, needs, strengths, window|tier },
//       players: [{pid,name,pos,value,age?}], picks: [{id,year,round,label,value}] }],
//     liquidity(asset)→0..1, isElite(pid), isUntouchable(pid)?,
//     rules: [modules with .violates(input)], primeYearsLeft(asset)?,
//     config?: overrides
//   }
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    var DEFAULTS = {
        payLow: 0.90,        // buying: package ≥ 90% of target market value
        payHigh: 1.15,       // buying: never assemble an overpay past 115%
        upgradeMargin: 1.15, // upgrade-lane swap: incoming must beat outgoing by ≥15%
        minLineupGain: 150,  // DHQ: a deal must move my starting lineup at least this much
        minPieceValue: 1500, // no junk: every player piece must be at least this
        pickUpgradeMinGain: 500, // Lane E: burning draft capital demands a bigger lineup step
        acceptFloor: 55,     // plain value+need acceptance likelihood floor (%)
        maxPerNeed: 4,       // deals surfaced per need position
        maxResults: 10,
    };

    var FLEX_ELIG = {
        FLEX: { RB: 1, WR: 1, TE: 1 },
        WRRB_FLEX: { RB: 1, WR: 1 },
        REC_FLEX: { WR: 1, TE: 1 },
        SUPER_FLEX: { QB: 1, RB: 1, WR: 1, TE: 1 },
        OP: { QB: 1, RB: 1, WR: 1, TE: 1 },
        IDP_FLEX: { DL: 1, LB: 1, DB: 1 },
        IDP: { DL: 1, LB: 1, DB: 1 },
        DL: null, LB: null, DB: null, // hard slots handled directly
    };
    var BENCH_SLOTS = { BN: 1, IR: 1, TAXI: 1 };

    function build(ctx) {
        var cfg = {};
        for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
        if (ctx && ctx.config) { for (var k2 in ctx.config) if (ctx.config[k2] != null) cfg[k2] = ctx.config[k2]; }

        var teams = (ctx && ctx.teams) || [];
        var rp = ((ctx && ctx.rosterPositions) || []).filter(function (s) { return !BENCH_SLOTS[s]; });
        var liquidity = (ctx && ctx.liquidity) || function () { return 1; };
        var isElite = (ctx && ctx.isElite) || function () { return false; };
        var isUntouchable = (ctx && ctx.isUntouchable) || function () { return false; };
        var rules = (ctx && ctx.rules) || [];
        var primeYearsLeft = (ctx && ctx.primeYearsLeft) || function () { return null; };

        var byRosterId = {};
        teams.forEach(function (t) { byRosterId[String(t.rosterId)] = t; });
        var me = byRosterId[String(ctx.myRosterId)];

        function mkt(asset) { return Math.round((asset.value || 0) * (asset.type === 'pick' ? 1 : liquidity(asset))); }
        function mktTotal(players, picks) {
            var s = 0;
            (players || []).forEach(function (p) { s += mkt(p); });
            (picks || []).forEach(function (p) { s += p.value || 0; });
            return s;
        }
        function rawTotal(players, picks) {
            var s = 0;
            (players || []).forEach(function (p) { s += p.value || 0; });
            (picks || []).forEach(function (p) { s += p.value || 0; });
            return s;
        }

        // ── Starting lineup model ─────────────────────────────────────
        // Greedy optimal fill of the league's starting slots by DHQ value:
        // hard position slots first, then flexes from what remains. Returns
        // total value + the starter pid set. This is the yardstick every
        // deal is measured against (step 2 of the chain).
        function lineup(players) {
            var pool = players.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
            var used = {};
            var total = 0;
            var hard = [], flex = [];
            rp.forEach(function (slot) { (FLEX_ELIG[slot] ? flex : hard).push(slot); });
            hard.forEach(function (slot) {
                for (var i = 0; i < pool.length; i++) {
                    var p = pool[i];
                    if (used[p.pid] || p.pos !== slot) continue;
                    used[p.pid] = 1; total += p.value || 0; return;
                }
            });
            flex.forEach(function (slot) {
                var elig = FLEX_ELIG[slot];
                for (var i = 0; i < pool.length; i++) {
                    var p = pool[i];
                    if (used[p.pid] || !elig[p.pos]) continue;
                    used[p.pid] = 1; total += p.value || 0; return;
                }
            });
            return { total: total, starters: used };
        }

        function lineupAfter(team, losePids, gainPlayers) {
            var lose = {};
            (losePids || []).forEach(function (pid) { lose[String(pid)] = 1; });
            var next = team.players.filter(function (p) { return !lose[String(p.pid)]; }).concat(gainPlayers || []);
            return lineup(next).total;
        }

        // ── Step 1: the ledger — needs / resources / protected ────────
        function ledger(rosterId) {
            var t = byRosterId[String(rosterId)];
            if (!t) return null;
            var pa = (t.assessment && t.assessment.posAssessment) || {};
            var needs = ((t.assessment && t.assessment.needs) || []).slice();
            var lu = lineup(t.players);
            var excess = [], protectedPids = {};
            var byPos = {};
            t.players.forEach(function (p) { (byPos[p.pos] = byPos[p.pos] || []).push(p); });
            Object.keys(byPos).forEach(function (pos) {
                var list = byPos[pos].slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
                var a = pa[pos] || {};
                var keep = a.status === 'surplus'
                    ? Math.max(1, Number(a.minQuality) || 1) // surplus: the weekly requirement is protected, the spare is a chip
                    : list.length;                           // not surplus: the whole position is protected
                list.forEach(function (p, i) {
                    if (isUntouchable(p.pid)) { protectedPids[p.pid] = 1; return; }
                    if (i < keep) protectedPids[p.pid] = 1;
                    else if ((p.value || 0) >= cfg.minPieceValue) excess.push(p);
                });
            });
            excess.sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
            return {
                team: t,
                needs: needs,
                excess: excess,
                picks: (t.picks || []).slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); }),
                protectedPids: protectedPids,
                lineupValue: lu.total,
                starters: lu.starters,
                window: (t.assessment && (t.assessment.window || t.assessment.tier)) || 'UNKNOWN',
            };
        }

        // ── Step 4 helpers: payment standards ─────────────────────────
        // Every player piece must be REAL payment to THIS partner: it fills
        // one of their needs, or it is liquid starter-quality, or elite.
        // Junk never rides as filler (the rank-20-DB rule, generalized).
        function realPaymentFor(piece, partnerNeeds) {
            if ((piece.value || 0) < cfg.minPieceValue) return false;
            var needsPos = partnerNeeds.some(function (n) { return n.pos === piece.pos; });
            if (needsPos) return true;
            try { if (isElite(piece.pid)) return true; } catch (e) { }
            return liquidity(piece) >= 0.9 && (piece.value || 0) >= 2000; // liquid starter-quality
        }

        function passesRules(input) {
            for (var i = 0; i < rules.length; i++) {
                try { if (rules[i] && rules[i].violates && rules[i].violates(input)) return false; } catch (e) { }
            }
            return true;
        }

        // Plain value + need-fit acceptance (DNA taxes held out by ruling).
        function acceptance(partnerLedger, theyGivePlayers, theyGivePicks, theyGetPlayers, theyGetPicks) {
            var give = mktTotal(theyGivePlayers, theyGivePicks);
            var get = mktTotal(theyGetPlayers, theyGetPicks);
            if (give <= 0) return 0;
            var surplusPct = (get - give) / Math.max(give, get, 1);
            // Base 65: a genuinely fair-value offer is plausible on its own.
            // This scale carries no psych/DNA taxes (owner ruling: those stay
            // on the manual builder), so the GM-office acceptance floor reads
            // against plain value + need fit.
            var base = 65 + surplusPct * 200;
            var needHit = (theyGetPlayers || []).some(function (p) {
                return partnerLedger.needs.some(function (n) { return n.pos === p.pos; });
            });
            if (needHit) base += 12;
            var pieces = (theyGivePlayers || []).length + (theyGetPlayers || []).length + (theyGivePicks || []).length + (theyGetPicks || []).length;
            base -= Math.max(0, pieces - 4) * 5;
            return Math.round(Math.max(5, Math.min(95, base)));
        }

        // ── Package enumeration (small, honest combos) ────────────────
        function combos(players, picks, maxPlayers, maxPicks) {
            var out = [];
            var P = players.slice(0, 8), K = picks.slice(0, 6);
            out.push({ players: [], picks: [] });
            P.forEach(function (p, i) {
                out.push({ players: [p], picks: [] });
                for (var j = i + 1; j < P.length && maxPlayers >= 2; j++) out.push({ players: [p, P[j]], picks: [] });
            });
            K.forEach(function (k, i) {
                out.push({ players: [], picks: [k] });
                for (var j = i + 1; j < K.length && maxPicks >= 2; j++) out.push({ players: [], picks: [k, K[j]] });
            });
            P.forEach(function (p) {
                K.forEach(function (k) { out.push({ players: [p], picks: [k] }); });
            });
            for (var a = 0; a < P.length && maxPlayers >= 2; a++) {
                for (var b = a + 1; b < P.length; b++) {
                    for (var c = 0; c < Math.min(K.length, 3); c++) out.push({ players: [P[a], P[b]], picks: [K[c]] });
                }
            }
            return out.filter(function (cm) { return cm.players.length || cm.picks.length; });
        }

        // ── The chain: recommend() ────────────────────────────────────
        function recommend() {
            if (!me) return [];
            var my = ledger(ctx.myRosterId);
            if (!my) return [];
            var deals = [];
            var seenIdea = {};

            function consider(purpose, partnerLedger, givePlayers, givePicks, receivePlayers, receivePicks, why, opts) {
                // Step 4: composition + no-junk standards, both sides.
                var badPiece = givePlayers.some(function (p) { return !realPaymentFor(p, partnerLedger.needs); })
                    || receivePlayers.some(function (p) { return !realPaymentFor(p, my.needs); });
                if (badPiece) return;
                var input = { givePlayers: givePlayers, givePicks: givePicks, receivePlayers: receivePlayers, receivePicks: receivePicks };
                if (!passesRules(input)) return;
                // Value sanity: I don't overpay past the band, they don't get fleeced.
                var giveMkt = mktTotal(givePlayers, givePicks);
                var recvMkt = mktTotal(receivePlayers, receivePicks);
                if (recvMkt <= 0 || giveMkt <= 0) return;
                if (giveMkt > recvMkt * cfg.payHigh || giveMkt < recvMkt * cfg.payLow * 0.85) return;
                // Step 2: the benefit gate — my lineup after the deal.
                var losePids = givePlayers.map(function (p) { return p.pid; });
                var afterLineup = lineupAfter(my.team, losePids, receivePlayers);
                var lineupDelta = afterLineup - my.lineupValue;
                var capitalDelta = rawTotal([], receivePicks) - rawTotal([], givePicks);
                var rebuild = /REBUILD|RETOOL/i.test(String(my.window));
                var minGain = (opts && opts.minGain) || cfg.minLineupGain;
                var benefits = lineupDelta >= minGain
                    || (rebuild && capitalDelta > 0 && lineupDelta > -cfg.minLineupGain);
                if (!benefits) return;
                // Step 3/5: would they plausibly take it?
                var acc = acceptance(partnerLedger, receivePlayers, receivePicks, givePlayers, givePicks);
                if (acc < cfg.acceptFloor) return;
                // One idea per (partner, incoming players) — best benefit wins.
                var idea = String(partnerLedger.team.rosterId) + '|' + receivePlayers.map(function (p) { return p.pid; }).sort().join(',');
                var score = lineupDelta + capitalDelta * 0.3;
                if (seenIdea[idea] != null && deals[seenIdea[idea]].score >= score) return;
                var deal = {
                    purpose: purpose,
                    partnerRosterId: partnerLedger.team.rosterId,
                    partnerName: partnerLedger.team.teamName,
                    givePlayers: givePlayers, givePicks: givePicks,
                    receivePlayers: receivePlayers, receivePicks: receivePicks,
                    lineupDelta: Math.round(lineupDelta),
                    capitalDelta: Math.round(capitalDelta),
                    acceptance: acc,
                    score: score,
                    why: why,
                };
                if (seenIdea[idea] != null) deals[seenIdea[idea]] = deal;
                else { seenIdea[idea] = deals.length; deals.push(deal); }
            }

            var partners = teams.filter(function (t) { return String(t.rosterId) !== String(ctx.myRosterId); })
                .map(function (t) { return ledger(t.rosterId); }).filter(Boolean);

            // LANE A — fill each need from partners with genuine spare starters.
            my.needs.forEach(function (need) {
                partners.forEach(function (pl) {
                    var pa = (pl.team.assessment && pl.team.assessment.posAssessment) || {};
                    var st = pa[need.pos] || {};
                    if (st.status !== 'surplus') return; // their store doesn't stock it
                    var targets = pl.excess.filter(function (p) { return p.pos === need.pos && (p.value || 0) >= 2000; });
                    targets.slice(0, 2).forEach(function (target) {
                        combos(my.excess, my.picks, 2, 2).forEach(function (pay) {
                            consider('Fill ' + need.pos + ' need', pl, pay.players, pay.picks, [target], [],
                                'You need ' + need.pos + '; they have spare starters there. Paid from your excess'
                                + (pay.picks.length ? ' + picks' : '') + '.');
                        });
                    });
                });
            });

            // LANE B — the upgrade swap (owner cost-benefit rule): even without
            // surplus to spend, a starter-for-starter swap is worth it when the
            // incoming player at my need position beats the outgoing by a real
            // margin AND the partner needs what I send.
            my.needs.forEach(function (need) {
                partners.forEach(function (pl) {
                    var targets = pl.excess.filter(function (p) { return p.pos === need.pos && (p.value || 0) >= 2000; });
                    if (!targets.length) return;
                    pl.needs.forEach(function (theirNeed) {
                        if (theirNeed.pos === need.pos) return;
                        var mySendables = my.team.players.filter(function (p) {
                            return p.pos === theirNeed.pos && !isUntouchable(p.pid) && (p.value || 0) >= 2000;
                        }).sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
                        mySendables.slice(0, 2).forEach(function (mine) {
                            targets.slice(0, 2).forEach(function (target) {
                                if ((target.value || 0) < (mine.value || 0) * cfg.upgradeMargin) return;
                                consider('Upgrade swap: ' + theirNeed.pos + ' → ' + need.pos, pl, [mine], [], [target], [],
                                    'Straight swap: their ' + need.pos + ' is a clear step up on your ' + theirNeed.pos
                                    + ', and they need ' + theirNeed.pos + '.');
                            });
                        });
                    });
                });
            });

            // LANE C — consolidate excess up (2-for-1 into a better starter),
            // even at positions that aren't flagged needs: turning spare depth
            // into a stronger starting lineup is always on-mission.
            partners.forEach(function (pl) {
                pl.excess.filter(function (p) { return (p.value || 0) >= 3000; }).slice(0, 3).forEach(function (target) {
                    var pairs = combos(my.excess, my.picks, 2, 1).filter(function (c) { return c.players.length === 2 || (c.players.length === 1 && c.picks.length === 1); });
                    pairs.forEach(function (pay) {
                        consider('Consolidate into a better starter', pl, pay.players, pay.picks, [target], [],
                            'Two spare pieces become one stronger starter for you.');
                    });
                });
            });

            // LANE E — spend picks to upgrade (owner addition 2026-09-02): a
            // healthy team with draft capital and no flagged need can still
            // buy a genuinely better starter with picks alone. Burning capital
            // demands a BIGGER lineup step (pickUpgradeMinGain, not the base
            // bar) — a 1st never moves for a rounding-error upgrade. Rebuild
            // windows hoard picks instead: this lane stays closed for them.
            if (!/REBUILD|RETOOL/i.test(String(my.window))) {
                partners.forEach(function (pl) {
                    pl.excess.filter(function (p) { return (p.value || 0) >= 2500; }).slice(0, 3).forEach(function (target) {
                        combos([], my.picks, 0, 2).forEach(function (pay) {
                            if (!pay.picks.length) return;
                            consider('Buy an upgrade with picks', pl, [], pay.picks, [target], [],
                                target.name + ' is a clear step up on a current starter — bought with draft capital, no roster cost.',
                                { minGain: cfg.pickUpgradeMinGain });
                        });
                    });
                });
            }

            // LANE D — window moves: a rebuilding team sells aging excess for
            // real picks; a contender may cash picks for spare starters (that's
            // Lane A/C with picks). Selling starters for picks is ONLY a
            // rebuild-window move — never suggested to a contender.
            if (/REBUILD|RETOOL/i.test(String(my.window))) {
                my.team.players.filter(function (p) {
                    var yrs = primeYearsLeft(p);
                    return yrs != null && yrs <= 1 && (p.value || 0) >= 2500 && !isUntouchable(p.pid);
                }).slice(0, 3).forEach(function (aging) {
                    partners.forEach(function (pl) {
                        combos([], pl.picks, 0, 2).forEach(function (ret) {
                            if (!ret.picks.length) return;
                            consider('Cash aging asset for picks', pl, [aging], [], [], ret.picks,
                                aging.name + ' is at the age cliff — convert him to draft capital while he still prices as a starter.');
                        });
                    });
                });
            }

            deals.sort(function (a, b) { return b.score - a.score || b.acceptance - a.acceptance; });
            return deals.slice(0, cfg.maxResults);
        }

        return { ledger: ledger, recommend: recommend, config: cfg, lineup: lineup };
    }

    root.WrGmTradeEngine = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
