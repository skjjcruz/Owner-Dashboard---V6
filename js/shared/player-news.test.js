// Run with:  node --test js/shared/player-news.test.js
// Owner ask 2026-10-09: NFL news synced with the player. The app reads the
// engine's player news index; one batch per 80 players, cached 10 minutes,
// and an outage is simply no news.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
const calls = [];
globalThis.fetch = async (url) => {
    calls.push(url);
    if (/players=down/.test(url)) throw new Error('offline');
    return { ok: true, json: async () => ({ players: { 5045: [
        { kind: 'coaching', link: 'team', why: 'DEN coaching / play-calling', headline: "Sean Payton says he's taking over playcalling for Broncos' offense", published_at: '2026-10-08T20:00:00Z', source: 'ESPN' },
    ] } }) };
};
const PN = require('./player-news.js');

test('news for a player, with why it reaches him', async () => {
    const m = await PN.get(['5045']);
    assert.equal(m['5045'].length, 1);
    assert.match(PN.label(m['5045'][0]), /Coaching · via DEN coaching \/ play-calling$/);
    await PN.get(['5045']);
    assert.equal(calls.length, 1, 'cached: a second look does not refetch');
});

test('an outage is no news, never an error', async () => {
    const m = await PN.get(['down']);
    assert.deepEqual(m, { down: [] });
});
