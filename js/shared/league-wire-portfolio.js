// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-portfolio.js — window.WrWirePortfolio (ported from
// C2, 2026-09-27). The all-leagues Wire: one newsroom, independent evidence
// per league, progressive delivery (current news first, archives after).
//   load({ leagues, accountId, signal, force, onUpdate, fetcher, now })
//     Sleeper leagues only (App.LeagueLiveScores.supported). Two leagues at
//     a time; each publishes its current edition before any archive work.
//     Per league: completed weeks via LeagueLiveTable.loadHistory (shared
//     App.Matchup cache), this week's schedule (1 request), then the
//     IndexedDB-backed archive. Warm editions (60s) cost one calendar check.
//   period, headlines (round-robin fair front page), lookback.
// Dynasty HQ change: the private-preference owner scope comes from
// WrWireRivalries.scope() (Dynasty HQ account, else Sleeper user) — C2 read
// App.AccountStorage.owner(), which V6 does not have (still honoured if a
// test installs it). Championship books are read from the WrHistory cache
// only; this view never triggers a history build for other leagues.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const recent = new Map();
    const keyFor = l => `${l.league_id || l.id}|${l.season}`;
    function period(league, nfl) {
        const range = root.WrWireStories.bounds(league);
        const historical = Number(league.season) < Number(nfl.season);
        const postseason = String(league.season) === String(nfl.season) && nfl.season_type === 'post';
        const week = historical || postseason ? range.end + 1 : nfl.season_type === 'regular' ? Math.max(1, Math.min(18, Number(nfl.display_week || nfl.week) || 1)) : 1;
        return { start: range.start, end: Math.min(range.end, week - 1), week, live: !historical && !postseason && Number(league.season) === Number(nfl.season) };
    }
    async function load({ leagues, accountId = '', signal, force = false, onUpdate, fetcher = (...args) => root.fetch(...args), now = Date.now }) {
        const owner = () => root.App?.AccountStorage?.owner?.() || root.WrWireRivalries?.scope?.() || '';
        const ownerScope = owner();
        const stillCurrent = () => owner() === ownerScope;
        const eligible = [...new Map(leagues.filter(l => root.App.LeagueLiveScores.supported(l)).map(l => [keyFor(l), l])).values()];
        const json = async url => { if (signal?.aborted) throw Error('aborted'); const r = await fetcher(url, { signal, cache: 'no-store' }); if (!r.ok) throw Error('Scores unavailable'); return r.json(); };
        let nfl;
        try { nfl = await json('https://api.sleeper.app/v1/state/nfl'); if (!nfl?.season) throw Error('No season'); }
        catch (_) { if (!signal?.aborted && stillCurrent()) eligible.forEach(league => onUpdate({ league, status: 'error', error: 'The league calendar could not load. Refresh to retry.', currentError: 'The league calendar could not load. Refresh to retry.', archiveError: '', currentReady: false, resultsReady: false, scheduleReady: false, currentUpdatedAt: null, stories: [] })); return; }
        let cursor = 0;
        const archiveJobs = [];
        async function worker() {
            while (cursor < eligible.length && !signal?.aborted && stillCurrent()) {
                const league = eligible[cursor++], span = period(league, nfl), cacheKey = `${ownerScope}|${accountId}|${keyFor(league)}|${span.week}`;
                const cached = recent.get(cacheKey);
                if (!force && cached && cached.selectionKey === JSON.stringify(root.WrWireRivalries?.list(league, cached.value.rivalryHistory) || []) && now() - cached.at < 60000) { onUpdate(cached.value); continue; }
                const nameFor = rid => root.WrWireStories.oldName(league, rid);
                const scheduleExpected = span.live && span.week <= root.WrWireStories.bounds(league).end;
                const scoresExpected = span.end >= span.start;
                let weeks = [], past = { seasons: [], complete: false }, board = null;
                let scoresLoaded = false, scheduleLoaded = !scheduleExpected, scoresError = '', scheduleError = '', archiveError = '';
                let scoresUpdatedAt = null, scheduleUpdatedAt = null, publishedSelectionKey = '';
                const publish = status => {
                    if (signal?.aborted || !stillCurrent()) return null;
                    const rivalries = root.WrWireRivalries?.list(league, past.seasons) || [];
                    root.WrWireChronicles?.syncFromHistory?.(league, past.seasons);
                    publishedSelectionKey = JSON.stringify(rivalries);
                    const edition = root.WrWireStories.build({ rivalries, league, weeks, start: span.start, end: span.end, priorSeasons: past.seasons, archiveComplete: past.complete,
                        board, nameFor, headToHead: !root.App?.Chopped?.isChopped?.(league) && league.type !== 'chopped' && league.leagueSkin?.type !== 'chopped',
                        playerName: pid => root.S?.players?.[pid]?.full_name || 'A starting player' });
                    const stories = edition.stories.filter(s => s.documentary || s.week === span.end).concat(edition.previews);
                    const scoresReady = scoresLoaded && edition.completedThrough >= span.end;
                    const currentReady = scoresReady && scheduleLoaded;
                    const currentError = [scoresError || (scoresLoaded && !scoresReady ? 'Some completed scores could not load. Refresh to retry.' : ''), scheduleError].filter(Boolean).join(' ');
                    const error = [currentError, archiveError].filter(Boolean).join(' ');
                    // Archive progress cannot make current evidence look freshly checked.
                    // When both sources are present, show the older successful snapshot.
                    const currentTimes = [scoresExpected && scoresReady ? scoresUpdatedAt : null, scheduleLoaded ? scheduleUpdatedAt : null].filter(t => t != null);
                    const currentUpdatedAt = currentTimes.length ? Math.min(...currentTimes) : null;
                    const value = { rivalryProfiles: edition.rivals || [], race: root.WrWirePlayoffs?.race({ league, edition: { ...edition, expectedThrough: span.end } }) || null, league, historical: Number(league.season) < Number(nfl.season), status: status === 'ready' && (error || !currentReady) ? 'partial' : status, error, currentError, archiveError, currentUpdatedAt, resultsReady: scoresExpected && scoresReady, scheduleReady: scheduleExpected && scheduleLoaded, stories, week: span.week, completedThrough: edition.completedThrough, priorSeasons: past.seasons.length, rivalryHistory: past.seasons.map(s => ({ league: s.league })), reusedSeasons: past.fromMemory ? past.seasons.length : past.savedCount || 0, currentReady, at: now() };
                    onUpdate(value); return value;
                };
                publish('loading');
                // Current news is usable while the older archive is still loading.
                await Promise.allSettled([
                    (async () => {
                        try { const r = await root.App.LeagueLiveTable.loadHistory({ league, week: span.end + 1, signal, force, fetcher, now }); if (!Array.isArray(r?.priorWeeks)) throw Error('Invalid completed scores'); weeks = r.priorWeeks; scoresLoaded = true; scoresUpdatedAt = Number.isFinite(r.updatedAt) ? r.updatedAt : now(); }
                        catch (_) { scoresError = 'Some completed scores could not load. Refresh to retry.'; }
                        publish('loading');
                    })(),
                    (async () => {
                        if (!scheduleExpected) return;
                        try {
                            const rows = await json(`https://api.sleeper.app/v1/league/${encodeURIComponent(league.league_id || league.id)}/matchups/${span.week}`);
                            if (!Array.isArray(rows) || !rows.length || rows.some(r => !r || r.roster_id == null)) throw Error('Invalid matchups');
                            const ids = new Set(rows.map(r => String(r.roster_id)));
                            if (ids.size !== rows.length || (league.rosters?.length && (ids.size !== league.rosters.length || league.rosters.some(r => !ids.has(String(r.roster_id)))))) throw Error('Incomplete matchups');
                            board = { week: span.week, rows }; scheduleLoaded = true; scheduleUpdatedAt = now();
                        }
                        catch (_) { scheduleError = 'Current matchups could not load. Refresh to retry.'; }
                        publish('loading');
                    })(),
                ]);
                archiveJobs.push(async () => {
                    try { past = await root.WrWireStories.loadArchive({ league, signal, fetcher, now, retry: force, onProgress: p => { past = p; publish('loading'); } }); }
                    catch (_) { archiveError = 'Earlier history is incomplete. Refresh to retry.'; }
                    if (!past.complete && !archiveError) archiveError = past.reason || 'Earlier history is incomplete.';
                    const value = publish('ready');
                    if (value?.status === 'ready') { recent.set(cacheKey, { at: now(), value, selectionKey: publishedSelectionKey }); while (recent.size > 40) recent.delete(recent.keys().next().value); }
                });
            }
        }
        await Promise.all(Array.from({ length: Math.min(2, eligible.length) }, worker));
        let archiveCursor = 0;
        async function archiveWorker() { while (archiveCursor < archiveJobs.length && !signal?.aborted && stillCurrent()) await archiveJobs[archiveCursor++](); }
        await Promise.all(Array.from({ length: Math.min(2, archiveJobs.length) }, archiveWorker));
    }
    // Round-robin each league's best current story before any league's second.
    function headlines(entries, topic = 'all', leagueId = 'all') {
        const queues = entries.filter(e => leagueId === 'all' || String(e.league.league_id || e.league.id) === leagueId).map(entry => {
            const stories = entry.stories.filter(s => topic === 'history' ? (s.documentary || entry.historical) : !entry.historical && !s.documentary && (topic === 'all' || topic === 'stories' || (topic === 'matchups' ? s.preview === true : topic === 'recaps' ? s.kind === 'recap' : topic === 'rivalries' ? s.category === 'Rivalry watch' || s.category === 'Revenge game' : s.kind === 'record')))
                .slice().sort((a, b) => (b.weight || 0) - (a.weight || 0) || (b.eventSeason || 0) - (a.eventSeason || 0));
            return { entry, stories: topic === 'all' ? root.WrWireStories.frontPage(stories) : stories };
        });
        const out = [];
        for (let i = 0; queues.some(q => q.stories.length > i); i++) queues.forEach(q => { if (q.stories[i]) out.push({ ...q.stories[i], ...(q.entry.historical && !q.stories[i].documentary ? { documentary: true, eventSeason: Number(q.entry.league.season), label: `FROM THE ARCHIVE · ${q.entry.league.season} · ${q.stories[i].label}` } : {}), league: q.entry.league }); });
        return out;
    }
    function lookback(entries, leagueId = 'all') {
        const scoped = entries.filter(e => leagueId === 'all' || String(e.league.league_id || e.league.id) === leagueId);
        const stories = scoped.flatMap(e => e.stories.filter(s => s.documentary).map(s => ({ ...s, league: e.league })));
        const key = scoped.map(e => `${keyFor(e.league)}:${e.week}`).sort().join(',');
        return root.WrWireStories.weeklyLookback(stories, key);
    }
    root.WrWirePortfolio = { load, period, headlines, lookback };
})(typeof window !== 'undefined' ? window : globalThis);
