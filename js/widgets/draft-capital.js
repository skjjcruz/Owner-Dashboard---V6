// ══════════════════════════════════════════════════════════════════
// js/widgets/draft-capital.js — Draft Capital widget (v3)
//
// Pick inventory, league capital rank, draft countdown.
//
// sm: total DHQ value + pick count + countdown
// md: pick distribution by year (bars) + top pick highlights
// lg: capital rank + inventory by year (no scroll, fits 320px)
// xxl: lg + Big Board snapshot (top available players)
// ══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function DraftCapitalWidget({ size, myRoster, currentLeague, playersData, briefDraftInfo, setActiveTab, navigateWidget }) {
        const theme = window.WrTheme?.get?.() || {};
        const colors = theme.colors || {};
        const fonts = theme.fonts || {};
        const cardStyle = window.WrTheme?.cardStyle?.() || {};
        const fs = (rem) => window.WrTheme?.fontSize?.(rem) || (rem + 'rem');
        // Free/Pro (fail-open): pick inventory/values/countdown stay free;
        // the xxl Pick Strategy target recs are Pro.
        const pro = typeof window.wrIsPro !== 'function' || window.wrIsPro();

        const myRid = myRoster?.roster_id;
        const season = String(currentLeague?.season || new Date().getFullYear());
        const draftRounds = currentLeague?.settings?.draft_rounds || 5;
        const totalTeams = currentLeague?.rosters?.length || 12;
        const tradedPicks = window.S?.tradedPicks || [];

        // ── GM Strategy: tilt how we read/order pick capital ──
        const gm = window.WR.GmMode.useGmEffects(currentLeague);
        const draftStyle = gm?.draftStyle || 'bpa';
        const timeline = gm?.timeline || '2_3_years';
        // Strategy posture drives ordering + a one-line tag.
        // accumulate → value every pick (stack capital); consolidate → early
        // picks matter most; positional_need → neutral. Timeline shades which
        // years we lean on: 1_year → near-term, dynasty_long → future.
        const draftPosture = React.useMemo(() => {
            const nearYear = parseInt(season);
            const styleMap = {
                accumulate: { tag: 'Stacking capital', detail: 'all picks valued', order: 'value', emphasis: 'all' },
                consolidate: { tag: 'Consolidating', detail: 'early picks emphasized', order: 'value', emphasis: 'early' },
                positional_need: { tag: 'Filling needs', detail: 'neutral capital read', order: 'none', emphasis: 'none' },
                bpa: { tag: 'Best available', detail: 'neutral capital read', order: 'none', emphasis: 'none' },
            };
            const base = styleMap[draftStyle] || styleMap.bpa;
            const timelineMap = {
                '1_year': { tag: 'near-term picks', favorNear: true, favorFar: false },
                'dynasty_long': { tag: 'future picks', favorNear: false, favorFar: true },
                '2_3_years': { tag: null, favorNear: false, favorFar: false },
            };
            const tl = timelineMap[timeline] || timelineMap['2_3_years'];
            return {
                ...base,
                tl,
                nearYear,
                // Years worth emphasizing under the timeline lean.
                favorNear: tl.favorNear,
                favorFar: tl.favorFar,
                label: base.tag + (tl.tag ? ' · ' + tl.tag : ''),
                active: gm?.hasStrategy && (base.order !== 'none' || tl.favorNear || tl.favorFar),
            };
        }, [draftStyle, timeline, season, gm?.hasStrategy]);

        // Per-pick strategy weight: blends round emphasis (consolidate) and
        // year emphasis (timeline). Higher = more strategy-relevant.
        const pickStratWeight = React.useCallback((p) => {
            let w = 0;
            if (draftPosture.emphasis === 'early' && p.round <= 2) w += 2;
            if (draftPosture.favorNear && p.year === draftPosture.nearYear) w += 2;
            if (draftPosture.favorFar && p.year > draftPosture.nearYear) w += 1.5;
            return w;
        }, [draftPosture]);
        // Does this pick get a strategy accent dot?
        const isStratPick = React.useCallback((p) => draftPosture.active && pickStratWeight(p) > 0, [draftPosture, pickStratWeight]);

        // ── Pick inventory ──
        const picks = React.useMemo(() => {
            const inv = [];
            const pvFn = window.App?.PlayerValue?.getPickValue;
            for (let yr = parseInt(season); yr <= parseInt(season) + 2; yr++) {
                for (let rd = 1; rd <= draftRounds; rd++) {
                    // tradedAway and acquired are independent — dealing your own
                    // pick in a round must NOT drop picks acquired in that same
                    // round (mirrors the leagueCapital memo below).
                    const tradedAway = tradedPicks.find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === myRid && p.owner_id !== myRid);
                    const acquired = tradedPicks.filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === myRid && p.roster_id !== myRid);
                    if (!tradedAway) {
                        const val = pvFn ? pvFn(yr, rd, totalTeams, Math.ceil(totalTeams / 2)) : Math.max(500, 10000 - rd * 2000);
                        inv.push({ year: yr, round: rd, own: true, value: val, label: yr === parseInt(season) ? 'R' + rd : "'" + String(yr).slice(-2) + ' R' + rd });
                    }
                    acquired.forEach(a => {
                        const fromRoster = (currentLeague?.rosters || []).find(r => r.roster_id === a.roster_id);
                        const fromUser = fromRoster ? (window.S?.leagueUsers || []).find(u => u.user_id === fromRoster.owner_id) : null;
                        const fromName = fromUser?.display_name || ('T' + a.roster_id);
                        const val = pvFn ? pvFn(yr, rd, totalTeams, Math.ceil(totalTeams / 2)) : Math.max(500, 10000 - rd * 2000);
                        inv.push({ year: yr, round: rd, own: false, from: fromName, value: val, label: 'R' + rd + ' (' + fromName.slice(0, 6) + ')' });
                    });
                }
            }
            return inv;
        }, [myRid, season, draftRounds, totalTeams, tradedPicks]);

        const totalValue = picks.reduce((s, p) => s + (p.value || 0), 0);
        const pickCount = picks.length;
        const maxRoundVal = Math.max(...picks.map(p => p.value || 0), 1);

        // Draft countdown — 'LIVE' only when the draft is actually underway;
        // a lapsed start_time with status still pre_draft just means the room
        // hasn't opened yet.
        const countdown = React.useMemo(() => {
            if (briefDraftInfo?.status === 'drafting') return { text: 'LIVE', live: true };
            if (!briefDraftInfo?.start_time || briefDraftInfo.status !== 'pre_draft') return null;
            const diff = briefDraftInfo.start_time - Date.now();
            if (diff <= 0) return { text: 'Today', live: false };
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            return { text: days > 0 ? days + 'd ' + hours + 'h' : hours + 'h', live: false };
        }, [briefDraftInfo]);

        const valCol = totalValue >= 20000 ? colors.positive : totalValue >= 10000 ? colors.accent : colors.negative;
        const isClickable = size === 'sm' || size === 'md';
        const openDraft = (e) => {
            e?.stopPropagation?.();
            if (navigateWidget) navigateWidget('draft');
            else if (setActiveTab) setActiveTab('draft');
        };
        const onClick = () => { if (isClickable) openDraft(); };
        const openCard = (pid) => {
            if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
            else if (typeof window.openPlayerModal === 'function') window.openPlayerModal(pid);
        };

        // Group picks by year (used by lg/xxl). When a draft posture is active,
        // float strategy-relevant picks to the top of each year so the rows the
        // current GM Strategy cares about read first (and survive maxPerYear).
        const picksByYear = React.useMemo(() => {
            const groups = {};
            picks.forEach(p => {
                const yr = p.year || 'Unknown';
                if (!groups[yr]) groups[yr] = [];
                groups[yr].push(p);
            });
            if (draftPosture.active) {
                Object.values(groups).forEach(g => g.sort((a, b) =>
                    (pickStratWeight(b) - pickStratWeight(a)) || (b.value - a.value)));
            }
            return Object.entries(groups).sort((a, b) => a[0] - b[0]);
        }, [picks, draftPosture, pickStratWeight]);

        // League capital per team (rank strip + xxl chart). Hoisted above the
        // size branches: a useMemo inside `if (size === 'xxl')` violates the
        // rules of hooks and crashes when a widget is resized in place.
        const leagueCapital = React.useMemo(() => {
            const allRosters = currentLeague?.rosters || [];
            const leagueSeason = parseInt(currentLeague?.season) || new Date().getFullYear();
            return allRosters.map(r => {
                let cap = 0;
                for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                    for (let rd = 1; rd <= draftRounds; rd++) {
                        const pv = typeof window.getIndustryPickValue === 'function'
                            ? window.getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds)
                            : window.App?.PlayerValue?.getPickValue?.(yr, rd, totalTeams) || 0;
                        const tradedAway = (tradedPicks || []).find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === r.roster_id && p.owner_id !== r.roster_id);
                        if (!tradedAway) cap += pv;
                        const acquired = (tradedPicks || []).filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === r.roster_id && p.roster_id !== r.roster_id);
                        acquired.forEach(() => { cap += pv; });
                    }
                }
                const user = (currentLeague?.users || window.S?.leagueUsers || []).find(u => u.user_id === r.owner_id);
                return { rid: r.roster_id, name: user?.metadata?.team_name || user?.display_name || ('Team ' + r.roster_id), cap, isMe: r.roster_id === myRid };
            }).sort((a, b) => b.cap - a.cap);
        }, [currentLeague, draftRounds, totalTeams, tradedPicks, myRid]);
        const leagueCapitalRank = {
            rank: (leagueCapital.findIndex(t => t.rid === myRid) + 1) || '—',
            total: leagueCapital.length,
        };

        // Pick value equivalent label
        const pickEquiv = (val) => {
            if (val >= 7000) return 'QB1/RB1';
            if (val >= 5000) return 'WR1';
            if (val >= 3000) return 'starter';
            if (val >= 1500) return 'flex';
            if (val >= 500) return 'depth';
            return '';
        };

        // ── SM: total value hero ──
        if (size === 'sm') {
            return (
                <div onClick={onClick} style={{
                    ...cardStyle, padding: 'var(--card-pad, 14px 16px)', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center',
                }}>
                    <div style={{
                        fontFamily: fonts.mono, fontSize: fs(1.6), fontWeight: 700,
                        color: valCol, lineHeight: 1,
                    }} className="wr-data-value">
                        {totalValue >= 1000 ? (totalValue / 1000).toFixed(1) + 'k' : totalValue}
                    </div>
                    <div style={{ fontSize: fs(0.85), color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px', fontFamily: fonts.ui }}>
                        {pickCount} PICKS
                    </div>
                    {draftPosture.active && (
                        <div title={'GM Strategy · ' + draftPosture.detail} style={{ marginTop: '4px', fontSize: fs(0.5), fontWeight: 700, color: colors.warn || 'var(--k-f0a500, #f0a500)', fontFamily: fonts.ui, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{draftPosture.tag}</div>
                    )}
                    {countdown && (
                        <div style={{
                            marginTop: '6px', fontSize: fs(0.64),
                            color: countdown.live ? colors.positive : colors.accent,
                            fontWeight: 700, fontFamily: fonts.ui,
                        }}>{countdown.live ? '🔴 LIVE' : countdown.text}</div>
                    )}
                </div>
            );
        }

        // ── MD: bars per year + 2 best picks ──
        if (size === 'md') {
            const yearTotals = picksByYear.map(([year, ypicks]) => {
                const total = ypicks.reduce((s, p) => s + (p.value || 0), 0);
                const count = ypicks.length;
                return { year, total, count };
            });
            const maxYearTotal = Math.max(...yearTotals.map(y => y.total), 1);
            // With a draft posture active, surface the on-strategy picks first;
            // otherwise fall back to pure value (existing behavior).
            const top2 = [...picks].sort((a, b) =>
                (draftPosture.active ? (pickStratWeight(b) - pickStratWeight(a)) : 0) || (b.value - a.value)
            ).slice(0, 2);
            const top2Label = draftPosture.active ? 'On-strategy: ' : 'Best: ';

            return (
                <div onClick={onClick} style={{ ...cardStyle, padding: 'var(--card-pad-sm, 10px 12px)', cursor: 'pointer', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.95rem' }}>🎯</span>
                        <span style={{ fontFamily: fonts.display, fontSize: fs(0.85), fontWeight: 700, color: colors.warn || 'var(--k-f0a500, #f0a500)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Draft Capital</span>
                        {draftPosture.active && (
                            <span title={'GM Strategy · ' + draftPosture.detail} style={{ fontSize: fs(0.46), fontWeight: 700, color: colors.warn || 'var(--k-f0a500, #f0a500)', fontFamily: fonts.ui, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '1px 4px', borderRadius: 3, background: wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '1A'), border: '1px solid ' + wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '40'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>{draftPosture.label}</span>
                        )}
                        <span style={{ flex: 1 }} />
                        {countdown && <span style={{ fontSize: fs(0.6), color: countdown.live ? colors.positive : colors.accent, fontWeight: 700, fontFamily: fonts.ui }}>{countdown.live ? '🔴' : countdown.text}</span>}
                    </div>
                    {/* Year value bars */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0, marginBottom: '6px' }}>
                        {yearTotals.map((y, i) => {
                            const pct = (y.total / maxYearTotal) * 100;
                            const col = y.total >= 7000 ? colors.positive : y.total >= 3000 ? colors.accent : colors.textMuted;
                            return (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.textMuted, width: 30, fontFamily: fonts.mono }}>{y.year}</span>
                                    <div style={{ flex: 1, height: 12, background: 'var(--ov-3, rgba(255,255,255,0.04))', borderRadius: 2, overflow: 'hidden' }}>
                                        <div style={{ width: pct + '%', height: '100%', background: col }} />
                                    </div>
                                    <span style={{ fontSize: fs(0.56), fontWeight: 700, color: col, fontFamily: fonts.mono, minWidth: 36, textAlign: 'right' }}>{y.count}p · {y.total >= 1000 ? (y.total / 1000).toFixed(1) + 'k' : y.total}</span>
                                </div>
                            );
                        })}
                    </div>
                    {/* Top picks */}
                    <div style={{ flex: 1, minHeight: 0, fontSize: fs(0.62), color: colors.textMuted, fontFamily: fonts.ui, lineHeight: 1.4, borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))', paddingTop: '4px' }}>
                        {top2.length
                            ? top2Label + top2.map(p => p.label + ' (' + (p.value >= 1000 ? (p.value / 1000).toFixed(1) + 'k' : p.value) + (pickEquiv(p.value) ? ', ' + pickEquiv(p.value) : '') + ')').join(' · ')
                            : 'No picks owned — all draft capital traded away'}
                    </div>
                </div>
            );
        }

        // ── Reusable inventory list (lg/xxl) ──
        function renderInventory(opts = {}) {
            const compact = !!opts.compact;
            // maxPerYear keeps 5-round leagues from rendering ~18 rows into a
            // 2x2 card and silently clipping; truncated years get a "+N" line.
            const maxPerYear = opts.maxPerYear || Infinity;
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '4px' : '6px' }}>
                    {picksByYear.map(([year, allYearPicks], yi) => {
                        const yearPicks = allYearPicks.slice(0, maxPerYear);
                        const yearHidden = allYearPicks.length - yearPicks.length;
                        const yearTotal = allYearPicks.reduce((s, p) => s + (p.value || 0), 0);
                        return (
                            <div key={year}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                                    <span style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, fontFamily: fonts.ui }}>{year}</span>
                                    <div style={{ flex: 1, height: 1, background: 'var(--ov-4, rgba(255,255,255,0.06))' }} />
                                    <span style={{ fontSize: fs(0.54), color: colors.textMuted, fontFamily: fonts.mono }}>
                                        {yearPicks.length}p · {yearTotal >= 1000 ? (yearTotal / 1000).toFixed(1) + 'k' : yearTotal}
                                    </span>
                                </div>
                                {yearPicks.map((p, i) => {
                                    const equiv = pickEquiv(p.value);
                                    const strat = isStratPick(p);
                                    return (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '1px 0', fontSize: fs(compact ? 0.56 : 0.62) }}>
                                            {strat && <span title={'On-strategy: ' + draftPosture.tag} style={{ width: 5, height: 5, borderRadius: '50%', background: colors.warn || 'var(--k-f0a500, #f0a500)', flexShrink: 0, boxShadow: '0 0 4px ' + wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '99') }} />}
                                            <span style={{ fontWeight: 700, color: p.own ? colors.text : colors.accent, minWidth: 60, fontFamily: fonts.ui }}>{p.label}</span>
                                            {!p.own && <span style={{ fontSize: fs(0.48), fontWeight: 700, color: colors.purple || 'var(--k-7c6bf8, #7c6bf8)', padding: '0 3px', background: wrAlpha(colors.purple || 'var(--k-7c6bf8, #7c6bf8)', '18'), borderRadius: 2 }}>TR</span>}
                                            <div style={{ flex: 1, height: 4, background: 'var(--ov-3, rgba(255,255,255,0.04))', borderRadius: 2, overflow: 'hidden' }}>
                                                <div style={{ width: ((p.value / maxRoundVal) * 100) + '%', height: '100%', background: p.round <= 2 ? colors.accent : wrAlpha(colors.textMuted, '88') }} />
                                            </div>
                                            <span style={{ fontSize: fs(0.54), fontWeight: 700, color: colors.textMuted, minWidth: 30, textAlign: 'right', fontFamily: fonts.mono }}>
                                                {p.value >= 1000 ? (p.value / 1000).toFixed(1) + 'k' : p.value}
                                            </span>
                                            {equiv && !compact && <span style={{ fontSize: fs(0.5), color: colors.textFaint, fontFamily: fonts.ui, minWidth: 40 }}>{equiv}</span>}
                                        </div>
                                    );
                                })}
                                {yearHidden > 0 && (
                                    <div style={{ fontSize: fs(0.5), color: colors.textFaint, fontFamily: fonts.ui, padding: '1px 0 1px 2px', opacity: 0.7 }}>+{yearHidden} more pick{yearHidden !== 1 ? 's' : ''}</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            );
        }

        // ── Capital rank header strip ──
        function renderRankStrip() {
            return (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '6px 10px',
                    background: 'var(--ov-1, rgba(255,255,255,0.02))',
                    border: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'),
                    borderRadius: '6px',
                }}>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontFamily: fonts.mono, fontSize: fs(1.05), fontWeight: 700, color: valCol, lineHeight: 1 }} className="wr-data-value">
                            {totalValue >= 1000 ? (totalValue / 1000).toFixed(1) + 'k' : totalValue}
                        </div>
                        <div style={{ fontSize: fs(0.54), color: colors.textMuted, fontFamily: fonts.ui }}>TOTAL DHQ</div>
                    </div>
                    <div style={{ width: 1, height: 28, background: 'var(--ov-5, rgba(255,255,255,0.08))' }} />
                    <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontFamily: fonts.mono, fontSize: fs(1.05), fontWeight: 700, color: colors.accent, lineHeight: 1 }}>#{leagueCapitalRank.rank}</div>
                        <div style={{ fontSize: fs(0.54), color: colors.textMuted, fontFamily: fonts.ui }}>OF {leagueCapitalRank.total}</div>
                    </div>
                    <div style={{ width: 1, height: 28, background: 'var(--ov-5, rgba(255,255,255,0.08))' }} />
                    <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontFamily: fonts.mono, fontSize: fs(1.05), fontWeight: 700, color: colors.text, lineHeight: 1 }}>{pickCount}</div>
                        <div style={{ fontSize: fs(0.54), color: colors.textMuted, fontFamily: fonts.ui }}>PICKS</div>
                    </div>
                </div>
            );
        }

        // ── Header ──
        function header() {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '1rem' }}>🎯</span>
                    <span style={{ fontFamily: fonts.display, fontSize: fs(0.95), fontWeight: 700, color: colors.warn || 'var(--k-f0a500, #f0a500)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Draft Capital</span>
                    {draftPosture.active && (
                        <span title={'GM Strategy · ' + draftPosture.detail} style={{ fontSize: fs(0.5), fontWeight: 700, color: colors.warn || 'var(--k-f0a500, #f0a500)', fontFamily: fonts.ui, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '1px 5px', borderRadius: 3, background: wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '1A'), border: '1px solid ' + wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '40'), whiteSpace: 'nowrap' }}>{draftPosture.label}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    {countdown && <span style={{ fontSize: fs(0.62), color: countdown.live ? colors.positive : colors.accent, fontWeight: 700, fontFamily: fonts.ui }}>{countdown.live ? '🔴 LIVE' : countdown.text}</span>}
                    <button onClick={openDraft} title="Open Draft Command" style={{ padding: '3px 8px', background: wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '1A'), color: colors.warn || 'var(--k-f0a500, #f0a500)', border: '1px solid ' + wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '47'), borderRadius: '5px', cursor: 'pointer', fontSize: fs(0.56), fontFamily: fonts.ui, fontWeight: 700, whiteSpace: 'nowrap' }}>Draft</button>
                </div>
            );
        }

        // ── LG: capital rank + inventory (no scroll) ──
        if (size === 'lg') {
            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad-sm, 10px 12px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header()}
                    <div style={{ marginBottom: '8px', flexShrink: 0 }}>{renderRankStrip()}</div>
                    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                        {renderInventory({ compact: true, maxPerYear: 3 })}
                    </div>
                </div>
            );
        }

        // ── XXL: lg + Big Board + Pick Strategy + League Capital chart ──
        if (size === 'xxl') {
            // Top available players (proxy for big board): un-rostered, sorted by DHQ.
            // Only positions this league actually rosters — otherwise team
            // defenses (DEF) leak into IDP leagues like Psycho that don't use them.
            const scores = window.App?.LI?.playerScores || {};
            const rostered = new Set();
            (currentLeague?.rosters || []).forEach(r => (r.players || []).concat(r.taxi || [], r.reserve || []).forEach(pid => rostered.add(String(pid))));
            const allowedPos = (window.App?.leaguePlayablePositions ? window.App.leaguePlayablePositions(currentLeague?.roster_positions) : null);
            const bigBoard = Object.entries(scores)
                .filter(([pid]) => !rostered.has(pid))
                .map(([pid, dhq]) => {
                    const p = playersData?.[pid] || {};
                    const rawAge = p.age || (p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null);
                    return {
                        pid, name: p.full_name || pid,
                        pos: window.App?.normPos?.(p.position) || p.position || '?',
                        age: Number.isFinite(rawAge) ? rawAge : null,
                        team: p.team || 'FA', dhq,
                    };
                })
                .filter(p => !allowedPos || !allowedPos.length || allowedPos.includes(p.pos))
                .sort((a, b) => b.dhq - a.dhq)
                .slice(0, 20);

            // League capital chart uses the hoisted leagueCapital memo.
            // Cap the list so the flexShrink:0 bottom grid can't clip the top
            // half in big leagues: top 8 + the user's row (with true rank).
            const maxLeagueCap = Math.max(...leagueCapital.map(t => t.cap), 1);
            const capBudget = 8;
            const myCapIdx = leagueCapital.findIndex(t => t.isMe);
            const capRows = leagueCapital
                .map((t, i) => ({ ...t, rank: i + 1 }))
                .filter((t, i) => i < (myCapIdx >= capBudget ? capBudget - 1 : capBudget) || t.isMe);
            const capHidden = leagueCapital.length - capRows.length;

            // Pick strategy: top picks + biggest roster needs, side by side.
            // No per-pick target mapping — we have no positional-value/ADP
            // logic tying a specific pick to a specific need, so don't invent one.
            const myAssess = typeof window.assessTeamFromGlobal === 'function' && myRid
                ? window.assessTeamFromGlobal(myRid)
                : null;
            const myNeeds = (myAssess?.needs || []).map(n => typeof n === 'string' ? n : n?.pos).filter(Boolean);
            const topPicks = [...picks].sort((a, b) => b.value - a.value).slice(0, 4);

            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 16px 18px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header()}
                    <div style={{ marginBottom: '10px', flexShrink: 0 }}>{renderRankStrip()}</div>
                    {/* Top half: 2-col inventory + big board */}
                    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px', marginBottom: '10px', overflow: 'hidden' }}>
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Pick Inventory</div>
                            {renderInventory({ compact: true })}
                        </div>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui, flexShrink: 0 }}>Big Board · Top Available</div>
                            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                                {bigBoard.length === 0 ? <div style={{ fontSize: fs(0.6), color: colors.textFaint, fontStyle: 'italic' }}>No players available</div> : bigBoard.map((p, i) => {
                                    const col = p.dhq >= 5000 ? colors.positive : p.dhq >= 2000 ? colors.accent : colors.textMuted;
                                    return (
                                        <div key={p.pid} role="button" tabIndex={0} title="Open player card" onClick={() => p.pid && openCard(p.pid)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.pid && openCard(p.pid); } }} style={{
                                            display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0',
                                            borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))', cursor: 'pointer',
                                            fontSize: fs(0.6), fontFamily: fonts.ui,
                                        }}>
                                            <span style={{ fontSize: fs(0.52), color: i < 3 ? colors.accent : colors.textFaint, fontWeight: 700, width: 16, textAlign: 'right', fontFamily: fonts.mono }}>{i + 1}</span>
                                            <span style={{ fontSize: fs(0.48), padding: '0 4px', borderRadius: 2, background: wrAlpha(window.App?.POS_COLORS?.[p.pos] || colors.accent, '22'), color: window.App?.POS_COLORS?.[p.pos] || colors.accent, fontWeight: 700 }}>{p.pos}</span>
                                            <span style={{ flex: 1, color: colors.text, fontWeight: i < 3 ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                            {p.age && <span style={{ fontSize: fs(0.48), color: colors.textFaint, fontFamily: fonts.mono }}>{p.age}</span>}
                                            <span style={{ fontSize: fs(0.54), fontWeight: 700, color: col, fontFamily: fonts.mono, minWidth: 30, textAlign: 'right' }}>{p.dhq >= 1000 ? (p.dhq / 1000).toFixed(1) + 'k' : p.dhq}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    {/* Bottom half: Pick Strategy + League Capital chart */}
                    <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px' }}>
                        {/* Pick Strategy */}
                        <div style={{ padding: '8px 10px', background: wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '0D'), border: '1px solid ' + wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '33'), borderRadius: '6px' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.warn || 'var(--k-f0a500, #f0a500)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Pick Strategy · Capital & Needs</div>
                            {/* pairs pick capital with the roster-needs assessment — a rec → Pro */}
                            {!pro ? (
                                typeof window.WrGatedMoreRow === 'function'
                                    ? React.createElement(window.WrGatedMoreRow, { title: 'Capital & needs read', sub: 'Your top picks alongside your biggest roster needs', feature: 'draft_archetypes' })
                                    : null
                            ) : (
                            <React.Fragment>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 12px' }}>
                                {topPicks.map((p, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: fs(0.6), fontFamily: fonts.ui }}>
                                        <span style={{ minWidth: 50, fontWeight: 700, color: colors.text }}>{p.label}</span>
                                        <span style={{ fontSize: fs(0.52), color: colors.textMuted, fontFamily: fonts.mono }}>{p.value >= 1000 ? (p.value / 1000).toFixed(1) + 'k' : p.value}</span>
                                        <span style={{ fontSize: fs(0.52), color: colors.textFaint, fontFamily: fonts.ui }}>{pickEquiv(p.value)}</span>
                                    </div>
                                ))}
                            </div>
                            {topPicks.length === 0 && (
                                <div style={{ fontSize: fs(0.6), color: colors.textFaint, fontStyle: 'italic' }}>No picks owned</div>
                            )}
                            <div style={{ marginTop: '4px', fontSize: fs(0.58), fontFamily: fonts.ui, color: colors.textMuted }}>
                                {myNeeds.length
                                    ? <React.Fragment>
                                        Biggest needs:{' '}
                                        {myNeeds.slice(0, 3).map((pos, i) => (
                                            <React.Fragment key={pos + i}>
                                                {i > 0 ? ', ' : ''}
                                                <span style={{ fontWeight: 700, color: window.App?.POS_COLORS?.[pos] || colors.accent }}>{pos}</span>
                                            </React.Fragment>
                                        ))}
                                    </React.Fragment>
                                    : 'No roster assessment available'}
                            </div>
                            </React.Fragment>
                            )}
                        </div>
                        {/* League Capital Distribution */}
                        <div style={{ padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>League Capital Distribution</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {capRows.map((t, i) => {
                                    const pct = (t.cap / maxLeagueCap) * 100;
                                    return (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: fs(0.54), fontFamily: fonts.ui }}>
                                            <span style={{ fontSize: fs(0.5), color: colors.textFaint, width: 12, textAlign: 'right', fontFamily: fonts.mono }}>{t.rank}</span>
                                            <span style={{ flex: 1, minWidth: 0, color: t.isMe ? colors.accent : colors.textMuted, fontWeight: t.isMe ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(t.isMe ? '★ ' : '') + (t.name || '').slice(0, 14)}</span>
                                            <div style={{ width: 80, height: 5, background: 'var(--ov-3, rgba(255,255,255,0.05))', borderRadius: 2, overflow: 'hidden' }}>
                                                <div style={{ width: pct + '%', height: '100%', background: t.isMe ? colors.accent : colors.textMuted, opacity: t.isMe ? 1 : 0.5 }} />
                                            </div>
                                            <span style={{ fontSize: fs(0.5), color: colors.textFaint, fontFamily: fonts.mono, minWidth: 28, textAlign: 'right' }}>{t.cap >= 1000 ? (t.cap / 1000).toFixed(1) + 'k' : t.cap}</span>
                                        </div>
                                    );
                                })}
                                {capHidden > 0 && (
                                    <div style={{ fontSize: fs(0.5), color: colors.textFaint, fontFamily: fonts.ui, paddingLeft: 18, opacity: 0.7 }}>+{capHidden} more teams</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    }

    window.DraftCapitalWidget = DraftCapitalWidget;
})();
