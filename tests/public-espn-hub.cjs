'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const helper = fs.readFileSync('js/espn-hub.js', 'utf8');
const provider = fs.readFileSync('reconai-shared/espn-api.js', 'utf8');
const jwt = id => 'header.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: id, app_metadata: { user_id: id } })).toString('base64url') + '.fixture';
const identity = id => JSON.stringify({ token: jwt(id), user: { id } });
const rawLeague = (year = '2025') => ({ id: 123, seasonId: Number(year), settings: { name: 'Controlled ESPN', size: 2, scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] }, rosterSettings: { lineupSlotCounts: { 0: 1, 20: 1 } } },
    members: [{ id: 'owner-a', displayName: 'Owner A' }, { id: 'owner-b', displayName: 'Owner B' }],
    teams: [1, 2].map(id => ({ id, primaryOwner: id === 1 ? 'owner-a' : 'owner-b', location: 'Fixture', nickname: String(id), record: { overall: { wins: id, losses: 3 - id, pointsFor: 100 + id } }, roster: { entries: [{ playerId: 100 + id, lineupSlotId: 0, playerPoolEntry: { player: { id: 100 + id, fullName: 'Quarterback ' + id, defaultPositionId: 1, proTeamId: 12 } } }] } })) });
function deferred() { let resolve; return { promise: new Promise(r => resolve = r), resolve }; }
function fixture({ response = rawLeague(), store = new Map(), secrets = new Map(), fail = () => false } = {}) {
    if (!store.has('fw_session_v1')) store.set('fw_session_v1', identity('account-a'));
    if (!store.has('espn_league_id')) store.set('espn_league_id', '123');
    if (!store.has('espn_year')) store.set('espn_year', '2025');
    const storage = (data, kind) => ({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { if (fail(k, kind)) throw Error('quota'); data.set(k, String(v)); }, removeItem: k => data.delete(k) });
    const requests = [], events = {}, ctx = { console: { log() {}, warn() {}, error() {} }, Map, Set, WeakMap, Date, URL, Promise, AbortController, setTimeout, clearTimeout,
        atob: value => Buffer.from(value, 'base64').toString('utf8'), localStorage: storage(store, 'local'), sessionStorage: storage(secrets, 'session'),
        addEventListener: (name, fn) => { (events[name] ||= []).push(fn); }, App: {}, S: { platform: 'sleeper', currentLeagueId: 'active-original', rosters: ['unchanged'], players: { sentinel: { full_name: 'Preserve' } } },
        fetch: async (url, options) => { requests.push({ url, options }); const body = await (typeof response === 'function' ? response() : response); return { ok: true, json: async () => body }; } };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(provider, ctx); vm.runInContext(helper, ctx);
    ctx.ESPN.connectLeague = () => { throw Error('Mutating legacy connect must not be used'); };
    return { ctx, store, secrets, requests, load: (...args) => ctx.App.EspnHub.load(...args), api: ctx.App.EspnHub, event: key => events.storage.forEach(fn => fn({ key })) };
}
const tests = {
    async restoresExactSavedSeasonWithoutChangingActiveLeague() {
        const x = fixture(), before = JSON.stringify(x.ctx.S), league = await x.load();
        assert.equal(league.season, '2025'); assert.equal(league.id, 'espn_123_2025'); assert.equal(league.users.length, 2);
        assert.equal(league._espnTeamId, null); assert.equal(league.wins, null); assert.match(x.requests[0].url, /\/seasons\/2025\//); assert.equal(JSON.stringify(x.ctx.S), before);
    },
    async chosenTeamSurvivesReloadAndFreshRosterIdentity() {
        const x = fixture(), league = await x.load(), chosen = x.api.chooseTeam(league, '2');
        assert.equal(chosen.wins, 2); assert.equal(x.api.selectedRoster(chosen, league.rosters).owner_id, 'owner-b');
        const y = fixture({ store: x.store }), reloaded = await y.load(); assert.equal(reloaded._espnTeamId, '2');
        assert.equal(y.api.selectedRoster(reloaded, [{ roster_id: '2', players: ['fresh'] }]).players[0], 'fresh');
        assert.equal(y.api.selectedRoster(reloaded, [{ roster_id: '1' }]), undefined);
    },
    async selectionIsScopedToAccountAndSeason() {
        const x = fixture(), league = await x.load(); x.api.chooseTeam(league, '2'); x.store.set('fw_session_v1', identity('account-b'));
        const y = fixture({ store: x.store }); assert.equal((await y.load())._espnTeamId, null);
        x.store.set('fw_session_v1', identity('account-a')); x.store.set('espn_year', '2026');
        assert.equal((await fixture({ store: x.store, response: rawLeague('2026') }).load())._espnTeamId, null);
    },
    async delayedAccountAndConnectionChangesCannotPublishOrWrite() {
        for (const key of ['fw_session_v1', 'espn_year', 'espn_league_id']) {
            const wait = deferred(), x = fixture({ response: () => wait.promise }), request = x.load();
            x.store.set(key, key === 'fw_session_v1' ? identity('account-b') : 'changed'); const after = JSON.stringify([...x.store]);
            wait.resolve(rawLeague()); await assert.rejects(request, /changed/); assert.equal(JSON.stringify([...x.store]), after);
        }
    },
    async storageBoundaryInvalidatesSameBytes() {
        const wait = deferred(), x = fixture({ response: () => wait.promise }), request = x.load(); x.event('fw_session_v1'); wait.resolve(rawLeague()); await assert.rejects(request, /changed/);
    },
    async timeoutThenRetryIgnoresLateOriginalReply() {
        const wait = deferred(); let first = true;
        const x = fixture({ response: () => { if (first) { first = false; return wait.promise; } return rawLeague(); } });
        await assert.rejects(x.load(undefined, { timeoutMs: 5 }), /too long/); const good = await x.load();
        const saved = JSON.stringify([...x.store]); wait.resolve(rawLeague('2026')); await new Promise(r => setTimeout(r, 0));
        assert.equal(JSON.stringify([...x.store]), saved); assert.equal(good.season, '2025');
    },
    async missingPartialAndForeignPayloadsAreNotEmptySuccess() {
        for (const mutate of [r => null, r => ({ ...r, teams: [] }), r => ({ ...r, teams: r.teams.slice(0, 1) }),
            r => ({ ...r, teams: [r.teams[0], r.teams[0]] }), r => ({ ...r, seasonId: 2026 }), r => ({ ...r, id: 456 }),
            r => ({ ...r, teams: r.teams.map(t => ({ ...t, roster: undefined })) }), r => ({ ...r, settings: {} })]) {
            const x = fixture({ response: mutate(rawLeague()) }); await assert.rejects(x.load(), /complete/);
        }
    },
    async privateCredentialsStayInSessionAndReachProxy() {
        const x = fixture({ secrets: new Map([['espn_s2', 'test-s2'], ['espn_swid', 'test-swid']]) }); await x.load();
        assert.match(x.requests[0].url, /espn-proxy/); assert.equal(JSON.parse(x.requests[0].options.body).espnS2, 'test-s2'); assert.equal(x.store.has('espn_s2'), false);
    },
    async unknownIdentityAndIncompleteCookiesFailBeforeProvider() {
        const x = fixture(); x.store.set('fw_session_v1', identity('a').replace('"id":"a"', '"id":"b"')); await assert.rejects(x.load(), /changed/); assert.equal(x.requests.length, 0);
        const y = fixture({ secrets: new Map([['espn_s2', 'only-one']]) }); await assert.rejects(y.load(), /both/); assert.equal(y.requests.length, 0);
    },
    async appOwnerClaimsMustBeCompleteConsistentAndLive() {
        const exp=Math.floor(Date.now()/1000)+3600;
        for(const claims of [{exp,sub:'account-a'}, {exp,sub:'account-b',app_metadata:{user_id:'account-a'}}, {exp,app_metadata:{user_id:'account-a'}},
            {exp:'9999999999',sub:'account-a',app_metadata:{user_id:'account-a'}}, {exp:0,sub:'account-a',app_metadata:{user_id:'account-a'}}, {sub:'account-a',app_metadata:{user_id:'account-a'}}]) {
            const x=fixture();x.store.set('fw_session_v1',JSON.stringify({token:'header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture',user:{id:'account-a'}}));await assert.rejects(x.load(),/changed/);assert.equal(x.requests.length,0);
        }
        const x=fixture();x.store.set('fw_session_v1',JSON.stringify({token:'header.'+Buffer.from('{"exp":1e309,"sub":"account-a","app_metadata":{"user_id":"account-a"}}').toString('base64url')+'.fixture',user:{id:'account-a'}}));await assert.rejects(x.load(),/changed/);assert.equal(x.requests.length,0);
        const guest=fixture();guest.store.delete('fw_session_v1');guest.store.set('wr_guest_v1','1');const league=await guest.load();assert.equal(guest.api.chooseTeam(league,'1')._espnTeamId,'1');
        const signedIn=fixture();signedIn.store.set('wr_guest_v1','1');assert.equal(signedIn.api.capture().account,'account-a','a stale guest flag cannot relabel a valid signed-in account');
    },
    async failedTeamSaveAndUnknownTeamCannotClaimSelection() {
        const x = fixture({ fail: k => k.startsWith('espn_team_v1:') }), league = await x.load(); assert.throws(() => x.api.chooseTeam(league, '2'), /could not be saved/); assert.equal(league._espnTeamId, null);
        assert.throws(() => x.api.chooseTeam(league, 'foreign'), /Choose a team/);
    },
    async rejectedPrivateStorageRestoresPriorConnection() {
        const x = fixture({ response: rawLeague('2026'), fail: (key, kind) => kind === 'session' && key === 'espn_swid' });
        await assert.rejects(x.load({ leagueId: '123', year: '2026', espnS2: 'new-s2', swid: 'new-swid' }), /could not be saved/);
        assert.equal(x.store.get('espn_year'), '2025'); assert.equal(x.secrets.has('espn_s2'), false); assert.equal(x.secrets.has('espn_swid'), false);
    },
    async actualHubLoadCallbackPublishesOnlyNewestResponse() {
        const app = fs.readFileSync('js/app.js', 'utf8'), start = app.indexOf('        async function loadEspnData('), end = app.indexOf('\n        useEffect(', start);
        const x = fixture(); const wait = deferred(); let call = 0, leagues = [], error, busy;
        x.ctx.App.EspnHub.load = () => ++call === 1 ? wait.promise : Promise.resolve({ id: 'new', _espnTeamId: '2' }); x.ctx.App.EspnHub.isLeagueCurrent = () => true;
        Object.assign(x.ctx, { espnRequestRef: { current: 0 }, espnPageRef: { current: x.api.capture() }, setEspnConnecting: v => busy = v, setEspnError: v => error = v, setEspnLeagues: fn => leagues = fn(leagues), setEspnChoiceLeague() {} });
        vm.runInContext(app.slice(start, end), x.ctx); const first = x.ctx.loadEspnData(); await x.ctx.loadEspnData(); wait.resolve({ id: 'old' }); await first;
        assert.equal(JSON.stringify(leagues.map(l => l.id)), '["new"]'); assert.equal(busy, false); assert.equal(error, null);
    },
    async actualLeagueDetailCarriesSelectedTeamAndRejectsLateAccount() {
        const src = fs.readFileSync('js/league-detail.js', 'utf8');
        const ast = require('@babel/standalone').packages.parser.parse(src, { sourceType: 'script', plugins: ['jsx'] });
        function find(node) { if (!node || typeof node !== 'object') return null; if (node.type === 'FunctionDeclaration' && node.id?.name === 'loadLeagueDetails') return node; for (const val of Object.values(node)) { if (Array.isArray(val)) { for (const child of val) { const got = find(child); if (got) return got; } } else if (val && typeof val === 'object') { const got = find(val); if (got) return got; } } return null; }
        const fn = find(ast); assert(fn);
        for (const switchAccount of [false, true]) {
            const x = fixture(), league = x.api.chooseTeam(await x.load(), '2'), wait = deferred(); let applied, viewing, error;
            Object.assign(x.ctx, { currentLeague: league, loadSeqRef: { current: 0 }, sleeperUserId: 'not-an-espn-owner', activeYear: '2025', STATS_YEAR: '2024', SLEEPER_BASE_URL: 'https://controlled.invalid',
                setMyRoster() {}, setViewingOwnerId: v => viewing = v, setStandings() {}, setLoading() {}, setLoadStage() {}, setError: v => error = v,
                fetchAllPlayers: async () => ({}), fetchJSON: async () => ({}), resolvePlatformProvider: () => ({ id: 'espn', displayName: 'ESPN', hydrate: () => wait.promise }),
                applyHydrated: (_, options) => applied = options.myRosterData, installStarterReqCorrection() {} });
            vm.runInContext(src.slice(fn.start, fn.end), x.ctx); const request = x.ctx.loadLeagueDetails();
            await new Promise(r => setTimeout(r, 0)); if (switchAccount) x.store.set('fw_session_v1', identity('account-b'));
            wait.resolve({ rosters: league.rosters }); await request;
            assert.equal(viewing, 'owner-b'); assert.equal(error, undefined);
            assert.equal(applied?.roster_id, switchAccount ? undefined : '2');
        }
    },
    async actualLoaderAndProviderRejectForeignSeasonAndLateView() {
        const src=fs.readFileSync('js/league-detail.js','utf8');
        const ast=require('@babel/standalone').packages.parser.parse(src,{sourceType:'script',plugins:['jsx']});
        function find(node){if(!node||typeof node!=='object')return null;if(node.type==='FunctionDeclaration'&&node.id?.name==='loadLeagueDetails')return node;for(const value of Object.values(node)){if(Array.isArray(value)){for(const child of value){const found=find(child);if(found)return found;}}else if(value&&typeof value==='object'){const found=find(value);if(found)return found;}}return null;}
        const fn=find(ast);assert(fn);
        for(const mode of ['valid','foreign-season','account-switch','closed-view']){
            const wait=deferred();let count=0,applied,error;
            const x=fixture({secrets:new Map([['espn_s2','private-a-fixture'],['espn_swid','swid-a-fixture']]),response:()=>++count===1?rawLeague():count===2?wait.promise:{topics:[]}});
            x.ctx.OD={getSessionToken:()=>JSON.parse(x.store.get('fw_session_v1')).token};
            const league=x.api.chooseTeam(await x.load(),'2'),originalToken=x.ctx.OD.getSessionToken();
            Object.assign(x.ctx,{currentLeague:league,loadSeqRef:{current:0},sleeperUserId:'not-espn',activeYear:'2025',STATS_YEAR:'2024',SLEEPER_BASE_URL:'https://controlled.invalid',
                setMyRoster(){},setViewingOwnerId(){},setStandings(){},setLoading(){},setLoadStage(){},setError:value=>error=value,
                fetchAllPlayers:async()=>({}),fetchJSON:async()=>({}),resolvePlatformProvider:()=>x.ctx.ESPN.provider,
                applyHydrated:(hydrated,options)=>applied={hydrated,options},installStarterReqCorrection(){}});
            vm.runInContext(src.slice(fn.start,fn.end),x.ctx);const request=x.ctx.loadLeagueDetails();
            while(x.requests.length<2)await new Promise(resolve=>setTimeout(resolve,0));
            if(mode==='account-switch')x.store.set('fw_session_v1',identity('account-b'));
            if(mode==='closed-view')x.ctx.loadSeqRef.current++;
            wait.resolve(rawLeague(mode==='foreign-season'?'2026':'2025'));await request;
            if(mode==='valid'){assert.equal(applied.hydrated.rosters.length,2);assert.equal(applied.options.myRosterData.roster_id,'2');assert.equal(x.requests.length,3);assert.equal(error,undefined);}
            else{assert.equal(applied,undefined,mode);assert.equal(x.requests.length,2,'invalid continuation must not request private transactions');assert.match(error,mode==='foreign-season'?/requested season/:/changed/);}
            assert(x.requests.every(item=>item.options.headers.Authorization==='Bearer '+originalToken));
        }
    },
    async actualHubKeepsGoodDataOnFailureAndClearsInvalidAccount() {
        const app=fs.readFileSync('js/app.js','utf8'), start=app.indexOf('        async function loadEspnData('), end=app.indexOf('\n        useEffect(',start);
        let failure=false, responseWait; const x=fixture({response:()=>{if(responseWait)return responseWait.promise;if(failure)throw Error('controlled provider failure');return rawLeague();}});
        let leagues=[],error,choice;
        Object.assign(x.ctx,{espnRequestRef:{current:0},espnPageRef:{current:x.api.capture()},setEspnConnecting(){},setEspnError:v=>error=v,setEspnLeagues:v=>leagues=typeof v==='function'?v(leagues):v,setEspnChoiceLeague:v=>choice=typeof v==='function'?v(choice):v,setEspnS2Input(){},setEspnSwidInput(){}});
        vm.runInContext(app.slice(start,end),x.ctx);await x.ctx.loadEspnData();const good=leagues[0];
        failure=true;await x.ctx.loadEspnData();assert.equal(leagues[0],good);assert.match(error,/controlled provider failure/);
        failure=false;await x.ctx.loadEspnData();assert.equal(error,null);assert.equal(leagues.length,1);
        responseWait=deferred();const pending=x.ctx.loadEspnData();x.store.set('fw_session_v1',identity('account-b'));responseWait.resolve(rawLeague());await pending;
        assert.equal(leagues.length,0);assert.equal(choice,null);assert.match(error,/changed/);
    },
};
(async () => { let failed = 0; for (const [name, run] of Object.entries(tests)) { try { await run(); console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); } } if (failed) process.exitCode = 1; })();
