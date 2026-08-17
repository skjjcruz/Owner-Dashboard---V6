// ══════════════════════════════════════════════════════════════════
// js/components/chop-block-panel.js — window.WrChopBlock
// The Chopping Block: survival odds for a Sleeper CHOPPED league.
//
//   <WrChopBlock active currentLeague myRoster />
//
// Renders three things and nothing else:
//   1. YOUR number — chance of being chopped this week, and how many more
//      weeks you can expect to play.
//   2. The block — every living team ordered by danger. This doubles as the
//      corpse preview: the team at the top is the one whose entire roster is
//      most likely to hit the waiver pool next.
//   3. The chopped, in the order they went.
//
// Data: App.Luck.build gives the weekly-score matrix, App.ChopOdds simulates
// forward. Preseason (no played weeks) is labelled as projection-based rather
// than presented as if it were form.
//
// Deferred with the "lineup" group. Pure render + one async load.
// ══════════════════════════════════════════════════════════════════
function WrChopBlock({ active, currentLeague, myRoster }) {
    const SILVER = 'var(--silver, #BDB8AD)', TEXT = 'var(--white, #F5F2EA)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)';
    const AMBER = 'var(--k-f0a500, #f0a500)', GOLD = 'var(--gold, #D4AF37)';
    const LINE = 'var(--co-line, #27262E)', WELL = 'var(--co-well, #0F0F14)';
    const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
    const mono = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums' };
    const microHdr = { font: '600 0.6875rem ' + MONO, color: '#8D887E', letterSpacing: '0.08em', textTransform: 'uppercase' };

    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const [st, setSt] = React.useState({ status: 'idle' });
    // Run-identity ref, not a cleanup kill switch — the effect depends on its
    // own status, so a cleanup flag would orphan the in-flight run.
    const runRef = React.useRef({ key: null });
    React.useEffect(() => { runRef.current.key = null; setSt({ status: 'idle' }); }, [leagueId]);

    React.useEffect(() => {
        if (!active || st.status !== 'idle') return;
        if (runRef.current.key === leagueId) return;
        const Ch = window.App?.Chopped, CO = window.App?.ChopOdds, Luck = window.App?.Luck, WP = window.App?.WeeklyProj;
        if (!Ch || !CO || !Luck || !currentLeague) { setSt({ status: 'unavailable' }); return; }
        if (!Ch.isChopped(currentLeague)) { setSt({ status: 'not-chopped' }); return; }
        runRef.current.key = leagueId;
        const live = () => runRef.current.key === leagueId;
        setSt({ status: 'loading' });
        (async () => {
            try {
                const week = WP?.currentWeek ? WP.currentWeek() : 1;
                let ledger = { rows: [] };
                try { ledger = await Luck.build({ league: currentLeague }); } catch (e) { /* preseason */ }
                if (!live()) return;
                const sim = CO.simulate({
                    league: currentLeague,
                    rosters: currentLeague.rosters || window.S?.rosters || [],
                    ledger, week, myRosterId: myRoster?.roster_id,
                });
                if (!live()) return;
                setSt(sim ? { status: 'ready', sim } : { status: 'unavailable' });
            } catch (e) { window.wrLog?.('chopBlock', e); if (live()) setSt({ status: 'error' }); }
        })();
    }, [active, st.status, leagueId, currentLeague, myRoster]);

    const Section = ({ title, meta, children }) => (
        <div style={{ background: 'var(--co-surface, #121217)', border: `1px solid ${LINE}`, borderRadius: '8px', padding: '14px 16px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <span style={{ font: '700 0.82rem ' + MONO, color: TEXT, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</span>
                {meta ? <span style={{ ...microHdr }}>{meta}</span> : null}
            </div>
            {children}
        </div>
    );

    if (st.status === 'not-chopped') return null;
    if (st.status === 'loading' || st.status === 'idle') {
        return <Section title="The Chopping Block"><div style={{ color: SILVER, fontSize: '0.78rem', ...mono }}>Simulating survival…</div></Section>;
    }
    if (st.status !== 'ready') {
        return <Section title="The Chopping Block"><div style={{ color: SILVER, fontSize: '0.78rem' }}>Survival odds are unavailable right now — weekly scores could not be loaded.</div></Section>;
    }

    const { sim } = st;
    const me = sim.me;
    const alive = sim.rows.filter(r => r.alive);
    const dead = sim.rows.filter(r => !r.alive);
    const riskCol = p => (p >= 25 ? RED : p >= 12 ? AMBER : p >= 5 ? GOLD : GREEN);
    const projected = sim.basis === 'projected';

    return (
        <div>
            {me && me.alive ? (
                <Section title="Your Survival" meta={(projected ? 'projected form · ' : '') + sim.simCount.toLocaleString() + ' simulations'}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
                        {[
                            { lbl: 'Chopped this week', val: me.chopThisWeekPct + '%', col: riskCol(me.chopThisWeekPct) },
                            { lbl: 'Weeks left (expected)', val: me.expWeeksLeft, col: TEXT },
                            { lbl: 'Survive the season', val: me.survivePct + '%', col: me.survivePct >= 20 ? GREEN : TEXT },
                            { lbl: 'Last one standing', val: me.winPct + '%', col: GOLD },
                        ].map(k => (
                            <div key={k.lbl} style={{ background: WELL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '9px 11px' }}>
                                <div style={{ ...microHdr }}>{k.lbl}</div>
                                <div style={{ ...mono, fontSize: '1.25rem', fontWeight: 700, color: k.col, marginTop: '2px' }}>{k.val}</div>
                            </div>
                        ))}
                    </div>
                    <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '9px', lineHeight: 1.55 }}>
                        {projected
                            ? 'No games played yet — these run off projected roster strength, not form. They will sharpen every week.'
                            : 'Every week the lowest score is chopped. Trust the this-week number most: the season-long figures assume nobody rebuilds off the waiver pool, and in this format everybody does.'}
                    </div>
                </Section>
            ) : me && !me.alive ? (
                <Section title="Your Survival" meta={'chopped in week ' + me.eliminatedWeek}>
                    <div style={{ color: SILVER, fontSize: '0.8rem', lineHeight: 1.6 }}>
                        You were chopped in <b style={{ color: TEXT }}>week {me.eliminatedWeek}</b> and your roster went back to the waiver pool. The block below is still live.
                    </div>
                </Section>
            ) : null}

            <Section title="The Block" meta={alive.length + ' alive · most at risk first'}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>
                            {['Team', 'Chop risk', 'Survive', 'Win', 'Wks left'].map((h, i) => (
                                <th key={h} style={{ ...microHdr, textAlign: i ? 'right' : 'left', padding: '4px 8px', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                        </tr></thead>
                        <tbody>
                            {alive.map(r => {
                                const isMe = me && String(r.rosterId) === String(me.rosterId);
                                return (
                                    <tr key={r.rosterId} style={{ background: isMe ? 'var(--co-accent-fill, #12212B)' : 'transparent' }}>
                                        <td style={{ padding: '6px 8px', fontSize: '0.78rem', color: isMe ? TEXT : SILVER, fontWeight: isMe ? 700 : 500, fontFamily: 'var(--font-body)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                                        <td style={{ ...mono, padding: '6px 8px', textAlign: 'right', fontSize: '0.8rem', fontWeight: 700, color: riskCol(r.chopThisWeekPct) }}>{r.chopThisWeekPct}%</td>
                                        <td style={{ ...mono, padding: '6px 8px', textAlign: 'right', fontSize: '0.78rem', color: SILVER }}>{r.survivePct}%</td>
                                        <td style={{ ...mono, padding: '6px 8px', textAlign: 'right', fontSize: '0.78rem', color: r.winPct >= 10 ? GOLD : SILVER }}>{r.winPct}%</td>
                                        <td style={{ ...mono, padding: '6px 8px', textAlign: 'right', fontSize: '0.78rem', color: SILVER }}>{r.expWeeksLeft}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {alive.length > 1 ? (
                    <div style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, marginTop: '8px', lineHeight: 1.55 }}>
                        <b style={{ color: TEXT }}>{alive[0].name}</b> is most likely to go this week — that roster is the one about to hit the waiver pool. Plan your bids before it does.
                    </div>
                ) : null}
            </Section>

            {dead.length ? (
                <Section title="Already Chopped" meta={dead.length + ' gone'}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {dead.slice().sort((a, b) => (a.eliminatedWeek || 0) - (b.eliminatedWeek || 0)).map(r => (
                            <span key={r.rosterId} style={{ ...microHdr, textTransform: 'none', letterSpacing: 0, background: WELL, border: `1px solid ${LINE}`, borderRadius: '5px', padding: '4px 8px', color: SILVER }}>
                                <span style={{ ...mono, color: RED, fontWeight: 700 }}>W{r.eliminatedWeek}</span>{' '}{r.name}
                            </span>
                        ))}
                    </div>
                </Section>
            ) : null}
        </div>
    );
}
window.WrChopBlock = WrChopBlock;
