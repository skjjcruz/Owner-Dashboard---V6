// ── Start/Sit Verdict ────────────────────────────────────────────
// The instant, deterministic "who to start" line on Game Day. It is built
// ONLY from the numbers the Lineup screen already shows (the optimizer's
// swap list and its gains, on DHQ's projections or the platform's while DHQ
// loads) — no model, no network, so it is on screen the moment the lineup
// is. Alex's prose streams in underneath it.
//
// TRUTH LAW: every name and number here comes from the engine's facts. When
// the engine can't separate two players (the best swap gains less than
// CLOSE_CALL_PTS), the verdict says so instead of pretending to a call.
//
// Pure: runs in the browser (window.App.StartSitVerdict) and in Node tests.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // Below this projected gain the two players are a coin flip on the
    // engine's own numbers (projections move more than this intra-week).
    const CLOSE_CALL_PTS = 0.5;

    function fmtPts(n) {
        const v = Math.round((Number(n) || 0) * 10) / 10;
        return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1));
    }

    function slotLabel(slot) {
        return String(slot || '').replace(/_/g, ' ').trim();
    }

    // facts: { onDhq, provLabel, starters, swaps:[{slot, in, out, gain, inPts?, outPts?}], benchPts }
    // inPts/outPts are the two players' numbers the swap was decided on: on
    // DHQ that is each player's average week (the rows show his typical week),
    // so the call names them ("avg 12.7 vs 10.1") and never contradicts the
    // screen (review 2026-09-29).
    // → { kind: 'empty'|'swap'|'close'|'optimal', text, source, top } or null
    function compute(facts) {
        if (!facts || typeof facts !== 'object') return null;
        const source = facts.onDhq ? 'DHQ' : String(facts.provLabel || 'platform');
        const swaps = Array.isArray(facts.swaps) ? facts.swaps.filter(Boolean) : [];

        if (!facts.starters) {
            return { kind: 'empty', source, top: null, text: 'Your starting slots are empty — fill them before kickoff.' };
        }
        if (!swaps.length) {
            return { kind: 'optimal', source, top: null, text: 'Start who’s in — your lineup is already optimal.' };
        }

        const top = swaps.reduce((a, b) => ((Number(b.gain) || 0) > (Number(a.gain) || 0) ? b : a), swaps[0]);
        const gain = Number(top.gain) || 0;
        const slot = slotLabel(top.slot);
        const more = swaps.length - 1;
        const avgWord = facts.onDhq ? 'avg ' : '';
        const tail = more > 0 ? ' · ' + more + ' more swap' + (more > 1 ? 's' : '') + ', +' + fmtPts(facts.benchPts) + (facts.onDhq ? ' avg' : '') + ' in all' : '';
        const both = top.in && top.out && top.inPts != null && top.outPts != null && isFinite(top.inPts) && isFinite(top.outPts);
        const pair = both ? avgWord + fmtPts(top.inPts) + ' vs ' + fmtPts(top.outPts) : '';

        if (top.in && top.out && gain < CLOSE_CALL_PTS) {
            return {
                kind: 'close', source, top,
                text: 'Too close to call: ' + top.in + ' vs ' + top.out + (slot ? ' at ' + slot : '')
                    + ' — the projections are within ' + fmtPts(Math.max(gain, 0)) + ' pts' + (pair ? ' (' + pair + ')' : '') + '. Your call.' + tail,
            };
        }
        let text;
        if (top.in && top.out) text = 'Start ' + top.in + ' over ' + top.out + (slot ? ' at ' + slot : '');
        else if (top.in) text = 'Start ' + top.in + (slot ? ' in your empty ' + slot : '');
        else if (top.out) text = 'Sit ' + top.out + (slot ? ' at ' + slot : '');
        else return { kind: 'optimal', source, top: null, text: 'Start who’s in — your lineup is already optimal.' };
        return { kind: 'swap', source, top, text: text + ' (' + (pair ? pair + ', ' : '') + '+' + fmtPts(gain) + ' pts)' + tail };
    }

    const StartSitVerdict = { CLOSE_CALL_PTS, compute };
    App.StartSitVerdict = App.StartSitVerdict || StartSitVerdict;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = StartSitVerdict;
})(typeof window !== 'undefined' ? window : globalThis);
