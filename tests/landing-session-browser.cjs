'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('@playwright/test');
const jwt=id=>'header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,app_metadata:{user_id:id}})).toString('base64url')+'.signature';
const session=id=>({token:jwt(id),user:{id,email:id+'@example.invalid',tier:'free'}});
(async()=>{let browser,server;try{
 const origin=await new Promise((resolve,reject)=>{server=spawn(process.execPath,['scripts/serve-static.cjs','--host=127.0.0.1','--port=0'],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>reject(Error('Preview did not start')),10000);server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 for(const scenario of ['oauth-race','repair-race','oauth-failure','provider-start','guest-espn','fresh-espn']){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});let release,requests=0;const denied=[];
  const existing=scenario==='repair-race'?{token:jwt('a')}:scenario==='oauth-failure'?session('b'):null;
  await context.addInitScript(({existing,scenario})=>{if(location.pathname!=='/landing.html')return;if(existing)localStorage.setItem('fw_session_v1',JSON.stringify(existing));if(scenario.endsWith('espn')){localStorage.setItem('wr_guest_v1','1');localStorage.setItem('espn_league_id','123');localStorage.setItem('espn_year','2026');sessionStorage.setItem('espn_s2','controlled-old-cookie');sessionStorage.setItem('espn_swid','controlled-old-swid');}window.__providerCalls=[];window.__fixtureScenario=scenario;},{existing,scenario});
  const sdk=`window.supabase={createClient:()=>({from:()=>({insert:()=>Promise.resolve()}),auth:{getSession:async()=>({data:{session:window.__fixtureScenario.startsWith('oauth')?{access_token:'fixture-oauth-a',user:{email:'a@example.invalid',app_metadata:{provider:'google'},user_metadata:{}}}:null}}),signInWithOAuth:args=>{window.__providerCalls.push(args);return new Promise(resolve=>window.__releaseProvider=resolve);},signOut:async()=>({})}})};`;
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
   if(url.origin===origin&&['/index.html','/connect-sleeper.html'].includes(url.pathname))return route.fulfill({status:200,contentType:'text/html',body:'<p>Controlled destination fixture</p>'});
   if(/\/supabase(?:\.min)?\.js$/.test(url.pathname))return route.fulfill({status:200,contentType:'application/javascript',body:sdk});
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'}});
   if(['fw-oauth-sync','fw-refresh-session'].some(x=>url.pathname.endsWith('/'+x))){requests++;await new Promise(resolve=>release=resolve);const failed=scenario==='repair-race'||scenario==='oauth-failure';return route.fulfill({status:failed?(scenario==='repair-race'?401:503):200,headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:JSON.stringify(failed?{error:'Controlled provider failure'}:session('a'))});}
   if(url.origin!==origin||!['GET','HEAD'].includes(req.method())){denied.push(url.pathname);return route.abort();}return route.continue();
  });
  const page=await context.newPage();const failures=[];page.on('pageerror',e=>failures.push(e.message));await page.goto(origin+'/landing.html'+(scenario.startsWith('oauth')?'#access_token=fixture':scenario==='fresh-espn'?'#dhq_session='+Buffer.from(JSON.stringify({...session('a'),isNew:true})).toString('base64url'):''),{waitUntil:'domcontentloaded'});
  if(scenario.endsWith('espn')){
   await page.waitForURL('**/'+(scenario==='fresh-espn'?'connect-sleeper.html':'index.html'));
   const stored=await page.evaluate(()=>({guest:localStorage.getItem('wr_guest_v1'),id:localStorage.getItem('espn_league_id'),year:localStorage.getItem('espn_year'),s2:sessionStorage.getItem('espn_s2'),swid:sessionStorage.getItem('espn_swid')}));
   if(scenario==='fresh-espn')assert.deepEqual(stored,{guest:null,id:null,year:null,s2:null,swid:null});else assert.equal(stored.id,'123');
  }else if(scenario==='provider-start'){
   await page.locator('#navSignin').tap();await page.locator('#btnGoogle').tap();await page.waitForFunction(()=>window.__providerCalls.length===1);assert.equal(await page.evaluate(()=>window.__providerCalls[0].options.skipBrowserRedirect),true);
   await page.evaluate(value=>localStorage.setItem('fw_session_v1',JSON.stringify(value)),session('b'));await page.evaluate(()=>window.__releaseProvider({data:{url:'https://accounts.google.com/controlled-never-open'}}));await page.waitForFunction(()=>!document.querySelector('#btnGoogle').disabled);assert.equal(new URL(page.url()).pathname,'/landing.html');
  }else{
   while(!release)await new Promise(r=>setTimeout(r,10));assert.equal(requests,1);
   if(scenario!=='oauth-failure')await page.evaluate(value=>localStorage.setItem('fw_session_v1',JSON.stringify(value)),session('b'));release();
   if(scenario==='oauth-failure')await page.locator('#alertJoin').filter({hasText:'Sign-in could not finish'}).waitFor();else await page.waitForTimeout(100);
   assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('fw_session_v1')))).user.id,'b');assert.equal(new URL(page.url()).pathname,'/landing.html');
   assert.equal(await page.locator('#wr-signing-in').count(),0);assert.equal(await page.locator('#preboot-hide').count(),0);
  }
  assert.deepEqual(failures,[],'Actual page must not throw');console.log(JSON.stringify({scenario,viewport:{width:390,height:844},result:'pass',unexpectedExternalRequestsBlocked:denied.length,realAccountsUsed:false}));await context.close();
 }
}finally{if(browser)await browser.close();if(server)server.kill('SIGTERM');}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
