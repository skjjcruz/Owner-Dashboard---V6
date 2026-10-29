// js/draft/cpu-engine.js: the mock draft's computer picks come from the
// engine server (dhq-mock, Phase A7) and map back to the pool's own objects.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(fetchImpl, pro = true) {
    const ctx = { console, setTimeout, clearTimeout, Promise, JSON };
    ctx.window = ctx;
    ctx.fetch = fetchImpl;
    ctx.wrIsPro = () => pro;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'draft', 'cpu-engine.js'), 'utf8'), ctx);
    return ctx.DraftCC.cpuEngine;
}
const pool = [{ pid: 'a', pos: 'QB', dhq: 5000, extra: 1 }, { pid: 'b', pos: 'RB', dhq: 7000 }];

test('a pick comes back as the pool\'s own player, with the server\'s reasoning', async () => {
    const sent = [];
    const ce = load(async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ pid: 'a', confidence: 0.8, reasoning: { primary: 'Primary need' } }) }; });
    const r = await ce.personaPick({ draftDna: { label: 'QB Hunter' }, assessment: { needs: ['QB'] }, ownerIntel: { big: 1 } }, pool, 1, 3, { teamRoster: ['RB'], draftTuning: {}, draftContext: { big: 1 } });
    assert.equal(r.player, pool[0]);
    assert.equal(r.reasoning.primary, 'Primary need');
    const pick = sent.find(b => b.op === 'pick' && b.pool.length);
    assert.ok(!('ownerIntel' in pick.persona) && !('draftContext' in pick.ctx), 'only what the formula reads');
    assert.ok(!('extra' in pick.pool[0]));
});

test('server down or free tier: best available, as free mocks always pick', async () => {
    for (const ce of [load(async () => ({ ok: false, status: 503 })), load(async () => { throw new Error('should not be asked'); }, false)]) {
        const r = await ce.personaPick({}, pool, 1, 1, {});
        assert.equal(r.player.pid, 'b');
        assert.equal(r.reasoning.primary, 'BPA fallback');
    }
});

test('predictions: one call for every opponent, top 20 only', async () => {
    let body = null;
    const ce = load(async (url, init) => { const b = JSON.parse(init.body); if (b.teams) body = b; return { ok: true, json: async () => ({ predictions: { 3: { willReach: [{ pos: 'QB' }], willPassOn: [], likelyPick: null } } }) }; });
    const big = Array.from({ length: 50 }, (_, i) => ({ pid: 'p' + i, pos: 'WR', dhq: 100 - i }));
    const out = await ce.computePredictions([{ rid: 3, persona: {}, round: 1, pick: 2 }], big, { draftTuning: {} });
    assert.equal(body.pool.length, 20);
    assert.equal(out[3].willReach[0].pos, 'QB');
});
