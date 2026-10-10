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
    // ── This week, on ONE statistic (Lab research 2026-10-10) ────────
    // Lineup calls rank by DHQ's average week (mean): DhqProj.lineupCheck
    // picks with it, so every number a lineup tool prints is that same
    // average week (the old get_lineup_advice showed start rows on the mean
    // and bench rows on the median, so a "start" could read lower than the
    // man he replaced). A locked player (his game has kicked off) counts his
    // actual points and cannot move. A 0 always says why.
    const locksLoaded = () => { try { return !!(App.GameLocks && App.GameLocks.ready && App.GameLocks.ready()); } catch (e) { return false; } };
    const dhqRow = pid => { const D = App.DhqProj; try { return D && D.get ? D.get(String(pid)) : null; } catch (e) { return null; } };
    const meanOf = r => (r ? (Number(r.mean != null ? r.mean : r.median) || 0) : null);
    // Same test DhqProj uses for a bye (its byeOn): the team has no game in
    // a full slate of this week's games.
    function byeFromSlate(team, wk) {
        const bt = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek;
        if (!bt || !team || !wk) return false;
        const T = String(team).toUpperCase();
        if (bt[T + '|' + wk] && bt[T + '|' + wk].opp) return false;
        return Object.keys(bt).filter(k => k.slice(k.indexOf('|') + 1) === String(wk)).length >= 20;
    }
    const TAG_REASON = { OUT: 'out', DOUBTFUL: 'doubtful', D: 'doubtful', IR: 'IR', 'INJURED RESERVE': 'IR', PUP: 'PUP', SUS: 'suspended', SUSPENDED: 'suspended', NA: 'not active (NA)', NFI: 'NFI', COV: 'COVID list', DNR: 'did not report' };
    // Why a player projects 0 (or has no number) this week; null if he has a
    // real projection or is locked. bye · out · doubtful · IR · … ·
    // no_sleeper_line (Sleeper projects nothing for him: backup or no role,
    // truth law) · no_projection (DHQ has no number, e.g. a team defense) ·
    // no_role (DHQ projects him for 0).
    function zeroReason(pid, r, wk) {
        const p = pl(pid), g = lock(pid);
        if (g && g.locked) return null;
        if (r && meanOf(r) > 0) return null;
        if (!p.team && !/^[A-Z]{2,3}$/.test(String(pid))) return 'no NFL team';
        if ((g && g.status === 'bye') || byeFromSlate(p.team, wk || week())) return 'bye';
        const tag = String(p.injury_status || '').trim().toUpperCase();
        if (tag && TAG_REASON[tag]) return TAG_REASON[tag];
        if (/^IR\b/.test(tag)) return 'IR';
        if (r && r.noSleeper) return 'no_sleeper_line';
        if (!r) return 'no_projection';
        return 'no_role';
    }
    // One player's row for a lineup tool: proj = average week (or actual
    // points once locked), floor/ceiling from DHQ, locked, why it's 0.
    function weekRow(pid, wk) {
        pid = String(pid);
        const g = lock(pid), r = dhqRow(pid), out = {};
        out.locked = !!(g && g.locked);
        if (out.locked) { out.proj = round1(g.pts); out.game = g.label || g.status; }
        else if (r) { out.proj = round1(meanOf(r)); if (r.floor != null) out.floor = round1(r.floor); if (r.ceiling != null) out.ceiling = round1(r.ceiling); }
        else out.proj = null;
        const z = out.locked ? null : zeroReason(pid, r, wk);
        if (z && !(out.proj > 0)) out.zero_reason = z;
        const inj = injury(pid); if (inj) out.injury = inj;
        return out;
    }

    register({
        name: 'get_lineup_advice',
        description: 'Is my lineup set right this week? The best lineup by projection, which swaps to make and how many points they add. Every number is DHQ\'s average week in this league\'s scoring (actual points once a game has started). Locked players (games already started) stay put; locks_loaded says whether that was checked.',
        parameters: { type: 'object', properties: { team: { type: 'string', description: 'Default: me.' } } },
        async run(a) {
            const r = findTeam(a.team), lg = league();
            if (!r || !lg) throw new Error('League not loaded yet.');
            const DQ = App.DhqProj;
            const chk = DQ && DQ.lineupCheck ? DQ.lineupCheck(r, lg) : null;
            if (!chk) throw new Error('Projections are still loading; try again in a few seconds.');
            const d = chk.delta || {};
            const locks = locksLoaded();
            const out = {
                team: label(r), week: chk.week,
                projection: 'DHQ average week (mean), this league\'s scoring; actual points for a locked player',
                locks_loaded: locks,
                current_total: round1(d.currentTotal), best_total: round1(d.optimalTotal), points_left_on_bench: round1(d.delta), lineup_is_optimal: !!d.isOptimal,
                start: (d.startInstead || []).map(x => Object.assign({ name: pname(x.pid), slot: x.slot }, weekRow(x.pid, chk.week))),
                bench: (d.benchInstead || []).map(pid => Object.assign({ name: pname(pid) }, weekRow(pid, chk.week))),
                move: (d.moves || []).map(x => ({ name: pname(x.pid), from: x.from, to: x.slot })),
            };
            if (!locks) out.locks_note = 'Could not confirm which games have started this week: do not tell the member a player can still be moved without saying so.';
            return out;
        },
    });

    // ── get_start_sit: the verdict-first lineup call ─────────────────
    // "DHQ decides, you explain" (the connector's pattern, ported to the
    // Lab). DhqProj.lineupCheck finds the best lineup on DHQ's average week
    // (locks pinned, exact slot assignment in StartSit); startSitCall below
    // turns it into the call. Pure, so the rules are tested on fixtures.
    const CLOSE_PTS = 1.5;      // within this, or …
    const CLOSE_PCT = 0.10;     // … within 10% of the better player, it's a coin flip
    const FAVORED_PCT = 55, UNDERDOG_PCT = 45;
    const LATE_SHARE = 0.5;     // a late game: at least half the week's remaining games kick off before it
    const HARD_NO = new Set(['out', 'doubtful', 'bye', 'IR', 'PUP', 'suspended', 'not active (NA)', 'NFI', 'COVID list', 'did not report', 'no NFL team']);
    const f1 = n => (n == null || !isFinite(n) ? '?' : (Math.round(n * 10) / 10).toFixed(1));
    const isQ = tag => /^(Q|QUESTIONABLE)$/i.test(String(tag || '').trim());
    function tiebreakFor(winPct) {
        if (winPct == null || !isFinite(winPct)) return { stat: 'proj', why: 'no win chance available: keep the higher average week' };
        if (winPct >= FAVORED_PCT) return { stat: 'floor', why: 'you are favored (' + Math.round(winPct) + '% to win): take the higher floor' };
        if (winPct <= UNDERDOG_PCT) return { stat: 'ceiling', why: 'you are the underdog (' + Math.round(winPct) + '% to win): take the higher ceiling' };
        return { stat: 'proj', why: 'even game (' + Math.round(winPct) + '% to win): keep the higher average week' };
    }
    // facts: { week, slots:[{idx,slotName,elig}], current:{idx:pid}, placed:{idx:pid},
    //   current_total, best_total, locks_loaded, sleeper_loaded, win_pct,
    //   players:{ pid: { name, positions[], proj, floor, ceiling, locked, kick,
    //     injury_status, zero_reason, why, roster_slot } }, asked:[pid], not_found:[name],
    //   game_kicks:[ms] (kickoff of each game this week not started yet) }
    function startSitCall(facts) {
        const F = facts || {}, P = F.players || {};
        const slots = F.slots || [], current = F.current || {}, placed = F.placed || {};
        const nm = pid => (P[pid] && P[pid].name) || String(pid);
        const pj = pid => (P[pid] && P[pid].proj != null ? Number(P[pid].proj) : 0);
        const slotName = k => { const s = slots.find(x => String(x.idx) === String(k)); return s ? s.slotName : ''; };
        const slotElig = k => { const s = slots.find(x => String(x.idx) === String(k)); return s ? s.elig : []; };
        const fitsSlot = (pid, k) => ((P[pid] && P[pid].positions) || []).some(q => slotElig(k).includes(q));
        const tb = tiebreakFor(F.win_pct);
        const rules = [];
        const locked = Object.keys(P).filter(pid => P[pid].locked && P[pid].roster_slot !== 'not on roster');

        // 1. Pair each player coming in with the one going out of that slot,
        //    following any starter who only moves slots.
        const curPids = Object.values(current).map(String);
        const best = new Set(Object.values(placed).map(String));
        const out = curPids.filter(pid => !best.has(pid));
        const slotOfBest = {}; Object.keys(placed).forEach(k => { slotOfBest[String(placed[k])] = k; });
        const taken = new Set();
        const changes = [];
        Object.keys(placed).sort((x, y) => Number(x) - Number(y)).forEach(k => {
            const start = String(placed[k]);
            if (curPids.includes(start)) return;
            let x = current[k] ? String(current[k]) : null; const seen = new Set([String(k)]);
            while (x && best.has(x)) { const k2 = slotOfBest[x]; if (k2 == null || seen.has(String(k2))) { x = null; break; } seen.add(String(k2)); x = current[k2] ? String(current[k2]) : null; }
            let sit = x && out.includes(x) && !taken.has(x) ? x : null;
            if (!sit) sit = out.find(pid => !taken.has(pid) && fitsSlot(pid, k)) || out.find(pid => !taken.has(pid)) || null;
            if (sit) taken.add(sit);
            changes.push({ start, sit, slot: slotName(k) });
        });
        // Never move a locked player (lineupCheck already pins them; this is the guard).
        const safe = changes.filter(c => !(P[c.start] && P[c.start].locked) && !(c.sit && P[c.sit] && P[c.sit].locked));
        if (locked.length) rules.push('Locked (game started) stay put and count actual points: ' + locked.map(nm).join(', ') + '.');

        // 2. Each change: gain, close call, why.
        const rows = safe.map(c => {
            const a = P[c.start] || {}, b = c.sit ? (P[c.sit] || {}) : null;
            const gain = pj(c.start) - (b ? pj(c.sit) : 0);
            const top = Math.max(pj(c.start), b ? pj(c.sit) : 0);
            const close = !!b && !(b.zero_reason && HARD_NO.has(b.zero_reason)) && (gain < CLOSE_PTS || gain < CLOSE_PCT * top);
            const bits = [nm(c.start) + ' ' + f1(pj(c.start)) + (b ? ' vs ' + nm(c.sit) + ' ' + f1(pj(c.sit)) : ' into an empty slot') + ' (average week)'];
            if (b && b.zero_reason) bits.push(nm(c.sit) + ': ' + b.zero_reason);
            if (a.injury_status) bits.push(nm(c.start) + ' is ' + a.injury_status);
            if (b && b.injury_status && !b.zero_reason) bits.push(nm(c.sit) + ' is ' + b.injury_status);
            if (a.why) bits.push(nm(c.start) + ': ' + a.why);
            const row = { start: nm(c.start), sit: b ? nm(c.sit) : null, slot: c.slot, gain_pts: round1(gain), close_call: close, why: bits.join('; ') };
            if (close) {
                const s = tb.stat, va = s === 'proj' ? pj(c.start) : Number(a[s]), vb = s === 'proj' ? pj(c.sit) : Number(b[s]);
                const keep = isFinite(va) && isFinite(vb) && vb > va;
                row.lean = keep ? nm(c.sit) : nm(c.start);
                row.tiebreak = tb.why + (s !== 'proj' && isFinite(va) && isFinite(vb) ? ' (' + s + ' ' + f1(va) + ' vs ' + f1(vb) + ')' : '');
            }
            return row;
        });
        const close_calls = rows.filter(r => r.close_call).map(r => ({ start: r.start, sit: r.sit, slot: r.slot, gain_pts: r.gain_pts, call: 'coin flip', lean: r.lean, tiebreak: r.tiebreak }));
        if (close_calls.length) rules.push('Coin flip when within ' + CLOSE_PTS + ' pts or ' + Math.round(CLOSE_PCT * 100) + '%: ' + tb.why + '.');

        // 3. Who must not start.
        const hard = [], seenDNS = new Set();
        Object.keys(P).forEach(pid => {
            const x = P[pid];
            if (x.roster_slot === 'not on roster') return;
            const askedHim = (F.asked || []).includes(pid);
            if ((x.roster_slot === 'IR' || x.roster_slot === 'taxi') && !askedHim) return;
            let reason = null;
            if (x.locked && x.roster_slot !== 'starter') reason = 'locked: his game has started, he can\'t come off the bench';
            else if (!x.locked && (x.roster_slot === 'IR' || x.roster_slot === 'taxi')) reason = x.roster_slot === 'IR' ? 'on your IR slot' : 'on your taxi squad';
            else if (x.zero_reason && (HARD_NO.has(x.zero_reason) || x.roster_slot === 'starter' || askedHim)) reason = x.zero_reason;
            if (reason && !seenDNS.has(pid)) { seenDNS.add(pid); hard.push({ player: nm(pid), reason }); }
        });
        if (hard.length) rules.push('Never start a player who is out, doubtful, on bye, on IR/taxi, or already locked on the bench.');

        // 4. Questionable starters: late game? Is there a pivot that plays later?
        // Late = at least half of this week's remaining games kick off before
        // his (a 4 pm or night game): his inactive news lands after most
        // other options have locked. Falls back to my own players' games.
        let kicks = (F.game_kicks || []).map(Number).filter(k => k > 0);
        if (!kicks.length) kicks = Object.keys(P).filter(pid => P[pid].roster_slot !== 'not on roster' && !P[pid].locked && Number(P[pid].kick) > 0).map(pid => Number(P[pid].kick));
        const questionable = [];
        Object.keys(placed).forEach(k => {
            const pid = String(placed[k]), x = P[pid];
            if (!x || x.locked || !isQ(x.injury_status)) return;
            const kick = Number(x.kick) || null;
            const late = kick && kicks.length ? kicks.filter(t => t < kick).length / kicks.length >= LATE_SHARE : null;
            // Any active player not in the best lineup (a starter being benched counts).
            const pool = Object.keys(P).filter(q => !best.has(q) && (P[q].roster_slot === 'bench' || P[q].roster_slot === 'starter') && !P[q].locked && pj(q) > 0 && !(P[q].zero_reason) && !isQ(P[q].injury_status) && fitsSlot(q, k))
                .sort((m, n) => pj(n) - pj(m));
            const later = kick ? pool.filter(q => Number(P[q].kick) >= kick) : [];
            const piv = later[0] || pool[0] || null;
            const pivLater = !!(piv && kick && Number(P[piv].kick) >= kick);
            let note;
            if (!piv) note = 'No healthy bench player fits his slot.';
            else if (late === true && !pivLater) note = 'Nobody on the bench who fits his slot plays as late: if he is ruled out about 90 minutes before kickoff, you cannot swap. Best fallback is ' + nm(piv) + ' (' + f1(pj(piv)) + '), whose game starts earlier; decide before it does.';
            else if (pivLater) note = 'Start him; if he is inactive, swap in ' + nm(piv) + ' (plays in the same or a later game).';
            else note = 'If he is ruled out before ' + nm(piv) + '\'s game locks, swap in ' + nm(piv) + '.';
            questionable.push({ player: nm(pid), status: x.injury_status, slot: slotName(k), late_game: late, pivot: piv ? nm(piv) : null, pivot_proj: piv ? round1(pj(piv)) : null, pivot_plays_later: pivLater, note });
        });
        if (questionable.length) rules.push('Questionable starter in a late game: start him only with a pivot who plays the same or a later game.');

        // 5. Players the member named.
        let asked = null, h2h = null;
        if ((F.asked || []).length) {
            asked = F.asked.map(pid => {
                const x = P[pid] || {};
                let verdict;
                if (x.roster_slot === 'not on roster') verdict = 'not on your roster';
                else if (x.locked) verdict = 'locked: his game has started' + (x.roster_slot === 'starter' ? ' (stays in)' : ' (stays on the bench)');
                else if (x.roster_slot === 'IR' || x.roster_slot === 'taxi') verdict = 'can\'t start: on your ' + x.roster_slot;
                else if (x.zero_reason && !(x.proj > 0)) verdict = 'don\'t start: ' + x.zero_reason;
                else verdict = best.has(pid) ? 'start' : 'sit';
                return { player: nm(pid), verdict, proj: x.proj != null ? round1(x.proj) : null, floor: x.floor != null ? round1(x.floor) : null, ceiling: x.ceiling != null ? round1(x.ceiling) : null, injury: x.injury_status || null, locked: !!x.locked };
            });
            const open = F.asked.filter(pid => P[pid] && !P[pid].locked && P[pid].roster_slot !== 'not on roster' && P[pid].roster_slot !== 'IR' && P[pid].roster_slot !== 'taxi' && pj(pid) > 0).sort((m, n) => pj(n) - pj(m));
            if (open.length >= 2) {
                const [a1, b1] = open, gap = pj(a1) - pj(b1);
                const close = gap < CLOSE_PTS || gap < CLOSE_PCT * pj(a1);
                h2h = { pick: nm(a1), over: nm(b1), gap_pts: round1(gap), close_call: close };
                if (close) {
                    const s = tb.stat, va = s === 'proj' ? pj(a1) : Number(P[a1][s]), vb = s === 'proj' ? pj(b1) : Number(P[b1][s]);
                    if (isFinite(va) && isFinite(vb) && vb > va) { h2h.pick = nm(b1); h2h.over = nm(a1); }
                    h2h.call = 'coin flip';
                    h2h.tiebreak = tb.why + (s !== 'proj' && isFinite(va) && isFinite(vb) ? ' (' + s + ' ' + nm(a1) + ' ' + f1(va) + ', ' + nm(b1) + ' ' + f1(vb) + ')' : '');
                }
                const tags = [a1, b1].filter(pid => P[pid].injury_status).map(pid => nm(pid) + ' is ' + P[pid].injury_status);
                if (tags.length) h2h.injury_note = tags.join('; ');
            }
        }

        // 6. The call.
        const decision = rows.map(r => {
            if (r.close_call && r.lean === r.sit) return 'Keep ' + r.sit + ' over ' + r.start + (r.slot ? ' at ' + r.slot.replace(/_/g, ' ') : '') + ' (coin flip, ' + r.gain_pts + ' pts apart; tiebreak keeps him)';
            return (r.sit ? 'Start ' + r.start + ' over ' + r.sit : 'Start ' + r.start + ' in the empty slot') + (r.slot ? ' at ' + r.slot.replace(/_/g, ' ') : '') + (r.close_call ? ' (coin flip, +' + r.gain_pts + ')' : ' (+' + r.gain_pts + ' pts)');
        });
        const gainAll = round1(rows.filter(r => !(r.close_call && r.lean === r.sit)).reduce((t, r) => t + (Number(r.gain_pts) || 0), 0));
        let recommendation;
        if (h2h) recommendation = 'Start ' + h2h.pick + ' over ' + h2h.over + (h2h.close_call ? ': a coin flip (' + h2h.gap_pts + ' pts apart), ' + h2h.tiebreak : ' (+' + h2h.gap_pts + ' pts)') + (h2h.injury_note ? '; ' + h2h.injury_note : '') + '.';
        else if (!rows.length) recommendation = 'Your lineup is already set right: start who is in.';
        else if (rows.length === 1) recommendation = decision[0] + '.';
        else if (rows.length <= 3) recommendation = 'Make ' + rows.length + ' changes: ' + decision.map(s => s.replace(/ \(.*\)$/, '')).join('; ') + ' (+' + gainAll + ' pts in all).';
        else recommendation = 'Make ' + rows.length + ' changes worth +' + gainAll + ' pts, led by: ' + decision[0].replace(/ \(.*\)$/, '') + '.';

        let confidence = 'high';
        if (close_calls.length || (h2h && h2h.close_call) || questionable.some(q => q.late_game && !q.pivot_plays_later)) confidence = 'medium';
        if (!F.locks_loaded || F.sleeper_loaded === false) confidence = 'low';

        const evidence = [
            'Current lineup ' + f1(F.current_total) + ' vs best ' + f1(F.best_total) + ' (DHQ average week, this league\'s scoring' + (locked.length ? '; locked players at actual points' : '') + ').',
        ];
        if (F.win_pct != null) evidence.push('Win chance with the best lineup: ' + Math.round(F.win_pct) + '%.');
        evidence.push(F.locks_loaded ? 'Game locks checked: ' + locked.length + ' of your players\' games have started.' : 'Game locks NOT loaded: could not confirm whose game has started.');
        if (F.sleeper_loaded === false) evidence.push('Sleeper\'s lines for this week are not loaded, so DHQ numbers are not checked against them.');
        rules.unshift('Ranked by DHQ\'s average week in this league\'s scoring, never by dynasty value.');
        if ((F.not_found || []).length) evidence.push('No player found for: ' + F.not_found.join(', ') + '.');

        const optimal_lineup = Object.keys(placed).sort((x, y) => Number(x) - Number(y)).map(k => {
            const pid = String(placed[k]), x = P[pid] || {};
            return { slot: slotName(k), player: nm(pid), proj: x.proj != null ? round1(x.proj) : null, floor: x.locked ? round1(x.proj) : (x.floor != null ? round1(x.floor) : null), ceiling: x.locked ? round1(x.proj) : (x.ceiling != null ? round1(x.ceiling) : null), locked: !!x.locked };
        });
        const res = { week: F.week, decision, confidence, recommendation, optimal_lineup, changes: rows, close_calls, do_not_start: hard, questionable, evidence, rules_applied: rules, locks_loaded: !!F.locks_loaded };
        if (asked) res.asked = asked;
        if (h2h) res.head_to_head = h2h;
        if (!F.locks_loaded) res.warning = 'Could not confirm which games have started: say so, and do not promise that any player named here can still be moved.';
        res.method = 'DHQ start/sit: the best lineup by DHQ\'s weekly projection (average week, this league\'s scoring; exact slot assignment, dual-position players count at every position). Locked players stay put at actual points; out, doubtful, bye, IR, taxi never start. A swap worth under ' + CLOSE_PTS + ' pts or ' + Math.round(CLOSE_PCT * 100) + '% is a coin flip: favored (' + FAVORED_PCT + '%+) takes the higher floor, underdog (' + UNDERDOG_PCT + '% or less) the higher ceiling. A Questionable starter in a late game needs a pivot who plays as late. Lead with `recommendation`; explain with `changes`, `close_calls`, `do_not_start`, `questionable`. Never use dynasty value for this.';
        return res;
    }

    register({
        name: 'get_start_sit',
        description: 'THE call for any start/sit or lineup question this week, verdict first: which changes to make (start X over Y and the points), confidence, coin-flip close calls with the tiebreak, who must not start (out, doubtful, bye, IR, already played) and Questionable starters in late games with a pivot. Pass `players` when the member names who he is choosing between. Uses DHQ\'s weekly projection in this league\'s scoring, never dynasty value. Lead with `recommendation`.',
        parameters: { type: 'object', properties: {
            players: { type: 'array', items: { type: 'string' }, description: 'Optional: the players the member asked about (names or Sleeper ids).' },
            week: { type: 'integer', description: 'Optional NFL week; only the current week can be decided.' },
        } },
        async run(a) {
            const r = myRoster(), lg = league();
            if (!r || !lg) throw new Error('League not loaded yet.');
            const D = App.DhqProj;
            if (!D || !D.lineupCheck) throw new Error('DHQ projections are not available here.');
            const chk = D.lineupCheck(r, lg);
            if (!chk) throw new Error('Projections are still loading; try again in a few seconds.');
            const wk = Number(chk.week) || week();
            if (a.week != null && Number(a.week) && Number(a.week) !== wk) throw new Error('Start/sit is decided for this week (week ' + wk + ') only: later weeks\' injuries and lineups are not known yet.');
            const slots = chk.slots || [];
            const current = {};
            slots.forEach(x => { const pid = (r.starters || [])[x.idx]; if (pid && String(pid) !== '0') current[x.idx] = String(pid); });
            const names = Array.isArray(a.players) ? a.players : (a.players ? String(a.players).split(/\s*(?:,|\bvs\.?\b|\bor\b|\band\b|\/)\s*/i) : []);
            const asked = [], notFound = [];
            names.map(x => String(x || '').trim()).filter(Boolean).forEach(q => { const f = findPlayer(q); if (f) { if (!asked.includes(String(f.pid))) asked.push(String(f.pid)); } else notFound.push(q); });
            const ids = new Set((r.players || []).map(String).filter(x => x && x !== '0').concat(asked));
            const posOf = pid => (D.posList ? D.posList(pid) : [ppos(pid)]);
            const players = {};
            ids.forEach(pid => {
                const row = weekRow(pid, wk), g = lock(pid), p = pl(pid);
                const onRoster = (r.players || []).map(String).includes(pid);
                players[pid] = {
                    name: pname(pid), positions: posOf(pid), proj: row.proj, floor: row.floor, ceiling: row.ceiling, locked: row.locked,
                    kick: g && g.kick ? Number(g.kick) : null, injury_status: p.injury_status || null, zero_reason: row.zero_reason || null,
                    why: (dhqRow(pid) || {}).why || null, roster_slot: onRoster ? slotOf(r, pid) : 'not on roster',
                };
            });
            // Win chance with the best lineup (for the close-call tiebreak).
            let winPct = null;
            try {
                const MU = App.Matchup;
                if (MU && MU.resolveOpponentRosterId && D.matchup) {
                    const oppRid = await withTimeout(MU.resolveOpponentRosterId({ league: Object.assign({ season: season() }, lg), myRosterId: r.roster_id, week: wk }), 4000, null);
                    const opp = oppRid != null ? rosters().find(x => String(x.roster_id) === String(oppRid)) : null;
                    const m = opp ? D.matchup(Object.values(chk.placed || {}).map(String), opp, lg.roster_positions || []) : null;
                    if (m && m.fc && m.fc.winPct != null) winPct = Number(m.fc.winPct);
                }
            } catch (e) { winPct = null; }
            let sleeperLoaded = null;
            try { const ds = D.dataStatus ? D.dataStatus() : null; if (ds && ds.sleeper) sleeperLoaded = !!ds.sleeper.ok; } catch (e) { /* unknown */ }
            // Kickoffs of the games not started yet (one per game), for "late game".
            const gameKicks = [];
            try {
                const games = (App.GameLocks && App.GameLocks._st && App.GameLocks._st.games) || {};
                const seen = new Set();
                Object.keys(games).forEach(t => { const g = games[t]; if (!g || g.locked || !(Number(g.kick) > 0)) return; const k = [t, g.opp].sort().join('@'); if (seen.has(k)) return; seen.add(k); gameKicks.push(Number(g.kick)); });
            } catch (e) { /* roster kicks are the fallback */ }
            const d = chk.delta || {};
            const res = startSitCall({
                week: wk, slots, current, placed: chk.placed || {}, current_total: d.currentTotal, best_total: d.optimalTotal,
                locks_loaded: locksLoaded(), sleeper_loaded: sleeperLoaded, win_pct: winPct, players, asked, not_found: notFound, game_kicks: gameKicks,
            });
            return Object.assign({ team: label(r) }, res);
        },
    });

    App.AskTools = App.AskTools || { register, defs, run, h, _tools: tools, _startSitCall: startSitCall, _zeroReason: zeroReason };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.AskTools;
})(typeof window !== 'undefined' ? window : globalThis);
