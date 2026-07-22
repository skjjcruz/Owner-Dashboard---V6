// ══════════════════════════════════════════════════════════════════
// js/tabs/my-team.js — MyTeamTab: roster view with format-aware value labels,
// PPG stats, age curves, acquisition history, and column customization
// Extracted from league-detail.js. Props: all required state from LeagueDetail.
// ══════════════════════════════════════════════════════════════════

function MyTeamTab({
  // Core data
  myRoster,
  currentLeague,
  leagueSkin,
  playersData,
  statsData,
  stats2025Data,
  standings,
  sleeperUserId,

  // Roster filter / sort / columns
  rosterFilter,
  setRosterFilter,
  rosterSort,
  setRosterSort,
  visibleCols,
  setVisibleCols,
  expandedPid,
  setExpandedPid,
  showColPicker,
  setShowColPicker,
  colPreset,
  setColPreset,

  // Compare sub-view was promoted to its own top-level tab (js/tabs/compare.js)
  // so myTeamView / compareTeamId props are gone.

  // GM Strategy
  gmStrategy,
  setGmStrategy,
  gmStrategyOpen,
  setGmStrategyOpen,

  // Alex avatar
  setAlexAvatar,
  setAvatarKey,

  // Navigation / Recon panel
  setActiveTab,
  setReconPanelOpen,
  sendReconMessage,

  // Misc
  timeRecomputeTs,
  setTimeRecomputeTs,
  getAcquisitionInfo: getAcquisitionInfoProp,
}) {
  // Fallback if prop not passed — prevents crash
  const getAcquisitionInfo = typeof getAcquisitionInfoProp === 'function' ? getAcquisitionInfoProp : () => ({ method: 'Unknown', date: '', cost: '' });
  const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
  const skinFeatures = resolvedLeagueSkin?.features || {};
  const skinVocabulary = resolvedLeagueSkin?.vocabulary || {};
  const valueLabel = skinVocabulary.valueLabel || 'DHQ Dynasty Value';
  const valueShortLabel = skinVocabulary.valueShortLabel || 'Value';

  // Scout-free vs Pro. Free keeps every raw column + sort/filter/tags/IR/taxi;
  // the verdict layer (Move column, DROP? chips, row tints, Action lens,
  // dossier roster call, START/SIT line, Dynasty Read AI) keys on this one
  // predicate — wrIsPro only, never canAccess/getTier (shadowing hazard).
  const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;

  function calcRawPts(s) { return window.App.calcRawPts(s, currentLeague?.scoring_settings); }

  function getPlayerName(playerId) {
    const player = playersData[playerId];
    if (!player) return `Player ${playerId}`;
    return player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || `Player ${playerId}`;
  }

  // Rookie/prospect join — name→prospect index (rebuilt when the rookie CSV lands,
  // signalled by timeRecomputeTs). Resolves a roster player to its rookie-data
  // record so the rich scouting fields surface in columns + the Rookies filter.
  const RookieFields = window.App?.RookieFields;
  const rookieIndex = React.useMemo(() => RookieFields ? RookieFields.buildIndex() : new Map(), [timeRecomputeTs]);
  const prospectForRow = React.useCallback((r) => RookieFields ? RookieFields.lookup(rookieIndex, r?.p, { posGuard: true }) : null, [rookieIndex]);
  const isRookieRow = React.useCallback((r) => {
    if (!r || !r.p) return false;
    const pr = prospectForRow(r);
    return RookieFields ? RookieFields.isRookie(r.p, pr, { cur: statsData, prev: stats2025Data }) : false;
  }, [prospectForRow, statsData, stats2025Data]);

  // NFL draft capital for EVERYONE (vets included) — static vendored dataset
  // (js/shared/draft-profile-data.js → window.WR_DRAFT_PROFILE): [year, round,
  // OVERALL pick, team]; round 0 = confirmed UDFA. Rookie prospect records
  // (prospectForRow) stay the richer source and take precedence where present.
  const draftCapFor = (pid) => {
    const d = window.WR_DRAFT_PROFILE?.[pid];
    if (!d) return null;
    return { year: d[0] || 0, round: d[1] || 0, overall: d[2] || 0, team: d[3] || '' };
  };

  // ── GM Strategy — single source of truth. Live-updates on GM Strategy save. ──
  // Drives untouchable lock badges, target/sell position accents, and a sell-rule
  // nudge on the roster recommendation. Hook is called once, unconditionally.
  const gm = window.WR.GmMode.useGmEffects(currentLeague);
  const gmTargetPositions = gm?.targetPositions instanceof Set ? gm.targetPositions : new Set();
  const gmSellPositions = gm?.sellPositions instanceof Set ? gm.sellPositions : new Set();
  const gmUntouchable = gm?.untouchable instanceof Set ? gm.untouchable : new Set();
  // Parse free-text sell rules like "Sell RB age 27+" leniently. Returns
  // { pos: 'RB', minAge: 27 } per parseable rule; unparseable rules are ignored.
  const gmSellRulesParsed = React.useMemo(() => {
    const out = [];
    (gm?.sellRules || []).forEach(rule => {
      try {
        const s = String(rule);
        const posM = s.match(/\b(QB|RB|WR|TE|K|DEF|DL|LB|DB)\b/i);
        const ageM = s.match(/age\s*(\d{1,2})\s*\+?/i);
        if (!posM && !ageM) return; // nothing structured to match on
        out.push({
          pos: posM ? posM[1].toUpperCase() : null,
          minAge: ageM ? parseInt(ageM[1], 10) : null,
        });
      } catch {}
    });
    return out;
  }, [gm?.sellRules]);
  // Does a row trip a sell rule or a sell-position? Used to nudge the rec.
  const gmTripsSell = React.useCallback((r) => {
    if (!r) return false;
    const pos = String(r.pos);
    if (gmSellPositions.has(pos)) return true;
    return gmSellRulesParsed.some(rule => {
      const posOk = !rule.pos || rule.pos === pos;
      const ageOk = rule.minAge == null || (r.age != null && r.age >= rule.minAge);
      // A rule with neither a usable pos nor age constraint shouldn't fire blindly.
      if (rule.pos == null && rule.minAge == null) return false;
      return posOk && ageOk;
    });
  }, [gmSellPositions, gmSellRulesParsed]);

  // ── Weekly start/sit projections (redraft) — league-scored via App.WeeklyProj.
  // Computed once; the 'proj' column + its sort read it. Neutral matchup until the
  // projections feed lands; guarded so dynasty/offseason rows just render '—'.
  // Load Sleeper's OWN published weekly projections so the Proj column shows the
  // exact number the owner sees in Sleeper (scored to this league); recompute
  // when they land or when any other tab loads them (wr:proj-updated).
  const [projTick, setProjTick] = React.useState(0);
  React.useEffect(() => {
    const SP = window.App && window.App.SleeperProj;
    if (!SP || !SP.loadCurrent) return;
    let alive = true;
    SP.loadCurrent(currentLeague && currentLeague.season).then(wk => { if (alive && wk) setProjTick(t => t + 1); }).catch(() => {});
    const onProj = () => { if (alive) setProjTick(t => t + 1); };
    window.addEventListener('wr:proj-updated', onProj);
    return () => { alive = false; window.removeEventListener('wr:proj-updated', onProj); };
  }, [currentLeague && (currentLeague.league_id || currentLeague.id), currentLeague && currentLeague.season]);
  const weeklyLineup = React.useMemo(() => {
    const WP = window.App && window.App.WeeklyProj;
    if (!WP || !myRoster || !currentLeague) return null;
    try {
      const res = WP.optimalForRoster(myRoster, currentLeague, { playersData, statsData, priorData: stats2025Data });
      return { res, starterSet: new Set((res.optimal.starters || []).map(s => String(s.pid))), objective: res.objective };
    } catch (e) { if (window.wrLog) window.wrLog('myteam.weeklyProj', e); return null; }
  }, [myRoster, currentLeague, playersData, statsData, stats2025Data, timeRecomputeTs, projTick]);
  const projFor = (pid) => (weeklyLineup && weeklyLineup.res.projections[pid]) || null;

  // Build rest-of-season values for REDRAFT leagues so the value column + sort
  // + coloring reflect ROS production instead of dynasty DHQ. No-op (falls back
  // to DHQ) for dynasty/keeper, offseason, or when no weeks remain.
  React.useMemo(() => {
    try {
      window.App?.PlayerValue?.ensureRos?.({
        leagueId: currentLeague?.league_id || currentLeague?.id,
        league: currentLeague, playersData, statsData, priorData: stats2025Data,
        skin: resolvedLeagueSkin,
      });
    } catch (e) { if (window.wrLog) window.wrLog('myteam.ensureRos', e); }
    return null;
  }, [currentLeague, playersData, statsData, stats2025Data, timeRecomputeTs]);

  // ── filteredAndSortedRows (formerly a sibling function of renderMyTeamTab) ──
  function filteredAndSortedRows(rows) {
    const offPos = new Set(['QB','RB','WR','TE','K','DEF']);
    const idpPos = new Set(['DL','LB','DB']);
    let filtered = rows;
    if (rosterFilter === 'Starters') filtered = rows.filter(r => r.isStarter);
    else if (rosterFilter === 'Bench') filtered = rows.filter(r => !r.isStarter && !r.isIR && !r.isTaxi);
    else if (rosterFilter === 'Taxi') filtered = rows.filter(r => r.isTaxi);
    else if (rosterFilter === 'IR') filtered = rows.filter(r => r.isIR);
    else if (rosterFilter === 'Offense') filtered = rows.filter(r => offPos.has(r.pos));
    else if (rosterFilter === 'IDP') filtered = rows.filter(r => idpPos.has(r.pos));
    else if (rosterFilter === 'Rookies') filtered = rows.filter(r => isRookieRow(r));

    const posOrder = {QB:0,RB:1,WR:2,TE:3,K:4,DEF:5,DL:6,LB:7,DB:8};
    return [...filtered].sort((a, b) => {
      const {key, dir} = rosterSort;
      if (rosterGroupMode !== 'none') {
        const gd = (getRowGroupRank(a) - getRowGroupRank(b)) || String(getRowGroupKey(a)).localeCompare(String(getRowGroupKey(b)));
        if (gd !== 0) return gd;
      }
      if (key === 'dhq') return (b.dhq - a.dhq) * dir;
      if (key === 'age') return ((a.age||99) - (b.age||99)) * dir;
      if (key === 'ppg') {
        // Honor the rolling PPG window so sort order matches what's displayed.
        let av = a.curPPG || 0, bv = b.curPPG || 0;
        if (ppgWindow !== 'season' && typeof window.App?.computeRollingPPG === 'function') {
          const n = ppgWindow === 'l3' ? 3 : 5;
          const ra = window.App.computeRollingPPG(a.pid, n);
          const rb = window.App.computeRollingPPG(b.pid, n);
          // Only override if rolling data is available for the player; else fall back to seasonal.
          if (ra > 0) av = ra;
          if (rb > 0) bv = rb;
        }
        return (bv - av) * dir;
      }
      if (key === 'proj') {
        // Sort by the same median projection the column now displays.
        const pv = r => { const p = projFor(r.pid); return p && p.available ? ((p.points && (p.points.median != null ? p.points.median : p.points.mean)) || 0) : -1; };
        return (pv(b) - pv(a)) * dir;
      }
      if (key === 'hi' || key === 'lo') {
        const f = r => window.App?.WeeklyProj?.formStats?.(r.pid, 'season');
        const v = r => { const s = f(r); return s ? (key === 'hi' ? s.high : s.low) : -1; };
        return (v(b) - v(a)) * dir;
      }
      if (key === 'prev') return ((b.prevPPG||0) - (a.prevPPG||0)) * dir;
      if (key === 'trend') return ((b.trend||0) - (a.trend||0)) * dir;
      if (key === 'gp') return ((b.curGP||0) - (a.curGP||0)) * dir;
      if (key === 'durability') return ((b.durabilityGP||0) - (a.durabilityGP||0)) * dir;
      if (key === 'name') { const na = getPlayerName(a.pid).toLowerCase(), nb = getPlayerName(b.pid).toLowerCase(); return (na < nb ? -1 : na > nb ? 1 : 0) * dir; }
      if (key === 'pos') { const d = ((posOrder[a.pos] ?? 99) - (posOrder[b.pos] ?? 99)); return d !== 0 ? d * dir : (b.dhq - a.dhq); }
      if (key === 'peak') return ((b.peakYrsLeft||0) - (a.peakYrsLeft||0)) * dir;
      if (key === 'action') {
        // rec holds mixed-case labels ('Sell High', 'Build Around', 'Hold Core'…) — sort by family, not exact key.
        const fam = r => /sell/i.test(r.rec || '') ? 0 : /stash/i.test(r.rec || '') ? 1 : /buy|build|core/i.test(r.rec || '') ? 3 : 2;
        return (fam(b) - fam(a)) * dir;
      }
      if (key === 'yrsExp') return ((b.p.years_exp||0) - (a.p.years_exp||0)) * dir;
      if (key === 'college') { const ca = (a.p.college||'').toLowerCase(), cb = (b.p.college||'').toLowerCase(); return (ca < cb ? -1 : ca > cb ? 1 : 0) * dir; }
      if (key === 'nflDraft') return (((a.p.draft_round || (a.p.draft_pick ? Math.ceil(a.p.draft_pick/32) : 99)) - (b.p.draft_round || (b.p.draft_pick ? Math.ceil(b.p.draft_pick/32) : 99))) * dir);
      if (key === 'posRankLg') return (a.dhq - b.dhq) * dir; // proxy: higher dhq = better rank
      if (key === 'posRankNfl') return ((a.meta?.fcRank||999) - (b.meta?.fcRank||999)) * dir;
      if (key === 'starterSzn') return ((b.meta?.starterSeasons||0) - (a.meta?.starterSeasons||0)) * dir;
      if (key === 'height') return ((b.p.height||0) - (a.p.height||0)) * dir;
      if (key === 'weight') return ((b.p.weight||0) - (a.p.weight||0)) * dir;
      if (key === 'depthChart') return ((a.p.depth_chart_order||99) - (b.p.depth_chart_order||99)) * dir;
      if (key === 'slot') { const ord = {starter:0,taxi:1,bench:2,ir:3}; return ((ord[a.section]||9) - (ord[b.section]||9)) * dir; }
      if (key === 'acquired') { const aa = getAcquisitionInfo(a.pid, myRoster?.roster_id), ab = getAcquisitionInfo(b.pid, myRoster?.roster_id); return (aa.method < ab.method ? -1 : aa.method > ab.method ? 1 : 0) * dir; }
      if (key === 'acquiredDate') { const aa = getAcquisitionInfo(a.pid, myRoster?.roster_id), ab = getAcquisitionInfo(b.pid, myRoster?.roster_id); return (aa.date < ab.date ? -1 : aa.date > ab.date ? 1 : 0) * dir; }
      if (key === 'sos') {
        const getSosRank = (r) => { const s = window.App?.SOS?.getPlayerSOS?.(r.pid, r.pos, r.p?.team); return s?.avgRank || 16; };
        return (getSosRank(b) - getSosRank(a)) * dir; // higher rank = easier = sort first by default
      }
      // Draft-capital columns — prospect record first, then the static NFL
      // draft dataset (vets); players with neither sort last.
      if (key === 'rkSlot' || key === 'rkTeam' || key === 'rkRank' || key === 'rkTier' || key === 'rkProfile') {
        const pa = prospectForRow(a), pb = prospectForRow(b);
        if (key === 'rkTeam') {
          const team = (p, row) => p?.nflTeam || draftCapFor(row.pid)?.team || '';
          const ta = team(pa, a), tb = team(pb, b);
          if (!ta !== !tb) return ta ? -dir : dir;
          return (ta < tb ? -1 : ta > tb ? 1 : 0) * dir;
        }
        if (key === 'rkSlot') {
          // Unified ordinal ≈ overall selection: prospects approximate it from
          // round+pick-in-round; vets carry the true overall. UDFA = 9000.
          const slot = (p, row) => {
            if (p && Number(p.draftRound) > 0) return (Number(p.draftRound) - 1) * 32 + (Number(p.draftPick) || 32);
            const d = draftCapFor(row.pid);
            if (d) return d.round > 0 ? (d.overall || (d.round - 1) * 32 + 32) : 9000;
            return p ? 9000 : 1e9;
          };
          return (slot(pa, a) - slot(pb, b)) * dir;
        }
        if (key === 'rkProfile') {
          const spd = p => { const s = parseFloat(p?.speed); return Number.isFinite(s) && s > 0 ? s : 1e9; };
          return (spd(pa) - spd(pb)) * dir; // faster 40 first on ascending
        }
        // rkRank / rkTier — lower consensus rank is better; non-rookies last.
        const rank = p => (p && (p.consensusRank ?? p.rank) != null) ? Number(p.consensusRank ?? p.rank) : 1e9;
        return (rank(pa) - rank(pb)) * dir;
      }
      return 0;
    });
  }

  if (!myRoster) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--silver)' }}>No roster found</div>;

  // Dynasty (E2): the START/SIT verdict is suppressed at every tier — the Wk
  // column keeps raw pts + matchup grade, and the Redraft preset disappears.
  const wkVerdict = skinFeatures.showWeeklyVerdict !== false;
  const ROSTER_COLUMNS = {
    pos:        { label: 'Position', shortLabel: 'Pos', width: '38px', group: 'core' },
    age:        { label: 'Age', shortLabel: 'Age', width: '38px', group: 'dynasty' },
    dhq:        { label: valueLabel, shortLabel: valueShortLabel, width: '60px', group: 'dynasty' },
    ppg:        { label: 'Points Per Game', shortLabel: 'PPG', width: '48px', group: 'stats' },
    proj:       { label: isPro && wkVerdict ? 'This Week — projected pts + start/sit (league-scored)' : 'This Week — projected pts (league-scored)', shortLabel: 'Proj', width: '62px', group: 'stats' },
    hi:         { label: 'Season High — most fantasy pts in a week', shortLabel: 'Hi', width: '40px', group: 'stats' },
    lo:         { label: 'Season Low — fewest fantasy pts in a played week', shortLabel: 'Lo', width: '40px', group: 'stats' },
    prev:       { label: 'Previous Season PPG', shortLabel: 'Last', width: '44px', group: 'stats' },
    trend:      { label: 'Year-over-Year PPG Change (%) — how this season\u2019s PPG compares to last season\u2019s', shortLabel: 'Trend', width: '52px', group: 'dynasty' },
    peak:       { label: 'Peak Window Phase', shortLabel: 'Peak', width: '50px', group: 'dynasty' },
    action:     { label: 'Trade Recommendation', shortLabel: 'Move', width: '54px', group: 'dynasty' },
    gp:         { label: 'Games Played', shortLabel: 'GP', width: '36px', group: 'stats' },
    durability: { label: 'Durability — games played out of 17 (green=15+, amber=10-14, red=<10)', shortLabel: 'Dur', width: '40px', group: 'stats' },
    yrsExp:     { label: 'Years of Experience', shortLabel: 'Exp', width: '38px', group: 'dynasty' },
    college:    { label: 'College', shortLabel: 'School', width: '82px', group: 'scout' },
    // nflDraft removed — Sleeper doesn't reliably provide draft capital data
    posRankLg:  { label: 'League Position Rank', shortLabel: 'Lg #', width: '46px', group: 'dynasty' },
    posRankNfl: { label: 'NFL Position Rank', shortLabel: 'NFL #', width: '48px', group: 'dynasty' },
    starterSzn: { label: 'Starter Seasons', shortLabel: 'Starts', width: '48px', group: 'dynasty' },
    height:     { label: 'Height', shortLabel: 'Ht', width: '42px', group: 'scout' },
    weight:     { label: 'Weight (lbs)', shortLabel: 'Wt', width: '42px', group: 'scout' },
    depthChart: { label: 'Depth Chart Position', shortLabel: 'Depth', width: '48px', group: 'scout' },
    slot:       { label: 'Roster Slot', shortLabel: 'Slot', width: '48px', group: 'core' },
    acquired:   { label: 'Acquisition Method', shortLabel: 'Added', width: '74px', group: 'core' },
    acquiredDate: { label: 'Date Acquired', shortLabel: 'When', width: '60px', group: 'core' },
    sos:        { label: 'Sched Strength (1=hardest, 32=easiest)', shortLabel: 'SOS', width: '44px', group: 'stats' },
    // Draft-capital + profile columns. Rookies use the rookie-data record
    // (prospectForRow); vets fall back to the static NFL draft dataset
    // (draftCapFor — Sleeper's own API carries no draft capital).
    // Owner ask 2026-07-12: dropped the rookie-only Consensus Rank (rkRank)
    // and Tier (rkTier) columns — they read '—' for every veteran, so they
    // were dead weight in a roster board. The rich rookie tier/rank still
    // surface in the prospect scouting card, just not as roster columns.
    rkSlot:     { label: 'NFL Draft Capital — round + overall pick (UDFA = undrafted)', shortLabel: 'Draft', width: '54px', group: 'scout' },
    rkTeam:     { label: 'NFL Team That Drafted Him', shortLabel: 'Drafted', width: '50px', group: 'scout' },
    rkProfile:  { label: 'Profile — Ht · Wt (· 40 time for rookies)', shortLabel: 'Profile', width: '112px', group: 'scout' },
  };
  // Free: the Move/Trade-Recommendation column is a verdict → Pro. Dropping
  // the def removes it everywhere at once — the Customize picker, the 'full'
  // preset (derives from keys), the header + cell render, and persisted
  // column prefs (both filter on ROSTER_COLUMNS[key]) — so a saved custom
  // view can't resurrect it.
  if (!isPro) delete ROSTER_COLUMNS.action;

  // Dynasty (E2): 'proj' leaves the default preset — still user-addable
  // (raw pts; renderCell strips the verdict so saved views can't resurrect it).
  const COLUMN_PRESETS = {
    default: ['pos','age','dhq','posRankLg','ppg',...(wkVerdict ? ['proj'] : []),'durability','peak','action','sos'].filter(k => ROSTER_COLUMNS[k]),
    ...(wkVerdict ? { redraft: ['pos','proj','ppg','prev','trend','hi','lo','sos'] } : {}),
    stats:   ['pos','dhq','ppg','prev','trend','gp','durability','sos'],
    scout:   ['pos','age','college','slot','height','weight','depthChart','yrsExp','starterSzn','posRankNfl'],
    rookie:  ['pos','age','college','rkSlot','rkTeam','rkProfile'],
    full:    Object.keys(ROSTER_COLUMNS),
  };
  const COLUMN_PRESET_META = {
    default: { label: 'Default', tone: 'decision board' },
    redraft: { label: 'Redraft', tone: 'weekly + form' },
    stats: { label: 'Stats', tone: 'production' },
    scout: { label: 'Scout', tone: 'profile' },
    rookie: { label: 'Rookie', tone: 'prospect profile' },
    full: { label: 'Deep Data', tone: 'all fields' },
  };
  const rosterFilterOptions = [
    'All',
    'Starters',
    'Bench',
    ...(skinFeatures.showTaxi === false ? [] : ['Taxi']),
    'IR',
    'Offense',
    ...(skinFeatures.showIDP === false ? [] : ['IDP']),
    'Rookies',
  ];
  const rosterFilterKey = rosterFilterOptions.join('|');
  React.useEffect(() => {
    if (rosterFilter && !rosterFilterOptions.includes(rosterFilter)) setRosterFilter('All');
  }, [rosterFilter, rosterFilterKey]);

  const allPlayers = myRoster.players || [];
  const starters = new Set(myRoster.starters || []);
  const reserve = new Set(myRoster.reserve || []);
  const taxi = new Set(myRoster.taxi || []);

  const normPos = window.App.normPos;

  // Build enriched player rows
  const rows = allPlayers.map(pid => {
    const p = playersData[pid];
    if (!p) return null;
    const pos = normPos(p.position) || p.position || '?';
    const dhq = window.App?.PlayerValue?.getValue ? window.App.PlayerValue.getValue(pid, { skin: resolvedLeagueSkin }) : (window.App?.LI?.playerScores?.[pid] || 0);
    const meta = window.App?.LI?.playerMeta?.[pid];
    const st = statsData[pid] || {};
    const prev = stats2025Data?.[pid] || {};

    const curPts = calcRawPts(st) || 0;
    const curGP = st.gp || 0;
    const curPPG = curGP > 0 ? +(curPts / curGP).toFixed(1) : 0;

    const prevPts = calcRawPts(prev) || 0;
    const prevGP = prev.gp || 0;
    const prevPPG = prevGP > 0 ? +(prevPts / prevGP).toFixed(1) : 0;

    // Effective PPG: use current season if available, else fallback to previous season
    const effectivePPG = curPPG > 0 ? curPPG : prevPPG;
    const effectiveGP = curGP > 0 ? curGP : prevGP;
    // 2-year rolling average GP for durability (use meta.recentGP if available for longer history)
    const durabilityGP = meta?.recentGP > 0 ? meta.recentGP : (curGP > 0 && prevGP > 0 ? Math.round((curGP + prevGP) / 2) : effectiveGP);

    const trend = meta?.trend || (prevPPG && curPPG ? Math.round((curPPG - prevPPG) / prevPPG * 100) : 0);

    const age = p.age || (p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null);
    const isStarter = starters.has(pid);
    const isIR = reserve.has(pid);
    const isTaxi = taxi.has(pid);
    const section = isStarter ? 'starter' : isIR ? 'ir' : isTaxi ? 'taxi' : 'bench';

    const curve = typeof window.App?.getAgeCurve === 'function'
      ? window.App.getAgeCurve(pos)
      : { build: [22, 24], peak: (window.App.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
    const [pLo, pHi] = curve.peak;
    const declineHi = curve.decline[1];
    const peakRangeHi = Math.max(declineHi + 2, age ? age + 1 : declineHi + 2);
    const peakPct = age ? Math.max(0, Math.min(100, ((age - (pLo-4)) / (peakRangeHi - (pLo-4))) * 100)) : 50;
    const peakPhase = !age ? '\u2014' : age < pLo ? 'PRE' : age <= pHi ? 'PRIME' : age <= declineHi ? 'VET' : 'POST';
    const peakYrsLeft = age ? Math.max(0, pHi - age) : 0;
    const valueYrsLeft = age ? Math.max(0, declineHi - age) : 0;

    const _pidElite = typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(pid) : dhq >= 7000;
    // Recommendation for MY roster — shared getPlayerAction() with simplified
    // fallback. Free: rec stays null (the seeded fallback is a rec too), so
    // every consumer — Move column, row tints, Action lens, dossier call,
    // dynasty-read clause — degrades to raw-only even if a gate is missed.
    const pa = isPro && typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
    let rec = !isPro ? null : pa ? pa.label : (valueYrsLeft <= 0 ? 'Sell' : _pidElite && peakYrsLeft >= 3 ? 'Hold Core' : peakYrsLeft >= 4 && dhq < 4000 ? 'Stash' : 'Hold');
    // Action family code (SELL_HIGH vs SELL etc.) — the dossier's market-posture
    // sub-line keys off this so a "past value window" Sell never reads "sell high".
    let recAction = !isPro ? null : pa ? pa.action : (valueYrsLeft <= 0 ? 'SELL' : _pidElite && peakYrsLeft >= 3 ? 'CORE' : peakYrsLeft >= 4 && dhq < 4000 ? 'STASH' : 'HOLD');

    // GM Strategy nudge — a VISUAL flag over the engine verdict. getPlayerAction
    // is now strategy-aware and returns GM-steered sells with a 'GM plan:'
    // reason; detect those so the flag survives. The local gmTripsSell steer
    // remains only for the simplified fallback rec (engine not loaded).
    // Pro-only (Q8): it marks/steers the app's verdict, unlike passive accents.
    const gmIsUntouchable = gmUntouchable.has(String(pid));
    const gmEngineNudge = !!(pa && /^GM plan/i.test(pa.reason || '') && /SELL/i.test(pa.action || ''));
    const gmSellNudge = isPro && !gmIsUntouchable && (gmEngineNudge || (!/sell|buy|build|core/i.test(rec) && gmTripsSell({ pos, age })));
    if (gmSellNudge && !/sell/i.test(rec)) { rec = 'Sell'; recAction = 'SELL'; }
    const gmIsTarget = gmTargetPositions.has(String(pos));
    const gmIsSellPos = gmSellPositions.has(String(pos));

    return { pid, p, pos, dhq, age, curPPG, prevPPG, effectivePPG, effectiveGP, prevGP, durabilityGP, trend, isStarter, isIR, isTaxi, section, peakPhase, peakPct, peakYrsLeft, valueYrsLeft, rec, recAction, curGP, meta, injury: p.injury_status, gmIsUntouchable, gmSellNudge, gmIsTarget, gmIsSellPos };
  }).filter(Boolean);

  // Position-level PPG percentiles for color coding
  const posPPGs = {};
  rows.forEach(r => {
    if (!posPPGs[r.pos]) posPPGs[r.pos] = [];
    if (r.curPPG > 0) posPPGs[r.pos].push(r.curPPG);
  });
  const posP75 = {}, posP25 = {};
  Object.entries(posPPGs).forEach(([pos, vals]) => {
    vals.sort((a,b) => a-b);
    posP75[pos] = vals[Math.floor(vals.length * 0.75)] || 10;
    posP25[pos] = vals[Math.floor(vals.length * 0.25)] || 5;
  });

  // Cell background helpers (FM-style colored cells)
  const dhqBg = () => 'transparent';
  const dhqCol = v => v > 0 ? 'var(--white)' : 'var(--ov-7, rgba(255,255,255,0.25))';
  const ageBg = () => 'transparent';
  const ageCol = () => 'var(--silver)';
  const ppgBg = () => 'transparent';
  const trendBg = () => 'transparent';
  const posColors = window.App.POS_COLORS;

  // Drop candidate PIDs: non-starters with lowest DHQ (bottom 3 bench players)
  const dropCandidatePids = React.useMemo(() => {
    const benchPlayers = rows.filter(r => !r.isStarter && !r.isIR && !r.isTaxi)
      .sort((a, b) => a.dhq - b.dhq).slice(0, 3);
    return new Set(benchPlayers.map(r => r.pid));
  }, [rows]);

  // Dismissed drop alerts (persisted in localStorage per league)
  const [dismissedDrops, setDismissedDrops] = React.useState(() => {
    try {
      const leagueId = currentLeague?.id || currentLeague?.league_id || '';
      const stored = localStorage.getItem('wr_dismissed_drops_' + leagueId);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  // Rolling PPG window — persisted per-user. 'season' = full season-to-date,
  // 'l5' / 'l3' = last N games computed from window.App.computeRollingPPG
  // (populated once wr:weekly-points-loaded fires).
  const [ppgWindow, setPpgWindow] = React.useState(() => {
    try { return localStorage.getItem('wr_ppg_window') || 'season'; } catch { return 'season'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('wr_ppg_window', ppgWindow); } catch {}
  }, [ppgWindow]);
  const [rowDensity, setRowDensity] = React.useState(() => {
    try { return localStorage.getItem('wr_roster_density') || 'comfortable'; } catch { return 'comfortable'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('wr_roster_density', rowDensity); } catch {}
  }, [rowDensity]);
  const [rosterGroupMode, setRosterGroupMode] = React.useState(() => {
    try { return localStorage.getItem('wr_roster_group_mode') || 'position'; } catch { return 'position'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('wr_roster_group_mode', rosterGroupMode); } catch {}
  }, [rosterGroupMode]);
  // Free: the Action grouping lens organizes the board by verdict → Pro.
  // Clamp a persisted pick back to position (the option is also filtered out
  // of GROUP_MODES below). Safe pre-clamp render: free rows carry rec=null,
  // so the lens has no verdicts to reveal.
  React.useEffect(() => {
    if (!isPro && rosterGroupMode === 'action') setRosterGroupMode('position');
  }, [isPro, rosterGroupMode]);
  const [, forceAcquisitionRerender] = React.useState(0);
  // Force a re-render when weekly points become available so rolling-PPG cells update.
  const [, forcePpgRerender] = React.useState(0);
  React.useEffect(() => {
    const h = () => forcePpgRerender(n => n + 1);
    window.addEventListener('wr:weekly-points-loaded', h);
    return () => window.removeEventListener('wr:weekly-points-loaded', h);
  }, []);

  // Dynasty Read AI — paid-tier web-search news synthesis, fired only for the
  // currently expanded row (one open at a time), template-first. Result is keyed
  // by pid; the shared weekly cache means repeat opens are an instant hit.
  const [aiReads, setAiReads] = React.useState({});
  // The clamp+fade+"Full read" disclosure that used to live here was extracted
  // to the shared WR.ClampedRead (js/components/wr-primitives.js); it measures
  // its own overflow and remounts (collapsed) per expanded row.
  // Track the roster board's VISIBLE width so the expand card pins to the viewport
  // instead of stretching to the full (horizontally-scrolling) table width.
  const boardScrollRef = React.useRef(null);
  const [boardWidth, setBoardWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    const measure = () => setBoardWidth(el.clientWidth);
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  React.useEffect(() => {
    const pid = expandedPid;
    // Free: never auto-fire dynasty_read on row expand — BYOK routes (S.apiKey
    // → callClaude) bypass the OD.callAI tripwire, so the trigger itself must
    // gate. The seeded buildDynastyRead template below still renders.
    if (!isPro) return;
    if (!pid || aiReads[pid] || typeof window.fetchDynastyRead !== 'function') return;
    const p = playersData?.[pid];
    if (!p) return;
    let alive = true;
    const nfl = window.S?.nflState || {};
    const ctx = {
      pid,
      name: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
      team: p.team || '',
      pos: (window.App?.normPos ? window.App.normPos(p.position) : p.position) || '',
      age: p.age || null,
      season: nfl.season || '',
      week: nfl.display_week || nfl.week || 0,
    };
    // Debounce: only fetch after the row stays expanded briefly, so quickly
    // expanding/collapsing rows doesn't fire a scouting call per glance.
    const timer = setTimeout(() => {
      window.fetchDynastyRead(ctx, { fallback: '' }).then((txt) => {
        if (alive && txt) setAiReads(prev => (prev[pid] ? prev : { ...prev, [pid]: txt }));
      });
    }, 600);
    return () => { alive = false; clearTimeout(timer); };
  }, [expandedPid]);
  const dismissDrop = React.useCallback((pid) => {
    const playerName = window.App?.playersData?.[pid]?.full_name || pid;
    setDismissedDrops(prev => {
      const next = new Set(prev);
      next.add(pid);
      try {
        const leagueId = currentLeague?.id || currentLeague?.league_id || '';
        localStorage.setItem('wr_dismissed_drops_' + leagueId, JSON.stringify([...next]));
      } catch {}
      return next;
    });
    window.wrLogAction?.('\uD83D\uDEAB', 'Dismissed drop alert for ' + playerName, 'roster', { players: [{ name: playerName, pid: pid }], actionType: 'dismiss-drop' });
  }, [currentLeague]);

  const GROUP_MODES = [
    { key: 'position', label: 'Position' },
    { key: 'slot', label: 'Slot' },
    { key: 'action', label: 'Action' },
    { key: 'age', label: 'Age' },
    { key: 'peak', label: 'Peak' },
    { key: 'none', label: 'None' },
  ].filter(g => isPro || g.key !== 'action'); // Action lens = verdict grouping → Pro
  const activeGroupModeLabel = GROUP_MODES.find(g => g.key === rosterGroupMode)?.label || 'Position';
  const slotOrder = { starter: 0, bench: 1, taxi: 2, ir: 3 };
  const recGroup = (rec) => /sell/i.test(rec || '') ? 'Sell'
    : /buy|build|core/i.test(rec || '') ? 'Build'
    : /stash/i.test(rec || '') ? 'Stash'
    : 'Hold';
  const getAgeBand = (r) => !r.age ? 'Unknown' : r.age <= 24 ? 'Youth' : r.age <= 29 ? 'Prime' : r.age <= 32 ? 'Veteran' : 'Post';
  const getRowGroupKey = (r) => {
    if (rosterGroupMode === 'none') return 'all';
    if (rosterGroupMode === 'slot') return r.section;
    if (rosterGroupMode === 'action') return recGroup(r.rec).toLowerCase();
    if (rosterGroupMode === 'age') return getAgeBand(r).toLowerCase();
    if (rosterGroupMode === 'peak') return (r.peakPhase || 'unknown').toLowerCase();
    return r.pos || '?';
  };
  const getRowGroupLabel = (r) => {
    if (rosterGroupMode === 'slot') return r.section === 'starter' ? 'Starters' : r.section === 'ir' ? 'IR' : r.section === 'taxi' ? 'Taxi' : 'Bench';
    if (rosterGroupMode === 'action') return recGroup(r.rec);
    if (rosterGroupMode === 'age') return getAgeBand(r);
    if (rosterGroupMode === 'peak') return r.peakPhase || 'Unknown';
    return r.pos || '?';
  };
  const getRowGroupRank = (r) => {
    const posRank = {QB:0,RB:1,WR:2,TE:3,K:4,DL:5,LB:6,DB:7};
    const actionRank = { build: 0, hold: 1, stash: 2, sell: 3 };
    const ageRank = { youth: 0, prime: 1, veteran: 2, post: 3, unknown: 4 };
    const peakRank = { pre: 0, prime: 1, vet: 2, post: 3, unknown: 4 };
    if (rosterGroupMode === 'slot') return slotOrder[r.section] ?? 9;
    if (rosterGroupMode === 'action') return actionRank[getRowGroupKey(r)] ?? 9;
    if (rosterGroupMode === 'age') return ageRank[getRowGroupKey(r)] ?? 9;
    if (rosterGroupMode === 'peak') return peakRank[getRowGroupKey(r)] ?? 9;
    if (rosterGroupMode === 'none') return 0;
    return posRank[r.pos] ?? 99;
  };
  // Group dividers use the single gold accent for structure — no per-group rainbow.
  const getRowGroupColor = () => 'var(--gold)';

  const filtered = filteredAndSortedRows(rows);
  const filteredPosCounts = filtered.reduce((acc, r) => {
    const key = getRowGroupKey(r);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const rosterTagMeta = {
    trade: { bg: 'rgba(240,165,0,0.13)', col: 'var(--warn)', lbl: 'Trade' },
    cut: { bg: 'rgba(231,76,60,0.13)', col: 'var(--bad)', lbl: 'Cut' },
    untouchable: { bg: 'rgba(46,204,113,0.13)', col: 'var(--good)', lbl: 'Core' },
    watch: { bg: 'rgba(52,152,219,0.13)', col: 'var(--k-3498db, #3498db)', lbl: 'Watch' },
  };
  const slotTagMeta = {
    starter: { bg: 'var(--ov-3, rgba(255,255,255,0.045))', col: 'var(--white)', lbl: 'STR' },
    bench: { bg: 'var(--ov-2, rgba(255,255,255,0.03))', col: 'var(--silver)', lbl: 'BN' },
    taxi: { bg: 'var(--ov-2, rgba(255,255,255,0.03))', col: 'var(--silver)', lbl: 'TAX' },
    ir: { bg: 'var(--ov-2, rgba(255,255,255,0.03))', col: 'var(--silver)', lbl: 'IR' },
  };
  const inlineTag = (cfg, key) => cfg ? (
    <span key={key} style={{
      fontSize: 'var(--text-micro, 0.6875rem)',
      padding: '2px 5px',
      borderRadius: '4px',
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.col,
      border: '1px solid ' + wrAlpha(cfg.col, '33'),
      flexShrink: 0,
      lineHeight: 1,
      letterSpacing: '0.035em',
      textTransform: 'uppercase',
    }}>{cfg.lbl}</span>
  ) : null;

  const controlBtn = (active) => ({
    padding: '6px 11px',
    fontSize: '0.72rem',
    fontWeight: active ? 800 : 650,
    fontFamily: 'var(--font-body)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: active ? 'var(--gold)' : 'var(--ov-3, rgba(255,255,255,0.045))',
    color: active ? 'var(--black)' : 'var(--silver)',
    border: '1px solid ' + (active ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.09))'),
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  // Compact dropdown used across the roster toolbar (mirrors free-agency's rkSelectStyle).
  const rosterSelectStyle = (active) => ({
    padding: '4px 6px',
    minHeight: '44px',
    fontSize: '0.72rem',
    fontFamily: 'var(--font-body)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: active ? 'var(--acc-fill2, rgba(212,175,55,0.13))' : 'var(--ov-3, rgba(255,255,255,0.045))',
    color: active ? 'var(--gold)' : 'var(--silver)',
    border: '1px solid ' + (active ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.1))'),
    borderRadius: '6px',
    cursor: 'pointer',
    outline: 'none',
    minWidth: 0,
  });
  const groupLabelStyle = { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, whiteSpace: 'nowrap' };
  const sameColumnSet = (a, b) => a.length === b.length && a.every((key, idx) => key === b[idx]);
  const activePresetKey = Object.entries(COLUMN_PRESETS).find(([, cols]) => sameColumnSet(cols, visibleCols))?.[0] || 'custom';
  const activePresetMeta = COLUMN_PRESET_META[activePresetKey] || { label: 'Custom', tone: visibleCols.length + ' fields' };
  const isDeepData = activePresetKey === 'full';
  // Shared viewport seam (js/shared/viewport.js) — one debounced app-wide
  // listener; thresholds below (560/820/834/1023) are unchanged.
  const _vp = window.WR.useViewport();
  const rosterViewportWidth = _vp.width;
  const _isPhone = !!_vp.isPhone;
  const isNarrowRoster = rosterViewportWidth <= 560;
  const isTabletRoster = rosterViewportWidth > 560 && rosterViewportWidth <= 1023;
  // iPad/phone: collapse the Scope/View/PPG/Rows/Group control stack behind a
  // single "Filters" bar so it stops eating ~400px above the roster table.
  const isCompactRoster = rosterViewportWidth <= 1023;
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false); // phone "review flagged players" sheet
  const [reviewStripOpen, setReviewStripOpen] = React.useState(false); // desktop/iPad flagged-players triage strip (owner-approved iPad pass)
  // Manual verdict/tag override (owner ask): one picker sets the player's
  // call, rolling the old TRADE BLOCK/CUT/UNTOUCHABLE/WATCH tags in with
  // Hold/Stash/Sell/Drop. Runs on ALL versions. The 4 tag-values sync to the
  // shared window._playerTags store so existing consumers (untouchable
  // protection, trade finder, the desktop row tag badge) keep working; the
  // verdict-values live in verdictOverrides. Per-league localStorage.
  const VERDICT_OPTIONS = ['Untouchable', 'Hold', 'Watch', 'Stash', 'Trade Block', 'Sell', 'Cut', 'Drop'];
  const _LABEL_TO_TAG = { 'Trade Block': 'trade', 'Cut': 'cut', 'Untouchable': 'untouchable', 'Watch': 'watch' };
  const _TAG_TO_LABEL = { trade: 'Trade Block', cut: 'Cut', untouchable: 'Untouchable', watch: 'Watch' };
  const [verdictOverrides, setVerdictOverrides] = React.useState(() => {
    try { const lid = currentLeague?.id || currentLeague?.league_id || ''; return JSON.parse(localStorage.getItem('dhq_roster_verdict_v1:' + lid) || '{}') || {}; } catch (e) { return {}; }
  });
  const [tagEditPid, setTagEditPid] = React.useState(null); // which player's verdict picker is open
  const setPlayerVerdict = (pid, v) => {
    // Sync the shared player-tag store for the 4 tag-values (else clear it).
    try {
      const lid = currentLeague?.id || currentLeague?.league_id || '';
      const tags = window._playerTags || {};
      const tag = v ? _LABEL_TO_TAG[v] : null;
      if (tag) tags[pid] = tag; else delete tags[pid];
      window._playerTags = { ...tags };
      if (window.OD?.savePlayerTags) window.OD.savePlayerTags(lid, tags);
    } catch (e) {}
    setVerdictOverrides(prev => {
      const next = { ...prev };
      if (v) next[pid] = v; else delete next[pid];
      try { const lid = currentLeague?.id || currentLeague?.league_id || ''; localStorage.setItem('dhq_roster_verdict_v1:' + lid, JSON.stringify(next)); } catch (e) {}
      return next;
    });
    try { setTimeRecomputeTs(Date.now()); } catch (e) {}
  };
  // Effective call: manual override → existing player-tag → engine r.rec.
  const _effRec = (r) => verdictOverrides[r.pid] || _TAG_TO_LABEL[window._playerTags && window._playerTags[r.pid]] || r.rec;
  // The user's own call for a player (manual verdict or synced tag), IGNORING
  // the engine's r.rec — null when they haven't weighed in.
  const _manualCall = (r) => verdictOverrides[r.pid] || _TAG_TO_LABEL[window._playerTags && window._playerTags[r.pid]] || null;
  // Owner ask 2026-07-12: the Review-roster drop list is a to-do of the app's
  // drop flags. Once the user tags a flagged player as anything that ISN'T
  // Drop/Cut (Hold/Stash/Untouchable/Watch…), they've decided to keep him —
  // the flag is resolved, so he leaves the list. No manual call = flag stands.
  // (SELL CALLS already self-resolves because its filter reads _effRec.)
  const _isActiveDrop = (r) => {
    if (!isPro || !dropCandidatePids.has(r.pid) || dismissedDrops.has(r.pid)) return false;
    const manual = _manualCall(r);
    return !(manual && !/drop|cut/i.test(manual));
  };
  // Call → accent color, shared by chip + badge + picker + desktop action col.
  const _recColor = (rec) => {
    const s = String(rec || '');
    if (/untouchable/i.test(s)) return 'var(--good)';
    if (/watch/i.test(s)) return 'var(--k-3498db, #3498db)';
    if (/trade.?block/i.test(s)) return 'var(--warn)';
    if (/drop|cut/i.test(s)) return 'var(--bad)';
    if (/sell/i.test(s)) return 'var(--warn)';
    if (/buy|build|core/i.test(s)) return 'var(--good)';
    if (/stash/i.test(s)) return 'var(--k-3498db, #3498db)';
    return 'var(--gold)';
  };
  // Filtering visibleCols on ROSTER_COLUMNS here is what keeps a persisted
  // 'action' pref from rendering for free (its def is deleted above).
  // (The old ≤560 3-col survival set is deleted: ≤560 is always inside the
  // phone tier (<768) — the AssetRow card list supersedes it, and Deep
  // Data keeps the full column set inside its scoped scroll container.)
  const rosterTableCols = visibleCols.filter(key => ROSTER_COLUMNS[key]);
  const visibleColGroupStarts = new Set();
  rosterTableCols.forEach((key, idx) => {
    const prev = rosterTableCols[idx - 1];
    if (idx > 0 && ROSTER_COLUMNS[key]?.group !== ROSTER_COLUMNS[prev]?.group) visibleColGroupStarts.add(key);
  });
  const isCompactRows = rowDensity === 'compact' || isNarrowRoster;
  const rowHeight = isCompactRows ? 38 : 46;
  const avatarSize = isNarrowRoster ? 22 : (isCompactRows ? 26 : 30);
  const playerNameSize = isNarrowRoster ? '0.74rem' : (isCompactRows ? '0.78rem' : '0.84rem');
  const columnGroups = ['core', 'dynasty', 'stats', 'scout'].map(group => ({
    group,
    columns: Object.entries(ROSTER_COLUMNS).filter(([, col]) => col.group === group),
  })).filter(g => g.columns.length > 0);
  const playerColWidth = isNarrowRoster ? 156 : isTabletRoster ? 220 : 292;
  const visibleDataWidth = rosterTableCols.reduce((sum, key) => sum + parseInt(ROSTER_COLUMNS[key]?.width || '0', 10), 0);
  const tableMinWidth = playerColWidth + visibleDataWidth;
  const setCustomColumns = (updater) => {
    setVisibleCols(prev => typeof updater === 'function' ? updater(prev) : updater);
    setColPreset('custom');
  };
  const moveVisibleColumn = (key, delta) => {
    setCustomColumns(prev => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const nextIdx = Math.max(0, Math.min(prev.length - 1, idx + delta));
      if (nextIdx === idx) return prev;
      const next = prev.slice();
      const [item] = next.splice(idx, 1);
      next.splice(nextIdx, 0, item);
      return next;
    });
  };
  const removeVisibleColumn = (key) => setCustomColumns(prev => prev.filter(c => c !== key));
  const addVisibleColumn = (key) => setCustomColumns(prev => prev.includes(key) ? prev : [...prev, key]);
  const activeColumnOrder = visibleCols.filter(key => ROSTER_COLUMNS[key]);
  const inactiveColumnCount = Object.keys(ROSTER_COLUMNS).filter(key => !visibleCols.includes(key)).length;
  const formatHeight = h => h ? Math.floor(h / 12) + "'" + h % 12 + '"' : null;
  const _slotLabel = r => r.section === 'starter' ? 'Starter' : r.section === 'ir' ? 'IR' : r.section === 'taxi' ? 'Taxi' : 'Bench';
  const getLeaguePositionRank = r => {
    const allAtPos = (currentLeague.rosters || []).flatMap(ros => (ros.players || []).filter(pid => {
      const pp = playersData[pid];
      return pp && (normPos(pp.position) === r.pos);
    })).map(pid => ({ pid, dhq: window.App?.LI?.playerScores?.[pid] || 0 })).sort((a, b) => b.dhq - a.dhq);
    const rank = allAtPos.findIndex(x => x.pid === r.pid) + 1;
    return rank > 0 ? rank : null;
  };
  const dynastyTierLabel = r => (typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(r.pid) : r.dhq >= 7000) ? 'elite asset'
    : r.dhq >= 4000 ? 'starter-grade asset'
    : r.dhq >= 2000 ? 'depth asset'
    : 'stash-level asset';
  const buildDynastyRead = r => {
    const rank = getLeaguePositionRank(r);
    // Unscored players get a neutral opener — no tier verdict fabricated from a missing score.
    const valueLine = r.dhq > 0
      ? r.dhq.toLocaleString() + ' ' + valueShortLabel + (rank ? ' and ' + r.pos + rank + ' in this league' : '') + ' makes him a ' + dynastyTierLabel(r) + '.'
      : 'No ' + valueShortLabel + ' score yet — judge on role and production.';
    const productionLine = r.effectivePPG ? r.effectivePPG + ' PPG across ' + (r.effectiveGP || 0) + ((r.effectiveGP || 0) === 1 ? ' game' : ' games') : 'No stable recent production sample';
    const ageLine = r.age ? 'Age ' + r.age + ' is ' + (r.peakPhase === 'PRE' ? 'before the prime window' : r.peakPhase === 'PRIME' ? 'inside the prime window' : r.peakPhase === 'VET' ? 'in the veteran value band' : 'past the normal value window') : 'Age window unknown';
    const trendLine = r.trend >= 15 ? 'production is rising' : r.trend <= -15 ? 'production is sliding' : 'production is steady';
    // Free: the "roster call is X" clause is a verdict — the raw restatement
    // (value, tier-from-value, production, age window, trend) stays.
    const recClause = isPro
      ? ', so the current roster call is ' + String(r.rec || 'Hold').toLowerCase() + ' while ' + trendLine
      : ', and ' + trendLine;
    return valueLine + ' ' + productionLine + '; ' + ageLine + recClause + '.';
  };

  // renderCell — renders each data cell with FM-style coloring
  function renderCell(colKey, r) {
    const col = ROSTER_COLUMNS[colKey];
    const isGroupStart = visibleColGroupStarts.has(colKey);
    const base = { width: col.width, minWidth: col.width, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isCompactRows ? '0.73rem' : '0.78rem', padding: '0 5px', borderLeft: isGroupStart ? '1px solid var(--acc-fill2, rgba(212,175,55,0.12))' : '1px solid var(--ov-1, rgba(255,255,255,0.024))', color: 'rgba(235,235,240,0.78)', lineHeight: 1.1 };

    switch(colKey) {
      case 'proj': {
        const p = projFor(r.pid);
        if (!p) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: 0.45 }}>{'—'}</span></div>;
        if (!p.available) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--warn)', opacity: 0.85, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.03em' }}>{p.injuryStatus || 'OUT'}</span></div>;
        // Proj = the straight weekly projection (median) — the number the owner
        // sees in Sleeper. NOT the GM-mode floor/ceiling (win-now optimizes for
        // floor, which read low here); those bands stay inside start/sit only.
        const pts = (p.points && (p.points.median != null ? p.points.median : p.points.mean)) || 0;
        const isStart = !!(weeklyLineup && weeklyLineup.starterSet.has(String(r.pid)));
        const g = p.matchupGrade;
        // Free: raw projected pts keep rendering; START/SIT (optimizer output)
        // is the Pro line. The bare matchup-grade letter is not surfaced in the
        // column (it read as a stray "c"); it stays in the hover tooltip only.
        return <div key={colKey} style={{...base, flexDirection: 'column', gap: '0px'}} title={'Projected ' + pts.toFixed(1) + ' pts' + (isPro ? ' · matchup ' + g : '') + (p.opponent && p.opponent.abbr ? ' vs ' + p.opponent.abbr : '')}>
          <span style={{ color: 'var(--white)', fontWeight: 600, fontSize: '0.76rem', fontFamily: 'var(--font-body)' }}>{pts > 0 ? pts.toFixed(1) : '—'}</span>
          {isPro && wkVerdict && <span style={{ fontSize: '0.54rem', fontWeight: 700, letterSpacing: '0.03em', color: isStart ? 'var(--good)' : 'var(--silver)' }}>{isStart ? 'START' : 'SIT'}</span>}
        </div>;
      }
      case 'hi': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return <div key={colKey} style={{...base}}><span style={{ color: fs ? 'var(--good, #2ecc71)' : 'var(--silver)', opacity: fs ? 1 : 0.45, fontWeight: 550 }}>{fs ? fs.high.toFixed(1) : '—'}</span></div>; }
      case 'lo': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: fs ? 0.85 : 0.45 }}>{fs ? fs.low.toFixed(1) : '—'}</span></div>; }
      case 'pos': return <div key={colKey} style={{...base}}><span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 550, color: 'var(--silver)' }}>{window.App?.posLabel?.(r.pos) || (r.pos === 'DEF' ? 'D/ST' : r.pos)}</span></div>;
      case 'age': return <div key={colKey} style={{...base, background: ageBg(r.age, r.pos)}}><span style={{ color: ageCol(r.age, r.pos), fontWeight: 550 }}>{r.age||'\u2014'}</span></div>;
      case 'dhq': {
        // Redraft \u2192 show projected rest-of-season POINTS (tier-colored by the
        // scaled value r.dhq). Dynasty/keeper \u2192 the scaled value as before.
        const rosPts = (resolvedLeagueSkin?.type === 'redraft' && window.App?.PlayerValue?.getRosPoints) ? window.App.PlayerValue.getRosPoints(r.pid) : null;
        const showRos = rosPts != null;
        const disp = showRos ? (rosPts > 0 ? Math.round(rosPts).toLocaleString() : '\u2014') : (r.dhq > 0 ? r.dhq.toLocaleString() : '\u2014');
        const title = showRos ? ('\u2248 ' + Math.round(rosPts) + ' projected pts rest-of-season') : '';
        return <div key={colKey} style={{...base, background: dhqBg(r.dhq)}} title={title}><span style={{ color: dhqCol(r.dhq), fontWeight: 600, fontFamily: 'var(--font-body)', fontSize: '0.78rem' }}>{disp}</span></div>;
      }
      case 'ppg': {
        // Rolling PPG override — swap in last-N-games PPG when user toggled the window.
        // If a window is active but weekly data isn't ready for this player, fall back
        // to seasonal and mark the cell "· Szn" so the user knows it's not rolling.
        let shown = r.effectivePPG;
        let marker = r.curPPG === 0 && r.prevPPG > 0 ? '*' : '';
        if (ppgWindow !== 'season') {
          const n = ppgWindow === 'l3' ? 3 : 5;
          const rolling = typeof window.App?.computeRollingPPG === 'function'
            ? window.App.computeRollingPPG(r.pid, n)
            : 0;
          if (rolling > 0) { shown = rolling; marker = ' · L' + n; }
          else { marker = ' · Szn'; }
        }
        return <div key={colKey} style={{...base, background: ppgBg(shown, r.pos)}}><span style={{ color: 'var(--silver)', fontWeight: 500 }}>{shown > 0 ? shown : '\u2014'}{marker}</span></div>;
      }
      case 'prev': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: 0.6 }}>{r.prevPPG > 0 ? r.prevPPG : '\u2014'}</span></div>;
      case 'trend': {
        const trendBars = (() => {
          const t = r.trend || 0;
          const up = t > 0;
          const color = 'var(--silver)';
          const heights = up ? [4, 6, 8, 11, 14] : t < 0 ? [14, 11, 8, 6, 4] : [8, 9, 10, 9, 8];
          return React.createElement('div', { className: 'wr-spark' }, ...heights.map((h, i) => React.createElement('div', { key: i, className: 'wr-spark-bar', style: { height: h + 'px', background: color } })));
        })();
        return <div key={colKey} style={{...base, background: trendBg(r.trend), flexDirection: 'column', gap: '1px'}}>
          <span style={{ color: 'var(--silver)', fontWeight: 550, fontSize: '0.7rem' }}>{r.trend>0?'+'+r.trend+'%':r.trend<0?r.trend+'%':'\u2014'}</span>
          {trendBars}
        </div>;
      }
		      case 'peak': return <div key={colKey} style={{...base, flexDirection: 'column', gap: '1px'}}>
		        <span style={{ fontSize: '0.7rem', fontWeight: 550, color: 'var(--silver)' }}>{r.peakPhase}</span>
        <div style={{ width: '30px', height: '3px', borderRadius: '1px', background: 'var(--ov-4, rgba(255,255,255,0.06))', overflow: 'hidden', position: 'relative' }}>
          <div style={{ position:'absolute',left:r.peakPct+'%',top:'-1px',width:'2px',height:'5px',background:'var(--silver)',borderRadius:'1px' }}></div>
        </div>
      </div>;
      case 'action': {
        const ann = getPlayerAnnotation(r.pid);
        const gmNudgeTitle = r.gmSellNudge ? 'Nudged to Sell by GM Strategy (position/age trips a sell rule)' : '';
        // Retired / no-longer-active players (Sleeper active:false) can't help
        // you — the move is simply to cut them.
        const isRetired = r.p && r.p.active === false;
        if (isRetired) {
          return <div key={colKey} style={{...base, flexDirection:'column', gap:'2px', alignItems:'center'}} title="Player is no longer active in the NFL — cut to free the roster spot">
            <span style={{ fontSize:'var(--text-micro, 0.6875rem)', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.04em', color:'var(--bad)' }}>Cut</span>
          </div>;
        }
        const _ar = _effRec(r);
        const _amanual = !!(verdictOverrides[r.pid] || (window._playerTags && window._playerTags[r.pid]));
        return <div key={colKey} style={{...base, flexDirection:'column', gap:'2px', alignItems:'center'}} title={_amanual ? 'Your call — set in the player card' : (gmNudgeTitle || ann?.text || '')}>
          <span style={{ fontSize:'var(--text-micro, 0.6875rem)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.03em',color: _recColor(_ar) }}>{_ar}</span>
          {_amanual ? <span style={{ fontSize: '0.56rem', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.05em', opacity: 0.85, lineHeight: 1 }}>YOU</span> : (r.gmSellNudge && <span style={{ fontSize: '0.56rem', fontWeight: 800, color: 'var(--warn)', letterSpacing: '0.05em', opacity: 0.85, lineHeight: 1 }}>GM</span>)}
        </div>;
      }
      case 'gp': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.74rem' }}>{r.effectiveGP > 0 ? r.effectiveGP : '\u2014'}{r.curGP === 0 && r.prevGP > 0 ? '*' : ''}</span></div>;
      case 'durability': { const gpForDur = r.durabilityGP || 0; return <div key={colKey} style={{...base}} title={'Avg GP: ' + gpForDur + '/17'}><div style={{ width:'24px',height:'4px',borderRadius:'2px',background:'var(--ov-4, rgba(255,255,255,0.06))',overflow:'hidden' }}><div style={{ width:Math.min(100,(gpForDur/17)*100)+'%',height:'100%',background:'var(--silver)',opacity:0.7,borderRadius:'2px' }}></div></div></div>; }
      case 'yrsExp': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)' }}>{r.p.years_exp ?? '\u2014'}</span></div>;
      case 'college': return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.p.college || '\u2014'}</span></div>;
      case 'nflDraft': { const dr = r.p.draft_round; const dp = r.p.draft_pick; const dy = r.p.draft_year; const dRound = dr || (dp ? Math.ceil(dp / 32) : null); const draftLabel = dRound ? (dy ? "'" + String(dy).slice(2) + ' ' : '') + 'Rd ' + dRound + (dp ? '.' + ((dp - 1) % 32 + 1) : '') : (r.p.undrafted === true || (r.p.years_exp > 0 && !dp && !dr) ? 'UDFA' : '\u2014'); return <div key={colKey} style={{...base}}><span style={{ color: dRound ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))', fontSize: '0.74rem' }}>{draftLabel}</span></div>; }
      case 'posRankLg': {
        const rank = getLeaguePositionRank(r);
        return <div key={colKey} style={{...base}}><span style={{ color: rank && rank<=3?'var(--white)':'var(--silver)', fontWeight: 450 }}>{rank ? '#'+rank : '\u2014'}</span></div>;
      }
      case 'posRankNfl': {
        const meta = r.meta;
        return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)' }}>{meta?.fcRank ? '#'+meta.fcRank : '\u2014'}</span></div>;
      }
      case 'starterSzn': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontWeight: 500 }}>{r.meta?.starterSeasons ?? '\u2014'}</span></div>;
      case 'height': {
        const h = r.p.height;
        return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem' }}>{h ? Math.floor(h/12)+"'"+h%12+'"' : '\u2014'}</span></div>;
      }
      case 'weight': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem' }}>{r.p.weight || '\u2014'}</span></div>;
      case 'depthChart': return <div key={colKey} style={{...base}}><span style={{ color: r.p.depth_chart_order != null ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))', fontSize: '0.72rem' }}>{r.p.depth_chart_order != null ? r.pos + (r.p.depth_chart_order + 1) : (r.section === 'ir' ? 'IR' : (!r.p.team || r.p.team === 'FA') ? 'FA' : 'N/A')}</span></div>;
      case 'slot': return <div key={colKey} style={{...base}}><span style={{ fontSize:'0.76rem',color:'var(--silver)',opacity:0.65,textTransform:'uppercase' }}>{r.section==='starter'?'STR':r.section==='ir'?'IR':r.section==='taxi'?'TAX':'BN'}</span></div>;
      case 'acquired': {
        const acq = getAcquisitionInfo(r.pid, myRoster?.roster_id);
        const col = 'var(--silver)';
        const methods = ['Drafted', 'Traded', 'Waiver', 'FA', 'Original'];
        return <div key={colKey} style={{...base}}><span
          style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, color: col, padding: '1px 5px', borderRadius: '3px', border: `1px solid ${col}40`, background: `${col}10`, cursor: 'pointer' }}
          title="Click to change acquisition method"
          onClick={e => {
            e.stopPropagation();
            const curIdx = methods.indexOf(acq.method);
            const next = methods[(curIdx + 1) % methods.length];
            try {
              const overrides = JSON.parse(localStorage.getItem('wr_acquired_overrides') || '{}');
              overrides[r.pid] = { method: next, date: acq.date || '\u2014', cost: '' };
              localStorage.setItem('wr_acquired_overrides', JSON.stringify(overrides));
              forceAcquisitionRerender(n => n + 1);
            } catch {}
          }}
        >{acq.method}{acq.cost ? ' ' + acq.cost : ''}</span></div>;
      }
      case 'acquiredDate': {
        const acq = getAcquisitionInfo(r.pid, myRoster?.roster_id);
        const show = acq.date && acq.date !== '\u2014' ? acq.date : '';
        return <div key={colKey} style={{...base}}><span style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.8 }}>{show || '\u2014'}</span></div>;
      }
      case 'sos': {
        const sosMod = window.App?.SOS;
        if (!sosMod?.ready) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))', fontSize: '0.72rem' }}>{'\u2014'}</span></div>;
        const team = r.p?.team;
        if (!team || team === 'FA') return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))' }}>{'\u2014'}</span></div>;
        const sos = sosMod.getPlayerSOS(r.pid, r.pos, team);
        if (!sos) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))' }}>{'\u2014'}</span></div>;
        return <div key={colKey} style={{...base, flexDirection: 'column', gap: '1px'}} title={sos.label + ' schedule (' + sos.avgRank + '/32)'}>
          <span style={{ color: 'var(--silver)', fontWeight: 600, fontSize: '0.82rem', fontFamily: 'var(--font-body)' }}>{sos.avgRank}</span>
          <span style={{ color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.7 }}>{sos.label.toUpperCase()}</span>
        </div>;
      }
      case 'rkSlot': case 'rkTeam': case 'rkRank': case 'rkTier': case 'rkProfile': {
        const rf = window.App?.RookieFields?.fields?.(prospectForRow(r)) || null;
        const dp = draftCapFor(r.pid);
        const dim = <span style={{ color: 'var(--ov-8, rgba(255,255,255,0.3))' }}>{'\u2014'}</span>;
        if (colKey === 'rkSlot') {
          // Prospect slot ("1.05") wins; vets show round + overall ("R2 #47")
          // with the class year underneath, or UDFA.
          const slotTxt = rf?.draftSlot || (dp ? (dp.round > 0 ? 'R' + dp.round + ' #' + dp.overall : 'UDFA') : null);
          if (!slotTxt) return <div key={colKey} style={{...base}}>{dim}</div>;
          const yr = dp?.year ? '\u2019' + String(dp.year).slice(2) : '';
          const tip = dp ? (dp.round > 0 ? dp.year + ' draft \u2014 round ' + dp.round + ', pick ' + dp.overall + ' overall' + (dp.team ? ' (' + dp.team + ')' : '') : 'Undrafted free agent' + (dp.year ? ' \u2014 entered ' + dp.year : '')) : slotTxt;
          return <div key={colKey} title={tip} style={{...base, flexDirection: 'column', gap: '1px'}}>
            <span style={{ color: 'var(--silver)', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{slotTxt}</span>
            {yr ? <span style={{ color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.6 }}>{yr}</span> : null}
          </div>;
        }
        if (colKey === 'rkTeam') {
          const tm = rf?.nflTeam || dp?.team || '';
          return <div key={colKey} style={{...base}}>{tm ? <span style={{ color: 'var(--silver)' }}>{tm}</span> : dim}</div>;
        }
        if (colKey === 'rkProfile') {
          // Rookies carry the full Ht \u00b7 Wt \u00b7 40 scouting line; vets compose
          // Ht \u00b7 Wt from the Sleeper record.
          const prof = rf?.profile || [formatHeight(r.p.height), r.p.weight ? r.p.weight + ' lb' : null].filter(Boolean).join(' \u00b7 ');
          return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}>{prof ? <span title={prof} style={{ color: 'var(--silver)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prof}</span> : dim}</div>;
        }
        if (!rf) return <div key={colKey} style={{...base}}>{dim}</div>;
        if (colKey === 'rkRank') return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>{rf.consensusRank != null ? rf.consensusRank : '\u2014'}</span></div>;
        return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}><span style={{ color: 'var(--silver)', fontWeight: 600, fontSize: '0.72rem' }}>{rf.tierLabel || '\u2014'}</span></div>;
      }
      default: return <div key={colKey} style={{...base}}>{'\u2014'}</div>;
    }
  }

  // ── Expand-card dossier body (identity → signals → dynasty read → age
  // curve → career stats → actions) — HOISTED VERBATIM from the desktop
  // board's inline expand card so the phone AssetRow expansion renders the
  // identical dossier. The desktop boardWidth pinning wrapper stays inside
  // _renderRosterBoard below; the phone card path never mounts it.
  const renderExpandBody = (r) => (<React.Fragment>
                  {/* ── Dossier (02 "clear hierarchy"): identity + roster call → signals strip → read + signals → curve → stats ── */}
                  {(() => {
                    const tier =(typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(r.pid) : r.dhq >= 7000) ? 'Elite' : r.dhq >= 4000 ? 'Starter' : r.dhq >= 2000 ? 'Depth' : 'Stash';
                    const field = (currentLeague.rosters || []).flatMap(ros => (ros.players || []).filter(pid2 => normPos(playersData[pid2]?.position) === r.pos)).map(pid2 => ({ pid: pid2, dhq: window.App?.LI?.playerScores?.[pid2] || 0 })).filter(x => x.dhq > 0).sort((a, b) => b.dhq - a.dhq);
                    const rank = field.findIndex(x => x.pid === r.pid) + 1;
                    const narrow = rosterViewportWidth <= 834;
                    const posLbl = window.App?.posLabel?.(r.pos) || (r.pos === 'DEF' ? 'D/ST' : r.pos);
                    const chip = (bg, col) => ({ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: bg, color: col, whiteSpace: 'nowrap' });
                    const primeEnd = r.peakYrsLeft > 0 && r.age ? r.age + r.peakYrsLeft : null;
                    const sigWindow = (r.peakPhase || '—') + (primeEnd ? ' · thru ' + primeEnd : r.valueYrsLeft > 0 ? ' · ~' + r.valueYrsLeft + 'yr value' : '');
                    const sigRisk = r.injury ? r.injury : (r.durabilityGP && r.durabilityGP < 13 ? '~' + r.durabilityGP + ' GP/yr' : 'no current flags');
                    const sigFloor = r.isStarter ? 'weekly starter' : (r.p.depth_chart_order != null && r.p.depth_chart_order <= 1 ? 'rotation role' : 'bench / depth');
                    const sigCeiling = r.trend >= 10 ? 'trending up' : (tier === 'Elite' || tier === 'Starter') ? 'proven ' + tier.toLowerCase() : r.peakPhase === 'PRE' ? 'developing' : 'limited upside';
                    const sigRow = (label, val, last) =>(<div style={{ display: 'flex', gap: '9px', alignItems: 'baseline', padding: '6px 0', borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.05)', fontSize: '0.74rem' }}><span style={{ minWidth: '52px', color: 'var(--silver)', opacity: 0.65 }}>{label}</span><span style={{ color: 'var(--white)', fontWeight: 600 }}>{val}</span></div>);
                    return (<React.Fragment>
                      {/* Identity + roster call */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                        <div style={{ flexShrink: 0, position: 'relative' }}>
                          <img src={'https://sleepercdn.com/content/nfl/players/' + r.pid + '.jpg'} alt="" onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} style={{ width: '58px', height: '58px', borderRadius: '8px', objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))' }} />
                          <div style={{ display: 'none', width: '58px', height: '58px', borderRadius: '8px', background: 'var(--charcoal)', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, color: 'var(--silver)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))' }}>{(r.p.first_name || '?')[0]}{(r.p.last_name || '?')[0]}</div>
                          <div style={{ position: 'absolute', bottom: '-4px', left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, padding: '1px 7px', borderRadius: '7px', background: (posColors[r.pos] || 'var(--k-666666, #666666)') + '22', color: posColors[r.pos] || 'var(--silver)', whiteSpace: 'nowrap' }}>{posLbl}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '150px' }}>
                          <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.35rem', color: 'var(--white)', letterSpacing: '0.01em', lineHeight: 1.04 }}>{r.p.full_name || getPlayerName(r.pid)}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--silver)', marginTop: '3px', lineHeight: 1.4 }}>
                            {posLbl} {'·'} {r.p.team || 'FA'} {'·'} Age {r.age || '?'} {'·'} {r.p.years_exp || 0}yr exp
                            {formatHeight(r.p.height) ? ' · ' + formatHeight(r.p.height) : ''}
                            {r.p.college ? ' · ' + r.p.college : ''}
                            {(() => { const d = draftCapFor(r.pid); if (!d) return ''; return ' · ' + (d.round > 0 ? 'R' + d.round + ' #' + d.overall + (d.year ? ' ’' + String(d.year).slice(2) : '') + (d.team ? ' ' + d.team : '') : 'UDFA' + (d.year ? ' ’' + String(d.year).slice(2) : '')); })()}
                            {r.injury ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}> {'·'} {r.injury}</span> : null}
                          </div>
                        </div>
                        {/* Verdict badge — editable on ALL versions. Tap to open
                            the picker (Hold/Stash/Sell/Drop + Trade Block/Watch/
                            Untouchable/Cut, the old tag buttons rolled in). */}
                        {isPro ? (() => {
                          const ev = _effRec(r) || 'Hold';
                          const evc = _recColor(ev);
                          return (
                        <button onClick={e => { e.stopPropagation(); setTagEditPid(p => p === r.pid ? null : r.pid); }} title="Tap to set your own call" aria-expanded={tagEditPid === r.pid} style={{ flexShrink: 0, alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: '5px', fontFamily: 'Rajdhani, sans-serif', fontSize: '1.25rem', fontWeight: 700, color: evc, textTransform: 'uppercase', letterSpacing: '0.03em', lineHeight: 1, padding: '7px 14px', borderRadius: '999px', border: '1px solid ' + wrAlpha(evc, '55'), background: wrAlpha(evc, '16'), whiteSpace: 'nowrap', cursor: 'pointer' }}>{ev}<span aria-hidden="true" style={{ fontSize: '0.75rem', opacity: 0.65 }}>{'▾'}</span></button>
                          );
                        })() : (
                        <button onClick={e => { e.stopPropagation(); if (window.showProLaunchPage) window.showProLaunchPage(); else if (window.showUpgradePrompt) window.showUpgradePrompt('analytics_depth'); }}
                          title="Buy/sell roster calls are a Pro read"
                          style={{ flexShrink: 0, alignSelf: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          <span style={{ display: 'inline-block', fontFamily: 'Rajdhani, sans-serif', fontSize: '1.15rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.02em', lineHeight: 1, padding: '7px 15px', borderRadius: '999px', border: '1px solid ' + wrAlpha('var(--gold)', '55'), background: wrAlpha('var(--gold)', '16'), whiteSpace: 'nowrap' }}>{'🔒'} Pro</span>
                        </button>
                        )}
                      </div>

                      {/* Verdict/tag picker — all versions. Sets your own call
                          (Hold/Stash/Sell/Drop + the rolled-in Trade Block/Watch/
                          Untouchable/Cut); Auto reverts to the DHQ engine read. */}
                      {isPro && tagEditPid === r.pid && (() => {
                        const hasOverride = !!(verdictOverrides[r.pid] || (window._playerTags && window._playerTags[r.pid]));
                        const cur = String(_effRec(r) || 'Hold').toLowerCase();
                        return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: '2px' }}>Your call</span>
                        {VERDICT_OPTIONS.map(t => {
                          const active = cur === t.toLowerCase();
                          const c = _recColor(t);
                          return <button key={t} onClick={e => { e.stopPropagation(); setPlayerVerdict(r.pid, t); setTagEditPid(null); }} style={{ minHeight: '38px', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', borderRadius: '6px', cursor: 'pointer', color: active ? c : 'var(--silver)', background: active ? wrAlpha(c, '22') : 'transparent', border: '1px solid ' + (active ? wrAlpha(c, '99') : 'var(--ov-6, rgba(255,255,255,0.12))') }}>{t}</button>;
                        })}
                        {hasOverride && <button onClick={e => { e.stopPropagation(); setPlayerVerdict(r.pid, null); setTagEditPid(null); }} title="Revert to the DHQ engine call" style={{ minHeight: '38px', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-muted)', background: 'transparent', border: '1px dashed var(--ov-6, rgba(255,255,255,0.14))' }}>{'↺'} Auto</button>}
                      </div>
                        );
                      })()}

                      {/* Signals chip strip */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                        <span style={chip(dhqBg(r.dhq), dhqCol(r.dhq))}>{tier} {'·'} {r.dhq.toLocaleString()} DHQ</span>
                        {rank > 0 ? <span style={chip('var(--ov-3, rgba(255,255,255,0.05))', 'var(--gold)')}>{r.pos}{rank}</span> : null}
                        <span style={chip(r.peakPhase === 'PRE' ? 'rgba(46,204,113,0.1)' : r.peakPhase === 'POST' ? 'rgba(231,76,60,0.1)' : 'var(--acc-fill2, rgba(212,175,55,0.08))', r.peakPhase === 'PRE' ? 'var(--good)' : r.peakPhase === 'POST' ? 'var(--bad)' : 'var(--gold)')}>{r.peakPhase}{r.peakYrsLeft > 0 ? ' · ~' + r.peakYrsLeft + 'yr' : ''}</span>
                        {r.effectivePPG ? <span style={chip('var(--ov-3, rgba(255,255,255,0.05))', 'var(--white)')}>{r.effectivePPG} PPG</span> : null}
                        {r.injury ? <span style={chip('rgba(231,76,60,0.13)', 'var(--bad)')}>{r.injury}</span> : null}
                      </div>

                      {/* Dynasty read | signals */}
                      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: '10px', marginBottom: '10px', alignItems: 'start' }}>
                        <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.065))', borderRadius: '8px', padding: '9px 11px', minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '5px' }}>Dynasty Read</div>
                          {window.WR?.ClampedRead
                            ? React.createElement(window.WR.ClampedRead, { text: aiReads[r.pid] || buildDynastyRead(r), maxHeight: 104, style: { fontSize: '0.8rem', color: 'var(--k-d8d8de, #d8d8de)', lineHeight: 1.45 } })
                            : <div style={{ fontSize: '0.8rem', color: 'var(--k-d8d8de, #d8d8de)', lineHeight: 1.45 }}>{aiReads[r.pid] || buildDynastyRead(r)}</div>}
                        </div>
                        <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.065))', borderRadius: '8px', padding: '9px 11px', minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '4px' }}>Signals</div>
                          {sigRow('Ceiling', sigCeiling)}
                          {sigRow('Floor', sigFloor)}
                          {sigRow('Risk', sigRisk)}
                          {sigRow('Window', sigWindow, true)}
                        </div>
                      </div>

                      {/* Player Brief — the full layered summary (The Wire + DHQ
                          Read, stamped top-right). Alex's text already shows in the
                          Dynasty Read box above, so it isn't passed here (no dupe). */}
                      {window.WR?.PlayerBriefBlock ? React.createElement(window.WR.PlayerBriefBlock, {
                        pid: r.pid,
                        playersData,
                        ppg: parseFloat(r.effectivePPG) || undefined,
                        style: { marginBottom: '10px' },
                      }) : null}
                    </React.Fragment>);
                  })()}

		                  {/* Age Curve visualization */}
	                  {(() => {
	                    const nP = r.pos === 'DE' || r.pos === 'DT' ? 'DL' : r.pos === 'CB' || r.pos === 'S' ? 'DB' : r.pos;
	                    const curve = typeof window.App?.getAgeCurve === 'function'
	                      ? window.App.getAgeCurve(nP)
	                      : { build: [22, 24], peak: (window.App.peakWindows || {})[nP] || [24, 29], decline: [30, 32] };
	                    const [pLo, pHi] = curve.peak;
	                    const declineHi = curve.decline[1];
	                    const ages = Array.from({length: 17}, (_, i) => i + 20);
                    return <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Age Curve</div>
	                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{'Currently age ' + (r.age || '?') + ' \u00B7 ' + r.peakPhase + ' \u00B7 ' + (r.peakYrsLeft > 0 ? '~' + r.peakYrsLeft + ' peak yr left' : r.valueYrsLeft > 0 ? '~' + r.valueYrsLeft + ' value yr left' : 'Past value window')}</div>
                      </div>
                      <div style={{ display: 'flex', height: '22px', borderRadius: '5px', overflow: 'hidden', gap: '1px' }}>
                        {ages.map(a => {
	                          const col = a < pLo - 3 ? 'rgba(96,165,250,0.3)' : a < pLo ? 'rgba(46,204,113,0.45)' : (a >= pLo && a <= pHi) ? 'rgba(46,204,113,0.75)' : a <= declineHi ? 'var(--acc-line3, rgba(212,175,55,0.45))' : 'rgba(231,76,60,0.35)';
                          const isMe = a === (r.age || 0);
                          return <div key={a} style={{ flex: 1, background: col, opacity: isMe ? 1 : 0.55, outline: isMe ? '2px solid var(--gold)' : 'none', outlineOffset: '-1px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: isMe ? 'var(--text-primary)' : 'transparent' }}>{isMe ? a : ''}</div>;
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', marginTop: '3px' }}>
	                        <span>20</span><span>{'Peak ' + pLo + '\u2013' + pHi + ' / Value thru ' + declineHi}</span><span>36</span>
                      </div>
                    </div>;
                  })()}

                  {/* Career Stats Table */}
                  <InlineCareerStats pid={r.pid} pos={r.pos} player={r.p} scoringSettings={currentLeague?.scoring_settings} statsData={statsData} />

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={e => { e.stopPropagation(); const playerName = r.p.full_name || getPlayerName(r.pid); setReconPanelOpen(true); sendReconMessage("I'd like help with " + playerName + ". Here are my options:\n1. Who are the best trade partners for " + playerName + "?\n2. What's the long-term projection for " + playerName + "?\n3. Should I hold or sell " + playerName + " right now?"); }} style={{ padding: '7px 16px', minHeight: '44px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: 'rgba(124,107,248,0.15)', color: 'var(--purple)', border: '1px solid rgba(124,107,248,0.3)', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>ASK ALEX</button>
                    {/* Phase 2: News button removed per user feedback (2026-04-18) */}
                    {/* TRADE BLOCK/CUT/UNTOUCHABLE/WATCH buttons removed 2026-07-09 \u2014
                        rolled into the verdict picker (tap the call badge above). */}
                    <button onClick={e => { e.stopPropagation(); setExpandedPid(null); }} style={{ padding: '7px 16px', minHeight: '44px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '6px', cursor: 'pointer' }}>COLLAPSE</button>
                  </div>
  </React.Fragment>);

  // ══ PHONE (<768) — Phase 0 pilot (iPhone program) ═══════════════════
  // Everything in this section renders ONLY when `_phone` is true; the
  // desktop/tablet render path below is byte-identical to the pre-phase
  // file (blocks are wrapped or hoisted, never edited). Kit presence
  // (wr-primitives.js loads earlier in the babel chain) is fixed for the
  // page's lifetime, so `_phone` can gate render without hook hazards.
  const _kitReady = !!(window.WR && window.WR.HeroCard && window.WR.AssetRow && window.WR.CardList && window.WR.FilterPill && window.WR.FilterSheet);
  const _phone = _isPhone && _kitReady;

  // Preset → "which 3 stat slots ride the card row" (P1 AssetRow). Slot
  // values are produced by _phoneSlotFor, which calls the SAME sources the
  // desktop renderCell uses (projFor / App.computeRollingPPG /
  // App.PlayerValue.getRosPoints / App.WeeklyProj.formStats /
  // App.RookieFields.fields) — lookups reused, no formulas duplicated.
  const PHONE_SLOT_PRESETS = {
    default: ['dhq', 'proj', 'ppg'],
    redraft: ['proj', 'ppg', 'trend'],
    stats:   ['ppg', 'prev', 'trend'],
    scout:   ['yrsExp', 'starterSzn', 'posRankNfl'],
    rookie:  ['rkSlot', 'age', 'dhq'],
  };
  const PHONE_SLOT_KEYS = new Set(['dhq', 'proj', 'ppg', 'prev', 'trend', 'age', 'gp', 'hi', 'lo', 'yrsExp', 'starterSzn', 'posRankNfl', 'posRankLg', 'sos', 'peak', 'rkSlot']);
  // Custom column sets ride the first 3 slot-capable picks; empty → default.
  let _phoneSlotKeys = PHONE_SLOT_PRESETS[activePresetKey]
    || visibleCols.filter(k => PHONE_SLOT_KEYS.has(k)).slice(0, 3);
  if (!_phoneSlotKeys.length) _phoneSlotKeys = PHONE_SLOT_PRESETS.default;
  const _phoneSlotFor = (colKey, r) => {
    const short = ROSTER_COLUMNS[colKey]?.shortLabel || colKey;
    switch (colKey) {
      case 'dhq': {
        // Same redraft ROS-points swap as renderCell's dhq cell.
        const rosPts = (resolvedLeagueSkin?.type === 'redraft' && window.App?.PlayerValue?.getRosPoints) ? window.App.PlayerValue.getRosPoints(r.pid) : null;
        const disp = rosPts != null ? (rosPts > 0 ? Math.round(rosPts).toLocaleString() : '—') : (r.dhq > 0 ? r.dhq.toLocaleString() : '—');
        return { label: short, value: disp, strong: true };
      }
      case 'proj': {
        const p = projFor(r.pid);
        if (!p) return { label: 'Proj', value: '—', tone: 'mute' };
        if (!p.available) return { label: 'Proj', value: p.injuryStatus || 'OUT', tone: 'warn' };
        // Same #232 rule as the desktop cell: straight weekly median (the number
        // the owner sees in Sleeper), never the GM-mode floor/ceiling objective.
        const pts = (p.points && (p.points.median != null ? p.points.median : p.points.mean)) || 0;
        return { label: 'Proj', value: pts > 0 ? pts.toFixed(1) : '—' };
      }
      case 'ppg': {
        // Same rolling-window override + seasonal fallback as renderCell;
        // the window rides the LABEL (L5/L3) since card slots have no room
        // for the " · L5" marker.
        let shown = r.effectivePPG;
        let lbl = 'PPG';
        if (ppgWindow !== 'season') {
          const n = ppgWindow === 'l3' ? 3 : 5;
          const rolling = typeof window.App?.computeRollingPPG === 'function' ? window.App.computeRollingPPG(r.pid, n) : 0;
          if (rolling > 0) { shown = rolling; lbl = 'L' + n; } else { lbl = 'SZN'; }
        }
        return { label: lbl, value: shown > 0 ? shown : '—' };
      }
      case 'prev': return { label: short, value: r.prevPPG > 0 ? r.prevPPG : '—', tone: 'mute' };
      case 'trend': return { label: short, value: r.trend > 0 ? '+' + r.trend + '%' : r.trend < 0 ? r.trend + '%' : '—', tone: 'mute' };
      case 'age': return { label: short, value: r.age || '—', tone: 'mute' };
      case 'gp': return { label: short, value: r.effectiveGP > 0 ? r.effectiveGP : '—', tone: 'mute' };
      case 'hi': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return { label: short, value: fs ? fs.high.toFixed(1) : '—', tone: fs ? 'good' : 'mute' }; }
      case 'lo': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return { label: short, value: fs ? fs.low.toFixed(1) : '—', tone: 'mute' }; }
      case 'yrsExp': return { label: short, value: r.p.years_exp ?? '—', tone: 'mute' };
      case 'starterSzn': return { label: short, value: r.meta?.starterSeasons ?? '—', tone: 'mute' };
      case 'posRankNfl': return { label: short, value: r.meta?.fcRank ? '#' + r.meta.fcRank : '—', tone: 'mute' };
      case 'posRankLg': { const rank = getLeaguePositionRank(r); return { label: short, value: rank ? '#' + rank : '—', tone: 'mute' }; }
      case 'sos': { const s = window.App?.SOS?.ready ? window.App.SOS.getPlayerSOS(r.pid, r.pos, r.p?.team) : null; return { label: short, value: s ? s.avgRank : '—', tone: 'mute' }; }
      case 'peak': return { label: short, value: r.peakPhase || '—', tone: 'mute' };
      case 'rkSlot': case 'rkRank': case 'rkTier': {
        const rf = window.App?.RookieFields?.fields?.(prospectForRow(r)) || null;
        if (colKey === 'rkSlot') {
          // Vet fallback mirrors the desktop cell: R<rd> #<overall> or UDFA.
          const dp = draftCapFor(r.pid);
          const slotTxt = rf?.draftSlot || (dp ? (dp.round > 0 ? 'R' + dp.round + ' #' + dp.overall : 'UDFA') : null);
          return { label: short, value: slotTxt || '—', tone: slotTxt ? undefined : 'mute' };
        }
        if (!rf) return { label: short, value: '—', tone: 'mute' };
        if (colKey === 'rkRank') return { label: short, value: rf.consensusRank != null ? rf.consensusRank : '—' };
        return { label: short, value: rf.tierLabel || '—' };
      }
      default: return { label: short, value: '—', tone: 'mute' };
    }
  };
  // Two-line tag under the name: team · age · injury-or-slot.
  const _phoneTagFor = (r) => {
    const bits = [r.p.team || 'FA'];
    if (r.age) bits.push(String(r.age));
    bits.push(r.injury ? r.injury : _slotLabel(r));
    return bits.join(' · ');
  };
  // Verdict chip (Move-column analog) — Pro-only, exactly mirroring the
  // desktop `delete ROSTER_COLUMNS.action` gate: free rows carry rec=null
  // and render no chip even if a gate upstream is ever missed. Tones per
  // the approved mockup: SELL amber / CORE-BUILD gold / rest calm blue.
  const _phoneVerdictChip = (r) => {
    const rec = _effRec(r);
    if (!isPro || !rec) return null;
    const isManual = !!verdictOverrides[r.pid];
    const col = _recColor(rec);
    return (
      <span title={isManual ? 'Your call (tap the badge in the player card to change)' : (r.gmSellNudge ? 'Nudged to Sell by GM Strategy (position/age trips a sell rule)' : '')} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', border: '1px solid ' + wrAlpha(col, '80'), color: col, letterSpacing: '0.02em', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>
        {rec}{isManual ? ' *' : (r.gmSellNudge ? ' ·GM' : '')}
      </span>
    );
  };

  // Hero + pill strip + filter sheet (P5/P3) — computed only on phone.
  let _phoneHeroEl = null, _phonePillsEl = null, _phoneSheetEl = null, _reviewSheetEl = null;
  if (_phone) {
    // Decision hero: drop-alert count + GM window, all from data the tab
    // already computes (dropCandidatePids / dismissedDrops are Pro
    // verdicts — free renders raw roster facts, zero gate drift).
    const dropAlerts = isPro ? rows.filter(_isActiveDrop) : [];
    const modeLabel = String((gm && gm.modeLabel) || 'Compete');
    // Override-aware (owner ask): a user-kept player drops out of the hero
    // count too, matching the review list below (both read _effRec).
    const sellCalls = isPro ? rows.filter(r => /sell/i.test(_effRec(r) || '')).length : 0;
    const heroHeadline = (isPro
      ? (dropAlerts.length > 0 ? dropAlerts.length + ' DROP ALERT' + (dropAlerts.length === 1 ? '' : 'S') : 'ROSTER CLEAN')
      : allPlayers.length + ' PLAYERS') + ' · WINDOW: ' + modeLabel.toUpperCase();
    const heroFacts = isPro
      ? ((dropAlerts.length > 0
          ? dropAlerts.slice(0, 2).map(r => r.p.last_name || getPlayerName(r.pid)).join(' + ') + ' flagged dead weight'
          : 'no drop flags on the bench')
        + (sellCalls > 0 ? ' · ' + sellCalls + ' sell call' + (sellCalls === 1 ? '' : 's') : ''))
      : ((myRoster.starters || []).length + ' starters · strategy ' + modeLabel);
    const heroGhost = dropAlerts.length > 0 ? 'Review' : null;
    _phoneHeroEl = React.createElement(window.WR.HeroCard, {
      kicker: 'Roster call',
      headline: heroHeadline,
      facts: heroFacts,
      ctaGhost: heroGhost,
      onCtaGhost: heroGhost ? () => setReviewOpen(true) : undefined,
    });

    const totalCols = Object.keys(ROSTER_COLUMNS).length;
    const openSheet = () => setFiltersOpen(true);
    _phonePillsEl = (
      <div className="wr-hscroll" style={{ display: 'flex', gap: '6px', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
        {React.createElement(window.WR.FilterPill, { label: 'Filters', value: rosterFilter, onClick: openSheet })}
        {React.createElement(window.WR.FilterPill, { label: 'View', value: activePresetMeta.label, onClick: openSheet })}
        {React.createElement(window.WR.FilterPill, { label: 'Cols', value: visibleCols.length + '/' + totalCols, onClick: openSheet })}
        {React.createElement(window.WR.FilterPill, {
          label: 'Deep Data', value: isDeepData ? 'ON' : null,
          onClick: () => {
            // Same setters as the desktop View select — 'full' ⇄ 'default'.
            if (isDeepData) { setVisibleCols(COLUMN_PRESETS.default); setColPreset('default'); }
            else { setVisibleCols(COLUMN_PRESETS.full); setColPreset('full'); }
          },
        })}
      </div>
    );

    // FilterSheet re-homes the EXISTING toolbar controls behind one sheet;
    // every control drives the exact same state setters as the desktop
    // toolbar (which stays untouched for tablet/desktop).
    const sheetSelectStyle = (active) => ({ ...rosterSelectStyle(active), width: '100%' });
    _phoneSheetEl = React.createElement(window.WR.FilterSheet, {
      open: filtersOpen,
      onClose: () => setFiltersOpen(false),
      title: 'Roster filters',
      sections: [
        { label: 'Scope', node: (
          <select value={rosterFilter} onChange={e => setRosterFilter(e.target.value)} style={sheetSelectStyle(rosterFilter !== 'All')} title="Show a slot or position group">
            {rosterFilterOptions.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        ) },
        { label: 'View', node: (
          <select value={activePresetKey} onChange={e => { const key = e.target.value; const cols = COLUMN_PRESETS[key]; if (!cols) return; setVisibleCols(cols); setColPreset(key); if (key === 'rookie') setRosterFilter('Rookies'); else if (rosterFilter === 'Rookies') setRosterFilter('All'); }} style={sheetSelectStyle(activePresetKey !== 'default')} title="Column preset">
            {Object.keys(COLUMN_PRESETS).map(key => <option key={key} value={key}>{COLUMN_PRESET_META[key]?.label || key}</option>)}
            {activePresetKey === 'custom' && <option value="custom">Custom</option>}
          </select>
        ) },
        { label: 'Columns', node: (
          <button onClick={() => { setShowColPicker(true); setFiltersOpen(false); }} style={{ ...controlBtn(showColPicker || activePresetKey === 'custom'), minHeight: '44px', width: '100%' }} title="Add, remove, or reorder columns">Customize · {visibleCols.length}/{Object.keys(ROSTER_COLUMNS).length} fields</button>
        ) },
        { label: 'PPG window', node: (
          <select value={ppgWindow} onChange={e => setPpgWindow(e.target.value)} style={sheetSelectStyle(ppgWindow !== 'season')} title="Points-per-game window">
            <option value="season">Season</option>
            <option value="l5">L5</option>
            <option value="l3">L3</option>
          </select>
        ) },
        { label: 'Rows', node: (
          <select value={rowDensity} onChange={e => setRowDensity(e.target.value)} style={sheetSelectStyle(rowDensity !== 'comfortable')} title="Row density">
            <option value="comfortable">Comfort</option>
            <option value="compact">Compact</option>
          </select>
        ) },
        { label: 'Group', node: (
          <select value={rosterGroupMode} onChange={e => setRosterGroupMode(e.target.value)} style={sheetSelectStyle(rosterGroupMode !== 'position')} title="Group rows by">
            {GROUP_MODES.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
          </select>
        ) },
        { label: 'Saved views', node: (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, whiteSpace: 'nowrap' }}>{filtered.length} / {allPlayers.length} shown</span>
            {window.WR?.SavedViews?.SavedViewBar && React.createElement(window.WR.SavedViews.SavedViewBar, {
              surface: 'roster',
              leagueId: currentLeague?.id,
              currentState: { columns: visibleCols, sort: rosterSort, filters: { rosterFilter, rosterGroupMode, rowDensity } },
              onApply: (v) => {
                if (Array.isArray(v.columns) && v.columns.length) { setVisibleCols(v.columns); setColPreset('custom'); }
                if (v.sort && v.sort.key) setRosterSort({ key: v.sort.key, dir: v.sort.dir || 1 });
                if (v.filters && typeof v.filters.rosterFilter === 'string') setRosterFilter(v.filters.rosterFilter);
                if (v.filters && typeof v.filters.rosterGroupMode === 'string') setRosterGroupMode(v.filters.rosterGroupMode);
                if (v.filters && typeof v.filters.rowDensity === 'string') setRowDensity(v.filters.rowDensity);
              },
            })}
          </div>
        ) },
      ],
      footer: (
        <React.Fragment>
          <button onClick={() => { setRosterFilter('All'); setVisibleCols(COLUMN_PRESETS.default); setColPreset('default'); setPpgWindow('season'); setRowDensity('comfortable'); setRosterGroupMode('position'); }} style={{ ...controlBtn(false), minHeight: '44px', flex: 1 }}>Reset</button>
          <button onClick={() => setFiltersOpen(false)} style={{ ...controlBtn(true), minHeight: '44px', flex: 2 }}>Apply</button>
        </React.Fragment>
      ),
    });

    // Review sheet — the flagged players (drop alerts + sell calls) as a
    // tappable list; tapping jumps to that player's dossier. Opened by the
    // hero's Review CTA.
    const _reviewRow = (r) => React.createElement(window.WR.AssetRow, {
      key: 'rv-' + r.pid,
      pos: r.pos,
      name: getPlayerName(r.pid),
      tag: _phoneTagFor(r),
      slots: [{ label: 'DHQ', value: r.dhq > 0 ? r.dhq.toLocaleString() : '—', strong: true }],
      verdict: _phoneVerdictChip(r),
      title: 'Open ' + getPlayerName(r.pid),
      onClick: () => {
        setReviewOpen(false);
        setExpandedPid(r.pid);
        setTimeout(() => { try { const el = document.querySelector('[data-wr-roster-pid="' + r.pid + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }, 90);
      },
    });
    const _dropPidSet = new Set(dropAlerts.map(r => r.pid));
    const _sellRows = isPro ? rows.filter(r => /sell/i.test(_effRec(r) || '') && !_dropPidSet.has(r.pid)) : [];
    const _reviewGroups = [];
    if (dropAlerts.length) _reviewGroups.push({ label: 'Drop alerts', sub: String(dropAlerts.length), rows: dropAlerts.map(_reviewRow) });
    if (_sellRows.length) _reviewGroups.push({ label: 'Sell calls', sub: String(_sellRows.length), rows: _sellRows.map(_reviewRow) });
    if (_reviewGroups.length) {
      _reviewSheetEl = React.createElement(window.WR.Sheet, { open: reviewOpen, onClose: () => setReviewOpen(false), title: 'Review roster' },
        React.createElement('div', { style: { padding: '2px 12px 8px', display: 'flex', flexDirection: 'column', gap: '12px' } },
          React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0 2px', lineHeight: 1.4 } }, 'Players flagged to move or cut. Tap one to open its full read.'),
          React.createElement(window.WR.CardList, { groups: _reviewGroups })
        )
      );
    }
  }

  // P1 card list — the phone board: groups follow the EXISTING group mode
  // (filtered is already group-sorted), each row is a WR.AssetRow, and row
  // tap toggles the EXISTING expandedPid state. The expand renders the
  // hoisted dossier as AssetRow children — the desktop boardWidth pinning
  // wrapper is bypassed here (cards are viewport-width already).
  const _renderPhoneCards = () => {
    const groups = [];
    filtered.forEach(r => {
      const key = getRowGroupKey(r);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: rosterGroupMode === 'none' ? null : getRowGroupLabel(r), rows: [] };
        groups.push(g);
      }
      const isExpanded = expandedPid === r.pid;
      const isDropFlag = isPro && dropCandidatePids.has(r.pid) && !dismissedDrops.has(r.pid);
      g.rows.push(React.createElement(window.WR.AssetRow, {
        key: r.pid,
        pos: r.pos,
        name: getPlayerName(r.pid),
        tag: _phoneTagFor(r),
        slots: _phoneSlotKeys.map(k => _phoneSlotFor(k, r)),
        verdict: _phoneVerdictChip(r),
        // No colored row accent — the verdict chip + injury tag already carry
        // the status; the outline read as ambiguous (owner call). Rows keep
        // AssetRow's default faint border.
        expanded: isExpanded,
        onClick: () => setExpandedPid(prev => prev === r.pid ? null : r.pid),
        title: 'Open roster player detail',
        'data-wr-drop-flag': isDropFlag ? '1' : undefined,
        'data-wr-roster-pid': r.pid,
      }, isExpanded ? renderExpandBody(r) : null));
    });
    if (!groups.length) {
      return <div style={{ padding: '14px', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', borderRadius: '9px', color: 'var(--silver)', opacity: 0.7, fontSize: '0.78rem' }}>No roster rows match this view.</div>;
    }
    return React.createElement(window.WR.CardList, {
      groups: groups.map(g => ({ label: g.label, sub: g.rows.length + (g.rows.length === 1 ? ' player' : ' players'), rows: g.rows })),
    });
  };

  // ── Desktop/tablet roster board — HOISTED VERBATIM from the return so
  // the phone Deep Data view can reuse it inside the scoped scroll wrap.
  // Desktop output is byte-identical: the return renders this directly.
  const _renderRosterBoard = () => (
      <div style={{ border: '1px solid var(--ov-5, rgba(255,255,255,0.075))', borderRadius: 'var(--card-radius)', overflow: 'hidden', background: 'var(--surf-solid, rgba(12,12,17,0.98))', boxShadow: '0 10px 24px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '7px 10px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', background: 'var(--ov-1, rgba(255,255,255,0.018))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', color: 'var(--white)', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700 }}>Roster Board</div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: isDeepData ? 'var(--gold)' : 'var(--silver)', opacity: isDeepData ? 0.86 : 0.58 }}>{activePresetMeta.label} · {visibleCols.length} fields</div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: rosterGroupMode === 'none' ? 'var(--silver)' : 'var(--gold)', opacity: 0.62 }}>Grouped by {activeGroupModeLabel}</div>
            <div style={{ marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em' }}>
              {filtered.length} player{filtered.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.52, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Sort: {ROSTER_COLUMNS[rosterSort.key]?.shortLabel || (rosterSort.key === 'name' ? 'Player' : rosterSort.key)}
            </div>
          </div>
        </div>
        <div ref={boardScrollRef} style={{ overflowX: 'auto', overflowY: 'clip', background: 'linear-gradient(90deg, var(--ov-1, rgba(255,255,255,0.02)), transparent 12%, transparent 88%, var(--ov-1, rgba(255,255,255,0.018)))' }}>
          <div style={{ minWidth: tableMinWidth + 'px' }}>
            {/* Header row */}
            <div style={{ display: 'flex', height: '32px', background: 'var(--ov-2, rgba(255,255,255,0.03))', borderBottom: '1px solid var(--ov-6, rgba(255,255,255,0.12))', position: 'sticky', top: 0, zIndex: 5 }}>
              <div title="Player" style={{ width: playerColWidth + 'px', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '0.72rem', fontWeight: 600, color: rosterSort.key === 'name' ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', letterSpacing: '0.035em', cursor: 'pointer', userSelect: 'none', borderRight: '1px solid var(--ov-6, rgba(255,255,255,0.1))', textTransform: 'uppercase', position: 'sticky', left: 0, zIndex: 7, background: 'linear-gradient(180deg, var(--k-1b1d23, #1b1d23), var(--k-15161b, #15161b))', boxShadow: '8px 0 14px rgba(0,0,0,0.2)' }}
                onClick={() => setRosterSort(prev => prev.key === 'name' ? {...prev, dir: prev.dir*-1} : {key: 'name', dir: 1})}>
                Player{rosterSort.key === 'name' ? (rosterSort.dir === -1 ? ' v' : ' ^') : ''}
              </div>
              <div style={{ flex: 1, display: 'flex' }}>
                {rosterTableCols.map(colKey => {
                  const col = ROSTER_COLUMNS[colKey];
                  if (!col) return null;
                  const isSorted = rosterSort.key === colKey;
                  const isGroupStart = visibleColGroupStarts.has(colKey);
                  return (
                    <div key={colKey} title={col.label} onClick={() => setRosterSort(prev => prev.key === colKey ? {...prev, dir: prev.dir*-1} : {key: colKey, dir: 1})}
                      style={{ width: col.width, minWidth: col.width, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: isSorted ? 700 : 600, color: isSorted ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', letterSpacing: '0.025em', cursor: 'pointer', userSelect: 'none', textTransform: 'uppercase', borderLeft: isGroupStart ? '1px solid var(--ov-4, rgba(255,255,255,0.06))' : '1px solid var(--ov-3, rgba(255,255,255,0.035))', padding: '0 3px', textAlign: 'center', lineHeight: 1.05, background: isSorted ? 'var(--acc-fill1, rgba(212,175,55,0.06))' : 'transparent' }}>
                      <span>{col.shortLabel || col.label}{rosterSort.key === colKey ? (rosterSort.dir === -1 ? ' v' : ' ^') : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Player rows + inline expand */}
            {filtered.map((r, idx) => {
              const isExpanded = expandedPid === r.pid;
              const rowGroupKey = getRowGroupKey(r);
              const startsPositionGroup = rosterGroupMode !== 'none' && (idx === 0 || getRowGroupKey(filtered[idx - 1]) !== rowGroupKey);
              const rowBg = isExpanded ? 'var(--acc-fill1, rgba(212,175,55,0.058))' : idx % 2 === 1 ? 'var(--ov-1, rgba(255,255,255,0.018))' : 'var(--ov-1, rgba(255,255,255,0.006))';
              // Frozen player cell needs an OPAQUE background — 'inherit' picks up
              // the translucent row tint and the h-scrolled data columns bleed
              // through under the sticky cell. Compose tint-over-solid instead.
              const frozenBase = 'var(--surf-solid, rgba(12,12,17,0.98))';
              const frozenBg = 'linear-gradient(' + rowBg + ', ' + rowBg + '), ' + frozenBase;
              const frozenHoverBg = 'linear-gradient(var(--acc-fill1, rgba(212,175,55,0.06)), var(--acc-fill1, rgba(212,175,55,0.06))), ' + frozenBase;
              // Phone Deep Data (owner ask 2026-07-12): the frozen name cell is
              // just photo + "F. Last" + team — 30 scrolling columns leave no
              // room for the full name + slot/GM/drop tag cluster the desktop
              // board carries. Shorten to first-initial · last-name so it never
              // truncates. Desktop/tablet keep the full card (gated on !_phone).
              const frozenName = _phone && r.p.first_name && r.p.last_name
                ? r.p.first_name.charAt(0) + '. ' + r.p.last_name
                : getPlayerName(r.pid);

              const _recLower = (r.rec || '').toLowerCase();
          const actionClass = _recLower === 'sell now' || _recLower === 'sell' ? 'wr-row-sell' :
            _recLower === 'sell high' ? 'wr-row-sell-high' :
            _recLower === 'hold core' || _recLower === 'build around' ? 'wr-row-core' : '';
          const untouchables = (window._wrGmStrategy?.untouchable || []);
          const isUntouchable = untouchables.includes(r.pid);

          return (
            <React.Fragment key={r.pid}>
              {startsPositionGroup && (
	                <div style={{ display: 'flex', height: isCompactRows ? '24px' : '28px', borderTop: idx === 0 ? 'none' : '2px solid var(--acc-line3, rgba(212,175,55,0.45))', borderBottom: '1px solid var(--ov-5, rgba(255,255,255,0.08))', background: 'var(--ov-6, rgba(255,255,255,0.10))' }}>
	                  <div style={{ width: playerColWidth + 'px', flexShrink: 0, position: 'sticky', left: 0, zIndex: 4, display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', background: 'var(--k-262932, #262932)', borderLeft: '3px solid var(--gold)', borderRight: '1px solid var(--ov-5, rgba(255,255,255,0.08))', boxShadow: '8px 0 14px rgba(0,0,0,0.16)' }}>
	                    <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.84rem', color: getRowGroupColor(r), fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{getRowGroupLabel(r)}</span>
	                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{filteredPosCounts[rowGroupKey]} players</span>
                  </div>
                  <div style={{ flex: 1, borderLeft: '1px solid var(--ov-2, rgba(255,255,255,0.025))' }} />
                </div>
              )}
              {/* Normal row */}
              <div className={[actionClass, isUntouchable ? 'wr-untouchable' : ''].filter(Boolean).join(' ')} role="button" tabIndex={0} title="Open roster player detail" style={{ display: 'flex', overflow: 'visible', borderTop: 'none', borderBottom: isExpanded ? 'none' : '1px solid var(--ov-3, rgba(255,255,255,0.035))', cursor: 'pointer', background: rowBg, transition: 'background 0.1s' }}
                onClick={() => setExpandedPid(prev => prev === r.pid ? null : r.pid)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedPid(prev => prev === r.pid ? null : r.pid); } }}
                onMouseEnter={e => { if (!isExpanded) { e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'; const fc = e.currentTarget.firstElementChild; if (fc) fc.style.background = frozenHoverBg; } }}
                onMouseLeave={e => { if (!isExpanded) { e.currentTarget.style.background = rowBg; const fc = e.currentTarget.firstElementChild; if (fc) fc.style.background = frozenBg; } }}>
                {/* Frozen player info */}
	                <div style={{ width: playerColWidth + 'px', flexShrink: 0, height: rowHeight + 'px', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', borderRight: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', position: 'sticky', left: 0, zIndex: 3, background: frozenBg, boxShadow: '8px 0 14px rgba(0,0,0,0.16)' }}>
                  <div style={{ width: avatarSize + 'px', height: avatarSize + 'px', flexShrink: 0 }}><img src={'https://sleepercdn.com/content/nfl/players/thumb/'+r.pid+'.jpg'} alt="" onError={e=>e.target.style.display='none'} style={{ width: avatarSize + 'px', height: avatarSize + 'px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))' }} /></div>
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
	                      <span style={{ fontWeight: 650, color: 'var(--white)', fontSize: playerNameSize, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{frozenName}</span>
                      {/* Tag cluster (slot/roster/GM/drop) is desktop + tablet only —
                          phone Deep Data keeps the name cell to photo · name · team. */}
                      {!_phone && <React.Fragment>
                      {inlineTag(slotTagMeta[r.section], 'slot-' + r.pid)}
                      {inlineTag(rosterTagMeta[window._playerTags?.[r.pid]], 'tag-' + r.pid)}
                      {/* GM Strategy: untouchable lock — distinct from manual tag system */}
                      {r.gmIsUntouchable && <span title="GM Strategy: untouchable — locked from sell flags" style={{ fontSize: 'var(--text-micro, 0.6875rem)', flexShrink: 0, lineHeight: 1, color: 'var(--good)' }}>{'🛡'}</span>}
                      {/* GM Strategy: acquisition-focus / sell-candidate position accents */}
                      {!r.gmIsUntouchable && r.gmIsTarget && <span title="GM Strategy: acquisition-focus position" style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 800, background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.28))', flexShrink: 0, lineHeight: 1, letterSpacing: '0.03em' }}>TGT</span>}
                      {!r.gmIsUntouchable && r.gmIsSellPos && <span title="GM Strategy: sell-candidate position" style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 800, background: 'rgba(240,165,0,0.13)', color: 'var(--warn)', border: '1px solid rgba(240,165,0,0.32)', flexShrink: 0, lineHeight: 1, letterSpacing: '0.03em' }}>SELL</span>}
                      {isPro && dropCandidatePids.has(r.pid) && !dismissedDrops.has(r.pid) && <span className="wr-drop-chip" onClick={e => { e.stopPropagation(); dismissDrop(r.pid); }} title="Drop candidate (click to dismiss)" style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, background: 'rgba(231,76,60,0.2)', color: 'var(--bad)', border: '1px solid rgba(231,76,60,0.4)', flexShrink: 0, cursor: 'pointer', lineHeight: 1 }}>DROP?</span>}
                      </React.Fragment>}
                    </div>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, marginTop: '1px' }}>{r.p.team || 'FA'}{!_phone && r.injury ? ' \u00B7 '+r.injury : ''}</div>
                  </div>
                  <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.42 }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
                {/* Data columns */}
                <div style={{ flex: 1, display: 'flex', height: rowHeight + 'px', overflow: 'hidden' }}>
                  {rosterTableCols.map(colKey => ROSTER_COLUMNS[colKey] ? renderCell(colKey, r) : null)}
                </div>
              </div>

              {/* Inline expand card — Madden/FM style */}
              {isExpanded && (
                <div style={{ borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'linear-gradient(180deg, var(--surf-solid, rgba(18,18,24,0.99)), var(--surf-solid, rgba(6,6,10,0.99)))', padding: '12px 14px', animation: 'wrFadeIn 0.2s ease', position: 'sticky', left: 0, zIndex: 3, width: boardWidth ? boardWidth + 'px' : '100%', boxSizing: 'border-box' }}>
                  {renderExpandBody(r)}
                </div>
              )}
            </React.Fragment>
          );
            })}
            {filtered.length === 0 && (
              <div style={{ display: 'flex', minHeight: '76px', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.04))', background: 'var(--ov-1, rgba(255,255,255,0.012))' }}>
                <div style={{ width: playerColWidth + 'px', flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: 'var(--k-0d0d13, #0d0d13)', borderRight: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))', display: 'flex', alignItems: 'center', padding: '0 12px', color: 'var(--silver)', fontWeight: 700 }}>No players</div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 14px', color: 'var(--silver)', opacity: 0.58, fontSize: '0.78rem' }}>No roster rows match this view.</div>
              </div>
            )}
          </div>
        </div>
      </div>
  );

  // ── Draft-pick inventory (owned future picks) — shown under the roster ──
  // Mirrors the draft-capital widget: a pick is yours unless you traded it
  // away; picks acquired via trade show who they came from.
  const myDraftPicks = (() => {
    try {
      const myRid = myRoster?.roster_id;
      if (myRid == null || !currentLeague) return [];
      const season = parseInt(currentLeague.season || new Date().getFullYear(), 10);
      const draftRounds = currentLeague.settings?.draft_rounds || 5;
      const tradedPicks = window.S?.tradedPicks || [];
      const rosters = currentLeague.rosters || [];
      const users = window.S?.leagueUsers || currentLeague.users || [];
      const out = [];
      for (let yr = season; yr <= season + 2; yr++) {
        for (let rd = 1; rd <= draftRounds; rd++) {
          const tradedAway = tradedPicks.find(p => parseInt(p.season, 10) === yr && p.round === rd && p.roster_id === myRid && p.owner_id !== myRid);
          const acquired = tradedPicks.filter(p => parseInt(p.season, 10) === yr && p.round === rd && p.owner_id === myRid && p.roster_id !== myRid);
          if (!tradedAway) out.push({ year: yr, round: rd, own: true, from: null });
          acquired.forEach(a => {
            const fromRoster = rosters.find(r => r.roster_id === a.roster_id);
            const fromUser = fromRoster ? users.find(u => u.user_id === fromRoster.owner_id) : null;
            out.push({ year: yr, round: rd, own: false, from: (fromUser?.display_name || ('Team ' + a.roster_id)) });
          });
        }
      }
      return out.sort((a, b) => a.year - b.year || a.round - b.round);
    } catch (e) { return []; }
  })();
  const picksByYear = {};
  myDraftPicks.forEach(p => { (picksByYear[p.year] = picksByYear[p.year] || []).push(p); });

  return (
    <div style={{ padding: _phone ? '12px var(--wr-phone-gutter, 12px) 8px' : 'var(--card-pad, 16px 18px)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {_phone && <React.Fragment>
        {_phoneHeroEl}
        {_phonePillsEl}
        {_phoneSheetEl}
        {_reviewSheetEl}
      </React.Fragment>}
      {!_phone && <React.Fragment>
      {isCompactRoster && (() => {
        const ppgLabelMap = { season: 'Season', l5: 'L5', l3: 'L3' };
        const rowLabelMap = { comfortable: 'Comfort', compact: 'Compact' };
        const groupLabel = (GROUP_MODES.find(g => g.key === rosterGroupMode) || {}).label || 'None';
        const viewLabel = (COLUMN_PRESET_META[activePresetKey] || {}).label || activePresetKey;
        const summary = [rosterFilter, viewLabel, ppgLabelMap[ppgWindow] || ppgWindow, rowLabelMap[rowDensity] || rowDensity, groupLabel].join(' · ');
        return (
          <button onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--surf-solid, rgba(20,20,26,0.72))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: 'var(--card-radius)', padding: '10px 12px', minHeight: '44px', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em', flexShrink: 0 }}>Filters</span>
            {!filtersOpen && <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{summary}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, whiteSpace: 'nowrap', flexShrink: 0 }}>{filtered.length}/{allPlayers.length}</span>
            <span style={{ color: 'var(--gold)', fontSize: 'var(--text-body, 1rem)', flexShrink: 0, transition: 'transform 0.15s', transform: filtersOpen ? 'rotate(180deg)' : 'none' }}>{'▾'}</span>
          </button>
        );
      })()}

      {/* Phone (≤767): the expanded filter row must wrap — 6 selects + Customize
          + SavedViewBar are ~700px of nowrap controls, which overflow a 375px
          viewport with no scroll path (body is overflow-x:clip). Tablet/desktop
          keep the shipped single-line nowrap bar. */}
      {(!isCompactRoster || filtersOpen) && (
      <section style={{ background: 'var(--surf-solid, rgba(20,20,26,0.72))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: 'var(--card-radius)', padding: 'var(--card-pad-sm)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: rosterViewportWidth <= 767 ? 'wrap' : 'nowrap', minWidth: 0 }}>
        <span className="wr-module-toolbar-label">Scope</span>
        <select value={rosterFilter} onChange={e => setRosterFilter(e.target.value)} style={rosterSelectStyle(rosterFilter !== 'All')} title="Show a slot or position group">
          {rosterFilterOptions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <span className="wr-module-toolbar-label">View</span>
        <select value={activePresetKey} onChange={e => { const key = e.target.value; const cols = COLUMN_PRESETS[key]; if (!cols) return; setVisibleCols(cols); setColPreset(key); if (key === 'rookie') setRosterFilter('Rookies'); else if (rosterFilter === 'Rookies') setRosterFilter('All'); }} style={rosterSelectStyle(activePresetKey !== 'default')} title="Column preset">
          {Object.keys(COLUMN_PRESETS).map(key => <option key={key} value={key}>{COLUMN_PRESET_META[key]?.label || key}</option>)}
          {activePresetKey === 'custom' && <option value="custom">Custom</option>}
        </select>
        <button onClick={() => setShowColPicker(!showColPicker)} style={{ ...controlBtn(showColPicker || activePresetKey === 'custom'), minHeight: '44px', flexShrink: 0 }} title="Add, remove, or reorder columns">Customize</button>

        <span className="wr-module-toolbar-label">PPG</span>
        <select value={ppgWindow} onChange={e => setPpgWindow(e.target.value)} style={rosterSelectStyle(ppgWindow !== 'season')} title="Points-per-game window">
          <option value="season">Season</option>
          <option value="l5">L5</option>
          <option value="l3">L3</option>
        </select>

        <span className="wr-module-toolbar-label">Rows</span>
        <select value={rowDensity} onChange={e => setRowDensity(e.target.value)} style={rosterSelectStyle(rowDensity !== 'comfortable')} title="Row density">
          <option value="comfortable">Comfort</option>
          <option value="compact">Compact</option>
        </select>

        <span className="wr-module-toolbar-label">Group</span>
        <select value={rosterGroupMode} onChange={e => setRosterGroupMode(e.target.value)} style={rosterSelectStyle(rosterGroupMode !== 'position')} title="Group rows by">
          {GROUP_MODES.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, whiteSpace: 'nowrap' }}>{filtered.length} / {allPlayers.length} shown</span>
          {window.WR?.SavedViews?.SavedViewBar && React.createElement(window.WR.SavedViews.SavedViewBar, {
            surface: 'roster',
            leagueId: currentLeague?.id,
            currentState: { columns: visibleCols, sort: rosterSort, filters: { rosterFilter, rosterGroupMode, rowDensity } },
            onApply: (v) => {
              if (Array.isArray(v.columns) && v.columns.length) { setVisibleCols(v.columns); setColPreset('custom'); }
              if (v.sort && v.sort.key) setRosterSort({ key: v.sort.key, dir: v.sort.dir || 1 });
              if (v.filters && typeof v.filters.rosterFilter === 'string') setRosterFilter(v.filters.rosterFilter);
              if (v.filters && typeof v.filters.rosterGroupMode === 'string') setRosterGroupMode(v.filters.rosterGroupMode);
              if (v.filters && typeof v.filters.rowDensity === 'string') setRowDensity(v.filters.rowDensity);
            },
          })}
        </div>
      </section>
      )}
      </React.Fragment>}

      <div>

      {/* Column picker dropdown — desktop/tablet only; the phone tier re-homes
          the SAME showColPicker state into the WR.FilterSheet below (shared
          customizer treatment with Free Agency's colpick). */}
      {showColPicker && !_phone && (
        <div style={{ background: 'linear-gradient(180deg, var(--surf-solid, rgba(22,22,29,0.98)), var(--surf-solid, rgba(10,10,14,0.98)))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: '10px', padding: '12px', marginBottom: '10px', boxShadow: '0 10px 28px rgba(0,0,0,0.24)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-title, 1.125rem)', color: 'var(--white)', fontWeight: 700, letterSpacing: '0.04em' }}>Customize Columns</div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58 }}>{visibleCols.length} of {Object.keys(ROSTER_COLUMNS).length} active</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setCustomColumns(Object.keys(ROSTER_COLUMNS))} style={controlBtn(inactiveColumnCount === 0)}>All Fields</button>
              <button onClick={() => setCustomColumns(COLUMN_PRESETS.default)} style={controlBtn(activePresetKey === 'default')}>Reset Default</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: rosterViewportWidth <= 820 ? '1fr' : 'minmax(280px, 0.9fr) minmax(360px, 1.4fr)', gap: '12px', alignItems: 'start' }}>
            <div style={{ background: 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: '8px', padding: '10px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>Active Order</div>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.54 }}>{activeColumnOrder.length} visible</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', paddingRight: '2px' }}>
                {activeColumnOrder.length === 0 ? (
                  <div style={{ padding: '12px', borderRadius: '8px', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>Only the player column is visible.</div>
                ) : activeColumnOrder.map((key, idx) => {
                  const col = ROSTER_COLUMNS[key];
                  return (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) 26px 26px 26px', gap: '5px', alignItems: 'center', padding: '5px 6px', borderRadius: '7px', background: 'var(--acc-fill2, rgba(212,175,55,0.075))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))' }}>
                      <span style={{ color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'right' }}>{idx + 1}</span>
                      <span title={col.label} style={{ color: 'var(--white)', fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.shortLabel || col.label}</span>
                      <button disabled={idx === 0} onClick={() => moveVisibleColumn(key, -1)} title="Move left" style={{ height: '24px', borderRadius: '5px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === 0 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === 0 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === 0 ? 'default' : 'pointer' }}>{'\u2039'}</button>
                      <button disabled={idx === activeColumnOrder.length - 1} onClick={() => moveVisibleColumn(key, 1)} title="Move right" style={{ height: '24px', borderRadius: '5px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === activeColumnOrder.length - 1 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === activeColumnOrder.length - 1 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === activeColumnOrder.length - 1 ? 'default' : 'pointer' }}>{'\u203A'}</button>
                      <button onClick={() => removeVisibleColumn(key)} title="Hide column" style={{ height: '24px', borderRadius: '5px', border: '1px solid rgba(231,76,60,0.22)', background: 'rgba(231,76,60,0.08)', color: 'var(--bad)', cursor: 'pointer' }}>{'\u00D7'}</button>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.07))' }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '7px' }}>Group Rows By</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {GROUP_MODES.map(opt => (
                    <button key={opt.key} onClick={() => setRosterGroupMode(opt.key)} style={controlBtn(rosterGroupMode === opt.key)}>{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
              {columnGroups.map(({ group, columns }) => (
                <div key={group} style={{ background: 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: '8px', padding: '8px' }}>
                  <div style={{ marginBottom: '6px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>{group}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {columns.map(([key, col]) => {
                      const active = visibleCols.includes(key);
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 7px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.74rem', background: active ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'var(--ov-1, rgba(255,255,255,0.018))', color: active ? 'var(--gold)' : 'var(--silver)', border: '1px solid ' + (active ? 'var(--acc-fill3, rgba(212,175,55,0.18))' : 'var(--ov-3, rgba(255,255,255,0.04))') }}>
                          <input type="checkbox" checked={active} onChange={() => {
                            if (active) removeVisibleColumn(key);
                            else addVisibleColumn(key);
                          }} style={{ accentColor: 'var(--gold)' }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Phone column customizer — the shared P3 FilterSheet treatment (same
          anatomy as Free Agency's colpick sheet): "Active (n)" 44px rows with
          the EXISTING ▲▼ move + × remove setters (moveVisibleColumn /
          removeVisibleColumn — same functions the desktop ‹ › buttons call),
          then "Available" add chips grouped by the EXISTING columnGroups
          metadata (addVisibleColumn). Free/Pro: ROSTER_COLUMNS.action is
          deleted upstream for free, so the option never exists here. */}
      {_phone && React.createElement(window.WR.FilterSheet, {
        open: !!showColPicker,
        onClose: () => setShowColPicker(false),
        title: 'Customize columns',
        sections: [
          { label: 'Active (' + activeColumnOrder.length + ')', node: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {activeColumnOrder.length === 0 ? (
                <div style={{ padding: '12px', borderRadius: '8px', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>Only the player column is visible.</div>
              ) : activeColumnOrder.map((key, idx) => {
                const col = ROSTER_COLUMNS[key];
                return (
                  <div key={key} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) 44px 44px 44px', gap: '3px', alignItems: 'center', minHeight: '44px', padding: '0 2px 0 8px', borderRadius: '7px', background: 'var(--acc-fill2, rgba(212,175,55,0.075))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))' }}>
                    <span style={{ color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'right' }}>{idx + 1}</span>
                    <span title={col.label} style={{ color: 'var(--white)', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.shortLabel || col.label}</span>
                    <button disabled={idx === 0} onClick={() => moveVisibleColumn(key, -1)} title="Move up" style={{ minWidth: '44px', minHeight: '44px', borderRadius: '5px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === 0 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === 0 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === 0 ? 'default' : 'pointer' }}>{'▲'}</button>
                    <button disabled={idx === activeColumnOrder.length - 1} onClick={() => moveVisibleColumn(key, 1)} title="Move down" style={{ minWidth: '44px', minHeight: '44px', borderRadius: '5px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === activeColumnOrder.length - 1 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === activeColumnOrder.length - 1 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === activeColumnOrder.length - 1 ? 'default' : 'pointer' }}>{'▼'}</button>
                    <button onClick={() => removeVisibleColumn(key)} title="Hide column" style={{ minWidth: '44px', minHeight: '44px', borderRadius: '5px', border: '1px solid rgba(231,76,60,0.22)', background: 'rgba(231,76,60,0.08)', color: 'var(--bad)', cursor: 'pointer' }}>{'×'}</button>
                  </div>
                );
              })}
            </div>
          ) },
          { label: 'Available', node: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {inactiveColumnCount === 0 && (
                <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>All columns are active.</div>
              )}
              {columnGroups.map(({ group, columns }) => {
                const inactive = columns.filter(([key]) => !visibleCols.includes(key));
                if (!inactive.length) return null;
                return (
                  <div key={group}>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '6px' }}>{group}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {inactive.map(([key, col]) => (
                        <button key={key} onClick={() => addVisibleColumn(key)} title={'Add ' + col.label} style={{ minHeight: '44px', padding: '7px 12px', fontSize: '0.74rem', fontFamily: 'var(--font-body)', background: 'var(--ov-1, rgba(255,255,255,0.018))', color: 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ {col.shortLabel || col.label}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) },
        ],
        footer: (
          <React.Fragment>
            <button onClick={() => setCustomColumns(Object.keys(ROSTER_COLUMNS))} style={{ ...controlBtn(inactiveColumnCount === 0), minHeight: '44px', flex: 1 }}>All fields</button>
            <button onClick={() => setCustomColumns(COLUMN_PRESETS.default)} style={{ ...controlBtn(false), minHeight: '44px', flex: 1 }}>Reset</button>
            <button onClick={() => setShowColPicker(false)} style={{ ...controlBtn(true), minHeight: '44px', flex: 1 }}>Done</button>
          </React.Fragment>
        ),
      })}

      {/* Review Roster triage strip (iPad pass, owner-approved 2026-07-12):
          the phone triage SHEET had no ≥768 equivalent — flags only lived
          inline per row. Same data seams as the phone sheet (_isActiveDrop /
          _effRec); chip tap expands the player on the board below. Collapsed
          to a one-line count by default. */}
      {!_phone && isPro && (() => {
        const dropAlerts = rows.filter(_isActiveDrop);
        const sellCalls = rows.filter(r => /sell/i.test(_effRec(r) || '') && !dropAlerts.some(d => d.pid === r.pid));
        if (!dropAlerts.length && !sellCalls.length) return null;
        const chip = (r, kind) => (
          <button key={kind + '-' + r.pid} type="button" onClick={() => setExpandedPid(prev => prev === r.pid ? null : r.pid)}
            title="Expand this player on the board below"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '999px', cursor: 'pointer', background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid ' + (kind === 'DROP' ? 'rgba(231,76,60,0.4)' : 'rgba(240,165,0,0.35)'), color: 'var(--white)', fontFamily: 'var(--font-body)', fontSize: '0.76rem', fontWeight: 600 }}>
            <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, color: kind === 'DROP' ? 'var(--bad)' : 'var(--warn)', letterSpacing: '0.04em' }}>{kind}</span>
            {getPlayerName(r.pid)}
            <span style={{ color: 'var(--silver)', opacity: 0.6, fontSize: 'var(--text-micro, 0.6875rem)' }}>{r.pos}</span>
          </button>
        );
        return (
          <div style={{ marginBottom: '10px', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '8px', background: 'var(--ov-1, rgba(255,255,255,0.015))', overflow: 'hidden' }}>
            <button type="button" onClick={() => setReviewStripOpen(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Review Roster</span>
              <span style={{ fontSize: '0.76rem', color: 'var(--silver)' }}>{dropAlerts.length} drop alert{dropAlerts.length === 1 ? '' : 's'} · {sellCalls.length} sell call{sellCalls.length === 1 ? '' : 's'}</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.74rem', color: 'var(--gold)', fontWeight: 700 }}>{reviewStripOpen ? 'Hide ▴' : 'Review ▾'}</span>
            </button>
            {reviewStripOpen && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '2px 12px 10px' }}>
                {dropAlerts.map(r => chip(r, 'DROP'))}
                {sellCalls.map(r => chip(r, 'SELL'))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Roster table with inline expand cards — desktop/tablet renders the
          hoisted board verbatim; the phone tier re-homes it: AssetRow card
          list by default, or the full board inside the scoped Deep Data
          scroll wrap (P7) so no column is ever lost. */}
      {!_phone && _renderRosterBoard()}
      {_phone && isDeepData && (
        <div className="wr-sticky-table-wrap" style={{ border: 'none' }}>{_renderRosterBoard()}</div>
      )}
      {_phone && !isDeepData && _renderPhoneCards()}

      {myDraftPicks.length > 0 && (
        <div style={{ marginTop: '12px', border: '1px solid var(--ov-5, rgba(255,255,255,0.075))', borderRadius: 'var(--card-radius)', overflow: 'hidden', background: 'var(--surf-solid, rgba(12,12,17,0.98))', boxShadow: '0 10px 24px rgba(0,0,0,0.2)' }}>
          <div style={{ padding: '7px 10px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', background: 'var(--ov-1, rgba(255,255,255,0.018))', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', color: 'var(--white)', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700 }}>Draft Picks</div>
            <div style={{ marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)' }}>{myDraftPicks.length} pick{myDraftPicks.length === 1 ? '' : 's'}</div>
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.keys(picksByYear).sort().map(yr => (
              <div key={yr} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', minWidth: '42px' }}>{yr}</span>
                {picksByYear[yr].map((p, i) => (
                  <span key={i} title={p.own ? 'Your own pick' : ('Acquired from ' + p.from)} style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '5px', fontFamily: 'JetBrains Mono, monospace', background: p.own ? 'var(--acc-fill2, rgba(212,175,55,0.10))' : 'rgba(124,107,248,0.13)', color: p.own ? 'var(--gold)' : 'var(--k-9b8afb, #9b8afb)', border: '1px solid ' + (p.own ? 'var(--acc-fill3, rgba(212,175,55,0.2))' : 'rgba(124,107,248,0.28)') }}>
                    R{p.round}{p.own ? '' : ' · ' + String(p.from).slice(0, 8)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
