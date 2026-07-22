// ══════════════════════════════════════════════════════════════════
// js/tabs/alex-insights.js — AlexInsightsTab: personalized pattern
// recognition & performance analytics. "Option A" placement: new
// top-level tab with sub-tabs Overview / Patterns / Decision History
// / Model Settings.
//
// Depends on: window.WR.* primitives (wr-primitives.js),
//             window.App.LI (playerScores, tradeHistory, draftOutcomes, championships),
//             window.S (transactions, rosters, matchups, leagueUsers).
// Exposes:    window.AlexInsightsTab
// ══════════════════════════════════════════════════════════════════

(function () {
    const h = React.createElement;
    const { useState, useEffect } = React;
    const avPick = (seed, arr) => (window.AlexVoice ? window.AlexVoice.pick(seed, arr) : arr[0]);

    // ── Settings access ───────────────────────────────────────────
    // Delegates to window.WR.AlexSettings so every Alex surface shares
    // the same tuning. Falls back to a safe inline default if the helper
    // hasn't loaded yet (e.g., script-order edge case).
    const DEFAULT_SETTINGS = (window.WR?.AlexSettings?.DEFAULTS) || {
        alertThreshold: 70, maxAlertsPerWeek: 6, minPointsDelta: 2.5, tradeAggression: 50,
        focus: { startSit: true, trades: true, waivers: true, draft: true, injury: false, streaming: false, gmStyle: false },
        channel: { inApp: true, email: false, push: false },
    };
    function loadSettings() { return window.WR?.AlexSettings?.get?.() || { ...DEFAULT_SETTINGS }; }
    function saveSettings(s) {
        if (window.WR?.AlexSettings?.save) window.WR.AlexSettings.save(s);
        else try { localStorage.setItem('wr_alex_settings', JSON.stringify(s)); } catch (_) {}
    }

    // ── KPI computations ──────────────────────────────────────────
    // Best-effort from data already in window.App.LI / window.S. Fields
    // we don't have yet return null so the tile shows a dash.
    function computeKpis({ myRoster, currentLeague, playersData }) {
        const LI = window.App?.LI || {};
        const myRid = myRoster?.roster_id;

        // Trade success: net DHQ delta across all trades I was part of.
        // tradeWins = trades with a positive net for me — the real per-trade
        // win rate (never a fabricated 100/65/40 heuristic).
        let tradeNetDhq = 0, tradeCount = 0, tradeWins = 0;
        (LI.tradeHistory || []).forEach(t => {
            if (!t.sides || !t.sides[myRid]) return;
            tradeCount++;
            const myIn = (t.sides[myRid].players || []).reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
            // Sum of what I gave — players on the OTHER side(s)
            let myOut = 0;
            Object.entries(t.sides).forEach(([rid, side]) => {
                if (String(rid) === String(myRid)) return;
                (side.players || []).forEach(pid => { myOut += LI.playerScores?.[pid] || 0; });
            });
            const net = myIn - myOut;
            tradeNetDhq += net;
            if (net > 0) tradeWins++;
        });

        // Waiver hit rate: % of waiver/FA adds still on my roster.
        const txns = [];
        const txnMap = window.S?.transactions || {};
        if (txnMap && typeof txnMap === 'object' && !Array.isArray(txnMap)) {
            Object.values(txnMap).forEach(arr => { if (Array.isArray(arr)) txns.push(...arr); });
        }
        const myPlayers = new Set(myRoster?.players || []);
        let waiverTotal = 0, waiverKept = 0;
        txns.forEach(t => {
            if (t.type !== 'waiver' && t.type !== 'free_agent') return;
            if (!t.adds) return;
            Object.entries(t.adds).forEach(([pid, rid]) => {
                if (String(rid) !== String(myRid)) return;
                waiverTotal++;
                if (myPlayers.has(pid)) waiverKept++;
            });
        });
        const waiverHitPct = waiverTotal > 0 ? Math.round((waiverKept / waiverTotal) * 100) : null;

        // Draft hit rate: % of my drafted players now worth ≥3000 DHQ (contributor threshold).
        const draftPicks = (LI.draftOutcomes || []).filter(d => String(d.roster_id) === String(myRid));
        let draftHits = 0;
        draftPicks.forEach(d => {
            const dhq = LI.playerScores?.[d.pid] || 0;
            if (dhq >= 3000) draftHits++;
        });
        const draftHitPct = draftPicks.length > 0 ? Math.round((draftHits / draftPicks.length) * 100) : null;

        // Best decision type: whichever hit rate is highest and has a sample.
        const candidates = [
            { label: 'TRADES',  pct: tradeCount >= 1 ? Math.round((tradeWins / tradeCount) * 100) : null },
            { label: 'WAIVERS', pct: waiverHitPct },
            { label: 'DRAFT',   pct: draftHitPct },
        ].filter(c => c.pct != null).sort((a, b) => b.pct - a.pct);
        const best = candidates[0];

        // GM Grade — composite 0-100 score across the dimensions we DO have.
        // Trade ROI: anchor at 50, +/- 10 points per 1k DHQ swing (capped 0-100).
        // Waiver hit% and draft hit% feed in directly. Sample-size gating keeps
        // a single trade from yielding "A+".
        const tradeScore = tradeCount >= 3
            ? Math.max(0, Math.min(100, 50 + (tradeNetDhq / 1000) * 10))
            : null;
        const components = [tradeScore, waiverHitPct, draftHitPct].filter(v => v != null);
        const gmScoreNum = components.length
            ? Math.round(components.reduce((s, v) => s + v, 0) / components.length)
            : null;

        return {
            gmScore: gmScoreNum,
            gmScoreSample: components.length, // how many dimensions fed the score
            tradeNetDhq,
            tradeCount,
            waiverHitPct,
            waiverKept,
            waiverTotal,
            draftHitPct,
            draftHits,
            draftTotal: draftPicks.length,
            bestType: best ? best.label : null,
            bestPct: best ? best.pct : null,
        };
    }

    function gmGradeLetter(score) {
        if (score == null) return '\u2014';
        if (score >= 90) return 'A+';
        if (score >= 80) return 'A';
        if (score >= 70) return 'B+';
        if (score >= 60) return 'B';
        if (score >= 50) return 'C+';
        if (score >= 40) return 'C';
        if (score >= 30) return 'D';
        return 'F';
    }
    function gmGradeTone(score) {
        if (score == null) return 'mute';
        if (score >= 70) return 'win';
        if (score >= 50) return 'gold';
        return 'loss';
    }

    // ── Insight generation ────────────────────────────────────────
    // Each heuristic returns a card-compatible object or pushes nothing.
    // All carry a `focus` tag so WR.AlexSettings.filterInsights can hide
    // them when the user disables that focus area. Confidence values are
    // calibrated so the alert-threshold slider reads intuitively.
    function computeInsights(props, kpis) {
        const { myRoster, currentLeague, playersData } = props;
        const LI = window.App?.LI || {};
        const myRid = myRoster?.roster_id;
        const out = [];
        const rosterCount = (currentLeague?.rosters || []).length || 12;
        // Position peak-age windows (e.g. RB peak ≈ 24-26). Lazy-loaded by ReconAI;
        // fall back to an empty object so default [24, 29] kicks in.
        const peaks = (window.App && window.App.peakWindows) || {};

        // ── Trades ────────────────────────────────────────────────
        const allTrades = LI.tradeHistory || [];
        const leagueTradeAvg = allTrades.length / Math.max(1, rosterCount) * 2;
        if (kpis.tradeCount != null && leagueTradeAvg > 0 && kpis.tradeCount < leagueTradeAvg * 0.5) {
            out.push({
                focus: 'trades', severity: 'opportunity', confidence: 78,
                title: 'You trade less than half as often as your league',
                // Only claim their trades are good when the ledger says so.
                body: kpis.tradeCount + ' trade' + (kpis.tradeCount === 1 ? '' : 's') + ' against a league average of ~' + Math.round(leagueTradeAvg) + ' \u2014 ' + (kpis.tradeNetDhq > 0
                    ? 'you win when you deal, so more reps is value you\u2019re leaving on the table.'
                    : 'more reps on the trade market is the fastest lever you\u2019re not pulling.'),
                ctaLabel: 'Explore trade targets',
            });
        }
        if (kpis.tradeCount >= 3 && kpis.tradeNetDhq > 0) {
            out.push({
                focus: 'trades', severity: 'edge', confidence: 84,
                title: 'Your trades net +' + (kpis.tradeNetDhq / 1000).toFixed(1) + 'k DHQ across ' + kpis.tradeCount + ' deals',
                body: 'Keep hunting deals \u2014 this is your highest-ROI activity.',
                ctaLabel: 'Continue & scale',
            });
        }
        if (kpis.tradeCount >= 3 && kpis.tradeNetDhq < -1000) {
            out.push({
                focus: 'trades', severity: 'warning', confidence: 82,
                title: 'Your trades are net -' + Math.abs(Math.round(kpis.tradeNetDhq / 1000)) + 'k DHQ',
                body: 'Across ' + kpis.tradeCount + ' trades you\u2019re giving up more than you get \u2014 run proposals through the Trade Center analyzer before accepting.',
                ctaLabel: 'Review trade history',
            });
        }
        // NEW: Trade partner diversity (concentration OR notable breadth)
        if (kpis.tradeCount >= 4 && myRid != null) {
            const partnerCounts = {};
            allTrades.forEach(t => {
                if (!t.sides || !t.sides[myRid]) return;
                Object.keys(t.sides).forEach(rid => {
                    if (String(rid) !== String(myRid)) partnerCounts[rid] = (partnerCounts[rid] || 0) + 1;
                });
            });
            const partners = Object.entries(partnerCounts).sort((a, b) => b[1] - a[1]);
            const top2Share = partners.length ? (partners.slice(0, 2).reduce((s, p) => s + p[1], 0) / kpis.tradeCount) : 0;
            if (top2Share >= 0.6 && partners.length >= 3) {
                out.push({
                    focus: 'trades', severity: 'pattern', confidence: 72,
                    title: 'Most of your trades go through just 2 managers',
                    body: Math.round(top2Share * 100) + '% of your ' + kpis.tradeCount + ' trades sit with 2 of ' + partners.length + ' partners — broaden the pool and the mismatched-need deals open up.',
                    ctaLabel: 'See all owners',
                });
            } else if (partners.length >= Math.min(10, rosterCount - 2)) {
                out.push({
                    focus: 'trades', severity: 'edge', confidence: 78,
                    title: 'You\u2019ve traded with ' + partners.length + ' different owners',
                    body: 'You\u2019re working the whole room across ' + kpis.tradeCount + ' deals, not a couple of usual suspects \u2014 breadth is where mismatched needs surface.',
                    ctaLabel: 'Keep hunting',
                });
            }
        }
        // NEW: Prolific trader flag
        if (kpis.tradeCount >= 30) {
            out.push({
                focus: 'trades', severity: 'edge', confidence: 75,
                title: 'You\u2019re a high-volume trader (' + kpis.tradeCount + ' deals)',
                body: 'Most managers in this league sit under 20 deals \u2014 stay disciplined, volume without net value is churn.',
                ctaLabel: 'Open Trade Center',
            });
        }

        // ── Waivers / FA ──────────────────────────────────────────
        if (kpis.waiverHitPct != null && kpis.waiverHitPct >= 50 && kpis.waiverTotal >= 5) {
            out.push({
                focus: 'waivers', severity: 'edge', confidence: 80,
                title: 'You retain ' + kpis.waiverHitPct + '% of your waiver adds',
                body: 'That\u2019s above league-average stickiness \u2014 keep adding aggressively at the position-scarcity windows.',
                ctaLabel: 'Continue & scale',
            });
        }
        if (kpis.waiverHitPct != null && kpis.waiverHitPct < 25 && kpis.waiverTotal >= 6) {
            out.push({
                focus: 'waivers', severity: 'pattern', confidence: 78,
                title: 'Your waiver retention rate is ' + kpis.waiverHitPct + '%',
                body: Math.round(kpis.waiverTotal - kpis.waiverKept) + ' of ' + kpis.waiverTotal + ' waiver/FA adds were dropped within weeks — run DHQ + tier checks before burning FAAB.',
                ctaLabel: 'Review FAAB log',
            });
        }
        // NEW: FAAB usage pattern
        const myFaab = myRoster?.settings?.waiver_budget_used || 0;
        const budget = currentLeague?.settings?.waiver_budget || 100;
        if (budget > 0) {
            const spentPct = myFaab / budget;
            // Compute league avg spend
            let leagueSpent = 0, managerCount = 0;
            (currentLeague?.rosters || []).forEach(r => {
                if (r.settings?.waiver_budget_used != null) {
                    leagueSpent += r.settings.waiver_budget_used;
                    managerCount++;
                }
            });
            const leagueAvgPct = managerCount > 0 ? (leagueSpent / (managerCount * budget)) : 0;
            if (spentPct < 0.15 && leagueAvgPct > 0.35) {
                out.push({
                    focus: 'waivers', severity: 'opportunity', confidence: 72,
                    title: 'You\u2019re sitting on ' + Math.round((1 - spentPct) * 100) + '% of your FAAB',
                    body: 'League average is ' + Math.round(leagueAvgPct * 100) + '% spent \u2014 unspent FAAB is worth nothing in December, so bid aggressively on the impact adds you\u2019re tracking.',
                    ctaLabel: 'Open Free Agency',
                });
            }
            if (spentPct > 0.85 && (currentLeague?.settings?.waiver_budget > 0)) {
                out.push({
                    focus: 'waivers', severity: 'warning', confidence: 70,
                    title: 'You\u2019ve burned ' + Math.round(spentPct * 100) + '% of your FAAB',
                    body: 'Only $' + Math.round(budget * (1 - spentPct)) + ' left \u2014 conserve it for clear playoff-push upgrades.',
                    ctaLabel: 'Review waiver log',
                });
            }
        }

        // ── Draft ─────────────────────────────────────────────────
        // Relaxed sample thresholds — users often have 5\u20137 picks visible,
        // not 10+, and still deserve signal when their pattern is clear.
        if (kpis.draftHitPct != null && kpis.draftTotal >= 5 && kpis.draftHitPct < 30) {
            out.push({
                focus: 'draft', severity: 'pattern', confidence: 82,
                title: 'Your draft hit rate (' + kpis.draftHitPct + '%) trails starter caliber',
                body: 'Only ' + kpis.draftHits + ' of ' + kpis.draftTotal + ' picks reached contributor DHQ (3000+) \u2014 lean harder on DHQ rankings over gut in rounds 1\u20133.',
                ctaLabel: 'Review draft board',
            });
        }
        if (kpis.draftHitPct != null && kpis.draftTotal >= 5 && kpis.draftHitPct >= 55) {
            out.push({
                focus: 'draft', severity: 'edge', confidence: 80,
                title: 'Your drafts hit ' + kpis.draftHitPct + '% \u2014 elite',
                body: kpis.draftHits + '/' + kpis.draftTotal + ' picks reached contributor DHQ \u2014 you\u2019re outdrafting the league, so prioritize draft capital in any trade.',
                ctaLabel: 'See pick values',
            });
        }
        // NEW: Position bias in drafting — lowered from 8 picks / 45% to 5 picks / 40%.
        const draftPicks = (LI.draftOutcomes || []).filter(d => String(d.roster_id) === String(myRid));
        if (draftPicks.length >= 5) {
            const byPos = {};
            draftPicks.forEach(d => { byPos[d.pos] = (byPos[d.pos] || 0) + 1; });
            const topPos = Object.entries(byPos).sort((a, b) => b[1] - a[1])[0];
            if (topPos && topPos[1] / draftPicks.length >= 0.4) {
                out.push({
                    focus: 'draft', severity: 'pattern', confidence: 74,
                    title: 'You draft ' + topPos[0] + ' ' + Math.round(topPos[1] / draftPicks.length * 100) + '% of the time',
                    body: topPos[1] + ' of your ' + draftPicks.length + ' career picks went to ' + topPos[0] + ' \u2014 concentration that heavy starves depth elsewhere.',
                    ctaLabel: 'Open Roster Analytics',
                });
            }
        }

        // ── GM style / roster ─────────────────────────────────────
        const myPlayers = myRoster?.players || [];
        const totalDhq = myPlayers.reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
        const agingPids = myPlayers.filter(pid => {
            const p = playersData?.[pid]; if (!p) return false;
            const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
                ? window.App.getValueWindowEnd(p.position)
                : ((window.App?.peakWindows || {})[p.position] || [24, 29])[1];
            return p.age && p.age > valueEnd;
        });
        const agingDhq = agingPids.reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
        if (totalDhq > 0 && agingDhq / totalDhq > 0.25) {
            out.push({
                focus: 'gmStyle', severity: 'warning', confidence: 91,
	                title: Math.round((agingDhq / totalDhq) * 100) + '% of your roster DHQ is past the value window',
	                body: agingPids.length + ' players sit past their position\u2019s value window \u2014 cash in now or commit to the rebuild.',
                ctaLabel: 'See aging assets',
            });
        }
        // Elite concentration — uses the canonical "7000+ DHQ or top-5 at position" rule
        // exposed by ReconAI via window.App.countElitePlayers, falling back to
        // a 7000+ DHQ threshold only when that helper isn't loaded.
        const eliteCount = typeof window.App?.countElitePlayers === 'function'
            ? window.App.countElitePlayers(myPlayers)
            : myPlayers.filter(pid => (LI.playerScores?.[pid] || 0) >= 7000).length;
        if (myPlayers.length >= 10 && eliteCount === 0) {
            out.push({
                focus: 'gmStyle', severity: 'warning', confidence: 85,
                title: 'Your roster has zero elite-tier players',
                body: 'Championship cores run on 2\u20134 elites (7000+ DHQ or top-5 at position) \u2014 flip mid-tier depth and picks for a cornerstone.',
                ctaLabel: 'Find a cornerstone target',
            });
        } else if (eliteCount >= 4) {
            out.push({
                focus: 'gmStyle', severity: 'edge', confidence: 80,
                title: 'You hold ' + eliteCount + ' elite-tier players',
                body: 'Protect this core \u2014 prioritize ageing-RB insurance and FLEX depth before chasing another star.',
                ctaLabel: 'Stabilize lineup',
            });
        }
        // NEW: Rebuild tier + young stud surplus (rebuilder edge)
        const risingPids = myPlayers.filter(pid => {
            const p = playersData?.[pid]; if (!p || !p.age) return false;
            const pk = peaks[p.position] || [24, 29];
            return p.age < pk[0] && (LI.playerScores?.[pid] || 0) >= 4000;
        });
        if (risingPids.length >= 3 && eliteCount < 2) {
            out.push({
                focus: 'gmStyle', severity: 'opportunity', confidence: 76,
                title: 'You\u2019re sitting on ' + risingPids.length + ' rising mid-tier players',
                body: 'Pre-peak 4000+ DHQ players are your highest-appreciation assets \u2014 if you aren\u2019t contending, bundle two for a proven elite now.',
                ctaLabel: 'Explore consolidation trades',
            });
        }

        // ── Start/Sit — lineup efficiency ────────────────────────
        // Proxy via window.S.matchups: compare actual points vs optimal.
        try {
            const matchups = Array.isArray(window.S?.matchups) ? window.S.matchups : [];
            const mine = matchups.filter(m => m.roster_id === myRid && m.points != null);
            if (mine.length >= 4) {
                // Optimal isn't in the payload, but we can flag low-scoring weeks vs opponents.
                const avg = mine.reduce((s, m) => s + (m.points || 0), 0) / mine.length;
                const minDelta = Number(window.WR?.AlexSettings?.get?.()?.minPointsDelta ?? DEFAULT_SETTINGS.minPointsDelta ?? 0);
                const lowWeekDeltas = mine
                    .map(m => avg - (m.points || 0))
                    .filter(delta => delta >= Math.max(avg * 0.25, minDelta));
                const lowWeeks = lowWeekDeltas.length;
                if (lowWeeks >= 3) {
                    out.push({
                        focus: 'startSit', severity: 'pattern', confidence: 70,
                        pointsDelta: Math.max(...lowWeekDeltas),
                        title: lowWeeks + ' of ' + mine.length + ' weeks were 25%+ below your average',
                        body: 'Lineup variance is eating wins \u2014 pre-commit starters with the Compare tab\u2019s matchup view.',
                        ctaLabel: 'Open Compare',
                    });
                }
            }
        } catch (_) {}

        // ── Injury behavior ──────────────────────────────────────
        const injuredHigh = myPlayers.filter(pid => {
            const p = playersData?.[pid];
            const dhq = LI.playerScores?.[pid] || 0;
            return p?.injury_status && ['IR', 'Out', 'Doubtful'].includes(p.injury_status) && dhq >= 3000;
        });
        if (injuredHigh.length >= 2) {
            out.push({
                focus: 'injury', severity: 'warning', confidence: 73,
                title: injuredHigh.length + ' high-DHQ players are injured',
                body: 'Deploy IR slots and hunt short-term-upside replacements before the news breaks league-wide.',
                ctaLabel: 'Open Free Agency',
            });
        }

        // NEW: FAAB restraint while winning on the trade market (gmStyle edge)
        if (budget > 0 && (myFaab / budget) < 0.3 && kpis.tradeCount >= 10 && (kpis.tradeNetDhq || 0) > 0) {
            out.push({
                focus: 'gmStyle', severity: 'edge', confidence: 70,
                title: 'You win value on the trade market without leaning on FAAB',
                body: 'Only ' + Math.round((myFaab / budget) * 100) + '% of your FAAB spent and still a positive trade ledger \u2014 trade-first managers beat FAAB-first in dynasty.',
                ctaLabel: 'Keep trading',
            });
        }

        // ── Streaming K/DEF ──────────────────────────────────────
        const streamables = myPlayers.filter(pid => {
            const p = playersData?.[pid];
            return p && (p.position === 'K' || p.position === 'DEF');
        });
        // Only nag about K/DEF in leagues that actually start those slots.
        const kdefSlots = (currentLeague?.roster_positions || []).some(s => {
            const slot = String(s).toUpperCase();
            return slot === 'K' || slot === 'DEF' || slot === 'DST' || slot === 'D/ST';
        });
        if (streamables.length === 0 && kdefSlots) {
            out.push({
                focus: 'streaming', severity: 'opportunity', confidence: 60,
                title: 'You don\u2019t roster a K or DEF',
                body: 'Stream them weekly by matchup \u2014 an empty slot can cost you 6\u20138 points a week.',
                ctaLabel: 'Check Free Agency',
            });
        }

        // ── GM Strategy alignment ────────────────────────────────
        // Framed against the CHOSEN plan (WR.GmMode.effects), not the roster
        // grade. Hard cap of 3 strategy cards here; AlexSettings.filterInsights
        // still applies the global maxAlertsPerWeek cap downstream. Guarded —
        // gm-mode.js is optional and this stays inert without a saved strategy.
        try {
            const gmFx = typeof window.WR?.GmMode?.effects === 'function'
                ? window.WR.GmMode.effects(currentLeague?.league_id || currentLeague?.id)
                : null;
            if (gmFx && gmFx.hasStrategy) {
                const gmCards = [];
                // 1. Strategy drift — GMStrategy.recordAction logs moves that
                // conflict with the plan; getDrift is that (previously unread) ledger.
                const drift = window.GMStrategy?.getDrift?.() || { conflicts: [] };
                const recentConflicts = (drift.conflicts || []).filter(c => Date.now() - (c.timestamp || 0) < 14 * 24 * 60 * 60 * 1000);
                if (recentConflicts.length >= 2) {
                    gmCards.push({
                        focus: 'gmStyle', severity: 'warning', confidence: 82,
                        title: recentConflicts.length + ' of your recent moves cut against your ' + gmFx.modeLabel + ' plan',
                        body: 'Recommit to the plan or update it — a strategy you trade against steers every surface wrong'
                            + (recentConflicts[0]?.reasons?.length ? ' (latest: ' + recentConflicts[0].reasons[0] + ')' : '') + '.',
                        ctaLabel: 'Review GM Strategy',
                    });
                }
                // 2. Aging core vs a long-horizon plan.
                if ((gmFx.mode === 'rebuild' || gmFx.timeline === 'dynasty_long') && totalDhq > 0 && agingDhq / totalDhq > 0.2) {
                    gmCards.push({
                        focus: 'gmStyle', severity: 'warning', confidence: 78,
                        title: Math.round((agingDhq / totalDhq) * 100) + '% of your value sits in vets your ' + gmFx.modeLabel + ' plan says to move',
                        body: agingPids.length + ' player' + (agingPids.length === 1 ? ' sits' : 's sit') + ' past the value window — convert them to picks and youth before the market does it for you.',
                        ctaLabel: 'Open Trade Center',
                    });
                }
                // 3. Sell-rule / sell-position players still rostered.
                const parseRule = window.GMStrategy?.parseSellRule;
                const rules = (gmFx.sellRules || [])
                    .map(r => { try { return parseRule ? parseRule(r) : null; } catch (_) { return null; } })
                    .filter(r => r && (r.pos || r.ageAbove));
                const sellPosSet = gmFx.sellPositions instanceof Set ? gmFx.sellPositions : new Set();
                const untouchSet = gmFx.untouchable instanceof Set ? gmFx.untouchable : new Set();
                if (rules.length || sellPosSet.size) {
                    const flagged = myPlayers.filter(pid => {
                        if (untouchSet.has(String(pid))) return false;
                        const p = playersData?.[pid]; if (!p) return false;
                        const pPos = window.App?.normPos?.(p.position) || p.position;
                        if (sellPosSet.has(pPos)) return true;
                        return rules.some(r => (!r.pos || r.pos === pPos) && (!r.ageAbove || (p.age && p.age >= r.ageAbove)));
                    });
                    if (flagged.length >= 2) {
                        gmCards.push({
                            focus: 'gmStyle', severity: 'opportunity', confidence: 74,
                            title: flagged.length + ' rostered players trip your own sell rules',
                            body: 'Shop the ones with real markets — sell rules only pay off when you act on them.',
                            ctaLabel: 'See flagged players',
                        });
                    }
                }
                gmCards.slice(0, 3).forEach(c => out.push(c));
            }
        } catch (_) { /* strategy layer is optional */ }

        // Priority-sort (warning → edge → pattern → opportunity).
        const priority = { warning: 0, edge: 1, pattern: 2, opportunity: 3 };
        out.sort((a, b) => (priority[a.severity] ?? 9) - (priority[b.severity] ?? 9));
        return out;
    }

    function getInsightsLeagueProfile(props) {
        const currentLeague = props?.currentLeague
            || window.S?.leagues?.find(l => l.league_id === window.S?.currentLeagueId)
            || window.S?.leagues?.[0]
            || null;
        if (!currentLeague || typeof window.App?.Intelligence?.buildLeagueProfile !== 'function') return null;
        return window.App.Intelligence.buildLeagueProfile({
            league: currentLeague,
            rosters: currentLeague?.rosters || window.S?.rosters || [],
            platform: window.S?.platform || currentLeague?._platform,
        });
    }

    function decorateInsightRecommendations(insights, props, kpis, source) {
        if (typeof window.App?.Intelligence?.buildBehavioralRecommendation !== 'function') return insights || [];
        const profile = getInsightsLeagueProfile(props);
        return (insights || []).map((ins, index) => {
            const titleSlug = String(ins?.title || index).replace(/\W+/g, '_').toLowerCase().slice(0, 48);
            const intelligence = window.App.Intelligence.buildBehavioralRecommendation({
                id: 'alex_' + (source || 'heuristic') + '_' + index + '_' + titleSlug,
                focus: ins?.focus,
                severity: ins?.severity,
                confidence: ins?.confidence,
                title: ins?.title,
                body: ins?.body,
                profile,
                kpis,
                evidenceDetail: (source === 'ai' ? 'AI-generated ' : 'Deterministic ') + 'behavioral read grounded in decision history.',
                badge: ins?.severity,
            });
            const whyView = typeof window.App?.Intelligence?.buildWhyView === 'function'
                ? window.App.Intelligence.buildWhyView(intelligence, { title: 'Why this insight', limit: 3 })
                : null;
            const recommendationWhy = whyView?.lines || (typeof window.App?.Intelligence?.recommendationWhyLines === 'function'
                ? window.App.Intelligence.recommendationWhyLines(intelligence, 3)
                : []);
            return { ...ins, intelligence, whyView, recommendationWhy };
        });
    }

    function publishInsightRecommendations(insights, surface) {
        if (typeof window.App?.Intelligence?.publishRecommendations !== 'function') return;
        window.App.Intelligence.publishRecommendations(
            'alex-insights',
            (insights || []).map(ins => ins.intelligence).filter(Boolean),
            { surface: surface || 'gm-office' }
        );
    }

    // ── AI-generated novel insights ───────────────────────────────
    // Asks Alex (via window.dhqAI) to produce 1-2 *novel* behavioral
    // insights that don't overlap with the heuristic pool. Cached for
    // 24h to keep LLM spend reasonable. Result shape is compatible
    // with the heuristic insights so they render in the same card grid.
    const AI_CACHE_KEY = 'wr_alex_ai_insights';
    const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    function getLeagueId(props) {
        return props?.currentLeague?.id || props?.currentLeague?.league_id || window.S?.currentLeagueId || window.S?.currentLeague?.league_id || window.S?.currentLeague?.id || 'global';
    }

    function getAiCacheKey(props) {
        const leagueId = getLeagueId(props);
        const user = window.OD?.getCurrentUsername?.() || window.S?.user?.username || window.S?.user?.display_name || 'anon';
        return AI_CACHE_KEY + ':' + user + ':' + leagueId;
    }

    function loadCachedAiInsights(props) {
        try {
            const raw = JSON.parse(localStorage.getItem(getAiCacheKey(props)) || 'null');
            if (!raw || !raw.ts) return { insights: [], ts: 0 };
            if (Date.now() - raw.ts > AI_CACHE_TTL_MS) return { insights: [], ts: 0 };
            return raw;
        } catch (_) { return { insights: [], ts: 0 }; }
    }
    function saveCachedAiInsights(props, insights) {
        try { localStorage.setItem(getAiCacheKey(props), JSON.stringify({ insights, ts: Date.now() })); } catch (_) {}
    }
    function clearCachedAiInsights(props) { try { localStorage.removeItem(getAiCacheKey(props)); } catch (_) {} }

    async function generateAiInsights({ myRoster, currentLeague, playersData }, kpis, heuristicTitles) {
        const structuredFn = (window.OD?.callAI && window.WR?.AIContext) ? window.OD.callAI : null;
        const aiFn = typeof window.dhqAI === 'function' ? window.dhqAI : null;
        if (!structuredFn && !aiFn) return { error: 'AI not loaded' };

        // Build compact context: KPIs + recent trades + roster snapshot.
        const LI = window.App?.LI || {};
        const topHolds = (myRoster?.players || [])
            .map(pid => ({ pid, dhq: LI.playerScores?.[pid] || 0, name: playersData?.[pid]?.full_name, pos: playersData?.[pid]?.position, age: playersData?.[pid]?.age }))
            .sort((a, b) => b.dhq - a.dhq).slice(0, 6);
        const recentTrades = (LI.tradeHistory || [])
            .filter(t => t.sides && t.sides[myRoster?.roster_id])
            .slice(0, 3)
            .map(t => {
                const mine = (t.sides[myRoster.roster_id].players || []).map(pid => playersData?.[pid]?.full_name || pid).join(', ');
                const partners = Object.entries(t.sides).filter(([rid]) => String(rid) !== String(myRoster.roster_id));
                const theirs = partners.flatMap(([, side]) => (side.players || []).map(pid => playersData?.[pid]?.full_name || pid)).join(', ');
                return '- Traded ' + (mine || 'picks') + ' for ' + (theirs || 'picks');
            }).join('\n');

        // Preferred path: the structured `insight` route. The edge function
        // wraps it with league-format detection, team-mode rules, and quality
        // gates, runs it on the fast tier, and server-caches it 24h (uncounted
        // against the plan's request allowance).
        if (structuredFn) {
            try {
                const assessment = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
                const context = {
                    ...window.WR.AIContext.buildStructuredBase(currentLeague, assessment, myRoster),
                    kpis: {
                        trades: (kpis.tradeCount || 0) + ' completed, net DHQ ' + (kpis.tradeNetDhq > 0 ? '+' : '') + Math.round((kpis.tradeNetDhq || 0) / 1000) + 'k',
                        waivers: kpis.waiverHitPct != null ? (kpis.waiverHitPct + '% retention over ' + kpis.waiverTotal + ' adds') : 'n/a',
                        draft: kpis.draftHitPct != null ? (kpis.draftHitPct + '% hit rate over ' + kpis.draftTotal + ' picks') : 'n/a',
                    },
                    topHolds: topHolds.map(p => ({ name: p.name || String(p.pid), pos: p.pos || '?', age: p.age, value: p.dhq })),
                    recentTrades: recentTrades ? recentTrades.split('\n').map(s => ({ summary: s.replace(/^- /, '') })) : [],
                    heuristicTitles: heuristicTitles || [],
                };
                const result = await structuredFn({ type: 'insight', context });
                const parsed = Array.isArray(result?.insights) ? result.insights : extractJsonArray(result?.analysis);
                if (parsed) return { insights: normalizeAiInsights(parsed) };
            } catch (e) { window.wrLog?.('alexInsights.structured', e); }
        }
        if (!aiFn) return { error: 'AI not loaded' };

        // GM Strategy — the canonical serialized plan; '' when none is saved.
        // (The structured path above carries it via buildStructuredBase.)
        let gmBlock = '';
        try { gmBlock = window.WR?.GmMode?.promptBlock?.(currentLeague?.league_id || currentLeague?.id) || ''; } catch (_) {}

        const contextLines = [
            (window.WR?.AIContext?.buildFormatPreamble?.(currentLeague) || ''),
            gmBlock ? 'GM STRATEGY (the owner’s committed plan — frame insights against it):\n' + gmBlock : '',
            'LEAGUE: ' + (currentLeague?.name || 'Dynasty') + ', ' + (currentLeague?.rosters?.length || 12) + ' teams',
            'TRADES: ' + (kpis.tradeCount || 0) + ' completed, net DHQ ' + (kpis.tradeNetDhq > 0 ? '+' : '') + Math.round((kpis.tradeNetDhq || 0) / 1000) + 'k',
            'WAIVERS: ' + (kpis.waiverHitPct != null ? (kpis.waiverHitPct + '% retention over ' + kpis.waiverTotal + ' adds') : 'n/a'),
            'DRAFT: ' + (kpis.draftHitPct != null ? (kpis.draftHitPct + '% hit rate over ' + kpis.draftTotal + ' picks') : 'n/a'),
            'TOP HOLDS: ' + topHolds.map(p => (p.name || p.pid) + ' (' + (p.pos || '?') + ', ' + (p.age || '?') + 'yo, ' + p.dhq + ' DHQ)').join('; '),
            recentTrades ? 'RECENT TRADES:\n' + recentTrades : 'RECENT TRADES: none in view',
            heuristicTitles && heuristicTitles.length ? 'ALREADY SURFACED:\n- ' + heuristicTitles.join('\n- ') : '',
        ].filter(Boolean).join('\n');

        // Dynasty (E6): weekly start/sit + streaming leave the AI focus enum;
        // the deterministic pattern cards stay (they read actual H2H results).
        const allowRedraft = window.App?.Intelligence?.allowRedraftFeatures
            ? window.App.Intelligence.allowRedraftFeatures(currentLeague) : true;
        const prompt = [
            'You are Alex, an analytical fantasy-football GM assistant. Generate EXACTLY 2 novel behavioral insights about this manager that are NOT already in the "ALREADY SURFACED" list.',
            'Look for unusual patterns in how they build their roster, manage trades, use waivers, or allocate draft capital. Prefer non-obvious findings over generic ones.',
            '',
            'Return ONLY a JSON array with exactly 2 objects in this exact shape:',
            '[{',
            '  "severity": "warning" | "edge" | "pattern" | "opportunity",',
            '  "confidence": integer 50-95,',
            '  "focus": ' + (allowRedraft
                ? '"trades" | "waivers" | "draft" | "startSit" | "injury" | "streaming" | "gmStyle"'
                : '"trades" | "waivers" | "draft" | "injury" | "gmStyle"') + ',',
            '  "title": "short headline, under 80 chars",',
            '  "body": "1 sentence with a specific number or detail",',
            '  "ctaLabel": "action verb phrase, e.g. \'Open Trade Center\'"',
            '}]',
            '',
            'No markdown, no prose, no comments. Just the JSON array.',
        ].join('\n');

        try {
            // Fallback: the generic `strategy-analysis` route (Gemini Flash
            // tier), enriched with the format/quality preamble above.
            const reply = await aiFn('strategy-analysis', prompt, contextLines);
            if (!reply || typeof reply !== 'string') return { error: 'empty reply' };
            const parsed = extractJsonArray(reply);
            if (!parsed) return { error: 'no JSON array in reply' };
            return { insights: normalizeAiInsights(parsed) };
        } catch (e) {
            return { error: String(e.message || e) };
        }
    }

    // Tolerates replies wrapped in ```json fences or surrounded by prose.
    function extractJsonArray(reply) {
        if (!reply || typeof reply !== 'string') return null;
        const match = reply.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (!match) return null;
        try {
            const parsed = JSON.parse(match[0]);
            return Array.isArray(parsed) ? parsed : null;
        } catch (_) { return null; }
    }

    function normalizeAiInsights(parsed) {
        return parsed.filter(x => x && x.severity && x.title).map(x => ({
            severity: String(x.severity).toLowerCase(),
            confidence: Math.max(50, Math.min(95, parseInt(x.confidence) || 70)),
            focus: x.focus || null,
            title: String(x.title).slice(0, 120),
            body: String(x.body || '').slice(0, 400),
            ctaLabel: x.ctaLabel ? String(x.ctaLabel).slice(0, 40) : null,
            isAi: true,
        }));
    }

    // ── Sub-tab row ───────────────────────────────────────────────
    function SubTabs({ value, onChange, tabs }) {
        // Phone (≤767): the SAME tabs + setters re-pour as a P2 .wr-seg
        // segmented strip (5 items scroll horizontally, scrollbar hidden)
        // with phone-short labels. Desktop keeps .wr-module-nav untouched.
        const _vp = window.WR.useViewport();
        if (_vp.isPhone) {
            const shortLabels = { overview: 'Overview', strategy: 'Strategy', patterns: 'Patterns', history: 'History', settings: 'Model' };
            return h('div', { className: 'wr-seg' },
                tabs.map(t => h('button', {
                    key: t.k,
                    className: value === t.k ? 'is-on' : '',
                    onClick: () => onChange(t.k),
                }, shortLabels[t.k] || t.label))
            );
        }
        return h('div', { className: 'wr-module-nav', style: { margin: '0 0 var(--space-lg)' } },
            tabs.map(t => h('button', {
                key: t.k,
                className: value === t.k ? 'is-active' : '',
                onClick: () => onChange(t.k),
            }, t.label))
        );
    }

    // ── Overview sub-tab ──────────────────────────────────────────
    function OverviewView({ kpis, insights, props, settings, isPro = true, lockedInsightCount = 0 }) {
        // Phone (≤767): layout-only re-pours — the KPI grid becomes a P4
        // snap strip and InsightCards go compact w/ full-width CTA (scoped
        // CSS at the bottom of this file). Hook is unconditional (order-safe).
        const _vp = window.WR.useViewport();
        const _phone = !!_vp.isPhone;
        const Kpi = window.WR.Kpi;
        const InsightCard = window.WR.InsightCard;
        const fmtK = (n) => n == null ? null : ((n > 0 ? '+' : '') + (n / 1000).toFixed(1) + 'k');

        // AI-generated insights — separate from heuristic insights, cached
        // for 24h, tagged with isAi so the card badge can distinguish them.
        // Free never loads (or decorates) the AI cache: the whole read layer
        // is Pro (gate-map row 10) and no AI may fire for a free user.
        const [aiState, setAiState] = useState(() => isPro ? loadCachedAiInsights(props) : { insights: [], ts: 0 });
        const [aiLoading, setAiLoading] = useState(false);
        const [aiError, setAiError] = useState(null);
        const decoratedAiInsights = React.useMemo(
            () => isPro ? decorateInsightRecommendations(aiState?.insights || [], props, kpis, 'ai') : [],
            [aiState, props, kpis, isPro]
        );
        const aiInsights = React.useMemo(
            () => decoratedAiInsights.filter(x => !window.WR?.AlexSettings || window.WR.AlexSettings.shouldShow(x)),
            [decoratedAiInsights, settings]
        );
        const merged = React.useMemo(() => [...insights, ...aiInsights], [insights, aiInsights]);

        useEffect(() => {
            if (!isPro) return; // free publishes no recommendations app-wide
            publishInsightRecommendations(merged, 'gm-office-overview');
        }, [merged, isPro]);

        useEffect(() => {
            setAiState(isPro ? loadCachedAiInsights(props) : { insights: [], ts: 0 });
            setAiError(null);
        }, [props?.currentLeague?.id, props?.currentLeague?.league_id, isPro]);

        const doGenerate = async () => {
            // Trigger gate (D9 row 12): the button is hidden for free, but a
            // BYOK user could still reach this path — never fire AI for free.
            if (!isPro) {
                if (window.showProLaunchPage) window.showProLaunchPage();
                else if (window.showUpgradePrompt) window.showUpgradePrompt('briefing_reasoning');
                return;
            }
            setAiLoading(true); setAiError(null);
            const titles = insights.map(i => i.title);
            const r = await generateAiInsights(props, kpis, titles);
            setAiLoading(false);
            if (r.error) { setAiError(r.error); return; }
            setAiState({ insights: r.insights, ts: Date.now() });
            saveCachedAiInsights(props, r.insights);
        };
        const doClear = () => { clearCachedAiInsights(props); setAiState({ insights: [], ts: 0 }); };

        // Learning-loop feedback on AI insight cards (keyed by title).
        const [insightFeedback, setInsightFeedback] = useState({});
        const sendInsightFeedback = (ins, action) => {
            setInsightFeedback(prev => ({ ...prev, [ins.title]: action }));
            window.WR?.AIFeedback?.send?.({
                leagueId: getLeagueId(props),
                surface: 'insight',
                recId: 'ai-insight:' + (ins.title || '').slice(0, 150),
                action,
                subject: { title: ins.title, focus: ins.focus || undefined, severity: ins.severity },
            });
        };

        const cacheAge = aiState?.ts ? Math.round((Date.now() - aiState.ts) / 60000) : null;

        return h(React.Fragment, null,
            // Phone: the 4 tiles ride one horizontally-snapping band instead
            // of the stacked 1-col grid — same Kpi elements, same gates.
            h('div', { className: _phone ? 'wr-kpi-strip gmoff-kpis' : 'gm-office-kpi-grid' },
                // GM Grade is an A-F composite interpretation \u2014 Pro. The other
                // tiles are the raw activity counts free keeps (gate-map row 10).
                h(Kpi, isPro ? {
                    label: 'GM Grade',
                    value: gmGradeLetter(kpis.gmScore),
                    tone: gmGradeTone(kpis.gmScore),
                    sub: kpis.gmScore != null
                        ? (kpis.gmScore + '/100 \u00B7 ' + kpis.gmScoreSample + '-dim composite')
                        : 'Need more decision history',
                } : {
                    label: 'GM Grade',
                    value: '\uD83D\uDD12',
                    tone: 'mute',
                    sub: 'Pro \u2014 Alex\u2019s composite grade',
                }),
                h(Kpi, {
                    label: 'Trade Net DHQ',
                    value: fmtK(kpis.tradeNetDhq) || '\u2014',
                    tone: kpis.tradeNetDhq > 0 ? 'win' : kpis.tradeNetDhq < 0 ? 'loss' : 'plain',
                    sub: (kpis.tradeCount || 0) + ' trade' + (kpis.tradeCount === 1 ? '' : 's'),
                }),
                h(Kpi, {
                    label: 'Waiver Hit Rate',
                    value: kpis.waiverHitPct != null ? (kpis.waiverHitPct + '%') : '\u2014',
                    tone: kpis.waiverHitPct >= 50 ? 'win' : kpis.waiverHitPct >= 30 ? 'gold' : 'mute',
                    sub: kpis.waiverTotal ? (kpis.waiverKept + '/' + kpis.waiverTotal + ' kept') : 'No waiver history yet',
                }),
                h(Kpi, {
                    label: 'Best Decision Type',
                    value: kpis.bestType || '\u2014',
                    tone: 'gold',
                    sub: kpis.bestPct != null ? (kpis.bestPct + '% positive rate') : 'Need more data',
                })
            ),
            h('div', { className: 'gm-office-section-head' },
                h('h2', null, 'Behavioral Analysis'),
                h('span', { className: 'gm-office-section-meta' },
                    '\u2014 ' + (isPro
                        ? merged.length + ' insight' + (merged.length === 1 ? '' : 's') + (aiInsights.length ? ' (' + aiInsights.length + ' AI)' : '')
                        : lockedInsightCount + ' insight' + (lockedInsightCount === 1 ? '' : 's'))),
                // Spacer pushes the AI controls to the right
                h('div', { className: 'gm-office-spacer' }),
                isPro && h('button', {
                    onClick: doGenerate,
                    disabled: aiLoading,
                    style: {
                        display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '44px',
                        padding: '6px 12px', borderRadius: '6px', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600,
                        fontFamily: 'var(--font-body)',
                        background: aiLoading ? 'rgba(124,107,248,0.08)' : 'rgba(124,107,248,0.12)',
                        border: '1px solid rgba(124,107,248,0.35)',
                        color: 'var(--purple)',
                        cursor: aiLoading ? 'wait' : 'pointer',
                        opacity: aiLoading ? 0.7 : 1,
                    }
                }, '\u2728 ', aiLoading ? 'Thinking…' : (aiInsights.length ? 'Regenerate AI insights' : 'Generate with Alex')),
                aiInsights.length > 0 && h('button', {
                    onClick: doClear,
                    style: {
                        minHeight: '44px',
                        padding: '6px 10px', borderRadius: '6px', fontSize: 'var(--text-label, 0.75rem)',
                        fontFamily: 'var(--font-body)', background: 'transparent',
                        border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', color: 'var(--silver)',
                        cursor: 'pointer',
                    }
                }, 'Clear AI'),
                aiInsights.length > 0 && cacheAge != null && h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.5, fontFamily: 'var(--font-mono)' } },
                    cacheAge < 1 ? 'just now' : cacheAge < 60 ? cacheAge + 'm ago' : Math.floor(cacheAge / 60) + 'h ago')
            ),
            aiError && h('div', { style: { padding: '10px 14px', marginBottom: '12px', background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '6px', fontSize: 'var(--text-body, 1rem)', color: 'var(--bad)' } },
                'Alex couldn\u2019t generate insights: ', aiError),
            // Free: section shell + one locked teaser row, zero real insight
            // cards reach the DOM (mirrors reconai Field Log GM Insights).
            !isPro
                ? (window.WrGatedMoreRow
                    ? h(window.WrGatedMoreRow, {
                        title: 'Unlock Behavioral Analysis with Pro',
                        sub: (lockedInsightCount > 0 ? lockedInsightCount + ' insight' + (lockedInsightCount === 1 ? '' : 's') + ' waiting \u2014 ' : '')
                            + 'Alex\u2019s read on your trades, waivers, drafting, and roster patterns.',
                        feature: 'briefing_reasoning',
                    })
                    : null)
                : merged.length === 0
                ? h(window.WR.Card, { padding: '24px' },
                    h('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.7, lineHeight: 1.55, textAlign: 'center' } },
                        'No behavioral patterns detected yet. Alex needs a bit of trade / waiver / draft history before it can speak confidently.')
                )
                : h('div', { className: 'gm-office-insight-grid' },
                    merged.map((ins, i) => {
                        // Chips win: when the why-chips render under a card, the
                        // body would just restate them — suppress it (never body
                        // + why-chips together).
                        const cardBase = ins.recommendationWhy?.length > 0 ? { ...ins, body: null } : ins;
                        // Phone: compact card density; the .gmoff-phone-ins
                        // wrapper class drives the full-width CTA (scoped CSS).
                        const cardIns = _phone ? { ...cardBase, compact: true } : cardBase;
                        return h('div', { key: i, className: _phone ? 'gmoff-phone-ins' : undefined, style: { position: 'relative' } },
                        h(InsightCard, ins.isAi ? {
                            ...cardIns,
                            // Learning loop: thumbs feed the ai_feedback rollup that
                            // tunes future prompts for this owner.
                            feedback: {
                                given: insightFeedback[ins.title],
                                onUp: () => sendInsightFeedback(ins, 'up'),
                                onDown: () => sendInsightFeedback(ins, 'down'),
                            },
                        } : cardIns),
                        ins.recommendationWhy?.length > 0 && h('div', {
                            style: {
                                display: 'flex', flexWrap: 'wrap', gap: '5px',
                                margin: '6px 2px 0',
                            }
                        },
                            ins.recommendationWhy.slice(0, 3).map(line => h('span', {
                                key: line,
                                style: {
                                    color: 'var(--k-d0e7fa, #d0e7fa)',
                                    background: 'rgba(125,183,232,0.07)',
                                    border: '1px solid rgba(125,183,232,0.18)',
                                    borderRadius: '4px',
                                    padding: '2px 5px',
                                    fontSize: 'var(--text-micro)',
                                    lineHeight: 1.25,
                                }
                            }, line))
                        ),
                        ins.isAi && h('div', { style: { position: 'absolute', top: 10, right: 10, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro)', fontWeight: 700, letterSpacing: '0.12em', padding: '2px 6px', borderRadius: '4px', background: 'rgba(124,107,248,0.2)', color: 'var(--purple)', border: '1px solid rgba(124,107,248,0.4)' } }, '\u2728 AI')
                        );
                    })
                )
        );
    }

    // ── Patterns sub-tab ──────────────────────────────────────────
    // Deep-dive charts over the user's managerial history. Every panel
    // is computed from window.App.LI + window.S, with soft-fail empty
    // states when a panel's data source is thin.
    function PatternsView({ props, isPro = true }) {
        const { myRoster, currentLeague, playersData } = props || {};
        const LI = window.App?.LI || {};
        const myRid = myRoster?.roster_id;
        const Card = window.WR.Card;

        // ── Data prep ──
        const myTrades = (LI.tradeHistory || []).filter(t => t.sides && t.sides[myRid]);
        const partners = (() => {
            const counts = {}; const nets = {};
            myTrades.forEach(t => {
                const myIn = (t.sides[myRid].players || []).reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
                Object.entries(t.sides).forEach(([rid, side]) => {
                    if (String(rid) === String(myRid)) return;
                    counts[rid] = (counts[rid] || 0) + 1;
                    const theirGive = (side.players || []).reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
                    nets[rid] = (nets[rid] || 0) + (myIn - theirGive) / Object.keys(t.sides).filter(r => String(r) !== String(myRid)).length;
                });
            });
            const rosters = currentLeague?.rosters || [];
            const users = currentLeague?.users || window.S?.leagueUsers || [];
            return Object.entries(counts).map(([rid, count]) => {
                const r = rosters.find(x => String(x.roster_id) === rid);
                const u = users.find(x => x.user_id === r?.owner_id);
                return { rid, count, net: Math.round(nets[rid] || 0), name: u?.display_name || u?.metadata?.team_name || ('T' + rid) };
            }).sort((a, b) => b.count - a.count);
        })();

        const draftPicks = (LI.draftOutcomes || []).filter(d => String(d.roster_id) === String(myRid));
        const draftByRound = (() => {
            const rounds = {};
            draftPicks.forEach(d => {
                const r = d.round || 0;
                if (!rounds[r]) rounds[r] = { total: 0, hits: 0 };
                rounds[r].total++;
                if ((LI.playerScores?.[d.pid] || 0) >= 3000) rounds[r].hits++;
            });
            return Object.entries(rounds).map(([r, v]) => ({ round: Number(r), ...v, rate: v.total ? Math.round(v.hits / v.total * 100) : 0 })).sort((a, b) => a.round - b.round);
        })();
        const draftByPos = (() => {
            const pos = {};
            draftPicks.forEach(d => {
                if (!pos[d.pos]) pos[d.pos] = { total: 0, hits: 0 };
                pos[d.pos].total++;
                if ((LI.playerScores?.[d.pid] || 0) >= 3000) pos[d.pos].hits++;
            });
            return Object.entries(pos).map(([p, v]) => ({ pos: p, ...v, rate: v.total ? Math.round(v.hits / v.total * 100) : 0 })).sort((a, b) => b.total - a.total);
        })();

        const myPlayers = myRoster?.players || [];
        const rosterByPos = (() => {
            const pos = {};
            myPlayers.forEach(pid => {
                const p = playersData?.[pid]; if (!p) return;
                const ps = p.position || 'UNK';
                if (!pos[ps]) pos[ps] = { count: 0, dhq: 0 };
                pos[ps].count++;
                pos[ps].dhq += LI.playerScores?.[pid] || 0;
            });
            const totalDhq = Object.values(pos).reduce((s, x) => s + x.dhq, 0);
            return Object.entries(pos).map(([p, v]) => ({ pos: p, ...v, pct: totalDhq ? v.dhq / totalDhq : 0 })).sort((a, b) => b.dhq - a.dhq);
        })();

        const txns = (() => {
            const arr = []; const txnMap = window.S?.transactions || {};
            if (txnMap && typeof txnMap === 'object' && !Array.isArray(txnMap)) Object.values(txnMap).forEach(a => { if (Array.isArray(a)) arr.push(...a); });
            return arr;
        })();
        const myTxns = txns.filter(t => {
            const inAdds = t.adds && Object.values(t.adds).some(r => String(r) === String(myRid));
            const inDrops = t.drops && Object.values(t.drops).some(r => String(r) === String(myRid));
            return inAdds || inDrops;
        });
        const txnByWeek = (() => {
            const wk = {};
            myTxns.forEach(t => { const w = t.leg || t.week || 0; if (!w) return; wk[w] = (wk[w] || 0) + 1; });
            return Object.entries(wk).map(([w, c]) => ({ week: Number(w), count: c })).sort((a, b) => a.week - b.week);
        })();

        // ── Chart primitives ──
        const POS_COLORS = window.App?.POS_COLORS || {};
        const posColor = (p) => POS_COLORS[p] || 'var(--k-d0d0d0, #d0d0d0)';

        const HBar = ({ label, labelColor, value, max, valStr, barColor, rightText }) =>
            h('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr 60px', gap: '10px', alignItems: 'center', marginBottom: '6px' } },
                h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: labelColor || 'var(--silver)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
                h('div', { style: { height: '10px', background: 'var(--ov-3, rgba(255,255,255,0.04))', borderRadius: '3px', overflow: 'hidden', position: 'relative' } },
                    h('div', { style: { width: Math.max(0, Math.min(100, (value / max) * 100)) + '%', height: '100%', background: barColor || 'var(--gold)', borderRadius: '3px', transition: 'width 0.2s' } })
                ),
                h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-mono)', color: rightText || 'var(--silver)', textAlign: 'right', fontWeight: 700 } }, valStr)
            );

        // Panel wraps each chart with its title + Alex-voiced interpretation.
        // `interpretation` is the differentiator vs. Analytics: the same data
        // is there, but here Alex tells you what it *means* for your play.
        const Panel = ({ title, subtitle, interpretation, interpColor, children, empty }) => h(Card, { padding: 'var(--card-pad-lg)', style: { marginBottom: 'var(--space-md)' } },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: interpretation ? '8px' : '14px' } },
                h('h3', { style: { fontFamily: 'var(--font-title)', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, margin: 0, letterSpacing: 0 } }, title),
                subtitle && h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-mono)' } }, '\u2014 ' + subtitle)
            ),
            interpretation && h('div', {
                style: {
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    marginBottom: '14px', padding: '8px 10px',
                    background: 'var(--acc-fill1, rgba(212,175,55,0.04))',
                    borderLeft: '2px solid ' + (interpColor || 'var(--acc-line3, rgba(212,175,55,0.5))'),
                    borderRadius: '0 5px 5px 0',
                    fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.92, lineHeight: 1.5,
                }
            },
                h('span', { style: { fontFamily: 'var(--font-title)', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0, paddingTop: '2px' } }, 'Alex'),
                h('span', null, interpretation)
            ),
            empty
                ? h('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6, padding: '12px 0', fontStyle: 'italic' } }, empty)
                : children
        );

        // ── Alex interpretations (computed from data) ──
        const tradePartnersInterp = (() => {
            if (!partners.length) return null;
            const top = partners[0];
            const top2Share = partners.slice(0, 2).reduce((s, p) => s + p.count, 0) / Math.max(1, myTrades.length);
            const sd = 'ai-net:' + partners.length + ':' + top.name + ':' + top.count;
            if (partners.length >= 10 && top2Share < 0.5) {
                return avPick(sd, [
                    'You work the whole room \u2014 ' + partners.length + ' different partners, with ' + top.name + ' your go-to at ' + top.count + ' deals.',
                    'Broad network here: ' + partners.length + ' partners, no real favorites \u2014 ' + top.name + ' shows up most at ' + top.count + ' deals.',
                ]);
            }
            if (top2Share >= 0.6) {
                return avPick(sd, [
                    'You\u2019re funneling ' + Math.round(top2Share * 100) + '% of your trades through just two managers \u2014 the best value usually hides with the people you\u2019re not talking to.',
                    Math.round(top2Share * 100) + '% of your deals run through two guys \u2014 widen that narrow market and you\u2019ll find softer spots.',
                ]);
            }
            return avPick(sd, [
                'Nice balance across ' + partners.length + ' partners \u2014 ' + top.name + ' is your most frequent counter at ' + top.count + ' deals.',
                'You spread it around \u2014 ' + partners.length + ' partners, with ' + top.name + ' your most common (' + top.count + ' deals).',
            ]);
        })();

        const tradeValueInterp = (() => {
            if (!partners.length) return null;
            const winners = partners.filter(p => p.net > 0);
            const losers = partners.filter(p => p.net < 0);
            const biggestLoser = losers.length ? losers.reduce((a, b) => Math.abs(a.net) > Math.abs(b.net) ? a : b) : null;
            const biggestWinner = winners.length ? winners.reduce((a, b) => a.net > b.net ? a : b) : null;
            const sd = 'ai-val:' + partners.length + ':' + winners.length;
            if (biggestLoser && Math.abs(biggestLoser.net) >= 3000) {
                // 'Solid overall' only when winners are an actual majority;
                // otherwise frame the losing record honestly. The bars below
                // already name who's up on you \u2014 don't restate them (Q5 cut).
                if (winners.length * 2 > partners.length) {
                    return avPick(sd, [
                        'You come out ahead against ' + winners.length + ' of ' + partners.length + ' partners \u2014 run offers from the red bars through the analyzer before you say yes.',
                        'Solid overall \u2014 up on ' + winners.length + ' of ' + partners.length + ' partners \u2014 but slow down on proposals from the red side of this chart.',
                    ]);
                }
                return avPick(sd, [
                    'You\u2019re only ahead against ' + winners.length + ' of ' + partners.length + ' partners \u2014 run every incoming offer through the analyzer before you say yes.',
                    'The ledger only favors you against ' + winners.length + ' of ' + partners.length + ' partners \u2014 tighten up before the next yes.',
                ]);
            }
            if (biggestWinner && winners.length >= partners.length / 2) {
                return avPick(sd, [
                    biggestWinner.name + ' has been your favorite mark (+' + (biggestWinner.net / 1000).toFixed(1) + 'k) \u2014 keep sending them offers.',
                    'You\u2019ve got ' + biggestWinner.name + '\u2019s number (+' + (biggestWinner.net / 1000).toFixed(1) + 'k) \u2014 stay on the offer side with them.',
                ]);
            }
            return avPick(sd, [
                'Your trade value\u2019s scattered \u2014 nobody\u2019s really winning or losing.',
                'No clear edge or leak across partners \u2014 you\u2019re trading the whole league pretty evenly.',
            ]);
        })();

        const draftHitInterp = (() => {
            if (!draftPicks.length) return null;
            const totalHits = draftPicks.filter(d => (LI.playerScores?.[d.pid] || 0) >= 3000).length;
            const rate = Math.round(totalHits / draftPicks.length * 100);
            const sd = 'ai-hit:' + draftPicks.length + ':' + rate;
            if (rate === 0) {
                return avPick(sd, [
                    'None of your ' + draftPicks.length + ' tracked picks have hit contributor value yet \u2014 lean into flipping rookies for proven vets.',
                    'Rough drafting so far \u2014 0 of ' + draftPicks.length + ' picks at contributor DHQ, so consider dealing picks for known production.',
                ]);
            }
            if (rate >= 50) {
                return avPick(sd, [
                    rate + '% hit rate across ' + draftPicks.length + ' picks is elite \u2014 hoard picks in trades, they compound in your hands.',
                    'You draft: ' + rate + '% hits on ' + draftPicks.length + ' picks \u2014 I\u2019d be collecting picks every chance you get.',
                ]);
            }
            return avPick(sd, [
                rate + '% hit rate over ' + draftPicks.length + ' picks is middle of the pack \u2014 no single round has become your sweet spot yet.',
                'You\u2019re right around average \u2014 ' + rate + '% on ' + draftPicks.length + ' picks, with nothing jumping out as your money round.',
            ]);
        })();

        const draftPosInterp = (() => {
            if (!draftByPos.length) return null;
            const top = draftByPos[0];
            const topPct = Math.round(top.total / draftPicks.length * 100);
            const sd = 'ai-pos:' + top.pos + ':' + topPct;
            if (topPct >= 40) {
                return avPick(sd, [
                    'You lean hard on ' + top.pos + ' \u2014 ' + topPct + '% of your picks \u2014 and mixing it up next draft is cheap insurance.',
                    top.pos + ' is clearly your comfort pick (' + topPct + '% of the board) \u2014 worth asking whether it\u2019s strategy or habit.',
                ]);
            }
            return avPick(sd, [
                'Your draft board\u2019s balanced across ' + draftByPos.length + ' positions \u2014 no one spot runs the show.',
                'No positional tunnel vision here; you spread picks across ' + draftByPos.length + ' spots.',
            ]);
        })();

        const partnerInterpColor = partners.some(p => p.net < -3000) ? 'var(--bad)' : 'var(--good)';
        const draftHitInterpColor = draftPicks.length && draftPicks.filter(d => (LI.playerScores?.[d.pid] || 0) >= 3000).length === 0 ? 'var(--bad)' : 'var(--gold)';

        // ── Render ──
        const maxPartnerCount = Math.max(1, ...partners.map(p => p.count));
        const maxPartnerAbs = Math.max(1, ...partners.map(p => Math.abs(p.net)));
        const maxDraftTotal = Math.max(1, ...draftByRound.map(r => r.total));
        const maxPosCount = Math.max(1, ...rosterByPos.map(p => p.count));
        const maxWeekCount = Math.max(1, ...txnByWeek.map(w => w.count));

        // Four panels, each narrated by Alex. Roster DHQ allocation and
        // waiver-activity-by-week were removed — both are league-generic
        // data views that fully live in the Analytics tab. These four are
        // all behavior-specific (about how you play, not raw league data).
        return h('div', null,
            // Free keeps the raw charts (raw history); Alex's per-chart reads
            // are the Pro layer, so the banner becomes the locked teaser.
            // (Pro explainer box removed \u2014 the per-panel Alex strips make the
            // difference from Analytics self-evident.)
            isPro
                ? null
                : (window.WrGatedMoreRow
                    ? h('div', { style: { marginBottom: '14px' } }, h(window.WrGatedMoreRow, {
                        title: 'Alex\u2019s chart reads \u2014 Pro',
                        sub: 'The charts stay free. Alex\u2019s take on what each one means for your play style is a Pro read.',
                        feature: 'briefing_reasoning',
                    }))
                    : null),
            // Trade partners — volume
            h(Panel, {
                title: 'Trade partners \u2014 who you deal with',
                subtitle: partners.length + ' partner' + (partners.length === 1 ? '' : 's') + ' over ' + myTrades.length + ' trade' + (myTrades.length === 1 ? '' : 's'),
                interpretation: isPro ? tradePartnersInterp : null,
                empty: partners.length === 0 ? 'No trade history yet.' : null,
            },
                partners.slice(0, 12).map(p => h(HBar, {
                    key: p.rid,
                    label: p.name,
                    value: p.count,
                    max: maxPartnerCount,
                    valStr: String(p.count),
                    barColor: 'var(--gold)',
                }))
            ),
            // Trade partners — net DHQ (fleecer vs fleeced)
            h(Panel, {
                title: 'Trade value \u2014 who you profit from',
                subtitle: 'Net DHQ per partner; green = you won, red = they won',
                interpretation: isPro ? tradeValueInterp : null,
                interpColor: partnerInterpColor,
                empty: partners.length === 0 ? 'No trade history yet.' : null,
            },
                partners.slice(0, 12).map(p => h(HBar, {
                    key: p.rid,
                    label: p.name,
                    value: Math.abs(p.net),
                    max: maxPartnerAbs,
                    valStr: (p.net > 0 ? '+' : '') + (p.net / 1000).toFixed(1) + 'k',
                    barColor: p.net > 0 ? 'var(--good)' : p.net < 0 ? 'var(--bad)' : 'var(--silver)',
                    rightText: p.net > 0 ? 'var(--good)' : p.net < 0 ? 'var(--bad)' : 'var(--silver)',
                }))
            ),
            // Draft — hit rate by round
            h(Panel, {
                title: 'Draft hit rate by round',
                subtitle: draftPicks.length + ' pick' + (draftPicks.length === 1 ? '' : 's') + ' tracked · contributor threshold 3000 DHQ',
                interpretation: isPro ? draftHitInterp : null,
                interpColor: draftHitInterpColor,
                empty: draftPicks.length === 0 ? 'No draft history recorded yet.' : null,
            },
                draftByRound.map(r => h(HBar, {
                    key: r.round,
                    label: 'Round ' + r.round,
                    value: r.hits,
                    max: maxDraftTotal,
                    valStr: r.hits + '/' + r.total + '  ' + r.rate + '%',
                    barColor: r.rate >= 50 ? 'var(--good)' : r.rate >= 25 ? 'var(--warn)' : 'var(--bad)',
                }))
            ),
            // Draft — position mix
            h(Panel, {
                title: 'Draft position mix',
                subtitle: 'Where your picks land',
                interpretation: isPro ? draftPosInterp : null,
                empty: draftByPos.length === 0 ? 'No draft history recorded yet.' : null,
            },
                draftByPos.map(p => h(HBar, {
                    key: p.pos,
                    label: p.pos,
                    labelColor: posColor(p.pos),
                    value: p.total,
                    max: maxDraftTotal,
                    valStr: p.total + ' pick' + (p.total === 1 ? '' : 's') + ' \u00B7 ' + p.rate + '% hit',
                    barColor: posColor(p.pos),
                })),
                // Deep-link to the Analytics draft tab for full tabular detail.
                h('div', { style: { marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.05))', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55 } },
                    'For full roster and waiver data tables, open ',
                    h('a', { href: '#', onClick: e => { e.preventDefault(); props?.setActiveTab?.('analytics'); }, style: { color: 'var(--gold)', textDecoration: 'underline' } }, 'Analytics'), '.')
            )
        );
    }

    // ── Decision History sub-tab ──────────────────────────────────
    // Robust timestamp coercion — Sleeper/DHQ inconsistently mix seconds vs ms.
    function _dhMs(ts) {
        const n = Number(ts) || 0;
        if (!n) return 0;
        return n > 1e12 ? n : n * 1000; // > Sep 2001 in ms means it IS ms
    }
    function _dhDate(ts) {
        const ms = _dhMs(ts);
        if (!ms) return '\u2014';
        return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function _dhMonth(ts) {
        const ms = _dhMs(ts);
        if (!ms) return 'Unknown';
        return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    function HistoryView({ props }) {
        // Phone (≤767): decision rows re-pour as two-line cards (call chip +
        // result chip + when tag, asset chips wrapping below) — the desktop
        // 4-col grid row stays byte-identical. Hook unconditional (order-safe).
        const _vp = window.WR.useViewport();
        const _phone = !!_vp.isPhone;
        const leagueId = getLeagueId(props);
        const myRid = props?.myRoster?.roster_id || window.S?.myRosterId;
        const [filter, setFilter] = useState('all'); // 'all' | 'trade' | 'waiver' | 'fa' | 'note'
        const [remoteLog, setRemoteLog] = useState(null);

        useEffect(() => {
            let cancelled = false;
            setRemoteLog(null);
            if (!window.OD?.loadFieldLog) return;
            window.OD.loadFieldLog(leagueId, 80).then(data => {
                if (!cancelled) setRemoteLog(Array.isArray(data) ? data : []);
            }).catch(() => {
                if (!cancelled) setRemoteLog([]);
            });
            return () => { cancelled = true; };
        }, [leagueId]);

        let localLog = [];
        try { localLog = JSON.parse(localStorage.getItem('scout_field_log_v1') || '[]'); } catch (_) {}
        const logById = new Map();
        [...(remoteLog || []), ...localLog].forEach(entry => {
            if (!entry) return;
            if (entry.leagueId && leagueId && String(entry.leagueId) !== String(leagueId)) return;
            const id = entry.id || String(entry.ts || Math.random());
            logById.set(id, { ...entry, kind: 'field-log' });
        });
        const log = Array.from(logById.values()).sort((a, b) => _dhMs(b.ts) - _dhMs(a.ts)).slice(0, 50);

        const txns = [];
        const txnMap = window.S?.transactions || {};
        if (txnMap && typeof txnMap === 'object' && !Array.isArray(txnMap)) {
            Object.values(txnMap).forEach(arr => { if (Array.isArray(arr)) txns.push(...arr); });
        }
        function getTradeRosters(t) {
            return (t?.roster_ids || Object.keys(t?.sides || {})).map(String).sort();
        }
        function sideReceivedAssets(t, rid) {
            const rosterId = String(rid);
            if (t?.sides) {
                const side = t.sides[rosterId] || {};
                const faab = Number(side.faab || side.faabDelta || side.waiverBudget || 0);
                return {
                    players: [...(side.players || [])].map(String),
                    picks: [...(side.picks || [])],
                    faab: Number.isFinite(faab) && faab > 0 ? faab : 0,
                };
            }
            const pickMoved = pk => String(pk?.owner_id ?? '') !== String(pk?.previous_owner_id ?? '');
            const faabRows = Array.isArray(t?.waiver_budget) ? t.waiver_budget : [];
            return {
                players: Object.entries(t?.adds || {}).filter(([, r]) => String(r) === rosterId).map(([pid]) => String(pid)),
                picks: (t?.draft_picks || []).filter(pk => pickMoved(pk) && String(pk.owner_id) === rosterId),
                faab: faabRows
                    .filter(row => String(row.receiver ?? row.to ?? row.roster_id ?? '') === rosterId)
                    .reduce((sum, row) => sum + (Number(row.amount ?? row.value ?? 0) || 0), 0),
            };
        }
        function sideSentAssets(t, rid) {
            const rosterId = String(rid);
            if (t?.sides) {
                return getTradeRosters(t).filter(r => r !== rosterId).reduce((acc, otherRid) => {
                    const received = sideReceivedAssets(t, otherRid);
                    acc.players.push(...received.players);
                    acc.picks.push(...received.picks);
                    acc.faab += received.faab || 0;
                    return acc;
                }, { players: [], picks: [], faab: 0 });
            }
            const pickMoved = pk => String(pk?.owner_id ?? '') !== String(pk?.previous_owner_id ?? '');
            const faabRows = Array.isArray(t?.waiver_budget) ? t.waiver_budget : [];
            return {
                players: Object.entries(t?.drops || {}).filter(([, r]) => String(r) === rosterId).map(([pid]) => String(pid)),
                picks: (t?.draft_picks || []).filter(pk => pickMoved(pk) && String(pk.previous_owner_id) === rosterId),
                faab: faabRows
                    .filter(row => String(row.sender ?? row.from ?? '') === rosterId)
                    .reduce((sum, row) => sum + (Number(row.amount ?? row.value ?? 0) || 0), 0),
            };
        }
        function transactionEventKey(ev) {
            const t = ev?.transaction || {};
            if (t.type === 'trade') {
                return 'trade:' + _dhMs(t.created || t.ts || ev.ts || 0) + ':' + getTradeRosters(t).join(',');
            }
            return t.transaction_id || t.id || (t.type + ':' + (t.created || t.ts || ev.ts || 0) + ':' + JSON.stringify(t.adds || {}) + ':' + JSON.stringify(t.drops || {}));
        }
        // ts stored as the raw upstream value — _dhMs() auto-detects seconds
        // vs ms when rendering, so we don't pre-multiply (which broke dates
        // when LI.tradeHistory's t.ts was already in milliseconds).
        const transactionEvents = txns.filter(t => {
            const addsMe = t.adds && Object.values(t.adds).some(r => String(r) === String(myRid));
            const dropsMe = t.drops && Object.values(t.drops).some(r => String(r) === String(myRid));
            const pickMe = (t.draft_picks || []).some(pk => String(pk.owner_id) === String(myRid) || String(pk.previous_owner_id) === String(myRid));
            const faabMe = (t.waiver_budget || []).some(row => String(row.sender ?? row.from ?? row.receiver ?? row.to ?? '') === String(myRid));
            const tradeMe = t.type === 'trade' && (
                (Array.isArray(t.roster_ids) && t.roster_ids.some(r => String(r) === String(myRid))) ||
                (t.sides && Object.keys(t.sides).some(r => String(r) === String(myRid))) ||
                pickMe ||
                faabMe
            );
            return addsMe || dropsMe || tradeMe;
        }).map(t => ({ kind: 'transaction', ts: t.created || t.ts || 0, transaction: t }));

        const liTradeEvents = (window.App?.LI?.tradeHistory || [])
            .filter(t => t.sides && t.sides[myRid])
            .map(t => ({ kind: 'transaction', ts: t.ts || 0, transaction: { ...t, type: 'trade', created: t.ts || 0, _fromDHQ: true } }));

        const eventById = new Map();
        [...transactionEvents, ...liTradeEvents].forEach(ev => {
            const t = ev.transaction || {};
            const id = ev.kind === 'transaction' ? transactionEventKey(ev) : (ev.id || String(ev.ts || Math.random()));
            const existing = eventById.get(id);
            if (existing?.transaction?.draft_picks?.length && !t.draft_picks?.length) return;
            eventById.set(id, ev);
        });
        const events = [...log, ...Array.from(eventById.values())].sort((a, b) => _dhMs(b.ts) - _dhMs(a.ts)).slice(0, 50);

        if (remoteLog === null && window.OD?.loadFieldLog && !events.length) {
            return h(window.WR.Card, { padding: '32px' },
                h('div', { style: { textAlign: 'center', color: 'var(--silver)', opacity: 0.7 } },
                    'Loading shared decision history...')
            );
        }

        if (!events.length) {
            return h(window.WR.Card, { padding: '32px' },
                h('div', { style: { textAlign: 'center', color: 'var(--silver)', opacity: 0.7 } },
                    'No decisions logged yet. Your trades, waivers, and Scout field-log entries will show up here.')
            );
        }

        // ── Helpers for rich row rendering ──
        const playersData = props?.playersData || {};
        const playerScores = window.App?.LI?.playerScores || {};
        function pname(pid) {
            const p = playersData[pid];
            return (p?.full_name || ((p?.first_name || '') + ' ' + (p?.last_name || '')).trim() || pid);
        }
        function ppos(pid) { return playersData[pid]?.position || ''; }
        function pdhq(pid) { return playerScores[pid] || 0; }
        function chipText(pid) {
            const dhq = pdhq(pid);
            return pname(pid) + (dhq ? ' (' + (dhq >= 1000 ? (dhq / 1000).toFixed(1) + 'k' : dhq) + ')' : '');
        }
        function classifyKind(ev) {
            if (ev.kind === 'field-log') return 'note';
            const t = ev.transaction || {};
            return t.type === 'trade' ? 'trade' : t.type === 'waiver' ? 'waiver' : 'fa';
        }

        // Filter
        const filtered = filter === 'all' ? events : events.filter(ev => classifyKind(ev) === filter);

        // Counts for the chip strip
        const counts = events.reduce((acc, ev) => { const k = classifyKind(ev); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

        // Group by month
        const groups = [];
        let cur = null;
        filtered.forEach(ev => {
            const m = _dhMonth(ev.ts);
            if (!cur || cur.month !== m) {
                cur = { month: m, items: [] };
                groups.push(cur);
            }
            cur.items.push(ev);
        });

        const filterChip = (key, label) => h('button', {
            key, onClick: () => setFilter(key),
            style: {
                minHeight: '44px',
                padding: '5px 10px', borderRadius: '999px',
                fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, cursor: 'pointer',
                background: filter === key ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'transparent',
                border: '1px solid ' + (filter === key ? 'var(--acc-line3, rgba(212,175,55,0.5))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                color: filter === key ? 'var(--gold)' : 'var(--silver)',
                fontFamily: 'var(--font-body)',
            },
        }, label, key !== 'all' && counts[key] != null ? h('span', { style: { marginLeft: '6px', opacity: 0.6, fontFamily: 'var(--font-mono)' } }, counts[key]) : null);

        function renderRow(ev, i) {
            const date = _dhDate(ev.ts);
            const kind = classifyKind(ev);
            if (ev.kind === 'field-log') {
                if (_phone) {
                    // Phone: kind chip + when tag up top, note text wraps
                    // below (the desktop single-line ellipsis row is unreadable
                    // at card width).
                    return h(window.WR.Card, { key: 'log' + (ev.id || i), padding: '10px 12px' },
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' } },
                            h(window.WR.Badge, { label: ev.category || 'note', kind: ev.category || 'note' }),
                            h('div', { style: { marginLeft: 'auto', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-mono)', flexShrink: 0 } }, date),
                        ),
                        h('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', lineHeight: 1.45 } }, ev.text || 'Logged decision')
                    );
                }
                return h(window.WR.Card, { key: 'log' + (ev.id || i), padding: '10px 14px' },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                        h(window.WR.Badge, { label: ev.category || 'note', kind: ev.category || 'note' }),
                        h('div', { style: { flex: 1, minWidth: 0, fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, ev.text || 'Logged decision'),
                        h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-mono)', flexShrink: 0 } }, date),
                    )
                );
            }
            const t = ev.transaction || {};
            // For trades, gather adds (what I got) and drops (what I gave)
            let addedPids = [];
            let droppedPids = [];
            let addedPicks = [];
            let droppedPicks = [];
            let addedFaab = 0;
            let droppedFaab = 0;
            if (kind === 'trade') {
                const received = sideReceivedAssets(t, myRid);
                const sent = sideSentAssets(t, myRid);
                addedPids = received.players;
                addedPicks = received.picks;
                addedFaab = received.faab || 0;
                droppedPids = sent.players;
                droppedPicks = sent.picks;
                droppedFaab = sent.faab || 0;
            } else {
                addedPids = Object.keys(t.adds || {}).filter(pid => String(t.adds[pid]) === String(myRid));
                droppedPids = Object.keys(t.drops || {}).filter(pid => String(t.drops[pid]) === String(myRid));
            }

            // Compute net DHQ for trades
            const totalTeams = props?.currentLeague?.rosters?.length || window.S?.rosters?.length || 12;
            function pickDhq(pk) {
                const round = Number(pk?.round || 0);
                if (!round) return 0;
                const exact = window.App?.PlayerValue?.getPickValue?.(pk.season, round, totalTeams);
                if (Number.isFinite(exact)) return exact;
                return ({ 1: 7000, 2: 3500, 3: 1800, 4: 800, 5: 400, 6: 200 }[round] || 100);
            }
            const myIn = addedPids.reduce((s, pid) => s + pdhq(pid), 0);
            const myOut = droppedPids.reduce((s, pid) => s + pdhq(pid), 0);
            const pickIn = addedPicks.reduce((s, pk) => s + pickDhq(pk), 0);
            const pickOut = droppedPicks.reduce((s, pk) => s + pickDhq(pk), 0);
            const netDhq = (myIn + pickIn) - (myOut + pickOut);
            const hasTradeAssets = !!(addedPids.length || droppedPids.length || addedPicks.length || droppedPicks.length || addedFaab || droppedFaab);
            const netStr = kind === 'trade' && hasTradeAssets ? ((netDhq >= 0 ? '+' : '') + (Math.abs(netDhq) >= 1000 ? (netDhq / 1000).toFixed(1) + 'k' : Math.round(netDhq)) + ' DHQ') : null;
            const netCol = netDhq > 0 ? 'var(--good)' : netDhq < 0 ? 'var(--bad)' : 'var(--silver)';

            const renderChips = (pids, prefix, color) => pids.length === 0 ? null : h('span', { style: { display: 'inline-flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' } },
                pids.slice(0, 4).map(pid => h('span', {
                    key: pid,
                    style: { fontSize: 'var(--text-label, 0.75rem)', padding: '2px 6px', borderRadius: '4px', background: wrAlpha(color, '12'), border: '1px solid ' + wrAlpha(color, '33'), color: color, fontWeight: 600 },
                }, prefix, chipText(pid))),
                pids.length > 4 ? h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6 } }, '+' + (pids.length - 4)) : null,
            );
            function rosterLabel(rid) {
                const rosters = props?.currentLeague?.rosters || window.S?.rosters || [];
                const users = props?.currentLeague?.users || window.S?.leagueUsers || [];
                const roster = rosters.find(r => String(r.roster_id) === String(rid));
                const owner = users.find(u => String(u.user_id) === String(roster?.owner_id));
                return owner?.display_name || owner?.username || roster?._owner_name || (rid ? 'Team ' + rid : '');
            }
            function pickText(pk) {
                const parts = [];
                if (pk?.season) parts.push(pk.season);
                parts.push('R' + (pk?.round || '?'));
                const original = rosterLabel(pk?.roster_id);
                return parts.join(' ') + (original ? ' (' + original + ')' : '');
            }
            const renderPickChips = (picks, prefix, color) => picks.length === 0 ? null : h('span', { style: { display: 'inline-flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' } },
                picks.slice(0, 4).map((pk, idx) => h('span', {
                    key: [pk.season, pk.round, pk.roster_id, idx].join(':'),
                    style: { fontSize: 'var(--text-label, 0.75rem)', padding: '2px 6px', borderRadius: '4px', background: wrAlpha(color, '12'), border: '1px solid ' + wrAlpha(color, '33'), color: color, fontWeight: 600 },
                }, prefix, pickText(pk))),
                picks.length > 4 ? h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6 } }, '+' + (picks.length - 4) + ' picks') : null,
            );
            const renderFaabChip = (amount, prefix, color) => !amount ? null : h('span', {
                style: { fontSize: 'var(--text-label, 0.75rem)', padding: '2px 6px', borderRadius: '4px', background: wrAlpha(color, '12'), border: '1px solid ' + wrAlpha(color, '33'), color: color, fontWeight: 600 },
            }, prefix, '$' + amount + ' FAAB');
            const hasIncoming = !!(addedPids.length || addedPicks.length || addedFaab);
            const hasOutgoing = !!(droppedPids.length || droppedPicks.length || droppedFaab);

            if (_phone) {
                // Phone (AssetRow-ish two-line card): line 1 = call chip
                // (kind badge) + net-DHQ result chip + when tag; line 2 =
                // the SAME asset chips wrapping free. Semantic color stays
                // on the result chip only — the call badge is monochrome.
                return h(window.WR.Card, { key: 'tx' + i, padding: '10px 12px' },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
                        h(window.WR.Badge, { label: kind, kind }),
                        netStr && h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: netCol, fontFamily: 'var(--font-mono)', flexShrink: 0 } }, netStr),
                        h('div', { style: { marginLeft: 'auto', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-mono)', flexShrink: 0 } }, date),
                    ),
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } },
                        renderChips(addedPids, '+ ', 'var(--k-2ecc71, #2ecc71)'),
                        renderPickChips(addedPicks, '+ ', 'var(--k-2ecc71, #2ecc71)'),
                        renderFaabChip(addedFaab, '+ ', 'var(--k-2ecc71, #2ecc71)'),
                        hasOutgoing && hasIncoming && h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.5, alignSelf: 'center' } }, 'for'),
                        renderChips(droppedPids, '\u2212 ', 'var(--k-e74c3c, #e74c3c)'),
                        renderPickChips(droppedPicks, '\u2212 ', 'var(--k-e74c3c, #e74c3c)'),
                        renderFaabChip(droppedFaab, '\u2212 ', 'var(--k-e74c3c, #e74c3c)'),
                        !hasTradeAssets && h('span', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6, fontStyle: 'italic' } }, 'No recorded asset changes'),
                    ),
                );
            }

            return h(window.WR.Card, { key: 'tx' + i, padding: '10px 14px' },
                h('div', { style: { display: 'grid', gridTemplateColumns: '60px 1fr auto auto', gap: '10px', alignItems: 'center' } },
                    h(window.WR.Badge, { label: kind, kind }),
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', minWidth: 0 } },
                        renderChips(addedPids, '+ ', 'var(--k-2ecc71, #2ecc71)'),
                        renderPickChips(addedPicks, '+ ', 'var(--k-2ecc71, #2ecc71)'),
                        renderFaabChip(addedFaab, '+ ', 'var(--k-2ecc71, #2ecc71)'),
                        hasOutgoing && hasIncoming && h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.5, alignSelf: 'center' } }, 'for'),
                        renderChips(droppedPids, '\u2212 ', 'var(--k-e74c3c, #e74c3c)'),
                        renderPickChips(droppedPicks, '\u2212 ', 'var(--k-e74c3c, #e74c3c)'),
                        renderFaabChip(droppedFaab, '\u2212 ', 'var(--k-e74c3c, #e74c3c)'),
                        !hasTradeAssets && h('span', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6, fontStyle: 'italic' } }, 'No recorded asset changes'),
                    ),
                    netStr && h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: netCol, fontFamily: 'var(--font-mono)', flexShrink: 0 } }, netStr),
                    h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-mono)', flexShrink: 0 } }, date),
                ),
            );
        }

        return h('div', null,
            // Filter strip
            h('div', { style: { display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' } },
                h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: '4px' } }, 'Filter:'),
                filterChip('all', 'All ' + events.length),
                counts.trade && filterChip('trade', 'Trades'),
                counts.waiver && filterChip('waiver', 'Waivers'),
                counts.fa && filterChip('fa', 'Free Agency'),
                counts.note && filterChip('note', 'Notes'),
            ),
            filtered.length === 0 ? h(window.WR.Card, { padding: '24px' },
                h('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6, textAlign: 'center' } }, 'No ' + filter + ' history.')
            ) : groups.map((g, gi) => h('div', { key: 'g' + gi, style: { marginBottom: '20px' } },
                h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-title)', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' } },
                    g.month,
                    h('span', { style: { color: 'var(--silver)', opacity: 0.5, fontFamily: 'var(--font-mono)', fontWeight: 400 } }, g.items.length + ' decision' + (g.items.length === 1 ? '' : 's')),
                ),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    g.items.map((ev, i) => renderRow(ev, gi * 1000 + i)),
                ),
            )),
        );
    }

    // ── Model Settings sub-tab ────────────────────────────────────
    function SettingsView({ settings, setSettings, leagueSkin, currentLeague }) {
        // Trade aggression / acceptance floor lives in the GM Strategy editor
        // (My Strategy sub-tab) — not here. Model Settings is Alex behavioral
        // tuning only.
        const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
        const skinFeatures = resolvedLeagueSkin?.features || {};
        // Dynasty (E6): the two weekly focus chips hide — unless the pref is
        // currently ON, so users can still switch the deterministic pattern
        // cards off (the chip disappears once toggled off).
        const allowRedraft = window.App?.Intelligence?.allowRedraftFeatures
            ? window.App.Intelligence.allowRedraftFeatures(currentLeague) : true;
        const baseDraftYear = String(parseInt(currentLeague?.season || new Date().getFullYear(), 10) || new Date().getFullYear());
        const draftYearOptions = [baseDraftYear, String(Number(baseDraftYear) + 1), String(Number(baseDraftYear) + 2)];
        const settingsIntro = resolvedLeagueSkin?.features?.showDynastyValue === false
            ? 'These knobs control which behavioral insights surface in Overview, how confidently Alex needs to be before flagging something, and where you get pinged. Defaults follow this league format - use the presets below if you want a different vibe.'
            : 'These knobs control which behavioral insights surface in Overview, how confidently Alex needs to be before flagging something, and where you get pinged. Defaults are tuned for active dynasty managers - use the presets below if you want a different vibe.';
        const targetPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].concat(skinFeatures.showIDP === false ? [] : ['DL', 'LB', 'DB']);
        const draftPickYears = skinFeatures.showFuturePicks === false ? [baseDraftYear] : draftYearOptions;
        const update = (patch) => { const next = { ...settings, ...patch }; setSettings(next); saveSettings(next); };
        const updateFocus = (k, v) => update({ focus: { ...settings.focus, [k]: v } });
        const updateChannel = (k, v) => update({ channel: { ...settings.channel, [k]: v } });
        const tp = settings.tradePriority || { positions: {}, picks: {}, faab: true };
        const updateTP = (section, k, v) => update({ tradePriority: { ...tp, [section]: { ...tp[section], [k]: v } } });
        const updateTPFaab = (v) => update({ tradePriority: { ...tp, faab: v } });

        const sliderRow = (label, hint, key, min, max, step, format) => h('div', { style: { marginBottom: '18px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' } },
                h('span', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', opacity: 0.88, fontWeight: 600 } }, label),
                h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--gold)' } },
                    format ? format(settings[key]) : settings[key])
            ),
            hint && h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55, marginBottom: '8px', lineHeight: 1.4 } }, hint),
            h('input', {
                type: 'range', min, max, step: step || 1,
                value: settings[key],
                onChange: e => update({ [key]: Number(e.target.value) }),
                style: { width: '100%', accentColor: 'var(--gold)' },
            })
        );

        const focusChip = (k, label) => h('button', {
            key: k, onClick: () => updateFocus(k, !settings.focus[k]),
            style: {
                minHeight: '44px',
                padding: '6px 12px', borderRadius: 'var(--card-radius-sm)', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 500,
                cursor: 'pointer', fontFamily: 'var(--font-body)',
                border: '1px solid ' + (settings.focus[k] ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.1))'),
                background: settings.focus[k] ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-1, rgba(255,255,255,0.02))',
                color: settings.focus[k] ? 'var(--gold)' : 'var(--silver)',
            }
        }, label);
        const chanChip = (k, label, opts = {}) => h('button', {
            key: k, onClick: opts.disabled ? undefined : () => updateChannel(k, !settings.channel[k]),
            disabled: !!opts.disabled,
            title: opts.title,
            style: {
                minHeight: '44px',
                padding: '6px 12px', borderRadius: 'var(--card-radius-sm)', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 500,
                cursor: opts.disabled ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)',
                border: '1px solid ' + (settings.channel[k] ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.1))'),
                background: settings.channel[k] ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-1, rgba(255,255,255,0.02))',
                color: settings.channel[k] ? 'var(--gold)' : 'var(--silver)',
                opacity: opts.disabled ? 0.48 : 1,
            }
        }, label);

        const sectionTitle = (label) => h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', margin: '0 0 14px' } },
            h('h3', { style: { fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: 'var(--text-title, 1.125rem)', margin: 0, letterSpacing: '0.01em', color: 'var(--white)' } }, label.title),
            h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55, fontFamily: 'var(--font-mono)' } }, label.sub),
        );
        const presetButton = (label, desc, getPatch) => h('button', {
            onClick: () => { const p = getPatch(); setSettings(p); saveSettings(p); },
            title: desc,
            style: {
                ...presetBtnStyle,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
                padding: '8px 10px', textAlign: 'left',
            },
        },
            h('span', { style: { fontWeight: 700, color: 'var(--white)' } }, label),
            h('span', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.7, fontWeight: 400 } }, desc),
        );

        return h('div', null,
            // Intro card
            h('div', { style: { padding: '12px 16px', marginBottom: '14px', background: 'rgba(124,107,248,0.04)', border: '1px solid rgba(124,107,248,0.15)', borderRadius: 'var(--card-radius, 10px)' } },
                h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--purple)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px', fontFamily: 'var(--font-title)' } }, 'How Alex talks to you'),
                h('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.85, lineHeight: 1.5 } },
                    settingsIntro)
            ),
            h('div', { className: 'gm-office-settings-grid' },
                h(window.WR.Card, { padding: 'var(--card-pad-lg)' },
                    sectionTitle({ title: 'Sensitivity', sub: 'When and how often Alex speaks up' }),
                    sliderRow('Alert threshold', 'Minimum confidence Alex needs before showing an insight. Higher = quieter, only the strong signals.', 'alertThreshold', 0, 100, 1, v => v + '%'),
                    sliderRow('Max alerts per week', 'Caps how many cards Alex shows in Overview. Lower = curated.', 'maxAlertsPerWeek', 1, 20, 1),
                    sliderRow('Min projected-points delta', 'Smallest swing (in projected fantasy points) Alex bothers flagging on lineup or waiver moves.', 'minPointsDelta', 0, 10, 0.5, v => Number(v).toFixed(1) + ' pts'),
                    h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55, marginTop: '4px', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-title)', fontWeight: 700 } }, 'Quick presets'),
                    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' } },
                        presetButton('Conservative', 'Only flag 85%+ confidence \u00B7 ~3 alerts/week',
                            () => ({ ...DEFAULT_SETTINGS, alertThreshold: 85, maxAlertsPerWeek: 3, minPointsDelta: 4 })),
                        presetButton('Balanced', 'Tuned defaults \u00B7 70% threshold \u00B7 ~6 alerts/week',
                            () => ({ ...DEFAULT_SETTINGS })),
                        presetButton('Aggressive', '55% threshold \u00B7 up to 12 alerts/week',
                            () => ({ ...DEFAULT_SETTINGS, alertThreshold: 55, maxAlertsPerWeek: 12, minPointsDelta: 1 })),
                    ),
                ),
                h(window.WR.Card, { padding: 'var(--card-pad-lg)' },
                    sectionTitle({ title: 'Focus areas', sub: 'Which categories Alex monitors' }),
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } },
                        (allowRedraft || !!settings?.focus?.startSit) && focusChip('startSit', 'Start / Sit'),
                        focusChip('trades', 'Trades'),
                        focusChip('waivers', 'Waivers'),
                        focusChip('draft', 'Draft'),
                        focusChip('injury', 'Injury watch'),
                        (allowRedraft || !!settings?.focus?.streaming) && focusChip('streaming', 'Streaming'),
                        focusChip('gmStyle', 'GM style')
                    ),
                    h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '12px', lineHeight: 1.5 } },
                        'Alex only surfaces insights for active areas. Decision History still logs everything regardless.'),
                    h('div', { style: { marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))' } },
                        sectionTitle({ title: 'Notifications', sub: 'Where you get pinged' }),
                        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } },
                            chanChip('inApp', 'GM Office cards'),
                            chanChip('email', 'Email (coming soon)', { disabled: true, title: 'Email delivery is not wired yet.' }),
                            chanChip('push', 'Push (coming soon)', { disabled: true, title: 'Push delivery is not wired yet.' }),
                        ),
                        h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55, marginTop: '10px', lineHeight: 1.5 } },
                            'GM Office cards controls whether Alex surfaces behavioral cards here. Email and push delivery need the notification service before they can be enabled.'),
                    )
                ),
            ),
            // ── Asset Priorities (trade acceptance % now lives in the GM Strategy editor) ──
            h('div', { className: 'gm-office-settings-grid', style: { marginTop: 'var(--card-gap)' } },
                h(window.WR.Card, { padding: 'var(--card-pad-lg)' },
                    sectionTitle({ title: 'Asset Priorities', sub: 'What Deal HQ targets' }),
                    h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginBottom: '14px', lineHeight: 1.45 } },
                        'Active chips tell Deal HQ which assets to prioritize. All positions off = auto-detect from roster needs.'),
                    // Positions
                    h('div', { style: { marginBottom: '16px' } },
                        h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px', fontFamily: 'var(--font-title)' } }, 'Target Positions'),
                        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                            targetPositions.map(pos => {
                                const posColors = window.App?.POS_COLORS || { QB:'var(--k-ff6b6b, #ff6b6b)', RB:'var(--k-4ecdc4, #4ecdc4)', WR:'var(--k-45b7d1, #45b7d1)', TE:'var(--k-f7dc6f, #f7dc6f)', K:'var(--k-bb8fce, #bb8fce)', DEF:'var(--k-85929e, #85929e)', DL:'var(--k-e67e22, #e67e22)', LB:'var(--k-f0a500, #f0a500)', DB:'var(--k-5dade2, #5dade2)' };
                                const label = window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
                                const active = tp.positions?.[pos];
                                const c = posColors[pos] || 'var(--silver)';
                                return h('button', {
                                    key: pos, onClick: () => updateTP('positions', pos, !active),
                                    style: {
                                        minHeight: '44px',
                                        padding: '5px 12px', borderRadius: 'var(--card-radius-sm)', fontSize: 'var(--text-body, 1rem)', fontWeight: 700,
                                        cursor: 'pointer', fontFamily: 'var(--font-mono)',
                                        border: '1px solid ' + (active ? wrAlpha(c, '88') : 'var(--ov-6, rgba(255,255,255,0.1))'),
                                        background: active ? wrAlpha(c, '18') : 'var(--ov-1, rgba(255,255,255,0.02))',
                                        color: active ? c : 'var(--silver)',
                                    }
                                }, label);
                            })
                        )
                    ),
                    // Draft picks + FAAB side by side
                    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'start' } },
                        h('div', null,
                            h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px', fontFamily: 'var(--font-title)' } }, 'Draft Pick Years'),
                            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                                draftPickYears.map(yr => {
                                    const active = tp.picks?.[yr];
                                    return h('button', {
                                        key: yr, onClick: () => updateTP('picks', yr, !active),
                                        style: {
                                            minHeight: '44px',
                                            padding: '5px 14px', borderRadius: 'var(--card-radius-sm)', fontSize: 'var(--text-body, 1rem)', fontWeight: 700,
                                            cursor: 'pointer', fontFamily: 'var(--font-mono)',
                                            border: '1px solid ' + (active ? 'rgba(187,143,206,0.5)' : 'var(--ov-6, rgba(255,255,255,0.1))'),
                                            background: active ? 'rgba(187,143,206,0.12)' : 'var(--ov-1, rgba(255,255,255,0.02))',
                                            color: active ? 'var(--k-bb8fce, #bb8fce)' : 'var(--silver)',
                                        }
                                    }, yr);
                                })
                            )
                        ),
                        h('div', null,
                            h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px', fontFamily: 'var(--font-title)' } }, 'FAAB'),
                            h('button', {
                                onClick: () => updateTPFaab(!tp.faab),
                                style: {
                                    minHeight: '44px',
                                    padding: '5px 14px', borderRadius: 'var(--card-radius-sm)', fontSize: 'var(--text-body, 1rem)', fontWeight: 700,
                                    cursor: 'pointer', fontFamily: 'var(--font-mono)',
                                    border: '1px solid ' + (tp.faab ? 'rgba(46,204,113,0.5)' : 'var(--ov-6, rgba(255,255,255,0.1))'),
                                    background: tp.faab ? 'rgba(46,204,113,0.12)' : 'var(--ov-1, rgba(255,255,255,0.02))',
                                    color: tp.faab ? 'var(--good)' : 'var(--silver)',
                                }
                            }, tp.faab ? 'Include' : 'Off'),
                        ),
                    ),
                ),
            ),
        );
    }

    const presetBtnStyle = {
        flex: 1, padding: '7px 10px', borderRadius: '6px',
        fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, cursor: 'pointer',
        background: 'transparent', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
        color: 'var(--silver)', fontFamily: 'var(--font-body)',
    };

    // ── Main component ────────────────────────────────────────────
    function AlexInsightsTab(props) {
        const [subTab, setSubTab] = useState(() => {
            // Priority: explicit prop (used by old tab=strategy URLs) →
            // ?film-sub=… hash arg → last-used sub → 'overview'.
            if (props.initialSubTab) return props.initialSubTab;
            try {
                const m = (window.location.hash || '').match(/[?&]film-sub=([^&]+)/);
                if (m) return m[1];
                return localStorage.getItem('wr_alex_subtab') || 'overview';
            } catch { return 'overview'; }
        });
        const resolvedLeagueSkin = props.leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
        const hideStrategyTab = resolvedLeagueSkin?.type === 'redraft';
        const activeSubTab = hideStrategyTab && subTab === 'strategy' ? 'overview' : subTab;
        const alexTabs = [
            { k: 'overview', label: 'Overview' },
            ...(hideStrategyTab ? [] : [{ k: 'strategy', label: 'My Strategy' }]),
            { k: 'patterns', label: 'Patterns' },
            { k: 'history', label: 'Decision History' },
            { k: 'settings', label: 'Model Settings' },
        ];
        useEffect(() => {
            if (activeSubTab !== subTab) setSubTab(activeSubTab);
        }, [activeSubTab, subTab]);
        useEffect(() => { try { localStorage.setItem('wr_alex_subtab', activeSubTab); } catch {} }, [activeSubTab]);

        const [settings, setSettings] = useState(loadSettings);

        // Keep local state in sync with cross-surface setting changes so
        // Overview filters update when the user tweaks sliders elsewhere.
        useEffect(() => {
            if (!window.WR?.AlexSettings?.subscribe) return;
            return window.WR.AlexSettings.subscribe((next) => setSettings(next || loadSettings()));
        }, []);

        // Scout-free vs Pro (gate-map row 10): free keeps the raw activity
        // counts (KPI inputs), Decision History, Model Settings, and the raw
        // Patterns charts; the read layer (GM Grade composite, behavioral
        // insight cards + Intelligence decoration/publish, Alex chart reads,
        // AI insights) is Pro. wrIsPro only — never canAccess/getTier.
        const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;

        // Safe read of derived data — handle mid-load states
        const kpis = React.useMemo(() => computeKpis(props), [props.myRoster, props.currentLeague, props.timeRecomputeTs]);
        const rawInsightBase = React.useMemo(() => computeInsights(props, kpis), [kpis, props.myRoster, props.playersData]);
        // Free: never decorate (Intelligence.buildBehavioralRecommendation is
        // the rec engine) — the raw count alone feeds the locked teaser row.
        const rawInsights = React.useMemo(
            () => isPro ? decorateInsightRecommendations(rawInsightBase, props, kpis, 'heuristic') : [],
            [rawInsightBase, props, kpis, isPro]
        );
        // Filter through AlexSettings — applies alertThreshold + focus areas + maxAlertsPerWeek.
        const insights = React.useMemo(() => {
            if (window.WR?.AlexSettings?.filterInsights) return window.WR.AlexSettings.filterInsights(rawInsights);
            return rawInsights.slice(0, 6);
        }, [rawInsights, settings]);

        return h('div', { className: 'gm-office-shell wr-fade-in' },
            h(SubTabs, {
                value: activeSubTab,
                onChange: setSubTab,
                tabs: alexTabs
            }),
            activeSubTab === 'overview' && h(OverviewView, { kpis, insights, props, settings, isPro, lockedInsightCount: rawInsightBase.length }),
            !hideStrategyTab && activeSubTab === 'strategy' && h(StrategySubview, { props }),
            activeSubTab === 'patterns' && h(PatternsView, { props, isPro }),
            activeSubTab === 'history' && h(HistoryView, { props }),
            activeSubTab === 'settings' && h(SettingsView, { settings, setSettings, leagueSkin: props.leagueSkin, currentLeague: props.currentLeague })
        );
    }

    // ── Strategy sub-view — embeds the existing StrategyEditorTab ──────
    function StrategySubview({ props }) {
        if (typeof window.StrategyEditorTab !== 'function') {
            return h('div', { style: { padding: '40px', textAlign: 'center', color: 'var(--silver)' } }, 'Strategy editor module not loaded.');
        }
        return React.createElement(window.StrategyEditorTab, {
            currentLeague: props.currentLeague,
            myRoster: props.myRoster,
            playersData: props.playersData,
            gmStrategy: props.gmStrategy,
            setGmStrategy: props.setGmStrategy,
        });
    }

    // ── Phone-scoped CSS (≤767 only) ─────────────────────────────
    // Brand-new classes, never referenced by desktop markup, and double-
    // gated behind the media query — inert on desktop by construction.
    // Lives here (not index.html / wr-primitives.js) per the GM's Office
    // scope: the InsightCard CTA fix stays inside this file.
    (function ensureGmOfficePhoneCss() {
        if (document.getElementById('gmoff-phone-css')) return;
        const el = document.createElement('style');
        el.id = 'gmoff-phone-css';
        el.textContent = '@media (max-width: 767px){'
            // WR.Kpi tiles ride the P4 snap strip at a readable width
            // (~2.2 tiles visible at 390px); long subs wrap inside.
            + '.gmoff-kpis > *{max-width:200px;}'
            // Compact InsightCard CTA goes full-width: wrapper > card root >
            // content column (the root's last div child) > direct-child CTA
            // button. The feedback thumbs sit one div deeper — untouched.
            + '.gmoff-phone-ins > div > div:last-child > button{width:100%;justify-content:center;}'
            + '}';
        document.head.appendChild(el);
    })();

    window.AlexInsightsTab = AlexInsightsTab;
})();
