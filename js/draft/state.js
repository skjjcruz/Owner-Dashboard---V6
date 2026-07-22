// ══════════════════════════════════════════════════════════════════
// js/draft/state.js — draftState reducer + localStorage hydration
//
// Owns the single source of truth for the Draft Command Center.
// The main <DraftCommandCenter/> component uses useReducer over this
// reducer; panels read from it via React context.
//
// Phase 1 implements the core flow:
//   - SETUP    — user picks mode/rounds/draftPos, pool is built
//   - DRAFTING — picks advance, pool shrinks, teamRosters update
//   - COMPLETE — end state, grade computed
//
// Phase 2+ extends with personas updates, trade offers, analytics.
//
// Depends on: scouting.js (window.getProspects), trade-calc.js globals
// Exposes:    window.DraftCC.state.{ reducer, initialDraftState, buildPool, buildPickOrder, saveToLocal, loadFromLocal }
// ══════════════════════════════════════════════════════════════════

(function() {
    const DRAFT_STATE_VERSION = 1;
    // Phase 5+: separate keys per tab (Mock Draft Center vs Follow Live Draft)
    // so each tab maintains its own auto-resume state without stepping on the other.
    const LS_KEY = (leagueId, forcedMode) => {
        const mode = forcedMode === 'live-sync' ? 'live' : 'mock';
        return 'wr_draft_cc_current_' + mode + '_' + (leagueId || 'default');
    };
    const DRAFT_TUNING_KEYS = ['ownerDna', 'classValue', 'needFit', 'tradeActivity', 'variance'];
    const DEFAULT_DRAFT_TUNING = {
        ownerDna: 70,
        classValue: 65,
        needFit: 60,
        tradeActivity: 50,
        variance: 45,
    };
    const DRAFT_STRATEGY_PRESETS = [
        {
            id: 'front-office-blend',
            label: 'League Blend',
            shortLabel: 'Blend',
            philosophy: 'Balanced board, owner history, roster fit, and normal trade pressure.',
            tuning: { ownerDna: 72, classValue: 70, needFit: 62, tradeActivity: 50, variance: 28 },
        },
        {
            id: 'owner-dna-mirror',
            label: 'Owner DNA Mirror',
            shortLabel: 'DNA',
            philosophy: 'Historical owner tendencies lead the room.',
            tuning: { ownerDna: 94, classValue: 54, needFit: 48, tradeActivity: 48, variance: 24 },
        },
        {
            id: 'class-scout',
            label: 'Board Scout',
            shortLabel: 'Board',
            philosophy: 'The player crop, board tiers, and roster fit drive the room.',
            tuning: { ownerDna: 46, classValue: 90, needFit: 72, tradeActivity: 38, variance: 18 },
        },
        {
            id: 'need-pressure',
            label: 'Need Pressure',
            shortLabel: 'Needs',
            philosophy: 'Teams draft to fix roster pressure points early.',
            tuning: { ownerDna: 58, classValue: 52, needFit: 94, tradeActivity: 44, variance: 22 },
            hidden: true,
        },
        {
            id: 'trade-market',
            label: 'Trade Market',
            shortLabel: 'Trades',
            philosophy: 'Tier chases and owner leverage create a more active room.',
            tuning: { ownerDna: 76, classValue: 60, needFit: 62, tradeActivity: 92, variance: 34 },
            hidden: true,
        },
        {
            id: 'no-trades',
            label: 'No Trades',
            shortLabel: 'Locked',
            philosophy: 'The room stays on its own picks.',
            tuning: { ownerDna: 70, classValue: 74, needFit: 58, tradeActivity: 0, variance: 14 },
            lockedTradeActivity: 0,
            hidden: true,
        },
        {
            id: 'chaos-room',
            label: 'Chaos Room',
            shortLabel: 'Chaos',
            philosophy: 'Wider variance, more smoke, and less board discipline.',
            tuning: { ownerDna: 58, classValue: 38, needFit: 50, tradeActivity: 72, variance: 88 },
            hidden: true,
        },
        {
            id: 'custom-studio',
            label: 'Custom Studio',
            shortLabel: 'Custom',
            philosophy: 'Hand-tuned by the GM.',
            tuning: DEFAULT_DRAFT_TUNING,
            hidden: true,
        },
    ];

    function clampPct(value, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return Number(fallback || 0);
        return Math.max(0, Math.min(100, Math.round(n)));
    }

    function mergeDraftTuning(base, patch) {
        const out = {};
        DRAFT_TUNING_KEYS.forEach(key => {
            out[key] = clampPct((patch || {})[key] ?? (base || {})[key], DEFAULT_DRAFT_TUNING[key]);
        });
        return out;
    }

    function draftStrategyStudioKey(leagueId) {
        return 'wr_draft_strategy_studio_' + (leagueId || 'default');
    }

    function getDraftStrategyPresets() {
        return DRAFT_STRATEGY_PRESETS.map(preset => ({
            ...preset,
            tuning: { ...preset.tuning },
        }));
    }

    function findDraftStrategyPreset(id) {
        return DRAFT_STRATEGY_PRESETS.find(preset => preset.id === id) || DRAFT_STRATEGY_PRESETS[0];
    }

    function gmModeDraftAdjustment(gmMode) {
        const mode = String(gmMode || '').toLowerCase();
        if (mode === 'rebuild') {
            return { ownerDna: 2, classValue: 6, needFit: -8, tradeActivity: 4, variance: -4 };
        }
        if (mode === 'win_now' || mode === 'contend') {
            return { ownerDna: 0, classValue: -5, needFit: 12, tradeActivity: 8, variance: 2 };
        }
        return { ownerDna: 0, classValue: 0, needFit: 0, tradeActivity: 0, variance: 0 };
    }

    function inferGmMode(leagueId, opts = {}) {
        const explicit = opts.gmMode || opts.gmStrategy?.mode || opts.strategy?.mode;
        if (explicit) return String(explicit);
        try {
            if (window.WR?.GmMode?.getMode) return window.WR.GmMode.getMode(leagueId);
        } catch (_) {}
        return 'compete';
    }

    function buildDraftStrategyProfile(opts = {}) {
        const leagueId = opts.leagueId || '';
        const preset = findDraftStrategyPreset(opts.presetId || opts.id);
        const base = mergeDraftTuning(DEFAULT_DRAFT_TUNING, opts.baseTuning || {});
        const learning = opts.recapLearning || null;
        const gmMode = inferGmMode(leagueId, opts);
        const gmAdjust = gmModeDraftAdjustment(gmMode);
        // GM Strategy aggression nudges in-draft trade frequency on top of mode
        // (conservative trades less, aggressive trades more).
        try {
            const eff = window.WR?.GmMode?.effects?.(leagueId);
            if (eff && Number.isFinite(eff.aggression)) {
                gmAdjust.tradeActivity = (gmAdjust.tradeActivity || 0) + Math.round((eff.aggression - 0.52) * 40);
            }
        } catch (_) { /* ignore */ }
        let tuning = mergeDraftTuning(base, preset.tuning);

        DRAFT_TUNING_KEYS.forEach(key => {
            tuning[key] = clampPct(tuning[key] + (gmAdjust[key] || 0), tuning[key]);
        });

        if (learning?.sampleSize && learning.suggestedTuning && preset.id !== 'no-trades') {
            DRAFT_TUNING_KEYS.forEach(key => {
                const learned = Number(learning.suggestedTuning[key]);
                if (Number.isFinite(learned)) {
                    tuning[key] = clampPct(tuning[key] * 0.76 + learned * 0.24, tuning[key]);
                }
            });
        }
        if (preset.lockedTradeActivity != null) tuning.tradeActivity = clampPct(preset.lockedTradeActivity, 0);
        if (opts.tuning) tuning = mergeDraftTuning(tuning, opts.tuning);
        if (preset.lockedTradeActivity != null) tuning.tradeActivity = clampPct(preset.lockedTradeActivity, 0);

        const now = opts.updatedAt || Date.now();
        return {
            schemaVersion: 'draft-strategy-profile-v1',
            id: opts.profileId || opts.profile?.id || ('draft_strategy_' + now),
            leagueId,
            presetId: preset.id,
            label: opts.label || preset.label,
            shortLabel: preset.shortLabel || preset.label,
            philosophy: opts.philosophy || preset.philosophy,
            gmMode,
            variant: opts.variant || opts.draftType || 'all',
            tuning,
            aiSignals: {
                ownerHistory: tuning.ownerDna,
                classCrop: tuning.classValue,
                rosterFit: tuning.needFit,
                tradeMode: tuning.tradeActivity <= 3 ? 'off' : tuning.tradeActivity >= 75 ? 'aggressive' : 'normal',
                varianceModel: tuning.variance >= 70 ? 'wide' : tuning.variance <= 20 ? 'tight' : 'balanced',
            },
            recapLearningSample: learning?.sampleSize || 0,
            source: opts.source || (opts.saved ? 'saved_profile' : 'strategy_studio'),
            saved: !!opts.saved,
            updatedAt: now,
        };
    }

    function normalizeDraftStrategyProfile(profile, opts = {}) {
        if (!profile) return null;
        return buildDraftStrategyProfile({
            ...profile,
            presetId: profile.presetId || profile.id,
            profileId: profile.id,
            leagueId: profile.leagueId || opts.leagueId,
            baseTuning: opts.baseTuning,
            recapLearning: opts.recapLearning,
            gmMode: profile.gmMode || opts.gmMode,
            tuning: profile.tuning,
            label: profile.label,
            philosophy: profile.philosophy,
            variant: profile.variant || opts.variant,
            saved: opts.saved ?? profile.saved,
            source: profile.source || opts.source,
            updatedAt: profile.updatedAt || Date.now(),
        });
    }

    function loadDraftStrategyProfile(leagueId, opts = {}) {
        if (!leagueId || typeof localStorage === 'undefined') {
            return buildDraftStrategyProfile({ ...opts, leagueId, source: 'default_profile' });
        }
        try {
            const raw = localStorage.getItem(draftStrategyStudioKey(leagueId));
            if (raw) {
                const parsed = JSON.parse(raw);
                return normalizeDraftStrategyProfile(parsed, {
                    ...opts,
                    leagueId,
                    saved: true,
                    source: 'saved_profile',
                });
            }
        } catch (e) {
            if (window.wrLog) window.wrLog('draftState.loadStrategyProfile', e);
        }
        return buildDraftStrategyProfile({ ...opts, leagueId, source: 'gm_mode_default' });
    }

    function saveDraftStrategyProfile(leagueId, profile) {
        if (!leagueId || typeof localStorage === 'undefined') return null;
        const normalized = normalizeDraftStrategyProfile(profile, {
            leagueId,
            saved: true,
            source: 'saved_profile',
        });
        if (!normalized) return null;
        const saved = {
            ...normalized,
            leagueId,
            saved: true,
            source: 'saved_profile',
            updatedAt: Date.now(),
        };
        try {
            localStorage.setItem(draftStrategyStudioKey(leagueId), JSON.stringify(saved));
        } catch (e) {
            if (window.wrLog) window.wrLog('draftState.saveStrategyProfile', e);
        }
        return saved;
    }

    function applyDraftStrategyProfileToTuning(profile, baseTuning) {
        return mergeDraftTuning(baseTuning || DEFAULT_DRAFT_TUNING, profile?.tuning || {});
    }

    function initialLiveSyncState(patch = {}) {
        return {
            status: 'idle', // 'idle' | 'waiting' | 'mirroring' | 'stale' | 'error' | 'complete'
            draftStatus: '',
            lastPollAt: null,
            startedAt: null,
            lastPickNo: 0,
            expectedPickNo: 1,
            remoteMaxPickNo: 0,
            remotePickCount: 0,
            duplicateCount: 0,
            missedPickCount: 0,
            missingPickNos: [],
            conflictCount: 0,
            conflictPickNos: [],
            invalidPickCount: 0,
            remoteBehind: false,
            stale: false,
            error: null,
            ...(patch || {}),
        };
    }

    function mergeLiveSync(current, patch = {}) {
        const next = { ...initialLiveSyncState(), ...(current || {}), ...(patch || {}) };
        if (patch.error === null) next.error = null;
        if (patch.status === 'mirroring' || patch.status === 'waiting' || patch.status === 'complete') {
            // Only clear stale when nothing is left unresolved. A healthy-looking
            // status string must NOT paper over a real gap/conflict — otherwise the
            // banner flips green while the mirror is still stuck behind a missing pick.
            const hasUnresolved = !!(
                (patch.missingPickNos && patch.missingPickNos.length) ||
                (next.missingPickNos && next.missingPickNos.length) ||
                (patch.conflictPickNos && patch.conflictPickNos.length) ||
                (next.conflictPickNos && next.conflictPickNos.length) ||
                patch.remoteBehind || next.remoteBehind
            );
            if (!hasUnresolved) next.stale = false;
        }
        return next;
    }

    function livePickNo(pick) {
        return Number(pick?.sleeperPickNo || pick?.sleeperPick?.pick_no || pick?.pick_no || 0);
    }

    // ── Initial state factory ────────────────────────────────────────
    function initialDraftState(opts = {}) {
        return {
            version: DRAFT_STATE_VERSION,
            phase:   'setup',       // 'setup' | 'drafting' | 'complete'
            id:      'dcc_' + Date.now(),
            leagueId: opts.leagueId || '',
            season:   opts.season || new Date().getFullYear(),
            mode:     opts.mode || 'solo',      // 'solo' | 'manual' | 'ghost' | 'scenario' | 'live-sync'
            variant:  opts.variant || 'startup', // 'rookie' | 'startup' | 'redraft' | 'best_ball'
            speed:    opts.speed || 'medium',    // 'slow' | 'medium' | 'fast'
            draftTuning: {
                ...DEFAULT_DRAFT_TUNING,
                ...(opts.draftTuning || {}),
            },
            strategyProfile: opts.strategyProfile || null,

            // Setup config
            rounds: opts.rounds || 5,
            leagueSize: opts.leagueSize || 12,
            // Copies of each player the league allows on rosters (MFL multi-copy
            // leagues = 3). 1 for every standard league ⇒ pool/dedup logic below
            // behaves exactly as before. A player stays draftable until `copies`
            // teams have taken him.
            playerCopies: Math.max(1, Number(opts.playerCopies) || 1),
            draftType: opts.draftType || 'snake',
            userRosterId: opts.userRosterId || null,
            userSlot: opts.userSlot || 1,      // 1-indexed
            sleeperDraftId: opts.sleeperDraftId || null,
            liveDraftMeta: opts.liveDraftMeta || null,

            // Pool + order
            pool: [],
            originalPool: [],
            pickOrder: [],

            // Picks & drafted
            picks: [],
            pickedByIdx: {},
            draftedPids: {}, // Object for easy JSON serialization (set-like)
            currentIdx: 0,

            // Team intelligence
            personas: {},
            draftContext: null,
            teamRosters: {}, // teamIdx → [pos, pos, ...]
            pinnedRosterId: null,

            // Trade state (Phase 3)
            activeOffer: null,
            proposerDrawer: null,
            completedTrades: [],
            // Live-draft traded picks (Sleeper traded_picks), normalized to
            // { round, rosterId, fromRosterId }. Bridged in via SET_TRADED_PICKS so
            // the recap's trade impact + trade volume can see live pick movement.
            tradedPicks: [],
            // Ledger of player + FAAB movement from accepted trades. Keyed by
            // rosterId. Consumers (opponent intel, roster views, simulator)
            // can apply this on top of base rosters to derive effective
            // post-trade state inside the mock draft context.
            // { [rosterId]: { incomingPlayers: [pid], outgoingPlayers: [pid], faabDelta: number } }
            tradedAssets: {},

            // Sandbox-only ledger of next-season picks that changed hands in-sim.
            // { [futurePickKey]: newOwnerRosterId }. Never written to Sleeper.
            futurePicksLedger: {},

            // Analytics (Phase 4)
            analytics: {
                liveHealth: { at: 0, delta: 0 },
                liveGrade: { letter: '?', totalDHQ: 0 },
                tierTransition: null,
                positionRuns: {},
                valueCurve: [],
            },

            // Alex (Phase 4)
            alex: {
                style: 'default',
                stream: [],
                alexSpend: { sonnet: 0, flash: 0, budget: 12 },
                thinking: false,
                lastInsightAt: 0,
            },

            briefing: null,
            replay: null,
            scenarioId: null,
            scenarioNarrative: null,
            recapLearning: null,
            liveSync: initialLiveSyncState(),
            stagedLiveOffers: [],
            manualCorrections: [],

            // Phase 5+: when set, the next MAKE_PICK dispatch will be applied
            // as if the user made it FOR the CPU team on the clock. Auto-clears.
            overrideMode: false,
        };
    }

    function normProspectName(name) {
        return (name || '')
            .toLowerCase()
            .replace(/[''`.]/g, '')
            .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Nickname-tolerant rookie name match. Catches the initialism case where Sleeper
    // carries a player under a short nickname (e.g. "KC Concepcion") while our prospect
    // data uses the given name ("Kevin Concepcion") — same player, must not surface as
    // two rows. Conservative: last names must match, and first names match only when
    // equal, one prefixes the other (Will/William), or one is a <=2-char initialism
    // sharing the first letter (KC/Kevin, TJ/Tyler). Distinct full first names (Kyle vs
    // Kevin) never match.
    function rookieNameMatch(aName, bName) {
        const a = normProspectName(aName);
        const b = normProspectName(bName);
        if (!a || !b) return false;
        if (a === b) return true;
        const ap = a.split(' ');
        const bp = b.split(' ');
        if (ap.length < 2 || bp.length < 2) return false;
        if (ap[ap.length - 1] !== bp[bp.length - 1]) return false;
        const af = ap[0];
        const bf = bp[0];
        if (af === bf) return true;
        if (af.startsWith(bf) || bf.startsWith(af)) return true;
        if (af[0] === bf[0] && (af.length <= 2 || bf.length <= 2)) return true;
        return false;
    }

    function matchSleeperRookie(prospect, playersData) {
        const target = normProspectName(prospect?.name);
        if (!target) return null;
        const src = playersData || window.S?.players || {};
        // Exact normalized name wins; remember the first nickname-compatible rookie as a
        // fallback so e.g. Sleeper "KC Concepcion" links to prospect "Kevin Concepcion".
        let alias = null;
        for (const [pid, player] of Object.entries(src)) {
            if (!player || player.years_exp !== 0) continue;
            const fullName = player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim();
            const norm = normProspectName(fullName);
            if (norm === target) return { pid, player };
            if (!alias && rookieNameMatch(target, norm)) alias = { pid, player };
        }
        return alias;
    }

    function firstPositiveNumber(values) {
        for (const value of values) {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0) return Math.round(n);
        }
        return 0;
    }

    function canonicalRookieValue(input) {
        const source = input?.csv || input || {};
        const direct = firstPositiveNumber([
            source.dynastyValue,
            source.baseDynastyValue,
            source.draftCapitalValue,
        ]);
        if (direct > 0) return direct;
        const name = source.name || input?.name || input?.full_name || '';
        if (name && window.RookieData?.findProspect) {
            try {
                const prospect = window.RookieData.findProspect(name);
                return firstPositiveNumber([
                    prospect?.dynastyValue,
                    prospect?.baseDynastyValue,
                    prospect?.draftCapitalValue,
                ]);
            } catch (e) {}
        }
        return 0;
    }

    function resolvePlayerDhq(input) {
        const player = input?.player || input || {};
        const pid = input?.pid || input?.player_id || input?.playerId || player.pid || player.player_id || player.playerId || player.sleeperId;
        if (pid != null) {
            const engine = Number(window.App?.LI?.playerScores?.[pid] || 0);
            if (engine > 0) return { value: Math.round(engine), source: 'App.LI.playerScores' };
        }
        const rookieValue = canonicalRookieValue(input);
        if (rookieValue > 0) return { value: rookieValue, source: 'RookieData.dynastyValue' };
        const attached = firstPositiveNumber([player.dhq, player.val, input?.dhq, input?.val]);
        return { value: attached, source: attached ? 'attached-dhq' : 'missing' };
    }

    function normalizeLeagueTypeValue(value) {
        if (value == null || value === '') return '';
        const raw = String(value).trim().toLowerCase();
        const aliases = {
            0: 'redraft',
            1: 'keeper',
            2: 'dynasty',
            re_draft: 'redraft',
            season_long: 'redraft',
            bestball: 'best_ball',
            best_ball: 'best_ball',
        };
        return aliases[raw] || raw;
    }

    function firstKnown(values) {
        for (const value of values) {
            if (value !== undefined && value !== null && value !== '') return value;
        }
        return '';
    }

    function detectDraftVariant(opts = {}) {
        const draft = opts.draft || opts.upcomingDraft || opts.sleeperDraft || null;
        const league = opts.currentLeague || opts.league || window.S?.leagues?.[0] || {};
        const settings = draft?.settings || {};
        const playerTypeRaw = settings.player_type;
        const hasPlayerType = playerTypeRaw !== undefined && playerTypeRaw !== null && playerTypeRaw !== '';
        const playerType = Number(playerTypeRaw);
        const draftText = [
            draft?.metadata?.name,
            draft?.metadata?.description,
            draft?.type,
        ].filter(Boolean).join(' ').toLowerCase();

        if (hasPlayerType && playerType === 1) return 'rookie';

        let profile = opts.leagueProfile || null;
        if (!profile && typeof window.App?.Intelligence?.buildLeagueProfile === 'function') {
            try {
                profile = window.App.Intelligence.buildLeagueProfile({
                    league,
                    rosters: opts.rosters || league?.rosters || window.S?.rosters || [],
                    platform: opts.platform || league?._platform || window.S?.platform,
                });
            } catch (e) {}
        }

        const leagueType = normalizeLeagueTypeValue(firstKnown([
            opts.leagueType,
            opts.type,
            profile?.type,
            league?.profileType,
            league?.leagueType,
            league?.league_type,
            league?.settings?.type,
            league?.type,
        ]));
        const bestBall = leagueType === 'best_ball'
            || !!league?.settings?.best_ball
            || !!league?.best_ball
            || /best\s*ball/.test(draftText);
        if (bestBall) return 'best_ball';

        const explicitAllPlayers = hasPlayerType && playerType === 0;
        if (!explicitAllPlayers && /\brookie\b/.test(draftText)) return 'rookie';
        if (leagueType === 'redraft') return 'redraft';
        return opts.fallback || 'startup';
    }

    function redraftPositionBaseline(pos, variant) {
        if (variant !== 'redraft' && variant !== 'best_ball') return 0;
        if (pos === 'DEF') return 760;
        if (pos === 'K') return 520;
        return 0;
    }

    function resolveDraftPickValue(input = {}) {
        const round = Math.max(1, Number(input.round) || 1);
        const teams = Math.max(1, Number(input.leagueSize || input.totalTeams || input.teams) || 12);
        // Every value model downstream (getPickValue → dhqPickValueFn, pickValueBySlot,
        // getPickValueBySlot) expects pick-WITHIN-round — NOT the team's draft column.
        // Prefer deriving it from the true overall so snake even rounds can never mirror.
        const overallInput = Math.max(0, Number(input.overall) || 0);
        const slot = overallInput > 0
            ? ((overallInput - 1) % teams) + 1
            : Math.max(1, Number(input.pickInRound || input.slot) || Math.ceil(teams / 2));
        const defaultRounds = window.App?.PlayerValue?.DRAFT_ROUNDS || 7;
        const rounds = Math.max(1, Number(input.rounds || input.draftRounds) || defaultRounds);
        const season = input.season || window.S?.season || new Date().getFullYear();
        const overall = overallInput || ((round - 1) * teams + slot);
        const playerValue = window.App?.PlayerValue || {};
        let value = 0;
        let source = 'missing';
        try {
            if (typeof playerValue.getPickValue === 'function') {
                value = Number(playerValue.getPickValue(season, round, teams, slot, rounds)) || 0;
                if (value > 0) source = 'App.PlayerValue.getPickValue';
            }
            if (!value && typeof playerValue.pickValueBySlot === 'function') {
                value = Number(playerValue.pickValueBySlot(round, slot, teams, rounds)) || 0;
                if (value > 0) source = 'App.PlayerValue.pickValueBySlot';
            }
            if (!value && typeof window.getPickValueBySlot === 'function') {
                value = Number(window.getPickValueBySlot(round, slot, teams, rounds)) || 0;
                if (value > 0) source = 'RookieData.pickValueBySlot';
            }
            if (!value && typeof window.getIndustryPickValue === 'function') {
                value = Number(window.getIndustryPickValue(overall, teams, rounds)) || 0;
                if (value > 0) source = 'getIndustryPickValue';
            }
            if (!value && playerValue.PICK_VALUES_BY_SLOT?.[overall]) {
                value = Number(playerValue.PICK_VALUES_BY_SLOT[overall]) || 0;
                if (value > 0) source = 'App.PlayerValue.PICK_VALUES_BY_SLOT';
            }
            if (!value && playerValue.PICK_VALUES?.[round]) {
                value = Number(playerValue.PICK_VALUES[round]) || 0;
                if (value > 0) source = 'App.PlayerValue.PICK_VALUES';
            }
        } catch (e) {}
        return { value: Math.max(0, Math.round(value || 0)), source, overall };
    }

    // ── Future (next-season) pick pool — SANDBOX ONLY ──────────────────────
    // The draft sim has no concept of next-season picks. Trading them stays entirely
    // inside the simulation — never written to Sleeper or window.S.tradedPicks. We
    // synthesize a clean 1-pick-per-round-per-team pool for the next N seasons;
    // in-sim ownership changes are recorded in state.futurePicksLedger and reflected
    // back onto the pool here. Values use resolveDraftPickValue with the future season,
    // which already applies the dynasty future discount (~12%/yr) via getPickValue.
    function futurePickKey(p) {
        return 'FUT:' + p.year + ':' + p.round + ':' + p.fromRosterId;
    }

    function futurePickValueFor(state, p) {
        if (Number(p?.value) > 0) return Math.round(Number(p.value));
        const r = resolveDraftPickValue({
            season: p?.year,
            round: p?.round,
            leagueSize: state?.leagueSize,
            rounds: state?.rounds,
        });
        return r?.value || 0;
    }

    function buildFuturePickPool(state, opts = {}) {
        const rosters = window.S?.rosters || [];
        const baseSeason = Number(state?.season) || Number(window.S?.season) || new Date().getFullYear();
        const horizon = Math.max(1, Math.min(3, opts.horizon || 2)); // next 1–2 seasons by default
        const rounds = Math.max(1, Number(state?.rounds) || (window.App?.PlayerValue?.DRAFT_ROUNDS) || 5);
        const ledger = state?.futurePicksLedger || {};
        const pool = [];
        for (let y = baseSeason + 1; y <= baseSeason + horizon; y++) {
            for (const roster of rosters) {
                const fromRosterId = String(roster.roster_id);
                for (let rd = 1; rd <= rounds; rd++) {
                    const pick = {
                        type: 'pick',
                        future: true,
                        year: y,
                        round: rd,
                        fromRosterId,
                        id: 'FPICK-' + y + '-' + rd + '-' + fromRosterId,
                        label: y + ' R' + rd,
                    };
                    pick.value = futurePickValueFor(state, pick);
                    const owner = ledger[futurePickKey(pick)];
                    pick.ownerRosterId = owner != null ? String(owner) : fromRosterId;
                    pool.push(pick);
                }
            }
        }
        return pool;
    }

    // ── Pool builder — use canonical rookie data or Sleeper DHQ scores ──
    function buildPool(opts = {}) {
        const { variant = 'startup', playersData, maxSize = 200 } = opts;
        const normPos = window.App?.normPos || (p => p);

        // Rookie variant — pull from CSV prospects
        if (variant === 'rookie') {
            if (typeof window.getProspects === 'function') {
                const prospects = window.getProspects();
                if (prospects && prospects.length) {
                    return prospects.map(p => {
                        const sleeper = matchSleeperRookie(p, playersData);
                        const sid = sleeper?.pid || p.sleeperId || p.player_id || p.playerId || p.pid;
                        const resolved = resolvePlayerDhq({ ...p, pid: sid, csv: p, player: sleeper?.player, name: sleeper?.player?.full_name || p.name });
                        // Determine NFL experience. matchSleeperRookie only matches
                        // years_exp===0 players, so a returning player (e.g. a 2nd-year
                        // IDP that leaked into the prospect CSV) comes back as no match —
                        // look it up by its resolved id so we still see its real
                        // experience. No id / not in the player DB ⇒ incoming rookie.
                        const sleeperPlayer = sleeper?.player
                            || (sid != null ? (playersData || window.S?.players || {})[sid] : null)
                            || null;
                        const yearsExpRaw = sleeperPlayer?.years_exp ?? sleeperPlayer?.yearsExp;
                        const yearsExp = Number.isFinite(Number(yearsExpRaw)) ? Number(yearsExpRaw) : null;
                        return {
                            pid: sid || p.pid,
                            csvPid: p.pid,
                            name: sleeper?.player?.full_name || p.name,
                            pos: p.pos || p.mappedPos || normPos(sleeper?.player?.position) || 'WR',
                            team: sleeper?.player?.team || '',
                            college: p.college || p.school || sleeper?.player?.college || '',
                            age: p.age || p.csv?.age || sleeper?.player?.age || null,
                            yearsExp,
                            years_exp: yearsExp,
                            isRookie: yearsExp == null || yearsExp === 0,
                            dhq: resolved.value,
                            csv: p,
                            photoUrl: sleeper
                                ? 'https://sleepercdn.com/content/nfl/players/thumb/' + sid + '.jpg'
                                : (p.photoUrl || (p.espnId ? 'https://a.espncdn.com/i/headshots/college-football/players/full/' + p.espnId + '.png' : '')),
                            consensusRank: p.consensusRank || p.rank,
                            tier: p.tier,
                            size: p.size,
                            weight: p.weight,
                            speed: p.speed,
                            summary: p.summary,
                            source: resolved.source,
                            isCSV: true,
                        };
                    })
                        // Rookie pool = first-year players only. Drop any prospect that
                        // resolved to a Sleeper player with NFL experience — those are
                        // returning players (e.g. 2nd-year IDP scored on real production)
                        // that don't belong on the rookie board.
                        .filter(p => p.yearsExp == null || p.yearsExp === 0)
                        .sort((a, b) => (b.dhq || 0) - (a.dhq || 0))
                        .slice(0, maxSize);
                }
            }
            // Fall through to startup if CSV missing
        }

        // Startup/redraft variants — pull from Sleeper DHQ scores, with
        // rookie-data fallback for first-year players not yet scored by LI.
        const getDHQ = (pid, player, name) => {
            if (typeof window.dynastyValue === 'function') {
                const v = window.dynastyValue(pid);
                if (v > 0) return { value: Math.round(v), source: 'window.dynastyValue' };
            }
            return resolvePlayerDhq({ pid, player, name });
        };
        const VALID = (typeof window.getLeaguePositions === 'function')
            ? window.getLeaguePositions({ asSet: true })
            : new Set(['QB','RB','WR','TE','K','DEF']);
        const src = playersData || window.S?.players || {};
        const pool = Object.entries(src)
            .filter(([, p]) => VALID.has(normPos(p.position)) && p.status !== 'Inactive' && (p.first_name || p.full_name))
            .map(([pid, p]) => {
                const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
                const pos = normPos(p.position);
                const resolved = getDHQ(pid, p, name);
                const yearsExpRaw = p.years_exp ?? p.yearsExp;
                const yearsExp = Number.isFinite(Number(yearsExpRaw)) ? Number(yearsExpRaw) : null;
                const fallbackValue = redraftPositionBaseline(pos, variant);
                const dhq = resolved.value || fallbackValue;
                return {
                    pid,
                    name,
                    pos,
                    position: pos,
                    team: p.team || 'FA',
                    college: p.college || p.metadata?.college || '',
                    age: p.age || (p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null),
                    birth_date: p.birth_date || null,
                    yearsExp,
                    years_exp: yearsExp,
                    isRookie: yearsExp === 0,
                    dhq,
                    val: dhq,
                    source: resolved.value ? resolved.source : (fallbackValue ? 'redraft-position-baseline' : resolved.source),
                    csv: null,
                    photoUrl: 'https://sleepercdn.com/content/nfl/players/thumb/' + pid + '.jpg',
                };
            })
            .filter(p => p.dhq > 0)
            .sort((a, b) => b.dhq - a.dhq)
            .slice(0, maxSize);

        // Synthetic consensusRank for reach/steal detection in startup mode —
        // index in the DHQ-sorted pool is the "consensus" rank order.
        pool.forEach((p, i) => { p.consensusRank = i + 1; });
        return pool;
    }

    // ── Pick order builder ───────────────────────────────────────────
    function buildPickOrder(rounds, leagueSize, draftType, slotToRoster = {}, pickOwnership = {}) {
        const order = [];
        for (let r = 1; r <= rounds; r++) {
            const rev = draftType === 'snake' && r % 2 === 0;
            for (let s = 0; s < leagueSize; s++) {
                const teamIdx = rev ? leagueSize - 1 - s : s;
                const slot = teamIdx + 1; // 1-indexed team column — ownership key only
                const pickInRound = s + 1; // 1-indexed pick-within-round — labels + values
                const origInfo = slotToRoster[slot] || {};
                const ownershipKey = r + '-' + slot;
                const owner = pickOwnership[ownershipKey] || { rosterId: origInfo.rosterId, ownerName: origInfo.ownerName, traded: false };
                const overall = order.length + 1;
                const pickValue = resolveDraftPickValue({
                    season: window.S?.season,
                    round: r,
                    pickInRound,
                    overall,
                    leagueSize,
                    rounds,
                });
                order.push({
                    round: r,
                    slot,
                    pickInRound,
                    teamIdx,
                    overall,
                    originalRosterId: origInfo.rosterId || null,
                    rosterId: owner.rosterId || origInfo.rosterId || null,
                    originalOwnerName: origInfo.ownerName || ('Team ' + slot),
                    ownerName: owner.ownerName || origInfo.ownerName || ('Team ' + slot),
                    traded: !!owner.traded,
                    value: pickValue.value,
                    valueSource: pickValue.source,
                    actualPick: null,
                });
            }
        }
        return order;
    }

    function pickName(pick) {
        const player = pick?.player || {};
        return player.full_name || player.name || pick?.name || pick?.full_name || pick?.pid || '';
    }

    function pickPos(pick) {
        const player = pick?.player || {};
        return String(player.position || player.pos || pick?.pos || pick?.position || '').toUpperCase();
    }

    function pickDhq(pick) {
        const player = pick?.player || {};
        const pid = pick?.pid || pick?.player_id || player.pid || player.player_id || null;
        return resolvePlayerDhq({ ...player, ...pick, pid, csv: pick?.csv || player.csv }).value;
    }

    function normalizePickRecord(pick) {
        if (!pick) return null;
        return {
            ...pick,
            pid: pick.pid || pick.player?.pid || pick.player_id || null,
            name: pickName(pick),
            pos: pickPos(pick),
            dhq: pickDhq(pick),
        };
    }

    function buildPickedByIdx(picks) {
        return (picks || []).reduce((acc, raw) => {
            const pick = normalizePickRecord(raw);
            if (!pick || pick.overall == null) return acc;
            acc[pick.overall] = pick;
            return acc;
        }, {});
    }

    function leagueTotalsFromPicks(picks) {
        return (picks || []).reduce((acc, raw) => {
            const pick = normalizePickRecord(raw);
            const rosterId = pick?.rosterId;
            if (rosterId == null) return acc;
            acc[rosterId] = (acc[rosterId] || 0) + pickDhq(pick);
            return acc;
        }, {});
    }

    const RECAP_POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

    function rosterKey(value) {
        return value == null ? 'unknown' : String(value);
    }

    function rosterName(state, rosterId, fallback) {
        const key = rosterKey(rosterId);
        const persona = state?.personas?.[key] || state?.personas?.[rosterId];
        const ownerIntel = state?.draftContext?.ownerContext?.[key];
        return persona?.teamName || ownerIntel?.teamName || fallback || ('Team ' + key);
    }

    function pickConsensusRank(pick) {
        return Number(pick?.consensusRank || pick?.rank || pick?.analystBoardRank || 0) || 0;
    }

    function pickValueDelta(pick) {
        const rank = pickConsensusRank(pick);
        const overall = Number(pick?.overall || 0);
        return rank && overall ? overall - rank : 0;
    }

    // ── Shared continuous grading (#8) ───────────────────────────────────────
    // scorePick() returns a raw 0..90 per-pick blend; the TEAM grade then applies
    // an aggregate spread transform (aggregateGrade) so averaging across picks
    // doesn't regress every team to a B. Tuned via simulation so a mean draft
    // lands ~B-, elite ~A-, and a genuinely bad draft reaches D/F.
    const REACH_STEAL_THRESHOLD = 7;      // unified: +7 steal / -7 reach
    const NEUTRAL_PICK_SCORE = 51.6;      // on-value, baseline DHQ, neutral need
    const GRADE_AGG_CENTER = 48;          // a neutral draft maps to ~C
    const GRADE_AGG_SPREAD = 2.4;         // breaks central clustering

    function roundSlack(round) {
        const r = Number(round || 0) || 1;
        return 6 + (r - 1) * 4; // R1≈6, R2≈10, R3≈14 ... (late rounds forgive reaches)
    }
    function slotBaselineDHQ(overall) {
        // Legacy static slot bands — retained as the last-resort fallback when the
        // continuous industry pick-value model isn't available.
        const n = Number(overall || 0) || 1;
        if (n <= 4) return 7000;
        if (n <= 16) return 4500;
        if (n <= 48) return 2200;
        return 1000;
    }
    // Expected DHQ for the dollars committed in an auction. Convex so a $1 flier
    // expects ~floor value and a budget-blowing star expects near top-of-board.
    function expectedDHQforDollars(spent, budget) {
        const b = Number(budget) > 0 ? Number(budget) : 200;
        const frac = Math.min(1, Math.max(0, Number(spent) || 0) / b);
        return Math.max(50, Math.round(7000 * Math.pow(frac, 0.6)));
    }
    // Variant-aware value baseline a pick's actual DHQ is measured against:
    //   rookie/startup → continuous, league-size-aware industry pick value
    //   redraft/best_ball → positional replacement (K/DEF floors; skill → slot)
    //   auction → expected DHQ for $ spent (slot-independent)
    function expectedDHQ(pick, ctx = {}) {
        const variant = ctx.variant || 'startup';
        const overall = Number(pick?.overall || 0) || 1;
        if (variant === 'auction') {
            const spent = Number(pick?.amount ?? pick?.cost ?? pick?.bid ?? pick?.spent);
            if (Number.isFinite(spent) && spent > 0) return expectedDHQforDollars(spent, ctx.budget);
            // no spend tracked → fall through to the slot baseline
        }
        if (variant === 'redraft' || variant === 'best_ball') {
            const posBase = redraftPositionBaseline(pickPos(pick), variant);
            if (posBase > 0) return posBase; // skill positions fall through to slot value
        }
        const teams = Math.max(1, Number(ctx.leagueSize) || 12);
        const rounds = Math.max(1, Number(ctx.rounds) || (window.App?.PlayerValue?.DRAFT_ROUNDS) || 7);
        if (typeof window.getIndustryPickValue === 'function') {
            const v = Number(window.getIndustryPickValue(overall, teams, rounds)) || 0;
            if (v > 0) return v;
        }
        return slotBaselineDHQ(overall);
    }
    // Per-pick efficiency ratio: actual DHQ captured ÷ expected for that slot/$.
    // 1.0 = on-expectation, >1 = surplus value, <1 = overpay/reach.
    function pickEfficiency(pick, ctx = {}) {
        const baseline = expectedDHQ(pick, ctx);
        return baseline ? pickDhq(pick) / baseline : 1;
    }
    // Per-draft-type sub-score weights (value / need / efficiency). Sum to 1.0;
    // the *0.90 scale is applied in scorePick to preserve aggregateGrade calibration.
    const GRADE_WEIGHTS = {
        rookie:    { value: 0.40, need: 0.25, efficiency: 0.35 },
        startup:   { value: 0.35, need: 0.30, efficiency: 0.35 },
        redraft:   { value: 0.25, need: 0.45, efficiency: 0.30 },
        best_ball: { value: 0.30, need: 0.15, efficiency: 0.55 },
        auction:   { value: 0.20, need: 0.30, efficiency: 0.50 },
    };
    function gradeWeights(variant) { return GRADE_WEIGHTS[variant] || GRADE_WEIGHTS.startup; }
    const GRADE_BASIS = {
        rookie:    'vs expected pick value',
        startup:   'vs expected pick value',
        redraft:   'vs replacement',
        best_ball: 'vs replacement',
        auction:   'vs $ spent',
    };
    function gradeBasisFor(variant) { return GRADE_BASIS[variant] || GRADE_BASIS.startup; }
    // Neutral per-pick score for a variant: a perfectly on-expectation draft
    // (value 62, need 50, efficiency ratio 1.0 → quality 54) maps here, which
    // aggregateGrade recenters to ~C so the letter scale is stable across types.
    function neutralPickScore(variant) {
        const w = gradeWeights(variant);
        return (62 * w.value + 50 * w.need + 54 * w.efficiency) * 0.90;
    }
    // Roster-need contribution [0..100]. seenPos taper: the first pick at a
    // position scores per its urgency, follow-ups fade. No assessment → ok-1st 50.
    function pickNeedScore(pick, ctx, seenPos) {
        const assessment = ctx?.assessment || {};
        const needs = assessment.needs || [];
        const posAssessment = assessment.posAssessment || {};
        const pos = pickPos(pick);
        if (!pos) return 50;
        const counts = seenPos || {};
        counts[pos] = (counts[pos] || 0) + 1;
        const urgency = needs.find(n => String(n.pos).toUpperCase() === pos)?.urgency;
        const pa = posAssessment[pos] || {};
        const needed = Math.max(0, (pa.startingReq || pa.ideal || 2) - (pa.nflStarters || 0));
        if (counts[pos] === 1 && urgency === 'deficit') return 95;
        if (counts[pos] === 1 && urgency === 'thin') return 80;
        if (counts[pos] === 1) return 50;          // first at an ok position
        if (counts[pos] <= needed + 1) return 65;  // filling real depth
        return 35;                                  // over-drafting
    }
    // Per-pick score, raw 0..90 blend. Missing consensusRank is NEUTRAL (62 value).
    function scorePick(pick, ctx = {}) {
        const overall = Number(pick?.overall || 0) || 1;
        const rank = pickConsensusRank(pick);
        let valueScore;
        if (!rank) {
            valueScore = 62;
        } else {
            const delta = overall - rank;            // + = fell to us (steal)
            const slack = roundSlack(pick?.round);
            valueScore = Math.max(0, Math.min(100, 62 + (delta / slack) * 24));
        }
        const needScore = pickNeedScore(pick, ctx, ctx._seenPos);
        // Efficiency: actual DHQ vs the value expected for this slot/$ in this
        // draft type (the "value vs expected pick" term).
        const ratio = pickEfficiency(pick, ctx);
        const qualityScore = Math.max(0, Math.min(100, 2 + ratio * 52));
        const w = gradeWeights(ctx.variant);
        // weights sum to 1.0; *0.90 keeps the legacy 0..90 raw scale.
        return (valueScore * w.value + needScore * w.need + qualityScore * w.efficiency) * 0.90;
    }
    // Spread a team's per-pick average around the neutral so good/bad drafts
    // separate into a real A..F range instead of clustering at the center.
    function aggregateGrade(avgPickScore, variant) {
        const v = Number(avgPickScore || 0);
        const neutral = variant ? neutralPickScore(variant) : NEUTRAL_PICK_SCORE;
        return Math.max(0, Math.min(100, GRADE_AGG_CENTER + (v - neutral) * GRADE_AGG_SPREAD));
    }
    function gradeLetter(score) {
        const s = Number(score || 0);
        return (
            s >= 90 ? 'A+' : s >= 82 ? 'A' : s >= 74 ? 'A-' :
            s >= 68 ? 'B+' : s >= 62 ? 'B' : s >= 56 ? 'B-' :
            s >= 50 ? 'C+' : s >= 44 ? 'C' : s >= 38 ? 'C-' :
            s >= 30 ? 'D' : 'F'
        );
    }

    // Recap letter: spread-transformed per-pick average (85%) + intra-league
    // percentile (15%). avgPickScore = mean of scorePick across the team's picks.
    // NOTE: the live grade and the recap share scorePick, but the recap also folds
    // in league percentile, so final letters can differ by up to ~1 step.
    function recapLetter(percentile, avgPickScore, variant) {
        const pct = Number(percentile || 0);
        const agg = aggregateGrade(avgPickScore, variant);
        const score = Math.round(agg * 0.85 + pct * 0.15);
        return { letter: gradeLetter(score), score };
    }

    function emptyPositionSummary() {
        return {};
    }

    function addPickToPositionSummary(summary, pick) {
        const pos = pickPos(pick) || '?';
        if (!summary[pos]) summary[pos] = { pos, count: 0, dhq: 0, players: [] };
        summary[pos].count += 1;
        summary[pos].dhq += pickDhq(pick);
        summary[pos].players.push({
            pid: pick?.pid || null,
            name: pickName(pick),
            overall: pick?.overall || null,
            dhq: pickDhq(pick),
        });
        return summary;
    }

    function orderedPositionSummary(summary) {
        const order = new Map(RECAP_POS_ORDER.map((pos, idx) => [pos, idx]));
        return Object.values(summary || {}).sort((a, b) => {
            const ao = order.has(a.pos) ? order.get(a.pos) : 99;
            const bo = order.has(b.pos) ? order.get(b.pos) : 99;
            if (ao !== bo) return ao - bo;
            return b.dhq - a.dhq;
        });
    }

    function pickSnapshot(pick) {
        if (!pick) return null;
        return {
            round: pick.round || null,
            slot: pick.slot || null,
            overall: pick.overall || null,
            pickInRound: pick.pickInRound || pick.slot || null,
            rosterId: pick.rosterId ?? null,
            pid: pick.pid || null,
            name: pickName(pick),
            pos: pickPos(pick),
            dhq: pickDhq(pick),
            consensusRank: pickConsensusRank(pick) || null,
            valueDelta: pickValueDelta(pick),
        };
    }

    function buildBestAlternative(state, myPicks, allPicks) {
        const originalPool = state?.originalPool || [];
        if (!originalPool.length || !myPicks.length) return null;
        const pool = originalPool.map(normalizePickRecord).filter(p => p?.pid);
        const draftedBefore = new Set();
        let best = null;
        allPicks
            .slice()
            .sort((a, b) => Number(a.overall || 0) - Number(b.overall || 0))
            .forEach(pick => {
                const isMine = myPicks.some(my => String(my.pid) === String(pick.pid) && Number(my.overall) === Number(pick.overall));
                if (isMine) {
                    const selected = pickSnapshot(pick);
                    const alternative = pool
                        .filter(player => String(player.pid) !== String(pick.pid) && !draftedBefore.has(String(player.pid)))
                        .sort((a, b) => pickDhq(b) - pickDhq(a))[0];
                    const dhqGap = alternative ? pickDhq(alternative) - pickDhq(pick) : 0;
                    if (alternative && dhqGap > 0 && (!best || dhqGap > best.dhqGap)) {
                        best = {
                            pick: selected,
                            alternative: pickSnapshot({
                                ...alternative,
                                overall: pick.overall,
                                round: pick.round,
                                slot: pick.slot,
                            }),
                            dhqGap,
                            message: `At #${pick.overall}, ${pickName(alternative)} carried ${dhqGap.toLocaleString()} more DHQ than ${pickName(pick)}.`,
                        };
                    }
                }
                if (pick?.pid) draftedBefore.add(String(pick.pid));
            });
        return best;
    }

    function buildMissedTarget(state, allPicks, userRosterId) {
        const entries = state?.draftContext?.boardContext?.entries || {};
        const targets = new Set(Object.entries(entries)
            .filter(([, entry]) => entry?.target || entry?.tag === 'target' || entry?.tag === 'must')
            .map(([pid]) => String(pid)));
        if (!targets.size) return null;
        const missed = allPicks
            .filter(pick => targets.has(String(pick.pid)) && String(pick.rosterId) !== String(userRosterId))
            .sort((a, b) => Number(a.overall || 0) - Number(b.overall || 0))[0];
        if (!missed) return null;
        const entry = entries[String(missed.pid)] || {};
        return {
            ...pickSnapshot(missed),
            takenBy: rosterName(state, missed.rosterId, missed.ownerName),
            myRank: entry.myRank || null,
            note: entry.note || '',
            message: `${pickName(missed)} was tagged on My Board and went to ${rosterName(state, missed.rosterId, missed.ownerName)} at #${missed.overall}.`,
        };
    }

    function buildTradeImpact(state) {
        const userRosterId = state?.userRosterId;
        const trades = state?.completedTrades || [];
        const rows = trades.map((trade, idx) => {
            const myGiveDHQ = Number(trade.myGiveDHQ || trade.theirGainDHQ || 0);
            const myGainDHQ = Number(trade.myGainDHQ || trade.theirGiveDHQ || 0);
            return {
                id: trade.id || ('trade_' + idx),
                partnerRosterId: trade.fromRosterId || trade.toRosterId || trade.targetRosterId || null,
                partnerName: rosterName(state, trade.fromRosterId || trade.toRosterId || trade.targetRosterId, trade.partnerName),
                userInitiated: !!trade.userInitiated,
                acceptedAt: trade.acceptedAt ?? null,
                grade: trade.grade?.grade || trade.grade || null,
                likelihood: trade.likelihood || null,
                myGiveDHQ,
                myGainDHQ,
                netDHQ: myGainDHQ - myGiveDHQ,
                myGiveCount: (trade.myGive || []).length + (trade.myGivePlayers || []).length + (trade.myGiveFaab ? 1 : 0),
                myGainCount: (trade.theirGive || []).length + (trade.theirGivePlayers || []).length + (trade.theirGiveFaab ? 1 : 0),
            };
        });
        // Live-draft pick movement: a pick now owned by the user (acquired) adds its
        // slot value; a pick the user traded away subtracts. Picks not involving the
        // user are skipped here (they count toward league trade VOLUME, not impact).
        (state?.tradedPicks || []).forEach((tp, idx) => {
            const acquired = String(tp.rosterId) === String(userRosterId);
            const tradedAway = String(tp.fromRosterId) === String(userRosterId);
            if (!acquired && !tradedAway) return;
            const round = Number(tp.round) || null;
            const val = resolveDraftPickValue({ round, leagueSize: state?.leagueSize, rounds: state?.rounds, season: state?.season })?.value || 0;
            const partnerRid = acquired ? tp.fromRosterId : tp.rosterId;
            rows.push({
                id: 'tp_' + idx,
                partnerRosterId: partnerRid,
                partnerName: rosterName(state, partnerRid),
                userInitiated: false,
                acceptedAt: null,
                round,
                isPick: true,
                grade: null,
                likelihood: null,
                myGiveDHQ: tradedAway ? val : 0,
                myGainDHQ: acquired ? val : 0,
                netDHQ: (acquired ? val : 0) - (tradedAway ? val : 0),
                myGiveCount: tradedAway ? 1 : 0,
                myGainCount: acquired ? 1 : 0,
            });
        });
        const netDHQ = rows.reduce((sum, row) => sum + row.netDHQ, 0);
        return {
            count: rows.length,
            accepted: rows.length,
            userInitiated: rows.filter(row => row.userInitiated).length,
            netDHQ,
            rows,
            summary: rows.length
                ? `${rows.length} draft trade move${rows.length === 1 ? '' : 's'} with ${netDHQ >= 0 ? '+' : ''}${netDHQ.toLocaleString()} net DHQ.`
                : 'No draft trades on record.',
        };
    }

    // Total draft-day trade volume by round (this draft only). Live traded picks
    // carry a round; sim trades fall back to the round implied by acceptedAt.
    function buildTradeVolume(state) {
        const byRound = {};
        let total = 0;
        const bump = (r) => { const k = Number(r) || 0; byRound[k] = (byRound[k] || 0) + 1; total++; };
        (state?.tradedPicks || []).forEach(tp => bump(tp.round));
        (state?.completedTrades || []).forEach(t => {
            let r = Number(t.round || t.draftRound) || 0;
            if (!r && t.acceptedAt != null && state?.leagueSize) r = Math.floor(Number(t.acceptedAt) / state.leagueSize) + 1;
            bump(r);
        });
        return { total, byRound };
    }

    // League-wide best pick / biggest reach / worst pick across all teams. Reuses the
    // per-team topPick / biggestReach already tracked in buildTeamRecaps.
    function buildLeagueExtremes(teamRecaps) {
        let bestPick = null, biggestReach = null, worstPick = null;
        (teamRecaps || []).forEach(t => {
            if (t.topPick && (!bestPick || (t.topPick.dhq || 0) > (bestPick.dhq || 0))) bestPick = { ...t.topPick, teamName: t.teamName };
            if (t.biggestReach && t.biggestReach.valueDelta != null && (!biggestReach || (t.biggestReach.valueDelta || 0) < (biggestReach.valueDelta || 0))) biggestReach = { ...t.biggestReach, teamName: t.teamName };
            (t.picks || []).forEach(p => {
                if (p && (p.dhq || 0) > 0 && (!worstPick || (p.dhq || 0) < (worstPick.dhq || 0))) worstPick = { ...p, teamName: t.teamName };
            });
        });
        return { bestPick, biggestReach, worstPick };
    }

    function playerInfo(pid) {
        const id = String(pid || '');
        const player = window.S?.players?.[id] || {};
        const name = player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' ') || id;
        const pos = String(player.position || player.pos || '').toUpperCase();
        const dhq = resolvePlayerDhq({ ...player, pid: id }).value;
        return { pid: id, name, pos, dhq };
    }

    function teamTopPlayersByPosition(team, pos) {
        return (team?.picks || [])
            .filter(p => !pos || String(p.pos || '').toUpperCase() === String(pos).toUpperCase())
            .sort((a, b) => Number(b.dhq || 0) - Number(a.dhq || 0));
    }

    function buildPostDraftMoves(state, input = {}) {
        const userRosterId = input.userRosterId ?? state?.userRosterId;
        const picks = input.picks || [];
        const drafted = new Set(picks.map(p => String(p.pid)).filter(Boolean));
        const needs = (state?.personas?.[userRosterId]?.assessment?.needs || state?.draftContext?.teamContext?.needs || [])
            .map(n => (typeof n === 'string' ? n : n?.pos))
            .map(pos => String(pos || '').toUpperCase())
            .filter(Boolean);
        const userPositions = input.positionSummary || [];
        const userTopPos = userPositions[0]?.pos || null;
        const available = (state?.originalPool || [])
            .map(normalizePickRecord)
            .filter(p => p?.pid && !drafted.has(String(p.pid)))
            .sort((a, b) => pickDhq(b) - pickDhq(a));
        const waiverTargets = available
            .filter(p => !needs.length || needs.includes(pickPos(p)))
            .slice(0, 5)
            .map(p => ({
                pid: p.pid,
                name: pickName(p),
                pos: pickPos(p),
                dhq: pickDhq(p),
                reason: needs.includes(pickPos(p)) ? 'Matches a remaining roster need.' : 'Best undrafted value left on the board.',
            }));
        const fallbackTargets = waiverTargets.length ? waiverTargets : available.slice(0, 3).map(p => ({
            pid: p.pid,
            name: pickName(p),
            pos: pickPos(p),
            dhq: pickDhq(p),
            reason: 'Best undrafted value left on the board.',
        }));

        const tradeTargets = [];
        (input.teamRecaps || []).forEach(team => {
            if (String(team.rosterId) === String(userRosterId)) return;
            needs.forEach(pos => {
                const count = (team.positionSummary || []).find(row => row.pos === pos)?.count || 0;
                const players = teamTopPlayersByPosition(team, pos);
                if (!count || !players.length) return;
                tradeTargets.push({
                    rosterId: team.rosterId,
                    teamName: team.teamName,
                    pos,
                    player: players[0],
                    reason: `${team.teamName} added ${count} ${pos}; that roster may have a post-draft surplus.`,
                });
            });
        });

        const currentRosterIds = state?.draftContext?.teamContext?.currentRoster || [];
        const cutCandidates = currentRosterIds
            .map(playerInfo)
            .filter(p => p.pid && p.name)
            .sort((a, b) => (a.dhq || 0) - (b.dhq || 0))
            .slice(0, 4)
            .map(p => ({
                ...p,
                reason: p.pos === userTopPos
                    ? `Review after adding ${userTopPos} draft depth.`
                    : 'Lowest-value current roster pocket to reassess after the draft.',
            }));

        return {
            waiverTargets: fallbackTargets,
            tradeTargets: tradeTargets.slice(0, 5),
            cutCandidates,
        };
    }

    function buildTeamRecaps(state, picks, leagueTotals) {
        const byRoster = {};
        picks.forEach(pick => {
            const key = rosterKey(pick.rosterId ?? pick.slot);
            if (!byRoster[key]) {
                byRoster[key] = {
                    rosterId: pick.rosterId ?? null,
                    teamName: rosterName(state, pick.rosterId ?? pick.slot, pick.ownerName),
                    picks: [],
                    positionSummary: emptyPositionSummary(),
                    totalDHQ: 0,
                    reaches: [],
                    steals: [],
                    earlyPositions: [],
                    topPick: null,
                    bestValue: null,
                    biggestReach: null,
                };
            }
            const row = byRoster[key];
            row.picks.push(pickSnapshot(pick));
            row.totalDHQ += pickDhq(pick);
            addPickToPositionSummary(row.positionSummary, pick);
            if (Number(pick.round || 0) <= 2) row.earlyPositions.push(pickPos(pick) || '?');
            const delta = pickValueDelta(pick);
            if (delta >= REACH_STEAL_THRESHOLD) row.steals.push(pickSnapshot(pick));
            if (delta <= -REACH_STEAL_THRESHOLD) row.reaches.push(pickSnapshot(pick));
            if (!row.topPick || pickDhq(pick) > row.topPick.dhq) row.topPick = pickSnapshot(pick);
            if (delta > (row.bestValue?.valueDelta ?? -999)) row.bestValue = pickSnapshot(pick);
            // Only a NEGATIVE delta is a reach — mirrors the user-recap filter, so a
            // team that never reached doesn't get a value pick labeled a reach.
            if (delta < 0 && delta < (row.biggestReach?.valueDelta ?? 999)) row.biggestReach = pickSnapshot(pick);
        });

        Object.keys(state?.personas || {}).forEach(rid => {
            const key = rosterKey(rid);
            if (!byRoster[key]) {
                byRoster[key] = {
                    rosterId: rid,
                    teamName: rosterName(state, rid),
                    picks: [],
                    positionSummary: emptyPositionSummary(),
                    totalDHQ: Number(leagueTotals?.[rid] || 0),
                    reaches: [],
                    steals: [],
                    earlyPositions: [],
                    topPick: null,
                    bestValue: null,
                    biggestReach: null,
                };
            }
        });

        const ranked = Object.values(byRoster).sort((a, b) => b.totalDHQ - a.totalDHQ);
        const maxTotal = Math.max(1, ...ranked.map(row => row.totalDHQ));
        ranked.forEach((row, idx) => {
            const rank = idx + 1;
            const percentile = ranked.length > 1
                ? Math.round(((ranked.length - rank) / (ranked.length - 1)) * 100)
                : 100;
            // Average per-pick score via the shared scorer. Missing consensusRank
            // is NEUTRAL inside scorePick (no false value hit — the old bug here
            // counted a missing rank AS a hit, inflating grades). seenPos tapers
            // multi-pick-per-position bonuses.
            const scoreCtx = { assessment: state?.personas?.[rosterKey(row.rosterId)]?.assessment, _seenPos: {}, variant: state?.variant, leagueSize: state?.leagueSize, rounds: state?.rounds, budget: state?.auctionBudget };
            const avgPickScore = row.picks.length
                ? Math.round(row.picks.reduce((s, p) => s + scorePick(p, scoreCtx), 0) / row.picks.length)
                : 0;
            const valuePct = avgPickScore; // retained field name for downstream value sorts
            const primaryPos = orderedPositionSummary(row.positionSummary)[0]?.pos || '';
            const grade = recapLetter(percentile, avgPickScore, state?.variant);
            row.rank = rank;
            row.percentile = percentile;
            row.valuePct = valuePct;
            row.grade = grade.letter;
            row.score = grade.score;
            row.totalShare = Math.round((row.totalDHQ / maxTotal) * 100);
            row.positionSummary = orderedPositionSummary(row.positionSummary);
            row.buildLabel = row.picks.length
                ? (primaryPos ? `${primaryPos}-led build` : 'Balanced build')
                : 'No tracked picks';
            row.story = row.picks.length
                ? `${row.teamName} finished #${rank} by draft DHQ with ${row.steals.length} steal${row.steals.length === 1 ? '' : 's'} and ${row.reaches.length} reach${row.reaches.length === 1 ? '' : 'es'}.`
                : `${row.teamName} has no tracked draft picks in this recap.`;
        });
        return ranked;
    }

    function buildOwnerLearning(teamRecaps) {
        return (teamRecaps || []).reduce((acc, team) => {
            const key = rosterKey(team.rosterId);
            const earlyCounts = team.earlyPositions.reduce((out, pos) => {
                out[pos] = (out[pos] || 0) + 1;
                return out;
            }, {});
            const primaryEarly = Object.entries(earlyCounts).sort((a, b) => b[1] - a[1])[0] || null;
            const topPosition = team.positionSummary?.[0]?.pos || null;
            const signals = [];
            if (primaryEarly) signals.push(`Early-round lean: ${primaryEarly[0]}`);
            if (topPosition) signals.push(`Class build: ${topPosition}`);
            if (team.reaches.length) signals.push(`${team.reaches.length} reach${team.reaches.length === 1 ? '' : 'es'} against board`);
            if (team.steals.length) signals.push(`${team.steals.length} value hit${team.steals.length === 1 ? '' : 's'}`);
            acc[key] = {
                rosterId: team.rosterId,
                ownerName: team.teamName,
                picks: team.picks.length,
                totalDHQ: team.totalDHQ,
                posCounts: team.positionSummary.reduce((out, pos) => {
                    out[pos.pos] = pos.count;
                    return out;
                }, {}),
                earlyPositions: team.earlyPositions,
                reaches: team.reaches.length,
                steals: team.steals.length,
                buildLabel: team.buildLabel,
                grade: team.grade,
                confidence: team.picks.length >= 5 ? 'high' : team.picks.length >= 3 ? 'medium' : team.picks.length ? 'low' : 'inferred',
                reasonCodes: signals.map((detail, idx) => ({
                    code: idx === 0 ? 'draft_recap_signal' : 'draft_recap_signal_' + idx,
                    label: 'Draft recap signal',
                    detail,
                    source: 'draft_recap',
                    confidence: team.picks.length >= 3 ? 'medium' : 'low',
                })),
                signals,
            };
            return acc;
        }, {});
    }

    function buildLeagueStorylines(teamRecaps, userRosterId) {
        const leaders = (teamRecaps || []).filter(t => t.picks.length);
        const winner = leaders[0] || null;
        const valueTeam = leaders.slice().sort((a, b) => (b.steals.length - a.steals.length) || (b.valuePct - a.valuePct))[0] || null;
        const risky = leaders.slice().sort((a, b) => (b.reaches.length - a.reaches.length) || (a.valuePct - b.valuePct))[0] || null;
        const userTeam = leaders.find(t => String(t.rosterId) === String(userRosterId)) || null;
        return [
            winner ? `${winner.teamName} led the room by draft DHQ with ${winner.totalDHQ.toLocaleString()} captured.` : '',
            valueTeam ? `${valueTeam.teamName} showed the cleanest value discipline with ${valueTeam.steals.length} value hit${valueTeam.steals.length === 1 ? '' : 's'}.` : '',
            risky && risky.reaches.length ? `${risky.teamName} took on the most board risk with ${risky.reaches.length} reach${risky.reaches.length === 1 ? '' : 'es'}.` : '',
            userTeam ? `Your class finished #${userTeam.rank} of ${leaders.length} tracked teams with a ${userTeam.grade}.` : '',
        ].filter(Boolean);
    }

    function buildActionPlan(state, recapBits) {
        const {
            grade,
            positionSummary,
            bestAlternative,
            missedTarget,
            tradeImpact,
            postDraftMoves,
            userTeam,
        } = recapBits;
        const actions = [];
        const positions = positionSummary || [];
        const topPos = positions[0];
        const needs = (state?.personas?.[state?.userRosterId]?.assessment?.needs || state?.draftContext?.teamContext?.needs || [])
            .map(n => (typeof n === 'string' ? n : n?.pos))
            .filter(Boolean);
        if (bestAlternative?.alternative) {
            actions.push({
                title: 'Recheck the passed value',
                detail: `Price ${bestAlternative.alternative.name} against ${bestAlternative.pick.name}; the board showed a ${bestAlternative.dhqGap.toLocaleString()} DHQ gap at #${bestAlternative.pick.overall}.`,
                type: 'value_review',
            });
        }
        if (missedTarget) {
            actions.push({
                title: 'Put the missed target on the trade watchlist',
                detail: `${missedTarget.name} was tagged on My Board and landed with ${missedTarget.takenBy}. Track that roster after waivers settle.`,
                type: 'target_followup',
            });
        }
        if (tradeImpact?.count) {
            actions.push({
                title: 'Audit draft-trade leverage',
                detail: `${tradeImpact.summary} Use the accepted deal history to update trade partner reads before the next mock.`,
                type: 'trade_audit',
            });
        }
        if (postDraftMoves?.waiverTargets?.length) {
            const names = postDraftMoves.waiverTargets.slice(0, 3).map(p => `${p.name} (${p.pos})`).join(', ');
            actions.push({
                title: 'Build the immediate waiver watchlist',
                detail: `${names} should be checked first if they are still available after the room closes.`,
                type: 'waiver_followup',
            });
        }
        if (postDraftMoves?.tradeTargets?.length) {
            const target = postDraftMoves.tradeTargets[0];
            actions.push({
                title: `Open a ${target.pos} trade lane`,
                detail: `${target.reason} Start with ${target.player?.name || 'their new pick'} as the price anchor.`,
                type: 'post_draft_trade_map',
            });
        }
        if (postDraftMoves?.cutCandidates?.length) {
            const names = postDraftMoves.cutCandidates.slice(0, 2).map(p => `${p.name}${p.pos ? ' (' + p.pos + ')' : ''}`).join(', ');
            actions.push({
                title: 'Review cut and taxi pressure',
                detail: `Recheck ${names} before roster locks; draft additions may have changed the bottom of the roster.`,
                type: 'cut_review',
            });
        }
        if (topPos && topPos.count >= 3) {
            actions.push({
                title: `Shop surplus ${topPos.pos} depth`,
                detail: `You added ${topPos.count} ${topPos.pos} picks. Package the bottom of that group if it can solve ${needs[0] || 'a weaker roster pocket'}.`,
                type: 'roster_balance',
            });
        }
        if (needs.length && !positions.some(pos => pos.pos === needs[0])) {
            actions.push({
                title: `Address the remaining ${needs[0]} need`,
                detail: `Your pre-draft need at ${needs[0]} was not directly covered. Prioritize waiver targets or a two-for-one trade path there.`,
                type: 'need_followup',
            });
        }
        if (grade?.letter && !grade.letter.startsWith('A') && userTeam?.rank > 1) {
            actions.push({
                title: 'Use the league recap to find imbalance',
                detail: `You finished behind ${Math.max(0, userTeam.rank - 1)} team${userTeam.rank - 1 === 1 ? '' : 's'} by draft DHQ. Start with teams that overbuilt one position.`,
                type: 'league_trade_map',
            });
        }
        if (!actions.length) {
            actions.push({
                title: 'Preserve the board edge',
                detail: 'Save this recap and rerun an analyst mock from the updated board before the next draft room decision.',
                type: 'prep_loop',
            });
        }
        return actions.slice(0, 5);
    }

    function slimPlayer(player) {
        if (!player) return null;
        return {
            pid: player.pid,
            csvPid: player.csvPid || null,
            name: player.name || player.full_name || '',
            pos: player.pos || player.position || '',
            team: player.team || player.nflTeam || '',
            college: player.college || player.school || '',
            age: player.age || null,
            birth_date: player.birth_date || null,
            dhq: Number(player.dhq || player.val || 0),
            consensusRank: player.consensusRank || player.rank || null,
            tier: player.tier || player.csv?.tier || null,
            photoUrl: player.photoUrl || '',
            source: player.source || null,
            isCSV: !!player.isCSV,
        };
    }

    function slimPool(pool, maxSize) {
        return (pool || []).slice(0, maxSize || 600).map(slimPlayer).filter(Boolean);
    }

    function rebuildDraftDerived(picks) {
        // draftedPids maps pid → COUNT of times drafted (≥1). For single-copy
        // leagues every count is 1, so truthiness checks still read as "drafted".
        // Multi-copy leagues compare the count against state.playerCopies.
        const draftedPids = {};
        const teamRosters = {};
        (picks || []).forEach(p => {
            if (p?.pid) draftedPids[p.pid] = (draftedPids[p.pid] || 0) + 1;
            const idx = p?.teamIdx;
            if (idx != null) teamRosters[idx] = [...(teamRosters[idx] || []), p.pos];
        });
        return {
            draftedPids,
            teamRosters,
            pickedByIdx: buildPickedByIdx(picks),
        };
    }

    // Rebuild the available pool from the full original pool minus everyone now
    // drafted — used when reconciliation replaces a pick mid-array (a single
    // restore/filter can't express "give back X, take away Y" cleanly).
    function rebuildPoolFromDrafted(state, draftedPids) {
        const original = (state.originalPool && state.originalPool.length) ? state.originalPool : (state.pool || []);
        const copies = Math.max(1, Number(state.playerCopies) || 1);
        // Keep a player in the pool until ALL his copies are taken (copies===1 ⇒
        // drops on first pick, same as before).
        return original.filter(p => p?.pid != null && (draftedPids[p.pid] || 0) < copies);
    }

    function restorePoolAfterUndo(state, remainingPicks, undonePick) {
        const copies = Math.max(1, Number(state.playerCopies) || 1);
        // Count remaining drafted copies per pid so a multi-copy player returns to the
        // pool as soon as a copy frees up (remaining < copies), not only when his last
        // copy is undone. copies===1 ⇒ identical to the old boolean Set behavior.
        const remainingCount = {};
        (remainingPicks || []).forEach(p => { const k = String(p?.pid || ''); if (k) remainingCount[k] = (remainingCount[k] || 0) + 1; });
        const original = state.originalPool || [];
        const existing = new Set((state.pool || []).map(p => String(p.pid)).filter(Boolean));
        let nextPool = state.pool || [];
        const pid = String(undonePick?.pid || '');
        if (pid && (remainingCount[pid] || 0) < copies && !existing.has(pid)) {
            const originalMatch = original.find(p => String(p.pid) === pid) || undonePick;
            nextPool = [originalMatch, ...nextPool];
        }
        const rank = new Map();
        original.forEach((p, idx) => { if (p?.pid != null) rank.set(String(p.pid), idx); });
        return nextPool.slice().sort((a, b) => {
            const ar = rank.has(String(a.pid)) ? rank.get(String(a.pid)) : 999999;
            const br = rank.has(String(b.pid)) ? rank.get(String(b.pid)) : 999999;
            if (ar !== br) return ar - br;
            return Number(b.dhq || 0) - Number(a.dhq || 0);
        });
    }

    // ── Reducer ──────────────────────────────────────────────────────
    function reducer(state, action) {
        switch (action.type) {
            case 'SETUP_CHANGE':
                return { ...state, ...action.payload };

            case 'START_DRAFT': {
                // Phase 5: scenario/replay support
                // action.prePicks — picks pre-applied before draft begins (scenario mode)
                // action.replay — { replayPicks, totalPicks } for ghost mode
                // action.narrative — optional banner text
                const prePicks = (action.prePicks || []).map(normalizePickRecord).filter(Boolean);
                const derived = rebuildDraftDerived(prePicks);
                const originalPool = action.originalPool && action.originalPool.length
                    ? action.originalPool.slice()
                    : action.pool.slice().concat(prePicks.map(p => ({ pid: p.pid, name: p.name, pos: p.pos, dhq: p.dhq })));
                const setupPatch = action.setupPatch || {};
                const nextMode = setupPatch.mode || state.mode;

                return {
                    ...state,
                    ...setupPatch,
                    phase: 'drafting',
                    pool: action.pool,
                    originalPool,
                    pickOrder: action.pickOrder,
                    personas: action.personas || {},
                    draftContext: action.draftContext || null,
                    draftTuning: action.draftTuning || state.draftTuning,
                    strategyProfile: action.strategyProfile || state.strategyProfile || null,
                    picks: prePicks.slice(),
                    pickedByIdx: derived.pickedByIdx,
                    draftedPids: derived.draftedPids,
                    currentIdx: prePicks.length,
                    teamRosters: derived.teamRosters,
                    replay: action.replay || null,
                    scenarioNarrative: action.narrative || null,
                    recapLearning: action.recapLearning || state.recapLearning || null,
                    liveSync: nextMode === 'live-sync'
                        ? initialLiveSyncState({
                            status: action.liveDraftStatus === 'drafting' ? 'mirroring' : 'waiting',
                            draftStatus: action.liveDraftStatus || '',
                            startedAt: Date.now(),
                            lastPickNo: prePicks.length,
                            expectedPickNo: prePicks.length + 1,
                            remotePickCount: prePicks.length,
                        })
                        : state.liveSync,
                    stagedLiveOffers: nextMode === 'live-sync' ? [] : state.stagedLiveOffers,
                };
            }

	            case 'MAKE_PICK': {
	                const { player, isUser, reasoning, confidence } = action;
	                const slot = state.pickOrder[state.currentIdx];
	                if (!slot || !player) return state;
	                const resolvedDhq = resolvePlayerDhq(player).value;
	                const mpCopies = Math.max(1, Number(state.playerCopies) || 1);
                const mpNewCount = (state.draftedPids[player.pid] || 0) + 1;
                const newDrafted = { ...state.draftedPids, [player.pid]: mpNewCount };
                // Only pull the player from the pool once his last copy is gone.
                const newPool = mpNewCount >= mpCopies ? state.pool.filter(p => p.pid !== player.pid) : state.pool;
                // In live-sync, every MAKE_PICK is a hand-entered pick (the live poll
                // uses APPLY_LIVE_SYNC_PICKS, and AI auto-picks are disabled). Tag them
                // all 'manual-live' — whether entered via override or on the user's own
                // turn — so they're undoable and get reconciled when the real pick lands.
                const pickSource = action.source || (state.mode === 'live-sync' ? 'manual-live' : state.mode === 'manual' ? 'manual-draft' : null);
                const newPick = {
                    id: 'pick_' + slot.overall + '_' + Date.now(),
                    round: slot.round,
                    slot: slot.slot,
                    pickInRound: slot.pickInRound || slot.slot,
                    overall: slot.overall,
                    teamIdx: slot.teamIdx,
                    rosterId: slot.rosterId,
                    isUser: !!isUser,
	                    pid: player.pid,
	                    name: player.name,
	                    pos: player.pos,
	                    dhq: resolvedDhq,
                    consensusRank: player.consensusRank || null,
                    photoUrl: player.photoUrl || '',
                    college: player.college || '',
                    tier: player.tier || null,
                    csv: player.csv || null,
                    reasoning: reasoning || null,
                    confidence: confidence || null,
                    alexReaction: null,
                    source: pickSource,
                    ts: Date.now(),
                };
	                const newCurrent = state.currentIdx + 1;
                const teamPositions = state.teamRosters[slot.teamIdx] || [];
                const nextPicks = [...state.picks, newPick];
                const nextManualCorrections = (pickSource === 'manual-live' || pickSource === 'manual-draft')
                    ? [{
                        type: 'apply',
                        pickId: newPick.id,
                        overall: newPick.overall,
                        pid: newPick.pid,
                        source: pickSource,
                        ts: newPick.ts,
                    }, ...(state.manualCorrections || [])].slice(0, 50)
                    : state.manualCorrections;
                const nextState = {
                    ...state,
                    pool: newPool,
                    picks: nextPicks,
                    pickedByIdx: { ...(state.pickedByIdx || {}), [newPick.overall]: newPick },
                    draftedPids: newDrafted,
                    currentIdx: newCurrent,
                    teamRosters: {
                        ...state.teamRosters,
                        [slot.teamIdx]: [...teamPositions, player.pos],
                    },
                    manualCorrections: nextManualCorrections,
                    phase: newCurrent >= state.pickOrder.length ? 'complete' : 'drafting',
                    // Auto-clear override mode after any pick is made
                    overrideMode: false,
                };
                const nextContext = window.DraftCC?.context?.applyPickToContext
                    ? window.DraftCC.context.applyPickToContext(state.draftContext, newPick, nextState)
                    : state.draftContext;
                return { ...nextState, draftContext: nextContext };
            }

            case 'PIN_TEAM':
                return { ...state, pinnedRosterId: action.rosterId };

            case 'SET_OVERRIDE':
                return { ...state, overrideMode: !!action.enabled };

            case 'UNDO_LAST_PICK': {
                if (!state.picks?.length) return state;
                const lastPick = state.picks[state.picks.length - 1];
                const source = lastPick?.source || '';
                const manualSource = source === 'manual-live' || source === 'manual-draft' || state.mode === 'manual';
                if (action.manualOnly && !manualSource) return state;
                const picks = state.picks.slice(0, -1);
                const derived = rebuildDraftDerived(picks);
                const currentIdx = Math.max(0, state.currentIdx - 1);
                const nextState = {
                    ...state,
                    picks,
                    pickedByIdx: derived.pickedByIdx,
                    draftedPids: derived.draftedPids,
                    currentIdx,
                    teamRosters: derived.teamRosters,
                    pool: restorePoolAfterUndo(state, picks, lastPick),
                    phase: 'drafting',
                    overrideMode: false,
                    manualCorrections: [{
                        type: 'undo',
                        pickId: lastPick.id || null,
                        overall: lastPick.overall,
                        pid: lastPick.pid,
                        source: source || 'manual',
                        ts: Date.now(),
                    }, ...(state.manualCorrections || [])].slice(0, 50),
                    alex: {
                        ...state.alex,
                        stream: (state.alex?.stream || []).filter(ev => Number(ev.relatedPickNo || 0) !== Number(lastPick.overall || 0)),
                    },
                    liveSync: state.mode === 'live-sync'
                        ? mergeLiveSync(state.liveSync, { expectedPickNo: currentIdx + 1 })
                        : state.liveSync,
                };
                const nextContext = window.DraftCC?.context?.undoPickInContext
                    ? window.DraftCC.context.undoPickInContext(state.draftContext, lastPick, nextState)
                    : state.draftContext;
                return { ...nextState, draftContext: nextContext };
            }

            // ── Phase 3: Trades ────────────────────────────────────────
            case 'OFFER_TRADE': {
                // payload: offer object { fromRosterId, toRosterId, theirGive: [picks], myGive: [picks], theirGainDHQ, myGainDHQ, likelihood, grade, taxes, reason }
                return {
                    ...state,
                    speed: 'paused',
                    activeOffer: {
                        ...(action.offer || {}),
                        negotiationRound: Number(action.offer?.negotiationRound || 0),
                        maxNegotiationRounds: 3,
                        resumeSpeed: action.offer?.resumeSpeed || state.speed,
                        cpuMessage: action.offer?.cpuMessage || 'I paused the room while this offer is on the table.',
                    },
                };
            }

            case 'UPDATE_ACTIVE_TRADE':
                if (!state.activeOffer) return state;
                return {
                    ...state,
                    activeOffer: {
                        ...state.activeOffer,
                        ...(action.offer || {}),
                        resumeSpeed: state.activeOffer.resumeSpeed || state.speed,
                    },
                };

            case 'DECLINE_TRADE': {
                const resumeSpeed = state.activeOffer?.resumeSpeed || state.speed;
                return { ...state, activeOffer: null, speed: resumeSpeed };
            }

            case 'ACCEPT_TRADE': {
                // Swap pick ownership in pickOrder: all user-given picks go to CPU, all CPU-given picks go to user.
                const offer = action.offer || state.activeOffer;
                if (!offer) return state;
                const activeCheck = window.DraftCC?.tradeSimulator?.validateActiveOffer
                    ? window.DraftCC.tradeSimulator.validateActiveOffer(state, offer)
                    : null;
                if (activeCheck && !activeCheck.valid) {
                    const message = activeCheck.reason || 'That offer is no longer valid in the current draft state.';
                    return {
                        ...state,
                        speed: 'paused',
                        activeOffer: {
                            ...offer,
                            counterClosed: true,
                            cpuMessage: message,
                            reason: message,
                        },
                    };
                }
                const newPickOrder = state.pickOrder.map((p, idx) => {
                    // Only swap picks that haven't been made yet (idx >= currentIdx)
                    if (idx < state.currentIdx) return p;
                    // Check if this slot matches a my-give (user giving this pick to CPU)
                    const isMyGive = (offer.myGive || []).some(g => g.round === p.round && g.teamIdx === p.teamIdx);
                    if (isMyGive) {
                        return { ...p, rosterId: offer.fromRosterId, traded: true };
                    }
                    // Check if this slot matches a their-give (CPU giving this pick to user)
                    const isTheirGive = (offer.theirGive || []).some(g => g.round === p.round && g.teamIdx === p.teamIdx);
                    if (isTheirGive) {
                        return { ...p, rosterId: state.userRosterId, traded: true };
                    }
                    return p;
                });
                const ta = { ...(state.tradedAssets || {}) };
                const ensure = (rid) => {
                    if (!ta[rid]) ta[rid] = { incomingPlayers: [], outgoingPlayers: [], faabDelta: 0 };
                    return ta[rid];
                };
                const userRid = state.userRosterId;
                const cpuRid = offer.fromRosterId;
                const myGivePlayers = offer.myGivePlayers || [];
                const theirGivePlayers = offer.theirGivePlayers || [];
                const myGiveFaab = offer.myGiveFaab || 0;
                const theirGiveFaab = offer.theirGiveFaab || 0;
                if (myGivePlayers.length) {
                    ensure(userRid).outgoingPlayers = [...ensure(userRid).outgoingPlayers, ...myGivePlayers];
                    ensure(cpuRid).incomingPlayers = [...ensure(cpuRid).incomingPlayers, ...myGivePlayers];
                }
                if (theirGivePlayers.length) {
                    ensure(cpuRid).outgoingPlayers = [...ensure(cpuRid).outgoingPlayers, ...theirGivePlayers];
                    ensure(userRid).incomingPlayers = [...ensure(userRid).incomingPlayers, ...theirGivePlayers];
                }
                if (myGiveFaab > 0) { ensure(userRid).faabDelta -= myGiveFaab; ensure(cpuRid).faabDelta += myGiveFaab; }
                if (theirGiveFaab > 0) { ensure(cpuRid).faabDelta -= theirGiveFaab; ensure(userRid).faabDelta += theirGiveFaab; }
                // Future picks have no pickOrder slot (different season) — they're tracked
                // solely in the sandbox ledger, never swapped in pickOrder.
                const fpl = { ...(state.futurePicksLedger || {}) };
                (offer.myGiveFuture || []).forEach(fp => { fpl[futurePickKey(fp)] = cpuRid; });
                (offer.theirGiveFuture || []).forEach(fp => { fpl[futurePickKey(fp)] = userRid; });
                return {
                    ...state,
                    pickOrder: newPickOrder,
                    tradedAssets: ta,
                    futurePicksLedger: fpl,
                    activeOffer: null,
                    speed: offer.resumeSpeed || state.speed,
                    completedTrades: [
                        ...state.completedTrades,
                        {
                            ...offer,
                            acceptedAt: state.currentIdx,
                            ts: Date.now(),
                        },
                    ],
                };
            }

            case 'OPEN_PROPOSER': {
                // payload: { targetRosterId, seed? }
                // seed (optional) preselects assets so the desk opens pre-loaded — used
                // by the "Queue trade" affordance on the draft log. Future-pick lanes
                // (myGiveFuture/theirGiveFuture) are sandbox-only: they never touch
                // pickOrder or Sleeper; accepted ones land in state.futurePicksLedger.
                const seed = action.seed || {};
                return {
                    ...state,
                    proposerDrawer: {
                        targetRosterId: action.targetRosterId,
                        myGive: seed.myGive || [],
                        theirGive: seed.theirGive || [],
                        myGivePlayers: seed.myGivePlayers || [],
                        theirGivePlayers: seed.theirGivePlayers || [],
                        myGiveFaab: seed.myGiveFaab || 0,
                        theirGiveFaab: seed.theirGiveFaab || 0,
                        myGiveFuture: seed.myGiveFuture || [],
                        theirGiveFuture: seed.theirGiveFuture || [],
                        analyzerMode: seed.analyzerMode || 'build', // 'build' | 'find'
                        status: 'building', // 'building' | 'sending' | 'countered' | 'accepted' | 'declined' | 'planned' | 'pending'
                    },
                };
            }

            case 'CLOSE_PROPOSER':
                return { ...state, proposerDrawer: null };

            case 'UPDATE_PROPOSER': {
                // payload: partial merge into proposerDrawer
                if (!state.proposerDrawer) return state;
                return {
                    ...state,
                    proposerDrawer: { ...state.proposerDrawer, ...action.payload },
                };
            }

            case 'STAGE_LIVE_OFFER': {
                const offer = {
                    ...(action.offer || {}),
                    id: action.offer?.id || ('live_offer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
                    status: action.offer?.status || 'staged',
                    stagedAt: Date.now(),
                    pickNo: state.currentIdx + 1,
                };
                return {
                    ...state,
                    stagedLiveOffers: [offer, ...(state.stagedLiveOffers || [])].slice(0, 8),
                    proposerDrawer: state.proposerDrawer
                        ? { ...state.proposerDrawer, status: 'planned', stagedOfferId: offer.id }
                        : state.proposerDrawer,
                };
            }

            case 'DISMISS_STAGED_LIVE_OFFER':
                return {
                    ...state,
                    stagedLiveOffers: (state.stagedLiveOffers || []).filter(o => o.id !== action.offerId),
                };

            case 'UPDATE_LIVE_OFFER_STATUS':
                return {
                    ...state,
                    stagedLiveOffers: (state.stagedLiveOffers || []).map(offer => {
                        if (offer.id !== action.offerId) return offer;
                        const status = action.status || offer.status || 'staged';
                        return {
                            ...offer,
                            status,
                            outcome: action.outcome || offer.outcome || null,
                            updatedAt: Date.now(),
                            sentAt: status === 'pending' && !offer.sentAt ? Date.now() : offer.sentAt,
                            resolvedAt: (status === 'accepted' || status === 'rejected') ? Date.now() : offer.resolvedAt,
                        };
                    }),
                    proposerDrawer: state.proposerDrawer?.stagedOfferId === action.offerId
                        ? { ...state.proposerDrawer, status: action.status === 'pending' ? 'pending' : action.status || state.proposerDrawer.status }
                        : state.proposerDrawer,
                };

            case 'LIVE_SYNC_STATUS': {
                const liveSync = mergeLiveSync(state.liveSync, action.payload || {});
                const remoteComplete = liveSync.status === 'complete' && state.currentIdx >= state.pickOrder.length;
                return {
                    ...state,
                    liveSync,
                    phase: remoteComplete ? 'complete' : state.phase,
                };
            }

            case 'UPDATE_LIVE_OWNERSHIP': {
                // Re-attribute ownership of UPCOMING picks (idx >= currentIdx) from a
                // freshly-polled pickOwnership map (keyed 'round-slot'). Already-made
                // picks keep the roster that actually made them. This is what lets
                // mid-draft pick trades move the right team onto the clock during
                // high-frequency trading — the live poll refreshes traded picks and
                // hands the recomputed ownership here.
                const ownership = action.pickOwnership;
                if (!ownership || !state.pickOrder?.length) return state;
                let changed = false;
                const pickOrder = state.pickOrder.map((slot, idx) => {
                    if (idx < state.currentIdx) return slot;
                    const own = ownership[slot.round + '-' + slot.slot];
                    if (!own) return slot;
                    const nextRid = own.rosterId != null ? own.rosterId : slot.originalRosterId;
                    const nextName = own.ownerName || slot.originalOwnerName || slot.ownerName;
                    const nextTraded = !!own.traded;
                    if (String(nextRid) === String(slot.rosterId) && nextName === slot.ownerName && nextTraded === !!slot.traded) {
                        return slot;
                    }
                    changed = true;
                    return { ...slot, rosterId: nextRid, ownerName: nextName, traded: nextTraded };
                });
                return changed ? { ...state, pickOrder } : state;
            }

            case 'SET_TRADED_PICKS': {
                // Bridge live-draft traded picks into state so the recap's trade impact
                // + trade volume can see pick movement. Expected normalized shape:
                // [{ round, rosterId, fromRosterId }]. No-op if unchanged.
                const next = Array.isArray(action.tradedPicks) ? action.tradedPicks : [];
                if ((state.tradedPicks || []).length === next.length &&
                    JSON.stringify(state.tradedPicks || []) === JSON.stringify(next)) return state;
                return { ...state, tradedPicks: next };
            }

            case 'APPLY_LIVE_SYNC_PICKS': {
                const incoming = action.picks || [];
                if (!incoming.length) {
                    return { ...state, liveSync: mergeLiveSync(state.liveSync, action.status || {}) };
                }

                let pool = state.pool;
                let picks = state.picks.slice();
                let draftedPids = { ...state.draftedPids };
                const lsCopies = Math.max(1, Number(state.playerCopies) || 1);
                let teamRosters = { ...state.teamRosters };
                let pickOrder = state.pickOrder.slice();
                let pickedByIdx = { ...(state.pickedByIdx || {}) };
                let currentIdx = state.currentIdx;
                let draftContext = state.draftContext;
                let duplicateCount = 0;
                let missedPickCount = 0;
                let reconciledCount = 0;
                let overwriteCount = 0;
                let lastPickNo = state.liveSync?.lastPickNo || 0;
                const existingPickNos = new Set(picks.map(livePickNo).filter(Boolean));
                const statusDuplicateCount = Number(action.status?.duplicateCount || 0);
                const statusMissedCount = Number(action.status?.missedPickCount || 0);
                const statusConflictCount = Number(action.status?.conflictCount || 0);
                const statusInvalidPickCount = Number(action.status?.invalidPickCount || 0);
                const statusMissingPickNos = Array.isArray(action.status?.missingPickNos)
                    ? action.status.missingPickNos.slice()
                    : [];
                const statusConflictPickNos = Array.isArray(action.status?.conflictPickNos)
                    ? action.status.conflictPickNos.slice()
                    : [];

                incoming.forEach(item => {
                    const sleeperPick = item.sleeperPick || item.raw || item;
                    const player = item.player;
                    const pickNo = Number(sleeperPick?.pick_no || (currentIdx + 1));
                    lastPickNo = Math.max(lastPickNo, pickNo);
                    if (!player?.pid) {
                        duplicateCount += 1;
                        return;
                    }

                    // ── Reconcile against a pick already recorded at this slot ──
                    // Hand-entered picks have no sleeperPickNo (so they're absent from
                    // existingPickNos) — match by overall slot number. If the live pick
                    // confirms the manual guess, mark it authoritative; if it differs,
                    // the real pick wins and the displaced player returns to the pool.
                    const occupantIdx = picks.findIndex(p => Number(p.overall) === pickNo);
                    if (occupantIdx >= 0) {
                        const occupant = picks[occupantIdx];
                        const occupantIsManual = occupant.source === 'manual-live' || occupant.source === 'manual-draft';
                        if (String(occupant.pid) === String(player.pid)) {
                            // Manual guess matched reality — confirm it once as live-sourced.
                            if (occupantIsManual) {
                                const confirmed = { ...occupant, source: 'live-sync', sleeperPickNo: pickNo, sleeperPickedBy: sleeperPick?.picked_by || occupant.sleeperPickedBy || null };
                                picks = picks.map((p, i) => i === occupantIdx ? confirmed : p);
                                pickedByIdx = { ...pickedByIdx, [confirmed.overall]: confirmed };
                                existingPickNos.add(pickNo);
                                reconciledCount += 1;
                            } else {
                                duplicateCount += 1;
                            }
                            return;
                        }
                        if (!occupantIsManual) {
                            // Two live records disagree for the same slot — a real conflict, don't clobber.
                            duplicateCount += 1;
                            return;
                        }
                        // Manual guess was wrong — overwrite with the real pick.
                        const ovRosterId = sleeperPick?.roster_id || occupant.rosterId;
                        const ovDhq = resolvePlayerDhq(player).value;
                        const liveReplacement = {
                            ...occupant,
                            id: 'pick_' + occupant.overall + '_' + Date.now(),
                            rosterId: ovRosterId,
                            isUser: String(ovRosterId) === String(state.userRosterId),
                            pid: player.pid,
                            name: player.name,
                            pos: player.pos,
                            dhq: ovDhq,
                            consensusRank: player.consensusRank || null,
                            photoUrl: player.photoUrl || '',
                            college: player.college || '',
                            tier: player.tier || null,
                            csv: player.csv || null,
                            reasoning: item.reasoning || { primary: 'Live pick corrected a manual entry', baseVal: ovDhq, nudges: [] },
                            confidence: item.confidence || 1.0,
                            alexReaction: null,
                            sleeperPickNo: pickNo,
                            sleeperPickedBy: sleeperPick?.picked_by || null,
                            source: 'live-sync',
                            ts: Date.now(),
                        };
                        const beforePicks = picks;
                        picks = picks.map((p, i) => i === occupantIdx ? liveReplacement : p);
                        const derived = rebuildDraftDerived(picks);
                        draftedPids = derived.draftedPids;
                        teamRosters = derived.teamRosters;
                        pickedByIdx = derived.pickedByIdx;
                        pool = rebuildPoolFromDrafted(state, draftedPids);
                        existingPickNos.add(pickNo);
                        overwriteCount += 1;
                        // Walk context back over the displaced manual pick, then forward over the live one.
                        const undoInterim = { ...state, picks: beforePicks.filter((_, i) => i !== occupantIdx), pool, draftedPids, teamRosters, currentIdx };
                        draftContext = window.DraftCC?.context?.undoPickInContext
                            ? window.DraftCC.context.undoPickInContext(draftContext, occupant, undoInterim)
                            : draftContext;
                        const applyInterim = { ...state, picks, pool, draftedPids, teamRosters, currentIdx };
                        draftContext = window.DraftCC?.context?.applyPickToContext
                            ? window.DraftCC.context.applyPickToContext(draftContext, liveReplacement, applyInterim)
                            : draftContext;
                        return;
                    }

                    // In a multi-copy league the same player legitimately appears in
                    // multiple picks — only reject as a duplicate once every copy is used.
                    if (existingPickNos.has(pickNo) || (draftedPids[player.pid] || 0) >= lsCopies) {
                        duplicateCount += 1;
                        return;
                    }
                    if (pickNo && pickNo !== currentIdx + 1) {
                        missedPickCount += Math.max(1, Math.abs(pickNo - (currentIdx + 1)));
                        return;
                    }

                    const slot = pickOrder[currentIdx];
                    if (!slot) return;
                    const rosterId = sleeperPick?.roster_id || slot.rosterId;
                    const adjustedSlot = {
                        ...slot,
                        rosterId,
                        traded: slot.originalRosterId != null && String(rosterId) !== String(slot.originalRosterId),
                    };
                    pickOrder[currentIdx] = adjustedSlot;

                    const lsNewCount = (draftedPids[player.pid] || 0) + 1;
                    draftedPids = { ...draftedPids, [player.pid]: lsNewCount };
                    // Keep the player available until his last copy is taken.
                    if (lsNewCount >= lsCopies) pool = pool.filter(p => String(p.pid) !== String(player.pid));
	                    const resolvedDhq = resolvePlayerDhq(player).value;
	                    const newPick = {
                        id: 'pick_' + adjustedSlot.overall + '_' + Date.now(),
                        round: adjustedSlot.round,
                        slot: adjustedSlot.slot,
                        pickInRound: adjustedSlot.pickInRound || adjustedSlot.slot,
                        overall: adjustedSlot.overall,
                        teamIdx: adjustedSlot.teamIdx,
                        rosterId,
                        isUser: String(rosterId) === String(state.userRosterId),
	                        pid: player.pid,
	                        name: player.name,
	                        pos: player.pos,
	                        dhq: resolvedDhq,
                        consensusRank: player.consensusRank || null,
                        photoUrl: player.photoUrl || '',
                        college: player.college || '',
                        tier: player.tier || null,
                        csv: player.csv || null,
	                        reasoning: item.reasoning || { primary: 'Live Sleeper pick', baseVal: resolvedDhq, nudges: [] },
                        confidence: item.confidence || 1.0,
                        alexReaction: null,
                        sleeperPickNo: pickNo,
                        sleeperPickedBy: sleeperPick?.picked_by || null,
                        source: 'live-sync',
                        ts: Date.now(),
                    };
                    picks = [...picks, newPick];
                    pickedByIdx = { ...pickedByIdx, [newPick.overall]: newPick };
                    existingPickNos.add(pickNo);
                    const teamPositions = teamRosters[adjustedSlot.teamIdx] || [];
                    teamRosters = {
                        ...teamRosters,
                        [adjustedSlot.teamIdx]: [...teamPositions, player.pos],
                    };
                    currentIdx += 1;
                    const nextStateForContext = {
                        ...state,
                        pool,
                        picks,
                        draftedPids,
                        currentIdx,
                        pickOrder,
                        teamRosters,
                    };
                    draftContext = window.DraftCC?.context?.applyPickToContext
                        ? window.DraftCC.context.applyPickToContext(draftContext, newPick, nextStateForContext)
                        : draftContext;
                });

                const statusPatch = {
                    ...(action.status || {}),
                    lastPickNo,
                    expectedPickNo: currentIdx + 1,
                    duplicateCount: statusDuplicateCount + duplicateCount,
                    missedPickCount: Math.max(statusMissedCount, missedPickCount),
                    missingPickNos: statusMissingPickNos,
                    conflictCount: statusConflictCount,
                    conflictPickNos: statusConflictPickNos,
                    invalidPickCount: statusInvalidPickCount,
                    reconciledCount: (reconciledCount || 0) + overwriteCount,
                    overwriteCount,
                    remoteBehind: !!action.status?.remoteBehind,
                };
                if (missedPickCount > 0 || statusConflictCount > 0 || statusInvalidPickCount > 0) {
                    statusPatch.status = 'stale';
                    statusPatch.stale = true;
                    if (missedPickCount > 0) {
                        statusPatch.missingPickNos = statusPatch.missingPickNos.length
                            ? statusPatch.missingPickNos
                            : [currentIdx + 1];
                    }
                    statusPatch.error = action.status?.error || (
                        statusConflictCount > 0
                            ? 'Sleeper returned conflicting pick records. Dynasty HQ paused before applying the wrong player.'
                            : statusInvalidPickCount > 0
                                ? 'Sleeper returned invalid pick data. Dynasty HQ paused so you can reconcile manually.'
                                : 'Sleeper pick order skipped ahead. Dynasty HQ paused rather than applying picks to the wrong slots.'
                    );
                }

                return {
                    ...state,
                    pool,
                    picks,
                    pickedByIdx,
                    draftedPids,
                    currentIdx,
                    pickOrder,
                    teamRosters,
                    draftContext,
                    phase: currentIdx >= pickOrder.length ? 'complete' : state.phase,
                    liveSync: mergeLiveSync(state.liveSync, statusPatch),
                };
            }

            case 'UPDATE_BOARD_CONTEXT': {
                const nextContext = window.DraftCC?.context?.applyBoardPatchToContext
                    ? window.DraftCC.context.applyBoardPatchToContext(state.draftContext, action.patch || {})
                    : state.draftContext;
                return { ...state, draftContext: nextContext };
            }

            // ── Phase 4: Alex AI ──────────────────────────────────────
            case 'ALEX_EVENT_ADD': {
                // payload: { id, type, badge, color, title, text, relatedPickNo, ts }
                const ev = {
                    id: action.event.id || ('ev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
                    type: action.event.type || 'rule',
                    badge: action.event.badge || '•',
                    color: action.event.color || 'var(--silver)',
                    title: action.event.title || '',
                    text: action.event.text || '',
                    relatedPickNo: action.event.relatedPickNo || null,
                    ts: action.event.ts || Date.now(),
                };
                // Cap stream at 80 most recent events (richer Alex stream)
                const newStream = [ev, ...state.alex.stream].slice(0, 80);
                return {
                    ...state,
                    alex: { ...state.alex, stream: newStream },
                };
            }

            case 'ALEX_SPEND_SONNET':
                return {
                    ...state,
                    alex: {
                        ...state.alex,
                        alexSpend: {
                            ...state.alex.alexSpend,
                            sonnet: (state.alex.alexSpend.sonnet || 0) + 1,
                        },
                    },
                };

            case 'ALEX_SPEND_FLASH':
                return {
                    ...state,
                    alex: {
                        ...state.alex,
                        alexSpend: {
                            ...state.alex.alexSpend,
                            flash: (state.alex.alexSpend.flash || 0) + 1,
                        },
                    },
                };

            case 'ALEX_SET_THINKING':
                return {
                    ...state,
                    alex: { ...state.alex, thinking: !!action.thinking },
                };

            case 'ALEX_UPDATE_BUDGET':
                return {
                    ...state,
                    alex: {
                        ...state.alex,
                        alexSpend: { ...state.alex.alexSpend, budget: action.budget },
                    },
                };

            case 'COMPLETE_PROPOSAL': {
                // payload: { accepted: boolean, offer: offer }
                if (!state.proposerDrawer) return state;
                if (!action.accepted) {
                    return {
                        ...state,
                        proposerDrawer: { ...state.proposerDrawer, status: 'declined' },
                    };
                }
                // Accepted: swap picks like ACCEPT_TRADE
                const offer = action.offer;
                const newPickOrder = state.pickOrder.map((p, idx) => {
                    if (idx < state.currentIdx) return p;
                    const isMyGive = (offer.myGive || []).some(g => g.round === p.round && g.teamIdx === p.teamIdx);
                    if (isMyGive) return { ...p, rosterId: offer.fromRosterId, traded: true };
                    const isTheirGive = (offer.theirGive || []).some(g => g.round === p.round && g.teamIdx === p.teamIdx);
                    if (isTheirGive) return { ...p, rosterId: state.userRosterId, traded: true };
                    return p;
                });
                // Record player + FAAB movement so roster/intel views can derive
                // effective post-trade state. Base rosters live outside state
                // (window.S.rosters), so we track deltas here rather than mutate.
                const ta = { ...(state.tradedAssets || {}) };
                const ensure = (rid) => {
                    if (!ta[rid]) ta[rid] = { incomingPlayers: [], outgoingPlayers: [], faabDelta: 0 };
                    return ta[rid];
                };
                const userRid = state.userRosterId;
                const cpuRid = offer.fromRosterId;
                const myGivePlayers = offer.myGivePlayers || [];
                const theirGivePlayers = offer.theirGivePlayers || [];
                const myGiveFaab = offer.myGiveFaab || 0;
                const theirGiveFaab = offer.theirGiveFaab || 0;
                if (myGivePlayers.length) {
                    ensure(userRid).outgoingPlayers = [...ensure(userRid).outgoingPlayers, ...myGivePlayers];
                    ensure(cpuRid).incomingPlayers = [...ensure(cpuRid).incomingPlayers, ...myGivePlayers];
                }
                if (theirGivePlayers.length) {
                    ensure(cpuRid).outgoingPlayers = [...ensure(cpuRid).outgoingPlayers, ...theirGivePlayers];
                    ensure(userRid).incomingPlayers = [...ensure(userRid).incomingPlayers, ...theirGivePlayers];
                }
                if (myGiveFaab > 0) { ensure(userRid).faabDelta -= myGiveFaab; ensure(cpuRid).faabDelta += myGiveFaab; }
                if (theirGiveFaab > 0) { ensure(cpuRid).faabDelta -= theirGiveFaab; ensure(userRid).faabDelta += theirGiveFaab; }
                // Future picks (sandbox-only) are recorded in the ledger, not pickOrder.
                const fpl = { ...(state.futurePicksLedger || {}) };
                (offer.myGiveFuture || []).forEach(fp => { fpl[futurePickKey(fp)] = cpuRid; });
                (offer.theirGiveFuture || []).forEach(fp => { fpl[futurePickKey(fp)] = userRid; });
                return {
                    ...state,
                    pickOrder: newPickOrder,
                    tradedAssets: ta,
                    futurePicksLedger: fpl,
                    proposerDrawer: { ...state.proposerDrawer, status: 'accepted' },
                    completedTrades: [
                        ...state.completedTrades,
                        { ...offer, acceptedAt: state.currentIdx, ts: Date.now(), userInitiated: true },
                    ],
                };
            }

            case 'MERGE_DRAFT_DNA': {
                // payload: { [rosterId]: DraftDnaShape } — merge only the draftDna field
                // so we don't clobber predictions or other persona state.
                const newPersonas = { ...state.personas };
                Object.entries(action.payload || {}).forEach(([rid, draftDna]) => {
                    if (newPersonas[rid]) {
                        newPersonas[rid] = {
                            ...newPersonas[rid],
                            draftDna: { ...newPersonas[rid].draftDna, ...draftDna },
                        };
                    }
                });
                return { ...state, personas: newPersonas };
            }

            case 'UPDATE_PREDICTIONS': {
                // payload: { [rosterId]: { willReach, willPassOn, likelyPick } }
                const newPersonas = { ...state.personas };
                Object.entries(action.payload || {}).forEach(([rid, preds]) => {
                    if (newPersonas[rid]) {
                        newPersonas[rid] = {
                            ...newPersonas[rid],
                            predictions: {
                                round: action.round || 0,
                                ...preds,
                            },
                        };
                    }
                });
                return { ...state, personas: newPersonas };
            }

            case 'RESET': {
                return initialDraftState({
                    leagueId: state.leagueId,
                    season: state.season,
                    mode: state.mode,
                    variant: state.variant,
                    rounds: state.rounds,
                    leagueSize: state.leagueSize,
                    draftType: state.draftType,
                    userRosterId: state.userRosterId,
                    userSlot: state.userSlot,
                    sleeperDraftId: state.sleeperDraftId,
                    liveDraftMeta: state.liveDraftMeta,
                    draftTuning: state.draftTuning,
                });
            }

            case 'HYDRATE':
                return { ...state, ...action.state };

            case 'SET_SPEED':
                return { ...state, speed: action.speed };

            case 'SET_MODE':
                return { ...state, mode: action.mode };

            case 'SET_SCENARIO':
                return { ...state, scenarioId: action.scenarioId };

            case 'SET_REPLAY_DRAFT':
                // payload: { draftId, draftMeta }
                return {
                    ...state,
                    sleeperDraftId: action.draftId,
                    replayMeta: action.meta || null,
                };

            case 'REPLAY_SEEK': {
                // Jump the replay pointer to a given pick index. Truncates
                // state.picks to that index and rebuilds draftedPids + teamRosters.
                if (!state.replay) return state;
                const target = Math.max(0, Math.min(action.idx || 0, state.replay.replayPicks.length));
                const picks = state.replay.replayPicks.slice(0, target);
                const derived = rebuildDraftDerived(picks);
                // Pool shrinks — drop a pid once all its copies are taken (copies===1 ⇒
                // drops on first pick; replay is Sleeper-only today so copies is 1, but
                // keep the count-aware form consistent with the rest of the reducer).
                const pool = rebuildPoolFromDrafted(state, derived.draftedPids);
                return {
                    ...state,
                    picks,
                    currentIdx: target,
                    pickedByIdx: derived.pickedByIdx,
                    draftedPids: derived.draftedPids,
                    teamRosters: derived.teamRosters,
                    pool,
                };
            }

            default:
                return state;
        }
    }

    // ── localStorage save/load (debounced externally) ────────────────
    // forcedMode is an explicit second arg so the Mock Draft and Live Sync
    // tabs never trample each other's auto-resume state.
    function saveToLocal(state, forcedMode) {
        if (!state || !state.leagueId) return;
        try {
            if (state.phase === 'setup') return;
            const toSave = {
                ...state,
                picks: state.picks.map(p => ({ ...p, csv: null })),
                pool: state.pool.slice(0, 300),
                originalPool: slimPool(state.originalPool && state.originalPool.length ? state.originalPool : state.pool, 600),
                personas: {},
            };
            // Use the tab's mode to pick the right key (live-sync → 'live', else 'mock')
            const keyMode = forcedMode || (state.mode === 'live-sync' ? 'live-sync' : null);
            localStorage.setItem(LS_KEY(state.leagueId, keyMode), JSON.stringify(toSave));
        } catch (e) {
            if (window.wrLog) window.wrLog('draftState.save', e);
        }
    }

    function loadFromLocal(leagueId, forcedMode) {
        if (!leagueId) return null;
        try {
            const raw = localStorage.getItem(LS_KEY(leagueId, forcedMode));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed.version !== DRAFT_STATE_VERSION) {
                localStorage.removeItem(LS_KEY(leagueId, forcedMode));
                return null;
            }
            // Sanity check: if forcedMode is set, ignore state with a mismatched mode
            if (forcedMode === 'live-sync' && parsed.mode !== 'live-sync') return null;
            if (!forcedMode && parsed.mode === 'live-sync') return null;
            if (!parsed.pickedByIdx) parsed.pickedByIdx = buildPickedByIdx(parsed.picks || []);
            if (!parsed.manualCorrections) parsed.manualCorrections = [];
            if (!parsed.stagedLiveOffers) parsed.stagedLiveOffers = [];
            // Backfill the Alex sub-state if a persisted (or legacy/partial) blob lacks it, so
            // the live Command Center can't white-screen reading state.alex.* on resume.
            if (!parsed.alex) parsed.alex = { style: 'default', stream: [], alexSpend: { sonnet: 0, flash: 0, budget: 12 }, thinking: false, lastInsightAt: 0 };
            else {
                if (!parsed.alex.alexSpend) parsed.alex.alexSpend = { sonnet: 0, flash: 0, budget: 12 };
                if (!Array.isArray(parsed.alex.stream)) parsed.alex.stream = [];
            }
            return parsed;
        } catch (e) {
            if (window.wrLog) window.wrLog('draftState.load', e);
            return null;
        }
    }

    function clearLocal(leagueId, forcedMode) {
        try { localStorage.removeItem(LS_KEY(leagueId, forcedMode)); } catch (e) {}
    }

    // ── Grade helper ─────────────────────────────────────────────────
    // Live draft grade — shares scorePick/aggregateGrade/gradeLetter with the
    // recap so the number on the clock tracks the post-draft recap. ctx optional;
    // pass { assessment } (persona.assessment) to enable the roster-need term.
    function gradeDraft(myPicks, originalPool, ctx = {}) {
        if (!myPicks.length) return { letter: '?', totalDHQ: 0, pct: 0, score: 0 };
        const totalDHQ = myPicks.reduce((s, p) => s + (p.dhq || 0), 0);
        const ranks = new Map((originalPool || []).map((p, i) => [p.pid, i + 1]));
        const scoreCtx = { assessment: ctx.assessment, _seenPos: {}, variant: ctx.variant, leagueSize: ctx.leagueSize, rounds: ctx.rounds, budget: ctx.budget };
        let total = 0;
        for (const p of myPicks) {
            // Backfill consensusRank from board position so a pick without a
            // baked-in rank still gets a real value term when the board can supply one.
            const fallbackRank = ranks.get(p.pid);
            const enriched = (p.consensusRank || !fallbackRank) ? p : { ...p, consensusRank: fallbackRank };
            total += scorePick(enriched, scoreCtx);
        }
        const score = Math.round(aggregateGrade(total / myPicks.length, ctx.variant));
        return { letter: gradeLetter(score), totalDHQ, pct: score, score };
    }

    function buildDraftRecap(state, opts = {}) {
        const userRosterId = opts.userRosterId ?? state?.userRosterId;
        const picks = (state?.picks || []).map(normalizePickRecord).filter(Boolean);
        const myPicks = picks.filter(p =>
            String(p.rosterId) === String(userRosterId)
            || (!p.rosterId && Number(p.slot) === Number(state?.userSlot))
            || p.isUser
        );
        const grade = opts.grade || gradeDraft(myPicks, state?.originalPool || [], {
            assessment: state?.personas?.[rosterKey(userRosterId)]?.assessment,
            variant: state?.variant,
            leagueSize: state?.leagueSize,
            rounds: state?.rounds,
            budget: state?.auctionBudget,
        });
        const leagueTotals = leagueTotalsFromPicks(picks);
        const totals = Object.entries(leagueTotals)
            .map(([rosterId, totalDHQ]) => ({ rosterId, totalDHQ }))
            .sort((a, b) => b.totalDHQ - a.totalDHQ);
        const rank = totals.findIndex(row => String(row.rosterId) === String(userRosterId)) + 1;
        const percentile = totals.length && rank > 0
            ? Math.round(((totals.length - rank) / Math.max(1, totals.length - 1)) * 100)
            : 0;
        const positionSummaryMap = emptyPositionSummary();
        myPicks.forEach(pick => addPickToPositionSummary(positionSummaryMap, pick));
        const positionSummary = orderedPositionSummary(positionSummaryMap);
        // Per-pick + overall efficiency vs the variant-aware expected value. This
        // is the "value vs expected pick" basis the recap grade is built on.
        const userCtx = { variant: state?.variant, leagueSize: state?.leagueSize, rounds: state?.rounds, budget: state?.auctionBudget };
        let myExpectedTotal = 0, myActualTotal = 0;
        const myPickSnapshots = myPicks.map(pick => {
            const expected = expectedDHQ(pick, userCtx);
            const actual = pickDhq(pick);
            myExpectedTotal += expected; myActualTotal += actual;
            return { ...pickSnapshot(pick), expectedDHQ: Math.round(expected), efficiency: expected ? +(actual / expected).toFixed(3) : null };
        });
        const efficiency = myExpectedTotal > 0 ? +(myActualTotal / myExpectedTotal).toFixed(3) : null;
        const gradeBasis = gradeBasisFor(state?.variant);
        const bestPick = myPickSnapshots.slice().sort((a, b) => {
            const av = (a.valueDelta || 0) * 120 + (a.dhq || 0);
            const bv = (b.valueDelta || 0) * 120 + (b.dhq || 0);
            return bv - av;
        })[0] || null;
        const biggestReach = myPickSnapshots
            .filter(p => p.consensusRank && p.valueDelta < 0)
            .sort((a, b) => a.valueDelta - b.valueDelta)[0] || null;
        // Worst pick = the user's lowest-DHQ selection (replaces the old Missed Target card).
        const worstPick = myPickSnapshots.slice().filter(p => (p.dhq || 0) > 0).sort((a, b) => (a.dhq || 0) - (b.dhq || 0))[0] || null;
        const bestAlternative = buildBestAlternative(state, myPicks, picks);
        const missedTarget = buildMissedTarget(state, picks, userRosterId);
        const tradeImpact = buildTradeImpact(state);
        const tradeVolume = buildTradeVolume(state);
        const teamRecaps = buildTeamRecaps(state, picks, leagueTotals);
        const leagueExtremes = buildLeagueExtremes(teamRecaps);
        const ownerLearning = buildOwnerLearning(teamRecaps);
        const userTeam = teamRecaps.find(t => String(t.rosterId) === String(userRosterId)) || null;
        const leagueStorylines = buildLeagueStorylines(teamRecaps, userRosterId);
        const postDraftMoves = buildPostDraftMoves(state, {
            userRosterId,
            picks,
            positionSummary,
            teamRecaps,
        });
        const actionPlan = buildActionPlan(state, {
            grade,
            positionSummary,
            bestAlternative,
            missedTarget,
            tradeImpact,
            postDraftMoves,
            userTeam,
        });
        return {
            schemaVersion: 'draft-recap-v5',
            id: opts.id || ('recap_' + Date.now()),
            leagueId: state?.leagueId || '',
            sleeperDraftId: state?.sleeperDraftId || null,
            season: state?.season || new Date().getFullYear(),
            mode: state?.mode || 'solo',
            variant: state?.variant || 'startup',
            grade,
            gradeBasis,
            efficiency,
            expectedDHQTotal: Math.round(myExpectedTotal),
            totalDHQ: grade.totalDHQ,
            pct: grade.pct,
            rank: rank || null,
            percentile,
            picks: myPickSnapshots,
            positionSummary,
            bestPick,
            biggestReach,
            worstPick,
            leagueExtremes,
            tradeVolume,
            bestAlternative,
            missedTarget,
            tradeImpact,
            postDraftMoves,
            actionPlan,
            leagueTotals,
            teamRecaps,
            leagueStorylines,
            ownerLearning,
            savedAt: Date.now(),
        };
    }

    // ── selectCurrentDraft — the league's "draft of record" ─────────────
    // The single rule every draft surface should use to decide which Sleeper
    // draft owns the room:
    //   1. 'live'     — a draft is actively drafting.
    //   2. 'review'   — the most recently completed draft, which STAYS current
    //                   until genuinely superseded: another draft goes live, or
    //                   a pre_draft draft is CREATED after this one finished.
    //                   (A league that pre-schedules its next draft — e.g. a
    //                   UDFA frenzy queued up before the rookie draft ran —
    //                   must NOT evict the just-completed draft.)
    //   3. 'upcoming' — the next scheduled pre_draft by start time.
    // Returns { draft, reason } with reason 'live'|'review'|'upcoming'|'none'.
    function selectCurrentDraft(drafts) {
        const list = (Array.isArray(drafts) ? drafts : []).filter(d => d && d.draft_id);
        if (!list.length) return { draft: null, reason: 'none' };
        const live = list.find(d => d.status === 'drafting');
        if (live) return { draft: live, reason: 'live' };
        const completedAtOf = d => Number(d.last_picked || d.start_time || d.created || 0);
        const latestComplete = list.filter(d => d.status === 'complete')
            .sort((a, b) => completedAtOf(b) - completedAtOf(a))[0] || null;
        const nextPre = list.filter(d => d.status === 'pre_draft')
            .sort((a, b) => (Number(a.start_time) || Infinity) - (Number(b.start_time) || Infinity))[0] || null;
        if (latestComplete) {
            const completedAt = completedAtOf(latestComplete);
            const superseded = list.some(d => d.status === 'pre_draft'
                && String(d.draft_id) !== String(latestComplete.draft_id)
                && Number(d.created || 0) > completedAt);
            if (!superseded) return { draft: latestComplete, reason: 'review' };
        }
        if (nextPre) return { draft: nextPre, reason: 'upcoming' };
        if (latestComplete) return { draft: latestComplete, reason: 'review' };
        return { draft: list[0], reason: 'upcoming' };
    }

    function draftLearningKey(leagueId) {
        return 'wr_draft_owner_learning_' + (leagueId || 'default');
    }

    function draftRecapArchiveKey(leagueId) {
        return 'wr_draft_recap_archive_' + (leagueId || 'default');
    }

    function readStoredArray(key) {
        if (typeof localStorage === 'undefined') return [];
        try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            if (window.wrLog) window.wrLog('draftState.readStoredArray', e);
            return [];
        }
    }

    function archiveDraftRecap(recap, opts = {}) {
        if (!recap?.leagueId || typeof localStorage === 'undefined') return [];
        try {
            const key = draftRecapArchiveKey(recap.leagueId);
            const existing = readStoredArray(key);
            const id = recap.id || ('recap_' + (recap.savedAt || Date.now()));
            const archived = {
                ...recap,
                id,
                archivedAt: opts.archivedAt || Date.now(),
            };
            const next = [archived, ...existing.filter(row => {
                    if (!row || row.id === id) return false;
                    // A live-synced REAL draft is ONE archive entry: re-opening the
                    // results re-saves the same sleeper draft — replace, don't dupe.
                    // (Mock recaps keep individual entries; each run is distinct.)
                    if (archived.mode === 'live-sync' && archived.sleeperDraftId
                        && row.mode === 'live-sync'
                        && String(row.sleeperDraftId || '') === String(archived.sleeperDraftId)) return false;
                    return true;
                })]
                .sort((a, b) => Number(b.savedAt || b.archivedAt || 0) - Number(a.savedAt || a.archivedAt || 0))
                .slice(0, opts.limit || 25);
            localStorage.setItem(key, JSON.stringify(next));
            return next;
        } catch (e) {
            if (window.wrLog) window.wrLog('draftState.archiveRecap', e);
            return [];
        }
    }

    function listDraftRecaps(leagueId) {
        const archive = readStoredArray(draftRecapArchiveKey(leagueId));
        const learning = readStoredArray(draftLearningKey(leagueId));
        const seen = new Set();
        const rows = archive.concat(learning)
            .filter(recap => {
                if (!recap) return false;
                const id = recap.id || String(recap.savedAt || '');
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
            })
            .map(recap => ({ ...recap, id: recap.id || ('recap_' + recap.savedAt) }))
            .sort((a, b) => Number(b.savedAt || b.archivedAt || 0) - Number(a.savedAt || a.archivedAt || 0));
        // Collapse duplicate live-sync recaps of the same real draft — archives
        // written before the write-side dedup hold several copies; newest wins.
        const seenLive = new Set();
        return rows.filter(r => {
            if (r.mode !== 'live-sync' || !r.sleeperDraftId) return true;
            const k = String(r.sleeperDraftId);
            if (seenLive.has(k)) return false;
            seenLive.add(k);
            return true;
        });
    }

    function deleteDraftRecap(leagueId, recapId) {
        if (!leagueId || !recapId || typeof localStorage === 'undefined') return [];
        const removeFrom = key => {
            const next = readStoredArray(key).filter(recap => recap?.id !== recapId);
            localStorage.setItem(key, JSON.stringify(next));
            return next;
        };
        removeFrom(draftLearningKey(leagueId));
        return removeFrom(draftRecapArchiveKey(leagueId));
    }

    function buildRecapLearningDefaults(leagueId, opts = {}) {
        // opts.modes limits which recap kinds feed the model — the setup studio
        // passes ['live-sync'] so only REAL drafts adjust tuning (mock recaps
        // stay archived but never feed the model; owner ask 2026-07-12).
        const recaps = listDraftRecaps(leagueId).filter(recap =>
            (!opts.variant || recap.variant === opts.variant)
            && (!opts.modes || opts.modes.includes(recap.mode)));
        const sample = recaps.slice(0, opts.limit || 8);
        const base = opts.baseTuning || {};
        const totals = sample.reduce((acc, recap) => {
            acc.picks += (recap.picks || []).length;
            acc.reaches += recap.biggestReach ? 1 : 0;
            acc.trades += recap.tradeImpact?.count || 0;
            acc.missedTargets += recap.missedTarget ? 1 : 0;
            acc.needActions += (recap.actionPlan || []).filter(a => ['need_followup', 'waiver_followup', 'post_draft_trade_map'].includes(a.type)).length;
            acc.percentile += Number(recap.percentile || 0);
            Object.values(recap.ownerLearning || {}).forEach(learning => {
                acc.ownerSignals += learning?.reasonCodes?.length || 0;
            });
            return acc;
        }, { picks: 0, reaches: 0, trades: 0, missedTargets: 0, needActions: 0, percentile: 0, ownerSignals: 0 });
        const sampleSize = sample.length;
        const avgPercentile = sampleSize ? Math.round(totals.percentile / sampleSize) : 0;
        const suggestedTuning = {
            ownerDna: Math.max(0, Math.min(100, Number(base.ownerDna ?? 70) + (totals.ownerSignals ? 6 : 0))),
            classValue: Math.max(0, Math.min(100, Number(base.classValue ?? 65) + (totals.reaches ? 7 : 0))),
            needFit: Math.max(0, Math.min(100, Number(base.needFit ?? 60) + (totals.needActions ? 6 : 0))),
            tradeActivity: Math.max(0, Math.min(100, Number(base.tradeActivity ?? 50) + (totals.trades ? 8 : 0))),
            variance: Math.max(0, Math.min(100, Number(base.variance ?? 45) - (totals.reaches ? 4 : 0))),
        };
        const notes = [];
        if (totals.ownerSignals) notes.push(`${totals.ownerSignals} owner-learning signals from prior draft recaps.`);
        if (totals.reaches) notes.push('Prior recaps flagged reach risk; class-value discipline is lifted.');
        if (totals.missedTargets) notes.push('Missed targets are feeding target-survival and trade-up pressure.');
        if (totals.trades) notes.push('Accepted draft trades are increasing room trade activity.');
        if (totals.needActions) notes.push('Post-draft need gaps are increasing roster-fit pressure.');
        return {
            schemaVersion: 'draft-recap-learning-v1',
            leagueId,
            variant: opts.variant || 'all',
            sampleSize,
            latestSavedAt: sample[0]?.savedAt || null,
            avgPercentile,
            suggestedTuning,
            notes,
            sourceRecapIds: sample.map(recap => recap.id).filter(Boolean),
        };
    }

    function saveDraftLearning(recap) {
        if (!recap?.leagueId || typeof localStorage === 'undefined') return null;
        try {
            const raw = localStorage.getItem(draftLearningKey(recap.leagueId));
            const existing = raw ? JSON.parse(raw) : [];
            const next = [recap, ...(Array.isArray(existing) ? existing : [])].slice(0, 20);
            localStorage.setItem(draftLearningKey(recap.leagueId), JSON.stringify(next));
            archiveDraftRecap(recap);
            if (window.App?.LI) {
                window.App.LI.draftOutcomes = next;
                const existingProfiles = window.App.LI.ownerBehaviorProfiles || {};
                const nextProfiles = { ...existingProfiles };
                Object.entries(recap.ownerLearning || {}).forEach(([rid, learning]) => {
                    nextProfiles[rid] = {
                        ...(nextProfiles[rid] || {}),
                        draftRecapLearning: {
                            rosterId: learning.rosterId,
                            ownerName: learning.ownerName,
                            lastDraftAt: recap.savedAt,
                            recapId: recap.id,
                            buildLabel: learning.buildLabel,
                            grade: learning.grade,
                            picks: learning.picks,
                            totalDHQ: learning.totalDHQ,
                            posCounts: learning.posCounts,
                            earlyPositions: learning.earlyPositions,
                            reaches: learning.reaches,
                            steals: learning.steals,
                            confidence: learning.confidence,
                            reasonCodes: learning.reasonCodes,
                        },
                    };
                });
                window.App.LI.ownerBehaviorProfiles = nextProfiles;
                window.App.LI.ownerDraftLearning = recap.ownerLearning || {};
            }
            return next;
        } catch (e) {
            if (window.wrLog) window.wrLog('draftState.saveLearning', e);
            return null;
        }
    }

    function saveDraftRecap(state, opts = {}) {
        const recap = buildDraftRecap(state, opts);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(opts.key || ('wr_draft_recap_' + Date.now()), JSON.stringify(recap));
        }
        archiveDraftRecap(recap);
        saveDraftLearning(recap);
        return recap;
    }

    function formatDraftShareReport(recap) {
        const lines = [
            '# Dynasty HQ Draft Recap',
            '',
            `Grade: ${recap?.grade?.letter || '?'} | DHQ: ${Number(recap?.totalDHQ || 0).toLocaleString()} | League Rank: ${recap?.rank ? '#' + recap.rank : 'N/A'} | Percentile: ${Number(recap?.percentile || 0)}th`,
            `Format: ${recap?.variant || 'draft'} | Season: ${recap?.season || ''}`,
            '',
            '## Executive Read',
        ];
        (recap?.leagueStorylines || []).slice(0, 4).forEach(line => lines.push('- ' + line));
        if (recap?.bestPick) lines.push(`- Best pick: ${recap.bestPick.name} at #${recap.bestPick.overall}.`);
        if (recap?.missedTarget) lines.push(`- Missed target: ${recap.missedTarget.name} went to ${recap.missedTarget.takenBy} at #${recap.missedTarget.overall}.`);
        if (recap?.tradeImpact?.summary) lines.push(`- Trade impact: ${recap.tradeImpact.summary}`);
        lines.push('', '## Action Plan');
        (recap?.actionPlan || []).forEach((item, i) => {
            lines.push(`${i + 1}. ${item.title}: ${item.detail}`);
        });
        const moves = recap?.postDraftMoves || {};
        if (moves.waiverTargets?.length || moves.tradeTargets?.length || moves.cutCandidates?.length) {
            lines.push('', '## Next Moves');
            if (moves.waiverTargets?.length) {
                lines.push('Waiver watchlist: ' + moves.waiverTargets.slice(0, 5).map(p => `${p.name} (${p.pos}, ${Number(p.dhq || 0).toLocaleString()} DHQ)`).join('; '));
            }
            if (moves.tradeTargets?.length) {
                lines.push('Trade map: ' + moves.tradeTargets.slice(0, 5).map(t => `${t.teamName} for ${t.pos} (${t.player?.name || 'new pick'})`).join('; '));
            }
            if (moves.cutCandidates?.length) {
                lines.push('Cut review: ' + moves.cutCandidates.slice(0, 4).map(p => `${p.name}${p.pos ? ' (' + p.pos + ')' : ''}`).join('; '));
            }
        }
        lines.push('', '## Team Grades');
        (recap?.teamRecaps || []).slice(0, 12).forEach(team => {
            lines.push(`- #${team.rank} ${team.teamName}: ${team.grade}, ${Number(team.totalDHQ || 0).toLocaleString()} DHQ, ${team.buildLabel}`);
        });
        lines.push('', '## Owner Learning Signals');
        Object.values(recap?.ownerLearning || {}).slice(0, 12).forEach(learning => {
            const signals = (learning.signals || []).slice(0, 3).join('; ') || 'No strong signal.';
            lines.push(`- ${learning.ownerName || 'Team ' + learning.rosterId}: ${signals}`);
        });
        return lines.join('\n');
    }

    function formatDraftRecapText(recap) {
        const lines = [
            'Draft Recap - ' + (recap?.grade?.letter || '?') + ' (' + Number(recap?.totalDHQ || 0).toLocaleString() + ' DHQ, ' + Number(recap?.pct || 0) + '% value)',
            '',
        ];
        if (recap?.rank) {
            lines.push('League rank: #' + recap.rank + ' · ' + recap.percentile + 'th percentile by draft DHQ');
            lines.push('');
        }
        if (recap?.bestPick) {
            lines.push('Best pick: ' + recap.bestPick.name + ' at #' + recap.bestPick.overall + ' (' + Number(recap.bestPick.dhq || 0).toLocaleString() + ' DHQ)');
        }
        if (recap?.biggestReach) {
            lines.push('Biggest reach: ' + recap.biggestReach.name + ' at #' + recap.biggestReach.overall + ' (' + Math.abs(Number(recap.biggestReach.valueDelta || 0)) + ' picks early)');
        }
        if (recap?.missedTarget) {
            lines.push('Missed target: ' + recap.missedTarget.name + ' to ' + recap.missedTarget.takenBy + ' at #' + recap.missedTarget.overall);
        }
        if (recap?.tradeImpact?.summary) {
            lines.push('Trade impact: ' + recap.tradeImpact.summary);
        }
        if (recap?.actionPlan?.length) {
            lines.push('');
            lines.push('Action plan:');
            recap.actionPlan.forEach((item, i) => {
                lines.push('  ' + (i + 1) + '. ' + item.title + ' - ' + item.detail);
            });
        }
        if (recap?.leagueStorylines?.length) {
            lines.push('');
            lines.push('League recap:');
            recap.leagueStorylines.forEach(item => lines.push('  - ' + item));
        }
        lines.push('');
        lines.push('Your draft class:');
        (recap?.picks || []).forEach((pk, i) => {
            lines.push('  ' + (i + 1) + '. ' + (pk.name || pk.pid) + ' - ' + (pk.pos || '?') + ' · ' + Number(pk.dhq || 0).toLocaleString() + ' DHQ');
        });
        if (recap?.teamRecaps?.length) {
            lines.push('');
            lines.push('Team grades:');
            recap.teamRecaps.slice(0, 12).forEach(team => {
                lines.push('  #' + team.rank + ' ' + team.teamName + ' - ' + team.grade + ' · ' + Number(team.totalDHQ || 0).toLocaleString() + ' DHQ · ' + team.buildLabel);
            });
        }
        return lines.join('\n');
    }

    // Apply the tradedAssets ledger on top of a base roster to derive the
    // player-ids the roster effectively controls inside the mock context.
    function getEffectivePlayers(state, rosterId, basePlayers) {
        const ledger = state?.tradedAssets?.[rosterId];
        if (!ledger) return basePlayers || [];
        const out = new Set(basePlayers || []);
        (ledger.outgoingPlayers || []).forEach(pid => out.delete(pid));
        (ledger.incomingPlayers || []).forEach(pid => out.add(pid));
        return [...out];
    }
    function getFaabDelta(state, rosterId) {
        return state?.tradedAssets?.[rosterId]?.faabDelta || 0;
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.state = {
        DRAFT_STATE_VERSION,
        LS_KEY,
        DEFAULT_DRAFT_TUNING,
        draftStrategyStudioKey,
        getDraftStrategyPresets,
        buildDraftStrategyProfile,
        loadDraftStrategyProfile,
        saveDraftStrategyProfile,
        applyDraftStrategyProfileToTuning,
        initialDraftState,
        normalizeLeagueTypeValue,
        detectDraftVariant,
        selectCurrentDraft,
        buildPool,
        buildPickOrder,
        resolvePlayerDhq,
        resolveDraftPickValue,
        buildFuturePickPool,
        futurePickKey,
        futurePickValueFor,
        reducer,
        saveToLocal,
        loadFromLocal,
        clearLocal,
        gradeDraft,
        scorePick,
        gradeLetter,
        recapLetter,
        aggregateGrade,
        slotBaselineDHQ,
        expectedDHQ,
        pickEfficiency,
        gradeBasisFor,
        REACH_STEAL_THRESHOLD,
        normalizePickRecord,
        buildPickedByIdx,
        leagueTotalsFromPicks,
        buildTeamRecaps,
        rosterName,
        buildDraftRecap,
        saveDraftRecap,
        saveDraftLearning,
        archiveDraftRecap,
        listDraftRecaps,
        deleteDraftRecap,
        buildRecapLearningDefaults,
        formatDraftRecapText,
        formatDraftShareReport,
        getEffectivePlayers,
        getFaabDelta,
    };
})();
