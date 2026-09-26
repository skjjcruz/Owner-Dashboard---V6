// Run with:  node --test js/shared/startsit-engine.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
const SS = require('./startsit-engine.js');

test('a player listed at two positions can fill either slot', () => {
    // Nwosu: Sleeper position LB, fantasy positions DL and LB
    const players = [
        { pid: 'nwosu', pos: 'LB', positions: ['DL', 'LB'], available: true, pts: 6 },
        { pid: 'wilson', pos: 'LB', positions: ['LB'], available: true, pts: 7 },
        { pid: 'end', pos: 'DL', positions: ['DL'], available: true, pts: 3 },
    ];
    const opt = SS.optimalLineupWeekly(players, ['DL', 'LB', 'BN']);
    const at = {}; opt.slots.forEach(s => { at[s.slot] = s.pid; });
    assert.equal(at.LB, 'wilson');
    assert.equal(at.DL, 'nwosu', 'the edge rusher takes the DL slot over the lesser end');
    assert.equal(opt.total, 13);
});

test('without the extra positions he is only his listed position', () => {
    const players = [
        { pid: 'nwosu', pos: 'LB', available: true, pts: 6 },
        { pid: 'end', pos: 'DL', available: true, pts: 3 },
    ];
    const opt = SS.optimalLineupWeekly(players, ['DL', 'LB']);
    const at = {}; opt.slots.forEach(s => { at[s.slot] = s.pid; });
    assert.equal(at.DL, 'end');
    assert.equal(at.LB, 'nwosu');
});
