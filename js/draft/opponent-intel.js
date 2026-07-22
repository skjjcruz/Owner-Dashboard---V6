// ══════════════════════════════════════════════════════════════════
// js/draft/opponent-intel.js — Opponent Intel panel (right panel)
//
// Phase 2: full persona card. Shows identity + DNA labels + stat rows
// + "will reach for" / "will pass on" predictions + psych taxes (vs.
// the user) + grudge display + "Scout roster" button.
//
// Depends on: styles.js, persona.js, cpu-engine.js (computePredictions),
//             window.App.TradeEngine (calcPsychTaxes, calcGrudgeTax)
// Exposes:    window.DraftCC.OpponentIntelPanel
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, panelCard } = window.DraftCC.styles;

    function OpponentIntelPanel({ state, dispatch, currentSlot, onPropose }) {
        const pinnedId = state.pinnedRosterId;
        const targetId = pinnedId || currentSlot?.rosterId || null;
        const persona = targetId ? state.personas?.[targetId] : null;
        const isPinned = !!pinnedId;
        const userRosterId = state.userRosterId;
        const isMe = targetId === userRosterId;

        const onUnpin = () => dispatch({ type: 'PIN_TEAM', rosterId: null });

        // My persona (for psych-tax computation)
        const myPersona = state.personas?.[userRosterId];

        // Compute psych taxes (live) when viewing an opponent
        const psychTaxes = React.useMemo(() => {
            if (!persona || !myPersona || isMe) return null;
            try {
                const calcPsychTaxes = window.DraftCC?.tradeHelpers?.calcPsychTaxes
                    || window.App?.TradeEngine?.calcPsychTaxes;
                if (!calcPsychTaxes) return null;
                return calcPsychTaxes(
                    myPersona.assessment,
                    persona.assessment,
                    persona.tradeDna?.key,
                    persona.posture
                );
            } catch (e) {
                if (window.wrLog) window.wrLog('oppIntel.psychTax', e);
                return null;
            }
        }, [persona, myPersona, isMe]);

        // Compute grudge (live)
        const grudgeScore = React.useMemo(() => {
            if (!persona || !myPersona || isMe) return 0;
            try {
                const calcGrudgeTax = window.DraftCC?.tradeHelpers?.calcGrudgeTax
                    || window.App?.TradeEngine?.calcGrudgeTax;
                if (!calcGrudgeTax) return 0;
                const grudges = window._tcGrudges || [];
                return calcGrudgeTax(userRosterId, targetId, grudges) || 0;
            } catch (e) { return 0; }
        }, [persona, myPersona, isMe, targetId, userRosterId]);

        const onScoutRoster = () => {
            if (!persona || !persona.rosterId) return;
            // Best-effort: find a few of their rostered players and open the modal on the first one
            const rosters = window.S?.rosters || [];
            const r = rosters.find(x => x.roster_id === persona.rosterId);
            const pid = r?.players?.[0] || r?.starters?.[0];
            if (pid && typeof window.openPlayerModal === 'function') {
                try { window.openPlayerModal(pid); } catch (e) {}
            }
        };

        const containerCss = panelCard({
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 12px',
            overflow: 'hidden',
        });

        // Owner reads (DNA labels, reach/pass predictions, psych taxes, grudges)
        // are Scout Pro — free gets a locked panel shell, never a raw error.
        if (typeof window.wrIsPro === 'function' && !window.wrIsPro()) {
            const GatedRow = window.WrGatedMoreRow;
            return (
                <div style={containerCss}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <div style={{ fontFamily: FONT_DISPL, fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                            Opponent Intel
                        </div>
                    </div>
                    {GatedRow
                        ? <GatedRow title="Read every opposing GM" sub="Draft DNA, reach/pass predictions, psych taxes, and grudges are Scout Pro." feature="draft_opponent_intel" />
                        : <div dangerouslySetInnerHTML={{ __html: window.wrLockCard ? window.wrLockCard('Opponent Intel', 'draft_opponent_intel', 'Opposing-GM reads are Scout Pro.') : '' }} />}
                </div>
            );
        }

        return (
            <div style={containerCss}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontFamily: FONT_DISPL, fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                        Opponent Intel
                    </div>
                    {isPinned && (
                        <button onClick={onUnpin} style={{
                            padding: '2px 6px',
                            minWidth: '44px',
                            minHeight: '44px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 'var(--text-label)',
                            border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                            background: 'transparent',
                            color: 'var(--silver)',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontFamily: FONT_UI,
                        }}>Unpin</button>
                    )}
                </div>

                {/* Empty state */}
                {!persona && (
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        gap: '6px',
                        color: 'var(--silver)',
                        opacity: 0.4,
                        fontSize: 'var(--text-label, 0.75rem)',
                        textAlign: 'center',
                        padding: '20px',
                        fontFamily: FONT_UI,
                    }}>
                        <div style={{ fontSize: '2rem', opacity: 0.3 }}>◯</div>
                        <div>Click any team in the grid<br />to see their persona</div>
                    </div>
                )}

                {/* Persona card */}
                {persona && (
                    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', paddingRight: '3px' }}>
                        {/* Identity header */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            paddingBottom: '8px',
                            marginBottom: '8px',
                            borderBottom: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))',
                        }}>
                            {persona.avatar ? (
                                <img
                                    src={persona.avatar}
                                    style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))' }}
                                    onError={e => e.target.style.display = 'none'}
                                    alt=""
                                />
                            ) : (
                                <div style={{
                                    width: 40, height: 40, borderRadius: '50%',
                                    background: 'var(--charcoal)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontWeight: 700,
                                    border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))',
                                    fontFamily: FONT_DISPL,
                                }}>{(persona.teamName || '?').charAt(0)}</div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: 'var(--text-body, 1rem)',
                                    fontWeight: 700,
                                    color: 'var(--white)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    fontFamily: FONT_DISPL,
                                    letterSpacing: '0.02em',
                                }}>{isPinned && '📌 '}{persona.teamName}</div>
                                {persona.ownerName && (
                                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: FONT_UI }}>
                                        {persona.ownerName}{isMe ? ' · YOU' : ''}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Needs — surfaced high, right under identity */}
                        {persona.assessment?.needs?.length > 0 && (
                            <div style={{ marginBottom: '4px' }}>
                                <SectionLabel>Needs</SectionLabel>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                    {persona.assessment.needs.slice(0, 4).map((n, i) => {
                                        const pos = typeof n === 'string' ? n : n?.pos;
                                        const urgency = typeof n === 'object' ? n?.urgency : null;
                                        const col = urgency === 'deficit' ? 'var(--k-e74c3c, #e74c3c)' : 'var(--k-d4af37, #d4af37)';
                                        return (
                                            <span key={i} style={{
                                                fontSize: 'var(--text-label, 0.75rem)',
                                                fontWeight: 700,
                                                padding: '2px 6px',
                                                borderRadius: '10px',
                                                background: wrAlpha(col, '18'),
                                                border: '1px solid ' + wrAlpha(col, '44'),
                                                color: col,
                                                fontFamily: FONT_UI,
                                            }}>{pos}{urgency === 'deficit' ? '!' : ''}</span>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ── PREDICTION ENGINE — visual centerpiece ── */}
                        <PredictionEngine predictions={persona.predictions} />

                        {/* Stat rows (DNA) */}
                        <StatRow label="DRAFT DNA" value={persona.draftDna?.label || 'Balanced'} color="var(--gold)" />
                        <StatRow label="TRADE DNA" value={persona.tradeDna?.label || '—'} color={persona.tradeDna?.color || 'var(--silver)'} />
                        <StatRow label="POSTURE" value={persona.posture?.label || 'Neutral'} color={persona.posture?.color || 'var(--silver)'} />
                        <StatRow label="TIER" value={persona.assessment?.tier || '—'} color="var(--silver)" />
                        <StatRow label="HEALTH" value={(persona.assessment?.healthScore || 0) + ' / 100'} color={healthColor(persona.assessment?.healthScore || 0)} />

                        {persona.ownerIntel && (
                            <OwnerIntelBlock ownerIntel={persona.ownerIntel} />
                        )}

                        {/* Psych taxes (vs. user) */}
                        {psychTaxes && psychTaxes.length > 0 && !isMe && (
                            <div style={{ marginTop: '10px' }}>
                                <SectionLabel>Psych Taxes (vs. you)</SectionLabel>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    {psychTaxes.slice(0, 5).map((t, i) => {
                                        const isTax = (t.impact || 0) < 0;
                                        const col = isTax ? 'var(--k-e74c3c, #e74c3c)' : 'var(--k-2ecc71, #2ecc71)';
                                        return (
                                            <div key={i} title={t.desc || ''} style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                fontSize: 'var(--text-label, 0.75rem)',
                                                padding: '2px 4px',
                                                borderLeft: '2px solid ' + col,
                                                paddingLeft: '6px',
                                                fontFamily: FONT_UI,
                                            }}>
                                                <span style={{
                                                    color: 'var(--silver)',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    flex: 1,
                                                    opacity: 0.85,
                                                }}>{t.name}</span>
                                                <span style={{ color: col, fontWeight: 700, marginLeft: '4px' }}>
                                                    {(t.impact || 0) > 0 ? '+' : ''}{t.impact}{typeof t.impact === 'number' ? '%' : ''}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Grudge display */}
                        {!isMe && grudgeScore !== 0 && (
                            <div style={{
                                marginTop: '8px',
                                padding: '6px 8px',
                                background: grudgeScore > 0 ? 'rgba(46,204,113,0.08)' : 'rgba(231,76,60,0.08)',
                                border: '1px solid ' + (grudgeScore > 0 ? 'rgba(46,204,113,0.25)' : 'rgba(231,76,60,0.25)'),
                                borderRadius: '4px',
                                fontSize: 'var(--text-label, 0.75rem)',
                                color: grudgeScore > 0 ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-e74c3c, #e74c3c)',
                                fontFamily: FONT_UI,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                            }}>
                                <span style={{ fontWeight: 700 }}>{grudgeScore > 0 ? '🤝' : '⚔'}</span>
                                <span>Grudge: {grudgeScore > 0 ? '+' : ''}{grudgeScore} (trade history)</span>
                            </div>
                        )}

                        {/* Draft DNA details */}
                        {persona.draftDna?.picksAnalyzed > 0 && (
                            <div style={{ marginTop: '8px', padding: '6px 8px', background: 'var(--ov-1, rgba(255,255,255,0.02))', borderRadius: '4px', border: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                                <SectionLabel>Draft History</SectionLabel>
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.5, fontFamily: FONT_UI }}>
                                    {persona.draftDna.tendency || persona.draftDna.roundProfile || ''}
                                </div>
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.5, marginTop: '2px' }}>
                                    {persona.draftDna.picksAnalyzed} picks · {persona.draftDna.seasons}
                                </div>
                            </div>
                        )}

                        {/* Inferred DNA warning */}
                        {persona.draftDna?.inferred && (
                            <div style={{
                                marginTop: '8px',
                                padding: '5px 7px',
                                background: 'rgba(240,165,0,0.08)',
                                border: '1px solid rgba(240,165,0,0.25)',
                                borderRadius: '4px',
                                fontSize: 'var(--text-label, 0.75rem)',
                                color: 'var(--k-f0a500, #f0a500)',
                                fontFamily: FONT_UI,
                                lineHeight: 1.4,
                            }}>
                                ⚠ Inferred DNA — limited draft history. Predictions are educated guesses.
                            </div>
                        )}

                        {/* Action buttons */}
                        {!isMe && (
                            <div style={{ display: 'flex', gap: '4px', marginTop: '10px' }}>
                                <button onClick={onScoutRoster} style={{
                                    flex: 1,
                                    padding: '6px',
                                    minHeight: '44px',
                                    fontSize: 'var(--text-label)',
                                    fontFamily: FONT_UI,
                                    fontWeight: 600,
                                    background: 'rgba(52,152,219,0.12)',
                                    color: 'var(--k-3498db, #3498db)',
                                    border: '1px solid rgba(52,152,219,0.3)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                }}>SCOUT ROSTER</button>
                                <button
                                    onClick={() => onPropose && onPropose(persona.rosterId)}
                                    disabled={!onPropose}
                                    style={{
                                        flex: 1,
                                        padding: '6px',
                                        minHeight: '44px',
                                        fontSize: 'var(--text-label)',
                                        fontFamily: FONT_UI,
                                        fontWeight: 600,
                                        background: 'var(--acc-fill2, rgba(212,175,55,0.12))',
                                        color: 'var(--gold)',
                                        border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))',
                                        borderRadius: '4px',
                                        cursor: onPropose ? 'pointer' : 'not-allowed',
                                    }}>PROPOSE TRADE</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    // ── Prediction Engine — confidence model ──────────────────────────
    // delta is a fractional multiplier (0.18 => +18% inflation vs baseline).
    // confidence may arrive as a 0-1 scalar; if absent we derive one from the
    // strongest "will reach" signal so the hero always reads as conviction.
    function predConfidence(predictions) {
        const c = predictions?.likelyPick?.confidence;
        if (typeof c === 'number' && isFinite(c) && c >= 0 && c <= 1) {
            return Math.round(c * 100);
        }
        // Derive from signal strength: top reach delta scaled into a band.
        const reach = predictions?.willReach || [];
        const topDelta = reach.length ? Math.abs(reach[0].delta || 0) : 0;
        if (!topDelta) return 50; // no signal → neutral MED
        // 0.25 delta (a strong reach) maps near the top of the band.
        return Math.max(35, Math.min(85, Math.round(40 + (topDelta / 0.25) * 45)));
    }

    function confBand(pct) {
        if (pct >= 66) return { label: 'HIGH', color: 'var(--k-2ecc71, #2ecc71)' };
        if (pct >= 40) return { label: 'MED', color: 'var(--gold)' };
        return { label: 'LOW', color: 'var(--k-f0a500, #f0a500)' };
    }

    // A single ranked prediction row: position badge + delta + proportional bar.
    function PredRow({ pos, delta, max, sign, color }) {
        const pct = Math.round(Math.abs(delta) * 100);
        const barW = max > 0 ? Math.max(8, Math.round((Math.abs(delta) / max) * 100)) : 8;
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0', fontFamily: FONT_UI }}>
                <span style={{
                    fontSize: 'var(--text-label, 0.75rem)',
                    fontWeight: 800,
                    color,
                    minWidth: '34px',
                    padding: '1px 5px',
                    textAlign: 'center',
                    borderRadius: '3px',
                    background: wrAlpha(color, '1a'),
                    border: '1px solid ' + wrAlpha(color, '3a'),
                    letterSpacing: '0.04em',
                }}>{pos}</span>
                <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'var(--ov-3, rgba(255,255,255,0.05))', overflow: 'hidden' }}>
                    <div style={{ width: barW + '%', height: '100%', background: color, borderRadius: '3px', transition: 'width 0.2s ease' }} />
                </div>
                <span style={{
                    fontSize: 'var(--text-label, 0.75rem)',
                    fontWeight: 700,
                    color,
                    minWidth: '36px',
                    textAlign: 'right',
                }}>{sign}{pct}%</span>
            </div>
        );
    }

    function PredictionEngine({ predictions }) {
        const likely = predictions?.likelyPick;
        const reach = (predictions?.willReach || []).slice(0, 3);
        const pass = (predictions?.willPassOn || []).slice(0, 3);
        const hasSignal = !!likely || reach.length > 0 || pass.length > 0;

        const goodCol = 'var(--k-2ecc71, #2ecc71)';
        const badCol = 'var(--k-e74c3c, #e74c3c)';
        const reachMax = reach.reduce((m, r) => Math.max(m, Math.abs(r.delta || 0)), 0);
        const passMax = pass.reduce((m, r) => Math.max(m, Math.abs(r.delta || 0)), 0);

        const conf = predConfidence(predictions);
        const band = confBand(conf);

        return (
            <div style={{
                margin: '10px 0',
                padding: '0',
                background: 'var(--acc-fill1, rgba(212,175,55,0.06))',
                border: '1px solid var(--acc-line1, rgba(212,175,55,0.28))',
                borderRadius: '6px',
                overflow: 'hidden',
            }}>
                {/* Gold-accented header bar */}
                <div style={{
                    padding: '6px 10px',
                    background: 'var(--acc-fill2, rgba(212,175,55,0.12))',
                    borderBottom: hasSignal ? '1px solid var(--acc-line2, rgba(212,175,55,0.3))' : 'none',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '7px',
                }}>
                    <span style={{
                        fontSize: 'var(--text-label, 0.75rem)',
                        fontWeight: 800,
                        color: 'var(--gold)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        fontFamily: FONT_DISPL,
                    }}>◈ Prediction Engine</span>
                    <span style={{
                        fontSize: 'var(--text-micro, 0.6875rem)',
                        color: 'var(--silver)',
                        opacity: 0.6,
                        fontFamily: FONT_UI,
                    }}>what this GM does next</span>
                </div>

                {!hasSignal && (
                    <div style={{
                        padding: '14px 10px',
                        textAlign: 'center',
                        color: 'var(--silver)',
                        opacity: 0.55,
                        fontSize: 'var(--text-label, 0.75rem)',
                        fontFamily: FONT_UI,
                    }}>
                        <span style={{ opacity: 0.6 }}>◌ </span>Gathering read…
                    </div>
                )}

                {hasSignal && (
                    <div style={{ padding: '8px 10px' }}>
                        {/* HERO — most likely pick */}
                        {likely && (
                            <div style={{ marginBottom: (reach.length || pass.length) ? '9px' : '0' }}>
                                <div style={{
                                    fontSize: 'var(--text-label, 0.75rem)',
                                    color: 'var(--silver)',
                                    opacity: 0.6,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.06em',
                                    fontFamily: FONT_UI,
                                    marginBottom: '2px',
                                }}>Most likely pick</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px' }}>
                                    <span style={{
                                        fontSize: 'var(--text-body, 1rem)',
                                        fontWeight: 700,
                                        color: 'var(--white)',
                                        fontFamily: FONT_DISPL,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        flex: 1,
                                        minWidth: 0,
                                    }}>{likely.name}</span>
                                    {likely.pos && (
                                        <span style={{
                                            fontSize: 'var(--text-label, 0.75rem)',
                                            fontWeight: 800,
                                            color: 'var(--gold)',
                                            padding: '1px 6px',
                                            borderRadius: '3px',
                                            background: wrAlpha('var(--k-d4af37, #d4af37)', '1a'),
                                            border: '1px solid ' + wrAlpha('var(--k-d4af37, #d4af37)', '3a'),
                                            letterSpacing: '0.04em',
                                            fontFamily: FONT_UI,
                                        }}>{likely.pos}</span>
                                    )}
                                </div>
                                {/* Confidence readout: bar + chip */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                                    <span style={{
                                        fontSize: 'var(--text-label, 0.75rem)',
                                        color: 'var(--silver)',
                                        opacity: 0.7,
                                        fontFamily: FONT_UI,
                                        minWidth: '64px',
                                    }}>Confidence</span>
                                    <div style={{ flex: 1, height: '7px', borderRadius: '4px', background: 'var(--ov-3, rgba(255,255,255,0.05))', overflow: 'hidden' }}>
                                        <div style={{ width: conf + '%', height: '100%', background: band.color, borderRadius: '4px', transition: 'width 0.2s ease' }} />
                                    </div>
                                    <span style={{
                                        fontSize: 'var(--text-label, 0.75rem)',
                                        fontWeight: 800,
                                        color: band.color,
                                        fontFamily: FONT_UI,
                                        minWidth: '30px',
                                        textAlign: 'right',
                                    }}>{conf}%</span>
                                    <span style={{
                                        fontSize: 'var(--text-micro, 0.6875rem)',
                                        fontWeight: 800,
                                        color: band.color,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.06em',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        background: wrAlpha(band.color, '1a'),
                                        border: '1px solid ' + wrAlpha(band.color, '3a'),
                                        fontFamily: FONT_UI,
                                    }}>{band.label}</span>
                                </div>
                            </div>
                        )}

                        {/* WILL REACH FOR */}
                        {reach.length > 0 && (
                            <div style={{ marginBottom: pass.length ? '8px' : '0' }}>
                                <div style={{
                                    fontSize: 'var(--text-label, 0.75rem)',
                                    fontWeight: 700,
                                    color: goodCol,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.06em',
                                    fontFamily: FONT_UI,
                                    marginBottom: '2px',
                                }}>↑ Will reach for</div>
                                {reach.map((r, i) => (
                                    <PredRow key={'reach' + i} pos={r.pos} delta={r.delta} max={reachMax} sign="+" color={goodCol} />
                                ))}
                            </div>
                        )}

                        {/* WILL PASS ON */}
                        {pass.length > 0 && (
                            <div>
                                <div style={{
                                    fontSize: 'var(--text-label, 0.75rem)',
                                    fontWeight: 700,
                                    color: badCol,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.06em',
                                    fontFamily: FONT_UI,
                                    marginBottom: '2px',
                                }}>↓ Will pass on</div>
                                {pass.map((r, i) => (
                                    <PredRow key={'pass' + i} pos={r.pos} delta={r.delta} max={passMax} sign="−" color={badCol} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    function SectionLabel({ children }) {
        return (
            <div style={{
                fontSize: 'var(--text-label, 0.75rem)',
                fontWeight: 700,
                color: 'var(--gold)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '3px',
                fontFamily: FONT_UI,
            }}>{children}</div>
        );
    }

    function StatRow({ label, value, color }) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '2px 0',
                fontSize: 'var(--text-label, 0.75rem)',
                fontFamily: FONT_UI,
            }}>
                <span style={{
                    fontSize: 'var(--text-label, 0.75rem)',
                    fontWeight: 700,
                    color: 'var(--silver)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    opacity: 0.7,
                }}>{label}</span>
                <span style={{ fontWeight: 700, color }}>{value}</span>
            </div>
        );
    }

    function OwnerIntelBlock({ ownerIntel }) {
        const confidence = ownerIntel?.confidence?.overall || 'inferred';
        const reasons = (ownerIntel?.reasonCodes || []).slice(0, 3);
        const color = confidence === 'high' ? 'var(--k-2ecc71, #2ecc71)' : confidence === 'medium' ? 'var(--gold)' : confidence === 'low' ? 'var(--k-f0a500, #f0a500)' : 'var(--silver)';
        return (
            <div style={{
                marginTop: '9px',
                padding: '7px 8px',
                background: 'var(--ov-2, rgba(255,255,255,0.025))',
                border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))',
                borderRadius: '5px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: reasons.length ? '5px' : 0 }}>
                    <SectionLabel>Historical Intel</SectionLabel>
                    <span style={{
                        fontSize: 'var(--text-label, 0.75rem)',
                        fontWeight: 800,
                        color,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        fontFamily: FONT_UI,
                    }}>{confidence}</span>
                </div>
                {reasons.map(r => (
                    <div key={r.code} title={r.source || ''} style={{
                        fontSize: 'var(--text-label, 0.75rem)',
                        color: 'var(--silver)',
                        lineHeight: 1.35,
                        marginTop: '3px',
                        fontFamily: FONT_UI,
                    }}>
                        <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{r.label}: </span>
                        <span>{r.detail}</span>
                    </div>
                ))}
            </div>
        );
    }

    function healthColor(h) {
        if (h >= 70) return 'var(--k-2ecc71, #2ecc71)';
        if (h >= 40) return 'var(--k-f0a500, #f0a500)';
        return 'var(--k-e74c3c, #e74c3c)';
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.OpponentIntelPanel = OpponentIntelPanel;
})();
