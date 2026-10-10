// ══════════════════════════════════════════════════════════════════
// js/shared/ask-dhq.js — window.App.AskDHQ   (Lab only: window.DHQ_LAB)
// "Ask DHQ": ask a question in plain English, inside the app, and get an
// answer — with nobody paying for AI and nobody setting anything up.
//
// Owner direction 2026-10-09: members stay in the app and use THEIR OWN AI,
// at zero cost to DHQ. DHQ is never the assistant (owner ruling the same
// day): it supplies the data and its calls; the member's AI answers.
//   1. DHQ prepares the facts: the engine already in the page (values, the
//      lineup solver, the team assessor, the player-action chain, the trade
//      engine, game locks) works out the call and the numbers behind it.
//   2. The member's device AI answers with them. Chrome on desktop ships
//      Google's Gemini Nano built in (the Prompt API, free, on the device);
//      it answers using only DHQ's facts. iPhone (Apple Intelligence) and
//      Android (Gemini Nano) come with the native app; the member's ChatGPT
//      plan joins when OpenAI opens Sign in with ChatGPT to us.
//   3. No AI of theirs here: one tap asks their own ChatGPT or Claude, where
//      the Dynasty HQ connector supplies the same data.
// Nothing here calls a paid model and DHQ never writes the reply itself.
//
//   answer(question) → { intent, title, text, lines[], facts, players[] }
//   brain() → Promise<'device' | 'device-download' | 'engine'>
//   narrate(question, ans, onText) → Promise<string|null>   (device AI)
//   mount() — the floating "Ask DHQ" button + panel (Lab only)
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const S = () => root.S || {};
    const LI = () => App.LI || {};
    const round1 = n => Math.round((Number(n) || 0) * 10) / 10;
    const f1 = v => (v == null ? '—' : (Math.round(Number(v) * 10) / 10).toFixed(1));
    const norm = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

    // ── League facts ───────────────────────────────────────────────
    function pl(pid) { return (S().players || {})[pid] || {}; }
    function pname(pid) { const p = pl(pid); return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || String(pid); }
    function ppos(pid) { const p = pl(pid); return String((App.normPos && App.normPos(p.position)) || p.position || '').toUpperCase(); }
    function dhq(pid) { return Math.round(Number((LI().playerScores || {})[pid]) || 0); }
    function meta(pid) { return (LI().playerMeta || {})[pid] || {}; }
    function league() { const s = S(); return (s.leagues || []).find(l => String(l.league_id || l.id) === String(s.currentLeagueId)) || (s.leagues || [])[0] || null; }
    function rosters() { return S().rosters || []; }
    function myRoster() {
        const s = S(), rs = rosters();
        return rs.find(r => String(r.roster_id) === String(s.myRosterId)) || rs.find(r => String(r.owner_id) === String(s.myUserId)) || null;
    }
    function rosterOfPid(pid) { return rosters().find(r => (r.players || []).map(String).includes(String(pid))) || null; }
    function teamName(r) {
        if (!r) return 'free agent';
        const u = (S().leagueUsers || []).find(x => String(x.user_id) === String(r.owner_id));
        return (r.metadata && r.metadata.team_name) || (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || ('Team ' + r.roster_id);
    }
    function assessOf(rid) { try { return typeof root.assessTeamFromGlobal === 'function' ? root.assessTeamFromGlobal(rid) : null; } catch (e) { return null; } }
    function allAssess() { try { return typeof root.assessAllTeamsFromGlobal === 'function' ? (root.assessAllTeamsFromGlobal() || []) : []; } catch (e) { return []; } }
    const lock = pid => (App.GameLocks && App.GameLocks.state ? App.GameLocks.state(String(pid)) : null);
    const injury = pid => { const p = pl(pid); return p.injury_status ? p.injury_status + (p.injury_body_part ? ' (' + p.injury_body_part + ')' : '') : ''; };

    // This week's number for a player: actual points once his game has
    // started, otherwise DHQ's average week (what the Lineup screen picks
    // on), otherwise nothing (still loading, or nobody projects him).
    function weekPts(pid) {
        const g = lock(pid);
        if (g && g.locked) return { pts: round1(g.pts), kind: g.status === 'live' ? 'live' : 'final' };
        const DQ = App.DhqProj;
        if (DQ && DQ.get) {
            const r = DQ.get(String(pid));
            // Shown: his typical week, the number in Game Day's DHQ column.
            // Decided on: his average week, as Game Day's own call is.
            if (r) return { pts: round1(r.median != null ? r.median : r.mean), avg: round1(r.mean != null ? r.mean : r.median), kind: 'proj' };
        }
        return { pts: null, kind: 'none' };
    }

    // ── Reading the question ───────────────────────────────────────
    // Players named in it, in the order they appear: full names first,
    // then last names that are unique among this league's rostered
    // players (so "Sutton" finds Courtland Sutton on a roster).
    function findPlayers(q) {
        const text = ' ' + norm(q) + ' ';
        const hits = [];
        const seen = new Set();
        const add = (pid, at) => { if (!seen.has(pid)) { seen.add(pid); hits.push({ pid, at }); } };
        const rostered = new Set(rosters().flatMap(r => (r.players || []).map(String)));
        const valued = Object.keys(LI().playerScores || {});
        const pool = [...new Set([...rostered, ...valued])];
        for (const pid of pool) {
            const n = norm(pname(pid));
            if (n.length < 5 || !n.includes(' ')) continue;
            const at = text.indexOf(' ' + n + ' ');
            if (at >= 0) add(pid, at);
        }
        // A last name more than one rostered player shares ("Sutton": a WR
        // and a DB in an IDP league) goes to the member's own player first,
        // then the most valuable one (owner report 2026-10-09: the shared
        // name was dropped and the question got the wrong answer).
        const byLast = {};
        for (const pid of rostered) { const parts = norm(pname(pid)).split(' '); const last = parts[parts.length - 1]; if (last && last.length >= 3) (byLast[last] = byLast[last] || []).push(pid); }
        const mine = new Set(((myRoster() || {}).players || []).map(String));
        for (const last of Object.keys(byLast)) {
            const at = text.indexOf(' ' + last + ' ');
            if (at < 0 || hits.some(h => norm(pname(h.pid)).endsWith(' ' + last))) continue;
            const pick = [...byLast[last]].sort((a, b) => (mine.has(b) ? 1 : 0) - (mine.has(a) ? 1 : 0) || dhq(b) - dhq(a))[0];
            add(pick, at);
        }
        return hits.sort((a, b) => a.at - b.at).map(h => h.pid);
    }
    const POS_WORDS = { qb: 'QB', quarterback: 'QB', rb: 'RB', 'running back': 'RB', back: 'RB', wr: 'WR', receiver: 'WR', 'wide receiver': 'WR', te: 'TE', 'tight end': 'TE', k: 'K', kicker: 'K', dl: 'DL', edge: 'DL', lb: 'LB', linebacker: 'LB', db: 'DB', cornerback: 'DB', safety: 'DB', def: 'DEF', defense: 'DEF' };
    function findPos(q) {
        const t = ' ' + norm(q) + ' ';
        const keys = Object.keys(POS_WORDS).sort((a, b) => b.length - a.length);
        for (const k of keys) if (t.includes(' ' + k + ' ') || t.includes(' ' + k + 's ')) return POS_WORDS[k];
        return null;
    }
    function intentOf(q, players) {
        const t = norm(q);
        const has = re => re.test(t);
        if (has(/\b(waivers?|wire|pick ?ups?|picked up|free agents?|fa|adds?|faab|stream(ing|er)?|available|unrostered)\b/)) return 'waivers';
        if (has(/\btrade (with|partner|target)|who (should|can) i trade|trade targets?|who has\b|buy low on\b/) && players.length < 2) return 'targets';
        if (players.length >= 2 && has(/\b(for|trade|give|deal|offer)\b/) && !has(/\b(start|sit|play|bench|lineup)\b/)) return 'trade';
        if (has(/\b(start|sit|play|bench|lineup|flex|who should i (start|play))\b/)) return 'startsit';
        if (has(/\b(need|needs|weak|weakness|hole|holes|missing|improve|upgrade|fix my)\b/)) return 'needs';
        if (players.length >= 2 || has(/\b(compare|vs|versus|better)\b/)) return players.length >= 2 ? 'compare' : 'help';
        if (players.length === 1 || has(/\b(sell|buy|hold|keep|value|worth|outlook)\b/)) return players.length ? 'outlook' : 'help';
        if (has(/\b(team|roster|how am i|my squad)\b/)) return 'needs';
        return 'help';
    }

    // ── Answers (DHQ decides) ──────────────────────────────────────
    function startSit(q, players) {
        const me = myRoster(), lg = league();
        if (players.length >= 2) {
            const rows = players.slice(0, 4).map(pid => {
                const w = weekPts(pid), inj = injury(pid), g = lock(pid);
                const st = String(pl(pid).injury_status || '').toUpperCase();
                let why = null;
                if (g && g.status === 'bye') why = 'on bye';
                else if (/^(OUT|IR|PUP|SUS|NA|COV)$/.test(st)) why = 'ruled ' + pl(pid).injury_status;
                else if (st === 'DOUBTFUL' || st === 'D') why = 'doubtful (DHQ treats doubtful as out)';
                return { pid, name: pname(pid), pts: w.pts, avg: w.avg != null ? w.avg : w.pts, kind: w.kind, inj, why, locked: !!(g && g.locked), status: g ? g.label : '' };
            });
            const open = rows.filter(r => !r.locked && !r.why && r.pts != null).sort((a, b) => b.avg - a.avg);
            const locked = rows.filter(r => r.locked);
            const lines = rows.map(r => r.name + ': ' + (r.locked ? (r.kind === 'live' ? 'playing now, ' : 'already played, ') + f1(r.pts) + ' pts (locked)' : r.why ? 'can\'t start, ' + r.why : r.pts == null ? 'no projection yet' : f1(r.pts) + ' projected') + (r.inj && !r.why ? ' · ' + r.inj : ''));
            let text;
            if (!open.length) text = locked.length ? 'None of them can be moved now: ' + locked.map(r => r.name).join(' and ') + (locked.length > 1 ? ' have' : ' has') + ' already played.' : 'I can\'t make that call yet: DHQ has no projection for them this week.';
            else if (open.length === 1) text = 'Start ' + open[0].name + ' (' + open[0].pts + ' projected).' + (rows.filter(r => r !== open[0]).map(r => ' ' + r.name + (r.locked ? ' is locked, his game has started.' : r.why ? ' can\'t start: ' + r.why + '.' : ' has no projection.')).join(''));
            else {
                const a = open[0], b = open[1], gap = round1(a.pts - b.pts), edge = round1(a.avg - b.avg);
                text = edge < 0.5
                    ? 'Toss-up: ' + a.name + ' (' + f1(a.pts) + ') and ' + b.name + ' (' + f1(b.pts) + ') are within half a point. Go with the healthier player and the better news.'
                    : 'Start ' + a.name + ' over ' + b.name + ': ' + f1(a.pts) + ' vs ' + f1(b.pts) + ' projected' + (gap > 0 ? ' (+' + gap.toFixed(1) + ')' : '') + '.' + (a.inj ? ' Note ' + a.name + ' is ' + a.inj + '.' : '');
            }
            return { intent: 'startsit', title: 'Start / sit', text, lines, players: rows.map(r => r.pid), facts: { rows } };
        }
        const DQ = App.DhqProj;
        const chk = me && lg && DQ && DQ.lineupCheck ? DQ.lineupCheck(me, lg) : null;
        // "Should I start X?": is he in DHQ's best lineup?
        if (players.length === 1) {
            const pid = players[0], g = lock(pid), w = weekPts(pid), name = pname(pid);
            if (g && g.locked) return { intent: 'startsit', title: 'Start / sit', text: name + '\'s game has already started (' + f1(w.pts) + ' pts so far); he can\'t be moved now.', lines: [], players: [pid], facts: {} };
            if (!chk) return { intent: 'startsit', title: 'Start / sit', text: 'DHQ is still projecting this week; ask again in a few seconds.', lines: [], players: [pid], facts: {} };
            const inBest = chk.optimal.starters.some(x => String(x.pid) === String(pid));
            const slot = (chk.optimal.starters.find(x => String(x.pid) === String(pid)) || {}).slot;
            const ahead = chk.optimal.starters.filter(x => String(x.slot) !== '' && (pl(x.pid).fantasy_positions || [ppos(x.pid)]).some(q => (pl(pid).fantasy_positions || [ppos(pid)]).includes(q)) && String(x.pid) !== String(pid)).map(x => pname(x.pid) + ' (' + f1(weekPts(x.pid).pts) + ')');
            return {
                intent: 'startsit', title: 'Start / sit',
                text: inBest ? 'Yes, start ' + name + ': he\'s in DHQ\'s best lineup at ' + String(slot).replace('_', ' ') + ' (' + f1(w.pts) + ' projected).' : 'No, bench ' + name + ' (' + (w.pts == null ? 'no projection' : f1(w.pts) + ' projected') + '). DHQ starts ' + (ahead.slice(0, 3).join(', ') || 'others') + ' ahead of him.',
                lines: injury(pid) ? ['Injury: ' + injury(pid)] : [], players: [pid], facts: { inBest },
            };
        }
        // Named someone we couldn't find: say so instead of answering something else.
        if (/\bor\b|\bvs\b|\bover\b/.test(norm(q))) return { intent: 'startsit', title: 'Start / sit', text: 'I couldn\'t match those names to players in this league. Try full names, like "Chig Okonkwo or Courtland Sutton".', lines: [], players: [], facts: {} };
        if (!chk) return { intent: 'startsit', title: 'Your lineup', text: 'DHQ is still projecting this week. Open Game Day for the full lineup check, or ask me again in a few seconds.', lines: [], players: [], facts: {} };
        const d = chk.delta;
        if (d.isOptimal) return { intent: 'startsit', title: 'Your lineup', text: 'Start who you have in: your lineup is already DHQ\'s best (' + f1(d.currentTotal) + ' projected).', lines: [], players: [], facts: { total: d.currentTotal } };
        const ins = d.startInstead.map(x => pname(x.pid) + ' at ' + String(x.slot).replace('_', ' ') + ' (' + f1(weekPts(x.pid).pts) + ')');
        const outs = d.benchInstead.map(pid => pname(pid) + ' (' + f1(weekPts(pid).pts) + ')');
        return {
            intent: 'startsit', title: 'Your lineup',
            text: 'You\'re leaving ' + round1(d.optimalTotal - d.currentTotal).toFixed(1) + ' points on the bench. Start ' + ins[0] + (outs[0] ? ' instead of ' + outs[0] : '') + (ins.length > 1 ? ', and ' + (ins.length - 1) + ' more change' + (ins.length > 2 ? 's' : '') + '.' : '.'),
            lines: ins.map((x, i) => 'Start ' + x + (outs[i] ? ', sit ' + outs[i] : '')),
            players: d.startInstead.map(x => x.pid).concat(d.benchInstead), facts: { current: d.currentTotal, optimal: d.optimalTotal },
        };
    }
    function outlook(q, players) {
        const pid = players[0];
        const m = meta(pid), a = typeof App.getPlayerAction === 'function' ? App.getPlayerAction(pid) : null;
        const holder = rosterOfPid(pid), me = myRoster();
        const w = weekPts(pid);
        const label = a ? a.label : 'Hold';
        const lines = [
            'DHQ value ' + dhq(pid) + (m.ageCurvePhase ? ' · ' + m.ageCurvePhase.replace('_', ' ') + ' phase' : '') + (m.peakYrsLeft != null ? ' · ' + m.peakYrsLeft + ' peak year' + (m.peakYrsLeft === 1 ? '' : 's') + ' left' : ''),
            m.trend ? 'Production ' + (m.trend > 0 ? 'up ' : 'down ') + Math.abs(m.trend) + '% on last season' : null,
            w.pts != null ? (w.kind === 'proj' ? 'This week: ' + f1(w.pts) + ' projected' : 'This week: ' + f1(w.pts) + ' pts (' + (w.kind === 'live' ? 'playing now' : 'final') + ')') : null,
            injury(pid) ? 'Injury: ' + injury(pid) : null,
            'Rostered by ' + (holder ? teamName(holder) + (me && holder.roster_id === me.roster_id ? ' (you)' : '') : 'nobody: free agent'),
        ].filter(Boolean);
        return { intent: 'outlook', title: pname(pid), text: label + ': ' + (a ? a.reason : 'no strong signal either way.'), lines, players: [pid], facts: { action: a, value: dhq(pid), meta: { peak: m.peakYrsLeft, trend: m.trend, phase: m.ageCurvePhase } } };
    }
    function compare(q, players) {
        const ids = players.slice(0, 4);
        const rows = ids.map(pid => ({ pid, name: pname(pid), value: dhq(pid), peak: Number(meta(pid).peakYrsLeft || 0), age: pl(pid).age, week: weekPts(pid).pts }));
        const byV = [...rows].sort((a, b) => b.value - a.value);
        const a = byV[0], b = byV[1];
        const gap = a.value ? Math.round((a.value - b.value) / a.value * 100) : 0;
        let text;
        if (gap >= 10) text = a.name + ' is the better dynasty asset: DHQ ' + a.value + ' vs ' + b.value + ' (' + gap + '% gap)' + (b.peak - a.peak >= 2 ? ', though ' + b.name + ' has the longer runway (' + b.peak + ' vs ' + a.peak + ' peak years).' : '.');
        else if (Math.abs(a.peak - b.peak) >= 2) { const l = a.peak > b.peak ? a : b; text = 'Close on value (DHQ ' + a.value + ' vs ' + b.value + '); ' + l.name + ' has the longer runway (' + l.peak + ' peak years), which tips it.'; }
        else text = 'Too close to call on dynasty value (DHQ ' + a.value + ' vs ' + b.value + '). For this week, ask who to start; for a trade, the one who fills your need wins.';
        const lines = rows.map(r => r.name + ': DHQ ' + r.value + ' · ' + (r.peak > 0 ? r.peak + ' peak yr' + (r.peak === 1 ? '' : 's') + ' left' : 'past his peak years') + ' · age ' + (r.age || '?') + (r.week != null ? ' · this week ' + Number(r.week).toFixed(1) : ''));
        return { intent: 'compare', title: 'Compare', text, lines, players: ids, facts: { rows } };
    }
    function needs() {
        const me = myRoster(); const a = me ? assessOf(me.roster_id) : null;
        if (!a) return { intent: 'needs', title: 'Your team', text: 'DHQ is still reading your league. Ask again in a moment.', lines: [], players: [], facts: {} };
        const need = (a.needs || []).map(n => n.pos + ' (' + n.urgency + ')');
        const word = x => x.status === 'deficit' ? 'hole' : x.status === 'thin' ? 'thin' : x.status === 'surplus' && x.nflStarters > x.minQuality ? 'surplus' : 'covered';
        const lines = Object.entries(a.posAssessment || {}).filter(([, x]) => word(x) !== 'covered').map(([pos, x]) => pos + ': ' + word(x) + ' · ' + x.nflStarters + ' quality starter' + (x.nflStarters === 1 ? '' : 's') + ' for ' + x.minQuality + ' lineup spot' + (x.minQuality === 1 ? '' : 's'));
        const win = a.window === 'CONTENDING' ? 'You\'re contending: spend picks and youth for starters who score now.' : a.window === 'REBUILDING' ? 'You\'re rebuilding: sell veterans near the end of their peak for picks and young players.' : 'You\'re in between: pick a lane before the deadline.';
        const text = (need.length ? 'Your holes: ' + need.join(', ') + '.' : 'No real holes: every position is covered.') + ((a.strengths || []).length ? ' Trade from your surplus at ' + a.strengths.join(', ') + '.' : '') + ' ' + win;
        return { intent: 'needs', title: teamName(me) + ' · ' + String(a.tier || '').toLowerCase(), text, lines, players: [], facts: { tier: a.tier, window: a.window, needs: need, strengths: a.strengths, health: a.healthScore } };
    }
    function trade(q, players) {
        const TE = App.TradeEngine, me = myRoster();
        const t = ' ' + norm(q) + ' ';
        // "X for Y" / "give X get Y": players before the split are what you give.
        const split = Math.max(t.indexOf(' for '), t.indexOf(' get '), t.indexOf(' receive '));
        const give = [], get = [];
        players.forEach(pid => {
            const n = norm(pname(pid)), last = n.split(' ').pop();
            const at = t.indexOf(' ' + n + ' ') >= 0 ? t.indexOf(' ' + n + ' ') : t.indexOf(' ' + last + ' ');
            const mine = me && (me.players || []).map(String).includes(String(pid));
            if (split > 0 ? at < split : mine) give.push(pid); else get.push(pid);
        });
        if (!give.length || !get.length) return { intent: 'trade', title: 'Trade', text: 'Tell me both sides, like "Jonathan Taylor for Puka Nacua".', lines: [], players, facts: {} };
        const tg = give.reduce((s, p) => s + dhq(p), 0), tt = get.reduce((s, p) => s + dhq(p), 0);
        const fair = TE && TE.fairnessGrade ? TE.fairnessGrade(tg, tt) : null;
        const partner = rosterOfPid(get[0]);
        const mineA = me ? assessOf(me.roster_id) : null, theirA = partner ? assessOf(partner.roster_id) : null;
        let accept = null, posture = null, taxes = [];
        try {
            const dna = partner && typeof root.computeWeightedDNA === 'function' ? root.computeWeightedDNA(partner.roster_id) : null;
            const key = dna && dna.key ? dna.key : 'NONE';
            if (TE && mineA && theirA) {
                posture = TE.calcOwnerPosture(theirA, key);
                taxes = TE.calcPsychTaxes(mineA, theirA, key, posture) || [];
                accept = TE.calcAcceptanceLikelihood(tg, tt, key, taxes, mineA, theirA, { totalPieces: give.length + get.length });
            }
        } catch (e) { /* acceptance is a bonus */ }
        const text = (fair ? fair.grade + ' (' + fair.label + ')' : 'Graded') + ': you give DHQ ' + tg + ', you get ' + tt + ' (' + (tt - tg >= 0 ? '+' : '') + (tt - tg) + ' for you).' + (accept != null ? ' About ' + accept + '% chance ' + (partner ? teamName(partner) : 'they') + ' says yes.' : '');
        const PLAIN = { 'Endowment Effect': 'they value their own players more than the market does', 'Panic Premium': 'they are hurting and more willing to deal', 'Status Tax': 'they hate losing a trade', 'Loss Aversion': 'they fear giving up value', 'Rebuilding Discount': 'they like selling for futures', 'Need Fulfillment': 'you fill a position they need', 'Window Alignment': 'your windows fit (one buying now, one building)', 'Window Friction': 'you are both chasing the same window', 'Locked Roster Tax': 'their roster is set and they rarely move', 'Seller Momentum': 'they are in selling mode' };
        const lines = give.map(p => 'You give ' + pname(p) + ' · DHQ ' + dhq(p)).concat(get.map(p => 'You get ' + pname(p) + ' · DHQ ' + dhq(p)), taxes.slice(0, 3).map(x => (x.impact > 0 ? 'Helps: ' : 'Hurts: ') + (PLAIN[x.name] || String(x.name).toLowerCase())));
        return { intent: 'trade', title: 'Trade grade', text, lines, players: give.concat(get), facts: { give: tg, get: tt, fair, accept } };
    }
    function targets(q) {
        const me = myRoster(), mine = me ? assessOf(me.roster_id) : null, TE = App.TradeEngine;
        if (!mine) return { intent: 'targets', title: 'Trade targets', text: 'DHQ is still reading your league. Ask again in a moment.', lines: [], players: [], facts: {} };
        const want = findPos(q) ? [findPos(q)] : (mine.needs || []).map(n => n.pos);
        if (!want.length && (mine.strengths || []).length) return sellTargets(me, mine);
        const list = allAssess().filter(a => String(a.rosterId) !== String(me.roster_id)).map(a => {
            const fit = TE && TE.calcComplementarity ? Number(TE.calcComplementarity(mine, a)) || 0 : 0;
            const hits = want.flatMap(pos => (((a.posAssessment || {})[pos] || {}).sortedIds || []).filter(pid => dhq(pid) >= (/^(DL|LB|DB|K|DEF)$/.test(pos) ? 500 : 2000)).slice(0, 1));
            const lane = (mine.window === 'CONTENDING' && a.window === 'REBUILDING') || (mine.window === 'REBUILDING' && a.window === 'CONTENDING');
            return { a, fit: fit + (lane ? 14 : 0) + hits.length * 10, hits, lane };
        }).filter(x => x.hits.length).sort((x, y) => y.fit - x.fit).slice(0, 3);
        if (!list.length) return { intent: 'targets', title: 'Trade targets', text: 'Nobody in your league has a surplus at ' + (want.join(' or ') || 'your need spots') + ' worth chasing right now.', lines: [], players: [], facts: {} };
        const lines = list.map(x => x.a.teamName + ': ' + x.hits.map(p => pname(p) + ' (' + ppos(p) + ', DHQ ' + dhq(p) + ')').join(', ') + (x.lane ? ' · your windows line up' : '') + ' · they need ' + ((x.a.needs || []).map(n => n.pos).join(', ') || 'little'));
        const top = list[0];
        const text = 'Call ' + top.a.teamName + ' first: they have ' + top.hits.map(pname).join(' and ') + ' and they need ' + (((top.a.needs || []).map(n => n.pos)).join(', ') || 'depth') + '. ' + ((mine.strengths || []).length ? 'Pay from your ' + mine.strengths.join('/') + ' surplus.' : mine.window === 'CONTENDING' ? 'Pay with future picks.' : 'Ask for picks and youth back.');
        return { intent: 'targets', title: 'Trade targets', text, lines, players: list.flatMap(x => x.hits), facts: { want } };
    }
    // No holes to fill: who needs what you have too much of.
    function sellTargets(me, mine) {
        const list = allAssess().filter(a => String(a.rosterId) !== String(me.roster_id)).map(a => {
            const wants = (a.needs || []).map(n => n.pos).filter(p => (mine.strengths || []).includes(p));
            const lane = (mine.window === 'CONTENDING' && a.window === 'REBUILDING') || (mine.window === 'REBUILDING' && a.window === 'CONTENDING');
            return { a, wants, score: wants.length * 10 + (lane ? 14 : 0) + Number(a.panic || 0) * 2 };
        }).filter(x => x.wants.length).sort((x, y) => y.score - x.score).slice(0, 3);
        const extra = pos => { const x = (mine.posAssessment || {})[pos] || {}; return (x.sortedIds || []).slice(Math.max(1, x.minQuality || 1)).slice(0, 2); };
        if (!list.length) return { intent: 'targets', title: 'Trade targets', text: 'You have no holes, and nobody in your league needs what you have extra of right now. Hold, and check back after injuries shake things up.', lines: [], players: [], facts: {} };
        const lines = list.map(x => x.a.teamName + ' needs ' + x.wants.join(', ') + ': offer ' + x.wants.flatMap(extra).map(p => pname(p) + ' (DHQ ' + dhq(p) + ')').join(', '));
        const top = list[0];
        return { intent: 'targets', title: 'Sell your surplus', text: 'You have no holes, so sell from strength. ' + top.a.teamName + ' needs ' + top.wants.join(' and ') + ', where you have extra. ' + (mine.window === 'CONTENDING' ? 'Ask for a starter-level upgrade elsewhere or future picks.' : 'Ask for picks and young players.'), lines, players: list.flatMap(x => x.wants.flatMap(extra)), facts: {} };
    }
    function waivers(q) {
        const pos = findPos(q);
        const me = myRoster(), mine = me ? assessOf(me.roster_id) : null;
        const want = pos ? [pos] : (mine && mine.needs || []).map(n => n.pos).slice(0, 2);
        const rostered = new Set(rosters().flatMap(r => (r.players || []).map(String)));
        const pool = Object.keys(LI().playerScores || {}).filter(pid => !rostered.has(pid) && pl(pid).team && (!want.length || want.includes(ppos(pid)) || (pl(pid).fantasy_positions || []).some(x => want.includes(String(x).toUpperCase()))))
            .sort((a, b) => dhq(b) - dhq(a)).slice(0, 5);
        if (!pool.length) return { intent: 'waivers', title: 'Waivers', text: 'Nothing worth a claim at ' + (want.join('/') || 'that spot') + ' right now.', lines: [], players: [], facts: {} };
        const lines = pool.map(pid => { const w = weekPts(pid); return pname(pid) + ' · ' + ppos(pid) + ' ' + (pl(pid).team || 'FA') + ' · DHQ ' + dhq(pid) + (w.pts != null && w.kind === 'proj' ? ' · ' + f1(w.pts) + ' this week' : '') + (injury(pid) ? ' · ' + injury(pid) : ''); });
        const text = 'Best available' + (want.length ? ' at ' + want.join('/') : '') + ': ' + pname(pool[0]) + ' (DHQ ' + dhq(pool[0]) + ').' + (mine && mine.faabRemaining != null ? ' You have $' + mine.faabRemaining + ' FAAB left; Free Agency has the bid model.' : '');
        return { intent: 'waivers', title: 'Waivers', text, lines, players: pool, facts: { want } };
    }
    function help(unmatched) {
        return {
            intent: 'help', title: 'Ask your AI', unmatched: !!unmatched,
            text: unmatched ? 'I couldn\'t tie that to one of DHQ\'s calls yet. Name the players, or tap one of these:' : 'Ask about your league in plain English. Your own AI answers, using DHQ\'s data and calls.',
            lines: ['Who should I start, Sutton or Okonkwo?', 'What does my team need?', 'Who should I trade with?', 'Jonathan Taylor for Puka Nacua?', 'Should I sell Derrick Henry?', 'Best waiver RB?'],
            players: [], facts: {},
        };
    }
    function answer(question) {
        const q = String(question || '').trim();
        if (!q || !rosters().length) return help();
        const players = findPlayers(q);
        const intent = intentOf(q, players);
        try {
            switch (intent) {
                case 'startsit': return startSit(q, players);
                case 'outlook': return outlook(q, players);
                case 'compare': return compare(q, players);
                case 'needs': return needs();
                case 'trade': return trade(q, players);
                case 'targets': return targets(q);
                case 'waivers': return waivers(q);
            }
        } catch (e) { if (root.wrLog) root.wrLog('askdhq.answer', e); }
        return help(true);
    }

    // ── The member's own AI ─────────────────────────────────────────
    // Chrome's built-in Gemini Nano (free, on the device). 'device' when
    // ready now, 'device-download' when Chrome can fetch it on first use,
    // 'engine' when this browser has none (DHQ's own words are shown).
    let _brain = null;
    function brain() {
        if (_brain) return _brain;
        if (savedKey()) return (_brain = Promise.resolve('key'));
        const LM = root.LanguageModel;
        _brain = !LM || typeof LM.availability !== 'function' ? Promise.resolve('engine')
            : LM.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] })
                .then(a => (a === 'available' ? 'device' : a === 'downloadable' || a === 'downloading' ? 'device-download' : 'engine'))
                .catch(() => 'engine');
        return _brain;
    }
    const SYSTEM = 'You are a sharp, friendly fantasy football GM. You are given a question and the recommendation with its facts. Answer in two to four plain sentences, as a GM talking to a friend, stating the recommendation as your own. Lead with the answer. Never mention DHQ, Dynasty HQ, "the call" or where the facts came from. Use ONLY the facts given: never add a player, number, injury or news that is not in them, and never change the recommendation. No lists, no headings.';
    let _session = null;
    async function narrate(question, ans, onText, onProgress) {
        if (!ans || ans.intent === 'help') return null;
        const LM = root.LanguageModel;
        if (!LM) return null;
        try {
            if (!_session) {
                _session = await LM.create({
                    initialPrompts: [{ role: 'system', content: SYSTEM }],
                    expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }],
                    monitor(m) { m.addEventListener('downloadprogress', e => { if (onProgress) onProgress(e.loaded); }); },
                });
            }
            const s = await _session.clone();
            const prompt = ('Question: ' + question + '\nRecommendation: ' + ans.text + '\nFacts:\n- ' + (ans.lines || []).join('\n- ')).replace(/\bDHQ\b(?!')/g, 'value').replace(/\bDHQ's\s*/g, '');
            let out = '';
            const stream = s.promptStreaming(prompt);
            for await (const chunk of stream) {
                // Older Chrome builds stream the whole text so far; newer ones stream pieces.
                out = chunk.startsWith(out) ? chunk : out + chunk;
                if (onText) onText(out);
            }
            if (s.destroy) s.destroy();
            return out.trim() || null;
        } catch (e) {
            if (root.wrLog) root.wrLog('askdhq.narrate', e);
            return null;
        }
    }
    // ── The member's own AI key ─────────────────────────────────────
    // Pasted once, kept on this device only (localStorage), sent only to
    // the AI company it belongs to, never to DHQ. The company is read from
    // the key itself. Owner ask 2026-10-09: "bring his own AI into the app
    // with a key, so the questions get asked in the app".
    const KEY_NAME = 'dynastyhq_ai_key', PROVIDER_NAME = 'dynastyhq_ai_provider';
    const PROVIDERS = {
        openai: { label: 'OpenAI', model: 'gpt-5.4-mini' },
        anthropic: { label: 'Claude', model: 'claude-haiku-5-5' },
        gemini: { label: 'Gemini', model: 'gemini-flash-latest' },
    };
    // Owner test 2026-10-09: a fresh Google AI Studio key was refused as
    // "doesn't look like a key". Key formats change; read the company from
    // the prefix when there is one, treat any other key-shaped string as
    // Google's (the free one), and let the live check on Save decide.
    const cleanKey = key => String(key || '').replace(/\s+/g, '');
    function providerOf(key) {
        const k = cleanKey(key);
        if (k.length < 20 || !/^[\x21-\x7e]+$/.test(k)) return null;
        if (/^sk-ant-/.test(k)) return 'anthropic';
        if (/^sk-/.test(k)) return 'openai';
        return 'gemini';
    }
    // One cheap read with the key: does its company accept it?
    // → 'ok' | 'bad' | 'unknown' (offline or blocked: keep the key).
    async function checkKey(key, prov) {
        const k = cleanKey(key);
        try {
            const r = prov === 'anthropic' ? await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } })
                : prov === 'openai' ? await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + k } })
                : await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': k } });
            if (r.ok) return 'ok';
            return r.status === 400 || r.status === 401 || r.status === 403 ? 'bad' : 'unknown';
        } catch (e) { return 'unknown'; }
    }
    // Owner report 2026-10-09: the saved key vanished after an hour. The old
    // dynastyhq_ai_key is a "device secret" the shared client wipes whenever
    // it can't tell who is signed in for a moment. The member's key now has
    // its own record, tied to their account: only they can use it, and
    // session blips leave it alone. Owner ask 2026-10-09: it also stays
    // through sign-out, so signing back in finds it; "Remove my key" (🔑)
    // takes it off the device. Anyone else signing in here can't use it.
    const MEMBER_KEY = 'dhq_member_ai_v1';
    function ownerNow() {
        try { const idn = root.OD && root.OD.identity; return idn && idn.currentOwner ? String(idn.currentOwner() || '') : ''; } catch (e) { return ''; }
    }
    function savedKey() {
        try {
            const owner = ownerNow();
            const rec = JSON.parse(root.localStorage.getItem(MEMBER_KEY) || 'null');
            if (rec && rec.key && PROVIDERS[rec.provider] && rec.owner === owner) return { key: rec.key, provider: rec.provider };
            // A key saved by an older build or the sign-up page moves over.
            const key = root.localStorage.getItem(KEY_NAME) || '';
            const prov = root.localStorage.getItem(PROVIDER_NAME) || providerOf(key);
            if (key && PROVIDERS[prov] && owner !== 'guest') { writeKey(key, prov); return { key: cleanKey(key), provider: prov }; }
            return null;
        } catch (e) { return null; }
    }
    function writeKey(key, prov) {
        root.localStorage.setItem(MEMBER_KEY, JSON.stringify({ key: cleanKey(key), provider: prov, owner: ownerNow(), at: Date.now() }));
        try { root.localStorage.removeItem(KEY_NAME); root.localStorage.removeItem(PROVIDER_NAME); } catch (e) { /* old copy */ }
    }
    function saveKey(key) {
        const prov = providerOf(key);
        if (!prov) return null;
        try { writeKey(key, prov); } catch (e) { return null; }
        _brain = null;
        keyChanged();
        return prov;
    }
    function forgetKey() { try { [MEMBER_KEY, KEY_NAME, PROVIDER_NAME].forEach(k => root.localStorage.removeItem(k)); } catch (e) { /* nothing saved */ } _brain = null; keyChanged(); }
    // The leagues page hides its "New: Ask your AI" card once a key is in.
    function keyChanged() { try { if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent('dhq:ai-key-changed')); } catch (e) { /* no listeners */ } }
    // ── The member's own AI, with tools (owner ruling 2026-10-10) ──────
    // No pre-built bundle of facts and no pre-decided answer: the AI reads
    // the question, looks up what it needs through App.AskTools (the app's
    // own data: rosters, matchups, standings, schedule, history, trades,
    // waivers, values, news) and searches the web for anything else, as
    // many steps as it needs, then answers in its own words.
    const PERSONA = [
        'You are the member\'s own fantasy football sidekick, living inside their league app. You know ball and you are fun to talk to: sharp, quick, a little funny, honest. Think the smartest friend in their league chat. Light trash talk about rivals is fine; never at the member\'s expense. When they\'re about to get fleeced, say so.',
        'Talk like a person, not a report: answer first, then the why with the key numbers. Short paragraphs; a quick list only when it really helps. Match the question: a quick question gets a quick answer, a big one gets depth. Follow-ups are welcome.',
        'Facts come from your tools. For anything about this league (rosters, lineups, matchups, standings, schedule, playoff odds, history, champions, trades, waivers, FAAB, draft picks, owners, player values and projections, linked news) call the tools, as many as you need, and chain them (look up the opponent, then their roster, then the waiver wire). Never guess a player, number, score, record or roster: if no tool or search told you, you don\'t know it, and you say so in a sentence.',
        'For the NFL beyond this league (breaking news, injuries, depth charts, coaching, trades, schedules) use web search when you have it and name the outlet in a few words.',
        'Never tell the member to check another app or site or to paste anything in: look it up. You can\'t make moves for them; tell them exactly what to do.',
        'The league\'s trade block (what owners listed in Sleeper) is a lookup: use it for anything about who\'s for sale, and check it before suggesting a trade, since a listed player is easier to get. Pending trade offers and league chat are private to Sleeper; if asked, say so in one short line and give the closest real answer (the trade block, likely sellers from the trade-partner, team and owner lookups).',
        'Two kinds of numbers: "value" is long-term dynasty trade value (about 7,000+ elite, 3,000+ solid starter, under 1,000 depth); this week\'s projections and points are for lineup calls. Don\'t mix them. A player whose game has started is locked.',
        'Think like a real dynasty GM, not a calculator (owner ruling 2026-10-10). Every trade has two owners, and a deal only happens if it makes sense for THEM. Before you suggest or price any trade: look up the other owner (owner profile: what they\'re doing right now and why, from their record, this season\'s trades and their trade block) and their team, then grade the deal and read partner_view. Build the offer around what that owner wants:',
        '- A rebuilding owner (losing, selling veterans for picks, starters on the block) wants draft picks and young, rising players. Veterans past their peak (RB about 27+, WR 29+, TE 30+, QB 33+) are close to worthless to them however well they score this week; never build an offer to a rebuilder out of them. Lead with picks and youth, and remember a seller usually takes less than full value for the veterans they listed.\n- A contending owner wants proven starters who score now and help at their weak spots; picks and long-term projects matter less to them, and they\'ll pay for a veteran who wins games.\n- Value totals that match are not a deal. If what they get isn\'t what they want, say so plainly and rebuild the offer. Use the member\'s own window too: a contender buying from a rebuilder pays in picks and youth they can spare.',
        'Quality over quantity: two or three lesser pieces never buy one star. An owner listing a young starter wants one real headline piece back: a 1st-round pick, or a young player close to his value. A young, front-line starting QB costs a 1st-round pick at minimum, more in superflex and 2QB leagues. Lead every offer for a young starter with that headliner, then balance with smaller pieces (grade the deal and read its headliner check). Only offer picks and players the member actually owns: check their picks (draft lookup) before naming one, and remember a rebuilder values a pick next year more than one three years out.',
                'Be right before you\'re clever: never state a player, number, roster spot, age or projection a lookup didn\'t give you in this conversation; look it up first. If you notice you got something wrong, say so and correct it.',
        'Don\'t mention tools, DHQ, "the data" or how you looked things up. Just answer.',
    ].join('\n\n');
    function header() {
        const lg = league(), me = myRoster(), H = App.AskTools && App.AskTools.h;
        const wk = H ? H.week() : 0;
        let today = ''; try { today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); } catch (e) { /* plain */ }
        return 'Today is ' + today + '. League: ' + ((lg && lg.name) || 'unknown') + ' (' + ((H && H.platform()) || 'sleeper') + ', season ' + ((H && H.season()) || '?') + ', NFL week ' + (wk || '?') + ', ' + rosters().length + ' teams). The member is ' + (me ? teamName(me) : 'not on a team here') + '.';
    }
    const TOOL_WORDS = { get_team: 'roster', get_matchup: 'matchup', get_lineup_advice: 'lineup', get_league_info: 'league rules', get_standings: 'standings', get_schedule: 'schedule', get_playoff_odds: 'playoff odds', get_league_history: 'league history', get_head_to_head: 'head-to-head', get_player: 'player', compare_players: 'players', search_players: 'player rankings', get_waiver_report: 'waiver wire', get_waiver_bid: 'FAAB', get_news: 'news', get_transactions: 'transactions', evaluate_trade: 'trade', find_trade_partners: 'trade partners', get_owner_profile: 'owner', get_draft_info: 'draft', get_luck: 'luck', get_trade_block: 'trade block' };
    const MAX_STEPS = 8;
    const clip = o => { let s = ''; try { s = JSON.stringify(o); } catch (e) { s = '{"error":"unreadable"}'; } return s.length > 24000 ? s.slice(0, 24000) + '…(trimmed)' : s; };
    const chat = [];
    const CHAT_TURNS = 6;
    async function askWithKey(question, onStep) {
        const k = savedKey();
        if (!k) return { ok: false, error: 'no key' };
        const lid = String(S().currentLeagueId || '');
        if (chat.league !== lid) { chat.length = 0; chat.league = lid; }
        const T = App.AskTools;
        const defs = T ? T.defs() : [];
        const system = PERSONA + '\n\n' + header();
        const model = PROVIDERS[k.provider].model;
        const ctl = root.AbortController ? new root.AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), 120000) : null;
        const signal = ctl && ctl.signal;
        const used = [];
        let sources = [], noSearch = false;
        const step = name => { used.push(name); if (onStep) onStep(TOOL_WORDS[name] || name.replace(/^get_/, '').replace(/_/g, ' ')); };
        const runTool = async (name, args) => { step(name); return T ? T.run(name, args) : { error: 'Lookups are not available.' }; };
        const fail = (r, j) => {
            const detail = (j && j.error && (j.error.message || (typeof j.error === 'string' ? j.error : ''))) || '';
            // Owner test 2026-10-09: only a 401 means the key itself is bad.
            if (r.status === 401) return { ok: false, badKey: true, error: PROVIDERS[k.provider].label + ' turned that key down' + (detail ? ' (' + String(detail).slice(0, 160) + ')' : '') + '. Paste a new one and your question is asked again.' };
            return { ok: false, retry: r.status === 429 || r.status >= 500, error: (r.status === 429 ? PROVIDERS[k.provider].label + ' says this key is out of quota or busy right now' : PROVIDERS[k.provider].label + ' had a problem (' + r.status + ')') + (detail ? ': ' + String(detail).slice(0, 200) : '') + '.' };
        };
        const post = (url, headers, body) => fetch(url, { method: 'POST', signal, headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });
        let text = '';
        try {
            if (k.provider === 'anthropic') {
                const H = { 'x-api-key': k.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
                const tools = defs.map(d => ({ name: d.name, description: d.description, input_schema: d.parameters }));
                const search = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
                const messages = chat.flatMap(t => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.a }]).concat([{ role: 'user', content: question }]);
                let withSearch = true;
                for (let i = 0; i <= MAX_STEPS; i++) {
                    const body = { model, max_tokens: 4000, output_config: { effort: 'low' }, system, messages, tools: withSearch ? tools.concat(search) : tools };
                    if (i === MAX_STEPS) delete body.tools;   // last round: answer with what you have
                    let r = await post('https://api.anthropic.com/v1/messages', H, body);
                    let j = await r.json().catch(() => ({}));
                    // Web search not allowed on this account: carry on without it.
                    if (!r.ok && r.status === 400 && withSearch && /web.?search|tool/i.test(JSON.stringify(j))) { withSearch = false; noSearch = true; i--; continue; }
                    if (!r.ok) return fail(r, j);
                    const blocks = j.content || [];
                    blocks.forEach(c => { if (c.type === 'web_search_tool_result' && Array.isArray(c.content)) c.content.forEach(x => x.url && sources.push({ url: x.url, title: x.title })); if (c.type === 'server_tool_use') step('web search'); });
                    messages.push({ role: 'assistant', content: blocks });
                    if (j.stop_reason === 'pause_turn') continue;
                    const calls = blocks.filter(c => c.type === 'tool_use');
                    if (j.stop_reason !== 'tool_use' || !calls.length) { text = blocks.filter(c => c.type === 'text').map(c => c.text || '').join(''); break; }
                    const results = await Promise.all(calls.map(async c => ({ type: 'tool_result', tool_use_id: c.id, content: clip(await runTool(c.name, c.input)) })));
                    messages.push({ role: 'user', content: results });
                }
            } else if (k.provider === 'gemini') {
                // Gemini can't mix Google Search with app lookups in one call,
                // so its web search is offered as one of the lookups.
                const decl = defs.map(d => ({ name: d.name, description: d.description, parameters: d.parameters }));
                decl.push({ name: 'web_search', description: 'Search the web for current NFL news, injuries, coaching, depth charts or anything outside this league.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } });
                const contents = chat.flatMap(t => [{ role: 'user', parts: [{ text: t.q }] }, { role: 'model', parts: [{ text: t.a }] }]).concat([{ role: 'user', parts: [{ text: question }] }]);
                const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
                const H = { 'x-goog-api-key': k.key };
                const googleSearch = async q => {
                    step('web search');
                    const r = await post(url, H, { contents: [{ role: 'user', parts: [{ text: 'Search the web and summarize the most recent, relevant facts with outlet names and dates: ' + q }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 1500 } });
                    const j = await r.json().catch(() => ({}));
                    const cand = (j.candidates || [])[0] || {};
                    (((cand.groundingMetadata || {}).groundingChunks) || []).forEach(g => g.web && g.web.uri && sources.push({ url: g.web.uri, title: g.web.title }));
                    return r.ok ? { summary: ((cand.content || {}).parts || []).map(p => p.text || '').join('') } : { error: 'search unavailable' };
                };
                for (let i = 0; i <= MAX_STEPS; i++) {
                    const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 4000 } };
                    if (i < MAX_STEPS) body.tools = [{ functionDeclarations: decl }];
                    const r = await post(url, H, body);
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok) return fail(r, j);
                    const content = ((j.candidates || [])[0] || {}).content || { role: 'model', parts: [] };
                    const parts = content.parts || [];
                    contents.push({ role: 'model', parts });
                    const calls = parts.filter(p => p.functionCall);
                    if (!calls.length) { text = parts.map(p => p.text || '').join(''); break; }
                    const replies = await Promise.all(calls.map(async p => ({ functionResponse: { name: p.functionCall.name, response: { result: p.functionCall.name === 'web_search' ? await googleSearch((p.functionCall.args || {}).query || '') : JSON.parse(clip(await runTool(p.functionCall.name, p.functionCall.args || {}))) } } })));
                    contents.push({ role: 'user', parts: replies });
                }
            } else {
                const H = { Authorization: 'Bearer ' + k.key };
                const tools = defs.map(d => ({ type: 'function', name: d.name, description: d.description, parameters: d.parameters }));
                let input = chat.flatMap(t => [{ role: 'user', content: t.q }, { role: 'assistant', content: t.a }]).concat([{ role: 'user', content: question }]);
                let prev = null, withSearch = true;
                for (let i = 0; i <= MAX_STEPS; i++) {
                    const body = { model, instructions: system, input, max_output_tokens: 4000 };
                    if (prev) body.previous_response_id = prev;
                    if (i < MAX_STEPS) body.tools = withSearch ? tools.concat([{ type: 'web_search' }]) : tools;
                    const r = await post('https://api.openai.com/v1/responses', H, body);
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok && r.status === 400 && withSearch && /web_search/i.test(JSON.stringify(j))) { withSearch = false; noSearch = true; i--; continue; }
                    if (!r.ok) return fail(r, j);
                    const out = j.output || [];
                    out.forEach(o => { if (o.type === 'web_search_call') step('web search'); (o.content || []).forEach(c => (c.annotations || []).forEach(a => a.url && sources.push({ url: a.url, title: a.title }))); });
                    const calls = out.filter(o => o.type === 'function_call');
                    if (!calls.length) { text = typeof j.output_text === 'string' && j.output_text ? j.output_text : out.flatMap(o => (o.content || []).filter(c => c.type === 'output_text').map(c => c.text || '')).join(''); break; }
                    prev = j.id;
                    input = await Promise.all(calls.map(async c => { let args = {}; try { args = JSON.parse(c.arguments || '{}'); } catch (e) { /* none */ } return { type: 'function_call_output', call_id: c.call_id, output: clip(await runTool(c.name, args)) }; }));
                }
            }
        } catch (e) {
            return { ok: false, retry: true, error: 'Couldn\'t reach ' + PROVIDERS[k.provider].label + '. Check your connection.' };
        } finally { if (timer) clearTimeout(timer); }
        const seen = new Set();
        sources = sources.filter(x => { const key = String(x.url).split('#')[0]; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 4);
        text = String(text || '').trim();
        if (!text) return { ok: false, error: PROVIDERS[k.provider].label + ' sent back an empty answer.' };
        chat.push({ q: question, a: text }); if (chat.length > CHAT_TURNS) chat.shift();
        return { ok: true, text, provider: k.provider, sources, noSearch, used };
    }

    // The question, sent to the member's own AI with DHQ connected.
    function askElsewhereUrl(where, question) {
        const lg = league();
        const q = 'Using my Dynasty HQ connector' + (lg && lg.name ? ', in my league "' + lg.name + '"' : '') + ': ' + question;
        return where === 'claude' ? 'https://claude.ai/new?q=' + encodeURIComponent(q) : 'https://chatgpt.com/?q=' + encodeURIComponent(q);
    }

    // ── The panel (Lab only) ──────────────────────────────────────
    const CSS = [
        '.askdhq-btn{position:fixed;right:16px;bottom:64px;z-index:2147482990;display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border:1px solid rgba(212,175,55,.55);border-radius:999px;background:var(--off-black,#1B1B22);color:var(--gold,#D4AF37);font:700 .8rem/1 system-ui,-apple-system,sans-serif;letter-spacing:.04em;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.45)}',
        '.askdhq-btn:hover{background:#24242c}',
        // In the top bar's open middle (owner ask 2026-10-10): bigger, no float.
        '.askdhq-btn.askdhq-btn--top{position:static;right:auto;bottom:auto;padding:8px 18px;font-size:.88rem;box-shadow:0 0 0 1px rgba(212,175,55,.25),0 4px 16px rgba(212,175,55,.18);background:linear-gradient(180deg,rgba(212,175,55,.22),rgba(212,175,55,.08)),var(--off-black,#1B1B22)}',
        '.askdhq-btn.askdhq-btn--top:hover{background:linear-gradient(180deg,rgba(212,175,55,.32),rgba(212,175,55,.12)),var(--off-black,#1B1B22)}',
        '.askdhq-panel.askdhq-panel--top{top:calc(var(--sat,0px) + 64px);bottom:auto}',
        '@media(max-width:767px){.askdhq-btn{bottom:calc(var(--wr-tab-bar-h,56px) + var(--sab,0px) + 12px)}}',
        '.askdhq-panel{position:fixed;right:16px;bottom:64px;z-index:2147482995;width:min(420px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 120px));display:flex;flex-direction:column;background:var(--off-black,#15151b);border:1px solid rgba(212,175,55,.4);border-radius:var(--card-radius-lg,14px);box-shadow:0 14px 40px rgba(0,0,0,.6);color:var(--white,#F5F2EA);font:400 .88rem/1.45 system-ui,-apple-system,sans-serif;overflow:hidden}',
        '@media(max-width:767px){.askdhq-panel{left:8px;right:8px;width:auto;bottom:calc(var(--wr-tab-bar-h,56px) + var(--sab,0px) + 8px);max-height:calc(100vh - var(--wr-tab-bar-h,56px) - var(--sab,0px) - 70px)}}',
        '.askdhq-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)}',
        '.askdhq-head b{color:var(--gold,#D4AF37);letter-spacing:.06em;font-size:.8rem}',
        '.askdhq-brain{font-size:.7rem;color:#9a9a9a;margin-left:auto}',
        '.askdhq-x{background:none;border:0;color:#9a9a9a;font-size:1.1rem;cursor:pointer;padding:2px 4px}',
        '.askdhq-log{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
        '.askdhq-q{align-self:flex-end;max-width:85%;background:rgba(212,175,55,.14);border:1px solid rgba(212,175,55,.3);border-radius:var(--card-radius-sm,8px);padding:7px 10px}',
        '.askdhq-a{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:var(--card-radius-sm,8px);padding:9px 11px}',
        '.askdhq-a h4{margin:0 0 4px;font-size:.72rem;letter-spacing:.06em;color:var(--gold,#D4AF37);text-transform:uppercase}',
        '.askdhq-a p{margin:0}',
        '.askdhq-a ul{margin:6px 0 0;padding-left:16px;color:#c9c9c9;font-size:.8rem}',
        '.askdhq-src{margin-top:6px;font-size:.68rem;color:#8a8a8a}',
        '.askdhq-more{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
        '.askdhq-chip{background:none;border:1px solid rgba(255,255,255,.18);color:#d8d8d8;border-radius:999px;padding:4px 10px;font:600 .72rem/1.2 system-ui,sans-serif;cursor:pointer;text-decoration:none}',
        '.askdhq-chip:hover{border-color:rgba(212,175,55,.6);color:var(--gold,#D4AF37)}',
        '.askdhq-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08)}',
        '.askdhq-in{flex:1;min-width:0;background:#000;border:1px solid rgba(255,255,255,.18);border-radius:var(--card-radius-sm,8px);color:#fff;padding:9px 10px;font:inherit}',
        '.askdhq-send{background:var(--gold,#D4AF37);color:#111;border:0;border-radius:var(--card-radius-sm,8px);padding:0 14px;font:800 .8rem/1 system-ui,sans-serif;cursor:pointer}',
    ].join('\n');
    function el(tag, cls, text) { const e = root.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    let ui = null;
    function brainLabel(b) { const k = savedKey(); return b === 'key' && k ? 'Your ' + PROVIDERS[k.provider].label + ' key' : b === 'device' ? 'Your device\'s AI · free' : b === 'device-download' ? 'Your device\'s AI (sets up on first ask)' : 'Your ChatGPT or Claude'; }
    // Paste-your-key card: one box, the company is read from the key.
    function keyCard(note, retryQ) {
        const box = el('div', 'askdhq-a askdhq-key');
        box.appendChild(el('h4', null, 'Use your own AI key'));
        box.appendChild(el('p', null, note || 'Paste a key from OpenAI, Anthropic (Claude) or Google (Gemini) and your AI answers right here.'));
        const f = el('form', 'askdhq-form'); f.style.padding = '8px 0 0'; f.style.borderTop = '0';
        const inp = el('input', 'askdhq-in'); inp.type = 'password'; inp.placeholder = 'sk-…, sk-ant-… or AIza…'; inp.autocomplete = 'off'; inp.setAttribute('aria-label', 'Your AI key');
        const b = el('button', 'askdhq-send', 'Save'); b.type = 'submit';
        f.appendChild(inp); f.appendChild(b);
        const msg = el('div', 'askdhq-src', 'Stays on this device. Sent only to the AI company it belongs to, never to DHQ. Usage is billed to your own account.');
        f.onsubmit = async e => {
            e.preventDefault();
            const val = inp.value, prov = providerOf(val);
            if (!prov) { msg.textContent = 'That looks too short to be a key. Copy the whole key and paste it again.'; return; }
            b.disabled = true; msg.textContent = 'Checking your key with ' + PROVIDERS[prov].label + '…';
            const ok = await checkKey(val, prov);
            b.disabled = false;
            if (ok === 'bad') { msg.textContent = PROVIDERS[prov].label + ' turned that key down. Copy it again from the key page and paste it here.'; return; }
            if (!saveKey(val)) { msg.textContent = 'This browser wouldn\'t store the key (private browsing?). Try a normal tab.'; return; }
            inp.value = '';
            if (ui) ui.brain.textContent = brainLabel('key');
            // Owner ask 2026-10-09: once the key is in, fold the box up to
            // one line so nothing looks unfinished.
            box.replaceChildren(el('p', null, '✓ ' + (ok === 'ok' ? 'Your ' + PROVIDERS[prov].label + ' key is saved and working.' : 'Your ' + PROVIDERS[prov].label + ' key is saved.') + (retryQ ? ' Asking your question again…' : ' Ask away below.')));
            if (retryQ) { box.remove(); const last = ui && ui.log.lastElementChild; if (last && last.classList.contains('askdhq-q') && last.textContent === retryQ) last.remove(); ask(retryQ); return; }
            if (ui) ui.input.focus();
        };
        box.appendChild(f); box.appendChild(msg);
        const more = el('div', 'askdhq-more');
        const free = el('a', 'askdhq-chip', 'Get a free Gemini key'); free.href = 'https://aistudio.google.com/apikey'; free.target = '_blank'; free.rel = 'noopener'; more.appendChild(free);
        if (savedKey()) { const rm = el('button', 'askdhq-chip', 'Remove my key'); rm.type = 'button'; rm.onclick = () => { forgetKey(); msg.textContent = 'Removed from this device.'; if (ui) brain().then(x => { ui.brain.textContent = brainLabel(x); }); }; more.appendChild(rm); }
        box.appendChild(more);
        return box;
    }
    function render(q, ans, narrated, b) {
        const box = el('div', 'askdhq-a');
        box.appendChild(el('h4', null, ans.title || 'DHQ'));
        const p = el('p', null, narrated || ans.text);
        box.appendChild(p);
        let ul = null;
        if (ans.lines && ans.lines.length) {
            ul = el('ul');
            ans.lines.forEach(t => {
                const li = el('li');
                if (ans.intent === 'help') {
                    const c = el('button', 'askdhq-chip', t); c.type = 'button'; c.onclick = () => ask(t); li.style.listStyle = 'none'; li.appendChild(c);
                } else li.textContent = t;
                ul.appendChild(li);
            });
            if (ans.intent === 'help') ul.style.paddingLeft = '0';
            box.appendChild(ul);
        }
        const src = el('div', 'askdhq-src', ans.intent === 'help' ? '' : 'The call is DHQ\'s' + (b === 'device' || b === 'device-download' ? '; the wording is your device\'s AI.' : '.'));
        box.appendChild(src);
        if (ans.intent !== 'help') {
            const more = el('div', 'askdhq-more');
            [['chatgpt', 'Ask in ChatGPT'], ['claude', 'Ask in Claude']].forEach(([w, label]) => { const a = el('a', 'askdhq-chip', label); a.href = askElsewhereUrl(w, q); a.target = '_blank'; a.rel = 'noopener'; more.appendChild(a); });
            box.appendChild(more);
        }
        return { box, p, src };
    }
    // Owner ruling 2026-10-09: DHQ is never the assistant. The member's own
    // AI answers (on the device today; their ChatGPT plan when OpenAI opens
    // it). DHQ only supplies the data and its calls. With no AI of theirs
    // reachable here, the question goes to their ChatGPT or Claude.
    function handoff(q, note) {
        const box = el('div', 'askdhq-a');
        box.appendChild(el('h4', null, 'Ask your AI'));
        box.appendChild(el('p', null, note || 'Your AI answers this with DHQ\'s data. Pick where to ask:'));
        const more = el('div', 'askdhq-more');
        [['chatgpt', 'Ask in ChatGPT'], ['claude', 'Ask in Claude']].forEach(([w, label]) => { const a = el('a', 'askdhq-chip', label); a.href = askElsewhereUrl(w, q); a.target = '_blank'; a.rel = 'noopener'; more.appendChild(a); });
        box.appendChild(more);
        const k = el('button', 'askdhq-chip', 'Answer here with my AI key'); k.type = 'button';
        k.onclick = () => { box.replaceWith(keyCard('Paste your key once, then ask again: your AI answers right here.')); };
        more.appendChild(k);
        box.appendChild(el('div', 'askdhq-src', 'ChatGPT and Claude use your plan with the Dynasty HQ connector. With your own key, or on Chrome for desktop, your AI answers right here.'));
        return box;
    }
    async function ask(question) {
        if (!ui) return;
        const q = String(question || '').trim();
        if (!q) return;
        ui.log.appendChild(el('div', 'askdhq-q', q));
        // Owner test 2026-10-09: asked from the leagues page (no league open)
        // and the panel just repeated its examples. Say what's needed, keep
        // the question, and ask it as soon as a league opens.
        if (!leagueReady()) {
            try { root.sessionStorage.setItem(PENDING, q); } catch (e) { /* asked again by hand */ }
            // Owner ask 2026-10-09: ask right from the leagues page. The
            // leagues page hands us its last-opened league; open it and the
            // question is answered there as soon as its rosters load.
            const hub = App.AskDHQ && App.AskDHQ.hubLeague;
            const box = el('div', 'askdhq-a');
            if (hub && hub.open) {
                box.appendChild(el('h4', null, 'Opening ' + (hub.name || 'your league')));
                box.appendChild(el('p', null, 'Your AI will answer as soon as the league loads.'));
                ui.log.appendChild(box); ui.log.scrollTop = ui.log.scrollHeight;
                try { hub.open(); } catch (e) { if (root.wrLog) root.wrLog('askdhq.hubopen', e); }
                return;
            }
            box.appendChild(el('h4', null, 'Pick a league first'));
            box.appendChild(el('p', null, 'Your AI needs a league\'s rosters to answer. Tap one of your leagues and your question will be asked there.'));
            ui.log.appendChild(box); ui.log.scrollTop = ui.log.scrollHeight;
            return;
        }
        const b = await brain();
        // The engine's own quick reading is only for members without a key.
        const ans = b === 'key' ? { intent: 'ai' } : answer(q);
        // With the member's own key, every question goes to their AI with the
        // league facts; the examples only come back without one.
        if (ans.intent === 'help' && b !== 'key') { ui.log.appendChild(handoff(q)); ui.log.scrollTop = ui.log.scrollHeight; return; }
        if (b === 'engine') { ui.log.appendChild(handoff(q)); ui.log.scrollTop = ui.log.scrollHeight; return; }
        if (b === 'key') {
            const k = savedKey();
            const box = el('div', 'askdhq-a');
            box.appendChild(el('h4', null, 'Your AI · ' + PROVIDERS[k.provider].label));
            const p = el('p', null, PROVIDERS[k.provider].label + ' is thinking…');
            box.appendChild(p);
            const src = el('div', 'askdhq-src', '');
            box.appendChild(src);
            ui.log.appendChild(box); ui.log.scrollTop = ui.log.scrollHeight;
            // Show what it's looking at while it works ("Checking standings…").
            const looked = [];
            const onStep = w => { if (!looked.includes(w)) looked.push(w); p.textContent = 'Checking ' + looked.slice(-3).join(', ') + '…'; };
            let res = await askWithKey(q, onStep);
            // One quiet retry for a blip (busy, timeout, dropped connection).
            if (!res.ok && res.retry) { await new Promise(rs => setTimeout(rs, 1500)); res = await askWithKey(q, onStep); }
            if (res.ok) {
                p.textContent = res.text;
                p.style.whiteSpace = 'pre-wrap';
                src.textContent = 'Answered by your ' + PROVIDERS[k.provider].label + '. Your key stays on this device.' + (res.noSearch ? ' (Web search isn\'t turned on for this key, so no news lookups.)' : '');
                if (res.sources && res.sources.length) {
                    const row = el('div', 'askdhq-more');
                    res.sources.forEach(x => { let host = ''; try { host = new URL(x.url).hostname.replace(/^www\./, ''); } catch (e) { return; } const a = el('a', 'askdhq-chip', host); a.href = x.url; a.target = '_blank'; a.rel = 'noopener'; if (x.title) a.title = x.title; row.appendChild(a); });
                    if (row.childNodes.length) box.insertBefore(row, src);
                }
            } else {
                if (res.badKey) { box.replaceWith(keyCard(res.error, q)); }
                else {
                    p.textContent = res.error; src.textContent = 'Your key is still saved.';
                    const again = el('button', 'askdhq-chip', 'Try again'); again.type = 'button';
                    again.onclick = () => { box.remove(); ui.log.lastElementChild && ui.log.lastElementChild.classList.contains('askdhq-q') && ui.log.lastElementChild.remove(); ask(q); };
                    const row = el('div', 'askdhq-more'); row.appendChild(again); box.appendChild(row);
                }
            }
            ui.log.scrollTop = ui.log.scrollHeight;
            return;
        }
        const box = el('div', 'askdhq-a');
        box.appendChild(el('h4', null, 'Your AI'));
        const p = el('p', null, '…');
        box.appendChild(p);
        const src = el('div', 'askdhq-src', b === 'device-download' ? 'Setting up your device\'s free AI (one time)…' : 'Your AI is answering with DHQ\'s data…');
        box.appendChild(src);
        ui.log.appendChild(box); ui.log.scrollTop = ui.log.scrollHeight;
        const out = await narrate(q, ans, t => { p.textContent = t; ui.log.scrollTop = ui.log.scrollHeight; }, pct => { src.textContent = 'Setting up your device\'s free AI: ' + Math.round((pct || 0) * 100) + '%'; });
        if (out) {
            p.textContent = out;
            src.textContent = 'Answered by your device\'s AI with DHQ\'s data. Nothing was sent to DHQ or any AI company.';
            if (ans.lines && ans.lines.length) {
                const d = el('details'); const sm = el('summary', null, 'The numbers'); sm.style.cursor = 'pointer'; d.appendChild(sm);
                const ul = el('ul'); ans.lines.forEach(t => ul.appendChild(el('li', null, t))); d.appendChild(ul); box.insertBefore(d, src);
            }
            _brain = Promise.resolve('device'); ui.brain.textContent = brainLabel('device');
        } else {
            box.replaceWith(handoff(q, 'Your device\'s AI couldn\'t answer just now. Ask your own AI instead:'));
        }
    }
    function open() {
        // The top-bar button stays put (and toggles); the corner one hides.
        const onTop = b => !!(b && b.classList.contains('askdhq-btn--top'));
        if (ui) {
            if (onTop(ui.btn) && ui.panel.style.display !== 'none') { ui.panel.style.display = 'none'; return; }
            ui.panel.style.display = 'flex'; ui.panel.classList.toggle('askdhq-panel--top', onTop(ui.btn));
            if (!onTop(ui.btn)) ui.btn.style.display = 'none';
            ui.input.focus(); return;
        }
        const d = root.document;
        const panel = el('div', 'askdhq-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Ask your AI');
        const head = el('div', 'askdhq-head'); head.appendChild(el('b', null, 'ASK YOUR AI'));
        const brainEl = el('span', 'askdhq-brain', '…'); head.appendChild(brainEl);
        const kb = el('button', 'askdhq-x', '🔑'); kb.type = 'button'; kb.title = 'Use your own AI key'; kb.setAttribute('aria-label', 'Use your own AI key');
        kb.onclick = () => showKeyCard();
        head.appendChild(kb);
        const x = el('button', 'askdhq-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = () => { panel.style.display = 'none'; btn.style.display = ''; };
        head.appendChild(x);
        const log = el('div', 'askdhq-log');
        const form = el('form', 'askdhq-form');
        const input = el('input', 'askdhq-in'); input.placeholder = 'Ask about your league…'; input.setAttribute('aria-label', 'Your question');
        const send = el('button', 'askdhq-send', 'Ask'); send.type = 'submit';
        form.appendChild(input); form.appendChild(send);
        form.onsubmit = e => { e.preventDefault(); const v = input.value; input.value = ''; ask(v); };
        panel.appendChild(head); panel.appendChild(log); panel.appendChild(form);
        d.body.appendChild(panel);
        const btn = ui && ui.btn || d.querySelector('.askdhq-btn');
        ui = { panel, log, input, brain: brainEl, btn };
        if (onTop(btn)) panel.classList.add('askdhq-panel--top');
        else if (btn) btn.style.display = 'none';
        brain().then(b => { brainEl.textContent = brainLabel(b); });
        // No canned questions (owner ask 2026-10-09): one line, then talk.
        const hi = el('div', 'askdhq-a'); const lgName = (league() || {}).name;
        hi.appendChild(el('p', null, 'Ask me anything about ' + (lgName ? lgName : 'your league') + ': lineups, trades, waivers, players. Follow-ups work too.'));
        log.appendChild(hi);
        input.focus();
    }
    // ── Members only (owner ruling 2026-10-09) ─────────────────────────
    // Guests use the app, not its AI. Any AI button a guest taps shows this
    // instead, with a way to sign up (their connected leagues carry over).
    const SIGNUP_URL = 'landing.html?signin=new', SIGNIN_URL = 'landing.html?signin';
    function membersOnly(feature) {
        const d = root.document;
        if (!d || !d.body || d.querySelector('.askdhq-mo')) return;
        if (!d.querySelector('style[data-askdhq]')) { const st = d.createElement('style'); st.setAttribute('data-askdhq', '1'); st.textContent = CSS; d.head.appendChild(st); }
        const ov = el('div', 'askdhq-mo');
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483001;background:rgba(4,6,10,.72);display:flex;align-items:center;justify-content:center;padding:16px';
        const card = el('div', 'askdhq-a');
        card.style.cssText = 'max-width:440px;width:100%;background:var(--off-black,#15151b);border:1px solid rgba(212,175,55,.45);border-radius:var(--card-radius-lg,14px);padding:20px 18px;color:var(--white,#F5F2EA);font:400 .92rem/1.5 system-ui,-apple-system,sans-serif';
        card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
        card.appendChild(el('h4', null, (feature || 'AI features') + ' · members only'));
        card.appendChild(el('p', null, 'AI is for Dynasty HQ members. Create a free account to ask about your league with your own AI (ChatGPT, Claude or Gemini), at no cost from us. Your connected leagues come with you.'));
        const row = el('div', 'askdhq-more'); row.style.marginTop = '14px'; row.style.alignItems = 'center';
        const up = el('a', 'askdhq-send', 'Create free account'); up.href = SIGNUP_URL; up.style.cssText = 'display:inline-flex;align-items:center;padding:10px 14px;text-decoration:none';
        const inn = el('a', 'askdhq-chip', 'Sign in'); inn.href = SIGNIN_URL;
        const back = el('button', 'askdhq-chip', 'Keep browsing'); back.type = 'button'; back.onclick = () => ov.remove();
        row.appendChild(up); row.appendChild(inn); row.appendChild(back);
        card.appendChild(row);
        ov.appendChild(card);
        ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
        d.body.appendChild(ov);
    }
    function isGuest() {
        try { const owner = root.OD && root.OD.identity && root.OD.identity.currentOwner ? root.OD.identity.currentOwner() : null; return owner === 'guest' || !owner; } catch (e) { return true; }
    }
    function isMember() {
        try { const owner = root.OD && root.OD.identity && root.OD.identity.currentOwner ? root.OD.identity.currentOwner() : null; return !!owner && owner !== 'guest'; } catch (e) { return false; }
    }
    function openKeySetup() {
        if (!isMember()) { membersOnly('Ask your AI'); return; }
        if (!root.document.querySelector('style[data-askdhq]') && !root.document.querySelector('.askdhq-btn')) { const st = root.document.createElement('style'); st.setAttribute('data-askdhq', '1'); st.textContent = CSS; root.document.head.appendChild(st); }
        open();
        // A saved key stays saved: reopening never asks for it again.
        if (!savedKey()) showKeyCard();
    }
    // One key card at a time: a new one replaces any already showing.
    function showKeyCard(note) {
        if (!ui) return;
        ui.log.querySelectorAll('.askdhq-key').forEach(n => n.remove());
        ui.log.appendChild(keyCard(note)); ui.log.scrollTop = ui.log.scrollHeight;
    }
    const PENDING = 'askdhq_pending';
    const leagueReady = () => !!(S().currentLeagueId && rosters().length && Object.keys(LI().playerScores || {}).length);
    function askPending() {
        let q = null;
        try { q = root.sessionStorage.getItem(PENDING); } catch (e) { return; }
        if (!q || !leagueReady() || !isMember()) return;
        try { root.sessionStorage.removeItem(PENDING); } catch (e) { /* once is enough */ }
        open(); ask(q);
    }
    // The season schedule on DHQ's numbers takes ~25 s to project; start it
    // quietly once per league for members with a key, so "am I making the
    // playoffs?" doesn't wait on it.
    let warmed = '';
    function warmSeason() {
        const lid = String(S().currentLeagueId || '');
        if (!lid || warmed === lid || !leagueReady() || !savedKey() || !isMember() || !App.AskTools) return;
        warmed = lid;
        const go = () => { App.AskTools.run('get_schedule', {}).catch(() => {}); };
        if (root.requestIdleCallback) root.requestIdleCallback(go, { timeout: 8000 }); else setTimeout(go, 4000);
    }
    function mount() {
        const d = root.document;
        if (!d || !d.body || d.querySelector('.askdhq-btn')) return;
        if (!d.querySelector('style[data-askdhq]')) { const st = d.createElement('style'); st.setAttribute('data-askdhq', '1'); st.textContent = CSS; d.head.appendChild(st); }
        const btn = el('button', 'askdhq-btn', 'Ask your AI'); btn.type = 'button'; btn.setAttribute('aria-label', 'Ask your AI about this league');
        btn.onclick = () => (isMember() ? open() : membersOnly('Ask your AI'));
        btn.style.display = 'none';
        d.body.appendChild(btn);
        // Show the button only to signed-in members (owner ruling
        // 2026-10-09: a members-only feature; guests never see it), and only
        // while a league is open.
        // The top bar's slot when the page has one showing (league pages on a
        // tablet or computer); otherwise the floating corner button (phones,
        // the leagues page). The panel opens under whichever was tapped.
        const place = () => {
            const slot = d.getElementById('askdhq-slot');
            const top = !!(slot && slot.offsetParent !== null);
            if (top && btn.parentNode !== slot) slot.appendChild(btn);
            else if (!top && btn.parentNode !== d.body) d.body.appendChild(btn);
            btn.classList.toggle('askdhq-btn--top', top);
            if (ui) ui.panel.classList.toggle('askdhq-panel--top', top);
        };
        place();
        setInterval(() => {
            place();
            // With a saved key the button also shows on the leagues page.
            const hub = App.AskDHQ && App.AskDHQ.hubLeague;
            const on = !!(S().currentLeagueId && rosters().length) || !!(hub && savedKey() && isMember());
            if (!ui || ui.panel.style.display === 'none' || btn.classList.contains('askdhq-btn--top')) btn.style.display = on ? '' : 'none';
            else if (!isMember()) { ui.panel.style.display = 'none'; btn.style.display = on ? '' : 'none'; }
            askPending();
            warmSeason();
        }, 1500);
    }

    App.AskDHQ = App.AskDHQ || { isMember, isGuest, membersOnly, openKeySetup, answer, findPlayers, intentOf, brain, narrate, askElsewhereUrl, providerOf, saveKey, savedKey, forgetKey, askWithKey, mount, _help: help };
    // Every AI request in the app funnels through OD.callAI or callClaude.
    // For a guest, one the guest started with a tap shows the members-only
    // card; background ones fail quietly as before. Members are untouched.
    function guardAI() {
        const tapNow = () => !!(root.navigator && root.navigator.userActivation && root.navigator.userActivation.isActive);
        const wrap = (obj, name) => {
            if (!obj || typeof obj[name] !== 'function' || obj[name].__dhqMembersOnly) return false;
            const orig = obj[name];
            const w = function () {
                if (isGuest()) {
                    if (tapNow()) membersOnly();
                    const e = new Error('AI is for Dynasty HQ members. Create a free account to use it.'); e.dhqCode = 'signin_required';
                    return Promise.reject(e);
                }
                return orig.apply(this, arguments);
            };
            w.__dhqMembersOnly = true;
            obj[name] = w;
            return true;
        };
        let tries = 0;
        const iv = setInterval(() => {
            tries++;
            wrap(root.OD, 'callAI'); wrap(root, 'callClaude'); wrap(root, 'dhqAI');
            if (tries > 40) clearInterval(iv);
        }, 500);
    }
    if (typeof document !== 'undefined' && root.DHQ_LAB === true) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
        guardAI();
    }
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.AskDHQ;
})(typeof window !== 'undefined' ? window : globalThis);
