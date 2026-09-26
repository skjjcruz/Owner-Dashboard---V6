// ══════════════════════════════════════════════════════════════════
// js/shared/dhq-proj.js — window.App.DhqProj
// Runs the DHQ matchup engine (the one matchup-lab.html grades with) in
// the background and keeps its weekly projection for every player the
// app shows, so each surface can print DHQ's number beside Sleeper's.
// Owner ruling 2026-09-23: "leave a slot for Sleeper projection and just
// add ours as well so folks can see them side by side". Sleeper's number
// still drives every lineup call; DHQ's rides alongside.
//
// Lazy: the engine files (~560 KB with the PFF and usage snapshots) load
// a few seconds after the app is up, then the week's shared context is
// built once (no peeking: season stats are summed from the weeks before
// the one projected), then players project in small chunks so the page
// stays responsive. When a batch lands it fires `wr:proj-updated`, the
// event every projection surface already re-renders on.
//
//   App.DhqProj.get(pid)   → { median, why, grade } | null (and queues pid)
//   App.DhqProj.fmt(pid)   → '12.3' | '…' (working) | '—' (no projection)
//   App.DhqProj.request(pids)
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const SL = 'https://api.sleeper.app/v1';
    const VERSION = 'LAB126';
    const DEPS = [
        'js/shared/matchup-engine.js', 'js/shared/dhq-baseline.js', 'js/shared/matchup-feeds-espn.js',
        'js/shared/matchup-inputs.js', 'data/pff-matchup-snapshot.js', 'data/usage-snapshot.js',
    ];
    // The PFF and usage snapshots are rebuilt on a schedule in the Lab repo
    // (skjjcruz/DHQ-Web-Page), where the PFF key is a repo secret and never
    // reaches a browser. The Lab reads its own copies; the website and the
    // app read the Lab's published ones, so every surface sees one fresh set.
    const DATA_HOME = 'https://skjjcruz.github.io/DHQ-Web-Page/';
    function depUrl(src) {
        if (!/^data\//.test(src)) return src;
        const onLab = /\/DHQ-Web-Page\//.test((root.location && root.location.pathname) || '');
        return onLab ? src : DATA_HOME + src;
    }
    const CHUNK = 25;
    const POS_OK = { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, DL: 1, LB: 1, DB: 1 };

    const st = {
        deps: null,          // promise: engine files loaded
        shared: {},          // `${season}|${week}` → promise of { statsCur, statsPrior, players }
        key: null,           // `${leagueId}|${week}` the results belong to
        results: {},         // pid → { median, why, grade } | null (projected, nothing to show)
        queue: new Set(),
        running: false,
        ctx: null, ctxKey: null,
        error: null,
    };

    // ── plumbing ──────────────────────────────────────────────────────
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = depUrl(src) + '?v=' + VERSION;
            s.async = false;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('could not load ' + src));
            document.head.appendChild(s);
        });
    }
    function loadDeps() {
        if (st.deps) return st.deps;
        st.deps = (async () => {
            if (!App.MatchupEngine || !App.DhqBaseline || !App.MatchupInputs) {
                for (const src of DEPS) await loadScript(src);
            }
            if (!App.MatchupInputs || !App.MatchupEngine) throw new Error('engine did not load');
        })();
        st.deps.catch(e => { st.deps = null; st.error = e; });
        return st.deps;
    }
    const getJson = (url) => fetch(url).then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); });
    const S = () => root.S || {};
    function league() {
        const s = S(), id = String(s.currentLeagueId || '');
        if (!id) return null;
        const lg = (s.leagues || []).find(l => String(l.league_id || l.id) === id);
        return lg ? { id, scoring: lg.scoring_settings || {} } : null;
    }
    function week() {
        const WP = App.WeeklyProj;
        if (!WP) return 0;
        return Number((WP.displayWeek && WP.displayWeek()) || (WP.loadedProjWeek && WP.loadedProjWeek()) || (WP.currentWeek && WP.currentWeek()) || 0);
    }
    function season() {
        const s = S();
        return Number(s.season || (s.nflState && s.nflState.season) || new Date().getFullYear());
    }

    // The week's shared inputs, the same way the lab builds them: this
    // season's stats summed from the completed weeks before `wk`, last
    // season's table, and an injury tag set aside for anyone whose game this
    // week has already been played (he played; a tag added afterwards must
    // not zero him).
    function sharedFor(yr, wk) {
        const k = yr + '|' + wk;
        if (st.shared[k]) return st.shared[k];
        st.shared[k] = (async () => {
            const weeksDone = []; for (let w = 1; w < wk; w++) weeksDone.push(w);
            const got = await Promise.all([
                getJson(SL + '/stats/nfl/regular/' + yr).catch(() => ({})),
                getJson(SL + '/stats/nfl/regular/' + (yr - 1)).catch(() => ({})),
                getJson(SL + '/stats/nfl/regular/' + yr + '/' + wk).catch(() => ({})),
            ].concat(weeksDone.map(w => getJson(SL + '/stats/nfl/regular/' + yr + '/' + w).catch(() => ({})))));
            const statsCur = {};
            got.slice(3).forEach(wkRows => {
                Object.keys(wkRows || {}).forEach(pid => {
                    const row = wkRows[pid]; if (!row || typeof row !== 'object') return;
                    const acc = statsCur[pid] = statsCur[pid] || {};
                    Object.keys(row).forEach(f => { if (typeof row[f] === 'number') acc[f] = (acc[f] || 0) + row[f]; });
                });
            });
            Object.keys(got[0] || {}).forEach(k2 => {
                if (k2.indexOf('TEAM_') !== 0) return;
                const row = got[0][k2];
                if (row && row.gp === weeksDone.length) statsCur[k2] = row;
            });
            const base = S().players || {};
            const players = Object.assign({}, base);
            const actual = got[2] || {};
            Object.keys(actual).forEach(pid => {
                const p = base[pid];
                if (p && p.injury_status && actual[pid] && actual[pid].gp >= 1) players[pid] = Object.assign({}, p, { injury_status_after: p.injury_status, injury_status: null });
            });
            // matchup context the engine reads (opponents, Vegas, defense ranks)
            try { if (App.SOS && !App.SOS.ready && App.SOS.initialize) await App.SOS.initialize(String(yr), base); } catch (e) { /* neutral */ }
            try { if (App.NflContext && App.NflContext.load) await App.NflContext.load([wk], yr); } catch (e) { /* neutral */ }
            // The relay can fail; the lab reads ESPN's scoreboard directly, so do the same when it did.
            try {
                const have = Object.keys((App.WeeklyProj && App.WeeklyProj._ctx.byTeamWeek) || {}).filter(k2 => k2.split('|')[1] === String(wk)).length;
                if (have < 20 && App.NflContext && App.NflContext.parse) {
                    const sb = await getJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=' + wk + '&seasontype=2&dates=' + yr);
                    App.WeeklyProj.setContext({ byTeamWeek: App.NflContext.parse(sb, wk) });
                }
            } catch (e) { /* neutral */ }
            return { statsCur, statsPrior: got[1] || {}, players, weekly: weeksDone.map((w, i) => ({ week: w, rows: got[3 + i] || {} })), wpp: {} };
        })();
        st.shared[k].catch(() => { delete st.shared[k]; });
        return st.shared[k];
    }

    // ── the worker ────────────────────────────────────────────────────
    function resetIfMoved() {
        const lg = league(), wk = week();
        if (!lg || !wk) return null;
        const key = lg.id + '|' + wk;
        if (st.key !== key) { st.key = key; st.results = {}; st.queue.clear(); st.ctx = null; st.ctxKey = null; }
        return { lg, wk, key };
    }
    function notify() {
        try { root.dispatchEvent(new CustomEvent('wr:proj-updated', { detail: { source: 'dhq', week: week() } })); } catch (e) { /* no window */ }
    }
    async function run() {
        if (st.running) return;
        st.running = true;
        try {
            await loadDeps();
            while (st.queue.size) {
                const at = resetIfMoved();
                if (!at) break;
                const yr = season();
                const shared = await sharedFor(yr, at.wk);
                const MI = App.MatchupInputs;
                // every player's recent weeks in this league's scoring, like the lab page builds them
                if (!shared.wpp[at.lg.id] && App.calcRawPts) {
                    const wpp = {};
                    shared.weekly.forEach(({ week: w, rows }) => { const m = wpp[w] = {}; Object.keys(rows).forEach(pid => { if (pid.indexOf('TEAM_') !== 0 && rows[pid]) m[pid] = +App.calcRawPts(rows[pid], at.lg.scoring).toFixed(2); }); });
                    shared.wpp[at.lg.id] = wpp;
                }
                const opts = { playersData: shared.players, statsData: shared.statsCur, priorData: shared.statsPrior, scoring: at.lg.scoring, season: yr, baselineMode: 'dhq', weeklyPoints: shared.wpp[at.lg.id] || null };
                if (st.ctxKey !== at.key) {
                    const teams = [...new Set(Object.values(shared.players).map(p => p && p.team).filter(Boolean))];
                    st.ctx = await MI.prepare(teams, at.wk, opts);
                    st.ctxKey = at.key;
                }
                const now = resetIfMoved(); if (!now || now.key !== at.key) continue;   // league or week changed while preparing
                const batch = [...st.queue].slice(0, CHUNK);
                batch.forEach(pid => st.queue.delete(pid));
                for (const pid of batch) {
                    if (pid in st.results) continue;
                    let res = null;
                    try {
                        const p = MI.project(pid, at.wk, opts, st.ctx);
                        if (p && p.points && Number.isFinite(Number(p.points.median))) {
                            res = { median: p.available === false ? 0 : +Number(p.points.median).toFixed(1), floor: p.available === false ? 0 : +Number(p.points.floor || 0).toFixed(1), ceiling: p.available === false ? 0 : +Number(p.points.ceiling || 0).toFixed(1), grade: p.grade, verdict: p.verdict, why: whyText(p.why) };
                        }
                    } catch (e) { res = null; }
                    st.results[pid] = res;
                }
                if (!st.queue.size) notify();
                await new Promise(r => setTimeout(r, 0));   // let the page breathe between chunks
            }
        } catch (e) {
            st.error = e;
            if (root.wrLog) root.wrLog('dhqProj.run', e);
        } finally {
            st.running = false;
        }
    }
    let _kick = null;
    function kick() { if (_kick) return; _kick = setTimeout(() => { _kick = null; run(); }, 50); }

    // The three factors that moved his number most, in plain words:
    // "Opponent vs position +8% · Role & opportunity +5%".
    function whyText(list) {
        return (list || []).filter(f => f && f.label && Math.abs(Number(f.impactPct) || 0) >= 1).slice(0, 3)
            .map(f => f.label + ' ' + (f.impactPct > 0 ? '+' : '') + Math.round(f.impactPct) + '%').join(' · ');
    }
    function eligible(pid) {
        const p = (S().players || {})[pid];
        if (!p || !p.team) return false;
        const g = App.MatchupInputs ? App.MatchupInputs.posGroup(p) : String((App.normPos && App.normPos(p.position)) || p.position || '').toUpperCase();
        return !!POS_OK[g] || !!POS_OK[({ DE: 'DL', DT: 'DL', NT: 'DL', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', OLB: 'LB', ILB: 'LB', MLB: 'LB' })[String(p.position || '').toUpperCase()]];
    }
    function request(pids) {
        if (!resetIfMoved()) return;
        let added = false;
        (pids || []).forEach(pid => {
            pid = String(pid || '');
            if (!pid || pid in st.results || st.queue.has(pid)) return;
            if (!eligible(pid)) { st.results[pid] = null; return; }
            st.queue.add(pid); added = true;
        });
        if (added) kick();
    }
    function get(pid) {
        pid = String(pid || '');
        if (!resetIfMoved() || !pid) return null;
        if (pid in st.results) return st.results[pid];
        request([pid]);
        return null;
    }
    function fmt(pid) {
        const r = get(pid);
        if (r) return Number(r.median) > 0 ? Number(r.median).toFixed(1) : '0.0';
        return String(pid || '') in st.results ? '—' : '…';
    }
    // ── The league platform's own projections (MFL) ──────────────────
    // MFL publishes projected points per league, already scored with that
    // league's rules; when the league lives on MFL those become the
    // platform column (ESPN and Yahoo leagues keep Sleeper's number until
    // their feeds are wired). Same proxy route the MFL adapter uses (MFL
    // sends no CORS headers).
    const PLATFORM_NAME = { sleeper: 'Sleeper', mfl: 'MFL', espn: 'ESPN', yahoo: 'Yahoo' };
    const plat = { done: {}, busy: false };
    function mflProxy() {
        const cfg = (App.CONFIG || (root.OD && root.OD.CONFIG) || {});
        const url = (cfg.endpoints && cfg.endpoints.mflProxy) || (cfg.functionsBase ? cfg.functionsBase + '/mfl-proxy' : ((root.OD && root.OD.SUPABASE_URL) || App.SUPABASE_URL ? ((root.OD && root.OD.SUPABASE_URL) || App.SUPABASE_URL) + '/functions/v1/mfl-proxy' : null));
        const anon = cfg.supabaseAnon || (root.OD && (root.OD.SUPABASE_ANON || (root.OD.CONFIG && root.OD.CONFIG.supabaseAnon))) || App.SUPABASE_ANON || null;
        return { url, anon };
    }
    async function mflGet(url) {
        const px = mflProxy();
        if (px.url && px.anon) {
            const token = (root.OD && root.OD.getSessionToken && root.OD.getSessionToken()) || null;
            const r = await fetch(px.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || px.anon), apikey: px.anon }, body: JSON.stringify({ url }) });
            if (!r.ok) throw new Error('MFL proxy ' + r.status);
            return r.json();
        }
        const r = await fetch(url); if (!r.ok) throw new Error('MFL ' + r.status); return r.json();
    }
    async function loadPlatform() {
        const s = S();
        if (String(s.platform || '') !== 'mfl' || plat.busy || !root.MFL || !root.MFL.lookupSleeperPlayerId) return;
        const lg = league(); if (!lg) return;
        const WP = App.WeeklyProj; const wk = Number((WP && WP.currentWeek && WP.currentWeek()) || 0); if (!wk) return;
        const lid = s.mflLeagueId || String(lg.id).replace(/^mfl_/, '').replace(/_\d+$/, '');
        const yr = s.mflYear || season();
        const k = yr + '|' + lid + '|' + wk;
        if (plat.done[k]) return;
        plat.busy = true;
        try {
            let url = 'https://api.myfantasyleague.com/' + yr + '/export?TYPE=projectedScores&L=' + encodeURIComponent(lid) + '&W=' + wk + '&JSON=1';
            if (s.mflApiKey) url += '&APIKEY=' + encodeURIComponent(s.mflApiKey);
            const data = await mflGet(url);
            const list = data && data.projectedScores && data.projectedScores.playerScore;
            const arr = Array.isArray(list) ? list : (list ? [list] : []);
            const byPid = {};
            arr.forEach(p => { if (p && p.id != null && p.score !== '' && p.score != null && Number.isFinite(Number(p.score))) byPid[root.MFL.lookupSleeperPlayerId(String(p.id))] = Number(p.score); });
            if (Object.keys(byPid).length > 20 && WP.setPlatformPoints) {
                WP.setPlatformPoints(wk, byPid, 'mfl');
                plat.done[k] = true;
                try { root.dispatchEvent(new CustomEvent('wr:proj-updated', { detail: { source: 'mfl', week: wk } })); } catch (e) { /* no window */ }
            }
        } catch (e) { if (root.wrLog) root.wrLog('dhqProj.mfl', e); }
        finally { plat.busy = false; }
    }
    // The name on the platform projection column: the league's platform
    // when its own numbers are loaded for the week, else Sleeper's.
    function provLabel() {
        const WP = App.WeeklyProj, wk = week();
        const src = WP && WP.platformSource ? WP.platformSource(wk) : null;
        return src && PLATFORM_NAME[src] ? PLATFORM_NAME[src] : 'Sleeper';
    }

    // DHQ's best lineup for a roster: the same slot solver as the app's
    // optimizer, fed DHQ's numbers (IR and taxi never start; a player's
    // every Sleeper position counts, so an edge rusher can fill a DL slot).
    function optimalFor(roster, rosterPositions) {
        const SS = App.StartSit;
        if (!SS || !SS.optimalLineupWeekly || !roster) return null;
        const skip = new Set([].concat(roster.reserve || [], roster.taxi || []).map(String));
        const players = S().players || {};
        const list = (roster.players || []).map(String).filter(pid => pid && !skip.has(pid)).map(pid => {
            const r = get(pid), p = players[pid] || {};
            const pos = String((App.normPos && App.normPos(p.position)) || p.position || '').toUpperCase();
            return { pid, pos, positions: (p.fantasy_positions || []).concat([pos]), available: !!(r && Number(r.median) > 0), pts: r ? Number(r.median) || 0 : 0 };
        });
        return SS.optimalLineupWeekly(list, rosterPositions || []);
    }
    // Numeric total of several players, or null while any is still working.
    function totalNum(pids) {
        let t = 0;
        for (const pid of (pids || [])) { const r = get(pid); if (r) t += Number(r.median) || 0; else if (!(String(pid) in st.results)) return null; }
        return +t.toFixed(1);
    }
    // The week's matchup on DHQ's numbers: the lineup you have set against
    // the lineup they have set (owner ruling 2026-09-24: current lineups,
    // not best ones; their best is still reported as `oppIdeal`), with the
    // same win-probability math as the
    // app's forecast (App.Matchup). Null until every player involved has a
    // DHQ number, so the screen never mixes half-loaded totals.
    function matchup(myPids, oppRoster, rosterPositions) {
        const M = App.Matchup;
        if (!M || !M.dist || !M.forecast || !oppRoster) return null;
        const mine = (myPids || []).map(String);
        if (!mine.length || totalNum(mine) == null) return null;
        const opt = optimalFor(oppRoster, rosterPositions);
        if (!opt || !(opt.total > 0)) return null;
        const oppIds = opt.starters.map(x => String(x.pid));
        const cur = (oppRoster.starters || []).filter(x => x && x !== '0').map(String);
        if (totalNum(oppIds) == null || !cur.length || totalNum(cur) == null) return null;
        const map = {};
        mine.concat(oppIds, cur).forEach(pid => {
            const r = get(pid); if (!r) return;
            const med = Number(r.median) || 0;
            map[pid] = { available: med > 0, points: { median: med, floor: r.floor != null ? Number(r.floor) : med * 0.7, ceiling: r.ceiling != null ? Number(r.ceiling) : med * 1.35 } };
        });
        const fc = M.forecast(M.dist(mine, map, 'median'), M.dist(cur, map, 'median'));
        return { fc, oppIdeal: +Number(opt.total).toFixed(1), oppCur: totalNum(cur) || 0, oppIds };
    }
    // A lineup's scoring distribution on DHQ's numbers (App.Matchup.dist:
    // mean of medians, spread from each player's floor-ceiling band), or
    // null while any of its players is still being projected.
    function teamDist(pids) {
        const M = App.Matchup;
        const ids = (pids || []).map(String).filter(x => x && x !== '0');
        if (!M || !M.dist || !ids.length || totalNum(ids) == null) return null;
        const map = {};
        ids.forEach(pid => {
            const r = get(pid); if (!r) return;
            const med = Number(r.median) || 0;
            map[pid] = { available: med > 0, points: { median: med, floor: r.floor != null ? Number(r.floor) : med * 0.7, ceiling: r.ceiling != null ? Number(r.ceiling) : med * 1.35 } };
        });
        const d = M.dist(ids, map, 'median');
        return d && d.n > 0 ? d : null;
    }
    // This week's games for the season simulator (App.PlayoffOdds weekDists):
    // every team's set lineup on DHQ's numbers, the user's own from the
    // lineup in the Game Day slots when given. Null until every team in
    // `pairs` is fully projected, so the odds never mix half-loaded weeks.
    // The same for any set of rosters (a chopped league has no pairings:
    // every living team plays the whole league).
    function rosterDists(lg, ids, wk, myRosterId, myStarters) {
        if (!lg || !Array.isArray(ids) || !ids.length || Number(wk) !== week()) return null;
        const byId = {};
        (lg.rosters || []).forEach(r => { byId[String(r.roster_id)] = r; });
        const byRoster = {};
        for (const rid of ids.map(String)) {
            const r = byId[rid];
            if (!r) return null;
            const mine = myRosterId != null && rid === String(myRosterId) && myStarters && myStarters.length;
            const d = teamDist(mine ? myStarters : r.starters);
            if (!d) return null;
            byRoster[rid] = { mean: d.mean, sd: d.sd };
        }
        return { week: Number(wk), byRoster, stamp: stamp() };
    }
    function weekDists(lg, pairs, wk, myRosterId, myStarters) {
        if (!Array.isArray(pairs) || !pairs.length) return null;
        const got = rosterDists(lg, [].concat(...pairs), wk, myRosterId, myStarters);
        if (!got) return null;
        const byRoster = got.byRoster;
        // The user's own game, priced exactly as the matchup box prices it.
        let myWinPct = null;
        const my = myRosterId != null ? pairs.find(p => p.map(String).includes(String(myRosterId))) : null;
        if (my && App.Matchup && App.Matchup.forecast) {
            const opp = my.map(String).find(x => x !== String(myRosterId));
            const a = byRoster[String(myRosterId)], b = byRoster[opp];
            const fc = a && b ? App.Matchup.forecast({ mean: a.mean, sd: a.sd, n: 1 }, { mean: b.mean, sd: b.sd, n: 1 }) : null;
            if (fc && fc.winPct != null) myWinPct = fc.winPct;
        }
        return { week: Number(wk), byRoster, myWinPct, stamp: stamp() };
    }
    // ── Putting a lineup into slots with the fewest moves ─────────────
    // The optimizer picks WHO starts; this decides WHERE, keeping every
    // starter who can stay in his current slot there (owner report
    // 2026-09-24: benching a DL for an LB read "replace Derick Hall with
    // Eric Wilson" because the slot filler shuffled three players when
    // two moves did it). Min-cost assignment (Hungarian): 0 to stay put,
    // 1 to move, impossible where the player's positions (every Sleeper
    // position he holds) do not fit the slot.
    function posList(pid) {
        const p = (S().players || {})[pid] || {};
        const base = App.MatchupInputs ? App.MatchupInputs.posGroup(p) : String((App.normPos && App.normPos(p.position)) || p.position || '').toUpperCase();
        return [...new Set((p.fantasy_positions || []).map(x => String(x || '').toUpperCase()).concat([base]))].filter(Boolean);
    }
    function hungarian(a) {   // a: n rows × m cols, n ≤ m; returns row → col
        const n = a.length, m = n ? a[0].length : 0, INF = 1e18;
        const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
        for (let i = 1; i <= n; i++) {
            p[0] = i; let j0 = 0;
            const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
            do {
                used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
                for (let j = 1; j <= m; j++) if (!used[j]) {
                    const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                }
                for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
                j0 = j1;
            } while (p[j0] !== 0);
            do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
        }
        const out = new Array(n).fill(-1);
        for (let j = 1; j <= m; j++) if (p[j]) out[p[j] - 1] = j - 1;
        return out;
    }
    // pids: who starts; slots: [{ idx, elig: [...] }]; current: idx → pid.
    // Returns idx → pid, or null when the lineup cannot fit the slots.
    function assignSlots(pids, slots, current) {
        const list = (pids || []).map(String).filter(Boolean);
        const sl = (slots || []).filter(x => x && Array.isArray(x.elig));
        if (!list.length || list.length > sl.length) return null;
        const BIG = 1e6, cur = current || {};
        const cost = list.map(pid => { const pos = posList(pid); return sl.map(x => !pos.some(q => x.elig.includes(q)) ? BIG : (String(cur[x.idx] || '') === pid ? 0 : 1)); });
        const pick = hungarian(cost);
        const out = {};
        for (let r = 0; r < list.length; r++) { const c = pick[r]; if (c < 0 || cost[r][c] >= BIG) return null; out[sl[c].idx] = list[r]; }
        return out;
    }
    // ── One lineup check for every surface ───────────────────────────
    // Game Day's top box, the Home Lineup Check widget and the phone hero
    // tile all read this (owner ruling 2026-09-24: "make the lineup tab
    // feed the widget so they both say the same things"). DHQ's best
    // lineup for the roster, placed with the fewest moves, against the
    // lineup set (or, on Game Day, the one in the slots). Same shape as
    // WeeklyProj.optimalForRoster's result where they overlap, so callers
    // can swap it in; null until every player involved has a DHQ number.
    const BENCH_SLOTS = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);
    function slotList(league) {
        const SS = App.StartSit; if (!SS) return [];
        const out = []; let t = 0;
        ((league && league.roster_positions) || []).forEach(raw => {
            const nm = SS.normSlot(raw);
            if (BENCH_SLOTS.has(nm)) return;
            const elig = (SS.FLEX_ALLOWED && SS.FLEX_ALLOWED[nm]) || (SS.BASE_POSITIONS && SS.BASE_POSITIONS.has(nm) ? [nm] : null);
            if (!elig) { t++; return; }
            out.push({ idx: t, slotName: nm, elig }); t++;
        });
        return out;
    }
    function lineupCheck(roster, league, working) {
        if (!roster || !league || !resetIfMoved()) return null;
        const slots = slotList(league);
        const current = {};
        if (working) Object.keys(working).forEach(k => { if (working[k]) current[k] = String(working[k]); });
        else slots.forEach(x => { const pid = (roster.starters || [])[x.idx]; if (pid && String(pid) !== '0') current[x.idx] = String(pid); });
        const curPids = Object.values(current);
        const cur = totalNum(curPids);
        const best = optimalFor(roster, league.roster_positions || []);
        if (cur == null || !best || !(best.total > 0)) return null;
        const bestPids = best.starters.map(x => String(x.pid));
        if (totalNum(bestPids) == null) return null;
        const placed = assignSlots(bestPids, slots, current) || {};
        const d = Math.round((best.total - cur) * 10) / 10;
        const nameOfSlot = k => { const x = slots.find(y => String(y.idx) === String(k)); return x ? x.slotName : ''; };
        const base = pid => { const l = posList(pid); return l.length ? l[l.length - 1] : ''; };
        const startInstead = Object.keys(placed).filter(k => !curPids.includes(placed[k])).map(k => ({ pid: placed[k], slot: nameOfSlot(k), pos: base(placed[k]), pts: (get(placed[k]) || {}).median || 0 }));
        const benchInstead = curPids.filter(pid => !bestPids.includes(pid));
        const moves = Object.keys(placed).filter(k => curPids.includes(placed[k]) && String(current[k] || '') !== placed[k]).map(k => ({ pid: placed[k], slot: nameOfSlot(k), pos: base(placed[k]), from: nameOfSlot(Object.keys(current).find(c => current[c] === placed[k])) }));
        return {
            week: week(), objective: 'dhq', source: 'dhq', optimal: best, placed, slots,
            delta: { currentTotal: cur, optimalTotal: +Number(best.total).toFixed(1), delta: Math.max(0, d), isOptimal: d <= 0.05, startInstead, benchInstead, moves },
        };
    }
    // Total of several players (a lineup), '…' while any is still working.
    // Changes whenever a batch of DHQ numbers lands (or the league or week
    // moves), so a cached result built on DHQ's numbers knows to rebuild.
    function stamp() { return (st.key || '') + ':' + Object.keys(st.results).length; }
    function sum(pids) {
        let t = 0, waiting = false;
        (pids || []).forEach(pid => { const r = get(pid); if (r) t += Number(r.median) || 0; else if (!(String(pid) in st.results)) waiting = true; });
        return waiting ? '\u2026' : t.toFixed(1);
    }
    // Every rostered player in the league, so rosters, Start/Sit and the
    // opponent's side are ready before anyone opens them.
    function warmLeague() {
        const rs = S().rosters || [];
        const ids = [];
        rs.forEach(r => (r.players || []).forEach(pid => ids.push(pid)));
        if (ids.length) request(ids);
    }
    function boot() {
        let tries = 0;
        const iv = setInterval(() => {
            tries++;
            if (league() && week() && (S().players && Object.keys(S().players).length > 1000)) { clearInterval(iv); loadPlatform(); setTimeout(warmLeague, 3000); }
            else if (tries > 120) clearInterval(iv);
        }, 1000);
        // The app can open a league while it still thinks it is an earlier
        // week (owner screenshot 2026-09-23: Game Day stuck on week 1 while
        // the schedule said week 3). When the app's week moves on, load that
        // week's Sleeper lines; every surface follows the newest loaded week.
        let seenWeek = 0;
        setInterval(() => {
            const WP = App.WeeklyProj, SP = App.SleeperProj;
            const cw = Number((WP && WP.currentWeek && WP.currentWeek()) || 0);
            if (!cw || cw === seenWeek) return;
            seenWeek = cw;
            if (WP.loadedProjWeek && WP.loadedProjWeek() && WP.loadedProjWeek() < cw && SP && SP.loadCurrent) SP.loadCurrent(season());
        }, 5000);
        // a league switch or the week's Sleeper lines landing re-warms the new league
        root.addEventListener && root.addEventListener('wr:proj-updated', (e) => { if (!(e && e.detail && e.detail.source === 'dhq')) { loadPlatform(); setTimeout(warmLeague, 500); } });
    }

    App.DhqProj = App.DhqProj || { get, fmt, sum, totalNum, stamp, week, teamDist, weekDists, rosterDists, optimalFor, matchup, lineupCheck, slotList, assignSlots, hungarian, posList, provLabel, loadPlatform, request, warmLeague, _st: st, VERSION };
    if (typeof document !== 'undefined') boot();
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.DhqProj;
})(typeof window !== 'undefined' ? window : globalThis);
