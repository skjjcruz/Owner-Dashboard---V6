// ══════════════════════════════════════════════════════════════════
// js/widgets/competitive-tiers.js — Competitive Tiers widget (v2)
//
// Groups every team into ELITE / CONTENDER / CROSSROADS / REBUILDING.
//
// sm: my tier + count (kept)
// md: tier-count bar with my position arrow under my tier
// lg: 4 stacked tier rows with team avatars + name + health
// tall: lg + tier health histogram + transition movers
// xxl: full breakdown — tiers + position-of-power matrix + recent climbers
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const TIER_ORDER = ['ELITE', 'CONTENDER', 'CROSSROADS', 'REBUILDING'];
    const TIER_COLORS = {
        ELITE: 'var(--k-d4af37, #d4af37)',
        CONTENDER: 'var(--k-2ecc71, #2ecc71)',
        CROSSROADS: 'var(--k-f0a500, #f0a500)',
        REBUILDING: 'var(--k-e74c3c, #e74c3c)',
    };

    function groupByTier(assessments) {
        const buckets = { ELITE: [], CONTENDER: [], CROSSROADS: [], REBUILDING: [] };
        (assessments || []).forEach(a => { if (buckets[a.tier]) buckets[a.tier].push(a); });
        TIER_ORDER.forEach(t => buckets[t].sort((a, b) => (b.healthScore || 0) - (a.healthScore || 0)));
        return buckets;
    }

    function avatarUrl(id) { return id ? 'https://sleepercdn.com/avatars/thumbs/' + id : null; }

    function findUser(rosterId, currentLeague) {
        const roster = (currentLeague?.rosters || []).find(r => r.roster_id === rosterId);
        if (!roster) return null;
        const users = currentLeague?.users || window.S?.leagueUsers || [];
        return users.find(u => u.user_id === roster.owner_id) || null;
    }

    // GM Strategy is the source of truth for the YOUR-team buyer/seller framing.
    // win_now / 1_year horizon → buyer (acquire now); rebuild / dynasty_long →
    // seller (accumulate future); everything else holds steady.
    function gmPosture(gm) {
        const mode = gm?.mode;
        const tl = gm?.timeline;
        if (mode === 'win_now' || tl === '1_year') {
            return { label: 'BUYER', sub: 'Acquire now', col: 'var(--win-green, var(--k-2ecc71, #2ecc71))' };
        }
        if (mode === 'rebuild' || tl === 'dynasty_long') {
            return { label: 'SELLER', sub: 'Accumulate', col: 'var(--gold, var(--k-d4af37, #d4af37))' };
        }
        return { label: 'BALANCED', sub: 'Hold value', col: 'var(--silver)' };
    }

    function CompetitiveTiersWidget({ size, sleeperUserId, currentLeague, playersData, setActiveTab, navigateWidget }) {
        const gm = window.WR.GmMode.useGmEffects(currentLeague);

        const assessments = React.useMemo(() => {
            if (typeof window.assessAllTeamsFromGlobal === 'function') {
                try { return window.assessAllTeamsFromGlobal() || []; } catch { return []; }
            }
            return [];
        }, []);

        const tiers = React.useMemo(() => groupByTier(assessments), [assessments]);
        const mine = assessments.find(a => a.ownerId === sleeperUserId);
        const myTier = mine?.tier || null;

        // Primary YOUR-team framing = GM Strategy posture; tier is secondary.
        const posture = React.useMemo(() => (gm?.hasStrategy ? gmPosture(gm) : null), [gm?.mode, gm?.timeline, gm?.hasStrategy]);

        const base = {
            background: 'var(--off-black)',
            border: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))',
            borderRadius: '10px', padding: 'var(--card-pad, 14px 16px)',
            display: 'flex', flexDirection: 'column', gap: '8px',
            height: '100%', minHeight: 0, overflow: 'hidden',
        };
        function jumpToLeague(e) {
            e?.stopPropagation?.();
            if (navigateWidget) navigateWidget('analytics');
            else if (setActiveTab) setActiveTab('analytics');
        }
        function analyticsButton() {
            return React.createElement('button', {
                onClick: jumpToLeague,
                title: 'Open League Analytics',
                style: {
                    padding: '3px 8px',
                    background: 'var(--acc-fill2, rgba(212,175,55,0.08))',
                    color: 'var(--gold)',
                    border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: 'var(--text-micro, 0.6875rem)',
                    fontFamily: 'var(--font-body)',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    minHeight: '44px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }
            }, 'Analytics');
        }

        if (!assessments.length) {
            return React.createElement('div', { style: { ...base, alignItems: 'center', justifyContent: 'center' } },
                React.createElement('div', { style: { fontSize: '0.8rem', color: 'var(--silver)', opacity: 0.55 } }, 'League intelligence loading…')
            );
        }

        // ── sm: my tier hero (kept) ──────────────────────────────
        if (size === 'sm') {
            const col = posture ? posture.col : (mine ? TIER_COLORS[mine.tier] : 'var(--silver)');
            return React.createElement('div', { style: { ...base, cursor: 'pointer', textAlign: 'center', justifyContent: 'center' }, onClick: jumpToLeague },
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.65 } }, posture ? 'My Stance' : 'My Tier'),
                React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.25rem', fontWeight: 700, color: col } }, posture ? posture.label : (mine?.tier || '—')),
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.55 } }, posture ? (myTier ? myTier.charAt(0) + myTier.slice(1).toLowerCase() + ' · ' + posture.sub : posture.sub) : (assessments.length + ' team' + (assessments.length === 1 ? '' : 's') + ' tracked'))
            );
        }

        // ── md: tier-count bar with arrow under my tier ──────────
        if (size === 'md') {
            const total = assessments.length || 1;
            // Build segments + compute arrow position (center of my tier segment)
            let cumPct = 0;
            const segments = TIER_ORDER.map(t => {
                const n = tiers[t].length;
                const pct = (n / total) * 100;
                const seg = { tier: t, n, pct, start: cumPct };
                cumPct += pct;
                return seg;
            }).filter(s => s.n > 0);
            const mySeg = segments.find(s => s.tier === myTier);
            const arrowLeft = mySeg ? (mySeg.start + mySeg.pct / 2) : 0;
            const myCol = myTier ? TIER_COLORS[myTier] : 'var(--silver)';

            return React.createElement('div', { style: base, onClick: jumpToLeague },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    React.createElement('span', { style: { fontSize: '0.9rem' } }, '🏆'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.88rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em' } }, 'Competitive Tiers'),
                    posture
                        ? React.createElement('div', {
                            title: 'GM Strategy: ' + (gm.modeLabel || gm.mode) + ' · ' + posture.sub,
                            style: { marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', color: posture.col, fontWeight: 700, padding: '2px 6px', borderRadius: '3px', background: wrAlpha(posture.col, '22'), border: '1px solid ' + wrAlpha(posture.col, '55') }
                        }, 'YOU · ' + posture.label + (myTier ? ' · ' + myTier.slice(0, 4) : ''))
                        : React.createElement('div', {
                            style: { marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', color: myCol, fontWeight: 700, padding: '2px 6px', borderRadius: '3px', background: wrAlpha(myCol, '22'), border: '1px solid ' + wrAlpha(myCol, '55') }
                        }, myTier ? 'YOU · ' + myTier : 'YOU · —'),
                ),
                // Tier bar with my position arrow
                React.createElement('div', { style: { position: 'relative', marginTop: '4px' } },
                    React.createElement('div', { style: { display: 'flex', height: '20px', borderRadius: '4px', overflow: 'hidden', gap: '1px' } },
                        ...segments.map(s => React.createElement('div', {
                            key: s.tier,
                            title: s.tier + ': ' + s.n,
                            style: {
                                width: s.pct + '%',
                                background: TIER_COLORS[s.tier],
                                opacity: s.tier === myTier ? 1 : 0.7,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--k-0a0a0a, #0a0a0a)', fontWeight: 800,
                                outline: s.tier === myTier ? '2px solid var(--k-ffffff, #ffffff)' : 'none',
                                outlineOffset: '-2px',
                            }
                        }, s.n))
                    ),
                    // Arrow under my segment
                    mySeg && React.createElement('div', {
                        style: {
                            position: 'absolute', left: arrowLeft + '%', top: '22px', transform: 'translateX(-50%)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                        }
                    },
                        React.createElement('div', { style: { width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '6px solid ' + myCol } }),
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: myCol, marginTop: '1px', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)' } }, '★ YOU'),
                    ),
                ),
                React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: 'var(--text-micro, 0.6875rem)', marginTop: '20px' } },
                    ...TIER_ORDER.map(t => React.createElement('span', {
                        key: t,
                        style: { display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--silver)' }
                    },
                        React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: TIER_COLORS[t] } }),
                        t.charAt(0) + t.slice(1).toLowerCase()
                    ))
                )
            );
        }

        // ── Reusable tier row (lg/tall/xxl) with avatars ─────────
        function renderTierRow(t, opts = {}) {
            const teams = tiers[t];
            const col = TIER_COLORS[t];
            const showLogos = opts.showLogos !== false;
            const limit = opts.limit ?? 6;

            return React.createElement('div', {
                key: t,
                style: {
                    padding: '6px 10px', borderRadius: '6px',
                    background: 'var(--ov-1, rgba(255,255,255,0.02))',
                    borderLeft: '3px solid ' + col,
                }
            },
                React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px' } },
                    React.createElement('span', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.78rem', fontWeight: 700, color: col, letterSpacing: '0.05em' } }, t),
                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.55 } }, teams.length + ' team' + (teams.length === 1 ? '' : 's')),
                    teams.length > 0 && React.createElement('span', { style: { marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 } },
                        'avg ' + Math.round(teams.reduce((s, t) => s + (t.healthScore || 0), 0) / teams.length)
                    ),
                ),
                teams.length === 0
                    ? React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.45, fontStyle: 'italic' } }, '—')
                    : React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } },
                        ...teams.slice(0, limit).map(team => {
                            const isMe = team.ownerId === sleeperUserId;
                            const user = findUser(team.rosterId, currentLeague);
                            const av = avatarUrl(user?.avatar);
                            return React.createElement('span', {
                                key: team.rosterId,
                                style: {
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    padding: '2px 6px 2px 2px', borderRadius: '12px',
                                    fontSize: 'var(--text-micro, 0.6875rem)',
                                    background: isMe ? wrAlpha(col, '33') : 'var(--ov-3, rgba(255,255,255,0.04))',
                                    color: isMe ? col : 'var(--white)',
                                    fontWeight: isMe ? 700 : 500,
                                    border: isMe ? '1px solid ' + wrAlpha(col, '88') : '1px solid transparent',
                                    fontFamily: 'var(--font-body)',
                                }
                            },
                                showLogos && av
                                    ? React.createElement('img', { src: av, style: { width: 14, height: 14, borderRadius: '50%' }, alt: '' })
                                    : React.createElement('div', { style: { width: 14, height: 14, borderRadius: '50%', background: wrAlpha(col, '33'), flexShrink: 0 } }),
                                React.createElement('span', null, (team.ownerName || '').slice(0, 12) + (isMe ? ' ★' : '')),
                                React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-micro, 0.6875rem)', color: isMe ? col : 'var(--silver)', opacity: 0.8 } }, team.healthScore || 0),
                            );
                        }),
                        teams.length > limit ? React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.5, padding: '2px 4px' } }, '+' + (teams.length - limit)) : null,
                    ),
            );
        }

        // ── lg: 4 stacked rows with avatars (top 4-5 each) ────────
        if (size === 'lg') {
            return React.createElement('div', { style: base },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    React.createElement('span', { style: { fontSize: '0.95rem' } }, '🏆'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.88rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em' } }, 'Competitive Tiers'),
                    posture
                        ? React.createElement('span', { title: 'GM Strategy: ' + (gm.modeLabel || gm.mode) + ' · ' + posture.sub, style: { marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: posture.col, padding: '2px 6px', borderRadius: '3px', background: wrAlpha(posture.col, '22'), border: '1px solid ' + wrAlpha(posture.col, '55') } }, '★ YOU · ' + posture.label + (myTier ? ' · ' + myTier.slice(0, 4) : ''))
                        : (myTier && React.createElement('span', { style: { marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: TIER_COLORS[myTier], padding: '2px 6px', borderRadius: '3px', background: wrAlpha(TIER_COLORS[myTier], '22') } }, '★ ' + myTier)),
                    analyticsButton(),
                ),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minHeight: 0, overflow: 'hidden' } },
                    ...TIER_ORDER.map(t => renderTierRow(t, { limit: 5, showLogos: true })),
                ),
            );
        }

        // ── Closest competitors helper (used in tall + xxl) ────────
        // Returns the N teams immediately above the user + N below in power ranking
        function getClosestCompetitors(n) {
            const ranked = [...assessments].sort((a, b) => (b.healthScore || 0) - (a.healthScore || 0));
            const myIdx = ranked.findIndex(a => a.ownerId === sleeperUserId);
            if (myIdx === -1) return { above: [], below: [], myRank: null };
            const myRank = myIdx + 1;
            const above = ranked.slice(Math.max(0, myIdx - n), myIdx).map((a, i) => ({ ...a, rank: myIdx - n + i + 1 }));
            const below = ranked.slice(myIdx + 1, myIdx + 1 + n).map((a, i) => ({ ...a, rank: myIdx + 2 + i }));
            return { above, below, myRank, myHealth: ranked[myIdx].healthScore || 0 };
        }

        function renderCompetitorRow(team, i, opts = {}) {
            const myHealth = opts.myHealth || 0;
            const delta = (team.healthScore || 0) - myHealth;
            const deltaCol = delta > 0 ? 'var(--k-e74c3c, #e74c3c)' : delta < 0 ? 'var(--k-2ecc71, #2ecc71)' : 'var(--silver)';
            const tierC = TIER_COLORS[team.tier] || 'var(--silver)';
            const user = findUser(team.rosterId, currentLeague);
            const av = avatarUrl(user?.avatar);
            return React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))' } },
                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontWeight: 700, width: 18, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' } }, '#' + team.rank),
                av
                    ? React.createElement('img', { src: av, style: { width: 16, height: 16, borderRadius: '50%' }, alt: '' })
                    : React.createElement('div', { style: { width: 16, height: 16, borderRadius: '50%', background: wrAlpha(tierC, '33') } }),
                React.createElement('span', { style: { flex: 1, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, color: 'var(--white)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, team.ownerName || ''),
                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 5px', borderRadius: 3, background: wrAlpha(tierC, '22'), color: tierC, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' } }, (team.tier || '—').slice(0, 4)),
                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--white)', fontFamily: 'JetBrains Mono, monospace', minWidth: 22, textAlign: 'right' } }, team.healthScore || 0),
                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: deltaCol, fontFamily: 'JetBrains Mono, monospace', minWidth: 28, textAlign: 'right' } }, delta > 0 ? '+' + delta : delta),
            );
        }

        // ── tall: lg + health histogram + transition list ────────
        if (size === 'tall') {
            // Health histogram: bucket health scores (0-20, 20-40, 40-60, 60-80, 80-100)
            const hist = [0, 0, 0, 0, 0];
            assessments.forEach(a => {
                const h = a.healthScore || 0;
                const bucket = Math.min(4, Math.floor(h / 20));
                hist[bucket]++;
            });
            const myBucket = mine ? Math.min(4, Math.floor((mine.healthScore || 0) / 20)) : -1;
            const maxBucket = Math.max(...hist, 1);
            const histLabels = ['0-20', '20-40', '40-60', '60-80', '80+'];

            // Top of food chain
            const topTeam = tiers.ELITE[0] || tiers.CONTENDER[0];
            const topUser = topTeam ? findUser(topTeam.rosterId, currentLeague) : null;

            return React.createElement('div', { style: base },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    React.createElement('span', { style: { fontSize: '1rem' } }, '🏆'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.95rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em' } }, 'Competitive Tiers'),
                    posture
                        ? React.createElement('span', { title: 'GM Strategy: ' + (gm.modeLabel || gm.mode) + ' · ' + posture.sub, style: { marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: posture.col, padding: '2px 6px', borderRadius: '3px', background: wrAlpha(posture.col, '22'), border: '1px solid ' + wrAlpha(posture.col, '55') } }, '★ YOU · ' + posture.label + (myTier ? ' · ' + myTier.slice(0, 4) : ''))
                        : (myTier && React.createElement('span', { style: { marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: TIER_COLORS[myTier], padding: '2px 6px', borderRadius: '3px', background: wrAlpha(TIER_COLORS[myTier], '22') } }, '★ ' + myTier)),
                    analyticsButton(),
                ),
                // Tier rows
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', flexShrink: 0 } },
                    ...TIER_ORDER.map(t => renderTierRow(t, { limit: 6, showLogos: true })),
                ),
                // Health histogram
                React.createElement('div', { style: { padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', borderRadius: '6px', flexShrink: 0 } },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' } }, 'Health Distribution'),
                    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '4px', height: 50 } },
                        ...hist.map((n, i) => {
                            const h = (n / maxBucket) * 40;
                            const col = i === 4 ? TIER_COLORS.ELITE : i === 3 ? TIER_COLORS.CONTENDER : i === 2 ? TIER_COLORS.CROSSROADS : TIER_COLORS.REBUILDING;
                            const isMine = i === myBucket;
                            return React.createElement('div', { key: i, style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' } },
                                React.createElement('div', { style: { fontSize: 'var(--text-micro)', color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace' } }, n),
                                React.createElement('div', { style: { width: '100%', height: h, background: col, opacity: isMine ? 1 : 0.5, borderRadius: '2px 2px 0 0', outline: isMine ? '1px solid var(--k-ffffff, #ffffff)' : 'none' } }),
                                React.createElement('div', { style: { fontSize: 'var(--text-micro)', color: isMine ? 'var(--k-ffffff, #ffffff)' : 'var(--silver)', opacity: isMine ? 1 : 0.6, fontWeight: isMine ? 700 : 400, fontFamily: 'JetBrains Mono, monospace' } }, histLabels[i]),
                            );
                        }),
                    ),
                ),
                // Top dog spotlight
                topTeam && React.createElement('div', { style: { padding: '8px 10px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '6px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' } },
                    topUser?.avatar
                        ? React.createElement('img', { src: avatarUrl(topUser.avatar), style: { width: 28, height: 28, borderRadius: '50%' }, alt: '' })
                        : React.createElement('div', { style: { width: 28, height: 28, borderRadius: '50%', background: wrAlpha(TIER_COLORS.ELITE, '44') } }),
                    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 } }, 'Top of food chain'),
                        React.createElement('div', { style: { fontSize: '0.78rem', fontWeight: 700, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, topTeam.ownerName || 'Unknown'),
                    ),
                    React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 700, color: TIER_COLORS.ELITE } }, topTeam.healthScore || 0),
                ),
                // Your closest competitors
                (() => {
                    const c = getClosestCompetitors(3);
                    if (!c.above.length && !c.below.length) return null;
                    return React.createElement('div', { style: { padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
                        React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' } }, 'Closest Competitors · vs You'),
                        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', fontFamily: 'var(--font-body)', overflow: 'auto' } },
                            ...c.above.map((t, i) => renderCompetitorRow(t, 'a' + i, { myHealth: c.myHealth })),
                            // YOU row
                            mine && React.createElement('div', { key: 'me', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', borderRadius: '4px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))' } },
                                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontWeight: 700, width: 18, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' } }, '#' + c.myRank),
                                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', flex: 1, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, '★ YOU · ' + (mine.ownerName || '')),
                                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 5px', borderRadius: 3, background: wrAlpha(TIER_COLORS[mine.tier], '22'), color: TIER_COLORS[mine.tier], fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' } }, (mine.tier || '—').slice(0, 4)),
                                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--white)', fontFamily: 'JetBrains Mono, monospace', minWidth: 22, textAlign: 'right' } }, c.myHealth),
                                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace', minWidth: 28, textAlign: 'right' } }, '—'),
                            ),
                            ...c.below.map((t, i) => renderCompetitorRow(t, 'b' + i, { myHealth: c.myHealth })),
                        ),
                    );
                })(),
            );
        }

        // ── xxl: full breakdown — tiers + tier strength matrix + DHQ chart ──
        if (size === 'xxl') {
            // Position-of-power: which tier owns the most DHQ at each position?
            const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
            const scores = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (window.App?.LI?.playerScores || {});
            const normPos = window.App?.normPos || (p => p);
            const posLabel = pos => window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);

            const matrix = POS_ORDER.map(pos => {
                const tierTotals = { ELITE: 0, CONTENDER: 0, CROSSROADS: 0, REBUILDING: 0 };
                assessments.forEach(a => {
                    const roster = (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId);
                    if (!roster) return;
                    let dhq = 0;
                    (roster.players || []).forEach(pid => {
                        const p = playersData?.[pid];
                        if (!p) return;
                        if (normPos(p.position) === pos) dhq += scores[pid] || 0;
                    });
                    if (tierTotals[a.tier] !== undefined) tierTotals[a.tier] += dhq;
                });
                return { pos, totals: tierTotals };
            });

            // Tier-DHQ summary (overall)
            const tierTotalDHQ = {};
            TIER_ORDER.forEach(t => { tierTotalDHQ[t] = 0; });
            assessments.forEach(a => {
                const roster = (currentLeague?.rosters || []).find(r => r.roster_id === a.rosterId);
                if (!roster) return;
                const sum = (roster.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0);
                if (tierTotalDHQ[a.tier] !== undefined) tierTotalDHQ[a.tier] += sum;
            });
            const grandTotal = Object.values(tierTotalDHQ).reduce((s, v) => s + v, 0) || 1;

            // Compute health histogram for xxl
            const xxlHist = [0, 0, 0, 0, 0];
            assessments.forEach(a => {
                const h = a.healthScore || 0;
                const bucket = Math.min(4, Math.floor(h / 20));
                xxlHist[bucket]++;
            });
            const xxlMyBucket = mine ? Math.min(4, Math.floor((mine.healthScore || 0) / 20)) : -1;
            const xxlMaxBucket = Math.max(...xxlHist, 1);
            const xxlHistLabels = ['0-20', '20-40', '40-60', '60-80', '80+'];
            const closest = getClosestCompetitors(4);

            return React.createElement('div', { style: base },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    React.createElement('span', { style: { fontSize: '1.1rem' } }, '🏆'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em' } }, 'Competitive Tiers'),
                    posture
                        ? React.createElement('span', { title: 'GM Strategy: ' + (gm.modeLabel || gm.mode) + ' · ' + posture.sub, style: { marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: posture.col, padding: '3px 8px', borderRadius: '4px', background: wrAlpha(posture.col, '22'), border: '1px solid ' + wrAlpha(posture.col, '55') } }, '★ YOU · ' + posture.label + (myTier ? ' · ' + myTier + ' tier' : ''))
                        : (myTier && React.createElement('span', { style: { marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: TIER_COLORS[myTier], padding: '3px 8px', borderRadius: '4px', background: wrAlpha(TIER_COLORS[myTier], '22'), border: '1px solid ' + wrAlpha(TIER_COLORS[myTier], '55') } }, '★ YOU · ' + myTier)),
                    analyticsButton(),
                ),
                // 2-col grid: tier rows (left) | matrix + summary + histogram (right)
                React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '12px', overflow: 'hidden' } },
                    // LEFT col: tier rows (top) + Closest Competitors (bottom)
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, minHeight: 0, overflow: 'hidden' } },
                        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 } },
                            ...TIER_ORDER.map(t => renderTierRow(t, { limit: 12, showLogos: true })),
                        ),
                        // Closest competitors panel
                        closest.myRank && React.createElement('div', { style: { padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' } }, 'Closest Competitors · vs You'),
                            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', overflow: 'auto' } },
                                ...closest.above.map((t, i) => renderCompetitorRow(t, 'a' + i, { myHealth: closest.myHealth })),
                                mine && React.createElement('div', { key: 'me', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', borderRadius: '4px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))' } },
                                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontWeight: 700, width: 18, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' } }, '#' + closest.myRank),
                                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', flex: 1, fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, '★ YOU · ' + (mine.ownerName || '')),
                                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 5px', borderRadius: 3, background: wrAlpha(TIER_COLORS[mine.tier], '22'), color: TIER_COLORS[mine.tier], fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' } }, (mine.tier || '—').slice(0, 4)),
                                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--white)', fontFamily: 'JetBrains Mono, monospace', minWidth: 22, textAlign: 'right' } }, closest.myHealth),
                                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace', minWidth: 28, textAlign: 'right' } }, '—'),
                                ),
                                ...closest.below.map((t, i) => renderCompetitorRow(t, 'b' + i, { myHealth: closest.myHealth })),
                            ),
                        ),
                    ),
                    // RIGHT col: matrix + total DHQ + health histogram
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0, overflow: 'hidden' } },
                        React.createElement('div', { style: { padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', flexShrink: 0 } },
                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } }, 'Position Strength · by Tier'),
                            ...matrix.map((m, i) => {
                                return React.createElement('div', { key: i, style: { marginBottom: '4px' } },
                                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--white)', marginBottom: '2px', fontFamily: 'var(--font-body)' } }, posLabel(m.pos)),
                                    React.createElement('div', { style: { display: 'flex', height: 8, borderRadius: 2, overflow: 'hidden' } },
                                        ...TIER_ORDER.map(t => {
                                            const v = m.totals[t];
                                            const pct = (v / Object.values(m.totals).reduce((s, x) => s + x, 0) * 100) || 0;
                                            if (pct === 0) return null;
                                            return React.createElement('div', { key: t, title: t + ': ' + Math.round(v / 1000) + 'k', style: { width: pct + '%', background: TIER_COLORS[t] } });
                                        }).filter(Boolean),
                                    ),
                                );
                            }),
                        ),
                        React.createElement('div', { style: { padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', flexShrink: 0 } },
                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } }, 'Total DHQ · by Tier'),
                            ...TIER_ORDER.map(t => {
                                const v = tierTotalDHQ[t];
                                const pct = (v / grandTotal) * 100;
                                return React.createElement('div', { key: t, style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' } },
                                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: TIER_COLORS[t], minWidth: 60, textTransform: 'uppercase', letterSpacing: '0.04em' } }, t),
                                    React.createElement('div', { style: { flex: 1, height: 8, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 2, overflow: 'hidden' } },
                                        React.createElement('div', { style: { width: pct + '%', height: '100%', background: TIER_COLORS[t] } }),
                                    ),
                                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace', minWidth: 32, textAlign: 'right' } }, Math.round(v / 1000) + 'k'),
                                );
                            }),
                        ),
                        // Health histogram (xxl version) — richer with median/avg overlay
                        (() => {
                            const totalAssess = assessments.length || 1;
                            const sortedHealth = [...assessments].map(a => a.healthScore || 0).sort((a, b) => a - b);
                            const median = sortedHealth[Math.floor(totalAssess / 2)] || 0;
                            const avg = Math.round(sortedHealth.reduce((s, v) => s + v, 0) / totalAssess);
                            return React.createElement('div', { style: { padding: '10px 12px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '6px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '6px' } },
                                React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexShrink: 0 } },
                                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 } }, 'Health Distribution'),
                                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace' } }, 'avg ' + avg + ' · median ' + median),
                                ),
                                // Bars with value-on-bar
                                React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '8px', flex: 1, minHeight: 60 } },
                                    ...xxlHist.map((n, i) => {
                                        const h = (n / xxlMaxBucket) * 100;
                                        const col = i === 4 ? TIER_COLORS.ELITE : i === 3 ? TIER_COLORS.CONTENDER : i === 2 ? TIER_COLORS.CROSSROADS : TIER_COLORS.REBUILDING;
                                        const isMine = i === xxlMyBucket;
                                        return React.createElement('div', { key: i, style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minHeight: 0, justifyContent: 'flex-end', position: 'relative' } },
                                            // Value label above bar
                                            React.createElement('div', { style: { fontSize: '0.78rem', fontWeight: 700, color: isMine ? col : (n > 0 ? 'var(--white)' : 'var(--silver)'), opacity: n > 0 ? 1 : 0.4, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 } }, n),
                                            // Bar
                                            React.createElement('div', { style: {
                                                width: '100%', height: h + '%',
                                                background: n > 0 ? 'linear-gradient(180deg, ' + col + ' 0%, ' + wrAlpha(col, 'AA') + ' 100%)' : 'var(--ov-3, rgba(255,255,255,0.04))',
                                                opacity: !n ? 0.3 : isMine ? 1 : 0.65,
                                                borderRadius: '3px 3px 0 0',
                                                border: isMine ? '2px solid var(--k-ffffff, #ffffff)' : 'none',
                                                minHeight: n > 0 ? 8 : 4,
                                                boxShadow: isMine ? '0 0 12px ' + wrAlpha(col, '88') : 'none',
                                                transition: '0.3s',
                                            } }),
                                            // Label + you marker
                                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: isMine ? 700 : 500, color: isMine ? col : 'var(--silver)', opacity: isMine ? 1 : 0.7, fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', lineHeight: 1.2 } },
                                                xxlHistLabels[i],
                                                isMine && React.createElement('div', { style: { fontSize: 'var(--text-micro)', color: col, fontWeight: 700, marginTop: '1px' } }, '★ YOU'),
                                            ),
                                        );
                                    }),
                                ),
                                // Tier color legend strip
                                React.createElement('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.7, paddingTop: '4px', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.04))', flexShrink: 0 } },
                                    React.createElement('span', null, React.createElement('span', { style: { color: TIER_COLORS.REBUILDING } }, '■ '), 'Rebuilding'),
                                    React.createElement('span', null, React.createElement('span', { style: { color: TIER_COLORS.CROSSROADS } }, '■ '), 'Crossroads'),
                                    React.createElement('span', null, React.createElement('span', { style: { color: TIER_COLORS.CONTENDER } }, '■ '), 'Contender'),
                                    React.createElement('span', null, React.createElement('span', { style: { color: TIER_COLORS.ELITE } }, '■ '), 'Elite'),
                                ),
                            );
                        })(),
                    ),
                ),
            );
        }

        return null;
    }

    window.CompetitiveTiersWidget = CompetitiveTiersWidget;
})();
