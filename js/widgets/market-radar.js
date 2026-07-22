// ══════════════════════════════════════════════════════════════════
// js/widgets/market-radar.js — Market Radar widget (v3)
//
// Trade opportunities + waiver targets + FAAB — actionable trade intel.
//
// sm: deal count + top partner name → Trade Center
// md: 2-3 owners with surplus at positions you're thin in
// lg: trade partners + waiver wire + FAAB (compact, no scroll)
// xl: split — partners (left) | waivers/FAAB (right), no scroll
// xxl: full dashboard — partners + waivers + FAAB + position-fit matrix
// ══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function MarketRadarWidget({ size, myRoster, rankedTeams, sleeperUserId, currentLeague, playersData, setActiveTab, navigateWidget }) {
        const theme = window.WrTheme?.get?.() || {};
        const colors = theme.colors || {};
        const fonts = theme.fonts || {};
        const cardStyle = window.WrTheme?.cardStyle?.() || {};
        const fs = (rem) => window.WrTheme?.fontSize?.(rem) || (rem + 'rem');
        const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters }) || { isUsable: true };

        // ── GM Strategy (single source of truth) ──
        const gm = window.WR.GmMode.useGmEffects(currentLeague);
        const gmTargets = gm.targetPositions || new Set();        // positions to pursue
        const gmFa = gm.faFilters || null;                        // FA-tab waiver filters
        const posture = gm.marketPosture || 'hold';               // buy_low|sell_high|hold|exploit
        // Mirrors free-agency.js gmFaPeakYears: peak years remaining for a pos/age.
        const gmFaPeakYears = (pos, age) => {
            const curve = (typeof window.App?.getAgeCurve === 'function' ? window.App.getAgeCurve(pos) : null)
                || { peak: (window.App?.peakWindows || {})[pos] || [24, 29] };
            const peakEnd = (curve.peak && curve.peak[1]) || 29;
            return Math.max(0, peakEnd - (Number(age) || 25));
        };
        const POSTURE_LABEL = {
            buy_low: 'BUY-LOW · target sellers',
            sell_high: 'SELL-HIGH · target buyers',
            exploit: 'EXPLOIT · target inefficiency',
            hold: 'HOLD · mutual-fit deals',
        };

        const myAssess = React.useMemo(() => {
            if (typeof window.assessTeamFromGlobal === 'function' && myRoster?.roster_id) {
                return window.assessTeamFromGlobal(myRoster.roster_id);
            }
            return null;
        }, [myRoster?.roster_id]);

        const allAssess = React.useMemo(() => {
            if (typeof window.assessAllTeamsFromGlobal === 'function') return window.assessAllTeamsFromGlobal() || [];
            return [];
        }, []);

        const myNeedPositions = (myAssess?.needs || []).map(n => typeof n === 'string' ? n : n?.pos).filter(Boolean);
        const myStrengthPositions = (myAssess?.strengths || []).map(s => typeof s === 'string' ? s : s?.pos).filter(Boolean);

        // ── Trade partners: owners with surplus at positions you need ──
        const tradeTargets = React.useMemo(() => {
            if (!rosterState.isUsable) return [];
            if (!myAssess || !allAssess.length) return [];
            return allAssess
                .filter(a => a.rosterId !== myRoster?.roster_id)
                .map(a => {
                    const theirNeeds = (a.needs || []).map(n => typeof n === 'string' ? n : n?.pos).filter(Boolean);
                    const theirStrengths = (a.strengths || []).map(s => typeof s === 'string' ? s : s?.pos).filter(Boolean);
                    const theirSurplusFillsMe = theirStrengths.filter(s => myNeedPositions.includes(s));
                    const myStrengthsFillThem = myStrengthPositions.filter(s => theirNeeds.includes(s));
                    const compat = (theirSurplusFillsMe.length + myStrengthsFillThem.length) * 20;
                    const roster = (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId);
                    const user = roster ? (currentLeague?.users || window.S?.leagueUsers || []).find(u => u.user_id === roster.owner_id) : null;
                    const name = user?.metadata?.team_name || user?.display_name || ('Team ' + a.rosterId);
                    const avatar = user?.avatar || null;
                    // ── GM posture fit: nudge (don't replace) partner ordering ──
                    // Re-frame WHO to approach by my market posture. A small bonus so
                    // strategy-aligned partners float up without erasing compatibility.
                    const win = a.window;
                    const hurting = (a.healthScore || 0) < 40;       // undervalued / injured / panicking
                    let postureFit = 0;
                    if (posture === 'buy_low') postureFit = (win === 'REBUILDING' ? 1 : 0) + (hurting ? 1 : 0);
                    else if (posture === 'sell_high') postureFit = (win === 'CONTENDING' ? 2 : 0);
                    else if (posture === 'exploit') postureFit = hurting ? 2 : 0;
                    else postureFit = (theirSurplusFillsMe.length && myStrengthsFillThem.length) ? 1 : 0; // hold: mutual fit
                    return {
                        ...a,
                        compat, name, avatar, postureFit,
                        theySurplus: theirSurplusFillsMe,         // their strengths that fill my needs
                        myOffers: myStrengthsFillThem,             // my strengths that fill their needs
                        theirNeeds: theirNeeds.slice(0, 3),
                        theirStrengths: theirStrengths.slice(0, 3),
                    };
                })
                .filter(a => a.compat > 0)
                .sort((a, b) => (b.compat + b.postureFit * 8) - (a.compat + a.postureFit * 8) || b.compat - a.compat)
                .slice(0, 8);
        }, [rosterState.isUsable, myAssess, allAssess, myRoster?.roster_id, posture]);

        const dealCount = tradeTargets.length;
        const topTarget = tradeTargets[0];
        const dealCol = dealCount >= 3 ? colors.positive : dealCount >= 1 ? colors.accent : colors.textMuted;

        // FAAB
        const faab = React.useMemo(() => {
            const budget = currentLeague?.settings?.waiver_budget || 100;
            const used = myRoster?.settings?.waiver_budget_used || 0;
            const remaining = Math.max(0, budget - used);
            const pct = (remaining / Math.max(budget, 1)) * 100;
            return { remaining, budget, pct };
        }, [currentLeague, myRoster]);

        // Waiver targets (un-rostered, DHQ > threshold)
        // GM faFilters (minDhq/maxAge/requirePrimeYears/excludePositions) are applied
        // so this list matches the Free Agency tab's recommendation surface.
        const waiverTargets = React.useMemo(() => {
            if (!rosterState.isUsable) return [];
            const scores = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (window.App?.LI?.playerScores || {});
            const rostered = new Set();
            (currentLeague?.rosters || []).forEach(r => (r.players || []).concat(r.taxi || [], r.reserve || []).forEach(pid => rostered.add(String(pid))));
            const f = gmFa || {};
            const exclude = (Array.isArray(f.excludePositions) ? f.excludePositions : [])
                .map(p => String((window.App?.normPos?.(p)) || p || '').toUpperCase()).filter(Boolean);
            const minDhq = Number(f.minDhq) || 0;
            const maxAge = Number(f.maxAge) || 0;
            const requirePrime = !!f.requirePrimeYears;
            return Object.entries(scores)
                .filter(([pid]) => !rostered.has(pid) && scores[pid] > 1500)
                .map(([pid, dhq]) => {
                    const p = playersData?.[pid] || {};
                    return {
                        pid, name: p.full_name || pid,
                        pos: window.App?.normPos?.(p.position) || p.position || '?',
                        age: Number(p.age) || 0,
                        dhq, team: p.team || 'FA',
                    };
                })
                .filter(x => {
                    if (minDhq && (Number(x.dhq) || 0) < minDhq) return false;
                    if (exclude.includes(String(x.pos).toUpperCase())) return false;
                    if (maxAge && x.age && x.age > maxAge) return false;
                    if (requirePrime && !(gmFaPeakYears(x.pos, x.age) > 0)) return false;
                    return true;
                })
                .sort((a, b) => b.dhq - a.dhq)
                .slice(0, 12);
        }, [rosterState.isUsable, currentLeague, playersData, gmFa]);

        // Find a specific player from your surplus that fills their need
        const swapSuggestions = React.useMemo(() => {
            if (!rosterState.isUsable) return {};
            const scores = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (window.App?.LI?.playerScores || {});
            const myPlayers = (myRoster?.players || []);
            const out = {};
            tradeTargets.forEach(t => {
                const candidates = myPlayers
                    .filter(pid => {
                        const p = playersData?.[pid];
                        if (!p) return false;
                        const pos = window.App?.normPos?.(p.position) || p.position || '';
                        return t.theirNeeds.includes(pos) && myStrengthPositions.includes(pos);
                    })
                    .map(pid => ({ pid, name: (playersData[pid]?.full_name || ''), pos: window.App?.normPos?.(playersData[pid]?.position) || '', dhq: scores[pid] || 0 }))
                    .sort((a, b) => b.dhq - a.dhq);
                if (candidates.length) out[t.rosterId || t.name] = candidates[0];
            });
            return out;
        }, [rosterState.isUsable, tradeTargets, myRoster, playersData, myStrengthPositions]);

        // ── Leverage Board (xxl): who is DESPERATE, not just who fits ──
        // Buyers: contending teams with the oldest DHQ-weighted cores — they
        // pay up for win-now help and overpay with picks for youth.
        // Sellers: rebuilders hoarding picks — they move vets for futures.
        const leverage = React.useMemo(() => {
            if (!rosterState.isUsable || !allAssess.length || size !== 'xxl') return { buyers: [], sellers: [] };
            const scores = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (window.App?.LI?.playerScores || {});
            const withAge = allAssess.filter(a => a.rosterId !== myRoster?.roster_id).map(a => {
                const roster = (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId);
                let dhqSum = 0, ageSum = 0;
                (roster?.players || []).forEach(pid => {
                    const dhq = scores[pid] || 0;
                    const age = playersData?.[pid]?.age;
                    if (dhq > 0 && Number.isFinite(age)) { dhqSum += dhq; ageSum += age * dhq; }
                });
                const user = roster ? (currentLeague?.users || window.S?.leagueUsers || []).find(u => u.user_id === roster.owner_id) : null;
                return {
                    rosterId: a.rosterId,
                    name: user?.metadata?.team_name || user?.display_name || a.ownerName || ('Team ' + a.rosterId),
                    wAge: dhqSum > 0 ? ageSum / dhqSum : 0,
                    picks: a.picksAssessment?.totalPicks ?? null,
                    tradeWindow: a.window,
                    healthScore: a.healthScore || 0,
                };
            });
            const buyers = withAge.filter(a => a.tradeWindow === 'CONTENDING' && a.wAge > 0)
                .sort((x, y) => y.wAge - x.wAge).slice(0, 3);
            const sellers = withAge.filter(a => a.tradeWindow === 'REBUILDING')
                .sort((x, y) => ((y.picks || 0) - (x.picks || 0)) || (x.healthScore - y.healthScore)).slice(0, 3);
            return { buyers, sellers };
        }, [rosterState.isUsable, allAssess, currentLeague, playersData, myRoster?.roster_id, size]);

        const isClickable = size === 'sm' || size === 'md';
        const goTo = (target, e) => {
            e?.stopPropagation?.();
            if (navigateWidget) navigateWidget(target);
            else if (setActiveTab) setActiveTab(target);
        };
        const openTrades = (e) => goTo('trades', e);
        const openFreeAgency = (e) => goTo('fa', e);
        const onClick = () => { if (isClickable) openTrades(); };
        const openCard = (pid) => {
            if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
            else if (typeof window.openPlayerModal === 'function') window.openPlayerModal(pid);
        };

        // ── Avatar URL helper ──
        const avatarUrl = (id) => id ? 'https://sleepercdn.com/avatars/thumbs/' + id : null;

        if (!rosterState.isUsable) {
            return window.App?.renderRosterDataBlocker?.(rosterState, {
                title: size === 'sm' ? 'Market paused' : 'Market Radar paused',
                message: 'Trade and waiver signals need complete roster IDs.',
                detail: rosterState.detail,
                compact: size === 'sm' || size === 'md',
                fill: true,
                actionLabel: size === 'sm' ? null : 'Open Trades',
                onAction: openTrades,
                style: { cursor: isClickable ? 'pointer' : 'default' },
            });
        }

        // ── SM: deal count + top partner name ──
        if (size === 'sm') {
            return (
                <div onClick={onClick} style={{
                    ...cardStyle, padding: 'var(--card-pad, 14px 16px)', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '4px',
                }}>
                    <div style={{
                        fontFamily: fonts.mono, fontSize: fs(2.0), fontWeight: 700,
                        color: dealCol, lineHeight: 1,
                    }} className="wr-data-value">{dealCount}</div>
                    <div style={{ fontSize: fs(0.7), color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: fonts.ui }}>
                        TRADE TARGETS
                    </div>
                    {topTarget ? (
                        <div style={{
                            marginTop: '4px', fontSize: fs(0.6), color: colors.textMuted,
                            fontFamily: fonts.ui, lineHeight: 1.3, padding: '0 4px',
                            borderTop: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'),
                            paddingTop: '4px', width: '100%',
                        }}>
                            Top: <span style={{ color: colors.text, fontWeight: 700 }}>{(topTarget.name || '').slice(0, 12)}</span>
                            <div style={{ fontSize: fs(0.54), color: colors.textFaint, marginTop: '1px' }}>
                                wants {topTarget.theirNeeds[0] || '?'} · has {topTarget.theySurplus[0] || '?'}
                            </div>
                        </div>
                    ) : (
                        <div style={{ marginTop: '4px', fontSize: fs(0.58), color: colors.textFaint, fontStyle: 'italic' }}>
                            No matches yet
                        </div>
                    )}
                </div>
            );
        }

        // ── MD: 2 owners with surplus at my thin positions ──
        if (size === 'md') {
            const top2 = tradeTargets.slice(0, 2);
            return (
                <div onClick={onClick} style={{ ...cardStyle, padding: 'var(--card-pad, 12px 14px)', cursor: 'pointer', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.95rem' }}>📡</span>
                        <span style={{ fontFamily: fonts.display, fontSize: fs(0.85), fontWeight: 700, color: colors.purple || 'var(--k-7c6bf8, #7c6bf8)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Surplus Match</span>
                        {gm.hasStrategy && <span title="GM Strategy posture" style={{ fontSize: fs(0.46), fontWeight: 700, color: colors.gold || 'var(--gold, #d4af37)', fontFamily: fonts.ui, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '1px 5px', borderRadius: 3, background: wrAlpha(colors.gold || 'var(--gold, #d4af37)', '12') }}>{(posture || 'hold').replace('_', '-')}</span>}
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: fs(0.6), color: colors.textMuted, fontFamily: fonts.ui }}>{dealCount} fits</span>
                    </div>
                    {!top2.length && (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(0.7), color: colors.textFaint, fontStyle: 'italic' }}>
                            No surplus matches for your needs
                        </div>
                    )}
                    {top2.length > 0 && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 }}>
                            {top2.map((t, i) => {
                                const hasTgt = (t.theySurplus || []).some(s => gmTargets.has(String(s)));
                                const goldCol = colors.gold || 'var(--gold, #d4af37)';
                                return (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', background: hasTgt ? wrAlpha(goldCol, '10') : 'var(--ov-1, rgba(255,255,255,0.02))', borderRadius: '4px', borderLeft: '2px solid ' + (hasTgt ? goldCol : (colors.purple || 'var(--k-7c6bf8, #7c6bf8)')) }}>
                                    {t.avatar ? <img src={avatarUrl(t.avatar)} style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0 }} alt="" /> : <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--ov-3, rgba(255,255,255,0.05))', flexShrink: 0 }} />}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: fs(0.7), fontWeight: 700, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                                        <div style={{ fontSize: fs(0.6), color: colors.textMuted, fontFamily: fonts.ui }}>
                                            surplus: <span style={{ color: hasTgt ? goldCol : colors.positive, fontWeight: hasTgt ? 800 : 700 }}>{t.theySurplus.join('/') || '—'}</span>
                                        </div>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

        // ── Reusable partner row ──
        // opts.oneLine: collapse into a single dense row (used in lg to fit no-scroll)
        function renderPartner(t, i, opts = {}) {
            const compact = !!opts.compact;
            const oneLine = !!opts.oneLine;
            const compatCol = t.compat >= 60 ? colors.positive : t.compat >= 30 ? colors.accent : colors.warn;
            const swap = swapSuggestions[t.rosterId || t.name];
            // Surplus that lands a GM Strategy target position → gold-accented + bold.
            const surplusHasTarget = (t.theySurplus || []).some(s => gmTargets.has(String(s)));
            const goldCol = colors.gold || 'var(--gold, #d4af37)';
            const renderSurplus = (defColor) => (t.theySurplus || []).length
                ? (t.theySurplus || []).map((s, si) => {
                    const hit = gmTargets.has(String(s));
                    return (
                        <React.Fragment key={si}>
                            {si > 0 && <span style={{ color: colors.textFaint }}>/</span>}
                            <span style={{ color: hit ? goldCol : defColor, fontWeight: hit ? 800 : 700 }}>{s}</span>
                        </React.Fragment>
                    );
                })
                : <span style={{ color: defColor, fontWeight: 700 }}>—</span>;

            if (oneLine) {
                return (
                    <div key={i} onClick={openTrades} style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '3px 6px',
                        minHeight: '32px',
                        background: surplusHasTarget ? wrAlpha(goldCol, '10') : 'var(--ov-1, rgba(255,255,255,0.02))',
                        borderRadius: '4px',
                        borderLeft: '2px solid ' + (surplusHasTarget ? goldCol : compatCol),
                        cursor: 'pointer',
                    }}>
                        {t.avatar ? <img src={avatarUrl(t.avatar)} style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0 }} alt="" /> : <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--ov-3, rgba(255,255,255,0.05))', flexShrink: 0 }} />}
                        <span style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 80, maxWidth: 120 }}>{t.name}</span>
                        <span style={{ fontSize: fs(0.56), color: colors.textMuted, fontFamily: fonts.ui, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {renderSurplus(colors.positive)}
                            {' for '}
                            <span style={{ color: colors.warn, fontWeight: 700 }}>{t.myOffers.join('/') || '—'}</span>
                        </span>
                        <span style={{ fontSize: fs(0.58), fontWeight: 700, color: compatCol, fontFamily: fonts.mono, minWidth: 26, textAlign: 'right' }}>{t.compat}%</span>
                    </div>
                );
            }

            return (
                <div key={i} onClick={openTrades} style={{
                    padding: compact ? '4px 6px' : '6px 8px',
                    minHeight: '32px',
                    background: surplusHasTarget ? wrAlpha(goldCol, '10') : 'var(--ov-1, rgba(255,255,255,0.02))',
                    borderRadius: '4px',
                    borderLeft: '2px solid ' + (surplusHasTarget ? goldCol : compatCol),
                    marginBottom: '4px',
                    cursor: 'pointer',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {t.avatar ? <img src={avatarUrl(t.avatar)} style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0 }} alt="" /> : null}
                        <span style={{ flex: 1, fontSize: fs(compact ? 0.66 : 0.74), fontWeight: 700, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                        {surplusHasTarget && <span style={{ fontSize: fs(0.5), fontWeight: 700, color: goldCol, letterSpacing: '0.04em' }} title="Surplus matches a GM Strategy target position">TGT</span>}
                        <span style={{ fontSize: fs(0.62), fontWeight: 700, color: compatCol, fontFamily: fonts.mono }}>{t.compat}%</span>
                    </div>
                    <div style={{ fontSize: fs(compact ? 0.56 : 0.62), color: colors.textMuted, fontFamily: fonts.ui, marginTop: '1px' }}>
                        their surplus: {renderSurplus(colors.positive)}
                        {' · '}
                        you offer: <span style={{ color: colors.warn, fontWeight: 700 }}>{t.myOffers.join('/') || '—'}</span>
                    </div>
                    {!compact && swap && (
                        <div style={{ fontSize: fs(0.58), color: colors.purple || 'var(--k-7c6bf8, #7c6bf8)', fontFamily: fonts.ui, marginTop: '2px' }}>
                            Swap idea: <span style={{ fontWeight: 700 }}>{swap.name}</span> ({swap.pos})
                        </div>
                    )}
                </div>
            );
        }

        // ── Reusable waiver row ──
        function renderWaiver(p, i, compact) {
            const fillsNeed = myNeedPositions.includes(p.pos);
            const isTarget = gmTargets.has(String(p.pos));   // GM Strategy pursue position
            return (
                <div key={i} role="button" tabIndex={0} onClick={() => openCard(p.pid)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(p.pid); } }} title={isTarget ? 'Strategy target position · open player card' : 'Open player card'} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 4px', minHeight: '32px', borderBottom: '1px solid var(--ov-1, rgba(255,255,255,0.02))', fontSize: fs(compact ? 0.62 : 0.66), cursor: 'pointer', background: isTarget ? wrAlpha(colors.gold || 'var(--gold, #d4af37)', '12') : 'transparent', borderLeft: isTarget ? '2px solid ' + (colors.gold || 'var(--gold, #d4af37)') : '2px solid transparent', marginLeft: isTarget ? '-4px' : 0 }}>
                    <span style={{ flex: 1, fontWeight: isTarget ? 800 : 700, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: fonts.ui }}>{p.name}</span>
                    <span style={{ fontSize: fs(0.5), padding: '0px 4px', borderRadius: 3, background: wrAlpha(window.App?.POS_COLORS?.[p.pos] || colors.accent, '22'), color: window.App?.POS_COLORS?.[p.pos] || colors.accent, fontWeight: 700 }}>{p.pos}</span>
                    {isTarget && <span style={{ fontSize: fs(0.5), fontWeight: 700, color: colors.gold || 'var(--gold, #d4af37)' }} title="GM Strategy target position">TGT</span>}
                    {!isTarget && fillsNeed && <span style={{ fontSize: fs(0.5), fontWeight: 700, color: colors.positive }}>NEED</span>}
                    <span style={{ fontSize: fs(0.56), color: colors.textMuted, fontFamily: fonts.mono, minWidth: 28, textAlign: 'right' }}>{p.dhq >= 1000 ? (p.dhq / 1000).toFixed(1) + 'k' : p.dhq}</span>
                </div>
            );
        }

        // ── Reusable FAAB bar ──
        function renderFaab(opts = {}) {
            return (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fs(0.6), color: colors.textMuted, marginBottom: '2px', fontFamily: fonts.ui }}>
                        <span>FAAB</span>
                        <span>${faab.remaining} / ${faab.budget} ({Math.round(faab.pct)}%)</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: faab.pct + '%', height: '100%', background: faab.pct > 50 ? colors.positive : faab.pct > 25 ? colors.warn : colors.negative }} />
                    </div>
                </div>
            );
        }

        // ── Header ──
        const postureLabel = POSTURE_LABEL[posture] || POSTURE_LABEL.hold;
        function header(opts = {}) {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: opts.large ? '1.1rem' : '1rem' }}>📡</span>
                    <span style={{ fontFamily: fonts.display, fontSize: fs(opts.large ? 1.05 : 0.95), fontWeight: 700, color: colors.purple || 'var(--k-7c6bf8, #7c6bf8)', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Market Radar</span>
                    {gm.hasStrategy && (
                        <span title={'GM Strategy posture frames partner selection'} style={{ fontSize: fs(0.5), fontWeight: 700, color: colors.gold || 'var(--gold, #d4af37)', fontFamily: fonts.ui, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 3, border: '1px solid ' + wrAlpha(colors.gold || 'var(--gold, #d4af37)', '40'), background: wrAlpha(colors.gold || 'var(--gold, #d4af37)', '12'), whiteSpace: 'nowrap' }}>{postureLabel}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: fs(0.62), color: colors.textMuted, fontFamily: fonts.ui }}>{dealCount} targets · ${faab.remaining}</span>
                    <button onClick={openTrades} title="Open Trade Center" style={{ padding: '3px 8px', background: wrAlpha(colors.purple || 'var(--k-7c6bf8, #7c6bf8)', '1A'), color: colors.purple || 'var(--k-7c6bf8, #7c6bf8)', border: '1px solid ' + wrAlpha(colors.purple || 'var(--k-7c6bf8, #7c6bf8)', '47'), borderRadius: '5px', cursor: 'pointer', fontSize: fs(0.56), fontFamily: fonts.ui, fontWeight: 700, whiteSpace: 'nowrap' }}>Trades</button>
                    <button onClick={openFreeAgency} title="Open Free Agency" style={{ padding: '3px 8px', background: wrAlpha(colors.info || 'var(--k-3498db, #3498db)', '1A'), color: colors.info || 'var(--k-3498db, #3498db)', border: '1px solid ' + wrAlpha(colors.info || 'var(--k-3498db, #3498db)', '47'), borderRadius: '5px', cursor: 'pointer', fontSize: fs(0.56), fontFamily: fonts.ui, fontWeight: 700, whiteSpace: 'nowrap' }}>FA</button>
                </div>
            );
        }

        // ── LG: 4 single-line partners + 4 waivers + FAAB (no scroll, 320px) ──
        if (size === 'lg') {
            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 12px 14px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header()}
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' }}>
                        <div style={{ flexShrink: 0 }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px', fontFamily: fonts.ui }}>Trade Partners</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {tradeTargets.length === 0 ? <div style={{ fontSize: fs(0.62), color: colors.textFaint, fontStyle: 'italic' }}>No matches</div> : tradeTargets.slice(0, 4).map((t, i) => renderPartner(t, i, { oneLine: true }))}
                            </div>
                        </div>
                        <div style={{ flexShrink: 0 }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px', fontFamily: fonts.ui }}>Waiver Wire</div>
                            {waiverTargets.length === 0 ? <div style={{ fontSize: fs(0.62), color: colors.textFaint, fontStyle: 'italic' }}>Clean</div> : waiverTargets.slice(0, 4).map((p, i) => renderWaiver(p, i, true))}
                        </div>
                        <div style={{ flexShrink: 0, marginTop: 'auto' }}>{renderFaab()}</div>
                    </div>
                </div>
            );
        }

        // ── XL: 3-col split — partners | waivers | top ideas + FAAB ──
        if (size === 'xl') {
            const ideas = tradeTargets.slice(0, 2).map(t => ({
                partner: t,
                swap: swapSuggestions[t.rosterId || t.name],
                targetPos: t.theySurplus[0] || t.theirNeeds[0] || '?',
            }));
            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 12px 14px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header()}
                    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: '14px', overflow: 'hidden' }}>
                        {/* Col 1: Trade Partners */}
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: fonts.ui }}>Trade Partners</div>
                            {tradeTargets.length === 0 ? <div style={{ fontSize: fs(0.66), color: colors.textFaint, fontStyle: 'italic' }}>No matches</div> : tradeTargets.slice(0, 5).map((t, i) => renderPartner(t, i, { compact: true }))}
                        </div>
                        {/* Col 2: Waiver Wire */}
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px', fontFamily: fonts.ui }}>Waiver Wire</div>
                            {waiverTargets.length === 0 ? <div style={{ fontSize: fs(0.62), color: colors.textFaint, fontStyle: 'italic' }}>Clean</div> : waiverTargets.slice(0, 8).map((p, i) => renderWaiver(p, i, true))}
                        </div>
                        {/* Col 3: Top ideas + FAAB */}
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: fonts.ui }}>Top Ideas</div>
                            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' }}>
                                {ideas.length === 0 ? <div style={{ fontSize: fs(0.62), color: colors.textFaint, fontStyle: 'italic' }}>No matches</div> : ideas.map((idea, i) => {
                                    const t = idea.partner;
                                    const compatCol = t.compat >= 60 ? colors.positive : t.compat >= 30 ? colors.accent : colors.warn;
                                    return (
                                        <div key={i} style={{ padding: '6px 8px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + wrAlpha(compatCol, '44'), borderRadius: '4px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                                                {t.avatar ? <img src={avatarUrl(t.avatar)} style={{ width: 14, height: 14, borderRadius: '50%' }} alt="" /> : null}
                                                <span style={{ flex: 1, fontSize: fs(0.62), fontWeight: 700, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                                                <span style={{ fontSize: fs(0.54), fontWeight: 700, color: compatCol, fontFamily: fonts.mono }}>{t.compat}%</span>
                                            </div>
                                            <div style={{ fontSize: fs(0.56), color: colors.textMuted, fontFamily: fonts.ui }}>
                                                {idea.swap
                                                    ? <>Send <span style={{ color: colors.warn, fontWeight: 700 }}>{idea.swap.name}</span> for <span style={{ color: colors.positive, fontWeight: 700 }}>{idea.targetPos}</span></>
                                                    : <>Their <span style={{ color: colors.positive, fontWeight: 700 }}>{idea.targetPos}</span> surplus</>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ flexShrink: 0 }}>{renderFaab()}</div>
                        </div>
                    </div>
                </div>
            );
        }

        // ── XXL: full dashboard — packed across all real estate ──
        if (size === 'xxl') {
            // Position-fit matrix: for each of my needs, who has surplus?
            const matrix = myNeedPositions.slice(0, 6).map(pos => {
                const owners = allAssess
                    .filter(a => a.rosterId !== myRoster?.roster_id)
                    .filter(a => (a.strengths || []).some(s => (typeof s === 'string' ? s : s?.pos) === pos))
                    .map(a => {
                        const roster = (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId);
                        const user = roster ? (currentLeague?.users || window.S?.leagueUsers || []).find(u => u.user_id === roster.owner_id) : null;
                        return user?.metadata?.team_name || user?.display_name || ('Team ' + a.rosterId);
                    })
                    .slice(0, 3);
                return { pos, owners };
            });

            // Concrete top trade ideas: top 3 partners with a specific player swap
            const ideas = tradeTargets.slice(0, 3).map(t => {
                const swap = swapSuggestions[t.rosterId || t.name];
                return {
                    partner: t,
                    swap,
                    targetPos: t.theySurplus[0] || t.theirNeeds[0] || '?',
                };
            });

            // FAAB context: average remaining FAAB across league
            const faabContext = (() => {
                const budget = currentLeague?.settings?.waiver_budget || 0;
                if (!budget) return null;
                const allRemaining = (currentLeague?.rosters || []).map(r => Math.max(0, budget - (r.settings?.waiver_budget_used || 0)));
                const avg = allRemaining.reduce((s, v) => s + v, 0) / Math.max(allRemaining.length, 1);
                const sorted = [...allRemaining].sort((a, b) => b - a);
                const myRank = sorted.indexOf(faab.remaining) + 1;
                return { avg: Math.round(avg), myRank, total: allRemaining.length };
            })();

            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header({ large: true })}
                    {/* Top strip: Surplus matrix | Leverage Board | FAAB context */}
                    <div style={{ marginBottom: '10px', flexShrink: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1.2fr) minmax(0, 1fr)', gap: '10px' }}>
                        {matrix.length > 0 ? (
                            <div style={{ padding: '8px 10px', background: wrAlpha(colors.purple || 'var(--k-7c6bf8, #7c6bf8)', '0F'), border: '1px solid ' + wrAlpha(colors.purple || 'var(--k-7c6bf8, #7c6bf8)', '33'), borderRadius: '6px' }}>
                                <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.purple || 'var(--k-7c6bf8, #7c6bf8)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Surplus by Position (your needs)</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '6px' }}>
                                    {matrix.map((m, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: fs(0.62), fontFamily: fonts.ui }}>
                                            <span style={{ minWidth: 24, fontWeight: 700, color: window.App?.POS_COLORS?.[m.pos] || colors.warn, fontFamily: fonts.ui }}>{m.pos}</span>
                                            <span style={{ flex: 1, color: colors.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {m.owners.length ? m.owners.slice(0, 3).map(o => o.slice(0, 10)).join(', ') : <em style={{ color: colors.textFaint }}>nobody has surplus</em>}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : <div />}
                        {/* Leverage Board */}
                        <div style={{ padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'), borderRadius: '6px', minWidth: 0, overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Leverage Board</div>
                            {(leverage.buyers.length === 0 && leverage.sellers.length === 0) && (
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.textFaint, fontStyle: 'italic', fontFamily: fonts.ui }}>No clear buyers or sellers yet.</div>
                            )}
                            {leverage.buyers.map(t => (
                                <div key={'b' + t.rosterId} onClick={openTrades} role="button" tabIndex={0}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTrades(e); } }}
                                    title="Open Trade Center"
                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '2px 0', cursor: 'pointer' }}>
                                    <span style={{ fontSize: fs(0.6) }}>🔥</span>
                                    <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.warn || 'var(--k-f0a500, #f0a500)', fontFamily: fonts.ui, whiteSpace: 'nowrap' }}>buys now · core {t.wAge.toFixed(1)}</span>
                                </div>
                            ))}
                            {leverage.sellers.map(t => (
                                <div key={'s' + t.rosterId} onClick={openTrades} role="button" tabIndex={0}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTrades(e); } }}
                                    title="Open Trade Center"
                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '2px 0', cursor: 'pointer' }}>
                                    <span style={{ fontSize: fs(0.6) }}>🧊</span>
                                    <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: colors.info || 'var(--k-3498db, #3498db)', fontFamily: fonts.ui, whiteSpace: 'nowrap' }}>{Number.isFinite(t.picks) ? 'sells vets · ' + t.picks + ' picks' : 'sells vets'}</span>
                                </div>
                            ))}
                        </div>
                        {faabContext && (
                            <div style={{ padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'), borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: fonts.ui }}>FAAB · You vs League</div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', fontFamily: fonts.mono }}>
                                    <span style={{ fontSize: fs(1.2), fontWeight: 700, color: faab.pct > 50 ? colors.positive : faab.pct > 25 ? colors.warn : colors.negative }}>${faab.remaining}</span>
                                    <span style={{ fontSize: fs(0.6), color: colors.textMuted }}>vs ${faabContext.avg} avg</span>
                                </div>
                                <div style={{ height: 6, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                                    <div style={{ width: faab.pct + '%', height: '100%', background: faab.pct > 50 ? colors.positive : faab.pct > 25 ? colors.warn : colors.negative }} />
                                </div>
                                <div style={{ fontSize: fs(0.58), color: colors.textMuted, fontFamily: fonts.ui }}>
                                    Rank #{faabContext.myRank} of {faabContext.total} · {Math.round(faab.pct)}% of ${faab.budget}
                                </div>
                            </div>
                        )}
                    </div>
                    {/* Top trade ideas — concrete swap suggestions */}
                    {ideas.length > 0 && (
                        <div style={{ marginBottom: '10px', flexShrink: 0 }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Top Trade Ideas</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + ideas.length + ', 1fr)', gap: '8px' }}>
                                {ideas.map((idea, i) => {
                                    const t = idea.partner;
                                    const compatCol = t.compat >= 60 ? colors.positive : t.compat >= 30 ? colors.accent : colors.warn;
                                    return (
                                        <div key={i} style={{ padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + wrAlpha(compatCol, '44'), borderRadius: '6px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                                {t.avatar ? <img src={avatarUrl(t.avatar)} style={{ width: 18, height: 18, borderRadius: '50%' }} alt="" /> : null}
                                                <span style={{ flex: 1, fontSize: fs(0.7), fontWeight: 700, color: colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                                                <span style={{ fontSize: fs(0.6), fontWeight: 700, color: compatCol, fontFamily: fonts.mono }}>{t.compat}%</span>
                                            </div>
                                            <div style={{ fontSize: fs(0.6), color: colors.textMuted, fontFamily: fonts.ui, lineHeight: 1.4 }}>
                                                {idea.swap ? (
                                                    <>
                                                        Send <span style={{ color: colors.warn, fontWeight: 700 }}>{idea.swap.name}</span> ({idea.swap.pos}, {idea.swap.dhq >= 1000 ? (idea.swap.dhq / 1000).toFixed(1) + 'k' : idea.swap.dhq})
                                                        <br />
                                                        for their <span style={{ color: colors.positive, fontWeight: 700 }}>{idea.targetPos}</span> depth
                                                    </>
                                                ) : (
                                                    <>
                                                        Pursue their <span style={{ color: colors.positive, fontWeight: 700 }}>{idea.targetPos}</span> surplus
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {/* Two-col: partners | waivers */}
                    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '16px', overflow: 'hidden' }}>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: fonts.ui }}>Trade Partners</div>
                            {tradeTargets.length === 0 ? <div style={{ fontSize: fs(0.66), color: colors.textFaint, fontStyle: 'italic' }}>No matches</div> : tradeTargets.map((t, i) => renderPartner(t, i, { compact: true }))}
                        </div>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                                <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px', fontFamily: fonts.ui }}>Waiver Wire</div>
                                {waiverTargets.length === 0 ? <div style={{ fontSize: fs(0.62), color: colors.textFaint, fontStyle: 'italic' }}>Clean</div> : waiverTargets.map((p, i) => renderWaiver(p, i, false))}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    }

    window.MarketRadarWidget = MarketRadarWidget;
})();
