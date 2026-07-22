// ══════════════════════════════════════════════════════════════════
// js/draft/persona.js — Persona composer for Draft Command Center
//
// A Persona is a composite "personality" for a CPU team in a mock draft.
// Composed once at draft start, cached in draftState.personas[rosterId].
// Used by cpu-engine.personaPick + opponent-intel-panel.
//
// Composes FOUR intelligence sources into one object:
//   1. Draft History DNA  — window.DraftHistory.loadDraftDNA(leagueId)
//   2. Trade DNA archetype — window.App.DNA_TYPES (from trade-calc.js)
//   3. Team assessment     — window.assessTeamFromGlobal(rosterId)
//   4. Owner posture       — window.App.calcOwnerPosture(assessment, dnaKey)
//
// Phase 1 builds the shape end-to-end; Phase 2 will add predictions
// (willReach / willPassOn / likelyPick) via the cpu-engine picker.
//
// Depends on: styles.js, window.App.*, window.DraftHistory, window.assessTeamFromGlobal
// Exposes:    window.DraftCC.persona.composePersona(rosterId, leagueId, draftDnaMap)
// ══════════════════════════════════════════════════════════════════

(function() {
    const DEFAULT_DRAFT_DNA = {
        label:         'Balanced',
        tendency:      '',
        posPct:        {},
        r1Positions:   [],
        earlyDefPct:   0,
        avgQBRound:    null,
        roundProfile:  '',
        picksAnalyzed: 0,
        seasons:       '',
        inferred:      true,
    };

    const DEFAULT_TRADE_DNA = {
        key: 'NONE',
        label: 'Balanced',
        color: 'var(--silver)',
        multiplier: 1.0,
        taxes: [],
        source: 'default',
    };

    const DEFAULT_POSTURE = {
        key: 'NEUTRAL',
        label: 'Neutral',
        color: 'var(--k-95a5a6, #95a5a6)',
        desc: 'No strong push.',
    };

    function normalizeDraftDna(raw) {
        if (!raw) return { ...DEFAULT_DRAFT_DNA };
        return {
            label:         raw.label || 'Balanced',
            tendency:      raw.tendency || '',
            posPct:        raw.posPct || {},
            r1Positions:   raw.r1Positions || [],
            earlyDefPct:   raw.earlyDefPct || 0,
            overallDefPct: raw.overallDefPct || 0,
            avgQBRound:    raw.avgQBRound || null,
            roundProfile:  raw.roundProfile || '',
            picksAnalyzed: raw.picksAnalyzed || 0,
            seasons:       raw.seasons || '',
            inferred:      (raw.picksAnalyzed || 0) < 3,
            displayName:   raw.displayName || '',
        };
    }

    function normalizeTradeDna(dnaKey) {
        const DNA_TYPES = window.DraftCC?.tradeHelpers?.DNA_TYPES
            || window.App?.DNA_TYPES
            || window.App?.TradeEngine?.DNA_TYPES
            || null;
        if (!DNA_TYPES || !DNA_TYPES[dnaKey]) return { ...DEFAULT_TRADE_DNA };
        const d = DNA_TYPES[dnaKey];
        return {
            key: dnaKey,
            label: d.label || 'Balanced',
            color: d.color || 'var(--silver)',
            desc: d.desc || '',
            multiplier: d.multiplier != null ? d.multiplier : 1.0,
            taxes: d.taxes || [],
            strategy: d.strategy || '',
            source: 'assigned',
        };
    }

    function normalizePosture(postureObj) {
        if (!postureObj) return { ...DEFAULT_POSTURE };
        return {
            key: postureObj.key || 'NEUTRAL',
            label: postureObj.label || 'Neutral',
            color: postureObj.color || 'var(--k-95a5a6, #95a5a6)',
            desc: postureObj.desc || '',
        };
    }

    // Normalize assessment — safe fallbacks for every field.
    function normalizeAssessment(raw) {
        if (!raw) {
            return {
                healthScore: 50,
                tier: 'CROSSROADS',
                panic: 0,
                window: 'CROSSROADS',
                needs: [],
                strengths: [],
                weeklyPts: 0,
                faabRemaining: null,
            };
        }
        return {
            healthScore: raw.healthScore || raw.health || 50,
            tier: raw.tier || 'CROSSROADS',
            panic: raw.panic || 0,
            window: raw.window || raw.tier || 'CROSSROADS',
            needs: Array.isArray(raw.needs) ? raw.needs : [],
            strengths: Array.isArray(raw.strengths) ? raw.strengths : [],
            weeklyPts: raw.weeklyPts || 0,
            faabRemaining: raw.faabRemaining != null ? raw.faabRemaining : null,
        };
    }

    /**
     * composePersona — build a Persona object for a single roster.
     *
     * @param {Object} opts
     *   rosterId       — Sleeper roster_id (number)
     *   leagueId       — Sleeper league_id (string)
     *   draftDnaMap    — optional map { [roster_id]: DraftDNA } (from window.DraftHistory.loadDraftDNA)
     *   tradeDnaMap    — optional map { [roster_id]: dnaKey } (from window._tcDnaMap)
     *   roster         — optional { roster_id, owner_id, team_name, avatar }
     *   displayName    — optional string
     * @returns {Persona}
     */
    function composePersona(opts) {
        const rosterId = opts.rosterId;
        const leagueId = opts.leagueId || '';
        const draftDnaMap = opts.draftDnaMap || {};
        const tradeDnaMap = opts.tradeDnaMap || window._tcDnaMap || {};

        // Draft DNA
        const rawDraftDna = draftDnaMap[rosterId] || draftDnaMap[String(rosterId)] || null;
        const draftDna = normalizeDraftDna(rawDraftDna);

        // Trade DNA archetype
        const dnaKey = tradeDnaMap[rosterId] || tradeDnaMap[String(rosterId)] || 'NONE';
        const tradeDna = normalizeTradeDna(dnaKey);

        // Team assessment
        let rawAssess = null;
        try {
            if (typeof window.assessTeamFromGlobal === 'function') {
                rawAssess = window.assessTeamFromGlobal(rosterId);
            }
        } catch (e) {
            if (window.wrLog) window.wrLog('persona.assessTeam', e);
        }
        const assessment = normalizeAssessment(rawAssess);

        // Posture
        let rawPosture = null;
        try {
            const calcPosture = window.DraftCC?.tradeHelpers?.calcOwnerPosture
                || window.App?.TradeEngine?.calcOwnerPosture
                || window.App?.calcOwnerPosture;
            if (calcPosture) rawPosture = calcPosture(rawAssess, dnaKey);
        } catch (e) {
            if (window.wrLog) window.wrLog('persona.calcPosture', e);
        }
        const posture = normalizePosture(rawPosture);

        // Roster metadata (best-effort — pulled from window.S if not passed in)
        const rosters = window.S?.rosters || [];
        const roster = opts.roster || rosters.find(r => r.roster_id === rosterId) || {};
        const users = window.S?.leagueUsers || [];
        const owner = users.find(u => u.user_id === roster.owner_id);
        const teamName = opts.teamName || owner?.metadata?.team_name || owner?.display_name || owner?.username || ('Team ' + rosterId);
        const ownerName = opts.displayName || owner?.display_name || owner?.username || '';
        const avatar = opts.avatar || (owner?.avatar ? ('https://sleepercdn.com/avatars/thumbs/' + owner.avatar) : '');

        const persona = {
            rosterId,
            ownerId: roster.owner_id || null,
            teamName,
            ownerName,
            avatar,

            draftDna,
            tradeDna,
            assessment,
            posture,

            // Phase 2 predictions — empty for now
            predictions: {
                round: 0,
                willReach: [],
                willPassOn: [],
                likelyPick: null,
            },

            // Derived flags — filled in Phase 2+
            flags: {
                hasGrudgeWithUser: false,
                grudgeScore: 0,
                draftRelationship: 'neutral',
            },
        };
        try {
            if (window.DraftCC?.context?.buildOwnerIntel) {
                persona.ownerIntel = window.DraftCC.context.buildOwnerIntel(persona, {
                    leagueId,
                    rosterId,
                });
            }
        } catch (e) {
            if (window.wrLog) window.wrLog('persona.ownerIntel', e);
        }
        return persona;
    }

    /**
     * composeAllPersonas — build Persona objects for every roster in the league.
     * Used at startMockDraft and cached in draftState.personas.
     *
     * @param {string} leagueId
     * @param {Object} draftDnaMap  from window.DraftHistory.loadDraftDNA(leagueId)
     * @returns {Object} { [rosterId]: Persona }
     */
    function composeAllPersonas(leagueId, draftDnaMap) {
        const rosters = window.S?.rosters || [];
        const out = {};
        rosters.forEach(r => {
            out[r.roster_id] = composePersona({
                rosterId: r.roster_id,
                leagueId,
                draftDnaMap,
                roster: r,
            });
        });
        return out;
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.persona = {
        composePersona,
        composeAllPersonas,
        normalizeDraftDna,
        normalizeTradeDna,
        normalizePosture,
        normalizeAssessment,
    };
})();
