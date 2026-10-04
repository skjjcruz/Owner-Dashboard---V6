// ══════════════════════════════════════════════════════════════════
// js/hub-v2.js — window.DhqHubV2: the signed-in "Welcome back" home.
//
// LAB ONLY (owner, 2026-10-02: "Copy it over to the Lab so we can play with
// it and tweak it"). Ported from C2 (WarRoom-sandbox main 4a85267):
//   js/app.js  FranchisePicker ......... 1531-1606 (page body)
//              hub header .............. 1755-1768
//              leagueHealth / initialsFor / leagueTeamName / leagueFormat
//                                        1423-1470
//   experience-hub.css (whole file) → js/hub-v2.css
//
// app.js renders this only when HUB_V2 is on: window.DHQ_LAB === true (set by
// lab/gate.html, which only scripts/publish-lab.cjs injects) or ?hub=v2 on
// localhost. The website and the app keep the old hub. This file is the
// deferred module group "hubv2", so the website never requests it at runtime.
//
// TRUTH LAW: every number is our real data and every control goes somewhere
// real. C2's games (The Vault, The Duat), the Games tab and the Commissioner's
// Office are left out — we have no equivalent. Empire shows only where Empire
// itself is enabled (EMPIRE_ENABLED in app.js); the Wire row only for Sleeper
// leagues (the all-leagues Wire covers Sleeper only).
//
// To remove the experiment: delete this file and js/hub-v2.css, the two
// hub-v2 lines in index.html, the HUB_V2 block in app.js, and the DHQ_LAB
// line in lab/gate.html.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── Styles: js/hub-v2.css, referenced from index.html inside an inert
    // <template> (a template's <link> is never fetched) so only the Lab,
    // which asks for this hub, downloads it. Resolves once the sheet is
    // applied (or failed / 4s) so the page never paints unstyled.
    let stylesPromise = null;
    function loadStyles() {
        if (stylesPromise) return stylesPromise;
        stylesPromise = new Promise(resolve => {
            const tpl = document.getElementById('dhq-hub-v2-css');
            const proto = tpl && tpl.content && tpl.content.querySelector('link');
            if (!proto) { resolve(false); return; }
            const link = proto.cloneNode(true);
            const done = ok => { clearTimeout(timer); resolve(ok); };
            const timer = setTimeout(() => done(false), 4000);
            link.onload = () => done(true);
            link.onerror = () => done(false);
            document.head.appendChild(link);
        });
        return stylesPromise;
    }

    // ── League helpers (C2 app.js 1423-1470, extended for ESPN / MFL) ──
    function initialsFor(name) {
        // ASCII-only so emoji / astral scripts don't break the crest.
        const ascii = String(name || '').replace(/[^A-Za-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!ascii) return '★';
        const w = ascii.split(' ');
        return (((w[0] && w[0][0]) || '') + ((w[1] && w[1][0]) || '')).toUpperCase();
    }
    // My roster — the same rule league-detail.js uses: MFL by franchise id,
    // ESPN by team id, Sleeper by owner id.
    function myRoster(league, sleeperUserId) {
        const rosters = (league && league.rosters) || [];
        if (league._mfl && league._mflFranchiseId) return rosters.find(r => r.roster_id === league._mflFranchiseId) || null;
        if (league._espn && league._espnTeamId) return rosters.find(r => r.roster_id === league._espnTeamId) || null;
        return sleeperUserId ? (rosters.find(r => r.owner_id === sleeperUserId) || null) : null;
    }
    function teamName(league, sleeperUserId) {
        try {
            const me = myRoster(league, sleeperUserId);
            if (me) {
                const u = (league.users || []).find(x => x.user_id === me.owner_id);
                if (me.metadata && me.metadata.team_name) return me.metadata.team_name;
                if (u && u.metadata && u.metadata.team_name) return u.metadata.team_name;
                if (u && u.display_name) return u.display_name;
            }
        } catch (e) { /* fall through to the league name */ }
        return '';
    }
    // Sleeper leagues carry my W-L on the league object (app.js loadSleeperData).
    // ESPN / MFL league objects are built with 0-0, but my roster carries the
    // platform's real standings (espn-api record.overall, mfl-api h2hw/h2hl).
    function recordOf(league, sleeperUserId) {
        let w = Number(league.wins) || 0, l = Number(league.losses) || 0, t = Number(league.ties) || 0;
        if (league._espn || league._mfl) {
            const s = (myRoster(league, sleeperUserId) || {}).settings || {};
            w = Number(s.wins) || 0; l = Number(s.losses) || 0; t = Number(s.ties) || 0;
        }
        return (w + l + t) > 0 ? w + '–' + l + (t > 0 ? '–' + t : '') : null;
    }
    // Format chips: C2's leagueFormat, with our LeagueSkin type table (so a
    // Sleeper Chopped league reads "Chopped", not "Dynasty") and the shared
    // per-league format override. An unknown type is left off, not guessed.
    function formatOf(league) {
        const bits = [];
        try {
            const rp = (league.roster_positions || []).map(s => String(s).toUpperCase());
            bits.push(rp.some(s => ['SUPER_FLEX', 'QB_FLEX', 'OP'].includes(s)) ? 'Superflex' : '1QB');
            const rec = Number((league.scoring_settings || {}).rec ?? 0);
            bits.push(rec >= 1 ? 'PPR' : rec >= 0.5 ? 'Half-PPR' : 'Standard');
            if (Number((league.scoring_settings || {}).bonus_rec_te ?? 0) > 0) bits.push('TE-Prem');
            const teams = (league.rosters || []).length || (league.settings || {}).num_teams || league.total_rosters || 0;
            if (teams) bits.push(teams + '-team');
            const App = window.App || {};
            const skin = App.LeagueSkin || {};
            const norm = v => (skin.normalizeType ? skin.normalizeType(v) : ({ 0: 'redraft', 1: 'keeper', 2: 'dynasty', 3: 'chopped' }[String(v)] || String(v || '').toLowerCase()));
            let override = '';
            try { override = norm(App.Intelligence?.getLeagueTypeOverride?.(league) || ''); } catch (e) { override = ''; }
            const raw = [league.type, league.league_type, (league.settings || {}).type, (league.metadata || {}).type].find(v => v !== undefined && v !== null && v !== '');
            const type = override || (raw !== undefined ? norm(raw) : '');
            const meta = skin.TYPE_META || {};
            const label = type && type !== 'unknown'
                ? ((meta[type] && meta[type].label) || { redraft: 'Redraft', keeper: 'Keeper', dynasty: 'Dynasty', chopped: 'Chopped', best_ball: 'Best Ball' }[type])
                : null;
            if (label) bits.push(label);
        } catch (e) { /* chips are best-effort */ }
        return bits.join(' · ');
    }
    function platformOf(league) {
        return league._espn ? 'ESPN' : league._mfl ? 'MFL' : 'Sleeper';
    }

    // Re-render when the async server tier lands (same pattern as app.js
    // useResolvedTier) so the Empire card reflects the real tier.
    function useTier() {
        const [, bump] = React.useState(0);
        React.useEffect(() => {
            const on = () => bump(n => n + 1);
            if (window.App && window.App._userTierResolved) on();
            window.addEventListener('dhq:tier-resolved', on);
            return () => window.removeEventListener('dhq:tier-resolved', on);
        }, []);
        return typeof window.getUserTier === 'function' ? window.getUserTier() : 'free';
    }

    function ProShield({ size }) {
        const s = size || 34;
        return <svg viewBox="0 0 24 24" width={s} height={s} fill="none" aria-hidden="true">
            <path d="M12 2L3 7v6c0 5.25 3.83 10.18 9 11.38C17.17 23.18 21 18.25 21 13V7L12 2z" fill="url(#hv2ProGrad)" stroke="var(--k-d4af37, #d4af37)" strokeWidth="1" />
            <path d="M12 7l1.545 3.13 3.455.503-2.5 2.437.59 3.43L12 14.885 8.91 16.5l.59-3.43-2.5-2.437 3.455-.503L12 7z" fill="var(--k-0a0a0a, #0a0a0a)" stroke="var(--k-b8941e, #b8941e)" strokeWidth="0.5" />
            <defs><linearGradient id="hv2ProGrad" x1="3" y1="2" x2="21" y2="24"><stop offset="0%" stopColor="var(--k-d4af37, #d4af37)" /><stop offset="100%" stopColor="var(--k-8b6914, #8b6914)" /></linearGradient></defs>
        </svg>;
    }

    // Props (all supplied by app.js — the hub owns no data of its own):
    //   leagues, sleeperLeagues, sleeperUserId, lastLeagueId, displayName,
    //   syncing, notices [{ key, text, action: { label, onClick | href } }],
    //   onSelect(league), onAddLeague(), onOpenSettings(), avatar (element|null),
    //   links { home, discord }, iconSrc,
    //   empire: null | { onOpen(), onExplore(), freePrelive }
    function DhqHubV2(props) {
        const { leagues = [], sleeperLeagues = [], sleeperUserId = null, lastLeagueId = null, displayName = '',
            syncing = false, notices = [], onSelect, onAddLeague, onOpenSettings, avatar = null, links = {}, iconSrc = 'icon-192.png', empire = null } = props;
        const [query, setQuery] = React.useState('');
        const [showAll, setShowAll] = React.useState(false);
        const [wire, setWire] = React.useState('closed'); // closed | loading | open | error
        const tier = useTier();

        const q = query.trim().toLowerCase();
        const lastId = lastLeagueId == null ? null : String(lastLeagueId);
        const resume = lastId ? leagues.find(l => String(l.id) === lastId) : null;
        const focus = resume || leagues[0] || null;
        const titleOf = l => teamName(l, sleeperUserId) || l.name || '';
        const filtered = leagues
            .filter(l => !q || [l.name, teamName(l, sleeperUserId), formatOf(l), platformOf(l)].join(' ').toLowerCase().includes(q))
            .sort((a, b) => Number(String(b.id) === lastId) - Number(String(a.id) === lastId));

        const isPaid = !!(empire && (empire.freePrelive || ['pro', 'warroom', 'war_room', 'commissioner'].includes(tier)));
        const wireAvailable = sleeperLeagues.length > 0 && !!sleeperUserId;
        const jumps = [['hv2-leagues', 'Your leagues'], empire ? ['hv2-management', 'Management'] : null].filter(Boolean);
        const jump = id => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

        // The all-leagues Wire is the deferred 'wire' group (league-wire-portfolio.js).
        function openWire() {
            if (typeof window.WrAllLeaguesWire === 'function') { setWire('open'); return; }
            setWire('loading');
            const load = window.wrLoadModuleGroup ? window.wrLoadModuleGroup('wire') : Promise.resolve();
            load.then(() => setWire(typeof window.WrAllLeaguesWire === 'function' ? 'open' : 'error'))
                .catch(e => { if (window.wrLog) window.wrLog('hubv2.wire', e); setWire('error'); });
        }
        const AllWire = wire === 'open' ? window.WrAllLeaguesWire : null;

        const cards = filtered.map((l, i) => {
            const title = titleOf(l);
            const rec = recordOf(l, sleeperUserId);
            const isLast = String(l.id) === lastId;
            const sub = title !== l.name ? l.name : platformOf(l) + ' league';
            return <button type="button" key={l.id}
                className={'hv2-league-card' + (isLast ? ' is-last' : '') + (!q && i >= 3 ? ' hv2-league-overflow' + (showAll ? ' is-expanded' : '') : '')}
                onClick={() => onSelect(l)}>
                <span className="hv2-league-card-top">
                    <span className="hv2-team-avatar" aria-hidden="true">{initialsFor(title)}</span>
                    <span className="hv2-league-identity"><strong>{title}</strong><span>{sub}</span></span>
                    {isLast && <span className="hv2-last-badge">Last opened</span>}
                </span>
                <span className="hv2-league-card-bottom">
                    <span>{[platformOf(l) !== 'Sleeper' ? platformOf(l) : null, formatOf(l)].filter(Boolean).join(' · ')}</span>
                    <span>{rec || 'Open league'} <span aria-hidden="true">→</span></span>
                </span>
            </button>;
        });
        const statusText = syncing
            ? (leagues.length ? 'Syncing · ' + leagues.length + ' loaded so far' : 'Syncing your leagues…')
            : leagues.length + ' connected league' + (leagues.length === 1 ? '' : 's');

        return <div className="hv2-shell">
            <header className="hv2-header">
                <a className="hv2-brand" aria-label="Dynasty HQ home" href={links.home}>
                    <img src={iconSrc} alt="" />
                    <span className="hv2-brand-text">
                        <span className="owner-name wr-wordmark hv2-wordmark">DYNASTY HQ</span>
                        <span className="hv2-subtitle">{displayName}</span>
                    </span>
                </a>
                {/* One button (owner ask 2026-10-03): plans/billing and AI
                    settings no longer apply — everything is free. */}
                <div className="hv2-account-controls">
                    <button type="button" aria-label="My Profile" onClick={onOpenSettings}>
                        <span className="hv2-account-avatar" aria-hidden="true">{avatar || initialsFor(displayName).slice(0, 1) || '★'}</span>
                        <span className="hv2-account-label">My Profile</span>
                    </button>
                </div>
            </header>

            <main className="hv2-page">
                <div className="hv2-welcome">
                    <h1>{leagues.length ? 'Welcome back.' : 'Your home field.'}</h1>
                    <span className="hv2-sync-status" role="status">{statusText}</span>
                </div>
                {focus && <button type="button" className="hv2-resume" onClick={() => onSelect(focus)}>
                    <span className="hv2-eyebrow">{resume ? 'Last opened' : 'Your league'}</span>
                    <strong>{(resume ? 'Resume ' : 'Open ') + titleOf(focus)}</strong>
                    <span>{focus.name}{recordOf(focus, sleeperUserId) && <span className="hv2-focus-record"> · {recordOf(focus, sleeperUserId)}</span>}</span>
                    <b aria-hidden="true">→</b>
                </button>}
                {notices.map(n => <div key={n.key} className="hv2-notice" role="status">
                    <p>{n.text}</p>
                    {n.action && (n.action.href
                        ? <a className="hv2-add-button" href={n.action.href}>{n.action.label}</a>
                        : <button type="button" className="hv2-add-button" onClick={n.action.onClick}>{n.action.label}</button>)}
                </div>)}
                {jumps.length > 1 && <nav className="hv2-jump-nav" aria-label="Jump to a section">
                    {jumps.map(([id, label]) => <button type="button" key={id} onClick={() => jump(id)}>{label}</button>)}
                </nav>}

                <section id="hv2-leagues" className="hv2-leagues" aria-labelledby="hv2-leagues-title">
                    <div className="hv2-section-heading">
                        <h2 id="hv2-leagues-title">Your leagues <span className="hv2-count">{leagues.length}</span></h2>
                        <button type="button" className="hv2-add-button" onClick={onAddLeague}>+ Add league</button>
                    </div>
                    {leagues.length > 0 && <div className="hv2-league-tools">
                        <label htmlFor="hv2-league-search">Find your league</label>
                        <input id="hv2-league-search" type="search" placeholder="Find a league or team" value={query} onChange={e => setQuery(e.target.value)} />
                        <span aria-live="polite">{q ? filtered.length + ' found' : ''}</span>
                    </div>}
                    <div id="hv2-league-results" className="hv2-league-grid">{cards}</div>
                    {!q && cards.length > 3 && <button type="button" className="hv2-more-leagues" aria-expanded={showAll} aria-controls="hv2-league-results" onClick={() => setShowAll(!showAll)}>
                        <span>{showAll ? 'Show fewer leagues' : 'Show all ' + leagues.length + ' leagues'}</span><span aria-hidden="true">{showAll ? '⌃' : '⌄'}</span>
                    </button>}
                    {!filtered.length && <div className="hv2-empty" role="status">
                        <strong>{q ? 'No matching leagues' : syncing ? 'Bringing your leagues together…' : 'Your first league starts here.'}</strong>
                        <p>{q ? 'Try another team name, league, or format.' : syncing ? 'Your teams appear here as each league loads.' : 'Connect your fantasy account to see your teams in one place.'}</p>
                        {q ? <button type="button" className="hv2-add-button" onClick={() => setQuery('')}>Clear search</button>
                            : !syncing && <button type="button" className="hv2-add-button" onClick={onAddLeague}>Connect a league</button>}
                    </div>}
                    {wireAvailable && <button type="button" className="hv2-wire-entry wr-all-wire-launch" onClick={openWire} aria-haspopup="dialog" disabled={wire === 'loading'}>
                        <span className="hv2-wire-icon" aria-hidden="true">W</span>
                        <span><strong>The Wire</strong><span>{wire === 'loading' ? 'Opening…' : wire === 'error' ? 'The Wire didn’t load. Tap to try again.' : 'One front page for your Sleeper leagues'}</span></span>
                        <b aria-hidden="true">→</b>
                    </button>}
                </section>

                {empire && <section id="hv2-management" className="hv2-management" aria-labelledby="hv2-management-title">
                    <div className="hv2-section-heading"><h2 id="hv2-management-title">Across your leagues</h2></div>
                    <div className="hv2-management-cards">
                        <button type="button" className="hv2-experience-card hv2-empire" onClick={() => (isPaid ? empire.onOpen() : empire.onExplore())}>
                            <span className="hv2-card-top"><ProShield size={34} /><span className="hv2-product-tag">{isPaid ? 'PORTFOLIO' : 'PRO'}</span></span>
                            <strong>Empire</strong>
                            <span className="hv2-card-description">All {leagues.length} league{leagues.length === 1 ? '' : 's'} in one terminal: players, picks, and exposure.</span>
                            <span className="hv2-card-action">{isPaid ? 'Open Empire' : 'Explore Empire Pro'} <span aria-hidden="true">↗</span></span>
                        </button>
                    </div>
                </section>}

                <footer className="hv2-footer">
                    <span>Dynasty HQ</span>
                    <button type="button" onClick={onOpenSettings}>My Profile</button>
                    {links.discord && <a href={links.discord} target="_blank" rel="noopener">Discord</a>}
                </footer>
            </main>
            {AllWire && <AllWire key={String(sleeperUserId)} accountId={String(sleeperUserId)} leagues={sleeperLeagues}
                onClose={() => setWire('closed')}
                onOpenLeague={l => { setWire('closed'); onSelect(l); }} />}
        </div>;
    }

    DhqHubV2.loadStyles = loadStyles;
    window.DhqHubV2 = DhqHubV2;
})();
