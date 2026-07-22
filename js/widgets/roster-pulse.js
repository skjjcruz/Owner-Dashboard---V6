// ══════════════════════════════════════════════════════════════════
// js/widgets/roster-pulse.js — Roster Pulse widget (v3 dashboard)
//
// Vital-signs view of the user's roster across all sizes.
//
// sm: Primary stat hero + tier badge → My Roster
// md: Primary stat + sparkline + badges → My Roster
// lg: Vital signs + position health (letter grades) — fits 2×2 no scroll
// tall: lg + percentile bar + age curve + recommendation
// xxl: Mini-roster panel — top player per position, age + DHQ
//
// Depends on: theme.js, core.js (assessTeamFromGlobal, LI)
// Exposes:    window.RosterPulseWidget
// ══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    // Proper ordinal suffix — '92nd', '33rd', not '92th'.
    const ordinalSuffix = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; };

    function RosterPulseWidget({ size, primaryMetric, myRoster, rankedTeams, sleeperUserId, currentLeague, playersData, computeKpiValue, setActiveTab, navigateWidget }) {
        const theme = window.WrTheme?.get?.() || {};
        const colors = theme.colors || {};
        const fonts = theme.fonts || {};
        const cardStyle = window.WrTheme?.cardStyle?.() || {};
        const fs = (rem) => window.WrTheme?.fontSize?.(rem) || (rem + 'rem');
        // Free/Pro split (fail-open): raw KPI numbers stay free; the
        // ELITE/CONTENDER/… tier verdict badge and the Action Plan rec are Pro.
        const pro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
        const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters }) || { isUsable: true };

        // ── GM Strategy (single source of truth) ────────────────
        const gm = window.WR.GmMode.useGmEffects(currentLeague);
        const untouchable = gm.untouchable || new Set();
        const timeline = gm.timeline; // '1_year' | '2_3_years' | 'dynasty_long'
        const isProtected = (pid) => untouchable.has(String(pid));

        // ── Data ────────────────────────────────────────────────
        const assess = React.useMemo(() => {
            if (typeof window.assessTeamFromGlobal === 'function' && myRoster?.roster_id) {
                return window.assessTeamFromGlobal(myRoster.roster_id);
            }
            return null;
        }, [myRoster?.roster_id]);

        const allAssess = React.useMemo(() => {
            if (typeof window.assessAllTeamsFromGlobal === 'function') {
                return window.assessAllTeamsFromGlobal() || [];
            }
            return [];
        }, []);

        const health = assess?.healthScore || 0;
        const tier = assess?.tier || '—';
        const needs = assess?.needs || [];
        const strengths = assess?.strengths || [];
        const window_ = assess?.window || '—';

        // KPI lookup helper
        const kv = (key) => { try { return computeKpiValue(key); } catch { return { value: '—', color: colors.textMuted }; } };
        const healthKv = kv('health-score');
        const eliteKv = kv('elite-count');
        const contenderKv = kv('contender-rank');
        const dynastyKv = kv('dynasty-rank');
        const windowKv = kv('window');
        const cliffKv = kv('aging-cliff');

        // ── Elite players (hoisted so any size can reveal them on click) ──
        // Same test the ELITES count uses: window.App.isElitePlayer.
        const _scoresMap = window.App?.LI?.playerScores || {};
        const _isElite = (pid) => (window.App?.isElitePlayer ? window.App.isElitePlayer(String(pid)) : (_scoresMap[pid] || 0) >= 7000);
        const eliteCore = React.useMemo(() => (myRoster?.players || [])
            .filter(_isElite)
            .map(pid => ({ pid, name: playersData?.[pid]?.full_name || pid, pos: window.App?.normPos?.(playersData?.[pid]?.position) || '', dhq: _scoresMap[pid] || 0 }))
            .sort((a, b) => b.dhq - a.dhq), [myRoster?.roster_id, playersData]);
        const [showElites, setShowElites] = React.useState(false);
        const openElites = (e) => { if (e) e.stopPropagation(); setShowElites(true); };
        // Overlay listing the actual elite players — rendered inside whichever
        // size card is showing, on top, dismissible.
        const eliteOverlay = showElites ? (
            React.createElement('div', {
                onClick: (e) => { e.stopPropagation(); setShowElites(false); },
                style: { position: 'absolute', inset: 0, background: 'var(--surf-solid, rgba(8,9,12,0.97))', borderRadius: 'inherit', zIndex: 20, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'auto' },
            },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 } },
                    React.createElement('span', { style: { fontFamily: fonts.display, fontSize: fs(0.82), fontWeight: 700, color: colors.positive, letterSpacing: '0.08em', textTransform: 'uppercase' } }, 'Elite Players · ' + eliteCore.length),
                    React.createElement('button', { onClick: (e) => { e.stopPropagation(); setShowElites(false); }, title: 'Close', style: { width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: 'var(--ov-2, rgba(255,255,255,0.03))', color: colors.textMuted, cursor: 'pointer', fontSize: fs(0.8) } }, '✕'),
                ),
                eliteCore.length === 0
                    ? React.createElement('div', { style: { fontSize: fs(0.66), color: colors.textFaint, fontStyle: 'italic', fontFamily: fonts.ui } }, 'No elite-tier players yet — build toward a 7000+ DHQ anchor.')
                    : eliteCore.map(p => React.createElement('div', {
                        key: p.pid,
                        onClick: (e) => { e.stopPropagation(); if (window.WR?.openPlayerCard) window.WR.openPlayerCard(p.pid); else if (typeof window.openPlayerModal === 'function') window.openPlayerModal(p.pid); },
                        style: { display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: '8px', alignItems: 'center', padding: '5px 6px', borderRadius: '5px', cursor: 'pointer', background: 'var(--ov-1, rgba(255,255,255,0.02))', flexShrink: 0 },
                    },
                        React.createElement('span', { style: { fontSize: fs(0.58), fontWeight: 700, color: colors.textMuted, fontFamily: fonts.ui } }, window.App?.posLabel?.(p.pos) || p.pos),
                        React.createElement('span', { style: { fontSize: fs(0.72), color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.name),
                        React.createElement('span', { style: { fontSize: fs(0.66), fontFamily: fonts.mono, fontWeight: 700, color: colors.positive } }, p.dhq >= 1000 ? (p.dhq / 1000).toFixed(1) + 'k' : p.dhq),
                    )),
            )
        ) : null;

        // ── Primary metric selection (sm/md) ────────────────────
        // Honors the primaryMetric prop chosen in the widget picker.
        const primary = (() => {
            const key = primaryMetric || 'health-score';
            if (key === 'elite-count') return { label: 'ELITES', value: eliteKv.value, color: colors.positive, sub: 'top-tier players' };
            if (key === 'contender-rank') return { label: 'CONTENDER', value: contenderKv.value, color: contenderKv.color || colors.accent, sub: contenderKv.sub || 'rank' };
            // default: health-score
            const healthCol = health >= 80 ? colors.positive : health >= 60 ? colors.accent : health >= 40 ? colors.warn : colors.negative;
            return { label: 'HEALTH', value: health, color: healthCol, sub: pro ? tier : 'health score' };
        })();

        // Sparkline data: all teams' health scores sorted for the mini chart
        const healthSparkData = React.useMemo(() => {
            return allAssess.map(a => a.healthScore || 0).sort((a, b) => b - a);
        }, [allAssess]);

        // Tier color
        const tierCol = tier === 'ELITE' ? colors.positive : tier === 'CONTENDER' ? colors.accent : tier === 'CROSSROADS' ? colors.warn : colors.negative;

        // Click handler
        const onClick = () => {
            if (size === 'sm' || size === 'md') {
                if (navigateWidget) navigateWidget('myteam');
                else if (setActiveTab) setActiveTab('myteam');
            }
        };
        const openMyRoster = (e) => {
            e?.stopPropagation?.();
            if (navigateWidget) navigateWidget('myteam');
            else if (setActiveTab) setActiveTab('myteam');
        };

        // ── Position breakdown — league-relative DHQ ranking ────
        const posOrder = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

        // Positions that hold an untouchable player — used to suppress any
        // 'sell'/'cut' framing on cornerstones marked off-limits in strategy.
        const protectedPositions = React.useMemo(() => {
            const set = new Set();
            if (!untouchable.size) return set;
            const normPos = window.App?.normPos || (p => p);
            (myRoster?.players || []).forEach(pid => {
                if (!isProtected(pid)) return;
                const pos = normPos(playersData?.[pid]?.position);
                if (pos) set.add(String(pos));
            });
            return set;
        }, [myRoster, playersData, untouchable]);
        const posBreakdown = React.useMemo(() => {
            const grades = window.App?.calcPosGrades?.(myRoster?.roster_id, currentLeague?.rosters, playersData) || [];
            return grades.map(g => ({
                ...g,
                // A-F letter grades are interpretations → Pro; free keeps the raw
                // rank + strength bar in neutral color
                col: !pro ? (colors.textMuted || 'var(--silver)')
                    : g.grade === 'A' ? colors.positive : g.grade === 'B' ? colors.accent : (g.grade === 'C' || g.grade === 'D') ? colors.warn : colors.negative,
            }));
        }, [assess, currentLeague, myRoster, playersData, pro]);

        if (!rosterState.isUsable) {
            return window.App?.renderRosterDataBlocker?.(rosterState, {
                title: size === 'sm' ? 'Sync' : 'Roster Pulse paused',
                compact: size === 'sm' || size === 'md',
                fill: true,
                actionLabel: size === 'sm' ? null : 'Open Roster',
                onAction: openMyRoster,
                style: { cursor: size === 'sm' || size === 'md' ? 'pointer' : 'default' },
            });
        }

        // ── SM (1×1) ─────────────────────────────────────────────
        if (size === 'sm') {
            return (
                <div onClick={primaryMetric === 'elite-count' ? openElites : onClick} style={{
                    ...cardStyle,
                    padding: 'var(--card-pad, 14px 16px)',
                    cursor: 'pointer', position: 'relative',
                    display: 'flex', flexDirection: 'column',
                    justifyContent: 'center', alignItems: 'center', textAlign: 'center',
                }}>
                    {eliteOverlay}
                    <div style={{
                        fontFamily: fonts.mono, fontSize: fs(2.0), fontWeight: 700,
                        color: primary.color, lineHeight: 1,
                        textShadow: theme.effects?.glow ? '0 0 8px ' + primary.color : 'none',
                    }} className="wr-data-value">
                        {primary.value}
                    </div>
                    <div style={{
                        fontSize: fs(0.85), color: colors.textMuted,
                        textTransform: 'uppercase', letterSpacing: '0.1em',
                        marginTop: '4px', fontFamily: fonts.ui,
                    }}>{primary.label}</div>
                    {pro && (
                        <div style={{
                            marginTop: '6px', fontSize: fs(0.72), fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: theme.card?.radius === '0px' ? '0' : '10px',
                            background: wrAlpha(tierCol, '18'), color: tierCol,
                            border: '1px solid ' + wrAlpha(tierCol, '44'),
                            fontFamily: fonts.ui,
                        }}>{tier}</div>
                    )}
                </div>
            );
        }

        // ── MD (2×1) ─────────────────────────────────────────────
        if (size === 'md') {
            return (
                <div onClick={primaryMetric === 'elite-count' ? openElites : onClick} style={{
                    ...cardStyle, padding: 'var(--card-pad, 14px 16px)', cursor: 'pointer', position: 'relative',
                    display: 'flex', gap: '12px', alignItems: 'center',
                }}>
                    {eliteOverlay}
                    <div style={{ textAlign: 'center', flexShrink: 0, minWidth: 60 }}>
                        <div style={{
                            fontFamily: fonts.mono, fontSize: fs(2.0), fontWeight: 700,
                            color: primary.color, lineHeight: 1,
                        }} className="wr-data-value">{primary.value}</div>
                        <div style={{ fontSize: fs(0.64), color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px', fontFamily: fonts.ui }}>{primary.label}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <MiniBarChart data={healthSparkData} highlight={health} colors={colors} fonts={fonts} fs={fs} height={42} />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                            <Badge label={contenderKv.value} color={contenderKv.color || colors.accent} theme={theme} />
                            <Badge label={windowKv.value + ' window'} color={windowKv.color || colors.textMuted} theme={theme} />
                            {pro && <Badge label={tier} color={tierCol} theme={theme} />}
                        </div>
                    </div>
                </div>
            );
        }

        // ── LG / TALL / XXL: vital-signs + position health ───────
        if (size === 'lg' || size === 'tall' || size === 'xxl') {
            // Headline standing = the single blended Power Score rank (the
            // engine already computed powerRank; fall back to sorting by
            // powerScore) so this agrees with the brief, widget, and Alex.
            const powerRank = (assess && assess.powerRank)
                || ([...allAssess].sort((a, b) => (b.powerScore || 0) - (a.powerScore || 0)).findIndex(a => a.rosterId === myRoster?.roster_id) + 1);
            const totalTeams = allAssess.length || 1;
            // powerRank 0 = roster not found in the assessment list — no
            // percentile claim (the formula would exceed 100 otherwise).
            const percentile = (powerRank > 0 && totalTeams > 1) ? Math.round((1 - (powerRank - 1) / totalTeams) * 100) : 0;
            const healthCol = health >= 80 ? colors.positive : health >= 60 ? colors.accent : health >= 40 ? colors.warn : colors.negative;

            // WINDOW vital — calibrated to GM Strategy timeline. A short
            // contention window is fine for a long-horizon build but urgent
            // for a win-now plan; reframe color + sub accordingly.
            const winLower = String(window_ || '').toLowerCase();
            const shortWindow = /close|now|short|0|1\b|expir|fad/.test(winLower);
            let windowCol = windowKv.color || colors.warn;
            let windowSub = window_;
            if (gm.hasStrategy) {
                if (timeline === '1_year' && shortWindow) {
                    // 'act' is a directive → Pro; free keeps the urgency color
                    // with a raw restatement of the window
                    windowCol = colors.warn; windowSub = pro ? 'win-now: act' : 'win-now: ' + window_;
                } else if (timeline === 'dynasty_long') {
                    windowCol = shortWindow ? colors.textMuted : colors.positive;
                    windowSub = 'long build: ' + window_;
                } else if (timeline === '1_year') {
                    windowCol = colors.positive; windowSub = 'win-now: ' + window_;
                }
            }

            // Compact 4-vital grid for lg (no scroll); 6 for tall/xxl
            const vitals4 = [
                { label: 'HEALTH', value: healthKv.value, color: healthKv.color || healthCol, sub: (pro ? tier + ' · ' : '') + '#' + (powerRank || '—') },
                { label: 'ELITES', value: eliteKv.value, color: eliteKv.color || colors.positive, sub: 'top-tier' },
                { label: 'CONTEND.', value: contenderKv.value, color: contenderKv.color || colors.accent, sub: contenderKv.sub || 'this season' },
                { label: 'WINDOW', value: windowKv.value, color: windowCol, sub: windowSub },
            ];
            const vitals6 = [
                ...vitals4,
                { label: 'DYNASTY', value: dynastyKv.value, color: dynastyKv.color || colors.accent, sub: dynastyKv.sub || '' },
                { label: 'CLIFF', value: cliffKv.value, color: cliffKv.color || colors.negative, sub: 'aging' },
            ];
            const vitals = (size === 'lg') ? vitals4 : vitals6;
            const vitalCols = (size === 'lg') ? 4 : 3;

            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
                    {eliteOverlay}
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexShrink: 0 }}>
                        <span style={{ fontSize: '1.1rem' }}>💊</span>
                        <span style={{ fontFamily: fonts.display, fontSize: fs(1.0), fontWeight: 700, color: colors.accent, letterSpacing: '0.07em', textTransform: 'uppercase', flex: 1 }}>Roster Pulse</span>
                        {/* free keeps the raw rank; the tier verdict word is Pro */}
                        <Badge label={(pro ? tier + ' · ' : '') + '#' + (powerRank || '—')} color={pro ? tierCol : colors.accent} theme={theme} />
                        <button onClick={openMyRoster} title="Open My Roster" style={{ padding: '3px 8px', minHeight: '44px', marginTop: '-12px', marginBottom: '-12px', display: 'flex', alignItems: 'center', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: '5px', cursor: 'pointer', fontSize: fs(0.58), fontFamily: fonts.ui, fontWeight: 700, whiteSpace: 'nowrap' }}>Roster</button>
                    </div>

                    {/* Vital signs grid */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(' + vitalCols + ', 1fr)', gap: '6px',
                        marginBottom: '10px', flexShrink: 0,
                    }}>
                        {vitals.map((v, i) => (
                            <div key={i}
                                onClick={v.label === 'ELITES' ? openElites : undefined}
                                title={v.label === 'ELITES' ? 'Show elite players' : undefined}
                                style={{
                                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                                border: '1px solid ' + (v.label === 'ELITES' ? wrAlpha(colors.positive, '44') : (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))')),
                                borderRadius: theme.card?.radius === '0px' ? '0' : '6px',
                                padding: '6px 4px', textAlign: 'center',
                                cursor: v.label === 'ELITES' ? 'pointer' : 'default',
                            }}>
                                <div style={{
                                    fontFamily: fonts.mono, fontSize: fs(1.1), fontWeight: 700,
                                    color: v.color, lineHeight: 1.05,
                                }} className="wr-data-value">{v.value}</div>
                                <div style={{
                                    fontSize: fs(0.6), color: colors.textMuted,
                                    textTransform: 'uppercase', letterSpacing: '0.06em',
                                    marginTop: '3px', fontFamily: fonts.ui,
                                }}>{v.label}</div>
                                {v.sub && <div style={{ fontSize: fs(0.56), color: colors.textFaint, marginTop: '1px', fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.sub}</div>}
                            </div>
                        ))}
                    </div>

                    {/* Position health — league-relative grades */}
                    <div style={{ marginBottom: '8px', flexShrink: 0 }}>
                        <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Position Health</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + Math.min(Math.max(posBreakdown.length, 1), 9) + ', 1fr)', gap: '4px' }}>
                            {posBreakdown.map((p, i) => (
                                <div key={i} style={{
                                    background: 'var(--ov-1, rgba(255,255,255,0.02))',
                                    border: '1px solid ' + wrAlpha(p.col, '33'),
                                    borderRadius: '4px',
                                    padding: '4px 2px', textAlign: 'center',
                                }}>
                                    <div style={{ fontSize: fs(0.58), fontWeight: 700, color: colors.textMuted, fontFamily: fonts.ui, lineHeight: 1 }}>{window.App?.posLabel?.(p.pos) || (p.pos === 'DEF' ? 'D/ST' : p.pos)}</div>
                                    <div style={{ fontFamily: fonts.mono, fontSize: fs(1.05), fontWeight: 800, color: p.col, lineHeight: 1, margin: '2px 0' }}>{pro ? p.grade : '#' + p.rank}</div>
                                    <div style={{ height: 3, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 2, overflow: 'hidden' }}>
                                        <div style={{ width: p.pct + '%', height: '100%', background: p.col, transition: '0.3s' }} />
                                    </div>
                                    <div style={{ fontSize: fs(0.54), color: colors.textFaint, marginTop: '1px', fontFamily: fonts.mono }}>#{p.rank}/{p.totalTeams}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* LG STOPS HERE (fits in 320px) */}

                    {/* Elite core — the actual elite players (tall/xxl have room) */}
                    {(size === 'tall' || size === 'xxl') && (
                        <div style={{ marginBottom: '8px', flexShrink: 0 }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.positive, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Elite Core · {eliteCore.length}</div>
                            {eliteCore.length === 0 ? (
                                <div style={{ fontSize: fs(0.62), color: colors.textFaint, fontStyle: 'italic', fontFamily: fonts.ui }}>No elite-tier players yet — build toward a 7000+ DHQ anchor.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                    {eliteCore.slice(0, size === 'xxl' ? 12 : 6).map(p => (
                                        <div key={p.pid} role="button" tabIndex={0} title="Open player card"
                                            onClick={() => { if (window.WR?.openPlayerCard) window.WR.openPlayerCard(p.pid); else if (typeof window.openPlayerModal === 'function') window.openPlayerModal(p.pid); }}
                                            style={{ display: 'grid', gridTemplateColumns: '30px 1fr auto', gap: '6px', alignItems: 'center', padding: '3px 5px', borderRadius: '4px', cursor: 'pointer', background: 'var(--ov-1, rgba(255,255,255,0.02))' }}>
                                            <span style={{ fontSize: fs(0.56), fontWeight: 700, color: colors.textMuted, fontFamily: fonts.ui }}>{window.App?.posLabel?.(p.pos) || p.pos}</span>
                                            <span style={{ fontSize: fs(0.66), color: colors.text || 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                            <span style={{ fontSize: fs(0.6), fontFamily: fonts.mono, fontWeight: 700, color: colors.positive }}>{p.dhq >= 1000 ? (p.dhq / 1000).toFixed(1) + 'k' : p.dhq}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* TALL extras: percentile + needs/strengths + recommendation */}
                    {size === 'tall' && (
                        <React.Fragment>
                            {/* Percentile + sparkline */}
                            <div style={{ marginBottom: '8px', flexShrink: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: fs(0.6), color: colors.textMuted, fontFamily: fonts.ui, marginBottom: '2px' }}>
                                    <span style={{ fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>League Health</span>
                                    <span>You: {powerRank > 0 ? percentile + ordinalSuffix(percentile) + ' percentile · ' : ''}#{powerRank || '—'} of {totalTeams}</span>
                                </div>
                                <MiniBarChart data={healthSparkData} highlight={health} colors={colors} fonts={fonts} fs={fs} height={36} />
                            </div>
                            {/* Needs + Strengths — deficit/surplus directives (same species as
                                gap-plan) → Pro; raw Top Players strip below stays free */}
                            {pro && <div style={{ display: 'flex', gap: '12px', marginBottom: '8px', flexShrink: 0 }}>
                                {needs.length > 0 && (
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.negative, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Needs</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                            {needs.slice(0, 4).map((n, i) => {
                                                const pos = typeof n === 'string' ? n : n?.pos;
                                                const urgency = typeof n === 'object' ? n?.urgency : null;
                                                const col = urgency === 'deficit' ? colors.negative : colors.warn;
                                                return <Badge key={i} label={pos + (urgency === 'deficit' ? '!' : '')} color={col} theme={theme} />;
                                            })}
                                        </div>
                                    </div>
                                )}
                                {strengths.length > 0 && (
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.positive, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Strengths</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                            {strengths.slice(0, 4).map((s, i) => {
                                                const pos = typeof s === 'string' ? s : s?.pos;
                                                return <Badge key={i} label={pos || '—'} color={colors.positive} theme={theme} />;
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>}
                            {/* Top players — fills the empty bottom space */}
                            <TopPlayers
                                myRoster={myRoster} playersData={playersData}
                                colors={colors} fonts={fonts} fs={fs} theme={theme}
                                untouchable={untouchable}
                                limit={5}
                            />
                            {/* Action plan — a "do X" rec → Pro; free gets a teaser row */}
                            {pro ? (
                                <ActionPlan tier={tier} needs={needs} strengths={strengths} protectedPositions={protectedPositions} colors={colors} fonts={fonts} fs={fs} theme={theme} />
                            ) : (
                                typeof window.WrGatedMoreRow === 'function'
                                    ? <div style={{ marginTop: 'auto', flexShrink: 0 }}>{React.createElement(window.WrGatedMoreRow, { title: 'Action plan', sub: "Alex's recommended next move for this roster", feature: 'analytics_depth' })}</div>
                                    : null
                            )}
                        </React.Fragment>
                    )}

                    {/* XXL extras: mini-roster (top player per position) */}
                    {size === 'xxl' && (
                        <MiniRoster
                            myRoster={myRoster} playersData={playersData}
                            posOrder={posOrder} colors={colors} fonts={fonts} fs={fs} theme={theme}
                            healthSparkData={healthSparkData} health={health}
                            percentile={percentile} powerRank={powerRank} totalTeams={totalTeams}
                            tier={tier} needs={needs} strengths={strengths}
                            untouchable={untouchable}
                            setActiveTab={setActiveTab}
                        />
                    )}
                </div>
            );
        }

        return null;
    }

    // ── Action plan recommendation ──────────────────────────────
    function ActionPlan({ tier, needs, strengths, protectedPositions, colors, fonts, fs, theme }) {
        const protectedSet = protectedPositions || new Set();
        const topNeed = needs[0];
        const topNeedPos = topNeed ? (typeof topNeed === 'string' ? topNeed : topNeed?.pos) : null;
        const topNeedUrgency = typeof topNeed === 'object' ? topNeed?.urgency : null;
        const topStrength = strengths[0];
        const topStrPos = topStrength ? (typeof topStrength === 'string' ? topStrength : topStrength?.pos) : null;
        // Don't suggest selling/shopping a position that holds an untouchable
        // cornerstone — GM Strategy has marked it off-limits.
        const strProtected = topStrPos ? protectedSet.has(String(topStrPos)) : false;
        const sellStrPos = strProtected ? null : topStrPos;

        let msg;
        if (tier === 'ELITE') msg = 'Protect your core. ' + (topNeedPos ? 'Surgical upgrade at ' + topNeedPos + ' would lock in your window.' : 'No critical needs — stay disciplined.');
        else if (tier === 'CONTENDER') msg = (topNeedPos && topNeedUrgency === 'deficit' ? topNeedPos + ' is your biggest hole — fill it now or risk a first-round exit.' : 'Close to elite. ') + (topStrPos ? ' Your ' + topStrPos + ' depth gives you trade leverage.' : '');
        else if (tier === 'CROSSROADS') msg = 'Decision time. ' + (topNeedPos ? 'You need ' + topNeedPos + ' help badly. ' : '') + (sellStrPos ? 'Sell ' + sellStrPos + ' surplus for picks if you\'re rebuilding, or buy a ' + (topNeedPos || 'starter') + ' if you\'re pushing.' : (topStrPos ? topStrPos + ' is locked — build around it; add a ' + (topNeedPos || 'starter') + ' if you\'re pushing.' : 'Commit one direction or the other.'));
        else msg = 'Rebuild mode. Accumulate picks and youth. ' + (sellStrPos ? 'Shop your ' + sellStrPos + ' depth for draft capital.' : (topStrPos ? 'Build around your locked ' + topStrPos + ' core.' : 'Patience pays.'));

        return (
            <div style={{
                marginTop: 'auto',
                padding: '10px 12px',
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'),
                borderRadius: theme.card?.radius === '0px' ? '0' : '6px',
                flexShrink: 0,
            }}>
                <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Action Plan</div>
                <div style={{ fontSize: fs(0.74), color: colors.textMuted, lineHeight: 1.5, fontFamily: fonts.ui }}>{msg}</div>
            </div>
        );
    }

    // ── Top players strip (tall) ────────────────────────────────
    function TopPlayers({ myRoster, playersData, colors, fonts, fs, theme, untouchable, limit }) {
        const untouchableSet = untouchable || new Set();
        const scores = window.App?.LI?.playerScores || {};
        const normPos = window.App?.normPos || (p => p);
        const players = (myRoster?.players || []).map(pid => {
            const p = playersData?.[pid] || {};
            const rawAge = p.age || (p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null);
            return {
                pid, name: p.full_name || pid,
                pos: normPos(p.position) || '?',
                age: Number.isFinite(rawAge) ? rawAge : null,
                dhq: scores[pid] || 0,
                locked: untouchableSet.has(String(pid)),
            };
        }).sort((a, b) => b.dhq - a.dhq).slice(0, limit || 5);

        if (!players.length) return null;
        const max = players[0]?.dhq || 1;

        return (
            <div style={{ marginBottom: '8px', flexShrink: 0 }}>
                <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Top Players</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {players.map((p, i) => {
                        const pct = (p.dhq / max) * 100;
                        const col = p.dhq >= 5000 ? colors.positive : p.dhq >= 2000 ? colors.accent : colors.textMuted;
                        return (
                            <div key={p.pid} role="button" tabIndex={0} title="Open player card" onClick={() => { if (typeof window.openPlayerModal === 'function' && p.pid) window.openPlayerModal(p.pid); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (typeof window.openPlayerModal === 'function' && p.pid) window.openPlayerModal(p.pid); } }} style={{
                                display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                                padding: '2px 0',
                            }}>
                                <span style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.textFaint, width: 12, fontFamily: fonts.mono }}>{i + 1}</span>
                                <span style={{ fontSize: fs(0.58), fontWeight: 700, color: colors.textMuted, width: 22, fontFamily: fonts.ui }}>{window.App?.posLabel?.(p.pos) || (p.pos === 'DEF' ? 'D/ST' : p.pos)}</span>
                                <span style={{ flex: 1, minWidth: 0, fontSize: fs(0.66), fontWeight: 600, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                {p.locked && <span title="Untouchable — off-limits in GM Strategy" style={{ fontSize: fs(0.5), fontWeight: 700, color: 'var(--gold)', fontFamily: fonts.ui, letterSpacing: '0.04em', flexShrink: 0 }}>🔒</span>}
                                {p.age && <span style={{ fontSize: fs(0.54), color: colors.textFaint, fontFamily: fonts.mono, minWidth: 16, textAlign: 'right' }}>{p.age}</span>}
                                <div style={{ width: 60, height: 5, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                                    <div style={{ width: pct + '%', height: '100%', background: col }} />
                                </div>
                                <span style={{ fontSize: fs(0.6), fontWeight: 700, color: col, fontFamily: fonts.mono, minWidth: 32, textAlign: 'right' }}>{p.dhq >= 1000 ? (p.dhq / 1000).toFixed(1) + 'k' : p.dhq}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Mini roster panel (xxl) ─────────────────────────────────
    function MiniRoster({ myRoster, playersData, posOrder, colors, fonts, fs, theme, healthSparkData, health, percentile, powerRank, totalTeams, tier, needs, strengths, untouchable, setActiveTab }) {
        const untouchableSet = untouchable || new Set();
        const scores = window.App?.LI?.playerScores || {};
        const normPos = window.App?.normPos || (p => p);

        const posGroups = React.useMemo(() => {
            const groups = {};
            posOrder.forEach(p => groups[p] = []);
            (myRoster?.players || []).forEach(pid => {
                const p = playersData?.[pid] || {};
                const pos = normPos(p.position);
                if (!groups[pos]) return;
                const rawAge = p.age || (p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null);
                groups[pos].push({
                    pid,
                    name: p.full_name || pid,
                    age: Number.isFinite(rawAge) ? rawAge : null,
                    dhq: scores[pid] || 0,
                    team: p.team || 'FA',
                    locked: untouchableSet.has(String(pid)),
                });
            });
            posOrder.forEach(p => groups[p].sort((a, b) => b.dhq - a.dhq));
            return groups;
        }, [myRoster, playersData, untouchable]);

        const onPlayerClick = (pid) => {
            if (typeof window.openPlayerModal === 'function' && pid) window.openPlayerModal(pid);
        };

        return (
            <div className="rp-pos-cols" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', overflow: 'hidden' }}>
                {posOrder.map(pos => {
                    const players = posGroups[pos] || [];
                    if (!players.length) return (
                        <div key={pos} style={{
                            background: 'var(--ov-1, rgba(255,255,255,0.02))',
                            border: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'),
                            borderRadius: '4px', padding: '6px 8px',
                            opacity: 0.4,
                        }}>
                            <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: fonts.ui }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</div>
                            <div style={{ fontSize: fs(0.6), color: colors.textFaint, marginTop: '4px', fontStyle: 'italic', fontFamily: fonts.ui }}>None</div>
                        </div>
                    );
                    return (
                        <div key={pos} style={{
                            background: 'var(--ov-1, rgba(255,255,255,0.02))',
                            border: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'),
                            borderRadius: '4px', padding: '6px 8px',
                            display: 'flex', flexDirection: 'column', gap: '3px', minHeight: 0,
                            overflow: 'hidden',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: fonts.ui }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</span>
                                <span style={{ fontSize: fs(0.54), color: colors.textFaint, fontFamily: fonts.ui }}>{players.length}</span>
                            </div>
                            {players.map((pl, i) => (
                                <div key={pl.pid} role="button" tabIndex={0} title="Open player card" onClick={() => onPlayerClick(pl.pid)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlayerClick(pl.pid); } }} style={{
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    cursor: 'pointer', padding: '1px 0',
                                    borderTop: i > 0 ? '1px solid var(--ov-3, rgba(255,255,255,0.04))' : 'none',
                                    paddingTop: i > 0 ? '3px' : '0',
                                }}>
                                    <span style={{
                                        flex: 1, minWidth: 0,
                                        fontSize: fs(0.62), fontWeight: i === 0 ? 700 : 500,
                                        color: i === 0 ? colors.text : colors.textMuted,
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                        fontFamily: fonts.ui,
                                    }}>{pl.name}</span>
                                    {pl.locked && <span title="Untouchable — off-limits in GM Strategy" style={{ fontSize: fs(0.46), flexShrink: 0 }}>🔒</span>}
                                    {pl.age && <span style={{ fontSize: fs(0.5), color: colors.textFaint, fontFamily: fonts.mono }}>{pl.age}</span>}
                                    <span style={{
                                        fontSize: fs(0.54), fontWeight: 700,
                                        color: pl.dhq >= 5000 ? colors.positive : pl.dhq >= 2000 ? colors.accent : colors.textMuted,
                                        fontFamily: fonts.mono, minWidth: 24, textAlign: 'right',
                                    }}>{pl.dhq >= 1000 ? (pl.dhq / 1000).toFixed(1) + 'k' : pl.dhq}</span>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        );
    }

    // ── Shared sub-components ─────────────────────────────────────
    function MiniBarChart({ data, highlight, colors, fonts, fs, height = 40 }) {
        if (!data || !data.length) return null;
        const max = Math.max(...data, 1);
        const barW = Math.max(2, Math.min(8, Math.floor(200 / data.length)));
        return (
            <svg width="100%" height={height} viewBox={'0 0 ' + (data.length * (barW + 1)) + ' ' + height} preserveAspectRatio="none" style={{ display: 'block' }}>
                {data.map((v, i) => {
                    const h = (v / max) * (height - 2);
                    const isMe = v === highlight;
                    return (
                        <rect
                            key={i}
                            x={i * (barW + 1)}
                            y={height - h - 1}
                            width={barW}
                            height={h}
                            rx={barW > 3 ? 1 : 0}
                            fill={isMe ? (colors.accent || 'var(--k-d4af37, #d4af37)') : 'var(--ov-6, rgba(255,255,255,0.12))'}
                            opacity={isMe ? 1 : 0.6}
                        >
                            {isMe && <title>Your health: {v}</title>}
                        </rect>
                    );
                })}
            </svg>
        );
    }

    function Badge({ label, color, theme }) {
        const t = theme || {};
        return (
            <span style={{
                fontSize: window.WrTheme?.fontSize?.(0.7) || '0.7rem',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: t.card?.radius === '0px' ? '0' : '10px',
                background: wrAlpha(color || 'var(--k-d4af37, #d4af37)', '18'),
                color: color || 'var(--k-d4af37, #d4af37)',
                border: '1px solid ' + wrAlpha(color || 'var(--k-d4af37, #d4af37)', '44'),
                fontFamily: t.fonts?.ui || 'DM Sans, sans-serif',
                whiteSpace: 'nowrap',
            }}>{label}</span>
        );
    }

    window.RosterPulseWidget = RosterPulseWidget;
})();
