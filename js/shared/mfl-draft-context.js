/* MFL draft readers use saved credentials with known ownership. This client
 * continuity check complements the provider/server boundary; it is not auth. */
(function () {
    'use strict';
    const App = window.App = window.App || {};
    let connectionEpoch = 0;
    window.addEventListener('storage', event => {
        if (!event.key || event.key.startsWith('mfl_')) connectionEpoch++;
    });
    function capture(league, options = {}) {
        const provider = window.MFL?.provider;
        if (!provider?.loadCredentials || !App.PublicPortfolio) throw new Error('MFL draft connector is unavailable. Reload and retry.');
        const key = String(league?.league_id || league?.id || '');
        const selected = /^mfl_([1-9]\d*)_((?:19|20|21)\d{2})$/.exec(key);
        if (!selected || (league.id && String(league.id) !== key)
            || (league._mflLeagueId && String(league._mflLeagueId) !== selected[1])
            || (league.season && String(league.season) !== selected[2])) throw new Error('MFL draft league and season do not match. Reopen the selected league.');
        const identity = App.PublicPortfolio.capture(), epoch = connectionEpoch;
        const viewValues = () => JSON.stringify([
            league.id, league.league_id, league.season, league._mflLeagueId, league._mflFranchiseId,
            league._mflDraftPlayerPool, league._mflDraftKind, league.total_rosters, league.settings?.type,
            league._platformCreds,
        ]);
        const view = viewValues();
        const read = () => {
            const creds = provider.loadCredentials(key);
            const supplied = league._platformCreds;
            if (!creds || !provider.isConnectionCurrent(creds)
                || String(creds.leagueId) !== selected[1] || String(creds.year) !== selected[2]
                || (supplied && (!provider.isConnectionCurrent(supplied)
                    || String(supplied.leagueId) !== selected[1] || String(supplied.year) !== selected[2]
                    || (supplied.franchiseId && String(supplied.franchiseId) !== String(creds.franchiseId || ''))
                    || (Object.prototype.hasOwnProperty.call(supplied, 'apiKey') && (supplied.apiKey || null) !== (creds.apiKey || null))))
                || (league._mflFranchiseId && String(creds.franchiseId || '') !== String(league._mflFranchiseId))) {
                throw new Error('Reconnect this MFL league and team for the current account.');
            }
            return creds;
        };
        const connectionValues = () => JSON.stringify([
            ['mfl_league_id', 'mfl_year', 'mfl_franchise_id', 'mfl_connection_owner_v1'].map(key => window.localStorage.getItem(key)),
            ['mfl_api_key', 'mfl_api_key_context_v1', 'mfl_guest_owner_v1'].map(key => window.sessionStorage.getItem(key)),
        ]);
        const creds = read(), saved = JSON.stringify(creds), connection = connectionValues();
        let retired = false;
        const isCurrent = () => {
            if (retired) return false;
            try {
                if (App.PublicPortfolio.current(identity) && epoch === connectionEpoch
                    && (!options.isCurrent || options.isCurrent()) && viewValues() === view
                    && connectionValues() === connection && JSON.stringify(read()) === saved) return true;
            } catch (_) { /* unknown owner/storage is not a usable connection */ }
            retired = true; return false;
        };
        const check = () => { if (!isCurrent()) throw new Error('MFL account, connection or selected draft changed. Reopen the current league.'); };
        check();
        return Object.freeze({ key, isCurrent, check, async fetch() {
            check();
            if (!window.MFL?.fetchDraftStatus) throw new Error('MFL draft connector is unavailable. Reload and retry.');
            const rows = await window.MFL.fetchDraftStatus(selected[1], selected[2], creds.apiKey || null, league, null, { isCurrent });
            check();
            if (!Array.isArray(rows) || rows.some(row => !row || String(row.league_id) !== key
                || String(row.season) !== selected[2]
                || !new RegExp('^mfl_draft_' + selected[1] + '_' + selected[2] + '(?:_\\d+)?$').test(String(row.draft_id)))) {
                throw new Error('MFL returned draft data for a different league or season. Retry the selected league.');
            }
            return rows;
        } });
    }
    function captureDraft(draftId, options) {
        const selected = /^mfl_draft_([1-9]\d*)_((?:19|20|21)\d{2})(?:_\d+)?$/.exec(String(draftId || ''));
        if (!selected) throw new Error('MFL draft ID must include its league and season.');
        const key = 'mfl_' + selected[1] + '_' + selected[2];
        if (options?.league && String(options.league.league_id || options.league.id) !== key) throw new Error('MFL draft does not belong to the selected league.');
        return capture(options?.league || { league_id: key, season: selected[2] }, options);
    }
    App.MflDraftContext = { capture, captureDraft };
})();
