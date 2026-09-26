// ══════════════════════════════════════════════════════════════════
// js/shared/matchup-inputs.js — window.App.MatchupInputs
//
// Turns what the app already knows about a player into the input the
// matchup engine scores. One place decides where every factor's data
// comes from:
//
//   baseline     Sleeper's published line scored through the league's
//                rules (App.WeeklyProj), or the engine's own estimate.
//   role         ESPN depth-chart rank at his position (the app's
//                nfl-depth-charts relay, Sleeper's field as backup), his
//                projected share of the team's ball (targets, touches,
//                attempts or tackles) from Sleeper stats with injured
//                teammates' share handed out, and snap share.
//   health       Sleeper injury tag, PFF depth-chart status as backup.
//   opponent     App.SOS defense-vs-position rank for offense; a new
//                offense-vs-IDP rank (built here from Sleeper's weekly
//                pts_idp) for DL / LB / DB.
//   game         ESPN scoreboard context already loaded by nfl-context
//                (implied total, spread, home, weather) plus the ESPN
//                schedule for neutral-site and overseas games.
//   coaching     ESPN staff scores (matchup-feeds-espn).
//   h2h          ESPN last six meetings (matchup-feeds-espn).
//   trench       PFF team unit grades: my line vs their front, from the
//                player's side of the ball.
//   trend        Last three weeks vs season PPG (App.WeeklyProj).
//   cast         the QB who will actually start (or, for a QB, his weapons),
//                from the depth chart, Sleeper injury tags and PFF grades.
//   luck         Season touchdown rate vs a sustainable rate (Sleeper).
//
// Async work (ESPN, the IDP rank) happens once in prepare(); build() is
// then synchronous so a render can call it per row without awaiting.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const IDP_GROUP = { DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', IDL: 'DL', EDGE: 'DL', LB: 'LB', OLB: 'LB', ILB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DB: 'DB' };
    const PFF_POS_GROUP = { QB: 'QB', HB: 'RB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', DI: 'DL', ED: 'DL', DL: 'DL', DE: 'DL', DT: 'DL', LB: 'LB', CB: 'DB', S: 'DB', K: 'K' };
    const SLEEPER_STATUS = { QUESTIONABLE: 'Q', DOUBTFUL: 'D', OUT: 'OUT', IR: 'IR', PUP: 'PUP', SUS: 'SUS', NA: 'NA', COV: 'COV', DNR: 'OUT' };
    const PFF_STATUS = { questionable: 'Q', doubtful: 'D', out: 'OUT', ir: 'IR', pup: 'PUP', suspended: 'SUS' };
    // Touchdowns per opportunity that a season tends to settle back to.
    const EXPECTED_TD_RATE = { RB: 0.03, WR: 0.04, TE: 0.045, QB: 0.045 };
    const TTL_MS = 4 * 60 * 60 * 1000;
    const RECENT_WEEKS = 3;
    // What "the ball" means per position, and the stat that counts it.
    const BALL_BASIS = { QB: 'attempts', RB: 'touches', WR: 'targets', TE: 'targets', DL: 'tackles', LB: 'tackles', DB: 'tackles' };
    // Share of the team's ball a depth-chart slot normally earns (league
    // norms from the prior season). Used to steady a thin sample and to
    // give a promoted player credit before his stats catch up.
    // Calibrated from the 2025 season (league medians, share of the TEAM's
    // ball: targets for WR/TE, carries+targets for RB, attempts for QB,
    // tackles for defenders). Defensive ranks are per depth-chart slot, so
    // "1" is the typical starter at one of several slots.
    // Rank 4 and below (owner ruling 2026-09-21): a WR7 was projected like a
    // WR4, and 63 receivers who saw no targets were carrying 1-3 apiece.
    const BASE_SHARE = { QB: [0.90, 0.10], RB: [0.29, 0.13, 0.04, 0.01, 0.005], WR: [0.23, 0.15, 0.10, 0.03, 0.015], TE: [0.15, 0.05, 0.02, 0.005], DL: [0.045, 0.02, 0.01], LB: [0.10, 0.04, 0.02], DB: [0.075, 0.03, 0.015] };
    // What a whole position room gets of the team's ball (2025 medians).
    // A team's projected shares at a position are scaled down to this cap,
    // so four backs can never add up to more than a backfield.
    const ROOM_SHARE = { QB: 1.0, RB: 0.46, WR: 0.60, TE: 0.24, DL: 0.25, LB: 0.32, DB: 0.43 };
    const SLEEPER_DEPTH_POS = { QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', LWR: 'WR', SWR: 'WR', RWR: 'WR', TE: 'TE', K: 'K',
        LDE: 'DL', RDE: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', LDT: 'DL', RDT: 'DL', DL: 'DL',
        LILB: 'LB', RILB: 'LB', LOLB: 'LB', ROLB: 'LB', MLB: 'LB', ILB: 'LB', OLB: 'LB', LB: 'LB', WLB: 'LB', SLB: 'LB',
        LCB: 'DB', RCB: 'DB', CB: 'DB', NB: 'DB', FS: 'DB', SS: 'DB', S: 'DB', DB: 'DB' };
    const OUT_FOR_SHARE = { OUT: 1, IR: 1, PUP: 1, SUS: 1, NA: 1, COV: 1, D: 0.8 };

    const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const normName = (name) => String(name || '').toLowerCase().replace(/[.'’]/g, '').replace(/\s+(jr|sr|ii|iii|iv)$/i, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

    function posGroup(player) {
        const raw = String(player && player.position || '').toUpperCase();
        if (IDP_GROUP[raw]) return IDP_GROUP[raw];
        const n = App.normPos ? App.normPos(raw) : raw;
        return String(n || raw).toUpperCase();
    }
    function fullName(player) {
        return player ? (player.full_name || ((player.first_name || '') + ' ' + (player.last_name || ''))).trim() : '';
    }
    function pff() { return root.DhqPffMatchup || null; }
    function functionsBase() {
        try {
            const cfg = root.DYNASTY_HQ_CONFIG || (App.CONFIG) || (root.OD && root.OD.CONFIG) || {};
            return String(cfg.functionsBase || 'https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1').replace(/\/+$/, '');
        } catch (e) { return 'https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1'; }
    }
    // Same normalizer the nfl-depth-charts relay keys its roles with.
    const espnName = (name) => String(name || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    // Sleeper's injury tag → engine status code.
    function statusOf(player) {
        const raw = String(player && player.injury_status || '').toUpperCase();
        return SLEEPER_STATUS[raw] || raw;
    }
    function espn() { return App.MatchupFeeds && App.MatchupFeeds.espn; }

    function currentSeason() {
        const s = root.S || {};
        return Number(s.season || (s.nflState && s.nflState.season)) || (App.MatchupFeeds && espn() ? espn().currentSeason() : new Date().getUTCFullYear());
    }

    // ── Opponent for a team in a week ─────────────────────────────────
    function opponentOf(team, week) {
        const T = String(team || '').toUpperCase();
        const ctx = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek[T + '|' + week];
        if (ctx && ctx.opp) return String(ctx.opp).toUpperCase();
        const sch = App.SOS && App.SOS.schedule;
        return (sch && sch[week] && sch[week][T]) ? String(sch[week][T]).toUpperCase() : null;
    }
    function isByeWeek(team, week) {
        const T = String(team || '').toUpperCase();
        // The ESPN scoreboard knows the whole slate before kickoff: a team
        // with a game listed is not on bye; with a full slate loaded and no
        // game for this team, it is.
        const bt = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek;
        if (bt) {
            if (bt[T + '|' + week] && bt[T + '|' + week].opp) return false;
            const listed = Object.keys(bt).filter(k => k.slice(k.indexOf('|') + 1) === String(week)).length;
            if (listed >= 20) return true;
        }
        // The SOS schedule is built from games already played, so it can
        // only call a bye for a week that is over. The latest week it holds
        // may still be in progress (week 2 2026: the Rams and Giants read
        // as on bye all Monday before their game).
        const sch = App.SOS && App.SOS.schedule;
        if (!sch || !sch[week]) return false;
        const weeks = Object.keys(sch).map(Number).filter(w => Number.isFinite(w) && sch[w] && Object.keys(sch[w]).length >= 20);
        const latest = weeks.length ? Math.max.apply(null, weeks) : null;
        if (latest == null || Number(week) >= latest) return false;
        return Object.keys(sch[week]).length >= 20 && !sch[week][T];
    }

    // ── Offense vs IDP rank ───────────────────────────────────────────
    // How many IDP points each OFFENSE gives up to DL, LB and DB, from
    // Sleeper's weekly pts_idp. Rank 1 = stingiest offense (toughest for
    // that IDP group), 32 = most generous. Same pairing trick as the SOS
    // engine: the two TEAM_ rows whose yardage totals mirror each other
    // played each other.
    let _idp = { season: null, ranks: null, promise: null };
    function cacheKey(season) { return 'dhq_mi_idp_' + season; }
    async function fetchWeek(season, week) {
        if (App.SOS && App.SOS.getWeekStats) return App.SOS.getWeekStats(season, week);
        const r = await fetch('https://api.sleeper.app/v1/stats/nfl/regular/' + season + '/' + week);
        return r.ok ? r.json() : {};
    }
    function pairings(weekStats) {
        const rows = Object.entries(weekStats).filter(([k]) => k.startsWith('TEAM_')).map(([k, v]) => ({ t: k.slice(5), off: v.off_yd || 0, opp: v.opp_off_yd || 0 }));
        const out = {};
        for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
            const a = rows[i], b = rows[j];
            if (a.off > 0 && a.off === b.opp && b.off === a.opp) { out[a.t] = b.t; out[b.t] = a.t; }
        }
        return out;
    }
    async function idpRankings(season, playersData) {
        season = season || currentSeason();
        if (_idp.ranks && _idp.season === season) return _idp.ranks;
        try {
            const raw = root.sessionStorage && root.sessionStorage.getItem(cacheKey(season));
            if (raw) { const rec = JSON.parse(raw); if (Date.now() - rec.ts < TTL_MS) { _idp = { season, ranks: rec.data, promise: null }; return rec.data; } }
        } catch (e) { /* no storage */ }
        if (_idp.promise && _idp.season === season) return _idp.promise;
        _idp.season = season;
        _idp.promise = (async () => {
            const weeks = await Promise.all(Array.from({ length: 18 }, (_, i) => fetchWeek(season, i + 1).catch(() => ({}))));
            const allowed = {};   // offense → group → { pts, games }
            let played = 0;
            for (const wk of weeks) {
                if (!wk || Object.keys(wk).length < 10) continue;
                const pair = pairings(wk);
                if (!Object.keys(pair).length) continue;
                played++;
                for (const [pid, st] of Object.entries(wk)) {
                    if (pid.startsWith('TEAM_')) continue;
                    const pts = num(st.pts_idp);
                    if (!pts || pts <= 0) continue;
                    const p = playersData && playersData[pid];
                    const grp = p && IDP_GROUP[String(p.position || '').toUpperCase()];
                    if (!grp || !p.team) continue;
                    const offense = pair[String(p.team).toUpperCase()];
                    if (!offense) continue;
                    const a = allowed[offense] = allowed[offense] || {};
                    a[grp] = a[grp] || { pts: 0, games: new Set() };
                    a[grp].pts += pts;
                    a[grp].games.add(played);
                }
            }
            const ranks = {};
            for (const grp of ['DL', 'LB', 'DB']) {
                const list = Object.keys(allowed).filter(t => allowed[t][grp]).map(t => ({ t, avg: allowed[t][grp].pts / allowed[t][grp].games.size }));
                list.sort((a, b) => a.avg - b.avg);
                list.forEach((r, i) => { ranks[r.t] = ranks[r.t] || {}; ranks[r.t]['vs' + grp] = i + 1; ranks[r.t]['avg' + grp] = +r.avg.toFixed(1); });
            }
            const out = Object.keys(ranks).length ? ranks : null;
            _idp = { season, ranks: out, promise: null };
            try { if (out) root.sessionStorage && root.sessionStorage.setItem(cacheKey(season), JSON.stringify({ ts: Date.now(), data: out })); } catch (e) { /* ignore */ }
            return out;
        })();
        return _idp.promise;
    }

    // ── Last season's ranks, the same way, cached for a day ───────────
    // Defense vs QB/RB/WR/TE from pts_half_ppr and offense vs DL/LB/DB from
    // pts_idp, both from the prior season's weekly tables. Steadies the
    // matchup rank through the first month of a new season.
    let _prior = { season: null, ranks: null, promise: null };
    const OFF_GROUPS = ['QB', 'RB', 'WR', 'TE'];
    async function priorRankings(season, playersData) {
        if (_prior.ranks && _prior.season === season) return _prior.ranks;
        try {
            const raw = root.sessionStorage && root.sessionStorage.getItem('dhq_mi_prior_' + season);
            if (raw) { const rec = JSON.parse(raw); if (Date.now() - rec.ts < 24 * TTL_MS && rec.data) { _prior = { season, ranks: rec.data, promise: null }; return rec.data; } }
        } catch (e) { /* no storage */ }
        if (_prior.promise && _prior.season === season) return _prior.promise;
        _prior.season = season;
        _prior.promise = (async () => {
            const weeks = await Promise.all(Array.from({ length: 18 }, (_, i) => fetchWeek(season, i + 1).catch(() => ({}))));
            const allowed = {};   // defense/offense team → group → { pts, games }
            let played = 0;
            for (const wk of weeks) {
                if (!wk || Object.keys(wk).length < 10) continue;
                const pair = pairings(wk);
                if (!Object.keys(pair).length) continue;
                played++;
                for (const [pid, st] of Object.entries(wk)) {
                    if (pid.startsWith('TEAM_')) continue;
                    const p = playersData && playersData[pid];
                    if (!p || !p.team) continue;
                    const grp = posGroup(p);
                    const pts = IDP_GROUP[String(p.position || '').toUpperCase()] ? num(st.pts_idp) : (OFF_GROUPS.includes(grp) ? num(st.pts_half_ppr) : null);
                    if (!pts || pts <= 0) continue;
                    const other = pair[String(p.team).toUpperCase()];
                    if (!other) continue;
                    const a = allowed[other] = allowed[other] || {};
                    a[grp] = a[grp] || { pts: 0, games: new Set() };
                    a[grp].pts += pts;
                    a[grp].games.add(played);
                }
            }
            const ranks = {};
            for (const grp of ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB']) {
                const list = Object.keys(allowed).filter(t => allowed[t][grp]).map(t => ({ t, avg: allowed[t][grp].pts / allowed[t][grp].games.size }));
                list.sort((a, b) => a.avg - b.avg);
                list.forEach((r, i) => { ranks[r.t] = ranks[r.t] || {}; ranks[r.t]['vs' + grp] = i + 1; });
            }
            const out = Object.keys(ranks).length >= 30 ? ranks : null;
            _prior = { season, ranks: out, promise: null };
            try { if (out) root.sessionStorage && root.sessionStorage.setItem('dhq_mi_prior_' + season, JSON.stringify({ ts: Date.now(), data: out })); } catch (e) { /* ignore */ }
            return out;
        })();
        return _prior.promise;
    }

    // ── Opponent vs position: a blended 1..32 rank ────────────────────
    // Four views of how hard the opponent is on this position, blended by
    // how much of the season has been played, then ranked across the 32:
    //   points allowed this season  (App.SOS / the IDP rank)
    //   PFF unit grades for the position (film, not fantasy points)
    //   points allowed last season  (fades out by week eight)
    //   team quality: PFF overall grade, record, point differential
    const ORD = (n) => { const m = n % 100, d = n % 10; return n + ((m >= 11 && m <= 13) ? 'th' : d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'); };
    const tough01 = (rank) => rank != null ? (33 - rank) / 32 : null;   // rank 1 → 1
    // Percentile (0..1, 1 = best) of a value among a list of values.
    function pctRank(v, list) {
        if (v == null || !list.length) return null;
        let below = 0; for (const x of list) if (x < v) below++;
        return list.length > 1 ? below / (list.length - 1) : 0.5;
    }
    function pffUnitGrade(t, grp) {
        if (!t) return null;
        const g = (k) => num(t[k]);
        switch (grp) {
            case 'RB': return g('grades_run_defense') != null ? 0.7 * g('grades_run_defense') + 0.3 * (g('grades_tackle') != null ? g('grades_tackle') : g('grades_run_defense')) : null;
            case 'WR': case 'TE': return g('grades_coverage_defense');
            case 'QB': return g('grades_coverage_defense') != null && g('grades_pass_rush_defense') != null ? 0.6 * g('grades_coverage_defense') + 0.4 * g('grades_pass_rush_defense') : g('grades_defense');
            case 'DL': return g('grades_pass_block') != null && g('grades_run_block') != null ? 0.5 * g('grades_pass_block') + 0.5 * g('grades_run_block') : g('grades_offense');
            case 'LB': return g('grades_run_block') != null ? 0.6 * g('grades_run_block') + 0.4 * (g('grades_offense') || g('grades_run_block')) : g('grades_offense');
            case 'K': return g('grades_defense');
            case 'DB': return g('grades_pass') != null ? 0.6 * g('grades_pass') + 0.4 * (g('grades_pass_route') || g('grades_pass')) : g('grades_offense');
            default: return null;
        }
    }
    const UNIT_LABEL = { RB: 'run D', WR: 'coverage', TE: 'coverage', QB: 'pass D', DL: 'O-line', LB: 'run block', DB: 'passing', K: 'defense' };
    const PTS_LABEL = { RB: 'RBs', WR: 'WRs', TE: 'TEs', QB: 'QBs', DL: 'DL', LB: 'LBs', DB: 'DBs', K: 'Ks' };
    function currentRank(T, grp, ctx) {
        if (IDP_GROUP[grp] || grp === 'DL' || grp === 'LB' || grp === 'DB') return ctx.idp && ctx.idp[T] ? num(ctx.idp[T]['vs' + grp]) : null;
        const r = App.SOS && App.SOS.defenseRankings && App.SOS.defenseRankings[T];
        const v = r ? num(r['vs' + grp]) : null;
        return v != null && v >= 1 ? v : null;
    }
    // Record component of team quality: this season's record and point
    // differential, but early on that is one or two games, so last season's
    // record fills in and fades out by game eight.
    function record01(st) {
        if (!st) return null;
        const games = st.wins + st.losses + st.ties;
        if (!games) return null;
        const wp = num(st.winPct) != null ? num(st.winPct) : st.wins / games;
        const pd = num(st.pointDiff);
        return clamp(0.5 + (wp - 0.5) + (pd != null ? clamp(pd / (games * 14), -0.5, 0.5) * 0.5 : 0), 0, 1);
    }
    function teamQuality01(T, ctx, overallList) {
        const snap = pff();
        const t = snap && snap.teams ? snap.teams[T] : null;
        const pffPct = t ? pctRank(num(t.grades_overall), overallList) : null;
        const cur = record01(ctx.standings && ctx.standings[T]);
        const prior = record01(ctx.priorStandings && ctx.priorStandings[T]);
        const st = ctx.standings && ctx.standings[T];
        const games = st ? st.wins + st.losses + st.ties : 0;
        const late = clamp((games - 2) / 6, 0, 1);          // 0 through game two, 1 from game eight
        let rec = null;
        if (cur != null && prior != null) rec = late * cur + (1 - late) * prior;
        else if (cur != null) rec = 0.5 + (cur - 0.5) * Math.min(1, games / 6);
        else if (prior != null) rec = prior;
        if (pffPct == null && rec == null) return null;
        if (pffPct == null) return rec;
        if (rec == null) return pffPct;
        return 0.5 * pffPct + 0.5 * rec;
    }
    // Blended rank of `opp` against `grp`, plus the evidence string.
    function opponentFor(grp, opp, ctx, opts) {
        if (!opp || (!BALL_BASIS[grp] && grp !== 'K')) return null;
        ctx._opp = ctx._opp || {};
        if (ctx._opp[grp]) return ctx._opp[grp][opp] || null;
        const snap = pff();
        const teams = snap && snap.teams ? Object.keys(snap.teams) : Object.keys((App.SOS && App.SOS.defenseRankings) || {});
        if (teams.length < 20) return null;
        // Games played by the average team so far, from the standings.
        let gp = 0, n = 0;
        for (const T of teams) { const st = ctx.standings && ctx.standings[T]; if (st) { gp += st.wins + st.losses + st.ties; n++; } }
        gp = n ? gp / n : (ctx.week ? ctx.week - 1 : 0);
        const late = clamp((gp - 4) / 4, 0, 1);          // 0 through game four, 1 from game eight
        const W = { cur: 0.30 + 0.15 * late, pff: 0.30 + 0.15 * late, prior: 0.30 * (1 - late), quality: 0.10 };
        const unitList = teams.map(T => pffUnitGrade(snap && snap.teams ? snap.teams[T] : null, grp)).filter(v => v != null);
        const overallList = teams.map(T => snap && snap.teams && snap.teams[T] ? num(snap.teams[T].grades_overall) : null).filter(v => v != null);
        const rows = teams.map(T => {
            const parts = [];
            const cur = currentRank(T, grp, ctx);
            const unit = pffUnitGrade(snap && snap.teams ? snap.teams[T] : null, grp);
            const unitPct = pctRank(unit, unitList);
            const prior = ctx.prior && ctx.prior[T] ? num(ctx.prior[T]['vs' + grp]) : null;
            const quality = teamQuality01(T, ctx, overallList);
            if (cur != null) parts.push({ w: W.cur, v: tough01(cur) });
            if (unitPct != null) parts.push({ w: W.pff, v: unitPct });
            if (prior != null && W.prior > 0) parts.push({ w: W.prior, v: tough01(prior) });
            if (quality != null) parts.push({ w: W.quality, v: quality });
            const wsum = parts.reduce((a, b) => a + b.w, 0);
            return { T, tough: wsum ? parts.reduce((a, b) => a + b.w * b.v, 0) / wsum : null, cur, unit, unitPct, prior, quality };
        }).filter(r => r.tough != null);
        rows.sort((a, b) => b.tough - a.tough);
        const out = {};
        rows.forEach((r, i) => {
            const bits = [];
            if (r.cur != null) bits.push(ORD(r.cur) + ' in pts to ' + PTS_LABEL[grp]);
            if (r.unit != null) bits.push(UNIT_LABEL[grp] + ' ' + Math.round(r.unit) + ' (' + ORD(Math.round((1 - r.unitPct) * (unitList.length - 1)) + 1) + ')');
            if (r.prior != null && W.prior > 0) bits.push(ORD(r.prior) + ' last season');
            const st = ctx.standings && ctx.standings[r.T];
            const pst = ctx.priorStandings && ctx.priorStandings[r.T];
            if (st) bits.push(st.wins + '-' + st.losses + (st.ties ? '-' + st.ties : '') + (pst && (st.wins + st.losses + st.ties) < 8 ? ' (' + pst.wins + '-' + pst.losses + ' last yr)' : ''));
            if (r.quality != null && snap && snap.teams && snap.teams[r.T] && num(snap.teams[r.T].grades_overall) != null) bits.push('PFF team ' + ORD(Math.round((1 - pctRank(num(snap.teams[r.T].grades_overall), overallList)) * (overallList.length - 1)) + 1));
            out[r.T] = { rank: i + 1, detail: bits.join(' · ') };
        });
        ctx._opp[grp] = out;
        return out[opp] || null;
    }

    // ── PFF lookups ───────────────────────────────────────────────────
    function pffDepthRow(team, player) {
        const snap = pff();
        const rows = snap && snap.depth && snap.depth[String(team || '').toUpperCase()];
        if (!rows || !rows.length) return null;
        const want = normName(fullName(player));
        const grp = posGroup(player);
        let best = null;
        for (const r of rows) {
            if (normName(r.n) !== want) continue;
            if (PFF_POS_GROUP[String(r.pos).toUpperCase()] && PFF_POS_GROUP[String(r.pos).toUpperCase()] !== grp) continue;
            if (!best || (r.d != null && (best.d == null || r.d < best.d)) || (r.d === best.d && (r.sp || 0) > (best.sp || 0))) best = r;
        }
        return best;
    }
    function pffPlayer(player) {
        const snap = pff();
        return snap && snap.players ? snap.players[normName(fullName(player))] || null : null;
    }
    function pffTeam(team) {
        const snap = pff();
        return snap && snap.teams ? snap.teams[String(team || '').toUpperCase()] || null : null;
    }
    function teamQbGrade(team) {
        const snap = pff();
        const rows = snap && snap.depth && snap.depth[String(team || '').toUpperCase()];
        if (!rows) return null;
        const qb = rows.filter(r => String(r.pos).toUpperCase() === 'QB').sort((a, b) => (a.d || 9) - (b.d || 9) || (b.sp || 0) - (a.sp || 0))[0];
        if (!qb) return null;
        const p = snap.players[normName(qb.n)];
        return p ? (num(p.pass) || num(p.off) || null) : (num(qb.g) || null);
    }
    // My line vs their front, from the player's side of the ball, on a
    // league scale: each side's percentile among the 32 teams, and the
    // score is the gap between the two. A back who catches a lot has his
    // line judged partly on pass blocking and their front on pass rush.
    const TRENCH_KEYS = {
        RB: [['grades_run_block', 'run block'], ['grades_run_defense', 'run D']],
        QB: [['grades_pass_block', 'pass block'], ['grades_pass_rush_defense', 'pass rush']],
        WR: [['grades_pass_block', 'pass block'], ['grades_pass_rush_defense', 'pass rush']],
        TE: [['grades_pass_block', 'pass block'], ['grades_pass_rush_defense', 'pass rush']],
        DL: [['grades_pass_rush_defense', 'pass rush'], ['grades_pass_block', 'pass block']],
        LB: [['grades_run_defense', 'run D'], ['grades_run_block', 'run block']],
        DB: [['grades_coverage_defense', 'coverage'], ['grades_pass_route', 'receivers']],
    };
    function trenchFor(grp, team, opp, catchShare) {
        const snap = pff();
        const keys = TRENCH_KEYS[grp];
        if (!snap || !snap.teams || !keys) return null;
        const mineT = snap.teams[team], theirsT = snap.teams[opp];
        if (!mineT || !theirsT) return null;
        const c = grp === 'RB' ? clamp(num(catchShare) || 0, 0, 0.5) : 0;
        const mineOf = (t) => { const a = num(t[keys[0][0]]); if (a == null) return null; return c ? (1 - c) * a + c * (num(t.grades_pass_block) != null ? num(t.grades_pass_block) : a) : a; };
        const theirsOf = (t) => { const a = num(t[keys[1][0]]); if (a == null) return null; return c ? (1 - c) * a + c * (num(t.grades_pass_rush_defense) != null ? num(t.grades_pass_rush_defense) : a) : a; };
        const all = Object.values(snap.teams);
        const mineList = all.map(mineOf).filter(v => v != null);
        const theirsList = all.map(theirsOf).filter(v => v != null);
        const mine = mineOf(mineT), theirs = theirsOf(theirsT);
        if (mine == null || theirs == null) return null;
        const pm = pctRank(mine, mineList), pt = pctRank(theirs, theirsList);
        return {
            mine, theirs, score: clamp(pm - pt, -1, 1),
            mineRank: Math.round((1 - pm) * (mineList.length - 1)) + 1, theirsRank: Math.round((1 - pt) * (theirsList.length - 1)) + 1,
            mineLabel: team + ' ' + keys[0][1], theirsLabel: opp + ' ' + keys[1][1],
        };
    }

    // ── Baseline ──────────────────────────────────────────────────────
    // Sleeper's published line when there is one. Otherwise the engine's
    // own per-game estimate BEFORE any matchup adjustment, so this
    // engine's factors are not applied on top of the old ones.
    function baselineFor(pid, week, opts) {
        const WP = App.WeeklyProj;
        if (!WP) return null;
        const line = WP.projLine && WP.projLine(pid, week);
        if (line) {
            const scored = WP.projectPlayer(pid, { playersData: opts.playersData, statsData: opts.statsData, priorData: opts.priorData, scoring: opts.scoring, week, requireSleeper: true });
            if (scored && scored.points) return { median: scored.points.median, floor: scored.points.floor, ceiling: scored.points.ceiling, source: 'sleeper' };
        }
        if (opts.sleeperOnly) return null;
        const season = opts.statsData && opts.statsData[pid];
        const prior = opts.priorData && opts.priorData[pid];
        const base = WP.buildBaseline && WP.buildBaseline(pid, season, prior, opts.scoring, week);
        const pts = base && App.calcRawPts ? num(App.calcRawPts(base, opts.scoring)) : null;
        if (pts == null || pts <= 0) return null;
        return { median: +pts.toFixed(2), floor: +(pts * 0.75).toFixed(2), ceiling: +(pts * 1.25).toFixed(2), source: 'estimate' };
    }

    // ── ESPN depth charts through the app's relay ─────────────────────
    // { "TEAM|name": { pos, rank } } for every team, rebuilt server-side
    // every six hours. Cached here for four.
    let _depth = { roles: null, promise: null };
    async function depthCharts() {
        if (_depth.roles) return _depth.roles;
        try {
            const raw = root.sessionStorage && root.sessionStorage.getItem('dhq_mi_depth');
            if (raw) { const rec = JSON.parse(raw); if (Date.now() - rec.ts < TTL_MS && rec.data) { _depth.roles = rec.data; return rec.data; } }
        } catch (e) { /* no storage */ }
        if (_depth.promise) return _depth.promise;
        _depth.promise = (async () => {
            try {
                const r = await fetch(functionsBase() + '/nfl-depth-charts');
                const d = r.ok ? await r.json() : null;
                const roles = d && d.roles && Object.keys(d.roles).length > 100 ? d.roles : null;
                if (roles) { _depth.roles = roles; try { root.sessionStorage && root.sessionStorage.setItem('dhq_mi_depth', JSON.stringify({ ts: Date.now(), data: roles })); } catch (e) { /* ignore */ } }
                return roles;
            } catch (e) { return null; } finally { _depth.promise = null; }
        })();
        return _depth.promise;
    }
    // Depth-chart rank at the player's fantasy position: ESPN first, then
    // Sleeper's own field when it lists him at that position.
    function listedRank(player, grp, roles) {
        const team = String(player.team || '').toUpperCase();
        if (roles) {
            const r = roles[team + '|' + espnName(fullName(player))];
            if (r && r.pos === grp && num(r.rank) != null) return { rank: num(r.rank), source: 'espn' };
        }
        const sp = SLEEPER_DEPTH_POS[String(player.depth_chart_position || '').toUpperCase()];
        const so = num(player.depth_chart_order);
        if (sp === grp && so != null && so > 0 && so < 20) return { rank: so, source: 'sleeper' };
        return null;
    }
    // The listed rank with the fullback fixed: ESPN keeps a separate FB
    // slot that the depth-chart relay folds into "RB, rank 1", so every
    // fullback read as the starting back (week 2 2026: Juszczyk, Ingold,
    // Luepke, Bredeson projected 5-7 points, scored 0). Sleeper's own
    // position tag (FB) or its depth order (3rd or lower) says otherwise.
    function baseRank(player, grp, roles) {
        const lr = listedRank(player, grp, roles);
        if (!lr) return null;
        const out = { rank: lr.rank, source: lr.source, listed: lr.rank };
        if (grp === 'RB' && lr.source === 'espn') {
            const so = num(player.depth_chart_order);
            const sleeperRb = SLEEPER_DEPTH_POS[String(player.depth_chart_position || '').toUpperCase()] === 'RB';
            const isFb = String(player.position || '').toUpperCase() === 'FB';
            if (isFb || (lr.rank <= 1 && sleeperRb && so != null && so >= 3)) {
                out.rank = Math.max(4, so || 4);
                out.fullback = true;
            }
        }
        return out;
    }
    // Every teammate's base rank at one position, once per (team, group).
    function rankedMates(team, grp, ctx, opts) {
        ctx._ranked = ctx._ranked || {};
        const k = team + '|' + grp;
        if (ctx._ranked[k]) return ctx._ranked[k];
        const list = [];
        const players = (opts && opts.playersData) || {};
        for (const mid of Object.keys(players)) {
            const m = players[mid];
            if (!m || String(m.team || '').toUpperCase() !== team || posGroup(m) !== grp) continue;
            const br = baseRank(m, grp, ctx.depth);
            if (br) list.push({ pid: mid, rank: br.rank, name: fullName(m), outW: OUT_FOR_SHARE[statusOf(m)] || 0 });
        }
        list.sort((a, b) => a.rank - b.rank);
        ctx._ranked[k] = list;
        return list;
    }
    // Depth-chart rank at the player's fantasy position: ESPN first, then
    // Sleeper's own field; fullbacks corrected; then next man up: when the
    // men listed ahead of him are out (or doubtful) this week he moves up
    // one slot for each of them (week 2 2026: Darnold out, Drew Lock
    // stayed "QB2" at half the attempts and scored 21).
    function posRankFor(player, grp, roles, ctx, opts) {
        const br = baseRank(player, grp, roles);
        if (!br) return null;
        if (!ctx || !opts || !opts.playersData || br.rank <= 1 || BALL_BASIS[grp] === 'tackles') return br;
        const team = String(player.team || '').toUpperCase();
        const me = String(player.player_id || '');
        const myName = fullName(player);
        const ahead = rankedMates(team, grp, ctx, opts).filter(m => m.pid !== me && m.name !== myName && m.rank < br.rank && m.outW >= 0.8);
        if (!ahead.length) return br;
        br.rank = Math.max(1, br.rank - ahead.length);
        br.promotedPast = ahead.map(m => m.name);
        return br;
    }

    // ── Share of the ball ─────────────────────────────────────────────
    function ballOf(grp, st) {
        if (!st) return 0;
        switch (BALL_BASIS[grp]) {
            case 'attempts': return num(st.pass_att) || 0;
            case 'touches': return (num(st.rush_att) || 0) + (num(st.rec_tgt) || 0);
            case 'targets': return num(st.rec_tgt) || 0;
            case 'tackles': return num(st.idp_tkl) || 0;
            default: return 0;
        }
    }
    // Team totals for one stat table, computed once per (team, basis) and
    // kept on ctx. The season TEAM_ row carries attempts, carries and
    // targets; tackles and the weekly tables are summed from player rows.
    function teamBall(ctx, statsObj, key, team, grp, playersData) {
        const basis = BALL_BASIS[grp];
        if (!basis) return 0;
        ctx._tb = ctx._tb || {};
        const k = key + '|' + team + '|' + basis;
        if (ctx._tb[k] != null) return ctx._tb[k];
        let total = 0;
        const row = statsObj && statsObj['TEAM_' + team];
        if (row && basis !== 'tackles' && ballOf(grp, row) > 0) total = ballOf(grp, row);
        else if (statsObj && playersData) {
            for (const pid of Object.keys(statsObj)) {
                if (pid.startsWith('TEAM_')) continue;
                const p = playersData[pid];
                if (!p || String(p.team || '').toUpperCase() !== team) continue;
                if (basis === 'tackles' && !IDP_GROUP[String(p.position || '').toUpperCase()]) continue;
                total += ballOf(grp, statsObj[pid]);
            }
        }
        ctx._tb[k] = total;
        return total;
    }
    // A player's share of his team's ball on a per-game basis: his ball
    // per game he played over the team's ball per game it played (owner
    // ruling 2026-09-21: Adams had 114 targets in 14 games, 23.8% of the
    // Rams' 34 a game, not 19.6% of their 17-game total).
    function perGameShare(table, key, pid, team, grp, ctx, opts) {
        const st = table && table[pid];
        if (!st || !(num(st.gp) >= 1)) return null;
        const total = teamBall(ctx, table, key, team, grp, opts.playersData);
        if (!(total > 0)) return null;
        const row = table['TEAM_' + team];
        const tgp = row ? num(row.gp) : null;
        const mine = ballOf(grp, st) / num(st.gp);
        if (tgp > 0) return clamp(mine / (total / tgp), 0, 1);
        return clamp(ballOf(grp, st) / total, 0, 1);
    }
    // Earned share: season share leaning on the last three weeks.
    function earnedShare(pid, player, grp, team, opts, ctx) {
        const seasonShare = perGameShare(opts.statsData, 'season', pid, team, grp, ctx, opts);
        let mine = 0, theirs = 0;
        for (const wk of ctx.recentWeeks || []) {
            if (!wk || !wk.stats) continue;
            const t = teamBall(ctx, wk.stats, 'wk' + wk.week, team, grp, opts.playersData);
            if (t <= 0) continue;
            theirs += t;
            mine += ballOf(grp, wk.stats[pid]);
        }
        const recentShare = theirs > 0 ? mine / theirs : null;
        if (seasonShare == null && recentShare == null) return null;
        if (recentShare == null) return seasonShare;
        if (seasonShare == null) return recentShare;
        return 0.6 * recentShare + 0.4 * seasonShare;
    }
    // Team pie for the week: the team's per-game ball, tilted by the spread
    // (underdogs throw more, favorites hand off more).
    // League-average per-game volume the team pie is pulled toward until
    // the team has three games (K = 2 phantom games).
    const PIE_NORM = { attempts: 34, touches: 55, targets: 30, tackles: 58 };   // 2025 medians
    const PIE_PHANTOM = 4;   // games of last season's pace the current season is blended with
    function teamPie(team, grp, week, opts, ctx) {
        const row = opts.statsData && opts.statsData['TEAM_' + team];
        const gp = row ? (num(row.gp) || 0) : 0;
        const total = gp > 0 ? teamBall(ctx, opts.statsData, 'season', team, grp, opts.playersData) : 0;
        // Shrink toward the team's own per-game volume last season (the
        // Rams threw 34 targets a game, the league norm is 30); the league
        // norm only when the team has no last season on file. Before the
        // first game the pie is that prior alone (week 1 2026: an empty pie
        // was sending every player back to his own last season, and a QB
        // with no prior season read as OUT at zero).
        const priorRow = opts.priorData && opts.priorData['TEAM_' + team];
        const priorGp = priorRow ? num(priorRow.gp) : null;
        const priorTotal = priorGp > 0 ? teamBall(ctx, opts.priorData, 'prior', team, grp, opts.playersData) : 0;
        const norm = priorTotal > 0 ? priorTotal / priorGp : PIE_NORM[BALL_BASIS[grp]];
        if (!norm && !(gp > 0 && total > 0)) return null;
        // Last season counts as four phantom games (owner ruling 2026-09-22:
        // the Bills' 50-play shootout in week 1 was cutting Cook's touches 7%),
        // so one game is a fifth of the story, four games half, eight two thirds.
        let perGame = norm ? (total + PIE_PHANTOM * norm) / (gp + PIE_PHANTOM) : total / gp;
        const wk = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek[team + '|' + week];
        const spread = wk && wk.vegas ? num(wk.vegas.spread) : null; // positive = underdog
        if (spread != null) {
            const dog = clamp(spread / 14, -1, 1);
            perGame *= BALL_BASIS[grp] === 'touches' ? (1 - dog * 0.05) : BALL_BASIS[grp] === 'tackles' ? 1 : (1 + dog * 0.08);
        }
        return perGame;
    }
    // A team's raw projected shares at a position, summed over its healthy
    // players, so each one can be scaled to the room cap. Memoized.
    function roomScale(team, grp, opts, ctx) {
        ctx._room = ctx._room || {};
        const k = team + '|' + grp;
        if (ctx._room[k] != null) return ctx._room[k];
        ctx._room[k] = 1;   // guard against re-entry while summing
        const players = opts.playersData || {};
        let sum = 0;
        for (const mid of Object.keys(players)) {
            const m = players[mid];
            if (!m || String(m.team || '').toUpperCase() !== team || posGroup(m) !== grp) continue;
            if (OUT_FOR_SHARE[statusOf(m)]) continue;
            const raw = rawShareFor(mid, m, grp, team, opts, ctx);
            if (raw != null) sum += raw;
        }
        const cap = roomCap(team, grp, opts, ctx);
        ctx._room[k] = sum > cap ? cap / sum : 1;
        return ctx._room[k];
    }
    // The room cap: the league median blended half and half with what
    // this team's room took last season (the Rams' receivers took 64% of
    // the targets, the league median is 60%). Last season's room is summed
    // from the players on the roster now, so it is trusted only within
    // 20% of the median; a team that signed two WR1s would read too high.
    function roomCap(team, grp, opts, ctx) {
        const median = ROOM_SHARE[grp] || 1;
        ctx._roomCap = ctx._roomCap || {};
        const k = team + '|' + grp;
        if (ctx._roomCap[k] != null) return ctx._roomCap[k];
        const tn = teamSlotNorm(team, grp, 1, ctx, opts);
        if (tn && tn.room != null) { ctx._roomCap[k] = clamp(0.5 * median + 0.5 * tn.room, 0, 1); return ctx._roomCap[k]; }
        let cap = median;
        const players = opts.playersData || {};
        const priorRow = opts.priorData && opts.priorData['TEAM_' + team];
        const priorGp = priorRow ? num(priorRow.gp) : null;
        const priorTotal = priorGp > 0 ? teamBall(ctx, opts.priorData, 'prior', team, grp, players) : 0;
        if (priorTotal > 0) {
            let mine = 0;
            for (const mid of Object.keys(players)) {
                const m = players[mid];
                if (!m || String(m.team || '').toUpperCase() !== team || posGroup(m) !== grp) continue;
                const pr = opts.priorData[mid];
                if (pr && num(pr.gp) >= 4) mine += ballOf(grp, pr) / num(pr.gp);
            }
            if (mine > 0) cap = 0.5 * median + 0.5 * clamp(mine / (priorTotal / priorGp), 0.8 * median, 1.2 * median);
        }
        ctx._roomCap[k] = clamp(cap, 0, 1);
        return cap;
    }

    // Everything the engine's role factor reads.
    function roleFor(pid, player, grp, team, opts, ctx) {
        const stats = (opts.statsData && opts.statsData[pid]) || null;
        const out = { shareBasis: BALL_BASIS[grp] || null, gamesPlayed: stats ? num(stats.gp) : null };
        const pr = posRankFor(player, grp, ctx.depth, ctx, opts);
        if (pr) {
            out.posRank = pr.rank; out.posRankSource = pr.source;
            if (pr.listed != null && pr.listed !== pr.rank) out.listedRank = pr.listed;
            if (pr.promotedPast) out.promotedPast = pr.promotedPast;
            if (pr.fullback) out.fullback = true;
        }
        // Snap share, Sleeper first, PFF depth chart as backup.
        const depth = pffDepthRow(team, player);
        const snap = stats && num(stats.off_snp) && num(stats.tm_off_snp) ? clamp(stats.off_snp / stats.tm_off_snp, 0, 1)
            : stats && num(stats.def_snp) && num(stats.tm_def_snp) ? clamp(stats.def_snp / stats.tm_def_snp, 0, 1)
            : depth && num(depth.sp) != null ? depth.sp / 100 : null;
        if (snap != null) out.snapShare = snap;
        if (!BALL_BASIS[grp]) return out;

        const rawInfo = rawShareFor(pid, player, grp, team, opts, ctx, true) || {};
        if (rawInfo.shareRank != null) out.shareRank = rawInfo.shareRank;
        if (rawInfo.freedShare) out.freedShare = rawInfo.freedShare;
        if (rawInfo.trackShare != null) out.trackShare = rawInfo.trackShare;
        if (rawInfo.earnedShare != null) out.earnedShare = rawInfo.earnedShare;
        if (rawInfo.slotNorm != null) out.slotNorm = rawInfo.slotNorm;
        if (rawInfo.promoted) out.promoted = true;
        if (rawInfo.snapGate) out.snapGate = rawInfo.snapGate;
        if (rawInfo.slotNote) out.slotNote = rawInfo.slotNote;
        if (rawInfo.backupQb) out.backupQb = true;
        if (rawInfo.snapScale) out.snapScale = rawInfo.snapScale;
        const early = out.gamesPlayed == null || out.gamesPlayed < 3;
        let proj = rawInfo.share;
        if (proj != null) {
            out.rawShare = +proj.toFixed(3);
            // The starting quarterback is never scaled down by the room: a
            // backup's starts last year are no claim on this year's throws
            // (Daniels was cut to 69% of Washington's attempts by Mariota's
            // 2025 fill-in games).
            out.roomScale = grp === 'QB' && out.posRank === 1 ? 1 : +roomScale(team, grp, opts, ctx).toFixed(3);
            proj *= out.roomScale;
            out.share = clamp(proj, 0, 1);
            const pie = teamPie(team, grp, ctx.week, opts, ctx);
            if (pie != null) {
                out.projTargets = +(pie * out.share).toFixed(1);
                if (out.freedShare) {
                    const tgtPie = teamPie(team, 'WR', ctx.week, opts, ctx);
                    if (tgtPie != null) out.freedTargets = +(tgtPie * out.freedShare * (early ? 0.6 : 0.85)).toFixed(1);
                }
            }
            const line = App.WeeklyProj && App.WeeklyProj.projLine && App.WeeklyProj.projLine(pid, ctx.week);
            if (line) { const st = ballOf(grp, line); if (st > 0) out.sleeperTargets = +st.toFixed(1); }
        }
        return out;
    }

    // What he carried before this season: his own per-game share of the
    // ball from a real prior season (eight games or more). No preseason
    // projection (owner ruling 2026-09-21: that was Sleeper's opinion
    // leaking back into the math); a player with no prior season starts
    // from his depth-chart slot and earns from game one.
    function trackRecordShare(pid, grp, team, ctx, opts) {
        const pr = opts.priorData && opts.priorData[pid];
        if (!pr || (num(pr.gp) || 0) < 8) return null;
        return perGameShare(opts.priorData, 'prior', pid, team, grp, ctx, opts);
    }
    // ── Team slot norms (owner ruling 2026-09-21) ────────────────────
    // What THIS coaching staff gives its WR1..WR6, TE1..TE4 (targets) and
    // RB1..RB5 (carries plus targets), from the
    // usage snapshot (data/usage-snapshot.js: seasons under the current
    // head coach, receivers ranked by targets), blended with this season's
    // usage on a weight that picks up from week 3. A brand-new head coach
    // has no history here, so his team runs on this season alone, pulled
    // toward the league norm while the sample is tiny.
    function usage() { return root.DhqUsage || null; }
    function currentUsage(team, grp, ctx, opts) {
        ctx._cu = ctx._cu || {};
        const k = team + '|' + grp;
        if (ctx._cu[k] !== undefined) return ctx._cu[k];
        const players = opts.playersData || {}, stats = opts.statsData || {};
        const row = stats['TEAM_' + team];
        const teamTgt = row ? ballOf(grp, row) : 0, games = row ? (num(row.gp) || 0) : 0;
        let out = null;
        if (teamTgt > 0 && games > 0) {
            const list = [];
            let room = 0;
            for (const pid of Object.keys(stats)) {
                if (pid.startsWith('TEAM_')) continue;
                const m = players[pid];
                if (!m || String(m.team || '').toUpperCase() !== team || posGroup(m) !== grp) continue;
                if (grp === 'RB' && String(m.position || '').toUpperCase() === 'FB') continue;
                const t = ballOf(grp, stats[pid]);
                if (t > 0) { list.push(t); room += t; }
            }
            list.sort((a, b) => b - a);
            out = { games, share: list.map(t => t / teamTgt), room: room / teamTgt };
        }
        ctx._cu[k] = out;
        return out;
    }
    function teamSlotNorm(team, grp, rank, ctx, opts) {
        if (grp !== 'WR' && grp !== 'TE' && grp !== 'RB') return null;
        const U = usage();
        const t = U && U.teams && U.teams[team];
        const prior = t && t.prior && t.prior[grp] && t.prior[grp].seasons > 0 ? t.prior[grp] : null;
        const cur = currentUsage(team, grp, ctx, opts);
        const i = Math.max(1, Math.round(rank)) - 1;
        const league = BASE_SHARE[grp] ? BASE_SHARE[grp][Math.min(BASE_SHARE[grp].length, i + 1) - 1] : null;
        const gp = cur ? cur.games : 0;
        if (prior) {
            const p = i < prior.share.length && prior.share[i] != null ? prior.share[i] : (league != null ? Math.min(league, prior.share[prior.share.length - 1] || league) : null);
            if (p == null) return null;
            const wCur = gp <= 1 ? 0 : (gp - 1) / ((gp - 1) + 3);
            const c = cur && i < cur.share.length ? cur.share[i] : null;
            const norm = c != null ? (1 - wCur) * p + wCur * c : p;
            const who = t.hc && t.hc.name ? t.hc.name.split(' ').slice(-1)[0] : 'this staff';
            return { norm, room: cur && cur.room != null && wCur > 0 ? (1 - wCur) * (prior.room != null ? prior.room : cur.room) + wCur * cur.room : prior.room, source: 'under ' + who + ', ' + prior.seasons + ' season' + (prior.seasons > 1 ? 's' : '') + (wCur > 0 ? ' + this year' : '') };
        }
        if (t && t.hc && cur && league != null) {
            const wCur = gp / (gp + 1);
            const c = i < cur.share.length ? cur.share[i] : 0;
            const who = t.hc.name ? t.hc.name.split(' ').slice(-1)[0] : 'new staff';
            return { norm: wCur * c + (1 - wCur) * league, room: wCur * cur.room + (1 - wCur) * (ROOM_SHARE[grp] || 1), source: 'new staff (' + who + '), this season only' };
        }
        return null;
    }
    // His snap share in his team's most recent game (0 when the team
    // played and he has no row, so a healthy scratch reads as 0).
    function lastGameSnap(pid, team, ctx, opts, side) {
        const weeks = (ctx.recentWeeks || []).filter(w => w && w.stats).sort((a, b) => b.week - a.week);
        const players = opts.playersData || {};
        for (const wk of weeks) {
            let teamPlayed = !!wk.stats['TEAM_' + team];
            if (!teamPlayed) for (const mid of Object.keys(wk.stats)) { const m = players[mid]; if (m && String(m.team || '').toUpperCase() === team && num(wk.stats[mid].gp) >= 1) { teamPlayed = true; break; } }
            if (!teamPlayed) continue;
            const st = wk.stats[pid];
            if (!st || !(num(st.gp) >= 1)) return 0;
            const mine = num(side === 'def' ? st.def_snp : st.off_snp), all = num(side === 'def' ? st.tm_def_snp : st.tm_off_snp);
            return all > 0 ? clamp((mine || 0) / all, 0, 1) : null;
        }
        return null;
    }
    // The raw projected share of the team's ball for one player: earned
    // share (season, recent) with freed targets, blended with his
    // depth-chart norm. Memoized per player; `full` also returns the
    // details the role note shows.
    function rawShareFor(pid, player, grp, team, opts, ctx, full) {
        ctx._rawShare = ctx._rawShare || {};
        if (ctx._rawShare[pid]) return full ? ctx._rawShare[pid] : ctx._rawShare[pid].share;
        const stats = (opts.statsData && opts.statsData[pid]) || null;
        const out = {};
        const pr = posRankFor(player, grp, ctx.depth, ctx, opts);
        const posRank = pr ? pr.rank : null;
        const promoted = !!(pr && pr.promotedPast);
        const gamesPlayed = stats ? num(stats.gp) : null;

        let earned = earnedShare(pid, player, grp, team, opts, ctx);
        // Rank on his team by earned season share, and the share freed up by
        // teammates at his position who are out this week.
        if (opts.playersData && opts.statsData) {
            const seasonTotal = teamBall(ctx, opts.statsData, 'season', team, grp, opts.playersData);
            // Teammates at this position with a season share, once per (team, group).
            ctx._mates = ctx._mates || {};
            const mk = team + '|' + grp;
            if (!ctx._mates[mk]) {
                const list = [];
                for (const mid of Object.keys(opts.statsData)) {
                    if (mid.startsWith('TEAM_')) continue;
                    const m = opts.playersData[mid];
                    if (!m || String(m.team || '').toUpperCase() !== team || posGroup(m) !== grp) continue;
                    const sh = seasonTotal > 0 ? ballOf(grp, opts.statsData[mid]) / seasonTotal : 0;
                    if (sh > 0) list.push({ pid: mid, share: sh, outW: OUT_FOR_SHARE[statusOf(m)] || 0 });
                }
                list.sort((a, b) => b.share - a.share);
                ctx._mates[mk] = list;
            }
            const mates = ctx._mates[mk];
            const idx = mates.findIndex(m => m.pid === pid);
            if (idx >= 0) out.shareRank = idx + 1;
            if (grp === 'WR' || grp === 'TE' || grp === 'RB') {
                // pass catchers: freed targets flow across WR, TE and RB
                const extra = OUT_FOR_SHARE[statusOf(player)] ? 0 : freedTargetShare(pid, team, ctx, opts);
                if (extra > 0) {
                    out.freedShare = +extra.toFixed(3);
                    if (grp === 'RB') {
                        // his share is of touches; convert extra targets into touches
                        const tgtTotal = teamBall(ctx, opts.statsData, 'season', team, 'WR', opts.playersData);
                        const touchTotal = teamBall(ctx, opts.statsData, 'season', team, 'RB', opts.playersData);
                        if (tgtTotal > 0 && touchTotal > 0 && earned != null) earned += extra * tgtTotal / touchTotal;
                    } else if (earned != null) earned += extra;
                    else earned = extra;
                }
            } else {
                // quarterbacks and defenders: freed share stays inside the position
                let freed = 0, healthySum = 0;
                for (const m of mates) { if (m.pid !== pid && m.outW) freed += m.share * m.outW; else healthySum += m.share; }
                if (earned != null && freed > 0 && healthySum > 0 && !OUT_FOR_SHARE[statusOf(player)]) earned = earned * (1 + freed / healthySum);
            }
        }
        // Blend with what his depth-chart slot normally earns. The earned
        // share gets more say with every game: 45% after one game, 60% after
        // two, 85% from three on (owner ruling 2026-09-21: one big week one
        // was becoming a big projection, +1.3 points of bias, worst at RB).
        const leagueAt = (rk) => rk != null && BASE_SHARE[grp] ? BASE_SHARE[grp][Math.min(BASE_SHARE[grp].length, Math.max(1, Math.round(rk))) - 1] : null;
        const normAt = (rk) => { if (rk == null) return null; const tn = teamSlotNorm(team, grp, rk, ctx, opts); return tn ? tn.norm : leagueAt(rk); };
        let slotNorm = normAt(posRank);
        const tnInfo = posRank != null ? teamSlotNorm(team, grp, posRank, ctx, opts) : null;
        if (tnInfo) out.slotNote = grp + Math.round(posRank) + ' slot ' + Math.round(tnInfo.norm * 100) + '% ' + tnInfo.source;
        // A man promoted by an injury only as far as rank 3 takes the
        // midpoint of his old slot and the new one, not the full new share.
        if (promoted && posRank >= 3 && pr.listed != null && normAt(pr.listed) != null) slotNorm = (slotNorm + normAt(pr.listed)) / 2;
        // WR4 and below (owner ruling 2026-09-21): they get the slot's share,
        // period. It does not matter who the player is or what he did last
        // year somewhere else; he rarely sees the field unless the WR3 goes
        // down in the game.
        const deepBench = grp === 'WR' && posRank != null && posRank >= 4;
        // The slot norm is a league-average starter. A player with a track
        // record (last season, or a preseason projection) starts from his
        // own share instead, 70/30 with the norm (week 2 2026: Chase,
        // Lamb, McCaffrey were pulled to "average WR1/RB1" after one quiet
        // game and ran 2.4 points low). A promoted player's record was
        // earned as a backup, so he takes the slot norm as is.
        const track = promoted || deepBench || BALL_BASIS[grp] === 'tackles' ? null : trackRecordShare(pid, grp, team, ctx, opts);
        let base = slotNorm;
        if (track != null) base = slotNorm != null ? 0.7 * track + 0.3 * slotNorm : track;
        if (track != null) out.trackShare = +track.toFixed(3);
        if (earned != null) out.earnedShare = +earned.toFixed(3);
        if (slotNorm != null) out.slotNorm = slotNorm;
        const gp = gamesPlayed == null ? 0 : gamesPlayed;
        let wEarned = gp >= 3 ? 0.85 : gp === 2 ? 0.6 : gp === 1 ? 0.45 : 0.3;
        // With a track record behind him, his first games count games/(games+2):
        // one game is a third of the story, three games are three fifths, and
        // by game six his own season carries three quarters.
        if (track != null && gp < 6) wEarned = Math.min(wEarned, gp / (gp + 2));
        if (promoted) { wEarned = Math.min(wEarned, 0.15); out.promoted = true; }
        let proj = null;
        if (earned != null && base != null) proj = wEarned * earned + (1 - wEarned) * base;
        else if (earned != null) proj = earned;
        else if (base != null) proj = base;
        // Defenders' volume follows their snaps (owner review 2026-09-22): a
        // defender's tackles scale with the snaps he plays, and the depth
        // chart alone was giving part-timers 1.6 points (they scored 0.1)
        // and full-timers 4.4 (they scored 5.2). His last game's snap share
        // against a 60% full-time norm, between 0.15 and 1.15; the season's
        // snap share stands in before his first game. Two weeks simulated:
        // defenders 486-561 to 549-498 vs Sleeper, miss 1.73 to 1.59.
        if (proj != null && BALL_BASIS[grp] === 'tackles') {
            let sn = lastGameSnap(pid, team, ctx, opts, 'def');
            if (sn == null) { const st0 = opts.statsData && opts.statsData[pid]; const pr0 = opts.priorData && opts.priorData[pid]; const src = st0 && num(st0.tm_def_snp) > 0 ? st0 : (pr0 && num(pr0.tm_def_snp) > 0 ? pr0 : null); if (src) sn = clamp((num(src.def_snp) || 0) / num(src.tm_def_snp), 0, 1); }
            if (sn != null) { const f = clamp(sn / 0.6, 0.15, 1.15); proj *= f; out.snapScale = { snap: +sn.toFixed(3), factor: +f.toFixed(2) }; }
        }
        // Backup quarterbacks (owner ruling 2026-09-21): a QB who is not the
        // starter gets zero, whatever he did last year (Rattler's 2025 starts
        // were projecting him for 9 points as the Saints' QB2). Next man up
        // still makes him the starter when the man ahead is out.
        if (proj != null && grp === 'QB' && posRank != null && posRank >= 2) { proj = 0; out.backupQb = true; }
        // Snap gate (owner ruling 2026-09-21): a back, receiver or tight end
        // listed third or lower who played under 15% of the snaps in his
        // team's last game is trimmed toward that snap share (never below
        // 30% of his projection). A player who moved up is not gated: next
        // man up exempts him, a rank of 1 or 2 is never gated, and the gate
        // reads his most recent game, so real snaps last week lift it. A
        // promotion only to rank 3 or lower (WR4 to WR3) is still gated.
        if (proj != null && (grp === 'WR' || grp === 'TE' || grp === 'RB') && posRank != null && posRank >= 3 && !(promoted && posRank <= 2)) {
            const ls = lastGameSnap(pid, team, ctx, opts);
            if (ls != null && ls < 0.15) { const f = Math.max(0.3, ls / 0.15); proj *= f; out.snapGate = { snap: +ls.toFixed(3), factor: +f.toFixed(2) }; }
        }
        out.share = proj != null ? clamp(proj, 0, 1) : null;
        ctx._rawShare[pid] = out;
        return full ? out : out.share;
    }

    // ── DHQ's own baseline ────────────────────────────────────────────
    // Volume from the role projection (targets, touches, attempts,
    // tackles), efficiency pooled from the last three weeks (counted
    // double), this season and last season, PFF grades as the quality
    // prior. Returns { median, floor, ceiling, why } in league points.
    function dhqBaselineFor(pid, player, grp, role, opts, ctx) {
        const DB = App.DhqBaseline;
        if (!DB) return null;
        const stats = (opts.statsData && opts.statsData[pid]) || null;
        const prior = (opts.priorData && opts.priorData[pid]) || null;
        // Recent weeks count double only once the season has three games;
        // before that the season table IS those weeks, and doubling them
        // stacked one game three times against the position norm. Last
        // season counts in full until then.
        const samples = [];
        const gpNow = stats ? (num(stats.gp) || 0) : 0;
        const recentW = gpNow >= 3 ? 2 : 1;
        const priorW = gpNow >= 3 ? 0.5 : 1;
        for (const wk of ctx.recentWeeks || []) if (wk && wk.stats && wk.stats[pid] && num(wk.stats[pid].gp) >= 1) samples.push({ line: wk.stats[pid], weight: recentW });
        if (stats && gpNow >= 1) samples.push({ line: stats, weight: 1 });
        if (prior && num(prior.gp) >= 1) samples.push({ line: prior, weight: priorW });
        let volume = role && num(role.projTargets) != null ? role.projTargets : null;
        if (volume == null && grp !== 'K') {
            // No role projection: fall back to his own per-game volume.
            const src = stats && num(stats.gp) >= 1 ? stats : (prior && num(prior.gp) >= 1 ? prior : null);
            if (src) volume = ballOf(grp, src) / num(src.gp);
        }
        if (volume == null && grp !== 'K') return null;
        if (grp === 'K' && !samples.length) return null;
        if (role && role.backupQb) return { median: 0, floor: 0, ceiling: 0, why: 'backup quarterback, projected zero unless the starter is out', line: {} };
        const pf = pffPlayer(player) || {};
        const built = DB.buildLine({ position: grp, volume, samples, rank: role && num(role.posRank) != null ? role.posRank : null, grades: { route: pf.route, run: pf.run, pass: pf.pass, off: pf.off, prush: pf.prush, cov: pf.cov, tkl: pf.tkl, fg: pf.fg } });
        if (!built) return null;   // no DHQ line for this position (team defense): the caller falls back
        if (grp === 'K') {
            // A kicker's attempts follow his team's scoring (owner ruling
            // 2026-09-21). From the 2025 team rows: touchdowns (extra-point
            // tries) per game = -0.6 + 0.137 x points per game (R2 0.93),
            // while field-goal attempts sit near 2.0 whatever the team
            // scores (1.70 + 0.013 x ppg, R2 0.02). Expected points are the
            // Vegas implied total before kickoff, else the team's points per
            // game this season shrunk toward last season's. His own rates
            // keep a say: half on field goals, a fifth on extra points.
            const wk = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek[String(player.team || '').toUpperCase() + '|' + ctx.week];
            const implied = wk && wk.vegas ? num(wk.vegas.impliedTotal) : null;
            const T = String(player.team || '').toUpperCase();
            const ppg = (row) => { if (!row || !(num(row.gp) >= 1)) return null; const two = (num(row.pass_2pt) || 0) + (num(row.rush_2pt) || 0); const td = num(row.td) || 0; return (6 * td + 3 * (num(row.fgm) || 0) + (td - two) * 0.96 + 2 * two) / num(row.gp); };
            const cur = opts.statsData && opts.statsData['TEAM_' + T], pri = opts.priorData && opts.priorData['TEAM_' + T];
            const curPpg = ppg(cur), priPpg = ppg(pri) != null ? ppg(pri) : 22.5, curGp = cur ? (num(cur.gp) || 0) : 0;
            const seasonPpg = curPpg != null ? (curPpg * curGp + priPpg * PIE_PHANTOM) / (curGp + PIE_PHANTOM) : priPpg;
            const expected = implied != null && implied > 0 ? implied : seasonPpg;
            const teamXpa = clamp(-0.6 + 0.137 * expected, 0.5, 5.5);
            const teamFga = 1.70 + 0.013 * expected;
            const ownFga = num(built.line.fga), ownXpa = num(built.line.xpa);
            const fga = ownFga > 0 ? 0.5 * teamFga + 0.5 * ownFga : teamFga;
            const xpa = ownXpa > 0 ? 0.8 * teamXpa + 0.2 * ownXpa : teamXpa;
            const fScale = ownFga > 0 ? fga / ownFga : 1, xScale = ownXpa > 0 ? xpa / ownXpa : 1;
            for (const k of Object.keys(built.line)) {
                if (/^(fga|fgm|fgmiss|fgm_)/.test(k)) built.line[k] = +(built.line[k] * fScale).toFixed(3);
                else if (/^(xpa|xpm|xpmiss)/.test(k)) built.line[k] = +(built.line[k] * xScale).toFixed(3);
            }
            built.why = built.why.replace(/^[\d.]+ FG att/, fga.toFixed(1) + ' FG att').replace(/[\d.]+ XP att/, xpa.toFixed(1) + ' XP att')
                + ' · team expected ' + expected.toFixed(1) + ' pts (' + (implied != null && implied > 0 ? 'Vegas' : 'season pace') + ')';
        }
        // Kick and punt returns ride on top of any position's line, only
        // where the league pays for them (yards, or the six for a score).
        if (grp !== 'K' && scoresReturns(opts.scoring)) {
            const ret = returnLine(pid, player, String(player.team || '').toUpperCase(), opts, ctx);
            if (ret) {
                Object.assign(built.line, ret.line);
                built.returns = ret.line;
                if (Number(opts.scoring.kr_yd) || Number(opts.scoring.pr_yd)) built.why = (built.why ? built.why + ' · ' : '') + 'returns: ' + ret.why;
            }
        }
        const pts = DB.scoreLine(built.line, opts.scoring, grp);
        if (pts == null) return null;
        // zero is a projection (a TE4 with no snaps), not a missing baseline
        if (pts <= 0) return { median: 0, floor: 0, ceiling: 0, why: built.why || 'no projected volume', line: built.line };
        return { median: +pts.toFixed(2), floor: +(pts * 0.7).toFixed(2), ceiling: +(pts * 1.35).toFixed(2), why: built.why, line: built.line };
    }

    // Same rule as WeeklyProj.recentPPG, over a table the caller supplies:
    // the last `lookback` weeks before `week` in which he scored.
    function recentPPGFrom(wpp, pid, week, lookback) {
        if (!wpp) return null;
        const weeks = Object.keys(wpp).map(Number).filter(w => w > 0 && w < week).sort((a, b) => b - a).slice(0, lookback || 3);
        if (!weeks.length) return null;
        const vals = weeks.map(w => Number(wpp[w] && wpp[w][pid]) || 0).filter(v => v > 0);
        if (!vals.length) return null;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    }

    // ── Kick and punt returns ─────────────────────────────────────────
    // Return duty follows the man, not the depth chart (the relay has no
    // KR/PR slots), so the returner is whoever took the team's returns:
    // half his share in the team's last game, half his season share
    // shrunk toward last season's with two games of phantom returns. Team
    // returns per game are this season's pace shrunk toward last season's
    // (PIE_PHANTOM games), else the 2025 league rate. Yards a return are
    // his own shrunk toward the league rate; touchdowns use the league
    // rate (owner request 2026-09-23). 2025 league rates per team game:
    // 3.82 kickoff returns at 25.9 yards, 1.52 punt returns at 10.2.
    const RET_NORM = { kr: { perGame: 3.82, ypr: 25.9, td: 0.0034, k: 20 }, pr: { perGame: 1.52, ypr: 10.2, td: 0.018, k: 15 } };
    const RET_PHANTOM = 2;   // games of last season's share the current season is blended with
    function returnLine(pid, player, team, opts, ctx) {
        const stats = opts.statsData || {}, prior = opts.priorData || {};
        const me = stats[pid] || null, mePri = prior[pid] || null;
        const tm = stats['TEAM_' + team] || null, tmPri = prior['TEAM_' + team] || null;
        // the team's most recent game
        let last = null;
        const weeks = (ctx.recentWeeks || []).filter(w => w && w.stats && w.stats['TEAM_' + team]).sort((a, b) => b.week - a.week);
        if (weeks.length) last = { me: weeks[0].stats[pid] || null, tm: weeks[0].stats['TEAM_' + team] };
        const line = {}, notes = [];
        let any = false;
        for (const kind of ['kr', 'pr']) {
            const n = RET_NORM[kind];
            const gp = tm ? (num(tm.gp) || 0) : 0, tot = tm ? (num(tm[kind]) || 0) : 0;
            const priGp = tmPri ? (num(tmPri.gp) || 0) : 0, priTot = tmPri ? (num(tmPri[kind]) || 0) : 0;
            const priPg = priGp > 0 ? priTot / priGp : n.perGame;
            const teamPg = (tot + PIE_PHANTOM * priPg) / (gp + PIE_PHANTOM);
            // Last season's share counts only for this team: the usage snapshot
            // records who returned for each team (owner ruling 2026-09-23, a
            // returner who changed teams carried his old share to the new one).
            // A newcomer with a return history elsewhere keeps a slice of it:
            // three quarters when the team's own returner from last season is
            // gone, a quarter when he is still here (Duvernay, Abdullah and
            // Deebo kept returning on new teams; Skyy Moore and Dortch did not).
            const U = usage(), ur = U && U.teams && U.teams[team] && U.teams[team].returns;
            let priShare;
            if (ur && ur[kind]) {
                if (ur[kind][pid]) priShare = clamp(ur[kind][pid].share || 0, 0, 1);
                else {
                    let elsewhere = 0;
                    for (const t of Object.keys(U.teams)) { const o = U.teams[t].returns; if (o && o[kind] && o[kind][pid]) elsewhere = Math.max(elsewhere, o[kind][pid].share || 0); }
                    let incPid = null, incShare = 0;
                    for (const q of Object.keys(ur[kind])) if ((ur[kind][q].share || 0) > incShare) { incShare = ur[kind][q].share; incPid = q; }
                    const inc = incPid && opts.playersData && opts.playersData[incPid];
                    const incGone = !inc || String(inc.team || '').toUpperCase() !== team || !!OUT_FOR_SHARE[statusOf(inc)];
                    priShare = clamp(elsewhere * (incGone ? 0.75 : 0.25), 0, 1);
                }
            } else priShare = priTot > 0 && mePri ? clamp((num(mePri[kind]) || 0) / priTot, 0, 1) : 0;
            const ph = RET_PHANTOM * priPg;
            const seasonShare = (tot + ph) > 0 ? ((me ? (num(me[kind]) || 0) : 0) + ph * priShare) / (tot + ph) : priShare;
            let share = seasonShare, lastShare = null;
            if (last && (num(last.tm[kind]) || 0) > 0) {
                lastShare = clamp(((last.me && num(last.me[kind])) || 0) / num(last.tm[kind]), 0, 1);
                share = 0.5 * lastShare + 0.5 * seasonShare;
            }
            if (share < 0.05) continue;
            let ret = 0, yds = 0;
            for (const r of [me, mePri]) if (r) { ret += num(r[kind]) || 0; yds += num(r[kind + '_yd']) || 0; }
            const ypr = (yds + n.k * n.ypr) / (ret + n.k);
            const cnt = teamPg * share;
            line[kind] = +cnt.toFixed(2);
            line[kind + '_yd'] = +(cnt * ypr).toFixed(1);
            line[kind + '_td'] = +(cnt * n.td).toFixed(3);
            notes.push(cnt.toFixed(1) + ' ' + kind.toUpperCase() + ' (' + Math.round(share * 100) + '% of team' + (lastShare != null ? ', ' + Math.round(lastShare * 100) + '% last game' : '') + ') at ' + ypr.toFixed(0) + ' yds');
            any = true;
        }
        if (!any) return null;
        line.st_td = +((line.kr_td || 0) + (line.pr_td || 0)).toFixed(3);
        return { line, why: notes.join(' · ') };
    }
    const RET_KEYS = ['kr_yd', 'pr_yd', 'kr_td', 'pr_td', 'st_td'];
    function scoresReturns(scoring) { return !!scoring && RET_KEYS.some(k => Number(scoring[k])); }

    // ── Preseason expectations ────────────────────────────────────────
    // Sleeper's season-long projections, published before the season, are
    // the one feed that still remembers a player was expected to be the
    // WR2 after an injury pushed him to the bottom of every depth chart.
    // The most a player was ever expected to carry: this season's share,
    // last season's share, or his preseason projected share.
    function expectedShare(pid, grp, team, ctx, opts) {
        const players = opts.playersData || {};
        let best = 0;
        // This season's share counts from game one for receivers and backs
        // (owner ruling 2026-09-20: Zay Flowers at 43% of week-one targets
        // was spot on). For quarterbacks it needs three team games, so one
        // week of a fill-in starter does not make him the expected QB1.
        const teamRow = opts.statsData && opts.statsData['TEAM_' + team];
        const teamGames = teamRow ? (num(teamRow.gp) || 0) : 0;
        if (grp !== 'QB' || teamGames >= 3) best = Math.max(best, perGameShare(opts.statsData, 'season', pid, team, grp, ctx, opts) || 0);
        best = Math.max(best, perGameShare(opts.priorData, 'prior', pid, team, grp, ctx, opts) || 0);
        return best;
    }

    // ── Freed targets across the whole passing game ───────────────────
    // When receivers go down, the throws do not vanish: they filter to the
    // healthy receivers, the tight end and the back (owner ruling
    // 2026-09-20, "a synchronized effort across the entire player field").
    // Freed share = the expected target share of every hurt WR/TE/RB on the
    // team; it is handed out to the healthy pass catchers in proportion to
    // their own target share, tilted so receivers absorb most of it, tight
    // ends next, backs least.
    const ABSORB = { WR: 1.0, TE: 0.8, RB: 0.55 };
    function targetShareOf(pid, team, ctx, opts) {
        // share of the team's TARGETS for any pass catcher (ballOf('WR') = rec_tgt)
        return expectedShare(pid, 'WR', team, ctx, opts);
    }
    function passPool(team, ctx, opts) {
        ctx._pool = ctx._pool || {};
        if (ctx._pool[team]) return ctx._pool[team];
        const players = opts.playersData || {};
        let freed = 0, denom = 0;
        const healthy = {};
        const hurtList = [];
        for (const mid of Object.keys(players)) {
            const m = players[mid];
            if (!m || String(m.team || '').toUpperCase() !== team) continue;
            const g = posGroup(m);
            if (!(g === 'WR' || g === 'TE' || g === 'RB')) continue;
            const tshare = targetShareOf(mid, team, ctx, opts);
            if (tshare <= 0) continue;
            const outW = OUT_FOR_SHARE[statusOf(m)] || 0;
            if (outW) { freed += tshare * outW; if (tshare >= 0.05) hurtList.push(fullName(m)); }
            else { healthy[mid] = { grp: g, tshare }; denom += ABSORB[g] * tshare; }
        }
        ctx._pool[team] = { freed, denom, healthy, hurt: hurtList };
        return ctx._pool[team];
    }
    // Extra share of the team's targets this healthy pass catcher picks up.
    function freedTargetShare(pid, team, ctx, opts) {
        const pool = passPool(team, ctx, opts);
        const me = pool.healthy[pid];
        if (!me || pool.freed <= 0 || pool.denom <= 0) return 0;
        return pool.freed * (ABSORB[me.grp] * me.tshare) / pool.denom;
    }

    // ── Supporting cast ───────────────────────────────────────────────
    // The team's depth chart by fantasy position (ESPN roles, Sleeper's
    // field as backup), each slot mapped to the Sleeper player so we know
    // his injury tag, his season share and his PFF grade.
    function teamDepth(team, ctx, opts) {
        ctx._depthIdx = ctx._depthIdx || {};
        if (ctx._depthIdx[team]) return ctx._depthIdx[team];
        const byPos = { QB: [], RB: [], WR: [], TE: [] };
        const players = opts.playersData || {};
        // name → pid for this team
        const idx = {};
        for (const pid of Object.keys(players)) {
            const p = players[pid];
            if (!p || String(p.team || '').toUpperCase() !== team) continue;
            const g = posGroup(p);
            if (!byPos[g]) continue;
            idx[espnName(fullName(p))] = pid;
        }
        let used = false;
        if (ctx.depth) {
            const prefix = team + '|';
            for (const k of Object.keys(ctx.depth)) {
                if (!k.startsWith(prefix)) continue;
                const r = ctx.depth[k];
                if (!byPos[r.pos]) continue;
                const pid = idx[k.slice(prefix.length)];
                if (!pid) continue;
                const br = baseRank(players[pid], r.pos, ctx.depth);
                byPos[r.pos].push({ pid, rank: br ? br.rank : (num(r.rank) || 99) });
                used = true;
            }
        }
        if (!used) {
            for (const pid of Object.values(idx)) {
                const p = players[pid];
                const g = SLEEPER_DEPTH_POS[String(p.depth_chart_position || '').toUpperCase()];
                const o = num(p.depth_chart_order);
                if (byPos[g] && o != null && o > 0) byPos[g].push({ pid, rank: o });
            }
        }
        for (const g of Object.keys(byPos)) byPos[g].sort((a, b) => a.rank - b.rank);
        ctx._depthIdx[team] = byPos;
        return byPos;
    }
    function castFor(pid, player, grp, team, opts, ctx) {
        if (!BALL_BASIS[grp] && grp !== 'K') return null;
        if (grp === 'DL' || grp === 'LB' || grp === 'DB') return null;
        const depth = teamDepth(team, ctx, opts);
        const players = opts.playersData || {};
        const nameOf = (id) => fullName(players[id]);
        const hurt = (m) => (OUT_FOR_SHARE[statusOf(m)] || 0) >= 0.3 || statusOf(m) === 'Q';
        if (grp === 'QB') {
            const pieces = [];
            const seen = new Set();
            const add = (g, maxRank) => {
                for (const slot of depth[g].filter(x => x.rank <= maxRank)) {
                    const m = players[slot.pid];
                    if (!m || slot.pid === pid || seen.has(slot.pid)) continue;
                    seen.add(slot.pid);
                    // his real weight: what he carries now, or what he was expected to
                    const share = Math.max(expectedShare(slot.pid, g, team, ctx, opts), BASE_SHARE[g] ? BASE_SHARE[g][Math.min(BASE_SHARE[g].length, slot.rank) - 1] : 0);
                    pieces.push({ name: nameOf(slot.pid), pos: g, rank: slot.rank, share: +share.toFixed(3), status: statusOf(m) });
                }
            };
            add('WR', 3); add('TE', 1); add('RB', 1);
            // Injured weapons the depth chart has already dropped: anyone on
            // the roster at WR/TE/RB who is hurt and was expected to carry a
            // real share (this season, last season or preseason).
            for (const mid of Object.keys(players)) {
                const m = players[mid];
                if (!m || mid === pid || seen.has(mid) || String(m.team || '').toUpperCase() !== team) continue;
                const g = posGroup(m);
                if (!(g === 'WR' || g === 'TE' || g === 'RB') || !hurt(m)) continue;
                const share = expectedShare(mid, g, team, ctx, opts);
                if (share < 0.08) continue;
                seen.add(mid);
                pieces.push({ name: nameOf(mid), pos: g, rank: null, share: +share.toFixed(3), status: statusOf(m) });
            }
            return pieces.length ? { pieces } : null;
        }
        // Everyone else: the quarterback who will actually start, judged
        // against the one who was EXPECTED to (this season's attempts, last
        // season's, or the preseason projection), so a starter the depth
        // chart has already demoted still counts as the missing man.
        const qbs = depth.QB;
        if (!qbs.length) return null;
        // A grade of 0 means PFF has not graded him yet (no snaps), not a terrible QB.
        const gradeOf = (m) => { const pf = m ? pffPlayer(m) : null; const g = pf ? (num(pf.pass) > 0 ? num(pf.pass) : num(pf.off)) : null; return g != null && g > 0 ? g : null; };
        let expected = null, expShare = 0;
        for (const mid of Object.keys(players)) {
            const m = players[mid];
            if (!m || String(m.team || '').toUpperCase() !== team || posGroup(m) !== 'QB') continue;
            const sh = expectedShare(mid, 'QB', team, ctx, opts);
            if (sh > expShare) { expShare = sh; expected = mid; }
        }
        if (!expected) expected = qbs[0].pid;
        const starter = qbs.find(x => !((OUT_FOR_SHARE[statusOf(players[x.pid])] || 0) >= 0.8)) || qbs[0];
        const sM = players[starter.pid];
        if (starter.pid !== expected && (OUT_FOR_SHARE[statusOf(players[expected])] || 0) >= 0.8) {
            const outNames = [nameOf(expected)].concat(qbs.filter(x => x.pid !== expected && x.pid !== starter.pid && (OUT_FOR_SHARE[statusOf(players[x.pid])] || 0) >= 0.8).map(x => nameOf(x.pid)));
            return { qb: { name: nameOf(starter.pid), status: statusOf(sM), grade: gradeOf(sM), backup: true, starterOut: outNames.join(', ') } };
        }
        return { qb: { name: nameOf(starter.pid), status: statusOf(sM), grade: gradeOf(sM) } };
    }

    // ── prepare: the async pieces, once per roster ────────────────────
    // Returns a context object build() reads synchronously.
    async function prepare(teams, week, opts) {
        opts = opts || {};
        const season = opts.season || currentSeason();
        const E = espn();
        const ctx = { season, week, coaching: null, standings: null, priorStandings: null, idp: null, prior: null, depth: null, recentWeeks: [], games: {}, h2h: {} };
        const jobs = [];
        jobs.push(depthCharts().then(r => { ctx.depth = r; }).catch(() => {}));
        for (let w = Math.max(1, week - RECENT_WEEKS); w < week; w++) {
            jobs.push(fetchWeek(season, w).then(st => { if (st && Object.keys(st).length > 10) ctx.recentWeeks.push({ week: w, stats: st }); }).catch(() => {}));
        }
        if (E) {
            jobs.push(E.coaching(season).then(c => { ctx.coaching = c; }).catch(() => {}));
            jobs.push(E.standings(season).then(s => { ctx.standings = s; }).catch(() => {}));
            jobs.push(E.standings(season - 1).then(s => { ctx.priorStandings = s; }).catch(() => {}));
        }
        jobs.push(idpRankings(season, opts.playersData).then(r => { ctx.idp = r; }).catch(() => {}));
        jobs.push(priorRankings(season - 1, opts.playersData).then(r => { ctx.prior = r; }).catch(() => {}));
        const list = [...new Set((teams || []).map(t => String(t || '').toUpperCase()).filter(Boolean))];
        if (E) {
            for (const t of list) {
                jobs.push(E.gameFor(t, week, season).then(g => { ctx.games[t] = g; }).catch(() => {}));
                const opp = opponentOf(t, week);
                if (opp) jobs.push(E.headToHead(t, opp, season).then(h => { ctx.h2h[t + '|' + opp] = h; }).catch(() => {}));
            }
        }
        await Promise.all(jobs);
        return ctx;
    }

    // ── build: engine input for one player ────────────────────────────
    function build(pid, week, opts, ctx) {
        opts = opts || {}; ctx = ctx || {};
        const player = opts.playersData && opts.playersData[pid];
        if (!player) return null;
        const grp = posGroup(player);
        const team = String(player.team || '').toUpperCase();
        const opp = opponentOf(team, week);
        const stats = (opts.statsData && opts.statsData[pid]) || null;
        const input = { pid, week, position: grp, team, opponentAbbr: opp, baselineSource: 'estimate' };

        // role first: in DHQ-baseline mode its projected volume feeds the baseline
        input.role = roleFor(pid, player, grp, team, opts, ctx);
        const depth = pffDepthRow(team, player);

        if (opts.baselineMode === 'dhq') {
            const own = dhqBaselineFor(pid, player, grp, input.role, opts, ctx);
            if (own) {
                input.baseline = { median: own.median, floor: own.floor, ceiling: own.ceiling };
                input.baselineSource = 'dhq';
                input.baselineWhy = own.why;
                input.baselineLine = own.line;
                // the ball share is inside the baseline now; role keeps rank and snaps
                if (input.role) { delete input.role.share; delete input.role.shareRank; }
            }
        } else {
            const base = baselineFor(pid, week, opts);
            if (base) { input.baseline = { median: base.median, floor: base.floor, ceiling: base.ceiling }; input.baselineSource = base.source; }
        }

        // health
        const sleeperStatus = String(player.injury_status || '').toUpperCase();
        let status = SLEEPER_STATUS[sleeperStatus] || (sleeperStatus ? sleeperStatus : '');
        // PFF's tag fills in only when Sleeper has none, and never for a man
        // who has already played this week (his tags are for next week).
        if (!status && !player.injury_status_after && depth && PFF_STATUS[String(depth.st || '').toLowerCase()]) status = PFF_STATUS[String(depth.st).toLowerCase()];
        if (isByeWeek(team, week) || (num(player.bye_week) === week)) status = 'BYE';
        input.health = { status };

        // opponent: blended rank (points allowed, PFF unit grade, last
        // season, team quality); falls back to this season's points-allowed
        // rank alone when the blend has nothing to work with.
        if (opp) {
            const blended = opponentFor(grp, opp, ctx, opts);
            if (blended) input.opponent = { abbr: opp, rankVsPos: blended.rank, detail: blended.detail };
            else {
                const rank = currentRank(opp, grp, ctx);
                input.opponent = { abbr: opp, rankVsPos: rank != null && rank >= 1 ? rank : null };
            }
        }

        // game
        const wk = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek[team + '|' + week];
        const g = ctx.games && ctx.games[team];
        if (wk || g) {
            const w = wk && wk.weather;
            input.game = {
                impliedTotal: wk && wk.vegas ? num(wk.vegas.impliedTotal) : null,
                spread: wk && wk.vegas ? num(wk.vegas.spread) : null,
                home: g ? (g.neutral ? null : g.home) : (wk ? wk.home : null),
                neutral: !!(g && g.neutral), international: !!(g && g.international),
                weather: w ? { indoor: !!w.indoor, display: w.display || '', tempF: num(w.temp) } : null,
            };
        }

        // coaching
        if (ctx.coaching && opp && ctx.coaching[team] && ctx.coaching[opp]) input.coaching = { team: ctx.coaching[team].score, opp: ctx.coaching[opp].score };

        // head-to-head
        const h = opp && ctx.h2h && ctx.h2h[team + '|' + opp];
        if (h) input.h2h = { games: h.games, wins: h.wins, avgMargin: h.avgMargin, division: h.division };

        // trench (a back's catch share tilts his line toward pass blocking)
        const catchShare = grp === 'RB' && stats ? ((num(stats.rec_tgt) || 0) / Math.max(1, (num(stats.rush_att) || 0) + (num(stats.rec_tgt) || 0))) : 0;
        const tr = opp && trenchFor(grp, team, opp, catchShare);
        if (tr && tr.mine != null && tr.theirs != null) input.trench = tr;

        // trend
        // opts.weeklyPoints (week → pid → league-scored points) lets a caller
        // hand in every player's recent weeks; the app's own table only holds
        // players who were on a roster that week (free agents read no trend).
        if (((App.WeeklyProj && App.WeeklyProj.recentPPG) || opts.weeklyPoints) && App.calcPPG && stats) {
            const last3 = num(opts.weeklyPoints ? recentPPGFrom(opts.weeklyPoints, pid, week, 3) : App.WeeklyProj.recentPPG(pid, week, 3));
            const seasonPPG = num(App.calcPPG(stats, opts.scoring));
            if (last3 != null && seasonPPG != null) input.trend = { last3, season: seasonPPG };
        }

        // supporting cast (the lines are the trench factor's job)
        const cast = castFor(pid, player, grp, team, opts, ctx);
        if (cast) input.cast = cast;

        // opponent health (the other side of the ball)
        const oh = oppHealthFor(opp, grp, opts, ctx);
        if (oh) input.oppHealth = oh;

        // luck
        if (stats && EXPECTED_TD_RATE[grp]) {
            const opps = grp === 'QB' ? num(stats.pass_att) || 0 : (num(stats.rush_att) || 0) + (num(stats.rec_tgt) || 0);
            const tds = grp === 'QB' ? num(stats.pass_td) || 0 : (num(stats.rush_td) || 0) + (num(stats.rec_td) || 0);
            if (opps >= 25) input.luck = { tdRate: tds / opps, expectedTdRate: EXPECTED_TD_RATE[grp] };
        }

        return input;
    }

    // ── Opponent health ───────────────────────────────────────────────
    // How banged up the other side of the ball is (owner ruling
    // 2026-09-21): for an offensive player, the opponent's secondary and
    // front; for a defender, the opponent's quarterback, line and skill
    // starters. A starter is anyone listed first on the depth chart at his
    // slot or who has played half the unit's snaps (this season, or last
    // season before the first game), so a man on IR still counts as a
    // starter lost even after ESPN drops him from the chart.
    const HEALTH_W = { OUT: 1, IR: 1, PUP: 1, SUS: 1, NA: 1, COV: 1, D: 0.85, Q: 0.3 };
    const OL_POS = new Set(['OL', 'OT', 'OG', 'C', 'G', 'T', 'LT', 'RT', 'LG', 'RG']);
    const UNIT_SIZE = { qb: 1, ol: 5, skill: 5, dl: 4, lb: 3, db: 5 };
    function snapShareOf(pid, opts, side) {
        const a = side === 'def' ? ['def_snp', 'tm_def_snp'] : ['off_snp', 'tm_off_snp'];
        for (const table of [opts.statsData, opts.priorData]) {
            const st = table && table[pid];
            if (!st || !(num(st.gp) >= 1)) continue;
            const mine = num(st[a[0]]), all = num(st[a[1]]);
            if (mine != null && all > 0) return clamp(mine / all, 0, 1);
        }
        return null;
    }
    function unitHealth(team, unit, ctx, opts) {
        const players = opts.playersData || {};
        const picked = {};
        const side = (unit === 'dl' || unit === 'lb' || unit === 'db') ? 'def' : 'off';
        const chartRank = { skill: { RB: 1, WR: 3, TE: 1 }, qb: { QB: 1 }, dl: { DL: 1 }, lb: { LB: 1 }, db: { DB: 1 } }[unit] || {};
        for (const g of Object.keys(chartRank)) for (const m of rankedMates(team, g, ctx, opts)) if (m.rank <= chartRank[g]) picked[m.pid] = true;
        for (const pid of Object.keys(players)) {
            const m = players[pid];
            if (!m || String(m.team || '').toUpperCase() !== team) continue;
            const g = posGroup(m);
            const inUnit = unit === 'ol' ? OL_POS.has(String(m.position || '').toUpperCase())
                : unit === 'skill' ? (g === 'RB' || g === 'WR' || g === 'TE') && String(m.position || '').toUpperCase() !== 'FB'
                : unit === 'qb' ? g === 'QB' : g === unit.toUpperCase();
            if (!inUnit || picked[pid]) continue;
            const sh = snapShareOf(pid, opts, side);
            if (sh != null && sh >= 0.5) picked[pid] = true;
        }
        const out = { starters: 0, lost: 0, names: [] };
        for (const pid of Object.keys(picked)) {
            const m = players[pid]; if (!m) continue;
            out.starters++;
            const w = HEALTH_W[statusOf(m)] || 0;
            if (w) { out.lost += w; out.names.push(fullName(m) + (w >= 0.85 ? ' out' : ' questionable')); }
        }
        out.starters = Math.max(out.starters, UNIT_SIZE[unit] || 0);
        out.lost = +out.lost.toFixed(2);
        return out;
    }
    function oppHealthFor(opp, grp, opts, ctx) {
        if (!opp || !ctx || !opts.playersData) return null;
        const team = String(opp).toUpperCase();
        const out = { team };
        if (BALL_BASIS[grp] === 'tackles') {
            out.side = 'offense';
            const qbs = rankedMates(team, 'QB', ctx, opts);
            const qb1 = qbs.find(m => m.rank <= 1) || null;
            if (qb1) {
                const w = HEALTH_W[statusOf(opts.playersData[qb1.pid])] || 0;
                out.qb = { name: qb1.name, lost: w };
                if (w >= 0.85) { const next = qbs.find(m => m.pid !== qb1.pid && !(HEALTH_W[statusOf(opts.playersData[m.pid])] >= 0.85)); if (next) out.qb.backup = next.name; }
            }
            out.ol = unitHealth(team, 'ol', ctx, opts);
            out.skill = unitHealth(team, 'skill', ctx, opts);
        } else {
            out.side = 'defense';
            out.db = unitHealth(team, 'db', ctx, opts);
            out.dl = unitHealth(team, 'dl', ctx, opts);
            out.lb = unitHealth(team, 'lb', ctx, opts);
        }
        return out;
    }

    // Sleeper's own published number for the week in this scoring, or null.
    function sleeperPoints(pid, week, opts) {
        const WP = App.WeeklyProj;
        if (!WP || !WP.projLine || !WP.projLine(pid, week)) return null;
        const scored = WP.projectPlayer(pid, { playersData: opts.playersData, statsData: opts.statsData, priorData: opts.priorData, scoring: opts.scoring, week, requireSleeper: true });
        return scored && scored.points ? num(scored.points.median) : null;
    }
    function project(pid, week, opts, ctx) {
        const input = build(pid, week, opts, ctx);
        if (!input || !App.MatchupEngine) return null;
        const out = App.MatchupEngine.project(input);
        out.team = input.team;
        out.opponentAbbr = input.opponentAbbr;
        out.sleeper = sleeperPoints(pid, week, opts);
        out.input = input;
        return out;
    }

    // Everything for a roster in one call: prepares the async context for
    // the teams involved, then projects each player.
    async function projectRoster(playerIds, week, opts) {
        opts = opts || {};
        const ids = (playerIds || []).filter(Boolean);
        const teams = ids.map(pid => opts.playersData && opts.playersData[pid] && opts.playersData[pid].team).filter(Boolean);
        const ctx = await prepare(teams, week, opts);
        const out = {};
        for (const pid of ids) { const p = project(pid, week, opts, ctx); if (p) out[pid] = p; }
        return { week, ctx, projections: out };
    }

    App.MatchupInputs = App.MatchupInputs || {
        prepare, build, project, projectRoster, idpRankings, priorRankings, depthCharts, baselineFor, dhqBaselineFor, sleeperPoints, opponentOf, opponentFor, trenchFor, castFor, teamDepth, expectedShare, teamSlotNorm, passPool, freedTargetShare, posGroup, normName, roleFor, oppHealthFor, returnLine, recentPPGFrom,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.MatchupInputs;
})(typeof window !== 'undefined' ? window : globalThis);
