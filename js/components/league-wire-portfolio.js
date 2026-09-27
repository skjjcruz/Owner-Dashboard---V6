// ══════════════════════════════════════════════════════════════════
// js/components/league-wire-portfolio.js — window.WrAllLeaguesWire
// The all-leagues Wire (ported from C2, 2026-09-27): one front page across
// every connected SLEEPER league, round-robin so each league gets a turn.
// Opened from a league's Wire ("All my leagues") as a native <dialog>.
// Props: leagues (Sleeper league objects; ESPN/MFL are filtered out by
//   App.LeagueLiveScores.supported and noted), accountId, onClose,
//   onOpenLeague(league) (optional — hidden when absent), loadLeagues()
//   (Dynasty HQ addition: when `leagues` is empty, a lazy loader for the
//   signed-in Sleeper user's leagues — called once, only after opening).
// Dynasty HQ change: private scope = WrWireRivalries.scope() (C2 used
// App.AccountStorage.owner(), which V6 does not have).
// ══════════════════════════════════════════════════════════════════
function WrAllLeaguesWire({ leagues: givenLeagues = [], accountId = '', onClose, onOpenLeague, loadLeagues }) {
    const dialog = React.useRef(null);
    const opener = React.useRef(document.activeElement);
    const [entries, setEntries] = React.useState({});
    // Leagues come from the host when it has them; otherwise load them once.
    const [fetched, setFetched] = React.useState({ status: givenLeagues.length || !loadLeagues ? 'ready' : 'loading', leagues: [] });
    React.useEffect(() => {
        if (givenLeagues.length || !loadLeagues) return undefined;
        let alive = true;
        Promise.resolve().then(loadLeagues)
            .then(list => { if (alive) setFetched({ status: 'ready', leagues: Array.isArray(list) ? list : [] }); })
            .catch(() => { if (alive) setFetched({ status: 'error', leagues: [] }); });
        return () => { alive = false; };
    }, []);
    const leagues = givenLeagues.length ? givenLeagues : fetched.leagues;
    const [leagueFilter, setLeagueFilter] = React.useState('all');
    const [topic, setTopic] = React.useState('all');
    const [revision, setRevision] = React.useState(0);
    const [limit, setLimit] = React.useState(18);
    const eligible = leagues.filter(l => window.App.LeagueLiveScores.supported(l));
    const [search, setSearch] = React.useState('');
    const reading = window.WrWireReading;
    const accountScope = (window.App?.AccountStorage?.owner?.() || window.WrWireRivalries?.scope?.() || '') + '|' + accountId;
    const scope = accountScope + '|' + eligible.map(l => (l.league_id || l.id) + ':' + l.season).sort().join(',');
    const previousScope = React.useRef(scope);
    const [loadedScope, setLoadedScope] = React.useState(scope);
    const [studio, setStudio] = React.useState(null);
    const activeEntries = loadedScope === scope ? entries : {};
    React.useEffect(() => { dialog.current?.showModal(); return () => { window.requestAnimationFrame(() => { const target = opener.current?.isConnected ? opener.current : document.querySelector('.wr-wire-brand, .wr-wire-mobile-launch, .wr-all-wire-launch'); target?.focus?.(); }); }; }, []);
    React.useEffect(() => {
        if (previousScope.current !== scope) { setEntries({}); setSearch(''); setStudio(null); previousScope.current = scope; }
        setLoadedScope(scope); setLimit(18);
        if (!eligible.length) return undefined; // nothing to load (yet) — no calendar request
        const controller = new window.AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        let alive = true;
        window.WrWirePortfolio.load({ leagues: eligible, accountId: accountScope, signal: controller.signal, force: revision > 0,
            onUpdate: entry => { if (alive) setEntries(old => ({ ...old, [entry.league.league_id || entry.league.id]: reading.retain(old[entry.league.league_id || entry.league.id], entry) })); },
        }).catch(() => {}).finally(() => {
            clearTimeout(timeout);
            if (alive) setEntries(old => Object.fromEntries(eligible.map(l => { const id = l.league_id || l.id, entry = old[id]; return [id, reading.finish(entry, l)]; })));
        });
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [scope, revision]);
    React.useEffect(() => {
        const refresh = event => { if (!event.key || event.key.includes('wire_rivalries_v1:')) setRevision(n => n + 1); };
        window.addEventListener('wr:wire-rivalries-changed', refresh);
        window.addEventListener('storage', refresh);
        return () => { window.removeEventListener('wr:wire-rivalries-changed', refresh); window.removeEventListener('storage', refresh); };
    }, []);
    React.useEffect(() => { if (leagueFilter !== 'all' && !eligible.some(l => String(l.league_id || l.id) === leagueFilter)) setLeagueFilter('all'); }, [scope, leagueFilter]);
    const current = eligible.map(l => activeEntries[l.league_id || l.id]).filter(Boolean);
    const stories = window.WrWirePortfolio.headlines(current, topic === 'all' && search.trim() ? 'stories' : topic, leagueFilter).filter(s => reading.matches(s, search));
    const lookback = window.WrWirePortfolio.lookback(current, leagueFilter);
    const ready = current.filter(e => e.currentReady || e.resultsReady || e.scheduleReady).length;
    const scoped = current.filter(e => leagueFilter === 'all' || String(e.league.league_id || e.league.id) === leagueFilter);
    const periods = [...new Set(scoped.map(reading.period))];
    const checkTimes = scoped.map(e => e.currentUpdatedAt).filter(Boolean);
    const loading = current.length < eligible.length || current.some(e => e.status === 'loading');
    const refreshingCurrent = current.length < eligible.length || current.some(e => e.refreshing || (!e.currentReady && e.status === 'loading'));
    const changeTopic = value => { setTopic(value); setLimit(18); };
    const partial = current.filter(e => e.status === 'partial').length;
    const studioAvailable = league => typeof window.WrWireStudio === 'function' && !window.App?.Chopped?.isChopped?.(league) && league.type !== 'chopped' && league.leagueSkin?.type !== 'chopped';
    const openStudio = (league, story = null) => { const entry = activeEntries[league.league_id || league.id]; setStudio({ scope, league, story, race: entry?.race, seasons: entry?.rivalryHistory || [] }); };
    const coverage = <details className="wr-all-wire-coverage"><summary>Leagues & coverage · {ready}/{eligible.length}{partial ? ` · ${partial} partial` : ''}</summary>
            <div className="wr-all-wire-controls"><label>League<select aria-label="Filter Wire by league" value={leagueFilter} onChange={e => { setLeagueFilter(e.target.value); setLimit(18); }}><option value="all">All my leagues</option>{eligible.map(l => <option key={l.id || l.league_id} value={l.id || l.league_id}>{l.name}</option>)}</select></label><button type="button" onClick={() => setRevision(n => n + 1)}>Refresh current news ↻</button></div>
            <div className="wr-all-wire-progress">{eligible.map(l => { const e = activeEntries[l.id || l.league_id]; return <details key={l.id || l.league_id}><summary>{l.name}<span>{!e ? 'Loading…' : e.currentError ? 'Current coverage needs a refresh' : e.currentReady ? e.archiveError ? 'News ready · history incomplete' : e.status === 'loading' ? 'News ready · adding history' : 'News ready' : 'Gathering current news…'}</span></summary>{e && <p>{reading.period(e)}{e.currentUpdatedAt ? ` · Checked ${reading.checked(e.currentUpdatedAt)}` : ''}</p>}<p>{e?.error || (e ? `${e.priorSeasons || 0} earlier seasons available${e.reusedSeasons ? ` · ${e.reusedSeasons} reused from cache` : ''}. Completed scores through Week ${e.completedThrough || 0}.` : 'Waiting for a newsroom slot…')}</p>{onOpenLeague && <button type="button" onClick={() => onOpenLeague(l)}>Open league →</button>}{studioAvailable(l) && <button type="button" onClick={() => openStudio(l)}>Playoff picture →</button>}</details>; })}</div>
    </details>;
    const story = (s, i) => (<article key={`${s.league.id || s.league.league_id}:${s.id || s.text}`} className={'wr-all-wire-story' + (i === 0 ? ' is-lead' : '')}>
                <div className="wr-journal-kicker"><span>{s.league.name} · {s.league.season}</span></div><p className="wr-all-wire-label">{s.label}</p><h3>{s.text}</h3>{i === 0 ? <div className="wr-journal-body">{reading.paragraphs(s.body).map((paragraph, n) => <p key={n}>{paragraph}</p>)}</div> : <><p className="wr-story-dek">{reading.deck(s)}</p><details className="wr-journal-read"><summary>Read story <span aria-hidden="true">→</span></summary><div className="wr-journal-body">{reading.paragraphs(s.body).map((paragraph, n) => <p key={n}>{paragraph}</p>)}</div></details></>}
                {studioAvailable(s.league) && (s.broadcast || s.documentary && s.category === 'Championship history') && <button type="button" className="wr-wire-studio-link" onClick={() => openStudio(s.league, s)}>Open graphic breakdown →</button>}
                {(s.related?.length > 0 || s.sources?.length > 0) && <details className="wr-journal-context"><summary>Story context & sources</summary>{s.related?.map((r, n) => <div key={n}><strong>{r.label}</strong>{r.text.split(/\n\n+/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>)}{s.sources?.map((src, n) => <p key={n}>{src.workbook ? `${src.workbook} · ${src.sheet}!${src.range}` : <a href={src.url} target="_blank" rel="noreferrer">{src.label}</a>}</p>)}</details>}
                {onOpenLeague && <button type="button" onClick={() => onOpenLeague(s.league)}>Open {s.league.name} →</button>}
            </article>);
    return <dialog ref={dialog} className="wr-journal wr-wire-portfolio" aria-labelledby="wr-all-wire-title" onCancel={onClose} onClose={onClose}>
        <header className="wr-journal-bar"><h2 id="wr-all-wire-title">The Wire<span>.</span></h2><span>All your leagues. One edition.</span><button type="button" onClick={onClose} aria-label="Close all-league Wire">Close ×</button></header>
        <nav className="wr-journal-nav" aria-label="All-league Wire sections">{[['all', 'Front page'], ['stories', 'Stories'], ['matchups', 'This week'], ['recaps', 'Recaps'], ['records', 'Records'], ['rivalries', 'Rivalries'], ['history', 'History']].map(([value, text]) => <button key={value} type="button" aria-pressed={topic === value} onClick={() => changeTopic(value)}>{text}</button>)}</nav>
        <div className="wr-journal-paper">
            <header className="wr-journal-masthead"><div><span>YOUR WHOLE LEAGUE WORLD</span><h3>{topic === 'all' ? 'Across your leagues' : topic === 'matchups' ? 'This week' : topic[0].toUpperCase() + topic.slice(1)}</h3></div><p role="status">{ready} of {eligible.length} leagues have current coverage</p></header>
            <section className="wr-wire-briefing" aria-label="Edition briefing"><header><div><strong>{periods.length === 1 ? periods[0] : `${scoped.length} league editions`}</strong>{checkTimes.length > 0 && <small>{scoped.some(e => e.stale) ? 'Saved coverage · ' : ''}{checkTimes.length > 1 ? 'Earliest check ' : 'Checked '}{reading.checked(Math.min(...checkTimes))}</small>}</div><button type="button" onClick={() => setRevision(n => n + 1)} disabled={refreshingCurrent}>{refreshingCurrent ? 'Updating…' : 'Refresh news'}</button></header>{scoped.some(e => e.currentError) && <p className="wr-wire-briefing-warning">Some current coverage could not refresh. Available stories are kept below.</p>}</section>
            <div className="wr-wire-reader-tools"><div className="wr-wire-search"><label>Find a story<input type="search" aria-label="Search all-league Wire" placeholder="Search teams, players, or stories" value={search} onChange={e => { setSearch(e.target.value); setLimit(18); }} /></label>{search && <button type="button" onClick={() => setSearch('')}>Clear search</button>}</div>
            {coverage}</div>
            {fetched.status === 'loading' && <p className="wr-journal-notice" role="status">Finding your Sleeper leagues…</p>}
            {fetched.status === 'error' && <p className="wr-journal-notice" role="status">Your Sleeper leagues could not load. Close and reopen to try again.</p>}
            {fetched.status === 'ready' && !eligible.length && <p className="wr-journal-notice">Connect a Sleeper league to read its Wire coverage.</p>}
            {leagues.length > eligible.length && <p className="wr-journal-footnote">This edition covers connected Sleeper leagues. Other platforms are not included.</p>}
            {topic === 'rivalries' && <section className="wr-all-wire-rivalries"><label>Set up rivalries for<select aria-label="Rivalry league" value={leagueFilter} onChange={e => setLeagueFilter(e.target.value)}><option value="all">Choose a league</option>{eligible.map(l => <option key={l.league_id || l.id} value={l.league_id || l.id}>{l.name}</option>)}</select></label>{eligible.filter(l => String(l.league_id || l.id) === leagueFilter).map(l => window.App?.Chopped?.isChopped?.(l) || l.type === 'chopped' || l.leagueSkin?.type === 'chopped' ? <p key={l.league_id || l.id}>Rivalry coverage is available for head-to-head leagues.</p> : <window.WrWireRivalryEditor key={l.league_id || l.id} league={l} priorSeasons={activeEntries[l.league_id || l.id]?.rivalryHistory || []} />)}{scoped.some(e => e.rivalryProfiles?.some(r => r.broadcast)) && <div className="wr-wire-rivalry-links"><h4>Rivalry breakdowns</h4><ul>{scoped.flatMap(e => (e.rivalryProfiles || []).filter(r => r.broadcast && studioAvailable(e.league)).map(r => <li key={`${e.league.league_id || e.league.id}:${r.rosterIds.join(':')}`}><span>{e.league.name}</span><button type="button" onClick={() => openStudio(e.league, { broadcast: r.broadcast, text: r.name || `${r.a} vs. ${r.b}`, category: 'Rivalry watch' })}>{r.name || `${r.a} vs. ${r.b}`} →</button></li>))}</ul></div>}</section>}
            <main className="wr-all-wire-stories">{stories.slice(0, limit).map(story)}</main>
            {topic === 'all' && !search.trim() && lookback && <section className="wr-wire-lookback" aria-label="This week’s lookback"><header><span>FROM THE ARCHIVE · {lookback.eventSeason}</span><h3>This week’s lookback</h3><p>One chapter from the past, separate from today’s headlines.</p></header>{story(lookback, 1)}</section>}
            {!stories.length && <p className="wr-journal-notice">{search.trim() ? 'No matching stories in this section. Try another name, clear your search, or open Stories for full coverage.' : loading && !ready ? 'Gathering your headlines… Each league appears as its news arrives.' : scoped.some(e => e.currentError) ? 'Some current coverage could not load. Refresh news to try again.' : 'No stories in this section yet. Try the front page or another league.'}</p>}
            {stories.length > limit && <button className="wr-all-wire-more" type="button" onClick={() => setLimit(n => n + 18)}>More stories · {stories.length - limit} remaining</button>}
            <footer className="wr-journal-footer"><strong>FROM EVERY LEAGUE YOU CALL HOME.</strong><p>Scores and rivalries stay within their own league. Completed older seasons are saved on this device and reused across visits. Current news is a snapshot; refresh to update it. Use a league’s Sources & coverage → Recheck older seasons for historical corrections.</p></footer>
        </div>
        {studio?.scope === scope && loadedScope === scope && eligible.some(l => String(l.league_id || l.id) === String(studio.league.league_id || studio.league.id) && String(l.season) === String(studio.league.season)) && <window.WrWireStudio league={studio.league} story={studio.story} seasons={studio.seasons} race={studio.race} onClose={() => setStudio(null)} />}
    </dialog>;
}
window.WrAllLeaguesWire = WrAllLeaguesWire;
