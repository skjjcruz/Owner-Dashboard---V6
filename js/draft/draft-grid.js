// ══════════════════════════════════════════════════════════════════
// js/draft/draft-grid.js — Draft Grid panel (center panel)
//
// Center 6-col panel of the command center. Renders the snake-draft
// grid (rounds × teams), with the user's row highlighted, traded-pick
// badges, DNA-label chips under team names, and the "on the clock"
// pulse on the current cell.
//
// Ports the table structure from js/mock-draft.js:448–490 and upgrades
// with persona labels and a bottom "On The Clock" card.
//
// Depends on: styles.js, state.js, persona.js (for DNA label chips)
// Exposes:    window.DraftCC.DraftGridPanel (React component)
// ══════════════════════════════════════════════════════════════════

(function() {
    const { DRAFT_CC_LAYOUT, FONT_UI, FONT_DISPL, FONT_MONO, panelCard } = window.DraftCC.styles;

    function DraftGridPanel({ state, dispatch, isUserTurn, currentSlot }) {
        const posColors = window.App?.POS_COLORS || {
            QB: 'var(--k-ff6b6b, #ff6b6b)', RB: 'var(--k-4ecdc4, #4ecdc4)', WR: 'var(--k-45b7d1, #45b7d1)', TE: 'var(--k-f7dc6f, #f7dc6f)',
            DL: 'var(--k-e67e22, #e67e22)', LB: 'var(--k-f0a500, #f0a500)', DB: 'var(--k-5dade2, #5dade2)', K: 'var(--k-bb8fce, #bb8fce)',
        };

        // Build pick map for O(1) cell lookup
        const pickMap = React.useMemo(() => {
            const m = {};
            for (const p of state.picks) m[p.round + '-' + p.teamIdx] = p;
            return m;
        }, [state.picks]);

        // Slot map: overall pick number per (round, teamIdx)
        const slotMap = React.useMemo(() => {
            const m = {};
            for (const s of state.pickOrder) m[s.round + '-' + s.teamIdx] = s;
            return m;
        }, [state.pickOrder]);

        const userIdx = (state.userSlot || 1) - 1;

        // Phase 7 deferred: per-owner accent color so each team column is visually distinct.
        // Uses a 12-color palette hashed by rosterId for stability across renders.
        const OWNER_PALETTE = ['var(--k-e74c3c, #e74c3c)', 'var(--k-f0a500, #f0a500)', 'var(--k-d4af37, #d4af37)', 'var(--k-2ecc71, #2ecc71)', 'var(--k-1abc9c, #1abc9c)', 'var(--k-3498db, #3498db)', 'var(--k-9b8afb, #9b8afb)', 'var(--k-e67e22, #e67e22)', 'var(--k-ff6b6b, #ff6b6b)', 'var(--k-27ae60, #27ae60)', 'var(--k-3fa7d6, #3fa7d6)', 'var(--k-c678dd, #c678dd)'];
        const ownerColor = (teamIdx) => {
            if (teamIdx === userIdx) return 'var(--k-d4af37, #d4af37)'; // gold for the user
            for (const s of state.pickOrder) {
                if (s.teamIdx === teamIdx) {
                    const rid = s.rosterId || teamIdx;
                    const n = typeof rid === 'number' ? rid : parseInt(rid, 10) || teamIdx;
                    return OWNER_PALETTE[n % OWNER_PALETTE.length];
                }
            }
            return OWNER_PALETTE[teamIdx % OWNER_PALETTE.length];
        };
        const ownerAvatarUrl = (teamIdx) => {
            for (const s of state.pickOrder) {
                if (s.teamIdx === teamIdx) {
                    const persona = state.personas?.[s.rosterId];
                    if (persona?.avatar) return 'https://sleepercdn.com/avatars/thumbs/' + persona.avatar;
                }
            }
            return null;
        };

        // Team labels: prefer persona.teamName, fall back to pickOrder ownerName
        const teamLabel = (teamIdx) => {
            if (teamIdx === userIdx) return 'YOU';
            // Look at any slot for this teamIdx to get the owner name
            for (const s of state.pickOrder) {
                if (s.teamIdx === teamIdx) {
                    const persona = state.personas?.[s.rosterId];
                    if (persona && persona.teamName) return persona.teamName.substring(0, 8);
                    return (s.ownerName || ('T' + (teamIdx + 1))).substring(0, 8);
                }
            }
            return 'T' + (teamIdx + 1);
        };

        // Team DNA label (short 3-4 char chip)
        const teamDNALabel = (teamIdx) => {
            for (const s of state.pickOrder) {
                if (s.teamIdx === teamIdx) {
                    const persona = state.personas?.[s.rosterId];
                    if (!persona) return null;
                    const lbl = persona.draftDna?.label;
                    if (!lbl || lbl === 'Balanced') return null;
                    return lbl;
                }
            }
            return null;
        };

        // Look up rosterId for a given teamIdx (for pinning)
        const teamRosterId = (teamIdx) => {
            for (const s of state.pickOrder) {
                if (s.teamIdx === teamIdx) return s.rosterId;
            }
            return null;
        };

        // Pin a team (or unpin if already pinned)
        const onPinTeam = (teamIdx) => {
            const rid = teamRosterId(teamIdx);
            if (!rid) return;
            dispatch({ type: 'PIN_TEAM', rosterId: state.pinnedRosterId === rid ? null : rid });
        };

        const pinnedTeamIdx = React.useMemo(() => {
            if (!state.pinnedRosterId) return null;
            for (const s of state.pickOrder) {
                if (s.rosterId === state.pinnedRosterId) return s.teamIdx;
            }
            return null;
        }, [state.pinnedRosterId, state.pickOrder]);

        // On The Clock card data
        const onTheClock = currentSlot ? (() => {
            const persona = state.personas?.[currentSlot.rosterId];
            return {
                slot: currentSlot,
                persona,
                teamName: persona?.teamName || currentSlot.ownerName || ('Team ' + currentSlot.slot),
                avatar: persona?.avatar || '',
                dnaLabel: persona?.draftDna?.label || '',
                tradeDna: persona?.tradeDna?.label || '',
                tradeDnaColor: persona?.tradeDna?.color || 'var(--silver)',
                posture: persona?.posture?.label || '',
                postureColor: persona?.posture?.color || 'var(--silver)',
                isUser: currentSlot.rosterId === state.userRosterId,
            };
        })() : null;

        const containerCss = panelCard({
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 12px',
        });

        const leagueSize = state.leagueSize || 12;
        const rounds = state.rounds || 5;

        // Table cell width — shrink if many teams
        const cellWidth = leagueSize <= 10 ? 70 : leagueSize <= 12 ? 60 : 52;

        return (
            <div style={containerCss}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontFamily: FONT_DISPL, fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                        Draft Grid
                    </div>
                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: FONT_UI }}>
                        Pick {state.currentIdx} / {state.pickOrder.length}
                    </div>
                </div>

                {/* Grid */}
                <div style={{
                    flex: 1,
                    overflow: 'auto',
                    borderRadius: '6px',
                    border: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))',
                    background: 'var(--ov-1, rgba(255,255,255,0.01))',
                }}>
                    <table style={{
                        borderCollapse: 'collapse',
                        fontSize: 'var(--text-label, 0.75rem)',
                        width: '100%',
                        minWidth: (leagueSize * cellWidth + 30) + 'px',
                        tableLayout: 'fixed',
                        fontFamily: FONT_UI,
                    }}>
                        <thead>
                            <tr style={{ background: 'var(--acc-fill2, rgba(212,175,55,0.08))', position: 'sticky', top: 0, zIndex: 1 }}>
                                <th style={{
                                    width: 28,
                                    padding: '4px 2px',
                                    textAlign: 'center',
                                    color: 'var(--silver)',
                                    fontWeight: 700,
                                    borderBottom: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))',
                                    fontSize: 'var(--text-label, 0.75rem)',
                                }}>Rd</th>
                                {Array.from({ length: leagueSize }, (_, i) => {
                                    const label = teamLabel(i);
                                    const dna = teamDNALabel(i);
                                    const isPinned = pinnedTeamIdx === i;
                                    const isClickable = i !== userIdx;
                                    const isUser = i === userIdx;
                                    const accent = ownerColor(i);
                                    const avatar = ownerAvatarUrl(i);
                                    return (
                                        <th
                                            key={i}
                                            onClick={isClickable ? () => onPinTeam(i) : undefined}
                                            title={isClickable ? (isPinned ? 'Unpin team' : 'Pin to Opponent Intel') : 'Your team'}
                                            style={{
                                                padding: '0 2px 4px',
                                                minHeight: isClickable ? '44px' : undefined,
                                                textAlign: 'center',
                                                fontWeight: isUser ? 800 : 600,
                                                color: isUser ? 'var(--gold)' : isPinned ? 'var(--gold)' : 'var(--silver)',
                                                borderBottom: '1px solid rgba(212,175,55,' + (isPinned ? '0.5' : '0.15') + ')',
                                                background: isUser
                                                    ? 'var(--acc-fill2, rgba(212,175,55,0.10))'
                                                    : isPinned
                                                        ? 'var(--acc-fill2, rgba(212,175,55,0.12))'
                                                        : 'transparent',
                                                width: cellWidth,
                                                overflow: 'hidden',
                                                cursor: isClickable ? 'pointer' : 'default',
                                                transition: 'background 0.12s',
                                            }}
                                            onMouseEnter={e => { if (isClickable && !isPinned) e.currentTarget.style.background = 'var(--acc-fill2, rgba(212,175,55,0.08))'; }}
                                            onMouseLeave={e => { if (isClickable && !isPinned) e.currentTarget.style.background = isUser ? 'var(--acc-fill2, rgba(212,175,55,0.10))' : 'transparent'; }}
                                        >
                                            {/* Phase 7 deferred: owner accent strip — fills the column width with the owner's color */}
                                            <div style={{ height: '3px', background: accent, marginBottom: '3px' }} />
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', justifyContent: 'center' }}>
                                                {avatar && (
                                                    <img src={avatar} alt="" onError={e => { e.target.style.display = 'none'; }}
                                                        style={{ width: '12px', height: '12px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                                                )}
                                                <div style={{
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    fontSize: 'var(--text-label, 0.75rem)',
                                                }}>{isPinned && '📌 '}{label}</div>
                                            </div>
                                            {dna && (
                                                <div style={{
                                                    fontSize: 'var(--text-label, 0.75rem)',
                                                    color: 'var(--gold)',
                                                    opacity: 0.7,
                                                    marginTop: '1px',
                                                    fontWeight: 500,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                }}>{dna}</div>
                                            )}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: rounds }, (_, r) => (
                                <tr key={r} style={{ borderBottom: '1px solid var(--ov-1, rgba(255,255,255,0.02))' }}>
                                    <td style={{
                                        padding: '2px 2px',
                                        textAlign: 'center',
                                        color: 'var(--gold)',
                                        fontWeight: 700,
                                        background: 'var(--acc-fill1, rgba(212,175,55,0.04))',
                                        fontSize: 'var(--text-label, 0.75rem)',
                                    }}>{r + 1}</td>
                                    {Array.from({ length: leagueSize }, (_, i) => {
                                        const key = (r + 1) + '-' + i;
                                        const pick = pickMap[key];
                                        const slot = slotMap[key];
                                        const isCurrent = currentSlot && currentSlot.round === r + 1 && currentSlot.teamIdx === i;
                                        const isMe = i === userIdx;
                                        const traded = slot?.traded;
                                        return (
                                            <td key={i} style={{
                                                padding: '2px',
                                                textAlign: 'center',
                                                height: 34,
                                                background: isCurrent ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : isMe ? 'var(--acc-fill1, rgba(212,175,55,0.03))' : 'transparent',
                                                outline: isCurrent ? '1px solid var(--acc-line3, rgba(212,175,55,0.5))' : 'none',
                                                verticalAlign: 'middle',
                                                position: 'relative',
                                            }}>
                                                {pick ? (
                                                    <div style={{ lineHeight: 1.1 }}>
                                                        <div style={{
                                                            fontWeight: 600,
                                                            color: pick.isUser ? 'var(--gold)' : 'var(--white)',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                            fontSize: 'var(--text-label, 0.75rem)',
                                                            padding: '0 2px',
                                                        }}>
                                                            {pick.name.split(' ').slice(-1)[0]}
                                                        </div>
                                                        <span style={{
                                                            fontSize: 'var(--text-label, 0.75rem)',
                                                            fontWeight: 700,
                                                            padding: '0 3px',
                                                            borderRadius: '2px',
                                                            background: (posColors[pick.pos] || 'var(--k-666666, #666666)') + '22',
                                                            color: posColors[pick.pos] || 'var(--silver)',
                                                            display: 'inline-block',
                                                            marginTop: '1px',
                                                        }}>{pick.pos}</span>
                                                    </div>
                                                ) : isCurrent ? (
                                                    <span style={{
                                                        color: 'var(--gold)',
                                                        fontWeight: 800,
                                                        fontSize: 'var(--text-body, 1rem)',
                                                        animation: 'wrFadeIn 0.8s ease infinite alternate',
                                                    }}>•••</span>
                                                ) : (
                                                    <span style={{ color: 'var(--ov-6, rgba(255,255,255,0.12))', fontSize: 'var(--text-label, 0.75rem)' }}>
                                                        #{slot?.overall || ''}
                                                    </span>
                                                )}
                                                {traded && (
                                                    <span style={{
                                                        position: 'absolute',
                                                        top: 1,
                                                        right: 1,
                                                        fontSize: 'var(--text-label, 0.75rem)',
                                                        color: 'var(--k-f0a500, #f0a500)',
                                                        fontWeight: 700,
                                                    }}>↔</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* On The Clock card */}
                {onTheClock && state.phase === 'drafting' && (
                    <div style={{
                        marginTop: '8px',
                        padding: '10px 12px',
                        background: onTheClock.isUser
                            ? 'linear-gradient(90deg, var(--acc-fill3, rgba(212,175,55,0.18)), var(--acc-fill1, rgba(212,175,55,0.04)))'
                            : 'var(--ov-2, rgba(255,255,255,0.03))',
                        border: '1px solid ' + (onTheClock.isUser ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                    }}>
                        {/* Avatar */}
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                            {onTheClock.avatar ? (
                                <img
                                    src={onTheClock.avatar}
                                    style={{ width: 42, height: 42, borderRadius: '50%', objectFit: 'cover', border: '2px solid ' + (onTheClock.isUser ? 'var(--gold)' : 'var(--acc-line2, rgba(212,175,55,0.3))') }}
                                    onError={e => e.target.style.display = 'none'}
                                    alt=""
                                />
                            ) : (
                                <div style={{
                                    width: 42, height: 42, borderRadius: '50%',
                                    background: 'var(--charcoal)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontWeight: 700,
                                    border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))',
                                    fontFamily: FONT_DISPL,
                                }}>{(onTheClock.teamName || '?').charAt(0)}</div>
                            )}
                            {onTheClock.isUser && (
                                <span style={{
                                    position: 'absolute', top: -2, right: -2,
                                    width: 10, height: 10,
                                    borderRadius: '50%',
                                    background: 'var(--k-2ecc71, #2ecc71)',
                                    border: '2px solid var(--black)',
                                    animation: 'pulse 1.2s infinite',
                                }} />
                            )}
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 800,
                                color: 'var(--gold)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1em',
                                fontFamily: FONT_UI,
                            }}>{onTheClock.isUser ? 'YOU ARE ON THE CLOCK' : 'ON THE CLOCK'}</div>
                            <div style={{
                                fontSize: 'var(--text-body, 1rem)',
                                fontWeight: 700,
                                color: 'var(--white)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                fontFamily: FONT_DISPL,
                                letterSpacing: '0.02em',
                            }}>{onTheClock.teamName}</div>
                            <div style={{ display: 'flex', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.7 }}>
                                    R{currentSlot.round} · Pick #{currentSlot.overall}
                                </span>
                                {onTheClock.dnaLabel && onTheClock.dnaLabel !== 'Balanced' && (
                                    <span style={{
                                        fontSize: 'var(--text-label, 0.75rem)',
                                        fontWeight: 700,
                                        color: 'var(--gold)',
                                        padding: '0 5px',
                                        borderRadius: '3px',
                                        background: 'var(--acc-fill3, rgba(212,175,55,0.15))',
                                        border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))',
                                    }}>DRAFT DNA: {onTheClock.dnaLabel}</span>
                                )}
                                {onTheClock.tradeDna && onTheClock.tradeDna !== 'Balanced' && onTheClock.tradeDna !== '— Not Set —' && (
                                    <span style={{
                                        fontSize: 'var(--text-label, 0.75rem)',
                                        fontWeight: 700,
                                        color: onTheClock.tradeDnaColor,
                                        padding: '0 5px',
                                        borderRadius: '3px',
                                        background: wrAlpha(onTheClock.tradeDnaColor, '15'),
                                        border: '1px solid ' + wrAlpha(onTheClock.tradeDnaColor, '40'),
                                    }}>{onTheClock.tradeDna}</span>
                                )}
                                {onTheClock.posture && onTheClock.posture !== 'Neutral' && (
                                    <span style={{
                                        fontSize: 'var(--text-label, 0.75rem)',
                                        fontWeight: 700,
                                        color: onTheClock.postureColor,
                                        padding: '0 5px',
                                        borderRadius: '3px',
                                        background: wrAlpha(onTheClock.postureColor, '15'),
                                        border: '1px solid ' + wrAlpha(onTheClock.postureColor, '40'),
                                    }}>{onTheClock.posture}</span>
                                )}
                                {state.overrideMode && !onTheClock.isUser && (
                                    <span style={{
                                        fontSize: 'var(--text-label, 0.75rem)',
                                        fontWeight: 700,
                                        color: 'var(--k-ffffff, #ffffff)',
                                        padding: '1px 6px',
                                        borderRadius: '3px',
                                        background: 'var(--k-9b8afb, #9b8afb)',
                                        animation: 'pulse 1.4s infinite',
                                    }}>🎮 OVERRIDE ACTIVE</span>
                                )}
                            </div>
                        </div>

                        {/* Phase 5: Override pick button — only for CPU turns in solo/scenario modes */}
                        {!onTheClock.isUser && state.mode !== 'live-sync' && state.mode !== 'ghost' && (
                            <button
                                onClick={() => dispatch({ type: 'SET_OVERRIDE', enabled: !state.overrideMode })}
                                title={state.overrideMode ? 'Return control to the CPU' : 'Pick for this CPU team from the Big Board'}
                                style={{
                                    padding: '6px 12px',
                                    minHeight: '44px',
                                    fontSize: 'var(--text-label, 0.75rem)',
                                    fontFamily: FONT_UI,
                                    fontWeight: 700,
                                    background: state.overrideMode ? 'var(--k-9b8afb, #9b8afb)' : 'rgba(124,107,248,0.12)',
                                    color: state.overrideMode ? 'var(--k-ffffff, #ffffff)' : 'rgba(155,138,251,0.9)',
                                    border: '1px solid ' + (state.overrideMode ? 'var(--k-9b8afb, #9b8afb)' : 'rgba(124,107,248,0.3)'),
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    flexShrink: 0,
                                    letterSpacing: '0.04em',
                                    textTransform: 'uppercase',
                                }}
                            >{state.overrideMode ? '✓ Override' : '🎮 Override'}</button>
                        )}
                    </div>
                )}
            </div>
        );
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.DraftGridPanel = DraftGridPanel;
})();
