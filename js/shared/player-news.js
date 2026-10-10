// ══════════════════════════════════════════════════════════════════
// js/shared/player-news.js — window.App.PlayerNews (Lab)
//
// Owner ask 2026-10-09: NFL news moves players, so sync the news with the
// player. The engine build links every story to the players it touches
// (server/engine/news.js in the app repo) and the dhq-news function hands
// those links out: public NFL news only, no league or member data.
//
//   get(pids) → Promise<{ pid: [ { kind, link, why, headline, summary,
//               url, source, published_at } ] }>   (cached 10 min per player)
//   label(item) → "Oct 9 · Coaching · via DEN play-calling"
//
// Never rejects: no news (or the endpoint down) is an empty list.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const URL_BASE = 'https://hovnqztlbsgsywrbidbh.supabase.co/functions/v1/dhq-news';
    const TTL = 10 * 60 * 1000;
    const cache = {};   // pid → { at, items }
    const KIND = { coaching: 'Coaching', qb: 'QB situation', injury: 'Injury', return: 'Return', practice: 'Practice', role: 'Role', transaction: 'Move', suspension: 'Suspension', news: 'News' };

    async function fetchBatch(ids) {
        try {
            const r = await fetch(URL_BASE + '?days=14&players=' + ids.map(encodeURIComponent).join(','));
            if (!r.ok) return {};
            const j = await r.json();
            return (j && j.players) || {};
        } catch (e) { return {}; }
    }
    async function get(pids) {
        const want = [...new Set((pids || []).map(String).filter(Boolean))];
        const now = Date.now();
        const need = want.filter(pid => !cache[pid] || now - cache[pid].at > TTL);
        for (let i = 0; i < need.length; i += 80) {
            const batch = need.slice(i, i + 80);
            const got = await fetchBatch(batch);
            batch.forEach(pid => { cache[pid] = { at: now, items: Array.isArray(got[pid]) ? got[pid] : [] }; });
        }
        const out = {};
        want.forEach(pid => { out[pid] = (cache[pid] && cache[pid].items) || []; });
        return out;
    }
    function dateLabel(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        try { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch (e) { return iso.slice(5, 10); }
    }
    function label(item) {
        const via = item.link === 'team' || item.link === 'teammate' ? ' · via ' + (item.why || 'his team') : '';
        return dateLabel(item.published_at) + ' · ' + (KIND[item.kind] || 'News') + via;
    }

    App.PlayerNews = App.PlayerNews || { get, label, dateLabel, _cache: cache };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.PlayerNews;
})(typeof window !== 'undefined' ? window : globalThis);
