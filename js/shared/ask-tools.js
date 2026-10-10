// ══════════════════════════════════════════════════════════════════
// js/shared/ask-tools.js — window.App.AskTools (Lab)
//
// Owner ruling 2026-10-10: the member's own AI must be able to answer
// anything, conversationally, without pre-canned replies. Instead of one
// fixed bundle of facts, the AI gets TOOLS: it decides what it needs, looks
// it up in the app's own data (the same data every screen shows), and goes
// to web search for anything the app doesn't hold.
//
// Contract (every tool file registers through this):
//   App.AskTools.register({ name, description, parameters, run })
//     name         snake_case, unique
//     description  one or two plain sentences: what it answers, when to use
//     parameters   JSON Schema object ({ type:'object', properties, required })
//     run(args, h) async → a plain JSON-able object, compact (no huge lists:
//                  cap rows, round numbers). Throw new Error('plain reason')
//                  when it can't answer; the AI is told the reason.
//   App.AskTools.defs()           → [{ name, description, parameters }]
//   App.AskTools.run(name, args)  → Promise<object>   (never rejects)
//   App.AskTools.h                → shared helpers (below)
//
// Numbers stay honest: every value returned comes from the app's data or
// engine. Nothing here calls an AI.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const tools = new Map();

    // ── Shared helpers ─────────────────────────────────────────────
    const S = () => root.S || {};
    const LI = () => App.LI || {};
    const round1 = n => (n == null || isNaN(n) ? null : Math.round(Number(n) * 10) / 10);
    const norm = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const pl = pid => (S().players || {})[pid] || {};
    const pname = pid => { const p = pl(pid); return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || (p.team && /^[A-Z]{2,3}$/.test(String(pid)) ? p.team + ' D/ST' : String(pid)); };
    const ppos = pid => { const p = pl(pid); return String((App.normPos && App.normPos(p.position)) || p.position || '').toUpperCase(); };
    const value = pid => Math.round(Number((LI().playerScores || {})[pid]) || 0);
    const meta = pid => (LI().playerMeta || {})[pid] || {};
    const rosters = () => S().rosters || [];
    const users = () => S().leagueUsers || [];
    // The page keeps a trimmed league in S.leagues; season/total teams come
    // from elsewhere (S.season, the rosters).
    function league() {
        const s = S();
        const lg = (s.leagues || []).find(l => String(l.league_id || l.id) === String(s.currentLeagueId)) || (s.leagues || [])[0] || null;
        return lg;
    }
    const settings = () => (league() || {}).settings || {};
    const season = () => String(S().season || (S().nflState || {}).season || '');
    function week() {
        const WP = App.WeeklyProj;
        return Number((WP && WP.currentWeek && WP.currentWeek()) || S().currentWeek || (S().nflState || {}).display_week || (S().nflState || {}).week || 0);
    }
    const platform = () => S().platform || 'sleeper';
    function myRoster() {
        const s = S(), rs = rosters();
        return rs.find(r => String(r.roster_id) === String(s.myRosterId)) || rs.find(r => String(r.owner_id) === String(s.myUserId)) || null;
    }
    function userOf(r) { return r ? users().find(u => String(u.user_id) === String(r.owner_id)) || null : null; }
    function ownerName(r) { const u = userOf(r); return (u && u.display_name) || (r && r.owner_id ? String(r.owner_id) : 'unowned'); }
    function teamName(r) {
        if (!r) return 'free agent';
        const u = userOf(r);
        return (r.metadata && r.metadata.team_name) || (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || ('Team ' + r.roster_id);
    }
    const isMe = r => { const me = myRoster(); return !!(r && me && String(r.roster_id) === String(me.roster_id)); };
    const label = r => teamName(r) + (ownerName(r) !== teamName(r) ? ' (' + ownerName(r) + ')' : '') + (isMe(r) ? ' [me]' : '');
    // A team from whatever the AI passes: "me", a roster id, a team name or
    // an owner's display name (partial match ok). Null if nothing fits.
    function findTeam(q) {
        if (q == null || q === '' || /^(me|my|mine|my team|myself|i)$/i.test(String(q).trim())) return myRoster();
        const t = norm(q);
        const rs = rosters();
        const byId = rs.find(r => String(r.roster_id) === String(q).trim());
        if (byId) return byId;
        const exact = rs.find(r => norm(teamName(r)) === t || norm(ownerName(r)) === t);
        if (exact) return exact;
        return rs.find(r => norm(teamName(r)).includes(t) || norm(ownerName(r)).includes(t) || (t.length >= 3 && t.includes(norm(ownerName(r))))) || null;
    }
    const rosterOf = pid => rosters().find(r => (r.players || []).map(String).includes(String(pid))) || null;
    // A player from a name ("Sutton", "Courtland Sutton", "CJ Stroud") or a
    // Sleeper id. Prefers the member's own player, then rostered, then the
    // most valuable. Returns { pid, alternatives } or null.
    function findPlayer(q) {
        if (q == null) return null;
        const raw = String(q).trim();
        const players = S().players || {};
        if (players[raw]) return { pid: raw, alternatives: [] };
        const t = norm(raw);
        if (!t) return null;
        const mine = new Set(((myRoster() || {}).players || []).map(String));
        const rostered = new Set(rosters().flatMap(r => (r.players || []).map(String)));
        const score = pid => (mine.has(pid) ? 3e6 : 0) + (rostered.has(pid) ? 2e6 : 0) + value(pid) + (pl(pid).active ? 1000 : 0);
        const hits = [];
        for (const pid in players) {
            const p = players[pid];
            if (!p || !p.position) continue;
            const n = norm(p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')));
            if (!n) continue;
            if (n === t) hits.push([pid, 3]);
            else if (n.replace(/ /g, '') === t.replace(/ /g, '')) hits.push([pid, 3]);
            else if (n.split(' ').slice(-1)[0] === t) hits.push([pid, 2]);
            else if (t.length >= 4 && n.includes(t)) hits.push([pid, 1]);
        }
        if (!hits.length) return null;
        const best = Math.max(...hits.map(x => x[1]));
        const pool = hits.filter(x => x[1] === best).map(x => x[0]).sort((a, b) => score(b) - score(a));
        return { pid: pool[0], alternatives: pool.slice(1, 4).map(pid => pname(pid) + ' (' + ppos(pid) + ' ' + (pl(pid).team || 'FA') + ')') };
    }
    const lock = pid => (App.GameLocks && App.GameLocks.state ? App.GameLocks.state(String(pid)) : null);
    const injury = pid => { const p = pl(pid); return p.injury_status ? p.injury_status + (p.injury_body_part ? ' (' + p.injury_body_part + ')' : '') : null; };
    // This week for one player: actual points once his game started, else
    // DHQ's projection (median shown, as Game Day does), else Sleeper's.
    function thisWeek(pid) {
        const g = lock(pid);
        const out = {};
        if (g) { out.game = g.status; if (g.opp) out.opp = (g.home ? 'vs ' : '@ ') + g.opp; if (g.locked) out.scored = round1(g.pts); if (g.label) out.game_label = g.label; }
        const DQ = App.DhqProj;
        const r = DQ && DQ.get ? DQ.get(String(pid)) : null;
        if (r) { out.proj = round1(r.median != null ? r.median : r.mean); if (r.floor != null) out.floor = round1(r.floor); if (r.ceiling != null) out.ceiling = round1(r.ceiling); }
        return out;
    }
    // One compact player line used across tools.
    function playerBrief(pid) {
        const p = pl(pid), m = meta(pid), r = rosterOf(pid);
        return {
            id: String(pid), name: pname(pid), pos: ppos(pid), nfl_team: p.team || 'FA', age: p.age || null,
            value: value(pid) || null, injury: injury(pid) || undefined,
            owner: r ? label(r) : 'free agent',
            this_week: thisWeek(pid),
            ppg: m.ppg != null ? round1(m.ppg) : undefined,
        };
    }
    const slotOf = (r, pid) => {
        pid = String(pid);
        if ((r.starters || []).map(String).includes(pid)) return 'starter';
        if ((r.reserve || []).map(String).includes(pid)) return 'IR';
        if ((r.taxi || []).map(String).includes(pid)) return 'taxi';
        return 'bench';
    };
    const assess = rid => { try { return typeof root.assessTeamFromGlobal === 'function' ? root.assessTeamFromGlobal(rid) : null; } catch (e) { return null; } };
    const record = r => { const st = (r && r.settings) || {}; return { wins: st.wins || 0, losses: st.losses || 0, ties: st.ties || 0, points_for: round1((st.fpts || 0) + (st.fpts_decimal || 0) / 100), points_against: st.fpts_against != null ? round1((st.fpts_against || 0) + (st.fpts_against_decimal || 0) / 100) : undefined }; };
    // Never waits past ms; clears its timer so nothing lingers after.
    const withTimeout = (p, ms, fallback) => { let t; return Promise.race([Promise.resolve(p), new Promise(r => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t)); };

    const h = { S, LI, App, root, round1, norm, pl, pname, ppos, value, meta, rosters, users, league, settings, season, week, platform, myRoster, userOf, ownerName, teamName, isMe, label, findTeam, rosterOf, findPlayer, lock, injury, thisWeek, playerBrief, slotOf, assess, record, withTimeout };

    // ── Registry ───────────────────────────────────────────────────
    function register(def) {
        if (!def || !def.name || typeof def.run !== 'function') throw new Error('bad tool');
        tools.set(def.name, def);
    }
    const defs = () => [...tools.values()].map(t => ({ name: t.name, description: t.description, parameters: t.parameters || { type: 'object', properties: {} } }));
    async function run(name, args) {
        const t = tools.get(name);
        if (!t) return { error: 'No tool named ' + name + '.' };
        try {
            const out = await withTimeout(t.run(args || {}, h), t.timeoutMs || 15000, { error: name + ' took too long.' });
            return out == null ? { error: 'Nothing found.' } : out;
        } catch (e) { return { error: String((e && e.message) || e) }; }
    }

    // ── Core tools: my team, the matchup, the lineup ───────────────
    register({
        name: 'get_team',
        description: 'Any team in this league (default: mine): record, every player with position, NFL team, slot (starter/bench/IR/taxi), dynasty value, this week (projection or points scored, game status), injury; plus the team read (needs, surplus, contender/rebuilder window, health, power rank) and FAAB left.',
        parameters: { type: 'object', properties: { team: { type: 'string', description: 'Team name, owner name, roster id, or "me" (default).' } } },
        async run(a) {
            const r = findTeam(a.team);
            if (!r) throw new Error('No team in this league matches "' + a.team + '". Teams: ' + rosters().map(teamName).join(', '));
            const A = assess(r.roster_id) || {};
            const players = (r.players || []).map(String).map(pid => Object.assign(playerBrief(pid), { slot: slotOf(r, pid), owner: undefined }))
                .sort((x, y) => (x.slot === 'starter' ? 0 : 1) - (y.slot === 'starter' ? 0 : 1) || (y.value || 0) - (x.value || 0));
            return {
                team: label(r), roster_id: r.roster_id, record: record(r),
                read: A.tier ? { tier: A.tier, window: A.window, health: A.healthScore, power_rank: A.powerRank, needs: (A.needs || []).map(n => n.pos + ' (' + n.urgency + ')'), surplus: A.strengths || [], total_value: A.totalDHQ, faab_left: A.faabRemaining } : undefined,
                players,
            };
        },
    });
    register({
        name: 'get_matchup',
        description: 'A week\'s head-to-head matchup (default: this week, my team): opponent, both starting lineups with projections or live points, projected totals and win chance; for a finished week, the final score.',
        parameters: { type: 'object', properties: { week: { type: 'integer', description: 'NFL week (default: current).' }, team: { type: 'string', description: 'Whose matchup (default: me).' } } },
        async run(a) {
            const lg = league(), me = findTeam(a.team);
            if (!lg || !me) throw new Error('League not loaded yet.');
            const wk = Number(a.week) || week();
            const MU = App.Matchup;
            if (!MU || !MU.resolveOpponentRosterId) throw new Error('Matchups are not available for this league.');
            const oppRid = await withTimeout(MU.resolveOpponentRosterId({ league: Object.assign({ season: season() }, lg), myRosterId: me.roster_id, week: wk }), 6000, null);
            const opp = oppRid != null ? rosters().find(r => String(r.roster_id) === String(oppRid)) : null;
            if (!opp) return { week: wk, team: label(me), opponent: null, note: 'No head-to-head opponent that week (bye, playoffs or no matchups in this league).' };
            const out = { week: wk, current_week: week(), team: label(me), team_record: record(me), opponent: label(opp), opponent_record: record(opp) };
            // Past weeks: the final score from Sleeper's matchup rows.
            if (wk < week() && MU.sleeperWeekRows) {
                const rows = await withTimeout(MU.sleeperWeekRows(lg.league_id, wk), 6000, null);
                const mine = (rows || []).find(x => String(x.roster_id) === String(me.roster_id));
                const theirs = (rows || []).find(x => String(x.roster_id) === String(opp.roster_id));
                if (mine && theirs) {
                    out.final = { mine: round1(mine.points), theirs: round1(theirs.points), result: mine.points > theirs.points ? 'won' : mine.points < theirs.points ? 'lost' : 'tied' };
                    const side = row => (row.starters || []).filter(x => x && x !== '0').map(pid => ({ name: pname(pid), pos: ppos(pid), pts: round1((row.players_points || {})[pid]) }));
                    out.my_starters = side(mine); out.their_starters = side(theirs);
                }
                return out;
            }
            const line = r => (r.starters || []).filter(x => x && x !== '0').map(String).map(pid => Object.assign({ name: pname(pid), pos: ppos(pid), nfl_team: pl(pid).team || 'FA', injury: injury(pid) || undefined }, thisWeek(pid)));
            out.my_starters = line(me); out.their_starters = line(opp);
            try {
                const m = App.DhqProj && App.DhqProj.matchup ? App.DhqProj.matchup((me.starters || []).filter(x => x && x !== '0'), opp, lg.roster_positions || []) : null;
                if (m && m.fc) out.projection = { mine: round1(m.fc.projMe), theirs: round1(m.fc.projOpp), my_win_chance_pct: m.fc.winPct, their_best_possible: round1(m.oppIdeal) };
            } catch (e) { /* projections still loading */ }
            if (wk !== week()) out.note = 'Lineups shown are as set today; projections are for the current week.';
            return out;
        },
    });
    register({
        name: 'get_lineup_advice',
        description: 'Is my lineup set right this week? The best lineup by projection, which swaps to make and how many points they add. Locked players (games already started) stay put.',
        parameters: { type: 'object', properties: { team: { type: 'string', description: 'Default: me.' } } },
        async run(a) {
            const r = findTeam(a.team), lg = league();
            if (!r || !lg) throw new Error('League not loaded yet.');
            const DQ = App.DhqProj;
            const chk = DQ && DQ.lineupCheck ? DQ.lineupCheck(r, lg) : null;
            if (!chk) throw new Error('Projections are still loading; try again in a few seconds.');
            const d = chk.delta || {};
            return {
                team: label(r), week: chk.week,
                current_total: round1(d.currentTotal), best_total: round1(d.optimalTotal), points_left_on_bench: round1(d.delta), lineup_is_optimal: !!d.isOptimal,
                start: (d.startInstead || []).map(x => ({ name: pname(x.pid), slot: x.slot, proj: round1(x.pts) })),
                bench: (d.benchInstead || []).map(pid => Object.assign({ name: pname(pid) }, thisWeek(pid))),
                move: (d.moves || []).map(x => ({ name: pname(x.pid), from: x.from, to: x.slot })),
            };
        },
    });

    App.AskTools = App.AskTools || { register, defs, run, h, _tools: tools };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.AskTools;
})(typeof window !== 'undefined' ? window : globalThis);
