// ══════════════════════════════════════════════════════════════════
// js/widgets/player-tags.js — Tag-driven Home widgets (v2)
//
// Surfaces tagged players from My Roster into the Dashboard.
//   - TradeBlockWidget     → tag 'trade'
//   - CutCandidatesWidget  → tag 'cut'
//   - WaiverTargetsWidget  → tag 'watch'
//
// Sizes: sm / md / lg / tall (xxl removed — eliminated per audit).
// All sizes are no-scroll: smaller sizes show condensed rows, larger
// sizes show more rows with full detail.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    function playerName(p) {
        if (!p) return '—';
        return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || '—';
    }

    function pidsByTag(tag) {
        const tags = window._playerTags || {};
        return Object.keys(tags).filter(pid => tags[pid] === tag);
    }

    function enrich(pids, playersData) {
        const scores = (window.App && window.App.LI && window.App.LI.playerScores) || {};
        const normPos = window.App?.normPos || (p => p);
        return pids
            .map(pid => {
                const p = (playersData || {})[pid];
                return {
                    pid,
                    name: playerName(p),
                    pos: normPos(p?.position) || '?',
                    team: p?.team || 'FA',
                    age: p?.age || (p?.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null),
                    dhq: scores[pid] || 0,
                };
            })
            .sort((a, b) => b.dhq - a.dhq);
    }

    // Compact one-line row (md/lg)
    function CompactRow({ r, tone, onClick }) {
        const posColors = (window.App && window.App.POS_COLORS) || {};
        const posCol = posColors[r.pos] || 'var(--k-8d887e, #8d887e)';
        return React.createElement('div', {
            onClick,
            role: 'button',
            tabIndex: 0,
            title: 'Open player card',
            onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick && onClick(e); } },
            style: {
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '4px 6px', borderRadius: '4px',
                cursor: 'pointer',
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                fontSize: '0.7rem',
            },
        },
            React.createElement('span', {
                style: {
                    fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: posCol,
                    minWidth: 22, textAlign: 'center',
                    padding: '1px 3px', borderRadius: '3px',
                    background: wrAlpha(posCol, '22'),
                },
            }, r.pos),
            React.createElement('span', { style: { flex: 1, minWidth: 0, color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.name),
            React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', minWidth: 26, textAlign: 'right' } }, r.team),
            r.age ? React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', minWidth: 14, textAlign: 'right' } }, r.age) : null,
            React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: tone, fontFamily: 'JetBrains Mono, monospace', minWidth: 32, textAlign: 'right' } },
                r.dhq ? (r.dhq >= 1000 ? (r.dhq / 1000).toFixed(1) + 'k' : r.dhq) : '—',
            ),
        );
    }

    // Full row with subline (tall)
    function FullRow({ r, tone, onClick }) {
        const posColors = (window.App && window.App.POS_COLORS) || {};
        const posCol = posColors[r.pos] || 'var(--k-8d887e, #8d887e)';
        return React.createElement('div', {
            onClick,
            role: 'button',
            tabIndex: 0,
            title: 'Open player card',
            onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick && onClick(e); } },
            style: {
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 8px', borderRadius: '6px', minHeight: '44px',
                cursor: 'pointer',
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
            },
        },
            React.createElement('span', {
                style: {
                    fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: posCol,
                    minWidth: 24, textAlign: 'center',
                    padding: '2px 4px', borderRadius: '3px',
                    background: wrAlpha(posCol, '22'),
                },
            }, r.pos),
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--text-primary)', fontWeight: 500, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.name),
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' } },
                    [r.team, r.age ? 'Age ' + r.age : null].filter(Boolean).join(' · '),
                ),
            ),
            React.createElement('div', { style: { fontSize: '0.76rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: tone } },
                r.dhq ? (r.dhq >= 1000 ? (r.dhq / 1000).toFixed(1) + 'k' : r.dhq) : '—',
            ),
        );
    }

    // ── Generic tag widget ────────────────────────────────────────
    function TagWidget({ size, title, icon, tag, emptyText, tone, clickTarget, playersData, setActiveTab, navigateWidget }) {
        const pids = React.useMemo(() => pidsByTag(tag), [window._playerTags, tag]);
        const rows = React.useMemo(() => enrich(pids, playersData), [pids, playersData]);

        const base = {
            background: 'var(--off-black)',
            border: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))',
            borderRadius: '10px', padding: 'var(--card-pad, 12px 14px)',
            display: 'flex', flexDirection: 'column', gap: '6px',
            height: '100%', minHeight: 0, overflow: 'hidden',
        };

        function openRoster() {
            if (navigateWidget) navigateWidget(clickTarget || 'myteam');
            else if (setActiveTab) setActiveTab(clickTarget || 'myteam');
        }
        function openCard(pid) {
            if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
            else if (typeof window.openPlayerModal === 'function') window.openPlayerModal(pid);
        }

        function header(opts = {}) {
            return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 } },
                React.createElement('span', { style: { fontSize: opts.large ? '1rem' : '0.9rem' } }, icon),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: opts.large ? '0.95rem' : '0.82rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, title),
                ),
                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace' } }, rows.length + ' player' + (rows.length === 1 ? '' : 's')),
                opts.showTagBtn !== false && React.createElement('button', {
                    onClick: openRoster,
                    title: 'Tag players in My Roster',
                    style: {
                        padding: '2px 6px', fontSize: 'var(--text-micro, 0.6875rem)',
                        background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)',
                        border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '4px',
                        cursor: 'pointer', fontFamily: 'var(--font-body)', letterSpacing: '0.05em',
                    },
                }, 'TAG'),
            );
        }

        // ── SM (1×1, 80×160): icon + count + top player snippet ──
        if (size === 'sm') {
            const top = rows[0];
            return React.createElement('div', { style: { ...base, cursor: 'pointer', padding: '12px 14px', textAlign: 'center', justifyContent: 'center', alignItems: 'center', gap: '4px' }, onClick: openRoster },
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' } },
                    React.createElement('span', null, icon),
                    React.createElement('span', null, title),
                ),
                React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1.6rem', fontWeight: 700, color: rows.length > 0 ? tone : 'var(--silver)', lineHeight: 1, marginTop: '2px' } }, rows.length),
                top
                    ? React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: 'var(--font-body)', marginTop: '2px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        'Top: ',
                        React.createElement('span', { style: { color: 'var(--white)', fontWeight: 700 } }, (top.name || '').split(' ').slice(-1)[0]),
                        React.createElement('span', { style: { color: 'var(--silver)', opacity: 0.7 } }, ' · ' + top.pos),
                    )
                    : React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontStyle: 'italic', opacity: 0.5, marginTop: '2px' } }, 'No tags'),
            );
        }

        // ── MD (2×1, 160×320): header + 3 compact rows, no scroll ──
        if (size === 'md') {
            const shown = rows.slice(0, 3);
            return React.createElement('div', { style: base },
                header(),
                shown.length === 0
                    ? React.createElement('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.55, padding: '8px 4px', textAlign: 'center', fontStyle: 'italic' } }, emptyText || 'No players tagged.')
                    : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minHeight: 0, overflow: 'hidden' } },
                        ...shown.map(r => React.createElement(CompactRow, { key: r.pid, r, tone, onClick: () => openCard(r.pid) })),
                    ),
            );
        }

        // ── LG (2×2, 320×320): header + 5-6 compact rows, no scroll ──
        if (size === 'lg') {
            const shown = rows.slice(0, 6);
            return React.createElement('div', { style: base },
                header(),
                shown.length === 0
                    ? React.createElement('div', { style: { fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.55, padding: '20px 4px', textAlign: 'center', fontStyle: 'italic' } }, emptyText || 'No players tagged yet.')
                    : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minHeight: 0, overflow: 'hidden' } },
                        ...shown.map(r => React.createElement(CompactRow, { key: r.pid, r, tone, onClick: () => openCard(r.pid) })),
                        rows.length > shown.length
                            ? React.createElement('div', {
                                onClick: openRoster,
                                style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textAlign: 'center', padding: '2px', cursor: 'pointer', marginTop: 'auto' },
                            }, '+ ' + (rows.length - shown.length) + ' more')
                            : null,
                    ),
            );
        }

        // ── TALL (2×4, 320×640): header + position breakdown + full rows ──
        if (size === 'tall') {
            const shown = rows.slice(0, 12);
            // Position breakdown summary
            const posCounts = {};
            rows.forEach(r => { posCounts[r.pos] = (posCounts[r.pos] || 0) + 1; });
            const totalDhq = rows.reduce((s, r) => s + (r.dhq || 0), 0);
            const posColors = (window.App && window.App.POS_COLORS) || {};
            return React.createElement('div', { style: base },
                header({ large: true }),
                // Summary chip strip — total DHQ + position breakdown
                rows.length > 0 && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: '6px 8px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', flexShrink: 0 } },
                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 } }, 'Total'),
                    React.createElement('span', { style: { fontSize: '0.78rem', fontWeight: 700, color: tone, fontFamily: 'JetBrains Mono, monospace' } }, totalDhq >= 1000 ? (totalDhq / 1000).toFixed(1) + 'k' : totalDhq),
                    React.createElement('span', { style: { color: 'var(--ov-6, rgba(255,255,255,0.15))', margin: '0 4px' } }, '·'),
                    ...Object.entries(posCounts).sort((a, b) => b[1] - a[1]).map(([pos, count]) => React.createElement('span', { key: pos, style: { display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)' } },
                        React.createElement('span', { style: { color: posColors[pos] || 'var(--text-muted)', fontWeight: 700 } }, pos),
                        React.createElement('span', { style: { color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace' } }, count),
                    )),
                ),
                shown.length === 0
                    ? React.createElement('div', { style: { fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.55, padding: '20px 4px', textAlign: 'center', fontStyle: 'italic' } }, emptyText || 'No players tagged yet.')
                    : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minHeight: 0, overflow: 'auto' } },
                        ...shown.map(r => React.createElement(FullRow, { key: r.pid, r, tone, onClick: () => openCard(r.pid) })),
                        rows.length > shown.length
                            ? React.createElement('div', {
                                onClick: openRoster,
                                style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textAlign: 'center', padding: '4px', cursor: 'pointer', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
                            }, '+ ' + (rows.length - shown.length) + ' more')
                            : null,
                    ),
            );
        }

        return null;
    }

    // ── Three concrete widgets ────────────────────────────────────
    function TradeBlockWidget(props) {
        return React.createElement(TagWidget, {
            ...props,
            title: 'Trade Block',
            icon: '🏷️',
            tag: 'trade',
            tone: 'var(--k-f0a500, #f0a500)',
            emptyText: 'Tag players on your roster to shop them here.',
            clickTarget: 'myteam',
        });
    }

    function CutCandidatesWidget(props) {
        return React.createElement(TagWidget, {
            ...props,
            title: 'Cut Candidates',
            icon: '✂️',
            tag: 'cut',
            tone: 'var(--k-e74c3c, #e74c3c)',
            emptyText: 'Flag dead weight on your roster to review here.',
            clickTarget: 'myteam',
        });
    }

    function WaiverTargetsWidget(props) {
        return React.createElement(TagWidget, {
            ...props,
            title: 'Waiver Targets',
            icon: '🎯',
            tag: 'watch',
            tone: 'var(--k-3498db, #3498db)',
            emptyText: 'Tag "Watch" on any player to track them here.',
            clickTarget: 'fa',
        });
    }

    window.TradeBlockWidget = TradeBlockWidget;
    window.CutCandidatesWidget = CutCandidatesWidget;
    window.WaiverTargetsWidget = WaiverTargetsWidget;
})();
