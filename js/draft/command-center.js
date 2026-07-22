// ══════════════════════════════════════════════════════════════════
// js/draft/command-center.js — <DraftCommandCenter/> main shell
//
// The 6-panel desktop dashboard. Owns draftState via useReducer, renders
// three row bands: header (60px) · top (Big Board / Draft Grid / Opponent
// Intel) · bottom (Live Analytics / Alex Stream). Wires the CPU auto-pick
// loop, speed control, localStorage auto-save, and the setup flow.
//
// Phase 1 replaces the old <MockDraftPanel/> when the feature flag
// `localStorage.wr_draft_cc_enabled` is on (default). Flip it off in
// devtools to fall back to the original MockDraftSimulator.
//
// Depends on: all js/draft/* modules above (styles, scouting, persona,
//             cpu-engine, state, big-board, draft-grid, opponent-intel,
//             alex-stream, live-analytics)
// Exposes:    window.DraftCommandCenter (React component)
//             window.DraftCC.featureFlag (localStorage key helper)
// ══════════════════════════════════════════════════════════════════

(function() {
    const { DRAFT_CC_LAYOUT, FONT_UI, FONT_DISPL, FONT_MONO, panelCard, bpBucket } = window.DraftCC.styles;
    const SpeedMap = { slow: 1600, medium: 700, fast: 250, paused: -1 };
    const avPick = (seed, arr) => (window.AlexVoice ? window.AlexVoice.pick(seed, arr) : arr[0]);
    // Scout-free vs Pro (js/shared/pro-gate.js). Fail-open so the room never
    // breaks without the gate. Free keeps the raw draft mechanics (board, grid,
    // BPA mock, pick log, raw DHQ totals); Alex layer, decision decks, grades,
    // persona reads, and every AI trigger are Pro.
    const ccIsPro = () => typeof window.wrIsPro !== 'function' || window.wrIsPro();

    const FEATURE_FLAG_KEY = 'wr_draft_cc_enabled';
    function isFeatureEnabled() {
        try {
            const v = localStorage.getItem(FEATURE_FLAG_KEY);
            // Default ON — user must explicitly set to 'false' to disable
            return v !== 'false';
        } catch (e) { return true; }
    }

    // ── Top-level shell ──────────────────────────────────────────────
    // Reorder a draft pool by the selected saved board lane. Players not in the
    // saved order keep their original DHQ-sorted position at the tail. Refreshes
    // consensusRank so reach/steal detection reflects the board the user picked.
    function applyUserBigBoardOrder(pool, leagueId, draftType) {
        if (!Array.isArray(pool) || !pool.length || !leagueId) return pool;
        try {
            const saved = window.DraftCC?.context?._private?.loadStoredBoard
                ? window.DraftCC.context._private.loadStoredBoard(leagueId, draftType)
                : null;
            let lane = saved?.activeLane || saved?.boardMode || 'dhq';
            // Free tier: persisted aiOrder may be a real optimizer order saved by a
            // Pro/trial session — treat a saved 'ai' lane as 'dhq' (raw value order).
            if (lane === 'ai' && !ccIsPro()) lane = 'dhq';
            const savedOrder = lane === 'ai' && Array.isArray(saved?.aiOrder) && saved.aiOrder.length
                ? saved.aiOrder
                : lane === 'my' && Array.isArray(saved?.myOrder) && saved.myOrder.length
                    ? saved.myOrder
                    : null;
            if (!savedOrder || !savedOrder.length) return pool;
            const rank = new Map();
            savedOrder.forEach((pid, i) => rank.set(String(pid), i));
            const getRank = p => {
                if (rank.has(String(p.pid))) return rank.get(String(p.pid));
                if (p.csvPid && rank.has(String(p.csvPid))) return rank.get(String(p.csvPid));
                return Infinity;
            };
            const reordered = pool.slice().sort((a, b) => {
                const ra = getRank(a);
                const rb = getRank(b);
                if (ra !== rb) return ra - rb;
                return (b.dhq || 0) - (a.dhq || 0);
            });
            reordered.forEach((p, i) => { p.consensusRank = i + 1; });
            return reordered;
        } catch (e) {
            if (window.wrLog) window.wrLog('cc.bigboardOrder', e);
            return pool;
        }
    }

    function normalizeDraftName(name) {
        return (name || '').toLowerCase().replace(/[''`.]/g, '').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/, '').replace(/\s+/g, ' ').trim();
    }

    // Pick labels follow the universal round.pick-in-round convention ("R2.01" =
    // first pick of round 2). `slot` on pickOrder rows is the team's draft COLUMN
    // (ownership key), so never label with it directly — derive from overall for
    // saved drafts that predate pickInRound.
    function pickInRoundOf(pick, leagueSize) {
        if (!pick) return 0;
        if (Number(pick.pickInRound) > 0) return Number(pick.pickInRound);
        const ls = Number(leagueSize) || 0;
        if (ls > 0 && Number(pick.overall) > 0) return ((Number(pick.overall) - 1) % ls) + 1;
        return Number(pick.slot) || 0;
    }

    function formatTradeAssetPick(pick, leagueSize) {
        if (!pick) return '';
        return 'R' + pick.round + '.' + String(pickInRoundOf(pick, leagueSize) || 0).padStart(2, '0');
    }

    function formatTradeAssetPlayer(pid) {
        const p = window.S?.players?.[pid] || {};
        const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
        return full || pid;
    }

    function formatTradePackageSide(proposal, side, leagueSize) {
        const picks = side === 'my' ? (proposal?.myGive || []) : (proposal?.theirGive || []);
        const players = side === 'my' ? (proposal?.myGivePlayers || []) : (proposal?.theirGivePlayers || []);
        const faab = side === 'my' ? (proposal?.myGiveFaab || 0) : (proposal?.theirGiveFaab || 0);
        const items = [];
        picks.slice(0, 2).forEach(p => items.push(formatTradeAssetPick(p, leagueSize)));
        players.slice(0, 1).forEach(pid => items.push(formatTradeAssetPlayer(pid)));
        const displayedAssets = Math.min(2, picks.length) + Math.min(1, players.length);
        if (faab > 0) items.push('$' + faab + ' FAAB');
        const remaining = Math.max(0, picks.length + players.length - displayedAssets);
        if (remaining) items.push('+' + remaining);
        return items.length ? items.join(', ') : 'No assets';
    }

    function liveTradeTimingLabel(tradeWindow) {
        if (tradeWindow?.onClock || !(tradeWindow?.picksAway > 0)) return 'On clock now';
        if (tradeWindow?.picksAway === 1) return 'Next pick';
        return tradeWindow.picksAway + ' picks away';
    }

    // picksAway between the user's next pick and the CURRENT pick: overall is
    // 1-based, currentIdx is 0-based, so subtract 1 — 0 means on the clock now.
    function userPicksAway(nextUserSlot, currentIdx) {
        return Math.max(0, (Number(nextUserSlot?.overall) || 0) - 1 - (Number(currentIdx) || 0));
    }

    function userPicksAwayDetail(nextUserSlot, currentIdx) {
        if (!nextUserSlot) return 'Watch the room';
        const away = userPicksAway(nextUserSlot, currentIdx);
        if (away === 0) return 'On the clock';
        return away + (away === 1 ? ' pick away' : ' picks away');
    }

    function describeLiveTradeWindow(tradeWindow, leagueSize) {
        const suggestion = tradeWindow?.suggestion || {};
        const proposal = suggestion.proposal || {};
        const give = formatTradePackageSide(proposal, 'my', leagueSize);
        const get = formatTradePackageSide(proposal, 'their', leagueSize);
        // Lead with the trade-cluster's reasoning headline when present, so the
        // narration explains WHY before it lists the mechanics.
        const headline = suggestion.reasoning?.headline;
        return (headline ? headline + ' ' : '')
            + liveTradeTimingLabel(tradeWindow) + ' at ' + tradeWindow.pickLabel + ': '
            + (suggestion.label || tradeWindow.motive || 'Trade window') + ' with ' + tradeWindow.teamName
            + '. Give ' + give + '; get ' + get + '. '
            + tradeWindow.likelihood + '% acceptance vs ' + tradeWindow.acceptanceLine + '% Buyer Line.';
    }

    function formatLiveClockTime(ts) {
        if (!ts) return 'not checked yet';
        try {
            return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
        } catch (_) {
            return 'recently';
        }
    }

    function sleeperDraftUrl(draftId) {
        return draftId ? 'https://sleeper.com/draft/nfl/' + draftId : '';
    }

    function detectSleeperDraftVariant(draft, currentLeague, fallback = 'startup') {
        try {
            return window.DraftCC?.state?.detectDraftVariant?.({
                currentLeague,
                draft,
                fallback,
            }) || fallback;
        } catch (_) {
            return fallback;
        }
    }

    function liveDraftSetupPatch(draft, currentLeague) {
        if (!draft?.draft_id) return {};
        const rounds = draft.settings?.rounds || 0;
        const variant = detectSleeperDraftVariant(draft, currentLeague);
        const patch = {
            sleeperDraftId: draft.draft_id,
            variant,
            liveDraftMeta: {
                draftId: draft.draft_id,
                status: draft.status || '',
                startTime: draft.start_time || null,
                type: draft.type || '',
                rounds,
                teams: draft.settings?.teams || 0,
                variant,
            },
        };
        if (rounds) patch.rounds = rounds;
        if (draft.settings?.teams) patch.leagueSize = draft.settings.teams;
        if (draft.type) patch.draftType = draft.type;
        return patch;
    }

    function pickLaunchableLiveDraft(drafts) {
        // The draft of record is launchable in every state: 'drafting' mirrors
        // live, 'pre_draft' opens the waiting room, and 'complete' (unsuperseded)
        // REBUILDS the finished board from Sleeper — full picks + grade — so a
        // just-run draft stays reviewable even if local state was lost.
        const sel = window.DraftCC?.state?.selectCurrentDraft?.(drafts);
        if (sel && sel.draft) return sel.draft;
        return (Array.isArray(drafts) ? drafts : [])
            .filter(d => d.status === 'drafting' || d.status === 'pre_draft')
            .sort((a, b) => {
                if (a.status !== b.status) return a.status === 'drafting' ? -1 : 1;
                return (a.start_time || Infinity) - (b.start_time || Infinity);
            })[0] || null;
    }

    function refreshRookieValuesFromEngine(saved, stateFns, playersData) {
        if (!saved || saved.variant !== 'rookie' || !stateFns?.buildPool) return saved;
        const freshPool = stateFns.buildPool({ variant: 'rookie', playersData, maxSize: 200 });
        if (!freshPool?.length) return saved;

        const byPid = new Map();
        const byCsvPid = new Map();
        const byName = new Map();
        freshPool.forEach(p => {
            byPid.set(String(p.pid), p);
            if (p.csvPid) byCsvPid.set(String(p.csvPid), p);
            byName.set(normalizeDraftName(p.name), p);
        });
        const findFresh = p => byPid.get(String(p?.pid)) || byCsvPid.get(String(p?.pid)) || byCsvPid.get(String(p?.csvPid)) || byName.get(normalizeDraftName(p?.name));
        const mergeFresh = p => {
            const fresh = findFresh(p);
            return fresh ? { ...p, ...fresh, reasoning: p.reasoning || fresh.reasoning, confidence: p.confidence || fresh.confidence } : p;
        };

        return {
            ...saved,
            pool: (saved.pool || []).map(mergeFresh).sort((a, b) => (b.dhq || 0) - (a.dhq || 0)),
            originalPool: freshPool.slice(),
            picks: (saved.picks || []).map(mergeFresh),
        };
    }

    function DraftCommandCenter({ playersData, myRoster, currentLeague, draftRounds: propRounds, forcedMode, autoStartLiveToken }) {
        const stateFns = window.DraftCC.state;

        // Phase 5+: mount-time fetch for the league's drafts so upcomingSettings
        // is populated even when window.S.drafts is empty (which is common —
        // the main app's Draft Room tab fetches it separately into draft-room.js).
        const [fetchedDrafts, setFetchedDrafts] = React.useState(null);
        // Live-polled traded picks for THIS draft (Follow Live Draft). Kept separate
        // from the league-wide window.S.tradedPicks so we don't clobber future-pick
        // data; merged into draftMeta below. Updated only when the set actually
        // changes (signature-gated in the live-sync onStatus handler).
        const [liveDraftTradedPicks, setLiveDraftTradedPicks] = React.useState(null);
        const liveTradedSigRef = React.useRef('');
        // MFL: live per-slot ownership from the draft board (round.slot → current
        // franchise, all rounds). Keeps the follow board's pick ownership current
        // (round1DraftOrder only covers round 1 and collapses traded picks).
        const [liveMflSlots, setLiveMflSlots] = React.useState(null);
        const liveMflSlotsSigRef = React.useRef('');
        const leagueIdForFetch = currentLeague?.league_id || currentLeague?.id;
        React.useEffect(() => {
            if (!leagueIdForFetch) return;
            let cancelled = false;
            // MFL: the Sleeper drafts endpoint 404s on the 'mfl_<id>_<year>' id;
            // use the status-bearing MFL draft objects hydrated onto window.S / the
            // league instead so slotToRoster + the live launch path resolve.
            const isMfl = !!(currentLeague?._mfl || String(currentLeague?.id || '').startsWith('mfl_'));
            const fn = isMfl
                ? (async () => window.S?.drafts || currentLeague?.drafts || [])
                : (window.Sleeper?.fetchDrafts || (async (lid) => {
                    const resp = await fetch('https://api.sleeper.app/v1/league/' + lid + '/drafts');
                    return resp.ok ? resp.json() : [];
                }));
            fn(leagueIdForFetch).then(d => {
                if (!cancelled) setFetchedDrafts(Array.isArray(d) ? d : []);
            }).catch(() => { if (!cancelled) setFetchedDrafts([]); });
            return () => { cancelled = true; };
        }, [leagueIdForFetch]);

        // Default setup from real Sleeper draft data
        const draftMeta = React.useMemo(() => {
            const rosters = window.S?.rosters || currentLeague?.rosters || [];
            const users = window.S?.leagueUsers || currentLeague?.users || [];
            const myUid = window.S?.user?.user_id || '';
            const myRid = myRoster?.roster_id;
            // Live-polled draft traded picks win over the league-wide snapshot for
            // this draft's rounds (.find below takes the first match); fall back to
            // window.S.tradedPicks for everything else.
            const liveTp = Array.isArray(liveDraftTradedPicks) ? liveDraftTradedPicks : [];
            const baseTp = window.S?.tradedPicks || [];
            const tradedPicks = liveTp.length ? [...liveTp, ...baseTp] : baseTp;
            const leagueSeason = String(currentLeague?.season || new Date().getFullYear());

            // Pre-indexed lookups — rosters/users/tradedPicks are otherwise scanned
            // with .find() across every slot and (worst) inside the round×slot
            // pick-ownership loop (a tradedPicks.find per cell). Raw-value Map keys
            // preserve the original strict-equality semantics exactly.
            const rosterByOwner = new Map();   // owner_id → roster
            const rosterById    = new Map();   // roster_id (raw) → roster
            const rosterByIdStr = new Map();   // String(roster_id) → roster
            for (const r of rosters) {
                if (r.owner_id != null) rosterByOwner.set(r.owner_id, r);
                if (r.roster_id != null) { rosterById.set(r.roster_id, r); rosterByIdStr.set(String(r.roster_id), r); }
            }
            const userById = new Map();        // user_id → user
            for (const u of users) { if (u.user_id != null) userById.set(u.user_id, u); }
            // Season's traded picks keyed round → originalRosterId → pick. Mirrors
            // the loop predicate (owner_id !== roster_id, season match); first match
            // wins, so live-sync picks (which lead the array) take precedence.
            const tradedByRound = new Map();
            for (const tp of tradedPicks) {
                if (tp.owner_id === tp.roster_id) continue;
                if (String(tp.season) !== leagueSeason) continue;
                let inner = tradedByRound.get(tp.round);
                if (!inner) { inner = new Map(); tradedByRound.set(tp.round, inner); }
                if (!inner.has(tp.roster_id)) inner.set(tp.roster_id, tp);
            }
            // Prefer mount-fetched drafts, then window.S cache, then currentLeague synthetic fallback
            const drafts = (fetchedDrafts && fetchedDrafts.length) ? fetchedDrafts : (window.S?.drafts || []);
            // Live-sync rooms orbit the draft of record (live → unsuperseded complete
            // → next pre_draft) so slotToRoster/draft_order match the draft actually
            // shown — a rebuilt completed board must use ITS order, not the next
            // scheduled draft's. Mock surfaces keep preferring the next schedulable.
            const recordSel = stateFns.selectCurrentDraft ? stateFns.selectCurrentDraft(drafts) : null;
            const upcoming = (forcedMode === 'live-sync' && recordSel && recordSel.draft)
                ? recordSel.draft
                : (drafts.find(d => d.status === 'pre_draft')
                    || drafts.find(d => d.status === 'drafting')
                    || drafts[0]);
            const sleeperOrder = upcoming?.draft_order || {};

            // MFL: the authoritative, trade-aware per-slot ownership for EVERY round
            // is the draft board's _slots (live-polled). round1DraftOrder only covers
            // round 1 and collapses franchises that own 0 or several picks.
            const mcIsMfl = !!(currentLeague?._mfl || String(currentLeague?.id || currentLeague?.league_id || '').startsWith('mfl_'));
            const mflSlots = mcIsMfl
                ? (Array.isArray(liveMflSlots) && liveMflSlots.length ? liveMflSlots
                    : (Array.isArray(upcoming?._slots) ? upcoming._slots : null))
                : null;

            const slotToRoster = {};
            const hasRealDraftOrder = Object.keys(sleeperOrder).length > 0;
            if (hasRealDraftOrder) {
                Object.entries(sleeperOrder).forEach(([userId, slot]) => {
                    const roster = rosterByOwner.get(userId);
                    const user = userById.get(userId);
                    const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + slot;
                    slotToRoster[slot] = { rosterId: roster?.roster_id, ownerName: name, userId };
                });
            } else {
                const sorted = [...rosters].sort((a, b) => {
                    const wa = a.settings?.wins || 0;
                    const wb = b.settings?.wins || 0;
                    if (wa !== wb) return wa - wb;
                    return (a.settings?.fpts || 0) - (b.settings?.fpts || 0);
                });
                sorted.forEach((r, i) => {
                    const user = userById.get(r.owner_id);
                    const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + (i + 1);
                    slotToRoster[i + 1] = { rosterId: r.roster_id, ownerName: name, userId: r.owner_id };
                });
            }

            // MFL: rebuild round-1 slot ownership from the board's _slots — complete
            // and current (the round1DraftOrder-derived map above drops slots when a
            // franchise owns 0 or multiple round-1 picks).
            if (mflSlots) {
                mflSlots.filter(s => Number(s.round) === 1 && s.draft_slot != null).forEach(s => {
                    const slot = Number(s.draft_slot);
                    const roster = rosterByIdStr.get(String(s.roster_id));
                    const user = userById.get(roster?.owner_id);
                    const name = user?.metadata?.team_name || user?.display_name || user?.username || ('Team ' + slot);
                    slotToRoster[slot] = { rosterId: roster?.roster_id || s.roster_id, ownerName: name, userId: roster?.owner_id || s.roster_id };
                });
            }

            // Compute total teams — prefer upcoming.settings.teams, then league settings, then roster count
            const fallbackTeams = (rosters.length) || 12;
            const totalTeams = (upcoming?.settings?.teams)
                || (currentLeague?.settings?.num_teams)
                || (window.S?.leagues?.[0]?.settings?.num_teams)
                || Math.max(Object.keys(slotToRoster).length, fallbackTeams);

            // Fill in any missing slots with remaining rosters (round-robin over
            // ghost/unmapped rosters). When draft_order is partial (e.g., only
            // the user is mapped), this keeps every slot populated so downstream
            // code like buildPickOrder + isUserTurn works correctly.
            const mappedRosterIds = new Set(Object.values(slotToRoster).map(e => e.rosterId).filter(Boolean));
            const unmappedRosters = rosters.filter(r => !mappedRosterIds.has(r.roster_id));
            let ghostIdx = 0;
            for (let slot = 1; slot <= totalTeams; slot++) {
                if (slotToRoster[slot]) continue;
                const r = unmappedRosters[ghostIdx++] || {};
                const user = r.owner_id ? userById.get(r.owner_id) : null;
                const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + slot;
                slotToRoster[slot] = {
                    rosterId: r.roster_id || null,
                    ownerName: name,
                    userId: r.owner_id || null,
                };
            }

            let mySlot = null;
            for (const [slot, info] of Object.entries(slotToRoster)) {
                if (info.userId === myUid || info.rosterId === myRid) {
                    mySlot = parseInt(slot, 10);
                    break;
                }
            }

            const numTeams = totalTeams;

            // If we couldn't find the user in the draft_order mapping (common in
            // demo/test leagues with unmapped users), force them into slot 1.
            if (!mySlot && myRid != null) {
                const forcedSlot = 1;
                mySlot = forcedSlot;
                slotToRoster[forcedSlot] = {
                    rosterId: myRid,
                    ownerName: 'YOU',
                    userId: myUid || null,
                };
            }

            // Build pick ownership (traded picks)
            const pickOwnership = {};
            if (mflSlots) {
                // MFL: take each (round, slot)'s CURRENT owner straight from the draft
                // board — covers every round and reflects traded picks (refreshes each
                // poll). Marked "traded" when the slot's owner differs from its round-1
                // owner or MFL's comment flagged it.
                mflSlots.forEach(s => {
                    const rd = Number(s.round), slot = Number(s.draft_slot);
                    if (!rd || !slot) return;
                    const roster = rosterByIdStr.get(String(s.roster_id));
                    const user = userById.get(roster?.owner_id);
                    const name = user?.metadata?.team_name || user?.display_name || ('Team ' + slot);
                    const origInfo = slotToRoster[slot] || {};
                    pickOwnership[rd + '-' + slot] = {
                        ownerName: name,
                        rosterId: roster?.roster_id || s.roster_id,
                        traded: !!s._traded || (origInfo.rosterId != null && String(origInfo.rosterId) !== String(s.roster_id)),
                        originalOwner: origInfo.ownerName,
                    };
                });
            } else
            for (let rd = 1; rd <= (propRounds || 5); rd++) {
                for (let slot = 1; slot <= numTeams; slot++) {
                    const origInfo = slotToRoster[slot] || {};
                    const origRid = origInfo.rosterId;
                    const traded = origRid != null ? tradedByRound.get(rd)?.get(origRid) : undefined;
                    if (traded) {
                        const newOwner = rosterById.get(traded.owner_id);
                        const newUser = userById.get(newOwner?.owner_id);
                        const newName = newUser?.metadata?.team_name || newUser?.display_name || 'Team';
                        pickOwnership[rd + '-' + slot] = {
                            ownerName: newName,
                            rosterId: traded.owner_id,
                            traded: true,
                            originalOwner: origInfo.ownerName,
                        };
                    } else {
                        pickOwnership[rd + '-' + slot] = {
                            ownerName: origInfo.ownerName || 'Team ' + slot,
                            rosterId: origRid,
                            traded: false,
                        };
                    }
                }
            }

            // Phase 5+: surface the upcoming draft's full settings so Solo mode
            // defaults can match the league's scheduled draft. Prefer the real
            // draft object; fall back to currentLeague.settings which always
            // has draft_rounds + num_teams on a synced Sleeper league.
            const legacyLeagueSettings = currentLeague?.settings || window.S?.leagues?.[0]?.settings || {};
            const draftVariant = stateFns.detectDraftVariant
                ? stateFns.detectDraftVariant({ currentLeague, draft: upcoming, fallback: 'startup' })
                : detectSleeperDraftVariant(upcoming, currentLeague);
            const upcomingSettings = upcoming ? {
                draftId: upcoming.draft_id,
                rounds: upcoming.settings?.rounds || legacyLeagueSettings.draft_rounds || null,
                teams:  upcoming.settings?.teams  || legacyLeagueSettings.num_teams || null,
                type:   upcoming.type || null,
                variant: draftVariant,
                startTime: upcoming.start_time || null,
                status:  upcoming.status || null,
                season:  upcoming.season || null,
            } : (legacyLeagueSettings.draft_rounds || legacyLeagueSettings.num_teams ? {
                draftId: null,
                rounds: legacyLeagueSettings.draft_rounds || null,
                teams:  legacyLeagueSettings.num_teams || null,
                type:   null,
                variant: draftVariant,
                startTime: null,
                status:  null,
                season:  null,
            } : null);

            return {
                mySlot: mySlot || Math.min(6, numTeams),
                slotToRoster,
                pickOwnership,
                numTeams,
                draftType: upcoming?.type || 'snake',
                draftVariant,
                upcomingSettings,
            };
        }, [myRoster, currentLeague, propRounds, fetchedDrafts, liveDraftTradedPicks, liveMflSlots]);

        // Reducer + initial state (load from localStorage if possible)
        const [state, dispatch] = React.useReducer(
            stateFns.reducer,
            null,
            () => {
                let saved = stateFns.loadFromLocal(currentLeague?.league_id || currentLeague?.id, forcedMode);
                if (saved && saved.phase !== 'setup') {
                    saved = refreshRookieValuesFromEngine(saved, stateFns, playersData);
                    // Recompose personas — we strip them on save, so rehydrate from the live DNA map
                    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
                    let draftDnaMap = {};
                    try {
                        if (window.DraftHistory?.loadDraftDNA) {
                            draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
                        }
                    } catch (e) {}
                    saved.personas = window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap);
	                    // Old saves stripped originalPool; new saves preserve it.
	                    if (!saved.originalPool || !saved.originalPool.length) {
	                        saved.originalPool = saved.pool.slice();
	                    }
	                    const historicalTradeSignal = window.DraftCC.tradeSimulator?.historicalDraftPickTradeSignal?.({
	                        ...saved,
	                        leagueId,
	                        draftContext: saved.draftContext || { tradedPicks: window.S?.tradedPicks || [] },
	                        tradedPicks: window.S?.tradedPicks || [],
	                    });
	                    if (historicalTradeSignal && historicalTradeSignal.activity <= 0 && saved.activeOffer && saved.activeOffer.cpuInitiated !== false) {
	                        const resumeSpeed = saved.activeOffer?.resumeSpeed || 'normal';
	                        saved.activeOffer = null;
	                        if (saved.speed === 'paused') saved.speed = resumeSpeed;
	                    }
	                    // Re-apply the user's custom Big Board order on resume so changes
                    // to the board since the draft was saved are reflected immediately.
                    saved.pool = applyUserBigBoardOrder(saved.pool, leagueId, saved.variant);
                    return saved;
                }
                // Phase 5+: prefer the league's scheduled upcoming draft settings
                // so Solo defaults match whatever's actually scheduled in Sleeper.
                const upcoming = draftMeta.upcomingSettings;
                const initial = stateFns.initialDraftState({
                    leagueId: currentLeague?.league_id || currentLeague?.id || '',
                    season: currentLeague?.season,
                    rounds: upcoming?.rounds || propRounds || 5,
                    leagueSize: upcoming?.teams || draftMeta.numTeams,
                    // Multi-copy leagues (MFL rostersPerPlayer) — 1 elsewhere.
                    playerCopies: currentLeague?.settings?.player_copies || 1,
                    draftType: upcoming?.type || draftMeta.draftType || 'snake',
                    variant: upcoming?.variant || draftMeta.draftVariant || 'startup',
                    userRosterId: myRoster?.roster_id,
                    userSlot: draftMeta.mySlot,
                    // Honor forced mode (e.g., live-sync from the Follow Live Draft tab)
                    mode: forcedMode || 'solo',
                });
                // Only REAL drafts feed the model (owner ask 2026-07-12): the
                // latest live-sync recap seeds tuning; mock recaps never do.
                const learning = !forcedMode && stateFns.buildRecapLearningDefaults
                    ? stateFns.buildRecapLearningDefaults(initial.leagueId, {
                        modes: ['live-sync'],
                        limit: 1,
                        baseTuning: initial.draftTuning,
                    })
                    : null;
                const strategyProfile = stateFns.loadDraftStrategyProfile
                    ? stateFns.loadDraftStrategyProfile(initial.leagueId, {
                        variant: initial.variant,
                        baseTuning: learning?.suggestedTuning || initial.draftTuning,
                        recapLearning: learning,
                    })
                    : null;
                const draftTuning = strategyProfile?.tuning
                    ? stateFns.applyDraftStrategyProfileToTuning?.(strategyProfile, learning?.suggestedTuning || initial.draftTuning) || strategyProfile.tuning
                    : (learning?.suggestedTuning || initial.draftTuning);
                return {
                    ...initial,
                    draftTuning,
                    recapLearning: learning,
                    strategyProfile,
                };
            }
        );

        // Resume banner is only shown when we're still in setup phase but have a saved draft
        const [showResume, setShowResume] = React.useState(false);
        // Memorialized live drafts: closing the recap reveals the completed board; this
        // tracks whether the recap modal is dismissed (reopenable via "View Recap").
        // Re-entering a memorialized completed draft (hydrated at mount) lands on the
        // BOARD when its recap was already dismissed once on this device — the full-
        // screen recap only auto-shows the first time (memorial.recapSeen, persisted
        // in onExit below).
        const [recapDismissed, setRecapDismissed] = React.useState(() => {
            try {
                const PD = window.App?.PostDraft;
                const leagueId = currentLeague?.league_id || currentLeague?.id || '';
                const mem = PD?.getMemorial ? PD.getMemorial(leagueId) : null;
                return !!(mem && mem.recapSeen && state.sleeperDraftId
                    && String(mem.draftId || '') === String(state.sleeperDraftId));
            } catch (e) { return false; }
        });
        React.useEffect(() => { if (state.phase !== 'complete') setRecapDismissed(false); }, [state.phase]);

        // Phase 5+: sync setup defaults when draftMeta updates post-mount (e.g.
        // after the async Sleeper drafts fetch resolves). Only applies during
        // setup phase — we don't want to clobber an in-progress draft.
        const draftMetaSignature = draftMeta.mySlot + '|' + draftMeta.numTeams + '|' + (draftMeta.upcomingSettings?.rounds || '') + '|' + (draftMeta.upcomingSettings?.type || '') + '|' + (draftMeta.upcomingSettings?.variant || draftMeta.draftVariant || '');
        React.useEffect(() => {
            // Only sync when we're in setup — drafting/complete phases are locked in
            if (state.phase !== 'setup') return;
            const upcoming = draftMeta.upcomingSettings;
            const patch = {};
            if (draftMeta.mySlot && state.userSlot !== draftMeta.mySlot) patch.userSlot = draftMeta.mySlot;
            if (draftMeta.numTeams && state.leagueSize !== draftMeta.numTeams) patch.leagueSize = draftMeta.numTeams;
            if (upcoming?.rounds && state.rounds !== upcoming.rounds) patch.rounds = upcoming.rounds;
            if (upcoming?.type && state.draftType !== upcoming.type) patch.draftType = upcoming.type;
            if (upcoming?.variant && state.variant === 'startup' && state.variant !== upcoming.variant) patch.variant = upcoming.variant;
            if (Object.keys(patch).length) {
                dispatch({ type: 'SETUP_CHANGE', payload: patch });
            }
        }, [draftMetaSignature, state.phase]);

        const [viewport, setViewport] = React.useState(() => bpBucket());
        React.useEffect(() => {
            const onResize = () => setViewport(bpBucket());
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }, []);

        // Wait for CSV prospects to load (for rookie variant)
        const [csvReady, setCsvReady] = React.useState(window.DraftCC.scouting?.isLoaded || false);
        React.useEffect(() => {
            if (csvReady) return;
            let cancelled = false;
            window.DraftCC.scouting?.ready?.then(() => {
                if (!cancelled) setCsvReady(true);
            });
            return () => { cancelled = true; };
        }, [csvReady]);

        // Auto-save to localStorage (debounced 500ms)
        const saveTimerRef = React.useRef(null);
        React.useEffect(() => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => {
                stateFns.saveToLocal(state, forcedMode);
            }, 500);
            return () => clearTimeout(saveTimerRef.current);
        }, [state]);


        // Broadcast live-draft picks so a player taken in the live draft shows
        // struck-through on the Draft tab's User Board too (the live board already
        // strikes from state.draftedPids). We send the pick set on its own channel —
        // kept separate from the board-edit sync and from the User Board's manual
        // "Off" marks — so the prep board reflects the live draft without either side
        // clobbering the other. Only live-sync drafts feed this; mocks stay
        // hypothetical and never cross off the prep board.
        const draftedSyncRef = React.useRef(null);
        React.useEffect(() => {
            if (state.mode !== 'live-sync') return;
            const leagueId = state.leagueId || currentLeague?.league_id || currentLeague?.id;
            if (!leagueId) return;
            const drafted = Object.keys(state.draftedPids || {});
            const sig = drafted.slice().sort().join(',');
            if (sig === draftedSyncRef.current) return; // no pick change since last sync
            // Don't clear the User Board's seeded picks with the initial empty set
            // before live state hydrates — only emit empty once we've sent real picks
            // (i.e. a genuine undo back to zero).
            if (drafted.length === 0 && draftedSyncRef.current === null) return;
            draftedSyncRef.current = sig;
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                try {
                    window.dispatchEvent(new CustomEvent('wr:live-draft-picks', {
                        detail: { leagueId, variant: state.variant || 'startup', drafted },
                    }));
                } catch (e) { /* CustomEvent unsupported — non-fatal */ }
            }
        }, [state.draftedPids, state.mode, state.leagueId, state.variant, currentLeague]);

        // Current slot + whose turn is it
        // isUserTurn prefers rosterId match (post-trade ownership), but falls back
        // to teamIdx match for leagues where rosterId is null (e.g., unmapped slots).
        const currentSlot = state.pickOrder[state.currentIdx] || null;
        const liveStateRef = React.useRef(state);
        React.useEffect(() => {
            liveStateRef.current = state;
        }, [state]);
        const userIdx = (state.userSlot || 1) - 1;
        // In mock modes the user picks their slot via the dropdown, which doesn't
        // rewrite pickOrder rosterIds — the slot they picked still has some ghost
        // roster's ID. Match on slot number in those modes so the DRAFT button shows.
        const isMockMode = state.mode !== 'live-sync';
        const isUserTurn = state.phase === 'drafting' && !!currentSlot && (
            currentSlot.rosterId === state.userRosterId ||
            (isMockMode && currentSlot.slot === state.userSlot) ||
            (currentSlot.rosterId == null && currentSlot.teamIdx === userIdx)
        );
        const isDone = state.phase === 'complete';

        // CPU auto-pick loop
        const cpuTimerRef = React.useRef(null);
        React.useEffect(() => {
            if (state.phase !== 'drafting') return;
            if (state.mode === 'live-sync') return; // Live sync: picks come from Sleeper poll, not AI
            if (state.mode === 'manual') return; // Manual mode: user records every pick
            if (state.activeOffer) return;
            if (isUserTurn) return;
            if (isDone) return;
            if (state.speed === 'paused') return;
            if (state.overrideMode) return; // User is manually picking for the CPU team

            const delay = SpeedMap[state.speed] ?? 700;
            cpuTimerRef.current = setTimeout(() => {
                const slot = state.pickOrder[state.currentIdx];
                if (!slot || slot.rosterId === state.userRosterId) return;

                // Phase 5: Ghost replay mode — use historical pick instead of AI
                if (state.mode === 'ghost' && state.replay && state.replay.replayPicks) {
                    const replayPick = state.replay.replayPicks[state.currentIdx];
                    if (replayPick) {
                        dispatch({
                            type: 'MAKE_PICK',
                            player: {
                                pid: replayPick.pid,
                                name: replayPick.name,
                                pos: replayPick.pos,
                                dhq: replayPick.dhq,
                                photoUrl: replayPick.photoUrl,
                                college: replayPick.college,
                            },
                            isUser: false,
                            reasoning: replayPick.reasoning,
                            confidence: 1.0,
                        });
                        return;
                    }
                }

                const persona = state.personas?.[slot.rosterId] || null;
                const teamRoster = state.teamRosters?.[slot.teamIdx] || [];
                let pick = null;
                let reasoning = null;
                let confidence = null;
                try {
                    if (persona && window.DraftCC.cpuEngine) {
                        // GM Strategy weights are the USER's plan — never inject them into
                        // opponent persona picks (opponents would draft with the user's own
                        // bias). This loop only ever picks for CPU slots, so no gmMode /
                        // draftWeights ride in the pick context; user-side pick advice reads
                        // the strategy via the live decision engine and the AI board lane.
                        const draftCtx = state.draftContext || null;
                        const result = window.DraftCC.cpuEngine.personaPick(
                            persona,
                            state.pool,
                            slot.round,
                            slot.overall,
                            {
                                teamRoster,
                                draftTuning: state.draftTuning,
                                draftContext: draftCtx,
                                boardContext: draftCtx?.boardContext || null,
                                ownerIntel: persona?.ownerIntel || draftCtx?.ownerContext?.[String(slot.rosterId)] || null,
                            }
                        );
                        if (result) {
                            pick = result.player;
                            reasoning = result.reasoning;
                            confidence = result.confidence;
                        }
                    }
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.cpuPick', e);
                }

                // Fallback: best DHQ
                if (!pick && state.pool.length) {
                    pick = state.pool[0];
                    reasoning = { primary: 'BPA fallback', baseVal: pick.dhq, nudges: [] };
                }

                if (pick) {
                    dispatch({ type: 'MAKE_PICK', player: pick, isUser: false, reasoning, confidence });
                }
            }, delay);

            return () => clearTimeout(cpuTimerRef.current);
        }, [state.phase, state.currentIdx, state.speed, state.mode, state.overrideMode, isUserTurn, isDone]);

        // ── Phase 3: CPU trade offer generation ──────────────────────
        // After each completed pick, roll for a trade offer. Cooldown prevents spam.
        const lastOfferIdxRef = React.useRef(-Infinity);
        const lastPickCountRef = React.useRef(0);
        React.useEffect(() => {
            // CPU trade offers are persona-simulated negotiations (likelihood,
            // psych taxes) → Pro. Free mocks stay pure BPA pick-making.
            if (!ccIsPro()) return;
            if (state.phase !== 'drafting') return;
            if (state.mode === 'live-sync' || state.mode === 'manual') return;
            if (state.activeOffer) return;            // don't stack offers
            if (state.proposerDrawer) return;         // user is building their own
            if (state.picks.length === lastPickCountRef.current) return;
            lastPickCountRef.current = state.picks.length;

            const lastPick = state.picks[state.picks.length - 1];
            if (!lastPick || lastPick.isUser) return; // only after CPU picks

            // Small delay so the UI breathes between pick + offer
            const t = setTimeout(() => {
                try {
                    const offer = window.DraftCC.tradeSimulator?.maybeGenerateTradeOffer(
                        state,
                        lastPick.rosterId,
                        { lastOfferPickIdx: lastOfferIdxRef.current }
                    );
                    if (offer) {
                        lastOfferIdxRef.current = state.currentIdx;
                        dispatch({ type: 'OFFER_TRADE', offer });
                    }
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.tradeGen', e);
                }
            }, 300);

            return () => clearTimeout(t);
        }, [state.currentIdx, state.phase, state.mode, state.activeOffer, state.proposerDrawer]);

        // ── Phase 5: Live Sync polling loop ─────────────────────────
        // When mode==='live-sync' and phase==='drafting', start polling the
        // Sleeper draft every 5s. Each new pick is converted to our state.pick
        // shape and dispatched as MAKE_PICK so the rest of the pipeline (grid,
        // Alex stream, reach/steal detection) reacts normally.
        //
        // Strictly read-only — never writes picks back to Sleeper.
        React.useEffect(() => {
            if (state.mode !== 'live-sync') return;
            if (state.phase !== 'drafting') return;
            if (!state.sleeperDraftId) return;
            if (!window.DraftCC.liveSync) return;

            const normPos = window.App?.normPos || (p => p);
            const getDHQ = (pid) => window.App?.LI?.playerScores?.[pid] || 0;

            const initialPickNo = Math.max(
                Number(state.liveSync?.lastPickNo || 0),
                Number(state.currentIdx || 0)
            );
            const seenPickKeys = (state.picks || [])
                .map(p => p.sleeperPickNo ? ('no:' + p.sleeperPickNo) : null)
                .filter(Boolean);

            window.DraftCC.liveSync.start(state.sleeperDraftId, (sleeperPicks, snapshot) => {
                const active = liveStateRef.current || state;
                const activePlayersData = window.S?.players || {};
                const mapped = (sleeperPicks || []).map(sleeperPick => {
                    const pid = sleeperPick.player_id;
                    const p = activePlayersData[pid] || {};
                    const poolMatch = (active.pool || []).find(x => String(x.pid) === String(pid))
                        || (active.originalPool || []).find(x => String(x.pid) === String(pid));
                    const player = {
                        pid,
                        name: poolMatch?.name || p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Unknown',
                        pos: poolMatch?.pos || normPos(p.position) || p.position || '?',
                        dhq: poolMatch?.dhq || getDHQ(pid),
                        consensusRank: poolMatch?.consensusRank || null,
                        photoUrl: poolMatch?.photoUrl || ('https://sleepercdn.com/content/nfl/players/thumb/' + pid + '.jpg'),
                        college: poolMatch?.college || p.college || '',
                        tier: poolMatch?.tier || null,
                        csv: poolMatch?.csv || null,
                    };
                    return {
                        sleeperPick,
                        player,
                        reasoning: { primary: 'Live Sleeper pick', baseVal: player.dhq, nudges: [] },
                        confidence: 1.0,
                    };
                });
                const staleReason = window.DraftCC.liveSync?._private?.liveSyncStaleReason
                    ? window.DraftCC.liveSync._private.liveSyncStaleReason(snapshot)
                    : null;
                dispatch({
                    type: 'APPLY_LIVE_SYNC_PICKS',
                    picks: mapped,
                    status: {
                        status: staleReason
                            ? 'stale'
                            : snapshot?.draftStatus === 'complete'
                                ? 'complete'
                                : 'mirroring',
                        draftStatus: snapshot?.draftStatus || '',
                        remotePickCount: snapshot?.remotePickCount || 0,
                        lastPickNo: snapshot?.lastPickNo || initialPickNo,
                        remoteMaxPickNo: snapshot?.remoteMaxPickNo || 0,
                        duplicateCount: snapshot?.duplicateCount || 0,
                        missedPickCount: snapshot?.gapCount || 0,
                        missingPickNos: snapshot?.missingPickNos || [],
                        conflictCount: snapshot?.conflictCount || 0,
                        conflictPickNos: snapshot?.conflictPickNos || [],
                        invalidPickCount: snapshot?.invalidPickCount || 0,
                        remoteBehind: !!snapshot?.remoteBehind,
                        lastPollAt: Date.now(),
                        stale: !!staleReason,
                        error: staleReason,
                    },
                });
            }, {
                initialPickNo,
                seenPickKeys,
                onStatus: status => {
                    // Capture mid-draft pick trades. Only push to state when the set
                    // actually changes, so we don't re-render every 5s poll.
                    if (Array.isArray(status?.tradedPicks)) {
                        const sig = status.tradedPicks
                            .map(t => [t.season, t.round, t.roster_id, t.owner_id].join(':'))
                            .sort()
                            .join('|');
                        if (sig !== liveTradedSigRef.current) {
                            liveTradedSigRef.current = sig;
                            setLiveDraftTradedPicks(status.tradedPicks);
                        }
                    }
                    // MFL: capture the board's current per-slot ownership. Gate on the
                    // ownership signature (round.slot→roster) so traded picks refresh the
                    // board without re-rendering on every poll / made pick.
                    if (Array.isArray(status?.mflSlots)) {
                        const sig = status.mflSlots
                            .map(s => s.round + '.' + s.draft_slot + ':' + s.roster_id)
                            .join('|');
                        if (sig !== liveMflSlotsSigRef.current) {
                            liveMflSlotsSigRef.current = sig;
                            setLiveMflSlots(status.mflSlots);
                        }
                    }
                    dispatch({ type: 'LIVE_SYNC_STATUS', payload: status });
                },
            });

            return () => {
                if (window.DraftCC.liveSync?.isRunning?.()) {
                    window.DraftCC.liveSync.stop();
                }
            };
        }, [state.mode, state.phase, state.sleeperDraftId, state.userRosterId]);

        // ── Live-Sync ownership refresh ────────────────────────────────
        // When the live poll surfaces new pick trades, draftMeta.pickOwnership
        // recomputes (it depends on liveDraftTradedPicks). Push the fresh ownership
        // into the reducer so the upcoming picks re-attribute to whoever owns them
        // now. Already-made picks are left alone; the reducer no-ops when unchanged.
        React.useEffect(() => {
            if (state.mode !== 'live-sync' || state.phase !== 'drafting') return;
            if (!draftMeta?.pickOwnership || !state.pickOrder?.length) return;
            dispatch({ type: 'UPDATE_LIVE_OWNERSHIP', pickOwnership: draftMeta.pickOwnership });
        }, [draftMeta, state.mode, state.phase, state.currentIdx]);

        // Bridge live traded picks into the reducer so the recap's Trade Impact +
        // Trade Volume can see them (Sleeper traded_picks: roster_id=original owner,
        // owner_id=current, previous_owner_id=prior). Reducer no-ops when unchanged.
        React.useEffect(() => {
            if (state.mode !== 'live-sync') return;
            const tp = Array.isArray(liveDraftTradedPicks) ? liveDraftTradedPicks : [];
            const normalized = tp.map(t => ({
                round: Number(t.round) || null,
                rosterId: t.owner_id ?? t.roster_id ?? null,
                fromRosterId: t.previous_owner_id ?? null,
            }));
            dispatch({ type: 'SET_TRADED_PICKS', tradedPicks: normalized });
        }, [liveDraftTradedPicks, state.mode]);

        // ── Live-Sync variant auto-correction ──────────────────────────
        // When resuming a live-sync draft, the saved state's `variant` can be
        // stale if the user started it before we auto-detected Sleeper draft
        // variants. Fetch the Sleeper draft meta once and rebuild only before
        // any picks have been dispatched.
        //
        // Only rebuilds when picks.length === 0 — we refuse to clobber a pool
        // that already has picks dispatched against it.
        const variantFixedRef = React.useRef(false);
        React.useEffect(() => {
            if (state.mode !== 'live-sync') return;
            if (!state.sleeperDraftId) return;
            if (state.phase === 'setup') return;
            if (variantFixedRef.current) return;
            variantFixedRef.current = true;

            (async () => {
                try {
                    // MFL draft ids ('mfl_draft_...') 404 on Sleeper — read the variant
                    // signal (settings.player_type) from the already-hydrated MFL draft
                    // object instead of a doomed cross-origin fetch.
                    const isMfl = String(state.sleeperDraftId || '').startsWith('mfl_draft_');
                    let meta;
                    if (isMfl) {
                        const list = window.S?.drafts || currentLeague?.drafts || [];
                        meta = list.find(d => d.draft_id === state.sleeperDraftId) || list[0] || null;
                        if (!meta) return;
                    } else {
                        const resp = await fetch('https://api.sleeper.app/v1/draft/' + state.sleeperDraftId);
                        if (!resp.ok) return;
                        meta = await resp.json();
                    }
                    const detectedVariant = stateFns.detectDraftVariant
                        ? stateFns.detectDraftVariant({ currentLeague, draft: meta, fallback: state.variant || 'startup' })
                        : detectSleeperDraftVariant(meta, currentLeague, state.variant || 'startup');
                    if (!detectedVariant || state.variant === detectedVariant) return;
                    if (state.picks && state.picks.length > 0) {
                        if (window.wrLog) window.wrLog('cc.variantMismatch', { sleeperDraftId: state.sleeperDraftId, saved: state.variant, detected: detectedVariant, picks: state.picks.length });
                        return;
                    }
                    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
                    const totalPicks = Number(state.rounds || meta?.settings?.rounds || 0) * Number(state.leagueSize || meta?.settings?.teams || 0);
                    const maxPoolSize = detectedVariant === 'redraft'
                        ? Math.max(300, totalPicks + 80)
                        : 200;
                    let newPool = stateFns.buildPool({ variant: detectedVariant, playersData, maxSize: maxPoolSize });
                    newPool = applyUserBigBoardOrder(newPool, leagueId, detectedVariant);
                    dispatch({ type: 'SETUP_CHANGE', payload: { variant: detectedVariant, pool: newPool, originalPool: newPool.slice() } });
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.variantAutoCorrect', e);
                }
            })();
        }, [state.mode, state.sleeperDraftId, state.phase]);

        // ── Phase 4: Alex AI trigger effects ────────────────────────
        // Fires rule-based events (always free) and Sonnet AI events (budget-limited)
        // after each completed pick. Triggers: R1 pick, user pick, reach/steal, round change.
        const lastAlexPickCountRef = React.useRef(0);
        const lastAlexRoundRef = React.useRef(0);
        const alexSonnetCooldownRef = React.useRef(0);
        // Guards against two overlapping pick-analysis calls: in a fast mock draft a
        // second qualifying pick can land before the first call resolves. We allow at
        // most one in-flight AI call at a time so each pick fires exactly one prompt.
        const alexAiInFlightRef = React.useRef(false);
        // Dedupe trackers for the rule-based "live insight" stream events so each
        // run/tier-break/value-cliff/need-tension fires once per occurrence.
        const lastRunRef = React.useRef({ pos: '', count: 0 });
        const lastTierBreakRef = React.useRef('');
        const lastValueCliffRef = React.useRef('');
        const lastNeedTensionRef = React.useRef('');
        // Mid-draft trade-evolution narration: dedupe on completedTrades.length so
        // each new trade fires one per-trade line + (on a round boundary) a room
        // evolution callout. The count ref guards StrictMode double-invoke.
        const lastTradeEvoRef = React.useRef(0);
        const lastTradeEvoRoundRef = React.useRef(0);
        React.useEffect(() => {
            // The whole Alex layer (rule events with seeded advice + the auto
            // Sonnet pick-analysis at the bottom) is Scout Pro. The trigger gate
            // here — not just the OD.callAI tripwire — is what stops a BYOK free
            // user's dhqAI from auto-firing per pick (mirrors reconai
            // _mockFireAlexInsight: free runs the draft old-school).
            if (!ccIsPro()) return;
            if (state.phase !== 'drafting') return;
            if (state.picks.length === lastAlexPickCountRef.current) return;
            const prevCount = lastAlexPickCountRef.current;
            lastAlexPickCountRef.current = state.picks.length;

            const lastPick = state.picks[state.picks.length - 1];
            if (!lastPick) return;
            const projectedAlexRead = lastPick.alexCommentary?.streamText || lastPick.reasoning?.alexCommentary?.streamText || '';

            // Round change banner (rule-triggered, free)
            if (lastPick.round !== lastAlexRoundRef.current && lastAlexRoundRef.current > 0) {
                const picksRemaining = state.pickOrder.length - state.currentIdx;
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'rule',
                        badge: 'R',
                        color: 'var(--gold)',
                        title: 'Round ' + lastPick.round + ' begins',
                        text: picksRemaining + (picksRemaining === 1 ? ' pick remains.' : ' picks remain.'),
                        relatedPickNo: lastPick.overall,
                    },
                });
            }
            lastAlexRoundRef.current = lastPick.round;

            // Pick line (rule-triggered, free) — every pick gets a line
            dispatch({
                type: 'ALEX_EVENT_ADD',
                event: {
                    type: projectedAlexRead ? 'ai' : (lastPick.isUser ? 'user' : 'rule'),
                    badge: projectedAlexRead ? 'A' : (lastPick.isUser ? '★' : '•'),
                    color: projectedAlexRead ? 'var(--gold)' : (lastPick.isUser ? 'var(--gold)' : 'var(--silver)'),
                    title: projectedAlexRead
                        ? 'Alex read · R' + lastPick.round + '.' + String(pickInRoundOf(lastPick, state.leagueSize)).padStart(2, '0') + ' · ' + lastPick.name
                        : 'R' + lastPick.round + '.' + String(pickInRoundOf(lastPick, state.leagueSize)).padStart(2, '0') + ' · ' + lastPick.name,
                    text: projectedAlexRead || ((lastPick.isUser ? 'You selected ' : '') + lastPick.pos + (lastPick.dhq > 0 ? ' · ' + lastPick.dhq.toLocaleString() + ' DHQ' : '')),
                    relatedPickNo: lastPick.overall,
                },
            });

            // Reach/steal detection (rule-triggered, free)
            if (lastPick.consensusRank && Math.abs(lastPick.overall - lastPick.consensusRank) > 8) {
                const isSteal = lastPick.overall > lastPick.consensusRank;
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'rule',
                        badge: isSteal ? '↓' : '↑',
                        color: isSteal ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-e74c3c, #e74c3c)',
                        title: (isSteal ? 'STEAL' : 'REACH') + ' · ' + lastPick.name,
                        text: lastPick.pos + ' taken at pick #' + lastPick.overall + ' vs. consensus #' + Math.round(lastPick.consensusRank),
                        relatedPickNo: lastPick.overall,
                    },
                });
            }

            // ── Live insight events (rule-triggered, free, throttled) ─────
            // Alex narrates room dynamics: positional runs, tier breaks, value
            // cliffs, and need-vs-BPA tension. Each is deduped so it fires once
            // per occurrence rather than spamming every pick.

            // (a) ROOM RUN — the headline. ≥3 of the last ~6 picks at one pos.
            try {
                const run = window.DraftCC.liveAnalytics?.detectRuns?.(state.picks, 6, 3);
                if (run && (run.pos !== lastRunRef.current.pos || run.count > lastRunRef.current.count)) {
                    lastRunRef.current = { pos: run.pos, count: run.count };
                    const ordinal = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'][run.count] || (run.count + 'th');
                    const userNeedsRun = (() => {
                        const up = state.personas?.[state.userRosterId];
                        const needs = up?.assessment?.needs || [];
                        return needs.some(n => (typeof n === 'string' ? n : n?.pos) === run.pos);
                    })();
                    // Only claim a hard cliff when the tier-break signal confirms the
                    // position's top tier is actually down to its last man; otherwise
                    // keep the read non-quantified.
                    const runSignals = window.DraftCC.liveDecisionEngine?.liveStreamSignals?.(state) || {};
                    const runCliff = runSignals.tierBreak && runSignals.tierBreak.pos === run.pos;
                    const implication = userNeedsRun
                        ? (runCliff
                            ? `You need ${run.pos} — the tier is down to its last man. If you want one, this is the window.`
                            : `You need ${run.pos} — the pocket is thinning fast. If you want one, this is the window.`)
                        : (runCliff
                            ? `The tier is down to its last man — move now if you want one. Otherwise let the room thin it out and pivot.`
                            : `If you want one, don't wait long. Otherwise let the room thin it out and pivot.`);
                    dispatch({
                        type: 'ALEX_EVENT_ADD',
                        event: {
                            type: 'rule',
                            badge: '🔥',
                            color: 'var(--gold)',
                            title: 'ROOM RUN · ' + run.pos,
                            text: `That's the ${ordinal} ${run.pos} in the last ${run.window} picks — the run is live. ${implication}`,
                            relatedPickNo: lastPick.overall,
                        },
                    });
                }
            } catch (e) { if (window.wrLog) window.wrLog('alex.run', e); }

            // (b) TIER BREAK + (c) VALUE CLIFF + (d) NEED-vs-BPA tension.
            try {
                const signals = window.DraftCC.liveDecisionEngine?.liveStreamSignals?.(state) || {};

                const tb = signals.tierBreak;
                if (tb && tb.lastPlayer) {
                    const tbKey = tb.pos + ':' + (tb.tier || '?') + ':' + tb.lastPlayer;
                    if (lastTierBreakRef.current !== tbKey) {
                        lastTierBreakRef.current = tbKey;
                        // "A real step down" only when the tier gap actually is one
                        // (2+ tiers); otherwise describe the break without grading it.
                        const bigTierDrop = Number(tb.nextTier) > 0 && Number(tb.tier) > 0 && (Number(tb.nextTier) - Number(tb.tier) >= 2);
                        const stepDown = tb.nextPlayer
                            ? `Next up is ${tb.nextPlayer}${tb.nextTier ? ' (tier ' + tb.nextTier + ')' : ''}${bigTierDrop ? ' — a real step down.' : '.'}`
                            : `The board steps down from here.`;
                        dispatch({
                            type: 'ALEX_EVENT_ADD',
                            event: {
                                type: 'rule',
                                badge: '⛰',
                                color: 'var(--k-f0a500, #f0a500)',
                                title: 'TIER BREAK · ' + tb.pos,
                                text: `${tb.lastPlayer} is the last ${tb.pos} in this tier${tb.tier ? ' (tier ' + tb.tier + ')' : ''}. ${stepDown}`,
                                relatedPickNo: lastPick.overall,
                            },
                        });
                    }
                }

                const vc = signals.valueCliff;
                if (vc) {
                    const vcKey = vc.afterPlayer + ':' + vc.dropAbs;
                    if (lastValueCliffRef.current !== vcKey) {
                        lastValueCliffRef.current = vcKey;
                        dispatch({
                            type: 'ALEX_EVENT_ADD',
                            event: {
                                type: 'rule',
                                badge: '⬇',
                                color: 'var(--k-e67e22, #e67e22)',
                                title: 'VALUE CLIFF · after ' + vc.afterPlayer,
                                text: `Big value drop after ${vc.afterPlayer} (${vc.afterPos}) — ${Math.round(vc.dropPct * 100)}% gap to ${vc.nextPlayer}. Grab now — comparable value isn't close behind.`,
                                relatedPickNo: lastPick.overall,
                            },
                        });
                    }
                }

                const nt = signals.needTension;
                if (nt && nt.onNeedName) {
                    const ntKey = nt.needPos + ':' + nt.bpaName;
                    if (lastNeedTensionRef.current !== ntKey) {
                        lastNeedTensionRef.current = ntKey;
                        const gapTxt = nt.gap && nt.gap > 0 ? ` (${nt.gap.toLocaleString()} DHQ richer)` : '';
                        dispatch({
                            type: 'ALEX_EVENT_ADD',
                            event: {
                                type: 'rule',
                                badge: nt.urgent ? '⚖' : '◇',
                                color: 'var(--silver)',
                                title: 'NEED vs BPA · ' + nt.needPos,
                                text: `Best on the board is ${nt.bpaName} (${nt.bpaPos})${gapTxt}, but your ${nt.needPos} room is thin — ${nt.onNeedName} is the on-need play. ${nt.urgent ? 'Need is urgent; weigh the fit over the value.' : 'Lean BPA unless the fit gap closes.'}`,
                                relatedPickNo: lastPick.overall,
                            },
                        });
                    }
                }
            } catch (e) { if (window.wrLog) window.wrLog('alex.signals', e); }

            // Sonnet AI event (budget-limited)
            // Triggers: R1 pick, user pick, reach beyond threshold
            // Throttle: at most once per 3 picks
            const sonnetUsed = state.alex?.alexSpend?.sonnet || 0;
            const budget = state.alex?.alexSpend?.budget || 12;
            const shouldFireAI =
                sonnetUsed < budget &&
                (state.currentIdx - alexSonnetCooldownRef.current >= 3 || lastPick.isUser) &&
                (
                    lastPick.round === 1 ||              // R1 pick
                    lastPick.isUser ||                   // user's own pick
                    (lastPick.consensusRank && Math.abs(lastPick.overall - lastPick.consensusRank) > 10)  // big reach/steal
                );

            if (shouldFireAI && !alexAiInFlightRef.current && typeof window.dhqAI === 'function') {
                alexSonnetCooldownRef.current = state.currentIdx;
                alexAiInFlightRef.current = true;
                const persona = state.personas?.[lastPick.rosterId];
                const reasoning = lastPick.reasoning || {};
                const nudgesText = (reasoning.nudges || []).slice(0, 3).map(n => n.name + ' ' + (n.pct >= 0 ? '+' : '') + n.pct + '%').join(', ');
                const userPersona = state.personas?.[state.userRosterId];
                const ownerIntelText = window.DraftCC?.context?.summarizeOwnerIntel
                    ? window.DraftCC.context.summarizeOwnerIntel(persona?.ownerIntel || state.draftContext?.ownerContext?.[String(lastPick.rosterId)])
                    : '';
                const contextLines = [
                    (window.WR?.AIContext?.buildFormatPreamble?.(window.S?.currentLeague) || '').trim(),
                    `Draft pick: ${lastPick.name} (${lastPick.pos}) at R${lastPick.round}.${String(pickInRoundOf(lastPick, state.leagueSize)).padStart(2, '0')}, overall #${lastPick.overall}.`,
                    `By: ${persona?.teamName || 'Team ' + lastPick.teamIdx}, DNA: ${persona?.draftDna?.label || '—'}, Trade DNA: ${persona?.tradeDna?.label || '—'}, Posture: ${persona?.posture?.label || '—'}.`,
                    ownerIntelText ? `Owner intel: ${ownerIntelText}.` : '',
                    nudgesText ? `Picker reasoning: ${nudgesText}.` : '',
                    lastPick.isUser ? `THIS IS THE USER'S OWN PICK. Grade it for them honestly.` : '',
                    userPersona ? `User's team needs: ${(userPersona.assessment?.needs || []).slice(0, 3).map(n => typeof n === 'string' ? n : n?.pos).join(', ')}.` : '',
                ].filter(Boolean).join(' ');

                dispatch({ type: 'ALEX_SET_THINKING', thinking: true });

                const prompt = lastPick.isUser
                    ? `React to the user's draft pick in 1-2 sentences. Be Alex the draft analyst — direct, punchy, in character. Say if it's a good fit, a reach, or a steal. Context: ${contextLines}`
                    : `React to this draft pick in 1-2 sentences as Alex the draft analyst. Tell the user what this pick reveals about the opposing team's strategy. Context: ${contextLines}`;

                const messages = [{ role: 'user', content: prompt }];
                window.dhqAI('pick-analysis', prompt, contextLines, { messages })
                    .then(response => {
                        const replyText = typeof response === 'string' ? response : (response?.content || response?.text || '');
                        if (!replyText) return;
                        // Debit the budget only once we actually have a reply, so a failed
                        // or empty call doesn't silently drain the per-draft Sonnet budget.
                        dispatch({ type: 'ALEX_SPEND_SONNET' });
                        dispatch({
                            type: 'ALEX_EVENT_ADD',
                            event: {
                                type: 'ai',
                                badge: '✦',
                                color: 'var(--gold)',
                                title: lastPick.isUser ? 'Alex grades your pick' : 'Alex · ' + (persona?.teamName || 'CPU') + ' take',
                                text: replyText.slice(0, 350),
                                relatedPickNo: lastPick.overall,
                            },
                        });
                    })
                    .catch(e => {
                        if (window.wrLog) window.wrLog('alex.pickAnalysis', e);
                    })
                    .finally(() => {
                        alexAiInFlightRef.current = false;
                        dispatch({ type: 'ALEX_SET_THINKING', thinking: false });
                    });
            }
        }, [state.picks.length, state.phase]);

        // ── Mid-draft trade-evolution callouts (rule-based, NO Sonnet spend) ─
        // Fires only when completedTrades grows. Live-sync keeps that array empty
        // (read-only), so this is inert in live drafts and never narrates there.
        React.useEffect(() => {
            if (!ccIsPro()) return; // trade-evolution narration feeds the Pro Alex stream
            if (state.phase !== 'drafting') return;
            const trades = state.completedTrades || [];
            const tradeCount = trades.length;
            if (tradeCount <= lastTradeEvoRef.current) {
                if (tradeCount < lastTradeEvoRef.current) { // draft reset → re-arm
                    lastTradeEvoRef.current = tradeCount;
                    lastTradeEvoRoundRef.current = 0;
                }
                return;
            }
            const newlyClosed = trades.slice(lastTradeEvoRef.current);
            lastTradeEvoRef.current = tradeCount;

            const leagueSize = Math.max(1, Number(state.leagueSize) || 12);
            const teamName = (rid) => {
                const key = String(rid == null ? '' : rid);
                return (key && state.personas?.[key]?.teamName) || 'a rival room';
            };
            const assetCount = (offer) => (
                (offer?.myGive || []).length + (offer?.myGivePlayers || []).length + (offer?.myGiveFaab ? 1 : 0)
                + (offer?.theirGive || []).length + (offer?.theirGivePlayers || []).length + (offer?.theirGiveFaab ? 1 : 0)
            );

            // (a) One concise line per newly-closed trade.
            newlyClosed.forEach((t) => {
                const partner = t.fromRosterId ?? t.toRosterId ?? t.targetRosterId ?? null;
                const idx = Number.isFinite(Number(t.acceptedAt)) ? Number(t.acceptedAt) : null;
                const round = idx == null ? null : Math.floor(idx / leagueSize) + 1;
                const pieces = assetCount(t);
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'rule',
                        badge: '🔄',
                        color: 'var(--k-3aa0ff, #3aa0ff)',
                        title: 'TRADE' + (round ? ' · R' + round : '') + ' · ' + teamName(partner),
                        text: (t.userInitiated ? 'You closed a deal with ' : 'The room moved — ')
                            + teamName(partner)
                            + (pieces ? ' (' + pieces + ' asset' + (pieces === 1 ? '' : 's') + ' on the move).' : '.'),
                        relatedPickNo: idx == null ? null : idx + 1,
                    },
                });
            });

            // (b) Round-boundary evolution callout — fires once per round when the
            // engine reclassifies the room.
            try {
                const evo = window.DraftCC.liveDecisionEngine?.liveTradeEvolutionSignal?.(state);
                if (evo && evo.currentRound > lastTradeEvoRoundRef.current) {
                    lastTradeEvoRoundRef.current = evo.currentRound;
                    const verdict =
                        evo.draftClass === 'heavy'
                            ? `This is a trade-heavy room — ${evo.totalTrades} deal${evo.totalTrades === 1 ? '' : 's'} through ${evo.tradedRounds} round${evo.tradedRounds === 1 ? '' : 's'}, well above a normal pace. Capital is fluid; stay ready to pounce or pivot.`
                            : evo.draftClass === 'quiet'
                                ? `Unusually quiet room — only ${evo.totalTrades} deal${evo.totalTrades === 1 ? '' : 's'} so far. Owners are holding tight; don't expect picks to move. Draft your board.`
                                : `Trade activity is tracking typical (${evo.totalTrades} through ${evo.tradedRounds}). Let value come to you.`;
                    dispatch({
                        type: 'ALEX_EVENT_ADD',
                        event: {
                            type: 'rule',
                            badge: '🔄',
                            color: 'var(--k-3aa0ff, #3aa0ff)',
                            title: 'ROOM EVOLUTION · R' + evo.currentRound,
                            text: verdict,
                            relatedPickNo: null,
                        },
                    });
                }
            } catch (e) { if (window.wrLog) window.wrLog('alex.tradeEvo', e); }
        }, [state.completedTrades, state.phase]);

        // ── P2E: Live trade-window readout ─────────────────────────────
        // Live drafts stay read-only, but Alex should still flag actionable
        // windows based on owner intel, remaining picks, and buyer-line odds.
        const liveTradeAlertRef = React.useRef('');
        React.useEffect(() => {
            if (state.mode !== 'live-sync') return;
            if (state.phase !== 'drafting') return;
            const windows = window.DraftCC.tradeSimulator?.buildLiveTradeWindows?.(state, { lookahead: 5 }) || [];
            const best = windows[0];
            if (!best) return;
            if (best.viable === false) return; // don't narrate a non-starter trade window
            const alertFloor = Math.max((best.acceptanceLine || 70) - 8, best.suggestion?.evaluation?.counterLine || 0);
            if ((best.likelihood || 0) < alertFloor) return;
            const key = [state.currentIdx, best.rosterId, best.suggestion?.id].join(':');
            if (liveTradeAlertRef.current === key) return;
            liveTradeAlertRef.current = key;

            const clears = best.likelihood >= best.acceptanceLine;
            dispatch({
                type: 'ALEX_EVENT_ADD',
                event: {
                    type: 'rule',
                    badge: 'T',
                    color: clears ? 'var(--k-2ecc71, #2ecc71)' : 'var(--gold)',
                    title: 'Live trade window · ' + best.teamName,
                    text: describeLiveTradeWindow(best, state.leagueSize) + ' ' + (clears ? 'This clears their line.' : 'This is close enough to stage before the room moves.'),
                    relatedPickNo: best.overall || null,
                },
            });
        }, [state.mode, state.phase, state.currentIdx, state.pickOrder, state.personas, state.tradedAssets, state.draftTuning, state.picks.length]);

        // ── Actions ──────────────────────────────────────────────────
        const onStartDraft = React.useCallback(async (override = null) => {
            const overridePatch = override && typeof override === 'object' && !override.nativeEvent && !override.preventDefault
                ? override
                : null;
            const activeState = overridePatch ? { ...state, ...overridePatch } : state;
            const leagueId = currentLeague?.league_id || currentLeague?.id || '';
            // Real-draft learning only, and only while the studio toggle is ON.
            const recapLearning = !activeState.realLearningOff && stateFns.buildRecapLearningDefaults
                ? stateFns.buildRecapLearningDefaults(leagueId, {
                    modes: ['live-sync'],
                    limit: 1,
                    baseTuning: activeState.draftTuning,
                })
                : null;
            const activeStrategyProfile = activeState.strategyProfile || (stateFns.loadDraftStrategyProfile
                ? stateFns.loadDraftStrategyProfile(leagueId, {
                    variant: activeState.variant,
                    baseTuning: recapLearning?.suggestedTuning || activeState.draftTuning,
                    recapLearning,
                })
                : null);
            const learnedTuning = activeStrategyProfile?.tuning
                ? (stateFns.applyDraftStrategyProfileToTuning?.(activeStrategyProfile, activeState.draftTuning) || activeStrategyProfile.tuning)
                : (recapLearning?.sampleSize ? (recapLearning.suggestedTuning || activeState.draftTuning) : activeState.draftTuning);

            const totalPicks = Number(activeState.rounds || 0) * Number(activeState.leagueSize || 0);
            const maxPoolSize = activeState.variant === 'redraft'
                ? Math.max(300, totalPicks + 80)
                : 200;
            let pool = stateFns.buildPool({
                variant: activeState.variant,
                playersData,
                maxSize: maxPoolSize,
            });
            pool = applyUserBigBoardOrder(pool, leagueId, activeState.variant);
            const originalPool = pool.slice();
            let pickOrder = stateFns.buildPickOrder(
                activeState.rounds,
                activeState.leagueSize,
                activeState.draftType,
                draftMeta.slotToRoster,
                draftMeta.pickOwnership
            );
            if (activeState.mode !== 'live-sync' && activeState.userRosterId != null) {
                const selectedSlotInfo = draftMeta.slotToRoster?.[activeState.userSlot] || {};
                pickOrder = pickOrder.map(p => {
                    if (p.slot === activeState.userSlot) {
                        return { ...p, rosterId: activeState.userRosterId, ownerName: 'YOU', traded: p.traded };
                    }
                    if (draftMeta.mySlot && p.slot === draftMeta.mySlot && draftMeta.mySlot !== activeState.userSlot) {
                        return {
                            ...p,
                            rosterId: selectedSlotInfo.rosterId || p.rosterId,
                            ownerName: selectedSlotInfo.ownerName || p.ownerName,
                        };
                    }
                    return p;
                });
            }

            // Compose personas
            let draftDnaMap = {};
            try {
                if (window.DraftHistory?.loadDraftDNA) {
                    draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
                }
            } catch (e) {}
            const personas = window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap);

            // P2: analyst projected mock scenario handoff. Stages projected
            // picks before the user's first turn so they can rehearse the room.
            let prePicks = [];
            let narrative = null;
            if (activeState.mode === 'scenario' && activeState.analystScenario?.picks?.length && window.DraftCC.analystMock?.applyProjectedScenario) {
                const result = window.DraftCC.analystMock.applyProjectedScenario(activeState, pool, pickOrder, activeState.analystScenario);
                if (result) {
                    pool = result.pool;
                    pickOrder = result.pickOrder;
                    prePicks = result.prePicks || [];
                    narrative = result.narrative;
                }
            } else if (activeState.mode === 'scenario' && activeState.scenarioId) {
                const result = window.DraftCC.scenarios?.applyScenario(activeState, pool, pickOrder, activeState.scenarioId);
                if (result) {
                    pool = result.pool;
                    pickOrder = result.pickOrder;
                    prePicks = result.prePicks || [];
                    narrative = result.narrative;
                }
            }

            // Phase 5: ghost replay — fetch picks and stage them
            let replay = null;
            if (activeState.mode === 'ghost') {
                if (!activeState.sleeperDraftId) {
                    alert('Ghost Replay mode requires selecting a draft from the Replay Source list.');
                    return;
                }
                try {
                    const sleeperPicks = await window.DraftCC.ghostReplay.loadReplayPicks(activeState.sleeperDraftId);
                    if (sleeperPicks.length) {
                        replay = window.DraftCC.ghostReplay.buildReplayState(activeState, sleeperPicks);
                        narrative = '👻 GHOST REPLAY · ' + sleeperPicks.length + ' picks loaded. Use the scrubber to time-travel.';
                    } else {
                        alert('The selected draft has no picks yet — nothing to replay. Pick a completed draft, or try Live Sync mode for a draft in progress.');
                        return;
                    }
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.ghostLoad', e);
                    alert('Failed to fetch draft picks from Sleeper: ' + (e?.message || 'unknown error'));
                    return;
                }
            }

            // Phase 5: live sync — validate that a draft was picked
            let liveDraftStatus = '';
            if (activeState.mode === 'live-sync') {
                if (!activeState.sleeperDraftId) {
                    alert('Live Sync mode requires selecting an upcoming or in-progress draft from the Live Sync Source list.');
                    return;
                }
                liveDraftStatus = activeState.liveDraftMeta?.status || '';
                narrative = liveDraftStatus === 'pre_draft'
                    ? '📡 LIVE SYNC · Waiting room open. War Room will mirror Sleeper as soon as picks begin.'
                    : liveDraftStatus === 'complete'
                        ? '📡 LIVE SYNC · Rebuilding your completed draft board from Sleeper — picks, grade, and recap.'
                        : '📡 LIVE SYNC · Mirroring draft from Sleeper every 5s. Read-only — no picks are sent back.';
            }

            const draftContext = window.DraftCC?.context?.buildDraftContext
                ? window.DraftCC.context.buildDraftContext({
                    state: {
                        ...activeState,
                        phase: 'drafting',
                        pool,
                        pickOrder,
                        personas,
                        picks: prePicks,
                        currentIdx: prePicks.length,
                        draftTuning: learnedTuning,
                        recapLearning,
                        strategyProfile: activeStrategyProfile,
                    },
                    currentLeague,
                    myRoster,
                    playersData,
                    pool,
                    pickOrder,
                    personas,
                    draftMeta,
                })
                : null;

            dispatch({
                type: 'START_DRAFT',
                pool,
                pickOrder,
                personas,
                draftContext,
                originalPool,
                draftTuning: learnedTuning,
                recapLearning,
                strategyProfile: activeStrategyProfile,
                prePicks,
                narrative,
                replay,
                liveDraftStatus,
                setupPatch: overridePatch || null,
            });

            // Phase 2: async DraftHistory sync (mirrors Scout draft-ui.js:1977)
            if (window.DraftHistory?.syncDraftDNA && leagueId) {
                window.DraftHistory.syncDraftDNA(leagueId).then(map => {
                    if (!map) return;
                    const normalize = window.DraftCC.persona.normalizeDraftDna;
                    const payload = {};
                    Object.entries(map).forEach(([rid, raw]) => {
                        payload[rid] = normalize(raw);
                    });
                    dispatch({ type: 'MERGE_DRAFT_DNA', payload });
                }).catch(() => { /* ok, fallback persists */ });
            }
        }, [
            state.variant,
            state.rounds,
            state.leagueSize,
            state.draftType,
            state.userRosterId,
            state.userSlot,
            state.mode,
            state.scenarioId,
            state.sleeperDraftId,
            state.draftTuning,
            state.strategyProfile,
            state.analystScenario,
            draftMeta,
            playersData,
            currentLeague,
        ]);

        const liveAutoStartedRef = React.useRef('');
        React.useEffect(() => {
            if (forcedMode !== 'live-sync') return;
            if (!autoStartLiveToken) return;
            if (state.phase !== 'setup') return;
            if (!Array.isArray(fetchedDrafts)) return;
            let cancelled = false;
            const launch = async () => {
                let liveDraft = pickLaunchableLiveDraft(fetchedDrafts);
                // MFL drafts only exist on window.S.drafts (hydrated by league-detail);
                // the Sleeper chain endpoint 404s on 'mfl_' league ids — skip the dead
                // round-trip and let the Draft tab's status poll retry once they land.
                const chainIsMfl = !!(currentLeague?._mfl || String(currentLeague?.id || '').startsWith('mfl_'));
                if (!liveDraft && !chainIsMfl && leagueIdForFetch && window.DraftCC?.ghostReplay?.listLeagueChainDrafts) {
                    try {
                        liveDraft = pickLaunchableLiveDraft(await window.DraftCC.ghostReplay.listLeagueChainDrafts(leagueIdForFetch));
                    } catch (_) {}
                }
                if (cancelled || !liveDraft?.draft_id) return;
                const key = autoStartLiveToken + ':' + liveDraft.draft_id;
                if (liveAutoStartedRef.current === key) return;
                liveAutoStartedRef.current = key;
                const patch = liveDraftSetupPatch(liveDraft, currentLeague);
                dispatch({ type: 'SETUP_CHANGE', payload: patch });
                onStartDraft(patch);
            };
            launch();
            return () => { cancelled = true; };
        }, [forcedMode, autoStartLiveToken, state.phase, fetchedDrafts, leagueIdForFetch, onStartDraft]);

        // ── Manual handover from a memorialized completed board ─────
        // The completed draft holds the room until the next draft genuinely takes
        // over (auto-supersede above). This is the explicit escape hatch: archive
        // the finished board to Draft History and open the next draft's room now.
        const [pendingNextDraft, setPendingNextDraft] = React.useState(null);
        const nextUpDraft = React.useMemo(() => {
            if (forcedMode !== 'live-sync' || state.phase !== 'complete') return null;
            return (Array.isArray(fetchedDrafts) ? fetchedDrafts : [])
                .filter(d => d && d.draft_id
                    && String(d.draft_id) !== String(state.sleeperDraftId || '')
                    && (d.status === 'pre_draft' || d.status === 'drafting'))
                .sort((a, b) => {
                    if (a.status !== b.status) return a.status === 'drafting' ? -1 : 1;
                    return (Number(a.start_time) || Infinity) - (Number(b.start_time) || Infinity);
                })[0] || null;
        }, [forcedMode, state.phase, fetchedDrafts, state.sleeperDraftId]);
        const openNextDraftRoom = React.useCallback(() => {
            if (!nextUpDraft) return;
            const PD = window.App?.PostDraft;
            const leagueId = currentLeague?.league_id || currentLeague?.id || '';
            try { if (PD?.clearMemorial && leagueId) PD.clearMemorial(leagueId); } catch (e) {}
            stateFns.clearLocal(leagueId, forcedMode);
            setPendingNextDraft(nextUpDraft);
            dispatch({ type: 'RESET' });
        }, [nextUpDraft, currentLeague, forcedMode]);
        React.useEffect(() => {
            if (!pendingNextDraft || state.phase !== 'setup') return;
            const patch = liveDraftSetupPatch(pendingNextDraft, currentLeague);
            setPendingNextDraft(null);
            dispatch({ type: 'SETUP_CHANGE', payload: patch });
            onStartDraft(patch);
        }, [pendingNextDraft, state.phase, currentLeague, onStartDraft]);

        // ── Self-heal personas when window.S.rosters lands late ─────
        // Personas are stripped on save (state.js) and rebuilt synchronously
        // from window.S.rosters at mount / START_DRAFT / resume. On a cold or
        // refreshed load into a Follow-Live-Draft session, the league's rosters
        // arrive via league-detail's async hydration, which can finish *after*
        // that first compose — leaving state.personas empty for the whole
        // session, which blanks Opponent Intel (and the prediction engine,
        // which bails on an empty persona set). Recompose once rosters appear.
        React.useEffect(() => {
            if (state.phase === 'setup' || state.phase === 'complete') return;
            const rosterCount = (window.S?.rosters || []).length;
            if (!rosterCount) return;
            if (Object.keys(state.personas || {}).length >= rosterCount) return;
            const leagueId = currentLeague?.league_id || currentLeague?.id || '';
            let draftDnaMap = {};
            try {
                if (window.DraftHistory?.loadDraftDNA) {
                    draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
                }
            } catch (e) {}
            const personas = window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap);
            if (Object.keys(personas).length > Object.keys(state.personas || {}).length) {
                dispatch({ type: 'HYDRATE', state: { personas } });
            }
        }, [state.phase, state.personas, myRoster, currentLeague]);

        // ── Phase 2: predictions refresh ────────────────────────────
        // Recompute willReach / willPassOn / likelyPick for every persona
        // at the start of each round. Cached per round in draftState.personas[rid].predictions.
        const lastPredIdxRef = React.useRef(-1);
        const personaSignature = Object.keys(state.personas || {}).length;
        React.useEffect(() => {
            if (state.phase !== 'drafting') return;
            if (!currentSlot) return;
            if (!personaSignature) return;
            // Refresh on EVERY pick, not once per round. The previous per-round cache
            // let predictions go stale within a round and name players who had already
            // been drafted — the core reason the Prediction Engine looked "off" vs the
            // live board and the projected-picks report.
            if (state.currentIdx === lastPredIdxRef.current) return;
            lastPredIdxRef.current = state.currentIdx;

            const round = currentSlot.round;
            // Predict only over the AVAILABLE pool (drafted players removed) so a
            // "likely pick" can never be a player who is already off the board.
            const apCopies = Math.max(1, Number(state.playerCopies) || 1);
            const availablePool = (state.pool || []).filter(p => p && p.pid && (state.draftedPids?.[p.pid] || 0) < apCopies);
            const payload = {};
            Object.entries(state.personas).forEach(([rid, persona]) => {
                try {
                    const draftCtx = state.draftContext || null;
                    // Each opponent predicts at THEIR OWN next slot, not the slot of
                    // whoever happens to be on the clock right now.
                    const oppSlot = (state.pickOrder || [])
                        .slice(state.currentIdx)
                        .find(s => String(s.rosterId) === String(rid));
                    const preds = window.DraftCC.cpuEngine.computePredictions(
                        persona,
                        availablePool,
                        oppSlot?.round || round,
                        oppSlot?.overall || currentSlot.overall,
                        {
                            draftTuning: state.draftTuning,
                            draftContext: draftCtx,
                            boardContext: draftCtx?.boardContext || null,
                            ownerIntel: persona?.ownerIntel || draftCtx?.ownerContext?.[String(rid)] || null,
                        }
                    );
                    payload[rid] = preds;
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.computePreds', e);
                }
            });
            if (Object.keys(payload).length) {
                dispatch({ type: 'UPDATE_PREDICTIONS', payload, round });
            }
        }, [state.phase, state.currentIdx, personaSignature]);

        const onExit = React.useCallback(() => {
            // Phase 5: stop live-sync polling if it's running
            if (window.DraftCC.liveSync?.isRunning?.()) {
                window.DraftCC.liveSync.stop();
            }
            // Live drafts are memorialized: closing the recap keeps the completed board
            // + memorial intact (a reset only happens when a new draft is scheduled).
            if (forcedMode === 'live-sync' && state.phase === 'complete') {
                setRecapDismissed(true);
                // Persist the dismissal on the memorial so later entries into this
                // draft (incl. the completed-draft auto-open) land on the board.
                try {
                    const PD = window.App?.PostDraft;
                    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
                    if (PD?.saveMemorial && leagueId && state.sleeperDraftId) {
                        PD.saveMemorial(leagueId, { draftId: state.sleeperDraftId, recapSeen: true });
                    }
                } catch (e) {}
                return;
            }
            stateFns.clearLocal(currentLeague?.league_id || currentLeague?.id, forcedMode);
            dispatch({ type: 'RESET' });
            setShowResume(false);
        }, [currentLeague, forcedMode, state.phase, state.sleeperDraftId]);

        // Memorialize a completed LIVE draft; retire it only when a different draft
        // genuinely takes over the room. A pre_draft that was ALREADY scheduled when
        // this draft finished (e.g. a UDFA frenzy queued up alongside the rookie
        // draft) must NOT evict the just-completed board — that wiped users' drafts
        // the instant they ended. selectCurrentDraft only hands the room to another
        // draft when one goes live or one is created after this one completed.
        React.useEffect(() => {
            if (forcedMode !== 'live-sync') return;
            const PD = window.App?.PostDraft;
            const leagueId = currentLeague?.league_id || currentLeague?.id || '';
            if (!PD || !leagueId) return;
            if (state.phase === 'complete' && state.sleeperDraftId && PD.saveMemorial) {
                try {
                    const existing = PD.getMemorial ? PD.getMemorial(leagueId) : null;
                    const completedAt = (existing && String(existing.draftId) === String(state.sleeperDraftId) && existing.completedAt)
                        || Date.now();
                    PD.saveMemorial(leagueId, { draftId: state.sleeperDraftId, season: state.season, variant: state.variant, completedAt });
                } catch (e) {}
            }
            const mem = PD.getMemorial ? PD.getMemorial(leagueId) : null;
            if (!mem || !mem.draftId) return;
            // Only judge supersession off a real drafts fetch — never off an empty/failed one.
            if (!Array.isArray(fetchedDrafts) || !fetchedDrafts.length) return;
            const sel = stateFns.selectCurrentDraft ? stateFns.selectCurrentDraft(fetchedDrafts) : null;
            if (sel && sel.draft && String(sel.draft.draft_id) !== String(mem.draftId)) {
                // The recap was archived at completion (draft:closed → archiveRecap),
                // so the retired draft stays reachable from Draft History.
                try { PD.clearMemorial(leagueId); } catch (e) {}
                // Only reset the room if it's still holding the retired draft —
                // never clobber a session that's already mirroring the new one.
                const roomHoldsRetired = state.phase === 'complete'
                    || String(state.sleeperDraftId || '') === String(mem.draftId);
                if (roomHoldsRetired) {
                    stateFns.clearLocal(leagueId, forcedMode);
                    dispatch({ type: 'RESET' });
                }
            }
        }, [forcedMode, state.phase, state.sleeperDraftId, fetchedDrafts, currentLeague]);

        const onResumeYes = React.useCallback(() => {
            setShowResume(false);
            // Rebuild personas (we don't persist them)
            const leagueId = currentLeague?.league_id || currentLeague?.id || '';
            let draftDnaMap = {};
            try {
                if (window.DraftHistory?.loadDraftDNA) {
                    draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
                }
            } catch (e) {}
            const personas = window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap);
            const draftContext = window.DraftCC?.context?.buildDraftContext
                ? window.DraftCC.context.buildDraftContext({
                    state: { ...state, personas },
                    currentLeague,
                    myRoster,
                    playersData,
                    pool: state.pool,
                    pickOrder: state.pickOrder,
                    personas,
                    draftMeta,
                })
                : state.draftContext || null;
            dispatch({ type: 'HYDRATE', state: { personas, originalPool: state.originalPool?.length ? state.originalPool : state.pool.slice(), draftContext } });
        }, [currentLeague, myRoster, playersData, draftMeta, state]);

        const onResumeNo = React.useCallback(() => {
            stateFns.clearLocal(currentLeague?.league_id || currentLeague?.id, forcedMode);
            dispatch({ type: 'RESET' });
            setShowResume(false);
        }, [currentLeague]);

        // Phase 3: open the trade proposer drawer for a given CPU roster
        const onPropose = React.useCallback((rosterId, seed) => {
            if (!rosterId || String(rosterId) === String(state.userRosterId)) return;
            const s = seed || {};
            // Default the draft trade desk to FIND/move-up — the primary draft use is
            // acquiring a better pick. When a specific asset is queued (e.g. "Queue
            // trade" from the pick log seeds theirGive), keep the manual Build view so
            // the seeded lane is visible. (FIND defaults to the 'acquire' intent.)
            const hasAssetSeed = !!(s.myGive?.length || s.theirGive?.length || s.myGivePlayers?.length
                || s.theirGivePlayers?.length || s.myGiveFuture?.length || s.theirGiveFuture?.length
                || s.myGiveFaab || s.theirGiveFaab);
            const finalSeed = { ...s, analyzerMode: s.analyzerMode || (hasAssetSeed ? 'build' : 'find') };
            dispatch({ type: 'OPEN_PROPOSER', targetRosterId: rosterId, seed: finalSeed });
        }, [state.userRosterId]);

        // ── Render ───────────────────────────────────────────────────
        // Mobile redirect
        if (viewport === 'mobile') {
            // Phone gets the REAL mock setup (owner ask — mobile must be able to
            // mock draft): SetupScreen's CSS already stacks 1-col at small widths,
            // so pool type / rounds / league size / slot / order / CPU speed and
            // the strategy studio all work on a phone. Live-sync keeps the feed —
            // its setup phase is transient (the auto-start effect opens the room).
            if (state.phase === 'setup' && forcedMode !== 'live-sync') {
                return (
                    <SetupScreen
                        state={state}
                        dispatch={dispatch}
                        draftMeta={draftMeta}
                        playersData={playersData}
                        currentLeague={currentLeague}
                        myRoster={myRoster}
                        csvReady={csvReady}
                        showResume={showResume}
                        onStartDraft={onStartDraft}
                        onResumeYes={onResumeYes}
                        onResumeNo={onResumeNo}
                        forcedMode={forcedMode}
                    />
                );
            }
            return <MobileFeed state={state} dispatch={dispatch} onStart={onStartDraft} isUserTurn={isUserTurn} currentSlot={currentSlot} onPropose={onPropose} />;
        }

        // Setup phase
        if (state.phase === 'setup') {
            return (
                <SetupScreen
                    state={state}
                    dispatch={dispatch}
                    draftMeta={draftMeta}
                    playersData={playersData}
                    currentLeague={currentLeague}
                    myRoster={myRoster}
                    csvReady={csvReady}
                    showResume={showResume}
                    onStartDraft={onStartDraft}
                    onResumeYes={onResumeYes}
                    onResumeNo={onResumeNo}
                    forcedMode={forcedMode}
                />
            );
        }

        // Drafting / complete phase → Command Center grid
        return (
            <CommandCenterGrid
                state={state}
                dispatch={dispatch}
                isUserTurn={isUserTurn}
                currentSlot={currentSlot}
                onExit={onExit}
                onPropose={onPropose}
                viewport={viewport}
                forcedMode={forcedMode}
                recapDismissed={recapDismissed}
                onShowRecap={() => setRecapDismissed(false)}
                nextUpDraft={nextUpDraft}
                onOpenNextDraft={openNextDraftRoom}
            />
        );
    }

    // ── Setup screen ─────────────────────────────────────────────────
    function SetupScreen({ state, dispatch, draftMeta, playersData, currentLeague, myRoster, csvReady, showResume, onStartDraft, onResumeYes, onResumeNo, forcedMode }) {
        const [showPoolOther, setShowPoolOther] = React.useState(false); // custom pool + advanced mock options hide behind "Other" (league settings are the default)
        const selStyle = {
            width: '100%',
            padding: '8px 10px',
            minHeight: '44px',
            background: 'var(--ov-3, rgba(255,255,255,0.04))',
            border: 'var(--card-border)',
            borderRadius: 'var(--card-radius-sm)',
            color: 'var(--white)',
            fontSize: '0.82rem',
            fontFamily: FONT_UI,
            outline: 'none',
            cursor: 'pointer',
        };

        const update = (patch) => dispatch({ type: 'SETUP_CHANGE', payload: patch });
        const upcoming = draftMeta.upcomingSettings || null;
        const totalPicks = (state.rounds || 0) * (state.leagueSize || 0);
        const poolCount = state.variant === 'rookie'
            ? (window.getProspects?.()?.length || state.pool?.length || 0)
            : (state.pool?.length || Object.keys(window.App?.LI?.playerScores || {}).length || 0);
        const previewOrder = window.DraftCC?.state?.buildPickOrder
            ? window.DraftCC.state.buildPickOrder(state.rounds, state.leagueSize, state.draftType, draftMeta.slotToRoster || {}, draftMeta.pickOwnership || {})
            : [];
        const ownedPreview = previewOrder.filter(p => Number(p.rosterId) === Number(state.userRosterId)).slice(0, 6);
        const userPickPreview = ownedPreview.length ? ownedPreview : previewOrder.filter(p => Number(p.slot) === Number(state.userSlot)).slice(0, 6);
        const slotOwner = draftMeta.slotToRoster?.[state.userSlot]?.ownerName || (state.userSlot === draftMeta.mySlot ? 'You' : 'Team ' + state.userSlot);
	        const fallbackPickPreview = Array.from({ length: Math.min(6, state.rounds || 0) }, (_, i) => {
	            const round = i + 1;
	            const slot = state.draftType === 'snake' && round % 2 === 0 ? state.leagueSize - state.userSlot + 1 : state.userSlot;
	            const overall = ((round - 1) * state.leagueSize) + slot;
	            const pickValue = window.DraftCC?.state?.resolveDraftPickValue?.({
	                season: window.S?.season,
	                round,
	                slot,
	                overall,
	                leagueSize: state.leagueSize,
	                rounds: state.rounds,
	            });
	            return { round, slot, pickInRound: slot, overall, value: pickValue?.value || 0, ownerName: slotOwner, traded: false };
	        });
	        const pickPreviewRows = userPickPreview.length ? userPickPreview : fallbackPickPreview;
	        const fmtDhqValue = n => Number(n || 0) > 0 ? Number(n || 0).toLocaleString() + ' DHQ' : 'value pending';
        const variantLabels = {
            startup: 'Dynasty Start Up pool',
            rookie: 'Rookie pool',
            redraft: 'Redraft pool',
        };
        const poolChoices = [
            { id: 'startup', label: 'Dynasty Start Up', sub: 'DHQ-ranked dynasty board' },
            { id: 'rookie', label: 'rookie', sub: csvReady ? (window.getProspects?.()?.length || 0) + ' prospects loaded' : 'loading CSV...' },
            { id: 'redraft', label: 'redraft', sub: 'current-season adapter' },
        ];
        const setupSummary = [
            variantLabels[state.variant] || 'Dynasty Start Up pool',
            state.draftType === 'snake' ? 'Snake draft' : 'Linear draft',
            state.rounds + ' rounds',
            state.leagueSize + ' teams',
        ].join(' - ');
        const paceLabel = state.mode === 'manual'
            ? 'manual entry'
            : state.mode === 'live-sync'
                ? 'Sleeper mirror'
                : state.speed + ' CPU';
        const roundOptions = (() => {
            const opts = new Set(Array.from({ length: 100 }, (_, i) => i + 1));
            [state.rounds, upcoming?.rounds].forEach(v => {
                const n = Number(v || 0);
                if (n > 0) opts.add(n);
            });
            return [...opts].sort((a, b) => a - b);
        })();
        const leagueSizeOptions = (() => {
            const opts = new Set(Array.from({ length: 29 }, (_, i) => i + 4));
            [state.leagueSize, upcoming?.teams, draftMeta.numTeams].forEach(v => {
                const n = Number(v || 0);
                if (n > 0) opts.add(n);
            });
            return [...opts].sort((a, b) => a - b);
        })();
        const upcomingPatch = () => {
            if (!upcoming) return {};
            const patch = { mode: 'solo' };
            if (upcoming.rounds) patch.rounds = Number(upcoming.rounds);
            if (upcoming.teams) patch.leagueSize = Number(upcoming.teams);
            if (upcoming.type) patch.draftType = upcoming.type;
            if (upcoming.variant) patch.variant = upcoming.variant;
            if (draftMeta.mySlot) patch.userSlot = draftMeta.mySlot;
            if (myRoster?.roster_id) patch.userRosterId = myRoster.roster_id;
            return patch;
        };
        const applyUpcomingDraft = () => {
            const patch = upcomingPatch();
            if (Object.keys(patch).length) update(patch);
        };
        const startUpcomingDraft = () => {
            const patch = upcomingPatch();
            if (Object.keys(patch).length) update(patch);
            onStartDraft(patch);
        };
        const matchesUpcoming = !!upcoming
            && (!upcoming.rounds || Number(state.rounds) === Number(upcoming.rounds))
            && (!upcoming.teams || Number(state.leagueSize) === Number(upcoming.teams))
            && (!upcoming.type || String(state.draftType) === String(upcoming.type))
            && (!upcoming.variant || String(state.variant) === String(upcoming.variant))
            && (!draftMeta.mySlot || Number(state.userSlot) === Number(draftMeta.mySlot));
        // League settings are the DEFAULT mock source (owner ask): sync the setup
        // to the upcoming draft once, as soon as it resolves. Ref-guarded so a
        // user who switches to "Other" is never re-synced.
        const appliedUpcomingRef = React.useRef(false);
        React.useEffect(() => {
            if (appliedUpcomingRef.current || !upcoming) return;
            appliedUpcomingRef.current = true;
            if (!matchesUpcoming) applyUpcomingDraft();
        });
        const upcomingStart = upcoming?.startTime
            ? new Date(upcoming.startTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
            : (upcoming?.status === 'drafting' ? 'in progress' : 'not scheduled');
        const upcomingStatus = upcoming?.status
            ? String(upcoming.status).replace('_', ' ')
            : (upcoming ? 'league settings' : 'custom mock');
        const structureFields = [
            {
                label: 'Draft Rounds',
                value: state.rounds,
                onChange: e => update({ rounds: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }),
                options: roundOptions,
                suffix: ' rounds',
            },
            {
                label: 'League Size',
                value: state.leagueSize,
                onChange: e => {
                    const n = Number(e.target.value) || state.leagueSize;
                    update({ leagueSize: n, userSlot: Math.min(state.userSlot, n) });
                },
                options: leagueSizeOptions,
                suffix: ' teams',
            },
        ];

        return (
            <div className="draft-setup-shell">
                {!forcedMode && showResume && (
                    <div style={{
                        padding: 'var(--space-md) var(--space-lg)',
                        background: 'linear-gradient(90deg, var(--acc-fill2, rgba(212,175,55,0.12)), var(--acc-fill1, rgba(212,175,55,0.02)))',
                        border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))',
                        borderRadius: '8px',
                        marginBottom: 'var(--card-gap)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-md)',
                    }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', marginBottom: '2px' }}>Resume draft in progress?</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--silver)' }}>
                                {state.picks.length} picks made - Round {state.pickOrder[state.currentIdx]?.round || '?'}
                            </div>
                        </div>
                        <button onClick={onResumeYes} style={{ padding: '6px 16px', minHeight: '44px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: 'var(--card-radius-sm)', fontWeight: 700, cursor: 'pointer', fontSize: '0.76rem', fontFamily: FONT_UI }}>Resume</button>
                        <button onClick={onResumeNo} style={{ padding: '6px 12px', minHeight: '44px', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius-sm)', cursor: 'pointer', fontSize: '0.74rem', fontFamily: FONT_UI }}>Discard</button>
                    </div>
                )}

                {forcedMode === 'live-sync' ? (
                    <section className="draft-setup-panel draft-live-only-picker" style={{ borderColor: 'rgba(124,107,248,0.26)' }}>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1fr) auto',
                            gap: '16px',
                            alignItems: 'center',
                            padding: '4px 2px 14px',
                            borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                            marginBottom: '14px',
                        }}>
                            <div>
                                <div style={{ color: 'var(--gold)', fontFamily: FONT_DISPL, fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
                                    Follow Live Draft
                                </div>
                                <div style={{ color: 'var(--white)', fontFamily: FONT_DISPL, fontSize: '1.22rem', fontWeight: 900 }}>
                                    Opening the live command room
                                </div>
                                <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: '0.76rem', marginTop: 4, lineHeight: 1.45 }}>
                                    I will auto-select the league's active or next scheduled Sleeper draft, then mirror it with your board, roster build, and opponent intel.
                                </div>
                            </div>
                            <div style={{
                                minWidth: 150,
                                padding: '10px 12px',
                                borderRadius: 7,
                                border: '1px solid rgba(155,138,251,0.28)',
                                background: 'rgba(155,138,251,0.07)',
                                textAlign: 'center',
                            }}>
                                <div style={{ color: 'rgba(214,208,255,0.98)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Live Sync</div>
                                <div style={{ color: 'var(--white)', fontFamily: FONT_MONO, fontSize: '0.9rem', fontWeight: 800, marginTop: 3 }}>one-click</div>
                            </div>
                        </div>
                        <LiveSyncDraftPicker state={state} update={update} leagueId={state.leagueId} currentLeague={currentLeague} launchOnly />
                    </section>
                ) : (
                    <>
                        {state.mode === 'scenario' && <ScenarioPicker state={state} update={update} />}
                        {state.mode === 'ghost' && <GhostDraftPicker state={state} update={update} leagueId={state.leagueId} />}

                        <div className="draft-setup-grid draft-setup-grid-pro">
                        {/* The old "League Upcoming Draft" hero card was removed (owner
                            ask) — league settings are now the DEFAULT Draft Source inside
                            Draft Setup below, auto-applied when the upcoming draft resolves. */}

                    <section className="draft-setup-panel draft-setup-config-card">
                        <div className="draft-hq-panel-head">
                            <span>Draft Setup</span>
                            <em>{setupSummary}</em>
                        </div>
                        {/* Draft Source (owner ask): league settings are the default;
                            the custom pool choices hide behind "Other". */}
                        <div className="draft-setup-label">Draft Source</div>
                        <div className="draft-setup-choice">
                            <button type="button" className={!showPoolOther && matchesUpcoming ? 'is-active' : ''} disabled={!upcoming}
                                onClick={() => { setShowPoolOther(false); applyUpcomingDraft(); }}>
                                League settings
                                <span>{upcoming ? `${upcoming.rounds || '?'} rds x ${upcoming.teams || '?'} - ${upcoming.type || 'snake'} - ${variantLabels[upcoming.variant] || upcoming.variant || 'rookie pool'}` : 'no scheduled draft found'}</span>
                            </button>
                            <button type="button" className={showPoolOther || !upcoming || !matchesUpcoming ? 'is-active' : ''} onClick={() => setShowPoolOther(v => !v)}>
                                Other
                                <span>custom pool + structure</span>
                            </button>
                        </div>
                        {(showPoolOther || !upcoming) && (<>
                        <div className="draft-setup-label" style={{ marginTop: 10 }}>Pool Type</div>
                        <div className="draft-setup-choice draft-setup-choice-pro">
                            {poolChoices.map(choice => (
                                <button key={choice.id} type="button" className={state.variant === choice.id ? 'is-active' : ''} onClick={() => update({ variant: choice.id })}>
                                    {choice.label}
                                    <span>{choice.sub}</span>
                                </button>
                            ))}
                        </div>
                        {/* Advanced mock options ride under "Other" too (owner ask):
                            manual room, scenarios, ghost replay, templates. */}
                        <div className="draft-setup-label" style={{ marginTop: 10 }}>Advanced Mock Options</div>
                        <div className="draft-setup-other">
                            <ModeSelector state={state} update={update} />
                            <TemplateLoader state={state} dispatch={dispatch} />
                        </div>
                        </>)}

                        <div className="draft-setup-field-grid">
                            {structureFields.map(field => (
                                <div key={field.label}>
                                    <div className="draft-setup-label">{field.label}</div>
                                    <select value={field.value} onChange={field.onChange} style={selStyle}>
                                        {field.options.map(v => <option key={v} value={v} style={{ background: 'var(--k-111111, #111111)' }}>{v}{field.suffix === ' rounds' && v === 1 ? ' round' : field.suffix}</option>)}
                                    </select>
                                </div>
                            ))}
                            <div>
                                <div className="draft-setup-label">Your Draft Position</div>
                                <select value={state.userSlot} onChange={e => update({ userSlot: +e.target.value })} style={selStyle}>
                                    {Array.from({ length: state.leagueSize }, (_, i) => {
                                        const slot = i + 1;
                                        const info = draftMeta.slotToRoster[slot];
                                        const isMine = slot === draftMeta.mySlot;
                                        const ownerLabel = info?.ownerName ? ' - ' + info.ownerName : '';
                                        return <option key={slot} value={slot} style={{ background: 'var(--k-111111, #111111)' }}>{slot}.01{ownerLabel}{isMine ? ' (YOU)' : ''}</option>;
                                    })}
                                </select>
                            </div>
                            <div>
                                <div className="draft-setup-label">Draft Order</div>
                                <select value={state.draftType} onChange={e => update({ draftType: e.target.value })} style={selStyle}>
                                    <option value="snake" style={{ background: 'var(--k-111111, #111111)' }}>Snake</option>
                                    <option value="linear" style={{ background: 'var(--k-111111, #111111)' }}>Linear</option>
                                </select>
                            </div>
                        </div>

                        {state.mode !== 'manual' ? (
                            <>
                                <div className="draft-setup-label" style={{ marginTop: 12 }}>CPU Speed</div>
                                <div className="draft-setup-speed">
                                    {['slow', 'medium', 'fast'].map(v => (
                                        <button key={v} type="button" className={state.speed === v ? 'is-active' : ''} onClick={() => update({ speed: v })}>{v}</button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="draft-setup-note" style={{ marginTop: 10 }}>
                                Manual entry records the room pick by pick without CPU autopicks.
                            </div>
                        )}

                        {/* Advanced mock options moved under the Draft Source "Other"
                            reveal above — no separate toggle row anymore. */}
                    </section>

                    <section className="draft-setup-panel is-start draft-setup-launch-card">
                        {/* Pick Path Preview removed on all form factors (owner ask) —
                            this panel is now just the launch button + room summary. */}
                        <div className="draft-hq-panel-head">
                            <span>Launch</span>
                            <em>{paceLabel}</em>
                        </div>
                        <button
                            type="button"
                            className="draft-setup-start"
                            onClick={() => onStartDraft()}
                            disabled={state.variant === 'rookie' && !csvReady}
	                            style={{
	                                background: state.variant === 'rookie' && !csvReady ? 'var(--acc-line2, rgba(212,175,55,0.3))' : 'var(--gold)',
	                                color: 'var(--black)',
	                                borderColor: state.variant === 'rookie' && !csvReady ? 'var(--acc-line2, rgba(212,175,55,0.3))' : 'var(--gold)',
	                            }}
	                        >
	                            {state.variant === 'rookie' && !csvReady ? 'LOADING PROSPECTS...' : 'START MOCK DRAFT'}
	                        </button>
                        <div className="draft-setup-note" style={{ marginTop: 10 }}>
                            {setupSummary}. Owner DNA, needs, draft history, and your saved Big Board order will drive the room.
                        </div>
                    </section>
                        </div>
                        {/* Learning archive merged into the studio (owner ask): one
                            card, with a real-draft-learning toggle instead of the old
                            "recaps feeding mock defaults" panel. */}
                        {state.mode !== 'manual' && (
                            <section className="draft-setup-panel draft-setup-strategy-card">
                                <DraftStrategyStudio state={state} update={update} />
                                <RealDraftLearning state={state} update={update} />
                            </section>
                        )}
                    </>
                )}
            </div>
        );
    }

    // ── Real-draft learning (merged into the Strategy Studio card) ────
    // Replaces the Draft Learning Archive panel: mock recaps NEVER feed the
    // model anymore — one toggle applies the LATEST REAL draft's learnings
    // (live-sync recap) to the studio tuning; off returns manual control.
    function RealDraftLearning({ state, update }) {
        const helpers = window.DraftCC?.state || {};
        if (!helpers.buildRecapLearningDefaults || !helpers.listDraftRecaps) return null;
        const learning = helpers.buildRecapLearningDefaults(state.leagueId, {
            modes: ['live-sync'],
            limit: 1,
            baseTuning: state.draftTuning,
        });
        const hasReal = !!learning?.sampleSize;
        const on = hasReal && !state.realLearningOff;
        const latestReal = hasReal ? (helpers.listDraftRecaps(state.leagueId) || []).find(r => r.mode === 'live-sync') : null;
        const when = ts => { try { return ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; } catch (_) { return ''; } };
        const tuningLabels = [
            ['ownerDna', 'Owner DNA'],
            ['classValue', 'Class Value'],
            ['needFit', 'Roster Fit'],
            ['tradeActivity', 'Trades'],
            ['variance', 'Variance'],
        ];
        const toggle = () => {
            if (!hasReal) return;
            if (on) {
                update({ realLearningOff: true, recapLearning: null });
            } else {
                update({ realLearningOff: false, recapLearning: learning, draftTuning: learning.suggestedTuning });
            }
        };
        return (
            <div style={{ marginTop: 12 }}>
                <div className="draft-setup-label">Draft Learning</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 12px', marginTop: 6, border: '1px solid ' + (on ? 'var(--acc-line2, rgba(212,175,55,0.32))' : 'var(--ov-5, rgba(255,255,255,0.08))'), background: on ? 'var(--acc-fill1, rgba(212,175,55,0.05))' : 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: 8 }}>
                    <button type="button" onClick={toggle} disabled={!hasReal} aria-pressed={on}
                        style={{ minHeight: 44, padding: '8px 14px', borderRadius: 999, border: '1px solid ' + (on ? 'var(--acc-line4, rgba(212,175,55,0.55))' : 'var(--ov-6, rgba(255,255,255,0.14))'), background: on ? 'var(--acc-fill2, rgba(212,175,55,0.14))' : 'transparent', color: on ? 'var(--gold)' : 'var(--silver)', fontFamily: FONT_UI, fontWeight: 900, fontSize: 'var(--text-micro, 0.6875rem)', letterSpacing: '0.06em', textTransform: 'uppercase', cursor: hasReal ? 'pointer' : 'not-allowed', opacity: hasReal ? 1 : 0.55 }}>
                        {on ? 'Real-draft learning: ON' : 'Real-draft learning: OFF'}
                    </button>
                    <div style={{ flex: '1 1 220px', minWidth: 0, color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.45 }}>
                        {hasReal
                            ? <>Latest real draft{latestReal ? ' (' + (ccIsPro() && latestReal.grade?.letter ? 'grade ' + latestReal.grade.letter + ' - ' : '') + when(latestReal.savedAt) + ')' : ''} {on ? 'is adjusting' : 'can adjust'} the model. Mock results never feed it.</>
                            : 'No real draft on record yet - finish a live draft and its learnings can drive the model.'}
                    </div>
                    {hasReal && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, width: '100%' }}>
                            {tuningLabels.map(([key, label]) => (
                                <span key={key} style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: on ? 'var(--gold)' : 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderRadius: 4, padding: '3px 6px', background: 'var(--ov-2, rgba(255,255,255,0.025))', opacity: on ? 1 : 0.6 }}>
                                    {label} {learning.suggestedTuning?.[key] ?? '--'}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }


    function AnalystMockPanel({ state, dispatch, draftMeta, playersData, currentLeague, myRoster }) {
        const engine = window.DraftCC?.analystMock;
        const presets = engine?.PRESETS || [];
        const [presetId, setPresetId] = React.useState('league-history');
        const [roundLimit, setRoundLimit] = React.useState('full');
        const [reports, setReports] = React.useState([]);
        const [activeId, setActiveId] = React.useState(null);
        const [filters, setFilters] = React.useState({ team: 'all', round: 'all', pos: 'ALL', focus: 'all', query: '' });
        const [expandedOverall, setExpandedOverall] = React.useState(null);
        const active = reports.find(r => r.id === activeId) || reports[0] || null;
        const analystRoundOptions = React.useMemo(() => {
            const maxRounds = Math.max(1, Math.min(100, Number(state.rounds || 1)));
            return Array.from({ length: maxRounds }, (_, idx) => String(idx + 1));
        }, [state.rounds]);
        React.useEffect(() => {
            if (!active?.picks?.length) return;
            const stillValid = active.picks.some(p => Number(p.overall) === Number(expandedOverall));
            if (stillValid) return;
            const firstUser = active.summary?.userPicks?.[0];
            setExpandedOverall(firstUser?.overall || active.picks[0].overall);
        }, [active?.id]);
        if (!engine || !presets.length) return null;

        const generate = () => {
            const report = engine.generateProjectedMock({
                state,
                draftMeta,
                playersData,
                currentLeague,
                myRoster,
                presetId,
                roundLimit,
            });
            setReports(prev => [report].concat(prev.filter(r => r.id !== report.id)).slice(0, 4));
            setActiveId(report.id);
        };
        const useAsScenario = () => {
            if (!active) return;
            dispatch({
                type: 'SETUP_CHANGE',
                payload: {
                    mode: 'scenario',
                    scenarioId: null,
                    analystScenario: active,
                },
            });
        };
        const driverLabel = (counts) => {
            const order = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
            return order.slice(0, 3).map(([k, v]) => k.replace(/_/g, ' ') + ' ' + v).join(' - ') || 'No drivers yet';
        };
        const fmt = n => {
            const v = Number(n || 0);
            if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k';
            return String(Math.round(v));
        };
        const patchFilters = patch => setFilters(prev => ({ ...prev, ...patch }));
        const filteredPicks = active
            ? (engine.applyReportFilters ? engine.applyReportFilters(active, filters, state) : active.picks)
            : [];
        const brief = active?.summary?.reportBrief || null;
        const teamOptions = active ? Array.from(new Map(active.picks.map(p => {
            const key = String(p.rosterId || p.ownerName || p.slot);
            return [key, { key, label: p.ownerName || ('Team ' + p.slot) }];
        })).values()).sort((a, b) => a.label.localeCompare(b.label)) : [];
        const roundOptions = active ? Array.from(new Set(active.picks.map(p => Number(p.round)))).sort((a, b) => a - b) : [];
        const posOptions = active ? Array.from(new Set(active.picks.map(p => String(p.pos || '?').toUpperCase()))).sort() : [];
        const focusCount = id => {
            if (!active) return 0;
            if (id === 'all') return active.picks.length;
            if (id === 'my') return active.summary?.userPicks?.length || 0;
            if (id === 'reaches') return active.summary?.reaches?.length || 0;
            if (id === 'steals') return active.summary?.steals?.length || 0;
            if (id === 'trades') return active.summary?.tradeSignals?.length || 0;
            if (id === 'high') return active.picks.filter(p => p.confidence === 'high').length;
            if (id === 'owner_history') return active.picks.filter(p => (p.drivers || []).some(d => d.code === 'owner_history')).length;
            if (id === 'need') return active.picks.filter(p => p.alexCommentary?.meta?.needHit || (p.drivers || []).some(d => d.code === 'need')).length;
            return 0;
        };
        const focusOptions = [
            { id: 'all', label: 'All' },
            { id: 'my', label: 'My Picks' },
            { id: 'reaches', label: 'Reaches' },
            { id: 'steals', label: 'Steals' },
            { id: 'trades', label: 'Trade Heat' },
            { id: 'high', label: 'High Certainty' },
            { id: 'owner_history', label: 'Owner DNA' },
            { id: 'need', label: 'Need Fits' },
        ];
        const controlStyle = {
            padding: '7px 9px',
            background: 'var(--ov-3, rgba(255,255,255,0.04))',
            border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))',
            borderRadius: '6px',
            color: 'var(--white)',
            fontSize: 'var(--text-micro, 0.6875rem)',
            fontFamily: FONT_UI,
            outline: 'none',
            minWidth: 0,
        };
        const chipStyle = activeChip => ({
            padding: '5px 8px',
            borderRadius: '5px',
            border: '1px solid ' + (activeChip ? 'var(--acc-line3, rgba(212,175,55,0.46))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
            background: activeChip ? 'var(--acc-fill2, rgba(212,175,55,0.13))' : 'var(--ov-2, rgba(255,255,255,0.025))',
            color: activeChip ? 'var(--gold)' : 'var(--silver)',
            cursor: 'pointer',
            fontSize: 'var(--text-micro, 0.6875rem)',
            fontFamily: FONT_UI,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
        });
        const preset = engine.presetFor(presetId);
        const comparison = active && reports.length > 1 && engine.compareReports
            ? engine.compareReports([active].concat(reports.filter(r => r.id !== active.id)), state)
            : null;

        return (
            <section className="draft-setup-panel" style={{ marginTop: 12 }}>
                <div className="draft-hq-panel-head">
                    <span>Analyst Projected Mock</span>
                    <em>{preset.label} - {roundLimit === 'full' ? 'full draft' : roundLimit + ' round' + (Number(roundLimit) === 1 ? '' : 's')}</em>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, alignItems: 'start' }}>
                    <div>
                        <div className="draft-setup-choice" style={{ marginTop: 6, marginBottom: 10, gridTemplateColumns: 'repeat(3, 1fr)' }}>
                            {presets.map(p => (
                                <button key={p.id} type="button" className={presetId === p.id ? 'is-active' : ''} onClick={() => setPresetId(p.id)}>
                                    {p.label}
                                    <span>{p.desc}</span>
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={roundLimit} onChange={e => setRoundLimit(e.target.value)} style={{
                                padding: '7px 10px',
                                background: 'var(--ov-3, rgba(255,255,255,0.04))',
                                border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))',
                                borderRadius: '6px',
                                color: 'var(--white)',
                                fontSize: '0.76rem',
                                fontFamily: FONT_UI,
                                outline: 'none',
                            }}>
                                {analystRoundOptions.map(round => (
                                    <option key={round} value={round} style={{ background: 'var(--k-111111, #111111)' }}>{round} round{Number(round) === 1 ? '' : 's'}</option>
                                ))}
                                <option value="full" style={{ background: 'var(--k-111111, #111111)' }}>Full draft</option>
                            </select>
                            <button type="button" onClick={generate} style={{
                                padding: '8px 14px',
                                background: 'var(--gold)',
                                color: 'var(--black)',
                                border: '1px solid var(--gold)',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.72rem',
                                fontFamily: FONT_UI,
                                fontWeight: 800,
                                letterSpacing: '0.04em',
                            }}>GENERATE LEAGUE MOCK</button>
                            {active && (
                                <button type="button" onClick={useAsScenario} style={{
                                    padding: '8px 12px',
                                    background: 'rgba(46,204,113,0.12)',
                                    color: 'var(--k-2ecc71, #2ecc71)',
                                    border: '1px solid rgba(46,204,113,0.35)',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.72rem',
                                    fontFamily: FONT_UI,
                                    fontWeight: 800,
                                }}>REHEARSE THIS PROJECTION</button>
                            )}
                        </div>
                    </div>
                    <div style={{
                        minHeight: 190,
                        padding: '10px 12px',
                        background: 'var(--ov-2, rgba(255,255,255,0.025))',
                        border: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))',
                        borderRadius: '8px',
                    }}>
                        {!active && (
                            <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.72rem', lineHeight: 1.55 }}>
                                Generate a league-specific pick-by-pick projection using draft order, owner profiles, saved boards, roster needs, and tuning assumptions.
                            </div>
                        )}
                        {active && (
                            <div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 8 }}>
                                    <div><span style={{ display: 'block', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase' }}>Picks</span><strong style={{ color: 'var(--gold)', fontFamily: FONT_MONO }}>{active.summary.totalPicks}</strong></div>
                                    <div><span style={{ display: 'block', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase' }}>Your Picks</span><strong style={{ color: 'var(--k-2ecc71, #2ecc71)', fontFamily: FONT_MONO }}>{active.summary.userPicks.length}</strong></div>
                                    <div><span style={{ display: 'block', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase' }}>Basis</span><strong style={{ color: 'var(--white)', fontFamily: FONT_MONO }}>{active.basis}</strong></div>
                                </div>
                                {brief && (
                                    <div style={{
                                        marginBottom: 9,
                                        padding: '8px 9px',
                                        background: 'var(--acc-fill1, rgba(212,175,55,0.055))',
                                        border: '1px solid var(--acc-fill3, rgba(212,175,55,0.16))',
                                        borderRadius: '7px',
                                    }}>
                                        <div style={{ color: 'var(--gold)', fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 900, fontFamily: FONT_UI, marginBottom: 3 }}>Report Brief</div>
                                        <div style={{ color: 'var(--white)', fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.35, fontFamily: FONT_UI }}>{brief.headline}</div>
                                        <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.35, marginTop: 4, fontFamily: FONT_UI }}>{brief.userPath}</div>
                                    </div>
                                )}
                                {brief && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6, marginBottom: 9 }}>
                                        <div style={{ padding: '7px 8px', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', background: 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: 6 }}>
                                            <span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pressure</span>
                                            <strong style={{ display: 'block', color: 'var(--white)', fontSize: '0.72rem', fontFamily: FONT_MONO, marginTop: 2 }}>{brief.positionPressure?.[0] ? brief.positionPressure[0].key + ' x' + brief.positionPressure[0].count : 'Even'}</strong>
                                        </div>
                                        <div style={{ padding: '7px 8px', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', background: 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: 6 }}>
                                            <span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Value Team</span>
                                            <strong style={{ display: 'block', color: 'var(--k-2ecc71, #2ecc71)', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_UI, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brief.valueTeams?.[0]?.ownerName || '—'}</strong>
                                        </div>
                                        <div style={{ padding: '7px 8px', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', background: 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: 6 }}>
                                            <span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Watch</span>
                                            <strong style={{ display: 'block', color: 'var(--gold)', fontSize: '0.72rem', fontFamily: FONT_MONO, marginTop: 2 }}>{(active.summary.reaches?.length || 0) + (active.summary.steals?.length || 0) + (active.summary.tradeSignals?.length || 0)}</strong>
                                        </div>
                                    </div>
                                )}
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, marginBottom: 8 }}>{driverLabel(active.summary.driverCounts)}</div>
                                <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                                    {reports.map(r => (
                                        <button key={r.id} type="button" onClick={() => setActiveId(r.id)} style={{
                                            padding: '3px 7px',
                                            borderRadius: '4px',
                                            border: '1px solid ' + (active.id === r.id ? 'var(--acc-line3, rgba(212,175,55,0.45))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                            background: active.id === r.id ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent',
                                            color: active.id === r.id ? 'var(--gold)' : 'var(--silver)',
                                            cursor: 'pointer',
                                            fontSize: 'var(--text-micro, 0.6875rem)',
                                            fontFamily: FONT_UI,
                                        }}>{r.label}</button>
                                    ))}
                                </div>
                                {comparison?.ready && (
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
                                        gap: 6,
                                        marginBottom: 9,
                                        padding: '7px 8px',
                                        background: 'rgba(155,138,251,0.055)',
                                        border: '1px solid rgba(155,138,251,0.18)',
                                        borderRadius: 7,
                                    }}>
                                        <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase' }}>Changed Picks</span><strong style={{ color: 'rgba(214,208,255,0.98)', fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)' }}>{comparison.changedPickCount}</strong></div>
                                        <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase' }}>Target Risk</span><strong style={{ color: comparison.summary.targetRisk ? 'var(--k-f0a500, #f0a500)' : 'var(--k-2ecc71, #2ecc71)', fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)' }}>{comparison.summary.targetRisk}</strong></div>
                                        <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase' }}>Top Grade</span><strong style={{ color: 'var(--gold)', fontFamily: FONT_UI, fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{comparison.teamGrades?.[0]?.letter || '?'} · {comparison.teamGrades?.[0]?.ownerName || '—'}</strong></div>
                                    </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.62fr 0.62fr 1fr', gap: 6, marginBottom: 7 }}>
                                    <select value={filters.team} onChange={e => patchFilters({ team: e.target.value })} style={controlStyle}>
                                        <option value="all" style={{ background: 'var(--k-111111, #111111)' }}>All teams</option>
                                        {teamOptions.map(t => <option key={t.key} value={t.key} style={{ background: 'var(--k-111111, #111111)' }}>{t.label}</option>)}
                                    </select>
                                    <select value={filters.round} onChange={e => patchFilters({ round: e.target.value })} style={controlStyle}>
                                        <option value="all" style={{ background: 'var(--k-111111, #111111)' }}>All rounds</option>
                                        {roundOptions.map(r => <option key={r} value={r} style={{ background: 'var(--k-111111, #111111)' }}>R{r}</option>)}
                                    </select>
                                    <select value={filters.pos} onChange={e => patchFilters({ pos: e.target.value })} style={controlStyle}>
                                        <option value="ALL" style={{ background: 'var(--k-111111, #111111)' }}>All pos</option>
                                        {posOptions.map(pos => <option key={pos} value={pos} style={{ background: 'var(--k-111111, #111111)' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</option>)}
                                    </select>
                                    <input value={filters.query} onChange={e => patchFilters({ query: e.target.value })} placeholder="Search report..." style={{ ...controlStyle, width: '100%' }} />
                                </div>
                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                                    {focusOptions.map(f => (
                                        <button key={f.id} type="button" onClick={() => patchFilters({ focus: f.id })} style={chipStyle(filters.focus === f.id)}>
                                            {f.label} <span style={{ opacity: 0.62, fontFamily: FONT_MONO }}>{focusCount(f.id)}</span>
                                        </button>
                                    ))}
                                    {(filters.team !== 'all' || filters.round !== 'all' || filters.pos !== 'ALL' || filters.focus !== 'all' || filters.query) && (
                                        <button type="button" onClick={() => setFilters({ team: 'all', round: 'all', pos: 'ALL', focus: 'all', query: '' })} style={chipStyle(false)}>Clear</button>
                                    )}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--silver)', opacity: 0.68, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_UI, marginBottom: 5 }}>
                                    <span>{filteredPicks.length} of {active.picks.length} projected picks</span>
                                    <span>{brief?.roundSummaries?.length || 0} rounds · {brief?.teamSummaries?.length || 0} teams</span>
                                </div>
                                <div style={{ maxHeight: 520, overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: 3 }}>
                                    {!filteredPicks.length && (
                                        <div style={{ padding: 14, color: 'var(--silver)', opacity: 0.68, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'center' }}>No picks match the current report filters.</div>
                                    )}
                                    {filteredPicks.map(p => {
                                        const expanded = Number(expandedOverall) === Number(p.overall);
                                        const isReach = (active.summary.reaches || []).some(x => Number(x.overall) === Number(p.overall));
                                        const isSteal = (active.summary.steals || []).some(x => Number(x.overall) === Number(p.overall));
                                        const isTrade = (active.summary.tradeSignals || []).some(x => Number(x.overall) === Number(p.overall));
                                        const isMine = String(p.rosterId || '') === String(state.userRosterId || '') || (!p.rosterId && Number(p.slot) === Number(state.userSlot));
                                        const borderColor = isMine ? 'rgba(46,204,113,0.34)' : expanded ? 'var(--acc-line2, rgba(212,175,55,0.34))' : 'var(--ov-4, rgba(255,255,255,0.055))';
                                        return (
                                            <div key={p.overall} onClick={() => setExpandedOverall(expanded ? null : p.overall)} role="button" tabIndex={0} style={{
                                                marginBottom: 6,
                                                padding: '7px 8px',
                                                border: '1px solid ' + borderColor,
                                                background: expanded ? 'var(--acc-fill1, rgba(212,175,55,0.065))' : isMine ? 'rgba(46,204,113,0.04)' : 'var(--ov-1, rgba(255,255,255,0.018))',
                                                borderRadius: 7,
                                                cursor: 'pointer',
                                            }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '42px minmax(0,1fr) 62px', gap: 8, alignItems: 'start' }}>
                                                    <span style={{ color: isMine ? 'var(--k-2ecc71, #2ecc71)' : 'var(--gold)', fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)' }}>{p.round}.{String(pickInRoundOf(p, state.leagueSize) || 0).padStart(2, '0')}</span>
                                                    <span style={{ minWidth: 0 }}>
                                                        <strong style={{ display: 'block', color: 'var(--white)', fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name} <span style={{ color: 'var(--gold)', fontSize: 'var(--text-micro, 0.6875rem)' }}>{p.pos}</span></strong>
                                                        <em style={{ display: 'block', color: 'var(--silver)', opacity: 0.66, fontSize: 'var(--text-micro, 0.6875rem)', fontStyle: 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.ownerName}</em>
                                                    </span>
                                                    <span style={{ textAlign: 'right' }}>
                                                        <span style={{ display: 'block', color: p.confidence === 'high' ? 'var(--k-2ecc71, #2ecc71)' : p.confidence === 'medium' ? 'var(--gold)' : 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', fontWeight: 900 }}>{p.confidence}</span>
                                                        <span style={{ display: 'block', color: isSteal ? 'var(--k-2ecc71, #2ecc71)' : isReach ? 'var(--k-e74c3c, #e74c3c)' : 'var(--silver)', fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)', marginTop: 2 }}>{isSteal ? 'STEAL' : isReach ? 'REACH' : isTrade ? 'TRADE' : fmt(p.dhq)}</span>
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                                                    {isMine && <span style={chipStyle(true)}>Your pick</span>}
                                                    {(p.drivers || []).slice(0, 3).map(d => <span key={d.code} style={{ ...chipStyle(false), cursor: 'default', padding: '3px 6px', fontSize: 'var(--text-micro, 0.6875rem)' }}>{d.label}</span>)}
                                                </div>
                                                {expanded && (
                                                    <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                                                        <div style={{ color: 'var(--silver)', opacity: 0.78, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.38, fontFamily: FONT_UI, marginBottom: 7 }}>{p.note}</div>
                                                        {p.alexCommentary && (
                                                            <div style={{ padding: '7px 8px', background: 'var(--acc-fill1, rgba(212,175,55,0.055))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))', borderRadius: 6 }}>
                                                                <div style={{ color: 'var(--gold)', fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 900, marginBottom: 4 }}>Alex Pick Read</div>
                                                                <div style={{ display: 'grid', gap: 5 }}>
                                                                    {[p.alexCommentary.teamImpact, p.alexCommentary.ownerFit, p.alexCommentary.boardRead, p.alexCommentary.roomImpact, p.alexCommentary.pivot].filter(Boolean).map((line, idx) => (
                                                                        <div key={idx} style={{ color: idx === 2 ? 'var(--white)' : 'var(--silver)', opacity: idx === 2 ? 0.92 : 0.75, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.35, fontFamily: FONT_UI }}>{line}</div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginTop: 7 }}>
                                                            <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase' }}>DHQ</span><strong style={{ color: 'var(--gold)', fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)' }}>{fmt(p.dhq)}</strong></div>
                                                            <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase' }}>Board</span><strong style={{ color: 'var(--white)', fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)' }}>{p.consensusRank ? '#' + Math.round(p.consensusRank) : '—'}</strong></div>
                                                            <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase' }}>Tier</span><strong style={{ color: 'var(--white)', fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)' }}>{p.tier || '—'}</strong></div>
                                                            <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase' }}>Alt</span><strong style={{ color: 'var(--white)', fontFamily: FONT_UI, fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(p.alternatives || [])[0]?.name || '—'}</strong></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        );
    }

    function DraftStrategyStudio({ state, update }) {
        const helpers = window.DraftCC?.state || {};
        const presets = (helpers.getDraftStrategyPresets?.() || []).filter(p => !p.hidden);
        const currentProfile = state.strategyProfile || (helpers.loadDraftStrategyProfile
            ? helpers.loadDraftStrategyProfile(state.leagueId, {
                variant: state.variant,
                baseTuning: state.draftTuning,
                recapLearning: state.recapLearning,
            })
            : null);
        const activePresetId = currentProfile?.presetId || 'front-office-blend';
        const [saveState, setSaveState] = React.useState('idle');
        const buildProfile = (presetId, extra = {}) => helpers.buildDraftStrategyProfile
            ? helpers.buildDraftStrategyProfile({
                leagueId: state.leagueId,
                presetId,
                variant: state.variant,
                baseTuning: state.draftTuning,
                recapLearning: state.recapLearning,
                gmMode: currentProfile?.gmMode,
                ...extra,
            })
            : null;
        const persistProfile = (profile) => {
            if (!profile) return;
            const saved = helpers.saveDraftStrategyProfile
                ? helpers.saveDraftStrategyProfile(state.leagueId, profile)
                : profile;
            const next = saved || profile;
            update({ strategyProfile: next, draftTuning: next.tuning || state.draftTuning });
            setSaveState('saved');
            setTimeout(() => setSaveState('idle'), 1800);
        };
        const applyPreset = (preset) => {
            const profile = buildProfile(preset.id, { label: preset.label, philosophy: preset.philosophy });
            persistProfile(profile);
        };
        const saveCustom = () => {
            const profile = buildProfile('custom-studio', {
                label: 'Custom Studio',
                philosophy: 'Hand-tuned by the GM.',
                tuning: state.draftTuning,
                source: 'custom_studio',
            });
            persistProfile(profile);
        };
        const signal = currentProfile?.aiSignals || {};
        const signalRows = [
            ['Owner history', signal.ownerHistory ?? state.draftTuning?.ownerDna],
            ['Class crop', signal.classCrop ?? state.draftTuning?.classValue],
            ['Roster fit', signal.rosterFit ?? state.draftTuning?.needFit],
            ['Trades', signal.tradeMode || (Number(state.draftTuning?.tradeActivity || 0) <= 3 ? 'off' : 'normal')],
            ['Variance', signal.varianceModel || 'balanced'],
        ];
        const compact = bpBucket() === 'mobile';

        if (!presets.length) return <DraftTuningControls state={state} update={update} />;

        return (
            <div style={{ marginTop: '14px' }}>
                <div className="draft-setup-label">AI GM Strategy Studio</div>
                <div style={{
                    display: 'grid',
                    gap: 10,
                    padding: '10px 12px',
                    marginTop: '6px',
                    background: 'var(--ov-2, rgba(255,255,255,0.025))',
                    border: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))',
                    borderRadius: '8px',
                }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 6 }}>
                        {presets.map(preset => {
                            const active = activePresetId === preset.id;
                            return (
                                <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => applyPreset(preset)}
                                    style={{
                                        minHeight: 68,
                                        padding: '8px 9px',
                                        borderRadius: 7,
                                        border: active ? '1px solid var(--acc-line4, rgba(212,175,55,0.55))' : '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                                        background: active ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.025))',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontFamily: FONT_UI,
                                    }}
                                >
                                    <div style={{ color: active ? 'var(--gold)' : 'var(--white)', fontWeight: 900, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{preset.shortLabel || preset.label}</div>
                                    <div style={{ color: 'var(--silver)', opacity: 0.66, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.35, marginTop: 4 }}>{preset.philosophy}</div>
                                </button>
                            );
                        })}
                    </div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1.1fr) minmax(220px, 0.9fr)',
                        gap: 10,
                        alignItems: 'start',
                    }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: 'var(--white)', fontWeight: 900, fontSize: '0.8rem', fontFamily: FONT_UI }}>
                                {currentProfile?.label || 'Front Office Blend'}
                            </div>
                            <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.45, marginTop: 3 }}>
                                {currentProfile?.philosophy || 'Balanced board, owner history, roster fit, and normal trade pressure.'}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                                {signalRows.map(([label, value]) => (
                                    <span key={label} style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderRadius: 4, padding: '3px 5px', background: 'var(--ov-2, rgba(255,255,255,0.025))' }}>
                                        {label} {typeof value === 'number' ? value + '%' : value}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                            <button
                                type="button"
                                onClick={saveCustom}
                                style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--acc-line2, rgba(212,175,55,0.32))', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)', fontFamily: FONT_UI, fontWeight: 900, cursor: 'pointer', fontSize: 'var(--text-micro, 0.6875rem)' }}
                            >
                                {saveState === 'saved' ? 'SAVED TO LEAGUE' : 'SAVE PROFILE'}
                            </button>
                            <div style={{ color: 'var(--silver)', opacity: 0.58, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.35, fontFamily: FONT_UI }}>
                                {currentProfile?.saved ? 'League profile active.' : 'GM mode default active.'}
                            </div>
                        </div>
                    </div>
                    <DraftTuningControls state={state} update={update} />
                </div>
            </div>
        );
    }

    function DraftTuningControls({ state, update }) {
        const t = state.draftTuning || {};
        const patch = (key, value) => {
            const nextTuning = { ...t, [key]: Number(value) };
            const helpers = window.DraftCC?.state || {};
            const strategyProfile = helpers.buildDraftStrategyProfile
                ? helpers.buildDraftStrategyProfile({
                    leagueId: state.leagueId,
                    presetId: 'custom-studio',
                    label: 'Custom Studio',
                    philosophy: 'Hand-tuned by the GM.',
                    variant: state.variant,
                    baseTuning: nextTuning,
                    tuning: nextTuning,
                    gmMode: state.strategyProfile?.gmMode,
                    recapLearning: state.recapLearning,
                    source: 'unsaved_custom',
                })
                : { ...(state.strategyProfile || {}), presetId: 'custom-studio', label: 'Custom Studio', tuning: nextTuning, saved: false };
            update({ draftTuning: nextTuning, strategyProfile: { ...strategyProfile, saved: false } });
        };
        const rows = [
            { key: 'ownerDna', label: 'Owner DNA', left: 'Class-agnostic', right: 'History-heavy' },
            { key: 'classValue', label: 'Class Value', left: 'Loose tiers', right: 'Board discipline' },
            { key: 'needFit', label: 'Roster Fit', left: 'BPA', right: 'Need-driven' },
            { key: 'tradeActivity', label: 'Trade Activity', left: 'No trades', right: 'Aggressive' },
            { key: 'variance', label: 'Pick Variance', left: 'Predictable', right: 'Chaotic' },
        ];
        return (
            <div>
                <div className="draft-setup-label">Model Tuning</div>
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    padding: '10px 12px',
                    marginTop: '6px',
                    background: 'var(--ov-2, rgba(255,255,255,0.025))',
                    border: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))',
                    borderRadius: '8px',
                }}>
                    {rows.map(row => {
                        const value = t[row.key] ?? (row.key === 'ownerDna' ? 70 : row.key === 'classValue' ? 65 : row.key === 'needFit' ? 60 : row.key === 'tradeActivity' ? 50 : 45);
                        return (
                            <div key={row.key}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <span style={{ flex: 1, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: FONT_UI }}>{row.label}</span>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--white)', fontFamily: FONT_MONO, minWidth: 34, textAlign: 'right' }}>{value}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={value}
                                    onChange={e => patch(row.key, e.target.value)}
                                    style={{ width: '100%', accentColor: 'var(--gold)' }}
                                />
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.55, fontFamily: FONT_UI, marginTop: '-1px' }}>
                                    <span>{row.left}</span>
                                    <span>{row.right}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Phase 5: ModeSelector ────────────────────────────────────────
    // Live Sync moved to its own top-level tab ("Follow Live Draft").
    function ModeSelector({ state, update }) {
        const modes = [
            { id: 'manual',   label: 'Manual Room',  desc: 'Record every pick yourself',           icon: '✍' },
            { id: 'scenario', label: 'Scenario',     desc: 'Canned "what-if" scenarios',          icon: '🎯' },
            { id: 'ghost',    label: 'Ghost Replay', desc: 'Replay a prior Sleeper draft',        icon: '👻' },
        ];
        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    fontSize: 'var(--text-micro, 0.6875rem)',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '6px',
                }}>Advanced Mock Mode</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                    {modes.map(m => {
                        const isActive = state.mode === m.id;
                        return (
                            <button key={m.id} onClick={() => update({ mode: m.id })} style={{
                                padding: '10px 8px',
                                background: isActive ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                border: '1px solid ' + (isActive ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                borderRadius: '6px',
                                color: isActive ? 'var(--gold)' : 'var(--silver)',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                fontFamily: FONT_UI,
                                cursor: 'pointer',
                            }}>
                                <div style={{ fontSize: '1rem', marginBottom: '3px' }}>{m.icon}</div>
                                <div>{m.label}</div>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '2px' }}>{m.desc}</div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Phase 5: ScenarioPicker ──────────────────────────────────────
    function ScenarioPicker({ state, update }) {
        const presets = window.DraftCC.scenarios?.presets || [];
        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    fontSize: 'var(--text-micro, 0.6875rem)',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '6px',
                }}>Scenario</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {presets.map(p => {
                        const isActive = state.scenarioId === p.id;
                        return (
                            <button key={p.id} onClick={() => update({ scenarioId: p.id })} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '10px 14px',
                                background: isActive ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                border: '1px solid ' + (isActive ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                borderRadius: '6px',
                                color: 'var(--white)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                fontFamily: FONT_UI,
                            }}>
                                <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>{p.icon}</span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isActive ? 'var(--gold)' : 'var(--white)' }}>{p.name}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.7, marginTop: '2px' }}>{p.desc}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Phase 5: GhostDraftPicker ────────────────────────────────────
    // Pulls drafts from THIS league only, walking the previous_league_id chain
    // backward so dynasty continuations from prior seasons are included.
    function GhostDraftPicker({ state, update, leagueId }) {
        const [drafts, setDrafts] = React.useState(null);
        const [loading, setLoading] = React.useState(false);
        const [progress, setProgress] = React.useState('');

        React.useEffect(() => {
            if (!leagueId) return;
            setLoading(true);
            setProgress('Loading drafts from this league…');
            window.DraftCC.ghostReplay.listLeagueChainDrafts(leagueId)
                .then(d => {
                    setDrafts(d || []);
                    setProgress('');
                })
                .catch(e => {
                    setDrafts([]);
                    setProgress('Error: ' + (e?.message || 'unknown'));
                    if (window.wrLog) window.wrLog('ghostPicker.list', e);
                })
                .finally(() => setLoading(false));
        }, [leagueId]);

        const completeDrafts = (drafts || []).filter(d => d.status === 'complete');
        const otherDrafts = (drafts || []).filter(d => d.status !== 'complete');

        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '6px',
                }}>
                    <div style={{
                        fontSize: 'var(--text-micro, 0.6875rem)',
                        fontWeight: 700,
                        color: 'var(--gold)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        flex: 1,
                    }}>Replay Source</div>
                    {!loading && drafts && (
                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6 }}>
                            {completeDrafts.length} complete · {otherDrafts.length} other
                        </span>
                    )}
                </div>
                {loading && (
                    <div style={{
                        fontSize: '0.72rem',
                        color: 'var(--silver)',
                        padding: '10px 14px',
                        background: 'var(--ov-1, rgba(255,255,255,0.02))',
                        border: '1px solid var(--ov-3, rgba(255,255,255,0.05))',
                        borderRadius: '5px',
                    }}>
                        {progress || 'Loading drafts from Sleeper…'}
                    </div>
                )}
                {!loading && drafts && drafts.length === 0 && (
                    <div style={{
                        padding: '10px 14px',
                        background: 'rgba(231,76,60,0.08)',
                        border: '1px solid rgba(231,76,60,0.25)',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        color: 'var(--k-e74c3c, #e74c3c)',
                    }}>
                        No drafts found for this league.
                    </div>
                )}
                {!loading && drafts && drafts.length > 0 && completeDrafts.length === 0 && (
                    <div style={{
                        padding: '10px 14px',
                        background: 'rgba(240,165,0,0.08)',
                        border: '1px solid rgba(240,165,0,0.3)',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        color: 'var(--k-f0a500, #f0a500)',
                        marginBottom: '6px',
                        lineHeight: 1.5,
                    }}>
                        ⚠ This league has no completed drafts yet. Try <strong>Solo</strong> or <strong>Scenario</strong> mode, or <strong>Live Sync</strong> to mirror a draft in progress.
                    </div>
                )}
                {!loading && completeDrafts.length > 0 && (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        maxHeight: 280,
                        overflowY: 'auto',
                        paddingRight: 4,
                    }}>
                        {completeDrafts.map(d => {
                            const isActive = state.sleeperDraftId === d.draft_id;
                            return (
                                <button key={d.draft_id}
                                    onClick={() => update({ sleeperDraftId: d.draft_id })}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '8px 12px',
                                        background: isActive ? 'var(--acc-fill3, rgba(212,175,55,0.14))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                        border: '1px solid ' + (isActive ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                        borderRadius: '5px',
                                        color: 'var(--white)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontFamily: FONT_UI,
                                        fontSize: '0.72rem',
                                    }}>
                                    <span style={{
                                        fontSize: 'var(--text-micro, 0.6875rem)',
                                        color: 'var(--gold)',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        minWidth: 42,
                                    }}>{d.season}</span>
                                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {d.type || 'snake'} · {d.settings?.rounds || '?'}R × {d.settings?.teams || '?'}T
                                        {d.leagueName && <span style={{ color: 'var(--silver)', opacity: 0.6, marginLeft: 6 }}>· {d.leagueName}</span>}
                                    </span>
                                    <span style={{
                                        fontSize: 'var(--text-micro, 0.6875rem)',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        background: 'rgba(46,204,113,0.15)',
                                        color: 'var(--k-2ecc71, #2ecc71)',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                        fontWeight: 700,
                                    }}>complete</span>
                                </button>
                            );
                        })}
                    </div>
                )}
                {/* In-progress / not-started drafts still render as informational so users see them */}
                {!loading && otherDrafts.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                        <div style={{
                            fontSize: 'var(--text-micro, 0.6875rem)',
                            color: 'var(--silver)',
                            opacity: 0.5,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            marginBottom: '3px',
                        }}>In progress / upcoming ({otherDrafts.length})</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: 100, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                            {otherDrafts.slice(0, 10).map(d => (
                                <div key={d.draft_id}
                                    title={d.status === 'pre_draft' ? 'Not started yet — no picks to replay' : 'Draft in progress — use Live Sync mode instead'}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '5px 10px',
                                        background: 'var(--ov-1, rgba(255,255,255,0.015))',
                                        border: '1px dashed var(--ov-3, rgba(255,255,255,0.05))',
                                        borderRadius: '4px',
                                        color: 'var(--silver)',
                                        cursor: 'not-allowed',
                                        fontFamily: FONT_UI,
                                        fontSize: 'var(--text-micro, 0.6875rem)',
                                        opacity: 0.45,
                                    }}>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, minWidth: 42 }}>{d.season}</span>
                                    <span style={{
                                        flex: 1,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}>{(d.leagueName || 'Unknown').slice(0, 30)} · {d.type || 'snake'} · {d.settings?.teams || '?'}T</span>
                                    <span style={{
                                        fontSize: 'var(--text-micro, 0.6875rem)',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        background: 'rgba(240,165,0,0.12)',
                                        color: 'var(--k-f0a500, #f0a500)',
                                        textTransform: 'uppercase',
                                        fontWeight: 700,
                                    }}>{d.status === 'pre_draft' ? 'upcoming' : d.status}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Phase 5: LiveSyncDraftPicker ─────────────────────────────────
    // Shows only pre_draft / drafting status drafts from this league's chain.
    // A live sync source must be something currently scheduled or in-flight —
    // completed drafts would be ghost replay territory.
    function LiveSyncDraftPicker({ state, update, leagueId, currentLeague, launchOnly = false }) {
        const [drafts, setDrafts] = React.useState(null);
        const [loading, setLoading] = React.useState(false);

        React.useEffect(() => {
            if (!leagueId) return;
            setLoading(true);
            window.DraftCC.ghostReplay.listLeagueChainDrafts(leagueId)
                .then(d => setDrafts(d || []))
                .catch(() => setDrafts([]))
                .finally(() => setLoading(false));
        }, [leagueId]);

        // Launchable sources: in-flight + upcoming drafts, PLUS the league's most
        // recently completed draft while it's still the draft of record (review
        // window) — launching it rebuilds the finished board + grade from Sleeper.
        const recordSel = window.DraftCC?.state?.selectCurrentDraft?.(drafts) || null;
        const reviewDraftId = recordSel?.reason === 'review' ? String(recordSel.draft?.draft_id || '') : '';
        const statusRank = d => d.status === 'drafting' ? 0 : (String(d.draft_id) === reviewDraftId ? 1 : 2);
        const liveDrafts = (drafts || [])
            .filter(d => d.status === 'pre_draft' || d.status === 'drafting' || String(d.draft_id) === reviewDraftId)
            // Sort: drafting first (most urgent), then the reviewable completed
            // draft, then pre_draft by start_time asc (next up)
            .sort((a, b) => {
                if (statusRank(a) !== statusRank(b)) return statusRank(a) - statusRank(b);
                return (a.start_time || Infinity) - (b.start_time || Infinity);
            });
        const liveDraftSignature = liveDrafts.map(d => d.draft_id + ':' + d.status).join('|');

        React.useEffect(() => {
            if (loading || state.sleeperDraftId || !liveDrafts.length) return;
            update(liveDraftSetupPatch(liveDrafts[0], currentLeague));
        }, [loading, state.sleeperDraftId, liveDraftSignature]);

        if (launchOnly) {
            const selectedDraft = liveDrafts.find(d => state.sleeperDraftId === d.draft_id) || liveDrafts[0] || null;
            const statusLabel = loading
                ? 'finding source'
                : selectedDraft?.status === 'drafting'
                    ? 'live now'
                    : selectedDraft?.status === 'complete'
                        ? 'last draft — review'
                        : selectedDraft
                            ? 'upcoming'
                            : 'no source';
            const statusColor = selectedDraft?.status === 'drafting'
                ? 'var(--k-2ecc71, #2ecc71)'
                : selectedDraft?.status === 'complete'
                    ? 'var(--gold)'
                    : selectedDraft ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
            const startStr = selectedDraft?.status === 'complete'
                ? 'completed' + (selectedDraft.last_picked ? ' ' + new Date(selectedDraft.last_picked).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')
                : selectedDraft?.start_time
                    ? new Date(selectedDraft.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                    : selectedDraft?.status === 'drafting'
                        ? 'in progress'
                        : 'not scheduled';
            return (
                <div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        gap: '12px',
                        alignItems: 'center',
                        padding: '13px 14px',
                        borderRadius: 8,
                        border: '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                        background: 'linear-gradient(90deg, var(--ov-3, rgba(255,255,255,0.035)), rgba(155,138,251,0.045))',
                    }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: statusColor, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
                                {statusLabel}
                            </div>
                            <div style={{ color: 'var(--white)', fontFamily: FONT_DISPL, fontSize: '1rem', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {loading ? 'Checking Sleeper draft sources...' : selectedDraft ? `${selectedDraft.season || state.season} · ${selectedDraft.type || state.draftType} · ${selectedDraft.settings?.rounds || state.rounds}R × ${selectedDraft.settings?.teams || state.leagueSize}T` : 'No upcoming or in-progress draft found'}
                            </div>
                            <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: 'var(--text-micro, 0.6875rem)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {selectedDraft ? `${selectedDraft.leagueName || 'Sleeper draft'} · ${startStr}` : 'Live Draft will open as soon as Sleeper has a scheduled source.'}
                            </div>
                        </div>
                        <div style={{
                            padding: '7px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.08))',
                            color: 'var(--gold)',
                            fontFamily: FONT_DISPL,
                            fontSize: 'var(--text-micro, 0.6875rem)',
                            fontWeight: 900,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                        }}>
                            {selectedDraft ? 'launching' : 'waiting'}
                        </div>
                    </div>
                    {!loading && liveDrafts.length === 0 && (
                        <div style={{
                            marginTop: 10,
                            padding: '10px 12px',
                            borderRadius: 7,
                            border: '1px solid rgba(231,76,60,0.24)',
                            background: 'rgba(231,76,60,0.07)',
                            color: 'var(--k-e74c3c, #e74c3c)',
                            fontSize: '0.72rem',
                            lineHeight: 1.45,
                        }}>
                            No live source is available yet. Sleeper has not exposed an upcoming or in-progress draft for this league.
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '6px',
                }}>
                    <div style={{
                        fontSize: 'var(--text-micro, 0.6875rem)',
                        fontWeight: 700,
                        color: 'var(--gold)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        flex: 1,
                    }}>Live Sync Source</div>
                    {!loading && liveDrafts && (
                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6 }}>
                            {liveDrafts.length} upcoming
                        </span>
                    )}
                </div>
                {loading && (
                    <div style={{
                        fontSize: '0.72rem',
                        color: 'var(--silver)',
                        padding: '10px 14px',
                        background: 'var(--ov-1, rgba(255,255,255,0.02))',
                        border: '1px solid var(--ov-3, rgba(255,255,255,0.05))',
                        borderRadius: '5px',
                    }}>
                        Loading upcoming drafts…
                    </div>
                )}
                {!loading && liveDrafts.length === 0 && (
                    <div style={{
                        padding: '10px 14px',
                        background: 'rgba(240,165,0,0.08)',
                        border: '1px solid rgba(240,165,0,0.3)',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        color: 'var(--k-f0a500, #f0a500)',
                        lineHeight: 1.5,
                    }}>
                        ⚠ No upcoming or in-progress drafts in this league. Live Sync mirrors a real draft as it happens — come back when one is scheduled.
                    </div>
                )}
                {!loading && liveDrafts.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: 220, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                        {liveDrafts.map(d => {
                            const isActive = state.sleeperDraftId === d.draft_id;
                            const isDrafting = d.status === 'drafting';
                            const isComplete = d.status === 'complete';
                            const statusLabel = isDrafting ? 'LIVE' : isComplete ? 'REVIEW' : 'UPCOMING';
                            const statusCol = isDrafting ? 'var(--k-2ecc71, #2ecc71)' : isComplete ? 'var(--gold)' : 'var(--k-f0a500, #f0a500)';
                            const startStr = isComplete
                                ? 'completed' + (d.last_picked ? ' ' + new Date(d.last_picked).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')
                                : d.start_time
                                    ? new Date(d.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                                    : (isDrafting ? 'in progress' : 'not scheduled');
                            return (
                                <button key={d.draft_id}
                                    onClick={() => update(liveDraftSetupPatch(d, currentLeague))}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '10px 12px',
                                        background: isActive ? 'var(--acc-fill3, rgba(212,175,55,0.14))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                        border: '1px solid ' + (isActive ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                        borderRadius: '5px',
                                        color: 'var(--white)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontFamily: FONT_UI,
                                        fontSize: '0.72rem',
                                    }}>
                                    {isDrafting && (
                                        <span style={{
                                            width: 8, height: 8, borderRadius: '50%',
                                            background: 'var(--k-2ecc71, #2ecc71)',
                                            animation: 'pulse 1.4s infinite',
                                            flexShrink: 0,
                                        }} />
                                    )}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {d.season} · {d.type || 'snake'} · {d.settings?.rounds || '?'}R × {d.settings?.teams || '?'}T
                                        </div>
                                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '2px' }}>
                                            {d.leagueName} · {startStr}
                                        </div>
                                    </div>
                                    <span style={{
                                        fontSize: 'var(--text-micro, 0.6875rem)',
                                        padding: '2px 6px',
                                        borderRadius: '3px',
                                        background: wrAlpha(statusCol, '15'),
                                        color: statusCol,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.06em',
                                        fontWeight: 700,
                                        flexShrink: 0,
                                    }}>{statusLabel}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    // ── Phase 5: TemplateLoader ──────────────────────────────────────
    function TemplateLoader({ state, dispatch }) {
        const leagueId = state.leagueId;
        const [templates, setTemplates] = React.useState([]);
        const [refreshKey, setRefreshKey] = React.useState(0);

        React.useEffect(() => {
            const list = window.DraftCC.persistence?.listTemplates(leagueId) || [];
            setTemplates(list);
        }, [leagueId, refreshKey]);

        if (!templates.length) return null;

        const onLoad = (tpl) => {
            const loaded = window.DraftCC.persistence.loadTemplate(leagueId, tpl.id);
            if (!loaded) return;
            dispatch({ type: 'HYDRATE', state: loaded });
        };

        const onDelete = (tpl) => {
            if (!confirm('Delete template "' + tpl.name + '"?')) return;
            window.DraftCC.persistence.deleteTemplate(leagueId, tpl.id);
            setRefreshKey(x => x + 1);
        };

        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    fontSize: 'var(--text-micro, 0.6875rem)',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '6px',
                }}>Saved Templates ({templates.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: 150, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                    {templates.map(tpl => (
                        <div key={tpl.id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 10px',
                            background: 'var(--ov-2, rgba(255,255,255,0.03))',
                            border: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                            borderRadius: '4px',
                            fontFamily: FONT_UI,
                            fontSize: '0.72rem',
                        }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontWeight: 700,
                                    color: 'var(--white)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}>{tpl.name}</div>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6 }}>
                                    {new Date(tpl.ts).toLocaleString()} · {tpl.state.picks?.length || 0} picks
                                </div>
                            </div>
                            <button onClick={() => onLoad(tpl)} style={{
                                padding: '4px 10px',
                                minHeight: '44px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'var(--gold)',
                                color: 'var(--black)',
                                border: 'none',
                                borderRadius: 'var(--card-radius-sm)',
                                cursor: 'pointer',
                                fontSize: 'var(--text-micro, 0.6875rem)',
                                fontWeight: 700,
                                fontFamily: FONT_UI,
                            }}>LOAD</button>
                            <button onClick={() => onDelete(tpl)} style={{
                                padding: '4px 8px',
                                minWidth: '44px',
                                minHeight: '44px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'transparent',
                                color: 'var(--bad)',
                                border: '1px solid rgba(231,76,60,0.3)',
                                borderRadius: 'var(--card-radius-sm)',
                                cursor: 'pointer',
                                fontSize: 'var(--text-micro, 0.6875rem)',
                                fontFamily: FONT_UI,
                            }}>×</button>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    function MyDraftRosterPanel({ state }) {
        const players = window.S?.players || {};
        const scores = window.App?.LI?.playerScores || {};
        const rosters = window.S?.rosters || [];
        const normPos = window.App?.normPos || (p => p);
        const posColors = window.App?.POS_COLORS || {
            QB: 'var(--k-ff6b6b, #ff6b6b)', RB: 'var(--k-4ecdc4, #4ecdc4)', WR: 'var(--k-45b7d1, #45b7d1)', TE: 'var(--k-f7dc6f, #f7dc6f)',
            DL: 'var(--k-e67e22, #e67e22)', LB: 'var(--k-f0a500, #f0a500)', DB: 'var(--k-5dade2, #5dade2)', K: 'var(--k-bb8fce, #bb8fce)',
        };
        const fmt = (n) => {
            const v = Number(n) || 0;
            return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
        };
        const shortName = (full) => {
            const parts = String(full || '').trim().split(/\s+/);
            return parts.length > 1 ? parts[0][0] + '. ' + parts.slice(1).join(' ') : (full || '');
        };
        const playerName = (pid, fallback) => {
            const p = players[pid] || {};
            return fallback || p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || pid;
        };
        const playerAge = (pid, fallback) => {
            const p = players[pid] || {};
            if (fallback != null) return Number(fallback);
            if (p.age) return Number(p.age);
            if (p.birth_date) {
                const d = new Date(p.birth_date).getTime();
                if (Number.isFinite(d)) return Math.floor((Date.now() - d) / 31557600000);
            }
            return null;
        };
        const projectDhq = (dhq, pos, age, years) => {
            const base = Number(dhq) || 0;
            if (!base) return 0;
            const core = window.App?.DhqCore || window.DhqCore;
            if (!core?.ageCurveFactor || !age) return Math.round(base * Math.pow(0.94, years));
            const nowFactor = Math.max(0.01, core.ageCurveFactor(age, pos));
            const futureFactor = core.ageCurveFactor(age + years, pos) / nowFactor;
            return Math.max(0, Math.round(base * futureFactor * Math.pow(0.96, years)));
        };

        const myPicks = React.useMemo(() => {
            return (state.picks || []).filter(p => p.rosterId === state.userRosterId || p.isUser);
        }, [state.picks, state.userRosterId]);

        const baseRoster = React.useMemo(() => {
            return rosters.find(r => String(r.roster_id) === String(state.userRosterId));
        }, [state.userRosterId, rosters.length]);

        const rosterRows = React.useMemo(() => {
            const effective = window.DraftCC?.state?.getEffectivePlayers
                ? window.DraftCC.state.getEffectivePlayers(state, state.userRosterId, baseRoster?.players || [])
                : (baseRoster?.players || []);
            const baseRows = (effective || []).map(pid => {
                const p = players[pid] || {};
                const pos = normPos(p.position) || p.position || '?';
                const dhq = scores[pid] || (typeof window.dynastyValue === 'function' ? window.dynastyValue(pid) : 0) || 0;
                return {
                    pid,
                    name: playerName(pid),
                    pos,
                    team: p.team || 'FA',
                    age: playerAge(pid),
                    dhq,
                    projected5: projectDhq(dhq, pos, playerAge(pid), 5),
                    source: 'Roster',
                };
            });
            const pickRows = myPicks.map(p => ({
                pid: p.pid,
                name: p.name,
                pos: p.pos,
                team: p.team || p.college || 'Draft',
                age: playerAge(p.pid, p.age || p.csv?.age || null),
                dhq: p.dhq || 0,
                projected5: projectDhq(p.dhq || 0, p.pos, playerAge(p.pid, p.age || p.csv?.age || null), 5),
                source: 'Pick ' + p.round + '.' + String(pickInRoundOf(p, state.leagueSize) || 0).padStart(2, '0'),
                isPick: true,
            }));
            return [...baseRows, ...pickRows].filter(r => r.pos && r.dhq > 0).sort((a, b) => {
                if (a.pos !== b.pos) return a.pos.localeCompare(b.pos);
                return b.dhq - a.dhq;
            });
        }, [state, state.userRosterId, baseRoster, players, scores, myPicks]);

        const grouped = React.useMemo(() => {
            const m = {};
            rosterRows.forEach(r => {
                if (!m[r.pos]) m[r.pos] = [];
                m[r.pos].push(r);
            });
            return m;
        }, [rosterRows]);

        const totalDhq = rosterRows.reduce((sum, r) => sum + (r.dhq || 0), 0);
        const pickDhq = myPicks.reduce((sum, p) => sum + (p.dhq || 0), 0);
        const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(pos => grouped[pos]?.length)
            .concat(Object.keys(grouped).filter(pos => !['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(pos)));

        return (
            <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                padding: '8px 10px',
                background: 'var(--black)',
                border: 'var(--card-border)',
                borderRadius: '8px',
                overflow: 'hidden',
                fontFamily: FONT_UI,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                    <div style={{ fontFamily: FONT_DISPL, fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>My Roster Build</div>
                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65 }}>{myPicks.length} picks</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px', flexShrink: 0 }}>
                    <div style={{ padding: '6px 8px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))', borderRadius: '5px' }}>
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase' }}>Roster DHQ</div>
                        <div style={{ fontFamily: FONT_MONO, color: 'var(--gold)', fontWeight: 700, fontSize: '0.84rem' }}>{fmt(totalDhq)}</div>
                    </div>
                    <div style={{ padding: '6px 8px', background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.14)', borderRadius: '5px' }}>
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase' }}>Draft Added</div>
                        <div style={{ fontFamily: FONT_MONO, color: 'var(--k-2ecc71, #2ecc71)', fontWeight: 700, fontSize: '0.84rem' }}>{fmt(pickDhq)}</div>
                    </div>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', paddingRight: '3px' }}>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Build By Position</div>
                    {positions.length === 0 && (
                        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--silver)', opacity: 0.45, fontSize: '0.7rem' }}>Your mock picks will appear here.</div>
                    )}
                    {positions.map(pos => {
                        const rows = grouped[pos];
                        return (
                            <div key={pos} style={{ marginBottom: '6px', paddingBottom: '5px', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
                                    <strong style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: posColors[pos] || 'var(--gold)', width: 28 }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</strong>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.55 }}>{rows.length} players</span>
                                    <span style={{ marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontFamily: FONT_MONO }}>{fmt(rows.reduce((s, r) => s + r.dhq, 0))}</span>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px' }}>
                                    {rows.map(r => (
                                        <span key={r.source + '-' + r.pid} title={r.name} style={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px', fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.5, whiteSpace: 'nowrap' }}>
                                            <span style={{ color: r.isPick ? 'var(--gold)' : 'var(--white)' }}>{shortName(r.name)}</span>
                                            <span style={{ color: 'var(--silver)', opacity: 0.6, fontFamily: FONT_MONO }}>{fmt(r.dhq)}</span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    function DraftPickListPanel({ state, currentSlot, onPropose }) {
        const posColors = window.App?.POS_COLORS || {
            QB: 'var(--k-ff6b6b, #ff6b6b)', RB: 'var(--k-4ecdc4, #4ecdc4)', WR: 'var(--k-45b7d1, #45b7d1)', TE: 'var(--k-f7dc6f, #f7dc6f)',
            DL: 'var(--k-e67e22, #e67e22)', LB: 'var(--k-f0a500, #f0a500)', DB: 'var(--k-5dade2, #5dade2)', K: 'var(--k-bb8fce, #bb8fce)',
        };
        const fmt = (n) => {
            const v = Number(n) || 0;
            return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
        };
        const order = state.pickOrder || [];
        const picks = state.picks || [];
        const personas = state.personas || {};
        const userRosterId = String(state.userRosterId || '');
        const ownerName = (slot, pick) => {
            const rosterId = String(pick?.rosterId || slot?.rosterId || '');
            if (rosterId && personas[rosterId]?.teamName) return personas[rosterId].teamName;
            if (slot?.ownerName) return slot.ownerName;
            if (pick?.isUser || rosterId === userRosterId) return 'Your Team';
            const slotNo = pick?.slot || slot?.slot;
            return slotNo ? 'Team ' + slotNo : 'Draft Room';
        };
        const completedRows = picks.slice(Math.max(0, picks.length - 16)).map((pick, idx, arr) => {
            const orderSlot = order[(Number(pick.overall) || 1) - 1] || {};
            return {
                kind: 'picked',
                key: pick.id || ('picked-' + pick.overall + '-' + idx),
                pick,
                slot: orderSlot,
                label: 'R' + (pick.round || orderSlot.round || '?') + '.' + String(pickInRoundOf(pick, state.leagueSize) || pickInRoundOf(orderSlot, state.leagueSize) || 0).padStart(2, '0'),
                stale: idx < arr.length - 1,
            };
        });
        const upcomingRows = order.slice(state.currentIdx || 0, (state.currentIdx || 0) + 20).map((slot, idx) => ({
            kind: idx === 0 ? 'current' : 'upcoming',
            key: 'upcoming-' + (slot.overall || idx),
            slot,
            pick: null,
            label: 'R' + (slot.round || '?') + '.' + String(pickInRoundOf(slot, state.leagueSize) || 0).padStart(2, '0'),
        }));
        const rows = [...completedRows, ...upcomingRows];
        const currentOverall = currentSlot?.overall || order[state.currentIdx || 0]?.overall;

        return (
            <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))',
                borderRadius: '8px',
                overflow: 'hidden',
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                    background: 'rgba(0,0,0,0.18)',
                }}>
	                    <span style={{ color: 'var(--gold)', fontFamily: FONT_DISPL, fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
	                        Ongoing Draft Log
	                    </span>
                    <em style={{ marginLeft: 'auto', color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', fontStyle: 'normal', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {picks.length} made / {order.length || '--'}
                    </em>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: '6px' }}>
                    {!rows.length && (
                        <div style={{ color: 'var(--silver)', opacity: 0.6, fontSize: 'var(--text-micro, 0.6875rem)', padding: '10px' }}>
                            Start the draft to see the room as a running pick list.
                        </div>
                    )}
                    {rows.map(row => {
                        const pick = row.pick;
                        const slot = row.slot || {};
                        const rosterId = String(pick?.rosterId || slot.rosterId || '');
                        const isUser = pick?.isUser || (userRosterId && rosterId === userRosterId);
                        const isCurrent = row.kind === 'current' || Number(slot.overall) === Number(currentOverall);
                        const pos = pick?.pos || '';
                        const posCol = posColors[pos] || 'var(--gold)';
                        // Queue a trade for a not-yet-made pick owned by a CPU: opens the
                        // Trade Desk targeting that team with this pick preselected on the
                        // "you get" side.
                        const canQueue = !!onPropose && (row.kind === 'upcoming' || row.kind === 'current') && rosterId && rosterId !== userRosterId;
                        return (
                            <div key={row.key} style={{
                                display: 'grid',
                                gridTemplateColumns: '48px minmax(0, 0.85fr) minmax(0, 1.35fr) 36px 54px 26px',
                                gap: '7px',
                                alignItems: 'center',
                                minHeight: 34,
                                padding: '5px 7px',
                                borderRadius: '6px',
                                border: '1px solid ' + (isCurrent ? 'var(--acc-line2, rgba(212,175,55,0.34))' : isUser ? 'var(--acc-fill3, rgba(212,175,55,0.18))' : 'var(--ov-3, rgba(255,255,255,0.04))'),
                                background: isCurrent ? 'var(--acc-fill2, rgba(212,175,55,0.09))' : isUser ? 'var(--acc-fill1, rgba(212,175,55,0.045))' : 'var(--ov-1, rgba(255,255,255,0.012))',
                                marginBottom: 4,
                            }}>
                                <span style={{ color: isCurrent || isUser ? 'var(--gold)' : 'var(--silver)', fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800 }}>
                                    {row.label}
                                </span>
                                <span style={{ color: isUser ? 'var(--gold)' : 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {ownerName(slot, pick)}
                                </span>
                                <span style={{ color: pick ? 'var(--white)' : isCurrent ? 'var(--gold)' : 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: pick ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {pick ? pick.name : (isCurrent ? 'On clock' : 'Upcoming')}
                                </span>
                                <span style={{ color: pick ? posCol : 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textAlign: 'center' }}>
                                    {pos || '--'}
                                </span>
	                                <span style={{ color: pick ? 'var(--gold)' : 'var(--silver)', opacity: pick || slot.value ? 1 : 0.5, fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'right' }}>
	                                    {pick ? fmt(pick.dhq) : (slot.value ? fmt(slot.value) : '#' + (slot.overall || '--'))}
	                                </span>
                                {canQueue ? (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onPropose(rosterId, { theirGive: [slot] }); }}
                                        title={'Queue a trade for ' + ownerName(slot, pick) + "'s " + row.label + ' pick'}
                                        style={{
                                            width: 24, height: 24, minWidth: 24, padding: 0,
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            background: 'transparent',
                                            border: '1px solid var(--acc-line1, rgba(212,175,55,0.3))',
                                            borderRadius: '4px', color: 'var(--gold)',
                                            fontSize: '0.72rem', cursor: 'pointer', lineHeight: 1,
                                        }}
                                    >⇄</button>
                                ) : <span />}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    function mockFmt(value) {
        const n = Number(value || 0);
        if (!n) return '0';
        return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
    }

    function mockPickLabel(slot, leagueSize) {
        if (!slot) return '--';
        return 'R' + (slot.round || '?') + '.' + String(pickInRoundOf(slot, leagueSize) || 0).padStart(2, '0');
    }

    function mockPlayerTeam(player) {
        return player?.nflTeam || player?.team || player?.csv?.nflTeam || player?.p?.team || 'FA';
    }

    function mockPlayerSchool(player) {
        return player?.school || player?.college || player?.csv?.college || player?.p?.college || player?.p?.metadata?.college || 'School TBD';
    }

    function mockPlayerPhoto(player) {
        if (!player) return '';
        return player.photoUrl || player.avatar || player.p?.avatar || (player.pid ? 'https://sleepercdn.com/content/nfl/players/thumb/' + player.pid + '.jpg' : '');
    }

    function mockInitials(name) {
        return String(name || '?')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0])
            .join('')
            .toUpperCase() || '?';
    }

    function mockTeamName(state, rosterId, slot) {
        const rid = String(rosterId || '');
        if (rid && state.personas?.[rid]?.teamName) return state.personas[rid].teamName;
        if (rid && String(rid) === String(state.userRosterId || '')) {
            return slot?.ownerName || state.userTeamName || 'Our Team';
        }
        return slot?.ownerName || (slot?.slot ? 'Team ' + slot.slot : 'Draft Room');
    }

    function mockOpenPlayer(player) {
        if (!player?.pid) return;
        if (typeof window.openPlayerModal === 'function' && !player.isCSV) {
            try { window.openPlayerModal(player.pid); return; } catch (_) {}
        }
        if (typeof window.WR?.openPlayerCard === 'function') {
            try { window.WR.openPlayerCard(player.pid); } catch (_) {}
        }
    }

    function _mockRunText(state) {
        const counts = {};
        (state.picks || []).slice(-8).forEach(p => {
            const pos = p.pos || '?';
            counts[pos] = (counts[pos] || 0) + 1;
        });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (!top) return 'No run yet';
        return top[0] + ' run started: ' + top[1] + ' ' + top[0] + ' in last 8 picks';
    }

    function mockRunReport(state) {
        const countByPos = rows => {
            const counts = {};
            rows.forEach(p => {
                const pos = p.pos || '?';
                counts[pos] = (counts[pos] || 0) + 1;
            });
            return Object.entries(counts).sort((a, b) => b[1] - a[1]);
        };
        const last8 = countByPos((state.picks || []).slice(-8));
        const last16 = countByPos((state.picks || []).slice(-16));
        const upcoming = countByPos((state.pool || []).slice(0, 18));
        const top = last8[0];
        const next = upcoming.slice(0, 3).map(([pos, count]) => pos + ' x' + count);
        const second = last16.slice(0, 3).map(([pos, count]) => pos + ' x' + count);
        return {
            value: top ? top[0] + ' run: ' + top[1] + ' in last 8' : 'No run yet',
            // Raw counts only — no "AI expects" prediction phrasing (free-reachable tile).
            detail: next.length ? 'Top of remaining board: ' + next.join(', ') : 'Waiting on more board movement',
            bullets: [
                second.length ? 'Last 16: ' + second.join(', ') : 'Last 16: not enough picks',
                next.length ? 'Upcoming board: ' + next.join(', ') : 'Upcoming board: flat',
            ],
        };
    }

    function mockMakePick(dispatch, state, isUserTurn, player) {
        if (!player) return;
        const canPick = isUserTurn || state.overrideMode || state.mode === 'manual';
        if (!canPick) {
            mockOpenPlayer(player);
            return;
        }
        dispatch({
            type: 'MAKE_PICK',
            player,
            isUser: isUserTurn,
            reasoning: state.overrideMode
                ? { primary: 'User override', baseVal: player.dhq, nudges: [] }
                : state.mode === 'manual'
                    ? { primary: 'Manual room entry', baseVal: player.dhq, nudges: [] }
                    : { primary: 'User selection', baseVal: player.dhq, nudges: [] },
            confidence: 1.0,
            source: state.mode === 'manual' ? 'manual-draft' : null,
        });
    }

    function mockBuildCounterProposal(state, offer) {
        const targetRosterId = offer.fromRosterId;
        const proposal = {
            targetRosterId,
            myGive: [...(offer.myGive || [])],
            theirGive: [...(offer.theirGive || [])],
            myGivePlayers: [...(offer.myGivePlayers || [])],
            theirGivePlayers: [...(offer.theirGivePlayers || [])],
            myGiveFaab: offer.myGiveFaab || 0,
            theirGiveFaab: offer.theirGiveFaab || 0,
        };
        const sim = window.DraftCC?.tradeSimulator;
        const key = p => [p?.round, p?.teamIdx, p?.slot].join(':');
        const usedTheirPicks = new Set((proposal.theirGive || []).map(key));
        const targetPicks = (state.pickOrder || [])
            .slice(state.currentIdx || 0)
            .filter(p => String(p?.rosterId) === String(targetRosterId) && !usedTheirPicks.has(key(p)))
            .sort((a, b) => (sim?.pickValueFor?.(state, a) || 0) - (sim?.pickValueFor?.(state, b) || 0));
        if (targetPicks[0]) {
            proposal.theirGive = [...proposal.theirGive, targetPicks[0]];
            return proposal;
        }
        if ((proposal.myGive || []).length > 1) {
            const byValue = proposal.myGive.slice().sort((a, b) => (sim?.pickValueFor?.(state, a) || 0) - (sim?.pickValueFor?.(state, b) || 0));
            const removeKey = key(byValue[0]);
            proposal.myGive = proposal.myGive.filter(p => key(p) !== removeKey);
            return proposal;
        }
        proposal.theirGiveFaab = Math.max(Number(proposal.theirGiveFaab || 0) + 25, 25);
        return proposal;
    }

    function mockCounterCommentary(evaluation, round, maxRounds) {
        if (evaluation?.accepted) return 'That is closer. I can accept that counter.';
        const read = window.DraftCC?.tradeSimulator?.negotiationReadFor
            ? window.DraftCC.tradeSimulator.negotiationReadFor(evaluation, { finalRound: round >= maxRounds })
            : evaluation?.negotiationRead;
        if (read?.message) return read.message;
        if (round >= maxRounds) return "Come on, that's weak. I need more than that, so I'm moving on.";
        if ((evaluation?.likelihood || 0) >= (evaluation?.counterLine || 50)) return "You're in the neighborhood, but I still need a sweetener to move this pick.";
        return "I would counter. They are light. Ask for the next clean pick or keep the board.";
    }

    function mockAssetText(picks, playerIds, faab, leagueSize) {
        const items = [];
        (picks || []).slice(0, 3).forEach(p => items.push(mockPickLabel(p, leagueSize)));
        (playerIds || []).slice(0, 2).forEach(pid => items.push(formatTradeAssetPlayer(pid)));
        if (Number(faab || 0) > 0) items.push('$' + faab + ' FAAB');
        return items.length ? items.join(' + ') : 'No assets';
    }

    function MockTradeOfferPanel({ state, dispatch }) {
        const offer = state.activeOffer;
        // Belt-and-suspenders: offer GENERATION is Pro-gated, but a draft persisted
        // mid-negotiation by a Pro/trial session resumes with the persona dialogue
        // (likelihood %, psych reads) live. Free never renders it — auto-decline so
        // the paused room resumes.
        const offerIsPro = ccIsPro();
        React.useEffect(() => {
            if (offer && !offerIsPro) dispatch({ type: 'DECLINE_TRADE' });
        }, [offer, offerIsPro, dispatch]);
        if (!offer || !offerIsPro) return null;
        const round = Number(offer.negotiationRound || 0);
        const maxRounds = Number(offer.maxNegotiationRounds || 3);
        const counterClosed = !!offer.counterClosed || round >= maxRounds;
        const onCounter = () => {
            if (counterClosed) return;
            const sim = window.DraftCC?.tradeSimulator;
            if (!sim?.evaluateUserProposal || !sim?.offerShape) return;
            const nextRound = round + 1;
            const proposal = mockBuildCounterProposal(state, offer);
            const evaluation = sim.evaluateUserProposal(state, proposal);
            const commentary = mockCounterCommentary(evaluation, nextRound, maxRounds);
            if (evaluation.accepted) {
                const acceptedOffer = sim.offerShape(state, proposal, evaluation, commentary, {
                    countered: true,
                    negotiationRound: nextRound,
                    maxNegotiationRounds: maxRounds,
                    resumeSpeed: offer.resumeSpeed,
                    cpuMessage: 'Fine, that clears my line. I can live with it.',
                });
                dispatch({ type: 'ACCEPT_TRADE', offer: acceptedOffer });
                return;
            }
            if (nextRound >= maxRounds) {
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'rule',
                        badge: 'T',
                        color: 'var(--k-e74c3c, #e74c3c)',
                        title: 'Trade talks broke off',
                        text: commentary,
                        relatedPickNo: state.pickOrder?.[state.currentIdx]?.overall || null,
                    },
                });
                dispatch({ type: 'DECLINE_TRADE' });
                return;
            }
            const nextOffer = evaluation.counterOffer || sim.offerShape(state, proposal, evaluation, commentary, { countered: true });
            dispatch({
                type: 'UPDATE_ACTIVE_TRADE',
                offer: {
                    ...nextOffer,
                    negotiationRound: nextRound,
                    maxNegotiationRounds: maxRounds,
                    resumeSpeed: offer.resumeSpeed,
                    cpuMessage: commentary,
                    counterClosed: false,
                },
            });
        };
        const give = mockAssetText(offer.myGive, offer.myGivePlayers, offer.myGiveFaab, state.leagueSize);
        const get = mockAssetText(offer.theirGive, offer.theirGivePlayers, offer.theirGiveFaab, state.leagueSize);
        return (
            <section className="mock-trade-card">
                <div className="mock-panel-head">
                    <span>Trade Offer Paused</span>
                    <em>Round {Math.min(round + 1, maxRounds)} of {maxRounds}</em>
                </div>
                <div className="mock-trade-body">
                    <div>
                        <strong>{offer.fromName || 'Opponent'} wants the pick</strong>
                        <span>You give {give}; you get {get}</span>
                    </div>
                    <b>{offer.likelihood || 0}%</b>
                </div>
                <div className="mock-alex-note">
                    <strong>Alex</strong>
                    <span>{offer.cpuMessage || offer.negotiationRead?.message || offer.reason || "I would counter. They are light. Ask for one more pick or keep the board."}</span>
                </div>
                <div className="mock-trade-actions">
                    <button className="is-accept" type="button" onClick={() => dispatch({ type: 'ACCEPT_TRADE', offer })}>Accept</button>
                    <button className="is-counter" type="button" onClick={onCounter} disabled={counterClosed}>Counter</button>
                    <button className="is-decline" type="button" onClick={() => dispatch({ type: 'DECLINE_TRADE' })}>Decline</button>
                </div>
            </section>
        );
    }

    function MockBigBoardTable({ state, dispatch, isUserTurn }) {
        const [search, setSearch] = React.useState('');
        const [posFilter, setPosFilter] = React.useState('');
        const [sortKey, setSortKey] = React.useState('board');
        const [sortDir, setSortDir] = React.useState(-1);
        const boardContext = state.draftContext?.boardContext || {};
        const isRedraftBoard = state.variant === 'redraft' || state.draftContext?.draftType === 'redraft' || state.draftContext?.leagueFormat?.draftType === 'redraft';
        // Free tier: the AI Recommended lane is a strategy-optimizer ranked board →
        // Pro (mirror draft-room.js). Clamp any persisted 'ai' lane back to raw DHQ.
        const boardIsPro = ccIsPro();
        const laneChoices = boardIsPro ? ['dhq', 'ai', 'my'] : ['dhq', 'my'];
        const initialLane = laneChoices.includes(boardContext.activeLane) ? boardContext.activeLane : 'dhq';
        const [boardLane, setBoardLane] = React.useState(initialLane);
        const posColors = window.App?.POS_COLORS || {};
        const normPos = window.App?.normPos || (p => p);
        const canPick = isUserTurn || state.overrideMode || state.mode === 'manual';
        const boardLaneMeta = {
            dhq: { label: 'Default Board', detail: 'DHQ value' },
            ai: { label: 'AI Recommended', detail: 'GM strategy' },
            my: { label: 'User Board', detail: 'manual order' },
        };
        const positions = React.useMemo(() => {
            const set = new Set();
            const addPos = raw => {
                const upper = String(raw || '').toUpperCase();
                if (!upper || ['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'FLEX', 'WRRB_FLEX', 'WRRBTE_FLEX', 'REC_FLEX', 'SUPER_FLEX', 'OP'].includes(upper)) return;
                const pos = upper === 'D/ST' || upper === 'DST' ? 'DEF' : (normPos(upper) || upper);
                if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(pos)) set.add(pos);
            };
            (state.pool || []).forEach(p => addPos(p.pos || p.position));
            (state.draftContext?.leagueFormat?.activeRosterSlots || state.draftContext?.leagueFormat?.rosterSlots || []).forEach(addPos);
            if (isRedraftBoard && !set.has('DEF')) set.add('DEF');
            const order = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6, DL: 7, LB: 8, DB: 9 };
            const base = Array.from(set).sort((a, b) => (order[a] || 99) - (order[b] || 99));
            // League-derived flex groups (FLEX/SFLEX/IDP FLEX…) as extra chips
            // when their positions exist on this board (owner ask 2026-07-12).
            const groups = (window.App?.getLeagueFlexGroups?.() || [])
                .filter(g => (window.App?.FLEX_GROUP_POSITIONS?.[g] || []).some(pos => set.has(pos)));
            return [...base, ...groups];
        }, [state.pool, state.draftContext?.leagueFormat, isRedraftBoard]);
        const lanePool = React.useMemo(() => {
            const pool = state.pool || [];
            const laneOrder = boardContext?.lanes?.[boardLane]?.order || [];
            if (!laneOrder.length) return pool.map((p, idx) => ({ ...p, boardRank: idx + 1 }));
            const byId = new Map();
            pool.forEach(p => {
                if (p?.pid) byId.set(String(p.pid), p);
                if (p?.csvPid) byId.set(String(p.csvPid), p);
            });
            const seen = new Set();
            const ordered = [];
            laneOrder.forEach(pid => {
                const player = byId.get(String(pid));
                if (!player || seen.has(String(player.pid))) return;
                seen.add(String(player.pid));
                ordered.push(player);
            });
            pool.forEach(player => {
                if (!seen.has(String(player.pid))) ordered.push(player);
            });
            return ordered.map((p, idx) => ({ ...p, boardRank: idx + 1 }));
        }, [state.pool, boardContext, boardLane]);
        const rows = React.useMemo(() => {
            const q = search.trim().toLowerCase();
            return lanePool.filter(p => {
                const rowPos = normPos(p.pos || p.position) || p.pos || p.position || '';
                // Group-aware: posFilter may be a flex-group key (FLEX/SFLEX/…)
                if (posFilter && !(window.App?.posMatchesFilter ? window.App.posMatchesFilter(rowPos, posFilter) : rowPos === posFilter)) return false;
                if (!q) return true;
                const hay = [p.name, p.pos, mockPlayerTeam(p), mockPlayerSchool(p)].join(' ').toLowerCase();
                return hay.includes(q);
            }).sort((a, b) => {
                if (sortKey === 'dhq') return sortDir * ((a.dhq || 0) - (b.dhq || 0));
                if (sortKey === 'fit') return sortDir * ((a.fit?.score || 0) - (b.fit?.score || 0));
                if (sortKey === 'tier') return sortDir * ((a.tier || a.csv?.tier || 99) - (b.tier || b.csv?.tier || 99));
                if (sortKey === 'rank') return sortDir * ((a.boardRank || 9999) - (b.boardRank || 9999));
                if (sortKey === 'name') return sortDir * String(a.name || '').localeCompare(String(b.name || ''));
                if (sortKey === 'pos') return sortDir * String(a.pos || '').localeCompare(String(b.pos || ''));
                if (sortKey === 'team') return sortDir * String(mockPlayerTeam(a)).localeCompare(String(mockPlayerTeam(b)));
                if (sortKey === 'school') return sortDir * String(mockPlayerSchool(a)).localeCompare(String(mockPlayerSchool(b)));
                return a.boardRank - b.boardRank;
            }).slice(0, 72);
        }, [lanePool, search, posFilter, sortKey, sortDir]);
        const setHeaderSort = key => {
            setSortKey(prev => {
                if (prev === key) {
                    setSortDir(dir => dir * -1);
                    return prev;
                }
                setSortDir(['rank', 'name', 'pos', 'team', 'school', 'tier'].includes(key) ? 1 : -1);
                return key;
            });
        };
        const sortArrow = key => sortKey === key ? (sortDir === -1 ? ' ▼' : ' ▲') : '';
        const headerCell = (label, key) => (
            <button type="button" className="mock-board-sort" onClick={() => setHeaderSort(key)} title={'Sort by ' + label}>
                {label}{sortArrow(key)}
            </button>
        );
        const boardGridStyle = {
            gridTemplateColumns: isRedraftBoard
                ? '28px minmax(0,1.52fr) 28px 36px 42px 30px 30px 40px'
                : undefined,
        };
        return (
            <section className="mock-panel mock-big-board">
                <div className="mock-panel-head">
                    <span>Big Board</span>
                    <em>{(state.pool || []).length} available · {boardLaneMeta[boardLane]?.detail}</em>
                </div>
                <div className="mock-board-lanes">
                    {['dhq', 'ai', 'my'].map(lane => (
                        lane === 'ai' && !boardIsPro ? (
                            <button key={lane} type="button" title="The AI Recommended board is Scout Pro" onClick={() => { if (window.showProLaunchPage) window.showProLaunchPage(); else if (window.showUpgradePrompt) window.showUpgradePrompt('draft_ai_board'); }}>
                                <strong>{'🔒 AI Recommended'}</strong>
                                <span>Scout Pro</span>
                            </button>
                        ) : (
                            <button key={lane} type="button" className={boardLane === lane ? 'is-active' : ''} onClick={() => { setBoardLane(lane); setSortKey('board'); }}>
                                <strong>{boardLaneMeta[lane].label}</strong>
                                <span>{boardLaneMeta[lane].detail}</span>
                            </button>
                        )
                    ))}
                </div>
                <div className="mock-board-tools">
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={isRedraftBoard ? 'Search players, teams...' : 'Search players, teams, colleges...'} />
                    <select value={sortKey} onChange={e => {
                        const key = e.target.value;
                        setSortKey(key);
                        setSortDir(['rank', 'name', 'pos', 'team', 'school', 'tier'].includes(key) ? 1 : -1);
                    }}>
                        <option value="board">Board</option>
                        <option value="rank">Rank</option>
                        <option value="name">Player</option>
                        <option value="dhq">DHQ</option>
                        <option value="fit">Fit</option>
                        <option value="tier">Tier</option>
                    </select>
                </div>
                <div className="mock-board-pos">
                    <button type="button" className={!posFilter ? 'is-active' : ''} onClick={() => setPosFilter('')}>All</button>
                    {positions.map(pos => (
                        <button key={pos} type="button" className={posFilter === pos ? 'is-active' : ''} style={{ '--pos-color': posColors[pos] || 'var(--gold)' }} onClick={() => setPosFilter(posFilter === pos ? '' : pos)}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</button>
                    ))}
                </div>
                <div className="mock-board-head" style={boardGridStyle}>
                    {headerCell('Rank', 'rank')}{headerCell('Player', 'name')}{headerCell('Pos', 'pos')}{headerCell('NFL', 'team')}{!isRedraftBoard && headerCell('School', 'school')}{headerCell('DHQ', 'dhq')}{headerCell('Fit', 'fit')}{headerCell('Tier', 'tier')}<span>Action</span>
                </div>
                <div className="mock-board-scroll">
                    {rows.map(player => {
                        const fitScore = player.fit?.score || player.fitScore || 0;
                        const tier = player.tier || player.csv?.tier || '—';
                        const displayPos = normPos(player.pos || player.position) || player.pos || player.position || '—';
                        const rowClass = 'mock-board-row' + (player.boardRank === 1 ? ' is-board-one' : '') + (player.boardRank <= 8 ? ' is-premium' : '');
                        return (
                            <div key={player.pid} className={rowClass} style={boardGridStyle} onClick={() => mockOpenPlayer(player)}>
                                <span className="mock-rank">{player.boardRank}</span>
                                <strong>{player.name}</strong>
                                <span style={{ color: posColors[displayPos] || 'var(--gold)' }}>{window.App?.posLabel?.(displayPos) || (displayPos === 'DEF' ? 'D/ST' : displayPos)}</span>
                                <span>{mockPlayerTeam(player)}</span>
                                {!isRedraftBoard && <span>{mockPlayerSchool(player)}</span>}
                                <span className="mock-dhq">{mockFmt(player.dhq)}</span>
                                <span className={fitScore >= 70 ? 'is-good' : fitScore >= 45 ? 'is-ok' : ''}>{fitScore ? fitScore : '—'}</span>
                                <span>{tier}</span>
                                <button type="button" onClick={e => { e.stopPropagation(); mockMakePick(dispatch, state, isUserTurn, player); }}>{canPick ? 'Draft' : 'Open'}</button>
                            </div>
                        );
                    })}
                    {!rows.length && <div className="mock-empty">No players match the current board filters.</div>}
                </div>
            </section>
        );
    }

    function MockDecisionDeck({ state, dispatch, isUserTurn, currentSlot, onOpenTradeDesk }) {
        const pool = state.pool || [];
        const isRedraftBoard = state.variant === 'redraft' || state.draftContext?.draftType === 'redraft' || state.draftContext?.leagueFormat?.draftType === 'redraft';
        const best = pool[0] || null;
        const safe = pool.find(p => Number(p.tier || p.csv?.tier || 99) <= 2 && p !== best) || pool[1] || best;
        const upside = pool.find(p => (p.fit?.score || 0) >= 55 && p !== best && p !== safe) || pool[2] || best;
        const slotLabel = mockPickLabel(currentSlot, state.leagueSize);
        const pickWhy = (player, lane) => {
            if (!player) return 'I am waiting on the board to load.';
            const pos = player.pos || 'this spot';
            const team = mockPlayerTeam(player);
            const school = mockPlayerSchool(player);
            const established = isRedraftBoard || Number(player.yearsExp ?? player.years_exp ?? 1) > 0;
            const valueBand = Number(player.dhq || 0) >= 7000 ? 'elite weekly anchor'
                : Number(player.dhq || 0) >= 4500 ? 'premium starter'
                    : Number(player.dhq || 0) >= 2200 ? 'lineup starter'
                        : 'depth value';
            const sd = 'pw:' + (player.pid || player.name) + ':' + lane;
            if (established) {
                if (lane === 'safe') return avPick(sd, [
                    player.name + ' is the stability play — a proven ' + pos + ' on ' + team + ', ' + valueBand + ' pricing, and a lot less projection risk than the names around him.',
                    'If you want the safe answer, it\'s ' + player.name + '. Established ' + pos + ' on ' + team + ', ' + valueBand + ', and you know what you\'re getting.',
                ]);
                if (lane === 'upside') return avPick(sd, [
                    player.name + ' isn\'t a generic dart — the ceiling is real NFL production plus spike-week access on ' + team + '. Take him when you want points you can bank on with a weekly hammer attached.',
                    'The swing here is ' + player.name + ': proven production on ' + team + ' with genuine spike weeks. That\'s upside with a floor.',
                ]);
                return avPick(sd, [
                    player.name + ' is my pick — the current-season value clears replacement at ' + pos + '. In redraft I\'m weighing role security, weekly ceiling, and how fast the next tier falls off.',
                    'I\'d take ' + player.name + '. He beats replacement at ' + pos + ' right now, and the role plus ceiling check the boxes that matter in redraft.',
                ]);
            }
            if (lane === 'safe') return avPick(sd, [
                'This is the low-variance call: clean ' + pos + ' value, solid capital, no need to chase a thinner pocket later.',
                'Safe and simple — ' + pos + ' value with real capital behind it. No reason to overthink it.',
            ]);
            if (lane === 'upside') return avPick(sd, [
                'This is the ceiling swing — ' + school + ' pedigree, ' + team + ' landing spot, and enough fit to justify the variance.',
                'If you want to dream, here\'s your shot: ' + school + ' profile into ' + team + '. The fit makes the risk worth it.',
            ]);
            return avPick(sd, [
                player.name + ' is my pick because the board value still lines up with our build — I\'m not taking him just because he\'s listed first.',
                'I\'ve got ' + player.name + ' here. It\'s a value-and-fit call, not just "next name up."',
            ]);
        };
        const tradeWindowText = currentSlot
            ? avPick('pw:trade:' + slotLabel, [
                'I\'d pick up the phone if someone overpays. Aim for a top-40 pick or better to move off ' + slotLabel + '.',
                'Open to moving ' + slotLabel + ' if the price is right — think top-40 pick or better.',
              ])
            : 'No active trade window yet.';
        const cards = [
            { key: 'rec', label: 'Recommended Pick', player: best, tone: 'var(--k-2ecc71, #2ecc71)', text: pickWhy(best, 'rec') },
            { key: 'safe', label: 'Safe Pick', player: safe, tone: 'var(--k-3498db, #3498db)', text: pickWhy(safe, 'safe') },
            { key: 'upside', label: 'Upside Swing', player: upside, tone: 'var(--k-9b8afb, #9b8afb)', text: pickWhy(upside, 'upside') },
            { key: 'trade', label: 'Trade Window', player: null, tone: 'var(--gold)', text: tradeWindowText },
        ];
        return (
            <section className="mock-panel mock-decision-deck">
                <div className="mock-panel-head">
                    <span>Alex Decision Deck</span>
                    <em>{currentSlot ? slotLabel : 'waiting'}</em>
                </div>
                <div className="mock-decision-grid">
                    {cards.map(card => {
                        const p = card.player;
                        const photo = mockPlayerPhoto(p);
                        return (
                            <button key={card.key} type="button" className="mock-decision-card" style={{ '--accent': card.tone }} onClick={() => card.key === 'trade' ? onOpenTradeDesk?.() : mockMakePick(dispatch, state, isUserTurn, p)} disabled={card.key === 'trade' && !onOpenTradeDesk}>
                                <span>{card.label}</span>
                                {p ? (
                                    <div className="mock-decision-player">
                                        {photo ? <img src={photo} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <i>{mockInitials(p.name)}</i>}
                                        <div>
                                            <strong>{p.name}</strong>
                                            <em>{p.pos || '—'} · {mockPlayerTeam(p)} · DHQ {mockFmt(p.dhq)}</em>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mock-decision-player is-trade">
                                        <i>⇄</i>
                                        <div>
                                            <strong>{currentSlot ? 'Value ' + slotLabel : 'No window'}</strong>
                                            <em>Market: {state.activeOffer ? 'Paused' : 'Open'}</em>
                                        </div>
                                    </div>
                                )}
                                <p>{card.text}</p>
                            </button>
                        );
                    })}
                </div>
            </section>
        );
    }

    function MockPickLog({ state, currentSlot }) {
        const posColors = window.App?.POS_COLORS || {};
        const order = state.pickOrder || [];
        const picks = state.picks || [];
        const visible = picks.slice(-10).reverse();
        return (
            <section className="mock-panel mock-pick-log">
                <div className="mock-panel-head">
                    <span>Pick Log</span>
                    <em>{picks.length} / {order.length || '--'}</em>
                </div>
                <div className="mock-log-scroll">
                    {currentSlot && (
                        <div className="mock-log-row is-current">
                            <span>{mockPickLabel(currentSlot, state.leagueSize)}</span>
                            <strong>{mockTeamName(state, currentSlot.rosterId, currentSlot)}</strong>
                            <em>On clock</em>
                            <b>#{currentSlot.overall || '--'}</b>
                        </div>
                    )}
                    {visible.map(pick => {
                        const slot = order[(Number(pick.overall) || 1) - 1] || pick;
                        const valueNote = pick.reachSteal?.label || pick.valueLabel || (pick.dhq ? 'Value' : 'Logged');
                        return (
                            <div key={pick.id || pick.overall + '-' + pick.pid} className="mock-log-row" onClick={() => mockOpenPlayer(pick)}>
                                <span>{mockPickLabel(pick, state.leagueSize)}</span>
                                <strong>{mockTeamName(state, pick.rosterId, slot)}</strong>
                                <em><i style={{ color: posColors[pick.pos] || 'var(--gold)' }}>{pick.pos || '--'}</i> {pick.name}</em>
                                <b>{mockFmt(pick.dhq)} <small>{valueNote}</small></b>
                            </div>
                        );
                    })}
                    {!visible.length && !currentSlot && <div className="mock-empty">Start the draft to see picks as a running list.</div>}
                </div>
            </section>
        );
    }

    function MockRosterBuildCard({ state, grade }) {
        const players = window.S?.players || {};
        const rosters = window.S?.rosters || [];
        const scores = window.App?.LI?.playerScores || {};
        const normPos = window.App?.normPos || (p => p);
        const posColors = window.App?.POS_COLORS || {};
        const myPicks = (state.picks || []).filter(p => p.rosterId === state.userRosterId || p.isUser);
        const baseRoster = rosters.find(r => String(r.roster_id) === String(state.userRosterId));
        const grouped = {};
        const ageFor = (player) => {
            const rawAge = Number(player?.age || player?.csv?.age || 0);
            if (rawAge) return rawAge;
            if (player?.birth_date) {
                const born = new Date(player.birth_date).getTime();
                if (Number.isFinite(born)) return Math.floor((Date.now() - born) / 31557600000);
            }
            return 0;
        };
        const ageLimit = pos => ({ RB: 26, WR: 29, TE: 30, QB: 33, K: 34, DL: 30, LB: 29, DB: 29 }[pos] || 29);
        const add = (pos, dhq, isPick, player) => {
            const p = normPos(pos) || pos || '?';
            if (!grouped[p]) grouped[p] = { count: 0, dhq: 0, picks: 0, ages: [], ageRisk: 0 };
            const age = ageFor(player);
            grouped[p].count += 1;
            grouped[p].dhq += Number(dhq || 0);
            if (age) {
                grouped[p].ages.push(age);
                if (age >= ageLimit(p)) grouped[p].ageRisk += 1;
            }
            if (isPick) grouped[p].picks += 1;
        };
        (baseRoster?.players || []).forEach(pid => {
            const p = players[pid] || {};
            add(p.position, scores[pid] || 0, false, p);
        });
        myPicks.forEach(p => add(p.pos, p.dhq || 0, true, p));
        const positionTargets = { QB: 2, RB: 5, WR: 7, TE: 3, K: 1, DEF: 1, DL: 4, LB: 4, DB: 4 };
        const ordered = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(pos => grouped[pos] || positionTargets[pos]);
        const totalDhq = Object.values(grouped).reduce((sum, row) => sum + row.dhq, 0);
        const draftDhq = myPicks.reduce((sum, p) => sum + Number(p.dhq || 0), 0);
        const maxDhq = Math.max(1, ...ordered.map(pos => grouped[pos]?.dhq || 0));
        const balanceScore = ordered.length
            ? Math.round(ordered.reduce((sum, pos) => {
                const row = grouped[pos] || { count: 0 };
                const target = positionTargets[pos] || 3;
                return sum + Math.min(1, row.count / target);
            }, 0) / ordered.length * 100)
            : 0;
        const leverageScore = Math.min(100, Math.round((draftDhq / Math.max(1, totalDhq || 1)) * 1000));
        const windowScore = Math.min(100, Math.round((totalDhq / 65000) * 100));
        const shapeRows = [
            { label: 'Contending Window', value: windowScore + '/100', pct: windowScore },
            { label: 'Roster Balance', value: balanceScore + '/100', pct: balanceScore },
            { label: 'Draft Leverage', value: leverageScore + '/100', pct: leverageScore },
        ];
        return (
            <section className="mock-panel mock-roster-card">
                <div className="mock-panel-head">
                    <span>My Roster Build</span>
                    <em>{myPicks.length} picks</em>
                </div>
                <div className="mock-roster-kpis">
                    <div><span>Roster DHQ</span><strong>{mockFmt(totalDhq)}</strong></div>
                    <div><span>Draft Added</span><strong>{mockFmt(draftDhq)}</strong></div>
                    {/* A–F grade is an interpretation → Pro; raw DHQ stays */}
                    <div><span>Draft Grade</span><strong>{ccIsPro() ? (grade?.letter || '--') : '🔒'}</strong><em>{ccIsPro() && grade?.letter ? mockFmt(grade.totalDHQ) + ' DHQ captured' : ccIsPro() ? 'pending' : 'Scout Pro'}</em></div>
                </div>
                <div className="mock-roster-section">Position Health</div>
                <div className="mock-roster-legend" title="Soft track shows player count against the target. Bright track shows DHQ value weight against your strongest position.">
                    <span><i /> roster count</span>
                    <span><b /> value weight</span>
                </div>
                <div className="mock-roster-matrix">
                    {ordered.map(pos => {
                        const row = grouped[pos] || { count: 0, dhq: 0, picks: 0, ages: [], ageRisk: 0 };
                        const target = positionTargets[pos] || 3;
                        const countPct = Math.min(100, Math.round((row.count / target) * 100));
                        const valuePct = Math.min(100, Math.round((row.dhq / maxDhq) * 100));
                        const avgAge = row.ages.length ? (row.ages.reduce((sum, age) => sum + age, 0) / row.ages.length).toFixed(1) : '--';
                        const status = row.count < target ? 'thin players' : row.dhq < maxDhq * 0.55 ? 'thin value' : row.ageRisk ? 'age watch' : 'stable';
                        return (
                            <div key={pos} className="mock-roster-cell" style={{ '--pos-color': posColors[pos] || 'var(--gold)' }}>
                                <header>
                                    <span>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</span>
                                    <strong>{row.count}/{target}</strong>
                                </header>
                                <div className="mock-roster-bars" title="Soft bar = roster count vs target. Bright bar = DHQ value weight against your strongest position.">
                                    <i style={{ width: countPct + '%' }} />
                                    <b style={{ width: valuePct + '%' }} />
                                </div>
                                <footer>
                                    <span>{mockFmt(row.dhq)} DHQ</span>
                                    <em>{status} · age {avgAge}</em>
                                </footer>
                            </div>
                        );
                    })}
                </div>
                <div className="mock-roster-section is-shape">Roster Shape</div>
                <div className="mock-shape-bars">
                    {shapeRows.map(row => (
                        <div key={row.label} className="mock-shape-row">
                            <span>{row.label}</span>
                            <div><i style={{ width: row.pct + '%' }} /></div>
                            <em>{row.value}</em>
                        </div>
                    ))}
                </div>
            </section>
        );
    }

    function MockDraftCockpit({ state, dispatch, isUserTurn, currentSlot, onExit, onPropose, tradeDeskTarget, openTradeDesk, grade, canUndoManualPick }) {
        const OpponentIntelPanel = window.DraftCC.OpponentIntelPanel;
        const totalPicks = state.pickOrder?.length || 0;
        const progress = totalPicks ? Math.round(((state.currentIdx || 0) / totalPicks) * 100) : 0;
        const lastPick = state.picks?.[state.picks.length - 1] || null;
        const runReport = mockRunReport(state);
        const nextUserSlot = (state.pickOrder || []).slice(state.currentIdx || 0).find(slot =>
            String(slot?.rosterId || '') === String(state.userRosterId || '')
            || Number(slot?.slot) === Number(state.userSlot)
        );
        const currentName = currentSlot ? mockTeamName(state, currentSlot.rosterId, currentSlot) : 'Draft Room';
        const currentDisplayName = currentName.length > 36 ? currentName.slice(0, 35) + '...' : currentName;
        const timerLabel = state.activeOffer ? 'Paused' : state.speed === 'paused' ? 'Paused' : state.speed === 'fast' ? '0:35' : state.speed === 'slow' ? '4:00' : '2:15';
        const statusTiles = [
            { label: 'On Clock', value: currentName, detail: currentSlot ? '#' + (currentSlot.overall || '--') + ' · ' + mockPickLabel(currentSlot, state.leagueSize) : 'No active pick' },
            { label: 'Our Next Pick', value: nextUserSlot ? mockPickLabel(nextUserSlot, state.leagueSize) : 'No pick left', detail: userPicksAwayDetail(nextUserSlot, state.currentIdx) },
            { label: 'Last Pick', value: lastPick ? lastPick.name : 'No picks yet', detail: lastPick ? (lastPick.pos || '--') + ' · DHQ ' + mockFmt(lastPick.dhq) : 'Start the draft' },
            { label: 'League Evolution', value: runReport.value, detail: state.activeOffer ? 'Draft paused for negotiation' : runReport.detail, extra: runReport.bullets },
        ];
        return (
            <div className="mock-draft-cockpit draft-cc-scope">
                <section className="mock-draftcast-rail">
                    <div className="mock-cast-brand">
                        <div>DHQ</div>
                        <span>
                            <strong>DRAFTCAST MOCK</strong>
                            <em>{state.variant === 'startup' ? 'Dynasty Start Up' : state.variant} · {state.draftType} · {state.rounds} rounds · {state.leagueSize} teams</em>
                            <button type="button" onClick={onExit}>Mock Upcoming Draft</button>
                        </span>
                    </div>
                    <div className="mock-cast-clock">
                        <span>{state.activeOffer ? 'TRADE OFFER PAUSED' : 'ON THE CLOCK'}</span>
                        <strong>{currentDisplayName} - Pick {currentSlot ? mockPickLabel(currentSlot, state.leagueSize).replace('R', '') : '--'}</strong>
                        <div><i style={{ width: progress + '%' }} /></div>
                        <em>{state.currentIdx || 0} / {totalPicks || '--'}</em>
                    </div>
                    <div className="mock-cast-controls">
                        <div><span>Pick Timer</span><strong>{timerLabel}</strong></div>
                        <button type="button" onClick={() => dispatch({ type: 'SET_SPEED', speed: state.speed === 'paused' ? 'medium' : 'paused' })}>{state.speed === 'paused' ? 'Resume' : 'Pause'}</button>
                        <label>Speed <select value={state.speed === 'paused' ? 'medium' : state.speed} onChange={e => dispatch({ type: 'SET_SPEED', speed: e.target.value })}><option value="slow">Slow</option><option value="medium">Medium</option><option value="fast">Fast</option></select></label>
                        <button type="button" onClick={openTradeDesk} disabled={!tradeDeskTarget}>Trade Desk</button>
                        {canUndoManualPick && <button type="button" onClick={() => dispatch({ type: 'UNDO_LAST_PICK', manualOnly: true })}>Undo</button>}
                        <button type="button" onClick={onExit}>Exit</button>
                    </div>
                    <div className="mock-status-row">
                        {statusTiles.map(tile => (
                            <div key={tile.label} className={tile.extra ? 'has-extra' : ''}>
                                <span>{tile.label}</span>
                                <strong>{tile.value}</strong>
                                <em>{tile.detail}</em>
                                {tile.extra && (
                                    <ul className="mock-status-list">
                                        {tile.extra.map(item => <li key={item}>{item}</li>)}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
                {state.scenarioNarrative && (
                    <div className="mock-scenario-strip">{state.scenarioNarrative}</div>
                )}
                <div className="mock-cockpit-grid">
                    <MockBigBoardTable state={state} dispatch={dispatch} isUserTurn={isUserTurn} />
                    <div className="mock-center-stack">
                        {/* "Take X" decision deck = the app picking for you → Pro (mirrors reconai _rbHero) */}
                        {ccIsPro() ? (
                            <MockDecisionDeck state={state} dispatch={dispatch} isUserTurn={isUserTurn} currentSlot={currentSlot} onOpenTradeDesk={openTradeDesk} />
                        ) : (
                            <section className="mock-panel mock-decision-deck">
                                <div className="mock-panel-head">
                                    <span>Alex Decision Deck</span>
                                    <em>Pro</em>
                                </div>
                                {window.WrGatedMoreRow
                                    ? React.createElement(window.WrGatedMoreRow, { title: 'Alex hands you the pick', sub: 'Recommended / safe / upside cards each turn are Scout Pro. Draft from the raw board.', feature: 'draft_decision_deck' })
                                    : <div dangerouslySetInnerHTML={{ __html: window.wrLockCard ? window.wrLockCard('Alex Decision Deck', 'draft_decision_deck', 'Per-turn pick recommendations are Scout Pro.') : '' }} />}
                            </section>
                        )}
                        <MockPickLog state={state} currentSlot={currentSlot} />
                    </div>
                    <div className={'mock-right-stack' + (state.activeOffer ? ' has-trade-offer' : '')}>
                        <MockRosterBuildCard state={state} grade={grade} />
                        <MockTradeOfferPanel state={state} dispatch={dispatch} />
                        {OpponentIntelPanel && (
                            <div className="mock-opponent-shell">
                                <OpponentIntelPanel state={state} dispatch={dispatch} currentSlot={currentSlot} onPropose={onPropose} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ── Drafting / complete grid ─────────────────────────────────────
    // ── DraftRecapReport — the post-draft report card ────────────────────
    // The full recap (grade hero, strategic readout, positional breakdown,
    // your draft class, around the league, team standings) rendered from a
    // RECAP OBJECT alone — works as the live post-draft modal body (the grid
    // passes the freshly built recap + live handlers) AND inline on the Draft
    // War Room from an archived recap (listDraftRecaps), no live state needed.
    // Exposed as window.DraftCC.DraftRecapReport.
    function DraftRecapReport({ recap, grade: gradeProp, myPicks: myPicksProp, userRosterId, inline, onPinTeam, onSaveRecap, onPrimary, primaryLabel }) {
        const stateHelpers = window.DraftCC?.state || {};
        const grade = gradeProp || recap?.grade || { letter: '', totalDHQ: Number(recap?.totalDHQ) || 0 };
        const myPicks = myPicksProp || recap?.picks || [];
        const PAD = inline ? '16px 14px' : '22px 32px';
                    // Build per-position summary from myPicks
                    const posSummary = {};
                    (myPicks || []).forEach(pk => {
                        const normalized = stateHelpers.normalizePickRecord ? stateHelpers.normalizePickRecord(pk) : pk;
                        const pos = (normalized?.pos || pk.player?.position || pk.pos || '').toUpperCase();
                        if (!pos) return;
                        if (!posSummary[pos]) posSummary[pos] = { count: 0, dhq: 0, players: [] };
                        posSummary[pos].count += 1;
                        posSummary[pos].dhq += (normalized?.dhq || pk.player?.dhq || pk.dhq || 0);
                        posSummary[pos].players.push(normalized?.name || pk.player?.full_name || pk.player?.name || pk.name || pk.pid);
                    });
                    const POS_ORDER = ['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
                    const orderedPositions = POS_ORDER.filter(p => posSummary[p]).concat(Object.keys(posSummary).filter(p => !POS_ORDER.includes(p)));

                    // Free recap keeps the raw haul (DHQ totals, rank, pick list,
                    // positional counts, trade volume); the A–F grade, efficiency
                    // read, best/reach/worst calls, storylines, and team grades/
                    // tiers are Pro. Neutral color for free so the border/hero
                    // tint doesn't leak the grade.
                    const recapPro = ccIsPro();
                    const gradeColor = !recapPro ? 'var(--silver)' : grade.letter.startsWith('A') ? 'var(--k-2ecc71, #2ecc71)' : grade.letter.startsWith('B') ? 'var(--k-d4af37, #d4af37)' : grade.letter.startsWith('C') ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
                    const teamRecaps = recap?.teamRecaps || [];
                    const leagueStorylines = recap?.leagueStorylines || [];
                    // Post-draft power/tier per team: existing roster health (assessTeam)
                    // blended with this draft's haul. Degrades gracefully if assessment
                    // globals aren't loaded (badge simply omitted).
                    const teamPower = (() => {
                        let assessments = [];
                        try { assessments = (typeof window.assessAllTeamsFromGlobal === 'function' ? window.assessAllTeamsFromGlobal() : []) || []; } catch (_) {}
                        const byRid = {};
                        assessments.forEach(a => { if (a && a.rosterId != null) byRid[String(a.rosterId)] = a; });
                        const maxHaul = Math.max(1, ...teamRecaps.map(t => t.totalDHQ || 0));
                        const out = {};
                        teamRecaps.forEach(t => {
                            const a = byRid[String(t.rosterId)] || {};
                            const health = Number(a.healthScore) || 0;
                            const haulPct = Math.round(((t.totalDHQ || 0) / maxHaul) * 100);
                            out[String(t.rosterId)] = { power: Math.round(health * 0.6 + haulPct * 0.4), tier: a.tier || null, tierColor: a.tierColor || null };
                        });
                        return out;
                    })();
                    const tradeImpact = recap?.tradeImpact || { count: 0, summary: 'No accepted draft trades on record.' };
                    const bestPick = recap?.bestPick || null;
                    const biggestReach = recap?.biggestReach || null;
                    const worstPick = recap?.worstPick || null;
                    const bestAlternative = recap?.bestAlternative || null;
                    const leagueExtremes = recap?.leagueExtremes || {};
                    const tradeVolume = recap?.tradeVolume || { total: 0, byRound: {} };
                    // Per-type efficiency (value vs expected pick).
                    const efficiency = recap?.efficiency ?? null;
                    const effPct = efficiency != null ? Math.round(efficiency * 100) : null;
                    const gradeBasis = recap?.gradeBasis || 'vs expected pick value';
                    const effColor = effPct == null ? 'var(--silver)' : effPct >= 100 ? 'var(--k-2ecc71, #2ecc71)' : effPct >= 85 ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
                    const recapPositions = recap?.positionSummary?.length
                        ? recap.positionSummary
                        : orderedPositions.map(pos => ({ pos, ...posSummary[pos] }));
                    const fmtDhq = value => {
                        const n = Number(value || 0);
                        return n ? n.toLocaleString() : '—';
                    };
                    const openRecapPlayer = pid => {
                        if (!pid) return;
                        if (typeof window.openPlayerModal === 'function') {
                            try { window.openPlayerModal(pid); return; } catch (_) {}
                        }
                        if (window.WR?.openPlayerCard) {
                            try { window.WR.openPlayerCard(pid); } catch (_) {}
                        }
                    };
                    const insightCard = (label, value, detail, color, onClick) => (
                        <button
                            type="button"
                            onClick={onClick}
                            disabled={!onClick}
                            style={{
                                textAlign: 'left',
                                padding: '12px 14px',
                                background: 'var(--ov-2, rgba(255,255,255,0.03))',
                                border: '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                                borderLeft: '3px solid ' + (color || 'var(--acc-line4, rgba(212,175,55,0.55))'),
                                borderRadius: '8px',
                                cursor: onClick ? 'pointer' : 'default',
                                fontFamily: FONT_UI,
                                minHeight: '92px',
                            }}
                        >
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.68, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
                            <div style={{ color: color || 'var(--white)', fontWeight: 800, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</div>
                            <div style={{ color: 'var(--silver)', opacity: 0.74, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.45, marginTop: '4px' }}>{detail || 'No signal yet.'}</div>
                        </button>
                    );

                    // League-wide percentile — how our total DHQ ranks
                    const allDraftTotals = recap?.leagueTotals || {};
                    const totals = Object.values(allDraftTotals).sort((a, b) => b - a);
                    const myRank = recap?.rank || (totals.indexOf(grade.totalDHQ) + 1);
                    const myPct = recap?.percentile ?? (totals.length ? Math.round(((totals.length - myRank) / Math.max(1, totals.length - 1)) * 100) : 0);

        return (
                            <div style={{
                                width: '100%', maxWidth: '1080px',
                                ...(inline ? {} : { maxHeight: '92vh', overflowY: 'auto', overscrollBehavior: 'contain', boxShadow: '0 32px 96px rgba(0,0,0,0.8)' }),
                                background: 'var(--k-0a0b0d, #0a0b0d)', border: (inline ? '1px' : '2px') + ' solid ' + wrAlpha(gradeColor, '55'),
                                borderRadius: '16px',
                            }}>
                                {/* Hero */}
                                <div style={{ padding: inline ? '20px 14px' : '28px 32px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', background: 'linear-gradient(135deg, ' + gradeColor + '15, transparent 70%)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '6px' }}>Draft Complete — Recap</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                        <div style={{ textAlign: 'center', flexShrink: 0 }}>
                                            <div style={{ fontFamily: FONT_DISPL, fontSize: '5.5rem', fontWeight: 700, color: gradeColor, lineHeight: 1 }}>{recapPro ? (grade.letter || '—') : '🔒'}</div>
                                            <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>{recapPro ? 'Overall Grade' : 'Grade — Scout Pro'}</div>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.7, lineHeight: 1.45 }}>Grade weighs board value, roster fit, and value vs your expected slots.</div>
                                            <div style={{ fontSize: '0.96rem', color: 'var(--white)', marginTop: '8px', lineHeight: 1.5 }}>
                                                Total DHQ: <strong style={{ color: gradeColor }}>{grade.totalDHQ.toLocaleString()}</strong> across {myPicks.length} pick{myPicks.length === 1 ? '' : 's'}
                                            </div>
                                            {totals.length >= 3 && (
                                                <div style={{ fontSize: '0.82rem', color: 'var(--silver)', marginTop: '4px' }}>
                                                    You finished <strong style={{ color: myRank <= 3 ? 'var(--k-2ecc71, #2ecc71)' : myRank <= totals.length / 2 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' }}>#{myRank}</strong> of {totals.length} teams by draft DHQ ({myPct}th percentile)
                                                </div>
                                            )}
                                        </div>
                                        {recapPro && effPct != null && (
                                            <div style={{ textAlign: 'center', flexShrink: 0, padding: '12px 18px', borderRadius: '12px', background: wrAlpha(effColor, '12'), border: '1px solid ' + wrAlpha(effColor, '40'), minWidth: '128px' }}>
                                                <div style={{ fontFamily: FONT_DISPL, fontSize: '2.6rem', fontWeight: 700, color: effColor, lineHeight: 1 }}>{effPct}%</div>
                                                <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '4px' }}>{gradeBasis === 'vs $ spent' ? <>of expected value<br/>for your spend</> : <>of expected DHQ<br/>for your slots</>}</div>
                                                <div style={{ fontSize: '0.6rem', color: effColor, opacity: 0.9, marginTop: '4px', fontWeight: 700 }}>{effPct >= 100 ? 'NAILED YOUR SLOTS' : effPct >= 85 ? 'SOLID FOR YOUR SLOTS' : 'LEFT VALUE ON BOARD'}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* P4 strategic readout */}
                                <div style={{ padding: PAD, borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Strategic Readout</div>
                                    {/* best/reach/worst/alternative calls are grade reads → Pro */}
                                    {!recapPro ? (
                                        window.WrGatedMoreRow
                                            ? React.createElement(window.WrGatedMoreRow, { title: 'Best pick, biggest reach, worst pick', sub: 'The value calls behind your grade are Scout Pro.', feature: 'draft_recap_reads' })
                                            : <div dangerouslySetInnerHTML={{ __html: window.wrLockCard ? window.wrLockCard('Strategic Readout', 'draft_recap_reads', 'Post-draft value calls are Scout Pro.') : '' }} />
                                    ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
                                        {insightCard(
                                            'Best Pick',
                                            bestPick ? `${bestPick.name} #${bestPick.overall}` : 'No pick',
                                            bestPick ? `${bestPick.pos || '?'} · ${fmtDhq(bestPick.dhq)} DHQ${bestPick.valueDelta > 0 ? ' · +' + bestPick.valueDelta + ' value slots' : ''}` : 'Make a pick to generate a value read.',
                                            'var(--k-2ecc71, #2ecc71)',
                                            bestPick?.pid ? () => openRecapPlayer(bestPick.pid) : null
                                        )}
                                        {insightCard(
                                            'Biggest Reach',
                                            biggestReach ? `${biggestReach.name} #${biggestReach.overall}` : 'None flagged',
                                            biggestReach ? `${Math.abs(biggestReach.valueDelta || 0)} slots ahead of board. Check if your note justified the bet.` : 'No user pick was far enough off board to flag.',
                                            biggestReach ? 'var(--k-f0a500, #f0a500)' : 'var(--silver)',
                                            biggestReach?.pid ? () => openRecapPlayer(biggestReach.pid) : null
                                        )}
                                        {insightCard(
                                            'Worst Pick',
                                            worstPick ? `${worstPick.name} #${worstPick.overall}` : 'No picks',
                                            worstPick ? `${worstPick.pos || '?'} · ${fmtDhq(worstPick.dhq)} DHQ${worstPick.efficiency != null ? ' · ' + Math.round(worstPick.efficiency * 100) + '% of expected' : ''}` : 'Make a pick to surface your lowest-value selection.',
                                            worstPick ? 'var(--k-e74c3c, #e74c3c)' : 'var(--silver)',
                                            worstPick?.pid ? () => openRecapPlayer(worstPick.pid) : null
                                        )}
                                        {insightCard(
                                            'Best Alternative',
                                            bestAlternative?.alternative ? bestAlternative.alternative.name : 'No better DHQ miss',
                                            bestAlternative?.message || 'Your selections did not leave a higher-DHQ player behind at the same slot.',
                                            bestAlternative?.alternative ? 'var(--k-3498db, #3498db)' : 'var(--silver)',
                                            bestAlternative?.alternative?.pid ? () => openRecapPlayer(bestAlternative.alternative.pid) : null
                                        )}
                                        {insightCard(
                                            'Trade Impact',
                                            tradeImpact.count ? `${tradeImpact.netDHQ >= 0 ? '+' : ''}${fmtDhq(tradeImpact.netDHQ)} DHQ` : 'No trades',
                                            tradeImpact.summary,
                                            tradeImpact.netDHQ >= 0 ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-e74c3c, #e74c3c)',
                                            null
                                        )}
                                    </div>
                                    )}
                                </div>

                                {/* Per-position breakdown */}
                                <div style={{ padding: PAD, borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Positional Breakdown</div>
                                    {recapPositions.length ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                                            {recapPositions.map(s => {
                                                const pos = s.pos;
                                                const posCol = (window.App?.POS_COLORS || {})[pos] || 'var(--silver)';
                                                return <div key={pos} style={{ padding: '10px 12px', background: 'var(--ov-2, rgba(255,255,255,0.03))', borderRadius: '8px', borderLeft: '3px solid ' + posCol }}>
                                                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: posCol, letterSpacing: '0.04em' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</div>
                                                    <div style={{ fontFamily: FONT_DISPL, fontSize: '1.2rem', fontWeight: 700, color: 'var(--white)', marginTop: '2px' }}>{s.count}</div>
                                                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7 }}>{s.dhq.toLocaleString()} DHQ</div>
                                                </div>;
                                            })}
                                        </div>
                                    ) : <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6 }}>No picks on record.</div>}
                                </div>

                                {/* Pick-by-pick roster list */}
                                <div style={{ padding: PAD, borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Your Draft Class</div>
                                    {(myPicks || []).length ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {myPicks.map((pk, i) => {
                                                const normalized = stateHelpers.normalizePickRecord ? stateHelpers.normalizePickRecord(pk) : pk;
                                                const p = pk.player || {};
                                                const pos = (normalized?.pos || p.position || pk.pos || '').toUpperCase();
                                                const posCol = (window.App?.POS_COLORS || {})[pos] || 'var(--silver)';
                                                const dhq = normalized?.dhq || p.dhq || pk.dhq || 0;
                                                const dhqCol = dhq >= 7000 ? 'var(--k-2ecc71, #2ecc71)' : dhq >= 4000 ? 'var(--k-3498db, #3498db)' : 'var(--silver)';
                                                return <div
                                                    key={i}
                                                    onClick={() => openRecapPlayer(normalized?.pid || pk.pid)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '6px', background: 'var(--ov-1, rgba(255,255,255,0.02))', cursor: (normalized?.pid || pk.pid) ? 'pointer' : 'default' }}
                                                >
                                                    <span style={{ fontFamily: FONT_DISPL, fontSize: '0.72rem', color: 'var(--gold)', width: '48px' }}>
                                                        {pk.round && pk.pickInRound ? (pk.round + '.' + String(pk.pickInRound).padStart(2, '0')) : ('#' + (i + 1))}
                                                    </span>
                                                    <img src={'https://sleepercdn.com/content/nfl/players/thumb/' + pk.pid + '.jpg'} alt="" onError={e => e.target.style.display = 'none'} style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                                                    <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--white)', fontWeight: 600 }}>{normalized?.name || p.full_name || p.name || pk.name || pk.pid}</span>
                                                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: posCol, padding: '1px 6px', background: 'rgba(0,0,0,0.4)', borderRadius: '3px' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</span>
                                                    <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: '0.82rem', color: dhqCol, minWidth: '56px', textAlign: 'right' }}>{dhq > 0 ? dhq.toLocaleString() : '—'}</span>
                                                </div>;
                                            })}
                                        </div>
                                    ) : <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6 }}>No picks made.</div>}
                                </div>

                                {/* Around the league — extremes + draft-day trade volume */}
                                <div style={{ padding: PAD, borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Around the League</div>
                                    {/* league best/reach/worst calls → Pro; raw trade volume below stays */}
                                    {recapPro && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
                                        {insightCard(
                                            'League Best Pick',
                                            leagueExtremes.bestPick ? `${leagueExtremes.bestPick.name} #${leagueExtremes.bestPick.overall}` : '—',
                                            leagueExtremes.bestPick ? `${leagueExtremes.bestPick.teamName} · ${fmtDhq(leagueExtremes.bestPick.dhq)} DHQ` : 'No picks recorded.',
                                            'var(--k-2ecc71, #2ecc71)',
                                            leagueExtremes.bestPick?.pid ? () => openRecapPlayer(leagueExtremes.bestPick.pid) : null
                                        )}
                                        {(() => {
                                            // Only a negative delta is a genuine reach — guards
                                            // recaps saved before the aggregation-side filter.
                                            const reach = leagueExtremes.biggestReach && (leagueExtremes.biggestReach.valueDelta || 0) < 0
                                                ? leagueExtremes.biggestReach
                                                : null;
                                            return insightCard(
                                                'League Biggest Reach',
                                                reach ? `${reach.name} #${reach.overall}` : '—',
                                                reach ? `${reach.teamName} · ${Math.abs(reach.valueDelta || 0)} slots ahead of board` : 'None flagged.',
                                                'var(--k-f0a500, #f0a500)',
                                                reach?.pid ? () => openRecapPlayer(reach.pid) : null
                                            );
                                        })()}
                                        {insightCard(
                                            'League Worst Pick',
                                            leagueExtremes.worstPick ? `${leagueExtremes.worstPick.name} #${leagueExtremes.worstPick.overall}` : '—',
                                            leagueExtremes.worstPick ? `${leagueExtremes.worstPick.teamName} · ${fmtDhq(leagueExtremes.worstPick.dhq)} DHQ` : 'No picks recorded.',
                                            'var(--k-e74c3c, #e74c3c)',
                                            leagueExtremes.worstPick?.pid ? () => openRecapPlayer(leagueExtremes.worstPick.pid) : null
                                        )}
                                    </div>
                                    )}
                                    <div style={{ marginTop: '14px' }}>
                                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Draft-Day Trades — {tradeVolume.total} total</div>
                                        {tradeVolume.total > 0 ? (
                                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                {Object.keys(tradeVolume.byRound).sort((a, b) => Number(a) - Number(b)).map(r => (
                                                    <span key={r} style={{ padding: '5px 10px', borderRadius: '6px', background: 'var(--ov-2, rgba(255,255,255,0.03))', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)' }}>{Number(r) > 0 ? 'R' + r : 'Other'}: <strong style={{ color: 'var(--white)' }}>{tradeVolume.byRound[r]}</strong></span>
                                                ))}
                                            </div>
                                        ) : <div style={{ fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.6 }}>No pick trades during this draft.</div>}
                                    </div>
                                </div>

                                {/* League-wide recap — where teams stand after the draft */}
                                <div style={{ padding: PAD, borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Where Teams Stand After the Draft</div>
                                    {/* narrative storylines are reads → Pro */}
                                    {recapPro && leagueStorylines.length > 0 && (
                                        <div style={{ display: 'grid', gap: '6px', marginBottom: '12px' }}>
                                            {leagueStorylines.slice(0, 4).map((line, i) => (
                                                <div key={i} style={{ fontSize: '0.76rem', color: 'var(--silver)', lineHeight: 1.45, padding: '7px 10px', background: 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: '6px' }}>{line}</div>
                                            ))}
                                        </div>
                                    )}
                                    {teamRecaps.length ? (
                                        <div style={{ display: 'grid', gap: '6px' }}>
                                            {teamRecaps.slice(0, 12).map(team => {
                                                const isUser = String(team.rosterId) === String(userRosterId);
                                                const topPlayer = team.topPick || team.picks?.[0];
                                                const gradeCol = team.grade?.startsWith('A') ? 'var(--k-2ecc71, #2ecc71)' : team.grade?.startsWith('B') ? 'var(--gold)' : team.grade?.startsWith('C') ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
                                                return (
                                                    <div key={team.rosterId || team.teamName} style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: '36px minmax(0,1.35fr) 56px 86px minmax(0,1fr) 84px',
                                                        gap: '10px',
                                                        alignItems: 'center',
                                                        padding: '8px 10px',
                                                        borderRadius: '7px',
                                                        border: '1px solid ' + (isUser ? 'var(--acc-line2, rgba(212,175,55,0.28))' : 'var(--ov-4, rgba(255,255,255,0.06))'),
                                                        background: isUser ? 'var(--acc-fill1, rgba(212,175,55,0.07))' : 'var(--ov-1, rgba(255,255,255,0.022))',
                                                    }}>
                                                        <div style={{ color: isUser ? 'var(--gold)' : 'var(--silver)', fontFamily: FONT_MONO, fontSize: '0.72rem', fontWeight: 800 }}>#{team.rank}</div>
                                                        <button
                                                            type="button"
                                                            onClick={() => { if (onPinTeam) onPinTeam(team.rosterId); }}
                                                            style={{ minWidth: 0, padding: 0, border: 'none', background: 'transparent', color: 'var(--white)', textAlign: 'left', cursor: onPinTeam ? 'pointer' : 'default', fontFamily: FONT_UI }}
                                                            title={onPinTeam ? 'Pin this team in opponent intel' : undefined}
                                                        >
                                                            <div style={{ fontWeight: 800, fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                {team.teamName}
                                                                {/* competitive-tier badge is an assessment read → Pro (Open Q7 ruling) */}
                                                                {recapPro && teamPower[String(team.rosterId)]?.tier && <span style={{ marginLeft: '6px', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, color: teamPower[String(team.rosterId)].tierColor || 'var(--silver)' }}>{teamPower[String(team.rosterId)].tier}</span>}
                                                            </div>
                                                            <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.buildLabel}</div>
                                                        </button>
                                                        <div style={{ color: recapPro ? gradeCol : 'var(--silver)', fontFamily: FONT_DISPL, fontSize: '1rem', fontWeight: 900 }}>{recapPro ? team.grade : '🔒'}</div>
                                                        <div style={{ color: 'var(--silver)', fontSize: '0.7rem', fontFamily: FONT_MONO, textAlign: 'right' }}>{fmtDhq(team.totalDHQ)} DHQ</div>
                                                        <button
                                                            type="button"
                                                            onClick={() => topPlayer?.pid && openRecapPlayer(topPlayer.pid)}
                                                            disabled={!topPlayer?.pid}
                                                            style={{ minWidth: 0, padding: 0, border: 'none', background: 'transparent', color: topPlayer?.pid ? 'var(--gold)' : 'var(--silver)', textAlign: 'left', cursor: topPlayer?.pid ? 'pointer' : 'default', fontFamily: FONT_UI, fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                                        >
                                                            {topPlayer ? topPlayer.name : 'No top pick'}
                                                        </button>
                                                        <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'right' }}>
                                                            {team.steals?.length || 0} steal{team.steals?.length === 1 ? '' : 's'} · {team.reaches?.length || 0} reach{team.reaches?.length === 1 ? '' : 'es'}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6 }}>No league picks available for recap.</div>}
                                </div>

                                {/* Actions */}
                                <div style={{ padding: inline ? '14px 14px 18px' : '18px 32px 24px', display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                                    {onSaveRecap && <button onClick={onSaveRecap} style={{ padding: '10px 22px', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>SAVE RECAP</button>}
                                    {/* share/export text embeds the A–F grade + value calls → Pro
                                        (clean absence; save-to-archive above stays free) */}
                                    {recapPro && <button onClick={() => {
                                        try {
                                            const text = stateHelpers.formatDraftShareReport
                                                ? stateHelpers.formatDraftShareReport(recap)
                                                : stateHelpers.formatDraftRecapText?.(recap);
                                            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => alert('Share report copied.'));
                                            else alert('Clipboard unavailable in this browser.');
                                        } catch (e) { alert('Copy failed: ' + e.message); }
                                    }} style={{ padding: '10px 22px', background: 'var(--ov-3, rgba(255,255,255,0.035))', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.14))', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>COPY REPORT</button>}
                                    {recapPro && <button onClick={() => {
                                        try {
                                            const text = stateHelpers.formatDraftShareReport
                                                ? stateHelpers.formatDraftShareReport(recap)
                                                : stateHelpers.formatDraftRecapText
                                                    ? stateHelpers.formatDraftRecapText(recap)
                                                    : 'Draft Recap - ' + grade.letter;
                                            const blob = new Blob([text], { type: 'text/markdown' });
                                            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'draft-recap-' + Date.now() + '.md'; a.click(); URL.revokeObjectURL(url);
                                        } catch (e) { alert('Export failed: ' + e.message); }
                                    }} style={{ padding: '10px 22px', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.15))', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>EXPORT REPORT</button>}
                                    {onPrimary && <button onClick={onPrimary} style={{ padding: '10px 22px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>{primaryLabel || 'DONE'}</button>}
                                </div>
                            </div>
        );
    }


    function CommandCenterGrid({ state, dispatch, isUserTurn, currentSlot, onExit, viewport, onPropose, forcedMode, recapDismissed, onShowRecap, nextUpDraft, onOpenNextDraft }) {
        const L = DRAFT_CC_LAYOUT;
        // Filter by rosterId so post-trade ownership is respected. Memoized: gradeDraft
        // builds a Map over the ~600-entry originalPool and ran on every re-render.
        const myPicks = React.useMemo(
            () => state.picks.filter(p => p.rosterId === state.userRosterId || p.isUser),
            [state.picks, state.userRosterId]
        );
        const grade = React.useMemo(
            () => window.DraftCC.state.gradeDraft(myPicks, state.originalPool, {
                assessment: state.personas?.[state.userRosterId]?.assessment,
                variant: state.variant,
                leagueSize: state.leagueSize,
                rounds: state.rounds,
                budget: state.auctionBudget,
            }),
            [myPicks, state.originalPool, state.personas, state.userRosterId, state.variant, state.leagueSize, state.rounds, state.auctionBudget]
        );

        // Belt-and-suspenders: a draft persisted mid-negotiation by a Pro/trial
        // session resumes with the persona trade dialogue (likelihood %, psych
        // reads) live. Free never renders the modal — auto-decline so the room resumes.
        const tradeIsPro = ccIsPro();
        React.useEffect(() => {
            if (state.activeOffer && !tradeIsPro) dispatch({ type: 'DECLINE_TRADE' });
        }, [state.activeOffer, tradeIsPro, dispatch]);

        const BigBoardPanel = window.DraftCC.BigBoardPanel;
        const OpponentIntelPanel = window.DraftCC.OpponentIntelPanel;
        const AlexStreamPanel = window.DraftCC.AlexStreamPanel;
        const AskAnswerWindow = window.DraftCC.AskAnswerWindow;
        const AlexCall = window.DraftCC.AlexCall;
        const AlexEdgeGlow = window.DraftCC.AlexEdgeGlow;
        const TradeModal = window.DraftCC.TradeModal;
        const TradeProposer = window.DraftCC.TradeProposer;

        // Header styles
        const headerCss = {
            minHeight: '118px',
            display: 'flex',
            alignItems: 'stretch',
            gap: '12px',
            flexWrap: 'wrap',
            padding: '12px 14px',
            background: 'linear-gradient(90deg, var(--surf-solid, rgba(7,9,14,0.98)), var(--surf-solid, rgba(17,23,33,0.96)) 42%, var(--surf-solid, rgba(30,24,10,0.92)))',
            border: '1px solid var(--acc-line2, rgba(212,175,55,0.34))',
            borderRadius: '8px',
            marginBottom: (L.GRID_GAP) + 'px',
            boxShadow: 'inset 0 -1px 0 var(--ov-3, rgba(255,255,255,0.05)), 0 10px 26px rgba(0,0,0,0.24)',
        };

        const speedBtn = (v) => ({
            padding: '4px 10px',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--text-micro, 0.6875rem)',
            fontFamily: FONT_UI,
            fontWeight: 600,
            background: state.speed === v ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'transparent',
            color: state.speed === v ? 'var(--gold)' : 'var(--silver)',
            border: '1px solid ' + (state.speed === v ? 'var(--acc-line2, rgba(212,175,55,0.35))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
            borderRadius: 'var(--card-radius-sm)',
            cursor: 'pointer',
            textTransform: 'capitalize',
        });

        // Room Feed ⇄ Ask Alex seg for the stream cell (owner ask 2026-07-13:
        // phone crossover) — speedBtn's pill look at a compact height.
        const streamTabBtn = on => ({
            flex: 1,
            padding: '4px 10px',
            minHeight: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--text-micro, 0.6875rem)',
            fontFamily: FONT_UI,
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            background: on ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'transparent',
            color: on ? 'var(--gold)' : 'var(--silver)',
            border: '1px solid ' + (on ? 'var(--acc-line2, rgba(212,175,55,0.35))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
            borderRadius: 'var(--card-radius-sm)',
            cursor: 'pointer',
        });

        const liveTradeWindow = React.useMemo(() => {
            if (!ccIsPro()) return null; // sell-the-pick windows are likelihood reads → Pro
            if (state.mode !== 'live-sync' || state.phase !== 'drafting') return null;
            try {
                const windows = window.DraftCC.tradeSimulator?.buildLiveTradeWindows?.(state, { lookahead: 1, currentOnly: true }) || [];
                return windows[0] || null;
            } catch (e) {
                if (window.wrLog) window.wrLog('cc.liveTradeWindow', e);
                return null;
            }
        }, [state.mode, state.phase, state.currentIdx, state.pickOrder, state.personas, state.tradedAssets, state.draftTuning, state.picks.length, state.userRosterId]);

        const tradeDeskTarget = React.useMemo(() => {
            if (liveTradeWindow?.rosterId) return liveTradeWindow.rosterId;
            const userRosterId = String(state.userRosterId || '');
            if (currentSlot?.rosterId && String(currentSlot.rosterId) !== userRosterId) {
                return currentSlot.rosterId;
            }
            const upcoming = (state.pickOrder || [])
                .slice(state.currentIdx)
                .find(slot => slot?.rosterId && String(slot.rosterId) !== userRosterId);
            if (upcoming?.rosterId) return upcoming.rosterId;
            const personaId = Object.keys(state.personas || {}).find(rosterId => String(rosterId) !== userRosterId);
            return personaId || null;
        }, [currentSlot, liveTradeWindow, state.currentIdx, state.personas, state.pickOrder, state.userRosterId]);

        const liveDecisionDeck = React.useMemo(() => {
            if (state.mode !== 'live-sync' || state.phase !== 'drafting') return null;
            try {
                return window.DraftCC.liveDecisionEngine?.buildDecisionDeck?.(state, { tradeWindow: liveTradeWindow }) || null;
            } catch (e) {
                if (window.wrLog) window.wrLog('cc.liveDecisionDeck', e);
                return null;
            }
        }, [state.mode, state.phase, state.currentIdx, state.pool, state.pickOrder, state.draftContext, state.personas, state.draftedPids, state.userRosterId, liveTradeWindow]);

        const openTradeDesk = React.useCallback(() => {
            if (tradeDeskTarget) onPropose(tradeDeskTarget);
        }, [onPropose, tradeDeskTarget]);
        // Live league-wide A–F draft grades (overlay, toggled from the header).
        const [showLeagueGrades, setShowLeagueGrades] = React.useState(false);
        const LeagueGradesPanel = window.DraftCC.LeagueGradesPanel;
        // Stream cell toggle (owner ask 2026-07-13: phone crossover): 'feed' =
        // the phone Room Feed (default — Alex's takes are IN it), 'alex' = the
        // classic Alex stream panel with the ask-Alex input.
        const [streamTab, setStreamTab] = React.useState('feed');
        const learningSaveKeyRef = React.useRef('');
        React.useEffect(() => {
            const helpers = window.DraftCC?.state || {};
            if (state.phase !== 'complete' || !helpers.buildDraftRecap) return;
            const saveKey = [state.id, state.picks?.length || 0, grade.totalDHQ || 0].join(':');
            if (learningSaveKeyRef.current === saveKey) return;
            try {
                const recap = helpers.buildDraftRecap(state, { grade });
                // Learning loop — tunes the next draft's defaults.
                if (helpers.saveDraftLearning) {
                    helpers.saveDraftLearning(helpers.buildDraftRecap(state, {
                        grade,
                        id: 'learning_' + (state.id || Date.now()),
                    }));
                }
                // Archive auto-save (the 25-deep store listDraftRecaps reads) so a user
                // who hits DRAFT AGAIN without clicking SAVE doesn't lose the recap.
                if (helpers.archiveDraftRecap && recap?.leagueId) helpers.archiveDraftRecap(recap);
                // Fan out the post-draft protocol: the grade review (this modal) and the
                // dynasty UDFA craze (free-agency surface) both key off this one event.
                // The craze reads recap.postDraftMoves.waiverTargets as its seed; the
                // PostDraft module persists it cross-page (local + Supabase).
                try {
                    window.dispatchEvent(new CustomEvent('draft:closed', {
                        detail: { recap, leagueId: state.leagueId, season: state.season, variant: state.variant },
                    }));
                } catch (_) {}
                if (window.App?.PostDraft?.onDraftClosed) {
                    try { window.App.PostDraft.onDraftClosed(recap); } catch (_) {}
                }
                learningSaveKeyRef.current = saveKey;
            } catch (e) {
                if (window.wrLog) window.wrLog('cc.draftLearning', e);
            }
        }, [state.phase, state.id, state.picks?.length, grade.totalDHQ, grade.letter]);
        const lastPick = state.picks?.[state.picks.length - 1] || null;
        const canUndoManualPick = state.phase === 'drafting' && lastPick && (
            state.mode === 'manual' || lastPick.source === 'manual-live' || lastPick.source === 'manual-draft'
        );
        const pickLabelFor = slot => slot ? ('R' + (slot.round || '?') + '.' + String(pickInRoundOf(slot, state.leagueSize) || 0).padStart(2, '0')) : '--';
        const shortDhq = n => {
            const v = Number(n || 0);
            return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
        };
        const teamNameFor = (rosterId, slot) => {
            const rid = String(rosterId || '');
            if (rid && state.personas?.[rid]?.teamName) return state.personas[rid].teamName;
            if (rid && String(rid) === String(state.userRosterId || '')) return 'Your Team';
            return slot?.ownerName || (slot?.slot ? 'Team ' + slot.slot : 'Draft Room');
        };
        const nextUserSlot = (state.pickOrder || []).slice(state.currentIdx || 0).find(slot =>
            String(slot?.rosterId || '') === String(state.userRosterId || '')
            || (state.mode !== 'live-sync' && Number(slot?.slot) === Number(state.userSlot))
        );
        const trendText = (() => {
            const counts = {};
            (state.picks || []).slice(-12).forEach(p => {
                const pos = p.pos || '?';
                counts[pos] = (counts[pos] || 0) + 1;
            });
            const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
            return rows.length ? rows.map(([pos, count]) => pos + ' x' + count).join(' - ') : 'No run yet';
        })();
        const liveStatusText = state.activeOffer
            ? 'Paused for trade offer'
            : state.phase === 'drafting'
                ? (isUserTurn ? 'You are on the clock' : 'CPU room is moving')
                : state.phase === 'complete'
                    ? 'Draft complete'
                    : 'Draft setup';
        const currentTeamName = currentSlot ? teamNameFor(currentSlot.rosterId, currentSlot) : 'Draft Room';
        const currentPickLabel = currentSlot ? pickLabelFor(currentSlot) + ' - #' + (currentSlot.overall || '--') : 'No active pick';
        const liveConfidenceCard = (() => {
            if (state.mode !== 'live-sync') return null;
            const live = state.liveSync || {};
            const status = live.status || 'idle';
            const stale = !!(live.stale || live.remoteBehind || (live.missingPickNos || []).length);
            if (status === 'complete') {
                return { label: 'Sync confidence', value: 'Complete', detail: 'Sleeper draft is finished', tone: 'var(--gold)' };
            }
            if (stale || status === 'stale' || status === 'error') {
                return { label: 'Sync confidence', value: 'Review', detail: live.error || 'Sleeper feed needs reconciliation', tone: 'var(--k-e74c3c, #e74c3c)' };
            }
            if (status === 'mirroring') {
                return { label: 'Sync confidence', value: 'Healthy', detail: 'Last check ' + formatLiveClockTime(live.lastPollAt), tone: 'var(--k-2ecc71, #2ecc71)' };
            }
            if (status === 'waiting') {
                return { label: 'Sync confidence', value: 'Waiting', detail: 'Polling Sleeper for pick 1', tone: 'var(--k-f0a500, #f0a500)' };
            }
            return { label: 'Sync confidence', value: 'Connecting', detail: 'Preparing live mirror', tone: 'rgba(155,138,251,0.98)' };
        })();
        const baseStageSummaryCards = [
            {
                label: 'Your next pick',
                value: nextUserSlot ? pickLabelFor(nextUserSlot) : 'No pick left',
                detail: userPicksAwayDetail(nextUserSlot, state.currentIdx),
                tone: 'var(--k-2ecc71, #2ecc71)',
            },
            {
                label: 'Last pick',
                value: lastPick ? lastPick.name : 'No picks yet',
                detail: lastPick ? pickLabelFor(lastPick) + ' - ' + (lastPick.pos || '--') + ' - ' + shortDhq(lastPick.dhq || 0) + ' DHQ' : 'Start the draft',
                tone: 'var(--silver)',
            },
            {
                label: 'Room run',
                value: trendText,
                detail: liveStatusText,
                tone: 'rgba(155,138,251,0.98)',
            },
        ];
        // Sync confidence renders as a compact badge in the header (below), not as
        // a full tile — keeps the status row to the three substantive cards.
        const stageSummaryCards = baseStageSummaryCards;

        // Width-aware cockpit sizing. The global 'desktop' bucket only triggers at
        // 1440, so most laptops (1280-1439) were stuck in the 2-col collapse. Read the
        // live width from the shared WR.useViewport store (js/shared/viewport.js — one
        // debounced app-wide listener; replaces the old local winW resize state with
        // identical <1200 threshold semantics): give the rich 3-col layout to anything
        // >= 1200px, and below that a compact 2-col layout whose panel heights adapt
        // to the viewport (not fixed px).
        const isCompact = window.WR.useViewport().width < 1200;
        // Condensed "Split HUD" header replaces the strip + Alex Live Read + trade
        // window banner during a live draft only; other phases keep the full header.
        const isLiveDraftHud = state.mode === 'live-sync' && state.phase === 'drafting';

        if (state.mode !== 'live-sync' && state.phase === 'drafting') {
            return (
                <>
                    <MockDraftCockpit
                        state={state}
                        dispatch={dispatch}
                        isUserTurn={isUserTurn}
                        currentSlot={currentSlot}
                        onExit={onExit}
                        onPropose={onPropose}
                        tradeDeskTarget={tradeDeskTarget}
                        openTradeDesk={openTradeDesk}
                        grade={grade}
                        canUndoManualPick={canUndoManualPick}
                    />
                    {tradeIsPro && state.activeOffer && TradeModal && <TradeModal state={state} dispatch={dispatch} />}
                    {state.proposerDrawer && TradeProposer && <TradeProposer state={state} dispatch={dispatch} />}
                </>
            );
        }

        return (
            <div className="draft-cc-scope" style={{ fontFamily: FONT_UI, paddingBottom: '12px' }}>
                {isLiveDraftHud ? (
                    <LiveCommandHeader
                        state={state}
                        dispatch={dispatch}
                        isUserTurn={isUserTurn}
                        currentSlot={currentSlot}
                        currentTeamName={currentTeamName}
                        liveConfidenceCard={liveConfidenceCard}
                        stageSummaryCards={stageSummaryCards}
                        liveTradeWindow={liveTradeWindow}
                        ownerTell={(liveDecisionDeck?.alerts || []).find(a => a.type === 'owner_tendency') || null}
                        tradeDeskTarget={tradeDeskTarget}
                        openTradeDesk={openTradeDesk}
                        onExit={onExit}
                        onShowGrades={() => setShowLeagueGrades(true)}
                        canUndoManualPick={canUndoManualPick}
                        isCompact={isCompact}
                        layoutGap={L.GRID_GAP}
                    />
                ) : (
                <React.Fragment>
                {/* ── HEADER ───────────────────────────────────────── */}
                <div style={headerCss}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto minmax(110px, 1fr)',
                        gap: '10px',
                        alignItems: 'center',
                        minWidth: 210,
                        flex: '0 0 230px',
                    }}>
                        <div style={{
                            width: 44,
                            height: 44,
                            borderRadius: '7px',
                            display: 'grid',
                            placeItems: 'center',
                            background: 'var(--gold)',
                            color: 'var(--black)',
                            fontFamily: FONT_DISPL,
                            fontSize: '0.72rem',
                            fontWeight: 900,
                            letterSpacing: '0.08em',
                        }}>DHQ</div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: 'var(--gold)', fontFamily: FONT_DISPL, fontSize: '0.84rem', fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>DraftCast</div>
                            <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{state.mode} - {state.variant}</div>
                        </div>
                    </div>

                    <div style={{
                        minWidth: 240,
                        flex: '1 1 420px',
                        borderLeft: '4px solid var(--gold)',
                        padding: '7px 0 7px 14px',
                    }}>
                        <div style={{ color: state.activeOffer ? 'var(--k-f0a500, #f0a500)' : 'var(--gold)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                            {state.activeOffer ? 'Trade offer on deck' : 'On the clock'}
                        </div>
                        <div style={{ color: 'var(--white)', fontFamily: FONT_DISPL, fontSize: '1.62rem', fontWeight: 900, lineHeight: 1.02, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {currentTeamName}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem' }}>
                            <span style={{ color: 'var(--silver)', opacity: 0.76, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                {currentPickLabel} - {liveStatusText}
                            </span>
                            {liveConfidenceCard && (
                                <span title={liveConfidenceCard.label + ': ' + liveConfidenceCard.value + ' — ' + liveConfidenceCard.detail} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, color: liveConfidenceCard.tone, fontWeight: 800, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)' }}>{'●'}</span>{liveConfidenceCard.value}
                                </span>
                            )}
                        </div>
                        {/* ── Alex Whisper: latest take in the user's primary sightline. Reuses the
                            existing stream + shared HIGH_SIGNAL gate; no new window or panel. ──── */}
                        {state.phase === 'drafting' && (() => {
                            const HS = window.DraftCC.HIGH_SIGNAL_BADGES || new Set(['🔥', '⛰', '⬇']);
                            const DOTS = window.DraftCC.AnimatedDots;
                            const ALEX = 'var(--k-9b8afb, #9b8afb)';
                            const thinking = !!(state.alex && state.alex.thinking);
                            const feed = (state.alex && state.alex.stream) || [];
                            // On your turn, surface the most decision-relevant take; else the latest.
                            const DECISION = new Set(['✦', '⚖', '◇', 'A', '↑', '↓']);
                            const item = thinking ? null
                                : (isUserTurn ? (feed.find(e => DECISION.has(e.badge)) || feed[0]) : feed[0]);
                            if (!thinking && !item) {
                                return (
                                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONT_UI, fontSize: 'var(--text-micro, 0.6875rem)', color: ALEX, opacity: 0.5, fontStyle: 'italic' }}>
                                        <span style={{ fontWeight: 800, fontStyle: 'normal' }}>✦</span>Alex is watching the board…
                                    </div>
                                );
                            }
                            const isHigh = !thinking && HS.has(item.badge);
                            const accent = thinking ? ALEX : (item.color || ALEX);
                            return (
                                <div style={{
                                    marginTop: 6,
                                    display: 'flex',
                                    gap: 7,
                                    alignItems: 'flex-start',
                                    maxWidth: 540,
                                    padding: '4px 8px 4px 7px',
                                    borderRadius: 'var(--card-radius-sm, 6px)',
                                    borderLeft: '2px solid ' + wrAlpha(accent, isHigh ? 'cc' : '55'),
                                    background: isHigh ? wrAlpha(accent, '14') : wrAlpha(ALEX, '0a'),
                                }}>
                                    <span style={{ color: accent, fontWeight: 800, fontSize: 'var(--text-label, 0.75rem)', flexShrink: 0, marginTop: 1, width: 13, textAlign: 'center' }}>
                                        {thinking ? '✦' : item.badge}
                                    </span>
                                    <div style={{ minWidth: 0, flex: 1, fontFamily: FONT_UI }}>
                                        {thinking ? (
                                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: ALEX, fontStyle: 'italic' }}>
                                                Alex is reading the board{DOTS ? React.createElement(DOTS) : '…'}
                                            </div>
                                        ) : (
                                            <React.Fragment>
                                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    <span style={{ color: ALEX, fontWeight: 800, letterSpacing: '0.07em', marginRight: 6, fontSize: 'var(--text-micro, 0.6875rem)' }}>ALEX</span>
                                                    {(item.title || '').replace(/^Alex\s*[·:—-]?\s*/i, '') || item.title}
                                                </div>
                                                {item.text && (
                                                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.78, marginTop: 2, lineHeight: 1.4 }}>
                                                        {item.text}
                                                    </div>
                                                )}
                                            </React.Fragment>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
                        gap: '7px',
                        minWidth: 0,
                        flex: stageSummaryCards.length > 3 ? '1 1 560px' : '1 1 440px',
                    }}>
                        {stageSummaryCards.map(card => (
                            <div key={card.label} style={{
                                minWidth: 0,
                                border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))',
                                background: 'var(--ov-1, rgba(255,255,255,0.024))',
                                borderRadius: '7px',
                                padding: '8px 9px',
                            }}>
                                <div style={{ color: card.tone, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 3 }}>{card.label}</div>
                                <div style={{ color: 'var(--white)', fontSize: '0.76rem', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.value}</div>
                                <div style={{ color: 'var(--silver)', opacity: 0.66, fontSize: 'var(--text-micro, 0.6875rem)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.detail}</div>
                            </div>
                        ))}
                    </div>

                    {/* Progress */}
                    <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: '8px', minWidth: 180 }}>
                        <div style={{
                            flex: 1,
                            height: 4,
                            background: 'var(--ov-4, rgba(255,255,255,0.06))',
                            borderRadius: 2,
                            overflow: 'hidden',
                        }}>
                            <div style={{
                                width: Math.round((state.currentIdx / state.pickOrder.length) * 100) + '%',
                                height: '100%',
                                background: 'var(--gold)',
                                transition: 'width 0.4s ease',
                            }} />
                        </div>
                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', flexShrink: 0 }}>
                            {state.currentIdx} / {state.pickOrder.length}
                        </span>
                    </div>

                    {/* Grade live indicator */}
                    {myPicks.length > 0 && (
                        <div style={{
                            padding: '4px 10px',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.08))',
                            border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
                            borderRadius: '4px',
                            fontSize: 'var(--text-micro, 0.6875rem)',
                            fontWeight: 700,
                            color: 'var(--gold)',
                        }}>
                            {ccIsPro() ? grade.letter : '🔒'} · {grade.totalDHQ >= 1000 ? (grade.totalDHQ / 1000).toFixed(1) + 'k' : grade.totalDHQ} DHQ
                        </div>
                    )}

                    {/* Speed buttons */}
                    {state.phase === 'drafting' && state.mode !== 'live-sync' && state.mode !== 'manual' && (
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexShrink: 0 }}>
                            {['slow', 'medium', 'fast', 'paused'].map(v => (
                                <button key={v} onClick={() => dispatch({ type: 'SET_SPEED', speed: v })} style={speedBtn(v)}>
                                    {v === 'paused' ? '⏸' : v}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* League-wide A–F grades are interpretations → Pro (clean absence for free) */}
                    {state.phase === 'drafting' && ccIsPro() && (
                        <button
                            onClick={() => setShowLeagueGrades(true)}
                            title="Live A–F draft grades for every team"
                            style={{
                                padding: '5px 10px',
                                background: 'var(--ov-2, rgba(255,255,255,0.04))',
                                border: '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                                borderRadius: '4px',
                                color: 'var(--silver)',
                                cursor: 'pointer',
                                fontSize: 'var(--text-micro, 0.6875rem)',
                                fontFamily: FONT_UI,
                                flexShrink: 0,
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                            }}
                        >
                            🏆 LEAGUE GRADES
                        </button>
                    )}

                    {state.phase === 'drafting' && tradeDeskTarget && (
                        <button
                            onClick={openTradeDesk}
                            title="Open trade proposer"
                            style={{
                                padding: '5px 10px',
                                background: 'var(--acc-fill2, rgba(212,175,55,0.12))',
                                border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))',
                                borderRadius: '4px',
                                color: 'var(--gold)',
                                cursor: 'pointer',
                                fontSize: 'var(--text-micro, 0.6875rem)',
                                fontFamily: FONT_UI,
                                flexShrink: 0,
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                            }}
                        >
                            ⇄ TRADE
                        </button>
                    )}

                    {canUndoManualPick && (
                        <button
                            onClick={() => dispatch({ type: 'UNDO_LAST_PICK', manualOnly: true })}
                            title="Undo the last manual pick entry"
                            style={{
                                padding: '5px 10px',
                                background: 'rgba(155,138,251,0.12)',
                                border: '1px solid rgba(155,138,251,0.35)',
                                borderRadius: '4px',
                                color: 'rgba(214,208,255,0.98)',
                                cursor: 'pointer',
                                fontSize: 'var(--text-micro, 0.6875rem)',
                                fontFamily: FONT_UI,
                                flexShrink: 0,
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                            }}
                        >
                            UNDO PICK
                        </button>
                    )}

                    {/* Phase 5: Save template button */}
                    {myPicks.length > 0 && (
                        <button
                            onClick={() => {
                                const defaultName = 'Mock ' + new Date().toLocaleString();
                                const name = prompt('Template name:', defaultName);
                                if (!name) return;
                                const rec = window.DraftCC.persistence?.saveTemplate(state, name);
                                if (rec) {
                                    dispatch({
                                        type: 'ALEX_EVENT_ADD',
                                        event: {
                                            type: 'rule',
                                            badge: '💾',
                                            color: 'var(--k-2ecc71, #2ecc71)',
                                            title: 'Template saved',
                                            text: '"' + rec.name + '" · load later from the setup screen',
                                        },
                                    });
                                }
                            }}
                            title="Save this draft as a template"
                            style={{
                                padding: '5px 10px',
                                background: 'rgba(46,204,113,0.12)',
                                border: '1px solid rgba(46,204,113,0.3)',
                                borderRadius: '4px',
                                color: 'var(--k-2ecc71, #2ecc71)',
                                cursor: 'pointer',
                                fontSize: 'var(--text-micro, 0.6875rem)',
                                fontFamily: FONT_UI,
                                flexShrink: 0,
                                fontWeight: 600,
                            }}>💾 SAVE</button>
                    )}

                    {/* Phase 4: Export PNG button */}
                    {myPicks.length > 0 && (
                        <button
                            onClick={() => window.DraftCC.exports?.downloadDraftCard(state)}
                            title="Export pick card as PNG"
                            style={{
                                padding: '5px 10px',
                                background: 'rgba(124,107,248,0.12)',
                                border: '1px solid rgba(124,107,248,0.3)',
                                borderRadius: '4px',
                                color: 'rgba(155,138,251,0.9)',
                                cursor: 'pointer',
                                fontSize: 'var(--text-micro, 0.6875rem)',
                                fontFamily: FONT_UI,
                                flexShrink: 0,
                                fontWeight: 600,
                            }}>📥 EXPORT</button>
                    )}

                    <button onClick={onExit} style={{
                        padding: '5px 12px',
                        background: 'transparent',
                        border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                        borderRadius: '4px',
                        color: 'var(--silver)',
                        cursor: 'pointer',
                        fontSize: 'var(--text-micro, 0.6875rem)',
                        fontFamily: FONT_UI,
                        flexShrink: 0,
	                    }}>Exit</button>
	                </div>

                {state.mode === 'live-sync' ? (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: liveTradeWindow ? 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' : '1fr',
                        gap: L.GRID_GAP + 'px',
                        alignItems: 'stretch',
                        marginBottom: L.GRID_GAP + 'px',
                    }}>
	                    <LiveSyncCommandReadPanel
                            state={state}
                            liveSync={state.liveSync}
                            currentSlot={currentSlot}
                            nextUserSlot={nextUserSlot}
                            trendText={trendText}
                            dispatch={dispatch}
                            inline
                        />
                        <LiveTradeWindowBanner
                            tradeWindow={liveTradeWindow}
                            ownerTell={(liveDecisionDeck?.alerts || []).find(a => a.type === 'owner_tendency') || null}
                            onOpen={() => liveTradeWindow?.rosterId && onPropose(liveTradeWindow.rosterId)}
                            leagueSize={state.leagueSize}
                            inline
                        />
                    </div>
                ) : (
                    <LiveTradeWindowBanner
                        tradeWindow={liveTradeWindow}
                        ownerTell={(liveDecisionDeck?.alerts || []).find(a => a.type === 'owner_tendency') || null}
                        onOpen={() => liveTradeWindow?.rosterId && onPropose(liveTradeWindow.rosterId)}
                        leagueSize={state.leagueSize}
                        layoutGap={L.GRID_GAP}
                    />
                )}
                </React.Fragment>
                )}

                {state.mode === 'live-sync' && (state.stagedLiveOffers || []).length > 0 && (
                    <StagedLiveOffersPanel
                        offers={state.stagedLiveOffers || []}
                        sleeperDraftId={state.sleeperDraftId}
                        dispatch={dispatch}
                        layoutGap={L.GRID_GAP}
                    />
                )}

                {state.mode === 'live-sync' && liveDecisionDeck && (
                    <LiveDecisionDeckPanel
                        deck={liveDecisionDeck}
                        onTrade={openTradeDesk}
                        layoutGap={L.GRID_GAP}
                    />
                )}

                {/* Phase 5: Scenario / Ghost replay narrative banner */}
                {state.scenarioNarrative && state.mode !== 'live-sync' && (
                    <div style={{
                        padding: '8px 14px',
                        marginBottom: L.GRID_GAP + 'px',
                        background: 'linear-gradient(90deg, var(--acc-fill3, rgba(212,175,55,0.15)), var(--acc-fill1, rgba(212,175,55,0.02)))',
                        border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        color: 'var(--gold)',
                        fontWeight: 600,
                        fontFamily: FONT_UI,
                    }}>
                        {state.scenarioNarrative}
                    </div>
                )}

                {/* Phase 5: Ghost replay scrubber */}
                {state.mode === 'ghost' && state.replay && (
                    <div style={{
                        padding: '10px 14px',
                        marginBottom: L.GRID_GAP + 'px',
                        background: 'rgba(124,107,248,0.05)',
                        border: '1px solid rgba(124,107,248,0.3)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        fontFamily: FONT_UI,
                    }}>
                        <span style={{ fontSize: '1rem' }}>👻</span>
                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'rgba(155,138,251,0.9)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Ghost Replay
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={state.replay.totalPicks}
                            value={state.currentIdx}
                            onChange={e => dispatch({ type: 'REPLAY_SEEK', idx: parseInt(e.target.value) })}
                            style={{ flex: 1, cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: FONT_MONO, minWidth: 60, textAlign: 'right' }}>
                            {state.currentIdx} / {state.replay.totalPicks}
                        </span>
                    </div>
                )}

                {/* ── TOP ROW: Big Board / Roster Build / Opponent Intel ───── */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: isCompact ? '1fr 1fr' : 'minmax(0, 1.5fr) minmax(300px, 0.72fr) minmax(320px, 0.82fr)',
                    gap: L.GRID_GAP + 'px',
                    height: isCompact ? 'auto' : 'clamp(520px, 58vh, 680px)',
                    marginBottom: L.GRID_GAP + 'px',
                }}>
                    <div style={{ minHeight: isCompact ? 'clamp(420px, 50vh, 560px)' : '100%', minWidth: 0 }}>
                        <BigBoardPanel state={state} dispatch={dispatch} isUserTurn={isUserTurn} />
                    </div>
                    <div style={{ minHeight: isCompact ? 'clamp(420px, 50vh, 560px)' : '100%', minWidth: 0 }}>
                        <MyDraftRosterPanel state={state} />
                    </div>
                    {!isCompact && (
                        <div style={{ minHeight: '100%', minWidth: 0 }}>
                            <OpponentIntelPanel state={state} dispatch={dispatch} currentSlot={currentSlot} onPropose={onPropose} />
                        </div>
                    )}
                </div>

                {/* ── BOTTOM ROW: Pick List / Alex Stream ───── */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: isCompact
                        ? '1fr 1fr'
                        : 'minmax(0, 1.1fr) minmax(340px, 0.9fr)',
                    gap: L.GRID_GAP + 'px',
                    height: isCompact ? 'auto' : 'clamp(440px, 44vh, 600px)',
                }}>
                    {isCompact && (
                        <div style={{ minHeight: 'clamp(220px, 24vh, 300px)', minWidth: 0 }}>
                            <OpponentIntelPanel state={state} dispatch={dispatch} currentSlot={currentSlot} onPropose={onPropose} />
                        </div>
                    )}
	                    <div style={{ minHeight: isCompact ? 'clamp(240px, 26vh, 320px)' : '100%', minWidth: 0 }}>
	                        <DraftPickListPanel state={state} currentSlot={currentSlot} onPropose={onPropose} />
                    </div>
                    <div style={{ minHeight: isCompact ? 'clamp(240px, 26vh, 320px)' : '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {/* Room Feed ⇄ Ask Alex (owner ask 2026-07-13: phone crossover):
                            default = the phone room feed (Alex's commentary is IN it);
                            Ask Alex keeps the stream panel + input exactly as before. */}
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            {[['feed', 'Room Feed'], ['alex', 'Ask Alex']].map(([k, l]) => (
                                <button key={k} type="button" onClick={() => setStreamTab(k)} style={streamTabBtn(streamTab === k)}>{l}</button>
                            ))}
                        </div>
                        <div style={{ flex: 1, minHeight: 0 }}>
                            {streamTab === 'feed'
                                ? (
                                    <div style={panelCard({ height: '100%', display: 'flex', flexDirection: 'column', padding: '10px 12px', fontFamily: FONT_UI, overflow: 'hidden' })}>
                                        <DraftRoomFeed state={state} heightStyle={{ flex: 1, minHeight: 0 }} />
                                    </div>
                                )
                                : <AlexStreamPanel state={state} dispatch={dispatch} />}
                        </div>
                    </div>
                </div>

                {/* Floating "Ask Alex" answer window — opened by action buttons (fixed-position) */}
                {AskAnswerWindow && <AskAnswerWindow state={state} />}

                {/* Alex Call — cinematic lower-third; transient, fires on high-signal moments + your turn */}
                {AlexCall && <AlexCall state={state} isUserTurn={isUserTurn} />}

                {/* Alex edge-glow — peripheral bloom on high-signal moments + on-clock breathing */}
                {AlexEdgeGlow && <AlexEdgeGlow state={state} isUserTurn={isUserTurn} />}

                {/* Phase 3: CPU trade offer modal (fixed-position) */}
                {tradeIsPro && state.activeOffer && TradeModal && <TradeModal state={state} dispatch={dispatch} />}

                {/* Phase 3: User trade proposer drawer (fixed-position) */}
                {state.proposerDrawer && TradeProposer && <TradeProposer state={state} dispatch={dispatch} />}

                {/* Live league-wide draft grades overlay (toggled from header) */}
                {showLeagueGrades && LeagueGradesPanel && ccIsPro() && (
                    <LeagueGradesPanel state={state} onClose={() => setShowLeagueGrades(false)} />
                )}

                {/* Phase 7: Post-draft recap — full-screen modal with grade + per-position + roster + export */}
                {state.phase === 'complete' && !recapDismissed && (() => {
                    const stateHelpers = window.DraftCC?.state || {};
                    const recap = stateHelpers.buildDraftRecap
                        ? stateHelpers.buildDraftRecap(state, { grade })
                        : null;
                    // Overlay shell only — the report card itself is the shared
                    // DraftRecapReport (also rendered inline on the Draft War Room
                    // post-draft from the archived recap).
                    return (
                        <div style={{
                            position: 'fixed', inset: 0, background: 'var(--surf-solid, rgba(5,6,9,0.82))',
                            zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: 'var(--space-xl)', animation: 'wrFadeIn 0.2s ease'
                        }} onClick={e => { if (e.target === e.currentTarget) onExit && onExit(); }}>
                            <DraftRecapReport
                                recap={recap}
                                grade={grade}
                                myPicks={myPicks}
                                userRosterId={state.userRosterId}
                                onPinTeam={rid => dispatch({ type: 'PIN_TEAM', rosterId: rid })}
                                onSaveRecap={() => {
                                    try {
                                        const key = 'wr_draft_recap_' + Date.now();
                                        const payload = stateHelpers.saveDraftRecap
                                            ? stateHelpers.saveDraftRecap(state, { grade, key })
                                            : recap;
                                        if (!payload) localStorage.setItem(key, JSON.stringify(recap || {}));
                                        alert('Draft recap saved to archive (' + key + ')');
                                    } catch (e) { alert('Save failed: ' + e.message); }
                                }}
                                primaryLabel={forcedMode === 'live-sync' ? 'VIEW DRAFT BOARD →' : 'DRAFT AGAIN'}
                                onPrimary={onExit}
                            />
                        </div>
                    );
                })()}

                {/* Memorialized live draft: recap dismissed → floating reopen button */}
                {state.phase === 'complete' && recapDismissed && (
                    <button type="button" onClick={onShowRecap} title="Reopen the draft recap"
                        style={{ position: 'fixed', right: '20px', bottom: 'calc(20px + var(--wr-bottom-inset, 0px))', zIndex: 850, padding: '11px 18px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '999px', fontFamily: FONT_DISPL, fontWeight: 800, fontSize: '0.84rem', letterSpacing: '0.04em', cursor: 'pointer', boxShadow: '0 8px 28px rgba(0,0,0,0.5)' }}>
                        📋 VIEW RECAP
                    </button>
                )}
                {/* Memorialized board + another draft on deck → explicit handover.
                    Archives this board to Draft History and opens the next room. */}
                {state.phase === 'complete' && recapDismissed && nextUpDraft && (
                    <button type="button" onClick={onOpenNextDraft}
                        title="Move this draft to Draft History and open the next draft's room"
                        style={{ position: 'fixed', right: '20px', bottom: 'calc(72px + var(--wr-bottom-inset, 0px))', zIndex: 850, padding: '11px 18px', background: 'var(--ink, #101418)', color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', borderRadius: '999px', fontFamily: FONT_DISPL, fontWeight: 800, fontSize: '0.84rem', letterSpacing: '0.04em', cursor: 'pointer', boxShadow: '0 8px 28px rgba(0,0,0,0.5)' }}>
                        {nextUpDraft.status === 'drafting' ? '🔴 NEXT DRAFT IS LIVE — OPEN ROOM' : '⏭ OPEN NEXT DRAFT ROOM'}
                    </button>
                )}
            </div>
        );
    }

    // ── Condensed live-draft header ("Split HUD"): one card the height of the
    //    DraftCast strip. LEFT = status (brand, on-the-clock team, chips, progress
    //    + actions). RIGHT = Alex's reads (latest take, predicted-available, outlier
    //    trade-up, trade window). Absorbs the old header strip + Alex Live Read panel
    //    + Current Pick Trade Window banner for live-sync drafting only.
    function LiveCommandHeader({
        state, dispatch, isUserTurn,
        currentSlot, currentTeamName, liveConfidenceCard,
        stageSummaryCards, liveTradeWindow, ownerTell,
        tradeDeskTarget, openTradeDesk, onExit, onShowGrades,
        canUndoManualPick, isCompact, layoutGap,
    }) {
        const GOLD = 'var(--gold)';
        const ALEX = 'var(--k-9b8afb, #9b8afb)';
        const AVAIL = '#5dade2';
        const currentPersona = currentSlot ? state.personas?.[String(currentSlot.rosterId)] : null;
        const teamAvatarUrl = currentPersona?.avatar ? 'https://sleepercdn.com/avatars/thumbs/' + currentPersona.avatar : '';
        const pickMeta = currentSlot
            ? 'R' + (currentSlot.round || '?') + '.' + String(pickInRoundOf(currentSlot, state.leagueSize) || 0).padStart(2, '0') + ' · #' + (currentSlot.overall || '--')
            : 'No active pick';
        const onClockLabel = state.activeOffer ? 'Trade offer on deck' : 'On the clock';

        // Alex Live Read: who is likely available at the user's next pick + an outlier worth trading up for.
        const readout = (state.activeOffer || typeof window.DraftCC?.liveDecisionEngine?.buildLiveReadout !== 'function')
            ? null
            : window.DraftCC.liveDecisionEngine.buildLiveReadout(state);

        // Read 1 — latest decision-relevant Alex take (reuses the stream's high-signal gate).
        const alexThinking = !!(state.alex && state.alex.thinking);
        const alexFeed = (state.alex && state.alex.stream) || [];
        const DECISION = new Set(['✦', '⚖', '◇', 'A', '↑', '↓']);
        const alexItem = alexThinking ? null
            : (isUserTurn ? (alexFeed.find(e => DECISION.has(e.badge)) || alexFeed[0]) : alexFeed[0]);

        const btn = (bg, color, border) => ({
            padding: '6px 11px', borderRadius: 6, fontSize: 'var(--text-micro, 0.6875rem)',
            fontFamily: FONT_UI, fontWeight: 800, letterSpacing: '0.04em', cursor: 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0, background: bg, color, border: '1px solid ' + border,
        });
        const readRow = { display: 'flex', gap: 7, alignItems: 'flex-start' };
        const readIcon = accent => ({ flexShrink: 0, width: 15, textAlign: 'center', fontSize: '0.78rem', marginTop: 1, color: accent });
        const readLabel = accent => ({ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em', color: accent });
        const readText = { color: 'var(--silver)', opacity: 0.85, fontSize: '0.72rem', lineHeight: 1.32 };
        // Keep each read to 2 lines so the card stays at DraftCast-strip height even
        // when Alex's copy runs long.
        const clamp2 = { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' };

        return (
            <div style={{
                display: 'grid',
                gridTemplateColumns: isCompact ? '1fr' : 'minmax(0,1.18fr) minmax(340px,0.9fr)',
                minHeight: 158,
                border: '1px solid var(--acc-line2, rgba(212,175,55,0.34))',
                borderRadius: 10,
                overflow: 'hidden',
                marginBottom: (layoutGap || 8) + 'px',
                background: 'linear-gradient(90deg, rgba(7,9,14,0.98), rgba(17,23,33,0.96) 46%, rgba(30,24,10,0.92))',
                boxShadow: 'inset 0 -1px 0 var(--ov-3, rgba(255,255,255,0.05)), 0 12px 30px rgba(0,0,0,0.3)',
                fontFamily: FONT_UI,
            }}>
                {/* LEFT — status */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '13px 16px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 7, display: 'grid', placeItems: 'center', background: GOLD, color: 'var(--black)', fontFamily: FONT_DISPL, fontWeight: 900, fontSize: '0.72rem', letterSpacing: '0.06em', flexShrink: 0 }}>DHQ</div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: GOLD, fontFamily: FONT_DISPL, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '0.8rem', lineHeight: 1 }}>DraftCast</div>
                            <div style={{ color: 'var(--silver)', opacity: 0.72, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.09em', fontSize: 'var(--text-micro, 0.6875rem)', marginTop: 3 }}>{state.mode} · {state.variant}</div>
                        </div>
                        <div style={{ borderLeft: '3px solid ' + GOLD, paddingLeft: 12, marginLeft: 8, flex: 1, minWidth: 0, marginTop: -6 }}>
                            <div style={{ color: state.activeOffer ? 'var(--k-f0a500, #f0a500)' : GOLD, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{onClockLabel}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                                <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 30% 25%, #4a4368, #221d34 70%)', border: '1px solid rgba(155,138,251,0.55)', color: '#d6d0ff', fontFamily: FONT_DISPL, fontWeight: 900, fontSize: '1rem', overflow: 'hidden' }}>
                                    {teamAvatarUrl
                                        ? <img src={teamAvatarUrl} alt="" onError={e => { e.target.style.display = 'none'; }} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : mockInitials(currentTeamName)}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ color: 'var(--white)', fontFamily: FONT_DISPL, fontSize: '1.42rem', fontWeight: 900, lineHeight: 1.04, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTeamName}</div>
                                    <div style={{ color: 'var(--silver)', opacity: 0.78, fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ whiteSpace: 'nowrap' }}>{pickMeta}</span>
                                        {liveConfidenceCard && (
                                            <span title={liveConfidenceCard.label + ': ' + liveConfidenceCard.value + ' — ' + liveConfidenceCard.detail} style={{ color: liveConfidenceCard.tone, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 3, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
                                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)' }}>{'●'}</span>{liveConfidenceCard.value}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 7 }}>
                        {stageSummaryCards.map(card => (
                            <div key={card.label} style={{ flex: 1, minWidth: 0, border: '1px solid var(--acc-fill3, rgba(212,175,55,0.16))', background: 'var(--ov-1, rgba(255,255,255,0.024))', borderRadius: 6, padding: '6px 8px' }}>
                                <div style={{ color: card.tone, fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 800 }}>{card.label}</div>
                                <div style={{ color: 'var(--white)', fontWeight: 800, fontSize: '0.74rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.value}</div>
                                {card.label !== 'Room run' && card.detail && (
                                    <div style={{ color: 'var(--silver)', opacity: 0.6, fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.detail}</div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 'auto' }}>
                        <div style={{ flex: 1, minWidth: 0, height: 4, background: 'var(--ov-4, rgba(255,255,255,0.07))', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: Math.round((state.currentIdx / Math.max(1, state.pickOrder.length)) * 100) + '%', background: GOLD, transition: 'width 0.4s ease' }} />
                        </div>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', flexShrink: 0 }}>{state.currentIdx} / {state.pickOrder.length}</span>
                        <button onClick={() => dispatch({ type: 'SET_OVERRIDE', enabled: !state.overrideMode })} title={state.overrideMode ? 'Return to read-only Sleeper mirror' : 'Apply the next pick manually from the Big Board'} style={btn(state.overrideMode ? 'rgba(155,138,251,0.22)' : 'rgba(155,138,251,0.16)', '#d6d0ff', 'rgba(155,138,251,0.45)')}>
                            {state.overrideMode ? 'MANUAL ON' : '✎ Manual Pick'}
                        </button>
                        {ccIsPro() && <button onClick={onShowGrades} title="Live A–F draft grades for every team" style={btn('var(--ov-2, rgba(255,255,255,0.04))', 'var(--silver)', 'var(--ov-6, rgba(255,255,255,0.12))')}>{'🏆 Grades'}</button>}
                        {canUndoManualPick && (
                            <button onClick={() => dispatch({ type: 'UNDO_LAST_PICK', manualOnly: true })} title="Undo the last manual pick entry" style={btn('rgba(155,138,251,0.12)', '#d6d0ff', 'rgba(155,138,251,0.35)')}>UNDO</button>
                        )}
                        {tradeDeskTarget && (
                            <button onClick={openTradeDesk} title="Open trade proposer" style={btn('var(--acc-fill2, rgba(212,175,55,0.12))', GOLD, 'var(--acc-line2, rgba(212,175,55,0.45))')}>{'⇄ Trade'}</button>
                        )}
                        <button onClick={onExit} style={btn('transparent', 'var(--silver)', 'var(--ov-6, rgba(255,255,255,0.12))')}>Exit</button>
                    </div>
                </div>

                {/* RIGHT — Alex */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '12px 15px', borderLeft: isCompact ? 'none' : '3px solid ' + ALEX, borderTop: isCompact ? '3px solid ' + ALEX : 'none', background: 'linear-gradient(180deg, rgba(155,138,251,0.10), rgba(212,175,55,0.045))', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: ALEX, fontSize: '0.9rem' }}>{'✦'}</span>
                        <span style={{ color: GOLD, fontFamily: FONT_DISPL, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.78rem' }}>Alex</span>
                    </div>

                    {/* Alex's live reads (takes, predicted-available, trade-up, trade window)
                        are Scout Pro — free gets one locked teaser instead of the read stack. */}
                    {!ccIsPro() ? (
                        window.WrGatedMoreRow
                            ? React.createElement(window.WrGatedMoreRow, { title: 'Alex reads the live room', sub: 'Live takes, predicted-available, and trade windows are Scout Pro.', feature: 'draft_live_reads' })
                            : <div dangerouslySetInnerHTML={{ __html: window.wrLockCard ? window.wrLockCard('Alex Live Reads', 'draft_live_reads', 'Live draft reads are Scout Pro.') : '' }} />
                    ) : (
                    <React.Fragment>
                    {/* Read 1 — latest decision-relevant take */}
                    {alexThinking ? (
                        <div style={readRow}>
                            <span style={readIcon(ALEX)}>{'✦'}</span>
                            <div style={{ minWidth: 0, flex: 1, ...clamp2 }}><span style={{ ...readText, fontStyle: 'italic' }}>Alex is reading the board…</span></div>
                        </div>
                    ) : alexItem ? (
                        <div style={readRow}>
                            <span style={readIcon(ALEX)}>{alexItem.badge || '⚖'}</span>
                            <div style={{ minWidth: 0, flex: 1, ...clamp2 }}>
                                <span style={{ fontSize: '0.72rem', lineHeight: 1.32 }}>
                                    <b style={{ color: 'var(--white)', fontWeight: 700 }}>{(alexItem.title || '').replace(/^Alex\s*[·:—-]?\s*/i, '') || alexItem.title}</b>
                                    {alexItem.text ? <span style={readText}> — {alexItem.text}</span> : null}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div style={readRow}>
                            <span style={readIcon(ALEX)}>{'✦'}</span>
                            <div style={{ minWidth: 0, flex: 1, ...clamp2 }}><span style={{ ...readText, opacity: 0.6, fontStyle: 'italic' }}>Alex is watching the board…</span></div>
                        </div>
                    )}

                    {/* Read 2 — predicted available at next pick */}
                    {readout && readout.available.length > 0 && (
                        <div style={readRow}>
                            <span style={readIcon(AVAIL)}>{'👁'}</span>
                            <div style={{ minWidth: 0, flex: 1, ...clamp2 }}>
                                <span style={readLabel(AVAIL)}>Available @ {readout.pickLabel}</span>
                                <span style={readText}>{' — '}{readout.available.map((a, i) => (
                                    <React.Fragment key={i}>{i ? ' · ' : ''}<b style={{ color: 'var(--white)', fontWeight: 700 }}>{a.name}</b>{a.pos ? ' (' + a.pos + ')' : ''}</React.Fragment>
                                ))}</span>
                            </div>
                        </div>
                    )}

                    {/* Read 3 — outlier worth trading up for */}
                    {readout && readout.outlier && (
                        <div style={{ ...readRow, alignItems: 'center', background: 'var(--acc-fill2, rgba(212,175,55,0.10))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.32))', borderRadius: 6, padding: '6px 8px' }}>
                            <span style={{ ...readIcon(GOLD), marginTop: 0 }}>{'⚡'}</span>
                            <div style={{ minWidth: 0, flex: 1, ...clamp2 }}>
                                <span style={{ color: GOLD, fontSize: '0.72rem', lineHeight: 1.35 }}>
                                    <b style={{ fontWeight: 800 }}>Trade up:</b> {readout.outlier.name}{readout.outlier.pos ? ' (' + readout.outlier.pos + ')' : ''} is sliding and likely gone before your pick.
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Read 4 — trade window */}
                    <div style={{ ...readRow, alignItems: 'center' }}>
                        <span style={{ ...readIcon(ALEX), marginTop: 0 }}>{'🔄'}</span>
                        <div style={{ minWidth: 0, flex: 1, ...clamp2 }}>
                            <span style={readLabel(ALEX)}>Trade window</span>
                            <span style={readText}>{' — '}{liveTradeWindow
                                ? (liveTradeWindow.viable === false
                                    ? 'no viable trade'
                                    : (liveTradeWindow.teamName + ' · ' + liveTradeWindow.likelihood + '% / ' + liveTradeWindow.acceptanceLine + '%'))
                                : 'no live window'}
                                {ownerTell?.text ? <span style={{ color: ALEX }}> · ⚑ {ownerTell.text}</span> : null}
                            </span>
                        </div>
                        {tradeDeskTarget && (
                            <button onClick={openTradeDesk} style={{ flexShrink: 0, padding: '4px 9px', borderRadius: 5, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid rgba(155,138,251,0.4)', background: 'rgba(155,138,251,0.16)', color: '#d6d0ff' }}>Open Trade Desk</button>
                        )}
                    </div>
                    </React.Fragment>
                    )}
                </div>
            </div>
        );
    }

    function LiveSyncCommandReadPanel({ state, liveSync, currentSlot, nextUserSlot, trendText, dispatch, inline = false }) {
        const status = liveSync?.status || 'idle';
        const color = status === 'mirroring' ? 'var(--k-2ecc71, #2ecc71)'
            : status === 'waiting' ? 'var(--k-f0a500, #f0a500)'
                : status === 'complete' ? 'var(--gold)'
                    : 'var(--k-e74c3c, #e74c3c)';
        const pickLabel = pick => pick ? 'R' + (pick.round || '?') + '.' + String(pickInRoundOf(pick, state.leagueSize) || 0).padStart(2, '0') : '';
        // Free tier: Alex's seeded live narration is an Alex-branded read (and
        // promises Pro-only reads) → Pro. Free keeps the shell with a neutral raw
        // status line + the Manual Pick control.
        const readIsPro = ccIsPro();
        const liveRead = (() => {
            if (!readIsPro) {
                if (nextUserSlot && currentSlot) {
                    const picksAway = userPicksAway(nextUserSlot, state.currentIdx);
                    if (picksAway === 0) return 'You are on the clock at ' + pickLabel(nextUserSlot) + '.';
                    return 'Next pick: ' + pickLabel(nextUserSlot) + ' · ' + picksAway + (picksAway === 1 ? ' pick away.' : ' picks away.');
                }
                return status === 'complete' ? 'Draft complete. Board and rosters are synced.' : 'Live room synced.';
            }
            if (state.activeOffer) return 'I paused the room for the trade offer. Resolve or counter before the clock moves.';
            if (nextUserSlot && currentSlot) {
                const picksAway = userPicksAway(nextUserSlot, state.currentIdx);
                if (picksAway === 0) {
                    return 'You are on the clock at ' + pickLabel(nextUserSlot) + '. I am watching ' + (trendText || 'the board') + ' and will flag the best value pocket.';
                }
                return 'Your next decision is ' + pickLabel(nextUserSlot) + ' in ' + picksAway + (picksAway === 1 ? ' pick. ' : ' picks. ') + 'I am watching ' + (trendText || 'the board') + ' and will flag the best value pocket before you are on deck.';
            }
            return 'No user pick is currently loaded. I will keep the board and opponent intel synced while the room moves.';
        })();
        const readout = (!readIsPro || state.activeOffer || typeof window.DraftCC?.liveDecisionEngine?.buildLiveReadout !== 'function')
            ? null
            : window.DraftCC.liveDecisionEngine.buildLiveReadout(state);
        return (
            <div style={{
                padding: '11px 14px',
                marginBottom: inline ? 0 : '8px',
                minHeight: inline ? '100%' : 'auto',
                background: 'linear-gradient(90deg, rgba(155,138,251,0.07), var(--ov-1, rgba(255,255,255,0.024)) 42%, var(--acc-fill1, rgba(212,175,55,0.045)))',
                border: '1px solid rgba(155,138,251,0.24)',
                borderLeft: '3px solid ' + color,
                borderRadius: '8px',
                display: 'grid',
                gridTemplateColumns: dispatch && state.phase === 'drafting' ? 'minmax(0, 1fr) auto' : '1fr',
                alignItems: 'center',
                gap: '12px',
                fontFamily: FONT_UI,
                height: inline ? '100%' : 'auto',
            }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color, fontWeight: 900, fontFamily: FONT_DISPL, fontSize: '0.76rem', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                        {readIsPro ? 'Alex Live Read' : 'Live Room'}
                    </div>
                    {readout && readout.available.length ? (
                        <>
                            <div style={{ color: 'var(--white)', fontSize: '0.88rem', fontWeight: 800, lineHeight: 1.25 }}>
                                Here's who I think will be available at {readout.pickLabel}
                            </div>
                            <div style={{ color: 'var(--silver)', opacity: 0.9, fontSize: '0.78rem', lineHeight: 1.4, marginTop: 3 }}>
                                {readout.available.map(a => a.name + (a.pos ? ' (' + a.pos + ')' : '')).join('  ·  ')}
                            </div>
                            {readout.outlier && (
                                <div style={{ marginTop: 6, padding: '5px 8px', borderRadius: 6, background: 'var(--acc-fill2, rgba(212,175,55,0.10))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.32))', color: 'var(--gold)', fontSize: '0.78rem', lineHeight: 1.35, fontWeight: 700 }}>
                                    {'⚡'} {readout.outlier.name}{readout.outlier.pos ? ' (' + readout.outlier.pos + ')' : ''} is sliding and likely gone before your pick — worth trading up to grab them.
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{ color: 'var(--silver)', opacity: 0.82, fontSize: '0.78rem', lineHeight: 1.4, marginTop: 4 }}>
                            {liveRead}
                        </div>
                    )}
                </div>
                {dispatch && state.phase === 'drafting' && (
                    <button
                        onClick={() => dispatch({ type: 'SET_OVERRIDE', enabled: !state.overrideMode })}
                        title={state.overrideMode ? 'Return to read-only Sleeper mirror' : 'Apply the next pick manually from the Big Board'}
                        style={liveMiniButtonStyle(
                            state.overrideMode ? 'rgba(155,138,251,0.22)' : 'var(--ov-3, rgba(255,255,255,0.035))',
                            state.overrideMode ? 'rgba(214,208,255,0.98)' : 'var(--silver)',
                            state.overrideMode ? 'rgba(155,138,251,0.45)' : 'var(--ov-6, rgba(255,255,255,0.12))'
                        )}
                    >
                        {state.overrideMode ? 'MANUAL ON' : 'MANUAL PICK'}
                    </button>
                )}
            </div>
        );
    }

    function StagedLiveOffersPanel({ offers, sleeperDraftId, dispatch, layoutGap }) {
        if (!offers || !offers.length) return null;
        const counts = offers.reduce((acc, offer) => {
            const status = offer.status || 'staged';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});
        return (
            <div style={{
                padding: '9px 14px',
                marginBottom: (layoutGap || 8) + 'px',
                background: 'rgba(124,107,248,0.045)',
                border: '1px solid rgba(155,138,251,0.24)',
                borderRadius: '6px',
                fontFamily: FONT_UI,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
                    <div style={{ color: 'rgba(155,138,251,1)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Staged Live Offers
                        <span style={{ marginLeft: 8, color: 'var(--silver)', opacity: 0.7, fontWeight: 700 }}>
                            {(counts.pending || 0)} pending · {(counts.accepted || 0)} accepted · {(counts.rejected || 0)} rejected
                        </span>
                    </div>
                    {sleeperDraftId && (
                        <button
                            onClick={() => window.open(sleeperDraftUrl(sleeperDraftId), '_blank', 'noopener,noreferrer')}
                            style={liveMiniButtonStyle('rgba(155,138,251,0.16)', 'rgba(214,208,255,0.98)', 'rgba(155,138,251,0.34)')}
                        >
                            OPEN SLEEPER
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {offers.slice(0, 3).map(offer => (
                        <StagedOfferRow
                            key={offer.id}
                            offer={offer}
                            dispatch={dispatch}
                            onDismiss={() => dispatch({ type: 'DISMISS_STAGED_LIVE_OFFER', offerId: offer.id })}
                        />
                    ))}
                </div>
            </div>
        );
    }

    function StagedOfferRow({ offer, dispatch, onDismiss }) {
        const [copied, setCopied] = React.useState(false);
        const onCopy = () => copyLiveText(offer.copyText || '').then(ok => {
            setCopied(ok);
            setTimeout(() => setCopied(false), 1400);
        });
        const status = offer.status || 'staged';
        const statusColor = status === 'accepted' ? 'var(--good)'
            : status === 'rejected' ? 'var(--bad)'
                : status === 'pending' ? 'var(--gold)'
                    : 'rgba(155,138,251,0.95)';
        const updateStatus = nextStatus => dispatch?.({ type: 'UPDATE_LIVE_OFFER_STATUS', offerId: offer.id, status: nextStatus });
        return (
            <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                padding: '7px 8px',
                background: 'var(--ov-2, rgba(255,255,255,0.03))',
                border: '1px solid var(--ov-4, rgba(255,255,255,0.07))',
                borderRadius: '5px',
            }}>
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ color: 'var(--white)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {offer.partnerName || 'Trade partner'} · {offer.likelihood || 0}% / {offer.acceptanceLine || 70}% Buyer Line
                    </div>
                    <div style={{ color: 'var(--silver)', opacity: 0.74, fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                        <span style={{ color: statusColor, fontWeight: 800, textTransform: 'uppercase' }}>{status}</span> · Give {offer.giveText || 'package'} / Get {offer.getText || 'package'}
                    </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
                    <button onClick={onCopy} style={liveMiniButtonStyle('rgba(46,204,113,0.11)', 'var(--good)', 'rgba(46,204,113,0.28)')}>
                        {copied ? 'COPIED' : 'COPY'}
                    </button>
                    <button onClick={() => updateStatus('pending')} style={liveMiniButtonStyle(status === 'pending' ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'transparent', 'var(--gold)', 'var(--acc-line2, rgba(212,175,55,0.28))')}>
                        SENT
                    </button>
                    <button onClick={() => updateStatus('accepted')} style={liveMiniButtonStyle(status === 'accepted' ? 'rgba(46,204,113,0.16)' : 'transparent', 'var(--good)', 'rgba(46,204,113,0.28)')}>
                        YES
                    </button>
                    <button onClick={() => updateStatus('rejected')} style={liveMiniButtonStyle(status === 'rejected' ? 'rgba(231,76,60,0.16)' : 'transparent', 'var(--bad)', 'rgba(231,76,60,0.28)')}>
                        NO
                    </button>
                    <button onClick={onDismiss} style={liveMiniButtonStyle('transparent', 'var(--silver)', 'var(--ov-6, rgba(255,255,255,0.12))')}>
                        ×
                    </button>
                </div>
            </div>
        );
    }

    function liveMiniButtonStyle(background, color, borderColor) {
        return {
            padding: '4px 10px',
            minHeight: '44px',
            minWidth: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background,
            border: '1px solid ' + borderColor,
            borderRadius: 'var(--card-radius-sm)',
            color,
            cursor: 'pointer',
            fontFamily: FONT_UI,
            fontSize: 'var(--text-micro)',
            fontWeight: 900,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
        };
    }

    function copyLiveText(text) {
        if (!text) return Promise.resolve(false);
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }
        window.prompt('Copy live offer summary:', text);
        return Promise.resolve(true);
    }

    function liveTone(tone) {
        if (tone === 'green') return { main: 'var(--k-2ecc71, #2ecc71)', bg: 'rgba(46,204,113,0.08)', border: 'rgba(46,204,113,0.26)' };
        if (tone === 'purple') return { main: 'rgba(155,138,251,1)', bg: 'rgba(155,138,251,0.08)', border: 'rgba(155,138,251,0.28)' };
        if (tone === 'red') return { main: 'var(--k-e74c3c, #e74c3c)', bg: 'rgba(231,76,60,0.08)', border: 'rgba(231,76,60,0.28)' };
        if (tone === 'amber') return { main: 'var(--k-f0a500, #f0a500)', bg: 'rgba(240,165,0,0.08)', border: 'rgba(240,165,0,0.28)' };
        return { main: 'var(--gold)', bg: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: 'var(--acc-line2, rgba(212,175,55,0.28))' };
    }

    function shortLiveValue(value) {
        const n = Number(value || 0);
        if (!n) return '0';
        return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
    }

    // Maps a trade-reasoning driver tone ('good'|'bad'|'neutral') to a color for
    // the "Why move up" lists. good = green/gold, bad = red, neutral = silver.
    function liveDriverColor(tone) {
        if (tone === 'good') return 'var(--k-2ecc71, #2ecc71)';
        if (tone === 'bad') return 'var(--k-e74c3c, #e74c3c)';
        return 'var(--silver)';
    }

    function openLiveDecisionPlayer(player) {
        if (!player?.pid) return;
        if (typeof window.openPlayerModal === 'function') {
            try { window.openPlayerModal(player.pid); return; } catch (_) {}
        }
        if (typeof window.WR?.openPlayerCard === 'function') {
            try { window.WR.openPlayerCard(player.pid); } catch (_) {}
        }
    }

    function LiveDecisionDeckPanel({ deck, onTrade, layoutGap }) {
        // The Trade Window now lives in the purple Current Pick Trade Window
        // banner above the deck (with the owner tell), so drop it from here.
        const cards = (deck?.cards || []).filter(c => c.action !== 'trade');
        if (!cards.length) return null;
        const ownerTell = (deck?.alerts || []).find(a => a.type === 'owner_tendency') || null;
        const otherAlerts = (deck?.alerts || []).filter(a => a.type !== 'owner_tendency');
        const next = deck?.nextUserPick;
        const nextLabel = next
            ? (next.picksAway === 0
                ? 'You are on the clock'
                : next.picksAway === 1
                    ? 'You are on deck — 1 pick to your next turn'
                    : next.picksAway + ' picks to your next turn')
            : 'No user pick remaining';
        return (
            <div style={{
                padding: '10px 14px',
                marginBottom: (layoutGap || 8) + 'px',
                background: 'var(--ov-1, rgba(255,255,255,0.022))',
                border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))',
                borderRadius: '6px',
                fontFamily: FONT_UI,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ color: 'var(--gold)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', flex: 1 }}>
                        On-Clock Decision Deck
                    </div>
                    <div style={{ color: 'var(--silver)', opacity: 0.66, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700 }}>
                        {nextLabel} · {deck.assumptions?.boardLane || 'dhq'} board
                    </div>
                </div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))',
                    gap: 7,
                    marginBottom: otherAlerts.length ? 8 : 0,
                }}>
                    {cards.map(card => {
                        const tone = liveTone(card.tone);
                        const player = card.player;
                        const clickable = card.action === 'trade' || player?.pid;
                        // Optional trade-cluster reasoning contract on the trade card.
                        const tradeReasoning = card.action === 'trade'
                            ? card.meta?.tradeWindow?.suggestion?.reasoning
                            : null;
                        const tradeDrivers = (tradeReasoning?.drivers || []).slice(0, 3);
                        return (
                            <button
                                key={card.kind + ':' + (player?.pid || card.detail || '')}
                                onClick={() => card.action === 'trade' ? onTrade?.() : openLiveDecisionPlayer(player)}
                                disabled={!clickable}
                                style={{
                                    minWidth: 0,
                                    padding: '8px 9px',
                                    background: tone.bg,
                                    border: '1px solid ' + tone.border,
                                    borderLeft: '3px solid ' + tone.main,
                                    borderRadius: '5px',
                                    textAlign: 'left',
                                    cursor: clickable ? 'pointer' : 'default',
                                    fontFamily: FONT_UI,
                                    color: 'var(--silver)',
                                }}
                            >
                                <div style={{ color: tone.main, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                                    {card.label}
                                </div>
                                {player ? (
                                    <>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, marginBottom: 4 }}>
                                            {player.pos && (
                                                <span style={{ flexShrink: 0, color: tone.main, border: '1px solid ' + tone.border, borderRadius: 3, padding: '0 4px', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900 }}>
                                                    {player.pos}
                                                </span>
                                            )}
                                            <strong style={{ color: 'var(--white)', fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {player.name}
                                            </strong>
                                        </div>
                                        <div style={{ display: 'flex', gap: 7, color: 'var(--silver)', opacity: 0.78, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_MONO }}>
                                            <span>DHQ {shortLiveValue(player.dhq)}</span>
                                            <span>Y5 {shortLiveValue(player.y5)}</span>
                                            {player.tier && <span>T{player.tier}</span>}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {tradeReasoning?.headline && (
                                            <div style={{ color: 'var(--white)', fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.3, marginBottom: 3 }}>
                                                {tradeReasoning.headline}
                                            </div>
                                        )}
                                        <div style={{ color: 'var(--white)', fontSize: '0.72rem', lineHeight: 1.3, marginBottom: ((card.action === 'trade' && ownerTell) || tradeDrivers.length) ? 4 : 0 }}>
                                            {card.detail}
                                        </div>
                                        {!!tradeDrivers.length && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: ownerTell ? 4 : 0 }}>
                                                {tradeDrivers.map((d, di) => (
                                                    <div key={di} style={{ fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.3 }}>
                                                        <span style={{ color: liveDriverColor(d.tone), fontWeight: 800 }}>{d.label}</span>
                                                        <span style={{ color: 'var(--silver)', opacity: 0.82 }}>{d.detail ? ' · ' + d.detail : ''}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {card.action === 'trade' && ownerTell && (
                                            <div style={{ color: tone.main, opacity: 0.92, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.3 }}>
                                                {ownerTell.text}
                                            </div>
                                        )}
                                    </>
                                )}
                            </button>
                        );
                    })}
                </div>
                {!!otherAlerts.length && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {otherAlerts.map(alert => {
                            const tone = liveTone(alert.tone);
                            return (
                                <div key={alert.type + ':' + alert.title} style={{
                                    flex: '1 1 190px',
                                    minWidth: 0,
                                    padding: '6px 8px',
                                    background: tone.bg,
                                    border: '1px solid ' + tone.border,
                                    borderRadius: '4px',
                                }}>
                                    <div style={{ color: tone.main, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{alert.title}</div>
                                    <div style={{ color: 'var(--silver)', opacity: 0.8, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.35, marginTop: 2 }}>{alert.text}</div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    function LiveTradeWindowBanner({ tradeWindow, onOpen, layoutGap, ownerTell, inline = false, leagueSize }) {
        if (!tradeWindow) return null;
            const suggestion = tradeWindow.suggestion || {};
            const proposal = suggestion.proposal || {};
            const give = formatTradePackageSide(proposal, 'my', leagueSize);
            const get = formatTradePackageSide(proposal, 'their', leagueSize);
            const viable = tradeWindow.viable !== false;
            const clears = tradeWindow.likelihood >= tradeWindow.acceptanceLine;
            const statusColor = !viable ? 'var(--silver)' : (clears ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-f0a500, #f0a500)');
            // Trade-cluster reasoning (optional contract): { headline, drivers:[{label,detail,tone}] }
            const reasoning = suggestion.reasoning;
            const drivers = (reasoning?.drivers || []).slice(0, 4);
            return (
                <div style={{
                    padding: '9px 14px',
                    marginBottom: inline ? 0 : (layoutGap || 8) + 'px',
                    background: 'rgba(124,107,248,0.055)',
                    border: '1px solid rgba(155,138,251,0.28)',
                    borderRadius: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    minHeight: 48,
                    fontFamily: FONT_UI,
                    height: inline ? '100%' : 'auto',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    <div style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        border: '1px solid rgba(155,138,251,0.45)',
                        color: 'rgba(155,138,251,1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: FONT_DISPL,
                        fontWeight: 800,
                        flexShrink: 0,
                    }}>T</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            minWidth: 0,
                            marginBottom: 2,
                        }}>
                            <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'rgba(155,138,251,1)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, flexShrink: 0 }}>
                                Current Pick Trade Window
                            </span>
                            <span style={{ color: 'var(--white)', fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {tradeWindow.teamName} · {tradeWindow.pickLabel}
                            </span>
                        </div>
                        {viable && reasoning?.headline && (
                            <div style={{ color: 'var(--white)', fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.35, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {reasoning.headline}
                            </div>
                        )}
                        <div style={{ color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {!viable
                                ? 'No viable trade — ' + tradeWindow.teamName + ' won’t move off ' + tradeWindow.pickLabel + ' near their buyer line.'
                                : liveTradeTimingLabel(tradeWindow) + ' · ' + (suggestion.label || tradeWindow.motive || 'Package') + ' · Give ' + give + ' / Get ' + get}
                        </div>
                        {ownerTell?.text && (
                            <div title={ownerTell.title || 'Owner tell'} style={{ color: 'rgba(155,138,251,0.92)', fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.3, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {'⚑ '}{ownerTell.text}
                            </div>
                        )}
                    </div>
                    <div style={{
                        color: statusColor,
                        fontFamily: FONT_MONO,
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        textAlign: 'right',
                        flexShrink: 0,
                    }}>
                        {!viable ? 'No deal' : tradeWindow.likelihood + '% / ' + tradeWindow.acceptanceLine + '%'}
                        <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_UI, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            {!viable ? 'Below counter line' : 'Buyer Line'}
                        </div>
                    </div>
                    <button
                        onClick={onOpen}
                        style={{
                            padding: '6px 10px',
                            background: 'rgba(155,138,251,0.14)',
                            border: '1px solid rgba(155,138,251,0.34)',
                            borderRadius: '4px',
                            color: 'rgba(214,208,255,0.98)',
                            cursor: 'pointer',
                            fontFamily: FONT_UI,
                            fontSize: 'var(--text-micro, 0.6875rem)',
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                            flexShrink: 0,
                        }}
                    >
                        OPEN TRADE DESK
                    </button>
                </div>
                {viable && !!drivers.length && (
                    <div style={{
                        borderTop: '1px solid rgba(155,138,251,0.18)',
                        paddingTop: 7,
                    }}>
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'rgba(155,138,251,1)', textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 800, marginBottom: 4 }}>
                            Why move up
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {drivers.map((d, di) => (
                                <div key={di} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 'var(--text-label, 0.75rem)', lineHeight: 1.35 }}>
                                    <span style={{ flexShrink: 0, color: liveDriverColor(d.tone), fontWeight: 800 }}>
                                        {d.label}
                                    </span>
                                    <span style={{ color: 'var(--silver)', opacity: 0.85, minWidth: 0 }}>
                                        {d.detail}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            );
        }

        // ── Mobile: sticky on-the-clock status card for the phone feed ──
        // (iPhone program Phase 3 re-composition of the old one-line bar.)
        // Who's up, pick meta (R#.## · #overall), how far away the user's next
        // pick is, and a big mono clock read from EXISTING clock state — the
        // mock speed→timer mapping (MockDraftCockpit's timerLabel) or the live
        // made/total mirror. Red-accent treatment when the user is on the
        // clock. Sticks against the page scroll; top offset = --sat so it
        // clears the notch in the installed PWA (0px in a Safari tab). z 60
        // paints it over the league shell's sticky time bar (z 50) while both
        // are stuck; the fixed layer (hamburger 201, phone dock 100) stays above.
        // Left padding reserves the phone hamburger's 42px corner, matching the
        // .wr-league-header-row convention. Single-line ellipsis so 375px never
        // wraps or overflows (MobileFeed only mounts at <768).
        function MobileClockBar({ state, currentSlot, isUserTurn, intel }) {
            const personas = state.personas || {};
            const userRosterId = String(state.userRosterId || '');
            const order = state.pickOrder || [];
            const idx = state.currentIdx || 0;
            const made = (state.picks || []).length;
            const total = order.length || 0;
            const slot = currentSlot || order[idx] || null;
            const rosterId = String(slot?.rosterId || '');
            const done = state.phase === 'complete';
            const teamName = personas[rosterId]?.teamName
                || (rosterId && rosterId === userRosterId ? 'Your Team' : (slot?.slot ? 'Team ' + slot.slot : 'Draft Room'));
            // Picks until the user is back on the clock (0 = now).
            const away = React.useMemo(() => {
                if (!userRosterId || !order.length || done) return null;
                const n = order.slice(idx).findIndex(s => String(s.rosterId) === userRosterId);
                return n < 0 ? null : n;
            }, [userRosterId, order, idx, done]);
            const userUp = (isUserTurn || away === 0) && !done;
            const statusLabel = done ? 'Draft complete'
                : state.activeOffer ? 'Trade offer paused'
                    : userUp ? "You're on the clock"
                        : 'On the clock';
            const statusColor = done ? 'var(--silver)'
                : state.activeOffer ? 'var(--k-f0a500, #f0a500)'
                    : userUp ? 'var(--bad, #e5534b)'
                        : 'var(--gold)';
            const rightLabel = done ? (made + ' picks')
                : userUp ? 'YOU'
                    : away != null ? 'You in ' + away
                        : (made + '/' + (total || '--'));
            // Existing clock state only: mock speed → pick-timer label (same
            // mapping as MockDraftCockpit), live-sync → made/total mirror.
            const clockText = done ? 'FINAL'
                : state.activeOffer ? '⏸'
                    : state.mode === 'live-sync' ? (made + '/' + (total || '—'))
                        : state.speed === 'paused' ? '⏸'
                            : state.speed === 'fast' ? '0:35'
                                : state.speed === 'slow' ? '4:00' : '2:15';
            return (
                <div style={{
                    position: 'sticky', top: 'var(--sat, 0px)', zIndex: 60,
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    minHeight: 52, padding: '7px 12px 7px 52px', marginBottom: 8,
                    // Your turn is unmistakable: the whole card tints red, not just the border.
                    background: userUp
                        ? 'linear-gradient(90deg, rgba(231,76,60,0.18), rgba(231,76,60,0.05) 55%, var(--black, #0a0a0a))'
                        : 'var(--black, #0a0a0a)',
                    border: userUp ? '2px solid rgba(231,76,60,0.65)' : '1px solid var(--acc-fill3, rgba(212,175,55,0.16))',
                    borderRadius: 6,
                    boxShadow: userUp ? '0 6px 18px rgba(231,76,60,0.22), 0 6px 14px rgba(0,0,0,0.45)' : '0 6px 14px rgba(0,0,0,0.45)',
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, color: statusColor, fontFamily: FONT_UI, textTransform: 'uppercase', letterSpacing: '0.1em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {statusLabel}
                        </div>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--white)', fontFamily: FONT_UI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {done ? 'Board is final' : teamName}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            {!done && slot && (
                                <span style={{ fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.85, whiteSpace: 'nowrap' }}>
                                    {mockPickLabel(slot, state.leagueSize)} · #{slot.overall || '--'}
                                </span>
                            )}
                            <span style={{
                                fontFamily: FONT_MONO, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800,
                                padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
                                border: '1px solid ' + (userUp ? 'rgba(231,76,60,0.5)' : 'var(--ov-5, rgba(255,255,255,0.1))'),
                                color: userUp ? 'var(--bad, #e5534b)' : 'var(--silver)',
                                background: userUp ? 'rgba(231,76,60,0.12)' : 'var(--ov-2, rgba(255,255,255,0.03))',
                            }}>
                                {rightLabel}
                            </span>
                        </div>
                    </div>
                    <div style={{ flexShrink: 0, fontFamily: FONT_MONO, fontSize: '1.45rem', fontWeight: 700, lineHeight: 1, color: userUp ? 'var(--bad, #e5534b)' : done ? 'var(--silver)' : 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>
                        {clockText}
                    </div>
                    {/* DraftCast intel row (owner ask): basic on-clock opponent read,
                        tap → full Opponent Intel sheet. */}
                    {intel && (
                        <button type="button" onClick={intel.onTap}
                            style={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', gap: 6, margin: '0 -6px -2px', padding: '6px 6px 4px', minHeight: 34, border: 'none', borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))', background: 'transparent', color: intel.tag === 'PICK' ? 'var(--white)' : 'var(--silver)', fontFamily: FONT_UI, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: intel.tag === 'PICK' ? 700 : 400, cursor: 'pointer', textAlign: 'left' }}>
                            <span style={{ color: intel.accent || 'var(--gold)', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>{intel.tag || 'Intel'}</span>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{intel.text}</span>
                            <span aria-hidden="true" style={{ color: intel.accent || 'var(--gold)', flexShrink: 0 }}>›</span>
                        </button>
                    )}
                </div>
            );
        }

    // ── Room Feed (shared, owner ask 2026-07-13: phone crossover) ──────
    // The phone live-room's Twitter-style feed hoisted out of MobileFeed so
    // the desktop stream cell renders it too: persona-attributed posts
    // (Alex Ingram / League Wire / Board Watch / You) interwoven with rich
    // pick cards (photo · NFL team · college · DHQ · folded REACH/STEAL).
    // Renders ONLY the scrollable feed column — no DraftCast bar, no tabs;
    // callers size the scroll container via heightStyle. All state-derived
    // pieces (reach folds, team names, the pick/stream interleave) recompute
    // per render exactly as the old MobileFeed inline copies did.
    const ALEXC = 'var(--k-9b8afb, #9b8afb)'; // Alex accent (was MobileFeed-local)
    function DraftRoomFeed({ state, maxRows = 140, heightStyle, emptyText }) {
        const posColors = window.App?.POS_COLORS || {
            QB: 'var(--k-ff6b6b, #ff6b6b)', RB: 'var(--k-4ecdc4, #4ecdc4)', WR: 'var(--k-45b7d1, #45b7d1)', TE: 'var(--k-f7dc6f, #f7dc6f)',
            DL: 'var(--k-e67e22, #e67e22)', LB: 'var(--k-f0a500, #f0a500)', DB: 'var(--k-5dade2, #5dade2)', K: 'var(--k-bb8fce, #bb8fce)',
        };
        const fmtK = n => { const v = Number(n) || 0; return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)); };
        const personas = state.personas || {};
        const teamNameOf = pk => {
            const rid = String(pk.rosterId || '');
            if (personas[rid]?.teamName) return personas[rid].teamName;
            if (pk.isUser || rid === String(state.userRosterId || '')) return 'Your Team';
            return pk.slot ? 'Team ' + pk.slot : 'Draft Room';
        };
        // Reach/steal reads fold INTO their pick's card (owner ask) — collect
        // them first and drop them from the standalone feed.
        const reachByOverall = new Map();
        const foldedIds = new Set();
        ((state.alex && state.alex.stream) || []).forEach(ev => {
            const t = String(ev.title || '');
            if (ev.relatedPickNo && /^(REACH|STEAL)\s*·/i.test(t)) {
                reachByOverall.set(Number(ev.relatedPickNo), { steal: /^STEAL/i.test(t), text: ev.text || t });
                foldedIds.add(ev.id);
            }
            // The bare per-pick announcement line ("R2.06 · Name") duplicates the
            // team's pick card on phone — drop it (owner ask). The "Alex read · …"
            // commentary variant stays: that's Alex actually reacting to the pick.
            if (/^R\d+\.\d+\s*·/.test(t)) foldedIds.add(ev.id);
        });
        const feedRows = (() => {
            const picks = state.picks || [];
            const events = ((state.alex && state.alex.stream) || []).filter(ev => !foldedIds.has(ev.id));
            const used = new Set();
            const items = [];
            picks.forEach(pk => {
                items.push({ kind: 'pick', ts: pk.ts || 0, pk });
                events.forEach(ev => {
                    if (ev.relatedPickNo && Number(ev.relatedPickNo) === Number(pk.overall) && !used.has(ev.id)) {
                        used.add(ev.id);
                        items.push({ kind: 'alex', ts: (pk.ts || 0) + 1, ev });
                    }
                });
            });
            events.forEach(ev => { if (!used.has(ev.id)) items.push({ kind: 'alex', ts: ev.ts || 0, ev }); });
            items.sort((a, b) => a.ts - b.ts);
            return items.reverse().slice(0, maxRows); // newest first
        })();
        // Twitter-style posters (owner ask): every feed entry is a post from a
        // room voice — the drafting TEAM posts its pick, Alex reacts, the League
        // Wire calls trades/room moves, Board Watch calls runs and tier breaks.
        const FEED_VOICES = {
            alex: { name: 'Alex Ingram', tag: 'AI GM', avatar: 'AI', color: ALEXC, bg: 'rgba(155,138,251,0.16)' },
            wire: { name: 'League Wire', tag: 'trade desk', avatar: '⇄', color: 'var(--k-5dade2, #5dade2)', bg: 'rgba(93,173,226,0.14)' },
            board: { name: 'Board Watch', tag: 'room trends', avatar: '▲', color: 'var(--k-f0a500, #f0a500)', bg: 'rgba(240,165,0,0.14)' },
            you: { name: 'You', tag: 'room mic', avatar: 'Q', color: 'var(--gold)', bg: 'rgba(212,175,55,0.14)' },
        };
        const voiceOf = ev => {
            const t = String(ev.title || '').toUpperCase();
            if (ev.type === 'user') return FEED_VOICES.you;
            if (/^TRADE\b|^ROOM EVOLUTION|TRADE OFFER|COUNTER|ACCEPTED|DECLINED/.test(t)) return FEED_VOICES.wire;
            if (/^ROOM RUN|^TIER BREAK|POSITION RUN/.test(t)) return FEED_VOICES.board;
            return FEED_VOICES.alex;
        };
        const agoOf = ts => {
            if (!ts) return '';
            const s = Math.max(0, (Date.now() - ts) / 1000);
            if (s < 45) return 'now';
            if (s < 3600) return Math.floor(s / 60) + 'm';
            if (s < 86400) return Math.floor(s / 3600) + 'h';
            return Math.floor(s / 86400) + 'd';
        };
        const avatarEl = (label, color, bg) => (
            <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: bg, color, fontFamily: FONT_MONO, fontSize: '0.62rem', fontWeight: 900, border: '1px solid ' + color }}>{label}</span>
        );
        const initialsOf = s => String(s || '?').trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
        const pickRowEl = pk => {
            const rs = reachByOverall.get(Number(pk.overall)) || null;
            const team = teamNameOf(pk);
            const nflTeam = pk.csv?.nflTeam || window.S?.players?.[pk.pid]?.team || '';
            const college = pk.college || pk.csv?.college || '';
            const bits = [nflTeam, college].filter(Boolean).join(' · ');
            const photo = pk.pid && !String(pk.pid).startsWith('csv_')
                ? 'https://sleepercdn.com/content/nfl/players/thumb/' + pk.pid + '.jpg'
                : (pk.photoUrl || '');
            return (
                <div key={pk.id || ('pk-' + pk.overall)} onClick={() => pk.pid && mockOpenPlayer(pk)} role="button" tabIndex={0}
                    style={{ padding: '9px 11px', borderRadius: 10, cursor: pk.pid ? 'pointer' : 'default', background: pk.isUser ? 'var(--acc-fill1, rgba(212,175,55,0.07))' : 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + (pk.isUser ? 'var(--acc-line2, rgba(212,175,55,0.32))' : 'var(--ov-4, rgba(255,255,255,0.05))') }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        {avatarEl(initialsOf(team), pk.isUser ? 'var(--gold)' : 'var(--silver)', pk.isUser ? 'rgba(212,175,55,0.14)' : 'var(--ov-3, rgba(255,255,255,0.05))')}
                        <span style={{ color: 'var(--white)', fontWeight: 800, fontSize: '0.76rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team}</span>
                        <span style={{ color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_MONO, flexShrink: 0, marginLeft: 'auto' }}>{'R' + (pk.round || '?') + '.' + String(pk.pickInRound || pk.slot || 0).padStart(2, '0')}{pk.ts ? ' · ' + agoOf(pk.ts) : ''}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 7 }}>
                        <img src={photo} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', objectPosition: 'center top', background: 'var(--ov-3, rgba(255,255,255,0.05))', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                <span style={{ color: 'var(--white)', fontWeight: 800, fontSize: '0.84rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pk.name}</span>
                                <span style={{ flexShrink: 0, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, color: posColors[pk.pos] || 'var(--silver)', padding: '1px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.4)' }}>{pk.pos || '—'}</span>
                            </div>
                            <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{bits || '—'}</div>
                        </div>
                        <span style={{ fontFamily: FONT_MONO, fontSize: '0.78rem', fontWeight: 700, color: 'var(--silver)', flexShrink: 0 }}>{fmtK(pk.dhq)}</span>
                    </div>
                    {rs && (
                        <div style={{ marginTop: 7, padding: '5px 8px', borderRadius: 6, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.4, color: rs.steal ? 'var(--k-2ecc71, #2ecc71)' : 'var(--bad, #e5534b)', background: rs.steal ? 'rgba(46,204,113,0.08)' : 'rgba(231,76,60,0.08)', border: '1px solid ' + (rs.steal ? 'rgba(46,204,113,0.25)' : 'rgba(231,76,60,0.25)') }}>
                            {(rs.steal ? '↓ STEAL — ' : '↑ REACH — ') + rs.text}
                        </div>
                    )}
                </div>
            );
        };
        const alexRowEl = ev => {
            const voice = voiceOf(ev);
            return (
                <div key={ev.id} style={{ padding: '8px 11px', borderRadius: 10, background: 'var(--ov-1, rgba(255,255,255,0.018))', border: '1px solid var(--ov-4, rgba(255,255,255,0.045))' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        {avatarEl(voice.avatar, voice.color, voice.bg)}
                        <span style={{ color: voice.color, fontWeight: 900, fontSize: '0.74rem', flexShrink: 0 }}>{voice.name}</span>
                        <span style={{ color: 'var(--silver)', opacity: 0.5, fontSize: 'var(--text-micro, 0.6875rem)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{voice.tag}</span>
                        <span style={{ color: 'var(--silver)', opacity: 0.5, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_MONO, flexShrink: 0, marginLeft: 'auto' }}>{agoOf(ev.ts)}</span>
                    </div>
                    {ev.title && <div style={{ marginTop: 5, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, color: ev.color || voice.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{(ev.badge ? ev.badge + ' ' : '') + ev.title}</div>}
                    {ev.text && <div style={{ marginTop: 2, color: 'var(--silver)', fontSize: '0.76rem', lineHeight: 1.45 }}>{ev.text}</div>}
                </div>
            );
        };
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', paddingRight: 2, ...(heightStyle || {}) }}>
                {feedRows.length
                    ? feedRows.map(row => (row.kind === 'pick' ? pickRowEl(row.pk) : alexRowEl(row.ev)))
                    : <div style={{ padding: 14, border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', borderRadius: 9, color: 'var(--silver)', opacity: 0.7, fontSize: '0.78rem' }}>{emptyText || "The feed starts when the first pick lands — picks and Alex's reads land here in order."}</div>}
            </div>
        );
    }

        // ── Mobile live room (owner redesign, 2026-07-12): a permanent DraftCast
        // bar (clock + on-clock opponent intel row → intel sheet) over three
        // swipeable tabs — FEED (pick log with Alex's stream interwoven) /
        // BOARD (Alex's pick card + BigBoardPanel, the pick path) / ROSTER.
        // Panes scroll in place; Ask Alex + Analytics open as WR.Sheets from
        // the chip row; a live trade offer mounts the same TradeModal popup
        // desktop uses. Falls back to the stacked feed if the kit isn't loaded.
        function MobileFeed({ state, dispatch, onStart, isUserTurn, currentSlot, onPropose }) {
        const BigBoardPanel = window.DraftCC.BigBoardPanel;
        const AlexStreamPanel = window.DraftCC.AlexStreamPanel;
        const AskAnswerWindow = window.DraftCC.AskAnswerWindow;
        const AlexEdgeGlow = window.DraftCC.AlexEdgeGlow;
        const OpponentIntelPanel = window.DraftCC.OpponentIntelPanel;
        const LiveAnalyticsPanel = window.DraftCC.LiveAnalyticsPanel;
        const Sheet = window.WR && window.WR.Sheet;
        // Which demoted side panel is open: 'alex'|'intel'|'analytics'.
        // Hooks sit above every early return so hook order never varies.
        const [phPanel, setPhPanel] = React.useState(null);
        // Live-room redesign (owner ask): the room is a swipeable 3-tab surface —
        // FEED (pick log with Alex's stream interwoven) / BOARD / ROSTER — under a
        // permanent DraftCast bar that carries on-clock opponent intel.
        const [phTab, setPhTab] = React.useState('feed');
        const swipeRef = React.useRef(null);
        // Trade offers pause the room — on phone the offer opens as the SAME
        // TradeModal popup desktop uses (owner ask: "it should just open as a
        // pop up"). Same Pro boundary: free auto-declines so the room resumes.
        const TradeModal = window.DraftCC.TradeModal;
        const tradeIsPro = ccIsPro();
        React.useEffect(() => {
            if (state.activeOffer && !tradeIsPro) dispatch({ type: 'DECLINE_TRADE' });
        }, [state.activeOffer, tradeIsPro, dispatch]);
        const _kitOk = !!Sheet; // ActionBar no longer used by the live room

        if (state.phase === 'setup') {
            // Only the live-sync path still lands here on phone (mock/scenario/
            // ghost setup now routes to the full SetupScreen upstream) — and
            // live-sync auto-starts, so this is a transient fallback screen.
            return (
                <div className="draft-cc-scope" style={{ padding: '16px', fontFamily: FONT_UI, textAlign: 'center' }}>
                    <div style={{
                        padding: '14px 18px',
                        background: 'rgba(240,165,0,0.08)',
                        border: '1px solid rgba(240,165,0,0.25)',
                        borderRadius: '8px',
                        marginBottom: '16px',
                        fontSize: '0.76rem',
                        color: 'var(--k-f0a500, #f0a500)',
                        lineHeight: 1.5,
                    }}>
                        📱 Phone runs the draft feed — Big Board, Alex's reads, and the
                        pick log, synced to your league's live draft.
                    </div>
                    <button onClick={onStart} style={{
                        width: '100%',
                        padding: '14px',
                        background: 'var(--gold)',
                        color: 'var(--black)',
                        border: 'none',
                        borderRadius: '8px',
                        fontFamily: FONT_DISPL,
                        fontSize: '1rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        letterSpacing: '0.06em',
                    }}>
                        OPEN DRAFT ROOM
                    </button>
                </div>
            );
        }

        if (!_kitOk) {
            // Pre-Phase-3 fallback stack (phone kit not loaded).
            return (
                <div style={{ fontFamily: FONT_UI, padding: '4px 0' }}>
                    {/* Bottom clearance for the phone bottom dock comes from the league
                        shell: .app-container[data-league-skin-type] pads by
                        calc(60px + var(--wr-bottom-inset)) at ≤767 (index.html phone
                        tier) — do not double-pad here. */}
                    <MobileClockBar state={state} currentSlot={currentSlot} isUserTurn={isUserTurn} />
                    <div style={{ minHeight: 320, maxHeight: '56vh', marginBottom: 10 }}>
                        <BigBoardPanel state={state} dispatch={dispatch} isUserTurn={isUserTurn} />
                    </div>
                    <div style={{ minHeight: 300, marginBottom: 10 }}>
                        <AlexStreamPanel state={state} dispatch={dispatch} />
                    </div>
                    <div style={{ minHeight: 260, maxHeight: '44vh' }}>
                        <DraftPickListPanel state={state} currentSlot={currentSlot} onPropose={onPropose} />
                    </div>
                    {AskAnswerWindow && <AskAnswerWindow state={state} />}
                    {AlexEdgeGlow && <AlexEdgeGlow state={state} isUserTurn={isUserTurn} />}
                </div>
            );
        }

        const drafting = state.phase === 'drafting';
        const pro = ccIsPro();
        // (ActionBar removed per owner ask — drafting happens from the Big Board
        // tab, whose rows carry the existing MAKE_PICK handlers.)
        const bpa = (state.pool || [])[0] || null;
        // Alex's pick card: the Alex Whisper line (latest stream take) over the
        // board's top name. Same Pro boundary as the Decision Deck — free gets
        // the exact desktop WrGatedMoreRow teaser and drafts from the raw board.
        // (ALEXC hoisted to module scope with <DraftRoomFeed/> — owner ask
        // 2026-07-13: phone crossover.)
        const alexFeedItems = (state.alex && state.alex.stream) || [];
        const alexThinking = !!(state.alex && state.alex.thinking);
        const DECISION_BADGES = new Set(['✦', '⚖', '◇', 'A', '↑', '↓']);
        const alexItem = alexThinking ? null
            : (isUserTurn ? (alexFeedItems.find(e => DECISION_BADGES.has(e.badge)) || alexFeedItems[0]) : alexFeedItems[0]);
        // ── Live-room composition (owner redesign) ──────────────────
        // FEED: the pick log with Alex's stream interwoven — machinery hoisted
        // to the shared <DraftRoomFeed/> so the desktop stream cell renders the
        // same feed (owner ask 2026-07-13: phone crossover).
        const personas = state.personas || {};
        // DraftCast bottom row: on YOUR turn it becomes the pick CTA (→ Board
        // tab); otherwise the on-clock team's predicted pick, tap → Opponent
        // Intel. (Prediction is a Pro read; the sheet carries the free gate.)
        const onClockPersona = currentSlot ? personas[String(currentSlot.rosterId || '')] : null;
        const lp = pro ? onClockPersona?.predictions?.likelyPick : null;
        const draftCastIntel = state.phase === 'complete' ? null : isUserTurn
            ? { tag: 'PICK', accent: 'var(--bad, #e5534b)', text: "You're up — open the Big Board and make the call", onTap: () => setPhTab('board') }
            : {
                tag: 'Intel',
                accent: 'var(--gold)',
                text: lp?.name
                    ? 'Likely: ' + lp.name + (lp.pos ? ' (' + lp.pos + ')' : '') + ' — tap for the full read'
                    : onClockPersona
                        ? 'Scout ' + (onClockPersona.teamName || 'the room') + ' — tap for the full read'
                        : 'Opponent intel — tap to open',
                onTap: () => setPhPanel('intel'),
            };
        // Swipe left/right between FEED / BOARD / ROSTER (native-feel, no deps).
        const TAB_KEYS = ['feed', 'board', 'roster'];
        const onTouchStart = e => { const t = e.touches && e.touches[0]; if (t) swipeRef.current = { x: t.clientX, y: t.clientY }; };
        const onTouchEnd = e => {
            const st = swipeRef.current; swipeRef.current = null;
            const t = e.changedTouches && e.changedTouches[0];
            if (!st || !t) return;
            const dx = t.clientX - st.x, dy = t.clientY - st.y;
            if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
            const i = TAB_KEYS.indexOf(phTab);
            const ni = dx < 0 ? Math.min(TAB_KEYS.length - 1, i + 1) : Math.max(0, i - 1);
            if (ni !== i) setPhTab(TAB_KEYS[ni]);
        };
        return (
            <div style={{ fontFamily: FONT_UI, padding: '4px 0' }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                {/* Bottom clearance for the phone dock comes from the league shell
                    (.app-container[data-league-skin-type] pads by --wr-bottom-inset
                    at ≤767). The ActionBar (and its 66px clearance) was removed. */}
                <MobileClockBar state={state} currentSlot={currentSlot} isUserTurn={isUserTurn}
                    intel={draftCastIntel} />
                <div className="wr-seg" style={{ marginBottom: 10 }}>
                    {[['feed', 'Draft Feed'], ['board', 'Big Board'], ['roster', 'My Roster']].map(([k, l]) => (
                        <button key={k} type="button" className={phTab === k ? 'is-on' : ''} onClick={() => setPhTab(k)}>{l}</button>
                    ))}
                </div>
                {/* Panes scroll IN PLACE (owner ask): fixed-height containers so the
                    DraftCast bar, tabs, and bottom chips all stay on screen. */}
                {phTab === 'feed' && (
                    <DraftRoomFeed state={state} heightStyle={{ height: '56dvh', minHeight: 300 }}
                        emptyText="The feed starts when the first pick lands — picks and Alex's reads land here in order. Swipe left for the Big Board." />
                )}
                {phTab === 'board' && (<div style={{ height: '56dvh', minHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', paddingRight: 2 }}>
                    {drafting && (pro ? (
                        <section style={{ marginBottom: 10, padding: '10px 12px', background: wrAlpha(ALEXC, '0a'), border: '1px solid ' + wrAlpha(ALEXC, '3d'), borderRadius: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <span style={{ color: ALEXC, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em', flexShrink: 0 }}>Alex's pick</span>
                                {bpa && (
                                    <span style={{ color: 'var(--silver)', opacity: 0.72, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                        {(bpa.pos || '—') + ' · ' + mockPlayerTeam(bpa) + ' · DHQ ' + mockFmt(bpa.dhq)}
                                    </span>
                                )}
                            </div>
                            {bpa && (
                                <button type="button" onClick={() => mockOpenPlayer(bpa)} title="Open player card" style={{ display: 'block', minWidth: 0, maxWidth: '100%', padding: 0, margin: '3px 0 0', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', color: 'var(--white)', fontFamily: FONT_DISPL, fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {bpa.name}
                                </button>
                            )}
                            <div style={{ marginTop: 4, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.85, lineHeight: 1.4 }}>
                                {alexThinking
                                    ? 'Alex is reading the board…'
                                    : alexItem
                                        ? ((alexItem.title || '').replace(/^Alex\s*[·:—-]?\s*/i, '') + (alexItem.text ? ' — ' + alexItem.text : ''))
                                        : 'Alex is watching the board…'}
                            </div>
                        </section>
                    ) : (
                        <section style={{ marginBottom: 10 }}>
                            {window.WrGatedMoreRow
                                ? React.createElement(window.WrGatedMoreRow, { title: 'Alex hands you the pick', sub: 'Recommended / safe / upside cards each turn are Scout Pro. Draft from the raw board.', feature: 'draft_decision_deck' })
                                : <div dangerouslySetInnerHTML={{ __html: window.wrLockCard ? window.wrLockCard('Alex Decision Deck', 'draft_decision_deck', 'Per-turn pick recommendations are Scout Pro.') : '' }} />}
                        </section>
                    ))}
                    <div style={{ marginBottom: 10 }}>
                        <BigBoardPanel state={state} dispatch={dispatch} isUserTurn={isUserTurn} />
                    </div>
                </div>)}
                {phTab === 'roster' && (
                    <div style={{ height: '56dvh', minHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', paddingRight: 2 }}>
                        <MyDraftRosterPanel state={state} />
                    </div>
                )}
                {/* Opp Intel opens from the DraftCast card's Intel row (owner ask) —
                    only Ask Alex + Analytics live down here. */}
                <div className="wr-seg" style={{ margin: '10px 0' }}>
                    <button type="button" className={phPanel === 'alex' ? 'is-on' : ''} onClick={() => setPhPanel('alex')}>Ask Alex ▾</button>
                    <button type="button" className={phPanel === 'analytics' ? 'is-on' : ''} onClick={() => setPhPanel('analytics')}>Analytics ▾</button>
                </div>
                <Sheet open={phPanel === 'alex'} onClose={() => setPhPanel(null)} title="Ask Alex" desktop={null}>
                    <div style={{ padding: '4px 12px 10px', minHeight: 320, height: '68dvh' }}>
                        {AlexStreamPanel ? <AlexStreamPanel state={state} dispatch={dispatch} /> : null}
                    </div>
                </Sheet>
                <Sheet open={phPanel === 'intel'} onClose={() => setPhPanel(null)} title="Opponent Intel" desktop={null}>
                    <div style={{ padding: '4px 12px 10px', height: '68dvh' }}>
                        {OpponentIntelPanel ? <OpponentIntelPanel state={state} dispatch={dispatch} currentSlot={currentSlot} onPropose={onPropose} /> : null}
                    </div>
                </Sheet>
                <Sheet open={phPanel === 'analytics'} onClose={() => setPhPanel(null)} title="Draft Analytics" desktop={null}>
                    <div style={{ padding: '4px 12px 10px' }}>
                        {/* Live grade/value analytics are interpretation reads → Pro
                            (same A–F boundary as the desktop header grade chip). */}
                        {pro
                            ? (LiveAnalyticsPanel ? <LiveAnalyticsPanel state={state} /> : null)
                            : (window.WrGatedMoreRow
                                ? React.createElement(window.WrGatedMoreRow, { title: 'Live draft analytics', sub: 'Live grade, value-vs-board curve, and position flow are Scout Pro.', feature: 'draft_live_analytics' })
                                : <div dangerouslySetInnerHTML={{ __html: window.wrLockCard ? window.wrLockCard('Draft Analytics', 'draft_live_analytics', 'Live draft analytics are Scout Pro.') : '' }} />)}
                    </div>
                </Sheet>
                {/* Trade offer → the same popup desktop uses (room stays paused
                    behind it; Accept/Decline resume it). */}
                {tradeIsPro && state.activeOffer && TradeModal && <TradeModal state={state} dispatch={dispatch} />}
                {AskAnswerWindow && <AskAnswerWindow state={state} />}
                {/* AlexCall overlay removed on phone (owner ask) — the red DraftCast
                    takeover + edge glow already carry the your-turn signal. */}
                {AlexEdgeGlow && <AlexEdgeGlow state={state} isUserTurn={isUserTurn} />}
            </div>
        );
    }

    // ── Live League Grades overlay ────────────────────────────────────
    // A–F draft grades for EVERY team in the league, live during the draft.
    // Reuses the post-draft recap math (leagueTotalsFromPicks + buildTeamRecaps)
    // but renders as a lightweight, dismissible overlay instead of the full
    // post-draft modal. Toggled from the header "LEAGUE GRADES" button.
    function leagueGradeColor(letter) {
        const l = String(letter || '');
        if (l === '—') return 'var(--silver)';
        if (l.startsWith('A')) return 'var(--k-2ecc71, #2ecc71)';
        if (l.startsWith('B')) return 'var(--k-d4af37, #d4af37)';
        if (l.startsWith('C')) return 'var(--k-f0a500, #f0a500)';
        return 'var(--k-e74c3c, #e74c3c)';
    }

    function LeagueGradesPanel({ state, onClose }) {
        const recaps = React.useMemo(() => {
            const helpers = window.DraftCC?.state || {};
            if (!helpers.buildTeamRecaps || !helpers.leagueTotalsFromPicks) return [];
            try {
                const totals = helpers.leagueTotalsFromPicks(state.picks || []);
                return helpers.buildTeamRecaps(state, state.picks || [], totals) || [];
            } catch (e) {
                if (window.wrLog) window.wrLog('cc.leagueGrades', e);
                return [];
            }
        }, [state.picks, state.personas]);

        const userKey = String(state.userRosterId || '');
        const fmtDhq = value => {
            const n = Number(value || 0);
            return n ? n.toLocaleString() : '0';
        };

        return (
            <div
                style={{
                    position: 'fixed', inset: 0, background: 'var(--surf-solid, rgba(5,6,9,0.78))',
                    zIndex: 880, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    // 24px alone is less than the ~47-59px notch inset — clear it.
                    padding: 'var(--space-xl)', paddingTop: 'calc(var(--space-xl) + var(--sat, 0px))', animation: 'wrFadeIn 0.18s ease',
                }}
                onClick={e => { if (e.target === e.currentTarget) onClose && onClose(); }}
            >
                <div style={{
                    width: '100%', maxWidth: '720px', maxHeight: '88vh', overflowY: 'auto', overscrollBehavior: 'contain',
                    background: 'var(--k-0a0b0d, #0a0b0d)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.34))',
                    borderRadius: '14px', boxShadow: '0 28px 80px rgba(0,0,0,0.78)', fontFamily: FONT_UI,
                }}>
                    {/* Header */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '16px 20px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                        position: 'sticky', top: 0, background: 'var(--k-0a0b0d, #0a0b0d)', zIndex: 1,
                    }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Live · updates every pick</div>
                            <div style={{ fontFamily: FONT_DISPL, fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>League Draft Grades</div>
                        </div>
                        <button
                            onClick={() => onClose && onClose()}
                            aria-label="Close"
                            style={{
                                width: 30, height: 30, borderRadius: '50%',
                                background: 'var(--ov-2, rgba(255,255,255,0.04))',
                                border: '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                                color: 'var(--silver)', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1,
                                flexShrink: 0,
                            }}
                        >✕</button>
                    </div>

                    {/* Grade rows */}
                    <div style={{ padding: '12px 16px' }}>
                        {recaps.length === 0 && (
                            <div style={{ padding: '28px 10px', textAlign: 'center', color: 'var(--silver)', opacity: 0.5, fontSize: 'var(--text-label, 0.75rem)' }}>
                                No teams to grade yet.
                            </div>
                        )}
                        {recaps.map((row, idx) => {
                            const hasPicks = (row.picks || []).length > 0;
                            const letter = hasPicks ? (row.grade || '—') : '—';
                            const color = leagueGradeColor(letter);
                            const isUser = String(row.rosterId || '') === userKey;
                            const steal = row.bestValue || (row.steals || [])[0] || null;
                            const reach = row.biggestReach || (row.reaches || [])[0] || null;
                            return (
                                <div key={(row.rosterId ?? 'r') + ':' + idx} style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '10px 10px',
                                    borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))',
                                    background: isUser ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent',
                                    borderRadius: isUser ? '6px' : 0,
                                }}>
                                    <div style={{
                                        fontFamily: FONT_MONO, fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700,
                                        color: 'var(--silver)', opacity: 0.7, width: 22, textAlign: 'right', flexShrink: 0,
                                    }}>#{row.rank ?? idx + 1}</div>
                                    <div style={{
                                        fontFamily: FONT_DISPL, fontSize: '1.4rem', fontWeight: 800, color,
                                        width: 38, textAlign: 'center', flexShrink: 0, lineHeight: 1,
                                    }}>{letter}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                                        }}>
                                            <strong style={{ color: 'var(--white)', fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {row.teamName || 'Team'}
                                            </strong>
                                            {isUser && (
                                                <span style={{ flexShrink: 0, color: 'var(--gold)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, letterSpacing: '0.06em' }}>YOU</span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', gap: 10, marginTop: 2, color: 'var(--silver)', opacity: 0.74, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_MONO }}>
                                            <span>{fmtDhq(row.totalDHQ)} DHQ</span>
                                            <span>{(row.picks || []).length} pick{(row.picks || []).length === 1 ? '' : 's'}</span>
                                        </div>
                                        {(steal || reach) && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3, fontSize: 'var(--text-micro, 0.6875rem)', lineHeight: 1.3 }}>
                                                {steal?.name && (steal.valueDelta || 0) > 0 && (
                                                    <span style={{ color: 'var(--k-2ecc71, #2ecc71)' }}>
                                                        ↓ Steal: {steal.name}
                                                    </span>
                                                )}
                                                {reach?.name && (reach.valueDelta || 0) < 0 && (
                                                    <span style={{ color: 'var(--k-e74c3c, #e74c3c)' }}>
                                                        ↑ Reach: {reach.name}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    // ── Expose ───────────────────────────────────────────────────────
    window.DraftCommandCenter = DraftCommandCenter;
    window.DraftCC = window.DraftCC || {};
    window.DraftCC.LeagueGradesPanel = LeagueGradesPanel;
    window.DraftCC.DraftRecapReport = DraftRecapReport;
    window.DraftCC.featureFlag = {
        key: FEATURE_FLAG_KEY,
        isEnabled: isFeatureEnabled,
    };
})();
