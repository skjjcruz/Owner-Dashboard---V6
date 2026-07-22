// ══════════════════════════════════════════════════════════════════
// js/draft/live-analytics.js — Live Analytics panel (Phase 4 cinematic)
//
// 7 widgets in a tight 3-col × 2-row grid:
//   Row 1: Health Radial · Value Curve · Live Grade
//   Row 2: Position Fills · Run Meter · Reach/Steal Ticker
//
// Plus a tier-transition banner that slides down from the top of the panel
// when the user's assessment tier changes (rare, 3s dismiss).
//
// Depends on: styles.js, state.js (gradeDraft), personas for health
// Exposes:    window.DraftCC.LiveAnalyticsPanel
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, FONT_MONO, panelCard, dhqColor } = window.DraftCC.styles;

    const POS_COLORS = {
        QB: 'var(--k-ff6b6b, #ff6b6b)', RB: 'var(--k-4ecdc4, #4ecdc4)', WR: 'var(--k-45b7d1, #45b7d1)', TE: 'var(--k-f7dc6f, #f7dc6f)',
        DL: 'var(--k-e67e22, #e67e22)', LB: 'var(--k-f0a500, #f0a500)', DB: 'var(--k-5dade2, #5dade2)', K: 'var(--k-bb8fce, #bb8fce)',
    };

    // Pure run-detector: returns the most concentrated positional run inside the
    // last `lookback` picks, or null if no position has >= `min` of them.
    // Shape: { pos, count, window, picks } where picks are the run's pick records.
    function detectRuns(picks, lookback = 6, min = 3) {
        const window = (picks || []).slice(-lookback);
        if (window.length < min) return null;
        const byPos = {};
        window.forEach(p => {
            const pos = (p && (p.pos || p.player?.position) || '').toUpperCase();
            if (!pos) return;
            (byPos[pos] = byPos[pos] || []).push(p);
        });
        let best = null;
        Object.keys(byPos).forEach(pos => {
            const list = byPos[pos];
            if (list.length >= min && (!best || list.length > best.count)) {
                best = { pos, count: list.length, window: window.length, picks: list };
            }
        });
        return best;
    }

    function LiveAnalyticsPanel({ state }) {
        const posColors = window.App?.POS_COLORS || POS_COLORS;

        // User's picks so far (rosterId-based, accounting for trades)
        const myPicks = React.useMemo(() => {
            return state.picks.filter(p => p.rosterId === state.userRosterId || p.isUser);
        }, [state.picks, state.userRosterId]);

        // Live grade
        const grade = React.useMemo(() => {
            if (!myPicks.length || !state.originalPool?.length) return { letter: '?', totalDHQ: 0, pct: 0 };
            const assessment = state.personas?.[state.userRosterId]?.assessment;
            return window.DraftCC.state.gradeDraft(myPicks, state.originalPool, { assessment, variant: state.variant, leagueSize: state.leagueSize, rounds: state.rounds, budget: state.auctionBudget });
        }, [myPicks, state.originalPool, state.personas, state.userRosterId, state.variant, state.leagueSize, state.rounds, state.auctionBudget]);

        // Phase 7 deferred: Live health recompute via a real synthetic roster instead of a +3/pick heuristic.
        // Strategy:
        //   1) Start from the user's persona baseline roster (persona.assessment.playerIds if present,
        //      otherwise the live roster from window.S.rosters).
        //   2) Inject each drafted rookie into that synthetic roster.
        //   3) Score per-position fill vs. starter requirements + depth targets.
        //   4) Convert to a delta: each position that moves from "deficit → adequate" is +8;
        //      "adequate → surplus" is +3; filling kicker is +2; past depth cap is +0.
        //   5) Cap at +28 total so a single draft can't fully override the pre-draft health score.
        const persona = state.personas?.[state.userRosterId];
        const myHealth = persona?.assessment?.healthScore || 0;

        const healthDelta = React.useMemo(() => {
            if (!myPicks.length) return 0;
            const needs = persona?.assessment?.needs || [];
            const posAssessment = persona?.assessment?.posAssessment || {};
            // Build a quick need-urgency lookup
            const needUrgency = {};
            needs.forEach(n => { needUrgency[n.pos] = n.urgency; });

            // Track how many picks we've added at each position
            const added = {};
            let delta = 0;
            for (const pick of myPicks) {
                const pos = (pick.pos || pick.player?.position || '').toUpperCase();
                if (!pos) continue;
                added[pos] = (added[pos] || 0) + 1;
                const pa = posAssessment[pos] || {};
                const needed = (pa.startingReq || pa.ideal || 2) - (pa.nflStarters || 0);
                const urgency = needUrgency[pos];

                // First pick at a deficit position: big boost
                if (added[pos] === 1 && urgency === 'deficit') delta += 8;
                // First pick at a thin position: moderate boost
                else if (added[pos] === 1 && urgency === 'thin') delta += 5;
                // Adding to a surplus/ok position: depth value
                else if (added[pos] === 1) delta += 2;
                // Follow-up picks at needed positions: filling depth
                else if (added[pos] <= needed + 1) delta += 3;
                // Over-drafting past depth needs: marginal
                else delta += 1;

                // DHQ-quality multiplier for home-run picks
                const dhq = pick.dhq || pick.player?.dhq || 0;
                if (dhq >= 7000) delta += 2;
                else if (dhq >= 4500) delta += 1;
            }
            return Math.min(28, delta);
        }, [myPicks, persona]);

        const liveHealth = Math.min(100, myHealth + healthDelta);

        // Tier transition detection
        const [tierBanner, setTierBanner] = React.useState(null);
        const lastTierRef = React.useRef(persona?.assessment?.tier || null);
        React.useEffect(() => {
            const currentTier = persona?.assessment?.tier;
            if (!currentTier) return;
            if (lastTierRef.current && lastTierRef.current !== currentTier) {
                setTierBanner({ from: lastTierRef.current, to: currentTier });
                const t = setTimeout(() => setTierBanner(null), 3500);
                return () => clearTimeout(t);
            }
            lastTierRef.current = currentTier;
        }, [persona?.assessment?.tier]);

        // Position counts + run detection
        const posCounts = React.useMemo(() => {
            const counts = {};
            myPicks.forEach(p => { counts[p.pos] = (counts[p.pos] || 0) + 1; });
            return counts;
        }, [myPicks]);

        const lastPicks = React.useMemo(() => state.picks.slice(-8), [state.picks]);
        const runStats = React.useMemo(() => {
            const stats = {};
            lastPicks.forEach(p => { stats[p.pos] = (stats[p.pos] || 0) + 1; });
            return stats;
        }, [lastPicks]);

        // Reach/Steal events from the last 10 picks
        const reachSteals = React.useMemo(() => {
            const events = [];
            for (const p of state.picks.slice(-10)) {
                const consensus = p.consensusRank;
                if (!consensus) continue;
                const delta = p.overall - consensus;
                // delta = overall - consensus: positive = player fell to us (steal).
                // (Fixes a prior sign inversion that labeled steals as reaches.)
                if (delta >= 7) events.push({ ...p, type: 'steal', delta });
                else if (delta <= -7) events.push({ ...p, type: 'reach', delta: Math.abs(delta) });
            }
            return events;
        }, [state.picks]);

        // Value curve: x = overall pick #, y = DHQ, for user's picks + baseline
        const valueCurve = React.useMemo(() => {
            const userPicks = myPicks.map(p => ({ x: p.overall, y: p.dhq, name: p.name, pos: p.pos }));
            // Consensus baseline: top N from original pool sorted by DHQ
            const totalPicks = state.pickOrder.length;
            const baseline = (state.originalPool || []).slice(0, totalPicks).map((p, i) => ({
                x: i + 1,
                y: p.dhq,
            }));
            return { userPicks, baseline };
        }, [myPicks, state.pickOrder.length, state.originalPool]);

        const containerCss = panelCard({
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '8px 10px',
            overflow: 'hidden',
            position: 'relative',
        });

        return (
            <div style={containerCss}>
                {/* Tier transition banner */}
                {tierBanner && (
                    <div style={{
                        position: 'absolute',
                        top: '8px',
                        left: '10px',
                        right: '10px',
                        padding: '8px 12px',
                        background: 'linear-gradient(90deg, var(--acc-line1, rgba(212,175,55,0.22)), var(--acc-fill1, rgba(212,175,55,0.05)))',
                        border: '1px solid var(--acc-line3, rgba(212,175,55,0.5))',
                        borderRadius: '6px',
                        zIndex: 5,
                        fontSize: '0.72rem',
                        color: 'var(--gold)',
                        fontWeight: 700,
                        textAlign: 'center',
                        fontFamily: FONT_UI,
                        animation: 'wrFadeIn 0.4s ease',
                        boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
                    }}>
                        🔥 TIER UP · {tierBanner.from} → <span style={{ color: 'var(--white)' }}>{tierBanner.to}</span>
                    </div>
                )}

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                    <div style={{ fontFamily: FONT_DISPL, fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                        Live Analytics
                    </div>
                    <span style={{
                        fontSize: 'var(--text-micro, 0.6875rem)',
                        padding: '1px 5px',
                        background: 'rgba(46,204,113,0.12)',
                        color: 'var(--k-2ecc71, #2ecc71)',
                        border: '1px solid rgba(46,204,113,0.3)',
                        borderRadius: '3px',
                        fontFamily: FONT_UI,
                        letterSpacing: '0.06em',
                    }}>LIVE</span>
                </div>

                {/* Row 1: Health · Value Curve · Live Grade */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 80px) minmax(0, 1fr) minmax(0, 100px)',
                    gap: '8px',
                    marginBottom: '8px',
                    flex: 1,
                    minHeight: 0,
                }}>
                    <HealthRadial value={liveHealth} base={myHealth} delta={liveHealth - myHealth} />
                    <ValueCurveChart curve={valueCurve} width={260} height={82} />
                    <LiveGradeWidget grade={grade} />
                </div>

                {/* Row 2: Position Fills · Run Meter · Reach/Steal Ticker */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1.4fr',
                    gap: '8px',
                    flexShrink: 0,
                }}>
                    <PositionFillsBar posCounts={posCounts} />
                    <RunMeter runStats={runStats} posColors={posColors} />
                    <ReachStealTicker events={reachSteals} />
                </div>
            </div>
        );
    }

    // ── Widget: Team Health Radial ────────────────────────────────
    function HealthRadial({ value, base, delta }) {
        const size = 66;
        const strokeWidth = 6;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (value / 100) * circumference;
        const col = value >= 70 ? 'var(--k-2ecc71, #2ecc71)' : value >= 40 ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';

        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid var(--ov-3, rgba(255,255,255,0.05))',
                borderRadius: '5px',
                padding: '4px',
                position: 'relative',
            }}>
                <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke="var(--ov-4, rgba(255,255,255,0.06))"
                        strokeWidth={strokeWidth}
                    />
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke={col}
                        strokeWidth={strokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                    />
                </svg>
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                    marginTop: '-4px',
                }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: col, fontFamily: FONT_DISPL, lineHeight: 1 }}>
                        {value || '—'}
                    </div>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '1px' }}>
                        HEALTH
                    </div>
                </div>
                {delta > 0 && (
                    <div style={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        fontSize: 'var(--text-micro, 0.6875rem)',
                        color: 'var(--k-2ecc71, #2ecc71)',
                        fontWeight: 700,
                        fontFamily: FONT_MONO,
                    }}>+{delta}</div>
                )}
            </div>
        );
    }

    // ── Widget: Value Curve Chart ─────────────────────────────────
    function ValueCurveChart({ curve, width, height }) {
        const { userPicks, baseline } = curve;
        if (!baseline.length) {
            return <Placeholder label="Value Curve" text="No data yet" />;
        }

        const allY = [...baseline.map(p => p.y), ...userPicks.map(p => p.y)];
        const maxY = Math.max(...allY, 1);
        const minY = Math.min(...allY, 0);
        const yRange = Math.max(maxY - minY, 1);
        const maxX = Math.max(baseline.length, ...userPicks.map(p => p.x), 1);

        const xScale = (x) => 6 + ((x - 1) / Math.max(maxX - 1, 1)) * (width - 12);
        const yScale = (y) => 6 + ((maxY - y) / yRange) * (height - 12);

        const baselinePath = baseline.map((p, i) =>
            (i === 0 ? 'M' : 'L') + xScale(p.x) + ',' + yScale(p.y)
        ).join(' ');

        return (
            <div style={{
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid var(--ov-3, rgba(255,255,255,0.05))',
                borderRadius: '5px',
                padding: '4px 6px',
                display: 'flex',
                flexDirection: 'column',
            }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: FONT_UI, marginBottom: '2px' }}>
                    VALUE CURVE · Pick # vs DHQ
                </div>
                <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                    {/* Baseline */}
                    <path
                        d={baselinePath}
                        fill="none"
                        stroke="var(--ov-7, rgba(255,255,255,0.25))"
                        strokeWidth={1}
                        strokeDasharray="2 2"
                    />
                    {/* User picks as dots */}
                    {userPicks.map((p, i) => {
                        // Clamp x into baseline bounds and fall back to a neutral color
                        // when there's no consensus value to compare against (prevents
                        // misleading "steal" coloring when consensusAtX is 0).
                        const clampedIdx = Math.max(0, Math.min(baseline.length - 1, p.x - 1));
                        const consensusAtX = baseline[clampedIdx]?.y || 0;
                        const hasConsensus = consensusAtX > 0;
                        const isSteal = hasConsensus && p.y > consensusAtX * 1.05;
                        const isReach = hasConsensus && p.y < consensusAtX * 0.85;
                        const dotCol = isSteal ? 'var(--k-2ecc71, #2ecc71)' : isReach ? 'var(--k-e74c3c, #e74c3c)' : 'var(--gold)';
                        return (
                            <circle
                                key={i}
                                cx={xScale(p.x)}
                                cy={yScale(p.y)}
                                r={2.5}
                                fill={dotCol}
                                stroke="#000"
                                strokeWidth={0.5}
                            >
                                <title>{p.name} · {p.pos} · Pick #{p.x} · {p.y.toLocaleString()} DHQ</title>
                            </circle>
                        );
                    })}
                </svg>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.4, display: 'flex', gap: '6px', marginTop: '1px' }}>
                    <span>— baseline</span>
                    <span style={{ color: 'var(--k-2ecc71, #2ecc71)' }}>● steal</span>
                    <span style={{ color: 'var(--k-e74c3c, #e74c3c)' }}>● reach</span>
                </div>
            </div>
        );
    }

    // ── Widget: Live Grade ────────────────────────────────────────
    function LiveGradeWidget({ grade }) {
        const col =
            grade.letter === '?' ? 'var(--silver)' :
            grade.letter.startsWith('A') ? 'var(--k-2ecc71, #2ecc71)' :
            grade.letter.startsWith('B') ? 'var(--k-d4af37, #d4af37)' :
            grade.letter.startsWith('C') ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';

        const [pulse, setPulse] = React.useState(false);
        const lastLetterRef = React.useRef(grade.letter);
        React.useEffect(() => {
            if (lastLetterRef.current !== grade.letter) {
                setPulse(true);
                const t = setTimeout(() => setPulse(false), 700);
                lastLetterRef.current = grade.letter;
                return () => clearTimeout(t);
            }
        }, [grade.letter]);

        return (
            <div style={{
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid var(--ov-3, rgba(255,255,255,0.05))',
                borderRadius: '5px',
                padding: '6px 4px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                transform: pulse ? 'scale(1.06)' : 'scale(1)',
                transition: 'transform 0.25s ease',
            }}>
                <div style={{
                    fontFamily: FONT_DISPL,
                    fontSize: '2rem',
                    fontWeight: 700,
                    color: col,
                    lineHeight: 1,
                    textShadow: pulse ? '0 0 12px ' + col : 'none',
                    transition: 'text-shadow 0.4s ease',
                }}>
                    {grade.letter}
                </div>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
                    LIVE GRADE
                </div>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.8, marginTop: '3px', fontFamily: FONT_MONO }}>
                    {grade.totalDHQ >= 1000 ? (grade.totalDHQ / 1000).toFixed(1) + 'k' : grade.totalDHQ} DHQ
                </div>
            </div>
        );
    }

    // ── Widget: Position Fills Bar ────────────────────────────────
    function PositionFillsBar({ posCounts }) {
        const posColors = window.App?.POS_COLORS || POS_COLORS;
        const targetCounts = { QB: 3, RB: 5, WR: 6, TE: 2, K: 1, DEF: 1, DL: 3, LB: 3, DB: 3 };
        const positions = typeof window.getLeaguePositions === 'function'
            ? window.getLeaguePositions()
            : ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
        const posLabel = pos => window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);

        return (
            <div style={{
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid var(--ov-3, rgba(255,255,255,0.05))',
                borderRadius: '5px',
                padding: '5px 7px',
            }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: FONT_UI, marginBottom: '3px' }}>
                    ROSTER FILL
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {positions.map(pos => {
                        const have = posCounts[pos] || 0;
                        const target = targetCounts[pos];
                        const pct = Math.min(100, (have / target) * 100);
                        const col = posColors[pos] || 'var(--silver)';
                        return (
                            <div key={pos} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{
                                    fontSize: 'var(--text-micro, 0.6875rem)',
                                    fontWeight: 700,
                                    color: col,
                                    width: 28,
                                    fontFamily: FONT_UI,
                                }}>{posLabel(pos)}</span>
                                <div style={{
                                    flex: 1,
                                    height: 6,
                                    background: 'var(--ov-3, rgba(255,255,255,0.05))',
                                    borderRadius: 2,
                                    overflow: 'hidden',
                                    position: 'relative',
                                }}>
                                    <div style={{
                                        width: pct + '%',
                                        height: '100%',
                                        background: col,
                                        opacity: 0.85,
                                        transition: 'width 0.4s ease',
                                    }} />
                                </div>
                                <span style={{
                                    fontSize: 'var(--text-micro, 0.6875rem)',
                                    color: 'var(--silver)',
                                    opacity: 0.7,
                                    minWidth: 22,
                                    textAlign: 'right',
                                    fontFamily: FONT_MONO,
                                }}>{have}/{target}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Widget: Run Meter ─────────────────────────────────────────
    function RunMeter({ runStats, posColors }) {
        const entries = Object.entries(runStats).sort((a, b) => b[1] - a[1]);
        const hasRun = entries.some(([, ct]) => ct >= 3);
        return (
            <div style={{
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid ' + (hasRun ? 'rgba(231,76,60,0.35)' : 'var(--ov-3, rgba(255,255,255,0.05))'),
                borderRadius: '5px',
                padding: '5px 7px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: FONT_UI, flex: 1 }}>
                        POS RUN · last 8
                    </div>
                    {hasRun && <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--k-e74c3c, #e74c3c)', fontWeight: 700 }}>🔥</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {entries.slice(0, 4).map(([pos, ct]) => {
                        const col = posColors[pos] || 'var(--silver)';
                        const pct = (ct / 8) * 100;
                        return (
                            <div key={pos} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: col, width: 16 }}>{pos}</span>
                                <div style={{
                                    flex: 1,
                                    height: 5,
                                    background: 'var(--ov-3, rgba(255,255,255,0.05))',
                                    borderRadius: 2,
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        width: pct + '%',
                                        height: '100%',
                                        background: col,
                                        opacity: ct >= 3 ? 1 : 0.7,
                                    }} />
                                </div>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: FONT_MONO, minWidth: 10, textAlign: 'right' }}>{ct}</span>
                            </div>
                        );
                    })}
                    {entries.length === 0 && (
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.4, fontStyle: 'italic', textAlign: 'center', padding: '6px 0' }}>
                            No picks yet
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Widget: Reach/Steal Ticker ────────────────────────────────
    function ReachStealTicker({ events }) {
        return (
            <div style={{
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid var(--ov-3, rgba(255,255,255,0.05))',
                borderRadius: '5px',
                padding: '5px 7px',
                overflow: 'hidden',
            }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: FONT_UI, marginBottom: '3px' }}>
                    REACH / STEAL TICKER
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {events.slice(-4).reverse().map((e, i) => {
                        const col = e.type === 'steal' ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-e74c3c, #e74c3c)';
                        const sign = e.type === 'steal' ? '↓' : '↑';
                        return (
                            <div key={i} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: 'var(--text-micro, 0.6875rem)',
                                fontFamily: FONT_UI,
                            }}>
                                <span style={{ color: col, fontWeight: 700, width: 8 }}>{sign}</span>
                                <span style={{
                                    flex: 1,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    color: 'var(--silver)',
                                }}>{e.name?.split(' ').slice(-1)[0]}</span>
                                <span style={{ color: col, fontWeight: 700, fontFamily: FONT_MONO }}>
                                    {e.delta}
                                </span>
                            </div>
                        );
                    })}
                    {events.length === 0 && (
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.4, fontStyle: 'italic', textAlign: 'center', padding: '6px 0' }}>
                            No reaches / steals
                        </div>
                    )}
                </div>
            </div>
        );
    }

    function Placeholder({ label, text }) {
        return (
            <div style={{
                background: 'var(--ov-1, rgba(255,255,255,0.02))',
                border: '1px solid var(--ov-3, rgba(255,255,255,0.05))',
                borderRadius: '5px',
                padding: '6px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
            }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.4, fontStyle: 'italic', marginTop: '3px' }}>{text}</div>
            </div>
        );
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.LiveAnalyticsPanel = LiveAnalyticsPanel;
    window.DraftCC.liveAnalytics = window.DraftCC.liveAnalytics || {};
    window.DraftCC.liveAnalytics.detectRuns = detectRuns;
})();
