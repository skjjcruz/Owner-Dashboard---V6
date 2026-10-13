// js/shared/sleeper-proj.test.js — the Monday-night keep (owner report
// 2026-10-12): rows Sleeper drops after a game come back; rows dropped
// before kickoff stay dropped (truth law).
const test = require('node:test');
const assert = require('node:assert');

function load(store) {
    global.window = global;
    global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
    global.App = { WeeklyProj: { _ctx: { byTeamWeek: { 'LAR|5': { kickoff: '2026-10-13T00:15Z' }, 'DAL|5': { kickoff: '2026-10-09T00:15Z' } } } } };
    global.S = { players: { a: { team: 'DAL' }, b: { team: 'LAR' }, c: { team: 'LAR' } } };
    delete require.cache[require.resolve('./sleeper-proj.js')];
    require('./sleeper-proj.js');
    return global.App.SleeperProj;
}

test('a row dropped after his game kicked off comes back; fresh rows win', () => {
    const store = { dhq_sleeper_week_v1: JSON.stringify({ key: '2026|5', rows: { a: { pts_ppr: 9 }, b: { pts_ppr: 4 } } }) };
    const SP = load(store);
    const thin = { b: { pts_ppr: 5 }, z: { adp_dd_ppr: 1000 } };
    const m = SP._withKept('2026|5', thin, Date.parse('2026-10-13T01:00Z'));
    assert.equal(m.a.pts_ppr, 9);        // DAL played Thursday: kept
    assert.equal(m.b.pts_ppr, 5);        // fresh row wins
});

test('a row dropped before his kickoff stays dropped (truth law)', () => {
    const store = { dhq_sleeper_week_v1: JSON.stringify({ key: '2026|5', rows: { c: { pts_ppr: 6 } } }) };
    const SP = load(store);
    const m = SP._withKept('2026|5', {}, Date.parse('2026-10-12T20:00Z'));   // before LAR kicks off
    assert.equal(m.c, undefined);
});

test('another week\'s kept rows are ignored', () => {
    const store = { dhq_sleeper_week_v1: JSON.stringify({ key: '2026|4', rows: { a: { pts_ppr: 9 } } }) };
    const SP = load(store);
    const m = SP._withKept('2026|5', {}, Date.parse('2026-10-13T01:00Z'));
    assert.equal(m.a, undefined);
});
