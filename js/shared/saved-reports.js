// ══════════════════════════════════════════════════════════════════
// saved-reports.js — Saved Alex reports (draft plans, class reads, asks)
//
// Dual persistence:
//   • Local cache (WrStorage) — immediate, offline, survives the mock-auth
//     preview. Source of truth for instant UI.
//   • Server sync (window.OD.saveAIAnalysis / loadAIHistory → ai_analysis
//     table, owner-scoped) — follows the user across devices when a real
//     session is present. Degrades to a no-op under mock/anon auth.
//
// Public API (window.WR.SavedReports):
//   listLocal(leagueId)                         → Array<Report>  (sync)
//   save(leagueId, { title, prompt, content, kind }) → Report     (async)
//   remove(leagueId, id)                        → void
//   syncFromServer(leagueId)                    → Array<Report>  (async, merged)
//
// Report schema:
//   { id, title, prompt, content, kind, createdAt, server? }
// ══════════════════════════════════════════════════════════════════
(function () {
    // Resolve lazily: this plain script can load before window.App.WrStorage
    // is initialized, so we must look it up at call time, not at module load.
    function getStore() { return (window.App && window.App.WrStorage) || null; }

    function key(leagueId) { return 'wr_saved_reports_' + (leagueId || 'global'); }

    function readLocal(leagueId) {
        const WrStorage = getStore();
        if (!WrStorage) return [];
        const raw = WrStorage.get(key(leagueId), []);
        return Array.isArray(raw) ? raw : [];
    }

    function writeLocal(leagueId, arr) {
        const WrStorage = getStore();
        if (WrStorage) WrStorage.set(key(leagueId), arr.slice(0, 50));
    }

    function genId() {
        return 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // Dedupe key so a locally-cached save and its server echo collapse into one row.
    function dedupeKey(r) {
        if (r.serverId) return 'sid:' + r.serverId;
        if (typeof r.id === 'string' && r.id.indexOf('srv_') === 0) return 'sid:' + r.id.slice(4);
        return (r.kind || '') + '|' + (r.title || '') + '|' + String(r.content || '').slice(0, 60);
    }

    function sortNewest(arr) {
        return arr.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    const API = {
        listLocal(leagueId) {
            return sortNewest(readLocal(leagueId));
        },

        async save(leagueId, { title, prompt, content, kind } = {}) {
            const rec = {
                id: genId(),
                title: String(title || 'Report').trim().slice(0, 80),
                prompt: String(prompt || ''),
                content: String(content || ''),
                kind: kind || 'report',
                createdAt: Date.now(),
            };
            const arr = readLocal(leagueId);
            arr.unshift(rec);
            writeLocal(leagueId, arr);
            // Server sync. No-ops if not configured / not authed. Capture the
            // new row id so this report can be deleted server-side later.
            try {
                if (window.OD && typeof window.OD.saveAIAnalysis === 'function') {
                    const serverId = await window.OD.saveAIAnalysis(leagueId, 'wr-' + rec.kind, rec.title, rec.content);
                    if (serverId) {
                        rec.serverId = serverId;
                        const cur = readLocal(leagueId);
                        const i = cur.findIndex(r => r.id === rec.id);
                        if (i >= 0) { cur[i].serverId = serverId; writeLocal(leagueId, cur); }
                    }
                }
            } catch (e) {
                if (window.wrLog) window.wrLog('saved-reports.sync', e);
            }
            return rec;
        },

        remove(leagueId, id) {
            const arr = readLocal(leagueId);
            const rec = arr.find(r => r.id === id);
            let serverId = (rec && rec.serverId) || null;
            // Server-only rows (from syncFromServer) carry the id as 'srv_<rowId>'.
            if (!serverId && typeof id === 'string' && id.indexOf('srv_') === 0) serverId = id.slice(4);
            if (serverId && window.OD && typeof window.OD.deleteAIAnalysis === 'function') {
                try { window.OD.deleteAIAnalysis(serverId); } catch (e) { /* local removal still applies */ }
            }
            writeLocal(leagueId, arr.filter(r => r.id !== id));
        },

        async syncFromServer(leagueId) {
            const local = readLocal(leagueId);
            let server = [];
            if (window.OD && typeof window.OD.loadAIHistory === 'function') {
                try {
                    const rows = await window.OD.loadAIHistory(leagueId);
                    server = (Array.isArray(rows) ? rows : [])
                        .filter(r => typeof r.type === 'string' && r.type.indexOf('wr-') === 0)
                        .map(r => ({
                            id: 'srv_' + r.id,
                            title: r.context_summary || 'Report',
                            prompt: '',
                            content: r.analysis || '',
                            kind: r.type.replace(/^wr-/, ''),
                            createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
                            server: true,
                        }));
                } catch (e) {
                    server = [];
                }
            }
            const seen = new Set();
            const merged = [];
            // Local first so local ids win on dedupe (keeps delete working in-session).
            sortNewest(local.concat(server)).forEach(r => {
                const k = dedupeKey(r);
                if (seen.has(k)) return;
                seen.add(k);
                merged.push(r);
            });
            return merged.slice(0, 50);
        },
    };

    window.WR = window.WR || {};
    window.WR.SavedReports = API;
})();
