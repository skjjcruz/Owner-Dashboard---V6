// ══════════════════════════════════════════════════════════════════
// dashboard-digest.js — "Alex's Desk" cross-league top insights card
//
// Hub-level ambient AI surface: compact snapshots of every league go to
// the dashboard_digest route (fast tier), which returns at most 3
// decision-relevant insights across the whole portfolio. Two cache
// layers keep this near-free: a 24h localStorage cache here, and the
// server-side ai_response_cache behind it (uncounted against the
// plan's request allowance). An explicit Refresh pays a normal counted
// request via forceRefresh.
//
// Snapshots are grounded in the shared roster assessor (team-assess.js)
// — the same engine behind Analytics and Trade Center — so the digest
// can never claim a positional crisis the rest of the app calls a
// surplus. When no assessment signal is available, snapshots carry no
// roster fields and the server prompt forbids roster-level claims.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    const DIGEST_TTL_MS = 24 * 60 * 60 * 1000;

    function hashString(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    function digestUser() {
        return window.OD?.getCurrentUsername?.() || window.S?.user?.username || 'anon';
    }

    // ── Per-insight dismissals ────────────────────────────────────
    // recIds are stateHash-scoped, so a dismissal stops matching anything
    // once the portfolio changes; the 7-day prune just keeps the map small.
    const DISMISS_KEY = 'wr_dash_digest_dismissed_v1';
    function loadDismissed() {
        try {
            const raw = JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
            const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
            const pruned = {};
            for (const [k, ts] of Object.entries(raw)) { if (ts > cutoff) pruned[k] = ts; }
            return pruned;
        } catch (_) { return {}; }
    }
    function saveDismissed(map) {
        try { localStorage.setItem(DISMISS_KEY, JSON.stringify(map)); } catch (_) {}
    }

    // ── Deterministic grounding inputs ────────────────────────────
    // Sleeper season stats normalized to the { prevTotal, prevAvg }
    // shape team-assess.js reads. pts_ppr fallback chain is fine here:
    // the assessor only ranks players within a position, so scoring
    // nuances (TEP etc.) don't change startable/thin/surplus calls.
    function normalizeSeasonStats(raw) {
        const out = {};
        for (const pid in (raw || {})) {
            const s = raw[pid] || {};
            const pts = Number(s.pts_ppr ?? s.pts_half_ppr ?? s.pts_std ?? 0);
            if (!(pts > 0)) continue;
            const gp = Number(s.gp || s.gms_active || 0);
            out[pid] = { prevTotal: Math.round(pts * 10) / 10, prevAvg: gp > 0 ? Math.round((pts / gp) * 10) / 10 : 0 };
        }
        return out;
    }

    let _digestStats = null; // normalized once per session (underlying fetches are cached app-wide)

    async function loadGroundingInputs() {
        try {
            let players = window.S?.players || null;
            if (!players && typeof window.App?.fetchAllPlayers === 'function') {
                players = await window.App.fetchAllPlayers();
            }
            if (!players || !Object.keys(players).length) return null;
            const fetchStats = window.App?.fetchSeasonStats || window.fetchSeasonStats;
            if (!_digestStats && typeof fetchStats === 'function') {
                const season = new Date().getFullYear();
                let raw = await fetchStats(String(season)).catch(() => null);
                if (!raw || !Object.keys(raw).length) raw = await fetchStats(String(season - 1)).catch(() => null);
                _digestStats = normalizeSeasonStats(raw);
            }
            const stats = _digestStats || {};
            const liScores = window.App?.LI?.playerScores;
            const hasSignal = Object.keys(stats).length > 0 || (liScores && Object.keys(liScores).length > 0);
            // Without production or DHQ signal the assessor would count zero
            // startable players everywhere and flag every room a deficit —
            // worse than sending no roster data at all.
            if (!hasSignal) return null;
            return { players, stats };
        } catch (_) { return null; }
    }

    function myAssessmentFor(league, myRoster, inputs) {
        try {
            if (!myRoster) return null;
            // Empire mode may have already assessed this league with the same engine.
            const fromEmpire = (league.empireAssessments || [])
                .find(a => String(a.rosterId) === String(myRoster.roster_id));
            if (fromEmpire) return fromEmpire;
            if (!inputs || typeof window.App?.assessAllTeams !== 'function') return null;
            const all = window.App.assessAllTeams(
                league.rosters || [], inputs.players, inputs.stats, league,
                league.users || [], league.tradedPicks || []
            );
            return (all || []).find(a => String(a.rosterId) === String(myRoster.roster_id)) || null;
        } catch (_) { return null; }
    }

    function groundedFields(league, fmt, assess) {
        if (!assess) return {};
        const out = {
            tier: assess.tier || null,
            healthScore: assess.healthScore ?? null,
            topNeeds: (assess.needs || []).slice(0, 3).map(n => `${n.pos} (${n.urgency})`),
            surpluses: (assess.strengths || []).slice(0, 4),
        };
        const qb = assess.posAssessment?.QB;
        if (fmt.isSuperFlex && qb) {
            out.qbRoom = {
                startable: qb.nflStarters ?? 0,
                required: qb.minQuality ?? qb.startingReq ?? 2,
                rostered: qb.actual ?? 0,
                status: qb.status || 'ok',
            };
        }
        // Pick claims need traded-pick data; without it every team looks fully stocked.
        if (Array.isArray(league.tradedPicks) && assess.picksAssessment?.pickCountByYear) {
            // A zero-pick year is only actionable while that draft is still
            // ahead. Once the current season's draft has run, holding no picks
            // for it is history — keep the current year only when the league
            // status says the draft hasn't happened yet.
            const draftAhead = ['pre_draft', 'drafting'].includes(String(league.status || ''));
            const seasonYear = String(parseInt(league.season) || new Date().getFullYear());
            const zero = Object.entries(assess.picksAssessment.pickCountByYear)
                .filter(([y, c]) => c === 0 && (y !== seasonYear || draftAhead))
                .map(([y]) => y);
            if (zero.length) out.zeroPickYears = zero;
        }
        return out;
    }

    // FAAB grounded against the league: a raw dollar amount invites the model
    // to editorialize ("massive surplus") — budget, rank, and median make it
    // a checkable fact instead.
    function faabContext(league, myRoster) {
        const budget = Number(league.settings?.waiver_budget || 0);
        if (!(budget > 0) || !myRoster?.settings) return null;
        const remaining = (league.rosters || [])
            .filter(r => r.settings)
            .map(r => Math.max(0, budget - Number(r.settings.waiver_budget_used || 0)));
        if (!remaining.length) return null;
        const mine = Math.max(0, budget - Number(myRoster.settings.waiver_budget_used || 0));
        const sorted = [...remaining].sort((a, b) => a - b);
        const leagueMedian = sorted[Math.floor(sorted.length / 2)];
        const rank = 1 + remaining.filter(v => v > mine).length;
        // The verdict is decided here, deterministically — the model proved it
        // will botch the comparison if left to interpret the raw numbers.
        let verdict;
        if ((rank <= 3 && mine > leagueMedian) || (leagueMedian > 0 && mine >= 1.5 * leagueMedian)) verdict = 'surplus';
        else if (mine >= leagueMedian) verdict = 'par';
        else verdict = 'short';
        return { mine, budget, leagueMedian, rank, teams: remaining.length, verdict };
    }

    async function buildSnapshots(leagues, sleeperUser) {
        const inputs = await loadGroundingInputs();
        return (leagues || []).slice(0, 12).map(l => {
            const rosters = l.rosters || [];
            const myRoster = rosters.find(r => r.owner_id === sleeperUser?.user_id);
            const fmt = window.WR?.AIContext?.detectFormat?.(l) || {};
            const faab = faabContext(l, myRoster);
            // League hasn't drafted yet (status when available, empty rosters as
            // fallback). Empty rosters would assess as all-deficit, so skip
            // grounding and say so instead.
            const preDraft = String(l.status || '') === 'pre_draft'
                || (rosters.length > 0 && rosters.every(r => !(r.players || []).length));
            const gamesPlayed = rosters.some(r =>
                (r.settings?.wins || 0) + (r.settings?.losses || 0) + (r.settings?.ties || 0) > 0);
            const assess = preDraft ? null : myAssessmentFor(l, myRoster, inputs);
            return {
                leagueId: l.id || l.league_id,
                leagueName: l.name,
                record: `${l.wins || 0}-${l.losses || 0}${l.ties > 0 ? '-' + l.ties : ''}`,
                teamCount: rosters.length,
                formatFlags: {
                    isSuperFlex: !!fmt.isSuperFlex,
                    isTEP: !!fmt.isTEP,
                    isIDP: !!fmt.isIDP,
                    scoringType: fmt.scoringType || 'std',
                },
                seasonPhase: gamesPlayed ? 'in-season' : 'offseason',
                ...(preDraft ? { preDraft: true } : {}),
                ...(faab ? { faabRemaining: faab.mine, faab } : {}),
                ...groundedFields(l, fmt, assess),
            };
        });
    }

    function cacheKeyFor(snapshots) {
        // Roster-state fields are part of the hash so a trade or pickup that
        // changes a room's status invalidates yesterday's cached insights.
        const stateHash = hashString(snapshots.map(s => [
            s.leagueId, s.record, s.tier || '',
            (s.topNeeds || []).join('+'), (s.surpluses || []).join('+'),
            s.qbRoom ? `${s.qbRoom.startable}/${s.qbRoom.required}:${s.qbRoom.status}` : '',
            s.faab ? `${s.faab.mine}r${s.faab.rank}` : '',
            s.preDraft ? 'pre' : '', s.seasonPhase || '',
        ].join(':')).join('|'));
        return { key: `wr_dash_digest:${digestUser()}:${stateHash}`, stateHash };
    }

    function loadCachedDigest(key) {
        try {
            const raw = JSON.parse(localStorage.getItem(key) || 'null');
            if (!raw || !raw.ts || Date.now() - raw.ts > DIGEST_TTL_MS) return null;
            return Array.isArray(raw.insights) ? raw.insights : null;
        } catch (_) { return null; }
    }

    function saveCachedDigest(key, insights) {
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), insights })); } catch (_) {}
    }

    function normalizeInsights(arr) {
        return (arr || []).filter(x => x && x.title).slice(0, 3).map(x => ({
            leagueId: x.leagueId != null ? String(x.leagueId) : null,
            severity: String(x.severity || 'pattern').toLowerCase(),
            title: String(x.title).slice(0, 120),
            body: String(x.body || '').slice(0, 400),
        }));
    }

    function DashboardDigestCard({ leagues, sleeperUser, onSelectLeague }) {
        const React = window.React;
        const h = React.createElement;
        const InsightCard = window.WR.InsightCard;
        // null = grounding still loading; built async because the roster
        // assessment may need the (cached) player DB + season stats.
        const [snapshots, setSnapshots] = React.useState(null);
        React.useEffect(() => {
            let alive = true;
            buildSnapshots(leagues, sleeperUser)
                .then(s => { if (alive) setSnapshots(s); })
                .catch(() => { if (alive) setSnapshots([]); });
            return () => { alive = false; };
        }, [leagues, sleeperUser]);
        const { key, stateHash } = React.useMemo(() => cacheKeyFor(snapshots || []), [snapshots]);
        const [state, setState] = React.useState({ status: 'idle', insights: null, error: null });
        const [feedbackGiven, setFeedbackGiven] = React.useState({});
        const [dismissed, setDismissed] = React.useState(loadDismissed);

        const generate = React.useCallback(async (force) => {
            if (!snapshots || !snapshots.length) return;
            setState(prev => ({ ...prev, status: 'loading', error: null }));
            try {
                const context = { leagues: snapshots, stateHash, ...(force ? { forceRefresh: true } : {}) };
                const result = await window.OD.callAI({ type: 'dashboard_digest', context });
                let insights = Array.isArray(result?.insights) ? result.insights : null;
                if (!insights && typeof result?.analysis === 'string') {
                    const match = result.analysis.match(/\[\s*\{[\s\S]*\}\s*\]/);
                    if (match) { try { insights = JSON.parse(match[0]); } catch (_) {} }
                }
                if (!Array.isArray(insights)) { setState({ status: 'error', insights: null, error: 'No insights returned. Try a refresh later.' }); return; }
                // An empty array is a real verdict ("nothing needs attention"),
                // not a failure — cache it so we don't keep re-asking all day.
                const cleaned = normalizeInsights(insights);
                saveCachedDigest(key, cleaned);
                setState({ status: 'ready', insights: cleaned, error: null });
            } catch (e) {
                const raw = String(e?.message || '');
                // A rejected fetch surfaces as "Load failed" (WebKit) or
                // "Failed to fetch" (Chrome) — show a human message instead of
                // leaking the browser's network string into the card.
                const isNetwork = /load failed|failed to fetch|networkerror|network request failed/i.test(raw);
                const msg = /limit/i.test(raw)
                    ? 'Daily AI limit reached — fresh insights return tomorrow.'
                    : isNetwork
                        ? "Couldn't reach Alex right now — check your connection and try Refresh."
                        : (e?.message || 'Could not generate insights right now.');
                setState({ status: 'error', insights: null, error: msg });
            }
        }, [snapshots, stateHash, key]);

        React.useEffect(() => {
            if (!snapshots || !snapshots.length) return;
            const cached = loadCachedDigest(key);
            if (cached) { setState({ status: 'ready', insights: cached, error: null }); return; } // [] = cached all-clear
            generate(false); // ambient: server-cached + uncounted against request allowance
        }, [key, snapshots]);

        if (!(leagues || []).length || (snapshots && !snapshots.length) || typeof window.OD?.callAI !== 'function' || !InsightCard) return null;

        const groundingPending = snapshots === null;

        const sendFeedback = (idx, action) => {
            setFeedbackGiven(prev => ({ ...prev, [idx]: action }));
            window.WR?.AIFeedback?.send?.({ leagueId: state.insights?.[idx]?.leagueId || null, surface: 'dashboard_digest', recId: `${stateHash}:${idx}`, action });
        };

        const dismissInsight = (idx) => {
            const recId = `${stateHash}:${idx}`;
            setDismissed(prev => { const next = { ...prev, [recId]: Date.now() }; saveDismissed(next); return next; });
            // Dismissal also feeds the learning loop — quieter over time.
            window.WR?.AIFeedback?.send?.({ leagueId: state.insights?.[idx]?.leagueId || null, surface: 'dashboard_digest', recId, action: 'dismissed' });
        };

        return h('div', { style: { marginBottom: '14px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' } },
                h('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase' } }, "✨ Alex's Desk — Top Insights"),
                h('button', {
                    onClick: () => !groundingPending && state.status !== 'loading' && generate(true),
                    title: 'Regenerate (uses one AI request)',
                    style: { background: 'none', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '4px', color: 'var(--silver)', cursor: 'pointer', fontSize: 'var(--text-label, 0.75rem)', padding: '2px 9px', opacity: groundingPending || state.status === 'loading' ? 0.5 : 1 }
                }, groundingPending || state.status === 'loading' ? '…' : 'Refresh')
            ),
            (groundingPending || (state.status === 'loading' && !state.insights)) && h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, padding: '6px 2px' } }, 'Scanning your leagues for the moves that matter this week…'),
            state.status === 'error' && h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, padding: '6px 2px' } }, state.error),
            state.status === 'ready' && !(state.insights || []).length && h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, padding: '6px 2px' } }, 'No urgent moves across your leagues right now — Alex will flag it here when something actually matters.'),
            state.status === 'ready' && (state.insights || [])
                .map((ins, idx) => ({ ins, idx }))
                .filter(({ idx }) => !dismissed[`${stateHash}:${idx}`])
                .map(({ ins, idx }) => {
                const league = (leagues || []).find(l => String(l.id || l.league_id) === String(ins.leagueId));
                return h('div', { key: idx, style: { marginBottom: '8px' } },
                    h(InsightCard, {
                        severity: ins.severity,
                        title: ins.title,
                        body: ins.body,
                        compact: true,
                        ctaLabel: league ? `Open ${league.name}` : null,
                        ctaOnClick: league ? () => onSelectLeague(league) : null,
                        onDismiss: () => dismissInsight(idx),
                    }),
                    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '2px' } },
                        feedbackGiven[idx]
                            ? h('span', { style: { fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.5 } }, 'Thanks — Alex learns from this.')
                            : ['up', 'down'].map(action => h('button', {
                                key: action,
                                onClick: () => sendFeedback(idx, action),
                                style: { background: 'none', border: 'none', color: 'var(--silver)', opacity: 0.45, cursor: 'pointer', fontSize: '0.72rem', padding: '0 4px' }
                            }, action === 'up' ? '👍' : '👎'))
                    )
                );
            })
        );
    }

    window.WR.DashboardDigestCard = DashboardDigestCard;
})();
