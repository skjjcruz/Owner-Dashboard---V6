// ESPN hub loading is read-only with respect to the active league bridge.
// Selection is explicit; an ESPN team is never inferred from a Sleeper user.
(function () {
    const App = window.App = window.App || {};
    const contexts = new WeakMap();
    const localKeys = ['fw_session_v1', 'od_auth_v1', 'wr_guest_v1', 'espn_league_id', 'espn_year'];
    const sessionKeys = ['espn_s2', 'espn_swid'];
    let boundary = 0;
    window.addEventListener('storage', event => {
        if (!event.key || localKeys.includes(event.key) || /^sb-.*-auth-token$/.test(event.key)) boundary++;
    });
    function accountKey() {
        try {
            const raw = localStorage.getItem('fw_session_v1');
            if (!raw) return localStorage.getItem('wr_guest_v1') === '1' ? 'guest' : null;
            const session = JSON.parse(raw);
            if (typeof session?.token !== 'string' || session.token.split('.').length !== 3) return null;
            const claims = JSON.parse(window.atob(session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (typeof session.user?.id !== 'string' || !session.user.id || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()
                || claims.sub !== session.user.id || claims.app_metadata?.user_id !== session.user.id) return null;
            return String(session.user.id);
        } catch (_) { return null; }
    }
    function capture() {
        return { account: accountKey(), boundary, local: localKeys.map(k => localStorage.getItem(k)), session: sessionKeys.map(k => sessionStorage.getItem(k)) };
    }
    function isCurrent(snapshot) {
        try {
            const now = capture();
            return !!snapshot?.account && now.account === snapshot.account && now.boundary === snapshot.boundary
                && now.local.every((v, i) => v === snapshot.local[i]) && now.session.every((v, i) => v === snapshot.session[i]);
        } catch (_) { return false; }
    }
    function requireCurrent(snapshot) {
        if (!isCurrent(snapshot)) throw new Error('Your account or ESPN connection changed. Reload to continue with the current account.');
    }
    function readSaved() {
        const leagueId = localStorage.getItem('espn_league_id');
        if (!leagueId) return null;
        return { leagueId, year: localStorage.getItem('espn_year'), espnS2: sessionStorage.getItem('espn_s2') || '', swid: sessionStorage.getItem('espn_swid') || '' };
    }
    function selectedRoster(league, rosters) {
        return league?._espnTeamId == null ? undefined : (rosters || []).find(r => String(r.roster_id) === String(league._espnTeamId));
    }
    function teamKey(snapshot, league) { return 'espn_team_v1:' + encodeURIComponent(snapshot.account) + ':' + league.id; }
    function bind(league, snapshot) { contexts.set(league, snapshot); return league; }
    function isLeagueCurrent(league) { return isCurrent(contexts.get(league)); }
    function chooseTeam(league, teamId) {
        const snapshot = contexts.get(league); requireCurrent(snapshot);
        const roster = (league.rosters || []).find(r => String(r.roster_id) === String(teamId));
        if (!roster) throw new Error('Choose a team from this ESPN league.');
        try { localStorage.setItem(teamKey(snapshot, league), String(roster.roster_id)); }
        catch (_) { throw new Error('Your team choice could not be saved. Free some browser storage and try again.'); }
        return bind({ ...league, _espnTeamId: String(roster.roster_id), wins: roster.settings?.wins, losses: roster.settings?.losses, ties: roster.settings?.ties }, snapshot);
    }
    async function load(connection, { timeoutMs = 20000 } = {}) {
        const snapshot = capture(); requireCurrent(snapshot);
        const input = connection || readSaved();
        if (!input || !/^[1-9]\d*$/.test(String(input.leagueId || '')) || !/^\d{4}$/.test(String(input.year || ''))) {
            throw new Error('The saved ESPN league ID or season is missing. Reconnect the league with its exact ID and season.');
        }
        const { leagueId, year } = input;
        const espnS2 = input.espnS2 || '', swid = input.swid || '';
        if (!!espnS2 !== !!swid) throw new Error('Add both espn_s2 and SWID cookies for this private league.');
        if (!window.ESPN?.fetchLeague || !window.ESPN?.mapToSleeperState || !window.ESPN?.buildCrosswalk) throw new Error('The ESPN connector is not ready. Try loading the league again.');
        let timer;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ESPN took too long to respond. Try loading the league again.')), timeoutMs); });
        let raw;
        try { raw = await Promise.race([window.ESPN.fetchLeague(leagueId, year, espnS2 || null, swid || null), timeout]); }
        finally { clearTimeout(timer); }
        requireCurrent(snapshot);
        const teams = raw?.teams;
        if (!raw || raw.error || (raw.id != null && String(raw.id) !== String(leagueId)) || (raw.seasonId != null && String(raw.seasonId) !== String(year))
            || typeof raw.settings?.name !== 'string' || !raw.settings.name.trim() || !raw.settings?.rosterSettings || !raw.settings?.scoringSettings
            || !Array.isArray(teams) || teams.length === 0 || teams.some(t => !t || t.id == null || !Array.isArray(t.roster?.entries))
            || (raw.settings.size != null && Number(raw.settings.size) !== teams.length)
            || new Set(teams.map(t => String(t.id))).size !== teams.length) {
            throw new Error('ESPN did not return the complete league and rosters for this season. Your connection is saved; try again.');
        }
        const entries = teams.flatMap(t => t.roster.entries);
        const crosswalk = window.ESPN.buildCrosswalk({}, entries, year);
        const result = window.ESPN.mapToSleeperState(raw, leagueId, year, crosswalk);
        requireCurrent(snapshot);
        const lg = result.league;
        const league = { ...lg, id: lg.league_id, league_id: lg.league_id, season: String(year),
            rosters: result.rosters, users: result.leagueUsers, _espn: true, _platform: 'espn', _source: 'espn',
            _espnLeagueId: String(leagueId), _espnTeamId: null, wins: null, losses: null, ties: null };
        // Save only after a verified response. Cookies stay session-only. On a
        // failed write, restore only values written by this transaction.
        const changes = [[localStorage, 'espn_league_id', String(leagueId)], [localStorage, 'espn_year', String(year)],
            [sessionStorage, 'espn_s2', espnS2 || null], [sessionStorage, 'espn_swid', swid || null]];
        const written = [];
        try {
            for (const [storage, key, value] of changes) {
                const previous = storage.getItem(key);
                if (previous === value) continue;
                if (value === null) storage.removeItem(key); else storage.setItem(key, value);
                written.push({ storage, key, value, previous });
            }
        } catch (_) {
            for (const { storage, key, value, previous } of written.reverse()) {
                try { if (storage.getItem(key) === value) { if (previous === null) storage.removeItem(key); else storage.setItem(key, previous); } } catch (_) {}
            }
            throw new Error('The ESPN connection could not be saved. Free some browser storage and try again.');
        }
        const installed = capture();
        const savedTeam = localStorage.getItem(teamKey(installed, league));
        const myRoster = result.rosters.find(r => String(r.roster_id) === savedTeam);
        if (myRoster) Object.assign(league, { _espnTeamId: savedTeam, wins: myRoster.settings?.wins, losses: myRoster.settings?.losses, ties: myRoster.settings?.ties });
        return bind(league, installed);
    }
    App.EspnHub = { load, readSaved, capture, isCurrent, isLeagueCurrent, chooseTeam, selectedRoster };
})();
