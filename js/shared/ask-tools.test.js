// Run with:  node --test js/shared/ask-tools.test.js
// get_start_sit and get_lineup_advice (ask-tools.js) on the real engines
// (dhq-proj lineupCheck, startsit-engine, game-locks, matchup), fed a frozen
// copy of Psycho League (1312100327931019264), week 5 2026, roster 13 vs 12:
// rosters, slots, injury tags and kickoffs from public Sleeper data pulled
// 2026-10-10. DHQ numbers are stand-ins: each player's Sleeper week-5 line
// scored with the league's rules (mean), median 5% under it, floor 0.7×
// (0.6× when Questionable), ceiling 1.35×. Scenarios: Lab start/sit
// research (start-sit.md §5).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.window = globalThis;
globalThis.App = globalThis.App || {};
App.normPos = p => p;
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
globalThis.dispatchEvent = globalThis.dispatchEvent || (() => true);

const FX = {"r13":{"roster_id":13,"owner_id":"540392203863576576","starters":["3294","3198","6813","2133","8137","8148","5012","5045","8917","5947","421","2020","5061","12635","10911","5332","4413","11685","4071","13508","7677","6131","6791"],"players":["6813","2227","13508","8210","11034","13329","6791","2020","8127","8122","5045","8398","5012","12472","6131","13808","12635","11685","5332","4413","5061","8148","4071","2028","7039","8917","13398","4066","7677","12048","13490","3973","11663","3198","10911","13386","8137","13399","5947","9999","4137","2133","4135","3286","12961","13047","11571","11647","8119","5995","421","3294","13618"],"reserve":["3286","3973","4137"],"taxi":["11034","13047","13329","13386","13490","13618","13808","9999"]},"p13":{"421":["Matthew Stafford","QB",["QB"],"LAR",null,20.33],"2020":["Cairo Santos","K",["K"],"CHI",null,8.26],"2028":["Derek Carr","QB",["QB"],null,"NA",0],"2133":["Davante Adams","WR",["WR"],"LAR",null,15.4],"2227":["Aaron Donald","DT",["DL"],"LAR",null,4.17],"3198":["Derrick Henry","RB",["RB"],"BAL",null,22.33],"3286":["Demarcus Robinson","WR",["WR"],"SF","IR",0],"3294":["Dak Prescott","QB",["QB"],"DAL",null,23.12],"3973":["Myles Garrett","DE",["DL"],"LAR","IR",0],"4066":["Evan Engram","TE",["TE"],"DEN",null,4.75],"4071":["Marlon Humphrey","CB",["DB"],"BAL","Questionable",6.11],"4135":["Trey Hendrickson","DE",["DL"],"BAL","Out",0],"4137":["James Conner","RB",["RB"],"ARI","IR",0],"4413":["Eric Wilson","LB",["LB"],"MIN",null,4.72],"5012":["Mark Andrews","TE",["TE"],"BAL",null,7.81],"5045":["Courtland Sutton","WR",["WR"],"DEN",null,8.44],"5061":["Uchenna Nwosu","LB",["DL","LB"],"SEA",null,6.35],"5332":["Foyesade Oluokun","LB",["LB"],"JAX",null,6.41],"5947":["Jakobi Meyers","WR",["WR"],"JAX",null,8.17],"5995":["Justice Hill","RB",["RB"],"BAL",null,5.56],"6131":["Mack Wilson","LB",["LB"],"ARI",null,6.54],"6791":["C.J. Henderson","CB",["DB"],"ATL",null,0.97],"6813":["Jonathan Taylor","RB",["RB"],"IND",null,22.41],"7039":["Cody White","WR",["WR"],"LV",null,7.21],"7677":["Divine Deablo","LB",["LB"],"ATL","Questionable",6.1],"8119":["Jahan Dotson","WR",["WR"],"ATL",null,3.37],"8122":["Zonovan Knight","RB",["RB"],"ARI",null,0],"8127":["Charlie Kolar","TE",["TE"],"LAC","Questionable",2.84],"8137":["George Pickens","WR",["WR"],"DAL",null,13.42],"8148":["Jameson Williams","WR",["WR"],"DET",null,11.71],"8210":["Chig Okonkwo","TE",["TE"],"WAS",null,6.61],"8398":["Jermaine Johnson","LB",["DL","LB"],"TEN",null,3.45],"8917":["KaVontae Turpin","WR",["WR"],"DAL",null,3.1],"9999":["Will Levis","QB",["QB"],"NYJ",null,0],"10911":["Derick Hall","DE",["DL"],"SEA",null,0.43],"11034":["Jalen Brooks","WR",["WR"],"ARI",null,0.33],"11571":["Isaiah Davis","RB",["RB"],"NYJ",null,6.46],"11647":["Kimani Vidal","RB",["RB"],"LAC",null,5.71],"11663":["Chop Robinson","DE",["DL","LB"],"MIA",null,4.41],"11685":["Kamari Lassiter","DB",["DB"],"HOU",null,7.69],"12048":["George Holani","RB",["RB"],"SEA","Questionable",7.67],"12472":["Raheim Sanders","RB",["RB"],"CLE",null,6.1],"12635":["Tonka Hemingway","DT",["DL"],"LV",null,0.57],"12961":["Ryan Fitzgerald","K",["K"],"CAR",null,0],"13047":["Jacardia Wright","RB",["RB"],"SEA","Out",0],"13329":["Malik Benson","WR",["WR"],"LV",null,0.73],"13386":["D'Angelo Ponds","DB",["DB"],"NYJ",null,2.56],"13398":["Treydan Stukes","DB",["DB"],"LV",null,3.92],"13399":["Genesis Smith","DB",["DB"],"LAC",null,0.48],"13490":["Wade Woodaz","LB",["LB"],"HOU",null,0.92],"13508":["Hezekiah Masses","CB",["DB"],"LV",null,1.97],"13618":["Jacob Thomas","DB",["DB"],"MIN",null,0.64],"13808":["Wesley Bailey","DL",["DL"],"LAR",null,0.41]},"r12":{"roster_id":12,"owner_id":"717128699362762752","starters":["6904","9224","8228","8144","8146","10232","10859","8112","6806","12517","9493","11786","6782","6868","8269","8266","4968","10927","4963","11710","12654","12625","5017"],"players":["6806","13333","12625","13306","12654","4968","8144","4963","11600","6302","9224","13395","8228","7600","3161","11603","11646","11583","13150","11710","11699","11581","5017","12610","13420","11786","8112","9494","13482","8269","13392","8266","5859","9493","10927","12523","12543","4663","8146","4195","7765","9506","8180","13492","10859","8177","13557","6868","10232","6904","6782","13388","8136","12517","13301","10934","7585"],"reserve":["11583","11699","13392","5859","8177"],"taxi":["11600","12523","12543","13150","13301","13306","13333","13395","13482","13492"]},"p12":{"3161":["Carson Wentz","QB",["QB"],"MIN",null,0],"4195":["Jake Elliott","K",["K"],"PHI",null,7.02],"4663":["Austin Ekeler","RB",["RB"],"WAS",null,6.79],"4963":["Minkah Fitzpatrick","DB",["DB"],"NYJ",null,3.42],"4968":["Tremaine Edmunds","LB",["LB"],"NYG",null,5.54],"5017":["Jessie Bates","DB",["DB"],"ATL",null,5.26],"5859":["A.J. Brown","WR",["WR"],"NE","IR",0],"6302":["Kaden Elliss","LB",["LB"],"NO","Out",0],"6782":["Chase Young","DE",["DL"],"NO",null,6.22],"6806":["J.K. Dobbins","RB",["RB"],"DEN",null,11.41],"6868":["DJ Wonnum","DE",["DL","LB"],"DET",null,4.99],"6904":["Jalen Hurts","QB",["QB"],"PHI",null,16.23],"7585":["Davis Mills","QB",["QB"],"HOU",null,0],"7600":["Pat Freiermuth","TE",["TE"],"PIT",null,7.52],"7765":["Jonathon Cooper","DL",["DL","LB"],"DEN","NA",0],"8112":["Drake London","WR",["WR"],"ATL",null,16.7],"8136":["Rachaad White","RB",["RB"],"WAS",null,7.97],"8144":["Chris Olave","WR",["WR"],"NO",null,15.54],"8146":["Garrett Wilson","WR",["WR"],"NYJ",null,14.64],"8177":["Grant Calcaterra","TE",["TE"],"PHI","IR",0],"8180":["Jalen Nailor","WR",["WR"],"LV","Out",0],"8228":["Jaylen Warren","RB",["RB"],"PIT",null,18],"8266":["Quay Walker","LB",["LB"],"LV",null,6.07],"8269":["Jordan Davis","DL",["DL"],"PHI",null,3.99],"9224":["Chase Brown","RB",["RB"],"CIN",null,19.75],"9493":["Puka Nacua","WR",["WR"],"LAR",null,20.11],"9494":["Marvin Mims","WR",["WR"],"DEN",null,4.15],"9506":["Sean Tucker","RB",["RB"],"TB",null,2.24],"10232":["Michael Wilson","WR",["WR"],"ARI",null,15.35],"10859":["Sam LaPorta","TE",["TE"],"DET",null,11.98],"10927":["Jordan Battle","DB",["DB"],"CIN",null,4.58],"10934":["Zach Harrison","DE",["DL"],"ATL",null,4.12],"11581":["MarShawn Lloyd","RB",["RB"],"GB",null,11.22],"11583":["Jonathon Brooks","RB",["RB"],"CAR","IR",0],"11600":["Ja'Tavion Sanders","TE",["TE"],"CAR","Out",0],"11603":["AJ Barner","TE",["TE"],"SEA",null,7.96],"11646":["Jalen Coker","WR",["WR"],"CAR","Out",0],"11699":["Jer'Zhan Newton","DL",["DL"],"WAS","IR",0],"11710":["Calen Bullock","DB",["DB"],"HOU",null,5.88],"11786":["Cam Little","K",["K"],"JAX",null,9.32],"12517":["Colston Loveland","TE",["TE"],"CHI",null,9],"12523":["Jimmy Horn","WR",["WR"],"CLE",null,0],"12543":["Tahj Brooks","RB",["RB"],"CIN",null,0.79],"12610":["Princely Umanmielen","DL",["DL"],"CAR",null,0],"12625":["Justin Walley","CB",["DB"],"IND",null,3.28],"12654":["Craig Woodson","DB",["DB"],"NE","Questionable",3.73],"13150":["Darius Cooper","WR",["WR"],"PHI",null,6.56],"13301":["Antonio Williams","WR",["WR"],"WAS",null,8.1],"13306":["Taylen Green","QB",["QB"],"CLE",null,0],"13333":["Deion Burks","WR",["WR"],"IND",null,0.2],"13388":["CJ Allen","LB",["LB"],"IND",null,1.1],"13392":["Jeff Caldwell","WR",["WR"],"KC","IR",0],"13395":["Keldric Faulk","DL",["DL"],"TEN",null,2.59],"13420":["Bryce Lance","WR",["WR"],"NO",null,2.62],"13482":["Kendal Daniels","LB",["LB"],"ATL",null,1.04],"13492":["Dani Dennis-Sutton","DE",["DL"],"GB",null,0.62],"13557":["Athan Kaliakmanis","QB",["QB"],"WAS",null,0]},"matchups":[{"roster_id":13,"matchup_id":3,"players_points":{"3294":16.64,"8137":24.75,"8917":8.68}},{"roster_id":12,"matchup_id":3,"players_points":{"9506":2.3}}],"scores":[{"status":"pre_game","start_time":1791750300000,"metadata":{"home_team":"ARI","away_team":"DET","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791764400000,"metadata":{"home_team":"ATL","away_team":"BAL","has_started":false,"is_over":false}},{"status":"complete","start_time":1791504900000,"metadata":{"home_team":"DAL","away_team":"TB","has_started":true,"is_over":true}},{"status":"pre_game","start_time":1791738000000,"metadata":{"home_team":"GB","away_team":"CHI","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791725400000,"metadata":{"home_team":"JAX","away_team":"PHI","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791738000000,"metadata":{"home_team":"MIA","away_team":"CIN","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791738000000,"metadata":{"home_team":"NE","away_team":"LV","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791738000000,"metadata":{"home_team":"NO","away_team":"MIN","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791738000000,"metadata":{"home_team":"NYJ","away_team":"CLE","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791738000000,"metadata":{"home_team":"PIT","away_team":"IND","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791749100000,"metadata":{"home_team":"LAC","away_team":"DEN","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791750300000,"metadata":{"home_team":"SEA","away_team":"SF","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791850500000,"metadata":{"home_team":"LAR","away_team":"BUF","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791738000000,"metadata":{"home_team":"TEN","away_team":"HOU","has_started":false,"is_over":false}},{"status":"pre_game","start_time":1791738000000,"metadata":{"home_team":"WAS","away_team":"NYG","has_started":false,"is_over":false}}],"roster_positions":["QB","RB","RB","WR","WR","WR","TE","FLEX","FLEX","FLEX","SUPER_FLEX","K","DL","DL","DL","LB","LB","DB","DB","DB","IDP_FLEX","IDP_FLEX","IDP_FLEX","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN","BN"]};
const LID = '1312100327931019264';
const players = {};
const results = {};
const lines = {};
for (const side of ['p13', 'p12']) {
    for (const [pid, [name, pos, fp, team, inj, pts]] of Object.entries(FX[side])) {
        players[pid] = { full_name: name, position: pos, fantasy_positions: fp.length ? fp : [pos], team, injury_status: inj };
        if (pts != null) lines[pid] = { pts };
        if (!team) { results[pid] = null; continue; }
        const m = pts == null ? 0 : pts, q = /^Questionable$/i.test(inj || '');
        results[pid] = { mean: m, median: +(m * 0.95).toFixed(2), floor: +(m * (q ? 0.6 : 0.7)).toFixed(2), ceiling: +(m * 1.35).toFixed(2), why: 'Opponent vs position +4%' };
    }
}
// Truth law fixture: Sleeper publishes no line for Zonovan Knight this week,
// while DHQ's engine came up with 5.2 for him. DHQ must read 0, and say why.
const KNIGHT = Object.keys(FX.p13).find(pid => FX.p13[pid][0] === 'Zonovan Knight');
delete lines[KNIGHT];
results[KNIGHT] = Object.assign({}, results[KNIGHT], { mean: 5.2, median: 5, floor: 3.6, ceiling: 7 });
const r13 = FX.r13, r12 = FX.r12;
globalThis.S = {
    currentLeagueId: LID, myRosterId: 13, myUserId: r13.owner_id, platform: 'sleeper', season: '2026', currentWeek: 5,
    nflState: { season: '2026', week: 5, display_week: 5, season_type: 'regular' },
    leagues: [{ league_id: LID, season: '2026', name: 'Psycho League', roster_positions: FX.roster_positions, scoring_settings: {}, settings: {} }],
    leagueUsers: [{ user_id: r13.owner_id, display_name: 'me13' }, { user_id: r12.owner_id, display_name: 'them12' }],
    rosters: [Object.assign({}, r13), Object.assign({}, r12)],
    players,
};
// Dynasty values exist in the app; a weekly call must never show them.
App.LI = { playerScores: Object.fromEntries(Object.keys(players).map((pid, i) => [pid, 9000 - i * 50])) };
App.WeeklyProj = { displayWeek: () => 5, currentWeek: () => 5, loadedProjWeek: () => 5, hasProjWeek: w => w === 5, projLine: (pid, w) => (w === 5 ? lines[pid] || null : null), _ctx: { byTeamWeek: {} } };
globalThis.fetch = async (url) => {
    const u = String(url);
    const body = /\/scores\/nfl\//.test(u) ? FX.scores : /\/league\/\d+\/matchups\/5$/.test(u) ? FX.matchups : null;
    return body ? { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) } : { ok: false, status: 404, json: async () => null };
};

const GL = require('./game-locks.js');
App.StartSit = require('./startsit-engine.js');
const D = require('./dhq-proj.js');
require('./matchup.js');
const T = require('./ask-tools.js');

const PID = name => Object.keys(players).find(pid => players[pid].full_name === name);
async function boot() {
    await GL.load(LID, 2026, 5);
    D.get('warm');                       // sets the league|week key
    Object.assign(D._st.results, results);
}
const names = list => list.map(x => x.player || x.start || x);

test('locks load from the frozen Sleeper feeds: DAL is final', async () => {
    await boot();
    assert.equal(GL.ready(), true);
    assert.equal(GL.state(PID('KaVontae Turpin')).status, 'final');
    assert.equal(GL.actual(PID('Dak Prescott')), 16.64);
    assert.equal(GL.state(PID('Ryan Fitzgerald')).status, 'bye', 'CAR has no game in week 5');
    assert.equal(GL.isLocked(PID('Marlon Humphrey')), false);
});

test('get_start_sit: verdict-first shape', async () => {
    await boot();
    const out = await T.run('get_start_sit', {});
    assert.ok(!out.error, out.error);
    for (const k of ['decision', 'confidence', 'recommendation', 'optimal_lineup', 'changes', 'close_calls', 'do_not_start', 'questionable', 'evidence', 'rules_applied', 'method', 'locks_loaded']) assert.ok(k in out, 'has ' + k);
    assert.equal(out.locks_loaded, true);
    assert.equal(out.optimal_lineup.length, 23, 'every starting slot');
    for (const row of out.optimal_lineup) for (const k of ['slot', 'player', 'proj', 'floor', 'ceiling', 'locked']) assert.ok(k in row, row.player + ' has ' + k);
    for (const c of out.changes) for (const k of ['start', 'sit', 'slot', 'gain_pts', 'close_call', 'why']) assert.ok(k in c);
    assert.equal(typeof out.recommendation, 'string');
    assert.ok(/^(Start|Make|Your|Keep)/.test(out.recommendation), out.recommendation);
    assert.ok(Array.isArray(out.decision) && out.decision.length === out.changes.length);
});

test('scenarios 1–2: Turpin, Dak and Pickens are locked and never named in a swap', async () => {
    await boot();
    const out = await T.run('get_start_sit', {});
    const locked = ['KaVontae Turpin', 'Dak Prescott', 'George Pickens'];
    for (const c of out.changes) assert.ok(!locked.includes(c.start) && !locked.includes(c.sit), JSON.stringify(c));
    const row = n => out.optimal_lineup.find(x => x.player === n);
    assert.deepEqual([row('Dak Prescott').slot, row('Dak Prescott').proj, row('Dak Prescott').locked], ['QB', 16.6, true]);
    assert.deepEqual([row('KaVontae Turpin').slot, row('KaVontae Turpin').proj, row('KaVontae Turpin').locked], ['FLEX', 8.7, true]);
    assert.equal(row('Matthew Stafford').slot, 'SUPER_FLEX', 'Stafford keeps the superflex');
    assert.ok(out.rules_applied.some(r => /Locked/.test(r) && /Turpin/.test(r)));
});

test('scenarios 3–6: weak IDP starters go out for the better DL/LB/DB options, one exact assignment', async () => {
    await boot();
    const out = await T.run('get_start_sit', {});
    const sits = out.changes.map(c => c.sit), starts = out.changes.map(c => c.start);
    for (const n of ['Derick Hall', 'Tonka Hemingway', 'C.J. Henderson', 'Hezekiah Masses']) assert.ok(sits.includes(n), n + ' sits: ' + JSON.stringify(out.decision));
    for (const n of ['Chop Robinson', 'Aaron Donald', 'Treydan Stukes', 'Jermaine Johnson']) assert.ok(starts.includes(n), n + ' starts: ' + JSON.stringify(out.decision));
    const lineup = out.optimal_lineup.map(x => x.player);
    assert.equal(new Set(lineup).size, lineup.length, 'nobody counted twice');
    // The tool's total equals an exact assignment on the same numbers.
    const pool = Object.keys(FX.p13).filter(pid => !r13.reserve.includes(pid) && !r13.taxi.includes(pid) && GL.actual(pid) == null && results[pid] && lines[pid])
        .map(pid => ({ pid, pos: players[pid].position, positions: players[pid].fantasy_positions, available: results[pid].mean > 0, pts: results[pid].mean }));
    // Locked starters (Dak QB, Pickens WR, Turpin FLEX) keep their slots at actual points.
    const pinned = r13.starters.map((pid, i) => (GL.actual(pid) != null ? i : -1)).filter(i => i >= 0);
    assert.equal(pinned.length, 3);
    const open = FX.roster_positions.filter((s, i) => !pinned.includes(i));
    const exact = App.StartSit.optimalLineupWeekly(pool, open).total + pinned.reduce((t, i) => t + GL.actual(r13.starters[i]), 0);
    const best = out.evidence[0].match(/best ([\d.]+)/)[1];
    assert.equal(Number(best), Math.round(exact * 10) / 10);
});

test('scenario 7–9: Hendrickson (out), Fitzgerald (bye), Carr (no team) never start, and say why', async () => {
    await boot();
    const out = await T.run('get_start_sit', {});
    const why = n => (out.do_not_start.find(x => x.player === n) || {}).reason;
    // Owner test 2026-10-10: they're already on the bench, so they're not
    // listed ("bench Carr and Hendrickson" was noise)...
    for (const n of ['Trey Hendrickson', 'Ryan Fitzgerald', 'Derek Carr']) assert.equal(why(n), undefined, n);
    // ...but asked about by name, each one says why he sits.
    const asked = await T.run('get_start_sit', { players: ['Trey Hendrickson', 'Ryan Fitzgerald', 'Derek Carr'] });
    const why2 = n => (asked.do_not_start.find(x => x.player === n) || {}).reason;
    assert.equal(why2('Trey Hendrickson'), 'out');
    assert.equal(why2('Ryan Fitzgerald'), 'bye', 'a bye, not a low projection');
    assert.equal(why2('Derek Carr'), 'no NFL team');
    assert.ok(why('George Pickens') == null, 'a locked STARTER is not a do-not-start');
    const lineup = out.optimal_lineup.map(x => x.player);
    for (const n of ['Trey Hendrickson', 'Ryan Fitzgerald', 'Derek Carr', 'Will Levis']) assert.ok(!lineup.includes(n), n);
    assert.equal(out.optimal_lineup.find(x => x.slot === 'K').player, 'Cairo Santos');
});

test('scenarios 10–11: Humphrey and Deablo (Questionable, Sunday night) are flagged late with a pivot', async () => {
    await boot();
    const out = await T.run('get_start_sit', {});
    for (const n of ['Marlon Humphrey', 'Divine Deablo']) {
        const q = out.questionable.find(x => x.player === n);
        assert.ok(q, n + ' flagged');
        assert.equal(q.status, 'Questionable');
        assert.equal(q.late_game, true, n + ' plays BAL@ATL Sunday night');
        assert.ok(q.pivot, n + ' has a pivot');
        assert.ok(!out.optimal_lineup.some(x => x.player === q.pivot), 'the pivot is not already starting');
        // C.J. Henderson (DB, ATL) is benched by the best lineup and plays in
        // the same game, so he is still movable when inactives come out.
        assert.equal(q.pivot, 'C.J. Henderson');
        assert.equal(q.pivot_plays_later, true);
        assert.match(q.note, /swap in C\.J\. Henderson/);
    }
    assert.equal(out.confidence, 'high', 'clear gains, no coin flips, late Questionables have a pivot');
});

test('scenario 12: Holani vs Sutton is a coin flip that names the injury tag', async () => {
    await boot();
    const out = await T.run('get_start_sit', { players: ['George Holani', 'Courtland Sutton'] });
    const h = out.head_to_head;
    assert.ok(h, 'a head-to-head call');
    assert.equal(h.close_call, true);
    assert.equal(h.call, 'coin flip');
    assert.equal(h.pick, 'Courtland Sutton');
    assert.match(h.injury_note, /George Holani is Questionable/);
    assert.ok(h.tiebreak);
    assert.match(out.recommendation, /coin flip/);
    assert.match(out.recommendation, /Questionable/);
    assert.deepEqual(out.asked.map(x => [x.player, x.verdict]), [['George Holani', 'sit'], ['Courtland Sutton', 'start']]);
});

test('scenario 13: no dynasty value anywhere in a weekly call', async () => {
    await boot();
    const out = await T.run('get_start_sit', { players: 'Sutton or Meyers' });
    const s = JSON.stringify(out);
    assert.ok(!/"value"|dhq_value|league_rank|"call":"(buy|sell|hold)/.test(s), 'no dynasty fields');
    assert.ok(out.head_to_head && out.head_to_head.pick === 'Courtland Sutton');
});

test('scenario 16: truth law — a rostered player with no Sleeper line reads 0 with zero_reason', async () => {
    await boot();
    assert.equal(D.get(KNIGHT).mean, 0, 'DhqProj itself gates him to 0');
    const out = await T.run('get_start_sit', { players: ['Zonovan Knight'] });
    const a = out.asked[0];
    assert.equal(a.player, 'Zonovan Knight');
    assert.equal(a.proj, 0, 'never quoted with a non-zero number');
    assert.equal(a.verdict, "don't start: no_sleeper_line");
    assert.deepEqual(out.do_not_start.find(x => x.player === 'Zonovan Knight'), { player: 'Zonovan Knight', reason: 'no_sleeper_line' });
    const adv = await T.run('get_lineup_advice', {});
    assert.ok(!adv.start.some(x => x.name === 'Zonovan Knight'));
});

test('a later week is refused, not guessed', async () => {
    await boot();
    const out = await T.run('get_start_sit', { week: 6 });
    assert.match(out.error, /week 5/);
});

test('get_lineup_advice: one statistic (average week) for start and bench rows, locks flagged', async () => {
    await boot();
    const out = await T.run('get_lineup_advice', {});
    assert.ok(!out.error, out.error);
    assert.equal(out.locks_loaded, true);
    assert.ok(out.start.length && out.bench.length);
    for (const row of out.start.concat(out.bench)) {
        const pid = PID(row.name);
        const want = GL.actual(pid) != null ? GL.actual(pid) : results[pid].mean;
        assert.equal(row.proj, Math.round(want * 10) / 10, row.name + ' shows his average week, not the median');
        assert.equal(row.locked, GL.isLocked(pid));
    }
    const hall = out.bench.find(x => x.name === 'Derick Hall');
    assert.ok(hall && hall.proj === 0.4 && hall.floor != null && hall.ceiling != null);
    assert.ok(!out.locks_note);
});

test('get_lineup_advice says so when locks could not be loaded', async () => {
    await boot();
    const saved = GL._st.games; GL._st.games = {};
    try {
        const out = await T.run('get_lineup_advice', {});
        assert.equal(out.locks_loaded, false);
        assert.ok(out.locks_note);
    } finally { GL._st.games = saved; }
});

// ── startSitCall rules on small fixtures ──────────────────────────────
const call = T._startSitCall;
const base = (players, extra) => Object.assign({
    week: 5, locks_loaded: true, current_total: 10, best_total: 11,
    slots: [{ idx: 0, slotName: 'FLEX', elig: ['RB', 'WR', 'TE'] }],
    current: { 0: 'b' }, placed: { 0: 'a' }, players,
}, extra || {});
const P = (name, proj, o) => Object.assign({ name, positions: ['WR'], proj, floor: proj * 0.7, ceiling: proj * 1.35, locked: false, kick: 2, injury_status: null, zero_reason: null, roster_slot: 'bench' }, o || {});

test('close call, favored: the higher floor wins the tiebreak (keeps the healthy man)', () => {
    const out = call(base({ a: P('Q Guy', 8.0, { floor: 4.8, injury_status: 'Questionable' }), b: P('Steady', 7.5, { roster_slot: 'starter' }) }, { win_pct: 70 }));
    assert.equal(out.changes[0].close_call, true);
    assert.equal(out.close_calls[0].call, 'coin flip');
    assert.equal(out.close_calls[0].lean, 'Steady');
    assert.match(out.close_calls[0].tiebreak, /favored \(70%/);
    assert.match(out.decision[0], /^Keep Steady over Q Guy/);
    assert.equal(out.confidence, 'medium');
});

test('close call, underdog: the higher ceiling wins the tiebreak', () => {
    const out = call(base({ a: P('Boom', 8.0, { ceiling: 14 }), b: P('Safe', 7.5, { ceiling: 9, roster_slot: 'starter' }) }, { win_pct: 30 }));
    assert.equal(out.close_calls[0].lean, 'Boom');
    assert.match(out.decision[0], /^Start Boom over Safe at FLEX \(coin flip/);
});

test('a clear gain is a firm call with high confidence', () => {
    const out = call(base({ a: P('Chop Robinson', 4.4, { positions: ['DL', 'LB'] }), b: P('Derick Hall', 0.4, { positions: ['DL'], roster_slot: 'starter' }) }, { slots: [{ idx: 0, slotName: 'DL', elig: ['DL'] }], win_pct: 50 }));
    assert.equal(out.changes[0].close_call, false);
    assert.equal(out.changes[0].gain_pts, 4);
    assert.equal(out.recommendation, 'Start Chop Robinson over Derick Hall at DL (+4 pts).');
    assert.equal(out.confidence, 'high');
});

test('a sit who is out is never a coin flip, and locks not loaded means low confidence', () => {
    const out = call(base({ a: P('Backup', 1.0), b: P('Hurt', 0, { roster_slot: 'starter', zero_reason: 'out' }) }, { locks_loaded: false }));
    assert.equal(out.changes[0].close_call, false);
    assert.equal(out.confidence, 'low');
    assert.ok(out.warning);
    assert.deepEqual(out.do_not_start, [{ player: 'Hurt', reason: 'out' }]);
});

test('a locked player is never moved, even if handed a swap', () => {
    const out = call(base({ a: P('Bench Lock', 20, { locked: true }), b: P('Starter', 5, { roster_slot: 'starter' }) }));
    assert.equal(out.changes.length, 0);
    assert.deepEqual(out.do_not_start, [], 'a benched player is already benched: nothing to say');
});

test('swaps chain through a starter who only changes slots', () => {
    // Nwosu moves DL → LB; Donald takes DL; Wilson (LB) sits.
    const slots = [{ idx: 0, slotName: 'DL', elig: ['DL'] }, { idx: 1, slotName: 'LB', elig: ['LB'] }];
    const out = call(base({
        nwosu: P('Uchenna Nwosu', 9, { positions: ['DL', 'LB'], roster_slot: 'starter' }),
        wilson: P('Eric Wilson', 2, { positions: ['LB'], roster_slot: 'starter' }),
        donald: P('Aaron Donald', 8, { positions: ['DL'] }),
    }, { slots, current: { 0: 'nwosu', 1: 'wilson' }, placed: { 0: 'donald', 1: 'nwosu' } }));
    assert.deepEqual(out.changes.map(c => [c.start, c.sit]), [['Aaron Donald', 'Eric Wilson']]);
    assert.equal(out.changes[0].gain_pts, 6);
});

test('Questionable starter in a late game with no later pivot: says he cannot be swapped, names the fallback', () => {
    const slots = [{ idx: 0, slotName: 'DB', elig: ['DB'] }];
    const out = call(base({
        hum: P('Marlon Humphrey', 6.1, { positions: ['DB'], injury_status: 'Questionable', kick: 300, roster_slot: 'starter' }),
        early: P('Treydan Stukes', 3.9, { positions: ['DB'], kick: 100 }),
        hurt: P('Hurt DB', 5, { positions: ['DB'], kick: 400, zero_reason: 'out' }),
    }, { slots, current: { 0: 'hum' }, placed: { 0: 'hum' }, game_kicks: [100, 100, 100, 300] }));
    const q = out.questionable[0];
    assert.equal(q.late_game, true);
    assert.equal(q.pivot, 'Treydan Stukes', 'an out player is never the pivot');
    assert.equal(q.pivot_plays_later, false);
    assert.match(q.note, /cannot swap/);
    assert.equal(out.confidence, 'medium');
});

test('an early-game Questionable is not "late"', () => {
    const slots = [{ idx: 0, slotName: 'DB', elig: ['DB'] }];
    const out = call(base({ hum: P('Early Q', 6, { positions: ['DB'], injury_status: 'Questionable', kick: 100, roster_slot: 'starter' }) },
        { slots, current: { 0: 'hum' }, placed: { 0: 'hum' }, game_kicks: [50, 100, 100, 100, 300, 400] }));
    assert.equal(out.questionable[0].late_game, false);
    assert.equal(out.questionable[0].pivot, null);
});

test('Questionable starter with a bench pivot in a later game: start him, swap if inactive', () => {
    const slots = [{ idx: 0, slotName: 'DB', elig: ['DB'] }];
    const out = call(base({
        hum: P('Marlon Humphrey', 6.1, { positions: ['DB'], injury_status: 'Questionable', kick: 300, roster_slot: 'starter' }),
        late: P('Late DB', 3, { positions: ['DB'], kick: 400 }),
        early: P('Early DB', 3.9, { positions: ['DB'], kick: 100 }),
    }, { slots, current: { 0: 'hum' }, placed: { 0: 'hum' }, game_kicks: [100, 100, 100, 300, 400] }));
    const q = out.questionable[0];
    assert.equal(q.late_game, true);
    assert.equal(q.pivot, 'Late DB');
    assert.equal(q.pivot_plays_later, true);
    assert.match(q.note, /swap in Late DB/);
});
