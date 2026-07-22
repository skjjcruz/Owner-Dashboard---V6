// ================================================================
// js/draft/context.js - DraftContext + Owner Intel contract
//
// P0 foundation for War Room draft reliability. This module normalizes the
// draft setup, board lanes, team context, owner history, and evidence into one
// object that mock picks, trade scoring, board overlays, Alex, recaps, and
// future Scout surfaces can consume.
//
// Depends on: window.App.*, optional App.Intelligence
// Exposes:    window.DraftCC.context
// ================================================================

(function() {
    'use strict';

    const VERSION = 'draft-context-v1';
    const BOARD_LANES = {
        DHQ: 'dhq',
        AI: 'ai',
        USER: 'my',
    };

    const DRAFT_TYPES = new Set(['rookie', 'startup', 'redraft', 'best_ball', 'auction', 'live-sync', 'manual']);
    const DRAFT_FORMAT_ADAPTERS = {
        rookie: {
            id: 'rookie',
            label: 'Rookie Draft',
            valueHorizon: 'development',
            projectionYears: 5,
            needBias: 0.82,
            youthPremium: 1.1,
            positionMultipliers: {},
        },
        startup: {
            id: 'startup',
            label: 'Dynasty Startup',
            valueHorizon: 'multi_year_value',
            projectionYears: 5,
            needBias: 1,
            youthPremium: 1.06,
            positionMultipliers: {},
        },
        redraft: {
            id: 'redraft',
            label: 'Redraft',
            valueHorizon: 'current_season',
            projectionYears: 1,
            needBias: 1.18,
            youthPremium: 1,
            positionMultipliers: { RB: 1.04, WR: 1.02, TE: 1.01, QB: 0.99 },
        },
        best_ball: {
            id: 'best_ball',
            label: 'Best Ball',
            valueHorizon: 'weekly_ceiling',
            projectionYears: 2,
            needBias: 0.72,
            youthPremium: 1.02,
            positionMultipliers: { WR: 1.09, QB: 1.04, TE: 1.04, RB: 0.98 },
            stackAware: true,
        },
        manual: {
            id: 'manual',
            label: 'Manual Board',
            valueHorizon: 'user_defined',
            projectionYears: 5,
            needBias: 1,
            youthPremium: 1,
            positionMultipliers: {},
        },
        'live-sync': {
            id: 'live-sync',
            label: 'Live Draft',
            valueHorizon: 'live_context',
            projectionYears: 5,
            needBias: 1,
            youthPremium: 1.04,
            positionMultipliers: {},
        },
    };
    const IDP_SLOTS = new Set(['IDP', 'IDP_FLEX', 'DL', 'DE', 'DT', 'EDGE', 'LB', 'DB', 'CB', 'S', 'SS', 'FS']);
    const QB_PREMIUM_SLOTS = new Set(['SUPER_FLEX', 'QB_FLEX', 'OP', 'WRTQ', 'WILDCARD']);
    const BENCH_SLOTS = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI']);

    function clamp(n, lo, hi, fallback) {
        const v = Number(n);
        if (!Number.isFinite(v)) return fallback;
        return Math.max(lo, Math.min(hi, v));
    }

    function idKey(value) {
        return value == null ? '' : String(value);
    }

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function uniqueIds(ids) {
        const seen = new Set();
        const out = [];
        asArray(ids).forEach(id => {
            const key = idKey(id);
            if (!key || seen.has(key)) return;
            seen.add(key);
            out.push(key);
        });
        return out;
    }

    function mergeKeyedPatch(base, patch) {
        const out = { ...(base || {}) };
        Object.entries(patch || {}).forEach(([key, value]) => {
            if (value == null || value === '') delete out[key];
            else out[key] = value;
        });
        return out;
    }

    function boardStorageKey(leagueId, draftType) {
        const keys = window.App?.WR_KEYS;
        const type = normalizeDraftType({ draftType });
        if (keys?.BIGBOARD_DRAFT) return keys.BIGBOARD_DRAFT(leagueId, type);
        if (keys?.BIGBOARD) return keys.BIGBOARD(leagueId);
        return `wr_bigboard_${leagueId}_${type}`;
    }

    function legacyBoardStorageKey(leagueId) {
        const keys = window.App?.WR_KEYS;
        if (keys?.BIGBOARD) return keys.BIGBOARD(leagueId);
        return `wr_bigboard_${leagueId}`;
    }

    function mergeBoardData(base, patch) {
        const b = base && typeof base === 'object' ? base : {};
        const p = patch && typeof patch === 'object' ? patch : {};
        return {
            ...b,
            ...p,
            tags: mergeKeyedPatch(b.tags, p.tags),
            notes: mergeKeyedPatch(b.notes, p.notes),
            tiers: mergeKeyedPatch(b.tiers, p.tiers),
            fades: mergeKeyedPatch(b.fades, p.fades),
            targets: mergeKeyedPatch(b.targets, p.targets),
            drafted: p.drafted || b.drafted || [],
            aiOrder: p.aiOrder || b.aiOrder || [],
            myOrder: p.myOrder || b.myOrder || [],
            savedViews: p.savedViews || b.savedViews || [],
            lineage: { ...(b.lineage || {}), ...(p.lineage || {}) },
        };
    }

    function rankMap(order) {
        const out = {};
        uniqueIds(order).forEach((pid, idx) => { out[pid] = idx + 1; });
        return out;
    }

    function getLeagueId(input) {
        const data = input || {};
        return idKey(data.leagueId || data.currentLeague?.league_id || data.currentLeague?.id || data.state?.leagueId || window.S?.leagues?.[0]?.league_id || '');
    }

    function loadStoredBoard(leagueId, draftType, explicitBoardData) {
        const fallback = explicitBoardData || null;
        try {
            const keys = window.App?.WR_KEYS;
            const store = window.App?.WrStorage;
            if (!keys?.BIGBOARD || !store?.get) return fallback || {};
            const legacyKey = legacyBoardStorageKey(leagueId);
            const typedKey = boardStorageKey(leagueId, draftType);
            const legacy = store.get(legacyKey, fallback || {}) || {};
            const typed = typedKey !== legacyKey ? (store.get(typedKey, {}) || {}) : {};
            return mergeBoardData(mergeBoardData(fallback || {}, legacy), typed);
        } catch (e) {
            if (window.wrLog) window.wrLog('draftContext.loadStoredBoard', e);
            return fallback || {};
        }
    }

    function saveBoardPatch(leagueId, draftType, patch) {
        if (!leagueId) return null;
        try {
            const store = window.App?.WrStorage;
            if (!store?.set) return null;
            const next = mergeBoardData(loadStoredBoard(leagueId, draftType), {
                ...patch,
                lineage: {
                    ...(patch?.lineage || {}),
                    source: 'wr_bigboard',
                    userLastEditedAt: new Date().toISOString(),
                },
                updatedAt: new Date().toISOString(),
            });
            store.set(boardStorageKey(leagueId, draftType), next);
            return next;
        } catch (e) {
            if (window.wrLog) window.wrLog('draftContext.saveBoardPatch', e);
            return null;
        }
    }

    function normalizeDraftType(input) {
        const data = input || {};
        const state = data.state || {};
        const raw = data.draftType || state.draftType || state.variant || data.variant || '';
        const forcedMode = data.forcedMode || state.mode || '';
        if (forcedMode === 'live-sync') return 'live-sync';
        if (raw === 'rookie') return 'rookie';
        if (raw === 'best_ball' || raw === 'bestball') return 'best_ball';
        if (raw === 'redraft') return 'redraft';
        if (raw === 'auction') return 'auction';
        if (raw === 'manual') return 'manual';
        if (raw === 'startup' || raw === 'snake' || raw === 'linear' || !raw) return state.variant === 'rookie' ? 'rookie' : 'startup';
        return DRAFT_TYPES.has(raw) ? raw : 'startup';
    }

    function getDraftFormatAdapter(input = {}) {
        const type = normalizeDraftType(input);
        const base = DRAFT_FORMAT_ADAPTERS[type] || DRAFT_FORMAT_ADAPTERS.startup;
        const flags = input.leagueFormat?.flags || {};
        const positionMultipliers = { ...(base.positionMultipliers || {}) };
        if (flags.superflex) positionMultipliers.QB = Math.max(positionMultipliers.QB || 1, type === 'redraft' ? 1.04 : 1.08);
        if (flags.tePremium) positionMultipliers.TE = Math.max(positionMultipliers.TE || 1, type === 'best_ball' ? 1.08 : 1.05);
        if (flags.idp) {
            positionMultipliers.DL = Math.max(positionMultipliers.DL || 1, 1.02);
            positionMultipliers.LB = Math.max(positionMultipliers.LB || 1, 1.02);
            positionMultipliers.DB = Math.max(positionMultipliers.DB || 1, 1.01);
        }
        return {
            ...base,
            draftType: type,
            positionMultipliers,
            evidence: [
                { source: 'league_format', present: !!input.leagueFormat },
                { source: 'scoring_flags', present: Object.values(flags).some(Boolean) },
            ],
        };
    }

    function scoringProfile(scoring) {
        const s = scoring || {};
        const rec = Number(s.rec || 0);
        const teRec = Number(s.rec_te || s.bonus_rec_te || 0);
        const passTd = Number(s.pass_td || 4);
        return {
            ppr: rec >= 0.9 ? 'ppr' : rec >= 0.4 ? 'half_ppr' : 'standard',
            receptionValue: Number.isFinite(rec) ? rec : 0,
            passTd,
            tePremium: teRec > 0 || Number(s.bonus_te_rec || 0) > 0,
            firstDownBonus: Object.keys(s).some(k => /fd|first_down/i.test(k) && Number(s[k]) > 0),
            yardageBonus: Object.keys(s).some(k => /bonus.*yd|yd.*bonus/i.test(k) && Number(s[k]) > 0),
            raw: s,
        };
    }

    function buildLeagueFormat(input) {
        const data = input || {};
        const league = data.currentLeague || window.S?.leagues?.[0] || {};
        const state = data.state || {};
        const rosterPositions = asArray(league.roster_positions || league.rosterPositions || []);
        const scoring = scoringProfile(league.scoring_settings || league.scoringSettings || {});
        const upperSlots = rosterPositions.map(s => String(s || '').toUpperCase());
        const activeSlots = upperSlots.filter(s => s && !BENCH_SLOTS.has(s));
        const flags = {
            superflex: upperSlots.some(s => QB_PREMIUM_SLOTS.has(s)),
            idp: upperSlots.some(s => IDP_SLOTS.has(s)),
            tePremium: !!scoring.tePremium,
            bestBall: !!(league.settings?.best_ball || league.metadata?.best_ball || data.draftType === 'best_ball' || state.variant === 'best_ball'),
            keeper: !!(league.settings?.keeper_count || league.metadata?.keeper_count),
            auction: normalizeDraftType(data) === 'auction',
        };
        return {
            schemaVersion: VERSION,
            sport: 'football',
            season: Number(league.season || state.season || new Date().getFullYear()),
            teams: Number(league.settings?.num_teams || state.leagueSize || (window.S?.rosters || []).length || 12),
            draftType: normalizeDraftType(data),
            draftOrderType: state.draftType || data.draftOrderType || 'snake',
            rosterSlots: rosterPositions,
            activeRosterSlots: activeSlots,
            startingLineupSize: activeSlots.length,
            scoring,
            flags,
            variants: Object.entries(flags).filter(([, v]) => !!v).map(([k]) => k),
        };
    }

    function buildPlayerUniverse(input) {
        const data = input || {};
        const draftType = normalizeDraftType(data);
        const pool = asArray(data.pool || data.state?.pool);
        const sourceCounts = pool.reduce((acc, p) => {
            const src = p?.source || (p?.isCSV || p?.csv ? 'CSV_PROSPECT' : 'DHQ_ENGINE');
            acc[src] = (acc[src] || 0) + 1;
            return acc;
        }, {});
        return {
            schemaVersion: VERSION,
            mode: draftType === 'rookie' ? 'rookies_only'
                : draftType === 'manual' ? 'custom_board'
                    : draftType === 'redraft' ? 'seasonal_pool'
                        : draftType === 'best_ball' ? 'best_ball_pool'
                            : 'veterans_plus_rookies',
            draftType,
            poolSize: pool.length,
            sourceCounts,
            importedClass: pool.some(p => p?.csv || p?.isCSV),
            includesVeterans: draftType !== 'rookie',
            includesRookies: true,
        };
    }

    function loadStrategy(leagueId) {
        let gmMode = null;
        let gmModeDesc = null;
        let strategy = null;
        try {
            if (window.WR?.GmMode) {
                gmMode = window.WR.GmMode.getMode?.(leagueId) || null;
                gmModeDesc = window.WR.GmMode.describe?.(gmMode) || null;
            }
        } catch (e) {}
        try {
            if (window.GMStrategy?.getStrategy) strategy = window.GMStrategy.getStrategy() || null;
        } catch (e) {}
        try {
            const keys = window.App?.WR_KEYS;
            const store = window.App?.WrStorage;
            if (!strategy && keys?.GM_STRATEGY && store?.get) strategy = store.get(keys.GM_STRATEGY(leagueId), null);
        } catch (e) {}
        return {
            gmMode,
            gmModeDesc,
            strategy: strategy || {},
            draftWeights: gmModeDesc?.draftWeights || {},
        };
    }

    function posOfNeed(assessment) {
        return asArray(assessment?.needs)
            .map(n => typeof n === 'string' ? n : n?.pos)
            .filter(Boolean);
    }

    function projectedValue(player, years) {
        const dhq = Number(player?.dhq || player?.val || 0);
        const age = Number(player?.age || player?.csv?.age || 0);
        const project = window.App?.PlayerValue?.projectPlayerValue;
        if (!project || !dhq || !age || !years) return dhq;
        try {
            return Number(project(player.pid, dhq, age, player.pos, years)) || dhq;
        } catch (_) {
            return dhq;
        }
    }

    function clampAiBoardScore(adjusted, base) {
        const rawBase = Number(base || 0);
        if (!rawBase) return Number(adjusted || 0);
        const rawAdjusted = Number(adjusted || rawBase);
        return clamp(rawAdjusted, rawBase * 0.82, rawBase * 1.22, rawBase);
    }

    function buildAiRecommendedOrder(pool, input) {
        const data = input || {};
        const strategy = data.strategy || {};
        const draftWeights = data.draftWeights || {};
        const needs = new Set(posOfNeed(data.userAssessment || data.assessment));
        const draftStyle = strategy.draftStyle || strategy.mode || 'mix';
        // Editor vocabulary is 'positional_need' (strategy-editor.js); bare
        // 'need' kept for legacy stored strategies. Canonical timeline values
        // are '1_year' | '2_3_years' | 'dynasty_long' (strategy.js) — the long
        // horizon is what earns the youth-premium fallback.
        const needBias =
            (draftStyle === 'positional_need' || draftStyle === 'need') ? 1.35 :
            draftStyle === 'bpa' ? 0.8 :
            Number(draftWeights.needBias) || 1;
        const youthPremium = Number(draftWeights.youthPremium) || (strategy.timeline === 'dynasty_long' ? 1.12 : 1);
        const targetPositions = new Set(asArray(strategy.targetPositions || strategy.targets || []));
        const fadePositions = new Set(asArray(strategy.sellPositions || strategy.blockPositions || []));
        const adapter = data.formatAdapter || getDraftFormatAdapter(data);

        return asArray(pool).slice().sort((a, b) => {
            const score = p => {
                const pos = p?.pos || p?.position || '';
                const baseValue = projectedValue(p, adapter.projectionYears);
                let value = baseValue;
                value *= Number(adapter.positionMultipliers?.[pos] || 1);
                if (adapter.id === 'best_ball' && p?.tier && Number(p.tier) <= 2) value *= 1.035;
                if (needs.has(pos)) value *= (1 + 0.12 * needBias * Number(adapter.needBias || 1));
                if (targetPositions.has(p?.pos)) value *= 1.05;
                if (fadePositions.has(p?.pos)) value *= 0.96;
                const age = Number(p?.age || p?.csv?.age || 0);
                if (age && age <= 24 && ['RB', 'WR', 'TE'].includes(p?.pos) && adapter.id !== 'redraft') value *= youthPremium * Number(adapter.youthPremium || 1);
                if (p?.tier === 1 || p?.csv?.tier === 1) value *= 1.04;
                return clampAiBoardScore(value, baseValue);
            };
            const delta = score(b) - score(a);
            if (Math.abs(delta) > 0.001) return delta;
            return (Number(b?.dhq || 0) - Number(a?.dhq || 0));
        }).map(p => idKey(p?.pid)).filter(Boolean);
    }

    function buildBoardContext(input) {
        const data = input || {};
        const leagueId = getLeagueId(data);
        const draftType = normalizeDraftType(data);
        const pool = asArray(data.pool || data.state?.pool);
        // The board store is keyed by the league draft VARIANT, not the live-sync
        // MODE — so the Follow Live Draft board and the Draft tab's Big Board are one
        // shared store (notes, tags, My Board order). Map a live-sync draftType down
        // to the underlying variant for the storage key only.
        const boardKeyType = draftType === 'live-sync'
            ? normalizeDraftType({ draftType: data.variant || data.state?.variant })
            : draftType;
        const saved = loadStoredBoard(leagueId, boardKeyType, data.boardData);
        const strategyInfo = data.strategyInfo || loadStrategy(leagueId);
        const leagueFormat = data.leagueFormat || buildLeagueFormat({ ...data, draftType });
        const formatAdapter = data.formatAdapter || getDraftFormatAdapter({ ...data, draftType, leagueFormat });
        const dhqOrder = uniqueIds(
            pool.slice()
                .sort((a, b) => Number(b?.dhq || 0) - Number(a?.dhq || 0))
                .map(p => p?.pid)
        );
        // Free tier: the strategy-fit re-rank is an optimizer output → Pro
        // (mirror draft-room.js aiRecommendedOrder). Degrading here — the single
        // seam — covers the AI lane, My-board seeding, entry.aiRank, and every
        // downstream boardContext consumer with the raw value order instead.
        const aiOrder = (typeof window.wrIsPro === 'function' && !window.wrIsPro())
            ? dhqOrder
            : uniqueIds(buildAiRecommendedOrder(pool, {
                strategy: strategyInfo.strategy,
                draftWeights: strategyInfo.draftWeights,
                assessment: data.userAssessment,
                draftType,
                leagueFormat,
                formatAdapter,
            }));
        const myOrder = uniqueIds(saved.myOrder && saved.myOrder.length ? saved.myOrder : aiOrder);

        const tags = saved.tags || {};
        const notes = saved.notes || {};
        const tiers = saved.tiers || {};
        const fades = saved.fades || {};
        const targets = saved.targets || {};
        const drafted = new Set(asArray(saved.drafted).map(idKey));
        const dhqRanks = rankMap(dhqOrder);
        const aiRanks = rankMap(aiOrder);
        const myRanks = rankMap(myOrder);
        const playersById = {};
        pool.forEach(p => { if (p?.pid) playersById[idKey(p.pid)] = p; });

        const allIds = uniqueIds([].concat(dhqOrder, aiOrder, myOrder, Object.keys(tags), Object.keys(notes), Object.keys(tiers)));
        const entries = {};
        allIds.forEach(pid => {
            const p = playersById[pid] || {};
            const hasTierOverride = Object.prototype.hasOwnProperty.call(tiers, pid);
            const tierOverride = hasTierOverride ? Number(tiers[pid]) : null;
            entries[pid] = {
                pid,
                name: p.name || p.full_name || '',
                pos: p.pos || p.position || '',
                dhq: Number(p.dhq || p.val || 0),
                dhqRank: dhqRanks[pid] || null,
                aiRank: aiRanks[pid] || null,
                myRank: myRanks[pid] || null,
                tier: hasTierOverride ? (tierOverride || null) : (p.tier || p.csv?.tier || null),
                tag: tags[pid] || null,
                note: notes[pid] || '',
                fade: !!fades[pid] || tags[pid] === 'avoid' || tags[pid] === 'fade',
                target: !!targets[pid] || tags[pid] === 'target' || tags[pid] === 'must',
                drafted: drafted.has(pid),
            };
        });

        const manualEditCount = Object.keys(notes).length
            + Object.keys(tags).length
            + Object.keys(tiers).length
            + (saved.myOrder && saved.myOrder.length ? saved.myOrder.length : 0);

        return {
            schemaVersion: VERSION,
            leagueId,
            draftType,
            activeLane: saved.activeLane || saved.boardMode || BOARD_LANES.DHQ,
            lanes: {
                [BOARD_LANES.DHQ]: { label: 'DHQ Board', order: dhqOrder, source: 'dhq_value' },
                [BOARD_LANES.AI]: { label: 'AI Recommended Board', order: aiOrder, source: 'strategy_recommendation' },
                [BOARD_LANES.USER]: {
                    label: 'My Board',
                    order: myOrder,
                    source: saved.myOrder && saved.myOrder.length ? 'user_manual' : 'seeded_from_ai',
                    seededFrom: saved.myOrder && saved.myOrder.length ? (saved.lineage?.seededFrom || null) : BOARD_LANES.AI,
                },
            },
            entries,
            tags,
            notes,
            tiers,
            drafted: Array.from(drafted),
            savedViews: asArray(saved.savedViews),
            lineage: {
                source: saved.lineage?.source || 'wr_bigboard',
                seededFrom: saved.lineage?.seededFrom || (saved.myOrder?.length ? null : BOARD_LANES.AI),
                aiGeneratedAt: saved.lineage?.aiGeneratedAt || saved.aiGeneratedAt || null,
                userLastEditedAt: saved.lineage?.userLastEditedAt || saved.updatedAt || null,
            },
            manualEditCount,
            canSeedMyBoardFromAi: !saved.myOrder || saved.myOrder.length === 0,
            formatAdapter,
        };
    }

    function confidenceFromSample(sample) {
        const n = Number(sample || 0);
        if (n >= 15) return 'high';
        if (n >= 5) return 'medium';
        if (n > 0) return 'low';
        return 'inferred';
    }

    function confidenceScore(label) {
        if (label === 'high') return 90;
        if (label === 'medium') return 68;
        if (label === 'low') return 42;
        return 24;
    }

    function addReason(out, reason) {
        if (!reason || !reason.code) return;
        out.push({
            code: reason.code,
            label: reason.label || reason.code,
            detail: reason.detail || '',
            source: reason.source || 'owner_intel',
            confidence: reason.confidence || 'inferred',
        });
    }

    function topPosition(posPct) {
        const rows = Object.entries(posPct || {}).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
        return rows[0] || null;
    }

    function summarizeBehaviorProfile(profile) {
        if (!profile) return null;
        const facts = asArray(profile.observedFacts).slice(0, 4);
        return {
            sample: profile.sample || {},
            inferences: asArray(profile.inferences),
            scores: profile.scores || {},
            strategy: profile.strategy || {},
            confidence: profile.confidence || 'low',
            facts,
        };
    }

    function behaviorProfileFor(rosterId, input) {
        const data = input || {};
        const key = idKey(rosterId);
        if (data.behaviorProfile) return data.behaviorProfile;
        if (data.behaviorProfiles?.[key]) return data.behaviorProfiles[key];
        if (window.App?.LI?.ownerBehaviorProfiles?.[key]) return window.App.LI.ownerBehaviorProfiles[key];
        try {
            if (window.App?.Intelligence?.buildOwnerBehaviorProfile) {
                return window.App.Intelligence.buildOwnerBehaviorProfile({
                    rosterId,
                    league: data.currentLeague,
                    rosters: window.S?.rosters || data.currentLeague?.rosters || [],
                    ownerProfiles: window.App?.LI?.ownerProfiles || {},
                    tradeHistory: window.App?.LI?.tradeHistory || [],
                    draftOutcomes: window.App?.LI?.draftOutcomes || [],
                    faabTxns: window.App?.LI?.faabTxns || [],
                    dnaKey: data.persona?.tradeDna?.key,
                    dnaLabel: data.persona?.tradeDna?.label,
                });
            }
        } catch (e) {
            if (window.wrLog) window.wrLog('draftContext.behaviorProfile', e);
        }
        return null;
    }

    function buildOwnerIntel(persona, input = {}) {
        const p = persona || {};
        const rosterId = p.rosterId || input.rosterId || null;
        const draftDna = p.draftDna || {};
        const tradeDna = p.tradeDna || {};
        const assessment = p.assessment || {};
        const posture = p.posture || {};
        const behavior = summarizeBehaviorProfile(behaviorProfileFor(rosterId, { ...input, persona: p }));
        const draftSample = Number(draftDna.picksAnalyzed || behavior?.sample?.draftPicks || 0);
        const tradeSample = Number(behavior?.sample?.trades || 0);
        const draftConfidence = confidenceFromSample(draftSample);
        const tradeConfidence = behavior?.confidence || confidenceFromSample(tradeSample);
        const reasonCodes = [];
        const topPos = topPosition(draftDna.posPct || {});

        if (topPos && Number(topPos[1]) >= 20) {
            addReason(reasonCodes, {
                code: 'draft_position_bias',
                label: 'Position bias',
                detail: `${p.teamName || 'This owner'} has drafted ${topPos[0]} on ${Math.round(Number(topPos[1]))}% of tracked picks.`,
                source: 'draft_dna',
                confidence: draftConfidence,
            });
        }
        if (asArray(draftDna.r1Positions).length) {
            const counts = asArray(draftDna.r1Positions).reduce((acc, pos) => {
                acc[pos] = (acc[pos] || 0) + 1;
                return acc;
            }, {});
            const topR1 = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
            if (topR1) {
                addReason(reasonCodes, {
                    code: 'early_round_pattern',
                    label: 'Early-round pattern',
                    detail: `Round 1/2 history leans ${topR1[0]} (${topR1[1]} tracked picks).`,
                    source: 'draft_dna',
                    confidence: draftConfidence,
                });
            }
        }
        if (tradeDna.key && tradeDna.key !== 'NONE') {
            addReason(reasonCodes, {
                code: 'trade_dna',
                label: 'Trade DNA',
                detail: `${tradeDna.label || tradeDna.key} profile affects acceptance framing.`,
                source: tradeDna.source === 'assigned' ? 'owner_dna' : 'owner_dna_fallback',
                confidence: tradeConfidence,
            });
        }
        if (behavior?.inferences?.length) {
            addReason(reasonCodes, {
                code: 'behavior_profile',
                label: 'Behavior profile',
                detail: behavior.inferences.slice(0, 3).join(', '),
                source: 'league_behavior',
                confidence: behavior.confidence,
            });
        }
        if (draftSample < 3 && tradeSample < 2) {
            addReason(reasonCodes, {
                code: 'thin_history',
                label: 'Thin history',
                detail: 'Limited historical sample; simulator should blend in format-aware archetypes.',
                source: 'sample_size',
                confidence: 'inferred',
            });
        }

        const confidenceAreas = {
            draft: draftConfidence,
            trade: tradeConfidence,
            roster: assessment.healthScore ? 'medium' : 'inferred',
            waiver: behavior?.sample?.faabTransactions ? confidenceFromSample(behavior.sample.faabTransactions) : 'inferred',
        };
        const overallScore = Math.round((
            confidenceScore(confidenceAreas.draft)
            + confidenceScore(confidenceAreas.trade)
            + confidenceScore(confidenceAreas.roster)
            + confidenceScore(confidenceAreas.waiver)
        ) / 4);
        const overall =
            overallScore >= 78 ? 'high' :
            overallScore >= 55 ? 'medium' :
            overallScore >= 34 ? 'low' :
            'inferred';

        return {
            schemaVersion: VERSION,
            rosterId,
            ownerId: p.ownerId || null,
            teamName: p.teamName || '',
            ownerName: p.ownerName || '',
            confidence: {
                overall,
                score: overallScore,
                areas: confidenceAreas,
                sample: {
                    draftPicks: draftSample,
                    trades: tradeSample,
                    faabTransactions: Number(behavior?.sample?.faabTransactions || 0),
                },
            },
            draft: {
                label: draftDna.label || 'Balanced',
                tendency: draftDna.tendency || '',
                posPct: draftDna.posPct || {},
                r1Positions: asArray(draftDna.r1Positions),
                earlyDefPct: Number(draftDna.earlyDefPct || 0),
                avgQBRound: draftDna.avgQBRound || null,
                sample: draftSample,
            },
            trade: {
                key: tradeDna.key || 'NONE',
                label: tradeDna.label || 'Balanced',
                taxes: asArray(tradeDna.taxes),
                appetite: posture.key === 'LOCKED' ? 'closed' : behavior?.scores?.liquidity >= 70 ? 'active' : behavior?.scores?.liquidity <= 35 ? 'selective' : 'balanced',
                offerFrame: behavior?.strategy?.offerFrame || tradeDna.strategy || '',
                sample: tradeSample,
            },
            roster: {
                window: assessment.window || assessment.tier || 'CROSSROADS',
                healthScore: Number(assessment.healthScore || 50),
                needs: asArray(assessment.needs),
                strengths: asArray(assessment.strengths),
                posture,
            },
            behavior,
            reasonCodes,
            evidence: [
                { source: 'owner_dna', present: !!tradeDna.key && tradeDna.key !== 'NONE' },
                { source: 'draft_dna', present: draftSample > 0 },
                { source: 'league_behavior', present: !!behavior },
                { source: 'team_assessment', present: !!assessment.healthScore },
            ],
        };
    }

    function buildOwnerIntelMap(personas, input = {}) {
        const out = {};
        Object.entries(personas || {}).forEach(([rid, persona]) => {
            out[idKey(rid)] = persona?.ownerIntel || buildOwnerIntel(persona, input);
        });
        return out;
    }

    function buildTeamContext(input) {
        const data = input || {};
        const state = data.state || {};
        const myRoster = data.myRoster || {};
        const userRosterId = state.userRosterId || myRoster.roster_id || null;
        const userPersona = userRosterId ? data.personas?.[userRosterId] : null;
        return {
            schemaVersion: VERSION,
            userRosterId,
            userSlot: state.userSlot || null,
            currentRoster: uniqueIds([].concat(myRoster.players || [], myRoster.reserve || [], myRoster.taxi || [])),
            picksOwned: asArray(data.pickOrder || state.pickOrder).filter(p => idKey(p.rosterId) === idKey(userRosterId)),
            tradedPicks: asArray(window.S?.tradedPicks),
            teamWindow: userPersona?.assessment?.window || userPersona?.assessment?.tier || null,
            needs: asArray(userPersona?.assessment?.needs),
            strengths: asArray(userPersona?.assessment?.strengths),
            positionalHealth: userPersona?.assessment || {},
            mockAdds: asArray(state.picks).filter(p => p.isUser),
            tradedAssets: state.tradedAssets || {},
        };
    }

    function buildValuationContext(input) {
        const data = input || {};
        const pool = asArray(data.pool || data.state?.pool);
        const byPos = {};
        pool.forEach(p => {
            const pos = p?.pos || '?';
            if (!byPos[pos]) byPos[pos] = [];
            byPos[pos].push(Number(p?.dhq || p?.val || 0));
        });
        Object.keys(byPos).forEach(pos => {
            byPos[pos] = byPos[pos].sort((a, b) => b - a).slice(0, 12);
        });
        return {
            schemaVersion: VERSION,
            dhqSource: 'App.LI.playerScores',
            marketSource: window.App?._rookieMarketRows ? 'fantasycalc' : null,
            scarcityByPosition: byPos,
            projectionWindows: {
                threeYear: 'planned',
                fiveYear: 'planned',
            },
            ageCurve: window.App?.ageCurveWindows || window.ageCurveWindows || null,
        };
    }

    function buildLeagueProfile(input) {
        try {
            if (window.App?.Intelligence?.buildLeagueProfile) {
                return window.App.Intelligence.buildLeagueProfile({
                    league: input.currentLeague || window.S?.leagues?.[0],
                    scoring: input.currentLeague?.scoring_settings,
                    rosterPositions: input.currentLeague?.roster_positions,
                    teams: input.state?.leagueSize,
                });
            }
        } catch (e) {
            if (window.wrLog) window.wrLog('draftContext.leagueProfile', e);
        }
        return null;
    }

    function buildDraftContext(input = {}) {
        const state = input.state || {};
        const leagueId = getLeagueId(input);
        const draftType = normalizeDraftType(input);
        const pool = asArray(input.pool || state.pool);
        const pickOrder = asArray(input.pickOrder || state.pickOrder);
        const strategyInfo = loadStrategy(leagueId);
        const leagueFormat = buildLeagueFormat({ ...input, draftType });
        const formatAdapter = getDraftFormatAdapter({ ...input, draftType, leagueFormat });
        const ownerContext = buildOwnerIntelMap(input.personas || state.personas || {}, input);
        const teamContext = buildTeamContext({ ...input, pool, pickOrder });
        const boardContext = buildBoardContext({
            ...input,
            leagueId,
            draftType,
            pool,
            userAssessment: teamContext.positionalHealth,
            strategyInfo,
            leagueFormat,
            formatAdapter,
        });

        return {
            schemaVersion: VERSION,
            id: input.id || state.id || ('draft_context_' + Date.now()),
            leagueId,
            season: Number(input.currentLeague?.season || state.season || new Date().getFullYear()),
            draftType,
            mode: state.mode || input.mode || 'solo',
            phase: state.phase || 'setup',
            runtime: {
                currentIdx: Number(state.currentIdx || 0),
                picksMade: asArray(state.picks).length,
                totalPicks: pickOrder.length,
                remainingPoolSize: pool.length,
                lastPick: asArray(state.picks).slice(-1)[0] || null,
            },
            leagueFormat: { ...leagueFormat, formatAdapter },
            leagueProfile: buildLeagueProfile(input),
            playerUniverse: buildPlayerUniverse({ ...input, draftType, pool }),
            boardContext,
            teamContext,
            ownerContext,
            valuationContext: buildValuationContext({ ...input, pool }),
            simulation: {
                tuning: state.draftTuning || {},
                activeBoardLane: boardContext.activeLane,
                strategy: strategyInfo.strategy,
                gmMode: strategyInfo.gmMode,
                draftWeights: strategyInfo.draftWeights,
                formatAdapter,
            },
            evidence: [
                { source: 'dhq', present: pool.some(p => Number(p?.dhq || 0) > 0) },
                { source: 'sleeper', present: !!(window.S?.rosters || []).length },
                { source: 'owner_behavior', present: Object.values(ownerContext).some(o => o?.confidence?.sample?.trades > 0) },
                { source: 'draft_history', present: Object.values(ownerContext).some(o => o?.confidence?.sample?.draftPicks > 0) },
                { source: 'manual_board', present: boardContext.manualEditCount > 0 },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    }

    function applyPickToContext(context, pick, nextState) {
        if (!context) return context;
        const pid = idKey(pick?.pid);
        const entries = { ...(context.boardContext?.entries || {}) };
        if (pid && entries[pid]) entries[pid] = { ...entries[pid], drafted: true };
        return {
            ...context,
            phase: nextState?.phase || context.phase,
            runtime: {
                ...(context.runtime || {}),
                currentIdx: Number(nextState?.currentIdx || 0),
                picksMade: asArray(nextState?.picks).length,
                remainingPoolSize: asArray(nextState?.pool).length,
                lastPick: pick || null,
            },
            boardContext: context.boardContext ? {
                ...context.boardContext,
                entries,
                drafted: uniqueIds([].concat(context.boardContext.drafted || [], pid ? [pid] : [])),
            } : context.boardContext,
            teamContext: context.teamContext ? {
                ...context.teamContext,
                mockAdds: asArray(nextState?.picks).filter(p => p.isUser),
                tradedAssets: nextState?.tradedAssets || context.teamContext.tradedAssets || {},
            } : context.teamContext,
            updatedAt: new Date().toISOString(),
        };
    }

    function undoPickInContext(context, pick, nextState) {
        if (!context) return context;
        const pid = idKey(pick?.pid);
        const entries = { ...(context.boardContext?.entries || {}) };
        if (pid && entries[pid]) entries[pid] = { ...entries[pid], drafted: false };
        const drafted = (context.boardContext?.drafted || []).filter(id => idKey(id) !== pid);
        return {
            ...context,
            phase: nextState?.phase || context.phase,
            runtime: {
                ...(context.runtime || {}),
                currentIdx: Number(nextState?.currentIdx || 0),
                picksMade: asArray(nextState?.picks).length,
                remainingPoolSize: asArray(nextState?.pool).length,
                lastPick: asArray(nextState?.picks).slice(-1)[0] || null,
            },
            boardContext: context.boardContext ? {
                ...context.boardContext,
                entries,
                drafted,
            } : context.boardContext,
            teamContext: context.teamContext ? {
                ...context.teamContext,
                mockAdds: asArray(nextState?.picks).filter(p => p.isUser),
                tradedAssets: nextState?.tradedAssets || context.teamContext.tradedAssets || {},
            } : context.teamContext,
            updatedAt: new Date().toISOString(),
        };
    }

    function applyBoardPatchToContext(context, patch) {
        if (!context?.boardContext || !patch) return context;
        const board = context.boardContext;
        const lanes = {
            ...(board.lanes || {}),
            [BOARD_LANES.DHQ]: { ...(board.lanes?.[BOARD_LANES.DHQ] || { order: [] }) },
            [BOARD_LANES.AI]: { ...(board.lanes?.[BOARD_LANES.AI] || { order: [] }) },
            [BOARD_LANES.USER]: { ...(board.lanes?.[BOARD_LANES.USER] || { order: [] }) },
        };

        if (patch.aiOrder) {
            lanes[BOARD_LANES.AI] = {
                ...lanes[BOARD_LANES.AI],
                order: uniqueIds(patch.aiOrder),
                source: 'strategy_recommendation',
            };
        }
        if (patch.myOrder) {
            lanes[BOARD_LANES.USER] = {
                ...lanes[BOARD_LANES.USER],
                order: uniqueIds(patch.myOrder),
                source: 'user_manual',
                seededFrom: null,
            };
        }

        const tags = mergeKeyedPatch(board.tags, patch.tags);
        const notes = mergeKeyedPatch(board.notes, patch.notes);
        const tiers = mergeKeyedPatch(board.tiers, patch.tiers);
        const fades = mergeKeyedPatch(board.fades, patch.fades);
        const targets = mergeKeyedPatch(board.targets, patch.targets);
        const drafted = uniqueIds(patch.drafted || board.drafted || []);
        const dhqRanks = rankMap(lanes[BOARD_LANES.DHQ]?.order || []);
        const aiRanks = rankMap(lanes[BOARD_LANES.AI]?.order || []);
        const myRanks = rankMap(lanes[BOARD_LANES.USER]?.order || []);
        const ids = uniqueIds([]
            .concat(Object.keys(board.entries || {}))
            .concat(lanes[BOARD_LANES.DHQ]?.order || [])
            .concat(lanes[BOARD_LANES.AI]?.order || [])
            .concat(lanes[BOARD_LANES.USER]?.order || [])
            .concat(Object.keys(tags), Object.keys(notes), Object.keys(tiers), Object.keys(fades), Object.keys(targets), drafted));
        const entries = {};
        ids.forEach(pid => {
            const prev = board.entries?.[pid] || { pid };
            const hasTierOverride = Object.prototype.hasOwnProperty.call(tiers, pid);
            const tierOverride = hasTierOverride ? Number(tiers[pid]) : null;
            entries[pid] = {
                ...prev,
                dhqRank: dhqRanks[pid] || prev.dhqRank || null,
                aiRank: aiRanks[pid] || prev.aiRank || null,
                myRank: myRanks[pid] || prev.myRank || null,
                tier: hasTierOverride ? (tierOverride || null) : (prev.tier || null),
                tag: tags[pid] || null,
                note: notes[pid] || '',
                fade: !!fades[pid] || tags[pid] === 'avoid' || tags[pid] === 'fade',
                target: !!targets[pid] || tags[pid] === 'target' || tags[pid] === 'must',
                drafted: drafted.includes(pid) || !!prev.drafted,
            };
        });

        const manualEditCount = Object.keys(notes).length
            + Object.keys(tags).length
            + Object.keys(tiers).length
            + (lanes[BOARD_LANES.USER]?.source === 'user_manual' ? (lanes[BOARD_LANES.USER]?.order || []).length : 0);

        return {
            ...context,
            boardContext: {
                ...board,
                activeLane: patch.activeLane || board.activeLane || BOARD_LANES.DHQ,
                lanes,
                entries,
                tags,
                notes,
                tiers,
                fades,
                targets,
                drafted,
                lineage: {
                    ...(board.lineage || {}),
                    ...(patch.lineage || {}),
                    userLastEditedAt: patch.updatedAt || new Date().toISOString(),
                },
                manualEditCount,
                canSeedMyBoardFromAi: lanes[BOARD_LANES.USER]?.source !== 'user_manual',
            },
            simulation: context.simulation ? {
                ...context.simulation,
                activeBoardLane: patch.activeLane || context.simulation.activeBoardLane,
            } : context.simulation,
            updatedAt: new Date().toISOString(),
        };
    }

    function summarizeOwnerIntel(ownerIntel) {
        if (!ownerIntel) return '';
        const top = asArray(ownerIntel.reasonCodes)[0];
        const confidence = ownerIntel.confidence?.overall || 'inferred';
        if (top?.detail) return `${confidence} confidence: ${top.detail}`;
        return `${confidence} confidence owner profile`;
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.context = {
        VERSION,
        BOARD_LANES,
        DRAFT_FORMAT_ADAPTERS,
        normalizeDraftType,
        getDraftFormatAdapter,
        buildLeagueFormat,
        buildPlayerUniverse,
        buildBoardContext,
        buildAiRecommendedOrder,
        buildOwnerIntel,
        buildOwnerIntelMap,
        buildTeamContext,
        buildValuationContext,
        buildDraftContext,
        applyPickToContext,
        undoPickInContext,
        applyBoardPatchToContext,
        saveBoardPatch,
        summarizeOwnerIntel,
        _private: {
            confidenceFromSample,
            loadStoredBoard,
            boardStorageKey,
            loadStrategy,
        },
    };
})();
