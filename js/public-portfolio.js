/* Public hub data coordination. Identity snapshots prevent late publication;
 * they do not replace server authentication or authenticate browser storage. */
(function () {
    'use strict';
    const App = window.App = window.App || {};
    let boundary = 0;
    const keys = ['fw_session_v1', 'od_auth_v1', 'wr_guest_v1', 'od_session_v1'];
    window.addEventListener('storage', event => {
        if (!event.key || keys.includes(event.key) || /^sb-.*-auth-token$/.test(event.key)) boundary++;
    });
    const identities = new WeakMap();
    function values() {
        const providerKeys = Object.keys(window.localStorage).filter(key => /^sb-.*-auth-token$/.test(key)).sort();
        return JSON.stringify([...keys, ...providerKeys].map(key => [key, window.localStorage.getItem(key)]));
    }
    function capture() { try { return { boundary, values: values() }; } catch (e) { return null; } }
    function current(snapshot) {
        if (!snapshot || snapshot.invalidated) return false;
        try { if (snapshot.boundary === boundary && snapshot.values === values()) return true; } catch (e) { /* fail closed */ }
        snapshot.invalidated = true; return false;
    }
    function bind(result, identity) { identities.set(result, identity); return result; }
    function leagueCoverage(coverage) {
        if (!coverage || coverage.status === 'idle') return '';
        const known = coverage.listVerified ? coverage.knownCount : null;
        const counts = known == null ? 'League count unverified' : (coverage.loadedCount || 0) + ' of ' + known + ' Sleeper leagues loaded';
        return counts + (coverage.staleCount ? '; ' + coverage.staleCount + ' use previously loaded data' : '')
            + (coverage.pendingCount ? '; ' + coverage.pendingCount + ' still loading' : '')
            + (coverage.status !== 'ready' ? '. Missing league holdings are unknown.' : '.');
    }
    async function fetchSleeperPortfolio(options) {
        const { username, season, onProgress = () => {} } = options;
        const identity = options.identity || capture();
        const isCurrent = () => current(identity) && (!options.isCurrent || options.isCurrent());
        const check = () => { if (!isCurrent()) throw new Error('Portfolio context changed. Reopen the current account or season.'); };
        const identifier = String(username || '').trim();
        const contextKey = identifier.toLowerCase() + ':' + String(season);
        let previous = options.previous?.contextKey === contextKey && current(identities.get(options.previous)) ? options.previous : {};
        const fetcher = options.fetcher || window.fetch.bind(window);
        const publish = value => { check(); const result = bind(value, identity); onProgress(result); return result; };
        async function read(path) {
            check();
            const controller = new window.AbortController();
            let timer, expired = false;
            const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
                expired = true; controller.abort(); reject(new Error('Sleeper took too long to respond. Retry league sync.'));
            }, options.timeoutMs || 20000); });
            try {
                return await Promise.race([(async () => {
                    const response = await fetcher('https://api.sleeper.app/v1/' + path, { signal: controller.signal });
                    check(); if (expired) throw new Error('Sleeper request timed out.');
                    if (!response.ok) throw new Error(response.status === 404 && /^user\/[^/]+$/.test(path) ? 'SLEEPER_USER_NOT_FOUND' : 'Sleeper request failed (' + response.status + ')');
                    const data = await response.json(); check();
                    if (expired) throw new Error('Sleeper request timed out.');
                    return data;
                })(), timeout]);
            } finally { clearTimeout(timer); }
        }
        check();
        if (!identifier || !/^\d{4}$/.test(String(season))) throw new Error('Select a connected account and league season.');
        let user, listed, userVerified = false;
        try {
            user = await read('user/' + encodeURIComponent(identifier));
            if (user === null) throw new Error('SLEEPER_USER_NOT_FOUND');
            if (typeof user?.user_id !== 'string' || !/^\d+$/.test(user.user_id) || typeof user.username !== 'string' || !user.username.trim()) throw new Error('Invalid Sleeper user response');
            // Sleeper accepts an exact user ID or a case-insensitive username. A
            // well-shaped response for a different person is not this connection.
            if (user.user_id !== identifier && user.username.toLowerCase() !== identifier.toLowerCase()) throw new Error('Sleeper user does not match the requested connection');
            userVerified = true;
            if (previous.user?.user_id && previous.user.user_id !== user.user_id) previous = {};
            listed = await read('user/' + encodeURIComponent(user.user_id) + '/leagues/nfl/' + encodeURIComponent(season));
            if (!Array.isArray(listed) || listed.some(league => typeof league?.league_id !== 'string' || !/^\d+$/.test(league.league_id) || String(league.season) !== String(season) || (league.sport && league.sport !== 'nfl'))) throw new Error('Invalid league list');
        } catch (err) {
            check();
            const leagues = (previous.leagues || []).map(league => ({ ...league, _portfolioStale: true }));
            const coverage = { ...(previous.coverage || {}), status: leagues.length ? 'stale' : 'error', listVerified: false, knownCount: null, lastKnownCount: previous.coverage?.knownCount ?? previous.coverage?.lastKnownCount ?? null, pendingCount: 0, freshCount: 0, staleCount: leagues.length, loadedCount: leagues.length,
                error: err.message === 'SLEEPER_USER_NOT_FOUND' ? "Couldn't find that Sleeper username. Check your connection and try again." : 'Could not refresh the Sleeper league list. Try again.' };
            const result = { contextKey, user: previous.user || (userVerified ? user : null), leagues, coverage };
            return publish(result);
        }
        // Defensive deduplication avoids inflating either the denominator or requests.
        const known = [...new Map(listed.map(league => [String(league.league_id), league])).values()];
        const old = new Map((previous.leagues || []).map(league => [String(league.id), league]));
        const fresh = new Map(), failed = new Set(), pending = new Set(known.map(league => String(league.league_id)));
        const snapshot = () => {
            const leagues = known.map(league => {
                const id = String(league.league_id);
                return fresh.get(id) || (old.has(id) ? { ...old.get(id), _portfolioStale: true } : null);
            }).filter(Boolean);
            const unavailable = known.filter(league => !fresh.has(String(league.league_id)) && !old.has(String(league.league_id))).map(league => ({ id: String(league.league_id), name: league.name || 'League' }));
            return { contextKey, user, leagues, coverage: {
                status: pending.size ? 'loading' : failed.size ? (leagues.length ? 'partial' : 'error') : 'ready',
                listVerified: true, knownCount: known.length, loadedCount: leagues.length, freshCount: fresh.size,
                staleCount: leagues.length - fresh.size, failedCount: failed.size, pendingCount: pending.size,
                knownLeagues: known.map(league => ({ id: String(league.league_id), name: league.name || 'League' })),
                unavailable, error: failed.size ? 'Some Sleeper league details could not load.' : null,
            } };
        };
        publish(snapshot());
        await Promise.all(known.map(async league => {
            const id = String(league.league_id);
            try {
                const [rosters, users] = await Promise.all([read('league/' + encodeURIComponent(id) + '/rosters'), read('league/' + encodeURIComponent(id) + '/users')]);
                const nullIsKnownEmpty = ['pre_draft', 'drafting'].includes(league.status);
                if (!Array.isArray(rosters) || !Array.isArray(users) || !rosters.length
                    || (league.total_rosters != null && Number(league.total_rosters) !== rosters.length)
                    || new Set(rosters.map(r => String(r?.roster_id))).size !== rosters.length
                    || new Set(users.map(u => u?.user_id)).size !== users.length
                    || users.some(u => typeof u?.user_id !== 'string' || !/^\d+$/.test(u.user_id))
                    || rosters.some(r => !r || !Number.isInteger(Number(r.roster_id)) || Number(r.roster_id) < 1
                        || (r.league_id && String(r.league_id) !== id)
                        || (!Array.isArray(r.players) && !(r.players === null && nullIsKnownEmpty))
                        || (r.owner_id && !users.some(u => u.user_id === r.owner_id)))) throw new Error('Invalid or incomplete league details');
                const mine = rosters.find(roster => String(roster.owner_id) === user.user_id || (roster.co_owners || []).map(String).includes(user.user_id));
                fresh.set(id, { ...league, id, league_id: id, name: league.name, status: league.status || '', season: String(season),
                    myRosterId: mine?.roster_id ?? null,
                    wins: mine?.settings?.wins ?? null, losses: mine?.settings?.losses ?? null, ties: mine?.settings?.ties ?? null,
                    scoring_settings: league.scoring_settings || {}, roster_positions: league.roster_positions || [],
                    settings: league.settings || {}, rosters: rosters.map(roster => ({ ...roster,
                        players: roster.players === null ? [] : roster.players,
                        _portfolioPlayersEvidence: roster.players === null ? 'pre-draft-empty' : 'provided' })), users, _portfolioStale: false });
            } catch (_) { failed.add(id); }
            finally { pending.delete(id); if (isCurrent()) publish(snapshot()); }
        }));
        // Return the snapshot directly: React may defer state-updater callbacks.
        check(); return bind(snapshot(), identity);
    }

    App.PublicPortfolio = { capture, current, fetchSleeperPortfolio, leagueCoverage };
})();
