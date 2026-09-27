// Detailed, observed NFL statistics. Explicit season/week requests deliberately
// bypass older helpers that swallow failures or return stale season data.
//
// Ported from C2 (WarRoom-sandbox js/shared/league-stats.js) for the Free
// Agency waiver tools. The pure helpers (metrics / value / score /
// normalizePosition) need no network. load()/loadGameLog() hit Sleeper's
// /stats/nfl/regular/<season>[/<week>] ONLY when a caller asks: each response
// is held in memory for 60s (40 entries max) and concurrent asks for the same
// key share one request. Free Agency reads weekly lines through
// App.SOS.getWeekStats first (sessionStorage-cached and already warmed by the
// SOS / DHQ projection boot) and only falls back to load() when SOS is absent.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const GROUPS = ['general', 'passing', 'rushing', 'receiving', 'offense', 'defense', 'kicking', 'returns'].map(key => ({ key, label: key[0].toUpperCase() + key.slice(1) }));
    const PRESETS = {
        general: ['fantasyPoints', 'gp', 'raw:pass_yd', 'raw:rush_yd', 'raw:rec', 'raw:rec_yd', 'raw:pass_td', 'raw:rush_td', 'raw:rec_td'],
        passing: ['raw:pass_att', 'raw:pass_cmp', 'raw:pass_yd', 'raw:pass_td', 'raw:pass_int', 'catalog:cmpPct', 'catalog:ypa'],
        rushing: ['raw:rush_att', 'raw:rush_yd', 'raw:rush_td', 'catalog:ypc', 'raw:rush_rz_att', 'raw:fum_lost'],
        receiving: ['raw:rec_tgt', 'raw:rec', 'raw:rec_yd', 'raw:rec_td', 'catalog:catchRate', 'catalog:ypr', 'catalog:yac'],
        offense: ['raw:off_snp', 'catalog:snapPct', 'catalog:rzTouches', 'raw:fum', 'raw:fum_lost'],
        defense: ['catalog:tackles', 'catalog:soloTkl', 'catalog:sacks', 'catalog:idpInts', 'catalog:passDef', 'catalog:forcedFum', 'catalog:fumRec'],
        kicking: ['raw:fgm', 'raw:fga', 'catalog:fgPct', 'raw:xpm', 'raw:xpa', 'raw:fgm_50p'],
        returns: ['raw:kr_yd', 'raw:kr_td', 'raw:pr_yd', 'raw:pr_td']
    };
    const finite = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
    const metadataKeys = new Set(['season', 'week', 'player_id', 'team_id', 'game_id', 'season_type']);
    const knownLabels = {
        gp: 'Games played', pass_att: 'Passing attempts', pass_cmp: 'Pass completions', pass_yd: 'Passing yards', pass_td: 'Passing touchdowns', pass_int: 'Interceptions thrown',
        rush_att: 'Rushing attempts', rush_yd: 'Rushing yards', rush_td: 'Rushing touchdowns', rec_tgt: 'Receiving targets', rec: 'Receptions', rec_yd: 'Receiving yards', rec_td: 'Receiving touchdowns',
        fum: 'Fumbles', fum_lost: 'Fumbles lost', off_snp: 'Offensive snaps', def_snp: 'Defensive snaps', st_snp: 'Special teams snaps',
        fgm: 'Field goals made', fga: 'Field goal attempts', xpm: 'Extra points made', xpa: 'Extra point attempts', kr_yd: 'Kick return yards', pr_yd: 'Punt return yards', kr_td: 'Kick return touchdowns', pr_td: 'Punt return touchdowns',
        gms_active: 'Games active', gs: 'Games started', tm_off_snp: 'Team offensive snaps', tm_def_snp: 'Team defensive snaps', tm_st_snp: 'Team special teams snaps',
        pass_2pt: 'Passing two-point conversions', rush_2pt: 'Rushing two-point conversions', rec_2pt: 'Receiving two-point conversions', def_2pt: 'Defensive two-point conversions',
        pass_fd: 'Passing first downs', rush_fd: 'Rushing first downs', rec_fd: 'Receiving first downs',
        pass_rz_att: 'Red zone passing attempts', rush_rz_att: 'Red zone rushing attempts', rec_rz_tgt: 'Red zone receiving targets',
        pass_air_yd: 'Passing air yards', rec_air_yd: 'Receiving air yards', rec_yar: 'Receiving yards after catch', rec_drop: 'Dropped passes',
        rush_btkl: 'Broken tackles on rushes', rush_tkl_loss: 'Rushes tackled for loss', rush_tkl_loss_yd: 'Yards lost on rushes', rush_yac: 'Rushing yards after contact',
        pass_inc: 'Incomplete passes', pass_int_td: 'Interceptions thrown returned for touchdowns', pass_sack: 'Times sacked', pass_sack_yds: 'Passing yards lost to sacks',
        pass_rtg: 'Passer rating', cmp_pct: 'Completion percentage', pass_ypa: 'Passing yards per attempt', pass_ypc: 'Passing yards per completion', rush_ypa: 'Rushing yards per carry', rec_ypr: 'Receiving yards per reception', rec_ypt: 'Receiving yards per target',
        pass_lng: 'Longest completion', rush_lng: 'Longest rush', rec_lng: 'Longest reception', pass_td_lng: 'Longest passing touchdown', rush_td_lng: 'Longest rushing touchdown', rec_td_lng: 'Longest receiving touchdown',
        pass_rush_yd: 'Combined passing and rushing yards', rush_rec_yd: 'Combined rushing and receiving yards',
        tkl: 'Total tackles', tkl_solo: 'Solo tackles', tkl_ast: 'Assisted tackles', tkl_loss: 'Tackles for loss', sack: 'Sacks', sack_yd: 'Sack yards', qb_hit: 'Quarterback hits',
        int: 'Defensive interceptions', int_ret_yd: 'Interception return yards', pass_def: 'Passes defended', def_pass_def: 'Passes defended', ff: 'Forced fumbles', fum_rec: 'Fumble recoveries', fum_ret_yd: 'Fumble return yards',
        fum_rec_td: 'Fumble recovery touchdowns', fum_rec_ez_tds: 'End-zone fumble recovery touchdowns', def_td: 'Defensive touchdowns', safe: 'Safeties', blk_kick: 'Blocked kicks', blk_kick_ret_yd: 'Blocked-kick return yards',
        def_3_and_out: 'Defensive three-and-outs', def_4_and_stop: 'Defensive fourth-down stops', def_forced_punts: 'Punts forced by defense',
        pts_allow: 'Points allowed', yds_allow: 'Yards allowed',
        fgmiss: 'Field goals missed', fgm_pct: 'Field goal percentage', fgm_lng: 'Longest field goal made', fgm_yds: 'Total yards of made field goals', fgm_yds_over_30: 'Made field goal yards beyond 30',
        xpmiss: 'Extra points missed', fg_blkd: 'Field goals blocked', xp_blkd: 'Extra points blocked', fg_ret_yd: 'Field goal return yards', kick_pts: 'Kicking points',
        punts: 'Punts', punt_yds: 'Punt yards', punt_net_yd: 'Net punting yards', punt_in_20: 'Punts inside the 20', punt_tb: 'Punt touchbacks', punt_blkd: 'Punts blocked',
        kr: 'Kick returns', pr: 'Punt returns', kr_lng: 'Longest kick return', pr_lng: 'Longest punt return', kr_ypa: 'Yards per kick return', pr_ypa: 'Yards per punt return',
        misc_ret_yd: 'Other return yards', misc_td: 'Other touchdowns', penalty: 'Penalties', penalty_yd: 'Penalty yards',
        pts_ppr: 'Provider fantasy points · full PPR', pts_half_ppr: 'Provider fantasy points · half PPR', pts_std: 'Provider fantasy points · standard scoring', pts_idp: 'Provider individual-defense fantasy points'
    };
    function rawLabel(key) {
        if (knownLabels[key]) return knownLabels[key];
        if (key.startsWith('idp_') && knownLabels[key.slice(4)]) return 'Individual defense: ' + knownLabels[key.slice(4)].toLowerCase();
        let match = /^(fgm|fgmiss)_(\d+)(?:_(\d+)|(p))$/.exec(key);
        if (match) return 'Field goals ' + (match[1] === 'fgm' ? 'made' : 'missed') + ' from ' + match[2] + (match[4] ? '+' : '–' + match[3]) + ' yards';
        match = /^(pts_allow|yds_allow)_(\d+)(?:_(\d+)|(p))?$/.exec(key);
        if (match) return 'Games allowing ' + match[2] + (match[4] ? '+' : match[3] ? '–' + match[3] : '') + (match[1] === 'pts_allow' ? ' points' : ' yards');
        match = /^(def_st|st)_(ff|fum_rec|td|tkl_solo)$/.exec(key);
        if (match) return (match[1] === 'def_st' ? 'Team special teams: ' : 'Player special teams: ') + ({ ff: 'forced fumbles', fum_rec: 'fumble recoveries', td: 'touchdowns', tkl_solo: 'solo tackles' })[match[2]];
        if (key.startsWith('def_') && /^(kr|pr)(_|$)/.test(key.slice(4)) && knownLabels[key.slice(4)]) return 'Team ' + knownLabels[key.slice(4)].toLowerCase();
        match = /^bonus_(pass|rush|rec|rush_rec)_yd_(\d+)$/.exec(key);
        if (match) return match[2] + '-yard ' + ({ pass: 'passing', rush: 'rushing', rec: 'receiving', rush_rec: 'rushing + receiving' })[match[1]] + ' bonuses';
        match = /^bonus_(rec|fd)_(qb|rb|wr|te)$/.exec(key);
        if (match) return ({ qb: 'Quarterback', rb: 'Running back', wr: 'Wide receiver', te: 'Tight end' })[match[2]] + (match[1] === 'rec' ? ' reception' : ' first-down') + ' bonus count';
        const bonuses = { bonus_pass_cmp_25: '25-completion passing bonuses', bonus_rush_att_20: '20-carry rushing bonuses', bonus_sack_2p: 'Two-or-more-sack bonuses', bonus_tkl_10p: 'Ten-or-more-tackle bonuses', bonus_def_fum_td_50p: '50+ yard fumble return touchdown bonuses', bonus_def_int_td_50p: '50+ yard interception return touchdown bonuses', idp_pass_def_3p: 'Individual defense: three-or-more passes defended' };
        if (bonuses[key]) return bonuses[key];
        match = /^(pass_td|rush_td|rec_td|pass_cmp|rush)_(\d+)p$/.exec(key);
        if (match) return ({ pass_td: 'Passing touchdowns', rush_td: 'Rushing touchdowns', rec_td: 'Receiving touchdowns', pass_cmp: 'Completions', rush: 'Rushes' })[match[1]] + ' of ' + match[2] + '+ yards';
        match = /^rec_(\d+)(?:_(\d+)|(p))$/.exec(key);
        if (match) return 'Receptions of ' + match[1] + (match[3] ? '+' : '–' + match[2]) + ' yards';
        match = /^(pos_rank|rank)_(half_ppr|ppr|std)$/.exec(key);
        if (match) return (match[1] === 'pos_rank' ? 'Position rank' : 'Overall rank') + ' · ' + ({ half_ppr: 'half PPR', ppr: 'full PPR', std: 'standard scoring' })[match[2]];
        // Unrecognized provider definitions retain the key instead of guessing.
        return key.replace(/_/g, ' ');
    }
    function rawGroup(key) {
        if (key === 'fum_rec_td') return 'offense';
        if (/^(kr|pr|kick_ret|punt_ret|ret)_/.test(key)) return 'returns';
        if (/^(pass|cmp)_/.test(key)) return 'passing';
        if (/^rush_/.test(key)) return 'rushing';
        if (/^rec(?:_|$)/.test(key)) return 'receiving';
        if (/^(fg|xp|punt|kick_pts)/.test(key)) return 'kicking';
        if (/^(idp_|def_|tkl_|sack|qb_hit|pass_def|int(?:_|$)|ff$|fum_rec|pts_allow|yds_allow|safe|blk_kick|def_st)/.test(key)) return 'defense';
        if (/^(off_|tm_off_|fum|st_)/.test(key)) return 'offense';
        return 'general';
    }
    function rawRate(key) { return /(?:^|_)(pct|percent|rate|ypa|ypc|ypr|avg|long|lng|lg|rank|rnk|rating)(?:_|$)/.test(key); }
    const catalogGroups = {
        passAtt: 'passing', passCmp: 'passing', passYd: 'passing', passTd: 'passing', ints: 'passing', cmpPct: 'passing', ypa: 'passing', rzPassAtt: 'passing',
        rushAtt: 'rushing', rushYd: 'rushing', rushTd: 'rushing', ypc: 'rushing',
        targets: 'receiving', receptions: 'receiving', recYd: 'receiving', recTd: 'receiving', ypr: 'receiving', catchRate: 'receiving', yac: 'receiving', drops: 'receiving', rzTargets: 'receiving'
    };
    const ratioParts = { cmpPct: ['pass_cmp', 'pass_att'], ypa: ['pass_yd', 'pass_att'], ypc: ['rush_yd', 'rush_att'], ypr: ['rec_yd', 'rec'], catchRate: ['rec', 'rec_tgt'], fgPct: ['fgm', 'fga'], snapPct: ['off_snp', 'tm_off_snp'], defSnapPct: ['def_snp', 'tm_def_snp'] };
    function metrics(statsByPid) {
        const out = [
            { key: 'fantasyPoints', label: 'League fantasy points', short: 'FPTS', group: 'general', format: 'dec2', rate: false, source: 'league' },
            { key: 'gp', label: 'Games played', short: 'GP', group: 'general', format: 'int', rate: true, source: 'provider' }
        ];
        (App.StatCatalog?.STAT_CATALOG || []).forEach(stat => out.push({
            key: 'catalog:' + stat.key, label: stat.label, short: stat.short,
            group: catalogGroups[stat.key] || (stat.group === 'idp' || stat.key === 'defSnapPct' ? 'defense' : stat.group === 'kicking' ? 'kicking' : 'offense'),
            format: stat.format, rate: stat.format === 'pct' || Object.hasOwn(ratioParts, stat.key), source: 'catalog'
        }));
        // Keep preset columns stable before a stat has its first reported value.
        const keys = new Set(Object.values(PRESETS).flat().filter(key => key.startsWith('raw:')).map(key => key.slice(4)));
        Object.entries(statsByPid || {}).forEach(([pid, raw]) => {
            if (pid.startsWith('TEAM_') || !raw || typeof raw !== 'object') return;
            Object.entries(raw).forEach(([key, val]) => { if (finite(val) !== null && key !== 'gp' && !metadataKeys.has(key)) keys.add(key); });
        });
        Array.from(keys).sort().forEach(key => out.push({
            key: 'raw:' + key, label: rawLabel(key) + (rawRate(key) ? ' (provider raw)' : ''), short: key.toUpperCase(),
            group: rawGroup(key), format: 'number', rate: rawRate(key), source: 'provider', providerKey: key
        }));
        return out;
    }
    function filterMetrics(list, opts) {
        const query = String(opts?.query || '').trim().toLowerCase();
        return (list || []).filter(m => (!opts?.group || opts.group === 'all' || m.group === opts.group) && (!query || (m.label + ' ' + m.key + ' ' + m.short).toLowerCase().includes(query)));
    }
    function normalizePosition(pos) {
        const key = String(pos || '').toUpperCase();
        return ({ DT: 'DL', DE: 'DL', NT: 'DL', EDGE: 'DL', ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DST: 'DEF', 'D/ST': 'DEF' })[key] || key;
    }
    function cleanRaw(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        return Object.fromEntries(Object.entries(raw).filter(([, v]) => finite(v) !== null));
    }
    function score(raw, scoring, position) {
        if (!raw || !Object.keys(raw).length || !scoring || typeof scoring !== 'object') return null;
        position = normalizePosition(position);
        const rules = Object.entries(scoring).filter(([, weight]) => finite(weight) !== null);
        if (!rules.length) return null;
        let total = 0;
        rules.forEach(([key, weight]) => {
            const individualDefense = ['DL', 'LB', 'DB'].includes(normalizePosition(position));
            const teamDefenseRule = /^(sack(?:_|$)|int(?:_|$)|ff$|fum_rec$|def_td$|def_st_|safe$|blk_kick$|pass_def$|tkl_|qb_hit$|pts_allow|yds_allow)/.test(key);
            // Sleeper leagues can score D/ST and IDP simultaneously. Matching
            // unprefixed stat aliases must not apply both scoring namespaces.
            if (key.startsWith('idp_') && !individualDefense) return;
            if (teamDefenseRule && normalizePosition(position) !== 'DEF') return;
            // Provider bonus counters preserve the number of qualifying games
            // across a season. Never derive threshold bonuses from season totals.
            let amount = finite(raw[key]);
            if (amount === null && key.startsWith('idp_')) amount = finite(raw[key.slice(4)]);
            const receptionBonus = /^bonus_rec_(te|wr|rb|qb)$/.exec(key);
            if (receptionBonus && position !== receptionBonus[1].toUpperCase()) return;
            if (amount === null && receptionBonus && position === receptionBonus[1].toUpperCase()) amount = finite(raw.rec);
            if (amount !== null) total += amount * weight;
        });
        return Math.round(total * 1000000) / 1000000;
    }
    function buildRows(opts) {
        const { statsByPid = {}, playersData = {}, league = {} } = opts || {};
        const ownership = new Map();
        (league.rosters || []).forEach(roster => {
            const owner = (league.users || []).find(u => String(u.user_id) === String(roster.owner_id));
            const name = owner?.metadata?.team_name || owner?.display_name || owner?.username || 'Team ' + roster.roster_id;
            (roster.players || []).forEach(pid => {
                const id = String(pid);
                if (!ownership.has(id)) ownership.set(id, []);
                ownership.get(id).push({ id: String(roster.roster_id), name });
            });
        });
        // Keep every reported player, active player and rostered player, including
        // players with no reported line. TEAM_* duplicates are NFL aggregates.
        const ids = new Set([...Object.keys(statsByPid), ...ownership.keys(), ...Object.keys(playersData).filter(pid => playersData[pid]?.active !== false && playersData[pid]?.team)]);
        return Array.from(ids).filter(pid => !pid.startsWith('TEAM_')).map(pid => {
            const p = playersData[pid] || {}, raw = cleanRaw(statsByPid[pid]);
            const owners = ownership.get(pid) || [];
            const position = normalizePosition(p.position || (/^[A-Z]{2,3}$/.test(pid) ? 'DEF' : ''));
            const fantasyPoints = score(raw, league.scoring_settings, position);
            return {
                pid, name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || pid,
                position, team: p.team || (position === 'DEF' ? pid : ''),
                rostered: owners.length > 0, ownerIds: owners.map(o => o.id), rosterIds: owners.map(o => o.id), ownerNames: owners.map(o => o.name),
                raw, fantasyPoints, points: fantasyPoints, gp: finite(raw?.gp)
            };
        });
    }
    function catalogValue(key, raw) {
        if (!raw) return null;
        // Season endpoints may sum weekly rate fields. Derive known rates from
        // total numerators and denominators; never average/sum those raw rates.
        const parts = ratioParts[key];
        if (parts) {
            const numerator = finite(raw[parts[0]]), denominator = finite(raw[parts[1]]);
            return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;
        }
        // The legacy catalog treats all-zero totals as absent in two metrics.
        if (key === 'rzTouches' || key === 'tackles') {
            const values = key === 'rzTouches' ? [raw.rush_rz_att, raw.rec_rz_tgt] : [raw.idp_tkl_solo ?? raw.tkl_solo, raw.idp_tkl_ast ?? raw.tkl_ast];
            const known = values.map(finite).filter(v => v !== null);
            return known.length ? known.reduce((sum, v) => sum + v, 0) : null;
        }
        const stat = App.StatCatalog?.STAT_CATALOG?.find(s => s.key === key);
        try { return stat ? finite(stat.get(raw)) : null; } catch (_) { return null; }
    }
    function value(row, metric, opts) {
        const key = typeof metric === 'string' ? metric : metric?.key;
        let result = null, rate = false;
        if (key === 'fantasyPoints' || key === 'points') result = finite(row?.fantasyPoints);
        else if (key === 'gp') { result = finite(row?.gp); rate = true; }
        else if (key?.startsWith('raw:')) { const rawKey = key.slice(4); result = finite(row?.raw?.[rawKey]); rate = rawRate(rawKey); }
        else if (key?.startsWith('catalog:')) {
            const catalogKey = key.slice(8);
            result = catalogValue(catalogKey, row?.raw);
            rate = Object.hasOwn(ratioParts, catalogKey) || App.StatCatalog?.STAT_CATALOG?.find(s => s.key === catalogKey)?.format === 'pct';
        }
        if (result === null) return null;
        if (opts?.perGame && !rate) return finite(row?.gp) !== null && row.gp > 0 ? result / row.gp : null;
        return result;
    }
    function format(val, metric, opts) {
        if (finite(val) === null) return '—';
        const style = typeof metric === 'string' ? metric : metric?.format;
        if (style === 'pct') return (val * 100).toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';
        const digits = style === 'dec2' ? 2 : style === 'dec1' || (opts?.perGame && !metric?.rate) ? 1 : 2;
        return val.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: style === 'dec2' ? 2 : 0 });
    }
    function createClient(options) {
        const env = options || {}, cache = new Map(), inflight = new Map();
        const now = env.now || Date.now, fetcher = env.fetch || ((...args) => root.fetch(...args));
        async function load(opts) {
            const season = String(opts?.season || '');
            const week = opts?.week == null ? null : Number(opts.week);
            if (!/^\d{4}$/.test(season) || Number(season) < 2000 || (week !== null && (!Number.isInteger(week) || week < 1 || week > 18))) throw new Error('Choose a valid NFL season and regular-season week.');
            const key = season + '|' + (week || 'season'), hit = cache.get(key);
            if (inflight.has(key)) return inflight.get(key);
            if (!opts?.force && hit && now() - hit.updatedAt < 60000) return hit;
            const controller = root.AbortController ? new root.AbortController() : null;
            let timer;
            const request = (async () => {
                try {
                    const data = await Promise.race([
                        Promise.resolve().then(() => fetcher('https://api.sleeper.app/v1/stats/nfl/regular/' + season + (week === null ? '' : '/' + week), { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) })).then(response => {
                            if (!response.ok) throw new Error('NFL stats could not load (provider ' + response.status + '). Please refresh.');
                            return response.json();
                        }),
                        new Promise((_, reject) => { timer = root.setTimeout(() => { controller?.abort(); reject(new Error('Stats request timed out. Please refresh.')); }, 15000); })
                    ]);
                    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(raw => !raw || typeof raw !== 'object' || Array.isArray(raw))) throw new Error('The stats provider returned an invalid response. Please refresh.');
                    const result = { season, week, statsByPid: data, updatedAt: now() };
                    cache.set(key, result);
                    if (cache.size > 40) cache.delete(cache.keys().next().value);
                    return result;
                } catch (e) { throw new Error(e?.name === 'AbortError' ? 'Stats request timed out. Please refresh.' : e?.message || 'NFL stats are unavailable. Please refresh.'); }
                finally { root.clearTimeout(timer); inflight.delete(key); }
            })();
            inflight.set(key, request);
            return request;
        }
        async function loadGameLog(opts) {
            const weeks = Array.from(new Set((opts?.weeks || Array.from({ length: 18 }, (_, i) => i + 1)).map(Number))).sort((a, b) => a - b);
            const results = new Array(weeks.length); let next = 0;
            await Promise.all(Array.from({ length: Math.min(3, weeks.length) }, async () => {
                while (next < weeks.length) {
                    const index = next++, week = weeks[index];
                    try { const result = await load({ season: opts.season, week, force: opts.force }); results[index] = { week, raw: cleanRaw(result.statsByPid[String(opts.pid)]), updatedAt: result.updatedAt, error: null }; }
                    catch (e) { results[index] = { week, raw: null, updatedAt: null, error: e.message }; }
                }
            }));
            return results;
        }
        return { load, loadGameLog };
    }
    const client = createClient();
    // Guarded like App.StatCatalog: a second copy of this file (another surface
    // loading it) must not swap the client and drop its cache mid-session.
    App.LeagueStats = App.LeagueStats || { GROUPS, PRESETS, metrics, filterMetrics, buildRows, value, format, score, normalizePosition, createClient, load: client.load, loadGameLog: client.loadGameLog };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.LeagueStats;
})(typeof window !== 'undefined' ? window : globalThis);
