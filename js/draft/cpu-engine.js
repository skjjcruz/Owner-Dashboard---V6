// ══════════════════════════════════════════════════════════════════
// js/draft/cpu-engine.js — Thin wrapper around shared/mock-engine.js
//
// Delegates to the canonical shared MockEngine for all pick logic.
// Keeps the DraftCC.cpuEngine namespace for backward compat.
//
// Depends on: reconai/shared/mock-engine.js (loaded via CDN)
// Exposes:    window.DraftCC.cpuEngine.{ personaPick, computePredictions }
// ══════════════════════════════════════════════════════════════════

(function() {

    // Persona/DNA-informed CPU opponents are Scout Pro (owner ruling Q10, mirrors
    // reconai _mockDNAInformedPick): free mocks draft plain best-available via the
    // BPA fallback below, and behavioral predictions stay empty. Fail-open when
    // pro-gate.js isn't loaded.
    const _cpuIsPro = () => typeof window.wrIsPro !== 'function' || window.wrIsPro();

    function personaPick(persona, available, round, pickNumber, ctx) {
        // Delegate to shared canonical engine (Pro only — free = BPA fallback)
        if (_cpuIsPro() && window.App?.MockEngine?.personaPick) {
            return window.App.MockEngine.personaPick(persona, available, round, pickNumber, ctx);
        }
        // Emergency BPA fallback
        if (!available || !available.length) return null;
        const best = available.reduce((a, b) => ((b.dhq || b.val || 0) > (a.dhq || a.val || 0) ? b : a), available[0]);
        return { player: best, confidence: 0.5, reasoning: { primary: 'BPA fallback', baseVal: best.dhq || best.val || 0, nudges: [], bpaFloorTriggered: true } };
    }

    function computePredictions(persona, pool, round, pickNumber, ctx) {
        if (_cpuIsPro() && window.App?.MockEngine?.computePredictions) {
            return window.App.MockEngine.computePredictions(persona, pool, round, pickNumber, ctx);
        }
        return { willReach: [], willPassOn: [], likelyPick: null };
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.cpuEngine = {
        personaPick,
        computePredictions,
    };
})();
