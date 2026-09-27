// Run with:  node --test js/shared/matchup-rows.test.js
// App.Matchup.sleeperWeekRows (the cache behind opponents, the schedule rail
// and the live standings baseline): failures resolve [] for every caller as
// before, but are never stored as the week's rows (30s backoff only).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let mode = 'fail', calls = 0;
const realNow = Date.now;
let clock = 1000000;
Date.now = () => clock;
globalThis.window = globalThis;
globalThis.fetch = async () => { calls++; return mode === 'fail' ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, json: async () => [{ roster_id: 1, matchup_id: 1, points: 10 }] }; };
require('./matchup.js');
const M = globalThis.App.Matchup;

test('failures resolve [] but are not cached; successes are', async () => {
    assert.deepEqual(await M.sleeperWeekRows('L', 1), []);
    assert.equal(calls, 1);
    assert.deepEqual(await M.sleeperWeekRows('L', 1), [], 'within 30s: backoff, no refetch');
    assert.equal(calls, 1);
    clock += 31000; mode = 'ok';
    const rows = await M.sleeperWeekRows('L', 1);
    assert.equal(calls, 2, 'retried after the backoff');
    assert.equal(rows.length, 1);
    await M.sleeperWeekRows('L', 1);
    assert.equal(calls, 2, 'success cached');
    // Existing callers keep their behaviour: no opponent on a failed week.
    mode = 'fail';
    assert.equal(await M.resolveOpponentRosterId({ league: { league_id: 'Z' }, myRosterId: 1, week: 2 }), null);
    Date.now = realNow;
});
