// ══════════════════════════════════════════════════════════════════
// js/widgets/league-landscape.js — League Landscape widget (v3)
//
// Power rankings + standings + activity + tier distribution.
//
// sm: My rank with labels + activity count
// md: Top 5 power rankings with bars (compact)
// lg: Standings + tier strip + recent activity (no scroll, 320px)
// tall: lg + biggest movers + transaction trends
// xl: Two-column split (full standings | activity feed) — no scroll
// xxl: Full standings + activity + position-of-power chart + tier dist
//
// Depends on: theme.js, core.js (assessAllTeamsFromGlobal)
// Exposes:    window.LeagueLandscapeWidget
// ══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function LeagueLandscapeWidget({ size, standings, transactions, rankedTeams, sleeperUserId, currentLeague, playersData, setActiveTab, getOwnerName, getPlayerName, timeAgo, navigateWidget }) {
        const theme = window.WrTheme?.get?.() || {};
        const colors = theme.colors || {};
        const fonts = theme.fonts || {};
        const cardStyle = window.WrTheme?.cardStyle?.() || {};
        const fs = (rem) => window.WrTheme?.fontSize?.(rem) || (rem + 'rem');
        // Free/Pro (fail-open): standings/activity/health numbers stay free;
        // the ELITE/…/REBUILDING tier verdicts + posture-target reads are Pro.
        const pro = typeof window.wrIsPro !== 'function' || window.wrIsPro();

        // GM Strategy is the single source of truth — frame the field by posture.
        const gm = window.WR.GmMode.useGmEffects(currentLeague);
        const posture = gm?.marketPosture || 'hold';
        // buy_low → surface sellers/rebuilders (buy-FROM targets, low tiers);
        // sell_high → surface buyers/contenders (sell-TO targets, high tiers).
        // Pro-only: it flags specific rivals as deal targets via tier reads.
        const postureFrame = React.useMemo(() => {
            if (!pro || !gm?.hasStrategy) return null;
            if (posture === 'buy_low') return {
                label: 'BUY-FROM TARGETS',
                hint: 'Rebuilders to pry talent from',
                accent: colors.positive || 'var(--win-green)',
                tiers: new Set(['REBUILDING', 'CROSSROADS']),
            };
            if (posture === 'sell_high') return {
                label: 'SELL-TO TARGETS',
                hint: 'Contenders shopping for the stretch',
                accent: colors.accent || 'var(--gold)',
                tiers: new Set(['ELITE', 'CONTENDER']),
            };
            return null;
        }, [pro, gm?.hasStrategy, posture, colors.positive, colors.accent]);

        function postureBadge() {
            if (!postureFrame) return null;
            return <span title={postureFrame.hint} style={{ fontSize: fs(0.52), padding: '1px 6px', borderRadius: 3, background: wrAlpha(postureFrame.accent, '18'), color: postureFrame.accent, border: '1px solid ' + wrAlpha(postureFrame.accent, '33'), fontWeight: 700, fontFamily: fonts.ui, letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{postureFrame.label}</span>;
        }

        const allAssess = React.useMemo(() => {
            if (typeof window.assessAllTeamsFromGlobal === 'function') return window.assessAllTeamsFromGlobal() || [];
            return [];
        }, []);

        const powerRanked = React.useMemo(() => {
            return [...allAssess].sort((a, b) => (b.healthScore || 0) - (a.healthScore || 0));
        }, [allAssess]);

        const currentRoster = (currentLeague?.rosters || []).find(r => String(r.owner_id) === String(sleeperUserId));
        const rosterState = window.App?.getRosterDataState?.({ roster: currentRoster, currentLeague, rosters: currentLeague?.rosters }) || { isUsable: true };
        const total = powerRanked.length || 0;
        const myRank = powerRanked.findIndex(a => a.rosterId && (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId)?.owner_id === sleeperUserId) + 1;
        // Exclude DHQ-merged historical trades (_fromDHQ) — the feed shouldn't
        // count prior-season history as league activity.
        const txnCount = Array.isArray(transactions) ? transactions.filter(t => !t?._fromDHQ).length : 0;

        // Tier color helper
        const tierCol = (t) => t === 'ELITE' ? colors.positive : t === 'CONTENDER' ? colors.accent : t === 'CROSSROADS' ? colors.warn : colors.negative;

        // Click handler for sm/md
        const isClickable = size === 'sm' || size === 'md';
        const openAnalytics = (e) => {
            e?.stopPropagation?.();
            if (navigateWidget) navigateWidget('analytics');
            else if (setActiveTab) setActiveTab('analytics');
        };
        const onClick = () => { if (isClickable) openAnalytics(); };
        function analyticsButton() {
            return <button onClick={openAnalytics} title="Open League Analytics" style={{ padding: '3px 8px', minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: colors.accent || 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: '5px', cursor: 'pointer', fontSize: fs(0.56), fontFamily: fonts.ui, fontWeight: 700, whiteSpace: 'nowrap' }}>Analytics</button>;
        }

        // Tier distribution
        const tierDist = React.useMemo(() => {
            const dist = { ELITE: 0, CONTENDER: 0, CROSSROADS: 0, REBUILDING: 0 };
            powerRanked.forEach(a => { if (dist[a.tier] !== undefined) dist[a.tier]++; });
            return dist;
        }, [powerRanked]);

        if (!rosterState.isUsable) {
            return window.App?.renderRosterDataBlocker?.(rosterState, {
                title: size === 'sm' ? 'Rank paused' : 'League Landscape paused',
                message: 'Power ranks need complete roster IDs.',
                detail: rosterState.detail,
                compact: size === 'sm' || size === 'md',
                fill: true,
                actionLabel: size === 'sm' ? null : 'Open Analytics',
                onAction: openAnalytics,
                style: { cursor: isClickable ? 'pointer' : 'default' },
            });
        }

        // ── SM: rank-with-label hero + activity count ──
        if (size === 'sm') {
            const rankCol = myRank <= 3 ? colors.positive : myRank <= Math.ceil(total / 2) ? colors.accent : colors.negative;
            return (
                <div onClick={onClick} style={{
                    ...cardStyle, padding: 'var(--card-pad, 14px 16px)', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '4px',
                }}>
                    <div style={{
                        fontSize: fs(0.6), color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.1em',
                        fontWeight: 700, fontFamily: fonts.ui,
                    }}>POWER RANK</div>
                    <div style={{
                        fontFamily: fonts.mono, fontSize: fs(2.0), fontWeight: 700,
                        color: rankCol, lineHeight: 1,
                    }} className="wr-data-value">
                        #{myRank || '—'}<span style={{ fontSize: fs(0.85), color: colors.textFaint }}> / {total}</span>
                    </div>
                    <div style={{
                        fontSize: fs(0.62), color: colors.textMuted, fontFamily: fonts.ui,
                        borderTop: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'),
                        paddingTop: '4px', marginTop: '2px', width: '100%',
                    }}>
                        <span style={{ fontWeight: 700, color: colors.text }}>{txnCount}</span> league moves this season
                    </div>
                    {postureFrame && (
                        <div style={{ fontSize: fs(0.54), color: postureFrame.accent, fontFamily: fonts.ui, fontWeight: 700, letterSpacing: '0.04em' }}>
                            {postureFrame.label}
                        </div>
                    )}
                </div>
            );
        }

        // ── MD: top 5 power rankings with health bars ──
        if (size === 'md') {
            const top5 = powerRanked.slice(0, 5);
            const maxH = Math.max(...top5.map(a => a.healthScore || 0), 1);
            return (
                <div onClick={onClick} style={{ ...cardStyle, padding: 'var(--card-pad, 12px 14px)', cursor: 'pointer', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.95rem' }}>🌐</span>
                        <span style={{ fontFamily: fonts.display, fontSize: fs(0.85), fontWeight: 700, color: colors.accent, letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1 }}>Top of the League</span>
                        <span style={{ fontSize: fs(0.6), color: colors.textMuted, fontFamily: fonts.ui }}>You: #{myRank || '—'}</span>
                    </div>
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {top5.map((a, i) => {
                            const isMe = a.rosterId && (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId)?.owner_id === sleeperUserId;
                            const name = getOwnerName ? getOwnerName(a.rosterId) : ('Team ' + (i + 1));
                            const pct = ((a.healthScore || 0) / maxH) * 100;
                            // tier colors encode the verdict — neutral for free
                            const tc = pro ? tierCol(a.tier) : (colors.textMuted || 'var(--silver)');
                            return (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: fs(0.7), color: i < 3 ? colors.accent : colors.textMuted, fontWeight: 700, width: 14, textAlign: 'right', fontFamily: fonts.mono }}>{i + 1}</span>
                                    <div style={{ flex: 1, minWidth: 0, position: 'relative', height: 16, borderRadius: theme.card?.radius === '0px' ? '0' : '3px', overflow: 'hidden', background: 'var(--ov-3, rgba(255,255,255,0.04))' }}>
                                        <div style={{ width: pct + '%', height: '100%', background: isMe ? colors.accent : tc, opacity: isMe ? 1 : 0.3, borderRadius: 'inherit' }} />
                                        <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', fontSize: fs(0.62), fontWeight: isMe ? 800 : 600, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%', fontFamily: fonts.ui }}>{isMe ? '★ ' : ''}{(name || '').slice(0, 16)}</span>
                                    </div>
                                    <span style={{ fontSize: fs(0.6), fontWeight: 700, color: tc, minWidth: 22, textAlign: 'right', fontFamily: fonts.mono }}>{a.healthScore || 0}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // ── Recent activity helper ──
        const recentTx = (limit) => {
            if (!Array.isArray(transactions)) return [];
            return transactions.slice(0, limit);
        };

        function renderTxnRow(tx, key) {
            const type = tx.type || 'move';
            const typeCol = type === 'trade' ? (colors.purple || 'var(--k-7c6bf8, #7c6bf8)') : type === 'waiver' ? (colors.info || 'var(--k-00c8b4, #00c8b4)') : colors.positive;
            let desc = tx.description || tx.type || '—';
            if (type === 'trade' && (tx.adds || tx.drops)) {
                // Sleeper trades carry every traded player in both adds{} and
                // drops{} — group by the acquiring roster (adds[pid] → rosterId)
                // so a 2-for-2 doesn't render 'A, B for A, B'.
                const byRoster = {};
                Object.entries(tx.adds || {}).forEach(([pid, rid]) => {
                    (byRoster[rid] = byRoster[rid] || []).push(playersData?.[pid]?.full_name || pid);
                });
                const sides = Object.values(byRoster);
                if (sides.length >= 2) {
                    desc = sides[0].slice(0, 2).join(', ') + ' for ' + sides[1].slice(0, 2).join(', ');
                } else {
                    const nPlayers = Object.keys(tx.adds || {}).length;
                    const nPicks = (tx.draft_picks || []).length;
                    const what = [
                        nPlayers ? nPlayers + ' player' + (nPlayers === 1 ? '' : 's') : null,
                        nPicks ? nPicks + ' pick' + (nPicks === 1 ? '' : 's') : null,
                    ].filter(Boolean).join(' + ') || 'assets';
                    const teams = (tx.roster_ids || []).map(rid => getOwnerName ? getOwnerName(rid) : ('Team ' + rid)).filter(Boolean);
                    desc = 'Trade: ' + what + (teams.length >= 2 ? ' between ' + teams[0] + ' & ' + teams[1] : '');
                }
            } else if (tx.adds || tx.drops) {
                const addNames = Object.keys(tx.adds || {}).map(pid => playersData?.[pid]?.full_name || pid).slice(0, 2);
                const dropNames = Object.keys(tx.drops || {}).map(pid => playersData?.[pid]?.full_name || pid).slice(0, 2);
                if (addNames.length && dropNames.length) desc = 'Added ' + addNames.join(', ') + ', dropped ' + dropNames.join(', ');
                else if (addNames.length) desc = 'Added ' + addNames.join(', ');
                else if (dropNames.length) desc = 'Dropped ' + dropNames.join(', ');
            }
            return (
                <div key={key} style={{ display: 'flex', gap: '6px', padding: '3px 0', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))', fontSize: fs(0.66), fontFamily: fonts.ui, alignItems: 'center' }}>
                    <span style={{ fontSize: fs(0.54), padding: '1px 5px', borderRadius: 3, background: wrAlpha(typeCol, '18'), color: typeCol, fontWeight: 700 }}>{(type === 'free_agent' ? 'FA' : type).toUpperCase()}</span>
                    <span style={{ flex: 1, color: colors.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</span>
                    {(tx.status_updated || tx.created) && <span style={{ fontSize: fs(0.54), color: colors.textFaint }}>{timeAgo ? timeAgo(tx.status_updated || tx.created) : ''}</span>}
                </div>
            );
        }

        // ── Standings table renderer ──
        function renderStandings(rows, opts = {}) {
            const compact = !!opts.compact;
            const showCols = opts.cols || 'all'; // 'all' | 'minimal'
            return (
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0 4px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                        <span style={{ width: 14 }} />
                        <span style={{ flex: 1, fontSize: fs(0.54), color: colors.textFaint, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: fonts.ui }}>Owner</span>
                        {showCols === 'all' && pro && <span style={{ fontSize: fs(0.54), color: colors.textFaint, textTransform: 'uppercase', fontFamily: fonts.ui, minWidth: 32, textAlign: 'right' }}>Tier</span>}
                        {showCols === 'all' && <span style={{ fontSize: fs(0.54), color: colors.textFaint, textTransform: 'uppercase', fontFamily: fonts.ui, minWidth: 28, textAlign: 'right' }}>DHQ</span>}
                        <span style={{ fontSize: fs(0.54), color: colors.textFaint, textTransform: 'uppercase', fontFamily: fonts.ui, minWidth: 22, textAlign: 'right' }}>HP</span>
                    </div>
                    {rows.map((a, i) => {
                        const isMe = a.rosterId && (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId)?.owner_id === sleeperUserId;
                        const name = getOwnerName ? getOwnerName(a.rosterId) : ('Team ' + (i + 1));
                        const tc = tierCol(a.tier);
                        const scores = window.App?.LI?.playerScores || {};
                        const roster = (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId);
                        const rosterDHQ = roster ? (roster.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0) : 0;
                        // Posture-driven target: rival in the posture's tier band (not me).
                        const isTarget = !isMe && postureFrame && postureFrame.tiers.has(a.tier);
                        return (
                            <div key={i} title={isTarget ? postureFrame.label + ' · ' + postureFrame.hint : undefined} style={{
                                display: 'flex', alignItems: 'center', gap: '6px', padding: compact ? '2px 0' : '3px 0',
                                borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))',
                                background: isMe ? 'var(--acc-fill1, rgba(212,175,55,0.04))' : (isTarget ? wrAlpha(postureFrame.accent, '0a') : 'transparent'),
                                boxShadow: isTarget ? ('inset 2px 0 0 ' + postureFrame.accent) : 'none',
                            }}>
                                <span style={{ fontSize: fs(0.62), color: i < 3 ? colors.accent : colors.textMuted, fontWeight: 700, width: 14, textAlign: 'right', fontFamily: fonts.mono }}>{i + 1}</span>
                                <span style={{ flex: 1, fontSize: fs(0.66), fontWeight: isMe ? 700 : 500, color: isMe ? colors.accent : colors.text, fontFamily: fonts.ui, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {isMe ? '★ ' : ''}{(name || '').slice(0, 18)}
                                </span>
                                {showCols === 'all' && pro && <span style={{ fontSize: fs(0.54), padding: '1px 4px', borderRadius: 3, background: wrAlpha(tc, '18'), color: tc, fontWeight: 700, minWidth: 32, textAlign: 'center' }}>{(a.tier || '—').slice(0, 4)}</span>}
                                {showCols === 'all' && <span style={{ fontSize: fs(0.54), color: colors.textMuted, minWidth: 28, textAlign: 'right', fontFamily: fonts.mono }}>{rosterDHQ >= 1000 ? Math.round(rosterDHQ / 1000) + 'k' : rosterDHQ}</span>}
                                <span style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.textMuted, minWidth: 22, textAlign: 'right', fontFamily: fonts.mono }}>{a.healthScore || 0}</span>
                            </div>
                        );
                    })}
                </div>
            );
        }

        // ── Tier distribution strip (tier verdicts → Pro only) ──
        function renderTierStrip() {
            if (!pro) return null;
            return (
                <div style={{
                    display: 'flex', gap: '8px', padding: '6px 8px',
                    background: 'var(--ov-1, rgba(255,255,255,0.02))',
                    border: '1px solid ' + (colors.border || 'var(--ov-4, rgba(255,255,255,0.06))'),
                    borderRadius: theme.card?.radius === '0px' ? '0' : '6px',
                    flexWrap: 'wrap',
                }}>
                    {Object.entries(tierDist).filter(([, n]) => n > 0).map(([t, n]) => (
                        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <div style={{ width: 6, height: 6, borderRadius: 3, background: tierCol(t) }} />
                            <span style={{ fontSize: fs(0.6), fontWeight: 700, color: tierCol(t), fontFamily: fonts.ui }}>{n}</span>
                            <span style={{ fontSize: fs(0.56), color: colors.textFaint, fontFamily: fonts.ui }}>{t.slice(0, 5)}</span>
                        </div>
                    ))}
                </div>
            );
        }

        // ── LG: standings (top 8) + tier strip + 2 recent ──
        if (size === 'lg') {
            const top8 = powerRanked.slice(0, 8);
            const tx = recentTx(2);
            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 12px 14px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexShrink: 0 }}>
                        <span style={{ fontSize: '1rem' }}>🌐</span>
                        <span style={{ fontFamily: fonts.display, fontSize: fs(0.95), fontWeight: 700, color: colors.accent, letterSpacing: '0.07em', textTransform: 'uppercase', flex: 1 }}>League Landscape</span>
                        {postureBadge()}
                        <span style={{ fontSize: fs(0.62), color: colors.textMuted, fontFamily: fonts.ui }}>{txnCount} moves</span>
                        {analyticsButton()}
                    </div>
                    {pro && <div style={{ marginBottom: '6px', flexShrink: 0 }}>{renderTierStrip()}</div>}
                    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        {renderStandings(top8, { compact: true, cols: 'all' })}
                    </div>
                </div>
            );
        }

        // ── TALL: standings (12) + tier strip + activity feed + biggest movers ──
        if (size === 'tall') {
            const top12 = powerRanked.slice(0, 12);
            const tx = recentTx(5);
            const movers = computeMovers(transactions, currentLeague, getOwnerName);

            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '1.1rem' }}>🌐</span>
                        <span style={{ fontFamily: fonts.display, fontSize: fs(1.0), fontWeight: 700, color: colors.accent, letterSpacing: '0.07em', textTransform: 'uppercase', flex: 1 }}>League Landscape</span>
                        {postureBadge()}
                        <span style={{ fontSize: fs(0.66), color: colors.textMuted, fontFamily: fonts.ui }}>{txnCount} moves</span>
                        {analyticsButton()}
                    </div>
                    {pro && <div style={{ marginBottom: '8px', flexShrink: 0 }}>{renderTierStrip()}</div>}
                    <div style={{ marginBottom: '10px' }}>{renderStandings(top12, { compact: true, cols: 'all' })}</div>
                    {movers.length > 0 && (
                        <div style={{ marginBottom: '8px' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Biggest Movers</div>
                            {movers.slice(0, 3).map((m, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontSize: fs(0.66), fontFamily: fonts.ui }}>
                                    <span style={{ flex: 1, color: colors.text }}>{(m.name || '').slice(0, 18)}</span>
                                    <span style={{ fontSize: fs(0.56), color: colors.textMuted }}>{m.count} moves</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {tx.length > 0 && (
                        <div>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Recent Activity</div>
                            {tx.map((t, i) => renderTxnRow(t, i))}
                        </div>
                    )}
                </div>
            );
        }

        // ── XL: 2-col split — standings (left) + activity feed (right) ──
        if (size === 'xl') {
            const top12 = powerRanked.slice(0, 12);
            const tx = recentTx(8);
            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 12px 14px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '1rem' }}>🌐</span>
                        <span style={{ fontFamily: fonts.display, fontSize: fs(0.95), fontWeight: 700, color: colors.accent, letterSpacing: '0.07em', textTransform: 'uppercase', flex: 1 }}>League Landscape</span>
                        {postureBadge()}
                        <span style={{ fontSize: fs(0.62), color: colors.textMuted, fontFamily: fonts.ui }}>{txnCount} moves · You #{myRank || '—'}</span>
                        {analyticsButton()}
                    </div>
                    {pro && <div style={{ marginBottom: '8px', flexShrink: 0 }}>{renderTierStrip()}</div>}
                    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: '14px', overflow: 'hidden' }}>
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px' }}>
                                <span style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: fonts.ui }}>Power Standings</span>
                                {postureFrame && <span style={{ fontSize: fs(0.52), color: postureFrame.accent, fontFamily: fonts.ui, fontWeight: 600 }}>· {postureFrame.hint}</span>}
                            </div>
                            {renderStandings(top12, { compact: true, cols: 'all' })}
                        </div>
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Recent Activity</div>
                            {tx.length === 0 ? <div style={{ fontSize: fs(0.6), color: colors.textFaint, fontStyle: 'italic' }}>No recent moves.</div> : tx.map((t, i) => renderTxnRow(t, i))}
                        </div>
                    </div>
                </div>
            );
        }

        // ── XXL: full standings + activity + tier dist + position-of-power chart ──
        if (size === 'xxl') {
            const all = powerRanked;
            const tx = recentTx(12);
            const movers = computeMovers(transactions, currentLeague, getOwnerName);
            // Top owner DHQ comparison
            const scores = window.App?.LI?.playerScores || {};
            const ownerData = all.map(a => {
                const roster = (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId);
                const dhq = roster ? (roster.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0) : 0;
                const isMe = roster?.owner_id === sleeperUserId;
                return { name: getOwnerName ? getOwnerName(a.rosterId) : 'Team', dhq, healthScore: a.healthScore || 0, tier: a.tier, isMe };
            });
            const maxDHQ = Math.max(...ownerData.map(o => o.dhq), 1);

            return (
                <div style={{ ...cardStyle, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '1.1rem' }}>🌐</span>
                        <span style={{ fontFamily: fonts.display, fontSize: fs(1.05), fontWeight: 700, color: colors.accent, letterSpacing: '0.07em', textTransform: 'uppercase', flex: 1 }}>League Landscape</span>
                        {postureBadge()}
                        <span style={{ fontSize: fs(0.66), color: colors.textMuted, fontFamily: fonts.ui }}>{txnCount} moves · You #{myRank || '—'} of {total}</span>
                        {analyticsButton()}
                    </div>
                    {pro && <div style={{ marginBottom: '10px', flexShrink: 0 }}>{renderTierStrip()}</div>}
                    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '16px', overflow: 'hidden' }}>
                        {/* Left col: full standings + dhq chart */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, minHeight: 0 }}>
                            <div style={{ minHeight: 0, overflow: 'hidden' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px' }}>
                                    <span style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: fonts.ui }}>Power Standings</span>
                                    {postureFrame && <span style={{ fontSize: fs(0.54), color: postureFrame.accent, fontFamily: fonts.ui, fontWeight: 600 }}>· {postureFrame.hint}</span>}
                                </div>
                                {renderStandings(all, { compact: true, cols: 'all' })}
                            </div>
                            <div style={{ flexShrink: 0 }}>
                                <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>DHQ Distribution</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    {ownerData.map((o, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ flex: 1, fontSize: fs(0.54), color: o.isMe ? colors.accent : colors.textMuted, fontWeight: o.isMe ? 700 : 500, fontFamily: fonts.ui, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(o.name || '').slice(0, 12)}</span>
                                            <div style={{ width: 80, height: 6, background: 'var(--ov-3, rgba(255,255,255,0.04))', borderRadius: 2, overflow: 'hidden' }}>
                                                <div style={{ width: ((o.dhq / maxDHQ) * 100) + '%', height: '100%', background: pro ? tierCol(o.tier) : (colors.textMuted || 'var(--silver)'), opacity: o.isMe ? 1 : 0.6 }} />
                                            </div>
                                            <span style={{ fontSize: fs(0.5), color: colors.textFaint, fontFamily: fonts.mono, minWidth: 28, textAlign: 'right' }}>{o.dhq >= 1000 ? Math.round(o.dhq / 1000) + 'k' : o.dhq}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {/* Right col: activity feed + biggest movers */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, minHeight: 0 }}>
                            {movers.length > 0 && (
                                <div style={{ flexShrink: 0 }}>
                                    <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Most Active Owners</div>
                                    {movers.slice(0, 5).map((m, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontSize: fs(0.66), fontFamily: fonts.ui }}>
                                            <span style={{ fontSize: fs(0.56), color: colors.textFaint, width: 12, fontFamily: fonts.mono }}>{i + 1}</span>
                                            <span style={{ flex: 1, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(m.name || '').slice(0, 18)}</span>
                                            <span style={{ fontSize: fs(0.56), fontWeight: 700, color: colors.accent }}>{m.count}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                                <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Recent Activity</div>
                                {tx.length === 0 ? <div style={{ fontSize: fs(0.6), color: colors.textFaint, fontStyle: 'italic' }}>No recent moves.</div> : tx.map((t, i) => renderTxnRow(t, i))}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    }

    // ── Compute biggest-mover owners by transaction count ─────────
    function computeMovers(transactions, currentLeague, getOwnerName) {
        if (!Array.isArray(transactions) || !transactions.length) return [];
        const counts = {};
        transactions.forEach(tx => {
            (tx.roster_ids || []).forEach(rid => {
                if (!rid) return;
                counts[rid] = (counts[rid] || 0) + 1;
            });
        });
        return Object.entries(counts)
            .map(([rid, count]) => ({ rid, count, name: getOwnerName ? getOwnerName(parseInt(rid)) : ('Team ' + rid) }))
            .sort((a, b) => b.count - a.count);
    }

    window.LeagueLandscapeWidget = LeagueLandscapeWidget;
})();
