// ══════════════════════════════════════════════════════════════════
// js/components/league-wire-rivalries.js — window.WrWireRivalryEditor
// Ported from C2 (2026-09-27). Follow / rename / remove rivalries between two
// current MANAGERS (owner ids). Persistence lives in WrWireRivalries
// (js/shared/league-wire-rivalries.js — localStorage, per account + league).
// Dynasty HQ addition: while the form holds an unsaved pick or name it holds
// App.LiveUpdate ('wire-rivalry'), so a silent new-build reload can't drop it;
// released on save, cancel, clear or unmount.
// ══════════════════════════════════════════════════════════════════
function WrWireRivalryEditor({ league, priorSeasons = [], onChange }) {
    const api = window.WrWireRivalries;
    const [version, setVersion] = React.useState(0);
    const [first, setFirst] = React.useState('');
    const [second, setSecond] = React.useState('');
    const [name, setName] = React.useState('');
    const [editing, setEditing] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    React.useEffect(() => {
        const refresh = () => setVersion(n => n + 1);
        window.addEventListener('wr:wire-rivalries-changed', refresh);
        window.addEventListener('storage', refresh);
        return () => { window.removeEventListener('wr:wire-rivalries-changed', refresh); window.removeEventListener('storage', refresh); };
    }, []);
    const pairs = React.useMemo(() => api.list(league, priorSeasons), [league, priorSeasons, version]);
    // Unsaved input holds the live-update reload (released when clean/unmounted).
    // Only a hold this editor actually took is released (releasing lets a
    // pending update evaluate, so never release one we didn't hold).
    const dirty = !!(first || second || name.trim());
    const holding = React.useRef(false);
    React.useEffect(() => {
        const LU = window.App?.LiveUpdate;
        if (!LU?.hold) return undefined;
        if (dirty && !holding.current) { LU.hold('wire-rivalry'); holding.current = true; }
        else if (!dirty && holding.current) { holding.current = false; LU.release?.('wire-rivalry'); }
        return undefined;
    }, [dirty]);
    React.useEffect(() => () => { if (holding.current) { holding.current = false; window.App?.LiveUpdate?.release?.('wire-rivalry'); } }, []);
    const teams = (league.rosters || []).filter(r => r.owner_id).map(r => ({ owner: String(r.owner_id), name: window.WrWireStories.oldName(league, r.roster_id) }));
    const teamName = owner => teams.find(t => t.owner === owner)?.name || 'Former manager';
    const clear = () => { setFirst(''); setSecond(''); setName(''); setEditing(false); };
    const save = event => {
        event.preventDefault(); setError(''); setMessage('');
        try { api.set(league, [first, second], name, priorSeasons); clear(); setVersion(n => n + 1); setMessage('Rivalry saved. The Wire will follow their meetings.'); onChange?.(); }
        catch (e) { setError(e.message); }
    };
    return <section className="wr-wire-rivalry-editor" aria-label="Rivalries you follow">
        <header><h3>Rivalries you follow</h3><p>Pick the matchups that matter to you. The Wire will give their previews and recaps extra attention alongside rivalries it discovers.</p></header>
        <p className="wr-journal-footnote">Saved on this device for {window.OD?.getCurrentUserId?.() ? 'your Dynasty HQ account' : 'your Sleeper login'}. These selections guide your Wire, including the all-leagues edition.</p>
        {pairs.length > 0 ? <ul>{pairs.map(pair => {
            const active = pair.owners.every(o => teams.some(t => t.owner === o));
            return <li key={api.pairKey(pair.owners)}><div>{pair.name && <strong>{pair.name}</strong>}<span>{pair.owners.map(teamName).join(' vs. ')}</span>{!active && <small>Waiting for both managers to be in this league. A replacement team won’t inherit the rivalry.</small>}</div><div className="wr-wire-rivalry-actions">{active && <button type="button" onClick={() => { setFirst(pair.owners[0]); setSecond(pair.owners[1]); setName(pair.name); setEditing(true); setError(''); setMessage(''); }}>Edit<span className="wr-wire-sr-only"> {pair.owners.map(teamName).join(' vs. ')}</span></button>}<button type="button" onClick={() => {
                setError(''); setMessage('');
                try { api.remove(league, pair.owners, priorSeasons); clear(); setVersion(n => n + 1); setMessage('Rivalry removed from your follow list.'); onChange?.(); }
                catch (e) { setError(e.message); }
            }}>Remove<span className="wr-wire-sr-only"> {pair.owners.map(teamName).join(' vs. ')}</span></button></div></li>;
        })}</ul> : <p>No rivalries selected yet. Automatic rivalry coverage continues.</p>}
        <form onSubmit={save}>
            <label>First team<select aria-label="First rivalry team" required value={first} disabled={editing} onChange={e => setFirst(e.target.value)}><option value="">Choose a team</option>{teams.map(t => <option key={t.owner} value={t.owner} disabled={t.owner === second}>{t.name}</option>)}</select></label>
            <label>Second team<select aria-label="Second rivalry team" required value={second} disabled={editing} onChange={e => setSecond(e.target.value)}><option value="">Choose a team</option>{teams.map(t => <option key={t.owner} value={t.owner} disabled={t.owner === first}>{t.name}</option>)}</select></label>
            <label>Rivalry name <span>(optional)</span><input aria-label="Rivalry name" value={name} maxLength={60} placeholder="e.g. The family feud" onChange={e => setName(e.target.value)} /></label>
            <div className="wr-wire-rivalry-actions"><button type="submit" disabled={!first || !second || first === second}>{editing ? 'Save rivalry' : 'Follow rivalry'}</button>{editing && <button type="button" onClick={clear}>Cancel edit</button>}</div>
        </form>
        {teams.length < 2 && <p>Two teams with assigned managers are needed to set up a rivalry.</p>}
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </section>;
}
window.WrWireRivalryEditor = WrWireRivalryEditor;
