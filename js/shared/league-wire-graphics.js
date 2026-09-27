// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-graphics.js — window.WrWireGraphics (ported from C2,
// 2026-09-27). Attaches a structured `broadcast` comparison (records, H2H
// series, title games) to recaps, previews and rivalries for Wire Studio.
// A view of verified results, never generated prose: nothing is inferred
// from headline text, possibly-live board points never become results, and
// cross-season series need two distinct verified owner accounts.
// Dynasty HQ change: title games come only from WrWireChronicles books built
// from Sleeper's playoff brackets (classification 'sleeper'); C2's
// hand-entered chronicle facts are not supported.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const str = value => String(value);
    const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const round = value => Math.round(value * 100) / 100;
    const record = value => value ? `${value.wins}–${value.losses}${value.ties ? `–${value.ties}` : ''}` : null;
    const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
    const isH2H = league => !root.App?.Chopped?.isChopped?.(league) && league?.type !== 'chopped' && league?.leagueSkin?.type !== 'chopped';
    const ownerOf = (league, rid) => {
        const roster = (league.rosters || []).find(r => str(r.roster_id) === str(rid));
        return roster?.owner_id ? str(roster.owner_id) : null;
    };
    const matchSource = (league, week) => {
        const leagueId = league.league_id || league.id;
        return leagueId ? [{ label: `Sleeper ${league.season} · Week ${week}`, url: `https://api.sleeper.app/v1/league/${encodeURIComponent(leagueId)}/matchups/${week}` }] : [];
    };
    function enrich(edition, { league, weeks = [], start = 1, end = 0, priorSeasons = [], archiveComplete = false, nameFor = rid => `Team ${rid}` }) {
        const journal = root.WrWireStories, scores = root.App?.LeagueLiveScores;
        if (!journal?.inspect || !scores?.rosterPoints) return edition;
        const year = Number(league.season), lastRegular = journal.bounds(league).end;
        const points = row => number(scores.rosterPoints(row));
        const currentWeeks = new Map(weeks.map(w => [Number(w.week), w.rows]));
        const currentOwners = (league.rosters || []).map(r => r.owner_id && str(r.owner_id)).filter(Boolean);
        const knownOwner = owner => owner && currentOwners.filter(id => id === owner).length === 1;
        const finals = (root.WrWireChronicles?.select(league)?.facts || []).filter(f => f.type === 'final' && f.classification === 'sleeper' && Number(f.season) < year);
        const pairKey = owners => owners.slice().sort().join(':');
        // Archive loading publishes repeatedly. Validate and index old games
        // once per edition rather than scanning every season for every card.
        const historicalByPair = new Map();
        priorSeasons.filter(entry => Number(entry.league?.season) < year && isH2H(entry.league)).forEach(entry => {
            const range = journal.bounds(entry.league), counts = new Map();
            (entry.league.rosters || []).forEach(r => { if (r.owner_id) { const owner = str(r.owner_id); counts.set(owner, (counts.get(owner) || 0) + 1); } });
            (entry.weeks || []).filter(w => Number(w.week) >= range.start && Number(w.week) <= range.end).forEach(w => {
                const pairs = journal.inspect(w.rows, entry.league);
                if (!pairs || (journal.played && !journal.played(w.rows))) return;
                pairs.forEach(pair => {
                    const owners = pair.map(r => ownerOf(entry.league, r.roster_id));
                    if (owners.some(owner => !owner || counts.get(owner) !== 1) || owners[0] === owners[1]) return;
                    const key = pairKey(owners);
                    if (!historicalByPair.has(key)) historicalByPair.set(key, []);
                    historicalByPair.get(key).push({ entry: { league: entry.league, week: Number(w.week) }, pair });
                });
            });
        });
        const statsCache = new Map();
        const statsThrough = cutoff => {
            if (statsCache.has(cutoff)) return statsCache.get(cutoff);
            const teams = new Map(), verified = [];
            let through = start - 1;
            if (isH2H(league)) for (let week = start; week <= Math.min(cutoff, lastRegular); week++) {
                const rows = currentWeeks.get(week), pairs = journal.inspect(rows, league);
                if (!pairs || (journal.played && !journal.played(rows))) break; // unplayed weeks are not results (review B1)
                through = week; verified.push({ league, week, rows, pairs });
                rows.forEach(row => {
                    const rid = str(row.roster_id);
                    if (!teams.has(rid)) teams.set(rid, { wins: 0, losses: 0, ties: 0, h2h: { wins: 0, losses: 0, ties: 0 }, pf: 0, weeks: 0 });
                    const team = teams.get(rid); team.pf = round(team.pf + points(row)); team.weeks++;
                });
                pairs.forEach(([a, b]) => [a, b].forEach((row, index) => {
                    const team = teams.get(str(row.roster_id)), difference = points(row) - points(index === 0 ? b : a);
                    const outcome = difference > 0 ? 'wins' : difference < 0 ? 'losses' : 'ties';
                    team[outcome]++; team.h2h[outcome]++;
                }));
                if (Number(league.settings?.league_average_match) === 1) {
                    const totals = rows.map(points).sort((a, b) => a - b), half = Math.floor(totals.length / 2);
                    const median = totals.length % 2 ? totals[half] : (totals[half - 1] + totals[half]) / 2;
                    rows.forEach(row => teams.get(str(row.roster_id))[points(row) > median ? 'wins' : points(row) < median ? 'losses' : 'ties']++);
                }
            }
            const result = { teams, through, verified }; statsCache.set(cutoff, result); return result;
        };
        const regularMeeting = (entry, pair, owners, ids) => {
            const ordered = owners ? owners.map(owner => pair.find(row => ownerOf(entry.league, row.roster_id) === owner)) : ids.map(id => pair.find(row => str(row.roster_id) === str(id)));
            if (ordered.some(row => !row)) return null;
            const names = ordered.map(row => str(entry.league.season) === str(league.season) ? nameFor(row.roster_id) : journal.oldName(entry.league, row.roster_id));
            const values = ordered.map(points);
            if (values.some(value => value === null)) return null;
            return { id: `regular:${entry.league.league_id || entry.league.id || entry.league.season}:${entry.week}:${ordered.map(r => r.roster_id).join(':')}`,
                label: `${entry.league.season} · Week ${entry.week}`, season: Number(entry.league.season), week: entry.week, points: values, names,
                winnerIndex: values[0] === values[1] ? null : values[0] > values[1] ? 0 : 1,
                caption: 'Regular-season head-to-head result. Scores use that season’s rules.', sources: matchSource(entry.league, entry.week) };
        };
        const makeSeries = (id, label, scope, meetings) => {
            const wins = [0, 0]; let ties = 0;
            meetings.forEach(meeting => { if (meeting.winnerIndex === 0 || meeting.winnerIndex === 1) wins[meeting.winnerIndex]++; else if (meeting.points[0] !== null && meeting.points[0] === meeting.points[1]) ties++; });
            return { id, label, scope, wins, ties, meetings };
        };
        const championshipSeries = (owners, cutoff, selectedFacts) => {
            const usable = selectedFacts || finals.filter(f => Number(f.season) <= cutoff && f.owners?.length === 2 && owners.every(owner => owner && f.owners.map(str).includes(owner)));
            const meetings = usable.slice().sort((a, b) => Number(a.season) - Number(b.season)).map(f => {
                const reverse = owners?.[0] && str(f.owners?.[1]) === owners[0];
                const values = [number(f.scores?.[0]), number(f.scores?.[1])], names = [f.winner, f.loser];
                return { id: f.id, label: `${f.season} championship`, season: Number(f.season), week: null,
                    points: reverse ? values.reverse() : values, names: reverse ? names.reverse() : names, winnerIndex: reverse ? 1 : 0,
                    caption: `${f.winner} won the ${f.season} championship${f.scores ? '. Original-season scoring' : ' (final score not stored here — open Bracket for the verified result)'}.`, sources: (f.sources || []).slice() };
            });
            return meetings.length ? makeSeries('championships', 'Championship meetings', 'Sleeper playoff brackets · separate from the regular season', meetings) : null;
        };
        const attach = (story, profile = false) => {
            const documentary = !!story.documentary;
            let teams, owners, cutoff, form, championship, selectedFacts;
            const notes = [], series = [];
            if (documentary) {
                // Fact IDs identify the exact historical episode; never infer
                // participants or dates from a headline or a reused team name.
                const factIds = str(story.id).startsWith('chronicle:') ? str(story.id).slice(10).split(':') : [];
                selectedFacts = finals.filter(f => factIds.includes(f.id));
                if (!selectedFacts.length || selectedFacts.some(f => !f.winner || !f.loser)) return story;
                const latest = selectedFacts.slice().sort((a, b) => Number(b.season) - Number(a.season))[0];
                owners = [latest.owners?.[0] ? str(latest.owners[0]) : null, latest.owners?.[1] ? str(latest.owners[1]) : null];
                if (owners[0] && owners[0] === owners[1]) return story;
                if (selectedFacts.length > 1 && (!owners.every(Boolean) || owners[0] === owners[1] || selectedFacts.some(f => f.owners?.length !== 2 || !owners.every(owner => f.owners.map(str).includes(owner))))) return story;
                cutoff = Math.min(Number(story.eventSeason), Number(latest.season));
                if (!Number.isFinite(cutoff) || cutoff >= year) return story;
                teams = [latest.winner, latest.loser].map((name, index) => ({ name, ownerId: owners[index], record: null, h2hRecord: null, average: null }));
                championship = championshipSeries(owners, cutoff, owners.every(Boolean) && owners[0] !== owners[1] ? null : selectedFacts.filter(f => Number(f.season) <= cutoff));
                notes.push('Historical feature: names and scores belong to the seasons shown. These finals do not change regular-season records.');
            } else {
                const ids = story.rosterIds || [];
                if ((!profile && !story.preview && story.kind !== 'recap') || ids.length !== 2 || str(ids[0]) === str(ids[1]) || !isH2H(league) || str(story.season) !== str(league.season)) return story;
                if (ids.some(id => !(league.rosters || []).some(r => str(r.roster_id) === str(id)))) return story;
                const requested = Math.min(Number(end), Number(edition.completedThrough), profile ? Number(edition.completedThrough) : story.preview ? Number(story.week) - 1 : Number(story.week));
                if (!Number.isFinite(requested)) return story;
                form = statsThrough(requested); cutoff = form.through;
                if (!profile && !story.preview && (Number(story.week) > cutoff || Number(story.week) > lastRegular)) return story;
                owners = ids.map(id => ownerOf(league, id));
                const linked = owners.every(knownOwner) && owners[0] !== owners[1];
                teams = ids.map((id, index) => {
                    const team = form.teams.get(str(id));
                    return { name: nameFor(id), ownerId: owners[index], record: record(team), h2hRecord: team && team.h2h.wins + team.h2h.losses + team.h2h.ties > 0 ? record(team.h2h) : null, average: team?.weeks ? round(team.pf / team.weeks) : null };
                });
                const meetings = [];
                const addMeetings = entry => entry.pairs.forEach(pair => {
                    const meeting = regularMeeting(entry, pair, linked ? owners : null, ids);
                    if (meeting) meetings.push(meeting);
                });
                if (linked) (historicalByPair.get(pairKey(owners)) || []).forEach(({ entry, pair }) => {
                    const meeting = regularMeeting(entry, pair, owners, ids);
                    if (meeting) meetings.push(meeting);
                });
                form.verified.forEach(addMeetings);
                const ordered = [...new Map(meetings.map(meeting => [meeting.id, meeting])).values()].sort((a, b) => a.season - b.season || a.week - b.week);
                if (!profile && !story.preview) {
                    const result = ordered.find(meeting => meeting.season === year && meeting.week === Number(story.week));
                    if (!result) return story;
                    series.push(makeSeries('result', 'This result', `${year} · Week ${story.week} · head-to-head`, [result]));
                }
                if (ordered.length) series.push(makeSeries('regular-season', 'Regular-season series', `${archiveComplete && linked ? 'Verified linked seasons' : 'Loaded results only'} · head-to-head, excluding median games`, ordered));
                if (linked) championship = championshipSeries(owners, year - 1);
                if (!archiveComplete) notes.push('The regular-season series covers loaded results only; earlier meetings may be missing.');
                if (!linked) notes.push('Cross-season comparisons require two distinct verified owner accounts. Only this season’s roster matchups are shown.');
                if (cutoff < requested) notes.push(`Current form stops at Week ${cutoff}; a later completed week could not be verified.`);
                if (!form.verified.length) notes.push('No completed current-season results are available for the record or scoring average.');
                notes.push('Scoring averages describe completed weeks; they are not projections. Historical scores retain their original scoring rules.');
            }
            if (championship) series.push(championship);
            if (documentary && !series.length) return story;
            const sources = unique([...series.flatMap(item => item.meetings.flatMap(meeting => meeting.sources)), ...(form?.verified || []).flatMap(entry => matchSource(entry.league, entry.week))]);
            const playoffSeasons = unique((championship?.meetings || []).flatMap(meeting => meeting.sources.flatMap(source => {
                const match = typeof source.url === 'string' && source.url.match(/^https:\/\/api\.sleeper\.app\/v1\/league\/(\d+)\/(?:winners_bracket|matchups\/\d+)$/);
                return match ? [{ league_id: match[1], season: meeting.season }] : [];
            }))).sort((a, b) => b.season - a.season);
            return { ...story, broadcast: { kind: 'comparison', headline: story.text, eyebrow: documentary ? 'From the championship archive' : profile ? 'Rivalry profile' : story.preview ? 'The matchup file' : 'Inside the result',
                teams, recordScope: documentary ? 'Historical championship results' : Number(league.settings?.league_average_match) === 1 ? 'Season record includes head-to-head and median results' : 'Season record is head-to-head',
                season: documentary ? cutoff : year, throughWeek: documentary || cutoff < start ? null : cutoff, series, notes, sources, playoffSeasons } };
        };
        return { ...edition, stories: (edition.stories || []).map(story => attach(story)), previews: (edition.previews || []).map(story => attach(story)),
            rivals: (edition.rivals || []).map(rival => {
                const graphic = attach({ rosterIds: rival.rosterIds, season: league.season, text: rival.name || `${rival.a} vs. ${rival.b}` }, true).broadcast;
                return graphic ? { ...rival, broadcast: graphic } : rival;
            }) };
    }
    root.WrWireGraphics = { enrich };
})(typeof window !== 'undefined' ? window : globalThis);
