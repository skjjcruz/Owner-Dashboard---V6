// ══════════════════════════════════════════════════════════════════
// free-agency.js — FreeAgencyTab component
// ══════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════
    // END TRADE CALCULATOR TAB
    // ══════════════════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════════════════════
    // FREE AGENCY TAB — migrated from the retired free-agency.html
    // ══════════════════════════════════════════════════════════════════════════
    // Phase 6 deferred: FA column registry — mirrors the My Roster column contract so
    // SavedViewBar's `columns` slot round-trips correctly between surfaces.
    const FA_COLUMNS = {
        pos:        { label: 'Position',                shortLabel: 'Pos',    width: '40px', sortKey: 'pos',   group: 'core'    },
        team:       { label: 'NFL Team',                shortLabel: 'Team',   width: '44px', sortKey: 'team',  group: 'core'    },
        age:        { label: 'Age',                     shortLabel: 'Age',    width: '34px', sortKey: 'age',   group: 'dynasty' },
        dhq:        { label: 'DHQ Dynasty Value',       shortLabel: 'DHQ',    width: '58px', sortKey: 'dhq',   group: 'dynasty' },
        ppg:        { label: 'Points Per Game',         shortLabel: 'PPG',    width: '44px', sortKey: 'ppg',   group: 'stats'   },
        proj:       { label: 'This Week Projection',    shortLabel: 'Proj',   width: '48px', sortKey: 'proj',  group: 'stats'   },
        peakYr:     { label: 'Peak Years Left',         shortLabel: 'Peak',   width: '44px', sortKey: 'peak',  group: 'dynasty' },
        yrsExp:     { label: 'NFL Years Experience',    shortLabel: 'Exp',    width: '38px', sortKey: 'exp',   group: 'dynasty' },
        college:    { label: 'College',                 shortLabel: 'College',width: '90px', sortKey: 'college', group: 'scout' },
        height:     { label: 'Height',                  shortLabel: 'Ht',     width: '44px', sortKey: 'height',  group: 'scout' },
        weight:     { label: 'Weight (lbs)',            shortLabel: 'Wt',     width: '42px', sortKey: 'weight',  group: 'scout' },
        depthChart: { label: 'NFL Depth Chart Position',shortLabel: 'Depth',  width: '50px', group: 'scout'   },
        injury:     { label: 'Injury Status',           shortLabel: 'Inj',    width: '46px', sortKey: 'injury',  group: 'stats' },
        // The dhq/250 formula below is OUR estimate, never a market price —
        // the label says so (C2 wave 2026-09-27). The league's real winning
        // bids ride in FAAB Command as history.
        faab:       { label: 'DHQ Bid Estimate (league bid model, not a market price)', shortLabel: 'Est. bid', width: '64px', group: 'stats' },
        // Per-game usage, POSITION-SPECIFIC (C2 port): each row reads its own
        // position's top-2 signature stats (App.StatCatalog via
        // App.FAMarketData) from THIS season's Sleeper line — '—' when he has
        // not played. The header names the stat when the POS filter is one
        // concrete position; mixed views carry the stat's short label per cell.
        sig1:       { label: 'Position Stat 1 (varies by position — see cell)', shortLabel: 'Usage 1', width: '64px', sortKey: 'sig1', group: 'stats' },
        sig2:       { label: 'Position Stat 2 (varies by position — see cell)', shortLabel: 'Usage 2', width: '64px', sortKey: 'sig2', group: 'stats' },
        // Draft-capital + profile columns. Rookies use the rookie-data prospect
        // record (window.App.RookieFields); vets fall back to the static NFL
        // draft dataset (faDraftCap below). Consensus rank/tier stay rookie-only.
        rkSlot:     { label: 'NFL Draft Capital — round + overall pick (UDFA = undrafted)', shortLabel: 'Draft',  width: '56px', sortKey: 'rkSlot', group: 'scout' },
        rkTeam:     { label: 'NFL Team That Drafted Him',shortLabel: 'Drafted',width: '52px', sortKey: 'rkTeam', group: 'scout' },
        rkRank:     { label: 'Rookie Consensus Rank',   shortLabel: 'Cons #', width: '50px', sortKey: 'rkRank', group: 'scout' },
        rkTier:     { label: 'Rookie Tier',             shortLabel: 'Tier',   width: '70px', sortKey: 'rkTier', group: 'scout' },
        rkProfile:  { label: 'Profile — Ht · Wt (· 40 time for rookies)', shortLabel: 'Profile', width: '120px', group: 'scout' },
    };
    // NFL draft capital for vets — static vendored dataset (window.WR_DRAFT_PROFILE,
    // js/shared/draft-profile-data.js): [year, round, OVERALL pick, team];
    // round 0 = confirmed UDFA. Mirrors my-team.js draftCapFor.
    function faDraftCap(pid) {
        const d = window.WR_DRAFT_PROFILE?.[pid];
        if (!d) return null;
        return { year: d[0] || 0, round: d[1] || 0, overall: d[2] || 0, team: d[3] || '' };
    }
    function faDraftSlotTxt(pid) {
        const dp = faDraftCap(pid);
        return dp ? (dp.round > 0 ? 'R' + dp.round + ' #' + dp.overall : 'UDFA') : null;
    }
    const FA_COLUMN_PRESETS = {
        default: ['pos','team','age','dhq','ppg','proj','faab'],
        scout:   ['pos','age','college','height','weight','depthChart'],
        bidding: ['pos','team','dhq','ppg','faab','injury'],
        rookie:  ['pos','college','rkSlot','rkTeam','rkRank','rkTier','rkProfile','dhq'],
        usage:   ['pos','team','age','ppg','sig1','sig2','proj'],
        full:    Object.keys(FA_COLUMNS),
    };
    const ROOKIE_DRAFT_LOCK_STATUSES = new Set(['pre_draft', 'drafting']);
    const ROOKIE_DHQ_SOURCES = new Set(['FC_ROOKIE', 'PROSPECT_ROOKIE']);
    // Scout-free vs Pro: the FAAB bid read is Pro. Presets AND persisted/saved
    // column prefs pass through faTierCols at every set-site plus once at
    // render, so a stored 'faab' pref can't resurrect the column for a free
    // user (mirrors the My Roster 'action' column). The 'fit' column is gone
    // entirely (owner ask 2026-07-12) — the roster-fit read (fitRead + the
    // team-assess needs) still powers the drawer's Roster Fit panel,
    // decorateFaCandidate, and the action board.
    const FA_PRO_COLS = new Set(['faab']);
    function faTierCols(cols) {
        const pro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
        return pro ? (cols || []) : (cols || []).filter(k => !FA_PRO_COLS.has(k));
    }

    function faNormName(s) {
        return (s || '').toLowerCase().replace(/[''`.]/g, '').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/, '').replace(/\s+/g, ' ').trim();
    }

    // ── Waiver-tool league reads (C2 wave 2026-09-27) ───────────────────────
    // Pure logic lives in js/shared/waiver-tools.js (App.WaiverTools, loaded
    // just before this file in the "fa" group). Every read below has an inline
    // fallback so a failed helper load degrades to today's behavior, never a
    // crash.
    const faWT = () => window.App?.WaiverTools || null;
    // FAAB = a budget AND (on Sleeper) waiver_type 2. Sleeper stores a $100
    // budget on rolling-waiver leagues too, which used to light up bid UI in
    // leagues that never bid.
    function faIsFaabLeague(league) {
        const W = faWT();
        if (W) return W.isFaabLeague(league);
        const st = league?.settings || {};
        return Number(st.waiver_budget || 0) > 0 && (st.waiver_type == null || Number(st.waiver_type) === 2);
    }
    function faLeaguePlatform(league) {
        const W = faWT();
        if (W) return W.leaguePlatform(league);
        return league?._platform || (league?._mfl ? 'mfl' : league?._espn ? 'espn' : league?._yahoo ? 'yahoo' : 'sleeper');
    }
    const FA_PLATFORM_NAME = { sleeper: 'Sleeper', espn: 'ESPN', mfl: 'MFL', yahoo: 'Yahoo' };
    // One-season formats: a backup QB is never a pickup there (dynasty keeps
    // him as a stash). Best ball rides Sleeper's settings.best_ball flag.
    function faLeagueType(league, skin) {
        const t = skin?.type || window.App?.LeagueSkin?.getCurrent?.()?.type
            || ({ 0: 'redraft', 1: 'keeper', 2: 'dynasty', 3: 'chopped' })[league?.settings?.type] || 'unknown';
        return Number(league?.settings?.best_ball) === 1 ? 'best_ball' : t;
    }
    function faIsSeasonal(league, skin) {
        return ['redraft', 'keeper', 'chopped', 'best_ball'].includes(faLeagueType(league, skin));
    }
    function faRoleRead(p, league, skin) {
        const W = faWT();
        return W ? W.roleRead(p, { seasonal: faIsSeasonal(league, skin) }) : { eligible: true, backup: false, reason: null };
    }
    // What a free-agent recommendation may never say about a backup QB.
    const FA_BACKUP_FIT = { label: 'Backup QB — stash, not a starter', short: 'Stash', score: 1, color: 'var(--silver)', need: null, backup: true };

    // ── ONE bid estimate (bidfix 2026-09-27) ────────────────────────────────
    // Every "$ est." on this tab — the phone hero, the waiver-board rows, the
    // market column, the drawer, FAAB Command, and the Flash Brief target the
    // action board feeds — comes from App.Faab.estimate (js/shared/faab-engine.js,
    // a boot script, so it is there wherever the board is built). It used to be
    // two estimators: a value÷250 formula on the rows/hero/drawer and the
    // league-history model in FAAB Command, which disagreed for the same player
    // on the same screen ("EST. BID $7–14" over "ESTIMATE $26"). The model won:
    // it reads what THIS league pays (winning and losing claims), who else
    // needs the player, and their budgets — the formula read a player score
    // and a multiplier, which is not what a claim costs. The range is the
    // model's own band (see estimate()), not a second formula.
    //
    // Inputs: the league's cached transactions (WrTxns — the same cache FAAB
    // Command fills). Until they land the model is in league-median mode, and
    // EVERY surface is, so they still agree; faEnsureBidHistory fetches once
    // (6h TTL, one in-flight per league) and announces wr:fa-txns-updated so
    // the tab and the brief recompute together.
    let _faTxnsVersion = 0;
    const _faBidInflight = new Map();
    const _faTxnsSig = new Map();     // lid → 'won:lost' counts last announced
    function faBidHistoryTxns(league) {
        const lid = league?.league_id || league?.id;
        if (!lid || !window.WrTxns?.getCached) return [];
        try { return (window.WrTxns.getCached(lid) || []).concat(window.WrTxns.getFailedWaivers ? (window.WrTxns.getFailedWaivers(lid) || []) : []); }
        catch (e) { return []; }
    }
    // Where a bid can be estimated at all: a FAAB league on Sleeper (we don't
    // import ESPN / MFL / Yahoo budgets or claims). One gate for the fetch and
    // for every estimate.
    function faBidsHere(league) {
        return faIsFaabLeague(league) && faLeaguePlatform(league) === 'sleeper';
    }
    function faEnsureBidHistory(league) {
        const lid = league?.league_id || league?.id;
        if (!lid || !window.WrTxns?.fetchLeagueTxns || !faBidsHere(league)) return Promise.resolve([]);
        if (_faBidInflight.has(lid)) return _faBidInflight.get(lid);
        // Baseline = what the estimates have ALREADY been reading (getCached),
        // so a fetch that is only a cache hit doesn't announce a "change".
        if (!_faTxnsSig.has(lid) && window.WrTxns.getCached) {
            try { _faTxnsSig.set(lid, (window.WrTxns.getCached(lid) || []).length + ':' + (window.WrTxns.getFailedWaivers ? (window.WrTxns.getFailedWaivers(lid) || []).length : 0)); } catch (e) { /* no baseline */ }
        }
        const p = Promise.resolve(window.WrTxns.fetchLeagueTxns(lid)).then(txns => {
            // Announce only when the history actually changed — a cache hit
            // (every FAAB Command target tap re-asks) must not invalidate the
            // estimate memo and re-run the model for the whole board.
            const failed = window.WrTxns.getFailedWaivers ? (window.WrTxns.getFailedWaivers(lid) || []) : [];
            const sig = (txns || []).length + ':' + failed.length;
            if (_faTxnsSig.get(lid) !== sig) {
                _faTxnsSig.set(lid, sig);
                _faTxnsVersion++;
                try { window.dispatchEvent(new CustomEvent('wr:fa-txns-updated', { detail: { leagueId: String(lid), version: _faTxnsVersion } })); } catch (e) { /* no-op */ }
            }
            return txns || [];
        }).catch(() => []).finally(() => { _faBidInflight.delete(lid); });
        _faBidInflight.set(lid, p);
        return p;
    }
    // THE player value every bid surface prices off (review B1): format-aware
    // App.PlayerValue.getValue (ROS in redraft / chopped, dynasty DHQ otherwise),
    // raw DHQ only when that module is missing. The FA tab pool, the action
    // board behind the Flash Brief, the Home widget and faModelBid all read
    // this — before, the board priced off raw dynasty DHQ while the tab used
    // ROS, so the same redraft player got two estimates.
    function faValueOf(pid, skin) {
        const PV = window.App?.PlayerValue;
        if (PV?.getValue) {
            try { return Number(PV.getValue(pid, skin ? { skin } : {})) || 0; } catch (e) { /* fall through */ }
        }
        return Number(window.App?.LI?.playerScores?.[pid]) || 0;
    }

    // Priority-add ordering shared by the FA tab and the action board: craze
    // seeds first, then GM Strategy target positions, then fit × value (+ the
    // GM market-posture bias). Top 5.
    function faRankPriorityAdds(list, { crazeSeed, gmTargets, postureBias }) {
        const seed = crazeSeed || new Set();
        const tgt = gmTargets || new Set();
        const bias = postureBias || (() => 0);
        return (list || [])
            .map(x => ({ ...x, seeded: seed.has(String(x.pid)), isStrategicTarget: tgt.has(x.pos) }))
            .sort((a, b) => (Number(b.seeded) - Number(a.seeded)) || (Number(b.isStrategicTarget) - Number(a.isStrategicTarget)) || ((b.fitScore * 5000 + b.dhq + bias(b)) - (a.fitScore * 5000 + a.dhq + bias(a))))
            .slice(0, 5);
    }

    // The shared free-agent candidate pool — the FA tab's Market/Action HQ and
    // buildFreeAgencyActionBoard (Flash Brief, UDFA craze) both build from this,
    // so they rank and gate the same players on the same numbers. Carries
    // Sleeper's published weekly line (requireSleeper) and depth-chart slot for
    // the recommendation truth gate.
    function faBuildAvailable({ playersData, statsData, prevStatsData, currentLeague, skin, rostered, isDraftProspect, leaguePosSet }) {
        const normPos = window.App?.normPos || (x => x);
        const WP = window.App && window.App.WeeklyProj;
        const scores = window.App?.LI?.playerScores || {};
        const week = WP ? (WP.displayWeek ? WP.displayWeek() : WP.loadedProjWeek ? (WP.loadedProjWeek() || (WP.currentWeek ? WP.currentWeek() : 1)) : (window.S?.currentWeek || 1)) : null;
        return Object.entries(playersData || {})
            .filter(([pid, p]) => !rostered.has(pid) && p.team && p.status !== 'Inactive' && p.status !== 'Retired' && p.active !== false && !isDraftProspect(pid, p)
                && (p.full_name || p.first_name || p.last_name) && (scores[pid] || 0) > 0
                && (!leaguePosSet || leaguePosSet.has(normPos(p.position) || p.position)))
            .map(([pid, p]) => {
                const dhq = faValueOf(pid, skin);
                // requireSleeper: only a number Sleeper published. No line →
                // null (not zero), so "not projected" stays distinguishable.
                let proj = null;
                if (WP && WP.projectPlayer) {
                    try {
                        const pr = WP.projectPlayer(pid, {
                            playersData, statsData, priorData: prevStatsData,
                            scoring: currentLeague?.scoring_settings || {},
                            week,
                            requireSleeper: true,
                        });
                        proj = (pr && pr.points && Number.isFinite(pr.points.median)) ? pr.points.median : null;
                    } catch (e) { proj = null; }
                }
                // Sleeper's depth chart: no slot, no NFL role.
                const depthSlot = Number.isFinite(Number(p.depth_chart_order)) && Number(p.depth_chart_order) > 0
                    ? Number(p.depth_chart_order) : null;
                return { pid, p, dhq, proj, projected: proj != null, depthSlot, pos: normPos(p.position) || p.position };
            })
            .sort((a, b) => b.dhq - a.dhq)
            .slice(0, 300);
    }

    // Every input the model reads off the rosters: budgets spent and roster
    // sizes (league-detail refreshes currentLeague.rosters IN PLACE on the same
    // league object, so the object identity alone can't key the memo — S1).
    function faRosterSig(league) {
        return (league?.rosters || []).map(r => r.roster_id + ':' + (Number(r.settings?.waiver_budget_used) || 0) + ':' + (r.players || []).length + ':' + (r.reserve || []).length).join(',');
    }

    // Memo per league object × players object × txns version × roster
    // signature × target. The tab rebuilds its board on every render, so the
    // model must not re-run per keystroke.
    //
    // `dhq` from callers is IGNORED — the value is resolved here (faValueOf)
    // so no surface can price the same player off a different number.
    const _faBidCache = new WeakMap();
    function faModelBid({ league, myRoster, playersData, pid, pos, skin }) {
        const Faab = window.App?.Faab;
        if (!Faab?.estimate || !league || !faBidsHere(league)) return null;
        const lid = league.league_id || league.id || '';
        const dhq = faValueOf(pid, skin);
        const gmEff = window.WR?.GmMode?.effects?.(lid) || {};
        const horizonWeeks = window.App?.ChopOdds?.horizonFor?.(lid, null) || null;
        const key = [_faTxnsVersion, faRosterSig(league), myRoster?.roster_id, pid, pos, dhq, gmEff.faabMinBid || '', horizonWeeks || ''].join('|');
        let slot = _faBidCache.get(league);
        if (!slot || slot.pd !== playersData) { slot = { pd: playersData, map: new Map() }; _faBidCache.set(league, slot); }
        if (slot.map.has(key)) return slot.map.get(key);
        if (slot.map.size > 1500) slot.map.clear();
        let est = null;
        try {
            est = Faab.estimate({
                league, myRosterId: myRoster?.roster_id,
                txns: faBidHistoryTxns(league),
                playersData,
                minBidOverride: gmEff.faabMinBid || undefined,
                targetPid: pid, targetPos: pos, dhq,
                // Same value scale for the rivals' rostered players: on K / DEF /
                // 1-QB a rival is in the market only if this is an upgrade.
                playerValue: (rp) => faValueOf(rp, skin),
                // CHOPPED: bid against how long you expect to be ALIVE.
                horizonWeeks,
            });
        } catch (e) { est = null; if (window.wrLog) window.wrLog('fa.modelBid', e); }
        if (est) {
            est.dhq = dhq;
            // The drawer's competition read, from the same model: rivals with
            // a need at the position AND the budget to chase him.
            const engaged = (est.analysis?.rivals || []).filter(r => r.engaged).length;
            est.competitors = engaged;
            est.conf = engaged <= 1 ? 'Low competition' : engaged <= 3 ? 'Moderate' : 'High demand';
            est.confCol = engaged <= 1 ? 'var(--good)' : engaged <= 3 ? 'var(--warn)' : 'var(--bad)';
        }
        slot.map.set(key, est);
        return est;
    }
    // "$26" (uncontested → the band collapses), "$18–34", or "$18–64 (your
    // cap)" when the top of the band is your spend cap, not 80% win odds (N7).
    // compact: tight table / phone slots drop the words (the title says it).
    function faEstText(f, dash, compact) {
        if (!f) return '';
        if (window.App?.Faab?.formatRange) return window.App.Faab.formatRange(f, dash, { capLabel: !compact });
        return f.lo === f.hi ? '$' + f.lo : '$' + f.lo + (dash || '–') + f.hi;
    }
    const FA_EST_TITLE = 'DHQ bid estimate from this league’s bid history and rival budgets — not a market price';
    const faEstTitle = f => f ? FA_EST_TITLE + (f.hiCapped ? ' · the top of the range is your spend cap, not a stronger bid' : '') : undefined;

    // The player position groups this league actually rosters, derived from
    // roster_positions (FLEX→RB/WR/TE, SUPER_FLEX→+QB, REC_FLEX→WR/TE, IDP_FLEX→DL/LB/DB).
    // Lets the FA position chips show only relevant groups (no IDP in a non-IDP league, etc.).
    function leaguePlayablePositions(rosterPositions) {
        const rp = rosterPositions || [];
        const set = new Set();
        rp.forEach(slot => {
            const s = String(slot).toUpperCase();
            if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(s)) set.add(s);
            else if (s === 'FLEX' || s === 'WRRB_FLEX' || s === 'WRRBTE_FLEX') { set.add('RB'); set.add('WR'); set.add('TE'); }
            else if (s === 'REC_FLEX') { set.add('WR'); set.add('TE'); }
            else if (s === 'SUPER_FLEX' || s === 'QB_FLEX') { set.add('QB'); set.add('RB'); set.add('WR'); set.add('TE'); }
            else if (s === 'IDP_FLEX') { set.add('DL'); set.add('LB'); set.add('DB'); }
            else if (['DE', 'DT', 'EDGE', 'NT'].includes(s)) set.add('DL');
            else if (['CB', 'S', 'SS', 'FS'].includes(s)) set.add('DB');
            else if (['OLB', 'ILB', 'MLB'].includes(s)) set.add('LB');
        });
        return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(p => set.has(p));
    }
    window.App = window.App || {};
    window.App.leaguePlayablePositions = leaguePlayablePositions;

    function collectFaDrafts(currentLeague, briefDraftInfo) {
        const byId = new Map();
        const add = (draft) => {
            if (!draft || typeof draft !== 'object') return;
            const key = draft.draft_id || draft.id || `${draft.season || ''}-${draft.status || ''}-${draft.start_time || ''}`;
            byId.set(key, draft);
        };
        add(briefDraftInfo);
        (window.S?.drafts || []).forEach(add);
        (currentLeague?.drafts || []).forEach(add);
        return [...byId.values()];
    }

    function isDynastyLeague(currentLeague) {
        const settingsType = Number(currentLeague?.settings?.type);
        if (settingsType === 2) return true;
        const text = [
            currentLeague?.type,
            currentLeague?.metadata?.type,
            currentLeague?.metadata?.league_type,
            currentLeague?.metadata?.draft_type,
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes('dynasty');
    }

    function isRookieDraftLike(draft, currentLeague) {
        if (!draft) return false;
        const playerType = String(draft.settings?.player_type ?? draft.metadata?.player_type ?? '').toLowerCase();
        if (playerType === '1' || playerType === 'rookie' || playerType === 'rookies') return true;
        const descr = [
            draft.metadata?.description,
            draft.metadata?.name,
            draft.metadata?.draft_name,
            draft.type,
        ].filter(Boolean).join(' ').toLowerCase();
        if (/\brookie\b|\brookies\b|\bsupplemental\b|\bcollege\b/.test(descr)) return true;
        const rounds = Number(draft.settings?.rounds || 0);
        return isDynastyLeague(currentLeague) && rounds > 0 && rounds <= 8;
    }

    function sameDraftSeason(draft, currentLeague) {
        const leagueSeason = currentLeague?.season;
        if (!leagueSeason || !draft?.season) return true;
        return String(draft.season) === String(leagueSeason);
    }

    function rookiesLockedForWaivers(currentLeague, briefDraftInfo) {
        const drafts = collectFaDrafts(currentLeague, briefDraftInfo).filter(d => sameDraftSeason(d, currentLeague));
        const rookieDrafts = drafts.filter(d => isRookieDraftLike(d, currentLeague));
        if (rookieDrafts.some(d => ROOKIE_DRAFT_LOCK_STATUSES.has(String(d.status || '').toLowerCase()))) return true;
        // Unlock (craze opens) only when EVERY same-season rookie-like draft is
        // complete — handles a rookie + supplemental draft pair so the lock doesn't
        // lift while a second rookie draft is still pending.
        if (rookieDrafts.length && rookieDrafts.every(d => String(d.status || '').toLowerCase() === 'complete')) return false;
        return isDynastyLeague(currentLeague)
            && ROOKIE_DRAFT_LOCK_STATUSES.has(String(currentLeague?.status || '').toLowerCase())
            && !rookieDrafts.some(d => String(d.status || '').toLowerCase() === 'complete');
    }

    function isRookieWaiverLockedCandidate(pid, p, { rookiesLocked, prospectNames, statsData, prevStatsData }) {
        if (!rookiesLocked || !p) return false;
        // Exact vet excluder first (owner ask 2026-07-12: vets were leaking into
        // the UDFA craze). WR_DRAFT_PROFILE (static NFL draft-capital dataset via
        // faDraftCap; round 0 = confirmed UDFA) carries the entry year — any year
        // before the current rookie class is definitively a veteran, no matter
        // what the name/exp/gp heuristics below say (years_exp is null for some
        // vets, e.g. a 2023 R4 pick with no recent gp).
        const rookieClassSeason = Number(window.S?.league?.season || window.S?.nflState?.season) || new Date().getFullYear();
        const dc = faDraftCap(pid);
        if (dc && dc.year && dc.year < rookieClassSeason) return false;
        const source = String(window.App?.LI?.playerMeta?.[pid]?.source || '').toUpperCase();
        if (ROOKIE_DHQ_SOURCES.has(source) || source.includes('ROOKIE')) return true;
        const name = faNormName(p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim());
        if (prospectNames?.has?.(name)) return true;
        const exp = Number(p.years_exp ?? p.yoe ?? p.maybeYoe ?? 0);
        const hasNflStats = (statsData?.[pid]?.gp || 0) > 0 || ((prevStatsData || {})[pid]?.gp || 0) > 0;
        return exp === 0 && !hasNflStats;
    }

    // ── GM-Office tunable FA filters ────────────────────────────────────────────
    // User-set knobs (min DHQ, max age, prime-years-only, excluded positions) from
    // GM strategy. Applied to the recommendation surfaces (priority adds + action
    // board), never the market explorer (which always shows everyone). The UDFA
    // craze is exempt (buildUdfaCrazeBoard passes skipGmFilters).
    function getGmFaFilters(currentLeague) {
        const leagueId = currentLeague?.league_id || currentLeague?.id;
        let strat = null;
        try {
            strat = (typeof localStorage !== 'undefined' && localStorage.getItem('dhq_gm_strategy_v1') ? window.GMStrategy?.getStrategy?.(leagueId) : null)
                || window.App?.WrStorage?.get?.(window.App?.WR_KEYS?.GM_STRATEGY?.(leagueId))
                || window._wrGmStrategy
                || null;
        } catch (_) {}
        const f = (strat && strat.faFilters) || {};
        const excludePositions = (Array.isArray(f.excludePositions) ? f.excludePositions : [])
            .map(p => String((window.App?.normPos?.(p)) || p || '').toUpperCase()).filter(Boolean);
        return {
            minDhq: Number(f.minDhq) || 0,
            maxAge: Number(f.maxAge) || 0,
            requirePrimeYears: !!f.requirePrimeYears,
            excludePositions,
        };
    }
    function gmFaFiltersActive(f) {
        return !!(f && (f.minDhq > 0 || f.maxAge > 0 || f.requirePrimeYears || (f.excludePositions && f.excludePositions.length)));
    }
    function gmFaPeakYears(pos, age) {
        const curve = (typeof window.App?.getAgeCurve === 'function' ? window.App.getAgeCurve(pos) : null)
            || { peak: (window.App?.peakWindows || {})[pos] || [24, 29] };
        const peakEnd = (curve.peak && curve.peak[1]) || 29;
        return Math.max(0, peakEnd - (Number(age) || 25));
    }
    function applyGmFaFilters(list, f) {
        if (!gmFaFiltersActive(f)) return list || [];
        return (list || []).filter(x => {
            const pos = String(x.pos || (window.App?.normPos?.(x.p?.position)) || x.p?.position || '').toUpperCase();
            const age = Number(x.p?.age) || 0;
            if (f.minDhq && (Number(x.dhq) || 0) < f.minDhq) return false;
            if (f.excludePositions.includes(pos)) return false;
            if (f.maxAge && age && age > f.maxAge) return false;
            if (f.requirePrimeYears && !(gmFaPeakYears(pos, age) > 0)) return false;
            return true;
        });
    }

    function buildFreeAgencyActionBoard(args = {}) {
        const playersData = args.playersData || {};
        const statsData = args.statsData || {};
        const prevStatsData = args.prevStatsData || {};
        const myRoster = args.myRoster || null;
        const currentLeague = args.currentLeague || {};
        const briefDraftInfo = args.briefDraftInfo || null;
        const leagueSkin = args.leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
        const skinFeatures = leagueSkin?.features || {};
        const _valueShortLabel = leagueSkin?.vocabulary?.valueShortLabel || 'DHQ';
        const rosterState = args.rosterState || window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters, leagueSkin }) || { isUsable: true };
        if (!rosterState.isUsable) return { priorityAdds: [], actionBoardPlayers: [] };
        // Free/Pro: FAAB bids stay null and nothing is published to the shared
        // Intelligence rec stream for free users; consumers (brief, HQ, craze)
        // gate their own display, this nulls the rec payloads at the source.
        const faIsPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;

        const normPos = window.App?.normPos || (p => p);
        const assess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
        const scoring = currentLeague?.scoring_settings || {};
        const leagueProfile = typeof window.App?.Intelligence?.buildLeagueProfile === 'function'
            ? window.App.Intelligence.buildLeagueProfile({ league: currentLeague, rosters: currentLeague?.rosters || [], platform: currentLeague?._platform })
            : null;
        const budget = currentLeague?.settings?.waiver_budget || myRoster?.settings?.waiver_budget || 0;
        const spent = myRoster?.settings?.waiver_budget_used || 0;
        const remaining = Math.max(0, budget - spent);
        const hasFAAB = faIsFaabLeague(currentLeague);
        const teamTier = assess?.tier || '';
        const teamWindow = assess?.window || '';
        // GM Strategy outranks the roster grade for FA posture: a committed plan
        // sets rebuild/contend directly; the assessment remains the fallback for
        // strategy-less users. The rebuild age gate follows the GM timeline
        // (shorter window = looser youth filter); 25 is the legacy default.
        const gmEff = window.WR?.GmMode?.effects?.(currentLeague?.id || currentLeague?.league_id) || {};
        const isRebuilding = gmEff.hasStrategy ? gmEff.mode === 'rebuild' : (teamTier === 'REBUILDING' || teamWindow === 'REBUILDING');
        const faAgeGate = gmEff.hasStrategy ? ({ '1_year': 29, '2_3_years': 27, 'dynasty_long': 25 }[gmEff.timeline] || 25) : 25;
        const peaks = window.App?.peakWindows || {};
        // UDFA-craze seed: pids the post-draft recap pre-identified as waiver targets.
        // Seeded pids float to the top of priorityAdds when the craze is live.
        const crazeSeed = new Set((args.crazeSeed || []).map(s => String(s.pid ?? s)).filter(Boolean));
        const rookiesLocked = rookiesLockedForWaivers(currentLeague, briefDraftInfo);
        const prospectNames = rookiesLocked && typeof window.getProspects === 'function'
            ? new Set((window.getProspects() || []).map(p => faNormName(p.name)).filter(Boolean))
            : new Set();

        function calcRawPtsFor(s) {
            return typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(s, scoring) : 0;
        }
        const isDraftProspect = (pid, p) => isRookieWaiverLockedCandidate(pid, p, { rookiesLocked, prospectNames, statsData, prevStatsData });
        function playerName(p, pid) {
            if (!p) return pid ? 'Player ' + pid : 'Unknown';
            const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
            if (full) return full;
            const pos = (normPos?.(p.position) || p.position || '').toUpperCase();
            if ((pos === 'DEF' || pos === 'DST') && (p.team || pid)) return (p.team || pid) + ' D/ST';
            return pid ? 'Player ' + pid : 'Unknown';
        }
        // THIS season's points per game, or null when he has not played this
        // season. It used to fall back to last season, which quietly presented
        // an old year's number as the current one — and because the divisor is
        // games PLAYED, a back who dressed 17 times and touched the ball once
        // came out at 11.4 a game off a single box score. Last season is history
        // you can look up; it is not this season's average.
        function seasonPpgFor(pid) {
            const st = statsData[pid] || {};
            if (!(st.gp > 0)) return null;
            return +(calcRawPtsFor(st) / st.gp).toFixed(1);
        }
        function ageCurveFor(pos) {
            return typeof window.App?.getAgeCurve === 'function'
                ? window.App.getAgeCurve(pos)
                : { build: [22, 24], peak: peaks[pos] || [24, 29], decline: [30, 32] };
        }
        function peakYearsFor(pos, age) {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.peak[1] - (age || 25));
        }
        function valueYearsFor(pos, age) {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.decline[1] - (age || 25));
        }
        function windowRead(pos, age) {
            const peakYrs = peakYearsFor(pos, age);
            const valueYrs = valueYearsFor(pos, age);
            if (peakYrs >= 4) return { label: peakYrs + 'yr peak', short: 'Rising', color: 'var(--k-2ecc71, #2ecc71)', peakYrs, valueYrs };
            if (peakYrs >= 1) return { label: peakYrs + 'yr peak', short: 'Prime', color: 'var(--gold)', peakYrs, valueYrs };
            if (valueYrs >= 1) return { label: valueYrs + 'yr value', short: 'Vet', color: 'var(--k-f0a500, #f0a500)', peakYrs, valueYrs };
            return { label: 'short term', short: 'Post', color: 'var(--k-e74c3c, #e74c3c)', peakYrs, valueYrs };
        }
        // Role check (C2 waiverRoleRead): a backup QB is never "fills your QB
        // deficit" — at most a stash, and only in dynasty (seasonal formats
        // drop him from the recommendation pool below).
        function fitRead(pos, player) {
            if (player && faRoleRead(player, currentLeague, leagueSkin).backup) return FA_BACKUP_FIT;
            const need = assess?.needs?.find(n => n.pos === pos);
            if (need?.urgency === 'deficit') return { label: 'Fills deficit', short: 'Deficit', score: 4, color: 'var(--k-2ecc71, #2ecc71)', need };
            if (need) return { label: 'Fills thin room', short: 'Thin', score: 3, color: 'var(--k-2ecc71, #2ecc71)', need };
            if (assess?.strengths?.includes(pos)) return { label: 'Surplus stash', short: 'Stash', score: 1, color: 'var(--silver)', need: null };
            return { label: 'Depth add', short: 'Depth', score: 2, color: 'var(--silver)', need: null };
        }
        // OUR estimate — the league bid model (faModelBid → App.Faab.estimate),
        // never a market price; `estimate: true` rides the payload so every
        // surface labels it. The gates here decide WHETHER to estimate at all
        // (Pro, FAAB league, replacement-level, rebuild posture); the number
        // itself is the model's, the same one FAAB Command prints.
        function faabSuggest(dhq, pos, playerAge, pid) {
            if (!faIsPro) return null; // FAAB bid recommendations are Pro
            if (!hasFAAB || !faBidsHere(currentLeague) || dhq <= 0) return null;
            if (dhq < 500) return null;
            if (isRebuilding && (playerAge || 30) > faAgeGate && dhq < 2000) return null;
            if (remaining <= 0) return null; // FAAB exhausted — no legal bid left to suggest
            return faModelBid({ league: currentLeague, myRoster, playersData, pid, pos, skin: leagueSkin });
        }
        function decorateFaCandidate(x) {
            const pos = x.pos || normPos(x.p?.position) || x.p?.position || '';
            const posName = window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
            const ppg = x.ppg != null ? x.ppg : seasonPpgFor(x.pid);
            const win = windowRead(pos, x.p?.age);
            const fit = fitRead(pos, x.p);
            const faab = x.faab || faabSuggest(x.dhq, pos, x.p?.age, x.pid);
            const formatReasons = leagueProfile && typeof window.App?.Intelligence?.buildPlayerFormatReasons === 'function'
                ? window.App.Intelligence.buildPlayerFormatReasons({ player: x.p, pos, profile: leagueProfile }).slice(0, 2)
                : [];
            const playerContext = typeof window.App?.Intelligence?.buildPlayerContext === 'function'
                ? window.App.Intelligence.buildPlayerContext({
                    id: 'waiver_context_' + x.pid,
                    pid: x.pid,
                    player: x.p,
                    pos,
                    profile: leagueProfile,
                    dhq: x.dhq,
                    ppg,
                    peakYrs: win.peakYrs,
                    valueYrs: win.valueYrs,
                    fit,
                    formatReasons,
                })
                : null;
            // urgency vocabulary is 'deficit' | 'thin' (team-assess) — 'thin' needs the noun phrase.
            const whyBase = fit.backup
                ? 'Backup quarterback — a stash for if he wins the job, not a lineup upgrade today.'
                : fit.need
                ? (fit.need.urgency === 'thin'
                    ? 'Shores up your thin ' + posName + ' room and keeps the bid in a controlled range.'
                    : 'Addresses your ' + posName + ' deficit and keeps the bid in a controlled range.')
                : win.peakYrs > 0
                    ? (skinFeatures.showDynastyValue === false ? 'Adds usable production runway without forcing a major FAAB commitment.' : 'Adds usable dynasty runway without forcing a major FAAB commitment.')
                    : 'Short-window depth. Treat as a tactical add, not a core asset.';
            const why = whyBase;
            const intelligence = typeof window.App?.Intelligence?.buildWaiverRecommendation === 'function'
                ? window.App.Intelligence.buildWaiverRecommendation({
                    id: 'waiver_' + x.pid,
                    pid: x.pid,
                    player: x.p,
                    pos,
                    profile: leagueProfile,
                    dhq: x.dhq,
                    ppg,
                    fit,
                    faab,
                    formatReasons,
                    playerContext,
                    detail: why,
                    windowDetail: whyBase,
                    badge: fit.short,
                })
                : null;
            return { ...x, name: playerName(x.p, x.pid), pos, ppg, faab, fit, fitScore: fit.score, peakYrs: win.peakYrs, valueYrs: win.valueYrs, windowLabel: win.label, windowShort: win.short, windowColor: win.color, formatReasons, playerContext, intelligence, why };
        }
        const roleOk = (x) => faRoleRead(x.p, currentLeague, leagueSkin).eligible;
        const isBackupQb = (x) => faRoleRead(x.p, currentLeague, leagueSkin).backup;

        // Multi-copy leagues (MFL rostersPerPlayer): a player is only off the wire
        // once ALL copies are rostered. Count occurrences across rosters and gate on
        // the copy cap (copies===1 ⇒ identical to the old gone-on-first-roster Set).
        const faCopies = Math.max(1, Number(currentLeague?.settings?.player_copies) || 1);
        const faRosteredCount = {};
        // Dedupe per roster — taxi/reserve ids are also in players[], so a raw count
        // would double-count a taxi/IR stash toward the copy cap.
        (currentLeague?.rosters || []).forEach(r => new Set((r.players || []).concat(r.taxi || [], r.reserve || []).map(String)).forEach(k => { faRosteredCount[k] = (faRosteredCount[k] || 0) + 1; }));
        const rostered = { has: (pid) => (faRosteredCount[String(pid)] || 0) >= faCopies };
        // Redraft / chopped value is rest-of-season (App.PlayerValue); build it
        // for this league the way the FA tab does, so the Flash Brief reads the
        // same numbers even when Free Agency was never opened (cached; no-op in
        // dynasty / keeper).
        try {
            window.App?.PlayerValue?.ensureRos?.({ leagueId: currentLeague?.league_id || currentLeague?.id, league: currentLeague, playersData, statsData, priorData: prevStatsData, skin: leagueSkin });
        } catch (e) { if (window.wrLog) window.wrLog('fa.board.ensureRos', e); }
        let leaguePosSet = null;
        try { leaguePosSet = typeof window.getLeaguePositions === 'function' ? window.getLeaguePositions({ league: currentLeague, asSet: true }) : null; } catch (e) { leaguePosSet = null; }
        // The SAME pool builder as the FA tab (faBuildAvailable): same value
        // resolver, same gates, same Sleeper line + depth slot.
        const availablePlayers = faBuildAvailable({ playersData, statsData, prevStatsData, currentLeague, skin: leagueSkin, rostered, isDraftProspect, leaguePosSet });
        // The FA tab's truth gate: a recommendation needs a published Sleeper
        // line and a depth-chart slot. The UDFA craze opts out (undrafted
        // rookies have neither in May, and it runs its own eligibility).
        const truthOk = (x) => !!args.skipTruthGate || (x.projected && x.depthSlot != null);

        // GM-Office filters scope the recommendation surfaces (not the market pool).
        const gmFa = getGmFaFilters(currentLeague);
        // Role check: a backup/unknown-role QB stays in availablePlayers (the
        // market) but is not a recommendation in one-season formats.
        const gmPool = args.skipGmFilters ? availablePlayers : applyGmFaFilters(availablePlayers, gmFa);
        const recPool = gmPool.filter(roleOk);
        // GM Strategy target positions float relevant FA adds to the top
        // (gmEff resolved above, next to the rebuild/contend posture reads).
        const gmTargets = gmEff.targetPositions instanceof Set ? gmEff.targetPositions : new Set();
        // Market posture biases candidate ordering: buy_low floats dipped-value
        // adds (negative trend, real DHQ); sell_high/hold tighten the board by
        // fading speculative low-value candidates.
        const postureBias = (x) => {
            if (!gmEff.hasStrategy) return 0;
            const trend = Number(window.App?.LI?.playerMeta?.[x.pid]?.trend) || 0;
            if (gmEff.marketPosture === 'buy_low') return (trend < 0 && x.dhq >= 2000) ? 1500 : 0;
            if (gmEff.marketPosture === 'sell_high' || gmEff.marketPosture === 'hold') return x.dhq < 1500 ? -1200 : 0;
            return 0;
        };

        const needPositions = (assess?.needs || []).slice(0, 3).map(n => n.pos).filter(Boolean);
        let recommendations = [];
        if (needPositions.length) {
            const bestAvailDhq = recPool
                .filter(x => needPositions.includes(x.pos))
                .reduce((m, x) => Math.max(m, x.dhq), 0);
            const dynamicFloor = Math.min(500, Math.max(100, Math.round(bestAvailDhq * 0.25)));
            recommendations = recPool
                .filter(x => {
                    if (!needPositions.includes(x.pos)) return false;
                    if (isBackupQb(x)) return false; // a backup never "fills" a starting need
                    if (!truthOk(x)) return false;   // same truth gate as the FA tab
                    if (x.dhq < dynamicFloor) return false;
                    if (isRebuilding && (x.p.age || 30) > faAgeGate && x.dhq < 2000) return false;
                    return true;
                })
                .slice(0, 8)
                .map(x => {
                    const st = statsData[x.pid] || {};
                    const ppg = st.gp > 0 ? +(calcRawPtsFor(st) / st.gp).toFixed(1) : 0;
                    if (ppg > 0 && ppg < 5.0 && (st.gp || 0) >= 6) return null;
                    const need = assess?.needs?.find(n => n.pos === x.pos);
                    return { ...x, ppg, need, peakYrs: peakYearsFor(x.pos, x.p.age), valueYrs: valueYearsFor(x.pos, x.p.age), faab: faabSuggest(x.dhq, x.pos, x.p.age, x.pid) };
                })
                .filter(Boolean);
        }

        const actionBoardPlayers = recPool
            .filter(truthOk)
            .map(decorateFaCandidate)
            .sort((a, b) => (b.fitScore * 5000 + b.dhq + (b.ppg || 0) * 35 + postureBias(b)) - (a.fitScore * 5000 + a.dhq + (a.ppg || 0) * 35 + postureBias(a)));
        // Same ordering as the FA tab's Priority Moves (faRankPriorityAdds), so
        // the Flash Brief's target IS the FA tab's top add.
        const priorityAdds = faRankPriorityAdds((recommendations.length ? recommendations : actionBoardPlayers).map(decorateFaCandidate), { crazeSeed, gmTargets, postureBias });
        if (faIsPro && typeof window.App?.Intelligence?.publishRecommendations === 'function') {
            window.App.Intelligence.publishRecommendations('waiver', priorityAdds.map(x => x.intelligence).filter(Boolean), { surface: 'free-agency-action-board' });
        }
        return { priorityAdds, actionBoardPlayers, availablePlayers, gmFaFilters: gmFa, gmHiddenCount: Math.max(0, availablePlayers.length - gmPool.length) };
    }

    // ── UDFA craze ────────────────────────────────────────────────────────────
    // The dynasty-only post-rookie-draft scramble. When the rookie lock lifts, the
    // newly-eligible UDFAs (undrafted rookies signed to an NFL team) become claimable
    // and the craze board ranks them by roster fit with league-history-anchored FAAB.

    // Kept on window.App for API compatibility only — nothing here calls it
    // since the craze board stopped blending (review N2).
    // bidfix 2026-09-27: ONE estimate. The model already reads this league's
    // bid history, so a positional history range is carried as evidence
    // (leagueAvg / leagueCount) and never averaged into the numbers — that
    // averaging was a third estimator. No estimate → no invented one from
    // the range alone.
    function blendFaabWithHistory(faab, range) {
        if (!faab) return null;
        return { ...faab, leagueAvg: range ? range.avg : null, leagueCount: range ? range.count : 0 };
    }

    // Tier the post-unlock free-agent pool into the craze board. Composes the existing
    // action board (so fit/faab/intelligence are reused) and filters to UDFA candidates
    // signed to an NFL team. Watch tier = undrafted prospects with no team (not claimable).
    // High-level UDFA-craze overview: total available signed UDFAs, broken out by
    // the league's playable position groups with a count + highest-rated in each.
    // It's a launchpad — drilling into a group filters the FA pool to rookies+that pos.
    function buildUdfaCrazeBoard(args = {}) {
        const currentLeague = args.currentLeague || {};
        const empty = { total: 0, groups: [], candidates: [] };
        if (!isDynastyLeague(currentLeague)) return empty;
        const statsData = args.statsData || {};
        const prevStatsData = args.prevStatsData || {};
        const prospects = (typeof window.getProspects === 'function' ? window.getProspects() : []) || [];
        const prospectNames = new Set(prospects.map(p => faNormName(p.name)).filter(Boolean));
        const prospectByName = new Map(prospects.map(p => [faNormName(p.name), p]));
        // The craze runs its own eligibility — exempt it from the GM-Office FA filters
        // (a minDHQ would wrongly nuke low-value-but-high-upside UDFAs).
        // skipTruthGate: undrafted rookies have no Sleeper line / depth slot yet.
        const board = (window.App?.buildFreeAgencyActionBoard || buildFreeAgencyActionBoard)({ ...args, skipGmFilters: true, skipTruthGate: true });
        const pool = board.actionBoardPlayers || [];

        const candidates = pool
            .filter(x => x.p?.team && isRookieWaiverLockedCandidate(x.pid, x.p, { rookiesLocked: true, prospectNames, statsData, prevStatsData }))
            .map(x => {
                const prospect = prospectByName.get(faNormName(x.name)) || null;
                // x.faab is already THE estimate (faModelBid) — the positional
                // history blend it used to get read a livFAABRange that doesn't
                // exist in this app (review N2).
                return { ...x, prospect, nflTeam: x.p.team, tierLabel: prospect?.tierLabel || null };
            });

        const posList = (args.leaguePositions && args.leaguePositions.length) ? args.leaguePositions : leaguePlayablePositions(currentLeague.roster_positions);
        const order = posList.length ? posList : ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
        const groups = order.map(pos => {
            const inPos = candidates.filter(c => String(c.pos || '').toUpperCase() === pos).sort((a, b) => (b.dhq || 0) - (a.dhq || 0));
            return { pos, count: inPos.length, top: inPos[0] || null };
        }).filter(g => g.count > 0);

        if ((typeof window.wrIsPro !== 'function' || window.wrIsPro()) && typeof window.App?.Intelligence?.publishRecommendations === 'function') {
            window.App.Intelligence.publishRecommendations('waiver', candidates.slice(0, 8).map(x => x.intelligence).filter(Boolean), { surface: 'udfa-craze' });
        }
        return { total: candidates.length, groups, candidates };
    }

    function udfaLockKey(leagueId) { return 'dhq_udfa_lock_' + (leagueId || 'default'); }
    // Detect the rookie lock→unlock flip and open the craze. Called on each FA
    // evaluation; persists the prior lock state so the flip is caught even when the
    // draft completed on the real platform (not via our draft sim → no draft:closed).
    function observeUdfaCrazeFlip(currentLeague, briefDraftInfo) {
        if (!isDynastyLeague(currentLeague)) return null;
        const leagueId = currentLeague?.league_id || currentLeague?.leagueId || window.S?.currentLeagueId || 'default';
        const store = window.DhqStorage;
        const key = udfaLockKey(leagueId);
        const prev = store ? store.get(key, null) : null;
        const now = rookiesLockedForWaivers(currentLeague, briefDraftInfo);
        if (store) store.set(key, now);
        if (prev === true && now === false) {
            // 21-day shelf life anchored to draft COMPLETION (owner ask 2026-07-12):
            // this flip can be observed months after the real-platform draft ended
            // (FA tab simply not opened), and openCraze would otherwise start a
            // fresh window from Date.now(). Completion ts = last_picked ||
            // start_time || created — same triple league-detail.js uses.
            const CRAZE_MAX_MS = 21 * 24 * 3600 * 1000;
            const completionTs = collectFaDrafts(currentLeague, briefDraftInfo)
                .filter(d => sameDraftSeason(d, currentLeague) && isRookieDraftLike(d, currentLeague) && String(d.status || '').toLowerCase() === 'complete')
                .reduce((ts, d) => Math.max(ts, Number(d.last_picked || d.start_time || d.created) || 0), 0);
            if (completionTs && Date.now() > completionTs + CRAZE_MAX_MS) return null; // stale flip — lock flag stored above, craze stays shut
            if (window.App?.PostDraft?.openCraze) {
                // Cap the window at completion+21d; the (shorter) waiver-cadence default wins otherwise.
                const defaultEnd = window.App.PostDraft.computeWindowEnd ? window.App.PostDraft.computeWindowEnd(currentLeague, Date.now()) : 0;
                const crazeOpts = { league: currentLeague };
                if (completionTs) crazeOpts.windowEnd = Math.min(defaultEnd || Infinity, completionTs + CRAZE_MAX_MS);
                try { window.App.PostDraft.openCraze(leagueId, crazeOpts); } catch (_) {}
            }
            try { window.dispatchEvent(new CustomEvent('wr:udfa-craze-open', { detail: { leagueId, season: currentLeague?.season } })); } catch (_) {}
            return leagueId;
        }
        return null;
    }

    window.App = window.App || {};
    window.App.rookiesLockedForWaivers = rookiesLockedForWaivers;
    window.App.isRookieWaiverLockedCandidate = isRookieWaiverLockedCandidate;
    window.App.buildFreeAgencyActionBoard = buildFreeAgencyActionBoard;
    window.App.buildUdfaCrazeBoard = buildUdfaCrazeBoard;
    window.App.observeUdfaCrazeFlip = observeUdfaCrazeFlip;
    window.App.blendFaabWithHistory = blendFaabWithHistory;
    // ONE bid estimate + its history fetch (bidfix) — the Flash Brief and any
    // other surface printing a bid for a player go through these.
    window.App.faModelBid = faModelBid;
    window.App.faEnsureBidHistory = faEnsureBidHistory;
    window.App.faValueOf = faValueOf;
    window.App.faBidsHere = faBidsHere;
    window.App.faRosterSig = faRosterSig;

    // Module-level caches for the waiver tools (FreeAgencyTab below).
    let _faStreamCache = null;

    // ── Waiver-tool styles (C2 wave 2026-09-27) ───────────────────────────
    // Scoped to the FA tab and rendered with it (no index.html / build edit).
    // Corners and type go through the tokens only (rounded identity; type
    // scale label 12 / body 16).
    const FA_WAIVER_CSS = `
        .fa-streams { border: 1px solid var(--acc-line2, rgba(212,175,55,0.3)); background: var(--off-black, #15151b); border-radius: var(--card-radius, 10px); padding: 12px 14px; margin: 0 0 14px; min-width: 0; }
        .fa-streams-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; }
        .fa-streams-head h3 { margin: 0; color: var(--gold); font-size: var(--text-label, 0.75rem); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
        .fa-streams-head span, .fa-streams-note, .fa-streams-foot { color: var(--silver); font-size: var(--text-label, 0.75rem); line-height: 1.5; }
        .fa-streams-note { margin: 8px 0 0; }
        .fa-streams-foot { margin: 8px 0 0; opacity: 0.8; }
        .fa-streams-toggle { display: flex; gap: 6px; margin: 8px 0 2px; flex-wrap: wrap; }
        .fa-streams-toggle button, .fa-streams-more { min-height: 44px; padding: 6px 12px; border-radius: var(--card-radius-sm, 8px); border: 1px solid var(--ov-6, rgba(255,255,255,0.1)); background: transparent; color: var(--silver); font: inherit; font-size: var(--text-label, 0.75rem); cursor: pointer; }
        .fa-streams-toggle button.is-active { border-color: var(--acc-line2, rgba(212,175,55,0.35)); background: var(--acc-fill2, rgba(212,175,55,0.1)); color: var(--gold); font-weight: 700; }
        .fa-streams-more { width: 100%; margin-top: 6px; color: var(--gold); }
        .fa-stream-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; width: 100%; min-height: 44px; padding: 10px 2px; border: 0; border-top: 1px solid var(--ov-4, rgba(255,255,255,0.06)); background: transparent; color: var(--white); text-align: left; cursor: pointer; font: inherit; }
        .fa-stream-row:hover { background: var(--acc-fill1, rgba(212,175,55,0.05)); }
        .fa-stream-main { min-width: 0; }
        .fa-stream-main strong { display: block; font-size: var(--text-body, 1rem); font-weight: 700; overflow-wrap: anywhere; }
        .fa-stream-main span { display: block; color: var(--silver); font-size: var(--text-label, 0.75rem); line-height: 1.45; }
        .fa-stream-main .fa-stream-swap { color: var(--white); }
        .fa-stream-main .fa-stream-lock { color: var(--warn, #f0a500); }
        .fa-stream-nums { display: flex; gap: 12px; text-align: right; }
        .fa-stream-nums span { display: block; color: var(--silver); font-size: var(--text-micro, 0.6875rem); text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
        .fa-stream-nums b { display: block; color: var(--white); font-size: var(--text-body, 1rem); font-family: var(--font-mono, 'JetBrains Mono', monospace); font-variant-numeric: tabular-nums; }
        .fa-stream-nums b.is-gain { color: var(--good, #2ecc71); }
        .fa-stream-nums b.is-loss { color: var(--bad, #e74c3c); }
        .fa-trend, .fa-stream-main .fa-trend, .fa-hq-player-main .fa-trend { display: inline-flex; align-items: center; gap: 5px; vertical-align: middle; margin-top: 2px; }
        .fa-trend em, .fa-hq-player-main .fa-trend em { display: inline; margin: 0; opacity: 0.85; font-style: normal; color: var(--silver); font-size: var(--text-micro, 0.6875rem); font-family: var(--font-mono, 'JetBrains Mono', monospace); white-space: nowrap; }
        .fa-bid-evidence { border: 1px solid var(--ov-5, rgba(255,255,255,0.08)); background: var(--ov-1, rgba(255,255,255,0.02)); border-radius: var(--card-radius-sm, 8px); padding: 9px 10px; margin: 0 0 10px; }
        .fa-bid-evidence b.fa-bid-evidence-head { display: block; color: var(--gold); font-size: var(--text-micro, 0.6875rem); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
        .fa-bid-evidence p { margin: 0; color: var(--white); font-size: var(--text-label, 0.75rem); line-height: 1.5; }
        .fa-bid-evidence p strong { color: var(--gold); font-family: var(--font-mono, 'JetBrains Mono', monospace); }
        .fa-bid-evidence small { display: block; margin-top: 4px; color: var(--silver); font-size: var(--text-micro, 0.6875rem); line-height: 1.45; }
        .fa-bid-evidence .is-warn { color: var(--warn, #f0a500); }
        .fa-hq-command-model { color: var(--silver); font-size: var(--text-micro, 0.6875rem); text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 4px; }
        .fa-hq-command-band { color: var(--gold); font-weight: 700; }
        .fa-bid-note { border: 1px dashed var(--ov-6, rgba(255,255,255,0.12)); border-radius: var(--card-radius-sm, 8px); padding: 8px 10px; margin: 0 0 10px; color: var(--silver); font-size: var(--text-label, 0.75rem); line-height: 1.5; }
        @media (max-width: 767px) {
            .fa-streams { padding: 12px; }
            .fa-stream-row { grid-template-columns: minmax(0, 1fr); }
            .fa-stream-nums { justify-content: flex-start; text-align: left; flex-wrap: wrap; }
        }
    `;

    // 2-week trend sparkline — REAL weekly fantasy points (league scoring)
    // from Sleeper's weekly stat lines (App.WaiverTools.trendFor). Renders
    // nothing under two real games, so it never implies data that isn't there.
    function FaTrendSpark({ trend }) {
        if (!Array.isArray(trend) || trend.length < 2) return null;
        const pts = trend.map(t => Number(t.pts) || 0);
        const min = Math.min(...pts), max = Math.max(...pts), range = (max - min) || 1;
        const w = 30, h = 14, step = w / (pts.length - 1);
        const path = pts.map((v, i) => (i * step).toFixed(1) + ',' + (h - 1 - ((v - min) / range) * (h - 2)).toFixed(1)).join(' ');
        const up = pts[pts.length - 1] >= pts[0];
        const label = 'Last ' + trend.length + ' games (league scoring): ' + trend.map(t => 'Wk ' + t.week + ' ' + Number(t.pts).toFixed(1)).join(', ');
        return (
            <span className="fa-trend" title={label} role="img" aria-label={label}>
                <svg width={w} height={h} viewBox={'0 0 ' + w + ' ' + h} aria-hidden="true">
                    <polyline points={path} fill="none" stroke={up ? 'var(--good, #2ecc71)' : 'var(--warn, #f0a500)'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <em>{'L' + trend.length + ': ' + trend.map(t => Number(t.pts).toFixed(1)).join(' → ')}</em>
            </span>
        );
    }

    // League bid history for one position — the league's own completed
    // winning bids, shown as history (C2 waiverBidEvidence). Never a price.
    function FaBidEvidence({ evidence, remaining }) {
        if (!evidence) return null;
        const e = evidence;
        const pos = window.App?.posLabel?.(e.pos) || (e.pos === 'DEF' ? 'D/ST' : e.pos);
        return (
            <div className="fa-bid-evidence">
                <b className="fa-bid-evidence-head">League bid history · {pos}</b>
                {e.enough
                    ? <p>The middle half of <b>{e.sampleSize}</b> winning {pos} bids this season: <strong>${e.low}–${e.high}</strong> (median ${e.median}).</p>
                    : <p>{e.sampleSize ? e.sampleSize + ' completed ' + pos + ' bid' + (e.sampleSize === 1 ? '' : 's') + ' this season' : 'No completed ' + pos + ' bids this season yet'} — {e.minNeeded} are needed to show a range. Not enough history yet.</p>}
                {e.enough && Number.isFinite(remaining) && e.low > remaining
                    ? <small className="is-warn">That range is above your remaining ${remaining}. Passing is a valid choice.</small> : null}
                <small>History, not a prediction — those players differed in quality and opportunity.</small>
            </div>
        );
    }

    // ── FaabCommandCard — league-aware bid plan (lab port 2026-08-16) ──
    // Deterministic: the league's own bid history (winning AND losing
    // claims via WrTxns.getFailedWaivers) is the model. Engine:
    // js/shared/faab-engine.js (App.Faab). The ChopOdds horizon read is
    // optional-chained — no chopped modules exist here, so the engine's
    // documented no-op path applies and the cap stays at SPEND_CAP.
    // C2 wave (2026-09-27): EVIDENCE FIRST — the real winning-bid range at
    // the target's position leads the card; the engine's bid and win odds
    // below it are labelled as our model's estimate. Only Sleeper FAAB
    // leagues fetch (rolling waivers / ESPN / MFL never hit the 19
    // transaction endpoints for nothing — the parent shows a note instead).
    // bidfix: the bid printed here is faModelBid — the SAME call the hero,
    // the board rows and the drawer make for this target — so the card can
    // no longer say $26 under a hero that says $7–14.
    function FaabCommandCard({ league, myRoster, playersData, targets, skin }) {
        const [pick, setPick] = useState(0);
        const [plan, setPlan] = useState(null);   // null | {loading} | {est, evidence} | {err}
        // Fall back to the top target if the board shifted under a stale index
        // (a new week's Priority Moves can be shorter than the old selection).
        const target = (targets || [])[pick] || (targets || [])[0] || null;
        const lid = league?.league_id || league?.id || '';
        const bidsHere = faBidsHere(league);
        // Re-plan when the rosters refresh in place (budgets / roster sizes —
        // review S1) or the league's bid history changes, not only on a new target.
        const rosterSig = faRosterSig(league);
        useEffect(() => {
            if (!target || !bidsHere || !window.WrTxns) { setPlan(null); return; }
            let alive = true;
            setPlan({ loading: true });
            (async () => {
                try {
                    // One fetch per league (6h cache) — announces wr:fa-txns-updated
                    // so the parent tab's rows/hero recompute on the same history.
                    await faEnsureBidHistory(league);
                    const txns = window.WrTxns.getCached ? (window.WrTxns.getCached(lid) || []) : [];
                    const evidence = window.App?.WaiverTools?.bidEvidence
                        ? window.App.WaiverTools.bidEvidence(txns, league, target.pos, playersData)
                        : null;
                    const est = faModelBid({ league, myRoster, playersData, pid: target.pid, pos: target.pos, skin });
                    if (alive) setPlan(est || evidence ? { est, evidence } : null);
                } catch (e) { if (alive) setPlan({ err: true }); }
            })();
            return () => { alive = false; };
        }, [lid, target?.pid, bidsHere, rosterSig, _faTxnsVersion, skin]);
        if (!target || !bidsHere || (plan && plan.err)) return null;
        if (plan && plan.loading) {
            return <div style={{ padding: '10px 12px', marginBottom: '10px', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderRadius: 'var(--card-radius-sm, 8px)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>Reading this league’s bid history…</div>;
        }
        const est = plan && plan.est;
        const a = est && est.analysis;
        const evidence = plan && plan.evidence;
        if (!a && !evidence) return null;    // pre-effect or engine absent
        const budgetNum = Number(league?.settings?.waiver_budget) || 0;
        const usedRaw = myRoster?.settings?.waiver_budget_used;
        const myLeft = a ? a.myLeft : (usedRaw == null ? null : Math.max(0, budgetNum - Number(usedRaw)));
        if (!a) {
            return (
                <div className="fa-hq-command">
                    <div className="fa-hq-command-head">
                        <b>FAAB Command</b>
                        {myLeft != null ? <span>${myLeft} of ${budgetNum} left</span> : null}
                    </div>
                    {targets.length > 1 ? (
                        <div className="fa-hq-command-picks">
                            {targets.map((t, i) => (
                                <button key={t.pid} className={i === pick ? 'is-active' : ''} onClick={() => setPick(i)}>{t.name}</button>
                            ))}
                        </div>
                    ) : null}
                    <FaBidEvidence evidence={evidence} remaining={myLeft} />
                </div>
            );
        }
        const needColor = n => n === 'HIGH' ? 'var(--warn)' : n === 'MED' ? 'var(--silver)' : 'var(--text-muted)';
        const engaged = a.rivals.filter(r => r.engaged);
        // Win odds only where they rest on this league's own history: the
        // engine out of league-median (cold-start) mode AND at least MIN_BIDS
        // completed winning bids at this position. Otherwise the model's bid
        // stays (labelled an estimate) but no percentage is printed — a win
        // probability off one or two bids is a made-up number (C2 dropped it
        // outright; review 2026-09-27).
        const oddsOk = !a.coldStart && !!(evidence && evidence.enough);
        const posLabel = window.App?.posLabel?.(target.pos) || target.pos || 'this position';
        return (
            <div className="fa-hq-command">
                <div className="fa-hq-command-head">
                    <b>FAAB Command</b>
                    <span>${a.myLeft} of ${a.budget} left</span>
                    {a.coldStart
                        ? <span title="Fewer than 15 bids logged this season — the model uses league-size defaults, not per-rival reads" className="is-warn">league-median mode · {a.sampleSize} bids logged, all positions</span>
                        : <span title="Every FAAB bid this season at any position, winning and losing — the model's input. The history box counts only completed winning bids at this position.">{a.sampleSize} bids logged, all positions (won + lost)</span>}
                </div>
                {targets.length > 1 ? (
                    <div className="fa-hq-command-picks">
                        {targets.map((t, i) => (
                            <button key={t.pid} className={i === pick ? 'is-active' : ''} onClick={() => setPick(i)}>{t.name}</button>
                        ))}
                    </div>
                ) : null}
                <FaBidEvidence evidence={evidence} remaining={a.myLeft} />
                <div className="fa-hq-command-model">DHQ bid model · estimate</div>
                <div className="fa-hq-command-hero">
                    <strong>${a.rec.bid}</strong>
                    <span>
                        {est.lo !== est.hi ? <span className="fa-hq-command-band" title={faEstTitle(est)}>est. range {faEstText(est)} · </span> : null}
                        {!engaged.length
                            ? 'uncontested — no rival needs him'
                            : oddsOk
                            ? 'est. ' + Math.round(a.rec.winPct * 100) + '% to win' + (a.rec.capped ? ' — capped by your remaining budget' : '') + ' · ' + engaged.length + ' rival' + (engaged.length === 1 ? '' : 's') + ' in the market'
                            : engaged.length + ' rival' + (engaged.length === 1 ? '' : 's') + ' with a ' + posLabel + ' need and budget · not enough league bid history for win odds' + (a.rec.capped ? ' · capped by your remaining budget' : '')}
                    </span>
                </div>
                {/* CHOPPED pacing: budget you never spend is budget you lose.
                    In a real 18-team chopped league the three teams that spent
                    nothing went out weeks 1-3, while the champion finished with
                    $565 left. */}
                {a.pacing ? (
                    <div className={'fa-hq-command-pace' + (a.pacing.verdict === 'hoarding' ? ' is-warn' : '')}>
                        {a.pacing.verdict === 'hoarding'
                            ? <span><b style={{ color: 'var(--warn)' }}>You are hoarding.</b> ~{a.pacing.horizonWeeks} weeks left at your survival odds, and at your current ${a.pacing.myPacePerWeek}/wk pace you would be chopped holding <b>${a.pacing.projectedUnspent.toLocaleString()}</b>. You can afford ${a.pacing.affordPerWeek}/wk.</span>
                            : a.pacing.verdict === 'slightly-under'
                            ? <span>~{a.pacing.horizonWeeks} weeks left · spending ${a.pacing.myPacePerWeek}/wk of the ${a.pacing.affordPerWeek}/wk you can afford — about ${a.pacing.projectedUnspent.toLocaleString()} would go unspent.</span>
                            : <span>~{a.pacing.horizonWeeks} weeks left · on pace at ${a.pacing.myPacePerWeek}/wk against ${a.pacing.affordPerWeek}/wk affordable.</span>}
                    </div>
                ) : null}
                {/* With nobody contesting him, every rung prices at the same
                    capped 97% and the ladder reads as broken. Say the true
                    thing instead: the minimum bid is enough. */}
                {!engaged.length ? (
                    <div className="fa-hq-command-note">
                        No rival has both a need at {posLabel} and the budget to chase him — the league minimum (${a.minBid}) may be enough. Spend the difference on someone contested.
                    </div>
                ) : !oddsOk ? null : a.ladder.map(l => (
                    <div key={l.bid} className={'fa-hq-ladder-row' + (l.bid === a.rec.bid ? ' is-rec' : '')}>
                        <b>${l.bid}</b>
                        <div className="fa-hq-ladder-track"><i className="fa-hq-ladder-fill" style={{ width: Math.round(l.winPct * 100) + '%' }} /></div>
                        <span className="fa-hq-ladder-pct">{Math.round(l.winPct * 100)}%</span>
                    </div>
                ))}
                {oddsOk && engaged.length ? (
                    <div>
                        <div className="fa-hq-rivals-label">Who else wants him</div>
                        {engaged.slice(0, 4).map(r => (
                            <div key={r.rosterId} className="fa-hq-rival-row">
                                <span>{r.name}</span>
                                <span>${r.faabLeft}</span>
                                <span style={{ color: needColor(r.need), fontWeight: 700 }}>{r.need}</span>
                                <span>est ${r.estBid}</span>
                            </div>
                        ))}
                    </div>
                ) : null}
                <div className="fa-hq-command-foot">
                    {a.coldStart
                        ? 'Rival bid reads unlock as this league logs claims — recommendations use league-size medians until then.'
                        : 'League median comparable: $' + a.medianBid + ' · you’ve spent ' + a.mySpentPct + '% vs a ' + a.leagueSpentPct + '% league average.'}
                </div>
            </div>
        );
    }

    // ── Streaming & season upgrades — the heavy half (runs in an idle
    // callback from FreeAgencyTab, cached module-wide by input signature so a
    // tab switch or an unrelated re-render never re-solves). Inputs are read
    // from a ref at run time; the signature decides WHEN it runs.
    function gmFaTickForStreams(league) {
        try {
            const id = league?.league_id || league?.id;
            const u = window.WR?.GmMode?.effects?.(id)?.untouchable;
            const tags = window._playerTags || {};
            return [...(u instanceof Set ? u : [])].sort().join(',') + '/' + Object.keys(tags).filter(k => tags[k] === 'untouchable').sort().join(',');
        } catch (e) { return ''; }
    }
    function faComputeStreams(a) {
        const week = a.week;
        const off = { ok: false, reason: 'off', rows: [], lines: 0, rosOn: !!a.ros, week, lock: a.lock };
        const WP = window.App && window.App.WeeklyProj;
        const W = faWT();
        const normPos = window.App?.normPos || (x => x);
        if (!WP || !WP.projectPlayer || !W || !a.myRoster) return off;
        const lock = a.lock || { known: false, started: false, allFinal: false, lockedTeam: () => false };
        const pd = a.playersData || {};
        // The pool is built from the players that HAVE a published line for
        // this week (WeeklyProj's own line store), not a scan of every
        // player in the database.
        const ctx = WP._ctx || {};
        const prefix = week + '|';
        const ids = new Set();
        Object.keys(ctx.projLines || {}).forEach(k => { if (k.indexOf(prefix) === 0) ids.add(k.slice(prefix.length)); });
        Object.keys(ctx.platPts || {}).forEach(k => { if (k.indexOf(prefix) === 0) ids.add(k.slice(prefix.length)); });
        const seasonal = faIsSeasonal(a.currentLeague, a.resolvedLeagueSkin);
        const pool = [];
        let lines = 0;
        ids.forEach(pid => {
            const p = pd[pid];
            if (!p || !p.team) return;
            if (!(WP.projLine(pid, week) || (WP.platformPoints && WP.platformPoints(pid, week) != null))) return;
            lines++;
            if (a.rostered.has(pid) || p.active === false || p.status === 'Inactive' || p.status === 'Retired') return;
            if (a.leaguePosSet && !a.leaguePosSet.has(normPos(p.position) || p.position)) return;
            if (a.isDraftProspect(pid, p)) return;
            if (seasonal && !faRoleRead(p, a.currentLeague, a.resolvedLeagueSkin).eligible) return;
            pool.push({ pid });
        });
        if (!lines) return { ...off, ok: true, reason: 'no_lines', lines: 0 };
        // Week over (every game final) or schedule unknown inside the game
        // window: no this-week gains. The season view still runs if ROS is on.
        const weekOver = lock.known && lock.allFinal;
        const weekUnknown = !lock.known && lock.started;
        const horizon = (weekOver || weekUnknown) ? 'season' : a.horizon;
        if ((weekOver || weekUnknown) && !a.ros) return { ...off, ok: true, reason: weekOver ? 'week_over' : 'locks_unknown', lines, weekOver, weekUnknown };
        const scoring = a.currentLeague?.scoring_settings || {};
        const projOf = pid => {
            try {
                const pr = WP.projectPlayer(pid, { playersData: pd, statsData: a.statsData, priorData: a.prevStatsData, scoring, week, requireSleeper: true });
                if (!pr || !pr.points || pr.projSource === 'estimate' || !Number.isFinite(pr.points.median)) return null;
                return { pts: pr.points.median, available: pr.available !== false };
            } catch (e) { return null; }
        };
        const leagueId = String(a.currentLeague?.league_id || a.currentLeague?.id || '');
        const gm = window.WR?.GmMode?.effects?.(leagueId) || {};
        const tags = window._playerTags || {};
        const protectedPids = [...(gm.untouchable instanceof Set ? gm.untouchable : [])]
            .concat(Object.keys(tags).filter(k => tags[k] === 'untouchable'));
        const valueOf = pid => (window.App?.PlayerValue?.getValue
            ? window.App.PlayerValue.getValue(pid, { skin: a.resolvedLeagueSkin })
            : (window.App?.LI?.playerScores?.[pid] ?? null));
        let res;
        try {
            res = W.streamUpgrades({
                roster: a.myRoster, league: a.currentLeague, playersData: pd, candidates: pool,
                projOf, valueOf, protectedPids, perPosition: 4,
                // Week over: every game is final, nothing is locked for next
                // week's moves. Schedule unknown: we can't say who is locked, so
                // there are no this-week gains at all (the card says so).
                lockedOf: (weekOver || weekUnknown) ? null : (pid => lock.lockedTeam(pd[pid] && pd[pid].team)),
                rosOf: a.ros ? (pid => (a.ros.points[pid] != null ? a.ros.points[pid] : 0)) : null,
                horizon,
            });
        } catch (e) {
            if (window.wrLog) window.wrLog('fa.streams', e);
            return off;
        }
        return { ...res, lines, rosOn: !!a.ros, week, lock, horizon, weekOver, weekUnknown, poolSize: pool.length };
    }

    window.App.getFreeAgencyBriefTarget = function getFreeAgencyBriefTarget(args) {
        return buildFreeAgencyActionBoard(args).priorityAdds[0] || null;
    };

    function FreeAgencyTab({ playersData, statsData, prevStatsData, myRoster, currentLeague, leagueSkin, sleeperUserId, timeRecomputeTs, viewMode, briefDraftInfo }) {
        const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
        const skinFeatures = resolvedLeagueSkin?.features || {};
        const skinVocabulary = resolvedLeagueSkin?.vocabulary || {};
        // Scout-free vs Pro (gate map row 7): recommendation surfaces (Action
        // HQ, priority adds, FAAB bids, fit/window reads, UDFA craze) are Pro;
        // the raw Market Explorer + filters stay free. Fail-open.
        const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;
        // ══ PHONE (<768) — iPhone program Phase 1 (FA) ═══════════════════
        // Hooks are called HERE, unconditionally at the top of the component
        // (this file has conditional returns further down — roster blocker +
        // command view — so phone hooks can't live next to the phone branch
        // itself). viewport.js + the Phase-0 kit are plain scripts earlier in
        // the babel chain: presence is fixed for the page's lifetime, so the
        // guarded call keeps hook order stable across renders.
        const _faUseVp = window.WR && window.WR.useViewport;
        const _faVp = _faUseVp ? _faUseVp() : { isPhone: false };
        const [faPanel, setFaPanel] = useState(null);   // inline chooser: null|'filters'|'sort'|'view'
        const _faPhone = !!_faVp.isPhone && !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.CardList && window.WR.FilterPill && window.WR.FilterSheet && window.WR.Sheet);
        // Sleeper's published weekly projections are THE source for every number
        // on this screen. Only Lineup and My Team used to load them, so opening
        // Free Agency directly left the board with nothing published and every
        // projection fell through to the home-grown estimate — which is how a
        // back with one career appearance came to lead the waiver board. Load
        // them here too, and recompute when they land.
        const [projTick, setProjTick] = useState(0);
        React.useEffect(() => {
            const SP = window.App && window.App.SleeperProj;
            if (!SP || !SP.loadCurrent) return;
            let alive = true;
            SP.loadCurrent(currentLeague && currentLeague.season)
                .then(wk => { if (alive && wk) setProjTick(t => t + 1); })
                .catch(() => {});
            const onProj = () => { if (alive) setProjTick(t => t + 1); };
            window.addEventListener('wr:proj-updated', onProj);
            return () => { alive = false; window.removeEventListener('wr:proj-updated', onProj); };
        }, [currentLeague?.league_id, currentLeague?.season]);

        // Redraft → build rest-of-season values so waiver/FA targets rank by ROS
        // production instead of dynasty DHQ. No-op (DHQ) for dynasty/keeper.
        React.useMemo(() => {
            try {
                window.App?.PlayerValue?.ensureRos?.({
                    leagueId: currentLeague?.league_id || currentLeague?.id,
                    league: currentLeague, playersData, statsData, priorData: prevStatsData,
                    skin: resolvedLeagueSkin,
                });
            } catch (e) { if (window.wrLog) window.wrLog('fa.ensureRos', e); }
            return null;
        }, [currentLeague, playersData, statsData, prevStatsData, timeRecomputeTs, projTick]);
        const valueLabel = skinVocabulary.valueLabel || FA_COLUMNS.dhq.label;
        const valueShortLabel = skinVocabulary.valueShortLabel || FA_COLUMNS.dhq.shortLabel;
        const valueKpiLabel = (valueShortLabel === 'DHQ' ? 'DHQ VALUE' : valueShortLabel.toUpperCase());
        const [faTargets, setFaTargets] = useState([]);
        const [faFilter, setFaFilter] = useState('');
        const [faBudget, setFaBudget] = useState({ total: 0, spent: 0 });
        const [faSort, setFaSort] = useState({ key: 'dhq', dir: -1 });
        const [faSelectedPid, setFaSelectedPid] = useState(null);
        const [faSearch, setFaSearch] = useState('');
        // ── Min-points filter (owner ruling 2026-08-28: pared from the five-
        // criteria prototype to the one window he kept, then tucked inline
        // into the View toolbar row — no separate Filters panel). Stacks with
        // the text search and POS chips; season chips pick which year's points.
        const [faAdv, setFaAdv] = useState({ minPrevPts: '' });
        // Season default is AUTO — the current season once it has real stats,
        // last season until then (in August a this-year default would filter
        // out the entire league at 0 GP).
        const faSeasonYear = Number(currentLeague?.season) || new Date().getFullYear();
        const faAutoPtsYear = useMemo(() => {
            const st = statsData || {};
            for (const k in st) { if ((st[k]?.gp || 0) > 0) return faSeasonYear; }
            return faSeasonYear - 1;
        }, [statsData, faSeasonYear]);
        const faPtsYearActive = faAutoPtsYear;
        const faAdvCount = String(faAdv.minPrevPts).trim() !== '' ? 1 : 0;
        const faAdvPass = (x) => {
            if (!faAdvCount) return true;
            const minPts = parseFloat(faAdv.minPrevPts);
            if (isFinite(minPts)) {
                const src = faPtsYearActive === faSeasonYear ? (statsData || {}) : (prevStatsData || {});
                const st = src[x.pid] || {};
                const pts = st.gp > 0 && typeof calcRawPts === 'function' ? calcRawPts(st) : 0;
                if (!(pts >= minPts)) return false;
            }
            return true;
        };
        const [visibleFaCols, setVisibleFaCols] = useState(() => {
            const stored = window.App?.WrStorage?.get?.('wr_fa_cols');
            const valid = Array.isArray(stored) ? stored.filter(k => FA_COLUMNS[k]) : [];
            if (!valid.length) return faTierCols(FA_COLUMN_PRESETS.default);
            // One-time migration: surface the new this-week projection column for
            // users whose saved column set predates it (insert after PPG/DHQ).
            if (!valid.includes('proj')) {
                const at = valid.indexOf('ppg') >= 0 ? valid.indexOf('ppg') + 1 : valid.indexOf('dhq') >= 0 ? valid.indexOf('dhq') + 1 : valid.length;
                valid.splice(at, 0, 'proj');
            }
            return faTierCols(valid);
        });
        const [faColPreset, setFaColPreset] = useState('default');
        // Derive the ACTIVE view from the PERSISTED columns (my-team idiom) —
        // faColPreset is session-only and snapped to 'default' on reload, which
        // froze the phone stat slots + VIEW pill no matter which view was saved
        // (owner ask 2026-07-12). Tier-filter the preset side so a free user's
        // default (faab stripped) still matches. Derived key wins over faColPreset.
        const sameFaColSet = (a, b) => a.length === b.length && a.every((key, idx) => key === b[idx]);
        const faActivePresetKey = Object.entries(FA_COLUMN_PRESETS).find(([, cols]) => sameFaColSet(faTierCols(cols), visibleFaCols))?.[0] || 'custom';
        const [showFaColPicker, setShowFaColPicker] = useState(false);
        // Rolling PPG window — shared localStorage key with My Roster so the setting persists across tabs.
        const [ppgWindow, setPpgWindow] = useState(() => { try { return localStorage.getItem('wr_ppg_window') || 'season'; } catch { return 'season'; } });
        useEffect(() => { try { localStorage.setItem('wr_ppg_window', ppgWindow); } catch {} }, [ppgWindow]);
        const [, forcePpgRerender] = useState(0);
        useEffect(() => {
            const h = () => forcePpgRerender(n => n + 1);
            window.addEventListener('wr:weekly-points-loaded', h);
            return () => window.removeEventListener('wr:weekly-points-loaded', h);
        }, []);
        // Per-game signature stats (C2 fa-market-data port) — the header pair
        // for the active POS filter; null for mixed / flex views.
        const faSigStats = [0, 1].map(i => { try { return window.App?.FAMarketData?.signature?.(faFilter, i, {}) || null; } catch (e) { return null; } });
        const faSigKey = faSigStats.map(x => (x ? x.key : '')).join('|');
        const faSigRead = (pos, idx, pid) => {
            try { return window.App?.FAMarketData?.signature?.(pos, idx, (statsData || {})[pid] || {}) || null; } catch (e) { return null; }
        };
        useEffect(() => {
            if ((faSort.key === 'sig1' || faSort.key === 'sig2') && !faSigStats[0]) setFaSort({ key: 'dhq', dir: -1 });
        }, [faFilter, faSort.key]);
        const faColumns = useMemo(() => ({
            ...FA_COLUMNS,
            dhq: {
                ...FA_COLUMNS.dhq,
                label: valueLabel,
                shortLabel: valueShortLabel,
            },
            peakYr: {
                ...FA_COLUMNS.peakYr,
                label: skinFeatures.showAgeCurve === false ? 'Value Window' : FA_COLUMNS.peakYr.label,
                shortLabel: skinFeatures.showAgeCurve === false ? 'Window' : FA_COLUMNS.peakYr.shortLabel,
            },
            // One concrete POS filter → the header names the stat ("TGT/G",
            // "SNP%"); mixed / flex views keep the generic header and are not
            // sortable (a WR's targets and an LB's tackles don't rank together).
            sig1: { ...FA_COLUMNS.sig1, ...(faSigStats[0] ? { label: faSigStats[0].label + ' (this season)', shortLabel: faSigStats[0].short } : { sortKey: null }) },
            sig2: { ...FA_COLUMNS.sig2, ...(faSigStats[1] ? { label: faSigStats[1].label + ' (this season)', shortLabel: faSigStats[1].short } : { sortKey: null }) },
        }), [valueLabel, valueShortLabel, skinFeatures.showAgeCurve, faSigKey]);

        useEffect(() => { try { window.App?.WrStorage?.set?.('wr_fa_cols', visibleFaCols); } catch {} }, [visibleFaCols]);
        // Resurrect-proofing: saved views / older persisted prefs can still
        // carry Pro-only columns — normalize state whenever one sneaks in.
        useEffect(() => {
            if (isPro) return;
            setVisibleFaCols(prev => prev.some(k => FA_PRO_COLS.has(k)) ? prev.filter(k => !FA_PRO_COLS.has(k)) : prev);
        }, [isPro, visibleFaCols]);

        const normPos = window.App.normPos;
        const calcRawPts = (s) => window.App.calcRawPts(s, currentLeague?.scoring_settings);
        const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters, leagueSkin: resolvedLeagueSkin }) || { isUsable: true };
        const leagueProfile = useMemo(() => {
            return typeof window.App?.Intelligence?.buildLeagueProfile === 'function'
                ? window.App.Intelligence.buildLeagueProfile({ league: currentLeague, rosters: currentLeague?.rosters || [], platform: currentLeague?._platform })
                : null;
        }, [currentLeague]);
        const rookiesLocked = rookiesLockedForWaivers(currentLeague, briefDraftInfo);
        const prospectNames = useMemo(() => {
            if (!rookiesLocked || typeof window.getProspects !== 'function') return new Set();
            return new Set((window.getProspects() || []).map(p => faNormName(p.name)).filter(Boolean));
        }, [rookiesLocked, timeRecomputeTs]);
        const isDraftProspect = useCallback((pid, p) => {
            return isRookieWaiverLockedCandidate(pid, p, { rookiesLocked, prospectNames, statsData, prevStatsData });
        }, [rookiesLocked, prospectNames, statsData, prevStatsData]);

        // ── UDFA craze (dynasty post-rookie-draft scramble) ──────────────────────
        const crazeLeagueId = currentLeague?.league_id || currentLeague?.id || window.S?.currentLeagueId || 'default';
        const [crazeTick, setCrazeTick] = useState(0);
        // Catch the rookie lock→unlock flip and reconcile remote craze state.
        useEffect(() => {
            try { window.App?.observeUdfaCrazeFlip?.(currentLeague, briefDraftInfo); } catch (e) {}
            try {
                const pulled = window.App?.PostDraft?.pullCraze?.(crazeLeagueId);
                if (pulled && typeof pulled.then === 'function') pulled.then(() => setCrazeTick(t => t + 1)).catch(() => {});
            } catch (e) {}
        }, [crazeLeagueId, rookiesLocked]);
        // One-time open notification + live countdown refresh.
        useEffect(() => {
            const onOpen = () => setCrazeTick(t => t + 1);
            window.addEventListener('wr:udfa-craze-open', onOpen);
            const iv = setInterval(() => setCrazeTick(t => t + 1), 60000);
            return () => { window.removeEventListener('wr:udfa-craze-open', onOpen); clearInterval(iv); };
        }, []);
        const crazeState = (window.App?.PostDraft?.getCraze?.(crazeLeagueId)) || null;
        const crazeOpen = !!(crazeState && crazeState.open && !crazeState.dismissed);
        const crazeBoard = useMemo(() => {
            if (!isPro) return null; // craze board is Pro — free gets the lock row in renderCrazePanel
            if (!crazeOpen || typeof window.App?.buildUdfaCrazeBoard !== 'function') return null;
            try {
                return window.App.buildUdfaCrazeBoard({
                    playersData, statsData, prevStatsData, myRoster, currentLeague,
                    leagueSkin: resolvedLeagueSkin, briefDraftInfo, crazeSeed: (crazeState && crazeState.seed) || [],
                });
            } catch (e) { return null; }
        }, [isPro, crazeOpen, crazeTick, playersData, statsData, myRoster, currentLeague, timeRecomputeTs]);

        // Load FA targets from Supabase/localStorage
        useEffect(() => {
            if (window.OD?.loadTargets) {
                window.OD.loadTargets(currentLeague.league_id || currentLeague.id).then(data => {
                    if (data) { setFaTargets(data.targets || []); setFaBudget({ total: data.startingBudget || 200, spent: 0 }); }
                }).catch(err => window.wrLog('fa.loadTargets', err));
            }
        }, []);

        // Find available (unrostered) players
        const rostered = useMemo(() => {
            // Copy-aware availability — see buildFreeAgencyActionBoard above. A player
            // counts as rostered only when every copy the league allows is taken.
            const copies = Math.max(1, Number(currentLeague?.settings?.player_copies) || 1);
            const count = {};
            // Dedupe per roster — taxi/reserve ids are also in players[].
            (currentLeague.rosters || []).forEach(r => new Set((r.players || []).concat(r.taxi || [], r.reserve || []).map(String)).forEach(k => { count[k] = (count[k] || 0) + 1; }));
            return { has: (pid) => (count[String(pid)] || 0) >= copies };
        }, [currentLeague]);

        // Positions this league actually rosters (gates D/ST, K, IDP out of the wire
        // for formats that don't use them — e.g. no D/ST recs in an IDP-only league).
        // Falls back to "no gate" if the helper is unavailable, to avoid over-filtering.
        const leaguePosSet = useMemo(() => {
            try {
                return typeof window.getLeaguePositions === 'function'
                    ? window.getLeaguePositions({ league: currentLeague, asSet: true })
                    : null;
            } catch (e) { return null; }
        }, [currentLeague]);

        // The shared pool builder (faBuildAvailable) — the action board behind
        // the Flash Brief builds from the same function, so both rank the same
        // players on the same value (App.PlayerValue: ROS in redraft/chopped).
        const availablePlayers = useMemo(() => {
            if (!rosterState.isUsable) return [];
            return faBuildAvailable({ playersData, statsData, prevStatsData, currentLeague, skin: resolvedLeagueSkin, rostered, isDraftProspect, leaguePosSet });
        }, [rosterState.isUsable, playersData, statsData, prevStatsData, currentLeague, rostered, timeRecomputeTs, isDraftProspect, leaguePosSet, projTick]);

        // ── Streaming & season upgrades (C2 renderWeeklyStreams port) ──────────
        // "Add X, drop Y: +N lineup points this week / rest of season." Our own
        // lineup solver (App.StartSit via App.WaiverTools.streamUpgrades) runs
        // the roster before and after every legal add/drop. Truth rules:
        //   • a pickup must carry Sleeper's (or the league platform's) PUBLISHED
        //     line for the CURRENT week — requireSleeper, never the home-grown
        //     estimate, never last week's lines standing in for this week's;
        //   • OUT / IR / bye / Doubtful players are never a this-week pickup;
        //   • game locks (App.NflContext kickoffs): a player whose game has
        //     started can't be added or dropped and a locked starter keeps his
        //     slot; with no schedule inside the game window, this week's gains
        //     are hidden rather than guessed; a finished week says so;
        //   • one-season formats never offer a backup QB (role check);
        //   • best ball has no lineup to set, so the card says so instead;
        //   • dynasty keeps its E3 ruling (showStreaming false → hidden).
        // Cost (review 2026-09-27: 19 runs / ~800ms per FA open): the solve is
        // keyed on a signature of what actually changes the answer — roster,
        // rostered set, week, Sleeper-line loads (not DHQ batches), ROS build,
        // locks, horizon — and runs in an idle callback, cached module-wide.
        const [streamHorizon, setStreamHorizon] = useState('week');
        const [streamShowAll, setStreamShowAll] = useState(false);
        const faLeagueTypeNow = faLeagueType(currentLeague, resolvedLeagueSkin);
        const faPlatformNow = faLeaguePlatform(currentLeague);
        const streamBestBall = faLeagueTypeNow === 'best_ball';
        const streamLeagueId = String(currentLeague?.league_id || currentLeague?.id || '');
        const streamWeek = (() => {
            const WP = window.App && window.App.WeeklyProj;
            return WP && WP.currentWeek ? WP.currentWeek() : (Number(window.S?.currentWeek) || 1);
        })();
        const streamEliminated = !!(myRoster && window.App?.Chopped?.isEliminated?.(myRoster));
        const streamWanted = isPro && skinFeatures.showStreaming !== false && !streamBestBall && !streamEliminated && !!myRoster && rosterState.isUsable;
        // Sleeper / platform line loads only — DHQ batches also fire
        // wr:proj-updated (source 'dhq') and must not re-run the solve.
        const [streamProjStamp, setStreamProjStamp] = useState(0);
        useEffect(() => {
            const h = (e) => { if (e && e.detail && e.detail.source === 'dhq') return; setStreamProjStamp(t => t + 1); };
            window.addEventListener('wr:proj-updated', h);
            return () => window.removeEventListener('wr:proj-updated', h);
        }, []);
        // Kickoffs for the week — shared, 60s-cached scoreboard call (the live
        // scoreboard reads the same one). Refreshed every 5 min while visible.
        const streamSeason = String(currentLeague?.season || window.S?.season || '');
        const [streamGames, setStreamGames] = useState({ key: '', games: null, at: 0 });
        const streamGamesKey = streamSeason + '|' + streamWeek;
        useEffect(() => {
            if (!streamWanted) return undefined;
            const NC = window.App && window.App.NflContext;
            if (!NC || !NC.loadScores) { setStreamGames({ key: streamGamesKey, games: [], at: Date.now() }); return undefined; }
            let alive = true;
            const load = () => {
                if (typeof document !== 'undefined' && document.hidden) return;
                NC.loadScores(streamWeek, streamSeason, 2)
                    .then(games => { if (alive) setStreamGames({ key: streamGamesKey, games: games || [], at: Date.now() }); })
                    .catch(() => { if (alive) setStreamGames({ key: streamGamesKey, games: [], at: Date.now() }); });
            };
            load();
            const iv = setInterval(load, 300000);
            return () => { alive = false; clearInterval(iv); };
        }, [streamWanted, streamGamesKey]);
        const streamGamesReady = streamGames.key === streamGamesKey && Array.isArray(streamGames.games);
        const streamLock = (() => {
            const W = faWT();
            if (!W || !W.lockBoard || !streamGamesReady) return null;
            return W.lockBoard(streamGames.games, window.App?.NflContext?.gameStatus, Date.now());
        })();
        const streamLockStamp = !streamLock ? 'pending'
            : (streamLock.known ? 'k:' + Object.keys(streamLock.byTeam).filter(t => streamLock.lockedTeam(t)).sort().join(',') + (streamLock.allFinal ? ':final' : '')
                : 'u:' + (streamLock.started ? 1 : 0));
        const streamRos = window.App?.PlayerValue?.rosState?.() || null;
        // ROS only when it was built on THIS week's published lines.
        const streamRosOn = !!(streamRos && String(streamRos.leagueId) === streamLeagueId && streamRos.points && streamRos.remainingWeeks > 0 && Number(streamRos.week) === Number(streamWeek));
        const streamRosStamp = streamRosOn ? streamRos.week + ':' + streamRos.remainingWeeks + ':' + Object.keys(streamRos.points).length : '';
        const streamRosterKey = myRoster ? [myRoster.players, myRoster.reserve, myRoster.taxi, myRoster.starters].map(a => (a || []).join(',')).join('/') : '';
        const streamRosteredKey = useMemo(() => (currentLeague?.rosters || []).map(r => (r.players || []).length + ':' + (r.players || []).slice(0, 3).join(',') + ':' + (r.players || []).slice(-3).join(',')).join('|'), [currentLeague]);
        const streamSig = [streamLeagueId, streamRosterKey, streamRosteredKey, streamWeek, streamProjStamp, streamRosOn ? streamHorizon : 'week', streamRosStamp, streamLockStamp, gmFaTickForStreams(currentLeague)].join('#');
        const streamInputs = useRef(null);
        streamInputs.current = { playersData, statsData, prevStatsData, currentLeague, myRoster, rostered, leaguePosSet, isDraftProspect, resolvedLeagueSkin, week: streamWeek, lock: streamLock, ros: streamRosOn ? streamRos : null, horizon: streamRosOn ? streamHorizon : 'week' };
        const [streamState, setStreamState] = useState(() => (_faStreamCache && _faStreamCache.sig === streamSig ? _faStreamCache : { sig: '', read: null }));
        useEffect(() => {
            if (!streamWanted || !streamLock) return undefined;
            if (_faStreamCache && _faStreamCache.sig === streamSig) { if (streamState.sig !== streamSig) setStreamState(_faStreamCache); return undefined; }
            let cancelled = false;
            const run = () => {
                if (cancelled) return;
                const read = faComputeStreams(streamInputs.current);
                if (cancelled) return;
                _faStreamCache = { sig: streamSig, read };
                setStreamState(_faStreamCache);
            };
            const ric = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback : null;
            const handle = ric ? ric(run, { timeout: 1200 }) : setTimeout(run, 50);
            return () => { cancelled = true; if (ric && window.cancelIdleCallback) window.cancelIdleCallback(handle); else clearTimeout(handle); };
        }, [streamWanted, streamSig, !!streamLock]);
        const streamRead = !isPro || skinFeatures.showStreaming === false ? { ok: false, reason: 'off', rows: [], week: streamWeek }
            : streamBestBall ? { ok: false, reason: 'best_ball', rows: [], week: streamWeek }
            : streamEliminated ? { ok: false, reason: 'chopped', rows: [], week: streamWeek }
            : !streamWanted ? { ok: false, reason: 'off', rows: [], week: streamWeek }
            : (streamState.sig === streamSig && streamState.read) ? streamState.read
            : { ok: false, reason: 'pending', rows: [], week: streamWeek };
        // Positions with a this-week upgrade (the gold dot on the POS chips).
        const streaming = (streamRead.rows || []).filter(r => r.weekGain >= 1 && !r.locked);
        // ── 2-week trend (real weekly points) ────────────────────────────────
        // The last two COMPLETED weeks' Sleeper stat lines, league-scored. Reads
        // App.SOS.getWeekStats (already cached by the SOS / DHQ projection
        // boot); at most one fetch per week per session. Current season only.
        const trendSeason = String(currentLeague?.season || window.S?.season || '');
        const trendLive = !window.S?.nflState?.season || String(window.S.nflState.season) === trendSeason;
        const trendWeeks = (() => {
            const W = faWT(), WP = window.App && window.App.WeeklyProj;
            return trendLive && W && WP && WP.currentWeek ? W.completedWeeks(WP.currentWeek(), 2) : [];
        })();
        const trendKey = trendWeeks.join(',');
        const [, setTrendTick] = useState(0);
        useEffect(() => {
            const W = faWT();
            if (!isPro || !W || !trendSeason || !trendKey) return undefined;
            let alive = true;
            W.loadWeeks(trendSeason, trendKey.split(',').map(Number))
                .then(changed => { if (alive && changed) setTrendTick(t => t + 1); })
                .catch(() => {});
            return () => { alive = false; };
        }, [isPro, trendSeason, trendKey]);
        const trendScoringKey = useMemo(() => JSON.stringify(currentLeague?.scoring_settings || {}), [currentLeague]);
        const trendFor = (pid) => {
            const W = faWT();
            if (!W || !trendKey) return [];
            try { return W.trendFor(pid, { season: trendSeason, weeks: trendWeeks, scoring: currentLeague?.scoring_settings || {}, scoringKey: trendScoringKey, playersData }); }
            catch (e) { return []; }
        };
        const streamPosSet = new Set(streaming.map(o => o.pos));

        // GM-Office FA filters scope the recommendation surfaces (priority adds +
        // action board). The market explorer (sortedPlayers) keeps the full pool.
        const [gmFilterTick, setGmFilterTick] = useState(0);
        useEffect(() => {
            const h = () => setGmFilterTick(t => t + 1);
            window.addEventListener('wr:gm-mode-changed', h);
            return () => window.removeEventListener('wr:gm-mode-changed', h);
        }, []);
        const gmFa = useMemo(() => getGmFaFilters(currentLeague), [currentLeague, gmFilterTick]);
        // Resolved GM Strategy effects — drives the rebuild/contend posture and
        // market-posture ordering below (live-updates via gmFilterTick).
        const gmEff = useMemo(() => window.WR?.GmMode?.effects?.(currentLeague?.league_id || currentLeague?.id) || {}, [currentLeague, gmFilterTick]);
        const gmPool = useMemo(() => applyGmFaFilters(availablePlayers, gmFa), [availablePlayers, gmFa]);
        // Role check (C2 port): a backup / unknown-role QB stays in the market
        // but is not a recommendation in one-season formats (dynasty keeps him
        // as a stash — fitRead labels him so).
        const recPool = useMemo(() => gmPool.filter(x => faRoleRead(x.p, currentLeague, resolvedLeagueSkin).eligible), [gmPool, currentLeague, resolvedLeagueSkin]);
        const gmHiddenCount = Math.max(0, availablePlayers.length - gmPool.length);
        const gmFiltersOn = gmFaFiltersActive(gmFa);

        const posColors = window.App.POS_COLORS;
        const faPosOrder = { QB:0, RB:1, WR:2, TE:3, K:4, DEF:5, DL:6, LB:7, DB:8 };

        // League-specific position chips (only groups this league rosters),
        // plus league-derived flex groups (FLEX / SFLEX / IDP FLEX…, owner ask
        // 2026-07-12) — the filter predicate below expands them via
        // posMatchesFilter.
        const leaguePositions = useMemo(() => {
            const lp = leaguePlayablePositions(currentLeague?.roster_positions);
            const base = lp.length ? lp : ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
            return [...base, ...(window.App?.getLeagueFlexGroups?.({ league: currentLeague }) || [])];
        }, [currentLeague]);
        // Rookies filter — UDFAs fold into the FA pool post-draft; this isolates them.
        const [rookieOnly, setRookieOnly] = useState(false);
        // name → prospect record, so rookie rows can filter on the same pieces as the
        // Draft Room big board (NFL team, college, draft slot). getProspects() is
        // rank-sorted, so first-in wins on alias collisions (best-ranked prospect).
        const rookieProspectMap = useMemo(() => {
            if (typeof window.getProspects !== 'function') return new Map();
            const m = new Map();
            (window.getProspects() || []).forEach(p => {
                const k = faNormName(p.name);
                if (k && !m.has(k)) m.set(k, p);
            });
            return m;
        }, [timeRecomputeTs]);
        const prospectFor = useCallback((p) => {
            if (!p) return null;
            const nm = faNormName(p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim());
            const pr = rookieProspectMap.get(nm) || null;
            // Position-guard the name join (mirrors RookieFields.lookup posGuard in
            // My Roster / Trade Center) so a same-name veteran at a different position
            // isn't mis-tagged as the rookie.
            if (pr && p.position && (pr.mappedPos || pr.pos)) {
                const a = normPos(p.position);
                const b = normPos(pr.mappedPos || pr.pos);
                if (a && b && a !== b) return null;
            }
            return pr;
        }, [rookieProspectMap]);
        const isRookiePlayer = useCallback((pid, p) => {
            if (!p) return false;
            if (prospectFor(p)) return true;
            const exp = Number(p.years_exp ?? p.yoe ?? 0);
            const hasStats = (statsData?.[pid]?.gp || 0) > 0 || ((prevStatsData || {})[pid]?.gp || 0) > 0;
            return exp === 0 && !hasStats;
        }, [prospectFor, statsData, prevStatsData]);
        // Big-board filter pieces, scoped to the rookie/UDFA view.
        const [rookieTeamFilter, setRookieTeamFilter] = useState('');       // NFL team abbr
        const [rookieCollegeFilter, setRookieCollegeFilter] = useState(''); // college team
        const [rookieSlotFilter, setRookieSlotFilter] = useState('');       // '' | '1'..'7' | 'UDFA'
        const rookieTeamOf = useCallback((x) => (prospectFor(x.p)?.nflTeam || x.p.team || ''), [prospectFor]);
        const rookieCollegeOf = useCallback((x) => (prospectFor(x.p)?.college || x.p.college || ''), [prospectFor]);
        // Slot semantics mirror the big board's isTrueUdfa: these players are already
        // in the FA pool post-draft, so "no capital" means undrafted, not capital-TBD.
        const rookieSlotMatch = useCallback((x, slot) => {
            const cs = prospectFor(x.p) || {};
            const hasCapital = Number(cs.draftRound) > 0 || Number(cs.draftPick) > 0;
            if (slot === 'UDFA') return !hasCapital;
            return String(cs.draftRound || '') === slot;
        }, [prospectFor]);
        const rookieFilterOptions = useMemo(() => {
            if (!rookieOnly) return { teams: [], colleges: [] };
            const teams = new Set(); const colleges = new Set();
            availablePlayers.forEach(x => {
                if (!isRookiePlayer(x.pid, x.p)) return;
                const t = rookieTeamOf(x); if (t && t !== 'FA') teams.add(t);
                const c = rookieCollegeOf(x); if (c) colleges.add(c);
            });
            return { teams: [...teams].sort(), colleges: [...colleges].sort() };
        }, [rookieOnly, availablePlayers, isRookiePlayer, rookieTeamOf, rookieCollegeOf]);

        function faSortIndicator(key) { return faSort.key === key ? (faSort.dir === -1 ? ' \u25BC' : ' \u25B2') : ''; }
        function handleFaSort(key) { setFaSort(prev => prev.key === key ? { ...prev, dir: prev.dir * -1 } : { key, dir: -1 }); }

        // Sort filtered results
        const sortedPlayers = useMemo(() => {
            const q = faSearch.trim().toLowerCase();
            const filtered = availablePlayers.filter(x => {
                const pos = normPos(x.p.position) || x.p.position || '';
                // Group-aware: faFilter may be a flex-group key (FLEX/SFLEX/…)
                if (faFilter && !(window.App?.posMatchesFilter ? window.App.posMatchesFilter(pos, faFilter) : pos === faFilter)) return false;
                if (rookieOnly) {
                    if (!isRookiePlayer(x.pid, x.p)) return false;
                    if (rookieTeamFilter && rookieTeamOf(x) !== rookieTeamFilter) return false;
                    if (rookieCollegeFilter && rookieCollegeOf(x) !== rookieCollegeFilter) return false;
                    if (rookieSlotFilter && !rookieSlotMatch(x, rookieSlotFilter)) return false;
                }
                if (!faAdvPass(x)) return false;
                if (!q) return true;
                const name = (x.p.full_name || ((x.p.first_name || '') + ' ' + (x.p.last_name || '')).trim()).toLowerCase();
                const team = (x.p.team || 'FA').toLowerCase();
                const college = (x.p.college || '').toLowerCase();
                return name.includes(q) || team.includes(q) || pos.toLowerCase().includes(q) || college.includes(q);
            });
            return filtered.sort((a, b) => {
                const dir = faSort.dir;
                const k = faSort.key;
                if (k === 'name') {
                    const na = (a.p.full_name || ((a.p.first_name || '') + ' ' + (a.p.last_name || '')).trim()).toLowerCase();
                    const nb = (b.p.full_name || ((b.p.first_name || '') + ' ' + (b.p.last_name || '')).trim()).toLowerCase();
                    return dir * na.localeCompare(nb);
                }
                if (k === 'pos') return dir * ((normPos(a.p.position) || '').localeCompare(normPos(b.p.position) || ''));
                if (k === 'age') return dir * ((a.p.age || 0) - (b.p.age || 0));
                if (k === 'dhq') return dir * (a.dhq - b.dhq);
                if (k === 'proj') return dir * ((a.proj || 0) - (b.proj || 0));
                if (k === 'ppg') {
                    const sa = statsData[a.pid] || {}; const sb = statsData[b.pid] || {};
                    const pa = sa.gp > 0 ? calcRawPts(sa) / sa.gp : 0;
                    const pb = sb.gp > 0 ? calcRawPts(sb) / sb.gp : 0;
                    return dir * (pa - pb);
                }
                if (k === 'team') return dir * ((a.p.team || '').localeCompare(b.p.team || ''));
                if (k === 'trend') {
                    const ta = window.App?.LI?.playerTrends?.[a.pid] || 0;
                    const tb = window.App?.LI?.playerTrends?.[b.pid] || 0;
                    return dir * (ta - tb);
                }
                if (k === 'peak') {
                    const pa2 = window.App?.LI?.playerPeaks?.[a.pid] || 0;
                    const pb2 = window.App?.LI?.playerPeaks?.[b.pid] || 0;
                    return dir * (pa2 - pb2);
                }
                if (k === 'exp') return dir * ((a.p.years_exp || 0) - (b.p.years_exp || 0));
                if (k === 'injury') return dir * ((a.p.injury_status || '').localeCompare(b.p.injury_status || ''));
                if (k === 'sig1' || k === 'sig2') {
                    // Missing ('—') always sorts last, whichever direction.
                    const idx = k === 'sig1' ? 0 : 1;
                    const na = faSigRead(a.pos, idx, a.pid)?.value, nb = faSigRead(b.pos, idx, b.pid)?.value;
                    if (na == null && nb == null) return b.dhq - a.dhq;
                    if (na == null) return 1;
                    if (nb == null) return -1;
                    return dir * (na - nb);
                }
                if (k === 'rkSlot' || k === 'rkRank' || k === 'rkTier' || k === 'rkTeam') {
                    const ra = prospectFor(a.p); const rb = prospectFor(b.p);
                    if (k === 'rkTeam') return dir * ((ra?.nflTeam || faDraftCap(a.pid)?.team || '').localeCompare(rb?.nflTeam || faDraftCap(b.pid)?.team || ''));
                    if (k === 'rkSlot') {
                        // Earlier capital sorts first (unified ordinal ≈ overall pick);
                        // UDFA last; players with no data after that.
                        const slot = (r, pid) => {
                            if (r && Number(r.draftRound) > 0) return (Number(r.draftRound) - 1) * 32 + (Number(r.draftPick) || 32);
                            const d = faDraftCap(pid);
                            if (d) return d.round > 0 ? (d.overall || (d.round - 1) * 32 + 32) : 9000;
                            return r ? 9000 : 1e9;
                        };
                        return dir * (slot(ra, a.pid) - slot(rb, b.pid));
                    }
                    // rkRank / rkTier — lower consensus rank is better; non-rookies last.
                    const rank = r => (r && (r.consensusRank ?? r.rank) != null) ? Number(r.consensusRank ?? r.rank) : 1e9;
                    return dir * (rank(ra) - rank(rb));
                }
                return 0;
            }).slice(0, 50);
        }, [availablePlayers, faFilter, faSearch, faSort, statsData, prevStatsData, faAdv, faPtsYearActive, rookieOnly, isRookiePlayer, rookieTeamFilter, rookieCollegeFilter, rookieSlotFilter, rookieTeamOf, rookieCollegeOf, rookieSlotMatch, prospectFor]);

        const faHeaderStyle = { fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };

        // Compute roster needs for recommendations
        const assess = useMemo(() => typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null, [myRoster]);
        const peaks = window.App.peakWindows || {};
        const ageCurveFor = pos => typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(pos)
            : { build: [22, 24], peak: peaks[pos] || [24, 29], decline: [30, 32] };
        const peakYearsFor = (pos, age) => {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.peak[1] - (age || 25));
        };
        const valueYearsFor = (pos, age) => {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.decline[1] - (age || 25));
        };
        const budget = currentLeague?.settings?.waiver_budget || myRoster?.settings?.waiver_budget || 0;
        const spent = myRoster?.settings?.waiver_budget_used || 0;
        const remaining = Math.max(0, budget - spent);
        // Bid UI only where the league actually bids (waiver_type 2 on
        // Sleeper); rolling / reverse-standings waivers get a plain note.
        const hasFAAB = faIsFaabLeague(currentLeague);
        const rosterPositions = currentLeague?.roster_positions || [];
        const teamTier = assess?.tier || '';
        const teamWindow = assess?.window || '';
        // GM Strategy outranks the roster grade (assessment = fallback); the
        // rebuild age gate follows the GM timeline. Mirrors buildFreeAgencyActionBoard.
        const isRebuilding = gmEff.hasStrategy ? gmEff.mode === 'rebuild' : (teamTier === 'REBUILDING' || teamWindow === 'REBUILDING');
        const faAgeGate = gmEff.hasStrategy ? ({ '1_year': 29, '2_3_years': 27, 'dynasty_long': 25 }[gmEff.timeline] || 25) : 25;

        // The league's bid history feeds every estimate on this tab (see the
        // faModelBid note). Fetch it once per league (6h cache) and recompute
        // when it lands — FAAB Command used to be the only fetcher, so a tab
        // with no priority adds showed league-median numbers forever.
        const [faTxnsTick, setFaTxnsTick] = useState(0);
        const faBidLeagueId = String(currentLeague?.league_id || currentLeague?.id || '');
        useEffect(() => {
            const h = (e) => { if (!e?.detail?.leagueId || e.detail.leagueId === faBidLeagueId) setFaTxnsTick(t => t + 1); };
            window.addEventListener('wr:fa-txns-updated', h);
            return () => window.removeEventListener('wr:fa-txns-updated', h);
        }, [faBidLeagueId]);
        useEffect(() => {
            if (!isPro || !hasFAAB) return;
            faEnsureBidHistory(currentLeague);
        }, [faBidLeagueId, isPro, hasFAAB]);

        // DHQ bid ESTIMATE — the league bid model, the same number FAAB
        // Command prints (faModelBid → App.Faab.estimate). It is our estimate,
        // not a market price: `estimate: true` rides the payload and every
        // surface labels it "est."; the league's real winning bids are shown
        // separately as history (FAAB Command, App.WaiverTools.bidEvidence).
        function faabSuggest(dhq, pos, playerAge, pid) {
            if (!isPro) return null; // FAAB bid recommendations are Pro
            if (!hasFAAB || !faBidsHere(currentLeague) || dhq <= 0) return null;
            if (dhq < 500) return null; // replacement level — nothing to bid on
            if (isRebuilding && (playerAge || 30) > faAgeGate && dhq < 2000) return null; // rebuilders skip old low-value
            if (remaining <= 0) return null; // FAAB exhausted — no legal bid left to suggest
            return faModelBid({ league: currentLeague, myRoster, playersData, pid, pos, skin: resolvedLeagueSkin });
        }

        // Top recommendations at weak positions — with quality + mode filtering
        const recommendations = useMemo(() => {
            if (!isPro) return []; // priority-add recs are Pro
            if (!rosterState.isUsable) return [];
            if (!assess?.needs?.length) return [];
            const needPositions = assess.needs.slice(0, 3).map(n => n.pos);

            // ── Dynamic DHQ floor: scales down if wire is thin ──
            // Hard floor is 500, but if the best available at needed positions is below that,
            // drop to 25% of the best available DHQ so we always show something.
            const bestAvailDhq = recPool
                .filter(x => needPositions.includes(x.pos))
                .reduce((m, x) => Math.max(m, x.dhq), 0);
            const dynamicFloor = Math.min(500, Math.max(100, Math.round(bestAvailDhq * 0.25)));

            // ── Minimum quality threshold: dynamic DHQ floor ──
            // ── Rebuild mode: age ≤ 25 unless DHQ > 2000 (genuinely good player) ──
            return recPool
                .filter(x => {
                    if (!needPositions.includes(x.pos)) return false;
                    // A backup never "fills" a starting need (role check).
                    if (faRoleRead(x.p, currentLeague, resolvedLeagueSkin).backup) return false;
                    // THE TRUTH GATE. We only tell an owner to go get a player
                    // when the platform itself says he is playing. Two reads,
                    // both straight from Sleeper, neither of them ours:
                    //   • a published weekly projection — Sleeper declining to
                    //     publish one means he is not in a role worth projecting
                    //   • a depth chart slot — no slot, no NFL job
                    // Without these the board recommended a back who had one
                    // career appearance, priced him at $11-21, and ranked him
                    // first. He is still findable in Market Explorer; he just
                    // cannot be a recommendation.
                    if (!x.projected) return false;
                    if (x.depthSlot == null) return false;
                    if (x.dhq < dynamicFloor) return false;
                    if (isRebuilding && (x.p.age || 30) > faAgeGate && x.dhq < 2000) return false; // Rebuilders skip old low-value
                    return true;
                })
                .slice(0, 8)
                .map(x => {
                    const st = statsData[x.pid] || {};
                    const ppg = st.gp > 0 ? +(calcRawPts(st) / st.gp).toFixed(1) : 0;
                    // PPG quality check: skip if PPG < 5 with enough games
                    if (ppg > 0 && ppg < 5.0 && (st.gp || 0) >= 6) return null;
                    const need = assess.needs.find(n => n.pos === x.pos);
	                    const peakYrs = peakYearsFor(x.pos, x.p.age);
	                    const valueYrs = valueYearsFor(x.pos, x.p.age);
	                    const faab = faabSuggest(x.dhq, x.pos, x.p.age, x.pid);
	                    return { ...x, ppg, need, peakYrs, valueYrs, faab };
                })
                .filter(Boolean);
        }, [isPro, rosterState.isUsable, recPool, assess, statsData, gmEff, faTxnsTick]);

        // Selected player detail
        const selPlayer = faSelectedPid ? playersData[faSelectedPid] : null;
        const selStats = faSelectedPid ? statsData[faSelectedPid] || {} : {};
        const selDhq = faSelectedPid ? (window.App?.PlayerValue?.getValue ? window.App.PlayerValue.getValue(faSelectedPid, { skin: resolvedLeagueSkin }) : (window.App?.LI?.playerScores?.[faSelectedPid] || 0)) : 0;
        // This season only — see seasonPpgFor. Last season is not this season.
        const selPpg = selStats.gp > 0 ? +(calcRawPts(selStats) / selStats.gp).toFixed(1) : null;
        const selPos = selPlayer ? normPos(selPlayer.position) : '';
        const selPeakYrs = selPlayer ? peakYearsFor(selPos, selPlayer.age) : 0;
        const selValueYrs = selPlayer ? valueYearsFor(selPos, selPlayer.age) : 0;
        const selFaab = faSelectedPid ? faabSuggest(selDhq, selPos, selPlayer?.age, faSelectedPid) : null;
        // Evidence from whatever this league's bid history cache already holds
        // (FAAB Command fills it) — never a fetch from the drawer.
        const selBidLeagueId = currentLeague?.league_id || currentLeague?.id;
        const selBidEvidence = useMemo(() => {
            if (!selFaab || !hasFAAB || faPlatformNow !== 'sleeper' || !window.App?.WaiverTools?.bidEvidence || !window.WrTxns?.getCached) return null;
            return window.App.WaiverTools.bidEvidence(window.WrTxns.getCached(selBidLeagueId), currentLeague, selPos, playersData);
            // Memoized on league / position / the FAAB Command fetch counter:
            // getCached parses the whole season's transactions from storage.
        }, [selBidLeagueId, selPos, !!selFaab, hasFAAB, faPlatformNow, faTxnsTick]);
        const selInitials = selPlayer ? ((selPlayer.first_name||'?')[0] + (selPlayer.last_name||'?')[0]).toUpperCase() : '';

        function openFaPlayer(pid) {
            if (window.WR && typeof window.WR.openPlayerCard === 'function') {
                window.WR.openPlayerCard(pid, { scoringSettings: currentLeague?.scoring_settings });
            } else if (typeof window.openFWPlayerModal === 'function') {
                window.openFWPlayerModal(pid, playersData, statsData, currentLeague?.scoring_settings);
            } else {
                setFaSelectedPid(pid);
            }
        }

        function playerName(p, pid) {
            if (!p) return pid ? 'Player ' + pid : 'Unknown';
            const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
            if (full) return full;
            // Team defenses carry a team abbr but often no full/first/last name in the feed.
            const pos = (window.App?.normPos?.(p.position) || p.position || '').toUpperCase();
            if ((pos === 'DEF' || pos === 'DST') && (p.team || pid)) return (p.team || pid) + ' D/ST';
            return pid ? 'Player ' + pid : 'Unknown';
        }

        // See the note on the sibling in buildFreeAgencyActionBoard: this season
        // only, null when he has not played, never last season wearing this
        // season's label.
        function seasonPpgFor(pid) {
            const st = statsData[pid] || {};
            if (!(st.gp > 0)) return null;
            return +(calcRawPts(st) / st.gp).toFixed(1);
        }
        function seasonGamesFor(pid) {
            return Number((statsData[pid] || {}).gp) || 0;
        }

        function windowRead(pos, age) {
            const peakYrs = peakYearsFor(pos, age);
            const valueYrs = valueYearsFor(pos, age);
            if (peakYrs >= 4) return { label: peakYrs + 'yr peak', short: 'Rising', color: 'var(--k-2ecc71, #2ecc71)', peakYrs, valueYrs };
            if (peakYrs >= 1) return { label: peakYrs + 'yr peak', short: 'Prime', color: 'var(--gold)', peakYrs, valueYrs };
            if (valueYrs >= 1) return { label: valueYrs + 'yr value', short: 'Vet', color: 'var(--k-f0a500, #f0a500)', peakYrs, valueYrs };
            return { label: 'short term', short: 'Post', color: 'var(--k-e74c3c, #e74c3c)', peakYrs, valueYrs };
        }

        function fitRead(pos, player) {
            if (player && faRoleRead(player, currentLeague, resolvedLeagueSkin).backup) return FA_BACKUP_FIT;
            const need = assess?.needs?.find(n => n.pos === pos);
            if (need?.urgency === 'deficit') return { label: 'Fills deficit', short: 'Deficit', score: 4, color: 'var(--k-2ecc71, #2ecc71)', need };
            if (need) return { label: 'Fills thin room', short: 'Thin', score: 3, color: 'var(--k-2ecc71, #2ecc71)', need };
            if (assess?.strengths?.includes(pos)) return { label: 'Surplus stash', short: 'Stash', score: 1, color: 'var(--silver)', need: null };
            return { label: 'Depth add', short: 'Depth', score: 2, color: 'var(--silver)', need: null };
        }

        function gradeLabel(g) {
            if (g === 'A') return { label: 'Strong', bg: 'rgba(46,204,113,0.12)' };
            if (g === 'B') return { label: 'OK', bg: 'var(--ov-4, rgba(255,255,255,0.06))' };
            if (g === 'C') return { label: 'Thin', bg: 'rgba(240,165,0,0.10)' };
            if (g === 'D') return { label: 'Weak', bg: 'rgba(240,165,0,0.10)' };
            return { label: 'Deficit', bg: 'rgba(231,76,60,0.10)' };
        }

        function rosterNeedsPosition(roster, pos) {
            const reqCount = rosterPositions.filter(s =>
                normPos(s) === pos ||
                (s === 'FLEX' && ['RB','WR','TE'].includes(pos)) ||
                (s === 'SUPER_FLEX' && ['QB','RB','WR','TE'].includes(pos))
            ).length;
            const minimum = Math.max(1, reqCount);
            const count = (roster?.players || []).filter(pid => normPos(playersData[pid]?.position) === pos).length;
            return count < minimum;
        }

        function decorateFaCandidate(x) {
            const pos = x.pos || normPos(x.p?.position) || x.p?.position || '';
            const ppg = x.ppg != null ? x.ppg : seasonPpgFor(x.pid);
            const win = windowRead(pos, x.p?.age);
            const fit = fitRead(pos, x.p);
            const faab = x.faab || faabSuggest(x.dhq, pos, x.p?.age, x.pid);
            const formatReasons = leagueProfile && typeof window.App?.Intelligence?.buildPlayerFormatReasons === 'function'
                ? window.App.Intelligence.buildPlayerFormatReasons({ player: x.p, pos, profile: leagueProfile }).slice(0, 2)
                : [];
            const playerContext = typeof window.App?.Intelligence?.buildPlayerContext === 'function'
                ? window.App.Intelligence.buildPlayerContext({
                    id: 'waiver_context_' + x.pid,
                    pid: x.pid,
                    player: x.p,
                    pos,
                    profile: leagueProfile,
                    dhq: x.dhq,
                    ppg,
                    peakYrs: win.peakYrs,
                    valueYrs: win.valueYrs,
                    fit,
                    formatReasons,
                })
                : null;
            const posName = window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
            // urgency vocabulary is 'deficit' | 'thin' (team-assess) — 'thin' needs the noun phrase.
            const whyBase = fit.backup
                ? 'Backup quarterback — a stash for if he wins the job, not a lineup upgrade today.'
                : fit.need
                ? (fit.need.urgency === 'thin'
                    ? 'Shores up your thin ' + posName + ' room and keeps the bid in a controlled range.'
                    : 'Addresses your ' + posName + ' deficit and keeps the bid in a controlled range.')
                : win.peakYrs > 0
                    ? (skinFeatures.showDynastyValue === false ? 'Adds usable production runway without forcing a major FAAB commitment.' : 'Adds usable dynasty runway without forcing a major FAAB commitment.')
                    : 'Short-window depth. Treat as a tactical add, not a core asset.';
            const why = whyBase;
            const intelligence = typeof window.App?.Intelligence?.buildWaiverRecommendation === 'function'
                ? window.App.Intelligence.buildWaiverRecommendation({
                    id: 'waiver_' + x.pid,
                    pid: x.pid,
                    player: x.p,
                    pos,
                    profile: leagueProfile,
                    dhq: x.dhq,
                    ppg,
                    fit,
                    faab,
                    formatReasons,
                    playerContext,
                    detail: why,
                    windowDetail: whyBase,
                    badge: fit.short,
                })
                : null;
            // name: was missing here — unlike the buildFreeAgencyActionBoard
            // sibling — and FAAB Command's target-picker buttons read x.name
            // directly (lab fix 02a4369: they rendered blank without it).
            return { ...x, name: playerName(x.p, x.pid), pos, ppg, faab, fit, fitScore: fit.score, peakYrs: win.peakYrs, valueYrs: win.valueYrs, windowLabel: win.label, windowShort: win.short, windowColor: win.color, formatReasons, playerContext, intelligence, why };
        }

        const faabMarketRows = (currentLeague.rosters || []).map(r => {
            const user = (currentLeague.users || []).find(u => u.user_id === r.owner_id);
            const rBudget = Number(currentLeague?.settings?.waiver_budget || 0);
            const rSpent = Number(r.settings?.waiver_budget_used || 0);
            const rRemaining = Math.max(0, rBudget - rSpent);
            return {
                roster: r,
                rosterId: r.roster_id,
                name: user?.display_name || user?.username || ('Team ' + r.roster_id),
                remaining: rRemaining,
                pct: rBudget > 0 ? Math.round((rRemaining / rBudget) * 100) : 0,
                isMe: r.roster_id === myRoster?.roster_id,
            };
        }).sort((a, b) => b.remaining - a.remaining);
        const myFaabRank = faabMarketRows.findIndex(r => r.isMe) + 1;
        const canOutbidRows = faabMarketRows.filter(r => !r.isMe && r.remaining > remaining).slice(0, 5);

        const posGrades = window.App?.calcPosGrades?.(myRoster?.roster_id, currentLeague?.rosters, playersData) || [];
        const posGradeMap = {};
        posGrades.forEach(g => posGradeMap[g.pos] = g);
        const rosterGapRows = ['QB','RB','WR','TE','K','DEF','DL','LB','DB']
            .filter(pos => (assess?.posAssessment || {})[pos])
            .map(pos => {
                const data = assess.posAssessment[pos] || {};
                const pg = posGradeMap[pos] || { grade: 'C', col: 'var(--k-f0a500, #f0a500)', rank: 0, totalTeams: 0 };
                const gl = gradeLabel(pg.grade);
                const bestWire = recPool.find(x => x.pos === pos);
                return { pos, data, grade: pg.grade, label: gl.label, color: pg.col, bg: gl.bg, rank: pg.rank, totalTeams: pg.totalTeams, bestWire };
            })
            .sort((a, b) => {
                const order = { F: 0, D: 1, C: 2, B: 3, A: 4 };
                return (order[a.grade] ?? 2) - (order[b.grade] ?? 2) || (faPosOrder[a.pos] ?? 9) - (faPosOrder[b.pos] ?? 9);
            });

        // Free skips the rec pipeline entirely: nothing to render (Action HQ is
        // gated below) and nothing published to the shared Intelligence stream.
        // Market posture biases ordering — mirrors buildFreeAgencyActionBoard.
        const postureBias = (x) => {
            if (!gmEff.hasStrategy) return 0;
            const trend = Number(window.App?.LI?.playerMeta?.[x.pid]?.trend) || 0;
            if (gmEff.marketPosture === 'buy_low') return (trend < 0 && x.dhq >= 2000) ? 1500 : 0;
            if (gmEff.marketPosture === 'sell_high' || gmEff.marketPosture === 'hold') return x.dhq < 1500 ? -1200 : 0;
            return 0;
        };
        // The ranked waiver board obeys the same truth gate as the priority
        // adds: Sleeper has to be projecting him and he has to hold a depth
        // chart slot. A ranked list IS a recommendation.
        const actionBoardPlayers = !isPro ? [] : recPool
            .filter(x => x.projected && x.depthSlot != null)
            .map(decorateFaCandidate)
            .sort((a, b) => (b.fitScore * 5000 + b.dhq + (b.ppg || 0) * 35 + postureBias(b)) - (a.fitScore * 5000 + a.dhq + (a.ppg || 0) * 35 + postureBias(a)));
        // Same ordering as the action board behind the Flash Brief
        // (faRankPriorityAdds), so the hero here and the brief's waiver target
        // are one player. GM Strategy target positions float first — the board
        // already did that; this tab didn't (review B1).
        const priorityAdds = faRankPriorityAdds((recommendations.length ? recommendations : actionBoardPlayers).map(decorateFaCandidate), {
            gmTargets: gmEff.targetPositions instanceof Set ? gmEff.targetPositions : new Set(),
            postureBias,
        });
        if (isPro && typeof window.App?.Intelligence?.publishRecommendations === 'function') {
            window.App.Intelligence.publishRecommendations('waiver', priorityAdds.map(x => x.intelligence).filter(Boolean), { surface: 'free-agency' });
        }
        const dropCandidates = (myRoster?.players || [])
            .filter(pid => !(myRoster?.starters || []).includes(pid))
            .map(pid => {
                const p = playersData[pid];
                if (!p) return null;
                const pos = normPos(p.position) || p.position;
                const dhq = window.App?.LI?.playerScores?.[pid] || 0;
                const win = windowRead(pos, p.age);
                return { pid, p, pos, dhq, name: playerName(p), windowLabel: win.label, windowColor: win.color };
            })
            .filter(Boolean)
            .sort((a, b) => a.dhq - b.dhq)
            .slice(0, 6);
        const usedUpgradeAdds = new Set();
        const upgradePairs = dropCandidates.map(drop => {
            const add = actionBoardPlayers.find(x =>
                !usedUpgradeAdds.has(x.pid) &&
                x.dhq > drop.dhq + 400 &&
                (x.pos === drop.pos || x.fitScore >= 3)
            );
            if (!add) return null;
            usedUpgradeAdds.add(add.pid);
            return { drop, add, gain: add.dhq - drop.dhq };
        }).filter(Boolean).slice(0, 4);
        const recentDrops = (() => {
            const out = [];
            const transactions = window.S?.transactions || {};
            const curWeek = window.S?.currentWeek || 1;
            for (let w = curWeek; w >= Math.max(1, curWeek - 2); w--) {
                (transactions['w' + w] || []).forEach(t => {
                    if (t.type !== 'free_agent' && t.type !== 'waiver') return;
                    Object.keys(t.drops || {}).forEach(pid => {
                        const p = playersData[pid];
                        const dhq = window.App?.LI?.playerScores?.[pid] || 0;
                        if (!p || dhq < 1500 || rostered.has(String(pid))) return;
                        out.push({ pid, name: playerName(p), pos: normPos(p.position) || p.position, dhq, week: w });
                    });
                });
            }
            return out.sort((a, b) => b.dhq - a.dhq).slice(0, 4);
        })();
        // Transaction Ticker (owner ask 2026-08-28): a direct lift of the
        // home-tab widget — the rows render through the shared
        // window.WrTxnTickerList (js/widgets/txn-ticker.js), fed by the same
        // per-week transaction buckets. The home-tab ticker stays as-is.
        const tickerTxns = (() => {
            const txnMap = window.S?.transactions || {};
            const out = [];
            Object.values(txnMap).forEach(wk => (wk || []).forEach(t => {
                if (!t || !t.type || t.status === 'failed' || t._fromDHQ) return;
                out.push(t);
            }));
            return out.sort((a, b) => (b.status_updated || b.created || 0) - (a.status_updated || a.created || 0)).slice(0, 8);
        })();
        const tickerOwnerName = (rid) => {
            const r = (currentLeague.rosters || []).find(x => x.roster_id === rid);
            const u = r ? (currentLeague.users || []).find(x => x.user_id === r.owner_id) : null;
            return u?.display_name || u?.username || ('Team ' + rid);
        };
        const tickerPlayerName = (pid) => {
            const p = playersData[pid];
            return p ? playerName(p, pid) : 'Player #' + pid;
        };
        const positionThreats = Array.from(new Set([...(assess?.needs || []).map(n => n.pos), ...actionBoardPlayers.slice(0, 6).map(x => x.pos)]))
            .slice(0, 6)
            .map(pos => {
                const top = faabMarketRows.find(r => !r.isMe && rosterNeedsPosition(r.roster, pos));
                return { pos, top };
            })
            .filter(x => x.top);

        function renderCandidateRow(x, i, isPrimary) {
            const dhqCol = x.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : x.dhq >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.45))';
            return (
                <button key={x.pid} className={'fa-hq-candidate' + (isPrimary ? ' is-primary' : '')} title="Open player card" onClick={() => openFaPlayer(x.pid)}>
                    <span className="fa-hq-rank">{i + 1}</span>
                    <span className="fa-hq-player-main">
                        <strong>{playerName(x.p)}</strong>
                        <em>{x.p.team || 'FA'} · {x.pos} · {x.windowLabel}</em>
                        <FaTrendSpark trend={trendFor(x.pid)} />
                    </span>
                    <span className="fa-hq-player-fit" style={{ color: x.fit.color }}>{x.fit.short}</span>
                    <span className="fa-hq-player-value">
                        <strong style={{ color: dhqCol }}>{x.dhq ? x.dhq.toLocaleString() : '—'}</strong>
                        <em title={faEstTitle(x.faab)}>{x.faab ? 'est ' + faEstText(x.faab, null, true) : hasFAAB ? 'No bid' : '—'}</em>
                    </span>
                    <span className="fa-hq-why">{x.why}</span>
                </button>
            );
        }

        // Where FAAB Command would sit, in leagues where it cannot: rolling /
        // reverse-standings waivers (no bids), or ESPN / MFL / Yahoo leagues
        // whose FAAB budget and completed bids we don't import. Honest line,
        // no bid UI, no transaction fetches.
        function renderBidNote() {
            if (hasFAAB && faPlatformNow === 'sleeper') return null;
            const plat = FA_PLATFORM_NAME[faPlatformNow] || faPlatformNow;
            let text;
            if (faPlatformNow !== 'sleeper') {
                text = 'Dynasty HQ doesn\u2019t import FAAB budgets or completed bids from ' + plat + ' leagues yet, so no bid history or bid estimate is shown here. Claims still run on ' + plat + '.';
            } else if (Number(currentLeague?.settings?.waiver_type) === 1) {
                text = 'This league uses reverse-standings waivers — claims go by waiver order, not bids.';
            } else {
                text = 'This league uses rolling waivers — claims go by waiver priority, not bids.';
            }
            return <div className="fa-bid-note">{text}</div>;
        }

        // ── Streaming & season upgrades card (C2 renderWeeklyStreams port) ──
        function renderWeeklyStreams() {
            const r = streamRead;
            if (!r || r.reason === 'off' || r.reason === 'engine') return null;
            const WP = window.App && window.App.WeeklyProj;
            const src = (WP && WP.platformSource && WP.platformSource(r.week) && FA_PLATFORM_NAME[WP.platformSource(r.week)]) || 'Sleeper';
            const plat = FA_PLATFORM_NAME[faPlatformNow] || faPlatformNow;
            const noWeek = !!(r.weekOver || r.weekUnknown);
            const horizon = noWeek ? 'season' : (r.rosOn ? streamHorizon : 'week');
            const signed = n => (Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(1) : '—');
            const head = (
                <div className="fa-streams-head">
                    <h3>Streaming &amp; season upgrades</h3>
                    <span>Week {r.week} · {src} projections</span>
                </div>
            );
            if (r.reason === 'best_ball') {
                return (
                    <section className="fa-streams" aria-label="Streaming and season upgrades">
                        {head}
                        <p className="fa-streams-note">Best ball sets your lineup for you every week, so there's no streaming call to make here. Adds still count toward your best lineup — the Market Explorer ranks everyone available.</p>
                    </section>
                );
            }
            const notes = [];
            if (r.reason === 'pending') notes.push('Checking this week\u2019s lineup upgrades and game times…');
            else if (r.reason === 'chopped') notes.push('Your team has been chopped, so there is no lineup left to improve.');
            else if (!r.ok && r.reason === 'overage') notes.push('Your roster is over its limit — clear a spot on ' + plat + ' first. Upgrades are measured on a legal roster.');
            else if (!r.ok) notes.push('This league\u2019s lineup slots aren\u2019t available, so lineup upgrades can\u2019t be measured.');
            else if (r.reason === 'no_lines' || !r.lines) notes.push(src + ' hasn\u2019t published Week ' + r.week + ' projections yet. Upgrades appear once it does — we don\u2019t guess, and last week\u2019s lines don\u2019t stand in.');
            else {
                if (r.weekOver) notes.push('Every Week ' + r.week + ' game is final — this week\u2019s lineup is settled.' + (r.rosOn ? ' Rest-of-season upgrades are below.' : ' Next week\u2019s upgrades appear once ' + src + ' publishes Week ' + (r.week + 1) + ' projections.'));
                else if (r.weekUnknown) notes.push('Game times couldn\u2019t be loaded and Week ' + r.week + ' games may be under way, so this week\u2019s upgrades are hidden rather than guessed.' + (r.rosOn ? ' Rest-of-season upgrades are below — some of these players may be locked until their game ends.' : ''));
                else if (r.lock && r.lock.started) notes.push('Games already under way are locked: those players can\u2019t be added or dropped, and a locked starter keeps his slot. This week\u2019s gains count only the slots still open.');
                if (!r.rows.length) notes.push(horizon === 'season'
                    ? 'No available player improves your best rest-of-season lineup by a point or more. Holding is a valid move.'
                    : 'No available player improves your best projected lineup for the rest of this week by a point or more. Holding is a valid move.');
            }
            const rows = r.ok ? r.rows : [];
            const shown = streamShowAll ? rows : rows.slice(0, 3);
            const row = o => {
                const p = playersData[o.pid] || {};
                const name = playerName(p, o.pid);
                const drop = o.drop ? o.drop.name : null;
                return (
                    <button key={o.pid} type="button" className="fa-stream-row" title="Open player card" onClick={() => openFaPlayer(o.pid)}>
                        <span className="fa-stream-main">
                            <strong>{name}</strong>
                            <span>{window.App?.posLabel?.(o.pos) || o.pos} · {p.team || 'FA'}{p.injury_status ? ' · ' + p.injury_status : ''} <FaTrendSpark trend={trendFor(o.pid)} /></span>
                            <span className="fa-stream-swap">{drop ? 'Add ' + name + ', drop ' + drop : 'Add ' + name + ' · open roster spot'}</span>
                            {o.locked ? <span className="fa-stream-lock">His game has started — locked until it ends.</span> : null}
                        </span>
                        <span className="fa-stream-nums">
                            {noWeek ? null : <span><b>{o.addPts != null && !o.locked ? o.addPts.toFixed(1) : '—'}</b>Wk {r.week} proj</span>}
                            {noWeek ? null : <span><b className={o.weekGain > 0 ? 'is-gain' : o.weekGain < 0 ? 'is-loss' : ''}>{signed(o.weekGain)}</b>This week</span>}
                            {r.rosOn ? <span><b className={o.rosGain > 0 ? 'is-gain' : o.rosGain < 0 ? 'is-loss' : ''}>{signed(o.rosGain)}</b>Rest of season</span> : null}
                        </span>
                    </button>
                );
            };
            return (
                <section className="fa-streams" aria-label="Streaming and season upgrades">
                    {head}
                    {r.rosOn && !noWeek && r.ok ? (
                        <div className="fa-streams-toggle" role="group" aria-label="Improve my lineup for">
                            <button type="button" className={horizon === 'week' ? 'is-active' : ''} aria-pressed={horizon === 'week'} onClick={() => setStreamHorizon('week')}>This week</button>
                            <button type="button" className={horizon === 'season' ? 'is-active' : ''} aria-pressed={horizon === 'season'} onClick={() => setStreamHorizon('season')}>Rest of season</button>
                        </div>
                    ) : null}
                    {notes.map((n, i) => <p key={i} className="fa-streams-note">{n}</p>)}
                    {shown.map(row)}
                    {rows.length > 3 ? (
                        <button type="button" className="fa-streams-more" onClick={() => setStreamShowAll(v => !v)}>
                            {streamShowAll ? 'Show fewer' : 'See ' + (rows.length - 3) + ' more upgrade' + (rows.length - 3 === 1 ? '' : 's')}
                        </button>
                    ) : null}
                    {rows.length ? (
                        <p className="fa-streams-foot">
                            Projections are {src}'s published Week {r.week} lines in your league's scoring. Each gain compares your best projected lineup before and after that one move — a projection, not a promise.
                            {r.rosOn ? ' Rest of season = this week\u2019s line × the weeks left' + (faLeagueTypeNow === 'chopped' ? ' you\u2019re expected to survive' : '') + ' — an estimate.' : ''}
                            {r.lock && r.lock.known ? ' Game locks come from the NFL schedule (kickoff times); confirm on ' + plat + ' before you submit.' : ' Confirm locks and submit on ' + plat + '.'}
                        </p>
                    ) : null}
                </section>
            );
        }

        function renderActionHQ(compact = false) {
            const topAdds = priorityAdds.slice(0, compact ? 4 : 5);
            const boardRows = actionBoardPlayers.slice(0, compact ? 6 : 8);
            const swapRows = upgradePairs.slice(0, compact ? 3 : 4);
            const freshRows = recentDrops.slice(0, compact ? 2 : 3);
            const faabColor = remaining > budget * 0.5 ? 'var(--k-2ecc71, #2ecc71)' : remaining > budget * 0.25 ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
            return (
                <section className={'fa-hq-shell' + (compact ? ' is-compact' : '')}>
                    <div className="fa-hq-grid">
                        <aside className="fa-hq-panel">
                            <div className="fa-hq-panel-head">
                                <span>Priority Moves</span>
                                <em>{topAdds.length} add targets · {swapRows.length} swaps</em>
                            </div>
                            {/* FAAB Command — league-aware bid plan for the top targets
                                (deterministic; the league's own bid history is the model). */}
                            {isPro && topAdds.length > 0 && hasFAAB && faPlatformNow === 'sleeper' && (
                                <FaabCommandCard league={currentLeague} myRoster={myRoster} playersData={playersData} skin={resolvedLeagueSkin}
                                    targets={topAdds.slice(0, 3).map(x => ({ pid: x.pid, name: x.name, pos: x.pos, dhq: x.dhq }))} />
                            )}
                            {isPro ? renderBidNote() : null}
                            {/* Add targets | swaps ride side by side when the panel is
                                wide (owner ask 2026-07-12 — stacked full-width cards
                                left half the panel empty); auto-stacks below ~640px. */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '4px 16px', alignItems: 'start' }}>
                            <div>
                            <div className="fa-hq-subhead" style={{ marginTop: 0 }}>Add Targets</div>
                            <div className="fa-hq-stack">
                                {topAdds.length ? topAdds.map((x, i) => (
                                    <button key={x.pid} className="fa-hq-mini-card" title="Open player card" onClick={() => openFaPlayer(x.pid)}>
                                        <strong>{playerName(x.p)} <span style={{ color: posColors[x.pos] || 'var(--silver)' }}>{x.pos}</span></strong>
                                        <em>{x.fit.label} · {x.dhq.toLocaleString()} {valueShortLabel}{x.faab ? ' · est ' + faEstText(x.faab) : ''}</em>
                                    </button>
                                )) : <div className="fa-hq-empty">No priority adds match your current roster needs.</div>}
                            </div>
                            {gmFiltersOn && (() => {
                                const parts = [];
                                if (gmFa.minDhq) parts.push('min ' + gmFa.minDhq.toLocaleString() + ' ' + valueShortLabel);
                                if (gmFa.maxAge) parts.push('≤' + gmFa.maxAge + ' yrs');
                                if (gmFa.requirePrimeYears) parts.push('prime years only');
                                if (gmFa.excludePositions.length) parts.push('no ' + gmFa.excludePositions.join('/'));
                                return (
                                    <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', lineHeight: 1.5 }}>
                                        <strong style={{ color: 'var(--gold)' }}>GM filters</strong>: {parts.join(' · ')}{gmHiddenCount > 0 ? ' · ' + gmHiddenCount + ' hidden' : ''} · edit in GM's Office
                                    </div>
                                );
                            })()}
                            </div>

                            <div>
                            <div className="fa-hq-subhead" style={{ marginTop: 0 }}>Best Add/Drop Upgrades</div>
                            <div className="fa-hq-stack">
                                {swapRows.length ? swapRows.map(pair => (
                                    <button key={pair.drop.pid + '-' + pair.add.pid} className="fa-hq-swap" title="Open player card" onClick={() => openFaPlayer(pair.add.pid)}>
                                        <span><b>Drop</b>{pair.drop.name}<em>{pair.drop.dhq.toLocaleString()}</em></span>
                                        <span><b>Add</b>{playerName(pair.add.p)}<em>+{pair.gain.toLocaleString()}</em></span>
                                    </button>
                                )) : <div className="fa-hq-empty">No obvious add/drop upgrade found from the current wire.</div>}
                            </div>
                            </div>
                            </div>

                            <div className="fa-hq-subhead">Fresh Drop Alerts</div>
                            <div className="fa-hq-stack">
                                {freshRows.length ? freshRows.map(d => (
                                    <button key={d.pid} className="fa-hq-mini-card is-alert" title="Open player card" onClick={() => openFaPlayer(d.pid)}>
                                        <strong>{d.name} <span>{d.pos}</span></strong>
                                        <em>Dropped W{d.week} · {d.dhq.toLocaleString()} {valueShortLabel}</em>
                                    </button>
                                )) : <div className="fa-hq-empty">No startable recent drops are sitting on the wire.</div>}
                            </div>
                        </aside>

                        <main className="fa-hq-panel fa-hq-board">
                            <div className="fa-hq-panel-head">
                                <span>Ranked Waiver Board</span>
                                <em>bid range, fit, window, and reason</em>
                            </div>
                            <div className="fa-hq-board-list">
                                {boardRows.map((x, i) => renderCandidateRow(x, i, i === 0))}
                            </div>
                        </main>

                        {/* Right column: Market Leverage and the Transaction Ticker are
                            two separate boxes (owner ruling 2026-08-28). The wrapper stays
                            an <aside> so the ≤1280px full-width rule still targets it. */}
                        <aside style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
                        <div className="fa-hq-panel">
                            <div className="fa-hq-panel-head">
                                <span>Market Leverage</span>
                                <em>{!hasFAAB ? 'No FAAB in this league' : canOutbidRows.length ? canOutbidRows.length + ' teams can outbid you' : 'You control most bids'}</em>
                            </div>
                            {/* Consolidated to ~half height (owner ask 2026-07-12): one-line FAAB
                                card, competitors as a chip line, Position Threats merged into the
                                gap matrix (both keyed by position). */}
                            {hasFAAB && <div className="fa-hq-faab-card">
                                <strong style={{ color: faabColor }}>${remaining}</strong>
                                <span> of ${budget} · #{myFaabRank || '—'} FAAB</span>
                                <i style={{ width: budget > 0 ? Math.max(3, Math.round((remaining / budget) * 100)) + '%' : '0%', background: faabColor }} />
                            </div>}
                            {/* Rival budgets only mean something where the league bids
                                (Sleeper keeps a $100 budget on rolling-waiver leagues too). */}
                            {hasFAAB ? (
                                <div className="fa-hq-chipline">
                                    {(canOutbidRows.length ? canOutbidRows : faabMarketRows.filter(r => !r.isMe).slice(0, 4)).map(r => (
                                        <span key={r.rosterId}>{r.name} ${r.remaining}</span>
                                    ))}
                                </div>
                            ) : null}

                            <div className="fa-hq-subhead">Roster Gap Matrix</div>
                            <div className="fa-hq-gap-matrix">
                                {rosterGapRows.map(row => {
                                    const threat = positionThreats.find(t => t.pos === row.pos)?.top || null;
                                    return (
                                        <div key={row.pos} style={{ background: row.bg }}>
                                            <span style={{ color: posColors[row.pos] || row.color }}>{window.App?.posLabel?.(row.pos) || (row.pos === 'DEF' ? 'D/ST' : row.pos)}</span>
                                            <strong className="fa-gap-badge" style={{ color: row.color, borderColor: row.color }} title={row.label}>{row.grade}</strong>
                                            <em>{row.data.nflStarters || Math.min(row.data.actual || 0, row.data.minQuality || row.data.startingReq || 0)}/{row.data.minQuality || row.data.startingReq || 0}</em>
                                            <i>{row.bestWire ? playerName(row.bestWire.p) : '—'}</i>
                                            {threat && hasFAAB ? <b title={threat.name + ' also needs ' + row.pos + ' — $' + threat.remaining + ' FAAB left'}>${threat.remaining}</b> : null}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {tickerTxns.length && typeof window.WrTxnTickerList === 'function' ? (
                            <div className="fa-hq-panel">
                                <div className="fa-hq-panel-head">
                                    <span>Transaction Ticker</span>
                                    <em>latest adds and drops</em>
                                </div>
                                {React.createElement(window.WrTxnTickerList, {
                                    transactions: tickerTxns.slice(0, compact ? 3 : 5),
                                    getOwnerName: tickerOwnerName,
                                    getPlayerName: tickerPlayerName,
                                })}
                            </div>
                        ) : null}
                        </aside>
                    </div>
                </section>
            );
        }

        function renderRosterSyncBlocker() {
            const isPreDraft = !!rosterState.isPreDraftRosterEmpty;
            return (
                <div className="fa-page wr-fade-in">
                    {window.App?.renderRosterDataBlocker?.(rosterState, {
                        title: isPreDraft ? null : 'Free Agency paused',
                        message: isPreDraft ? rosterState.message : 'Waiver rankings are hidden until roster IDs finish loading.',
                        detail: rosterState.detail,
                        actionLabel: isPreDraft ? null : 'Refresh Data',
                        style: { minHeight: '220px' },
                    })}
                </div>
            );
        }

        if (!rosterState.isUsable) return renderRosterSyncBlocker();

        // ── UDFA CRAZE PANEL ──────────────────────────────────────────────────
        function fmtCountdown(end) {
            const ms = Number(end) - Date.now();
            if (!Number.isFinite(ms) || ms <= 0) return 'closing';
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            if (h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
            return h + 'h ' + m + 'm';
        }
        function renderCrazePanel() {
            if (!crazeOpen) return null;
            if (!isPro) {
                const GatedRow = window.WrGatedMoreRow;
                return GatedRow ? (
                    <div style={{ margin: '0 0 14px' }}>
                        <GatedRow title="UDFA Craze is live" sub="The ranked post-draft UDFA board — roster fit, tiers, and league-calibrated FAAB — is Pro. The rookies themselves are in the Market Explorer below (Rookies filter)." feature="faab_intelligence" />
                    </div>
                ) : null;
            }
            if (!crazeBoard) return null;
            const groups = crazeBoard.groups || [];
            const total = crazeBoard.total || 0;
            if (!total) return null;
            const headline = (window.AlexVoice ? window.AlexVoice.pick('udfa:craze:' + crazeLeagueId, [
                "Rookie draft's done — the UDFA wire just opened. Dive into a group to work it.",
                "The craze is live. Here's the undrafted-rookie market by position — drill in to bid.",
                "This is the scramble. Scan the groups, then dive into the pool to claim.",
            ]) : 'The UDFA craze is live.');
            const drill = (pos) => {
                setRookieOnly(true);
                setFaFilter(pos || '');
                try { document.querySelector('.fa-market-shell')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
            };
            const posName = pos => window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
            return (
                <section style={{ margin: '0 0 14px', borderRadius: 'var(--card-radius-lg, 14px)', overflow: 'hidden', border: '1px solid var(--acc-line4, rgba(212,175,55,0.55))', background: 'linear-gradient(135deg, rgba(212,175,55,0.10), transparent 70%)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                        <span style={{ fontFamily: "var(--font-display, Rajdhani, sans-serif)", fontWeight: 800, letterSpacing: '0.08em', color: 'var(--gold)', fontSize: '0.95rem' }}>⚡ UDFA CRAZE — LIVE</span>
                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)' }}>Waivers process in <strong style={{ color: 'var(--white)' }}>{fmtCountdown(crazeState.windowEnd)}</strong> · <strong style={{ color: 'var(--white)' }}>{total}</strong> available across {groups.length} group{groups.length === 1 ? '' : 's'}</span>
                        <span style={{ flex: 1 }} />
                        <button type="button" title="Dismiss the craze panel" onClick={() => { try { window.App?.PostDraft?.closeCraze?.(crazeLeagueId); setCrazeTick(t => t + 1); } catch (e) {} }}
                            style={{ background: 'transparent', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
                    </div>
                    <div style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: '0.84rem', color: 'var(--white)', marginBottom: '12px', lineHeight: 1.5 }}>{headline}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px' }}>
                            {groups.map(g => (
                                <button key={g.pos} type="button" onClick={() => drill(g.pos)} title={'View all ' + g.count + ' ' + posName(g.pos) + ' UDFAs'}
                                    style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--ov-2, rgba(255,255,255,0.03))', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', cursor: 'pointer' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                                        <span style={{ fontFamily: "var(--font-display, Rajdhani, sans-serif)", fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.04em', fontSize: '0.9rem' }}>{posName(g.pos)}</span>
                                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)' }}>{g.count} avail</span>
                                    </div>
                                    {g.top && (
                                        <div style={{ marginTop: '5px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', lineHeight: 1.4 }}>
                                            Top: <span style={{ color: 'var(--white)', fontWeight: 700 }}>{g.top.name}</span>{g.top.nflTeam ? ' · ' + g.top.nflTeam : ''} · {Number(g.top.dhq || 0).toLocaleString()}
                                        </div>
                                    )}
                                    <div style={{ marginTop: '6px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontWeight: 700 }}>View all {g.count} →</div>
                                </button>
                            ))}
                        </div>
                        <button type="button" onClick={() => drill('')} style={{ marginTop: '12px', padding: '7px 12px', borderRadius: 'var(--card-radius-sm, 8px)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', fontFamily: "var(--font-ui, 'DM Sans', sans-serif)", fontWeight: 800, fontSize: 'var(--text-micro, 0.6875rem)', cursor: 'pointer' }}>
                            See all {total} UDFAs in the pool →
                        </button>
                    </div>
                </section>
            );
        }

        // ── COMMAND VIEW: shared Action HQ, without the deep market table ──
        if (viewMode === 'command') {
            if (!canAccess('fa-decision-engine')) {
                return React.createElement(UpgradeGate, {
                    feature: 'fa-decision-engine',
                    title: 'UNLOCK WAIVER INTELLIGENCE',
                    description: 'Get FAAB bid recommendations with confidence levels, tiered targets ranked by roster impact, and market pressure analysis. Know exactly who to bid on and how much.',
                    targetTier: 'warroom'
                });
            }
            return (
                <div className="fa-page wr-fade-in">
                    <style>{FA_WAIVER_CSS}</style>
                    {renderCrazePanel()}
                    {renderActionHQ(true)}
                    {renderWeeklyStreams()}
                </div>
            );
        }

        // Free teaser standing in for the Action HQ rec suite (analyst view).
        function renderActionHqTeaser() {
            const GatedRow = window.WrGatedMoreRow;
            if (!GatedRow) return null;
            return (
                <div style={{ margin: '0 0 14px' }}>
                    <GatedRow title="Waiver Action HQ" sub="Priority adds, FAAB bid ranges, add/drop upgrades, and the ranked waiver board are Pro. The full Market Explorer below stays free." feature="faab_intelligence" />
                </div>
            );
        }

        // ══ PHONE (<768) EARLY RETURN — iPhone program Phase 1 (FA) ═══════
        // Everything below this block (the analyst-view return, the market
        // table with its click-path contract literals, and the fixed right
        // .fa-detail-drawer) renders ONLY off-phone — desktop/tablet output
        // stays byte-identical. Slot values call the SAME sources as the
        // desktop renderCell (faabSuggest / fitRead / computeRollingPPG /
        // RookieFields.fields) — lookups reused, no formulas duplicated.
        // Row tap routes to the standard player card via openFaPlayer (the
        // same path the HQ cards use); the drawer never opens on phone.
        if (_faPhone) {
            // Render-time tier filter — the SAME boundary as the desktop
            // market table below: a Pro column can never ride a free slot.
            const shownFaCols = faTierCols(visibleFaCols);
            // Preset → "which 3 stat slots ride the card row" (P1 AssetRow);
            // keyed off faActivePresetKey (derived from the PERSISTED columns,
            // not session faColPreset) so the slots track the saved view across
            // reloads (owner ask 2026-07-12). Named views map to a DISTINCT trio;
            // 'full' is deliberately ABSENT — full/custom ride the first 3
            // slot-capable picks of the actual columns ("full = your columns").
            // PEAK left the default path; the this-week projection replaced it.
            const FA_PHONE_SLOT_PRESETS = {
                default: ['dhq', 'ppg', 'proj'],   // value · production · this-week projection
                usage:   ['sig1', 'sig2', 'ppg'],   // per-game usage (this season) · production
                scout:   ['age', 'height', 'weight'],
                bidding: ['dhq', 'faab', 'proj'],  // value · bid · this-week projection
                rookie:  ['rkSlot', 'rkRank', 'rkTier'],
            };
            const FA_PHONE_SLOT_KEYS = new Set(['age', 'dhq', 'ppg', 'proj', 'peakYr', 'yrsExp', 'height', 'weight', 'depthChart', 'injury', 'faab', 'sig1', 'sig2', 'rkSlot', 'rkTeam', 'rkRank', 'rkTier']);
            let _faSlotKeys = FA_PHONE_SLOT_PRESETS[faActivePresetKey]
                || shownFaCols.filter(k => FA_PHONE_SLOT_KEYS.has(k)).slice(0, 3);
            _faSlotKeys = faTierCols(_faSlotKeys);
            if (!_faSlotKeys.length) _faSlotKeys = faTierCols(FA_PHONE_SLOT_PRESETS.default);

            // Fixed min widths per slot so the stat columns line up row to
            // row (phone fit pass 2026-09-26) — PPG's width fits the thin-
            // sample "2G PPG" label so it can't shift the row next to it.
            const _FA_SLOT_W = { dhq: '46px', ppg: '42px', proj: '34px', faab: '46px', sig1: '44px', sig2: '44px' };
            const _faSlotFor = (k, x) => {
                const s = _faSlotForRaw(k, x);
                if (s && !s.w) s.w = _FA_SLOT_W[k] || '34px';
                return s;
            };
            // Injury status → Sleeper's short tag (Q / D / OUT / IR…) for the
            // row's tag line, so it can't push team · age off the card.
            const _faInjShort = (st) => {
                const k = String(st || '').trim().toLowerCase();
                const map = { questionable: 'Q', doubtful: 'D', out: 'OUT', probable: 'P', suspended: 'SUS', sus: 'SUS', 'injured reserve': 'IR', ir: 'IR', pup: 'PUP', na: 'NA', cov: 'COV' };
                return map[k] || String(st || '').slice(0, 4);
            };
            // Slot renderer — same data reads as the desktop renderCell.
            const _faSlotForRaw = (k, x) => {
                const p = x.p;
                const short = ((faColumns[k] && faColumns[k].shortLabel) || k).toUpperCase();
                switch (k) {
                    case 'dhq': return { label: valueShortLabel, value: x.dhq > 0 ? x.dhq.toLocaleString() : '—', strong: true };
                    case 'faab': {
                        // EST, not BID: the model's estimate, not a price.
                        const f = faabSuggest(x.dhq, x.pos, p.age, x.pid);
                        return { label: 'EST', value: f ? faEstText(f, '-', true) : '—', tone: f ? 'gold' : 'mute' };
                    }
                    case 'sig1': case 'sig2': {
                        const read = faSigRead(x.pos, k === 'sig1' ? 0 : 1, x.pid);
                        return { label: (read && read.short) || short, value: (read && read.text) || '—', tone: read && read.value != null ? undefined : 'mute' };
                    }
                    case 'ppg': {
                        // Same rolling-window override + seasonal fallback as
                        // renderCell; the window rides the LABEL (L5/L3).
                        let shown = seasonPpgFor(x.pid);
                        const games = seasonGamesFor(x.pid);
                        // Thin sample rides the label, so "11.4 PPG" can never
                        // pass for a season when it came from one afternoon.
                        let lbl = (shown != null && games > 0 && games < 3) ? games + 'g PPG' : 'PPG';
                        if (ppgWindow !== 'season') {
                            const n = ppgWindow === 'l3' ? 3 : 5;
                            const rolling = typeof window.App?.computeRollingPPG === 'function' ? window.App.computeRollingPPG(x.pid, n) : 0;
                            if (rolling > 0) { shown = rolling; lbl = 'L' + n; } else { lbl = 'SZN'; }
                        }
                        return { label: lbl, value: shown > 0 ? shown : '—' };
                    }
                    // Sleeper's number, with DHQ's beside it (owner ruling 2026-09-23: side by side).
                    // Phone fit pass 2026-09-26: the one-line "18.1 · DHQ 16.9"
                    // read as a run-on with PPG — now two stacked numbers under
                    // one WK label, Sleeper on top, DHQ below in DHQ gold.
                    case 'proj': {
                        const slp = x.proj > 0 ? x.proj.toFixed(1) : '—';
                        if (!(window.App && window.App.DhqProj)) return { label: 'WK', value: slp };
                        return { label: 'WK', value: (
                            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.15 }}>
                                <span title="Sleeper projection">{slp}</span>
                                <span title="DHQ projection" style={{ color: 'var(--gold)', fontSize: '0.72rem', fontWeight: 600 }}>{window.App.DhqProj.fmt(x.pid)}</span>
                            </span>
                        ) };
                    }
                    case 'age': return { label: short, value: p.age || '—', tone: 'mute' };
                    case 'peakYr': {
                        const py = peakYearsFor(x.pos, p.age);
                        const vy = valueYearsFor(x.pos, p.age);
                        const lb = py >= 4 ? 'Rising' : py >= 1 ? 'Prime' : vy >= 1 ? 'Vet' : 'Post';
                        return { label: short, value: lb, tone: py >= 1 ? 'gold' : 'mute' };
                    }
                    case 'yrsExp': return { label: short, value: p.years_exp != null ? p.years_exp : '—', tone: 'mute' };
                    case 'height': return { label: short, value: p.height ? Math.floor(p.height / 12) + "'" + (p.height % 12) + '"' : '—', tone: 'mute' };
                    case 'weight': return { label: short, value: p.weight || '—', tone: 'mute' };
                    case 'depthChart': return { label: short, value: p.depth_chart_order >= 1 ? x.pos + p.depth_chart_order : '—', tone: 'mute' };
                    case 'injury': return { label: short, value: p.injury_status || '—', tone: p.injury_status ? 'bad' : 'mute' };
                    case 'rkSlot': case 'rkTeam': case 'rkRank': case 'rkTier': {
                        const rf = window.App?.RookieFields?.fields?.(prospectFor(p)) || null;
                        if (k === 'rkSlot') {
                            const slotTxt = rf?.draftSlot || faDraftSlotTxt(x.pid);
                            return { label: short, value: slotTxt || '—', tone: slotTxt ? undefined : 'mute' };
                        }
                        if (k === 'rkTeam') {
                            const tm = rf?.nflTeam || faDraftCap(x.pid)?.team;
                            return { label: short, value: tm || '—', tone: 'mute' };
                        }
                        if (!rf) return { label: short, value: '—', tone: 'mute' };
                        if (k === 'rkRank') return { label: short, value: rf.consensusRank != null ? rf.consensusRank : '—' };
                        return { label: short, value: rf.tierLabel || '—' };
                    }
                    default: return { label: short, value: '—', tone: 'mute' };
                }
            };
            // ── P5 hero — the #1 priority add + bid + FAAB standing in one
            // read. Bid/why reads are Pro (priorityAdds is [] for free — the
            // exact existing boundary); free sees the top market name + raw
            // market context, both already free in the explorer below.
            const _heroPro = isPro && priorityAdds.length ? priorityAdds[0] : null;
            const _heroFree = availablePlayers.length ? availablePlayers[0] : null;
            let _faHeroEl = null;
            if (_heroPro) {
                const heroFaab = _heroPro.faab || null;
                const faabBits = hasFAAB ? ' · $' + remaining + ' of $' + budget + ' left · #' + (myFaabRank || '—') + ' FAAB' : '';
                _faHeroEl = React.createElement(window.WR.HeroCard, {
                    kicker: 'Top add',
                    // "EST. BID": the league bid model's range (the same number
                    // FAAB Command below prints), never a price; the league's
                    // real bid history is in FAAB Command.
                    headline: playerName(_heroPro.p, _heroPro.pid).toUpperCase() + (heroFaab ? ' — EST. BID ' + faEstText(heroFaab) : ''),
                    facts: _heroPro.why + faabBits,
                    cta: 'OPEN PLAYER CARD',
                    onCta: () => openFaPlayer(_heroPro.pid),
                });
            } else if (_heroFree) {
                _faHeroEl = React.createElement(window.WR.HeroCard, {
                    kicker: 'Top add',
                    headline: playerName(_heroFree.p, _heroFree.pid).toUpperCase(),
                    facts: (_heroFree.p.team || 'FA') + ' · ' + _heroFree.pos + ' · ' + (_heroFree.dhq > 0 ? _heroFree.dhq.toLocaleString() + ' ' + valueShortLabel : '—') + ' · ' + availablePlayers.length + ' on the wire',
                    ctaGhost: 'Open player card',
                    onCtaGhost: () => openFaPlayer(_heroFree.pid),
                });
            }

            // ── P3 pills + FilterSheet — re-homes the EXISTING toolbar
            // controls (search, pos chips, rookie drill-down, sort, view
            // presets, column picker trigger, PPG window, saved views);
            // every control drives the exact same state setters as the
            // desktop toolbar, which stays untouched for tablet/desktop.
            const _faTogglePanel = (k) => setFaPanel(p => p === k ? null : k);
            const _sortCol = faSort.key === 'name' ? { shortLabel: 'Player' } : Object.values(faColumns).find(c => c.sortKey === faSort.key);
            const _faPillsEl = (
                <div className="wr-hscroll" style={{ display: 'flex', gap: '6px', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
                    {React.createElement(window.WR.FilterPill, { label: 'Filters', value: (faFilter ? (window.App?.posLabel?.(faFilter) || faFilter) : 'All') + (rookieOnly ? ' +RK' : ''), onClick: () => _faTogglePanel('filters') })}
                    {React.createElement(window.WR.FilterPill, { label: 'Sort', value: ((_sortCol && _sortCol.shortLabel) || faSort.key) + (faSort.dir === -1 ? ' ↓' : ' ↑'), onClick: () => _faTogglePanel('sort') })}
                    {React.createElement(window.WR.FilterPill, { label: 'View', value: faActivePresetKey, onClick: () => _faTogglePanel('view') })}
                </div>
            );
            const _faSheetSelect = (active) => ({ width: '100%', minHeight: '44px', padding: '8px 10px', fontSize: '16px', fontFamily: 'var(--font-body)', background: 'var(--ov-3, rgba(255,255,255,0.04))', color: active ? 'var(--gold)' : 'var(--silver)', border: '1px solid ' + (active ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.1))'), borderRadius: 'var(--card-radius-sm, 8px)' });
            const _faChipBtn = (active) => ({ padding: '7px 12px', minHeight: '44px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: active ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'transparent', color: active ? 'var(--gold)' : 'var(--silver)', border: '1px solid ' + (active ? 'var(--acc-line2, rgba(212,175,55,0.35))' : 'var(--ov-6, rgba(255,255,255,0.1))'), borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', fontWeight: active ? 700 : 400 });
            // ── Inline Filters / Sort / View choosers (owner ask: same as the
            // Trade Center — each pill opens its own panel directly under the pill
            // row, no modal sheet). Panels bundle related controls and stay open
            // until you re-tap the pill or open another; the column customizer is
            // still a drill-down sheet (opened from the View panel).
            const _faPanelWrap = (body) => (
                <div style={{ background: 'var(--black, #121217)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: '9px' }}>{body}</div>
            );
            const _faPanelLbl = (t) => <div style={{ fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--silver)', opacity: 0.6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{t}</div>;
            let _faPanelEl = null;
            if (faPanel === 'filters') {
                _faPanelEl = _faPanelWrap(
                    <React.Fragment>
                        {_faPanelLbl('Search')}
                        <input value={faSearch} onChange={e => setFaSearch(e.target.value)} placeholder="Search player, team, college..." style={_faSheetSelect(!!faSearch)} />
                        {_faPanelLbl('Position')}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {['', ...leaguePositions].map(pos => (
                                <button key={pos || 'all'} onClick={() => setFaFilter(pos)} style={_faChipBtn(faFilter === pos)} title={pos && streamPosSet.has(pos) ? 'Streaming upgrade available at ' + pos + ' this week' : undefined}>
                                    {pos ? (window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)) : 'All'}
                                    {pos && streamPosSet.has(pos) ? <span style={{ color: 'var(--gold)', marginLeft: '3px', fontWeight: 800 }}>•</span> : null}
                                </button>
                            ))}
                        </div>
                        {_faPanelLbl('Type')}
                        <button onClick={() => { const next = !rookieOnly; setRookieOnly(next); if (!next) { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); } }} style={_faChipBtn(rookieOnly)} title="Show only rookies / UDFAs">Rookies / UDFAs</button>
                        {rookieOnly && (
                            <React.Fragment>
                                {_faPanelLbl('Rookie drill-down')}
                                <select value={rookieTeamFilter} onChange={e => setRookieTeamFilter(e.target.value)} style={_faSheetSelect(!!rookieTeamFilter)}>
                                    <option value="">All teams</option>
                                    {rookieFilterOptions.teams.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <select value={rookieCollegeFilter} onChange={e => setRookieCollegeFilter(e.target.value)} style={_faSheetSelect(!!rookieCollegeFilter)}>
                                    <option value="">All colleges</option>
                                    {rookieFilterOptions.colleges.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {[{ k: '', label: 'All' }, { k: '1', label: 'R1' }, { k: '2', label: 'R2' }, { k: '3', label: 'R3' }, { k: '4', label: 'R4' }, { k: '5', label: 'R5' }, { k: '6', label: 'R6' }, { k: '7', label: 'R7' }, { k: 'UDFA', label: 'UDFA' }].map(opt => (
                                        <button key={opt.k || 'all'} onClick={() => setRookieSlotFilter(rookieSlotFilter === opt.k ? '' : opt.k)} style={_faChipBtn(rookieSlotFilter === opt.k)} title={opt.k === 'UDFA' ? 'Undrafted free agents' : opt.k ? 'NFL draft round ' + opt.k : 'Any draft slot'}>{opt.label}</button>
                                    ))}
                                </div>
                            </React.Fragment>
                        )}
                        <button onClick={() => { setFaSearch(''); setFaFilter(''); setRookieOnly(false); setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); setVisibleFaCols(faTierCols(FA_COLUMN_PRESETS.default)); setFaColPreset('default'); setFaSort({ key: 'dhq', dir: -1 }); setPpgWindow('season'); }} style={{ ..._faChipBtn(false), marginTop: '2px' }}>Reset all</button>
                    </React.Fragment>
                );
            } else if (faPanel === 'sort') {
                _faPanelEl = _faPanelWrap(
                    <React.Fragment>
                        {_faPanelLbl('Sort by')}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <select value={faSort.key} onChange={e => { const k = e.target.value; setFaSort(prev => ({ key: k, dir: prev.key === k ? prev.dir : -1 })); }} style={{ ..._faSheetSelect(faSort.key !== 'dhq'), flex: 2, width: 'auto' }}>
                                <option value="name">Player</option>
                                {Object.entries(faColumns).filter(([, c]) => c.sortKey).map(([k, c]) => <option key={k} value={c.sortKey}>{c.shortLabel}</option>)}
                            </select>
                            <button onClick={() => setFaSort(prev => ({ ...prev, dir: prev.dir * -1 }))} style={{ ..._faChipBtn(true), flex: 1 }} title="Flip sort direction">{faSort.dir === -1 ? 'Desc ↓' : 'Asc ↑'}</button>
                        </div>
                        {_faPanelLbl('PPG window')}
                        <div style={{ display: 'flex', gap: '6px' }}>
                            {[{ k: 'season', l: 'Season' }, { k: 'l5', l: 'L5' }, { k: 'l3', l: 'L3' }].map(opt => (
                                <button key={opt.k} onClick={() => setPpgWindow(opt.k)} style={{ ..._faChipBtn(ppgWindow === opt.k), flex: 1 }} title={opt.k === 'season' ? 'Season-to-date PPG' : 'Last ' + (opt.k === 'l5' ? 5 : 3) + ' games'}>{opt.l}</button>
                            ))}
                        </div>
                    </React.Fragment>
                );
            } else if (faPanel === 'view') {
                _faPanelEl = _faPanelWrap(
                    <React.Fragment>
                        {_faPanelLbl('Preset')}
                        <select value={faActivePresetKey} onChange={e => { const key = e.target.value; const cols = FA_COLUMN_PRESETS[key]; if (!cols) return; setVisibleFaCols(faTierCols(cols)); setFaColPreset(key); setRookieOnly(key === 'rookie'); if (key !== 'rookie') { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); } }} style={_faSheetSelect(faActivePresetKey !== 'default')} title="Column preset">
                            {Object.keys(FA_COLUMN_PRESETS).map(k => <option key={k} value={k}>{k}</option>)}
                            {faActivePresetKey === 'custom' && <option value="custom">custom</option>}
                        </select>
                        {_faPanelLbl('Columns')}
                        <button onClick={() => { setShowFaColPicker(true); setFaPanel(null); }} style={{ ..._faChipBtn(showFaColPicker || faActivePresetKey === 'custom'), width: '100%' }} title="Add or remove market columns">Customize · {shownFaCols.length} fields active</button>
                        {window.WR?.SavedViews?.SavedViewBar ? (
                            <React.Fragment>
                                {_faPanelLbl('Saved views')}
                                {React.createElement(window.WR.SavedViews.SavedViewBar, {
                                    surface: 'free_agency',
                                    leagueId: currentLeague?.id || currentLeague?.league_id,
                                    currentState: { columns: visibleFaCols, sort: faSort, filters: { faFilter, faSearch } },
                                    onApply: (v) => {
                                        if (Array.isArray(v.columns) && v.columns.length) { setVisibleFaCols(faTierCols(v.columns.filter(k => FA_COLUMNS[k]))); setFaColPreset('custom'); }
                                        if (v.sort && v.sort.key) setFaSort({ key: v.sort.key, dir: v.sort.dir || 1 });
                                        if (v.filters && typeof v.filters.faFilter === 'string') setFaFilter(v.filters.faFilter);
                                        if (v.filters && typeof v.filters.faSearch === 'string') setFaSearch(v.filters.faSearch);
                                    },
                                })}
                            </React.Fragment>
                        ) : null}
                    </React.Fragment>
                );
            }
            // Column picker sheet — the phone home for the EXISTING
            // showFaColPicker state (the desktop inline panel lives in the
            // analyst return below and never renders on phone). The shared
            // P3 FilterSheet customizer treatment (same anatomy as My
            // Roster's): "Active (n)" 44px rows with ▲▼ move + × remove
            // (the same setVisibleFaCols/setFaColPreset('custom') swaps the
            // desktop ◀▶/× chips run — key-indexed so a free user's stored
            // Pro column can't skew the reorder), then "Available" add chips
            // grouped by the EXISTING col.group metadata, behind the same
            // isPro/FA_PRO_COLS option gate. Active rows map over
            // shownFaCols — the same render-time tier filter as the market
            // table, so a Pro column never renders for free.
            const _faColMove = (key, delta) => {
                setFaColPreset('custom');
                setVisibleFaCols(prev => {
                    const at = prev.indexOf(key);
                    const to = at + delta;
                    if (at < 0 || to < 0 || to >= prev.length) return prev;
                    const next = [...prev];
                    [next[to], next[at]] = [next[at], next[to]];
                    return next;
                });
            };
            const _faColRemove = (key) => { setFaColPreset('custom'); setVisibleFaCols(prev => prev.filter(c => c !== key)); };
            const _faColAdd = (key) => { setFaColPreset('custom'); setVisibleFaCols(prev => prev.includes(key) ? prev : [...prev, key]); };
            const _faColGroups = [];
            Object.entries(faColumns).filter(([key]) => isPro || !FA_PRO_COLS.has(key)).forEach(([key, col]) => {
                if (visibleFaCols.includes(key)) return;
                let g = _faColGroups.find(x => x.group === col.group);
                if (!g) { g = { group: col.group, cols: [] }; _faColGroups.push(g); }
                g.cols.push([key, col]);
            });
            const _faColSheetEl = React.createElement(window.WR.FilterSheet, {
                open: !!showFaColPicker,
                onClose: () => setShowFaColPicker(false),
                title: 'Market columns',
                sections: [
                    { label: 'Active (' + shownFaCols.length + ')', node: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, lineHeight: 1.5 }}>
                                The first three stat-capable picks ride each market card; the full set applies to the desktop table.
                            </div>
                            {shownFaCols.map((key, i) => {
                                const col = faColumns[key]; if (!col) return null;
                                return (
                                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) 44px 44px 44px', gap: '3px', alignItems: 'center', minHeight: '44px', padding: '0 2px 0 8px', borderRadius: 'var(--card-radius-sm, 8px)', background: 'var(--acc-fill2, rgba(212,175,55,0.075))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))' }}>
                                        <span style={{ color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'right' }}>{i + 1}</span>
                                        <span title={col.label} style={{ color: 'var(--white, #f5f5f5)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.shortLabel || col.label}</span>
                                        <button disabled={i === 0} onClick={() => _faColMove(key, -1)} title="Move up" style={{ minWidth: '44px', minHeight: '44px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: i === 0 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: i === 0 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: i === 0 ? 'default' : 'pointer' }}>{'▲'}</button>
                                        <button disabled={i === shownFaCols.length - 1} onClick={() => _faColMove(key, 1)} title="Move down" style={{ minWidth: '44px', minHeight: '44px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: i === shownFaCols.length - 1 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: i === shownFaCols.length - 1 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: i === shownFaCols.length - 1 ? 'default' : 'pointer' }}>{'▼'}</button>
                                        <button onClick={() => _faColRemove(key)} title="Remove" style={{ minWidth: '44px', minHeight: '44px', borderRadius: 'var(--card-radius-xs, 5px)', border: '1px solid rgba(231,76,60,0.22)', background: 'rgba(231,76,60,0.08)', color: 'var(--bad)', cursor: 'pointer' }}>{'×'}</button>
                                    </div>
                                );
                            })}
                            {!shownFaCols.length && (
                                <div style={{ padding: '12px', borderRadius: 'var(--card-radius-sm, 8px)', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>Only the player column is visible.</div>
                            )}
                        </div>
                    ) },
                    { label: 'Available', node: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {!_faColGroups.length && (
                                <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>All columns are active.</div>
                            )}
                            {_faColGroups.map(({ group, cols }) => (
                                <div key={group}>
                                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '6px' }}>{group}</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                        {cols.map(([key, col]) => (
                                            <button key={key} onClick={() => _faColAdd(key)} title={'Add ' + col.label} style={{ minHeight: '44px', padding: '7px 12px', fontSize: '0.74rem', fontFamily: 'var(--font-body)', background: 'var(--ov-1, rgba(255,255,255,0.018))', color: 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ {col.shortLabel || col.label}</button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) },
                ],
                footer: (
                    <React.Fragment>
                        <button onClick={() => { setFaColPreset('custom'); setVisibleFaCols(faTierCols(Object.keys(faColumns))); }} style={{ ..._faChipBtn(!_faColGroups.length), flex: 1 }}>All fields</button>
                        <button onClick={() => { setVisibleFaCols(faTierCols(FA_COLUMN_PRESETS.default)); setFaColPreset('default'); }} style={{ ..._faChipBtn(false), flex: 1 }}>Reset</button>
                        <button onClick={() => setShowFaColPicker(false)} style={{ ..._faChipBtn(true), flex: 1 }}>Done</button>
                    </React.Fragment>
                ),
            });

            // ── P1 card list — market rows + Pro streaming/drop groups.
            // Phone shows a tighter top slice (owner ask: fewer by default) —
            // desktop's sortedPlayers cap is untouched; sort/search/filters
            // surface anyone below the cut.
            const _faPhoneMkt = sortedPlayers.slice(0, 25);
            const _faMktRows = _faPhoneMkt.map(x => {
                const bits = [x.p.team || 'FA'];
                if (x.p.age) bits.push('Age ' + x.p.age);
                if (x.p.injury_status) bits.push(_faInjShort(x.p.injury_status));
                return React.createElement(window.WR.AssetRow, {
                    key: x.pid,
                    pos: x.pos,
                    name: playerName(x.p, x.pid),
                    tag: bits.join(' · '),
                    slots: _faSlotKeys.map(k => _faSlotFor(k, x)),
                    // Roster-fit verdict chip (Thin / Fills thin room / …) removed
                    // from phone FA rows, and the desktop Fit column + _faFitChip
                    // helper went with it (owner ask 2026-07-12) — the pos badge +
                    // stat slots carry the read; the roster-fit read still powers
                    // the drawer's Roster Fit panel and the rec surfaces.
                    accent: (_heroPro && _heroPro.pid === x.pid) ? 'gold' : undefined,
                    onClick: () => openFaPlayer(x.pid),
                    title: 'Open player card',
                });
            });
            const _faMktRowNodes = _faMktRows.length ? _faMktRows : [
                <div key="fa-mkt-empty" style={{ padding: '14px', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', borderRadius: 'var(--card-radius, 10px)', color: 'var(--silver)', opacity: 0.7, fontSize: '0.78rem' }}>No available players match this view.</div>
            ];
            const _faDropRows = isPro ? recentDrops.map(d => React.createElement(window.WR.AssetRow, {
                key: 'drop-' + d.pid,
                pos: d.pos,
                name: d.name,
                tag: 'Dropped W' + d.week + ' · back on the wire',
                slots: [{ label: 'VAL', value: d.dhq.toLocaleString() }],
                onClick: () => openFaPlayer(d.pid),
                title: 'Open player card',
            })) : [];
            const _faGroups = [];
            // The stacked WK slot (Sleeper over DHQ) is keyed once here rather
            // than on every row.
            const _faWkKey = _faSlotKeys.includes('proj') && window.App && window.App.DhqProj;
            _faGroups.push({ label: 'Market', sub: _faPhoneMkt.length + ' of ' + availablePlayers.length + (_faWkKey ? ' · wk sleeper/dhq' : ' shown'), rows: _faMktRowNodes });
            if (_faDropRows.length) _faGroups.push({ label: 'Drop alerts', sub: 'fresh drops worth a claim', rows: _faDropRows });

            return (
                <React.Fragment>
                    <style>{FA_WAIVER_CSS}</style>
                    <div className="fa-page wr-fade-in">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {_faHeroEl}
                            {/* FAAB Command on phone (owner ask 2026-08-16) — same
                                card, right under the hero; Pro-gated like desktop. */}
                            {isPro && priorityAdds.length > 0 && hasFAAB && faPlatformNow === 'sleeper' && (
                                <FaabCommandCard league={currentLeague} myRoster={myRoster} playersData={playersData} skin={resolvedLeagueSkin}
                                    targets={priorityAdds.slice(0, 3).map(x => ({ pid: x.pid, name: x.name, pos: x.pos, dhq: x.dhq }))} />
                            )}
                            {isPro ? renderBidNote() : null}
                            {!isPro && renderActionHqTeaser()}
                            {renderCrazePanel()}
                            {renderWeeklyStreams()}
                            {_faPillsEl}
                            {_faPanelEl}
                            {React.createElement(window.WR.CardList, { groups: _faGroups })}
                        </div>
                    </div>
                    {/* The column customizer stays a drill-down sheet, rendered
                        OUTSIDE .fa-page: its wr-fade-in leaves a lingering
                        transform:translateY(0), which would make this position:fixed
                        sheet resolve against .fa-page (down the page) instead of the
                        viewport. As a sibling it escapes the transformed ancestor and
                        overlays correctly. (Mirrors the .tc-trade-root transform:none
                        fix in index.html.) */}
                    {_faColSheetEl}
                </React.Fragment>
            );
        }

        // ── ANALYST VIEW: full market terminal ──
        return (
            <div className="fa-page wr-fade-in">

                {/* ── PHONE TIER (≤767) — iPhone plan Phase 2 item 14 (FA leftovers).
                    The market explorer already scrolls horizontally (overflowX +
                    minWidth); this pins the Player column while the 15+ data columns
                    scroll under it (D6 pattern 1, proven on My Roster). Class hooks
                    only — ≥768 is pixel-identical. Sticky cells need SOLID
                    backgrounds: hexes are the composites of the semi-transparent
                    gold tints over the --black (#121217) table card. */}
                <style>{`
                    @media (max-width: 767px) {
                        .fa-mkt-head > :nth-child(2), .fa-mkt-row > :nth-child(2) {
                            position: sticky; left: 0; z-index: 1;
                            background: var(--black, #121217);
                            box-shadow: 6px 0 8px -6px rgba(0,0,0,0.6);
                        }
                        .fa-mkt-head > :nth-child(2) { background: #1e1b19; }
                        .fa-mkt-row.is-sel > :nth-child(2) { background: #221f1a; }
                    }
                `}</style>

                <style>{FA_WAIVER_CSS}</style>
                {renderCrazePanel()}
                {isPro ? renderActionHQ(false) : renderActionHqTeaser()}
                {renderWeeklyStreams()}

                <section className="fa-market-shell">
                <div className="fa-market-head">
                    <div>
                        <span>Market Explorer</span>
                        <p>{sortedPlayers.length} shown from {availablePlayers.length} available players. Saved views and custom columns still apply.</p>
                    </div>
                    <div className="fa-market-search">
                        <input value={faSearch} onChange={e => setFaSearch(e.target.value)} placeholder="Search player, team, college..." />
                    </div>
                </div>

                <div className="fa-market-toolbar wr-module-toolbar">
                    <span className="wr-module-toolbar-label">POS</span>
                    <div className="wr-module-nav">
                    {['', ...leaguePositions].map(pos =>
                        <button key={pos} className={faFilter === pos ? 'is-active' : ''} onClick={() => setFaFilter(pos)} title={pos && streamPosSet.has(pos) ? 'Streaming upgrade available at ' + pos + ' this week' : undefined}>{pos ? (window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)) : 'All'}{pos && streamPosSet.has(pos) ? <span style={{ color: 'var(--gold)', marginLeft: '3px', fontWeight: 800 }}>•</span> : null}</button>
                    )}
                    </div>
                    <span className="wr-module-toolbar-label">Type</span>
                    <div className="wr-module-nav">
                    <button className={rookieOnly ? 'is-active' : ''} onClick={() => { const next = !rookieOnly; setRookieOnly(next); if (!next) { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); } }} title="Show only rookies / UDFAs">Rookies</button>
                    </div>
                </div>

                {/* Rookie/UDFA drill-down — same filter pieces as the Draft Room big board */}
                {rookieOnly && (() => {
                    const rkSelectStyle = (active) => ({ padding: '3px 6px', minHeight: '44px', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', background: 'var(--ov-3, rgba(255,255,255,0.04))', color: active ? 'var(--gold)' : 'var(--silver)', border: '1px solid ' + (active ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.1))'), borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer', outline: 'none', maxWidth: '170px' });
                    return (
                        <div className="fa-market-toolbar wr-module-toolbar">
                            <span className="wr-module-toolbar-label">Team</span>
                            <select value={rookieTeamFilter} onChange={e => setRookieTeamFilter(e.target.value)} style={rkSelectStyle(!!rookieTeamFilter)}>
                                <option value="">All teams</option>
                                {rookieFilterOptions.teams.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <span className="wr-module-toolbar-label">College</span>
                            <select value={rookieCollegeFilter} onChange={e => setRookieCollegeFilter(e.target.value)} style={rkSelectStyle(!!rookieCollegeFilter)}>
                                <option value="">All colleges</option>
                                {rookieFilterOptions.colleges.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <span className="wr-module-toolbar-label">Slot</span>
                            <div className="wr-module-nav">
                                {[{ k: '', label: 'All' }, { k: '1', label: 'R1' }, { k: '2', label: 'R2' }, { k: '3', label: 'R3' }, { k: '4', label: 'R4' }, { k: '5', label: 'R5' }, { k: '6', label: 'R6' }, { k: '7', label: 'R7' }, { k: 'UDFA', label: 'UDFA' }].map(opt => (
                                    <button key={opt.k || 'all'} className={rookieSlotFilter === opt.k ? 'is-active' : ''} onClick={() => setRookieSlotFilter(rookieSlotFilter === opt.k ? '' : opt.k)} title={opt.k === 'UDFA' ? 'Undrafted free agents' : opt.k ? 'NFL draft round ' + opt.k : 'Any draft slot'}>{opt.label}</button>
                                ))}
                            </div>
                            {(rookieTeamFilter || rookieCollegeFilter || rookieSlotFilter) && (
                                <button type="button" onClick={() => { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); }} style={{ marginLeft: 'auto', padding: '3px 10px', minHeight: '44px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius, 10px)', cursor: 'pointer' }}>Clear</button>
                            )}
                        </div>
                    );
                })()}

                {/* Phase 6 deferred: presets + column picker + SavedViewBar */}
                <div className="fa-market-toolbar wr-module-toolbar">
                    <span className="wr-module-toolbar-label">View</span>
                    <div className="wr-module-nav">
                    {Object.entries(FA_COLUMN_PRESETS).map(([key, cols]) => (
                        <button key={key} className={faActivePresetKey === key ? 'is-active' : ''} onClick={() => { setVisibleFaCols(faTierCols(cols)); setFaColPreset(key); setRookieOnly(key === 'rookie'); if (key !== 'rookie') { setRookieTeamFilter(''); setRookieCollegeFilter(''); setRookieSlotFilter(''); } }}>{key}</button>
                    ))}
                    <button className={showFaColPicker ? 'is-active' : ''} onClick={() => setShowFaColPicker(!showFaColPicker)}>Columns</button>
                    </div>
                    {/* Rolling PPG window selector — shared with My Roster */}
                    <span className="wr-module-toolbar-label">PPG</span>
                    <div className="wr-module-nav">
                    {[{k:'season',l:'Season'},{k:'l5',l:'L5'},{k:'l3',l:'L3'}].map(opt => (
                        <button key={opt.k} className={ppgWindow === opt.k ? 'is-active' : ''} onClick={() => setPpgWindow(opt.k)} title={opt.k === 'season' ? 'Season-to-date PPG' : 'Last ' + (opt.k === 'l5' ? 5 : 3) + ' games'}>{opt.l}</button>
                    ))}
                    </div>

                    <span className="wr-module-toolbar-label">Min pts</span>
                    <input
                        type="number" inputMode="numeric" value={faAdv.minPrevPts} placeholder="e.g. 100"
                        title={'Only show players with at least this many ' + faPtsYearActive + ' points'}
                        onChange={e => { const v = e.target.value; setFaAdv({ minPrevPts: v }); }}
                        style={{ width: '84px', padding: '3px 8px', minHeight: '44px', boxSizing: 'border-box', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid ' + (faAdvCount ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.1))'), borderRadius: 'var(--card-radius-sm, 8px)', color: 'var(--white)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', outline: 'none' }}
                    />
                    {faAdvCount ? (
                        <button type="button" onClick={() => setFaAdv({ minPrevPts: '' })} title="Clear the min points filter" style={{ padding: '3px 8px', minHeight: '44px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius-sm, 8px)', cursor: 'pointer' }}>✕</button>
                    ) : null}

                    {window.WR?.SavedViews?.SavedViewBar && (
                        <div style={{ marginLeft: 'auto' }}>
                            {React.createElement(window.WR.SavedViews.SavedViewBar, {
                                surface: 'free_agency',
                                leagueId: currentLeague?.id || currentLeague?.league_id,
                                currentState: { columns: visibleFaCols, sort: faSort, filters: { faFilter, faSearch } },
                                onApply: (v) => {
                                    if (Array.isArray(v.columns) && v.columns.length) { setVisibleFaCols(faTierCols(v.columns.filter(k => FA_COLUMNS[k]))); setFaColPreset('custom'); }
                                    if (v.sort && v.sort.key) setFaSort({ key: v.sort.key, dir: v.sort.dir || 1 });
                                    if (v.filters && typeof v.filters.faFilter === 'string') setFaFilter(v.filters.faFilter);
                                    if (v.filters && typeof v.filters.faSearch === 'string') setFaSearch(v.filters.faSearch);
                                },
                            })}
                        </div>
                    )}
                </div>

                {showFaColPicker && (
                    <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '12px', marginBottom: '8px' }}>
                        {/* Active columns — reorderable */}
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 700 }}>Active order (click ◀ ▶ to reorder)</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                            {visibleFaCols.map((key, i) => {
                                const col = faColumns[key]; if (!col) return null;
                                const moveLeft = () => { setFaColPreset('custom'); setVisibleFaCols(prev => { if (i === 0) return prev; const next = [...prev]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; }); };
                                const moveRight = () => { setFaColPreset('custom'); setVisibleFaCols(prev => { if (i === prev.length - 1) return prev; const next = [...prev]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; return next; }); };
                                const remove = () => { setFaColPreset('custom'); setVisibleFaCols(prev => prev.filter(c => c !== key)); };
                                return (
                                    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '2px 4px 2px 8px', borderRadius: 'var(--card-radius-xs, 5px)', fontSize: 'var(--text-label, 0.75rem)', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', color: 'var(--gold)' }}>
                                        <span style={{ marginRight: '4px' }}>{col.shortLabel}</span>
                                        {/* .fa-colpick-btn: 44px touch bump at ≤767 (index.html phone CSS); 32px glyph-pad elsewhere */}
                                        <button className="fa-colpick-btn" onClick={moveLeft} disabled={i === 0} title="Move left" style={{ padding: '0 3px', minWidth: '32px', minHeight: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: i === 0 ? 'var(--acc-line1, rgba(212,175,55,0.25))' : 'var(--gold)', cursor: i === 0 ? 'default' : 'pointer', fontSize: 'var(--text-label, 0.75rem)' }}>◀</button>
                                        <button className="fa-colpick-btn" onClick={moveRight} disabled={i === visibleFaCols.length - 1} title="Move right" style={{ padding: '0 3px', minWidth: '32px', minHeight: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: i === visibleFaCols.length - 1 ? 'var(--acc-line1, rgba(212,175,55,0.25))' : 'var(--gold)', cursor: i === visibleFaCols.length - 1 ? 'default' : 'pointer', fontSize: 'var(--text-label, 0.75rem)' }}>▶</button>
                                        <button className="fa-colpick-btn" onClick={remove} title="Remove" style={{ padding: '0 4px', minWidth: '32px', minHeight: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--bad)', cursor: 'pointer', fontSize: 'var(--text-label, 0.75rem)' }}>×</button>
                                    </span>
                                );
                            })}
                        </div>

                        {/* All available columns — tick to add */}
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 700 }}>Available columns</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '4px' }}>
                            {Object.entries(faColumns).filter(([key]) => isPro || !FA_PRO_COLS.has(key)).map(([key, col]) => {
                                const active = visibleFaCols.includes(key);
                                return (
                                    <label key={key} style={{
                                        display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px',
                                        borderRadius: 'var(--card-radius-xs, 5px)', cursor: 'pointer', fontSize: 'var(--text-body, 1rem)',
                                        background: active ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'transparent',
                                        color: active ? 'var(--gold)' : 'var(--silver)'
                                    }}>
                                        <input type="checkbox" checked={active} onChange={() => {
                                            setVisibleFaCols(prev => active ? prev.filter(c => c !== key) : [...prev, key]);
                                            setFaColPreset('custom');
                                        }} style={{ accentColor: 'var(--gold)' }} />
                                        {col.label}
                                        <span style={{ fontSize: 'var(--text-label, 0.75rem)', opacity: 0.6, marginLeft: 'auto' }}>{col.group}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Dynamic grid — photo + Player + configured columns */}
                {(() => {
                    // Render-time tier filter — the normalize effect fixes state a
                    // beat later, but the first paint must never show a Pro column.
                    const shownFaCols = faTierCols(visibleFaCols);
                    const gridTemplate = '32px minmax(150px, 1fr) ' + shownFaCols.map(k => (faColumns[k]?.width || '44px')).join(' ');
                    const tableMinWidth = 32 + 150 + 24 + shownFaCols.reduce((s, k) => s + (parseInt(faColumns[k]?.width || '44', 10) || 44) + 4, 0);
                    return <div style={{ background: 'var(--black)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius, 10px)', overflowX: 'auto' }}>
                        {/* Header */}
                        <div className="fa-mkt-head" style={{ display: 'grid', gridTemplateColumns: gridTemplate, gap: '4px', padding: '8px 12px', minWidth: tableMinWidth + 'px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))' }}>
                            <span style={faHeaderStyle}></span>
                            <span style={faHeaderStyle} onClick={() => handleFaSort('name')}>Player{faSortIndicator('name')}</span>
                            {shownFaCols.map(k => {
                                const col = faColumns[k]; if (!col) return null;
                                const clickable = !!col.sortKey;
                                return <span key={k} style={{ ...faHeaderStyle, cursor: clickable ? 'pointer' : 'default' }} title={col.label}
                                    onClick={() => clickable && handleFaSort(col.sortKey)}>
                                    {col.shortLabel}{clickable ? faSortIndicator(col.sortKey) : ''}
                                </span>;
                            })}
                        </div>
                        {/* Body */}
                        <div style={{ maxHeight: 'none', overflow: 'visible', minWidth: tableMinWidth + 'px' }}>
                            {sortedPlayers.map(({ pid, p, dhq, proj }) => {
                                const pos = normPos(p.position) || p.position;
                                const st = statsData[pid] || {};
                                // This season only. The old last-season fallback is what
                                // printed 11.4 PPG beside a back who had not played a
                                // down this year — last season's one-game average
                                // wearing this season's label.
                                const seasonPpg = st.gp > 0 ? +(calcRawPts(st) / st.gp).toFixed(1) : null;
                                const seasonGames = Number(st.gp) || 0;
                                // Rolling PPG — swap in when user toggled L5/L3 and weekly data is loaded.
                                // If a window is active but the player has no weekly data yet, annotate
                                // the cell with "· Szn" so the user knows the shown value is seasonal.
                                let ppg = seasonPpg;
                                // A one- or two-game average is a box score, not a
                                // season. Carry the sample so the reader can tell.
                                let ppgMarker = (ppgWindow === 'season' && seasonPpg != null && seasonGames > 0 && seasonGames < 3)
                                    ? ' · ' + seasonGames + 'g' : '';
                                if (ppgWindow !== 'season') {
                                    const n = ppgWindow === 'l3' ? 3 : 5;
                                    const rolling = typeof window.App?.computeRollingPPG === 'function'
                                        ? window.App.computeRollingPPG(pid, n)
                                        : 0;
                                    if (rolling > 0) { ppg = rolling; ppgMarker = ' · L' + n; }
                                    else { ppgMarker = ' · Szn'; }
                                }
	                                const faab = faabSuggest(dhq, pos, p.age, pid);
		                                const peakYrs = peakYearsFor(pos, p.age);
		                                const valueYrs = valueYearsFor(pos, p.age);
		                                const peakLabel = peakYrs >= 4 ? 'Rising' : peakYrs >= 1 ? 'Prime' : valueYrs >= 1 ? 'Vet' : 'Post';
		                                const peakCol = peakYrs >= 4 ? 'var(--good)' : peakYrs >= 1 ? 'var(--gold)' : valueYrs >= 1 ? 'var(--warn)' : 'var(--bad)';
                                // Rookie/prospect fields for this row (null for vets) — resolved once.
                                const rf = window.App?.RookieFields?.fields?.(prospectFor(p)) || null;
                                const rkDash = <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.3))' }}>{'—'}</span>;
                                const renderCell = (k) => {
                                    switch (k) {
                                        case 'pos':        return <span style={{ fontSize: '0.78rem', fontWeight: 700, color: posColors[pos] || 'var(--silver)' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</span>;
                                        case 'team':       return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontWeight: 600 }}>{p.team || 'FA'}</span>;
                                        case 'age':        return <span style={{ fontSize: '0.78rem', color: 'var(--silver)' }}>{p.age || '\u2014'}</span>;
                                        // DHQ reads white here \u2014 no tier colors in the market table (owner ask 2026-07-12)
                                        case 'dhq':        return <span style={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: 'var(--white)' }}>{dhq > 0 ? dhq.toLocaleString() : '\u2014'}</span>;
                                        case 'ppg':        return <span style={{ fontSize: '0.78rem', color: ppg >= 10 ? 'var(--good)' : ppg >= 5 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))' }}>{ppg > 0 ? ppg : '\u2014'}{ppgMarker}</span>;
                                        case 'proj':       return <span title="This week's projected points (league-scored)" style={{ fontSize: '0.78rem', fontWeight: 600, color: proj >= 14 ? 'var(--good)' : proj >= 8 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))' }}>{proj > 0 ? proj.toFixed(1) : '\u2014'}{window.App && window.App.DhqProj ? <span title="DHQ projection (Sleeper above)" style={{ display: 'block', fontSize: '0.6rem', fontWeight: 700, color: 'var(--gold, #d4af37)' }}>{'DHQ ' + window.App.DhqProj.fmt(pid)}</span> : null}</span>;
                                        case 'peakYr':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: peakCol, fontWeight: 600 }}>{peakLabel}</span>;
                                        case 'yrsExp':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>{p.years_exp != null ? p.years_exp : '\u2014'}</span>;
                                        case 'college':    return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.college || '\u2014'}</span>;
                                        case 'height':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>{p.height ? Math.floor(p.height/12) + "'" + (p.height%12) + '"' : '\u2014'}</span>;
                                        case 'weight':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>{p.weight || '\u2014'}</span>;
                                        // depth_chart_order is 1-based on Sleeper (1 = the starter).
                                        case 'depthChart': return <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: p.depth_chart_order != null ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))' }}>{p.depth_chart_order >= 1 ? pos + p.depth_chart_order : '\u2014'}</span>;
                                        case 'injury':     return <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, color: p.injury_status ? 'var(--bad)' : 'var(--ov-8, rgba(255,255,255,0.3))' }}>{p.injury_status || '—'}</span>;
                                        case 'faab':       return <span title={faEstTitle(faab)} style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', fontWeight: 700 }}>{faab ? faEstText(faab, '-', true) : '\u2014'}</span>;
                                        case 'sig1':
                                        case 'sig2': {
                                            const read = faSigRead(pos, k === 'sig1' ? 0 : 1, pid);
                                            if (!read) return rkDash;
                                            return <span title={read.label + ' · this season'} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, color: read.value != null ? 'var(--white)' : 'var(--ov-8, rgba(255,255,255,0.3))', fontVariantNumeric: 'tabular-nums' }}>{read.text}</span>
                                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7 }}>{read.short}</span>
                                            </span>;
                                        }
                                        case 'rkSlot': {
                                            // Prospect slot wins; vets show R<rd> #<overall> / UDFA from the static dataset.
                                            const dp = faDraftCap(pid);
                                            const slotTxt = rf?.draftSlot || faDraftSlotTxt(pid);
                                            const rd1 = rf ? rf.draftRound : dp?.round;
                                            return slotTxt ? <span title={dp && dp.round > 0 ? dp.year + ' draft — round ' + dp.round + ', pick ' + dp.overall + ' overall' : undefined} style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: rd1 === 1 ? 'var(--good)' : rd1 && rd1 <= 3 ? 'var(--gold)' : 'var(--silver)' }}>{slotTxt}</span> : rkDash;
                                        }
                                        case 'rkTeam': {
                                            const tm = rf?.nflTeam || faDraftCap(pid)?.team;
                                            return tm ? <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontWeight: 600 }}>{tm}</span> : rkDash;
                                        }
                                        case 'rkRank':     return rf && rf.consensusRank != null ? <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>{rf.consensusRank}</span> : rkDash;
                                        case 'rkTier':     return rf && rf.tierLabel ? <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)' }}>{rf.tierLabel}</span> : rkDash;
                                        case 'rkProfile': {
                                            const prof = rf?.profile || [p.height ? Math.floor(p.height / 12) + "'" + (p.height % 12) + '"' : null, p.weight ? p.weight + ' lb' : null].filter(Boolean).join(' · ');
                                            return prof ? <span title={prof} style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prof}</span> : rkDash;
                                        }
                                        default:           return <span>—</span>;
                                    }
                                };
                                return <div key={pid} role="button" tabIndex={0} title="Open player card" onClick={() => {
                                    openFaPlayer(pid);
                                }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFaPlayer(pid); } }} className={'fa-mkt-row' + (faSelectedPid === pid ? ' is-sel' : '')} style={{ display: 'grid', gridTemplateColumns: gridTemplate, background: faSelectedPid === pid ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'transparent', gap: '4px', padding: '7px 12px', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))', cursor: 'pointer', alignItems: 'center', transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.05))'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                    <div style={{ width: '26px', height: '26px', borderRadius: '50%', overflow: 'hidden', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <img src={'https://sleepercdn.com/content/nfl/players/' + pid + '.jpg'} alt="" style={{ width: '26px', height: '26px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))' }} onError={e => { e.target.style.display='none'; const s=document.createElement('span'); s.style.cssText='font-size:var(--text-label, 0.75rem);font-weight:700;color:var(--gold)'; s.textContent=((p.first_name||'?')[0]+(p.last_name||'?')[0]).toUpperCase(); e.target.after(s); }} />
                                    </div>
                                    <div style={{ overflow: 'hidden' }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playerName(p, pid)}</div>
                                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.55 }}>{p.team || 'FA'}{p.injury_status ? ' · ' : ''}{p.injury_status ? <span style={{ color: 'var(--bad)' }}>{p.injury_status}</span> : ''}</div>
                                    </div>
                                    {shownFaCols.map(k => <span key={k} style={{ display: 'flex', alignItems: 'center' }}>{renderCell(k)}</span>)}
                                </div>;
                            })}
                        </div>
                    </div>;
                })()}
                </section>

                {/* ── RIGHT: PLAYER DETAIL PANEL ── */}
                {/* .fa-detail-drawer/.fa-detail-close: phone tier (index.html ≤767 CSS)
                    pads the drawer for the notch/home indicator (top:0/bottom:0 fixed
                    panel draws under both in installed-PWA) — unstyled ≥768. */}
                {faSelectedPid && selPlayer && <div className="fa-detail-drawer" style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 'min(380px, 92vw)', background: 'linear-gradient(135deg, var(--off-black), var(--charcoal))', borderLeft: '2px solid var(--gold)', zIndex: 200, overflowY: 'auto', padding: '20px', boxShadow: '-8px 0 32px rgba(0,0,0,0.5)' }}>
                    {/* Close */}
                    <button className="fa-detail-close" onClick={() => setFaSelectedPid(null)} style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', color: 'var(--silver)', width: '44px', height: '44px', minWidth: '44px', minHeight: '44px', borderRadius: '50%', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>

                    {/* Photo + Name */}
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '16px' }}>
                        <div style={{ width: '64px', height: '64px', borderRadius: 'var(--card-radius-lg, 14px)', overflow: 'hidden', background: 'var(--acc-fill2, rgba(212,175,55,0.1))', border: '2px solid var(--acc-line2, rgba(212,175,55,0.3))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <img src={'https://sleepercdn.com/content/nfl/players/' + faSelectedPid + '.jpg'} style={{ width: '64px', height: '64px', objectFit: 'cover' }} onError={e => { e.target.style.display='none'; const s=document.createElement('span'); s.style.cssText='font-size:20px;font-weight:700;color:var(--gold)'; s.textContent=selInitials; e.target.after(s); }} />
                        </div>
                        <div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.4rem', color: 'var(--white)', letterSpacing: '0.02em' }}>{playerName(selPlayer, faSelectedPid)}</div>
                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)' }}>{selPos} · {selPlayer.team || 'FA'} · Age {selPlayer.age || '?'} · {selPlayer.years_exp ?? 0}yr exp{selPlayer.college ? ' · ' + selPlayer.college : ''}</div>
                        </div>
                    </div>

                    {/* Key Stats Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
                        {[
                            { val: selDhq > 0 ? selDhq.toLocaleString() : '\u2014', label: valueKpiLabel, col: selDhq >= 7000 ? 'var(--good)' : selDhq >= 4000 ? 'var(--k-3498db, #3498db)' : selDhq >= 2000 ? 'var(--silver)' : 'var(--silver)' },
                            { val: selPpg || '\u2014', label: 'PPG', col: selPpg >= 10 ? 'var(--good)' : selPpg >= 5 ? 'var(--silver)' : 'var(--silver)' },
	                            { val: selPeakYrs > 0 ? selPeakYrs + 'yr' : selValueYrs + 'yr', label: selPeakYrs > 0 ? 'PEAK LEFT' : 'VALUE LEFT', col: selPeakYrs >= 4 ? 'var(--good)' : selPeakYrs >= 1 ? 'var(--gold)' : selValueYrs >= 1 ? 'var(--warn)' : 'var(--bad)' },
                        ].map((s, i) => <div key={i} style={{ textAlign: 'center', background: 'var(--ov-2, rgba(255,255,255,0.03))', borderRadius: 'var(--card-radius-sm, 8px)', padding: '10px 6px', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))' }}>
                            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.3rem', fontWeight: 600, color: s.col }}>{s.val}</div>
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                        </div>)}
                    </div>

                    {/* FAAB Recommendation */}
                    {/* League bid history first (real completed winning bids),
                        then OUR model estimate, labelled as one — the same
                        faModelBid number the hero, rows and FAAB Command show. */}
                    {selFaab && selBidEvidence ? <FaBidEvidence evidence={selBidEvidence} remaining={remaining} /> : null}
                    {selFaab && <div title={faEstTitle(selFaab)} style={{ background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: 'var(--card-radius, 10px)', padding: '14px', marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>DHQ bid estimate</div>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.8rem', fontWeight: 600, color: 'var(--gold)' }}>{faEstText(selFaab, ' \u2013 $')}</div>
                        <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginTop: '4px' }}>Model bid: <strong style={{ color: 'var(--white)' }}>{'$' + selFaab.sug}</strong> of ${remaining} remaining — {selFaab.coldStart
                                ? 'league-median mode (' + selFaab.sampleSize + ' bid' + (selFaab.sampleSize === 1 ? '' : 's') + ' logged this season); our estimate, not a market price.'
                                : 'from the ' + selFaab.sampleSize + ' bids this league has placed this season; our estimate, not a market price.'}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: selFaab.confCol }} />
                            <span style={{ fontSize: 'var(--text-body, 1rem)', color: selFaab.confCol, fontWeight: 600 }}>{selFaab.conf}</span>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6 }}>{selFaab.competitors} rival{selFaab.competitors !== 1 ? 's' : ''} with a {selPos} need and the budget</span>
                        </div>
                    </div>}

                    {/* Roster Fit — a fills-your-need read, Pro (raw stats below stay free) */}
                    {isPro && assess && (() => {
                        const need = assess.needs?.find(n => n.pos === selPos);
                        const strength = assess.strengths?.includes(selPos);
                        return <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: 'var(--card-radius, 10px)', padding: '14px', marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>ROSTER FIT</div>
                            {need && <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--k-2ecc71, #2ecc71)', fontWeight: 600, marginBottom: '4px' }}>Fills {selPos} {need.urgency}</div>}
                            {strength && <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.7, marginBottom: '4px' }}>You already have {selPos} surplus — stash only</div>}
                            {!need && !strength && <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '4px' }}>Depth add at {selPos}</div>}
                        </div>;
                    })()}

                    {/* Season Stats */}
                    {selStats.gp > 0 && <div style={{ marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>SEASON STATS</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {[
                                ['Games', selStats.gp],
                                ['Total Pts', selStats.pts_half_ppr ? Math.round(selStats.pts_half_ppr) : Math.round(calcRawPts(selStats))],
                                ['PPG', selPpg],
                                selStats.pass_yd ? ['Pass Yds', Math.round(selStats.pass_yd).toLocaleString()] : selStats.rush_yd ? ['Rush Yds', Math.round(selStats.rush_yd).toLocaleString()] : selStats.rec ? ['Receptions', selStats.rec] : null,
                                selStats.pass_td ? ['Pass TD', selStats.pass_td] : selStats.rush_td ? ['Rush TD', selStats.rush_td] : selStats.rec_td ? ['Rec TD', selStats.rec_td] : null,
                                selStats.rec_yd ? ['Rec Yds', Math.round(selStats.rec_yd).toLocaleString()] : null,
                            ].filter(Boolean).map(([label, val], i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'var(--ov-1, rgba(255,255,255,0.02))', borderRadius: 'var(--card-radius-xs, 5px)' }}>
                                <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6 }}>{label}</span>
                                <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', fontWeight: 600 }}>{val}</span>
                            </div>)}
                        </div>
                    </div>}

                    {/* Usage — per-game signature stats for his position, this
                        season's Sleeper line (App.FAMarketData); '—' when missing. */}
                    {selStats.gp > 0 && (() => {
                        const reads = [0, 1, 2].map(i => faSigRead(selPos, i, faSelectedPid)).filter(Boolean);
                        if (!reads.length) return null;
                        return <div style={{ marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>USAGE · PER GAME</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                {reads.map(r => <div key={r.key} title={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'var(--ov-1, rgba(255,255,255,0.02))', borderRadius: 'var(--card-radius-xs, 5px)' }}>
                                    <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6 }}>{r.short}</span>
                                    <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', fontWeight: 600 }}>{r.text}</span>
                                </div>)}
                            </div>
                        </div>;
                    })()}

                    {/* Physical */}
                    {(selPlayer.height || selPlayer.weight) && <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.6, marginBottom: '16px' }}>
                        {selPlayer.height ? Math.floor(selPlayer.height/12) + "'" + (selPlayer.height%12) + '"' : ''}{selPlayer.weight ? ' · ' + selPlayer.weight + 'lbs' : ''}
                    </div>}

                    {/* Action */}
                    <button onClick={() => openFaPlayer(faSelectedPid)} style={{ width: '100%', padding: '10px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: 'var(--card-radius-sm, 8px)', fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', letterSpacing: '0.06em', cursor: 'pointer' }}>FULL PLAYER CARD</button>
                </div>}
            </div>
        );
    }
