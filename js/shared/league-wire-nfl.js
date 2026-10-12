// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-nfl.js — window.WrWireNfl
// The Wire's NFL desk sources (Dynasty HQ addition, 2026-09-27).
//
// Why not App.NflContext.loadScoreboard alone: on deployed pages that goes
// through our nfl-scoreboard relay, which caches ESPN for up to 3 hours — a
// game in progress would show a score hours old under a "live" label. C2 read
// it unlabelled. The Wire instead:
//   1. reads ESPN's public scoreboard DIRECTLY (site.api.espn.com is in the
//      CSP connect-src and answers with Access-Control-Allow-Origin: *;
//      ESPN's own cache is ~8s). Parsed with App.NflContext.parseScores so
//      the game shape is identical. Result is labelled source 'espn' with
//      the time we checked it.
//   2. if that fails (offline, blocked, ESPN down) falls back to the relay,
//      but then keeps ONLY what cannot be stale: finished games' final
//      scores and kickoff times. In-progress games lose their score and
//      leaders (marked liveUnavailable) — the desk says "live score
//      unavailable" rather than showing an hours-old number.
// Cached 50s per (season, type, week) so the desk's one-minute refresh is
// one request per week shown; a week whose games are all final is kept 6h;
// failures are never cached.
//
//   loadScoreboard(week, season, seasontype) → Promise<{ games, source:
//     'espn'|'relay', checkedAt, completionVerified }>  (rejects only if both
//     sources fail)
//   liveWeekStats(season, week, type) → Promise<{ stats, at }> — fresh
//     Sleeper stats for the week in progress (55s memory cache).
//   weekStats(season, week, type) → Promise<{pid: stats}> — Sleeper weekly
//     NFL stats. Regular season reuses App.SOS.getWeekStats (session
//     cached); preseason/postseason fetch Sleeper's /stats/nfl/{pre|post}
//     directly, because our SOS helper only knows the regular season and
//     would return regular-season numbers under a "PRE"/"POST" label.
//
// Merged from C2's NFL desk engine (1be683d, 2026-10-12). C2 shipped a
// DIFFERENT module under this same window name; its functions are merged in
// here, never swapped in, so the NFL tab and every caller above keep working:
//   loadWeek({ phase, signal, force }) → { games, completionVerified,
//     checkedAt, source } — the same ESPN-direct read (and cache) as
//     loadScoreboard. completionVerified is true only when the RAW ESPN
//     response is scoped to that exact season/week/phase and every event is
//     a proper final (C2's strict check). A relay copy never verifies a week.
//     The Wire's calendar uses it to publish the edition once the NFL week
//     is over (js/shared/league-wire-calendar.js).
//   recap(game, box?) → { headline, body, spotlight[] } — headline from the
//     final score; body is a quarter story ONLY when the quarter lines add up
//     to the final; spotlight from the opened box score, else ESPN's game
//     leaders already on the scoreboard. Nothing is inferred.
//   loadBoxScore({ game, signal, force }) → per-game player box, fetched only
//     when a reader opens it. Sleeper first (api.sleeper.app/stats/nfl/…,
//     rows carry team/opponent/date/game_id), else ESPN's public game summary
//     read DIRECTLY (site.api.espn.com/…/summary?event=). C2's fallback went
//     through the relay with event=<id>, which our relay does not support;
//     neither path here touches the relay. Both fail → the desk says so.
//   parseSleeper / parseSummary / completedSchedule — exported for tests.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const TTL = 50000;
    const FINAL_TTL = 6 * 3600000;
    const LIVE_TTL = 55000;
    const liveCache = new Map();
    const cache = new Map();
    const statsCache = new Map();
    const boxCache = new Map();
    const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
    const ESPN_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

    function timed(url, ms) {
        const Ctl = root.AbortController;
        const controller = Ctl ? new Ctl() : null;
        const timer = controller ? root.setTimeout(() => controller.abort(), ms) : null;
        return root.fetch(url, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) })
            .finally(() => { if (timer !== null) root.clearTimeout(timer); });
    }
    function parse(data) {
        const NC = root.App?.NflContext;
        if (!data || !Array.isArray(data.events) || !NC?.parseScores) throw new Error('Invalid NFL scoreboard');
        return NC.parseScores(data);
    }
    // Relay copy: only what a 3-hour-old snapshot can still say truthfully.
    function relaySafe(game) {
        if (game.completed) return game;
        if (game.state === 'in' || game.state === 'post') {
            return { ...game, homeScore: null, awayScore: null, homePeriods: [], awayPeriods: [], leaders: [], shortDetail: 'In progress', liveUnavailable: true, completed: false, state: 'in' };
        }
        return game;
    }

    // ── C2's strict "is this NFL week finished" check (verbatim rules) ──
    const num = value => value == null || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    const text = value => typeof value === 'string' ? value.trim() : '';
    const abbr = value => ({ WSH: 'WAS', JAC: 'JAX', LA: 'LAR' }[String(value || '').toUpperCase()] || String(value || '').toUpperCase());
    // A readable score list is not necessarily a complete weekly schedule.
    // Validate the raw response before allowing it to advance an edition;
    // parseScores intentionally omits malformed events for the display path.
    function completedSchedule(data, phase, games) {
        const scalar = value => typeof value === 'string' || typeof value === 'number';
        const number = value => scalar(value) ? num(value) : null;
        const scoped = value => number(value?.season?.year) === Number(phase.season) && number(value?.season?.type) === Number(phase.seasontype) && number(value?.week?.number) === Number(phase.week);
        if (!scoped(data) || !Array.isArray(data.events) || !data.events.length || !Array.isArray(games) || games.length !== data.events.length) return false;
        const eventIds = new Set(), teamIds = new Set(), teams = new Set();
        const validTeams = new Set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' '));
        const final = status => status?.type?.completed === true && status.type.state === 'post' && /^STATUS_FINAL(?:_|$)/.test(status.type.name || '');
        return data.events.every((event, index) => {
            const eventId = String(event?.id || '');
            if (!scoped(event) || !scalar(event?.id) || !/^\d{6,12}$/.test(eventId) || eventIds.has(eventId) || !Array.isArray(event.competitions) || event.competitions.length !== 1) return false;
            eventIds.add(eventId);
            const competition = event.competitions[0], competitors = competition?.competitors;
            if (!scalar(competition?.id) || String(competition.id) !== eventId || !Array.isArray(competitors) || competitors.length !== 2 || !final(competition.status || event.status)) return false;
            if ((competition.status && !final(competition.status)) || (event.status && !final(event.status))) return false;
            if (!Number.isFinite(Date.parse(competition.date || event.date || ''))) return false;
            const home = competitors.filter(team => team?.homeAway === 'home'), away = competitors.filter(team => team?.homeAway === 'away');
            if (home.length !== 1 || away.length !== 1) return false;
            const game = games[index];
            if (!game || String(game.id) !== eventId || !game.completed || game.state !== 'post') return false;
            return [home[0], away[0]].every((team, i) => {
                const teamId = String(team.team?.id || ''), name = abbr(team.team?.abbreviation), score = number(team.score);
                if (!scalar(team.team?.id) || !scalar(team.id) || !/^\d+$/.test(teamId) || String(team.id) !== teamId || teamIds.has(teamId) || typeof team.team.abbreviation !== 'string' || !validTeams.has(name) || teams.has(name) || score == null || !Number.isInteger(score) || score < 0) return false;
                teamIds.add(teamId); teams.add(name);
                return game[i ? 'away' : 'home'] === name && game[i ? 'awayScore' : 'homeScore'] === score;
            });
        });
    }

    function loadScoreboard(week, season, seasontype, { force = false } = {}) {
        const type = Number(seasontype) || 2;
        const key = (season || '') + '|' + type + '|' + week;
        const hit = cache.get(key);
        if (!force && hit && Date.now() - hit.at < (hit.ttl || TTL)) return hit.promise;
        const direct = ESPN + '?week=' + encodeURIComponent(week) + '&seasontype=' + type + (season ? '&dates=' + encodeURIComponent(season) : '');
        const phase = { season, week, seasontype: type };
        const promise = timed(direct, 12000)
            .then(r => { if (!r.ok) throw new Error('ESPN ' + r.status); return r.json(); })
            .then(data => { const games = parse(data); return { games, source: 'espn', checkedAt: Date.now(), completionVerified: completedSchedule(data, phase, games) }; })
            .catch(() => {
                const NC = root.App?.NflContext;
                if (!NC?.loadScoreboard) throw new Error('NFL scores unavailable');
                // A relay copy can be hours old: it never verifies a finished week.
                return NC.loadScoreboard(week, season, type).then(games => ({ games: games.map(relaySafe), source: 'relay', checkedAt: Date.now(), completionVerified: false }));
            })
            .catch(error => { if (cache.get(key) === entry) cache.delete(key); throw error; });
        const entry = { at: Date.now(), promise, ttl: TTL };
        // A week whose games are ALL final never changes again (review S5):
        // keep it for hours instead of re-downloading it every minute.
        promise.then(res => { if (res.games.length && res.games.every(g => g.completed)) entry.ttl = FINAL_TTL; }, () => {});
        cache.delete(key);
        cache.set(key, entry);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        return promise;
    }
    const abortError = () => { const error = new Error('Request canceled.'); error.name = 'AbortError'; return error; };
    const aborted = signal => { if (signal?.aborted) throw abortError(); };
    // C2's loadWeek signature, on OUR ESPN-direct loader and its cache.
    async function loadWeek({ phase, signal, force = false } = {}) {
        const season = String(phase?.season || ''), week = Number(phase?.week), type = Number(phase?.seasontype);
        if (!/^\d{4}$/.test(season) || !Number.isInteger(week) || week < 1 || week > 22 || ![1, 2, 3].includes(type)) throw new Error('The current NFL week could not be verified.');
        aborted(signal);
        const result = await loadScoreboard(week, season, type, { force });
        aborted(signal);
        return { status: 'ready', games: result.games, completionVerified: result.completionVerified === true, checkedAt: result.checkedAt, updatedAt: null, source: result.source };
    }

    function weekStats(season, week, type) {
        const kind = type === 'pre' || type === 'post' ? type : 'regular';
        if (kind === 'regular') {
            const SOS = root.App?.SOS;
            return SOS?.getWeekStats ? Promise.resolve(SOS.getWeekStats(season, week)) : Promise.resolve({});
        }
        const key = season + '|' + kind + '|' + week;
        if (statsCache.has(key)) return statsCache.get(key);
        const promise = timed('https://api.sleeper.app/v1/stats/nfl/' + kind + '/' + encodeURIComponent(season) + '/' + encodeURIComponent(week), 15000)
            .then(r => { if (!r.ok) throw new Error('stats ' + r.status); return r.json(); }).then(d => d || {})
            .catch(() => { statsCache.delete(key); return {}; });
        statsCache.set(key, promise);
        if (statsCache.size > 6) statsCache.delete(statsCache.keys().next().value);
        return promise;
    }
    // The IN-PROGRESS week (review S4): App.SOS caches a week for 24h in
    // sessionStorage, which would freeze Sunday's numbers at whenever they were
    // first read. Fresh Sleeper stats instead (≤1 request/55s per week, in
    // memory only), returned with the time they were read so callers can say
    // "as of". App.SOS itself is untouched for its other callers.
    function liveWeekStats(season, week, type) {
        const kind = type === 'pre' || type === 'post' ? type : 'regular';
        const key = season + '|' + kind + '|' + week;
        const hit = liveCache.get(key);
        if (hit && Date.now() - hit.at < LIVE_TTL) return hit.promise;
        const at = Date.now();
        const promise = timed('https://api.sleeper.app/v1/stats/nfl/' + kind + '/' + encodeURIComponent(season) + '/' + encodeURIComponent(week), 15000)
            .then(r => { if (!r.ok) throw new Error('stats ' + r.status); return r.json(); })
            .then(d => ({ stats: d || {}, at }))
            .catch(error => { liveCache.delete(key); throw error; });
        liveCache.set(key, { at, promise });
        if (liveCache.size > 4) liveCache.delete(liveCache.keys().next().value);
        return promise;
    }

    // ── Box scores (C2, adapted): fetched only on an explicit reader action ──
    // One request per URL; a Sleeper weekly file serves every game that week.
    // Kept 60s while the game is on, 30 min once final; at most 3 entries (a
    // weekly Sleeper file is ~2 MB). Cancelled or failed reads are not cached.
    async function request(url, { signal, force = false, now = Date.now, ttl = 60000 } = {}) {
        aborted(signal);
        const saved = boxCache.get(url);
        if (!force && saved && now() - saved.checkedAt < ttl) return saved;
        const Ctl = root.AbortController, controller = Ctl ? new Ctl() : null;
        let timeout = false;
        const cancel = () => controller?.abort();
        signal?.addEventListener?.('abort', cancel, { once: true });
        const timer = root.setTimeout(() => { timeout = true; controller?.abort(); }, 18000);
        try {
            const response = await root.fetch(url, { ...(controller ? { signal: controller.signal } : {}), credentials: 'omit', cache: 'no-store' });
            aborted(signal);
            if (!response.ok) throw new Error(response.status === 429 ? 'NFL coverage is busy. Try again shortly.' : 'The latest NFL data could not load.');
            const data = await response.json();
            aborted(signal);
            if (!data || data.error) throw new Error('The latest NFL data could not load.');
            const result = { data, checkedAt: now() };
            boxCache.delete(url);
            boxCache.set(url, result);
            while (boxCache.size > 3) boxCache.delete(boxCache.keys().next().value);
            return result;
        } catch (error) {
            aborted(signal);
            if (timeout) throw new Error('NFL coverage took too long to load. Try again.');
            throw error;
        } finally { root.clearTimeout(timer); signal?.removeEventListener?.('abort', cancel); }
    }
    const categories = { passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', fumbles: 'Fumbles', defensive: 'Defense', interceptions: 'Interceptions', kickReturns: 'Kick returns', puntReturns: 'Punt returns', kicking: 'Kicking', punting: 'Punting' };
    function parseSummary(data, game) {
        const event = String(game?.id || ''), competition = data?.header?.competitions?.[0];
        if (!/^\d{6,12}$/.test(event) || String(data?.header?.id) !== event || !competition) throw new Error('Full player stats are unavailable from this feed. The scoring summary remains available.');
        const competitors = competition.competitors || [];
        const home = competitors.find(t => t.homeAway === 'home'), away = competitors.find(t => t.homeAway === 'away');
        if (!home || !away || abbr(home.team?.abbreviation) !== abbr(game.home) || abbr(away.team?.abbreviation) !== abbr(game.away)) throw new Error('The returned box score does not match this game.');
        const validTeams = new Map(competitors.map(t => [String(t.team?.id || t.id), t]));
        const seenTeams = new Set();
        const teams = (data.boxscore?.players || []).filter(t => validTeams.has(String(t.team?.id))).map(t => {
            const id = String(t.team.id);
            if (seenTeams.has(id)) throw new Error('The player box score contains duplicate teams.');
            seenTeams.add(id);
            const original = validTeams.get(id);
            const groups = (t.statistics || []).filter(s => categories[s.name] && Array.isArray(s.keys) && s.keys.length && new Set(s.keys).size === s.keys.length).map(s => ({
                id: s.name, label: categories[s.name], columns: s.keys.map((key, i) => ({ key, label: text(s.labels?.[i]) || key, description: text(s.descriptions?.[i]) || text(s.labels?.[i]) || key })),
                players: (s.athletes || []).filter(a => text(a.athlete?.displayName) && Array.isArray(a.stats)).map(a => ({ id: String(a.athlete.id || a.athlete.displayName), name: a.athlete.displayName,
                    values: s.keys.map((key, i) => a.stats[i] == null || String(a.stats[i]).trim() === '' ? null : String(a.stats[i])),
                    stats: Object.fromEntries(s.keys.map((key, i) => [key, a.stats[i] == null ? null : String(a.stats[i])])) })),
            }));
            return { id, name: original.team.displayName || original.team.abbreviation, abbr: abbr(original.team.abbreviation), groups };
        }).sort((a, b) => (a.abbr === abbr(game.away) ? -1 : b.abbr === abbr(game.away) ? 1 : 0));
        const status = competition.status?.type || {};
        const summaryGame = { id: event, home: abbr(home.team.abbreviation), away: abbr(away.team.abbreviation), homeName: home.team.displayName, awayName: away.team.displayName,
            homeScore: num(home.score), awayScore: num(away.score), completed: !!status.completed, state: status.state, shortDetail: status.shortDetail };
        const statNames = ['firstDowns', 'totalYards', 'netPassingYards', 'rushingYards', 'turnovers', 'thirdDownEff', 'fourthDownEff', 'possessionTime'];
        const teamStats = (data.boxscore?.teams || []).filter(t => validTeams.has(String(t.team?.id))).map(t => ({ abbr: abbr(validTeams.get(String(t.team.id)).team.abbreviation), stats: (t.statistics || []).filter(s => statNames.includes(s.name)).map(s => ({ key: s.name, label: text(s.label) || s.name, value: s.displayValue == null ? null : String(s.displayValue) })) }));
        return { eventId: event, game: summaryGame, teams, teamStats, statsSource: 'ESPN', status: teams.some(t => t.groups.some(g => g.players.length)) ? 'ready' : 'empty', source: 'https://www.espn.com/nfl/boxscore/_/gameId/' + event };
    }
    const sleeperColumns = {
        passing: [['pass_cmp', 'CMP', 'Completions'], ['pass_att', 'ATT', 'Pass attempts'], ['pass_yd', 'YDS', 'Passing yards', 'passingYards'], ['pass_td', 'TD', 'Passing touchdowns', 'passingTouchdowns'], ['pass_int', 'INT', 'Interceptions'], ['pass_sack', 'SACK', 'Times sacked']],
        rushing: [['rush_att', 'CAR', 'Carries', 'rushingAttempts'], ['rush_yd', 'YDS', 'Rushing yards', 'rushingYards'], ['rush_td', 'TD', 'Rushing touchdowns', 'rushingTouchdowns'], ['rush_lng', 'LONG', 'Longest rush']],
        receiving: [['rec', 'REC', 'Receptions', 'receptions'], ['rec_tgt', 'TGTS', 'Receiving targets', 'receivingTargets'], ['rec_yd', 'YDS', 'Receiving yards', 'receivingYards'], ['rec_td', 'TD', 'Receiving touchdowns', 'receivingTouchdowns'], ['rec_lng', 'LONG', 'Longest reception']],
        fumbles: [['fum', 'FUM', 'Fumbles'], ['fum_lost', 'LOST', 'Fumbles lost']],
        defensive: [['idp_tkl_solo', 'SOLO', 'Solo tackles'], ['idp_tkl_ast', 'AST', 'Assisted tackles'], ['idp_sack', 'SACK', 'Sacks'], ['idp_int', 'INT', 'Interceptions'], ['idp_pass_def', 'PD', 'Passes defended'], ['idp_def_td', 'TD', 'Defensive touchdowns']],
        kicking: [['fgm', 'FGM', 'Field goals made'], ['fga', 'FGA', 'Field goals attempted'], ['fgm_lng', 'LONG', 'Longest field goal'], ['xpm', 'XPM', 'Extra points made'], ['xpa', 'XPA', 'Extra points attempted']],
    };
    const PHASES = { 1: 'pre', 2: 'regular', 3: 'post' };
    function parseSleeper(rows, game) {
        const year = String(game.season || ''), week = Number(game.week), phase = PHASES[game.seasontype];
        if (!Array.isArray(rows) || !/^\d{4}$/.test(year) || !Number.isInteger(week) || !phase || !Number.isFinite(Date.parse(game.kickoff || ''))) throw new Error('This game’s player-stat edition could not be verified.');
        const kickoff = new Date(game.kickoff), dates = new Set([kickoff.toISOString().slice(0, 10), new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(kickoff)]);
        const home = abbr(game.home), away = abbr(game.away);
        const matching = rows.filter(r => String(r.season) === year && Number(r.week) === week && r.season_type === phase && r.category === 'stat' && dates.has(r.date)
            && ((abbr(r.team) === home && abbr(r.opponent) === away) || (abbr(r.team) === away && abbr(r.opponent) === home)));
        const gameIds = new Set(matching.map(r => String(r.game_id || '')).filter(Boolean));
        if (gameIds.size !== 1 || matching.some(r => !r.game_id) || ![home, away].every(team => matching.some(r => abbr(r.team) === team))) throw new Error('The player stats could not be matched to both teams and this game date.');
        const teams = [{ id: away, abbr: away, name: game.awayName || away }, { id: home, abbr: home, name: game.homeName || home }].map(team => {
            const unique = new Map();
            matching.filter(r => abbr(r.team) === team.abbr && /^\d+$/.test(String(r.player_id || '')) && r.player?.position !== 'DEF' && r.stats && (r.player?.first_name || r.player?.last_name)).forEach(r => {
                if (unique.has(String(r.player_id)) && JSON.stringify(unique.get(String(r.player_id)).stats) !== JSON.stringify(r.stats)) throw new Error('Conflicting player stat rows could not be verified.');
                unique.set(String(r.player_id), r);
            });
            const groups = Object.entries(sleeperColumns).map(([id, columns]) => ({ id, label: categories[id], columns: columns.map(([key, label, description, canonical]) => ({ key: canonical || key, label, description })),
                players: [...unique.values()].filter(r => columns.some(([key]) => num(r.stats[key]) != null)).map(r => ({ id: String(r.player_id), name: [r.player.first_name, r.player.last_name].filter(Boolean).join(' '),
                    values: columns.map(([key]) => num(r.stats[key]) == null ? null : String(r.stats[key])), stats: Object.fromEntries(columns.map(([key, , , canonical]) => [canonical || key, num(r.stats[key]) == null ? null : String(r.stats[key])])) })).sort((a, b) => {
                    const rankKey = ({ passing: 'passingYards', rushing: 'rushingYards', receiving: 'receivingYards', fumbles: 'fum', defensive: 'idp_tkl_solo', kicking: 'fgm' })[id];
                    return (num(b.stats[rankKey]) || 0) - (num(a.stats[rankKey]) || 0) || a.name.localeCompare(b.name);
                }),
            }));
            return { ...team, groups };
        });
        return { eventId: String(game.id), providerGameId: [...gameIds][0], game: { ...game }, teams, teamStats: [], statsSource: 'Sleeper',
            status: teams.some(t => t.groups.some(g => g.players.length)) ? 'ready' : 'empty', source: 'https://api.sleeper.app/stats/nfl/' + year + '/' + week + '?season_type=' + phase };
    }
    async function loadBoxScore({ game, signal, force = false, now = Date.now } = {}) {
        if (!/^\d{6,12}$/.test(String(game?.id || ''))) throw new Error('A verified game ID is needed to open player stats.');
        const phase = PHASES[game.seasontype];
        const ttl = game.completed ? 30 * 60000 : 60000;
        if (/^\d{4}$/.test(String(game.season)) && Number.isInteger(Number(game.week)) && Number(game.week) > 0 && Number(game.week) <= 22 && phase) {
            try {
                const result = await request('https://api.sleeper.app/stats/nfl/' + game.season + '/' + Number(game.week) + '?season_type=' + phase, { signal, force, now, ttl });
                return { ...parseSleeper(result.data, game), checkedAt: result.checkedAt, updatedAt: null };
            } catch (_) { aborted(signal); /* ESPN's public game summary is the alternate source. */ }
        }
        try {
            const result = await request(ESPN_SUMMARY + '?event=' + encodeURIComponent(game.id), { signal, force, now, ttl });
            return { ...parseSummary(result.data, game), checkedAt: result.checkedAt, updatedAt: null };
        } catch (_) {
            aborted(signal);
            throw new Error('Player stats for this game are unavailable right now. Try again later.');
        }
    }

    // ── Game stories (C2): only what the numbers say ──
    function quarterContext(game) {
        const home = game.homePeriods || [], away = game.awayPeriods || [];
        if (!game.completed || home.length < 4 || home.length !== away.length) return '';
        const valid = rows => rows.every((p, i) => p.period === i + 1 && num(p.value) != null && num(p.value) >= 0);
        if (!valid(home) || !valid(away) || home.reduce((n, p) => n + Number(p.value), 0) !== num(game.homeScore) || away.reduce((n, p) => n + Number(p.value), 0) !== num(game.awayScore) || game.homeScore === game.awayScore) return '';
        const winnerHome = Number(game.homeScore) > Number(game.awayScore), w = winnerHome ? home : away, l = winnerHome ? away : home;
        const name = winnerHome ? game.homeName || game.home : game.awayName || game.away;
        const opponent = winnerHome ? game.awayName || game.away : game.homeName || game.home;
        const sum = (rows, end) => rows.slice(0, end).reduce((n, p) => n + Number(p.value), 0);
        if (sum(w, 3) < sum(l, 3)) return `${name} erased a ${sum(l, 3) - sum(w, 3)}-point deficit after three quarters.`;
        if (sum(w, 2) < sum(l, 2)) return `${name} trailed ${sum(l, 2)}–${sum(w, 2)} at halftime, then outscored ${opponent} ${sum(w, w.length) - sum(w, 2)}–${sum(l, l.length) - sum(l, 2)} the rest of the way.`;
        const secondW = sum(w, w.length) - sum(w, 2), secondL = sum(l, l.length) - sum(l, 2);
        if (secondW - secondL >= 10) return `${name} outscored ${opponent} ${secondW}–${secondL} after halftime.`;
        const decisive = w.map((p, i) => ({ period: i + 1, own: Number(p.value), opp: Number(l[i].value) })).filter(p => p.period <= 4 && p.own >= 14 && p.own - p.opp >= 10).sort((a, b) => (b.own - b.opp) - (a.own - a.opp))[0];
        return decisive ? `${name} outscored ${opponent} ${decisive.own}–${decisive.opp} in the ${['first', 'second', 'third', 'fourth'][decisive.period - 1]} quarter.` : '';
    }
    function performances(box) {
        const out = [];
        (box?.teams || []).forEach(team => team.groups.filter(g => ['passing', 'rushing', 'receiving'].includes(g.id)).forEach(group => group.players.forEach(player => {
            const s = player.stats, passing = group.id === 'passing', rushing = group.id === 'rushing';
            const yards = num(s[passing ? 'passingYards' : rushing ? 'rushingYards' : 'receivingYards']);
            if (yards == null) return;
            const touchdowns = num(s[passing ? 'passingTouchdowns' : rushing ? 'rushingTouchdowns' : 'receivingTouchdowns']);
            const catches = num(s.receptions), attempts = num(s.rushingAttempts), targets = num(s.receivingTargets);
            let line = passing ? `${player.name} threw for ${yards} yards` : rushing ? `${player.name} ran for ${yards} yards` : catches != null ? `${player.name} caught ${catches} pass${catches === 1 ? '' : 'es'} for ${yards} yards` : `${player.name} had ${yards} receiving yards`;
            if (touchdowns > 0) line += ` and ${touchdowns} touchdown${touchdowns === 1 ? '' : 's'}`;
            if (rushing && attempts != null) line += ` on ${attempts} carr${attempts === 1 ? 'y' : 'ies'}`;
            if (!passing && !rushing && targets != null) line += ` on ${targets} target${targets === 1 ? '' : 's'}`;
            out.push({ id: player.id, team: team.abbr, text: line + '.', weight: (touchdowns || 0) * 80 + yards / (passing ? 3 : 1) });
        })));
        return out.sort((a, b) => b.weight - a.weight);
    }
    function recap(game, box) {
        const h = num(game?.homeScore), a = num(game?.awayScore), final = !!game?.completed && h != null && a != null;
        if (!final) return { headline: game?.state === 'in' ? 'In progress' : '', body: '', spotlight: [] };
        const winnerHome = h > a, winner = winnerHome ? game.homeName || game.home : game.awayName || game.away, loser = winnerHome ? game.awayName || game.away : game.homeName || game.home;
        const headline = h === a ? `${game.away} and ${game.home} finish in a ${h}–${a} tie` : `${winner} ${Math.abs(h - a) <= 3 ? 'edge' : 'beat'} ${loser}, ${Math.max(h, a)}–${Math.min(h, a)}${/OT/i.test(game.shortDetail || '') ? ' in overtime' : ''}`;
        // A box from a different score snapshot never enriches this result.
        const compatible = box?.game?.completed && box.game.homeScore === h && box.game.awayScore === a;
        const candidates = compatible ? performances(box) : [];
        const seen = new Set();
        const spotlight = candidates.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; }).slice(0, 2).map(p => p.text);
        if (!spotlight.length) {
            const leader = (game.leaders || []).find(l => l.name && l.stats && l.category === 'Receiving') || (game.leaders || []).find(l => l.name && l.stats);
            if (leader) spotlight.push(`${leader.name}: ${leader.stats}${leader.team ? ` (${leader.team})` : ''}.`);
        }
        return { headline, body: quarterContext(game), spotlight };
    }

    root.WrWireNfl = { loadScoreboard, weekStats, liveWeekStats, relaySafe, loadWeek, completedSchedule, loadBoxScore, parseSummary, parseSleeper, recap };
})(typeof window !== 'undefined' ? window : globalThis);
