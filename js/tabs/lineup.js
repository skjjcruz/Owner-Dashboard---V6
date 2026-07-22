// ══════════════════════════════════════════════════════════════════
// js/tabs/lineup.js — LineupTab: weekly Start/Sit Command Center.
// Interactive lineup builder: one unified table where each starting slot
// is a row (assigned player + projection + matchup + rolling form), and
// tapping a slot reveals every eligible roster player so you can set it.
// Working totals + optimal delta update live. League-scored via
// App.WeeklyProj / App.StartSit; objective tilts by GM mode.
// NOTE: builds/compares your lineup IN-APP. MFL leagues can push the working
// lineup straight to MyFantasyLeague ("Submit to MFL"); Sleeper has no public
// lineup-write API, so Sleeper lineups are still set on the platform.
// ══════════════════════════════════════════════════════════════════

function LineupTab({
    myRoster, currentLeague, leagueSkin, playersData, statsData, stats2025Data,
    sleeperUserId, gmStrategy, setActiveTab, timeRecomputeTs,
}) {
    const WP = window.App && window.App.WeeklyProj;
    const SS = window.App && window.App.StartSit;
    const normPos = (window.App && window.App.normPos) || (p => p);
    // Partial free/Pro gate (owner ruling 2026-07-05): FREE keeps the manual
    // builder, raw per-player projections, bye listing and the MFL push
    // (incl. pre-season building). PRO = the optimizer layer: optimal
    // hero/delta, floor–ceiling bands, matchup grades, win %, opponent
    // strength, bye recs, the Alex note. Supersedes the old whole-tab
    // STARTSIT_DEPTH gate.
    const pro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
    const GatedRow = window.WrGatedMoreRow;
    const STARTSIT_FEAT = (window.FEATURES && window.FEATURES.STARTSIT_DEPTH) || 'startsit_depth';
    const [ctxTick, setCtxTick] = React.useState(0); // bumps when NFL matchup context (opponent/weather/odds) loads

    const result = React.useMemo(() => {
        if (!WP || !myRoster || !currentLeague) return null;
        try {
            return WP.optimalForRoster(myRoster, currentLeague, {
                playersData, statsData, priorData: stats2025Data,
            });
        } catch (e) { if (window.wrLog) window.wrLog('lineup.compute', e); return null; }
    }, [myRoster, currentLeague, playersData, statsData, timeRecomputeTs, ctxTick]);

    const [formWindow, setFormWindow] = React.useState(5); // rolling-PPG window: 3 | 5 | 8 | 'season'
    const [openSlot, setOpenSlot] = React.useState(null);  // slot idx whose picker is expanded
    const [workingAssign, setWorkingAssign] = React.useState({}); // slotIdx -> pid (the user's working lineup)
    const [applyOpen, setApplyOpen] = React.useState(false);      // phone-only: WR.ActionBar apply/push sheet (inert off-phone)
    const [phoneView, setPhoneView] = React.useState('week');     // phone Game Day: 'week' (matchup + lineup) | 'season' (outlook + schedule)
    const [appliedMoves, setAppliedMoves] = React.useState(null); // phone: swap list shown after Apply Optimal ({sl,cur,opt,gain}[])

    const GOLD = 'var(--gold, #d4af37)', SILVER = 'var(--silver, #9aa0a6)', TEXT = 'var(--text, #e8e8ea)';
    const GREEN = 'var(--k-2ecc71, #2ecc71)', RED = 'var(--k-e74c3c, #e74c3c)', AMBER = 'var(--k-f0a500, #f0a500)';
    const PANEL = 'var(--panel, #15151b)', LINE = 'var(--ov-4, rgba(255,255,255,0.08))';
    // Shared viewport seam (js/shared/viewport.js). isNarrow (≤900, threshold
    // unchanged) collapses the right rail below the main column; isPhone (<768)
    // drives the phone column-set + touch sizing — the tablet (768–1023) and
    // desktop (≥1024) tiers render exactly as before.
    const _vp = window.WR.useViewport();
    const isNarrow = _vp.width <= 900;
    const isPhone = !!_vp.isPhone;
    // Phone micro-type floor (plan D7): sub-0.65rem labels read at ~9px — lift
    // them to 0.7rem at the phone tier only; other tiers get the exact literal.
    const fz = s => (isPhone && parseFloat(s) < 0.65 ? '0.7rem' : s);
    // Free drops the Mtch column (A–F matchup grade is a Pro interpretation).
    // Phone drops the Form/Hi/Lo columns so rows fit 375px with no horizontal
    // scroll — form stats resurface inside the row-tap expand instead.
    const GRID = isPhone
        ? (pro ? '50px minmax(0,1fr) 54px 34px' : '50px minmax(0,1fr) 54px')
        : (pro ? '50px minmax(0,1fr) 58px 50px 48px 38px 38px' : '50px minmax(0,1fr) 58px 48px 38px 38px');
    const SLOT_DISPLAY_ORDER = { QB: 1, RB: 2, WR: 3, TE: 4, REC_FLEX: 5, FLEX: 6, WRTQ: 7, SUPER_FLEX: 8, K: 20, DEF: 21, IDP_FLEX: 30, DL: 31, LB: 32, DB: 33, WILDCARD: 40 };
    const BENCH = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);
    const OBJ_LABEL = { floor: 'Floor · safe (win-now)', median: 'Median · balanced', ceiling: 'Ceiling · upside (rebuild)' };

    function pmeta(pid) {
        const p = (playersData && playersData[pid]) || {};
        const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(pid);
        return { name, pos: normPos(p.position) || p.position || '', team: p.team || '' };
    }
    const gradeColor = g => (g === 'A' ? GREEN : g === 'B' ? GOLD : g === 'C' ? SILVER : g === 'D' ? AMBER : RED);

    // ── Starting slots (aligned with roster.starters order) + display order ──
    const startingSlots = React.useMemo(() => {
        if (!SS) return [];
        const out = [];
        let k = 0;
        (currentLeague && currentLeague.roster_positions || []).forEach(raw => {
            const s = SS.normSlot(raw);
            if (BENCH.has(s)) return;
            const elig = SS.FLEX_ALLOWED[s] || (SS.BASE_POSITIONS.has(s) ? [s] : null);
            if (!elig) { k++; return; } // unknown starting slot — keep starters[] alignment
            out.push({ idx: k, slotName: s, elig });
            k++;
        });
        return out;
    }, [currentLeague]);

    // Current lineup from the platform (roster.starters aligns with non-bench slots).
    const currentAssign = React.useMemo(() => {
        const arr = (myRoster && myRoster.starters) || [];
        const cur = {};
        startingSlots.forEach(sl => { const pid = arr[sl.idx]; if (pid && String(pid) !== '0') cur[sl.idx] = String(pid); });
        return cur;
    }, [myRoster, startingSlots]);

    // Reset the working lineup to the platform lineup ONLY when the league or
    // the platform starters actually change — keyed on a stable string so an
    // incidental re-render never wipes the user's in-progress edits / open slot.
    const lineupKey = (currentLeague && (currentLeague.league_id || currentLeague.id) || '') + '|' + ((myRoster && myRoster.starters) || []).join(',');
    React.useEffect(() => { setWorkingAssign(currentAssign); setOpenSlot(null); }, [lineupKey]);

    // Load real NFL matchup context (opponent + Vegas implied total/spread +
    // weather) for the current week, then recompute projections once it lands.
    React.useEffect(() => {
        const NC = window.App && window.App.NflContext;
        if (!NC || !NC.loadCurrent) return;
        let alive = true;
        NC.loadCurrent(currentLeague && currentLeague.season).then(map => {
            if (alive && map && Object.keys(map).length) setCtxTick(t => t + 1);
        }).catch(() => {});
        return () => { alive = false; };
    }, [lineupKey]);

    // ── Weekly opponent (head-to-head): resolve, project, forecast ──
    const [oppRosterId, setOppRosterId] = React.useState(null);
    const [showOpp, setShowOpp] = React.useState(false);
    React.useEffect(() => {
        const M = window.App && window.App.Matchup;
        if (!M || !myRoster || !currentLeague) return;
        let alive = true; setOppRosterId(null);
        const wk = WP && WP.currentWeek ? WP.currentWeek() : 1;
        M.resolveOpponentRosterId({ league: currentLeague, myRosterId: myRoster.roster_id, week: wk })
            .then(id => { if (alive) setOppRosterId(id != null ? String(id) : null); })
            .catch(() => {});
        return () => { alive = false; };
    }, [lineupKey]);
    const oppResult = React.useMemo(() => {
        if (!WP || !oppRosterId || !currentLeague) return null;
        const oppRoster = (currentLeague.rosters || []).find(r => String(r.roster_id) === String(oppRosterId));
        if (!oppRoster) return null;
        try { return { roster: oppRoster, res: WP.optimalForRoster(oppRoster, currentLeague, { playersData, statsData, priorData: stats2025Data, objective: 'median' }) }; }
        catch (e) { if (window.wrLog) window.wrLog('lineup.oppProject', e); return null; }
    }, [oppRosterId, currentLeague, playersData, statsData, timeRecomputeTs, ctxTick]);

    // ── Game Day Central: DvP, season schedule rail, Alex note, MFL push ──
    const [seasonData, setSeasonData] = React.useState(null);
    const [note, setNote] = React.useState('');
    const [submit, setSubmit] = React.useState({ status: 'idle', msg: '' });
    // Real DvP: spin up the SOS engine (18-week defense-vs-position rankings),
    // then bump ctxTick so projections recompute with matchup context applied.
    React.useEffect(() => {
        const SOS = window.App && window.App.SOS;
        if (!SOS || !SOS.initialize) return;
        let alive = true;
        SOS.initialize(currentLeague && currentLeague.season, playersData, () => { if (alive) setCtxTick(t => t + 1); });
        return () => { alive = false; };
    }, [lineupKey]);

    // Load Sleeper's own published weekly projections so start/sit uses the same
    // number the owner sees in Sleeper (scored to this league), then recompute.
    React.useEffect(() => {
        const SP = window.App && window.App.SleeperProj;
        if (!SP || !SP.loadCurrent) return;
        let alive = true;
        SP.loadCurrent(currentLeague && currentLeague.season).then(wk => { if (alive && wk) setCtxTick(t => t + 1); }).catch(() => {});
        const onProj = () => { if (alive) setCtxTick(t => t + 1); };
        window.addEventListener('wr:proj-updated', onProj);
        return () => { alive = false; window.removeEventListener('wr:proj-updated', onProj); };
    }, [lineupKey]);

    // Full-season schedule + win projection for the right rail. Wait until the
    // main projection is ready (non-zero) before building/caching — otherwise an
    // early run (stats prop not yet populated) would cache an all-zero season.
    const _projReady = !!(result && result.optimal && result.optimal.total > 0);
    React.useEffect(() => {
        const Sch = window.App && window.App.Schedule;
        if (!Sch || !Sch.buildSeason || !myRoster || !currentLeague || !_projReady) return;
        let alive = true;
        Sch.buildSeason({ league: currentLeague, myRoster, playersData, statsData, stats2025Data })
            .then(d => { if (alive && d) setSeasonData(d); })
            .catch(() => {});
        return () => { alive = false; };
    }, [lineupKey, ctxTick, _projReady]);

    // Alex's game-day note: a stable weekly briefing off the CURRENT lineup +
    // matchup (not the working edits). Seeded template renders instantly; AI
    // upgrades it in the background when reachable (falls back to the template).
    function buildNoteFacts() {
        if (!result || !result.optimal) return null;
        const proj = result.projections;
        const curIds = Object.values(currentAssign).filter(Boolean);
        // MFL never exposes platform starters (starters:[]) — fall back to the
        // optimal lineup so the note forecasts the same lineup as the hero.
        // With the fallback there IS no visible bench gap: benchPts reads 0 and
        // no upgrade is pitched (a delta vs an empty platform lineup would
        // claim the whole optimal total is "stranded on the bench").
        const noPlatformLineup = !curIds.length;
        const noteIds = noPlatformLineup ? result.optimal.starters.map(s => String(s.pid)) : curIds;
        const curTotal = noteIds.reduce((s, pid) => { const p = proj[pid]; return s + (p && p.available ? (p.points[result.objective] || 0) : 0); }, 0);
        const benchPts = noPlatformLineup ? 0 : Math.round((result.optimal.total - curTotal) * 10) / 10;
        let topStart = null;
        if (!noPlatformLineup) (result.delta && result.delta.startInstead || []).forEach(s => { if (!topStart || s.pts > topStart.pts) topStart = s; });
        let winPct = null, oppName = null, margin = null;
        const M = window.App && window.App.Matchup;
        if (M && oppResult && oppResult.res) {
            const oppOpt = oppResult.res.optimal.starters.map(s => s.pid);
            const fc = M.forecast(M.dist(noteIds, proj, 'median'), M.dist(oppOpt, oppResult.res.projections, 'median'));
            winPct = fc.winPct; margin = fc.margin;
            const users = (currentLeague && currentLeague.users) || [];
            const u = users.find(x => String(x.user_id) === String(oppResult.roster.owner_id));
            oppName = (oppResult.roster.metadata && oppResult.roster.metadata.team_name) || (u && u.display_name) || ('Team ' + oppResult.roster.roster_id);
        }
        const injuries = noteIds.map(pid => { const p = proj[pid]; const st = p && p.injuryStatus; return st ? { name: pmeta(pid).name, status: st } : null; }).filter(Boolean);
        const topName = topStart ? pmeta(topStart.pid).name : null;
        const byeWatch = (seasonData && seasonData.byeWatch) || [];
        const topBye = byeWatch.length ? byeWatch[0] : null;   // worst upcoming bye week
        return {
            week: result.week, benchPts, topStart, topName, winPct, oppName, margin, injuries, mode: result.mode, topBye,
            ctx: { week: result.week, winPct, margin, opponent: oppName, pointsLeftOnBench: benchPts, topUpgrade: topName, topUpgradeSlot: topStart ? topStart.slot : null, injuries: injuries.map(i => i.name + ' (' + i.status + ')'), byeWatch: byeWatch.slice(0, 3).map(b => ({ week: b.week, count: b.count, unfilled: b.unfilled, reason: b.reason, positions: b.positions })), objective: result.objective, mode: result.mode },
        };
    }
    function seededNote(f) {
        const AV = window.AlexVoice;
        if (!AV) return '';
        const seed = (currentLeague && (currentLeague.league_id || currentLeague.id) || '') + '|w' + f.week;
        let lead;
        if (f.winPct != null && f.oppName) {
            // Thresholds match the hero's win% coloring: ≥55 favored, ≤45 uphill.
            if (f.winPct >= 55) lead = AV.pick(seed + 'a', ['You’re favored this week', 'The numbers like your side', 'You’ve got the edge this week']) + ' — about ' + f.winPct + '% to beat ' + f.oppName + '.';
            else if (f.winPct > 45) lead = AV.pick(seed + 'a', ['Coin-flip week', 'This one’s tight', 'Dead heat']) + ' against ' + f.oppName + ' (~' + f.winPct + '%).';
            else lead = AV.pick(seed + 'a', ['Uphill week', 'You’re the underdog', 'Tough draw']) + ' vs ' + f.oppName + ' (~' + f.winPct + '%) — chase ceiling.';
        } else {
            lead = AV.pick(seed + 'a', ['Let’s set the week', 'Here’s your week', 'Locking in the lineup']) + '.';
        }
        let mid;
        if (f.benchPts >= 1 && f.topName) mid = ' ' + AV.pick(seed + 'b', ['You’re leaving ' + f.benchPts + ' on the bench', 'There’s ' + f.benchPts + ' sitting on your bench', f.benchPts + ' points are stranded on the bench']) + ' — ' + f.topName + (f.topStart && f.topStart.slot ? ' into your ' + String(f.topStart.slot).replace('_', ' ') : '') + ' is the move.';
        else mid = ' ' + AV.pick(seed + 'b', ['Lineup’s optimal', 'Nothing left on the table', 'Your best is already in']) + ' — no changes needed.';
        let tail = '';
        if (f.injuries && f.injuries.length) tail = ' ' + AV.pick(seed + 'c', ['Keep an eye on', 'Watch', 'Monitor']) + ' ' + AV.joinNatural(f.injuries.map(i => i.name)) + '.';
        let byeTail = '';
        if (f.topBye && (f.topBye.unfilled || f.topBye.count >= 2)) {
            const b = f.topBye;
            // Only blame byes when bye starters actually drive the hole —
            // count===0 means a roster gap (position unrostered / players OUT).
            const byeDriven = b.reason ? b.reason === 'bye' : b.count > 0;
            if (byeDriven) {
                const c = {}; (b.positions || []).forEach(p => { c[p] = (c[p] || 0) + 1; });
                const posLabel = Object.keys(c).map(p => c[p] > 1 ? c[p] + ' ' + p + 's' : p).join(' + ');
                byeTail = ' ' + AV.pick(seed + 'd', ['Bye watch —', 'Plan ahead —', 'Down the road —']) + ' Week ' + b.week + (b.unfilled ? ' leaves a hole' : ' you’re thin') + (posLabel ? ' at ' + posLabel : '') + ', so line up cover.';
            } else if (b.unfilled) {
                byeTail = ' ' + AV.pick(seed + 'd', ['Plan ahead —', 'Heads up —', 'Down the road —']) + ' Week ' + b.week + ' you can’t field a full lineup as rostered, so line up cover.';
            }
        }
        return (lead + mid + tail + byeTail).trim();
    }
    React.useEffect(() => {
        // Composed note guard: the seeded copy is itself a rec ("X is the
        // move"), so the whole note is Pro-only — free renders no note (and
        // never builds facts, so no optimizer output is computed for free).
        // Future format carve-outs (cross-track C5) compose in here, e.g.
        // `pro && isDynastyFormat`. The AV.enhance AI upgrade below is
        // additionally behind hasAmbientAI() (ambient-AI policy seam) — a Pro
        // user without AI still keeps the seeded template.
        const noteAllowed = pro;
        if (!noteAllowed) { setNote(''); return; }
        if (!_projReady) return;                 // wait for real projections (avoid a stale AI-note cache)
        const facts = buildNoteFacts();
        if (!facts) { setNote(''); return; }
        const seeded = seededNote(facts);
        setNote(seeded);
        let alive = true;
        const AV = window.AlexVoice;
        if (AV && AV.enhance && (typeof AV.hasAmbientAI !== 'function' || AV.hasAmbientAI())) {
            // Bucket win% into the cache key so a materially different matchup
            // outlook re-generates rather than reusing an early note. v2: the
            // facts source changed (optimal-lineup fallback) — don't let notes
            // cached off the old empty-lineup facts survive the fix.
            const wpBucket = facts.winPct == null ? 'na' : Math.round(facts.winPct / 10);
            AV.enhance({
                type: 'start-sit',
                message: 'Give me a punchy 1-2 sentence game-day coaching note for my fantasy team this week. Are we favored? Any must-start upgrade sitting on the bench? Any injuries to watch, or an upcoming bye-week hole to plan for? Natural prose, no lists, no sign-off.',
                context: JSON.stringify(facts.ctx),
                fallback: seeded,
                cacheKey: 'gd-note-v2-' + lineupKey + '-w' + facts.week + '-' + wpBucket + (facts.topBye ? '-b' + facts.topBye.week + (facts.topBye.unfilled ? 'x' : '') : ''),
            }).then(txt => { if (alive && txt && typeof txt === 'string') setNote(txt); }).catch(() => {});
        }
        return () => { alive = false; };
    }, [lineupKey, ctxTick, oppRosterId, _projReady, seasonData]);

    // MFL is the only platform with a public lineup-write API (Sleeper has none).
    const _plat = (window.App && window.App.Matchup && window.App.Matchup._platform) ? window.App.Matchup._platform(currentLeague) : 'sleeper';
    const isMfl = _plat === 'mfl';
    const mflApiKey = (window.S && window.S._mflApiKey) || (function () { try { return sessionStorage.getItem('mfl_api_key') || localStorage.getItem('mfl_api_key'); } catch (e) { return null; } })();

    // MFL requires a login COOKIE (not the API key) to set a lineup. Keep only the
    // session token (sessionStorage, cleared on tab close); the password is used
    // once to obtain it and never stored.
    const [mflCookie, setMflCookie] = React.useState(() => { try { return sessionStorage.getItem('mfl_write_cookie') || ''; } catch (e) { return ''; } });
    const [mflHost, setMflHost] = React.useState(() => { try { return sessionStorage.getItem('mfl_write_host') || ''; } catch (e) { return ''; } });
    const [mflUser, setMflUser] = React.useState('');
    const [mflPass, setMflPass] = React.useState('');
    const [mflAuthBusy, setMflAuthBusy] = React.useState(false);
    const [mflAuthErr, setMflAuthErr] = React.useState('');
    async function doMflLogin() {
        if (!window.MFL || !window.MFL.mflLogin) { setMflAuthErr('MFL connector unavailable.'); return; }
        if (!mflUser || !mflPass) { setMflAuthErr('Enter your MFL username and password.'); return; }
        setMflAuthBusy(true); setMflAuthErr('');
        try {
            const yr = currentLeague.season || (window.S && window.S.mflYear);
            const out = await window.MFL.mflLogin({ username: mflUser, password: mflPass, year: yr });
            try { sessionStorage.setItem('mfl_write_cookie', out.cookie); if (out.host) sessionStorage.setItem('mfl_write_host', out.host); } catch (e) {}
            setMflCookie(out.cookie); setMflHost(out.host || ''); setMflPass('');
        } catch (e) { setMflAuthErr((e && e.message) || 'MFL login failed.'); }
        finally { setMflAuthBusy(false); }
    }
    function mflDisconnect() {
        try { sessionStorage.removeItem('mfl_write_cookie'); sessionStorage.removeItem('mfl_write_host'); } catch (e) {}
        setMflCookie(''); setMflHost(''); setSubmit({ status: 'idle', msg: '' });
    }
    async function pushToMfl() {
        const MFL = window.MFL;
        if (!MFL || !MFL.submitLineup) { setSubmit({ status: 'error', msg: 'MFL connector unavailable.' }); return; }
        // Fail closed: if any starting slot TYPE wasn't recognized (so it was
        // dropped from startingSlots), we'd under-submit and MFL's replace-all
        // would bench it. Block rather than silently overwrite.
        const trueStartCount = (currentLeague.roster_positions || []).filter(p => { const s = SS.normSlot(p); return s && !BENCH.has(s); }).length;
        if (startingSlots.length < trueStartCount) {
            setSubmit({ status: 'error', msg: 'Your lineup has a slot type we don’t fully support yet — set this lineup on MFL directly to be safe.' });
            return;
        }
        // MFL's lineup import is REPLACE-ALL: any starting slot we omit gets
        // benched. Refuse to push unless every starting slot is filled.
        const emptySlots = startingSlots.filter(sl => !workingAssign[sl.idx]);
        if (emptySlots.length) {
            // Free has no "Apply Optimal" button — don't reference it.
            setSubmit({ status: 'error', msg: 'Fill all ' + startingSlots.length + ' starting slots first — ' + emptySlots.map(s => s.slotName.replace('_', ' ')).join(', ') + ' empty. ' + (pro ? 'Tap “Apply Optimal” to fill them. ' : '') + 'MFL benches anyone left out.' });
            return;
        }
        const starterIds = startingSlots.map(sl => workingAssign[sl.idx]).filter(Boolean);
        setSubmit({ status: 'submitting', msg: '' });
        try {
            await MFL.submitLineup({
                // Prefer the league being VIEWED (session globals reflect only the
                // last-connected MFL league — matches league-detail/draft-room).
                leagueId: currentLeague._mflLeagueId || String(currentLeague.id || '').replace(/^mfl_/, '').replace(/_\d+$/, '') || (window.S && window.S.mflLeagueId),
                year: currentLeague.season || (window.S && window.S.mflYear),
                week: result.week,
                franchiseId: myRoster.roster_id,
                starterIds,
                mflByPid: myRoster._mflPlayerIds || null,
                cookie: mflCookie || undefined,
                host: mflHost || undefined,
                apiKey: mflApiKey,
            });
            setSubmit({ status: 'done', msg: 'Lineup submitted to MFL for Week ' + result.week + '.' });
        } catch (e) {
            const msg = (e && e.message) || 'MFL rejected the lineup — set it on MFL directly.';
            // If the session expired, drop the cookie so the UI prompts a reconnect.
            if (/authoriz|expired|not\s*log|logg?ed?[\s-]?in|session/i.test(msg)) mflDisconnect();
            setSubmit({ status: 'error', msg });
        }
    }

    // MFL rosters don't expose current starters (starters:[]), so the builder
    // would start all-empty. Seed the working lineup from the optimal build once
    // projections are ready, so the table starts full and the completeness guard
    // is satisfiable. (We can't show MFL's actual current starters — the rosters
    // export doesn't include them.)
    const _optReady = !!(result && result.optimal && result.optimal.starters && result.optimal.starters.length);
    React.useEffect(() => {
        // Pro only: the seed IS the optimizer's optimal lineup. Free MFL
        // users start from an empty table and set slots manually (the free
        // builder experience); the push guard message tells them to fill all.
        if (!pro) return;
        if (!isMfl || !_optReady) return;
        if (Object.keys(currentAssign).length || Object.keys(workingAssign).length) return; // platform starters, or user already editing
        const byName = {};
        result.optimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
        const next = {};
        startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) next[sl.idx] = String(arr.shift()); });
        if (Object.keys(next).length) setWorkingAssign(next);
    }, [lineupKey, isMfl, _optReady]);

    // No whole-tab gate: the partial free/Pro split above (`pro`) supersedes
    // the old STARTSIT_DEPTH block — free users enter and use the manual
    // builder; only the optimizer layer is locked inline.

    if (!WP || !SS) {
        return <div style={{ padding: '48px 24px', color: SILVER }}>Start/Sit engine not loaded.</div>;
    }
    if (!result || !result.optimal || !result.optimal.starters.length) {
        return (
            <div style={{ padding: '56px 24px', textAlign: 'center', color: SILVER, maxWidth: '520px', margin: '0 auto' }}>
                <div style={{ fontSize: '1.1rem', color: GOLD, fontWeight: 600, marginBottom: '10px', letterSpacing: '0.04em' }}>LINEUP COMMAND CENTER</div>
                <div>No weekly projections yet. This lights up in-season once roster and stat data are synced — start/sit guidance is built from each player's role, recent form, and matchup, scored through your league's exact settings.</div>
            </div>
        );
    }

    const objective = result.objective;
    const projOf = pid => (pid && result.projections[pid]) || null;
    const objPts = pid => { const p = projOf(pid); return p && p.available !== false ? (p.points[objective] || 0) : (p ? (p.points[objective] || 0) : 0); };
    const formOf = pid => window.App.WeeklyProj.formStats(pid, formWindow);

    // Roster pools.
    const resSet = new Set((myRoster && myRoster.reserve) || []);
    const taxiSet = new Set((myRoster && myRoster.taxi) || []);
    const activeIds = ((myRoster && myRoster.players) || []).filter(id => id && !resSet.has(id) && !taxiSet.has(id)).map(String);
    const usedPids = new Set(Object.values(workingAssign).filter(Boolean).map(String));

    function eligibleFor(slot) {
        return activeIds
            .filter(pid => slot.elig.includes(normPos((playersData[pid] || {}).position) || (playersData[pid] || {}).position))
            .filter(pid => !usedPids.has(pid) || String(workingAssign[slot.idx]) === pid)
            .sort((a, b) => objPts(b) - objPts(a));
    }

    // Totals (objective-based, matching the solver).
    const workingTotal = Object.values(workingAssign).filter(Boolean).reduce((s, pid) => s + objPts(pid), 0);
    const optimalTotal = result.optimal.total;
    const benchPts = Math.round((optimalTotal - workingTotal) * 10) / 10;
    const isOptimal = benchPts <= 0.05;
    const _scaleMax = Math.max(1, ...result.optimal.starters.map(s => { const p = projOf(s.pid); return (p && p.points && p.points.ceiling) || 0; }));

    function applyOptimal() {
        const byName = {};
        result.optimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
        const next = {};
        startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) next[sl.idx] = String(arr.shift()); });
        setWorkingAssign(next); setOpenSlot(null);
    }

    const formWinLabel = formWindow === 'season' ? 'SZN' : 'L' + formWindow;
    // Phone: hit-padding, not bigger glyphs (plan D7) — action buttons hit 44px.
    const winBtn = active => ({ padding: isPhone ? '9px 12px' : '3px 8px', fontSize: fz('0.64rem'), fontWeight: 700, letterSpacing: '0.03em', cursor: 'pointer', borderRadius: '4px', border: `1px solid ${active ? GOLD : LINE}`, background: active ? 'rgba(212,175,55,0.14)' : 'transparent', color: active ? GOLD : SILVER });
    const actBtn = { padding: isPhone ? '11px 16px' : '5px 12px', minHeight: isPhone ? '44px' : undefined, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer', borderRadius: '5px', border: `1px solid ${LINE}`, background: 'transparent', color: SILVER };

    function wxTag(weather) {
        if (!weather) return null;
        if (weather.indoor) return <span style={{ color: SILVER, opacity: 0.5, fontSize: fz('0.6rem'), marginLeft: '6px' }}>dome</span>;
        const d = String(weather.display || '').toLowerCase();
        let tag = null;
        if (/wind/.test(d)) tag = 'WIND';
        else if (/snow|sleet|flurr/.test(d)) tag = 'SNOW';
        else if (/rain|shower|storm/.test(d)) tag = 'RAIN';
        else if (Number.isFinite(Number(weather.temp)) && Number(weather.temp) <= 20) tag = 'COLD';
        if (!tag) return null;
        const tip = (weather.display || '') + (weather.temp != null ? ' · ' + Math.round(weather.temp) + '°' : '');
        return <span title={tip} style={{ color: AMBER, fontSize: fz('0.56rem'), fontWeight: 700, marginLeft: '6px', letterSpacing: '0.03em' }}>{tag}</span>;
    }

    // ── Player field cells (shared by slot rows, picker rows, bench rows) ──
    function PlayerCells({ pid }) {
        if (!pid) {
            return (<React.Fragment>
                <span style={{ color: SILVER, opacity: 0.6, fontStyle: 'italic' }}>Empty — tap to set</span>
                <span />{pro ? <span /> : null}{!isPhone ? <React.Fragment><span /><span /><span /></React.Fragment> : null}
            </React.Fragment>);
        }
        const meta = pmeta(pid);
        const proj = projOf(pid);
        const pts = proj && proj.points;
        const grade = (proj && proj.matchupGrade) || '—';
        const opp = proj && proj.opponent;
        const status = (proj && proj.injuryStatus) || '';
        const unavail = proj && proj.available === false;
        const fs = isPhone ? null : formOf(pid); // phone drops the form cells (shown on row-tap expand)
        const weather = proj && proj.weather;
        const num = (v, c) => <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: c || SILVER }}>{v}</span>;
        return (<React.Fragment>
            <span style={{ minWidth: 0, overflow: 'hidden' }}>
                <span style={{ color: unavail ? SILVER : TEXT, fontWeight: 500, textDecoration: unavail ? 'line-through' : 'none' }}>{meta.name}</span>
                <span style={{ color: SILVER, fontSize: '0.7rem', marginLeft: '6px' }}>{meta.pos}{meta.team ? ' · ' + meta.team : ''}</span>
                {opp && opp.abbr ? <span style={{ color: SILVER, fontSize: '0.66rem', marginLeft: '6px', opacity: 0.85 }}>{opp.home ? 'vs ' : '@ '}{opp.abbr}</span> : null}
                {wxTag(weather)}
                {status ? <span style={{ color: status === 'BYE' ? SILVER : AMBER, fontSize: fz('0.62rem'), marginLeft: '6px', fontWeight: 700 }}>{status}</span> : null}
            </span>
            <span style={{ textAlign: 'right' }}>
                <span style={{ color: TEXT, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pts ? (pts[objective] || 0).toFixed(1) : '—'}</span>
                {pro && pts ? <span style={{ display: 'block', color: SILVER, opacity: 0.6, fontSize: fz('0.56rem'), fontVariantNumeric: 'tabular-nums' }}>{pts.floor.toFixed(0)}–{pts.ceiling.toFixed(0)}</span> : null}
            </span>
            {pro ? <span style={{ textAlign: 'center' }}><span title={opp && opp.abbr ? ('vs ' + opp.abbr) : ('Matchup ' + grade)} style={{ fontWeight: 700, color: gradeColor(grade), fontSize: '0.78rem' }}>{grade}</span></span> : null}
            {!isPhone ? (<React.Fragment>
                {num(fs ? fs.rollingPPG.toFixed(1) : '—', TEXT)}
                {num(fs ? fs.high.toFixed(1) : '—', GREEN)}
                {num(fs ? fs.low.toFixed(1) : '—', SILVER)}
            </React.Fragment>) : null}
        </React.Fragment>);
    }

    const projTip = 'Projected points — optimizing for your ' + (objective === 'ceiling' ? 'ceiling (upside)' : objective === 'floor' ? 'floor (safe)' : 'median (balanced)') + ' strategy';
    const headerRow = (
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: '7px 14px', borderBottom: `1px solid ${LINE}`, fontSize: fz('0.58rem'), letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>
            <span title="Roster slot">Slot</span>
            <span title="Player · position · NFL team · this week's opponent">Player</span>
            <span title={projTip} style={{ textAlign: 'right' }}>Proj</span>
            {pro ? <span title="Matchup grade A (great) → F (tough), from the opponent's Vegas implied total" style={{ textAlign: 'center' }}>Mtch</span> : null}
            {!isPhone ? (<React.Fragment>
                <span title={'Rolling average over the last ' + (formWindow === 'season' ? 'full season' : formWindow + ' weeks') + ' (actual points)'} style={{ textAlign: 'right' }}>{formWinLabel}</span>
                <span title="Season high — most fantasy points in a week" style={{ textAlign: 'right' }}>Hi</span>
                <span title="Season low — fewest points in a played week" style={{ textAlign: 'right' }}>Lo</span>
            </React.Fragment>) : null}
        </div>
    );

    // ── Matchup forecast: your WORKING lineup vs the opponent's ideal ──
    let matchup = null;
    {
        const M = window.App && window.App.Matchup;
        // No matchup card without at least one working starter — forecasting an
        // empty lineup would read as a confident 1% off a zero-point side.
        const myStarters = Object.values(workingAssign).filter(Boolean);
        if (M && oppResult && oppResult.res && myStarters.length) {
            const oppProj = oppResult.res.projections;
            const oppOpt = oppResult.res.optimal.starters;
            const myDist = M.dist(myStarters, result.projections, 'median');
            const oppDist = M.dist(oppOpt.map(s => s.pid), oppProj, 'median');
            const fc = M.forecast(myDist, oppDist);
            const oppCurTotal = M.dist((oppResult.roster.starters || []).filter(Boolean), oppProj, 'median').mean;
            const users = (currentLeague && currentLeague.users) || [];
            const u = users.find(x => String(x.user_id) === String(oppResult.roster.owner_id));
            const oppName = (oppResult.roster.metadata && oppResult.roster.metadata.team_name) || (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || ('Team ' + oppResult.roster.roster_id);
            const medOf = (pid, proj) => (pid && proj[pid] && proj[pid].points ? proj[pid].points.median : 0);

            // Slot-by-slot head-to-head: my WORKING player vs their IDEAL player,
            // aligned by slot-name occurrence (rosters share roster_positions).
            const theirByName = {}; oppOpt.forEach(s => { (theirByName[s.slot] = theirByName[s.slot] || []).push(s.pid); });
            const cursor = {};
            const dispSlots = [...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50));
            let myEdges = 0;
            const h2h = dispSlots.map(sl => {
                const myPid = workingAssign[sl.idx] || null;
                cursor[sl.slotName] = cursor[sl.slotName] || 0;
                const theirPid = (theirByName[sl.slotName] || [])[cursor[sl.slotName]++] || null;
                const myMed = medOf(myPid, result.projections), theirMed = medOf(theirPid, oppProj);
                if (myMed > theirMed) myEdges++;
                return { slot: sl.slotName, myPid, myMed, theirPid, theirMed };
            });
            // Position-group strength (each starter's projected pts summed by position).
            const myByPos = {}, theirByPos = {};
            myStarters.forEach(pid => { const p = normPos((playersData[pid] || {}).position) || '?'; myByPos[p] = (myByPos[p] || 0) + medOf(pid, result.projections); });
            oppOpt.forEach(s => { const p = normPos((playersData[s.pid] || {}).position) || '?'; theirByPos[p] = (theirByPos[p] || 0) + medOf(s.pid, oppProj); });
            const posStrength = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(p => myByPos[p] || theirByPos[p]).map(p => ({ pos: p, mine: myByPos[p] || 0, theirs: theirByPos[p] || 0 }));

            matchup = { fc, oppName, oppCurTotal, oppIdealTotal: oppResult.res.optimal.total, oppProj, h2h, posStrength, myEdges, slotCount: h2h.length };
        }
    }

    // ── MFL lineup push card (write to MyFantasyLeague) ──
    function renderMflPush() {
        if (!isMfl) return null;
        const s = submit.status;
        // Phone: 16px input font (iOS Safari zooms on focus below 16px) + 44px height.
        const inputStyle = { flex: '1 1 130px', minWidth: 0, padding: isPhone ? '10px 12px' : '7px 10px', minHeight: isPhone ? '44px' : undefined, background: 'var(--charcoal, #0e0e12)', border: `1px solid ${LINE}`, borderRadius: '5px', color: TEXT, fontSize: isPhone ? '16px' : '0.8rem' };
        return (
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '12px 16px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.66rem', letterSpacing: '0.07em', color: GOLD, fontWeight: 700 }}>PUSH LINEUP TO MFL</div>
                    {mflCookie ? <span onClick={mflDisconnect} style={{ fontSize: fz('0.62rem'), color: SILVER, cursor: 'pointer', padding: isPhone ? '12px 0 12px 12px' : 0 }}>● connected · disconnect</span> : null}
                </div>
                {!mflCookie ? (
                    <div style={{ marginTop: '8px' }}>
                        <div style={{ fontSize: '0.72rem', color: SILVER, marginBottom: '8px', lineHeight: 1.5 }}>MFL requires your login to set a lineup (the API key can’t). Your password is used once to get a session token — only the token is kept (this tab), never the password.</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <input value={mflUser} onChange={e => setMflUser(e.target.value)} placeholder="MFL username" autoComplete="off" style={inputStyle} />
                            <input value={mflPass} onChange={e => setMflPass(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doMflLogin(); }} placeholder="MFL password" type="password" autoComplete="off" style={inputStyle} />
                            <button onClick={doMflLogin} disabled={mflAuthBusy} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.10)', opacity: mflAuthBusy ? 0.6 : 1 }}>{mflAuthBusy ? 'Connecting…' : 'Connect'}</button>
                        </div>
                        {mflAuthErr ? <div style={{ fontSize: '0.7rem', color: RED, marginTop: '6px' }}>{mflAuthErr}</div> : null}
                    </div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
                        <div style={{ fontSize: '0.72rem', color: SILVER, minWidth: 0 }}>
                            {s === 'done' ? <span style={{ color: GREEN }}>{submit.msg}</span>
                                : s === 'error' ? <span style={{ color: RED }}>{submit.msg}</span>
                                    : 'Sets your working lineup as this week’s starters on MyFantasyLeague.'}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {s === 'confirm' ? (
                                <React.Fragment>
                                    <span style={{ fontSize: '0.7rem', color: AMBER }}>Overwrite Week {result.week} starters?</span>
                                    <button onClick={pushToMfl} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Confirm</button>
                                    <button onClick={() => setSubmit({ status: 'idle', msg: '' })} style={actBtn}>Cancel</button>
                                </React.Fragment>
                            ) : (
                                <button disabled={s === 'submitting'} onClick={() => setSubmit({ status: 'confirm', msg: '' })}
                                    style={{ ...actBtn, opacity: s === 'submitting' ? 0.5 : 1, cursor: s === 'submitting' ? 'not-allowed' : 'pointer', color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.10)' }}>
                                    {s === 'submitting' ? 'Submitting…' : s === 'done' ? 'Re-submit' : 'Submit to MFL'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Season schedule rail: outlook + week-by-week ──
    function renderRail() {
        const d = seasonData;
        const scheduleUnset = !!(d && d.scheduleUnset);
        const byeWatch = (d && d.byeWatch) || [];
        const byeLabel = (bw) => {
            const c = {}; (bw.positions || []).forEach(p => { c[p] = (c[p] || 0) + 1; });
            // count===0 = a roster-gap hole, not a bye week — never say "0 on bye".
            return Object.keys(c).map(p => c[p] > 1 ? c[p] + ' ' + p + 's' : p).join(', ') || (bw.count > 0 ? bw.count + ' on bye' : 'lineup hole');
        };
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: isNarrow ? 'static' : 'sticky', top: '16px' }}>
                {/* Season outlook (or a pre-season placeholder when no schedule yet) */}
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '14px 16px' }}>
                    <div style={{ fontSize: fz('0.64rem'), letterSpacing: '0.07em', color: SILVER, fontWeight: 600 }}>SEASON OUTLOOK</div>
                    {!pro ? (
                        // Free: raw current record only — proj record / PF / win% are
                        // season-sim (optimizer) outputs.
                        <React.Fragment>
                            {d && d.summary && d.summary.record ? (
                                <div style={{ display: 'flex', gap: '16px', margin: '8px 0 10px' }}>
                                    <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>NOW</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.record}</div></div>
                                </div>
                            ) : <div style={{ height: '8px' }} />}
                            {GatedRow ? <GatedRow title="Season projection" sub="Projected record, points-for and weekly win odds" feature={STARTSIT_FEAT} /> : null}
                        </React.Fragment>
                    ) : scheduleUnset ? (
                        <div style={{ color: SILVER, fontSize: '0.74rem', marginTop: '8px', lineHeight: 1.5 }}>Schedule posts closer to Week 1. Building your <span style={{ color: TEXT, fontWeight: 600 }}>Week 1</span> lineup now — record + win% light up once matchups are set.</div>
                    ) : d && d.summary ? (
                        <React.Fragment>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px' }}>
                                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: GOLD, fontVariantNumeric: 'tabular-nums' }}>{d.summary.projRecord}</span>
                                <span style={{ fontSize: fz('0.64rem'), color: SILVER }}>proj record</span>
                            </div>
                            <div style={{ display: 'flex', gap: '16px', marginTop: '9px' }}>
                                <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>NOW</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.record}</div></div>
                                <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>PROJ PF</div><div style={{ fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{d.summary.projPF}</div></div>
                                {d.summary.winPct != null ? <div><div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.04em' }}>WIN%</div><div style={{ fontWeight: 700, color: TEXT }}>{d.summary.winPct}%</div></div> : null}
                            </div>
                        </React.Fragment>
                    ) : <div style={{ color: SILVER, fontSize: '0.74rem', marginTop: '8px', opacity: 0.7 }}>Projecting your season…</div>}
                </div>

                {/* Bye watch — the weeks you're thinnest (works with or without a schedule) */}
                {byeWatch.length ? (
                    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '12px 16px' }}>
                        <div style={{ fontSize: fz('0.64rem'), letterSpacing: '0.07em', color: SILVER, fontWeight: 600, marginBottom: '6px' }}>BYE WATCH</div>
                        {byeWatch.map(bw => (
                            <div key={bw.week} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', padding: '3px 0', fontSize: '0.74rem' }}>
                                <span style={{ minWidth: 0 }}>
                                    <span style={{ color: bw.unfilled ? RED : AMBER, fontWeight: 700 }}>Wk {bw.week}</span>
                                    <span style={{ color: SILVER, marginLeft: '6px' }}>{byeLabel(bw)}{bw.unfilled && bw.count > 0 ? ' · no cover' : ''}</span>
                                </span>
                                <span style={{ color: bw.unfilled ? RED : AMBER, fontWeight: 800 }}>{bw.unfilled ? '⚠' : bw.count}</span>
                            </div>
                        ))}
                        {/* The raw bye listing is free; the "do X" line is a rec. */}
                        {pro ? <div style={{ fontSize: fz('0.62rem'), color: SILVER, opacity: 0.7, marginTop: '6px' }}>Plan waivers/draft around these.</div> : null}
                    </div>
                ) : null}

                {/* Week-by-week schedule */}
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontSize: fz('0.64rem'), letterSpacing: '0.07em', color: SILVER, fontWeight: 600 }}>SCHEDULE</div>
                    {scheduleUnset ? (
                        <div style={{ padding: '10px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.8, lineHeight: 1.5 }}>{pro ? 'Opponents + weekly win% appear here once your league posts the schedule.' : 'Opponents appear here once your league posts the schedule.'}</div>
                    ) : d && d.weeks ? d.weeks.map(w => {
                        const wp = pro ? w.winPct : null; // weekly win% is a Pro likelihood read
                        const color = w.result ? (w.result === 'W' ? GREEN : w.result === 'L' ? RED : SILVER) : (wp == null ? SILVER : wp >= 55 ? GREEN : wp <= 45 ? RED : GOLD);
                        const bye = w.byes || {};
                        return (
                            <div key={w.week} style={{ display: 'grid', gridTemplateColumns: '26px 1fr 52px', gap: '8px', alignItems: 'center', padding: '6px 14px', borderBottom: `1px solid ${LINE}`, background: w.isCurrent ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent' }}>
                                <span style={{ fontSize: fz('0.62rem'), color: w.isCurrent ? GOLD : SILVER, fontWeight: 700 }}>W{w.week}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                                    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '0.74rem', color: (w.isPast && !w.result) ? SILVER : TEXT }}>{w.bye ? <span style={{ color: SILVER, opacity: 0.6 }}>bye</span> : w.oppName}</span>
                                    {bye.count ? <span title={bye.unfilled ? "You can't field a full lineup this week" : bye.count + ' of your starters on bye'} style={{ flex: '0 0 auto', fontSize: fz('0.56rem'), fontWeight: 700, color: bye.thin ? (bye.unfilled ? RED : AMBER) : SILVER }}>{bye.unfilled ? '⚠' : bye.count + '·b'}</span> : null}
                                </span>
                                <span style={{ textAlign: 'right', fontSize: '0.68rem', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                                    {w.result ? (w.result + (w.myProj != null ? ' ' + Math.round(w.myProj) : '')) : (wp != null ? wp + '%' : w.bye ? '—' : '·')}
                                </span>
                            </div>
                        );
                    }) : <div style={{ padding: '10px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>Loading schedule…</div>}
                </div>
            </div>
        );
    }

    // ══ PHONE (<768) — Game Day Central phone branch (iPhone program Phase 1).
    // EARLY RETURN: everything below the closing brace renders only off-phone,
    // so the desktop/tablet return underneath stays byte-identical. Kit
    // presence (wr-primitives.js loads earlier in the babel chain) is fixed
    // for the page's lifetime, so gating the return on it has no hook hazard.
    // Free/Pro: every phone surface re-pours gated content at the EXACT
    // existing `pro` boundaries — optimal hero/delta, matchup grades, win%,
    // breakdown and the Alex note stay Pro; the manual builder, raw
    // projections, bye listing and the MFL push stay free.
    const _kitReady = !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.CardList && window.WR.Sheet && window.WR.ActionBar);
    if (isPhone && _kitReady) {
        const HeroCard = window.WR.HeroCard, AssetRow = window.WR.AssetRow, CardList = window.WR.CardList, Sheet = window.WR.Sheet, ActionBar = window.WR.ActionBar;
        const MONO = 'var(--font-mono, "JetBrains Mono", monospace)';
        const MICRO = 'var(--text-micro, 0.6875rem)';
        const SLOT_SHORT = { SUPER_FLEX: 'SF', REC_FLEX: 'RF', FLEX: 'FLX', WRTQ: 'WRT', IDP_FLEX: 'IDP', WILDCARD: 'WC' };
        const dispSlots = [...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50));

        // Working-vs-platform dirtiness drives the ActionBar (P6). MFL rosters
        // never expose platform starters (currentAssign = {}), so any set slot
        // reads as "unpushed" — exactly when the push path matters.
        const dirty = startingSlots.some(sl => String(workingAssign[sl.idx] || '') !== String(currentAssign[sl.idx] || ''));

        // Optimal swap summary for the hero facts — the same per-slot
        // assignment walk as applyOptimal(), diffed against the working
        // lineup. Pro only (the optimizer layer).
        let swaps = [], topSwap = null;
        if (pro) {
            const byName = {};
            result.optimal.starters.forEach(s => { (byName[s.slot] = byName[s.slot] || []).push(s.pid); });
            const optAssign = {};
            startingSlots.forEach(sl => { const arr = byName[sl.slotName]; if (arr && arr.length) optAssign[sl.idx] = String(arr.shift()); });
            startingSlots.forEach(sl => {
                const cur = String(workingAssign[sl.idx] || ''), opt = String(optAssign[sl.idx] || '');
                if (cur === opt) return;
                const sw = { sl, cur, opt, gain: objPts(opt) - objPts(cur) };
                swaps.push(sw);
                if (!topSwap || sw.gain > topSwap.gain) topSwap = sw;
            });
        }
        const swapFacts = topSwap
            ? swaps.length + ' swap' + (swaps.length === 1 ? '' : 's') + ': ' + (topSwap.cur ? pmeta(topSwap.cur).name : 'Empty') + ' → ' + (topSwap.opt ? pmeta(topSwap.opt).name : 'Empty') + ' · ' + topSwap.sl.slotName.replace('_', ' ') + ' slot'
            : 'No swaps — your best lineup is in';

        // Apply Optimal, then show the moves it made as a list (owner ask).
        // Capture the swaps BEFORE applying (post-apply they recompute to []).
        const applyOptimalWithSummary = () => {
            const moves = swaps.slice();
            applyOptimal();
            if (moves.length) setAppliedMoves(moves);
        };

        // Matchup-grade verdict chip (Pro interpretation — mirrors the Mtch column gate).
        const gradeChip = (grade) => (
            <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 700, padding: '3px 8px', borderRadius: '5px', border: '1px solid ' + gradeColor(grade), color: gradeColor(grade), whiteSpace: 'nowrap' }}>{grade}</span>
        );

        // P1 slot row — the shipped phone column-set (GRID above: slot /
        // player / proj / mtch) recast as a WR.AssetRow: slot label rides the
        // tag, PROJ is the stat slot, the Pro matchup grade is the verdict
        // chip. Row tap = the EXISTING openSlot toggle.
        const slotRow = (sl) => {
            const pid = workingAssign[sl.idx] || null;
            const slotLabel = sl.slotName.replace('_', ' ');
            const open = openSlot === sl.idx;
            if (!pid) {
                return <AssetRow key={sl.idx} pos={SLOT_SHORT[sl.slotName] || sl.slotName} name="Empty — tap to set" tag={slotLabel}
                    slots={[{ label: 'PROJ', value: '—', tone: 'mute' }]} accent={open ? 'gold' : undefined}
                    onClick={() => setOpenSlot(open ? null : sl.idx)} />;
            }
            const meta = pmeta(pid), proj = projOf(pid), pts = proj && proj.points;
            const status = (proj && proj.injuryStatus) || '';
            const opp = proj && proj.opponent;
            const tag = [slotLabel, meta.team || 'FA', opp && opp.abbr ? (opp.home ? 'vs ' : '@ ') + opp.abbr : null, status || null].filter(Boolean).join(' · ');
            const atRisk = !!status || (proj && proj.available === false);
            return <AssetRow key={sl.idx} pos={meta.pos || '?'} name={meta.name} tag={tag}
                slots={[{ label: 'PROJ', value: pts ? (pts[objective] || 0).toFixed(1) : '—' }]}
                verdict={pro ? gradeChip((proj && proj.matchupGrade) || '—') : null}
                accent={open ? 'gold' : atRisk ? 'risk' : undefined}
                onClick={() => setOpenSlot(open ? null : sl.idx)} />;
        };

        // Eligible-player picker (openSlot) — a WR.Sheet instead of the
        // desktop inline expansion; rows drive the EXACT same assign/empty
        // setters. Form stats + the L3/L5/L8/SZN window ride here (the
        // Form/Hi/Lo columns stay dropped from phone rows).
        const openSl = openSlot != null ? startingSlots.find(sl => sl.idx === openSlot) : null;
        const openPid = openSl ? (workingAssign[openSl.idx] || null) : null;
        const openElig = openSl ? eligibleFor(openSl) : [];
        const openFs = openPid ? formOf(openPid) : null;
        const pickRow = (epid) => {
            const isCur = String(openPid) === String(epid);
            const meta = pmeta(epid), proj = projOf(epid), pts = proj && proj.points;
            const status = (proj && proj.injuryStatus) || '';
            const opp = proj && proj.opponent;
            const fs = formOf(epid);
            return <AssetRow key={epid} pos={meta.pos || '?'} name={meta.name}
                tag={[isCur ? 'IN' : null, meta.team || 'FA', opp && opp.abbr ? (opp.home ? 'vs ' : '@ ') + opp.abbr : null, status || null].filter(Boolean).join(' · ')}
                slots={[{ label: 'PROJ', value: pts ? (pts[objective] || 0).toFixed(1) : '—' }, { label: formWinLabel, value: fs ? fs.rollingPPG.toFixed(1) : '—', tone: 'mute' }]}
                verdict={pro ? gradeChip((proj && proj.matchupGrade) || '—') : null}
                accent={isCur ? 'gold' : undefined}
                onClick={() => { setWorkingAssign(w => ({ ...w, [openSl.idx]: epid })); setOpenSlot(null); }} />;
        };

        // P5 decision hero. Pro: optimal-vs-working delta + one-swap summary
        // + APPLY OPTIMAL → the existing applyOptimal(). Free: matchup
        // context + raw working total, optimizer teaser at the existing gate.
        const heroEl = pro ? (
            <HeroCard kicker="Optimizer"
                headline={isOptimal ? 'LINEUP OPTIMAL · ' + workingTotal.toFixed(1) + ' PROJ' : 'OPTIMAL LINEUP +' + benchPts.toFixed(1) + ' PROJ'}
                facts={isOptimal ? 'No changes needed · yours ' + workingTotal.toFixed(1) + ' = optimal ' + optimalTotal.toFixed(1) : swapFacts}
                cta={isOptimal ? null : 'APPLY OPTIMAL'} onCta={applyOptimalWithSummary} />
        ) : (
            <HeroCard kicker={'Week ' + result.week + ' · Game Day'}
                headline={'YOUR LINEUP ' + workingTotal.toFixed(1) + ' PTS'}
                facts={matchup ? 'vs ' + matchup.oppName + (matchup.oppCurTotal > 0 ? ' · them ' + matchup.oppCurTotal.toFixed(1) + ' (current lineup)' : '') : 'Tap a slot below to set your starters — the total updates live.'}>
                {GatedRow ? <div style={{ marginTop: '10px' }}><GatedRow title="Lineup optimizer" sub="Optimal lineup + points left on bench, floor–ceiling bands, matchup grades and win odds" feature={STARTSIT_FEAT} /></div> : null}
            </HeroCard>
        );

        const kpiTile = (label, value, sub, valColor) => (
            <div key={label} style={{ background: 'var(--black, #121217)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '9px', padding: '9px 11px' }}>
                <div style={{ fontFamily: MONO, fontSize: MICRO, color: 'var(--text-muted, #8B8B96)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.3rem', fontWeight: 700, color: valColor || TEXT, lineHeight: 1.15, marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                {sub ? <div style={{ fontFamily: MONO, fontSize: MICRO, color: SILVER, opacity: 0.65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '110px' }}>{sub}</div> : null}
            </div>
        );
        const goldDiv = (label) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 600, color: GOLD, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
                <span aria-hidden="true" style={{ flex: 1, height: '1px', background: 'rgba(212,175,55,0.25)' }} />
            </div>
        );
        const winColor = matchup && matchup.fc.winPct != null ? (matchup.fc.winPct >= 55 ? GREEN : matchup.fc.winPct <= 45 ? RED : GOLD) : SILVER;

        return (
            <div style={{ padding: '14px var(--wr-phone-gutter, 12px) 72px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* This Week ⇄ Season toggle (owner ask) — week = matchup +
                    lineup; season = outlook + schedule. */}
                <div className="wr-seg">
                    <button className={phoneView === 'week' ? 'is-on' : ''} onClick={() => setPhoneView('week')}>This Week</button>
                    <button className={phoneView === 'season' ? 'is-on' : ''} onClick={() => setPhoneView('season')}>Season</button>
                </div>

                {phoneView === 'week' ? (<React.Fragment>
                {/* Matchup + breakdown LEAD the week view (owner ask). Free
                    keeps the raw you-vs-their-current totals; win%, margin,
                    their-ideal and the breakdown stay Pro (existing gates). */}
                {matchup ? (
                    <React.Fragment>
                        {goldDiv('Matchup · vs ' + matchup.oppName)}
                        <div className="wr-kpi-strip">
                            {pro ? [
                                kpiTile('Win%', matchup.fc.winPct == null ? '—' : matchup.fc.winPct + '%', matchup.fc.margin == null ? null : (matchup.fc.margin >= 0 ? '+' : '') + matchup.fc.margin.toFixed(1) + ' margin', winColor),
                                kpiTile('You', matchup.fc.projMe.toFixed(1), 'working proj'),
                                kpiTile('Them', matchup.fc.projOpp.toFixed(1), matchup.oppName),
                                kpiTile('Their ideal', matchup.oppIdealTotal.toFixed(1), matchup.oppCurTotal > 0 ? 'current ' + matchup.oppCurTotal.toFixed(1) : 'current —'),
                            ] : [
                                kpiTile('You', matchup.fc.projMe.toFixed(1), 'working proj'),
                                kpiTile('Them', matchup.oppCurTotal > 0 ? matchup.oppCurTotal.toFixed(1) : '—', 'current lineup'),
                            ]}
                        </div>
                        {!pro && GatedRow ? <GatedRow title="Win probability" sub="Projected margin and your win odds this week" feature={STARTSIT_FEAT} /> : null}
                        {/* Matchup breakdown (toggle + position-strength / slot-by-slot
                            panel) removed on phone (owner ask 2026-07-12) — the Win% ·
                            You · Them · Their-ideal KPI row above carries the matchup
                            read; the verbose breakdown was noise on a small screen.
                            Desktop Game Day is a separate render and is untouched. */}
                    </React.Fragment>
                ) : null}

                {/* Alex game-day note as a card (note state is Pro-gated upstream: free = '') */}
                {note ? (
                    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: '6px', padding: '12px 14px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: fz('0.6rem'), fontWeight: 800, letterSpacing: '0.08em', color: GOLD, marginTop: '3px', whiteSpace: 'nowrap' }}>ALEX ·</span>
                        <span style={{ fontSize: '0.86rem', color: TEXT, lineHeight: 1.5 }}>{note}</span>
                        {/* Ask Alex follow-up: opens recon chat pre-loaded with the game-plan ask (crossover, owner ask 2026-07-13) */}
                        <button onClick={() => {
                            const msg = 'Walk me through my Week ' + result.week + ' game plan' + (matchup && matchup.oppName ? ' against ' + matchup.oppName : '') + ' — the start/sit calls worth a second look, where I can attack this matchup, and what would change your read before kickoff.';
                            try { window.dispatchEvent(new CustomEvent('wr:ask-alex', { detail: { message: msg } })); } catch (e) { /* chat seam unavailable */ }
                        }} style={{ flexShrink: 0, alignSelf: 'flex-start', background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.35)', borderRadius: '5px', color: GOLD, fontFamily: MONO, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.05em', padding: '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>💬 ASK</button>
                    </div>
                ) : null}

                {/* Optimizer + working lineup, below the matchup lead. */}
                {heroEl}
                <CardList groups={[{ label: 'Starters', sub: 'Proj ' + workingTotal.toFixed(1), rows: dispSlots.map(slotRow) }]} />
                </React.Fragment>) : (<React.Fragment>
                {/* Season view — outlook + week-by-week schedule (renderRail
                    carries every existing free/Pro gate). */}
                {renderRail()}
                </React.Fragment>)}

                {/* P3-style picker sheet — bench players for the open slot */}
                <Sheet open={!!openSl} onClose={() => setOpenSlot(null)} title={openSl ? 'Set ' + openSl.slotName.replace('_', ' ') : ''} desktop={null}>
                    {openSl ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 14px 4px' }}>
                            <div className="wr-seg">
                                {[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(opt => (
                                    <button key={opt[0]} className={formWindow === opt[1] ? 'is-on' : ''} onClick={() => setFormWindow(opt[1])}>{opt[0]}</button>
                                ))}
                            </div>
                            {openPid && openFs ? (
                                <div style={{ fontSize: '0.74rem', color: SILVER, fontVariantNumeric: 'tabular-nums' }}>
                                    {pmeta(openPid).name} · {formWinLabel} <span style={{ color: TEXT, fontWeight: 700 }}>{openFs.rollingPPG.toFixed(1)}</span>
                                    {' · Hi '}<span style={{ color: GREEN, fontWeight: 700 }}>{openFs.high.toFixed(1)}</span>
                                    {' · Lo '}<span style={{ color: SILVER, fontWeight: 700 }}>{openFs.low.toFixed(1)}</span>
                                </div>
                            ) : null}
                            <div style={{ fontFamily: MONO, fontSize: MICRO, letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>Eligible for {openSl.slotName.replace('_', ' ')} — tap to start</div>
                            {openElig.map(pickRow)}
                            {!openElig.length ? <div style={{ color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>No eligible bench players.</div> : null}
                            {openPid ? (
                                <div onClick={() => { setWorkingAssign(w => { const n = { ...w }; delete n[openSl.idx]; return n; }); setOpenSlot(null); }}
                                    style={{ padding: '13px 0', cursor: 'pointer', color: RED, fontSize: '0.74rem', fontWeight: 600 }}>✕ Empty this slot</div>
                            ) : null}
                        </div>
                    ) : null}
                </Sheet>

                {/* P6 apply/push sheet — the MFL push card re-homes here on
                    phone (never inline); same handlers, same submit machine. */}
                <Sheet open={applyOpen} onClose={() => setApplyOpen(false)} title="Working lineup" desktop={null}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px 14px 4px' }}>
                        <div style={{ fontSize: '0.82rem', color: TEXT }}>
                            {pro ? (isOptimal ? <span style={{ color: GREEN, fontWeight: 700 }}>Lineup is optimal</span> : <span style={{ color: GOLD, fontWeight: 700 }}>{benchPts.toFixed(1)} pts below optimal</span>) : <span style={{ fontWeight: 700 }}>Your lineup {workingTotal.toFixed(1)} pts</span>}
                            {pro ? <span style={{ color: SILVER, fontSize: '0.76rem' }}> · yours {workingTotal.toFixed(1)} · optimal {optimalTotal.toFixed(1)}</span> : null}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {pro ? <button onClick={applyOptimal} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Apply Optimal</button> : null}
                            <button onClick={() => { setWorkingAssign(currentAssign); setOpenSlot(null); }} style={actBtn}>Reset</button>
                        </div>
                        {renderMflPush()}
                        {!isMfl ? <div style={{ fontSize: '0.72rem', color: SILVER, lineHeight: 1.5 }}>Your platform has no public lineup-write API — build and compare here, then set the final lineup on your platform.</div> : null}
                    </div>
                </Sheet>

                {/* Apply-Optimal results — the moves it just made (owner ask). */}
                <Sheet open={!!appliedMoves} onClose={() => setAppliedMoves(null)} title={(appliedMoves ? appliedMoves.length : 0) + ' move' + ((appliedMoves && appliedMoves.length === 1) ? '' : 's') + ' applied'} desktop={null}>
                    {appliedMoves ? (() => {
                        const totalGain = appliedMoves.reduce((s, m) => s + (m.gain || 0), 0);
                        return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px 14px 4px' }}>
                            <div style={{ fontSize: '0.8rem', color: SILVER, lineHeight: 1.45 }}>Lineup set to optimal — <span style={{ color: GREEN, fontWeight: 700 }}>+{totalGain.toFixed(1)}</span> proj. Here's what changed:</div>
                            {appliedMoves.map((m, i) => {
                                const outN = m.cur ? pmeta(m.cur).name : 'Empty';
                                const inN = m.opt ? pmeta(m.opt).name : 'Empty';
                                return (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', background: PANEL, border: `1px solid ${LINE}`, borderRadius: '8px' }}>
                                        <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 700, color: GOLD, minWidth: '44px', whiteSpace: 'nowrap' }}>{m.sl.slotName.replace('_', ' ')}</span>
                                        <span style={{ flex: 1, minWidth: 0, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                            <span style={{ color: m.cur ? SILVER : 'var(--text-muted, #8B8B96)', textDecoration: m.cur ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{outN}</span>
                                            <span style={{ color: SILVER, flexShrink: 0 }}>→</span>
                                            <span style={{ color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{inN}</span>
                                        </span>
                                        <span style={{ fontFamily: MONO, fontSize: MICRO, fontWeight: 700, color: GREEN, whiteSpace: 'nowrap' }}>+{(m.gain || 0).toFixed(1)}</span>
                                    </div>
                                );
                            })}
                            <button onClick={() => setAppliedMoves(null)} style={{ ...actBtn, marginTop: '4px', minHeight: '44px' }}>Done</button>
                        </div>
                        );
                    })() : null}
                </Sheet>

                {/* P6 action bar — live while the working lineup differs from
                    the platform lineup. APPLY = the same applyOptimal path
                    (Pro); bar tap opens the apply/push sheet. */}
                <ActionBar visible={dirty && phoneView === 'week'} label="WORKING LINEUP"
                    value={pro ? (isOptimal ? workingTotal.toFixed(1) + ' PROJ' : '+' + benchPts.toFixed(1)) : workingTotal.toFixed(1) + ' PROJ'}
                    tone="good" actionLabel="APPLY"
                    onAction={pro ? applyOptimalWithSummary : () => setApplyOpen(true)}
                    onOpen={() => setApplyOpen(true)} />
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '20px 16px 60px' }}>
            {/* Alex's game-day note removed from the top of DESKTOP Game Day per
                owner request (#229, 2026-07-17). The PHONE layout keeps its note
                card + Ask Alex crossover (owner ask 2026-07-13) above. */}

            <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 300px', gap: '16px', alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                    {renderMflPush()}
                    {/* Hero — Pro: Your lineup vs Optimal. Free: raw working total
                        (sum of the slots the user set) + optimizer teaser; the
                        optimal total / bench delta are optimizer outputs. */}
                    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '18px 20px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                        <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>WEEK {result.week} · GAME DAY CENTRAL</div>
                        {pro ? (
                            <React.Fragment>
                                <div style={{ fontSize: '1.45rem', fontWeight: 700, color: isOptimal ? GREEN : GOLD, marginTop: '6px' }}>
                                    {isOptimal ? 'Lineup is optimal' : `${benchPts.toFixed(1)} pts below optimal`}
                                </div>
                                <div style={{ color: SILVER, fontSize: '0.82rem', marginTop: '4px' }}>
                                    Your lineup {workingTotal.toFixed(1)} · Optimal {optimalTotal.toFixed(1)}
                                </div>
                            </React.Fragment>
                        ) : (
                            <React.Fragment>
                                <div style={{ fontSize: '1.45rem', fontWeight: 700, color: GOLD, marginTop: '6px' }}>
                                    Your lineup {workingTotal.toFixed(1)} pts
                                </div>
                                <div style={{ color: SILVER, fontSize: '0.82rem', marginTop: '4px' }}>
                                    Tap a slot below to set your starters — the total updates live.
                                </div>
                            </React.Fragment>
                        )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        {pro ? (
                            <React.Fragment>
                                <div style={{ fontSize: '0.66rem', color: SILVER, letterSpacing: '0.06em' }}>OPTIMIZING FOR</div>
                                <div style={{ fontSize: '0.82rem', color: GOLD, fontWeight: 600, marginTop: '3px' }}>{OBJ_LABEL[objective] || objective}</div>
                            </React.Fragment>
                        ) : null}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', justifyContent: 'flex-end' }}>
                            {pro ? <button onClick={applyOptimal} style={{ ...actBtn, color: GOLD, borderColor: 'var(--acc-line2, rgba(212,175,55,0.4))', background: 'rgba(212,175,55,0.12)' }}>Apply Optimal</button> : null}
                            <button onClick={() => { setWorkingAssign(currentAssign); setOpenSlot(null); }} style={actBtn}>Reset</button>
                        </div>
                    </div>
                </div>
                {!pro && GatedRow ? (
                    <div style={{ marginTop: '12px' }}>
                        <GatedRow title="Lineup optimizer" sub="Optimal lineup + points left on bench, floor–ceiling bands, matchup grades and win odds" feature={STARTSIT_FEAT} />
                    </div>
                ) : null}
            </div>

            {/* Weekly matchup — opponent, projected scores, win probability.
                Free keeps the raw head-to-head totals (your working lineup vs
                their CURRENT lineup — their ideal is an optimizer read); win
                probability, margin, position strength and the slot-by-slot
                breakdown are Pro. */}
            {matchup && !pro ? (
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '16px 20px', marginBottom: '14px' }}>
                    <div style={{ fontSize: '0.7rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>WEEK {result.week} MATCHUP · vs {matchup.oppName}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{matchup.fc.projMe.toFixed(1)}</span>
                        <span style={{ color: SILVER, fontSize: '0.8rem' }}>you</span>
                        <span style={{ color: SILVER, fontWeight: 700, margin: '0 2px' }}>–</span>
                        <span style={{ fontSize: '1.5rem', fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{matchup.oppCurTotal > 0 ? matchup.oppCurTotal.toFixed(1) : '—'}</span>
                        <span style={{ color: SILVER, fontSize: '0.8rem' }}>them{matchup.oppCurTotal > 0 ? ' (current lineup)' : ''}</span>
                    </div>
                    {GatedRow ? (
                        <div style={{ marginTop: '12px' }}>
                            <GatedRow title="Win probability + matchup breakdown" sub="Projected margin, slot-by-slot edges and position-strength bars" feature={STARTSIT_FEAT} />
                        </div>
                    ) : null}
                </div>
            ) : matchup ? (
                <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', padding: '16px 20px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.7rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>WEEK {result.week} MATCHUP · vs {matchup.oppName}</div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{matchup.fc.projMe.toFixed(1)}</span>
                                <span style={{ color: SILVER, fontSize: '0.8rem' }}>you</span>
                                <span style={{ color: SILVER, fontWeight: 700, margin: '0 2px' }}>–</span>
                                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: TEXT, fontVariantNumeric: 'tabular-nums' }}>{matchup.fc.projOpp.toFixed(1)}</span>
                                <span style={{ color: SILVER, fontSize: '0.8rem' }}>them</span>
                            </div>
                            <div style={{ color: SILVER, fontSize: '0.75rem', marginTop: '5px' }}>
                                {/* MFL never exposes platform starters — 0 means "unknown", not an empty lineup. */}
                                Their lineup: current {matchup.oppCurTotal > 0 ? matchup.oppCurTotal.toFixed(1) : '—'} · ideal {matchup.oppIdealTotal.toFixed(1)}
                                {matchup.oppCurTotal > 0 && matchup.oppIdealTotal - matchup.oppCurTotal > 0.5 ? <span style={{ color: AMBER }}> · {(matchup.oppIdealTotal - matchup.oppCurTotal).toFixed(1)} on their bench</span> : null}
                                <span onClick={() => setShowOpp(v => !v)} style={{ color: GOLD, cursor: 'pointer', marginLeft: '8px', fontWeight: 600 }}>{showOpp ? 'hide' : 'view their lineup'}</span>
                            </div>
                        </div>
                        <div style={{ textAlign: 'center', minWidth: '96px' }}>
                            {/* winPct null = one side has no projectable players — no forecast. */}
                            <div style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1, color: matchup.fc.winPct == null ? SILVER : matchup.fc.winPct >= 55 ? GREEN : matchup.fc.winPct <= 45 ? RED : GOLD }}>{matchup.fc.winPct == null ? '—' : matchup.fc.winPct + '%'}</div>
                            <div style={{ fontSize: fz('0.6rem'), color: SILVER, letterSpacing: '0.06em', marginTop: '3px' }}>WIN PROBABILITY</div>
                            <div style={{ fontSize: '0.66rem', color: SILVER, marginTop: '4px' }}>{matchup.fc.margin == null ? '—' : (matchup.fc.margin >= 0 ? '+' : '') + matchup.fc.margin.toFixed(1) + ' proj margin'}</div>
                        </div>
                    </div>
                    {showOpp ? (
                        <div style={{ marginTop: '12px', borderTop: `1px solid ${LINE}`, paddingTop: '12px' }}>
                            {/* Position-group strength: your projected pts vs theirs */}
                            <div style={{ fontSize: fz('0.6rem'), letterSpacing: '0.06em', color: SILVER, marginBottom: '8px' }}>POSITION STRENGTH · your projected pts vs theirs</div>
                            {matchup.posStrength.map(ps => {
                                const tot = (ps.mine + ps.theirs) || 1, myShare = ps.mine / tot * 100, meLead = ps.mine >= ps.theirs;
                                return <div key={ps.pos} style={{ display: 'grid', gridTemplateColumns: '34px 52px 1fr 52px', gap: '8px', alignItems: 'center', padding: '3px 0' }}>
                                    <span style={{ fontSize: '0.66rem', fontWeight: 700, color: GOLD }}>{ps.pos}</span>
                                    <span style={{ textAlign: 'right', fontSize: '0.76rem', fontWeight: meLead ? 700 : 400, color: meLead ? GREEN : SILVER, fontVariantNumeric: 'tabular-nums' }}>{ps.mine.toFixed(1)}</span>
                                    <span style={{ position: 'relative', height: '6px', background: 'var(--ov-3, rgba(255,255,255,0.05))', borderRadius: '3px' }}>
                                        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: myShare + '%', background: meLead ? 'rgba(46,204,113,0.5)' : 'rgba(212,175,55,0.32)', borderRadius: '3px' }} />
                                        <span style={{ position: 'absolute', left: '50%', top: '-2px', bottom: '-2px', width: '1px', background: 'var(--ov-6, rgba(255,255,255,0.18))' }} />
                                    </span>
                                    <span style={{ textAlign: 'left', fontSize: '0.76rem', fontWeight: !meLead ? 700 : 400, color: !meLead ? RED : SILVER, fontVariantNumeric: 'tabular-nums' }}>{ps.theirs.toFixed(1)}</span>
                                </div>;
                            })}
                            {/* Slot-by-slot: your starter vs theirs */}
                            <div style={{ fontSize: fz('0.6rem'), letterSpacing: '0.06em', color: SILVER, margin: '13px 0 4px' }}>SLOT-BY-SLOT · you lead {matchup.myEdges} of {matchup.slotCount}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 70px 1fr', gap: '8px', padding: '4px 0', fontSize: fz('0.55rem'), letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase', borderBottom: `1px solid ${LINE}` }}>
                                <span>Slot</span><span>You</span><span style={{ textAlign: 'center' }}>Edge</span><span style={{ textAlign: 'right' }}>{matchup.oppName}</span>
                            </div>
                            {matchup.h2h.map((r, i) => {
                                const me = pmeta(r.myPid), them = pmeta(r.theirPid);
                                const meWin = r.myMed > r.theirMed, theyWin = r.theirMed > r.myMed;
                                return <div key={i} style={{ display: 'grid', gridTemplateColumns: '56px 1fr 70px 1fr', gap: '8px', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${LINE}` }}>
                                    <span style={{ fontSize: fz('0.62rem'), fontWeight: 700, color: GOLD }}>{r.slot.replace('_', ' ')}</span>
                                    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: meWin ? TEXT : SILVER, fontWeight: meWin ? 600 : 400, fontSize: '0.8rem' }}>{r.myPid ? me.name : '—'}<span style={{ color: SILVER, fontSize: '0.66rem', marginLeft: '5px', fontVariantNumeric: 'tabular-nums' }}>{r.myMed.toFixed(1)}</span></span>
                                    <span style={{ textAlign: 'center', fontSize: fz('0.64rem'), fontWeight: 700, color: meWin ? GREEN : theyWin ? RED : SILVER }}>{meWin ? '◄ ' + (r.myMed - r.theirMed).toFixed(1) : theyWin ? (r.theirMed - r.myMed).toFixed(1) + ' ►' : 'even'}</span>
                                    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'right', color: theyWin ? TEXT : SILVER, fontWeight: theyWin ? 600 : 400, fontSize: '0.8rem' }}><span style={{ color: SILVER, fontSize: '0.66rem', marginRight: '5px', fontVariantNumeric: 'tabular-nums' }}>{r.theirMed.toFixed(1)}</span>{r.theirPid ? them.name : '—'}</span>
                                </div>;
                            })}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {/* Unified interactive lineup table */}
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: `1px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', letterSpacing: '0.08em', color: SILVER, fontWeight: 600 }}>STARTING LINEUP · tap a slot to set it</span>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <span style={{ fontSize: fz('0.58rem'), color: SILVER, letterSpacing: '0.05em', marginRight: '2px' }}>FORM</span>
                        {[['L3', 3], ['L5', 5], ['L8', 8], ['SZN', 'season']].map(opt => (
                            <button key={opt[0]} onClick={() => setFormWindow(opt[1])} style={winBtn(formWindow === opt[1])}>{opt[0]}</button>
                        ))}
                    </div>
                </div>
                {headerRow}
                {[...startingSlots].sort((a, b) => (SLOT_DISPLAY_ORDER[a.slotName] ?? 50) - (SLOT_DISPLAY_ORDER[b.slotName] ?? 50)).map(sl => {
                    const pid = workingAssign[sl.idx] || null;
                    const open = openSlot === sl.idx;
                    const elig = open ? eligibleFor(sl) : [];
                    return (
                        <div key={sl.idx} style={{ borderBottom: `1px solid ${LINE}` }}>
                            <div onClick={() => setOpenSlot(open ? null : sl.idx)}
                                style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: isPhone ? '11px 14px' : '9px 14px', minHeight: isPhone ? '44px' : undefined, alignItems: 'center', cursor: 'pointer', background: open ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent' }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: GOLD, letterSpacing: '0.04em' }}>{sl.slotName.replace('_', ' ')}<span style={{ color: SILVER, marginLeft: '4px', fontSize: fz('0.6rem') }}>{open ? '▾' : '▸'}</span></span>
                                <PlayerCells pid={pid} />
                            </div>
                            {open ? (
                                <div style={{ background: 'var(--ov-2, rgba(255,255,255,0.03))', borderTop: `1px solid ${LINE}`, padding: '4px 0' }}>
                                    {/* Phone: the Form/Hi/Lo columns are dropped from the grid —
                                        surface the assigned starter's form here on expand. */}
                                    {isPhone && pid ? (() => {
                                        const fs = formOf(pid);
                                        return fs ? (
                                            <div style={{ padding: '6px 14px 2px', fontSize: '0.7rem', color: SILVER, fontVariantNumeric: 'tabular-nums' }}>
                                                {formWinLabel} <span style={{ color: TEXT, fontWeight: 700 }}>{fs.rollingPPG.toFixed(1)}</span>
                                                {' · Hi '}<span style={{ color: GREEN, fontWeight: 700 }}>{fs.high.toFixed(1)}</span>
                                                {' · Lo '}<span style={{ color: SILVER, fontWeight: 700 }}>{fs.low.toFixed(1)}</span>
                                            </div>
                                        ) : null;
                                    })() : null}
                                    <div style={{ padding: '5px 14px', fontSize: fz('0.58rem'), letterSpacing: '0.05em', color: SILVER, textTransform: 'uppercase' }}>Eligible for {sl.slotName.replace('_', ' ')} — tap to start</div>
                                    {elig.map(epid => {
                                        const isCur = String(pid) === String(epid);
                                        return (
                                            <div key={epid} onClick={() => { setWorkingAssign(w => ({ ...w, [sl.idx]: epid })); setOpenSlot(null); }}
                                                style={{ display: 'grid', gridTemplateColumns: GRID, gap: '8px', padding: isPhone ? '10px 14px' : '7px 14px', minHeight: isPhone ? '44px' : undefined, alignItems: 'center', cursor: 'pointer', background: isCur ? 'rgba(212,175,55,0.10)' : 'transparent', borderLeft: isCur ? `3px solid ${GOLD}` : '3px solid transparent' }}>
                                                <span style={{ fontSize: fz('0.6rem'), color: isCur ? GOLD : SILVER, fontWeight: 700 }}>{isCur ? 'IN' : ''}</span>
                                                <PlayerCells pid={epid} />
                                            </div>
                                        );
                                    })}
                                    {pid ? (
                                        <div onClick={() => { setWorkingAssign(w => { const n = { ...w }; delete n[sl.idx]; return n; }); setOpenSlot(null); }}
                                            style={{ padding: isPhone ? '13px 14px' : '7px 14px', cursor: 'pointer', color: RED, fontSize: '0.7rem', fontWeight: 600 }}>✕ Empty this slot</div>
                                    ) : null}
                                    {!elig.length ? <div style={{ padding: '7px 14px', color: SILVER, fontSize: '0.74rem', opacity: 0.7 }}>No eligible bench players.</div> : null}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            <div style={{ color: SILVER, fontSize: '0.66rem', marginTop: '10px', lineHeight: 1.6, opacity: 0.9 }}>
                <strong style={{ color: TEXT }}>Proj</strong> projected pts (your {objective} strategy){pro ? <React.Fragment> · <strong style={{ color: TEXT }}>Mtch</strong> matchup grade A–F (opponent's implied total)</React.Fragment> : null} · <strong style={{ color: TEXT }}>{formWinLabel}</strong> rolling avg of actual pts · <strong style={{ color: TEXT }}>Hi/Lo</strong> season best/worst week
            </div>
            <div style={{ color: SILVER, fontSize: '0.72rem', marginTop: '8px', lineHeight: 1.5 }}>
                Projections are league-scored from role, recent form{objective !== 'median' ? `, your ${result.mode.replace('_', '-')} strategy` : ''}, matchup and defense-vs-position; form columns are actual weekly points over the chosen window. Build and compare here{isMfl ? ' — then push straight to MFL above' : ' — set the final lineup on your platform'}.
            </div>
                </div>
                <div style={{ order: isNarrow ? 3 : 0 }}>{renderRail()}</div>
            </div>
        </div>
    );
}

window.LineupTab = LineupTab;
