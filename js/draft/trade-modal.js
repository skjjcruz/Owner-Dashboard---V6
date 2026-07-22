// ══════════════════════════════════════════════════════════════════
// js/draft/trade-modal.js — CPU-→-user trade offer modal
//
// Renders when state.activeOffer is non-null. Shows the reciprocal
// pick swap with DHQ values, fairness grade, and the "acceptance
// likelihood from the CPU's perspective". Accept / Decline buttons
// dispatch ACCEPT_TRADE or DECLINE_TRADE.
//
// Depends on: styles.js, state.js
// Exposes:    window.DraftCC.TradeModal
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, FONT_MONO } = window.DraftCC.styles;

    function TradeModal({ state, dispatch }) {
        const offer = state.activeOffer;
        if (!offer) return null;

        const onAccept = () => {
            dispatch({ type: 'ACCEPT_TRADE', offer });
        };
        const onDecline = () => {
            dispatch({ type: 'DECLINE_TRADE' });
        };
        const round = Number(offer.negotiationRound || 0);
        const maxRounds = Number(offer.maxNegotiationRounds || 3);
        const counterClosed = !!offer.counterClosed || round >= maxRounds;
        const onCounter = () => {
            if (counterClosed) return;
            const sim = window.DraftCC?.tradeSimulator;
            if (!sim?.evaluateUserProposal || !sim?.offerShape) return;
            const nextRound = round + 1;
            const proposal = buildUserCounterProposal(state, offer);
            const evaluation = sim.evaluateUserProposal(state, proposal);
            const commentary = counterCommentary(evaluation, nextRound, maxRounds);
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
                    type: 'UPDATE_ACTIVE_TRADE',
                    offer: {
                        negotiationRound: nextRound,
                        counterClosed: true,
                        cpuMessage: commentary,
                        reason: commentary + ' Original offer is the last live deal.',
                    },
                });
                return;
            }
            const nextOffer = evaluation.counterOffer || sim.offerShape(state, proposal, evaluation, commentary, {
                countered: true,
            });
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

        const gradeCol = offer.grade?.col || offer.grade?.color || 'var(--gold)';

        return (
            <div style={{
                position: 'fixed',
                bottom: 'calc(80px + var(--wr-bottom-inset, 0px))',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'calc(100% - 32px)',
                maxWidth: 440,
                zIndex: 500,
                fontFamily: FONT_UI,
                animation: 'wrFadeIn 0.25s ease',
            }}>
                <div style={{
                    background: 'var(--black)',
                    border: '2px solid var(--gold)',
                    borderRadius: '10px',
                    padding: '14px 16px',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                    maxHeight: 'calc(100vh - 100px)',
                    overflowY: 'auto',
                }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{
                            fontSize: 'var(--text-label, 0.75rem)',
                            fontWeight: 800,
                            color: 'var(--gold)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                        }}>⚡ Trade Offer</span>
                        <span style={{
                            fontSize: 'var(--text-micro)',
                            padding: '1px 6px',
                            borderRadius: '10px',
                            background: 'var(--ov-3, rgba(255,255,255,0.04))',
                            color: 'var(--silver)',
                        }}>{offer.dnaLabel}</span>
                        <button onClick={onDecline} style={{
                            marginLeft: 'auto',
                            background: 'none',
                            border: 'none',
                            color: 'var(--silver)',
                            fontSize: '1rem',
                            cursor: 'pointer',
                            padding: 0,
                            width: '44px',
                            height: '44px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>×</button>
                    </div>

                    {/* Title + reason */}
	                    <div style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--white)', marginBottom: '2px', fontFamily: FONT_DISPL, letterSpacing: '0.02em' }}>
	                        {offer.fromName} wants to deal
	                    </div>
	                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', marginBottom: '5px', fontWeight: 700 }}>
	                        Draft paused for negotiation · counter {Math.min(round, maxRounds)} / {maxRounds}
	                    </div>
	                    <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', opacity: 1, marginBottom: '8px', lineHeight: 1.4 }}>
	                        {offer.reason}
	                    </div>
	                    {offer.cpuMessage && (
	                        <div style={{
	                            fontSize: 'var(--text-label, 0.75rem)',
	                            color: 'var(--warn)',
	                            marginBottom: '9px',
	                            padding: '7px 9px',
	                            border: '1px solid rgba(240,165,0,0.24)',
	                            borderRadius: '6px',
	                            background: 'rgba(240,165,0,0.06)',
	                            lineHeight: 1.35,
	                        }}>
	                            {offer.cpuMessage}
	                        </div>
	                    )}

                    {/* Metadata strip */}
                    <div style={{ fontSize: 'var(--text-label)', color: 'var(--silver)', marginBottom: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ color: gradeCol, fontWeight: 700 }}>{offer.grade?.grade || '—'} · {offer.grade?.label || ''}</span>
                        <span>·</span>
                        <span>Likelihood: <strong style={{ color: 'var(--gold)' }}>{offer.likelihood}%</strong></span>
                    </div>

                    {/* Asset swap */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto 1fr',
                        gap: '8px',
                        alignItems: 'center',
                        marginBottom: '14px',
                    }}>
                        <div style={{
                            background: 'rgba(231,76,60,0.08)',
                            border: '1px solid rgba(231,76,60,0.25)',
                            borderRadius: '6px',
                            padding: '10px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--bad)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>You give →</div>
                            <AssetStack picks={offer.myGive} playerIds={offer.myGivePlayers} faab={offer.myGiveFaab} />
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '3px', fontFamily: FONT_MONO, fontWeight: 700 }}>
                                {offer.myGiveDHQ?.toLocaleString()} DHQ
                            </div>
                        </div>
                        <span style={{ fontSize: '1.2rem', color: 'var(--gold)' }}>⇄</span>
                        <div style={{
                            background: 'rgba(46,204,113,0.08)',
                            border: '1px solid rgba(46,204,113,0.25)',
                            borderRadius: '6px',
                            padding: '10px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--good)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>← You get</div>
                            <AssetStack picks={offer.theirGive} playerIds={offer.theirGivePlayers} faab={offer.theirGiveFaab} />
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '3px', fontFamily: FONT_MONO, fontWeight: 700 }}>
                                {offer.myGainDHQ?.toLocaleString()} DHQ
                            </div>
                        </div>
                    </div>

                    {/* Psych taxes (compact) */}
                    {offer.taxes && offer.taxes.length > 0 && (
                        <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px',
                            marginBottom: '12px',
                        }}>
                            {offer.taxes.slice(0, 3).map((t, i) => {
                                const isTax = (t.impact || 0) < 0;
                                const col = isTax ? 'var(--k-e74c3c, #e74c3c)' : 'var(--k-2ecc71, #2ecc71)';
                                return (
                                    <span key={i} title={t.desc || ''} style={{
                                        fontSize: 'var(--text-label, 0.75rem)',
                                        padding: '4px 8px',
                                        borderRadius: '10px',
                                        background: wrAlpha(col, '15'),
                                        border: '1px solid ' + wrAlpha(col, '40'),
                                        color: col,
                                        fontWeight: 700,
                                    }}>
                                        {t.name} {(t.impact || 0) > 0 ? '+' : ''}{t.impact}{typeof t.impact === 'number' ? '%' : ''}
                                    </span>
                                );
                            })}
                        </div>
                    )}

                    {/* Actions */}
	                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
	                        <button onClick={onAccept} style={{
	                            padding: '10px',
	                            background: 'var(--good)',
                            color: 'var(--white)',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: 'var(--text-body, 1rem)',
                            fontWeight: 700,
                            cursor: 'pointer',
	                            fontFamily: FONT_UI,
	                        }}>Accept</button>
	                        <button onClick={onCounter} disabled={counterClosed} title={counterClosed ? 'CPU has moved on from counters' : 'Ask for a better version of the offer'} style={{
	                            padding: '10px',
	                            background: counterClosed ? 'var(--ov-3, rgba(255,255,255,0.04))' : 'var(--acc-fill2, rgba(212,175,55,0.12))',
	                            color: counterClosed ? 'var(--ov-8, rgba(255,255,255,0.35))' : 'var(--gold)',
	                            border: '1px solid ' + (counterClosed ? 'var(--ov-5, rgba(255,255,255,0.08))' : 'var(--acc-line2, rgba(212,175,55,0.34))'),
	                            borderRadius: '6px',
	                            fontSize: 'var(--text-body, 1rem)',
	                            fontWeight: 700,
	                            cursor: counterClosed ? 'not-allowed' : 'pointer',
	                            fontFamily: FONT_UI,
	                        }}>Counter</button>
	                        <button onClick={onDecline} style={{
	                            padding: '10px',
	                            background: 'transparent',
                            color: 'var(--silver)',
                            border: '1px solid var(--ov-6, rgba(255,255,255,0.15))',
                            borderRadius: '6px',
                            fontSize: 'var(--text-body, 1rem)',
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: FONT_UI,
                        }}>Decline</button>
                    </div>
                </div>
            </div>
        );
	    }

	    function buildUserCounterProposal(state, offer) {
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

	    function counterCommentary(evaluation, round, maxRounds) {
	        if (evaluation?.accepted) return 'That is closer. I can accept that counter.';
	        if (round >= maxRounds) return "Come on, that's weak. I need more than that, so I'm moving on.";
	        if ((evaluation?.likelihood || 0) >= (evaluation?.counterLine || 50)) return "You're in the neighborhood, but I still need a sweetener to move this pick.";
	        return "Come on, that's light. I need more than that to move off my board.";
	    }

	    function AssetStack({ picks, playerIds, faab }) {
        const pdata = window.S?.players || {};
        const playerName = pid => {
            const p = pdata[pid] || {};
            const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
            return full || pid;
        };
        const hasAny = (picks || []).length || (playerIds || []).length || Number(faab || 0) > 0;
        if (!hasAny) {
            return <div style={{ color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro)' }}>No assets</div>;
        }
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                {(picks || []).map((p, i) => (
                    <div key={'pick' + i} style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--white)', fontFamily: FONT_DISPL, letterSpacing: '0.02em' }}>
                        R{p.round}.{String(p.pickInRound || p.slot || 0).padStart(2, '0')}
                    </div>
                ))}
                {(playerIds || []).map(pid => (
                    <div key={pid} style={{ maxWidth: 150, fontSize: 'var(--text-label)', color: 'var(--purple)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {playerName(pid)}
                    </div>
                ))}
                {Number(faab || 0) > 0 && (
                    <div style={{ fontSize: 'var(--text-label)', color: 'var(--good)', fontFamily: FONT_MONO }}>${faab} FAAB</div>
                )}
            </div>
        );
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.TradeModal = TradeModal;
})();
