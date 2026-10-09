// ══════════════════════════════════════════════════════════════════
// js/shared/ask-dhq.js — window.App.AskDHQ   (Lab only: window.DHQ_LAB)
// "Ask DHQ": ask a question in plain English, inside the app, and get an
// answer — with nobody paying for AI and nobody setting anything up.
//
// Owner direction 2026-10-09: users stay in the app and use their own AI,
// at zero cost to DHQ. How:
//   1. DHQ answers. The engine already in the page (values, the lineup
//      solver, the team assessor, the player-action chain, the trade
//      engine, game locks) makes the call and writes the answer. Every
//      member gets a real answer with no AI at all.
//   2. The member's device makes it conversational. Chrome on desktop
//      ships Google's Gemini Nano built in (the Prompt API, free, on the
//      device). When it is there, DHQ hands it the verdict and it rewrites
//      it as a GM would say it, using only DHQ's facts. iPhone (Apple
//      Intelligence) and Android (Gemini Nano) come with the native app.
//   3. One tap takes the question to the member's own ChatGPT or Claude,
//      where the Dynasty HQ connector answers with the same tools.
// DHQ decides; the AI only explains. Nothing here calls a paid model.
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
            if (r) return { pts: round1(r.mean != null ? r.mean : r.median), kind: 'proj' };
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
        const byLast = {};
        for (const pid of rostered) { const parts = norm(pname(pid)).split(' '); const last = parts[parts.length - 1]; if (last && last.length >= 4) (byLast[last] = byLast[last] || []).push(pid); }
        for (const last of Object.keys(byLast)) {
            if (byLast[last].length !== 1) continue;
            const at = text.indexOf(' ' + last + ' ');
            if (at >= 0 && !hits.some(h => norm(pname(h.pid)).endsWith(' ' + last))) add(byLast[last][0], at);
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
        if (has(/\b(waiver|pick up|pickup|free agent|add|faab|stream)\b/)) return 'waivers';
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
                return { pid, name: pname(pid), pts: w.pts, kind: w.kind, inj, why, locked: !!(g && g.locked), status: g ? g.label : '' };
            });
            const open = rows.filter(r => !r.locked && !r.why && r.pts != null).sort((a, b) => b.pts - a.pts);
            const locked = rows.filter(r => r.locked);
            const lines = rows.map(r => r.name + ': ' + (r.locked ? (r.kind === 'live' ? 'playing now, ' : 'already played, ') + r.pts + ' pts (locked)' : r.why ? 'can\'t start, ' + r.why : r.pts == null ? 'no projection yet' : r.pts + ' projected') + (r.inj && !r.why ? ' · ' + r.inj : ''));
            let text;
            if (!open.length) text = locked.length ? 'None of them can be moved now: ' + locked.map(r => r.name).join(' and ') + (locked.length > 1 ? ' have' : ' has') + ' already played.' : 'I can\'t make that call yet: DHQ has no projection for them this week.';
            else if (open.length === 1) text = 'Start ' + open[0].name + ' (' + open[0].pts + ' projected).' + (rows.filter(r => r !== open[0]).map(r => ' ' + r.name + (r.locked ? ' is locked, his game has started.' : r.why ? ' can\'t start: ' + r.why + '.' : ' has no projection.')).join(''));
            else {
                const a = open[0], b = open[1], gap = round1(a.pts - b.pts);
                text = gap < 0.5
                    ? 'Toss-up: ' + a.name + ' (' + a.pts + ') and ' + b.name + ' (' + b.pts + ') are within half a point. Go with the healthier player and the better news.'
                    : 'Start ' + a.name + ' over ' + b.name + ': ' + a.pts + ' vs ' + b.pts + ' projected (+' + gap + ').' + (a.inj ? ' Note ' + a.name + ' is ' + a.inj + '.' : '');
            }
            return { intent: 'startsit', title: 'Start / sit', text, lines, players: rows.map(r => r.pid), facts: { rows } };
        }
        const DQ = App.DhqProj;
        const chk = me && lg && DQ && DQ.lineupCheck ? DQ.lineupCheck(me, lg) : null;
        if (!chk) return { intent: 'startsit', title: 'Your lineup', text: 'DHQ is still projecting this week. Open Game Day for the full lineup check, or ask me again in a few seconds.', lines: [], players: [], facts: {} };
        const d = chk.delta;
        if (d.isOptimal) return { intent: 'startsit', title: 'Your lineup', text: 'Start who you have in: your lineup is already DHQ\'s best (' + round1(d.currentTotal) + ' projected).', lines: [], players: [], facts: { total: d.currentTotal } };
        const ins = d.startInstead.map(x => pname(x.pid) + ' at ' + String(x.slot).replace('_', ' ') + ' (' + round1(x.pts) + ')');
        const outs = d.benchInstead.map(pid => pname(pid) + ' (' + round1(weekPts(pid).pts) + ')');
        return {
            intent: 'startsit', title: 'Your lineup',
            text: 'You\'re leaving ' + round1(d.optimalTotal - d.currentTotal) + ' points on the bench. Start ' + ins[0] + (outs[0] ? ' instead of ' + outs[0] : '') + (ins.length > 1 ? ', and ' + (ins.length - 1) + ' more change' + (ins.length > 2 ? 's' : '') + '.' : '.'),
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
            w.pts != null ? (w.kind === 'proj' ? 'This week: ' + w.pts + ' projected' : 'This week: ' + w.pts + ' pts (' + (w.kind === 'live' ? 'playing now' : 'final') + ')') : null,
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
        const lines = rows.map(r => r.name + ': DHQ ' + r.value + ' · ' + r.peak + ' peak yrs · age ' + (r.age || '?') + (r.week != null ? ' · this week ' + r.week : ''));
        return { intent: 'compare', title: 'Compare', text, lines, players: ids, facts: { rows } };
    }
    function needs() {
        const me = myRoster(); const a = me ? assessOf(me.roster_id) : null;
        if (!a) return { intent: 'needs', title: 'Your team', text: 'DHQ is still reading your league. Ask again in a moment.', lines: [], players: [], facts: {} };
        const need = (a.needs || []).map(n => n.pos + ' (' + n.urgency + ')');
        const lines = Object.entries(a.posAssessment || {}).filter(([, x]) => x.status !== 'ok').map(([pos, x]) => pos + ': ' + x.status + ' · ' + x.nflStarters + ' quality starter' + (x.nflStarters === 1 ? '' : 's') + ' for ' + x.minQuality + ' slot' + (x.minQuality === 1 ? '' : 's'));
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
        const lines = give.map(p => 'You give ' + pname(p) + ' · DHQ ' + dhq(p)).concat(get.map(p => 'You get ' + pname(p) + ' · DHQ ' + dhq(p)), posture ? ['Their posture: ' + posture.label] : [], taxes.slice(0, 3).map(x => x.name + ' (' + (x.impact > 0 ? '+' : '') + x.impact + ')'));
        return { intent: 'trade', title: 'Trade grade', text, lines, players: give.concat(get), facts: { give: tg, get: tt, fair, accept } };
    }
    function targets(q) {
        const me = myRoster(), mine = me ? assessOf(me.roster_id) : null, TE = App.TradeEngine;
        if (!mine) return { intent: 'targets', title: 'Trade targets', text: 'DHQ is still reading your league. Ask again in a moment.', lines: [], players: [], facts: {} };
        const want = findPos(q) ? [findPos(q)] : (mine.needs || []).map(n => n.pos);
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
    function waivers(q) {
        const pos = findPos(q);
        const me = myRoster(), mine = me ? assessOf(me.roster_id) : null;
        const want = pos ? [pos] : (mine && mine.needs || []).map(n => n.pos).slice(0, 2);
        const rostered = new Set(rosters().flatMap(r => (r.players || []).map(String)));
        const pool = Object.keys(LI().playerScores || {}).filter(pid => !rostered.has(pid) && pl(pid).team && (!want.length || want.includes(ppos(pid)) || (pl(pid).fantasy_positions || []).some(x => want.includes(String(x).toUpperCase()))))
            .sort((a, b) => dhq(b) - dhq(a)).slice(0, 5);
        if (!pool.length) return { intent: 'waivers', title: 'Waivers', text: 'Nothing worth a claim at ' + (want.join('/') || 'that spot') + ' right now.', lines: [], players: [], facts: {} };
        const lines = pool.map(pid => { const w = weekPts(pid); return pname(pid) + ' · ' + ppos(pid) + ' ' + (pl(pid).team || 'FA') + ' · DHQ ' + dhq(pid) + (w.pts != null && w.kind === 'proj' ? ' · ' + w.pts + ' this week' : '') + (injury(pid) ? ' · ' + injury(pid) : ''); });
        const text = 'Best available' + (want.length ? ' at ' + want.join('/') : '') + ': ' + pname(pool[0]) + ' (DHQ ' + dhq(pool[0]) + ').' + (mine && mine.faabRemaining != null ? ' You have $' + mine.faabRemaining + ' FAAB left; Free Agency has the bid model.' : '');
        return { intent: 'waivers', title: 'Waivers', text, lines, players: pool, facts: { want } };
    }
    function help() {
        return {
            intent: 'help', title: 'Ask DHQ',
            text: 'Ask me about your league in plain English. I use DHQ\'s own engine, the same one behind every screen.',
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
        return help();
    }

    // ── The member's own AI ─────────────────────────────────────────
    // Chrome's built-in Gemini Nano (free, on the device). 'device' when
    // ready now, 'device-download' when Chrome can fetch it on first use,
    // 'engine' when this browser has none (DHQ's own words are shown).
    let _brain = null;
    function brain() {
        if (_brain) return _brain;
        const LM = root.LanguageModel;
        _brain = !LM || typeof LM.availability !== 'function' ? Promise.resolve('engine')
            : LM.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] })
                .then(a => (a === 'available' ? 'device' : a === 'downloadable' || a === 'downloading' ? 'device-download' : 'engine'))
                .catch(() => 'engine');
        return _brain;
    }
    const SYSTEM = 'You are the Dynasty HQ assistant, a sharp, friendly fantasy football GM. You are given a question and DHQ\'s answer with its facts. Rewrite DHQ\'s answer in two to four plain sentences, as a GM talking to a friend. Lead with the call. Use ONLY the facts given: never add a player, number, injury or news that is not in them, and never change DHQ\'s call. No lists, no headings.';
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
            const prompt = 'Question: ' + question + '\nDHQ\'s answer: ' + ans.text + '\nFacts:\n- ' + (ans.lines || []).join('\n- ');
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
    function brainLabel(b) { return b === 'device' ? 'Your device\'s AI · free' : b === 'device-download' ? 'Your device\'s AI (sets up on first ask)' : 'DHQ engine'; }
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
    async function ask(question) {
        if (!ui) return;
        const q = String(question || '').trim();
        if (!q) return;
        ui.log.appendChild(el('div', 'askdhq-q', q));
        const ans = answer(q);
        const b = await brain();
        const view = render(q, ans, null, b);
        ui.log.appendChild(view.box);
        ui.log.scrollTop = ui.log.scrollHeight;
        if ((b === 'device' || b === 'device-download') && ans.intent !== 'help') {
            const dhqText = ans.text;
            view.src.textContent = b === 'device-download' ? 'Setting up your device\'s free AI (one time)…' : 'Your device\'s AI is wording it…';
            const out = await narrate(q, ans, t => { view.p.textContent = t; ui.log.scrollTop = ui.log.scrollHeight; }, pct => { view.src.textContent = 'Setting up your device\'s free AI: ' + Math.round((pct || 0) * 100) + '%'; });
            if (out) { view.p.textContent = out; view.src.textContent = 'The call is DHQ\'s; the wording is your device\'s AI.'; _brain = Promise.resolve('device'); ui.brain.textContent = brainLabel('device'); }
            else { view.p.textContent = dhqText; view.src.textContent = 'The call is DHQ\'s.'; }
        }
    }
    function open() {
        if (ui) { ui.panel.style.display = 'flex'; ui.btn.style.display = 'none'; ui.input.focus(); return; }
        const d = root.document;
        const panel = el('div', 'askdhq-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Ask DHQ');
        const head = el('div', 'askdhq-head'); head.appendChild(el('b', null, 'ASK DHQ'));
        const brainEl = el('span', 'askdhq-brain', '…'); head.appendChild(brainEl);
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
        if (btn) btn.style.display = 'none';
        brain().then(b => { brainEl.textContent = brainLabel(b); });
        const h = help(); const v = render('', h, null, 'engine'); log.appendChild(v.box);
        input.focus();
    }
    function mount() {
        const d = root.document;
        if (!d || !d.body || d.querySelector('.askdhq-btn')) return;
        const st = d.createElement('style'); st.textContent = CSS; d.head.appendChild(st);
        const btn = el('button', 'askdhq-btn', 'Ask DHQ'); btn.type = 'button'; btn.setAttribute('aria-label', 'Ask DHQ a question');
        btn.onclick = open;
        btn.style.display = 'none';
        d.body.appendChild(btn);
        // Show the button only while a league is open.
        setInterval(() => {
            const on = !!(S().currentLeagueId && rosters().length);
            if (!ui || ui.panel.style.display === 'none') btn.style.display = on ? '' : 'none';
            else if (!on) { ui.panel.style.display = 'none'; btn.style.display = 'none'; }
        }, 1500);
    }

    App.AskDHQ = App.AskDHQ || { answer, findPlayers, intentOf, brain, narrate, askElsewhereUrl, mount, _help: help };
    if (typeof document !== 'undefined' && root.DHQ_LAB === true) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
    }
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.AskDHQ;
})(typeof window !== 'undefined' ? window : globalThis);
