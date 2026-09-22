'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
(async () => {
 let browser, server;
 try {
  const origin = process.env.READINESS_PUBLIC_ORIGIN || await new Promise((resolve,reject) => {
   server=spawn(process.execPath,['scripts/serve-static.cjs','--host=127.0.0.1','--port=0'],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});
   const timer=setTimeout(()=>reject(Error('Local public preview unavailable')),10000);
   server.stdout.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});
   server.once('error',reject);
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  for(const options of [
   {width:320,height:740}, {width:390,height:844}, {width:844,height:390},
   {width:390,height:430,reduced:true}, {width:390,height:844,noMotionLibrary:true},
  ]) {
   const context=await browser.newContext({viewport:{width:options.width,height:options.height},isMobile:true,hasTouch:true,reducedMotion:options.reduced?'reduce':'no-preference'});
   let calls=0,release,response={status:400,body:{error:'Invalid email or password.'}};
   let resetCalls=0,releaseReset,resetResponse={status:503,body:{error:'Reset is temporarily unavailable.'}};
   const unexpected=[];
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(options.noMotionLibrary&&/\/(?:gsap|ScrollTrigger|CustomEase|lenis)\.min\.js$/.test(url.pathname))return route.abort();
    if(url.origin===origin&&url.pathname==='/connect-sleeper.html')return route.fulfill({status:200,contentType:'text/html',body:'<p>Controlled next-page fixture</p>'});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'}});
    if(req.method()==='POST'&&url.pathname==='/functions/v1/fw-signin'){
     calls++;assert.deepEqual(req.postDataJSON(),{email:'auth-fixture@example.invalid',password:'FixturePassword1!'});
     await new Promise(resolve=>release=resolve);
     return route.fulfill({status:response.status,headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:JSON.stringify(response.body)});
    }
    if(req.method()==='POST'&&url.pathname==='/functions/v1/fw-request-password-reset'){
     resetCalls++;assert.deepEqual(req.postDataJSON(),{email:'auth-fixture@example.invalid'});
     await new Promise(resolve=>releaseReset=resolve);
     return route.fulfill({status:resetResponse.status,headers:{'Access-Control-Allow-Origin':'*'},contentType:'application/json',body:JSON.stringify(resetResponse.body)});
    }
    if(!['GET','HEAD'].includes(req.method())){unexpected.push(url.pathname);return route.abort();}
    return route.continue();
   });
   const page=await context.newPage();await page.goto(origin+'/landing.html',{waitUntil:'networkidle'});
   await page.locator('#navSignin').tap();
   await page.waitForFunction(()=>document.querySelector('#authTitle').textContent==='Welcome back');
   await page.waitForFunction(()=>Math.abs(document.querySelector('#auth').getBoundingClientRect().top-document.querySelector('.topbar').getBoundingClientRect().height-12)<3);
   await page.waitForFunction(()=>document.querySelector('.mcta').hidden);
   const layout=await page.evaluate(()=>{const nav=document.querySelector('.topbar__r').getBoundingClientRect();return{width:innerWidth,documentWidth:document.documentElement.scrollWidth,navRight:nav.right,navLeft:nav.left,inviteHidden:document.querySelector('.mcta').hidden};});
   assert(layout.navLeft>=0&&layout.navRight<=options.width+1,'Both navigation actions must fit the phone');
   assert(layout.documentWidth<=options.width+1,'Public landing must not widen the phone viewport');
   assert(layout.inviteHidden,'Sticky signup invitation must not cover the account form');
   await page.locator('#toggleMode').tap();assert.equal(await page.locator('#authTitle').innerText(),'Create your account');
   await page.locator('#navSignin').tap();assert.equal(await page.locator('#authTitle').innerText(),'Welcome back');
   await page.locator('#acctEmail').fill('auth-fixture@example.invalid');await page.locator('#acctPassword').fill('FixturePassword1!');
   await page.locator('#btnJoin').tap();await page.waitForFunction(()=>document.querySelector('#btnJoin').disabled);
   await page.locator('#acctPassword').focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');assert.equal(calls,1,'Enter during pending request must not duplicate submission');
   await page.locator('#navSignin').tap();assert.equal(await page.locator('#authTitle').innerText(),'Welcome back');
   release();await page.locator('#alertJoin').filter({hasText:'Invalid email or password.'}).waitFor();assert.equal(await page.locator('#acctEmail').inputValue(),'auth-fixture@example.invalid');assert(!(await page.locator('#btnJoin').isDisabled()));
   if(options.width===320){
    await page.locator('#btnJoin').tap();
    await page.locator('#alertJoin').filter({hasText:'Unable to finish signing in.'}).waitFor({timeout:25000});
    assert(!(await page.locator('#btnJoin').isDisabled()));assert.equal(calls,2);release();
   }
   await page.locator('#forgotBtn').tap();await page.waitForFunction(()=>document.querySelector('#forgotBtn').disabled);
   assert.equal(resetCalls,1);releaseReset();
   await page.locator('#alertJoin').filter({hasText:'Reset is temporarily unavailable.'}).waitFor();
   assert(!(await page.locator('#forgotBtn').isDisabled()));assert.equal(await page.locator('#acctEmail').inputValue(),'auth-fixture@example.invalid');
   resetResponse={status:200,body:{ok:true}};await page.locator('#forgotBtn').tap();await page.waitForFunction(()=>document.querySelector('#forgotBtn').disabled);releaseReset();
   await page.locator('#alertJoin').filter({hasText:'If that email has an account'}).waitFor();assert.equal(resetCalls,2);
   // A late successful response for A must never replace a newer B session.
   response={status:200,body:{token:'controlled-session-a',user:{id:'controlled-a'}}};
   await page.locator('#btnJoin').tap();await page.waitForFunction(()=>document.querySelector('#btnJoin').disabled);
   const newer={token:'controlled-session-b',user:{id:'controlled-b'}};await page.evaluate(value=>localStorage.setItem('fw_session_v1',JSON.stringify(value)),newer);release();
   await page.waitForFunction(()=>!document.querySelector('#btnJoin').disabled);assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('fw_session_v1'))),newer);assert(new URL(page.url()).pathname.endsWith('/landing.html'));
   await page.evaluate(()=>localStorage.removeItem('fw_session_v1'));
   await page.locator('#btnJoin').tap();await page.waitForFunction(()=>document.querySelector('#btnJoin').disabled);release();
   await page.waitForURL('**/connect-sleeper.html');assert.equal(calls,options.width===320?4:3);
   console.log(JSON.stringify({viewport:options,checks:['explicit sign-in and signup navigation','reachable touch controls','no horizontal viewport expansion','sticky invitation absent over form','single pending request including Enter','failed request retains fields and retries','timeout unlocks retry on narrow phone','reset failure is truthful and confirmed retry succeeds','late account response cannot replace current session','acknowledged sign-in reaches next-page fixture'],externalMutationGuard:true,blockedAnalytics:unexpected.filter(x=>x.includes('analytics')).length}));
   await context.close();
  }
 } finally {if(browser)await browser.close();if(server)server.kill('SIGTERM');}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
