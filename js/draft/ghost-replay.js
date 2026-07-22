// ══════════════════════════════════════════════════════════════════
// js/draft/ghost-replay.js — Ghost Replay mode
//
// Loads a prior completed Sleeper draft for the current league and
// replays the picks one-by-one using the command center's existing
// grid + panels. Alex commentary can fire on each pick (Phase 4 hooks
// reuse). A time-travel scrubber lets the user jump to any pick.
//
// Phase 5a shipping scope:
//   - listPriorDrafts(leagueId) → array of { draft_id, season, status }
//   - loadReplayPicks(draftId) → array of picks in Sleeper format
//   - buildReplayState(state, picks) → seed a draftState for replay mode
//   - replayAdvance(state) → a reducer-like helper to step forward
//
// The scrubber UI itself lives in command-center.js (control panel above
// the grid when mode === 'ghost').
//
// Depends on: window.Sleeper.fetchDrafts, window.Sleeper.fetchDraftPicks,
//             state.js
// Exposes:    window.DraftCC.ghostReplay
// ══════════════════════════════════════════════════════════════════

(function() {
    /**
     * listPriorDrafts — fetch a single league's draft history from Sleeper.
     * Returns completed drafts sorted newest-first.
     *
     * @param {string} leagueId
     * @returns {Promise<Array<{draft_id, season, status, type, settings}>>}
     */
    async function listPriorDrafts(leagueId) {
        if (!leagueId) return [];
        try {
            let drafts = null;
            if (window.Sleeper?.fetchDrafts) {
                drafts = await window.Sleeper.fetchDrafts(leagueId);
            } else {
                const resp = await fetch('https://api.sleeper.app/v1/league/' + leagueId + '/drafts');
                if (!resp.ok) return [];
                drafts = await resp.json();
            }
            if (!Array.isArray(drafts)) return [];
            return drafts
                .filter(d => d.status === 'complete' || d.status === 'pre_draft' || d.status === 'drafting')
                .sort((a, b) => (b.start_time || 0) - (a.start_time || 0));
        } catch (e) {
            if (window.wrLog) window.wrLog('ghostReplay.listDrafts', e);
            return [];
        }
    }

    /**
     * listLeagueChainDrafts — fetch this league's drafts AND walk the
     * `previous_league_id` chain backward to collect all drafts from prior
     * years of the SAME league (dynasty continuations).
     *
     * Stops walking when:
     *   - previous_league_id is null (top of chain reached)
     *   - we hit a cycle (shouldn't happen but defensively bounded at 10 hops)
     *   - a fetch fails
     *
     * Each draft is annotated with the league name it came from so the UI
     * can show "2024 Psycho League V · snake".
     *
     * @param {string} leagueId — the current league
     * @returns {Promise<Array<Draft & { leagueName, leagueId }>>}
     */
    async function listLeagueChainDrafts(leagueId) {
        if (!leagueId) return [];

        const fetchInfo = window.Sleeper?.fetchLeagueInfo || (async (lid) => {
            const resp = await fetch('https://api.sleeper.app/v1/league/' + lid);
            return resp.ok ? resp.json() : null;
        });
        const fetchDraftsFn = window.Sleeper?.fetchDrafts || (async (lid) => {
            const resp = await fetch('https://api.sleeper.app/v1/league/' + lid + '/drafts');
            return resp.ok ? resp.json() : [];
        });

        // Walk the previous_league_id chain backward, collecting league IDs + names
        const chain = []; // { id, name }
        let cursor = leagueId;
        const visited = new Set();
        for (let hop = 0; hop < 10 && cursor && !visited.has(cursor); hop++) {
            visited.add(cursor);
            try {
                const info = await fetchInfo(cursor);
                if (!info) break;
                chain.push({ id: cursor, name: info.name || 'League' });
                cursor = info.previous_league_id || null;
            } catch (e) {
                break;
            }
        }

        if (!chain.length) return [];

        // Fetch drafts for each league in the chain in parallel
        const draftResults = await Promise.allSettled(
            chain.map(async (lg) => {
                const drafts = await fetchDraftsFn(lg.id);
                return (Array.isArray(drafts) ? drafts : []).map(d => ({
                    ...d,
                    leagueName: lg.name,
                    leagueId: lg.id,
                }));
            })
        );

        // Flatten, dedupe by draft_id, sort newest-first
        const draftMap = new Map();
        draftResults.forEach(r => {
            if (r.status !== 'fulfilled') return;
            (r.value || []).forEach(d => {
                if (d.draft_id && !draftMap.has(d.draft_id)) {
                    draftMap.set(d.draft_id, d);
                }
            });
        });

        return [...draftMap.values()].sort((a, b) => {
            const seasonDiff = (parseInt(b.season) || 0) - (parseInt(a.season) || 0);
            if (seasonDiff !== 0) return seasonDiff;
            return (b.start_time || 0) - (a.start_time || 0);
        });
    }

    /**
     * loadReplayPicks — fetch picks for a specific draft.
     *
     * @param {string} draftId
     * @returns {Promise<Array>}  Sleeper pick objects
     */
    async function loadReplayPicks(draftId) {
        if (!draftId) return [];
        try {
            let picks = null;
            if (window.Sleeper?.fetchDraftPicks) {
                picks = await window.Sleeper.fetchDraftPicks(draftId);
            } else {
                const resp = await fetch('https://api.sleeper.app/v1/draft/' + draftId + '/picks');
                if (!resp.ok) return [];
                picks = await resp.json();
            }
            if (!Array.isArray(picks)) return [];
            return picks.sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0));
        } catch (e) {
            if (window.wrLog) window.wrLog('ghostReplay.loadPicks', e);
            return [];
        }
    }

    /**
     * buildReplayState — seed a draftState where all the real picks are
     * staged but NOT yet in state.picks. The reducer steps them in one
     * at a time when replayAdvance is called.
     *
     * @param {DraftState} baseState — after START_DRAFT
     * @param {Array} sleeperPicks — from loadReplayPicks
     * @returns {Object} { replayPicks, replayState }
     */
    function buildReplayState(baseState, sleeperPicks) {
        const playersData = window.S?.players || {};
        const normPos = window.App?.normPos || (p => p);

        // Convert Sleeper pick format to our state.pick format
        const replayPicks = sleeperPicks.map(sp => {
            const p = playersData[sp.player_id] || {};
            const dhq = window.App?.LI?.playerScores?.[sp.player_id] || 0;
            return {
                round: sp.round,
                slot: sp.draft_slot,
                overall: sp.pick_no,
                teamIdx: (sp.draft_slot || 1) - 1,
                rosterId: sp.roster_id || null,
                isUser: sp.roster_id === baseState.userRosterId,
                pid: sp.player_id,
                name: p.full_name || (p.first_name + ' ' + p.last_name).trim() || 'Unknown',
                pos: normPos(p.position) || p.position || '?',
                dhq,
                consensusRank: null,
                photoUrl: 'https://sleepercdn.com/content/nfl/players/thumb/' + sp.player_id + '.jpg',
                college: p.college || '',
                reasoning: { primary: 'Historical pick (ghost replay)', baseVal: dhq, nudges: [] },
                ts: sp.metadata?.ts || Date.now(),
                ghost: true, // mark as replay-sourced
            };
        });

        return {
            replayPicks,
            totalPicks: replayPicks.length,
        };
    }

    /**
     * ghostPickAtIdx — return the pick at a given replay index (for the
     * command-center CPU effect to dispatch MAKE_PICK with).
     */
    function ghostPickAtIdx(replayPicks, idx) {
        if (!replayPicks || idx < 0 || idx >= replayPicks.length) return null;
        return replayPicks[idx];
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.ghostReplay = {
        listPriorDrafts,
        listLeagueChainDrafts,
        loadReplayPicks,
        buildReplayState,
        ghostPickAtIdx,
    };
})();
