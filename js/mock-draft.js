// ══════════════════════════════════════════════════════════════════
// js/mock-draft.js  —  Mock Draft Simulator
// Phases: setup → drafting → complete
// Globals (core.js): useState, useEffect, useMemo, useRef, useCallback
// ══════════════════════════════════════════════════════════════════

/* ── Fallback prospect pool (no league data required) ──────── */
const MDS_POOL = [
    { pid: 'qb-1',  pos: 'QB', name: 'Josh Allen',           dhq: 8800 },
    { pid: 'qb-2',  pos: 'QB', name: 'Patrick Mahomes',      dhq: 8600 },
    { pid: 'qb-3',  pos: 'QB', name: 'Lamar Jackson',        dhq: 8200 },
    { pid: 'qb-4',  pos: 'QB', name: 'Joe Burrow',           dhq: 7800 },
    { pid: 'qb-5',  pos: 'QB', name: 'Jalen Hurts',          dhq: 7400 },
    { pid: 'qb-6',  pos: 'QB', name: 'C.J. Stroud',          dhq: 7200 },
    { pid: 'qb-7',  pos: 'QB', name: 'Caleb Williams',       dhq: 7000 },
    { pid: 'qb-8',  pos: 'QB', name: 'Drake Maye',           dhq: 6600 },
    { pid: 'qb-9',  pos: 'QB', name: 'Anthony Richardson',   dhq: 6000 },
    { pid: 'qb-10', pos: 'QB', name: 'Dak Prescott',         dhq: 5600 },
    { pid: 'rb-1',  pos: 'RB', name: 'Christian McCaffrey',  dhq: 9200 },
    { pid: 'rb-2',  pos: 'RB', name: 'Bijan Robinson',       dhq: 8600 },
    { pid: 'rb-3',  pos: 'RB', name: 'Breece Hall',          dhq: 8400 },
    { pid: 'rb-4',  pos: 'RB', name: 'Jahmyr Gibbs',         dhq: 8200 },
    { pid: 'rb-5',  pos: 'RB', name: "De'Von Achane",        dhq: 7800 },
    { pid: 'rb-6',  pos: 'RB', name: 'Jonathon Brooks',      dhq: 7200 },
    { pid: 'rb-7',  pos: 'RB', name: 'Isiah Pacheco',        dhq: 7000 },
    { pid: 'rb-8',  pos: 'RB', name: 'Quinshon Judkins',     dhq: 6800 },
    { pid: 'rb-9',  pos: 'RB', name: 'TreVeyon Henderson',   dhq: 6400 },
    { pid: 'rb-10', pos: 'RB', name: 'Marshawn Lloyd',       dhq: 6200 },
    { pid: 'rb-11', pos: 'RB', name: 'Josh Jacobs',          dhq: 6000 },
    { pid: 'rb-12', pos: 'RB', name: 'Keaton Mitchell',      dhq: 5800 },
    { pid: 'rb-13', pos: 'RB', name: 'Tyler Allgeier',       dhq: 5600 },
    { pid: 'rb-14', pos: 'RB', name: 'Kendre Miller',        dhq: 5400 },
    { pid: 'rb-15', pos: 'RB', name: 'Roschon Johnson',      dhq: 5200 },
    { pid: 'wr-1',  pos: 'WR', name: 'Justin Jefferson',     dhq: 9600 },
    { pid: 'wr-2',  pos: 'WR', name: 'Marvin Harrison Jr.',  dhq: 8800 },
    { pid: 'wr-3',  pos: 'WR', name: 'Garrett Wilson',       dhq: 8800 },
    { pid: 'wr-4',  pos: 'WR', name: 'Jaxon Smith-Njigba',   dhq: 8400 },
    { pid: 'wr-5',  pos: 'WR', name: 'Tetairoa McMillan',    dhq: 8200 },
    { pid: 'wr-6',  pos: 'WR', name: 'Drake London',         dhq: 8000 },
    { pid: 'wr-7',  pos: 'WR', name: 'Chris Olave',          dhq: 7800 },
    { pid: 'wr-8',  pos: 'WR', name: 'Tyreek Hill',          dhq: 7600 },
    { pid: 'wr-9',  pos: 'WR', name: 'Jordan Addison',       dhq: 7600 },
    { pid: 'wr-10', pos: 'WR', name: 'Luther Burden III',    dhq: 7600 },
    { pid: 'wr-11', pos: 'WR', name: 'Emeka Egbuka',         dhq: 7400 },
    { pid: 'wr-12', pos: 'WR', name: 'Jaylen Waddle',        dhq: 7200 },
    { pid: 'wr-13', pos: 'WR', name: 'DK Metcalf',           dhq: 6800 },
    { pid: 'wr-14', pos: 'WR', name: 'Matthew Golden',       dhq: 7000 },
    { pid: 'wr-15', pos: 'WR', name: 'Jack Bech',            dhq: 6400 },
    { pid: 'te-1',  pos: 'TE', name: 'Trey McBride',         dhq: 8200 },
    { pid: 'te-2',  pos: 'TE', name: 'Sam LaPorta',          dhq: 7800 },
    { pid: 'te-3',  pos: 'TE', name: 'Kyle Pitts',           dhq: 7600 },
    { pid: 'te-4',  pos: 'TE', name: 'Colston Loveland',     dhq: 7600 },
    { pid: 'te-5',  pos: 'TE', name: 'Tyler Warren',         dhq: 7400 },
    { pid: 'te-6',  pos: 'TE', name: 'Travis Kelce',         dhq: 7200 },
    { pid: 'te-7',  pos: 'TE', name: 'Tucker Kraft',         dhq: 6400 },
    { pid: 'te-8',  pos: 'TE', name: 'Luke Musgrave',        dhq: 5800 },
];

/* ── Pool builder ──────────────────────────────────────────── */
function mdsBuildPool(playersData) {
    const normPos = window.App?.normPos || (p => p);
    const getDHQ = pid => {
        if (typeof window.dynastyValue === 'function') {
            const v = window.dynastyValue(pid);
            if (v > 0) return v;
        }
        return window.App?.LI?.playerScores?.[pid] || 0;
    };
    const VALID = (typeof getLeaguePositions === 'function') ? getLeaguePositions({ asSet: true }) : new Set(['QB','RB','WR','TE','K','DEF']);
    const src = playersData || window.S?.players || {};
    const live = Object.entries(src)
        .filter(([, p]) => VALID.has(normPos(p.position)) && p.status !== 'Inactive' && (p.first_name || p.full_name))
        .map(([pid, p]) => ({
            pid,
            name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            pos: normPos(p.position),
            team: p.team || 'FA',
            dhq: getDHQ(pid),
        }))
        .filter(p => p.dhq > 0)
        .sort((a, b) => b.dhq - a.dhq)
        .slice(0, 200);
    return live.length >= 40 ? live : MDS_POOL;
}

/* ── Pick order builder ────────────────────────────────────── */
function mdsBuildOrder(rounds, leagueSize, type) {
    const order = [];
    for (let r = 1; r <= rounds; r++) {
        const rev = type === 'snake' && r % 2 === 0;
        for (let s = 0; s < leagueSize; s++) {
            const teamIdx = rev ? leagueSize - 1 - s : s;
            order.push({ round: r, slot: s + 1, teamIdx, overall: order.length + 1 });
        }
    }
    return order;
}

/* ── AI pick logic ─────────────────────────────────────────── */
function mdsAIPick(teamIdx, available, teamRosters) {
    if (!available.length) return null;
    const myPos = teamRosters[teamIdx] || [];
    let best = null, bestScore = -Infinity;
    for (const p of available) {
        const count = myPos.filter(x => x === p.pos).length;
        const bonus = count === 0 ? 2000 : count === 1 ? 1000 : 0;
        const score = p.dhq + bonus + (Math.random() * 1000 - 500);
        if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
}

/* ── Draft grade ───────────────────────────────────────────── */
function mdsGrade(myPicks, originalPool) {
    if (!myPicks.length) return { letter: '?', totalDHQ: 0 };
    const totalDHQ = myPicks.reduce((s, p) => s + (p.dhq || 0), 0);
    const ranks = new Map(originalPool.map((p, i) => [p.pid, i + 1]));
    let values = 0;
    for (const p of myPicks) {
        const rank = ranks.get(p.pid) ?? p.overall;
        if (rank <= p.overall * 1.3) values++;
    }
    const pct = values / myPicks.length;
    const letter = pct >= 0.85 ? 'A+' : pct >= 0.7 ? 'A' : pct >= 0.55 ? 'B+' : pct >= 0.4 ? 'B' : 'C';
    return { letter, totalDHQ };
}

/* ── Position badge ────────────────────────────────────────── */
function MdsPosBadge({ pos }) {
    const c = window.App?.POS_COLORS?.[pos] || 'var(--k-d4af37, #d4af37)';
    const label = window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
    return (
        <span style={{
            fontSize: 'var(--text-micro)', fontWeight: 700, padding: '1px 5px', borderRadius: 'var(--card-radius-sm)',
            background: wrAlpha(c, '22'), color: c, fontFamily: "'DM Sans', sans-serif",
            letterSpacing: '0.04em', flexShrink: 0,
        }}>{label}</span>
    );
}

/* ══════════════════════════════════════════════════════════════════
   MockDraftSimulator
══════════════════════════════════════════════════════════════════ */
function MockDraftSimulator({ playersData, myRoster, currentLeague, draftRounds: propRounds }) {
    /* ── Setup config ─────────────────────────────────────────── */
    const [phase, setPhase] = useState('setup');
    const defaultSize = window.S?.rosters?.length || currentLeague?.rosters?.length || 12;
    const [rounds,     setRounds]     = useState(propRounds || 5);
    const [leagueSize, setLeagueSize] = useState(defaultSize);

    // Build real draft order from Sleeper data
    const draftMeta = useMemo(() => {
        const rosters = window.S?.rosters || currentLeague?.rosters || [];
        const users = window.S?.leagueUsers || currentLeague?.users || [];
        const myUid = window.S?.user?.user_id || '';
        const myRid = myRoster?.roster_id;
        const tradedPicks = window.S?.tradedPicks || [];
        const leagueSeason = String(currentLeague?.season || new Date().getFullYear());

        // Try to get draft_order from Sleeper draft info
        const drafts = window.S?.drafts || [];
        const upcoming = drafts.find(d => d.status === 'pre_draft') || drafts[0];
        const sleeperOrder = upcoming?.draft_order || {}; // user_id → slot

        // Build slot → roster mapping
        let slotToRoster = {}; // 1-indexed slot → { rosterId, ownerName }
        if (Object.keys(sleeperOrder).length > 0) {
            // Use actual Sleeper draft order
            Object.entries(sleeperOrder).forEach(([userId, slot]) => {
                const roster = rosters.find(r => r.owner_id === userId);
                const user = users.find(u => u.user_id === userId);
                const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + slot;
                slotToRoster[slot] = { rosterId: roster?.roster_id, ownerName: name, userId };
            });
        } else {
            // Fallback: reverse standings (worst record picks first)
            const sorted = [...rosters].sort((a, b) => {
                const wa = a.settings?.wins || 0, wb = b.settings?.wins || 0;
                if (wa !== wb) return wa - wb;
                return (a.settings?.fpts || 0) - (b.settings?.fpts || 0);
            });
            sorted.forEach((r, i) => {
                const user = users.find(u => u.user_id === r.owner_id);
                const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + (i + 1);
                slotToRoster[i + 1] = { rosterId: r.roster_id, ownerName: name, userId: r.owner_id };
            });
        }

        // Find user's slot
        let mySlot = null;
        for (const [slot, info] of Object.entries(slotToRoster)) {
            if (info.userId === myUid || info.rosterId === myRid) { mySlot = parseInt(slot); break; }
        }

        // Build per-round pick ownership (accounting for traded picks)
        const pickOwnership = {}; // "round-slot" → { ownerName, rosterId, traded }
        const numTeams = Object.keys(slotToRoster).length || rosters.length || 12;
        for (let rd = 1; rd <= (propRounds || 5); rd++) {
            for (let slot = 1; slot <= numTeams; slot++) {
                const originalInfo = slotToRoster[slot] || {};
                const originalRid = originalInfo.rosterId;
                // Check if this pick was traded
                const traded = tradedPicks.find(tp =>
                    tp.round === rd && tp.roster_id === originalRid &&
                    tp.owner_id !== originalRid && String(tp.season) === leagueSeason
                );
                if (traded) {
                    const newOwner = rosters.find(r => r.roster_id === traded.owner_id);
                    const newUser = users.find(u => u.user_id === newOwner?.owner_id);
                    const newName = newUser?.metadata?.team_name || newUser?.display_name || 'Team';
                    pickOwnership[rd + '-' + slot] = { ownerName: newName, rosterId: traded.owner_id, traded: true, originalOwner: originalInfo.ownerName };
                } else {
                    pickOwnership[rd + '-' + slot] = { ownerName: originalInfo.ownerName || 'Team ' + slot, rosterId: originalRid, traded: false };
                }
            }
        }

        return {
            mySlot: mySlot || Math.min(6, numTeams),
            slotToRoster,
            pickOwnership,
            numTeams,
            draftType: upcoming?.type || 'snake',
        };
    }, [myRoster, currentLeague]);

    const [draftPos,   setDraftPos]   = useState(draftMeta.mySlot);
    const [draftType,  setDraftType]  = useState(draftMeta.draftType || 'snake');

    /* ── Draft state (single object avoids stale-closure issues) ─ */
    const [ds, setDs]         = useState(null);
    const [posFilter, setPosFilter] = useState('');
    const [search,    setSearch]    = useState('');
    const timerRef = useRef(null);

    const userIdx    = draftPos - 1;
    const current    = ds ? ds.pickOrder[ds.currentIdx] : null;
    const isUserTurn = !!(current && current.teamIdx === userIdx);
    const isDone     = !!(ds && ds.currentIdx >= ds.pickOrder.length);

    /* ── Start / restart ─────────────────────────────────────── */
    const startDraft = () => {
        clearTimeout(timerRef.current);
        const pool      = mdsBuildPool(playersData);
        const pickOrder = mdsBuildOrder(rounds, leagueSize, draftType);
        setDs({ pool, pickOrder, picks: [], currentIdx: 0, teamRosters: {}, originalPool: pool });
        setPosFilter('');
        setSearch('');
        setPhase('drafting');
    };

    /* ── User picks a player ─────────────────────────────────── */
    const handleUserPick = pid => {
        setDs(prev => {
            if (!prev) return prev;
            const player = prev.pool.find(p => p.pid === pid);
            const slot   = prev.pickOrder[prev.currentIdx];
            if (!player || !slot || slot.teamIdx !== userIdx) return prev;
            return {
                ...prev,
                pool:        prev.pool.filter(p => p.pid !== pid),
                picks:       [...prev.picks, { ...slot, pid: player.pid, name: player.name, pos: player.pos, dhq: player.dhq, isUser: true }],
                currentIdx:  prev.currentIdx + 1,
                teamRosters: { ...prev.teamRosters, [slot.teamIdx]: [...(prev.teamRosters[slot.teamIdx] || []), player.pos] },
            };
        });
    };

    /* ── AI auto-pick (triggers each time currentIdx advances) ── */
    useEffect(() => {
        if (phase !== 'drafting' || !ds) return;
        if (isDone) { setPhase('complete'); return; }
        if (isUserTurn) return;

        timerRef.current = setTimeout(() => {
            setDs(prev => {
                if (!prev) return prev;
                const slot = prev.pickOrder[prev.currentIdx];
                if (!slot || slot.teamIdx === userIdx) return prev;
                const pick = mdsAIPick(slot.teamIdx, prev.pool, prev.teamRosters);
                if (!pick) return prev;
                return {
                    ...prev,
                    pool:        prev.pool.filter(p => p.pid !== pick.pid),
                    picks:       [...prev.picks, { ...slot, pid: pick.pid, name: pick.name, pos: pick.pos, dhq: pick.dhq, isUser: false }],
                    currentIdx:  prev.currentIdx + 1,
                    teamRosters: { ...prev.teamRosters, [slot.teamIdx]: [...(prev.teamRosters[slot.teamIdx] || []), pick.pos] },
                };
            });
        }, 500);

        return () => clearTimeout(timerRef.current);
    }, [ds?.currentIdx, phase, isDone, isUserTurn]);

    /* ── Team label ──────────────────────────────────────────── */
    const getTeamName = idx => {
        if (idx === userIdx) return 'YOU';
        const roster = window.S?.rosters?.[idx];
        if (roster) {
            const user = (window.S?.leagueUsers || []).find(u => u.user_id === roster.owner_id);
            if (user) return (user.metadata?.team_name || user.display_name || `T${idx + 1}`).substring(0, 7);
        }
        return `T${idx + 1}`;
    };

    /* ── Filtered available players ──────────────────────────── */
    const available = useMemo(() => {
        if (!ds) return [];
        return ds.pool.filter(p => {
            if (posFilter && p.pos !== posFilter) return false;
            if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
    }, [ds?.pool, posFilter, search]);

    /* ── Pick map: "round-teamIdx" → completed pick ──────────── */
    const pickMap = useMemo(() => {
        if (!ds) return {};
        const m = {};
        for (const p of ds.picks) m[`${p.round}-${p.teamIdx}`] = p;
        return m;
    }, [ds?.picks]);

    /* ── Overall pick number per cell ────────────────────────── */
    const slotMap = useMemo(() => {
        if (!ds) return {};
        const m = {};
        for (const s of ds.pickOrder) m[`${s.round}-${s.teamIdx}`] = s.overall;
        return m;
    }, [ds?.pickOrder]);

    /* ── Style constants ─────────────────────────────────────── */
    const font = "'DM Sans', sans-serif";
    const card = { background: 'var(--ov-1, rgba(255,255,255,0.02))', border: 'var(--card-border)', borderRadius: 'var(--card-radius)' };
    const selStyle = { width: '100%', padding: '8px 10px', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius-sm)', color: 'var(--white)', fontSize: '0.82rem', fontFamily: font, outline: 'none', cursor: 'pointer', minHeight: '44px' };

    /* ════════════════════════════════
       PHASE: SETUP
    ════════════════════════════════ */
    if (phase === 'setup') {
        const cfgRows = [
            {
                label: 'Draft Rounds', value: rounds, onChange: e => setRounds(+e.target.value),
                opts: [3, 4, 5, 6, 7].map(v => ({ v, l: `${v} rounds` })),
            },
            {
                label: 'League Size', value: leagueSize,
                onChange: e => { const n = +e.target.value; setLeagueSize(n); setDraftPos(p => Math.min(p, n)); },
                opts: [8, 10, 12, 14, 16].map(v => ({ v, l: `${v} teams` })),
            },
            {
                label: 'Your Draft Position', value: draftPos, onChange: e => setDraftPos(+e.target.value),
                opts: Array.from({ length: leagueSize }, (_, i) => {
                    const slot = i + 1;
                    const info = draftMeta.slotToRoster[slot];
                    const isMine = slot === draftMeta.mySlot;
                    const ownerLabel = info?.ownerName ? ` — ${info.ownerName}` : '';
                    return { v: slot, l: `${slot}.01${ownerLabel}${isMine ? ' (YOU)' : ''}` };
                }),
            },
            {
                label: 'Draft Type', value: draftType, onChange: e => setDraftType(e.target.value),
                opts: [{ v: 'snake', l: 'Snake' }, { v: 'linear', l: 'Linear' }],
            },
        ];

        return (
            <div style={{ fontFamily: font, padding: '4px 0' }}>
                <div style={{ marginBottom: '18px' }}>
                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.5rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.06em', marginBottom: '2px' }}>
                        MOCK DRAFT SIMULATOR
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.6 }}>
                        Pick against AI teams, grade your haul.
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                    {cfgRows.map(({ label, value, onChange, opts }) => (
                        <div key={label}>
                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px', fontFamily: font }}>{label}</div>
                            <select value={value} onChange={onChange} style={selStyle}>
                                {opts.map(o => <option key={o.v} value={o.v} style={{ background: 'var(--k-111111, #111111)' }}>{o.l}</option>)}
                            </select>
                        </div>
                    ))}
                </div>

                <div style={{ ...card, padding: '9px 12px', marginBottom: '18px', fontSize: '0.74rem', color: 'var(--silver)' }}>
                    <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Your slot:</span> Pick {draftPos} of {leagueSize}&nbsp;&nbsp;·&nbsp;&nbsp;
                    <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{draftType === 'snake' ? 'Snake' : 'Linear'}</span>&nbsp;&nbsp;·&nbsp;&nbsp;
                    {rounds} rounds · {rounds * leagueSize} total picks
                </div>

                <button
                    onClick={startDraft}
                    style={{ width: '100%', padding: '12px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '8px', fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.06em' }}
                    onMouseEnter={e => e.target.style.opacity = '0.85'}
                    onMouseLeave={e => e.target.style.opacity = '1'}
                >
                    START DRAFT
                </button>
            </div>
        );
    }

    /* ════════════════════════════════
       PHASE: DRAFTING
    ════════════════════════════════ */
    if (phase === 'drafting' && ds) {
        const totalPicks = ds.pickOrder.length;
        const progress   = Math.round((ds.currentIdx / totalPicks) * 100);
        const myPicks    = ds.picks.filter(p => p.isUser);

        return (
            <div style={{ fontFamily: font }}>
                {/* Top bar: title + progress + exit */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.06em', flexShrink: 0 }}>MOCK DRAFT</div>
                    <div style={{ flex: 1, height: '4px', background: 'var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gold)', borderRadius: '2px', transition: 'width 0.4s ease' }} />
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--silver)', flexShrink: 0 }}>{ds.currentIdx}/{totalPicks}</div>
                    <button
                        onClick={() => { clearTimeout(timerRef.current); setPhase('setup'); setDs(null); }}
                        style={{ padding: '3px 9px', minHeight: '44px', background: 'transparent', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '5px', color: 'var(--silver)', cursor: 'pointer', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: font, flexShrink: 0 }}
                    >Exit</button>
                </div>

                {/* Status banner */}
                {isUserTurn ? (
                    <div style={{ padding: '10px 14px', background: 'linear-gradient(90deg,var(--acc-fill3, rgba(212,175,55,0.15)),var(--acc-fill1, rgba(212,175,55,0.04)))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', borderRadius: '8px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--good)', display: 'inline-block', flexShrink: 0, animation: 'pulse 1.5s infinite' }} />
                        <div>
                            <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>ON THE CLOCK</div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--silver)' }}>
                                Round {current?.round} · Pick #{current?.overall} · Your pick {myPicks.length + 1} of {Math.ceil(totalPicks / leagueSize)}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{ ...card, padding: '8px 12px', marginBottom: '12px', fontSize: '0.74rem', color: 'var(--silver)' }}>
                        <span style={{ opacity: 0.5 }}>R{current?.round} · #{current?.overall} · </span>
                        <span style={{ color: 'var(--white)' }}>{getTeamName(current?.teamIdx ?? -1)} on the clock…</span>
                    </div>
                )}

                {/* Draft board grid */}
                <div style={{ overflowX: 'auto', overflowY: 'clip', marginBottom: '14px', borderRadius: '8px', border: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 'var(--text-micro, 0.6875rem)', minWidth: `${leagueSize * 76 + 30}px`, width: '100%', tableLayout: 'fixed' }}>
                        <thead>
                            <tr style={{ background: 'var(--acc-fill1, rgba(212,175,55,0.07))' }}>
                                <th style={{ width: 28, padding: '5px 4px', textAlign: 'center', color: 'var(--silver)', fontWeight: 700, borderBottom: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))' }}>Rd</th>
                                {Array.from({ length: leagueSize }, (_, i) => (
                                    <th key={i} style={{ padding: '5px 3px', textAlign: 'center', fontWeight: i === userIdx ? 800 : 600, color: i === userIdx ? 'var(--gold)' : 'var(--silver)', borderBottom: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', background: i === userIdx ? 'var(--acc-fill1, rgba(212,175,55,0.05))' : 'transparent', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {getTeamName(i)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: rounds }, (_, r) => (
                                <tr key={r} style={{ borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.025))' }}>
                                    <td style={{ padding: '3px 4px', textAlign: 'center', color: 'var(--gold)', fontWeight: 700, background: 'var(--acc-fill1, rgba(212,175,55,0.04))', fontSize: '0.7rem' }}>{r + 1}</td>
                                    {Array.from({ length: leagueSize }, (_, i) => {
                                        const pick      = pickMap[`${r + 1}-${i}`];
                                        const isCurrent = current?.round === r + 1 && current?.teamIdx === i;
                                        const isMe      = i === userIdx;
                                        const overall   = slotMap[`${r + 1}-${i}`];
                                        return (
                                            <td key={i} style={{ padding: '3px 3px', textAlign: 'center', background: isCurrent ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : isMe ? 'var(--acc-fill1, rgba(212,175,55,0.025))' : 'transparent', outline: isCurrent ? '1px solid var(--acc-line3, rgba(212,175,55,0.4))' : 'none', verticalAlign: 'middle', height: 36 }}>
                                                {pick ? (
                                                    <div style={{ lineHeight: 1.25 }}>
                                                        <div style={{ fontWeight: 600, color: pick.isUser ? 'var(--gold)' : 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-micro, 0.6875rem)' }}>
                                                            {pick.name.split(' ').slice(-1)[0]}
                                                        </div>
                                                        <MdsPosBadge pos={pick.pos} />
                                                    </div>
                                                ) : isCurrent ? (
                                                    <span style={{ color: 'var(--gold)', fontWeight: 800 }}>···</span>
                                                ) : (
                                                    <span style={{ color: 'var(--ov-6, rgba(255,255,255,0.12))', fontSize: 'var(--text-micro, 0.6875rem)' }}>#{overall}</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Available players panel — only shown on user's turn */}
                {isUserTurn && (
                    <div style={{ ...card, padding: '12px 14px', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Best Available</div>
                            {(typeof getLeaguePositions === 'function' ? getLeaguePositions({ withBlank: true }) : ['','QB','RB','WR','TE','K','DEF']).map(pos => (
                                <button key={pos} onClick={() => setPosFilter(pos)} style={{ padding: '2px 9px', minHeight: '44px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: font, borderRadius: '10px', cursor: 'pointer', border: '1px solid ' + (posFilter === pos ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'), background: posFilter === pos ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent', color: posFilter === pos ? 'var(--gold)' : 'var(--silver)' }}>
                                    {pos ? (window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)) : 'ALL'}
                                </button>
                            ))}
                        </div>
                        <input
                            value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Search players…"
                            style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', background: 'var(--ov-2, rgba(255,255,255,0.03))', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderRadius: '6px', color: 'var(--white)', fontSize: '0.76rem', fontFamily: font, outline: 'none', marginBottom: '8px' }}
                        />
                        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                            {available.slice(0, 40).map((p, i) => (
                                <div key={p.pid} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 6px', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.03))' }}>
                                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: i < 3 ? 'var(--gold)' : 'var(--ov-8, rgba(255,255,255,0.3))', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                                    <img
                                        src={`https://sleepercdn.com/content/nfl/players/thumb/${p.pid}.jpg`}
                                        style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                                        onError={e => e.target.style.display = 'none'} alt=""
                                    />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.5 }}>{p.team || 'FA'}</div>
                                    </div>
                                    <MdsPosBadge pos={p.pos} />
                                    <span style={{ fontSize: '0.7rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: p.dhq >= 7000 ? 'var(--good)' : p.dhq >= 4000 ? 'var(--info)' : 'var(--silver)', minWidth: 44, textAlign: 'right' }}>
                                        {p.dhq > 0 ? p.dhq.toLocaleString() : '—'}
                                    </span>
                                    <button
                                        onClick={() => handleUserPick(p.pid)}
                                        style={{ padding: '4px 11px', minHeight: '44px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: font, fontWeight: 700, flexShrink: 0 }}
                                        onMouseEnter={e => e.target.style.opacity = '0.8'}
                                        onMouseLeave={e => e.target.style.opacity = '1'}
                                    >DRAFT</button>
                                </div>
                            ))}
                            {available.length === 0 && (
                                <div style={{ padding: '12px', textAlign: 'center', color: 'var(--silver)', opacity: 0.4, fontSize: '0.76rem' }}>No players match</div>
                            )}
                        </div>
                    </div>
                )}

                {/* Your picks so far */}
                {myPicks.length > 0 && (
                    <div>
                        <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Your Picks</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {myPicks.map((p, i) => (
                                <span key={i} style={{ padding: '3px 10px', background: 'var(--acc-fill1, rgba(212,175,55,0.07))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.18))', borderRadius: '12px', fontSize: '0.7rem', color: 'var(--white)' }}>
                                    R{p.round} {p.name.split(' ').slice(-1)[0]}&nbsp;
                                    <span style={{ color: window.App?.POS_COLORS?.[p.pos] || 'var(--k-d4af37, #d4af37)' }}>{p.pos}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    /* ════════════════════════════════
       PHASE: COMPLETE
    ════════════════════════════════ */
    if (phase === 'complete' && ds) {
        const myPicks   = ds.picks.filter(p => p.isUser);
        const grade     = mdsGrade(myPicks, ds.originalPool);
        const posCounts = myPicks.reduce((acc, p) => { acc[p.pos] = (acc[p.pos] || 0) + 1; return acc; }, {});
        // A–F grade is an interpretation → Scout Pro; the raw haul (DHQ total,
        // picks, position counts) below stays free. Neutral color so the hero
        // tint doesn't leak the grade. Fail-open without pro-gate.js.
        const mdsPro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
        const gradeColor = !mdsPro ? 'var(--silver)' : grade.letter.startsWith('A') ? 'var(--good)' : grade.letter.startsWith('B') ? 'var(--gold)' : 'var(--bad)';

        return (
            <div style={{ fontFamily: font }}>
                {/* Grade hero */}
                <div style={{ textAlign: 'center', padding: '20px 16px', background: 'var(--acc-fill1, rgba(212,175,55,0.05))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: '10px', marginBottom: '14px' }}>
                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.76rem', color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>{mdsPro ? 'Draft Grade' : 'Draft Grade — Scout Pro'}</div>
                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '4.5rem', fontWeight: 700, color: gradeColor, lineHeight: 1, marginBottom: '6px' }}>{mdsPro ? grade.letter : '🔒'}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--silver)', marginBottom: '12px' }}>
                        Total DHQ: <strong style={{ color: 'var(--white)' }}>{grade.totalDHQ.toLocaleString()}</strong>
                        &nbsp;·&nbsp;{myPicks.length} picks
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        {Object.entries(posCounts).map(([pos, ct]) => {
                            const c = window.App?.POS_COLORS?.[pos] || 'var(--k-d4af37, #d4af37)';
                            return (
                                <span key={pos} style={{ padding: '3px 10px', background: wrAlpha(c, '18'), border: '1px solid ' + wrAlpha(c, '44'), borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700, color: c }}>
                                    {(window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos))} ×{ct}
                                </span>
                            );
                        })}
                    </div>
                </div>

                {/* Picks table */}
                <div style={{ border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: '8px', overflow: 'hidden', marginBottom: '14px' }}>
                    <div style={{ padding: '7px 12px', background: 'var(--acc-fill1, rgba(212,175,55,0.06))', borderBottom: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))', fontSize: '0.7rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Your Picks
                    </div>
                    <div style={{ display: 'flex', padding: '4px 12px', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                        <span style={{ width: 52 }}>Pick</span>
                        <span style={{ flex: 1 }}>Player</span>
                        <span style={{ width: 36, textAlign: 'center' }}>Pos</span>
                        <span style={{ width: 60, textAlign: 'right' }}>DHQ</span>
                    </div>
                    {myPicks.map((p, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid var(--ov-2, rgba(255,255,255,0.025))', background: i % 2 ? 'var(--ov-1, rgba(255,255,255,0.01))' : 'transparent' }}>
                            <span style={{ width: 52, fontSize: '0.72rem', color: 'var(--gold)', fontWeight: 600 }}>R{p.round}.{String(p.slot).padStart(2, '0')}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                            </div>
                            <div style={{ width: 36, textAlign: 'center' }}><MdsPosBadge pos={p.pos} /></div>
                            <span style={{ width: 60, textAlign: 'right', fontSize: '0.72rem', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: p.dhq >= 7000 ? 'var(--good)' : p.dhq >= 4000 ? 'var(--info)' : 'var(--silver)' }}>
                                {p.dhq > 0 ? p.dhq.toLocaleString() : '—'}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={startDraft}
                        style={{ flex: 1, padding: '11px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '7px', fontFamily: 'Rajdhani, sans-serif', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}
                        onMouseEnter={e => e.target.style.opacity = '0.85'}
                        onMouseLeave={e => e.target.style.opacity = '1'}
                    >DRAFT AGAIN</button>
                    <button
                        onClick={() => { setPhase('setup'); setDs(null); }}
                        style={{ padding: '11px 16px', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '7px', fontFamily: font, fontSize: '0.78rem', cursor: 'pointer' }}
                    >New Config</button>
                </div>
            </div>
        );
    }

    return null;
}

/* ── Expose globally ─────────────────────────────────────────── */
window.MockDraftSimulator = MockDraftSimulator;
window.MockDraftPanel     = MockDraftSimulator; // alias used by draft-room.js
