// ══════════════════════════════════════════════════════════════════
// js/shared/stat-catalog.js — window.App.StatCatalog
//
// One shared registry of "beyond fantasy points" stats — targets, red zone
// looks, snap share, air yards, YAC, completion %, and the rest of the raw
// Sleeper stat line every surface already fetches (App.SOS.getWeekStats for
// a single week, or the season-aggregate `statsData[pid]` object built at
// league load — same field vocabulary either way; Sleeper sums the season
// totals server-side under the same keys). None of this required a new
// fetch: the raw stat objects already carry these fields, they just were
// never read past pass_yd/rush_yd/rec/rec_yd/the *_td trio.
//
// Before this module, five surfaces each hand-rolled their own column list
// (FA_COLUMNS, ROSTER_COLUMNS, ALL_PLAYERS_COLUMNS, league-map's report
// columns, player-modal's career table) with no shared vocabulary. This is
// the first one meant to be reused, not copied.
//
//   STAT_CATALOG                      — full list, see shape below
//   getStatsForPosition(pos)          — catalog rows relevant to one normPos
//   computeStat(key, raw, opts)       — read + derive one stat ({perGame:true} divides by raw.gp)
//   formatStat(value, format)         — consistent display string ('—' for null/undefined)
//   buildTeamTargetTotals(playersData, statsByPid) — { TEAM: totalTargets } for target share
//   targetShare(raw, team, teamTotals)  — this player's % of their team's targets
//
// Catalog row shape: { key, label, short, group, positions, format, perGameDefault, get(raw) }
//   group: 'volume' | 'efficiency' | 'redzone' | 'snaps' | 'scoring' | 'kicking' | 'idp'
//   positions: normPos values this stat applies to ('QB','RB','WR','TE','K','DL','LB','DB')
//   format: 'int' | 'dec1' | 'pct' | 'yards'
//   get(raw): raw Sleeper stat line (weekly OR season-aggregate) -> number | null
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // Sleeper is inconsistent about idp_-prefixed vs unprefixed field names
    // depending on endpoint/season — try both, first present wins.
    function pick(raw, ...keys) {
        for (const k of keys) {
            const v = raw && raw[k];
            if (v != null) return Number(v) || 0;
        }
        return null;
    }
    function ratio(num, den) {
        if (num == null || den == null || !den) return null;
        return num / den;
    }

    const WR_TE = ['WR', 'TE'];
    const IDP = ['DL', 'LB', 'DB'];

    const STAT_CATALOG = [
        // ── Volume ──
        { key: 'passAtt', label: 'Pass Attempts', short: 'ATT', group: 'volume', positions: ['QB'], format: 'int', get: r => pick(r, 'pass_att') },
        { key: 'passCmp', label: 'Completions', short: 'CMP', group: 'volume', positions: ['QB'], format: 'int', get: r => pick(r, 'pass_cmp') },
        { key: 'rushAtt', label: 'Rush Attempts', short: 'ATT', group: 'volume', positions: ['QB', 'RB'], format: 'int', get: r => pick(r, 'rush_att') },
        { key: 'targets', label: 'Targets', short: 'TGT', group: 'volume', positions: ['RB', ...WR_TE], format: 'int', get: r => pick(r, 'rec_tgt') },
        { key: 'receptions', label: 'Receptions', short: 'REC', group: 'volume', positions: ['RB', ...WR_TE], format: 'int', get: r => pick(r, 'rec') },

        // ── Yardage / scoring ──
        { key: 'passYd', label: 'Passing Yards', short: 'YDS', group: 'volume', positions: ['QB'], format: 'int', get: r => pick(r, 'pass_yd') },
        { key: 'rushYd', label: 'Rushing Yards', short: 'YDS', group: 'volume', positions: ['QB', 'RB'], format: 'int', get: r => pick(r, 'rush_yd') },
        { key: 'recYd', label: 'Receiving Yards', short: 'YDS', group: 'volume', positions: ['RB', ...WR_TE], format: 'int', get: r => pick(r, 'rec_yd') },
        { key: 'passTd', label: 'Passing TDs', short: 'TD', group: 'scoring', positions: ['QB'], format: 'int', get: r => pick(r, 'pass_td') },
        { key: 'rushTd', label: 'Rushing TDs', short: 'TD', group: 'scoring', positions: ['QB', 'RB'], format: 'int', get: r => pick(r, 'rush_td') },
        { key: 'recTd', label: 'Receiving TDs', short: 'TD', group: 'scoring', positions: [...WR_TE, 'RB'], format: 'int', get: r => pick(r, 'rec_td') },
        { key: 'ints', label: 'Interceptions Thrown', short: 'INT', group: 'scoring', positions: ['QB'], format: 'int', get: r => pick(r, 'pass_int') },
        { key: 'fumLost', label: 'Fumbles Lost', short: 'FUM', group: 'scoring', positions: ['QB', 'RB', ...WR_TE], format: 'int', get: r => pick(r, 'fum_lost') },

        // ── Efficiency (derived ratios — safe on both weekly and season-aggregate lines) ──
        { key: 'cmpPct', label: 'Completion %', short: 'CMP%', group: 'efficiency', positions: ['QB'], format: 'pct', get: r => { const v = pick(r, 'cmp_pct'); return v != null ? v / 100 : ratio(pick(r, 'pass_cmp'), pick(r, 'pass_att')); } },
        { key: 'ypa', label: 'Yards / Attempt', short: 'YPA', group: 'efficiency', positions: ['QB'], format: 'dec1', get: r => { const v = pick(r, 'pass_ypa'); return v != null ? v : ratio(pick(r, 'pass_yd'), pick(r, 'pass_att')); } },
        { key: 'ypc', label: 'Yards / Carry', short: 'YPC', group: 'efficiency', positions: ['QB', 'RB'], format: 'dec1', get: r => { const v = pick(r, 'rush_ypa'); return v != null ? v : ratio(pick(r, 'rush_yd'), pick(r, 'rush_att')); } },
        { key: 'ypr', label: 'Yards / Reception', short: 'YPR', group: 'efficiency', positions: ['RB', ...WR_TE], format: 'dec1', get: r => { const v = pick(r, 'rec_ypr'); return v != null ? v : ratio(pick(r, 'rec_yd'), pick(r, 'rec')); } },
        { key: 'catchRate', label: 'Catch Rate', short: 'CATCH%', group: 'efficiency', positions: ['RB', ...WR_TE], format: 'pct', get: r => ratio(pick(r, 'rec'), pick(r, 'rec_tgt')) },
        { key: 'airYd', label: 'Air Yards', short: 'AIR', group: 'efficiency', positions: [...WR_TE, 'QB'], format: 'int', get: r => pick(r, 'pass_air_yd', 'rec_air_yd') },
        { key: 'yac', label: 'Yards After Catch', short: 'YAC', group: 'efficiency', positions: ['RB', ...WR_TE], format: 'int', get: r => pick(r, 'rec_yar') },
        { key: 'drops', label: 'Drops', short: 'DROP', group: 'efficiency', positions: ['RB', ...WR_TE], format: 'int', get: r => pick(r, 'rec_drop') },

        // ── Red zone ──
        { key: 'rzTouches', label: 'Red Zone Touches', short: 'RZ', group: 'redzone', positions: ['RB'], format: 'int', get: r => { const a = pick(r, 'rush_rz_att') || 0, b = pick(r, 'rec_rz_tgt') || 0; return a || b ? a + b : null; } },
        { key: 'rzTargets', label: 'Red Zone Targets', short: 'RZ TGT', group: 'redzone', positions: [...WR_TE], format: 'int', get: r => pick(r, 'rec_rz_tgt') },
        { key: 'rzPassAtt', label: 'Red Zone Pass Attempts', short: 'RZ ATT', group: 'redzone', positions: ['QB'], format: 'int', get: r => pick(r, 'pass_rz_att') },

        // ── Snaps (share needs the team total on the same line — Sleeper carries both) ──
        { key: 'snaps', label: 'Offensive Snaps', short: 'SNP', group: 'snaps', positions: ['QB', 'RB', ...WR_TE], format: 'int', get: r => pick(r, 'off_snp') },
        { key: 'snapPct', label: 'Snap Share', short: 'SNP%', group: 'snaps', positions: ['QB', 'RB', ...WR_TE], format: 'pct', get: r => ratio(pick(r, 'off_snp'), pick(r, 'tm_off_snp')) },
        { key: 'defSnapPct', label: 'Defensive Snap Share', short: 'SNP%', group: 'snaps', positions: IDP, format: 'pct', get: r => ratio(pick(r, 'def_snp'), pick(r, 'tm_def_snp')) },

        // ── Kicking ──
        { key: 'fgm', label: 'Field Goals Made', short: 'FGM', group: 'kicking', positions: ['K'], format: 'int', get: r => pick(r, 'fgm') },
        { key: 'fga', label: 'Field Goals Attempted', short: 'FGA', group: 'kicking', positions: ['K'], format: 'int', get: r => pick(r, 'fga') },
        // Sleeper's fgm_pct on a season-aggregate line is the SUM of each
        // week's percentage (confirmed: a 12-game kicker showed fgm_pct=700
        // — an average around 58%/wk summed across games, not a season rate)
        // — unusable outside a true single-week stat line. Always derive the
        // ratio from the season-total makes/attempts instead, which sums
        // correctly in both weekly and season-aggregate contexts.
        { key: 'fgPct', label: 'Field Goal %', short: 'FG%', group: 'kicking', positions: ['K'], format: 'pct', get: r => ratio(pick(r, 'fgm'), pick(r, 'fga')) },
        { key: 'fg50', label: 'FG Made 50+', short: 'FG50+', group: 'kicking', positions: ['K'], format: 'int', get: r => pick(r, 'fgm_50p') },
        { key: 'xpm', label: 'Extra Points Made', short: 'XPM', group: 'kicking', positions: ['K'], format: 'int', get: r => pick(r, 'xpm') },

        // ── IDP ──
        { key: 'tackles', label: 'Total Tackles', short: 'TKL', group: 'idp', positions: IDP, format: 'int', get: r => { const s = pick(r, 'idp_tkl_solo', 'tkl_solo') || 0, a = pick(r, 'idp_tkl_ast', 'tkl_ast') || 0; return s || a ? s + a : null; } },
        { key: 'soloTkl', label: 'Solo Tackles', short: 'SOLO', group: 'idp', positions: IDP, format: 'int', get: r => pick(r, 'idp_tkl_solo', 'tkl_solo') },
        { key: 'tfl', label: 'Tackles for Loss', short: 'TFL', group: 'idp', positions: IDP, format: 'int', get: r => pick(r, 'idp_tkl_loss', 'tkl_loss') },
        { key: 'sacks', label: 'Sacks', short: 'SACK', group: 'idp', positions: IDP, format: 'dec1', get: r => pick(r, 'idp_sack', 'sack') },
        { key: 'qbHits', label: 'QB Hits', short: 'QBH', group: 'idp', positions: IDP, format: 'int', get: r => pick(r, 'idp_qb_hit', 'qb_hit') },
        { key: 'idpInts', label: 'Interceptions', short: 'INT', group: 'idp', positions: IDP, format: 'int', get: r => pick(r, 'idp_int', 'int') },
        { key: 'passDef', label: 'Passes Defended', short: 'PD', group: 'idp', positions: IDP, format: 'int', get: r => pick(r, 'idp_pass_def', 'pass_def') },
        { key: 'forcedFum', label: 'Forced Fumbles', short: 'FF', group: 'idp', positions: IDP, format: 'int', get: r => pick(r, 'idp_ff', 'ff') },
        { key: 'fumRec', label: 'Fumble Recoveries', short: 'FR', group: 'idp', positions: IDP, format: 'int', get: r => pick(r, 'idp_fum_rec', 'fum_rec') },
    ];

    function getStatsForPosition(pos) {
        const p = String(pos || '').toUpperCase();
        return STAT_CATALOG.filter(s => s.positions.includes(p));
    }
    function statByKey(key) { return STAT_CATALOG.find(s => s.key === key) || null; }

    // Curated "signature" stats per position — the 2-3 numbers that actually
    // drive a start/sit, waiver, or trade call at that position, as opposed to
    // STAT_CATALOG's full field list (meant for exhaustive views like Custom
    // Reports or the career table). Ordered by decision relevance.
    const SIGNATURE_STATS = {
        QB: ['cmpPct', 'ypa', 'rushAtt'],
        RB: ['targets', 'rzTouches', 'ypc'],
        WR: ['targets', 'snapPct', 'rzTargets'],
        TE: ['targets', 'snapPct', 'rzTargets'],
        K: ['fgPct', 'fg50'],
        DL: ['tackles', 'sacks', 'qbHits'],
        LB: ['tackles', 'tfl', 'sacks'],
        DB: ['tackles', 'passDef', 'idpInts'],
    };
    function getSignatureStats(pos) {
        const keys = SIGNATURE_STATS[String(pos || '').toUpperCase()] || [];
        return keys.map(statByKey).filter(Boolean);
    }
    // The single highest-leverage stat for a position — for tight layouts
    // (Big Board, Trade Center) that only have room for one inline value.
    function getTopStat(pos) { return getSignatureStats(pos)[0] || null; }

    function computeStat(key, raw, opts) {
        const stat = statByKey(key);
        if (!stat || !raw) return null;
        let v = stat.get(raw);
        if (v == null) return null;
        if (opts && opts.perGame && stat.format !== 'pct') {
            const gp = Number(raw.gp) || 0;
            v = gp > 0 ? v / gp : null;
        }
        return v;
    }
    function formatStat(value, format) {
        if (value == null || Number.isNaN(value)) return '—';
        switch (format) {
            case 'pct': return Math.round(value * 100) + '%';
            case 'dec1': return value.toFixed(1);
            case 'int':
            default: return Math.round(value).toLocaleString();
        }
    }

    // Team target totals for the week/season a `statsByPid` map covers —
    // sum rec_tgt across every player rostered to that NFL team so a single
    // player's share (targetShare below) has a denominator. `playersData`
    // supplies each pid's team; `statsByPid` is either a single week's
    // { pid: rawStatLine } (App.SOS.getWeekStats) or the season-aggregate
    // statsData map already resident on every league-detail load — same
    // shape either way.
    function buildTeamTargetTotals(playersData, statsByPid) {
        const totals = {};
        if (!playersData || !statsByPid) return totals;
        Object.keys(statsByPid).forEach(pid => {
            const team = playersData[pid] && playersData[pid].team;
            if (!team) return;
            const tgt = pick(statsByPid[pid], 'rec_tgt') || 0;
            totals[team] = (totals[team] || 0) + tgt;
        });
        return totals;
    }
    function targetShare(raw, team, teamTotals) {
        const tgt = pick(raw, 'rec_tgt');
        const total = team && teamTotals ? teamTotals[team] : null;
        return ratio(tgt, total);
    }

    // ── Historical season cache — one shared fetch/cache for every surface
    // that wants multi-year trend data (Custom Reports, League Central,
    // player card). Reads window.fetchSeasonStats (IndexedDB-backed after
    // the first load, dhq-shared/sleeper-api.js) — same endpoint the player
    // card's career table uses — but caches the whole-league blob here once
    // so two surfaces asking for the same year share one fetch.
    const _histCache = {};   // year(string) -> {pid: rawStatLine} | 'loading'
    function ensureHistSeason(year) {
        const yr = String(year);
        if (_histCache[yr] || typeof root.fetchSeasonStats !== 'function') return;
        _histCache[yr] = 'loading';
        root.fetchSeasonStats(yr).then(data => {
            _histCache[yr] = data || {};
            try { root.dispatchEvent(new CustomEvent('wr:hist-season-loaded', { detail: { year: yr } })); } catch (e) { /* no-op outside a real window */ }
        }).catch(() => { _histCache[yr] = {}; });
    }
    function historicalSeason(year) {
        const d = _histCache[String(year)];
        return (d && d !== 'loading') ? d : null;
    }
    // points: [{yr, v}] ascending, already filtered to non-null. format 'pct'
    // values are 0..1 ratios (this module's convention) — delta reads in
    // points; everything else reads as a % change off the first value.
    function trendCalc(points, format) {
        if (!points || points.length < 2) return { text: null, delta: null };
        const first = points[0].v, last = points[points.length - 1].v;
        const show = v => format === 'pct' ? Math.round(v * 100) + '%' : (Number.isInteger(v) ? String(v) : v.toFixed(1));
        const text = points.map(p => "'" + String(p.yr).slice(-2) + ':' + show(p.v)).join(' → ');
        const delta = format === 'pct' ? Math.round((last - first) * 100) : (first !== 0 ? Math.round(((last - first) / Math.abs(first)) * 100) : null);
        return { text, delta };
    }
    // Convenience: this player's per-game value for `statKey` in each of
    // [year-2, year-1, currentSeasonRaw], skipping years with no data —
    // the exact 3-point series every trend/delta consumer wants.
    function historicalSeries(pid, statKey, currentSeasonRaw, season) {
        const y2 = historicalSeason(season - 2), y1 = historicalSeason(season - 1);
        ensureHistSeason(season - 2); ensureHistSeason(season - 1);
        const raws = [[season - 2, y2 && y2[pid]], [season - 1, y1 && y1[pid]], [season, currentSeasonRaw]];
        return raws.map(([yr, raw]) => ({ yr, v: raw ? computeStat(statKey, raw, { perGame: true }) : null })).filter(p => p.v != null);
    }

    App.StatCatalog = App.StatCatalog || {
        STAT_CATALOG, getStatsForPosition, statByKey, computeStat, formatStat,
        buildTeamTargetTotals, targetShare, getSignatureStats, getTopStat,
        ensureHistSeason, historicalSeason, trendCalc, historicalSeries,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.StatCatalog;
})(typeof window !== 'undefined' ? window : globalThis);
