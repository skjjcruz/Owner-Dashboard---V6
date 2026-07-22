// ══════════════════════════════════════════════════════════════════
// js/tabs/trophy-room.js — Trophy Room: League History & Accolades
// Two views: League-wide (default) and Personal (tap any team).
// Data from analytics-engine.js buildOwnerHistory() + LI.championships.
// ══════════════════════════════════════════════════════════════════

function TrophyRoomTab({ currentLeague, leagueSkin, playersData, myRoster, sleeperUserId, initialView }) {
    const { useState, useMemo, useEffect } = React;
    const [selectedOwner, setSelectedOwner] = useState(null);
    // View can be deep-linked: an explicit initialView prop (stale ?tab=calendar
    // links) or a one-shot window._wrTrophyView set by the Home calendar widget.
    const [view, setView] = useState(() => {
        if (initialView) return initialView;
        try { const v = window._wrTrophyView; if (v) { delete window._wrTrophyView; return v; } } catch (e) {}
        return 'league';
    }); // 'league' | 'personal' | 'alltime' | 'chronicles' | 'import' | 'calendar'
    const [importText, setImportText] = useState('');
    const [importStatus, setImportStatus] = useState(''); // '' | 'parsing' | 'done' | 'error'
    const [recapStatus, setRecapStatus] = useState(''); // '' | 'generating' | 'done'
    const [recapText, setRecapText] = useState('');
    const leagueId = currentLeague?.id || currentLeague?.league_id || '';

    // ── Phone tier (<768, iPhone program Phase 4) ──
    // WR.useViewport lives in js/shared/viewport.js — a plain script that
    // runs before the babel chain, so its presence is fixed for the page's
    // lifetime (hook-order safe). `_phone` only gates ADDITIVE phone markup:
    // whenever it is false every desktop/tablet path below renders
    // byte-identical to the pre-phase file.
    const _vpUse = window.WR && window.WR.useViewport;
    const _vp = _vpUse ? _vpUse() : { isPhone: false };
    const _kitReady = !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.CardList);
    const _phone = !!_vp.isPhone && _kitReady;

    // Scout-free vs Pro (gate-map row 16): all history/records browsing,
    // custom events, and manual chronicle browsing stay free; the two AI
    // triggers (chronicles parse, season recap) are Pro. wrIsPro only.
    const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
    const openProUpsell = (feature) => {
        if (window.showProLaunchPage) window.showProLaunchPage();
        else if (window.showUpgradePrompt) window.showUpgradePrompt(feature);
    };

    // ── Export as image ──
    async function exportAsImage(elementId, filename) {
        const el = document.getElementById(elementId);
        if (!el) return;
        try { await window.ensureHtml2Canvas?.(); } catch (e) { /* fall through to text fallback */ }
        if (typeof window.html2canvas !== 'function') {
            // Fallback: copy text
            const text = el?.innerText || '';
            navigator.clipboard?.writeText(text);
            return;
        }
        try {
            const canvas = await window.html2canvas(el, { backgroundColor: 'var(--k-0a0a0a, #0a0a0a)', scale: 2, useCORS: true });
            canvas.toBlob(blob => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = (filename || 'trophy-card') + '.png';
                a.click();
                URL.revokeObjectURL(url);
            }, 'image/png');
        } catch (e) { console.warn('[TrophyRoom] Export error:', e); }
    }

    // Load chronicles from localStorage
    const CHRONICLES_KEY = 'wr_chronicles_' + leagueId;
    const [chronicles, setChronicles] = useState(() => {
        try { return JSON.parse(localStorage.getItem(CHRONICLES_KEY) || 'null'); } catch { return null; }
    });
    useEffect(() => {
        try { setChronicles(JSON.parse(localStorage.getItem(CHRONICLES_KEY) || 'null')); } catch { setChronicles(null); }
    }, [CHRONICLES_KEY]);

    // Phase 9: Hall of Fame entries — per-league, stored in WrStorage. Schema:
    // { id, scope: 'team'|'league', teamRosterId?, name, category, year, note }
    const HOF_KEY = 'wr_hof_' + leagueId;
    const [hof, setHof] = useState(() => {
        try { return JSON.parse(localStorage.getItem(HOF_KEY) || '[]'); } catch { return []; }
    });
    useEffect(() => {
        try { setHof(JSON.parse(localStorage.getItem(HOF_KEY) || '[]')); } catch { setHof([]); }
    }, [HOF_KEY]);
    const [hofDraft, setHofDraft] = useState({ scope: 'team', name: '', category: '', year: new Date().getFullYear(), note: '' });
    function saveHof(next) {
        setHof(next);
        try { localStorage.setItem(HOF_KEY, JSON.stringify(next)); } catch {}
    }
    function addHof(scope) {
        if (!hofDraft.name.trim()) return;
        const entry = {
            id: 'hof_' + Date.now(),
            scope, // 'team' or 'league'
            teamRosterId: scope === 'team' ? (selectedOwner || myRoster?.roster_id) : null,
            name: hofDraft.name.trim(),
            category: hofDraft.category.trim() || (scope === 'team' ? 'Franchise Legend' : 'All-Time'),
            year: Number(hofDraft.year) || new Date().getFullYear(),
            note: hofDraft.note.trim(),
            createdAt: Date.now(),
        };
        saveHof([...hof, entry]);
        setHofDraft({ scope, name: '', category: '', year: new Date().getFullYear(), note: '' });
    }
    function removeHof(id) { saveHof(hof.filter(h => h.id !== id)); }

    // Phase 9: Pull all-time earnings out of chronicles.standings (prizeMoney) — keyed by owner name.
    const earningsByOwner = useMemo(() => {
        const map = {};
        (chronicles?.standings || []).forEach(s => {
            const key = (s.owner || s.team || '').toLowerCase();
            if (!key) return;
            // Accept '$1,234' or numeric
            const raw = typeof s.prizeMoney === 'string' ? s.prizeMoney.replace(/[^\d.-]/g, '') : s.prizeMoney;
            const amount = Number(raw) || 0;
            if (amount > 0) map[key] = (map[key] || 0) + amount;
        });
        return map;
    }, [chronicles]);
    function earningsFor(ownerName) {
        const k = (ownerName || '').toLowerCase();
        return earningsByOwner[k] || 0;
    }

    // Phase 9 deferred: chronicles → CSV-first precedence helpers.
    // When a league imports Chronicles, those records overwrite scraped
    // buildOwnerHistory values where available (all-time record, custom awards,
    // championship counts from standings). Matching is done by case-insensitive
    // owner name or team name.
    function chroniclesRowFor(ownerName, teamName) {
        const list = chronicles?.standings || [];
        const q = (ownerName || '').toLowerCase();
        const t = (teamName || '').toLowerCase();
        return list.find(s =>
            (s.owner || '').toLowerCase() === q ||
            (s.team || '').toLowerCase() === q ||
            (t && (s.team || '').toLowerCase() === t)
        ) || null;
    }
    function chroniclesAwardsFor(ownerName, teamName) {
        const list = chronicles?.customAwards || [];
        const q = (ownerName || '').toLowerCase();
        const t = (teamName || '').toLowerCase();
        const won = [];
        list.forEach(a => {
            (a.winners || []).forEach(w => {
                const winner = (w.winner || '').toLowerCase();
                if (winner === q || (t && winner === t)) {
                    won.push({ name: a.name, year: w.year, stats: w.stats });
                }
            });
        });
        return won.sort((a, b) => (b.year || 0) - (a.year || 0));
    }

    // Re-render when league history loads/refreshes from Sleeper
    const [historyTick, setHistoryTick] = useState(0);
    useEffect(() => {
        const onLoaded = (event) => {
            const loadedLeagueId = event?.detail?.leagueId;
            if (!loadedLeagueId || String(loadedLeagueId) === String(leagueId)) setHistoryTick(t => t + 1);
        };
        window.addEventListener('wr_history_loaded', onLoaded);
        // Trigger background fetch if history isn't cached
        if (window.WrHistory && currentLeague) {
            window.WrHistory.loadIfMissing(currentLeague).catch(() => {});
        }
        return () => window.removeEventListener('wr_history_loaded', onLoaded);
    }, [leagueId]);

    const ownerHistory = useMemo(() => {
        try {
            if (window.WrHistory?.getOwnerHistory) return window.WrHistory.getOwnerHistory(leagueId);
            if (typeof buildOwnerHistory === 'function') return buildOwnerHistory(leagueId);
        } catch (e) {}
        return {};
    }, [leagueId, historyTick]);

    // Prefer WrHistory's championships over App.LI.championships — the latter
    // uses raw historical roster_ids (which collide with current rosters when
    // owners have left and slots have been re-assigned). WrHistory translates
    // to current rosterIds AND captures the historical owner name explicitly.
    const championships = useMemo(() => {
        const cached = window.WrHistory?.getCached?.(leagueId);
        const appChamps = String(window.App?.LI?.championshipLeagueId || '') === String(leagueId)
            ? window.App?.LI?.championships
            : null;
        return cached?.championships || appChamps || {};
    }, [leagueId, historyTick]);
    const owners = useMemo(() => Object.values(ownerHistory).sort((a, b) => b.championships - a.championships || b.playoffAppearances - a.playoffAppearances || b.wins - a.wins), [ownerHistory]);

    // ── Styles ──
    // Token-driven — radius/pad/gap come from the global scale.
    const cardStyle = { background: 'var(--black)', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 'var(--card-radius, 10px)', padding: 'var(--card-pad, 14px 16px)', marginBottom: 'var(--card-gap, 12px)' };
    const headerStyle = { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.85rem', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.06em', marginBottom: '10px' };

    // ── Trophy icon by finish ──
    function finishIcon(finish) {
        if (finish === 'Champion') return '\uD83C\uDFC6';
        if (finish === 'Runner-Up') return '\uD83E\uDD48';
        if (finish === 'Semi-Finals') return '\uD83E\uDD49';
        if (finish === 'Playoffs') return '\uD83C\uDFC8';
        return '\u2014';
    }
    function ordinal(n) {
        const num = Number(n);
        if (!Number.isFinite(num)) return n;
        const mod100 = num % 100;
        if (mod100 >= 11 && mod100 <= 13) return num + 'th';
        const mod10 = num % 10;
        return num + (mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th');
    }
    function formatSeasonFinish(finish) {
        const raw = String(finish || '').trim();
        if (!raw || raw === '\u2014') return 'Season logged';
        const hashPlace = raw.match(/^#\s*(\d+)$/);
        if (hashPlace) return ordinal(hashPlace[1]);
        if (/^\d+\s*-\s*\d+(?:\s*-\s*\d+)?$/.test(raw)) return 'Record ' + raw.replace(/\s+/g, '');
        return raw;
    }
    function formatSeasonRecord(season) {
        if (!season) return '';
        const wins = Number(season.wins);
        const losses = Number(season.losses);
        const ties = Number(season.ties || 0);
        if (Number.isFinite(wins) && Number.isFinite(losses) && (wins + losses + ties) > 0) {
            return wins + '-' + losses + (ties ? '-' + ties : '');
        }
        const raw = String(season.record || '').trim();
        return /^\d+\s*-\s*\d+(?:\s*-\s*\d+)?$/.test(raw) ? raw.replace(/\s+/g, '') : '';
    }
    function formatSeasonLine(season) {
        const finish = formatSeasonFinish(season?.finish);
        const record = formatSeasonRecord(season);
        if (!record) return finish;
        if (finish === 'Record ' + record || /^\d+\s*-\s*\d+(?:\s*-\s*\d+)?$/.test(String(season?.finish || '').trim())) {
            return 'Record ' + record;
        }
        return finish + ' \u00B7 ' + record;
    }

    // ══════════════════════════════════════════════════════════════
    // LEAGUE-WIDE VIEW
    // ══════════════════════════════════════════════════════════════
    function renderLeagueView() {
        const seasons = Object.keys(championships).sort();

        // 2-col top section: Championship Timeline (left) + All-Time Leaders (right)
        return React.createElement('div', null,
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-md, 12px)', marginBottom: 'var(--space-md, 12px)' } },
                renderChampionshipTimelineCard(seasons),
                renderAllTimeLeadersCard(),
            ),
            renderAllTimeStandingsCard(),
            renderHofSection('league'),
        );
    }

    function renderChampionshipTimelineCard(seasons) {
        if (_phone) return _renderChampTimelinePhone(seasons);
        return React.createElement('div', { id: 'trophy-champ-card', style: { ...cardStyle, marginBottom: 0 } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                    React.createElement('div', { style: { ...headerStyle, flex: 1, marginBottom: 0 } }, 'CHAMPIONSHIP TIMELINE'),
                    React.createElement('button', { onClick: () => exportAsImage('trophy-champ-card', (currentLeague?.name || 'league') + '-championships'), style: { background: 'none', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', color: 'var(--gold)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, padding: '3px 8px', minHeight: '44px', cursor: 'pointer', fontFamily: 'inherit' } }, '\uD83D\uDCF7 Image'),
                    React.createElement('button', { onClick: () => {
                        const text = seasons.map(s => {
                            const c = championships[s];
                            const champ = ownerHistory[c.champion]?.ownerName || '?';
                            const runner = ownerHistory[c.runnerUp]?.ownerName || '';
                            return s + ': ' + champ + (runner ? ' def. ' + runner : '');
                        }).join('\n');
                        navigator.clipboard?.writeText(currentLeague?.name + ' Championships\n' + text).then(() => {
                            const btn = document.getElementById('share-champ-btn');
                            if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
                        });
                    }, id: 'share-champ-btn', style: { background: 'none', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', color: 'var(--gold)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, padding: '3px 8px', minHeight: '44px', cursor: 'pointer', fontFamily: 'inherit' } }, 'Copy'),
                ),
                React.createElement('div', { style: { marginTop: '10px' } }),
                seasons.length === 0
                    ? React.createElement('div', { style: { color: 'var(--silver)', fontSize: '0.8rem' } }, 'No championship data yet. Play a full season to see your league history.')
                    : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                        seasons.map(season => {
                            const c = championships[season];
                            // Prefer current ownerHistory match (live link to profile)
                            // — falls back to the historical name captured by
                            // WrHistory when an owner has left the league.
                            const champOwner = ownerHistory[c.champion];
                            const runnerOwner = ownerHistory[c.runnerUp];
                            const champName = champOwner?.ownerName || c.championName || 'Unknown';
                            const champLeft = !champOwner && c.championName;
                            const runnerName = runnerOwner?.ownerName || c.runnerUpName || null;
                            const runnerLeft = !runnerOwner && c.runnerUpName;
                            const onClick = () => {
                                if (c.champion != null) { setSelectedOwner(c.champion); setView('personal'); }
                            };
                            return React.createElement('div', { key: season, style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderRadius: '8px', cursor: c.champion != null ? 'pointer' : 'default' }, onClick },
                                React.createElement('span', { style: { fontSize: '1.2rem' } }, '\uD83C\uDFC6'),
                                React.createElement('div', { style: { flex: 1 } },
                                    React.createElement('div', { style: { fontSize: '0.85rem', fontWeight: 700, color: 'var(--gold)' } }, season + ' Champion'),
                                    React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--white)' } },
                                        champName,
                                        champLeft && React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, marginLeft: '6px', fontStyle: 'italic' } }, '(former owner)'),
                                    ),
                                ),
                                runnerName && React.createElement('div', { style: { textAlign: 'right' } },
                                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)' } }, 'Runner-Up'),
                                    React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)' } },
                                        runnerName,
                                        runnerLeft && React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.55, marginLeft: '4px', fontStyle: 'italic' } }, '(former)'),
                                    ),
                                ),
                            );
                        })
                    ),
            );
    }

    function renderAllTimeLeadersCard() {
        return React.createElement('div', { style: { ...cardStyle, marginBottom: 0 } },
            React.createElement('div', { style: headerStyle }, 'ALL-TIME LEADERS'),
            React.createElement('div', _phone ? { className: 'wr-kpi-strip' } : { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
                _leaderCard('Most Titles', owners, o => o.championships, o => o.champSeasons.join(', ')),
                _leaderCard('Most Wins', owners, o => o.wins, o => o.wins + '-' + o.losses),
                _leaderCard('Most Playoffs', owners, o => o.playoffAppearances || 0, o => (o.playoffAppearances || 0) + ' runs'),
                _leaderCard('Best Win %', owners.filter(o => (o.wins + o.losses) >= 20), o => (o.wins / Math.max(1, (o.wins + o.losses))) * 100, o => Math.round((o.wins / Math.max(1, (o.wins + o.losses))) * 100) + '%'),
                _leaderCard('Most Points', owners, o => o.pointsFor || 0, o => Math.round(o.pointsFor || 0).toLocaleString()),
                _leaderCard('Tenure', owners, o => o.tenure || 0, o => (o.tenure || 0) + ' seasons'),
            ),
        );
    }

    // ── ALL-TIME STANDINGS — sortable-style table covering every metric ──
    function renderAllTimeStandingsCard() {
        // Rank by championships → playoffs → win% → wins
        const ranked = [...owners].sort((a, b) =>
            (b.championships - a.championships)
            || ((b.playoffAppearances || 0) - (a.playoffAppearances || 0))
            || ((b.wins / Math.max(1, b.wins + b.losses)) - (a.wins / Math.max(1, a.wins + a.losses)))
            || (b.wins - a.wins)
        );
        if (_phone) return _renderStandingsPhone(ranked);
        const cols = '32px 32px 1.4fr 80px 50px 50px 50px 60px 60px 60px';
        const headerCell = { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, opacity: 0.7 };
        return React.createElement('div', { style: cardStyle },
            React.createElement('div', { style: { ...headerStyle, display: 'flex', alignItems: 'center', gap: '6px' } },
                React.createElement('span', { style: { flex: 1 } }, 'ALL-TIME STANDINGS'),
                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'none', letterSpacing: 0 } }, ranked.length, ' owner', ranked.length === 1 ? '' : 's'),
            ),
            React.createElement('div', { style: { overflowX: 'auto', WebkitOverflowScrolling: 'touch' } },
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: cols, gap: '8px', padding: '4px 8px', borderBottom: '1px solid var(--ov-5, rgba(255,255,255,0.08))' } },
                React.createElement('span', headerCell, '#'),
                React.createElement('span', headerCell, ''),
                React.createElement('span', headerCell, 'Owner'),
                React.createElement('span', { ...headerCell, style: { ...headerCell, textAlign: 'right' } }, 'Record'),
                React.createElement('span', { ...headerCell, style: { ...headerCell, textAlign: 'right' } }, 'Win%'),
                React.createElement('span', { ...headerCell, style: { ...headerCell, textAlign: 'right' } }, 'Titles'),
                React.createElement('span', { ...headerCell, style: { ...headerCell, textAlign: 'right' } }, 'R-Up'),
                React.createElement('span', { ...headerCell, style: { ...headerCell, textAlign: 'right' } }, 'Playoffs'),
                React.createElement('span', { ...headerCell, style: { ...headerCell, textAlign: 'right' } }, 'PF'),
                React.createElement('span', { ...headerCell, style: { ...headerCell, textAlign: 'right' } }, 'PA'),
            ),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                ranked.map((o, i) => {
                    const isMe = !o.isFormer && o.rosterId === myRoster?.roster_id;
                    const total = (o.wins || 0) + (o.losses || 0);
                    const winPct = total > 0 ? Math.round((o.wins / total) * 100) : 0;
                    const wpCol = winPct >= 60 ? 'var(--good)' : winPct >= 50 ? 'var(--gold)' : winPct >= 40 ? 'var(--silver)' : 'var(--bad)';
                    const avatarUrl = o.avatar ? 'https://sleepercdn.com/avatars/thumbs/' + o.avatar : null;
                    return React.createElement('div', {
                        key: o.rosterId,
                        onClick: () => { if (!o.isFormer) { setSelectedOwner(o.rosterId); setView('personal'); } },
                        title: o.isFormer ? 'Former owner — no longer in the league' : 'Open profile',
                        style: {
                            display: 'grid', gridTemplateColumns: cols, gap: '8px',
                            alignItems: 'center', padding: '6px 8px',
                            borderRadius: '4px', cursor: o.isFormer ? 'default' : 'pointer',
                            background: isMe ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'var(--ov-1, rgba(255,255,255,0.01))',
                            borderLeft: isMe ? '2px solid var(--gold)' : '2px solid transparent',
                            fontFamily: 'var(--font-body)',
                            opacity: o.isFormer ? 0.65 : 1,
                        },
                    },
                        React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: i < 3 ? 'var(--gold)' : 'var(--silver)', fontWeight: 700, textAlign: 'right' } }, i + 1),
                        avatarUrl
                            ? React.createElement('img', { src: avatarUrl, style: { width: 22, height: 22, borderRadius: '50%' }, onError: e => e.target.style.display = 'none' })
                            : React.createElement('div', { style: { width: 22, height: 22, borderRadius: '50%', background: 'var(--ov-4, rgba(255,255,255,0.06))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--silver)' } }, (o.ownerName || '?')[0]),
                        React.createElement('div', { style: { minWidth: 0 } },
                            React.createElement('div', { style: { fontSize: '0.78rem', fontWeight: 600, color: isMe ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                                o.ownerName,
                                isMe && React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', marginLeft: '6px' } }, '★'),
                                o.isFormer && React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7, marginLeft: '6px', fontStyle: 'italic', fontWeight: 400 } }, '(former)'),
                            ),
                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6 } }, (o.tenure || 0) + ' season' + ((o.tenure || 0) === 1 ? '' : 's')),
                        ),
                        React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.74rem', color: 'var(--white)', fontWeight: 600, textAlign: 'right' } }, o.wins + '-' + o.losses),
                        React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.74rem', fontWeight: 700, color: wpCol, textAlign: 'right' } }, winPct + '%'),
                        React.createElement('span', { style: { textAlign: 'right' } },
                            o.championships > 0
                                ? React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.74rem', color: 'var(--gold)', fontWeight: 700 } }, o.championships, '🏆')
                                : React.createElement('span', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.45 } }, '—'),
                        ),
                        React.createElement('span', { style: { textAlign: 'right' } },
                            o.runnerUps > 0
                                ? React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--k-c0c0c0, #c0c0c0)', fontWeight: 700 } }, o.runnerUps, '🥈')
                                : React.createElement('span', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.45 } }, '—'),
                        ),
                        React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--silver)', textAlign: 'right' } }, o.playoffAppearances || 0),
                        React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--silver)', textAlign: 'right' } }, Math.round(o.pointsFor || 0).toLocaleString()),
                        React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.65, textAlign: 'right' } }, Math.round(o.pointsAgainst || 0).toLocaleString()),
                    );
                }),
            ),
            ),
        );
    }

    function _leaderCard(title, list, valueFn, displayFn) {
        const sorted = [...list].sort((a, b) => valueFn(b) - valueFn(a));
        const leader = sorted[0];
        if (!leader || valueFn(leader) <= 0) return React.createElement('div', { key: title, style: { padding: '8px', background: 'var(--ov-2, rgba(255,255,255,0.03))', borderRadius: '8px' } },
            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.04em' } }, title),
            React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)', marginTop: '4px' } }, '\u2014'),
        );
        return React.createElement('div', { key: title, style: { padding: '8px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderRadius: '8px', cursor: 'pointer' }, onClick: () => { setSelectedOwner(leader.rosterId); setView('personal'); } },
            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.04em' } }, title),
            React.createElement('div', { style: { fontSize: '1rem', fontWeight: 700, color: 'var(--white)', fontFamily: 'JetBrains Mono, monospace' } }, displayFn(leader)),
            React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)', marginTop: '2px' } }, leader.ownerName),
        );
    }

    // ══════════════════════════════════════════════════════════════
    // PERSONAL VIEW
    // ══════════════════════════════════════════════════════════════
    function renderPersonalView() {
        const o = ownerHistory[selectedOwner];
        if (!o) return React.createElement('div', { style: { color: 'var(--silver)', padding: '20px', textAlign: 'center' } }, 'Team not found');

        const avatarUrl = o.avatar ? 'https://sleepercdn.com/avatars/thumbs/' + o.avatar : null;
        // Phase 9 deferred: if Chronicles (imported CSV) has an all-time row for this owner,
        // it overrides the scraped record — the user's historical data is canonical.
        const chronRow = chroniclesRowFor(o.ownerName, o.teamName);
        const wonAwards = chroniclesAwardsFor(o.ownerName, o.teamName);
        const displayRecord = chronRow
            ? (chronRow.wins + '-' + chronRow.losses + (chronRow.winPct ? ' (' + chronRow.winPct + ')' : ''))
            : o.record;
        const chronChamps = chronRow?.championships || 0;
        const displayChamps = Math.max(o.championships, chronChamps);

        return React.createElement('div', null,
            // Back button
            React.createElement('button', { onClick: () => setView('league'), style: { background: 'none', border: 'none', color: 'var(--gold)', fontSize: '0.78rem', cursor: 'pointer', padding: '0 0 10px', fontFamily: 'inherit', fontWeight: 600 } }, '\u2190 All Teams'),

            // Owner header
            React.createElement('div', { style: { ...cardStyle, display: 'flex', alignItems: 'center', gap: '12px' } },
                avatarUrl && React.createElement('img', { src: avatarUrl, style: { width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }, onError: e => e.target.style.display = 'none' }),
                React.createElement('div', { style: { flex: 1 } },
                    React.createElement('div', { style: { fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)' } }, o.ownerName),
                    React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--silver)' } }, displayRecord, ' \u00B7 ', o.tenure, ' seasons \u00B7 ', o.pointsFor.toLocaleString(), ' PF'),
                    chronRow && React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.7, marginTop: '2px' } }, 'All-time record imported from Chronicles'),
                ),
                displayChamps > 0 && React.createElement('div', { style: { textAlign: 'center' } },
                    React.createElement('div', { style: { display: 'flex', gap: '2px' } }, Array.from({ length: displayChamps }, (_, i) => React.createElement('span', { key: i, style: { fontSize: '1.3rem' } }, '\uD83C\uDFC6'))),
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', marginTop: '2px' } }, displayChamps + 'x Champ'),
                ),
            ),

            // Phase 9 deferred: all-time RS record card (chronicles)
            chronRow && React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: headerStyle }, 'ALL-TIME REGULAR SEASON'),
                React.createElement('div', _phone ? { className: 'wr-kpi-strip' } : { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-sm, 8px)' } },
                    _statBox('Wins', chronRow.wins || 0, chronRow.winPct || ''),
                    _statBox('Losses', chronRow.losses || 0, ''),
                    _statBox('Playoffs', chronRow.playoffsMade || 0, (chronRow.playoffWins || 0) + '-' + (chronRow.playoffLosses || 0)),
                    _statBox('Titles', chronRow.championships || 0, (chronRow.runnerUps || 0) + ' RU'),
                ),
                chronRow.fromYear && React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7, marginTop: '6px' } },
                    'Seasons: ', chronRow.fromYear, chronRow.toYear ? ' – ' + chronRow.toYear : '', chronRow.isDefunct ? ' · defunct' : ''
                ),
            ),

            // Phase 9 deferred: custom awards won — pulled from chronicles.customAwards
            wonAwards.length > 0 && React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: headerStyle }, 'CUSTOM AWARDS'),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    wonAwards.map((a, i) => React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderRadius: '6px' } },
                        React.createElement('span', { style: { fontSize: '0.95rem' } }, '\uD83C\uDFC5'),
                        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontSize: '0.8rem', fontWeight: 700, color: 'var(--white)' } }, a.name),
                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)' } }, a.year || '', a.stats ? ' · ' + a.stats : ''),
                        ),
                    ))
                )
            ),

            // Stats grid — driven by historical data we actually have.
            // Tiles fall back gracefully to '—' when a field is empty rather
            // than showing 0 / 0 / 'Won 0' which read as "missing data".
            (() => {
                const totalG = (o.wins || 0) + (o.losses || 0) + (o.ties || 0);
                const winPct = totalG > 0 ? Math.round((o.wins / totalG) * 100) : null;
                const avgPF = o.tenure > 0 ? Math.round((o.pointsFor || 0) / o.tenure) : 0;
                // Achievement count via the shared module
                const A = window.WrAchievements;
                const ach = (A && o.rosterId != null && !o.isFormer) ? (() => {
                    const targetRoster = (currentLeague?.rosters || []).find(r => r.roster_id === o.rosterId);
                    if (!targetRoster) return null;
                    const stats = A.computeStats({ myRoster: targetRoster, currentLeague });
                    const evald = A.evaluate(stats);
                    return { earned: evald.earned.length, total: evald.earned.length + evald.unearned.length };
                })() : null;
                const earn = earningsFor(o.ownerName);
                return React.createElement('div', _phone ? { className: 'wr-kpi-strip', style: { marginBottom: 'var(--space-md, 12px)' } } : { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-sm, 8px)', marginBottom: 'var(--space-md, 12px)' } },
                    _statBox('Record', o.record || (o.wins + '-' + o.losses), totalG + ' games'),
                    _statBox('Win %', winPct != null ? winPct + '%' : '\u2014', totalG ? o.wins + 'W \u00B7 ' + o.losses + 'L' : 'No games yet'),
                    _statBox('Playoffs', o.playoffAppearances || 0, o.playoffAppearances > 0 ? (o.playoffAppearances + ' run' + (o.playoffAppearances === 1 ? '' : 's')) : 'None yet'),
                    _statBox('Titles', o.championships || 0, o.champSeasons?.length ? o.champSeasons.join(', ') : 'No titles'),
                    _statBox('Runner-Up', o.runnerUps || 0, o.runnerUpSeasons?.length ? o.runnerUpSeasons.join(', ') : 'None'),
                    _statBox('Total PF', Math.round(o.pointsFor || 0).toLocaleString(), 'avg ' + avgPF.toLocaleString() + '/yr'),
                    o.bestSeason && _statBox('Best Season', formatSeasonRecord(o.bestSeason) || (o.bestSeason.wins + '-' + o.bestSeason.losses), o.bestSeason.season + (o.bestSeason.finish && o.bestSeason.finish !== '\u2014' ? ' \u00B7 ' + formatSeasonFinish(o.bestSeason.finish) : '')),
                    ach && _statBox('Badges', ach.earned + '/' + ach.total, 'Achievements earned'),
                    earn > 0 && _statBox('Earnings', '$' + earn.toLocaleString(), 'All-time'),
                );
            })(),

            // 3-column: Season Timeline | Best Pick | Rivalries
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '12px' } },
                // Season Timeline (filter out current unfinished year)
                o.seasonHistory.length > 0 && React.createElement('div', { style: cardStyle },
                    React.createElement('div', { style: headerStyle }, 'SEASONS'),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                        o.seasonHistory.filter(s => {
                            const curYear = String(currentLeague?.season || new Date().getFullYear());
                            return s.season !== curYear || s.finish === 'Champion' || s.finish === 'Runner-Up';
                        }).map(s => React.createElement('div', { key: s.season, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', borderRadius: '4px', background: s.finish === 'Champion' ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'transparent' } },
                            React.createElement('span', { style: { fontSize: '0.75rem', minWidth: '16px' } }, finishIcon(s.finish)),
                            React.createElement('span', { style: { fontSize: '0.72rem', fontWeight: 600, color: 'var(--white)', minWidth: '32px' } }, s.season),
                            React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: s.finish === 'Champion' ? 'var(--gold)' : 'var(--silver)', flex: 1 } }, formatSeasonLine(s)),
                        )),
                    ),
                ),

                // Best Draft Pick — highest current DHQ from any drafted player
                (() => {
                    const draftOutcomes = window.App?.LI?.draftOutcomes || [];
                    const myDrafted = draftOutcomes.filter(d => d.roster_id === o.rosterId);
                    const withDHQ = myDrafted.map(d => ({ ...d, dhq: window.App?.LI?.playerScores?.[d.player_id] || 0 })).filter(d => d.dhq > 0);
                    const best = withDHQ.sort((a, b) => b.dhq - a.dhq)[0];
                    if (!best) return null;
                    return React.createElement('div', { style: cardStyle },
                        React.createElement('div', { style: headerStyle }, 'BEST DRAFT PICK'),
                        React.createElement('div', { style: { fontSize: '0.82rem', fontWeight: 600, color: 'var(--white)' } }, best.name),
                        React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)', marginTop: '2px' } }, best.pos, ' \u00B7 R', best.round, ' \u00B7 ', best.season),
                        React.createElement('div', { style: { fontSize: '1rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'JetBrains Mono, monospace', marginTop: '4px' } }, best.dhq.toLocaleString(), ' DHQ'),
                    );
                })(),

                // Rivalries — fix: use r.rosterId not r.opponent
                o.rivalries.length > 0 && React.createElement('div', { style: cardStyle },
                    React.createElement('div', { style: headerStyle }, 'RIVALRIES'),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                        o.rivalries.map((r, i) => {
                            const oppRid = r.rosterId || r.opponent;
                            const opp = ownerHistory[oppRid];
                            return React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' } },
                                React.createElement('span', { style: { color: 'var(--white)', fontWeight: 600, flex: 1 } }, opp?.ownerName || ('Team ' + oppRid)),
                                React.createElement('span', { style: { color: r.wins > r.losses ? 'var(--good)' : r.wins < r.losses ? 'var(--bad)' : 'var(--silver)', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' } }, r.wins, '-', r.losses),
                            );
                        }),
                    ),
                ),
            ),

            // First-class Achievements card — uses window.WrAchievements
            renderAchievementsCard(o.rosterId, o.ownerName),

            // Phase 9: Team Hall of Fame builder — per-team entries saved locally
            renderHofSection('team', o.rosterId, o.ownerName),
        );
    }

    // ── Achievements card (used in personal view) ───────────────────
    function renderAchievementsCard(rosterId, ownerName) {
        const A = window.WrAchievements;
        if (!A) return null;
        const targetRoster = (currentLeague?.rosters || []).find(r => r.roster_id === rosterId);
        if (!targetRoster) return null;
        const stats = A.computeStats({ myRoster: targetRoster, currentLeague });
        const evald = A.evaluate(stats);
        const earned = evald.earned;
        const unearned = evald.unearned;
        const tiers = ['titles', 'performance', 'tenure', 'misc'];

        function chip(a) {
            const tc = A.tierColor(a.tier);
            const isEarned = a.progress >= 1;
            return React.createElement('div', {
                key: a.id, title: a.label + ' — ' + a.description,
                style: {
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 10px',
                    background: isEarned ? wrAlpha(tc, '14') : 'var(--ov-1, rgba(255,255,255,0.02))',
                    border: '1px solid ' + (isEarned ? wrAlpha(tc, '55') : 'var(--ov-4, rgba(255,255,255,0.06))'),
                    borderRadius: '8px',
                    opacity: isEarned ? 1 : 0.55,
                },
            },
                React.createElement('span', { style: { fontSize: '1.15rem', filter: isEarned ? 'none' : 'grayscale(0.7)' } }, a.icon),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                    React.createElement('div', { style: { fontSize: '0.78rem', fontWeight: 700, color: isEarned ? tc : 'var(--white)', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '6px' } },
                        a.label,
                        isEarned && React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 5px', borderRadius: 3, background: wrAlpha(tc, '22'), color: tc, fontWeight: 700, letterSpacing: '0.04em' } }, 'EARNED'),
                    ),
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.75, marginTop: '2px' } }, a.description),
                    !isEarned && a.target > 1 && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' } },
                        React.createElement('div', { style: { flex: 1, height: 4, background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 2, overflow: 'hidden' } },
                            React.createElement('div', { style: { width: (a.progress * 100) + '%', height: '100%', background: tc, opacity: 0.85 } }),
                        ),
                        React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 } }, a.value + ' / ' + a.target),
                    ),
                ),
            );
        }

        return React.createElement('div', { style: cardStyle, key: 'achievements-' + rosterId },
            React.createElement('div', { style: { ...headerStyle, display: 'flex', alignItems: 'center', gap: '6px' } },
                React.createElement('span', { style: { flex: 1 } }, 'ACHIEVEMENTS'),
                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'none', letterSpacing: 0 } }, earned.length, ' / ', earned.length + unearned.length, ' earned'),
            ),
            ...tiers.map(tier => {
                const tierEarned = earned.filter(a => a.tier === tier);
                const tierUnearned = unearned.filter(a => a.tier === tier);
                if (tierEarned.length === 0 && tierUnearned.length === 0) return null;
                const tc = A.tierColor(tier);
                return React.createElement('div', { key: tier, style: { marginBottom: '12px' } },
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: tc, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } },
                        A.tierLabel(tier), ' · ', tierEarned.length, ' / ', tierEarned.length + tierUnearned.length,
                    ),
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '6px' } },
                        ...tierEarned.map(a => chip(a)),
                        ...tierUnearned.map(a => chip(a)),
                    ),
                );
            }).filter(Boolean),
        );
    }

    // Phase 9: HOF builder — list existing entries, show a small add form, scope-filtered.
    function renderHofSection(scope, rosterIdFilter, ownerName) {
        const entries = hof.filter(h => h.scope === scope && (scope === 'league' || h.teamRosterId === rosterIdFilter));
        const scopeLabel = scope === 'team' ? (ownerName ? ownerName.toUpperCase() + ' HALL OF FAME' : 'TEAM HALL OF FAME') : 'LEAGUE HALL OF FAME';
        return React.createElement('div', { style: cardStyle },
            React.createElement('div', { style: { ...headerStyle, display: 'flex', alignItems: 'center', gap: '6px' } },
                React.createElement('span', { style: { flex: 1 } }, scopeLabel),
                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'none', letterSpacing: 0 } }, entries.length + ' inductee' + (entries.length === 1 ? '' : 's'))
            ),
            entries.length === 0
                ? React.createElement('div', { style: { fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '10px' } }, 'No inductees yet. Add a legendary player, manager move, or season below.')
                : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' } },
                    entries.map(h => React.createElement('div', { key: h.id, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--acc-fill1, rgba(212,175,55,0.05))', borderLeft: '3px solid var(--gold)', borderRadius: '0 6px 6px 0' } },
                        React.createElement('span', { style: { fontSize: '1rem' } }, '\uD83C\uDFF5\uFE0F'),
                        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontSize: '0.84rem', fontWeight: 700, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, h.name),
                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', marginTop: '2px' } }, h.category + ' · ' + h.year + (h.note ? ' · ' + h.note : ''))
                        ),
                        React.createElement('button', { onClick: () => removeHof(h.id), style: { background: 'none', border: '1px solid rgba(231,76,60,0.3)', color: 'var(--k-e74c3c, #e74c3c)', borderRadius: '4px', padding: '2px 8px', minHeight: '44px', fontSize: 'var(--text-micro, 0.6875rem)', cursor: 'pointer', fontFamily: 'inherit' } }, 'Remove')
                    ))
                ),
            // Add form (scope-aware)
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '6px' } },
                React.createElement('input', { value: hofDraft.scope === scope ? hofDraft.name : '', onChange: e => setHofDraft({ ...hofDraft, scope, name: e.target.value }), placeholder: scope === 'team' ? 'Player or moment name' : 'Player, team, or moment', style: { padding: '6px 8px', minHeight: '44px', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '4px', color: 'var(--white)', fontSize: '0.76rem', fontFamily: 'inherit' } }),
                React.createElement('input', { value: hofDraft.scope === scope ? hofDraft.category : '', onChange: e => setHofDraft({ ...hofDraft, scope, category: e.target.value }), placeholder: 'Category (e.g., QB, Draft Steal)', style: { padding: '6px 8px', minHeight: '44px', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '4px', color: 'var(--white)', fontSize: '0.76rem', fontFamily: 'inherit' } }),
                React.createElement('input', { type: 'number', value: hofDraft.scope === scope ? hofDraft.year : '', onChange: e => setHofDraft({ ...hofDraft, scope, year: e.target.value }), placeholder: 'Year', style: { padding: '6px 8px', minHeight: '44px', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '4px', color: 'var(--white)', fontSize: '0.76rem', fontFamily: 'inherit' } }),
                React.createElement('button', { onClick: () => addHof(scope), disabled: hofDraft.scope !== scope || !hofDraft.name.trim(), style: { padding: '6px 12px', minHeight: '44px', background: (hofDraft.scope === scope && hofDraft.name.trim()) ? 'var(--gold)' : 'var(--acc-line1, rgba(212,175,55,0.2))', color: (hofDraft.scope === scope && hofDraft.name.trim()) ? 'var(--black)' : 'var(--silver)', border: 'none', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, cursor: (hofDraft.scope === scope && hofDraft.name.trim()) ? 'pointer' : 'not-allowed', fontFamily: 'inherit' } }, 'Induct')
            )
        );
    }

    function _statBox(label, value, sub) {
        return React.createElement('div', { style: { padding: '10px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderRadius: '8px', textAlign: 'center' } },
            React.createElement('div', { style: { fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', fontFamily: 'JetBrains Mono, monospace' } }, value || '\u2014'),
            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label),
            sub && React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', marginTop: '2px' } }, sub),
        );
    }

    // ══════════════════════════════════════════════════════════════
    // CHRONICLES IMPORT (paste or file upload)
    // ══════════════════════════════════════════════════════════════
    async function handleFileUpload(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        setImportStatus('reading');
        try {
            const ext = file.name.split('.').pop().toLowerCase();
            if (['csv', 'tsv', 'txt'].includes(ext)) {
                const text = await file.text();
                setImportText(text);
            } else if (['xlsx', 'xls'].includes(ext)) {
                // For Excel: read as text via basic CSV extraction
                const text = await file.text().catch(() => '');
                if (text) { setImportText(text); }
                else { setImportText('[Excel file: ' + file.name + ' — paste the data as text instead]'); }
            } else if (['pdf'].includes(ext)) {
                // PDFs can't be read client-side easily — ask user to paste
                setImportText('[PDF uploaded: ' + file.name + ']\nPDF text extraction is limited in-browser. For best results, copy the data from your PDF and paste it in the text box above.');
            } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
                // Images: convert to base64 for AI vision analysis
                const reader = new FileReader();
                reader.onload = () => {
                    const base64 = reader.result;
                    setImportText('[Image: ' + file.name + ']\nImage uploaded. Alex will analyze the content.\n\n' + base64.substring(0, 200) + '...');
                };
                reader.readAsDataURL(file);
            } else {
                const text = await file.text();
                setImportText(text);
            }
            setImportStatus('');
        } catch (err) {
            console.warn('[Chronicles] File read error:', err);
            setImportStatus('error');
        }
    }

    async function parseChronicles() {
        // AI trigger gate (D9 row 10): never fires for free — BYOK users
        // would otherwise reach the provider directly via callClaude.
        if (!isPro) { openProUpsell('league-chronicles'); return; }
        if (!importText.trim()) return;
        setImportStatus('parsing');
        try {
            const prompt = `Parse this fantasy football league historical data into structured JSON. The data may include all-time standings, championship history, custom awards, all-time teams, and defunct/former teams.

Return ONLY valid JSON with this structure (include only sections that exist in the data):
{
  "leagueName": "string",
  "standings": [{"team":"string","owner":"string","fromYear":2020,"toYear":null,"isDefunct":false,"wins":0,"losses":0,"winPct":"0%","playoffsMade":0,"playoffWins":0,"playoffLosses":0,"championships":0,"runnerUps":0,"prizeMoney":"$0","awards":{}}],
  "championshipHistory": [{"year":2024,"winner":"string","winnerScore":0,"loser":"string","loserScore":0,"hsp":{"offense":{"name":"","points":0},"defense":{"name":"","points":0}}}],
  "customAwards": [{"name":"string","winners":[{"year":2024,"winner":"string","stats":"string"}]}],
  "allTimeTeam": [{"pos":"QB","name":"string","team":"string","points":0,"year":2024}]
}

Here is the data:
${importText.substring(0, 8000)}`;

            const reply = typeof window.callClaude === 'function'
                ? await window.callClaude([{ role: 'user', content: prompt }])
                : await window.OD.callAI({ type: 'general', context: prompt });
            const text = typeof reply === 'string' ? reply : reply?.text || reply?.response || '';
            // Extract JSON from response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('Could not parse response as JSON');
            const parsed = JSON.parse(jsonMatch[0]);
            setChronicles(parsed);
            localStorage.setItem(CHRONICLES_KEY, JSON.stringify(parsed));
            // Invalidate the PlayerCard's cached chronicles-awards index so a
            // freshly-imported chronicles file surfaces in player cards immediately.
            if (typeof window._wrChroniclesInvalidate === 'function') window._wrChroniclesInvalidate();
            setImportStatus('done');
            setTimeout(() => setView('chronicles'), 500);
        } catch (e) {
            console.warn('[Chronicles] Parse error:', e);
            setImportStatus('error');
        }
    }

    function renderImportView() {
        return React.createElement('div', null,
            React.createElement('button', { onClick: () => setView('league'), style: { background: 'none', border: 'none', color: 'var(--gold)', fontSize: '0.78rem', cursor: 'pointer', padding: '0 0 10px', fontFamily: 'inherit', fontWeight: 600 } }, '\u2190 Back'),
            React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: headerStyle }, 'IMPORT LEAGUE CHRONICLES'),
                React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', lineHeight: 1.6, marginBottom: '12px' } },
                    'Upload a file or paste your league\'s historical data. Alex will parse the structure and map it into your Trophy Room.'),
                // File upload
                React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px' } },
                    React.createElement('label', { style: { flex: 1, padding: '10px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px dashed var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '8px', textAlign: 'center', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--gold)', fontWeight: 600 } },
                        '\uD83D\uDCC1 Upload CSV, Excel, PDF, or Image',
                        React.createElement('input', { type: 'file', accept: '.csv,.tsv,.txt,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.gif,.webp', onChange: handleFileUpload, style: { display: 'none' } }),
                    ),
                ),
                importStatus === 'reading' && React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--gold)', marginBottom: '8px' } }, 'Reading file...'),
                React.createElement('textarea', {
                    value: importText, onChange: e => setImportText(e.target.value),
                    placeholder: 'Paste your spreadsheet data here...\n\nExample:\nTEAM  FROM  TO  W  L  CHMP  2ND\nSkjjcruz  2021  47  22  2  1\n...',
                    style: { width: '100%', minHeight: '200px', padding: '12px', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '8px', color: 'var(--white)', fontSize: '0.78rem', fontFamily: 'JetBrains Mono, monospace', resize: 'vertical', boxSizing: 'border-box' }
                }),
                React.createElement('button', {
                    // Free: button stays live but opens the Pro upsell (parseChronicles gates).
                    onClick: parseChronicles, disabled: importStatus === 'parsing' || (isPro && !importText.trim()),
                    style: { width: '100%', marginTop: '10px', padding: '10px', background: importStatus === 'parsing' ? 'var(--silver)' : 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 700, cursor: importStatus === 'parsing' ? 'wait' : 'pointer', fontFamily: 'inherit' }
                }, !isPro ? '\ud83d\udd12 Import with Alex \u2014 Pro' : importStatus === 'parsing' ? 'Alex is parsing...' : importStatus === 'done' ? 'Imported!' : importStatus === 'error' ? 'Error \u2014 Try Again' : 'Import with Alex'),
            ),
        );
    }

    // ══════════════════════════════════════════════════════════════
    // CHRONICLES VIEW (imported data)
    // ══════════════════════════════════════════════════════════════
    function renderChroniclesView() {
        if (!chronicles) return React.createElement('div', { style: { color: 'var(--silver)', padding: '20px', textAlign: 'center', fontSize: '0.82rem' } },
            'No chronicles imported yet. Use the Import button to add your league\'s history.');

        return React.createElement('div', null,
            React.createElement('button', { onClick: () => setView('league'), style: { background: 'none', border: 'none', color: 'var(--gold)', fontSize: '0.78rem', cursor: 'pointer', padding: '0 0 10px', fontFamily: 'inherit', fontWeight: 600 } }, '\u2190 Back'),

            // League name
            chronicles.leagueName && React.createElement('div', { style: { fontSize: '1.1rem', fontWeight: 800, color: 'var(--gold)', marginBottom: '12px', textAlign: 'center', letterSpacing: 0 } }, chronicles.leagueName),

            // Championship History
            chronicles.championshipHistory?.length > 0 && React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: headerStyle }, 'CHAMPIONSHIP HISTORY'),
                chronicles.championshipHistory.map((c, i) =>
                    React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', borderBottom: i < chronicles.championshipHistory.length - 1 ? '1px solid var(--ov-3, rgba(255,255,255,0.04))' : 'none' } },
                        React.createElement('span', { style: { fontSize: '1rem' } }, '\uD83C\uDFC6'),
                        React.createElement('span', { style: { fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', minWidth: '35px' } }, c.year),
                        React.createElement('div', { style: { flex: 1 } },
                            React.createElement('div', { style: { fontSize: '0.82rem', fontWeight: 600, color: 'var(--white)' } }, c.winner, c.winnerScore ? ' ' + c.winnerScore : ''),
                            c.loser && React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)' } }, 'vs ', c.loser, c.loserScore ? ' ' + c.loserScore : ''),
                        ),
                        c.hsp?.offense && React.createElement('div', { style: { textAlign: 'right', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)' } },
                            React.createElement('div', null, 'HSP: ', c.hsp.offense.name),
                            React.createElement('div', null, c.hsp.offense.points, ' pts'),
                        ),
                    )
                ),
            ),

            // All-Time Standings
            chronicles.standings?.length > 0 && React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: headerStyle }, 'ALL-TIME STANDINGS'),
                React.createElement('div', { style: { overflowX: 'auto', overflowY: 'clip' } },
                    React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' } },
                        React.createElement('thead', null,
                            React.createElement('tr', null,
                                ['Team', 'W', 'L', 'W%', 'Chmp', 'PO'].map(h =>
                                    React.createElement('th', { key: h, style: { padding: '4px 6px', textAlign: h === 'Team' ? 'left' : 'center', color: 'var(--gold)', fontWeight: 700, borderBottom: '1px solid var(--acc-line1, rgba(212,175,55,0.2))' } }, h)
                                )
                            ),
                        ),
                        React.createElement('tbody', null,
                            chronicles.standings.map((s, i) =>
                                React.createElement('tr', { key: i, style: { opacity: s.isDefunct ? 0.4 : 1 } },
                                    React.createElement('td', { style: { padding: '4px 6px', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap' } }, s.team || s.owner, s.isDefunct && React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', marginLeft: '4px' } }, s.fromYear + '-' + (s.toYear || ''))),
                                    React.createElement('td', { style: { padding: '4px 6px', textAlign: 'center', color: 'var(--silver)' } }, s.wins),
                                    React.createElement('td', { style: { padding: '4px 6px', textAlign: 'center', color: 'var(--silver)' } }, s.losses),
                                    React.createElement('td', { style: { padding: '4px 6px', textAlign: 'center', color: 'var(--silver)' } }, s.winPct),
                                    React.createElement('td', { style: { padding: '4px 6px', textAlign: 'center', color: s.championships > 0 ? 'var(--gold)' : 'var(--silver)', fontWeight: s.championships > 0 ? 700 : 400 } }, s.championships || 0),
                                    React.createElement('td', { style: { padding: '4px 6px', textAlign: 'center', color: 'var(--silver)' } }, s.playoffsMade || 0),
                                )
                            ),
                        ),
                    ),
                ),
            ),

            // Custom Awards
            chronicles.customAwards?.length > 0 && React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: headerStyle }, 'AWARDS'),
                chronicles.customAwards.map((award, ai) =>
                    React.createElement('div', { key: ai, style: { marginBottom: ai < chronicles.customAwards.length - 1 ? '12px' : 0 } },
                        React.createElement('div', { style: { fontSize: '0.75rem', fontWeight: 700, color: 'var(--gold)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' } }, award.name),
                        (award.winners || []).map((w, wi) =>
                            React.createElement('div', { key: wi, style: { display: 'flex', gap: '8px', padding: '3px 0', fontSize: '0.72rem' } },
                                React.createElement('span', { style: { color: 'var(--silver)', minWidth: '35px' } }, w.year),
                                React.createElement('span', { style: { color: 'var(--white)', fontWeight: 600, flex: 1 } }, w.winner),
                                w.stats && React.createElement('span', { style: { color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)' } }, w.stats),
                            )
                        ),
                    )
                ),
            ),

            // All-Time Team
            chronicles.allTimeTeam?.length > 0 && React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: headerStyle }, 'ALL-TIME TEAM'),
                chronicles.allTimeTeam.map((p, i) =>
                    React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: i < chronicles.allTimeTeam.length - 1 ? '1px solid var(--ov-3, rgba(255,255,255,0.04))' : 'none', fontSize: '0.78rem' } },
                        React.createElement('span', { style: { fontWeight: 700, color: 'var(--gold)', minWidth: '28px' } }, p.pos),
                        React.createElement('span', { style: { fontWeight: 600, color: 'var(--white)', flex: 1 } }, p.name),
                        p.team && React.createElement('span', { style: { color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)' } }, p.team),
                        p.year && React.createElement('span', { style: { color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)' } }, p.year),
                        p.points && React.createElement('span', { style: { color: 'var(--gold)', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.72rem' } }, p.points),
                    )
                ),
            ),

            // Re-import button
            React.createElement('button', { onClick: () => setView('import'), style: { marginTop: '12px', width: '100%', padding: '8px', background: 'none', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '8px', color: 'var(--silver)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' } }, 'Re-import Chronicles'),
        );
    }

    // ══════════════════════════════════════════════════════════════
    // ALL-TIME VIEW — championship lineups, All-Time Team, auto Hall of Fame
    // ══════════════════════════════════════════════════════════════
    function renderAllTimeView() {
        const lid = currentLeague?.id || currentLeague?.league_id;
        const cache = window.WrHistory?.getCached?.(lid);
        const allTime = cache?.allTimeTeam || {};
        const hof = cache?.hallOfFame || [];
        const champEntries = Object.values(allTime);
        // Count distinct seasons captured in the All-Time Team — not just those
        // whose champion still has a current-roster mapping (former owners drop
        // out of cache.championships but their lineups stay in allTimeTeam).
        const capturedSeasons = new Set();
        champEntries.forEach(p => p.championships.forEach(c => { if (c.season) capturedSeasons.add(c.season); }));
        const totalChamps = capturedSeasons.size;

        // Resolve player display info (name, position) from playersData
        function resolve(pid) {
            const p = (playersData || {})[pid];
            const name = p?.full_name || ((p?.first_name || '') + ' ' + (p?.last_name || '')).trim() || pid;
            const pos = p?.position || '?';
            const team = p?.team || 'FA';
            return { name, pos, team };
        }
        const POS_COLORS = window.App?.POS_COLORS || { QB:'var(--k-e74c3c, #e74c3c)',RB:'var(--k-2ecc71, #2ecc71)',WR:'var(--k-3498db, #3498db)',TE:'var(--k-f0a500, #f0a500)',K:'var(--k-9b59b6, #9b59b6)',DL:'var(--k-e67e22, #e67e22)',LB:'var(--k-1abc9c, #1abc9c)',DB:'var(--k-e91e63, #e91e63)' };
        const positionGroups = window.App?.POS_GROUPS || {};

        // Best lineup: top scorer at each starter slot across all championship games
        const bestBySlot = (() => {
            const bySlot = {};
            champEntries.forEach(p => {
                const meta = resolve(p.pid);
                p.championships.forEach(c => {
                    const slot = c.slot || meta.pos || '?';
                    if (!bySlot[slot]) bySlot[slot] = [];
                    bySlot[slot].push({ pid: p.pid, name: meta.name, pos: meta.pos, team: meta.team, points: c.points || 0, season: c.season, ownerName: c.ownerName });
                });
            });
            const bestPerSlot = {};
            Object.entries(bySlot).forEach(([slot, players]) => {
                players.sort((a, b) => b.points - a.points);
                bestPerSlot[slot] = players[0];
            });
            return bestPerSlot;
        })();

        if (champEntries.length === 0) {
            return React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: headerStyle }, 'ALL-TIME'),
                React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.7 } },
                    cache ? 'No championship lineups have been captured yet — finish a season to populate.' : 'Loading league history…',
                ),
            );
        }

        // Sort the All-Time roster by appearances → totalPoints
        const sortedRoster = [...champEntries].sort((a, b) => b.appearances - a.appearances || b.totalPoints - a.totalPoints);
        // Group by position group (owner ask): groups ordered by most titles then
        // pts; players within a group by titles (appearances) then pts.
        const _normPos = window.App?.normPos;
        const posGroups = (() => {
            const g = {};
            sortedRoster.forEach(p => {
                const meta = resolve(p.pid);
                const key = (_normPos ? _normPos(meta.pos) : meta.pos) || meta.pos || '?';
                if (!g[key]) g[key] = { key, players: [], titles: 0, pts: 0 };
                g[key].players.push(p);
                g[key].titles += (p.appearances || 0);
                g[key].pts += (p.totalPoints || 0);
            });
            Object.values(g).forEach(grp => grp.players.sort((a, b) => (b.appearances - a.appearances) || (b.totalPoints - a.totalPoints)));
            return Object.values(g).sort((a, b) => (b.titles - a.titles) || (b.pts - a.pts));
        })();
        const _posLabelOf = (window.App && window.App.posLabel) || (p => p);

        return React.createElement('div', null,
            // ── Stats banner ──
            React.createElement('div', _phone ? { className: 'wr-kpi-strip', style: { marginBottom: 'var(--space-md, 12px)' } } : { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 'var(--space-sm, 8px)', marginBottom: 'var(--space-md, 12px)' } },
                React.createElement('div', { style: { ...cardStyle, marginBottom: 0, textAlign: 'center' } },
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.6rem', fontWeight: 700, color: 'var(--gold)' } }, totalChamps),
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em' } }, 'Champion Seasons Captured'),
                ),
                React.createElement('div', { style: { ...cardStyle, marginBottom: 0, textAlign: 'center' } },
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.6rem', fontWeight: 700, color: 'var(--k-7c6bf8, #7c6bf8)' } }, champEntries.length),
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em' } }, 'Unique Players'),
                ),
                React.createElement('div', { style: { ...cardStyle, marginBottom: 0, textAlign: 'center' } },
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.6rem', fontWeight: 700, color: 'var(--k-2ecc71, #2ecc71)' } }, hof.length),
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em' } }, 'Hall of Famers'),
                ),
            ),

            // ── All-Time Team ──
            hof.length > 0 && React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: { ...headerStyle, display: 'flex', alignItems: 'center', gap: '6px' } },
                    React.createElement('span', { style: { fontSize: '1rem' } }, '🎓'),
                    React.createElement('span', { style: { flex: 1 } }, 'ALL-TIME TEAM'),
                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'none', letterSpacing: 0 } }, 'Started in multiple championship lineups'),
                ),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '8px' } },
                    ...hof.map(p => {
                        const meta = resolve(p.pid);
                        const posCol = POS_COLORS[meta.pos] || 'var(--k-8d887e, #8d887e)';
                        return React.createElement('div', {
                            key: p.pid, onClick: () => { if (typeof window.openPlayerModal === 'function') window.openPlayerModal(p.pid); },
                            style: { padding: '10px 12px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '8px', cursor: 'pointer' },
                        },
                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } },
                                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: posCol, padding: '2px 6px', borderRadius: '3px', background: wrAlpha(posCol, '22') } }, meta.pos),
                                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                                    React.createElement('div', { style: { fontSize: '0.88rem', fontWeight: 700, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, meta.name),
                                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7 } }, meta.team),
                                ),
                                React.createElement('div', { style: { textAlign: 'right' } },
                                    React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1.05rem', fontWeight: 700, color: 'var(--gold)' } }, p.appearances + '🏆'),
                                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)' } }, Math.round(p.totalPoints) + ' pts'),
                                ),
                            ),
                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.85, lineHeight: 1.3 } },
                                p.championships.map(c => c.season + ' (' + (c.ownerName || '?').slice(0, 14) + ')').join(' · '),
                            ),
                        );
                    }),
                ),
            ),

            // ── All-Time Best Lineup (top scorer at each slot) ──
            Object.keys(bestBySlot).length > 0 && React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: { ...headerStyle, display: 'flex', alignItems: 'center', gap: '6px' } },
                    React.createElement('span', { style: { fontSize: '1rem' } }, '🏟️'),
                    React.createElement('span', { style: { flex: 1 } }, 'ALL-TIME BEST CHAMPIONSHIP LINEUP'),
                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'none', letterSpacing: 0 } }, 'Top scorer per slot across every title game'),
                ),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' } },
                    ...Object.entries(bestBySlot).sort(([a], [b]) => {
                        const order = ['QB','RB','WR','TE','FLEX','SUPER_FLEX','K','DEF','DL','LB','DB','IDP_FLEX','BN'];
                        return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
                    }).map(([slot, p]) => {
                        const posCol = POS_COLORS[p.pos] || 'var(--k-8d887e, #8d887e)';
                        return React.createElement('div', {
                            key: slot, onClick: () => { if (typeof window.openPlayerModal === 'function') window.openPlayerModal(p.pid); },
                            style: { padding: '8px 10px', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + wrAlpha(posCol, '44'), borderRadius: '6px', cursor: 'pointer' },
                        },
                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: posCol, textTransform: 'uppercase', letterSpacing: '0.08em' } }, slot),
                            React.createElement('div', { style: { fontSize: '0.85rem', fontWeight: 700, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '3px' } }, p.name),
                            React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.75, marginTop: '1px' } }, p.season + ' · ' + (p.ownerName || '').slice(0, 14)),
                            React.createElement('div', { style: { fontSize: '0.92rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'JetBrains Mono, monospace', marginTop: '4px' } }, p.points.toFixed(1) + ' pts'),
                        );
                    }),
                ),
            ),

            // ── Full champion-roster table (grouped by position group) ──
            _phone ? _renderChampRosterPhone(posGroups, resolve) :
            React.createElement('div', { style: cardStyle },
                React.createElement('div', { style: { ...headerStyle, display: 'flex', alignItems: 'center', gap: '6px' } },
                    React.createElement('span', { style: { fontSize: '1rem' } }, '📜'),
                    React.createElement('span', { style: { flex: 1 } }, 'ALL-TIME CHAMPION ROSTER'),
                    React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'none', letterSpacing: 0 } }, sortedRoster.length + ' players'),
                ),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' } },
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '40px 1fr 60px 70px 60px 1fr', gap: '8px', padding: '4px 8px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, opacity: 0.65, borderBottom: '1px solid var(--ov-5, rgba(255,255,255,0.08))' } },
                        React.createElement('span', null, 'Pos'),
                        React.createElement('span', null, 'Player'),
                        React.createElement('span', { style: { textAlign: 'right' } }, 'Titles'),
                        React.createElement('span', { style: { textAlign: 'right' } }, 'Total Pts'),
                        React.createElement('span', { style: { textAlign: 'right' } }, 'Avg'),
                        React.createElement('span', null, 'Seasons'),
                    ),
                    ...posGroups.flatMap(grp => [
                        React.createElement('div', { key: 'grp-' + grp.key, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 8px 3px' } },
                            React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, color: POS_COLORS[grp.key] || 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em' } }, _posLabelOf(grp.key)),
                            React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.55, fontFamily: 'JetBrains Mono, monospace' } }, grp.titles + ' titles · ' + Math.round(grp.pts).toLocaleString() + ' pts'),
                            React.createElement('span', { 'aria-hidden': 'true', style: { flex: 1, height: '1px', background: wrAlpha(POS_COLORS[grp.key] || 'var(--gold)', '2e') } }),
                        ),
                        ...grp.players.map(p => {
                            const meta = resolve(p.pid);
                            const posCol = POS_COLORS[meta.pos] || 'var(--k-8d887e, #8d887e)';
                            const avg = (p.totalPoints / p.appearances).toFixed(1);
                            return React.createElement('div', {
                                key: p.pid, onClick: () => { if (typeof window.openPlayerModal === 'function') window.openPlayerModal(p.pid); },
                                style: { display: 'grid', gridTemplateColumns: '40px 1fr 60px 70px 60px 1fr', gap: '8px', padding: '5px 8px', fontSize: '0.74rem', alignItems: 'center', cursor: 'pointer', background: p.appearances >= 2 ? 'var(--acc-fill1, rgba(212,175,55,0.04))' : 'var(--ov-1, rgba(255,255,255,0.01))', borderRadius: '4px' },
                            },
                                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: posCol, padding: '2px 5px', borderRadius: '3px', background: wrAlpha(posCol, '22'), textAlign: 'center' } }, meta.pos),
                                React.createElement('span', { style: { color: 'var(--white)', fontWeight: p.appearances >= 2 ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, meta.name + (p.appearances >= 2 ? ' 🎓' : '')),
                                React.createElement('span', { style: { textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--gold)', fontWeight: 700 } }, p.appearances + '🏆'),
                                React.createElement('span', { style: { textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--white)' } }, Math.round(p.totalPoints)),
                                React.createElement('span', { style: { textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--silver)' } }, avg),
                                React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                                    p.championships.map(c => c.season).join(', '),
                                ),
                            );
                        }),
                    ]),
                ),
            ),
        );
    }

    // ══════════════════════════════════════════════════════════════
    // SEASON RECAP GENERATOR
    // ══════════════════════════════════════════════════════════════
    async function generateSeasonRecap() {
        // AI trigger gate (D9 row 11): never fires for free (BYOK included).
        if (!isPro) { openProUpsell('season-recap'); return; }
        setRecapStatus('generating');
        try {
            const season = currentLeague?.season || new Date().getFullYear();
            const champs = championships || {};
            const champData = champs[season] || {};
            const champOwner = ownerHistory[champData.champion];
            const runnerOwner = ownerHistory[champData.runnerUp];

            const topTeams = owners.slice(0, 5).map(o => o.ownerName + ' (' + o.record + ')').join(', ');
            const tradeCount = window.App?.LI?.tradeHistory?.length || 0;

            const prompt = `Write a dramatic, entertaining 300-word season recap for a fantasy football league's ${season} season. Write in the style of a sports journalist covering a championship. Use vivid language and narrative storytelling.

League: ${currentLeague?.name || 'Dynasty League'}
Champion: ${champOwner?.ownerName || 'Unknown'} (${champOwner?.record || '?'})
Runner-Up: ${runnerOwner?.ownerName || 'Unknown'} (${runnerOwner?.record || '?'})
Top teams: ${topTeams}
Total trades: ${tradeCount}
Teams: ${owners.length}

Make it feel like a real sports story. Give it a compelling headline. End with a look-ahead line about next season.`;

            const reply = typeof window.callClaude === 'function'
                ? await window.callClaude([{ role: 'user', content: prompt }])
                : await window.OD.callAI({ type: 'general', context: prompt });
            const text = typeof reply === 'string' ? reply : reply?.text || reply?.response || '';
            setRecapText(text);
            setRecapStatus('done');
        } catch (e) {
            console.warn('[Recap] Error:', e);
            setRecapStatus('');
        }
    }

    // ══════════════════════════════════════════════════════════════
    // CALENDAR VIEW — League Calendar folded in from its old sidebar tab.
    // Renders the full CalendarTab (defined in js/tabs/calendar.js).
    // ══════════════════════════════════════════════════════════════
    function renderCalendarView() {
        const Cal = (typeof CalendarTab === 'function' ? CalendarTab : window.CalendarTab);
        if (typeof Cal !== 'function') {
            return React.createElement('div', { style: { color: 'var(--silver)', padding: '20px', textAlign: 'center', fontSize: '0.82rem' } }, 'Calendar unavailable.');
        }
        return React.createElement(Cal, { currentLeague, leagueSkin, myRoster });
    }

    // ══════════════════════════════════════════════════════════════
    // PHONE (<768) — iPhone program Phase 4 (Trophy Room)
    // Function declarations (hoisted) called ONLY when `_phone` is true;
    // each replaces one desktop card with its phone-kit re-pour. Every
    // handler (setSelectedOwner→'personal' push, exportAsImage, clipboard
    // share, openPlayerModal, generateSeasonRecap incl. its Pro gate) is
    // the SAME path the desktop element drives — zero gate movement.
    // ══════════════════════════════════════════════════════════════

    // View switcher → P2 .wr-seg strip; the Season Recap CTA re-homes as a
    // full-width row under the seg (league view only), identical Pro-gated
    // labels/handler as the desktop toolbar button.
    function _renderPhoneToolbar() {
        const segBtn = (label, tabKey, clickOverride) => React.createElement('button', {
            key: tabKey,
            className: view === tabKey ? 'is-on' : '',
            onClick: clickOverride || (() => setView(tabKey)),
            style: { minHeight: '44px' },
        }, label);
        return React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'wr-seg', style: { marginBottom: 'var(--space-sm, 8px)' } },
                segBtn('League', 'league'),
                segBtn('Me', 'personal', () => { setView('personal'); if (!selectedOwner) setSelectedOwner(myRoster?.roster_id); }),
                segBtn('All-Time', 'alltime'),
                segBtn('Calendar', 'calendar'),
                chronicles && segBtn('Chronicles', 'chronicles'),
                segBtn('Import', 'import'),
            ),
            view === 'league' && React.createElement('button', {
                key: 'recap-btn',
                onClick: generateSeasonRecap, disabled: recapStatus === 'generating',
                style: { width: '100%', marginBottom: 'var(--space-md, 12px)', padding: '6px 12px', minHeight: '44px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '6px', color: 'var(--gold)', fontSize: '0.7rem', fontWeight: 700, cursor: recapStatus === 'generating' ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
            }, !isPro ? '🔒 Season Recap — Pro' : recapStatus === 'generating' ? 'Alex is writing…' : '✨ Season Recap'),
        );
    }

    // Championship banner (P5): the newest championships[season] row is
    // promoted to a centered HeroCard; earlier seasons become P1 timeline
    // rows that deep-link setSelectedOwner→'personal' exactly like the
    // desktop rows. Export/Copy ride the banner (same exportAsImage id +
    // the same share text as the desktop buttons).
    function _renderChampTimelinePhone(seasons) {
        const ghostBtnStyle = {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '44px', padding: '8px 14px', margin: '8px 4px 0',
            borderRadius: '6px', cursor: 'pointer',
            background: 'transparent', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.5)',
            fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
        };
        const shareChamps = () => {
            const text = seasons.map(s => {
                const c = championships[s];
                const champ = ownerHistory[c.champion]?.ownerName || '?';
                const runner = ownerHistory[c.runnerUp]?.ownerName || '';
                return s + ': ' + champ + (runner ? ' def. ' + runner : '');
            }).join('\n');
            navigator.clipboard?.writeText(currentLeague?.name + ' Championships\n' + text).then(() => {
                const btn = document.getElementById('share-champ-btn');
                if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
            });
        };
        const newest = seasons.length ? seasons[seasons.length - 1] : null;
        const c0 = newest ? championships[newest] : null;
        const champOwner0 = c0 ? ownerHistory[c0.champion] : null;
        const champName0 = champOwner0?.ownerName || c0?.championName || 'Unknown';
        const runnerName0 = c0 ? (ownerHistory[c0.runnerUp]?.ownerName || c0.runnerUpName || null) : null;
        const older = seasons.slice(0, Math.max(0, seasons.length - 1)).reverse();
        return React.createElement('div', null,
            React.createElement('div', { id: 'trophy-champ-card', style: { textAlign: 'center' } },
                newest
                    ? React.createElement(window.WR.HeroCard, {
                        kicker: newest + ' League champion',
                        headline: String(champName0).toUpperCase(),
                        facts: (runnerName0 ? 'DEF. ' + String(runnerName0).toUpperCase() : 'REIGNING TITLE HOLDER')
                            + (!champOwner0 && c0?.championName ? ' · FORMER OWNER' : ''),
                    },
                        React.createElement('div', { style: { fontSize: '1.7rem', lineHeight: 1.2, margin: '4px 0 0' } }, '🏆'),
                        React.createElement('div', null,
                            React.createElement('button', { onClick: () => exportAsImage('trophy-champ-card', (currentLeague?.name || 'league') + '-championships'), style: ghostBtnStyle }, 'Export card'),
                            React.createElement('button', { id: 'share-champ-btn', onClick: shareChamps, style: ghostBtnStyle }, 'Copy'),
                        ),
                    )
                    : React.createElement(window.WR.HeroCard, {
                        kicker: 'League champion',
                        headline: 'NO TITLES YET',
                        facts: 'No championship data yet. Play a full season to see your league history.',
                    }),
            ),
            older.length > 0 && React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' } },
                older.map(season => {
                    const c = championships[season];
                    const champOwner = ownerHistory[c.champion];
                    const champName = champOwner?.ownerName || c.championName || 'Unknown';
                    const runnerName = ownerHistory[c.runnerUp]?.ownerName || c.runnerUpName || null;
                    return React.createElement(window.WR.AssetRow, {
                        key: season,
                        pos: '🏆',
                        name: champName + (!champOwner && c.championName ? ' (former)' : ''),
                        tag: runnerName ? 'DEF. ' + runnerName : 'CHAMPION',
                        slots: [{ label: 'SZN', value: season, tone: 'gold' }],
                        onClick: c.champion != null ? () => { setSelectedOwner(c.champion); setView('personal'); } : undefined,
                    });
                }),
            ),
        );
    }

    // All-time standings → P7 sticky-first-column ledger: every desktop
    // metric survives inside the scoped scroller (no column deaths). Calm
    // monochrome per the table doctrine — gold only on the title count,
    // top-3 rank and the isMe left rule (kept from desktop).
    function _renderStandingsPhone(ranked) {
        const mono = 'var(--font-mono, "JetBrains Mono", monospace)';
        const micro = 'var(--text-micro, 0.6875rem)';
        const thS = { padding: '9px 8px', textAlign: 'right', fontFamily: mono, fontSize: micro, color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, opacity: 0.7, whiteSpace: 'nowrap', borderBottom: '1px solid var(--ov-5, rgba(255,255,255,0.08))' };
        const tdS = { padding: '12px 8px', textAlign: 'right', fontFamily: mono, fontSize: '0.72rem', color: 'var(--silver)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' };
        return React.createElement('div', { style: cardStyle },
            React.createElement('div', { style: { ...headerStyle, display: 'flex', alignItems: 'center', gap: '6px' } },
                React.createElement('span', { style: { flex: 1 } }, 'ALL-TIME STANDINGS'),
                React.createElement('span', { style: { fontSize: micro, color: 'var(--silver)', textTransform: 'none', letterSpacing: 0 } }, ranked.length, ' owner', ranked.length === 1 ? '' : 's'),
            ),
            React.createElement('div', { className: 'wr-sticky-table-wrap' },
                React.createElement('table', { className: 'wr-sticky-table', style: { width: '100%', borderCollapse: 'collapse' } },
                    React.createElement('thead', null, React.createElement('tr', null,
                        React.createElement('th', { style: { ...thS, textAlign: 'left', minWidth: '124px' } }, 'Owner'),
                        ['Rec', 'Win%', 'Titles', 'R-Up', 'PO', 'PF', 'PA'].map(hd => React.createElement('th', { key: hd, style: thS }, hd)),
                    )),
                    React.createElement('tbody', null, ranked.map((o, i) => {
                        const isMe = !o.isFormer && o.rosterId === myRoster?.roster_id;
                        const total = (o.wins || 0) + (o.losses || 0);
                        const winPct = total > 0 ? Math.round((o.wins / total) * 100) : 0;
                        return React.createElement('tr', {
                            key: o.rosterId,
                            onClick: () => { if (!o.isFormer) { setSelectedOwner(o.rosterId); setView('personal'); } },
                            style: { cursor: o.isFormer ? 'default' : 'pointer', opacity: o.isFormer ? 0.65 : 1 },
                        },
                            React.createElement('td', { style: { ...tdS, textAlign: 'left', borderLeft: isMe ? '2px solid var(--gold)' : '2px solid transparent' } },
                                React.createElement('span', { style: { fontFamily: mono, fontSize: micro, color: i < 3 ? 'var(--gold)' : 'var(--silver)', fontWeight: 700, marginRight: '7px' } }, i + 1),
                                React.createElement('span', { style: { fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 600, color: isMe ? 'var(--gold)' : 'var(--white)' } },
                                    o.ownerName, isMe ? ' ★' : '', o.isFormer ? ' (former)' : ''),
                                React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: micro, color: 'var(--silver)', opacity: 0.6, marginLeft: '15px' } }, (o.tenure || 0) + ' season' + ((o.tenure || 0) === 1 ? '' : 's')),
                            ),
                            React.createElement('td', { style: { ...tdS, color: 'var(--white)', fontWeight: 600 } }, o.wins + '-' + o.losses),
                            React.createElement('td', { style: tdS }, winPct + '%'),
                            React.createElement('td', { style: { ...tdS, color: o.championships > 0 ? 'var(--gold)' : 'var(--silver)', fontWeight: o.championships > 0 ? 700 : 400 } }, o.championships > 0 ? o.championships + '🏆' : '—'),
                            React.createElement('td', { style: tdS }, o.runnerUps > 0 ? o.runnerUps : '—'),
                            React.createElement('td', { style: tdS }, o.playoffAppearances || 0),
                            React.createElement('td', { style: tdS }, Math.round(o.pointsFor || 0).toLocaleString()),
                            React.createElement('td', { style: { ...tdS, opacity: 0.65 } }, Math.round(o.pointsAgainst || 0).toLocaleString()),
                        );
                    })),
                ),
            ),
        );
    }

    // All-time champion roster → P1 AssetRows: pos badge · seasons tag ·
    // titles/pts/avg slots (gold spent on the title count only). Row tap =
    // the same openPlayerModal path as the desktop rows.
    function _renderChampRosterPhone(posGroups, resolve) {
        const posLabelOf = (window.App && window.App.posLabel) || (p => p);
        return React.createElement(window.WR.CardList, {
            // One group per position group (owner ask), ordered by titles then pts.
            groups: posGroups.map(grp => ({
                label: posLabelOf(grp.key),
                sub: grp.titles + (grp.titles === 1 ? ' title · ' : ' titles · ') + grp.players.length + (grp.players.length === 1 ? ' player' : ' players'),
                rows: grp.players.map(p => {
                    const meta = resolve(p.pid);
                    const avg = (p.totalPoints / p.appearances).toFixed(1);
                    return React.createElement(window.WR.AssetRow, {
                        key: p.pid,
                        pos: meta.pos,
                        name: meta.name + (p.appearances >= 2 ? ' 🎓' : ''),
                        tag: p.championships.map(c => c.season).join(' · '),
                        slots: [
                            { label: 'Titles', value: p.appearances, tone: 'gold' },
                            { label: 'Pts', value: Math.round(p.totalPoints).toLocaleString() },
                            { label: 'Avg', value: avg, tone: 'mute' },
                        ],
                        accent: p.appearances >= 2 ? 'gold' : undefined,
                        onClick: () => { if (typeof window.openPlayerModal === 'function') window.openPlayerModal(p.pid); },
                    });
                }),
            })),
        });
    }

    // ══════════════════════════════════════════════════════════════
    // MAIN RENDER
    // ══════════════════════════════════════════════════════════════
    const tabBtn = (label, tabKey, clickOverride) => React.createElement('button', {
        onClick: clickOverride || (() => setView(tabKey)),
        style: { padding: '6px 12px', minHeight: '44px', fontSize: '0.72rem', fontWeight: 700, borderRadius: '6px', border: '1px solid ' + (view === tabKey ? 'var(--gold)' : 'var(--ov-6, rgba(255,255,255,0.1))'), background: view === tabKey ? 'var(--gold)' : 'transparent', color: view === tabKey ? 'var(--black)' : 'var(--silver)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
    }, label);

    return React.createElement('div', { style: { padding: '0' } },
        // Tab toolbar — view toggle on the left, Season Recap CTA on the right (League view only)
        _phone ? _renderPhoneToolbar() :
        React.createElement('div', { style: { display: 'flex', gap: 'var(--space-sm, 8px)', marginBottom: 'var(--space-md, 12px)', overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', alignItems: 'center', flexWrap: 'wrap' } },
            tabBtn('League', 'league'),
            tabBtn('My Trophies', 'personal', () => { setView('personal'); if (!selectedOwner) setSelectedOwner(myRoster?.roster_id); }),
            tabBtn('All-Time', 'alltime'),
            tabBtn('Calendar', 'calendar'),
            chronicles && tabBtn('Chronicles', 'chronicles'),
            tabBtn('Import', 'import'),
            view === 'league' && React.createElement('button', {
                key: 'recap-btn',
                onClick: generateSeasonRecap, disabled: recapStatus === 'generating',
                style: { marginLeft: 'auto', padding: '6px 12px', minHeight: '44px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '6px', color: 'var(--gold)', fontSize: '0.7rem', fontWeight: 700, cursor: recapStatus === 'generating' ? 'wait' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
            }, !isPro ? '🔒 Season Recap — Pro' : recapStatus === 'generating' ? 'Alex is writing…' : '✨ Season Recap'),
        ),

        // Season Recap result card (only shown after generation). Long-form
        // starts collapsed past ~12 lines (268px ≈ 12 × 1.7-line-height) with
        // a "Full read" expand — the de-busying long-form rule.
        view === 'league' && recapStatus === 'done' && recapText && React.createElement('div', { style: { ...cardStyle } },
            React.createElement('div', { style: headerStyle }, 'SEASON RECAP'),
            (window.WR && window.WR.ClampedRead)
                ? React.createElement(window.WR.ClampedRead, { html: (window.WR.formatAI ? window.WR.formatAI(recapText) : recapText), maxHeight: 268, style: { fontSize: '0.82rem', color: 'var(--silver)', lineHeight: 1.5 }, fadeColor: 'var(--black, #000)' })
                : React.createElement('div', { style: { fontSize: '0.82rem', color: 'var(--silver)', lineHeight: 1.5 }, dangerouslySetInnerHTML: { __html: (window.WR && window.WR.formatAI) ? window.WR.formatAI(recapText) : recapText } }),
        ),

        view === 'league' ? renderLeagueView()
            : view === 'personal' ? renderPersonalView()
            : view === 'alltime' ? renderAllTimeView()
            : view === 'calendar' ? renderCalendarView()
            : view === 'chronicles' ? renderChroniclesView()
            : view === 'import' ? renderImportView()
            : renderLeagueView(),
    );
}
