// ── Start/Sit Verdict ────────────────────────────────────────────
// The instant, deterministic "who to start" line on Game Day. It is built
// ONLY from the numbers the Lineup screen already shows (the optimizer's
// swap list and its gains, on DHQ's projections or the platform's while DHQ
// loads) — no model, no network, so it is on screen the moment the lineup
// is. Alex's prose streams in underneath it.
//
// TRUTH LAW: every name and number here comes from the engine's facts. When
// the engine can't separate two players (the best swap gains less than
// CLOSE_CALL_PTS), the verdict says so instead of pretending to a call.
//
// Pure: runs in the browser (window.App.StartSitVerdict) and in Node tests.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    // A coin flip on the engine's own numbers (projections move more than
    // this during the week): the best swap gains under CLOSE_CALL_PTS, or
    // under CLOSE_CALL_PCT of the better player's number. Owner ruling
    // 2026-10-27: the AI's rule (dhq-tools decide-lineup.ts CLOSE_PTS /
    // CLOSE_PCT), so the Lineup screen and the AI call the same swap the same
    // way. Never a coin flip when the player going to the bench can't score
    // (out, doubtful, bye: his number is 0).
    const CLOSE_CALL_PTS = 1.5;
    const CLOSE_CALL_PCT = 0.10;
    function isClose(top) {
        const gain = Number(top.gain) || 0;
        if (top.outPts != null && !(Number(top.outPts) > 0)) return false;
        const better = Math.max(Number(top.inPts) || 0, Number(top.outPts) || 0);
        return gain < CLOSE_CALL_PTS || gain < CLOSE_CALL_PCT * better;
    }

    function fmtPts(n) {
        const v = Math.round((Number(n) || 0) * 10) / 10;
        return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1));
    }

    function slotLabel(slot) {
        return String(slot || '').replace(/_/g, ' ').trim();
    }

    // facts: { onDhq, provLabel, starters, swaps:[{slot, in, out, gain, inPts?, outPts?}], benchPts }
    // inPts/outPts are the two players' numbers the swap was decided on: on
    // DHQ that is each player's average week (the rows show his typical week),
    // so the call names them ("avg 12.7 vs 10.1") and never contradicts the
    // screen (review 2026-09-29).
    // → { kind: 'empty'|'swap'|'close'|'optimal', text, source, top } or null
    function compute(facts) {
        if (!facts || typeof facts !== 'object') return null;
        const source = facts.onDhq ? 'DHQ' : String(facts.provLabel || 'platform');
        const swaps = Array.isArray(facts.swaps) ? facts.swaps.filter(Boolean) : [];

        if (!facts.starters) {
            return { kind: 'empty', source, top: null, text: 'Your starting slots are empty — fill them before kickoff.' };
        }
        if (!swaps.length) {
            return { kind: 'optimal', source, top: null, text: 'Start who’s in — your lineup is already optimal.' };
        }

        const top = swaps.reduce((a, b) => ((Number(b.gain) || 0) > (Number(a.gain) || 0) ? b : a), swaps[0]);
        const gain = Number(top.gain) || 0;
        const slot = slotLabel(top.slot);
        const more = swaps.length - 1;
        const avgWord = facts.onDhq ? 'avg ' : '';
        const tail = more > 0 ? ' · ' + more + ' more swap' + (more > 1 ? 's' : '') + ', +' + fmtPts(facts.benchPts) + (facts.onDhq ? ' avg' : '') + ' in all' : '';
        const both = top.in && top.out && top.inPts != null && top.outPts != null && isFinite(top.inPts) && isFinite(top.outPts);
        const pair = both ? avgWord + fmtPts(top.inPts) + ' vs ' + fmtPts(top.outPts) : '';

        if (top.in && top.out && isClose(top)) {
            return {
                kind: 'close', source, top,
                text: 'Too close to call: ' + top.in + ' vs ' + top.out + (slot ? ' at ' + slot : '')
                    + ' — the projections are within ' + fmtPts(Math.max(gain, 0)) + ' pts' + (pair ? ' (' + pair + ')' : '') + '. Your call.' + tail,
            };
        }
        let text;
        if (top.in && top.out) text = 'Start ' + top.in + ' over ' + top.out + (slot ? ' at ' + slot : '');
        else if (top.in) text = 'Start ' + top.in + (slot ? ' in your empty ' + slot : '');
        else if (top.out) text = 'Sit ' + top.out + (slot ? ' at ' + slot : '');
        else return { kind: 'optimal', source, top: null, text: 'Start who’s in — your lineup is already optimal.' };
        return { kind: 'swap', source, top, text: text + ' (' + (pair ? pair + ', ' : '') + '+' + fmtPts(gain) + ' pts)' + tail };
    }

    // ── The engine server's call (Phase A4, 2026-10-27) ──────────────
    // The same start/sit call the AI makes (dhq-tools get_start_sit, through
    // the app's door: no sign-in, so guests get it too). Fetched once per
    // league, team, week and saved lineup, kept a minute.
    const SRV_URL = 'https://hovnqztlbsgsywrbidbh.supabase.co/functions/v1/dhq-tools/app';
    const memo = {};
    function fromServer(leagueId, ownerId, sig) {
        const lid = String(leagueId || ''), uid = String(ownerId || '');
        if (!/^\d{10,20}$/.test(lid) || !/^\d{1,25}$/.test(uid) || typeof root.fetch !== 'function') return Promise.resolve(null);
        const k = lid + '|' + uid + '|' + (sig || '');
        const hit = memo[k];
        if (hit && Date.now() - hit.at < 60 * 1000) return hit.p;
        const p = root.fetch(SRV_URL + '?league=' + lid + '&user=' + encodeURIComponent(uid) + '&tool=get_start_sit', { credentials: 'omit' })
            .then(r => (r.ok ? r.json() : null)).then(b => (b && b.ok && b.result ? b.result : null)).catch(() => null);
        memo[k] = { at: Date.now(), p };
        return p;
    }
    // The server's call stands in for the screen's only when it was made on
    // exactly what the screen shows: this week, the lineup saved in Sleeper
    // (no edits on screen), and the same best lineup as the screen's
    // optimizer. Otherwise the screen's own call (same rules) stands.
    // srv: get_start_sit's result; see: { week, current: [pid], best: [pid] }.
    function serverVerdict(srv, see) {
        if (!srv || !see || !srv.recommendation || !Array.isArray(srv.optimal_lineup) || !Array.isArray(srv.current_lineup)) return null;
        if (Number(srv.week) !== Number(see.week)) return null;
        const set = a => (a || []).map(String).filter(x => x && x !== '0').sort().join(',');
        const pids = rows => rows.map(r => r && r.pid).filter(Boolean);
        if (set(pids(srv.current_lineup)) !== set(see.current) || set(pids(srv.optimal_lineup)) !== set(see.best)) return null;
        const changes = Array.isArray(srv.changes) ? srv.changes : [];
        const kind = srv.lineup_is_optimal || !changes.length ? 'optimal' : changes.every(c => c && c.close_call) ? 'close' : 'swap';
        return { kind, source: 'DHQ', top: null, text: String(srv.recommendation), server: true };
    }

    const StartSitVerdict = { CLOSE_CALL_PTS, CLOSE_CALL_PCT, compute, fromServer, serverVerdict };
    App.StartSitVerdict = App.StartSitVerdict || StartSitVerdict;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = StartSitVerdict;
})(typeof window !== 'undefined' ? window : globalThis);
