'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('@playwright/test'), babel = require('@babel/standalone');
const root = path.resolve(__dirname, '..'), out = process.env.TRADE_PICK_EVIDENCE || path.join(root, 'tmp/trade-pick-browser');
fs.mkdirSync(out, { recursive: true });
const src = fs.readFileSync(path.join(root, 'js/trade-calc.js'), 'utf8');
const ast = babel.packages.parser.parse(src, { sourceType: 'script', plugins: ['jsx'] });
const functions = {};
babel.packages.traverse.default(ast, { FunctionDeclaration(p) { if (p.node.id) functions[p.node.id.name] = src.slice(p.node.start, p.node.end); } });
const hook = src.slice(src.indexOf('        const pickApi ='), src.indexOf('        function ownerNameForRosterId'));
assert(hook.includes('pickEvidence.previous'));
const styles = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[0]).join('\n');
const l = { id: '1234567890123456789', season: '2026', status: 'pre_draft', total_rosters: 2, settings: { type: 2, draft_rounds: 2 }, rosters: [{ roster_id: 1, owner_id: 'a', players: [] }, { roster_id: 2, owner_id: 'b', players: [] }] };
const fixture = `const {useState,useEffect,useMemo,useRef,useCallback}=React;
const useTcShowPsychTax=()=>[true,()=>{},()=>{}];
${functions.TcTradeSide}
${functions.TcVerdictPanel}
function Fixture(){
const currentLeague=React.useMemo(()=>({...${JSON.stringify(l)},settings:{...${JSON.stringify(l.settings)},type:location.hash==='#seasonal'?0:2}}),[]), allRosters=currentLeague.rosters, leagueId=currentLeague.id,timeRecomputeTs=0;
const [tradeOwner,setTradeOwner]=useState({A:'a',B:'b'}),[tradeIds,setTradeIds]=useState({A:[],B:[]}),[tradePickIds,setTradePickIds]=useState({A:[],B:[]}),[tradeFaab,setTradeFaab]=useState({A:0,B:0}),[searchText,setSearchText]=useState({A:'',B:''});
${hook}
window.__pickState={status:pickInventory.status,coverage:pickInventory.coverage,byOwner:pickInventory.byOwner,selected:tradePickIds,issue:pickIssue};
const deps={pickInventory,pickApi,retryPicks,tradeIds,tradePickIds,tradeFaab,tradeOwner,setTradeOwner,setSearchText,searchText,setTradeFaab,
picksByOwner:pickInventory.byOwner,getPlayerValue:()=>({value:100}),pickValueForParts:()=>999,FAAB_RATE:10,rosterPlayersFor:()=>[],comparePicksByDraftOrder:(a,b)=>a.year-b.year||a.round-b.round,
ownerOptions:[{id:'a',label:'Owner A'},{id:'b',label:'Owner B'}],playersData:{},MAX_VALUE:10000,posColor:()=>'',normPos:x=>x,PICK_COLORS:{},allRosters,ownerNameForRosterId:id=>'Team '+id,
pickLabel:(y,r)=>y+' R'+r,TC_POS_ORDER:{},addPlayer:()=>{},removePlayer:()=>{},makePickId:(y,r,id)=>'PICK-'+y+'-'+r+'-'+id,
addPick:(side,id)=>{if(pickApi.owns(pickInventory,tradeOwner[side],id))setTradePickIds(v=>({...v,[side]:[...v[side],id]}))},removePick:(side,id)=>setTradePickIds(v=>({...v,[side]:v[side].filter(p=>p!==id)}))};
return <main style={{maxWidth:720,margin:'0 auto',padding:12}}><h1>Trade builder</h1><TcTradeSide side="A" color="#d4af37" label="YOU SEND" {...deps}/>{pickIssue?<TcVerdictPanel pickIssue={pickIssue}/>:<p id="grade-state">Selected picks are verified for this owner.</p>}</main>;
} ReactDOM.createRoot(document.getElementById('root')).render(<Fixture/>);`;
const code = babel.transform(fixture, { presets: ['react'], sourceType: 'script' }).code;
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>body{margin:0;background:#181818;color:#ddd}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/vendor/react.production.min.js"></script><script src="/vendor/react-dom.production.min.js"></script><script>window.App={};window.S={currentLeagueId:'foreign',drafts:[]};localStorage.setItem('fw_session_v1','account-a');</script><script src="/reconai-shared/intelligence-context.js"></script><script src="/reconai-shared/team-assess.js"></script><script src="/js/trade-pick-inventory.js"></script><script src="/fixture.js"></script></body></html>`;
(async()=>{let server,browser;const result=[];try{
server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/fixture.html'){res.setHeader('Content-Type','text/html');return res.end(html);}if(pathname==='/fixture.js'){res.setHeader('Content-Type','application/javascript');return res.end(code);}const file=path.join(root,pathname);if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
for(const viewport of [{width:320,height:740},{width:390,height:844},{width:844,height:390}]){
const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});let fail=true,consumed=false,held=false,release;const requests=[];
const d=()=>({draft_id:'3456789012345678901',league_id:l.id,season:'2026',status:consumed?'drafting':'pre_draft',settings:{rounds:2,player_type:1},slot_to_roster_id:{1:1,2:2}});
await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin===origin){assert.equal(req.method(),'GET');return route.continue();}if(url.hostname!=='api.sleeper.app')return route.abort();assert.equal(req.method(),'GET');requests.push(url.pathname);if(held)await new Promise(r=>release=r);return route.fulfill({status:fail?503:200,headers:{'Access-Control-Allow-Origin':origin},contentType:'application/json',body:JSON.stringify(fail?{}:url.pathname.endsWith('/traded_picks')?[]:url.pathname.endsWith('/drafts')?[d()]:url.pathname.endsWith('/picks')?[{draft_id:d().draft_id,round:1,draft_slot:1,roster_id:1,player_id:'made'}]:d())}).catch(()=>{});});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/fixture.html');await page.getByText(/503/).waitFor();assert.equal(await page.locator('.tc-pick-select').count(),0);
fail=false;await page.getByRole('button',{name:'Refresh picks'}).tap();await page.waitForFunction(()=>window.__pickState.status==='ready');assert.equal(await page.locator('.tc-pick-select').count(),6);
await page.locator('.tc-pick-select').filter({hasText:'2026 R1'}).tap();assert.deepEqual(await page.evaluate(()=>window.__pickState.selected.A),['PICK-2026-1-1']);
fail=true;await page.getByRole('button',{name:'Refresh picks'}).tap();await page.getByText(/Previously checked picks/).waitFor();assert.equal(await page.locator('.tc-pick-select:disabled').count(),6);assert.match(await page.evaluate(()=>window.__pickState.issue),/preserved/);assert.equal(await page.locator('#grade-state').count(),0);await page.screenshot({path:path.join(out,viewport.width+'-stale.png'),fullPage:true});
fail=false;await page.getByRole('button',{name:'Refresh picks'}).tap();await page.locator('#grade-state').waitFor();assert.equal((await page.evaluate(()=>window.__pickState.selected.A)).length,1);
consumed=true;await page.getByRole('button',{name:'Refresh picks'}).tap();await page.waitForFunction(()=>window.__pickState.status==='ready'&&window.__pickState.byOwner.a.length===5);assert.match(await page.evaluate(()=>window.__pickState.issue),/no longer verified/);assert.deepEqual(await page.evaluate(()=>window.__pickState.selected.A),['PICK-2026-1-1']);
await page.locator('.tc-ta-player-row').getByRole('button',{name:'Remove 2026 R1',exact:true}).tap();await page.locator('#grade-state').waitFor();assert.equal((await page.evaluate(()=>window.__pickState.selected.A)).length,0);
assert((await page.evaluate(()=>document.documentElement.scrollWidth))<=viewport.width+1);await page.screenshot({path:path.join(out,viewport.width+'-recovered.png'),fullPage:true});
// Real hook remount/reload reads the provider again; it cannot revive the spent pick.
await page.reload();await page.waitForFunction(()=>window.__pickState.status==='ready');assert.equal(await page.locator('.tc-pick-select').filter({hasText:'2026 R1'}).count(),0);
consumed=false;await page.goto(origin+'/fixture.html#seasonal');await page.reload();await page.waitForFunction(()=>window.__pickState.status==='ready');assert.equal(await page.locator('.tc-pick-select').count(),2);assert.equal(await page.locator('.tc-pick-select').filter({hasText:'Value unavailable'}).count(),2);await page.locator('.tc-pick-select').first().tap();assert.match(await page.evaluate(()=>window.__pickState.issue),/seasonal pick values are unavailable/);
// Another tab identity event invalidates this mounted hook before a reply.
await page.evaluate(()=>{localStorage.setItem('fw_session_v1','account-b');window.dispatchEvent(new StorageEvent('storage',{key:'fw_session_v1'}));});await page.waitForFunction(()=>window.__pickState.status!=='ready');assert.equal(await page.locator('.tc-pick-select').count(),0);
assert.equal(errors.length,0,errors.join('\n'));result.push({viewport,requests:requests.length,checks:['503 no false empty capital','retry and selection','stale good rows retained but ungraded','retry restores same selection','consumed selected right retained with recovery','remove enables evaluation','reload rechecks rights','seasonal rights unpriced','mounted account invalidation','no overflow'],evidenceLevel:'actual TradeCalc pick hook, actual TcTradeSide/TcVerdictPanel, actual shared model; surrounding trade/player engine fixture'});await context.close();}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server?server.close(r):r());}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
