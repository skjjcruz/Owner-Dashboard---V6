// ══════════════════════════════════════════════════════════════════
// js/draft/persistence.js — Template save/load + JSON export/import
//
// Phase 5 persistence tier 3 & 4 (localStorage-backed, Supabase is a
// documented follow-up — see supabase/migrations/mock_drafts.sql).
//
// Templates are full draftState snapshots stored under
//   wr_draft_cc_templates_{leagueId}
// as an array of { id, name, ts, state }.
//
// Each state is lightly serialized — we strip heavyweight CSV refs
// (same pattern as state.js:saveToLocal) so templates stay under ~500KB.
//
// Depends on: state.js (reducer), styles.js
// Exposes:    window.DraftCC.persistence.{ saveTemplate, loadTemplate,
//             listTemplates, deleteTemplate, exportTemplateJSON,
//             importTemplateJSON }
// ══════════════════════════════════════════════════════════════════

(function() {
    const LS_KEY = (leagueId) => 'wr_draft_cc_templates_' + (leagueId || 'default');
    const MAX_TEMPLATES = 10; // per league

    function slimPool(pool, maxSize) {
        return (pool || []).slice(0, maxSize || 600).map(p => ({
            pid: p.pid,
            csvPid: p.csvPid || null,
            name: p.name || p.full_name || '',
            pos: p.pos || p.position || '',
            team: p.team || p.nflTeam || '',
            college: p.college || p.school || '',
            age: p.age || null,
            birth_date: p.birth_date || null,
            dhq: Number(p.dhq || p.val || 0),
            consensusRank: p.consensusRank || p.rank || null,
            tier: p.tier || p.csv?.tier || null,
            photoUrl: p.photoUrl || '',
            source: p.source || null,
            isCSV: !!p.isCSV,
        })).filter(p => p.pid);
    }

    // Strip state for persistence — same pattern as state.saveToLocal
    function stripForSave(state) {
        return {
            ...state,
            // Drop heavy refs
            personas: {},            // recomposed on load
            originalPool: slimPool(state.originalPool && state.originalPool.length ? state.originalPool : state.pool, 600),
            pool: (state.pool || []).slice(0, 300),
            picks: (state.picks || []).map(p => ({ ...p, csv: null })),
            // Drop ephemeral UI state
            activeOffer: null,
            proposerDrawer: null,
            alex: {
                style: state.alex?.style || 'default',
                stream: [],          // commentary doesn't need to persist
                alexSpend: { sonnet: 0, flash: 0, budget: state.alex?.alexSpend?.budget || 12 },
                thinking: false,
                lastInsightAt: 0,
            },
        };
    }

    /**
     * saveTemplate — persist a named template for a league.
     *
     * @param {DraftState} state
     * @param {string} name
     * @returns {Object} the template record { id, name, ts, state }
     */
    function saveTemplate(state, name) {
        if (!state || !state.leagueId) return null;
        const templates = listTemplates(state.leagueId);
        const id = 'tpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const record = {
            id,
            name: name || ('Template ' + new Date().toLocaleString()),
            ts: Date.now(),
            state: stripForSave(state),
        };
        // Prepend newest, cap at MAX_TEMPLATES
        const next = [record, ...templates].slice(0, MAX_TEMPLATES);
        try {
            localStorage.setItem(LS_KEY(state.leagueId), JSON.stringify(next));
        } catch (e) {
            if (window.wrLog) window.wrLog('persistence.save', e);
            return null;
        }
        return record;
    }

    /**
     * loadTemplate — return a template's state blob for dispatching HYDRATE.
     *
     * @param {string} leagueId
     * @param {string} templateId
     * @returns {Object|null} state blob or null
     */
    function loadTemplate(leagueId, templateId) {
        const templates = listTemplates(leagueId);
        const rec = templates.find(t => t.id === templateId);
        if (!rec) return null;
        // Recompose personas — same trick as state.loadFromLocal
        const state = { ...rec.state };
        try {
            let draftDnaMap = {};
            if (window.DraftHistory?.loadDraftDNA) {
                draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
            }
            state.personas = window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap);
        } catch (e) {
            if (window.wrLog) window.wrLog('persistence.load.personas', e);
        }
        // originalPool fallback
        if (!state.originalPool || !state.originalPool.length) {
            state.originalPool = (state.pool || []).slice();
        }
        if (!state.pickedByIdx && window.DraftCC?.state?.buildPickedByIdx) {
            state.pickedByIdx = window.DraftCC.state.buildPickedByIdx(state.picks || []);
        }
        return state;
    }

    /**
     * listTemplates — returns array of template records for a league.
     * Records don't include full state (just metadata) to keep lists lean.
     *
     * @param {string} leagueId
     * @returns {Array<{id, name, ts, state}>}
     */
    function listTemplates(leagueId) {
        try {
            const raw = localStorage.getItem(LS_KEY(leagueId));
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            if (window.wrLog) window.wrLog('persistence.list', e);
            return [];
        }
    }

    /**
     * deleteTemplate — remove a template by id.
     */
    function deleteTemplate(leagueId, templateId) {
        const templates = listTemplates(leagueId);
        const next = templates.filter(t => t.id !== templateId);
        try {
            localStorage.setItem(LS_KEY(leagueId), JSON.stringify(next));
            return true;
        } catch (e) {
            if (window.wrLog) window.wrLog('persistence.delete', e);
            return false;
        }
    }

    /**
     * exportTemplateJSON — returns a JSON string of a template that can be
     * pasted / shared.
     */
    function exportTemplateJSON(state, name) {
        return JSON.stringify({
            version: 1,
            exported: Date.now(),
            name: name || 'Shared template',
            state: stripForSave(state),
        }, null, 2);
    }

    /**
     * importTemplateJSON — parse a JSON string back into a usable state.
     */
    function importTemplateJSON(jsonStr, leagueId) {
        try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.version !== 1) throw new Error('Unsupported version: ' + parsed.version);
            const state = { ...parsed.state, leagueId: leagueId || parsed.state.leagueId };
            // Recompose personas for the target league
            let draftDnaMap = {};
            if (window.DraftHistory?.loadDraftDNA) {
                draftDnaMap = window.DraftHistory.loadDraftDNA(state.leagueId) || {};
            }
            state.personas = window.DraftCC.persona.composeAllPersonas(state.leagueId, draftDnaMap);
            if (!state.originalPool || !state.originalPool.length) {
                state.originalPool = (state.pool || []).slice();
            }
            if (!state.pickedByIdx && window.DraftCC?.state?.buildPickedByIdx) {
                state.pickedByIdx = window.DraftCC.state.buildPickedByIdx(state.picks || []);
            }
            return state;
        } catch (e) {
            if (window.wrLog) window.wrLog('persistence.import', e);
            return null;
        }
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.persistence = {
        LS_KEY,
        MAX_TEMPLATES,
        saveTemplate,
        loadTemplate,
        listTemplates,
        deleteTemplate,
        exportTemplateJSON,
        importTemplateJSON,
    };
})();
