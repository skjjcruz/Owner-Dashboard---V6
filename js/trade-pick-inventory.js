/* Trade Center adapter: ownership comes from league-bound provider evidence and
 * the canonical shared remaining-rights model. This module does not price assets. */
(function () {
    'use strict';
    const App = window.App = window.App || {};
    let boundary = 0;
    const identities = new WeakMap(), connections = new WeakMap();
    const connectionKey = league => JSON.stringify([league?._mflLeagueId, league?._platformCreds?.leagueId, league?._platformCreds?.year, league?._platformCreds?.apiKey]);
    const bindEvidence = (result, snapshot, connection) => { identities.set(result, snapshot); connections.set(result, connection); return result; };
    const validInventory = state => !!state && current(identities.get(state)) && connections.get(state) === connectionKey(state.league);
    const accountKeys = ['fw_session_v1', 'od_auth_v1', 'wr_guest_v1', 'od_session_v1'];
    window.addEventListener('storage', event => {
        if (!event.key || accountKeys.includes(event.key) || /^sb-.*-auth-token$/.test(event.key)) boundary++;
    });
    const lid = league => String(league?.league_id ?? league?.id ?? '');
    const integer = value => value != null && String(value).trim() !== '' && Number.isInteger(Number(value)) ? Number(value) : null;
    const provider = league => league?._mfl || lid(league).startsWith('mfl_') ? 'mfl'
        : league?._espn || lid(league).startsWith('espn_') ? 'espn'
            : league?._yahoo || lid(league).startsWith('yahoo_') ? 'yahoo' : /^\d+$/.test(lid(league)) ? 'sleeper' : 'unknown';
    const contextKey = (league, rosters) => JSON.stringify([lid(league), league?.season, league?.status, league?.type, league?.league_type, league?._dhq_type_override, league?.settings, league?.metadata, league?.total_rosters, (rosters || []).map(r => [r?.roster_id, r?.owner_id, r?.league_id])]);
    const capture = () => { try { return { boundary, values: accountKeys.map(key => window.localStorage.getItem(key)) }; } catch (e) { return null; } };
    const current = snapshot => {
        if (!snapshot || snapshot.invalidated) return false;
        try {
            if (snapshot.boundary === boundary && accountKeys.every((key, i) => window.localStorage.getItem(key) === snapshot.values[i])) return true;
        } catch (e) { /* unavailable identity storage fails closed */ }
        snapshot.invalidated = true; return false;
    };
    function empty(reason, status = 'unavailable') {
        return { status, byOwner: {}, coverage: { complete: false, reason }, slotMaps: {} };
    }
    function assertRosters(league, rosters) {
        const ids = new Set(), owners = new Set();
        if (!Array.isArray(rosters) || !rosters.length || (league.total_rosters != null && integer(league.total_rosters) !== rosters.length)) throw new Error('The complete league roster list is unavailable.');
        for (const r of rosters) {
            const id = String(r?.roster_id ?? ''), owner = String(r?.owner_id ?? '');
            if (!id || !owner || ids.has(id) || owners.has(owner) || (r.league_id && String(r.league_id) !== lid(league))) throw new Error('Pick ownership cannot be matched to the league teams.');
            ids.add(id); owners.add(owner);
        }
    }
    async function load(league, rosters, options = {}) {
        const snapshot = options.snapshot || capture();
        const check = () => { if (!current(snapshot)) throw new Error('The account changed. Reopen this league before checking picks.'); };
        check(); assertRosters(league, rosters);
        const season = integer(league.season);
        if (!season || season < 2000 || season > 2200) throw new Error('The league draft season is unavailable.');
        const source = provider(league);
        const context = contextKey(league, rosters);
        const connection = connectionKey(league);
        if (!['sleeper', 'mfl'].includes(source)) return { ...empty('This provider has not supplied verified draft-pick ownership.'), leagueId: lid(league), season };
        const controller = new AbortController();
        let timer;
        const json = async url => {
            check();
            if (controller.signal.aborted) throw new Error('Draft-pick loading timed out. Retry to check current ownership.');
            const response = await window.fetch(url, { signal: controller.signal });
            check();
            if (!response.ok) throw new Error('Draft-pick data could not load (' + response.status + '). Retry to check current ownership.');
            const data = await response.json(); check();
            if (controller.signal.aborted) throw new Error('Draft-pick loading timed out. Retry to check current ownership.');
            return data;
        };
        const work = async () => {
            if (source === 'mfl') {
                const api = window.MFL;
                if (!api?.fetchDraftStatus || !api?.fetchFutureDraftPicks) throw new Error('The MFL draft connection is unavailable.');
                const id = String(league._mflLeagueId || league._platformCreds?.leagueId || '');
                if (!/^\d+$/.test(id) || lid(league) !== 'mfl_' + id + '_' + season || (league._platformCreds?.leagueId != null && String(league._platformCreds.leagueId) !== id) || (league._platformCreds?.year != null && Number(league._platformCreds.year) !== season)) throw new Error('The MFL league connection is incomplete.');
                const key = league._platformCreds?.apiKey || null;
                // Both provider calls start under this snapshot; neither chains
                // another private request after its reply. Never read global S.
                check();
                const [drafts, futureRaw] = await Promise.all([
                    api.fetchDraftStatus(id, String(season), key, league),
                    api.fetchFutureDraftPicks(id, String(season), key),
                ]);
                check();
                return { status: 'ready', context, leagueId: lid(league), season, source, league: { ...league, status: Array.isArray(drafts) && drafts.length ? league.status : 'unknown', drafts: Array.isArray(drafts) ? drafts : [] }, tradedPicks: [], futureRaw };
            }
            const base = 'https://api.sleeper.app/v1/';
            const [tradedPicks, list] = await Promise.all([
                json(base + 'league/' + lid(league) + '/traded_picks'),
                json(base + 'league/' + lid(league) + '/drafts'),
            ]);
            if (!Array.isArray(tradedPicks) || !Array.isArray(list)) throw new Error('The provider returned incomplete draft-pick data.');
            const ids = new Set();
            for (const d of list) {
                if (!d || !/^\d+$/.test(String(d.draft_id || '')) || ids.has(String(d.draft_id)) || (d.league_id && String(d.league_id) !== lid(league)) || !integer(d.season)) throw new Error('The draft list does not match this league.');
                ids.add(String(d.draft_id));
            }
            const drafts = await Promise.all(list.filter(d => Number(d.season) >= season && Number(d.season) <= season + 3).map(async row => {
                const detail = await json(base + 'draft/' + row.draft_id);
                if (!detail || String(detail.draft_id) !== String(row.draft_id) || Number(detail.season) !== Number(row.season) || (detail.league_id && String(detail.league_id) !== lid(league))) throw new Error('The draft response does not match this league and season.');
                const draft = { ...row, ...detail };
                if (String(draft.status).toLowerCase() === 'drafting') {
                    draft.picks = await json(base + 'draft/' + row.draft_id + '/picks');
                    if (!Array.isArray(draft.picks)) throw new Error('Current draft progress is unavailable.');
                }
                return draft;
            }));
            check();
            return { status: 'ready', context, leagueId: lid(league), season, source, league: { ...league, drafts }, tradedPicks };
        };
        try {
            const result = await Promise.race([work(), new Promise((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(new Error('Draft-pick loading timed out. Retry to check current ownership.')); }, options.timeoutMs || 20000);
            })]);
            check();
            return bindEvidence(result, snapshot, connection);
        } finally { clearTimeout(timer); }
    }
    function inventory(league, rosters, evidence) {
        if (!evidence || evidence.leagueId !== lid(league) || evidence.season !== integer(league.season)) return empty('Checking draft-pick ownership…', 'loading');
        if (evidence.status !== 'ready') return empty(evidence.coverage?.reason || evidence.error || (evidence.status === 'loading' ? 'Checking draft-pick ownership…' : 'Draft-pick ownership is unavailable.'), evidence.status);
        if (!current(identities.get(evidence))) return empty('The account changed. Reopen this league before checking picks.');
        if (connections.get(evidence) !== connectionKey(league)) return empty('The league connection changed. Refresh picks.');
        if (evidence.context !== contextKey(league, rosters)) return empty('League settings or team ownership changed. Refresh picks.', 'loading');
        try {
            assertRosters(league, rosters);
            const model = App.buildPicksByOwner?.(rosters, evidence.league, evidence.tradedPicks);
            if (!model?.coverage) return empty('The draft ownership update is not available yet. Player trades remain available.');
            const coverage = { ...model.coverage }, byOwner = {}, slotMaps = {};
            const source = evidence.source;
            const currentYear = Number(league.season);
            rosters.forEach(r => {
                byOwner[String(r.owner_id)] = (model[String(r.roster_id)] || [])
                    // MFL future rights come only from its exact allocation feed.
                    .filter(p => source !== 'mfl' || p.year === currentYear)
                    .map(p => ({ year: p.year, round: p.round, fromRosterId: String(p.originalOwnerRid ?? r.roster_id), ...(p.slot != null ? { slot: p.slot } : {}) }));
            });
            if (source === 'mfl' && coverage.format === 'dynasty') {
                const raw = evidence.futureRaw?.futureDraftPicks;
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                    coverage.complete = false; coverage.reason = 'MFL future-pick ownership has not loaded.';
                } else if (coverage.format === 'dynasty') {
                    const franchises = raw.franchise == null ? [] : Array.isArray(raw.franchise) ? raw.franchise : [raw.franchise];
                    const owners = new Map(rosters.map(r => [String(r.roster_id), String(r.owner_id)]));
                    const seen = new Set(), future = [];
                    for (const f of franchises) {
                        const owner = owners.get(String(f?.id));
                        if (!owner) throw new Error('MFL future picks contain an unknown owner.');
                        const rows = f.futureDraftPick == null ? [] : Array.isArray(f.futureDraftPick) ? f.futureDraftPick : [f.futureDraftPick];
                        for (const p of rows) {
                            const year = integer(p?.year), round = integer(p?.round), original = String(p?.originalPickFor || f.id);
                            const key = [year, round, original].join('|');
                            if (!year || year < currentYear || year > currentYear + 20 || !round || round < 1 || round > 100 || !owners.has(original) || seen.has(key)) throw new Error('MFL future-pick ownership is incomplete or conflicting.');
                            seen.add(key);
                            if (year > currentYear) future.push({ owner, pick: { year, round, fromRosterId: original } });
                        }
                    }
                    future.forEach(({ owner, pick }) => byOwner[owner].push(pick));
                }
            }
            for (const d of evidence.league.drafts) {
                // Multiple boards cannot share a single year/round/slot label.
                if (evidence.league.drafts.filter(x => Number(x.season) === Number(d.season)).length !== 1) continue;
                const map = {}, seen = new Set();
                for (const [slot, rid] of Object.entries(d.slot_to_roster_id || {})) {
                    const n = integer(slot);
                    if (!n || n < 1 || n > rosters.length || seen.has(n) || !rosters.some(r => String(r.roster_id) === String(rid))) continue;
                    map[String(rid)] = n; seen.add(n);
                }
                if (Object.keys(map).length === rosters.length) slotMaps[Number(d.season)] = map;
            }
            return bindEvidence({ status: 'ready', byOwner, coverage, slotMaps, league: evidence.league }, identities.get(evidence), connections.get(evidence));
        } catch (error) { return empty(error.message); }
    }
    const pickId = pick => `PICK-${pick.year}-${pick.round}-${pick.fromRosterId}${pick.slot != null ? '-s' + pick.slot : ''}`;
    function owns(state, owner, id) { return validInventory(state) && state?.status === 'ready' && (state.byOwner[String(owner)] || []).some(p => pickId(p) === id); }
    function priced(state, year) {
        if (!validInventory(state) || state?.coverage?.format !== 'dynasty') return false;
        // A current startup pool is not a future rookie pick. Preserve accepted
        // dynasty prices; seasonal/startup valuation requires its own model.
        return Number(year) !== Number(state.league?.season) || !(state.league?.drafts || []).some(d => Number(d.season) === Number(year) && Number(d.settings?.player_type) === 0);
    }
    function selectionIssue(state, owners, selections) {
        for (const side of ['A', 'B']) for (const id of selections[side] || []) {
            if (!owns(state, owners[side], id)) return 'A selected pick is no longer verified for this owner. Retry ownership or remove that pick; your draft trade is preserved.';
            if (!priced(state, id.split('-')[1])) return 'Current-season startup and seasonal pick values are unavailable. Remove those picks to evaluate this trade; your selections are preserved.';
        }
        return null;
    }
    App.TradePickInventory = { capture, current, load, inventory, empty, owns, priced, pickId, selectionIssue };
})();
