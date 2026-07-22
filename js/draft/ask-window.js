// ══════════════════════════════════════════════════════════════════
// js/draft/ask-window.js — Floating "Ask Alex" answer window
//
// One-shot AI action buttons (the quick-prompt chips, etc.) open a
// dedicated, dismissible window over the draft board instead of dumping
// their answer into the shared Alex stream. Clone of the TradeModal
// pattern: fixed position, backdrop, × close. One window at a time —
// opening another replaces the current one.
//
// Also exposes a SHARED rich-context builder (buildAskContext) used by
// both this window and the free-text chat in alex-stream.js, so the AI
// actually sees the board, roster needs, and league settings.
//
// Open a window from anywhere:
//   window.dispatchEvent(new CustomEvent('wr:ask-open',
//     { detail: { title: 'Who should I target?', prompt: '…' } }));
//
// Depends on: styles.js, window.dhqAI
// Exposes:    window.DraftCC.AskAnswerWindow, window.DraftCC.buildAskContext
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL } = window.DraftCC.styles;

    // ── Shared context builder ──────────────────────────────────────
    // Turns the live draft state into a rich, specific context block so
    // the model can give board-aware advice ("At 1.05 target the best
    // RB…") instead of generic filler.
    function buildAskContext(state) {
        if (!state) return '';
        const lines = [];

        // League format
        const lf = state.draftContext?.leagueFormat || {};
        const fmt = [];
        if (lf.teams) fmt.push(`${lf.teams}-team`);
        fmt.push(lf.flags?.superflex ? 'Superflex' : '1-QB');
        if (lf.scoring?.ppr) {
            fmt.push(lf.scoring.ppr === 'ppr' ? 'Full PPR' : lf.scoring.ppr === 'half_ppr' ? 'Half PPR' : 'Standard');
        }
        if (lf.flags?.tePremium) fmt.push('TE-premium');
        if (lf.draftType) fmt.push(`${lf.draftType} draft`);
        if (fmt.length) lines.push(`League: ${fmt.join(', ')}.`);

        // Multi-copy leagues (MFL): a player can be rostered by several teams, so a
        // "drafted" stud may STILL be available until all copies are gone. Alex must
        // factor remaining copies into targeting, runs, and "is he gone?" calls.
        const copies = Math.max(1, Number(state.playerCopies) || 1);
        if (copies > 1) {
            lines.push(`MULTI-COPY DRAFT: each player can be drafted by up to ${copies} different teams. A player is only truly gone once all ${copies} copies are taken — do NOT treat a player as unavailable after a single team drafts him. Weigh how many copies remain when judging runs, scarcity, and who to target.`);
        }

        // On the clock
        const slot = state.pickOrder?.[state.currentIdx];
        if (slot) {
            lines.push(`On the clock: Round ${slot.round}, pick ${slot.overall} of ${state.pickOrder.length}.`);
        }

        // My roster so far + position counts
        const myPicks = (state.picks || []).filter(
            p => p.isUser || String(p.rosterId) === String(state.userRosterId)
        );
        if (myPicks.length) {
            lines.push(`My roster so far (${myPicks.length}): ${myPicks.map(p => `${p.pos} ${p.name}`).join(', ')}.`);
            const counts = {};
            myPicks.forEach(p => { const k = (p.pos || '?').toUpperCase(); counts[k] = (counts[k] || 0) + 1; });
            lines.push(`My position counts: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
        } else {
            lines.push('My roster so far: no picks yet.');
        }

        // Flagged needs (from persona assessment or team context)
        const needs = (state.personas?.[state.userRosterId]?.assessment?.needs
            || state.draftContext?.teamContext?.needs || [])
            .map(n => (typeof n === 'string' ? n : n?.pos))
            .filter(Boolean);
        if (needs.length) lines.push(`Flagged roster needs: ${needs.join(', ')}.`);

        // Top available on the board (the single most important context)
        const drafted = state.draftedPids || {};
        const top = (state.pool || []).slice(0, 15).map((p, i) => {
            const val = Math.round(p.dhq || p.val || 0);
            const age = p.age ? `, age ${p.age}` : '';
            const taken = drafted[p.pid] || 0;
            const copyNote = copies > 1 ? `, ${Math.max(0, copies - taken)}/${copies} copies left` : '';
            return `${i + 1}. ${p.name} (${p.pos}${p.team ? '-' + p.team : ''}, DHQ ${val}${age}${copyNote})`;
        });
        if (top.length) lines.push(`Top available players right now:\n${top.join('\n')}`);

        // Pinned opponent (if the user is watching a specific team)
        if (state.pinnedRosterId) {
            const per = state.personas?.[state.pinnedRosterId];
            if (per) {
                lines.push(`Pinned opponent: ${per.teamName || 'team'} — DNA ${per.draftDna?.label || '?'}, posture ${per.posture?.label || '?'}.`);
            }
        }

        return lines.filter(Boolean).join('\n');
    }

    // ── Lightweight rich-text renderer ──────────────────────────────
    // Handles **bold**, bullet/numbered lines, and paragraph spacing so
    // the board breakdowns render readably without a markdown lib.
    function renderRichText(text) {
        const raw = String(text || '');
        const lines = raw.split(/\r?\n/);
        const nodes = [];
        lines.forEach((line, i) => {
            const trimmed = line.trim();
            if (!trimmed) { nodes.push(<div key={'sp' + i} style={{ height: 6 }} />); return; }
            const isBullet = /^([-*•]|\d+[.)])\s+/.test(trimmed);
            const body = trimmed.replace(/^([-*•]|\d+[.)])\s+/, '');
            // Split on **bold**
            const segs = body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((seg, j) => {
                if (/^\*\*[^*]+\*\*$/.test(seg)) {
                    return <strong key={j} style={{ color: 'var(--white)', fontWeight: 700 }}>{seg.slice(2, -2)}</strong>;
                }
                return <span key={j}>{seg}</span>;
            });
            nodes.push(
                <div key={'ln' + i} style={{
                    display: 'flex',
                    gap: isBullet ? 6 : 0,
                    marginBottom: 3,
                    lineHeight: 1.5,
                }}>
                    {isBullet && <span style={{ color: 'var(--gold)', flexShrink: 0 }}>
                        {/^\d/.test(trimmed) ? trimmed.match(/^\d+/)[0] + '.' : '•'}
                    </span>}
                    <span style={{ flex: 1 }}>{segs}</span>
                </div>
            );
        });
        return nodes;
    }

    // ── Printable HTML for "Download PDF" (opens a tab → print-to-PDF) ──
    function reportToHtml(title, text) {
        const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        const lines = String(text || '').split(/\r?\n/);
        let body = '';
        let inList = false;
        const closeList = () => { if (inList) { body += '</ul>'; inList = false; } };
        lines.forEach(raw => {
            const t = raw.trim();
            if (!t) { closeList(); return; }
            const h = t.match(/^(#{1,4})\s+(.*)$/);
            if (h) { closeList(); const lvl = Math.min(h[1].length + 1, 4); body += '<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'; return; }
            if (/^([-*•]|\d+[.)])\s+/.test(t)) {
                if (!inList) { body += '<ul>'; inList = true; }
                body += '<li>' + inline(t.replace(/^([-*•]|\d+[.)])\s+/, '')) + '</li>';
                return;
            }
            closeList();
            body += '<p>' + inline(t) + '</p>';
        });
        closeList();
        const safeTitle = esc(title || 'Report');
        return '<!doctype html><html><head><meta charset="utf-8"><title>' + safeTitle + '</title>'
            + '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:48px auto;padding:0 28px;color:#15171a;line-height:1.6}'
            + 'h1{font-size:22px;margin:0 0 4px}h2,h3,h4{margin:22px 0 6px;color:#0d0f12}'
            + 'ul{margin:6px 0;padding-left:20px}li{margin:3px 0}p{margin:8px 0}'
            + '.meta{color:#6b7280;font-size:12px;margin-bottom:16px}hr{border:0;border-top:1px solid #e5e7eb;margin:14px 0}'
            + '@media print{body{margin:0;max-width:none}}</style></head><body>'
            + '<h1>' + safeTitle + '</h1>'
            + '<div class="meta">Alex · Draft War Room — ' + esc(new Date().toLocaleString()) + '</div><hr/>'
            + body + '</body></html>';
    }

    // ── The floating answer window ──────────────────────────────────
    function AskAnswerWindow({ state }) {
        const [open, setOpen] = React.useState(false);
        const [title, setTitle] = React.useState('');
        const [prompt, setPrompt] = React.useState('');
        const [pending, setPending] = React.useState(false);
        const [answer, setAnswer] = React.useState('');
        const [error, setError] = React.useState('');
        const [kind, setKind] = React.useState('report');
        const [minimized, setMinimized] = React.useState(false);
        const [saved, setSaved] = React.useState(false);
        const [saving, setSaving] = React.useState(false);

        // Keep the freshest state available to the (async) event handler.
        const stateRef = React.useRef(state);
        stateRef.current = state;

        const leagueId = () => window.S?.currentLeagueId || null;

        const close = React.useCallback(() => {
            setOpen(false);
            setAnswer('');
            setError('');
            setPending(false);
            setMinimized(false);
            setSaved(false);
            try { window.dispatchEvent(new CustomEvent('wr:ask-closed')); } catch (_) {}
        }, []);

        // Run one AI call for the given prompt/title.
        const ask = React.useCallback(async (askTitle, askPrompt, askKind) => {
            setOpen(true);
            setMinimized(false);
            setSaved(false);
            setKind(askKind || 'report');
            setTitle(askTitle || 'Ask Alex');
            setPrompt(askPrompt || '');
            setAnswer('');
            setError('');

            if (typeof window.dhqAI !== 'function') {
                setError('AI engine is not loaded. Try reloading the page.');
                return;
            }
            setPending(true);
            try {
                const context = (window.WR?.AIContext?.buildFormatPreamble?.(window.S?.currentLeague) || '')
                    + buildAskContext(stateRef.current);
                const response = await window.dhqAI('draft-chat', askPrompt, context);
                const text = typeof response === 'string'
                    ? response
                    : (response?.content || response?.text || JSON.stringify(response));
                setAnswer(text);
                window.OD?.track?.('alex_response_actioned', {
                    platform: 'warroom',
                    module: 'draft',
                    leagueId: window.S?.currentLeagueId || null,
                    entityType: 'ai_call',
                    entityId: 'draft-chat',
                    metadata: { action: 'draft_ask_window', title: askTitle || null },
                });
            } catch (e) {
                setError(String(e?.message || e).slice(0, 240));
                if (window.wrLog) window.wrLog('ask.window', e);
            } finally {
                setPending(false);
            }
        }, []);

        // Display a previously-saved report without re-running the AI.
        const showSaved = React.useCallback((d) => {
            d = d || {};
            setOpen(true);
            setMinimized(false);
            setPending(false);
            setError('');
            setSaved(true);
            setKind(d.kind || 'report');
            setTitle(d.title || 'Report');
            setPrompt(d.prompt || '');
            setAnswer(d.answer || d.content || '');
        }, []);

        const doSave = React.useCallback(async () => {
            if (!answer || saving) return;
            setSaving(true);
            try {
                if (window.WR?.SavedReports?.save) {
                    await window.WR.SavedReports.save(leagueId(), { title, prompt, content: answer, kind });
                }
                setSaved(true);
                window.dispatchEvent(new CustomEvent('wr:report-saved', { detail: { leagueId: leagueId() } }));
            } catch (e) {
                if (window.wrLog) window.wrLog('ask.save', e);
            } finally {
                setSaving(false);
            }
        }, [answer, saving, title, prompt, kind]);

        const doPdf = React.useCallback(() => {
            if (!answer) return;
            const w = window.open('', '_blank');
            if (!w) return;
            w.document.write(reportToHtml(title, answer));
            w.document.close();
            w.focus();
            setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 350);
        }, [answer, title]);

        const doEmail = React.useCallback(async () => {
            if (!answer) return;
            if (navigator.share) {
                try { await navigator.share({ title: title || 'Draft Report', text: answer }); return; }
                catch (e) { /* fall back to mailto */ }
            }
            const subject = encodeURIComponent(title || 'Draft Report');
            const body = encodeURIComponent(answer.slice(0, 1800) + (answer.length > 1800 ? '\n\n…(truncated)' : ''));
            window.location.href = 'mailto:?subject=' + subject + '&body=' + body;
        }, [answer, title]);

        // Listen for open + show requests from any action button.
        React.useEffect(() => {
            const onOpen = (e) => {
                // Draft AI reports are Scout Pro. Entry buttons are already
                // Pro-gated; this backstops stray wr:ask-open dispatches (deep
                // links, stale listeners) so free routes to the upsell instead
                // of a dhqAI call (BYOK would bypass the server tripwire).
                if (typeof window.wrIsPro === 'function' && !window.wrIsPro()) {
                    if (window.showProLaunchPage) window.showProLaunchPage();
                    else if (window.showUpgradePrompt) window.showUpgradePrompt('draft_ai_reports');
                    return;
                }
                const { title: t, prompt: p, kind: k } = e.detail || {};
                ask(t, p, k);
            };
            const onShow = (e) => showSaved(e.detail);
            window.addEventListener('wr:ask-open', onOpen);
            window.addEventListener('wr:ask-show', onShow);
            return () => {
                window.removeEventListener('wr:ask-open', onOpen);
                window.removeEventListener('wr:ask-show', onShow);
            };
        }, [ask, showSaved]);

        // Escape closes the window.
        React.useEffect(() => {
            if (!open) return;
            const onKey = (e) => { if (e.key === 'Escape') close(); };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        }, [open, close]);

        const actionBtnStyle = (active) => ({
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            padding: '6px 11px',
            background: active ? 'var(--acc-fill3, rgba(212,175,55,0.16))' : 'var(--ov-3, rgba(255,255,255,0.05))',
            border: '1px solid ' + (active ? 'var(--gold)' : 'var(--ov-6, rgba(255,255,255,0.12))'),
            borderRadius: '7px',
            color: active ? 'var(--gold)' : 'var(--silver)',
            fontSize: 'var(--text-label, 0.78rem)', fontFamily: FONT_UI, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap',
        });

        if (!open) return null;

        // Minimized: collapse to a restore pill so the report stays available
        // without blocking the page (no backdrop).
        if (minimized) {
            return (
                <button
                    onClick={() => setMinimized(false)}
                    title="Restore report"
                    style={{
                        position: 'fixed', bottom: 'calc(20px + var(--wr-bottom-inset, 0px))', left: '20px', zIndex: 600,
                        display: 'flex', alignItems: 'center', gap: '8px',
                        maxWidth: 'min(320px, 80vw)',
                        padding: '8px 12px',
                        background: 'linear-gradient(180deg, var(--k-14121c, #14121c) 0%, var(--k-0d0b12, #0d0b12) 100%)',
                        border: '1px solid rgba(124,107,248,0.4)',
                        borderRadius: '10px',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
                        color: 'var(--gold)', cursor: 'pointer', fontFamily: FONT_UI,
                    }}
                >
                    <span style={{ color: 'var(--k-9b8afb, #9b8afb)', flexShrink: 0 }}>✦</span>
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700, fontSize: 'var(--text-label, 0.8rem)' }}>{title || 'Alex report'}</span>
                    <span style={{ color: 'var(--silver)', opacity: 0.6, fontSize: 'var(--text-label, 0.75rem)', flexShrink: 0 }}>{pending ? '…' : '⤢'}</span>
                </button>
            );
        }

        return (
            <div
                onClick={close}
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 600,
                    background: 'rgba(0,0,0,0.62)',
                    backdropFilter: 'blur(2px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '16px',
                    fontFamily: FONT_UI,
                }}
            >
                <div
                    onClick={e => e.stopPropagation()}
                    style={{
                        width: 'min(820px, 94vw)',
                        maxHeight: '88vh',
                        display: 'flex',
                        flexDirection: 'column',
                        background: 'linear-gradient(180deg, var(--k-14121c, #14121c) 0%, var(--k-0d0b12, #0d0b12) 100%)',
                        border: '1px solid rgba(124,107,248,0.32)',
                        borderRadius: '12px',
                        boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
                        overflow: 'hidden',
                    }}
                >
                    {/* Header */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '12px 14px',
                        borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                        flexShrink: 0,
                    }}>
                        <span style={{ fontSize: '1rem', color: 'var(--k-9b8afb, #9b8afb)' }}>✦</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontFamily: FONT_DISPL,
                                fontSize: 'var(--text-body, 1rem)',
                                fontWeight: 700,
                                color: 'var(--gold)',
                                letterSpacing: '0.04em',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}>{title}</div>
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                Alex · Draft War Room
                            </div>
                        </div>
                        <button
                            onClick={() => setMinimized(true)}
                            aria-label="Minimize"
                            title="Minimize — keep available"
                            style={{
                                width: 26, height: 26,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'var(--ov-3, rgba(255,255,255,0.05))',
                                border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                borderRadius: '6px',
                                color: 'var(--silver)',
                                fontSize: 'var(--text-body, 1rem)',
                                cursor: 'pointer',
                                flexShrink: 0,
                            }}
                        >−</button>
                        <button
                            onClick={close}
                            aria-label="Close"
                            style={{
                                width: 26, height: 26,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'var(--ov-3, rgba(255,255,255,0.05))',
                                border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                borderRadius: '6px',
                                color: 'var(--silver)',
                                fontSize: 'var(--text-body, 1rem)',
                                cursor: 'pointer',
                                flexShrink: 0,
                            }}
                        >×</button>
                    </div>

                    {/* Body */}
                    <div style={{ padding: '14px', overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
                        {pending && (
                            <div style={{ color: 'var(--gold)', fontSize: 'var(--text-label, 0.75rem)', fontStyle: 'italic', opacity: 0.8 }}>
                                Alex is thinking<AnimatedDots />
                            </div>
                        )}
                        {!pending && error && (
                            <div style={{ color: 'var(--k-e74c3c, #e74c3c)', fontSize: 'var(--text-label, 0.75rem)', lineHeight: 1.5 }}>
                                {error}
                            </div>
                        )}
                        {!pending && !error && answer && (
                            <div style={{ fontSize: 'var(--text-body, 1rem)', lineHeight: 1.6, color: 'var(--silver)', opacity: 0.92 }}>
                                {renderRichText(answer)}
                            </div>
                        )}
                    </div>

                    {/* Footer — actions (save / export) shown once a report exists */}
                    {(answer && !pending && !error) && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
                            padding: '10px 14px',
                            borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                            flexShrink: 0,
                        }}>
                            <button onClick={doSave} disabled={saving || saved} title="Save this report to revisit later" style={actionBtnStyle(saved)}>
                                {saved ? '✓ Saved' : saving ? 'Saving…' : '＋ Save for later'}
                            </button>
                            <button onClick={doPdf} title="Open a printable view (Save as PDF)" style={actionBtnStyle(false)}>⬇ PDF</button>
                            <button onClick={doEmail} title="Email or share this report" style={actionBtnStyle(false)}>✉ Email / Share</button>
                            <span style={{ flex: 1 }} />
                            <button onClick={() => setMinimized(true)} title="Minimize — keep available" style={actionBtnStyle(false)}>▭ Minimize</button>
                        </div>
                    )}
                    {prompt && (
                        <div style={{
                            padding: '8px 14px',
                            borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                            fontSize: 'var(--text-label, 0.75rem)',
                            color: 'var(--silver)',
                            opacity: 0.5,
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}>
                            You asked: {prompt}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    function AnimatedDots() {
        const [n, setN] = React.useState(0);
        React.useEffect(() => {
            const id = setInterval(() => setN(x => (x + 1) % 4), 400);
            return () => clearInterval(id);
        }, []);
        return <span>{'.'.repeat(n)}</span>;
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.AskAnswerWindow = AskAnswerWindow;
    window.DraftCC.buildAskContext = buildAskContext;
})();
