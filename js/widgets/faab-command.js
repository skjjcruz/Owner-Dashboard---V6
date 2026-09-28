// ══════════════════════════════════════════════════════════════════
// js/widgets/faab-command.js — FAAB Command widget (v3 dashboard)
//
// Surfaces the league-aware FAAB bid plan on Home, auto-picking the top
// unrostered add (same relevance floor as Market Radar's waiver-target
// list — value > 1500, not on any roster) and pricing it with App.faModelBid
// (fallback App.Faab.estimate) — the ONE bid estimate the Free Agency tab and
// the Flash Brief print, on the same value resolver and cached bid history. This is that same intelligence, surfaced
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

        // Inputs the estimate depends on beyond the target: roster budgets /
        // sizes (refreshed in place on the same league object — review S1) and
        // the league's bid history (wr:fa-txns-updated from free-agency.js).
        const rosterSig = (currentLeague?.rosters || []).map(r => r.roster_id + ':' + (Number(r.settings?.waiver_budget_used) || 0) + ':' + (r.players || []).length + ':' + (r.reserve || []).length).join(',');
        const [txnsTick, setTxnsTick] = React.useState(0);
        React.useEffect(() => {
            const h = (e) => { if (!e?.detail?.leagueId || e.detail.leagueId === String(lid)) setTxnsTick(t => t + 1); };
            window.addEventListener('wr:fa-txns-updated', h);
            return () => window.removeEventListener('wr:fa-txns-updated', h);
        }, [lid]);

        const FL = window.App?.FaabLeague;
        const isFaab = FL?.isFaabLeague ? FL.isFaabLeague(currentLeague) : (Number(currentLeague?.settings?.waiver_budget) || 0) > 0;
        const platform = FL?.platformOf ? FL.platformOf(currentLeague) : 'sleeper';

        const [plan, setPlan] = React.useState(null); // null | {loading} | {noFaab} | {notImported} | {est, a, evidence, limits} | {err}
        React.useEffect(() => {
            if (!target || !window.App?.Faab) { setPlan(null); return; }
            // Rolling / reverse waivers, or an import whose bids we don't have:
            // say so — and never hit Sleeper's transaction endpoints with an
            // ESPN / MFL league id.
            if (!isFaab) { setPlan({ noFaab: true }); return; }
            if (platform !== 'sleeper') { setPlan({ notImported: true }); return; }
            if (!window.WrTxns) { setPlan(null); return; }
            let alive = true;
            setPlan(p => (p && p.est && p.pid === target.pid ? p : { loading: true })); // no flash on a roster / history refresh
            (async () => {
                try {
                    // The FA tab's fetch (one in-flight per league, 6h cache) when
                    // the fa group is loaded; the same WrTxns cache otherwise.
                    if (window.App?.faEnsureBidHistory) await window.App.faEnsureBidHistory(currentLeague);
                    else await window.WrTxns.fetchLeagueTxns(lid);
                    const gmEff = window.WR?.GmMode?.effects?.(lid) || {};
                    // ONE estimate (bidfix): App.faModelBid is the call every FA
                    // surface makes — it resolves the player's value itself
                    // (App.PlayerValue: ROS in redraft) and reads the cached
                    // history (getCached), so this tile can't disagree with the
                    // FA tab or the Flash Brief for the same player. Without the
                    // fa group: the identical engine call on identical inputs.
                    const cached = window.WrTxns.getCached ? (window.WrTxns.getCached(lid) || []) : [];
                    const failed = window.WrTxns.getFailedWaivers ? (window.WrTxns.getFailedWaivers(lid) || []) : [];
                    const est = window.App.faModelBid
                        ? window.App.faModelBid({ league: currentLeague, myRoster, playersData, pid: target.pid, pos: target.pos })
                        : (window.App.Faab.estimate ? window.App.Faab.estimate({
                            league: currentLeague, myRosterId: myRoster?.roster_id,
                            txns: cached.concat(failed),
                            playersData,
                            minBidOverride: gmEff.faabMinBid || undefined,
                            targetPid: target.pid, targetPos: target.pos, dhq: target.dhq,
                            playerValue: (rp) => (window.App?.PlayerValue?.getValue ? window.App.PlayerValue.getValue(rp) : (window.App?.LI?.playerScores?.[rp] || 0)),
                            horizonWeeks: window.App?.ChopOdds?.horizonFor?.(lid, null) || null,
                        }) : null);
                    // Win odds only on this league's own history (the FA card's
                    // rule): out of league-median mode AND enough completed
                    // winning bids at the position (review S2).
                    const evidence = window.App?.WaiverTools?.bidEvidence ? window.App.WaiverTools.bidEvidence(cached, currentLeague, target.pos, playersData) : null;
                    const limits = window.App.Faab.limits ? window.App.Faab.limits({ league: currentLeague, myRosterId: myRoster?.roster_id, minBidOverride: gmEff.faabMinBid || undefined }) : null;
                    if (alive) setPlan({ pid: target.pid, est, a: est ? est.analysis : null, evidence, limits });
                } catch (e) { if (window.wrLog) window.wrLog('faab-widget', e); if (alive) setPlan({ err: true }); }
            })();
            return () => { alive = false; };
        }, [lid, target?.pid, target?.dhq, isFaab, platform, rosterSig, txnsTick]);

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
        const muted = (text) => (
            <div style={base} onClick={go}>
                <div style={{ fontSize: '0.7rem', letterSpacing: '0.07em', color: SILVER, fontWeight: 700 }}>FAAB COMMAND</div>
                <div style={{ marginTop: 'auto', color: SILVER, opacity: 0.7, fontSize: '0.8rem' }}>{text}</div>
            </div>
        );
        if (plan.noFaab) {
            const wl = FL?.waiverLabel ? FL.waiverLabel(currentLeague) : 'waivers';
            return muted(wl === 'waivers' ? "This league doesn't run FAAB waivers." : 'This league uses ' + wl + ' — claims go by waiver order, not bids.');
        }
        if (plan.notImported) {
            const plat = ({ espn: 'ESPN', mfl: 'MFL', yahoo: 'Yahoo' })[platform] || platform;
            return muted('Dynasty HQ doesn\u2019t import FAAB bids from ' + plat + ' leagues yet, so there is no bid estimate here.');
        }
        const a = plan.a;
        const est = plan.est;
        const bandText = est && est.lo !== est.hi && window.App?.Faab?.formatRange ? 'est. range ' + window.App.Faab.formatRange(est) : '';
        if (!a) {
            // A FAAB league with no estimate: out of money (the model has no
            // legal bid to give — review S3), or the engine is missing.
            const lim = plan.limits;
            if (lim && lim.exhausted) return muted('Out of FAAB ($' + lim.myLeft + ' left, $' + lim.minBid + ' minimum bid).');
            return muted('No bid estimate right now.');
        }
        const oddsOk = !a.coldStart && !!(plan.evidence && plan.evidence.enough);
        const engaged = a.rivals.filter(r => r.engaged);
        const uncontested = !engaged.length;

        if (size === 'sm') {
            return (
                <div style={base} onClick={go}>
                    <div style={{ fontSize: '0.64rem', letterSpacing: '0.06em', color: SILVER, fontWeight: 700 }}>FAAB COMMAND</div>
                    <div style={{ marginTop: 'auto' }}>
                        <div style={{ fontFamily: monoFont, fontSize: '1.9rem', fontWeight: 700, color: GOLD, lineHeight: 1 }}>${a.rec.bid}</div>
                        <div style={{ fontSize: '0.7rem', color: SILVER, marginTop: '2px' }}>est. · {uncontested ? 'uncontested' : oddsOk ? Math.round(a.rec.winPct * 100) + '% to win' : (bandText || 'thin bid history')} · {target.name}</div>
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
                    <span style={{ fontSize: '0.78rem', color: SILVER }}>est. bid on {target.name} ({target.pos})</span>
                </div>
                <div style={{ marginTop: '6px', fontSize: '0.78rem', color: SILVER }}>
                    {uncontested
                        ? 'No rival has both a need and the budget to chase him — the league minimum should land him.'
                        : (bandText ? bandText + ' · ' : '') + (oddsOk ? Math.round(a.rec.winPct * 100) + '% to win' + (a.rec.capped ? ' (capped by your remaining budget)' : '') : 'not enough league bid history for win odds') + ' · ' + engaged.length + ' rival' + (engaged.length === 1 ? '' : 's') + ' in the market'}
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
