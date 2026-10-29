// ══════════════════════════════════════════════════════════════════
// js/draft/cpu-engine.js — the mock draft's computer picks
//
// The pick formula (shared mock-engine.js) runs on the engine server (Phase
// A7, 2026-10-29): this sends a trimmed persona and the available players to
// dhq-mock and maps the answer back to the pool's own player object. Where
// mock-engine.js is loaded (tests, the server) it runs here instead.
//
// Exposes: window.DraftCC.cpuEngine.{ personaPick, computePredictions }
//   personaPick(persona, available, round, pickNumber, ctx) → Promise<{player, confidence, reasoning}|null>
//   computePredictions(teams, pool, ctx) → Promise<{ [rid]: { willReach, willPassOn, likelyPick } }>
//     teams: [{ rid, persona, round, pick }]
// ══════════════════════════════════════════════════════════════════

(function() {

    // Persona/DNA-informed CPU opponents are Scout Pro (owner ruling Q10, mirrors
    // reconai _mockDNAInformedPick): free mocks draft plain best-available via the
    // BPA fallback below, and behavioral predictions stay empty. Fail-open when
    // pro-gate.js isn't loaded.
    const _cpuIsPro = () => typeof window.wrIsPro !== 'function' || window.wrIsPro();
    const MOCK_URL = 'https://hovnqztlbsgsywrbidbh.supabase.co/functions/v1/dhq-mock';

    // What the pick formula reads, and nothing else (mock-engine.js).
    function slimPersona(p) {
        if (!p) return null;
        const a = p.assessment || {}, d = p.draftDna || {};
        return {
            draftDna: { label: d.label, posPct: d.posPct, r1Positions: d.r1Positions },
            tradeDna: p.tradeDna ? { key: p.tradeDna.key } : undefined,
            posture: p.posture ? { key: p.posture.key } : undefined,
            assessment: { needs: a.needs, strengths: a.strengths, healthScore: a.healthScore, window: a.window, tier: a.tier },
        };
    }
    function slimPlayer(p) {
        return {
            pid: p.pid, name: p.name, pos: p.pos, dhq: p.dhq, val: p.val,
            consensusRank: p.consensusRank, overallRank: p.overallRank, rank: p.rank,
            tier: p.tier, draftRound: p.draftRound, age: p.age,
            csv: p.csv ? { tier: p.csv.tier, draftRound: p.csv.draftRound, age: p.csv.age } : undefined,
        };
    }
    function slimCtx(ctx) {
        ctx = ctx || {};
        return { teamRoster: ctx.teamRoster, draftTuning: ctx.draftTuning, draftWeights: ctx.draftWeights };
    }
    async function post(body) {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
        try {
            const r = await fetch(MOCK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', signal: ctl ? ctl.signal : undefined });
            if (!r.ok) throw new Error('dhq-mock ' + r.status);
            return await r.json();
        } finally { if (timer) clearTimeout(timer); }
    }

    function bestAvailable(available) {
        if (!available || !available.length) return null;
        const best = available.reduce((a, b) => ((b.dhq || b.val || 0) > (a.dhq || a.val || 0) ? b : a), available[0]);
        return { player: best, confidence: 0.5, reasoning: { primary: 'BPA fallback', baseVal: best.dhq || best.val || 0, nudges: [], bpaFloorTriggered: true } };
    }

    async function personaPick(persona, available, round, pickNumber, ctx) {
        if (!available || !available.length) return null;
        // Pro only — free mocks pick best-available.
        if (_cpuIsPro()) {
            if (window.App?.MockEngine?.personaPick) return window.App.MockEngine.personaPick(persona, available, round, pickNumber, ctx);
            try {
                const r = await post({ op: 'pick', persona: slimPersona(persona), pool: available.map(slimPlayer), round, pick: pickNumber, ctx: slimCtx(ctx) });
                const player = r && r.pid != null ? available.find(p => p.pid === r.pid) : null;
                if (player) return { player, confidence: r.confidence, reasoning: r.reasoning };
            } catch (e) {
                if (window.wrLog) window.wrLog('cpuEngine.pick', e);
            }
        }
        return bestAvailable(available);
    }

    async function computePredictions(teams, pool, ctx) {
        const empty = () => ({ willReach: [], willPassOn: [], likelyPick: null });
        const out = {};
        if (!_cpuIsPro() || !pool || !pool.length) { (teams || []).forEach(t => { out[t.rid] = empty(); }); return out; }
        const ME = window.App?.MockEngine;
        if (ME?.computePredictions) {
            (teams || []).forEach(t => { out[t.rid] = ME.computePredictions(t.persona, pool, t.round, t.pick, ctx); });
            return out;
        }
        // The formula reads the top 20 of the pool (by value, as given).
        const top = pool.slice(0, 20);
        const r = await post({ op: 'predict', pool: top.map(slimPlayer), ctx: { draftTuning: (ctx || {}).draftTuning, draftWeights: (ctx || {}).draftWeights },
            teams: (teams || []).map(t => ({ rid: t.rid, persona: slimPersona(t.persona), round: t.round, pick: t.pick })) });
        const preds = (r && r.predictions) || {};
        (teams || []).forEach(t => { if (preds[t.rid]) out[t.rid] = preds[t.rid]; });
        return out;
    }

    // Warm the connection and the server when the draft room loads, so the
    // first computer pick is as quick as the rest.
    if (!window.App?.MockEngine && typeof fetch === 'function') {
        try { fetch(MOCK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"op":"pick","pool":[]}', credentials: 'omit' }).catch(() => {}); } catch (e) { /* offline */ }
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.cpuEngine = {
        personaPick,
        computePredictions,
        _slim: { slimPersona, slimPlayer, slimCtx },
    };
})();
