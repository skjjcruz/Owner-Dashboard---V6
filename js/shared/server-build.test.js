'use strict';
const test = require('node:test');
const assert = require('node:assert');

function load(env) {
    const store = {};
    const calls = [];
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    globalThis.fetch = (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); };
    globalThis.DHQ_LAB = env.lab;
    delete globalThis.App;
    delete require.cache[require.resolve('./server-build.js')];
    return { SB: require('./server-build.js'), calls };
}

test('website and app send too (not only the Lab)', () => {
    const { SB, calls } = load({ lab: undefined });
    SB.note(['1312100327931019264']);
    assert.equal(calls.length, 1);
});

test('sends Sleeper ids only, once a day per league', () => {
    const { SB, calls } = load({ lab: true });
    SB.note(['1312100327931019264', 'espn_687493_2026', 'mfl_10005_2026', '1312100327931019264']);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.leagues, ['1312100327931019264']);
    SB.note(['1312100327931019264']);
    assert.equal(calls.length, 1, 'already sent today');
    SB.note(['1312100327931019264', '1389388885716385792']);
    assert.deepEqual(calls[1].body.leagues, ['1389388885716385792']);
});

test('never throws, even when fetch and storage do', () => {
    const { SB } = load({ lab: true });
    globalThis.fetch = () => { throw new Error('offline'); };
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    assert.doesNotThrow(() => SB.note(['1312100327931019264']));
    assert.doesNotThrow(() => SB.note(null));
});
