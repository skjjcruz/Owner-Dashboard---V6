'use strict';
const assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs');
const settings = fs.readFileSync('js/settings.js','utf8');
const settingsSource = settings.slice(settings.indexOf('    let dhqBillingPortalRequest'),settings.indexOf('    // ── Delete account'));
const screenshotDir = '/tmp/public-web-billing-screenshots';
fs.mkdirSync(screenshotDir,{recursive:true});
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const session = (id='a',tier='free') => ({ token: 'header.'+Buffer.from(JSON.stringify({sub:id,app_metadata:{user_id:id,session_version:0},exp:2000000000})).toString('base64url')+'.signature', user: { id, tier, email: id+'@example.invalid' } });
const marker = { userId:'a',billing:'annual',nonce:'controlled-return-12345' };
(async()=>{
  let browser,server;
  try {
    const origin=await new Promise((resolve,reject)=>{
      server=spawn(process.execPath,['scripts/serve-static.cjs','--host=127.0.0.1','--port=0'],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']});
      const timer=setTimeout(()=>reject(Error('Preview did not start')),10000);
      server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);
    });
    browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    async function setup(viewport,withReturn,handler) {
      const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});
      await context.addInitScript(({initial,marker,withReturn})=>{
        if(!sessionStorage.getItem('controlled-browser-seeded')){
          localStorage.setItem('fw_session_v1',JSON.stringify(initial));
          if(withReturn)sessionStorage.setItem('dhq_checkout_return_v1',JSON.stringify(marker));
          sessionStorage.setItem('controlled-browser-seeded','1');
        }
        // Accelerate only entitlement retry delays; request deadlines remain real.
        const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===4000||ms===10000?1:ms,...args);
      },{initial:session(),marker,withReturn});
      const blocked=[];
      await context.route('**/*',async route=>{
        const request=route.request(),url=new URL(request.url());
        if(url.origin==='https://sxshiqyxhhifvtfqawbq.supabase.co'){
          const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'};
          if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
          const result=await handler(url.pathname.split('/').pop(),request);
          return route.fulfill({status:result.status||200,headers,contentType:'application/json',body:JSON.stringify(result.data)});
        }
        if(url.origin===origin&&url.pathname==='/index.html')return route.fulfill({status:200,contentType:'text/html',body:'<h1>Controlled league destination</h1>'});
        if(url.origin===origin&&['GET','HEAD'].includes(request.method()))return route.continue();
        blocked.push(url.hostname);return route.abort();
      });
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/upgrade.html'+(withReturn?'?payment=success&return='+marker.nonce:''),{waitUntil:'domcontentloaded'});
      return {context,page,errors,blocked};
    }
    for(const viewport of [{width:320,height:740},{width:390,height:844},{width:844,height:390}]){
      let tier='free',portalCalls=0;
      const x=await setup(viewport,true,async endpoint=>{
        if(endpoint==='fw-refresh-session')return{data:session('a',tier)};
        if(endpoint==='fw-billing-portal'){portalCalls++;return{status:404,data:{code:'no_stripe_customer'}};}
        throw Error('Unexpected endpoint '+endpoint);
      });
      await x.page.getByRole('heading',{name:'Check your Pro access'}).waitFor();
      assert.equal(await x.page.locator('#chooser').isVisible(),false);
      assert.equal(new URL(x.page.url()).pathname,'/upgrade.html');
      assert.equal(await x.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      for(const id of ['checkBtn','manageBtn']){const box=await x.page.locator('#'+id).boundingBox();assert(box.height>=44,`${id} reachable touch target`);}
      await x.page.screenshot({path:path.join(screenshotDir,`pending-${viewport.width}x${viewport.height}.png`),fullPage:true});
      await x.page.reload();await x.page.getByRole('heading',{name:'Check your Pro access'}).waitFor();
      await x.page.locator('#manageBtn').tap();await x.page.locator('#alertPayment').filter({hasText:'Apple ID settings'}).waitFor();assert.equal(portalCalls,1);
      tier='pro';await x.page.locator('#checkBtn').tap();await x.page.waitForURL('**/index.html');
      assert.equal(await x.page.evaluate(()=>JSON.parse(localStorage.getItem('fw_session_v1')).user.tier),'pro');
      assert.equal(await x.page.evaluate(()=>sessionStorage.getItem('dhq_checkout_return_v1')),null);
      assert.deepEqual(x.errors,[]);console.log(JSON.stringify({scenario:'pending-reload-portal-guidance-check-confirmed',viewport,result:'pass',realProviderRequests:0}));await x.context.close();

      const bodies=[];
      const y=await setup(viewport,false,async(endpoint,request)=>{assert.equal(endpoint,'fw-create-checkout');bodies.push(request.postDataJSON());return{status:503,data:{code:'checkout_pending',error:'Checkout is still being prepared. Retry to recover it.'}};});
      await y.page.locator('#planAnnual').tap();await y.page.locator('#stripeBtn').tap();await y.page.locator('#alertPayment').filter({hasText:'still being prepared'}).waitFor();
      await y.page.reload();assert.equal(await y.page.locator('#planAnnual').getAttribute('aria-pressed'),'true');await y.page.locator('#stripeBtn').tap();await y.page.locator('#alertPayment').filter({hasText:'still being prepared'}).waitFor();
      assert.deepEqual(bodies[0],bodies[1]);assert.equal(bodies[0].billing,'annual');assert.equal(await y.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual(y.errors,[]);console.log(JSON.stringify({scenario:'checkout-error-retry-reload-exact-parameters',viewport,result:'pass',realProviderRequests:0}));await y.context.close();
    }
    for(const flow of ['fw-create-checkout','fw-billing-portal','settings-portal']){
      const endpoint=flow==='settings-portal'?'fw-billing-portal':flow;
      let release;
      const x=await setup({width:390,height:844},false,async requested=>{
        assert.equal(requested,endpoint);await new Promise(resolve=>release=resolve);return{data:{checkoutUrl:'https://checkout.stripe.com/never-open',url:'https://billing.stripe.com/never-open'}};
      });
      if(flow==='settings-portal'){await x.page.addScriptTag({content:settingsSource});await x.page.evaluate(()=>{const button=document.createElement('button');button.id='controlled-settings-manage';button.textContent='Manage from Settings';button.onclick=()=>dhqOpenBillingPortal();document.body.appendChild(button);});await x.page.locator('#controlled-settings-manage').tap();}
      else if(endpoint==='fw-create-checkout')await x.page.locator('#stripeBtn').tap();
      else await x.page.evaluate(()=>{document.getElementById('manageBtn').style.display='';manageSubscription();});
      while(!release)await new Promise(resolve=>setTimeout(resolve,10));
      await x.page.evaluate(value=>localStorage.setItem('fw_session_v1',JSON.stringify(value)),session('b'));
      release();if(flow==='settings-portal')await x.page.waitForFunction(()=>dhqBillingPortalRequest===null);else await x.page.getByRole('heading',{name:'Account changed'}).waitFor();
      assert.equal(new URL(x.page.url()).pathname,'/upgrade.html');assert.equal(await x.page.evaluate(()=>JSON.parse(localStorage.getItem('fw_session_v1')).user.id),'b');
      if(flow!=='settings-portal'){await x.page.locator('#reloadLink').scrollIntoViewIfNeeded();assert.equal(await x.page.locator('#reloadLink').isVisible(),true);}assert.deepEqual(x.errors,[]);
      console.log(JSON.stringify({scenario:'late-'+flow+'-cannot-cross-account',viewport:{width:390,height:844},result:'pass',realProviderRequests:0}));await x.context.close();
    }
    let release;
    const t=await setup({width:390,height:844},false,async()=>{await new Promise(resolve=>release=resolve);return{data:{checkoutUrl:'https://checkout.stripe.com/never-open'}};});
    await t.page.locator('#stripeBtn').tap();await t.page.locator('#alertPayment').filter({hasText:'timed out'}).waitFor({timeout:20000});assert.equal(await t.page.locator('#stripeBtn').isEnabled(),true);release();await t.page.waitForTimeout(100);assert.equal(new URL(t.page.url()).pathname,'/upgrade.html');assert.deepEqual(t.errors,[]);
    console.log(JSON.stringify({scenario:'actual-15-second-checkout-deadline-and-late-result',result:'pass',realProviderRequests:0}));await t.context.close();
  } finally { if(browser)await browser.close();if(server)server.kill('SIGTERM'); }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
