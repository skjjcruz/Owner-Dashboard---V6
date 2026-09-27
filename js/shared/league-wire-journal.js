// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-journal.js — window.WrWireStories
// The Wire's newsroom (ported from C2, 2026-09-27; story rules unchanged).
// League journalism from SCORED Sleeper evidence, assembled by fixed rules —
// no AI, no randomness (headline variants rotate by week + roster id), no
// invented numbers. A week that fails inspect() (missing team, missing total,
// broken pairing) stops the edition there instead of being guessed.
// Owner identities (Sleeper user ids), never roster slots, connect seasons.
//   build({ weeks, start, end, nameFor, playerName, headToHead, league,
//           priorSeasons, archiveComplete, board, rivalries }) → edition
//   loadArchive({ league, signal, force, retry, onProgress, fetcher, now })
//     walks previous_league_id (≤25 seasons), verifies every regular-season
//     week of each COMPLETED season, persists it via WrWireArchiveCache
//     (IndexedDB) and reuses it on later visits. In-memory result: 6h when
//     complete, 60s when partial. Archive week fetches go straight to Sleeper
//     (explicit fetcher) so years of history never bloat App.Matchup's
//     in-memory current-season cache.
//   signature, inspect, bounds, oldName, frontPage, weeklyLookback.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const cache = new Map();
    const id = value => String(value);
    const points = row => root.App.LeagueLiveScores.rosterPoints(row);
    const fmt = n => Number(n).toFixed(2);
    const round = n => Math.round(n * 100) / 100;
    const signature = league => JSON.stringify([
        Object.entries(league.scoring_settings || {}).sort(([a], [b]) => a.localeCompare(b)),
        (league.roster_positions || []).filter(p => p !== 'BN' && p !== 'IR').slice().sort(),
    ]);
    const bounds = league => ({ start: Math.max(1, Number(league.settings?.start_week) || 1), end: Math.min(18, (Number(league.settings?.playoff_week_start) || 19) - 1) });
    const isH2H = league => !root.App?.Chopped?.isChopped?.(league) && league?.type !== 'chopped' && league?.leagueSkin?.type !== 'chopped';
    const owner = (league, rid) => league?.rosters?.find(r => id(r.roster_id) === id(rid))?.owner_id || null;
    function oldName(league, rid) {
        const roster = league.rosters?.find(r => id(r.roster_id) === id(rid));
        const user = league.users?.find(u => u.user_id === roster?.owner_id);
        return String(user?.metadata?.team_name || user?.display_name || user?.username || `Team ${rid}`).trim();
    }
    function inspect(rows, league) {
        if (!Array.isArray(rows) || !rows.length || rows.some(r => !r || r.roster_id == null || points(r) == null)) return null;
        const ids = new Set(rows.map(r => id(r.roster_id)));
        if (ids.size !== rows.length) return null;
        if (league?.rosters?.length && (rows.length !== league.rosters.length || league.rosters.some(r => !ids.has(id(r.roster_id))))) return null;
        const groups = new Map();
        rows.forEach(r => { if (r.matchup_id != null) { const k = id(r.matchup_id); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); } });
        if (isH2H(league) && [...groups.values()].some(g => g.length !== 2)) return null;
        return [...groups.values()].filter(g => g.length === 2);
    }
    function usableSaved(saved, previous, year) {
        try {
            if (saved?.league?.status !== 'complete' || id(saved.league.league_id) !== id(previous) || !(Number(saved.league.season) > 0 && Number(saved.league.season) < year)
                || !Object.prototype.hasOwnProperty.call(saved.league, 'previous_league_id') || !Array.isArray(saved.league.users) || !saved.league.rosters?.length) return false;
            const range = bounds(saved.league), weeks = new Map(saved.weeks.map(w => [Number(w.week), w.rows]));
            return range.end >= range.start && weeks.size === saved.weeks.length && Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i).every(w => inspect(weeks.get(w), saved.league));
        } catch (_) { return false; }
    }
    async function loadArchive({ league, signal, force = false, retry = false, onProgress = () => {}, fetcher = (...args) => root.fetch(...args), now = Date.now }) {
        const key = `${league.league_id || league.id}|${league.season}`;
        const cached = cache.get(key);
        if (!force && cached && !(retry && !cached.complete) && now() - cached.at < (cached.complete ? 6 * 3600000 : 60000)) { const reused = { ...cached, fromMemory: true }; onProgress(reused); return reused; }
        const seasons = [], seen = new Set([id(league.league_id || league.id)]);
        let savedCount = 0;
        const json = async path => {
            if (signal?.aborted) throw new Error('aborted');
            const response = await fetcher('https://api.sleeper.app/v1/league/' + path, { signal });
            if (!response.ok) throw new Error('unavailable');
            return response.json();
        };
        let complete = false, reason = '';
        try {
            const current = await json(encodeURIComponent(league.league_id || league.id));
            if (!current || !Object.prototype.hasOwnProperty.call(current, 'previous_league_id')) throw new Error('unavailable');
            let previous = current.previous_league_id, year = Number(league.season);
            while (previous && id(previous) !== '0') {
                if (seen.has(id(previous)) || seasons.length >= 25) { reason = 'The linked history ends before the archive can be verified in full.'; break; }
                seen.add(id(previous));
                const path = encodeURIComponent(previous);
                const saved = !force && await root.WrWireArchiveCache?.read(id(previous));
                if (signal?.aborted) throw new Error('aborted');
                if (usableSaved(saved, previous, year)) {
                    seasons.push(saved); savedCount++;
                    year = Number(saved.league.season); previous = saved.league.previous_league_id;
                    onProgress({ seasons: seasons.slice(), complete: false, savedCount, reason: 'Reading saved seasons…' });
                    continue;
                }
                const info = await json(path);
                if (!info || !Number.isFinite(Number(info.season)) || Number(info.season) >= year || !Object.prototype.hasOwnProperty.call(info, 'previous_league_id')) throw new Error('unavailable');
                const [rosters, users] = await Promise.all([json(path + '/rosters'), json(path + '/users')]);
                if (!Array.isArray(rosters) || !rosters.length || !Array.isArray(users)) throw new Error('unavailable');
                const historical = { ...info, league_id: id(previous), rosters, users };
                const range = bounds(historical);
                const result = await root.App.LeagueLiveTable.loadHistory({ league: historical, week: range.end + 1, signal, force, fetcher, now });
                const byWeek = new Map(result.priorWeeks.map(w => [Number(w.week), w.rows]));
                for (let w = range.start; w <= range.end; w++) if (!inspect(byWeek.get(w), historical)) throw new Error('unavailable');
                const verified = { league: historical, weeks: result.priorWeeks };
                seasons.push(verified);
                await root.WrWireArchiveCache?.write(verified);
                year = Number(info.season); previous = info.previous_league_id;
                onProgress({ seasons: seasons.slice(), complete: false, savedCount, reason: 'Loading earlier seasons…' });
            }
            complete = !previous || id(previous) === '0';
        } catch (_) {
            if (signal?.aborted) throw new Error('Archive loading was interrupted.');
            reason = 'Some linked seasons could not be verified. Records cover the loaded seasons only.';
        }
        const result = { seasons, complete, reason, savedCount, at: now() };
        cache.set(key, result);
        return result;
    }
    const choose = (variants, week, rid) => variants[(Number(week) + (Number(rid) || 0)) % variants.length];
    const recordText = t => `${t.wins}–${t.losses}${t.ties ? '–' + t.ties : ''}`;
    function ranked(stats) {
        const rows = [...stats.values()].map(t => ({ ...t })).sort((a, b) => (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pf - a.pf || id(a.rid).localeCompare(id(b.rid)));
        rows.forEach((r, i) => { const prev = rows[i - 1]; r.rank = prev && prev.wins + prev.ties / 2 === r.wins + r.ties / 2 && round(prev.pf) === round(r.pf) ? prev.rank : i + 1; });
        return rows;
    }
    // Front-page slots belong to distinct current stories, never archive facts.
    function frontPage(stories, limit = 5) {
        const subjects = new Set(), categories = new Set(), matchups = new Set(), texts = new Set();
        return stories.filter(s => !s.documentary).slice().sort((a, b) => (b.weight || 40) - (a.weight || 40)).filter(s => {
            const teamIds = (s.rosterIds || []).map(id);
            const pair = (s.preview || s.kind === 'recap') && s.rosterIds?.length === 2 ? s.rosterIds.map(id).sort().join(':') : null;
            const category = s.category || s.kind;
            if (texts.has(s.text) || teamIds.some(teamId => subjects.has(teamId)) || (pair && matchups.has(pair)) || categories.has(category)) return false;
            texts.add(s.text); categories.add(category);
            teamIds.forEach(teamId => subjects.add(teamId));
            if (pair) matchups.add(pair);
            return true;
        }).slice(0, limit);
    }
    function weeklyLookback(stories, editionKey) {
        const archive = stories.filter(s => s.documentary).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (!archive.length) return null;
        let hash = 0;
        for (const char of String(editionKey)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        return archive[hash % archive.length];
    }
    function build({ weeks = [], start = 1, end = 0, nameFor = rid => `Team ${rid}`, playerName = pid => `Player ${pid}`, headToHead = true, league = {}, priorSeasons = [], archiveComplete = false, board = null, rivalries = [] }) {
        const stories = [], records = [], games = [], stats = new Map(), runs = new Map(), scoreTotals = new Map();
        const season = String(league.season || '');
        const seasonSignature = signature(league);
        const previous = new Map(weeks.map(w => [Number(w.week), w.rows]));
        let high = null, marginRecord = null, completedThrough = start - 1;
        let archiveHigh = null, archiveMargin = null, historicalHigh = null;
        const historicalRecords = [];
        const archiveRecords = [], archiveMargins = [], careerWins = new Map();
        let rulesChanged = false;
        const comparableSeasons = [];
        const collectRecord = (value, holders, entry, current) => {
            if (current === null || value > current) holders.length = 0;
            if (current === null || value >= current) holders.push(entry);
            return current === null ? value : Math.max(current, value);
        };
        // Old names belong to their own season. Rivalries require actual owners.
        priorSeasons.slice().sort((a, b) => Number(a.league.season) - Number(b.league.season)).forEach(s => {
            const comparable = signature(s.league) === seasonSignature;
            rulesChanged ||= !comparable;
            if (comparable) comparableSeasons.push(String(s.league.season));
            for (const w of s.weeks) {
                const range = bounds(s.league);
                if (w.week < range.start || w.week > range.end) continue;
                const pairs = inspect(w.rows, s.league);
                if (!pairs) continue;
                w.rows.forEach(r => { historicalHigh = collectRecord(points(r), historicalRecords, { season: s.league.season, week: w.week, name: oldName(s.league, r.roster_id), points: points(r) }, historicalHigh); });
                if (comparable) w.rows.forEach(r => { archiveHigh = collectRecord(points(r), archiveRecords, { season: s.league.season, week: w.week, name: oldName(s.league, r.roster_id), points: points(r) }, archiveHigh); });
                if (!isH2H(s.league)) continue;
                pairs.forEach(([a, b]) => {
                    const oa = owner(s.league, a.roster_id), ob = owner(s.league, b.roster_id), gap = round(Math.abs(points(a) - points(b)));
                    const winner = points(a) > points(b) ? a : points(b) > points(a) ? b : null;
                    if (comparable && gap > 0) archiveMargin = collectRecord(gap, archiveMargins, { season: s.league.season, week: w.week, name: oldName(s.league, winner.roster_id), points: gap }, archiveMargin);
                    if (oa && ob && oa !== ob) games.push({ a: oa, b: ob, pa: points(a), pb: points(b), week: w.week, season: String(s.league.season) });
                    const winOwner = winner && owner(s.league, winner.roster_id);
                    if (winOwner) careerWins.set(winOwner, (careerWins.get(winOwner) || 0) + 1);
                });
            }
        });
        const priorHigh = archiveHigh;
        const series = (a, b) => games.filter(g => (g.a === a && g.b === b) || (g.a === b && g.b === a));
        let latestTable = [], previousTable = [];
        const seats = Number(league.settings?.playoff_teams) || 0;
        const lastReg = bounds(league).end;
        const simpleRace = headToHead && seats > 0 && Number(league.settings?.divisions || 0) < 2 && !league.settings?.playoff_seed_type;
        for (let week = start; week <= end; week++) {
            const rows = previous.get(week), pairs = inspect(rows, league);
            if (!pairs) break;
            completedThrough = week;
            const add = (kind, category, text, body, rosterIds = [], extra = {}) => {
                const story = { id: `${season}:${week}:${category}:${rosterIds.join(':')}:${stories.length}`, kind, category, week, season, label: `WK ${week} · ${category.toUpperCase()}`, text, body, rosterIds, ...extra };
                stories.push(story); return story;
            };
            rows.forEach(r => { if (!stats.has(id(r.roster_id))) stats.set(id(r.roster_id), { rid: r.roster_id, wins: 0, losses: 0, ties: 0, pf: 0 }); });
            previousTable = ranked(stats);
            const before = new Map(previousTable.map(t => [id(t.rid), t]));
            const sorted = rows.slice().sort((a, b) => points(b) - points(a)), best = points(sorted[0]);
            const top = sorted.filter(r => points(r) === best), winners = top.map(r => nameFor(r.roster_id)).join(' & ');
            if (high !== null && best >= high) add('record', 'Record book', `${best > high ? 'A new season scoring high' : 'Season scoring high matched'}: ${winners}`, `A ${fmt(best)}-point week ${best > high ? 'beats' : 'matches'} the previous season high of ${fmt(high)}.`, top.map(r => r.roster_id), { weight: 85, metric: fmt(best), metricLabel: 'fantasy points' });
            if (priorSeasons.length > 0 && archiveHigh !== null && best > archiveHigh) add('record', 'History made', `An archive scoring high for ${winners}`, `A ${fmt(best)}-point week beats the previous archived high of ${fmt(archiveHigh)}. ${archiveComplete && !rulesChanged ? 'Every linked season has been checked.' : 'Compared with loaded seasons using the same scoring and starting positions.'}`, top.map(r => r.roster_id), { weight: 100, metric: fmt(best), metricLabel: 'new archive high' });
            if (high === null || best >= high) {
                if (high === null || best > high) records.length = 0;
                top.forEach(r => records.push({ week, rosterId: r.roster_id, points: best })); high = best;
            }
            rows.forEach(r => { historicalHigh = collectRecord(points(r), historicalRecords, { season, week, name: nameFor(r.roster_id), points: points(r) }, historicalHigh); });
            rows.forEach(r => { archiveHigh = collectRecord(points(r), archiveRecords, { season, week, name: nameFor(r.roster_id), points: points(r) }, archiveHigh); });
            add('story', 'Scoring crown', choose([`Top of the scoring pile: ${winners}`, `The weekly scoring crown goes to ${winners}`, `The week belongs to ${winners}`], week, top[0].roster_id), `${top.length > 1 ? 'A share of the weekly crown' : 'The highest score of the week'}: ${fmt(best)} points in a ${rows.length}-team field.${top.length === 1 && sorted[1] ? ` That’s ${fmt(best - points(sorted[1]))} more than the next-best total.` : ''}`, top.map(r => r.roster_id), { weight: 45, metric: fmt(best), metricLabel: 'weekly high' });
            rows.forEach(r => {
                const rid = id(r.roster_id), old = scoreTotals.get(rid) || 0, total = round(old + points(r));
                scoreTotals.set(rid, total); stats.get(rid).pf = total;
                const milestone = Math.floor(total / 500) * 500;
                if (milestone >= 1000 && old < milestone) add('story', 'Milestone', `${nameFor(r.roster_id)} cross ${milestone.toLocaleString('en-US')} points`, `${fmt(total)} points scored through Week ${week}. This week's ${fmt(points(r))} pushed the season total over the line.`, [r.roster_id], { weight: 55, metric: milestone.toLocaleString('en-US'), metricLabel: 'season points passed' });
            });
            if (!headToHead) continue;
            const paired = new Set(), recaps = [];
            const margins = [];
            pairs.forEach(pair => {
                const [a, b] = pair.slice().sort((x, y) => points(y) - points(x));
                const ra = id(a.roster_id), rb = id(b.roster_id), oa = owner(league, a.roster_id), ob = owner(league, b.roster_id);
                paired.add(ra); paired.add(rb);
                const gap = round(points(a) - points(b)), runA = runs.get(ra) || 0, runB = runs.get(rb) || 0;
                const meetings = oa && ob ? series(oa, ob) : [];
                const last = meetings[meetings.length - 1];
                const revenge = gap > 0 && last && (last.a === oa ? last.pa < last.pb : last.pb < last.pa);
                margins.push({ a, b, gap });
                const starters = (a.starters || []).filter(pid => pid && id(pid) !== '0').map(pid => ({ pid, value: a.players_points?.[pid] })).filter(x => typeof x.value === 'number' && Number.isFinite(x.value)).sort((x, y) => y.value - x.value);
                const star = starters[0];
                const verb = gap <= 3 ? choose(['survive a thriller against', 'escape by a whisker against', 'edge past'], week, a.roster_id) : gap >= 40 ? choose(['leave no doubt against', 'run away from', 'roll past'], week, a.roster_id) : choose(['get past', 'take care of business against', 'outlast'], week, a.roster_id);
                const title = gap === 0 ? `${nameFor(a.roster_id)} and ${nameFor(b.roster_id)} finish level`
                    : runB >= 3 ? `${nameFor(a.roster_id)} end ${nameFor(b.roster_id)}’s ${runB}-game winning streak`
                    : runA <= -3 ? `${nameFor(a.roster_id)} stop the slide against ${nameFor(b.roster_id)}`
                    : `${nameFor(a.roster_id)} ${verb} ${nameFor(b.roster_id)}`;
                const recap = add('recap', revenge ? 'Revenge game' : gap > 0 && gap <= 3 ? 'Down to the wire' : 'Game recap', title,
                    `${gap === 0 ? `Nothing between them: ${fmt(points(a))} points apiece.` : `${nameFor(a.roster_id)} beat ${nameFor(b.roster_id)}, ${fmt(points(a))}–${fmt(points(b))}, ${gap <= 3 ? 'with just' : 'finishing'} ${fmt(gap)} points ${gap <= 3 ? 'to spare' : 'clear'}.`}${star && gap > 0 ? ` ${playerName(star.pid)} led the way with ${fmt(star.value)} points from the starting lineup.` : ''}`,
                    [a.roster_id, b.roster_id], { featuredPid: gap > 0 ? star?.pid : null, weight: revenge ? 83 : gap > 0 && gap <= 3 ? 78 : 35, matchup: [{ name: nameFor(a.roster_id), score: points(a), rid: a.roster_id }, { name: nameFor(b.roster_id), score: points(b), rid: b.roster_id }], related: [] });
                recaps.push({ recap, a, b, gap });
                if (last) recap.related.push({ label: 'Last meeting', text: `${last.season} · Week ${last.week}: ${nameFor(a.roster_id)} ${fmt(last.a === oa ? last.pa : last.pb)}–${fmt(last.a === oa ? last.pb : last.pa)} ${nameFor(b.roster_id)}.` });
                if (revenge) recap.related.push({ label: 'A reversal', text: `${nameFor(b.roster_id)} won the previous recorded meeting. This result reverses that outcome.` });
                if (gap > 0 && runB >= 3) add('story', 'Streak snapped', `${nameFor(a.roster_id)} bring the streak to a halt`, `${nameFor(b.roster_id)} had won ${runB} straight head-to-head games. A ${fmt(gap)}-point defeat ends that run.`, [a.roster_id, b.roster_id], { weight: 88 });
                if (gap > 0 && runA <= -3) add('story', 'Back in business', `${nameFor(a.roster_id)} stop the slide`, `After ${Math.abs(runA)} straight head-to-head losses, a ${fmt(points(a))}-point week brings a win over ${nameFor(b.roster_id)}.`, [a.roster_id], { weight: 72 });
                [a, b].forEach(r => {
                    const rid = id(r.roster_id), win = gap > 0 && r === a, currentRun = runs.get(rid) || 0, t = stats.get(rid);
                    if (gap === 0) { t.ties++; runs.set(rid, 0); }
                    else { t[win ? 'wins' : 'losses']++; runs.set(rid, win ? Math.max(0, currentRun) + 1 : Math.min(0, currentRun) - 1); }
                    if (runs.get(rid) >= 3) add('story', 'On a roll', `${nameFor(r.roster_id)} make it ${runs.get(rid)} straight`, `${choose(['The run keeps growing.', 'Another week, another win.', 'Nobody has slowed this run yet.'], week, r.roster_id)} The latest head-to-head win came against ${nameFor(b.roster_id)}.`, [r.roster_id], { weight: 65, metric: String(runs.get(rid)), metricLabel: 'straight wins' });
                });
                if (gap > 0 && sorted.filter(r => points(r) > points(b)).length < Math.floor(rows.length / 2)) add('story', 'Hard luck', choose([`No justice for ${nameFor(b.roster_id)}`, `${nameFor(b.roster_id)} get the cruel draw`, `${nameFor(b.roster_id)} score big and still come up short`], week, b.roster_id), `${fmt(points(b))} points landed in the top half of the league, but ${nameFor(a.roster_id)} still handed them a loss. A strong week met the wrong opponent.`, [b.roster_id], { weight: 57 });
                if (oa && ob && oa !== ob) games.push({ a: oa, b: ob, pa: points(a), pb: points(b), week, season });
                if (gap > 0 && oa) {
                    const wins = (careerWins.get(oa) || 0) + 1; careerWins.set(oa, wins);
                    if ([10, 25, 50, 75, 100, 150, 200].includes(wins) && archiveComplete) add('story', 'Career milestone', `${nameFor(a.roster_id)} reach win No. ${wins}`, `${wins} regular-season head-to-head wins across this owner's linked league history. ${nameFor(b.roster_id)} were the opponent for the milestone.`, [a.roster_id], { weight: 90, metric: String(wins), metricLabel: 'career wins' });
                }
            });
            for (const rid of runs.keys()) if (!paired.has(rid)) runs.delete(rid);
            if (Number(league.settings?.league_average_match) === 1) {
                const scores = rows.map(points).sort((a, b) => a - b), mid = Math.floor(scores.length / 2), median = scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
                rows.forEach(r => stats.get(id(r.roster_id))[points(r) > median ? 'wins' : points(r) < median ? 'losses' : 'ties']++);
            }
            latestTable = ranked(stats);
            const after = new Map(latestTable.map(t => [id(t.rid), t]));
            recaps.forEach(({ recap, a, b, gap }) => {
                const ta = after.get(id(a.roster_id)), tb = after.get(id(b.roster_id));
                const standings = `Through Week ${week}, ${nameFor(a.roster_id)} are ${recordText(ta)} and ${nameFor(b.roster_id)} are ${recordText(tb)}${Number(league.settings?.league_average_match) === 1 ? ', including median results' : ''}.`;
                const run = runs.get(id(a.roster_id));
                const momentum = gap > 0 && run >= 3 ? ` That makes ${run} straight head-to-head wins for ${nameFor(a.roster_id)}.` : '';
                recap.body += `\n\n${standings}${momentum}`;
                recap.related.push({ label: 'What it means', text: standings + momentum });
                if (week > start && simpleRace && seats < latestTable.length) {
                    [ta, tb].forEach(t => {
                        const was = before.get(id(t.rid));
                        const movedIn = was.rank > seats && t.rank <= seats, movedOut = was.rank <= seats && t.rank > seats;
                        if ((movedIn || movedOut) && !latestTable.some(other => other.rid !== t.rid && other.rank === t.rank)) recap.related.push({ label: 'Playoff race', text: `${nameFor(t.rid)} ${movedIn ? 'move into' : 'drop outside'} the top ${seats} in the record-and-points table, from No. ${was.rank} to No. ${t.rank}. This is a race snapshot, not a clinch or official seed.` });
                    });
                }
            });
            if (week > start && latestTable.length > 1 && latestTable[0].rank !== latestTable[1].rank && before.get(id(latestTable[0].rid))?.rank > 1) {
                const leader = latestTable[0];
                add('story', 'Power shift', `A new No. 1: ${nameFor(leader.rid)}`, `A ${recordText(leader)} record and ${fmt(leader.pf)} points through Week ${week} put ${nameFor(leader.rid)} on top of The Wire’s standings, up from No. ${before.get(id(leader.rid)).rank} last week.`, [leader.rid], { weight: 82, related: [{ label: 'How we rank teams', text: `The Wire ranks completed results by record, then points scored${Number(league.settings?.league_average_match) === 1 ? ', including median results' : ''}. Your league’s official seeds may differ because of division or tiebreak rules.` }] });
            }
            const biggest = margins.slice().sort((a, b) => b.gap - a.gap)[0];
            if (biggest && biggest.gap > 0) {
                if (marginRecord !== null && biggest.gap > marginRecord) add('record', 'Record book', `${nameFor(biggest.a.roster_id)} set the season's biggest winning margin`, `A ${fmt(biggest.gap)}-point victory over ${nameFor(biggest.b.roster_id)} beats the previous mark of ${fmt(marginRecord)}.`, [biggest.a.roster_id], { weight: 80, metric: fmt(biggest.gap), metricLabel: 'point margin' });
                marginRecord = Math.max(marginRecord || 0, biggest.gap);
                margins.filter(m => m.gap > 0).forEach(m => { archiveMargin = collectRecord(m.gap, archiveMargins, { season, week, name: nameFor(m.a.roster_id), points: m.gap }, archiveMargin); });
            }
            if (simpleRace && seats < latestTable.length && week >= Math.max(start + 1, lastReg - 5)) {
                const inside = latestTable[seats - 1], outside = latestTable[seats], remaining = Math.max(0, lastReg - week), separation = round((inside.wins + inside.ties / 2) - (outside.wins + outside.ties / 2));
                add('story', 'Playoff race', separation === 0 ? 'The cutline has no breathing room' : `${nameFor(inside.rid)} and ${nameFor(outside.rid)} frame the cutline`, `${nameFor(inside.rid)} (${recordText(inside)}) sit at No. ${inside.rank}; ${nameFor(outside.rid)} (${recordText(outside)}) at No. ${outside.rank}. ${separation === 0 ? 'Their records are level; compare points for and the league tiebreak rules.' : `${separation} result${separation === 1 ? '' : 's'} separate them.`} ${remaining} regular-season week${remaining === 1 ? '' : 's'} remain. Official seeding and tiebreak rules still apply.`, [inside.rid, outside.rid], { weight: 75 });
            }
        }
        // Selections add editorial priority, not invented head-to-head history.
        const previews = [], rivals = [], followed = new Map();
        const pairKey = (a, b) => [String(a), String(b)].sort().join(':');
        if (headToHead) rivalries.forEach(r => {
            if (!Array.isArray(r.owners) || r.owners.length !== 2 || r.owners[0] === r.owners[1]) return;
            const rosters = r.owners.map(o => league.rosters?.find(t => t.owner_id && id(t.owner_id) === id(o)));
            if (rosters.some(r => !r)) return;
            followed.set(pairKey(...r.owners), { ...r, name: String(r.name || '').trim().slice(0, 60), rosters });
        });
        const context = selection => ({ label: 'Rivalry you follow', text: selection.name ? `You named this rivalry “${selection.name}”. Results below come from recorded regular-season meetings.` : 'You selected these teams as a rivalry to follow. Results below come from recorded regular-season meetings.' });
        stories.filter(s => s.kind === 'recap').forEach(s => {
            const selection = followed.get(pairKey(...s.rosterIds.map(rid => owner(league, rid))));
            if (!selection) return;
            s.followedRivalry = true; s.category = 'Rivalry watch'; s.label = `WK ${s.week} · RIVALRY RECAP`; s.weight = 84;
            s.related = [...(s.related || []), context(selection)];
            if (selection.name) s.text = `${selection.name}: ${s.text}`;
        });
        const nowRows = board?.rows || [], nowPairs = new Map();
        nowRows.forEach(r => { if (r.matchup_id != null) { const k = id(r.matchup_id); if (!nowPairs.has(k)) nowPairs.set(k, []); nowPairs.get(k).push(r); } });
        // Current stakes do not depend on an archive or a shared owner history.
        // Records stop at the last completed week, even if this week's games are live.
        const currentMatchup = (a, b) => {
            if (id(a.roster_id) === id(b.roster_id) || completedThrough !== end || Number(board?.week) !== completedThrough + 1 || Number(board.week) > lastReg || completedThrough < start) return null;
            const ta = latestTable.find(t => id(t.rid) === id(a.roster_id)), tb = latestTable.find(t => id(t.rid) === id(b.roster_id));
            if (!ta || !tb) return null;
            const na = nameFor(a.roster_id), nb = nameFor(b.roster_id), count = completedThrough - start + 1;
            const runA = runs.get(id(a.roster_id)) || 0, runB = runs.get(id(b.roster_id)) || 0;
            const unbeaten = t => t.wins > 0 && t.losses === 0 && t.ties === 0;
            const highRank = Math.max(2, Math.ceil(latestTable.length / 4));
            let text = `${na} (${recordText(ta)}) meet ${nb} (${recordText(tb)})`, weight = 48, stakes = '';
            if (unbeaten(ta) && unbeaten(tb)) {
                text = `Unbeaten starts meet: ${na} vs. ${nb}`; weight = 80;
                stakes = 'Neither team has a loss on the board.';
            } else if (runA >= 3 && runB >= 3) {
                text = `Two winning streaks, one matchup: ${na} vs. ${nb}`; weight = 79;
                stakes = `${na} have won ${runA} straight head-to-head games; ${nb} have won ${runB}.`;
            } else if (ta.rank <= highRank && tb.rank <= highRank) {
                text = `${na} vs. ${nb}: a test near the top`; weight = 77;
                stakes = ta.rank === tb.rank ? `They are tied at No. ${ta.rank} in The Wire’s standings.` : `They hold the No. ${ta.rank} and No. ${tb.rank} spots in The Wire’s standings.`;
            } else if (Math.min(runA, runB) <= -3) {
                const struggler = runA <= runB ? na : nb, opponent = runA <= runB ? nb : na;
                text = `${struggler} look for a reset against ${opponent}`; weight = 62;
                stakes = `${struggler} have lost ${Math.abs(Math.min(runA, runB))} straight head-to-head games.`;
            }
            const recordScope = Number(league.settings?.league_average_match) === 1 ? ', including median results' : '';
            return { id: `matchup:${season}:${board.week}:${a.roster_id}:${b.roster_id}`, kind: 'story', category: 'Matchup preview', label: `WK ${board.week} · MATCHUP PREVIEW`,
                text, body: `Through Week ${completedThrough}, ${na} are ${recordText(ta)} and ${nb} are ${recordText(tb)}${recordScope}.${stakes ? ` ${stakes}` : ''}\n\nAcross ${count} completed week${count === 1 ? '' : 's'}, ${na} average ${fmt(ta.pf / count)} points and ${nb} average ${fmt(tb.pf / count)}.`,
                week: Number(board.week), season, rosterIds: [a.roster_id, b.roster_id], weight, preview: true, formThrough: completedThrough,
                related: [{ label: 'Current form', text: `Records and scoring averages use completed results through Week ${completedThrough}. These are season averages, not projected scores. The Wire ranks by record, then points; official seeds may differ.` }] };
        };
        const addRival = (a, b, selection, scheduled) => {
            const oa = owner(league, a.roster_id), ob = owner(league, b.roster_id);
            if (!oa || !ob || oa === ob) return;
            const meetings = series(oa, ob);
            if (!meetings.length && !selection) return;
            const winsA = meetings.filter(g => g.a === oa ? g.pa > g.pb : g.pb > g.pa).length;
            const winsB = meetings.filter(g => g.a === ob ? g.pa > g.pb : g.pb > g.pa).length;
            const ties = meetings.length - winsA - winsB, last = meetings[meetings.length - 1];
            const rival = { a: nameFor(a.roster_id), b: nameFor(b.roster_id), winsA, winsB, ties, meetings: meetings.length, rosterIds: [a.roster_id, b.roster_id], followed: !!selection, name: selection?.name || '', scheduled };
            rivals.push(rival);
            if (!scheduled || !(Number(board.week) > completedThrough && Number(board.week) <= lastReg)) return;
            const lastMargin = last ? Math.abs(last.pa - last.pb) : null;
            const previewTitle = !last ? `${rival.a} vs. ${rival.b}: a rivalry to follow`
                : winsA === winsB ? `${rival.a} and ${rival.b}: break the deadlock`
                : lastMargin <= 3 ? `${rival.a} and ${rival.b} meet again after a thriller`
                : meetings.length === 1 ? `${winsA < winsB ? rival.a : rival.b} get another shot at ${winsA < winsB ? rival.b : rival.a}`
                : Math.abs(winsA - winsB) >= 3 ? `${winsA < winsB ? rival.a : rival.b} have a score to settle`
                : choose([`${rival.a} vs. ${rival.b}: the next chapter`, `${rival.a} and ${rival.b} renew their rivalry`, `Familiar opponents. Fresh stakes. ${rival.a} vs. ${rival.b}`], board.week, a.roster_id);
            const history = last ? `${rival.a} ${winsA === winsB ? 'are level at' : winsA > winsB ? 'lead the recorded series' : 'trail the recorded series'} ${winsA}–${winsB}${ties ? '–' + ties : ''} across ${meetings.length} regular-season meeting${meetings.length === 1 ? '' : 's'}. Last time: ${fmt(last.a === oa ? last.pa : last.pb)}–${fmt(last.a === oa ? last.pb : last.pa)} in ${last.season}, Week ${last.week}.` : 'No completed regular-season meetings are available in the loaded history yet.';
            const current = currentMatchup(a, b);
            previews.push({ id: `preview:${season}:${board.week}:${a.roster_id}`, kind: 'story', category: 'Rivalry watch', label: `WK ${board.week} · RIVALRY WATCH`, text: selection?.name ? `${selection.name}: ${rival.a} vs. ${rival.b}` : current && current.weight >= 77 ? current.text : previewTitle,
                body: current ? `${current.body.split('\n\n')[0]}\n\n${history}` : `${selection ? `One of the rivalries you follow is on the Week ${board.week} schedule. ` : ''}${history}`,
                week: Number(board.week), season, rosterIds: rival.rosterIds, weight: selection ? 84 : Math.max(70, current?.weight || 0), preview: true, followedRivalry: !!selection,
                ...(current ? { formThrough: current.formThrough } : {}), related: [...(selection ? [context(selection)] : []), ...(current?.related || []), ...(current ? [{ label: 'Scoring form', text: current.body.split('\n\n')[1] }] : [])],
                ...(last ? { metric: `${winsA}–${winsB}`, metricLabel: `recorded series · ${rival.a} / ${rival.b}` } : {}) });
        };
        if (headToHead) nowPairs.forEach(pair => {
            if (pair.length !== 2) return;
            const [a, b] = pair;
            const count = previews.length;
            addRival(a, b, followed.get(pairKey(owner(league, a.roster_id), owner(league, b.roster_id))), true);
            if (previews.length === count) {
                const current = currentMatchup(a, b);
                if (current) previews.push(current);
            }
        });
        followed.forEach(selection => {
            if (!rivals.some(r => pairKey(...r.rosterIds.map(rid => owner(league, rid))) === pairKey(...selection.owners))) addRival(...selection.rosters, selection, false);
        });
        // A newcomer check-in needs a verified preceding season and current results.
        const preceding = priorSeasons.find(s => Number(s.league.season) === Number(season) - 1);
        if (headToHead && archiveComplete && preceding?.league.rosters?.length && completedThrough === end && end >= start && end <= start + 3) {
            const previousOwners = new Set(preceding.league.rosters.map(r => r.owner_id).filter(Boolean).map(id));
            const arrivals = latestTable.filter(t => owner(league, t.rid) && !previousOwners.has(id(owner(league, t.rid))));
            if (arrivals.length) {
                const names = arrivals.map(t => nameFor(t.rid));
                stories.push({ id: `newcomers:${season}:${end}`, kind: 'story', category: 'New faces', label: `WK ${end} · NEW FACES`, season, week: end,
                    text: arrivals.length === 1 ? `Checking in on ${names[0]}` : 'New faces, first impressions',
                    body: `${names.join(', ')} ${arrivals.length === 1 ? 'wasn’t' : 'weren’t'} on last season’s manager list. Through Week ${end}: ${arrivals.map(t => `${nameFor(t.rid)} at ${recordText(t)}`).join('; ')}. ${arrivals.length === 1 ? 'A new chapter in the league is underway.' : 'The new arrivals are starting to put their stamp on this season.'}`,
                    rosterIds: arrivals.map(t => t.rid), weight: 74,
                    related: [{ label: 'Manager continuity', text: `Compared verified owner accounts with the ${Number(season) - 1} league roster. A new team name alone does not count as a new manager. This does not claim these are first-ever appearances in the league.` }],
                });
            }
        }
        const result = { stories: stories.reverse(), previews, rivals, records, high, priorHigh, marginRecord, table: latestTable, completedThrough,
            archive: { historicalHigh, historicalRecords, allSeasons: [...new Set([...priorSeasons.map(s => String(s.league.season)), ...(completedThrough >= start ? [season] : [])])].sort(), high: archiveHigh, margin: archiveMargin, records: archiveRecords, margins: archiveMargins, complete: archiveComplete, rulesChanged, seasons: [...new Set([...comparableSeasons, ...(completedThrough >= start ? [season] : [])])].sort(), priorCount: priorSeasons.length } };
        const enriched = root.WrWireChronicles?.enrich(result, { league, board: headToHead ? board : null, end, nameFor }) || result;
        return root.WrWireGraphics?.enrich(enriched, { league, weeks, start, end, priorSeasons, archiveComplete, nameFor }) || enriched;
    }
    root.WrWireStories = { build, loadArchive, signature, inspect, bounds, oldName, frontPage, weeklyLookback };
})(typeof window !== 'undefined' ? window : globalThis);
