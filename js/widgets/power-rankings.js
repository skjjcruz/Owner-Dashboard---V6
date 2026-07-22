// ══════════════════════════════════════════════════════════════════
// js/widgets/power-rankings.js — Power Rankings Home widget
//
// Views:
//   - Blended:   sorted by healthScore   (0-100)
//   - Contender: sorted by optimal PPG   (current starting lineup)
//   - Dynasty:   sorted by total roster DHQ
//
// Sizes: sm · md · lg · tall · xl · xxl
// Exposes: window.PowerRankingsWidget
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const TONE = {
        elite: 'var(--good)',
        strong: 'var(--k-8ad17a, #8ad17a)',
        middle: 'var(--silver)',
        weak: 'var(--k-e86a5a, #e86a5a)',
        gold: 'var(--gold)',
        panel: 'var(--ov-3, rgba(255,255,255,0.035))',
        line: 'var(--ov-5, rgba(255,255,255,0.08))',
    };

    const VIEW_META = {
        blended: { label: 'Power', short: 'Power', help: '60% strength + 40% assets' },
        contender: { label: 'Contender', short: 'Now', help: 'Optimal lineup' },
        dynasty: { label: 'Dynasty', short: 'Future', help: 'Roster DHQ' },
    };

    function rankTone(rank) {
        if (rank <= 3) return TONE.elite;
        if (rank <= 8) return TONE.middle;
        return TONE.weak;
    }

    function teamTone(score, rank, total) {
        if (rank <= 3) return TONE.elite;
        if (rank > Math.max(8, Math.ceil(total * 0.65))) return TONE.weak;
        if (score >= 84) return TONE.strong;
        return TONE.middle;
    }

    function clamp(n, lo, hi) {
        return Math.max(lo, Math.min(hi, n));
    }

    function getTeamName(t) {
        return t?.ownerName || t?.displayName || t?.teamName || 'Unknown';
    }

    function metricLabel(view) {
        return VIEW_META[view]?.help || 'Score';
    }

    function average(nums) {
        const clean = nums.filter(n => Number.isFinite(n));
        return clean.length ? clean.reduce((s, n) => s + n, 0) / clean.length : 0;
    }

    function PowerRankingsWidget({ size, sleeperUserId, currentLeague, playersData, setActiveTab, navigateWidget }) {
        // One team, one rank. The widget ranks by the blended Power Score only —
        // the same number the command brief, elites badge, and Alex show. The old
        // Now / Future tabs presented three different ranks for one team, which
        // reads as a contradiction ("am I #1 or #8?"); removed by owner ruling.
        const view = 'blended';

        const assessments = React.useMemo(() => {
            if (typeof window.assessAllTeamsFromGlobal === 'function') {
                try { return window.assessAllTeamsFromGlobal() || []; } catch { return []; }
            }
            return [];
        }, []);

        const views = React.useMemo(() => {
            // "Power" = the single blended Power Score (60% strength + 40%
            // assets) computed in the assessment engine. Deterministic tiebreak
            // matches team-assess so this widget agrees with the brief + Alex.
            const blended = [...assessments].sort((a, b) => {
                if ((b.powerScore || 0) !== (a.powerScore || 0)) return (b.powerScore || 0) - (a.powerScore || 0);
                if ((b.totalDHQ || 0) !== (a.totalDHQ || 0)) return (b.totalDHQ || 0) - (a.totalDHQ || 0);
                return String(a.rosterId).localeCompare(String(b.rosterId));
            });
            return {
                blended: {
                    label: 'Power', data: blended, valFn: t => t.powerScore || 0,
                    fmtFn: v => String(Math.round(v || 0)),
                    gapFmt: v => String(Math.round(v || 0)),
                },
            };
        }, [assessments]);

        const cur = views[view] || views.blended;
        const total = cur.data.length || 0;
        const myIndex = cur.data.findIndex(t => t.ownerId === sleeperUserId);
        const myRank = myIndex >= 0 ? myIndex + 1 : null;
        const myTeam = myIndex >= 0 ? cur.data[myIndex] : null;
        const leader = cur.data[0];
        const leaderVal = leader ? cur.valFn(leader) : 0;
        const myVal = myTeam ? cur.valFn(myTeam) : 0;
        const maxVal = Math.max(leaderVal, 1);
        const minVal = Math.min(...cur.data.map(t => cur.valFn(t)).filter(v => v > 0), maxVal);
        const spread = Math.max(1, maxVal - minVal);
        const avgVal = average(cur.data.map(t => cur.valFn(t)));
        const gapToAvg = myTeam ? myVal - avgVal : 0;
        const rankByView = { blended: {} };
        cur.data.forEach((t, i) => { rankByView.blended[t.rosterId] = i + 1; });
        const aboveMe = myIndex > 0 ? cur.data[myIndex - 1] : null;
        const belowMe = myIndex >= 0 && myIndex < total - 1 ? cur.data[myIndex + 1] : null;
        const tiers = cur.data.reduce((acc, t, i) => {
            const key = i < 3 ? 'front' : i < Math.ceil(total * 0.5) ? 'middle' : 'chase';
            acc[key] += 1;
            return acc;
        }, { front: 0, middle: 0, chase: 0 });

        const base = {
            background: 'var(--off-black)',
            border: 'var(--card-border)',
            borderRadius: 'var(--card-radius)',
            padding: 'var(--card-pad, 14px 16px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
        };

        function jumpToLeague(e) {
            e?.stopPropagation?.();
            if (navigateWidget) navigateWidget('analytics');
            else if (setActiveTab) setActiveTab('analytics');
        }

        function AnalyticsButton({ label = 'Open league analytics' }) {
            return React.createElement('button', {
                onClick: jumpToLeague,
                title: 'Open League Analytics',
                style: {
                    border: '1px solid var(--acc-fill3, rgba(212,175,55,0.18))',
                    background: 'var(--acc-fill1, rgba(212,175,55,0.06))',
                    color: 'var(--gold)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: 'var(--text-micro, 0.6875rem)',
                    fontFamily: 'var(--font-body)',
                    fontWeight: 700,
                    padding: '4px 9px',
                    minHeight: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    whiteSpace: 'nowrap',
                }
            }, label);
        }

        function Header({ compact = false }) {
            return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: compact ? '7px' : '9px', minWidth: 0 } },
                React.createElement('span', { style: { fontSize: compact ? '0.82rem' : '0.95rem', lineHeight: 1 } }, '📈'),
                React.createElement('div', {
                    style: {
                        fontFamily: 'Rajdhani, sans-serif',
                        fontSize: compact ? '0.84rem' : '0.98rem',
                        fontWeight: 800,
                        color: 'var(--white)',
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }
                }, 'Power Rankings'),
                // One lens only — a quiet caption instead of the old view tabs.
                React.createElement('div', {
                    style: { marginLeft: 'auto', flex: '0 0 auto', fontFamily: 'var(--font-body)', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.66, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' } }, 'by Power Score'));
        }

        function Bar({ val, rank, totalTeams, width = 70, height = 6 }) {
            const pct = clamp(((val - minVal) / spread) * 74 + 22, 8, 100);
            const color = teamTone(val, rank, totalTeams);
            return React.createElement('div', {
                style: {
                    width,
                    height,
                    background: 'var(--ov-4, rgba(255,255,255,0.07))',
                    borderRadius: height,
                    overflow: 'hidden',
                    flexShrink: 0,
                }
            }, React.createElement('div', {
                style: { width: pct + '%', height: '100%', background: color, borderRadius: height }
            }));
        }

        function StatTile({ label, value, sub, tone = 'var(--white)', compact = false, inline = false }) {
            const labelEl = React.createElement('div', { style: { fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.66, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' } }, label);
            const valueEl = React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: compact ? '0.95rem' : '1.18rem', lineHeight: 1.1, fontWeight: 900, color: tone, marginTop: inline ? 0 : (compact ? '2px' : '4px'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, value);
            // inline: label on the left, number on the right of the same row
            // (instead of stacked). Keeps the sub-line below both.
            const head = inline
                ? React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' } }, labelEl, valueEl)
                : [labelEl, valueEl];
            return React.createElement('div', {
                style: {
                    background: TONE.panel,
                    border: '1px solid var(--ov-4, rgba(255,255,255,0.055))',
                    borderRadius: '8px',
                    padding: compact ? '5px 9px' : '8px 10px',
                    minWidth: 0,
                }
            },
                inline ? head : head[0],
                inline ? null : head[1],
                sub ? React.createElement('div', { style: { fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.62, marginTop: compact ? '1px' : '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, sub) : null
            );
        }

        function TeamRow({ t, rank, dense = false, micro = false, showTrend = false }) {
            const isMe = t.ownerId === sleeperUserId;
            const val = cur.valFn(t);
            const color = teamTone(val, rank, total);
            const gapToLead = Math.max(0, leaderVal - val);
            return React.createElement('div', {
                key: t.rosterId || rank,
                style: {
                    display: 'grid',
                    gridTemplateColumns: micro ? '24px minmax(0, 1fr) 46px 36px' : dense ? '28px minmax(0, 1fr) 58px 42px' : '34px minmax(0, 1fr) 74px 48px',
                    alignItems: 'center',
                    gap: micro ? '5px' : dense ? '7px' : '10px',
                    minHeight: micro ? '23px' : dense ? '30px' : '36px',
                    // 9px side padding on micro rows matches the StatTile boxes
                    // above, so the team list lines up flush under the Your Rank
                    // / Average boxes on both edges.
                    padding: micro ? '1px 9px' : dense ? '3px 7px' : '5px 8px',
                    borderRadius: '6px',
                    background: isMe ? 'var(--acc-fill2, rgba(212,175,55,0.11))' : 'transparent',
                    border: isMe ? '1px solid var(--acc-line1, rgba(212,175,55,0.2))' : '1px solid transparent',
                }
            },
                React.createElement('div', {
                    style: {
                        fontFamily: 'Rajdhani, sans-serif',
                        fontSize: micro ? 'var(--text-micro, 0.6875rem)' : dense ? '0.78rem' : '0.9rem',
                        fontWeight: 800,
                        color: rank <= 3 ? TONE.gold : 'var(--silver)',
                        // Left-align the rank on micro rows so the "1" sits
                        // directly under the Your Rank box's label, not floated
                        // inward by the right-align used on the wider layouts.
                        textAlign: micro ? 'left' : 'right',
                    }
                }, rank),
                React.createElement('div', { style: { minWidth: 0 } },
                    React.createElement('div', {
                        style: {
                            color: isMe ? TONE.gold : 'var(--white)',
                            fontWeight: isMe ? 800 : 650,
                            fontSize: micro ? 'var(--text-micro, 0.6875rem)' : dense ? '0.74rem' : '0.82rem',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }
                    }, getTeamName(t) + (isMe ? ' ★' : '')),
                    showTrend ? React.createElement('div', {
                        style: {
                            fontSize: 'var(--text-micro)',
                            color: 'var(--silver)',
                            opacity: 0.58,
                            marginTop: '1px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }
                    }, rank === 1 ? 'League leader' : (gapToLead > 0 ? cur.gapFmt(gapToLead) + ' off lead' : metricLabel(view))) : null
                ),
                React.createElement(Bar, { val, rank, totalTeams: total, width: micro ? 46 : dense ? 58 : 74, height: micro ? 4 : dense ? 5 : 6 }),
                React.createElement('div', {
                    style: {
                        fontFamily: 'Rajdhani, sans-serif',
                        fontSize: micro ? '0.72rem' : dense ? '0.82rem' : '0.94rem',
                        fontWeight: 800,
                        color,
                        textAlign: 'right',
                    }
                }, cur.fmtFn(val))
            );
        }

        function Ladder({ height = 8, markMe = true }) {
            const ranks = cur.data.slice(0, height);
            const showMe = markMe && myIndex >= height;
            return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minHeight: 0 } },
                ...ranks.map((t, idx) => {
                    const rank = cur.data.indexOf(t) + 1;
                    return React.createElement(TeamRow, {
                        key: (t?.rosterId || rank) + '-' + idx,
                        t,
                        rank,
                        dense: size !== 'xxl',
                        showTrend: size === 'xxl',
                    });
                }),
                showMe ? React.createElement('div', {
                    style: {
                        height: '1px',
                        borderTop: '1px dashed var(--acc-line1, rgba(212,175,55,0.24))',
                        margin: '2px 8px 0',
                    }
                }) : null,
                showMe ? React.createElement(TeamRow, {
                    key: (myTeam?.rosterId || myRank) + '-mine',
                    t: myTeam,
                    rank: myRank,
                    dense: size !== 'xxl',
                    showTrend: size === 'xxl',
                }) : null
            );
        }

        function TierStrip() {
            return React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' } },
                React.createElement(StatTile, { label: 'Front', value: tiers.front, sub: 'top shelf', tone: TONE.elite }),
                React.createElement(StatTile, { label: 'Middle', value: tiers.middle, sub: 'knife fight', tone: TONE.middle }),
                React.createElement(StatTile, { label: 'Chase', value: tiers.chase, sub: 'work to do', tone: TONE.weak })
            );
        }

        if (!assessments.length) {
            return React.createElement('div', { style: { ...base, alignItems: 'center', justifyContent: 'center' } },
                React.createElement('div', { style: { fontSize: '0.8rem', color: 'var(--silver)', opacity: 0.55 } }, 'League intelligence loading...')
            );
        }

        if (size === 'sm') {
            const color = myRank ? rankTone(myRank) : TONE.middle;
            const pct = myRank ? clamp(100 - ((myRank - 1) / Math.max(total - 1, 1)) * 100, 6, 100) : 0;
            return React.createElement('div', {
                style: { ...base, cursor: 'pointer', justifyContent: 'space-between', padding: '16px' },
                onClick: jumpToLeague,
            },
                React.createElement(Header, { compact: true, showTabs: false }),
                React.createElement('div', { style: { textAlign: 'center', padding: '2px 0' } },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 } }, cur.label + ' Rank'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '2.15rem', lineHeight: 1, fontWeight: 900, color } }, myRank ? '#' + myRank : '\u2014'),
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.72, marginTop: '6px' } }, total ? 'of ' + total + ' teams' : 'No teams')
                ),
                React.createElement('div', { style: { height: '7px', borderRadius: '7px', background: 'var(--ov-4, rgba(255,255,255,0.07))', overflow: 'hidden' } },
                    React.createElement('div', { style: { width: pct + '%', height: '100%', background: color, borderRadius: '7px' } })
                )
            );
        }

        if (size === 'md') {
            const color = myRank ? rankTone(myRank) : TONE.middle;
            const ahead = myRank ? myRank - 1 : 0;
            const behind = myRank ? total - myRank : 0;
            return React.createElement('div', { style: { ...base, cursor: 'pointer' }, onClick: jumpToLeague },
                React.createElement(Header, { compact: true, showTabs: false }),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '88px 1fr', gap: '12px', alignItems: 'center', flex: 1, minHeight: 0 } },
                    React.createElement('div', {
                        style: {
                            border: '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                            background: TONE.panel,
                            borderRadius: '8px',
                            padding: '10px 8px',
                            textAlign: 'center',
                        }
                    },
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.72 } }, 'You'),
                        React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.8rem', lineHeight: 1, fontWeight: 900, color, marginTop: '4px' } }, myRank ? '#' + myRank : '\u2014'),
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, marginTop: '5px' } }, cur.fmtFn(myVal) + ' ' + metricLabel(view).toLowerCase())
                    ),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', minWidth: 0 } },
                        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } },
                            React.createElement('div', { style: { background: TONE.panel, borderRadius: '7px', padding: '7px 8px' } },
                                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase' } }, 'Ahead'),
                                React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)' } }, ahead)
                            ),
                            React.createElement('div', { style: { background: TONE.panel, borderRadius: '7px', padding: '7px 8px' } },
                                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase' } }, 'Behind'),
                                React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)' } }, behind)
                            )
                        ),
                        React.createElement('div', { style: { display: 'flex', height: '12px', borderRadius: '7px', overflow: 'hidden', background: 'var(--ov-4, rgba(255,255,255,0.07))' } },
                            ...cur.data.map((t, i) => React.createElement('div', {
                                key: t.rosterId || i,
                                title: (i + 1) + '. ' + getTeamName(t) + ' - ' + cur.fmtFn(cur.valFn(t)),
                                style: {
                                    flex: 1,
                                    background: t.ownerId === sleeperUserId ? TONE.gold : teamTone(cur.valFn(t), i + 1, total),
                                    opacity: t.ownerId === sleeperUserId ? 1 : 0.56,
                                    borderRight: i < total - 1 ? '1px solid rgba(0,0,0,0.35)' : 'none',
                                }
                            }))
                        ),
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                            leader ? 'Leader: ' + getTeamName(leader) + ' · ' + cur.fmtFn(leaderVal) : metricLabel(view)
                        )
                    )
                )
            );
        }

        const largeSizes = size === 'lg' || size === 'xl';
        if (largeSizes) {
            const top3 = cur.data.slice(0, 3);
            const nextRows = cur.data.slice(3, size === 'xl' ? 8 : 6);
            const showMe = myTeam && myIndex >= (size === 'xl' ? 8 : 6);
            return React.createElement('div', { style: base },
                React.createElement(Header, { compact: size === 'lg', showTabs: true }),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '7px' } },
                    ...top3.map((t, i) => {
                        const rank = i + 1;
                        const val = cur.valFn(t);
                        const isMe = t.ownerId === sleeperUserId;
                        return React.createElement('div', {
                            key: t.rosterId || rank,
                            style: {
                                minWidth: 0,
                                border: '1px solid ' + (isMe ? 'var(--acc-line3, rgba(212,175,55,0.38))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                background: isMe ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : TONE.panel,
                                borderRadius: '8px',
                                padding: '8px',
                            }
                        },
                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' } },
                                React.createElement('span', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', fontWeight: 900, color: rank === 1 ? TONE.gold : rankTone(rank) } }, '#' + rank),
                                React.createElement('span', { style: { fontSize: '0.7rem', color: teamTone(val, rank, total), fontWeight: 800 } }, cur.fmtFn(val))
                            ),
                            React.createElement('div', { style: { marginTop: '7px', color: isMe ? TONE.gold : 'var(--white)', fontWeight: 750, fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, getTeamName(t) + (isMe ? ' ★' : '')),
                            React.createElement('div', { style: { marginTop: '7px' } }, React.createElement(Bar, { val, rank, totalTeams: total, width: '100%', height: 6 }))
                        );
                    })
                ),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', minHeight: 0, flex: 1 } },
                    ...nextRows.map((t, i) => React.createElement(TeamRow, { key: t.rosterId || i, t, rank: i + 4, dense: true, showTrend: false })),
                    showMe ? React.createElement('div', { style: { borderTop: '1px dashed var(--acc-line1, rgba(212,175,55,0.25))', margin: '3px 8px 1px' } }) : null,
                    showMe ? React.createElement(TeamRow, { t: myTeam, rank: myRank, dense: true, showTrend: false }) : null
                ),
                total > (showMe ? nextRows.length + 4 : nextRows.length + 3)
                    ? React.createElement('button', {
                        onClick: jumpToLeague,
                        style: {
                            border: 0,
                            background: 'transparent',
                            color: 'var(--silver)',
                            opacity: 0.62,
                            fontSize: 'var(--text-micro, 0.6875rem)',
                            cursor: 'pointer',
                            padding: '0',
                            minHeight: '44px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '-14px 0',
                        }
                    }, 'Open league analytics')
                    : null
            );
        }

        if (size === 'tall' || size === 'narrow') {
            // Both the half-width Tall and the single-column Narrow slot render the
            // full 16-team board in a tall, thin column — Narrow just spans one grid
            // column so it fits beside a wide command brief.
            // Terse unit for the narrow Tall card, so the stat sub-line stays one
            // short phrase instead of the tab's full help text (which used to
            // truncate to "62 60% strength + 40\u2026").
            const tallUnit = view === 'contender' ? 'pts' : view === 'dynasty' ? 'DHQ' : 'score';
            return React.createElement('div', { style: { ...base, gap: '8px' } },
                React.createElement(Header, { compact: true, showTabs: true }),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } },
                    React.createElement(StatTile, {
                        compact: true,
                        inline: true,
                        label: 'Your Rank',
                        value: myRank ? '#' + myRank : '\u2014',
                        sub: myTeam ? cur.fmtFn(myVal) + ' ' + tallUnit : 'not found',
                        // Owner wants the personal rank called out in red.
                        tone: TONE.weak,
                    }),
                    React.createElement(StatTile, {
                        compact: true,
                        inline: true,
                        label: 'Average',
                        value: cur.fmtFn(avgVal),
                        sub: myTeam ? (gapToAvg >= 0 ? '+' + cur.gapFmt(gapToAvg) + ' vs avg' : '\u2212' + cur.gapFmt(Math.abs(gapToAvg)) + ' vs avg') : 'league mean',
                        tone: gapToAvg >= 0 ? TONE.elite : TONE.weak,
                    })
                ),
                React.createElement('div', {
                    style: {
                        display: 'flex',
                        flexDirection: 'column',
                        // Spread the 16 rows to fill the column's full height so
                        // they line up evenly with the tall brief beside them,
                        // instead of bunching at the top with dead space below.
                        // Falls back to top-anchored scrolling if they overflow.
                        justifyContent: 'space-between',
                        gap: '2px',
                        minHeight: 0,
                        flex: 1,
                        overflow: 'auto',
                    }
                },
                    ...cur.data.map((t, i) => React.createElement(TeamRow, {
                        key: t.rosterId || i,
                        t,
                        rank: i + 1,
                        micro: true,
                        showTrend: false,
                    }))
                ),
                React.createElement(AnalyticsButton, null)
            );
        }

        if (size === 'xxl') {
            const top3 = cur.data.slice(0, 3);

            function StrategicRail() {
                const pct = myRank ? Math.round((1 - (myRank - 1) / Math.max(total - 1, 1)) * 100) : 0;
                const leaderGap = myTeam ? Math.max(0, leaderVal - myVal) : 0;
                const packGap = aboveMe ? Math.max(0, cur.valFn(aboveMe) - myVal) : 0;
                const cushion = belowMe ? Math.max(0, myVal - cur.valFn(belowMe)) : 0;
                return React.createElement('div', {
                    style: {
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                        gap: '8px',
                    }
                },
                    React.createElement(StatTile, {
                        compact: true,
                        label: 'Percentile',
                        value: myRank ? pct + 'th' : '—',
                        sub: myRank ? '#' + myRank + ' of ' + total : 'no roster match',
                        tone: myRank ? rankTone(myRank) : TONE.middle,
                    }),
                    React.createElement(StatTile, {
                        compact: true,
                        label: 'Lead Chase',
                        value: cur.gapFmt(leaderGap),
                        sub: leader ? 'behind ' + getTeamName(leader) : 'no leader',
                        tone: leaderGap <= 5 ? TONE.elite : leaderGap <= 15 ? TONE.gold : TONE.weak,
                    }),
                    React.createElement(StatTile, {
                        compact: true,
                        label: 'Next Jump',
                        value: aboveMe ? cur.gapFmt(packGap) : 'Hold',
                        sub: aboveMe ? 'to pass ' + getTeamName(aboveMe) : 'you lead the league',
                        tone: packGap <= 3 ? TONE.elite : packGap <= 10 ? TONE.gold : TONE.middle,
                    }),
                    React.createElement(StatTile, {
                        compact: true,
                        label: 'Seat Heat',
                        value: belowMe ? cur.gapFmt(cushion) : 'None',
                        sub: belowMe ? 'over ' + getTeamName(belowMe) : 'no one below',
                        tone: cushion <= 3 ? TONE.weak : cushion <= 10 ? TONE.gold : TONE.elite,
                    })
                );
            }

            return React.createElement('div', { style: { ...base, gap: '10px' } },
                React.createElement(Header, { compact: false, showTabs: true }),
                React.createElement('div', {
                    style: {
                        display: 'grid',
                        gridTemplateColumns: '1.35fr 1fr 1fr 1fr',
                        gap: '8px',
                    }
                },
                    React.createElement(StatTile, {
                        label: 'Your Board Position',
                        value: myRank ? '#' + myRank + ' of ' + total : '\u2014',
                        sub: myTeam ? cur.fmtFn(myVal) + ' · ' + (gapToAvg >= 0 ? '+' : '-') + cur.gapFmt(Math.abs(gapToAvg)) + ' vs avg' : 'no roster match',
                        tone: myRank ? rankTone(myRank) : TONE.middle,
                    }),
                    React.createElement(StatTile, { label: 'Leader', value: leader ? getTeamName(leader) : '\u2014', sub: leader ? cur.fmtFn(leaderVal) + ' ' + metricLabel(view).toLowerCase() : '', tone: TONE.elite }),
                    React.createElement(StatTile, { label: 'Catch Target', value: aboveMe ? getTeamName(aboveMe) : 'Top spot', sub: aboveMe ? cur.gapFmt(Math.max(0, cur.valFn(aboveMe) - myVal)) + ' away' : 'protect the lead', tone: aboveMe ? TONE.gold : TONE.elite }),
                    React.createElement(StatTile, { label: 'Pressure', value: belowMe ? getTeamName(belowMe) : 'None', sub: belowMe ? cur.gapFmt(Math.max(0, myVal - cur.valFn(belowMe))) + ' cushion' : 'bottom of board', tone: belowMe ? TONE.middle : TONE.weak })
                ),
                React.createElement('div', {
                    style: {
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1.65fr) minmax(0, 0.85fr)',
                        gridTemplateRows: 'minmax(0, 1fr)',
                        gap: '10px',
                        minHeight: 0,
                        overflow: 'hidden',
                        flex: 1,
                    }
                },
                    React.createElement('div', {
                        style: {
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            minHeight: 0,
                        }
                    },
                        React.createElement('div', {
                            style: {
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                gap: '8px',
                                flexShrink: 0,
                            }
                        },
                        ...top3.map((t, i) => {
                            const rank = i + 1;
                            const val = cur.valFn(t);
                            const isMe = t.ownerId === sleeperUserId;
                            return React.createElement('div', {
                                key: t.rosterId || rank,
                                style: {
                                    minWidth: 0,
                                    border: '1px solid ' + (isMe ? 'var(--acc-line3, rgba(212,175,55,0.42))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                    background: isMe ? 'var(--acc-fill2, rgba(212,175,55,0.11))' : TONE.panel,
                                    borderRadius: '9px',
                                    padding: '10px',
                                }
                            },
                                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } },
                                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.35rem', lineHeight: 1, fontWeight: 900, color: rank === 1 ? TONE.gold : rankTone(rank) } }, '#' + rank),
                                    React.createElement('div', { style: { color: teamTone(val, rank, total), fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', fontWeight: 900 } }, cur.fmtFn(val))
                                ),
                                React.createElement('div', { style: { marginTop: '9px', color: isMe ? TONE.gold : 'var(--white)', fontSize: '0.84rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, getTeamName(t) + (isMe ? ' ★' : '')),
                                React.createElement('div', { style: { marginTop: '8px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62 } }, rank === 1 ? 'League leader' : cur.gapFmt(Math.max(0, leaderVal - val)) + ' off lead'),
                                React.createElement('div', { style: { marginTop: '8px' } }, React.createElement(Bar, { val, rank, totalTeams: total, width: '100%', height: 7 }))
                            );
                        })),
                        React.createElement('div', {
                            style: {
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                gap: '3px 12px',
                                minHeight: 0,
                                overflowY: 'auto',
                                alignContent: 'start',
                                flex: 1,
                            }
                        },
                            ...cur.data.slice(3).map((t, i) => React.createElement(TeamRow, {
                                key: t.rosterId || i,
                                t,
                                rank: i + 4,
                                micro: true,
                            }))
                        )
                    ),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0, overflowY: 'auto' } },
                        React.createElement(TierStrip, null)
                    )
                ),
                React.createElement(StrategicRail, null),
                React.createElement(AnalyticsButton, null)
            );
        }

        const rowCount = 9;
        return React.createElement('div', { style: base },
            React.createElement(Header, { compact: false, showTabs: true }),
            React.createElement('div', {
                style: {
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '8px',
                }
            },
                React.createElement('div', { style: { background: TONE.panel, borderRadius: '8px', padding: '8px 10px' } },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.66, textTransform: 'uppercase' } }, 'Your Rank'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.25rem', fontWeight: 900, color: myRank ? rankTone(myRank) : TONE.middle } }, myRank ? '#' + myRank : '\u2014')
                ),
                React.createElement('div', { style: { background: TONE.panel, borderRadius: '8px', padding: '8px 10px' } },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.66, textTransform: 'uppercase' } }, 'Leader'),
                    React.createElement('div', { style: { fontSize: '0.78rem', fontWeight: 750, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, leader ? getTeamName(leader) : '\u2014')
                ),
                React.createElement('div', { style: { background: TONE.panel, borderRadius: '8px', padding: '8px 10px' } },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.66, textTransform: 'uppercase' } }, metricLabel(view)),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.25rem', fontWeight: 900, color: TONE.gold } }, cur.fmtFn(myVal))
                )
            ),
            React.createElement('div', { style: { overflow: 'hidden', minHeight: 0, flex: 1 } },
                React.createElement(Ladder, { height: rowCount, markMe: true })
            )
        );
    }

    window.PowerRankingsWidget = PowerRankingsWidget;
})();
