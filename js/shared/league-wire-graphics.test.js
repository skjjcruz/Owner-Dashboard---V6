// Run with:  node --test js/shared/league-wire-graphics.test.js
// Ported from C2 tests/league-wire-graphics.cjs (2026-09-27). The comparison
// half is unchanged; the championship half is rewritten for Sleeper-only
// chronicle books (C2 used a hand-entered fixture of workbook facts).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
test('Wire graphics: verified comparisons, owner identity, cutoffs, median scope, original names, missing values, Sleeper-only title games', () => {
    const root = { console }; root.window = root;
    vm.createContext(root);
    for (const file of ['league-live-scores', 'league-wire-chronicles', 'league-wire-graphics', 'league-wire-journal']) vm.runInContext(fs.readFileSync(path.join(__dirname, `${file}.js`), 'utf8'), root);
    const row = (roster_id, points, matchup_id = 1, extra = {}) => ({ roster_id, points, matchup_id, ...extra });
    const names = rid => ['Alpha', 'Bravo', 'Charlie', 'Delta'][rid - 1];
    const league = { league_id: '202600', season: '2026', settings: { playoff_week_start: 5, league_average_match: 1 }, scoring_settings: { rec: 1 }, roster_positions: ['QB'],
        rosters: ['a', 'b', 'c', 'd'].map((owner_id, i) => ({ roster_id: i + 1, owner_id })) };
    const weeks = [
        { week: 1, rows: [row(1, 100), row(2, 90), row(3, 80, 2), row(4, 70, 2)] },
        { week: 2, rows: [row(1, 80), row(2, 100), row(3, 90, 2), row(4, 70, 2)] },
    ];
    const oldLeague = { ...league, league_id: '202500', season: '2025', settings: { playoff_week_start: 2 },
        rosters: [{ roster_id: 1, owner_id: 'b' }, { roster_id: 2, owner_id: 'a' }, ...league.rosters.slice(2)],
        users: [{ user_id: 'a', display_name: 'Old Alpha' }, { user_id: 'b', display_name: 'Old Bravo' }] };
    const prior = { league: oldLeague, weeks: [
        { week: 1, rows: [row(2, 130), row(1, 110), row(3, 90, 2), row(4, 80, 2)] },
        { week: 2, rows: [row(2, 500), row(1, 400), row(3, 300, 2), row(4, 200, 2)] },
    ] };
    const board = { week: 3, rows: [row(2, 999), row(1, 999), row(3, 999, 2), row(4, 999, 2)] };
    const build = extra => root.WrWireStories.build({ league, weeks, start: 1, end: 2, board, nameFor: names, priorSeasons: [prior], ...extra });
    const serial = value => JSON.parse(JSON.stringify(value));
    const series = (model, id) => model.series.find(s => s.id === id);
    const edition = build();
    const preview = edition.previews.find(s => s.rosterIds.includes(1)).broadcast;
    assert(preview && preview.kind === 'comparison');
    assert.deepEqual(serial(preview.teams.map(t => t.name)), ['Bravo', 'Alpha']);
    assert.deepEqual(serial(preview.teams.map(t => t.record)), ['3–1', '2–2']);
    assert.deepEqual(serial(preview.teams.map(t => t.h2hRecord)), ['1–1', '1–1']);
    assert.deepEqual(serial(preview.teams.map(t => t.average)), [95, 90], 'median games do not double scoring averages');
    assert.equal(preview.throughWeek, 2);
    assert.match(preview.recordScope, /median/);
    const regular = series(preview, 'regular-season');
    assert.deepEqual(serial(regular.wins), [1, 2], 'series order matches the comparison teams after roster slots changed');
    assert.equal(regular.meetings.length, 3, 'historical playoffs are not regular-season series meetings');
    assert.deepEqual(serial(regular.meetings[0].points), [110, 130]);
    assert.deepEqual(serial(regular.meetings[0].names), ['Old Bravo', 'Old Alpha']);
    assert(preview.notes.some(note => /earlier meetings may be missing/.test(note)));
    assert(!JSON.stringify(preview).includes('999'), 'possibly live board scores never become completed results');
    assert(!JSON.stringify(preview).includes('all-time'), 'loaded meetings never claim an all-time series');
    assert(preview.sources.some(source => /202600\/matchups\/2$/.test(source.url)));

    const recap = edition.stories.find(s => s.kind === 'recap' && s.week === 1 && s.rosterIds.includes(1)).broadcast;
    assert.equal(recap.throughWeek, 1, 'an old recap stops at its own week');
    assert.deepEqual(serial(recap.teams.map(t => t.record)), ['2–0', '1–1']);
    assert.deepEqual(serial(recap.teams.map(t => t.h2hRecord)), ['1–0', '0–1']);
    assert.deepEqual(serial(series(recap, 'result').meetings[0].points), [100, 90]);
    assert.equal(series(recap, 'regular-season').meetings.length, 2, 'a later current-season meeting does not leak into an old recap');

    const freshPair = build({ priorSeasons: [], board: { week: 3, rows: [row(1, 0), row(3, 0), row(2, 0, 2), row(4, 0, 2)] } }).previews.find(s => s.rosterIds.includes(1)).broadcast;
    assert(freshPair && freshPair.series.length === 0, 'a first matchup can show verified form without inventing a 0–0 series');
    assert(freshPair.sources.some(source => /matchups\/2$/.test(source.url)), 'standalone form retains result sources');
    const followed = build({ rivalries: [{ owners: ['a', 'c'], name: 'Across Town' }] }).rivals.find(r => r.followed);
    assert(followed && !followed.scheduled && followed.broadcast);
    assert.equal(followed.broadcast.headline, 'Across Town');
    assert.equal(followed.broadcast.eyebrow, 'Rivalry profile');
    assert.equal(followed.broadcast.throughWeek, 2);
    assert(!series(followed.broadcast, 'result'), 'a watched rivalry not on the schedule never gains an invented result');

    const replacementLeague = { ...league, rosters: league.rosters.map(r => r.roster_id === 1 ? { ...r, owner_id: 'replacement' } : r) };
    const replacement = build({ league: replacementLeague }).previews.find(s => s.rosterIds.includes(1)).broadcast;
    assert.equal(series(replacement, 'regular-season').meetings.length, 2, 'a new owner does not inherit the old roster slot’s history');
    const missingOwner = build({ league: { ...league, rosters: league.rosters.map(r => r.roster_id === 1 ? { roster_id: 1 } : r) } }).previews.find(s => s.rosterIds.includes(1)).broadcast;
    assert.equal(series(missingOwner, 'regular-season').meetings.length, 2);
    assert(missingOwner.notes.some(note => /distinct verified owner/.test(note)));
    const future = build({ priorSeasons: [prior, { ...prior, league: { ...oldLeague, season: '2027' } }] }).previews.find(s => s.rosterIds.includes(1)).broadcast;
    assert.equal(series(future, 'regular-season').meetings.length, 3, 'a supplied future season cannot leak backward');
    const ambiguous = build({ priorSeasons: [{ ...prior, league: { ...oldLeague, rosters: oldLeague.rosters.map(r => r.roster_id === 3 ? { ...r, owner_id: 'a' } : r) } }] }).previews.find(s => s.rosterIds.includes(1)).broadcast;
    assert.equal(series(ambiguous, 'regular-season').meetings.length, 2, 'ambiguous historical owner slots are not merged');

    const firstWeek = build({ end: 0, weeks: [], board: { ...board, week: 1 } }).previews.find(s => s.rosterIds.includes(1)).broadcast;
    assert(firstWeek.teams.every(t => t.record === null && t.average === null && t.h2hRecord === null), 'unplayed current form stays unknown, not 0–0 and zero points');
    assert.equal(firstWeek.throughWeek, null);
    const zero = build({ end: 1, weeks: [{ week: 1, rows: [row(1, 55, 1, { custom_points: 0 }), row(2, 0), row(3, 0, 2), row(4, 0, 2)] }], board: { ...board, week: 2 } }).previews.find(s => s.rosterIds.includes(1)).broadcast;
    assert(zero.teams.every(t => t.average === 0), 'verified zero and custom zero are preserved');
    assert(zero.teams.every(t => t.h2hRecord === '0–0–1'));
    assert.equal(series(zero, 'regular-season').ties, 1);
    const gap = build({ weeks: weeks.slice(0, 1) }).previews.find(s => s.rosterIds.includes(1)).broadcast;
    assert.equal(gap.throughWeek, 1);
    assert(gap.teams.every(t => t.average !== null));
    assert(!series(gap, 'regular-season').meetings.some(m => m.season === 2026 && m.week === 2));

    // Dynasty HQ: title games come ONLY from Sleeper-derived chronicle books
    // (WrHistory championships → WrWireChronicles.fromSleeperHistory).
    const history = { leagueId: league.league_id, championships: {
        2026: { championName: 'Future Alpha', championOwnerId: 'a', runnerUpName: 'Future Bravo', runnerUpOwnerId: 'b' },
        2024: { championName: 'Historical Alpha', championOwnerId: 'a', runnerUpName: 'Historical Bravo', runnerUpOwnerId: 'b' },
        2023: { championName: 'Older Bravo', championOwnerId: 'b', runnerUpName: 'Older Alpha', runnerUpOwnerId: 'a' },
        2022: { championName: 'Unmatched', championOwnerId: 'a', runnerUpName: 'Nobody', runnerUpOwnerId: null },
        2021: { championName: 'No account', championOwnerId: null },
    } };
    const bookSeasons = [{ league: { league_id: '202400', season: '2024' } }];
    const sleeperBook = root.WrWireChronicles.fromSleeperHistory({ league, history, seasons: bookSeasons });
    assert(sleeperBook && root.WrWireChronicles.register(sleeperBook));
    assert(!sleeperBook.facts.some(f => f.season === 2021), 'a champion without a verified account is not a fact');
    assert(sleeperBook.facts.every(f => f.scores === null), 'final scores are never invented');
    const withHistory = build();
    const matchupHistory = withHistory.previews.find(s => s.rosterIds.includes(1)).broadcast;
    const titles = series(matchupHistory, 'championships');
    assert.equal(titles.meetings.length, 2, '2022 (no runner-up account) and the current 2026 season are excluded');
    assert.deepEqual(serial(titles.wins), [1, 1]);
    assert.deepEqual(serial(titles.meetings.map(m => m.points)), [[null, null], [null, null]], 'missing final scores stay null, never 0');
    assert.equal(titles.meetings[1].winnerIndex, 1, '2024 winner aligned to current team order (Alpha is second)');
    assert.equal(titles.meetings[0].winnerIndex, 0);
    assert.deepEqual(serial(matchupHistory.playoffSeasons), [{ league_id: '202400', season: 2024 }], 'only real Sleeper bracket endpoints open historical playoff editions');
    const feature2023 = withHistory.stories.find(s => s.id === 'chronicle:sleeper-final-2023').broadcast;
    assert.equal(feature2023.season, 2023);
    assert.equal(feature2023.throughWeek, null);
    assert.equal(series(feature2023, 'championships').meetings.length, 1, 'a 2023 lookback cannot show a 2024 final');
    assert(feature2023.teams.every(t => t.record === null && t.average === null), 'historical features do not mix in present records');
    assert.deepEqual(serial(feature2023.teams.map(t => t.name)), ['Older Bravo', 'Older Alpha']);
    assert.equal(feature2023.playoffSeasons.length, 0, 'a season without a known league id offers no bracket link');
    assert(!withHistory.stories.find(s => s.id === 'chronicle:sleeper-final-2022').broadcast, 'no comparison without a verified runner-up');
    assert(!series(build({ league: replacementLeague }).previews.find(s => s.rosterIds.includes(1)).broadcast, 'championships'));
    assert(!build({ league: { ...league, league_id: 'unrelated' } }).previews.some(s => series(s.broadcast, 'championships')), 'another league never selects this book');

    const empty = { stories: [{ id: 'prose-only', kind: 'story', text: 'Alpha beat Bravo 900–800', body: '2024 final', rosterIds: [1, 2], season: '2026' }], previews: [], rivals: [], completedThrough: 2 };
    const before = JSON.stringify(empty);
    assert(!root.WrWireGraphics.enrich(empty, { league, weeks, start: 1, end: 2, nameFor: names }).stories[0].broadcast, 'graphics never infer structured evidence from prose');
    assert.equal(JSON.stringify(empty), before, 'enrichment does not mutate its input edition');
    assert.equal(build({ headToHead: false }).previews.length, 0);
    void ('PASS Wire graphics: verified comparison data, owner identity, cutoff-specific records, median scope, original names/scores, missing values, separate series, historical playoff sources and unscheduled rivalry profiles');
});
