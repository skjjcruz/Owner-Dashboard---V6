// ══════════════════════════════════════════════════════════════════
// js/lab-ask.js — ASK (bring your own AI) · LAB ONLY
//
// Owner direction 2026-10-07: "Can we just do the lab first, don't want to
// break anything on the website or native app while we're messing around
// in the lab trying to find the best combination."
//
// What it is: one "Ask" button. The member connects THEIR OWN AI (an
// OpenRouter account — one sign-in reaches ChatGPT, Claude, Gemini and
// more), asks a question in plain English, and their AI works it out by
// calling read-only tools over the app's own engines (DHQ values, weekly
// projections, team assessments, owner DNA, trade math, playoff odds,
// waiver market) plus a web search for fresh news. The member's AI
// company bills the member; Dynasty HQ pays nothing and never sees or
// stores the key on a server — it lives in this browser only.
//
// Lab only: this file is injected by scripts/publish-lab.cjs into the Lab
// app page (with a Lab-only CSP entry for openrouter.ai). The website and
// the native app never load it. Nothing here writes to Sleeper or to any
// engine state; every tool reads.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (window.__dhqLabAsk) return;
    window.__dhqLabAsk = true;

    const OR = 'https://openrouter.ai';
    const KEY_STORE = 'dhq_lab_ai_key_v1';       // { key, via, at }
    const MODEL_STORE = 'dhq_lab_ai_model_v1';
    const PKCE_STORE = 'dhq_lab_ai_pkce_v1';     // sessionStorage: { verifier, state, back }
    const MAX_STEPS = 8;
    const RESULT_CAP = 12000;                    // chars per tool result sent back to the AI

    // ── small utils ───────────────────────────────────────────────────
    const ls = {
        get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } },
    };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const round1 = n => Math.round(Number(n || 0) * 10) / 10;
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

    function getKey() { const k = ls.get(KEY_STORE); return k && k.key ? k : null; }

    // ══════════════════════════════════════════════════════════════════
    // 1. THE APP'S DATA — read-only views over what the app already loaded
    // ══════════════════════════════════════════════════════════════════
    function ctx() {
        const S = window.S || (window.App && window.App.S) || {};
        const LI = (window.App && window.App.LI) || {};
        const lid = String(S.currentLeagueId || '');
        const lg = (S.leagues || []).find(l => String(l.league_id || l.id) === lid) || (S.leagues || [])[0] || {};
        return { S, LI, lid, lg, myRid: S.myRosterId, rosters: S.rosters || [], users: S.leagueUsers || [], players: S.players || {} };
    }
    function rosterOf(rid) { return ctx().rosters.find(r => String(r.roster_id) === String(rid)) || null; }
    function teamName(rid) {
        const c = ctx(), r = rosterOf(rid);
        if (!r) return 'Team ' + rid;
        const u = c.users.find(x => String(x.user_id) === String(r.owner_id)) || {};
        return (u.metadata && u.metadata.team_name) || u.display_name || ('Team ' + rid);
    }
    function ownerName(rid) {
        const c = ctx(), r = rosterOf(rid);
        const u = r ? (c.users.find(x => String(x.user_id) === String(r.owner_id)) || {}) : {};
        return u.display_name || '';
    }
    function whoRosters(pid) {
        const r = ctx().rosters.find(x => (x.players || []).map(String).includes(String(pid)));
        return r ? r.roster_id : null;
    }
    function pName(pid) {
        const p = ctx().players[pid];
        if (!p) return String(pid);
        return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || String(pid);
    }
    function dhq(pid) { const v = (ctx().LI.playerScores || {})[pid]; return v > 0 ? Math.round(v) : 0; }
    function nflWeek() {
        const n = ctx().S.nflState || {};
        return Number(n.display_week || n.week || 0) || 0;
    }
    function leagueFormat() {
        const { lg } = ctx();
        const sc = lg.scoring_settings || {}, pos = lg.roster_positions || [];
        const starters = pos.filter(p => !['BN', 'IR', 'TAXI'].includes(p));
        const idp = starters.some(p => /^(DL|LB|DB|IDP_FLEX|DE|DT|CB|S)$/.test(p));
        return {
            superflex: pos.includes('SUPER_FLEX'),
            ppr: Number(sc.rec || 0),
            te_premium: Number(sc.bonus_rec_te || 0),
            idp,
            starting_slots: starters,
            teams: ctx().rosters.length,
            faab_budget: Number((lg.settings || {}).waiver_budget || 0) || null,
            playoff_teams: Number((lg.settings || {}).playoff_teams || 0) || null,
            playoff_week_start: Number((lg.settings || {}).playoff_week_start || 0) || null,
            taxi_slots: Number((lg.settings || {}).taxi_slots || 0) || 0,
        };
    }

    // One row per player — the facts every tool shares.
    function playerRow(pid, extra) {
        const c = ctx(), p = c.players[pid] || {}, m = (c.LI.playerMeta || {})[pid] || {};
        let rank = null;
        try { rank = window.getPlayerRank ? window.getPlayerRank(pid) : null; } catch (e) { /* */ }
        const row = {
            id: String(pid), name: pName(pid), pos: m.pos || p.position || '', nfl_team: p.team || 'FA',
            age: p.age != null ? p.age : (m.age != null ? m.age : null),
            dhq_value: dhq(pid),
        };
        if (rank && rank.overall < 999) { row.league_rank = rank.overall; row.pos_rank = rank.pos; }
        if (m.ppg != null) row.ppg = round1(m.ppg);
        if (m.peakYrsLeft != null) row.peak_years_left = m.peakYrsLeft;
        if (m.ageCurvePhase) row.age_phase = m.ageCurvePhase;
        if (m.trend) row.value_trend_pct = m.trend;
        if (m.roleLabel) row.role = m.roleLabel;
        if (p.injury_status) row.injury = p.injury_status + (p.injury_body_part ? ' (' + p.injury_body_part + ')' : '');
        if (p.depth_chart_order != null && p.depth_chart_position) row.depth_chart = p.depth_chart_position + ' #' + p.depth_chart_order;
        return Object.assign(row, extra || {});
    }

    // One line per player, for long lists (rosters run 40+ deep in IDP leagues).
    function compactRow(x) {
        return [
            x.name + ' ' + x.pos + ' ' + x.nfl_team,
            x.age != null ? 'age ' + x.age : '',
            'DHQ ' + x.dhq_value + (x.league_rank ? ' (#' + x.league_rank + ', ' + x.pos + x.pos_rank + ')' : ''),
            x.ppg != null ? x.ppg + ' ppg' : '',
            x.peak_years_left != null ? x.peak_years_left + ' peak yrs, ' + (x.age_phase || '') : '',
            x.value_trend_pct ? 'trend ' + (x.value_trend_pct > 0 ? '+' : '') + x.value_trend_pct + '%' : '',
            x.injury ? 'INJ ' + x.injury : '',
            x.slot || '',
        ].filter(Boolean).join(' | ');
    }

    // Resolve "Puka Nacua" / "puka" / "8137" to a Sleeper player id. Prefers
    // players on a roster in this league, then higher DHQ value.
    function findPlayers(q, limit) {
        const c = ctx(); q = String(q || '').trim();
        if (!q) return [];
        if (/^\d+$/.test(q) && c.players[q]) return [q];
        if (/^[A-Z]{2,3}$/.test(q) && c.players[q]) return [q];
        const n = norm(q);
        const rostered = new Set(); c.rosters.forEach(r => (r.players || []).forEach(x => rostered.add(String(x))));
        const hits = [];
        for (const pid in c.players) {
            const p = c.players[pid];
            if (!p || (!p.active && !rostered.has(pid))) continue;
            const full = norm(p.full_name || ((p.first_name || '') + (p.last_name || '')));
            if (!full) continue;
            let score = 0;
            if (full === n) score = 3;
            else if (full.startsWith(n) || norm(p.last_name) === n) score = 2;
            else if (n.length >= 4 && full.includes(n)) score = 1;
            if (score) hits.push({ pid, score, ros: rostered.has(pid) ? 1 : 0, v: dhq(pid) });
        }
        hits.sort((a, b) => b.score - a.score || b.ros - a.ros || b.v - a.v);
        return hits.slice(0, limit || 5).map(h => h.pid);
    }
    function resolveOne(q) { const ids = findPlayers(q, 1); return ids[0] || null; }

    // Draft picks each roster owns (next three drafts not yet held).
    function picksByRoster() {
        const c = ctx();
        const cur = parseInt(c.S.season, 10) || new Date().getFullYear();
        const n = c.S.nflState || {};
        const draftDone = (c.S.drafts || []).some(d => String(d.season) === String(cur) && d.status === 'complete') || n.season_type === 'regular' || n.season_type === 'post';
        const years = [0, 1, 2].map(i => cur + (draftDone ? 1 : 0) + i);
        const rounds = Number((c.lg.settings || {}).draft_rounds) || 4;
        const away = new Set(), acq = {};
        (c.S.tradedPicks || []).forEach(p => {
            if (String(p.owner_id) === String(p.roster_id) || typeof p.round !== 'number') return;
            away.add(p.season + '|' + p.round + '|' + p.roster_id);
            const k = p.season + '|' + p.round + '|' + p.owner_id;
            (acq[k] = acq[k] || []).push(p.roster_id);
        });
        const out = {};
        c.rosters.forEach(r => {
            const rid = r.roster_id; out[rid] = [];
            years.forEach(y => {
                for (let rd = 1; rd <= rounds; rd++) {
                    if (!away.has(y + '|' + rd + '|' + rid)) out[rid].push({ year: y, round: rd, from: rid });
                    (acq[y + '|' + rd + '|' + rid] || []).forEach(o => out[rid].push({ year: y, round: rd, from: o }));
                }
            });
        });
        return out;
    }
    function pickValue(year, round, fromRid) {
        try {
            const PV = window.App && window.App.PlayerValue;
            if (PV && PV.resolvePickValue) return Math.round(PV.resolvePickValue(year, round, fromRid, ctx().rosters).value || 0);
        } catch (e) { /* */ }
        return 0;
    }
    function pickLabel(pk, holderRid) {
        return pk.year + ' ' + ord(pk.round) + (String(pk.from) !== String(holderRid) ? ' (from ' + teamName(pk.from) + ')' : '');
    }

    function assess(rid) {
        try { return window.assessTeamFromGlobal ? window.assessTeamFromGlobal(Number(rid)) : null; } catch (e) { return null; }
    }
    function assessBrief(a) {
        if (!a) return null;
        return {
            tier: a.tier, window: a.window, health_score: a.healthScore,
            needs: (a.needs || []).map(n => n.pos + (n.urgency ? ' (' + n.urgency + ')' : '')),
            strengths: a.strengths || [],
            faab_left: a.faabRemaining != null ? a.faabRemaining : undefined,
        };
    }
    function dnaOf(rid) {
        try { return window.computeWeightedDNA ? window.computeWeightedDNA(Number(rid)) : null; } catch (e) { return null; }
    }

    // DhqProj answers asynchronously (it queues players and projects in
    // batches). Ask, then wait briefly for the numbers to land.
    async function projections(pids, waitMs) {
        const P = window.App && window.App.DhqProj;
        if (!P || !P.get) return {};
        const ids = (pids || []).map(String);
        try { if (P.request) P.request(ids); } catch (e) { /* */ }
        const until = Date.now() + (waitMs || 9000);
        let out = {};
        while (true) {
            out = {}; let missing = 0;
            ids.forEach(pid => { const r = P.get(pid); if (r) out[pid] = r; else missing++; });
            if (!missing || Date.now() > until) break;
            await sleep(400);
        }
        return out;
    }
    function projRow(r) {
        if (!r) return { projection: 'not available yet' };
        if (r.noSleeper) return { projection: 'no Sleeper projection this week (not playing / not projected)' };
        return { proj_median: round1(r.median), proj_floor: round1(r.floor), proj_ceiling: round1(r.ceiling), proj_grade: r.grade, proj_call: r.verdict, proj_why: r.why || undefined };
    }

    function standings() {
        const c = ctx();
        return c.rosters.map(r => {
            const s = r.settings || {};
            return { roster_id: r.roster_id, team: teamName(r.roster_id), owner: ownerName(r.roster_id), wins: s.wins || 0, losses: s.losses || 0, ties: s.ties || 0, points_for: round1((s.fpts || 0) + (s.fpts_decimal || 0) / 100), mine: String(r.roster_id) === String(c.myRid) || undefined };
        }).sort((a, b) => b.wins - a.wins || b.points_for - a.points_for)
            .map((t, i) => Object.assign({ standing: i + 1 }, t));
    }

    // ══════════════════════════════════════════════════════════════════
    // 2. TOOLS — what the member's AI may call. All read-only.
    // ══════════════════════════════════════════════════════════════════
    const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: properties || {}, required: required || [] } } });
    const S_ = d => ({ type: 'string', description: d });
    const N_ = d => ({ type: 'number', description: d });
    const A_ = d => ({ type: 'array', items: { type: 'string' }, description: d });

    const TOOL_DEFS = [
        fn('get_league_overview', 'League basics: name, season, NFL week, scoring format (superflex, PPR, TE premium, IDP), starting slots, FAAB budget, playoff setup, and full standings. Call this first if you need context.'),
        fn('get_team', 'A team\'s full roster with each player\'s DHQ dynasty value, rank, age, points per game, peak years left, injury and lineup slot; plus the team\'s draft picks, record, tier (contender/rebuilding), competitive window, needs and strengths. Omit roster_id for the member\'s own team.', { roster_id: N_('Roster id from standings. Omit for my team.') }),
        fn('find_players', 'Search players by name. Returns ids, team, position, DHQ value and which fantasy team rosters them (or free agent).', { name: S_('Full or partial player name') }, ['name']),
        fn('get_player', 'Everything on one player: bio, NFL team, depth chart, injury, DHQ value and trend, age curve, role, league rank, who rosters him, the app\'s own buy/sell/hold read, and this week\'s projection.', { player: S_('Player name or id') }, ['player']),
        fn('get_weekly_projections', 'This week\'s fantasy projections in this league\'s scoring for several players: median, floor, ceiling, grade, start/sit call and the drivers behind it. Use for start/sit questions.', { players: A_('Player names or ids') }, ['players']),
        fn('get_my_matchup', 'This week\'s head-to-head matchup for the member: opponent, both lineups with projections, win probability, and any lineup changes that would add projected points.'),
        fn('evaluate_trade', 'Grade a trade with the app\'s trade engine. Sides can include players (names/ids) and picks written like "2027 1st" or "2028 round 2". Returns each piece\'s DHQ value, totals, the fairness grade, the chance the other owner accepts (based on their trade DNA and team needs), and how well the two rosters fit.', {
            give: A_('What the member sends: players and/or picks'),
            get: A_('What the member receives: players and/or picks'),
            partner_roster_id: N_('Roster id of the other team. Optional: inferred from who owns the players received.'),
        }, ['give', 'get']),
        fn('get_owner_profile', 'An owner\'s trading personality from this league\'s full trade history: DNA type and why, trade count, wins/losses on value, positions they buy and sell, favorite partners, and their recent deals.', { roster_id: N_('Roster id of the owner') }, ['roster_id']),
        fn('get_recent_trades', 'Completed trades in this league, newest first, with what each side got and who won on DHQ value.', { days: N_('Look-back window in days (default 30)'), roster_id: N_('Only trades involving this roster (optional)') }),
        fn('get_waiver_options', 'Best available free agents (not on any roster) ranked by DHQ value and this week\'s projection, Sleeper\'s trending adds, and a FAAB bid estimate from this league\'s bidding history when it is a FAAB league.', { position: S_('QB, RB, WR, TE, K, DL, LB, DB (optional)'), limit: N_('How many (default 8, max 15)') }),
        fn('get_season_outlook', 'Playoff and title odds for every team from a 10,000-run season simulation using real results and remaining schedule, plus each team\'s luck (wins above or below what their scoring deserved). Takes a few seconds.'),
        fn('get_player_news', 'The latest news blurb on a player (Rotowire via ESPN) with its date. Free and fast; use before a web search.', { player: S_('Player name or id') }, ['player']),
    ];

    const TOOLS = {
        get_league_overview() {
            const c = ctx(), n = c.S.nflState || {};
            return {
                league: c.lg.name, season: c.S.season, nfl_week: nflWeek(), season_type: n.season_type,
                format: leagueFormat(), my_roster_id: c.myRid, my_team: teamName(c.myRid), standings: standings(),
            };
        },
        get_team(a) {
            const c = ctx();
            const rid = a && a.roster_id != null ? a.roster_id : c.myRid;
            const r = rosterOf(rid);
            if (!r) return { error: 'No roster ' + rid + ' in this league. Use get_league_overview for roster ids.' };
            const starters = new Set((r.starters || []).map(String)), ir = new Set((r.reserve || []).map(String)), taxi = new Set((r.taxi || []).map(String));
            const rows = (r.players || []).map(String).map(pid => playerRow(pid, { slot: starters.has(pid) ? 'starter' : ir.has(pid) ? 'IR' : taxi.has(pid) ? 'taxi' : 'bench' }))
                .sort((x, y) => y.dhq_value - x.dhq_value);
            const picks = (picksByRoster()[r.roster_id] || []).map(pk => pickLabel(pk, r.roster_id) + ' · DHQ ' + pickValue(pk.year, pk.round, pk.from));
            const s = r.settings || {};
            return {
                roster_id: r.roster_id, team: teamName(r.roster_id), owner: ownerName(r.roster_id), is_mine: String(r.roster_id) === String(c.myRid),
                record: (s.wins || 0) + '-' + (s.losses || 0) + (s.ties ? '-' + s.ties : ''), points_for: round1((s.fpts || 0) + (s.fpts_decimal || 0) / 100),
                assessment: assessBrief(assess(r.roster_id)),
                total_dhq_value: rows.reduce((t, p) => t + p.dhq_value, 0),
                players_key: 'name pos NFL-team | age | DHQ value (league rank, position rank) | points per game | peak years left, age phase | value trend | injury | slot',
                players: rows.map(compactRow), picks,
            };
        },
        find_players(a) {
            return findPlayers(a && a.name, 6).map(pid => {
                const rid = whoRosters(pid);
                return Object.assign(playerRow(pid), { rostered_by: rid ? teamName(rid) + ' (roster ' + rid + ')' : 'free agent' });
            });
        },
        async get_player(a) {
            const pid = resolveOne(a && a.player);
            if (!pid) return { error: 'No player matches "' + (a && a.player) + '". Try find_players.' };
            const c = ctx(), p = c.players[pid] || {}, m = (c.LI.playerMeta || {})[pid] || {};
            const rid = whoRosters(pid);
            let action = null; try { action = window.App.getPlayerAction ? window.App.getPlayerAction(pid) : null; } catch (e) { /* */ }
            const pr = await projections([pid], 7000);
            return Object.assign(playerRow(pid), {
                rostered_by: rid ? teamName(rid) + ' (roster ' + rid + ')' : 'free agent',
                years_exp: p.years_exp, college: p.college, status: p.status,
                injury_notes: p.injury_notes || undefined,
                last_season_ppg: m.lastYearPPG != null ? round1(m.lastYearPPG) : undefined,
                career_ppg: m.careerPPG != null ? round1(m.careerPPG) : undefined,
                games_recent: m.recentGP,
                status_note: m.statusReason || undefined,
                app_read: action ? action.label + ' — ' + action.reason : undefined,
                this_week: projRow(pr[pid]),
            });
        },
        async get_weekly_projections(a) {
            const ids = [], unknown = [];
            (a && a.players || []).slice(0, 20).forEach(q => { const pid = resolveOne(q); if (pid) ids.push(pid); else unknown.push(q); });
            const pr = await projections(ids, 9000);
            return { week: nflWeek(), players: ids.map(pid => Object.assign({ name: pName(pid), pos: playerRow(pid).pos, nfl_team: (ctx().players[pid] || {}).team, injury: (ctx().players[pid] || {}).injury_status || undefined }, projRow(pr[pid]))), not_found: unknown.length ? unknown : undefined };
        },
        async get_my_matchup() {
            const c = ctx(), wk = nflWeek();
            if (!c.lid || !wk) return { error: 'No week in progress.' };
            let rows = [];
            try { rows = (await window.fetchMatchups(c.lid, wk)) || []; } catch (e) { return { error: 'Could not load this week\'s matchups from Sleeper.' }; }
            const me = rows.find(x => String(x.roster_id) === String(c.myRid));
            if (!me || me.matchup_id == null) return { week: wk, note: 'No head-to-head matchup for you this week (bye or playoffs).' };
            const opp = rows.find(x => x.matchup_id === me.matchup_id && String(x.roster_id) !== String(c.myRid));
            const myR = rosterOf(c.myRid), oppR = opp ? rosterOf(opp.roster_id) : null;
            const mine = (myR && myR.starters || []).filter(x => x && x !== '0').map(String);
            const theirs = (oppR && oppR.starters || []).filter(x => x && x !== '0').map(String);
            const pr = await projections(mine.concat(theirs).concat((myR && myR.players || []).map(String)), 10000);
            const line = pid => {
                const r = pr[pid], who = pName(pid) + ' ' + playerRow(pid).pos + ((ctx().players[pid] || {}).injury_status ? ' (' + ctx().players[pid].injury_status + ')' : '');
                if (!r) return who + ': no projection yet';
                if (r.noSleeper) return who + ': not projected this week';
                return who + ': ' + round1(r.median) + ' (' + round1(r.floor) + '–' + round1(r.ceiling) + ') ' + (r.verdict || '');
            };
            let fc = null, check = null;
            try { const m = window.App.DhqProj.matchup(mine, oppR, c.lg.roster_positions || []); if (m && m.fc) fc = m.fc; } catch (e) { /* */ }
            try { check = window.App.DhqProj.lineupCheck(myR, c.lg); } catch (e) { /* */ }
            const out = {
                week: wk, opponent: opp ? teamName(opp.roster_id) + ' (roster ' + opp.roster_id + ')' : 'unknown',
                live_score: me.points || opp && opp.points ? { me: round1(me.points), them: round1(opp && opp.points) } : undefined,
            };
            if (fc) out.forecast = { my_win_pct: fc.winPct != null ? fc.winPct : undefined, my_projected: round1(fc.projMe), their_projected: round1(fc.projOpp), margin: fc.margin };
            if (check && check.delta) {
                const d = check.delta;
                out.lineup_check = d.isOptimal ? 'Lineup is already the best by projection.' : {
                    points_left_on_bench: d.delta,
                    start_instead: d.startInstead.map(x => pName(x.pid) + ' at ' + x.slot + ' (' + round1(x.pts) + ')'),
                    bench_instead: d.benchInstead.map(pName),
                };
            }
            out.lineup_key = 'player pos: projected points (floor–ceiling) start/sit call';
            out.my_lineup = mine.map(line);
            out.their_lineup = theirs.map(line);
            return out;
        },
        evaluate_trade(a) {
            const c = ctx();
            const picks = picksByRoster();
            const notes = [];
            function parsePick(s) {
                const m = String(s).match(/(20\d\d)\s*(?:round\s*|rd\s*|r)?(\d)(?:st|nd|rd|th)?/i);
                return m ? { year: Number(m[1]), round: Number(m[2]) } : null;
            }
            function side(list, holderRid) {
                return (list || []).map(q => {
                    const pk = /20\d\d/.test(q) && !resolveOneStrict(q) ? parsePick(q) : null;
                    if (pk) {
                        const own = (picks[holderRid] || []).filter(x => x.year === pk.year && x.round === pk.round);
                        const use = own.find(x => String(x.from) === String(holderRid)) || own[0];
                        if (!use) notes.push((holderRid != null ? teamName(holderRid) : 'That team') + ' does not own a ' + pk.year + ' ' + ord(pk.round) + ' (valued as a mid pick anyway).');
                        const from = use ? use.from : holderRid;
                        return { piece: use ? pickLabel(use, holderRid) : pk.year + ' ' + ord(pk.round), type: 'pick', dhq_value: pickValue(pk.year, pk.round, from) };
                    }
                    const pid = resolveOne(q);
                    if (!pid) { notes.push('Could not find "' + q + '".'); return null; }
                    const owner = whoRosters(pid);
                    if (holderRid != null && String(owner) !== String(holderRid)) notes.push(pName(pid) + ' is not on ' + teamName(holderRid) + (owner ? ' (he is on ' + teamName(owner) + ')' : ' (free agent)') + '.');
                    return { piece: pName(pid), type: 'player', pos: playerRow(pid).pos, age: playerRow(pid).age, dhq_value: dhq(pid) };
                }).filter(Boolean);
            }
            // Partner: given, or whoever rosters the first player received.
            let partner = a && a.partner_roster_id != null ? a.partner_roster_id : null;
            if (partner == null) {
                for (const q of (a && a.get || [])) { const pid = resolveOne(q); const o = pid ? whoRosters(pid) : null; if (o && String(o) !== String(c.myRid)) { partner = o; break; } }
            }
            const give = side(a && a.give, c.myRid), get = side(a && a.get, partner);
            const giveV = give.reduce((t, x) => t + x.dhq_value, 0), getV = get.reduce((t, x) => t + x.dhq_value, 0);
            const TE = window.App && window.App.TradeEngine;
            const out = {
                partner: partner != null ? teamName(partner) + ' (roster ' + partner + ')' : 'unknown',
                you_give: give, you_get: get, total_give: giveV, total_get: getV,
                net_for_you: getV - giveV,
                value_basis: 'Straight sum of DHQ values. The app\'s Trade Builder also adjusts for roster spots and pick slots, so its grade can differ slightly.',
            };
            if (TE) {
                try { out.fairness = TE.fairnessGrade(giveV, getV).grade + ' — ' + TE.fairnessGrade(giveV, getV).label; } catch (e) { /* */ }
                if (partner != null) {
                    const mine = assess(c.myRid), theirs = assess(partner), dna = dnaOf(partner);
                    const key = dna && dna.key ? dna.key : 'NONE';
                    try {
                        const posture = TE.calcOwnerPosture(theirs, key);
                        const taxes = TE.calcPsychTaxes(mine, theirs, key, posture) || [];
                        out.their_dna = dna ? key + ' (' + dna.confidence + '% confidence): ' + (dna.reasoning || '') : 'Not enough trades to read their DNA.';
                        out.their_posture = posture && posture.label ? posture.label + ' — ' + posture.desc : undefined;
                        out.acceptance_chance_pct = TE.calcAcceptanceLikelihood(giveV, getV, key, taxes, mine, theirs, { totalPieces: give.length + get.length });
                        out.psychology = taxes.filter(t => t.impact).map(t => t.name + ' (' + (t.impact > 0 ? '+' : '') + t.impact + '): ' + t.desc);
                        out.roster_fit_0_100 = TE.calcComplementarity(mine, theirs);
                        out.my_needs = assessBrief(mine) && assessBrief(mine).needs;
                        out.their_needs = assessBrief(theirs) && assessBrief(theirs).needs;
                    } catch (e) { notes.push('Acceptance model unavailable: ' + e.message); }
                }
            }
            if (notes.length) out.notes = notes;
            return out;
        },
        get_owner_profile(a) {
            const c = ctx(), rid = a && a.roster_id;
            if (!rosterOf(rid)) return { error: 'No roster ' + rid + '.' };
            const pr = (c.LI.ownerProfiles || {})[rid];
            const dna = dnaOf(rid);
            const out = { roster_id: rid, team: teamName(rid), owner: ownerName(rid) };
            if (dna) out.dna = { type: dna.key, confidence_pct: dna.confidence, why: dna.reasoning };
            if (pr) {
                Object.assign(out, {
                    style: pr.dna, trades_total: pr.trades, trades_won: pr.tradesWon, trades_lost: pr.tradesLost, trades_fair: pr.tradesFair,
                    avg_value_edge: pr.avgValueDiff, favorite_target_pos: pr.targetPos,
                    positions_bought: pr.posAcquired, positions_sold: pr.posSold,
                    picks_bought: pr.picksAcquired, picks_sold: pr.picksSold,
                    top_partners: Object.entries(pr.partners || {}).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([r, n]) => teamName(r) + ' x' + n),
                });
            }
            out.recent_trades = TOOLS.get_recent_trades({ days: 400, roster_id: rid }).trades.slice(0, 5);
            out.team_now = assessBrief(assess(rid));
            return out;
        },
        get_recent_trades(a) {
            const c = ctx();
            const days = Math.max(1, Math.min(1500, Number(a && a.days) || 30));
            const since = Date.now() - days * 86400000;
            const rid = a && a.roster_id != null ? String(a.roster_id) : null;
            const list = (c.LI.tradeHistory || []).filter(t => (t.ts || 0) >= since && (!rid || (t.roster_ids || []).map(String).includes(rid)))
                .sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, 15);
            return {
                days, count: list.length,
                trades: list.map(t => ({
                    date: t.ts ? new Date(t.ts).toISOString().slice(0, 10) : t.season + ' wk ' + t.week,
                    sides: Object.entries(t.sides || {}).map(([r, s]) => ({
                        team: teamName(r),
                        got: (s.players || []).map(pName).concat((s.picks || []).map(p => p.season + ' ' + ord(p.round))),
                        value_got: s.totalValue,
                    })),
                    winner: t.winner != null ? teamName(t.winner) : 'even', value_gap_pct: t.valueDiffPct != null ? Math.round(t.valueDiffPct) : undefined,
                })),
            };
        },
        async get_waiver_options(a) {
            const c = ctx();
            const pos = String(a && a.position || '').toUpperCase();
            const limit = Math.max(1, Math.min(15, Number(a && a.limit) || 8));
            const rostered = new Set(); c.rosters.forEach(r => (r.players || []).forEach(x => rostered.add(String(x))));
            const pool = Object.keys(c.LI.playerScores || {}).filter(pid => !rostered.has(pid) && c.players[pid] && c.players[pid].team && c.players[pid].active !== false)
                .filter(pid => !pos || playerRow(pid).pos === pos || (c.players[pid].fantasy_positions || []).includes(pos))
                .sort((x, y) => dhq(y) - dhq(x)).slice(0, limit);
            const pr = await projections(pool, 7000);
            let trending = [];
            try {
                const t = window.fetchTrending ? await window.fetchTrending('add', 24, 25) : [];
                trending = (t || []).map(x => String(x.player_id)).filter(pid => !rostered.has(pid) && (!pos || playerRow(pid).pos === pos)).slice(0, 8)
                    .map(pid => ({ name: pName(pid), pos: playerRow(pid).pos, nfl_team: (c.players[pid] || {}).team, dhq_value: dhq(pid), adds_24h: ((t.find(x => String(x.player_id) === pid)) || {}).count }));
            } catch (e) { /* */ }
            // The same bid model every FA surface uses (App.faModelBid when the
            // FA tab's code is loaded; otherwise the identical engine call the
            // FAAB widget makes on the cached bid history).
            const F = window.App && window.App.Faab;
            const lgFull = Object.assign({}, c.lg, { rosters: c.rosters });
            const myRoster = rosterOf(c.myRid);
            const W = window.WrTxns;
            const txns = W ? [].concat(W.getCached ? (W.getCached(c.lid) || []) : [], W.getFailedWaivers ? (W.getFailedWaivers(c.lid) || []) : []) : [];
            const bid = pid => {
                const pos = playerRow(pid).pos;
                let e = null;
                try {
                    if (window.App.faModelBid) e = window.App.faModelBid({ league: lgFull, myRoster, playersData: c.players, pid, pos });
                    else if (F && F.estimate) e = F.estimate({ league: lgFull, myRosterId: c.myRid, txns, playersData: c.players, targetPid: pid, targetPos: pos, dhq: dhq(pid), playerValue: rp => dhq(rp) });
                } catch (err) { e = null; }
                return e ? '$' + e.sug + ' (range $' + e.lo + '–$' + e.hi + (e.coldStart ? ', thin bid history' : '') + ')' : undefined;
            };
            const mine = assess(c.myRid);
            return {
                faab_left: mine && mine.faabRemaining != null ? mine.faabRemaining : undefined,
                best_available: pool.map(pid => Object.assign(playerRow(pid), projRow(pr[pid]), { faab_bid_estimate: bid(pid) })),
                trending_adds_on_sleeper: trending,
            };
        },
        async get_season_outlook() {
            const c = ctx(), Luck = window.App && window.App.Luck, PO = window.App && window.App.PlayoffOdds;
            if (!Luck || !PO) return { error: 'Season odds engine not loaded.' };
            const league = Object.assign({}, c.lg, { rosters: c.rosters, season: c.S.season });
            const pws = Number((c.lg.settings || {}).playoff_week_start) || 15;
            const lastReg = Math.max(1, Math.min(18, pws - 1));
            const ledger = await Luck.build({ league });
            const wk = nflWeek();
            const out = { weeks_played: ledger.weeks.length, playoff_teams: (c.lg.settings || {}).playoff_teams };
            const luck = {}; (ledger.rows || []).forEach(r => { luck[String(r.rosterId)] = r.luck; });
            if (ledger.weeks.length >= 2 && wk <= lastReg) {
                const futurePairs = await PO.fetchFuturePairs({ league, fromWeek: wk, toWeek: lastReg });
                const sim = PO.simulate({ league, ledger, futurePairs, myRosterId: c.myRid, sims: 10000 });
                out.teams = (sim.rows || []).map(r => ({ team: teamName(r.rosterId), record: r.record, playoff_pct: r.playoffPct, title_pct: r.titlePct, proj_final_record: r.projWins + '-' + r.projLosses, luck_wins: luck[String(r.rosterId)], mine: String(r.rosterId) === String(c.myRid) || undefined }));
                if (sim.leverage) out.my_swing_this_week = sim.leverage;
            } else {
                out.teams = (ledger.rows || []).map(r => ({ team: teamName(r.rosterId), record: r.wins + '-' + r.losses, luck_wins: r.luck }));
                out.note = 'Too early (or too late) in the season to simulate odds.';
            }
            out.luck_meaning = 'luck_wins > 0: more wins than their weekly scores deserved (due to regress); < 0: unlucky, stronger than their record.';
            return out;
        },
        async get_player_news(a) {
            const pid = resolveOne(a && a.player);
            if (!pid) return { error: 'No player matches "' + (a && a.player) + '".' };
            const W = window.WR && window.WR.PlayerWire;
            if (!W || !W.fetchRead) return { error: 'News reader not loaded.' };
            const r = await W.fetchRead(pid, ctx().players);
            if (!r) return { player: pName(pid), news: 'No recent news blurb found.' };
            return { player: pName(pid), headline: r.headline || undefined, news: r.story, published: r.dateLabel || r.published, source: r.source };
        },
    };
    // Strict id match so a pick like "2027 1st" never resolves to a player.
    function resolveOneStrict(q) { const c = ctx(); return /^\d+$/.test(String(q)) && c.players[q] ? q : null; }

    const TOOL_LABEL = {
        get_league_overview: 'Read the league setup and standings',
        get_team: a => 'Read ' + (a && a.roster_id != null && String(a.roster_id) !== String(ctx().myRid) ? teamName(a.roster_id) + '\'s' : 'your') + ' roster',
        find_players: a => 'Looked up "' + (a && a.name) + '"',
        get_player: a => 'Pulled ' + (a && a.player) + '\'s profile',
        get_weekly_projections: a => 'Checked projections (' + ((a && a.players) || []).length + ' players)',
        get_my_matchup: 'Checked this week\'s matchup',
        evaluate_trade: 'Ran the trade engine',
        get_owner_profile: a => 'Read ' + teamName(a && a.roster_id) + '\'s trade DNA',
        get_recent_trades: 'Read recent trades',
        get_waiver_options: a => 'Scanned waivers' + (a && a.position ? ' (' + a.position + ')' : ''),
        get_season_outlook: 'Simulated the season 10,000 times',
        get_player_news: a => 'Read news on ' + (a && a.player),
    };

    async function runTool(name, args) {
        const t = TOOLS[name];
        if (!t) return { error: 'Unknown tool ' + name };
        try { return await t(args || {}); } catch (e) { return { error: 'Tool failed: ' + (e && e.message || e) }; }
    }

    // ══════════════════════════════════════════════════════════════════
    // 3. THE AGENT — the member's AI, called straight from this browser
    // ══════════════════════════════════════════════════════════════════
    function systemPrompt() {
        const c = ctx(), f = leagueFormat();
        const fmt = [f.teams + ' teams', f.superflex ? 'superflex' : '1QB', f.ppr ? f.ppr + ' PPR' : 'standard', f.te_premium ? 'TE premium +' + f.te_premium : '', f.idp ? 'IDP' : ''].filter(Boolean).join(', ');
        const page = (location.hash.match(/tab=([a-z]+)/) || [])[1] || 'home';
        return [
            'You are the analyst inside Dynasty HQ, a dynasty fantasy football app. You work for one member: ' + teamName(c.myRid) + ' (roster ' + c.myRid + ') in "' + (c.lg.name || 'their league') + '" (' + fmt + '). Today is ' + new Date().toDateString() + ', NFL week ' + nflWeek() + ' of the ' + c.S.season + ' season. The member is looking at the "' + page + '" screen.',
            '',
            'How you work:',
            '- Get facts from the tools. Never guess a number, roster, record, pick or player detail. If a tool did not give it to you, you do not know it.',
            '- The truth rule: league facts come from Sleeper through the tools. If something is not there, say so plainly instead of filling the gap from memory.',
            '- Your own memory of the NFL is out of date. For injuries, depth charts and recent news, call get_player_news first, then use web search for anything newer or for team-level news.',
            '- DHQ value is this app\'s dynasty trade value for this league (higher is better; roughly 7,000+ is elite, 3,000+ a solid starter, under 1,000 a depth piece). Weekly projections are points this week in this league\'s scoring.',
            '- Think like a sharp, honest dynasty GM. Weigh this season against the long game, the member\'s competitive window, and the other owner\'s habits. Have an opinion.',
            '',
            'How you answer:',
            '- First line: the answer, in one sentence, in bold.',
            '- Then 2 to 5 short bullets with the reasons and the key numbers.',
            '- If it helps, end with one line: "What would change my mind: ...".',
            '- Under 200 words unless the member asks for more. Plain English, no jargon, no tool names.',
            '- Link any web source you used as a markdown link.',
            '- You cannot make moves in Sleeper. Tell the member exactly what to do.',
        ].join('\n');
    }

    async function orFetch(path, body, key) {
        const res = await fetch(OR + path, {
            method: body ? 'POST' : 'GET',
            headers: Object.assign({ 'Authorization': 'Bearer ' + key, 'HTTP-Referer': location.origin + location.pathname, 'X-Title': 'Dynasty HQ (Lab)' }, body ? { 'Content-Type': 'application/json' } : {}),
            body: body ? JSON.stringify(body) : undefined,
        });
        let json = null; try { json = await res.json(); } catch (e) { /* */ }
        if (!res.ok || (json && json.error && !json.choices)) {
            const msg = (json && json.error && (json.error.message || json.error)) || ('HTTP ' + res.status);
            const err = new Error(String(msg)); err.status = res.status; throw err;
        }
        return json;
    }

    // One question, start to finish. onStep(label) narrates progress.
    async function ask(thread, onStep) {
        const k = getKey();
        if (!k) throw new Error('Connect your AI first.');
        const model = currentModel();
        const msgs = [{ role: 'system', content: systemPrompt() }].concat(thread);
        let cost = 0, webOk = true;
        const sources = new Map();
        const used = [];
        for (let step = 0; step < MAX_STEPS; step++) {
            const tools = TOOL_DEFS.slice();
            if (webOk) tools.push({ type: 'openrouter:web_search', parameters: { max_results: 5, max_uses: 3 } });
            const body = { model, messages: msgs, tools, max_tokens: 1800 };
            if (step === MAX_STEPS - 1) body.tool_choice = 'none';
            let res;
            try { res = await orFetch('/api/v1/chat/completions', body, k.key); }
            catch (e) {
                // A model or route that refuses the web-search tool: drop it and go on.
                if (webOk && (e.status === 400 || /web_search|server tool|tool type|unsupported/i.test(e.message))) { webOk = false; onStep('Web search is not available on this model — continuing without it'); step--; continue; }
                if (e.status === 401) throw new Error('Your AI connection was refused (key revoked or expired). Reconnect in settings.');
                if (e.status === 402) throw new Error('Your OpenRouter account is out of credit. Add a few dollars at openrouter.ai/credits, then ask again.');
                throw e;
            }
            if (res.usage && res.usage.cost != null) cost += Number(res.usage.cost) || 0;
            const choice = (res.choices || [])[0] || {};
            const msg = choice.message || {};
            (msg.annotations || []).forEach(an => { const u = an && an.url_citation; if (u && u.url) sources.set(u.url, u.title || u.url); });
            const calls = msg.tool_calls || [];
            if (!calls.length) {
                thread.push({ role: 'assistant', content: msg.content || '' });
                return { text: msg.content || '(No answer came back. Try asking again.)', cost, model: res.model || model, sources: [...sources].map(([url, title]) => ({ url, title })), used };
            }
            msgs.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
            for (const call of calls) {
                let args = {};
                try { args = JSON.parse(call.function && call.function.arguments || '{}') || {}; } catch (e) { /* */ }
                const name = call.function && call.function.name;
                const lab = TOOL_LABEL[name];
                const label = typeof lab === 'function' ? lab(args) : (lab || name);
                onStep(label); used.push(label);
                const result = await runTool(name, args);
                let text = JSON.stringify(result);
                if (text.length > RESULT_CAP) text = text.slice(0, RESULT_CAP) + '…(trimmed)';
                msgs.push({ role: 'tool', tool_call_id: call.id, content: text });
            }
        }
        throw new Error('The AI took too many steps without answering. Try a narrower question.');
    }

    // ── models ────────────────────────────────────────────────────────
    // Families the member can pick from; the newest of each that supports
    // tools is offered (read live from OpenRouter, so it never goes stale).
    const FAMILIES = [
        { re: /^anthropic\/claude-sonnet-[\d.]+$/, tag: 'Best reasoning' },
        { re: /^openai\/gpt-[\d.]+-sol$/, tag: 'Best reasoning' },
        { re: /^google\/gemini-[\d.]+-pro(-preview)?$/, tag: 'Strong' },
        { re: /^google\/gemini-[\d.]+-flash$/, tag: 'Fast' },
        { re: /^x-ai\/grok-[\d.]+$/, tag: 'Strong' },
        { re: /^anthropic\/claude-haiku-[\d.]+$/, tag: 'Cheapest' },
        { re: /^openai\/gpt-[\d.]+-luna$/, tag: 'Cheapest' },
    ];
    let modelList = null;
    async function loadModels() {
        if (modelList) return modelList;
        const res = await fetch(OR + '/api/v1/models');
        const all = ((await res.json()) || {}).data || [];
        const tooled = all.filter(m => (m.supported_parameters || []).includes('tools'));
        const out = [];
        FAMILIES.forEach(f => {
            const best = tooled.filter(m => f.re.test(m.id)).sort((a, b) => (b.created || 0) - (a.created || 0))[0];
            if (best && !out.some(x => x.id === best.id)) {
                const p = best.pricing || {};
                const perQ = (Number(p.prompt) || 0) * 20000 + (Number(p.completion) || 0) * 1000;
                out.push({ id: best.id, name: best.name || best.id, tag: f.tag, perQ });
            }
        });
        modelList = out;
        return out;
    }
    function currentModel() { return ls.get(MODEL_STORE) || (modelList && modelList[0] && modelList[0].id) || 'anthropic/claude-sonnet-5.5'; }
    function centsLabel(usd) {
        if (!(usd > 0)) return 'free';
        const c = usd * 100;
        return c < 0.1 ? 'under 0.1¢' : c < 10 ? c.toFixed(1) + '¢' : '$' + usd.toFixed(2);
    }

    // ── connecting: OpenRouter sign-in (PKCE) or a pasted key ─────────
    function b64url(bytes) { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return window.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    async function startSignIn() {
        const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
        const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
        const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        try { sessionStorage.setItem(PKCE_STORE, JSON.stringify({ verifier, state, back: location.href })); } catch (e) { /* */ }
        const cb = location.origin + location.pathname.replace(/[^/]*$/, '') + 'ask-callback.html';
        location.href = OR + '/auth?callback_url=' + encodeURIComponent(cb) + '&code_challenge=' + challenge + '&code_challenge_method=S256&state=' + state + '&key_label=' + encodeURIComponent('Dynasty HQ (Lab)');
    }
    async function keyInfo() {
        const k = getKey(); if (!k) return null;
        try { const j = await orFetch('/api/v1/key', null, k.key); return j && j.data; } catch (e) { return { error: e.message, status: e.status }; }
    }

    // ══════════════════════════════════════════════════════════════════
    // 4. THE PANEL
    // ══════════════════════════════════════════════════════════════════
    const STARTERS = {
        lineup: ['Who should I start this week, and why?', 'Can I win my matchup this week?', 'Any injury news I need to act on before kickoff?'],
        trades: ['Who is my best trade partner right now, and what should I offer?', 'Which owner in my league overpays the most?', 'Find me an upgrade at my weakest position without giving up my young core'],
        myteam: ['Who on my roster should I sell before their value drops?', 'Am I a contender or should I rebuild?', 'Who is my most overrated player?'],
        fa: ['Who should I bid on this week, and how much?', 'Is there a breakout pickup I should stash?'],
        compare: ['Where does my team lose to the best team in the league?', 'Who is my biggest rival this year and how do I beat them?'],
        draft: ['How should I use my picks in the next rookie draft?', 'Are my picks worth more to trade or to use?'],
        home: ['What is my #1 move this week?', 'Am I making the playoffs? Should I buy or sell?', 'Did any recent trade in my league hurt me?'],
    };
    function starters() {
        const tab = (location.hash.match(/tab=([a-z]+)/) || [])[1] || 'home';
        const key = ({ dashboard: 'home', analytics: 'home', wire: 'home', alex: 'home', strategy: 'myteam', trophies: 'home', calendar: 'home' })[tab] || tab;
        return STARTERS[key] || STARTERS.home;
    }

    const state = { open: false, view: 'chat', thread: [], items: [], busy: false };

    function mdToHtml(md) {
        const lines = esc(md || '').split(/\r?\n/);
        let html = '', inList = false;
        const inline = s => s
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => '<a href="' + u.replace(/&amp;/g, '&').replace(/"/g, '%22') + '" target="_blank" rel="noopener noreferrer">' + t + '</a>')
            .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
            .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
        lines.forEach(l => {
            const b = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
            if (b) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(b[1]) + '</li>'; return; }
            if (inList) { html += '</ul>'; inList = false; }
            const h = l.match(/^\s*#{1,4}\s+(.*)$/);
            if (h) { html += '<p><b>' + inline(h[1]) + '</b></p>'; return; }
            if (l.trim()) html += '<p>' + inline(l) + '</p>';
        });
        if (inList) html += '</ul>';
        return html;
    }

    function css() {
        const s = document.createElement('style');
        s.textContent = [
            '#lab-ask-btn{position:fixed;right:18px;bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:9000;display:flex;align-items:center;gap:7px;padding:11px 16px;border:none;border-radius:999px;background:var(--gold,#D4AF37);color:#111;font:800 0.86rem/1 system-ui,-apple-system,sans-serif;letter-spacing:0.02em;box-shadow:0 8px 24px rgba(0,0,0,0.45);cursor:pointer}',
            '#lab-ask-btn em{font-style:normal;font-weight:700;font-size:0.62rem;background:#111;color:var(--gold,#D4AF37);padding:3px 6px;border-radius:var(--card-radius-xs,5px)}',
            '@media(max-width:820px){#lab-ask-btn{bottom:calc(84px + env(safe-area-inset-bottom,0px));right:12px}}',
            '#lab-ask{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:9001;display:none;flex-direction:column;background:var(--off-black,#0d0d0d);border-left:1px solid rgba(212,175,55,0.45);box-shadow:-12px 0 40px rgba(0,0,0,0.55);color:var(--silver,#d6d6d6);font:0.9rem/1.5 system-ui,-apple-system,sans-serif}',
            '#lab-ask.open{display:flex}',
            '.la-head{display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top,0px)) 14px 10px;border-bottom:1px solid rgba(255,255,255,0.08)}',
            '.la-title{flex:1;min-width:0}.la-title b{color:var(--gold,#D4AF37);letter-spacing:0.05em;font-size:0.82rem}.la-title div{font-size:0.72rem;opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.la-icon{background:none;border:1px solid rgba(255,255,255,0.15);color:inherit;border-radius:var(--card-radius-sm,8px);padding:6px 9px;cursor:pointer;font-size:0.8rem}',
            '.la-body{flex:1;overflow-y:auto;padding:14px;-webkit-overflow-scrolling:touch}',
            '.la-card{border:1px solid rgba(255,255,255,0.1);border-radius:var(--card-radius,10px);padding:14px;margin-bottom:12px;background:rgba(255,255,255,0.02)}',
            '.la-card h3{margin:0 0 6px;font-size:1rem;color:#fff}.la-card p{margin:6px 0}.la-muted{opacity:0.7;font-size:0.8rem}',
            '.la-primary{display:block;width:100%;margin-top:10px;padding:11px 14px;border:none;border-radius:var(--card-radius-sm,8px);background:var(--gold,#D4AF37);color:#111;font-weight:800;cursor:pointer;font-size:0.9rem}',
            '.la-secondary{display:block;width:100%;margin-top:8px;padding:10px 14px;border:1px solid rgba(255,255,255,0.2);border-radius:var(--card-radius-sm,8px);background:none;color:inherit;font-weight:600;cursor:pointer}',
            '.la-input{width:100%;box-sizing:border-box;background:#000;border:1px solid rgba(255,255,255,0.2);border-radius:var(--card-radius-sm,8px);color:#eee;padding:9px 10px;font-size:0.9rem}',
            '.la-chip{display:block;width:100%;text-align:left;margin:0 0 8px;padding:10px 12px;border:1px solid rgba(212,175,55,0.35);border-radius:var(--card-radius-sm,8px);background:rgba(212,175,55,0.06);color:inherit;cursor:pointer;font-size:0.86rem}',
            '.la-q{margin:4px 0 10px auto;max-width:88%;padding:9px 12px;border-radius:var(--card-radius,10px);background:rgba(212,175,55,0.14);color:#fff;width:fit-content}',
            '.la-a{margin:0 0 14px;padding:12px 13px;border-radius:var(--card-radius,10px);background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)}',
            '.la-a p{margin:0 0 8px}.la-a ul{margin:4px 0 8px;padding-left:18px}.la-a li{margin:3px 0}.la-a a{color:var(--gold,#D4AF37)}.la-a b{color:#fff}',
            '.la-steps{margin:8px 0 0;padding:8px 0 0;border-top:1px dashed rgba(255,255,255,0.12);font-size:0.74rem;opacity:0.75}',
            '.la-steps span{display:inline-block;margin:0 6px 4px 0;padding:2px 7px;border-radius:var(--card-radius-xs,5px);background:rgba(255,255,255,0.06)}',
            '.la-live{font-size:0.8rem;opacity:0.85;margin:0 0 14px}.la-live div{margin:3px 0}.la-live div:last-child::after{content:" …";}',
            '.la-err{color:#ff9d9d;border-color:rgba(255,120,120,0.35)}',
            '.la-foot{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(255,255,255,0.08)}',
            '.la-foot textarea{flex:1;resize:none;height:44px;background:#000;border:1px solid rgba(255,255,255,0.2);border-radius:var(--card-radius-sm,8px);color:#eee;padding:10px;font:inherit}',
            '.la-foot button{border:none;border-radius:var(--card-radius-sm,8px);background:var(--gold,#D4AF37);color:#111;font-weight:800;padding:0 16px;cursor:pointer}',
            '.la-foot button:disabled{opacity:0.5;cursor:default}',
            '.la-model{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:var(--card-radius-sm,8px);margin-bottom:7px;cursor:pointer}',
            '.la-model.on{border-color:var(--gold,#D4AF37);background:rgba(212,175,55,0.08)}.la-model small{opacity:0.7}.la-model .la-tag{margin-left:auto;font-size:0.7rem;opacity:0.8;white-space:nowrap}',
            '@media(max-width:820px){#lab-ask{width:100vw;border-left:none}}',
        ].join('\n');
        document.head.appendChild(s);
    }

    function mount() {
        if (document.getElementById('lab-ask')) return;
        css();
        const btn = document.createElement('button');
        btn.id = 'lab-ask-btn'; btn.type = 'button';
        btn.innerHTML = '✦ Ask <em>LAB</em>';
        btn.onclick = () => openPanel();
        document.body.appendChild(btn);
        const p = document.createElement('aside');
        p.id = 'lab-ask'; p.setAttribute('aria-label', 'Ask your AI');
        document.body.appendChild(p);
    }

    function openPanel(view) {
        state.open = true;
        if (view) state.view = view;
        else if (!getKey()) state.view = 'connect';
        else if (state.view === 'connect') state.view = 'chat';
        render();
    }
    function closePanel() { state.open = false; render(); }

    function header(sub) {
        return '<div class="la-head"><div class="la-title"><b>ASK · YOUR AI</b><div>' + esc(sub) + '</div></div>'
            + (getKey() && state.view !== 'settings' ? '<button class="la-icon" data-act="settings" title="Settings">⚙</button>' : '')
            + (state.view === 'settings' && getKey() ? '<button class="la-icon" data-act="chat">Back</button>' : '')
            + '<button class="la-icon" data-act="close" aria-label="Close">✕</button></div>';
    }

    function render() {
        const p = document.getElementById('lab-ask');
        const btn = document.getElementById('lab-ask-btn');
        if (!p) return;
        const leagueReady = !!ctx().lid;
        if (btn) btn.style.display = leagueReady && !state.open ? 'flex' : 'none';
        p.classList.toggle('open', state.open);
        if (!state.open) return;
        if (state.view === 'connect') return renderConnect(p);
        if (state.view === 'settings') return renderSettings(p);
        return renderChat(p);
    }

    function renderConnect(p) {
        p.innerHTML = header('Lab test · bring your own AI')
            + '<div class="la-body">'
            + '<div class="la-card"><h3>Connect your own AI</h3>'
            + '<p>Ask anything about your team, trades, lineup or league. Your AI digs through Dynasty HQ\'s numbers and the latest news, then gives you a real opinion.</p>'
            + '<p class="la-muted">You pay your AI company directly, usually a few cents a question. Dynasty HQ never pays for it, and your key stays in this browser.</p>'
            + '<button class="la-primary" data-act="signin">Sign in with OpenRouter</button>'
            + '<p class="la-muted" style="margin-top:8px">One sign-in gives you ChatGPT, Claude, Gemini and more. On the OpenRouter screen, set a spending limit (for example $5) so it can never run away.</p></div>'
            + '<div class="la-card"><h3>Already have an OpenRouter key?</h3>'
            + '<input class="la-input" id="la-paste" placeholder="sk-or-…" autocomplete="off" spellcheck="false">'
            + '<button class="la-secondary" data-act="paste">Use this key</button>'
            + '<p class="la-muted" id="la-paste-msg"></p></div>'
            + '</div>';
        wire(p);
    }

    async function renderSettings(p) {
        const k = getKey();
        p.innerHTML = header('Settings')
            + '<div class="la-body"><div class="la-card"><h3>Your AI account</h3><p id="la-acct" class="la-muted">Checking…</p>'
            + '<button class="la-secondary" data-act="disconnect">Disconnect this browser</button></div>'
            + '<div class="la-card"><h3>Which AI answers</h3><p class="la-muted">Cost is a rough estimate for a typical question, before any web searches (about 1¢ each).</p><div id="la-models">Loading models…</div>'
            + '<p class="la-muted" style="margin-top:10px">Or type any OpenRouter model id:</p><input class="la-input" id="la-model-id" value="' + esc(currentModel()) + '"><button class="la-secondary" data-act="model-id">Use this model</button></div></div>';
        wire(p);
        if (k) keyInfo().then(info => {
            const el = document.getElementById('la-acct'); if (!el) return;
            if (!info) { el.textContent = 'Not connected.'; return; }
            if (info.error) { el.textContent = 'Could not check the account: ' + info.error; return; }
            const used = info.usage != null ? '$' + Number(info.usage).toFixed(2) + ' used on this key' : '';
            const lim = info.limit != null ? ' · limit $' + Number(info.limit).toFixed(2) + (info.limit_remaining != null ? ' ($' + Number(info.limit_remaining).toFixed(2) + ' left)' : '') : ' · no spending limit set on this key';
            el.textContent = 'Connected via ' + (k.via === 'signin' ? 'OpenRouter sign-in' : 'pasted key') + '. ' + used + lim + '.';
        });
        try {
            const list = await loadModels();
            const el = document.getElementById('la-models'); if (!el) return;
            const cur = currentModel();
            el.innerHTML = list.map(m => '<div class="la-model' + (m.id === cur ? ' on' : '') + '" data-model="' + esc(m.id) + '"><div><div>' + esc(m.name) + '</div><small>≈ ' + esc(centsLabel(m.perQ)) + ' a question</small></div><span class="la-tag">' + esc(m.tag) + '</span></div>').join('') || 'No models found.';
            el.querySelectorAll('[data-model]').forEach(n => { n.onclick = () => { ls.set(MODEL_STORE, n.getAttribute('data-model')); renderSettings(p); }; });
        } catch (e) { const el = document.getElementById('la-models'); if (el) el.textContent = 'Could not load the model list.'; }
    }

    function modelName(id) { const m = (modelList || []).find(x => x.id === id); return m ? m.name : id; }

    function renderChat(p) {
        const sub = 'Answering with ' + modelName(currentModel());
        const items = state.items.map(it => {
            if (it.q) return '<div class="la-q">' + esc(it.q) + '</div>';
            if (it.err) return '<div class="la-a la-err">' + esc(it.err) + '</div>';
            const src = (it.sources || []).length ? '<div class="la-steps">Sources: ' + it.sources.slice(0, 5).map(s => '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(String(s.title).slice(0, 60)) + '</a>').join(' · ') + '</div>' : '';
            const steps = '<div class="la-steps">' + (it.used || []).map(u => '<span>' + esc(u) + '</span>').join('') + '<span>' + esc(centsLabel(it.cost)) + ' · ' + esc(modelName(it.model)) + '</span></div>';
            return '<div class="la-a">' + mdToHtml(it.text) + src + steps + '</div>';
        }).join('');
        const live = state.busy ? '<div class="la-live">' + (state.live.length ? state.live : ['Thinking']).map(s => '<div>' + esc(s) + '</div>').join('') + '</div>' : '';
        const chips = !state.items.length && !state.busy ? '<p class="la-muted" style="margin:0 0 10px">Try one of these, or ask your own:</p>' + starters().map(q => '<button class="la-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>').join('') : '';
        p.innerHTML = header(sub)
            + '<div class="la-body" id="la-body">' + chips + items + live
            + (state.items.length && !state.busy ? '<button class="la-secondary" data-act="new" style="margin-top:0">New question</button>' : '') + '</div>'
            + '<div class="la-foot"><textarea id="la-text" placeholder="Ask about your team, a trade, a player…"' + (state.busy ? ' disabled' : '') + '></textarea><button data-act="send"' + (state.busy ? ' disabled' : '') + '>Ask</button></div>';
        wire(p);
        const body = document.getElementById('la-body'); if (body) body.scrollTop = body.scrollHeight;
        const ta = document.getElementById('la-text');
        if (ta) ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(ta.value); } };
    }

    async function send(text) {
        text = String(text || '').trim();
        if (!text || state.busy) return;
        if (!getKey()) { openPanel('connect'); return; }
        if (!ctx().lid) { state.items.push({ err: 'Open one of your leagues first.' }); render(); return; }
        state.items.push({ q: text });
        state.thread.push({ role: 'user', content: text });
        state.busy = true; state.live = [];
        render();
        try {
            const r = await ask(state.thread, label => { state.live.push(label); render(); });
            state.items.push(r);
        } catch (e) {
            state.thread.pop();
            state.items.push({ err: e.message || String(e) });
        }
        state.busy = false; state.live = [];
        render();
    }

    function wire(p) {
        p.querySelectorAll('[data-act]').forEach(n => {
            n.onclick = async () => {
                const act = n.getAttribute('data-act');
                if (act === 'close') return closePanel();
                if (act === 'settings') { state.view = 'settings'; return render(); }
                if (act === 'chat') { state.view = 'chat'; return render(); }
                if (act === 'signin') return startSignIn();
                if (act === 'new') { state.thread = []; state.items = []; return render(); }
                if (act === 'send') { const t = document.getElementById('la-text'); return send(t && t.value); }
                if (act === 'disconnect') { ls.del(KEY_STORE); state.thread = []; state.items = []; state.view = 'connect'; return render(); }
                if (act === 'model-id') { const v = (document.getElementById('la-model-id') || {}).value; if (v && v.trim()) ls.set(MODEL_STORE, v.trim()); return renderSettings(p); }
                if (act === 'paste') {
                    const v = ((document.getElementById('la-paste') || {}).value || '').trim();
                    const msg = document.getElementById('la-paste-msg');
                    if (!/^sk-or-/.test(v)) { if (msg) msg.textContent = 'That doesn\'t look like an OpenRouter key (they start with sk-or-).'; return; }
                    if (msg) msg.textContent = 'Checking…';
                    try { await orFetch('/api/v1/key', null, v); }
                    catch (e) { if (msg) msg.textContent = 'OpenRouter refused that key: ' + e.message; return; }
                    ls.set(KEY_STORE, { key: v, via: 'paste', at: Date.now() });
                    state.view = 'chat'; render();
                }
            };
        });
        p.querySelectorAll('[data-q]').forEach(n => { n.onclick = () => send(n.getAttribute('data-q')); });
    }

    function boot() {
        mount();
        render();
        try { loadModels().then(() => { if (state.open) render(); }).catch(() => { }); } catch (e) { /* */ }
        // Back from the OpenRouter sign-in page: open straight to the chat.
        try { if (sessionStorage.getItem('dhq_lab_ai_just_connected')) { sessionStorage.removeItem('dhq_lab_ai_just_connected'); setTimeout(() => openPanel('chat'), 800); } } catch (e) { /* */ }
        // The button appears once a league is open; leagues load late.
        setInterval(() => { const b = document.getElementById('lab-ask-btn'); const want = !!ctx().lid && !state.open; if (b && (b.style.display !== 'none') !== want) render(); }, 1500);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.open) closePanel(); });
    }

    // Exposed for the Lab test harness only.
    window.__dhqLabAskApi = { TOOLS, TOOL_DEFS, systemPrompt, ask, openPanel };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
