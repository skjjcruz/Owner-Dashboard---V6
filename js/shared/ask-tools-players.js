// ══════════════════════════════════════════════════════════════════
// js/shared/ask-tools-players.js — player + waiver tools for App.AskTools
//
// Loads AFTER js/shared/ask-tools.js (it registers through that file's
// registry and helpers). The member's own AI calls these to look up facts:
//   get_player        everything on one player
//   compare_players   2–6 players side by side (no verdict)
//   search_players    league-wide rankings / filters (position, availability…)
//   get_waiver_report free agents, trending adds/drops, FAAB, waiver order
//   get_waiver_bid    the FAAB model's bid for one player (App.Faab.estimate)
//   get_waiver_plan   the waiver decision: adds, each paired with a drop
//                     (App.AskRoster's one drop list), bids, FAAB pacing
//   get_news          linked news for players or an NFL team (last 14 days)
//
// Bid history is IN-SEASON only (2026-10-10): Sleeper files every
// March–September offseason claim under leg 1 (437 of 504 bids in the Psycho
// League, 210 of them at the $13 minimum), which dragged the league's p50/
// p75/p90 to $15/$35/$75 against an in-season $30/$61/$129 (claims made on
// or after the regular-season start). Free-agent lists only show positions
// this league can start (no DEF without a DEF slot).
//
// Same rules as ask-tools.js: every value comes from the app's own data or
// engines, nothing here calls an AI, lists are capped, network reads are
// bounded with h.withTimeout, and a tool throws a plain reason when it can't
// answer. Sleeper first; MFL / ESPN leagues get whatever the page holds.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const AT = App.AskTools;
    if (!AT || typeof AT.register !== 'function' || !AT.h) {
        if (root.console && root.console.warn) root.console.warn('ask-tools-players: App.AskTools missing; load ask-tools.js first.');
        return;
    }
    const h = AT.h;
    const { round1 } = h;
    const NEWS_MS = 4000;
    const DAY = 864e5;
    const POS_ALL = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
    const FLEX = { FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], IDP_FLEX: ['DL', 'LB', 'DB'], IDP: ['DL', 'LB', 'DB'] };
    const posSet = q => { const p = String(q || '').toUpperCase().replace(/[\s-]/g, '_'); return FLEX[p] || (p === 'DST' || p === 'D_ST' ? ['DEF'] : p ? [p] : null); };

    // ── Small reads ────────────────────────────────────────────────
    const S = h.S;
    const LI = h.LI;
    const scores = () => LI().playerScores || {};
    const pid2 = x => String(x);
    const lid = () => { const lg = h.league(); return lg ? String(lg.league_id || lg.id || S().currentLeagueId || '') : String(S().currentLeagueId || ''); };
    const rosteredSet = () => new Set(h.rosters().flatMap(r => (r.players || []).map(String)));
    const mineSet = () => new Set(((h.myRoster() || {}).players || []).map(String));
    const noUndef = o => { Object.keys(o).forEach(k => { if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]; }); return o; };
    function action(pid) {
        const fn = typeof App.getPlayerAction === 'function' ? App.getPlayerAction : typeof root.getPlayerAction === 'function' ? root.getPlayerAction : null;
        if (!fn) return null;
        try { const a = fn(String(pid)); return a ? noUndef({ call: a.label || a.action, reason: a.reason }) : null; } catch (e) { return null; }
    }
    // League-wide and positional rank on the dynasty value scale (1 = best).
    let _rankMemo = null;
    function ranks() {
        const sc = scores();
        const sig = Object.keys(sc).length;
        if (_rankMemo && _rankMemo.sc === sc && _rankMemo.sig === sig) return _rankMemo;
        const overall = {}, byPos = {};
        const ids = Object.keys(sc).filter(pid => Number(sc[pid]) > 0).sort((a, b) => sc[b] - sc[a]);
        const posCount = {};
        ids.forEach((pid, i) => {
            overall[pid] = i + 1;
            const p = h.ppos(pid);
            posCount[p] = (posCount[p] || 0) + 1;
            byPos[pid] = p + posCount[p];
        });
        _rankMemo = { sc, sig, overall, byPos };
        return _rankMemo;
    }
    function depth(pid) {
        const p = h.pl(pid);
        const out = {};
        if (p.depth_chart_order != null) out.order = Number(p.depth_chart_order);
        if (p.depth_chart_position) out.position = p.depth_chart_position;
        try {
            const r = App.NflRoles && App.NflRoles.roleFor ? App.NflRoles.roleFor(p) : null;
            if (r && r.pos) out.role = r.pos + (r.rank || '');
        } catch (e) { /* roles not loaded */ }
        return Object.keys(out).length ? out : undefined;
    }
    function ownership(pid) {
        const r = h.rosterOf(pid);
        return r ? { owner: h.label(r), slot: h.slotOf(r, pid) } : { owner: 'free agent' };
    }
    function metaEssentials(pid) {
        const m = h.meta(pid);
        if (!m || !Object.keys(m).length) return undefined;
        const fc = m.fcValue ? noUndef({ value: Math.round(m.fcValue), rank: m.fcRank || (m.rankRail && m.rankRail.fcRank), pos_rank: m.fcPosRank }) : undefined;
        return noUndef({
            weighted_ppg: m.ppg ? round1(m.ppg) : undefined,
            last_year_ppg: m.lastYearPPG != null ? round1(m.lastYearPPG) : undefined,
            career_ppg: m.careerPPG != null ? round1(m.careerPPG) : undefined,
            peak_years_left: m.peakYrsLeft,
            age_phase: m.ageCurvePhase ? String(m.ageCurvePhase).replace(/_/g, ' ') : undefined,
            trend_pct_vs_last_season: m.trend || undefined,
            role: m.roleLabel || undefined,
            opportunity: m.opportunityLabel || undefined,
            status_note: m.statusCode && m.statusCode !== 'active' ? (m.statusReason || m.statusCode) : undefined,
            starter_seasons: m.starterSeasons || undefined,
            rookie: m.source === 'FC_ROOKIE' || m.source === 'PROSPECT_ROOKIE' ? true : undefined,
            fantasycalc: fc,
        });
    }
    // This season, league-scored, week by week: S.weeklyPlayerPoints (via
    // WeeklyProj.weeklyHistory) first; else the game log (SOS week stats).
    async function seasonLog(pid) {
        pid = String(pid);
        let weeks = [];
        const WP = App.WeeklyProj;
        if (WP && WP.weeklyHistory) { try { weeks = WP.weeklyHistory(pid) || []; } catch (e) { weeks = []; } }
        if (!weeks.length) {
            const wpp = S().weeklyPlayerPoints || {};
            Object.keys(wpp).forEach(k => { const v = wpp[k] && wpp[k][pid]; if (Number(k) > 0 && v != null) weeks.push({ week: Number(k), pts: Number(v) }); });
            weeks.sort((a, b) => a.week - b.week);
        }
        let source = 'league matchups';
        if (!weeks.length && App.GameLog && App.GameLog.buildPlayerLog) {
            const lg = h.league() || {};
            const rows = await h.withTimeout(App.GameLog.buildPlayerLog(pid, h.season(), { playersData: S().players || {}, scoring: lg.scoring_settings || {}, upToWeek: Math.max(1, h.week() - 1) }).catch(() => []), 4000, []);
            weeks = (rows || []).filter(r => r.played && r.pts != null).map(r => ({ week: r.week, pts: r.pts, opp: r.opp || undefined }));
            source = 'NFL box scores, league scoring';
        }
        if (!weeks.length) return null;
        const played = weeks.filter(w => Number(w.pts) !== 0);
        const total = weeks.reduce((s, w) => s + Number(w.pts || 0), 0);
        return {
            games: played.length, total: round1(total), ppg: played.length ? round1(total / played.length) : 0,
            weeks: weeks.slice(-17).map(w => noUndef({ wk: w.week, pts: round1(w.pts), opp: w.opp })), source,
        };
    }
    const STAT_KEYS = ['gp', 'pts_ppr', 'pts_half_ppr', 'pass_att', 'pass_cmp', 'pass_yd', 'pass_td', 'pass_int', 'rush_att', 'rush_yd', 'rush_td', 'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'fum_lost', 'fgm', 'fga', 'xpm', 'idp_tkl', 'idp_tkl_solo', 'idp_sack', 'idp_int', 'idp_ff', 'idp_pass_def', 'def_td', 'pts_allow'];
    function seasonStats(pid) {
        const st = (S().playerStats || {})[pid];
        if (!st || typeof st !== 'object') return undefined;
        const out = {};
        STAT_KEYS.forEach(k => { if (st[k] != null && Number(st[k]) !== 0) out[k] = round1(st[k]); });
        return Object.keys(out).length ? out : undefined;
    }
    function tradeHistory(pid) {
        pid = String(pid);
        const hist = LI().tradeHistory || [];
        const rows = hist.filter(t => Object.values(t.sides || {}).some(s => (s.players || []).map(String).includes(pid)))
            .sort((a, b) => (b.ts || 0) - (a.ts || 0) || String(b.season).localeCompare(String(a.season)) || (b.week || 0) - (a.week || 0))
            .slice(0, 6)
            .map(t => {
                const rid = Object.keys(t.sides).find(k => (t.sides[k].players || []).map(String).includes(pid));
                const from = (t.roster_ids || []).map(String).find(x => x !== String(rid));
                const rName = id => { const r = h.rosters().find(x => String(x.roster_id) === String(id)); return r ? h.teamName(r) : 'roster ' + id; };
                const side = s => (s.players || []).map(h.pname).concat((s.picks || []).map(pk => (pk.season || '') + ' round ' + (pk.round || '?') + ' pick'));
                return noUndef({ season: t.season, week: t.week, to: rName(rid), from: from != null ? rName(from) : undefined, package_received_with_him: side(t.sides[rid]).filter(n => n !== h.pname(pid)), sent_back: from != null && t.sides[from] ? side(t.sides[from]) : undefined });
            });
        if (rows.length) return rows;
        const lite = (LI().playerTradeHistory || {})[pid];
        return lite && lite.length ? lite.slice(-6).map(x => ({ season: x.season, week: x.week })) : undefined;
    }
    function newsItem(it, who) {
        return noUndef({
            date: it.published_at ? String(it.published_at).slice(0, 10) : undefined,
            player: who, kind: it.kind,
            via: it.link === 'team' || it.link === 'teammate' ? (it.why || 'his team') : undefined,
            headline: it.headline, summary: it.summary ? String(it.summary).slice(0, 240) : undefined,
            source: it.source, url: it.url,
        });
    }
    async function newsMap(pids) {
        const PN = App.PlayerNews;
        if (!PN || !PN.get || !pids.length) return null;
        try { return await h.withTimeout(PN.get(pids.map(String)), NEWS_MS, null); } catch (e) { return null; }
    }
    async function wireRead(pid) {
        const PW = root.WR && root.WR.PlayerWire;
        if (!PW || !PW.fetchRead) return null;
        try {
            const r = await h.withTimeout(PW.fetchRead(String(pid), S().players || {}), NEWS_MS, null);
            return r && r.story ? noUndef({ headline: r.headline, date: r.published ? String(r.published).slice(0, 10) : r.dateLabel, report: String(r.story).slice(0, 900), source: r.source }) : null;
        } catch (e) { return null; }
    }
    function resolve(q) {
        const f = h.findPlayer(q);
        if (!f) throw new Error('No player matches "' + q + '". Try the full name.');
        return f;
    }
    // The compact line compare_players and search lean on.
    function card(pid) {
        const p = h.pl(pid), rk = ranks();
        return noUndef(Object.assign({
            id: String(pid), name: h.pname(pid), pos: h.ppos(pid), nfl_team: p.team || 'FA', age: p.age || undefined, years_exp: p.years_exp,
            value: h.value(pid) || undefined, league_rank: rk.overall[pid], pos_rank: rk.byPos[pid],
            injury: h.injury(pid) || undefined, depth: depth(pid),
        }, ownership(pid), { this_week: h.thisWeek(pid) }));
    }

    // ── get_player ─────────────────────────────────────────────────
    AT.register({
        name: 'get_player',
        description: 'Everything about one player: bio, injury, NFL depth chart, who owns him in this league, dynasty value and ranks, the buy/sell/hold call, this week (projection or points, opponent), this season week by week in league scoring, his trade history here, and recent news plus his written report.',
        parameters: { type: 'object', properties: { player: { type: 'string', description: 'Player name ("Courtland Sutton", "Sutton") or Sleeper id.' } }, required: ['player'] },
        async run(a) {
            const f = resolve(a.player);
            const pid = f.pid, p = h.pl(pid);
            const [log, news, wire] = await Promise.all([seasonLog(pid).catch(() => null), newsMap([pid]), wireRead(pid)]);
            const items = news && news[pid] ? news[pid].slice().sort((x, y) => String(y.published_at || '').localeCompare(String(x.published_at || ''))).slice(0, 6).map(it => newsItem(it)) : null;
            const out = card(pid);
            Object.assign(out, noUndef({
                bio: noUndef({ number: p.number, college: p.college, height: p.height, weight: p.weight, birth_date: p.birth_date, status: p.status }),
                injury_detail: p.injury_status ? noUndef({ status: p.injury_status, body_part: p.injury_body_part, notes: p.injury_notes, practice: p.practice_participation, start_date: p.injury_start_date }) : undefined,
                bye_week: p.bye_week || undefined,
                outlook: metaEssentials(pid),
                call: action(pid) || undefined,
                season: log ? Object.assign({ year: h.season() }, log) : undefined,
                season_stats: seasonStats(pid),
                trades_in_this_league: tradeHistory(pid),
                news: items && items.length ? items : undefined,
                report: wire || undefined,
            }));
            if (f.alternatives && f.alternatives.length) out.alternatives = f.alternatives;
            if (!news && !wire) out.news_note = 'News could not be loaded right now.';
            return out;
        },
    });

    // ── compare_players ────────────────────────────────────────────
    AT.register({
        name: 'compare_players',
        description: 'Two to six players side by side: dynasty value and ranks, age and career phase, owner, injury, depth chart, the buy/sell/hold call, this week, and this season\'s points per game. Facts only; no verdict.',
        parameters: { type: 'object', properties: { players: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6, description: 'Player names or ids.' } }, required: ['players'] },
        async run(a) {
            const list = Array.isArray(a.players) ? a.players : String(a.players || '').split(/,|\bvs\.?\b|\bor\b/i);
            const qs = list.map(x => String(x).trim()).filter(Boolean).slice(0, 6);
            if (qs.length < 2) throw new Error('Name at least two players to compare.');
            const missing = [];
            const found = [];
            qs.forEach(q => { const f = h.findPlayer(q); if (f && !found.some(x => x.pid === f.pid)) found.push(Object.assign({ q }, f)); else if (!f) missing.push(q); });
            if (found.length < 2) throw new Error('Could not find enough players to compare' + (missing.length ? ' (no match for ' + missing.join(', ') + ')' : '') + '.');
            const logs = await Promise.all(found.map(f => seasonLog(f.pid).catch(() => null)));
            const rows = found.map((f, i) => {
                const m = h.meta(f.pid), lg = logs[i];
                return noUndef(Object.assign(card(f.pid), {
                    peak_years_left: m.peakYrsLeft, age_phase: m.ageCurvePhase ? String(m.ageCurvePhase).replace(/_/g, ' ') : undefined,
                    trend_pct: m.trend || undefined, dynasty_ppg: m.ppg ? round1(m.ppg) : undefined,
                    role: m.roleLabel || undefined, fantasycalc_value: m.fcValue ? Math.round(m.fcValue) : undefined,
                    call: action(f.pid) || undefined,
                    season: lg ? { games: lg.games, ppg: lg.ppg, last3: lg.weeks.slice(-3).map(w => w.pts) } : undefined,
                    matched_from: f.alternatives && f.alternatives.length ? f.q + ' (also: ' + f.alternatives.join('; ') + ')' : undefined,
                }));
            });
            return noUndef({ players: rows, not_found: missing.length ? missing : undefined });
        },
    });

    // ── search_players ─────────────────────────────────────────────
    AT.register({
        name: 'search_players',
        description: 'League-wide player rankings and filters: by position (or FLEX), availability (all, free agents, rostered, mine), NFL team and age, sorted by dynasty value, this week\'s projection, points per game or age. Answers "top 20 WRs in my league", "best available RB", "who on waivers projects best this week", "youngest QBs".',
        parameters: {
            type: 'object',
            properties: {
                position: { type: 'string', description: 'QB, RB, WR, TE, K, DEF, DL, LB, DB, FLEX (RB/WR/TE), SUPER_FLEX or IDP. Omit for all.' },
                availability: { type: 'string', enum: ['all', 'free_agents', 'rostered', 'mine'], description: 'Default all.' },
                sort: { type: 'string', enum: ['value', 'this_week', 'ppg', 'age'], description: 'value (dynasty, default), this_week (projection or points), ppg (dynasty-weighted points per game), age (youngest first).' },
                nfl_team: { type: 'string', description: 'NFL team abbreviation, e.g. DEN.' },
                min_age: { type: 'number' }, max_age: { type: 'number' },
                limit: { type: 'integer', description: 'Rows, default 15, max 40.' },
            },
        },
        async run(a) {
            let want = posSet(a.position);
            if (want && !want.every(p => POS_ALL.includes(p))) throw new Error('Unknown position "' + a.position + '". Use QB, RB, WR, TE, K, DEF, DL, LB, DB or FLEX.');
            const avail = String(a.availability || 'all').toLowerCase().replace(/[\s-]/g, '_');
            // Free agents: only positions this league can start.
            if (avail === 'free_agents') {
                const startable = leaguePositions();
                if (want) {
                    const ok = want.filter(p => startable.includes(p));
                    if (!ok.length) return { matches: 0, players: [], note: 'This league has no ' + want.join('/') + ' slot, so a free agent there can\'t score for you. It starts: ' + startable.join(', ') + '.' };
                    want = ok;
                } else want = startable;
            }
            const sort = String(a.sort || 'value').toLowerCase();
            const team = (a.nfl_team || a.team) ? String(a.nfl_team || a.team).toUpperCase().trim() : null;
            const limit = Math.max(1, Math.min(40, Number(a.limit) || 15));
            const players = S().players || {};
            if (!Object.keys(players).length) throw new Error('Player data is still loading.');
            const rostered = rosteredSet(), mine = mineSet();
            // Pool: everyone the app values, plus everyone rostered (IDP, K, DEF).
            const pool = new Set(Object.keys(scores()).filter(pid => Number(scores()[pid]) > 0));
            rostered.forEach(pid => pool.add(pid));
            if (avail === 'free_agents' && (sort === 'this_week' || (want && want.some(p => p === 'K' || p === 'DEF')))) {
                for (const pid in players) { const p = players[pid]; if (p && p.team && p.active !== false && (!want || want.includes(h.ppos(pid)))) pool.add(pid); }
            }
            let ids = [...pool].filter(pid => {
                const p = players[pid];
                if (!p) return false;
                if (want && !want.includes(h.ppos(pid))) return false;
                if (avail === 'free_agents' && (rostered.has(pid) || !p.team || p.status === 'Retired' || p.active === false)) return false;
                if (avail === 'rostered' && !rostered.has(pid)) return false;
                if (avail === 'mine' && !mine.has(pid)) return false;
                if (team && String(p.team || '').toUpperCase() !== team) return false;
                if (a.min_age != null && !(Number(p.age) >= Number(a.min_age))) return false;
                if (a.max_age != null && !(Number(p.age) > 0 && Number(p.age) <= Number(a.max_age))) return false;
                return true;
            });
            const wk = {};
            const weekPts = pid => { if (!(pid in wk)) { const t = h.thisWeek(pid); wk[pid] = t.scored != null ? t.scored : t.proj != null ? t.proj : null; } return wk[pid]; };
            const key = {
                value: pid => h.value(pid),
                this_week: pid => { const v = weekPts(pid); return v == null ? -1e9 : v; },
                ppg: pid => Number(h.meta(pid).ppg) || 0,
                age: pid => -(Number(h.pl(pid).age) || 99),
            }[sort] || (pid => h.value(pid));
            if (sort === 'this_week') ids = ids.filter(pid => weekPts(pid) != null);
            ids.sort((x, y) => key(y) - key(x) || h.value(y) - h.value(x));
            const total = ids.length;
            const rk = ranks();
            const rows = ids.slice(0, limit).map((pid, i) => noUndef(Object.assign({ rank: i + 1 }, h.playerBrief(pid), { pos_rank: rk.byPos[pid], depth: depth(pid) })));
            if (!rows.length) return { matches: 0, players: [], note: 'No players match those filters.' + (sort === 'this_week' ? ' Projections may still be loading.' : '') };
            return noUndef({ filters: noUndef({ position: a.position, availability: avail, sort, nfl_team: team, min_age: a.min_age, max_age: a.max_age }), matches: total, players: rows, note: sort === 'this_week' ? 'this_week = points scored once his game started, else the projection.' : undefined });
        },
    });

    // ── Waivers ────────────────────────────────────────────────────
    function isFaab(lg) {
        if (!lg) return false;
        if (App.FaabLeague && App.FaabLeague.isFaabLeague) { try { return !!App.FaabLeague.isFaabLeague(lg); } catch (e) { /* fall through */ } }
        const st = lg.settings || {};
        return Number(st.waiver_budget) > 0 && (st.waiver_type == null || Number(st.waiver_type) === 2);
    }
    const leftOf = (lg, r) => Math.max(0, (Number((lg.settings || {}).waiver_budget) || 0) - (Number(((r || {}).settings || {}).waiver_budget_used) || 0));
    function myFaab() {
        const lg = h.league();
        const fn = typeof App.getFAAB === 'function' ? App.getFAAB : typeof root.getFAAB === 'function' ? root.getFAAB : null;
        if (fn) { try { const f = fn(); if (f && f.isFAAB) return { budget: f.budget, spent: f.spent, left: f.remaining, min_bid: f.minBid || 1 }; if (f && f.isFAAB === false) return null; } catch (e) { /* fall through */ } }
        if (!isFaab(lg)) return null;
        const st = lg.settings || {}, me = h.myRoster();
        return { budget: Number(st.waiver_budget), spent: Number(((me || {}).settings || {}).waiver_budget_used) || 0, left: leftOf(lg, me), min_bid: Number(st.waiver_bid_min != null ? st.waiver_bid_min : st.waiver_budget_min) || 1 };
    }
    async function trending(type) {
        const SL = root.Sleeper;
        let list = null;
        if (SL && SL.fetchTrending) list = await h.withTimeout(Promise.resolve(SL.fetchTrending(type, 24, 25)).catch(() => null), 4000, null);
        else if (typeof root.fetch === 'function') {
            list = await h.withTimeout(root.fetch('https://api.sleeper.app/v1/players/nfl/trending/' + type + '?lookback_hours=24&limit=25').then(r => (r.ok ? r.json() : null)).catch(() => null), 4000, null);
        }
        return Array.isArray(list) ? list : null;
    }
    function isFreeAgent(pid, rostered) {
        const p = (S().players || {})[pid];
        return !!(p && p.team && !(rostered || rosteredSet()).has(String(pid)) && p.active !== false && p.status !== 'Retired');
    }
    function leaguePositions() {
        const lg = h.league() || {};
        const set = new Set();
        (lg.roster_positions || []).forEach(s => {
            const k = String(s).toUpperCase();
            if (k === 'BN' || k === 'IR' || k === 'TAXI') return;
            (FLEX[k] || [(App.normPos && App.normPos(k)) || k]).forEach(p => { if (POS_ALL.includes(String(p).toUpperCase())) set.add(String(p).toUpperCase()); });
        });
        return set.size ? POS_ALL.filter(p => set.has(p)) : ['QB', 'RB', 'WR', 'TE'];
    }
    AT.register({
        name: 'get_waiver_report',
        description: 'The free-agent picture in this league: best available players by position (dynasty value and this week\'s projection), what is trending on Sleeper (adds and drops, and whether each is available here), my FAAB left and the minimum bid, every team\'s FAAB left, the waiver order, and what this league usually pays by position.',
        parameters: { type: 'object', properties: { position: { type: 'string', description: 'Limit to one position (QB, RB, WR, TE, K, DEF, DL, LB, DB or FLEX). Default: every position this league starts.' } } },
        async run(a) {
            const lg = h.league();
            if (!lg || !h.rosters().length) throw new Error('League not loaded yet.');
            const players = S().players || {};
            const rostered = rosteredSet();
            const startable = leaguePositions();
            const asked = a.position ? (posSet(a.position) || []) : null;
            const positions = asked ? asked.filter(p => startable.includes(p)) : startable;
            if (asked && !positions.length) return { week: h.week(), best_available: {}, note: 'This league has no ' + (asked.join('/') || String(a.position)) + ' slot, so a free agent there can\'t score for you. It starts: ' + startable.join(', ') + '.' };
            const isFA = pid => isFreeAgent(pid, rostered);
            const fas = Object.keys(players).filter(isFA);
            const best = {};
            positions.forEach(pos => {
                const here = fas.filter(pid => h.ppos(pid) === pos);
                const brief = pid => noUndef({ name: h.pname(pid), nfl_team: h.pl(pid).team, age: h.pl(pid).age || undefined, value: h.value(pid) || undefined, this_week: (t => (t.scored != null ? t.scored : t.proj))(h.thisWeek(pid)), injury: h.injury(pid) || undefined });
                const byValue = here.filter(pid => h.value(pid) > 0).sort((x, y) => h.value(y) - h.value(x)).slice(0, 5).map(brief);
                const byWeek = here.map(pid => [pid, (t => (t.scored != null ? t.scored : t.proj))(h.thisWeek(pid))]).filter(x => x[1] != null).sort((x, y) => y[1] - x[1]).slice(0, 5).map(x => brief(x[0]));
                if (byValue.length || byWeek.length) best[pos] = noUndef({ by_value: byValue.length ? byValue : undefined, by_this_week: byWeek.length ? byWeek : undefined });
            });
            const [adds, drops] = await Promise.all([trending('add'), trending('drop')]);
            // Trending lists: only positions this league starts (Sleeper's
            // trending is mostly team DEFs, useless without a DEF slot).
            const trend = list => (list || []).filter(x => x && x.player_id && players[x.player_id] && startable.includes(h.ppos(x.player_id))).slice(0, 15).map(x => {
                const pid = String(x.player_id), r = h.rosterOf(pid);
                return noUndef({ name: h.pname(pid), pos: h.ppos(pid), nfl_team: h.pl(pid).team || 'FA', count_24h: x.count, here: r ? h.label(r) : 'available', value: h.value(pid) || undefined });
            });
            const faabOn = isFaab(lg);
            const out = { week: h.week(), platform: h.platform(), waiver_type: App.FaabLeague && App.FaabLeague.waiverLabel ? App.FaabLeague.waiverLabel(lg) : faabOn ? 'FAAB' : 'waivers', best_available: best };
            if (adds) out.trending_adds = trend(adds); else out.trending_note = 'Sleeper trending list could not be loaded.';
            if (drops) out.trending_drops = trend(drops);
            if (faabOn) {
                const mine = myFaab();
                if (mine) out.my_faab = mine;
                const teams = h.rosters().map(r => ({ team: h.label(r), left: leftOf(lg, r) })).sort((x, y) => y.left - x.left);
                if (h.rosters().some(r => r.settings && r.settings.waiver_budget_used != null)) out.faab_left_by_team = teams;
                const byPos = LI().faabByPos || {};
                const pay = {};
                Object.keys(byPos).forEach(pos => { const d = byPos[pos] || {}; if (d.count) pay[pos] = noUndef({ bids: d.count, avg: round1(d.avg), median: d.median, p75: d.p75 }); });
                if (Object.keys(pay).length) out.league_pays_by_position = pay;
            }
            const order = h.rosters().filter(r => r.settings && r.settings.waiver_position != null).sort((x, y) => x.settings.waiver_position - y.settings.waiver_position).map(r => ({ pos: r.settings.waiver_position, team: h.label(r) }));
            if (order.length) out.waiver_order = order;
            if (h.platform() !== 'sleeper') out.note = 'This league is on ' + h.platform() + '; FAAB, waiver order and trending reads are Sleeper-first and may be partial.';
            return out;
        },
    });

    // ── get_waiver_bid ─────────────────────────────────────────────
    function txnsFor(id) {
        const T = root.WrTxns;
        if (!T || !T.getCached) return [];
        try { return (T.getCached(id) || []).concat(T.getFailedWaivers ? (T.getFailedWaivers(id) || []) : []); } catch (e) { return []; }
    }
    async function loadTxns(id) {
        let txns = txnsFor(id);
        if (!txns.length && root.WrTxns && root.WrTxns.fetchLeagueTxns) {
            await h.withTimeout(Promise.resolve(root.WrTxns.fetchLeagueTxns(id)).catch(() => null), 5000, null);
            txns = txnsFor(id);
        }
        return txns;
    }
    const valueOf = pid => {
        const PV = App.PlayerValue;
        if (PV && PV.getValue) { try { const v = Number(PV.getValue(pid, {})); if (v > 0) return v; } catch (e) { /* fall through */ } }
        return Number(scores()[pid]) || 0;
    };
    // The regular season's first day. Sleeper's nflState.season_start_date
    // is the regular-season start once season_type is regular/post (verified
    // live 2026-10-10: '2026-09-09'); in August it can be the preseason, so
    // otherwise use the Wednesday after Labor Day.
    function seasonStartMs() {
        const ns = S().nflState || {};
        const yr = Number(h.season()) || new Date().getUTCFullYear();
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ns.season_start_date || ''));
        if (m && (ns.season_type === 'regular' || ns.season_type === 'post') && Number(m[1]) === yr) return Date.UTC(yr, Number(m[2]) - 1, Number(m[3]));
        const dow = new Date(Date.UTC(yr, 8, 1)).getUTCDay();
        return Date.UTC(yr, 8, 1 + ((8 - dow) % 7) + 2);
    }
    // Waiver bids made on or after the season start; offseason claims out.
    // A bid with no timestamp counts only from week 2 on (Sleeper files the
    // offseason under week 1).
    function inSeason(txns) {
        const start = seasonStartMs();
        let excluded = 0;
        const kept = (txns || []).filter(t => {
            if (!t || t.type !== 'waiver' || !(Number(t.settings && t.settings.waiver_bid) > 0)) return true;
            const ok = Number(t.created) > 0 ? Number(t.created) >= start : Number(t.leg) >= 2;
            if (!ok) excluded++;
            return ok;
        });
        return { txns: kept, excluded, start: new Date(start).toISOString().slice(0, 10) };
    }
    const quant = (sorted, p) => (App.Faab && App.Faab.quantile ? App.Faab.quantile(sorted, p) : sorted[Math.round((sorted.length - 1) * p)]);
    function bidStats(txns) {
        const bids = (txns || []).filter(t => t && t.type === 'waiver' && Number(t.settings && t.settings.waiver_bid) > 0).map(t => Number(t.settings.waiver_bid)).sort((x, y) => x - y);
        if (!bids.length) return { count: 0 };
        return { count: bids.length, p50: Math.round(quant(bids, 0.5)), p75: Math.round(quant(bids, 0.75)), p90: Math.round(quant(bids, 0.9)) };
    }
    // In-season WINNING bids at one position, newest first.
    function posComps(txns, pos, limit) {
        return (txns || []).filter(t => t && t.type === 'waiver' && t.status !== 'failed' && Number(t.settings && t.settings.waiver_bid) > 0 && t.adds && h.ppos(Object.keys(t.adds)[0]) === pos)
            .sort((x, y) => (Number(y.created) || 0) - (Number(x.created) || 0))
            .slice(0, limit || 6)
            .map(t => ({ player: h.pname(Object.keys(t.adds)[0]), bid: Number(t.settings.waiver_bid), week: Number(t.leg) || undefined }));
    }
    function compSummary(comps) {
        const b = (comps || []).map(c => c.bid).sort((x, y) => x - y);
        return b.length ? { wins: b.length, median: Math.round(quant(b, 0.5)), p75: Math.round(quant(b, 0.75)), max: b[b.length - 1] } : undefined;
    }
    function estimateFor(pid, txns, lg, me) {
        const id = lid();
        const league = Object.assign({}, lg, { rosters: h.rosters(), users: h.users() });
        let gm = {};
        try { gm = (root.WR && root.WR.GmMode && root.WR.GmMode.effects && root.WR.GmMode.effects(id)) || {}; } catch (e) { gm = {}; }
        let horizonWeeks = null;
        try { horizonWeeks = (App.ChopOdds && App.ChopOdds.horizonFor && App.ChopOdds.horizonFor(id, null)) || null; } catch (e) { horizonWeeks = null; }
        const opts = { league, myRosterId: me.roster_id, txns, playersData: S().players || {}, minBidOverride: gm.faabMinBid || undefined, targetPid: pid, targetPos: h.ppos(pid), dhq: valueOf(pid), playerValue: valueOf, horizonWeeks };
        return { est: App.Faab.estimate(opts), limits: App.Faab.limits ? App.Faab.limits(opts) : null };
    }
    AT.register({
        name: 'get_waiver_bid',
        description: 'How much FAAB to bid on a free agent: the app\'s bid model (this league\'s in-season bid history and rivals\' needs and budgets) gives the suggested bid, a range, the win chance, which teams are likely to bid against me, recent winning bids at his position, and my FAAB left.',
        parameters: { type: 'object', properties: { player: { type: 'string', description: 'Player name or id.' } }, required: ['player'] },
        async run(a) {
            const Faab = App.Faab;
            if (!Faab || !Faab.estimate) throw new Error('The FAAB bid model is not loaded on this page.');
            const lg = h.league(), me = h.myRoster();
            if (!lg || !me) throw new Error('League not loaded yet.');
            if (!isFaab(lg)) throw new Error('This league does not use FAAB bidding' + (App.FaabLeague && App.FaabLeague.waiverLabel ? ' (it uses ' + App.FaabLeague.waiverLabel(lg) + ')' : '') + '.');
            if (h.platform() !== 'sleeper') throw new Error('Bid estimates need a Sleeper league; this league\'s bid history isn\'t imported.');
            const f = resolve(a.player);
            const pid = f.pid;
            const holder = h.rosterOf(pid);
            if (holder) throw new Error(h.pname(pid) + ' is not a free agent: ' + h.label(holder) + ' rosters him.');
            const ins = inSeason(await loadTxns(lid()));
            const { est, limits: lim } = estimateFor(pid, ins.txns, lg, me);
            if (!est) {
                if (lim && lim.exhausted) throw new Error('No legal bid left: $' + lim.myLeft + ' FAAB left, the minimum bid is $' + lim.minBid + '.');
                throw new Error('No bid estimate for this league.');
            }
            const an = est.analysis || {};
            const out = {
                player: noUndef({ name: h.pname(pid), pos: h.ppos(pid), nfl_team: h.pl(pid).team || 'FA', value: h.value(pid) || undefined, injury: h.injury(pid) || undefined }),
                suggested_bid: est.sug,
                range: Faab.formatRange ? Faab.formatRange(est, '–') : '$' + est.lo + '–' + est.hi,
                range_lo: est.lo, range_hi: est.hi,
                win_chance_pct: est.winPct != null ? Math.round(est.winPct * 100) : null,
                capped_by_spend_limit: !!est.capped || undefined,
                my_faab: { left: est.myLeft, budget: est.budget, min_bid: est.minBid },
                rivals: (an.rivals || []).filter(r => r.engaged).slice(0, 5).map(r => ({ team: r.name, need: r.need, faab_left: r.faabLeft, est_bid: r.estBid })),
                league_market_bid: an.marketBid, league_median_bid: an.medianBid,
                in_season_bids: Object.assign(bidStats(ins.txns), { since: ins.start, offseason_claims_excluded: ins.excluded }),
                based_on: est.coldStart ? 'Only ' + est.sampleSize + ' in-season bids in this league so far: league-typical defaults, not per-rival reads.' : est.sampleSize + ' in-season FAAB bids from this league (winning and losing; offseason claims left out).',
            };
            const allComps = posComps(ins.txns, h.ppos(pid), 999);
            const comps = allComps.slice(0, 5);
            if (comps.length) { out.recent_winning_bids_at_position = comps; out.position_in_season_wins = compSummary(allComps); }
            else if ((an.comps || []).length) out.recent_winning_bids = an.comps.slice(0, 5).map(c => noUndef({ week: c.week, player: c.pid ? h.pname(c.pid) : undefined, bid: c.bid }));
            if (f.alternatives && f.alternatives.length) out.alternatives = f.alternatives;
            return noUndef(out);
        },
    });

    // ── get_waiver_plan ────────────────────────────────────────────
    // The waiver DECISION, verdict first. Adds are ranked by need-weighted
    // value (value × 1.6 deficit / 1.3 thin / 0.6 surplus at his position —
    // a need counts only if he'd start there, i.e. projects above my weakest
    // starter at that position — + 35 × this week's projection); free-agent
    // backups to my own starting RB/QB go first. Every add is paired with a
    // drop from App.AskRoster's one drop list (active roster only), and only
    // when the add's keep score (need-weighted) beats that drop's by
    // ADD_MARGIN (a no-NFL-team or "cut"-tagged drop always qualifies). Open
    // active spots are used before any drop.
    const FIT = { deficit: 1.6, thin: 1.3, surplus: 0.6 };
    const ADD_MARGIN = 100, CUFF_BONUS = 300, STASH_BID_VALUE = 500, MAX_ADDS = 5;
    const PLAN_METHOD = 'Waiver plan: (1) only free agents at positions this league starts; (2) rank by need: value x 1.6 at a deficit, 1.3 thin (only if he would start there), 0.6 surplus, plus 35 x this week\'s projection; backups to your own starting RB/QB (handcuffs) first; (3) every add names its drop from the one roster drop list (active roster only, never taxi, IR, an injured stash or an engine-gap 0), and only if the add beats that drop; an open active spot is used first; (4) bids from the in-season bid model (offseason claims excluded): open at the model\'s bid, max at the higher of its range top and the in-season winning bids at his position (at the quantile matching his strength), never above the pace cap (FAAB left x 1.5 / weeks left, 15–65%); stash-level adds (value under 500) open at the league minimum, max at the bottom of the model\'s range; (5) a need the wire can\'t fill is a trade, not a claim.';
    AT.register({
        name: 'get_waiver_plan',
        description: 'The waiver decision for my team: who to claim, each paired with who to drop (active roster only, never taxi/IR or an injured stash), an opening bid and a max with in-season comparable bids, handcuffs to my own starters on the wire, FAAB pacing by weeks left, and who not to add. Use for "who should I pick up", "who do I drop", "how much should I bid".',
        parameters: { type: 'object', properties: {
            position: { type: 'string', description: 'Limit adds to one position (QB, RB, WR, TE, K, DL, LB, DB, FLEX...). Default: every position this league starts.' },
            budget_pct: { type: 'number', description: 'Most of my remaining FAAB to put on any one claim, in percent (default: the pace cap).' },
        } },
        timeoutMs: 15000,
        async run(a) {
            const lg = h.league(), me = h.myRoster();
            if (!lg || !me) throw new Error('League not loaded yet.');
            const AR = App.AskRoster;
            if (!AR || !AR.cutPlan) throw new Error('The roster plan is not loaded on this page.');
            const startable = leaguePositions();
            let want = startable;
            if (a.position) {
                const ps = posSet(a.position);
                if (!ps || !ps.every(p => POS_ALL.includes(p))) throw new Error('Unknown position "' + a.position + '". Use QB, RB, WR, TE, K, DL, LB, DB or FLEX.');
                want = ps.filter(p => startable.includes(p));
                if (!want.length) return { decision: 'no_slot', confidence: 'high', recommendation: 'Don\'t add a ' + ps.join('/') + ': this league has no ' + ps.join('/') + ' slot, so he can\'t score for you.', adds: [], do_not_add: [{ player: 'any ' + ps.join('/'), why: 'No ' + ps.join('/') + ' slot. This league starts ' + startable.join(', ') + '.' }], rules_applied: ['Only positions this league can start.'], method: PLAN_METHOD };
            }
            const st = lg.settings || {};
            const faabOn = isFaab(lg) && h.platform() === 'sleeper' && !!(App.Faab && App.Faab.estimate);
            const fa = isFaab(lg) ? myFaab() : null;
            const wk = h.week();
            const lastReg = Number(st.playoff_week_start) > 1 ? Number(st.playoff_week_start) - 1 : null;
            const weeksLeft = lastReg ? Math.max(1, lastReg - wk) : null;
            const left = fa ? fa.left : 0, minBid = fa ? fa.min_bid : 0;
            let cap = fa ? Math.max(minBid, Math.round(left * Math.min(0.65, Math.max(0.15, 1.5 / (weeksLeft || 10))))) : 0;
            const pct = Number(a.budget_pct);
            if (fa && pct > 0) cap = Math.min(cap, Math.max(minBid, Math.round(left * Math.min(100, pct) / 100)));
            if (fa) cap = Math.min(cap, left);
            const ins = faabOn ? inSeason(await loadTxns(lid())) : { txns: [], excluded: 0, start: null };
            const A = h.assess(me.roster_id) || {};
            const needOf = {};
            (A.strengths || []).forEach(p => { needOf[p] = 'surplus'; });
            (A.needs || []).forEach(n => { needOf[n.pos] = n.urgency; });
            const contending = /CONTEND/i.test(String(A.window || ''));
            const rostered = rosteredSet();
            const players = S().players || {};
            const projOf = pid => { const t = h.thisWeek(pid); return t.scored != null ? t.scored : t.proj != null ? t.proj : null; };
            // A need only counts for a player who would start there: his
            // projection beats my weakest starter's at that position (a TE3
            // projecting 0.7 doesn't fix a TE deficit; that's a trade).
            const starterProj = {};
            (me.starters || []).map(String).filter(x => x && x !== '0').forEach(sid => { const ps = h.ppos(sid); const v = Number(projOf(sid)) || 0; starterProj[ps] = starterProj[ps] == null ? v : Math.min(starterProj[ps], v); });
            const fitOf = pid => {
                const pos = h.ppos(pid), need = needOf[pos];
                if (need === 'surplus') return { mult: FIT.surplus };
                if (need !== 'deficit' && need !== 'thin') return { mult: 1 };
                const pr = projOf(pid);
                if (starterProj[pos] == null || (pr != null && pr > starterProj[pos])) return { mult: FIT[need], fills: need };
                return { mult: 1, short: need, vs: starterProj[pos], pr };
            };
            const addScore = pid => Math.round(h.value(pid) * fitOf(pid).mult + (Number(projOf(pid)) || 0) * 35);
            const fas = Object.keys(players).filter(pid => isFreeAgent(pid, rostered) && want.includes(h.ppos(pid)) && !/inactive/i.test(String(players[pid].status || '')));
            const cuffs = AR.handcuffs(me);
            const cuffFA = cuffs.filter(c => c.owner === 'free agent' && want.includes(c.pos) && fas.includes(c.backup));
            const cuffOf = {};
            cuffFA.forEach(c => { cuffOf[c.backup] = c.starter; });
            const ranked = fas.filter(pid => h.value(pid) > 0 || (Number(projOf(pid)) || 0) > 0).sort((x, y) => addScore(y) - addScore(x)).slice(0, 40);
            const order = [...new Set(cuffFA.map(c => c.backup).concat(ranked))];
            const plan = AR.cutPlan(me);
            const counts = plan.counts;
            let open = counts.open != null ? Math.max(0, counts.open) : 0;
            const drops = plan.candidates.slice();
            const adds = [], do_not_add = [];
            const coldStarts = [];
            const filled = new Set();
            for (const pid of order) {
                if (adds.length >= MAX_ADDS) break;
                const vr = AR.valueRead(pid);
                const isCuff = !!cuffOf[pid];
                const fit = fitOf(pid);
                const worth = AR.keepScore(pid, vr) + (vr.value || 0) * (fit.mult - 1) + (isCuff && contending ? CUFF_BONUS : 0);
                let drop;
                if (open > 0) { open--; drop = { player: null, why: 'You have an open active spot (' + counts.active + '/' + counts.max + '); no drop needed.' }; }
                else {
                    const i = drops.findIndex(d => d.rank_key < 0 || d.keep_score + ADD_MARGIN < worth);
                    if (i < 0) {
                        if (adds.length + do_not_add.length < 8) do_not_add.push({ player: h.pname(pid), why: 'Not an upgrade on anyone you can safely drop' + (drops[0] ? ' (lowest safe drop: ' + drops[0].player + ', keep score ' + drops[0].keep_score + ')' : ' (nobody on the active roster is a safe drop)') + '.' });
                        continue;
                    }
                    const d = drops.splice(i, 1)[0];
                    drop = { player: d.player, why: d.why, value: d.value, value_source: d.value_source };
                }
                const p = h.pl(pid);
                const why = [];
                if (isCuff) why.push('Handcuff: backs up your starter ' + h.pname(cuffOf[pid]) + ' (' + p.team + ' ' + h.ppos(pid) + '2)');
                if (fit.fills) filled.add(h.ppos(pid));
                if (fit.fills) why.push('fills your ' + fit.fills + ' ' + h.ppos(pid) + ' spot');
                else if (fit.short) why.push(h.ppos(pid) + ' is ' + fit.short + ' for you, but he wouldn\'t start (projects ' + (fit.pr != null ? round1(fit.pr) : 'nothing') + ' vs your starter\'s ' + round1(fit.vs) + ')');
                why.push('value ' + (vr.value != null ? vr.value : 'unknown'));
                const pr = projOf(pid);
                if (pr != null) why.push('projects ' + round1(pr) + ' this week');
                if (h.injury(pid)) why.push(h.injury(pid));
                const g = h.lock(pid);
                if (g && g.locked) why.push('already played this week, so he helps from next week');
                let bid = null;
                if (faabOn && fa) {
                    const { est } = estimateFor(pid, ins.txns, lg, me);
                    if (est) {
                        if (est.coldStart) coldStarts.push(pid);
                        const comps = posComps(ins.txns, h.ppos(pid), 999);
                        const sum = compSummary(comps);
                        // The position's in-season winning bids at the same
                        // quantile the bid model uses for this player's strength.
                        const qPos = 0.4 + 0.5 * (App.Faab.strengthOf ? App.Faab.strengthOf(vr.value || 0) : 0.5);
                        const compBids = comps.map(c => c.bid).sort((x, y) => x - y);
                        const compQ = compBids.length >= 3 ? Math.round(quant(compBids, qPos)) : 0;
                        const stash = (vr.value || 0) < STASH_BID_VALUE;
                        let openBid = stash ? minBid : est.sug;
                        let max = stash ? Math.max(minBid, Math.min(est.lo, cap)) : Math.max(openBid, est.hi, compQ);
                        max = Math.min(max, cap);
                        openBid = Math.min(openBid, max);
                        bid = noUndef({ open: openBid, max, win_chance_pct: est.winPct != null ? Math.round(est.winPct * 100) : undefined, comps: comps.slice(0, 5), comps_summary: sum, basis: stash ? 'stash-level add: open at the league minimum' : 'bid model ' + (est.coldStart ? '(few in-season bids: league defaults)' : '(in-season bids)') + (compQ ? '; in-season ' + h.ppos(pid) + ' wins at his strength: $' + compQ : '') + (max === cap ? '; max held to your pace cap $' + cap : '') });
                    }
                }
                adds.push(noUndef({ player: noUndef({ name: h.pname(pid), pos: h.ppos(pid), nfl_team: p.team, age: p.age || undefined, value: vr.value, value_source: vr.value_source }), handcuff: isCuff || undefined, why: why.join('; ') + '.', bid: bid || (fa ? undefined : { note: 'This league uses ' + (App.FaabLeague && App.FaabLeague.waiverLabel ? App.FaabLeague.waiverLabel(lg) : 'waivers') + ', not bids.' }), drop }));
            }
            // Needs the wire can't fill: a trade, not a claim.
            (A.needs || []).forEach(n => {
                if (!want.includes(n.pos) || filled.has(n.pos)) return;
                const best = fas.filter(pid => h.ppos(pid) === n.pos).sort((x, y) => h.value(y) - h.value(x))[0];
                const why = n.pos + ' is ' + (n.urgency === 'deficit' ? 'a deficit' : n.urgency) + ' for you, but no free agent would start there' + (adds.some(x => x.player.pos === n.pos) ? ' (any ' + n.pos + ' above is a stash, not a fix)' : '') + ': trade for a starter (find_trade_partners).';
                const added = best && adds.some(x => x.player.name === h.pname(best));
                const seen = best && !added ? do_not_add.find(d => d.player === h.pname(best)) : null;
                const who = best && !added ? h.pname(best) + ' (best free-agent ' + n.pos + ', value ' + h.value(best) + ')' : 'a waiver claim as your ' + n.pos + ' fix';
                if (seen) { seen.player = who; seen.why = why; }
                else do_not_add.push({ player: who, why });
            });
            const ownedCuffs = cuffs.filter(c => c.owner !== 'free agent' && c.owner !== 'me');
            const rank = fa ? h.rosters().map(r => leftOf(lg, r)).sort((x, y) => y - x).indexOf(left) + 1 : null;
            const faab = fa ? noUndef({
                left, budget: fa.budget, min_bid: minBid,
                rank: rank ? rank + ' of ' + h.rosters().length + ' teams' : undefined,
                weeks_left: weeksLeft || undefined,
                per_week: weeksLeft ? Math.round(left / weeksLeft) : undefined,
                max_single_bid: cap,
                pace: weeksLeft ? '$' + left + ' over ' + weeksLeft + ' regular-season week' + (weeksLeft > 1 ? 's' : '') + ' (through week ' + lastReg + ') is about $' + Math.round(left / weeksLeft) + ' a week; no single claim above $' + cap + ' unless he changes your lineup for the title run. Unspent FAAB is worth nothing after the season.' : 'Playoff start week not set; no single claim above $' + cap + '.',
            }) : undefined;
            const first = adds[0];
            const recommendation = first
                ? 'Claim ' + first.player.name + (first.bid && first.bid.open != null ? ' (open $' + first.bid.open + ', max $' + first.bid.max + ')' : '') + (first.drop.player ? ' and drop ' + first.drop.player + '.' : ' into your open spot.')
                : 'Hold: nobody on the wire' + (a.position ? ' at ' + want.join('/') : '') + ' is an upgrade on a player you can safely drop.';
            const evidence = [
                'Active roster ' + counts.active + '/' + (counts.max != null ? counts.max : '?') + ' (taxi ' + counts.taxi + ', IR ' + counts.ir + ' not counted).',
                'Needs: ' + ((A.needs || []).map(n => n.pos + ' ' + n.urgency).join(', ') || 'none') + (A.window ? '; window ' + A.window : '') + '.',
                'League starts: ' + startable.join(', ') + '.',
            ];
            if (faabOn) {
                const bs = bidStats(ins.txns);
                evidence.push(bs.count ? 'In-season bids since ' + ins.start + ': ' + bs.count + ' (median $' + bs.p50 + ', p75 $' + bs.p75 + ', p90 $' + bs.p90 + '); ' + ins.excluded + ' offseason claims left out.' : 'No in-season bids yet; ' + ins.excluded + ' offseason claims left out.');
            }
            ownedCuffs.forEach(c => evidence.push(h.pname(c.starter) + '\'s backup ' + h.pname(c.backup) + ' is on ' + c.owner + ': a trade, not a claim.'));
            cuffs.filter(c => c.owner === 'me').forEach(c => evidence.push(h.pname(c.starter) + '\'s backup ' + h.pname(c.backup) + ' is already yours.'));
            return noUndef({
                decision: first ? 'add' : 'hold',
                confidence: !faabOn ? (fa ? 'low' : 'medium') : coldStarts.length ? 'medium' : 'high',
                recommendation,
                adds,
                faab,
                do_not_add: do_not_add.length ? do_not_add : undefined,
                evidence,
                rules_applied: [
                    'Only positions this league can start.',
                    'Every add is paired with a drop from the active roster (never taxi or IR), unless an active spot is open.',
                    'Drops come from the one roster drop list: no NFL team first, then lowest keep score; starters, handcuffs to your starters, young risers, injured stashes and engine-gap 0s are never drops.',
                    'An add must beat its drop by ' + ADD_MARGIN + ' keep points (need-weighted' + (contending ? ', +' + CUFF_BONUS + ' for a handcuff while contending' : '') + ').',
                    'Bid history is in-season only (offseason claims excluded).',
                    'Max bid never above the pace cap (FAAB left x 1.5 / weeks left, between 15% and 65%)' + (pct > 0 ? ' or your ' + pct + '% limit' : '') + '.',
                ],
                method: PLAN_METHOD,
            });
        },
    });

    // ── get_news ───────────────────────────────────────────────────
    const SKILL = ['QB', 'RB', 'WR', 'TE'];
    AT.register({
        name: 'get_news',
        description: 'Recent NFL news (last 14 days, newest first) linked to the given players, or to an NFL team\'s skill players: injuries, practice reports, role and depth-chart changes, coaching and QB situations, moves.',
        parameters: { type: 'object', properties: { players: { type: 'array', items: { type: 'string' }, description: 'Player names or ids.' }, nfl_team: { type: 'string', description: 'NFL team abbreviation (e.g. DEN) for that team\'s news.' } } },
        async run(a) {
            const PN = App.PlayerNews;
            if (!PN || !PN.get) throw new Error('News is not available on this page.');
            const ask = Array.isArray(a.players) ? a.players : a.players ? String(a.players).split(',') : [];
            const team = (a.nfl_team || a.team) ? String(a.nfl_team || a.team).toUpperCase().trim() : null;
            if (!ask.length && !team) throw new Error('Name players or an NFL team.');
            const pids = [];
            const missing = [];
            ask.slice(0, 12).forEach(q => { const f = h.findPlayer(String(q).trim()); if (f) pids.push(f.pid); else missing.push(q); });
            if (team) {
                const players = S().players || {};
                const teamIds = Object.keys(players).filter(pid => { const p = players[pid]; return p && String(p.team || '').toUpperCase() === team && p.active !== false && SKILL.includes(h.ppos(pid)); })
                    .sort((x, y) => h.value(y) - h.value(x) || (Number(h.pl(x).depth_chart_order) || 9) - (Number(h.pl(y).depth_chart_order) || 9)).slice(0, 25);
                if (!teamIds.length && !pids.length) throw new Error('No skill players found for ' + team + '.');
                teamIds.forEach(pid => pids.push(pid));
            }
            const ids = [...new Set(pids.map(pid2))];
            if (!ids.length) throw new Error('No player matches ' + missing.join(', ') + '.');
            const map = await newsMap(ids);
            if (!map) throw new Error('News could not be loaded right now.');
            const cutoff = Date.now() - 14 * DAY;
            const seen = new Map();
            ids.forEach(pid => (map[pid] || []).forEach(it => {
                const t = Date.parse(it.published_at);
                if (!isNaN(t) && t < cutoff) return;
                const k = it.url || it.headline;
                if (seen.has(k)) { const prev = seen.get(k); if (!prev.players.includes(h.pname(pid))) prev.players.push(h.pname(pid)); return; }
                seen.set(k, { t: isNaN(t) ? 0 : t, it, players: [h.pname(pid)] });
            }));
            const items = [...seen.values()].sort((x, y) => y.t - x.t).slice(0, 25).map(x => {
                const n = newsItem(x.it);
                n.players = x.players.slice(0, 5);
                return n;
            });
            return noUndef({ for: team ? team + (ask.length ? ' + named players' : '') : ids.map(h.pname).join(', '), days: 14, items, note: items.length ? undefined : 'No linked news in the last 14 days.', not_found: missing.length ? missing : undefined });
        },
    });

    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = { ranks, seasonLog, card };
})(typeof window !== 'undefined' ? window : globalThis);
