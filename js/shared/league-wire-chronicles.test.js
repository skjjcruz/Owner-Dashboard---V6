// Run with:  node --test js/shared/league-wire-chronicles.test.js
// The Wire's championship history is built ONLY from Sleeper's playoff
// brackets (via the WrHistory cache). Rewritten from C2's
// tests/league-wire-chronicles.cjs, whose fixtures were two real leagues'
// private spreadsheet history — none of that data is used or shipped here.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');

function load(extra = {}) {
    const root = { console, ...extra }; root.window = root;
    vm.createContext(root);
    for (const file of ['league-live-scores', 'league-live-table', 'league-wire-chronicles', 'league-wire-journal']) vm.runInContext(fs.readFileSync(path.join(__dirname, `${file}.js`), 'utf8'), root);
    return root;
}
const league = { league_id: 'L2026', previous_league_id: 'L2025', season: '2026', name: 'Sample League', settings: { playoff_week_start: 15 }, rosters: [{ roster_id: 1, owner_id: 'u1' }, { roster_id: 2, owner_id: 'u2' }] };
const history = { leagueId: 'L2026', championships: {
    2025: { championName: 'Alpha 25', championOwnerId: 'u1', runnerUpName: 'Bravo 25', runnerUpOwnerId: 'u2' },
    2024: { championName: 'Alpha 24', championOwnerId: 'u1', runnerUpName: 'Bravo 24', runnerUpOwnerId: 'u2' },
    2022: { championName: 'Charlie 22', championOwnerId: 'u3', runnerUpName: 'Alpha 22', runnerUpOwnerId: 'u1' },
} };
const seasons = [{ league: { league_id: 'L2025', season: '2025' } }, { league: { league_id: 'L2024', season: '2024' } }];
const w = (week, a, b) => ({ week, rows: [{ roster_id: 1, matchup_id: 1, points: a }, { roster_id: 2, matchup_id: 1, points: b }] });

test('Sleeper-only book: identity, sources, no invented scores, registry scope', () => {
    const root = load();
    const C = root.WrWireChronicles;
    assert.equal(C.fromSleeperHistory({ league, history: { ...history, leagueId: 'OTHER' } }), null, 'another league\'s history cache is rejected');
    assert.equal(C.fromSleeperHistory({ league, history: { championships: {} } }), null);
    const book = C.fromSleeperHistory({ league, history, seasons });
    assert.deepEqual(JSON.parse(JSON.stringify(book.facts.map(f => f.id))), ['sleeper-final-2025', 'sleeper-final-2024', 'sleeper-final-2022']);
    assert(book.facts.every(f => f.classification === 'sleeper' && f.scores === null));
    assert.equal(book.facts[0].sources[0].url, 'https://api.sleeper.app/v1/league/L2025/winners_bracket');
    assert.equal(book.facts[2].sources[0].url, undefined, 'unknown season league id → label only, no guessed URL');
    assert(C.register(book));
    assert.equal(C.register(C.fromSleeperHistory({ league, history, seasons })), false, 'identical rebuild is a no-op');
    assert.equal(C.select({ league_id: 'L2024', season: '2024' }), C.select(league), 'past-season editions share the book');
    assert.equal(C.select({ league_id: 'unrelated', name: 'Sample League' }), null, 'a matching name never selects a book');
    // syncFromHistory reads only the WrHistory cache (no fetch).
    let asked = null;
    const r2 = load({ WrHistory: { getCached: id => { asked = id; return history; } } });
    assert(r2.WrWireChronicles.syncFromHistory(league, seasons));
    assert.equal(asked, 'L2026');
    const r3 = load({ WrHistory: { getCached: () => null } });
    assert.equal(r3.WrWireChronicles.syncFromHistory(league), null);
});

test('Editions: lookbacks, back-to-back, season cutoff, title watch, rematches, owner continuity', () => {
    const root = load();
    root.WrWireChronicles.register(root.WrWireChronicles.fromSleeperHistory({ league, history, seasons }));
    const make = (lg = league, extra = {}) => root.WrWireStories.build({ league: lg, weeks: [], end: 0, nameFor: rid => `Current ${rid}`, ...extra });
    const book = make();
    assert(book.chronicle);
    assert.equal(book.high, null, 'title games do not change regular-season highs');
    assert.equal(book.rivals.length, 0, 'championships are not regular-season rivalry wins');
    assert(book.stories.some(s => s.text === 'Looking back: Alpha 25’s 2025 title' && s.documentary && /according to Sleeper’s playoff bracket/.test(s.body)));
    assert(book.stories.some(s => s.category === 'Dynasty watch' && /2024–2025 back-to-back/.test(s.text) && /same opponent reached both finals/.test(s.body)));
    assert(book.stories.every(s => s.sources.length && s.eventSeason < 2026));
    assert(!book.stories.some(s => /\d+\.\d{2}/.test(s.body)), 'no scores in title prose — none are stored');
    const old = make({ ...league, league_id: 'L2024', previous_league_id: 'L2023', season: '2024' });
    assert(old.stories.every(s => s.eventSeason < 2024), 'a 2024 edition never knows the 2024 or 2025 titles');
    const replacement = { ...league, rosters: [{ roster_id: 1, owner_id: 'replacement' }, league.rosters[1]] };
    const board = { week: 1, rows: [{ roster_id: 1, points: 0, matchup_id: 1 }, { roster_id: 2, points: 0, matchup_id: 1 }] };
    const rematch = make(league, { board }).previews.find(s => s.id.startsWith('title-rematch:'));
    assert(rematch && /2025 final/.test(rematch.body) && rematch.related.some(r => /2024 final/.test(r.text)));
    assert(!make(replacement, { board }).previews.some(s => s.id.startsWith('title-rematch:')), 'slot replacement never inherits titles');
    const played = make(league, { end: 1, weeks: [w(1, 100, 90)] });
    assert(played.stories.find(s => s.kind === 'recap').related.some(r => r.label === 'Championship history'));
    assert.equal(played.high, 100);
    const current = make(league, { end: 2, weeks: [w(1, 90, 100), w(2, 90, 100)] });
    const watch = current.stories.find(s => s.contextual && s.rosterIds.includes(1));
    assert(watch && !watch.documentary && /3 titles in a row\?$/.test(watch.text), 'two straight titles → a bid for three');
    assert.match(watch.body.split('\n\n')[0], /Current 1 are 0–2 through Week 2/);
    assert(watch.related.some(r => /not official playoff seeds or a championship forecast/.test(r.text)), 'forward-looking piece is labelled');
    assert(!make(league).stories.some(s => s.contextual), 'no current record → no form-based title story');
    assert(!make(league, { end: 2, weeks: [w(1, 90, 100)] }).stories.some(s => s.contextual), 'missing weeks are not current form');
    assert(!make(replacement, { end: 1, weeks: [w(1, 100, 90)] }).stories.some(s => s.contextual && s.rosterIds.includes(1)), 'replacement owners do not inherit a pedigree');
    const medianWatch = make({ ...league, settings: { ...league.settings, league_average_match: 1 } }, { end: 1, weeks: [w(1, 90, 100)] }).stories.find(s => s.contextual && s.rosterIds.includes(1));
    assert.match(medianWatch.body, /0–2 through Week 1, including median results/);
    assert(root.WrWireStories.frontPage(current.stories).every(s => !s.documentary), 'archive facts never take front-page slots');
    assert(root.WrWireStories.weeklyLookback(current.stories, 'L2026:2').documentary);
    const rivalry = make(league, { end: 2, weeks: [w(1, 90, 100), w(2, 90, 100)], board: { ...board, week: 3 }, rivalries: [{ owners: ['u1', 'u2'], name: 'The Finals Feud' }] });
    assert.equal(rivalry.previews.length, 1, 'one story per matchup');
    assert.match(rivalry.previews[0].text, /^The Finals Feud:/);
    assert(rivalry.previews[0].related.some(r => r.label === 'Championship history'));
});

test('No private chronicle data ships: no data file, no hand-entered facts, no AI, deterministic', () => {
    const repo = path.join(__dirname, '..', '..');
    assert(!fs.existsSync(path.join(__dirname, 'league-wire-chronicles-data.js')), 'league-wire-chronicles-data.js must not be ported');
    const wire = fs.readdirSync(__dirname).filter(f => /^league-wire/.test(f) && !/\.test\.js$/.test(f)).map(f => path.join(__dirname, f))
        .concat(fs.readdirSync(path.join(repo, 'js', 'components')).filter(f => /^league-wire/.test(f)).map(f => path.join(repo, 'js', 'components', f)));
    for (const file of wire) {
        const text = fs.readFileSync(file, 'utf8');
        assert(!/WrWireChroniclesData\s*[=[.]/.test(text) || /never|not ported|NOT ported/.test(text), path.basename(file) + ' must not read a chronicle data file');
        assert(!/workbook|\.xlsx/i.test(text) || /hand-entered|spreadsheet|workbook facts/i.test(text), path.basename(file) + ' must not cite spreadsheet facts');
        assert(!/ai-analyze|callAI|anthropic|openai|dhq-ai/i.test(text), path.basename(file) + ' makes no AI calls');
        assert(!/Math\.random/.test(text), path.basename(file) + ' is deterministic');
    }
});
