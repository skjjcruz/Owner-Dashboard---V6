'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../../../..'));
const shared = process.env.DHQ_SHARED_SOURCE || path.join(root, 'reconai-shared');
const league = extra => ({ id: '1234567890123456789', season: '2026', status: 'pre_draft', total_rosters: 2, settings: { type: 2, draft_rounds: 4 }, ...extra });
const rosters = [{ roster_id: 1, owner_id: 'a', players: [] }, { roster_id: 2, owner_id: 'b', players: [] }];
const draft = extra => ({ draft_id: '3456789012345678901', league_id: league().id, season: '2026', status: 'pre_draft', settings: { rounds: 4, player_type: 1 }, slot_to_roster_id: { 1: 1, 2: 2 }, ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
    const storage = new Map([['fw_session_v1', 'account-a']]), listeners = {}, requests = [];
    const ctx = { console, setTimeout, clearTimeout, AbortController, Date, App: {}, S: { currentLeagueId: 'foreign', drafts: [draft({ status: 'complete' })], tradedPicks: [{ season: 2026, round: 1, roster_id: 1, owner_id: 2 }] },
        localStorage: { getItem: key => storage.get(key) || null },
        addEventListener: (name, callback) => (listeners[name] ||= []).push(callback),
        fetch: async (url, init) => {
            requests.push(url);
            if (options.fetch) return options.fetch(url, init);
            if (url.endsWith('/traded_picks')) return { ok: true, json: async () => options.trades || [] };
            if (url.endsWith('/drafts')) return { ok: true, json: async () => options.drafts || [draft()] };
            if (url.endsWith('/picks')) return { ok: true, json: async () => options.picks || [] };
            return { ok: true, json: async () => options.detail || (options.drafts || [draft()])[0] };
        },
    };
    ctx.window = ctx; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(shared, 'intelligence-context.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(shared, 'team-assess.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/trade-pick-inventory.js'), 'utf8'), ctx);
    const api = ctx.App.TradePickInventory;
    return { ctx, storage, requests, api, change: () => { storage.set('fw_session_v1', 'account-b'); (listeners.storage || []).forEach(fn => fn({ key: 'fw_session_v1' })); },
        run: async (l = league()) => api.inventory(l, rosters, await api.load(l, rosters)) };
}

(async()=>{
 const x=fixture(),l=league(); const evidence=await x.api.load(l,rosters),state=x.api.inventory(l,rosters,evidence);
 x.storage.set('fw_session_v1','account-b');
 console.log(JSON.stringify({case:'ready state after same-document account switch',oldEvidenceStatus:x.api.inventory(l,rosters,evidence).status,canSpend:x.api.owns(state,'a','PICK-2026-1-1'),selectionIssue:x.api.selectionIssue(state,{A:'a'},{A:['PICK-2026-1-1']})}));
 const m=fixture(),calls=[]; m.ctx.MFL={fetchDraftStatus:async(...args)=>{calls.push({kind:'draft',id:args[0],key:args[2]});return [];},fetchFutureDraftPicks:async(...args)=>{calls.push({kind:'future',id:args[0],key:args[2]});return {futureDraftPicks:{}};}};
 let status, error; try { status=(await m.run(league({id:'mfl_7_2026',_mfl:true,_mflLeagueId:'7',_platformCreds:{leagueId:'999',year:'2026',apiKey:'fixture-other-league'}}))).status; } catch(e) { error=e.message; }
 console.log(JSON.stringify({case:'conflicting MFL connection',status,error,calls}));
})().catch(e=>{console.error(e);process.exitCode=1;});
