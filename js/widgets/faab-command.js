// ══════════════════════════════════════════════════════════════════
// js/widgets/faab-command.js — FAAB Command widget (v3 dashboard)
//
// Surfaces the league-aware FAAB bid plan on Home, auto-picking the top
// unrostered add (same relevance floor as Market Radar's waiver-target
// list — DHQ > 1500, not on any roster) and running it through
// App.Faab.analyze — the same engine the Free Agency tab's FaabCommandCard
// uses for a hand-picked target. This is that same intelligence, surfaced
// without requiring a visit to the FA tab first.
//
// sizes: sm (hero bid + win%) · md/lg (+ pacing verdict + contested read)
// Depends on: theme.js, faab-engine.js (App.Faab), txns-fetch.js (WrTxns)
// Exposes:    window.FaabCommandWidget
// ══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    function FaabCommandWidget({ size, myRoster, currentLeague, playersData, setActiveTab, navigateWidget }) {
        const cardStyle = window.WrTheme?.cardStyle?.() || { background: 'var(--black)', border: 'var(--card-border)', borderRadius: 'var(--card-radius)' };
        const go = () => { if (navigateWidget) navigateWidget('fa'); else if (setActiveTab) setActiveTab('fa'); };
        const lid = currentLeague?.league_id || currentLeague?.id || '';
        // Pre-draft (empty rosters): "unrostered" is trivially every NFL player,
        // so the auto-picked target reads as noise, not a real recommendation —
        // same paused state Roster Pulse / Market Radar show pre-draft.
        const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters }) || { isUsable: true };

        // Top unrostered target — same relevance floor as Market Radar's
        // waiverTargets (js/widgets/market-radar.js) so the two surfaces agree
        // on what counts as a real add, minus the optional GM Strategy filters
        // (this tile is a single auto-picked headline, not a browsable list).
        const target = React.useMemo(() => {
            const scores = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (window.App?.LI?.playerScores || {});
            const rostered = new Set();
            (currentLeague?.rosters || []).forEach(r => (r.players || []).concat(r.taxi || [], r.reserve || []).forEach(pid => rostered.add(String(pid))));
            let best = null;
            for (const pid in scores) {
                const dhq = scores[pid];
                if (!(dhq > 1500) || rostered.has(String(pid))) continue;
                if (best && dhq <= best.dhq) continue;
                const p = playersData?.[pid] || {};
                best = { pid, name: p.full_name || pid, pos: window.App?.normPos?.(p.position) || p.position || '?', dhq };
            }
            return best;
        }, [currentLeague, playersData]);

        const [plan, setPlan] = React.useState(null); // null | {loading} | {a} | {err}
        React.useEffect(() => {
            if (!target || !window.App?.Faab || !window.WrTxns) { setPlan(null); return; }
            let alive = true;
            setPlan({ loading: true });
            (async () => {
                try {
                    const txns = await window.WrTxns.fetchLeagueTxns(lid);
                    const failed = window.WrTxns.getFailedWaivers(lid);
                    const gmEff = window.WR?.GmMode?.effects?.(lid) || {};
                    const a = window.App.Faab.analyze({
                        league: currentLeague, myRosterId: myRoster?.roster_id,
                        txns: (txns || []).concat(failed || []),
                        playersData,
                        minBidOverride: gmEff.faabMinBid || undefined,
                        targetPid: target.pid, targetPos: target.pos,
                        targetStrength: Math.max(0.15, Math.min(1, (Number(target.dhq) || 0) / 6000)),
                        horizonWeeks: window.App?.ChopOdds?.horizonFor?.(lid, null) || null,
                    });
                    if (alive) setPlan(a ? { a } : null);
                } catch (e) { if (alive) setPlan({ err: true }); }
            })();
            return () => { alive = false; };
        }, [lid, target?.pid]);

        const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #bdb8ad)', WARN = 'var(--warn, #f0a500)', WHITE = 'var(--white, #f5f2ea)';
        const monoFont = 'var(--font-mono, monospace)';
        const base = { ...cardStyle, height: '100%', padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', cursor: 'pointer', boxSizing: 'border-box' };

        if (!rosterState.isUsable) {
            return window.App?.renderRosterDataBlocker?.(rosterState, {
                title: size === 'sm' ? 'Sync' : 'FAAB Command paused',
                compact: size === 'sm' || size === 'md',
                fill: true,
                actionLabel: size === 'sm' ? null : 'Open Roster',
                onAction: () => { if (navigateWidget) navigateWidget('myteam'); else if (setActiveTab) setActiveTab('myteam'); },
                style: { cursor: size === 'sm' || size === 'md' ? 'pointer' : 'default' },
            });
        }

        if (!target || (plan && plan.err)) {
            return (
                <div style={base} onClick={go}>
                    <div style={{ fontSize: '0.7rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 700 }}>FAAB COMMAND</div>
                    <div style={{ marginTop: 'auto', color: SILVER, opacity: 0.7, fontSize: '0.8rem' }}>No FAAB targets clear the wire right now.</div>
                </div>
            );
        }
        if (!plan || plan.loading) {
            return (
                <div style={base} onClick={go}>
                    <div style={{ fontSize: '0.7rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 700 }}>FAAB COMMAND</div>
                    <div style={{ marginTop: 'auto', color: SILVER, opacity: 0.7, fontSize: '0.8rem' }}>Reading this league's bid history…</div>
                </div>
            );
        }
        const a = plan.a;
        if (!a) {
            // Pre-effect, or not a FAAB league at all — engine returns null.
            return (
                <div style={base} onClick={go}>
                    <div style={{ fontSize: '0.7rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 700 }}>FAAB COMMAND</div>
                    <div style={{ marginTop: 'auto', color: SILVER, opacity: 0.7, fontSize: '0.8rem' }}>This league doesn't run FAAB waivers.</div>
                </div>
            );
        }
        const engaged = a.rivals.filter(r => r.engaged);
        const uncontested = !engaged.length;

        if (size === 'sm') {
            return (
                <div style={base} onClick={go}>
                    <div style={{ fontSize: '0.64rem', letterSpacing: '0.06em', color: SILVER, fontWeight: 700 }}>FAAB COMMAND</div>
                    <div style={{ marginTop: 'auto' }}>
                        <div style={{ fontFamily: monoFont, fontSize: '1.9rem', fontWeight: 700, color: GOLD, lineHeight: 1 }}>${a.rec.bid}</div>
                        <div style={{ fontSize: '0.7rem', color: SILVER, marginTop: '2px' }}>{uncontested ? 'uncontested' : Math.round(a.rec.winPct * 100) + '% to win'} · {target.name}</div>
                    </div>
                </div>
            );
        }

        return (
            <div style={base} onClick={go}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div style={{ fontSize: '0.72rem', letterSpacing: '0.07em', color: GOLD, fontWeight: 700 }}>FAAB COMMAND</div>
                    <div style={{ fontSize: '0.62rem', color: SILVER, opacity: 0.8 }}>${a.myLeft} of ${a.budget} left</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
                    <span style={{ fontFamily: monoFont, fontSize: '2rem', fontWeight: 700, color: GOLD, lineHeight: 1 }}>${a.rec.bid}</span>
                    <span style={{ fontSize: '0.78rem', color: SILVER }}>on {target.name} ({target.pos})</span>
                </div>
                <div style={{ marginTop: '6px', fontSize: '0.78rem', color: SILVER }}>
                    {uncontested
                        ? 'No rival has both a need and the budget to chase him — the league minimum should land him.'
                        : Math.round(a.rec.winPct * 100) + '% to win' + (a.rec.capped ? ' (capped by your remaining budget)' : '') + ' · ' + engaged.length + ' rival' + (engaged.length === 1 ? '' : 's') + ' in the market'}
                </div>
                {a.pacing && a.pacing.verdict === 'hoarding' ? (
                    <div style={{ marginTop: '10px', fontSize: '0.76rem', color: WARN }}>
                        <b>You are hoarding.</b> ~{a.pacing.horizonWeeks} weeks left — at your ${a.pacing.myPacePerWeek}/wk pace, ${a.pacing.projectedUnspent.toLocaleString()} goes unspent.
                    </div>
                ) : null}
                <div style={{ marginTop: 'auto', paddingTop: '8px', fontSize: '0.68rem', color: GOLD, opacity: 0.85 }}>Open Free Agency →</div>
            </div>
        );
    }

    window.FaabCommandWidget = FaabCommandWidget;
})();
