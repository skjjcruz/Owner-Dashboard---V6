// Run with:  node --test js/shared/league-wire-playoffs.test.js
// Ported from C2 tests/league-wire-playoffs.cjs (2026-09-27), unchanged.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
test('C2 Wire playoffs: verified bracket, byes, original scores, ties, multiweek fallback, scoped cache, conservative race', async () => {
    function makeApi() {
        const root = { console }; root.window = root;
        vm.createContext(root);
        vm.runInContext(fs.readFileSync(path.join(__dirname, 'league-wire-playoffs.js'), 'utf8'), root);
        return root.WrWirePlayoffs;
    }
    const plain = value => JSON.parse(JSON.stringify(value));
    const fixture = (id = '123456789', season = '2025') => {
        const rosters = Array.from({ length: 6 }, (_, i) => ({ roster_id: i + 1, owner_id: 'owner-' + (i + 1) }));
        const users = rosters.map(r => ({ user_id: r.owner_id, display_name: 'account-' + r.roster_id, metadata: { team_name: 'Team ' + r.roster_id } }));
        const info = { league_id: id, name: 'League ' + id, season, sport: 'nfl', status: 'complete', settings: { playoff_teams: 6, playoff_week_start: 15, playoff_round_type: 0 }, rosters, users };
        const bracket = [
            { m: 1, r: 1, t1: 3, t2: 6, w: 6, l: 3 }, { m: 2, r: 1, t1: 4, t2: 5, w: 4, l: 5 },
            { m: 3, r: 2, t1: 1, t2: 4, w: 1, l: 4 }, { m: 4, r: 2, t1: 2, t2: 6, w: 2, l: 6 },
            { m: 5, r: 2, p: 5, t1: 3, t2: 5, w: 3, l: 5 },
            { m: 6, r: 3, p: 1, t1: 1, t2: 2, w: 1, l: 2, t1_from: { w: 3 }, t2_from: { w: 4 } },
            { m: 7, r: 3, p: 3, t1: 4, t2: 6, w: 6, l: 4, t1_from: { l: 3 }, t2_from: { l: 4 } },
        ];
        const row = (roster_id, matchup_id, points, custom_points = null) => ({ roster_id, matchup_id, points, custom_points });
        const weeks = {
            15: [row(1, null, 172.55), row(2, null, 147.27), row(3, 1, 90), row(6, 1, 100), row(4, 2, 99), row(5, 2, 88)],
            16: [row(1, 1, 134.98), row(4, 1, 102.57), row(2, 2, 151.13), row(6, 2, 110.98), row(3, 3, 100), row(5, 3, 90)],
            17: [row(1, 1, 133.37), row(2, 1, 92.40), row(4, 2, 90), row(6, 2, 100)],
        };
        const calls = [], calendar = { season: '2026', season_type: 'regular', week: 3 };
        const fetcher = async (url, options) => {
            calls.push({ url, options });
            if (url.endsWith('/state/nfl')) return { ok: true, json: async () => plain(calendar) };
            const path = url.slice(`https://api.sleeper.app/v1/league/${id}`.length);
            const value = path === '' ? info : path === '/rosters' ? rosters : path === '/users' ? users : path === '/winners_bracket' ? bracket : weeks[Number(path.split('/').at(-1))];
            return { ok: value != null, json: async () => plain(value) };
        };
        return { info, rosters, users, bracket, weeks, calls, calendar, fetcher, league: { league_id: id, season } };
    };
        const api = makeApi(), f = fixture();
        const result = await api.load({ league: f.league, fetcher: f.fetcher, now: () => 1000 });
        assert.equal(result.status, 'ready'); assert.equal(result.checkedAt, 1000);
        assert.deepEqual(plain(result.rounds.map(r => [r.label, r.weeks])), [['First round', [15]], ['Semifinals', [16]], ['Championship', [17]]]);
        assert.equal(result.rounds.flatMap(r => r.games).length, 5, 'placement and consolation games cannot enter a title bracket');
        assert.deepEqual(plain(result.rounds[0].byes.map(t => t.id).sort()), ['1', '2']);
        const champion = result.paths[0];
        assert.equal(champion.team.id, '1'); assert.equal(champion.team.ownerId, 'owner-1'); assert.equal(champion.champion, true);
        assert.equal(champion.rounds[0].bye, true); assert.deepEqual(plain(champion.rounds[0].points), [null, null], 'a bye cannot invent a score or victory');
        assert.deepEqual(plain(champion.rounds[1].points), [134.98, 102.57]); assert.deepEqual(plain(champion.rounds[2].points), [133.37, 92.4]);
        assert(!JSON.stringify(result).includes('"seed"'), 'roster IDs are never published as seeds');
        assert(result.sources.some(s => s.url.endsWith('/matchups/17')));
        assert(f.calls.every(c => c.options.cache === 'no-store'), 'a checked timestamp must not be refreshed by browser cache hits');
        const count = f.calls.length;
        result.paths[0].team.name = 'Consumer mutation';
        const cached = await api.load({ league: f.league, fetcher: f.fetcher, now: () => 2000 });
        assert.equal(f.calls.length, count); assert.equal(cached.checkedAt, 1000); assert.equal(cached.paths[0].team.name, 'Team 1', 'consumers cannot mutate cached editions');
        const aborted = new AbortController(); aborted.abort();
        await assert.rejects(api.load({ league: f.league, signal: aborted.signal, fetcher: f.fetcher }), { name: 'AbortError' });
        assert.equal(f.calls.length, count, 'an aborted caller cannot even reuse a warm result');
        await api.load({ league: f.league, fetcher: f.fetcher, force: true, now: () => 3000 });
        assert(f.calls.length > count, 'manual refresh bypasses the complete-season cache');
        const other = fixture('987654321');
        other.users[0].metadata.team_name = 'Other league champion';
        const scoped = await api.load({ league: other.league, fetcher: other.fetcher, now: () => 4000 });
        assert.equal(scoped.paths[0].team.name, 'Other league champion', 'roster slots cannot leak across leagues');
        const wrongSeason = await api.load({ league: { ...f.league, season: '2026' }, fetcher: f.fetcher });
        assert.equal(wrongSeason.status, 'error'); assert.equal(wrongSeason.paths.length, 0, 'a different requested season cannot reuse historical scores');
        const overridden = fixture(); overridden.weeks[17][0].points = 50; overridden.weeks[17][0].custom_points = 150.25;
        const corrected = await makeApi().load({ league: overridden.league, fetcher: overridden.fetcher });
        assert.equal(corrected.rounds[2].games[0].teams[0].points, 150.25, 'official commissioner-adjusted points take priority without recalculation');
        const tied = fixture(); tied.weeks[17][0].points = 92.4;
        const tie = await makeApi().load({ league: tied.league, fetcher: tied.fetcher });
        assert.equal(tie.rounds[2].games[0].status, 'final'); assert.equal(tie.rounds[2].games[0].winnerId, '1');
        assert(tie.rounds[2].games[0].note.includes('Level on points')); assert(tie.paths[0].rounds.at(-1).caption.includes('No tiebreak rule is inferred'));
        const missing = fixture(); missing.weeks[17].splice(1, 1);
        const partial = await makeApi().load({ league: missing.league, fetcher: missing.fetcher });
        const partialFinal = partial.rounds[2].games[0];
        assert.equal(partial.status, 'partial'); assert.equal(partialFinal.status, 'pending'); assert.equal(partialFinal.winnerId, '1');
        assert(partialFinal.teams.every(t => t.points === null), 'official advancement alone cannot invent a full final score');
        const mismatch = fixture(); mismatch.weeks[17][0].points = 10;
        const disagreement = await makeApi().load({ league: mismatch.league, fetcher: mismatch.fetcher });
        assert.equal(disagreement.rounds[2].games[0].status, 'pending'); assert(disagreement.rounds[2].games[0].note.includes('disagree'));
        const conflicting = fixture();
        conflicting.bracket.find(n => n.p === 1).t1 = 4;
        conflicting.bracket.find(n => n.p === 1).w = 4;
        conflicting.weeks[17] = [{ roster_id: 4, matchup_id: 1, points: 150 }, { roster_id: 2, matchup_id: 1, points: 100 }];
        const conflict = await makeApi().load({ league: conflicting.league, fetcher: conflicting.fetcher });
        assert.equal(conflict.status, 'partial'); assert.equal(conflict.rounds[2].games[0].status, 'pending');
        assert.equal(conflict.rounds[2].games[0].winnerId, null); assert(!conflict.paths.some(p => p.champion), 'a direct entrant cannot contradict the previous-round winner and still become champion');
        assert(conflict.rounds[2].games[0].note.includes('conflicts'));
        const invalidSource = fixture(); invalidSource.bracket.find(n => n.m === 3).w = 5;
        invalidSource.bracket.find(n => n.p === 1).t1 = 5; invalidSource.bracket.find(n => n.p === 1).w = 5;
        invalidSource.weeks[17] = [{ roster_id: 5, matchup_id: 1, points: 150 }, { roster_id: 2, matchup_id: 1, points: 100 }];
        const invalidAdvancement = await makeApi().load({ league: invalidSource.league, fetcher: invalidSource.fetcher });
        assert.equal(invalidAdvancement.rounds[2].games[0].winnerId, null, 'a referenced winner must be a verified participant in its own source game');
        assert(!invalidAdvancement.paths.some(p => p.champion));
        const multileg = fixture(); multileg.info.settings.playoff_round_type = 1;
        const unknownFormat = await makeApi().load({ league: multileg.league, fetcher: multileg.fetcher });
        assert.equal(unknownFormat.status, 'partial'); assert(unknownFormat.rounds.every(r => r.weeks.length === 0));
        assert(unknownFormat.rounds.flatMap(r => r.games).every(g => g.status !== 'final' && g.teams.every(t => t.points === null)), 'unverified multiweek rounds cannot become single-week final scores');
        assert(!multileg.calls.some(c => c.url.includes('/matchups/')), 'unknown duration never guesses a week mapping');
        const future = fixture(); future.bracket.forEach(node => { node.w = null; node.l = null; if (node.r > 1) { if (node.r === 2 && node.p == null) { node.t2 = null; node.t2_from = { w: node.m === 3 ? 2 : 1 }; } else { node.t1 = null; node.t2 = null; } } });
        const scheduled = await makeApi().load({ league: future.league, fetcher: future.fetcher });
        assert.equal(scheduled.status, 'ready'); assert.equal(scheduled.rounds[0].games[0].status, 'scheduled'); assert.equal(scheduled.rounds[1].games[0].status, 'pending');
        assert(!scheduled.paths.some(p => p.champion)); assert(!future.calls.some(c => c.url.includes('/matchups/')), 'upcoming rounds do not fetch arbitrary zero-score snapshots');
        assert.deepEqual(plain(scheduled.rounds[0].byes.map(t => t.id).sort()), ['1', '2']);
        const currentField = fixture('123450026', '2026'); currentField.info.status = 'in_season';
        const projected = await makeApi().load({ league: currentField.league, fetcher: currentField.fetcher });
        assert.equal(projected.provisional, true); assert(projected.message.includes('If the season ended today'));
        assert(projected.rounds.flatMap(r => r.games).every(g => g.winnerId === null && g.status !== 'final' && g.teams.every(t => t.points === null)), 'a pre-playoff field cannot claim wins or completed scores even if provider rows include them');
        assert(!projected.paths.some(p => p.champion));
        assert(projected.paths.flatMap(p => p.rounds).filter(r => r.bye).every(r => r.status === 'scheduled' && r.caption.includes('not clinched')), 'pre-playoff byes are only current field positions');
        assert(!currentField.calls.some(c => c.url.includes('/matchups/')), 'provisional fields never retrieve arbitrary future scores');
        currentField.calendar.week = 15;
        const started = await makeApi().load({ league: currentField.league, fetcher: currentField.fetcher });
        assert.equal(started.provisional, false, 'current NFL week, rather than projected display week, identifies playoff start');
        currentField.calendar.week = 14; currentField.calendar.display_week = 15;
        const earlyDisplay = await makeApi().load({ league: currentField.league, fetcher: currentField.fetcher });
        assert.equal(earlyDisplay.provisional, true, 'an advanced display week cannot finalize next week’s playoff field');
        const noCalendar = await makeApi().load({ league: currentField.league, fetcher: async (...args) => args[0].endsWith('/state/nfl') ? { ok: false } : currentField.fetcher(...args) });
        assert.equal(noCalendar.status, 'partial'); assert.equal(noCalendar.provisional, true); assert(!noCalendar.paths.some(p => p.champion));
        assert(noCalendar.message.includes('calendar could not be verified'));
        const historicalWithoutCalendar = await makeApi().load({ league: f.league, fetcher: async (...args) => args[0].endsWith('/state/nfl') ? { ok: false } : f.fetcher(...args) });
        assert.equal(historicalWithoutCalendar.provisional, false); assert.equal(historicalWithoutCalendar.status, 'ready');
        assert(historicalWithoutCalendar.paths.some(p => p.champion), 'a verified completed season survives an unrelated live-calendar outage');
        assert(historicalWithoutCalendar.notes.some(note => note.includes('marks this season complete')));
        const titleOnly = fixture(); titleOnly.info.settings.playoff_teams = 2; titleOnly.info.settings.playoff_week_start = 17;
        titleOnly.bracket.splice(0, titleOnly.bracket.length, { m: 1, r: 1, p: 1, t1: 1, t2: 2, w: 1, l: 2 });
        const twoTeam = await makeApi().load({ league: titleOnly.league, fetcher: titleOnly.fetcher });
        assert.equal(twoTeam.status, 'ready'); assert.equal(twoTeam.rounds.length, 1); assert.equal(twoTeam.rounds[0].label, 'Championship');
        assert.equal(twoTeam.rounds[0].games[0].teams[0].points, 133.37, 'a two-team title bracket uses its explicit final and configured week');
        const empty = fixture(); empty.bracket.length = 0;
        const noBracket = await makeApi().load({ league: empty.league, fetcher: empty.fetcher });
        assert.equal(noBracket.status, 'empty'); assert.equal(noBracket.rounds.length, 0);
        const interrupted = fixture(), controller = new AbortController(), cancellationApi = makeApi();
        const cancelFetcher = async (...args) => { const response = await interrupted.fetcher(...args); if (args[0].endsWith('/matchups/17')) controller.abort(); return response; };
        await assert.rejects(cancellationApi.load({ league: interrupted.league, fetcher: cancelFetcher, signal: controller.signal }), { name: 'AbortError' });
        const afterAbort = interrupted.calls.length;
        const retry = await cancellationApi.load({ league: interrupted.league, fetcher: interrupted.fetcher });
        assert.equal(retry.status, 'ready'); assert(interrupted.calls.length > afterAbort, 'aborted work cannot populate a reusable edition');
        const failed = await makeApi().load({ league: f.league, fetcher: async () => ({ ok: false }) });
        assert.equal(failed.status, 'error'); assert.equal(failed.checkedAt, null); assert(failed.message.includes('could not load'));

        const raceLeague = { ...f.info, settings: { start_week: 1, playoff_week_start: 15, playoff_teams: 2, playoff_seed_type: 0, divisions: 0, league_average_match: 0 } };
        const table = [[12, 0], [9, 3], [8, 4], [5, 7], [2, 10], [0, 12]].map(([wins, losses], i) => ({ rid: i + 1, wins, losses, ties: 0 }));
        const edition = { completedThrough: 12, expectedThrough: 12, table };
        const race = api.race({ league: raceLeague, edition });
        assert.equal(race.supported, true); assert.equal(race.remainingWeeks, 2);
        assert.equal(race.rows[0].status, 'Clinched'); assert.equal(race.rows.at(-1).status, 'Eliminated');
        assert.deepEqual([race.rows[1].minWins, race.rows[1].maxWins], [9, 11]);
        assert(race.rows[1].needed.includes('2 more wins guarantee'), 'race offers a sufficient scenario without claiming a minimal route');
        assert(race.rows[2].needed.includes('Winning out reaches 10 wins'), 'a team without an independent guarantee gets a ceiling and dependency explanation');
        const tiedTable = [[8, 3, 1], [8, 3, 1], [8, 3, 1], [5, 7, 0], [3, 9, 0], [2, 10, 0]].map(([wins, losses, ties], i) => ({ rid: i + 1, wins, losses, ties }));
        const tiedRace = api.race({ league: { ...raceLeague, settings: { ...raceLeague.settings, playoff_week_start: 13 } }, edition: { completedThrough: 12, table: tiedTable } });
        assert(tiedRace.rows.slice(0, 3).every(t => t.status === 'In the race'), 'record ties at the final cutoff never assume a points tiebreak');
        assert(tiedRace.rows[0].needed.includes('official tiebreak'));
        const medianLeague = { ...raceLeague, settings: { ...raceLeague.settings, league_average_match: 1 } };
        const medianEdition = { ...edition, table: table.map(t => ({ ...t, wins: t.wins * 2, losses: t.losses * 2 })) };
        const median = api.race({ league: medianLeague, edition: medianEdition });
        assert.equal(median.supported, true); assert.equal(median.rows[1].maxWins - median.rows[1].minWins, 4);
        assert(median.rows[1].needed.includes('head-to-head or median wins')); assert(median.notes[0].includes('median decision'));
        const divided = api.race({ league: { ...medianLeague, settings: { ...medianLeague.settings, divisions: 3 } }, edition: medianEdition });
        assert.equal(divided.supported, false); assert(divided.rows.every(t => t.status === 'Record range')); assert(divided.reason.includes('Division'));
        const custom = api.race({ league: { ...raceLeague, settings: { ...raceLeague.settings, playoff_seed_type: 1 } }, edition });
        assert.equal(custom.supported, false); assert(custom.rows.every(t => !['Clinched', 'Eliminated'].includes(t.status)));
        const manual = api.race({ league: { ...raceLeague, bracket_overrides_id: '123' }, edition });
        assert.equal(manual.supported, false);
        assert.equal(api.race({ league: raceLeague, edition: { ...edition, expectedThrough: 13 } }).rows.length, 0, 'missing requested results suppress race conclusions');
        assert.equal(api.race({ league: raceLeague, edition: { ...edition, table: table.slice(1) } }).rows.length, 0, 'missing teams suppress race conclusions');
        for (const absent of [null, '', false]) {
            assert.equal(api.race({ league: raceLeague, edition: { ...edition, table: [{ ...table[0], losses: absent }, ...table.slice(1)] } }).rows.length, 0, 'missing record fields cannot be silently converted to zero');
        }
        assert.equal(api.race({ league: medianLeague, edition }).rows.length, 0, 'median records must include both weekly decisions');
        assert.equal(api.race({ league: raceLeague, edition, remainingWeeks: 1 }).rows.length, 0, 'remaining schedule cannot be shortened to invent a clinch');
        assert.equal(api.race({ league: { ...raceLeague, type: 'chopped' }, edition }).supported, false);
        void ('PASS Wire playoffs: verified bracket, explicit byes, original scores, safe ties and multiweek fallback, abort-safe scoped cache, conservative race and scenarios');
});
