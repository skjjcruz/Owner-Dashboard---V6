// Run with:  node --test js/shared/league-wire-features.test.js
// League life + identity (C2 tests/league-wire-features.cjs,
// league-wire-identity.cjs, league-wire-feature-ui.cjs @1be683d, ported).
// Dynasty HQ differences under test: no opinion pieces (name ratings), owner
// names only from Sleeper (no sourcebook), team logos as C2 shows them (Sleeper CDN only).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const babel = require('@babel/standalone');
const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function engines() {
    const root = { console }; root.window = root; vm.createContext(root);
    for (const file of ['league-live-scores', 'league-wire-chronicles', 'league-wire-identity', 'league-wire-features', 'league-wire-journal']) vm.runInContext(read(`js/shared/${file}.js`), root);
    return root;
}
const row = (roster_id, points, matchup_id) => ({ roster_id, points, matchup_id });
const league = { league_id: '26', previous_league_id: '25', season: '2026', settings: { playoff_week_start: 5, league_average_match: 1 },
    rosters: ['alice', 'bob', 'carol', 'dan', 'erin', 'fred'].map((owner_id, i) => ({ roster_id: i + 1, owner_id })),
    users: ['Alice', 'Bob', 'Carol', 'Dan', 'Erin', 'Fred'].map((display_name, i) => ({ user_id: display_name.toLowerCase(), display_name, metadata: { team_name: ['New Hat', 'Bench Press', 'The Points Department', 'Fourth and Long', 'Bye Curious', 'Sunday Best'][i] } })) };
const earlier = { league: { ...league, league_id: '25', previous_league_id: null, season: '2025', rosters: [{ roster_id: 1, owner_id: 'bob' }, { roster_id: 2, owner_id: 'alice' }, ...league.rosters.slice(2)],
    users: league.users.map(user => user.user_id === 'alice' ? { ...user, metadata: { team_name: 'Old Hat' } } : user) }, weeks: [] };
const weeks = [
    { week: 1, rows: [row(1, 101, 1), row(2, 100, 1), row(3, 150, 2), row(4, 80, 2), row(5, 90, 3), row(6, 70, 3)] },
    { week: 2, rows: [row(1, 110, 1), row(2, 108, 1), row(3, 150, 2), row(4, 80, 2), row(5, 70, 3), row(6, 60, 3)] },
    { week: 3, rows: [row(1, 1000, 1), row(2, 900, 1), row(3, 800, 2), row(4, 700, 2), row(5, 600, 3), row(6, 500, 3)] },
];
// Our league-wire.js builds the edition, then enriches it (C2 did both inside its journal).
function edition(root, extra = {}) {
    const opts = { league, weeks, start: 1, end: 2, nameFor: rid => root.WrWireStories.oldName(extra.league || league, rid), priorSeasons: [earlier], headToHead: true, ...extra };
    return root.WrWireFeatures.enrich(root.WrWireStories.build(opts), opts);
}

test('C2 League life: grounded short stories, owner-first bylines, close-game evidence, median scope, real name changes, boundaries', () => {
    const root = engines();
    const ed = edition(root);
    assert.deepEqual(plain(ed.features.map(f => f.featureType).sort()), ['cardiac-club', 'new-threads', 'wrong-opponent']);
    assert(ed.weeklyFeature && ed.features.some(f => f.id === ed.weeklyFeature.id));
    assert(ed.features.every(f => f.feature === true && f.sources.length > 0 && f.week === 2 && f.participants.length > 0));
    assert(ed.features.every(f => f.body.split(/\s+/).length < 110 && f.body.split('\n\n').length === 2));
    assert(ed.features.every(f => f.sources.every(s => /^https:\/\/api\.sleeper\.app\/v1\/league\//.test(s.url))), 'every receipt is a Sleeper endpoint');
    assert(!ed.stories.some(s => s.feature), 'the lighter-side desk does not crowd hard-news coverage');
    assert.equal(edition(root).weeklyFeature.id, ed.weeklyFeature.id, 'weekly selection is stable on reload');
    assert.equal(edition(root, { weeks: weeks.slice().reverse() }).weeklyFeature.id, ed.weeklyFeature.id, 'provider row order does not change the pick');
    const cardiac = ed.features.find(f => f.featureType === 'cardiac-club');
    assert.match(cardiac.text, /^Another close finish for Alice$/);
    assert.match(cardiac.body, /2 head-to-head games.*2–0 record/);
    assert.match(cardiac.body, /110\.00–108\.00.*2\.00-point margin/);
    assert.equal(cardiac.participants[0].ownerName, 'Alice'); assert.equal(cardiac.participants[0].teamName, 'New Hat');
    const unlucky = ed.features.find(f => f.featureType === 'wrong-opponent');
    assert.match(unlucky.text, /^Bob had the points, but the wrong opponent$/);
    assert.match(unlucky.body, /108\.00.*better than 3 of the other 5 teams/);
    assert.match(unlucky.body, /win in the separate median game/);
    assert(!/1,000|1000\.00|Week 3/.test(JSON.stringify(ed.features)), 'later results cannot leak into an earlier edition');
    const makeover = ed.features.find(f => f.featureType === 'new-threads');
    assert.match(makeover.body, /2025, Alice ran “Old Hat”\./); assert.match(makeover.body, /team is “New Hat/);
    assert.match(makeover.body, /record under the new name is 4–0, including median games/);
    assert.equal(makeover.participants[0].rosterId, 1, 'a name change follows the owner even when the roster slot changed');
    const linkedOlder = { league: { ...earlier.league, league_id: '24', season: '2024', users: earlier.league.users.map(user => user.user_id === 'alice' ? { ...user, metadata: { team_name: 'Ancient Hat' } } : user) }, weeks: [] };
    const names = edition(root, { priorSeasons: [{ ...earlier, league: { ...earlier.league, previous_league_id: '24' } }, linkedOlder] }).features.find(f => f.featureType === 'name-archive');
    assert(names); assert.match(names.body, /Old Hat.*2025/); assert.match(names.body, /Ancient Hat.*2024/);
    assert.equal(names.category, 'Name archive');
    const reboundWeeks = plain(weeks); reboundWeeks[1].rows[3].points = 170;
    const bounce = edition(root, { weeks: reboundWeeks }).features.find(f => f.featureType === 'bounce-back');
    assert(bounce); assert.match(bounce.body, /80.00 points and a loss.*170.00 and a head-to-head win/);
    assert(!bounce.body.includes('injur'), 'a rebound has no invented cause');
    assert.equal(edition(root, { weeks: weeks.filter(w => w.week !== 1) }).features.length, 0, 'a missing completed week cannot generate features');
    assert.equal(edition(root, { weeks: [], end: 0 }).features.length, 0);
    assert.equal(edition(root, { end: 5 }).features.length, 0, 'regular-season features do not consume playoff rows');
    assert.equal(edition(root, { headToHead: false }).features.length, 0, 'guillotine / non-H2H: no League life stories');
    assert.equal(edition(root, { league: { ...league, type: 'chopped' } }).features.length, 0);
    const unknown = edition(root, { league: { ...league, rosters: league.rosters.map(r => r.roster_id === 1 ? { ...r, owner_id: 'replacement' } : r) } });
    assert(!unknown.features.some(f => f.featureType === 'new-threads'), 'a replacement does not inherit a team-name history');
    assert(!edition(root, { priorSeasons: [{ ...earlier, league: { ...earlier.league, league_id: 'unrelated' } }] }).features.some(f => f.featureType === 'new-threads'), 'an unrelated league is not this league’s history');
    assert(!edition(root, { league: { ...league, users: league.users.map(u => ({ ...u, metadata: {} })) } }).features.some(f => f.featureType === 'new-threads'), 'display names are not invented team names');
    const original = JSON.stringify({ league, weeks, earlier }); edition(root);
    assert.equal(JSON.stringify({ league, weeks, earlier }), original, 'source data unchanged');
});

test('Dynasty HQ: no opinion pieces (team-name ratings) and no "favorite" judgments', () => {
    const root = engines();
    const caps = edition(root, { league: { ...league, users: league.users.map((user, i) => ({ ...user, metadata: { team_name: i === 0 ? 'HERE COME THE GRANNIES' : 'Plain Name ' + i } })) } });
    assert(!caps.features.some(f => /name-game|opinion/i.test(f.featureType + ' ' + f.category)), 'the Name desk opinion is not ported');
    const src = read('js/shared/league-wire-features.js').replace(/^\s*\/\/.*$/gm, '');
    assert(!/reviewName|Our favorite|stadium announcement|could use an edit/.test(src));
});

test('Identity: Sleeper display names only; owner follows the account across slots; ambiguity → unknown', () => {
    const root = engines(), api = root.WrWireIdentity;
    assert.deepEqual(Object.keys(api).sort(), ['forOwner', 'initials', 'logoSources', 'resolve', 'storyMarks']);
    const one = { league_id: '1356311207652360192', season: '2026', rosters: [{ roster_id: 7, owner_id: '540392203863576576' }], users: [{ user_id: '540392203863576576', display_name: 'skjjcruz', metadata: { team_name: 'Dirty Mike and the boys' } }] };
    assert.deepEqual(plain(api.resolve(one, 7)), { ownerId: '540392203863576576', ownerName: 'skjjcruz', teamName: 'Dirty Mike and the boys', ownerKnown: true }, 'no private sourcebook name: the Sleeper display name');
    // Even a registered book carrying C2-style owner bindings cannot rename anyone.
    root.WrWireChronicles.select = () => ({ leagueIds: ['current', 'past'], ownerBindings: [{ ownerId: 'a', documentedName: 'Alice Adams', evidence: [{ sources: [{ url: 'https://example.com' }] }] }] });
    const cur = { league_id: 'current', season: '2026', previous_league_id: 'past', rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }, { roster_id: 3, owner_id: 'replacement' }], users: [
        { user_id: 'a', display_name: 'alice_handle', metadata: { team_name: 'The Same Team' } }, { user_id: 'b', display_name: 'blake_handle', metadata: { team_name: 'The Same Team' } }, { user_id: 'replacement', display_name: 'NewManager', metadata: { team_name: 'Legacy Team' } }] };
    const old = { league_id: 'past', season: '2025', previous_league_id: null, rosters: [{ roster_id: 1, owner_id: 'b' }, { roster_id: 2, owner_id: 'a' }, { roster_id: 3, owner_id: 'former' }], users: [
        { user_id: 'a', display_name: 'alice_old_handle', metadata: { team_name: 'Alice’s Old Team' } }, { user_id: 'b', display_name: 'blake_old_handle', metadata: { team_name: 'Blake’s Old Team' } }, { user_id: 'former', display_name: 'former_handle', metadata: { team_name: 'Legacy Team' } }] };
    const priorSeasons = [{ league: old, weeks: [] }];
    assert.equal(api.resolve(cur, 1).ownerName, 'alice_handle');
    assert.equal(api.resolve(old, 2).ownerName, 'alice_old_handle', 'the season’s own account row');
    assert.equal(api.resolve(old, 2).teamName, 'Alice’s Old Team');
    assert.notEqual(api.resolve(cur, 2).ownerId, api.resolve(cur, 1).ownerId, 'two matching team names remain distinct owners');
    assert.equal(api.resolve(cur, 3, { priorSeasons }).ownerName, 'NewManager', 'a replacement does not inherit the previous slot owner’s name');
    assert.deepEqual(plain(api.forOwner(cur, 'former', { priorSeasons })), { ownerId: 'former', ownerName: 'former_handle', teamName: 'Legacy Team', ownerKnown: true });
    assert.equal(api.forOwner(cur, 'a', { priorSeasons }).teamName, 'The Same Team');
    const overridden = api.resolve(cur, 1, { teamName: '  A custom display label  ' });
    assert.equal(overridden.teamName, 'A custom display label'); assert.equal(overridden.ownerName, 'alice_handle', 'a display override cannot redefine owner identity');
    const accountOnly = { league_id: 'unknown', season: '2026', rosters: [{ roster_id: 1, owner_id: 'u' }], users: [{ user_id: 'u', username: 'user_handle', metadata: { team_name: 'A Human Looking Team Name' } }] };
    assert.equal(api.resolve(accountOnly, 1).ownerName, 'user_handle', 'username fallback');
    const unknownName = api.resolve({ ...accountOnly, users: [{ user_id: 'u', metadata: { team_name: 'Imagined Owner Name' } }] }, 1);
    assert.equal(unknownName.ownerName, null); assert.equal(unknownName.ownerKnown, false); assert.equal(unknownName.teamName, 'Imagined Owner Name', 'a team name is never promoted to an owner name');
    assert.deepEqual(plain(api.resolve({ ...accountOnly, rosters: [{ roster_id: 1 }] }, 1)), { ownerId: null, ownerName: null, teamName: 'Team 1', ownerKnown: false });
    assert.equal(api.resolve({ ...accountOnly, rosters: [{ roster_id: 1, owner_id: 'u' }, { roster_id: 1, owner_id: 'v' }] }, 1).ownerId, null, 'duplicate roster slots do not choose an owner');
    assert.equal(api.resolve({ ...accountOnly, users: [{ user_id: 'u', display_name: 'First' }, { user_id: 'u', display_name: 'Other' }] }, 1).ownerKnown, false);
    assert.equal(api.initials('Équipe Montréal'), 'ÉM'); assert.equal(api.initials(''), 'WR');
});

test('Logos as C2 shows them: team logo, else owner avatar, else initials; Sleeper CDN only; max two per story', () => {
    const api = engines().WrWireIdentity;
    const lg = { league_id: 'L', season: '2026', name: 'Test League', avatar: 'leagueav1', rosters: [{ roster_id: 1, owner_id: 'a' }, { roster_id: 2, owner_id: 'b' }, { roster_id: 3, owner_id: 'c' }, { roster_id: 4, owner_id: 'd' }], users: [
        { user_id: 'a', display_name: 'alice', avatar: 'abc123', metadata: { avatar: 'https://sleepercdn.com/uploads/team-a.jpg' } },
        { user_id: 'b', display_name: 'blake', avatar: 'def456', metadata: {} },
        { user_id: 'c', display_name: 'casey', avatar: 'ghi789', metadata: { avatar: 'https://evil.example.com/x.jpg' } },
        { user_id: 'd', display_name: 'drew', metadata: { avatar: 'https://sleepercdn.com/uploads/../../x.jpg' } }] };
    assert.deepEqual(plain(api.logoSources(lg, 1)), ['https://sleepercdn.com/uploads/team-a.jpg', 'https://sleepercdn.com/avatars/thumbs/abc123'], 'team logo first, then the owner avatar');
    assert.deepEqual(plain(api.logoSources(lg, 2)), ['https://sleepercdn.com/avatars/thumbs/def456']);
    assert.deepEqual(plain(api.logoSources(lg, 3)), ['https://sleepercdn.com/avatars/thumbs/ghi789'], 'a non-Sleeper image is never used');
    assert.deepEqual(plain(api.logoSources(lg, 4)), [], 'path tricks are rejected → initials');
    assert.deepEqual(plain(api.logoSources(lg)), ['https://sleepercdn.com/avatars/thumbs/leagueav1'], 'league avatar when no team');
    assert.deepEqual(plain(api.logoSources({ ...lg, rosters: [...lg.rosters, { roster_id: 1, owner_id: 'z' }] }, 1)), [], 'a conflicting roster slot gets no logo');
    const marks = api.storyMarks(lg, { rosterIds: [1, 2, 3] });
    assert.equal(marks.length, 2, 'at most two marks');
    assert.equal(marks[0].initials, 'AL'); assert.equal(marks[0].sources[0], 'https://sleepercdn.com/uploads/team-a.jpg');
    assert.equal(api.storyMarks(lg, { documentary: true, eventSeason: 2019 })[0].initials, '2019', 'archive stories carry the season, no logo');
    assert.equal(api.storyMarks(lg, {})[0].label, 'Test League', 'league stories carry the league mark');
});

// ── UI ──
const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
// Expand hook-free sub-components (story cards, bylines) so their text is visible.
const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function' && ['WrWireFeatureStory', 'WrWirePeople'].includes(node.type.name)) return expand(node.type({ ...node.props }));
    return { ...node, children: (node.children || []).map(expand) };
};
function harness(extra = {}) {
    let cursor = 0, owner = 'account:a', tree;
    const slots = [], effects = [], timers = new Map(), calls = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }), Fragment: 'fragment',
        useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
        useRef: initial => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useMemo: fn => { cursor++; return fn(); },
        useEffect: (fn, deps) => { const i = cursor++, old = slots[i]; if (!old || deps.some((v, n) => v !== old.deps[n])) { slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
    };
    const window = { AbortController, WrWireRivalries: { scope: () => owner }, WrWireReading: { paragraphs: body => String(body || '').split('\n\n') }, WrWireDraftHistory: { matches: () => true, load: args => new Promise((resolve, reject) => calls.push({ ...args, resolve, reject })) }, ...extra };
    const ctx = { window, React, console, setTimeout: fn => { const id = {}; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
    vm.createContext(ctx); vm.runInContext(babel.transform(read('js/components/league-wire-features.js'), { presets: ['react'] }).code, ctx);
    let props = { league: { league_id: '1', season: '2026' }, throughWeek: 4 };
    return { calls, window, render(update) { props = { ...props, ...update }; cursor = 0; tree = window.WrWireDraftReceipts(props); return tree; },
        effects() { while (effects.length) effects.shift()(); }, open() { nodes(tree).find(n => n.type === 'button').props.onClick(); },
        owner(value) { owner = value; }, timeout() { [...timers.values()].forEach(fn => fn()); }, unmount() { slots.forEach(s => s?.cleanup?.()); } };
}

test('Draft receipts UI: only when tapped; account/edition isolation; cancellation; timeout + retry', async () => {
    const app = harness(); let tree = app.render(); app.effects(); await settle();
    assert.equal(app.calls.length, 0, 'opening League life never downloads drafts');
    assert.match(text(tree), /only when you tap/);
    app.open(); app.render(); app.effects(); await settle(); assert.equal(app.calls.length, 1); assert.equal(app.calls[0].force, false); assert.equal(app.calls[0].maxSeasons, 8);
    app.calls[0].resolve({ status: 'ready', stories: [{ id: 'draft-1', text: 'A verified receipt', body: 'One paragraph.\n\nThe next paragraph.', participants: [{ ownerId: 'a', ownerName: 'Alice', teamName: 'Team A' }] }], coverage: ['Starting-lineup points only.'] }); await settle();
    tree = expand(app.render()); assert.match(text(tree), /A verified receipt/); assert.match(text(tree), /Alice Team A/); assert.match(text(tree), /Starting-lineup points only/);
    app.owner('account:b'); tree = app.render(); assert.doesNotMatch(text(tree), /A verified receipt/, 'a new account hides prior output before effects'); app.effects();
    app.open(); app.render(); app.effects(); await settle(); const pending = app.calls[1];
    tree = app.render({ throughWeek: 5 }); assert.doesNotMatch(text(tree), /A verified receipt/); app.effects(); assert(pending.signal.aborted, 'edition change cancels work');
    pending.resolve({ status: 'ready', stories: [{ id: 'old', text: 'Late old result', body: 'Stale' }] }); await settle(); assert.doesNotMatch(text(app.render()), /Late old result/);
    app.open(); app.render(); app.effects(); await settle(); app.timeout(); tree = app.render(); assert.match(text(tree), /took too long/); assert(app.calls[2].signal.aborted);
    app.open(); app.render(); app.effects(); await settle(); assert.equal(app.calls.length, 4, 'timeout is retryable'); app.unmount(); assert(app.calls[3].signal.aborted);
    const people = app.window.WrWirePeople({ participants: [{ ownerId: 'a', ownerName: 'Malcolm', teamName: 'Agamemnonmaxxing' }, { ownerId: 'a', ownerName: 'Malcolm', teamName: 'Agamemnonmaxxing' }, { ownerId: 'b', ownerName: null, teamName: 'Unknown owner team' }] });
    assert.match(text(people), /Malcolm Agamemnonmaxxing/); assert.equal(nodes(people).filter(n => n.type === 'li').length, 1, 'an unknown owner gets no byline');
    assert(!nodes(people).some(n => n.type === 'img'));
});

test('League life section: feature cards with bylines + sources, team/search filters, honest empty and non-H2H notes', () => {
    const root = engines(); const ed = edition(root);
    const app = harness();
    const raw = app.window.WrWireLeagueLife({ features: ed.features, headToHead: true, league, weeks, priorSeasons: [], throughWeek: 2, accountScope: 'a' });
    const tree = expand(raw);
    const t = text(tree);
    assert.match(t, /League life/); assert.match(t, /Another close finish for Alice/); assert.match(t, /Alice New Hat/);
    assert(nodes(tree).some(n => n.type?.name === 'WrWireDraftReceipts'), 'draft receipts sit in League life');
    assert(nodes(tree).some(n => n.type === 'a' && /^https:\/\/api\.sleeper\.app\/v1\/league\/26\/matchups\/\d$/.test(n.props.href)));
    assert.doesNotMatch(text(expand(app.window.WrWireLeagueLife({ features: ed.features, headToHead: true, league, teamFilter: '6' }))), /Alice/);
    assert.match(text(app.window.WrWireLeagueLife({ features: ed.features, headToHead: true, league, search: 'zzz' })), /No League life stories match/);
    assert.match(text(app.window.WrWireLeagueLife({ features: [], headToHead: false, league })), /need head-to-head matchups/);
});
