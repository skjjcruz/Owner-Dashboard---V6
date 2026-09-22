/* Account-bound Empire evidence. Never install portfolio data into the active
 * league bridge. Value/assessment formulas remain owned by canonical shared. */
(function () {
    'use strict';
    const App = window.App = window.App || {};
    const idOf = league => String(league?.id || league?.league_id || '');
    const providerOf = league => league?._espn || idOf(league).startsWith('espn_') ? 'espn'
        : league?._mfl || idOf(league).startsWith('mfl_') ? 'mfl'
            : league?._yahoo || idOf(league).startsWith('yahoo_') ? 'yahoo' : /^\d+$/.test(idOf(league)) ? 'sleeper' : 'unknown';
    const unavailable = reason => ({ status: 'unavailable', reason });
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const valueContexts = new WeakMap(), emptyValues = Object.freeze({});
    const engineLeague = league => ({ ...Object.fromEntries(['name', 'season', 'status', 'type', 'league_type', '_dhq_type_override', 'metadata', 'scoring_settings', 'roster_positions', 'settings', 'total_rosters', 'previous_league_id', 'draft_id', 'drafts'].map(key => [key, league[key]])), league_id: idOf(league) });
    const valueKey = league => JSON.stringify([providerOf(league), engineLeague(league), league.rosters, league.tradedPicks]);
    function contextFor(league) {
        const context = valueContexts.get(league);
        if (!context) return null;
        try { if (context.active && context.current() && context.key === valueKey(league)) return context; } catch (_) { /* fail closed */ }
        context.active = false; return null;
    }
    const valuesFor = league => contextFor(league)?.scores || emptyValues;
    const assessmentsFor = league => contextFor(league)?.assessments || [];

    function normalizeStats(raw, scoring, historical) {
        if (!object(raw) || !object(scoring) || !Object.keys(scoring).length || typeof App.calcRawPts !== 'function') return {};
        const out = {};
        Object.entries(raw).forEach(([pid, row]) => {
            const gp = Number(row?.gp);
            if (!object(row) || !Number.isFinite(gp) || gp <= 0) return;
            const points = App.calcRawPts(row, scoring);
            if (!Number.isFinite(points)) return;
            out[pid] = historical ? { prevAvg: Math.round(points / gp * 10) / 10, prevTotal: points, prevRawStats: row }
                : { seasonAvg: Math.round(points / gp * 10) / 10, seasonTotal: points };
        });
        return out;
    }
    async function load(options) {
        const identity = options.identity || App.PublicPortfolio.capture();
        const active = () => App.PublicPortfolio.current(identity) && (!options.isCurrent || options.isCurrent());
        const check = () => { if (!active()) throw new Error('Empire account or league context changed.'); };
        const run = async work => {
            check(); let timer;
            try {
                const value = await Promise.race([Promise.resolve().then(() => { check(); return work(); }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The request timed out. Retry Empire sync.')), options.timeoutMs || 20000); })]);
                check(); return value;
            } finally { clearTimeout(timer); }
        };
        const read = url => run(async () => { const response = await window.fetch(url); check(); if (!response.ok) throw new Error('Provider request failed (' + response.status + ').'); const value = await response.json(); check(); return value; });
        const status = { players: { status: 'loading' }, status: 'loading', completed: 0, total: options.leagues.length };
        let players = options.players || {};
        const leagues = options.leagues.map(league => ({ ...league, rosters: (league.rosters || []).map(r => ({ ...r, players: Array.isArray(r.players) ? r.players.slice() : r.players })),
            empireAssessments: [], empireDna: {}, empirePickState: null,
            empireEvidence: { values: { status: 'loading' }, picks: { status: 'loading' }, stats: { status: 'loading' }, dna: { status: 'loading' }, assessments: { status: 'loading' } } }));
        const publish = () => { check(); const result = { players, leagues: leagues.slice(), status: { ...status } }; options.onProgress?.(result); return result; };
        publish();
        try {
            if (!Object.keys(players).length) players = await run(() => App.fetchAllPlayers());
            if (!object(players) || !Object.keys(players).length) throw new Error('Player metadata is unavailable.');
            status.players = { status: 'ready' };
        } catch (error) { check(); players = {}; status.players = unavailable(error.message); }
        publish();
        const rawStats = new Map();
        let nflStateRequest;
        const nflStateFor = () => nflStateRequest || (nflStateRequest = read('https://api.sleeper.app/v1/state/nfl').then(state => {
            if (!object(state) || !/^\d{4}$/.test(String(state.season)) || !['pre', 'regular', 'post', 'off'].includes(state.season_type)) throw new Error('The current NFL season context is unavailable.');
            return state;
        }));
        const statsFor = season => {
            if (!rawStats.has(season)) rawStats.set(season, run(() => {
                if (typeof window.fetchSeasonStats !== 'function') throw new Error('Season statistics are unavailable.');
                return window.fetchSeasonStats(String(season));
            }));
            return rawStats.get(season);
        };
        for (let index = 0; index < leagues.length; index++) {
            check(); const league = leagues[index], source = providerOf(league), evidence = league.empireEvidence;
            const rostersKnown = league.rosters.length > 0 && league.rosters.every(r => Array.isArray(r.players));
            let picksRaw = null, pickState = null;
            try {
                if (!rostersKnown || league._portfolioStale) throw new Error('Current roster holdings are unavailable. Refresh league sync.');
                if (!App.TradePickInventory) throw new Error('The verified draft-ownership adapter has not loaded.');
                picksRaw = await run(() => App.TradePickInventory.load(league, league.rosters));
                pickState = App.TradePickInventory.inventory(league, league.rosters, picksRaw);
                evidence.picks = { status: pickState.status === 'ready' && pickState.coverage.complete ? 'ready' : 'unavailable', ...pickState.coverage };
                league.empirePickState = pickState;
                if (picksRaw.status === 'ready') {
                    league.drafts = picksRaw.league.drafts;
                    league.tradedPicks = picksRaw.tradedPicks;
                } else delete league.tradedPicks;
            } catch (error) { check(); evidence.picks = unavailable(error.message); delete league.tradedPicks; }
            check();
            let stats = {};
            try {
                const year = Number(league.season);
                if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error('The league season is unavailable.');
                const raw = await statsFor(year); check();
                if (!object(raw)) throw new Error('Season statistics are incomplete.');
                stats = normalizeStats(raw, league.scoring_settings, false);
                evidence.stats = { status: Object.keys(stats).length ? 'ready' : 'unavailable', season: String(year), basis: 'current-season' };
                // Preserve the established offseason historical basis explicitly.
                // An outage is not an empty successful season and never falls back.
                if (!Object.keys(raw).length) {
                    const prior = await statsFor(year - 1); check();
                    stats = normalizeStats(prior, league.scoring_settings, true);
                    evidence.stats = { status: Object.keys(stats).length ? 'historical' : 'unavailable', season: String(year - 1), requestedSeason: String(year), basis: 'prior-season' };
                }
            } catch (error) { check(); evidence.stats = unavailable(error.message); }
            check();
            // Named capabilities prevent a mixed/older shared bundle from
            // interpreting these arguments as the old active-global build.
            if (rostersKnown && !league._portfolioStale && evidence.picks.status === 'ready' && pickState?.coverage.format === 'dynasty'
                && source === 'sleeper' && status.players.status === 'ready' && Object.keys(stats).length) {
                try {
                    if (typeof App.loadLeagueIntelContext !== 'function' || typeof App.assessAllTeamsWithContext !== 'function') throw new Error('The league-context value engine has not loaded. Reload and retry Empire sync.');
                    const nflState = await nflStateFor(); check();
                    // The canonical engine's historical in-season interpretation
                    // still needs its own validation. Do not label it current.
                    if (String(nflState.season) !== String(league.season)) throw new Error('Historical league value context is not yet verified. Current holdings remain available.');
                    const selected = { ...engineLeague(league), drafts: picksRaw.league.drafts };
                    const state = { currentLeagueId: idOf(league), season: String(league.season), platform: source,
                        leagues: [selected], rosters: league.rosters, players, drafts: selected.drafts,
                        tradedPicks: picksRaw.tradedPicks, nflState, depthCharts: {} };
                    let engineCurrent = true;
                    const current = () => engineCurrent && active();
                    let result;
                    try { result = await run(() => App.loadLeagueIntelContext({ state, isCurrent: current, timeoutMs: options.timeoutMs || 20000 })); }
                    catch (error) { engineCurrent = false; throw error; }
                    check();
                    if (String(result?.leagueId) !== idOf(league) || String(result?.season) !== String(league.season)
                        || !object(result?.data?.playerScores) || !Object.keys(result.data.playerScores).length
                        || Object.values(result.data.playerScores).some(value => !Number.isFinite(value) || value < 0)) throw new Error('The value engine did not confirm this league and season.');
                    const scores = Object.freeze({ ...result.data.playerScores });
                    const context = { active: true, current, key: valueKey(league), scores, assessments: [] };
                    valueContexts.set(league, context);
                    evidence.values = { status: 'ready', leagueId: idOf(league), season: String(league.season), basis: 'league-context', inputCoverage: 'unverified' };
                    // Source/ledger completeness is a separate engine gate. These
                    // are calculated reads, not proof that every feed is current.
                    const assessments = App.assessAllTeamsWithContext(league.rosters, players, stats, selected, league.users || [], picksRaw.tradedPicks,
                        { leagueId: idOf(league), season: String(league.season), playerScores: scores, isCurrent: current });
                    check();
                    if (!Array.isArray(assessments) || assessments.length !== league.rosters.length) throw new Error('Team assessments are incomplete.');
                    context.assessments = assessments;
                    league.empireAssessments = assessments;
                    evidence.assessments = { status: 'ready', stats: { ...evidence.stats }, valueBasis: 'league-context', inputCoverage: 'unverified' };
                } catch (error) { check();
                    if (!valueContexts.has(league)) evidence.values = unavailable(error.message);
                    evidence.assessments = unavailable(error.message);
                }
            } else {
                evidence.values = unavailable('League values need verified current dynasty rights, roster holdings and scored season data.');
                evidence.assessments = unavailable('Team reads need verified dynasty rights, roster holdings, scored season data and the league-context value engine.');
            }
            publish();
            // Read the current principal's saved cloud DNA directly. The legacy
            // OD.loadDNA reader writes unscoped local cache after its await.
            let saved = {}, transactions = [], savedReady = false, transactionReady = false;
            try {
                check();
                const token = window.OD?.getSessionToken?.(), owner = window.getOwnerIdentity?.();
                const db = token && (owner?.userId || owner?.username) && window.OD?.getClient?.();
                if (!db) throw new Error('Saved owner notes require a current account connection.');
                let query = db.from('owner_dna').select('dna_map');
                query = owner.userId ? query.eq('user_id', owner.userId) : query.eq('username', owner.username);
                const reply = await run(() => query.eq('league_id', idOf(league)).maybeSingle());
                if (reply.error || (reply.data?.dna_map != null && !object(reply.data.dna_map))) throw new Error('Saved owner notes could not load.');
                saved = reply.data?.dna_map || {}; savedReady = true;
            } catch (error) { check(); evidence.dna = unavailable(error.message); }
            try {
                if (source === 'sleeper') {
                    // League IDs identify their season; explicit league URLs avoid
                    // WrTxns' implicit active-season context and failure-to-[] cache.
                    for (let week = 0; week <= 18; week++) {
                        const rows = await read('https://api.sleeper.app/v1/league/' + idOf(league) + '/transactions/' + week);
                        if (!Array.isArray(rows) || rows.some(row => !object(row) || !['trade', 'waiver', 'free_agent'].includes(row.type)
                            || typeof row.status !== 'string' || !row.status.trim()
                            || (row.league_id && String(row.league_id) !== idOf(league)))) throw new Error('League transaction evidence is incomplete.');
                        transactions.push(...rows.filter(row => row.status === 'complete'));
                    }
                    transactionReady = true;
                } else if (league.transactionStatus?.status === 'ready' && String(league.transactionStatus.leagueId) === idOf(league) && String(league.transactionStatus.season) === String(league.season) && Array.isArray(league.transactions)) {
                    transactions = league.transactions; transactionReady = true;
                }
            } catch (error) { check(); transactions = []; evidence.transactions = unavailable(error.message); }
            check();
            if (savedReady || transactionReady) league.empireDna = App.buildEmpireDna?.(saved, transactionReady ? transactions : [], league.rosters, options.sleeperUserId) || saved;
            evidence.dna = { status: savedReady && transactionReady ? 'ready' : 'partial', savedNotes: savedReady ? 'ready' : 'unavailable', transactions: transactionReady ? 'ready' : 'unavailable' };
            evidence.transactions = transactionReady ? { status: 'ready', provider: source, leagueId: idOf(league), season: String(league.season) } : (evidence.transactions || league.transactionStatus || unavailable('Provider transaction history has not been verified.'));
            status.completed++; publish();
        }
        status.status = 'ready'; return publish();
    }
    App.PublicEmpire = { load, normalizeStats, providerOf, valuesFor, assessmentsFor };
})();
