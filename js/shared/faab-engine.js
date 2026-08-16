// ══════════════════════════════════════════════════════════════════
// js/shared/faab-engine.js — window.App.Faab
// League-aware FAAB bidding: what THIS league pays, who else is bidding, and
// the smallest bid that clears them. The redraft application of the Owner-DNA
// idea — model the opponents, not the market.
//
//   analyze({ league, myRosterId, txns, playersData, targetPid,
//             targetPos, targetStrength })
//     → { coldStart, sampleSize, budget, minBid, myLeft, mySpentPct,
//         leagueSpentPct, marketBid, medianBid,
//         ladder: [{ bid, winPct }], rec: { bid, winPct, capped },
//         rivals: [{ rosterId, name, faabLeft, need, aggr, estBid, engaged }],
//         comps:  [{ week, pid, bid, rosterId }] }        // newest first
//
// The model, stated plainly (all tunables are const-hoisted):
//  · Evidence = every FAAB bid this season, WINNING AND LOSING (failed claims
//    carry real willingness-to-pay — WrTxns.getFailedWaivers). Bids normalize
//    to % of starting budget so $200-budget leagues compare to $100 ones.
//  · Market price = a quantile of that bid history, slid by targetStrength
//    (0..1, caller-supplied — e.g. DHQ percentile of the FA pool): a hot add
//    clears the 65th–90th percentile of what this league has ever paid.
//  · Rivals = rosters with a positional need and legal budget. Each gets an
//    estimated bid: market price × their historical aggression (their median
//    bid vs the league's) × need heat, capped by their remaining budget.
//  · winPct(B) = Π over rivals of P(that rival stays under B), a logistic
//    around their estimate, discounted by the chance they sit the claim out.
//  · COLD START: under MIN_SAMPLE bids the league medians are replaced by
//    league-size-agnostic defaults and coldStart=true — the UI must say it is
//    showing league-median guidance, not per-rival reads (same honesty rule
//    as Owner DNA's ≥3-trade gate).
//
// Pure compute (fetch via WrTxns at the call site); Node-testable.
// Warroom-local (direct <script> tag), no vendored mirror.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const MIN_SAMPLE = 15;         // bids needed before per-league medians engage
    const DEFAULT_PCTS = { p25: 4, p50: 8, p75: 15, p90: 25 }; // % of budget, league-agnostic
    const ENGAGE_HIGH = 0.85;      // P(a HIGH-need rival actually bids)
    const ENGAGE_MED = 0.5;
    const LADDER_STEPS = [0.5, 0.75, 1, 1.35, 1.75];
    const WIN_TARGET = 0.6;        // rec = smallest bid clearing this
    const SPEND_CAP = 0.65;        // of my remaining, unless strength ≥ CAP_LIFT
    const CAP_LIFT = 0.8;

    function quantile(sorted, q) {
        if (!sorted.length) return null;
        const i = (sorted.length - 1) * q;
        const lo = Math.floor(i), hi = Math.ceil(i);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
    }

    function rosterName(roster, league) {
        if (!roster) return '—';
        const users = (league && league.users) || [];
        const u = users.find(x => String(x.user_id) === String(roster.owner_id));
        return (roster.metadata && roster.metadata.team_name)
            || (u && u.metadata && u.metadata.team_name)
            || (u && u.display_name)
            || ('Team ' + roster.roster_id);
    }

    // Elimination awareness for CHOPPED leagues. Read lazily: chopped.js loads
    // before this file in the browser and Node tests require it first, but a
    // missing module must degrade to "nobody is eliminated" rather than throw.
    const choppedOf = () => (App && App.Chopped) || null;

    // Positional need from live rosters: healthy bodies at the position vs the
    // dedicated starting slots for it. HIGH = can't fill the slots without this
    // add (or exactly fills them — one injury from a hole), MED = one deep.
    const OUT = new Set(['OUT', 'IR', 'PUP', 'SUS', 'NA', 'COV', 'DOUBTFUL']);
    function needAt(roster, pos, league, playersData) {
        const slots = ((league && league.roster_positions) || []).filter(s => String(s).toUpperCase() === pos).length;
        if (!slots) return 'LOW';
        let healthy = 0;
        const res = new Set((roster.reserve || []).concat(roster.taxi || []));
        for (const pid of (roster.players || [])) {
            if (res.has(pid)) continue;
            const p = playersData && playersData[pid];
            const ppos = (App.normPos && App.normPos(p && p.position)) || (p && p.position);
            if (String(ppos || '').toUpperCase() !== pos) continue;
            if (!OUT.has(String((p && p.injury_status) || '').toUpperCase())) healthy++;
        }
        if (healthy <= slots) return 'HIGH';
        if (healthy === slots + 1) return 'MED';
        return 'LOW';
    }

    // All FAAB bids from a transaction list (winning + losing), % of budget.
    function extractBids(txns, budget) {
        const out = [];
        for (const t of (txns || [])) {
            if (!t || t.type !== 'waiver') continue;
            const bid = Number(t.settings && t.settings.waiver_bid);
            if (!(bid > 0) || !(budget > 0)) continue;
            const rosterId = (t.roster_ids && t.roster_ids[0]) != null ? t.roster_ids[0]
                : (t.adds ? Object.values(t.adds)[0] : null);
            out.push({
                week: Number(t.leg) || null,
                pid: t.adds ? Object.keys(t.adds)[0] : null,
                bid,
                pct: (bid / budget) * 100,
                rosterId,
                won: t.status !== 'failed',
            });
        }
        return out.sort((a, b) => (b.week || 0) - (a.week || 0) || (b.created || 0) - (a.created || 0));
    }

    function analyze(opts) {
        const league = (opts && opts.league) || {};
        const myId = String(opts && opts.myRosterId != null ? opts.myRosterId : '');
        const playersData = opts && opts.playersData;
        const pos = String((opts && opts.targetPos) || '').toUpperCase();
        const strength = Math.max(0, Math.min(1, Number(opts && opts.targetStrength) || 0.5));

        const st = league.settings || {};
        const budget = Number(st.waiver_budget) || 0;
        if (!(budget > 0)) return null;                       // not a FAAB league
        // GM Strategy's user-set minimum-bid override takes precedence over the
        // imported platform value — some leagues/platforms don't expose the
        // real waiver_budget_min reliably.
        const override = Number(opts && opts.minBidOverride);
        // Sleeper's real field is waiver_bid_min (verified live 2026-08-16:
        // owner's league floors bids at $13 there); waiver_budget_min is the
        // import naming other platforms use. Read both — the $1 floor only
        // applies when neither is set.
        const minBid = override > 0 ? Math.max(1, Math.round(override)) : Math.max(1, Number(st.waiver_bid_min ?? st.waiver_budget_min) || 1);

        const rosters = league.rosters || [];
        const mine = rosters.find(r => String(r.roster_id) === myId);
        const leftOf = r => Math.max(0, budget - (Number(r.settings && r.settings.waiver_budget_used) || 0));
        const myLeft = mine ? leftOf(mine) : budget;

        const bids = extractBids(opts && opts.txns, budget);
        const coldStart = bids.length < MIN_SAMPLE;
        const pctsSorted = bids.map(b => b.pct).sort((a, b) => a - b);
        const P = coldStart ? DEFAULT_PCTS : {
            p25: quantile(pctsSorted, 0.25), p50: quantile(pctsSorted, 0.5),
            p75: quantile(pctsSorted, 0.75), p90: quantile(pctsSorted, 0.9),
        };

        // Market price for THIS target: slide the quantile with strength.
        const q = 0.4 + 0.5 * strength;                        // 0.4 .. 0.9
        const marketPct = coldStart
            ? P.p50 + (P.p90 - P.p50) * Math.max(0, (q - 0.5) / 0.4)
            : quantile(pctsSorted, q);
        const marketBid = Math.max(minBid, Math.round((marketPct / 100) * budget));

        // Per-rival aggression: their median bid % vs the league's, 0.5..2.
        const byRoster = {};
        bids.forEach(b => { if (b.rosterId != null) (byRoster[String(b.rosterId)] = byRoster[String(b.rosterId)] || []).push(b.pct); });
        const leagueMed = P.p50 || 1;
        const aggrOf = id => {
            const own = (byRoster[String(id)] || []).sort((a, b) => a - b);
            if (own.length < 2) return 1;
            return Math.max(0.5, Math.min(2, (quantile(own, 0.5) || leagueMed) / leagueMed));
        };

        // A CHOPPED team is not a rival. Its roster is empty (so needAt saw
        // zero bodies and returned HIGH at every position) and its budget is
        // frozen rather than zeroed (so faabLeft stayed large) — which made
        // every eliminated team read as a fully-funded, high-need bidder and
        // inflated the recommendation with each week of the season. In an
        // 18-team chopped league that is 17 ghosts by the end.
        const rivals = rosters
            .filter(r => String(r.roster_id) !== myId)
            .filter(r => { const Ch = choppedOf(); return !(Ch && Ch.isEliminated(r)); })
            .map(r => {
                const need = pos ? needAt(r, pos, league, playersData) : 'MED';
                const faabLeft = leftOf(r);
                const aggr = aggrOf(r.roster_id);
                const engaged = need !== 'LOW' && faabLeft >= minBid;
                const raw = marketBid * aggr * (need === 'HIGH' ? 1.15 : 0.85);
                const estBid = engaged ? Math.max(minBid, Math.min(faabLeft, Math.round(raw))) : 0;
                return { rosterId: r.roster_id, name: rosterName(r, league), faabLeft, need, aggr: Math.round(aggr * 100) / 100, estBid, engaged };
            })
            .sort((a, b) => b.estBid - a.estBid);

        // P(win at bid B): each engaged rival stays under B with logistic prob
        // around their estimate; they also might not bid at all.
        const winPct = B => {
            if (B < minBid) return 0;
            let p = 1;
            for (const r of rivals) {
                if (!r.engaged) continue;
                const sigma = Math.max(2, 0.25 * r.estBid, 0.12 * marketBid);
                const under = 1 / (1 + Math.exp(-(B - r.estBid) / sigma));
                const pEngage = r.need === 'HIGH' ? ENGAGE_HIGH : ENGAGE_MED;
                p *= (1 - pEngage) + pEngage * under;
            }
            return Math.min(0.97, Math.round(p * 100) / 100);
        };

        const ladder = [];
        for (const step of LADDER_STEPS) {
            const bid = Math.max(minBid, Math.min(myLeft, Math.round(marketBid * step)));
            if (!ladder.some(l => l.bid === bid)) ladder.push({ bid, winPct: winPct(bid) });
        }
        ladder.sort((a, b) => a.bid - b.bid);

        // ── Horizon-aware spend cap ──────────────────────────────────
        // Holding budget back only makes sense if you will be alive to spend
        // it. In a CHOPPED league the survival horizon is short and shrinking,
        // and unspent FAAB is simply wasted: in a real 18-team league the
        // three teams that spent nothing went out in weeks 1, 2 and 3, and the
        // champion finished with $565 left while a team eliminated in week 15
        // still held $4,213. So the cap relaxes toward "spend it" as the
        // expected weeks remaining fall. No horizon supplied → unchanged.
        const horizonWeeks = Number(opts && opts.horizonWeeks) || null;
        const horizonCap = (() => {
            if (!(horizonWeeks > 0)) return SPEND_CAP;
            if (horizonWeeks <= 1.5) return 1;              // last stand — hold nothing back
            if (horizonWeeks <= 3) return 0.9;
            if (horizonWeeks <= 5) return 0.8;
            return SPEND_CAP;
        })();
        // Recommendation: smallest whole bid clearing WIN_TARGET, spend-capped.
        const cap = strength >= CAP_LIFT ? myLeft : Math.max(minBid, Math.round(myLeft * horizonCap));
        let rec = null;
        for (let B = minBid; B <= cap; B++) {
            if (winPct(B) >= WIN_TARGET) { rec = { bid: B, winPct: winPct(B), capped: false }; break; }
        }
        if (!rec) rec = { bid: Math.min(cap, myLeft), winPct: winPct(Math.min(cap, myLeft)), capped: true };

        const spentPct = r => budget ? Math.round(((budget - leftOf(r)) / budget) * 100) : 0;
        // Average over LIVE teams only — a chopped team's spend is frozen, so
        // counting corpses drags league spend down every week and makes the
        // market read cheaper than it is.
        const liveRosters = rosters.filter(r => { const Ch = choppedOf(); return !(Ch && Ch.isEliminated(r)); });
        const leagueSpent = liveRosters.length
            ? Math.round(liveRosters.reduce((s, r) => s + spentPct(r), 0) / liveRosters.length) : 0;

        // Burn rate vs the horizon: what you can afford to spend per week, and
        // what you are on track to LEAVE ON THE TABLE if you keep pacing at
        // the league's average weekly outlay.
        const pacing = (horizonWeeks > 0) ? (() => {
            const perWeek = Math.round(myLeft / horizonWeeks);
            // League's average weekly spend so far, as a pace comparison.
            const weeksPlayed = Math.max(1, Math.max(...bids.map(b => b.week || 0), 0));
            const myBids = bids.filter(b => String(b.rosterId) === myId && b.won);
            const mySpend = myBids.reduce((s, b) => s + b.bid, 0);
            const myPace = Math.round(mySpend / weeksPlayed);
            const projectedUnspent = Math.max(0, Math.round(myLeft - myPace * horizonWeeks));
            return {
                horizonWeeks: Math.round(horizonWeeks * 10) / 10,
                affordPerWeek: perWeek,
                myPacePerWeek: myPace,
                projectedUnspent,
                cap: horizonCap,
                // Hoarding is the failure mode this format punishes.
                verdict: projectedUnspent > budget * 0.25 ? 'hoarding'
                    : projectedUnspent > budget * 0.1 ? 'slightly-under'
                    : 'on-pace',
            };
        })() : null;

        return {
            coldStart, sampleSize: bids.length,
            budget, minBid, myLeft, pacing,
            mySpentPct: mine ? spentPct(mine) : 0,
            leagueSpentPct: leagueSpent,
            marketBid, medianBid: Math.max(1, Math.round((leagueMed / 100) * budget)),
            ladder, rec, rivals,
            comps: bids.filter(b => b.won).slice(0, 8),
        };
    }

    App.Faab = App.Faab || { analyze, extractBids, needAt, quantile };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.Faab;
})(typeof window !== 'undefined' ? window : globalThis);
