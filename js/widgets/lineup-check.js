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

        // Sleeper-only projections: load the week's lines and recompute when
        // they land (this widget can render before Game Day ever loads them).
        const [projTick, setProjTick] = React.useState(0);

        // This week's opponent (roster_id as a string), for the compact
        // matchup box. Re-resolved when projections refresh.
        const [oppRid, setOppRid] = React.useState(null);
        React.useEffect(() => {
            const MU = window.App && window.App.Matchup, WP = window.App && window.App.WeeklyProj;
            if (!MU || !MU.resolveOpponentRosterId || !myRoster || !currentLeague) return;
            let alive = true;
            const wk = WP && WP.currentWeek ? WP.currentWeek() : 1;
            MU.resolveOpponentRosterId({ league: currentLeague, myRosterId: myRoster.roster_id, week: wk })
                .then(rid => { if (alive) setOppRid(rid != null ? String(rid) : null); })
                .catch(() => {});
            return () => { alive = false; };
        }, [currentLeague && (currentLeague.league_id || currentLeague.id), myRoster && myRoster.roster_id, projTick]);

        React.useEffect(() => {
            let alive = true;
            const SP = window.App && window.App.SleeperProj;
            if (SP && SP.loadCurrent) SP.loadCurrent(currentLeague && currentLeague.season).then(wk => { if (alive && wk) setProjTick(t => t + 1); }).catch(() => {});
            const onProj = () => { if (alive) setProjTick(t => t + 1); };
            window.addEventListener('wr:proj-updated', onProj);
            return () => { alive = false; window.removeEventListener('wr:proj-updated', onProj); };
        }, [currentLeague && (currentLeague.league_id || currentLeague.id)]);

        const result = React.useMemo(() => {
            const WP = window.App && window.App.WeeklyProj;
            if (!WP || !myRoster || !currentLeague) return null;
            // Same lineup check Game Day reads (DHQ numbers, fewest-moves
            // placement); falls back to Sleeper's numbers while DHQ's load.
            try { return (window.App.DhqProj && window.App.DhqProj.lineupCheck && window.App.DhqProj.lineupCheck(myRoster, currentLeague)) || WP.optimalForRoster(myRoster, currentLeague, { playersData, statsData, priorData: prevStatsData, sleeperOnly: true }); }
            catch (e) { if (window.wrLog) window.wrLog('lineupCheck.widget', e); return null; }
        }, [myRoster, currentLeague, playersData, statsData, prevStatsData, projTick]);

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
        const OBJ = { floor: 'Floor · safe', median: 'Median', ceiling: 'Ceiling · upside', dhq: 'DHQ projections' };
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

        // Compact matchup box (same helper as Game Day's: App.DhqProj.matchup):
        // your set lineup vs the opponent's set lineup on DHQ's numbers, plus
        // the win chance with DHQ's recommended lineup when there are changes.
        const matchup = (() => {
            if (!oppRid || !currentLeague || !myRoster) return null;
            const oppRoster = (currentLeague.rosters || []).find(r => String(r.roster_id) === oppRid);
            const DP = window.App && window.App.DhqProj;
            if (!oppRoster || !DP || !DP.matchup) return null;
            const mine = (myRoster.starters || []).filter(pid => pid && String(pid) !== '0').map(String);
            const now = DP.matchup(mine, oppRoster, currentLeague.roster_positions || []);
            if (!now || !now.fc) return null;
            const oppUser = (currentLeague.users || []).find(u => String(u.user_id) === String(oppRoster.owner_id));
            const name = (oppRoster.metadata && oppRoster.metadata.team_name)
                || (oppUser && oppUser.metadata && oppUser.metadata.team_name)
                || (oppUser && oppUser.display_name)
                || ('Team ' + oppRoster.roster_id);
            const bestPids = !optimal && result.source === 'dhq' && result.optimal && result.optimal.starters
                ? result.optimal.starters.map(s => String(s.pid))
                : null;
            const best = bestPids ? DP.matchup(bestPids, oppRoster, currentLeague.roster_positions || []) : null;
            return { fc: now.fc, name, best: best && best.fc && best.fc.winPct != null ? best.fc : null };
        })();
        const winColor = matchup && matchup.fc.winPct != null
            ? (matchup.fc.winPct >= 55 ? GREEN : matchup.fc.winPct <= 45 ? 'var(--bad, #e74c3c)' : GOLD)
            : SILVER;

        // START for newcomers, MOVE for a starter changing slots.
        const swaps = (d.startInstead || []).map(s => ({ ...s, act: 'START' }))
            .concat((d.moves || []).map(s => ({ ...s, act: 'MOVE' })))
            .slice(0, 6);
        return (
            <div style={base} onClick={go}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontSize: '0.72rem', letterSpacing: '0.07em', color: accent, fontWeight: 700 }}>LINEUP CHECK</div>
                    <div style={{ fontSize: '0.62rem', color: SILVER, opacity: 0.8 }}>WK {result.week} · {OBJ[result.objective] || result.objective}</div>
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
                    <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
                            <span style={{ fontFamily: monoFont, fontSize: '2rem', fontWeight: 700, color: accent, lineHeight: 1 }}>{headline}</span>
                            <span style={{ fontSize: '0.78rem', color: SILVER }}>{sub}</span>
                        </div>
                        {!optimal && swaps.length ? (
                            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {swaps.map((s, i) => (
                                    <div key={i} style={{ fontSize: '0.78rem', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <span style={{ color: s.act === 'MOVE' ? GOLD : GREEN, fontWeight: 700, fontSize: '0.64rem' }}>{s.act || 'START'}</span>
                                        <span style={{ color: WHITE, fontWeight: 600 }}>{nameOf(s.pid)}</span>
                                        <span style={{ color: SILVER, fontSize: '0.7rem' }}>{(s.act === 'MOVE' && s.from ? String(s.from).replace('_', ' ') : (s.pos || '')) + ' → ' + String(s.slot).replace('_', ' ')}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ marginTop: '10px', color: SILVER, opacity: 0.75, fontSize: '0.78rem' }}>Your lineup is already optimal this week.</div>
                        )}
                    </div>
                    {matchup ? (
                        <div style={{ flex: '0 0 auto', width: '190px', alignSelf: 'center', textAlign: 'center', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '8px', padding: '10px 12px', background: 'rgba(255,255,255,0.02)' }}>
                            <div style={{ fontSize: '0.58rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{'WEEK ' + result.week + ' · vs ' + matchup.name}</div>
                            <div style={{ fontFamily: monoFont, fontSize: '1.2rem', fontWeight: 700, color: WHITE, marginTop: '6px', fontVariantNumeric: 'tabular-nums' }}>{matchup.fc.projMe.toFixed(1) + ' – ' + matchup.fc.projOpp.toFixed(1)}</div>
                            <div style={{ fontSize: '0.6rem', color: SILVER, opacity: 0.8 }}>you – them</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: winColor, marginTop: '6px', lineHeight: 1 }}>{matchup.fc.winPct == null ? '—' : matchup.fc.winPct + '%'}</div>
                            <div style={{ fontSize: '0.56rem', letterSpacing: '0.07em', color: SILVER, marginTop: '3px' }}>WIN PROBABILITY</div>
                            {matchup.best && matchup.fc.winPct != null && matchup.best.winPct !== matchup.fc.winPct ? (
                                <div style={{ fontSize: '0.66rem', color: SILVER, marginTop: '5px', fontVariantNumeric: 'tabular-nums' }}>
                                    {matchup.fc.winPct + '% now → '}
                                    <span style={{ color: matchup.best.winPct >= 55 ? GREEN : matchup.best.winPct <= 45 ? 'var(--bad, #e74c3c)' : GOLD, fontWeight: 700 }}>{matchup.best.winPct + '%'}</span>
                                    {' with changes'}
                                </div>
                            ) : null}
                            <div style={{ fontSize: '0.6rem', color: SILVER, opacity: 0.8, marginTop: '3px' }}>{(matchup.fc.margin == null ? '' : (matchup.fc.margin >= 0 ? '+' : '') + matchup.fc.margin.toFixed(1) + ' proj margin · ') + 'DHQ'}</div>
                        </div>
                    ) : null}
                </div>
                <div style={{ marginTop: 'auto', paddingTop: '8px', fontSize: '0.68rem', color: GOLD, opacity: 0.85 }}>Open Lineup →</div>
            </div>
        );
    }

    window.LineupCheckWidget = LineupCheckWidget;
})();
