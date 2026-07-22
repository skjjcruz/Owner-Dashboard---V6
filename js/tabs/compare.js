// js/tabs/compare.js - CompareTab: standalone team-vs-team comparison.
//
// Shows team-vs-team roster strength, position edges, H2H history, and a
// full per-position roster diff.
//
// Depends on: window.App.LI (playerScores, championships, bracketData),
//             window.App.normPos / POS_COLORS / peakWindows / calcPPG.
// Exposes:    window.CompareTab

// Session cache of the opponent-INDEPENDENT H2H raw data (the league-history
// chain walk + each season's rosters + weekly matchup rows), keyed by root
// league. Walking 12 previous_league_id hops + per-season rosters + ~14 weeks of
// matchups is identical for every opponent — only the final meetings filter
// differs — so a rival sweep used to re-download the whole chain once per rival.
// Kept in memory (not localStorage) because raw matchup rows are large; the
// compact per-opponent `meetings` result keeps its own localStorage cache.
window._wrCompareRawCache = window._wrCompareRawCache || {};

function CompareTab({
    currentLeague,
    leagueSkin,
    myRoster,
    playersData,
    statsData,
    stats2025Data,
    standings,
    sleeperUserId,
}) {
    const sameId = (a, b) => String(a) === String(b);
    const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
    const skinFeatures = resolvedLeagueSkin?.features || {};
    const valueShortLabel = resolvedLeagueSkin?.vocabulary?.valueShortLabel || 'DHQ';
    const valueLabel = resolvedLeagueSkin?.vocabulary?.valueLabel || 'DHQ Value';
    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    // Scout-free vs Pro: free keeps the full raw compare — matrix, per-row
    // leaders, age curves, duel totals headline, GM-lens chip. The buy/sell
    // Action row + the field-verdict Read gate on this predicate (mirrors
    // reconai compare-scout.js, which filters its Verdict row for free).
    const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
    // Redraft → build ROS values so roster-strength comparisons reflect
    // rest-of-season production (no-op → DHQ for dynasty/keeper).
    React.useMemo(() => {
        try { window.App?.PlayerValue?.ensureRos?.({ leagueId, league: currentLeague, playersData, statsData, priorData: stats2025Data, skin: resolvedLeagueSkin }); }
        catch (e) { if (window.wrLog) window.wrLog('compare.ensureRos', e); }
        return null;
    }, [currentLeague, playersData, statsData, stats2025Data]);
    const [compareTeamId, setCompareTeamId] = React.useState(() => {
        try {
            const preselect = window._wrComparePreselect;
            if (preselect != null && preselect !== '') return String(preselect);
            const stored = localStorage.getItem('wr_compare_team_' + (leagueId || 'default'));
            return stored || null;
        } catch { return null; }
    });
    const [compareScope, setCompareScope] = React.useState(() => {
        try {
            // A player card deep-linked into compare → land directly in Players mode.
            if (window._wrAddComparePlayer != null && window._wrAddComparePlayer !== '') return 'players';
            return localStorage.getItem('wr_compare_scope_' + (leagueId || 'default')) || 'duel';
        } catch { return 'duel'; }
    });
    // Players mode: up to 4 players compared straight on DHQ + signals.
    const [comparePlayerIds, setComparePlayerIds] = React.useState(() => {
        try {
            const raw = localStorage.getItem('wr_compare_players_' + (leagueId || 'default'));
            const list = raw ? JSON.parse(raw).map(String) : [];
            // Merge any pending deep-link target so it survives a remount even if the
            // ~50ms event misses a brief mount (e.g. tab churn).
            const pending = window._wrAddComparePlayer;
            if (pending != null && pending !== '' && !list.includes(String(pending))) list.push(String(pending));
            return list.slice(0, 4);
        } catch { return []; }
    });
    const [playerQuery, setPlayerQuery] = React.useState('');
    const playerSearchRef = React.useRef(null);
    // Phone (≤767) only: the add-player search opens in a WR.Sheet instead
    // of the inline dropdown. Unconditional hook — order stays stable.
    const [searchOpen, setSearchOpen] = React.useState(false);
    const [manualCompareIds, setManualCompareIds] = React.useState(() => {
        try {
            const raw = localStorage.getItem('wr_compare_group_' + (leagueId || 'default'));
            return raw ? JSON.parse(raw).map(String) : [];
        } catch { return []; }
    });
    const [selectedDivision, setSelectedDivision] = React.useState(() => {
        try { return localStorage.getItem('wr_compare_division_' + (leagueId || 'default')) || ''; } catch { return ''; }
    });
    const [h2hState, setH2hState] = React.useState({ loading: false, meetings: [], error: null, loadedFor: null });
    const [heatPos, setHeatPos] = React.useState(null); // phone Position Heatmap: selected position (null → first)
    const [searchPos, setSearchPos] = React.useState('ALL');   // phone add-player search: position-group filter
    const [searchTeam, setSearchTeam] = React.useState('ALL'); // phone add-player search: owned-by-team filter (rosterId)

    // Phone tier (≤767): shared viewport seam (js/shared/viewport.js) — every
    // phone-conditional style below keys off this so tablet/desktop never change.
    const { isPhone } = window.WR.useViewport();

    // Phone pattern kit (iPhone program Phase 2). wr-primitives.js loads
    // earlier in the babel chain, so presence is fixed for the page's
    // lifetime; every kit-dependent phone branch gates on _phoneKit and
    // falls back to the existing desktop markup when the kit is absent.
    const _kitReady = !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.FilterPill && window.WR.Sheet && window.WR.ActionBar);
    const _phoneKit = isPhone && _kitReady;
    const WrHeroCard = _kitReady ? window.WR.HeroCard : null;
    const WrAssetRow = _kitReady ? window.WR.AssetRow : null;
    const WrFilterPill = _kitReady ? window.WR.FilterPill : null;
    const WrPhoneSheet = _kitReady ? window.WR.Sheet : null;
    const WrPhoneActionBar = _kitReady ? window.WR.ActionBar : null;
    // Phone duel formatting (owner ask 2026-07-12): the Full-Roster-by-Position
    // section caps each room to the top rows with a per-position expander —
    // uncapped it ran 30+ rows × 9 rooms and the page scrolled forever.
    const [expandedRosterPos, setExpandedRosterPos] = React.useState(() => new Set());

    // GM Strategy is the single source of truth — re-renders live on save.
    const gm = window.WR.GmMode.useGmEffects(currentLeague);
    const gmTargetPositions = gm.targetPositions || new Set();
    const gmPosture = gm.marketPosture || 'hold';
    const gmPostureFrame = (() => {
        if (gmPosture === 'buy_low') return { label: 'Buy-Low Lens', hint: 'Strategy says hunt undervalued rooms in this matchup.', color: 'var(--win-green, var(--good))' };
        if (gmPosture === 'sell_high') return { label: 'Sell-High Lens', hint: 'Strategy says cash surplus rooms while value is hot.', color: 'var(--gold)' };
        if (gmPosture === 'exploit') return { label: 'Exploit Lens', hint: 'Strategy says press every edge and pounce on weakness.', color: 'var(--loss-red, var(--bad))' };
        return { label: 'Hold Lens', hint: 'Strategy says stand pat — read the field before moving.', color: 'var(--silver)' };
    })();

    React.useEffect(() => {
        const onOpenCompare = (event) => {
            const rid = event?.detail?.rosterId || window._wrComparePreselect;
            if (rid != null && rid !== '') {
                setCompareScope('duel');
                setCompareTeamId(String(rid));
            }
        };
        window.addEventListener('wr:open-compare', onOpenCompare);
        return () => window.removeEventListener('wr:open-compare', onOpenCompare);
    }, []);

    // Players mode deep-link: a player card's Compare button sets
    // window._wrAddComparePlayer then fires wr:add-compare-player. We consume the
    // global on mount (covers the lazy-mount race) AND listen for the event
    // (covers the already-mounted case). Adds dedupe + cap so double-fire is safe.
    React.useEffect(() => {
        const addId = (pid) => {
            if (pid == null || pid === '') return;
            const key = String(pid);
            setComparePlayerIds(prev => {
                const list = prev.map(String);
                if (list.includes(key)) return prev;
                return [...list, key].slice(0, 4);
            });
        };
        const consumeGlobal = () => {
            const pending = window._wrAddComparePlayer;
            if (pending != null && pending !== '') {
                addId(pending);
                setCompareScope('players');
            }
            try { delete window._wrAddComparePlayer; } catch { window._wrAddComparePlayer = null; }
        };
        consumeGlobal();
        const onAddCompare = (event) => {
            const pid = event?.detail?.pid != null ? event.detail.pid : window._wrAddComparePlayer;
            addId(pid);
            setCompareScope('players');
            try { delete window._wrAddComparePlayer; } catch { window._wrAddComparePlayer = null; }
        };
        window.addEventListener('wr:add-compare-player', onAddCompare);
        return () => window.removeEventListener('wr:add-compare-player', onAddCompare);
    }, []);

    React.useEffect(() => {
        if (!leagueId || !compareTeamId) return;
        try { localStorage.setItem('wr_compare_team_' + leagueId, String(compareTeamId)); } catch {}
    }, [leagueId, compareTeamId]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_scope_' + leagueId, compareScope); } catch {}
    }, [leagueId, compareScope]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_group_' + leagueId, JSON.stringify(manualCompareIds)); } catch {}
    }, [leagueId, manualCompareIds]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_division_' + leagueId, selectedDivision); } catch {}
    }, [leagueId, selectedDivision]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_players_' + leagueId, JSON.stringify(comparePlayerIds)); } catch {}
    }, [leagueId, comparePlayerIds]);

    React.useEffect(() => {
        let cancelled = false;
        const theirRoster = (currentLeague?.rosters || []).find(r => sameId(r.roster_id, compareTeamId));
        const rootLeagueId = currentLeague?.league_id || currentLeague?.id;
        const myOwnerId = myRoster?.owner_id;
        const theirOwnerId = theirRoster?.owner_id;
        const platform = currentLeague?._platform || (currentLeague?._mfl ? 'mfl' : currentLeague?._espn ? 'espn' : currentLeague?._yahoo ? 'yahoo' : 'sleeper');
        const canLoadSleeperHistory = platform === 'sleeper' && rootLeagueId && theirRoster && myOwnerId && theirOwnerId;

        if (compareScope !== 'duel') {
            setH2hState({ loading: false, meetings: [], error: null, loadedFor: null });
            return;
        }

        if (!compareTeamId || !canLoadSleeperHistory) {
            setH2hState({ loading: false, meetings: [], error: platform === 'sleeper' ? null : 'H2H history is only available for Sleeper leagues right now.', loadedFor: compareTeamId });
            return;
        }

        async function fetchJson(url) {
            try {
                const res = await fetch(url);
                return res.ok ? res.json() : null;
            } catch {
                return null;
            }
        }

        // Opponent-INDEPENDENT: walk the league-history chain and pull each
        // season's rosters + weekly matchup rows. Cached in-session per root
        // league so switching opponents (or sweeping rivals) reuses it instead of
        // re-downloading the whole chain. The chain WALK stays sequential (each
        // hop needs the prior previous_league_id); per-season fetches then run in
        // parallel rather than season-by-season.
        async function loadRawChain() {
            const sleeperBase = 'https://api.sleeper.app/v1';
            const cached = window._wrCompareRawCache[rootLeagueId];
            if (cached && Date.now() - cached.ts < 6 * 60 * 60 * 1000 && Array.isArray(cached.seasons)) {
                return cached.seasons;
            }

            const chain = [];
            const seen = new Set();
            let lid = String(rootLeagueId);
            let hops = 0;
            while (lid && lid !== '0' && !seen.has(lid) && hops < 12) {
                seen.add(lid);
                const fetchedInfo = await fetchJson(sleeperBase + '/league/' + lid);
                const info = sameId(lid, rootLeagueId)
                    ? Object.assign({}, fetchedInfo || {}, currentLeague || {})
                    : fetchedInfo;
                if (!info) break;
                chain.push({ leagueId: lid, info, season: String(info.season || '') });
                lid = (fetchedInfo?.previous_league_id || info.previous_league_id) ? String(fetchedInfo?.previous_league_id || info.previous_league_id) : '';
                hops += 1;
            }

            const seasons = (await Promise.all(chain.map(async seasonEntry => {
                const info = seasonEntry.info || {};
                const season = String(info.season || seasonEntry.season || '');
                const rosters = sameId(seasonEntry.leagueId, rootLeagueId) && Array.isArray(currentLeague?.rosters)
                    ? currentLeague.rosters
                    : await fetchJson(sleeperBase + '/league/' + seasonEntry.leagueId + '/rosters');
                if (!Array.isArray(rosters) || !rosters.length) return null;
                const playoffStart = Number(info.settings?.playoff_week_start) || Number(currentLeague?.settings?.playoff_week_start) || 15;
                const maxWeek = Math.max(1, Math.min(18, playoffStart - 1));
                const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
                const weeklyMatchups = await Promise.all(weeks.map(w =>
                    fetchJson(sleeperBase + '/league/' + seasonEntry.leagueId + '/matchups/' + w).then(rows => ({ week: w, rows: Array.isArray(rows) ? rows : [] }))
                ));
                return { leagueId: seasonEntry.leagueId, season, rosters, weeklyMatchups };
            }))).filter(Boolean);

            window._wrCompareRawCache[rootLeagueId] = { ts: Date.now(), seasons };
            return seasons;
        }

        async function loadHistoricalH2H() {
            const cacheKey = 'wr_compare_h2h_v3_' + rootLeagueId + '_' + myOwnerId + '_' + theirOwnerId;
            try {
                const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
                if (cached && Date.now() - cached.ts < 6 * 60 * 60 * 1000 && Array.isArray(cached.meetings)) {
                    return cached.meetings;
                }
            } catch {}

            const seasons = await loadRawChain();
            const meetings = [];
            const currentSeason = Number(currentLeague?.season || 0);

            for (const seasonEntry of seasons) {
                const season = seasonEntry.season;
                const rosters = seasonEntry.rosters;

                const historicalMine = rosters.find(r => sameId(r.owner_id, myOwnerId))
                    || (sameId(seasonEntry.leagueId, rootLeagueId) ? rosters.find(r => sameId(r.roster_id, myRoster?.roster_id)) : null);
                const historicalTheirs = rosters.find(r => sameId(r.owner_id, theirOwnerId))
                    || (sameId(seasonEntry.leagueId, rootLeagueId) ? rosters.find(r => sameId(r.roster_id, theirRoster?.roster_id)) : null);
                if (!historicalMine || !historicalTheirs) continue;

                seasonEntry.weeklyMatchups.forEach(({ week, rows }) => {
                    const grouped = {};
                    rows.forEach(row => {
                        if (!row || row.roster_id == null || row.matchup_id == null) return;
                        const key = String(row.matchup_id);
                        (grouped[key] = grouped[key] || []).push(row);
                    });

                    Object.values(grouped).forEach(pair => {
                        const me = pair.find(row => sameId(row.roster_id, historicalMine.roster_id));
                        const them = pair.find(row => sameId(row.roster_id, historicalTheirs.roster_id));
                        if (!me || !them) return;
                        const myPts = Number(me.points || 0);
                        const theirPts = Number(them.points || 0);
                        const played = myPts > 0 || theirPts > 0 || (Number(season) && Number(season) < currentSeason);
                        if (!played) return;
                        meetings.push({
                            season,
                            week,
                            myPoints: myPts,
                            theirPoints: theirPts,
                            result: myPts > theirPts ? 'W' : myPts < theirPts ? 'L' : 'T',
                            margin: +(myPts - theirPts).toFixed(2),
                            matchupId: me.matchup_id,
                        });
                    });
                });
            }

            meetings.sort((a, b) => Number(b.season) - Number(a.season) || b.week - a.week);
            try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), meetings })); } catch {}
            return meetings;
        }

        setH2hState({ loading: true, meetings: [], error: null, loadedFor: compareTeamId });
        loadHistoricalH2H()
            .then(meetings => {
                if (!cancelled) setH2hState({ loading: false, meetings, error: null, loadedFor: compareTeamId });
            })
            .catch(() => {
                if (!cancelled) setH2hState({ loading: false, meetings: [], error: 'Unable to load H2H history.', loadedFor: compareTeamId });
            });

        return () => { cancelled = true; };
    }, [leagueId, compareScope, compareTeamId, myRoster?.owner_id, myRoster?.roster_id, currentLeague?.rosters?.length]);

    // Position rank by DHQ across every scored player (e.g. "WR #14"), for the
    // Players-mode cards. Built once over the scored-player universe; recomputes
    // only when the player pool or the redraft basis changes. Self-contained
    // (own normPos/valueMap) so it can sit above the early return with the hooks.
    const posRankMap = React.useMemo(() => {
        const np = window.App?.normPos || ((x) => x);
        const sc = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (window.App?.LI?.playerScores || {});
        const raw = window.App?.LI?.playerScores || {};
        const byPos = {};
        Object.keys(raw).forEach(pid => {
            const pl = playersData?.[pid] || playersData?.[String(pid)];
            if (!pl) return;
            const pos = np(pl.position);
            const v = sc[pid] || sc[String(pid)] || 0;
            if (!v) return;
            (byPos[pos] = byPos[pos] || []).push([String(pid), v]);
        });
        const rank = {};
        Object.keys(byPos).forEach(pos => {
            byPos[pos].sort((a, b) => b[1] - a[1]).forEach((row, i) => { rank[row[0]] = i + 1; });
        });
        return rank;
    }, [playersData, currentLeague, statsData, stats2025Data]);

    if (!myRoster) {
        return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--silver)' }}>No roster found</div>;
    }

    const normPos = window.App.normPos;
    const posColors = window.App.POS_COLORS || {};
    const scores = window.App?.PlayerValue?.valueMap ? window.App.PlayerValue.valueMap() : (window.App?.LI?.playerScores || {});
    const allPositions = ['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
    const posLabel = pos => window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
    const rosterById = {};
    (currentLeague?.rosters || []).forEach(r => { rosterById[String(r.roster_id)] = r; });
    const getRosterTotal = (roster) => (roster?.players || []).reduce((sum, pid) => sum + (scores[pid] || scores[String(pid)] || 0), 0);
    const myTotal = getRosterTotal(myRoster);
    const getOwnerName = (roster, fallback) => {
        const user = (currentLeague?.users || []).find(u => sameId(u.user_id, roster?.owner_id));
        return user?.metadata?.team_name || user?.display_name || fallback || ('Team ' + (roster?.roster_id ?? ''));
    };
    const leagueSeason = parseInt(currentLeague?.season, 10) || new Date().getFullYear();
    const draftRounds = Number(currentLeague?.settings?.draft_rounds || 5);
    const leagueTeamCount = (currentLeague?.rosters || []).length || 12;
    const tradedPicks = window.S?.tradedPicks || [];
    const pickMidSlot = Math.ceil(leagueTeamCount / 2);
    const getPickValue = (year, round) => {
        const rd = Number(round) || 1;
        const pickNumber = (rd - 1) * leagueTeamCount + pickMidSlot;
        if (typeof window.getIndustryPickValue === 'function') return window.getIndustryPickValue(pickNumber, leagueTeamCount, draftRounds);
        const sharedValue = window.App?.PlayerValue?.getPickValue?.(year, rd, leagueTeamCount, pickMidSlot);
        if (sharedValue != null) return sharedValue;
        return Math.max(500, 10000 - rd * 2000);
    };
    const getDraftCapital = (roster) => {
        const rid = roster?.roster_id;
        const picks = [];
        if (rid == null) return { picks, totalValue: 0, count: 0, byRound: {}, byYear: {}, topPicks: [], label: '0 picks' };

        for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
            for (let rd = 1; rd <= draftRounds; rd++) {
                const tradedAway = tradedPicks.find(p => parseInt(p.season, 10) === yr && Number(p.round) === rd && sameId(p.roster_id, rid) && !sameId(p.owner_id, rid));
                if (!tradedAway) {
                    const value = getPickValue(yr, rd);
                    picks.push({
                        year: yr,
                        round: rd,
                        own: true,
                        value,
                        label: yr === leagueSeason ? 'R' + rd : "'" + String(yr).slice(-2) + ' R' + rd,
                    });
                }

                tradedPicks
                    .filter(p => parseInt(p.season, 10) === yr && Number(p.round) === rd && sameId(p.owner_id, rid) && !sameId(p.roster_id, rid))
                    .forEach(p => {
                        const fromRoster = rosterById[String(p.roster_id)];
                        const fromName = getOwnerName(fromRoster, 'Team ' + p.roster_id);
                        const value = getPickValue(yr, rd);
                        picks.push({
                            year: yr,
                            round: rd,
                            own: false,
                            from: fromName,
                            value,
                            label: (yr === leagueSeason ? 'R' + rd : "'" + String(yr).slice(-2) + ' R' + rd) + ' via ' + fromName,
                        });
                    });
            }
        }

        const byRound = {};
        const byYear = {};
        picks.forEach(p => {
            byRound[p.round] = (byRound[p.round] || 0) + 1;
            byYear[p.year] = (byYear[p.year] || 0) + 1;
        });
        const totalValue = picks.reduce((sum, p) => sum + (p.value || 0), 0);
        const topPicks = [...picks].sort((a, b) => b.value - a.value || a.year - b.year || a.round - b.round).slice(0, 4);
        return {
            picks,
            totalValue,
            count: picks.length,
            byRound,
            byYear,
            topPicks,
            label: picks.length + ' picks',
        };
    };
    const getFaab = (roster) => {
        const isFaab = currentLeague?.settings?.waiver_type === 2 || Number(currentLeague?.settings?.waiver_budget || 0) > 0;
        const budget = isFaab ? Number(currentLeague?.settings?.waiver_budget || 100) : 0;
        const spent = Number(roster?.settings?.waiver_budget_used || 0);
        const remaining = budget ? Math.max(0, budget - spent) : 0;
        return {
            isFaab,
            budget,
            spent,
            remaining,
            pct: budget ? Math.round(remaining / budget * 100) : 0,
            label: budget ? '$' + remaining + ' / $' + budget : 'No FAAB',
        };
    };
    const myName = getOwnerName(myRoster, 'You');
    const allTeamOptions = (standings || [])
        .map(t => {
            const roster = rosterById[String(t.rosterId)];
            const dhq = getRosterTotal(roster);
            return { ...t, roster, dhq, gap: Math.abs(dhq - myTotal), name: t.displayName || getOwnerName(roster, 'Team ' + t.rosterId) };
        })
        .filter(t => t.roster);
    const opponentOptions = (standings || [])
        .filter(t => !sameId(t.rosterId, myRoster.roster_id))
        .map(t => {
            const roster = rosterById[String(t.rosterId)];
            const dhq = getRosterTotal(roster);
            return { ...t, roster, dhq, gap: Math.abs(dhq - myTotal), name: t.displayName || getOwnerName(roster, 'Team ' + t.rosterId) };
        })
        .filter(t => t.roster);

    const metadata = currentLeague?.metadata || {};
    const getDivisionKey = (roster) => String(roster?.settings?.division ?? 0);
    const getDivisionName = (key) => metadata['division_' + key + '_name'] || metadata['division_' + key] || (key === '0' ? 'Division 0' : 'Division ' + key);
    const divisions = {};
    allTeamOptions.forEach(t => {
        const key = getDivisionKey(t.roster);
        if (!divisions[key]) divisions[key] = [];
        divisions[key].push(t);
    });
    const divisionKeys = Object.keys(divisions).sort((a, b) => Number(a) - Number(b));
    const myDivision = getDivisionKey(myRoster);
    const activeDivision = selectedDivision || myDivision || divisionKeys[0] || '0';
    const validTeamIdSet = new Set(allTeamOptions.map(t => String(t.rosterId)));
    const cleanManualIds = manualCompareIds.filter(id => validTeamIdSet.has(String(id)));
    const defaultGroupIds = [...opponentOptions]
        .sort((a, b) => b.dhq - a.dhq)
        .slice(0, Math.min(3, opponentOptions.length))
        .map(t => String(t.rosterId));
    const selectedGroupIds = cleanManualIds.length >= 2 ? cleanManualIds : defaultGroupIds;
    const selectedGroupTeams = selectedGroupIds
        .map(id => allTeamOptions.find(t => sameId(t.rosterId, id)))
        .filter(Boolean);
    const selectedDivisionTeams = divisions[activeDivision] || [];
    const divisionIncludesUser = sameId(activeDivision, myDivision);
    const selectedLeagueTeams = opponentOptions;
    const setScope = (scope) => {
        setCompareScope(scope);
        if (scope === 'duel' && !compareTeamId && opponentOptions[0]) setCompareTeamId(String(opponentOptions[0].rosterId));
    };
    const toggleManualTeam = (id) => {
        const key = String(id);
        setManualCompareIds(prev => prev.map(String).includes(key) ? prev.filter(x => String(x) !== key) : [...prev.map(String), key]);
    };
    const pickManualPreset = (preset) => {
        if (preset === 'threats') setManualCompareIds([...opponentOptions].sort((a, b) => b.dhq - a.dhq).slice(0, 4).map(t => String(t.rosterId)));
        else if (preset === 'closest') setManualCompareIds([...opponentOptions].sort((a, b) => a.gap - b.gap).slice(0, 4).map(t => String(t.rosterId)));
        else if (preset === 'division') setManualCompareIds((divisions[myDivision] || []).map(t => String(t.rosterId)));
        else if (preset === 'clear') setManualCompareIds([]);
    };
    const addComparePlayer = (pid) => {
        if (pid == null || pid === '') return;
        const key = String(pid);
        setComparePlayerIds(prev => prev.map(String).includes(key) ? prev : [...prev.map(String), key].slice(0, 4));
        setPlayerQuery('');
    };
    const removeComparePlayer = (pid) => setComparePlayerIds(prev => prev.filter(x => String(x) !== String(pid)));
    const clearComparePlayers = () => setComparePlayerIds([]);
    // Mirrors tierFromDhq in player-card.js so the Players cards label tiers the
    // same way the full card does.
    const tierLabelFromDhq = (dhq) => dhq >= 7000 ? { label: 'Elite', color: 'var(--good)' }
        : dhq >= 5000 ? { label: 'Tier 1', color: 'var(--k-3498db, #3498db)' }
        : dhq >= 3500 ? { label: 'Tier 2', color: 'var(--gold)' }
        : dhq >= 2000 ? { label: 'Tier 3', color: 'var(--silver)' }
        : dhq > 0 ? { label: 'Depth', color: 'var(--silver)' }
        : { label: '—', color: 'var(--silver)' };

    const statsRefForField = statsData || {};
    const stats2025RefForField = stats2025Data || {};
    const derivedStatsRefForField = window.S?.playerStats || {};
    const scoringForField = currentLeague?.scoring_settings || {};
    const calcFieldPPG = (pid) => {
        const st = statsRefForField[pid] || statsRefForField[String(pid)] || {};
        const prev = stats2025RefForField[pid] || stats2025RefForField[String(pid)] || {};
        const curGP = Number(st.gp || 0);
        const prevGP = Number(prev.gp || 0);
        const curPts = curGP > 0 && typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(st, scoringForField) : null;
        const prevPts = prevGP > 0 && typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(prev, scoringForField) : null;
        const derived = derivedStatsRefForField[pid] || derivedStatsRefForField[String(pid)] || {};
        if (curGP > 0 && curPts != null) return +(curPts / curGP).toFixed(1);
        if (prevGP > 0 && prevPts != null) return +(prevPts / prevGP).toFixed(1);
        return derived.seasonAvg || derived.prevAvg || 0;
    };
    const enrichFieldPlayer = (pid) => {
        const p = playersData?.[pid] || playersData?.[String(pid)];
        if (!p) return null;
        const pos = normPos(p.position);
        const curve = typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(pos)
            : { peak: (window.App?.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
        const valueEnd = curve.decline?.[1] || 32;
        const peakEnd = curve.peak?.[1] || 29;
        const age = p.age || null;
        return {
            pid,
            p,
            pos,
            age,
            team: p.team || 'FA',
            yrsExp: p.years_exp || 0,
            ppg: calcFieldPPG(pid),
            dhq: scores[pid] || scores[String(pid)] || 0,
            peakYrs: age ? Math.max(0, peakEnd - age) : 0,
            valueYrs: age ? Math.max(0, valueEnd - age) : 0,
            pastValue: age ? age > valueEnd : false,
        };
    };
    const starterDhqForRoster = (roster) => (roster?.starters || [])
        .filter(pid => pid && pid !== '0')
        .reduce((sum, pid) => sum + (scores[pid] || scores[String(pid)] || 0), 0);
    const teamProfile = (teamOption, isMine) => {
        const roster = isMine ? myRoster : teamOption?.roster;
        if (!roster) return null;
        const players = (roster.players || []).map(enrichFieldPlayer).filter(Boolean);
        const posTotals = {};
        const posTop = {};
        allPositions.forEach(pos => {
            const atPos = players.filter(r => r.pos === pos).sort((a, b) => b.dhq - a.dhq);
            posTotals[pos] = atPos.reduce((s, p) => s + p.dhq, 0);
            posTop[pos] = atPos[0] || null;
        });
        const total = getRosterTotal(roster);
        const starterTotal = starterDhqForRoster(roster);
        const pickCapital = getDraftCapital(roster);
        const faab = getFaab(roster);
        const pastValue = players.reduce((sum, p) => sum + (p.pastValue ? p.dhq : 0), 0);
        const topPlayer = [...players].sort((a, b) => b.dhq - a.dhq)[0] || null;
        return {
            roster,
            rosterId: String(roster.roster_id),
            isMine: !!isMine,
            name: isMine ? myName : (teamOption?.name || getOwnerName(roster, 'Team ' + roster.roster_id)),
            record: (roster.settings?.wins || 0) + '-' + (roster.settings?.losses || 0),
            division: getDivisionKey(roster),
            total,
            starterTotal,
            posTotals,
            posTop,
            players,
            pickCapital,
            faab,
            totalAssets: total + pickCapital.totalValue,
            topPlayer,
            pastValuePct: total > 0 ? Math.round(pastValue / total * 100) : 0,
        };
    };
    const openPlayerCard = (pid) => {
        if (!pid) return;
        if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
        else if (typeof window._wrSelectPlayer === 'function') window._wrSelectPlayer(pid);
    };

    const pageStyle = { padding: isPhone ? '12px var(--wr-phone-gutter, 12px) 60px' : 'var(--space-xl) var(--space-xl) 60px', maxWidth: '1540px', margin: '0 auto' };
    const panelStyle = { background: 'var(--black)', border: 'var(--card-border)', borderRadius: 'var(--card-radius)' };
    const labelStyle = { fontSize: 'var(--text-micro)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.66 };
    const mono = { fontFamily: 'JetBrains Mono, monospace' };
    const muted = { color: 'var(--silver)', opacity: 0.72 };
    const selectStyle = {
        padding: '9px 14px',
        fontSize: '0.82rem',
        fontFamily: 'var(--font-body)',
        background: 'var(--ov-3, rgba(255,255,255,0.04))',
        border: '1px solid var(--acc-line2, rgba(212,175,55,0.32))',
        borderRadius: '6px',
        color: 'var(--white)',
        minHeight: '44px',
    };
    const quickButtonStyle = (active) => ({
        padding: '8px 10px',
        background: active ? 'var(--acc-fill3, rgba(212,175,55,0.16))' : 'var(--ov-3, rgba(255,255,255,0.035))',
        border: '1px solid ' + (active ? 'var(--acc-line3, rgba(212,175,55,0.46))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
        borderRadius: '6px',
        color: active ? 'var(--gold)' : 'var(--silver)',
        textAlign: 'left',
        cursor: 'pointer',
        minWidth: '142px',
        minHeight: '44px',
    });

    const renderLanding = () => (
        <div style={{ ...panelStyle, padding: '28px', color: 'var(--silver)' }}>
            <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', color: 'var(--white)', fontWeight: 700, marginBottom: '6px' }}>
                Choose a matchup lens
            </div>
            <div style={{ fontSize: '0.86rem', lineHeight: 1.5, maxWidth: '620px' }}>
                Compare is strongest when it answers a specific question: who can beat you now, who is closest long term, and where the roster edge actually lives.
            </div>
        </div>
    );

    const scopeButtonStyle = (active) => ({
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid ' + (active ? 'var(--acc-line4, rgba(212,175,55,0.55))' : 'var(--ov-5, rgba(255,255,255,0.09))'),
        background: active ? 'var(--acc-fill3, rgba(212,175,55,0.16))' : 'var(--ov-3, rgba(255,255,255,0.035))',
        color: active ? 'var(--gold)' : 'var(--silver)',
        fontFamily: 'var(--font-title)',
        fontWeight: 800,
        fontSize: '0.92rem',
        cursor: 'pointer',
        minHeight: '44px',
    });
    const smallButtonStyle = (active) => ({
        padding: '6px 9px',
        borderRadius: '6px',
        border: '1px solid ' + (active ? 'var(--acc-line3, rgba(212,175,55,0.48))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
        background: active ? 'var(--acc-fill3, rgba(212,175,55,0.14))' : 'var(--ov-2, rgba(255,255,255,0.03))',
        color: active ? 'var(--gold)' : 'var(--silver)',
        fontSize: '0.72rem',
        fontWeight: 800,
        cursor: 'pointer',
        minHeight: '44px',
    });
    const renderScopeControls = () => (
        isPhone ? (
            // Phone (≤767): scope pills re-pour as the shared .wr-seg
            // segmented sub-nav (P2) — same lenses, same setScope setters;
            // the seg scrolls horizontally when the five don't fit.
            <div className="wr-seg" style={{ flex: '1 1 100%', minWidth: 0 }}>
                {[
                    ['duel', 'Duel'],
                    ['players', 'Players'],
                    ['group', 'Group'],
                    ['division', 'Division'],
                    ['league', 'League'],
                ].map(([key, label]) => (
                    <button key={key} className={compareScope === key ? 'is-on' : ''} onClick={() => setScope(key)}>{label}</button>
                ))}
            </div>
        ) : (
        <div className="wr-module-nav">
            {[
                ['duel', 'Duel', '1 opponent'],
                ['players', 'Players', 'head-to-head'],
                ['group', 'Group', '2+ teams'],
                ['division', 'Division', 'league divisions'],
                ['league', 'League', 'all teams'],
            ].map(([key, label, sub]) => (
                <button key={key} className={compareScope === key ? 'is-active' : ''} onClick={() => setScope(key)}>
                    {label}<span>{sub}</span>
                </button>
            ))}
        </div>
        )
    );
    const renderFieldControls = () => {
        if (compareScope === 'group') {
            return (
                <div style={{ ...panelStyle, padding: '12px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                        <div>
                            <div style={{ ...labelStyle, color: 'var(--gold)', opacity: 1 }}>Group Builder</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.68 }}>Pick any 2 or more teams for a custom field. Your team is optional.</div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button onClick={() => pickManualPreset('threats')} style={smallButtonStyle(false)}>Top 4 {valueShortLabel}</button>
                            <button onClick={() => pickManualPreset('closest')} style={smallButtonStyle(false)}>Closest 4</button>
                            <button onClick={() => pickManualPreset('division')} style={smallButtonStyle(false)}>My Division</button>
                            <button onClick={() => pickManualPreset('clear')} style={smallButtonStyle(false)}>Clear</button>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '7px' }}>
                        {allTeamOptions.map(t => {
                            const active = selectedGroupIds.map(String).includes(String(t.rosterId));
                            const manualActive = manualCompareIds.map(String).includes(String(t.rosterId));
                            return (
                                <button key={t.rosterId} onClick={() => toggleManualTeam(t.rosterId)} style={{
                                    padding: '8px 9px',
                                    minHeight: isPhone ? '44px' : undefined,
                                    borderRadius: '6px',
                                    border: '1px solid ' + (manualActive ? 'var(--acc-line3, rgba(212,175,55,0.46))' : 'var(--ov-4, rgba(255,255,255,0.07))'),
                                    background: manualActive ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : active ? 'var(--ov-4, rgba(255,255,255,0.055))' : 'var(--ov-2, rgba(255,255,255,0.025))',
                                    color: manualActive ? 'var(--gold)' : 'var(--silver)',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}>
                                    <div style={{ fontWeight: 850, color: manualActive ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                                    <div style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.66, marginTop: '2px' }}>{t.dhq.toLocaleString()} {valueShortLabel}{sameId(t.rosterId, myRoster.roster_id) ? ' · You' : ''}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            );
        }
        if (compareScope === 'division') {
            return (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    {divisionKeys.map(key => (
                        <button key={key} onClick={() => setSelectedDivision(key)} style={quickButtonStyle(key === activeDivision)}>
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.72 }}>{getDivisionName(key)}</div>
                            <div style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', marginTop: '2px' }}>{(divisions[key] || []).length} teams</div>
                        </button>
                    ))}
                </div>
            );
        }
        return null;
    };

    const renderFieldAnalysis = (selectedTeams, fieldLabel, fieldSub, options = {}) => {
        const includeUser = options.includeUser !== false;
        const selectedTeamList = selectedTeams.filter(Boolean);
        const selectedHasUser = selectedTeamList.some(t => sameId(t.rosterId, myRoster.roster_id));
        const profilesById = new Map();
        const addProfile = (profile) => {
            if (profile && !profilesById.has(profile.rosterId)) profilesById.set(profile.rosterId, profile);
        };
        if (includeUser && !selectedHasUser) addProfile(teamProfile(null, true));
        selectedTeamList.forEach(t => addProfile(teamProfile(t, sameId(t.rosterId, myRoster.roster_id))));
        const profiles = Array.from(profilesById.values());
        if (profiles.length < 2) {
            return <div style={{ ...panelStyle, padding: '24px', color: 'var(--silver)' }}>Select at least two teams to build a field comparison.</div>;
        }
        const sortedProfiles = [...profiles].sort((a, b) => b.totalAssets - a.totalAssets);
        const focusProfile = profiles.find(p => p.isMine) || profiles[0];
        const comparisonProfiles = profiles.filter(p => !sameId(p.rosterId, focusProfile.rosterId));
        const focusRank = Math.max(1, sortedProfiles.findIndex(p => sameId(p.rosterId, focusProfile.rosterId)) + 1);
        const fieldAvg = comparisonProfiles.length ? Math.round(comparisonProfiles.reduce((s, p) => s + p.total, 0) / comparisonProfiles.length) : 0;
        const starterAvg = comparisonProfiles.length ? Math.round(comparisonProfiles.reduce((s, p) => s + p.starterTotal, 0) / comparisonProfiles.length) : 0;
        const pickAvg = comparisonProfiles.length ? Math.round(comparisonProfiles.reduce((s, p) => s + (p.pickCapital?.totalValue || 0), 0) / comparisonProfiles.length) : 0;
        const faabAvg = comparisonProfiles.length ? Math.round(comparisonProfiles.reduce((s, p) => s + (p.faab?.remaining || 0), 0) / comparisonProfiles.length) : 0;
        const percentile = profiles.length > 1 ? Math.round((1 - ((focusRank - 1) / (profiles.length - 1))) * 100) : 100;
        const posDiffs = allPositions.map(pos => {
            const avg = comparisonProfiles.length ? comparisonProfiles.reduce((s, p) => s + (p.posTotals[pos] || 0), 0) / comparisonProfiles.length : 0;
            return { pos, avg, mine: focusProfile.posTotals[pos] || 0, diff: Math.round((focusProfile.posTotals[pos] || 0) - avg) };
        });
        const strongest = [...posDiffs].sort((a, b) => b.diff - a.diff)[0];
        const weakest = [...posDiffs].sort((a, b) => a.diff - b.diff)[0];
        const maxTotal = Math.max(1, ...profiles.map(p => p.totalAssets));
        const maxStarter = Math.max(1, ...profiles.map(p => p.starterTotal));
        const maxByPos = {};
        allPositions.forEach(pos => { maxByPos[pos] = Math.max(1, ...profiles.map(p => p.posTotals[pos] || 0)); });
        const bestByPos = {};
        allPositions.forEach(pos => {
            bestByPos[pos] = [...profiles].sort((a, b) => (b.posTotals[pos] || 0) - (a.posTotals[pos] || 0))[0]?.rosterId;
        });
        const divisionProfiles = {};
        profiles.forEach(p => {
            if (!divisionProfiles[p.division]) divisionProfiles[p.division] = [];
            divisionProfiles[p.division].push(p);
        });
        const breakdownProfiles = profiles.length <= 4 ? profiles : [];
        const positionBreakdowns = breakdownProfiles.length ? allPositions.map(pos => {
            const columns = breakdownProfiles.map(profile => {
                const playersAtPos = (profile.players || []).filter(r => r.pos === pos).sort((a, b) => b.dhq - a.dhq);
                return {
                    profile,
                    total: playersAtPos.reduce((s, r) => s + r.dhq, 0),
                    players: playersAtPos,
                };
            });
            const maxLen = Math.max(0, ...columns.map(col => col.players.length));
            const leader = [...columns].sort((a, b) => b.total - a.total)[0];
            return { pos, columns, maxLen, leaderId: leader?.profile?.rosterId };
        }).filter(summary => summary.maxLen > 0) : [];
        const fieldCards = [
            { label: 'Asset Rank', value: '#' + focusRank + ' of ' + profiles.length, sub: percentile + 'th percentile incl. picks', color: focusRank <= Math.ceil(profiles.length / 3) ? 'var(--good)' : focusRank <= Math.ceil(profiles.length * 0.66) ? 'var(--gold)' : 'var(--bad)' },
            { label: 'Roster vs Field', value: (focusProfile.total - fieldAvg > 0 ? '+' : '') + (focusProfile.total - fieldAvg).toLocaleString(), sub: focusProfile.total.toLocaleString() + ' vs ' + fieldAvg.toLocaleString() + ' avg', color: focusProfile.total >= fieldAvg ? 'var(--good)' : 'var(--bad)' },
            { label: 'Starter vs Field', value: (focusProfile.starterTotal - starterAvg > 0 ? '+' : '') + (focusProfile.starterTotal - starterAvg).toLocaleString(), sub: focusProfile.starterTotal.toLocaleString() + ' vs ' + starterAvg.toLocaleString() + ' avg', color: focusProfile.starterTotal >= starterAvg ? 'var(--good)' : 'var(--bad)' },
            { label: 'Picks vs Field', value: ((focusProfile.pickCapital.totalValue - pickAvg) > 0 ? '+' : '') + (focusProfile.pickCapital.totalValue - pickAvg).toLocaleString(), sub: focusProfile.pickCapital.count + ' picks vs ' + Math.round(comparisonProfiles.reduce((s, p) => s + (p.pickCapital?.count || 0), 0) / Math.max(comparisonProfiles.length, 1)) + ' avg', color: focusProfile.pickCapital.totalValue >= pickAvg ? 'var(--good)' : 'var(--bad)' },
            { label: 'FAAB vs Field', value: focusProfile.faab.isFaab ? ((focusProfile.faab.remaining - faabAvg) > 0 ? '+$' : '-$') + Math.abs(focusProfile.faab.remaining - faabAvg).toLocaleString() : '—', sub: focusProfile.faab.label, color: !focusProfile.faab.isFaab ? 'var(--silver)' : focusProfile.faab.remaining >= faabAvg ? 'var(--good)' : 'var(--bad)' },
            { label: 'Best Room', value: strongest ? posLabel(strongest.pos) : '-', sub: strongest ? ((strongest.diff > 0 ? '+' : '') + strongest.diff.toLocaleString() + ' vs avg') : '-', color: 'var(--good)' },
            { label: 'Danger Room', value: weakest ? posLabel(weakest.pos) : '-', sub: weakest ? ((weakest.diff > 0 ? '+' : '') + weakest.diff.toLocaleString() + ' vs avg') : '-', color: weakest?.diff < 0 ? 'var(--bad)' : 'var(--gold)' },
        ];
        // Phone column-set (plan D6): Field Ranking drops to the 4 decision
        // columns (# · Team · Assets · Edge) at ≤767 — column-drop, not squish.
        const rankGridCols = isPhone
            ? '34px minmax(0,1.5fr) minmax(0,.75fr) minmax(0,.9fr)'
            : '34px minmax(0,1.15fr) minmax(0,.58fr) minmax(0,.58fr) minmax(0,.58fr) minmax(0,.46fr) minmax(0,.4fr) minmax(0,.4fr) minmax(0,.62fr)';
        const fieldLead = focusProfile.isMine ? 'You' : focusProfile.name;
        // Tiered standing by percentile (rank among the field), owner ask.
        const fieldTier = percentile >= 80 ? { label: 'Top of the heap', color: 'var(--good)' }
            : percentile >= 55 ? { label: 'Front runner', color: 'var(--gold)' }
            : percentile >= 30 ? { label: 'Middle of the pack', color: 'var(--silver)' }
            : { label: 'Back of the pack', color: 'var(--bad)' };
        const fieldRead = focusProfile.isMine ? fieldTier.label : (focusProfile.total >= fieldAvg ? 'Above field avg' : 'Below field avg');
        const fieldReadColor = focusProfile.isMine ? fieldTier.color : (focusProfile.total >= fieldAvg ? 'var(--good)' : 'var(--bad)');

        const renderTeamChip = (profile) => (
            <div key={profile.rosterId} style={{ padding: '9px 10px', background: profile.isMine ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.03))', border: '1px solid ' + (profile.isMine ? 'var(--acc-line2, rgba(212,175,55,0.35))' : 'var(--ov-4, rgba(255,255,255,0.07))'), borderRadius: '7px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.66, marginTop: '2px' }}>{profile.record} - {getDivisionName(profile.division)}</div>
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.52, marginTop: '2px' }}>{profile.pickCapital.count} picks · {profile.faab.isFaab ? '$' + profile.faab.remaining + ' FAAB' : 'No FAAB'}</div>
                    </div>
                    <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--silver)', fontWeight: 800 }}>{profile.totalAssets.toLocaleString()}</div>
                </div>
                <div style={{ height: '4px', background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '3px', overflow: 'hidden', marginTop: '8px' }}>
                    <div style={{ width: (profile.totalAssets / maxTotal * 100) + '%', height: '100%', background: profile.isMine ? 'var(--gold)' : 'var(--k-7c6bf8, #7c6bf8)' }}></div>
                </div>
            </div>
        );
        const renderFieldPlayerCell = (player, column, rowBestDhq) => {
            if (!player) {
                return (
                    <div style={{
                        minHeight: '46px',
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid var(--ov-3, rgba(255,255,255,0.04))',
                        background: 'var(--ov-1, rgba(255,255,255,0.018))',
                        color: 'var(--ov-8, rgba(255,255,255,0.28))',
                        fontSize: '0.72rem',
                        display: 'flex',
                        alignItems: 'center',
                    }}>No player</div>
                );
            }
            const isRowBest = player.dhq > 0 && player.dhq === rowBestDhq;
            const isMine = column.profile.isMine;
            const dhqCol = player.dhq >= 7000 ? 'var(--good)' : player.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : player.dhq >= 1000 ? 'var(--silver)' : 'var(--ov-9, rgba(255,255,255,0.5))';
            return (
                <div
                    role="button"
                    tabIndex={0}
                    title="Open player card"
                    onClick={() => openPlayerCard(player.pid)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayerCard(player.pid); } }}
                    style={{
                    minHeight: '46px',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid ' + (isRowBest ? 'rgba(46,204,113,0.28)' : isMine ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-4, rgba(255,255,255,0.055))'),
                    background: isRowBest ? 'rgba(46,204,113,0.07)' : isMine ? 'var(--acc-fill1, rgba(212,175,55,0.045))' : 'var(--ov-1, rgba(255,255,255,0.024))',
                    cursor: 'pointer',
                    minWidth: 0,
                }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 }}>
                        {!isPhone && <img src={'https://sleepercdn.com/content/nfl/players/thumb/'+player.pid+'.jpg'} onError={e=>e.target.style.display='none'} style={{ width:'24px',height:'24px',borderRadius:'50%',objectFit:'cover', flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: 'var(--white)', fontSize: '0.76rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isPhone ? ((player.p?.first_name ? player.p.first_name[0] + '. ' : '') + (player.p?.last_name || player.p?.full_name || '?')) : (player.p?.full_name || '?')}</div>
                            <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.66, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {player.team} {player.age != null ? '· ' + player.age + 'yo' : ''}{player.ppg > 0 ? ' · ' + player.ppg + ' PPG' : ''} · {player.peakYrs > 0 ? player.peakYrs + 'yr peak' : player.valueYrs + 'yr value'}
                            </div>
                        </div>
                        <div style={{ ...mono, color: dhqCol, fontSize: '0.72rem', fontWeight: 850, flexShrink: 0 }}>{player.dhq > 0 ? player.dhq.toLocaleString() : '-'}</div>
                    </div>
                </div>
            );
        };
        const renderFieldRosterBreakdown = () => {
            if (profiles.length > 4) {
                return (
                    <div style={{ ...panelStyle, padding: '14px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', fontWeight: 850, color: 'var(--white)', letterSpacing: 0 }}>Full Breakdown</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.66, marginTop: '2px' }}>Available for up to 4 total teams so the player-level columns stay readable.</div>
                        </div>
                        <div style={{ ...mono, color: 'var(--gold)', fontSize: '0.76rem', fontWeight: 850 }}>{profiles.length} teams selected</div>
                    </div>
                );
            }

            return (
                <div style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                        <div>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Full Breakdown</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.62, marginTop: '2px' }}>Player-level rooms across {profiles.length} teams. Click any player to open the card.</div>
                        </div>
                        <div style={{ ...mono, color: 'var(--silver)', fontSize: '0.72rem' }}>{profiles.length} teams</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                        {profiles.map(profile => (
                            <div key={'capital-' + profile.rosterId} style={{ padding: '10px', borderRadius: '7px', background: profile.isMine ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid ' + (profile.isMine ? 'var(--acc-line1, rgba(212,175,55,0.26))' : 'var(--ov-4, rgba(255,255,255,0.06))') }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', marginBottom: '7px' }}>
                                    <div style={{ color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
                                    <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--silver)', fontSize: '0.72rem', fontWeight: 850 }}>{profile.totalAssets.toLocaleString()}</div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px' }}>
                                    <div>
                                        <div style={labelStyle}>Roster</div>
                                        <div style={{ ...mono, color: 'var(--white)', fontSize: '0.72rem', fontWeight: 850 }}>{profile.total.toLocaleString()}</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>Picks</div>
                                        <div style={{ ...mono, color: profile.pickCapital.totalValue >= focusProfile.pickCapital.totalValue ? 'var(--good)' : 'var(--silver)', fontSize: '0.72rem', fontWeight: 850 }}>{Math.round(profile.pickCapital.totalValue / 1000)}k</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.56 }}>{profile.pickCapital.count} picks</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>FAAB</div>
                                        <div style={{ ...mono, color: profile.faab.isFaab ? (profile.faab.remaining >= focusProfile.faab.remaining ? 'var(--good)' : 'var(--silver)') : 'var(--ov-8, rgba(255,255,255,0.32))', fontSize: '0.72rem', fontWeight: 850 }}>{profile.faab.isFaab ? '$' + profile.faab.remaining : '—'}</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.56 }}>{profile.faab.isFaab ? profile.faab.pct + '%' : 'No FAAB'}</div>
                                    </div>
                                </div>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58, marginTop: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    Best picks: {profile.pickCapital.topPicks.length ? profile.pickCapital.topPicks.slice(0, 2).map(p => p.label).join(' · ') : 'None'}
                                </div>
                            </div>
                        ))}
                    </div>
                    {positionBreakdowns.map(summary => {
                        const maxTotalAtPos = Math.max(1, ...summary.columns.map(col => col.total));
                        // Phone: up to 4 team columns of player cells can't fit 375 —
                        // panel becomes the horizontal scroll container and every row
                        // (header included) shares one explicit px minimum so team
                        // columns hold ≥140px instead of squishing.
                        const bdCols = summary.columns.length;
                        const bdGrid = isPhone ? ('40px repeat(' + bdCols + ', minmax(140px, 1fr))') : ('72px repeat(' + bdCols + ', minmax(0, 1fr))');
                        const bdMinW = isPhone ? (60 + bdCols * 148) + 'px' : undefined; // 40px label + N*(140+8px gap) + 20px row padding (border-box)
                        return (
                            <div key={'field-breakdown-' + summary.pos} style={{ ...panelStyle, marginBottom: '12px', ...(isPhone ? { overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' } : { overflow: 'hidden' }) }}>
                                <div style={{ padding: '10px', minWidth: bdMinW, background: (posColors[summary.pos] || 'var(--k-666666, #666666)') + '14', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.05))' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: bdGrid, gap: '8px', alignItems: 'end' }}>
                                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 900, color: posColors[summary.pos] || 'var(--silver)' }}>{posLabel(summary.pos)}</div>
                                        {summary.columns.map(column => {
                                            const isLeader = summary.leaderId === column.profile.rosterId;
                                            return (
                                                <div key={summary.pos + '-head-' + column.profile.rosterId} style={{ minWidth: 0 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', alignItems: 'baseline' }}>
                                                        <span style={{ color: column.profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{column.profile.name}</span>
                                                        <span style={{ ...mono, color: isLeader ? 'var(--good)' : 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 850 }}>{column.total.toLocaleString()}</span>
                                                    </div>
                                                    <div style={{ height: '4px', background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '3px', overflow: 'hidden', marginTop: '5px' }}>
                                                        <div style={{ width: (column.total / maxTotalAtPos * 100) + '%', height: '100%', background: isLeader ? 'var(--good)' : column.profile.isMine ? 'var(--gold)' : 'var(--k-7c6bf8, #7c6bf8)' }}></div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                {Array.from({ length: summary.maxLen }).map((_, rowIdx) => {
                                    const rowBestDhq = Math.max(0, ...summary.columns.map(column => column.players[rowIdx]?.dhq || 0));
                                    return (
                                        <div key={summary.pos + '-row-' + rowIdx} style={{ display: 'grid', gridTemplateColumns: bdGrid, minWidth: bdMinW, gap: '8px', padding: '7px 10px', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.035))', alignItems: 'stretch' }}>
                                            <div style={{ ...mono, color: 'var(--silver)', opacity: 0.56, fontSize: 'var(--text-micro, 0.6875rem)', alignSelf: 'center' }}>#{rowIdx + 1}</div>
                                            {summary.columns.map(column => (
                                                <div key={summary.pos + '-' + rowIdx + '-' + column.profile.rosterId} style={{ minWidth: 0 }}>
                                                    {renderFieldPlayerCell(column.players[rowIdx], column, rowBestDhq)}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            );
        };

        // Phone (P7): the Field Ranking re-pours as a shared sticky table —
        // the ≤767 column-drop (rankGridCols) is superseded by the full
        // column set inside a scoped .wr-sticky-table-wrap scroller with a
        // pinned #/team column, so no column is lost on phone. Values and
        // color logic mirror the desktop cells exactly.
        const renderPhoneRankTable = () => {
            const cols = '136px repeat(7, minmax(64px, 1fr))';
            const minW = '648px';
            const numCell = (v, color) => (
                <div style={{ ...mono, fontSize: '0.72rem', fontWeight: 800, color, textAlign: 'right', padding: '9px 8px 9px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{v}</div>
            );
            return (
                <div className="wr-sticky-table-wrap" style={{ background: 'var(--black)' }}>
                    <div className="wr-sticky-table">
                        <div style={{ display: 'grid', gridTemplateColumns: cols, minWidth: minW, borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.07))' }}>
                            <div className="wr-stick-col" style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '7px 8px 5px 10px' }}>Team</div>
                            {['Assets', 'Roster', 'Start', 'Picks', 'FAAB', 'Rooms', 'Edge'].map(txt => (
                                <div key={txt} style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.54, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right', padding: '7px 8px 5px 0', whiteSpace: 'nowrap' }}>{txt}</div>
                            ))}
                        </div>
                        {sortedProfiles.map((profile, idx) => {
                            const isFocus = sameId(profile.rosterId, focusProfile.rosterId);
                            const roomsWon = allPositions.filter(pos => (profile.posTotals[pos] || 0) > (focusProfile.posTotals[pos] || 0)).length;
                            const roomsLost = allPositions.filter(pos => (profile.posTotals[pos] || 0) < (focusProfile.posTotals[pos] || 0)).length;
                            const diff = profile.totalAssets - focusProfile.totalAssets;
                            return (
                                <div key={'ph-rank-' + profile.rosterId} style={{ display: 'grid', gridTemplateColumns: cols, minWidth: minW, alignItems: 'center', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.035))' }}>
                                    <div className="wr-stick-col" style={{ minWidth: 0, padding: '7px 8px 7px 10px', alignSelf: 'stretch' }}>
                                        <div style={{ color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 850, fontSize: '0.74rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>#{idx + 1} {profile.name}</div>
                                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.record} · {getDivisionName(profile.division)}</div>
                                    </div>
                                    {numCell(profile.totalAssets.toLocaleString(), profile.isMine ? 'var(--gold)' : 'var(--white)')}
                                    {numCell(profile.total.toLocaleString(), profile.isMine ? 'var(--gold)' : 'var(--white)')}
                                    {numCell(profile.starterTotal.toLocaleString(), 'var(--silver)')}
                                    {numCell(Math.round(profile.pickCapital.totalValue / 1000) + 'k', profile.pickCapital.totalValue >= focusProfile.pickCapital.totalValue ? 'var(--good)' : 'var(--silver)')}
                                    {numCell(profile.faab.isFaab ? '$' + profile.faab.remaining : '—', profile.faab.isFaab ? (profile.faab.remaining >= focusProfile.faab.remaining ? 'var(--good)' : 'var(--silver)') : 'var(--ov-8, rgba(255,255,255,0.32))')}
                                    {numCell(isFocus ? (profile.isMine ? 'You' : 'Focus') : roomsWon + '-' + roomsLost, isFocus ? 'var(--silver)' : roomsWon > roomsLost ? 'var(--bad)' : roomsWon < roomsLost ? 'var(--good)' : 'var(--silver)')}
                                    {numCell(isFocus ? (profile.topPlayer?.p?.full_name || 'Top player') : (diff > 0 ? '+' : '') + diff.toLocaleString(), isFocus ? (profile.isMine ? 'var(--gold)' : 'var(--silver)') : diff > 0 ? 'var(--bad)' : 'var(--good)')}
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        };

        return (
            <div>
                <div style={{ ...panelStyle, padding: '18px 20px', marginBottom: '14px', background: 'linear-gradient(135deg, var(--acc-fill1, rgba(212,175,55,0.055)), rgba(52,152,219,0.045))' }}>
                    {isPhone ? (
                        // Phone (owner ask): lead with the tier verdict, then rank
                        // + strongest/weakest room — no floating right-aligned block.
                        <div style={{ marginBottom: '14px' }}>
                            <div style={labelStyle}>{fieldLabel}</div>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.55rem', fontWeight: 850, color: fieldReadColor, letterSpacing: 0, lineHeight: 1.08, margin: '2px 0 5px' }}>{fieldRead}</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--silver)' }}>{fieldLead} vs {comparisonProfiles.length}-team field · <b style={{ color: 'var(--white)' }}>#{focusRank} of {profiles.length}</b></div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--silver)', marginTop: '5px' }}>Strongest room <b style={{ color: 'var(--good)' }}>{strongest ? posLabel(strongest.pos) : '—'}</b> · Weakest room <b style={{ color: 'var(--bad)' }}>{weakest ? posLabel(weakest.pos) : '—'}</b></div>
                        </div>
                    ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '14px' }}>
                        <div>
                            <div style={labelStyle}>{fieldLabel}</div>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.35rem', color: 'var(--white)', fontWeight: 850, letterSpacing: 0 }}>{fieldLead} vs {comparisonProfiles.length} team field</div>
                            <div style={{ fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.72 }}>{fieldSub}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={labelStyle}>Field Read</div>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', fontWeight: 850, color: fieldReadColor, letterSpacing: 0 }}>
                                {fieldRead}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.7 }}>
                                Strongest room: {strongest ? posLabel(strongest.pos) : 'Roster'}; weakest room: {weakest ? posLabel(weakest.pos) : 'depth'}.
                            </div>
                        </div>
                    </div>
                    )}
                    {/* Phone (P4): the KPI cards ride a horizontally snapping
                        .wr-kpi-strip instead of a stacked grid. */}
                    <div className={isPhone ? 'wr-kpi-strip' : undefined} style={isPhone ? undefined : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '9px' }}>
                        {fieldCards.map(card => (
                            <div key={card.label} style={{ padding: '10px', background: 'rgba(0,0,0,0.24)', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: '7px', ...(isPhone ? { width: '156px' } : null) }}>
                                <div style={labelStyle}>{card.label}</div>
                                <div style={{ ...mono, fontSize: '1rem', color: card.color, fontWeight: 850, marginTop: '5px' }}>{card.value}</div>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.66, marginTop: '2px' }}>{card.sub}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))', gap: '14px', marginBottom: '14px' }}>
                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline', marginBottom: '12px' }}>
                            <div>
                                <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', fontWeight: 850, color: 'var(--white)', letterSpacing: 0 }}>Field Ranking</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.66 }}>Roster value, starter value, draft capital, FAAB, and best player.</div>
                            </div>
                            <div style={{ ...mono, color: 'var(--gold)', fontWeight: 850 }}>{profiles.length} teams</div>
                        </div>
                        {isPhone ? renderPhoneRankTable() : (
                        <div style={{ display: 'grid', gap: '7px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: rankGridCols, gap: '8px', padding: '0 9px 2px', fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.54, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                <span>#</span><span>Team</span><span>Assets</span>{isPhone ? null : <React.Fragment><span>Roster</span><span>Start</span><span>Picks</span><span>FAAB</span><span>Rooms</span></React.Fragment>}<span>Edge</span>
                            </div>
                            {sortedProfiles.map((profile, idx) => {
                                const isFocus = sameId(profile.rosterId, focusProfile.rosterId);
                                const roomsWon = allPositions.filter(pos => (profile.posTotals[pos] || 0) > (focusProfile.posTotals[pos] || 0)).length;
                                const roomsLost = allPositions.filter(pos => (profile.posTotals[pos] || 0) < (focusProfile.posTotals[pos] || 0)).length;
                                const diff = profile.totalAssets - focusProfile.totalAssets;
                                return (
                                    <div key={profile.rosterId} style={{ display: 'grid', gridTemplateColumns: rankGridCols, gap: '8px', alignItems: 'center', padding: '8px 9px', borderRadius: '7px', background: profile.isMine ? 'var(--acc-fill2, rgba(212,175,55,0.11))' : 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid ' + (profile.isMine ? 'var(--acc-line2, rgba(212,175,55,0.35))' : 'var(--ov-4, rgba(255,255,255,0.055))'), fontSize: '0.72rem' }}>
                                        <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--silver)', fontWeight: 850 }}>#{idx + 1}</div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
                                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62 }}>{getDivisionName(profile.division)} - {profile.record}</div>
                                        </div>
                                        <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 800 }}>{profile.totalAssets.toLocaleString()}</div>
                                        {isPhone ? null : <React.Fragment>
                                        <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 800 }}>{profile.total.toLocaleString()}</div>
                                        <div>
                                            <div style={{ ...mono, color: 'var(--silver)', fontWeight: 800 }}>{profile.starterTotal.toLocaleString()}</div>
                                            <div style={{ height: '3px', background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '2px', marginTop: '4px', overflow: 'hidden' }}><div style={{ width: (profile.starterTotal / maxStarter * 100) + '%', height: '100%', background: profile.isMine ? 'var(--gold)' : 'var(--k-7c6bf8, #7c6bf8)' }}></div></div>
                                        </div>
                                        <div style={{ ...mono, color: profile.pickCapital.totalValue >= focusProfile.pickCapital.totalValue ? 'var(--good)' : 'var(--silver)', fontWeight: 800 }}>{Math.round(profile.pickCapital.totalValue / 1000)}k</div>
                                        <div style={{ ...mono, color: profile.faab.isFaab ? (profile.faab.remaining >= focusProfile.faab.remaining ? 'var(--good)' : 'var(--silver)') : 'var(--ov-8, rgba(255,255,255,0.32))', fontWeight: 800 }}>{profile.faab.isFaab ? '$' + profile.faab.remaining : '—'}</div>
                                        <div style={{ color: isFocus ? 'var(--silver)' : roomsWon > roomsLost ? 'var(--bad)' : roomsWon < roomsLost ? 'var(--good)' : 'var(--silver)' }}>
                                            {isFocus ? (profile.isMine ? 'You' : 'Focus') : roomsWon + '-' + roomsLost}
                                        </div>
                                        </React.Fragment>}
                                        <div style={{ minWidth: 0, color: isFocus ? (profile.isMine ? 'var(--gold)' : 'var(--silver)') : diff > 0 ? 'var(--bad)' : 'var(--good)', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {isFocus ? (profile.topPlayer?.p?.full_name || 'Top player') : (diff > 0 ? '+' : '') + diff.toLocaleString()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        )}
                    </div>

                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', fontWeight: 850, color: 'var(--white)', letterSpacing: 0, marginBottom: '12px' }}>Position Heatmap</div>
                        {/* Phone (≤767): the grid's 456px track minimum can't fit — the grid
                            itself becomes the scroll container with a sticky team column
                            (My Roster pattern; zebra differs here, so each sticky cell paints
                            its translucent fill over an opaque --black underlay instead of
                            background:'inherit'). Tablet/desktop: identical to before. */}
                        {isPhone ? (() => {
                            // Phone: the 9-column grid is unreadable at 375px, so
                            // pivot to a position toggle + a ranked team leaderboard
                            // for the picked position (owner ask). Desktop keeps the
                            // grid (the else branch below, untouched).
                            const activePos = (heatPos && allPositions.includes(heatPos)) ? heatPos : allPositions[0];
                            const ranked = [...sortedProfiles].sort((a, b) => (b.posTotals[activePos] || 0) - (a.posTotals[activePos] || 0));
                            const maxV = maxByPos[activePos] || 1;
                            const myRank = ranked.findIndex(p => p.isMine) + 1;
                            return (
                            <React.Fragment>
                                <div className="wr-hscroll" style={{ display: 'flex', gap: '6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '6px' }}>
                                    {allPositions.map(pos => { const on = pos === activePos, c = posColors[pos] || 'var(--silver)'; return <button key={pos} onClick={() => setHeatPos(pos)} style={{ flex: 'none', minHeight: '40px', padding: '7px 13px', borderRadius: '8px', ...mono, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', color: on ? c : 'var(--silver)', background: on ? 'rgba(255,255,255,0.06)' : 'transparent', border: '1px solid ' + (on ? c : 'var(--ov-6, rgba(255,255,255,0.12))') }}>{posLabel(pos)}</button>; })}
                                </div>
                                <div style={{ fontSize: '0.76rem', color: 'var(--silver)', margin: '2px 2px 8px', lineHeight: 1.4 }}>Every team's <b style={{ color: posColors[activePos] || 'var(--white)' }}>{posLabel(activePos)}</b> value{myRank > 0 ? <React.Fragment> — you rank <b style={{ color: 'var(--gold)' }}>#{myRank} of {ranked.length}</b></React.Fragment> : ''}.</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {ranked.map((p, i) => { const val = p.posTotals[activePos] || 0, isLead = i === 0; const barC = p.isMine ? 'var(--gold)' : isLead ? 'var(--good)' : 'var(--k-7c6bf8, #7c6bf8)'; return (
                                        <div key={p.rosterId} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', borderRadius: '8px', background: p.isMine ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid ' + (p.isMine ? 'rgba(212,175,55,0.4)' : 'var(--ov-4, rgba(255,255,255,0.06))') }}>
                                            <span style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: p.isMine ? 'var(--gold)' : 'var(--text-muted, #8B8B96)', minWidth: '20px' }}>{i + 1}</span>
                                            <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: 600, color: p.isMine ? 'var(--gold)' : 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                            {isLead ? <span style={{ ...mono, fontSize: '0.56rem', fontWeight: 800, color: 'var(--good)', letterSpacing: '0.06em' }}>TOP</span> : null}
                                            <div style={{ flex: '0 0 82px', height: '6px', background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '3px', overflow: 'hidden' }}><div style={{ width: (val / maxV * 100) + '%', height: '100%', background: barC }} /></div>
                                            <span style={{ ...mono, fontSize: '0.78rem', fontWeight: 700, color: p.isMine ? 'var(--gold)' : 'var(--silver)', minWidth: '34px', textAlign: 'right' }}>{Math.round(val / 1000)}k</span>
                                        </div>
                                    ); })}
                                </div>
                            </React.Fragment>
                            );
                        })() : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(112px,1.2fr) repeat(8,minmax(38px,1fr))', gap: '5px', alignItems: 'stretch' }}>
                            <div style={{ ...labelStyle }}>Team</div>
                            {allPositions.map(pos => <div key={pos} style={{ ...labelStyle, textAlign: 'center', color: posColors[pos] || 'var(--silver)' }}>{posLabel(pos)}</div>)}
                            {sortedProfiles.map(profile => {
                                const teamFill = profile.isMine ? 'var(--acc-fill2, rgba(212,175,55,0.11))' : 'var(--ov-2, rgba(255,255,255,0.025))';
                                return (
                                <React.Fragment key={'hm-' + profile.rosterId}>
                                    <div style={{ padding: '7px 6px', borderRadius: '5px', background: teamFill, color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
                                    {allPositions.map(pos => {
                                        const val = profile.posTotals[pos] || 0;
                                        const isBest = bestByPos[pos] === profile.rosterId;
                                        const isMine = profile.isMine;
                                        return (
                                            <div key={profile.rosterId + '-' + pos} title={profile.name + ' ' + pos + ': ' + val.toLocaleString()} style={{ padding: '6px 5px', borderRadius: '5px', background: isBest ? 'rgba(46,204,113,0.14)' : isMine ? 'var(--acc-fill2, rgba(212,175,55,0.09))' : 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid ' + (isBest ? 'rgba(46,204,113,0.22)' : 'var(--ov-3, rgba(255,255,255,0.04))'), textAlign: 'center' }}>
                                                <div style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', color: isBest ? 'var(--good)' : isMine ? 'var(--gold)' : 'var(--silver)', fontWeight: 800 }}>{Math.round(val / 1000)}k</div>
                                                <div style={{ height: '3px', background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '2px', marginTop: '4px', overflow: 'hidden' }}><div style={{ width: (val / maxByPos[pos] * 100) + '%', height: '100%', background: isBest ? 'var(--good)' : isMine ? 'var(--gold)' : 'var(--k-7c6bf8, #7c6bf8)' }}></div></div>
                                            </div>
                                        );
                                    })}
                                </React.Fragment>
                                );
                            })}
                        </div>
                        )}
                    </div>
                </div>

                {renderFieldRosterBreakdown()}

                {divisionKeys.length > 1 && (compareScope === 'division' || compareScope === 'league') ? (
                    <div style={{ ...panelStyle, padding: '14px', marginBottom: '14px' }}>
                        <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', fontWeight: 850, color: 'var(--white)', letterSpacing: 0, marginBottom: '10px' }}>Division Boards</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                            {Object.entries(divisionProfiles).sort(([a], [b]) => Number(a) - Number(b)).map(([key, list]) => (
                                <div key={key} style={{ padding: '10px', borderRadius: '7px', background: 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                                    <div style={{ color: 'var(--gold)', fontWeight: 850, marginBottom: '8px' }}>{getDivisionName(key)}</div>
                                    {[...list].sort((a, b) => b.total - a.total).map((p, idx) => (
                                        <div key={p.rosterId} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: '7px', alignItems: 'center', padding: '5px 0', borderTop: idx ? '1px solid var(--ov-3, rgba(255,255,255,0.045))' : 'none' }}>
                                            <div style={{ ...mono, color: p.isMine ? 'var(--gold)' : 'var(--silver)' }}>#{idx + 1}</div>
                                            <div style={{ color: p.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                                            <div style={{ ...mono, color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)' }}>{p.total.toLocaleString()}</div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}

                {/* Team-card field grid — redundant with the phone rank table
                    above, so desktop-only on phone (owner ask). */}
                {!isPhone && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px' }}>
                    {profiles.map(renderTeamChip)}
                </div>
                )}
            </div>
        );
    };

    // ── Players mode ─────────────────────────────────────────────────────────
    // Straight player-vs-player: up to 4 players, each as a focused compare card
    // anchored on DHQ, laid out across four quadrants. Best value in each row is
    // highlighted across the field.
    const renderPlayerSearch = () => {
        const q = playerQuery.trim().toLowerCase();
        let results = [];
        if (q.length >= 2) {
            const seen = new Set(comparePlayerIds.map(String));
            for (const pid of Object.keys(playersData || {})) {
                const p = playersData[pid];
                if (!p) continue;
                const pos = normPos(p.position);
                if (!allPositions.includes(pos)) continue;
                const nm = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
                if (!nm || !nm.toLowerCase().includes(q)) continue;
                if (seen.has(String(pid))) continue;
                results.push({ pid, name: nm, pos, team: p.team || 'FA', dhq: scores[pid] || scores[String(pid)] || 0 });
            }
            results.sort((a, b) => b.dhq - a.dhq);
            results = results.slice(0, 8);
        }
        const atMax = comparePlayerIds.length >= 4;
        return (
            <div style={{ position: 'relative', minWidth: '230px', flex: '1 1 340px', maxWidth: '640px' }}>
                <input
                    ref={playerSearchRef}
                    value={playerQuery}
                    onChange={e => setPlayerQuery(e.target.value)}
                    placeholder={atMax ? 'Four players max — remove one to swap' : 'Search a player to compare…'}
                    disabled={atMax}
                    style={{ ...selectStyle, width: '100%', opacity: atMax ? 0.5 : 1 }}
                />
                {results.length ? (
                    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 40, background: 'var(--black, #0b0b0d)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.32))', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 14px 34px rgba(0,0,0,0.55)' }}>
                        {results.map(r => (
                            <button key={r.pid} onClick={() => addComparePlayer(r.pid)} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '9px', padding: '8px 10px', minHeight: isPhone ? '44px' : undefined, background: 'transparent', border: 'none', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))', cursor: 'pointer', textAlign: 'left' }}>
                                <img src={'https://sleepercdn.com/content/nfl/players/thumb/' + r.pid + '.jpg'} onError={e => e.target.style.display = 'none'} style={{ width: '26px', height: '26px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                                <span style={{ flex: 1, minWidth: 0, color: 'var(--white)', fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: posColors[r.pos] || 'var(--silver)', fontWeight: 800 }}>{posLabel(r.pos)} · {r.team}</span>
                                <span style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', fontWeight: 800 }}>{r.dhq > 0 ? r.dhq.toLocaleString() : '—'}</span>
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    };

    const renderPlayerCompare = () => {
        const ids = comparePlayerIds.map(String).slice(0, 4);
        const enrichComparePlayer = (pid) => {
            const base = enrichFieldPlayer(pid);
            if (!base) return { pid: String(pid), missing: true };
            const meta = window.App?.LI?.playerMeta?.[pid] || window.App?.LI?.playerMeta?.[String(pid)] || {};
            // Free: rec stays null — the seeded fallback is a rec too. The
            // Action row/chip consumers render Pro-only below.
            const pa = isPro && typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
            const trend = meta.trend || 0;
            const rec = !isPro ? null : pa ? String(pa.label).toUpperCase()
                : (base.valueYrs <= 0 && trend <= -10 ? 'SELL NOW' : base.valueYrs <= 0 ? 'SELL' : base.peakYrs <= 1 ? 'SELL' : base.dhq >= 7000 && base.peakYrs >= 3 ? 'HOLD CORE' : 'HOLD');
            const recCol = rec && rec.includes('SELL') ? 'var(--bad)' : rec && rec.includes('BUY') ? 'var(--good)' : 'var(--gold)';
            const curve = typeof window.App?.getAgeCurve === 'function' ? window.App.getAgeCurve(base.pos) : { peak: [24, 29], decline: [30, 32] };
            const pLo = (curve.peak && curve.peak[0]) || 24;
            const pHi = (curve.peak && curve.peak[1]) || 29;
            const declineHi = (curve.decline && curve.decline[1]) || 32;
            const age = base.age || 0;
            const phase = !age ? { label: '—', color: 'var(--silver)' }
                : age < pLo ? { label: 'Rising', color: 'var(--good)' }
                : age <= pHi ? { label: 'Prime', color: 'var(--gold)' }
                : age <= declineHi ? { label: 'Veteran', color: 'var(--k-f0a500, #f0a500)' }
                : { label: 'Post-Window', color: 'var(--bad)' };
            const ctx = meta.statusReason
                ? (meta.statusReason + (meta.roleLabel ? ' · ' + meta.roleLabel : ''))
                : [meta.roleLabel, meta.opportunityLabel].filter(Boolean).join(' · ');
            const depthChart = (typeof base.p?.depth_chart_order === 'number') ? (base.pos + (base.p.depth_chart_order + 1)) : null;
            return {
                ...base,
                meta, rec, recCol, phase, ctx, depthChart,
                trend,
                tier: tierLabelFromDhq(base.dhq),
                posRank: posRankMap[String(pid)] || null,
                ageCurve: { lo: pLo, peakHi: pHi, declineHi },
                htWt: [base.p?.height, base.p?.weight].filter(Boolean).join(' / '),
                college: base.p?.college || '',
                name: base.p?.full_name || (base.p ? ((base.p.first_name || '') + ' ' + (base.p.last_name || '')).trim() : 'Unknown'),
            };
        };
        const players = ids.map(enrichComparePlayer);
        const valid = players.filter(pl => !pl.missing);
        const multi = valid.length > 1;
        const maxDhq = Math.max(0, ...valid.map(p => p.dhq || 0));
        const maxPpg = Math.max(0, ...valid.map(p => p.ppg || 0));
        const maxRunway = Math.max(0, ...valid.map(p => p.valueYrs || 0));
        const bestRank = Math.min(Infinity, ...valid.filter(p => p.posRank).map(p => p.posRank));
        const leader = valid.slice().sort((a, b) => (b.dhq || 0) - (a.dhq || 0))[0] || null;

        const statRow = (label, value, isBest, valueColor) => (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.66, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                <span style={{ ...mono, fontWeight: 850, fontSize: '0.82rem', color: valueColor || (isBest ? 'var(--good)' : 'var(--white)') }}>
                    {value}{isBest ? <span style={{ marginLeft: '5px', fontSize: '0.6rem', color: 'var(--good)' }}>▲</span> : null}
                </span>
            </div>
        );

        const renderCompareCard = (pl, idx) => {
            if (!pl || pl.missing) {
                return (
                    <div key={'cmp-missing-' + (pl?.pid || idx)} style={{ ...panelStyle, padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '260px', gap: '10px', textAlign: 'center' }}>
                        <div style={{ color: 'var(--silver)', fontSize: '0.82rem', opacity: 0.8 }}>This player isn't in the value pool yet.</div>
                        <button onClick={() => removeComparePlayer(pl?.pid)} style={smallButtonStyle(false)}>Remove</button>
                    </div>
                );
            }
            const dhqCol = pl.dhq >= 7000 ? 'var(--good)' : pl.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : pl.dhq >= 1000 ? 'var(--silver)' : 'var(--ov-9, rgba(255,255,255,0.5))';
            const isLeader = multi && leader && String(leader.pid) === String(pl.pid);
            return (
                <div key={'cmp-' + pl.pid} style={{ ...panelStyle, padding: 0, overflow: 'hidden', position: 'relative', border: isLeader ? '1px solid var(--acc-line3, rgba(212,175,55,0.46))' : panelStyle.border }}>
                    <button className="cmp-remove-x" title="Remove from compare" onClick={() => removeComparePlayer(pl.pid)} style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2, width: '26px', height: '26px', borderRadius: '6px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: 'rgba(0,0,0,0.42)', color: 'var(--silver)', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1 }}>×</button>
                    <div
                        role="button"
                        tabIndex={0}
                        title="Open full player card"
                        onClick={() => openPlayerCard(pl.pid)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayerCard(pl.pid); } }}
                        style={{ padding: '14px 14px 12px', cursor: 'pointer', background: isLeader ? 'var(--acc-fill1, rgba(212,175,55,0.06))' : 'var(--ov-1, rgba(255,255,255,0.02))', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.05))' }}
                    >
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', minWidth: 0 }}>
                            <img src={'https://sleepercdn.com/content/nfl/players/thumb/' + pl.pid + '.jpg'} onError={e => e.target.style.display = 'none'} style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid ' + (posColors[pl.pos] || 'var(--silver)') }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                    <div style={{ fontFamily: 'var(--font-title)', color: 'var(--white)', fontWeight: 850, fontSize: '0.98rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.name}</div>
                                    {isLeader ? <span style={{ ...mono, fontSize: '0.56rem', fontWeight: 850, color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', borderRadius: '4px', padding: '1px 5px', letterSpacing: '0.04em', flexShrink: 0 }}>DHQ LEAD</span> : null}
                                </div>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.72, marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    <span style={{ color: posColors[pl.pos] || 'var(--silver)', fontWeight: 800 }}>{posLabel(pl.pos)}</span> · {pl.team}{pl.age ? ' · ' + pl.age + 'yo' : ''}{pl.yrsExp != null ? ' · ' + pl.yrsExp + 'y exp' : ''}
                                </div>
                            </div>
                        </div>
                        <div style={{ marginTop: '12px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px' }}>
                            <div style={{ minWidth: 0 }}>
                                <div style={labelStyle}>{valueLabel}</div>
                                <div style={{ ...mono, fontSize: '1.7rem', fontWeight: 850, color: dhqCol, lineHeight: 1 }}>{pl.dhq > 0 ? pl.dhq.toLocaleString() : '—'}</div>
                            </div>
                            <span style={{ ...mono, fontSize: '0.78rem', fontWeight: 850, color: pl.tier.color, flexShrink: 0 }}>{pl.tier.label}</span>
                        </div>
                        <div style={{ height: '5px', background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '3px', overflow: 'hidden', marginTop: '8px' }}>
                            <div style={{ width: (maxDhq > 0 ? (pl.dhq / maxDhq * 100) : 0) + '%', height: '100%', background: dhqCol }}></div>
                        </div>
                    </div>
                    <div style={{ padding: '4px 14px 13px' }}>
                        {statRow('PPG', pl.ppg > 0 ? pl.ppg : '—', multi && pl.ppg > 0 && pl.ppg === maxPpg)}
                        {statRow('Runway', pl.valueYrs > 0 ? pl.valueYrs + 'yr' : '—', multi && pl.valueYrs > 0 && pl.valueYrs === maxRunway)}
                        {statRow('Window', pl.phase.label, false, pl.phase.color)}
                        {statRow('Pos Rank', pl.posRank ? (posLabel(pl.pos) + ' #' + pl.posRank) : '—', multi && pl.posRank && pl.posRank === bestRank)}
                        {isPro ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', paddingTop: '9px', marginTop: '3px', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                            <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.66, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action</span>
                            <span style={{ ...mono, fontWeight: 850, fontSize: '0.72rem', color: pl.recCol, border: '1px solid ' + pl.recCol, borderRadius: '4px', padding: '2px 7px' }}>{pl.rec}</span>
                        </div>
                        ) : null}
                        {pl.ctx ? <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '8px', lineHeight: 1.4 }}>{pl.ctx}</div> : null}
                    </div>
                </div>
            );
        };

        const renderGhostCell = (idx) => (
            <button key={'ghost-' + idx} onClick={() => playerSearchRef.current && playerSearchRef.current.focus()} style={{ ...panelStyle, minHeight: '260px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', color: 'var(--silver)', borderStyle: 'dashed', background: 'var(--ov-1, rgba(255,255,255,0.015))' }}>
                <div style={{ fontSize: '1.7rem', opacity: 0.4, fontWeight: 300 }}>+</div>
                <div style={{ fontSize: '0.8rem', opacity: 0.74, fontWeight: 700 }}>Add a player</div>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.5, maxWidth: '180px', textAlign: 'center', lineHeight: 1.4 }}>Search above, or hit Compare on any player card</div>
            </button>
        );

        // Phone (P1): picked players render as WR.AssetRows. The ✕ drives the
        // EXACT same removeComparePlayer as the desktop card/hero ✕ buttons;
        // row tap opens the full player card (same openPlayerCard seam). The
        // LEAD chip mirrors the ungated desktop "DHQ LEAD" chip — raw data,
        // no gate movement.
        const phoneRemoveX = (pid) => (
            <button className="cmp-remove-x" title="Remove from compare"
                onClick={(e) => { e.stopPropagation(); removeComparePlayer(pid); }}
                style={{ position: 'relative', width: '26px', height: '26px', borderRadius: '6px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: 'rgba(0,0,0,0.42)', color: 'var(--silver)', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, flexShrink: 0, padding: 0 }}>×</button>
        );
        const renderPhoneFieldRows = () => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                {players.map((pl, idx) => {
                    if (!pl || pl.missing) {
                        return (
                            <WrAssetRow key={'ph-missing-' + (pl?.pid || idx)} pos="?" name="Not in the value pool yet"
                                tag="Remove to swap in another player"
                                slots={[{ label: valueShortLabel, value: '—', tone: 'mute' }]}
                                verdict={phoneRemoveX(pl?.pid)} />
                        );
                    }
                    const isLeader = multi && leader && String(leader.pid) === String(pl.pid);
                    return (
                        <WrAssetRow key={'ph-' + pl.pid} pos={pl.pos} name={pl.name}
                            tag={[pl.team, pl.age ? pl.age + 'yo' : null, pl.posRank ? posLabel(pl.pos) + ' #' + pl.posRank : null, pl.tier.label].filter(Boolean).join(' · ')}
                            slots={[{ label: valueShortLabel, value: pl.dhq > 0 ? pl.dhq.toLocaleString() : '—', tone: isLeader ? 'gold' : undefined }]}
                            verdict={<React.Fragment>
                                {isLeader ? <span style={{ fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: '0.56rem', fontWeight: 700, color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', borderRadius: '4px', padding: '2px 5px', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>LEAD</span> : null}
                                {phoneRemoveX(pl.pid)}
                            </React.Fragment>}
                            accent={isLeader ? 'gold' : undefined}
                            onClick={() => openPlayerCard(pl.pid)} />
                    );
                })}
            </div>
        );

        if (!valid.length && !players.length) {
            const myTopForQuick = (myRoster?.players || []).map(enrichFieldPlayer).filter(Boolean).sort((a, b) => b.dhq - a.dhq).slice(0, 4);
            return (
                <div style={{ ...panelStyle, padding: '30px 28px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', color: 'var(--white)', fontWeight: 800, marginBottom: '7px', letterSpacing: 0 }}>Compare players head-to-head</div>
                    <div style={{ fontSize: '0.86rem', color: 'var(--silver)', lineHeight: 1.55, maxWidth: '560px', margin: '0 auto 16px' }}>
                        {isPhone
                            ? 'Add up to four players to compare their ' + valueLabel + ' and key signals side by side. Tap Add player above to search by name, position, or owning team.'
                            : <React.Fragment>Add up to four players to see their {valueLabel} and key signals side by side across four quadrants. Search above, hit <strong style={{ color: 'var(--gold)' }}>Compare</strong> on any player card, or start with your top players:</React.Fragment>}
                    </div>
                    {/* Quick-start top-player cards — desktop only (owner ask); phone uses the search. */}
                    {!isPhone && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {myTopForQuick.length ? myTopForQuick.map(pl => (
                            <button key={pl.pid} onClick={() => addComparePlayer(pl.pid)} style={quickButtonStyle(false)}>
                                <div style={{ fontWeight: 850, color: 'var(--white)' }}>{pl.p?.full_name || '?'}</div>
                                <div style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.66, marginTop: '2px' }}>{pl.dhq.toLocaleString()} {valueShortLabel}</div>
                            </button>
                        )) : <div style={{ fontSize: '0.8rem', color: 'var(--silver)', opacity: 0.6 }}>Use the search above to add players.</div>}
                    </div>
                    )}
                </div>
            );
        }

        const isRedraft = (resolvedLeagueSkin?.type === 'redraft');

        // 2–4 players → one comparison matrix: players are columns, metrics are
        // rows, with per-row winners (▲ + gap-to-best), a field verdict, a value
        // share bar, and side-by-side age curves. Scales the head-to-head look
        // across the whole field.
        const renderComparisonMatrix = (list) => {
            const N = list.length;
            const depthOrd = (pl) => (typeof pl.p?.depth_chart_order === 'number') ? pl.p.depth_chart_order + 1 : 0;
            const trendDisp = (pl) => pl.trend ? ((pl.trend > 0 ? '↑ +' : '↓ ') + pl.trend) : 'Flat';
            // Phone (≤767): minmax(0,1fr) player columns compress to ~60px at 375
            // instead of engaging the scroll container — hold a 110px floor per
            // player column (two players still fit a 375 side-by-side; 3–4 scroll)
            // and pin the metric-label column sticky-left. Desktop/tablet: unchanged.
            const gt = isPhone
                ? 'minmax(84px, 0.62fr) repeat(' + N + ', minmax(110px, 1fr))'
                // Desktop/tablet: a matching spacer column on the RIGHT balances the
                // left metric-label column, so the players sit centered instead of
                // shifted right. (Phone scrolls, so it keeps the label-only layout.)
                : 'minmax(94px, 0.62fr) repeat(' + N + ', minmax(0, 1fr)) minmax(94px, 0.62fr)';
            // Explicit px floor so every row spans the full scroll width (row
            // borders stay continuous mid-scroll): 84px label + N*(110px + 10px gap).
            const rowMinW = isPhone ? (84 + N * 120) + 'px' : undefined;
            const fieldMaxDhq = Math.max(0, ...list.map(p => p.dhq || 0));

            // Metric defs. dir high/low picks the winner; numeric rows also print a
            // gap-to-best under non-winners; countable rows feed the "leads N" tally.
            const mk = (label, dir, valFn, dispFn, opts) => {
                opts = opts || {};
                return {
                    label, dir,
                    values: list.map(valFn),
                    display: list.map((p, i) => dispFn(p, valFn(p), i)),
                    colors: opts.colors ? list.map(opts.colors) : null,
                    numeric: !!opts.numeric, countable: !!opts.countable, gapFmt: opts.gapFmt, wrap: !!opts.wrap,
                };
            };
            const metrics = [
                mk(valueShortLabel, 'high', p => p.dhq, (p, v) => v > 0 ? v.toLocaleString() : '—', { numeric: true, countable: true, gapFmt: n => n.toLocaleString() }),
                mk('Pos Rank', 'low', p => p.posRank || 0, (p, v) => v ? (posLabel(p.pos) + ' #' + v) : '—', { countable: true }),
                mk('Tier', 'none', p => p.dhq, (p) => p.tier.label, { colors: p => p.tier.color }),
                mk('PPG', 'high', p => p.ppg || 0, (p, v) => v > 0 ? v : '—', { numeric: true, countable: true, gapFmt: n => n.toFixed(1) }),
                mk('PPG Trend', 'high', p => p.trend || 0, (p) => trendDisp(p), { countable: true }),
                mk('Age', isRedraft ? 'none' : 'low', p => p.age || 0, (p, v) => v ? v + 'yo' : '—'),
                mk('Dynasty Runway', isRedraft ? 'none' : 'high', p => p.valueYrs || 0, (p, v) => v > 0 ? v + 'yr' : '—', { countable: !isRedraft }),
                mk('Peak Left', isRedraft ? 'none' : 'high', p => p.peakYrs || 0, (p, v) => v > 0 ? v + 'yr' : '—', { countable: !isRedraft }),
                mk('Window', 'none', p => 0, (p) => p.phase.label, { colors: p => p.phase.color }),
                mk('Experience', 'none', p => p.yrsExp || 0, (p, v) => v + 'y'),
                mk('Depth Chart', 'low', p => depthOrd(p), (p) => p.depthChart || '—'),
                mk('Size', 'none', p => 0, (p) => p.htWt || '—'),
                // Action = buy/sell verdict row → Pro; free compares raw values.
                ...(isPro ? [mk('Action', 'none', p => 0, (p) => p.rec, { colors: p => p.recCol })] : []),
            ];
            if (list.some(p => p.ctx)) metrics.push(mk('Context', 'none', p => 0, (p) => p.ctx || '—', { wrap: true }));

            const winnersOf = (m) => {
                const out = new Set();
                if (m.dir === 'none') return out;
                const vals = m.values.map(v => Number(v) || 0);
                if (m.dir === 'high') {
                    const best = Math.max(...vals);
                    if (best > 0) vals.forEach((v, i) => { if (v === best) out.add(i); });
                } else {
                    const pos = vals.filter(v => v > 0);
                    if (pos.length) { const best = Math.min(...pos); vals.forEach((v, i) => { if (v > 0 && v === best) out.add(i); }); }
                }
                return out;
            };
            // "Leads N" per player = unique wins across the countable categories.
            const leads = {};
            list.forEach(p => { leads[p.pid] = 0; });
            metrics.filter(m => m.countable).forEach(m => {
                const w = winnersOf(m);
                if (w.size === 1) leads[list[[...w][0]].pid] += 1;
            });

            // Field verdict.
            const byVal = [...list].sort((x, y) => (y.dhq || 0) - (x.dhq || 0));
            const top = byVal[0], second = byVal[1];
            const valGap = (top.dhq || 0) - (second?.dhq || 0);
            const byRunway = [...list].sort((x, y) => (y.valueYrs || 0) - (x.valueYrs || 0));
            const runwayLeader = byRunway[0];
            // Only claim "longest window/runway" when it's strictly longest and non-zero.
            const runwayIsClear = (runwayLeader.valueYrs || 0) > 0 && (runwayLeader.valueYrs || 0) > (byRunway[1]?.valueYrs || 0);
            let verdict;
            if (isRedraft) {
                verdict = valGap > 0
                    ? `${top.name} is the top play of the ${N} — +${valGap.toLocaleString()} ${valueShortLabel} on the next-best.`
                    : `${top.name} leads a tight field — separated by weekly scoring, not value.`;
            } else if (valGap === 0) {
                verdict = runwayIsClear
                    ? `Dead even on ${valueShortLabel} at the top — ${runwayLeader.name} has the longest runway (${runwayLeader.valueYrs}yr).`
                    : `Dead even on ${valueShortLabel} at the top — nothing separates the field on value.`;
            } else if (runwayLeader.pid === top.pid) {
                verdict = `${top.name} leads the field — top ${valueShortLabel}${runwayIsClear ? `, and the longest window (${top.valueYrs}yr)` : ''}.`;
            } else {
                verdict = runwayIsClear
                    ? `${top.name} tops the field on value (+${valGap.toLocaleString()}), but ${runwayLeader.name} has the longest runway (${runwayLeader.valueYrs}yr) — value now vs upside later.`
                    : `${top.name} tops the field on value (+${valGap.toLocaleString()}).`;
            }

            const totalVal = list.reduce((s, p) => s + (p.dhq || 0), 0);

            const heroCol = (pl) => {
                const isLead = (pl.dhq || 0) === fieldMaxDhq && fieldMaxDhq > 0;
                const dhqCol = pl.dhq >= 7000 ? 'var(--good)' : pl.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : pl.dhq >= 1000 ? 'var(--silver)' : 'var(--ov-9, rgba(255,255,255,0.5))';
                const k = leads[pl.pid] || 0;
                return (
                    <div key={'hero-' + pl.pid} style={{ position: 'relative', textAlign: 'center', padding: '2px 2px 0', minWidth: 0 }}>
                        <button className="cmp-remove-x" title="Remove from compare" onClick={() => removeComparePlayer(pl.pid)} style={{ position: 'absolute', top: 0, right: 0, width: '22px', height: '22px', borderRadius: '6px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: 'rgba(0,0,0,0.42)', color: 'var(--silver)', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1, zIndex: 2 }}>×</button>
                        <div role="button" tabIndex={0} title="Open full player card" onClick={() => openPlayerCard(pl.pid)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayerCard(pl.pid); } }} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                            <img src={'https://sleepercdn.com/content/nfl/players/thumb/' + pl.pid + '.jpg'} onError={e => e.target.style.display = 'none'} style={{ width: '46px', height: '46px', borderRadius: '50%', objectFit: 'cover', border: '2px solid ' + (isLead ? 'var(--gold)' : (posColors[pl.pos] || 'var(--silver)')) }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', maxWidth: '100%' }}>
                                <span style={{ fontFamily: 'var(--font-title)', color: 'var(--white)', fontWeight: 850, fontSize: '0.92rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.name}</span>
                                {isLead ? <span style={{ ...mono, fontSize: '0.5rem', fontWeight: 850, color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', borderRadius: '4px', padding: '1px 4px', flexShrink: 0 }}>LEAD</span> : null}
                            </div>
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.72, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}><span style={{ color: posColors[pl.pos] || 'var(--silver)', fontWeight: 800 }}>{posLabel(pl.pos)}</span> · {pl.team}{pl.age ? ' · ' + pl.age + 'yo' : ''}</div>
                            <div style={{ ...mono, fontSize: '1.45rem', fontWeight: 850, color: dhqCol, lineHeight: 1.05 }}>{pl.dhq > 0 ? pl.dhq.toLocaleString() : '—'}</div>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                                <span style={{ ...mono, fontSize: '0.68rem', fontWeight: 850, color: pl.tier.color }}>{pl.tier.label}</span>
                                {k > 0 ? <span style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 850, color: 'var(--gold)' }}>· leads {k}</span> : null}
                            </div>
                        </div>
                    </div>
                );
            };

            const miniCurve = (pl) => {
                const cv = pl.ageCurve || { lo: 24, peakHi: 29, declineHi: 32 };
                const age = pl.age || 0;
                return (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ ...labelStyle, color: pl.phase.color, opacity: 1 }}>{pl.phase.label}</span>
                            <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7 }}>{pl.peakYrs > 0 ? pl.peakYrs + 'yr peak left' : pl.valueYrs > 0 ? pl.valueYrs + 'yr value left' : 'past window'}</span>
                        </div>
                        <div style={{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden', gap: '1px' }}>
                            {Array.from({ length: 17 }, (_, i) => {
                                const aa = i + 20;
                                const col = aa < cv.lo - 3 ? 'rgba(96,165,250,0.3)' : aa < cv.lo ? 'rgba(46,204,113,0.45)' : (aa >= cv.lo && aa <= cv.peakHi) ? 'rgba(46,204,113,0.75)' : aa <= cv.declineHi ? 'var(--acc-line3, rgba(212,175,55,0.45))' : 'rgba(231,76,60,0.35)';
                                return <div key={aa} style={{ flex: 1, background: col, opacity: aa === age ? 1 : 0.5, outline: aa === age ? '2px solid var(--gold)' : 'none', outlineOffset: '-1px' }}></div>;
                            })}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.5, marginTop: '3px' }}>
                            <span>20</span><span>Peak {cv.lo}–{cv.peakHi}</span><span>36</span>
                        </div>
                    </div>
                );
            };

            const renderRow = (m) => {
                const winners = winnersOf(m);
                const vals = m.values.map(v => Number(v) || 0);
                const best = winners.size ? (m.dir === 'high' ? Math.max(...vals) : Math.min(...vals.filter(v => v > 0))) : 0;
                return (
                    <div key={m.label} style={{ display: 'grid', gridTemplateColumns: gt, minWidth: rowMinW, gap: '10px', alignItems: m.wrap ? 'flex-start' : 'center', padding: isPhone ? '8px 0' : '8px 2px', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.05))' }}>
                        <div className={isPhone ? 'wr-stick-col' : undefined} style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em', ...(isPhone ? { opacity: 1, alignSelf: 'stretch', display: 'flex', alignItems: m.wrap ? 'flex-start' : 'center', paddingLeft: '10px', paddingRight: '6px' } : null) }}>{m.label}</div>
                        {list.map((p, i) => {
                            const win = winners.has(i);
                            // Phone: winning cells go gold (shared sticky-table
                            // accent); desktop keeps the shipped green.
                            const col = win ? (isPhone ? 'var(--gold)' : 'var(--good)') : (m.colors ? m.colors[i] : 'var(--white)');
                            if (m.wrap) {
                                return <div key={i} style={{ textAlign: 'center', minWidth: 0, fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.72, lineHeight: 1.4 }}>{m.display[i]}</div>;
                            }
                            const showGap = m.numeric && best > 0 && !win && vals[i] > 0;
                            return (
                                <div key={i} style={{ textAlign: 'center', minWidth: 0 }}>
                                    <div style={{ ...mono, fontWeight: 850, fontSize: '0.84rem', color: col, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {m.display[i]}{win ? <span style={{ marginLeft: '4px', fontSize: '0.56rem', color: isPhone ? 'var(--gold)' : 'var(--good)' }}>▲</span> : null}
                                    </div>
                                    {showGap ? <div style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.5, marginTop: '1px' }}>−{m.gapFmt ? m.gapFmt(best - vals[i]) : (best - vals[i])}</div> : null}
                                </div>
                            );
                        })}
                    </div>
                );
            };

            return (
                <div>
                    {/* Phone (P5): verdict hero ABOVE the matrix. The field verdict
                        is Pro at the EXACT existing isPro boundary; the free hero
                        carries the raw leader line only (the WrGatedMoreRow teaser
                        below keeps the existing gate surface). The AssetRow list
                        rendered by renderPlayerCompare replaces the hero strip. */}
                    {_phoneKit ? (
                    <div style={{ marginBottom: '12px' }}>
                        {isPro ? (
                            <WrHeroCard kicker="Verdict"
                                headline={valGap > 0 && second ? (top.name + ' over ' + second.name).toUpperCase() : 'DEAD EVEN FIELD'}
                                facts={verdict}
                                ctaGhost="Clear all" onCtaGhost={clearComparePlayers} />
                        ) : (
                            <WrHeroCard kicker="Field"
                                headline={valGap > 0 ? (top.name + ' leads the field').toUpperCase() : ('Even on ' + valueShortLabel).toUpperCase()}
                                facts={list.length + ' of 4 · straight ' + valueLabel + ' side by side'}
                                ctaGhost="Clear all" onCtaGhost={clearComparePlayers} />
                        )}
                    </div>
                    ) : null}
                    {!_phoneKit && (
                    <div style={{ ...panelStyle, padding: '14px 16px', marginBottom: '12px', background: 'linear-gradient(135deg, var(--acc-fill1, rgba(212,175,55,0.06)), rgba(52,152,219,0.045))' }}>
                        {/* Phone: hero strip drops the (empty) label column and scrolls
                            itself — the grid is its own scroll container here since this
                            panel has no overflowX. */}
                        <div style={{ display: 'grid', gridTemplateColumns: isPhone ? ('repeat(' + N + ', minmax(120px, 1fr))') : gt, gap: '10px', alignItems: 'end', ...(isPhone ? { overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '2px' } : null) }}>
                            {isPhone ? null : <div></div>}
                            {list.map(heroCol)}
                        </div>
                        {totalVal > 0 ? (
                            <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginTop: '14px', background: 'var(--ov-4, rgba(255,255,255,0.06))', gap: '1px' }}>
                                {list.map(pl => {
                                    const isLead = (pl.dhq || 0) === fieldMaxDhq;
                                    return <div key={'bar-' + pl.pid} title={pl.name + ' ' + Math.round((pl.dhq || 0) / totalVal * 100) + '% of field ' + valueShortLabel} style={{ width: ((pl.dhq || 0) / totalVal * 100) + '%', background: isLead ? 'var(--gold)' : 'var(--k-3498db, #3498db)', opacity: isLead ? 1 : 0.5 }}></div>;
                                })}
                            </div>
                        ) : null}
                    </div>
                    )}

                    {/* Field verdict = framing advice (Q9) → Pro; free gets the lock-row teaser.
                        Phone: the Pro read re-pours into the hero card above (same isPro gate);
                        the free teaser row renders on every tier. */}
                    {isPro ? (_phoneKit ? null : (
                    <div style={{ ...panelStyle, padding: '12px 14px', marginBottom: '12px', borderLeft: '3px solid var(--gold)' }}>
                        <div style={{ ...labelStyle, color: 'var(--gold)', opacity: 1, marginBottom: '4px' }}>The Read</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--white)', lineHeight: 1.5 }}>{verdict}</div>
                    </div>
                    )) : window.WrGatedMoreRow ? (
                    <div style={{ marginBottom: '12px' }}>
                        {React.createElement(window.WrGatedMoreRow, { title: 'The Read — field verdict', sub: 'Who to value now vs later — Pro calls the field.', feature: 'analytics_depth' })}
                    </div>
                    ) : null}

                    {/* Phone (P7): the matrix rides the shared sticky-table classes —
                        scoped scroll wrap + pinned metric column — with a name header
                        row (the hero strip no longer carries the column headers). */}
                    <div className={isPhone ? 'wr-sticky-table-wrap wr-sticky-table' : undefined} style={{ ...panelStyle, padding: isPhone ? '4px 0 12px' : '4px 16px 12px', marginBottom: '12px', overflowX: 'auto', ...(isPhone ? { WebkitOverflowScrolling: 'touch' } : null) }}>
                        {isPhone ? (
                            <div style={{ display: 'grid', gridTemplateColumns: gt, minWidth: rowMinW, gap: '10px', alignItems: 'center', padding: '8px 0 2px' }}>
                                <div className="wr-stick-col" style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', paddingLeft: '10px', paddingRight: '6px', alignSelf: 'stretch' }}>Metric</div>
                                {list.map(pl => {
                                    const isLead = (pl.dhq || 0) === fieldMaxDhq && fieldMaxDhq > 0;
                                    return (
                                        <div key={'ph-head-' + pl.pid} style={{ textAlign: 'center', minWidth: 0, fontFamily: 'var(--font-title)', fontWeight: 850, fontSize: '0.84rem', textTransform: 'uppercase', color: isLead ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.p?.last_name || pl.name}</div>
                                    );
                                })}
                            </div>
                        ) : null}
                        {metrics.map(renderRow)}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: '12px' }}>
                        {list.map(pl => (
                            <div key={'curve-' + pl.pid} style={{ ...panelStyle, padding: '12px 14px' }}>
                                <div style={{ ...labelStyle, marginBottom: '9px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.name} · Age Curve</div>
                                {miniCurve(pl)}
                            </div>
                        ))}
                    </div>
                </div>
            );
        };

        const headerBlock = (
            <div style={{ ...panelStyle, padding: '13px 16px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: 'linear-gradient(135deg, var(--acc-fill1, rgba(212,175,55,0.055)), rgba(52,152,219,0.04))' }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.2rem', fontWeight: 850, color: 'var(--white)', letterSpacing: 0 }}>{valid.length === 2 ? 'Head-to-Head' : valid.length >= 3 ? valid.length + '-Way Compare' : 'Player Compare'}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.72 }}>
                        {valid.length === 2
                            ? <span>{valid[0].name} vs {valid[1].name} · straight {valueLabel}</span>
                            : valid.length >= 3
                                ? <span>{valid.map(p => p.name).join(' · ')} · straight {valueLabel}</span>
                                : <span>{valid.length} of 4 · straight {valueLabel} side by side{multi && leader ? ' · ' : ''}{multi && leader ? <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{leader.name} leads</span> : ''}</span>}
                    </div>
                </div>
                <button onClick={clearComparePlayers} style={smallButtonStyle(false)}>Clear all</button>
            </div>
        );

        if (valid.length >= 2 && valid.length === players.length) {
            return <div>{_phoneKit ? renderPhoneFieldRows() : headerBlock}{renderComparisonMatrix(valid)}</div>;
        }

        const slots = [];
        for (let i = 0; i < 4; i++) slots.push(i < players.length ? renderCompareCard(players[i], i) : renderGhostCell(i));
        return (
            <div>
                {_phoneKit ? renderPhoneFieldRows() : headerBlock}
                {_phoneKit ? null : (
                <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
                    {slots}
                </div>
                )}
            </div>
        );
    };

    // Phone add-player search (P3/P6): same pool filter as the desktop
    // dropdown (renderPlayerSearch), re-homed in a WR.Sheet list with a
    // 16px input (iOS zoom floor). Computed only while the sheet is open.
    // Add-player search (phone): owned-by-team map + result pool. Filters by
    // name, position group, and/or owning team — any active filter is enough
    // to browse (name not required when a pos/team filter is set).
    const searchTeams = (currentLeague?.rosters || [])
        .map(ros => ({ rid: String(ros.roster_id), name: getOwnerName(ros, 'Team ' + ros.roster_id), pids: new Set((ros.players || []).map(String)) }))
        .filter(t => t.pids.size);
    const pidOwnerRid = {}; const ridName = {};
    searchTeams.forEach(t => { ridName[t.rid] = t.name; t.pids.forEach(pid => { pidOwnerRid[pid] = t.rid; }); });
    let phoneSearchResults = [];
    if (_phoneKit && compareScope === 'players' && searchOpen) {
        const q = playerQuery.trim().toLowerCase();
        const posOn = searchPos !== 'ALL', teamOn = searchTeam !== 'ALL';
        if (comparePlayerIds.length < 4 && (q.length >= 2 || posOn || teamOn)) {
            const seen = new Set(comparePlayerIds.map(String));
            for (const pid of Object.keys(playersData || {})) {
                const p = playersData[pid];
                if (!p) continue;
                const pos = normPos(p.position);
                if (!allPositions.includes(pos)) continue;
                if (posOn && pos !== searchPos) continue;
                if (teamOn && pidOwnerRid[String(pid)] !== searchTeam) continue;
                const nm = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
                if (!nm) continue;
                if (q.length >= 2 && !nm.toLowerCase().includes(q)) continue;
                if (seen.has(String(pid))) continue;
                phoneSearchResults.push({ pid, name: nm, pos, team: p.team || 'FA', dhq: scores[pid] || scores[String(pid)] || 0, owner: ridName[pidOwnerRid[String(pid)]] || null });
            }
            phoneSearchResults.sort((a, b) => b.dhq - a.dhq);
            phoneSearchResults = phoneSearchResults.slice(0, 40);
        }
    }
    const phoneAtMax = comparePlayerIds.length >= 4;
    const phonePickedName = (() => {
        if (comparePlayerIds.length !== 1) return '';
        const p = playersData?.[comparePlayerIds[0]] || playersData?.[String(comparePlayerIds[0])];
        return p ? (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim()) : '1 of 4 picked';
    })();

    return (
      <div style={pageStyle}>
        {/* Phone tier (≤767) only — hit-slop for the small × remove glyphs
            (26px/22px visuals stay; the tap area grows to ≥44px, plan D7:
            hit-padding, not bigger buttons). Buttons are position:absolute,
            so the ::after anchors to them without layout impact. */}
        <style>{`
            @media (max-width: 767px) {
                .cmp-remove-x::after { content: ''; position: absolute; top: -11px; right: -11px; bottom: -11px; left: -11px; }
            }
        `}</style>
        <div className="wr-module-strip">
          <div className="wr-module-actions" style={compareScope === 'players' ? { flex: '1 1 100%', justifyContent: 'space-between' } : undefined}>
            {renderScopeControls()}
            {compareScope === 'duel' ? (
                <select className="wr-module-select" value={compareTeamId || ''} onChange={e => setCompareTeamId(e.target.value || null)} style={selectStyle}>
                  <option value="">Select team to compare...</option>
                  {opponentOptions.map(t => (
                    <option key={t.rosterId} value={String(t.rosterId)}>{t.name} ({t.wins || 0}-{t.losses || 0})</option>
                  ))}
                </select>
            ) : compareScope === 'players' ? (_phoneKit ? (
                <WrFilterPill label="Add player" value={comparePlayerIds.length + '/4'} onClick={() => setSearchOpen(true)} />
            ) : renderPlayerSearch()) : (
                <div style={{ ...mono, color: 'var(--silver)', fontSize: '0.76rem' }}>
                    {compareScope === 'group' ? (cleanManualIds.length >= 2 ? selectedGroupTeams.length + ' selected' : cleanManualIds.length ? cleanManualIds.length + ' of 2 needed' : 'default field')
                        : compareScope === 'division' ? getDivisionName(activeDivision)
                        : opponentOptions.length + ' opponents'}
                </div>
            )}
          </div>
        </div>

        {compareScope === 'players' ? renderPlayerCompare() : compareScope === 'duel' ? (
        <React.Fragment>
        {!compareTeamId && renderLanding()}

        {compareTeamId && (() => {
            const theirRoster = (currentLeague.rosters || []).find(r => sameId(r.roster_id, compareTeamId));
            if (!theirRoster) return renderLanding();

            const theirName = getOwnerName(theirRoster, 'Opponent');
            const myPlayers = myRoster.players || [];
            const theirPlayers = theirRoster.players || [];
            const theirTotal = getRosterTotal(theirRoster);
            const totalDhq = Math.max(1, myTotal + theirTotal);
            const myDhqPct = (myTotal / totalDhq) * 100;
            const myWins = myRoster.settings?.wins || 0;
            const myLosses = myRoster.settings?.losses || 0;
            const theirWins = theirRoster.settings?.wins || 0;
            const theirLosses = theirRoster.settings?.losses || 0;
            const myWinPct = (myWins + myLosses) > 0 ? myWins / (myWins + myLosses) : 0;
            const theirWinPct = (theirWins + theirLosses) > 0 ? theirWins / (theirWins + theirLosses) : 0;
            const myColor = 'var(--gold)';
            const theirColor = 'var(--k-7c6bf8, #7c6bf8)';
            const statsRef = statsData || {};
            const stats2025Ref = stats2025Data || {};
            const derivedStatsRef = window.S?.playerStats || {};
            const scoring = currentLeague?.scoring_settings || {};

            const calcPlayerPPG = (pid) => {
                const st = statsRef[pid] || statsRef[String(pid)] || statsData?.[pid] || {};
                const prev = stats2025Ref?.[pid] || stats2025Ref?.[String(pid)] || {};
                const curGP = Number(st.gp || 0);
                const prevGP = Number(prev.gp || 0);
                const curPts = curGP > 0 && typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(st, scoring) : null;
                const prevPts = prevGP > 0 && typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(prev, scoring) : null;
                const curPPG = curGP > 0 && curPts != null ? +(curPts / curGP).toFixed(1) : 0;
                const prevPPG = prevGP > 0 && prevPts != null ? +(prevPts / prevGP).toFixed(1) : 0;
                const derived = derivedStatsRef[pid] || derivedStatsRef[String(pid)] || {};
                return curPPG > 0 ? curPPG : prevPPG > 0 ? prevPPG : (derived.seasonAvg || derived.prevAvg || 0);
            };

            const starterDhq = (roster) => (roster?.starters || [])
                .filter(pid => pid && pid !== '0')
                .reduce((sum, pid) => sum + (scores[pid] || scores[String(pid)] || 0), 0);
            const myStarterDhq = starterDhq(myRoster);
            const theirStarterDhq = starterDhq(theirRoster);
            const myPickCapital = getDraftCapital(myRoster);
            const theirPickCapital = getDraftCapital(theirRoster);
            const myFaab = getFaab(myRoster);
            const theirFaab = getFaab(theirRoster);
            const myAssetTotal = myTotal + myPickCapital.totalValue;
            const theirAssetTotal = theirTotal + theirPickCapital.totalValue;
            const pickValueDiff = myPickCapital.totalValue - theirPickCapital.totalValue;
            const pickCountDiff = myPickCapital.count - theirPickCapital.count;
            const enrich = (pid) => {
                const p = playersData?.[pid] || playersData?.[String(pid)];
                if (!p) return null;
                const pos = normPos(p.position);
                const curve = typeof window.App?.getAgeCurve === 'function'
                    ? window.App.getAgeCurve(pos)
                    : { build: [22, 24], peak: (window.App?.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
                const [, pHi] = curve.peak || [24, 29];
                const declineHi = curve.decline?.[1] || 32;
                const age = p.age || null;
                return {
                    pid,
                    p,
                    pos,
                    dhq: scores[pid] || scores[String(pid)] || 0,
                    age,
                    team: p.team || 'FA',
                    yrsExp: p.years_exp || 0,
                    peakYrs: age ? Math.max(0, pHi - age) : 0,
                    valueYrs: age ? Math.max(0, declineHi - age) : 0,
                    ppg: calcPlayerPPG(pid),
                };
            };

            const enrichedMine = myPlayers.map(enrich).filter(Boolean);
            const enrichedTheirs = theirPlayers.map(enrich).filter(Boolean);
            const positionSummaries = allPositions.map(pos => {
                const myAtPos = enrichedMine.filter(r => r.pos === pos).sort((a, b) => b.dhq - a.dhq);
                const theirAtPos = enrichedTheirs.filter(r => r.pos === pos).sort((a, b) => b.dhq - a.dhq);
                const myPosDHQ = myAtPos.reduce((s, x) => s + x.dhq, 0);
                const theirPosDHQ = theirAtPos.reduce((s, x) => s + x.dhq, 0);
                return {
                    pos,
                    myAtPos,
                    theirAtPos,
                    myPosDHQ,
                    theirPosDHQ,
                    diff: myPosDHQ - theirPosDHQ,
                    topMine: myAtPos[0],
                    topTheirs: theirAtPos[0],
                    count: Math.max(myAtPos.length, theirAtPos.length),
                };
            }).filter(p => p.count > 0);

            const youLead = positionSummaries.filter(p => p.diff > 0).length;
            const theyLead = positionSummaries.filter(p => p.diff < 0).length;
            const biggestEdges = [...positionSummaries].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 4);
            const leverage = [...positionSummaries].filter(p => p.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 2);
            const exposures = [...positionSummaries].filter(p => p.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 2);
            const verdict = myTotal >= theirTotal && youLead >= theyLead
                ? 'You hold the roster edge'
                : myTotal >= theirTotal
                    ? 'Your value edge is concentrated'
                    : youLead > theyLead
                        ? 'You win more rooms, they win bigger'
                        : 'Opponent has the roster edge';
            const verdictColor = myTotal >= theirTotal ? 'var(--good)' : 'var(--bad)';

            const champs = window.App?.LI?.championships || {};
            const myChamps = Object.values(champs).filter(c => sameId(c.champion, myRoster.roster_id)).length;
            const theirChamps = Object.values(champs).filter(c => sameId(c.champion, compareTeamId)).length;
            const brackets = window.App?.LI?.bracketData || {};
            const rec = window.WrHistory?.playoffRecord;
            let myPW = 0, myPL = 0, theirPW = 0, theirPL = 0;
            Object.values(brackets).forEach(({ winners }) => {
                if (!winners?.length || !rec) return;
                // Championship-path games only (exclude consolation/placement), via the
                // single source of truth in league-history.js — not every bracket game.
                const mine = rec(winners, myRoster.roster_id);
                const theirs = rec(winners, compareTeamId);
                myPW += mine.w; myPL += mine.l; theirPW += theirs.w; theirPL += theirs.l;
            });

            const meetings = h2hState.loadedFor && sameId(h2hState.loadedFor, compareTeamId) ? h2hState.meetings : [];
            const h2hWins = meetings.filter(m => m.result === 'W').length;
            const h2hLosses = meetings.filter(m => m.result === 'L').length;
            const h2hTies = meetings.filter(m => m.result === 'T').length;
            const avgFor = meetings.length ? meetings.reduce((s, m) => s + m.myPoints, 0) / meetings.length : 0;
            const avgAgainst = meetings.length ? meetings.reduce((s, m) => s + m.theirPoints, 0) / meetings.length : 0;
            const lastMeeting = meetings[0];
            let streak = 'None';
            if (lastMeeting) {
                const streakResult = lastMeeting.result;
                let streakCount = 0;
                for (const m of meetings) {
                    if (m.result !== streakResult) break;
                    streakCount += 1;
                }
                streak = (streakResult === 'W' ? 'Won ' : streakResult === 'L' ? 'Lost ' : 'Tied ') + streakCount;
            }

            const faabDiff = myFaab.remaining - theirFaab.remaining;
            const statCards = [
                { label: valueLabel, value: (myAssetTotal - theirAssetTotal > 0 ? '+' : '') + (myAssetTotal - theirAssetTotal).toLocaleString(), sub: myAssetTotal.toLocaleString() + ' vs ' + theirAssetTotal.toLocaleString() + ' incl. picks', color: myAssetTotal >= theirAssetTotal ? 'var(--good)' : 'var(--bad)' },
                { label: 'Roster ' + valueShortLabel, value: (myTotal - theirTotal > 0 ? '+' : '') + (myTotal - theirTotal).toLocaleString(), sub: myTotal.toLocaleString() + ' vs ' + theirTotal.toLocaleString(), color: myTotal >= theirTotal ? 'var(--good)' : 'var(--bad)' },
                { label: 'Starter ' + valueShortLabel, value: (myStarterDhq - theirStarterDhq > 0 ? '+' : '') + (myStarterDhq - theirStarterDhq).toLocaleString(), sub: myStarterDhq.toLocaleString() + ' vs ' + theirStarterDhq.toLocaleString(), color: myStarterDhq >= theirStarterDhq ? 'var(--good)' : 'var(--bad)' },
                { label: 'Pick Value', value: (pickValueDiff > 0 ? '+' : '') + pickValueDiff.toLocaleString(), sub: Math.round(myPickCapital.totalValue / 1000) + 'k vs ' + Math.round(theirPickCapital.totalValue / 1000) + 'k pick ' + valueShortLabel, color: pickValueDiff >= 0 ? 'var(--good)' : 'var(--bad)' },
                { label: 'Pick Count', value: (pickCountDiff > 0 ? '+' : '') + pickCountDiff, sub: myPickCapital.count + ' picks vs ' + theirPickCapital.count + ' picks', color: pickCountDiff >= 0 ? 'var(--good)' : 'var(--bad)' },
                { label: 'FAAB', value: myFaab.isFaab ? (faabDiff > 0 ? '+$' + faabDiff.toLocaleString() : faabDiff < 0 ? '-$' + Math.abs(faabDiff).toLocaleString() : '$0') : '—', sub: myFaab.isFaab ? '$' + myFaab.remaining + ' vs $' + theirFaab.remaining + ' left' : 'No FAAB budget', color: !myFaab.isFaab ? 'var(--silver)' : faabDiff > 0 ? 'var(--good)' : faabDiff < 0 ? 'var(--bad)' : 'var(--silver)' },
                { label: 'Position Edges', value: youLead + '-' + theyLead, sub: 'rooms won', color: youLead >= theyLead ? 'var(--good)' : 'var(--bad)' },
                { label: 'All-Time H2H', value: h2hState.loading ? 'Loading' : h2hWins + '-' + h2hLosses + (h2hTies ? '-' + h2hTies : ''), sub: meetings.length ? avgFor.toFixed(1) + '-' + avgAgainst.toFixed(1) + ' avg' : (h2hState.error || 'no meetings found'), color: h2hWins >= h2hLosses ? 'var(--good)' : 'var(--bad)' },
                { label: 'Titles', value: myChamps + '-' + theirChamps, sub: 'championships', color: myChamps >= theirChamps ? 'var(--good)' : 'var(--bad)' },
                { label: 'Playoffs', value: myPW + '-' + myPL + ' / ' + theirPW + '-' + theirPL, sub: 'you / them', color: myPW >= theirPW ? 'var(--good)' : 'var(--bad)' },
            ];

            const renderMiniPlayer = (r) => r
                ? <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.p?.full_name || '?'}</span>
                : <span style={{ color: 'var(--silver)', opacity: 0.38 }}>No player</span>;

            const openCard = (pid) => {
                if (!pid) return;
                if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
                else if (typeof window._wrSelectPlayer === 'function') window._wrSelectPlayer(pid);
            };

            const renderRosterCell = (r, opponent, rival) => {
                if (!r) return <span style={{ color: 'var(--silver)', opacity: 0.32, fontSize: '0.72rem', padding: '7px 10px', display: 'inline-block' }}>-</span>;
                const dhqCol = r.dhq >= 7000 ? 'var(--good)' : r.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : r.dhq >= 1000 ? 'var(--silver)' : 'var(--ov-9, rgba(255,255,255,0.5))';
                const winsDhq = rival && r.dhq > rival.dhq;
                return (
                    <div
                        role="button"
                        tabIndex={0}
                        title="Open player card"
                        onClick={() => openCard(r.pid)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(r.pid); } }}
                        style={{
                        padding: '7px 10px',
                        minHeight: '44px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.78rem',
                        background: winsDhq ? 'rgba(46,204,113,0.045)' : 'transparent',
                        cursor: 'pointer',
                        borderRight: opponent ? 'none' : '1px solid var(--ov-3, rgba(255,255,255,0.04))',
                    }}>
                        {!isPhone && <img src={'https://sleepercdn.com/content/nfl/players/thumb/'+r.pid+'.jpg'} onError={e=>e.target.style.display='none'} style={{ width:'22px',height:'22px',borderRadius:'50%',objectFit:'cover', flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Phone: "F. Last" + 3 meta chips — five chips wrapped to a
                                second line in a half-width cell (owner ask 2026-07-12). */}
                            <div style={{ color: 'var(--white)', fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isPhone ? ((r.p?.first_name ? r.p.first_name[0] + '. ' : '') + (r.p?.last_name || r.p?.full_name || '?')) : (r.p?.full_name || '?')}</div>
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.68, marginTop: '1px', display: 'flex', gap: '6px', flexWrap: 'wrap', ...(isPhone ? { whiteSpace: 'nowrap', overflow: 'hidden', flexWrap: 'nowrap' } : null) }}>
                                <span>{r.team}</span>
                                {r.age != null ? <span>{r.age}yo</span> : null}
                                {r.ppg > 0 ? <span>{r.ppg} PPG</span> : null}
                                {!isPhone && <span>{r.yrsExp}y exp</span>}
                                {!isPhone && <span>{r.peakYrs > 0 ? r.peakYrs + 'yr peak' : r.valueYrs + 'yr value'}</span>}
                            </div>
                        </div>
                        <span style={{ ...mono, fontWeight: 700, fontSize: '0.76rem', color: dhqCol, flexShrink: 0 }}>{r.dhq > 0 ? r.dhq.toLocaleString() : '-'}</span>
                    </div>
                );
            };

            return (
              <div>
                {/* Phone (P5): the matchup read leads the page as the decision
                    hero; the desktop 3-col You/Read/Opponent header renders
                    off-phone only. No gate — the duel read is free today. */}
                {_phoneKit ? (
                <div style={{ marginBottom: '12px' }}>
                    <WrHeroCard kicker="Matchup Read" headline={verdict.toUpperCase()}
                        facts={<React.Fragment>
                            <div>{myName} {myWins}-{myLosses} vs {theirName} {theirWins}-{theirLosses}{gm.hasStrategy ? ' · ' + gmPostureFrame.label : ''}</div>
                            <div>{biggestEdges[0] ? posLabel(biggestEdges[0].pos) : 'Roster'} is the biggest swing: {(biggestEdges[0]?.diff || 0) > 0 ? '+' : ''}{(biggestEdges[0]?.diff || 0).toLocaleString()} {valueShortLabel}.</div>
                        </React.Fragment>} />
                </div>
                ) : null}
                <div style={{ ...panelStyle, padding: '18px 20px', marginBottom: '16px', background: 'linear-gradient(135deg, var(--acc-fill1, rgba(212,175,55,0.065)), rgba(124,107,248,0.055))' }}>
                    {!_phoneKit && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                        <div>
                            <div style={labelStyle}>You</div>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.35rem', color: myColor, fontWeight: 800, letterSpacing: 0 }}>{myName}</div>
                            <div style={{ ...mono, fontSize: '0.82rem', color: 'var(--silver)' }}>{myWins}-{myLosses} current record</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ ...labelStyle, marginBottom: '4px' }}>Matchup Read</div>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.25rem', fontWeight: 800, color: verdictColor, letterSpacing: 0 }}>{verdict}</div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.72, marginTop: '3px' }}>
                                {biggestEdges[0] ? posLabel(biggestEdges[0].pos) : 'Roster'} is the biggest swing: {(biggestEdges[0]?.diff || 0) > 0 ? '+' : ''}{(biggestEdges[0]?.diff || 0).toLocaleString()} {valueShortLabel}.
                            </div>
                            {gm.hasStrategy ? (
                                <div title={gmPostureFrame.hint} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '7px', padding: '3px 9px', borderRadius: '999px', border: '1px solid ' + gmPostureFrame.color, background: 'rgba(0,0,0,0.28)' }}>
                                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: gmPostureFrame.color, flexShrink: 0 }}></span>
                                    <span style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 850, color: gmPostureFrame.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{gmPostureFrame.label}</span>
                                </div>
                            ) : null}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={labelStyle}>Opponent</div>
                            <div style={{ fontFamily: 'var(--font-title)', fontSize: '1.35rem', color: theirColor, fontWeight: 800, letterSpacing: 0 }}>{theirName}</div>
                            <div style={{ ...mono, fontSize: '0.82rem', color: 'var(--silver)' }}>{theirWins}-{theirLosses} current record</div>
                        </div>
                    </div>
                    )}

                    <div style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '6px' }}>
                            <span style={{ ...mono, color: myColor, fontWeight: 800 }}>{myTotal.toLocaleString()} <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6 }}>{valueShortLabel}</span></span>
                            <span style={{ ...labelStyle, alignSelf: 'center' }}>Roster Share</span>
                            <span style={{ ...mono, color: theirColor, fontWeight: 800 }}>{theirTotal.toLocaleString()} <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6 }}>{valueShortLabel}</span></span>
                        </div>
                        <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', background: 'var(--ov-4, rgba(255,255,255,0.055))' }}>
                            <div style={{ width: myDhqPct + '%', background: 'linear-gradient(90deg, var(--gold), var(--acc-line4, rgba(212,175,55,0.78)))', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '6px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--k-0a0a0a, #0a0a0a)', fontWeight: 800 }}>
                                {myDhqPct >= 12 ? Math.round(myDhqPct) + '%' : ''}
                            </div>
                            <div style={{ width: (100 - myDhqPct) + '%', background: 'linear-gradient(90deg, rgba(124,107,248,0.78), var(--k-7c6bf8, #7c6bf8))', display: 'flex', alignItems: 'center', paddingLeft: '6px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--k-0a0a0a, #0a0a0a)', fontWeight: 800 }}>
                                {(100 - myDhqPct) >= 12 ? Math.round(100 - myDhqPct) + '%' : ''}
                            </div>
                        </div>
                    </div>

                    {/* Phone (P4): the duel stat cards ride a horizontally
                        snapping .wr-kpi-strip instead of a stacked grid. */}
                    <div className={isPhone ? 'wr-kpi-strip' : undefined} style={isPhone ? undefined : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '9px' }}>
                        {statCards.map(card => (
                            <div key={card.label} style={{ padding: '10px', background: 'rgba(0,0,0,0.28)', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: '7px', ...(isPhone ? { width: '156px' } : null) }}>
                                <div style={labelStyle}>{card.label}</div>
                                <div style={{ ...mono, fontSize: '1rem', fontWeight: 800, color: card.color, marginTop: '5px' }}>{card.value}</div>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.64, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.sub}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '14px', marginBottom: '16px' }}>
                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <div>
                                <div style={{ fontFamily: 'var(--font-title)', color: 'var(--white)', fontWeight: 800, fontSize: 'var(--text-title)', letterSpacing: 0 }}>Position Edge Matrix</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.66 }}>Total roster value by room, sorted by positional importance.</div>
                            </div>
                            <div style={{ ...mono, fontSize: '0.82rem', color: youLead >= theyLead ? 'var(--good)' : 'var(--bad)', fontWeight: 800 }}>{youLead}-{theyLead}</div>
                        </div>
                        {/* Phone: 2-up compact grid — the 190px-min auto-fit collapsed
                            to ONE column at 375-430px and stacked 9 full-width cards
                            (owner ask 2026-07-12: Compare formatting pass). */}
                        <div style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(190px, 1fr))', gap: isPhone ? '7px' : '9px' }}>
                            {positionSummaries.map(summary => {
                                const total = Math.max(1, summary.myPosDHQ + summary.theirPosDHQ);
                                const minePct = summary.myPosDHQ / total * 100;
                                const edgeColor = summary.diff > 0 ? 'var(--good)' : summary.diff < 0 ? 'var(--bad)' : 'var(--silver)';
                                return (
                                    <div key={summary.pos} style={{ padding: isPhone ? '8px' : '10px', background: 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '7px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '7px' }}>
                                            <span style={{ fontWeight: 900, color: posColors[summary.pos] || 'var(--gold)' }}>{posLabel(summary.pos)}</span>
                                            <span style={{ ...mono, color: edgeColor, fontWeight: 800, fontSize: '0.78rem' }}>{summary.diff > 0 ? '+' : ''}{summary.diff.toLocaleString()}</span>
                                        </div>
                                        <div style={{ display: 'flex', height: '5px', borderRadius: '3px', overflow: 'hidden', background: 'var(--ov-4, rgba(255,255,255,0.06))', marginBottom: '8px' }}>
                                            <div style={{ width: minePct + '%', background: 'var(--gold)' }}></div>
                                            <div style={{ width: (100 - minePct) + '%', background: theirColor }}></div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: 'var(--text-micro, 0.6875rem)' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ color: myColor, fontWeight: 800, marginBottom: '2px' }}>{summary.myPosDHQ.toLocaleString()}</div>
                                                <div style={muted}>{renderMiniPlayer(summary.topMine)}</div>
                                            </div>
                                            <div style={{ minWidth: 0, textAlign: 'right' }}>
                                                <div style={{ color: theirColor, fontWeight: 800, marginBottom: '2px' }}>{summary.theirPosDHQ.toLocaleString()}</div>
                                                <div style={muted}>{renderMiniPlayer(summary.topTheirs)}</div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ fontFamily: 'var(--font-title)', color: 'var(--white)', fontWeight: 800, fontSize: 'var(--text-title)', letterSpacing: 0, marginBottom: '10px' }}>H2H History</div>
                        {h2hState.loading ? (
                            <div style={{ color: 'var(--silver)', fontSize: '0.82rem', padding: '10px 0' }}>Loading owner-vs-owner history...</div>
                        ) : meetings.length ? (
                            <React.Fragment>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}>
                                    {[
                                        ['Record', h2hWins + '-' + h2hLosses + (h2hTies ? '-' + h2hTies : '')],
                                        ['Last', lastMeeting ? lastMeeting.season + ' W' + lastMeeting.week : '-'],
                                        ['Streak', streak],
                                    ].map(([label, value]) => (
                                        <div key={label} style={{ padding: '8px', background: 'var(--ov-2, rgba(255,255,255,0.03))', borderRadius: '6px' }}>
                                            <div style={labelStyle}>{label}</div>
                                            <div style={{ ...mono, fontWeight: 800, color: 'var(--white)', fontSize: '0.82rem', marginTop: '4px' }}>{value}</div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ display: 'grid', gap: '6px' }}>
                                    {meetings.slice(0, 6).map(m => (
                                        <div key={m.season + '-' + m.week + '-' + m.matchupId} style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', alignItems: 'center', gap: '8px', padding: '7px 8px', background: 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: '6px', fontSize: '0.74rem' }}>
                                            <div style={{ ...mono, color: 'var(--silver)', opacity: 0.72 }}>{m.season} W{m.week}</div>
                                            <div style={{ color: m.result === 'W' ? 'var(--good)' : m.result === 'L' ? 'var(--bad)' : 'var(--silver)', fontWeight: 800 }}>{m.result} {m.myPoints.toFixed(2)}-{m.theirPoints.toFixed(2)}</div>
                                            <div style={{ ...mono, color: m.margin >= 0 ? 'var(--good)' : 'var(--bad)' }}>{m.margin > 0 ? '+' : ''}{m.margin.toFixed(2)}</div>
                                        </div>
                                    ))}
                                    {meetings.length > 6 ? <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.58, textAlign: 'center', paddingTop: '4px' }}>+{meetings.length - 6} older meetings cached</div> : null}
                                </div>
                            </React.Fragment>
                        ) : (
                            <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: '0.8rem', lineHeight: 1.45 }}>
                                {h2hState.error || 'No completed regular-season meetings found between these current owners.'}
                            </div>
                        )}
                    </div>
                </div>

                {/* Leverage/exposure cards — removed on phone (owner ask). */}
                {!isPhone && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginBottom: '16px' }}>
                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ ...labelStyle, color: 'var(--gold)', opacity: 1, marginBottom: '8px' }}>Where you can press</div>
                        {leverage.length ? leverage.map(item => (
                            <div key={item.pos} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 0', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.05))' }}>
                                <span style={{ color: posColors[item.pos] || 'var(--white)', fontWeight: 800 }}>{posLabel(item.pos)}</span>
                                <span style={{ color: 'var(--silver)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{renderMiniPlayer(item.topMine)} over {renderMiniPlayer(item.topTheirs)}</span>
                                <span style={{ ...mono, color: 'var(--good)', fontWeight: 800 }}>+{item.diff.toLocaleString()}</span>
                            </div>
                        )) : <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: '0.8rem' }}>No clear surplus edge. This matchup is more about player-level choices.</div>}
                    </div>
                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ ...labelStyle, color: 'var(--bad)', opacity: 1, marginBottom: '8px' }}>Where they can hurt you</div>
                        {exposures.length ? exposures.map(item => (
                            <div key={item.pos} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 0', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.05))' }}>
                                <span style={{ color: posColors[item.pos] || 'var(--white)', fontWeight: 800 }}>{posLabel(item.pos)}</span>
                                <span style={{ color: 'var(--silver)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{renderMiniPlayer(item.topTheirs)} over {renderMiniPlayer(item.topMine)}</span>
                                <span style={{ ...mono, color: 'var(--bad)', fontWeight: 800 }}>{item.diff.toLocaleString()}</span>
                            </div>
                        )) : <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: '0.8rem' }}>No obvious room where this opponent has a strong value edge.</div>}
                    </div>
                </div>
                )}

                <div style={{ ...panelStyle, padding: '14px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline', marginBottom: '10px' }}>
                        <div>
                            <div style={{ fontFamily: 'var(--font-title)', color: 'var(--white)', fontWeight: 800, fontSize: 'var(--text-title)', letterSpacing: 0 }}>Draft Picks & FAAB</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.66 }}>{skinFeatures.showFuturePicks === false ? 'Draft capital' : 'Future capital'} is included in {valueLabel}; FAAB stays separate as waiver leverage.</div>
                        </div>
                        <div style={{ ...mono, color: myAssetTotal >= theirAssetTotal ? 'var(--good)' : 'var(--bad)', fontWeight: 850 }}>{myAssetTotal >= theirAssetTotal ? '+' : ''}{(myAssetTotal - theirAssetTotal).toLocaleString()} assets</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '10px' }}>
                        {[
                            { name: myName, pickCapital: myPickCapital, faab: myFaab, assetTotal: myAssetTotal, mine: true },
                            { name: theirName, pickCapital: theirPickCapital, faab: theirFaab, assetTotal: theirAssetTotal, mine: false },
                        ].map(side => (
                            <div key={side.name} style={{ padding: '10px', borderRadius: '7px', background: side.mine ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'rgba(124,107,248,0.055)', border: '1px solid ' + (side.mine ? 'var(--acc-line1, rgba(212,175,55,0.24))' : 'rgba(124,107,248,0.18)') }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', marginBottom: '8px' }}>
                                    <div style={{ color: side.mine ? myColor : theirColor, fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{side.name}</div>
                                    <div style={{ ...mono, color: 'var(--white)', fontSize: '0.76rem', fontWeight: 850 }}>{side.assetTotal.toLocaleString()}</div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
                                    <div>
                                        <div style={labelStyle}>Pick Value</div>
                                        <div style={{ ...mono, color: side.pickCapital.totalValue >= myPickCapital.totalValue ? 'var(--good)' : 'var(--silver)', fontWeight: 850 }}>{Math.round(side.pickCapital.totalValue / 1000)}k</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.58 }}>draft {valueShortLabel}</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>Pick Count</div>
                                        <div style={{ ...mono, color: side.pickCapital.count >= myPickCapital.count ? 'var(--good)' : 'var(--silver)', fontWeight: 850 }}>{side.pickCapital.count}</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.58 }}>{Object.entries(side.pickCapital.byRound || {}).slice(0, 3).map(([rd, ct]) => 'R' + rd + ':' + ct).join('  ') || 'No picks'}</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>Best Picks</div>
                                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.76, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{side.pickCapital.topPicks.length ? side.pickCapital.topPicks.slice(0, 2).map(p => p.label).join(' · ') : 'None'}</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>FAAB</div>
                                        <div style={{ ...mono, color: side.faab.isFaab ? (side.faab.remaining >= myFaab.remaining ? 'var(--good)' : 'var(--silver)') : 'var(--ov-8, rgba(255,255,255,0.32))', fontWeight: 850 }}>{side.faab.isFaab ? '$' + side.faab.remaining : '—'}</div>
                                        <div style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.58 }}>{side.faab.isFaab ? side.faab.pct + '% left' : 'No FAAB'}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Full Roster by Position</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.62 }}>Click any player to open the player card.</div>
                    </div>
                    {positionSummaries.map(summary => {
                        const maxLen = Math.max(summary.myAtPos.length, summary.theirAtPos.length);
                        const total = Math.max(1, summary.myPosDHQ + summary.theirPosDHQ);
                        const myPosPct = summary.myPosDHQ / total * 100;
                        const isTargetRoom = gmTargetPositions.has(String(summary.pos));
                        return (
                            <div key={summary.pos} style={{ marginBottom: '12px', ...panelStyle, overflow: 'hidden', border: isTargetRoom ? '1px solid var(--acc-line2, rgba(212,175,55,0.35))' : panelStyle.border }}>
                                <div style={{ padding: '9px 10px 10px', background: isTargetRoom ? 'var(--acc-fill1, rgba(212,175,55,0.06))' : (posColors[summary.pos] || 'var(--k-666666, #666666)') + '14', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', gap: '10px' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 900, color: isTargetRoom ? 'var(--gold)' : posColors[summary.pos] || 'var(--silver)' }}>{posLabel(summary.pos)}</span>
                                            {isTargetRoom ? <span title="Target room from your GM Strategy — win this matchup here" style={{ ...mono, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 850, color: 'var(--gold)', padding: '1px 6px', borderRadius: '4px', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', letterSpacing: '0.04em' }}>TARGET</span> : null}
                                        </span>
                                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.72rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            <span style={{ color: isTargetRoom ? 'var(--gold)' : summary.myPosDHQ >= summary.theirPosDHQ ? 'var(--good)' : 'var(--silver)', fontWeight: isTargetRoom ? 800 : 400 }}>You: {summary.myPosDHQ.toLocaleString()}</span>
                                            <span style={{ color: summary.theirPosDHQ >= summary.myPosDHQ ? 'var(--good)' : 'var(--silver)' }}>Them: {summary.theirPosDHQ.toLocaleString()}</span>
                                            <span style={{ fontWeight: 800, color: summary.diff > 0 ? 'var(--good)' : summary.diff < 0 ? 'var(--bad)' : 'var(--silver)' }}>{summary.diff > 0 ? '+' : ''}{summary.diff.toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: 'var(--ov-3, rgba(255,255,255,0.04))' }}>
                                        <div title={'You: ' + Math.round(myPosPct) + '%'} style={{ width: myPosPct + '%', background: 'linear-gradient(90deg, var(--gold), var(--acc-line4, rgba(212,175,55,0.78)))', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '4px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--k-0a0a0a, #0a0a0a)', fontWeight: 800 }}>
                                            {myPosPct >= 18 ? Math.round(myPosPct) + '%' : ''}
                                        </div>
                                        <div title={'Them: ' + Math.round(100 - myPosPct) + '%'} style={{ width: (100 - myPosPct) + '%', background: 'linear-gradient(90deg, rgba(124,107,248,0.76), var(--k-7c6bf8, #7c6bf8))', display: 'flex', alignItems: 'center', paddingLeft: '4px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--k-0a0a0a, #0a0a0a)', fontWeight: 800 }}>
                                            {(100 - myPosPct) >= 18 ? Math.round(100 - myPosPct) + '%' : ''}
                                        </div>
                                    </div>
                                </div>
                                {(() => {
                                    // Top rows per room + per-position expander at EVERY tier
                                    // (phone crossover, owner ask 2026-07-13): uncapped, 30-man
                                    // IDP rosters made this section scroll forever on desktop
                                    // too. Phone shows the top 4; desktop/iPad get more room,
                                    // so the cap is 6 there.
                                    const ROW_CAP = isPhone ? 4 : 6;
                                    const capped = !expandedRosterPos.has(summary.pos) && maxLen > ROW_CAP + 1;
                                    const shownLen = capped ? ROW_CAP : maxLen;
                                    return (
                                        <React.Fragment>
                                            {Array.from({ length: shownLen }).map((_, i) => {
                                                const mine = summary.myAtPos[i];
                                                const theirs = summary.theirAtPos[i];
                                                return (
                                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))' }}>
                                                        {renderRosterCell(mine, false, theirs)}
                                                        {renderRosterCell(theirs, true, mine)}
                                                    </div>
                                                );
                                            })}
                                            {maxLen > ROW_CAP + 1 && (
                                                <button type="button"
                                                    onClick={() => setExpandedRosterPos(prev => { const next = new Set(prev); if (next.has(summary.pos)) next.delete(summary.pos); else next.add(summary.pos); return next; })}
                                                    style={{ width: '100%', minHeight: '40px', background: 'var(--ov-1, rgba(255,255,255,0.015))', border: 'none', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.04))', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                                    {capped ? ('Show all ' + maxLen + ' ▾') : ('Show top ' + ROW_CAP + ' ▴')}
                                                </button>
                                            )}
                                        </React.Fragment>
                                    );
                                })()}
                            </div>
                        );
                    })}
                </div>
              </div>
            );
          })()}
        </React.Fragment>
        ) : (
        <React.Fragment>
            {renderFieldControls()}
            {compareScope === 'group'
                ? renderFieldAnalysis(
                    selectedGroupTeams,
                    'Custom Group',
                    cleanManualIds.length >= 2 ? 'Manual selection across the league; your roster is optional.' : 'Showing a default 3-team field until you pick at least 2 teams.',
                    { includeUser: false }
                )
                : compareScope === 'division'
                    ? renderFieldAnalysis(
                        selectedDivisionTeams,
                        getDivisionName(activeDivision),
                        divisionIncludesUser ? 'Your division includes your roster and division rivals.' : 'Division-only lens; your roster is not added to this field.',
                        { includeUser: divisionIncludesUser }
                    )
                    : renderFieldAnalysis(selectedLeagueTeams, 'Full League', 'Every opponent in the league, ranked against your roster.')}
        </React.Fragment>
        )}

        {/* Phone (P6): players-mode selection bar + add-player sheet. The bar
            shows ONLY at exactly 1 picked (never at 0 or ≥2); both the bar
            and the sheet drive the exact same addComparePlayer /
            setPlayerQuery seams as the desktop inline search. */}
        {_phoneKit && compareScope === 'players' ? (
        <React.Fragment>
            <WrPhoneActionBar visible={comparePlayerIds.length === 1} label="1 SELECTED"
                value={phonePickedName} tone="gold" actionLabel="ADD PLAYER"
                onAction={() => setSearchOpen(true)} onOpen={() => setSearchOpen(true)} />
            <WrPhoneSheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Add player to compare" desktop={null}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 14px 4px' }}>
                    <input value={playerQuery} onChange={e => setPlayerQuery(e.target.value)}
                        placeholder={phoneAtMax ? 'Four players max — remove one to swap' : 'Search players by name…'}
                        disabled={phoneAtMax}
                        style={{ ...selectStyle, width: '100%', fontSize: '16px', opacity: phoneAtMax ? 0.5 : 1 }} />
                    {/* Position-group filter */}
                    <div className="wr-hscroll" style={{ display: 'flex', gap: '5px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '2px' }}>
                        {['ALL', ...allPositions].map(pos => { const on = searchPos === pos, c = pos === 'ALL' ? 'var(--gold)' : (posColors[pos] || 'var(--silver)'); return <button key={pos} onClick={() => setSearchPos(pos)} disabled={phoneAtMax} style={{ flex: 'none', minHeight: '38px', padding: '6px 11px', borderRadius: '7px', ...mono, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', color: on ? c : 'var(--silver)', background: on ? 'rgba(255,255,255,0.06)' : 'transparent', border: '1px solid ' + (on ? c : 'var(--ov-6, rgba(255,255,255,0.12))') }}>{pos === 'ALL' ? 'All pos' : posLabel(pos)}</button>; })}
                    </div>
                    {/* Owned-by-team filter */}
                    <select value={searchTeam} onChange={e => setSearchTeam(e.target.value)} disabled={phoneAtMax} style={{ ...selectStyle, width: '100%', fontSize: '16px' }}>
                        <option value="ALL">Any team — all rosters</option>
                        {searchTeams.map(t => <option key={t.rid} value={t.rid}>{t.name}</option>)}
                    </select>
                    {(searchPos !== 'ALL' || searchTeam !== 'ALL') ? (
                        <div onClick={() => { setSearchPos('ALL'); setSearchTeam('ALL'); }} style={{ fontSize: '0.72rem', color: 'var(--gold)', cursor: 'pointer', padding: '0 2px 2px' }}>{'↺'} Clear filters</div>
                    ) : null}
                    {phoneSearchResults.map(r => (
                        <WrAssetRow key={r.pid} pos={r.pos} name={r.name} tag={r.team + (r.owner ? ' · ' + r.owner : ' · FA')}
                            slots={[{ label: valueShortLabel, value: r.dhq > 0 ? r.dhq.toLocaleString() : '—' }]}
                            onClick={() => { addComparePlayer(r.pid); setSearchOpen(false); }} />
                    ))}
                    {!phoneAtMax && playerQuery.trim().length < 2 && searchPos === 'ALL' && searchTeam === 'ALL' ? (
                        <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6, padding: '6px 2px' }}>Search by name, or filter by position or team above.</div>
                    ) : null}
                    {!phoneAtMax && (playerQuery.trim().length >= 2 || searchPos !== 'ALL' || searchTeam !== 'ALL') && !phoneSearchResults.length ? (
                        <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6, padding: '6px 2px' }}>No players match those filters.</div>
                    ) : null}
                </div>
            </WrPhoneSheet>
        </React.Fragment>
        ) : null}
      </div>
    );
}

window.CompareTab = CompareTab;
