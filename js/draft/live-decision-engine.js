// ================================================================
// js/draft/live-decision-engine.js - P3 live draft decision deck
//
// Builds the "what do I do right now?" layer for live/manual draft
// command mode. Pure functions only; UI lives in command-center.js.
// ================================================================

(function() {
    'use strict';

    const SCHEMA = 'draft-live-decision-v1';
    const TARGET_TAGS = new Set(['target', 'must', 'sleeper']);
    const FADE_TAGS = new Set(['fade', 'avoid']);

    function idKey(value) {
        return value == null ? '' : String(value);
    }

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function num(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function posOf(player) {
        return player?.pos || player?.position || player?.csv?.pos || '';
    }

    function rankMap(order) {
        const out = {};
        asArray(order).forEach((pid, idx) => {
            const key = idKey(pid);
            if (key && out[key] == null) out[key] = idx + 1;
        });
        return out;
    }

    function activeLane(boardContext) {
        const lane = boardContext?.activeLane || 'dhq';
        return boardContext?.lanes?.[lane] ? lane : 'dhq';
    }

    function boardEntry(boardContext, player) {
        return boardContext?.entries?.[idKey(player?.pid)] || {};
    }

    function boardRank(boardContext, player, lane) {
        const entry = boardEntry(boardContext, player);
        if (lane === 'my') return entry.myRank || null;
        if (lane === 'ai') return entry.aiRank || null;
        return entry.dhqRank || player?.consensusRank || null;
    }

    function isTarget(entry) {
        return !!entry?.target || TARGET_TAGS.has(entry?.tag);
    }

    function isFade(entry) {
        return !!entry?.fade || FADE_TAGS.has(entry?.tag);
    }

    function ageOf(player) {
        const direct = num(player?.age || player?.csv?.age, 0);
        if (direct) return direct;
        const bd = player?.birth_date || player?.birthDate;
        if (!bd) return 0;
        const ms = Date.now() - new Date(bd).getTime();
        return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 31557600000) : 0;
    }

    function projectedValue(player, years) {
        const dhq = num(player?.dhq || player?.val, 0);
        if (!dhq) return 0;
        const project = window.App?.PlayerValue?.projectPlayerValue;
        const age = ageOf(player);
        if (typeof project !== 'function' || !age) return dhq;
        try {
            return num(project(player.pid, dhq, age, posOf(player), years), dhq);
        } catch (_) {
            return dhq;
        }
    }

    function nextUserPick(state) {
        const userRosterId = idKey(state?.userRosterId);
        const userSlot = num(state?.userSlot, 0);
        const currentIdx = num(state?.currentIdx, 0);
        const order = asArray(state?.pickOrder);
        for (let idx = currentIdx; idx < order.length; idx++) {
            const slot = order[idx];
            const byRoster = userRosterId && idKey(slot?.rosterId) === userRosterId;
            const bySlot = state?.mode !== 'live-sync' && userSlot && num(slot?.slot, 0) === userSlot;
            if (byRoster || bySlot) {
                return { slot, index: idx, picksAway: Math.max(0, idx - currentIdx) };
            }
        }
        return null;
    }

    function currentPersona(state) {
        const slot = asArray(state?.pickOrder)[num(state?.currentIdx, 0)] || null;
        if (!slot) return null;
        return state?.personas?.[slot.rosterId] || state?.personas?.[String(slot.rosterId)] || null;
    }

    function userNeedMap(state) {
        const userPersona = state?.personas?.[state?.userRosterId] || state?.personas?.[String(state?.userRosterId)] || null;
        const intel = userPersona?.ownerIntel || state?.draftContext?.ownerContext?.[String(state?.userRosterId)] || {};
        const needs = asArray(userPersona?.assessment?.needs || intel?.roster?.needs || state?.draftContext?.teamContext?.needs);
        const out = {};
        needs.forEach((need, idx) => {
            const pos = typeof need === 'string' ? need : need?.pos;
            if (!pos) return;
            const urgent = /critical|deficit|thin|priority/i.test(String(need?.urgency || need?.label || ''));
            out[pos] = Math.max(out[pos] || 0, urgent ? 22 : 14 - Math.min(idx, 4));
        });
        return out;
    }

    // GM Strategy terms for the live score — resolved once per candidates()
    // pass, so the Recommended/Safe/Upside cards obey the strategy on the
    // DEFAULT (dhq) board lane, not just the AI lane. Guarded: gm-mode.js is
    // optional; returns null (score unchanged) until a strategy is saved.
    function gmScoreContext(state) {
        try {
            if (typeof window.WR?.GmMode?.effects !== 'function') return null;
            const fx = window.WR.GmMode.effects(state?.leagueId || window.S?.currentLeagueId);
            if (!fx || !fx.hasStrategy) return null;
            return {
                // Same draftStyle → needBias mapping as the AI board lane.
                needBias: (fx.draftStyle === 'positional_need' || fx.draftStyle === 'need') ? 1.35
                    : fx.draftStyle === 'bpa' ? 0.8
                    : num(fx.draftWeights?.needBias, 1) || 1,
                youthPremium: num(fx.draftWeights?.youthPremium, 1) || 1,
                targets: fx.targetPositions instanceof Set ? fx.targetPositions : new Set(),
                fades: fx.sellPositions instanceof Set ? fx.sellPositions : new Set(),
            };
        } catch (_) { return null; }
    }

    function decorateCandidate(state, player, idx, lane, rankLookup, needs, gm) {
        const boardContext = state?.draftContext?.boardContext || {};
        const entry = boardEntry(boardContext, player);
        const rank = boardRank(boardContext, player, lane) || rankLookup[idKey(player?.pid)] || idx + 1;
        const dhq = num(player?.dhq || player?.val, 0);
        const y5 = projectedValue(player, 5);
        const growth = y5 - dhq;
        const tagTarget = isTarget(entry);
        const tagFade = isFade(entry);
        const tier = entry.tier || player?.tier || player?.csv?.tier || null;
        // userNeedMap depends only on state, not the player — built once by candidates()
        // and passed in (was rebuilt for every one of the ~300-440 pool candidates).
        const needMap = needs || userNeedMap(state);
        const needBoost = (needMap[posOf(player)] || 0) * (gm ? gm.needBias : 1);
        // GM Strategy steers (0 when no strategy): mild target/fade position
        // shifts plus a youth tilt — rebuild boosts age-24-and-under skill
        // players, win-now fades them (youthPremium 1.2 / 0.6 per preset).
        const age = ageOf(player);
        const gmPosBoost = gm ? (gm.targets.has(posOf(player)) ? 6 : 0) - (gm.fades.has(posOf(player)) ? 6 : 0) : 0;
        const gmYouthBoost = (gm && age && age <= 24 && ['QB', 'RB', 'WR', 'TE'].includes(posOf(player)))
            ? Math.max(-12, Math.min(12, (gm.youthPremium - 1) * 30))
            : 0;
        const score = dhq / 100
            + needBoost
            + gmPosBoost
            + gmYouthBoost
            + (tagTarget ? 24 : 0)
            - (tagFade ? 42 : 0)
            + Math.max(-12, Math.min(18, growth / 180))
            - Math.max(0, rank - 1) * 0.45
            - (tier ? Math.max(0, tier - 1) * 2 : 0);
        return {
            player,
            entry,
            rank,
            dhq,
            y5,
            growth,
            tier,
            target: tagTarget,
            fade: tagFade,
            needBoost,
            score,
        };
    }

    function candidates(state, limit = 36) {
        const boardContext = state?.draftContext?.boardContext || {};
        const lane = activeLane(boardContext);
        const rankLookup = rankMap(boardContext?.lanes?.[lane]?.order || []);
        const needs = userNeedMap(state);
        const gm = gmScoreContext(state);
        const ldCopies = Math.max(1, Number(state?.playerCopies) || 1);
        return asArray(state?.pool)
            .filter(p => p?.pid && (state?.draftedPids?.[p.pid] || 0) < ldCopies)
            .map((p, idx) => decorateCandidate(state, p, idx, lane, rankLookup, needs, gm))
            .sort((a, b) => (a.rank - b.rank) || (b.dhq - a.dhq))
            .slice(0, limit);
    }

    function card(kind, label, candidate, detail, tone = 'gold', extra = {}) {
        if (!candidate?.player) return null;
        return {
            kind,
            label,
            tone,
            player: {
                pid: candidate.player.pid,
                name: candidate.player.name || candidate.player.full_name || candidate.player.pid,
                pos: posOf(candidate.player),
                dhq: candidate.dhq,
                y5: candidate.y5,
                tier: candidate.tier,
                rank: candidate.rank,
                tag: candidate.entry?.tag || null,
            },
            detail,
            drivers: extra.drivers || [],
            action: extra.action || 'player',
            meta: extra.meta || {},
        };
    }

    function pickCards(state, tradeWindow) {
        const rows = candidates(state, 40);
        const clean = rows.filter(c => !c.fade);
        const recommended = clean.slice().sort((a, b) => b.score - a.score)[0] || rows[0];
        const safe = clean.slice().sort((a, b) => {
            const stabilityA = a.dhq + (a.tier ? (8 - Math.min(8, a.tier)) * 90 : 0) + Math.min(0, a.growth);
            const stabilityB = b.dhq + (b.tier ? (8 - Math.min(8, b.tier)) * 90 : 0) + Math.min(0, b.growth);
            return stabilityB - stabilityA;
        })[0] || recommended;
        const upside = clean.slice().sort((a, b) => {
            const upA = a.growth + (a.target ? 450 : 0) + (ageOf(a.player) && ageOf(a.player) <= 24 ? 200 : 0);
            const upB = b.growth + (b.target ? 450 : 0) + (ageOf(b.player) && ageOf(b.player) <= 24 ? 200 : 0);
            return upB - upA;
        })[0] || recommended;
        const cards = [
            card('recommended', 'Recommended', recommended, 'Best blend of board value, roster fit, and five-year value.', 'gold', {
                drivers: ['board_rank', recommended?.needBoost ? 'roster_need' : 'value', recommended?.target ? 'user_target' : 'projection'],
            }),
            card('safe', 'Safe Pick', safe, 'High-floor value that keeps the room honest.', 'green', {
                drivers: ['dhq_value', safe?.tier ? 'tier' : 'board_rank'],
            }),
            card('upside', 'Upside Swing', upside, upside?.growth > 0 ? 'Best five-year value gain in the current pocket.' : 'Best ceiling profile in this pocket.', 'purple', {
                drivers: ['y5_projection', upside?.target ? 'user_target' : 'age_curve'],
            }),
        ].filter(Boolean);

        // Avoid Warning: surface the most tempting (highest-score) player the user has
        // tagged fade / do-not-draft, drawn from the UNFILTERED rows.
        const faded = rows.filter(c => c.fade).sort((a, b) => b.score - a.score)[0];
        const avoidCard = faded ? card('avoid', 'Avoid Warning', faded, 'User-board fade or do-not-draft flag is active.', 'red', { drivers: ['user_board'] }) : null;
        if (avoidCard) cards.push(avoidCard);

        if (tradeWindow) {
            cards.push({
                kind: 'trade_down',
                label: 'Trade Window',
                tone: tradeWindow.likelihood >= tradeWindow.acceptanceLine ? 'green' : 'amber',
                player: null,
                detail: tradeWindow.likelihood >= tradeWindow.acceptanceLine
                    ? `${tradeWindow.teamName || 'Owner'} · likely to deal (${tradeWindow.likelihood || 0}% to accept)`
                    : `${tradeWindow.teamName || 'Owner'} · unlikely to deal (${tradeWindow.likelihood || 0}% to accept)`,
                drivers: ['owner_trade_intel', 'board_tier', 'buyer_line'],
                action: 'trade',
                meta: { rosterId: tradeWindow.rosterId, tradeWindow },
            });
        }

        return cards.slice(0, 5);
    }

    function tierAlert(rows) {
        const first = rows.find(c => c.tier);
        if (!first) return null;
        const sameTier = rows.filter(c => String(c.tier) === String(first.tier));
        if (sameTier.length > 3) return null;
        return {
            type: 'tier_cliff',
            tone: sameTier.length <= 1 ? 'red' : 'amber',
            title: `Tier ${first.tier} cliff`,
            text: `${sameTier.length} player${sameTier.length === 1 ? '' : 's'} left in the top tier of this pocket.`,
        };
    }

    function targetSurvivalAlert(state, rows) {
        const next = nextUserPick(state);
        if (!next || next.picksAway <= 0) return null;
        const target = rows.find(c => c.target);
        if (!target) return null;
        if (target.rank > next.picksAway + 2) return null;
        return {
            type: 'target_survival',
            tone: 'red',
            title: 'Target at risk',
            text: `${target.player.name || 'Your target'} is unlikely to survive ${next.picksAway} pick${next.picksAway === 1 ? '' : 's'} to your next turn.`,
            player: target.player,
        };
    }

    function ownerAlert(state) {
        const persona = currentPersona(state);
        const intel = persona?.ownerIntel || state?.draftContext?.ownerContext?.[String(persona?.rosterId || '')] || null;
        const reason = asArray(intel?.reasonCodes)[0];
        if (!persona || !reason) return null;
        return {
            type: 'owner_tendency',
            tone: intel?.confidence?.overall === 'high' ? 'green' : 'amber',
            title: `${persona.teamName || 'On-clock owner'} tell`,
            text: reason.detail || reason.label || 'Historical owner intel is influencing this read.',
        };
    }

    function buildDecisionDeck(state, opts = {}) {
        const rows = candidates(state, 40);
        const next = nextUserPick(state);
        const currentSlot = asArray(state?.pickOrder)[num(state?.currentIdx, 0)] || null;
        const cards = pickCards(state, opts.tradeWindow || null);
        const alerts = [tierAlert(rows), targetSurvivalAlert(state, rows), ownerAlert(state)].filter(Boolean).slice(0, 3);
        return {
            schemaVersion: SCHEMA,
            mode: state?.mode || '',
            currentPick: currentSlot,
            nextUserPick: next,
            cards,
            alerts,
            assumptions: {
                boardLane: activeLane(state?.draftContext?.boardContext || {}),
                poolSize: asArray(state?.pool).length,
                generatedAt: new Date().toISOString(),
            },
        };
    }

    // A forward-looking read for the Alex Live Read panel: who is likely still
    // available at the user's next pick, plus an outlier worth trading up for.
    function buildLiveReadout(state) {
        const next = nextUserPick(state);
        if (!next || !next.slot) return null;
        const picksAway = num(next.picksAway, 0);
        const rows = candidates(state, 60).filter(c => !c.fade);
        if (!rows.length) return null;
        const nm = c => c.player?.name || c.player?.full_name || c.player?.pid || 'Player';
        const ps = c => posOf(c.player) || '';
        const slot = next.slot;
        // Universal round.pick-in-round label — slot.slot is the team column, so
        // derive from overall for saved drafts that predate pickInRound.
        const teams = num(state?.leagueSize, 0);
        const pp = num(slot.pickInRound, 0)
            || (teams > 0 && num(slot.overall, 0) > 0 ? ((num(slot.overall, 0) - 1) % teams) + 1 : num(slot.slot, 0));
        const pickLabel = 'R' + (slot.round || '?') + '.' + String(pp || 0).padStart(2, '0');
        // Heuristic: the ~picksAway top-ranked players are likely gone before our turn.
        const survivors = rows.filter(c => c.rank > picksAway + 1);
        const gone = rows.filter(c => c.rank <= picksAway);
        const pool = survivors.length ? survivors : rows;
        const available = pool.slice(0, 3).map(c => ({ name: nm(c), pos: ps(c), dhq: c.dhq, tier: c.tier }));
        // Outlier: a clearly-superior player projected gone before our pick — a
        // tier or sizeable value jump over the best expected survivor.
        let outlier = null;
        if (picksAway > 0) {
            const bestSurv = survivors[0] || null;
            const topGone = gone.slice().sort((a, b) => b.dhq - a.dhq)[0] || null;
            if (topGone) {
                const tierJump = !!(topGone.tier && bestSurv?.tier && (bestSurv.tier - topGone.tier >= 2));
                const valueJump = !bestSurv || topGone.dhq > bestSurv.dhq * 1.18;
                if (tierJump || valueJump) {
                    outlier = { name: nm(topGone), pos: ps(topGone), dhq: topGone.dhq, tier: topGone.tier };
                }
            }
        }
        return { pickLabel, picksAway, available, outlier };
    }

    // Lightweight, pure signals for the Alex live commentary stream. Returns a
    // bundle the stream effect can dedupe + narrate without any model calls:
    //   tierBreak  — a positional tier that just emptied to its last man (uses
    //                the same tierAlert() cliff logic, surfaced per position).
    //   valueCliff — the steepest DHQ drop-off among the top available players.
    //   needTension— the user's top roster need vs. the board's best-player-available.
    function liveStreamSignals(state) {
        const rows = candidates(state, 48).filter(c => !c.fade);
        const out = { tierBreak: null, valueCliff: null, needTension: null };
        if (!rows.length) return out;
        const nm = c => c.player?.name || c.player?.full_name || c.player?.pid || 'Player';
        const ps = c => posOf(c.player) || '';

        // ── Tier break: a position whose remaining top tier is down to its last
        // player. Reuse tierAlert() over the position's own pocket so the wording
        // and the <=1 cliff threshold stay consistent.
        const byPos = {};
        rows.forEach(c => {
            const pos = ps(c);
            if (!pos) return;
            (byPos[pos] = byPos[pos] || []).push(c);
        });
        let tierBreak = null;
        Object.keys(byPos).forEach(pos => {
            const alert = tierAlert(byPos[pos]);
            if (!alert) return;
            const topTier = byPos[pos].find(c => c.tier);
            const tier = topTier?.tier || null;
            const lastMan = byPos[pos].filter(c => String(c.tier) === String(tier));
            // Only the genuine cliffs (one or zero left in the pocket's top tier).
            if (lastMan.length > 1) return;
            const survivor = byPos[pos][lastMan.length] || null;
            if (!tierBreak || (tier && (!tierBreak.tier || tier < tierBreak.tier))) {
                tierBreak = {
                    pos,
                    tier,
                    lastPlayer: lastMan[0] ? nm(lastMan[0]) : null,
                    nextPlayer: survivor ? nm(survivor) : null,
                    nextTier: survivor?.tier || null,
                };
            }
        });
        out.tierBreak = tierBreak;

        // ── Value cliff: biggest DHQ drop-off between consecutive top-board
        // players. Steep = the gap exceeds ~22% of the higher player's DHQ.
        const top = rows.slice(0, 14);
        let cliff = null;
        for (let i = 0; i < top.length - 1; i++) {
            const a = top[i], b = top[i + 1];
            const dropAbs = num(a.dhq) - num(b.dhq);
            const dropPct = a.dhq ? dropAbs / a.dhq : 0;
            if (dropAbs <= 0) continue;
            if (!cliff || dropPct > cliff.dropPct) {
                cliff = {
                    afterPlayer: nm(a),
                    afterPos: ps(a),
                    afterDhq: Math.round(num(a.dhq)),
                    nextPlayer: nm(b),
                    nextDhq: Math.round(num(b.dhq)),
                    dropAbs: Math.round(dropAbs),
                    dropPct,
                    index: i,
                };
            }
        }
        // Only surface a steep, early cliff (top of the board, >= 22% gap).
        if (cliff && cliff.dropPct >= 0.22 && cliff.index <= 6) out.valueCliff = cliff;

        // ── Need vs. BPA: the user's most urgent need pocket vs. the absolute
        // best player available. Tension when the BPA is off-need but the need
        // is real and the on-need option is a clear step down.
        const needs = userNeedMap(state);
        const needPositions = Object.keys(needs).sort((a, b) => needs[b] - needs[a]);
        const topNeed = needPositions[0];
        if (topNeed) {
            const bpa = rows[0];
            const bpaPos = ps(bpa);
            if (bpa && bpaPos && bpaPos !== topNeed) {
                const onNeed = rows.find(c => ps(c) === topNeed);
                const gap = onNeed ? num(bpa.dhq) - num(onNeed.dhq) : null;
                out.needTension = {
                    needPos: topNeed,
                    bpaName: nm(bpa),
                    bpaPos,
                    onNeedName: onNeed ? nm(onNeed) : null,
                    gap: gap == null ? null : Math.round(gap),
                    urgent: needs[topNeed] >= 22,
                };
            }
        }

        return out;
    }

    // ── Mid-draft trade-evolution signal (rule-based, NO model spend) ──────
    // Buckets state.completedTrades by draft round and compares the per-round and
    // whole-draft trade rate against an EXPECTED baseline derived from the tuning
    // knob (state.draftTuning.tradeActivity, 0-100). Classifies 'heavy'/'typical'/'quiet'.
    // acceptedAt is state.currentIdx — a 0-based pick index; round = floor(idx/size)+1.
    // In live-sync mode completedTrades is empty (read-only), so this is inert there.
    function liveTradeEvolutionSignal(state) {
        const leagueSize = Math.max(1, num(state?.leagueSize, 12));
        const rounds = Math.max(1, num(state?.rounds, 5));
        const trades = asArray(state?.completedTrades);
        const tradedRounds = Math.max(1, Math.floor(num(state?.currentIdx, 0) / leagueSize) + 1);

        const activityRaw = Number(state?.draftTuning?.tradeActivity);
        const activity = Number.isFinite(activityRaw) ? Math.max(0, Math.min(100, activityRaw)) : 50;
        const expectedPerRound = Math.max(0, (0.2 + activity * 0.008));

        const byRound = {};
        let counted = 0;
        trades.forEach(t => {
            const idx = num(t?.acceptedAt, NaN);
            if (!Number.isFinite(idx) || idx < 0) return;
            const round = Math.floor(idx / leagueSize) + 1;
            byRound[round] = (byRound[round] || 0) + 1;
            counted++;
        });

        const total = counted;
        const overallRate = total / tradedRounds;
        const currentRound = Math.min(rounds, Math.floor(num(state?.currentIdx, 0) / leagueSize) + 1);
        const currentRoundCount = byRound[currentRound] || 0;

        const classify = (count, perRoundExpect, roundsSeen) => {
            const expect = Math.max(0.0001, perRoundExpect * Math.max(1, roundsSeen));
            if (count >= Math.max(2, expect * 1.6)) return 'heavy';
            if (roundsSeen >= 2 && count <= expect * 0.4) return 'quiet';
            return 'typical';
        };

        return {
            schemaVersion: SCHEMA,
            leagueSize,
            rounds,
            totalTrades: total,
            tradedRounds,
            currentRound,
            currentRoundCount,
            byRound,
            expectedPerRound: Math.round(expectedPerRound * 100) / 100,
            overallRate: Math.round(overallRate * 100) / 100,
            roundClass: classify(currentRoundCount, expectedPerRound, 1),
            draftClass: classify(total, expectedPerRound, tradedRounds),
            activity,
        };
    }

    // Scout-free gate at the engine seam: every export here is an interpretive
    // read (decision deck recs, predicted-available, tier-break/value-cliff/
    // need-tension advice, trade-evolution narration) → Pro. Gating here covers
    // all consumers (command-center memos + LiveCommandHeader + stream effects)
    // with one seam. Fail-open when pro-gate.js isn't loaded; callers already
    // handle null/{} (their normal "no signal" shape).
    const _ldePro = () => typeof window.wrIsPro !== 'function' || window.wrIsPro();
    const _gateNull = fn => function () { return _ldePro() ? fn.apply(null, arguments) : null; };

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.liveDecisionEngine = {
        buildDecisionDeck: _gateNull(buildDecisionDeck),
        buildLiveReadout: _gateNull(buildLiveReadout),
        liveStreamSignals: function () { return _ldePro() ? liveStreamSignals.apply(null, arguments) : {}; },
        liveTradeEvolutionSignal: _gateNull(liveTradeEvolutionSignal),
        tierAlert: _gateNull(tierAlert),
        _private: {
            candidates,
            nextUserPick,
            projectedValue,
            isFade,
            isTarget,
        },
    };
})();
