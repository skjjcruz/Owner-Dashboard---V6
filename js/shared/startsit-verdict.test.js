// Run with:  node --test js/shared/startsit-verdict.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
const V = require('./startsit-verdict.js');

const base = { onDhq: true, provLabel: 'Sleeper', starters: 9, benchPts: 0, swaps: [] };

test('no swaps → start who is in (optimal)', () => {
    const v = V.compute(base);
    assert.equal(v.kind, 'optimal');
    assert.match(v.text, /already optimal/);
    assert.equal(v.source, 'DHQ');
});

test('empty starting slots are called out, never a swap', () => {
    const v = V.compute({ ...base, starters: 0, swaps: [{ slot: 'FLEX', in: 'A', out: null, gain: 9 }] });
    assert.equal(v.kind, 'empty');
});

test('one swap → the engine call with its exact gain', () => {
    const v = V.compute({ ...base, benchPts: 3.2, swaps: [{ slot: 'FLEX', in: 'Jaylen Waddle', out: 'Rome Odunze', gain: 3.2 }] });
    assert.equal(v.kind, 'swap');
    assert.equal(v.text, 'Start Jaylen Waddle over Rome Odunze at FLEX (+3.2 pts)');
    assert.equal(v.top.in, 'Jaylen Waddle');
});

test('several swaps → the biggest named, the rest counted with the bench total', () => {
    const v = V.compute({ ...base, benchPts: 7.4, swaps: [
        { slot: 'WR', in: 'B', out: 'C', gain: 1.4 },
        { slot: 'SUPER_FLEX', in: 'D', out: 'E', gain: 6 },
    ] });
    assert.equal(v.text, 'Start D over E at SUPER FLEX (+6 pts) · 1 more swap, +7.4 avg in all');
});

test('the engine cannot separate them → says so (too close to call)', () => {
    const v = V.compute({ ...base, benchPts: 0.3, swaps: [{ slot: 'RB', in: 'X', out: 'Y', gain: 0.3 }] });
    assert.equal(v.kind, 'close');
    assert.match(v.text, /^Too close to call: X vs Y at RB — the projections are within 0\.3 pts/);
    assert.ok(0.3 < V.CLOSE_CALL_PTS);
});

test('an empty slot to fill, or a player to sit, reads naturally', () => {
    assert.equal(V.compute({ ...base, swaps: [{ slot: 'K', in: 'Tucker', out: null, gain: 8 }] }).text, 'Start Tucker in your empty K (+8 pts)');
    assert.equal(V.compute({ ...base, swaps: [{ slot: 'DEF', in: null, out: 'Bears', gain: 1 }] }).text, 'Sit Bears at DEF (+1 pts)');
});

test('platform numbers while DHQ loads are labelled with their source', () => {
    const v = V.compute({ ...base, onDhq: false, provLabel: 'Sleeper', swaps: [{ slot: 'WR', in: 'A', out: 'B', gain: 2 }] });
    assert.equal(v.source, 'Sleeper');
});

test('no facts → null (nothing rendered)', () => {
    assert.equal(V.compute(null), null);
    assert.equal(V.compute(undefined), null);
});

test('the call names the two numbers it was decided on (DHQ: the average week)', () => {
    const v = V.compute({ ...base, benchPts: 2.6, swaps: [{ slot: 'WR', in: 'Rashee Rice', out: 'Aaron Jones', gain: 2.6, inPts: 12.7, outPts: 10.1 }] });
    assert.equal(v.text, 'Start Rashee Rice over Aaron Jones at WR (avg 12.7 vs 10.1, +2.6 pts)');
    const c = V.compute({ ...base, benchPts: 0.3, swaps: [{ slot: 'RB', in: 'X', out: 'Y', gain: 0.3, inPts: 9.9, outPts: 9.6 }] });
    assert.match(c.text, /within 0\.3 pts \(avg 9\.9 vs 9\.6\)\. Your call\./);
    const p = V.compute({ ...base, onDhq: false, benchPts: 1, swaps: [{ slot: 'TE', in: 'A', out: 'B', gain: 1, inPts: 8, outPts: 7 }] });
    assert.equal(p.text, 'Start A over B at TE (8 vs 7, +1 pts)', 'platform numbers carry no "avg"');
});
