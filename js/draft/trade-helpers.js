// ══════════════════════════════════════════════════════════════════
// js/draft/trade-helpers.js — Portable trade psychology helpers
//
// trade-calc.js defines calcOwnerPosture / calcPsychTaxes / calcGrudgeTax
// as closure-scoped constants inside the TradeCalcTab component. They are
// not exposed globally, so the Draft Command Center can't reach them from
// persona.js or opponent-intel.js.
//
// This module lifts the same fallback implementations that trade-calc.js
// uses at lines 890–900 when the ReconAI shared trade-engine.js doesn't
// supply its own. Keep these in sync with trade-calc.js if that file's
// fallbacks are ever updated — marked with `SYNCED-WITH: trade-calc.js:890-900`.
//
// Also wires DNA_TYPES / POSTURES onto window.DraftCC.tradeHelpers so
// persona.js doesn't need to reach back into the React closure.
//
// Depends on: (none — pure JS, no React)
// Exposes:    window.DraftCC.tradeHelpers.{ DNA_TYPES, POSTURES, calcOwnerPosture, calcPsychTaxes, calcGrudgeTax }
// ══════════════════════════════════════════════════════════════════

(function() {
    // ── DNA_TYPES (copied from trade-calc.js:574 — kept verbatim) ─────
    const DNA_TYPES = {
        NONE: { label: '— Not Set —', color: 'var(--silver)', desc: '', taxes: [] },
        FLEECER: {
            label: 'The Fleecer',
            color: 'var(--k-e74c3c, #e74c3c)',
            desc: 'High activity, always hunting asymmetric value.',
            taxes: ['Endowment -5 pts', 'Surplus hunter'],
        },
        DOMINATOR: {
            label: 'The Dominator',
            color: 'var(--k-e67e22, #e67e22)',
            desc: 'High ego, requires visible surplus to pull the trigger.',
            taxes: ['Status Tax -18', 'Endowment -14', 'Loss Aversion -8'],
        },
        STALWART: {
            label: 'The Stalwart',
            color: 'var(--k-5dade2, #5dade2)',
            desc: 'High stability, emotionally attached to their roster.',
            taxes: ['Endowment -10', 'Loss Aversion -8'],
        },
        ACCEPTOR: {
            label: 'The Acceptor',
            color: 'var(--k-2ecc71, #2ecc71)',
            desc: 'Low attachment, willing to sell for futures.',
            taxes: ['Rebuilding Discount +10', 'Endowment -3'],
        },
        DESPERATE: {
            label: 'The Desperate',
            color: 'var(--k-bb8fce, #bb8fce)',
            desc: 'High urgency triggered by injuries, bye-weeks, or playoff push.',
            taxes: ['Panic Premium +14 to +26', 'Endowment -8'],
        },
    };

    const POSTURES = {
        DESPERATE: { key: 'DESPERATE', label: 'Desperate',    color: 'var(--k-bb8fce, #bb8fce)', desc: 'Panic-mode — will overpay for immediate help.' },
        BUYER:     { key: 'BUYER',     label: 'Active Buyer', color: 'var(--k-f0a500, #f0a500)', desc: 'Contender upgrading — open to deals.' },
        NEUTRAL:   { key: 'NEUTRAL',   label: 'Neutral',      color: 'var(--k-95a5a6, #95a5a6)', desc: 'No strong push. Fair offers only.' },
        SELLER:    { key: 'SELLER',    label: 'Active Seller',color: 'var(--k-5dade2, #5dade2)', desc: 'Moving assets for futures.' },
        LOCKED:    { key: 'LOCKED',    label: 'Locked In',    color: 'var(--k-7f8c8d, #7f8c8d)', desc: 'Satisfied roster, high attachment.' },
    };

    // ── calcOwnerPosture (SYNCED-WITH: trade-calc.js:891) ────────────
    function calcOwnerPosture(assessment, dnaKey) {
        // Defer to ReconAI shared engine if available
        const shared = window.App?.TradeEngine?.calcOwnerPosture;
        if (typeof shared === 'function') return shared(assessment, dnaKey);

        if (!assessment) return POSTURES.NEUTRAL;
        const { tier, panic } = assessment;
        if (panic >= 4) return POSTURES.DESPERATE;
        if (tier === 'REBUILDING' || dnaKey === 'ACCEPTOR') return POSTURES.SELLER;
        if (tier === 'ELITE' && (panic || 0) <= 1) return POSTURES.LOCKED;
        if ((tier === 'CONTENDER' || tier === 'CROSSROADS') && (panic || 0) >= 2) return POSTURES.BUYER;
        return POSTURES.NEUTRAL;
    }

    // ── calcPsychTaxes (SYNCED-WITH: trade-calc.js:892) ──────────────
    function calcPsychTaxes(myAssess, theirAssess, theirDnaKey, theirPosture) {
        const shared = window.App?.TradeEngine?.calcPsychTaxes;
        if (typeof shared === 'function') return shared(myAssess, theirAssess, theirDnaKey, theirPosture);

        const taxes = [];
        const ePct = ({ FLEECER: 10, DOMINATOR: 28, STALWART: 20, ACCEPTOR: 5, DESPERATE: 15, NONE: 12 })[theirDnaKey] || 12;
        taxes.push({
            name: 'Endowment Effect',
            impact: -Math.round(ePct / 2),
            type: 'TAX',
            desc: '~' + ePct + '% mental inflation on their own players.',
        });
        if (theirAssess && theirAssess.panic >= 3) {
            taxes.push({
                name: 'Panic Premium',
                impact: 8 + (theirAssess.panic - 2) * 6,
                type: 'BONUS',
                desc: 'Panic ' + theirAssess.panic + '/5 — urgency overrides caution.',
            });
        }
        if (theirDnaKey === 'DOMINATOR') {
            taxes.push({
                name: 'Status Tax',
                impact: -18,
                type: 'TAX',
                desc: 'Must visibly win the trade for ego/status.',
            });
        }
        if (theirDnaKey === 'STALWART' || theirDnaKey === 'DOMINATOR') {
            taxes.push({
                name: 'Loss Aversion',
                impact: -8,
                type: 'TAX',
                desc: 'Losing a familiar player hurts more than gaining a new one.',
            });
        }
        if (theirDnaKey === 'ACCEPTOR') {
            taxes.push({
                name: 'Rebuilding Discount',
                impact: +10,
                type: 'BONUS',
                desc: 'They mentally discount current starters.',
            });
        }
        const myStrengths = (myAssess && myAssess.strengths) || [];
        const theirNeedPos = ((theirAssess && theirAssess.needs) || []).slice(0, 3)
            .map(n => (typeof n === 'string' ? n : n && n.pos))
            .filter(Boolean);
        if (theirNeedPos.some(p => myStrengths.includes(p))) {
            taxes.push({
                name: 'Need Fulfillment',
                impact: +12,
                type: 'BONUS',
                desc: 'Your surplus fills their critical gap.',
            });
        }
        if (myAssess && theirAssess) {
            if (myAssess.window !== theirAssess.window) {
                taxes.push({
                    name: 'Window Alignment',
                    impact: +8,
                    type: 'BONUS',
                    desc: 'Opposite windows = natural asset exchange.',
                });
            } else {
                taxes.push({
                    name: 'Window Friction',
                    impact: -5,
                    type: 'TAX',
                    desc: 'Same window reduces natural motivation.',
                });
            }
        }
        if (theirPosture && theirPosture.key === 'LOCKED') {
            taxes.push({
                name: 'Locked Roster Tax',
                impact: -12,
                type: 'TAX',
                desc: 'High satisfaction + attachment.',
            });
        } else if (theirPosture && theirPosture.key === 'SELLER') {
            taxes.push({
                name: 'Seller Momentum',
                impact: +10,
                type: 'BONUS',
                desc: 'Actively shopping.',
            });
        }
        return taxes;
    }

    // ── calcGrudgeTax — reads from window._tcGrudges (live array) ────
    function calcGrudgeTax(myRosterId, theirRosterId, grudges) {
        const arr = grudges || window._tcGrudges || [];
        if (!Array.isArray(arr) || !arr.length) return 0;
        const relevant = arr.filter(g =>
            (g.fromRosterId === myRosterId && g.toRosterId === theirRosterId) ||
            (g.fromRosterId === theirRosterId && g.toRosterId === myRosterId)
        );
        if (!relevant.length) return 0;
        return relevant.reduce((sum, g) => sum + (g.impact || 0), 0);
    }

    // ── calcAcceptanceLikelihood — CPU evaluates whether to accept ───
    // Returns 5..95 likelihood percentage.
    //
    // Scout's version in reconai/shared/trade-engine.js uses a similar formula.
    // Inputs:
    //   theirGain = DHQ value CPU would receive
    //   theirGive = DHQ value CPU would send
    //   theirDnaKey = DNA archetype (adjusts required margin)
    //   taxes = result from calcPsychTaxes (array of { impact } entries)
    //   theirAssess, myAssess = team assessments (used for minor adjustments)
    function calcAcceptanceLikelihood(theirGain, theirGive, theirDnaKey, taxes, theirAssess, myAssess) {
        const shared = window.App?.TradeEngine?.calcAcceptanceLikelihood || window.App?.calcAcceptanceLikelihood;
        if (typeof shared === 'function') return shared(theirGain, theirGive, theirDnaKey, taxes, theirAssess, myAssess);

        const totalA = Number(theirGain) || 0;
        const totalB = Number(theirGive) || 0;
        if (totalA <= 0 && totalB <= 0) return 50;

        const maxSide = Math.max(totalA, totalB, 1);
        const diff = totalA - totalB;
        const taxTotal = Array.isArray(taxes) ? taxes.reduce((s, t) => s + (Number(t.impact) || 0), 0) : 0;
        const taxValueAdjust = (taxTotal / 200) * maxSide;
        const normalizedSurplus = (diff + taxValueAdjust) / maxSide;
        const likelihood = 50 + Math.round(normalizedSurplus * 200);

        return Math.max(5, Math.min(95, Math.round(likelihood)));
    }

    // ── fairnessGrade — A-F style grade on a trade's DHQ symmetry ────
    // Perspective: "userSide" is what the user gives, "otherSide" is what they get.
    function fairnessGrade(userSide, otherSide) {
        const shared = window.App?.TradeEngine?.fairnessGrade || window.App?.fairnessGrade;
        if (typeof shared === 'function') return shared(userSide, otherSide);

        userSide = userSide || 1;
        otherSide = otherSide || 0;
        const ratio = otherSide / userSide; // >1 = user gains, <1 = user loses
        if (ratio >= 1.30) return { grade: 'A+', label: 'Steal', col: 'var(--k-2ecc71, #2ecc71)' };
        if (ratio >= 1.15) return { grade: 'A',  label: 'Win',   col: 'var(--k-2ecc71, #2ecc71)' };
        if (ratio >= 1.05) return { grade: 'B+', label: 'Favor', col: 'var(--k-2ecc71, #2ecc71)' };
        if (ratio >= 0.95) return { grade: 'B',  label: 'Fair',  col: 'var(--k-d4af37, #d4af37)' };
        if (ratio >= 0.85) return { grade: 'C',  label: 'Slight loss', col: 'var(--k-f0a500, #f0a500)' };
        if (ratio >= 0.75) return { grade: 'D',  label: 'Reach', col: 'var(--k-e67e22, #e67e22)' };
        return { grade: 'F', label: 'Bad', col: 'var(--k-e74c3c, #e74c3c)' };
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.tradeHelpers = {
        DNA_TYPES,
        POSTURES,
        calcOwnerPosture,
        calcPsychTaxes,
        calcGrudgeTax,
        calcAcceptanceLikelihood,
        fairnessGrade,
    };
})();
