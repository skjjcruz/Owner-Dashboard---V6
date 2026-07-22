// ══════════════════════════════════════════════════════════════════
// brief-pulse.js — the command brief's "what changed" line (WR.BriefPulse)
//
// Phase 2 of the AI Conductor. Adds ONE line at the top of the command
// brief that reacts to what actually happened in your league since your
// last visit — the environment-awareness the template can't provide.
//
// Design (matches the owner's "make it react, but never let it break"):
//   • FLOOR (deterministic, always works): computeChange() diffs the last
//     saved snapshot against the current Situation Room state and writes a
//     plain-English line ("Since your last visit: you added J. Downs (WR),
//     and you're now 7-2."). No AI, no network, cannot fail.
//   • ENHANCE (AI, best-effort): when something changed, Alex rewrites that
//     line in his voice with the "why it matters." Cached per fingerprint
//     (one call per real change), and if the AI is slow/limited/offline the
//     deterministic line stays. The line NEVER disappears and never blocks.
//   • GATED: renders nothing unless WR.SituationRoom.enabled() — owner QA
//     account only for now. Flag off ⇒ the component returns null and no
//     AI call is ever made. The existing template is 100% untouched.
//
// Only material events count — a trade/add-drop, a record change, a tier
// flip, the draft completing. A bare NFL-week rollover is NOT a change
// (nothing happened in your league), so no line appears for it.
//
// Plain JS (no JSX): the Line component uses window.React.createElement and
// hooks, the dashboard-digest.js pattern. Load AFTER situation-room.js.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    var SNAP_KEY = 'dhq_brief_pulse_v1:';   // + leagueId → last acknowledged snapshot
    var LINE_KEY = 'dhq_brief_pulse_line_v1:'; // + fingerprint → cached AI line

    // ── Snapshot persistence ─────────────────────────────────────────
    function loadSnapshot(leagueId) {
        try {
            var raw = localStorage.getItem(SNAP_KEY + (leagueId || '_'));
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }
    function saveSnapshot(leagueId, snap) {
        try { localStorage.setItem(SNAP_KEY + (leagueId || '_'), JSON.stringify(snap)); } catch (_) { /* storage full/blocked — non-fatal */ }
    }

    // The minimal snapshot we diff on, distilled from a Situation Room state.
    function snapshotFromState(state) {
        if (!state) return null;
        return {
            fingerprint: state.fingerprint || '',
            players: (state.players || []).slice(),
            record: state.record || '',
            tier: state.tier || '',
            draftPhase: (state.draft && state.draft.phase) || '',
            rank: (state.rank != null ? state.rank : null),
        };
    }

    // ── League-wide trade radar (Phase 2b) ───────────────────────────
    // The command brief only diffed YOUR roster, so a blockbuster between two
    // OTHER teams — which still reshapes the league and your standing — read as
    // "nothing changed." This surfaces the freshest completed league trade
    // inside a ~36h window with a plain-English headline. It reads ALREADY
    // CACHED transactions only (window.S.transactions, then the WrTxns cache) —
    // it never fetches and never blocks; no data ⇒ null ⇒ the brief is unchanged.
    var TRADE_WINDOW_MS = 36 * 60 * 60 * 1000;   // "over the last day"

    function _ownerNameForRoster(league, rid) {
        try {
            var rosters = (league && league.rosters) || [];
            var roster = null;
            for (var i = 0; i < rosters.length; i++) {
                if (String(rosters[i].roster_id) === String(rid)) { roster = rosters[i]; break; }
            }
            var users = (league && league.users) || (window.S && window.S.leagueUsers) || [];
            if (roster) {
                for (var j = 0; j < users.length; j++) {
                    if (users[j] && users[j].user_id === roster.owner_id) {
                        return (users[j].metadata && users[j].metadata.team_name) || users[j].display_name || users[j].username || ('Team ' + rid);
                    }
                }
            }
        } catch (_) { /* fall through */ }
        return 'Team ' + rid;
    }

    // Completed trades for a league, newest first. Prefers the WrTxns cache,
    // falls back to the open league's hydrated set (window.S.transactions,
    // bucketed by week). Returns [] on anything unexpected.
    function _allTrades(leagueId) {
        try {
            if (window.WrTxns && typeof window.WrTxns.recentTrades === 'function' && leagueId) {
                var rt = window.WrTxns.recentTrades(leagueId, 12);
                if (rt && rt.length) return rt;
            }
        } catch (_) { /* fall through to the hydrated set */ }
        try {
            var raw = (window.S && window.S.transactions) || {};
            var list = Array.isArray(raw) ? raw : Object.keys(raw).reduce(function (acc, k) { return acc.concat(raw[k] || []); }, []);
            return list
                .filter(function (t) { return t && t.type === 'trade' && t.status !== 'failed'; })
                .sort(function (a, b) { return (_tradeTs(b) - _tradeTs(a)); });
        } catch (_) { return []; }
    }

    function _tradeTs(t) {
        var ts = (t && (t.status_updated || t.created)) || 0;
        return ts < 1e12 ? ts * 1000 : ts;   // Sleeper is ms; guard a stray seconds value
    }

    // Everything each roster RECEIVED in this trade, sorted by DHQ value desc
    // (players carry their live power score; picks sort last at value 0). This
    // is what lets the headline lead with the biggest names that moved.
    //   → { '<rid>': [{ name, val }], ... }
    function _addsByRoster(trade, playersData) {
        var byR = {};
        var scores = (window.App && window.App.LI && window.App.LI.playerScores) || {};
        Object.keys((trade && trade.adds) || {}).forEach(function (pid) {
            var rid = String(trade.adds[pid]);
            (byR[rid] = byR[rid] || []).push({ name: _name(pid, playersData) || 'a player', val: scores[pid] || 0 });
        });
        ((trade && trade.draft_picks) || []).forEach(function (p) {
            var rid = String(p.owner_id);
            (byR[rid] = byR[rid] || []).push({ name: ((p.season || '') + ' R' + (p.round || '?') + ' pick').trim(), val: 0 });
        });
        Object.keys(byR).forEach(function (rid) { byR[rid].sort(function (a, b) { return b.val - a.val; }); });
        return byR;
    }

    function _join(arr) {
        arr = (arr || []).filter(Boolean);
        if (arr.length <= 1) return arr[0] || '';
        if (arr.length === 2) return arr[0] + ' and ' + arr[1];
        return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
    }

    // Build the headline for a trade. When one side clearly lands the marquee
    // talent (its top asset outclasses the other side's), lead with "Winner got
    // A and B from Loser". When it's close — or 3+ teams — fall back to naming
    // each side's biggest piece ("X landed A; Y landed B"). DHQ decides.
    function _tradeHeadline(league, trade, playersData) {
        var byR = _addsByRoster(trade, playersData);
        var rids = (trade.roster_ids || Object.keys(byR)).slice(0, 4).map(String);
        var perSide = function () {
            return rids.map(function (rid) {
                var got = (byR[rid] || [])[0];
                var nm = _ownerNameForRoster(league, rid);
                return (got && got.name) ? (nm + ' landed ' + got.name) : nm;
            }).join('; ');
        };
        if (rids.length !== 2) return perSide();
        var topA = (byR[rids[0]] || [])[0], topB = (byR[rids[1]] || [])[0];
        var valA = topA ? topA.val : 0, valB = topB ? topB.val : 0;
        var winner = valA >= valB ? rids[0] : rids[1];
        var loser = winner === rids[0] ? rids[1] : rids[0];
        var winVal = Math.max(valA, valB), loseVal = Math.min(valA, valB);
        // Lopsided when the winner's headliner clearly outranks the other side's
        // (and there's real value moving). Otherwise it's "fairly even".
        if (winVal > 0 && loseVal < winVal * 0.8) {
            var haul = (byR[winner] || []).filter(function (a) { return a.val > 0; });
            if (!haul.length) haul = (byR[winner] || []);
            var names = haul.slice(0, 2).map(function (a) { return a.name; });
            return _ownerNameForRoster(league, winner) + ' got ' + _join(names) + ' from ' + _ownerNameForRoster(league, loser);
        }
        return perSide();
    }

    function _tradeWhen(ageMs) {
        var h = ageMs / 3600000;
        if (h <= 18) return 'last night';
        if (h <= 36) return 'yesterday';
        return 'this week';
    }

    // recentLeagueTrade(league, roster, playersData)
    //   → { id, ts, ageMs, when, involvesMe, teams:[rid], headline } | null
    function recentLeagueTrade(league, roster, playersData) {
        try {
            var leagueId = (league && (league.league_id || league.id)) || null;
            var trades = _allTrades(leagueId);
            if (!trades.length) return null;
            var top = trades[0];
            var ts = _tradeTs(top);
            if (!ts) return null;
            var age = Date.now() - ts;
            if (age < 0 || age > TRADE_WINDOW_MS) return null;   // stale ⇒ nothing to shout about
            var rids = (top.roster_ids || []).slice(0, 4);
            var myRid = roster && (roster.roster_id != null ? roster.roster_id : roster.rosterId);
            var involvesMe = rids.map(String).indexOf(String(myRid)) >= 0;
            return {
                id: top.transaction_id || (top.type + ':' + ts),
                ts: ts, ageMs: age, when: _tradeWhen(age),
                involvesMe: involvesMe, teams: rids, headline: _tradeHeadline(league, top, playersData),
            };
        } catch (_) { return null; }
    }

    // ── Deterministic diff (the floor) ───────────────────────────────
    function _name(id, playersData) {
        try {
            var p = playersData && playersData[id];
            if (!p) return null;
            return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || null;
        } catch (_) { return null; }
    }
    function _pos(id, playersData) {
        try {
            var p = playersData && playersData[id];
            var pos = p && (p.position || (p.fantasy_positions && p.fantasy_positions[0]));
            return pos || '';
        } catch (_) { return ''; }
    }
    function _label(id, playersData) {
        var n = _name(id, playersData);
        if (!n) return null;                       // no metadata → skip naming it
        var pos = _pos(id, playersData);
        return pos ? (n + ' (' + pos + ')') : n;
    }
    function _list(ids, playersData, max) {
        var out = [];
        for (var i = 0; i < ids.length && out.length < (max || 2); i++) {
            var l = _label(ids[i], playersData);
            if (l) out.push(l);
        }
        var extra = ids.length - out.length;
        var joined = out.join(' and ');
        if (out.length && extra > 0) joined += ' and ' + extra + ' more';
        return joined;
    }
    function _wins(record) {
        var m = /^(\d+)-(\d+)/.exec(String(record || ''));
        return m ? { w: +m[1], l: +m[2] } : null;
    }

    // computeChange(prev, curr, playersData) → { material, changes:[{type,text}], line }
    // prev/curr are snapshots. First-ever visit (no prev) is intentionally
    // NON-material — we can't say what changed with nothing to compare to.
    function computeChange(prev, curr, playersData) {
        var empty = { material: false, changes: [], line: '', eyes: false };
        if (!curr) return empty;

        var changes = [];
        var eyes = false;

        // League-wide trade LEADS the brief (owner's "Huge trade last night…").
        // It's a "what's notable right now" read, not a since-last-visit diff,
        // so a fresh trade is material even on a first-ever visit (no prev).
        if (curr._trade && curr._trade.headline) {
            eyes = true;
            var tr = curr._trade;
            var lead = (tr.involvesMe ? 'Big trade ' : 'Huge trade ') + tr.when;
            changes.push({ type: 'trade', eyes: true, text: lead + ' — ' + tr.headline });
        }

        // Roster / record / tier / draft all diff against the last visit — with
        // no prev there is nothing to compare, so these are skipped on a first
        // visit (the live trade + rank anchor below can still stand alone).
        if (prev) {
            var prevSet = {}, currSet = {};
            (prev.players || []).forEach(function (id) { prevSet[id] = true; });
            (curr.players || []).forEach(function (id) { currSet[id] = true; });
            var added = (curr.players || []).filter(function (id) { return !prevSet[id]; });
            var removed = (prev.players || []).filter(function (id) { return !currSet[id]; });

            if (added.length) {
                var a = _list(added, playersData, 2);
                changes.push({ type: 'add', text: a ? ('you added ' + a) : ('you added ' + added.length + ' player' + (added.length > 1 ? 's' : '')) });
            }
            if (removed.length) {
                var r = _list(removed, playersData, 2);
                changes.push({ type: 'drop', text: r ? ('you moved on from ' + r) : ('you dropped ' + removed.length + ' player' + (removed.length > 1 ? 's' : '')) });
            }

            if (prev.record !== curr.record && curr.record) {
                var pw = _wins(prev.record), cw = _wins(curr.record);
                var verb = '';
                if (pw && cw) {
                    if (cw.w > pw.w) verb = 'picked up a win';
                    else if (cw.l > pw.l) verb = 'took a loss';
                }
                changes.push({ type: 'record', text: (verb ? verb + ' — now ' : "you're now ") + curr.record });
            }

            if (prev.tier && curr.tier && prev.tier !== curr.tier) {
                changes.push({ type: 'tier', text: 'your team shifted from ' + prev.tier + ' to ' + curr.tier });
            }

            if (prev.draftPhase !== curr.draftPhase &&
                (prev.draftPhase === 'pre') && (curr.draftPhase === 'drafted' || curr.draftPhase === 'in-season')) {
                changes.push({ type: 'draft', text: 'your draft is complete' });
            }
        }

        // Power rank: name the drop/climb when we can diff it (that's the "why
        // did I fall to #8"), else anchor a league trade to where you now sit.
        if (curr.rank) {
            if (prev && prev.rank && prev.rank !== curr.rank) {
                var worse = curr.rank > prev.rank;
                changes.push({ type: 'rank', text: 'your power rank ' + (worse ? 'slipped' : 'climbed') + ' from #' + prev.rank + ' to #' + curr.rank });
            } else if (eyes) {
                changes.push({ type: 'rank', text: "you're now #" + curr.rank + ' in the power rankings' });
            }
        }

        if (!changes.length) return empty;
        return _assembleLine(changes, eyes);
    }

    // Join the change phrases into one line. A trade-led line (eyes) keeps its
    // punchy headline capitalized; a plain diff keeps the "Since your last
    // visit —" lead the brief has always used.
    function _assembleLine(changes, eyes) {
        var phrases = changes.map(function (c) { return c.text; });
        var joined = phrases.length > 1
            ? phrases.slice(0, -1).join(', ') + ', and ' + phrases[phrases.length - 1]
            : phrases[0];
        var line;
        if (eyes) {
            line = joined.charAt(0).toUpperCase() + joined.slice(1);
            if (!/[.!?]$/.test(line)) line += '.';
        } else {
            line = 'Since your last visit — ' + joined.charAt(0).toLowerCase() + joined.slice(1) + '.';
        }
        return { material: true, changes: changes, line: line, eyes: eyes };
    }

    // ── AI enhancement (best-effort) ─────────────────────────────────
    function loadCachedLine(fp) {
        try { return localStorage.getItem(LINE_KEY + fp) || null; } catch (_) { return null; }
    }
    function saveCachedLine(fp, line) {
        try { localStorage.setItem(LINE_KEY + fp, line); } catch (_) { /* non-fatal */ }
    }
    function _trim(text) {
        var t = String(text || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
        // Alex sometimes greets — strip a leading "Good morning," etc.
        t = t.replace(/^(good (morning|afternoon|evening)[,.!]?\s*)/i, '');
        // First 1–2 sentences, hard cap so the brief never gets a paragraph.
        var m = t.match(/^[\s\S]*?[.!?](\s+[\s\S]*?[.!?])?/);
        if (m) t = m[0].trim();
        if (t.length > 180) t = t.slice(0, 177).replace(/\s+\S*$/, '') + '…';
        return t;
    }
    // Returns an Alex-voice line, or null on any failure. Never throws.
    async function enhance(change, state) {
        try {
            if (typeof window.dhqAI !== 'function') return null;
            var context = JSON.stringify({
                changes: change.changes.map(function (c) { return c.text; }),
                team: {
                    tier: state && state.tier,
                    record: state && state.record,
                    powerRank: state && state.rank,
                    needs: (state && state.needs || []).map(function (n) { return (n && (n.pos || n.position)) || n; }),
                },
                leagueTrade: (state && state.trade) || null,
            });
            var msg = 'In ONE short sentence (max 26 words), tell me what just changed in my dynasty league and why it matters for MY team. '
                + 'If a rival trade shifted the balance, say who got stronger and how it hits my standing. '
                + 'Be specific and useful. No greeting, no preamble, no lists.';
            var reply = await window.dhqAI('home-chat', msg, context);
            var line = _trim(reply);
            return line && line.length > 4 ? line : null;
        } catch (_) { return null; }
    }

    // ── The rendered line (thin React glue over the pure fns) ────────
    function Line(props) {
        var React = window.React;
        if (!React) return null;
        var h = React.createElement;

        var league = props && props.league;
        var roster = props && props.roster;
        var playersData = (props && props.playersData) || null;
        var tight = !!(props && props.tight);

        // Gate: owner/flag only, and we need a league + roster + the Room.
        var active = !!(window.WR && window.WR.SituationRoom &&
            typeof window.WR.SituationRoom.enabled === 'function' && window.WR.SituationRoom.enabled() &&
            league && roster);

        // Current state + change are pure and cheap — compute every render.
        var curr = null, change = { material: false, changes: [], line: '', eyes: false }, leagueId = null;
        if (active) {
            try {
                var got = window.WR.SituationRoom.get(league, roster);
                curr = snapshotFromState(got && got.state);
                leagueId = (got && got.state && got.state.leagueId) || null;
                // League-trade radar — the environment-awareness a roster diff
                // can't see. Read-only, cached-only; null when nothing's fresh.
                if (curr) curr._trade = recentLeagueTrade(league, roster, playersData);
                var prev = loadSnapshot(leagueId);
                change = computeChange(prev, curr, playersData);
                // The state carries needs for the AI context.
                if (got && got.state) curr._needs = got.state.needs;
            } catch (_) { active = false; }
        }

        // Hooks are always called (stable order): line text starts at the
        // deterministic floor, then an effect may upgrade it via AI.
        var ref = React.useState(change.material ? change.line : null);
        var line = ref[0], setLine = ref[1];
        // Any material change — a trade OR a roster/rank/record diff — gets
        // the 👀 (owner's brief spec 2026-07-21); the quiet line gets 📰.
        var icon = change.material ? '👀' : '📰';

        var _tradeId = curr && curr._trade && curr._trade.id;
        React.useEffect(function () {
            if (!active || !change.material || !curr) return;
            var alive = true;
            // Show the deterministic line immediately.
            setLine(change.line);
            // Save the snapshot so this change is "acknowledged" — next visit
            // diffs from here (the roster/rank diff flashes once per real change;
            // a fresh league trade keeps showing until it ages out of the window).
            saveSnapshot(leagueId, { fingerprint: curr.fingerprint, players: curr.players, record: curr.record, tier: curr.tier, draftPhase: curr.draftPhase, rank: curr.rank });
            // AI enhancement: cached per fingerprint+trade, best-effort.
            var cacheKey = curr.fingerprint + (_tradeId ? ('|' + _tradeId) : '');
            var cached = loadCachedLine(cacheKey);
            if (cached) { setLine(cached); return; }
            enhance(change, { tier: curr.tier, record: curr.record, needs: curr._needs, rank: curr.rank, trade: curr._trade })
                .then(function (aiLine) {
                    if (!alive || !aiLine) return;
                    saveCachedLine(cacheKey, aiLine);
                    setLine(aiLine);
                });
            return function () { alive = false; };
        }, [active, curr && curr.fingerprint, _tradeId]);

        // No material change: normally render nothing. In `quiet` mode (used
        // as the Intelligence Brief's lead line) render a muted "nothing moved"
        // status instead, so the brief always opens with its 24-hour read.
        if (!active || !change.material || !line) {
            if (!active || !props || !props.quiet) return null;
            return h('div', {
                style: {
                    display: 'flex', alignItems: 'flex-start', gap: '7px',
                    margin: tight ? '4px 0 0' : '8px 0 0',
                    padding: tight ? '5px 8px' : '7px 10px',
                    fontSize: tight ? '0.74rem' : '0.82rem',
                    lineHeight: 1.4, color: 'var(--silver, #9aa4b2)',
                },
            },
                h('span', { 'aria-hidden': 'true', style: { opacity: 0.85, flex: '0 0 auto' } }, '📰'),
                h('span', { style: { flex: 1 } }, 'No change in your roster strength over the last 24 hours.'),
            );
        }

        return h('div', {
            style: {
                display: 'flex', alignItems: 'flex-start', gap: '7px',
                margin: tight ? '4px 0 0' : '8px 0 0',
                padding: tight ? '5px 8px' : '7px 10px',
                background: 'rgba(212,175,55,0.07)',
                borderLeft: '2px solid var(--gold, #d4af37)',
                borderRadius: '3px',
                fontSize: tight ? '0.74rem' : '0.82rem',
                lineHeight: 1.4, color: 'var(--white, #e8ebef)',
            },
        },
            h('span', { role: 'img', 'aria-label': change.eyes ? 'Trade alert' : 'League update', style: { color: 'var(--gold, #d4af37)', flex: '0 0 auto' } }, icon),
            h('span', { style: { flex: 1 } }, line),
        );
    }

    // ── Convenience read for the flash-brief lead line ───────────────
    // Assembles curr from the Room, attaches the league-trade radar, diffs vs
    // the saved snapshot, and returns { material, line, eyes, curr, leagueId }.
    // Never throws; a bad/absent Room degrades to a non-material read.
    function readNow(league, roster, playersData) {
        var out = { material: false, line: '', eyes: false, curr: null, leagueId: null };
        try {
            if (!(window.WR && window.WR.SituationRoom && typeof window.WR.SituationRoom.get === 'function')) return out;
            var got = window.WR.SituationRoom.get(league, roster);
            var curr = snapshotFromState(got && got.state);
            if (!curr) return out;
            var leagueId = (got && got.state && got.state.leagueId) || null;
            curr._trade = recentLeagueTrade(league, roster, playersData);
            if (got && got.state) curr._needs = got.state.needs;
            var change = computeChange(loadSnapshot(leagueId), curr, playersData);
            out.material = change.material; out.line = change.line; out.eyes = !!change.eyes;
            out.curr = curr; out.leagueId = leagueId;
        } catch (_) { /* degrade to non-material */ }
        return out;
    }

    window.WR.BriefPulse = {
        loadSnapshot: loadSnapshot,
        saveSnapshot: saveSnapshot,
        snapshotFromState: snapshotFromState,
        computeChange: computeChange,
        recentLeagueTrade: recentLeagueTrade,
        readNow: readNow,
        Line: Line,
    };
})();
