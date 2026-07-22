// ══════════════════════════════════════════════════════════════════
// surface-read.js — the reusable "explain this screen" layer (WR.SurfaceRead)
//
// Phase 3 of the AI Conductor. One drop-in line that any Tier-1 screen can
// mount to get a single plain-English "here's what this screen is really
// telling you, and the one thing to do about it" read — the "so what" a
// static chart or KPI row can't provide.
//
// Design (matches BriefPulse's "react, but never let it break"):
//   • REUSABLE: a screen mounts <WR.SurfaceRead.Line surfaceId title metrics
//     league roster/> and nothing else. Analytics, Free Agency, Compare, and
//     the Home "one move" all share ONE route and ONE component — no per-screen
//     AI plumbing, no per-screen server prompt.
//   • GROUNDED: the read is built from the shared Situation Room team-state
//     (the same reconciled tier / power rank / needs every other surface uses)
//     plus whatever numbers the screen hands us, so it can never contradict the
//     command brief or the Power Rankings.
//   • CHEAP + UNCOUNTED: routes through the server 'surface_read' type, which is
//     server-cached (6h) and exempt from the daily AI-call count. Client-cached
//     per (surfaceId + situation fingerprint) on top, so a screen the GM opens
//     ten times in a session makes at most one network call.
//   • GATED: renders nothing unless WR.SituationRoom.enabled() — owner QA
//     account only for now. Flag off ⇒ the component returns null and no AI
//     call is ever made. Existing screens are 100% untouched.
//   • FAIL-SAFE: no server AI (BYOK-only user), a slow call, a limit, or a
//     throw all degrade to rendering nothing. The layer never blocks a screen
//     and never shows a broken/empty shell.
//
// Plain JS (no JSX): the Line component uses window.React.createElement and
// hooks, the brief-pulse.js pattern. Load AFTER situation-room.js.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    var LINE_KEY = 'dhq_surface_read_v1:'; // + surfaceId + '|' + fingerprint → cached line

    function _enabled() {
        try {
            return !!(window.WR && window.WR.SituationRoom &&
                typeof window.WR.SituationRoom.enabled === 'function' &&
                window.WR.SituationRoom.enabled());
        } catch (_) { return false; }
    }

    // Only read once the league intelligence has actually landed. Before that
    // the assessment (tier / power rank / needs) is still settling, so its
    // fingerprint churns through garbage values — firing on each churn would
    // waste calls and could flash a wrong line. Mirrors the Power Score pin's
    // readiness gate: compute on complete data, not on the way there.
    function _dataReady() {
        try { return !!(window.App && window.App.LI_LOADED); } catch (_) { return false; }
    }

    function _rosterId(roster) {
        if (!roster) return null;
        return (roster.roster_id != null) ? roster.roster_id
            : (roster.rosterId != null) ? roster.rosterId : null;
    }

    // ── Cache (per surface + situation fingerprint) ──────────────────
    function loadCachedLine(surfaceId, fp) {
        try { return localStorage.getItem(LINE_KEY + surfaceId + '|' + fp) || null; } catch (_) { return null; }
    }
    function saveCachedLine(surfaceId, fp, line) {
        try { localStorage.setItem(LINE_KEY + surfaceId + '|' + fp, line); } catch (_) { /* storage full/blocked — non-fatal */ }
    }

    // ── Trim the model's reply to one clean sentence ─────────────────
    function _trim(text) {
        var t = String(text || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
        t = t.replace(/^(good (morning|afternoon|evening)[,.!]?\s*)/i, '');
        // First sentence, hard cap so a screen never gets a paragraph.
        var m = t.match(/^[\s\S]*?[.!?]/);
        if (m) t = m[0].trim();
        if (t.length > 220) t = t.slice(0, 217).replace(/\s+\S*$/, '') + '…';
        return t;
    }

    // Reconcile the surface's numbers with the shared team read, then ask the
    // server for one line. Returns the line, or null on any failure. Never throws.
    function _buildContext(surface, league, roster) {
        var sit = {};
        try {
            var got = (window.WR && window.WR.SituationRoom && typeof window.WR.SituationRoom.get === 'function')
                ? window.WR.SituationRoom.get(league, roster) : null;
            var st = got && got.state;
            if (st) {
                sit.tier = st.tier || '';
                sit.window = st.window || '';
                sit.healthScore = st.healthScore || 0;
                sit.needs = st.needs || [];
                sit.record = st.record || '';
                sit.format = st.format || null;
                sit.fingerprint = st.fingerprint || (got && got.fingerprint) || '';
            }
        } catch (_) { /* leave sit sparse */ }
        // Power rank comes straight from the one blended engine, so the read
        // agrees with the brief / widget / elites badge.
        try {
            var assess = (typeof window.assessTeamFromGlobal === 'function')
                ? window.assessTeamFromGlobal(_rosterId(roster)) : null;
            if (assess && assess.powerRank) sit.powerRank = assess.powerRank;
        } catch (_) { /* optional */ }

        var metrics = surface && surface.metrics;
        if (typeof metrics === 'function') {
            try { metrics = metrics(); } catch (_) { metrics = null; }
        }

        var leagueId = (league && (league.league_id || league.id)) || null;
        return {
            fingerprint: sit.fingerprint || '',
            payload: JSON.stringify({
                leagueId: leagueId,
                leagueName: (league && league.name) || '',
                surface: {
                    id: (surface && surface.id) || 'screen',
                    title: (surface && surface.title) || '',
                    metrics: (metrics && typeof metrics === 'object') ? metrics : {},
                },
                situation: sit,
            }),
        };
    }

    // read(surface, {league, roster}) → Promise<string|null>
    async function read(surface, opts) {
        if (!_enabled() || !_dataReady()) return null;
        var league = opts && opts.league;
        var roster = opts && opts.roster;
        if (!league || !roster || !surface) return null;

        var built = _buildContext(surface, league, roster);
        var surfaceId = (surface && surface.id) || 'screen';
        var fp = built.fingerprint || '0';

        var cached = loadCachedLine(surfaceId, fp);
        if (cached) return cached;

        try {
            // Server path only: 'surface_read' is a server-cached, uncounted type.
            // A BYOK-only user (no OD.callAI) simply gets no line — additive.
            if (!(window.OD && typeof window.OD.callAI === 'function')) return null;
            var res = await window.OD.callAI({ type: 'surface_read', context: built.payload });
            var raw = (res && (res.analysis || res.text || res.response)) || (typeof res === 'string' ? res : '');
            var line = _trim(raw);
            if (line && line.length > 4) {
                saveCachedLine(surfaceId, fp, line);
                return line;
            }
        } catch (_) { /* slow / limited / offline — degrade to no line */ }
        return null;
    }

    // ── The rendered line (thin React glue over read()) ──────────────
    // props: { surfaceId, title, metrics (object | () => object), league,
    //          roster, tight, icon }
    function Line(props) {
        var React = window.React;
        if (!React) return null;
        var h = React.createElement;

        var league = props && props.league;
        var roster = props && props.roster;
        var tight = !!(props && props.tight);
        var icon = (props && props.icon) || '✦';

        var active = !!(_enabled() && league && roster);

        // Build the surface descriptor + fingerprint every render (cheap, pure).
        var surface = {
            id: (props && props.surfaceId) || 'screen',
            title: (props && props.title) || '',
            metrics: props && props.metrics,
        };
        // '(pending)' until the data is ready, so the effect fires exactly once —
        // when the assessment settles — not on each mid-load fingerprint churn.
        var fp = '(pending)';
        if (active && _dataReady()) {
            try { fp = _buildContext(surface, league, roster).fingerprint || '0'; } catch (_) { active = false; }
        }

        // Seed from cache so a revisit paints instantly with no flash.
        var seed = active ? loadCachedLine(surface.id, fp) : null;
        var ref = React.useState(seed || null);
        var line = ref[0], setLine = ref[1];

        React.useEffect(function () {
            if (!active) { setLine(null); return; }
            var cachedNow = loadCachedLine(surface.id, fp);
            if (cachedNow) { setLine(cachedNow); return; }
            var alive = true;
            read(surface, { league: league, roster: roster }).then(function (l) {
                if (alive && l) setLine(l);
            });
            return function () { alive = false; };
        // Re-run only when the screen or the situation actually changes.
        }, [active, surface.id, fp]);

        if (!active || !line) return null;

        return h('div', {
            'data-surface-read': surface.id,
            style: {
                display: 'flex', alignItems: 'flex-start', gap: '7px',
                margin: tight ? '4px 0 0' : '10px 0',
                padding: tight ? '5px 8px' : '8px 11px',
                background: 'rgba(212,175,55,0.07)',
                borderLeft: '2px solid var(--gold, #d4af37)',
                borderRadius: '3px',
                fontSize: tight ? '0.74rem' : '0.82rem',
                lineHeight: 1.4, color: 'var(--white, #e8ebef)',
            },
        },
            h('span', { 'aria-hidden': 'true', style: { color: 'var(--gold, #d4af37)', flex: '0 0 auto' } }, icon),
            h('span', { style: { flex: 1 } }, line),
        );
    }

    window.WR.SurfaceRead = {
        enabled: _enabled,
        read: read,
        loadCachedLine: loadCachedLine,
        saveCachedLine: saveCachedLine,
        Line: Line,
    };
})();
