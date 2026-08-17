// ══════════════════════════════════════════════════════════════════
// js/components/season-odds-panel.js — window.WrSeasonOdds
// Playoff odds (Monte Carlo) + this-week leverage + playoff-weeks SOS +
// the luck ledger, as one self-contained panel.
//
// Lives in Game Day (owner ruling 2026-07-30: "season odds would work better
// as a tab in gameday"). It started as an Analytics sub-tab, but Analytics is
// where you study the league and Game Day is where you act — and Game Day
// already owned the season outlook (proj record, bye watch, schedule rail).
// Extracted to its own file rather than inlined so lineup.js (~1300 lines)
// doesn't absorb another 200 of JSX.
//
//   <WrSeasonOdds active currentLeague myRoster playersData statsData
//                 stats2025Data leagueSkin pro onSummary />
//
// `active` gates the fetch — the 10k-sim only runs once the tab is opened.
// `onSummary` reports {projWins, projLosses} back so Game Day's SEASON
// OUTLOOK can source its projected record from THIS simulation instead of
// schedule-engine's per-week sum; two engines printing different projected
// records on one screen is the trust bug the July text-accuracy sweep chased.
//
// Engines: App.Luck (luck-engine.js), App.PlayoffOdds (playoff-odds.js).
// ══════════════════════════════════════════════════════════════════
function WrSeasonOdds({ active, currentLeague, myRoster, playersData, statsData, stats2025Data, leagueSkin, pro, onSummary }) {
    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 var(--text-micro, 0.6875rem) ' + MONO, color: 'var(--text-muted, #8D887E)', letterSpacing: '0.08em', textTransform: 'uppercase' };

    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const [so, setSo] = React.useState({ status: 'idle' });
    // Run-identity ref, NOT an effect-cleanup kill switch: the effect depends
    // on its own status, so its setState re-runs it — a cleanup that flips
    // `alive` would orphan the in-flight run on that very re-run. A late
    // setState after a league switch is ignored by the key check instead.
    const runRef = React.useRef({ key: null });
    React.useEffect(() => { runRef.current.key = null; setSo({ status: 'idle' }); }, [leagueId]);

    // Formats with no playoffs (CHOPPED) get no bracket. Simulating one would
    // invent a 6-team field, seed it off 0-0 records, and hand back a title
    // percentage for a league that never crowns anyone that way.
    const noPlayoffs = leagueSkin?.features?.showPlayoffOdds === false;

    React.useEffect(() => {
        if (noPlayoffs) return;
        if (!active || so.status !== 'idle') return;
        if (runRef.current.key === leagueId) return;   // already ran for this league
        const Luck = window.App?.Luck, PO = window.App?.PlayoffOdds, WP = window.App?.WeeklyProj;
        if (!Luck || !PO || !WP || !currentLeague) { setSo({ status: 'unavailable' }); return; }
        const runKey = leagueId;
        runRef.current.key = runKey;
        const live = () => runRef.current.key === runKey;
        setSo({ status: 'loading' });
        (async () => {
            try {
                const curWk = WP.currentWeek();
                const pws = Number(currentLeague.settings?.playoff_week_start) || 15;
                const lastReg = Math.max(1, Math.min(18, pws - 1));
                // A finished season can't be read off the LIVE NFL week (1 all
                // offseason), so ask for the full regular season explicitly —
                // that's what makes the end-of-year luck recap work at all.
                const seasonOver = leagueSkin?.phase === 'complete' || leagueSkin?.phase === 'offseason';
                const ledger = await Luck.build({ league: currentLeague, throughWeek: seasonOver ? lastReg : undefined });
                const playedWeeks = ledger.weeks.length;
                const bump = () => { if (live()) setSo(s => (s.status === 'ready' ? { ...s, sosTick: (s.sosTick || 0) + 1 } : s)); };
                try { window.App?.SOS?.initialize?.(currentLeague.season, playersData, bump); } catch (_) { /* grid stays empty */ }
                const playoffTeams = Math.max(2, Number(currentLeague.settings?.playoff_teams) || 6);
                const rounds = Math.ceil(Math.log2(playoffTeams));
                const playoffWeeks = [];
                for (let w = pws; w < pws + rounds && w <= 18; w++) playoffWeeks.push(w);
                try { window.App?.NflContext?.load?.(playoffWeeks, currentLeague.season).then(bump); } catch (_) { /* grid stays empty */ }

                let sim = null;
                // !seasonOver is load-bearing: with a finished season curWk is 1,
                // so without it every played week would be re-simulated as a
                // "future" game on top of the record it already produced.
                if (!seasonOver && playedWeeks >= 2 && curWk <= lastReg) {
                    const futurePairs = await PO.fetchFuturePairs({ league: currentLeague, fromWeek: curWk, toWeek: lastReg });
                    sim = PO.simulate({ league: currentLeague, ledger, futurePairs, myRosterId: myRoster?.roster_id, sims: 10000 });
                }
                if (live()) setSo({ status: 'ready', ledger, sim, playedWeeks, curWk, pws, playoffWeeks });
            } catch (e) {
                window.wrLog?.('seasonOdds.build', e);
                if (live()) setSo({ status: 'error' });
            }
        })();
    }, [active, so.status, leagueId]);

    // Starters for the playoff-SOS grid (recomputes when SOS / NFL context land).
    const sos = React.useMemo(() => {
        if (so.status !== 'ready' || !so.playoffWeeks?.length) return null;
        const WP = window.App?.WeeklyProj, PO = window.App?.PlayoffOdds;
        if (!WP || !PO || !myRoster) return null;
        try {
            const res = WP.optimalForRoster(myRoster, currentLeague, { playersData, statsData, priorData: stats2025Data, week: so.curWk });
            const starters = (res.optimal?.starters || []).map(s => ({
                pid: s.pid, pos: s.pos,
                team: String(playersData?.[s.pid]?.team || '').toUpperCase() || null,
            })).filter(s => s.team);
            return PO.playoffSos({ starters, playersData, weeks: so.playoffWeeks });
        } catch (e) { return null; }
    }, [so.status, so.sosTick, leagueId]);

    // Hand Game Day the sim's projected record so SEASON OUTLOOK and this
    // panel can't disagree. Fires only when the numbers actually change.
    const myId = String(myRoster?.roster_id ?? '');
    const mine = so.status === 'ready' && so.sim ? so.sim.rows.find(r => String(r.rosterId) === myId) : null;
    React.useEffect(() => {
        if (typeof onSummary !== 'function') return;
        onSummary(mine ? { projWins: mine.projWins, projLosses: mine.projLosses, playoffPct: mine.playoffPct } : null);
    }, [mine ? mine.projWins : null, mine ? mine.projLosses : null, mine ? mine.playoffPct : null]);

    // ── Shells ───────────────────────────────────────────────────────
    const Section = ({ title, meta, children }) => (
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600, textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );
    const Kpi = ({ label, value, sub, color }) => (
        <div style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderRadius: '6px', padding: '9px 11px', minWidth: '104px', flex: 1 }}>
            <div style={{ ...microHdr }}>{label}</div>
            <div style={{ ...mono, fontSize: '1.3rem', fontWeight: 700, color: color || TEXT, marginTop: '2px' }}>{value}</div>
            {sub ? <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '1px' }}>{sub}</div> : null}
        </div>
    );

    if (noPlayoffs) {
        return (
            <Section title="Season Odds" meta="not applicable in this format">
                <div style={{ color: SILVER, fontSize: '0.78rem', lineHeight: 1.6 }}>
                    This league has no playoff bracket — every week the lowest scorer is chopped and the last team standing wins.
                    Playoff, bye and title odds would be invented here, so they are not shown. Survival odds are the number that matters in this format.
                </div>
            </Section>
        );
    }
    if (!pro) {
        return window.WrGatedMoreRow
            ? <window.WrGatedMoreRow title="Season odds" sub="Playoff, bye and title odds from 10,000 simulations, this-week leverage, playoff-weeks strength of schedule, and the luck ledger" feature={(window.FEATURES && window.FEATURES.STARTSIT_DEPTH) || 'startsit_depth'} />
            : null;
    }
    if (so.status === 'loading' || so.status === 'idle') {
        return <Section title="Season Odds" meta="10,000 season simulations"><div style={{ color: SILVER, fontSize: '0.78rem', ...mono }}>{so.status === 'idle' ? 'Loading season data…' : 'Simulating the rest of the season…'}</div></Section>;
    }
    if (so.status === 'error' || so.status === 'unavailable') {
        return <Section title="Season Odds"><div style={{ color: SILVER, fontSize: '0.78rem' }}>Season odds are unavailable right now — weekly scores could not be loaded.</div></Section>;
    }

    const { ledger, sim, playedWeeks } = so;
    if (!playedWeeks) {
        return <Section title="Season Odds"><div style={{ color: SILVER, fontSize: '0.78rem', lineHeight: 1.5 }}>No games scored yet this season. Playoff odds, this-week leverage and the luck ledger all light up from Week 1 onward.</div></Section>;
    }

    const luckRows = ledger?.rows || [];
    const myLuck = luckRows.find(r => String(r.rosterId) === myId);
    const AV = window.AlexVoice;

    // Deterministic (non-AI) read: the buy-low seller is the unluckiest team
    // that is nonetheless out-scoring half the league.
    let alexRead = null;
    if (AV && luckRows.length) {
        const seller = [...luckRows].filter(r => r.luck < -0.8 && r.allPlayPct >= 0.5).sort((a, b) => a.luck - b.luck)[0];
        const seed = leagueId + ':' + playedWeeks;
        if (seller && String(seller.rosterId) !== myId) {
            alexRead = AV.pick(seed, [
                seller.name + ' is ' + seller.wins + '-' + seller.losses + ' but would be ~' + Math.round(seller.expWins) + '-' + Math.round(playedWeeks - seller.expWins) + ' against an average schedule. Their record says sell — their roster says contender. Buy from them before they look at this table.',
                'Watch ' + seller.name + ': ' + Math.abs(seller.luck).toFixed(1) + ' wins BELOW what their scoring earned, hiding a top-half roster. That is your trade-deadline seller — move before the market reads the same number.',
                seller.name + ' has been robbed by the schedule — ' + Math.abs(seller.luck).toFixed(1) + ' wins short of what their points deserved. Frustrated managers sell low. Be the buyer.',
            ]);
        } else if (myLuck && myLuck.luck >= 1) {
            alexRead = AV.pick(seed, [
                'You are ' + myLuck.wins + '-' + myLuck.losses + ' with ' + myLuck.expWins.toFixed(1) + ' expected wins — the schedule has been kind. Bank the standings cushion, but plan like a ' + Math.round(myLuck.expWins) + '-win roster.',
                'Your record is running ' + myLuck.luck.toFixed(1) + ' wins hot of your scoring. Nothing wrong with luck — just don’t pay contender prices at the deadline because of it.',
            ]);
        }
    }

    const tagColor = t => t === 'EASY' ? GREEN : t === 'HARD' ? RED : SILVER;
    const oddsGrid = { display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 0.7fr 0.8fr 0.7fr 0.7fr 0.9fr', gap: '8px', alignItems: 'center', padding: '6px 10px', minWidth: 0 };
    const luckGrid = { display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 0.7fr 0.9fr 0.8fr 0.7fr', gap: '8px', alignItems: 'center', padding: '6px 10px', minWidth: 0 };
    const rowLine = { borderBottom: `1px solid ${LINE}`, color: SILVER, fontSize: '0.75rem', ...mono };
    const myRowStyle = { background: 'rgba(212,175,55,0.07)', boxShadow: `inset 3px 0 0 ${GOLD}`, color: TEXT };
    const swing = sim && sim.leverage ? Math.abs((sim.leverage.ifWin ?? 0) - (sim.leverage.ifLose ?? 0)) : 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {sim ? (
                <Section title="Playoff Odds" meta={sim.simCount.toLocaleString() + ' simulations · record then points-for' + (sim.usedDivisions ? ' · division winners seeded' : '')}>
                    {mine ? (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                            <Kpi label="Make playoffs" value={mine.playoffPct + '%'} color={GOLD} />
                            {sim.byeSlots ? <Kpi label="First-round bye" value={(mine.byePct ?? 0) + '%'} /> : null}
                            <Kpi label="Win title" value={mine.titlePct + '%'} />
                            <Kpi label="Proj record" value={mine.projWins + '-' + mine.projLosses} sub={mine.avgSeed ? 'avg seed ' + mine.avgSeed : null} />
                        </div>
                    ) : null}
                    <div style={{ overflowX: 'auto' }}>
                        <div style={{ minWidth: '520px' }}>
                            <div style={{ ...oddsGrid, ...microHdr, borderBottom: `1px solid ${LINE}` }}>
                                <span>Team</span><span style={{ textAlign: 'right' }}>Rec</span><span style={{ textAlign: 'right' }}>Playoff</span>
                                {sim.byeSlots ? <span style={{ textAlign: 'right' }}>Bye</span> : <span />}
                                <span style={{ textAlign: 'right' }}>Title</span><span style={{ textAlign: 'right' }}>Proj W-L</span>
                            </div>
                            {sim.rows.map(r => (
                                <div key={r.rosterId} style={{ ...oddsGrid, ...rowLine, ...(String(r.rosterId) === myId ? myRowStyle : {}) }}>
                                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                                    <span style={{ textAlign: 'right' }}>{r.record}</span>
                                    <span style={{ textAlign: 'right', color: String(r.rosterId) === myId ? GOLD : undefined }}>{r.playoffPct}%</span>
                                    {sim.byeSlots ? <span style={{ textAlign: 'right' }}>{r.byePct != null ? r.byePct + '%' : '—'}</span> : <span />}
                                    <span style={{ textAlign: 'right' }}>{r.titlePct}%</span>
                                    <span style={{ textAlign: 'right', opacity: 0.8 }}>{r.projWins}-{r.projLosses}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </Section>
            ) : (
                <Section title="Playoff Odds">
                    <div style={{ color: SILVER, fontSize: '0.78rem' }}>
                        {playedWeeks < 2 ? 'Playoff odds unlock once two weeks of scores are in the books.' : 'The regular season is decided — playoff odds retire until next year.'}
                    </div>
                </Section>
            )}

            {sim && sim.leverage ? (
                <Section title="This Week's Leverage" meta={'your playoff odds conditioned on the Week ' + sim.leverage.week + ' result'}>
                    {[['If you win', sim.leverage.ifWin, GREEN], ['Current', sim.leverage.current, GOLD], ['If you lose', sim.leverage.ifLose, RED]].map(([lb, v, c]) => (
                        <div key={lb} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 48px', gap: '10px', alignItems: 'center', padding: '4px 0' }}>
                            <span style={{ ...microHdr }}>{lb}</span>
                            <div style={{ height: '6px', background: '#0C0E13', border: `1px solid ${LINE}`, borderRadius: '3px', overflow: 'hidden' }}>
                                <i style={{ display: 'block', height: '100%', width: (v ?? 0) + '%', background: c }} />
                            </div>
                            <b style={{ ...mono, fontSize: '0.75rem', textAlign: 'right', color: TEXT }}>{v != null ? v + '%' : '—'}</b>
                        </div>
                    ))}
                    <div style={{ color: SILVER, fontSize: '0.76rem', marginTop: '8px', lineHeight: 1.5 }}>
                        A {swing}-point playoff-odds swing rides on this week{swing >= 20 ? ' — high leverage favors the ceiling lineup over the safe one' : ''}.
                    </div>
                </Section>
            ) : null}

            {sos && sos.coverage > 0 ? (
                <Section title="Playoff-Weeks Strength of Schedule" meta={'your starters vs Wk ' + so.playoffWeeks[0] + '–' + so.playoffWeeks[so.playoffWeeks.length - 1] + ' defenses'}>
                    <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(' + so.playoffWeeks.length + ', 1fr)', gap: '6px', maxWidth: '460px' }}>
                        <span />
                        {so.playoffWeeks.map(w => <span key={w} style={{ ...microHdr, textAlign: 'center' }}>WK {w}</span>)}
                        {['QB', 'RB', 'WR', 'TE'].map(p => (<React.Fragment key={p}>
                            <span style={{ ...microHdr, alignSelf: 'center' }}>{p}</span>
                            {so.playoffWeeks.map((w, i) => {
                                const cell = sos.weeks[i]?.byPos?.[p];
                                return (
                                    <span key={w} title={cell ? cell.team + ' vs ' + cell.opp + ' — allows rank ' + cell.rank + ' fantasy pts to ' + p : 'No starter / opponent unresolved'}
                                        style={{ ...mono, fontSize: '0.66rem', fontWeight: 600, textAlign: 'center', padding: '6px 2px', borderRadius: '4px', border: '1px solid ' + (cell ? (cell.tag === 'EASY' ? 'rgba(46,204,113,0.45)' : cell.tag === 'HARD' ? 'rgba(231,76,60,0.45)' : LINE) : 'rgba(255,255,255,0.07)'), color: cell ? tagColor(cell.tag) : 'var(--text-muted, #8D887E)' }}>
                                        {cell ? cell.tag : '—'}
                                    </span>
                                );
                            })}
                        </React.Fragment>))}
                    </div>
                    {sos.coverage < 0.7 ? <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '8px' }}>Some opponents unresolved — the grid fills in as the NFL schedule context loads.</div> : null}
                </Section>
            ) : null}

            <Section title="Luck Ledger" meta={'all-play · expected wins · through ' + playedWeeks + ' week' + (playedWeeks === 1 ? '' : 's')}>
                {alexRead ? (
                    <div style={{ background: 'var(--black, #121217)', border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: '0 6px 6px 0', padding: '10px 12px', marginBottom: '12px' }}>
                        <div style={{ ...microHdr, color: GOLD, marginBottom: '4px' }}>Alex Ingram</div>
                        <div style={{ fontSize: '0.8rem', color: '#C9C9D2', lineHeight: 1.5 }}>{alexRead}</div>
                    </div>
                ) : null}
                <div id="wr-export-luck" style={{ overflowX: 'auto', background: 'var(--black, #121217)' }}>
                    <div style={{ minWidth: '460px' }}>
                        <div style={{ ...luckGrid, ...microHdr, borderBottom: `1px solid ${LINE}` }}>
                            <span>Team</span><span style={{ textAlign: 'right' }}>Rec</span><span style={{ textAlign: 'right' }}>All-Play</span>
                            <span style={{ textAlign: 'right' }}>Exp. W</span><span style={{ textAlign: 'right' }}>Luck</span>
                        </div>
                        {luckRows.map(r => (
                            <div key={r.rosterId} style={{ ...luckGrid, ...rowLine, ...(String(r.rosterId) === myId ? myRowStyle : {}) }}>
                                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                                <span style={{ textAlign: 'right' }}>{r.wins}-{r.losses}{r.ties ? '-' + r.ties : ''}</span>
                                <span style={{ textAlign: 'right' }}>{r.allPlayW}-{r.allPlayL}</span>
                                {/* toFixed(1) on both — tabular mono columns, and a bare 3
                                    beside a 3.4 breaks digit alignment. */}
                                <span style={{ textAlign: 'right' }}>{r.expWins.toFixed(1)}</span>
                                <span style={{ textAlign: 'right', fontWeight: 700, color: r.luck >= 0.5 ? GREEN : r.luck <= -0.5 ? RED : SILVER }}>{r.luck > 0 ? '+' : ''}{r.luck.toFixed(1)}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
                    {window.wrExport ? (
                        <button onClick={() => window.wrExport.capture(document.getElementById('wr-export-luck'), 'luck-ledger')}
                            style={{ padding: '6px 12px', background: 'transparent', color: GOLD, border: '1px solid rgba(212,175,55,0.5)', borderRadius: '5px', font: '700 0.66rem ' + MONO, letterSpacing: '0.05em', textTransform: 'uppercase', cursor: 'pointer' }}>
                            Export for league chat
                        </button>
                    ) : null}
                    <span style={{ ...microHdr, textTransform: 'none', letterSpacing: 0 }}>All-play = your record if you played everyone every week. Luck = actual wins − expected.</span>
                </div>
                {myLuck && myLuck.weekly.length ? (
                    <div style={{ marginTop: '14px', overflowX: 'auto' }}>
                        <div style={{ ...microHdr, marginBottom: '6px' }}>Your weekly ledger</div>
                        <div style={{ minWidth: '380px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr 1fr 1fr', gap: '8px', padding: '4px 10px', ...microHdr, borderBottom: `1px solid ${LINE}` }}>
                                <span>Wk</span><span style={{ textAlign: 'right' }}>PF</span><span style={{ textAlign: 'right' }}>Median</span><span style={{ textAlign: 'right' }}>Result</span><span style={{ textAlign: 'right' }}>All-Play</span>
                            </div>
                            {myLuck.weekly.map(g => (
                                <div key={g.week} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 1fr 1fr 1fr', gap: '8px', padding: '5px 10px', ...rowLine }}>
                                    <span>{g.week}</span>
                                    <span style={{ textAlign: 'right', color: TEXT }}>{g.pts.toFixed(1)}</span>
                                    <span style={{ textAlign: 'right', opacity: 0.7 }}>{g.median.toFixed(1)}</span>
                                    <span style={{ textAlign: 'right', fontWeight: 700, color: g.result === 'W' ? GREEN : g.result === 'L' ? RED : SILVER }}>{g.result || '—'}</span>
                                    <span style={{ textAlign: 'right', opacity: 0.8 }}>{g.allPlayW}-{g.allPlayL}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
            </Section>
        </div>
    );
}

window.WrSeasonOdds = WrSeasonOdds;
