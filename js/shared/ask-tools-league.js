// ══════════════════════════════════════════════════════════════════
// js/shared/ask-tools-league.js — league-wide tools for App.AskTools (Lab)
//
// The member's own AI looks up facts about the LEAGUE through these: rules
// and scoring, standings, a team's schedule, playoff odds, past champions and
// head-to-head history. Same contract as js/shared/ask-tools.js (load this
// AFTER it): every number comes from the app's data or engines, nothing here
// calls an AI, and each tool throws a plain reason when it can't answer.
//
//   get_league_info    settings, scoring, rules, league docs
//   get_standings      every team's record, rank, value, FAAB, luck
//   get_schedule       one team's season: results, win chances, proj record
//   get_playoff_odds   playoff / bye / title odds (App.PlayoffOdds)
//   get_league_history champions, runners-up, brackets, all-time records
//   get_head_to_head   two teams' meetings, this season and all-time
//
// Sleeper first; MFL / ESPN get whatever the page holds (S.weeklyScores,
// the trimmed league) and a plain note for the rest.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const AT = App.AskTools;
    if (!AT || typeof AT.register !== 'function') {
        if (root.console && root.console.warn) root.console.warn('ask-tools-league.js: load js/shared/ask-tools.js first');
        return;
    }
    const register = AT.register;
    const SLEEPER = 'https://api.sleeper.app/v1';
    const TEAM_ARG = 'Team name, owner name, roster id, or "me"';

    // ── Local helpers ──────────────────────────────────────────────
    // The page keeps a trimmed league in S.leagues; the engines want the
    // whole thing (rosters, users, season, platform markers).
    function fullLeague(h) {
        const lg = h.league();
        if (!lg) return null;
        const id = lg.league_id || lg.id;
        const out = Object.assign({}, lg, { league_id: id, id, season: lg.season || h.season(), rosters: h.rosters(), users: h.users() });
        const plat = h.platform();
        if (plat === 'mfl') out._mfl = true;
        else if (plat === 'espn') out._espn = true;
        else if (plat === 'yahoo') out._yahoo = true;
        return out;
    }
    function needLeague(h) {
        const lg = fullLeague(h);
        if (!lg || !h.rosters().length) throw new Error('No league is open yet (rosters not loaded).');
        return lg;
    }
    const skin = () => { try { return (App.LeagueSkin && App.LeagueSkin.getCurrent && App.LeagueSkin.getCurrent()) || null; } catch (e) { return null; } };
    const num = v => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
    const lastRegWeek = lg => Math.max(1, Math.min(18, (num(((lg && lg.settings) || {}).playoff_week_start) || 15) - 1));
    const isChopped = lg => !!(App.Chopped && App.Chopped.isChopped && App.Chopped.isChopped(lg));

    function leagueType(lg) {
        const sk = skin();
        if (sk && sk.type && sk.type !== 'unknown') return sk.type;
        const st = (lg && lg.settings) || {};
        if (isChopped(lg)) return 'chopped';
        if (Number(st.best_ball) === 1) return 'best_ball';
        const t = num(st.type);
        if (t === 2) return 'dynasty';
        if (t === 1) return 'keeper';
        if (t === 0) return 'redraft';
        if (t === 3) return 'chopped';
        if (num(st.max_keepers) > 0) return 'keeper';
        return 'unknown';
    }
    function phase(h, lg) {
        const sk = skin();
        if (sk && sk.phase && sk.phase !== 'unknown') return sk.phase;
        const ns = h.S().nflState || {};
        if (ns.season_type === 'off') return 'offseason';
        if (ns.season_type === 'pre') return 'preseason';
        const wk = h.week();
        if (wk > lastRegWeek(lg)) return 'playoffs';
        if (wk > 0) return 'in_season';
        return 'unknown';
    }
    const seasonOver = (h, lg) => { const p = phase(h, lg); return p === 'complete' || p === 'offseason'; };
    // Last completed regular-season week (0 = none yet).
    function regThrough(h, lg) {
        const last = lastRegWeek(lg);
        if (seasonOver(h, lg)) return last;
        return Math.max(0, Math.min(h.week() - 1, last));
    }
    const pf = r => { const st = (r && r.settings) || {}; return (Number(st.fpts) || 0) + (Number(st.fpts_decimal) || 0) / 100; };
    const winsOf = r => { const st = (r && r.settings) || {}; return (Number(st.wins) || 0) + (Number(st.ties) || 0) / 2; };
    const wlt = (w, l, t) => w + '-' + l + (t ? '-' + t : '');
    const rosterById = (h, id) => h.rosters().find(r => String(r.roster_id) === String(id)) || null;
    const nameOf = (h, id) => { const r = rosterById(h, id); return r ? h.label(r) : 'roster ' + id; };
    function teamArg(h, q, what) {
        const r = h.findTeam(q);
        if (!r) throw new Error('No team in this league matches "' + q + '"' + (what ? ' (' + what + ')' : '') + '. Teams: ' + h.rosters().map(h.teamName).join(', '));
        return r;
    }
    function assessMap() {
        const out = {};
        try {
            const all = typeof root.assessAllTeamsFromGlobal === 'function' ? root.assessAllTeamsFromGlobal() : null;
            (all || []).forEach(a => { if (a && a.rosterId != null) out[String(a.rosterId)] = a; });
        } catch (e) { /* values still loading */ }
        return out;
    }
    async function getJson(url) {
        if (typeof root.fetch !== 'function') return null;
        try { const r = await root.fetch(url); return r && r.ok ? await r.json() : null; } catch (e) { return null; }
    }

    // Standings order: Sleeper's default (wins, then points for). With real
    // divisions, division leaders take the first seeds — the same rule the
    // playoff simulator uses.
    function standingsOrder(h, lg) {
        const rs = h.rosters().slice().sort((a, b) => winsOf(b) - winsOf(a) || pf(b) - pf(a));
        const st = (lg && lg.settings) || {};
        const nDiv = num(st.divisions) || 0;
        const tagged = rs.filter(r => num((r.settings || {}).division) > 0).length;
        const useDiv = nDiv >= 2 && tagged === rs.length;
        let seeds = rs;
        if (useDiv) {
            const seen = {}, leaders = [];
            rs.forEach(r => { const d = (r.settings || {}).division; if (!seen[d]) { seen[d] = true; leaders.push(r); } });
            seeds = leaders.concat(rs.filter(r => !leaders.includes(r)));
        }
        return { byRecord: rs, seeds, usedDivisions: useDiv };
    }

    async function ledgerFor(h, lg, ms) {
        const L = App.Luck;
        const through = regThrough(h, lg);
        if (!L || !L.build || through < 1) return null;
        try { return await h.withTimeout(L.build({ league: lg, throughWeek: through }), ms || 5000, null); } catch (e) { return null; }
    }

    // ── get_league_info ────────────────────────────────────────────
    const SCORING_GROUPS = [
        ['passing', /^pass_/], ['rushing', /^rush_/], ['receiving', /^rec/], ['bonuses', /^bonus_/],
        ['kicking', /^(fg|xp)/], ['idp', /^idp_/], ['special_teams', /^(st_|kr_|pr_)/], ['fumbles', /^fum/],
        ['team_defense', /^(def_|pts_allow|yds_allow|sack$|int$|ff$|safe$|blk_kick)/],
    ];
    function groupScoring(sc) {
        const out = {};
        Object.keys(sc || {}).sort().forEach(k => {
            const v = Number(sc[k]);
            if (!v || isNaN(v)) return;
            const g = (SCORING_GROUPS.find(x => x[1].test(k)) || ['other'])[0];
            (out[g] = out[g] || {})[k] = Math.round(v * 1000) / 1000;
        });
        return out;
    }
    const ROUND_TYPE = { 0: 'one week per round', 1: 'one week per round, two-week championship', 2: 'two weeks per round' };
    function rulesOf(lg) {
        const st = lg.settings || {};
        const has = k => st[k] != null && st[k] !== '';
        const r = {};
        if (has('trade_deadline')) r.trade_deadline_week = num(st.trade_deadline) >= 99 ? 'none' : num(st.trade_deadline);
        if (has('disable_trades')) r.trades_disabled = Number(st.disable_trades) === 1;
        if (has('trade_review_days')) r.trade_review_days = num(st.trade_review_days);
        const veto = {};
        Object.keys(st).filter(k => /veto/.test(k)).forEach(k => { veto[k] = st[k]; });
        if (Object.keys(veto).length) r.veto = veto;
        if (has('pick_trading')) r.pick_trading = Number(st.pick_trading) === 1;
        const po = {};
        if (has('playoff_teams')) po.teams = num(st.playoff_teams);
        if (has('playoff_week_start')) po.start_week = num(st.playoff_week_start);
        if (has('playoff_round_type')) po.rounds = ROUND_TYPE[num(st.playoff_round_type)] || st.playoff_round_type;
        if (has('playoff_type')) po.bracket_type_code = st.playoff_type;
        if (has('playoff_seed_type')) po.seeding = num(st.playoff_seed_type) === 0 ? 'default (record, then points for; division winners first when divisions are on)' : 're-seed / custom (code ' + st.playoff_seed_type + ')';
        if (Object.keys(po).length) r.playoffs = po;
        const wv = {};
        const FL = App.FaabLeague;
        if (FL && FL.waiverLabel) wv.type = FL.waiverLabel(lg);
        else if (has('waiver_type')) wv.type = ({ 0: 'rolling waivers', 1: 'reverse-standings waivers', 2: 'FAAB' })[num(st.waiver_type)] || st.waiver_type;
        if (has('waiver_budget') && (!FL || FL.isFaabLeague(lg))) wv.faab_budget = num(st.waiver_budget);
        if (has('waiver_bid_min')) wv.min_bid = num(st.waiver_bid_min);
        if (has('waiver_clear_days')) wv.clear_days = num(st.waiver_clear_days);
        if (has('daily_waivers')) wv.daily_waivers = Number(st.daily_waivers) === 1;
        if (Object.keys(wv).length) r.waivers = wv;
        const taxi = {};
        if (has('taxi_slots')) taxi.slots = num(st.taxi_slots);
        if (has('taxi_years')) taxi.max_years = num(st.taxi_years);
        if (has('taxi_deadline')) taxi.deadline = st.taxi_deadline;
        if (has('taxi_allow_vets')) taxi.vets_allowed = Number(st.taxi_allow_vets) === 1;
        if (Object.keys(taxi).length && taxi.slots !== 0) r.taxi = taxi;
        const ir = {};
        if (has('reserve_slots')) ir.slots = num(st.reserve_slots);
        Object.keys(st).filter(k => /^reserve_allow_/.test(k)).forEach(k => { ir[k.replace('reserve_', '')] = Number(st[k]) === 1; });
        if (Object.keys(ir).length) r.ir = ir;
        if (has('max_keepers')) r.max_keepers = num(st.max_keepers);
        if (has('draft_rounds')) r.draft_rounds = num(st.draft_rounds);
        if (has('divisions')) r.divisions = num(st.divisions);
        if (has('league_average_match')) r.median_game = Number(st.league_average_match) === 1;
        if (has('best_ball')) r.best_ball = Number(st.best_ball) === 1;
        return r;
    }
    register({
        name: 'get_league_info',
        description: 'This league\'s setup: name, platform, season, current week, format (dynasty/redraft/keeper/best ball/chopped), phase, team count, starting lineup slots, the full scoring settings, and the rules (trade deadline, playoffs, waivers/FAAB, taxi, IR, keepers, draft rounds, divisions), plus the league\'s own rules document when one is loaded.',
        parameters: { type: 'object', properties: {} },
        async run(a, h) {
            const lg = fullLeague(h);
            if (!lg) throw new Error('No league is open yet.');
            const slots = {};
            (lg.roster_positions || []).forEach(p => { slots[p] = (slots[p] || 0) + 1; });
            const out = {
                league: lg.name || null, platform: h.platform(), season: h.season() || null, current_week: h.week() || null,
                type: leagueType(lg), phase: phase(h, lg), teams: h.rosters().length || num((lg.settings || {}).num_teams),
                roster_slots: slots, scoring: groupScoring(lg.scoring_settings), rules: rulesOf(lg),
            };
            const sc = lg.scoring_settings || {};
            out.scoring_summary = { ppr: num(sc.rec) || 0, te_premium: num(sc.bonus_rec_te) || 0, pass_td: num(sc.pass_td), superflex: !!(slots.SUPER_FLEX || slots.SUPERFLEX) };
            const docs = root._leagueDocsContext;
            if (docs && String(docs).trim()) {
                const t = String(docs).trim();
                out.league_docs = t.length > 1500 ? t.slice(0, 1500) + '… (trimmed)' : t;
            }
            return out;
        },
    });

    // ── get_standings ──────────────────────────────────────────────
    register({
        name: 'get_standings',
        description: 'The league standings: every team\'s rank, record with points for and against, division, playoff seed line, power rank, contender/rebuilder tier, total dynasty value, FAAB left, waiver order, chopped/eliminated status, and (once games are played) all-play record and schedule luck.',
        parameters: { type: 'object', properties: { include_luck: { type: 'boolean', description: 'Add all-play record, expected wins and luck (default true; needs weekly scores).' } } },
        async run(a, h) {
            const lg = needLeague(h);
            const st = lg.settings || {};
            const { byRecord, seeds, usedDivisions } = standingsOrder(h, lg);
            const A = assessMap();
            const spots = num(st.playoff_teams) || 0;
            const chopped = isChopped(lg);
            const FL = App.FaabLeague;
            const seedOf = {};
            if (!chopped && spots > 0) seeds.slice(0, spots).forEach((r, i) => { seedOf[String(r.roster_id)] = i + 1; });
            let ledger = null;
            if (a.include_luck !== false) ledger = await ledgerFor(h, lg, 5000);
            const luckBy = {};
            ((ledger && ledger.rows) || []).forEach(x => { luckBy[String(x.rosterId)] = x; });
            const teams = byRecord.map((r, i) => {
                const as = A[String(r.roster_id)] || {};
                const rs = r.settings || {};
                const f = FL && FL.faab ? FL.faab(lg, r) : null;
                const lk = luckBy[String(r.roster_id)];
                const row = {
                    rank: i + 1, team: h.label(r), roster_id: r.roster_id, record: h.record(r),
                    division: num(rs.division) || undefined,
                    playoff_seed: seedOf[String(r.roster_id)] || undefined,
                    power_rank: as.powerRank != null ? as.powerRank : undefined,
                    tier: as.tier || undefined, window: as.window || undefined,
                    total_value: as.totalDHQ != null ? Math.round(as.totalDHQ) : undefined,
                    faab_left: f ? (f.isFaab ? f.remaining : undefined) : (as.faabRemaining != null ? as.faabRemaining : undefined),
                    waiver_position: num(rs.waiver_position) || undefined,
                };
                if (App.Chopped && App.Chopped.isEliminated && App.Chopped.isEliminated(r)) row.eliminated_week = App.Chopped.eliminatedWeek(r);
                if (lk) Object.assign(row, { all_play: wlt(lk.allPlayW, lk.allPlayL, 0), expected_wins: h.round1(lk.expWins), luck: h.round1(lk.luck) });
                return row;
            });
            const out = {
                season: h.season() || null, week: h.week() || null,
                order: 'wins, then points for' + (usedDivisions ? '; playoff seeds put division leaders first' : ''),
                playoff_spots: chopped ? 0 : spots || undefined, teams,
            };
            if (chopped) out.note = 'Chopped league: no playoffs; the lowest scorer each week is eliminated.';
            if (a.include_luck !== false && !ledger) out.luck_note = 'All-play and luck need completed weekly scores; none available yet.';
            return out;
        },
    });

    // ── get_schedule ───────────────────────────────────────────────
    register({
        name: 'get_schedule',
        description: 'One team\'s regular-season schedule (default: mine): every week\'s opponent, the result and score for weeks played, the win chance for weeks ahead, the projected final record, and weeks where bye weeks leave the lineup thin.',
        parameters: { type: 'object', properties: { team: { type: 'string', description: TEAM_ARG + ' (default: me).' } } },
        async run(a, h) {
            const lg = needLeague(h);
            const r = teamArg(h, a.team);
            if (isChopped(lg)) throw new Error('This is a chopped league: there are no head-to-head opponents, just the lowest score eliminated each week.');
            const cur = h.week();
            const Sch = App.Schedule;
            let data = null;
            if (Sch && Sch.buildSeason) {
                try {
                    data = await h.withTimeout(Sch.buildSeason({ league: lg, myRoster: r, playersData: h.S().players || {}, statsData: root._wrStatsData || {}, stats2025Data: undefined }), 9000, null);
                } catch (e) { data = null; }
            }
            if (data && data.weeks) {
                const weeks = data.weeks.map(w => {
                    const row = { week: w.week, opponent: w.bye ? 'BYE' : (w.oppRosterId != null ? nameOf(h, w.oppRosterId) : w.oppName) };
                    if (w.result) { row.result = w.result; row.score = h.round1(w.myProj) + '-' + h.round1(w.oppProj); }
                    else if (w.winPct != null) { row.win_chance_pct = w.winPct; row.proj = h.round1(w.myProj) + '-' + h.round1(w.oppProj); }
                    row.status = w.isPast ? 'played' : w.isCurrent ? 'this week' : 'upcoming';
                    return row;
                });
                const s = data.summary || {};
                const out = {
                    team: h.label(r), current_week: cur, record: s.record, projected_final_record: s.projRecord,
                    avg_win_chance_remaining_pct: s.winPct != null ? s.winPct : undefined, weeks,
                    regular_season_ends_week: lastRegWeek(lg),
                };
                const bw = (data.byeWatch || []).map(b => ({ week: b.week, starters_on_bye: (b.pids || []).map(h.pname), empty_slots: b.unfilled || 0 }));
                if (bw.length) out.bye_watch = bw;
                if (data.scheduleUnset) out.note = 'The league has not posted its matchups yet.';
                else if (!weeks.some(w => w.win_chance_pct != null) && weeks.some(w => w.status !== 'played')) out.note = 'Win chances need projections, which are still loading; opponents and results are final.';
                return out;
            }
            // Fallback: opponents and results only.
            const M = App.Matchup;
            if (!M || !M.resolveSeasonOpponents) throw new Error('The schedule is not available for this league.');
            const weeksWanted = [];
            for (let w = 1; w <= lastRegWeek(lg); w++) weeksWanted.push(w);
            const opp = await h.withTimeout(M.resolveSeasonOpponents({ league: lg, myRosterId: r.roster_id, weeks: weeksWanted }), 8000, null);
            if (!opp || !Object.keys(opp).length) throw new Error('Could not load this league\'s matchups (not posted yet, or the platform did not answer).');
            const weeks = weeksWanted.map(w => {
                const e = opp[w];
                if (!e) return { week: w, opponent: 'BYE' };
                const row = { week: w, opponent: nameOf(h, e.oppRosterId), status: w < cur ? 'played' : w === cur ? 'this week' : 'upcoming' };
                if (w < cur && (e.myPts > 0 || e.oppPts > 0)) { row.result = e.myPts > e.oppPts ? 'W' : e.myPts < e.oppPts ? 'L' : 'T'; row.score = h.round1(e.myPts) + '-' + h.round1(e.oppPts); }
                return row;
            });
            const rec = h.record(r);
            return { team: h.label(r), current_week: cur, record: wlt(rec.wins, rec.losses, rec.ties), weeks, note: 'Win chances and a projected record are not available right now (schedule engine not loaded); opponents and results only.' };
        },
    });

    // ── get_playoff_odds ───────────────────────────────────────────
    register({
        name: 'get_playoff_odds',
        description: 'Playoff, first-round-bye and championship odds for every team from 10,000 season simulations, with projected records, the current playoff seeding and spots, and how much this week\'s game swings my odds.',
        parameters: { type: 'object', properties: {} },
        async run(a, h) {
            const lg = needLeague(h);
            const st = lg.settings || {};
            const sk = skin();
            if (isChopped(lg) || (sk && sk.features && sk.features.showPlayoffOdds === false)) {
                const alive = App.Chopped && App.Chopped.aliveRosters ? App.Chopped.aliveRosters(h.rosters()) : h.rosters();
                return { playoffs: false, note: 'This league has no playoff bracket (chopped / no playoff teams), so there are no playoff odds. Teams still alive: ' + alive.length + '.', alive: alive.map(h.label).slice(0, 32) };
            }
            const spots = Math.max(2, num(st.playoff_teams) || 6);
            const pws = num(st.playoff_week_start) || 15;
            const byes = (Math.pow(2, Math.ceil(Math.log2(spots))) - spots) || 0;
            const { seeds, usedDivisions } = standingsOrder(h, lg);
            const out = {
                playoff_spots: spots, first_round_byes: byes, playoffs_start_week: pws, current_week: h.week(),
                current_seeding: seeds.slice(0, spots).map((r, i) => ({ seed: i + 1, team: h.label(r), record: h.record(r) })),
                first_team_out: seeds[spots] ? h.label(seeds[spots]) : undefined,
                seeding_rule: 'record, then points for' + (usedDivisions ? '; division leaders seeded first' : ''),
            };
            const PO = App.PlayoffOdds;
            if (!PO || !PO.simulate || !App.Luck) { out.note = 'The odds engine is not loaded on this page; current seeding only.'; return out; }
            if (seasonOver(h, lg) || h.week() > lastRegWeek(lg)) { out.note = 'The regular season is over: the playoff field is set, so there are no odds to simulate.'; return out; }
            const ledger = await ledgerFor(h, lg, 6000);
            const played = ledger ? ledger.weeks.length : 0;
            if (played < 2) { out.note = 'Playoff odds need at least two weeks of scores' + (h.platform() !== 'sleeper' && !ledger ? ' (weekly scores were not available for this platform)' : '') + '.'; return out; }
            const cur = h.week(), last = lastRegWeek(lg);
            const pairs = await h.withTimeout(PO.fetchFuturePairs({ league: lg, fromWeek: cur, toWeek: last }), 4000, null);
            if (!pairs || !Object.keys(pairs).length) { out.note = 'The remaining schedule could not be loaded' + (h.platform() !== 'sleeper' ? ' (only Sleeper posts future matchups to us)' : '') + ', so odds were not simulated.'; return out; }
            const me = h.myRoster();
            let weekDists = null;
            try { const DQ = App.DhqProj; if (DQ && DQ.weekDists) weekDists = DQ.weekDists(lg, pairs[cur] || [], cur, me && me.roster_id, null) || null; } catch (e) { weekDists = null; }
            const sim = PO.simulate({ league: lg, ledger, futurePairs: pairs, myRosterId: me && me.roster_id, sims: 10000, weekDists });
            if (!sim) { out.note = 'Not enough teams with scores to simulate.'; return out; }
            out.simulations = sim.simCount;
            out.weeks_played = played;
            out.odds = sim.rows.map(x => ({
                team: nameOf(h, x.rosterId), record: x.record, playoff_pct: x.playoffPct,
                bye_pct: sim.byeSlots ? x.byePct : undefined, title_pct: x.titlePct,
                avg_seed: x.avgSeed != null ? x.avgSeed : undefined, projected_record: x.projWins + '-' + x.projLosses,
            }));
            if (sim.leverage) out.my_leverage_this_week = { week: sim.leverage.week, playoff_pct_if_win: sim.leverage.ifWin, playoff_pct_if_lose: sim.leverage.ifLose, win_chance_pct: sim.weekWinPct != null ? sim.weekWinPct : sim.leverage.winPct };
            out.model = 'Each team\'s weekly score is drawn from its own scores this season' + (sim.weekSource === 'dhq' ? ' (this week from projected lineups)' : '') + '; ties broken by points for.';
            return out;
        },
    });

    // ── get_league_history ─────────────────────────────────────────
    function bracketLines(games, nameFor) {
        const PLACE = { 1: 'Championship', 3: '3rd place', 5: '5th place', 7: '7th place' };
        return (games || []).filter(g => g && g.t1 != null && g.t2 != null).sort((x, y) => (x.r || 0) - (y.r || 0) || (x.m || 0) - (y.m || 0)).map(g => {
            const tag = PLACE[g.p] || ('Round ' + (g.r || '?'));
            if (g.w == null) return tag + ': ' + nameFor(g.t1) + ' vs ' + nameFor(g.t2) + ' (not played yet)';
            return tag + ': ' + nameFor(g.w) + ' beat ' + nameFor(g.l != null ? g.l : (String(g.w) === String(g.t1) ? g.t2 : g.t1));
        }).slice(0, 16);
    }
    register({
        name: 'get_league_history',
        description: 'This league\'s past: champion and runner-up every season, playoff brackets, and all-time records per manager (seasons, wins-losses, points, titles, playoff trips). Pass a season to see just that year.',
        parameters: { type: 'object', properties: { season: { type: 'string', description: 'One season, e.g. "2024" (default: all seasons).' } } },
        async run(a, h) {
            const lg = needLeague(h);
            const want = a.season != null && String(a.season).trim() ? String(a.season).trim() : null;
            const LI = h.LI();
            let cache = null;
            const WH = root.WrHistory;
            if (WH && h.platform() === 'sleeper') {
                try { cache = await h.withTimeout(WH.loadIfMissing({ league_id: lg.league_id, id: lg.league_id, rosters: lg.rosters, settings: lg.settings }), 9000, null); } catch (e) { cache = null; }
                if (!cache && WH.getCached) cache = WH.getCached(lg.league_id);
            }
            const champs = Object.assign({}, LI.championships || {}, (cache && cache.championships) || {});
            const brackets = Object.assign({}, LI.bracketData || {});
            // DHQ's engine hasn't put brackets on the page: read them from the
            // same Sleeper season walk head-to-head uses (memoized, partial ok).
            if (!Object.keys(brackets).length && h.platform() === 'sleeper') {
                const p = loadPastSeasons(String(lg.league_id));
                const st = await h.withTimeout(p.then(x => x, () => null), 5000, null);
                ((st || p.state || {}).seasons || []).forEach(s => { if (s.season && s.bracket && s.bracket.length) brackets[s.season] = { winners: s.bracket }; });
            }
            const owners = cache && cache.ownerHistory ? Object.values(cache.ownerHistory) : [];
            if (!Object.keys(champs).length && !Object.keys(brackets).length && !owners.length) {
                throw new Error(h.platform() === 'sleeper' ? 'League history has not loaded (no past seasons found, or Sleeper did not answer).' : 'League history is only available for Sleeper leagues right now.');
            }
            // A past season's roster id → that season's manager name.
            const seasonName = {};
            owners.forEach(o => (o.seasonHistory || []).forEach(sh => { (seasonName[sh.season] = seasonName[sh.season] || {})[String(sh.rosterId)] = o.ownerName; }));
            // Fallback when the per-season names aren't loaded: the roster id's
            // current team (dynasty roster ids rarely move between seasons).
            const nameIn = season => rid => {
                const n = (seasonName[season] || {})[String(rid)];
                if (n) return n;
                const cur = rosterById(h, rid);
                return cur ? h.label(cur) : 'roster ' + rid;
            };
            const seasons = [...new Set(Object.keys(champs).concat(Object.keys(brackets)))].filter(s => !want || s === want).sort((x, y) => Number(y) - Number(x)).slice(0, 12);
            if (want && !seasons.length && !owners.some(o => (o.seasonHistory || []).some(s => s.season === want))) throw new Error('No history found for season ' + want + '. Seasons known: ' + Object.keys(champs).sort().join(', '));
            const bySeason = seasons.map(s => {
                const c = champs[s] || {};
                const nm = nameIn(s);
                const cur = id => (id != null && rosterById(h, id) ? h.label(rosterById(h, id)) : null);
                const row = { season: s };
                row.champion = c.championName || (c.champion != null ? cur(c.champion) || nm(c.champion) : null);
                row.runner_up = c.runnerUpName || (c.runnerUp != null ? cur(c.runnerUp) || nm(c.runnerUp) : null);
                if (c.championName && c.champion != null && cur(c.champion)) row.champion_now = cur(c.champion);
                if (c.championStillActive === false) row.champion_left_league = true;
                const b = brackets[s] && brackets[s].winners;
                if (b && b.length) row.bracket = bracketLines(b, nm);
                return row;
            });
            const out = { league: lg.name || null, seasons: bySeason };
            if (owners.length) {
                const rows = owners.map(o => {
                    const cur = o.currentRosterId != null ? rosterById(h, o.currentRosterId) : null;
                    const base = { manager: o.ownerName, current_team: cur ? h.label(cur) : '(no longer in league)' };
                    if (want) {
                        const sh = (o.seasonHistory || []).find(x => x.season === want);
                        if (!sh) return null;
                        return Object.assign(base, { record: wlt(sh.wins, sh.losses, sh.ties), points_for: h.round1(sh.fpts), finish: sh.finish });
                    }
                    return Object.assign(base, {
                        seasons: o.tenure, record: o.record || wlt(o.wins, o.losses, o.ties), win_pct: h.round1((o.winPct || 0) * 100),
                        points_for: Math.round(o.pointsFor || 0), titles: o.championships || 0, title_seasons: (o.champSeasons || []).length ? o.champSeasons : undefined,
                        runner_ups: o.runnerUps || 0, playoff_trips: o.playoffAppearances || 0,
                    });
                }).filter(Boolean).sort((x, y) => (y.titles || 0) - (x.titles || 0) || (y.win_pct || 0) - (x.win_pct || 0)).slice(0, 32);
                out[want ? 'season_records' : 'all_time'] = rows;
                out.seasons_loaded = cache.seasonsLoaded || undefined;
            } else {
                out.note = 'Per-manager all-time records are not loaded; champions and brackets only.';
            }
            return out;
        },
    });

    // ── get_head_to_head ───────────────────────────────────────────
    // This season: the completed weeks' matchup rows (Sleeper), or the
    // pre-loaded S.weeklyScores map other platforms fill.
    async function seasonMeetings(h, lg, ra, rb) {
        const through = regThrough(h, lg);
        const A = String(ra.roster_id), B = String(rb.roster_id);
        const out = [];
        const weeks = [];
        for (let w = 1; w <= through; w++) weeks.push(w);
        const pre = h.S().weeklyScores;
        const M = App.Matchup;
        let source = null;
        if (pre && typeof pre === 'object' && !Array.isArray(pre) && Object.keys(pre).length) {
            source = 'pre';
            weeks.forEach(w => {
                const rows = pre[w] || [];
                const x = rows.find(r => String(r.rosterId) === A), y = rows.find(r => String(r.rosterId) === B);
                if (x && y && x.matchupId != null && String(x.matchupId) === String(y.matchupId)) out.push({ week: w, a: Number(x.points) || 0, b: Number(y.points) || 0 });
            });
        } else if (h.platform() === 'sleeper' && M && M.sleeperWeekRows) {
            source = 'sleeper';
            const all = await h.withTimeout(Promise.all(weeks.map(w => M.sleeperWeekRows(lg.league_id, w).then(rows => [w, rows]))), 6000, null);
            (all || []).forEach(([w, rows]) => {
                const x = (rows || []).find(r => String(r.roster_id) === A), y = (rows || []).find(r => String(r.roster_id) === B);
                if (x && y && x.matchup_id != null && String(x.matchup_id) === String(y.matchup_id)) out.push({ week: w, a: Number(x.points) || 0, b: Number(y.points) || 0 });
            });
            if (!all) source = null;
        }
        return { meetings: out.sort((p, q) => p.week - q.week), source, through };
    }
    const tally = games => {
        let w = 0, l = 0, t = 0, pa = 0, pb = 0;
        games.forEach(g => { if (g.a > g.b) w++; else if (g.a < g.b) l++; else t++; pa += g.a; pb += g.b; });
        return { record: wlt(w, l, t), wins: w, losses: l, ties: t, points: { a: h1(pa), b: h1(pb) } };
    };
    const h1 = n => Math.round(n * 10) / 10;

    // All-time (Sleeper): walk the previous_league_id chain and count every
    // meeting between the two MANAGERS (owner ids), so a roster slot that
    // changed hands doesn't inherit someone else's series. Completed seasons
    // come from the Wire's on-device archive when it has them. Memoized per
    // league for the session.
    const pastMemo = new Map();   // leagueId → Promise<[{ season, leagueId, rosters, weeks:[{week, rows}], bracket }]>
    function loadPastSeasons(lid) {
        if (pastMemo.has(lid)) return pastMemo.get(lid);
        const state = { seasons: [], done: false };
        const p = (async () => {
            const cur = await getJson(SLEEPER + '/league/' + lid);
            if (!cur) { state.done = true; state.failed = true; pastMemo.delete(lid); return state; }
            let prev = cur.previous_league_id;
            const seen = new Set([String(lid)]);
            const jobs = [];
            while (prev && prev !== '0' && !seen.has(String(prev)) && seen.size <= 12) {
                seen.add(String(prev));
                const id = String(prev);
                const arch = root.WrWireArchiveCache && root.WrWireArchiveCache.read ? await Promise.resolve(root.WrWireArchiveCache.read(id)).catch(() => null) : null;
                let info = arch && arch.league;
                if (!info || info.previous_league_id === undefined) info = Object.assign({}, info || {}, await getJson(SLEEPER + '/league/' + id) || {});
                if (!info || !info.league_id) break;
                jobs.push((async () => {
                    let rosters = arch && arch.league && arch.league.rosters;
                    let weeks = arch && arch.weeks;
                    let bracket = arch && arch.bracket;
                    const last = Math.max(1, Math.min(18, (num((info.settings || {}).playoff_week_start) || 15) - 1));
                    if (!rosters) rosters = await getJson(SLEEPER + '/league/' + id + '/rosters') || [];
                    if (!bracket) bracket = await getJson(SLEEPER + '/league/' + id + '/winners_bracket') || [];
                    if (!weeks) {
                        const ws = [];
                        for (let w = 1; w <= last; w++) ws.push(w);
                        weeks = await Promise.all(ws.map(w => getJson(SLEEPER + '/league/' + id + '/matchups/' + w).then(rows => ({ week: w, rows: rows || [] }))));
                    }
                    state.seasons.push({ season: String(info.season || ''), leagueId: id, rosters, weeks: weeks.filter(w => w.week <= last), bracket });
                })());
                prev = info.previous_league_id;
            }
            await Promise.all(jobs);
            state.done = true;
            return state;
        })();
        p.state = state;
        pastMemo.set(lid, p);
        p.catch(() => pastMemo.delete(lid));
        return p;
    }
    function pastMeetings(seasons, ownerA, ownerB) {
        const reg = [], po = [];
        const covered = [];
        seasons.forEach(s => {
            const ra = (s.rosters || []).find(r => String(r.owner_id) === String(ownerA));
            const rb = (s.rosters || []).find(r => String(r.owner_id) === String(ownerB));
            if (!ra || !rb) return;
            covered.push(s.season);
            const A = String(ra.roster_id), B = String(rb.roster_id);
            (s.weeks || []).forEach(w => {
                const x = (w.rows || []).find(r => String(r.roster_id) === A), y = (w.rows || []).find(r => String(r.roster_id) === B);
                if (x && y && x.matchup_id != null && String(x.matchup_id) === String(y.matchup_id) && ((Number(x.points) || 0) > 0 || (Number(y.points) || 0) > 0)) reg.push({ season: s.season, week: w.week, a: Number(x.points) || 0, b: Number(y.points) || 0 });
            });
            (s.bracket || []).forEach(g => {
                if (!g || g.w == null) return;
                const ids = [String(g.t1), String(g.t2)];
                if (ids.includes(A) && ids.includes(B)) po.push({ season: s.season, round: g.r, place_game: g.p || undefined, won: String(g.w) === A });
            });
        });
        return { reg, po, covered: covered.sort() };
    }
    register({
        name: 'get_head_to_head',
        description: 'The head-to-head series between two teams (default: me vs the other team): this season\'s meetings with scores, and the all-time regular-season and playoff record between the two managers across past seasons of this league.',
        parameters: {
            type: 'object',
            properties: {
                team_a: { type: 'string', description: TEAM_ARG + ' (default: me).' },
                team_b: { type: 'string', description: TEAM_ARG + ' — the opponent.' },
            },
            required: ['team_b'],
        },
        async run(a, h) {
            const lg = needLeague(h);
            const ra = teamArg(h, a.team_a, 'team_a');
            if (a.team_b == null || String(a.team_b).trim() === '') throw new Error('Say which team to compare against (team_b).');
            const rb = teamArg(h, a.team_b, 'team_b');
            if (String(ra.roster_id) === String(rb.roster_id)) throw new Error('Those are the same team; pick two different teams.');
            if (isChopped(lg)) throw new Error('This is a chopped league: teams never play each other head-to-head.');
            const out = { team_a: h.label(ra), team_b: h.label(rb) };
            const sm = await seasonMeetings(h, lg, ra, rb);
            const t = tally(sm.meetings);
            out.this_season = { season: h.season() || null, through_week: sm.through, record_for_team_a: t.record, meetings: sm.meetings.map(g => ({ week: g.week, score: h1(g.a) + '-' + h1(g.b), winner: g.a > g.b ? 'team_a' : g.a < g.b ? 'team_b' : 'tie' })) };
            if (!sm.source) out.this_season.note = 'Weekly matchup scores were not available, so this season\'s meetings could not be checked.';
            const notes = [];
            if (h.platform() !== 'sleeper') {
                notes.push('All-time head-to-head is only available for Sleeper leagues; this season only.');
            } else if (!ra.owner_id || !rb.owner_id) {
                notes.push('One of the teams has no manager on record, so past seasons can\'t be matched.');
            } else {
                const p = loadPastSeasons(String(lg.league_id));
                const st = await h.withTimeout(p.then(x => x, () => null), 8000, null);
                const state = st || p.state || { seasons: [], done: false };
                const pm = pastMeetings(state.seasons, ra.owner_id, rb.owner_id);
                const regAll = sm.meetings.map(g => ({ season: h.season(), week: g.week, a: g.a, b: g.b })).concat(pm.reg);
                const ta = tally(regAll);
                const poW = pm.po.filter(g => g.won).length, poL = pm.po.length - poW;
                out.all_time = {
                    regular_season_record_for_team_a: ta.record,
                    points: { team_a: ta.points.a, team_b: ta.points.b },
                    playoff_record_for_team_a: wlt(poW, poL, 0),
                    playoff_meetings: pm.po.slice(0, 10).map(g => ({ season: g.season, round: g.round, game: g.place_game === 1 ? 'championship' : g.place_game ? 'place ' + g.place_game : undefined, winner: g.won ? 'team_a' : 'team_b' })),
                    past_seasons_both_in_league: pm.covered,
                    recent: regAll.sort((x, y) => Number(y.season) - Number(x.season) || y.week - x.week).slice(0, 10).map(g => ({ season: g.season, week: g.week, score: h1(g.a) + '-' + h1(g.b) })),
                };
                if (!state.done) notes.push('Past seasons were still loading; the all-time record covers only the seasons listed. Ask again in a moment for the full series.');
                if (state.failed) notes.push('Sleeper did not answer, so past seasons could not be checked; the all-time record is this season only.');
                else if (!state.seasons.length && state.done) notes.push('No earlier seasons of this league were found on Sleeper.');
                notes.push('Counted by manager: seasons before either manager joined do not count; current-season playoff games are not included.');
            }
            if (notes.length) out.note = notes.join(' ');
            return out;
        },
    });

    const api = { names: ['get_league_info', 'get_standings', 'get_schedule', 'get_playoff_odds', 'get_league_history', 'get_head_to_head'], _pastMemo: pastMemo };
    App.AskToolsLeague = api;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
