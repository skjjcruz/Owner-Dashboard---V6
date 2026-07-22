// ══════════════════════════════════════════════════════════════════
// js/draft/trade-proposer.js — User-→-CPU trade proposer drawer
//
// Side drawer (slides in from right). Opened from Opponent Intel's
// "Propose Trade" button. User selects picks from their side + the
// target CPU's side; the drawer shows live DHQ totals, live psych
// taxes, and live acceptance likelihood. "Send" runs a 1.5s thinking
// animation then dispatches COMPLETE_PROPOSAL with the CPU's verdict.
//
// Depends on: styles.js, state.js, trade-simulator.js (evaluateUserProposal)
// Exposes:    window.DraftCC.TradeProposer
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, FONT_MONO } = window.DraftCC.styles;

    // Pick-in-round for "R2.01"-style labels. pick.slot is the team's draft
    // COLUMN (ownership key), so prefer pickInRound, then derive from overall
    // when a league size is available (saved drafts predating pickInRound).
    function pickPP(pick, leagueSize) {
        if (!pick) return 0;
        if (Number(pick.pickInRound) > 0) return Number(pick.pickInRound);
        const ls = Number(leagueSize) || 0;
        if (ls > 0 && Number(pick.overall) > 0) return ((Number(pick.overall) - 1) % ls) + 1;
        return Number(pick.slot) || 0;
    }

    // Compact error boundary for the embedded Find-a-Trade tab: a render failure in the
    // borrowed Trade Center component degrades to a switch-to-Build hint instead of
    // unmounting the whole drawer.
    class FinderBoundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch(err) { if (window.wrLog) window.wrLog('draft.tradeFinder', err); }
        render() {
            if (this.state.failed) {
                return (
                    <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', lineHeight: 1.5 }}>
                        Find-a-Trade hit a snag in this view. Switch to <strong style={{ color: 'var(--gold)' }}>Build a Trade</strong> to keep going.
                    </div>
                );
            }
            return this.props.children;
        }
    }

    // BUILD / FIND mode toggle — mirrors the main Trade Center analyzer's mode switch.
    function AnalyzerModeToggle({ mode, onChange, disabled }) {
        const tab = (key, label) => (
            <button
                onClick={() => !disabled && onChange(key)}
                disabled={disabled}
                style={{
                    flex: 1,
                    padding: '7px 8px',
                    background: mode === key ? 'var(--acc-fill3, rgba(212,175,55,0.16))' : 'var(--ov-3, rgba(255,255,255,0.04))',
                    border: '1px solid ' + (mode === key ? 'var(--acc-line2, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.12))'),
                    color: mode === key ? 'var(--gold)' : 'var(--silver)',
                    fontFamily: FONT_DISPL,
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    borderRadius: '5px',
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled ? 0.6 : 1,
                }}
            >{label}</button>
        );
        return (
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                {tab('build', 'Build a Trade')}
                {tab('find', 'Find a Trade')}
            </div>
        );
    }

    // NOTE: the draft "Find a Trade" tab is a native reimplementation (DraftTradeFinder,
    // below) built on sim.findFairPackages — it does NOT use the main app's trade
    // evaluator (window.App.TradeEngine / trade-calc.js buildDeal). Keep the two
    // analyzers in sync when changing trade logic.
    // Asset option groups for a roster — picks of all years (current draft + future) in
    // ONE group, players in another. Shared shape with the Build dropdowns.
    function buildAssetGroups(state, rosterId) {
        const sim = window.DraftCC?.tradeSimulator || {};
        const stt = window.DraftCC?.state || {};
        const pdata = window.S?.players || {};
        const fmtDhq = (v) => { const n = Number(v) || 0; return (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n))) + ' DHQ'; };
        const seasonPrefix = state.season ? state.season + ' ' : '';
        const remaining = (state.pickOrder || []).slice(state.currentIdx || 0).filter(p => String(p.rosterId) === String(rosterId));
        const pickOpts = remaining.map(p => ({ key: 'pick:' + p.round + '-' + p.teamIdx, type: 'pick', label: seasonPrefix + 'R' + p.round + '.' + String(pickPP(p, state.leagueSize) || 0).padStart(2, '0'), sub: sim.pickValueFor ? fmtDhq(sim.pickValueFor(state, p)) : '', asset: p }));
        const futures = (stt.buildFuturePickPool ? stt.buildFuturePickPool(state) : []).filter(fp => String(fp.ownerRosterId) === String(rosterId));
        const futureOpts = futures.map(fp => ({ key: 'fut:' + fp.year + ':' + fp.round + ':' + fp.fromRosterId, type: 'future', label: fp.year + ' R' + fp.round, sub: stt.futurePickValueFor ? fmtDhq(stt.futurePickValueFor(state, fp)) : '', asset: fp }));
        const pickedPids = new Set((state.picks || []).map(p => p.pid).filter(Boolean));
        const roster = (window.S?.rosters || []).find(r => String(r.roster_id) === String(rosterId));
        const playerIds = (roster?.players || []).filter(pid => pid && !pickedPids.has(pid));
        const playerOpts = playerIds.map(pid => ({ pid, val: sim.playerValueFor ? sim.playerValueFor(pid) : 0 })).sort((a, b) => b.val - a.val).slice(0, 60).map(({ pid, val }) => { const pd = pdata[pid] || {}; const pos = pd.position || pd.fantasy_positions?.[0] || ''; const nm = pd.full_name || ((pd.first_name || '') + ' ' + (pd.last_name || '')).trim() || pid; return { key: 'plr:' + pid, type: 'player', label: nm + (pos ? ' · ' + pos : ''), sub: fmtDhq(val), asset: pid }; });
        return [
            { label: 'This draft', options: pickOpts },
            { label: 'Future picks', options: futureOpts },
            { label: 'Players', options: playerOpts },
        ].filter(g => g.options.length);
    }

    // Native draft Find-a-Trade: pick a target asset (the partner's to ACQUIRE, or your
    // own to TRADE AWAY) from the same dropdowns as Build — picks of all years AND players
    // — and see fair candidate packages with DHQ variance, acceptance %, and grade. Click
    // a card to load it into Build.
    function DraftTradeFinder({ state, dispatch }) {
        const sim = window.DraftCC?.tradeSimulator || {};
        const drawer = state.proposerDrawer || {};
        const targetId = drawer.targetRosterId;
        const targetPersona = state.personas?.[targetId] || {};
        const mode = drawer.finderMode || 'acquire';
        const targetKey = drawer.finderTargetKey || '';
        const setMode = (m) => dispatch({ type: 'UPDATE_PROPOSER', payload: { finderMode: m, finderTargetKey: '' } });
        const setTargetKey = (k) => dispatch({ type: 'UPDATE_PROPOSER', payload: { finderTargetKey: k } });

        const sourceRoster = mode === 'acquire' ? targetId : state.userRosterId;
        const groups = React.useMemo(() => buildAssetGroups(state, sourceRoster),
            [state.pickOrder, state.currentIdx, state.season, state.futurePicksLedger, state.tradedAssets, sourceRoster]);
        const allOpts = groups.flatMap(g => g.options);
        const target = allOpts.find(o => o.key === targetKey);

        const candidates = React.useMemo(() => {
            if (!target || !sim.findFairPackages) return [];
            try { return sim.findFairPackages(state, targetId, target.asset, target.type, mode); }
            catch (e) { if (window.wrLog) window.wrLog('draft.findFair', e); return []; }
        }, [state.pickOrder, state.currentIdx, state.personas, state.tradedAssets, targetKey, mode, targetId]);

        const loadProposal = (proposal) => {
            dispatch({ type: 'UPDATE_PROPOSER', payload: {
                analyzerMode: 'build',
                myGive: proposal.myGive || [], theirGive: proposal.theirGive || [],
                myGivePlayers: proposal.myGivePlayers || [], theirGivePlayers: proposal.theirGivePlayers || [],
                myGiveFuture: proposal.myGiveFuture || [], theirGiveFuture: proposal.theirGiveFuture || [],
                myGiveFaab: proposal.myGiveFaab || 0, theirGiveFaab: proposal.theirGiveFaab || 0,
                status: 'building',
            }});
        };

        const modeBtn = (key, label) => (
            <button onClick={() => setMode(key)} style={{
                flex: 1, padding: '7px 8px',
                background: mode === key ? 'var(--acc-fill3, rgba(212,175,55,0.16))' : 'var(--ov-3, rgba(255,255,255,0.04))',
                border: '1px solid ' + (mode === key ? 'var(--acc-line2, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.12))'),
                color: mode === key ? 'var(--gold)' : 'var(--silver)', fontFamily: FONT_DISPL, fontWeight: 700,
                fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderRadius: '5px', cursor: 'pointer',
            }}>{label}</button>
        );
        const metric = (label, value, valCol) => (
            <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: FONT_DISPL, color: valCol }}>{value}</div>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.85 }}>{label}</div>
            </div>
        );

        return (
            <FinderBoundary>
                <div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        {modeBtn('acquire', 'Acquire')}
                        {modeBtn('away', 'Trade away')}
                    </div>
                    <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                        {mode === 'acquire' ? ('Acquire from ' + (targetPersona.teamName || 'them')) : 'Trade away (your asset)'}
                    </div>
                    <select value={targetKey} onChange={(e) => setTargetKey(e.target.value)}
                        style={{ width: '100%', minHeight: '38px', padding: '6px 8px', marginBottom: 12, background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '5px', color: 'var(--white)', fontFamily: FONT_UI, fontSize: '0.74rem', cursor: 'pointer' }}>
                        <option value="">{mode === 'acquire' ? '+ pick an asset to acquire…' : '+ pick an asset to shop…'}</option>
                        {groups.map((g, gi) => (
                            <optgroup key={gi} label={g.label}>
                                {g.options.map(o => <option key={o.key} value={o.key}>{o.label + (o.sub ? ' · ' + o.sub : '')}</option>)}
                            </optgroup>
                        ))}
                    </select>
                    {target && candidates.length === 0 && (
                        <div style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-label, 0.75rem)', opacity: 0.8 }}>
                            No fair package found for {target.label}. Try another asset or Build one manually.
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {candidates.map((c, ci) => {
                            const ev = c.evaluation || {};
                            const variance = Math.round((ev.theirGiveDHQ || 0) - (ev.myGiveDHQ || 0));
                            const vCol = variance > 0 ? 'var(--good)' : variance < 0 ? 'var(--bad)' : 'var(--silver)';
                            const accCol = (ev.likelihood || 0) >= (ev.acceptanceLine || 70) ? 'var(--good)' : (ev.likelihood || 0) >= (ev.counterLine || 50) ? 'var(--warn)' : 'var(--bad)';
                            const grade = ev.grade?.grade || '—';
                            return (
                                <button key={ci} onClick={() => loadProposal(c.proposal)} style={{
                                    textAlign: 'left', padding: '8px', background: 'var(--ov-2, rgba(255,255,255,0.03))',
                                    border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderLeft: '3px solid ' + accCol,
                                    borderRadius: '5px', color: 'var(--silver)', cursor: 'pointer', fontFamily: FONT_UI,
                                }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 'var(--text-label, 0.75rem)', lineHeight: 1.35, marginBottom: 6 }}>
                                        <span style={{ color: 'var(--silver)' }}><strong style={{ color: 'var(--bad)' }}>Give:</strong> {proposalAssets(c.proposal, 'my', state.leagueSize)}</span>
                                        <span style={{ color: 'var(--silver)' }}><strong style={{ color: 'var(--good)' }}>Get:</strong> {proposalAssets(c.proposal, 'their', state.leagueSize)}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: '1px solid var(--ov-5, rgba(255,255,255,0.08))' }}>
                                        {metric('DHQ variance', (variance > 0 ? '+' : '') + variance.toLocaleString(), vCol)}
                                        {metric('Acceptance', (ev.likelihood || 0) + '%', accCol)}
                                        {metric('Grade', grade, 'var(--gold)')}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </FinderBoundary>
        );
    }

    function TradeProposer({ state, dispatch }) {
        const drawer = state.proposerDrawer;
        if (!drawer) return null;

        const targetId = drawer.targetRosterId;
        const targetPersona = state.personas?.[targetId];
        const myPersona = state.personas?.[state.userRosterId];
        if (!targetPersona) return null;
        const sameId = (a, b) => String(a) === String(b);
        const simulator = window.DraftCC.tradeSimulator;
        const isLiveSync = state.mode === 'live-sync';
        const currentSlot = state.pickOrder[state.currentIdx] || null;

        // Analyzer mode: 'build' (manual two-sided builder, the default) vs 'find'
        // (the embedded Trade Center auto-proposer) — full analyzer parity.
        const analyzerMode = drawer.analyzerMode || 'build';
        const setAnalyzerMode = (m) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            dispatch({ type: 'UPDATE_PROPOSER', payload: { analyzerMode: m } });
        };

        const partnerOptions = React.useMemo(() => {
            return Object.entries(state.personas || {})
                .filter(([rid]) => !sameId(rid, state.userRosterId))
                .map(([rid, persona]) => ({
                    rosterId: rid,
                    name: persona.teamName || ('Team ' + rid),
                    dna: persona.tradeDna?.label || persona.draftDna?.label || 'Balanced',
                    posture: persona.posture?.label || 'Neutral',
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
        }, [state.personas, state.userRosterId]);

        // Remaining picks (not yet made)
        const remaining = state.pickOrder.slice(state.currentIdx);
        const myRemainingPicks = remaining.filter(p => sameId(p.rosterId, state.userRosterId));
        const theirRemainingPicks = remaining.filter(p => sameId(p.rosterId, targetId));

        // Currently selected on each side
        const myGiveIds = new Set((drawer.myGive || []).map(p => p.round + '-' + p.teamIdx));
        const theirGiveIds = new Set((drawer.theirGive || []).map(p => p.round + '-' + p.teamIdx));

        const togglePick = (pick, side) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            const key = pick.round + '-' + pick.teamIdx;
            const arr = side === 'my' ? (drawer.myGive || []) : (drawer.theirGive || []);
            const exists = arr.some(p => (p.round + '-' + p.teamIdx) === key);
            const next = exists
                ? arr.filter(p => (p.round + '-' + p.teamIdx) !== key)
                : [...arr, pick];
            dispatch({
                type: 'UPDATE_PROPOSER',
                payload: side === 'my' ? { myGive: next, status: 'building' } : { theirGive: next, status: 'building' },
            });
        };

        const currentProposal = React.useMemo(() => ({
            targetRosterId: targetId,
            myGive: drawer.myGive || [],
            theirGive: drawer.theirGive || [],
            myGivePlayers: drawer.myGivePlayers || [],
            theirGivePlayers: drawer.theirGivePlayers || [],
            myGiveFuture: drawer.myGiveFuture || [],
            theirGiveFuture: drawer.theirGiveFuture || [],
            myGiveFaab: drawer.myGiveFaab || 0,
            theirGiveFaab: drawer.theirGiveFaab || 0,
        }), [targetId, drawer.myGive, drawer.theirGive, drawer.myGivePlayers, drawer.theirGivePlayers, drawer.myGiveFuture, drawer.theirGiveFuture, drawer.myGiveFaab, drawer.theirGiveFaab]);

        const partnerProfile = React.useMemo(() => {
            return simulator?.describeTradePartner ? simulator.describeTradePartner(state, targetId) : null;
        }, [simulator, state.pickOrder, state.picks, state.tradedAssets, state.personas, state.currentIdx, targetId]);

        const evaluation = React.useMemo(() => {
            if (!simulator) return { likelihood: 0, grade: null, taxes: [], myGiveDHQ: 0, theirGiveDHQ: 0 };
            return simulator.evaluateUserProposal(state, currentProposal, { preview: true });
        }, [simulator, currentProposal, state.pickOrder, state.currentIdx, targetPersona, myPersona]);

        // NOTE: intentionally NOT fed the live currentProposal. Doing so made the rail
        // regenerate an "Add Sweetener" package the moment you loaded a suggestion —
        // i.e. clicking one package spawned a new one. The rail stays stable now.
        const packageSuggestions = React.useMemo(() => {
            if (!simulator?.buildTradeSuggestions) return [];
            return simulator.buildTradeSuggestions(state, targetId);
        }, [simulator, state.pickOrder, state.currentIdx, state.personas, state.tradedAssets, targetId]);

        // Sandbox future-pick pool (next-season picks), ownership reflecting the ledger.
        const futurePool = React.useMemo(() => (
            window.DraftCC?.state?.buildFuturePickPool ? window.DraftCC.state.buildFuturePickPool(state) : []
        ), [state.season, state.rounds, state.leagueSize, state.futurePicksLedger, state.personas]);

        // Phase 7 deferred: players + FAAB togglers
        const togglePlayer = (pid, side) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            const key = side === 'my' ? 'myGivePlayers' : 'theirGivePlayers';
            const arr = drawer[key] || [];
            const exists = arr.includes(pid);
            const next = exists ? arr.filter(p => p !== pid) : [...arr, pid];
            dispatch({ type: 'UPDATE_PROPOSER', payload: { [key]: next, status: 'building' } });
        };
        const setFaab = (val, side) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            const key = side === 'my' ? 'myGiveFaab' : 'theirGiveFaab';
            dispatch({ type: 'UPDATE_PROPOSER', payload: { [key]: Math.max(0, Math.min(1000, Number(val) || 0)), status: 'building' } });
        };
        // Future (next-season) picks — sandbox assets keyed by year:round:fromRosterId.
        const futureKeyOf = (fp) => 'FUT:' + fp.year + ':' + fp.round + ':' + fp.fromRosterId;
        const toggleFuture = (fp, side) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            const key = side === 'my' ? 'myGiveFuture' : 'theirGiveFuture';
            const arr = drawer[key] || [];
            const exists = arr.some(p => futureKeyOf(p) === futureKeyOf(fp));
            const next = exists ? arr.filter(p => futureKeyOf(p) !== futureKeyOf(fp)) : [...arr, fp];
            dispatch({ type: 'UPDATE_PROPOSER', payload: { [key]: next, status: 'building' } });
        };
        const myFuturePicks = futurePool.filter(fp => String(fp.ownerRosterId) === String(state.userRosterId));
        const theirFuturePicks = futurePool.filter(fp => String(fp.ownerRosterId) === String(targetId));
        const myFutureSel = new Set((drawer.myGiveFuture || []).map(futureKeyOf));
        const theirFutureSel = new Set((drawer.theirGiveFuture || []).map(futureKeyOf));
        const addAsset = (asset, type, side) => {
            if (type === 'pick') togglePick(asset, side);
            else if (type === 'player') togglePlayer(asset, side);
            else if (type === 'future') toggleFuture(asset, side);
        };

        const onTargetChange = (targetRosterId) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            dispatch({
                type: 'UPDATE_PROPOSER',
                payload: {
                    targetRosterId,
                    theirGive: [],
                    theirGivePlayers: [],
                    theirGiveFuture: [],
                    theirGiveFaab: 0,
                    finderTargetKey: '',
                    status: 'building',
                    counterOffer: null,
                    lastEvaluation: null,
                },
            });
        };

        const loadProposal = (proposal) => {
            if (!proposal || drawer.status === 'sending' || drawer.status === 'accepted') return;
            dispatch({
                type: 'UPDATE_PROPOSER',
                payload: {
                    targetRosterId: proposal.targetRosterId || targetId,
                    myGive: proposal.myGive || [],
                    theirGive: proposal.theirGive || [],
                    myGivePlayers: proposal.myGivePlayers || [],
                    theirGivePlayers: proposal.theirGivePlayers || [],
                    myGiveFuture: proposal.myGiveFuture || [],
                    theirGiveFuture: proposal.theirGiveFuture || [],
                    myGiveFaab: proposal.myGiveFaab || 0,
                    theirGiveFaab: proposal.theirGiveFaab || 0,
                    status: 'building',
                    counterOffer: null,
                    lastEvaluation: null,
                },
            });
        };

        // Surface each side's existing rosters (exclude players already picked in the draft)
        const pickedPids = new Set((state.picks || []).map(p => p.pid).filter(Boolean));
        const rosterOf = (rid) => {
            const rosters = window.S?.rosters || [];
            const r = rosters.find(x => String(x.roster_id) === String(rid));
            return (r?.players || []).filter(pid => pid && !pickedPids.has(pid));
        };
        const myPlayerIds = rosterOf(state.userRosterId);
        const theirPlayerIds = rosterOf(targetId);

        // Asset selectors as scrollable dropdowns (one per side, grouped) instead of a
        // grid of chips — keeps the drawer light. Each option carries its type so a
        // single handler routes to the right toggler.
        const fmtDhq = (v) => { const n = Number(v) || 0; return (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n))) + ' DHQ'; };
        const pdata = window.S?.players || {};
        const playerName = (pid) => { const p = pdata[pid] || {}; return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || pid; };
        const seasonPrefix = state.season ? state.season + ' ' : '';
        const pickOpts = (picks) => (picks || []).map(p => ({ key: p.round + '-' + p.teamIdx, type: 'pick', label: seasonPrefix + 'R' + p.round + '.' + String(pickPP(p, state.leagueSize) || 0).padStart(2, '0'), sub: simulator ? fmtDhq(simulator.pickValueFor(state, p)) : '', asset: p }));
        const playerOpts = (pids) => (pids || []).map(pid => ({ pid, val: simulator ? simulator.playerValueFor(pid) : 0 })).sort((a, b) => b.val - a.val).slice(0, 60).map(({ pid, val }) => { const pd = pdata[pid] || {}; const pos = pd.position || pd.fantasy_positions?.[0] || ''; return { key: pid, type: 'player', label: playerName(pid) + (pos ? ' · ' + pos : ''), sub: fmtDhq(val), asset: pid }; });
        const futureOpts = (picks) => (picks || []).map(fp => ({ key: futureKeyOf(fp), type: 'future', label: fp.year + ' R' + fp.round, sub: window.DraftCC?.state?.futurePickValueFor ? fmtDhq(window.DraftCC.state.futurePickValueFor(state, fp)) : '', asset: fp }));
        // Picks of all years (current draft + future seasons) share one group, ordered
        // earliest-first; players are their own group.
        const buildGroups = (picks, pids, futures) => [
            { label: 'This draft', options: pickOpts(picks) },
            { label: 'Future picks', options: futureOpts(futures) },
            { label: 'Players', options: playerOpts(pids) },
        ].filter(g => g.options.length);
        const giveGroups = buildGroups(myRemainingPicks, myPlayerIds, myFuturePicks);
        const getGroups = buildGroups(theirRemainingPicks, theirPlayerIds, theirFuturePicks);
        const giveSelectedKeys = new Set([...myGiveIds, ...(drawer.myGivePlayers || []), ...myFutureSel]);
        const getSelectedKeys = new Set([...theirGiveIds, ...(drawer.theirGivePlayers || []), ...theirFutureSel]);

        const onClose = () => dispatch({ type: 'CLOSE_PROPOSER' });

        const mySideHasAssets = (drawer.myGive?.length || 0) + (drawer.myGivePlayers?.length || 0) + (drawer.myGiveFuture?.length || 0) + (drawer.myGiveFaab || 0) > 0;
        const theirSideHasAssets = (drawer.theirGive?.length || 0) + (drawer.theirGivePlayers?.length || 0) + (drawer.theirGiveFuture?.length || 0) + (drawer.theirGiveFaab || 0) > 0;

        const onSend = () => {
            if (!mySideHasAssets || !theirSideHasAssets) return;
            if (isLiveSync) {
                const result = simulator.evaluateUserProposal(state, currentProposal);
                const stagedOffer = buildLiveOfferHandoff(state, targetPersona, currentProposal, result);
                dispatch({
                    type: 'UPDATE_PROPOSER',
                    payload: {
                        status: 'planned',
                        lastEvaluation: result,
                        counterOffer: result.counterOffer || null,
                    },
                });
                dispatch({ type: 'STAGE_LIVE_OFFER', offer: stagedOffer });
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'rule',
                        badge: 'T',
                        color: 'var(--gold)',
                        title: 'Live offer staged · ' + targetPersona.teamName,
                        text: 'Read-only plan: ' + result.likelihood + '% acceptance vs ' + result.acceptanceLine + '% Buyer Line. ' + (result.reason || 'Use this as the package to offer in your live draft room.'),
                        relatedPickNo: currentSlot?.overall || null,
                    },
                });
                return;
            }
            dispatch({ type: 'UPDATE_PROPOSER', payload: { status: 'sending' } });
            // CPU "thinks" for 1.5s, then evaluates against its buyer line.
            setTimeout(() => {
                const result = simulator.evaluateUserProposal(state, currentProposal);
                if (result.accepted) {
                    const offer = {
                        fromRosterId: targetId,
                        fromName: targetPersona.teamName,
                        toRosterId: state.userRosterId,
                        theirGive: currentProposal.theirGive,
                        myGive: currentProposal.myGive,
                        theirGivePlayers: currentProposal.theirGivePlayers || [],
                        myGivePlayers: currentProposal.myGivePlayers || [],
                        theirGiveFuture: currentProposal.theirGiveFuture || [],
                        myGiveFuture: currentProposal.myGiveFuture || [],
                        theirGiveFaab: currentProposal.theirGiveFaab || 0,
                        myGiveFaab: currentProposal.myGiveFaab || 0,
                        myGainDHQ: result.theirGiveDHQ,
                        myGiveDHQ: result.myGiveDHQ,
                        theirGainDHQ: result.myGiveDHQ,
                        theirGiveDHQ: result.theirGiveDHQ,
                        likelihood: result.likelihood,
                        acceptanceLine: result.acceptanceLine,
                        counterLine: result.counterLine,
                        grade: result.grade,
                        taxes: result.taxes,
                        modifiers: result.modifiers || [],
                        reason: result.reason || 'Accepted user proposal',
                        dnaLabel: targetPersona.tradeDna?.label || targetPersona.draftDna?.label || 'Balanced',
                    };
                    dispatch({ type: 'COMPLETE_PROPOSAL', accepted: true, offer });
                } else if (result.counterOffer) {
                    dispatch({
                        type: 'UPDATE_PROPOSER',
                        payload: {
                            status: 'countered',
                            counterOffer: result.counterOffer,
                            lastEvaluation: result,
                        },
                    });
                } else {
                    dispatch({ type: 'UPDATE_PROPOSER', payload: { status: 'declined', lastEvaluation: result } });
                }
            }, 1500);
        };

        const onAcceptCounter = () => {
            if (!drawer.counterOffer) return;
            dispatch({ type: 'COMPLETE_PROPOSAL', accepted: true, offer: drawer.counterOffer });
        };

        const onLoadCounter = () => {
            const c = drawer.counterOffer;
            if (!c) return;
            dispatch({
                type: 'UPDATE_PROPOSER',
                payload: {
                    myGive: c.myGive || [],
                    theirGive: c.theirGive || [],
                    myGivePlayers: c.myGivePlayers || [],
                    theirGivePlayers: c.theirGivePlayers || [],
                    myGiveFuture: c.myGiveFuture || [],
                    theirGiveFuture: c.theirGiveFuture || [],
                    myGiveFaab: c.myGiveFaab || 0,
                    theirGiveFaab: c.theirGiveFaab || 0,
                    status: 'building',
                    counterOffer: null,
                },
            });
        };

        const gradeCol = evaluation.grade?.col || evaluation.grade?.color || 'var(--gold)';
        const likelihoodCol = evaluation.likelihood >= 60 ? 'var(--good)'
            : evaluation.likelihood >= 40 ? 'var(--warn)'
            : 'var(--bad)';

        const isSending = drawer.status === 'sending';
        const isAccepted = drawer.status === 'accepted';
        const isDeclined = drawer.status === 'declined';
        const isCountered = drawer.status === 'countered';
        const isPlanned = drawer.status === 'planned';
        const counterOffer = drawer.counterOffer;
        const plannedEvaluation = drawer.lastEvaluation || evaluation;
        const stagedOffer = React.useMemo(() => {
            return (state.stagedLiveOffers || []).find(o => o.id === drawer.stagedOfferId)
                || (isPlanned ? buildLiveOfferHandoff(state, targetPersona, currentProposal, plannedEvaluation) : null);
        }, [state.stagedLiveOffers, drawer.stagedOfferId, isPlanned, targetPersona, currentProposal, plannedEvaluation]);
        const [copyStatus, setCopyStatus] = React.useState('');
        const onCopyPlanned = React.useCallback(() => {
            const text = stagedOffer?.copyText || '';
            copyText(text).then(ok => {
                setCopyStatus(ok ? 'Copied' : 'Copy failed');
                setTimeout(() => setCopyStatus(''), 1400);
            });
        }, [stagedOffer]);
        const onOpenSleeper = React.useCallback(() => {
            if (state.sleeperDraftId) {
                window.open('https://sleeper.com/draft/nfl/' + state.sleeperDraftId, '_blank', 'noopener,noreferrer');
            }
        }, [state.sleeperDraftId]);

        return (
            <div style={{
                position: 'fixed',
                top: 0,
                right: 0,
                bottom: 0,
                width: 'min(420px, 90vw)',
                background: 'var(--black)',
                borderLeft: '2px solid var(--gold)',
                boxShadow: '-12px 0 40px rgba(0,0,0,0.6)',
                zIndex: 600,
                display: 'flex',
                flexDirection: 'column',
                fontFamily: FONT_UI,
                animation: 'wrFadeIn 0.25s ease',
                // Notch clearance: full-height fixed drawer — keep the title/✕
                // out from under the status bar on installed-PWA phones.
                paddingTop: 'var(--sat, 0px)',
            }}>
                {/* Header */}
                <div style={{
                    padding: '14px 16px',
                    borderBottom: 'var(--card-border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flexShrink: 0,
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Propose Trade</div>
                        <select
                            value={String(targetId)}
                            disabled={isSending || isAccepted}
                            onChange={e => onTargetChange(e.target.value)}
                            title="Trade partner"
                            style={{
                                width: '100%',
                                marginTop: 4,
                                padding: '5px 7px',
                                background: 'var(--ov-3, rgba(255,255,255,0.04))',
                                border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))',
                                borderRadius: '5px',
                                color: 'var(--white)',
                                fontSize: '0.78rem',
                                fontFamily: FONT_DISPL,
                                fontWeight: 700,
                                outline: 'none',
                            }}
                        >
                            {partnerOptions.map(opt => (
                                <option key={opt.rosterId} value={String(opt.rosterId)}>
                                    {opt.name}
                                </option>
                            ))}
                        </select>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.9, marginTop: 3 }}>
                            {targetPersona.tradeDna?.label || '—'} · {targetPersona.posture?.label || '—'}
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none',
                        border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                        color: 'var(--silver)',
                        fontSize: '0.9rem',
                        width: 44,
                        height: 44,
                        minWidth: 44,
                        minHeight: 44,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        cursor: 'pointer',
                    }}>×</button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                    {/* Status banner */}
                    {isLiveSync && (
                        <div style={{
                            padding: '9px 10px',
                            background: 'rgba(124,107,248,0.08)',
                            border: '1px solid rgba(155,138,251,0.28)',
                            borderRadius: '5px',
                            fontSize: 'var(--text-micro, 0.6875rem)',
                            color: 'rgba(214,208,255,0.94)',
                            marginBottom: '12px',
                            lineHeight: 1.35,
                        }}>
                            <strong style={{ color: 'rgba(155,138,251,1)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live Draft Mode</strong>
                            {' '}Stages a package only. Dynasty HQ does not write trades to Sleeper.
                        </div>
                    )}
                    {isSending && (
                        <div style={{
                            padding: '10px',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.08))',
                            border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: 'var(--gold)',
                            textAlign: 'center',
                            marginBottom: '12px',
                        }}>
                            ⏳ {targetPersona.teamName} is thinking…
                        </div>
                    )}
                    {isAccepted && (
                        <div style={{
                            padding: '10px',
                            background: 'rgba(46,204,113,0.08)',
                            border: '1px solid rgba(46,204,113,0.3)',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: 'var(--good)',
                            textAlign: 'center',
                            marginBottom: '12px',
                            fontWeight: 700,
                        }}>
                            ✓ ACCEPTED — picks swapped
                        </div>
                    )}
                    {isCountered && counterOffer && (
                        <div style={{
                            padding: '10px',
                            background: 'rgba(240,165,0,0.08)',
                            border: '1px solid rgba(240,165,0,0.32)',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: 'var(--warn)',
                            marginBottom: '12px',
                        }}>
                            <div style={{ fontWeight: 800, marginBottom: 5 }}>COUNTER OFFER</div>
                            <div style={{ color: 'var(--silver)', opacity: 0.86, lineHeight: 1.35 }}>{counterOffer.reason || 'They will deal if the package clears their buyer line.'}</div>
                        </div>
                    )}
                    {isDeclined && (
                        <div style={{
                            padding: '10px',
                            background: 'rgba(231,76,60,0.08)',
                            border: '1px solid rgba(231,76,60,0.3)',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: 'var(--bad)',
                            textAlign: 'center',
                            marginBottom: '12px',
                        }}>
                            ✗ DECLINED — adjust the offer
                            {drawer.lastEvaluation?.reason && (
                                <div style={{ marginTop: 4, color: 'var(--silver)', opacity: 0.78, lineHeight: 1.3 }}>{drawer.lastEvaluation.reason}</div>
                            )}
                        </div>
                    )}
                    {isPlanned && (
                        <div style={{
                            padding: '10px',
                            background: 'rgba(124,107,248,0.08)',
                            border: '1px solid rgba(155,138,251,0.34)',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: 'rgba(214,208,255,0.96)',
                            marginBottom: '12px',
                            lineHeight: 1.35,
                        }}>
                            <div style={{ color: 'rgba(155,138,251,1)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                                Live Offer Staged
                            </div>
                            <div>
                                No Sleeper write. {plannedEvaluation.likelihood}% acceptance vs {plannedEvaluation.acceptanceLine || 70}% Buyer Line.
                            </div>
                            {plannedEvaluation.reason && (
                                <div style={{ marginTop: 4, color: 'var(--silver)', opacity: 0.82 }}>{plannedEvaluation.reason}</div>
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                <button onClick={onCopyPlanned} style={miniBtn('var(--good)')}>{copyStatus || 'COPY SUMMARY'}</button>
                                {state.sleeperDraftId && <button onClick={onOpenSleeper} style={miniBtn('rgba(155,138,251,1)')}>OPEN SLEEPER</button>}
                            </div>
                        </div>
                    )}

                    {/* Analyzer mode toggle — Build vs Find (Trade Center parity) */}
                    <AnalyzerModeToggle mode={analyzerMode} onChange={setAnalyzerMode} disabled={isSending || isAccepted} />

                    {/* Partner needs + tradable assets — always visible (Build AND Find) */}
                    <OwnerIntelCard profile={partnerProfile} leagueSize={state.leagueSize} />

                    {analyzerMode === 'find' ? (
                        <DraftTradeFinder state={state} dispatch={dispatch} />
                    ) : (
                    <React.Fragment>
                    <SuggestionRail
                        suggestions={packageSuggestions}
                        onLoad={loadProposal}
                        disabled={isSending || isAccepted}
                        state={state}
                    />

                    {/* Live fairness / likelihood */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: '8px',
                        marginBottom: '14px',
                    }}>
                        <div style={{
                            padding: '8px',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.1))',
                            border: '1px solid var(--ov-6, rgba(255,255,255,0.14))',
                            borderRadius: '5px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: gradeCol, fontFamily: FONT_DISPL }}>
                                {evaluation.grade?.grade || '—'}
                            </div>
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
                                {evaluation.grade?.label || 'Empty'}
                            </div>
                        </div>
                        <div style={{
                            padding: '8px',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.1))',
                            border: '1px solid var(--ov-6, rgba(255,255,255,0.14))',
                            borderRadius: '5px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: likelihoodCol, fontFamily: FONT_DISPL }}>
                                {evaluation.likelihood}%
                            </div>
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
                                Acceptance
                            </div>
                        </div>
                        <div style={{
                            padding: '8px',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.1))',
                            border: '1px solid var(--ov-6, rgba(255,255,255,0.14))',
                            borderRadius: '5px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--gold)', fontFamily: FONT_DISPL }}>
                                {evaluation.acceptanceLine || 70}%
                            </div>
                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>
                                Buyer Line
                            </div>
                        </div>
                    </div>

                    {evaluation.verdict && (
                        <div style={{
                            marginBottom: 12,
                            padding: '8px 10px',
                            border: '1px solid var(--acc-line2, rgba(212,175,55,0.34))',
                            background: 'var(--acc-fill3, rgba(212,175,55,0.14))',
                            borderRadius: 5,
                            color: 'var(--silver)',
                            fontSize: 'var(--text-label, 0.75rem)',
                            lineHeight: 1.4,
                        }}>
                            <strong style={{ color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                {evaluation.verdict === 'accepted' ? 'Likely accept' : evaluation.verdict === 'countered' ? 'Likely counter' : 'Likely decline'}
                            </strong>
                            {' · '}{evaluation.reason || 'Owner DNA, raw DHQ, and mock trade tuning drive this read.'}
                        </div>
                    )}

                    {isCountered && counterOffer && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                            <PickSide
                                label="Counter: you give"
                                color="var(--k-e74c3c, #e74c3c)"
                                picks={counterOffer.myGive}
                                playerIds={counterOffer.myGivePlayers}
                                faab={counterOffer.myGiveFaab}
                                dhq={counterOffer.myGiveDHQ}
                                empty="Nothing selected"
                                leagueSize={state.leagueSize}
                            />
                            <PickSide
                                label="Counter: you get"
                                color="var(--k-2ecc71, #2ecc71)"
                                picks={counterOffer.theirGive}
                                playerIds={counterOffer.theirGivePlayers}
                                faab={counterOffer.theirGiveFaab}
                                dhq={counterOffer.myGainDHQ}
                                empty="Nothing selected"
                                leagueSize={state.leagueSize}
                            />
                        </div>
                    )}

                    {/* Pick swap summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                        <PickSide
                            label="You give"
                            color="var(--k-e74c3c, #e74c3c)"
                            picks={drawer.myGive}
                            playerIds={drawer.myGivePlayers}
                            faab={drawer.myGiveFaab}
                            dhq={evaluation.myGiveDHQ}
                            empty="Nothing selected"
                            leagueSize={state.leagueSize}
                        />
                        <PickSide
                            label="You get"
                            color="var(--k-2ecc71, #2ecc71)"
                            picks={drawer.theirGive}
                            playerIds={drawer.theirGivePlayers}
                            faab={drawer.theirGiveFaab}
                            dhq={evaluation.theirGiveDHQ}
                            empty="Nothing selected"
                            leagueSize={state.leagueSize}
                        />
                    </div>

                    {/* Asset selectors — two scrollable dropdowns (picks / players /
                        future picks grouped), instead of a grid of chips. */}
                    <AssetSelect
                        title="You give"
                        placeholder="+ add a pick, player, or future pick…"
                        groups={giveGroups}
                        selectedKeys={giveSelectedKeys}
                        onPick={(asset, type) => addAsset(asset, type, 'my')}
                        disabled={isSending || isAccepted}
                    />
                    <AssetSelect
                        title={'You get from ' + targetPersona.teamName}
                        placeholder="+ add a pick, player, or future pick…"
                        groups={getGroups}
                        selectedKeys={getSelectedKeys}
                        onPick={(asset, type) => addAsset(asset, type, 'their')}
                        disabled={isSending || isAccepted}
                    />
                    <FaabRow
                        myFaab={drawer.myGiveFaab || 0}
                        theirFaab={drawer.theirGiveFaab || 0}
                        onChange={(val, side) => setFaab(val, side)}
                        disabled={isSending || isAccepted}
                        myLabel="Your FAAB"
                        theirLabel={targetPersona.teamName + "'s FAAB"}
                    />
                    {(drawer.myGiveFuture?.length || drawer.theirGiveFuture?.length) ? (
                        <div style={{ marginTop: '4px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7, lineHeight: 1.4 }}>
                            Future picks are sandboxed to this draft — they don't affect your real league.
                        </div>
                    ) : null}

                    {/* Psych taxes */}
                    {evaluation.taxes && evaluation.taxes.length > 0 && (
                        <div style={{ marginTop: '12px' }}>
                            <div style={{
                                fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 700,
                                color: 'var(--gold)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                marginBottom: '5px',
                            }}>Psych Taxes</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {evaluation.taxes.map((t, i) => {
                                    const isTax = (t.impact || 0) < 0;
                                    const col = isTax ? 'var(--bad)' : 'var(--good)';
                                    return (
                                        <div key={i} title={t.desc || ''} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            fontSize: 'var(--text-label, 0.75rem)',
                                            padding: '6px 8px',
                                            borderLeft: '2px solid ' + col,
                                        }}>
                                            <span style={{
                                                color: 'var(--silver)',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                flex: 1,
                                                opacity: 0.95,
                                            }}>{t.name}</span>
                                            <span style={{ color: col, fontWeight: 700, marginLeft: '8px', textAlign: 'right', flexShrink: 0 }}>
                                                {(t.impact || 0) > 0 ? '+' : ''}{t.impact}{typeof t.impact === 'number' ? '%' : ''}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {evaluation.modifiers && evaluation.modifiers.length > 0 && (
                        <div style={{ marginTop: '12px' }}>
                            <div style={{
                                fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 700,
                                color: 'var(--gold)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                marginBottom: '5px',
                            }}>Owner DNA Drivers</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {evaluation.modifiers.slice(0, 6).map((m, i) => {
                                    const col = (m.impact || 0) >= 0 ? 'var(--good)' : 'var(--bad)';
                                    return (
                                        <div key={i} title={m.detail || ''} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            fontSize: 'var(--text-label, 0.75rem)',
                                            padding: '6px 8px',
                                            borderLeft: '2px solid ' + col,
                                        }}>
                                            <span style={{ color: 'var(--silver)', opacity: 0.95, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</span>
                                            <span style={{ color: col, fontWeight: 700, marginLeft: '8px', textAlign: 'right', flexShrink: 0 }}>{(m.impact || 0) > 0 ? '+' : ''}{m.impact}%</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {/* Net modifier total — the analyzer's signature readout: the sum of
                        every psych tax + owner-DNA driver applied to the base acceptance. */}
                    {((evaluation.taxes && evaluation.taxes.length) || (evaluation.modifiers && evaluation.modifiers.length)) ? (
                        <div style={{
                            marginTop: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 10px',
                            borderTop: '1px solid var(--ov-6, rgba(255,255,255,0.14))',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.1))',
                            borderRadius: '5px',
                        }}>
                            <span style={{
                                fontSize: 'var(--text-label, 0.75rem)',
                                fontWeight: 700,
                                color: 'var(--gold)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                            }}>Net Modifier</span>
                            <span style={{
                                fontSize: '0.95rem',
                                fontWeight: 700,
                                fontFamily: FONT_DISPL,
                                color: (evaluation.netModifier || 0) >= 0 ? 'var(--good)' : 'var(--bad)',
                            }}>{(evaluation.netModifier || 0) > 0 ? '+' : ''}{evaluation.netModifier || 0}%</span>
                        </div>
                    ) : null}
                    </React.Fragment>
                    )}
                </div>

                {/* Footer actions */}
                <div style={{
                    padding: '12px 16px',
                    borderTop: 'var(--card-border)',
                    display: 'flex',
                    gap: '8px',
                    flexShrink: 0,
                }}>
                    {isAccepted ? (
                        <button onClick={onClose} style={primaryBtn}>DONE</button>
                    ) : isCountered ? (
                        <>
                            <button onClick={onAcceptCounter} style={primaryBtn}>ACCEPT COUNTER</button>
                            <button onClick={onLoadCounter} style={secondaryBtn}>LOAD</button>
                            <button onClick={onClose} style={secondaryBtn}>CLOSE</button>
                        </>
                    ) : isPlanned ? (
                        <>
                            <button
                                onClick={() => dispatch({ type: 'UPDATE_PROPOSER', payload: { status: 'building', counterOffer: null, lastEvaluation: null } })}
                                style={primaryBtn}
                            >REWORK</button>
                            <button onClick={onClose} style={secondaryBtn}>CLOSE</button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={onSend}
                                disabled={isSending || !(mySideHasAssets && theirSideHasAssets)}
                                style={{
                                    ...primaryBtn,
                                    opacity: (isSending || !(mySideHasAssets && theirSideHasAssets)) ? 0.5 : 1,
                                    cursor: (isSending || !(mySideHasAssets && theirSideHasAssets)) ? 'not-allowed' : 'pointer',
                                }}
                            >{isSending ? 'SENDING…' : (isLiveSync ? 'STAGE LIVE OFFER' : 'SEND OFFER')}</button>
                            <button onClick={onClose} style={secondaryBtn}>CANCEL</button>
                        </>
                    )}
                </div>
            </div>
        );
    }

    function formatPick(pick, leagueSize) {
        return 'R' + pick.round + '.' + String(pickPP(pick, leagueSize) || 0).padStart(2, '0');
    }

    function playerName(pid) {
        const p = window.S?.players?.[pid] || {};
        const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
        return full || pid;
    }

    function proposalAssets(proposal, side, leagueSize) {
        const picks = side === 'my' ? proposal.myGive : proposal.theirGive;
        const futures = side === 'my' ? proposal.myGiveFuture : proposal.theirGiveFuture;
        const players = side === 'my' ? proposal.myGivePlayers : proposal.theirGivePlayers;
        const faab = side === 'my' ? proposal.myGiveFaab : proposal.theirGiveFaab;
        const items = [];
        (picks || []).slice(0, 3).forEach(p => items.push(formatPick(p, leagueSize)));
        (futures || []).slice(0, 2).forEach(fp => items.push(fp.year + ' R' + fp.round));
        (players || []).slice(0, 2).forEach(pid => items.push(playerName(pid)));
        if (faab > 0) items.push('$' + faab + ' FAAB');
        const shownAssets = Math.min((picks || []).length, 3) + Math.min((futures || []).length, 2) + Math.min((players || []).length, 2);
        const totalAssets = (picks || []).length + (futures || []).length + (players || []).length;
        if (totalAssets > shownAssets) items.push('+' + (totalAssets - shownAssets));
        return items.length ? items.join(', ') : 'No assets';
    }

    function buildLiveOfferHandoff(state, targetPersona, proposal, result) {
        const giveText = proposalAssets(proposal, 'my', state?.leagueSize);
        const getText = proposalAssets(proposal, 'their', state?.leagueSize);
        const partnerName = targetPersona?.teamName || ('Team ' + proposal?.targetRosterId);
        const line = result?.acceptanceLine || 70;
        const likelihood = result?.likelihood || 0;
        const grade = result?.grade?.grade || 'ungraded';
        const reason = result?.reason || 'Owner DNA, raw DHQ, and current board context drive this read.';
        const copyText = [
            'Live draft trade offer to ' + partnerName,
            'I give: ' + giveText,
            'I get: ' + getText,
            'Dynasty HQ read: ' + likelihood + '% acceptance vs ' + line + '% Buyer Line, grade ' + grade + '.',
            reason,
        ].join('\n');
        return {
            targetRosterId: proposal?.targetRosterId,
            partnerName,
            proposal: {
                targetRosterId: proposal?.targetRosterId,
                myGive: proposal?.myGive || [],
                theirGive: proposal?.theirGive || [],
                myGivePlayers: proposal?.myGivePlayers || [],
                theirGivePlayers: proposal?.theirGivePlayers || [],
                myGiveFuture: proposal?.myGiveFuture || [],
                theirGiveFuture: proposal?.theirGiveFuture || [],
                myGiveFaab: proposal?.myGiveFaab || 0,
                theirGiveFaab: proposal?.theirGiveFaab || 0,
            },
            giveText,
            getText,
            likelihood,
            acceptanceLine: line,
            grade,
            reason,
            copyText,
            sleeperDraftId: state?.sleeperDraftId || null,
        };
    }

    function copyText(text) {
        if (!text) return Promise.resolve(false);
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }
        window.prompt('Copy live offer summary:', text);
        return Promise.resolve(true);
    }

    function miniBtn(color) {
        return {
            padding: '10px 12px',
            minHeight: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--ov-3, rgba(255,255,255,0.04))',
            border: '1px solid ' + color,
            borderRadius: '4px',
            color,
            cursor: 'pointer',
            fontFamily: FONT_UI,
            fontSize: '0.6875rem',
            fontWeight: 900,
            letterSpacing: '0.04em',
        };
    }

    function OwnerIntelCard({ profile, leagueSize }) {
        if (!profile) return null;
        const chips = [
            profile.tradeDna?.label || 'Balanced',
            profile.posture?.label || 'Neutral',
            profile.window,
            profile.liquidity?.label,
        ].filter(Boolean).slice(0, 4);
        const needs = (profile.needs || []).slice(0, 5);
        const picks = (profile.movablePicks || []).slice(0, 3).map(p => 'R' + p.round + '.' + String(pickPP(p, leagueSize) || 0).padStart(2, '0'));
        const players = (profile.tradablePlayers || []).slice(0, 3).map(p => p.name);
        return (
            <div style={{
                marginBottom: 12,
                padding: '10px',
                border: '1px solid var(--acc-fill3, rgba(212,175,55,0.16))',
                background: 'var(--ov-2, rgba(255,255,255,0.025))',
                borderRadius: '6px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Owner Trade Intel
                    </div>
                    <div style={{ color: 'var(--gold)', fontFamily: FONT_DISPL, fontWeight: 800, fontSize: '0.78rem' }}>
                        {profile.buyerLine}% line
                    </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 7 }}>
                    {chips.map(chip => (
                        <span key={chip} style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.08))',
                            border: '1px solid var(--acc-fill3, rgba(212,175,55,0.18))',
                            color: 'var(--silver)',
                            fontSize: 'var(--text-label, 0.75rem)',
                            fontWeight: 700,
                        }}>{chip}</span>
                    ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.4 }}>
                    <div style={{ opacity: 0.9 }}>
                        <strong style={{ display: 'block', color: 'var(--white)', fontSize: 'var(--text-label, 0.75rem)', marginBottom: 2, opacity: 1 }}>Needs</strong>
                        {needs.length ? needs.join(', ') : 'No clear needs'}
                    </div>
                    <div style={{ opacity: 0.9 }}>
                        <strong style={{ display: 'block', color: 'var(--white)', fontSize: 'var(--text-label, 0.75rem)', marginBottom: 2, opacity: 1 }}>Tradable</strong>
                        {[...picks, ...players].slice(0, 4).join(', ') || 'No obvious assets'}
                    </div>
                </div>
                {profile.ownerIntelSummary && (
                    <div style={{ marginTop: 7, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.9, lineHeight: 1.4 }}>
                        {profile.ownerIntelSummary}
                    </div>
                )}
            </div>
        );
    }

    function SuggestionRail({ suggestions, onLoad, disabled, state }) {
        // Render even when the only item is a MOONSHOT (the no-viable-deal
        // fallback) — that is precisely the case where the user most needs a
        // surfaced path "in." Only bail when the rail is genuinely empty.
        if (!suggestions || suggestions.length === 0) return null;
        return (
            <div style={{ marginBottom: 14 }}>
                <div style={{
                    fontSize: 'var(--text-label, 0.75rem)',
                    fontWeight: 800,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 6,
                }}>Quick Packages</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {suggestions.map(s => {
                        const isMoonshot = !!s.isMoonshot;
                        const clears = s.likelihood >= s.acceptanceLine;
                        const near = !clears && s.verdict === 'countered';
                        const color = isMoonshot ? 'var(--warn)' : clears ? 'var(--good)' : near ? 'var(--warn)' : 'var(--bad)';
                        return (
                            <button
                                key={s.id}
                                disabled={disabled}
                                onClick={() => onLoad(s.proposal)}
                                title={s.rationale}
                                style={{
                                    textAlign: 'left',
                                    padding: '8px',
                                    background: isMoonshot ? 'var(--acc-fill2, rgba(240,165,0,0.1))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                    border: isMoonshot ? '1px solid ' + wrAlpha('var(--warn)', '55') : '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                                    borderLeft: '3px solid ' + color,
                                    borderRadius: '5px',
                                    color: 'var(--silver)',
                                    cursor: disabled ? 'not-allowed' : 'pointer',
                                    fontFamily: FONT_UI,
                                    opacity: disabled ? 0.5 : 1,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                        <strong style={{ color: isMoonshot ? 'var(--warn)' : 'var(--white)', fontSize: 'var(--text-label, 0.75rem)' }}>{s.label}</strong>
                                        {isMoonshot && (
                                            <span style={{
                                                fontSize: 'var(--text-micro, 0.6875rem)',
                                                fontWeight: 900,
                                                letterSpacing: '0.06em',
                                                color: 'var(--black)',
                                                background: 'var(--warn)',
                                                padding: '1px 5px',
                                                borderRadius: '3px',
                                            }}>MOONSHOT</span>
                                        )}
                                    </span>
                                    <span style={{ color, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
                                        {isMoonshot ? 'Long shot' : clears ? 'Likely' : near ? 'Stretch' : 'Unlikely'}
                                    </span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 'var(--text-label, 0.75rem)', lineHeight: 1.35, marginBottom: 6 }}>
                                    <span style={{ color: 'var(--silver)' }}><strong style={{ color: 'var(--bad)' }}>Give:</strong> {proposalAssets(s.proposal, 'my', state?.leagueSize)}</span>
                                    <span style={{ color: 'var(--silver)' }}><strong style={{ color: 'var(--good)' }}>Get:</strong> {proposalAssets(s.proposal, 'their', state?.leagueSize)}</span>
                                </div>
                                {/* DHQ variance · Acceptance · Grade — the numbers the user judges by */}
                                {(() => {
                                    const variance = Math.round((s.theirGiveDHQ || 0) - (s.myGiveDHQ || 0));
                                    const vCol = variance > 0 ? 'var(--good)' : variance < 0 ? 'var(--bad)' : 'var(--silver)';
                                    const grade = s.evaluation?.grade?.grade || s.grade?.grade || '—';
                                    const metric = (label, value, valCol) => (
                                        <div style={{ flex: 1, textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.95rem', fontWeight: 800, fontFamily: FONT_DISPL, color: valCol }}>{value}</div>
                                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.85 }}>{label}</div>
                                        </div>
                                    );
                                    return (
                                        <div style={{ display: 'flex', gap: 6, marginTop: 5, paddingTop: 6, borderTop: '1px solid var(--ov-5, rgba(255,255,255,0.08))' }}>
                                            {metric('DHQ variance', (variance > 0 ? '+' : '') + variance.toLocaleString(), vCol)}
                                            {metric('Acceptance', (s.likelihood || 0) + '%', color)}
                                            {metric('Grade', grade, 'var(--gold)')}
                                        </div>
                                    );
                                })()}
                                {isMoonshot && (
                                    <div style={{ marginTop: 5, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--warn)', fontWeight: 600, lineHeight: 1.35 }}>
                                        Low odds — but possible if they're desperate.
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    function PickSide({ label, color, picks, playerIds, faab, dhq, empty, leagueSize }) {
        const hasAny = (picks && picks.length > 0) || (playerIds && playerIds.length > 0) || (faab && faab > 0);
        const pdata = window.S?.players || {};
        const playerName = (pid) => {
            const p = pdata[pid];
            const n = p?.full_name || ((p?.first_name || '') + ' ' + (p?.last_name || '')).trim();
            return n || pid;
        };
        // Unmistakable directional cue: GIVE side gets a left red stripe + "→"
        // (assets leaving you), GET side gets a left green stripe + "←"
        // (assets coming to you).
        const isGive = String(label || '').toLowerCase().includes('give');
        const dirLabel = isGive ? (label + ' →') : ('← ' + label);
        return (
            <div style={{
                padding: '10px',
                background: wrAlpha(color, '08'),
                border: '1px solid ' + wrAlpha(color, '25'),
                borderLeft: '3px solid ' + color,
                borderRadius: '6px',
                minHeight: 66,
            }}>
                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>{dirLabel}</div>
                {hasAny ? (
                    <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '4px' }}>
                            {(picks || []).map((p, i) => (
                                <span key={'p'+i} style={{
                                    fontSize: 'var(--text-label, 0.75rem)',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    background: 'var(--ov-4, rgba(255,255,255,0.06))',
                                    color: 'var(--white)',
                                }}>R{p.round}.{String(pickPP(p, leagueSize) || 0).padStart(2, '0')}</span>
                            ))}
                            {(playerIds || []).map((pid) => (
                                <span key={'pl'+pid} title={playerName(pid)} style={{
                                    fontSize: 'var(--text-label, 0.75rem)',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    background: 'rgba(124,107,248,0.18)',
                                    color: 'var(--purple)',
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}>{playerName(pid)}</span>
                            ))}
                            {faab > 0 && (
                                <span style={{
                                    fontSize: 'var(--text-label, 0.75rem)',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    background: 'rgba(46,204,113,0.18)',
                                    color: 'var(--good)',
                                }}>${faab} FAAB</span>
                            )}
                        </div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', fontFamily: FONT_MONO, opacity: 0.9 }}>
                            ≈ {(dhq || 0).toLocaleString()} DHQ
                        </div>
                    </>
                ) : (
                    <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontStyle: 'italic' }}>{empty}</div>
                )}
            </div>
        );
    }

    // Scrollable dropdown asset selector — replaces the per-asset chip grids. Options
    // are grouped (Picks / Players / Future picks); selected items are listed as small
    // removable pills beneath, and marked with a ✓ in the list.
    function AssetSelect({ title, placeholder, groups, selectedKeys, onPick, disabled }) {
        const allOptions = (groups || []).flatMap(g => g.options);
        if (allOptions.length === 0) return null;
        const selected = allOptions.filter(o => selectedKeys.has(o.key));
        return (
            <div style={{ marginBottom: '8px' }}>
                <div style={{
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '4px',
                }}>{title}</div>
                <select
                    value=""
                    disabled={disabled}
                    onChange={(e) => { const o = allOptions.find(x => x.key === e.target.value); if (o) onPick(o.asset, o.type); e.target.value = ''; }}
                    style={{
                        width: '100%',
                        minHeight: '38px',
                        padding: '6px 8px',
                        background: 'var(--ov-3, rgba(255,255,255,0.04))',
                        border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                        borderRadius: '5px',
                        color: 'var(--white)',
                        fontFamily: FONT_UI,
                        fontSize: '0.74rem',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.5 : 1,
                    }}
                >
                    <option value="">{placeholder}</option>
                    {(groups || []).map((g, gi) => (
                        <optgroup key={gi} label={g.label}>
                            {g.options.map(o => (
                                <option key={o.key} value={o.key}>{(selectedKeys.has(o.key) ? '✓ ' : '') + o.label + (o.sub ? ' · ' + o.sub : '')}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                {selected.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                        {selected.map(o => (
                            <button
                                key={o.key}
                                disabled={disabled}
                                onClick={() => onPick(o.asset, o.type)}
                                title="Remove"
                                style={{
                                    padding: '3px 7px',
                                    minHeight: '26px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '0.6875rem',
                                    fontWeight: 700,
                                    background: 'var(--acc-line1, rgba(212,175,55,0.2))',
                                    border: '1px solid var(--acc-line3, rgba(212,175,55,0.5))',
                                    borderRadius: '4px',
                                    color: 'var(--gold)',
                                    cursor: disabled ? 'not-allowed' : 'pointer',
                                    fontFamily: FONT_UI,
                                }}
                            >
                                {o.label} <span style={{ opacity: 0.6 }}>×</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    function FaabRow({ myFaab, theirFaab, onChange, disabled, myLabel, theirLabel }) {
        const inputStyle = {
            width: '60px',
            padding: '4px 6px',
            background: 'var(--ov-3, rgba(255,255,255,0.04))',
            border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
            borderRadius: '4px',
            color: 'var(--white)',
            fontFamily: FONT_MONO,
            fontSize: '0.72rem',
            textAlign: 'right',
        };
        return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.6875rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    <span style={{ flex: 1 }}>{myLabel}</span>
                    <span style={{ color: 'var(--silver)' }}>$</span>
                    <input type="number" min="0" max="1000" value={myFaab} onChange={e => onChange(e.target.value, 'my')} disabled={disabled} style={inputStyle} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.6875rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    <span style={{ flex: 1 }}>{theirLabel}</span>
                    <span style={{ color: 'var(--silver)' }}>$</span>
                    <input type="number" min="0" max="1000" value={theirFaab} onChange={e => onChange(e.target.value, 'their')} disabled={disabled} style={inputStyle} />
                </label>
            </div>
        );
    }

    const primaryBtn = {
        flex: 1,
        padding: '10px',
        background: 'var(--gold)',
        color: 'var(--black)',
        border: 'none',
        borderRadius: '5px',
        fontSize: '0.78rem',
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: FONT_UI,
        letterSpacing: '0.04em',
    };

    const secondaryBtn = {
        padding: '10px 16px',
        background: 'transparent',
        color: 'var(--silver)',
        border: '1px solid var(--ov-6, rgba(255,255,255,0.1))',
        borderRadius: '5px',
        fontSize: '0.78rem',
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: FONT_UI,
    };

    // The in-draft trade desk is Scout Pro end-to-end: quick packages ranked by
    // acceptance likelihood, the live likelihood/grade read, psych-tax + DNA
    // drivers, and the send verdict all come from the persona simulator — a
    // raw-only builder here would dead-end at Send, so the whole drawer gates
    // (stronger than the row-6 split; noted for review). Wrapper keeps the big
    // component's hooks unmounted for free.
    function GatedTradeProposer(props) {
        const { state, dispatch } = props;
        if (typeof window.wrIsPro !== 'function' || window.wrIsPro()) return <TradeProposer {...props} />;
        if (!state.proposerDrawer) return null;
        const GatedRow = window.WrGatedMoreRow;
        return (
            <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(420px, 90vw)',
                background: 'var(--black)', borderLeft: '2px solid var(--gold)',
                boxShadow: '-12px 0 40px rgba(0,0,0,0.6)', zIndex: 600,
                display: 'flex', flexDirection: 'column', fontFamily: FONT_UI,
                animation: 'wrFadeIn 0.25s ease', paddingTop: 'var(--sat, 0px)',
            }}>
                <div style={{ padding: '14px 16px', borderBottom: 'var(--card-border)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    <div style={{ flex: 1, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Propose Trade</div>
                    <button onClick={() => dispatch({ type: 'CLOSE_PROPOSER' })} style={{ background: 'none', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', color: 'var(--silver)', fontSize: '0.9rem', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', cursor: 'pointer' }}>✕</button>
                </div>
                <div style={{ padding: '14px 16px' }}>
                    {GatedRow
                        ? <GatedRow title="Work the phones mid-draft" sub="Live acceptance odds, psych taxes, and owner-DNA trade reads are Scout Pro." feature="draft_trade_desk" />
                        : <div dangerouslySetInnerHTML={{ __html: window.wrLockCard ? window.wrLockCard('Draft Trade Desk', 'draft_trade_desk', 'In-draft trade negotiation is Scout Pro.') : '' }} />}
                </div>
            </div>
        );
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.TradeProposer = GatedTradeProposer;
})();
