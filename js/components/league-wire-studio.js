// ══════════════════════════════════════════════════════════════════
// js/components/league-wire-studio.js — window.WrWireStudio (ported from C2,
// 2026-09-27, logic unchanged; styles in league-wire-styles.js re-tokened).
// Optional, evidence-backed graphics: a matchup/rivalry comparison, the
// Sleeper playoff bracket, a team's playoff path, and the playoff race.
// A native <dialog> that opens only on an explicit "graphic breakdown" /
// "Playoff picture" action; bracket data loads only when its tab is shown.
// Loads in the deferred 'wire' module group.
// ══════════════════════════════════════════════════════════════════
function WrWireStudio({ league, story = null, seasons = [], race = null, initialTab, onClose }) {
    const dialog = React.useRef(null);
    const opener = React.useRef(document.activeElement);
    const closeRef = React.useRef(onClose);
    closeRef.current = onClose;
    const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const id = value => 'wr-studio-' + uid + '-' + value;
    const keyFor = item => String(item?.league_id || item?.id || '') + ':' + String(item?.season || '');
    const model = story?.broadcast?.kind === 'comparison' && story.broadcast.teams?.length === 2 ? story.broadcast : null;
    const choices = [...new Map([...(model?.playoffSeasons || []).map(l => ({ ...l, name: league?.name })), league, ...seasons.map(s => s.league || s)].filter(Boolean).map(l => [keyFor(l), l])).values()].sort((a, b) => Number(b.season) - Number(a.season));
    const tabs = [...(model ? [['comparison', 'Comparison']] : []), ['bracket', 'Bracket'], ['path', 'Playoff path'], ...(race ? [['race', 'Race']] : [])];
    const fallbackTab = model ? 'comparison' : story?.documentary ? 'path' : race ? 'race' : 'bracket';
    const [tab, setTab] = React.useState(tabs.some(t => t[0] === initialTab) ? initialTab : fallbackTab);
    const activeTab = tabs.some(t => t[0] === tab) ? tab : fallbackTab;
    const initialLeague = story?.documentary && choices.find(l => String(l.season) === String(story.eventSeason)) || league;
    const unavailableStorySeason = story?.documentary && story.eventSeason && !choices.some(l => String(l.season) === String(story.eventSeason));
    const [selectedKey, setSelectedKey] = React.useState(keyFor(initialLeague));
    const selectedLeague = choices.find(l => keyFor(l) === selectedKey) || league;
    const selectedScope = keyFor(selectedLeague);
    const [entry, setEntry] = React.useState({ key: '', status: 'idle', data: null });
    const [revision, setRevision] = React.useState(0);
    const cache = React.useRef(new Map());
    const forceKey = React.useRef(null);
    const needsPlayoffs = activeTab === 'bracket' || activeTab === 'path';
    const current = entry.key === selectedScope ? entry : { status: 'loading', data: null };
    const retry = () => { forceKey.current = selectedScope; setRevision(n => n + 1); };

    React.useEffect(() => {
        dialog.current?.showModal();
        return () => window.requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); });
    }, []);
    React.useEffect(() => {
        if (!needsPlayoffs) return undefined;
        let alive = true, timedOut = false;
        const controller = new window.AbortController();
        const saved = cache.current.get(selectedScope) || null;
        const force = forceKey.current === selectedScope;
        forceKey.current = null;
        if (saved && !force) { setEntry({ key: selectedScope, status: saved.status, data: saved }); return undefined; }
        setEntry({ key: selectedScope, status: 'loading', data: saved });
        const timeout = setTimeout(() => {
            timedOut = true; controller.abort();
            if (alive) setEntry({ key: selectedScope, status: 'error', data: saved, message: 'The playoff picture took too long to load. Try again.' });
        }, 30000);
        Promise.resolve().then(() => {
            if (!window.WrWirePlayoffs?.load) throw Error('Playoff coverage is unavailable. Try again.');
            return window.WrWirePlayoffs.load({ league: selectedLeague, signal: controller.signal, force });
        }).then(result => {
            if (!alive || controller.signal.aborted) return;
            if (!result || result.status === 'error') throw Error(result?.message || 'The playoff picture could not load. Try again.');
            if (result.league && keyFor(result.league) !== selectedScope) throw Error('This playoff edition could not be verified. Try again.');
            cache.current.set(selectedScope, result);
            setEntry({ key: selectedScope, status: result.status, data: result });
        }).catch(error => {
            if (alive && !timedOut && error?.name !== 'AbortError') setEntry({ key: selectedScope, status: 'error', data: saved, message: error.message || 'The playoff picture could not load. Try again.' });
        }).finally(() => clearTimeout(timeout));
        return () => { alive = false; controller.abort(); clearTimeout(timeout); };
    }, [selectedScope, needsPlayoffs, revision]);

    const close = event => { event?.stopPropagation(); event?.preventDefault(); closeRef.current?.(); };
    const keyTabs = event => {
        const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!direction && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const index = tabs.findIndex(t => t[0] === activeTab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length;
        setTab(tabs[next][0]);
        event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
    };
    const data = current.data;
    return <dialog ref={dialog} className="wr-wire-studio" aria-labelledby={id('title')} onCancel={close} onClose={close}>
        <header className="wr-studio-mast"><div><h2 id={id('title')}>The Wire<span>.</span> <small>Studio</small></h2><p>{league?.name || 'Your league'}</p></div><button type="button" onClick={close} aria-label="Close Wire Studio">Close ×</button></header>
        <nav className="wr-studio-tabs" role="tablist" aria-label="Wire Studio views" onKeyDown={keyTabs}>{tabs.map(([value, label]) => <button type="button" key={value} role="tab" id={id(value + '-tab')} aria-controls={id('panel')} aria-selected={activeTab === value} tabIndex={activeTab === value ? 0 : -1} onClick={() => setTab(value)}>{label}</button>)}</nav>
        <section className="wr-studio-panel" id={id('panel')} role="tabpanel" aria-labelledby={id(activeTab + '-tab')} tabIndex={0}>
            {needsPlayoffs && <><div className="wr-studio-editions"><label>Playoff season<select aria-label="Playoff season" value={selectedScope} onChange={event => setSelectedKey(event.target.value)}>{choices.map(l => <option key={keyFor(l)} value={keyFor(l)}>{l.season} · {l.name || 'League'}</option>)}</select></label><button type="button" onClick={retry} disabled={current.status === 'loading'}>{current.status === 'loading' ? 'Loading…' : 'Refresh playoffs'}</button></div>{unavailableStorySeason && <p className="wr-studio-notice">This story covers {story.eventSeason}, whose playoff bracket is not available in the loaded seasons. The selector above identifies the separate edition shown here.</p>}</>}
            {activeTab === 'comparison' && model && <WrWireStudioComparison key={story?.id || model.headline} model={model} />}
            {activeTab === 'race' && race && <WrWireStudioRace race={race} season={league?.season} />}
            {needsPlayoffs && <>
                {current.status === 'loading' && <p role="status" className="wr-studio-notice">{data ? 'Refreshing this playoff edition…' : 'Loading the verified playoff picture…'}</p>}
                {current.status === 'error' && <div role="alert" className="wr-studio-notice"><p>{current.message}</p>{data && <p>Showing the last available edition for this season.</p>}<button type="button" onClick={retry}>Try again</button></div>}
                {data && <><div className="wr-studio-eyebrow">{data.season || selectedLeague?.season}{data.provisional ? ' · Current provisional snapshot' : ' postseason'}{data.checkedAt ? ' · Checked ' + new Date(data.checkedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</div>
                    {data.message && <p className="wr-studio-notice">{data.message}</p>}
                    {activeTab === 'bracket' ? <WrWireStudioBracket key={selectedScope} data={data} /> : <WrWireStudioPath key={selectedScope} data={data} />}
                    <WrWireStudioSources notes={data.notes} sources={data.sources} />
                </>}
            </>}
        </section>
    </dialog>;
}

function WrWireStudioSources({ notes = [], sources = [] }) {
    const unique = [...new Map(sources.map(s => [s.url || JSON.stringify(s), s])).values()];
    return notes.length || unique.length ? <details className="wr-studio-sources"><summary>Data & context</summary>{notes.map((note, i) => <p key={'note-' + i}>{typeof note === 'string' ? note : note.text || note.label}</p>)}{unique.map((source, i) => <p key={'source-' + i}>{source.url && /^https?:\/\//.test(source.url) ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.label || 'View source'}</a> : source.label || source.text}</p>)}</details> : null;
}

function WrWireStudioComparison({ model }) {
    const series = model.series || [];
    const [seriesId, setSeriesId] = React.useState(series[0]?.id || '');
    const chosen = series.find(s => s.id === seriesId) || series[0];
    const meetings = chosen?.meetings || [];
    const [meetingId, setMeetingId] = React.useState('');
    const meeting = meetings.find(m => m.id === meetingId) || meetings[meetings.length - 1];
    const score = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
    const hasWins = chosen?.wins?.length === 2 && chosen.wins.every(n => typeof n === 'number' && Number.isFinite(n));
    const points = meeting?.points || [];
    const hasTrack = points.length === 2 && points.every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0) && points[0] + points[1] > 0;
    return <article className="wr-studio-comparison">
        <div className="wr-studio-eyebrow">{model.eyebrow || 'Matchup profile'} · {model.season}</div><h3>{model.headline}</h3>
        {series.length > 1 && <label className="wr-studio-select">Compare<select aria-label="Comparison scope" value={chosen.id} onChange={event => { setSeriesId(event.target.value); setMeetingId(''); }}>{series.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
        {chosen && <p className="wr-studio-scope">{chosen.label}{chosen.scope ? ' · ' + chosen.scope : ''}</p>}
        <div className="wr-studio-versus">{model.teams.map((team, i) => <React.Fragment key={team.ownerId || team.name || i}>{i === 1 && <div className="wr-studio-series">{hasWins ? <><strong>{chosen.wins[0]}<span>–</span>{chosen.wins[1]}</strong><small>{chosen.ties ? chosen.ties + ' tied meeting' + (chosen.ties === 1 ? '' : 's') : 'Wins in this comparison'}</small></> : <strong className="wr-studio-vs">vs.</strong>}</div>}<div className="wr-studio-person"><span className="wr-studio-identity" aria-hidden="true" /><strong>{team.name}</strong></div></React.Fragment>)}</div>
        {model.teams.some(t => t.record != null || t.average != null) && <><p className="wr-studio-now-label">{model.season}{model.throughWeek ? ' · Through Week ' + model.throughWeek : ''}{model.recordScope ? ' · ' + model.recordScope : ''}</p><div className="wr-studio-now">{model.teams.map((team, i) => <div key={i}><strong>{team.record ?? '—'}</strong><small>{team.h2hRecord != null ? 'Season H2H: ' + team.h2hRecord : 'Season record'}</small>{team.average != null && <small>{score(team.average)} points per week</small>}</div>)}</div></>}
        {meeting && <div className="wr-studio-replay"><div className="wr-studio-replay-heading"><h4>{meetings.length > 1 ? 'Revisit the meetings' : 'The recorded result'}</h4>{meetings.length > 1 && <label>Meeting<select aria-label="Recorded meeting" value={meeting.id} onChange={event => setMeetingId(event.target.value)}>{meetings.map(m => <option key={m.id} value={m.id}>{m.label || [m.season, m.week ? 'Week ' + m.week : ''].filter(Boolean).join(' · ')}</option>)}</select></label>}</div>
            <div className="wr-studio-result" aria-live="polite"><p>{meeting.label || [meeting.season, meeting.week ? 'Week ' + meeting.week : ''].filter(Boolean).join(' · ')}</p><div className="wr-studio-result-teams">{model.teams.map((team, i) => <div key={i}><small>{meeting.names?.[i] || team.name}</small><strong>{score(points[i])}</strong></div>)}</div><small>Fantasy points</small>{hasTrack && <div className="wr-studio-result-track" aria-hidden="true"><span style={{ width: (points[0] / (points[0] + points[1]) * 100) + '%' }} /><span /></div>}{meeting.caption && <p className="wr-studio-caption">{meeting.caption}</p>}</div>
        </div>}
        {!meeting && <p className="wr-studio-notice">This comparison uses current form. No verified past meeting is included.</p>}
        <WrWireStudioSources notes={model.notes} sources={[...(model.sources || []), ...(meeting?.sources || [])]} />
    </article>;
}

function WrWireStudioBracket({ data }) {
    const rounds = data.rounds || [];
    const format = points => typeof points === 'number' && Number.isFinite(points) ? points.toFixed(2) : '—';
    return <div className="wr-studio-bracket"><h3>{data.provisional ? 'Provisional playoff bracket' : 'The playoff bracket'}</h3>{!rounds.length && <p>No verified playoff matchups are available for this season yet.</p>}<div className="wr-studio-rounds">{rounds.map((round, index) => <section key={round.id || index} className="wr-studio-round"><header><h4>{round.label}</h4>{round.weeks?.length > 0 && <small>Week{round.weeks.length > 1 ? 's ' : ' '}{round.weeks.join('–')}</small>}</header>{(round.byes || []).map(team => <p key={'bye-' + team.id} className="wr-studio-round-bye">{team.name} · {data.provisional ? 'Provisional bye' : 'Bye'}</p>)}{(round.games || []).map((game, i) => <article key={game.id || i} className="wr-studio-bracket-game"><span className="wr-studio-status">{data.provisional ? 'Provisional matchup' : game.status === 'final' ? 'Final' : game.status === 'scheduled' ? 'Scheduled' : 'Awaiting verification'}</span>{(game.teams || []).map((team, j) => <div className={!data.provisional && team.id != null && String(team.id) === String(game.winnerId) ? 'is-winner' : ''} key={team.id || j}><span>{team.name || 'Opponent to be decided'}{!data.provisional && team.id != null && String(team.id) === String(game.winnerId) && <small>Bracket winner</small>}</span><strong>{data.provisional ? '—' : format(team.points)}</strong></div>)}{game.note && <p>{game.note}</p>}</article>)}</section>)}</div></div>;
}

function WrWireStudioPath({ data }) {
    const paths = data.paths || [];
    const [teamId, setTeamId] = React.useState('');
    const path = paths.find(p => String(p.team.id) === teamId) || paths[0];
    const [roundIndex, setRoundIndex] = React.useState(null);
    const rounds = path?.rounds || [];
    const index = roundIndex != null && roundIndex < rounds.length ? roundIndex : rounds.length - 1;
    const round = rounds[index];
    const score = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
    return <div className="wr-studio-path"><h3>{data.provisional ? 'A provisional playoff path' : 'The road through the playoffs'}</h3>{path ? <><label className="wr-studio-select">Follow a team<select aria-label="Playoff path team" value={String(path.team.id)} onChange={event => { setTeamId(event.target.value); setRoundIndex(null); }}>{paths.map(p => <option key={p.team.id} value={String(p.team.id)}>{p.team.name}</option>)}</select></label><h4 className="wr-studio-path-name">{path.team.name}{!data.provisional && path.champion && <small>{data.season} champion</small>}</h4><div className="wr-studio-path-stops" aria-label="Playoff rounds">{rounds.map((r, i) => <button type="button" key={i} aria-pressed={index === i} onClick={() => setRoundIndex(i)}><span className="wr-studio-dot" aria-hidden="true" /><strong>{r.label}</strong><small>{r.weeks?.length ? 'Week ' + r.weeks.join('–') : 'Week unverified'}{r.bye ? data.provisional ? ' · Provisional bye' : ' · Bye' : ''}</small></button>)}</div>{round ? <div className="wr-studio-path-result" aria-live="polite"><h4>{round.label}</h4>{round.bye ? <p className="wr-studio-bye">{data.provisional ? 'Provisional bye' : 'First-round bye'}</p> : <><span className="wr-studio-status">{data.provisional ? 'Provisional matchup' : round.status === 'final' ? 'Final' : round.status === 'scheduled' ? 'Scheduled' : 'Awaiting verification'}</span><div className="wr-studio-path-score"><span>{path.team.name}</span><strong>{data.provisional ? '—' : score(round.points?.[0])}</strong></div><div className="wr-studio-path-score"><span>{typeof round.opponent === 'string' ? round.opponent : round.opponent?.name || 'Opponent to be decided'}</span><strong>{data.provisional ? '—' : score(round.points?.[1])}</strong></div></>}{data.provisional ? <p>The field can change before the playoffs begin. This is not a confirmed matchup or bye.</p> : round.caption && <p>{round.caption}</p>}</div> : <p>No verified rounds are available for this team yet.</p>}</> : <p>No verified playoff paths are available for this season yet.</p>}</div>;
}

function WrWireStudioRace({ race, season }) {
    return <div className="wr-studio-race"><div className="wr-studio-eyebrow">{season} · {race.throughWeek > 0 ? 'Through Week ' + race.throughWeek : 'Awaiting completed results'}</div><h3>The playoff race</h3>{race.notes?.[0] && <p className="wr-studio-scope">{race.notes[0]}</p>}{!race.supported && <p className="wr-studio-notice">{race.reason || 'This format needs its league-specific rules before a playoff race can be verified.'}</p>}{(race.supported || race.rows?.length > 0) && <><p>{race.slots} playoff places · {race.remainingWeeks} regular-season week{race.remainingWeeks === 1 ? '' : 's'} remaining</p><ul className="wr-studio-race-list">{(race.rows || []).map(row => <li key={row.id}><div><strong>{row.name}</strong><span>{row.record}</span></div><p>{row.status}</p>{row.minWins != null && row.maxWins != null && <small>Possible final win total: {row.minWins}–{row.maxWins}</small>}{row.needed != null && <small>{row.needed}</small>}</li>)}</ul></>}<WrWireStudioSources notes={race.notes} /></div>;
}

window.WrWireStudio = WrWireStudio;
