// ══════════════════════════════════════════════════════════════════
// js/widgets/gap-plan.js — Gap Plan widget
//
// Positional gaps in PLAYER COUNTS ("You need 2 more LBs"), sorted
// critical → least, benchmarked against the league's elite tier teams.
// Rows deep-link to Free Agency / Trade Center to act on the gap.
//
// sm: biggest gap hero ("+2 LB") → My Roster
// md: gap list — need counts + you-vs-elite-tier starter bars
// lg: md + concrete sources for the top gap (best FA + trade partner)
//
// Depends on: team-assess (assessTeamFromGlobal / assessAllTeamsFromGlobal
//             posAssessment counts), theme.js (wrAlpha), core.js helpers
// Exposes:    window.GapPlanWidget
// ══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function GapPlanWidget({ size, myRoster, currentLeague, playersData, sleeperUserId, setActiveTab, navigateWidget }) {
        const theme = window.WrTheme?.get?.() || {};
        const colors = theme.colors || {};
        const fonts = theme.fonts || {};
        const cardStyle = window.WrTheme?.cardStyle?.() || {};
        const fs = (rem) => window.WrTheme?.fontSize?.(rem) || (rem + 'rem');
        const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters }) || { isUsable: true };
        const posLabel = (pos) => window.App?.posLabel?.(pos) || pos;

        // GM Strategy is the single source of truth — pin strategy targets to top
        const gm = window.WR.GmMode.useGmEffects(currentLeague);
        const targetPositions = gm.targetPositions || new Set();
        const isTarget = (pos) => targetPositions.has(String(pos));

        const goTo = (target, e) => {
            e?.stopPropagation?.();
            if (navigateWidget) navigateWidget(target);
            else if (setActiveTab) setActiveTab(target);
        };
        const openCard = (pid) => {
            if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
            else if (typeof window.openPlayerModal === 'function') window.openPlayerModal(pid);
        };
        const isClickable = size === 'sm';

        const myAssess = React.useMemo(() => {
            if (typeof window.assessTeamFromGlobal === 'function' && myRoster?.roster_id) {
                return window.assessTeamFromGlobal(myRoster.roster_id);
            }
            return null;
        }, [myRoster?.roster_id]);

        const allAssess = React.useMemo(() => {
            if (typeof window.assessAllTeamsFromGlobal === 'function') return window.assessAllTeamsFromGlobal() || [];
            return [];
        }, []);

        // ── Gap model — speaks in player counts, never raw DHQ ──
        // need = starter-quality players short of the league's requirement;
        // benchmark = avg starter-quality count among elite tier teams
        // (ELITE/CONTENDER, falling back to the top quarter by health).
        const gaps = React.useMemo(() => {
            const posAssessment = myAssess?.posAssessment || {};
            const entries = Object.entries(posAssessment);
            if (!entries.length) return [];
            let eliteTeams = allAssess.filter(a => a.tier === 'ELITE' || a.tier === 'CONTENDER');
            if (!eliteTeams.length) {
                eliteTeams = [...allAssess].sort((a, b) => (b.healthScore || 0) - (a.healthScore || 0)).slice(0, Math.max(1, Math.ceil(allAssess.length / 4)));
            }
            const urgencyRank = { deficit: 0, thin: 1, ok: 2, surplus: 3 };
            return entries.map(([pos, v]) => {
                const need = Math.max(0, (v.minQuality || v.startingReq || 1) - (v.nflStarters || 0));
                const depthShort = Math.max(0, (v.ideal || 0) - (v.actual || 0));
                const eliteCounts = eliteTeams
                    .map(t => t.posAssessment?.[pos]?.nflStarters)
                    .filter(n => Number.isFinite(n));
                const eliteAvg = eliteCounts.length ? eliteCounts.reduce((s, n) => s + n, 0) / eliteCounts.length : null;
                return { pos, status: v.status, need, depthShort, mine: v.nflStarters || 0, required: v.minQuality || v.startingReq || 1, eliteAvg, isTarget: isTarget(pos) };
            }).sort((a, b) => {
                // True deficits always rank first; among the rest, strategy
                // targets get pulled to the top before the usual urgency order.
                const ad = a.status === 'deficit' ? 0 : 1;
                const bd = b.status === 'deficit' ? 0 : 1;
                if (ad !== bd) return ad - bd;
                if (ad === 1) {
                    const at = a.isTarget ? 0 : 1;
                    const bt = b.isTarget ? 0 : 1;
                    if (at !== bt) return at - bt;
                }
                const ur = (urgencyRank[a.status] ?? 2) - (urgencyRank[b.status] ?? 2);
                return ur !== 0 ? ur : (b.need - a.need) || (b.depthShort - a.depthShort);
            });
        }, [myAssess, allAssess, targetPositions]);

        const openGaps = gaps.filter(g => g.status === 'deficit' || g.status === 'thin');
        const topGap = openGaps[0] || null;
        const statusCol = (s) => s === 'deficit' ? colors.negative : s === 'thin' ? colors.warn : s === 'surplus' ? colors.positive : colors.textMuted;
        const needText = (g) => {
            if (g.need > 0) return 'Need ' + g.need + ' more';
            if (g.depthShort > 0) return 'Thin — add ' + g.depthShort + ' depth';
            return g.status === 'surplus' ? 'Surplus' : 'Covered';
        };

        // Concrete sources for the top gap (lg)
        const sources = React.useMemo(() => {
            if (!topGap || size !== 'lg') return { fas: [], partner: null };
            const scores = window.App?.LI?.playerScores || {};
            const normPos = window.App?.normPos || (p => p);
            const rostered = new Set();
            (currentLeague?.rosters || []).forEach(r => (r.players || []).concat(r.taxi || [], r.reserve || []).forEach(pid => rostered.add(String(pid))));
            const fas = Object.entries(scores)
                .filter(([pid, dhq]) => !rostered.has(pid) && dhq > 500 && normPos(playersData?.[pid]?.position) === topGap.pos)
                .map(([pid, dhq]) => ({ pid, dhq, name: playersData?.[pid]?.full_name || pid }))
                .sort((a, b) => b.dhq - a.dhq)
                .slice(0, 2);
            const partner = allAssess
                .filter(a => a.rosterId !== myRoster?.roster_id)
                .filter(a => (a.strengths || []).some(s => (typeof s === 'string' ? s : s?.pos) === topGap.pos))
                .sort((a, b) => (b.posAssessment?.[topGap.pos]?.nflStarters || 0) - (a.posAssessment?.[topGap.pos]?.nflStarters || 0))[0] || null;
            return { fas, partner };
        }, [topGap?.pos, size, currentLeague, playersData, allAssess, myRoster?.roster_id]);

        if (!rosterState.isUsable) {
            return window.App?.renderRosterDataBlocker?.(rosterState, {
                title: size === 'sm' ? 'Gaps paused' : 'Gap Plan paused',
                message: 'Gap analysis needs complete roster IDs.',
                detail: rosterState.detail,
                compact: size === 'sm' || size === 'md',
                fill: true,
                actionLabel: size === 'sm' ? null : 'Open Roster',
                onAction: (e) => goTo('myteam', e),
                style: { cursor: isClickable ? 'pointer' : 'default' },
            });
        }

        function header(opts = {}) {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: opts.large ? '1.05rem' : '0.95rem' }}>🧩</span>
                    <span style={{ fontFamily: fonts.display, fontSize: fs(opts.large ? 1.0 : 0.9), fontWeight: 700, color: colors.negative || 'var(--k-e74c3c, #e74c3c)', letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Gap Plan</span>
                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textMuted, fontFamily: fonts.ui, whiteSpace: 'nowrap' }}>{openGaps.length ? openGaps.length + ' open gap' + (openGaps.length !== 1 ? 's' : '') : 'all covered'}</span>
                    <button onClick={e => goTo('fa', e)} title="Open Free Agency" style={{ padding: '3px 8px', minHeight: '44px', marginTop: '-10px', marginBottom: '-10px', display: 'inline-flex', alignItems: 'center', background: wrAlpha(colors.info || 'var(--k-3498db, #3498db)', '1A'), color: colors.info || 'var(--k-3498db, #3498db)', border: '1px solid ' + wrAlpha(colors.info || 'var(--k-3498db, #3498db)', '47'), borderRadius: '5px', cursor: 'pointer', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: fonts.ui, fontWeight: 700, whiteSpace: 'nowrap' }}>FA</button>
                </div>
            );
        }

        // you-vs-elite-tier dot strip: filled = starter-quality you have
        function countBar(g) {
            const slots = Math.max(g.required, g.mine, Math.ceil(g.eliteAvg || 0));
            const dots = [];
            for (let i = 0; i < Math.min(slots, 6); i++) {
                dots.push(
                    <span key={i} style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: i < g.mine ? statusCol(g.status) : 'var(--ov-4, rgba(255,255,255,0.06))',
                        border: '1px solid ' + (i < g.required ? wrAlpha(statusCol(g.status), '66') : 'var(--ov-5, rgba(255,255,255,0.08))'),
                        flexShrink: 0,
                    }} />
                );
            }
            return <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>{dots}</div>;
        }

        // ── SM: biggest gap hero ──
        if (size === 'sm') {
            return (
                <div onClick={e => goTo(topGap ? 'fa' : 'myteam', e)} style={{ ...cardStyle, padding: 'var(--card-pad, 14px 16px)', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '4px' }}>
                    <div style={{ fontSize: fs(0.6), color: colors.negative || 'var(--k-e74c3c, #e74c3c)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, fontFamily: fonts.ui }}>🧩 Biggest Gap</div>
                    <div style={{ fontFamily: fonts.mono, fontSize: fs(1.7), fontWeight: 700, color: topGap ? statusCol(topGap.status) : colors.positive, lineHeight: 1 }} className="wr-data-value">
                        {topGap ? (topGap.need > 0 ? '+' + topGap.need + ' ' : '') + posLabel(topGap.pos) : '✓'}
                    </div>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textMuted, fontFamily: fonts.ui, borderTop: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'), paddingTop: '4px', marginTop: '2px', width: '100%' }}>
                        {topGap
                            ? (topGap.need > 0 ? needText(topGap) + ' starter-quality ' + posLabel(topGap.pos) : needText(topGap) + ' at ' + posLabel(topGap.pos))
                            : 'No open gaps — every position covered'}
                    </div>
                </div>
            );
        }

        // ── MD / LG: gap list ──
        if (size === 'md' || size === 'lg') {
            const rows = size === 'md' ? gaps.slice(0, 4) : gaps.slice(0, 7);
            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 12px 14px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header({ large: size === 'lg' })}
                    <div style={{ flex: size === 'lg' ? '0 0 auto' : 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
                        {rows.length === 0 && (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(0.7), color: colors.textFaint, fontStyle: 'italic', fontFamily: fonts.ui }}>No assessment yet</div>
                        )}
                        {rows.map(g => (
                            <div key={g.pos} role="button" tabIndex={0} title={(g.isTarget ? 'Strategy target — ' : '') + 'Open ' + (g.need > 0 || g.depthShort > 0 ? 'Free Agency' : 'My Roster')}
                                onClick={e => goTo(g.need > 0 || g.depthShort > 0 ? 'fa' : 'myteam', e)}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(g.need > 0 || g.depthShort > 0 ? 'fa' : 'myteam', e); } }}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 6px', minHeight: '26px', borderRadius: '4px', background: g.isTarget ? wrAlpha(colors.gold || 'var(--gold, #d4af37)', '0F') : 'var(--ov-1, rgba(255,255,255,0.02))', borderLeft: '2px solid ' + (g.isTarget ? (colors.gold || 'var(--gold, #d4af37)') : statusCol(g.status)), cursor: 'pointer' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '3px', width: 30, flexShrink: 0 }}>
                                    {g.isTarget && <span title="Strategy target" style={{ width: 5, height: 5, borderRadius: '50%', background: colors.gold || 'var(--gold, #d4af37)', flexShrink: 0, boxShadow: '0 0 4px ' + wrAlpha(colors.gold || 'var(--gold, #d4af37)', '99') }} />}
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: g.isTarget ? (colors.gold || 'var(--gold, #d4af37)') : colors.text, fontFamily: fonts.ui }}>{posLabel(g.pos)}</span>
                                </span>
                                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: statusCol(g.status), fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{needText(g)}</span>
                                {countBar(g)}
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontFamily: fonts.mono, minWidth: 52, textAlign: 'right' }} title={'Your starter-quality count vs elite tier teams average'}>
                                    {g.mine}{g.eliteAvg !== null ? ' vs ' + (Math.round(g.eliteAvg * 10) / 10) : ''}
                                </span>
                            </div>
                        ))}
                        {size === 'md' && gaps.length > rows.length && (
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontFamily: fonts.ui, opacity: 0.7 }}>+{gaps.length - rows.length} more positions</div>
                        )}
                    </div>
                    {size === 'md' && (
                        <div style={{ flexShrink: 0, fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontFamily: fonts.ui, opacity: 0.65, marginTop: '4px' }}>count = starter-quality players · vs elite tier teams</div>
                    )}
                    {/* LG: concrete sources for the top gap */}
                    {size === 'lg' && (
                        <div style={{ flex: 1, minHeight: 0, marginTop: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', flexShrink: 0, fontFamily: fonts.ui }}>
                                {topGap ? 'Fill the ' + posLabel(topGap.pos) + ' gap' : 'Roster covered'}
                            </div>
                            {!topGap && <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontStyle: 'italic', fontFamily: fonts.ui }}>Use your surplus to stack picks or upgrade elites.</div>}
                            {topGap && sources.fas.map(p => (
                                <div key={p.pid} role="button" tabIndex={0} title="Open player card"
                                    onClick={() => openCard(p.pid)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(p.pid); } }}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', minHeight: '24px', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))', cursor: 'pointer' }}>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.info || 'var(--k-3498db, #3498db)', width: 24, fontFamily: fonts.ui }}>FA</span>
                                    <span style={{ flex: 1, minWidth: 0, fontSize: fs(0.7), fontWeight: 600, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.accent, fontFamily: fonts.mono, minWidth: 32, textAlign: 'right' }}>{p.dhq >= 1000 ? (p.dhq / 1000).toFixed(1) + 'k' : p.dhq}</span>
                                </div>
                            ))}
                            {topGap && !sources.fas.length && (
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontFamily: fonts.ui, padding: '2px 0' }}>Wire is dry at {posLabel(topGap.pos)} — trade for it.</div>
                            )}
                            {topGap && sources.partner && (
                                <div role="button" tabIndex={0} title="Open Trade Center"
                                    onClick={e => goTo('trades', e)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo('trades', e); } }}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', minHeight: '24px', cursor: 'pointer' }}>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.purple || 'var(--k-7c6bf8, #7c6bf8)', width: 24, fontFamily: fonts.ui }}>TR</span>
                                    <span style={{ flex: 1, minWidth: 0, fontSize: fs(0.7), fontWeight: 600, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sources.partner.ownerName || sources.partner.teamName || 'League partner'}</span>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textMuted, fontFamily: fonts.ui, whiteSpace: 'nowrap' }}>has {posLabel(topGap.pos)} surplus →</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        return null;
    }

    window.GapPlanWidget = GapPlanWidget;
})();
