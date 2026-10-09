// Run with:  node --test js/shared/ask-dhq.test.js
// Ask DHQ: plain-English questions answered by the engine in the page.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = p => p;

globalThis.S = {
    currentLeagueId: 'L', myRosterId: 13, myUserId: 'me',
    leagues: [{ league_id: 'L', name: 'The Psycho League', roster_positions: ['QB', 'WR', 'FLEX', 'BN', 'BN'] }],
    leagueUsers: [{ user_id: 'me', display_name: 'skjjcruz', metadata: { team_name: 'Dirty Mike' } }, { user_id: 'them', display_name: 'Gas', metadata: { team_name: 'GasMan612' } }],
    rosters: [
        { roster_id: 13, owner_id: 'me', players: ['chig', 'sutton', 'turpin', 'jt', 'dak'], starters: ['dak', 'turpin', 'sutton'] },
        { roster_id: 2, owner_id: 'them', players: ['puka', 'mcb', 'henry', 'camsutton'], starters: [] },
    ],
    players: {
        chig: { full_name: 'Chig Okonkwo', position: 'TE', team: 'WAS', injury_status: 'Questionable', injury_body_part: 'Hamstring', age: 27 },
        sutton: { full_name: 'Courtland Sutton', position: 'WR', team: 'DEN', age: 30 },
        turpin: { full_name: 'KaVontae Turpin', position: 'WR', team: 'DAL', age: 30 },
        jt: { full_name: 'Jonathan Taylor', position: 'RB', team: 'IND', age: 27 },
        dak: { full_name: 'Dak Prescott', position: 'QB', team: 'DAL', age: 33 },
        puka: { full_name: 'Puka Nacua', position: 'WR', team: 'LAR', age: 25 },
        mcb: { full_name: 'Trey McBride', position: 'TE', team: 'ARI', age: 26 },
        henry: { full_name: 'Derrick Henry', position: 'RB', team: 'BAL', age: 32 },
        camsutton: { full_name: 'Cam Sutton', position: 'DB', team: 'PIT', age: 31 },
        fa1: { full_name: 'Michael Carter', position: 'RB', team: 'TEN', age: 27 },
        fa2: { full_name: 'Tyler Badie', position: 'RB', team: 'DEN', age: 26 },
    },
};
App.LI = {
    playerScores: { chig: 1153, sutton: 938, turpin: 700, jt: 4288, dak: 4019, puka: 7091, mcb: 2881, henry: 2096, fa1: 333, fa2: 410 },
    playerMeta: { sutton: { peakYrsLeft: 0, trend: -68, ageCurvePhase: 'decline' }, jt: { peakYrsLeft: 0, trend: 3, ageCurvePhase: 'decline' }, puka: { peakYrsLeft: 3, trend: 10, ageCurvePhase: 'peak' } },
};
App.DhqProj = { get: pid => ({ chig: { mean: 6.5, median: 6.5 }, sutton: { mean: 8.4, median: 8.4 }, jt: { mean: 22.6, median: 22.6 }, henry: { mean: 22.3, median: 22.3 } })[pid] || null };
App.GameLocks = { state: pid => (['turpin', 'dak'].includes(pid) ? { status: 'final', locked: true, pts: pid === 'turpin' ? 8.7 : 16.6, label: 'FINAL' } : null) };
App.getPlayerAction = pid => (pid === 'sutton' ? { label: 'Sell high', reason: 'In the veteran decline band and production is slipping (-68%).' } : { label: 'Hold', reason: 'Hold.' });
const mine = { tier: 'CONTENDER', window: 'CONTENDING', healthScore: 87, needs: [{ pos: 'TE', urgency: 'deficit' }], strengths: ['WR'], faabRemaining: 1715, posAssessment: { TE: { status: 'deficit', nflStarters: 0, minQuality: 2 }, WR: { status: 'surplus', nflStarters: 4, minQuality: 4 } } };
const theirs = { rosterId: 2, teamName: 'GasMan612', tier: 'REBUILDING', window: 'REBUILDING', panic: 3, needs: [{ pos: 'WR', urgency: 'thin' }], strengths: ['TE'], posAssessment: { TE: { status: 'surplus', sortedIds: ['mcb'] } } };
globalThis.assessTeamFromGlobal = rid => (String(rid) === '13' ? mine : String(rid) === '2' ? theirs : null);
globalThis.assessAllTeamsFromGlobal = () => [Object.assign({ rosterId: 13 }, mine), theirs];
// A stand-in for DHQ-Shared/trade-engine.js (same function shapes).
App.TradeEngine = {
    fairnessGrade: (give, get) => { const r = get / Math.max(give, 1); return r >= 1.3 ? { grade: 'A+', label: 'Steal' } : r >= 0.95 ? { grade: 'B', label: 'Fair' } : { grade: 'F', label: 'Bad Trade' }; },
    calcOwnerPosture: () => ({ key: 'SELLER', label: 'Active Seller' }),
    calcPsychTaxes: () => [{ name: 'Need Fulfillment', impact: 12 }],
    calcAcceptanceLikelihood: () => 42,
    calcComplementarity: () => 50,
};
const A = require('./ask-dhq.js');

test('finds players by full name and by a unique last name, in order', () => {
    assert.deepEqual(A.findPlayers('Should I start Chig Okonkwo or Sutton this week?'), ['chig', 'sutton']);
    assert.deepEqual(A.findPlayers("what's jonathan taylor worth"), ['jt']);
});

test('who do I start: DHQ picks the higher projection and names the injury', () => {
    const a = A.answer('In the psycho league, who do I start, Chig Okonkwo or Courtland Sutton?');
    assert.equal(a.intent, 'startsit');
    assert.match(a.text, /^Start Courtland Sutton over Chig Okonkwo: 8\.4 vs 6\.5/);
    assert.ok(a.lines.some(l => /Questionable \(Hamstring\)/.test(l)));
});

test('last names shared by two rostered players go to the member\'s own player (owner report 2026-10-09)', () => {
    assert.deepEqual(A.findPlayers('Who should I start, Sutton or Okonkwo?'), ['sutton', 'chig']);
    const a = A.answer('Who should I start, Sutton or Okonkwo?');
    assert.match(a.text, /^Start Courtland Sutton over Chig Okonkwo: 8\.4 vs 6\.5/);
});

test('names it cannot find get an honest reply, not a different answer', () => {
    const a = A.answer('Who should I start, Zzyzx or Qwerty?');
    assert.match(a.text, /couldn't match those names/);
});

test('a player whose game is over is never recommended in or out', () => {
    const a = A.answer('Start Turpin or Sutton?');
    assert.match(a.text, /^Start Courtland Sutton \(8\.4 projected\)\. KaVontae Turpin is locked/);
    assert.ok(a.lines.some(l => /already played, 8\.7 pts \(locked\)/.test(l)));
});

test('buy / sell / hold uses the app\'s player-action call', () => {
    const a = A.answer('Should I sell Courtland Sutton?');
    assert.equal(a.intent, 'outlook');
    assert.match(a.text, /^Sell high: /);
});

test('what does my team need', () => {
    const a = A.answer('What does my team need?');
    assert.equal(a.intent, 'needs');
    assert.match(a.text, /TE \(deficit\)/);
    assert.match(a.text, /surplus at WR/);
});

test('a trade is graded and acceptance estimated', () => {
    const a = A.answer('Jonathan Taylor for Puka Nacua?');
    assert.equal(a.intent, 'trade');
    assert.match(a.text, /A\+ \(Steal\): you give DHQ 4288, you get 7091/);
    assert.match(a.text, /About 42% chance GasMan612 says yes/);
});

test('who should I trade with: a partner with surplus at my need', () => {
    const a = A.answer('Who should I trade with?');
    assert.equal(a.intent, 'targets');
    assert.match(a.text, /^Call GasMan612 first: they have Trey McBride/);
});

test('trade answers use plain English, not model terms', () => {
    const a = A.answer('Jonathan Taylor for Puka Nacua?');
    assert.ok(a.lines.some(l => /^Helps: you fill a position they need$/.test(l)), a.lines.join(' | '));
});

test('the number shown is the Game Day column (typical week); the call runs on the average week', () => {
    const save = App.DhqProj.get;
    App.DhqProj.get = pid => ({ chig: { mean: 6.0, median: 5.0 }, sutton: { mean: 5.9, median: 5.6 } })[pid] || null;
    const a = A.answer('Chig Okonkwo or Courtland Sutton?  who do I start');
    assert.match(a.text, /^Toss-up: Chig Okonkwo \(5\.0\) and Courtland Sutton \(5\.6\)/);
    App.DhqProj.get = save;
});

test('no holes: who to sell your surplus to', () => {
    const save = mine.needs; mine.needs = []; mine.posAssessment.WR.sortedIds = ['sutton', 'turpin', 'x1', 'x2', 'x3']; mine.posAssessment.WR.nflStarters = 5;
    theirs.needs = [{ pos: 'WR', urgency: 'thin' }];
    const a = A.answer('Who should I trade with?');
    assert.equal(a.title, 'Sell your surplus');
    assert.match(a.text, /GasMan612 needs WR/);
    mine.needs = save;
});

test('waivers by position, unrostered only', () => {
    const a = A.answer('Best waiver RB?');
    assert.equal(a.intent, 'waivers');
    assert.match(a.text, /Tyler Badie/);
    assert.ok(!a.lines.some(l => /Taylor|Henry/.test(l)));
});

test('compare two players', () => {
    const a = A.answer('Compare Jonathan Taylor vs Derrick Henry');
    assert.equal(a.intent, 'compare');
    assert.match(a.text, /Jonathan Taylor is the better dynasty asset/);
});

test('anything else gets the help card; ask-elsewhere links carry the question', () => {
    assert.equal(A.answer('hello').intent, 'help');
    const u = A.askElsewhereUrl('chatgpt', 'Who should I start?');
    assert.match(u, /^https:\/\/chatgpt\.com\/\?q=/);
    assert.match(decodeURIComponent(u), /Dynasty HQ connector, in my league "The Psycho League": Who should I start\?/);
});

test('no device AI in this environment: the brain is DHQ\'s engine', async () => {
    assert.equal(await A.brain(), 'engine');
});

// ── The member's own AI key (owner ask 2026-10-09) ────────────────────
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };

test('the AI company is read from the key itself', () => {
    assert.equal(A.providerOf('sk-ant-api03-abc'), 'anthropic');
    assert.equal(A.providerOf('sk-proj-abc123'), 'openai');
    assert.equal(A.providerOf('AIzaSyD-abcdefghijklmnopqrstu'), 'gemini');
    assert.equal(A.providerOf('hello'), null);
});

test('a saved key answers in the app; it goes only to its own AI company', async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
        seen.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
        if (/anthropic/.test(url)) return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Start Sutton.' }] }) };
        if (/googleapis/.test(url)) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Start Sutton.' }] } }] }) };
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Start Sutton.' } }] }) };
    };
    const ans = A.answer('Who should I start, Chig Okonkwo or Courtland Sutton?');
    for (const [key, host] of [['sk-ant-x', 'api.anthropic.com'], ['AIzaSyD-abcdefghijklmnopqrstu', 'generativelanguage.googleapis.com'], ['sk-proj-x', 'api.openai.com']]) {
        assert.ok(A.saveKey(key));
        assert.equal(await A.brain(), 'key');
        const r = await A.askWithKey('Who should I start?', ans);
        assert.equal(r.ok, true); assert.equal(r.text, 'Start Sutton.');
        const call = seen[seen.length - 1];
        assert.ok(call.url.includes(host), call.url);
        assert.ok(JSON.stringify(call.body).includes('Start Courtland Sutton over Chig Okonkwo'), 'DHQ\'s facts go with the question');
    }
    assert.ok(seen.every(c => !/dhqfootball|supabase|sleeper/.test(c.url)), 'the key never goes anywhere but the AI company');
    globalThis.fetch = realFetch;
});

test('a rejected key says so plainly; removing it falls back', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
    A.saveKey('sk-proj-bad');
    const r = await A.askWithKey('Who should I start?', A.answer('What does my team need?'));
    assert.equal(r.ok, false); assert.match(r.error, /turned down by OpenAI/);
    A.forgetKey();
    assert.equal(A.savedKey(), null);
    assert.equal(await A.brain(), 'engine');
    globalThis.fetch = realFetch;
});
