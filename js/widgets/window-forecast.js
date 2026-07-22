// ══════════════════════════════════════════════════════════════════
// js/widgets/window-forecast.js — Window Forecast widget
//
// WHEN does each of your position groups age out? Projects each
// group's DHQ-weighted share still inside its peak/value window over
// the next 4 seasons and flags the season the core falls off.
//
// sm:   nearest cliff hero ("WR · 2027") → My Roster
// md:   per-position lifeline bars + cliff season
// lg:   md + "Sell-by" list (high-DHQ players exiting their peak)
// tall: lg + prime% table by season + action note
//
// Depends on: theme.js (wrAlpha), core.js (normPos, posLabel,
//             getAgeCurve, LI.playerScores)
// Exposes:    window.WindowForecastWidget
// ══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'];
    const HORIZON = 4; // seasons projected (t = 0..3)

    function WindowForecastWidget({ size, myRoster, currentLeague, playersData, sleeperUserId, setActiveTab, navigateWidget }) {
        const theme = window.WrTheme?.get?.() || {};
        const colors = theme.colors || {};
        const fonts = theme.fonts || {};
        const cardStyle = window.WrTheme?.cardStyle?.() || {};
        const fs = (rem) => window.WrTheme?.fontSize?.(rem) || (rem + 'rem');
        const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters }) || { isUsable: true };
        const posLabel = (pos) => window.App?.posLabel?.(pos) || pos;
        const season = parseInt(currentLeague?.season) || new Date().getFullYear();

        // ── GM Strategy: drive the projection horizon off the GM's timeline ──
        // 1_year → 1 season, 2_3_years → 3, dynasty_long → 4 (default when no strategy).
        const gm = window.WR.GmMode.useGmEffects(currentLeague);
        const horizon = !gm?.hasStrategy
            ? HORIZON
            : gm.timeline === '1_year' ? 1
            : gm.timeline === '2_3_years' ? 3
            : gm.timeline === 'dynasty_long' ? 4
            : Math.max(1, Math.min(HORIZON, Math.round(gm.horizonYears || HORIZON)));

        const openMyRoster = (e) => {
            e?.stopPropagation?.();
            if (navigateWidget) navigateWidget('myteam');
            else if (setActiveTab) setActiveTab('myteam');
        };
        const openCard = (pid) => {
            if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
            else if (typeof window.openPlayerModal === 'function') window.openPlayerModal(pid);
        };
        const isClickable = size === 'sm' || size === 'md';

        // ── Forecast model ──────────────────────────────────────
        // primeShare(t): % of the group's DHQ belonging to players still
        // inside their position's PEAK window in season (current + t).
        // cliff = first projected season where primeShare drops below 50%.
        const forecast = React.useMemo(() => {
            if (!rosterState.isUsable) return [];
            const scores = window.App?.LI?.playerScores || {};
            const normPos = window.App?.normPos || (p => p);
            const getCurve = window.App?.getAgeCurve || (() => ({ build: [22, 24], peak: [24, 29], decline: [30, 32] }));
            const groups = {};
            (myRoster?.players || []).forEach(pid => {
                const p = playersData?.[pid];
                if (!p) return;
                const pos = normPos(p.position);
                if (!POS_ORDER.includes(pos)) return;
                const dhq = scores[pid] || 0;
                if (dhq <= 0) return;
                const rawAge = p.age || (p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null);
                if (!Number.isFinite(rawAge)) return;
                if (!groups[pos]) groups[pos] = [];
                groups[pos].push({ pid, name: p.full_name || pid, age: rawAge, dhq });
            });
            return POS_ORDER.filter(pos => groups[pos]?.length).map(pos => {
                const curve = getCurve(pos);
                const peakEnd = curve.peak?.[1] || 29;
                const declineEnd = curve.decline?.[1] || peakEnd + 3;
                const players = groups[pos].sort((a, b) => b.dhq - a.dhq);
                const totalDhq = players.reduce((s, p) => s + p.dhq, 0);
                const primeShares = [];
                for (let t = 0; t < horizon; t++) {
                    const prime = players.reduce((s, p) => s + ((p.age + t) <= peakEnd ? p.dhq : 0), 0);
                    primeShares.push(totalDhq > 0 ? prime / totalDhq : 0);
                }
                let cliffT = -1;
                for (let t = 0; t < horizon; t++) { if (primeShares[t] < 0.5) { cliffT = t; break; } }
                const wAge = totalDhq > 0 ? players.reduce((s, p) => s + p.age * p.dhq, 0) / totalDhq : 0;
                const sellBy = players.filter(p => p.age >= peakEnd - 1 && p.age <= declineEnd && p.dhq >= 2000);
                return { pos, players, totalDhq, primeShares, cliffT, wAge, peakEnd, declineEnd, sellBy };
            }).sort((a, b) => {
                const at = a.cliffT === -1 ? horizon : a.cliffT;
                const bt = b.cliffT === -1 ? horizon : b.cliffT;
                return at !== bt ? at - bt : b.totalDhq - a.totalDhq;
            });
        }, [rosterState.isUsable, myRoster, playersData, horizon]);

        const shareCol = (s) => s >= 0.65 ? colors.positive : s >= 0.4 ? colors.accent : s >= 0.2 ? colors.warn : colors.negative;
        const cliffLabel = (g) => g.cliffT === -1 ? (season + horizon) + '+' : g.cliffT === 0 ? 'NOW' : String(season + g.cliffT);
        const cliffCol = (g) => g.cliffT === -1 ? colors.positive : g.cliffT === 0 ? colors.negative : g.cliffT === 1 ? colors.warn : colors.accent;
        const nearest = forecast.find(g => g.cliffT >= 0);
        const sellByAll = forecast.flatMap(g => g.sellBy.map(p => ({ ...p, pos: g.pos, peakEnd: g.peakEnd }))).sort((a, b) => b.dhq - a.dhq);

        if (!rosterState.isUsable) {
            return window.App?.renderRosterDataBlocker?.(rosterState, {
                title: size === 'sm' ? 'Forecast paused' : 'Window Forecast paused',
                message: 'Age projections need complete roster IDs.',
                detail: rosterState.detail,
                compact: size === 'sm' || size === 'md',
                fill: true,
                actionLabel: size === 'sm' ? null : 'Open Roster',
                onAction: openMyRoster,
                style: { cursor: isClickable ? 'pointer' : 'default' },
            });
        }

        if (!forecast.length) {
            return (
                <div onClick={isClickable ? openMyRoster : undefined} style={{ ...cardStyle, padding: 'var(--card-pad, 14px 16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isClickable ? 'pointer' : 'default' }}>
                    <div style={{ fontSize: fs(0.7), color: colors.textFaint, fontStyle: 'italic', fontFamily: fonts.ui }}>No age data yet — sync your roster.</div>
                </div>
            );
        }

        // ── Lifeline bar: 4 season segments colored by prime share ──
        function lifeline(g, height) {
            return (
                <div style={{ display: 'flex', gap: '2px', flex: 1, minWidth: 0 }}>
                    {g.primeShares.map((s, t) => (
                        <div key={t} title={(season + t) + ': ' + Math.round(s * 100) + '% of ' + posLabel(g.pos) + ' value in prime'}
                            style={{ flex: 1, height, borderRadius: 2, background: wrAlpha(shareCol(s), s >= 0.2 ? 'CC' : '66'), minWidth: 0 }} />
                    ))}
                </div>
            );
        }

        function header(opts = {}) {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: opts.large ? '1.05rem' : '0.95rem' }}>⏳</span>
                    <span style={{ fontFamily: fonts.display, fontSize: fs(opts.large ? 1.0 : 0.9), fontWeight: 700, color: colors.warn || 'var(--k-f0a500, #f0a500)', letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Window Forecast</span>
                    {gm?.hasStrategy && (
                        <span title={'Horizon set by GM Strategy timeline (' + (gm.modeLabel || 'plan') + ')'} style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', fontFamily: fonts.mono, whiteSpace: 'nowrap', padding: '1px 6px', borderRadius: '4px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))' }}>{horizon}yr</span>
                    )}
                    {nearest
                        ? <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: cliffCol(nearest), fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>{posLabel(nearest.pos)} cliff {cliffLabel(nearest)}</span>
                        : <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.positive, fontFamily: fonts.ui, whiteSpace: 'nowrap' }}>No cliffs in view</span>}
                    {opts.button && <button onClick={openMyRoster} title="Open My Roster" style={{ padding: '3px 8px', minHeight: '44px', marginTop: '-10px', marginBottom: '-10px', display: 'inline-flex', alignItems: 'center', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: '5px', cursor: 'pointer', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: fonts.ui, fontWeight: 700, whiteSpace: 'nowrap' }}>Roster</button>}
                </div>
            );
        }

        // ── SM: nearest-cliff hero ──
        if (size === 'sm') {
            const g = nearest || forecast[0];
            return (
                <div onClick={openMyRoster} style={{ ...cardStyle, padding: 'var(--card-pad, 14px 16px)', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '4px' }}>
                    <div style={{ fontSize: fs(0.6), color: colors.warn || 'var(--k-f0a500, #f0a500)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, fontFamily: fonts.ui }}>⏳ Next Cliff</div>
                    <div style={{ fontFamily: fonts.mono, fontSize: fs(1.6), fontWeight: 700, color: cliffCol(g), lineHeight: 1 }} className="wr-data-value">
                        {nearest ? posLabel(g.pos) + ' ' + cliffLabel(g) : 'None'}
                    </div>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textMuted, fontFamily: fonts.ui, borderTop: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'), paddingTop: '4px', marginTop: '2px', width: '100%' }}>
                        {nearest
                            ? Math.round(g.primeShares[Math.max(g.cliffT, 0)] * 100) + '% of ' + posLabel(g.pos) + ' value in prime by then'
                            : 'Every group holds 50%+ prime value through ' + (season + horizon - 1)}
                    </div>
                </div>
            );
        }

        // ── MD: per-position lifelines ──
        if (size === 'md') {
            const rows = forecast.slice(0, 4);
            return (
                <div onClick={openMyRoster} style={{ ...cardStyle, padding: 'var(--card-pad, 12px 14px)', cursor: 'pointer', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header()}
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
                        {rows.map(g => (
                            <div key={g.pos} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.textMuted, width: 30, fontFamily: fonts.ui }}>{posLabel(g.pos)}</span>
                                {lifeline(g, 10)}
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: cliffCol(g), fontFamily: fonts.mono, minWidth: 38, textAlign: 'right' }}>{cliffLabel(g)}</span>
                            </div>
                        ))}
                        {forecast.length > rows.length && (
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontFamily: fonts.ui, opacity: 0.7 }}>+{forecast.length - rows.length} more groups</div>
                        )}
                    </div>
                </div>
            );
        }

        // ── LG / TALL ──
        if (size === 'lg' || size === 'tall') {
            const rows = size === 'lg' ? forecast.slice(0, 6) : forecast;
            const sells = sellByAll.slice(0, size === 'lg' ? 3 : 5);
            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 12px 14px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header({ large: true, button: true })}
                    {/* Season axis */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexShrink: 0 }}>
                        <span style={{ width: 30 }} />
                        <div style={{ display: 'flex', gap: '2px', flex: 1 }}>
                            {Array.from({ length: horizon }, (_, t) => (
                                <span key={t} style={{ flex: 1, fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontFamily: fonts.mono, textAlign: 'center', opacity: 0.7 }}>{String(season + t).slice(-2)}</span>
                            ))}
                        </div>
                        <span style={{ minWidth: 38, fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, textAlign: 'right', fontFamily: fonts.ui, opacity: 0.7 }}>cliff</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flexShrink: 0 }}>
                        {rows.map(g => (
                            <div key={g.pos} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.textMuted, width: 30, fontFamily: fonts.ui }}>{posLabel(g.pos)}</span>
                                {lifeline(g, 12)}
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: cliffCol(g), fontFamily: fonts.mono, minWidth: 38, textAlign: 'right' }}>{cliffLabel(g)}</span>
                            </div>
                        ))}
                    </div>
                    {/* Sell-by list */}
                    <div style={{ flex: 1, minHeight: 0, marginTop: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.warn || 'var(--k-f0a500, #f0a500)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', flexShrink: 0, fontFamily: fonts.ui }}>Sell-By Candidates</div>
                        {sells.length === 0
                            ? <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontStyle: 'italic', fontFamily: fonts.ui }}>Nobody is aging out of their prime — core is young.</div>
                            : sells.map(p => {
                                const yrsPastPeak = p.age - p.peakEnd;
                                const note = yrsPastPeak >= 1 ? 'past peak' : yrsPastPeak === 0 ? 'final prime year' : 'prime ends next yr';
                                return (
                                    <div key={p.pid} role="button" tabIndex={0} title="Open player card"
                                        onClick={() => openCard(p.pid)}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(p.pid); } }}
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', minHeight: '26px', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))', cursor: 'pointer' }}>
                                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.textMuted, width: 26, fontFamily: fonts.ui }}>{posLabel(p.pos)}</span>
                                        <span style={{ flex: 1, minWidth: 0, fontSize: fs(0.7), fontWeight: 600, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.warn || 'var(--k-f0a500, #f0a500)', fontFamily: fonts.ui, whiteSpace: 'nowrap' }}>{note}</span>
                                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontFamily: fonts.mono, minWidth: 18, textAlign: 'right' }}>{p.age}</span>
                                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: p.dhq >= 5000 ? colors.positive : colors.accent, fontFamily: fonts.mono, minWidth: 32, textAlign: 'right' }}>{p.dhq >= 1000 ? (p.dhq / 1000).toFixed(1) + 'k' : p.dhq}</span>
                                    </div>
                                );
                            })}
                    </div>
                    {/* TALL extras: prime% table + action note */}
                    {size === 'tall' && (
                        <React.Fragment>
                            <div style={{ marginTop: '8px', flexShrink: 0, padding: '6px 8px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'), borderRadius: '6px' }}>
                                <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>% of value in prime · by season</div>
                                {forecast.map(g => (
                                    <div key={g.pos} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '1px 0' }}>
                                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.textMuted, width: 30, fontFamily: fonts.ui }}>{posLabel(g.pos)}</span>
                                        {g.primeShares.map((s, t) => (
                                            <span key={t} style={{ flex: 1, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: fonts.mono, color: shareCol(s), textAlign: 'center' }}>{Math.round(s * 100)}</span>
                                        ))}
                                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontFamily: fonts.mono, minWidth: 30, textAlign: 'right' }}>~{g.wAge.toFixed(1)}</span>
                                    </div>
                                ))}
                            </div>
                            <div style={{ marginTop: '8px', flexShrink: 0, padding: '8px 10px', background: wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '0D'), border: '1px solid ' + wrAlpha(colors.warn || 'var(--k-f0a500, #f0a500)', '33'), borderRadius: '6px', fontSize: fs(0.7), color: colors.textMuted, lineHeight: 1.5, fontFamily: fonts.ui }}>
                                {nearest
                                    ? <span><strong style={{ color: colors.warn || 'var(--k-f0a500, #f0a500)' }}>{posLabel(nearest.pos)}</strong> is your first cliff ({cliffLabel(nearest)}). {sellByAll.length ? 'Move ' + sellByAll[0].name + ' while contenders still pay prime prices.' : 'Start sourcing younger ' + posLabel(nearest.pos) + ' depth now.'}</span>
                                    : 'Your core stays in its prime through ' + (season + horizon - 1) + ' — extend the window by flipping aging depth for picks.'}
                            </div>
                        </React.Fragment>
                    )}
                </div>
            );
        }

        return null;
    }

    window.WindowForecastWidget = WindowForecastWidget;
})();
