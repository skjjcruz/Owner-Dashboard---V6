// ══════════════════════════════════════════════════════════════════
// js/components/league-wire-nfl.js — window.WrNflPlayerStats (+ WrNflPlayerBox)
// Per-game player box score for The Wire's NFL desk (C2 1be683d, adapted).
// Lives inside each game's "Box score" panel in OUR WrNflDesk
// (league-wire.js), which keeps its ESPN-direct scores and quarter table.
// Nothing is fetched until the reader taps "Load player stats": then
// WrWireNfl.loadBoxScore reads Sleeper's game stats (else ESPN's public
// game summary, read directly — never our relay). Closing the panel, a new
// game, or unmounting cancels the request; a failed refresh keeps the last
// box with a note. When both sources fail the desk says so — nothing is
// estimated. Standouts are written from the loaded box (WrWireNfl.recap) and
// only when the box's score matches the scoreboard's.
// Props: game (scoreboard game + season, week, seasontype).
// ══════════════════════════════════════════════════════════════════
function WrNflPlayerStats({ game }) {
    const [open, setOpen] = React.useState(false);
    const [revision, setRevision] = React.useState(0);
    const [entry, setEntry] = React.useState({ key: '', status: 'idle', data: null });
    const key = [game.season, game.seasontype, game.week, game.id, game.away, game.home].join('|');
    const current = entry.key === key ? entry : { status: 'idle', data: null };
    React.useEffect(() => {
        if (!open || !window.WrWireNfl?.loadBoxScore) return undefined;
        const controller = new window.AbortController();
        let alive = true;
        setEntry(old => ({ key, status: 'loading', data: old.key === key ? old.data : null }));
        Promise.resolve().then(() => window.WrWireNfl.loadBoxScore({ game, signal: controller.signal, force: revision > 0 }))
            .then(data => { if (alive && !controller.signal.aborted) setEntry({ key, status: data.status, data }); })
            .catch(error => { if (alive && error?.name !== 'AbortError') setEntry(old => ({ key, status: 'error', data: old.key === key ? old.data : null, message: error.message || 'Player stats could not load. Try again.' })); });
        return () => { alive = false; controller.abort(); };
    }, [open, key, revision]);
    if (!window.WrWireNfl?.loadBoxScore) return null;
    // Standouts only from a box whose final score matches this scoreboard
    // (recap() otherwise falls back to ESPN's leaders, already on the card).
    const box = current.data;
    const matches = box?.status === 'ready' && game.completed && box.game?.completed && box.game.homeScore === game.homeScore && box.game.awayScore === game.awayScore;
    const standouts = matches && window.WrWireNfl.recap ? window.WrWireNfl.recap(game, box).spotlight : [];
    return <div className="wr-nfl-player-stats">
        <button type="button" className="wr-nfl-open-box" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Load'} player stats: ${game.away} at ${game.home}`} onClick={() => setOpen(value => !value)}>{open ? 'Hide player stats' : 'Load player stats'} <span aria-hidden="true">{open ? '−' : '+'}</span></button>
        {open && <>
            {current.status === 'loading' && <p role="status">{current.data ? 'Refreshing player stats…' : 'Loading player stats…'}</p>}
            {current.status === 'error' && <div role="status" className="wr-nfl-notice"><p>{current.message}</p>{current.data && <p>Showing the last player stats that loaded for this game.</p>}<button type="button" onClick={() => setRevision(n => n + 1)}>Try again</button></div>}
            {standouts.length > 0 && <div className="wr-nfl-standouts"><h5>Standouts</h5>{standouts.map((line, i) => <p key={i}>{line}</p>)}</div>}
            {current.data && <WrNflPlayerBox key={key} data={current.data} />}
            {current.data && current.status !== 'loading' && <button type="button" onClick={() => setRevision(n => n + 1)}>Refresh player stats</button>}
        </>}
    </div>;
}

function WrNflPlayerBox({ data }) {
    const [teamId, setTeamId] = React.useState('');
    const [groupId, setGroupId] = React.useState('passing');
    const teams = data.teams || [], team = teams.find(t => t.id === teamId) || teams[0];
    const groups = (team?.groups || []).filter(g => g.players.length), group = groups.find(g => g.id === groupId) || groups[0];
    const statKeys = [...new Set((data.teamStats || []).flatMap(t => t.stats.map(s => s.key)))];
    const stamp = data.updatedAt || data.checkedAt;
    return <div className="wr-nfl-player-box">
        <p className="wr-nfl-source">Player stats: {data.statsSource || 'ESPN'}{stamp ? ' · checked ' + new Date(stamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}{data.game && !data.game.completed ? ' · game in progress; totals may change' : ' · official corrections may change totals'}</p>
        {data.status === 'empty' || !group ? <p>Player stats have not been published for this game yet.</p> : <>
            <div className="wr-nfl-box-filters"><label>Team<select aria-label="Box score team" value={team?.id || ''} onChange={e => setTeamId(e.target.value)}>{teams.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label><label>Stats<select aria-label="Box score category" value={group?.id || ''} onChange={e => setGroupId(e.target.value)}>{groups.map(g => <option value={g.id} key={g.id}>{g.label}</option>)}</select></label></div>
            <div className="wr-nfl-table-scroll" role="region" aria-label={`${team.name} ${group.label.toLowerCase()} player stats`} tabIndex={0}><table><caption>{team.name} · {group.label}</caption><thead><tr><th scope="col">Player</th>{group.columns.map(c => <th scope="col" key={c.key}><abbr title={c.description}>{c.label}</abbr></th>)}</tr></thead><tbody>{group.players.map(p => <tr key={p.id}><th scope="row">{p.name}</th>{p.values.map((value, i) => <td key={group.columns[i].key}>{value ?? '—'}</td>)}</tr>)}</tbody></table></div>
            <p className="wr-nfl-box-note">NFL statistics, not fantasy points. A dash means the stat was not provided.</p>
        </>}
        {statKeys.length > 0 && <details className="wr-nfl-team-stats"><summary>Team comparison</summary><div className="wr-nfl-table-scroll" role="region" aria-label="NFL team statistics" tabIndex={0}><table><caption>Team statistics</caption><thead><tr><th scope="col">Stat</th>{data.teamStats.map(t => <th scope="col" key={t.abbr}>{t.abbr}</th>)}</tr></thead><tbody>{statKeys.map(statKey => <tr key={statKey}><th scope="row">{data.teamStats.flatMap(t => t.stats).find(s => s.key === statKey)?.label}</th>{data.teamStats.map(t => <td key={t.abbr}>{t.stats.find(s => s.key === statKey)?.value ?? '—'}</td>)}</tr>)}</tbody></table></div></details>}
    </div>;
}
window.WrNflPlayerStats = WrNflPlayerStats;
window.WrNflPlayerBox = WrNflPlayerBox;
