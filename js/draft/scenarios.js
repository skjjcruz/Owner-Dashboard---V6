// ══════════════════════════════════════════════════════════════════
// js/draft/scenarios.js — Canned "what-if" scenarios for mock drafts
//
// A scenario is a seed transformation applied after pool + pickOrder are
// built, but BEFORE the first pick fires. It can:
//   - Reorder the pool (force a player to top or bottom)
//   - Modify the pickOrder (swap ownership)
//   - Pre-populate picks (simulate N picks being made a certain way)
//
// Phase 5 ships with 3 presets. applyScenario() returns a mutated
// { pool, pickOrder, prePicks } triple that START_DRAFT can consume.
//
// Depends on: state.js (reducer) — applyScenario runs before START_DRAFT
// Exposes:    window.DraftCC.scenarios.{ presets, applyScenario }
// ══════════════════════════════════════════════════════════════════

(function() {
    const PRESETS = [
        {
            id: 'top-qb-falls',
            name: 'Top QB falls to you',
            desc: 'The consensus #1 QB inexplicably drops into your first pick range. What do you do?',
            icon: '🎯',
            apply: (state, pool, pickOrder) => {
                // Find the top-ranked QB in the pool
                const topQB = pool
                    .filter(p => p.pos === 'QB')
                    .sort((a, b) => (b.dhq || 0) - (a.dhq || 0))[0];
                if (!topQB) return { pool, pickOrder, prePicks: [] };

                // Pre-populate picks so the user's first pick is still available
                // Strategy: simulate picks 1..userSlot-1 being made with pool's top players,
                // but EXCLUDING topQB from that pool.
                const userSlotIdx = (state.userSlot || 1) - 1;
                const prePicks = [];
                const drafted = new Set([topQB.pid]);

                for (let i = 0; i < userSlotIdx; i++) {
                    const slot = pickOrder[i];
                    // Pick top available that isn't topQB
                    const available = pool.filter(p => !drafted.has(p.pid));
                    const pick = available[0];
                    if (!pick) break;
                    drafted.add(pick.pid);
                    prePicks.push({
                        round: slot.round,
                        slot: slot.slot,
                        overall: slot.overall,
                        teamIdx: slot.teamIdx,
                        rosterId: slot.rosterId,
                        isUser: false,
                        pid: pick.pid,
                        name: pick.name,
                        pos: pick.pos,
                        dhq: pick.dhq,
                        consensusRank: pick.consensusRank,
                        photoUrl: pick.photoUrl,
                        college: pick.college,
                        reasoning: { primary: 'Scenario seed', baseVal: pick.dhq, nudges: [] },
                        ts: Date.now(),
                    });
                }

                return {
                    pool: pool.filter(p => !drafted.has(p.pid)),
                    pickOrder,
                    prePicks,
                    narrative: `🎯 SCENARIO ACTIVE — ${topQB.name} (${topQB.pos}) has fallen to pick #${userSlotIdx + 1}. Your call.`,
                };
            },
        },
        {
            id: 'trade-up-to-1',
            name: 'I trade up to #1 overall',
            desc: 'You pulled off a blockbuster trade pre-draft. Pick 1.01 is yours.',
            icon: '🔄',
            apply: (state, pool, pickOrder) => {
                // Swap ownership of pick 1 with user's first pick
                const userSlotIdx = (state.userSlot || 1) - 1;
                const newPickOrder = pickOrder.map((p, i) => {
                    if (p.round === 1 && p.slot === 1) {
                        // This becomes the user's pick
                        return { ...p, rosterId: state.userRosterId, traded: true };
                    }
                    if (p.round === 1 && i === userSlotIdx) {
                        // This becomes the original #1 slot owner's pick
                        const origTop = pickOrder[0];
                        return { ...p, rosterId: origTop.rosterId, traded: true };
                    }
                    return p;
                });
                return {
                    pool,
                    pickOrder: newPickOrder,
                    prePicks: [],
                    narrative: `🔄 SCENARIO ACTIVE — You traded up to the #1 overall pick. The board is yours.`,
                };
            },
        },
        {
            id: 'rb-run-r1',
            name: 'Position run on RB in R1',
            desc: 'The first 5 picks of R1 are all running backs. The board zigs.',
            icon: '🏃',
            apply: (state, pool, pickOrder) => {
                // Pre-populate picks 1..5 as RBs, avoiding the user's slot
                const topRBs = pool
                    .filter(p => p.pos === 'RB')
                    .sort((a, b) => (b.dhq || 0) - (a.dhq || 0))
                    .slice(0, 6);
                if (topRBs.length < 5) return { pool, pickOrder, prePicks: [] };

                const userSlotIdx = (state.userSlot || 1) - 1;
                const prePicks = [];
                const drafted = new Set();

                for (let i = 0; i < 5; i++) {
                    // Skip the user's slot — we don't pre-pick for the user
                    if (i === userSlotIdx) continue;
                    const slot = pickOrder[i];
                    const rb = topRBs.find(p => !drafted.has(p.pid));
                    if (!rb) break;
                    drafted.add(rb.pid);
                    prePicks.push({
                        round: slot.round,
                        slot: slot.slot,
                        overall: slot.overall,
                        teamIdx: slot.teamIdx,
                        rosterId: slot.rosterId,
                        isUser: false,
                        pid: rb.pid,
                        name: rb.name,
                        pos: rb.pos,
                        dhq: rb.dhq,
                        consensusRank: rb.consensusRank,
                        photoUrl: rb.photoUrl,
                        college: rb.college,
                        reasoning: { primary: 'Scenario seed (RB run)', baseVal: rb.dhq, nudges: [] },
                        ts: Date.now(),
                    });
                }

                return {
                    pool: pool.filter(p => !drafted.has(p.pid)),
                    pickOrder,
                    prePicks,
                    narrative: `🏃 SCENARIO ACTIVE — Position run on RB detected. ${prePicks.length} RBs gone in the first 5 picks. Pivot fast.`,
                };
            },
        },
    ];

    /**
     * applyScenario — transforms { pool, pickOrder } for a given scenario.
     * Returns null if scenarioId is unknown.
     *
     * @param {DraftState} state — the pre-start state (contains userSlot, userRosterId, etc.)
     * @param {Array} pool
     * @param {Array} pickOrder
     * @param {string} scenarioId
     * @returns {{ pool, pickOrder, prePicks, narrative }|null}
     */
    function applyScenario(state, pool, pickOrder, scenarioId) {
        const preset = PRESETS.find(p => p.id === scenarioId);
        if (!preset) return null;
        try {
            return preset.apply(state, pool.slice(), pickOrder.slice());
        } catch (e) {
            if (window.wrLog) window.wrLog('scenarios.apply', e);
            return null;
        }
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.scenarios = {
        presets: PRESETS,
        applyScenario,
    };
})();
