// ══════════════════════════════════════════════════════════════════
// wr-ai-context.js — WarRoom-owned AI context helpers
//
// Two jobs:
//   1. WR.AIContext — close the ReconAI consistency gap. Calls that stay on
//      the generic dhqAI path are blind to league format and quality gates
//      (see RECONAI-CONSISTENCY-REPORT.md). buildFormatPreamble() produces a
//      compact client-side mirror of the edge function's format + quality
//      blocks to prepend to those context strings. buildStructuredBase()
//      shapes the base payload for structured OD.callAI types
//      (team_diagnosis / insight / dashboard_digest), including the
//      stateHash that keys the server response cache.
//   2. WR.AIFeedback — the learning-loop capture point. Fire-and-forget
//      thumbs/acted signals to the ai-feedback edge function via the shared
//      Supabase client. Fails silently: feedback must never break UX.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    function detectFormat(league) {
        const rp = league?.roster_positions || league?.rosterPositions || [];
        const scoring = league?.scoring_settings || league?.scoringSettings || {};
        const sfSlots = rp.filter(s => s === 'SUPER_FLEX').length;
        const idpSlots = rp.filter(s => ['IDP_FLEX', 'DL', 'LB', 'DB', 'DE', 'CB', 'S'].includes(s)).length;
        const recBonus = scoring.rec || 0;
        const teBonus = scoring.bonus_rec_te || scoring.rec_te || 0;
        return {
            isSuperFlex: sfSlots > 0,
            numQBSlots: rp.filter(s => s === 'QB').length + sfSlots,
            isTEP: teBonus > 0,
            tePremiumBonus: teBonus,
            isIDP: idpSlots > 0,
            idpSlots,
            numRBSlots: rp.filter(s => s === 'RB').length,
            scoringType: recBonus >= 1 ? 'ppr' : recBonus >= 0.5 ? 'half_ppr' : recBonus > 0 ? 'custom' : 'std',
        };
    }

    // Compact text mirror of the edge function's league-format + quality
    // blocks, for prepending to generic dhqAI context strings.
    function buildFormatPreamble(league) {
        const fmt = detectFormat(league);
        const lines = [];
        if (fmt.isSuperFlex) {
            lines.push(`SUPERFLEX league (${fmt.numQBSlots} QB-eligible slots): QBs carry a 1.8x scarcity premium. A team without ${fmt.numQBSlots} startable QBs has a CRITICAL deficit that overrides all other needs.`);
        }
        if (fmt.isTEP) {
            lines.push(`TE PREMIUM league (+${fmt.tePremiumBonus} PPR for TE): elite TEs carry a 1.5x premium — never treat them as interchangeable depth.`);
        }
        if (fmt.isIDP) {
            lines.push(`IDP league (${fmt.idpSlots} defensive starter slots): LB/DL/DB have real fantasy and trade value.`);
        }
        if (fmt.scoringType === 'ppr') lines.push('FULL PPR scoring: high-volume pass catchers carry premium value.');
        else if (fmt.scoringType === 'half_ppr') lines.push('HALF PPR scoring: balanced value between receivers and rushers.');
        if (fmt.numRBSlots >= 2) lines.push(`${fmt.numRBSlots} dedicated RB slots plus FLEX: startable RBs are scarce — do not advise trading away RB depth lightly.`);
        lines.push('QUALITY FLOORS (always enforce): never recommend adding/bidding on players with DHQ below 500 or PPG below 5.0 (6+ games). "Depth for depth\'s sake" is never valid. If no quality targets exist, say "HOLD YOUR FAAB."');
        return '--- LEAGUE FORMAT & QUALITY RULES ---\n' + lines.join('\n') + '\n';
    }

    // Cheap stable hash (djb2) — keys the localStorage + server caches to the
    // league's current state. The server re-hashes the full context anyway.
    function hashString(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    function stateHashFor(league, roster, extra) {
        const parts = [
            league?.league_id || league?.id || '',
            (roster?.players || []).slice().sort().join(','),
            roster?.settings ? `${roster.settings.wins}-${roster.settings.losses}` : '',
            window.S?.nflState?.week || '',
            extra || '',
        ];
        return hashString(parts.join('|'));
    }

    // Base payload for structured OD.callAI types. The edge function's
    // detectLeagueFormat/buildTeamModeBlock read exactly these field names.
    function buildStructuredBase(league, assessment, roster) {
        // GM Strategy — the canonical serialized plan (WR.GmMode.promptBlock):
        // mode directive, timeline, floor, postures, positions, sell rules,
        // untouchable names. '' when no strategy is saved / gm-mode not loaded.
        // The edge function reads ctx.gmStrategy (team_diagnosis + insight).
        // Folded into stateHash so a strategy edit busts the response caches.
        let gmStrategy = '';
        try {
            gmStrategy = window.WR?.GmMode?.promptBlock?.(league?.league_id || league?.id) || '';
        } catch (e) { /* gm-mode optional */ }
        return {
            leagueId: league?.league_id || league?.id || null,
            leagueName: league?.name || '',
            rosterPositions: league?.roster_positions || [],
            roster_positions: league?.roster_positions || [],
            scoringSettings: league?.scoring_settings || {},
            scoring_settings: league?.scoring_settings || {},
            teamTier: assessment?.tier || '',
            teamWindow: assessment?.window || assessment?.tradeWindow || '',
            healthScore: assessment?.healthScore || 0,
            gmStrategy,
            stateHash: stateHashFor(league, roster, gmStrategy),
        };
    }

    window.WR.AIContext = { detectFormat, buildFormatPreamble, buildStructuredBase, stateHashFor };

    // ── Learning-loop feedback capture ────────────────────────────────
    const _sentKeys = new Set();

    async function send(args) {
        try {
            const { leagueId, surface, recId, action, subject } = args || {};
            if (!surface || !recId || !action) return false;
            const key = `${surface}|${recId}|${action}`;
            if (_sentKeys.has(key)) return true; // session-level dedupe
            const client = window.OD && typeof window.OD.getClient === 'function' ? window.OD.getClient() : null;
            if (!client || !client.functions || typeof client.functions.invoke !== 'function') return false;
            _sentKeys.add(key);
            const { error } = await client.functions.invoke('ai-feedback', {
                body: { leagueId: leagueId || null, surface, recId: String(recId).slice(0, 200), action, subject: subject || null },
            });
            if (error) { _sentKeys.delete(key); return false; }
            return true;
        } catch (e) {
            return false;
        }
    }

    window.WR.AIFeedback = { send };
})();
