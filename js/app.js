// ══════════════════════════════════════════════════════════════════
// app.js — OwnerDashboard (root component) + ReactDOM.render
// Must load LAST — depends on all other modules.
// ══════════════════════════════════════════════════════════════════
    const APP_WR_KEYS  = window.App.WR_KEYS;
    const AppStorage = window.App.WrStorage;
    const WR_HOST = window.location.hostname || '';
    const WR_PATH = window.location.pathname || '';
    const PLATFORM_SANDBOX_ACCESS = WR_HOST.includes('sandbox')
        || /\/warroom-sandbox(\/|$)/i.test(WR_PATH)
        || window.SANDBOX_MODE === true
        || ['localhost', '127.0.0.1'].includes(WR_HOST);
    // MFL is GA on production (no longer sandbox-beta-only). ESPN/Yahoo remain
    // sandbox-gated via PLATFORM_SANDBOX_ACCESS. Flip to false to re-gate MFL.
    const MFL_ENABLED = true;
    const MFL_SANDBOX_ACCESS = MFL_ENABLED || PLATFORM_SANDBOX_ACCESS;
    function platformAccessAllowed(platform) {
        platform = platform || 'sleeper';
        if (platform === 'sleeper') return true;
        if (platform === 'mfl') return MFL_ENABLED || PLATFORM_SANDBOX_ACCESS;
        return PLATFORM_SANDBOX_ACCESS; // espn / yahoo — sandbox only
    }
    function platformBetaMessage(platform) {
        const labels = { espn: 'ESPN', mfl: 'MFL', yahoo: 'Yahoo' };
        return (labels[platform] || 'This platform') + ' is currently available only in the sandbox beta.';
    }
    window.App.PLATFORM_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
    window.App.MFL_SANDBOX_ACCESS = MFL_SANDBOX_ACCESS;
    window.PLATFORM_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
    window.MFL_SANDBOX_ACCESS = MFL_SANDBOX_ACCESS;
    window.platformAccessAllowed = platformAccessAllowed;

    // ── PRE-LIVE: Empire Dashboard is free for everyone until launch. ──
    // Flip to false (or delete) to restore the paid gate before going live.
    const EMPIRE_FREE_PRELIVE = true;
    window.App.EMPIRE_FREE_PRELIVE = EMPIRE_FREE_PRELIVE;

    // ── Empire Dashboard is sandbox-only while it bakes. Flip EMPIRE_SANDBOX_ONLY
    // to false to relaunch it on production (EMPIRE_FREE_PRELIVE above then decides
    // whether the relaunched surface is paid-gated). ──
    const EMPIRE_SANDBOX_ONLY = true; // owner ruling 2026-07-13: Empire hidden on prod until it's ready for prime time
    const EMPIRE_ENABLED = PLATFORM_SANDBOX_ACCESS || !EMPIRE_SANDBOX_ONLY;
    window.App.EMPIRE_ENABLED = EMPIRE_ENABLED;

    const WR_DISCORD_URL = 'https://discord.gg/3VFRJbWVnH'; // Dynasty HQ Discord — same invite as the marketing page
    window.App.WR_DISCORD_URL = WR_DISCORD_URL;
    window.WR_DISCORD_URL = WR_DISCORD_URL;

    // The league hub's brand icon goes to the app's own front page
    // (landing.html). Owner ruling 2026-07-12 (supersedes the same-day
    // marketing-page ruling): the separate DHQ-Web-Page marketing site is
    // SIDELINED — still deployed at its own URL, but nothing links to it;
    // landing.html is the single face for browser and app. ?home keeps its
    // signed-in redirect from bouncing straight back into the app.
    const DHQ_HOME_URL = 'landing.html?home';
    window.App.DHQ_HOME_URL = DHQ_HOME_URL;

    // ── Owner default: bigloco's locked-in MFL franchise in the "MLS Dynasty
    // League" (id 41969). Used to auto-select the team on rehydrate when no
    // mfl_franchise_id is persisted yet. Matched by NAME in loadMflData so the
    // pick survives storage clears / new devices without pinning a numeric id. ──
    const OWNER_MFL_TEAM = 'St. Louis City SC';

    // ── Notes from the Front — Field Log feed from Scout sessions ──
    var FL_CAT_COLORS = { trade:'var(--k-d4af37, #d4af37)', roster:'var(--k-2ecc71, #2ecc71)', draft:'var(--k-3498db, #3498db)', waivers:'var(--k-9b59b6, #9b59b6)', research:'var(--k-e67e22, #e67e22)', note:'var(--k-808080, #808080)' };
    var FL_CAT_ICONS  = { trade:'🔄', roster:'📋', draft:'🎯', waivers:'📡', research:'🔍', note:'📝' };

    function FieldLogPanel(props) {
        var leagues = props.leagues || [];
        var onOpenLeague = props.onOpenLeague;
        var _s1 = React.useState(null);  var entries = _s1[0]; var setEntries = _s1[1];
        var _s2 = React.useState(false); var syncing = _s2[0]; var setSyncing = _s2[1];
        var _s3 = React.useState(0);     var lastRefresh = _s3[0]; var setLastRefresh = _s3[1];
        var _s4 = React.useState(false); var noSupabase = _s4[0]; var setNoSupabase = _s4[1];

        React.useEffect(function() {
            if (!window.OD || !window.OD.loadFieldLog) { setNoSupabase(true); setEntries([]); return; }
            setNoSupabase(false);
            window.OD.loadFieldLog(window.S?.currentLeagueId || null, 60)
                .then(function(data) { setEntries(data || []); })
                .catch(function() { setEntries([]); });
        }, [lastRefresh]);

        // Auto-refresh field log every 60 seconds
        React.useEffect(function() {
            var interval = setInterval(function() { setLastRefresh(Date.now()); }, 60000);
            return function() { clearInterval(interval); };
        }, []);

        var grouped = React.useMemo(function() {
            if (!entries || !entries.length) return [];
            var groups = {};
            entries.forEach(function(e) {
                var d = new Date(e.ts);
                var key = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
                if (!groups[key]) groups[key] = { label: key, ts: e.ts, items: [] };
                groups[key].items.push(e);
            });
            return Object.values(groups).sort(function(a,b) { return b.ts - a.ts; });
        }, [entries]);

        function handleManualSync() {
            if (!window.OD || !window.OD.syncPendingFieldLog) return;
            setSyncing(true);
            window.OD.syncPendingFieldLog().catch(function(){}).then(function() {
                setLastRefresh(Date.now());
                setSyncing(false);
            });
        }

        var pendingCount = (entries || []).filter(function(e) { return e.syncStatus === 'pending' || e.syncStatus === 'failed'; }).length;

        return React.createElement('div', { className: 'product-card', style: { gridColumn: '1 / -1' } },
            // Header row
            React.createElement('div', { className: 'product-card-header', style: { marginBottom: '0.75rem' } },
                React.createElement('div', { style: { width:40,height:40,borderRadius:10,background:'rgba(124,107,248,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.2rem',flexShrink:0 } }, '📋'),
                React.createElement('div', { style: { flex:1 } },
                    React.createElement('div', { className: 'product-card-title' }, 'NOTES FROM THE FRONT'),
                    React.createElement('div', { className: 'product-card-subtitle' }, 'Intel logged in your Scout sessions')
                ),
                React.createElement('button', { onClick: handleManualSync, disabled: syncing, style: { flexShrink:0,background:'none',border:'1px solid rgba(124,107,248,0.4)',borderRadius:6,color:'var(--k-7c6bf8, #7c6bf8)',fontSize:'var(--text-label, 0.75rem)',padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:700,opacity:syncing?0.5:1,minHeight:'44px',display:'inline-flex',alignItems:'center',justifyContent:'center' } },
                    syncing ? '↻ Syncing…' : '↻ Refresh'
                )
            ),
            // Body
            entries === null
                ? React.createElement('div', { style: { padding:'1rem 0',textAlign:'center',color:'var(--silver)',fontSize:'var(--text-body, 1rem)' } }, 'Loading field log…')
                : entries.length === 0
                ? (noSupabase
                    ? React.createElement('div', { style: { padding:'1.5rem 0',textAlign:'center' } },
                        React.createElement('div', { style: { fontSize:'1.6rem',marginBottom:'0.5rem' } }, '🔌'),
                        React.createElement('div', { style: { fontSize:'var(--text-body, 1rem)',color:'var(--silver)',lineHeight:1.6 } }, 'Connect your Scout account to see field notes.')
                      )
                    : React.createElement('div', { style: { padding:'1.5rem 0',textAlign:'center' } },
                        React.createElement('div', { style: { fontSize:'2rem',marginBottom:'0.5rem' } }, '📋'),
                        React.createElement('div', { style: { fontSize:'var(--text-body, 1rem)',color:'var(--silver)',lineHeight:1.6 } }, 'No field log entries yet. Actions you take in Scout — trade scenarios, draft targets, waiver bids — will appear here automatically after syncing.')
                      )
                  )
                : React.createElement('div', { style: { maxHeight:'340px',overflowY:'auto',paddingRight:'2px' } },
                    grouped.map(function(group) {
                        return React.createElement('div', { key: group.label, style: { marginBottom:'14px' } },
                            React.createElement('div', { style: { fontSize:'var(--text-label, 0.75rem)',fontWeight:700,color:'var(--silver)',textTransform:'uppercase',letterSpacing:'0.08em',padding:'0 0 5px',borderBottom:'1px solid var(--ov-4, rgba(255,255,255,0.06))',marginBottom:'6px',opacity:0.7 } }, group.label),
                            group.items.map(function(entry, idx) {
                                var timeStr = new Date(entry.ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
                                var catColor = FL_CAT_COLORS[entry.category] || 'var(--k-808080, #808080)';
                                var targetLeague = entry.leagueId ? leagues.find(function(l) { return l.id === entry.leagueId; }) : null;
                                return React.createElement('div', { key: entry.id || idx, style: { display:'flex',gap:'8px',alignItems:'flex-start',padding:'5px 0',borderBottom:'1px solid var(--ov-2, rgba(255,255,255,0.03))' } },
                                    React.createElement('span', { style: { fontSize:'var(--text-body, 1rem)',flexShrink:0,marginTop:'1px' } }, entry.icon || FL_CAT_ICONS[entry.category] || '📋'),
                                    React.createElement('div', { style: { flex:1,minWidth:0 } },
                                        React.createElement('div', { style: { fontSize:'var(--text-body, 1rem)',color:'var(--white)',lineHeight:1.35 } }, entry.text),
                                        entry.players && entry.players.length > 0 && React.createElement('div', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--k-7c6bf8, #7c6bf8)',marginTop:'2px' } }, entry.players.map(function(p){ return p.name||p; }).join(', ')),
                                        entry.context && React.createElement('div', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',marginTop:'2px',fontStyle:'italic',opacity:0.8,lineHeight:1.3 } }, entry.context),
                                        React.createElement('div', { style: { display:'flex',gap:'5px',alignItems:'center',marginTop:'3px',flexWrap:'wrap' } },
                                            React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:catColor,fontWeight:700,textTransform:'uppercase' } }, entry.category),
                                            React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.4 } }, '·'),
                                            React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.6 } }, timeStr),
                                            targetLeague && React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.4 } }, '·'),
                                            targetLeague && React.createElement('span', { style: { fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.7 } }, targetLeague.name)
                                        )
                                    ),
                                    targetLeague && onOpenLeague && React.createElement('button', { onClick: function(){ onOpenLeague(targetLeague, entry.category); }, style: { flexShrink:0,background:'none',border:'1px solid var(--acc-line2, rgba(212,175,55,0.35))',borderRadius:4,color:'var(--gold)',fontSize:'var(--text-label, 0.75rem)',padding:'2px 7px',cursor:'pointer',fontFamily:'inherit',fontWeight:700,marginTop:'1px',minHeight:'44px',minWidth:'44px',display:'inline-flex',alignItems:'center',justifyContent:'center' } }, 'OPEN →')
                                );
                            })
                        );
                    })
                  ),
            // Footer
            entries !== null && pendingCount > 0 && React.createElement('div', { style: { marginTop:'8px',paddingTop:'8px',borderTop:'1px solid var(--ov-4, rgba(255,255,255,0.06))',fontSize:'var(--text-label, 0.75rem)',color:'var(--silver)',opacity:0.7 } }, pendingCount + ' entries pending sync from Scout. Open Scout to push them.')
        );
    }

    // ── ESPN Connect Card ─────────────────────────────────────────
    function ESPNConnectCard({ leagues, connecting, error, onConnect, onSelectLeague, reconBase }) {
        const [leagueId, setLeagueId]   = React.useState('');
        const [espnS2, setEspnS2]       = React.useState('');
        const [swid, setSwid]           = React.useState('');
        const [showCreds, setShowCreds] = React.useState(false);

        const RED = 'var(--k-cc0000, #cc0000)';
        const RED_BG = 'rgba(204,0,0,0.08)';
        const RED_BORDER = 'rgba(204,0,0,0.3)';

        function espnScoutUrl(numericId) {
            return reconBase + '?espn_league=' + numericId;
        }

        if (leagues.length > 0) {
            return React.createElement('div', null,
                leagues.map(function(l) {
                    return React.createElement('div', {
                        key: l.id,
                        style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: RED_BG, border: '1px solid ' + RED_BORDER, borderRadius: 10, marginBottom: 8, cursor: 'pointer' },
                        onClick: function() { onSelectLeague(l); }
                    },
                        React.createElement('div', { style: { width: 32, height: 32, borderRadius: 8, background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
                            React.createElement('span', { style: { fontSize: 13, fontWeight: 800, color: 'var(--k-ffffff, #ffffff)' } }, 'E')
                        ),
                        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', fontWeight: 600, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, l.name),
                            React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: 2 } },
                                (l.rosters || []).length + ' teams · ' + l.season + ' · ESPN'
                            )
                        ),
                        React.createElement('span', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 800, background: RED, color: 'var(--k-ffffff, #ffffff)', borderRadius: 4, padding: '2px 6px', flexShrink: 0 } }, 'ESPN')
                    );
                }),
                React.createElement('a', {
                    href: espnScoutUrl(leagues[0]._espnLeagueId),
                    target: '_blank', rel: 'noopener noreferrer',
                    className: 'hub-cta',
                    style: { textDecoration: 'none', background: RED, marginTop: 4, display: 'block', textAlign: 'center', padding: '10px', borderRadius: 8, fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--k-ffffff, #ffffff)', letterSpacing: '.06em' }
                }, 'OPEN IN SCOUT →'),
                React.createElement('button', {
                    onClick: function() { /* allow reconnecting */ },
                    style: { background: 'none', border: 'none', color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', cursor: 'pointer', marginTop: 6, padding: 0 }
                }, '+ Connect another league')
            );
        }

        return React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.6 } },
                'Connect any ESPN Fantasy Football league. Your League ID is in the URL: fantasy.espn.com/football/league?leagueId=',
                React.createElement('strong', { style: { color: 'var(--white)' } }, '123456')
            ),
            React.createElement('input', {
                placeholder: 'ESPN League ID (e.g. 123456)',
                value: leagueId,
                onChange: function(e) { setLeagueId(e.target.value); },
                onKeyDown: function(e) { if (e.key === 'Enter') onConnect(leagueId, espnS2, swid); },
                style: { width: '100%', fontSize: 'var(--text-body, 1rem)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'var(--charcoal)', color: 'var(--white)', boxSizing: 'border-box', marginBottom: 8, fontFamily: 'inherit' }
            }),
            React.createElement('div', {
                onClick: function() { setShowCreds(!showCreds); },
                style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', cursor: 'pointer', marginBottom: showCreds ? 8 : 0, display: 'flex', alignItems: 'center', gap: 4 }
            },
                React.createElement('span', null, showCreds ? '▾' : '▸'),
                ' Private league? Add cookies for access'
            ),
            showCreds && React.createElement('div', { style: { marginBottom: 8 } },
                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.5, marginBottom: 6 } },
                    'F12 → Application → Cookies → fantasy.espn.com — copy espn_s2 and SWID values.'
                ),
                React.createElement('input', {
                    placeholder: 'espn_s2 cookie value',
                    type: 'password',
                    value: espnS2,
                    onChange: function(e) { setEspnS2(e.target.value); },
                    style: { width: '100%', fontSize: 'var(--text-body, 1rem)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'var(--charcoal)', color: 'var(--white)', boxSizing: 'border-box', marginBottom: 6, fontFamily: 'monospace' }
                }),
                React.createElement('input', {
                    placeholder: 'SWID cookie value {XXXXXXXX-...}',
                    value: swid,
                    onChange: function(e) { setSwid(e.target.value); },
                    style: { width: '100%', fontSize: 'var(--text-body, 1rem)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'var(--charcoal)', color: 'var(--white)', boxSizing: 'border-box', fontFamily: 'monospace' }
                })
            ),
            error && React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--k-e74c3c, #e74c3c)', marginBottom: 8, padding: '6px 10px', background: 'rgba(231,76,60,0.08)', borderRadius: 6, lineHeight: 1.5 } }, error),
            React.createElement('button', {
                onClick: function() { onConnect(leagueId, espnS2, swid); },
                disabled: connecting,
                style: { width: '100%', padding: '10px', background: connecting ? 'rgba(204,0,0,0.5)' : RED, color: 'var(--k-ffffff, #ffffff)', border: 'none', borderRadius: 8, fontSize: 'var(--text-body, 1rem)', fontWeight: 700, cursor: connecting ? 'not-allowed' : 'pointer', letterSpacing: '.05em', fontFamily: 'inherit' }
            }, connecting ? 'Connecting...' : 'CONNECT ESPN LEAGUE')
        );
    }

    // Main Dashboard
    function OwnerDashboard() {
        const [showSettings, setShowSettings] = useState(false);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [sleeperUser, setSleeperUser] = useState(null);
        const [selectedYear, setSelectedYear] = useState('2026');
        const [sleeperLeagues, setSleeperLeagues] = useState([]);
        const [activeLeagueId, setActiveLeagueId] = useState(null);
        const [selectedLeague, setSelectedLeague] = useState(null);
        const [proMode, setProMode] = useState(false); // Empire Dashboard mode
        const [showConnect, setShowConnect] = useState(false); // hub: show platform connect / add-league view
        // Lifted tab state for browser history navigation
        const [activeTab, setActiveTab] = useState('dashboard');
        const isNavigatingRef = React.useRef(false);
        const initialRouteAppliedRef = React.useRef(false);
        // When the hub's league cards (records/rosters) last finished loading —
        // drives the return-to-hub freshness check below (audit:refresh-stale step 10).
        const hubSyncedAtRef = React.useRef(0);
        // Guards against overlapping background hub revalidations.
        const hubRevalidatingRef = React.useRef(false);
        // ESPN state
        const [espnLeagues, setEspnLeagues] = useState([]);
        const [espnConnecting, setEspnConnecting] = useState(false);
        // MFL state
        const [mflLeagues, setMflLeagues] = useState([]);
        const [mflConnecting, setMflConnecting] = useState(false);
        const [mflError, setMflError] = useState(null);
        const [mflFranchises, setMflFranchises] = useState(null);
        const [mflPendingResult, setMflPendingResult] = useState(null);
        const visibleEspnLeagues = PLATFORM_SANDBOX_ACCESS ? espnLeagues : [];
        const visibleMflLeagues = MFL_SANDBOX_ACCESS ? mflLeagues : [];
        const [espnError, setEspnError] = useState(null);
        // Sleeper username — read from localStorage (login.html stores 'username', inline connect stores 'sleeperUsername')
        const sleeperUsername = React.useMemo(() => {
            return window.OD?.getCurrentUsername?.() || null;
        }, []);

        // Display name state
        const [customDisplayName, setCustomDisplayName] = useState(() => {
            return localStorage.getItem('od_display_name') || '';
        });

        // Cloud sync — load from Supabase on mount
        useEffect(() => {
            if (window.OD?.loadDisplayName) {
                window.OD.loadDisplayName().then(name => {
                    if (name) { setCustomDisplayName(name); localStorage.setItem('od_display_name', name); }
                }).catch(err => window.wrLog('app.loadDisplayName', err));
            }
        }, []);
        const leagueMates = React.useMemo(() => {
            const seen = new Set();
            // seed with current user's id so we exclude ourselves
            if (sleeperUser?.user_id) seen.add(sleeperUser.user_id);
            const mates = [];
            sleeperLeagues.forEach(league => {
                (league.users || []).forEach(u => {
                    const uid = u.user_id;
                    if (uid && !seen.has(uid)) {
                        seen.add(uid);
                        mates.push(u);
                    }
                });
            });
            return mates.sort((a, b) => (a.display_name || a.username || '').localeCompare(b.display_name || b.username || ''));
        }, [sleeperLeagues, sleeperUser]);

        const AVAILABLE_YEARS = ['2023', '2024', '2025', '2026'];

        // ── Browser History Navigation ──
        function buildHash(leagueId, tab) {
            return '#league=' + leagueId + '&tab=' + (tab || 'dashboard');
        }
        function routeUrl(hash) {
            const query = new URLSearchParams(window.location.search || '');
            query.delete('league');
            query.delete('leagueId');
            query.delete('tab');
            const qs = query.toString();
            return window.location.pathname + (qs ? '?' + qs : '') + (hash || '');
        }
        function parseHash(hash) {
            const params = new URLSearchParams((hash || '').replace('#', ''));
            const query = new URLSearchParams(window.location.search || '');
            // Legacy 'brief' tab was folded into dashboard — redirect old bookmarks
            const rawTab = params.get('tab') || query.get('tab') || 'dashboard';
            const tab = rawTab === 'brief' ? 'dashboard' : rawTab;
            return {
                leagueId: params.get('league') || query.get('league') || query.get('leagueId'),
                tab,
            };
        }

        useEffect(() => {
            if (sleeperUsername) loadSleeperData();
        }, [selectedYear]);

        // Build the hub league object from a mapped MFL result. Shared by the
        // connect flow (finalizeMFLConnect) and the on-load rehydrator
        // (loadMflData) so both produce an identical shape.
        function buildMflLeagueObj(result, leagueId, franchiseId) {
            const lg = result.league || {};
            return {
                id: lg.league_id,
                league_id: lg.league_id,
                name: lg.name,
                season: lg.season,
                // Draft-driven status ('pre_draft'/'drafting'/'in_season') so the
                // rookie-waiver lock + live-draft tool engage; was dropped before.
                status: lg.status || 'in_season',
                total_rosters: lg.total_rosters,
                wins: 0, losses: 0, ties: 0,
                rosters: result.rosters,
                scoring_settings: lg.scoring_settings,
                roster_positions: lg.roster_positions,
                settings: lg.settings || {},
                users: result.leagueUsers,
                // Status-bearing drafts (collectFaDrafts + draft-room read these).
                drafts: result.drafts || [],
                // Multi-copy availability map (copies + per-pid roster counts).
                _availability: lg._availability || null,
                _source: 'mfl',
                _mfl: true,
                _mflLeagueId: leagueId,
                _mflFranchiseId: franchiseId || null,
                _mflDraftPlayerPool: lg._mflDraftPlayerPool || '',
                _mflDraftTimer: lg._mflDraftTimer || '',
                _mflDraftLimitHours: lg._mflDraftLimitHours || '',
                _mflDraftKind: lg._mflDraftKind || '',
                _mflLockout: lg._mflLockout || '',
            };
        }

        // ── MFL rehydration ──
        // Sleeper leagues reload from the username on every launch; MFL has no
        // such identity, so a connected league would vanish on refresh. We
        // persist the connection (id / year / team) and re-fetch it on mount so
        // a locked-in MFL league always reappears in the franchise picker.
        useEffect(() => {
            if (!MFL_SANDBOX_ACCESS) return;
            let alive = true;
            (async () => {
                // Resolve the connection: prefer local, else pull the cloud-synced
                // one so a fresh device rehydrates the MFL league + team without a
                // manual reconnect (mirrors how Sleeper rehydrates from the username).
                let leagueId = localStorage.getItem('mfl_league_id');
                if (!leagueId && window.OD?.loadMflConnection) {
                    try {
                        const conn = await window.OD.loadMflConnection();
                        if (conn?.leagueId) {
                            leagueId = String(conn.leagueId);
                            localStorage.setItem('mfl_league_id', leagueId);
                            if (conn.year) localStorage.setItem('mfl_year', String(conn.year));
                            if (conn.franchiseId) localStorage.setItem('mfl_franchise_id', String(conn.franchiseId));
                        }
                    } catch (e) { window.wrLog?.('app.loadMflConnection', e); }
                }
                if (!alive || !leagueId) return;
                // mfl-api.js ships in the shared bundle, but guard against the
                // connector not being ready yet on a cold start.
                for (let i = 0; i < 50 && !window.MFL; i++) {
                    await new Promise(r => setTimeout(r, 100));
                }
                if (!alive || !window.MFL) return;
                const year = localStorage.getItem('mfl_year') || '2026';
                const apiKey = sessionStorage.getItem('mfl_api_key') || null;
                let franchiseId = localStorage.getItem('mfl_franchise_id') || null;
                try {
                    const raw = await window.MFL.fetchLeague(leagueId, year, apiKey);
                    if (!alive || !raw?.leagueData?.league) return;
                    const franchisesRaw = raw.leagueData?.league?.franchises?.franchise || [];
                    const franchiseArr = Array.isArray(franchisesRaw) ? franchisesRaw : [franchisesRaw];
                    // Owner default: if bigloco hasn't picked a team yet, lock in the
                    // known franchise (OWNER_MFL_TEAM) by name and persist its id so
                    // it sticks across reloads / devices.
                    if (!franchiseId && (sleeperUsername || '').toLowerCase() === 'bigloco') {
                        const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const owned = franchiseArr.find(f => norm(f.name) === norm(OWNER_MFL_TEAM));
                        if (owned) { franchiseId = owned.id; localStorage.setItem('mfl_franchise_id', String(owned.id)); }
                    }
                    const mflPlayerArr = raw.playersData?.players?.player || [];
                    const allMflPlayers = Array.isArray(mflPlayerArr) ? mflPlayerArr : [mflPlayerArr];
                    const crosswalk = window.MFL.buildCrosswalk({}, allMflPlayers, year);
                    const result = window.MFL.mapToSleeperState(raw, leagueId, year, crosswalk);
                    if (!alive) return;
                    const league = buildMflLeagueObj(result, leagueId, franchiseId);
                    setMflLeagues(prev => {
                        const filtered = prev.filter(l => l._mflLeagueId !== league._mflLeagueId);
                        return [...filtered, league];
                    });
                    // Keep the cloud copy in sync — backfills a league first
                    // connected on this device so it follows the account elsewhere.
                    window.OD?.saveMflConnection?.({ leagueId, year, franchiseId });
                    // Still no team (non-owner, or name not matched)? Prime the
                    // franchise picker so it can be locked in one click from the MFL card.
                    if (!franchiseId) {
                        setMflFranchises(franchiseArr);
                        setMflPendingResult(result);
                    }
                } catch (e) {
                    window.wrLog?.('app.loadMflData', e);
                }
            })();
            return () => { alive = false; };
        }, []);

        async function loadSleeperData() {
            setLoading(true);
            setError(null);
            setSleeperLeagues([]);

            try {
                const user = await fetchSleeperUser(sleeperUsername);
                if (!user) {
                    setError("Couldn't find that Sleeper username — check spelling and try again");
                    setLoading(false);
                    return;
                }
                setSleeperUser(user);

                const leagues = (await fetchUserLeagues(user.user_id, selectedYear)) || [];
                if (!leagues.length) { setSleeperLeagues([]); setLoading(false); hubSyncedAtRef.current = Date.now(); return; }

                // Stream each league's full details into state as it resolves, preserving
                // the original order, instead of awaiting the slowest league via a single
                // Promise.all. The hub paints fast leagues immediately rather than blocking
                // on the slowest one. Each streamed entry is always complete (never a
                // partial skeleton), so opening a card is safe. `loading` stays true until
                // every league settles, which preserves the deep-link routing guards below.
                const byId = new Map();
                const orderedBuilt = () => leagues.map(lg => byId.get(lg.league_id)).filter(Boolean);

                await Promise.all(
                    leagues.map(async (league) => {
                        try {
                            const [rosters, users] = await Promise.all([
                                fetchLeagueRosters(league.league_id),
                                fetchLeagueUsers(league.league_id)
                            ]);

                            const myRoster = rosters.find(r => r.owner_id === user.user_id);

                            byId.set(league.league_id, {
                                id: league.league_id,
                                name: league.name,
                                wins: myRoster?.settings?.wins || 0,
                                losses: myRoster?.settings?.losses || 0,
                                ties: myRoster?.settings?.ties || 0,
                                season: selectedYear,
                                // 'pre_draft' | 'drafting' | 'in_season' | 'complete' — lets
                                // hub surfaces tell an upcoming draft from a finished one.
                                status: league.status || null,
                                scoring_settings: league.scoring_settings || {},
                                roster_positions: league.roster_positions || [],
                                settings: league.settings || {},
                                rosters,
                                users
                            });
                        } catch (e) {
                            console.error(`Failed to load league ${league.name}:`, e);
                        } finally {
                            // Re-render with everything loaded so far, in original order.
                            setSleeperLeagues(orderedBuilt());
                        }
                    })
                );

                hubSyncedAtRef.current = Date.now();
                setLoading(false);
            } catch (err) {
                console.error('Failed to load Sleeper data:', err);
                setError('Failed to load Sleeper data. Please refresh.');
                setLoading(false);
            }
        }

        // Background hub revalidation — non-destructive loadSleeperData variant.
        // The return-to-hub freshness check must never yank a working franchise
        // picker: no loading/error toggles, no upfront sleeperLeagues clear.
        // Fresh data replaces state only on success; any failure (user lookup,
        // league list, per-league detail) silently keeps what's already on
        // screen and console.warns. Initial + year-change loads keep using
        // loadSleeperData's destructive reset.
        async function revalidateSleeperData() {
            if (hubRevalidatingRef.current) return;
            hubRevalidatingRef.current = true;
            try {
                const user = await fetchSleeperUser(sleeperUsername);
                if (!user) { console.warn('Hub revalidation: Sleeper user lookup failed — keeping cached leagues'); return; }
                setSleeperUser(user);
                const leagues = (await fetchUserLeagues(user.user_id, selectedYear)) || [];
                if (!leagues.length) { console.warn('Hub revalidation: no leagues returned — keeping cached leagues'); return; }
                const byId = new Map();
                await Promise.all(
                    leagues.map(async (league) => {
                        try {
                            const [rosters, users] = await Promise.all([
                                fetchLeagueRosters(league.league_id),
                                fetchLeagueUsers(league.league_id)
                            ]);
                            const myRoster = rosters.find(r => r.owner_id === user.user_id);
                            byId.set(league.league_id, {
                                id: league.league_id,
                                name: league.name,
                                wins: myRoster?.settings?.wins || 0,
                                losses: myRoster?.settings?.losses || 0,
                                ties: myRoster?.settings?.ties || 0,
                                season: selectedYear,
                                scoring_settings: league.scoring_settings || {},
                                roster_positions: league.roster_positions || [],
                                settings: league.settings || {},
                                rosters,
                                users
                            });
                        } catch (e) {
                            console.warn(`Hub revalidation: failed to refresh league ${league.name} — keeping cached copy:`, e);
                        }
                    })
                );
                // Single swap at the end: fresh entries where the refetch worked,
                // the existing card where it didn't — a league never disappears
                // because one background request hiccupped.
                setSleeperLeagues(prev => leagues
                    .map(lg => byId.get(lg.league_id) || (prev || []).find(p => String(p.id) === String(lg.league_id)))
                    .filter(Boolean));
                hubSyncedAtRef.current = Date.now();
            } catch (err) {
                console.warn('Hub revalidation failed — keeping cached league data:', err);
            } finally {
                hubRevalidatingRef.current = false;
            }
        }

        // Hub freshness (audit:refresh-stale step 10): league cards load once per
        // year selection and then sit stale for the whole session. When the user
        // closes a league and lands back on the hub with data older than 5 min,
        // re-pull records/rosters in the background (revalidateSleeperData) — the
        // existing cards stay up while fresh data swaps in on success.
        useEffect(() => {
            if (selectedLeague || proMode) return;   // only when the hub itself is showing
            if (!sleeperUsername || loading) return;
            if (!hubSyncedAtRef.current) return;     // first load is owned by the [selectedYear] effect
            if (Date.now() - hubSyncedAtRef.current < 5 * 60 * 1000) return;
            revalidateSleeperData();
        }, [selectedLeague, proMode]);

        // Hook must be above the early return to maintain consistent hook order
        const [reconLeagueId, setReconLeagueId] = useState(null);

        // popstate listener for back/forward navigation — MUST be before early return
        React.useEffect(() => {
            function onPopState(e) {
                isNavigatingRef.current = true;
                const state = e.state;
                const hashRoute = parseHash(window.location.hash);
                const nextState = state || (hashRoute.leagueId ? { view: 'league', leagueId: hashRoute.leagueId, tab: hashRoute.tab } : null);
                if (nextState && nextState.view === 'league' && nextState.leagueId) {
                    const allLeagues = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
                    const league = allLeagues.find(l => String(l.id) === String(nextState.leagueId));
                    if (league) {
                        setActiveLeagueId(league.id);
                        setSelectedLeague(league);
                        // Legacy 'brief' tab folded into dashboard
                        const restoredTab = nextState.tab === 'brief' ? 'dashboard' : (nextState.tab || 'dashboard');
                        setActiveTab(restoredTab);
                    }
                } else {
                    setSelectedLeague(null);
                    setActiveTab('dashboard');
                }
                setTimeout(() => { isNavigatingRef.current = false; }, 0);
            }
            window.addEventListener('popstate', onPopState);
            if (!history.state) {
                const route = parseHash(window.location.hash);
                const state = route.leagueId
                    ? { view: 'league', leagueId: route.leagueId, tab: route.tab }
                    : { view: 'hub' };
                history.replaceState(state, '', routeUrl(window.location.hash));
            }
            return () => window.removeEventListener('popstate', onPopState);
        }, [sleeperLeagues, espnLeagues, mflLeagues]);

        React.useEffect(() => {
            if (initialRouteAppliedRef.current) return;
            const route = parseHash(window.location.hash);
            if (!route.leagueId) {
                if (!loading) initialRouteAppliedRef.current = true;
                return;
            }
            const allLeagues = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
            if (!allLeagues.length) return;
            const league = allLeagues.find(l => String(l.id) === String(route.leagueId));
            if (!league) {
                if (!loading) initialRouteAppliedRef.current = true;
                return;
            }
            initialRouteAppliedRef.current = true;
            isNavigatingRef.current = true;
            setActiveLeagueId(league.id);
            setSelectedLeague(league);
            setActiveTab(route.tab || 'dashboard');
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_ID, league.id);
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_NAME, league.name);
            history.replaceState(
                { view: 'league', leagueId: league.id, tab: route.tab || 'dashboard' },
                '',
                routeUrl(buildHash(league.id, route.tab || 'dashboard'))
            );
            setTimeout(() => { isNavigatingRef.current = false; }, 0);
        }, [loading, sleeperLeagues, espnLeagues, mflLeagues]);

        // Show Empire Dashboard (Pro mode)
        // global-view.js is a deferred module group (see js/module-loader.js); load it
        // when Pro mode activates and re-render once EmpireDashboard exists.
        // eslint-disable-next-line no-undef
        const _EmpireDash = typeof EmpireDashboard === 'function' ? EmpireDashboard : null;
        const [empireModuleState, setEmpireModuleState] = useState(_EmpireDash ? 'ready' : 'idle');
        useEffect(() => {
            if (!proMode || _EmpireDash || !window.wrLoadModuleGroup) return;
            let alive = true;
            setEmpireModuleState('loading');
            window.wrLoadModuleGroup('empire')
                .then(() => { if (alive) setEmpireModuleState('ready'); })
                .catch(() => { if (alive) setEmpireModuleState('error'); });
            return () => { alive = false; };
        }, [proMode, _EmpireDash]);
        const [empirePlayersLoaded, setEmpirePlayersLoaded] = useState(false);
        const [empirePlayers, setEmpirePlayers] = useState({});
        // Bumped after background roster assessment so the Rolodex re-renders.
        const [, setEmpireAssessReady] = useState(0);

        // Load player database + DHQ engine when Pro mode activates
        useEffect(() => {
            if (!proMode || empirePlayersLoaded) return;
            (async () => {
                try {
                    // The deferred empire group owns buildEmpireDna & co. — make sure it
                    // has executed before the assessment loop below reaches for it.
                    if (window.wrLoadModuleGroup) { try { await window.wrLoadModuleGroup('empire'); } catch (e) {} }
                    // Load 10k player database (league-independent, cached 1hr)
                    const players = await window.App.fetchAllPlayers();
                    setEmpirePlayers(players || {});
                    // Ensure window.S exists for assessment functions
                    if (!window.S) window.S = {};
                    window.S.players = players;
                    // Populate rosters from all leagues into window.S for assessments
                    const allRosters = [];
                    const allUsers = [];
                    const allLeaguesList = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
                    allLeaguesList.forEach(l => {
                        (l.rosters || []).forEach(r => { if (!allRosters.find(x => x.roster_id === r.roster_id)) allRosters.push(r); });
                        (l.users || []).forEach(u => { if (!allUsers.find(x => x.user_id === u.user_id)) allUsers.push(u); });
                    });
                    window.S.rosters = allRosters;
                    window.S.leagueUsers = allUsers;
                    window.S.myUserId = sleeperUser?.user_id;
                    window.S.user = sleeperUser;
                    // Fetch traded picks for all leagues in parallel
                    const allTradedPicks = [];
                    await Promise.allSettled(allLeaguesList.map(async l => {
                        const lid = l.id || l.league_id;
                        if (!lid) return;
                        try {
                            const tp = await fetch('https://api.sleeper.app/v1/league/' + lid + '/traded_picks').then(r => r.ok ? r.json() : []);
                            const norm = window.App?.normalizeTradedPicks;
                            l.tradedPicks = (norm ? norm(l.rosters || [], tp || []) : (tp || []))
                                .map(p => ({ ...p, league_id: String(lid) }));
                            allTradedPicks.push(...l.tradedPicks);
                        } catch {}
                    }));
                    window.S.tradedPicks = allTradedPicks;
                    // Empire mode opens no single league, so S.currentLeagueId is unset and
                    // loadLeagueIntel() bails — DHQ player scores never populate, leaving Empire
                    // Value 0 and every asset unvalued. Point LeagueIntel at a representative league
                    // (mirrors the canonical league-open S setup in league-detail.js) so the Empire
                    // gets DHQ-scale values — the documented one-league proxy (see H5 note, global-view.js).
                    if (!window.S.currentLeagueId) {
                        const rep = allLeaguesList.find(l => (l.rosters || []).length && (l.id || l.league_id)) || allLeaguesList[0];
                        if (rep) {
                            const repId = rep.id || rep.league_id;
                            window.S.leagues = [{ league_id: repId, name: rep.name, scoring_settings: rep.scoring_settings, roster_positions: rep.roster_positions, settings: rep.settings }];
                            window.S.currentLeagueId = repId;
                            window.S.season = window.S.season || rep.season || String(new Date().getFullYear());
                            // loadLeagueIntel reads S.rosters for the rep league's team count / starter pool.
                            // The cross-league merged array (set above) is deduped by roster_id and would
                            // give a wrong totalTeams, so point it at the rep league's own rosters.
                            if (rep.rosters && rep.rosters.length) window.S.rosters = rep.rosters;
                        }
                    }
                    // Unblock the dashboard immediately; load DHQ scores in the background and
                    // re-render the Empire once they land (don't block the UI on the ~15s first load).
                    setEmpirePlayersLoaded(true);
                    if (typeof window.App?.loadLeagueIntel === 'function' && !window.App.LI_LOADED) {
                        if (window.DhqEvents?.once) window.DhqEvents.once('li:loaded', () => setEmpireAssessReady(Date.now()));
                        window.App.loadLeagueIntel().catch(() => {});
                    }
                    // Then assess every roster in the background, yielding between
                    // leagues so a heavy or oddly-shaped league can't freeze the load.
                    if (typeof window.App?.assessAllTeams === 'function') {
                        (async () => {
                            // Empire mode never populated S.playerStats, so assessments ran with no
                            // production data → degraded health/tier. Fetch current-season stats once
                            // (league-independent season totals) and feed them to every assessment.
                            if ((!window.S.playerStats || !Object.keys(window.S.playerStats).length) && typeof window.fetchSeasonStats === 'function') {
                                const season = parseInt(window.S.season || new Date().getFullYear(), 10);
                                let st = (await window.fetchSeasonStats(String(season)).catch(() => ({}))) || {};
                                // Offseason: the current season has no games yet — fall back to the last
                                // completed season so dynasty health/tier reflect real production.
                                if (!Object.keys(st).length) st = (await window.fetchSeasonStats(String(season - 1)).catch(() => ({}))) || {};
                                window.S.playerStats = st;
                            }
                            const stats = window.S.playerStats || {};
                            for (const l of allLeaguesList) {
                                await new Promise(r => setTimeout(r, 0));
                                const lid = l.id || l.league_id;
                                try {
                                    l.empireAssessments = window.App.assessAllTeams(l.rosters || [], players, stats, l, l.users || [], l.tradedPicks || []);
                                } catch (e) { l.empireAssessments = []; }
                                // Real Owner DNA for the moat: curated reads (od_owner_dna) take
                                // precedence; transaction-behavioral inference fills the gaps.
                                try {
                                    const saved = (window.OD?.loadDNA ? await window.OD.loadDNA(lid).catch(() => ({})) : {}) || {};
                                    const txns = (window.WrTxns?.fetchLeagueTxns ? await window.WrTxns.fetchLeagueTxns(lid).catch(() => []) : []) || [];
                                    l.empireDna = window.App.buildEmpireDna ? window.App.buildEmpireDna(saved, txns, l.rosters || [], sleeperUser?.user_id) : saved;
                                } catch (e) { l.empireDna = l.empireDna || {}; }
                            }
                            setEmpireAssessReady(Date.now());
                        })();
                    }
                } catch (e) { console.warn('[Empire] Data load error:', e); setEmpirePlayersLoaded(true); }
            })();
        }, [proMode, empirePlayersLoaded]);

        // Defense-in-depth: Empire is sandbox-only — even if stale history state or
        // a stray caller flips proMode on in production, never mount the surface.
        // (Render-phase reset is safe here: all hooks above have already run, and
        // the condition is false on the immediate re-render.)
        if (proMode && !EMPIRE_ENABLED) {
            setProMode(false);
            return null;
        }

        if (proMode && !selectedLeague && !_EmpireDash) {
            // Empire module still injecting (or failed) — hold the surface instead of
            // flashing the hub. Escape hatch mirrors the Empire onBack handler.
            return (
                <div style={{ padding: '96px 24px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' }}>
                    {empireModuleState === 'error' ? 'Empire Dashboard failed to load.' : 'Loading Empire Dashboard…'}
                    <div>
                        <button
                            onClick={() => {
                                if (empireModuleState === 'error') { window.location.reload(); return; }
                                setProMode(false);
                                if (!isNavigatingRef.current) {
                                    history.pushState({ view: 'hub' }, '', routeUrl(''));
                                }
                            }}
                            style={{ marginTop: '16px', padding: '8px 16px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                        >{empireModuleState === 'error' ? 'Reload' : 'Back to Hub'}</button>
                    </div>
                </div>
            );
        }
        if (proMode && !selectedLeague && _EmpireDash) {
            return (
                <ErrorBoundary>
                    <_EmpireDash
                        allLeagues={[...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues]}
                        playersData={empirePlayers}
                        sleeperUserId={sleeperUser?.user_id}
                        onEnterLeague={(league) => {
                            handleSelectLeague(league);
                        }}
                        onBack={() => {
                            setProMode(false);
                            if (!isNavigatingRef.current) {
                                history.pushState({ view: 'hub' }, '', routeUrl(''));
                            }
                        }}
                    />
                </ErrorBoundary>
            );
        }

        // Show league detail if selected
        const LeagueDetail = window.LeagueDetail;
        if (selectedLeague) {
            return <>
                <ErrorBoundary>
                    <LeagueDetail
                        league={selectedLeague}
                        onBack={() => {
                            setSelectedLeague(null);
                            setActiveTab('dashboard');
                            // Return to Empire Dashboard if Pro mode was active, otherwise hub
                            if (!isNavigatingRef.current) {
                                history.pushState({ view: proMode ? 'pro' : 'hub' }, '', routeUrl(''));
                            }
                        }}
                        activeTab={activeTab}
                        onTabChange={handleTabChange}
                        sleeperUserId={sleeperUser?.user_id}
                        settingsProps={{
                            initDisplayName: customDisplayName,
                            onDisplayNameSave: (name) => {
                                setCustomDisplayName(name);
                                window.OD.saveDisplayName(name);
                            },
                            leagueMates,
                        }}
                        onOpenSettings={() => setShowSettings(true)}
                    />
                </ErrorBoundary>
                {showSettings && (
                    <SettingsModal
                        onClose={() => setShowSettings(false)}
                        initDisplayName={customDisplayName}
                        onDisplayNameSave={(name) => {
                            setCustomDisplayName(name);
                            window.OD.saveDisplayName(name);
                        }}
                        leagueMates={leagueMates}
                    />
                )}
            </>;
        }

        // ── Shared helpers ──
        const lastLeagueId = AppStorage.get(APP_WR_KEYS.LAST_LEAGUE_ID);
        const lastLeagueName = AppStorage.get(APP_WR_KEYS.LAST_LEAGUE_NAME);
        const displayName = sleeperUser
            ? (customDisplayName || sleeperUser.display_name || sleeperUser.username || sleeperUsername).toUpperCase()
            : (customDisplayName || 'COMMANDER').toUpperCase();

        const RECONAI_BASE = 'https://skjjcruz.github.io/ReconAI-sandbox-dev/';
        function reconUrl(leagueId) {
            return leagueId ? RECONAI_BASE + '?league=' + leagueId : RECONAI_BASE;
        }

        function leagueHealth(league) {
            const gp = league.wins + league.losses + (league.ties || 0);
            const wp = gp > 0 ? Math.round((league.wins / gp) * 100) : null;
            const myRoster = league.rosters?.find(r => r.owner_id === sleeperUser?.user_id);
            const rosterSlots = league.roster_positions?.filter(p => p !== 'BN' && p !== 'IR' && p !== 'TAXI').length || 0;
            const filled = myRoster?.starters?.filter(s => s && s !== '0').length || 0;
            const fillPct = rosterSlots > 0 ? Math.round((filled / rosterSlots) * 100) : null;
            return { gp, wp, fillPct, teamCount: league.rosters?.length || 0 };
        }

        // ── Franchise-picker helpers ──
        function initialsFor(name) {
            // ASCII-only so emoji / astral scripts (cuneiform, etc.) don't break the crest.
            const ascii = String(name || '').replace(/[^A-Za-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
            if (!ascii) return '★';
            const w = ascii.split(' ');
            return (((w[0] && w[0][0]) || '') + ((w[1] && w[1][0]) || '')).toUpperCase();
        }
        function leagueTeamName(league) {
            try {
                const me = league.rosters?.find(r => r.owner_id === sleeperUser?.user_id);
                if (me) {
                    const u = league.users?.find(x => x.user_id === me.owner_id);
                    if (u?.metadata?.team_name) return u.metadata.team_name;
                    if (u?.display_name) return u.display_name;
                }
            } catch (e) {}
            return league.teamName || league.name || '';
        }
        function leagueFormat(league) {
            const bits = [];
            try {
                const rp = (league.roster_positions || []).map(s => String(s).toUpperCase());
                bits.push(rp.some(s => ['SUPER_FLEX', 'QB_FLEX', 'OP'].includes(s)) ? 'Superflex' : '1QB');
                const rec = Number(league.scoring_settings?.rec ?? 0);
                bits.push(rec >= 1 ? 'PPR' : rec >= 0.5 ? 'Half-PPR' : 'Standard');
                if (Number(league.scoring_settings?.bonus_rec_te ?? 0) > 0) bits.push('TE-Prem');
                const teams = league.rosters?.length || league.settings?.num_teams || league.total_rosters || 0;
                if (teams) bits.push(teams + '-team');
                const type = Number(league.settings?.type ?? -1);
                bits.push(type === 0 ? 'Redraft' : type === 1 ? 'Keeper' : 'Dynasty');
            } catch (e) {}
            return bits.join(' · ');
        }

        // Pro tier icon (SVG shield with star)
        function ProTierIcon({ size }) {
            const s = size || 24;
            return React.createElement('svg', { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
                React.createElement('path', { d: 'M12 2L3 7v6c0 5.25 3.83 10.18 9 11.38C17.17 23.18 21 18.25 21 13V7L12 2z', fill: 'url(#proGrad)', stroke: 'var(--k-d4af37, #d4af37)', strokeWidth: '1' }),
                React.createElement('path', { d: 'M12 7l1.545 3.13 3.455.503-2.5 2.437.59 3.43L12 14.885 8.91 16.5l.59-3.43-2.5-2.437 3.455-.503L12 7z', fill: 'var(--k-0a0a0a, #0a0a0a)', stroke: 'var(--k-b8941e, #b8941e)', strokeWidth: '0.5' }),
                React.createElement('defs', null,
                    React.createElement('linearGradient', { id: 'proGrad', x1: '3', y1: '2', x2: '21', y2: '24' },
                        React.createElement('stop', { offset: '0%', stopColor: 'var(--k-d4af37, #d4af37)' }),
                        React.createElement('stop', { offset: '100%', stopColor: 'var(--k-8b6914, #8b6914)' })
                    )
                )
            );
        }
        window.ProTierIcon = ProTierIcon;

        function LeagueSelector({ onSelect, accent }) {
            const accentColor = 'var(--gold)';
            const accentBg = 'var(--acc-fill2, rgba(212,175,55,0.08))';
            const accentBorder = 'var(--acc-line2, rgba(212,175,55,0.3))';
            if (!sleeperUsername) return null;
            // Only show the full-screen loader before the FIRST league streams in; once
            // cards start arriving we render them live and show a "loading more" hint.
            if (loading && sleeperLeagues.length === 0) return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' }}>Loading leagues...</div>;
            if (error && sleeperLeagues.length === 0) return <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--k-e74c3c, #e74c3c)', fontSize: 'var(--text-body, 1rem)' }}>{error}</div>;
            if (!loading && sleeperLeagues.length === 0) return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' }}>No leagues found for {selectedYear}</div>;

            return (
                <div className="hub-league-selector">
                    <label>Select League</label>

                    <div className="hub-league-list">
                        {sleeperLeagues.map(l => {
                            const h = leagueHealth(l);
                            const recordCol = h.wp === null ? 'var(--silver)' : h.wp >= 60 ? 'var(--win-green)' : h.wp < 40 ? 'var(--loss-red)' : 'var(--silver)';
                            const fillCol = h.fillPct === null ? 'var(--silver)' : h.fillPct >= 90 ? 'var(--win-green)' : h.fillPct >= 70 ? 'var(--silver)' : 'var(--loss-red)';
                            return (
                                <div key={l.id} className="hub-league-item" onClick={() => onSelect(l)}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.background = accentBg; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = accentBorder; e.currentTarget.style.background = 'var(--ov-1, rgba(255,255,255,0.02))'; }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '3px', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>
                                            <span>{h.teamCount}T</span>
                                            <span style={{ color: recordCol, fontWeight: 700 }}>{l.wins}-{l.losses}{l.ties > 0 ? '-'+l.ties : ''}</span>
                                            {h.fillPct !== null && <span style={{ color: fillCol }}>{h.fillPct}% filled</span>}
                                        </div>
                                    </div>
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={accentColor} strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}><polyline points="9 18 15 12 9 6"/></svg>
                                </div>
                            );
                        })}
                        {loading && <div style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', opacity: 0.6 }}>Loading more leagues…</div>}
                    </div>
                </div>
            );
        }

        // Unified franchise picker — the default landing for a connected (signed-up) user.
        // Empire Command hero on top (launch for paid / upgrade for free), then a tile per
        // franchise showing team name · league name · league settings, then "Add a league".
        function FranchisePicker({ leagues, onSelect }) {
            // The server tier resolves asynchronously AFTER first render; without
            // this re-render a Pro subscriber keeps the pre-resolution 'free'
            // snapshot (Scout banner, locked tiles) until a full reload.
            const [, setTierEpoch] = React.useState(0);
            React.useEffect(() => {
                const bump = () => setTierEpoch(n => n + 1);
                if (window.App && window.App._userTierResolved) bump(); // resolved before mount
                window.addEventListener('dhq:tier-resolved', bump);
                return () => window.removeEventListener('dhq:tier-resolved', bump);
            }, []);
            // Re-read tier once the async server profile resolves (the picker
            // mounts a beat before it lands) so the Empire hero reflects the
            // real tier. No Scout-only league gating remains here.
            const tier = typeof getUserTier === 'function' ? getUserTier() : 'free';
            const isPaid = EMPIRE_FREE_PRELIVE || tier === 'pro' || tier === 'warroom' || tier === 'war_room' || tier === 'commissioner';
            return (
                <div className="hub-franchise-picker" style={{ padding: '4px 12px 14px' }}>
                    {EMPIRE_ENABLED && (isPaid ? (
                        <div className="empire-hero" onClick={() => setProMode(true)}
                            style={{ cursor: 'pointer', marginBottom: '14px', borderRadius: '14px', padding: '16px', background: 'linear-gradient(135deg, rgba(212,175,55,0.16), rgba(212,175,55,0.04))', border: '1px solid var(--gold)', display: 'flex', alignItems: 'center', gap: '14px', boxShadow: '0 0 0 1px var(--acc-line1, rgba(212,175,55,0.12)), 0 0 22px rgba(212,175,55,0.10)', transition: 'all .16s' }}
                            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 0 1px var(--gold), 0 0 28px rgba(212,175,55,0.22)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 0 0 1px rgba(212,175,55,0.12), 0 0 22px rgba(212,175,55,0.10)'; e.currentTarget.style.transform = 'none'; }}>
                            <div style={{ width: '44px', height: '44px', flexShrink: 0 }}><ProTierIcon size={44} /></div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                                    <span style={{ fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: '1.15rem', letterSpacing: '.08em', color: 'var(--gold)' }}>EMPIRE COMMAND</span>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '.06em', color: 'var(--black)', background: 'var(--gold)', borderRadius: '5px', padding: '1px 6px' }}>PRO</span>
                                </div>
                                <div style={{ fontSize: 'var(--text-label, 0.8rem)', color: 'var(--silver)', marginTop: '4px' }}>All {leagues.length} league{leagues.length !== 1 ? 's' : ''} in one terminal · cross-league trade intelligence</div>
                            </div>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--gold)" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.7 }}><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                    ) : (
                        <div className="empire-hero locked" onClick={() => { if (typeof window.showProLaunchPage === 'function') window.showProLaunchPage(); else window.location.href = 'landing.html'; }}
                            style={{ cursor: 'pointer', marginBottom: '14px', borderRadius: '14px', padding: '16px', background: 'linear-gradient(135deg, rgba(212,175,55,0.07), rgba(212,175,55,0.02))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', display: 'flex', alignItems: 'center', gap: '14px', transition: 'all .16s' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--acc-line2, rgba(212,175,55,0.3))'; }}>
                            <div style={{ width: '44px', height: '44px', flexShrink: 0, borderRadius: '50%', border: '1.5px solid var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--gold)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                                    <span style={{ fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: '1.15rem', letterSpacing: '.08em', color: 'var(--gold)' }}>EMPIRE COMMAND</span>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '.06em', color: 'var(--gold)', border: '1px solid var(--gold)', borderRadius: '5px', padding: '1px 6px' }}>PRO</span>
                                </div>
                                <div style={{ fontSize: 'var(--text-label, 0.8rem)', color: 'var(--silver)', marginTop: '4px' }}>Command every league from one terminal — see cross-league trades you can't spot inside a single league.</div>
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 700, color: 'var(--gold)', whiteSpace: 'nowrap', flexShrink: 0 }}>Unlock ›</span>
                        </div>
                    ))}

                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label, 0.75rem)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--silver)', opacity: 0.7, margin: '2px 0 10px' }}>{EMPIRE_ENABLED && isPaid ? 'Or enter a single league' : 'Select franchise'}</div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                        {leagues.map(l => {
                            const h = leagueHealth(l);
                            const team = leagueTeamName(l);
                            const showTeam = team && team !== l.name;
                            const title = showTeam ? team : l.name;
                            const sub = showTeam ? l.name : null;
                            const isLast = String(l.id) === String(lastLeagueId);
                            // Scout (free) can enter ANY of their leagues — no
                            // per-league limit (owner ruling 2026-07-13). Pro is
                            // feature-gated, not league-gated. No tiles lock.
                            const recordCol = h.wp === null ? 'var(--silver)' : h.wp >= 60 ? 'var(--win-green)' : h.wp < 40 ? 'var(--loss-red)' : 'var(--silver)';
                            return (
                                <div key={l.id} onClick={() => onSelect(l)}
                                    style={{ position: 'relative', cursor: 'pointer', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + (isLast ? 'var(--gold)' : 'var(--acc-line1, rgba(212,175,55,0.18))'), borderRadius: '12px', padding: '14px', transition: 'all .14s' }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = isLast ? 'var(--gold)' : 'var(--acc-line1, rgba(212,175,55,0.18))'; e.currentTarget.style.transform = 'none'; }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                                        <div style={{ width: '40px', height: '40px', flexShrink: 0, borderRadius: '50%', border: '1.5px solid var(--gold)', background: 'var(--black)', color: 'var(--gold)', fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initialsFor(title)}</div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                                                <span style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                                                {isLast && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 600, color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '4px', padding: '0 4px', flexShrink: 0 }}>LAST</span>}
                                            </div>
                                            {sub && <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
                                        </div>
                                    </div>
                                    <div style={{ marginTop: '11px', paddingTop: '10px', borderTop: '1px solid var(--acc-line1, rgba(212,175,55,0.12))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{leagueFormat(l)}</span>
                                        {h.wp !== null && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', fontWeight: 700, color: recordCol, flexShrink: 0 }}>{l.wins}-{l.losses}{l.ties > 0 ? '-' + l.ties : ''}</span>}
                                    </div>
                                </div>
                            );
                        })}
                        <div onClick={() => setShowConnect(true)}
                            style={{ cursor: 'pointer', border: '1px dashed var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '12px', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', color: 'var(--silver)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label, 0.8rem)', minHeight: '92px', transition: 'all .14s' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.color = 'var(--gold)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--acc-line2, rgba(212,175,55,0.3))'; e.currentTarget.style.color = 'var(--silver)'; }}>
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Add a league
                        </div>
                    </div>
                    {loading && <div style={{ padding: '10px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', opacity: 0.6 }}>Loading more leagues…</div>}
                </div>
            );
        }

        // Unified franchise picker — the default landing for a connected (signed-up) user.
        // Empire Command hero on top (launch for paid / upgrade for free), then a tile per
        // franchise showing team name · league name · league settings, then "Add a league".

        // Scout (free) can enter ALL of their leagues — no per-league limit
        // (owner ruling 2026-07-13). Dynasty HQ is feature-gated, not
        // league-gated: Pro unlocks the smart tools inside every league, but
        // free users are never blocked from opening a league. (The old
        // one-free-league claim/lock machinery was removed here.)
        function handleSelectLeague(league) {
            setActiveLeagueId(league.id);
            setSelectedLeague(league);
            setActiveTab('dashboard');
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_ID, league.id);
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_NAME, league.name);
            if (!isNavigatingRef.current) {
                history.pushState({ view: 'league', leagueId: league.id, tab: 'dashboard' }, '', routeUrl(buildHash(league.id, 'dashboard')));
            }
        }

        function handleTabChange(tab) {
            setActiveTab(tab);
            if (!isNavigatingRef.current && selectedLeague) {
                history.pushState({ view: 'league', leagueId: selectedLeague.id, tab }, '', routeUrl(buildHash(selectedLeague.id, tab)));
            }
        }

        async function handleESPNConnect(leagueId, espnS2, swid) {
            if (!platformAccessAllowed('espn')) { setEspnError(platformBetaMessage('espn')); return; }
            if (!leagueId) { setEspnError('Enter your ESPN league ID'); return; }
            const numericId = leagueId.replace(/\D/g, '');
            if (!numericId) { setEspnError('League ID must be a number from your ESPN URL'); return; }
            if (!window.ESPN) { setEspnError('ESPN connector not loaded — refresh and try again'); return; }
            setEspnConnecting(true);
            setEspnError(null);
            try {
                const year = parseInt(selectedYear);
                // Persist credentials for Scout deep-link
                if (espnS2) { sessionStorage.setItem('espn_s2', espnS2); localStorage.removeItem('espn_s2'); }
                if (swid)   { sessionStorage.setItem('espn_swid', swid); localStorage.removeItem('espn_swid'); }
                const result = await window.ESPN.connectLeague(numericId, year, espnS2 || null, swid || null);
                const league = {
                    id:              result.league.league_id,
                    name:            result.league.name,
                    season:          String(year),
                    wins:            0, losses: 0, ties: 0,
                    rosters:         result.rosters,
                    scoring_settings: result.league.scoring_settings,
                    roster_positions: result.league.roster_positions,
                    settings:         result.league.settings || {},
                    _espn:            true,
                    _espnLeagueId:    numericId,
                };
                setEspnLeagues(prev => {
                    const filtered = prev.filter(l => l._espnLeagueId !== numericId);
                    return [...filtered, league];
                });
            } catch (e) {
                setEspnError(e.message || 'ESPN connection failed');
            } finally {
                setEspnConnecting(false);
            }
        }

        async function handleMFLConnect(leagueId, year, apiKey) {
            if (!platformAccessAllowed('mfl')) { setMflError(platformBetaMessage('mfl')); return; }
            if (!leagueId) { setMflError('Enter your MFL League ID'); return; }
            if (!window.MFL) { setMflError('MFL connector not loaded — refresh and try again'); return; }
            setMflConnecting(true);
            setMflError(null);
            try {
                const raw = await window.MFL.fetchLeague(leagueId, year, apiKey || null);
                if (!raw?.leagueData?.league) throw new Error('Invalid MFL league data. Check your League ID and year.');
                // Build crosswalk (empty Sleeper players — rebuilds when full DB loads)
                const mflPlayerArr = raw.playersData?.players?.player || [];
                const allMflPlayers = Array.isArray(mflPlayerArr) ? mflPlayerArr : [mflPlayerArr];
                const crosswalk = window.MFL.buildCrosswalk({}, allMflPlayers, year);
                const result = window.MFL.mapToSleeperState(raw, leagueId, year, crosswalk);
                // Extract franchise list for picker
                const franchises = raw.leagueData?.league?.franchises?.franchise || [];
                const franchiseArr = Array.isArray(franchises) ? franchises : [franchises];
                // Store credentials
                localStorage.setItem('mfl_league_id', leagueId);
                localStorage.setItem('mfl_year', String(year));
                if (apiKey) { sessionStorage.setItem('mfl_api_key', apiKey); localStorage.removeItem('mfl_api_key'); }
                setMflPendingResult(result);
                setMflFranchises(franchiseArr);
            } catch (e) {
                setMflError(e.message || 'MFL connection failed');
            } finally {
                setMflConnecting(false);
            }
        }

        function finalizeMFLConnect(franchiseId) {
            if (!platformAccessAllowed('mfl')) return;
            const result = mflPendingResult;
            if (!result) return;
            const leagueId = localStorage.getItem('mfl_league_id');
            // Lock in the team pick so it rehydrates on every future launch
            // (league id + year are already persisted in handleMFLConnect).
            if (franchiseId) localStorage.setItem('mfl_franchise_id', String(franchiseId));
            else localStorage.removeItem('mfl_franchise_id');
            // Sync the connection to the account so it follows the user across devices.
            window.OD?.saveMflConnection?.({ leagueId, year: localStorage.getItem('mfl_year') || '2026', franchiseId: franchiseId || null });
            const league = buildMflLeagueObj(result, leagueId, franchiseId);
            setMflLeagues(prev => {
                const filtered = prev.filter(l => l._mflLeagueId !== league._mflLeagueId);
                return [...filtered, league];
            });
            setMflFranchises(null);
            setMflPendingResult(null);
            handleSelectLeague(league);
        }

        // Search connected leagues across active production platforms.
        const allLeagues = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
        const hasLeagues = allLeagues.length > 0;
        const resumeLeague = allLeagues.find(l => l.id === lastLeagueId);
        const distPrefix = (window.location.pathname || '').includes('/dist-preview/') ? '../' : '';
        const iconSrc = distPrefix + 'icon-192.png';
        // `loading` starts true and only resolves via loadSleeperData, which never
        // runs without a username — so treat the hub as syncing only when a Sleeper
        // fetch is actually in flight (a signed-out user goes straight to connect).
        const hubSyncing = loading && !!sleeperUsername;
        const hubCtrlStyle = { fontFamily: 'var(--font-mono)', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '.12em', color: 'var(--silver)', background: 'transparent', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '4px', padding: '7px 11px', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', lineHeight: 1 };

        return (
            <div className="app-container">
                {/* ── PHONE TIER (≤767), hub view only — iPhone plan Phase 2 item 14.
                    (1) .header: the index.html mobile-hub rule (.header{padding:0.6rem 1rem})
                    overrides the base rule's safe-area padding at exactly the tier that
                    needs it (installed-PWA draws under the notch, black-translucent) —
                    restore it here; equal specificity, later in the document, so it wins.
                    (2) Connect grid: the inline repeat(2) template makes two ~165px
                    platform cards at 375 — stack to one column.
                    (3) Touch bumps are hit-area only (CTAs, MFL franchise/cancel rows);
                    ≥768 is untouched. --sa* vars resolve to 0 off-notch. */}
                <style>{`
                    @media (max-width: 767px) {
                        .header { padding: calc(0.6rem + var(--sat, 0px)) calc(1rem + var(--sar, 0px)) 0.6rem calc(1rem + var(--sal, 0px)); }
                        .hub-platform-grid { grid-template-columns: 1fr !important; padding-left: calc(12px + var(--sal, 0px)) !important; padding-right: calc(12px + var(--sar, 0px)) !important; }
                        .hub-franchise-picker { padding-left: calc(12px + var(--sal, 0px)) !important; padding-right: calc(12px + var(--sar, 0px)) !important; }
                        .hub-cta, .hub-platform-grid button { min-height: 44px; }
                    }
                `}</style>
                {/* ── Header ── */}
                <header className="header">
                    <div className="header-brand" role="link" aria-label="Dynasty HQ home"
                        onClick={() => { window.location.href = DHQ_HOME_URL; }}
                        style={{ cursor: 'pointer' }}>
                        <img src={iconSrc} alt="Logo" style={{ width:'44px',height:'44px',borderRadius:'10px',boxShadow:'0 2px 12px var(--acc-line2, rgba(212,175,55,.3))' }} />
                        <div className="header-text">
                            <h1 className="owner-name wr-wordmark" style={{ fontSize:'1.1rem',letterSpacing:'.06em' }}>DYNASTY HQ</h1>
                            <div className="header-subtitle">{String(displayName)}</div>
                        </div>
                    </div>
                    {/* Calm control row — sits left of the absolutely-positioned gear (44px + gutter) */}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '52px' }}>
                        <button onClick={() => { window.location.href = 'upgrade.html'; }} style={hubCtrlStyle}>BILLING</button>
                        {WR_DISCORD_URL && (
                            <a href={WR_DISCORD_URL} target="_blank" rel="noopener" style={hubCtrlStyle}>DISCORD</a>
                        )}
                    </div>
                    <svg className="settings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" onClick={() => setShowSettings(true)} style={{ cursor: 'pointer' }}>
                        <circle cx="12" cy="12" r="3" stroke="var(--gold)"/>
                        <path d="M12 1v6m0 6v6m-5.2-7.8l-4.3-4.2m12.9 0l4.3 4.2M1 12h6m6 0h6m-7.8 5.2l-4.2 4.3m0-12.9l4.2 4.3" stroke="var(--gold)"/>
                    </svg>
                </header>

                {/* Session/resume affordance now lives inside the Add-a-league modal;
                    the picker surfaces the last league inline via its LAST badge. */}

                {/* ── Franchise picker — the default landing for every visitor.
                     Shows once we're past the initial no-cache sync, and stays
                     mounted behind the Add-a-league modal so connecting never
                     blanks it out. ── */}
                {(hasLeagues || !hubSyncing) && (
                    <FranchisePicker leagues={allLeagues} onSelect={handleSelectLeague} />
                )}

                {/* ── Hub skeleton — holds the surface while the first league streams in
                     so the old connect grid never flashes underneath the picker ── */}
                {hubSyncing && !hasLeagues && (
                    <div className="hub-franchise-picker" style={{ padding: '4px 12px 14px' }}>
                        <style>{'@keyframes wr-hub-shimmer{0%,100%{opacity:.3}50%{opacity:.75}}'}</style>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label, 0.75rem)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--silver)', opacity: 0.7, margin: '2px 0 10px' }}>Syncing franchises…</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                            {[0, 1, 2].map(i => (
                                <div key={i} style={{ border: '1px solid var(--acc-line1, rgba(212,175,55,0.18))', borderRadius: '12px', padding: '14px', background: 'var(--ov-1, rgba(255,255,255,0.02))', animation: 'wr-hub-shimmer 1.4s ease-in-out infinite', animationDelay: (i * 0.18) + 's' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                                        <div style={{ width: '40px', height: '40px', flexShrink: 0, borderRadius: '50%', border: '1.5px solid var(--acc-line2, rgba(212,175,55,0.3))', background: 'var(--black)' }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ height: '10px', width: '70%', background: 'var(--ov-3, rgba(255,255,255,0.04))', borderRadius: '3px' }} />
                                            <div style={{ height: '8px', width: '45%', background: 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: '3px', marginTop: '8px' }} />
                                        </div>
                                    </div>
                                    <div style={{ marginTop: '11px', paddingTop: '10px', borderTop: '1px solid var(--acc-line1, rgba(212,175,55,0.12))' }}>
                                        <div style={{ height: '8px', width: '60%', background: 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: '3px' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Add-a-league / connect — pops up over the franchise picker.
                     This is the only entry to the platform connectors now; the
                     picker itself is always the default surface underneath. ── */}
                {showConnect && (
                <div onClick={() => setShowConnect(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(4,4,7,0.74)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 'calc(52px + var(--wr-dev-banner-height, 0px)) 12px 40px' }}>
                <div onClick={e => e.stopPropagation()}
                    style={{ width: '100%', maxWidth: '760px', background: 'var(--page-bg, #08080B)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '16px', padding: '16px', boxShadow: '0 24px 70px rgba(0,0,0,0.6)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                        <span style={{ fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '.08em', color: 'var(--gold)' }}>ADD A LEAGUE</span>
                        <button onClick={() => setShowConnect(false)} className="hub-cta ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'auto', flex: '0 0 auto' }}>✕ Close</button>
                    </div>
                    {resumeLeague && (
                        <div className="session-strip" style={{ marginBottom: '12px' }}>
                            <span className="session-strip-label">Last Session:</span>
                            <span className="session-strip-league">{lastLeagueName}</span>
                            <button className="session-strip-btn primary" onClick={() => handleSelectLeague(resumeLeague)}>Resume</button>
                        </div>
                    )}
                {/* ── Platform Cards ── */}
                <div className="hub-platform-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>

                    {/* ──── SLEEPER ──── */}
                    <div className="product-card" style={{ borderColor: 'rgba(26,153,170,0.3)', background: 'linear-gradient(135deg, rgba(26,153,170,0.04), transparent)' }}>
                        <div className="product-card-header">
                            <div className="product-card-icon" style={{ background: 'linear-gradient(135deg, var(--k-1a99aa, #1a99aa), var(--k-147d8a, #147d8a))', boxShadow: '0 3px 12px rgba(26,153,170,0.25)' }}>
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--white)" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                            </div>
                            <div>
                                <div className="product-card-title">SLEEPER</div>
                                <div className="product-card-subtitle">{sleeperUsername ? sleeperLeagues.length + ' league' + (sleeperLeagues.length !== 1 ? 's' : '') + ' synced' : 'Connect your account'}</div>
                            </div>
                        </div>
                        <div className="product-card-body">
                            {!sleeperUsername ? (
                                <div className="hub-connect-card">
                                    <input id="wr-sleeper-input" placeholder="Sleeper username" onKeyDown={e => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) { localStorage.setItem('od_auth_v1', JSON.stringify({sleeperUsername:v})); window.location.reload(); } } }} />
                                    <button className="hub-cta gold" onClick={() => { const v = document.getElementById('wr-sleeper-input')?.value?.trim(); if (v) { localStorage.setItem('od_auth_v1', JSON.stringify({sleeperUsername:v})); window.location.reload(); } }}>CONNECT</button>
                                    <button className="hub-cta ghost" style={{ marginTop: '6px' }} onClick={() => { localStorage.setItem('od_auth_v1', JSON.stringify({sleeperUsername:'bigloco'})); AppStorage.set(APP_WR_KEYS.DEMO_MODE, '1'); window.location.reload(); }}>Demo League</button>
                                </div>
                            ) : hasLeagues ? (
                                /* Add-a-league view is connect-forms only — the league list
                                   lives on the franchise picker, not duplicated here. */
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.6 }}>
                                    Signed in as <strong style={{ color: 'var(--white)' }}>{sleeperUsername}</strong>. Sleeper leagues sync automatically — new ones appear on the franchise board.
                                </div>
                            ) : (
                                <LeagueSelector onSelect={handleSelectLeague} accent="gold" />
                            )}
                        </div>
                    </div>

                    {/* ──── ESPN ──── HIDDEN — infrastructure preserved, UI removed */}

                    {/* ──── MFL — sandbox beta only ──── */}
                    {platformAccessAllowed('mfl') && <div className="product-card" style={{ borderColor: 'rgba(46,125,50,0.3)', background: 'linear-gradient(135deg, rgba(46,125,50,0.04), transparent)' }}>
                        <div className="product-card-header">
                            <div className="product-card-icon" style={{ background: 'linear-gradient(135deg, var(--k-2e7d32, #2e7d32), var(--k-1b5e20, #1b5e20))', boxShadow: '0 3px 12px rgba(46,125,50,0.25)' }}>
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--white)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                            </div>
                            <div>
                                <div className="product-card-title">MFL</div>
                                <div className="product-card-subtitle">{visibleMflLeagues.length > 0 ? visibleMflLeagues.length + ' league' + (visibleMflLeagues.length !== 1 ? 's' : '') + ' synced' : 'MyFantasyLeague connector'}</div>
                            </div>
                        </div>
                        <div className="product-card-body">
                            {/* Connected leagues */}
                            {visibleMflLeagues.length > 0 && (
                                <div style={{ marginBottom: '8px' }}>
                                    {visibleMflLeagues.map(l => (
                                        <button key={l.id} className="hub-cta gold" style={{ marginBottom: '4px', width: '100%' }} onClick={() => handleSelectLeague(l)}>
                                            ENTER {l.name?.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {/* Franchise picker */}
                            {mflFranchises && (
                                <div>
                                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', marginBottom: '8px', fontWeight: 700 }}>Select your team:</div>
                                    <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                                        {mflFranchises.map(f => (
                                            <button key={f.id} onClick={() => finalizeMFLConnect(f.id)}
                                                style={{ display: 'block', width: '100%', padding: '8px 10px', marginBottom: '4px', background: 'rgba(46,125,50,0.08)', border: '1px solid rgba(46,125,50,0.25)', borderRadius: '6px', color: 'var(--white)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'left' }}>
                                                {f.name || f.owner_name || ('Team ' + f.id)}
                                            </button>
                                        ))}
                                    </div>
                                    <button onClick={() => { setMflFranchises(null); setMflPendingResult(null); }} style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', background: 'none', border: 'none', cursor: 'pointer', marginTop: '6px' }}>Cancel</button>
                                </div>
                            )}
                            {/* Connect form */}
                            {!mflFranchises && (
                                <div>
                                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '8px' }}>Enter your MFL League ID and year to connect.</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px,1fr))', gap: '6px', marginBottom: '10px' }}>
                                        {[
                                            ['Public', 'league XML'],
                                            ['Private', 'API key'],
                                            ['Team', 'franchise pick'],
                                        ].map(([label, detail]) => (
                                            <div key={label} style={{ border: '1px solid rgba(46,125,50,0.18)', background: 'rgba(46,125,50,0.06)', borderRadius: '6px', padding: '7px 8px', minWidth: 0 }}>
                                                <strong style={{ display: 'block', color: 'var(--k-81c784, #81c784)', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)' }}>{label}</strong>
                                                <span style={{ display: 'block', color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', opacity: 0.72, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                                        <input id="wr-mfl-id" placeholder="League ID" style={{ flex: 1, padding: '8px 10px', background: 'var(--charcoal)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '6px', color: 'var(--white)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)' }} />
                                        <input id="wr-mfl-year" placeholder="Year" defaultValue="2026" style={{ width: '70px', padding: '8px 10px', background: 'var(--charcoal)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '6px', color: 'var(--white)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', textAlign: 'center' }} />
                                    </div>
                                    <details style={{ marginBottom: '8px' }}>
                                        <summary style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', cursor: 'pointer', opacity: 0.7 }}>Private league? Add API key</summary>
                                        <input id="wr-mfl-apikey" placeholder="API Key (optional)" style={{ width: '100%', marginTop: '6px', padding: '8px 10px', background: 'var(--charcoal)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '6px', color: 'var(--white)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)' }} />
                                    </details>
                                    {mflError && <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--k-e74c3c, #e74c3c)', marginBottom: '8px' }}>{mflError}</div>}
                                    <button className="hub-cta gold" disabled={mflConnecting} onClick={() => {
                                        const id = document.getElementById('wr-mfl-id')?.value?.trim();
                                        const yr = document.getElementById('wr-mfl-year')?.value?.trim() || '2026';
                                        const apiKey = document.getElementById('wr-mfl-apikey')?.value?.trim() || '';
                                        handleMFLConnect(id, yr, apiKey);
                                    }}>{mflConnecting ? 'Connecting...' : 'CONNECT MFL'}</button>
                                </div>
                            )}
                        </div>
                    </div>}

                    {/* ──── YAHOO ──── HIDDEN — infrastructure preserved, UI removed */}

                </div>
                </div>
                </div>
                )}

                {showSettings && (
                    <SettingsModal
                        accountOnly={true}
                        onClose={() => setShowSettings(false)}
                        initDisplayName={customDisplayName}
                        onDisplayNameSave={(name) => {
                            setCustomDisplayName(name);
                            window.OD.saveDisplayName(name);
                        }}
                        leagueMates={leagueMates}
                    />
                )}

            </div>
        );
    }

    ReactDOM.render(<OwnerDashboard />, document.getElementById('root'));
