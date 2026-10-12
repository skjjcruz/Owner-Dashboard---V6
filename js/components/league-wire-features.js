// ══════════════════════════════════════════════════════════════════
// js/components/league-wire-features.js — League life desk + bylines +
// draft receipts (C2 1be683d, re-themed and adapted for Dynasty HQ).
//   window.WrWirePeople({ participants }) — the byline: owner (Sleeper
//     display name) · team. Text only.
//   window.WrWireLeagueLife({ features, … }) — the "League life" section:
//     Cardiac Club, Schedule therapy, The bounce-back, New threads, Name
//     archive (WrWireFeatures), then Draft receipts.
//   window.WrWireDraftReceipts — on-demand look back at past drafts
//     (WrWireDraftHistory.load). Nothing is fetched until the reader taps
//     "Open draft receipts"; work is scoped to account + league + season +
//     week and cancelled on change, unmount or a 30s timeout.
// Team logos as C2 shows them (owner ruling 2026-10-12): WrWireLogo shows the
// team's Sleeper logo, else the owner's Sleeper avatar, else initials;
// WrWireStoryMarks puts up to two of them on a story on phones (CSS hides
// them on wider screens, where the story art carries the badges). No opinion
// columns (the Opinion desk is not ported).
// ══════════════════════════════════════════════════════════════════
function WrWireLogo({ sources = [], initials = 'W', label = '', className = 'wr-wire-mark' }) {
    const [failed, setFailed] = React.useState([]);
    const src = (sources || []).find(url => !failed.includes(url));
    return <span className={className} title={label} aria-hidden="true"><span>{initials}</span>{src && <img key={src} src={src} alt="" width="42" height="42" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(previous => [...previous, src])} />}</span>;
}

function WrWireStoryMarks({ story, league }) {
    if (!league || !story) return null;
    let marks = [];
    try { marks = window.WrWireIdentity?.storyMarks?.(league, story) || []; } catch (e) { marks = []; }
    return marks.length ? <div className="wr-wire-story-marks" aria-hidden="true">{marks.map(mark => <WrWireLogo key={mark.key + ':' + mark.sources.join('|')} {...mark} />)}</div> : null;
}

function WrWirePeople({ participants = [] }) {
    const people = [...new Map((participants || []).filter(p => p?.ownerName).map(p => [p.ownerId || p.ownerName + ':' + p.teamName, p])).values()];
    if (!people.length) return null;
    return <ul className="wr-wire-people" aria-label="Owners and teams">{people.map((p, i) => <li key={p.ownerId || i}><strong>{p.ownerName}</strong>{p.teamName && p.teamName !== p.ownerName && <span>{p.teamSeason ? p.teamSeason + ' · ' : ''}{p.teamName}</span>}</li>)}</ul>;
}

function WrWireFeatureStory({ story, league }) {
    const paragraphs = window.WrWireReading?.paragraphs?.(story.body) || String(story.body || '').split(/\n\n+/);
    return <article className="wr-wire-feature-story">
        <WrWireStoryMarks story={story} league={league} />
        <p className="wr-wire-feature-kicker">{story.label || story.category}</p>
        <h4>{story.text}</h4>
        <WrWirePeople participants={story.participants} />
        {paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
        {(story.sources?.length > 0 || story.related?.length > 0) && <details className="wr-journal-context"><summary>The receipts</summary>
            {(story.related || []).map((item, i) => <div key={'note-' + i}><strong>{item.label}</strong><p>{item.text}</p></div>)}
            {(story.sources || []).map((source, i) => <p key={i}>{/^https:\/\/api\.sleeper\.app\//.test(source.url || '') ? <a href={source.url} target="_blank" rel="noreferrer">{source.label || 'Sleeper source'} ↗</a> : source.label}</p>)}
        </details>}
    </article>;
}

function WrWireLeagueLife({ features = [], headToHead = true, league, weeks, priorSeasons, throughWeek, accountScope, search = '', ownerFilter = null, teamFilter = 'all' }) {
    const terms = String(search).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const visible = (features || []).filter(f => (teamFilter === 'all' || (f.rosterIds || []).some(rid => String(rid) === String(teamFilter)))
        && terms.every(term => [f.text, f.body, f.category, ...(f.participants || []).flatMap(p => [p.ownerName, p.teamName])].filter(Boolean).join(' ').toLocaleLowerCase().includes(term)));
    return <section className="wr-wire-life" aria-label="League life">
        <header><span className="wr-wire-feature-kicker">THE LIGHTER SIDE</span><h3>League life</h3><p>Close calls, tough draws, comebacks and team names — every line from this league’s Sleeper results.</p></header>
        {!headToHead && <p className="wr-journal-footnote">League life stories need head-to-head matchups, so they are off for this league format. Draft receipts are below.</p>}
        {headToHead && !visible.length && <p className="wr-journal-footnote">{features.length ? 'No League life stories match this search or team.' : 'Nothing qualifies this week yet. These stories need completed weeks and close games, big swings or name changes to report.'}</p>}
        {visible.length > 0 && <div className="wr-wire-life-grid">{visible.map(f => <WrWireFeatureStory key={f.id} story={f} league={league} />)}</div>}
        <WrWireDraftReceipts league={league} weeks={weeks} priorSeasons={priorSeasons} throughWeek={throughWeek} accountScope={accountScope} search={search} ownerFilter={ownerFilter} />
    </section>;
}

function WrWireDraftEvidenceKey(league, weeks, priorSeasons) {
    const entry = (source, rows) => [source?.league_id || source?.id, source?.season, source?.status, source?.draft_id, source?.previous_league_id, source?.settings?.start_week, source?.settings?.playoff_week_start,
        (source?.rosters || []).map(row => [row.roster_id, row.owner_id]), (source?.users || []).map(user => [user.user_id, user.display_name, user.username, user.metadata?.team_name]),
        (rows || []).map(week => [week.week, (week.rows || []).map(row => [row.roster_id, row.points, row.custom_points, row.starters, row.players_points])])];
    return JSON.stringify([entry(league, weeks), (priorSeasons || []).map(prior => entry(prior.league, prior.weeks))]);
}
function WrWireDraftReceipts({ league, weeks = [], priorSeasons = [], throughWeek = 0, accountScope = '', search = '', ownerFilter = null }) {
    const ownerNow = () => window.WrWireRivalries?.scope?.() || accountScope;
    const owner = ownerNow();
    const scope = `${owner}|${league?.league_id || league?.id}|${league?.season}|${throughWeek}`;
    const [requested, setRequested] = React.useState('');
    const [revision, setRevision] = React.useState(0);
    const [range, setRange] = React.useState({ scope: '', count: 8 });
    const [filters, setFilters] = React.useState({ scope: '', season: 'all', category: 'all', owner: 'all', limit: 6 });
    const [entry, setEntry] = React.useState({ scope: '', status: 'idle' });
    const refreshRevision = React.useRef(0);
    // The evidence key is only computed once the reader has asked for receipts.
    const asked = requested === scope;
    const inputKey = React.useMemo(() => asked ? WrWireDraftEvidenceKey(league, weeks, priorSeasons) : '', [asked, league, weeks, priorSeasons]);
    const current = entry.scope === scope ? entry : { status: 'idle' };
    const selected = filters.scope === scope ? filters : { season: 'all', category: 'all', owner: 'all', limit: 6 };
    const maxSeasons = range.scope === scope ? range.count : 8;
    const updateFilter = (key, value) => setFilters({ ...selected, scope, [key]: value, limit: 6 });
    React.useEffect(() => {
        if (requested !== scope || !window.WrWireDraftHistory?.load) return undefined;
        let alive = true;
        const force = revision > refreshRevision.current && revision > 1;
        refreshRevision.current = revision;
        const controller = new window.AbortController();
        const stillCurrent = () => alive && !controller.signal.aborted && ownerNow() === owner;
        setEntry(previous => ({ ...(previous.scope === scope ? previous : {}), scope, status: 'loading', message: 'Checking the loaded seasons’ draft records…' }));
        const fail = message => setEntry(previous => previous.scope === scope && (previous.stories?.length || previous.ownerHistories?.length)
            ? { ...previous, status: 'partial', stale: true, message: message + ' Previously checked receipts remain below.' }
            : { scope, status: 'error', message });
        const timeout = setTimeout(() => {
            controller.abort();
            if (alive && ownerNow() === owner) fail('The draft archive took too long to load. Try again.');
        }, 30000);
        Promise.resolve().then(() => window.WrWireDraftHistory.load({ league, weeks, priorSeasons, throughWeek, signal: controller.signal, force, maxSeasons,
            onProgress: data => { if (stillCurrent()) setEntry(previous => {
                const next = { ...data, scope };
                if (previous.scope === scope) for (const key of ['stories', 'ownerHistories']) {
                    if (!data[key]?.length && previous[key]?.length) { next[key] = previous[key]; next.stale = true; }
                }
                return next;
            }); },
        })).then(data => {
            if (!stillCurrent()) return;
            if (data.status === 'error') fail(data.message || 'The draft archive could not refresh.');
            else setEntry({ ...data, scope });
        }).catch(error => {
            if (stillCurrent()) fail(error.message || 'The draft archive could not load. Try again.');
        }).finally(() => clearTimeout(timeout));
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [requested, scope, revision, maxSeasons, inputKey]);
    if (!window.WrWireDraftHistory) return null;
    const open = () => { setRequested(scope); setRevision(n => n + 1); };
    const activeOwner = ownerFilter || (selected.owner === 'all' ? null : { ownerId: selected.owner });
    const visible = (current.stories || []).filter(story => window.WrWireDraftHistory.matches(story, { search, ownerFilter: activeOwner, league, season: selected.season, category: selected.category }));
    const notebook = activeOwner?.ownerId ? (current.ownerHistories || []).find(book => String(book.ownerId) === String(activeOwner.ownerId)) : null;
    const searchTerms = String(search).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const notebookSeasons = (notebook?.seasons || []).filter(season => selected.season === 'all' || selected.season === String(season.season)).map(season => ({ ...season, picks: season.picks.filter(pick => searchTerms.every(term => [notebook.ownerName, season.teamName, season.season, pick.name, pick.position].join(' ').toLocaleLowerCase().includes(term))) })).filter(season => season.picks.length);
    const loaded = current.status !== 'idle', loading = current.status === 'loading';
    const seasons = [...new Set((current.checkedSeasons || []).filter(item => item.status === 'checked').map(item => String(item.season)))].sort((a, b) => Number(b) - Number(a));
    const filtered = !!String(search).trim() || !!activeOwner || selected.season !== 'all' || selected.category !== 'all';
    return <section className="wr-wire-draft-receipts" aria-label="Draft receipts">
        <header><span className="wr-wire-feature-kicker">HINDSIGHT HAS ENTERED THE CHAT</span><h3>Draft receipts</h3><p>The picks that paid off and the ones worth another look, measured by points in actual fantasy starting lineups. Each story names its season and weeks.</p></header>
        <div className="wr-wire-draft-actions"><button type="button" onClick={open} disabled={loading}>{loading ? 'Checking receipts…' : !loaded ? 'Open draft receipts →' : 'Refresh draft receipts'}</button>
            {loaded && current.progress?.remaining > 0 && <button type="button" disabled={loading} onClick={() => setRange({ scope, count: Math.min(25, maxSeasons + 8) })}>Check {Math.min(8, current.progress.remaining)} older seasons →</button>}</div>
        {!loaded && <p className="wr-journal-footnote">Reads this league’s Sleeper drafts (two small requests per season, up to 8 seasons) only when you tap.</p>}
        {current.message && <p role={current.status === 'error' ? 'alert' : 'status'} className="wr-journal-footnote">{current.message}</p>}
        {current.stale && loading && <p className="wr-journal-footnote">Previously checked receipts are shown while this update finishes.</p>}
        {loaded && <div className="wr-wire-draft-controls">
            <label>Season<select aria-label="Draft receipt season" value={selected.season} onChange={event => updateFilter('season', event.target.value)}><option value="all">All checked seasons</option>{seasons.map(season => <option key={season} value={season}>{season}</option>)}</select></label>
            {!ownerFilter && <label>Owner notebook<select aria-label="Draft receipt owner" value={selected.owner} onChange={event => updateFilter('owner', event.target.value)}><option value="all">Whole league</option>{(current.ownerHistories || []).map(book => <option key={book.ownerId} value={book.ownerId}>{book.ownerName} · {book.seasons.length} checked {book.seasons.length === 1 ? 'draft' : 'drafts'}</option>)}</select></label>}
            <label>Receipt type<select aria-label="Draft receipt type" value={selected.category} onChange={event => updateFilter('category', event.target.value)}>{[['all', 'All receipts'], ['value', 'Later-pick wins'], ['doover', 'Draft do-overs'], ['late', 'Late-round contributors'], ['workload', 'Lineup gaps']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>}
        {seasons.length > 0 && <p className="wr-wire-draft-scope">Checked seasons: {seasons.join(', ')}. {visible.length} {visible.length === 1 ? 'receipt' : 'receipts'}{filtered ? ' matching this view' : ''}.{current.progress?.remaining > 0 ? ` ${current.progress.remaining} older seasons remain available.` : ''}</p>}
        {visible.slice(0, selected.limit).map(story => <WrWireFeatureStory key={story.id} story={story} league={league} />)}
        {visible.length > selected.limit && <button type="button" onClick={() => setFilters({ ...selected, scope, limit: selected.limit + 6 })}>More receipts · {visible.length - selected.limit} remaining</button>}
        {loaded && !loading && !visible.length && current.status !== 'error' && <p className="wr-journal-footnote">{filtered ? 'No receipts match these filters in the checked seasons.' : current.ownerHistories?.length ? 'No comparison met the story threshold. Choose an owner to explore their verified picks.' : 'More completed lineup evidence is needed before publishing a receipt.'}</p>}
        {notebook && <section className="wr-wire-owner-notebook" aria-label={`${notebook.ownerName} draft notebook`}><h4>{notebook.ownerName}’s draft notebook</h4><p>The same owner, across {notebook.seasons.length} checked {notebook.seasons.length === 1 ? 'draft' : 'drafts'}. Each season keeps its own scoring rules; picks with fewer than four verified fantasy starts are omitted.</p>
            {!notebookSeasons.length && <p>No verified picks match this view.</p>}
            {notebookSeasons.map((season, index) => <details key={season.leagueId} open={index === 0}><summary>{season.season} · {season.teamName} · {season.picks.length} {season.picks.length === 1 ? 'pick' : 'picks'}</summary><div className="wr-wire-draft-table" tabIndex={0} role="region" aria-label={`${season.season} draft picks; scroll for all columns`}><table><caption>{season.season} scoring · through Week {season.throughWeek} · fantasy starting lineups</caption><thead><tr><th scope="col">Pick</th><th scope="col">Player</th><th scope="col">Points</th><th scope="col">Starts</th><th scope="col">Pts/start</th></tr></thead><tbody>{season.picks.map(pick => <tr key={pick.playerId}><td>{pick.pick}</td><th scope="row">{pick.name}<small>{pick.position} · Round {pick.round}</small></th><td>{pick.points.toFixed(2)}</td><td>{pick.starts}</td><td>{pick.average.toFixed(2)}</td></tr>)}</tbody></table></div><details className="wr-journal-context"><summary>Notebook sources</summary>{season.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></p>)}</details></details>)}
        </section>}
        {current.coverage?.length > 0 && <details className="wr-journal-context"><summary>Coverage & comparison rules</summary>{current.coverage.map((item, i) => <p key={i}>{item}</p>)}</details>}
    </section>;
}
window.WrWireLogo = WrWireLogo;
window.WrWireStoryMarks = WrWireStoryMarks;
window.WrWirePeople = WrWirePeople;
window.WrWireFeatureStory = WrWireFeatureStory;
window.WrWireLeagueLife = WrWireLeagueLife;
window.WrWireDraftReceipts = WrWireDraftReceipts;
