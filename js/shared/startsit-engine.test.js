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

// ── Exact lineup assignment (Lab research 2026-10-10) ─────────────────
// The old solver filled the narrowest slot first, one at a time. Players
// Sleeper lists at two positions (DL and LB edge rushers) break that: it
// could leave points on the bench. These pin the exact assignment.

// The old greedy, kept here as the reference the fix is measured against.
function greedyTotal(players, rosterPositions) {
    const pool = players.filter(p => p.available !== false).map(p => ({ ...p, positions: [...new Set([p.pos].concat(p.positions || []))] })).sort((a, b) => b.pts - a.pts);
    const slots = rosterPositions.map(SS.normSlot).filter(s => !['BN', 'IR', 'TAXI'].includes(s))
        .map(s => SS.FLEX_ALLOWED[s] || [s]).sort((a, b) => a.length - b.length);
    const used = new Set(); let t = 0;
    for (const el of slots) {
        const p = pool.find(x => !used.has(x.pid) && x.positions.some(q => el.includes(q)));
        if (p) { used.add(p.pid); t += p.pts; }
    }
    return Math.round(t * 10) / 10;
}
// Every possible assignment, for small cases: the true best total.
function bruteTotal(players, rosterPositions) {
    const pool = players.filter(p => p.available !== false).map(p => ({ ...p, positions: [...new Set([p.pos].concat(p.positions || []))] }));
    const slots = rosterPositions.map(SS.normSlot).filter(s => !['BN', 'IR', 'TAXI'].includes(s)).map(s => SS.FLEX_ALLOWED[s] || [s]);
    let best = { n: -1, t: -Infinity };
    (function go(i, used, n, t) {
        if (i === slots.length) { if (n > best.n || (n === best.n && t > best.t)) best = { n, t }; return; }
        pool.forEach((p, j) => {
            if (used & (1 << j) || !p.positions.some(q => slots[i].includes(q))) return;
            go(i + 1, used | (1 << j), n + 1, t + p.pts);
        });
        go(i + 1, used, n, t);   // leave it empty
    })(0, 0, 0, 0);
    return Math.round(best.t * 10) / 10;
}

test('research repro: DL then LB with a DL/LB player scores 19, not 11', () => {
    const players = [
        { pid: 'X', pos: 'DL', positions: ['DL', 'LB'], available: true, pts: 10 },
        { pid: 'Y', pos: 'DL', positions: ['DL'], available: true, pts: 9 },
        { pid: 'Z', pos: 'LB', positions: ['LB'], available: true, pts: 1 },
    ];
    assert.equal(greedyTotal(players, ['DL', 'LB']), 11, 'the old greedy really did return 11');
    const opt = SS.optimalLineupWeekly(players, ['DL', 'LB', 'BN']);
    assert.equal(opt.total, 19);
    const at = {}; opt.slots.forEach(s => { at[s.slot] = s.pid; });
    assert.deepEqual(at, { DL: 'Y', LB: 'X' });
    assert.equal(opt.starters.length, 2);
    assert.ok(opt.used instanceof Set && opt.used.has('X') && opt.used.has('Y') && !opt.used.has('Z'));
});

test('Psycho League IDP slots (DL×3, LB×2, DB×3, IDP_FLEX×3) with three DL/LB players match the exhaustive best', () => {
    // Shape of roster 13, week 5 (league 1312100327931019264): three DL/LB
    // edge rushers, DL-only ends, thin LBs. Points are illustrative.
    const slots = ['DL', 'DL', 'DL', 'LB', 'LB', 'DB', 'DB', 'DB', 'IDP_FLEX', 'IDP_FLEX', 'IDP_FLEX', 'BN', 'BN'];
    const P = (pid, positions, pts) => ({ pid, pos: positions[0], positions, available: true, pts });
    const players = [
        P('nwosu', ['DL', 'LB'], 9), P('chop', ['DL', 'LB'], 8), P('jjohnson', ['DL', 'LB'], 7.5),
        P('donald', ['DL'], 7), P('hall', ['DL'], 6.5), P('hemingway', ['DL'], 6),
        P('oluokun', ['LB'], 2), P('ewilson', ['LB'], 1.5),
        P('lassiter', ['DB'], 7.7), P('humphrey', ['DB'], 6.1), P('stukes', ['DB'], 3.9), P('masses', ['DB'], 2), P('henderson', ['DB'], 1),
    ];
    const opt = SS.optimalLineupWeekly(players, slots);
    assert.equal(greedyTotal(players, slots), 65.2, 'the old greedy left half a point on the bench');
    assert.equal(opt.total, 65.7);
    assert.equal(opt.starters.length, 11, 'every slot filled');
    assert.equal(new Set(opt.starters.map(s => s.pid)).size, 11, 'no player counted twice');
    const lb = opt.slots.filter(s => s.slot === 'LB').map(s => s.pid).sort();
    assert.deepEqual(lb, ['chop', 'nwosu'], 'the dual-eligible rushers take the LB slots');
});

test('exact solver equals exhaustive search on 300 random small leagues', () => {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const POS = [['DL'], ['LB'], ['DL', 'LB'], ['DB'], ['RB'], ['WR'], ['TE'], ['QB'], ['WR', 'RB']];
    const SLOTS = ['DL', 'LB', 'DB', 'IDP_FLEX', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'QB', 'REC_FLEX'];
    for (let k = 0; k < 300; k++) {
        const nS = 2 + Math.floor(rnd() * 4), nP = 2 + Math.floor(rnd() * 7);
        const slots = Array.from({ length: nS }, () => SLOTS[Math.floor(rnd() * SLOTS.length)]);
        const players = Array.from({ length: nP }, (_, i) => { const ps = POS[Math.floor(rnd() * POS.length)]; return { pid: 'p' + i, pos: ps[0], positions: ps, available: rnd() > 0.1, pts: Math.round(rnd() * 200) / 10 }; });
        const opt = SS.optimalLineupWeekly(players, slots);
        assert.equal(opt.total, bruteTotal(players, slots), 'case ' + k + ': ' + JSON.stringify({ slots, players }));
        assert.ok(opt.total >= greedyTotal(players, slots), 'never worse than the old greedy');
    }
});

test('nested formats come back exactly as the greedy placed them', () => {
    // QB ⊂ SUPER_FLEX, RB/WR/TE ⊂ FLEX: greedy was already optimal; the
    // exact pass must not reshuffle slots (callers diff these lists).
    const P = (pid, pos, pts) => ({ pid, pos, available: true, pts });
    const players = [P('qb1', 'QB', 20), P('qb2', 'QB', 18), P('rb1', 'RB', 15), P('rb2', 'RB', 12), P('wr1', 'WR', 14), P('wr2', 'WR', 12), P('te1', 'TE', 9)];
    const opt = SS.optimalLineupWeekly(players, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN']);
    assert.deepEqual(opt.slots.map(s => s.slot + ':' + s.pid), ['QB:qb1', 'RB:rb1', 'WR:wr1', 'TE:te1', 'FLEX:rb2', 'SUPER_FLEX:qb2']);
    assert.equal(opt.total, 88);
});

test('an empty slot stays empty when nobody fits, and unavailable players never start', () => {
    const opt = SS.optimalLineupWeekly([
        { pid: 'a', pos: 'DL', positions: ['DL', 'LB'], available: false, pts: 30 },
        { pid: 'b', pos: 'LB', available: true, pts: 4 },
    ], ['DL', 'LB', 'K']);
    const at = {}; opt.slots.forEach(s => { at[s.slot] = s.pid; });
    assert.deepEqual(at, { DL: null, LB: 'b', K: null });
    assert.equal(opt.total, 4);
});
