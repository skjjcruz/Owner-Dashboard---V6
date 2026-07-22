// ══════════════════════════════════════════════════════════════════
// js/draft/analyst-mock.js — analyst-style projected league mocks
//
// Generates a full pick-by-pick league mock without requiring the user to
// play through the room. Uses board basis, Owner Intel/personas, roster
// needs, and mock tuning to produce explainable projected picks.
//
// Exposes: window.DraftCC.analystMock
// ══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Seeded phrase variation so projected picks don't all read identically.
    const avPick = (seed, arr) => (window.AlexVoice ? window.AlexVoice.pick(seed, arr) : arr[0]);

    const PRESETS = [
        {
            id: 'chalk',
            label: 'Chalk Board',
            basis: 'dhq',
            desc: 'DHQ-board discipline with low variance.',
            tuning: { ownerDna: 5, classValue: 98, needFit: 8, tradeActivity: 15, variance: 8 },
        },
        {
            id: 'league-history',
            label: 'League History',
            basis: 'ai',
            desc: 'Owner DNA plus league historical position pace.',
            tuning: { ownerDna: 100, classValue: 26, needFit: 28, tradeActivity: 44, variance: 8 },
        },
        {
            id: 'my-board',
            label: 'My Board Lens',
            basis: 'my',
            desc: 'Projects the room against your saved board assumptions.',
            tuning: { ownerDna: 62, classValue: 78, needFit: 50, tradeActivity: 42, variance: 20 },
        },
        {
            id: 'need-heavy',
            label: 'Need Heavy',
            basis: 'ai',
            desc: 'Owners attack roster holes earlier.',
            tuning: { ownerDna: 55, classValue: 48, needFit: 92, tradeActivity: 42, variance: 22 },
        },
        {
            id: 'trade-heavy',
            label: 'Trade Heavy',
            basis: 'ai',
            desc: 'More trade-up and tier-chase pressure in the notes.',
            tuning: { ownerDna: 72, classValue: 56, needFit: 62, tradeActivity: 92, variance: 34 },
        },
        {
            id: 'chaos',
            label: 'Chaos Room',
            basis: 'dhq',
            desc: 'Wide pick variance and more reach outcomes.',
            tuning: { ownerDna: 48, classValue: 35, needFit: 45, tradeActivity: 68, variance: 88 },
        },
    ];

    function clamp(n, lo, hi, fallback) {
        const v = Number(n);
        if (!Number.isFinite(v)) return fallback;
        return Math.max(lo, Math.min(hi, v));
    }

    function idKey(value) {
        return value == null ? '' : String(value);
    }

    function stripLeadingTeamName(text, teamName) {
        const raw = String(text || '').trim();
        const team = String(teamName || '').trim();
        if (!raw || !team) return raw;
        if (raw.toLowerCase().startsWith(team.toLowerCase() + ' is ')) {
            return 'This roster is ' + raw.slice(team.length + 4);
        }
        if (raw.toLowerCase().startsWith(team.toLowerCase() + ' has ')) {
            return 'This roster has ' + raw.slice(team.length + 5);
        }
        return raw;
    }

    function presetFor(id) {
        return PRESETS.find(p => p.id === id) || PRESETS[1];
    }

    function effectiveTuning(state, preset, overrides) {
        const base = state?.draftTuning || {};
        const forced = preset?.tuning || {};
        const out = {};
        ['ownerDna', 'classValue', 'needFit', 'tradeActivity', 'variance'].forEach(key => {
            out[key] = clamp(overrides?.[key] ?? forced[key] ?? base[key], 0, 100, 50);
        });
        return out;
    }

    function hashUnit(input) {
        const s = String(input || '');
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return ((h >>> 0) % 10000) / 10000;
    }

    function normalizedPos(pos) {
        const raw = String(pos || '').toUpperCase();
        if (['CB', 'S', 'SS', 'FS'].includes(raw)) return 'DB';
        if (['DE', 'DT', 'NT', 'IDL', 'EDGE'].includes(raw)) return 'DL';
        if (['OLB', 'ILB', 'MLB'].includes(raw)) return 'LB';
        return raw || '?';
    }

    function specialistDraftPenalty(pos, slot) {
        const nPos = normalizedPos(pos);
        if (!['K', 'P'].includes(nPos)) return 0;
        const round = Number(slot?.round || 1);
        const overall = Number(slot?.overall || 1);
        if (round <= 3) return 250000;
        if (round <= 5) return 65000;
        return overall <= 80 ? 24000 : 6500;
    }

    const IDP_POSITIONS = new Set(['DL', 'LB', 'DB']);

    function isIdpPos(pos) {
        return IDP_POSITIONS.has(normalizedPos(pos));
    }

    function posPctValue(posPct, pos) {
        const nPos = normalizedPos(pos);
        let total = 0;
        Object.entries(posPct || {}).forEach(([rawPos, pct]) => {
            if (normalizedPos(rawPos) === nPos) total += Number(pct || 0);
        });
        return total;
    }

    function loadSavedBoard(state, draftType) {
        const leagueId = state?.leagueId;
        if (!leagueId) return {};
        try {
            if (window.DraftCC?.context?._private?.loadStoredBoard) {
                return window.DraftCC.context._private.loadStoredBoard(leagueId, draftType || state.variant || 'startup') || {};
            }
            const keys = window.App?.WR_KEYS;
            const store = window.App?.WrStorage;
            if (keys?.BIGBOARD_DRAFT && store?.get) return store.get(keys.BIGBOARD_DRAFT(leagueId, draftType || state.variant || 'startup'), {}) || {};
            if (keys?.BIGBOARD && store?.get) return store.get(keys.BIGBOARD(leagueId), {}) || {};
        } catch (e) {
            if (window.wrLog) window.wrLog('analystMock.loadSavedBoard', e);
        }
        return {};
    }

    function rankPoolByBasis(pool, state, basis) {
        const src = Array.isArray(pool) ? pool.slice() : [];
        const saved = loadSavedBoard(state, state?.variant);
        const laneOrder = basis === 'my' && Array.isArray(saved.myOrder) && saved.myOrder.length
            ? saved.myOrder
            : basis === 'ai' && Array.isArray(saved.aiOrder) && saved.aiOrder.length
                ? saved.aiOrder
                : null;
        if (!laneOrder) {
            return src.sort((a, b) => {
                if (basis === 'market') return (a.consensusRank || a.rank || 9999) - (b.consensusRank || b.rank || 9999);
                return (b.dhq || 0) - (a.dhq || 0);
            }).map((p, i) => ({ ...p, analystBoardRank: i + 1 }));
        }
        const rank = new Map();
        laneOrder.forEach((pid, i) => rank.set(idKey(pid), i + 1));
        return src.sort((a, b) => {
            const ar = rank.get(idKey(a.pid)) || rank.get(idKey(a.csvPid)) || Infinity;
            const br = rank.get(idKey(b.pid)) || rank.get(idKey(b.csvPid)) || Infinity;
            if (ar !== br) return ar - br;
            return (b.dhq || 0) - (a.dhq || 0);
        }).map((p, i) => ({ ...p, analystBoardRank: i + 1 }));
    }

    function canonicalPlayerDhq(player) {
        const resolved = window.DraftCC?.state?.resolvePlayerDhq?.(player);
        if (resolved?.value > 0) return { value: resolved.value, source: resolved.source };
        return { value: Number(player?.dhq || player?.val || 0) || 0, source: 'attached-dhq' };
    }

    function normalizePoolValues(pool) {
        return (pool || []).map(player => {
            const resolved = canonicalPlayerDhq(player);
            return {
                ...player,
                dhq: resolved.value,
                valueSource: resolved.source,
            };
        }).filter(player => Number(player.dhq || 0) > 0);
    }

    function ownerBiasScore(persona, pos) {
        const nPos = normalizedPos(pos);
        const pct = posPctValue(persona?.draftDna?.posPct, nPos);
        if (pct) return clamp(pct, 0, 100, 0);
        const early = persona?.draftDna?.r1Positions || persona?.draftDna?.earlyPositions || [];
        if (Array.isArray(early) && early.length) {
            const hits = early.filter(p => normalizedPos(p) === nPos).length;
            if (hits) return clamp(25 + hits * 18, 0, 90, 0);
        }
        const codes = persona?.ownerIntel?.reasonCodes || [];
        const text = codes.map(c => [c.code, c.label, c.detail].filter(Boolean).join(' ')).join(' ').toUpperCase();
        return text.includes(nPos) ? 38 : 0;
    }

    function needScore(persona, pos) {
        const nPos = normalizedPos(pos);
        const needs = persona?.assessment?.needs || [];
        for (const raw of needs) {
            const item = typeof raw === 'string' ? { pos: raw, urgency: 'need' } : raw;
            if (normalizedPos(item?.pos) !== nPos) continue;
            const u = String(item?.urgency || item?.level || '').toLowerCase();
            if (u.includes('deficit') || u.includes('critical')) return 94;
            if (u.includes('thin') || u.includes('high')) return 76;
            return 60;
        }
        return 18;
    }

    function addWeightedPct(acc, rawPos, pct, weight) {
        const pos = normalizedPos(rawPos);
        const val = Number(pct || 0);
        if (!pos || pos === '?' || !val) return;
        acc[pos] = (acc[pos] || 0) + val * weight;
    }

    function normalizeShares(counts) {
        const total = Object.values(counts || {}).reduce((sum, val) => sum + Number(val || 0), 0);
        const out = {};
        if (!total) return out;
        Object.entries(counts || {}).forEach(([key, val]) => {
            out[key] = Number(val || 0) / total;
        });
        return out;
    }

    function buildLeagueHistoryProfile(personas) {
        const posPctCounts = {};
        const r1Counts = {};
        let posPctWeight = 0;
        let r1Total = 0;
        let earlyDefTotal = 0;
        let earlyDefWeight = 0;
        let overallDefTotal = 0;
        let overallDefWeight = 0;
        let samplePicks = 0;

        Object.values(personas || {}).forEach(persona => {
            const dna = persona?.draftDna || {};
            const sample = clamp(dna.picksAnalyzed || dna.sample || 0, 0, 120, 0);
            const weight = sample ? Math.max(6, Math.min(60, sample)) : 8;
            const posPct = dna.posPct || {};
            let hasPct = false;
            Object.entries(posPct).forEach(([rawPos, pct]) => {
                if (!Number(pct || 0)) return;
                hasPct = true;
                addWeightedPct(posPctCounts, rawPos, pct, weight);
            });
            if (hasPct) posPctWeight += weight;
            const r1 = Array.isArray(dna.r1Positions) ? dna.r1Positions : [];
            r1.forEach(rawPos => {
                const pos = normalizedPos(rawPos);
                if (!pos || pos === '?') return;
                r1Counts[pos] = (r1Counts[pos] || 0) + 1;
                r1Total += 1;
            });
            const earlyDefPct = Number(dna.earlyDefPct);
            if (Number.isFinite(earlyDefPct) && (sample || earlyDefPct > 0)) {
                earlyDefTotal += clamp(earlyDefPct, 0, 100, 0) * weight;
                earlyDefWeight += weight;
            }
            const overallDefPct = Number(dna.overallDefPct);
            if (Number.isFinite(overallDefPct) && (sample || overallDefPct > 0)) {
                overallDefTotal += clamp(overallDefPct, 0, 100, 0) * weight;
                overallDefWeight += weight;
            }
            samplePicks += sample;
        });

        const posShare = normalizeShares(posPctCounts);
        const r1Share = normalizeShares(r1Counts);
        const aggregateIdpShare = ['DL', 'LB', 'DB'].reduce((sum, pos) => sum + Number(posShare[pos] || 0), 0);
        const overallIdpShare = overallDefWeight
            ? overallDefTotal / overallDefWeight / 100
            : aggregateIdpShare;
        const earlyIdpShare = earlyDefWeight
            ? earlyDefTotal / earlyDefWeight / 100
            : Math.min(overallIdpShare || aggregateIdpShare || 0, 0.18);

        return {
            ready: posPctWeight > 0 || r1Total > 0 || earlyDefWeight > 0,
            samplePicks,
            posShare,
            r1Share,
            r1Total,
            earlyIdpShare: clamp(earlyIdpShare, 0, 0.7, 0),
            overallIdpShare: clamp(overallIdpShare || aggregateIdpShare, 0, 0.85, aggregateIdpShare),
            aggregateIdpShare: clamp(aggregateIdpShare, 0, 0.85, 0),
        };
    }

    function expectedIdpShare(profile, slot) {
        if (!profile?.ready) return 0;
        const round = Number(slot?.round || 1);
        const early = Number(profile.earlyIdpShare || 0);
        const overall = Number(profile.overallIdpShare || profile.aggregateIdpShare || 0);
        if (round <= 2) return early || Math.min(overall, 0.18);
        if (round <= 5) return (early || Math.min(overall, 0.18)) * 0.55 + overall * 0.45;
        return overall;
    }

    function expectedPositionShare(profile, pos, slot) {
        if (!profile?.ready) return 0;
        const nPos = normalizedPos(pos);
        const overall = Number(profile.posShare?.[nPos] || 0);
        const r1 = Number(profile.r1Share?.[nPos] || 0);
        if (Number(slot?.round || 1) === 1 && profile.r1Total >= 8) return r1 * 0.72 + overall * 0.28;
        return overall;
    }

    function createPickedCounts() {
        return { pos: {}, idp: 0, total: 0 };
    }

    function registerPicked(counts, pos) {
        const nPos = normalizedPos(pos);
        counts.total += 1;
        counts.pos[nPos] = (counts.pos[nPos] || 0) + 1;
        if (isIdpPos(nPos)) counts.idp += 1;
    }

    function historyPaceScore(player, slot, tuning, context) {
        const profile = context?.profile;
        const picked = context?.pickedCounts || createPickedCounts();
        if (!profile?.ready) return { score: 0, code: null, detail: null };
        const pos = normalizedPos(player?.pos);
        const overall = Math.max(1, Number(slot?.overall || picked.total + 1 || 1));
        const beforeTotal = Math.max(0, Number(picked.total || overall - 1));
        const afterTotal = beforeTotal + 1;
        const round = Number(slot?.round || 1);
        const ownerWeight = clamp(tuning?.ownerDna, 0, 100, 50) / 100;
        const historyHeavy = ownerWeight >= 0.9;
        let score = 0;
        let code = null;
        let detail = null;

        const expectedIdp = expectedIdpShare(profile, slot);
        if (expectedIdp || profile.aggregateIdpShare) {
            if (isIdpPos(pos)) {
                const afterIdpShare = (Number(picked.idp || 0) + 1) / Math.max(1, afterTotal);
                const tolerance = historyHeavy ? (round <= 2 ? 0.018 : 0.055) : (round <= 2 ? 0.04 : 0.085);
                const over = afterIdpShare - expectedIdp - tolerance;
                if (over > 0) {
                    score -= Math.round(over * (historyHeavy ? 115000 : (30000 + ownerWeight * 30000)));
                    code = 'history_pace_penalty';
                    detail = 'IDP pace above league history';
                } else if (expectedIdp - afterIdpShare > 0.035) {
                    score += Math.round(Math.min(0.16, expectedIdp - afterIdpShare) * (historyHeavy ? 1100 : 2200));
                    code = 'history_pace';
                    detail = 'IDP pace still below league history';
                }
            } else if (beforeTotal >= 4) {
                const currentIdpShare = Number(picked.idp || 0) / Math.max(1, beforeTotal);
                const excess = currentIdpShare - expectedIdp - (round <= 2 ? 0.04 : 0.07);
                if (excess > 0) {
                    score += Math.round(Math.min(0.28, excess) * 2600);
                    code = 'history_pace';
                    detail = 'corrects an overextended IDP run';
                }
            }
        }

        if (afterTotal >= 8) {
            const expectedPos = expectedPositionShare(profile, pos, slot);
            if (expectedPos > 0.015) {
                const afterPosShare = (Number(picked.pos?.[pos] || 0) + 1) / Math.max(1, afterTotal);
                const over = afterPosShare - expectedPos - (historyHeavy ? 0.055 : 0.10);
                if (over > 0) {
                    score -= Math.round(over * (historyHeavy ? 18500 : 6000));
                    if (!code) {
                        code = 'history_pace_penalty';
                        detail = pos + ' pace above league history';
                    }
                } else if (expectedPos - afterPosShare > (historyHeavy ? 0.12 : 0.08)) {
                    score += Math.round(Math.min(0.12, expectedPos - afterPosShare) * (historyHeavy ? 520 : 900));
                    if (!code) {
                        code = 'history_pace';
                        detail = pos + ' pace under league history';
                    }
                }
            }
        }

        return {
            score,
            code,
            detail,
            expectedIdpShare: expectedIdp,
            idpPickedBefore: Number(picked.idp || 0),
        };
    }

    function draftWindowBonus(player, slot, tuning) {
        const rank = Number(player.analystBoardRank || player.consensusRank || player.rank || 9999);
        const distance = Math.abs(rank - (slot?.overall || rank));
        const tier = Number(player.tier || player.csv?.tier || 0);
        let bonus = Math.max(0, 28 - distance) * tuning.classValue * 1.8;
        if (tier && tier <= 2) bonus += (3 - tier) * 520;
        return bonus;
    }

    function formatAdjustedBase(player, adapter) {
        let value = Number(player.dhq || player.val || 0);
        const id = adapter?.id || adapter?.draftType || '';
        const pos = normalizedPos(player.pos);
        const mult = Number(adapter?.positionMultipliers?.[pos] || 1);
        value *= mult;
        if (id === 'redraft') {
            const age = Number(player.age || player.csv?.age || 0);
            if (age && age >= 29 && ['RB', 'WR', 'TE'].includes(pos)) value *= 0.99;
            if (pos === 'RB') value *= 1.02;
        }
        if (id === 'best_ball') {
            if (['WR', 'TE', 'QB'].includes(pos)) value *= 1.03;
            if (player.tier && Number(player.tier) <= 2) value *= 1.025;
        }
        return value;
    }

    function scoreCandidate(player, slot, persona, tuning, basis, adapter, historyContext) {
        const dhq = formatAdjustedBase(player, adapter);
        const oBias = ownerBiasScore(persona, player.pos);
        const nScore = needScore(persona, player.pos);
        const boardRank = Number(player.analystBoardRank || player.consensusRank || 9999);
        const boardBonus = basis === 'my'
            ? Math.max(0, 120 - boardRank) * tuning.classValue * 48
            : Math.max(0, 72 - boardRank) * tuning.classValue * 0.34;
        const ownerMultiplier = tuning.ownerDna >= 90 ? 0.86 : 0.62;
        const needMultiplier = tuning.ownerDna >= 90 ? 0.36 : 0.48;
        const ownerBonus = oBias * tuning.ownerDna * ownerMultiplier;
        const needBonus = nScore * tuning.needFit * needMultiplier * Number(adapter?.needBias || 1);
        const windowBonus = draftWindowBonus(player, slot, tuning);
        const historyPace = historyPaceScore(player, slot, tuning, historyContext);
        const noise = (hashUnit([slot?.overall, player.pid, basis, tuning.variance].join('|')) - 0.5) * tuning.variance * 78;
        const specialistPenalty = specialistDraftPenalty(player.pos, slot);
        return {
            total: dhq + boardBonus + ownerBonus + needBonus + windowBonus + historyPace.score + noise - specialistPenalty,
            baseDhq: dhq,
            boardRank,
            ownerBias: oBias,
            need: nScore,
            boardBonus,
            ownerBonus,
            needBonus,
            windowBonus,
            historyPace: historyPace.score,
            historyPaceCode: historyPace.code,
            historyPaceDetail: historyPace.detail,
            specialistPenalty,
            noise,
        };
    }

    function driverCodes(player, score, slot, persona, tuning, basis) {
        const drivers = [];
        if (score.boardRank <= Math.max(8, slot.overall + 4) || score.baseDhq >= 0.92 * (slot.topDhq || score.baseDhq)) {
            drivers.push({ code: 'value', label: 'board value' });
        }
        if (score.need >= 60) drivers.push({ code: 'need', label: 'roster fit' });
        if (score.ownerBias >= 30 && tuning.ownerDna >= 50) drivers.push({ code: 'owner_history', label: 'owner history' });
        if (score.historyPace > 120 && tuning.ownerDna >= 50) drivers.push({ code: 'history_pace', label: 'league history pace' });
        if ((player.tier || player.csv?.tier) && Number(player.tier || player.csv?.tier) <= 2) drivers.push({ code: 'tier', label: 'tier pressure' });
        if (basis === 'my') drivers.push({ code: 'user_board', label: 'My Board lens' });
        const adapter = slot.formatAdapter || {};
        if (adapter.id === 'best_ball' && ['WR', 'TE', 'QB'].includes(normalizedPos(player.pos))) drivers.push({ code: 'format_best_ball', label: 'bestball ceiling' });
        if (adapter.id === 'redraft') drivers.push({ code: 'format_redraft', label: 'redraft fit' });
        if (tuning.tradeActivity >= 75 && hashUnit(slot.overall + ':' + slot.rosterId) > 0.58) {
            drivers.push({ code: 'trade_logic', label: 'trade-up watch' });
        }
        return drivers.length ? drivers.slice(0, 4) : [{ code: 'value', label: 'best value left' }];
    }

    function buildNote(slot, player, drivers, alternatives, confidence) {
        const owner = slot.ownerName || ('Team ' + slot.slot);
        const driverText = firstDriverPhrase(drivers);
        const altText = alternatives.length ? ' Could pivot to ' + alternatives.map(p => p.name).join(' or ') + '.' : '';
        const seed = 'amnote:' + slot.overall + ':' + (player.pid || player.name);
        const core = avPick(seed, [
            owner + ' goes ' + player.name + ' (' + player.pos + ') here — ' + driverText + '.',
            'I\'ve got ' + owner + ' on ' + player.name + ' (' + player.pos + '), driven by ' + driverText + '.',
            'Look for ' + owner + ' to grab ' + player.name + ' (' + player.pos + ') on ' + driverText + '.',
            owner + ' lands ' + player.name + ' (' + player.pos + ') — ' + driverText + ' makes the call.',
        ]);
        return core + ' (' + confidence + ' confidence.)' + altText;
    }

    function confidenceLabel(score, runnerUp, drivers) {
        const margin = runnerUp ? score.total - runnerUp.total : 1200;
        if (margin > 1300 && drivers.length >= 2) return 'high';
        if (margin > 450 || drivers.length >= 2) return 'medium';
        return 'low';
    }

    function posLabels(items, limit) {
        return (Array.isArray(items) ? items : [])
            .map(item => normalizedPos(typeof item === 'string' ? item : item?.pos))
            .filter(Boolean)
            .filter(pos => pos !== '?')
            .filter((pos, idx, arr) => arr.indexOf(pos) === idx)
            .slice(0, limit || 3);
    }

    function driverHas(drivers, code) {
        return (drivers || []).some(d => d.code === code);
    }

    function firstDriverPhrase(drivers) {
        const labels = (drivers || []).map(d => d.label).filter(Boolean);
        if (!labels.length) return 'best value left';
        if (labels.length === 1) return labels[0];
        return labels.slice(0, -1).join(', ') + ', and ' + labels[labels.length - 1];
    }

    function boardWindowPhrase(player, slot) {
        const rank = Number(player.analystBoardRank || player.consensusRank || 0);
        if (!rank) return 'keeps the pick on value';
        if (rank <= slot.overall - 8) return 'turns into a clear value pocket';
        if (rank >= slot.overall + 10) return 'is a deliberate reach versus the board';
        return 'fits the board window';
    }

    function buildAlexCommentary(slot, player, drivers, alternatives, confidence, persona, score, state, tuning, basis) {
        const team = slot.ownerName || persona?.teamName || ('Team ' + slot.slot);
        const pos = normalizedPos(player.pos);
        const needs = posLabels(persona?.assessment?.needs, 4);
        const strengths = posLabels(persona?.assessment?.strengths, 3);
        const hitsNeed = needs.includes(pos);
        const leansStrength = strengths.includes(pos);
        const posture = persona?.posture?.label || persona?.assessment?.tier || 'neutral';
        const draftLabel = persona?.draftDna?.label || 'balanced';
        const tradeLabel = persona?.tradeDna?.label || '';
        const ownerIntel = persona?.ownerIntel || {};
        const topReason = (ownerIntel.reasonCodes || []).find(r => r.detail);
        const confidenceText = ownerIntel.confidence?.overall || (persona?.draftDna?.inferred ? 'inferred' : 'medium');
        const altText = alternatives?.length
            ? alternatives.slice(0, 2).map(p => p.name + ' (' + p.pos + ')').join(' or ')
            : '';
        const isUser = idKey(slot.rosterId) === idKey(state?.userRosterId) || (!slot.rosterId && Number(slot.slot) === Number(state?.userSlot));
        const seed = 'amc:' + slot.overall + ':' + (player.pid || player.name);

        let teamImpact;
        if (hitsNeed) {
            teamImpact = avPick(seed + ':ti', [
                team + ' is spending this pick to patch a real ' + pos + ' hole rather than just taking the best name left.',
                'This is ' + team + ' fixing a ' + pos + ' problem — need over pure BPA.',
                team + ' had ' + pos + ' circled, and they\'re solving it here.',
            ]);
        } else if (leansStrength) {
            teamImpact = avPick(seed + ':ti', [
                team + ' is doubling down on a strength — usually a sign they\'re chasing a weekly edge, not filling holes.',
                'Interesting — ' + team + ' is stacking ' + pos + ' where they\'re already strong. That\'s an edge play.',
                team + ' leans into a position of strength here instead of patching elsewhere.',
            ]);
        } else if (driverHas(drivers, 'tier')) {
            teamImpact = avPick(seed + ':ti', [
                team + ' is grabbing the tier before the room forces a drop-off.',
                'This is ' + team + ' protecting access to the ' + pos + ' tier before it cliffs.',
                team + ' jumps the tier here — get in before the value\'s gone.',
            ]);
        } else {
            teamImpact = avPick(seed + ':ti', [
                team + ' keeps the build flexible and takes the cleanest value on the board.',
                'No drama — ' + team + ' just takes the best value profile available.',
                team + ' stays flexible and lets the board come to them.',
            ]);
        }

        let ownerFit;
        if (driverHas(drivers, 'owner_history')) {
            const lead = avPick(seed + ':of', [
                'Right in line with the ' + draftLabel + ' owner profile',
                'Classic ' + draftLabel + ' move for this owner',
                'This is the ' + draftLabel + ' tendency showing up',
            ]);
            ownerFit = lead + (topReason?.detail ? ': ' + topReason.detail : ', given the historical lean toward ' + pos + '.');
            if (!topReason?.detail && !/\.$/.test(ownerFit)) ownerFit += '.';
        } else if (driverHas(drivers, 'history_pace')) {
            ownerFit = avPick(seed + ':of', [
                'I\'m letting the league\'s historical pace steer this so the projection doesn\'t invent a run the room has never actually shown.',
                'This leans on how this league has actually drafted, not a manufactured position run.',
            ]);
        } else if (driverHas(drivers, 'need')) {
            ownerFit = avPick(seed + ':of', [
                'More about roster context than owner habit here, with ' + confidenceText + ' confidence in the profile.',
                'This one\'s need-driven more than personality — ' + confidenceText + ' read on the owner profile.',
            ]);
        } else if (basis === 'my') {
            ownerFit = avPick(seed + ':of', [
                'Through your board, this is a name your prep already had elevated.',
                'Your own board had this guy up, so it lines up with how you see it.',
            ]);
        } else {
            ownerFit = avPick(seed + ':of', [
                'Owner history isn\'t the driver here — board value and room shape are doing the work.',
                'This is less about tendencies and more about where the value sits.',
            ]);
        }

        let roomImpact;
        if (isUser) {
            roomImpact = avPick(seed + ':ri', [
                'For our build, this is the anchor pick the rest of the mock grades against.',
                'This is our pick — everything else in the mock keys off it.',
            ]);
        } else if (slot.overall < Number(state?.userNextPickOverall || Infinity)) {
            roomImpact = avPick(seed + ':ri', [
                'For us, that\'s one fewer clean ' + pos + ' before our next pick — the tier just got tighter.',
                'Watch the impact on us: a ' + pos + ' option comes off before we\'re up.',
            ]);
        } else if (driverHas(drivers, 'trade_logic') || tuning.tradeActivity >= 75) {
            roomImpact = avPick(seed + ':ri', [
                'This is the kind of tier chase that can pull trade offers into the room.',
                'A move like this tends to spark trade pressure around the board.',
            ]);
        } else {
            roomImpact = avPick(seed + ':ri', [
                'It nudges the room toward ' + pos + ' and reshapes which alternatives survive to later picks.',
                'Expect the room to tilt toward ' + pos + ' after this one.',
            ]);
        }

        const boardRead = avPick(seed + ':br', [
            player.name + ' at #' + slot.overall + ' ' + boardWindowPhrase(player, slot) + ' (' + confidence + ' confidence).',
            'At #' + slot.overall + ', ' + player.name + ' ' + boardWindowPhrase(player, slot) + ' — ' + confidence + ' confidence.',
        ]);
        const fallbackAlt = altText
            ? avPick(seed + ':pv', ['I had ' + altText + ' as the pivot path.', 'If not, ' + altText + ' was the fallback.'])
            : avPick(seed + ':pv', ['No cleaner pivot in the immediate pocket.', 'Nothing better to pivot to right here.']);
        const summary = teamImpact + ' ' + ownerFit + ' ' + roomImpact;
        return {
            headline: avPick(seed + ':hl', [
                'Alex: ' + team + ' takes ' + player.name + ' as a ' + pos + ' signal.',
                'Alex read — ' + team + ' grabs ' + player.name + ' (' + pos + ').',
                'Alex: watch ' + team + ' land ' + player.name + ' at ' + pos + '.',
            ]),
            teamImpact,
            ownerFit,
            boardRead,
            roomImpact,
            pivot: fallbackAlt,
            summary,
            streamText: summary,
            confidence,
            tags: drivers.map(d => d.code),
            meta: {
                posture,
                draftDna: draftLabel,
                tradeDna: tradeLabel,
                ownerIntelConfidence: confidenceText,
                needHit: hitsNeed,
                strengthStack: leansStrength,
                boardBasis: basis,
                score: Math.round(score?.total || 0),
            },
        };
    }

    function groupCounts(items, mapFn) {
        const out = {};
        (Array.isArray(items) ? items : []).forEach(item => {
            const key = mapFn ? mapFn(item) : item;
            if (!key) return;
            out[key] = (out[key] || 0) + 1;
        });
        return out;
    }

    function topCounts(counts, limit) {
        return Object.entries(counts || {})
            .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
            .slice(0, limit || 3)
            .map(([key, count]) => ({ key, count }));
    }

    function valueDelta(pick) {
        if (!pick?.consensusRank) return 0;
        return Number(pick.overall || 0) - Number(pick.consensusRank || 0);
    }

    function isUserPick(pick, state) {
        if (!pick) return false;
        return idKey(pick.rosterId) === idKey(state?.userRosterId)
            || (!pick.rosterId && Number(pick.slot) === Number(state?.userSlot));
    }

    function buildTeamSummaries(picks) {
        const byTeam = new Map();
        (picks || []).forEach(p => {
            const key = idKey(p.rosterId) || p.ownerName || ('slot_' + p.slot);
            if (!byTeam.has(key)) {
                byTeam.set(key, {
                    rosterId: p.rosterId || null,
                    ownerName: p.ownerName || ('Team ' + p.slot),
                    picks: 0,
                    totalDhq: 0,
                    valueScore: 0,
                    needHits: 0,
                    ownerHistory: 0,
                    tradeSignals: 0,
                    highConfidence: 0,
                    positions: {},
                    firstPick: null,
                    topPick: null,
                });
            }
            const row = byTeam.get(key);
            row.picks += 1;
            row.totalDhq += Number(p.dhq || 0);
            row.valueScore += valueDelta(p);
            if (p.alexCommentary?.meta?.needHit) row.needHits += 1;
            if ((p.drivers || []).some(d => d.code === 'owner_history')) row.ownerHistory += 1;
            if ((p.drivers || []).some(d => d.code === 'trade_logic')) row.tradeSignals += 1;
            if (p.confidence === 'high') row.highConfidence += 1;
            const pos = normalizedPos(p.pos);
            row.positions[pos] = (row.positions[pos] || 0) + 1;
            if (!row.firstPick || Number(p.overall) < Number(row.firstPick.overall)) row.firstPick = p;
            if (!row.topPick || Number(p.dhq || 0) > Number(row.topPick.dhq || 0)) row.topPick = p;
        });
        return Array.from(byTeam.values())
            .map(row => ({
                ...row,
                totalDhq: Math.round(row.totalDhq),
                valueScore: Math.round(row.valueScore),
                primaryPosition: topCounts(row.positions, 1)[0]?.key || '?',
            }))
            .sort((a, b) => b.totalDhq - a.totalDhq || b.valueScore - a.valueScore);
    }

    function buildRoundSummaries(picks, reaches, steals) {
        const byRound = new Map();
        (picks || []).forEach(p => {
            const round = Number(p.round || 0);
            if (!byRound.has(round)) {
                byRound.set(round, {
                    round,
                    picks: 0,
                    positions: {},
                    topPick: null,
                    reaches: 0,
                    steals: 0,
                    tradeSignals: 0,
                });
            }
            const row = byRound.get(round);
            row.picks += 1;
            const pos = normalizedPos(p.pos);
            row.positions[pos] = (row.positions[pos] || 0) + 1;
            if (!row.topPick || Number(p.dhq || 0) > Number(row.topPick.dhq || 0)) row.topPick = p;
            if ((p.drivers || []).some(d => d.code === 'trade_logic')) row.tradeSignals += 1;
        });
        const reachSet = new Set((reaches || []).map(p => Number(p.overall)));
        const stealSet = new Set((steals || []).map(p => Number(p.overall)));
        byRound.forEach(row => {
            row.reaches = (picks || []).filter(p => Number(p.round) === row.round && reachSet.has(Number(p.overall))).length;
            row.steals = (picks || []).filter(p => Number(p.round) === row.round && stealSet.has(Number(p.overall))).length;
            row.positionLeaders = topCounts(row.positions, 3);
        });
        return Array.from(byRound.values()).sort((a, b) => a.round - b.round);
    }

    function buildReportBrief(picks, state, reaches, steals, tradeSignals) {
        const allPicks = Array.isArray(picks) ? picks : [];
        const firstUser = allPicks.find(p => isUserPick(p, state));
        const beforeUser = firstUser ? allPicks.filter(p => Number(p.overall) < Number(firstUser.overall)) : allPicks.slice(0, Math.min(12, allPicks.length));
        const beforeUserPositions = topCounts(groupCounts(beforeUser, p => normalizedPos(p.pos)), 4);
        const userPicks = allPicks.filter(p => isUserPick(p, state));
        const teamSummaries = buildTeamSummaries(allPicks);
        const valueTeams = teamSummaries.slice().sort((a, b) => b.valueScore - a.valueScore).slice(0, 5);
        const pressureText = beforeUserPositions.length
            ? beforeUserPositions.map(p => p.key + ' x' + p.count).join(', ')
            : 'No pre-user pressure yet';
        const userPath = userPicks.length
            ? userPicks.slice(0, 4).map(p => p.round + '.' + String(p.pickInRound || p.slot).padStart(2, '0') + ' ' + p.name).join(' / ')
            : 'No user picks inside this projection window';
        const topTeam = teamSummaries[0] || null;
        return {
            headline: firstUser
                ? 'Projection burns ' + beforeUser.length + ' picks before your first turn; pressure is ' + pressureText + '.'
                : 'Projection covers ' + allPicks.length + ' picks with no user slot inside the window.',
            userPath,
            positionPressure: beforeUserPositions,
            teamSummaries,
            valueTeams,
            roundSummaries: buildRoundSummaries(allPicks, reaches, steals),
            winners: teamSummaries.slice(0, 5),
            watchItems: [
                { label: 'Reaches', count: (reaches || []).length, picks: (reaches || []).slice(0, 5) },
                { label: 'Steals', count: (steals || []).length, picks: (steals || []).slice(0, 5) },
                { label: 'Trade Signals', count: (tradeSignals || []).length, picks: (tradeSignals || []).slice(0, 5) },
            ],
            topTeam: topTeam ? {
                ownerName: topTeam.ownerName,
                totalDhq: topTeam.totalDhq,
                primaryPosition: topTeam.primaryPosition,
                topPick: topTeam.topPick,
            } : null,
        };
    }

    function valuePhrase(pick) {
        const delta = valueDelta(pick);
        if (delta >= 8) return '+' + delta + ' slots vs board';
        if (delta <= -8) return Math.abs(delta) + ' pick reach';
        return 'fair value';
    }

    function formatAlexSlackBrief(report, state = {}, opts = {}) {
        const picks = Array.isArray(report?.picks) ? report.picks : [];
        const limit = opts.maxLines === 'all'
            ? picks.length
            : clamp(opts.maxLines, 1, 500, Math.min(16, picks.length || 1));
        const shown = picks.slice(0, limit);
        // commentaryFor: 'user+r1' emits per-pick commentary only for the user's
        // picks + round-1 picks ('' otherwise — the data row still renders).
        // Absent/any other value keeps commentary on every pick. Full pick reads
        // always live in Mock Draft Center's expander regardless of this option.
        const commentaryFor = opts.commentaryFor;
        const userPicks = picks.filter(p => isUserPick(p, state));
        const pressure = report?.summary?.reportBrief?.positionPressure || [];
        const pressureText = pressure.length
            ? pressure.map(p => p.key + ' x' + p.count).join(', ')
            : 'no clear position run';
        const roundCount = report?.assumptions?.rounds || 0;
        const roundLabel = roundCount ? roundCount + ' round' + (Number(roundCount) === 1 ? '' : 's') : 'projection';
        const userPath = userPicks.length
            ? userPicks.slice(0, 4).map(p => p.round + '.' + String(p.pickInRound || p.slot).padStart(2, '0') + ' ' + p.name).join(' / ')
            : 'No user pick inside this window.';

        return {
            author: 'Alex Ingram',
            headline: (report?.label || 'League History') + ' projected mock - ' + roundLabel,
            intro: avPick('amintro:' + (report?.label || '') + ':' + pressureText, [
                'I ran this like a pre-draft analyst note — owner DNA, league draft history, roster needs, and the live board all factored in. The main pressure ahead of your path is ' + pressureText + '.',
                'Treat this like my scouting note before the draft: I weighed owner tendencies, this league\'s history, your needs, and the board. What to watch before you\'re up: ' + pressureText + '.',
                'This is my projected read, not a guarantee — owner DNA, draft history, needs, and board value all in the mix. Biggest pressure before your pick: ' + pressureText + '.',
            ]),
            userPath,
            pickLines: shown.map(pick => {
                const drivers = firstDriverPhrase(pick.drivers);
                const dhq = Math.round(Number(pick.dhq || 0)).toLocaleString();
                const commentary = pick.alexCommentary?.roomImpact || pick.alexCommentary?.teamImpact || pick.note || '';
                const team = pick.ownerName || ('Team ' + pick.slot);
                const isUser = isUserPick(pick, state);
                const wantsCommentary = commentaryFor !== 'user+r1' || isUser || Number(pick.round) === 1;
                return {
                    overall: pick.overall,
                    pickLabel: pick.round + '.' + String(pick.pickInRound || pick.slot).padStart(2, '0'),
                    team,
                    player: pick.name,
                    pos: normalizedPos(pick.pos),
                    value: valuePhrase(pick),
                    dhq,
                    driver: drivers,
                    commentary: wantsCommentary ? stripLeadingTeamName(pick.alexCommentary?.teamImpact || commentary, team) : '',
                    teamImpact: pick.alexCommentary?.teamImpact || '',
                    ownerFit: pick.alexCommentary?.ownerFit || '',
                    nflTeam: pick.nflTeam || pick.team || 'Team TBD',
                    school: pick.school || pick.college || 'School TBD',
                    photoUrl: pick.photoUrl || (pick.pid ? 'https://sleepercdn.com/content/nfl/players/thumb/' + pick.pid + '.jpg' : ''),
                    pid: pick.pid,
                    isUser,
                };
            }),
            footer: shown.length < picks.length
                ? (picks.length - shown.length) + ' more projected picks are available in Mock Draft Center.'
                : 'End of projection.',
        };
    }

    function applyReportFilters(report, filters = {}, state = {}) {
        const picks = Array.isArray(report?.picks) ? report.picks : [];
        const reachSet = new Set((report?.summary?.reaches || []).map(p => Number(p.overall)));
        const stealSet = new Set((report?.summary?.steals || []).map(p => Number(p.overall)));
        const tradeSet = new Set((report?.summary?.tradeSignals || []).map(p => Number(p.overall)));
        const team = filters.team || 'all';
        const round = filters.round || 'all';
        const pos = filters.pos || 'ALL';
        const focus = filters.focus || 'all';
        const query = String(filters.query || '').trim().toLowerCase();
        return picks.filter(p => {
            if (team !== 'all') {
                const key = idKey(p.rosterId) || p.ownerName;
                if (key !== team && p.ownerName !== team) return false;
            }
            if (round !== 'all' && Number(p.round) !== Number(round)) return false;
            if (pos !== 'ALL' && normalizedPos(p.pos) !== pos) return false;
            if (focus === 'my' && !isUserPick(p, state)) return false;
            if (focus === 'reaches' && !reachSet.has(Number(p.overall))) return false;
            if (focus === 'steals' && !stealSet.has(Number(p.overall))) return false;
            if (focus === 'trades' && !tradeSet.has(Number(p.overall))) return false;
            if (focus === 'high' && p.confidence !== 'high') return false;
            if (focus === 'owner_history' && !(p.drivers || []).some(d => d.code === 'owner_history')) return false;
            if (focus === 'need' && !p.alexCommentary?.meta?.needHit && !(p.drivers || []).some(d => d.code === 'need')) return false;
            if (query) {
                const haystack = [
                    p.name,
                    p.pos,
                    p.ownerName,
                    p.note,
                    p.alexCommentary?.summary,
                    ...(p.drivers || []).map(d => d.label || d.code),
                ].filter(Boolean).join(' ').toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        });
    }

    function buildPoolForProjection(state, playersData, maxSize) {
        if (Array.isArray(state?.pool) && state.pool.length) return normalizePoolValues(state.pool.slice());
        if (window.DraftCC?.state?.buildPool) {
            return normalizePoolValues(window.DraftCC.state.buildPool({
                variant: state?.variant || 'startup',
                playersData: playersData || window.S?.players,
                maxSize: maxSize || Math.max(220, (state?.rounds || 5) * (state?.leagueSize || 12) + 80),
            }));
        }
        return [];
    }

    function buildPersonas(leagueId, existing) {
        if (existing && Object.keys(existing).length) return existing;
        let draftDnaMap = {};
        try {
            if (window.DraftHistory?.loadDraftDNA) draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
        } catch (e) {}
        if (window.DraftCC?.persona?.composeAllPersonas) return window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap) || {};
        return {};
    }

    function generateProjectedMock(opts = {}) {
        const state = opts.state || {};
        const preset = presetFor(opts.presetId || opts.preset || 'league-history');
        const tuning = effectiveTuning(state, preset, opts.tuning);
        const basis = opts.basis || preset.basis || 'ai';
        const formatAdapter = window.DraftCC?.context?.getDraftFormatAdapter
            ? window.DraftCC.context.getDraftFormatAdapter({
                state,
                draftType: state.variant || opts.draftType,
                currentLeague: opts.currentLeague,
            })
            : { id: state.variant || 'startup', needBias: 1, positionMultipliers: {} };
        const leagueSize = state.leagueSize || opts.leagueSize || 12;
        const rounds = opts.roundLimit && opts.roundLimit !== 'full'
            ? Math.min(Number(opts.roundLimit), state.rounds || 5)
            : (state.rounds || opts.rounds || 5);
        const maxPicks = rounds * leagueSize;
        const pool = rankPoolByBasis(buildPoolForProjection(state, opts.playersData, maxPicks + 80), state, basis);
        const pickOrder = opts.pickOrder || (window.DraftCC?.state?.buildPickOrder
            ? window.DraftCC.state.buildPickOrder(rounds, leagueSize, state.draftType || 'snake', opts.draftMeta?.slotToRoster || {}, opts.draftMeta?.pickOwnership || {})
            : []);
        const personas = buildPersonas(state.leagueId, state.personas);
        const leagueHistory = buildLeagueHistoryProfile(personas);
        const pickedCounts = createPickedCounts();
        const available = pool.slice();
        const picks = [];
        const driverCounts = {};
        const userRosterId = idKey(state.userRosterId);
        const firstUserSlot = pickOrder.slice(0, maxPicks).find(p => idKey(p.rosterId) === userRosterId || (!p.rosterId && Number(p.slot) === Number(state.userSlot)));
        const stateForCommentary = {
            ...state,
            userNextPickOverall: firstUserSlot?.overall || Infinity,
        };

        pickOrder.slice(0, maxPicks).forEach(slot => {
            if (!available.length) return;
            const persona = personas?.[slot.rosterId] || {};
            const topDhq = available[0]?.dhq || 0;
            const scored = available.slice(0, Math.min(96, available.length)).map(player => {
                const s = scoreCandidate(player, { ...slot, topDhq, formatAdapter }, persona, tuning, basis, formatAdapter, {
                    profile: leagueHistory,
                    pickedCounts,
                });
                return { player, score: s };
            }).sort((a, b) => b.score.total - a.score.total);
            const chosen = scored[0];
            if (!chosen) return;
            const player = chosen.player;
            const alternatives = scored.slice(1, 3).map(s => s.player);
            const drivers = driverCodes(player, chosen.score, { ...slot, topDhq, formatAdapter }, persona, tuning, basis);
            drivers.forEach(d => { driverCounts[d.code] = (driverCounts[d.code] || 0) + 1; });
            const confidence = confidenceLabel(chosen.score, scored[1]?.score, drivers);
            const alexCommentary = buildAlexCommentary({ ...slot, topDhq }, player, drivers, alternatives, confidence, persona, chosen.score, stateForCommentary, tuning, basis);
            const idx = available.findIndex(p => idKey(p.pid) === idKey(player.pid));
            if (idx >= 0) available.splice(idx, 1);
            registerPicked(pickedCounts, player.pos);
            picks.push({
                round: slot.round,
                slot: slot.slot,
                pickInRound: slot.pickInRound || slot.slot,
                overall: slot.overall,
                teamIdx: slot.teamIdx,
                rosterId: slot.rosterId || null,
                ownerName: slot.ownerName || ('Team ' + slot.slot),
                pid: player.pid,
                csvPid: player.csvPid || null,
                name: player.name,
                pos: player.pos,
                nflTeam: player.nflTeam || player.team || player.csv?.nflTeam || player.p?.team || null,
                school: player.school || player.college || player.csv?.college || player.p?.college || player.p?.metadata?.college || null,
                photoUrl: player.photoUrl || (player.pid ? 'https://sleepercdn.com/content/nfl/players/thumb/' + player.pid + '.jpg' : null),
                dhq: Number(player.dhq || 0),
                consensusRank: player.consensusRank || player.analystBoardRank || null,
                analystBoardRank: player.analystBoardRank || null,
                tier: player.tier || player.csv?.tier || null,
                confidence,
                drivers,
                alternatives: alternatives.map(p => ({ pid: p.pid, name: p.name, pos: p.pos, dhq: p.dhq })),
                note: buildNote(slot, player, drivers, alternatives, confidence),
                alexCommentary,
                reasoning: {
                    primary: drivers[0]?.label || 'projection',
                    baseVal: Number(player.dhq || 0),
                    score: Math.round(chosen.score.total),
                    historyPace: Math.round(chosen.score.historyPace || 0),
                    historyPaceDetail: chosen.score.historyPaceDetail || null,
                    drivers,
                    nudges: drivers.map(d => d.label),
                    analystProjection: true,
                    alexCommentary,
                },
            });
        });

        const userPicks = picks.filter(p => idKey(p.rosterId) === userRosterId || (!p.rosterId && Number(p.slot) === Number(state.userSlot)));
        // Grade the watch lists on the SAME board (and thresholds) the per-pick
        // commentary uses (boardWindowPhrase: analystBoardRank first), so a pick
        // can't sit in Reaches while its own blurb says it fits the board window.
        const watchRankOf = p => Number(p.analystBoardRank || p.consensusRank || 0);
        const reaches = picks.filter(p => watchRankOf(p) && watchRankOf(p) >= p.overall + 10).slice(0, 8);
        const steals = picks.filter(p => watchRankOf(p) && watchRankOf(p) <= p.overall - 8).slice(0, 8);
        const tradeSignals = picks.filter(p => p.drivers.some(d => d.code === 'trade_logic')).slice(0, 10);

        const reportBrief = buildReportBrief(picks, state, reaches, steals, tradeSignals);

        return {
            id: 'analyst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            schemaVersion: 'draft-analyst-mock-v2',
            generatedAt: new Date().toISOString(),
            presetId: preset.id,
            label: preset.label,
            basis,
            assumptions: {
                preset: preset.label,
                description: preset.desc,
                rounds,
                leagueSize,
                draftType: state.draftType || 'snake',
                boardBasis: basis,
                tuning,
                formatAdapter,
                historicalPace: {
                    ready: leagueHistory.ready,
                    samplePicks: leagueHistory.samplePicks,
                    earlyIdpShare: leagueHistory.earlyIdpShare,
                    overallIdpShare: leagueHistory.overallIdpShare,
                    r1Total: leagueHistory.r1Total,
                },
            },
            picks,
            summary: {
                totalPicks: picks.length,
                userPicks,
                reaches,
                steals,
                tradeSignals,
                driverCounts,
                reportBrief,
            },
        };
    }

    function applyProjectedScenario(state, pool, pickOrder, report) {
        if (!report?.picks?.length) return null;
        const userRosterId = idKey(state?.userRosterId);
        const firstUser = report.picks.find(p => idKey(p.rosterId) === userRosterId || (!p.rosterId && Number(p.slot) === Number(state.userSlot)));
        const cutoff = firstUser?.overall || 1;
        const prePicks = report.picks
            .filter(p => p.overall < cutoff)
            .map(p => ({
                round: p.round,
                slot: p.slot,
                pickInRound: p.pickInRound || p.slot,
                overall: p.overall,
                teamIdx: p.teamIdx,
                rosterId: p.rosterId,
                isUser: false,
                pid: p.pid,
                name: p.name,
                pos: p.pos,
                dhq: p.dhq,
                consensusRank: p.consensusRank,
                tier: p.tier,
                reasoning: p.reasoning,
                confidence: p.confidence,
                note: p.note,
                alexCommentary: p.alexCommentary,
                ts: Date.now(),
            }));
        const staged = new Set(prePicks.map(p => idKey(p.pid)));
        return {
            pool: (pool || []).filter(p => !staged.has(idKey(p.pid))),
            pickOrder,
            prePicks,
            narrative: 'ANALYST MOCK SCENARIO - ' + report.label + ' staged ' + prePicks.length + ' projected picks before your first turn.',
        };
    }

    function reportPickMap(report) {
        const map = new Map();
        (report?.picks || []).forEach(p => map.set(Number(p.overall), p));
        return map;
    }

    function compareReports(reports, state = {}) {
        const list = (Array.isArray(reports) ? reports : []).filter(r => r?.picks?.length);
        if (list.length < 2) {
            return {
                schemaVersion: 'draft-analyst-compare-v1',
                ready: false,
                reason: 'Generate at least two analyst mocks to compare.',
            };
        }
        const active = list[0];
        const baseline = list[1];
        const activeMap = reportPickMap(active);
        const baseMap = reportPickMap(baseline);
        const changedPicks = [];
        activeMap.forEach((pick, overall) => {
            const prev = baseMap.get(overall);
            if (!prev) return;
            if (idKey(prev.pid) !== idKey(pick.pid) || idKey(prev.rosterId) !== idKey(pick.rosterId)) {
                changedPicks.push({
                    overall,
                    from: prev.name,
                    to: pick.name,
                    fromPos: prev.pos,
                    toPos: pick.pos,
                    team: pick.ownerName || prev.ownerName,
                });
            }
        });
        const userPicks = active.summary?.userPicks || [];
        const boardEntries = state?.draftContext?.boardContext?.entries || {};
        const targetIds = Object.values(boardEntries)
            .filter(e => e?.target || e?.tag === 'target' || e?.tag === 'must')
            .map(e => idKey(e.pid));
        const targetSet = new Set(targetIds);
        const targetAvailability = userPicks.map(userPick => {
            const before = active.picks.filter(p => Number(p.overall) < Number(userPick.overall));
            const snipedTargets = before.filter(p => targetSet.has(idKey(p.pid)));
            return {
                overall: userPick.overall,
                pick: userPick.name,
                availableTargets: Math.max(0, targetSet.size - snipedTargets.length),
                snipedTargets: snipedTargets.map(p => ({ pid: p.pid, name: p.name, pos: p.pos, overall: p.overall, ownerName: p.ownerName })),
            };
        });
        const gradeTeam = row => {
            const value = Number(row.valueScore || 0);
            const need = Number(row.needHits || 0);
            const history = Number(row.ownerHistory || 0);
            const score = Math.round(Number(row.totalDhq || 0) / Math.max(1, Number(row.picks || 1)) + value * 120 + need * 180 + history * 110);
            const letter = score >= 8500 ? 'A' : score >= 6500 ? 'B' : score >= 4500 ? 'C' : 'D';
            return { rosterId: row.rosterId, ownerName: row.ownerName, letter, score, primaryPosition: row.primaryPosition, totalDhq: row.totalDhq };
        };
        return {
            schemaVersion: 'draft-analyst-compare-v1',
            ready: true,
            activeId: active.id,
            baselineId: baseline.id,
            changedPicks,
            changedPickCount: changedPicks.length,
            targetAvailability,
            teamGrades: (active.summary?.reportBrief?.teamSummaries || []).map(gradeTeam),
            summary: {
                active: active.label,
                baseline: baseline.label,
                volatility: changedPicks.length / Math.max(1, active.picks.length),
                targetRisk: targetAvailability.reduce((sum, row) => sum + row.snipedTargets.length, 0),
            },
        };
    }

    // Projected league mocks (persona-driven simulation) are Scout Pro (owner
    // ruling Q10). Gate the two simulation entry points at the engine seam so
    // every caller — draft-room flash mock, scenario handoff, standalone pages —
    // degrades to null (its documented "no report" shape). Fail-open when
    // pro-gate.js isn't loaded. Render surfaces carry their own teasers.
    const _amPro = () => typeof window.wrIsPro !== 'function' || window.wrIsPro();

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.analystMock = {
        PRESETS,
        presetFor,
        effectiveTuning,
        rankPoolByBasis,
        buildReportBrief,
        buildLeagueHistoryProfile,
        formatAlexSlackBrief,
        compareReports,
        applyReportFilters,
        generateProjectedMock: function () { return _amPro() ? generateProjectedMock.apply(null, arguments) : null; },
        applyProjectedScenario: function () { return _amPro() ? applyProjectedScenario.apply(null, arguments) : null; },
    };
})();
