// ══════════════════════════════════════════════════════════════════
// js/components/league-wire.js — window.WrLeagueWire
//
// The always-on ticker pinned to the bottom of Dynasty HQ. Carries the
// league-wide context into a full newspaper edition when opened:
//
//   real NFL scores (preseason / regular / postseason aware)
//   NFL-wide statistical leaders
//   this league's fantasy scores, biggest / closest / ugliest win
//   the biggest FAAB claim, risers & fallers, cutline, move count
//
// Self-sufficient by design: it owns every fetch it needs rather than
// receiving computed state, because it renders on EVERY league tab — not
// just the one that happens to compute standings. That costs one extra
// matchups request per league (a few KB, uncached upstream); the weekly
// stat fetches are sessionStorage-cached so they are free on repeat.
//
// Desktop keeps the ticker. Phones get an inline edition launcher; the
// newspaper opens in a native modal with its own scrolling and focus scope.
//
// Honesty rules carried over from the League Central original:
//   - a game that hasn't kicked shows kickoff time, never a fabricated 0-0
//   - preseason is always tagged PRE (a preseason final looks identical to
//     a real one otherwise)
//   - team D/ST units and Sleeper's TEAM_* aggregate rows are excluded from
//     "NFL leader", which is an individual award
//   - a trend off a near-zero baseline reports the absolute per-game move,
//     not a "+2100%" that is arithmetic rather than signal
//   - every item is dropped when its source data is missing, never
//     rendered as a placeholder
//
// Exposes: window.WrLeagueWire
// ══════════════════════════════════════════════════════════════════
function WrLeagueWire({ sidebarWidth = 0, currentLeague, standings, transactions, playersData, getOwnerName, getPlayerName, onOpenAllWire }) {

    const vp = window.WR?.useViewport?.() || {};
    const isPhone = !!vp.isPhone;
    const [expanded, setExpanded] = React.useState(false);
    const [readingSeason, setReadingSeason] = React.useState('current');
    const [teamFilter, setTeamFilter] = React.useState('all');
    const [past, setPast] = React.useState({ key: '', status: 'idle', seasons: [], complete: false });
    const dialogRef = React.useRef(null);

    const accountScope = window.App?.AccountStorage?.owner?.() || window.S?.myUserId || '';
    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const season = currentLeague?.season || '';
    const playoffTeams = Math.max(2, Number(currentLeague?.settings?.playoff_teams) || 6);
    const sameId = (a, b) => String(a) === String(b);

    const _getPlayerName = getPlayerName || (pid => playersData?.[pid]?.full_name || ('Player ' + pid));
    const _getOwnerName = getOwnerName || (rid => {
        const r = currentLeague?.rosters?.find(x => sameId(x.roster_id, rid));
        const u = currentLeague?.users?.find(x => x.user_id === r?.owner_id);
        return u?.display_name || u?.username || 'Unknown';
    });

    // ── This league's scoreboard ──
    const board = window.App.LeagueLiveScores.useScores({ league: currentLeague, enabled: !isPhone || expanded });

    const weekHasScores = board.rows.filter(r => Number(r.points) > 0).length >= 2;
    const statWeek = board.week ? Math.max(1, weekHasScores ? board.week : board.week - 1) : null;

    // Reuse the scored-history loader and cache used by the live standings.
    const startWeek = Math.max(1, Number(currentLeague?.settings?.start_week) || 1);
    const lastRegular = Math.min(18, (Number(currentLeague?.settings?.playoff_week_start) || 19) - 1);
    const nflState = window.S?.nflState;
    const seasonFinished = Number(season) < Number(nflState?.season) || (String(season) === String(nflState?.season) && nflState?.season_type === 'post');
    const historyEnd = Math.min(lastRegular, seasonFinished ? lastRegular : Math.max(0, Number(board.week || 1) - 1));
    const historyKey = `${leagueId}|${season}|${startWeek}|${historyEnd}`;
    const [archive, setArchive] = React.useState({ key: '', status: 'loading', weeks: [] });
    const [editionWeek, setEditionWeek] = React.useState('latest');
    const [historyRevision, setHistoryRevision] = React.useState(0);
    const [archiveRevision, setArchiveRevision] = React.useState(0);
    const recheckArchiveRef = React.useRef(false);
    React.useEffect(() => {
        if ((isPhone && !expanded) || !window.App.LeagueLiveScores.supported(currentLeague) || !window.App.LeagueLiveTable?.loadHistory) return undefined;
        let alive = true;
        const controller = new window.AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        setArchive(old => old.key === historyKey && ['ready', 'stale', 'refreshing'].includes(old.status) ? { ...old, status: 'refreshing' } : { key: historyKey, status: 'loading', weeks: [] });
        window.App.LeagueLiveTable.loadHistory({ league: currentLeague, week: historyEnd + 1, signal: controller.signal, force: historyRevision > 0 })
            .then(result => { if (alive) setArchive({ key: historyKey, status: 'ready', weeks: result.priorWeeks, checkedAt: result.updatedAt || null }); })
            .catch(() => { if (alive) setArchive(old => old.key === historyKey && ['ready', 'stale', 'refreshing'].includes(old.status) ? { ...old, status: 'stale' } : { key: historyKey, status: 'error', weeks: [] }); })
            .finally(() => clearTimeout(timeout));
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [historyKey, historyRevision, isPhone, expanded]);
    const archiveReady = archive.key === historyKey && ['ready', 'refreshing', 'stale'].includes(archive.status);
    const nameForStory = rid => {
        const t = (standings || []).find(x => sameId(x.rosterId, rid));
        return t?.teamName || t?.displayName || _getOwnerName(rid);
    };
    const pastKey = `${leagueId}|${season}`;
    React.useEffect(() => {
        if (!expanded || !window.App.LeagueLiveScores.supported(currentLeague)) return undefined;
        let alive = true;
        const controller = new window.AbortController();
        const timeout = setTimeout(() => controller.abort(), 90000);
        setPast(old => ({ key: pastKey, status: 'loading', seasons: old.key === pastKey ? old.seasons : [], complete: false }));
        const recheck = recheckArchiveRef.current; recheckArchiveRef.current = false;
        window.WrWireStories.loadArchive({ league: currentLeague, signal: controller.signal, force: recheck, retry: archiveRevision > 0,
            onProgress: result => { if (alive) setPast({ key: pastKey, status: 'loading', ...result }); } })
            .then(result => { if (alive) setPast({ key: pastKey, status: result.complete ? 'ready' : 'partial', ...result }); })
            .catch(() => { if (alive) setPast(old => ({ ...old, key: pastKey, status: 'partial', complete: false, reason: 'History took too long to load. Retry to check the remaining seasons.' })); })
            .finally(() => clearTimeout(timeout));
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [pastKey, expanded, archiveRevision]);
    const pastSeasons = past.key === pastKey ? past.seasons : [];
    const historicalEdition = readingSeason === 'current' ? null : pastSeasons.find(s => String(s.league.season) === readingSeason);
    const editionLeague = historicalEdition?.league || currentLeague;
    const editionName = rid => historicalEdition ? window.WrWireStories.oldName(editionLeague, rid) : nameForStory(rid);
    const editionStart = historicalEdition ? window.WrWireStories.bounds(editionLeague).start : startWeek;
    const editionEnd = historicalEdition ? window.WrWireStories.bounds(editionLeague).end : historyEnd;
    const selectedWeek = editionWeek === 'latest' ? editionEnd : Number(editionWeek);
    const storyThrough = editionWeek === 'all' || editionWeek === 'latest' ? editionEnd : Math.max(editionStart - 1, Math.min(editionEnd, selectedWeek));
    const headToHead = !window.App?.Chopped?.isChopped?.(editionLeague) && editionLeague?.type !== 'chopped' && editionLeague?.leagueSkin?.type !== 'chopped';
    const [rivalryRevision, setRivalryRevision] = React.useState(0);
    React.useEffect(() => {
        const refresh = () => setRivalryRevision(n => n + 1);
        window.addEventListener('wr:wire-rivalries-changed', refresh);
        window.addEventListener('storage', refresh);
        return () => { window.removeEventListener('wr:wire-rivalries-changed', refresh); window.removeEventListener('storage', refresh); };
    }, []);
    const edition = React.useMemo(() => window.WrWireStories.build({
        weeks: historicalEdition?.weeks || (archiveReady ? archive.weeks : []), start: editionStart, end: storyThrough,
        rivalries: window.WrWireRivalries?.list(editionLeague, pastSeasons) || [],
        nameFor: editionName, playerName: _getPlayerName, headToHead, league: editionLeague,
        priorSeasons: pastSeasons.filter(s => Number(s.league.season) < Number(editionLeague.season)),
        archiveComplete: past.key === pastKey && past.complete,
        board: historicalEdition || !archiveReady || editionWeek !== 'latest' ? null : board,
    }), [archive, archiveReady, historicalEdition, editionStart, storyThrough, editionWeek, standings, currentLeague, playersData, headToHead, past, board, rivalryRevision, accountScope]);
    const editionStories = edition.stories.filter(it => it.documentary || editionWeek === 'all' || it.week === selectedWeek)
        .concat(editionWeek === 'latest' ? edition.previews : []);

    // ── Top fantasy scorer per position (rostered players only) ──
    const [leaders, setLeaders] = React.useState([]);
    React.useEffect(() => {
        if ((isPhone && !expanded) || !statWeek || !currentLeague) return undefined;
        const SOS = window.App?.SOS;
        if (!SOS?.getWeekStats || typeof window.calcFantasyPts !== 'function') return undefined;
        let alive = true;
        setLeaders([]);
        Promise.resolve(SOS.getWeekStats(season, statWeek)).then(ws => {
            if (!alive) return;
            const scoring = currentLeague.scoring_settings || {};
            const seen = new Set();
            const rows = [];
            (currentLeague.rosters || []).forEach(r => {
                (r.players || []).forEach(pid => {
                    if (seen.has(pid)) return;
                    seen.add(pid);
                    const raw = (ws || {})[pid];
                    if (!raw) return;
                    const pts = window.calcFantasyPts(raw, scoring);
                    if (!(pts > 0)) return;
                    const p = playersData?.[pid] || {};
                    rows.push({
                        pid, pts: Math.round(pts * 10) / 10, name: _getPlayerName(pid),
                        pos: window.App?.normPos?.(p.position) || p.position || '??',
                    });
                });
            });
            rows.sort((a, b) => b.pts - a.pts);
            setLeaders(rows);
        }).catch(() => { /* skip */ });
        return () => { alive = false; };
    }, [leagueId, statWeek, season, isPhone, expanded]);

    // ── Live NFL scoreboard (phase-aware) ──
    const [nflScores, setNflScores] = React.useState([]);
    const [nflDesk, setNflDesk] = React.useState({ phase: null, current: { status: 'loading', games: [] }, previous: { status: 'loading', games: [] } });
    React.useEffect(() => {
        if (isPhone && !expanded) return undefined;
        const NC = window.App?.NflContext;
        if (!NC?.loadScoreboard) return undefined;
        let alive = true, id = null, warmup = null, tries = 0, busy = false;
        const tick = async () => {
            if (busy) return;
            busy = true;
            const ph = NC.currentPhase();
            const previous = NC.previousPhase(ph);
            const key = `${ph.season}|${ph.seasontype}|${ph.week}`;
            setNflDesk(old => old.key === key ? old : { key, phase: ph, previousPhase: previous, current: { status: 'loading', games: [] }, previous: { status: 'loading', games: [] } });
            const results = await Promise.allSettled([
                NC.loadScoreboard(ph.week, ph.season, ph.seasontype),
                expanded && previous ? NC.loadScoreboard(previous.week, previous.season, previous.seasontype) : Promise.resolve([]),
            ]);
            if (alive) {
                const [current, prior] = results;
                if (current.status === 'fulfilled') setNflScores(current.value.map(g => ({ ...g, isPre: !!ph.isPre, phaseWeek: ph.week })));
                else setNflScores([]);
                setNflDesk(old => ({ key, phase: ph, previousPhase: previous,
                    current: current.status === 'fulfilled' ? { status: 'ready', games: current.value } : { status: 'error', games: old.key === key ? old.current.games : [] },
                    previous: !expanded ? { status: 'loading', games: [] } : prior.status === 'fulfilled' ? { status: 'ready', games: prior.value } : { status: 'error', games: old.key === key ? old.previous.games : [] },
                }));
            }
            busy = false;
        };
        const start = () => {
            if (!window.S?.nflState && ++tries < 15) { warmup = setTimeout(start, 1000); return; }
            tick();
            id = setInterval(tick, 60000);
        };
        start();
        return () => { alive = false; if (id) clearInterval(id); if (warmup) clearTimeout(warmup); };
    }, [isPhone, expanded]);

    // ── NFL-wide leaders, for whatever phase/week is live ──
    const buildNflLeaders = React.useCallback((statsByPid, wk, phaseType) => {
        const w = wk
            ? (phaseType === 'pre' ? 'PRE' + wk + ' ' : phaseType === 'post' ? 'POST' + wk + ' ' : 'WK' + wk + ' ')
            : 'NFL ';
        const CATS = [
            { key: 'pass_yd', label: w + 'PASS', unit: 'yds' },
            { key: 'rush_yd', label: w + 'RUSH', unit: 'yds' },
            { key: 'rec_yd', label: w + 'REC', unit: 'yds' },
            { key: 'idp_sack', label: w + 'SACKS', unit: 'sacks', alt: 'sack' },
        ];
        return CATS.map(c => {
            let best = null;
            for (const pid in statsByPid) {
                // Resolve the player FIRST. Sleeper's map carries TEAM_*
                // aggregate rows whose whole-team totals outrank every
                // individual; picking the max first and filtering after means
                // these categories silently never render. Team D/ST units are
                // excluded for the same reason — an individual award.
                const p = playersData?.[pid];
                if (!p || !p.full_name || p.position === 'DEF') continue;
                const raw = statsByPid[pid];
                const v = Number(raw?.[c.key] ?? (c.alt ? raw?.[c.alt] : 0)) || 0;
                if (v > 0 && (!best || v > best.v)) best = { v, p };
            }
            if (!best) return null;
            const val = c.unit === 'sacks' ? (Math.round(best.v * 10) / 10) : Math.round(best.v);
            return {
                kind: 'nflstat', label: c.label,
                text: (best.p.full_name || 'Player') + ' ' + val + ' ' + c.unit + (best.p.team ? ' · ' + best.p.team : ''),
            };
        }).filter(Boolean);
    }, [playersData]);

    const nflStatCtx = React.useMemo(() => {
        const NC = window.App?.NflContext;
        const ph = NC?.currentPhase
            ? NC.currentPhase()
            : { seasontype: 2, week: Number(window.App?.WeeklyProj?.currentWeek?.()) || Number(board.week) || 1 };
        const type = ph.seasontype === 1 ? 'pre' : ph.seasontype === 3 ? 'post' : 'regular';
        // Hold last week's leaders until this week's games actually kick off —
        // a blank stats block from Tuesday to Sunday is worse than the most
        // recent real one.
        const started = (nflScores || []).some(g => g.state === 'in' || g.state === 'post');
        const week = started ? ph.week : Math.max(1, ph.week - 1);
        return { week, type, season: ph.season || season };
    }, [nflScores, board.week, season]);

    const [nflLeaders, setNflLeaders] = React.useState([]);
    React.useEffect(() => {
        if (isPhone && !expanded) return undefined;
        const SOS = window.App?.SOS;
        if (!SOS?.getWeekStats || !nflStatCtx.week) return undefined;
        let alive = true;
        Promise.resolve(SOS.getWeekStats(nflStatCtx.season, nflStatCtx.week, nflStatCtx.type))
            .then(ws => { if (alive) setNflLeaders(buildNflLeaders(ws || {}, nflStatCtx.week, nflStatCtx.type)); })
            .catch(() => { if (alive) setNflLeaders([]); });
        return () => { alive = false; };
    }, [nflStatCtx, buildNflLeaders, isPhone, expanded]);

    // ── Risers & fallers ──
    const [trendTick, setTrendTick] = React.useState(0);
    React.useEffect(() => {
        if (isPhone && !expanded) return undefined;
        const h = () => setTrendTick(t => t + 1);
        window.addEventListener('wr:hist-season-loaded', h);
        // The event alone is a race we lose often enough to matter: the
        // historical fetch is IndexedDB-backed and on a warm cache resolves
        // BEFORE this listener attaches, leaving trends stuck forever.
        const SC = window.App?.StatCatalog;
        const seasonNum = Number(season) || new Date().getFullYear();
        let tries = 0, timer = null;
        const check = () => {
            if (!SC) return;
            if (SC.historicalSeason(seasonNum - 1) || SC.historicalSeason(seasonNum - 2)) { setTrendTick(t => t + 1); return; }
            if (++tries < 20) timer = setTimeout(check, 500);
        };
        timer = setTimeout(check, 300);
        return () => {
            window.removeEventListener('wr:hist-season-loaded', h);
            if (timer) clearTimeout(timer);
        };
    }, [season, isPhone, expanded]);

    const trending = React.useMemo(() => {
        const SC = window.App?.StatCatalog;
        const rosters = currentLeague?.rosters || [];
        if ((isPhone && !expanded) || !SC || !rosters.length) return { risers: [], fallers: [] };
        const seasonNum = Number(season) || new Date().getFullYear();
        const y1 = seasonNum - 1, y2 = seasonNum - 2;
        SC.ensureHistSeason(y1); SC.ensureHistSeason(y2);
        const h1 = SC.historicalSeason(y1), h2 = SC.historicalSeason(y2);
        if (!h1 && !h2) return { risers: [], fallers: [] };
        const rows = [];
        const seen = new Set();
        rosters.forEach(r => {
            (r.players || []).forEach(pid => {
                if (seen.has(pid)) return;
                seen.add(pid);
                const p = playersData?.[pid]; if (!p) return;
                const pos = window.App?.normPos?.(p.position) || p.position;
                const topStat = SC.getTopStat(pos);
                if (!topStat) return;
                const pts = [[y2, h2 ? h2[pid] : null], [y1, h1 ? h1[pid] : null]]
                    .map(([yr, raw]) => ({ yr, v: raw ? SC.computeStat(topStat.key, raw, { perGame: true }) : null }))
                    .filter(pt => pt.v != null);
                if (pts.length < 2) return;
                if (topStat.format !== 'pct' && Math.max(...pts.map(pt => pt.v)) < 2) return;
                const t = SC.trendCalc(pts, topStat.format);
                if (t.delta == null || t.delta === 0) return;
                // The floor above only checks the HIGHER season, so 0.1 -> 2.2
                // tackles/gm still clears it and reports "+2100%". With no
                // usable baseline, report the absolute per-game move instead.
                const first = pts[0].v, last = pts[pts.length - 1].v;
                const usablePct = topStat.format === 'pct' || Math.min(first, last) >= 1;
                const delta = usablePct ? t.delta : Math.round((last - first) * 10) / 10;
                const unit = topStat.format === 'pct' ? 'pt' : (usablePct ? '%' : '/gm');
                if (!delta) return;
                const rel = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : (last - first) * 100;
                rows.push({
                    pid, name: _getPlayerName(pid), statLabel: topStat.short, delta, unit,
                    score: Math.max(-300, Math.min(300, rel)),
                });
            });
        });
        rows.sort((a, b) => b.score - a.score);
        return {
            risers: rows.filter(r => r.delta > 0).slice(0, 3),
            fallers: rows.filter(r => r.delta < 0).slice(-3).reverse(),
        };
    }, [currentLeague, playersData, season, trendTick, isPhone, expanded]);

    // ── Assemble ──
    const items = React.useMemo(() => {
        if (isPhone && !expanded) return [];
        const out = editionStories.slice();
        const nameFor = rid => {
            const t = (standings || []).find(x => sameId(x.rosterId, rid));
            return t ? (t.teamName || t.displayName || _getOwnerName(rid)) : _getOwnerName(rid);
        };

        // Real NFL leads, the way a sports ticker does.
        (nflScores || []).forEach(g => {
            const pre = g.isPre ? 'PRE ' : '';
            if (g.state === 'in') {
                out.push({ kind: 'nfllive', label: pre + (g.shortDetail || 'LIVE'), text: g.away + ' ' + g.awayScore + ' — ' + g.home + ' ' + g.homeScore });
            } else if (g.completed) {
                out.push({ kind: 'nfl', label: pre + 'FINAL', text: g.away + ' ' + g.awayScore + ' — ' + g.home + ' ' + g.homeScore });
            } else {
                out.push({ kind: 'nfl', label: g.isPre ? 'PRE WK' + (g.phaseWeek || '') : 'NFL', text: g.away + ' @ ' + g.home + ' · ' + (g.shortDetail || 'Scheduled') });
            }
        });
        (nflLeaders || []).forEach(l => out.push(l));

        // This league shares the same scored snapshot as Command Center.
        const scoreRows = (board.rows || []).map(row => ({ ...row, points: window.App.LeagueLiveScores.rosterPoints(row) })).filter(row => row.points != null);
        if (!historicalEdition && edition.high !== null && Number(board.week) > historyEnd && Number(board.week) <= lastRegular && !board.error) {
            scoreRows.filter(r => r.points >= edition.high * .9 && r.points > 0).forEach(r => out.push({ kind: 'story', category: 'Record watch', rosterIds: [r.roster_id], weight: 60, label: 'RECORD WATCH · WK ' + board.week,
                text: nameFor(r.roster_id) + (r.points > edition.high ? ' is above the season scoring mark' : ' is closing in on the season scoring mark'),
                body: Number(r.points).toFixed(2) + ' points so far against the completed-week high of ' + Number(edition.high).toFixed(2) + '. Provisional: the current week is not yet part of the record book.' }));
        }
        const pairs = Object.values(scoreRows.reduce((acc, r) => {
            if (r.matchup_id == null) return acc;
            (acc[r.matchup_id] = acc[r.matchup_id] || []).push(r);
            return acc;
        }, {})).filter(p => p.length === 2);
        pairs.forEach(pair => {
            if (!pair.some(p => Number(p.points) > 0)) return;
            const [a, b] = [...pair].sort((x, y) => Number(y.points) - Number(x.points));
            out.push({ kind: 'score', label: (board.error ? 'LAST UPDATE · WK ' : 'WK ') + board.week, text: nameFor(a.roster_id) + ' ' + Number(a.points).toFixed(1) + ' — ' + nameFor(b.roster_id) + ' ' + Number(b.points).toFixed(1) });
        });
        const margins = pairs.filter(p => p.some(x => Number(x.points) > 0)).map(pair => {
            const [a, b] = [...pair].sort((x, y) => Number(y.points) - Number(x.points));
            return { m: Number(a.points) - Number(b.points), win: a, lose: b };
        }).sort((x, y) => y.m - x.m);
        if (margins.length) {
            const big = margins[0], close = margins[margins.length - 1];
            out.push({ kind: 'rec', label: 'LARGEST MARGIN', text: nameFor(big.win.roster_id) + ' +' + big.m.toFixed(1) + ' over ' + nameFor(big.lose.roster_id) });
            if (margins.length > 1) out.push({ kind: 'rec', label: 'CLOSEST', text: nameFor(close.win.roster_id) + ' +' + close.m.toFixed(1) + ' over ' + nameFor(close.lose.roster_id) });
            const ugly = margins.slice().sort((x, y) => Number(x.win.points) - Number(y.win.points))[0];
            if (ugly) out.push({ kind: 'rec', label: 'LOWEST LEADING SCORE', text: nameFor(ugly.win.roster_id) + ' leads with ' + Number(ugly.win.points).toFixed(1) });
            let hi = null;
            scoreRows.forEach(r => { const p = Number(r.points) || 0; if (!hi || p > hi.p) hi = { p, rid: r.roster_id }; });
            if (hi && hi.p > 0) out.push({ kind: 'top', label: 'HIGH SCORE', text: nameFor(hi.rid) + ' ' + hi.p.toFixed(1) });
        }

        const positions = (window.getLeaguePositions ? window.getLeaguePositions({ league: currentLeague }) : ['QB', 'RB', 'WR', 'TE']) || [];
        positions.forEach(pos => {
            const top = leaders.find(r => r.pos === pos);
            if (top) out.push({ kind: 'top', label: 'WK ' + statWeek + ' TOP ' + pos, pid: top.pid, text: top.name + ' ' + top.pts.toFixed(1) });
        });

        const cutoff = Date.now() - 7 * 86400000;
        const recent = (transactions || []).filter(t => (t.created || 0) >= cutoff && (!t.status || t.status === 'complete'));
        recent.filter(t => t.type === 'trade' && t.status === 'complete').slice().sort((a, b) => b.created - a.created).slice(0, 3).forEach(t => {
            const owners = (t.roster_ids || []).map(nameFor);
            if (owners.length < 2) return;
            const assets = Object.entries(t.adds || {}).map(([pid, rid]) => _getPlayerName(pid) + ' → ' + nameFor(rid));
            (t.draft_picks || []).forEach(p => assets.push(p.season + ' round ' + p.round + ' pick → ' + nameFor(p.owner_id)));
            out.push({ kind: 'story', category: 'Trade desk', rosterIds: t.roster_ids || [], weight: 60, label: 'TRADE DESK · LAST 7 DAYS', text: owners.join(' & ') + ' strike a deal', body: assets.length ? assets.join(' · ') : 'A completed trade is on the books.' });
        });
        const bids = recent.filter(t => Number(t.settings?.waiver_bid) > 0)
            .sort((a, b) => Number(b.settings.waiver_bid) - Number(a.settings.waiver_bid));
        if (bids.length) {
            const b = bids[0];
            const got = Object.keys(b.adds || {})[0];
            out.push({ kind: 'faab', label: 'TOP FAAB', pid: got, text: _getOwnerName(b.roster_ids?.[0]) + ' $' + b.settings.waiver_bid + (got ? ' → ' + _getPlayerName(got) : '') });
        }

        if (bids.some(t => t.status === 'complete')) {
            const bid = bids.find(t => t.status === 'complete'), pid = Object.keys(bid.adds || {})[0];
            if (pid) out.push({ kind: 'story', category: 'Waiver desk', rosterIds: [bid.adds[pid]], weight: 50, label: 'WAIVER DESK · LAST 7 DAYS', text: nameFor(bid.adds[pid]) + ' makes the biggest FAAB splash', body: '$' + bid.settings.waiver_bid + ' brings in ' + _getPlayerName(pid) + ' — the largest completed bid in the loaded transactions from the last seven days.', pid });
        }

        (trending.risers || []).forEach(r => out.push({ kind: 'trend', label: (Number(season) - 2) + '–' + (Number(season) - 1) + ' RISER', pid: r.pid, text: r.name + ' ' + r.statLabel + ' +' + r.delta + r.unit }));
        (trending.fallers || []).forEach(r => out.push({ kind: 'trend', label: (Number(season) - 2) + '–' + (Number(season) - 1) + ' FALLER', pid: r.pid, text: r.name + ' ' + r.statLabel + ' ' + r.delta + r.unit }));

        if ((standings || []).length > playoffTeams && standings.some(t => Number(t.wins) + Number(t.losses) > 0)) {
            const inT = standings[playoffTeams - 1], outT = standings[playoffTeams];
            if (inT && outT) {
                const gb = ((inT.wins - outT.wins) + (outT.losses - inT.losses)) / 2;
                out.push({
                    kind: 'rec', label: 'CUTLINE',
                    text: gb === 0
                        ? (playoffTeams + 'th and ' + (playoffTeams + 1) + 'th seed are tied')
                        : gb.toFixed(1) + ' game' + (gb === 1 ? '' : 's') + ' separate the ' + playoffTeams + 'th and ' + (playoffTeams + 1) + 'th seed',
                });
            }
        }
        if (recent.length) {
            const trades = recent.filter(t => t.type === 'trade').length;
            out.push({
                kind: 'faab', label: 'MOVES',
                text: recent.length + ' this week · ' + trades + ' trade' + (trades === 1 ? '' : 's') + ' · ' + (recent.length - trades) + ' other move' + ((recent.length - trades) === 1 ? '' : 's'),
            });
        }
        if (historicalEdition || editionWeek !== 'latest') return editionStories;
        const priority = { record: -3, story: -2, recap: -1, nfllive: 0, score: 1, faab: 2, rec: 3, top: 4, nfl: 5, nflstat: 6, trend: 7 };
        return out.filter((item, i) => out.findIndex(x => x.kind === item.kind && x.text === item.text) === i).sort((a, b) => priority[a.kind] - priority[b.kind]);
    }, [editionStories, nflScores, nflLeaders, board, leaders, transactions, trending, standings, currentLeague, playoffTeams, isPhone, expanded, historicalEdition, editionWeek]);

    const [topic, setTopic] = React.useState('all');
    const [index, setIndex] = React.useState(0);
    const [paused, setPaused] = React.useState(false);
    const [hovered, setHovered] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const [reduced, setReduced] = React.useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const [search, setSearch] = React.useState('');
    const [studio, setStudio] = React.useState(null);
    const reading = window.WrWireReading;
    const studioScope = `${accountScope}|${pastKey}|${editionLeague.league_id || editionLeague.id}|${editionWeek}|${storyThrough}`;
    const toggleRef = React.useRef(null);
    React.useEffect(() => {
        const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (!mq) return undefined;
        const change = () => setReduced(mq.matches);
        mq.addEventListener('change', change);
        return () => mq.removeEventListener('change', change);
    }, []);
    React.useEffect(() => { setIndex(0); }, [leagueId, topic]);
    React.useEffect(() => { setEditionWeek('latest'); setReadingSeason('current'); setTeamFilter('all'); setSearch(''); setExpanded(false); }, [leagueId, season]);
    React.useEffect(() => {
        if (expanded) dialogRef.current?.showModal?.();
    }, [expanded]);
    const visible = items.filter(it => (topic === 'history' || !it.documentary) && (topic === 'all' || (topic === 'history' ? it.documentary : topic === 'stories' ? ['story', 'record', 'recap'].includes(it.kind) : topic === 'matchups' ? it.preview : topic === 'recaps' ? it.kind === 'recap' : topic === 'records' ? it.kind === 'record' : topic === 'rivalries' ? it.category === 'Rivalry watch' || it.category === 'Revenge game' : topic === 'nfl' ? it.kind.startsWith('nfl') : topic === 'trends' ? it.kind === 'trend' : !it.kind.startsWith('nfl') && it.kind !== 'trend')));
    const currentIndex = visible.length ? index % visible.length : 0;
    React.useEffect(() => {
        if (isPhone || paused || hovered || focused || expanded || reduced || visible.length < 2) return undefined;
        const timer = setInterval(() => setIndex(i => (i + 1) % visible.length), 9000);
        return () => clearInterval(timer);
    }, [isPhone, paused, hovered, focused, expanded, reduced, visible.length]);
    if (!currentLeague) return null;
    const current = visible[currentIndex];
    const close = () => { setStudio(null); setExpanded(false); window.requestAnimationFrame?.(() => toggleRef.current?.focus()); };
    const studioAvailable = headToHead && window.App.LeagueLiveScores.supported(editionLeague) && typeof window.WrWireStudio === 'function';
    const openStudio = story => setStudio({ scope: studioScope, story });
    const race = studioAvailable ? window.WrWirePlayoffs?.race({ league: editionLeague, edition: { ...edition, expectedThrough: storyThrough } }) : null;
    const playerLink = it => it.pid && typeof window.openPlayerModal === 'function';
    const openItem = () => setExpanded(true);
    const allEditorial = visible.filter(it => ['story', 'record', 'recap'].includes(it.kind))
        .filter(it => teamFilter === 'all' || (it.rosterIds || []).some(rid => sameId(rid, teamFilter)))
        .filter(it => reading.matches(it, search))
        .sort((a, b) => (topic === 'history' ? (b.eventSeason || 0) - (a.eventSeason || 0) : 0) || (editionWeek === 'all' ? (b.week || 0) - (a.week || 0) : 0) || (b.weight || 40) - (a.weight || 40));
    // A front page is edited, not a dump of every generated headline.
    const editorial = topic === 'all' && !search.trim() ? window.WrWireStories.frontPage(allEditorial) : allEditorial;
    const lookback = window.WrWireStories.weeklyLookback(edition.stories.filter(it => teamFilter === 'all' || (it.rosterIds || []).some(rid => sameId(rid, teamFilter))), `${leagueId}:${editionLeague.season}:${storyThrough}`);
    const liveItems = visible.filter(it => !['story', 'record', 'recap'].includes(it.kind));
    const lead = editorial[0];
    const fullCoverage = past.key === pastKey && past.complete && (historicalEdition || archiveReady) && edition.completedThrough === storyThrough;
    const archiveTitle = historicalEdition || editionWeek !== 'latest' ? 'Archive through ' + editionLeague.season + ' · Wk ' + edition.completedThrough : fullCoverage && !edition.archive.rulesChanged ? 'All-time · linked seasons' : 'Available archive · same scoring';
    const topics = [['all', 'Front page'], ['stories', 'Stories'], ['matchups', 'This week'], ['recaps', 'Recaps'], ['records', 'Records'], ['rivalries', 'Rivalries'], ...(edition.chronicle ? [['history', 'History']] : []), ['league', 'League feed'], ['nfl', 'NFL'], ['trends', 'Trends']];
    const cards = editorial.slice(lead ? 1 : 0);
    const changeSeason = value => { setReadingSeason(value); setEditionWeek('latest'); setTeamFilter('all'); setIndex(0); };
    const articleId = it => 'wire-article-' + encodeURIComponent(it.id || it.label + it.text);
    const initials = name => String(name || 'League').trim().split(/\s+/).map(w => [...w][0]).slice(0, 2).join('').toUpperCase();
    const teamBadge = rid => {
        const roster = editionLeague.rosters?.find(r => sameId(r.roster_id, rid));
        const user = editionLeague.users?.find(u => u.user_id === roster?.owner_id);
        const avatar = user?.avatar;
        return <span className="wr-journal-team-badge"><span>{initials(editionName(rid))}</span>{avatar && /^[a-zA-Z0-9_-]+$/.test(avatar) && <img src={'https://sleepercdn.com/avatars/thumbs/' + avatar} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />}</span>;
    };
    const storyVisual = (it, hero) => {
        if (it.documentary) return <figure className="wr-journal-art is-history" aria-label={'League archive · ' + it.eventSeason}>{hero && <span className="wr-journal-art-label">{it.category}</span>}<strong>{it.eventSeason}</strong>{hero && <figcaption>From the league archives</figcaption>}</figure>;
        const ids = (it.rosterIds || []).slice(0, 2), pid = it.featuredPid || it.pid;
        return <figure className={'wr-journal-art' + (ids.length > 1 ? ' is-matchup' : '') + (pid ? ' has-player' : '')} aria-label={pid ? _getPlayerName(pid) + ' · player portrait' : ids.map(editionName).join(' vs. ') || 'League spotlight'}>
            {hero && <span className="wr-journal-art-label">{it.category || 'League spotlight'}</span>}
            {pid ? <><span className="wr-journal-art-monogram" aria-hidden="true">{initials(_getPlayerName(pid))}</span><img className="wr-journal-player-photo" src={'https://sleepercdn.com/content/nfl/players/' + encodeURIComponent(pid) + '.jpg'} alt={_getPlayerName(pid)} loading={hero ? 'eager' : 'lazy'} onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement.classList.add('is-image-missing'); }} />{hero && <figcaption>{_getPlayerName(pid)}</figcaption>}</>
                : <div className="wr-journal-art-teams">{ids.length ? ids.map((rid, i) => <React.Fragment key={rid}>{i > 0 && <span className="wr-journal-versus">VS</span>}<div>{teamBadge(rid)}{hero && <span>{editionName(rid)}</span>}</div></React.Fragment>) : <strong className="wr-journal-art-monogram">W.</strong>}</div>}
            {hero && !pid && it.metric && <figcaption><strong>{it.metric}</strong><span>{it.metricLabel}</span></figcaption>}
        </figure>;
    };
    const storyContext = it => <>{studioAvailable && (it.broadcast || it.documentary && it.category === 'Championship history') && <button type="button" className="wr-wire-studio-link" onClick={() => openStudio(it)}>Open graphic breakdown →</button>}{it.body && <div className="wr-journal-body">{it.body.split(/\n\n+/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>}{it.related?.length > 0 && <details className="wr-journal-context"><summary>The story behind the score</summary>{it.related.map((r, i) => <div key={i}><strong>{r.label}</strong>{r.text.split(/\n\n+/).map((paragraph, n) => <p key={n}>{paragraph}</p>)}</div>)}</details>}{it.sources?.length > 0 && <details className="wr-journal-context"><summary>Sources & historical scope</summary><p>Historical facts retain their original season. Playoff and award history does not add to regular-season records.</p><ul>{it.sources.map((s, i) => <li key={i}>{s.workbook ? `${s.workbook} · ${s.sheet}!${s.range}` : <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>}</li>)}</ul></details>}{playerLink(it) && <button type="button" onClick={() => { close(); window.openPlayerModal(it.pid); }}>View player →</button>}</>;
    const storyCard = (it, hero = false) => <article id={articleId(it)} tabIndex={-1} key={it.id || it.label + it.text} className={'wr-journal-story' + (hero ? ' is-lead' : '')}>
        {storyVisual(it, hero)}
        <div className="wr-journal-story-copy"><div className="wr-journal-kicker"><span>{it.label}</span></div>
        <h3>{it.text}</h3><div className="wr-journal-byline">The Wire <span>·</span> {it.documentary ? 'From the archives' : it.preview ? 'Matchup preview' : it.kind === 'recap' ? 'Game report' : 'League report'}</div>
        {hero && it.matchup && <div className="wr-journal-scoreline">{it.matchup.map(t => <div key={t.rid}>{teamBadge(t.rid)}<span>{t.name}</span><strong>{Number(t.score).toFixed(2)}</strong></div>)}</div>}
        {!hero && reading.deck(it) && <p className="wr-story-dek">{reading.deck(it)}</p>}
        {hero ? storyContext(it) : <details className="wr-journal-read"><summary>Read story & context <span aria-hidden="true">→</span></summary>{storyContext(it)}</details>}
        </div>
    </article>;
    const selectedScores = historicalEdition || editionWeek !== 'latest'
        ? (historicalEdition?.weeks || (archiveReady ? archive.weeks : [])).find(w => Number(w.week) === storyThrough)?.rows || [] : board.rows || [];
    const scoreGroups = new Map();
    if (headToHead) selectedScores.forEach(r => { if (r.matchup_id != null) { const key = String(r.matchup_id); if (!scoreGroups.has(key)) scoreGroups.set(key, []); scoreGroups.get(key).push(r); } });
    const scorePairs = [...scoreGroups.values()].filter(pair => pair.length === 2);
    const scoresFinal = !!historicalEdition || editionWeek !== 'latest';
    const scoreWeek = scoresFinal ? storyThrough : board.week;
    const jumpToStory = it => {
        const article = dialogRef.current?.querySelector('[id="' + articleId(it) + '"]');
        if (!article) return;
        const read = article.querySelector('.wr-journal-read');
        if (read) read.open = true;
        article.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
        article.focus({ preventScroll: true });
    };
    const recordCard = (title, value, holders, caption) => <article className="wr-journal-record"><span>{title}</span><strong>{value == null ? '—' : Number(value).toFixed(2)}</strong><small>{caption}</small>{holders.slice(0, 3).map((r, i) => <p key={i}>{r.name || editionName(r.rosterId)} <small>{r.season || editionLeague.season} · Wk {r.week}</small></p>)}{holders.length > 3 && <details><summary>+{holders.length - 3} shared marks</summary>{holders.slice(3).map((r, i) => <p key={i}>{r.name || editionName(r.rosterId)} · {r.season || editionLeague.season} · Wk {r.week}</p>)}</details>}</article>;
    return <section className={'wr-wire' + (isPhone ? ' is-phone' : '')} aria-label="League wire" style={{ '--wire-inset': sidebarWidth + 'px' }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
        {isPhone ? <button ref={toggleRef} type="button" className="wr-wire-mobile-launch" onClick={() => setExpanded(true)} aria-haspopup="dialog"><span><strong>THE WIRE</strong><small>Your league. Every chapter.</small></span><span>Read the edition ↗</span></button> : <>
            <button ref={toggleRef} type="button" className="wr-wire-brand" aria-expanded={expanded} aria-haspopup="dialog" aria-controls="wr-wire-panel" onClick={() => setExpanded(v => !v)}>LEAGUE WIRE {expanded ? '▾' : '▴'}</button>
            <select value={topic} aria-label="Wire topic" onChange={e => setTopic(e.target.value)}>{topics.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <button type="button" className="wr-wire-headline" title={current ? current.label + ': ' + current.text : undefined} onClick={openItem}>{current ? <><span className={'wr-wire-tag' + (current.kind === 'nfllive' ? ' is-live' : '')}>{historicalEdition ? editionLeague.season + ' · ' : ''}{current.label}</span>{current.text}</> : 'Open The Wire for league stories and the season archive.'}</button>
            <span className="wr-wire-count">{visible.length ? currentIndex + 1 : 0}/{visible.length}</span>
            <button type="button" aria-label="Previous update" disabled={visible.length < 2} onClick={() => setIndex((currentIndex - 1 + visible.length) % visible.length)}>‹</button>
            <button type="button" aria-label={paused ? 'Resume automatic updates' : 'Pause automatic updates'} aria-pressed={paused || reduced} disabled={reduced} title={reduced ? 'Automatic rotation disabled by your reduced-motion preference' : undefined} onClick={() => setPaused(v => !v)}>{reduced ? 'Manual' : paused ? 'Play' : 'Pause'}</button>
            <button type="button" aria-label="Next update" disabled={visible.length < 2} onClick={() => setIndex((currentIndex + 1) % visible.length)}>›</button>
        </>}
        {expanded && <dialog ref={dialogRef} id="wr-wire-panel" className="wr-journal" aria-labelledby="wr-journal-title" onCancel={close} onClose={close}>
            <div className="wr-journal-bar"><h2 id="wr-journal-title">The Wire<span>.</span></h2><span>{editionLeague.name || 'Your league'} <span className="wr-journal-dot">•</span> {editionLeague.season}</span><span className="wr-journal-bar-actions">{onOpenAllWire && <button type="button" onClick={() => { close(); onOpenAllWire(); }}>All my leagues</button>}<button type="button" onClick={close} aria-label="Close The Wire">Close ×</button></span></div>
            <nav className="wr-journal-nav" aria-label="Wire sections">{topics.map(([value, label]) => <button key={value} type="button" aria-pressed={topic === value} onClick={() => { setTopic(value); setIndex(0); }}>{label}</button>)}</nav>
            {topic !== 'nfl' && scorePairs.length > 0 && <section className="wr-journal-scorestrip" aria-label={'League scoreboard · Week ' + scoreWeek}>
                <div className="wr-journal-scorestrip-label"><strong>WEEK {scoreWeek}</strong><span>{scoresFinal ? 'Results' : 'Scoreboard'}</span></div>
                <div className="wr-journal-scores" tabIndex={0} aria-label="Scroll league matchups">{scorePairs.map((pair, i) => {
                    const hasPoints = pair.some(r => Number(window.App.LeagueLiveScores.rosterPoints(r)) !== 0 && window.App.LeagueLiveScores.rosterPoints(r) != null);
                    return <div className="wr-journal-score-tile" key={i}><span className={'wr-journal-score-status' + (!scoresFinal && hasPoints ? ' is-current' : '')}>{scoresFinal ? 'Final' : board.error ? 'Last update' : hasPoints ? 'Score update' : 'Awaiting scores'}</span>{pair.map(r => { const pts = window.App.LeagueLiveScores.rosterPoints(r); return <div key={r.roster_id}>{teamBadge(r.roster_id)}<span title={editionName(r.roster_id)}>{editionName(r.roster_id)}</span><strong>{pts == null || (!scoresFinal && !hasPoints) ? '—' : Number(pts).toFixed(2)}</strong></div>; })}</div>;
                })}</div>
            </section>}
            <div className="wr-journal-paper">
                {topic !== 'nfl' && <><header className="wr-journal-masthead"><div><span>{historicalEdition ? 'FROM THE ARCHIVE' : 'YOUR LEAGUE, COVERED'}</span><h3>{topics.find(([value]) => value === topic)?.[1] === 'Front page' ? 'League news' : topics.find(([value]) => value === topic)?.[1]}</h3></div><p>{editionLeague.season} <span> / </span> {editionWeek === 'all' ? 'Season in review' : selectedWeek >= editionStart ? 'Week ' + selectedWeek + ' edition' : 'Opening week'}</p></header>
                <div className="wr-wire-edition-strip"><div><p>{edition.completedThrough >= editionStart ? `Results through Week ${edition.completedThrough}` : 'Awaiting the first completed results'}{!historicalEdition && editionWeek === 'latest' && board.week <= lastRegular ? ` · Week ${board.week} matchups` : ''}</p>{!historicalEdition && archive.key === historyKey && archive.checkedAt && <small>{archive.status === 'stale' ? 'Saved results · ' : archive.status === 'refreshing' ? 'Refreshing · ' : 'Results checked '}{reading.checked(archive.checkedAt)}</small>}</div><button type="button" disabled={archive.status === 'refreshing'} onClick={() => { setHistoryRevision(n => n + 1); board.refresh?.(); }}>{archive.status === 'refreshing' ? 'Refreshing…' : 'Refresh edition'}</button>{studioAvailable && <button type="button" onClick={() => openStudio(null)}>Playoff picture →</button>}</div>
                <div className="wr-wire-reader-tools"><div className="wr-wire-search"><label>Find a story<input type="search" aria-label="Search this Wire" placeholder="Search this edition" value={search} onChange={e => setSearch(e.target.value)} /></label>{search && <button type="button" onClick={() => setSearch('')}>Clear search</button>}</div>
                <details className="wr-journal-tools"><summary>Editions & teams <span className={teamFilter !== 'all' ? 'is-active' : ''}>{teamFilter !== 'all' ? editionName(teamFilter) : 'Browse another season, week, or team'}</span></summary>
                <div className="wr-journal-filters">
                    <label>Season<select aria-label="Story season" value={readingSeason} onChange={e => changeSeason(e.target.value)}><option value="current">{season} · Current league</option>{pastSeasons.map(s => <option key={s.league.league_id} value={s.league.season}>{s.league.season}</option>)}</select></label>
                    <label>Edition<select aria-label="Story week" value={editionWeek} onChange={e => { setEditionWeek(e.target.value); setIndex(0); }}><option value="latest">Latest edition</option><option value="all">Season archive</option>{Array.from({ length: Math.max(0, editionEnd - editionStart + 1) }, (_, i) => editionEnd - i).map(w => <option key={w} value={w}>Week {w}</option>)}</select></label>
                    <label>Team<select aria-label="Stories about team" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}><option value="all">Whole league</option>{(editionLeague.rosters || []).map(r => <option key={r.roster_id} value={r.roster_id}>{editionName(r.roster_id)}</option>)}</select></label>
                    <button className="wr-journal-refresh" type="button" onClick={() => { setHistoryRevision(n => n + 1); board.refresh?.(); }}>Refresh edition ↻</button>
                </div>
                </details></div>
                {!window.App.LeagueLiveScores.supported(currentLeague) ? <p className="wr-journal-notice">Season stories are available for connected Sleeper leagues.</p> : !historicalEdition && archive.key === historyKey && archive.status === 'error' ? <p className="wr-journal-notice" role="status">Completed scores could not load. Refresh the edition to retry.</p> : !historicalEdition && !archiveReady ? <p className="wr-journal-notice" role="status">The newsroom is gathering completed scores…</p> : null}
                {past.key === pastKey && past.status === 'loading' && <p className="wr-wire-coverage-note">Adding earlier seasons in the background · {pastSeasons.length} loaded</p>}
                {past.key === pastKey && past.status === 'partial' && <p className="wr-wire-coverage-note">Earlier history is incomplete. <button type="button" onClick={() => setArchiveRevision(n => n + 1)}>Retry history</button></p>}
                {!historicalEdition && archive.key === historyKey && archive.status === 'stale' && <p className="wr-journal-notice" role="status">The refresh didn’t finish. You’re reading the last saved results; use Refresh edition to try again.</p>}
                {!historicalEdition && board.error && <p className="wr-journal-notice" role="status">Live scores could not refresh. {board.updatedAt ? `Last checked ${reading.checked(board.updatedAt)}.` : 'Scores are unavailable right now.'}</p>}
                </>}
                {topic === 'rivalries' && !historicalEdition && headToHead && window.WrWireRivalryEditor && <window.WrWireRivalryEditor key={leagueId} league={currentLeague} priorSeasons={pastSeasons} />}
                {topic === 'nfl' ? <WrNflDesk desk={nflDesk} leaders={nflLeaders} /> : <div className="wr-journal-layout"><main className={'wr-journal-main' + (cards.length ? '' : ' is-single')}>
                    {lead ? storyCard(lead, true) : search.trim() ? <article className="wr-journal-empty"><h3>No matching stories</h3><p>Try another name or clear your search to read this edition.</p><button type="button" onClick={() => setSearch('')}>Clear search</button></article> : <article className="wr-journal-empty"><span>THE NEXT CHAPTER</span><h3>{edition.stories.length || teamFilter !== 'all' ? 'A quiet edition here.' : 'The first chapter is still being written.'}</h3><p>{edition.stories.length || teamFilter !== 'all' ? 'Try another section, team, or week to follow a different story.' : 'The schedule is set. Rivalries are waiting. Recaps arrive after the first completed regular-season week.'}</p></article>}
                    {cards.length > 0 && <div className="wr-journal-grid">{cards.map(it => storyCard(it))}</div>}
                    {topic === 'all' && !search.trim() && lookback && <section className="wr-wire-lookback" aria-label="This week’s lookback"><header><span>FROM THE ARCHIVE · {lookback.eventSeason}</span><h3>This week’s lookback</h3><p>One chapter from the past. Current stories lead the edition above.</p></header>{storyCard(lookback)}</section>}
                    {allEditorial.length > editorial.length && <div className="wr-journal-more"><span>{allEditorial.length - editorial.length} more headlines in this edition</span><button type="button" onClick={() => setTopic('stories')}>Read all stories →</button><button type="button" onClick={() => setTopic('recaps')}>Every game recap →</button></div>}
                    {liveItems.length > 0 && <details className="wr-journal-live" open={['nfl', 'trends', 'league'].includes(topic)}><summary>{topic === 'nfl' ? 'Around the NFL' : topic === 'trends' ? 'Player trends' : 'The live desk'} · {liveItems.length} updates</summary><ul>{liveItems.map((it, i) => <li key={it.label + ':' + i}><span className="wr-wire-tag">{it.label}</span>{it.text}{playerLink(it) && <button type="button" onClick={() => { close(); window.openPlayerModal(it.pid); }}>View player →</button>}</li>)}</ul></details>}
                </main><aside className="wr-journal-rail" aria-label="League record book and rivalries">
                    {editorial.length > 0 && <section className="wr-journal-headlines"><h3>{topic === 'history' ? 'From the archive' : 'Headlines'}</h3><ul>{editorial.slice(0, 7).map(it => <li key={it.id || it.text}><button type="button" onClick={() => jumpToStory(it)}>{it.text}</button></li>)}</ul></section>}
                    <details className="wr-journal-rail-section" open={topic === 'records'}><summary>The record book <span>Regular season</span></summary>
                        {recordCard('Season scoring high', edition.high, edition.records, 'points · ' + editionLeague.season)}
                        {recordCard(archiveTitle, edition.archive.high, edition.archive.records, 'scoring high · ' + (edition.archive.seasons.join(' / ') || 'awaiting scores'))}
                        {edition.archive.rulesChanged && recordCard(fullCoverage && !historicalEdition && editionWeek === 'latest' ? 'All-time high · original scoring' : 'Historical high · original scoring', edition.archive.historicalHigh, edition.archive.historicalRecords, 'original-era points · ' + edition.archive.allSeasons.join(' / '))}
                        {recordCard('Largest archived win', edition.archive.margin, edition.archive.margins, 'point margin · same scoring')}
                        {edition.archive.rulesChanged && <p className="wr-journal-footnote">Scoring or starting positions changed in earlier seasons. The original-scoring high keeps each era's rules; the other point records compare matching rules only.</p>}
                    </details>
                    {edition.chronicle && <details className="wr-journal-rail-section" open={topic === 'history'}><summary>League chronicles <span>Before {editionLeague.season}</span></summary><p className="wr-journal-footnote">{edition.chronicle.coverage}</p><ol className="wr-journal-history">{edition.chronicle.finals.filter(f => teamFilter === 'all' || f.owners.includes(editionLeague.rosters?.find(r => sameId(r.roster_id, teamFilter))?.owner_id)).map(f => <li key={f.id}><strong>{f.season} · {f.winner}</strong><p>{f.loser ? `Defeated ${f.loser}${f.scores ? ' · ' + f.scores.map(n => Number(n).toFixed(2)).join('–') : ''}` : 'Champion listed; final score unrecorded'}</p></li>)}</ol><p className="wr-journal-footnote">Season-end honors appear in later-season editions. Missing or conflicting entries are excluded from automatic records.</p></details>}
                    {edition.chronicle?.records.length > 0 && <details className="wr-journal-rail-section" open={topic === 'records'}><summary>Historical scoring honors <span>Original-era points</span></summary>{edition.chronicle.records.filter(f => teamFilter === 'all' || f.owners.includes(editionLeague.rosters?.find(r => sameId(r.roster_id, teamFilter))?.owner_id)).slice().sort((a, b) => b.season - a.season).map(f => <article className="wr-journal-rival" key={f.id}><strong>{f.season} · {f.award.toLowerCase()}</strong><p>{f.holder} · {f.stat}</p>{f.reconciliation === 'award-snapshot-differs' && <p>Checked Sleeper score: {Number(f.observed.value).toFixed(2)} · {f.observed.holder}{f.observed.week ? ` · Week ${f.observed.week}` : ` · through Week ${f.observed.throughWeek}`}</p>}<small>{f.sources[0].sheet}!{f.sources[0].range}</small></article>)}<p className="wr-journal-footnote">Documented awards, not scoring-normalized records. These do not trigger record-breaking claims.</p></details>}
                    {edition.rivals.length > 0 && <details className="wr-journal-rail-section" open={topic === 'rivalries'}><summary>Rivalry watch <span>Followed & discovered</span></summary>{edition.rivals.filter(r => teamFilter === 'all' || r.rosterIds.some(rid => sameId(rid, teamFilter))).map(r => <article className="wr-journal-rival" key={r.rosterIds.join(':')}><strong>{r.name || <>{r.a} <span>vs.</span> {r.b}</>}</strong>{r.name && <p>{r.a} vs. {r.b}</p>}{r.followed && <small>Following{r.scheduled ? " · On this week’s schedule" : ""}</small>}{r.meetings > 0 && <div>{r.winsA}<span>–</span>{r.winsB}{r.ties > 0 && <small> · {r.ties} tied</small>}</div>}<p>{r.meetings} recorded regular-season meeting{r.meetings === 1 ? '' : 's'}</p>{studioAvailable && r.broadcast && <button type="button" onClick={() => openStudio({ broadcast: r.broadcast, text: r.name || `${r.a} vs. ${r.b}`, category: 'Rivalry watch' })}>Open rivalry breakdown →</button>}</article>)}</details>}
                    {edition.table.length > 0 && <details className="wr-journal-rail-section" open={topic === 'league'}><summary>The chase <span>THROUGH WK {edition.completedThrough}</span></summary><ol className="wr-journal-table">{edition.table.map(t => <li key={t.rid}><span>{t.rank}</span><strong>{editionName(t.rid)}</strong><span>{t.wins}–{t.losses}{t.ties ? '–' + t.ties : ''}</span></li>)}</ol><p className="wr-journal-footnote">Completed results, including median games where enabled. Ordered by wins, half-credit for ties, then points for. Official division seeds and tiebreaks may differ.</p></details>}
                </aside></div>}
                <footer className="wr-journal-footer"><strong>FROM THE LEAGUE, FOR THE LEAGUE.</strong><details><summary>Sources & coverage</summary><p>Stories use Sleeper's scored regular-season matchups. Completed weeks {editionStart}–{edition.completedThrough >= editionStart ? edition.completedThrough : 'none yet'} in {editionLeague.season}. Live scores are provisional. Stat corrections can rewrite an edition; use Refresh edition for the latest.</p><p>Historical records cover {edition.archive.allSeasons.join(', ') || 'no completed seasons yet'}. {past.key === pastKey && past.complete ? 'The connected Sleeper history chain has been checked.' : 'Earlier history may still be missing.'} These calculated totals exclude pre-Sleeper seasons and playoffs. Rivalries follow owner IDs, not roster slots. Current team names represent current owners; archived editions use that season's names.</p><p>Completed older seasons are saved on this device. Refresh edition updates current-season results. <button type="button" onClick={() => { recheckArchiveRef.current = true; setArchiveRevision(n => n + 1); }}>Recheck older seasons</button> to fetch historical corrections.</p><p>Trade and waiver coverage includes loaded, completed transactions from the last seven days. NFL scores come from ESPN and may be delayed; this view checks every minute. League scores refresh every 30 seconds. Player trends compare the two labelled seasons.</p></details></footer>
            </div>
            {studioAvailable && studio?.scope === studioScope && <window.WrWireStudio league={editionLeague} story={studio.story} seasons={pastSeasons.filter(s => Number(s.league.season) < Number(editionLeague.season))} race={race} onClose={() => setStudio(null)} />}
        </dialog>}
    </section>;
}

window.WrLeagueWire = WrLeagueWire;

function WrNflDesk({ desk, leaders = [] }) {
    const phaseLabel = phase => phase ? `${phase.season || ''} · ${phase.seasontype === 1 ? 'Preseason' : phase.seasontype === 3 ? 'Postseason' : 'Week'} ${phase.week}` : 'Current NFL week';
    const kickoffText = game => {
        if (/POSTPONED|CANCEL|SUSPEND|DELAY/i.test(game.statusName || '')) return game.shortDetail || 'Schedule update';
        const date = new Date(game.kickoff);
        return game.kickoff && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : game.shortDetail || 'Kickoff to be announced';
    };
    const gameCard = game => {
        const scored = game.completed || game.state === 'in';
        const validFinal = game.completed && game.homeScore != null && game.awayScore != null;
        const tied = validFinal && game.homeScore === game.awayScore;
        const winner = game.homeScore > game.awayScore ? game.homeName || game.home : game.awayName || game.away;
        const loser = game.homeScore > game.awayScore ? game.awayName || game.away : game.homeName || game.home;
        const periods = [...new Set([...(game.homePeriods || []), ...(game.awayPeriods || [])].map(p => p.period))].sort((a, b) => a - b);
        const teams = [{ name: game.awayName || game.away, abbr: game.away, score: game.awayScore, periods: game.awayPeriods || [] }, { name: game.homeName || game.home, abbr: game.home, score: game.homeScore, periods: game.homePeriods || [] }];
        return <article className={'wr-nfl-game' + (game.state === 'in' ? ' is-live' : '')} key={game.id || game.away + game.home}>
            <div className="wr-nfl-status">{game.completed ? game.shortDetail || 'Final' : game.state === 'in' ? game.shortDetail || 'Live' : kickoffText(game)}</div>
            <h4 className="wr-nfl-game-title">{game.awayName || game.away} at {game.homeName || game.home}</h4>
            <div className="wr-nfl-teams">{teams.map(team => <div key={team.abbr} className={validFinal && !tied && team.name === winner ? 'is-winner' : ''}><span>{team.name}</span><strong>{scored ? team.score ?? '—' : '—'}</strong></div>)}</div>
            {validFinal && <p className="wr-nfl-recap">{tied ? `All square at ${game.homeScore} apiece.` : `${winner} ${Math.abs(game.homeScore - game.awayScore) <= 3 ? 'edge' : 'beat'} ${loser}, ${Math.max(game.homeScore, game.awayScore)}–${Math.min(game.homeScore, game.awayScore)}${/OT/i.test(game.shortDetail || '') ? ' in overtime' : ''}.`}</p>}
            {!scored && game.broadcasts?.length > 0 && <p className="wr-nfl-broadcast">{game.broadcasts.join(' · ')}</p>}
            {scored && <details className="wr-nfl-box"><summary aria-label={`Box score: ${game.away} at ${game.home}`}>Box score <span aria-hidden="true">↗</span></summary>
                {periods.length > 0 ? <div className="wr-nfl-table-scroll" role="region" aria-label={`${game.away} at ${game.home} scoring by quarter`} tabIndex={0}><table><caption>Scoring by quarter</caption><thead><tr><th scope="col">Team</th>{periods.map(period => <th scope="col" key={period}>{period <= 4 ? period : period === 5 ? 'OT' : `${period - 4}OT`}</th>)}<th scope="col">Total</th></tr></thead><tbody>{teams.map(team => <tr key={team.abbr}><th scope="row">{team.abbr}</th>{periods.map(period => <td key={period}>{team.periods.find(p => p.period === period)?.value ?? '—'}</td>)}<td><strong>{team.score ?? '—'}</strong></td></tr>)}</tbody></table></div> : <p>Quarter-by-quarter scoring isn’t available yet.</p>}
                {game.leaders?.length > 0 && <><h5>Game leaders</h5><ul className="wr-nfl-leaders">{game.leaders.map((leader, i) => <li key={i}><span>{leader.category}</span><strong>{leader.name}{leader.team ? ` · ${leader.team}` : ''}</strong><small>{leader.stats}</small></li>)}</ul></>}
                {game.boxScoreUrl && <a href={game.boxScoreUrl} target="_blank" rel="noreferrer">Full player stats on ESPN ↗</a>}
            </details>}
        </article>;
    };
    const weekSection = (title, phase, data, previous = false) => <section className={'wr-nfl-week ' + (previous ? 'wr-nfl-previous' : 'wr-nfl-current')} aria-label={title} tabIndex={-1}>
        <header><h3>{title}</h3><span>{phaseLabel(phase)}</span></header>
        {data.status === 'loading' && <p role="status">Loading NFL games…</p>}
        {data.status === 'error' && <p className="wr-nfl-notice" role="status">{data.games.length ? 'Showing the last available scores. The latest update couldn’t load.' : 'These NFL games couldn’t load.'} We’ll try again shortly.</p>}
        {data.status === 'ready' && !data.games.length && <p>{previous && !phase ? 'No earlier games in this phase yet. Results will appear after the opening week.' : 'No games are listed for this week.'}</p>}
        {data.games.length > 0 && <div className="wr-nfl-games">{data.games.slice().sort((a, b) => (Date.parse(a.kickoff) || 0) - (Date.parse(b.kickoff) || 0)).map(gameCard)}</div>}
    </section>;
    const jumpToWeek = (event, selector) => {
        const section = event.currentTarget.closest('.wr-nfl-desk')?.querySelector(selector);
        section?.focus({ preventScroll: true });
        section?.scrollIntoView({ block: 'start' });
    };
    return <div className="wr-nfl-desk"><header className="wr-nfl-heading"><span>AROUND THE NFL</span><h3>The week in football</h3><p>This week’s matchups and last week’s results, all in one place.</p></header>
        <nav className="wr-nfl-jump" aria-label="NFL weeks"><button type="button" onClick={event => jumpToWeek(event, '.wr-nfl-current')}>This week</button><button type="button" onClick={event => jumpToWeek(event, '.wr-nfl-previous')}>Last week’s results ↓</button></nav>
        {weekSection('This week', desk.phase, desk.current)}
        {weekSection('Last week’s results', desk.previousPhase, desk.previous, true)}
        {leaders.length > 0 && <section className="wr-nfl-week"><header><h3>Player spotlight</h3></header><ul className="wr-nfl-leaders">{leaders.map((leader, i) => <li key={i}><span>{leader.label}</span><strong>{leader.text}</strong></li>)}</ul></section>}
        <p className="wr-nfl-credit">Scores and game leaders: ESPN. Kickoff times are shown in your local time zone. Scores may be delayed.</p>
    </div>;
}
