'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture}=require('./mfl-lineup-session.cjs');
const source=process.env.MFL_LINEUP_BASELINE?fs.readFileSync(process.env.MFL_LINEUP_BASELINE,'utf8'):require('node:child_process').execFileSync('git',['show','d4d3540:js/tabs/lineup.js'],{encoding:'utf8'});
const hooks=source.slice(source.indexOf('    const mflApiKey ='),source.indexOf('    // MFL rosters don'));
function old(){const f=fixture();vm.runInContext('window.makeActions=function(){'+hooks+';return{doMflLogin,pushToMfl,mflDisconnect};};',f.x);return f;}
(async()=>{const a=old();a.secrets.set('mfl_write_cookie','MFL_USER_ID=account-a');a.secrets.set('mfl_write_host','www42.myfantasyleague.com');a.owner('b');a.render();assert.equal(a.states[0],'MFL_USER_ID=account-a');console.log('REPRODUCED actual baseline: B restores A cookie without owner metadata.');
const b=old();let resolve;b.render();b.credentials();b.x.MFL.mflLogin=()=>new Promise(r=>resolve=r);const run=b.render().doMflLogin();b.owner('b');resolve({cookie:'MFL_USER_ID=late-a',host:'www42.myfantasyleague.com'});await run;assert.equal(b.secrets.get('mfl_write_cookie'),'MFL_USER_ID=late-a');console.log('REPRODUCED actual baseline: A login resolves after B and persists A cookie.');
})().catch(e=>{console.error(e);process.exitCode=1;});
