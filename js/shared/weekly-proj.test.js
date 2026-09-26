// Run with:  node --test js/shared/weekly-proj.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = (p) => p;
App.calcRawPts = (line, sc) => { let t = 0; for (const k of Object.keys(sc || {})) if (Number.isFinite(line[k])) t += line[k] * sc[k]; return t; };
globalThis.calcFantasyPts = (line, sc) => App.calcRawPts(line, sc);
require('./startsit-engine.js');
const WP = require('./weekly-proj.js');
const players = { a: { position: 'WR', team: 'KC' } };
const stats = { a: { gp: 2, rec: 10, rec_yd: 120, rec_tgt: 14 } };
const scoring = { rec: 1, rec_yd: 0.1 };

test('a platform\'s own projection (MFL) becomes the shown number', () => {
    WP.setProjections(5, { a: { rec: 5, rec_yd: 60, rec_tgt: 7 } });
    const s = WP.projectPlayer('a', { playersData: players, statsData: stats, priorData: {}, scoring, week: 5 });
    assert.equal(s.projSource, 'sleeper');
    assert.equal(s.points.median, 11);
    WP.setPlatformPoints(5, { a: 14.5 }, 'mfl');
    const m = WP.projectPlayer('a', { playersData: players, statsData: stats, priorData: {}, scoring, week: 5 });
    assert.equal(m.projSource, 'mfl');
    assert.equal(m.points.median, 14.5);
    assert.equal(WP.platformSource(5), 'mfl');
});

test('with platform points only, a Sleeper-only surface still gets the player', () => {
    WP.setPlatformPoints(6, { a: 9 }, 'mfl');
    const m = WP.projectPlayer('a', { playersData: players, statsData: stats, priorData: {}, scoring, week: 6, requireSleeper: true });
    assert.ok(m);
    assert.equal(m.points.median, 9);
    assert.equal(WP.loadedProjWeek(), 6);
});
