'use strict';
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(process.env.MFL_MODULE_SOURCE||'reconai-shared/mfl-api.js','utf8');
const jwt=id=>'header.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,app_metadata:{user_id:id,session_version:1}})).toString('base64url')+'.fixture';
const session=id=>JSON.stringify({token:jwt(id),user:{id}});
const league={id:'mfl_12345_2025',season:'2025',_mfl:true,_mflLeagueId:'12345',_mflFranchiseId:'0001'};
function payloads(){return {
 league:{league:{id:'12345',year:'2025',name:'Controlled league',rosterSize:'2',starters:{position:[{name:'QB',count:'1'}]},franchises:{count:'2',franchise:[{id:'0001',name:'Fixture One'},{id:'0002',name:'Fixture Two'}]}}},
 rosters:{rosters:{franchise:[{id:'0001',player:[{id:'101',status:'ROSTER'}]},{id:'0002',player:[]}]}},
 players:{players:{player:[{id:'101',name:'Player, Fixture',position:'QB',team:'KCC'}]}},
 rules:{rules:{positionRules:[{positions:'QB',rule:[{event:'PY',points:'*.04'}]}]}},
 draftResults:{draftResults:{draftUnit:[{draftPick:[{round:'1',pick:'1',franchise:'0001',player:'101'},{round:'1',pick:'2',franchise:'0002',player:''}]}]}},transactions:{transactions:{transaction:[]}},futureDraftPicks:{futureDraftPicks:{franchise:[{id:'0001',futureDraftPick:[]},{id:'0002',futureDraftPick:[]}]}}
};}
const ok=data=>({ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)});
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
function fixture(options={}){
 const records=new Map([['mfl_creds_'+league.id,JSON.stringify({leagueId:'12345',year:'2025',_mflOwner:'app:a',franchiseId:'0001'})],['mfl_connection_owner_v1','app:a'],['fw_session_v1',session('a')],['mfl_league_id','12345'],['mfl_year','2025'],['mfl_franchise_id','0001']]),secrets=new Map([['mfl_api_key','fixture-key-a'],['mfl_api_key_context_v1',JSON.stringify({owner:'app:a',leagueKey:league.id})]]),calls=[],listeners=[];
 const storage=map=>({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)});
 const ctx={crypto:require('node:crypto').webcrypto,console:{log(){},warn(){}},URL,Date,Promise,Map,Set,WeakMap,AbortController,setTimeout,clearTimeout,atob:v=>Buffer.from(v,'base64').toString(),localStorage:storage(records),sessionStorage:storage(secrets),App:{CONFIG:{supabaseUrl:'https://controlled.invalid',functionsBase:'https://controlled.invalid/functions/v1',supabaseAnon:'fixture-anon'}},S:{currentLeagueId:'previous',players:{},rosters:['preserved'],platform:'sleeper'},OD:{getSessionToken:()=>JSON.parse(records.get('fw_session_v1')||'null')?.token||null},addEventListener:(name,fn)=>{if(name==='storage')listeners.push(fn);},fetch:async(url,init={})=>{const body=init.body?JSON.parse(init.body):null,target=new URL(body?.url||url),type=target.searchParams.get('TYPE');const req={url,init,body,target,type};calls.push(req);return options.fetch?options.fetch(req,calls.length):ok(payloads()[type]);}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 return{ctx,api:ctx.MFL,calls,records,secrets,install:id=>records.set('fw_session_v1',session(id)),event:key=>listeners.forEach(fn=>fn({key})),hydrate:(opts={})=>ctx.MFL.provider.hydrate({...league},opts)};
}

function consumer(options={}) {
 const x=fixture(options), effects=[], publications=[], timers=new Map();let serial=1;
 x.ctx.setInterval=fn=>{const id=serial++;timers.set(id,fn);return id;};x.ctx.clearInterval=id=>timers.delete(id);
 const timeout=x.ctx.setTimeout, clear=x.ctx.clearTimeout;
 x.ctx.setTimeout=(fn,ms)=>ms>=1000?x.ctx.setInterval(fn):timeout(fn,ms);
 x.ctx.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else clear(id);};
 Object.assign(x.ctx,{currentLeague:{...league,_platformCreds:{leagueId:'12345',year:'2025',franchiseId:'0001',_mflOwner:'app:a'}},
  useEffect:fn=>effects.push(fn),setHeaderDraftInfo:v=>publications.push(['header',v]),setLiveDraftStatus:v=>publications.push(['status',v]),setLiveDraftId:v=>publications.push(['id',v]),
  draftJustCompletedRef:{current:false},draftCompletedAtRef:{current:0},WR:{Sync:{refresh:v=>publications.push(['refresh',v])}},CustomEvent:class{},dispatchEvent:()=>publications.push(['event']),wrLog:()=>{}});
 vm.runInContext(fs.readFileSync('js/public-portfolio.js','utf8'),x.ctx);
 if(fs.existsSync('js/shared/mfl-draft-context.js'))vm.runInContext(fs.readFileSync('js/shared/mfl-draft-context.js','utf8'),x.ctx);
 const read=file=>process.env.MFL_DRAFT_BASELINE?require('node:child_process').execFileSync('git',['show',process.env.MFL_DRAFT_BASELINE+':'+file],{encoding:'utf8'}):fs.readFileSync(file,'utf8');
 function commandMount(){const source=read('js/draft/command-center.js'),start=source.indexOf('        React.useEffect(() => {',source.indexOf('// When mode===\'live-sync\'')),end=source.indexOf('\n\n        // ── Live-Sync ownership refresh',start);if(start<0||end<0)throw Error('Actual Command Center mirror effect not found');let cleanup;x.ctx.React={useEffect:f=>cleanup=f()};vm.runInContext(source.slice(start,end),x.ctx);return()=>cleanup?.();}
 function mount(kind){const file=kind==='header'?'js/league-detail.js':'js/draft-room.js',source=read(file),ast=require('@babel/standalone').packages.parser.parse(source,{plugins:['jsx']});let chosen;
  function walk(node){if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.callee.name==='useEffect'&&source.slice(node.start,node.end).includes('const fetchDrafts = isMfl'))chosen=source.slice(node.start,node.end);for(const v of Object.values(node))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}walk(ast);
  if(!chosen)throw Error('Actual draft effect not found');effects.length=0;vm.runInContext(chosen,x.ctx);const clean=effects[0]();return()=>clean?.();
 }
 vm.runInContext(read('js/draft/live-sync.js'),x.ctx);
 return{...x,publications,timers,mount,commandMount,live:x.ctx.DraftCC.liveSync};
}
module.exports={fixture,consumer,payloads,league,jwt,ok,deferred};
