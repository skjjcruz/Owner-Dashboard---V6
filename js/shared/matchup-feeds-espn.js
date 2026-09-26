// ══════════════════════════════════════════════════════════════════
// js/shared/matchup-feeds-espn.js — window.App.MatchupFeeds.espn
//
// Builds three matchup-engine inputs from ESPN's public endpoints:
//
//   coaching   — a 0..1 staff score per team from the head coach's years
//                of experience, career regular-season win rate and
//                playoff record. No human opinion, refreshed with the data.
//   standings  — wins, losses, win rate and point differential per team,
//                plus each team's division.
//   headToHead — the last N meetings between two teams across the last
//                three seasons, from the first team's point of view:
//                games, wins, average margin, and whether it is a
//                division rivalry.
//
// Everything is cached in sessionStorage for four hours (owner ruling
// 2026-09-19: refresh more than once a day), so a page reload inside
// that window costs no network at all. Runs in the browser and in Node
// (global fetch) so it can be smoke-tested from the command line:
//     node -e "require('./js/shared/matchup-feeds-espn.js').espn.coaching(2026).then(console.log)"
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    App.MatchupFeeds = App.MatchupFeeds || {};

    const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
    const SITE_V2 = 'https://site.api.espn.com/apis/v2/sports/football/nfl';
    const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
    const TTL_MS = 4 * 60 * 60 * 1000;
    const H2H_SEASONS = 3;
    const H2H_MAX_GAMES = 6;

    // ESPN codes → Sleeper codes. Everything else matches already.
    const ESPN_TO_SLEEPER = { WSH: 'WAS', LA: 'LAR', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
    const code = (abbr) => { const a = String(abbr || '').toUpperCase(); return ESPN_TO_SLEEPER[a] || a; };

    // ── tiny cache ───────────────────────────────────────────────────
    const mem = {};
    function cacheGet(key) {
        if (mem[key] && Date.now() - mem[key].ts < TTL_MS) return mem[key].data;
        try {
            const raw = root.sessionStorage && root.sessionStorage.getItem('dhq_mf_' + key);
            if (!raw) return null;
            const rec = JSON.parse(raw);
            if (Date.now() - rec.ts > TTL_MS) return null;
            mem[key] = rec;
            return rec.data;
        } catch (e) { return null; }
    }
    function cacheSet(key, data) {
        const rec = { ts: Date.now(), data };
        mem[key] = rec;
        try { root.sessionStorage && root.sessionStorage.setItem('dhq_mf_' + key, JSON.stringify(rec)); } catch (e) { /* quota or private mode */ }
        return data;
    }
    const inflight = {};
    function cached(key, build) {
        const hit = cacheGet(key);
        if (hit) return Promise.resolve(hit);
        if (inflight[key]) return inflight[key];
        inflight[key] = Promise.resolve().then(build).then(d => { delete inflight[key]; return cacheSet(key, d); }, e => { delete inflight[key]; throw e; });
        return inflight[key];
    }

    async function getJson(url) {
        // ESPN answers 403 to Node's default user agent; browsers ignore this
        // header, so it only matters for command-line smoke tests.
        const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'curl/8.5.0' } });
        if (!res.ok) throw new Error('ESPN ' + res.status + ' for ' + url);
        return res.json();
    }
    // The core API hands back {$ref} links; follow one and force https.
    const follow = (ref) => getJson(String(ref).replace(/^http:/, 'https:'));
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

    function currentSeason() {
        const d = new Date();
        return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    }

    // ── teams: Sleeper code ↔ ESPN id ────────────────────────────────
    // Read from the standings tables, not ESPN's /teams list: /teams is the
    // one endpoint here that refuses browser calls (no CORS header), and
    // every other lookup waits on this map (owner report 2026-09-19, the
    // Lab showed no coaching or head-to-head on the iPad).
    function teams(season) {
        return cached('teams', async () => {
            const out = {};
            try {
                const d = await getJson(SITE_V2 + '/standings?season=' + (season || currentSeason()) + '&level=3');
                const walk = (node) => {
                    for (const e of (node.standings && node.standings.entries) || []) {
                        if (e.team && e.team.id) out[code(e.team.abbreviation)] = { id: String(e.team.id), espn: e.team.abbreviation, name: e.team.displayName || e.team.name };
                    }
                    for (const c of node.children || []) walk(c);
                };
                walk(d);
            } catch (e) { /* fall through to the team list */ }
            if (Object.keys(out).length >= 30) return out;
            const d2 = await getJson(SITE + '/teams?limit=40');
            const list = (((d2.sports || [])[0] || {}).leagues || [])[0];
            for (const t of (list && list.teams) || []) out[code(t.team.abbreviation)] = { id: String(t.team.id), espn: t.team.abbreviation, name: t.team.displayName };
            return out;
        });
    }

    // ── standings: record + division per team ────────────────────────
    function standings(season) {
        season = season || currentSeason();
        return cached('standings_' + season, async () => {
            // level=3 asks for the division tables; without it ESPN returns
            // conference-only tables and every team looks like a division rival.
            const d = await getJson(SITE_V2 + '/standings?season=' + season + '&level=3');
            const out = {};
            const walk = (node, division) => {
                if (node.standings && node.standings.entries) {
                    for (const e of node.standings.entries) {
                        const stat = (n) => { const s = (e.stats || []).find(x => x.name === n); return s ? num(s.value) : null; };
                        out[code(e.team.abbreviation)] = {
                            wins: stat('wins') || 0, losses: stat('losses') || 0, ties: stat('ties') || 0,
                            winPct: stat('winPercent'), pointDiff: stat('pointDifferential'), streak: stat('streak'),
                            division: division || node.name || '',
                        };
                    }
                    return;
                }
                for (const c of node.children || []) walk(c, node.isConference ? c.name : '');
            };
            walk(d, '');
            return out;
        });
    }

    // ── coaching: staff score per team ───────────────────────────────
    // experience → 40%  (12+ seasons is a full mark)
    // career regular-season win rate → 40%, shrunk toward .500 for short
    //   careers so a 6-2 rookie coach does not outrank a 15-year winner
    // playoff record → 20% (six career playoff wins is a full mark; a
    //   coach who has never made the playoffs gets a small base)
    function staffScore(experience, reg, po) {
        const exp = clamp((num(experience) || 0) / 12, 0, 1);
        const rw = reg.wins, rl = reg.losses;
        const rg = rw + rl;
        const shrunk = (rw + 8) / (rg + 16);          // .500 prior worth 16 games
        const winPart = clamp((shrunk - 0.3) / 0.4, 0, 1); // .300 → 0, .700 → 1
        const poGames = po.wins + po.losses;
        const poPart = poGames ? clamp(po.wins / 6, 0.15, 1) : 0.1;
        return +(exp * 0.4 + winPart * 0.4 + poPart * 0.2).toFixed(3);
    }
    function parseRecord(rec) {
        const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(String(rec && rec.summary || ''));
        return { wins: m ? Number(m[1]) : 0, losses: m ? Number(m[2]) : 0, ties: m ? Number(m[3] || 0) : 0 };
    }
    async function coachForTeam(season, teamId) {
        const list = await getJson(CORE + '/seasons/' + season + '/teams/' + teamId + '/coaches?lang=en&region=us');
        const ref = list.items && list.items[0] && list.items[0].$ref;
        if (!ref) return null;
        const seasonDoc = await follow(ref);
        const person = seasonDoc.person && seasonDoc.person.$ref ? await follow(seasonDoc.person.$ref) : seasonDoc;
        const recs = person.careerRecords || [];
        let reg = { wins: 0, losses: 0, ties: 0 }, po = { wins: 0, losses: 0, ties: 0 };
        for (const r of recs) {
            try {
                const doc = await follow(r.$ref);
                const name = String(doc.name || doc.type || '').toLowerCase();
                if (name.includes('post')) po = parseRecord(doc);
                else if (name.includes('regular')) reg = parseRecord(doc);
            } catch (e) { /* one missing record is fine */ }
        }
        const experience = num(person.experience != null ? person.experience : seasonDoc.experience) || 0;
        return {
            name: ((person.firstName || '') + ' ' + (person.lastName || '')).trim(),
            experience, regular: reg, playoffs: po,
            score: staffScore(experience, reg, po),
        };
    }
    // A team whose coach pages failed once (ESPN hiccup, a 429 on a phone)
    // used to be cached as "no coach" for four hours, which is how the Lab
    // showed no coaching for one player and full coaching for the next
    // (owner photo 2026-09-19). Now each team gets a second try, only a
    // complete league is cached for four hours, and a partial one is kept
    // in memory for ten minutes so the missing teams are retried soon.
    let _coachPartial = { season: null, ts: 0, data: null };
    async function coachWithRetry(season, id) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try { return await coachForTeam(season, id); }
            catch (e) { if (attempt === 2) return null; await new Promise(r => setTimeout(r, 400)); }
        }
        return null;
    }
    async function coaching(season) {
        season = season || currentSeason();
        // A cached map with holes (from before LAB54, or a tab that kept one)
        // is not a hit: rebuild the missing teams instead of trusting it.
        const hit = cacheGet('coaching_' + season);
        if (hit && Object.keys(hit).length >= 30 && Object.keys(hit).every(k => hit[k])) return hit;
        if (hit && !_coachPartial.data) _coachPartial = { season, ts: 0, data: hit };
        if (_coachPartial.data && _coachPartial.season === season && Date.now() - _coachPartial.ts < 10 * 60 * 1000) return _coachPartial.data;
        const T = await teams(season);
        const codes = Object.keys(T);
        const out = (_coachPartial.season === season && _coachPartial.data) ? Object.assign({}, _coachPartial.data) : {};
        const todo = codes.filter(c => !out[c]);
        // Three teams at a time keeps ESPN happy and the whole league under ~10s.
        for (let i = 0; i < todo.length; i += 3) {
            await Promise.all(todo.slice(i, i + 3).map(async c => { out[c] = await coachWithRetry(season, T[c].id); }));
        }
        const resolved = codes.filter(c => out[c]).length;
        if (resolved >= codes.length && codes.length >= 30) return cacheSet('coaching_' + season, out);
        _coachPartial = { season, ts: Date.now(), data: out };
        return out;
    }

    // ── schedules + head-to-head ─────────────────────────────────────
    function schedule(teamCode, season) {
        return cached('sched_' + season + '_' + teamCode, async () => {
            const T = await teams(season);
            const t = T[teamCode];
            if (!t) return [];
            const d = await getJson(SITE + '/teams/' + t.id + '/schedule?season=' + season);
            const out = [];
            for (const ev of d.events || []) {
                const comp = (ev.competitions || [])[0];
                if (!comp) continue;
                const me = (comp.competitors || []).find(x => code(x.team && x.team.abbreviation) === teamCode);
                const opp = (comp.competitors || []).find(x => x !== me);
                if (!me || !opp) continue;
                const myScore = me.score && typeof me.score === 'object' ? num(me.score.value) : num(me.score);
                const oppScore = opp.score && typeof opp.score === 'object' ? num(opp.score.value) : num(opp.score);
                const finished = !!(comp.status && comp.status.type && comp.status.type.completed) || (me.winner === true || opp.winner === true);
                const country = comp.venue && comp.venue.address && comp.venue.address.country;
                out.push({
                    season, week: ev.week && ev.week.number, date: ev.date,
                    opp: code(opp.team.abbreviation), home: me.homeAway === 'home', neutral: !!comp.neutralSite,
                    international: !!country && String(country).toUpperCase() !== 'USA',
                    finished, myScore, oppScore, won: finished ? me.winner === true : null,
                });
            }
            return out;
        });
    }

    // From `team`'s point of view: the last `max` finished meetings with `opp`.
    async function headToHead(team, opp, season, max) {
        season = season || currentSeason();
        max = max || H2H_MAX_GAMES;
        const [S, ...scheds] = await Promise.all([
            standings(season).catch(() => ({})),
            ...Array.from({ length: H2H_SEASONS }, (_, i) => schedule(team, season - i).catch(() => [])),
        ]);
        const games = scheds.flat().filter(g => g.opp === opp && g.finished && g.myScore != null && g.oppScore != null)
            .sort((a, b) => (b.season - a.season) || ((b.week || 0) - (a.week || 0)))
            .slice(0, max);
        const wins = games.filter(g => g.won).length;
        const margin = games.length ? games.reduce((s, g) => s + (g.myScore - g.oppScore), 0) / games.length : 0;
        const division = !!(S[team] && S[opp] && S[team].division && S[team].division === S[opp].division);
        return { games: games.length, wins, avgMargin: +margin.toFixed(1), division, meetings: games };
    }

    // The team's game for one week: home/away, neutral, overseas, opponent.
    async function gameFor(team, week, season) {
        season = season || currentSeason();
        const s = await schedule(team, season);
        return s.find(g => g.week === week) || null;
    }

    App.MatchupFeeds.espn = {
        teams, standings, coaching, schedule, headToHead, gameFor, staffScore, currentSeason,
        _cache: { get: cacheGet, set: cacheSet },
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.MatchupFeeds;
})(typeof window !== 'undefined' ? window : globalThis);
