'use strict';
// A pinned actual-source failure reproduction; it does not read or mutate a provider.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process'),babel=require('@babel/standalone');
const source=cp.execFileSync('git',['show','80933bb:js/trade-calc.js'],{encoding:'utf8'}), declarations={};
babel.packages.traverse.default(babel.packages.parser.parse(source,{sourceType:'script',plugins:['jsx']}),{FunctionDeclaration(p){if(p.node.id)declarations[p.node.id.name]=source.slice(p.node.start,p.node.end);}});
const ctx={DRAFT_ROUNDS:7,PICK_HORIZON:3,currentLeague:null,S:{}};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(['detectPickIdMode','pickWindowYears','buildPicksByOwner'].map(name=>declarations[name]).join('\n'),ctx);
const rosters=[{roster_id:1,owner_id:'a'},{roster_id:2,owner_id:'b'}], output=[];
function record(name,l,trades,rounds,complete,expected){ctx.currentLeague=l;const actual=ctx.buildPicksByOwner(rosters,trades,2026,rounds,complete).a.length;assert.notEqual(actual,expected);output.push({name,actual,expected});}
const dynasty={id:'123',season:'2026',settings:{type:2,draft_rounds:4}},redraft={id:'123',season:'2026',settings:{type:0,draft_rounds:16}};
record('redraft local builder creates three years',redraft,[],16,false,16);
const cap=source.match(/const tcDraftRounds = ([^;]+);/)[1];ctx.currentLeague=redraft;ctx.leagueDraftRounds=null;
const actualRounds=vm.runInContext(cap,ctx);assert.equal(actualRounds,7);record('actual caller caps redraft then creates three years',redraft,[],actualRounds,false,16);
record('completed redraft receives future rights',redraft,[],16,true,0);
record('missing ownership invents complete original ownership',dynasty,undefined,4,false,'unavailable');
record('unknown recipient silently retains original ownership',dynasty,[{season:2026,round:1,roster_id:1,owner_id:99}],4,false,'unavailable');
record('foreign league ownership moves current rights',dynasty,[{league_id:'foreign',season:2026,round:1,roster_id:1,owner_id:2}],4,false,12);
ctx.S={currentLeagueId:'123',drafts:[{league_id:'123',season:'2026',status:'drafting',slot_to_roster_id:{1:1,2:2},picks:[{round:1,draft_slot:1,roster_id:1,player_id:'made'}]}]};
record('consumed current slot remains because caller has no progress input',dynasty,[],4,false,11);
const target='reports/public-readiness/evidence/trade-pick-caller-before.json';fs.writeFileSync(target,JSON.stringify({source:'80933bb:js/trade-calc.js',cases:output},null,2)+'\n');console.log(JSON.stringify(output));
