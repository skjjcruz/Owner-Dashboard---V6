// ══════════════════════════════════════════════════════════════════
// js/widgets/my-trophies.js — My Trophies Home widget (v3)
//
// Surfaces title legacy + first-class achievement badges
// (window.WrAchievements). Click any size to open the Trophy Room.
//
// Sizes: sm / md / lg / tall / xxl
// Achievements are computed by the shared module so they stay in sync
// with the Trophy Room's Achievements tab.
//
// Depends on: window.WrAchievements (js/shared/achievements.js)
// Exposes:    window.MyTrophiesWidget
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    function MyTrophiesWidget({ size, myRoster, currentLeague, setActiveTab, navigateWidget }) {
        // Re-render trigger when league history loads from Sleeper
        const [historyTick, setHistoryTick] = React.useState(0);
        React.useEffect(() => {
            const onLoaded = () => setHistoryTick(t => t + 1);
            window.addEventListener('wr_history_loaded', onLoaded);
            // Trigger background fetch if history isn't cached
            if (window.WrHistory && currentLeague) {
                window.WrHistory.loadIfMissing(currentLeague).catch(() => {});
            }
            return () => window.removeEventListener('wr_history_loaded', onLoaded);
        }, [currentLeague?.id || currentLeague?.league_id]);

        // Stats + achievement evaluation via the shared module
        const data = React.useMemo(() => {
            const A = window.WrAchievements;
            if (!A || !myRoster) return null;
            const stats = A.computeStats({ myRoster, currentLeague });
            const evald = A.evaluate(stats);
            return { stats, evald };
        }, [myRoster, currentLeague, historyTick]);

        const jump = () => { if (navigateWidget) navigateWidget('trophies'); else if (setActiveTab) setActiveTab('trophies'); };

        const base = {
            background: 'var(--off-black)',
            border: 'var(--card-border)',
            borderRadius: 'var(--card-radius)', padding: 'var(--card-pad, 14px 16px)',
            display: 'flex', flexDirection: 'column', gap: '6px',
            height: '100%', minHeight: 0, cursor: 'pointer',
            overflow: 'hidden',
        };

        if (!data) {
            return React.createElement('div', { style: { ...base, alignItems: 'center', justifyContent: 'center' }, onClick: jump },
                React.createElement('div', { style: { fontSize: '0.8rem', color: 'var(--silver)', opacity: 0.6 } }, 'Trophy Room — tap to open'),
            );
        }

        const { stats: mine, evald } = data;
        const earnedCount = evald.earned.length;
        const totalCatalog = evald.earned.length + evald.unearned.length;
        const record = mine.wins + '-' + mine.losses + (mine.ties ? '-' + mine.ties : '');

        // ── SM ──
        if (size === 'sm') {
            return React.createElement('div', { style: { ...base, textAlign: 'center', justifyContent: 'center' }, onClick: jump },
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.65 } }, 'Titles · Badges'),
                React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.5rem', fontWeight: 700, color: mine.championships > 0 ? 'var(--gold)' : 'var(--silver)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' } },
                    React.createElement('span', null, mine.championships, mine.championships > 0 ? '🏆' : ''),
                    React.createElement('span', { style: { fontSize: '1rem', color: 'var(--silver)' } }, '·'),
                    React.createElement('span', { style: { fontSize: '1.15rem' } }, earnedCount, React.createElement('span', { style: { fontSize: '0.7rem', color: 'var(--silver)' } }, '/' + totalCatalog)),
                ),
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.55 } }, record),
            );
        }

        // Stats grid renderer (used by md/lg/tall/xxl)
        function statGrid(stats, cols) {
            return React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', minmax(0, 1fr))', gap: '6px', flexShrink: 0 } },
                ...stats.map(s => React.createElement('div', { key: s.label, style: { background: 'var(--black)', border: '1px solid var(--ov-3, rgba(255,255,255,0.05))', borderRadius: '6px', padding: '8px 6px', textAlign: 'center', minWidth: 0, overflow: 'hidden' } },
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.15rem', fontWeight: 700, color: s.col, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.val),
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, s.label),
                )),
            );
        }

        const lgStats = [
            { label: 'Titles', val: mine.championships, col: mine.championships > 0 ? 'var(--gold)' : 'var(--silver)' },
            { label: 'R-Up', val: mine.runnerUps, col: mine.runnerUps > 0 ? 'var(--k-c0c0c0, #c0c0c0)' : 'var(--silver)' },
            { label: 'Badges', val: earnedCount, col: earnedCount > 0 ? 'var(--k-7c6bf8, #7c6bf8)' : 'var(--silver)' },
        ];
        const tallStats = [
            { label: 'Titles', val: mine.championships, col: mine.championships > 0 ? 'var(--gold)' : 'var(--silver)' },
            { label: 'R-Up', val: mine.runnerUps, col: mine.runnerUps > 0 ? 'var(--k-c0c0c0, #c0c0c0)' : 'var(--silver)' },
            { label: 'Playoffs', val: mine.playoffs, col: mine.playoffs > 0 ? 'var(--gold)' : 'var(--silver)' },
            { label: 'Badges', val: earnedCount + '/' + totalCatalog, col: earnedCount > 0 ? 'var(--k-7c6bf8, #7c6bf8)' : 'var(--silver)' },
            { label: 'Win %', val: Math.round(mine.winPct) + '%', col: mine.winPct >= 50 ? 'var(--good)' : 'var(--bad)' },
        ];

        // ── MD ──
        if (size === 'md') {
            // Show top 4 earned badges as compact chips
            const earnedTop = evald.earned.slice(0, 4);
            return React.createElement('div', { style: base, onClick: jump },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    React.createElement('span', { style: { fontSize: '1rem' } }, '🏆'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.88rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em', flex: 1 } }, 'My Trophies'),
                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.7 } }, earnedCount + '/' + totalCatalog + ' badges'),
                ),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', flexShrink: 0 } },
                    [
                        { label: 'Titles', val: mine.championships, col: mine.championships > 0 ? 'var(--gold)' : 'var(--silver)' },
                        { label: 'R-Up', val: mine.runnerUps, col: mine.runnerUps > 0 ? 'var(--k-c0c0c0, #c0c0c0)' : 'var(--silver)' },
                        { label: 'Win%', val: Math.round(mine.winPct) + '%', col: mine.winPct >= 50 ? 'var(--good)' : 'var(--bad)' },
                    ].map(s => React.createElement('div', { key: s.label, style: { background: 'var(--black)', border: '1px solid var(--ov-3, rgba(255,255,255,0.05))', borderRadius: '6px', padding: '5px 4px', textAlign: 'center' } },
                        React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.95rem', fontWeight: 700, color: s.col } }, s.val),
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '1px' } }, s.label),
                    )),
                ),
                earnedTop.length > 0 && React.createElement('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' } },
                    ...earnedTop.map(a => {
                        const tc = window.WrAchievements.tierColor(a.tier);
                        return React.createElement('span', { key: a.id, title: a.label + ' — ' + a.description, style: { fontSize: '0.78rem', padding: '2px 4px', background: wrAlpha(tc, '14'), border: '1px solid ' + wrAlpha(tc, '44'), borderRadius: '4px' } }, a.icon);
                    }),
                ),
            );
        }

        // ── LG ──
        if (size === 'lg') {
            const earnedTop = evald.earned.slice(0, 6);
            return React.createElement('div', { style: base, onClick: jump },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    React.createElement('span', { style: { fontSize: '1rem' } }, '🏆'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.88rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em', flex: 1 } }, 'My Trophies'),
                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.7 } }, 'open →'),
                ),
                statGrid(lgStats, 3),
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7, fontFamily: 'JetBrains Mono, monospace' } }, 'All-time · ' + record),
                mine.champSeasons.length > 0 && React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)' } }, '👑 ' + mine.champSeasons.join(' · ')),
                earnedTop.length > 0 && React.createElement('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' } },
                    ...earnedTop.map(a => {
                        const tc = window.WrAchievements.tierColor(a.tier);
                        return React.createElement('span', {
                            key: a.id, title: a.label + ' — ' + a.description,
                            style: { display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: 'var(--text-micro, 0.6875rem)', padding: '2px 6px', background: wrAlpha(tc, '14'), border: '1px solid ' + wrAlpha(tc, '44'), borderRadius: '4px', color: tc, fontWeight: 600, fontFamily: 'var(--font-body)' },
                        }, React.createElement('span', { style: { fontSize: '0.78rem' } }, a.icon), a.label);
                    }),
                ),
            );
        }

        // ── Achievement chip helper (tall/xxl) ───────────────────
        function achievementChip(a, opts = {}) {
            const tc = window.WrAchievements.tierColor(a.tier);
            const earned = a.progress >= 1;
            return React.createElement('div', {
                key: a.id, title: a.label + ' — ' + a.description,
                style: {
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '5px 8px',
                    background: earned ? wrAlpha(tc, '14') : 'var(--ov-1, rgba(255,255,255,0.02))',
                    border: '1px solid ' + (earned ? wrAlpha(tc, '55') : 'var(--ov-4, rgba(255,255,255,0.06))'),
                    borderRadius: '6px',
                    opacity: earned ? 1 : 0.55,
                },
            },
                React.createElement('span', { style: { fontSize: '0.95rem', filter: earned ? 'none' : 'grayscale(0.6)' } }, a.icon),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: earned ? tc : 'var(--silver)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, a.label),
                    !opts.hideDesc && React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, a.description),
                    !earned && a.target > 1 && React.createElement('div', { style: { height: 3, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 2, overflow: 'hidden', marginTop: '3px' } },
                        React.createElement('div', { style: { width: (a.progress * 100) + '%', height: '100%', background: tc, opacity: 0.8 } }),
                    ),
                ),
                !earned && a.target > 1 && React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace', opacity: 0.6, minWidth: 28, textAlign: 'right' } }, a.value + '/' + a.target),
            );
        }

        // ── TALL: stats + record bar + champ banner + season timeline + earned badges ──
        if (size === 'tall') {
            // Cap earned chips — the full 14-badge catalog overflows the fixed
            // 2x4 card and clips silently; xxl shows the complete list.
            const earnedTop = evald.earned.slice(0, 8);
            const earnedHidden = evald.earned.length - earnedTop.length;
            const inProgress = evald.unearned.filter(a => a.progress > 0 && a.progress < 1).slice(0, 3);
            return React.createElement('div', { style: base, onClick: jump },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    React.createElement('span', { style: { fontSize: '1.1rem' } }, '🏆'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.95rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em', flex: 1 } }, 'My Trophies'),
                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.7 } }, 'open →'),
                ),
                statGrid(tallStats, 5),
                // Record + win% bar
                React.createElement('div', { style: { padding: '6px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', flexShrink: 0 } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', marginBottom: '3px', fontFamily: 'JetBrains Mono, monospace' } },
                        React.createElement('span', null, 'All-time'),
                        React.createElement('span', { style: { color: 'var(--white)', fontWeight: 700 } }, record + ' · ' + Math.round(mine.winPct) + '%'),
                    ),
                    React.createElement('div', { style: { height: 6, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 3, overflow: 'hidden' } },
                        React.createElement('div', { style: { width: mine.winPct + '%', height: '100%', background: mine.winPct >= 50 ? 'var(--good)' : 'var(--bad)' } }),
                    ),
                ),
                // Champ + Runner-up callouts
                mine.champSeasons.length > 0 && React.createElement('div', { style: { fontSize: '0.7rem', color: 'var(--gold)', fontWeight: 700, padding: '6px 10px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '6px', flexShrink: 0 } },
                    '👑 Championship seasons: ', mine.champSeasons.join(' · '),
                ),
                mine.runnerUpSeasons.length > 0 && React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--k-c0c0c0, #c0c0c0)', padding: '4px 10px', background: 'rgba(192,192,192,0.06)', border: '1px solid rgba(192,192,192,0.15)', borderRadius: '6px', flexShrink: 0 } },
                    '🥈 Runner-up seasons: ', mine.runnerUpSeasons.join(' · '),
                ),
                // Earned badges section
                earnedTop.length > 0 && React.createElement('div', { style: { flexShrink: 0 } },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' } }, 'Earned · ' + earnedCount + '/' + totalCatalog),
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' } },
                        ...earnedTop.map(a => achievementChip(a)),
                        earnedHidden > 0 ? React.createElement('div', { key: '_more', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 8px', borderRadius: '6px', border: '1px dashed var(--ov-5, rgba(255,255,255,0.08))', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7 } }, '+' + earnedHidden + ' more in Trophy Room') : null,
                    ),
                ),
                // In-progress badges
                inProgress.length > 0 && React.createElement('div', { style: { flexShrink: 0 } },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px', opacity: 0.7 } }, 'Closest to earning'),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                        ...inProgress.map(a => achievementChip(a)),
                    ),
                ),
            );
        }

        // ── XXL: full legacy dashboard with achievements panel ──
        if (size === 'xxl') {
            const playoffCutoff = mine.playoffCutoff;
            // Group earned + unearned by tier for display
            const byTier = { titles: { earned: [], unearned: [] }, performance: { earned: [], unearned: [] }, tenure: { earned: [], unearned: [] }, misc: { earned: [], unearned: [] } };
            evald.earned.forEach(a => { if (byTier[a.tier]) byTier[a.tier].earned.push(a); });
            evald.unearned.forEach(a => { if (byTier[a.tier]) byTier[a.tier].unearned.push(a); });

            return React.createElement('div', { style: base, onClick: jump },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' } },
                    React.createElement('span', { style: { fontSize: '1.2rem' } }, '🏆'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em', flex: 1, minWidth: 0 } }, 'My Trophies · Legacy'),
                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontFamily: 'JetBrains Mono, monospace', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, mine.totalGames + ' games · ' + Math.round(mine.winPct) + '% · ' + earnedCount + '/' + totalCatalog + ' badges'),
                ),
                statGrid(tallStats, 5),
                // Champ + Runner-Up banners
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', flexShrink: 0 } },
                    React.createElement('div', { style: { padding: '8px 12px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '6px' } },
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '2px' } }, '👑 Championships'),
                        React.createElement('div', { style: { fontSize: '0.78rem', color: mine.champSeasons.length ? 'var(--white)' : 'var(--silver)', fontFamily: 'JetBrains Mono, monospace' } },
                            mine.champSeasons.length ? mine.champSeasons.join(' · ') : 'No titles yet',
                        ),
                    ),
                    React.createElement('div', { style: { padding: '8px 12px', background: 'rgba(192,192,192,0.06)', border: '1px solid rgba(192,192,192,0.18)', borderRadius: '6px' } },
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--k-c0c0c0, #c0c0c0)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '2px' } }, '🥈 Runner-Ups'),
                        React.createElement('div', { style: { fontSize: '0.78rem', color: mine.runnerUpSeasons.length ? 'var(--white)' : 'var(--silver)', fontFamily: 'JetBrains Mono, monospace' } },
                            mine.runnerUpSeasons.length ? mine.runnerUpSeasons.join(' · ') : 'None',
                        ),
                    ),
                ),
                // Bottom 2-col: Season timeline (left) + Achievements (right)
                React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', overflow: 'hidden' } },
                    // Season timeline
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' } },
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' } }, 'Season Timeline'),
                        mine.hist.length === 0
                            ? React.createElement('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.6, fontStyle: 'italic', padding: '8px 0' } }, 'No season history available yet.')
                            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', overflow: 'auto' } },
                                ...mine.hist.slice().reverse().map((s, i) => {
                                    const isChamp = mine.champSeasons.includes(String(s.season));
                                    const isRunner = mine.runnerUpSeasons.includes(String(s.season));
                                    const madePlayoffs = s.place && s.place <= playoffCutoff;
                                    const totalG = s.wins + s.losses;
                                    const wp = totalG ? (s.wins / totalG) * 100 : 0;
                                    return React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', padding: '3px 6px', background: isChamp ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'var(--ov-1, rgba(255,255,255,0.02))', borderRadius: '4px', borderLeft: isChamp ? '2px solid var(--gold)' : isRunner ? '2px solid var(--k-c0c0c0, #c0c0c0)' : madePlayoffs ? '2px solid var(--good)' : '2px solid transparent' } },
                                        React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', color: 'var(--gold)', minWidth: 36, fontWeight: 700 } }, s.season),
                                        React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', color: 'var(--white)', minWidth: 40, fontWeight: 600 } }, s.wins + '-' + s.losses),
                                        React.createElement('div', { style: { flex: 1, minWidth: 0, height: 5, background: 'var(--ov-3, rgba(255,255,255,0.05))', borderRadius: 2, overflow: 'hidden' } },
                                            React.createElement('div', { style: { width: wp + '%', height: '100%', background: wp >= 50 ? 'var(--good)' : 'var(--bad)', opacity: 0.8 } }),
                                        ),
                                        s.place && React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', color: madePlayoffs ? 'var(--gold)' : 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', minWidth: 30, textAlign: 'right', fontWeight: 700 } }, 'P#' + s.place),
                                        isChamp && React.createElement('span', { style: { fontSize: '0.7rem' } }, '👑'),
                                        isRunner && React.createElement('span', { style: { fontSize: '0.7rem' } }, '🥈'),
                                    );
                                }),
                            ),
                    ),
                    // Achievements grid by tier
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' } },
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' } },
                            'Achievements · ', earnedCount, '/', totalCatalog,
                        ),
                        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'auto' } },
                            ...['titles', 'performance', 'tenure', 'misc'].map(tier => {
                                const earned = byTier[tier].earned;
                                const unearned = byTier[tier].unearned;
                                if (earned.length === 0 && unearned.length === 0) return null;
                                const tc = window.WrAchievements.tierColor(tier);
                                return React.createElement('div', { key: tier },
                                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: tc, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' } },
                                        window.WrAchievements.tierLabel(tier), ' · ', earned.length, '/', earned.length + unearned.length,
                                    ),
                                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '4px' } },
                                        ...earned.map(a => achievementChip(a)),
                                        ...unearned.map(a => achievementChip(a)),
                                    ),
                                );
                            }).filter(Boolean),
                        ),
                    ),
                ),
            );
        }

        return null;
    }

    window.MyTrophiesWidget = MyTrophiesWidget;
})();
