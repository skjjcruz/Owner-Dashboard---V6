// Run with:  node --test js/shared/league-wire-journal.test.js
// Ported from C2 tests/league-wire-journal.cjs + the engine half of
// tests/league-wire.js (2026-09-27). Story rules are unchanged from C2.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
test('C2 journal: owner continuity, revenge, streaks, median, boundaries, milestones, rules, archive cache, partial data, cancellation, editorial selection, matchup reporting', async () => {
    const context = { console, setTimeout, clearTimeout, AbortController, fetch: () => { throw Error('Unexpected network'); } };
    context.window = context;
    vm.createContext(context);
    for (const file of ['league-live-scores.js', 'league-live-table.js', 'league-wire-journal.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
    const Journal = context.WrWireStories;
    const row = (roster_id, points, matchup_id = 1, extra = {}) => ({ roster_id, points, matchup_id, ...extra });
    const league = (season, extra = {}) => ({ league_id: 'L' + season, season: String(season), settings: { playoff_week_start: 5, playoff_teams: 1 }, scoring_settings: { rec: 1 }, roster_positions: ['QB','RB','BN'], rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }], ...extra });
    const build = (weeks, extra = {}) => Journal.build({ weeks, start: 1, end: 4, league: league(2026), nameFor: rid => ['Alpha','Bravo'][rid - 1], playerName: id => id, ...extra });
    const earlier = { league: league(2025, { settings: { playoff_week_start: 2 }, users: [{ user_id: 'a', metadata: { team_name: 'Old Alpha' } }, { user_id: 'b', display_name: 'Old Bravo' }] }), weeks: [{ week: 1, rows: [row(1, 250), row(2, 240)] }] };
    const w = (week, a, b) => ({ week, rows: [row(1, a), row(2, b)] });
    const comeback = build([w(1, 80, 100), w(2, 80, 110), w(3, 80, 120), w(4, 150, 140)], { priorSeasons: [earlier], archiveComplete: true });
    assert(comeback.stories.some(s => s.category === 'Back in business'));
    assert(comeback.stories.some(s => s.category === 'Streak snapped'));
    assert(comeback.stories.some(s => s.category === 'Revenge game'));
    assert.equal(comeback.archive.high, 250);
    assert.equal(comeback.archive.records[0].name, 'Old Alpha', 'past records retain past names');
    assert(comeback.stories.some(s => s.kind === 'recap' && s.related.some(r => r.label === 'What it means' && /1–3/.test(r.text))));
    assert(!comeback.stories.some(s => /clinched|eliminated|comeback from/.test(s.body)), 'no unsupported clinches or in-game comebacks');
    const weekOne = build([], { end: 0, priorSeasons: [earlier], board: { week: 1, rows: [row(1, 20), row(2, 0)] } });
    assert.equal(weekOne.previews.length, 1, 'opening week uses rivalry history');
    assert.equal(weekOne.rivals[0].winsA, 1);
    const replaced = build([], { end: 0, league: league(2026, { rosters: [{ roster_id: 1, owner_id: 'new-owner' }, { roster_id: 2, owner_id: 'b' }] }), priorSeasons: [earlier], board: { week: 1, rows: [row(1, 0), row(2, 0)] } });
    assert.equal(replaced.previews.length, 0, 'replacement owner does not inherit rivalry');
    const changedRules = { ...earlier, league: { ...earlier.league, scoring_settings: { rec: 2 } } };
    const changed = build([w(1, 100, 90)], { end: 1, priorSeasons: [changedRules], archiveComplete: true });
    assert.equal(changed.archive.historicalHigh, 250, 'original-scoring record preserves all historical eras');
    assert.equal(changed.archive.high, 100, 'incompatible scoring excluded from all-time comparison');
    assert.equal(changed.archive.rulesChanged, true);
    assert.equal(changed.archive.seasons.join(','), '2026', 'record coverage lists comparable years');
    const newMark = build([w(1, 251, 200)], { end: 1, priorSeasons: [earlier], archiveComplete: true });
    assert(newMark.stories.some(s => s.category === 'History made'));
    const firstSeason = build([w(1, 100, 90), w(2, 120, 80)], { end: 2 });
    assert(!firstSeason.stories.some(s => s.category === 'History made'), 'season records are not duplicated as historical milestones without history');
    const division = build([w(1, 80, 100), w(2, 150, 90)], { end: 2, league: league(2026, { settings: { playoff_teams: 1, divisions: 2, playoff_week_start: 5 } }) });
    const powerShift = division.stories.find(s => s.category === 'Power shift');
    assert(powerShift && /The Wire’s standings/.test(powerShift.body));
    assert(!/official|completed-results/.test(powerShift.body));
    assert(powerShift.related.some(r => /official seeds may differ/.test(r.text)), 'ranking scope remains available for custom seeding');
    assert(!division.stories.some(s => s.category === 'Playoff race' || s.related?.some(r => r.label === 'Playoff race')), 'division seeding is not inferred from overall rank');
    const fourLeague = league(2026, { settings: { playoff_week_start: 4, playoff_teams: 2, league_average_match: 1 }, rosters: [1,2,3,4].map(i => ({ roster_id: i, owner_id: String(i) })) });
    const median = build([{ week: 1, rows: [row(1, 120),row(2,110),row(3,90,2),row(4,80,2)] }], { end: 1, league: fourLeague, nameFor: id => String(id) });
    assert.equal(median.table.find(t => t.rid === 1).wins, 2);
    assert.equal(median.table.find(t => t.rid === 2).wins, 1);
    assert.equal(median.table.find(t => t.rid === 2).losses, 1);
    const sharedMargin = build([{ week: 1, rows: [row(1,120),row(2,100),row(3,90,2),row(4,70,2)] }], { end: 1, league: fourLeague, nameFor: id => String(id) });
    assert.equal(sharedMargin.archive.margins.length, 2, 'all tied winning-margin holders remain in the book');
    const missing = build([w(1,100,80), w(3,1000,800)]);
    assert.equal(missing.completedThrough, 1);
    assert.equal(missing.high, 100);
    assert.equal(build([{ week: 1, rows: [row(1,100), row(1,90)] }]).stories.length, 0);
    assert.equal(build([{ week: 1, rows: [row(1,100)] }]).stories.length, 0);
    const totalMilestone = build([w(1,300,290),w(2,300,290),w(3,300,290),w(4,300,290)]);
    assert(totalMilestone.stories.some(s => s.category === 'Milestone' && s.metric === '1,000'));
    const pastNineWins = { ...earlier, league: { ...earlier.league, settings: { playoff_week_start: 10 } }, weeks: Array.from({ length: 9 }, (_, i) => w(i+1,120,100)) };
    assert(build([w(1,130,100)], { end: 1, priorSeasons: [pastNineWins], archiveComplete: true }).stories.some(s => s.category === 'Career milestone' && s.metric === '10'));
    assert(!build([w(1,130,100)], { end: 1, priorSeasons: [pastNineWins], archiveComplete: false }).stories.some(s => s.category === 'Career milestone'));
    const candidates = [
        { id: 'archive', documentary: true, weight: 999, text: 'An old title' },
        { id: 'lead', kind: 'story', category: 'Power shift', rosterIds: [1], weight: 82, text: 'Grannies go first' },
        { id: 'repeat', kind: 'story', category: 'Scoring crown', rosterIds: [1], weight: 45, text: 'Grannies lead scoring' },
        { id: 'rivalry', kind: 'story', category: 'Rivalry watch', rosterIds: [2, 3], weight: 70, preview: true, text: 'A rivalry' },
        { id: 'duplicate', kind: 'story', category: 'Other preview', rosterIds: [3, 2], weight: 60, preview: true, text: 'Same matchup again' },
    ];
    assert.equal(Journal.frontPage(candidates).map(s => s.id).join(','), 'lead,rivalry');
    assert.equal(Journal.weeklyLookback(candidates, 'L2026:2').id, 'archive');
    assert.equal(Journal.weeklyLookback(candidates.slice().reverse(), 'L2026:2').id, 'archive');
    const newcomerLeague = league(2026, { rosters: [{ roster_id: 1, owner_id: 'new' }, { roster_id: 2, owner_id: 'b' }] });
    const arrivals = build([w(1, 100, 90), w(2, 100, 90)], { end: 2, league: newcomerLeague, priorSeasons: [earlier], archiveComplete: true });
    assert(arrivals.stories.some(s => s.category === 'New faces' && /2–0/.test(s.body)));
    assert(!build([w(1, 100, 90)], { end: 1, league: newcomerLeague, priorSeasons: [earlier], archiveComplete: false }).stories.some(s => s.category === 'New faces'));
    assert(!build([w(1, 100, 90)], { end: 1, priorSeasons: [earlier], archiveComplete: true, nameFor: () => 'Rebranded team' }).stories.some(s => s.category === 'New faces'), 'name changes are not new managers');
    void ('PASS editorial selection: current-only headlines, distinct subjects, stable weekly lookback and verified newcomers');

    // A current matchup earns coverage on its own merits, without an old series.
    const names = rid => ['Alpha', 'Bravo', 'Charlie', 'Delta'][rid - 1];
    const weeklyRows = [
        { week: 1, rows: [row(1, 120), row(2, 90), row(3, 110, 2), row(4, 80, 2)] },
        { week: 2, rows: [row(1, 125), row(2, 100), row(3, 115, 2), row(4, 85, 2)] },
    ];
    const nextBoard = { week: 3, rows: [row(1, 999), row(3, 999), row(2, 999, 2), row(4, 999, 2)] };
    const currentLeague = { ...fourLeague, settings: { playoff_week_start: 5, playoff_teams: 2 } };
    const previewOptions = { end: 2, league: currentLeague, nameFor: names, board: nextBoard };
    const freshMatchups = build(weeklyRows, previewOptions);
    assert.equal(freshMatchups.rivals.length, 0, 'first meetings are not automatically called historical rivalries');
    assert.equal(freshMatchups.previews.length, 2, 'verified records produce previews without an archive');
    const unbeatenPreview = freshMatchups.previews.find(s => s.rosterIds.includes(1));
    assert.match(unbeatenPreview.text, /Unbeaten starts meet/);
    assert.equal(unbeatenPreview.category, 'Matchup preview');
    assert.equal(unbeatenPreview.formThrough, 2);
    assert.match(unbeatenPreview.body, /Alpha are 2–0 and Charlie are 2–0/);
    assert.match(unbeatenPreview.body, /Alpha average 122\.50 points and Charlie average 112\.50/);
    assert(!/999|projected|upcoming|will win/.test(unbeatenPreview.body), 'this week’s possibly live points never become completed form or a prediction');
    assert.equal(unbeatenPreview.body.split('\n\n').length, 2, 'brief current stakes and scoring paragraphs');
    assert.equal(build(weeklyRows.slice(0, 1), previewOptions).previews.length, 0, 'missing completed weeks cannot create a current-form preview');
    assert.equal(build(weeklyRows, { ...previewOptions, board: { ...nextBoard, week: 4 } }).previews.length, 0, 'stale form is not presented as this week’s form');
    assert.equal(build(weeklyRows, { ...previewOptions, headToHead: false }).previews.length, 0, 'no invented H2H coverage for non-H2H formats');
    assert.equal(build(weeklyRows, { ...previewOptions, board: { ...nextBoard, week: 5 } }).previews.length, 0, 'regular-season context does not invent playoff previews');
    const medianPreview = build(weeklyRows, { ...previewOptions, league: { ...currentLeague, settings: { ...currentLeague.settings, league_average_match: 1 } } }).previews[0];
    assert.match(medianPreview.body, /Alpha are 4–0 and Charlie are 4–0, including median results/);
    assert.match(medianPreview.body, /Alpha average 122\.50/, 'median games do not double the scoring-average denominator');
    const lateStart = build(weeklyRows.map(w => ({ ...w, week: w.week + 2 })), { ...previewOptions, start: 3, end: 4, league: { ...currentLeague, settings: { start_week: 3, playoff_week_start: 8 } }, board: { ...nextBoard, week: 5 } });
    assert.match(lateStart.previews[0].body, /Across 2 completed weeks, Alpha average 122\.50/, 'scoring averages honor the league start week');
    const latestRecap = freshMatchups.stories.find(s => s.kind === 'recap' && s.week === 2 && s.rosterIds.includes(1));
    assert.match(latestRecap.body, /125\.00–100\.00/);
    assert.match(latestRecap.body.split('\n\n')[1], /Alpha are 2–0 and Bravo are 0–2/, 'visible recap copy explains the resulting records');
    assert.match(median.stories.find(s => s.kind === 'recap').body, /including median results/, 'visible records preserve their scoring scope');
    const rivalryWithForm = build(weeklyRows, { ...previewOptions, board: { week: 3, rows: weeklyRows[0].rows }, rivalries: [{ owners: ['1', '2'], name: 'The Derby' }] }).previews.find(s => s.followedRivalry);
    assert(rivalryWithForm && rivalryWithForm.text.startsWith('The Derby:'));
    assert.match(rivalryWithForm.body.split('\n\n')[0], /Through Week 2, Alpha are 2–0 and Bravo are 0–2/);
    assert.match(rivalryWithForm.body.split('\n\n')[1], /recorded series/);
    assert.equal(rivalryWithForm.weight, 84, 'current context preserves the priority of a rivalry the user follows');
    void ('PASS matchup reporting: current stakes, visible result significance, median-aware averages, incomplete/stale cutoffs, new pairings and selected rivalries');
    const priorInfo = { ...earlier.league, previous_league_id: null };
        const rootInfo = { ...league(2026), previous_league_id: priorInfo.league_id };
        const responses = {
            L2026: rootInfo, L2025: priorInfo,
            'L2025/rosters': priorInfo.rosters, 'L2025/users': priorInfo.users,
            'L2025/matchups/1': earlier.weeks[0].rows,
        };
        let calls = 0;
        const fetcher = async url => { calls++; const key = url.split('/league/')[1]; return { ok: key in responses, json: async () => responses[key] }; };
        const progress = [];
        const archive = await Journal.loadArchive({ league: rootInfo, fetcher, force: true, onProgress: r => progress.push(r.seasons.length) });
        assert.equal(archive.complete, true);
        assert.equal(archive.seasons.length, 1);
        assert(progress.includes(1));
        const previousCalls = calls;
        await Journal.loadArchive({ league: rootInfo, fetcher });
        assert.equal(calls, previousCalls, 'warm archive reuses cached seasons');
        responses.L2025.previous_league_id = 'missing';
        const partial = await Journal.loadArchive({ league: rootInfo, fetcher, force: true });
        assert.equal(partial.complete, false);
        assert.equal(partial.seasons.length, 1, 'partial archive keeps verified seasons');
        responses.L2025.previous_league_id = 'L2026';
        assert.equal((await Journal.loadArchive({ league: rootInfo, fetcher, force: true })).complete, false, 'cycles cannot become all-time coverage');
        responses.L2025.previous_league_id = null;
        responses['L2025/matchups/1'] = [row(1,100),row(2,null)];
        assert.equal((await Journal.loadArchive({ league: rootInfo, fetcher, force: true })).complete, false, 'missing totals cannot establish records');
        const abort = new AbortController(); abort.abort();
        await assert.rejects(Journal.loadArchive({ league: rootInfo, fetcher, force: true, signal: abort.signal }), /interrupted/);
        void ('PASS Wire journal: owner continuity, revenge, streak resets, median results, playoff boundaries, milestones, rule changes, history caching, partial data and cancellation');
});

test('C2 league stories: recaps, record ties, custom totals, streaks, missing weeks, format boundaries (from tests/league-wire.js)', () => {
    const context = { console, setTimeout, clearTimeout, AbortController, fetch: () => { throw Error('Unexpected network'); } };
    context.window = context;
    vm.createContext(context);
    for (const file of ['league-live-scores.js', 'league-wire-journal.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
    const row = (id, score, matchup = 1, extra = {}) => ({ roster_id: id, points: score, matchup_id: matchup, ...extra });
    const weeks = [
        { week: 1, rows: [row(1, 100), row(2, 99), row(3, 80, 2), row(4, 70, 2)] },
        { week: 2, rows: [row(1, 120), row(2, 110), row(3, 90, 2), row(4, 70, 2)] },
        { week: 3, rows: [row(1, 140, 1, { starters: ['p1', 'bench'], players_points: { p1: 30, bench: 20, unused: 60 } }), row(2, 139), row(3, 85, 2), row(4, 80, 2)] },
    ];
    const build = (data = weeks, end = 3, extras = {}) => context.WrWireStories.build({ weeks: data, start: 1, end, nameFor: id => 'Team ' + id, playerName: id => 'Player ' + id, ...extras });
    const edition = build();
    assert.equal(edition.high, 140);
    assert.equal(edition.stories.filter(s => s.kind === 'recap').length, 6);
    assert(!edition.stories.some(s => s.week === 1 && s.kind === 'record'), 'opening baseline is not a broken record');
    assert(edition.stories.some(s => /3 straight/.test(s.text)));
    assert(edition.stories.some(s => /No justice|cruel draw|score big/.test(s.text)));
    assert(edition.stories.some(s => /Player p1 led/.test(s.body)));
    assert(!edition.stories.some(s => /unused/.test(s.body)), 'bench players cannot earn winning-starter credit');
    assert.equal(build(weeks, 2).high, 120, 'current and future weeks excluded');
    assert.equal(build([weeks[0], weeks[2]]).high, 100, 'missing week stops record and streak claims');
    assert.equal(build([{ week: 1, rows: [row(1, 500, 1, { custom_points: 50 }), row(2, 60)] }], 1).high, 60);
    const ties = build([{ week: 1, rows: [row(1, 100), row(2, 100)] }, { week: 2, rows: [row(1, 100), row(2, 100)] }], 2);
    assert(ties.stories.some(s => /finish level/.test(s.text)));
    assert(ties.stories.some(s => /Season scoring high matched/.test(s.text)));
    assert(!ties.stories.some(s => /winning margin|straight|winning starters/.test(s.body + s.text)));
    assert.equal(ties.records.length, 4, 'all tied record holders retained');
    assert.equal(build([{ week: 1, rows: [row(1, null), row(2, 80)] }], 1).stories.length, 0);
    assert(!build(weeks, 3, { headToHead: false }).stories.some(s => s.kind === 'recap' || /straight/.test(s.text)), 'non-head-to-head formats do not get game narratives');
    // Deterministic: the same evidence always yields the same edition (no randomness, no AI).
    assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});

test('review fixes: unplayed weeks, History made needs a comparable prior season, scoring comparison, guillotine field', async () => {
    const context = { console, setTimeout, clearTimeout, AbortController, App: {} };
    context.window = context;
    vm.createContext(context);
    for (const file of ['league-live-scores.js', 'chopped.js', 'league-wire-journal.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
    const J = context.WrWireStories;
    const row = (rid, pts, m = 1, extra = {}) => ({ roster_id: rid, points: pts, matchup_id: m, ...extra });
    const lg = (extra = {}) => ({ league_id: 'D', season: '2026', settings: { playoff_week_start: 15, playoff_teams: 2 }, scoring_settings: { rec: 1 }, roster_positions: ['QB'], rosters: [1, 2, 3, 4].map(i => ({ roster_id: i, owner_id: 'o' + i })), ...extra });
    const zeros = { week: 1, rows: [row(1, 0, 1, { starters: [] }), row(2, 0, 1, { starters: [] }), row(3, 0, 2, { starters: [] }), row(4, 0, 2, { starters: [] })] };
    // B1: pre-draft league — every team 0.00 with empty lineups.
    const pre = J.build({ league: lg(), weeks: [zeros, { ...zeros, week: 2 }], start: 1, end: 2, nameFor: r => 'T' + r, board: { week: 3, rows: zeros.rows } });
    assert.equal(pre.completedThrough, 0, 'the edition stops before the first unplayed week');
    assert.equal(pre.stories.length, 0, 'no “finish level — 0.00 apiece”, no 0.00 scoring crown');
    assert.equal(pre.previews.length, 0, 'no previews with made-up records or halved averages');
    assert.equal(pre.table.length, 0);
    assert(!JSON.stringify(pre).includes('0.00 points'));
    // Lineups set but nobody started (a week that has not begun) is also unplayed.
    assert.equal(J.played([row(1, 0.4, 1, { starters: ['0'] }), row(2, 0, 1, { starters: [] })]), false);
    assert.equal(J.played([row(1, 88, 1, { starters: ['p'] }), row(2, 0, 1, { starters: ['q'] })]), true);
    // A real week, then an unplayed one: results stop at week 1.
    const real = { week: 1, rows: [row(1, 100), row(2, 90), row(3, 80, 2), row(4, 70, 2)] };
    const stop = J.build({ league: lg(), weeks: [real, { ...zeros, week: 2 }], start: 1, end: 2, nameFor: r => 'T' + r });
    assert.equal(stop.completedThrough, 1);
    // S1: no comparable prior season → no "History made".
    const other = { league: { ...lg({ league_id: 'P', season: '2025', scoring_settings: { rec: 0.5 } }), users: [] }, weeks: [{ week: 1, rows: [row(1, 300), row(2, 10), row(3, 10, 2), row(4, 10, 2)] }] };
    const two = [real, { week: 2, rows: [row(1, 150), row(2, 90), row(3, 80, 2), row(4, 70, 2)] }];
    const noHistory = J.build({ league: lg(), weeks: two, start: 1, end: 2, priorSeasons: [other], nameFor: r => 'T' + r });
    assert(!noHistory.stories.some(s => s.category === 'History made'), 'incomparable seasons cannot anchor an archive record');
    assert(noHistory.stories.some(s => /A new season scoring high/.test(s.text)), 'the season record still reports');
    const same = { ...other, league: { ...other.league, scoring_settings: { rec: 1 } }, weeks: [{ week: 1, rows: [row(1, 120), row(2, 10), row(3, 10, 2), row(4, 10, 2)] }] };
    assert(J.build({ league: lg(), weeks: two, start: 1, end: 2, priorSeasons: [same], nameFor: r => 'T' + r }).stories.some(s => s.category === 'History made' && /previous archived high of 120\.00/.test(s.body)));
    // Nit: 0-valued keys and float noise are not rule changes.
    assert.equal(J.signature({ scoring_settings: { rec: 1, fgm_yds: 0.10000000149, bonus: 0 } }), J.signature({ scoring_settings: { rec: 1, fgm_yds: 0.1 } }));
    assert.notEqual(J.signature({ scoring_settings: { rec: 1 } }), J.signature({ scoring_settings: { rec: 0.5 } }));
    // Guillotine: the chopped team is not part of the field.
    const chopped = lg({ settings: { type: 3, playoff_week_start: 15 }, rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }, { roster_id: 3, owner_id: 'c', settings: { eliminated: 1 } }] });
    const g = J.build({ league: chopped, headToHead: false, start: 1, end: 2, nameFor: r => 'T' + r, weeks: [{ week: 1, rows: [row(1, 100, null), row(2, 90, null), row(3, 50, null)] }, { week: 2, rows: [row(1, 110, null), row(2, 95, null), row(3, 0, null)] }] });
    assert(g.stories.some(s => s.week === 1 && /in a 3-team field/.test(s.body)), 'alive in the week it was chopped');
    assert(g.stories.some(s => s.week === 2 && /in a 2-team field/.test(s.body)), 'chopped teams leave the field');
    // S2 support: loadArchive reports the provider link it read.
    const fetcher = async url => ({ ok: true, json: async () => (url.endsWith('/D') ? { league_id: 'D', previous_league_id: null } : null) });
    assert.equal((await J.loadArchive({ league: lg(), fetcher, force: true })).previousLeagueId, null);
    const fetcher2 = async url => (url.endsWith('/E') ? { ok: true, json: async () => ({ league_id: 'E', previous_league_id: 'P9' }) } : { ok: false });
    assert.equal((await J.loadArchive({ league: lg({ league_id: 'E' }), fetcher: fetcher2, force: true })).previousLeagueId, 'P9');
});
