// Run with:  node --test js/shared/league-live-standings.test.js
// Ported verbatim from C2 tests/league-live-standings.cjs (2026-09-27) + our
// _platform marker and a Sleeper median/bye/odd-team sweep.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
require('./league-live-standings.js');
const compute=globalThis.App.LeagueLiveStandings.compute;
test('C2: live standings reconstruction',()=>{
const league={league_id:'1',settings:{start_week:1,playoff_week_start:15},rosters:[1,2,3,4].map(roster_id=>({roster_id,settings:{wins:9,losses:4,fpts:999,fpts_decimal:25}}))};
const scores=(values)=>values.map((points,i)=>({roster_id:i+1,matchup_id:Math.floor(i/2)+1,points}));
const run=(extra={})=>compute({league,week:2,priorWeeks:[{week:1,rows:scores([10,0,-2,4])}],board:{week:2,rows:scores([0,2,8,1])},started:true,...extra});
const row=(s,id)=>s.rows.find(r=>String(r.rosterId)===String(id));
let s=run();
assert.equal(row(s,1).wins,1); assert.equal(row(s,1).losses,1); assert.equal(row(s,1).pointsFor,10); assert.equal(row(s,1).pointsAgainst,2);
assert.equal(s.officialRows[0].pointsFor,999.25); assert.equal(row(s,1).currentResult,'L'); assert.equal(row(s,3).pointsFor,6);
assert.equal(run({priorWeeks:[]}).status,'official');
assert.equal(run({week:15}).status,'official');
assert.equal(run({isChopped:true}).status,'official');
assert.equal(run({league:{...league,platform:'espn'}}).status,'official');
s=run({started:false}); assert.equal(s.status,'baseline'); assert.equal(row(s,1).losses,0); assert.equal(row(s,1).currentResult,null);
s=run({started:false,startedRosterIds:['1']}); assert.equal(row(s,1).losses,1); assert.equal(row(s,3).wins,0);
s=run({week:1,priorWeeks:[],board:{week:1,rows:scores([0,0,0,0])}}); assert.equal(row(s,1).ties,1); assert.equal(row(s,1).rankChange,null);
const custom=scores([10,2,8,1]);custom[0].custom_points=0;
assert.equal(row(run({board:{week:2,rows:custom}}),1).currentPoints,0);
const missing=scores([null,2,8,1]); s=run({board:{week:2,rows:missing}});assert.equal(s.status,'partial');assert.equal(row(s,1).losses,0);assert.equal(row(s,1).currentPoints,null);
const bye=scores([1,2,3,4]);bye[0].matchup_id=null;bye[1].matchup_id=null;
s=run({board:{week:2,rows:bye}});assert.equal(row(s,1).currentResult,null);assert.equal(row(s,1).pointsFor,11);
const medianLeague={...league,settings:{...league.settings,league_average_match:1}};
s=run({league:medianLeague,week:1,priorWeeks:[],board:{week:1,rows:scores([0,2,2,4])}});
assert.equal(s.median,2);assert.equal(row(s,2).medianResult,'T');assert.equal(row(s,2).ties,1);assert.equal(row(s,4).wins,2);assert.equal(row(s,4).pointsFor,4);
s=run({currentWeek:1});assert.equal(s.status,'baseline');
s=run({league:{...league,settings:{start_week:2}},priorWeeks:[]});assert.equal(row(s,1).losses,1);assert.equal(row(s,1).pointsFor,0);
assert.equal(run({board:{week:1,rows:scores([100,0,0,0])}}).status,'partial');
// Missing history and malformed score values never become zero-point results.
assert.equal(run({priorWeeks:[{week:1,rows:scores([10,0,null,4])}]}).status,'official');
assert.equal(run({priorWeeks:[{week:1,rows:scores([10,0,'2',4])}]}).status,'official');
const duplicate=scores([10,0,2,4]);duplicate[3].roster_id=3;
assert.equal(run({priorWeeks:[{week:1,rows:duplicate}]}).status,'official');
s=run({week:1,priorWeeks:[],board:{week:1,rows:scores([-1,-1,-2,-3])}});
assert.equal(row(s,1).ties,1);assert.equal(row(s,1).pointsFor,-1);assert.equal(row(s,1).rank,row(s,2).rank);
const input={league,week:2,priorWeeks:[{week:1,rows:scores([10,0,-2,4])}],board:{week:2,rows:scores([0,2,8,1])},started:true};
const before=JSON.stringify(input);compute(input);assert.equal(JSON.stringify(input),before);
s=run({priorWeeks:[{week:1,rows:scores([0.1,0,0.3,0])}],board:{week:2,rows:scores([0.2,0,0, -1])}});
assert.equal(row(s,1).rank,row(s,3).rank,'Equal decimal PF shares a rank after accumulated floating-point sums');
});
test('our leagues: _platform espn/mfl fall back to the official record',()=>{
const league={league_id:'1',settings:{start_week:1,playoff_week_start:15},rosters:[1,2].map(roster_id=>({roster_id,settings:{wins:1,losses:0}}))};
assert.equal(compute({league:{...league,_platform:'espn'},week:2,priorWeeks:[],board:null}).status,'official');
assert.equal(compute({league:{...league,_platform:'mfl'},week:2,priorWeeks:[],board:null}).status,'official');
assert.equal(compute({league:{...league,settings:{...league.settings,type:3}},week:2,priorWeeks:[],board:null,isChopped:true}).status,'official');
});
test('odd team count: the bye team keeps its points and takes no decision',()=>{
const rosters=[1,2,3].map(roster_id=>({roster_id,settings:{}}));
const league={league_id:'9',settings:{start_week:1,playoff_week_start:15},rosters};
const rows=[{roster_id:1,matchup_id:1,points:100},{roster_id:2,matchup_id:1,points:90},{roster_id:3,matchup_id:null,points:80}];
const s=compute({league,week:1,priorWeeks:[],board:{week:1,rows},started:true});
const r3=s.rows.find(r=>r.rosterId===3);
assert.equal(r3.wins+r3.losses+r3.ties,0); assert.equal(r3.pointsFor,80); assert.equal(r3.opponentRosterId,null);
assert.equal(s.status,'live');
});
test('week 0 asks for the official record only (Game Day official view)',()=>{
const league={league_id:'9',settings:{start_week:1},rosters:[{roster_id:1,settings:{wins:2,losses:1,fpts:300,fpts_decimal:50}},{roster_id:2,settings:{wins:1,losses:2,fpts:250}}]};
const s=compute({league,week:0});
assert.equal(s.status,'official');
assert.deepEqual(s.officialRows.map(r=>[r.rosterId,r.rank,r.pointsFor]),[[1,1,300.5],[2,2,250]]);
});
