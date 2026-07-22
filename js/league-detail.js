// ══════════════════════════════════════════════════════════════════
// league-detail.js — LeagueDetail: Dashboard, My Team, League Map, Analytics
// This is the main app shell after selecting a league.
// ══════════════════════════════════════════════════════════════════
    const LEAGUE_WR_KEYS  = window.App.WR_KEYS;
    const LeagueStorage = window.App.WrStorage;

    // Lazy boundary factory for deferred module groups (see js/module-loader.js).
    // Heavy tab modules are inert at boot; on first open we inject the group's
    // scripts, show a spinner, then render the real component. The components are
    // globals only defined after the load completes, so each is resolved through a
    // thunk that is only trusted once the group reports ready.
    function wrLazyTab(group, label, resolveComponent) {
        return function WrLazyTabBoundary(props) {
            const [phase, setPhase] = React.useState(
                (window.wrModuleGroupLoaded?.(group) && typeof resolveComponent() === 'function') ? 'ready' : 'loading'
            );
            React.useEffect(() => {
                if (phase === 'ready') return;
                let alive = true;
                const loader = window.wrLoadModuleGroup ? window.wrLoadModuleGroup(group) : Promise.resolve();
                loader.then(() => { if (alive) setPhase('ready'); })
                      .catch((e) => { if (window.wrLog) window.wrLog(group + '.lazyLoad', e); if (alive) setPhase('error'); });
                return () => { alive = false; };
            }, []);
            if (phase === 'error') {
                return React.createElement('div', { style: { padding: '48px 24px', textAlign: 'center', color: 'var(--silver)' } },
                    label + ' module failed to load. ',
                    React.createElement('button', {
                        onClick: () => window.location.reload(),
                        style: { marginTop: '12px', padding: '8px 16px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 },
                    }, 'Reload'));
            }
            const Comp = resolveComponent();
            if (phase !== 'ready' || typeof Comp !== 'function') {
                return React.createElement('div', { style: { padding: '64px 24px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)' } }, 'Loading ' + label + '…');
            }
            return React.createElement(Comp, props);
        };
    }
    const DraftTabLazy = wrLazyTab('draft', 'Draft Command', () => (typeof DraftTab === 'function' ? DraftTab : null));
    const TradeCalcTabLazy = wrLazyTab('trade', 'Trade Center', () => (typeof TradeCalcTab === 'function' ? TradeCalcTab : null));
    const FreeAgencyTabLazy = wrLazyTab('fa', 'Free Agency', () => (typeof FreeAgencyTab === 'function' ? FreeAgencyTab : null));
    const LeagueMapTabLazy = wrLazyTab('analysis', 'League Intel', () => (typeof LeagueMapTab === 'function' ? LeagueMapTab : null));
    const AnalyticsPanelLazy = wrLazyTab('analysis', 'Analytics', () => (typeof AnalyticsPanel === 'function' ? AnalyticsPanel : null));
    const TrophyRoomTabLazy = wrLazyTab('trophies', 'Trophy Room', () => (typeof TrophyRoomTab === 'function' ? TrophyRoomTab : null));
    const AlexInsightsTabLazy = wrLazyTab('alex', "GM's Office", () => (typeof window.AlexInsightsTab === 'function' ? window.AlexInsightsTab : null));
    const CompareTabLazy = wrLazyTab('compare', 'Compare', () => (typeof window.CompareTab === 'function' ? window.CompareTab : null));
    // My Team and Calendar are non-default tabs (the default in-league view is the
    // dashboard), so their modules are deferred too — they no longer load at boot
    // and only fetch on first open, like the tabs above. Removes ~68KB of JSX from
    // the cold-load critical path. The thunks resolve the same top-level globals the
    // deferred scripts define once the group reports ready.
    const MyTeamTabLazy = wrLazyTab('myteam', 'My Team', () => (typeof MyTeamTab === 'function' ? MyTeamTab : null));
    const CalendarTabLazy = wrLazyTab('calendar', 'Calendar', () => (typeof CalendarTab === 'function' ? CalendarTab : null));
    const LineupTabLazy = wrLazyTab('lineup', 'Lineup', () => (typeof window.LineupTab === 'function' ? window.LineupTab : null));

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function markdownToHtml(str) {
        // Use the shared AI-text formatter so Alex's chat matches every other
        // AI surface (bold, paragraph spacing, tidy dividers). Falls back to
        // the original inline behavior if the shared helper hasn't loaded.
        if (window.WR && typeof window.WR.formatAI === 'function') return window.WR.formatAI(str);
        return escapeHtml(str).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    }

    // ── DHQ-ranked startable pool (mirrors trade-calc.calcNflStarterSet) ──
    // Built once after the DHQ engine loads. For each position, the top
    // NFL_STARTER_POOL[pos] players by DHQ dynasty value are the legitimate NFL
    // starters. Used to recompute starter COUNTS below. Works year-round (DHQ
    // values are always loaded), unlike depth_chart_order which is offseason-null.
    let _dhqStarterSet = null;
    function buildDhqStarterSet() {
        try {
            const players = window.App?._playersCache;
            const dhqScores = window.App?.LI?.playerScores || {};
            const POOL = window.App?.PlayerValue?.NFL_STARTER_POOL;
            const normPos = window.App?.normPos;
            if (!POOL || !normPos || !players || !Object.keys(players).length) return null;
            const byPos = {};
            for (const [id, p] of Object.entries(players)) {
                const pos = normPos(p?.position);
                if (!pos || !(pos in POOL) || !p?.team) continue;
                const score = dhqScores[id];
                if (!(score > 0)) continue;
                (byPos[pos] = byPos[pos] || []).push({ id, score });
            }
            const set = {};
            for (const [pos, arr] of Object.entries(byPos)) {
                arr.sort((a, b) => b.score - a.score);
                set[pos] = new Set(arr.slice(0, POOL[pos]).map(x => x.id));
            }
            return set;
        } catch (_) { return null; }
    }

    // ── Starter-requirement + count correction over the upstream assessor ──
    // The shared assessTeamFromGlobal (ReconAI CDN) uses its own per-position
    // starter requirements (incl. QB:3, unreachable in deep leagues) and counts
    // startable players by last-season points (missing rookies/breakouts). We
    // wrap it — upstream untouched — to recompute startingReq/minQuality/ideal
    // from our constants, recount nflStarters via the DHQ starter set, and
    // rebuild status/needs/strengths so every consumer stays consistent.
    let _assessorWrapped = false;
    function installStarterReqCorrection() {
        try {
            if (_assessorWrapped) return;
            const upstream = window.assessTeamFromGlobal;
            if (typeof upstream !== 'function') return;
            const PV = window.App?.PlayerValue;
            const MINQ = PV?.MIN_STARTER_QUALITY;
            const IDEAL = PV?.IDEAL_ROSTER;
            if (!MINQ) return;

            function correct(result, rosterId) {
                if (!result || !result.posAssessment) return result;
                const pa = result.posAssessment;
                // Count starter-quality players per position via the DHQ-ranked set.
                const confirmedByPos = (() => {
                    const out = {};
                    try {
                        const starterSet = _dhqStarterSet || (_dhqStarterSet = buildDhqStarterSet());
                        if (!starterSet) return out;
                        const roster = (window.S?.rosters || []).find(r => String(r.roster_id) === String(rosterId));
                        const players = roster?.players || [];
                        const cache = window.App?._playersCache || {};
                        const normPos = window.App?.normPos;
                        for (const pid of players) {
                            const p = cache[pid];
                            const np = p ? (normPos ? normPos(p.position) : p.position) : null;
                            if (!np || !starterSet[np]) continue;
                            if (starterSet[np].has(pid)) out[np] = (out[np] || 0) + 1;
                        }
                    } catch (_) {}
                    return out;
                })();
                for (const [pos, data] of Object.entries(pa)) {
                    if (!data || MINQ[pos] == null) continue;
                    const req = MINQ[pos];
                    const ideal = (IDEAL && IDEAL[pos] != null) ? IDEAL[pos] : data.ideal;
                    const actual = data.actual ?? 0;
                    // Only ever raise the count (fix undercounts, never invent starters).
                    const upstreamStarters = data.nflStarters ?? 0;
                    const confirmed = confirmedByPos[pos] || 0;
                    const nflStarters = Math.min(actual, Math.max(upstreamStarters, confirmed));
                    let status;
                    if (nflStarters === 0) status = 'deficit';
                    else if (nflStarters < req) status = 'thin';
                    else if (actual >= ideal) status = 'surplus';
                    else status = 'ok';
                    if ((status === 'ok' || status === 'surplus') && actual < ideal) status = 'thin';
                    data.nflStarters = nflStarters;
                    data.startingReq = req;
                    data.minQuality = req;
                    data.ideal = ideal;
                    data.status = status;
                }
                result.needs = Object.entries(pa)
                    .filter(([, v]) => v.status === 'deficit' || v.status === 'thin')
                    .sort((a, b) => {
                        const aGap = (a[1].nflStarters || 0) - (a[1].startingReq || 1);
                        const bGap = (b[1].nflStarters || 0) - (b[1].startingReq || 1);
                        return aGap !== bGap ? aGap - bGap : (a[1].diff || 0) - (b[1].diff || 0);
                    })
                    .map(([pos, v]) => ({ pos, urgency: v.status, gap: Math.max(0, (v.startingReq || 1) - (v.nflStarters || 0)), diff: v.diff }))
                    .slice(0, 5);
                result.strengths = Object.entries(pa).filter(([, v]) => v.status === 'surplus').map(([pos]) => pos);
                return result;
            }

            const wrapped = function (rosterId) { return correct(upstream.apply(this, arguments), rosterId); };
            Object.defineProperty(wrapped, '_cache', {
                get() { return upstream._cache; },
                set(v) { upstream._cache = v; },
                configurable: true,
            });
            wrapped._wrappedUpstream = upstream;
            window.assessTeamFromGlobal = wrapped;
            _assessorWrapped = true;
        } catch (e) {
            console.warn('[War Room] installStarterReqCorrection failed:', e);
        }
    }

    function wrCanPageScroll() {
        const doc = document.documentElement;
        const body = document.body;
        return Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0) > window.innerHeight + 1;
    }

    function wrCanElementConsumeWheel(el, deltaY) {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (!/(auto|scroll|overlay)/.test(style.overflowY)) return false;
        if (el.scrollHeight <= el.clientHeight + 1) return false;
        const canScrollUp = el.scrollTop > 1;
        const canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
        return deltaY < 0 ? canScrollUp : canScrollDown;
    }

    function rerouteWheelToPage(event) {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
        if (Math.abs(event.deltaY) < 1 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        if (!wrCanPageScroll()) return;

        let el = event.target;
        while (el && el !== document.body && el !== document.documentElement) {
            if (wrCanElementConsumeWheel(el, event.deltaY)) return;
            el = el.parentElement;
        }

        event.preventDefault();
        window.__WR_SCROLL_FALLBACK_LAST = { at: Date.now(), deltaY: event.deltaY };
        window.scrollBy({ top: event.deltaY, left: 0, behavior: 'auto' });
    }

    function resolvePlatformProvider(league) {
        const registry = window.App?.Platforms || window.Platforms;
        const registered = registry?.getForLeague?.(league);
        if (registered) return registered;

        const platform = league?._platform
            || (league?._mfl ? 'mfl' : league?._espn ? 'espn' : league?._yahoo ? 'yahoo' : 'sleeper');
        const fallbackProviders = {
            sleeper: window.Sleeper?.provider,
            mfl: window.MFL?.provider,
            espn: window.ESPN?.provider,
            yahoo: window.Yahoo?.provider,
        };
        const fallback = fallbackProviders[platform] || null;
        if (fallback && registry?.register) {
            registry.register(fallback);
        }
        return fallback;
    }

    function leagueTypeHeaderMeta(profile) {
        const type = String(profile?.type || 'unknown').toLowerCase();
        const defs = {
            redraft: { label: 'Redraft', short: 'RD', color: 'var(--k-2ecc71, #2ecc71)', icon: 'reset' },
            keeper: { label: 'Keeper', short: 'KP', color: 'var(--k-7c6bf8, #7c6bf8)', icon: 'bookmark' },
            dynasty: { label: 'Dynasty', short: 'DY', color: 'var(--k-d4af37, #d4af37)', icon: 'crown' },
            best_ball: { label: 'Best Ball', short: 'BB', color: 'var(--k-3498db, #3498db)', icon: 'spark' },
            dfs: { label: 'DFS', short: 'DFS', color: 'var(--k-3498db, #3498db)', icon: 'spark' },
        };
        return defs[type] || { label: type && type !== 'unknown' ? type.replace(/_/g, ' ') : 'League Type Unknown', short: '?', color: 'var(--k-c7cdd7, #c7cdd7)', icon: 'circle' };
    }

    function LeagueTypeHeaderIcon({ meta }) {
        const common = {
            width: 14,
            height: 14,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            focusable: 'false',
            style: { display: 'block', flexShrink: 0 },
        };
        const icon = meta?.icon || 'circle';
        if (icon === 'reset') {
            return React.createElement('svg', common,
                React.createElement('path', { d: 'M4 7h10a6 6 0 1 1-4.2 10.2' }),
                React.createElement('path', { d: 'M7 4 4 7l3 3' })
            );
        }
        if (icon === 'bookmark') {
            return React.createElement('svg', common,
                React.createElement('path', { d: 'M7 4h10a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1z' })
            );
        }
        if (icon === 'crown') {
            return React.createElement('svg', common,
                React.createElement('path', { d: 'm3 7 5 4 4-7 4 7 5-4-2 12H5L3 7z' }),
                React.createElement('path', { d: 'M5 19h14' })
            );
        }
        if (icon === 'spark') {
            return React.createElement('svg', common,
                React.createElement('path', { d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z' })
            );
        }
        return React.createElement('svg', common,
            React.createElement('circle', { cx: 12, cy: 12, r: 7 })
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // END DRAFT TAB
    // ══════════════════════════════════════════════════════════════════════════

    // ── League nav definition — SINGLE SOURCE OF TRUTH ──
    // Consumed by BOTH the sidebar drawer (LeagueDetail render) and the
    // phone bottom dock strip (PhoneDock below). Add/remove/gate items
    // here only. `{ section }` rows render as sidebar dividers and are
    // filtered out of the dock strip.
    // Glyphs = Lucide icon path data (ISC license, lucide.dev), flattened to
    // path-only form because every consumer maps plain <path d> elements
    // (rects/circles/polylines hand-converted to arcs). Owner ask 2026-07-12:
    // replace the hand-drawn set with a professional icon family.
    const NAV_ICON_PATHS = {
        // house
        home: ['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
        // clipboard-list — a roster is a clipboard
        roster: ['M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M12 11h4', 'M12 16h4', 'M8 11h.01', 'M8 16h.01'],
        // zap
        gameday: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
        // scale — weighing two options
        compare: ['m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z', 'm2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z', 'M7 21h10', 'M12 3v18', 'M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2'],
        // arrow-right-left
        trade: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
        // dollar-sign
        fa: ['M12 2v20', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
        // list-ordered — the draft order
        draft: ['M10 12h11', 'M10 18h11', 'M10 6h11', 'M4 10h2', 'M4 6h1v4', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
        // chart-column
        analytics: ['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
        // film
        film: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M7 3v18', 'M3 7.5h4', 'M3 12h18', 'M3 16.5h4', 'M17 3v18', 'M21 7.5h-4', 'M21 16.5h-4'],
        // briefcase
        office: ['M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', 'M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z'],
        // trophy
        trophy: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'],
        // calendar
        calendar: ['M8 2v4', 'M16 2v4', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M3 10h18'],
        // target
        strategy: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z', 'M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z', 'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z'],
        // settings (gear)
        settings: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
        // book-open — the reference key
        legend: ['M12 7v14', 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'],
        // refresh-cw
        refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
    };
    // showGameDay = the FINAL leagueSkin.features.showGameDay flag
    // (callers apply the same `?? phase === 'in_season'` fallback in one place).
    function buildLeagueNavItems(showGameDay) {
        return [
            { section: 'FRONT OFFICE' },
            { label: 'Home', tab: 'dashboard', iconKey: 'home' },
            { label: 'My Roster', tab: 'myteam', iconKey: 'roster' },
            // Game Day Central — only surfaced for in-season leagues.
            ...(showGameDay ? [{ label: 'Game Day', tab: 'lineup', iconKey: 'gameday' }] : []),
            { label: 'Compare', tab: 'compare', iconKey: 'compare' },
            { section: 'LEAGUE' },
            { label: 'Trade Center', tab: 'trades', iconKey: 'trade' },
            { label: 'Free Agency', tab: 'fa', iconKey: 'fa' },
            { label: 'Draft', tab: 'draft', iconKey: 'draft' },
            { label: 'Analytics', tab: 'analytics', iconKey: 'analytics' },
            { section: 'DOSSIER' },
            { label: 'GM\'s Office', tab: 'alex', iconKey: 'office' },
            { label: 'Trophy Room', tab: 'trophies', iconKey: 'trophy' },
            { section: 'SETTINGS' },
            { label: 'Settings', tab: 'settings', iconKey: 'settings' },
            { label: 'Legend', tab: 'legend', iconKey: 'legend' },
        ];
    }
    // Shared active test (sidebar + dock): the Strategy editor lives under
    // GM's Office, so 'strategy' lights the 'alex' item.
    function navItemIsActive(item, activeTab) {
        return !!item.tab && (activeTab === item.tab || (item.tab === 'alex' && activeTab === 'strategy'));
    }

    // ── Phone bottom dock (≤767 only) ──
    // ONE fixed bottom row, Scout mobile-nav idiom: a sliding module strip
    // of EVERY nav item from buildLeagueNavItems above (same array instance
    // the sidebar maps — no 'More' slot; the hamburger drawer stays as
    // redundant access), plus a PINNED Ask Alex peer item at the right end
    // (gold-hairline left divider) that opens the Alex chat sheet — it
    // replaces the FAB on phone. Returns null outside the phone tier and
    // while the iOS keyboard is open (WR.useViewport kbOpen), so
    // tablet/desktop render byte-identical; it STAYS mounted while the Alex
    // sheet is open (sheet z 200 covers the dock at z 100 — expected).
    // Visuals live in index.html's PHONE TIER block (.wr-phone-dock /
    // .wr-dock-*); z + bottom offsets come from the fixed-layer registry
    // (--wr-z-nav / --wr-tab-bar-h / --wr-bottom-inset — heights are the
    // STATIC 56px / 48px landscape-compact CSS values, no JS measuring).
    // The gate lives in this thin wrapper so PhoneDockInner's hooks
    // mount/unmount cleanly.
    function PhoneDock(props) {
        const vp = window.WR.useViewport();
        if (!vp.isPhone || vp.kbOpen) return null;
        return <PhoneDockInner {...props} />;
    }
    function PhoneDockInner({ activeTab, navItems, onSelectTab, onAskAlex }) {
        const stripRef = useRef(null);
        const chips = navItems.filter(item => item.tab);

        // Keep the active chip visible whenever the tab changes (sidebar,
        // deep links, and dock taps all funnel through activeTab).
        useEffect(() => {
            const strip = stripRef.current;
            if (!strip) return;
            const chip = strip.querySelector('.wr-dock-chip.is-active');
            if (chip && typeof chip.scrollIntoView === 'function') {
                try { chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }
                catch (_) { /* older WebKit: options-object form unsupported */ }
            }
        }, [activeTab]);

        // Edge-fade masks only where chips are actually cut off (.has-left /
        // .has-right drive the CSS) — a static mask dims the last chip at
        // full scroll and gives no "more this way" cue on the left.
        useEffect(() => {
            const strip = stripRef.current;
            if (!strip) return;
            const update = () => {
                const max = strip.scrollWidth - strip.clientWidth;
                strip.classList.toggle('has-left', strip.scrollLeft > 4);
                strip.classList.toggle('has-right', strip.scrollLeft < max - 4);
            };
            update();
            strip.addEventListener('scroll', update, { passive: true });
            window.addEventListener('resize', update);
            return () => { strip.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
        }, [navItems]);

        return (
            <nav className="wr-phone-dock" aria-label="Primary">
                <div ref={stripRef} className="wr-dock-strip">
                    {chips.map(item => {
                        const isActive = navItemIsActive(item, activeTab);
                        return (
                            <button key={item.tab} type="button"
                                className={'wr-dock-chip' + (isActive ? ' is-active' : '')}
                                aria-current={isActive ? 'page' : undefined}
                                onClick={() => onSelectTab(item.tab)}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    {(NAV_ICON_PATHS[item.iconKey] || NAV_ICON_PATHS.home).map((d, i) => <path key={i} d={d} />)}
                                </svg>
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>
                {/* Ask Alex — pinned marquee peer item (Scout's AI slot
                    precedent): never scrolls with the strip. Free tier sees
                    it too — the 1/day quota is enforced in the send path,
                    not here. */}
                <button type="button" className="wr-dock-ask" onClick={onAskAlex}
                    aria-label="Ask Alex — open chat">
                    {window.AlexAvatar
                        ? <span aria-hidden="true" style={{ display: 'inline-flex' }}><window.AlexAvatar size={20} /></span>
                        : <span className="wr-dock-ask-glyph" aria-hidden="true">{'✦'}</span>}
                    <span aria-hidden="true">Alex</span>
                </button>
            </nav>
        );
    }

    // League Detail Component
    function LeagueDetail({ league, onBack, sleeperUserId, onOpenSettings, settingsProps = {}, activeTab: propActiveTab, onTabChange }) {
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [playersData, setPlayersData] = useState({});
        const [myRoster, setMyRoster] = useState(null);
        const [standings, setStandings] = useState([]);
        const [viewingOwnerId, setViewingOwnerId] = useState(sleeperUserId);
        const [statsData, setStatsData] = useState({});
        const [projectionsData, setProjectionsData] = useState({});
        const [stats2025Data, setStats2025Data] = useState({});
        const [currentLeague, setCurrentLeague] = useState(league);
        const [activeYear, setActiveYear] = useState(league.season);
        // Platform detection via the unified PlatformProvider registry.
        // Providers know whether they support historical year chains,
        // so feature flags like `isSleeper` (used for year switching UI)
        // are now derived from provider.capabilities instead of hardcoded.
        const _provider = resolvePlatformProvider(currentLeague);
        const isSleeper = _provider?.id === 'sleeper';
        const [trending, setTrending] = useState({ adds: [], drops: [] });
        const [localActiveTab, setLocalActiveTab] = useState('dashboard');
        // Phase 8: any stale/saved state that points at the removed 'league' tab auto-redirects to Analytics.
        useEffect(() => {
            if (localActiveTab === 'league') setLocalActiveTab('analytics');
            if (propActiveTab === 'league' && typeof onTabChange === 'function') onTabChange('analytics');
        }, [localActiveTab, propActiveTab]);
        const activeTab = propActiveTab !== undefined ? propActiveTab : localActiveTab;
        const setActiveTab = onTabChange || setLocalActiveTab;
        const [tradeSubTab, setTradeSubTab] = useState(null); // when set, TradeCalcTab opens this sub-tab
        const [selectedPlayerPid, setSelectedPlayerPid] = useState(null);
        const [headerDraftInfo, setHeaderDraftInfo] = useState(null);
        const [headerClockNow, setHeaderClockNow] = useState(Date.now());

        // ── TIME CONTEXT — the temporal lens of the entire app ──
        // Single source of truth. All modules read timeYear and derived helpers.
        const currentSeason = parseInt(league.season) || new Date().getFullYear();
        const [timeYear, setTimeYear] = useState(() => {
            const saved = LeagueStorage.get(LEAGUE_WR_KEYS.TIME_YEAR);
            return saved !== null ? parseInt(saved) : currentSeason;
        });
        const [timeLoading, setTimeLoading] = useState(false);
        const [timeRecomputeTs, setTimeRecomputeTs] = useState(Date.now());
        const [basePlayersData, setBasePlayersData] = useState(null);

        // The server tier resolves asynchronously a beat after the tab tree first
        // renders. Without this bump, a Pro subscriber who opened straight into a
        // gated tab (Trade Center, Free Agency, Draft) captured the pre-resolution
        // 'free' snapshot and stayed on the "Unlock with Pro" teasers until a full
        // reload. Re-render every tab once the real tier lands.
        const [, setTierEpoch] = useState(0);
        useEffect(() => {
            const bump = () => setTierEpoch(n => n + 1);
            if (window.App && window.App._userTierResolved) bump(); // resolved before mount
            window.addEventListener('dhq:tier-resolved', bump);
            return () => window.removeEventListener('dhq:tier-resolved', bump);
        }, []);

        useEffect(() => {
            const leagueId = currentLeague?.league_id || currentLeague?.id;
            if (!leagueId) return;
            let cancelled = false;
            // MFL leagues 404 on the Sleeper drafts endpoint (the id is 'mfl_<id>_<year>').
            // Source the status-bearing MFL draft objects instead so the header
            // "Draft Live" button appears + launches straight into the live draft.
            const isMfl = !!(currentLeague?._mfl || String(leagueId).startsWith('mfl_'));
            const fetchDrafts = isMfl
                ? (async () => {
                    try {
                        if (window.MFL?.fetchDraftStatus) {
                            const mlid = currentLeague._mflLeagueId || String(leagueId).replace(/^mfl_/, '').replace(/_\d+$/, '');
                            const yr = currentLeague.season || localStorage.getItem('mfl_year') || String(new Date().getFullYear());
                            const key = sessionStorage.getItem('mfl_api_key') || null;
                            const d = await window.MFL.fetchDraftStatus(mlid, yr, key, currentLeague);
                            if (Array.isArray(d) && d.length) return d;
                        }
                    } catch (e) { window.wrLog?.('leagueDetail.mflDraftStatus', e); }
                    return window.S?.drafts || currentLeague?.drafts || [];
                })
                : (window.Sleeper?.fetchDrafts || (async (lid) => {
                    const resp = await fetch('https://api.sleeper.app/v1/league/' + lid + '/drafts');
                    return resp.ok ? resp.json() : [];
                }));
            fetchDrafts(leagueId)
                .then(rows => {
                    if (cancelled) return;
                    const drafts = Array.isArray(rows) ? rows : [];
                    // Draft-of-record rule (draft/state.js selectCurrentDraft):
                    // live > unsuperseded latest complete ('review') > next
                    // pre_draft — so a just-completed draft keeps a header entry
                    // point ('View Draft Results') instead of vanishing.
                    const sel = window.DraftCC?.state?.selectCurrentDraft?.(drafts);
                    // DraftCC lives in the deferred 'draft' module group and this
                    // effect runs once per league open — when it isn't loaded yet,
                    // mirror the draft-of-record rule locally (live > next
                    // pre_draft > most recently completed) so the completed-draft
                    // "View Draft Results" chip still renders without the module.
                    const localDraftOfRecord = () =>
                        drafts.find(d => d.status === 'drafting')
                        || drafts.find(d => d.status === 'pre_draft')
                        || drafts.filter(d => d.status === 'complete')
                            .sort((a, b) => (Number(b.last_picked || b.start_time || b.created) || 0)
                                - (Number(a.last_picked || a.start_time || a.created) || 0))[0]
                        || null;
                    const active = sel !== undefined ? (sel.draft || null) : localDraftOfRecord();
                    setHeaderDraftInfo(active);
                })
                .catch(() => { if (!cancelled) setHeaderDraftInfo(null); });
            return () => { cancelled = true; };
        }, [currentLeague?.league_id, currentLeague?.id]);

        useEffect(() => {
            if (!headerDraftInfo?.start_time || headerDraftInfo.status !== 'pre_draft') return;
            const id = setInterval(() => setHeaderClockNow(Date.now()), 60000);
            return () => clearInterval(id);
        }, [headerDraftInfo?.start_time, headerDraftInfo?.status]);

        const headerDraftClock = useMemo(() => {
            if (!headerDraftInfo) return null;
            if (headerDraftInfo.status === 'drafting') return { label: 'Draft Live', clock: 'Now' };
            // Completed draft of record: keep an entry point to the finished
            // board (DraftTab's _wrOpenLiveDraft flag path rebuilds the results).
            if (headerDraftInfo.status === 'complete') return { label: '', clock: 'View Draft Results' };
            if (!headerDraftInfo.start_time) return { label: 'Draft Upcoming', clock: 'Scheduled' };
            const diff = Number(headerDraftInfo.start_time) - headerClockNow;
            if (diff <= 0) return { label: 'Draft Upcoming', clock: 'Open' };
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            return { label: 'Draft Upcoming', clock: (days > 0 ? days + 'd ' : '') + hours + 'h ' + mins + 'm' };
        }, [headerDraftInfo, headerClockNow]);

        // ── SeasonContext state — reactive data shared with tab components ──
        const [seasonCtxData, setSeasonCtxData] = useState({
            season: league.season || '',
            playerStats: {},
            tradedPicks: [],
            rosters: [],
            myRosterId: null,
            lastUpdated: 0,
        });
        const headerLeagueProfile = useMemo(() => {
            if (!currentLeague || typeof window.App?.Intelligence?.buildLeagueProfile !== 'function') return null;
            try {
                const rosters = seasonCtxData.rosters?.length ? seasonCtxData.rosters : (currentLeague.rosters || []);
                return window.App.Intelligence.buildLeagueProfile({
                    league: currentLeague,
                    rosters,
                    platform: currentLeague._platform || window.S?.platform,
                });
            } catch (err) {
                if (window.wrLog) window.wrLog('leagueHeader.profile', err);
                return null;
            }
        }, [
            currentLeague,
            currentLeague?.league_id,
            currentLeague?.id,
            currentLeague?.type,
            currentLeague?.league_type,
            currentLeague?.settings?.type,
            currentLeague?.roster_positions,
            currentLeague?.scoring_settings,
            seasonCtxData.lastUpdated,
        ]);
        const headerLeagueType = useMemo(() => leagueTypeHeaderMeta(headerLeagueProfile), [headerLeagueProfile]);
        const leagueSkin = useMemo(() => {
            if (!currentLeague || typeof window.App?.LeagueSkin?.build !== 'function') return null;
            const rosters = seasonCtxData.rosters?.length ? seasonCtxData.rosters : (currentLeague.rosters || []);
            return window.App.LeagueSkin.build({
                league: currentLeague,
                profile: headerLeagueProfile,
                rosters,
                myRoster,
                draft: headerDraftInfo,
                nflState: window.S?.nflState,
            });
        }, [
            headerLeagueProfile,
            currentLeague,
            currentLeague?.league_id,
            currentLeague?.id,
            currentLeague?.status,
            currentLeague?.settings?.type,
            currentLeague?.roster_positions,
            myRoster?.roster_id,
            headerDraftInfo?.draft_id,
            headerDraftInfo?.status,
            seasonCtxData.lastUpdated,
        ]);
        useEffect(() => {
            if (!leagueSkin || typeof window.App?.LeagueSkin?.setCurrent !== 'function') return;
            window.App.LeagueSkin.setCurrent(leagueSkin);
        }, [leagueSkin]);

        // ── VIEW MODE — Analyst is now the only mode (Brief tab replaces Flash Brief) ──
        const [viewMode, setViewMode] = useState('analyst');
        const isAnalyst = true;

        // Open full player modal instead of mini card
        // selectPlayer is exposed via SeasonContext AND kept on window for legacy consumers
        // Also aliased as openPlayerModal so flash-brief, global-view, etc. all use the same entry point.
        // SI-2: Unified PlayerCard (window.WR.openPlayerCard) is the primary surface.
        // Expose playersData/statsData globally so the unified card host can read them without prop drilling.
        useEffect(() => {
            window.App._playersCache = playersData;
            window._wrStatsData = statsData;
        }, [playersData, statsData]);
        const selectPlayer = useCallback((pid) => {
            // Close any existing inline card / legacy CDN modal first
            setSelectedPlayerPid(null);
            if (typeof window.closeFWPlayerModal === 'function') window.closeFWPlayerModal();
            setTimeout(() => {
                // Primary: unified War Room PlayerCard (SI-2)
                if (window.WR && typeof window.WR.openPlayerCard === 'function') {
                    window.WR.openPlayerCard(pid, { scoringSettings: currentLeague?.scoring_settings || {} });
                    return;
                }
                // Fallbacks (kept for safety during rollout)
                if (typeof window.openFWPlayerModal === 'function') {
                    window.openFWPlayerModal(pid, playersData, statsData, currentLeague?.scoring_settings || {});
                } else {
                    setSelectedPlayerPid(pid);
                }
            }, 10);
        }, [playersData, statsData, currentLeague]);
        window._wrSelectPlayer = selectPlayer;
        window.openPlayerModal = selectPlayer;
        // SI-2 deferred: expose nav + compare globals so the unified PlayerCard's action buttons work.
        window.wrNavigateTab = (tab) => { try { setActiveTab(tab); } catch (_) {} };
        window.wrOpenCompare = (pid) => {
            try {
                // Jump to My Roster → Compare view and pre-select the player's team when possible.
                setActiveTab('myteam');
                const roster = (currentLeague?.rosters || []).find(r => (r.players || []).concat(r.taxi || [], r.reserve || []).includes(String(pid)));
                if (roster) window._wrComparePreselect = roster.roster_id;
                // Defer dispatching a custom event so the tab has time to mount
                setTimeout(() => window.dispatchEvent(new CustomEvent('wr:open-compare', { detail: { pid, rosterId: roster?.roster_id } })), 50);
            } catch (_) { /* noop */ }
        };
        // Player-vs-player: open the Compare tab's Players mode and queue this player.
        // We persist the intent (player + scope) to the SAME localStorage keys
        // CompareTab reads on mount, so it survives any tab/mount churn — the
        // in-memory global + deferred event are just the already-mounted fast path.
        window.wrComparePlayers = (pid) => {
            try {
                const lid = currentLeague?.league_id || currentLeague?.id || '';
                if (pid != null && pid !== '') {
                    window._wrAddComparePlayer = String(pid);
                    if (lid) {
                        try {
                            const key = 'wr_compare_players_' + lid;
                            const list = JSON.parse(localStorage.getItem(key) || '[]').map(String);
                            if (!list.includes(String(pid))) list.push(String(pid));
                            localStorage.setItem(key, JSON.stringify(list.slice(0, 4)));
                            localStorage.setItem('wr_compare_scope_' + lid, 'players');
                        } catch (_) { /* storage best-effort */ }
                    }
                }
                setActiveTab('compare');
                setTimeout(() => window.dispatchEvent(new CustomEvent('wr:add-compare-player', { detail: { pid } })), 50);
            } catch (_) { /* noop */ }
        };

        useEffect(() => {
            if (window.S) window.S.activeTab = activeTab;
            window.OD?.track?.('module_viewed', {
                platform: 'warroom',
                leagueId: currentLeague?.league_id || currentLeague?.id || null,
                module: activeTab,
            });
        }, [activeTab, currentLeague?.league_id, currentLeague?.id]);

        // Derived selectors — modules use these, never compute their own
        const isCurrentYear = timeYear === currentSeason;
        const isFutureYear = timeYear > currentSeason;
        const isHistoricalYear = timeYear < currentSeason;
        const timeMode = isFutureYear ? 'future' : isHistoricalYear ? 'historical' : 'current';
        const timeModeLabel = isFutureYear ? 'Projection View' : isHistoricalYear ? 'Historical View' : 'Current Season';
        const timeModeColor = isFutureYear ? 'var(--k-3498db, #3498db)' : isHistoricalYear ? 'var(--k-f0a500, #f0a500)' : 'var(--k-2ecc71, #2ecc71)';
        const timeDelta = timeYear - currentSeason; // positive = future, negative = past
        // Build available years from the league's actual previous_league_id chain
        const [leagueStartYear, setLeagueStartYear] = useState(currentSeason);
        useEffect(() => {
            let cancelled = false;
            async function walkChain() {
                // Only platforms with a previous_league_id chain (Sleeper)
                // can walk backwards — others fall back to a 4-year span.
                const prov = window.App?.Platforms?.getForLeague?.(currentLeague);
                if (!prov?.capabilities?.hasYearChain) {
                    if (!cancelled) setLeagueStartYear(currentSeason - 4);
                    return;
                }
                let lid = currentLeague?.id;
                let earliest = currentSeason;
                for (let y = currentSeason - 1; y >= 2018 && lid; y--) {
                    try {
                        const info = await fetchLeagueInfo(lid);
                        if (!info?.previous_league_id) break;
                        lid = info.previous_league_id;
                        earliest = y;
                    } catch { break; }
                }
                if (!cancelled) setLeagueStartYear(earliest);
            }
            walkChain();
            return () => { cancelled = true; };
        }, [currentLeague?.id]);
        const maxTimeYear = leagueSkin?.features?.showFuturePicks === false ? currentSeason : currentSeason + 2;
        const timeYears = [];
        for (let y = leagueStartYear; y <= maxTimeYear; y++) timeYears.push(y);
        useEffect(() => {
            if (timeYear <= maxTimeYear) return;
            handleTimeYearChange(currentSeason);
        }, [timeYear, maxTimeYear, currentSeason]);

        // Persist time year
        useEffect(() => { LeagueStorage.set(LEAGUE_WR_KEYS.TIME_YEAR, String(timeYear)); }, [timeYear]);

        // Validate shared dependencies from ReconAI CDN
        useEffect(() => {
            const deps = {
                'dynastyValue': typeof window.dynastyValue === 'function',
                'assessTeamFromGlobal': typeof window.assessTeamFromGlobal === 'function',
                'calcOptimalPPG': typeof window.App?.calcOptimalPPG === 'function',
                'getPlayerAction': typeof window.getPlayerAction === 'function',
                'peakWindows': !!window.App?.peakWindows,
                'normPos': typeof window.App?.normPos === 'function',
            };
            const missing = Object.entries(deps).filter(([, ok]) => !ok).map(([name]) => name);
            if (missing.length) {
                console.warn('[War Room] Missing shared dependencies:', missing.join(', '), '— some features may not work. Try refreshing.');
            }
        }, []);

        // Save base player data on first load (before any age projection)
        // Also expose on window.App for cross-module reads (SOS projection, trade-calc)
        useEffect(() => {
            if (Object.keys(playersData).length > 100) {
                window.App._playersCache = playersData;
                if (!basePlayersData) setBasePlayersData(playersData);
            }
        }, [playersData]);

        // ── SOS engine init — fires once playersData is populated ──
        useEffect(() => {
            if (Object.keys(playersData).length < 100) return;
            if (window.App.SOS?.ready) return;
            const season = String(parseInt(currentLeague?.season) || new Date().getFullYear());
            window.App.SOS?.initialize(season, playersData, () => {
                setTimeRecomputeTs(Date.now()); // trigger KPI + roster re-render
            });
        }, [playersData]);

        // ── PROJECTION ENGINE: canonical implementation lives in js/utils/player-value.js ──
        const projectPlayerValue = window.App.PlayerValue.projectPlayerValue;

        // ── LEGEND PANEL — explains War Room tools without revealing sauce ──
        function LegendPanel({ module = false } = {}) {
            const [open, setOpen] = React.useState(false);
            const [expanded, setExpanded] = React.useState(false);
            const valueTerm = skinValueShort === 'DHQ' ? 'DHQ Value' : skinValueLabel;
            const rankTerm = skinShowsDynastyValue ? 'Dynasty Rank' : 'Asset Rank';
            const windowTerm = skinShowsAgeCurve ? 'Compete Window' : 'Season Window';
            const quickItems = [
                { term: valueTerm, def: skinShowsDynastyValue ? 'Dynasty value score (0-10,000). Production + age + situation + market.' : 'Format-adjusted value score (0-10,000). Production, role, scarcity, and market context.' },
                { term: 'Health Score', def: 'Team grade (0-100). 90+ Elite, 80+ Contender, 70+ Crossroads.' },
                { term: 'Elite Player', def: '7000+ ' + skinValueShort + ' or top 5 at their position across all league rosters.' },
                { term: windowTerm, def: skinShowsAgeCurve ? 'Years until your weakest position group ages out.' : 'Current-season readiness for this league format.' },
                { term: 'Player Tags', def: 'Tag players as Trade Block, Cut, Untouchable, or Watch. Syncs between apps.' },
                { term: 'Flash Brief', def: 'Quick-action dashboard. Analyst mode shows deep data.' },
            ];
            const fullItems = [
                { cat: 'What DHQ Measures', items: [
                    { term: valueTerm, def: skinShowsDynastyValue ? 'A 0-10,000 dynasty value score. It blends production, projected role, age curve, positional scarcity, roster situation, market consensus, and format context. It is updated when you refresh league data.' : 'A 0-10,000 format-adjusted value score. It blends production, projected role, positional scarcity, roster situation, market consensus, and this league format. It is updated when you refresh league data.' },
                    { term: 'Production Layer', def: 'Recent fantasy scoring, usage, playing time, and efficiency establish the floor. Current-season roles matter more in redraft, while multi-year stability carries more weight in dynasty.' },
                    { term: 'Context Layer', def: 'Team, depth chart, scoring settings, lineup slots, and replacement level adjust the raw player value. A scarce starter can gain value even if his box-score profile is similar to a deeper position.' },
                    { term: 'Market Layer', def: 'Market consensus, rank movement, roster ownership, and trade behavior help keep the number from becoming only a projection model. DHQ is meant to reflect what a player is worth in the room.' },
                ]},
                { cat: 'How To Read DHQ', items: [
                    { term: 'Elite Player', def: '7000+ ' + skinValueShort + ' or a top-5 positional rank across the league. These are anchor assets; losing one usually changes the direction of a roster or trade package.' },
                    { term: 'Starter Band', def: 'Roughly 3500-6999 ' + skinValueShort + ' is the weekly starter and premium depth range. Compare players inside the same position and format before treating two numbers as equal.' },
                    { term: 'Depth Band', def: 'Roughly 1000-3499 ' + skinValueShort + ' usually means usable depth, upside bench pieces, short-term streamers, or rookies/prospects who still need the role to arrive.' },
                    { term: 'Replacement Band', def: 'Below 1000 ' + skinValueShort + ' is usually waiver-wire, injury stash, speculative bench, or low-certainty IDP depth. The name can still matter, but the number is warning you not to overpay.' },
                ]},
                { cat: 'What Moves DHQ', items: [
                    { term: 'Role Change', def: 'Depth-chart promotion, target share, route participation, snap share, injury replacement, or defensive alignment changes can move value quickly.' },
                    { term: 'Age And Window', def: skinShowsAgeCurve ? 'Age curve matters because dynasty value prices future seasons. RB declines usually hit earlier than WR/TE, and QB value can stay durable much longer.' : 'Age still matters, but redraft weights this season much more heavily than long-term decline. Role and weekly ceiling should beat distant age-curve concerns.' },
                    { term: 'Risk', def: 'Injury status, volatile usage, unstable quarterback play, committee backfields, defensive rotation, suspension risk, and contract uncertainty all pressure the value down.' },
                    { term: 'Format', def: 'PPR, TE premium, Superflex, IDP, kicker, D/ST, lineup depth, and bench size all change replacement level. DHQ should be read through this league, not as a universal player rank.' },
                ]},
                { cat: 'What DHQ Is Not', items: [
                    { term: 'Not A Projection Only', def: 'A player can project well this week and still carry lower DHQ if the role is fragile, the market is thin, or the roster value is hard to trade later.' },
                    { term: 'Not A Trade Price Alone', def: 'Trade offers also depend on partner needs, owner behavior, leverage, timing, and package shape. DHQ is the value anchor, not the whole negotiation.' },
                    { term: 'Not A Blind Sort', def: 'Use DHQ to build a shortlist, then check position need, tier breaks, lineup rules, health, and roster construction. The best move is often the best tier fit, not just the highest number.' },
                ]},
                { cat: 'Team Assessment', items: [
                    { term: 'Health Score', def: 'Your team\u2019s competitive readiness on a 0-100 scale. 60% is based on your optimal starting lineup strength, 40% on positional depth and coverage. 90+ = Elite tier, 80+ = Contender, 70+ = Crossroads.' },
                    { term: 'Contender Rank', def: 'How you stack up for winning THIS season. Based on your best possible starting lineup PPG compared to every other team in the league.' },
                    { term: rankTerm, def: skinShowsDynastyValue ? 'Your long-term foundation strength. Based on total ' + skinValueShort + ' value across your entire roster - starters, bench, taxi, and picks.' : 'Your format-adjusted roster strength. Based on total ' + skinValueShort + ' value across your active roster context.' },
                    { term: windowTerm, def: skinShowsAgeCurve ? 'How many more years your roster can realistically compete before age-related decline forces a rebuild. Based on the age curves of your weakest position group.' : 'How ready your roster is for the current season format, without forcing a multi-year age-curve read.' },
                ]},
                { cat: 'Trading And Tools', items: [
                    { term: 'Owner DNA', def: 'A behavioral profile derived from each owner\u2019s trade history. Types include Fleecer, Stalwart, Dominator, Acceptor, and Desperate. It helps estimate how hard a deal will be to close.' },
                    { term: 'Trade Impact', def: 'Before you send a trade, see exactly how it changes your health score, elite count, positional leverage, and competitive tier. Simulates the roster swap and recalculates the team.' },
                    { term: 'Acceptance Likelihood', def: 'Predicted chance the other owner accepts your offer, based on value difference, their DNA type, positional needs, package shape, and owner behavior.' },
                    { term: 'Fit Score', def: 'How well a draft or waiver target fills your specific roster needs. A team thin at RB will see RB options scored higher than a team already overloaded there.' },
                    { term: 'Player Tags', def: 'Tag players as Trade Block, Cut, Untouchable, or Watch List. Tags sync between Dynasty HQ and Scout so your decisions carry across both apps.' },
                ]},
	            ];
	            if (module) {
	                return React.createElement('div', { style: { padding: '10px 16px 16px', maxWidth: '1280px', margin: '0 auto' } },
	                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '14px' } },
	                        ...quickItems.map(item => React.createElement('div', { key: item.term, style: { padding: '12px 13px', background: 'var(--black)', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.18))', borderRadius: '8px' } },
	                            React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-body)', marginBottom: '4px' } }, item.term),
	                            React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.45 } }, item.def)
	                        ))
	                    ),
	                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' } },
	                        ...fullItems.map(section => React.createElement('section', { key: section.cat, style: { padding: '13px 14px', background: 'var(--black)', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.18))', borderRadius: '8px' } },
	                            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', letterSpacing: '0.08em', marginBottom: '10px', textTransform: 'uppercase' } }, section.cat),
	                            ...section.items.map(item => React.createElement('div', { key: item.term, style: { marginBottom: '10px' } },
	                                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', fontWeight: 800, color: 'var(--white)', marginBottom: '2px' } }, item.term),
	                                React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.42 } }, item.def)
	                            ))
	                        ))
	                    )
	                );
	            }
	            return React.createElement('div', { style: { marginBottom: '8px' } },
                React.createElement('button', {
                    onClick: () => setOpen(!open),
                    style: { width: '100%', padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--gold)', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', letterSpacing: '0.03em', textAlign: 'left' },
                    onMouseEnter: e => { e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'; },
                    onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; }
                }, open ? '\u25BC' : '\u25B6', ' Legend'),
                open && React.createElement('div', { style: { padding: '8px 12px', maxHeight: '300px', overflowY: 'auto' } },
                    React.createElement('button', {
                        onClick: () => setExpanded(true),
                        style: { width: '100%', marginBottom: '10px', padding: '6px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '4px', color: 'var(--gold)', cursor: 'pointer' }
                    }, 'FULL GUIDE \u2192'),
                    ...quickItems.map(item => React.createElement('div', { key: item.term, style: { marginBottom: '8px' } },
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)' } }, item.term),
                        React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.4, marginTop: '1px' } }, item.def)
                    ))
                ),
                // Expanded modal overlay — theme-aware so it remains readable in light mode
                expanded && React.createElement('div', {
                    onClick: () => setExpanded(false),
                    style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }
                },
                    React.createElement('div', {
                        onClick: e => e.stopPropagation(),
                        style: { background: 'var(--off-black)', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '14px', width: '100%', maxWidth: '640px', maxHeight: '80vh', overflowY: 'auto', padding: '24px 28px' }
                    },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' } },
                            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.4rem', color: 'var(--gold)', letterSpacing: '0.06em' } }, 'DYNASTY HQ GUIDE'),
                            React.createElement('button', { onClick: () => setExpanded(false), style: { background: 'none', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: '1.2rem' } }, '\u2715')
                        ),
                        React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.4, marginBottom: '20px' } }, 'Dynasty HQ analyzes this league format to give you an edge in every decision - trades, drafts, waivers, and roster construction. Here\u2019s what every tool and metric means.'),
                        ...fullItems.map(section => React.createElement('div', { key: section.cat, style: { marginBottom: '20px' } },
                            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.06em', borderBottom: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', paddingBottom: '4px', marginBottom: '10px' } }, section.cat),
                            ...section.items.map(item => React.createElement('div', { key: item.term, style: { marginBottom: '12px' } },
                                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: 'var(--white)' } }, item.term),
                                React.createElement('div', { style: { fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.4, marginTop: '2px' } }, item.def)
                            ))
                        ))
                    )
                )
            );
        }

        // ── REACTIVE: when timeYear changes, refetch + recompute everything ──
        useEffect(() => {
            if (!basePlayersData || !Object.keys(basePlayersData).length) return;
            let cancelled = false;
            setTimeLoading(true);

            (async () => {
                try {
                    // 1. Fetch stats for selected year (historical has real data, future returns empty)
                    const newStats = await fetchSeasonStats(String(timeYear)).catch(() => ({}));
                    if (cancelled) return;

                    // 2. Update stats state
                    setStatsData(newStats);

                    // 3. Compute projected player data with age progression + DHQ projection
                    const delta = timeYear - currentSeason;
                    const baseLI = window.App?.LI;

                    // CRITICAL: always read from backup (original scores), never from potentially-projected current scores
                    if (baseLI && !baseLI._baseScoresBackup && baseLI.playerScores) {
                        baseLI._baseScoresBackup = { ...baseLI.playerScores };
                    }
                    const originalScores = baseLI?._baseScoresBackup || baseLI?.playerScores || {};

                    if (delta !== 0) {
                        // A. Build projected players with age advancement + projected DHQ as field
                        const projScores = {};
                        const projected = {};
                        Object.entries(basePlayersData).forEach(([pid, p]) => {
                            const baseAge = p.age || 0;
                            const projAge = baseAge ? baseAge + delta : 0;
                            const baseDhq = originalScores[pid] || 0;
                            // Only the scored players (a few hundred-thousand of the
                            // ~12k DB) need the per-year projection math + stats
                            // lookup. projectPlayerValue returns baseDhq unchanged
                            // when baseDhq <= 0, so skipping it for zero-score players
                            // is byte-identical while avoiding ~10k wasted passes per
                            // time-machine tick.
                            let projDhq;
                            if (baseDhq > 0) {
                                // Derive YoY trend from prevAvg vs seasonAvg when both are available
                                const pStats = window.S?.playerStats?.[pid];
                                const trendMeta = (() => {
                                    const prev = pStats?.prevAvg;
                                    const cur  = pStats?.seasonAvg;
                                    if (prev > 0 && cur > 0) return { trend: (cur - prev) / prev };
                                    return undefined;
                                })();
                                projDhq = projectPlayerValue(pid, baseDhq, baseAge, p.position || '', delta, trendMeta);
                            } else {
                                projDhq = baseDhq;
                            }
                            projScores[pid] = projDhq;
                            projected[pid] = {
                                ...p,
                                age: projAge || p.age,
                                _projected: true,
                                _baseDhq: baseDhq,
                                _projDhq: projDhq,
                                _delta: delta
                            };
                        });

                        // B. Update playersData state (triggers all child re-renders)
                        setPlayersData(projected);

                        // C. Write projected scores to LI.playerScores — THE source all modules read
                        if (baseLI) {
                            baseLI.playerScores = projScores;
                            baseLI._projectedYear = timeYear;

                            // Debug: log projections
                            if (typeof DEV_MODE !== 'undefined' && DEV_MODE) {
                                const samples = Object.entries(projScores).filter(([,v]) => v > 2000).sort((a,b) => b[1] - a[1]).slice(0, 5);
                                console.log('[TimeContext] Projected DHQ (delta=' + delta + '):');
                                samples.forEach(([pid, projDhq]) => {
                                    const bp = basePlayersData[pid];
                                    const bd = originalScores[pid] || 0;
                                    console.log('  ' + (bp?.full_name || pid) + ': age ' + (bp?.age||'?') + '\u2192' + ((bp?.age||0)+delta) + ', DHQ ' + bd + '\u2192' + projDhq + ' (' + (projDhq >= bd ? '+' : '') + (projDhq - bd) + ')');
                                });
                            }
                        }
                    } else {
                        // Restore base data — original ages and original DHQ scores
                        setPlayersData(basePlayersData);
                        if (baseLI && baseLI._baseScoresBackup) {
                            baseLI.playerScores = { ...baseLI._baseScoresBackup };
                            delete baseLI._projectedYear;
                        }
                    }

                    // D. Also override the dynastyValue() function's source for this render cycle
                    // dynastyValue reads from LI.playerScores which we just updated above.
                    // Clear assessTeamFromGlobal cache so health scores recompute with fresh data.
                    if (window.assessTeamFromGlobal?._cache) window.assessTeamFromGlobal._cache = {};
                    if (window.assessAllTeamsFromGlobal?._cache) window.assessAllTeamsFromGlobal._cache = {};
                    _dhqStarterSet = null; // rebuild DHQ starter set with refreshed values
                    if (window.S) {
                        window.S._timeContextTs = Date.now();
                    }

                    // 4. Update window.S (write-through cache for ReconAI bridge)
                    if (window.S) {
                        window.S.season = String(timeYear);
                        window.S.playerStats = {};
                        Object.entries(newStats).forEach(([pid, s]) => {
                            window.S.playerStats[pid] = {};
                            const pts = typeof calcRawPts === 'function' ? calcRawPts(s) : (s.pts_half_ppr || 0);
                            const gp = s.gp || 0;
                            window.S.playerStats[pid].prevTotal = pts ? Math.round(pts * 10) / 10 : 0;
                            window.S.playerStats[pid].prevAvg = gp > 0 ? Math.round(pts / gp * 10) / 10 : 0;
                            window.S.playerStats[pid].prevRawStats = s;
                        });
                        // Mirror to SeasonContext
                        setSeasonCtxData(prev => ({
                            ...prev,
                            season: String(timeYear),
                            playerStats: window.S.playerStats,
                            lastUpdated: Date.now(),
                        }));
                    }

                    // 5. Force analytics recompute
                    setAnalyticsData(null);

                    // 6. Force ranked teams recompute by bumping timestamp
                    setTimeRecomputeTs(Date.now());

                } catch(e) { console.warn('Time context data load error:', e); }
                if (!cancelled) setTimeLoading(false);
            })();

            return () => { cancelled = true; };
        }, [timeYear, basePlayersData]);

        // handleTimeYearChange is now just a setter — the effect does the work
        function handleTimeYearChange(year) {
            if (year === timeYear) return;
            setTimeYear(year);
            setActiveYear(String(year));
        }
        const [analyticsData, setAnalyticsData] = useState(null);
        const [analyticsTab, setAnalyticsTab] = useState('roster');
        const [rosterFilter, setRosterFilter] = useState('All');
        const [rosterSort, setRosterSort] = useState({ key: 'dhq', dir: 1 });
        const defaultRosterCols = ['pos','age','dhq','posRankLg','ppg','durability','peak','action','sos'];
        const [visibleCols, setVisibleCols] = useState(() => {
            const stored = LeagueStorage.get(LEAGUE_WR_KEYS.ROSTER_COLS);
            const legacyDefault = ['pos','age','dhq','ppg','trend','action'];
            if (Array.isArray(stored) && stored.length) {
                const wasLegacyDefault = stored.length === legacyDefault.length && stored.every((key, idx) => key === legacyDefault[idx]);
                return wasLegacyDefault ? defaultRosterCols : stored;
            }
            return defaultRosterCols;
        });
        const [showColPicker, setShowColPicker] = useState(false);
        const [colPreset, setColPreset] = useState('default');
        const [expandedPid, setExpandedPid] = useState(null);
        const [showAvatarPicker, setShowAvatarPicker] = useState(false);
        const [avatarKey, setAvatarKey] = useState(0); // force re-render when avatar changes
        const [welcomeMode, setWelcomeMode] = useState(false); // centered modal for first-time welcome
        const [showCornerToast, setShowCornerToast] = useState(false); // "I'll be down here" toast
        const [transactions, setTransactions] = useState([]);
        const [rankedTeams, setRankedTeams] = useState([]);
        const [dhqStatus, setDhqStatus] = useState({ loading: false, step: '', progress: 0 });
        const [loadStage, setLoadStage] = useState('');
        const [editingKpi, setEditingKpi] = useState(null); // index being edited, null = not editing
        const [leagueSelectedTeam, setLeagueSelectedTeam] = useState(null);
        const [leagueSort, setLeagueSort] = useState('health');
        const [leagueViewMode, setLeagueViewMode] = useState('roster');
        // Compare was promoted to its own top-level tab (js/tabs/compare.js) — it
        // owns its local compareTeamId state. myTeamView no longer needed now that
        // My Roster doesn't host a Compare sub-view.
        const [leagueViewTab, setLeagueViewTab] = useState('overview'); // top-level: overview | analyst
        const [leagueSubView, setLeagueSubView] = useState('teams'); // sub-tabs below the overview
        const [lpSort, setLpSort] = useState({ key: 'dhq', dir: 1 });
        const [lpFilter, setLpFilter] = useState('');
        const skinShowsDynastyValue = leagueSkin ? leagueSkin.features?.showDynastyValue !== false : true;
        const skinShowsAgeCurve = leagueSkin ? leagueSkin.features?.showAgeCurve !== false : true;
        const skinValueShort = leagueSkin?.vocabulary?.valueShortLabel || 'DHQ';
        const skinValueLabel = leagueSkin?.vocabulary?.valueLabel || 'DHQ Value';

        // Core KPI metadata — used by computeKpiValue and module widgets
        const KPI_OPTIONS = {
            'health-score':   { label: 'Health Score',    icon: '', category: 'Roster',   tip: 'Blended score: 60% scoring power (contender) + 40% position coverage. 90+=Elite, 80+=Contender, 70+=Crossroads' },
            'avg-age':        { label: skinValueShort + '-Wtd Age', icon: '', category: 'Roster', tip: skinValueShort + '-weighted average age. ' + (skinShowsAgeCurve ? 'Lower = longer roster window' : 'Useful context for short-term roster balance') },
            'elite-count':    { label: 'Elite Players',   icon: '', category: 'Roster',   tip: 'Players with 7000+ ' + skinValueShort + ' or a top-5 rank at their position league-wide. These are your cornerstone assets.' },
            'aging-cliff':    { label: 'Aging Cliff %',   icon: '', category: 'Roster',   tip: '% of ' + skinValueShort + ' held by players past their value window' },
            'bench-quality':  { label: 'Bench Quality',   icon: '', category: 'Roster',   tip: 'Average ' + skinValueShort + ' of non-starter roster players' },
            'contender-rank': { label: 'Contender Rank',  icon: '', category: 'League',   tip: 'Win-now rank based on optimal starting lineup PPG vs league. How competitive are you THIS season?' },
            'dynasty-rank':   { label: skinShowsDynastyValue ? 'Dynasty Rank' : 'Asset Rank', icon: '', category: 'League', tip: skinShowsDynastyValue ? 'Long-term rank based on total roster ' + skinValueShort + ' value. How strong is your dynasty foundation?' : 'Format-adjusted rank based on total roster value.' },
            'window':         { label: skinShowsAgeCurve ? 'Compete Window' : 'Season Window', icon: '', category: 'Projection', tip: skinShowsAgeCurve ? 'Estimated years your roster can compete based on age decay' : 'Current-season readiness based on format-adjusted roster context' },
            'hit-rate':       { label: 'Trade Win Rate',  icon: '', category: 'Trades',   tip: 'Percentage of trades where you gained value (won or fair)' },
            'net-trade':      { label: 'Net ' + skinValueShort + '/Trade', icon: '', category: 'Trades', tip: 'Average ' + skinValueShort + ' gained or lost per trade' },
            'trade-velocity': { label: 'Trade Velocity',  icon: '', category: 'Trades',   tip: 'Number of trades completed this season' },
            'pick-capital':   { label: 'Pick Capital',    icon: '', category: 'Draft',    tip: 'Total value of your draft picks across next 3 seasons. Includes traded picks.' },
            'draft-roi':      { label: 'Draft ROI',       icon: '', category: 'Draft',    tip: 'Current DHQ of drafted players vs capital spent' },
            'faab-efficiency':{ label: 'FAAB Remaining',  icon: '', category: 'Waivers',  tip: 'Remaining FAAB budget available for waiver claims' },
            'transaction-ticker': { label: 'Transaction Ticker', icon: '', category: 'League', sizes: ['md', 'lg'], tip: 'Recent league transactions: trades, waivers, and free agent moves' },
            'league-standings':   { label: 'League Standings',   icon: '', category: 'League', sizes: ['md', 'lg'], tip: 'Current league standings with W-L records and DHQ totals' },
        };
        // Curiosity-first default dashboard (new leagues only — existing users keep
        // their saved layout). The owner's own board (Jul 21 2026 screenshots)
        // is the featured first-load view — command brief + roster vitals down
        // the main column, live league feeds down the skinny side column:
        //   1. Intel Brief (tall)        — Alex's living brief + kickoff countdown
        //   2. Transaction Ticker (slim) — live adds/drops/trades side feed
        //   3. Power Rankings (narrow)   — full 16-team board, side column
        //   4. Roster Pulse (tall)       — health, elites, window, action plan
        //   5. Lineup Check (lg)         — points left on the bench this week
        //   6. League Calendar (lg)      — waivers → draft → playoffs agenda
        //   7. League Standings (narrow) — every team's record, side column
        //   8. Market Radar (sm)         — trade-target count card
        //   9. Cut Candidates (sm)       — drop-flag count card
        const DEFAULT_WIDGETS = [
            { id: 'dw0', key: 'intel-brief',    size: 'tall' },
            { id: 'dw1', key: 'transaction-ticker', size: 'slim' },
            { id: 'dw2', key: 'power-rankings', size: 'narrow' },
            { id: 'dw3', key: 'roster-pulse',   size: 'tall', primaryMetric: 'health-score' },
            { id: 'dw4', key: 'lineup-check',   size: 'lg' },
            { id: 'dw5', key: 'league-calendar', size: 'lg' },
            { id: 'dw6', key: 'league-standings', size: 'narrow' },
            { id: 'dw7', key: 'market-radar',   size: 'sm' },
            { id: 'dw8', key: 'cut-candidates', size: 'sm' },
        ];
        // Migrate legacy formats to current widget object format
        function migrateKpisToWidgets(stored) {
            if (!stored || !Array.isArray(stored)) return DEFAULT_WIDGETS;
            if (stored.length === 0) return DEFAULT_WIDGETS;
            let widgets;
            // Old format v1: array of KPI key strings
            if (typeof stored[0] === 'string') {
                const keyToModule = {
                    'health-score': 'roster', 'avg-age': 'roster', 'elite-count': 'roster',
                    'aging-cliff': 'roster', 'bench-quality': 'roster',
                    'contender-rank': 'competitive', 'dynasty-rank': 'competitive', 'window': 'competitive',
                    'hit-rate': 'trading', 'net-trade': 'trading', 'trade-velocity': 'trading',
                    'pick-capital': 'draft', 'draft-roi': 'draft',
                    'faab-efficiency': 'waivers',
                    'transaction-ticker': 'transaction-ticker',
                    'league-standings': 'league-standings',
                };
                widgets = stored.map((k, i) => ({ id: 'mig_' + i, key: keyToModule[k] || k, size: 'sm', primaryMetric: k }));
            } else {
	                // Old format v2: {key, size} without id or primaryMetric
	                widgets = stored.map((w, i) => {
	                    if (!w.id) w = { ...w, id: 'mig2_' + i };
	                    if (w.key === 'field-notes' && w.id === 'dw1' && w.size === 'narrow') {
	                        w = { ...w, size: 'slim' };
	                    }
	                    // Map old KPI keys to module keys
                    const legacyKpiModules = {
                        'health-score': 'roster', 'avg-age': 'roster', 'elite-count': 'roster',
                        'aging-cliff': 'roster', 'bench-quality': 'roster', 'portfolio': 'roster',
                        'top5-conc': 'roster', 'starter-gap': 'roster', 'roster-turnover': 'roster',
                        'sched-sos': 'roster',
                        'contender-rank': 'competitive', 'dynasty-rank': 'competitive', 'window': 'competitive',
                        'hit-rate': 'trading', 'net-trade': 'trading', 'trade-velocity': 'trading',
                        'trade-leverage': 'trading', 'partner-wr': 'trading',
                        'pick-capital': 'draft', 'draft-roi': 'draft',
                        'faab-efficiency': 'waivers',
                        'playoff-record': 'competitive', 'playoff-winpct': 'competitive',
                        'champ-appearances': 'competitive', 'dynasty-score': 'competitive',
                    };
                    if (legacyKpiModules[w.key]) {
                        return { ...w, primaryMetric: w.primaryMetric || w.key, key: legacyKpiModules[w.key] };
                    }
                    return w;
                });
            }
            // v3 migration: when the Brief tab was folded into Dashboard, existing
            // users lost their access point to Alex's briefing. Auto-prepend the
            // intelligence-brief widget once if it's not already in their layout.
            // Users who explicitly remove it will keep it removed (the new entry
            // will be persisted to storage by the useEffect below).
            if (!widgets.some(w => w.key === 'intel-brief' || w.key === 'intelligence-brief')) {
                widgets = [{ id: 'mig3_brief', key: 'intel-brief', size: 'xl' }, ...widgets];
            }
            return widgets;
        }
        const [selectedWidgets, setSelectedWidgets] = useState(() =>
            migrateKpisToWidgets(LeagueStorage.get(LEAGUE_WR_KEYS.KPI_SELECTION(currentLeague?.id || ''))) || DEFAULT_WIDGETS
        );
        useEffect(() => {
            LeagueStorage.set(LEAGUE_WR_KEYS.KPI_SELECTION(currentLeague?.id || ''), selectedWidgets);
        }, [selectedWidgets]);

        useEffect(() => {
            LeagueStorage.set(LEAGUE_WR_KEYS.ROSTER_COLS, visibleCols);
        }, [visibleCols]);

        function computeKpiValue(kpiKey) {
            const LI = window.App?.LI || {};
            const scores = LI.playerScores || {};
            const myPlayers = myRoster?.players || [];
            const profile = LI.ownerProfiles?.[myRoster?.roster_id];
            switch(kpiKey) {
                case 'contender-rank': {
                    // PPG-based rank — how competitive are you right now?
                    const league2 = currentLeague;
                    const rp = league2?.roster_positions || [];
                    const ppgRanks = (league2.rosters || []).map(r => {
                        const ppg = typeof window.App?.calcOptimalPPG === 'function'
                            ? window.App.calcOptimalPPG(r.players || [], playersData, window.S?.playerStats || {}, rp)
                            : 0;
                        return { rid: r.roster_id, ppg };
                    }).sort((a, b) => b.ppg - a.ppg);
                    // Offseason fallback: if all PPGs are 0, estimate from DHQ values
                    if (ppgRanks.every(r => r.ppg === 0)) {
                        ppgRanks.forEach(r => {
                            const roster = (currentLeague.rosters || []).find(ros => ros.roster_id === r.rid);
                            const totalDHQ = (roster?.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0);
                            r.ppg = Math.round(totalDHQ / 550); // Same fallback as health score
                        });
                        ppgRanks.sort((a, b) => b.ppg - a.ppg);
                    }
                    const myPPG = ppgRanks.find(r => r.rid === myRoster?.roster_id)?.ppg || 0;
                    const cRank = ppgRanks.findIndex(r => r.rid === myRoster?.roster_id) + 1;
                    const allPPGs = ppgRanks.map(r => r.ppg).sort((a, b) => a - b);
                    return { value: '#' + (cRank || '?') + '/' + standings.length, sub: myPPG > 0 ? 'Win-now rank by ' + myPPG.toFixed(1) + ' PPG' : 'Win-now rank by starter PPG', color: cRank <= 3 ? 'var(--k-2ecc71, #2ecc71)' : cRank <= 6 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)', sparkData: allPPGs };
                }
                case 'dynasty-rank': {
                    // Total DHQ rank — long-term dynasty strength (players + pick capital)
                    const dVals = (currentLeague.rosters || []).map(r => {
                        const playerDHQ = (r.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0);
                        // Add pick capital value
                        let pickDHQ = 0;
                        {
                            const totalTeams = (currentLeague.rosters || []).length || 16;
                            const draftRounds = currentLeague.settings?.draft_rounds || 5;
                            const leagueSeason = parseInt(currentLeague.season) || new Date().getFullYear();
                            for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                                for (let rd = 1; rd <= draftRounds; rd++) {
                                    const pv = typeof getIndustryPickValue === 'function' ? getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds) : window.App.PlayerValue?.getPickValue?.(yr, rd, totalTeams) ?? 0;
                                    const tradedAway = (window.S?.tradedPicks || []).find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === r.roster_id && p.owner_id !== r.roster_id);
                                    if (!tradedAway) pickDHQ += pv;
                                    const acquired = (window.S?.tradedPicks || []).filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === r.roster_id && p.roster_id !== r.roster_id);
                                    acquired.forEach(() => { pickDHQ += pv; });
                                }
                            }
                        }
                        return { rid: r.roster_id, total: playerDHQ + pickDHQ };
                    }).sort((a, b) => b.total - a.total);
                    const myDTotal = dVals.find(r => r.rid === myRoster?.roster_id)?.total || 0;
                    const dRank = dVals.findIndex(r => r.rid === myRoster?.roster_id) + 1;
                    const allDVals = dVals.map(r => r.total).sort((a, b) => a - b);
                    return { value: '#' + (dRank || '?') + '/' + standings.length, sub: myDTotal > 0 ? Math.round(myDTotal / 1000) + 'K total assets' : 'Dynasty rank', color: dRank <= 3 ? 'var(--k-2ecc71, #2ecc71)' : dRank <= 6 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)', sparkData: allDVals };
                }
                case 'portfolio': {
                    const total = myPlayers.reduce((s, pid) => s + (scores[pid] || 0), 0);
                    // Spark: all team totals for league comparison
                    const allTotals = (currentLeague.rosters || []).map(r => (r.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0)).sort((a,b) => a-b);
                    return { value: total.toLocaleString(), sub: 'Total DHQ', color: 'var(--gold)', sparkData: allTotals };
                }
                case 'health-score': {
                    const ranked = rankedTeams.find(t => t.userId === sleeperUserId);
                    const hs = ranked?.healthScore || 0;
                    const allHS = rankedTeams.map(t => t.healthScore || 0).sort((a,b) => a-b);
                    return { value: hs || '\u2014', sub: 'Score', color: hs >= 90 ? 'var(--k-d4af37, #d4af37)' : hs >= 80 ? 'var(--k-2ecc71, #2ecc71)' : hs >= 70 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)', sparkData: allHS };
                }
                case 'starter-gap': {
                    const analytics = analyticsData || (typeof runLeagueAnalytics === 'function' ? runLeagueAnalytics() : null);
                    const gap = analytics?.roster?.gaps?.find(g => g.severity === 'high') || analytics?.roster?.gaps?.[0];
                    if (gap) {
                        const area = gap.area || 'Unknown';
                        const delta = typeof gap.delta === 'number' ? (gap.delta > 0 ? '+' : '') + gap.delta.toFixed(gap.delta < 1 ? 2 : 0) : gap.delta;
                        return { value: delta, sub: area + ' (' + gap.severity + ')', color: gap.severity === 'high' ? 'var(--k-e74c3c, #e74c3c)' : 'var(--k-f0a500, #f0a500)' };
                    }
                    return { value: '\u2714', sub: 'No major gaps', color: 'var(--k-2ecc71, #2ecc71)' };
                }
                case 'avg-age': {
                    if (!myPlayers.length) return { value: '\u2014', sub: 'Avg age', color: 'var(--silver)' };
                    const totalDhq = myPlayers.reduce((s, pid) => s + (scores[pid] || 1), 0);
                    const weightedAge = myPlayers.reduce((s, pid) => s + ((playersData[pid]?.age || 26) * (scores[pid] || 1)), 0);
                    const avg = totalDhq > 0 ? weightedAge / totalDhq : 26;
                    return { value: avg.toFixed(1), sub: 'Avg age', color: avg <= 25 ? 'var(--k-2ecc71, #2ecc71)' : avg <= 27 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'top5-conc': {
                    const vals = myPlayers.map(pid => scores[pid] || 0).sort((a,b) => b - a);
                    const total = vals.reduce((s,v) => s + v, 0);
                    const top5 = vals.slice(0, 5).reduce((s,v) => s + v, 0);
                    const pct = total > 0 ? Math.round(top5 / total * 100) : 0;
                    return { value: pct + '%', sub: 'In top 5 players', color: pct >= 65 ? 'var(--k-e74c3c, #e74c3c)' : pct >= 50 ? 'var(--gold)' : 'var(--k-2ecc71, #2ecc71)' };
                }
                case 'hit-rate': {
                    if (!profile || !profile.trades) return { value: '\u2014', sub: 'Trade win rate', color: 'var(--silver)' };
                    const total = (profile.tradesWon || 0) + (profile.tradesLost || 0) + (profile.tradesFair || 0);
                    const rate = total > 0 ? Math.round(((profile.tradesWon || 0) + (profile.tradesFair || 0)) / total * 100) : 0;
                    return { value: rate + '%', sub: 'Win/fair rate', color: rate >= 60 ? 'var(--k-2ecc71, #2ecc71)' : rate >= 40 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'faab-efficiency': {
                    const budget = myRoster?.settings?.waiver_budget || 0;
                    const spent = myRoster?.settings?.waiver_budget_used || 0;
                    if (!budget) return { value: '\u2014', sub: 'No FAAB', color: 'var(--silver)' };
                    const remaining = budget - spent;
                    return { value: '$' + remaining, sub: '$' + budget + ' budget', color: remaining > budget * 0.5 ? 'var(--k-2ecc71, #2ecc71)' : remaining > budget * 0.25 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'net-trade': {
                    if (!profile) return { value: '\u2014', sub: 'Net DHQ/trade', color: 'var(--silver)' };
                    const avg = profile.avgValueDiff || 0;
                    return { value: (avg >= 0 ? '+' : '') + Math.round(avg), sub: 'Avg per trade', color: avg >= 100 ? 'var(--k-2ecc71, #2ecc71)' : avg >= 0 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'trade-velocity': {
                    if (!profile) return { value: '\u2014', sub: 'Trades', color: 'var(--silver)' };
                    return { value: profile.trades || 0, sub: 'Total trades', color: (profile.trades || 0) >= 4 ? 'var(--k-2ecc71, #2ecc71)' : (profile.trades || 0) >= 2 ? 'var(--gold)' : 'var(--silver)' };
                }
                case 'window': {
                    if (!myPlayers.length) return { value: '\u2014', sub: 'Window', color: 'var(--silver)' };
                    const rp = currentLeague?.roster_positions || [];
                    const posWindows = {};
                    const windowStarters = myRoster?.starters || [];
                    windowStarters.forEach(pid => {
                        if (!pid || pid === '0') return;
                        const p = playersData[pid];
                        if (!p) return;
                        const pos = p.position;
                        const nPos = pos === 'DE' || pos === 'DT' ? 'DL' : pos === 'CB' || pos === 'S' ? 'DB' : pos === 'OLB' || pos === 'ILB' ? 'LB' : pos;
                        const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
                            ? window.App.getValueWindowEnd(nPos)
                            : ((window.App.peakWindows || {})[nPos] || [24, 29])[1];
                        const yrsLeft = Math.max(0, valueEnd - (p.age || 25));
                        if (!posWindows[nPos]) posWindows[nPos] = [];
                        posWindows[nPos].push(yrsLeft);
                    });
                    let minWindow = 99;
                    Object.entries(posWindows).forEach(([pos, yrs]) => {
                        if (yrs.length > 0) {
                            const avg = yrs.reduce((s, y) => s + y, 0) / yrs.length;
                            if (avg < minWindow) minWindow = avg;
                        }
                    });
                    const windowYrs = minWindow === 99 ? 0 : Math.round(minWindow);
                    return { value: windowYrs > 0 ? windowYrs + 'yr' : 'Closed', sub: 'Weakest position group', color: windowYrs >= 5 ? 'var(--k-2ecc71, #2ecc71)' : windowYrs >= 2 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'aging-cliff': {
                    const total = myPlayers.reduce((s, pid) => s + (scores[pid] || 0), 0);
                    const pastPeak = myPlayers.reduce((s, pid) => {
                        const p = playersData[pid]; if (!p) return s;
                        const pos = p.position; const age = p.age || 26;
                        const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
                            ? window.App.getValueWindowEnd(pos)
                            : ((window.App.peakWindows || {})[pos] || [24, 29])[1];
                        return age > valueEnd ? s + (scores[pid] || 0) : s;
                    }, 0);
                    const pct = total > 0 ? Math.round(pastPeak / total * 100) : 0;
                    return { value: pct + '%', sub: 'Past value DHQ', color: pct <= 20 ? 'var(--k-2ecc71, #2ecc71)' : pct <= 35 ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'partner-wr': {
                    if (!profile || !profile.tradesWon) return { value: '\u2014', sub: 'Partner W/R', color: 'var(--silver)' };
                    const total = (profile.tradesWon || 0) + (profile.tradesLost || 0);
                    return { value: (profile.tradesWon || 0) + '-' + (profile.tradesLost || 0), sub: 'Trade W-L', color: (profile.tradesWon || 0) > (profile.tradesLost || 0) ? 'var(--k-2ecc71, #2ecc71)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'elite-count': {
                    if (typeof window.App?.countElitePlayers === 'function') {
                        const elites = window.App.countElitePlayers(myPlayers);
                        return { value: elites + ' elite' + (elites !== 1 ? 's' : ''), sub: '7000+ or top 5 pos', color: elites >= 3 ? 'var(--k-2ecc71, #2ecc71)' : elites >= 1 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                    }
                    // Elite = 7000+ DHQ or top 5 at their position league-wide
                    const posRanks = {};
                    (currentLeague.rosters || []).forEach(r => (r.players || []).forEach(pid => {
                        const pos = playersData[pid]?.position;
                        const nPos2 = pos === 'DE' || pos === 'DT' ? 'DL' : pos === 'CB' || pos === 'S' ? 'DB' : pos === 'OLB' || pos === 'ILB' ? 'LB' : pos;
                        if (!posRanks[nPos2]) posRanks[nPos2] = [];
                        posRanks[nPos2].push({ pid: String(pid), dhq: scores[pid] || 0 });
                    }));
                    Object.values(posRanks).forEach(arr => arr.sort((a, b) => b.dhq - a.dhq));
                    const myPidSet = new Set(myPlayers.map(String));
                    const elitePidSet = new Set();
                    let elites = 0;
                    Object.values(posRanks).forEach(arr => {
                        arr.slice(0, 5).forEach(p => { if (myPidSet.has(p.pid)) elitePidSet.add(p.pid); });
                    });
                    myPlayers.forEach(pid => {
                        const id = String(pid);
                        if ((scores[pid] || scores[id] || 0) >= 7000) elitePidSet.add(id);
                    });
                    elites = elitePidSet.size;
                    return { value: elites + ' elite' + (elites !== 1 ? 's' : ''), sub: '7000+ or top 5 pos', color: elites >= 3 ? 'var(--k-2ecc71, #2ecc71)' : elites >= 1 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'bench-quality': {
                    const starters = new Set(myRoster?.starters || []);
                    const benchVals = myPlayers.filter(pid => !starters.has(pid)).map(pid => scores[pid] || 0);
                    const avg = benchVals.length ? Math.round(benchVals.reduce((s,v) => s + v, 0) / benchVals.length) : 0;
                    return { value: avg.toLocaleString(), sub: 'Avg bench DHQ', color: avg >= 2500 ? 'var(--k-2ecc71, #2ecc71)' : avg >= 1500 ? 'var(--gold)' : 'var(--silver)' };
                }
                case 'playoff-record': {
                    const brackets = window.App?.LI?.bracketData || {};
                    const rec = window.WrHistory?.playoffRecord;
                    let pw = 0, pl = 0;
                    Object.values(brackets).forEach(({ winners }) => {
                        if (!winners?.length || !myRoster) return;
                        const r = rec ? rec(winners, myRoster.roster_id) : { w: 0, l: 0 };
                        pw += r.w; pl += r.l;
                    });
                    return { value: pw + '-' + pl, sub: 'Playoff W-L', color: pw > pl ? 'var(--k-2ecc71, #2ecc71)' : pw < pl ? 'var(--k-e74c3c, #e74c3c)' : 'var(--silver)' };
                }
                case 'playoff-winpct': {
                    const brackets2 = window.App?.LI?.bracketData || {};
                    const rec2 = window.WrHistory?.playoffRecord;
                    let pw2 = 0, pl2 = 0;
                    Object.values(brackets2).forEach(({ winners }) => {
                        if (!winners?.length || !myRoster) return;
                        const r = rec2 ? rec2(winners, myRoster.roster_id) : { w: 0, l: 0 };
                        pw2 += r.w; pl2 += r.l;
                    });
                    const total = pw2 + pl2;
                    const pct = total > 0 ? Math.round(pw2 / total * 100) : 0;
                    return { value: pct + '%', sub: 'Win rate (' + total + ' games)', color: pct >= 60 ? 'var(--k-2ecc71, #2ecc71)' : pct >= 40 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'champ-appearances': {
                    const champs2 = window.App?.LI?.championships || {};
                    const apps = Object.values(champs2).filter(c => c.champion === myRoster?.roster_id || c.runnerUp === myRoster?.roster_id).length;
                    return { value: apps, sub: 'Finals appearances', color: apps > 0 ? 'var(--k-d4af37, #d4af37)' : 'var(--silver)' };
                }
                case 'dynasty-score': {
                    const champs3 = window.App?.LI?.championships || {};
                    const brackets3 = window.App?.LI?.bracketData || {};
                    let titles = 0, runners = 0, playoffApps = 0;
                    Object.values(champs3).forEach(c => {
                        if (c.champion === myRoster?.roster_id) titles++;
                        if (c.runnerUp === myRoster?.roster_id) runners++;
                        if (c.champion === myRoster?.roster_id || c.runnerUp === myRoster?.roster_id || (c.semiFinals||[]).includes(myRoster?.roster_id)) playoffApps++;
                    });
                    const score = titles * 3 + runners + playoffApps;
                    return { value: score, sub: titles + ' titles, ' + runners + ' runner-ups', color: score >= 5 ? 'var(--k-d4af37, #d4af37)' : score >= 2 ? 'var(--k-2ecc71, #2ecc71)' : 'var(--silver)' };
                }
                case 'draft-roi': {
                    const profile3 = window.App?.LI?.ownerProfiles?.[myRoster?.roster_id];
                    const draftPicks = (window.App?.LI?.draftOutcomes || []).filter(d => d.roster_id === myRoster?.roster_id);
                    const hits = draftPicks.filter(d => d.isStarter).length;
                    const total = draftPicks.length;
                    const rate = total > 0 ? Math.round(hits / total * 100) : 0;
                    return { value: rate + '%', sub: hits + '/' + total + ' became starters', color: rate >= 50 ? 'var(--k-2ecc71, #2ecc71)' : rate >= 30 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'roster-turnover': {
                    const profile4 = window.App?.LI?.ownerProfiles?.[myRoster?.roster_id];
                    const trades = profile4?.trades || 0;
                    return { value: trades, sub: 'Trades this cycle', color: trades >= 5 ? 'var(--k-2ecc71, #2ecc71)' : trades >= 2 ? 'var(--gold)' : 'var(--silver)' };
                }
                case 'pick-capital': {
                    let totalPickValue = 0;
                    let pickCount = 0;
                    const totalTeams = (currentLeague.rosters || []).length || 16;
                    const draftRounds = currentLeague.settings?.draft_rounds || 5;
                    const leagueSeason = parseInt(currentLeague.season) || new Date().getFullYear();
                    const tp = window.S?.tradedPicks || [];
                    for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                        for (let rd = 1; rd <= draftRounds; rd++) {
                            const tradedAway = tp.find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === myRoster?.roster_id && p.owner_id !== myRoster?.roster_id);
                            if (!tradedAway) {
                                totalPickValue += typeof getIndustryPickValue === 'function' ? getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds) : window.App.PlayerValue?.getPickValue?.(yr, rd, totalTeams) ?? 0;
                                pickCount++;
                            }
                            const acquired = tp.filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === myRoster?.roster_id && p.roster_id !== myRoster?.roster_id);
                            acquired.forEach(() => {
                                totalPickValue += typeof getIndustryPickValue === 'function' ? getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds) : window.App.PlayerValue?.getPickValue?.(yr, rd, totalTeams) ?? 0;
                                pickCount++;
                            });
                        }
                    }
                    return { value: totalPickValue > 0 ? Math.round(totalPickValue / 1000) + 'K' : '\u2014', sub: pickCount + ' picks over 3 years', color: totalPickValue >= 20000 ? 'var(--k-2ecc71, #2ecc71)' : totalPickValue >= 10000 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'trade-leverage': {
                    const assess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
                    const myStrengths = assess?.strengths || [];
                    let leverageCount = 0;
                    (currentLeague.rosters || []).forEach(r => {
                        if (r.roster_id === myRoster?.roster_id) return;
                        const theirAssess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(r.roster_id) : null;
                        const theirNeeds = (theirAssess?.needs || []).map(n => n.pos);
                        if (myStrengths.some(s => theirNeeds.includes(s))) leverageCount++;
                    });
                    return { value: leverageCount, sub: leverageCount + ' teams need your surplus', color: leverageCount >= 6 ? 'var(--k-2ecc71, #2ecc71)' : leverageCount >= 3 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)' };
                }
                case 'sched-sos': {
                    const sosMod = window.App?.SOS;
                    if (!sosMod?.ready) return { value: '\u2014', sub: 'Loading SOS\u2026', color: 'var(--silver)' };
                    const starters = myRoster?.starters || [];
                    const teamSOS = sosMod.getTeamSOS(starters, playersData);
                    if (!teamSOS) return { value: '\u2014', sub: 'No SOS data', color: 'var(--silver)' };
                    // sparkData: all teams' avg ranks for comparison
                    const sparkData = (currentLeague.rosters || []).map(r => {
                        const sos = sosMod.getTeamSOS(r.starters || [], playersData);
                        return sos?.avgRank || 16;
                    }).sort((a, b) => a - b);
                    return {
                        value: teamSOS.avgRank,
                        sub: teamSOS.label + ' schedule (avg rank)',
                        color: teamSOS.color,
                        sparkData,
                    };
                }
                default: return { value: '\u2014', sub: '', color: 'var(--silver)' };
            }
        }
        const [reconPanelOpen, setReconPanelOpen] = useState(false);
        const [reconExpanded, setReconExpanded] = useState(false);
        // PhoneDock "Ask Alex" bar: after the sheet opens, best-effort focus
        // of the chat composer input (ref attached below). iOS may keep the
        // keyboard down — programmatic focus outside the original tap
        // gesture doesn't reliably raise it — so opening the sheet alone is
        // the guaranteed behavior; the focus is a progressive enhancement.
        const reconComposerRef = useRef(null);
        const reconComposerFocusPending = useRef(false);
        useEffect(() => {
            if (reconPanelOpen && reconComposerFocusPending.current) {
                reconComposerFocusPending.current = false;
                try { reconComposerRef.current && reconComposerRef.current.focus(); } catch (_) { /* no-op */ }
            }
        }, [reconPanelOpen]);
        // ── Phone tier (≤767): the Alex chat renders as a full-width bottom
        // sheet in all three modes (welcome / docked / expanded). Desktop and
        // tablet keep the exact pre-existing floating-panel styles.
        // WR.useViewport = js/shared/viewport.js (loaded before this file).
        const alexVp = window.WR.useViewport();
        const alexPhone = alexVp.isPhone;
        // Keyboard lift: px gap reported by visualViewport while the iOS
        // keyboard is up (0 when closed / off-phone). The sheet's bottom is
        // offset by this so the composer stays visible above the keyboard.
        const alexKb = (alexPhone && alexVp.kbOpen) ? alexVp.kbHeight : 0;
        // Shared height cap for the phone sheet: dynamic viewport minus
        // keyboard, notch (--sat) and an 8px top gap.
        const alexSheetCap = 'calc(100dvh - ' + alexKb + 'px - var(--sat, 0px) - 8px)';
        const [showNotifications, setShowNotifications] = useState(false);
        // showAlerts removed — alerts now live on Brief tab
        const [briefDraftInfo, setBriefDraftInfo] = useState(null);
        const [sidebarOpen, setSidebarOpen] = useState(false);
        // One-row phone header (owner ruling 2026-07-09): title + SWITCH only;
        // the badges/draft-clock/refresh demote into this sheet. The compact
        // header (and the hamburger removal that rides with it) engages only
        // while the sheet primitive is actually live, so a kit-load failure
        // falls back to the stacked header + hamburger instead of stranding nav.
        const [phHdrSheetOpen, setPhHdrSheetOpen] = useState(false);
        const phoneHdrKit = alexPhone && !!(window.WR && window.WR.Sheet);
        const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
            try { return localStorage.getItem('wr_sidebar_collapsed') === '1'; } catch (_) { return false; }
        });
        const iconSrc = ((window.location.pathname || '').includes('/dist-preview/') ? '../' : '') + 'icon-192.png';
        useEffect(() => {
            try { localStorage.setItem('wr_sidebar_collapsed', sidebarCollapsed ? '1' : '0'); } catch (_) {}
        }, [sidebarCollapsed]);
        const [gmStrategyOpen, setGmStrategyOpen] = useState(false);
        // Expose for cross-module access (draft-room "Edit GM Strategy" button)
        window._wrSetActiveTab = setActiveTab;
        window._wrSetGmStrategyOpen = setGmStrategyOpen;
        const getCurrentLeagueId = (lg) => lg?.league_id || lg?.id;
        const GM_STRATEGY_DEFAULT = { mode: 'compete', riskTolerance: 'moderate', positionalNeeds: {}, untouchable: [], targets: [], notes: '' };
        const readSharedGmStrategy = (leagueId) => {
            try {
                if (!localStorage.getItem('dhq_gm_strategy_v1')) return null;
                return window.GMStrategy?.getStrategy?.(leagueId) || null;
            } catch (_) {
                return null;
            }
        };
        const normalizeGmStrategy = (strategy, leagueId) => {
            const normalize = window.WR?.GmMode?.normalize || ((mode) => mode || 'compete');
            return {
                ...GM_STRATEGY_DEFAULT,
                ...(strategy || {}),
                mode: normalize(strategy?.mode || GM_STRATEGY_DEFAULT.mode),
                leagueId,
            };
        };
        const loadGmStrategy = (leagueId) => {
            const saved = readSharedGmStrategy(leagueId)
                || LeagueStorage.get(LEAGUE_WR_KEYS.GM_STRATEGY(leagueId))
                || GM_STRATEGY_DEFAULT;
            return normalizeGmStrategy(saved, leagueId);
        };
        const [gmStrategy, setGmStrategy] = useState(() =>
            loadGmStrategy(getCurrentLeagueId(currentLeague))
        );
        const gmStrategyInitRef = useRef(true);
        const gmStrategyLeagueRef = useRef(getCurrentLeagueId(currentLeague));
        useEffect(() => {
            const leagueId = getCurrentLeagueId(currentLeague);
            if (!leagueId || String(gmStrategyLeagueRef.current || '') === String(leagueId)) return;
            const next = loadGmStrategy(leagueId);
            gmStrategyLeagueRef.current = leagueId;
            gmStrategyInitRef.current = true;
            window._wrGmStrategy = next;
            setGmStrategy(next);
        }, [currentLeague?.league_id, currentLeague?.id]);
        useEffect(() => {
            const leagueId = getCurrentLeagueId(currentLeague);
            if (leagueId) {
                const normalized = normalizeGmStrategy(gmStrategy, leagueId);
                LeagueStorage.set(LEAGUE_WR_KEYS.GM_STRATEGY(leagueId), normalized);
                // Expose to window for AI context
                window._wrGmStrategy = normalized;
                // Log deliberate updates (skip initial load)
                if (gmStrategyInitRef.current) { gmStrategyInitRef.current = false; }
                else { window.wrLogAction?.('\uD83D\uDCCA', 'Updated GM strategy', 'roster', { actionType: 'gm-strategy' }); }
            }
        }, [gmStrategy, currentLeague?.league_id, currentLeague?.id]);
        // Remote/Scout strategy edits arrive as wr:gm-mode-changed (gm-mode.js
        // bridges DhqEvents 'strategy:changed'). Adopt them into local gmStrategy
        // state \u2014 which feeds the header GM badge + Alex AI context \u2014 when they
        // target the open league. JSON-compare guards the echo: the persist
        // effect above re-saves on every set, so identical payloads must no-op.
        useEffect(() => {
            const onGmChanged = (e) => {
                const s = e?.detail?.strategy;
                if (!s || typeof s !== 'object') return;
                const leagueId = getCurrentLeagueId(currentLeague);
                if (!leagueId) return;
                if (s.leagueId != null && String(s.leagueId) !== String(leagueId)) return;
                const next = normalizeGmStrategy(s, leagueId);
                if (JSON.stringify(normalizeGmStrategy(gmStrategy, leagueId)) === JSON.stringify(next)) return;
                // Synced-in change, not a deliberate local edit \u2014 skip the action log.
                gmStrategyInitRef.current = true;
                setGmStrategy(next);
            };
            window.addEventListener('wr:gm-mode-changed', onGmChanged);
            return () => window.removeEventListener('wr:gm-mode-changed', onGmChanged);
        }, [gmStrategy, currentLeague?.league_id, currentLeague?.id]);

        // Fetch draft info for Brief tab (Sleeper only — other platforms don't have this endpoint)
        useEffect(() => {
            if (!isSleeper) return;
            if (!currentLeague?.id && !currentLeague?.league_id) return;
            fetch('https://api.sleeper.app/v1/league/' + (currentLeague.league_id || currentLeague.id) + '/drafts')
                .then(r => r.ok ? r.json() : [])
                .then(drafts => {
                    const upcoming = drafts.find(d => d.status === 'pre_draft') || drafts[0];
                    if (upcoming) setBriefDraftInfo(upcoming);
                })
                .catch(err => window.wrLog('flashBrief.draftFetch', err));
        }, [currentLeague, isSleeper]);

        // Auto-generate notifications from league data
        const notifications = useMemo(() => {
            const notes = [];
            const txnsRaw = window.S?.transactions || {};
            const txns = Array.isArray(txnsRaw) ? txnsRaw : Object.values(txnsRaw).flat();
            const myPids = new Set(myRoster?.players || []);

            // Players on my roster that are trending down
            txns.filter(t => t.type === 'free_agent' || t.type === 'waiver').forEach(t => {
                const drops = Object.keys(t.drops || {});
                drops.forEach(pid => {
                    if (myPids.has(pid)) {
                        notes.push({ type: 'warn', text: (playersData[pid]?.full_name || pid) + ' was dropped by another team', time: t.created });
                    }
                });
                const adds = Object.keys(t.adds || {});
                adds.forEach(pid => {
                    const dhq = window.App?.LI?.playerScores?.[pid] || 0;
                    if (dhq > 3000 && !myPids.has(pid)) {
                        notes.push({ type: 'info', text: (playersData[pid]?.full_name || pid) + ' (' + dhq.toLocaleString() + ' DHQ) was picked up', time: t.created });
                    }
                });
            });

            // Trades involving my position needs
            txns.filter(t => t.type === 'trade').slice(0, 5).forEach(t => {
                const rids = t.roster_ids || [];
                if (rids.includes(myRoster?.roster_id)) {
                    notes.push({ type: 'trade', text: 'You completed a trade', time: t.created });
                }
            });

            return notes.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 10);
        }, [playersData, myRoster]);
        // GM Onboarding wizard state
        const gmIsUnconfigured = gmStrategy.mode === 'balanced' && !(gmStrategy.untouchable?.length) && !gmStrategy.notes && !(gmStrategy.targets?.length);
        const [gmOnboardStep, setGmOnboardStep] = useState(0); // 0=not started, 1-4=steps, 5=done
        const [reconMessages, setReconMessages] = useState(() => {
            const saved = LeagueStorage.get(LEAGUE_WR_KEYS.CHAT(currentLeague?.league_id));
            return (Array.isArray(saved) && saved.length > 1) ? saved
                : [{ role: 'assistant', content: 'Ask me anything about your league, team, or players.' }];
        });
        const [reconInput, setReconInput] = useState('');

        useEffect(() => {
            if (activeTab === 'analytics' && !analyticsData && window.App?.LI_LOADED) {
                const data = typeof runLeagueAnalytics === 'function' ? runLeagueAnalytics() : null;
                setAnalyticsData(data);
            }
        }, [activeTab, analyticsData, timeRecomputeTs]);

        // Keyboard shortcut: Cmd/Ctrl+K to toggle ReconAI panel
        useEffect(() => {
          const handler = e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
              e.preventDefault();
              setReconPanelOpen(prev => !prev);
            }
          };
          window.addEventListener('keydown', handler);
          return () => window.removeEventListener('keydown', handler);
        }, []);

        useEffect(() => {
          window.__WR_SCROLL_FALLBACK_ACTIVE = true;
          window.addEventListener('wheel', rerouteWheelToPage, { passive: false, capture: true });
          return () => window.removeEventListener('wheel', rerouteWheelToPage, { capture: true });
        }, []);

        // First-time welcome — auto-open chat with Alex's intro
        useEffect(() => {
          if (!myRoster?.players?.length || !currentLeague?.league_id) return;
          const welcomeKey = LEAGUE_WR_KEYS.WELCOMED(currentLeague.league_id);
          if (LeagueStorage.get(welcomeKey)) return;
          LeagueStorage.set(welcomeKey, '1');
          // Small delay so the app finishes rendering first
          const t = setTimeout(async () => {
            if (window.App?.AssistantTutorial?.isActive?.()) return;
            if (window.WR_TUTORIAL_CONFIG && window.App?.AssistantTutorial?.shouldShow) {
              try {
                if (await window.App.AssistantTutorial.shouldShow(window.WR_TUTORIAL_CONFIG)) return;
              } catch (e) { window.wrLog?.('welcome.tutorialCheck', e); }
            }
            setWelcomeMode(true);
            setReconPanelOpen(true);
            setReconMessages([{
              role: 'assistant',
              // Phase 10/1: strategy is now driven by GM Mode (header badge + GM's Office),
              // not a per-chat prompt. Welcome copy references the persistent badge instead.
              content: 'Hey! I\'m **Alex Ingram** — your AI General Manager. I\'ll be sitting in the war room with you, analyzing your roster, scouting trade targets, and helping you build a dynasty.\n\nA few things to get us started:\n\n' +
                '\u2022 **Ask me anything** — trades, waivers, draft strategy, player analysis\n' +
                '\u2022 **Your GM Mode** (top of every page) already tells me whether we\'re rebuilding, competing, or winning now — change it anytime in GM\'s Office\n\n' +
                'Let\'s get to work. What\'s on your mind? \u2014 Alex',
              onboardChoices: [
                { label: 'What should I do?', value: 'advice' },
                { label: 'Pick Alex\'s look', value: 'avatar' }
              ]
            }]);
            setGmOnboardStep(0); // reset so strategy onboarding can trigger next
          }, 1500);
          return () => clearTimeout(t);
        }, [myRoster?.players?.length, currentLeague?.league_id]);

        // Handle welcome choices — exit welcome mode, show corner toast
        function handleWelcomeChoice(value) {
          setWelcomeMode(false);
          if (value === 'strategy') {
            setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined })),
              { role: 'user', content: 'Set my strategy' }
            ]);
            startGmOnboarding();
          } else if (value === 'advice') {
            setReconMessages(prev => prev.map(m => ({ ...m, onboardChoices: undefined })));
            sendReconMessage('What are the top 3 moves I should make right now?');
          } else if (value === 'avatar') {
            setReconMessages(prev => prev.map(m => ({ ...m, onboardChoices: undefined })));
            setShowAvatarPicker(true);
          }
          // Show "I'll be down here" toast after transition
          if (value !== 'strategy' && value !== 'advice') {
            setReconPanelOpen(false);
            setTimeout(() => {
              setShowCornerToast(true);
              setTimeout(() => setShowCornerToast(false), 4000);
            }, 300);
          }
        }

        // Auto-trigger GM onboarding when panel opens with unconfigured strategy
        // Phase 10/1: auto-triggered in-chat GM strategy onboarding removed.
        // Strategy is now configured via the persistent GM Mode badge + GM's Office.
        // Leaving startGmOnboarding() callable via the dead 'strategy' welcome-choice branch
        // as a safety net in case any legacy link still passes value='strategy'.

        // Persist chat messages to localStorage (cap at 20 messages)
        useEffect(() => {
          if (!currentLeague?.league_id || reconMessages.length <= 1) return;
          // Don't persist if last message is loading indicator
          const last = reconMessages[reconMessages.length - 1];
          if (last?.content === '...') return;
          const toSave = reconMessages.slice(-20).map(m => ({ role: m.role, content: m.content }));
          LeagueStorage.set(LEAGUE_WR_KEYS.CHAT(currentLeague.league_id), toSave);
        }, [reconMessages, currentLeague?.league_id]);

        // Compute power rankings when DHQ engine finishes or standings change
        useEffect(() => {
            if (!standings.length) return;
            function computeRankings() {
                // Use assessAllTeamsFromGlobal (batch) for consistency with League Map view
                const allAssess = (typeof window.assessAllTeamsFromGlobal === 'function' ? window.assessAllTeamsFromGlobal() : []);
                const assessMap = {};
                allAssess.forEach(a => { if (a?.rosterId) assessMap[a.rosterId] = a; });
                const ranked = standings.map(t => {
                    const r = currentLeague.rosters.find(r => r.owner_id === t.userId);
                    let healthScore = 0;
                    let powerScore = 0;
                    let tierColor = 'var(--silver)';
                    const assessment = r ? assessMap[r.roster_id] : null;
                    // Prefer the engine's total DHQ so rank order matches powerRank exactly.
                    const totalDHQ = (assessment && assessment.totalDHQ != null)
                        ? assessment.totalDHQ
                        : (r?.players?.reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0) || 0);
                    let powerRank = 0;
                    if (assessment) {
                        healthScore = assessment.healthScore || 0;
                        powerScore = assessment.powerScore || 0;
                        powerRank = assessment.powerRank || 0;
                        const tier = (assessment.tier || '').toUpperCase();
                        tierColor = tier === 'ELITE' ? 'var(--k-d4af37, #d4af37)' : tier === 'CONTENDER' ? 'var(--k-2ecc71, #2ecc71)' : tier === 'CROSSROADS' ? 'var(--k-f0a500, #f0a500)' : tier === 'REBUILDING' ? 'var(--k-e74c3c, #e74c3c)' : 'var(--silver)';
                    }
                    return { ...t, rosterId: r?.roster_id, totalDHQ, healthScore, powerScore, powerRank, tierColor };
                }).sort((a,b) => {
                    // Order by the engine's powerRank DIRECTLY (not a re-sort of
                    // powerScore) so the brief's "you're Nth" is byte-identical to
                    // the widget, elites badge, and Alex — a private re-sort can
                    // drift by one when a team's data hasn't landed yet. Teams
                    // with no rank yet sort last; powerScore/id only break ties.
                    const ar = a.powerRank || 9999, br = b.powerRank || 9999;
                    if (ar !== br) return ar - br;
                    if (b.powerScore !== a.powerScore) return b.powerScore - a.powerScore;
                    return String(a.rosterId ?? '').localeCompare(String(b.rosterId ?? ''));
                });
                setRankedTeams(ranked);
            }
            // Always compute immediately (shows DHQ-based values if LI loaded, zeros if not)
            computeRankings();
            // If LI hasn't loaded yet, poll until it does and recompute with real health scores
            if (!window.App?.LI_LOADED) {
                const interval = setInterval(() => {
                    if (window.App?.LI_LOADED) { computeRankings(); clearInterval(interval); }
                }, 1500);
                // Safety: also recompute after a short delay in case LI loaded between render and effect
                const timeout = setTimeout(() => { if (window.App?.LI_LOADED) computeRankings(); }, 500);
                return () => { clearInterval(interval); clearTimeout(timeout); };
            }
        }, [standings, currentLeague, timeRecomputeTs, statsData]);

        // ── Sync freshness (audit:refresh-stale step 7) ──
        // wr:data-synced (dispatched by WR.Sync after each successful background
        // revalidation) bumps syncedAt; the 60s tick keeps the sidebar's
        // 'Synced Xm ago' readout aging even when nothing else re-renders.
        const [syncedAt, setSyncedAt] = useState(() => window.WR?.Sync?.lastSyncedAt || null);
        const [, setSyncTick] = useState(0);
        useEffect(() => {
            const onSynced = (e) => setSyncedAt(e?.detail?.at || Date.now());
            window.addEventListener('wr:data-synced', onSynced);
            const tick = setInterval(() => setSyncTick(t => t + 1), 60000);
            return () => { window.removeEventListener('wr:data-synced', onSynced); clearInterval(tick); };
        }, []);

        // Monotonic load token — a new full load (league switch / manual
        // refresh) invalidates any in-flight background revalidation from the
        // previous load (same idea as the _wppFetchToken guard below).
        const loadSeqRef = useRef(0);
        // Last successful rolling weekly-points fetch (league-tagged). The block
        // fires up to 18 parallel /matchups/{week} requests — background
        // revalidations only re-run it when the week rolled or this is stale.
        const wppFetchedAtRef = useRef({ ts: 0, leagueId: null });
        // League closed / component unmounted: drop the background revalidator
        // so WR.Sync stops syncing a dead closure (also resets its lastSyncedAt).
        // Also bump loadSeqRef so any ALREADY in-flight background hydrate fails
        // its token check and can't apply into a re-pointed window.S.
        useEffect(() => () => {
            loadSeqRef.current++;
            window.WR?.Sync?.registerRevalidator?.(null);
        }, []);

        useEffect(() => {
            loadLeagueDetails();
        }, [currentLeague]);

        async function loadLeagueDetails() {
            // New full load supersedes any in-flight background revalidation.
            const loadSeq = ++loadSeqRef.current;
            try {
                // Clear assessment caches for THIS league so health scores compute fresh.
                // Key by league ID — switching back to a previously-loaded league can
                // reuse its cache if the underlying data hasn't changed.
                const leagueKey = currentLeague.league_id || currentLeague.id || '';
                if (window.assessTeamFromGlobal?._cache) {
                    // Only clear entries for the current league, not all leagues
                    const cache = window.assessTeamFromGlobal._cache;
                    Object.keys(cache).forEach(k => { if (k.startsWith(leagueKey + '_') || !k.includes('_')) delete cache[k]; });
                }
                if (window.assessAllTeamsFromGlobal?._cache) {
                    window.assessAllTeamsFromGlobal._cache[leagueKey] = null;
                }

                if (!currentLeague.rosters || !currentLeague.users) {
                    throw new Error('League missing roster or user data');
                }

                const myRosterData = currentLeague._mfl && currentLeague._mflFranchiseId
                    ? currentLeague.rosters.find(r => r.roster_id === currentLeague._mflFranchiseId)
                    : currentLeague.rosters.find(r => r.owner_id === sleeperUserId);
                setMyRoster(myRosterData);

                // Compute standings immediately (no fetch needed)
                const standingsData = currentLeague.rosters.map(roster => {
                    const user = currentLeague.users.find(u => u.user_id === roster.owner_id);
                    return {
                        rosterId: roster.roster_id,
                        userId: roster.owner_id,
                        displayName: user?.display_name || user?.username || 'Unknown',
                        avatar: user?.avatar,
                        teamName: roster.metadata?.team_name || user?.metadata?.team_name || '',
                        wins: roster.settings?.wins || 0,
                        losses: roster.settings?.losses || 0,
                        ties: roster.settings?.ties || 0,
                        pointsFor: roster.settings?.fpts || 0,
                        division: roster.settings?.division || 0
                    };
                }).sort((a, b) => {
                    if (b.wins !== a.wins) return b.wins - a.wins;
                    if (a.losses !== b.losses) return a.losses - b.losses;
                    return b.pointsFor - a.pointsFor;
                });
                setStandings(standingsData);

                // Show dashboard immediately with what we have
                setLoading(false);
                setLoadStage('Loading player data...');

                // ── Unified platform provider pipeline ──────────────────
                // Replaces the old _isSleeper ? A : B branching. Each of the
                // four platforms (sleeper/mfl/espn/yahoo) implements the
                // same hydrate() contract — see shared/platform-provider.js.
                const provider = resolvePlatformProvider(currentLeague);
                if (!provider) {
                    const platform = currentLeague?._platform
                        || (currentLeague?._mfl ? 'mfl' : currentLeague?._espn ? 'espn' : currentLeague?._yahoo ? 'yahoo' : 'sleeper');
                    throw new Error('No ' + platform + ' platform provider loaded. Reload the page and try again.');
                }
                setLoadStage('Loading ' + provider.displayName + ' data...');

                // Pre-fetch two things ALL providers need as hydrate context:
                //   1. The Sleeper player DB — source of truth for player
                //      names, positions, teams. Non-Sleeper platforms use
                //      this to build their crosswalk to resolve native IDs
                //      to Sleeper IDs.
                //   2. NFL state — gives us the current week, needed for
                //      bucketing transactions and fetching matchups.
                const [sleeperPlayers, nflState] = await Promise.all([
                    fetchAllPlayers().catch(() => ({})),
                    fetchJSON(`${SLEEPER_BASE_URL}/state/nfl`).catch(() => ({})),
                ]);
                const currentWeek = nflState?.display_week || nflState?.week || (currentLeague.settings?.leg || 1);

                // Hydrate the league through the provider — single call
                // that replaces the old per-platform fetch pipelines.
                const hydrated = await provider.hydrate(currentLeague, {
                    sleeperPlayers,
                    currentWeek,
                    currentSeason: currentLeague.season || activeYear,
                    prevSeason: STATS_YEAR,
                    nflState,
                });

                applyHydrated(hydrated, { provider, sleeperPlayers, nflState, currentWeek, myRosterData, background: false });

                // Register the background revalidator (audit:refresh-stale step 4).
                // WR.Sync calls it on tab return / focus / in-season interval:
                // re-hydrate with the memoized player DB + a FRESH nfl state, then
                // re-apply. Stale-while-revalidate — background syncs never clear
                // or reload LI (values keep their own 8h/manual cadence) and never
                // touch loading/loadStage. loadSeq mirrors the _wppFetchToken
                // pattern: a league switch or manual refresh invalidates any
                // in-flight background sync from the previous load.
                if (window.WR?.Sync?.registerRevalidator) {
                    const bgLeagueId = currentLeague.id || currentLeague.league_id;
                    window.WR.Sync.registerRevalidator(async () => {
                        if (loadSeq !== loadSeqRef.current) return;
                        const [bgPlayers, bgStateRaw] = await Promise.all([
                            fetchAllPlayers().catch(() => sleeperPlayers),                 // memoized player DB
                            fetchJSON(`${SLEEPER_BASE_URL}/state/nfl`).catch(() => ({})),  // always fresh — week-rollover source
                        ]);
                        const bgNfl = (bgStateRaw && Object.keys(bgStateRaw).length) ? bgStateRaw : (window.S?.nflState || nflState);
                        const bgWeek = bgNfl?.display_week || bgNfl?.week || window.S?.currentWeek || currentWeek;
                        const bgHydrated = await provider.hydrate(currentLeague, {
                            sleeperPlayers: bgPlayers,
                            currentWeek: bgWeek,
                            currentSeason: currentLeague.season || activeYear,
                            prevSeason: STATS_YEAR,
                            nflState: bgNfl,
                        });
                        if (loadSeq !== loadSeqRef.current) return;
                        if (window.S?.currentLeagueId && String(window.S.currentLeagueId) !== String(bgLeagueId)) return;
                        // Integrity gate (background only): hydrate's inner fetches
                        // degrade to {}/[] on failure, so a network blip could
                        // otherwise overwrite live on-screen data with empties and
                        // still count as a successful sync. If core datasets came
                        // back empty while the current state has them, THROW so
                        // WR.Sync.refresh records a failed sync (lastSyncedAt stays
                        // honest) and the stale-but-real data stays up.
                        const _bgRosters = bgHydrated?.rosters || [];
                        const _bgUsers = bgHydrated?.leagueUsers || [];
                        const _haveRosters = !!(window.S?.rosters?.length || currentLeague.rosters?.length);
                        const _haveUsers = !!(window.S?.leagueUsers?.length || currentLeague.users?.length);
                        if ((_haveRosters && !_bgRosters.length) || (_haveUsers && !_bgUsers.length)) {
                            throw new Error('Background revalidation returned empty rosters/users — keeping current data');
                        }
                        applyHydrated(bgHydrated, { provider, sleeperPlayers: bgPlayers, nflState: bgNfl, currentWeek: bgWeek, myRosterData, background: true });
                    });
                }

                // Paint the dashboard shell before DHQ starts, then await DHQ.
                // This lets React commit the initial render (standings, rosters,
                // nav) while DHQ computes — user sees the page immediately, then
                // DHQ values populate once loadLeagueIntel finishes.
                setLoadStage('');
                // Yield to the browser so the render commits before DHQ blocks
                await new Promise(r => setTimeout(r, 0));

                if (typeof window.App?.loadLeagueIntel === 'function' && !window.App.LI_LOADED) {
                    setDhqStatus({ loading: true, step: 'Analyzing league history...', progress: 20 });
                    try {
                        await window.App.loadLeagueIntel();
                        console.log('[War Room] DHQ engine loaded:', Object.keys(window.App.LI?.playerScores || {}).length, 'players valued');
                        _dhqStarterSet = null; // rebuild with freshly-loaded DHQ values
                        installStarterReqCorrection(); // QB:2 requirement + DHQ-based starter counts
                        setDhqStatus({ loading: false, step: 'Complete!', progress: 100 });
                        setStatsData(prev => ({ ...prev })); // force re-render
                        setTimeRecomputeTs(Date.now()); // refresh KPIs and rankings
                    } catch (e) {
                        console.warn('[War Room] DHQ engine error:', e);
                        setDhqStatus({ loading: false, step: 'Error: ' + e.message, progress: 0 });
                    }
                }

                // Ensure the assessor correction is installed even when intel was
                // already loaded on a prior mount/league switch (block above is
                // skipped when LI_LOADED is already true). Idempotent.
                installStarterReqCorrection();

                // Load rookie prospect data from enrichment CSVs (fire-and-forget)
                if (typeof window.loadRookieProspects === 'function') {
                    window.loadRookieProspects().then(cache => {
                        console.log('[War Room] Rookie enrichment loaded:', cache?.count || 0, 'prospects');
                        setTimeRecomputeTs(Date.now()); // refresh to show enriched data
                    }).catch(e => console.warn('[War Room] Rookie data load failed:', e));
                }

                // Load player tags (syncs with ReconAI)
                if (window.OD?.loadPlayerTags) {
                    window.OD.loadPlayerTags(currentLeague.id || currentLeague.league_id).then(tags => {
                        window._playerTags = tags || {};
                        setTimeRecomputeTs(Date.now()); // force re-render to show tags
                    }).catch(err => window.wrLog('tags.load', err));
                }

                // Show tutorial for first-time users only while they are still on Home.
                if (typeof window.startWRTutorial === 'function') {
                    setTimeout(async () => {
                        const hashTab = new URLSearchParams((window.location.hash || '').replace(/^#/, '')).get('tab') || 'dashboard';
                        if (hashTab !== 'dashboard') return;
                        if (window.App?.AssistantTutorial?.isActive?.()) return;
                        if (window.WR_TUTORIAL_CONFIG && typeof window.shouldShowWRTutorial === 'function') {
                            try {
                                if (!await window.shouldShowWRTutorial()) return;
                            } catch (e) { window.wrLog?.('tutorial.shouldShow', e); }
                        }
                        window.startWRTutorial();
                    }, 1000);
                }

                // Load league docs context for commissioner mode (fire-and-forget)
                if (window.OD?.getLeagueDocsContext) {
                    window.OD.getLeagueDocsContext(currentLeague.id || currentLeague.league_id).then(ctx => {
                        if (ctx) window._leagueDocsContext = ctx;
                    }).catch(() => {});
                }

            } catch (err) {
                console.error('Failed to load league details:', err);
                setError(err.message || 'Failed to load league details');
                setLoading(false);
                setLoadStage('');
            }
        }

        // ── applyHydrated (audit:refresh-stale step 4) ──────────────────
        // Commits a provider.hydrate() result to React state + the window.S
        // bridge. Shared by the full loadLeagueDetails path and the WR.Sync
        // background revalidator. background:true = stale-while-revalidate
        // refresh: skips the load-stage UI and NEVER touches LeagueIntel —
        // rosters/matchups/transactions stay fresh while DHQ values keep
        // their own 8h/manual cadence. Errors propagate to the caller
        // (loadLeagueDetails' catch sets the error UI; WR.Sync logs).
        function applyHydrated(hydrated, { provider, sleeperPlayers, nflState, currentWeek, myRosterData, background = false }) {
            // Pull enrichment out of _extras (Sleeper only — others empty)
            const stats       = hydrated._extras?.stats       || {};
            const projections = hydrated._extras?.projections || {};
            const prevStats   = hydrated._extras?.prevStats   || {};

            // Merge platform-specific extras into the Sleeper player DB.
            // For Sleeper this is a no-op; for MFL/ESPN/Yahoo this adds
            // IDP players and other platform-only records that the
            // Sleeper DB doesn't have.
            const players = { ...sleeperPlayers, ...(hydrated.players || {}) };

            // Use the hydrated rosters — for non-Sleeper, these now have
            // Sleeper-resolved player IDs (the whole point of the
            // provider rebuild step). For Sleeper, these are the fresh
            // fetchRosters result.
            const rosters     = (hydrated.rosters && hydrated.rosters.length) ? hydrated.rosters : (currentLeague.rosters || []);
            const leagueUsers = (hydrated.leagueUsers && hydrated.leagueUsers.length) ? hydrated.leagueUsers : (currentLeague.users || []);
            const tradedPicks = hydrated.tradedPicks || [];
            const matchupsData = hydrated.matchups || [];

            // Patch currentLeague in place so downstream useEffects
            // (computeRankings etc.) see the resolved rosters. React
            // won't re-render from this mutation, but setStatsData /
            // setSeasonCtxData below trigger re-renders anyway.
            currentLeague.rosters = rosters;
            if (leagueUsers.length) currentLeague.users = leagueUsers;

            // Re-resolve myRosterData now that rosters may have changed
            const freshMyRoster = provider.id === 'mfl' && currentLeague._mflFranchiseId
                ? rosters.find(r => r.roster_id === currentLeague._mflFranchiseId)
                : rosters.find(r => r.owner_id === sleeperUserId) || myRosterData;
            if (freshMyRoster && freshMyRoster !== myRosterData) setMyRoster(freshMyRoster);
            const myRoster = freshMyRoster || myRosterData;

            setStatsData(stats);
            setProjectionsData(projections);
            setStats2025Data(prevStats);
            setPlayersData(players);
            if (!background) setLoadStage('Computing values...');

            // Bridge to DHQ engine immediately
            if (window.App) {
                if (!window.S) window.S = {};
                // Week rollover (audit:refresh-stale step 5): S.currentWeek is
                // captured at league open; when a background sync sees a new NFL
                // week we bump timeRecomputeTs below so PlayerValue._ros (keyed
                // on week) invalidates and rankings/analytics recompute.
                const weekRolled = background && window.S.currentWeek != null && currentWeek !== window.S.currentWeek;
                window.S.players = players;
                window.S.playerStats = {};
                window.S.rosters = rosters;
                window.S.leagueUsers = leagueUsers;
                window.S.leagues = [{ league_id: currentLeague.id, name: currentLeague.name, scoring_settings: currentLeague.scoring_settings, roster_positions: currentLeague.roster_positions, settings: currentLeague.settings }];
                // Invalidate any previously-loaded weekly points from a different
                // league before kicking off the fresh fetch below.
                if (window.S.weeklyPlayerPointsLeagueId && window.S.weeklyPlayerPointsLeagueId !== currentLeague.id) {
                    window.S.weeklyPlayerPoints = {};
                    window.S.weeklyPlayerPointsLeagueId = null;
                }
                window.S.currentLeagueId = currentLeague.id;
                window.S.season = activeYear;
                window.S.nflState = hydrated.nflState && Object.keys(hydrated.nflState).length ? hydrated.nflState : nflState;
                window.S.currentWeek = currentWeek;
                window.S.tradedPicks = window.App?.normalizeTradedPicks
                    ? window.App.normalizeTradedPicks(rosters, tradedPicks)
                    : tradedPicks;
                window.S.matchups = matchupsData;
                window.S.drafts = hydrated.drafts || [];
                // MFL: complete future-pick ownership (exact years/rounds) so the
                // Trade Center shows real future picks, not invented N-round sets.
                window.S._mflFuturePicks = hydrated._extras?.mflFuturePicks || null;

                // Rolling PPG — fetch all played weeks' matchups in parallel
                // so we can compute last-N-games PPG for each player. Runs
                // in the background; consumers listen for wr:weekly-points-loaded.
                // Only runs for Sleeper (other providers don't have this endpoint shape).
                // Single-flight + league-tagged: rapidly switching leagues must not
                // let a stale fetch from league A overwrite league B's results.
                const _wppLeagueId = currentLeague.id || currentLeague.league_id;
                // Background syncs (~5min focus cadence): skip the 18-fetch
                // weekly-points reload unless the week rolled or the last
                // successful fetch for THIS league is older than ~15 minutes.
                // Foreground (league open / manual refresh) always runs.
                const _wppFresh = wppFetchedAtRef.current.leagueId === _wppLeagueId
                    && (Date.now() - wppFetchedAtRef.current.ts) < 15 * 60 * 1000;
                const _wppSkipBg = background && !weekRolled && _wppFresh;
                if (provider.id === 'sleeper' && _wppLeagueId && currentWeek > 0 && !_wppSkipBg) {
                    const fetchToken = (window._wppFetchToken = (window._wppFetchToken || 0) + 1);
                    const fetchLeagueId = _wppLeagueId;
                    (async () => {
                        try {
                            const weeks = [];
                            const maxWeek = Math.min(18, Math.max(1, currentWeek));
                            for (let w = 1; w <= maxWeek; w++) weeks.push(w);
                            const results = await Promise.all(weeks.map(w =>
                                fetch('https://api.sleeper.app/v1/league/' + fetchLeagueId + '/matchups/' + w)
                                    .then(r => r.ok ? r.json() : [])
                                    .catch(() => [])
                            ));
                            // Guard: abort if a newer fetch has started or the
                            // active league has changed under us.
                            if (fetchToken !== window._wppFetchToken) return;
                            const activeLeagueId = window.S?.currentLeagueId;
                            if (activeLeagueId && activeLeagueId !== fetchLeagueId) return;
                            const wpp = {};
                            weeks.forEach((w, i) => {
                                const wk = {};
                                (results[i] || []).forEach(m => {
                                    if (m && m.players_points) {
                                        Object.entries(m.players_points).forEach(([pid, pts]) => {
                                            if (pts != null) wk[pid] = pts;
                                        });
                                    }
                                });
                                wpp[w] = wk;
                            });
                            window.S.weeklyPlayerPoints = wpp;
                            window.S.weeklyPlayerPointsLeagueId = fetchLeagueId;
                            wppFetchedAtRef.current = { ts: Date.now(), leagueId: fetchLeagueId };
                            window.dispatchEvent(new CustomEvent('wr:weekly-points-loaded', { detail: { leagueId: fetchLeagueId } }));
                        } catch (e) { /* non-fatal */ }
                    })();
                }
                window.S.myRosterId = myRoster?.roster_id;
                window.S.platform = provider.id;   // canonical marker
                const _isNonSleeper = provider.id !== 'sleeper';
                window.S.myUserId = _isNonSleeper
                    ? (myRoster?.owner_id || currentLeague._mflFranchiseId || sleeperUserId)
                    : sleeperUserId;
                const _userId = window.S.myUserId;
                const _userName = _isNonSleeper ? (myRoster?._owner_name || 'Owner') : (sleeperUsername || '');
                window.S.user = { user_id: _userId, display_name: _userName, username: _userName };

                // Bridge helper functions for dhq-ai.js context builders
                const _p = players || {};
                window.myR = () => (window.S.rosters || []).find(r => r.roster_id === window.S.myRosterId);
                window.pName = pid => _p[pid]?.full_name || pid;
                window.pPos = pid => _p[pid]?.position || '';
                window.pAge = pid => _p[pid]?.age || 0;
                window.pM = pos => { if (['DE','DT'].includes(pos)) return 'DL'; if (['CB','S','FS','SS'].includes(pos)) return 'DB'; if (['OLB','ILB','MLB'].includes(pos)) return 'LB'; return pos; };
                window.dynastyValue = pid => window.App?.LI?.playerScores?.[pid] || 0;
                window.getFAAB = () => {
                    const league = window.S.leagues?.[0];
                    const my = window.myR();
                    const isFAAB = (league?.settings?.waiver_type === 2) || (league?.settings?.waiver_budget > 0);
                    const budget = isFAAB ? (league?.settings?.waiver_budget || 0) : 0;
                    const spent = my?.settings?.waiver_budget_used || 0;
                    const minBid = isFAAB ? (league?.settings?.waiver_budget_min ?? 0) : 0;
                    return { budget, spent, remaining: Math.max(0, budget - spent), isFAAB, minBid };
                };
                window.loadMentality = () => {
                    const gm = window._wrGmStrategy || {};
                    const modeMap = { contend: 'winnow', rebuild: 'rebuild', balanced: 'balanced' };
                    return { mentality: modeMap[gm.mode] || 'balanced', neverDrop: (gm.untouchable || []).map(pid => _p[pid]?.full_name || pid).join(', '), notes: gm.notes || '' };
                };
                window.App.myR = window.myR;
                window.App.pName = window.pName;
                window.App.pPos = window.pPos;
                window.App.pAge = window.pAge;
                window.App.pM = window.pM;
                window.App.dynastyValue = window.dynastyValue;
                window.App.getFAAB = window.getFAAB;
                window.App.loadMentality = window.loadMentality;

                // Rolling PPG helper — returns avg points over the last N
                // games where the player actually played (> minPts threshold).
                // Uses window.S.weeklyPlayerPoints populated by the background
                // weekly fetch above. Returns 0 if no data yet.
                window.App.computeRollingPPG = function (pid, lastN, minPts) {
                    const wpp = window.S?.weeklyPlayerPoints || {};
                    const weeks = Object.keys(wpp).map(Number).sort((a, b) => b - a);
                    const threshold = minPts == null ? 0.1 : minPts;
                    const games = [];
                    for (const w of weeks) {
                        const pts = wpp[w]?.[pid];
                        if (pts != null && pts >= threshold) {
                            games.push(pts);
                            if (games.length >= (lastN || 5)) break;
                        }
                    }
                    if (!games.length) return 0;
                    return +(games.reduce((a, b) => a + b, 0) / games.length).toFixed(1);
                };

                // BYO keys are session-only; migrate and clear older localStorage keys.
                ['dynastyhq_ai_provider', 'dynastyhq_ai_key', 'dynastyhq_ai_model', 'dynastyhq_xai_key', 'dynastyhq_provider', 'dynastyhq_gemini_key', 'dynastyhq_anthropic_key'].forEach(name => {
                    try {
                        const value = localStorage.getItem(name);
                        if (value && !sessionStorage.getItem(name)) sessionStorage.setItem(name, value);
                        localStorage.removeItem(name);
                    } catch (_) {}
                });
                const savedProvider = sessionStorage.getItem('dynastyhq_ai_provider') || sessionStorage.getItem('dynastyhq_provider') || 'gemini';
                const savedKey = sessionStorage.getItem('dynastyhq_ai_key') || sessionStorage.getItem('dynastyhq_' + savedProvider + '_key') || sessionStorage.getItem('dynastyhq_gemini_key') || sessionStorage.getItem('dynastyhq_anthropic_key') || '';
                if (savedKey) { window.S.aiProvider = savedProvider; window.S.apiKey = savedKey; }

                // Bridge stats data — use prevStats (2025) as base, overlay current season
                Object.entries(prevStats).forEach(([pid, s]) => {
                    if (!window.S.playerStats[pid]) window.S.playerStats[pid] = {};
                    const pts = calcRawPts(s);
                    const gp = s.gp || 0;
                    window.S.playerStats[pid].prevTotal = pts ? Math.round(pts * 10) / 10 : 0;
                    window.S.playerStats[pid].prevAvg = gp > 0 ? Math.round(pts / gp * 10) / 10 : 0;
                    window.S.playerStats[pid].prevRawStats = s;
                });
                // Overlay current season stats if available
                Object.entries(stats).forEach(([pid, s]) => {
                    if (!window.S.playerStats[pid]) window.S.playerStats[pid] = {};
                    const pts = calcRawPts(s);
                    const gp = s.gp || 0;
                    if (gp > 0) {
                        window.S.playerStats[pid].seasonTotal = pts ? Math.round(pts * 10) / 10 : 0;
                        window.S.playerStats[pid].seasonAvg = Math.round(pts / gp * 10) / 10;
                    }
                });

                // Mirror to SeasonContext so tab components can use React state
                setSeasonCtxData({
                    season: activeYear,
                    playerStats: window.S.playerStats,
                    tradedPicks: tradedPicks || [],
                    rosters: currentLeague.rosters || [],
                    myRosterId: myRosterData?.roster_id || null,
                    lastUpdated: Date.now(),
                });

                if (weekRolled) setTimeRecomputeTs(Date.now());
            }

            if (!background) setLoadStage('Building league intelligence...');

            // Flatten hydrated transactions (already bucketed by week
            // from the provider) and merge in DHQ historical trades.
            // This replaces the old per-platform transaction fetch.
            let allTxns = [];
            Object.values(hydrated.transactions || {}).forEach(wk => {
                allTxns = allTxns.concat(wk || []);
            });
            // Order by EFFECTIVE time (when it took effect), not `created` (when a
            // waiver claim was first placed). A waiver claimed days ago but
            // processed last night must surface as last night's news, not sort
            // back to its claim date and get buried.
            const txnEffectiveTs = t => (t.status_updated || t.created || 0);
            allTxns.sort((a, b) => txnEffectiveTs(b) - txnEffectiveTs(a));

            // Merge DHQ historical trades (pre-analyzed with value data)
            // Deduplicate by timestamp so the provider's recent txns
            // aren't doubled.
            if (window.App?.LI?.tradeHistory?.length > 0) {
                const existingTradeTs = new Set(allTxns.filter(t => t.type === 'trade').map(t => t.created || 0));
                const histTrades = window.App.LI.tradeHistory
                    .filter(t => !existingTradeTs.has(t.ts || 0))
                    .map(t => ({ ...t, type: 'trade', status: 'complete', created: t.ts || 0, _fromDHQ: true }));
                allTxns = [...allTxns, ...histTrades].sort((a, b) => txnEffectiveTs(b) - txnEffectiveTs(a));
            }

            // Populate window.S.transactions keyed by week for
            // free-agency.js / flash-brief.js consumers.
            if (window.S) {
                const txnsByWeek = {};
                allTxns.forEach(t => {
                    const key = 'w' + (t.leg ?? t.week ?? 0);
                    if (!txnsByWeek[key]) txnsByWeek[key] = [];
                    txnsByWeek[key].push(t);
                });
                window.S.transactions = txnsByWeek;
            }
            let visibleTxns = allTxns.slice(0, 50);
            if (!visibleTxns.some(t => t.type === 'trade')) {
                const firstTrade = allTxns.find(t => t.type === 'trade');
                if (firstTrade) visibleTxns = [...visibleTxns.slice(0, 49), firstTrade];
            }
            setTransactions(visibleTxns);

            // Trending — if the provider supplied it (Sleeper), use that;
            // otherwise fall back to Sleeper's global trending endpoint
            // so all platforms see league-wide trends.
            if (hydrated.trending?.adds || hydrated.trending?.drops) {
                setTrending({
                    adds: hydrated.trending.adds || [],
                    drops: hydrated.trending.drops || [],
                });
            } else if (window.Sleeper?.fetchTrending) {
                (async () => {
                    try {
                        const [adds, drops] = await Promise.all([
                            window.Sleeper.fetchTrending('add', 24, 15),
                            window.Sleeper.fetchTrending('drop', 24, 15),
                        ]);
                        setTrending({ adds: adds || [], drops: drops || [] });
                    } catch (e) { window.wrLog && window.wrLog('trending.fetch', e); }
                })();
            }
        }

        async function switchYear(year) {
            if (year === activeYear) return;
            // Year switching requires a previous_league_id chain — check the
            // platform provider capability instead of hardcoding Sleeper.
            const provider = resolvePlatformProvider(currentLeague);
            if (!provider?.capabilities?.hasYearChain) {
                console.warn('[War Room] Year switching not supported for ' + (provider?.displayName || 'this platform'));
                return;
            }
            setLoading(true);
            setError(null);
            setActiveYear(year);
            setTimeYear(parseInt(year));
            try {
                const targetYear = parseInt(year);
                const currentYear = parseInt(activeYear);
                let targetLeagueId = null;

                if (targetYear < currentYear) {
                    // Going backward: walk previous_league_id chain
                    let leagueId = currentLeague.id;
                    for (let y = currentYear; y > targetYear && leagueId; y--) {
                        const leagueInfo = await fetchLeagueInfo(leagueId);
                        leagueId = leagueInfo?.previous_league_id || null;
                    }
                    targetLeagueId = leagueId;
                } else {
                    // Going forward: get user leagues for target year, then check which one chains back to current league
                    const userLeagues = await fetchUserLeagues(sleeperUserId, year);
                    for (const lg of userLeagues) {
                        // Walk this league's previous_league_id chain to see if it connects to our current league
                        let checkId = lg.previous_league_id;
                        let steps = targetYear - currentYear;
                        while (steps > 1 && checkId) {
                            const info = await fetchLeagueInfo(checkId);
                            checkId = info?.previous_league_id || null;
                            steps--;
                        }
                        if (checkId === currentLeague.id) {
                            targetLeagueId = lg.league_id;
                            break;
                        }
                    }
                    // Fallback: match by name if chain doesn't connect
                    if (!targetLeagueId) {
                        const nameMatch = userLeagues.find(l => l.name === currentLeague.name);
                        targetLeagueId = nameMatch ? nameMatch.league_id : (userLeagues[0] ? userLeagues[0].league_id : null);
                    }
                }

                if (!targetLeagueId) {
                    setError('No leagues found for ' + year);
                    setLoading(false);
                    return;
                }

                const [leagueInfo, rosters, users] = await Promise.all([
                    fetchLeagueInfo(targetLeagueId),
                    fetchLeagueRosters(targetLeagueId),
                    fetchLeagueUsers(targetLeagueId)
                ]);
                setViewingOwnerId(sleeperUserId);
                setCurrentLeague({
                    id: targetLeagueId,
                    name: leagueInfo.name,
                    season: year,
                    scoring_settings: leagueInfo.scoring_settings || {},
                    roster_positions: leagueInfo.roster_positions || [],
                    settings: leagueInfo.settings || {},
                    rosters,
                    users
                });
            } catch (err) {
                console.error('Failed to switch year:', err);
                setError('Failed to load ' + year + ' data');
                setLoading(false);
            }
        }

        function getPlayerName(playerId) {
            const player = playersData[playerId];
            if (!player) return `Player ${playerId}`;
            return player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || `Player ${playerId}`;
        }

        function getPlayerPosition(playerId) {
            const player = playersData[playerId];
            return player?.position || '??';
        }

        function getPlayerTeam(playerId) {
            const player = playersData[playerId];
            return player?.team || '';
        }

        // Compute fantasy pts using the league's actual scoring_settings weights,
        // applied to raw stat fields — works for both offensive and IDP players.
        // Mirrors the Team Comps page's fantasyPointsFromScoring() approach:
        // always use scoring_settings when available so IDP defensive stats aren't
        // silently zeroed out by Sleeper's pre-calculated pts_half_ppr = 0.
        function calcRawPts(s) {
            return window.App.calcRawPts(s, currentLeague?.scoring_settings);
        }

        function getPlayerStats(playerId) {
            const player = playersData[playerId];
            // Always show STATS_YEAR totals; fall back to current-season data for historical year views
            const s = stats2025Data[playerId] || statsData[playerId];
            const p = projectionsData[playerId];

            // Years of experience
            const yrs = player?.years_exp != null ? player.years_exp : '-';

            // Fantasy points — uses league scoring_settings for IDP players
            const rawPts = calcRawPts(s);
            const pts = rawPts !== null ? Number(rawPts).toFixed(1) : '-';

            // Games played
            const gp = s?.gp != null ? s.gp : '-';

            // Average points per game
            let avg = '-';
            if (rawPts !== null && s?.gp && s.gp > 0) {
                avg = (rawPts / s.gp).toFixed(1);
            }

            // Projected points — use Sleeper projections when available, otherwise 2025 season totals
            const rawProj = p ? (p.pts_half_ppr ?? p.pts_ppr ?? p.pts_std ?? null) : null;
            const rawPts2025 = calcRawPts(stats2025Data[playerId]);
            const proj = rawProj !== null ? Number(rawProj).toFixed(1) : (rawPts2025 !== null ? Number(rawPts2025).toFixed(1) : '-');

            return { yrs, pts, gp, avg, proj };
        }

        function getPositionColor(pos) {
            const colors = { QB: 'var(--k-ff6b6b, #ff6b6b)', RB: 'var(--k-4ecdc4, #4ecdc4)', WR: 'var(--k-45b7d1, #45b7d1)', TE: 'var(--k-f7dc6f, #f7dc6f)', K: 'var(--k-bb8fce, #bb8fce)', DEF: 'var(--k-85929e, #85929e)' };
            return colors[pos] || 'var(--silver)';
        }

        function getPositionLabel(pos) {
            return window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
        }

        // Dashboard helpers
        function timeAgo(ts) {
            if (!ts) return '';
            // Sleeper API returns seconds; convert to ms. Guard against already-ms values.
            const tsMs = ts > 1e12 ? ts : ts * 1000;
            const diff = Date.now() - tsMs;
            if (diff < 0) return 'just now';
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + 'm ago';
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return hrs + 'h ago';
            const days = Math.floor(hrs / 24);
            if (days < 30) return days + 'd ago';
            return Math.floor(days / 30) + 'mo ago';
        }

        function getOwnerName(rosterId) {
            const roster = currentLeague.rosters?.find(r => r.roster_id === rosterId);
            const user = currentLeague.users?.find(u => u.user_id === roster?.owner_id);
            return user?.display_name || user?.username || 'Unknown';
        }

        // GM Onboarding wizard — conversational strategy setup
        function startGmOnboarding() {
          if (gmOnboardStep > 0) return;
          setGmOnboardStep(1);
          setReconMessages([{
            role: 'assistant',
            content: 'Welcome to Dynasty HQ. I\'m Alex — your AI General Manager. Before we get started, let me learn how you want to run this team.\n\n**First things first — are we competing for a title this year, or building for the future?**',
            onboardChoices: [
              { label: 'Win Now', value: 'contend' },
              { label: 'Balanced', value: 'balanced' },
              { label: 'Rebuilding', value: 'rebuild' }
            ]
          }]);
        }

        function handleOnboardChoice(value) {
          const step = gmOnboardStep;
          if (step === 1) {
            const modeLabels = { contend: 'Win Now', balanced: 'Balanced', rebuild: 'Rebuilding' };
            setGmStrategy(prev => ({ ...prev, mode: value }));
            setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined })),
              { role: 'user', content: modeLabels[value] },
              { role: 'assistant', content: value === 'contend'
                ? 'Aggressive. I like it. We\'re going all-in.\n\n**How do you want to play it — conservative and calculated, or willing to swing big?**'
                : value === 'rebuild'
                ? 'Smart. Let\'s stack assets and build a dynasty.\n\n**How aggressive should we be with trades — swing for the fences, or play it safe?**'
                : 'Flexible. We\'ll compete while keeping an eye on the future.\n\n**How aggressive should we be with trades?**',
                onboardChoices: [
                  { label: 'Conservative', value: 'conservative' },
                  { label: 'Moderate', value: 'moderate' },
                  { label: 'Aggressive', value: 'aggressive' }
                ]
              }
            ]);
            setGmOnboardStep(2);
          } else if (step === 2) {
            setGmStrategy(prev => ({ ...prev, riskTolerance: value }));
            const topPlayers = (myRoster?.players || [])
              .sort((a, b) => (window.App?.LI?.playerScores?.[b] || 0) - (window.App?.LI?.playerScores?.[a] || 0))
              .slice(0, 6);
            setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined })),
              { role: 'user', content: value.charAt(0).toUpperCase() + value.slice(1) },
              { role: 'assistant', content: 'Got it.\n\n**Anyone on your roster you\'d never trade? Your untouchables.** Tap to select — or skip if everyone has a price.',
                onboardChoices: topPlayers.map(pid => ({
                  label: (playersData[pid]?.full_name || pid),
                  value: pid,
                  multi: true
                })),
                onboardMulti: true,
                onboardSkip: true
              }
            ]);
            setGmOnboardStep(3);
          } else if (step === 3) {
            // value is array of pids or 'skip'
            if (value !== 'skip' && Array.isArray(value) && value.length) {
              setGmStrategy(prev => ({ ...prev, untouchable: value }));
              const names = value.map(pid => playersData[pid]?.full_name || pid).join(', ');
              setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined, onboardMulti: undefined, onboardSkip: undefined })),
                { role: 'user', content: 'Untouchable: ' + names }
              ]);
            } else {
              setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined, onboardMulti: undefined, onboardSkip: undefined })),
                { role: 'user', content: 'Everyone has a price' }
              ]);
            }
            setReconMessages(prev => [...prev,
              { role: 'assistant', content: '**Last question — any positions you\'re actively targeting in trades?** Tap all that apply, or skip.',
                onboardChoices: [
                  ['QB','QB'], ['RB','RB'], ['WR','WR'], ['TE','TE'], ['K','K'],
                  ['D/ST','DEF'], ['DL','DL'], ['LB','LB'], ['DB','DB'], ['Picks','Picks']
                ].map(([label, value]) => ({ label, value, multi: true })),
                onboardMulti: true,
                onboardSkip: true
              }
            ]);
            setGmOnboardStep(4);
          } else if (step === 4) {
            if (value !== 'skip' && Array.isArray(value) && value.length) {
              setGmStrategy(prev => ({ ...prev, targets: value }));
              const labelTargets = value.map(v => window.App?.posLabel?.(v) || (v === 'DEF' ? 'D/ST' : v));
              setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined, onboardMulti: undefined, onboardSkip: undefined })),
                { role: 'user', content: 'Targeting: ' + labelTargets.join(', ') }
              ]);
            } else {
              setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined, onboardMulti: undefined, onboardSkip: undefined })),
                { role: 'user', content: 'No specific targets' }
              ]);
            }
            setGmOnboardStep(5);
            // Free: never auto-fire AI (BYOK routes dhqAI straight to the
            // provider, bypassing the OD.callAI tripwire) — free gets the
            // designed canned ack instead of the AI assessment.
            if (typeof window.wrIsPro === 'function' && !window.wrIsPro()) {
              setReconMessages(prev => [...prev, { role: 'assistant', content: 'Strategy locked in. Let\'s get to work — ask me anything. — Alex' }]);
              return;
            }
            // Generate strategy assessment
            setReconMessages(prev => [...prev, { role: 'assistant', content: '...' }]);
            (async () => {
              try {
                // Prefer the structured team_diagnosis route: full league-format
                // detection, team-mode rules, and quality gates (the generic
                // strategy-analysis path is blind to all three).
                const reply = await (async () => {
                  if (window.OD?.callAI && window.WR?.AIContext) {
                    try {
                      const assessment = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
                      const diagRoster = (myRoster?.players || []).map(pid => {
                        const p = playersData[pid];
                        if (!p) return null;
                        return {
                          name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
                          pos: window.App?.normPos?.(p.position) || p.position,
                          age: p.age || null,
                          value: window.App?.LI?.playerScores?.[pid] || 0,
                          isStarter: (myRoster?.starters || []).includes(pid),
                        };
                      }).filter(Boolean).sort((a, b) => b.value - a.value);
                      const context = {
                        ...window.WR.AIContext.buildStructuredBase(currentLeague, assessment, myRoster),
                        myOwner: window.S?.user?.display_name || window.S?.user?.username || '',
                        record: myRoster?.settings ? `${myRoster.settings.wins}-${myRoster.settings.losses}` : '',
                        needs: (assessment?.needs || []).map(n => n.urgency === 'deficit' ? `${n.pos}*` : n.pos),
                        strengths: assessment?.strengths || [],
                        // gmStrategy rides in from buildStructuredBase (the canonical
                        // WR.GmMode.promptBlock serialization) — no legacy override here.
                        myRoster: diagRoster,
                      };
                      const result = await window.OD.callAI({ type: 'team_diagnosis', context });
                      if (result?.analysis) return result.analysis;
                    } catch (err) { window.wrLog?.('teamDiagnosis.structured', err); }
                  }
                  // Fallback: legacy generic path, enriched with the format preamble.
                  if (typeof dhqAI === 'function') {
                    const preamble = window.WR?.AIContext?.buildFormatPreamble?.(currentLeague) || '';
                    const ctx = preamble + (typeof dhqContext === 'function' ? dhqContext(false) : '');
                    return await dhqAI('strategy-analysis', 'Give me a 3-sentence personalized strategic assessment of my team based on my GM strategy settings. Be direct and specific.', ctx);
                  }
                  return 'Strategy saved. Ask me anything about your team.';
                })();
                setReconMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: reply };
                  return updated;
                });
              } catch (e) {
                setReconMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: 'Strategy locked in. Let\'s get to work — ask me anything. — Alex' };
                  return updated;
                });
              }
            })();
          }
        }

        // Multi-select state for onboarding
        const [onboardSelections, setOnboardSelections] = useState([]);

        // ReconAI: send message
	        async function sendReconMessage(text) {
	          if (!text?.trim()) return;
	          window.OD?.track?.('alex_prompt_sent', {
	            platform: 'warroom',
	            leagueId: currentLeague?.league_id || currentLeague?.id || null,
	            module: activeTab,
	            metadata: { chars: text.trim().length },
	          });
	          // Free tier (owner ruling 2026-07-05): ONE Ask Alex send per day on
          // the existing AI_DAILY counter. canUseAI() can't enforce this — it
          // trusts the server whenever hasServerAI() and only ever limited the
          // paid 'scout' tier — and BYOK (S.apiKey) never touches the server,
          // so the counter is checked here at the send seam.
          let isFreeCountedSend = false;
          if (typeof window.wrIsPro === 'function' && !window.wrIsPro()) {
            const dayKey = window.App.WR_KEYS.AI_DAILY(new Date().toISOString().split('T')[0]);
            if (parseInt(window.App.WrStorage.get(dayKey, '0')) >= 1) {
              setReconInput('');
              setReconMessages(prev => [...prev, { role: 'user', content: text.trim() }, { role: 'assistant', content: 'That\'s my one free scouting call for today — I\'m back tomorrow. Dynasty HQ Pro gets you unlimited Ask Alex, plus verdicts, optimizers and the full intel suite.' }]);
              return;
            }
            isFreeCountedSend = true; // counted after the reply lands — a provider error must not burn the one daily send
          } else {
            // Paid/trial: untouched — legacy scout-tier limit + server-side rate limiting.
            if (!canUseAI()) {
              setReconMessages(prev => [...prev, { role: 'user', content: text.trim() }, { role: 'assistant', content: 'You\'ve used your free AI query for today. Upgrade to Dynasty HQ Pro ($9.99/mo or $99.99/yr) for 10–15 AI calls a day.' }]);
              return;
            }
            // Only track local daily use if NOT using server AI (server handles its own rate limiting)
            if (!(typeof hasServerAI === 'function' && hasServerAI())) trackAIUse();
          }
          setReconInput('');
          const userMsg = { role: 'user', content: text.trim() };
          setReconMessages(prev => [...prev, userMsg, { role: 'assistant', content: '...' }]);
          try {
            let context = '';
            if (typeof dhqContext === 'function') context = dhqContext(true);
            if (window._leagueDocsContext) {
                context += '\n\n--- LEAGUE DOCUMENTS ---\n' + window._leagueDocsContext;
            }
            // GM Strategy directive — dhqContext() above already serializes the
            // committed strategy into its canonical [GM_STRATEGY] block (the same
            // WR.GmMode.promptBlock output), so never prepend a second copy here.
            // Only when that block is absent (dhq-ai not loaded, or no strategy
            // saved yet) fall back to the local prepend / mode-only preset.
            try {
                if (!context.includes('[GM_STRATEGY]')) {
                    const gmBlock = window.WR?.GmMode?.promptBlock?.(currentLeague?.league_id || currentLeague?.id);
                    if (gmBlock) {
                        context = '--- GM STRATEGY DIRECTIVE ---\n' + gmBlock + '\n\n' + context;
                    } else {
                        const gm = window.WR?.GmMode?.describe?.(gmStrategy?.mode);
                        if (gm && gm.prompt) {
                            context = '--- GM MODE DIRECTIVE ---\n' + gm.prompt + '\n\n' + context;
                        }
                    }
                }
            } catch (e) { /* ignore */ }
            // Format + quality preamble — the generic dhqAI path can't detect
            // superflex/TEP/IDP or apply quality floors without this.
            try {
                const fmtPreamble = window.WR?.AIContext?.buildFormatPreamble?.(currentLeague);
                if (fmtPreamble) context = fmtPreamble + '\n' + context;
            } catch (e) { /* ignore */ }
            const messages = [...reconMessages.slice(-4), userMsg].map((m, i, arr) => {
              if (m.role === 'user' && i === arr.length - 1) {
                return { role: 'user', content: context + '\n\n' + m.content };
              }
              if (m.role === 'assistant' && m.content.length > 400) {
                return { role: 'assistant', content: m.content.substring(0, 400) + '...' };
              }
              return m;
            });
            // Route requests to optimal prompt type
            const isScoutRequest = /^Scout\s/i.test(text.trim());
            const isRookieScout = /SEARCH FOR CURRENT INFO.*scouting report|Full dynasty scouting report/i.test(text.trim());
            const aiType = isRookieScout ? 'rookie-scout' : isScoutRequest ? 'trade-scout' : 'home-chat';
            const reply = typeof dhqAI === 'function'
              ? await dhqAI(aiType, null, (typeof dhqContext === 'function' ? dhqContext(true) : null), { messages })
              : typeof callClaude === 'function'
                ? await callClaude(messages)
                : 'AI not available. Add an API key in Settings.';
            const cleanReply = (typeof reply === 'string' ? reply : String(reply || '')).trim();
            if (!cleanReply || cleanReply === 'No response.') {
              // Empty answer: show a recoverable prompt and do NOT burn the
              // free daily send — the user got nothing back.
              setReconMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: "I didn't catch that one — mind rephrasing it, or tap send again?" };
                return updated;
              });
              return;
            }
            if (isFreeCountedSend && (typeof dhqAI === 'function' || typeof callClaude === 'function')) trackAIUse();
            setReconMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: cleanReply };
              return updated;
            });
          } catch(e) {
            const raw = String((e && e.message) || '');
            console.warn('[Alex Ingram] AI error:', raw);
            // Translate the failure into a plain, recoverable message instead
            // of a raw "Error: ..." string or a dead spinner. The shared
            // transport now aborts a stalled request after 45s, so a hang
            // arrives here as a timeout the user can simply resend.
            // Two different "no AI right now" cases must read differently:
            //   • the per-minute burst valve (429 "Rate limit exceeded") clears
            //     in seconds — tell the user to just try again;
            //   • a real daily/monthly quota resets tomorrow.
            // Check the burst valve FIRST (its message also contains "limit").
            const isRateLimit = /rate limit exceeded|try again in \d+\s*s/i.test(raw);
            const isDailyQuota = !isRateLimit && /limit reached|daily ai limit|monthly ai limit|budget limit|allowance|resets|upgrade your plan|use your own ai key/i.test(raw);
            const friendly = /timed out|timeout|abort/i.test(raw)
              ? "That one took too long to come back — tap send again and I'll pick it right up."
              : /load failed|failed to fetch|network/i.test(raw)
                ? "I couldn't reach the server just now — check your connection and try again."
                : isRateLimit
                  ? "Alex is catching up — give it a few seconds, then send it again."
                  : isDailyQuota
                    ? "You've reached your AI call limit for the day. It resets tomorrow."
                    : "Something hiccupped on that one — give it another try.";
            setReconMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: friendly };
              return updated;
            });
          }
        }

        // ReconAI: contextual chips
        function getReconChips() {
          const base = [
            { label: 'What should I do?', prompt: 'What are the top 3 moves I should make right now?' },
          ];
          // Contextual starter prompt based on current tab
          const starters = {
            analytics: { label: 'What are my biggest weaknesses?', prompt: 'Analyze my team and tell me what my biggest weaknesses are — positional gaps, age concerns, and depth issues.' },
            myteam: { label: 'Who should I trade?', prompt: 'Looking at my roster, which players should I be actively trying to trade and what kind of return should I target?' },
            trades: { label: 'Best trade partner right now?', prompt: 'Which owner in my league is the best trade partner for me right now? Consider roster needs, tendencies, and mutual fit.' },
            fa: { label: 'Best waiver pickup this week?', prompt: 'Who is the best waiver wire pickup I should target this week based on my roster needs and available players?' },
            draft: { label: 'Best pick at my spot?', prompt: 'Given my draft position and roster needs, who is the best player I should target with my next pick?' },
          };
          const starter = starters[activeTab];
          const chips = starter ? [starter, ...base] : [...base];

          if (activeTab === 'dashboard') return [...chips,
            { label: 'Top 3 moves', prompt: 'What are the top 3 moves I should make right now?' },
            { label: 'League pulse', prompt: 'Give me a quick pulse check on my league — who is rising, falling, and what moves are being made.' },
            { label: 'League recap', prompt: 'Summarize the key storylines in my league right now.' },
            { label: 'Power rankings', prompt: 'Give me your power rankings for this league with one-line analysis per team.' },
          ];
          if (activeTab === 'myteam') return [...chips,
            { label: 'Roster grade', prompt: 'Grade my roster position by position and identify the biggest weakness.' },
            { label: 'Who to sell?', prompt: 'Which players on my roster should I sell high on right now?' },
          ];
          if (activeTab === 'league') return [...chips,
            { label: 'League overview', prompt: 'Give me a quick overview of every team in the league — strengths, weaknesses, and dynasty outlook.' },
            { label: 'Trade partners', prompt: 'Which teams in the league are the best trade partners for me right now and why?' },
          ];
          if (activeTab === 'analytics') return [...chips,
            { label: 'Explain my gaps', prompt: 'Based on the winner analysis, what are my biggest gaps and how do I close them?' },
            { label: 'Draft strategy', prompt: 'Based on historical draft success in this league, what should my draft strategy be?' },
          ];
          if (activeTab === 'trades') return [...chips,
            { label: 'Best trade targets', prompt: 'Who are my best trade targets right now based on roster needs and trade partner compatibility?' },
            { label: 'Sell high candidates', prompt: 'Which players on my roster should I sell high on in a trade?' },
          ];
          if (activeTab === 'fa') return [...chips,
            { label: 'Best pickup?', prompt: 'Who is the best available free agent I should target right now?' },
            { label: 'FAAB advice', prompt: 'How should I spend my remaining FAAB budget?' },
          ];
          if (activeTab === 'draft') return [...chips,
            { label: 'Who at my pick?', prompt: 'Who should I target with my draft picks this year?' },
            { label: 'Draft strategy', prompt: 'What should my draft strategy be based on my roster needs?' },
          ];
          return chips;
        }

        if (error) {
            return (
                <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--white)', padding: '2rem', textAlign: 'center' }}>
                    <div style={{ color: 'var(--k-e74c3c, #e74c3c)', fontSize: '1.5rem', marginBottom: '1rem' }}>Error Loading League</div>
                    <div style={{ color: 'var(--silver)', marginBottom: '2rem' }}>{error}</div>
                    <button onClick={onBack} style={{ padding: '0.75rem 1.5rem', background: 'var(--gold)', border: 'none', borderRadius: '8px', color: 'var(--black)', fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '700', cursor: 'pointer' }}>← Back to Dashboard</button>
                </div>
            );
        }

        if (loading) {
            return (
                <div className="app-container wr-skel-shell" style={{ paddingBottom: '60px' }}>
                    {/* Phone tier (≤767): no dead 160px rail — full-width single column.
                        !important beats the inline styles below; tablet (768–1023) and
                        desktop keep the rail exactly as-is. */}
                    <style>{`@media(max-width:767px){
                        .wr-skel-shell{padding-bottom:calc(60px + var(--sab, env(safe-area-inset-bottom, 0px))) !important}
                        .wr-skel-rail{display:none !important}
                        .wr-skel-main{margin-left:0 !important;padding:calc(16px + var(--sat, env(safe-area-inset-top, 0px))) 12px 24px !important}
                        .wr-skel-kpis{grid-template-columns:repeat(auto-fit,minmax(120px,1fr)) !important}
                        .wr-skel-cols{grid-template-columns:1fr !important}
                    }`}</style>
                    {/* Skeleton left nav */}
                    <div className="wr-skel-rail" style={{ position:'fixed', left:0, top:0, bottom:0, width:'160px', background:'var(--black)', borderRight:'1px solid var(--acc-line1, rgba(212,175,55,0.2))', padding:'16px 0', zIndex:100 }}>
                        <div className="wr-wordmark" style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.3rem', color:'var(--gold)', padding:'0 16px', marginBottom:'20px' }}>DYNASTY HQ</div>
                        {['Home','My Team','League','Analytics','Trades','Free Agency','Draft'].map((label,i) => (
                            <div key={i} style={{ padding:'10px 16px', fontSize:'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', color: i===0?'var(--gold)':'var(--ov-8, rgba(255,255,255,0.3))', borderLeft: i===0?'3px solid var(--gold)':'3px solid transparent', background: i===0?'var(--acc-fill2, rgba(212,175,55,0.12))':'transparent' }}>{label}</div>
                        ))}
                    </div>
                    {/* Skeleton main content */}
                    <div className="wr-skel-main" style={{ marginLeft:'160px', padding:'24px 32px' }}>
                        <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.1rem', color:'var(--gold)', marginBottom:'16px' }}>{currentLeague.name}</div>
                        {/* KPI skeleton row */}
                        <div className="wr-skel-kpis" style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'12px', marginBottom:'24px' }}>
                            <SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI />
                        </div>
                        {/* Hero skeleton */}
                        <div className="skel-card" style={{ height:'120px', marginBottom:'20px' }}>
                            <div className="skel skel-line" style={{ width:'70%' }} />
                            <div className="skel skel-line" style={{ width:'90%' }} />
                            <div className="skel skel-line" style={{ width:'50%' }} />
                        </div>
                        {/* Two-column skeleton */}
                        <div className="wr-skel-cols" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                            <div className="skel-card"><div className="skel skel-line" style={{width:'40%',marginBottom:'12px'}} /><SkeletonRows count={5} /></div>
                            <div className="skel-card"><div className="skel skel-line" style={{width:'40%',marginBottom:'12px'}} /><SkeletonRows count={5} /></div>
                        </div>
                    </div>
                </div>
            );
        }

        // Currently viewed roster
        const viewingRoster = currentLeague.rosters.find(r => r.owner_id === viewingOwnerId) || myRoster;
        const viewingOwner = standings.find(t => t.userId === viewingOwnerId);
        const isViewingMyTeam = viewingOwnerId === sleeperUserId;

        // Stat column style shared by header and rows
        const statColStyle = { width: '42px', textAlign: 'center', fontSize: 'var(--text-label, 0.75rem)', flexShrink: 0 };

        // Column header row for stat columns — merged into section labels
        const statLabels = ['DHQ', 'YRS', 'PTS', 'GP', 'AVG', 'PROJ'];

        function SectionLabel({ label, color, borderColor, borderWidth }) {
            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                    paddingBottom: '0.4rem',
                    borderBottom: `${borderWidth || '1px'} solid ${borderColor || color}`,
                    gap: '0.5rem'
                }}>
                    <span style={{ width: '36px', flexShrink: 0 }}></span>
                    <span style={{ flex: 1, color: color, fontSize: 'var(--text-body, 1rem)', fontWeight: '700', letterSpacing: '0.08em' }}>{label}</span>
                    {statLabels.map(l => (
                        <span key={l} style={{ ...statColStyle, color: 'var(--gold)', fontWeight: '700', letterSpacing: '0.05em', opacity: 0.8 }}>{l}</span>
                    ))}
                </div>
            );
        }

        // PlayerRow with gold position box, clickable name, 5 stat columns
        function PlayerRow({ playerId, section }) {
            const pos = getPlayerPosition(playerId);
            const stats = getPlayerStats(playerId);
            const team = getPlayerTeam(playerId);
            const borderColor = section === 'starter' ? 'var(--gold)' : section === 'ir' ? 'var(--k-e74c3c, #e74c3c)' : section === 'taxi' ? 'var(--k-3498db, #3498db)' : 'transparent';
            const bgColor = section === 'starter' ? 'var(--acc-fill1, rgba(212, 175, 55, 0.05))' : section === 'ir' ? 'rgba(231, 76, 60, 0.05)' : section === 'taxi' ? 'rgba(52, 152, 219, 0.05)' : 'var(--ov-1, rgba(255, 255, 255, 0.02))';
            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.45rem 0.6rem',
                    marginBottom: '0.3rem',
                    background: bgColor,
                    borderLeft: borderColor !== 'transparent' ? `3px solid ${borderColor}` : 'none',
                    borderRadius: '4px',
                    gap: '0.5rem'
                }}>
                    {/* Gold position box */}
                    <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        flexShrink: 0,
                        fontSize: 'var(--text-label, 0.75rem)',
                        fontWeight: '700',
                        color: getPositionColor(pos),
                        border: '1.5px solid var(--gold)',
                        borderRadius: '3px',
                        padding: '2px 0',
                        background: 'var(--acc-fill2, rgba(212, 175, 55, 0.08))',
                        letterSpacing: '0.02em'
                    }}>
                        {getPositionLabel(pos)}
                    </span>
                    {/* Player name + team — opens shared player card */}
                    <a
                        href="#"
                        onClick={e => { e.preventDefault(); if (window._wrSelectPlayer) window._wrSelectPlayer(playerId); }}
                        style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: 'var(--white)',
                            fontSize: 'var(--text-body, 1rem)',
                            overflow: 'hidden',
                            textDecoration: 'none',
                            transition: 'color 0.2s',
                            minWidth: 0,
                            cursor: 'pointer'
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--white)'}
                    >
                        <div style={{ width: '28px', height: '28px', flexShrink: 0 }}>
                        <img
                            src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
                            alt=""
                            onError={e => { e.target.style.display = 'none'; }}
                            style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                        </div>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {getPlayerName(playerId)} <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.65 }}>{team}</span>
                        </span>
                    </a>
                    {/* DHQ dynasty value */}
                    {(() => {
                      const dhq = window.App?.LI?.playerScores?.[playerId] || 0;
                      if (!dhq) return <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.6, fontSize: 'var(--text-body, 1rem)' }}>—</span>;
                      const col = dhq >= 7000 ? 'var(--k-2ecc71, #2ecc71)' : dhq >= 4000 ? 'var(--k-d4af37, #d4af37)' : dhq >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.4))';
                      return <span style={{ ...statColStyle, color: col, fontWeight: '700', fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', minWidth: '42px' }}>{dhq.toLocaleString()}</span>;
                    })()}
                    {/* Stat columns: YRS PTS GP AVG PROJ */}
                    <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.7 }}>{stats.yrs}</span>
                    <span style={{ ...statColStyle, color: 'var(--gold)', fontWeight: '700' }}>{stats.pts}</span>
                    <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.7 }}>{stats.gp}</span>
                    <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.7 }}>{stats.avg}</span>
                    <span style={{ ...statColStyle, color: 'var(--k-4ecdc4, #4ecdc4)', fontWeight: '600' }}>{stats.proj}</span>
                </div>
            );
        }

        // Reusable roster section renderer
        function RosterSection({ roster }) {
            if (!roster) return <div style={{ textAlign: 'center', color: 'var(--silver)', padding: '2rem' }}>No roster found</div>;
            const starters = roster.starters || [];
            const reserve = roster.reserve || [];
            const taxi = roster.taxi || [];
            const bench = (roster.players || []).filter(p => !starters.includes(p) && !reserve.includes(p) && !taxi.includes(p));

            return (
                <>
                    {starters.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <SectionLabel label="STARTERS" color="var(--gold)" borderColor="var(--gold)" borderWidth="2px" />
                            {starters.map((id, i) => <PlayerRow key={i} playerId={id} section="starter" />)}
                        </div>
                    )}
                    {bench.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <SectionLabel label="BENCH" color="var(--silver)" borderColor="var(--ov-6, rgba(255,255,255,0.15))" />
                            {bench.map((id, i) => <PlayerRow key={i} playerId={id} section="bench" />)}
                        </div>
                    )}
                    {reserve.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <SectionLabel label="INJURED RESERVE" color="var(--k-e74c3c, #e74c3c)" borderColor="rgba(231,76,60,0.3)" />
                            {reserve.map((id, i) => <PlayerRow key={i} playerId={id} section="ir" />)}
                        </div>
                    )}
                    {taxi.length > 0 && (
                        <div>
                            <SectionLabel label="TAXI SQUAD" color="var(--k-3498db, #3498db)" borderColor="rgba(52,152,219,0.3)" />
                            {taxi.map((id, i) => <PlayerRow key={i} playerId={id} section="taxi" />)}
                        </div>
                    )}
                </>
            );
        }

        // --- My Team Tab helpers ---
        function getAcquisitionInfo(pid, rosterId) {
            const sameRoster = (a, b) => String(a) === String(b);
            const getAddOwner = (txn, playerId) => txn?.adds ? (txn.adds[playerId] ?? txn.adds[String(playerId)]) : undefined;
            const txnDate = (created) => {
                const raw = Number(created || 0);
                if (!raw) return null;
                return new Date(raw > 1000000000000 ? raw : raw * 1000);
            };
            const fmtDate = (d) => d && !Number.isNaN(d.getTime())
                ? d.toLocaleDateString('en-US', {month:'short', day:'numeric', year: '2-digit'})
                : '\u2014';
            // Check manual override first
            try {
                const overrides = JSON.parse(localStorage.getItem('wr_acquired_overrides') || '{}');
                if (overrides[pid]) return overrides[pid];
            } catch {}

            // Collect ALL transactions from window.S.transactions (all weeks) + recent list
            const allTxns = [];
            const txnMap = window.S?.transactions || {};
            if (typeof txnMap === 'object' && !Array.isArray(txnMap)) {
                Object.values(txnMap).forEach(arr => { if (Array.isArray(arr)) allTxns.push(...arr); });
            }
            // Also include the component-level transactions
            if (transactions?.length) allTxns.push(...transactions);
            // Deduplicate by transaction_id
            const seen = new Set();
            const txns = allTxns.filter(t => {
                const key = t.transaction_id || (t.created + '-' + t.type);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).sort((a, b) => (b.created || 0) - (a.created || 0));

            // Check waiver/FA transactions (most recent first)
            for (const t of txns) {
                const addOwner = getAddOwner(t, pid);
                if ((t.type === 'waiver' || t.type === 'free_agent') && addOwner != null && sameRoster(addOwner, rosterId)) {
                    const cost = t.settings?.waiver_bid || 0;
                    const d = txnDate(t.created);
                    const date = fmtDate(d);
                    return { method: t.type === 'waiver' ? 'Waiver' : 'FA', date, cost: cost > 0 ? '$' + cost : '', season: d ? String(d.getFullYear()) : '', week: t.leg || t.week || 0 };
                }
            }
            // Check trades — search LI trade history
            const trades = window.App?.LI?.tradeHistory || [];
            for (const t of trades) {
                if (!t.sides) continue;
                const side = t.sides[rosterId] || t.sides[String(rosterId)];
                if (side && side.players && side.players.some(p => String(p) === String(pid))) {
                    const season = t.season || '';
                    const week = t.week || '';
                    // Identify partner (other roster on the trade)
                    const partners = (t.roster_ids || Object.keys(t.sides)).filter(r => String(r) !== String(rosterId));
                    const partnerRid = partners[0];
                    // window.S.leagueUsers is the canonical key (set in the hydrate
                    // block above). Using .users used to silently return no match.
                    const users = window.S?.leagueUsers || [];
                    const rosters = window.S?.rosters || [];
                    const partnerRoster = rosters.find(r => String(r.roster_id) === String(partnerRid));
                    const partnerUser = users.find(u => u.user_id === partnerRoster?.owner_id);
                    const partnerName = partnerUser?.display_name || partnerUser?.metadata?.team_name || (partnerRid != null ? 'T' + partnerRid : '');
                    const date = season + (week ? ' W' + week : '');
                    return { method: 'Traded', date, cost: partnerName ? 'from ' + partnerName : '', season, week };
                }
            }
            // Fallback: check raw transaction data for trades
            for (const t of txns) {
                const addOwner = getAddOwner(t, pid);
                if (t.type === 'trade' && addOwner != null && sameRoster(addOwner, rosterId)) {
                    const d = txnDate(t.created);
                    const date = fmtDate(d);
                    return { method: 'Traded', date, cost: '', season: d ? String(d.getFullYear()) : '', week: t.leg || 0 };
                }
            }
            // Check draft outcomes
            const drafts = window.App?.LI?.draftOutcomes || [];
            const draftPick = drafts.find(d => String(d.pid) === String(pid) && sameRoster(d.roster_id, rosterId));
            if (draftPick) {
                // Format as "2024 2.03" when we know the pick slot, else "2024 R2"
                const totalTeams = window.S?.league?.total_rosters || (window.S?.rosters?.length) || 12;
                const slotInRound = draftPick.pick_no != null && totalTeams ? (((draftPick.pick_no - 1) % totalTeams) + 1) : null;
                const slotStr = slotInRound != null ? (draftPick.round + '.' + String(slotInRound).padStart(2, '0')) : ('R' + draftPick.round);
                return { method: 'Drafted', date: draftPick.season + ' ' + slotStr, cost: '', season: draftPick.season, week: 0 };
            }
            // Default: original/keeper
            return { method: 'Original', date: '\u2014', cost: '', season: '', week: 0 };
        }

        const sidebarWidth = sidebarCollapsed ? 72 : 176;
        // Icon paths live at module scope (NAV_ICON_PATHS, above PhoneDock)
        // so the sidebar and the phone dock strip draw the same glyphs.
        const iconPaths = NAV_ICON_PATHS;
        const renderNavIcon = (key) => React.createElement('svg', {
            className: 'wr-sidebar-icon',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
        }, ...(iconPaths[key] || iconPaths.home).map((d, idx) => React.createElement('path', { key: idx, d })));

        // Nav definition — single source of truth (module-scope
        // buildLeagueNavItems). The sidebar maps this array below and the
        // SAME array instance feeds the PhoneDock strip at the bottom of
        // this render, so the two surfaces can never drift.
        const navItems = buildLeagueNavItems(leagueSkin?.features?.showGameDay ?? (leagueSkin?.phase === 'in_season'));

        const _seasonCtxValue = { ...seasonCtxData, leagueSkin, selectPlayer };
        const leagueSkinClassName = leagueSkin?.theme?.className || (leagueSkin?.type ? 'wr-league-skin-' + leagueSkin.type : 'wr-league-skin-default');

        return (
          <window.App.SeasonContext.Provider value={_seasonCtxValue}>
            <div className={'app-container ' + leagueSkinClassName} data-league-skin-type={leagueSkin?.type || 'unknown'} data-league-skin-theme={leagueSkin?.theme?.id || 'war-room-default'} onWheel={rerouteWheelToPage} style={{ paddingBottom: '60px' }}>
                {/* DHQ Loading Bubble — .wr-dhq-bubble: phone tier repoints it
                    above the bottom dock (index.html PHONE TIER block). */}
                {dhqStatus.loading && (
                    <div className="wr-dhq-bubble" style={{
                        position: 'fixed', bottom: '24px', left: '80px', zIndex: 300,
                        background: 'var(--black)', border: '2px solid var(--acc-line3, rgba(212,175,55,0.4))',
                        borderRadius: '16px', padding: '16px 20px', minWidth: '280px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                        animation: 'fadeSlideUp 0.3s ease'
                    }}>
                        <style>{`@keyframes fadeSlideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes dhqSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                            <div style={{
                                width: '20px', height: '20px', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))',
                                borderTopColor: 'var(--gold)', borderRadius: '50%',
                                animation: 'dhqSpin 0.8s linear infinite'
                            }}></div>
                            <div>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.04em' }}>BUILDING LEAGUE INTELLIGENCE</div>
                                <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginTop: '2px' }}>{dhqStatus.step}</div>
                            </div>
                        </div>
                        <div style={{ background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
                            <div style={{
                                width: dhqStatus.progress + '%', height: '100%',
                                background: 'linear-gradient(90deg, var(--gold), var(--k-f0a500, #f0a500))',
                                borderRadius: '4px', transition: 'width 0.5s ease'
                            }}></div>
                        </div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginTop: '6px', opacity: 0.6 }}>
                            {dhqStatus.progress < 50 ? 'Analyzing league history, stats, drafts, and transactions. First load takes ~15 seconds, then it\'s cached.' :
                             dhqStatus.progress < 80 ? 'Scoring every player in your league\'s scoring system...' :
                             'Almost done — blending market data and computing trade values.'}
                        </div>
                    </div>
                )}

                {/* Mobile hamburger toggle \u2014 hidden while the phone Alex sheet is
                    open (it would paint above the sheet and toggle the drawer
                    invisibly beneath it). PHONE (one-row header live): removed
                    entirely \u2014 the dock strip covers every nav item and Refresh
                    moved into the header sheet (owner ruling 2026-07-09). The
                    768-1023 drawer tier keeps it \u2014 no dock there. */}
                {/* iPad pass: status-bar scrim \u2014 the non-phone header is NOT sticky
                    (desktop-parity ruling), so scrolled content would bleed under
                    the transparent status bar in installed-PWA. height = --sat \u2192
                    zero-height (invisible) everywhere else. Phone has the sticky
                    header as its backdrop instead. */}
                {!phoneHdrKit && <div aria-hidden="true" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 'var(--sat, 0px)', background: 'var(--black, #0a0a0a)', zIndex: 60 }} />}
                {!phoneHdrKit && !(alexPhone && reconPanelOpen) && <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{
                    // iPad pass (G3): --sat/--sal terms are env()=0 everywhere but
                    // installed-PWA on device \u2014 desktop stays byte-identical.
                    display: 'none', position: 'fixed', top: 'calc(10px + var(--sat, 0px) + var(--wr-dev-banner-height, 0px))', left: 'calc(10px + var(--sal, 0px))', zIndex: 201,
                    background: 'var(--black)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px',
                    padding: '6px 10px', cursor: 'pointer', color: 'var(--gold)', fontSize: '1.2rem', lineHeight: 1
                }} className="wr-hamburger">{sidebarOpen ? '\u2715' : '\u2630'}</button>}
                <style>{`@media(max-width:1023px){
                    html,body,#root{max-width:100%;overflow-x:clip;overflow-y:visible}
                    .wr-hamburger{display:block !important}
                    .wr-sidebar{left:-220px !important;top:var(--wr-dev-banner-height,0px) !important;transform:none !important}
                    .wr-sidebar.open{left:0 !important}
                    .wr-main-content{margin-left:0 !important;width:100% !important;max-width:100vw;overflow-x:clip;overflow-y:visible;box-sizing:border-box;padding-top:var(--wr-dev-banner-height,0px)}
                }
                @media(max-width:767px){
                    /* Phone header: compact two-zone layout — title + SWITCH share the
                       top line, and the status badges flow inline (wrapping) on the
                       line(s) below, instead of one full-width row per badge (which
                       stacked the header to ~180px tall). */
                    .wr-league-header-row{display:flex !important;flex-wrap:wrap !important;align-items:center !important;gap:6px !important;padding-left:44px}
                    .wr-league-header-row .header-title{flex:1 1 auto;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-body, 1rem) !important;line-height:1.2}
                    .wr-league-switch{flex:0 0 auto;margin-left:auto}
                    .wr-hdr-break{display:block !important;flex-basis:100%;width:100%;height:0;margin:0;padding:0;border:0}
                    .wr-gm-mode-badge,.wr-league-type-badge,.wr-league-phase-badge,.wr-draft-header-clock{flex:0 0 auto;min-width:0;max-width:100%;padding-top:3px !important;padding-bottom:3px !important}
                    .wr-draft-header-clock{overflow:hidden}
                    .wr-draft-header-clock>span{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                    .wr-draft-header-clock>strong{flex-shrink:0}
                    ${phoneHdrKit ? '' : '.header{padding-top:calc(0.4rem + var(--sat, 0px)) !important;padding-bottom:0.4rem !important}'}
                    .wr-time-bar{align-items:center !important;padding:6px 10px !important;gap:6px !important}
                    .wr-time-years{width:auto;max-width:100%;overflow:visible;flex-wrap:wrap !important;padding-bottom:2px}
                    .wr-time-spacer{display:none !important}
                    .wr-time-mode{margin-left:0;flex-shrink:0}
                    .wr-time-banner{padding:8px 10px !important;flex-direction:column;align-items:flex-start !important;gap:4px !important}
                    .wr-time-banner button{margin-left:0 !important;width:100%;max-width:220px}
                    .wr-debug-strip{padding:4px 10px !important;overflow-x:auto;overflow-y:clip}
                    .wr-debug-strip>div{min-width:max-content}
                }`}</style>
                {/* iPad-portrait header collapse (768–1023): year pills → compact
                    dropdown, and the league header + time bar become single
                    scrollable lines so the header stops stacking into ~190px. */}
                <style>{`@media(max-width:1023px){
                    .wr-time-years{display:none !important}
                    .wr-time-years-select{display:inline-block !important}
                }
                @media(min-width:768px) and (max-width:1023px){
                    .wr-league-header-row{flex-wrap:nowrap !important;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none}
                    .wr-league-header-row::-webkit-scrollbar{display:none}
                    .wr-time-bar{flex-wrap:nowrap !important;overflow-x:auto;scrollbar-width:none}
                    .wr-time-bar::-webkit-scrollbar{display:none}
                    /* iPad pass F2b: the fixed hamburger (left ~10px, ~41px wide)
                       overlapped the league title at the drawer tier — same 44px
                       clearance the phone tier gets. */
                    .wr-league-header-row{padding-left:44px}
                }`}</style>

                {/* Mobile overlay */}
                {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ display: 'none', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 99 }} className="wr-sidebar-overlay" />}
                <style>{`@media(max-width:1023px){.wr-sidebar-overlay{display:block !important}}`}</style>

                {/* Left Navigation */}
                <div className={'wr-sidebar' + (sidebarOpen ? ' open' : '') + (sidebarCollapsed ? ' is-collapsed' : '')} style={{
                    position: 'fixed', left: 0, top: 0, bottom: 0, width: sidebarWidth + 'px',
                    background: 'var(--black)', borderRight: '1px solid var(--acc-line1, rgba(212,175,55,0.2))',
                    display: 'flex', flexDirection: 'column',
                    padding: '16px 0', zIndex: 100, transition: 'width 0.18s ease, transform 0.2s ease'
                }}>
                    {/* Logo — click to go home */}
                    <div className="wr-sidebar-brand" onClick={onBack} style={{ padding: '0 14px', marginBottom: sidebarCollapsed ? '10px' : '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} title="Back to Dynasty HQ home">
                      <img src={iconSrc} alt="Dynasty HQ" style={{ width: '28px', height: '28px', borderRadius: '6px' }} onError={e => { e.target.style.display = 'none'; }} />
                      <div className="wr-sidebar-wordmark">
                        <div className="wr-wordmark" style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.06em', lineHeight: 1.1 }}>DYNASTY HQ</div>
                      </div>
                      {(() => {
                        const champs = window.App?.LI?.championships || {};
                        const cnt = Object.values(champs).filter(c => c.champion === myRoster?.roster_id).length;
                        // iPad pass: the \u00D7N count lived only in the hover title \u2014
                        // surface it inline on coarse pointers (fine-pointer identical).
                        if (cnt > 0) return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)' }} title={cnt + 'x Champion'}>{'\uD83C\uDFC6'}{alexVp.isCoarse && cnt > 1 ? '\u00D7' + cnt : ''}</span>;
                        return null;
                      })()}
                    </div>

                    <button
                        className="wr-sidebar-toggle"
                        onClick={() => setSidebarCollapsed(prev => !prev)}
                        title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                        aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                        style={{ width: sidebarCollapsed ? '34px' : 'calc(100% - 24px)', height: '30px', margin: '0 12px 12px' }}
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            {sidebarCollapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
                        </svg>
                        {!sidebarCollapsed && <span style={{ marginLeft: '8px', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Hide Menu</span>}
                    </button>

                    {/* Alerts removed — rolled into Brief */}

                    {/* Sidebar Search */}
                    {!sidebarCollapsed && React.createElement(function SidebarSearch() {
                        const [q, setQ] = React.useState('');
                        const [results, setResults] = React.useState([]);
                        const inputRef = React.useRef(null);
                        React.useEffect(() => {
                            if (!q || q.length < 2) { setResults([]); return; }
                            const lower = q.toLowerCase();
                            const matches = [];
                            // Search players
                            Object.entries(playersData || {}).forEach(([pid, p]) => {
                                if (matches.length >= 6) return;
                                const name = p.full_name || '';
                                if (name.toLowerCase().includes(lower)) matches.push({ type: 'player', pid, name, pos: p.position || '?', team: p.team || 'FA' });
                            });
                            // Search tabs
                            [{ label: 'Home', tab: 'dashboard' }, { label: 'My Roster', tab: 'myteam' }, { label: 'Trade Center', tab: 'trades' }, { label: 'Free Agency', tab: 'fa' }, { label: 'Draft Command', tab: 'draft' }, { label: 'Analytics', tab: 'analytics' }, { label: 'GM\'s Office', tab: 'alex' }, { label: 'Trophy Room', tab: 'trophies' }, { label: 'Settings', tab: 'settings' }, { label: 'Legend', tab: 'legend' }].forEach(t => {
                                if (t.label.toLowerCase().includes(lower)) matches.push({ type: 'tab', label: t.label, tab: t.tab });
                            });
                            setResults(matches.slice(0, 8));
                        }, [q]);
                        return React.createElement('div', { style: { padding: '4px 12px 8px', position: 'relative' } },
                            React.createElement('input', {
                                ref: inputRef, type: 'text', placeholder: 'Search...', value: q,
                                onChange: e => setQ(e.target.value),
                                onKeyDown: e => { if (e.key === 'Escape') { setQ(''); setResults([]); } },
                                style: { width: '100%', padding: '7px 10px 7px 28px', fontSize: 'var(--text-label, 0.75rem)', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: '6px', color: 'var(--silver)', fontFamily: 'var(--font-body)', outline: 'none', boxSizing: 'border-box' }
                            }),
                            React.createElement('svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'var(--acc-line3, rgba(212,175,55,0.4))', strokeWidth: 2, style: { position: 'absolute', left: '20px', top: '11px', pointerEvents: 'none' } },
                                React.createElement('circle', { cx: 11, cy: 11, r: 8 }),
                                React.createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })
                            ),
                            results.length > 0 && React.createElement('div', { style: { position: 'absolute', left: '12px', right: '12px', top: '100%', background: 'var(--k-0d0d0d, #0d0d0d)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '0 0 8px 8px', zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', maxHeight: '240px', overflowY: 'auto' } },
                                results.map((r, i) => React.createElement('div', {
                                    key: i,
                                    onClick: () => {
                                        if (r.type === 'player') { setSidebarOpen(false); selectPlayer(r.pid); }
                                        else if (r.type === 'tab') { setSidebarOpen(false); setActiveTab(r.tab); }
                                        setQ(''); setResults([]);
                                    },
                                    style: { padding: '6px 10px', cursor: 'pointer', fontSize: 'var(--text-label, 0.75rem)', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' },
                                    onMouseEnter: e => e.currentTarget.style.background = 'var(--acc-fill2, rgba(212,175,55,0.08))',
                                    onMouseLeave: e => e.currentTarget.style.background = 'transparent',
                                },
                                    r.type === 'player'
                                        ? [
                                            React.createElement('span', { key: 'n', style: { color: 'var(--white)', fontWeight: 500, flex: 1 } }, r.name),
                                            React.createElement('span', { key: 'p', style: { fontSize: 'var(--text-label, 0.75rem)', color: window.App?.POS_COLORS?.[window.App.normPos(r.pos)] || 'var(--silver)', fontWeight: 700 } }, window.App.normPos(r.pos)),
                                        ]
                                        : React.createElement('span', { style: { color: 'var(--gold)', fontWeight: 600 } }, '\u2192 ' + r.label)
                                ))
                            )
                        );
                    })}

                    {/* Nav items — grouped: FRONT OFFICE / LEAGUE / DOSSIER / SETTINGS.
                        Definition = buildLeagueNavItems (module scope) — the
                        same navItems array also drives the PhoneDock strip. */}
                    {navItems.map((item, i) => {
                        if (item.section) {
                            // Hairline divider only — section labels removed for a
                            // cleaner list. The grouping rhythm still reads via the
                            // thin rule between clusters. First section renders no
                            // top rule since there's nothing above it in the nav.
                            if (i === 0) return null;
                            return (
                                <div key={i} className="wr-sidebar-divider" style={{ height: '1px', margin: '8px 16px', background: 'var(--ov-4, rgba(255,255,255,0.06))' }} aria-hidden="true" />
                            );
                        }
                        const isActive = navItemIsActive(item, activeTab);
                        return (
                        <button key={i} onClick={() => { setSidebarOpen(false); item.tab ? setActiveTab(item.tab) : item.action ? item.action() : window.location.href = item.url; }}
                            className="wr-sidebar-nav-btn"
                            style={{
                                width: '100%', minHeight: '44px', padding: sidebarCollapsed ? '10px 0' : '9px 16px 9px 20px', border: 'none',
                                background: isActive ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent',
                                borderLeft: isActive ? '3px solid var(--gold)' : '3px solid transparent',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'flex-start', gap: '9px',
                                transition: 'all 0.15s',
                                color: isActive ? 'var(--gold)' : 'var(--silver)',
                                fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                                fontWeight: isActive ? 700 : 400,
                                letterSpacing: '0.03em', textAlign: 'left',
                                position: 'relative',
                            }}
                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'; }}
                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                        >
                            {sidebarCollapsed && renderNavIcon(item.iconKey)}
                            {!sidebarCollapsed && <span className="wr-sidebar-label" style={{ flex: 1 }}>{item.label}</span>}
                            {item.isNew && <span className="wr-sidebar-new-badge" style={{
                                fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                                padding: '1px 5px', borderRadius: '3px',
                                background: 'rgba(46,204,113,0.2)', color: 'var(--k-2ecc71, #2ecc71)',
                                letterSpacing: '0.08em',
                            }}>NEW</span>}
                        </button>
                        );
                    })}

                    {/* Spacer */}
                    <div style={{ flex: 1 }}></div>

                    {/* Sync Status — live freshness readout (audit:refresh-stale step 7) */}
                    {(() => {
                        const syncBase = window.WR?.Sync?.lastSyncedAt || syncedAt;
                        const liReady = !!window.App?.LI_LOADED;
                        let label, color;
                        if (!liReady || !syncBase) {
                            label = liReady ? 'Synced' : 'Loading';
                            color = liReady ? 'var(--k-2ecc71, #2ecc71)' : 'var(--silver)';
                        } else {
                            const ageMs = Math.max(0, Date.now() - syncBase);
                            const mins = Math.floor(ageMs / 60000);
                            label = mins < 1 ? 'Synced just now'
                                : mins < 60 ? 'Synced ' + mins + 'm ago'
                                : 'Synced ' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm ago';
                            const staleMs = window.WR?.Sync?.STALE_MS || 5 * 60 * 1000;
                            color = ageMs > 30 * 60 * 1000 ? 'var(--k-e74c3c, #e74c3c)'
                                : ageMs >= staleMs ? 'var(--k-f0a500, #f0a500)'
                                : 'var(--k-2ecc71, #2ecc71)';
                        }
                        return (
                            <div className="wr-sidebar-extra" title="Auto-refreshes when you return to the tab. Click Refresh Data for a full rebuild (values + history)." style={{ fontSize: 'var(--text-body, 1rem)', color, textAlign: 'center', fontFamily: 'var(--font-body)', opacity: 0.7, marginBottom: '4px' }}>
                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, margin: '0 auto 2px' }}></div>
                                {label}
                            </div>
                        );
                    })()}

                    {/* Refresh Button */}
                    <button onClick={async () => {
                        try {
                            Object.keys(localStorage).filter(k => k.startsWith('dhq_leagueintel_') || k.startsWith('dhq_hist_')).forEach(k => localStorage.removeItem(k));
                            // Real cache clears (audit:refresh-stale step 2): the old
                            // `window._wrPlayersCache = null` never touched core.js's
                            // closure-scoped cache, and the sessionStorage key was a
                            // relic of the pre-IndexedDB players cache.
                            window.App?.clearDataCaches?.();
                            window.Sleeper?.clearSeasonCaches?.();
                            if (window.App) { window.App.LI = {}; window.App.LI_LOADED = false; window._liLoading = false; }
                        } catch(e) { window.wrLog('refresh.cleanup', e); }
                        await loadLeagueDetails();
                    }} style={{
                        width: '100%', padding: '10px 16px', border: 'none',
                        background: 'transparent', cursor: 'pointer', display: 'flex',
                        alignItems: 'center', transition: 'all 0.15s', color: 'var(--gold)',
                        fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                        letterSpacing: '0.03em', textAlign: 'left', marginBottom: '8px'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    title="Reload DHQ values, league history, and AI data"
                    >
                        {sidebarCollapsed ? renderNavIcon('refresh') : 'Refresh Data'}
                        {/* iPad pass: title= never fires on touch — promote the
                            info-exclusive tooltip to the tap-to-toggle Tip on
                            coarse pointers only (desktop byte-identical). */}
                        {!sidebarCollapsed && alexVp.isCoarse && typeof Tip === 'function' && <Tip>Reloads DHQ values, league history, and AI data. Data also auto-refreshes when you return to the tab.</Tip>}
                    </button>
                </div>

                {/* Main content shifted right */}
                <div className="wr-main-content" style={{
                    marginLeft: sidebarWidth + 'px',
                    width: 'calc(100vw - ' + sidebarWidth + 'px)',
                    maxWidth: 'calc(100vw - ' + sidebarWidth + 'px)',
                    minWidth: 0,
                    overflowX: 'clip',
                    overflowY: 'visible',
                    boxSizing: 'border-box',
                }}>
                {/* Header — collapsed into a single left-aligned strip.
                    Removed: redundant "{year} SEASON" subtitle (year picker below handles this)
                    and the duplicate league-name/team-count in the time context bar. */}
                {/* Phone header (kit tier): STICKY with safe-area top padding — the
                    solid .header gradient doubles as the status-bar/Dynamic-Island
                    backdrop, fixing (owner iPhone screenshots 2026-07-12): title
                    under the island, header scrolling away, and content bleeding
                    under the transparent status bar. z 60 sits above content +
                    sticky table columns (z≤50) and below drawer/dock/sheets
                    (99/100/150/200). Desktop/tablet branch byte-identical. */}
                <header className="header" style={phoneHdrKit
                    ? { position: 'sticky', top: 'var(--wr-dev-banner-height, 0px)', zIndex: 60, marginBottom: '0', paddingTop: 'calc(0.35rem + var(--sat, 0px))', paddingBottom: '0.35rem' }
                    // iPad pass (G3): the inline paddingTop was overriding the base
                    // .header --sat rule, putting the league title under the status
                    // bar in installed-PWA. env()=0 off-device → desktop identical.
                    : { position: 'relative', marginBottom: '0', paddingTop: 'calc(0.6rem + var(--sat, 0px))', paddingBottom: '0.6rem' }}>
                    {phoneHdrKit ? (() => {
                        // ── ONE-ROW PHONE HEADER ── phase dot + name (tap = league
                        // sheet) + SWITCH. Everything else lives in the sheet below.
                        const gm = (leagueSkin?.type !== 'redraft') ? window.WR?.GmMode?.describe?.(gmStrategy?.mode || 'compete') : null;
                        const phaseColor = (leagueSkin?.phaseMeta && leagueSkin.phase !== 'unknown') ? leagueSkin.phaseMeta.color : 'var(--text-muted)';
                        const rowSt = { display: 'flex', alignItems: 'center', gap: '10px', minHeight: '48px', padding: '2px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', background: 'transparent', border: 'none', width: '100%', textAlign: 'left' };
                        const rowLbl = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', width: '92px', flex: 'none' };
                        const rowVal = { fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
                        const doDraftJump = () => {
                            const jump = headerDraftInfo?.status === 'drafting' || headerDraftInfo?.status === 'complete';
                            if (jump) window._wrOpenLiveDraft = true;
                            setPhHdrSheetOpen(false);
                            setActiveTab('draft');
                            if (jump) window.dispatchEvent(new CustomEvent('wr:open-live-draft'));
                        };
                        const doRefresh = async () => {
                            setPhHdrSheetOpen(false);
                            try {
                                Object.keys(localStorage).filter(k => k.startsWith('dhq_leagueintel_') || k.startsWith('dhq_hist_')).forEach(k => localStorage.removeItem(k));
                                window.App?.clearDataCaches?.();
                                window.Sleeper?.clearSeasonCaches?.();
                                if (window.App) { window.App.LI = {}; window.App.LI_LOADED = false; window._liLoading = false; }
                            } catch (e) { window.wrLog('refresh.cleanup', e); }
                            await loadLeagueDetails();
                        };
                        return (
                            <React.Fragment>
                                <div className="wr-phone-lhdr" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, paddingLeft: '2px' }}>
                                    <div role="button" tabIndex={0} aria-label="League status and actions"
                                        onClick={() => setPhHdrSheetOpen(true)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPhHdrSheetOpen(true); } }}
                                        style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', minHeight: '44px' }}>
                                        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: phaseColor }} />
                                        <span style={{ fontFamily: 'var(--font-title)', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.02em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentLeague.name}</span>
                                        <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: '0.65rem', flex: 'none' }}>▾</span>
                                    </div>
                                    <button className="wr-phone-hdr-refresh" onClick={doRefresh} disabled={!!loadStage} aria-label="Refresh data" title="Reload DHQ values, league history, and AI data" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '36px', minHeight: '36px', padding: '6px', background: 'transparent', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', color: 'var(--gold)', cursor: loadStage ? 'default' : 'pointer' }}>
                                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={loadStage ? { animation: 'dhqSpin 0.8s linear infinite' } : undefined}>
                                            {NAV_ICON_PATHS.refresh.map((d, i) => <path key={i} d={d} />)}
                                        </svg>
                                    </button>
                                    {/* Feedback (bug report + feature board) — re-homed here from the
                                        floating bottom-right launcher that sat over the dock. */}
                                    {window.WR?.Feedback?.toggleMenu && (
                                        <button onClick={(e) => { e.stopPropagation(); window.WR.Feedback.toggleMenu(e.currentTarget); }} aria-label="Feedback" title="Report a bug or request a feature" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '36px', minHeight: '36px', padding: '6px', background: 'transparent', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', color: 'var(--gold)', cursor: 'pointer' }}>
                                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                        </button>
                                    )}
                                    <button className="wr-league-switch" onClick={onBack} style={{ padding: '7px 12px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--acc-fill2, rgba(212,175,55,0.10))', color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, minHeight: '36px' }}>SWITCH</button>
                                </div>
                                {phHdrSheetOpen && <window.WR.Sheet open={true} onClose={() => setPhHdrSheetOpen(false)} title={currentLeague.name}>
                                    <div style={{ padding: '2px 16px 8px' }}>
                                        {gm && <button style={rowSt} onClick={() => { setPhHdrSheetOpen(false); if (setActiveTab) setActiveTab('strategy'); }}>
                                            <span style={rowLbl}>GM mode</span>
                                            <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: gm.badgeColor, flex: 'none' }} />
                                            <span style={{ ...rowVal, color: gm.badgeColor }}>{gm.label}</span>
                                            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>›</span>
                                        </button>}
                                        {/* Season selector — relocated from the (now phone-hidden) time bar.
                                            Native select → the iOS wheel picker; same handleTimeYearChange. */}
                                        <div style={{ ...rowSt, cursor: 'default' }}>
                                            <span style={rowLbl}>Season</span>
                                            <select value={timeYear} onChange={e => handleTimeYearChange(Number(e.target.value))} aria-label="Season year" style={{ flex: 1, minWidth: 0, background: 'var(--ov-2, rgba(255,255,255,0.04))', color: isCurrentYear ? 'var(--gold)' : 'var(--k-45b7d1, #45b7d1)', border: '1px solid var(--ov-4, rgba(255,255,255,0.08))', borderRadius: '6px', padding: '8px 10px', minHeight: '40px', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                                                {(() => {
                                                    const opt = (yr) => <option key={yr} value={yr} style={{ background: 'var(--black)', color: 'var(--white)' }}>{yr}{yr === currentSeason ? ' • current' : ''}</option>;
                                                    const past = timeYears.filter(y => y < currentSeason);
                                                    const cur = timeYears.filter(y => y === currentSeason);
                                                    const future = timeYears.filter(y => y > currentSeason);
                                                    return [
                                                        past.length ? <optgroup key="p" label="Past seasons">{past.map(opt)}</optgroup> : null,
                                                        cur.length ? <optgroup key="c" label="Current">{cur.map(opt)}</optgroup> : null,
                                                        future.length ? <optgroup key="f" label="Projected">{future.map(opt)}</optgroup> : null,
                                                    ];
                                                })()}
                                            </select>
                                        </div>
                                        {headerLeagueType && <div style={{ ...rowSt, cursor: 'default' }}>
                                            <span style={rowLbl}>Type</span>
                                            <span style={{ ...rowVal, color: headerLeagueType.color }}>{headerLeagueType.label === 'League Type Unknown' ? 'Type ?' : headerLeagueType.label}</span>
                                        </div>}
                                        {leagueSkin?.phaseMeta && leagueSkin.phase !== 'unknown' && leagueSkin.phase !== 'drafting' && <div style={{ ...rowSt, cursor: 'default' }}>
                                            <span style={rowLbl}>Phase</span>
                                            <span style={{ ...rowVal, color: leagueSkin.phaseMeta.color }}>{leagueSkin.phaseMeta.label}</span>
                                        </div>}
                                        {headerDraftClock && <button style={rowSt} onClick={doDraftJump}>
                                            <span style={rowLbl}>Draft</span>
                                            <span style={{ ...rowVal, color: 'var(--gold)', fontFamily: "'JetBrains Mono', monospace" }}>{[headerDraftClock.label, headerDraftClock.clock].filter(Boolean).join(' · ')}</span>
                                            <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.8rem' }}>›</span>
                                        </button>}
                                    </div>
                                </window.WR.Sheet>}
                            </React.Fragment>
                        );
                    })() : (
                    <div className="wr-league-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px 10px', flexWrap: 'wrap', minWidth: 0 }}>
                        <div className="header-title" style={{ fontSize: '1.05rem', minWidth: 0, maxWidth: 'min(460px, 100%)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentLeague.name}</div>
                        <button className="wr-league-switch" onClick={onBack} style={{ padding: '4px 12px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--acc-fill2, rgba(212,175,55,0.10))', color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>SWITCH</button>
                        {/* Feedback (bug report + feature board) — re-homed here from the
                            floating bottom-right launcher that covered page content. */}
                        {window.WR?.Feedback?.toggleMenu && (
                            <button onClick={(e) => { e.stopPropagation(); window.WR.Feedback.toggleMenu(e.currentTarget); }} aria-label="Feedback" title="Report a bug or request a feature" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '30px', minHeight: '28px', padding: '4px 8px', background: 'transparent', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', color: 'var(--gold)', cursor: 'pointer' }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                            </button>
                        )}
                        {/* Phone-only flex break: forces the status badges onto the line
                            below the title/SWITCH row. Inert (display:none) on desktop. */}
                        <div className="wr-hdr-break" aria-hidden="true" style={{ display: 'none' }} />
                        {(() => {
                            // Redraft leagues don't surface the GM Mode badge (it's dynasty-flavored).
                            if (leagueSkin?.type === 'redraft') return null;
                            const gm = window.WR?.GmMode?.describe?.(gmStrategy?.mode || 'compete');
                            if (!gm) return null;
                            return React.createElement('button', {
                                key: 'gm-badge-' + gm.id,
                                onClick: () => setActiveTab && setActiveTab('strategy'),
                                title: 'GM Mode — edit in GM\'s Office',
                                className: 'wr-gm-mode-badge',
                                style: {
                                    padding: '4px 10px 4px 8px', display: 'inline-flex', alignItems: 'center', gap: '6px',
                                    fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: '0.06em',
                                    background: wrAlpha(gm.badgeColor, '22'), color: gm.badgeColor,
                                    border: '1px solid ' + wrAlpha(gm.badgeColor, '66'),
                                    borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0
                                }
                            },
                                React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: gm.badgeColor } }),
                                'GM · ' + gm.label
                            );
                        })()}
                        {headerLeagueType && React.createElement('div', {
                            className: 'wr-league-type-badge',
                            title: 'League type: ' + headerLeagueType.label,
                            'aria-label': 'League type: ' + headerLeagueType.label,
                            style: {
                                display: 'inline-flex', alignItems: 'center', gap: '5px',
                                flex: '0 0 auto', minWidth: 'max-content',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid ' + wrAlpha(headerLeagueType.color, '66'),
                                background: wrAlpha(headerLeagueType.color, '18'),
                                color: headerLeagueType.color,
                                fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 800, textTransform: 'uppercase',
                                letterSpacing: '0.06em', whiteSpace: 'nowrap',
                                cursor: 'help'
                            }
                        },
                            React.createElement(LeagueTypeHeaderIcon, { meta: headerLeagueType }),
                            headerLeagueType.label === 'League Type Unknown' ? 'Type ?' : headerLeagueType.label
                        )}
                        {leagueSkin?.phaseMeta && leagueSkin.phase !== 'unknown' && leagueSkin.phase !== 'drafting' && React.createElement('div', {
                            className: 'wr-league-phase-badge',
                            title: 'League phase: ' + leagueSkin.phaseMeta.label,
                            'aria-label': 'League phase: ' + leagueSkin.phaseMeta.label,
                            style: {
                                display: 'inline-flex', alignItems: 'center', gap: '5px',
                                flex: '0 0 auto', minWidth: 'max-content',
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid ' + wrAlpha(leagueSkin.phaseMeta.color, '55'),
                                background: wrAlpha(leagueSkin.phaseMeta.color, '14'),
                                color: leagueSkin.phaseMeta.color,
                                fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 800, textTransform: 'uppercase',
                                letterSpacing: '0.06em', whiteSpace: 'nowrap',
                                cursor: 'help'
                            }
                        },
                            leagueSkin.phaseMeta.label
                        )}
                        {headerDraftClock && React.createElement('div', {
                            className: 'wr-draft-header-clock',
                            role: 'button',
                            tabIndex: 0,
                            title: headerDraftInfo?.status === 'drafting'
                                ? 'Jump to Follow Live Draft'
                                : headerDraftInfo?.status === 'complete'
                                    ? 'View the completed draft results'
                                    : (headerDraftInfo?.start_time ? 'Open the Draft module · ' + new Date(headerDraftInfo.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Open the Draft module'),
                            onClick: () => {
                                // 'drafting' jumps into the live mirror; 'complete' jumps to
                                // the finished board — DraftTab's _wrOpenLiveDraft flag path
                                // honors both statuses.
                                const jump = headerDraftInfo?.status === 'drafting' || headerDraftInfo?.status === 'complete';
                                if (jump) window._wrOpenLiveDraft = true;
                                setActiveTab('draft');
                                if (jump) window.dispatchEvent(new CustomEvent('wr:open-live-draft'));
                            },
                            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } },
                            style: {
                                display: 'inline-flex', alignItems: 'center', gap: '7px',
                                flex: '0 0 auto',
                                padding: '4px 10px', borderRadius: '6px',
                                border: '1px solid var(--acc-line3, rgba(212,175,55,0.42))',
                                background: 'var(--acc-fill2, rgba(212,175,55,0.12))',
                                color: 'var(--gold)',
                                fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 800, textTransform: 'uppercase',
                                letterSpacing: '0.06em', whiteSpace: 'nowrap',
                                cursor: 'pointer'
                            }
                        },
                            headerDraftClock.label ? React.createElement('span', { style: { color: 'var(--silver)', opacity: 0.78 } }, headerDraftClock.label) : null,
                            React.createElement('strong', { style: { color: 'var(--white)', fontFamily: "'JetBrains Mono', monospace", fontSize: 'var(--text-label, 0.75rem)' } }, headerDraftClock.clock)
                        )}
                    </div>
                    )}
                </header>

                {/* Load stage progress indicator */}
                {loadStage && (
                    <div style={{
                        padding: '6px 16px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))',
                        borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))',
                        fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontFamily: 'var(--font-body)',
                        display: 'flex', alignItems: 'center', gap: '8px'
                    }}>
                        <div style={{ width: '12px', height: '12px', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'dhqSpin 0.8s linear infinite' }}></div>
                        {loadStage}
                    </div>
                )}

                {/* ── GLOBAL TIME CONTEXT BAR ── */}
                {/* Phone (one-row header, kit live): the sticky season bar is
                    hidden — season selection moves into the league header sheet
                    (Season row) so the top chrome stays one row. Kit-aware, not
                    media-queried: phoneHdrKit is only true <768 WITH WR.Sheet, so
                    desktop + iPad (≥768) and the no-kit phone fallback keep the
                    bar and its inline season selector. */}
                <div className="wr-time-bar" style={{
                    display: phoneHdrKit ? 'none' : 'flex', alignItems: 'center', gap: '8px', padding: '8px clamp(12px, 4vw, 24px)', flexWrap: 'wrap',
                    background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))',
                    position: 'sticky', top: 'var(--sat, 0px)', zIndex: 50
                }}>
                    {/* Year pills — grouped as a timeline: past · current · projected */}
                    <div className="wr-time-years" style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap', minWidth: 0 }}>
                        {(() => {
                            const pastYears = timeYears.filter(y => y < currentSeason);
                            const currentAndFuture = timeYears.filter(y => y >= currentSeason);
                            return (
                                <React.Fragment>
                                    {pastYears.length > 0 && (
                                        <React.Fragment>
                                            <select value={isHistoricalYear ? timeYear : ''} onChange={e => { if (e.target.value) handleTimeYearChange(Number(e.target.value)); }} title="Past seasons" style={{
                                                padding: '4px 8px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                                                fontWeight: isHistoricalYear ? 700 : 400,
                                                background: isHistoricalYear ? 'var(--gold)' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                                color: isHistoricalYear ? 'var(--black)' : 'var(--silver)',
                                                border: '1px solid ' + (isHistoricalYear ? 'var(--gold)' : 'var(--ov-4, rgba(255,255,255,0.06))'),
                                                opacity: isHistoricalYear ? 1 : 0.8,
                                                borderRadius: '4px', cursor: 'pointer', outline: 'none'
                                            }}>
                                                <option value="" style={{ background: 'var(--black)', color: 'var(--white)' }}>Past seasons</option>
                                                {pastYears.map(yr => <option key={yr} value={yr} style={{ background: 'var(--black)', color: 'var(--white)' }}>{yr}</option>)}
                                            </select>
                                            {currentAndFuture.length > 0 && <span aria-hidden="true" style={{ width: 1, height: 18, margin: '0 5px', background: 'var(--ov-5, rgba(255,255,255,0.12))', alignSelf: 'center' }} />}
                                        </React.Fragment>
                                    )}
                                    {currentAndFuture.map((yr, i) => {
                                        const kind = yr > currentSeason ? 'future' : 'current';
                                        const prev = currentAndFuture[i - 1];
                                        const prevKind = prev == null ? null : (prev > currentSeason ? 'future' : 'current');
                                        const selected = timeYear === yr;
                                        let bg, color, border, weight = selected ? 700 : 400, opacity = 1;
                                        if (selected) { bg = 'var(--gold)'; color = 'var(--black)'; border = '1px solid var(--gold)'; }
                                        else if (kind === 'future') { bg = 'rgba(69,183,209,0.06)'; color = 'var(--k-45b7d1, #45b7d1)'; border = '1px solid rgba(69,183,209,0.25)'; }
                                        else { bg = 'var(--acc-fill2, rgba(212,175,55,0.12))'; color = 'var(--gold)'; border = '1px solid var(--acc-line2, rgba(212,175,55,0.4))'; weight = 700; }
                                        return (
                                            <React.Fragment key={yr}>
                                                {prevKind && prevKind !== kind && (
                                                    <span aria-hidden="true" style={{ width: 1, height: 18, margin: '0 5px', background: 'var(--ov-5, rgba(255,255,255,0.12))', alignSelf: 'center' }} />
                                                )}
                                                <button onClick={() => handleTimeYearChange(yr)} title={kind === 'future' ? yr + ' — projected' : yr + ' — current season'} style={{
                                                    padding: '4px 10px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                                                    fontWeight: weight, background: bg, color: color, border: border, opacity,
                                                    borderRadius: '4px', cursor: 'pointer', transition: 'all 0.15s'
                                                }}>{yr}</button>
                                            </React.Fragment>
                                        );
                                    })}
                                </React.Fragment>
                            );
                        })()}
                    </div>
                    {/* Compact year dropdown — replaces the pill strip at ≤1023px (CSS-toggled) */}
                    <select className="wr-time-years-select" value={timeYear} onChange={e => handleTimeYearChange(Number(e.target.value))} aria-label="Season year" style={{
                        display: 'none', padding: '5px 8px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                        fontWeight: 700, background: 'var(--gold)', color: 'var(--black)', border: '1px solid var(--gold)',
                        borderRadius: '4px', cursor: 'pointer', minHeight: '32px'
                    }}>
                        {(() => {
                            const opt = (yr) => <option key={yr} value={yr} style={{ background: 'var(--black)', color: 'var(--white)' }}>{yr}{yr === currentSeason ? ' • current' : ''}</option>;
                            const past = timeYears.filter(y => y < currentSeason);
                            const cur = timeYears.filter(y => y === currentSeason);
                            const future = timeYears.filter(y => y > currentSeason);
                            return [
                                past.length ? <optgroup key="p" label="Past seasons">{past.map(opt)}</optgroup> : null,
                                cur.length ? <optgroup key="c" label="Current">{cur.map(opt)}</optgroup> : null,
                                future.length ? <optgroup key="f" label="Projected">{future.map(opt)}</optgroup> : null,
                            ];
                        })()}
                    </select>
                    {/* League name/team-count moved to the main header to avoid duplication. */}
                    <div className="wr-time-spacer" style={{ marginLeft: 'auto' }}></div>
                    {/* Time mode badge */}
                    <span className="wr-time-mode" style={{
                        fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: timeModeColor,
                        background: wrAlpha(timeModeColor, '15'), border: '1px solid ' + wrAlpha(timeModeColor, '30'),
                        padding: '2px 10px', borderRadius: '12px',
                        fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em'
                    }}>{timeModeLabel}</span>
                    {/* Loading indicator */}
                    {timeLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '10px', height: '10px', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'dhqSpin 0.8s linear infinite' }} />
                        <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)' }}>Recomputing...</span>
                    </div>}
                </div>

                {/* Time mode banner — visible when not viewing current season */}
                {!isCurrentYear && <div className="wr-time-banner" style={{
                    padding: '8px 24px', display: 'flex', alignItems: 'center', gap: '8px',
                    background: wrAlpha(timeModeColor, '10'), borderBottom: '1px solid ' + wrAlpha(timeModeColor, '30')
                }}>
                    <span style={{ fontSize: 'var(--text-body, 1rem)', color: timeModeColor, fontWeight: 700, fontFamily: 'var(--font-body)' }}>
                        {isFutureYear ? 'FUTURE PROJECTION' : 'HISTORICAL VIEW'}: {timeYear}
                    </span>
                    <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6 }}>
                        {isFutureYear ? 'Player ages projected +' + timeDelta + 'yr. Values and stats are estimates.' : 'Showing ' + timeYear + ' season stats. Roster composition reflects current state.'}
                    </span>
                    <button onClick={() => handleTimeYearChange(currentSeason)} style={{ marginLeft: 'auto', fontSize: 'var(--text-label, 0.75rem)', padding: '3px 10px', background: 'transparent', border: '1px solid ' + timeModeColor, color: timeModeColor, borderRadius: '4px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>Back to {currentSeason}</button>
                </div>}

                {/* Debug panel (dev only) */}
                {DEV_DEBUG && <div className="wr-debug-strip" style={{ padding: '4px 24px', background: 'rgba(255,0,0,0.04)', borderBottom: '1px solid rgba(255,0,0,0.1)', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'monospace', color: 'var(--k-f0a500, #f0a500)' }}>
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '2px' }}>
                        <span>year={timeYear}</span>
                        <span>mode={timeMode}</span>
                        <span>tab={activeTab}</span>
                        <span>delta={timeDelta}</span>
                        <span>recompute={new Date(timeRecomputeTs).toLocaleTimeString()}</span>
                        <span>stats={Object.keys(statsData).length}</span>
                        <span>projected={window.App?.LI?._projectedYear || 'none'}</span>
                    </div>
                    {isFutureYear && window.App?.LI?.playerScores && (() => {
                        const scores = window.App.LI.playerScores;
                        const backup = window.App.LI._baseScoresBackup || {};
                        const samples = Object.entries(scores).filter(([,v]) => v > 2000).sort((a,b) => b[1] - a[1]).slice(0, 4);
                        return <div style={{ display: 'flex', gap: '12px', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--k-3498db, #3498db)' }}>
                            {samples.map(([pid, projDhq]) => {
                                const baseDhq = backup[pid] || projDhq;
                                const p = playersData[pid];
                                const diff = projDhq - baseDhq;
                                return <span key={pid}>{p?.full_name?.split(' ').pop() || pid}: {baseDhq}→{projDhq} ({diff >= 0 ? '+' : ''}{diff})</span>;
                            })}
                        </div>;
                    })()}
                </div>}

                {/* Tab Content Routing — Brief tab folded into Dashboard as widgets */}
                <div className="wr-content-frame">
                {activeTab === 'trades' ? (
                    <TradeCalcTabLazy
                        playersData={playersData}
                        statsData={statsData}
                        myRoster={myRoster}
                        standings={standings}
                        currentLeague={currentLeague}
                        leagueSkin={leagueSkin}
                        sleeperUserId={sleeperUserId}
                        timeRecomputeTs={timeRecomputeTs}
                        viewMode={viewMode}
                        initialSubTab={tradeSubTab}
                        onSubTabConsumed={() => setTradeSubTab(null)}
                    />
                ) : activeTab === 'myteam' ? <MyTeamTabLazy
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    playersData={playersData}
                    statsData={statsData}
                    stats2025Data={stats2025Data}
                    standings={standings}
                    sleeperUserId={sleeperUserId}
                    rosterFilter={rosterFilter}
                    setRosterFilter={setRosterFilter}
                    rosterSort={rosterSort}
                    setRosterSort={setRosterSort}
                    visibleCols={visibleCols}
                    setVisibleCols={setVisibleCols}
                    expandedPid={expandedPid}
                    setExpandedPid={setExpandedPid}
                    showColPicker={showColPicker}
                    setShowColPicker={setShowColPicker}
                    colPreset={colPreset}
                    setColPreset={setColPreset}
                    gmStrategy={gmStrategy}
                    setGmStrategy={setGmStrategy}
                    gmStrategyOpen={gmStrategyOpen}
                    setGmStrategyOpen={setGmStrategyOpen}
                    setAlexAvatar={setAlexAvatar}
                    setAvatarKey={setAvatarKey}
                    setActiveTab={setActiveTab}
                    setReconPanelOpen={setReconPanelOpen}
                    sendReconMessage={sendReconMessage}
                    timeRecomputeTs={timeRecomputeTs}
                    setTimeRecomputeTs={setTimeRecomputeTs}
                    getAcquisitionInfo={getAcquisitionInfo}
                /> : activeTab === 'lineup' ? <LineupTabLazy
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    playersData={playersData}
                    statsData={statsData}
                    stats2025Data={stats2025Data}
                    sleeperUserId={sleeperUserId}
                    gmStrategy={gmStrategy}
                    setActiveTab={setActiveTab}
                    timeRecomputeTs={timeRecomputeTs}
                /> : activeTab === 'league' ? <LeagueMapTabLazy
                    leagueViewTab={leagueViewTab}
                    setLeagueViewTab={setLeagueViewTab}
                    leagueSelectedTeam={leagueSelectedTeam}
                    setLeagueSelectedTeam={setLeagueSelectedTeam}
                    leagueSort={leagueSort}
                    setLeagueSort={setLeagueSort}
                    leagueSubView={leagueSubView}
                    setLeagueSubView={setLeagueSubView}
                    leagueViewMode={leagueViewMode}
                    setLeagueViewMode={setLeagueViewMode}
                    lpSort={lpSort}
                    setLpSort={setLpSort}
                    lpFilter={lpFilter}
                    setLpFilter={setLpFilter}
                    standings={standings}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    playersData={playersData}
                    statsData={statsData}
                    sleeperUserId={sleeperUserId}
                    myRoster={myRoster}
                    activeYear={activeYear}
                    timeRecomputeTs={timeRecomputeTs}
                    setTimeRecomputeTs={setTimeRecomputeTs}
                    getAcquisitionInfo={getAcquisitionInfo}
                    setActiveTab={setActiveTab}
                /> : activeTab === 'analytics' ? <AnalyticsPanelLazy
                    analyticsData={analyticsData}
                    analyticsTab={analyticsTab}
                    setAnalyticsTab={setAnalyticsTab}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    standings={standings}
                    playersData={playersData}
                    statsData={statsData}
                    stats2025Data={stats2025Data}
                    sleeperUserId={sleeperUserId}
                    timeRecomputeTs={timeRecomputeTs}
                    setTimeRecomputeTs={setTimeRecomputeTs}
                    activeYear={activeYear}
                    setActiveTab={setActiveTab}
                    viewingOwnerId={viewingOwnerId}
                    setViewingOwnerId={setViewingOwnerId}
                    timeDelta={timeDelta}
                    timeYear={timeYear}
                    setTradeSubTab={setTradeSubTab}
                    getOwnerName={getOwnerName}
                    getAcquisitionInfo={getAcquisitionInfo}
                /> : activeTab === 'fa' ? <FreeAgencyTabLazy
                    playersData={playersData}
                    statsData={statsData}
                    prevStatsData={stats2025Data}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    sleeperUserId={sleeperUserId}
                    timeRecomputeTs={timeRecomputeTs}
                    viewMode={viewMode}
                    briefDraftInfo={briefDraftInfo}
                /> : activeTab === 'draft' ? <DraftTabLazy
                    playersData={playersData}
                    statsData={statsData}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    sleeperUserId={sleeperUserId}
                    setReconPanelOpen={setReconPanelOpen}
                    sendReconMessage={sendReconMessage}
                    timeRecomputeTs={timeRecomputeTs}
                    viewMode={viewMode}
                /> : (activeTab === 'trophies' || activeTab === 'calendar') ? <TrophyRoomTabLazy
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    playersData={playersData}
                    myRoster={myRoster}
                    sleeperUserId={sleeperUserId}
                    initialView={activeTab === 'calendar' ? 'calendar' : null}
                /> : activeTab === 'settings' ? (
                    typeof window.SettingsModule === 'function'
                        ? React.createElement(window.SettingsModule, settingsProps)
                        : <div style={{ padding: '40px', textAlign: 'center', color: 'var(--silver)' }}>Settings module not loaded.</div>
                ) : activeTab === 'legend' ? (
                    React.createElement(LegendPanel, { module: true })
                ) : (activeTab === 'alex' || activeTab === 'strategy') ? React.createElement(AlexInsightsTabLazy, {
                    currentLeague, leagueSkin, myRoster, playersData, statsData,
                    stats2025Data, standings, sleeperUserId,
                    timeRecomputeTs, setActiveTab,
                    gmStrategy, setGmStrategy,
                    // Old tab=strategy URLs land on the Strategy sub-view inside GM's Office.
                    initialSubTab: activeTab === 'strategy' ? 'strategy' : null,
                }) : activeTab === 'compare' ? React.createElement(CompareTabLazy, {
                    currentLeague, leagueSkin, myRoster, playersData, statsData, stats2025Data,
                    standings, sleeperUserId,
                }) : (
                <DashboardPanel
                    selectedWidgets={selectedWidgets}
                    setSelectedWidgets={setSelectedWidgets}
                    editingKpi={editingKpi}
                    setEditingKpi={setEditingKpi}
                    computeKpiValue={computeKpiValue}
                    KPI_OPTIONS={KPI_OPTIONS}
                    rankedTeams={rankedTeams}
                    sleeperUserId={sleeperUserId}
                    setActiveTab={setActiveTab}
                    transactions={transactions}
                    standings={standings}
                    currentLeague={currentLeague}
                    leagueSkin={leagueSkin}
                    playersData={playersData}
                    statsData={statsData}
                    prevStatsData={stats2025Data}
                    myRoster={myRoster}
                    getOwnerName={getOwnerName}
                    getPlayerName={getPlayerName}
                    timeAgo={timeAgo}
                    briefDraftInfo={briefDraftInfo}
                    timeRecomputeTs={timeRecomputeTs}
                />
                )}
                </div>
                </div>{/* end marginLeft wrapper */}

            {selectedPlayerPid && typeof window.openFWPlayerModal !== 'function' && <PlayerInlineCard
                pid={selectedPlayerPid}
                playersData={playersData}
                statsData={statsData}
                onClose={() => setSelectedPlayerPid(null)}
                onFullProfile={() => {
                  try {
                    if (typeof window.openFWPlayerModal === 'function') {
                      const sc = currentLeague?.scoring_settings || {};
                      window.openFWPlayerModal(selectedPlayerPid, playersData, statsData, sc);
                    } else {
                      console.warn('[War Room] openFWPlayerModal not loaded');
                    }
                  } catch(e) { console.error('[War Room] Player modal error:', e); }
                }}
            />}

            {/* Alex Ingram Chat — centered welcome or bottom-right.
                Phone (≤767): all three modes collapse into ONE full-width
                bottom sheet (top-rounded, gold hairline top, keyboard-aware
                via the alexKb bottom offset). Tablet/desktop: untouched. */}
            {reconPanelOpen && <div style={alexPhone ? {
              // Sit ABOVE the phone dock when the keyboard is closed (owner ask:
              // the chat was covering the nav bar). Keyboard-open keeps bottom at
              // the keyboard top (the dock hides with the keyboard anyway).
              position: 'fixed', left: 0, right: 0, bottom: alexKb ? (alexKb + 'px') : 'var(--wr-bottom-inset, 0px)',
              width: '100%',
              height: (!welcomeMode && reconExpanded) ? alexSheetCap : 'auto',
              maxHeight: welcomeMode ? 'min(600px, ' + alexSheetCap + ')'
                : reconExpanded ? alexSheetCap
                : 'min(70dvh, ' + alexSheetCap + ')',
              background: 'var(--k-0a0b0d, #0a0b0d)',
              border: 'none',
              borderTop: '2px solid ' + (welcomeMode ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--acc-line2, rgba(212,175,55,0.3))'),
              borderRadius: '16px 16px 0 0',
              zIndex: welcomeMode ? 300 : 'var(--wr-z-sheet, 200)',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 -12px 48px rgba(0,0,0,0.6), 0 0 0 1px var(--acc-fill2, rgba(212,175,55,0.1))',
              animation: 'wrFadeIn 0.2s ease',
              transition: 'bottom 0.2s ease'
            } : welcomeMode ? {
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: '480px', maxHeight: '600px',
              background: 'var(--k-0a0b0d, #0a0b0d)', border: '2px solid var(--acc-line3, rgba(212,175,55,0.4))',
              borderRadius: '20px', zIndex: 300,
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 80px rgba(0,0,0,0.8), 0 0 0 1px var(--acc-fill3, rgba(212,175,55,0.15)), 0 0 120px var(--acc-fill1, rgba(212,175,55,0.06))',
              animation: 'wrFadeIn 0.3s ease'
            } : reconExpanded ? {
              position: 'fixed', bottom: '80px', right: '24px',
              width: 'min(760px, calc(100vw - 48px))', height: 'calc(100vh - 120px)', maxHeight: 'calc(100vh - 120px)',
              background: 'var(--k-0a0b0d, #0a0b0d)', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))',
              borderRadius: '16px', zIndex: 200,
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 80px rgba(0,0,0,0.75), 0 0 0 1px var(--acc-fill2, rgba(212,175,55,0.1))',
              animation: 'wrFadeIn 0.2s ease'
            } : {
              position: 'fixed', bottom: '80px', right: '24px',
              width: '380px', maxHeight: '520px',
              background: 'var(--k-0a0b0d, #0a0b0d)', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))',
              borderRadius: '16px', zIndex: 200,
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px var(--acc-fill2, rgba(212,175,55,0.1))',
              animation: 'wrFadeIn 0.2s ease'
            }}>
            {/* Welcome backdrop */}
            {welcomeMode && <div onClick={() => { setWelcomeMode(false); setReconPanelOpen(false); setTimeout(() => { setShowCornerToast(true); setTimeout(() => setShowCornerToast(false), 4000); }, 300); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: -1 }} />}
              {/* Header */}
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid var(--acc-line1, rgba(212,175,55,0.2))',
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderRadius: '14px 14px 0 0'
              }}>
                <div key={avatarKey} onClick={e => { e.stopPropagation(); setShowAvatarPicker(p => !p); }} style={{ cursor: 'pointer' }} title="Change Alex's avatar">
                  <AlexAvatar size={30} />
                </div>
                <div>
                  <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-title, 1.125rem)', color: 'var(--gold)', letterSpacing: '0.04em', lineHeight: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>Alex Ingram</div>
                  <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.5 }}>AI General Manager</div>
                </div>
                {!alexPhone && <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--text-muted)' }}>Cmd+K</span>}
                <span style={{ flex: 1 }}></span>
                {reconMessages.length > 1 && (
                  <button onClick={() => {
                    setReconMessages([{ role: 'assistant', content: 'Fresh start. What\'s on your mind? — Alex' }]);
                    setGmOnboardStep(5);
                    LeagueStorage.remove(LEAGUE_WR_KEYS.CHAT(currentLeague?.league_id));
                  }} title="Clear chat history" style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                    fontSize: 'var(--text-label, 0.75rem)', padding: '2px 4px', fontFamily: 'var(--font-body)', letterSpacing: '0.04em'
                  }}>CLEAR</button>
                )}
                <button onClick={() => setReconExpanded(v => !v)} title={reconExpanded ? 'Collapse' : 'Expand'} aria-label={reconExpanded ? 'Collapse panel' : 'Expand panel'} style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '1rem', padding: alexPhone ? '10px' : '2px', lineHeight: 1
                }}>{reconExpanded ? '−' : '⛶'}</button>
                <button onClick={() => { setReconPanelOpen(false); setReconExpanded(false); }} aria-label="Close chat" style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '1rem', padding: alexPhone ? '10px' : '2px'
                }}>&#10005;</button>
              </div>

              {/* Avatar picker (toggled) */}
              {showAvatarPicker && (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', background: 'var(--acc-fill1, rgba(212,175,55,0.04))' }}>
                  <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginBottom: '6px', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Choose Alex's look</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {ALEX_AVATARS.map(av => (
                      <button key={av.id} onClick={() => { setAlexAvatar(av.id); setShowAvatarPicker(false); setAvatarKey(k => k+1); }} style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                        padding: '6px', background: getAlexAvatar() === av.id ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                        border: '1px solid ' + (getAlexAvatar() === av.id ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                        borderRadius: '8px', cursor: 'pointer', minWidth: '56px'
                      }}>
                        {av.src ? (
                          <img src={av.src} alt={av.label} style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'linear-gradient(135deg, var(--k-d4af37, #d4af37), var(--k-b8941e, #b8941e))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 800, color: 'var(--k-0a0a0a, #0a0a0a)', fontFamily: 'Rajdhani, sans-serif' }}>AI</div>
                        )}
                        <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textAlign: 'center' }}>{av.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Context chips */}
              <div style={{ padding: '6px 12px', display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                {getReconChips().map((chip, i) => (
                  <button key={i} onClick={() => sendReconMessage(chip.prompt)}
                    style={{
                      padding: '3px 8px', fontSize: 'var(--text-label, 0.75rem)', borderRadius: '14px',
                      border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', background: 'var(--acc-fill1, rgba(212,175,55,0.06))',
                      color: 'var(--gold)', cursor: 'pointer', fontFamily: 'inherit'
                    }}>
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Messages — phone: no fixed cap (the sheet's maxHeight governs);
                  scrolls independently with iOS momentum + contained overscroll. */}
              <div style={{
                flex: 1, overflow: 'auto', padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: '6px',
                maxHeight: (reconExpanded || alexPhone) ? 'none' : '320px',
                ...(alexPhone ? { WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' } : {})
              }}>
                {reconMessages.map((msg, i) => (
                  msg.role === 'user' ? (
                    <div key={i} style={{
                      alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 12px', borderRadius: '12px',
                      fontSize: 'var(--text-body, 1rem)', lineHeight: 1.5,
                      background: 'rgba(124,107,248,0.12)', border: '1px solid rgba(124,107,248,0.18)',
                      color: 'var(--text-primary)'
                    }} dangerouslySetInnerHTML={{ __html: markdownToHtml(msg.content) }} />
                  ) : (
                    <div key={i} style={{
                      alignSelf: 'flex-start', maxWidth: '90%', padding: '8px 10px',
                      background: 'var(--acc-fill1, rgba(212,175,55,0.04))', borderLeft: '3px solid var(--acc-line3, rgba(212,175,55,0.4))',
                      borderRadius: '0 10px 10px 0'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <AlexAvatar size={20} />
                        <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', letterSpacing: '0.03em' }}>Alex Ingram</span>
                      </div>
                      {(() => {
                        const tradeMatch = msg.content.match(/<!--\s*TRADE_CARD:([\s\S]*?)-->/);
                        const textContent = msg.content.replace(/<!--\s*TRADE_CARD:[\s\S]*?-->/, '').trim();
                        let tradeCard = null;
                        if (tradeMatch) {
                          try { tradeCard = JSON.parse(tradeMatch[1].trim()); } catch {}
                        }
                        return (
                          <React.Fragment>
                            <div style={{ fontSize: 'var(--text-body, 1rem)', lineHeight: 1.5, color: 'var(--text-primary)' }}
                              dangerouslySetInnerHTML={{ __html: markdownToHtml(textContent) }} />
                            {tradeCard && (
                              <div style={{ marginTop: '10px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '10px', padding: '10px', fontSize: 'var(--text-body, 1rem)' }}>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                                  Proposed Trade{tradeCard.target ? ' → ' + tradeCard.target : ''}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'start' }}>
                                  <div>
                                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginBottom: '4px', fontFamily: 'var(--font-body)', textTransform: 'uppercase' }}>You Give</div>
                                    {(tradeCard.yourSide || []).map((a, j) => (
                                      <div key={j} style={{ padding: '3px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                                        <span style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                                        <span style={{ color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', marginLeft: '4px' }}>{a.dhq?.toLocaleString()} DHQ</span>
                                      </div>
                                    ))}
                                    <div style={{ marginTop: '4px', fontWeight: 700, color: 'var(--gold)', fontSize: 'var(--text-label, 0.75rem)' }}>
                                      Total: {(tradeCard.yourSide || []).reduce((s, a) => s + (a.dhq || 0), 0).toLocaleString()}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '1.2rem', color: 'var(--gold)', paddingTop: '16px' }}>{'\u21C4'}</div>
                                  <div>
                                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginBottom: '4px', fontFamily: 'var(--font-body)', textTransform: 'uppercase' }}>You Get</div>
                                    {(tradeCard.theirSide || []).map((a, j) => (
                                      <div key={j} style={{ padding: '3px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                                        <span style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                                        <span style={{ color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', marginLeft: '4px' }}>{a.dhq?.toLocaleString()} DHQ</span>
                                      </div>
                                    ))}
                                    <div style={{ marginTop: '4px', fontWeight: 700, color: 'var(--gold)', fontSize: 'var(--text-label, 0.75rem)' }}>
                                      Total: {(tradeCard.theirSide || []).reduce((s, a) => s + (a.dhq || 0), 0).toLocaleString()}
                                    </div>
                                  </div>
                                </div>
                                {/* Fairness bar */}
                                {(() => {
                                  const yours = (tradeCard.yourSide || []).reduce((s, a) => s + (a.dhq || 0), 0);
                                  const theirs = (tradeCard.theirSide || []).reduce((s, a) => s + (a.dhq || 0), 0);
                                  const diff = theirs - yours;
                                  const pct = yours > 0 ? Math.round((diff / yours) * 100) : 0;
                                  const color = pct >= 5 ? 'var(--k-2ecc71, #2ecc71)' : pct >= -5 ? 'var(--gold)' : 'var(--k-e74c3c, #e74c3c)';
                                  const label = pct >= 5 ? 'You win by ' + pct + '%' : pct >= -5 ? 'Fair trade' : 'You lose by ' + Math.abs(pct) + '%';
                                  return (
                                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'var(--ov-5, rgba(255,255,255,0.08))', overflow: 'hidden' }}>
                                        <div style={{ width: Math.min(100, 50 + pct) + '%', height: '100%', background: color, borderRadius: '2px' }} />
                                      </div>
                                      <span style={{ fontSize: 'var(--text-label, 0.75rem)', color, fontFamily: 'var(--font-body)' }}>{label}</span>
                                    </div>
                                  );
                                })()}
                                {/* Action buttons */}
                                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                                  {tradeCard.sleeperDM && (
                                    <button onClick={() => { navigator.clipboard.writeText(tradeCard.sleeperDM); }} style={{
                                      padding: '5px 12px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)',
                                      background: 'linear-gradient(135deg, var(--k-7c6bf8, #7c6bf8), var(--k-9b8afb, #9b8afb))', color: 'var(--k-ffffff, #ffffff)',
                                      border: 'none', borderRadius: '14px', cursor: 'pointer'
                                    }}>Copy DM</button>
                                  )}
                                  <button onClick={() => {
                                    // Save into the Trade Log pipeline (WrTradePipeline schema, cap 60 —
                                    // canonical helpers live in trade-calc.js). trade-calc.js is a DEFERRED
                                    // script (data-wr-defer="trade"), so if it hasn't loaded yet, write the
                                    // legacy card shape — WrTradePipeline.normalizeAll migrates it to the
                                    // schema on the next Trade Log read. Fallback cap mirrors WrTradePipeline.CAP.
                                    const lid = currentLeague?.league_id;
                                    if (!lid) return;
                                    const P = window.WrTradePipeline;
                                    if (P) { P.append(lid, P.fromAlexCard(tradeCard)); return; }
                                    const saved = LeagueStorage.get(LEAGUE_WR_KEYS.SAVED_TRADES(lid)) || [];
                                    saved.unshift({ ...tradeCard, savedAt: Date.now() });
                                    LeagueStorage.set(LEAGUE_WR_KEYS.SAVED_TRADES(lid), saved.slice(0, 60));
                                  }} style={{
                                    padding: '5px 12px', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)',
                                    background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)',
                                    border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '14px', cursor: 'pointer'
                                  }}>Save</button>
                                </div>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })()}
                      {/* Onboarding choice buttons */}
                      {msg.onboardChoices && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {msg.onboardChoices.map(c => {
                            const isSelected = msg.onboardMulti && onboardSelections.includes(c.value);
                            return (
                              <button key={c.value} onClick={() => {
                                if (msg.onboardMulti) {
                                  setOnboardSelections(prev => prev.includes(c.value) ? prev.filter(v => v !== c.value) : [...prev, c.value]);
                                } else if (gmOnboardStep === 0 && ['strategy','advice','avatar'].includes(c.value)) {
                                  handleWelcomeChoice(c.value);
                                } else {
                                  handleOnboardChoice(c.value);
                                }
                              }} style={{
                                padding: '6px 14px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                                background: isSelected ? 'var(--gold)' : 'var(--acc-fill2, rgba(212,175,55,0.08))',
                                color: isSelected ? 'var(--black)' : 'var(--gold)',
                                border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))',
                                borderRadius: '16px', cursor: 'pointer', transition: 'all 0.15s'
                              }}>{c.label}{isSelected ? ' \u2713' : ''}</button>
                            );
                          })}
                          {msg.onboardMulti && (
                            <React.Fragment>
                              {onboardSelections.length > 0 && (
                                <button onClick={() => { handleOnboardChoice(onboardSelections); setOnboardSelections([]); }} style={{
                                  padding: '6px 14px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                                  background: 'linear-gradient(135deg, var(--k-2ecc71, #2ecc71), var(--k-27ae60, #27ae60))', color: 'var(--k-ffffff, #ffffff)',
                                  border: 'none', borderRadius: '16px', cursor: 'pointer'
                                }}>Confirm ({onboardSelections.length})</button>
                              )}
                              {msg.onboardSkip && (
                                <button onClick={() => { handleOnboardChoice('skip'); setOnboardSelections([]); }} style={{
                                  padding: '6px 14px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)',
                                  background: 'var(--ov-3, rgba(255,255,255,0.04))', color: 'var(--silver)',
                                  border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderRadius: '16px', cursor: 'pointer'
                                }}>Skip</button>
                              )}
                            </React.Fragment>
                          )}
                        </div>
                      )}
                    </div>
                  )
                ))}
              </div>

              {/* Input — phone: --sab clearance while the keyboard is closed
                  (the sheet is keyboard-lifted when open, so plain 10px then),
                  16px input font (no iOS zoom-on-focus), 44px send target. */}
              <div style={{
                // Flat 10px on every tier: the phone sheet already sits above the
                // dock, which absorbs --sab — adding it again double-padded the
                // composer (~34px of dead space under the send row).
                padding: '10px 12px',
                borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.07))',
                display: 'flex', gap: '8px', background: 'var(--k-111318, #111318)',
                borderRadius: alexPhone ? '0' : '0 0 14px 14px'
              }}>
                <input
                  ref={reconComposerRef}
                  value={reconInput}
                  onChange={e => setReconInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendReconMessage(reconInput); }}
                  placeholder="Ask anything..."
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    color: 'var(--text-primary)', fontSize: alexPhone ? '16px' : 'var(--text-body, 1rem)', fontFamily: 'inherit'
                  }}
                />
                <button onClick={() => sendReconMessage(reconInput)} style={{
                  background: 'linear-gradient(135deg, var(--k-7c6bf8, #7c6bf8), var(--k-9b8afb, #9b8afb))',
                  border: 'none', borderRadius: '8px',
                  width: alexPhone ? '44px' : '32px', height: alexPhone ? '44px' : '32px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  ...(alexPhone ? { flexShrink: 0 } : {})
                }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </div>}

            {/* "I'll be down here" toast — .wr-corner-toast: phone tier lifts
                it above the bottom dock via --wr-bottom-inset (points at the
                dock's pinned Ask Alex item there; at the FAB on
                tablet/desktop). */}
            {showCornerToast && (
              <div className="wr-corner-toast" style={{
                position: 'fixed', bottom: '82px', right: '24px',
                background: 'var(--k-0a0b0d, #0a0b0d)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))',
                borderRadius: '12px', padding: '10px 16px', zIndex: 202,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                animation: 'wrFadeIn 0.3s ease', maxWidth: '220px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlexAvatar size={22} />
                  <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.4 }}>I'll be down here if you need me {'\uD83D\uDC47'}</span>
                </div>
              </div>
            )}

            {/* Alex Ingram Bubble Button — bottom right corner. Tablet +
                desktop ONLY: on phone the PhoneDock's pinned Ask Alex item
                is the entry point (same open path), so the FAB never
                renders there. */}
            {!alexPhone && <button className="wr-alex-fab" onClick={() => { setReconPanelOpen(!reconPanelOpen); setWelcomeMode(false); }} style={{
              position: 'fixed', bottom: '24px', right: '24px',
              width: '52px', height: '52px', borderRadius: '14px',
              background: reconPanelOpen ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'transparent',
              border: '2px solid var(--acc-line3, rgba(212,175,55,0.4))',
              cursor: 'pointer', zIndex: 201,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px var(--acc-line2, rgba(212,175,55,0.3))',
              transition: 'all 0.2s', overflow: 'hidden', padding: 0
            }}>
              {reconPanelOpen
                ? <span style={{ color: 'var(--gold)', fontSize: '1.2rem' }}>&#10005;</span>
                : <AlexAvatar size={48} />
              }
            </button>}

            {/* Phone bottom dock (≤767 only) — null on tablet/desktop and
                while the iOS keyboard is open. ONE row: sliding strip of
                EVERY sidebar nav item (same navItems array — single source
                of truth) + the pinned Ask Alex item at the right end
                (replaces the FAB on phone; same open path as the FAB). */}
            <PhoneDock
                activeTab={activeTab}
                navItems={navItems}
                onSelectTab={(tab) => { setSidebarOpen(false); setActiveTab(tab); }}
                onAskAlex={() => { reconComposerFocusPending.current = true; setReconPanelOpen(true); setWelcomeMode(false); }}
            />

            </div>
          </window.App.SeasonContext.Provider>
        );
    }
    window.LeagueDetail = LeagueDetail;
