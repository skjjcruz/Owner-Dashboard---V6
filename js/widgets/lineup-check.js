// ══════════════════════════════════════════════════════════════════
// js/widgets/lineup-check.js — Lineup Check widget (v3 dashboard)
//
// Surfaces the weekly start/sit signal on Home: points left on the bench
// vs the optimal lineup, the GM-mode objective, and the top swaps. Click
// → Lineup Command Center. League-scored via App.WeeklyProj / App.StartSit.
//
// sizes: sm (hero delta) · md/lg (delta + objective + top swaps)
// Depends on: theme.js, weekly-proj.js, startsit-engine.js
// Exposes:    window.LineupCheckWidget
// ══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    function LineupCheckWidget({ size, myRoster, currentLeague, playersData, statsData, prevStatsData, setActiveTab, navigateWidget }) {
        const cardStyle = window.WrTheme?.cardStyle?.() || { background: 'var(--black)', border: 'var(--card-border)', borderRadius: 'var(--card-radius)' };
        const go = () => { if (navigateWidget) navigateWidget('lineup'); else if (setActiveTab) setActiveTab('lineup'); };

        const result = React.useMemo(() => {
            const WP = window.App && window.App.WeeklyProj;
            if (!WP || !myRoster || !currentLeague) return null;
            try { return WP.optimalForRoster(myRoster, currentLeague, { playersData, statsData, priorData: prevStatsData }); }
            catch (e) { if (window.wrLog) window.wrLog('lineupCheck.widget', e); return null; }
        }, [myRoster, currentLeague, playersData, statsData, prevStatsData]);

        const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #bdb8ad)', GREEN = 'var(--good, #2ecc71)', WHITE = 'var(--white, #f5f2ea)';
        const monoFont = 'var(--font-mono, monospace)';
        const base = { ...cardStyle, height: '100%', padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', cursor: 'pointer', boxSizing: 'border-box' };

        if (!result) {
            return (
                <div style={base} onClick={go}>
                    <div style={{ fontSize: '0.7rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 700 }}>LINEUP CHECK</div>
                    <div style={{ marginTop: 'auto', color: SILVER, opacity: 0.7, fontSize: '0.8rem' }}>Projections pending — open to set your week.</div>
                </div>
            );
        }

        // MFL rosters never expose platform starters (starters: []), so the
        // delta would compare optimal vs nothing and claim the entire optimal
        // total is "pts on your bench". Show a neutral build prompt instead
        // (mirrors the MFL seeding caveat in js/tabs/lineup.js).
        const platformStarters = ((myRoster && myRoster.starters) || []).filter(pid => pid && String(pid) !== '0');
        if (!platformStarters.length) {
            return (
                <div style={base} onClick={go}>
                    <div style={{ fontSize: '0.7rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 700 }}>LINEUP CHECK</div>
                    <div style={{ marginTop: 'auto', color: SILVER, opacity: 0.7, fontSize: '0.8rem' }}>No lineup set on platform — open Lineup to build one.</div>
                </div>
            );
        }

        const d = result.delta;
        const optimal = d.isOptimal;
        const headline = optimal ? 'SET' : d.delta.toFixed(1);
        const sub = optimal ? 'Lineup is optimal' : 'pts on your bench';
        const accent = optimal ? GREEN : GOLD;
        const OBJ = { floor: 'Floor · safe', median: 'Median', ceiling: 'Ceiling · upside' };
        const nameOf = (pid) => { const p = (playersData && playersData[pid]) || {}; return p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(pid); };

        if (size === 'sm') {
            return (
                <div style={base} onClick={go}>
                    <div style={{ fontSize: '0.64rem', letterSpacing: '0.06em', color: SILVER, fontWeight: 700 }}>LINEUP CHECK</div>
                    <div style={{ marginTop: 'auto' }}>
                        <div style={{ fontFamily: monoFont, fontSize: '1.9rem', fontWeight: 700, color: accent, lineHeight: 1 }}>{headline}</div>
                        <div style={{ fontSize: '0.7rem', color: SILVER, marginTop: '2px' }}>{sub}</div>
                    </div>
                </div>
            );
        }

        const swaps = (d.startInstead || []).slice(0, 3);
        return (
            <div style={base} onClick={go}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontSize: '0.72rem', letterSpacing: '0.07em', color: accent, fontWeight: 700 }}>LINEUP CHECK</div>
                    <div style={{ fontSize: '0.62rem', color: SILVER, opacity: 0.8 }}>WK {result.week} · {OBJ[result.objective] || result.objective}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
                    <span style={{ fontFamily: monoFont, fontSize: '2rem', fontWeight: 700, color: accent, lineHeight: 1 }}>{headline}</span>
                    <span style={{ fontSize: '0.78rem', color: SILVER }}>{sub}</span>
                </div>
                {!optimal && swaps.length ? (
                    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {swaps.map((s, i) => (
                            <div key={i} style={{ fontSize: '0.78rem', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <span style={{ color: GREEN, fontWeight: 700, fontSize: '0.64rem' }}>START</span>
                                <span style={{ color: WHITE, fontWeight: 600 }}>{nameOf(s.pid)}</span>
                                <span style={{ color: SILVER, fontSize: '0.7rem' }}>{(s.pos || '') + ' → ' + String(s.slot).replace('_', ' ')}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ marginTop: '10px', color: SILVER, opacity: 0.75, fontSize: '0.78rem' }}>Your lineup is already optimal this week.</div>
                )}
                <div style={{ marginTop: 'auto', paddingTop: '8px', fontSize: '0.68rem', color: GOLD, opacity: 0.85 }}>Open Lineup →</div>
            </div>
        );
    }

    window.LineupCheckWidget = LineupCheckWidget;
})();
