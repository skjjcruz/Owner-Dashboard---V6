// Market Explorer display helpers. Missing observations remain distinct from
// zero, and season efficiency rates are derived before any per-game display.
// Ported from C2 (WarRoom-sandbox js/shared/fa-market-data.js). Pure — reads
// the season stat line it is handed; needs App.StatCatalog + App.LeagueStats
// loaded first (no network of its own).
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    let metricSource = null, catalogSource = null, metricByKey = new Map();
    function catalogMetric(key) {
        const engine = App.LeagueStats, catalog = App.StatCatalog;
        if (engine !== metricSource || catalog !== catalogSource) {
            metricSource = engine; catalogSource = catalog;
            metricByKey = new Map((engine?.metrics({}) || []).map(metric => [metric.key, metric]));
        }
        return metricByKey.get('catalog:' + key);
    }
    function signature(position, index, raw) {
        const engine = App.LeagueStats;
        const pos = engine?.normalizePosition(position) || position;
        const stat = App.StatCatalog?.getSignatureStats(pos)?.[index];
        if (!stat) return null;
        const metric = catalogMetric(stat.key);
        const rate = !!metric?.rate;
        const label = stat.label + (rate ? '' : ' per game');
        const short = stat.short + (rate ? '' : '/G');
        const clean = raw && typeof raw === 'object' && !Array.isArray(raw)
            ? Object.fromEntries(Object.entries(raw).filter(([, value]) => finite(value))) : null;
        const value = engine?.value({ raw: clean, gp: clean?.gp ?? null }, 'catalog:' + stat.key, { perGame: true });
        const numeric = finite(value) ? value : null;
        const text = numeric === null ? '—' : stat.format === 'pct' ? (numeric * 100).toFixed(1) + '%' : numeric.toFixed(1);
        return { key: stat.key, value: numeric, text, label, short, rate };
    }
    function ppg(raw, scoring, position) {
        if (!raw || !finite(raw.gp) || raw.gp <= 0 || !App.LeagueStats?.score) return null;
        const points = App.LeagueStats.score(raw, scoring, App.LeagueStats.normalizePosition(position));
        return finite(points) ? Math.round((points / raw.gp) * 10) / 10 : null;
    }
    function recentPpg(history, week, count) {
        const rows = (Array.isArray(history) ? history : [])
            .filter(row => finite(row?.pts) && finite(row.week) && row.week > 0 && row.week < week)
            .sort((a, b) => b.week - a.week).slice(0, count);
        if (!rows.length) return null;
        return { value: Math.round(rows.reduce((sum, row) => sum + row.pts, 0) / rows.length * 10) / 10, count: rows.length };
    }
    App.FAMarketData = App.FAMarketData || { signature, ppg, recentPpg };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.FAMarketData;
})(typeof window !== 'undefined' ? window : globalThis);
