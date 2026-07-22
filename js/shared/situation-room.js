// ══════════════════════════════════════════════════════════════════
// situation-room.js — the shared team-state brain (WR.SituationRoom)
//
// The "AI Conductor" foundation. One canonical picture of the current
// team, plus ONE change-fingerprint that every AI wing can agree on, so
// the command brief, Alex Insights, the multi-league digest, and Ask Alex
// stop keeping separate (and drifting) opinions of "did anything change?"
//
// PHASE 1 — GROUNDWORK ONLY. This module is:
//   • ADDITIVE   — it wraps the EXISTING assemblers (WR.AIContext,
//     assessTeamFromGlobal, WR.GmMode) read-only. It rewrites nothing and
//     computes nothing on load, so importing it is a no-op.
//   • FLAGGED    — enabled() is false for everyone by default. Only the
//     owner QA account, an explicit window flag, or a localStorage opt-in
//     turns it on. Until a later phase wires a surface to it, NOTHING
//     calls it against a real user.
//   • FAIL-SAFE  — every read from a global is wrapped; a missing or
//     throwing dependency degrades to an empty field, never an exception.
//     The Situation Room can never take a page down.
//
// The fingerprint captures the material events the owner named as "the team
// actually changed": a trade or add/drop (roster players + record shift),
// the draft occurring (rookies enter the roster; pre-draft flag clears),
// and a strategy change (GM plan). A dedicated injury feed does not exist
// yet — injuries surface indirectly today through the roster assessment's
// needs, and a first-class injury signal is a later-phase hook (see
// _injurySignal below), deliberately left honest rather than faked.
//
// Plain JS (no JSX). Load AFTER js/shared/wr-ai-context.js (it reuses
// WR.AIContext) — but because every dependency is read at CALL time, not
// load time, load order only matters once a consumer actually calls get().
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    var VERSION = 1;

    // ── Feature flag ─────────────────────────────────────────────────
    // OFF for everyone unless one of these opts in:
    //   • window.__DHQ_SITUATION_ROOM === true   (page / QA harness force-on)
    //   • localStorage 'dhq_ff_situation' === '1' (manual QA opt-in)
    //   • an owner account (the app owner 'skjjcruz' or the QA account 'bigloco')
    // An explicit `false` (window flag or ls '0') force-disables even for the
    // owner, so QA can verify the OFF path on any account.
    function enabled() {
        try {
            if (window.__DHQ_SITUATION_ROOM === true) return true;
            if (window.__DHQ_SITUATION_ROOM === false) return false;
            var ls = null;
            try { ls = localStorage.getItem('dhq_ff_situation'); } catch (_) { /* storage blocked */ }
            if (ls === '1') return true;
            if (ls === '0') return false;
            var u = (window.OD && typeof window.OD.getCurrentUsername === 'function')
                ? window.OD.getCurrentUsername() : '';
            // Owner allowlist: the app owner's real Sleeper account plus the QA
            // account used in the verification harness. Both see the flagged AI
            // Conductor surfaces before the wider rollout.
            var OWNERS = { skjjcruz: 1, bigloco: 1 };
            if (OWNERS[String(u || '').toLowerCase()]) return true;
            // Also gate on the stable Sleeper user_id, not just the typed connect
            // handle — a display name and a login username can differ, and the id
            // never does. This is the reliable owner signal.
            var uid = '';
            try { uid = String((window.S && (window.S.myUserId || (window.S.user && window.S.user.user_id))) || ''); } catch (_) { /* no app state yet */ }
            var OWNER_IDS = { '540392203863576576': 1 }; // skjjcruz
            if (uid && OWNER_IDS[uid]) return true;
        } catch (_) { /* non-fatal */ }
        return false;
    }

    // ── Fingerprint hash ─────────────────────────────────────────────
    // Same djb2 the existing fingerprints use (wr-ai-context.js hashString /
    // dashboard-digest cacheKeyFor), so the Room speaks the same dialect.
    function _hash(str) {
        var h = 5381;
        for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    function _rosterId(roster) {
        if (!roster) return null;
        return (roster.roster_id != null) ? roster.roster_id
            : (roster.rosterId != null) ? roster.rosterId : null;
    }

    // Roster assessment: tier / window / healthScore / needs. Read-only
    // wrapper around the app's existing assessor.
    function _assess(rosterId) {
        try {
            return (typeof window.assessTeamFromGlobal === 'function')
                ? window.assessTeamFromGlobal(rosterId) : null;
        } catch (_) { return null; }
    }

    // Draft phase, best-effort from whatever the app already exposes. Kept
    // coarse on purpose — "pre" vs "done" is what changes the team picture;
    // the live pick-by-pick countdown belongs to the draft surfaces, not the
    // shared state.
    function _draftSignal(league, roster) {
        var out = { phase: '' };
        try {
            var settings = (roster && roster.settings) || {};
            var games = (settings.wins || 0) + (settings.losses || 0) + (settings.ties || 0);
            // A roster that has never played and holds no players reads pre-draft.
            var hasPlayers = !!(roster && roster.players && roster.players.length);
            out.phase = (!games && !hasPlayers) ? 'pre' : (!games ? 'drafted' : 'in-season');
            var did = (league && (league.draft_id || league.draftId)) || '';
            if (did) out.draftId = String(did);
        } catch (_) { /* non-fatal */ }
        return out;
    }

    // Injury signal — HONEST PLACEHOLDER. No dedicated feed exists yet, so
    // this returns an empty list today. A later phase can populate it from a
    // player-status source; leaving the field present now means adding the
    // feed later does NOT change the state shape, only its contents.
    function _injurySignal(/* roster */) {
        return [];
    }

    // ── Assemble the one canonical team-state object ─────────────────
    // Wraps the existing assemblers. Never throws.
    function assemble(league, roster) {
        var state = {
            schemaVersion: VERSION,
            leagueId: (league && (league.league_id || league.id)) || null,
            leagueName: (league && league.name) || '',
            format: null,
            tier: '',
            window: '',
            healthScore: 0,
            needs: [],
            record: '',
            players: [],
            gmStrategy: '',
            nflWeek: null,
            draft: { phase: '' },
            injuries: [],
            structured: null,
        };

        try {
            state.format = (window.WR && window.WR.AIContext && window.WR.AIContext.detectFormat)
                ? window.WR.AIContext.detectFormat(league) : null;
        } catch (_) { /* leave null */ }

        var assessment = _assess(_rosterId(roster));
        try {
            state.tier = (assessment && assessment.tier) || '';
            state.window = (assessment && (assessment.window || assessment.tradeWindow)) || '';
            state.healthScore = (assessment && assessment.healthScore) || 0;
            state.needs = (assessment && Array.isArray(assessment.needs)) ? assessment.needs : [];
            // Blended power rank (same engine every surface reads) — lets the brief
            // say "you're now #8" and catch a rank drop after a league shakeup.
            state.rank = (assessment && assessment.powerRank) || null;
        } catch (_) { /* leave defaults */ }

        try {
            var s = roster && roster.settings;
            state.record = s ? ((s.wins || 0) + '-' + (s.losses || 0) + ((s.ties > 0) ? ('-' + s.ties) : '')) : '';
        } catch (_) { /* leave '' */ }

        try {
            state.players = (roster && Array.isArray(roster.players)) ? roster.players.slice().sort() : [];
        } catch (_) { state.players = []; }

        try {
            state.gmStrategy = (window.WR && window.WR.GmMode && typeof window.WR.GmMode.promptBlock === 'function')
                ? (window.WR.GmMode.promptBlock(state.leagueId) || '') : '';
        } catch (_) { state.gmStrategy = ''; }

        try {
            state.nflWeek = (window.S && window.S.nflState && window.S.nflState.week)
                || (window.S && window.S.currentWeek) || null;
        } catch (_) { state.nflWeek = null; }

        state.draft = _draftSignal(league, roster);
        state.injuries = _injurySignal(roster);

        // The rich payload the server already understands (reused, not
        // rebuilt) — so a consumer can hand the whole Situation Room straight
        // to OD.callAI without re-deriving format/scoring/stateHash.
        try {
            state.structured = (window.WR && window.WR.AIContext && window.WR.AIContext.buildStructuredBase)
                ? window.WR.AIContext.buildStructuredBase(league, assessment, roster) : null;
        } catch (_) { state.structured = null; }

        return state;
    }

    // ── The one fingerprint everyone shares ──────────────────────────
    // Union of the material fields the two existing fingerprints track, plus
    // the draft phase. A big trade / add / drop moves `players` + `record`
    // (+ `tier`/`needs`); the draft occurring moves `players` + `draft.phase`;
    // a strategy edit moves `gmStrategy`; the week turning moves `nflWeek`.
    function fingerprint(state) {
        if (!state) return '0';
        var needs = (state.needs || []).map(function (n) {
            if (n == null) return '';
            return String((typeof n === 'object') ? (n.pos || n.position || '') : n);
        }).sort();
        var parts = [
            state.leagueId || '',
            (state.players || []).join(','),
            state.record || '',
            state.tier || '',
            needs.join('+'),
            state.gmStrategy || '',
            state.nflWeek || '',
            (state.draft && state.draft.phase) || '',
            state.rank || '',
        ];
        return _hash(parts.join('|'));
    }

    // ── get(): assemble → fingerprint → detect change (per league) ───
    // Returns { state, fingerprint, changed, first }. `changed` is true only
    // when this league's fingerprint differs from the last one we computed
    // (switching leagues is not a "change"). Fires a 'dhq:situation-changed'
    // window event on a real change — but ONLY when the flag is on, so a
    // flagged-off build is completely inert.
    var _byLeague = Object.create(null);
    function get(league, roster) {
        var state = assemble(league, roster);
        try { state.ts = Date.now(); } catch (_) { state.ts = null; }
        var fp = fingerprint(state);
        state.fingerprint = fp;

        var lid = state.leagueId || '_';
        var prev = _byLeague[lid];
        var changed = !!(prev && prev.fingerprint !== fp);
        _byLeague[lid] = { fingerprint: fp, state: state };

        if (changed && enabled()) {
            try {
                window.dispatchEvent(new CustomEvent('dhq:situation-changed', {
                    detail: { leagueId: lid, fingerprint: fp, previousFingerprint: prev.fingerprint },
                }));
            } catch (_) { /* no DOM / no CustomEvent — non-fatal */ }
        }

        return { state: state, fingerprint: fp, changed: changed, first: !prev };
    }

    // Last computed snapshot for a league without recomputing (null if get()
    // has never run for it).
    function peek(leagueId) {
        var rec = _byLeague[leagueId || '_'];
        return rec ? rec.state : null;
    }

    window.WR.SituationRoom = {
        VERSION: VERSION,
        enabled: enabled,
        assemble: assemble,
        fingerprint: fingerprint,
        get: get,
        peek: peek,
    };
})();
