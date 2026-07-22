// ══════════════════════════════════════════════════════════════════
// js/draft/alex-stream.js — Alex Commentary panel (Phase 4 cinematic)
//
// Commentary feed + "Ask Alex" input + Sonnet budget tracker + per-pick
// "Explain" modal. AI events are pushed by command-center via ALEX_EVENT_ADD
// and ALEX_SPEND_SONNET reducer actions. This component is mostly a view
// over state.alex.stream.
//
// Depends on: styles.js, state.js, window.dhqAI (for Ask Alex input)
// Exposes:    window.DraftCC.AlexStreamPanel
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, panelCard } = window.DraftCC.styles;

    // High-signal room events (run / tier break / value cliff). Module-scoped and
    // exported so the header "Alex Whisper" shares the exact same gate (no dupes).
    const HIGH_SIGNAL = new Set(['🔥', '⛰', '⬇', '🔄']);

    const CHIP_PROMPTS = [
        { label: 'Who should I target?',  text: 'Who should I target with my next pick given the current board?' },
        { label: 'Is this a reach?',       text: 'Was my last pick a reach? Explain.' },
        { label: 'What do they want?',     text: 'Based on the pinned team\'s DNA and needs, what position are they targeting?' },
        { label: 'Build strategy',         text: 'Given my picks so far, what positions should I prioritize for the remainder?' },
    ];

    function AlexStreamPanel({ state, dispatch }) {
        const [inputValue, setInputValue] = React.useState('');
        const [pendingAsk, setPendingAsk] = React.useState(false);
        const [expandedIds, setExpandedIds] = React.useState(() => new Set());
        const streamEndRef = React.useRef(null);

        // Phase 7 deferred: listen for `wr:scouting-generate` events dispatched by the
        // big-board / draft-room scouting buttons. Inject the scouting report directly
        // into the AlexStream feed instead of opening the separate Alex chat panel.
        React.useEffect(() => {
            const handler = (e) => {
                const { playerName, pos, summary, text, fullText } = e.detail || {};
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'scouting',
                        badge: '🔎',
                        color: 'var(--k-9b8afb, #9b8afb)',
                        title: playerName ? ('Scouting Report — ' + playerName + (pos ? ' (' + pos + ')' : '')) : 'Scouting Report',
                        text: summary || text || 'Scouting report ready. Tap to expand.',
                        fullText: fullText || text || summary || '',
                        expandable: true,
                    },
                });
            };
            window.addEventListener('wr:scouting-generate', handler);
            return () => window.removeEventListener('wr:scouting-generate', handler);
        }, [dispatch]);

        const alexSpend = state.alex?.alexSpend || {};
        const budget = alexSpend.budget || 12;
        const sonnetUsed = alexSpend.sonnet || 0;
        const flashUsed = alexSpend.flash || 0;
        const budgetPct = (sonnetUsed / budget) * 100;
        const budgetCol =
            sonnetUsed >= budget ? 'var(--k-e74c3c, #e74c3c)' :
            sonnetUsed >= budget * 0.7 ? 'var(--k-f0a500, #f0a500)' : 'var(--k-2ecc71, #2ecc71)';

        // Send an "Ask Alex" request via Gemini Flash (draft-chat route)
        const sendAsk = async (text) => {
            if (!text || pendingAsk) return;
            if (typeof window.dhqAI !== 'function') {
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'user',
                        badge: '?',
                        color: 'var(--k-e74c3c, #e74c3c)',
                        title: 'AI unavailable',
                        text: 'dhqAI is not loaded. Try reloading the page.',
                    },
                });
                return;
            }

            // Add the user's question to the stream immediately
            dispatch({
                type: 'ALEX_EVENT_ADD',
                event: {
                    type: 'user',
                    badge: '?',
                    color: 'var(--k-9b8afb, #9b8afb)',
                    title: 'You asked',
                    text,
                },
            });

            setInputValue('');
            setPendingAsk(true);
            dispatch({ type: 'ALEX_SET_THINKING', thinking: true });

            try {
                // Rich, board-aware context (shared with the Ask windows),
                // plus the format/quality preamble the generic AI path lacks.
                const contextLines = (window.WR?.AIContext?.buildFormatPreamble?.(window.S?.currentLeague) || '')
                    + (window.DraftCC.buildAskContext
                        ? window.DraftCC.buildAskContext(state)
                        : '');

                // Pass the bare question as the message; dhqAI injects the
                // context itself, so don't duplicate it into the message.
                const messages = [{ role: 'user', content: text }];
                const response = await window.dhqAI('draft-chat', text, contextLines, { messages });
                dispatch({ type: 'ALEX_SPEND_FLASH' });
                window.OD?.track?.('alex_response_actioned', {
                    platform: 'warroom',
                    module: 'draft',
                    leagueId: window.S?.currentLeagueId || null,
                    entityType: 'ai_call',
                    entityId: 'draft-chat',
                    metadata: { action: 'draft_alex_asked', quickPrompt: CHIP_PROMPTS.some(p => p.text === text) },
                });

                const replyText = typeof response === 'string' ? response : (response?.content || response?.text || JSON.stringify(response));
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'ai',
                        badge: '✦',
                        color: 'var(--gold)',
                        title: 'Alex',
                        text: replyText,
                        fullText: replyText,
                        expandable: replyText.length > 160,
                    },
                });
            } catch (e) {
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'user',
                        badge: '!',
                        color: 'var(--k-e74c3c, #e74c3c)',
                        title: 'Alex error',
                        text: String(e?.message || e).slice(0, 200),
                    },
                });
                if (window.wrLog) window.wrLog('alex.ask', e);
            } finally {
                setPendingAsk(false);
                dispatch({ type: 'ALEX_SET_THINKING', thinking: false });
            }
        };

        const onSubmitAsk = (e) => {
            e.preventDefault();
            if (inputValue.trim()) sendAsk(inputValue.trim());
        };

        const containerCss = panelCard({
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 12px',
            overflow: 'hidden',
        });

        const stream = React.useMemo(() => {
            const seen = new Set();
            return (state.alex?.stream || []).filter(item => {
                const key = [
                    item.type || '',
                    String(item.title || '').toLowerCase(),
                    String(item.text || '').toLowerCase(),
                ].join('|');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }, [state.alex?.stream]);

        // The Alex draft layer (live commentary, room reads, Ask Alex draft chat)
        // is Scout Pro. Free gets a locked panel shell — the input/chips never
        // render, so no draft-chat AI call can be triggered (BYOK included).
        // Placed after every hook so the hook order stays stable across tiers.
        if (typeof window.wrIsPro === 'function' && !window.wrIsPro()) {
            const GatedRow = window.WrGatedMoreRow;
            return (
                <div style={containerCss}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', flexShrink: 0 }}>
                        <div style={{ fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                            Alex Stream
                        </div>
                    </div>
                    {GatedRow
                        ? <GatedRow title="Alex calls your draft live" sub="Live commentary, room reads, and Ask Alex draft chat are Scout Pro." feature="draft_alex_stream" />
                        : <div dangerouslySetInnerHTML={{ __html: window.wrLockCard ? window.wrLockCard('Alex Stream', 'draft_alex_stream', 'Live draft commentary is Scout Pro.') : '' }} />}
                </div>
            );
        }

        return (
            <div style={containerCss}>
                {/* Header with budget */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', flexShrink: 0 }}>
                    <div style={{ fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                        Alex Stream
                    </div>
                    <span title={`Auto Alex notes: ${sonnetUsed}/${budget} per draft${sonnetUsed >= budget ? ' — used up; Ask Alex still works' : ''} · Quick replies: ${flashUsed}`} style={{
                        fontSize: 'var(--text-label, 0.75rem)',
                        padding: '1px 6px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid ' + wrAlpha(budgetCol, '44'),
                        borderRadius: '3px',
                        color: budgetCol,
                        fontFamily: FONT_MONO_SAFE(),
                        fontWeight: 600,
                    }}>
                        AI notes {sonnetUsed >= budget ? 'maxed' : `${sonnetUsed}/${budget}`}
                    </span>
                </div>

                {/* Stream feed */}
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', paddingRight: '3px', marginBottom: '6px' }}>
                    {state.alex?.thinking && (
                        <div style={{
                            padding: '5px 8px',
                            fontSize: 'var(--text-label, 0.75rem)',
                            color: 'var(--gold)',
                            fontStyle: 'italic',
                            opacity: 0.7,
                            fontFamily: FONT_UI,
                        }}>
                            Alex is thinking<AnimatedDots />
                        </div>
                    )}
                    {stream.length === 0 && !state.alex?.thinking && (
                        <div style={{
                            padding: '20px 10px',
                            textAlign: 'center',
                            color: 'var(--silver)',
                            opacity: 0.4,
                            fontSize: 'var(--text-label, 0.75rem)',
                            fontFamily: FONT_UI,
                        }}>
                            Alex's commentary will<br />appear here during the draft
                        </div>
                    )}
                    {stream.map(item => {
                        const isExpandable = !!item.expandable;
                        const isExpanded = isExpandable && expandedIds.has(item.id);
                        const toggle = () => {
                            if (!isExpandable) return;
                            setExpandedIds(prev => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else {
                                    next.add(item.id);
                                    window.OD?.track?.('alex_response_actioned', {
                                        platform: 'warroom',
                                        module: 'draft',
                                        leagueId: window.S?.currentLeagueId || null,
                                        entityType: 'ai_response',
                                        entityId: item.id,
                                        metadata: { action: 'expand_stream_item', itemType: item.type || null },
                                    });
                                }
                                return next;
                            });
                        };
                        // Shared AI-text formatter (bold + spacing + dividers),
                        // so draft commentary reads like every other AI surface.
                        const fmtAI = (window.WR && window.WR.formatAI) ? window.WR.formatAI : (x => String(x == null ? '' : x));
                        const textClamp = isExpandable && !isExpanded ? {
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                        } : {};
                        const fullTextBlocks = String(item.fullText || '')
                            .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/)
                            .map(part => part.trim())
                            .filter(Boolean)
                            .slice(0, 8);
                        // High-signal room events get a colored left accent + faint
                        // tint so they pop (HIGH_SIGNAL is module-scoped, see top).
                        const isHighlight = HIGH_SIGNAL.has(item.badge);
                        return (
                            <div key={item.id} onClick={toggle} style={{
                                display: 'flex',
                                gap: '6px',
                                padding: '6px 4px 6px ' + (isHighlight ? '6px' : '4px'),
                                borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.025))',
                                borderLeft: isHighlight ? '2px solid ' + wrAlpha(item.color, 'aa') : '2px solid transparent',
                                fontFamily: FONT_UI,
                                cursor: isExpandable ? 'pointer' : 'default',
                                background: isExpanded
                                    ? 'rgba(124,107,248,0.06)'
                                    : (isHighlight ? wrAlpha(item.color, '12') : 'transparent'),
                            }}>
                                <span style={{
                                    color: item.color,
                                    fontSize: 'var(--text-label, 0.75rem)',
                                    fontWeight: 700,
                                    width: 10,
                                    textAlign: 'center',
                                    flexShrink: 0,
                                    marginTop: '1px',
                                }}>{item.badge}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: 'var(--text-label, 0.75rem)',
                                        fontWeight: 700,
                                        color: 'var(--white)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                    }}>
                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
                                        {isExpandable && (
                                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', opacity: 0.6, color: item.color }}>{isExpanded ? '▾' : '▸'}</span>
                                        )}
                                    </div>
                                    {item.text && (
                                        <div style={{
                                            fontSize: 'var(--text-label, 0.75rem)',
                                            color: 'var(--silver)',
                                            opacity: 0.8,
                                            marginTop: '1px',
                                            lineHeight: 1.5,
                                            wordBreak: 'break-word',
                                            ...textClamp,
                                        }} dangerouslySetInnerHTML={{ __html: fmtAI(item.text) }} />
                                    )}
                                    {isExpanded && item.fullText && item.fullText !== item.text && (
                                        <div style={{
                                            marginTop: '4px',
                                            display: 'grid',
                                            gap: '4px',
                                        }}>
                                            {fullTextBlocks.map((block, bi) => (
                                                <div key={bi} style={{
                                                    fontSize: 'var(--text-label, 0.75rem)',
                                                    color: 'var(--silver)',
                                                    opacity: 0.85,
                                                    lineHeight: 1.5,
                                                    wordBreak: 'break-word',
                                                    whiteSpace: 'normal',
                                                    border: '1px solid var(--ov-4, rgba(255,255,255,0.055))',
                                                    borderRadius: 'var(--card-radius-sm)',
                                                    padding: '5px 6px',
                                                    background: 'var(--ov-1, rgba(255,255,255,0.018))',
                                                }} dangerouslySetInnerHTML={{ __html: fmtAI(block) }} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={streamEndRef} />
                </div>

                {/* Ask Alex chips — open a dedicated, dismissible answer window
                    instead of posting into this shared stream. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '5px', flexShrink: 0 }}>
                    {CHIP_PROMPTS.map(chip => (
                        <button
                            key={chip.label}
                            onClick={() => window.dispatchEvent(new CustomEvent('wr:ask-open', {
                                detail: { title: chip.label, prompt: chip.text },
                            }))}
                            style={{
                                fontSize: 'var(--text-label)',
                                padding: '3px 6px',
                                minHeight: '44px',
                                background: 'rgba(124,107,248,0.08)',
                                border: '1px solid rgba(124,107,248,0.2)',
                                color: 'rgba(155,138,251,0.9)',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                fontFamily: FONT_UI,
                            }}
                        >{chip.label}</button>
                    ))}
                </div>

                {/* Ask Alex input */}
                <form onSubmit={onSubmitAsk} style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <input
                        type="text"
                        placeholder="Ask Alex…"
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        disabled={pendingAsk}
                        style={{
                            flex: 1,
                            padding: '5px 8px',
                            minHeight: '44px',
                            background: 'var(--ov-2, rgba(255,255,255,0.03))',
                            border: '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                            borderRadius: '4px',
                            color: 'var(--white)',
                            fontSize: 'var(--text-label)',
                            fontFamily: FONT_UI,
                            outline: 'none',
                            minWidth: 0,
                        }}
                    />
                    <button
                        type="submit"
                        disabled={pendingAsk || !inputValue.trim()}
                        style={{
                            padding: '5px 10px',
                            minHeight: '44px',
                            background: (pendingAsk || !inputValue.trim()) ? 'var(--acc-line2, rgba(212,175,55,0.3))' : 'var(--gold)',
                            color: 'var(--black)',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: 'var(--text-label)',
                            fontWeight: 700,
                            cursor: (pendingAsk || !inputValue.trim()) ? 'not-allowed' : 'pointer',
                            fontFamily: FONT_UI,
                        }}
                    >{pendingAsk ? '…' : 'ASK'}</button>
                </form>
            </div>
        );
    }

    // Animated "…" for thinking state
    function AnimatedDots() {
        const [n, setN] = React.useState(0);
        React.useEffect(() => {
            const id = setInterval(() => setN(x => (x + 1) % 4), 400);
            return () => clearInterval(id);
        }, []);
        return <span>{'.'.repeat(n)}</span>;
    }

    function FONT_MONO_SAFE() {
        return window.DraftCC?.styles?.FONT_MONO || "'JetBrains Mono', monospace";
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.AlexStreamPanel = AlexStreamPanel;
    window.DraftCC.AnimatedDots = AnimatedDots;
    window.DraftCC.HIGH_SIGNAL_BADGES = HIGH_SIGNAL;
})();
