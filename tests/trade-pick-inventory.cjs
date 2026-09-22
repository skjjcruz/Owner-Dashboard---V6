'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
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
const tests = {
    async redraftUsesFullCurrentDraftAndNoFuture() {
        const d = draft({ settings: { rounds: 16, player_type: 0 } }), x = fixture({ drafts: [d] });
        const result = await x.run(league({ settings: { type: 0, draft_rounds: 16 } }));
        assert.equal(result.byOwner.a.length, 16); assert(result.byOwner.a.every(p => p.year === 2026));
        assert.equal(result.coverage.complete, true); assert.equal(x.api.priced(result, 2026), false);
    },
    async completedSeasonalHasNoRemainingRights() {
        for (const type of [0, 1]) {
            const x = fixture({ drafts: [draft({ status: 'complete' })] });
            const result = await x.run(league({ settings: { type, draft_rounds: 16 } }));
            assert.equal(result.byOwner.a.length, 0); assert.equal(result.coverage.complete, true);
        }
    },
    async completedDynastyKeepsAccepted2027To2029() {
        const x = fixture({ drafts: [draft({ status: 'complete' })] }), result = await x.run();
        assert.equal(result.byOwner.a.length, 12); assert.deepEqual([...new Set(result.byOwner.a.map(p => p.year))], [2027, 2028, 2029]);
        assert(x.api.priced(result, 2027));
    },
    async consumedTradedSlotIsNotOffered() {
        const d = draft({ status: 'drafting' });
        const x = fixture({ drafts: [d], trades: [{ season: 2026, round: 1, roster_id: 1, owner_id: 2 }], picks: [{ draft_id: d.draft_id, round: 1, draft_slot: 1, roster_id: 2, player_id: 'rookie' }] });
        const result = await x.run(); assert.equal(result.byOwner.a.length, 11); assert.equal(result.byOwner.b.length, 12);
        assert(!x.api.owns(result, 'b', 'PICK-2026-1-1')); assert(x.api.selectionIssue(result, { B: 'b' }, { B: ['PICK-2026-1-1'] }));
    },
    async pendingDraftIgnoresUnrelatedCompletedGlobal() {
        const x = fixture(), before = JSON.stringify(x.ctx.S), result = await x.run();
        assert.equal(result.byOwner.a[0].year, 2026); assert.equal(JSON.stringify(x.ctx.S), before);
    },
    async failureAndRetryDoNotProduceOriginalOwnership() {
        let fail = true;
        const x = fixture({ fetch: async url => {
            if (fail) return { ok: false, status: 503 };
            return { ok: true, json: async () => url.endsWith('/traded_picks') ? [{ season: 2026, round: 1, roster_id: 1, owner_id: 2 }] : url.endsWith('/drafts') ? [draft()] : draft() };
        } });
        await assert.rejects(x.run(), /503/); fail = false;
        const result = await x.run(); assert.equal(result.byOwner.a.length, 11); assert.equal(result.byOwner.b.length, 13);
    },
    async malformedOrForeignDraftDoesNotLookEmpty() {
        for (const data of [{}, [draft({ league_id: 'other' })], [draft(), draft()]]) {
            const x = fixture({ drafts: data }); await assert.rejects(x.run(), /incomplete|match/);
        }
        const x = fixture({ detail: draft({ season: '2025' }) }); await assert.rejects(x.run(), /season/);
    },
    async unknownOwnershipAndProgressPreserveUnknown() {
        const x = fixture({ trades: [{ season: 2026, round: 1, roster_id: 1, owner_id: 99 }] }), result = await x.run();
        assert.equal(result.coverage.complete, false); assert.equal(result.byOwner.a.length, 0);
        const partial = fixture({ drafts: [draft({ status: 'drafting', slot_to_roster_id: {} })] });
        const futureOnly = await partial.run(); assert.equal(futureOnly.coverage.complete, false); assert.equal(futureOnly.byOwner.a.length, 8);
        assert(futureOnly.byOwner.a.every(p => p.year > 2026));
    },
    async foreignTradeIsIgnoredWithoutUserIdGuessing() {
        const x = fixture({ trades: [{ league_id: 'other', season: 2026, round: 1, roster_id: 1, owner_id: 2 }] });
        assert.equal((await x.run()).byOwner.a.length, 12);
        const bad = fixture({ trades: [{ season: 2026, round: 1, roster_id: 1, owner_id: 'b' }] });
        assert.equal((await bad.run()).coverage.complete, false);
    },
    async lateAccountCannotChainDraftDetailRequests() {
        const held = deferred(), x = fixture({ fetch: async () => held.promise });
        const request = x.run(); x.change(); held.resolve({ ok: true, json: async () => [] });
        await assert.rejects(request, /account changed/); assert.equal(x.requests.length, 2);
    },
    async timeoutCannotResumeIntoFollowingRequests() {
        const held = deferred(), x = fixture({ fetch: async () => held.promise });
        await assert.rejects(x.api.load(league(), rosters, { timeoutMs: 5 }), /timed out/);
        held.resolve({ ok: true, json: async () => [draft()] }); await new Promise(r => setTimeout(r, 10)); assert.equal(x.requests.length, 2);
    },
    async unsupportedProviderNeverCallsSleeper() {
        for (const id of ['espn_44_2026', 'yahoo_44_2026']) {
            const x = fixture(), state = await x.run(league({ id })); assert.equal(state.coverage.complete, false); assert.equal(x.requests.length, 0);
        }
    },
    async leagueSeasonAndRosterCompletenessRequired() {
        const x = fixture(); await assert.rejects(x.run(league({ season: null })), /season/);
        await assert.rejects(x.run(league({ total_rosters: 3 })), /complete league roster/); assert.equal(x.requests.length, 0);
    },
    async oldSharedNeverCertifiesPhantomPicks() {
        const x = fixture(); x.ctx.App.buildPicksByOwner = () => ({ 1: [{ year: 2026, round: 1 }] });
        const result = await x.run(); assert.equal(result.coverage.complete, false); assert.equal(Object.keys(result.byOwner).length, 0);
    },
    async mflPreservesExactFutureAndDoesNotInventCurrentBoard() {
        const x = fixture(); x.ctx.MFL = { fetchDraftStatus: async () => [], fetchFutureDraftPicks: async () => ({ futureDraftPicks: { franchise: [{ id: '2', futureDraftPick: [{ year: '2029', round: '6', originalPickFor: '1' }] }] } }) };
        const l = league({ id: 'mfl_44_2026', _mfl: true, _mflLeagueId: '44' });
        const result = await x.run(l); assert.equal(result.coverage.complete, false); assert.equal(result.byOwner.a.length, 0); assert.equal(result.byOwner.b.length, 1);
        assert.equal(result.byOwner.b[0].year, 2029); assert.equal(result.byOwner.b[0].round, 6); assert.equal(x.requests.length, 0);
    },
    async mflTruncatedUnknownFutureAndForeignCredentialsAreNotComplete() {
        const x = fixture(); x.ctx.MFL = { fetchDraftStatus: async () => [draft({ draft_id: 'mfl_draft_44_2026', league_id: 'mfl_44_2026', _source: 'mfl', _dimensionsInferred: true, _slots: [{ round: 1, draft_slot: 1, roster_id: 1, player_id: '' }] })], fetchFutureDraftPicks: async () => null };
        const l = league({ id: 'mfl_44_2026', _mfl: true, _mflLeagueId: '44' }), result = await x.run(l);
        assert.equal(result.coverage.complete, false); assert.equal(result.byOwner.a.length, 0);
        await assert.rejects(x.run({ ...l, _mflLeagueId: '55' }), /incomplete/);
    },
    async readyEvidenceCannotOutliveSameDocumentAccount() {
        const x = fixture(), l = league(), evidence = await x.api.load(l, rosters), result = x.api.inventory(l, rosters, evidence);
        assert(x.api.owns(result, 'a', 'PICK-2026-1-1'));
        x.storage.set('fw_session_v1', 'account-b'); // no storage event in the document that writes it
        assert.equal(x.api.inventory(l, rosters, evidence).status, 'unavailable');
        assert.equal(x.api.owns(result, 'a', 'PICK-2026-1-1'), false);
        assert.equal(x.api.priced(result, 2027), false);
        assert.match(x.api.selectionIssue(result, { A: 'a' }, { A: ['PICK-2026-1-1'] }), /no longer verified/);
        x.storage.set('fw_session_v1', 'account-a'); assert.equal(x.api.owns(result, 'a', 'PICK-2026-1-1'), false, 'observed identity mismatch stays invalidated');
    },
    async mflExplicitCredentialsCannotConflictOrChangeUnderReadyData() {
        const x = fixture(); let calls = 0;
        x.ctx.MFL = { fetchDraftStatus: async () => { calls++; return []; }, fetchFutureDraftPicks: async () => { calls++; return { futureDraftPicks: { franchise: [] } }; } };
        const l = league({ id: 'mfl_44_2026', _mfl: true, _mflLeagueId: '44', _platformCreds: { leagueId: '999', year: '2026', apiKey: 'fixture-secret' } });
        await assert.rejects(x.api.load(l, rosters), /incomplete/); assert.equal(calls, 0);
        l._platformCreds.leagueId = '44'; const evidence = await x.api.load(l, rosters); assert.equal(calls, 2);
        const changed = { ...l, _platformCreds: { ...l._platformCreds, apiKey: 'replacement-secret' } };
        assert.equal(x.api.inventory(changed, rosters, evidence).status, 'unavailable');
        assert(!JSON.stringify(evidence).includes('replacement-secret'));
    },
    async changedFormatOrOwnerCannotReuseReadyEvidence() {
        const x = fixture(), l = league(), evidence = await x.api.load(l, rosters);
        const nextFormat = { ...l, settings: { type: 0, draft_rounds: 4 } };
        assert.equal(x.api.inventory(nextFormat, rosters, evidence).status, 'loading');
        assert.equal(x.api.inventory(l, [{ ...rosters[0], owner_id: 'replacement' }, rosters[1]], evidence).status, 'loading');
        assert.equal(x.api.inventory(l, rosters, evidence).status, 'ready');
    },
    async actualCallerGuardsGradeFinderAndOwnerSelection() {
        const x = fixture(), inventory = await x.run();
        const source = fs.readFileSync(path.join(root, 'js/trade-calc.js'), 'utf8');
        const babel = require('@babel/standalone'), declarations = {};
        babel.packages.traverse.default(babel.packages.parser.parse(source, { sourceType: 'script', plugins: ['jsx'] }), { FunctionDeclaration(p) { if (p.node.id) declarations[p.node.id.name] = source.slice(p.node.start, p.node.end); } });
        x.ctx.pickInventory = inventory; x.ctx.pickApi = x.api; x.ctx.tradeOwner = { A: 'b' }; x.ctx.tradePickIds = { A: ['PICK-2026-1-1'] };
        x.ctx.pickIssue = null;
        vm.runInContext(declarations.computeManualVerdict, x.ctx);
        const verdict = x.ctx.computeManualVerdict(); assert.match(verdict.pickIssue, /no longer verified/); assert.equal(verdict.grade, null); assert.equal(verdict.hasTrade, true);
        x.ctx.pickInventory = inventory; x.ctx.pickApi = x.api; x.ctx.picksByOwner = inventory.byOwner;
        x.ctx.pickAsset = p => ({ ...p, value: 10 }); x.ctx.comparePicksByDraftOrder = () => 0;
        vm.runInContext(declarations.pickAssetsForOwner, x.ctx); assert.equal(x.ctx.pickAssetsForOwner('a').length, 6 * 2);
        x.ctx.pickInventory = { ...inventory, status: 'stale' }; assert.equal(x.ctx.pickAssetsForOwner('a').length, 0);
        x.ctx.pickInventory = { ...inventory, coverage: { ...inventory.coverage, format: 'redraft' } }; assert.equal(x.ctx.pickAssetsForOwner('a').length, 0);
        x.ctx.pickInventory = inventory; x.ctx.myRosterId = 1; x.ctx.tradeOwner = { A: 'a', B: 'a' }; x.ctx.tradePickIds = { A: [], B: [] };
        x.ctx.setTradeOwner = update => { x.ctx.tradeOwner = update(x.ctx.tradeOwner); }; x.ctx.setTradePickIds = update => { x.ctx.tradePickIds = update(x.ctx.tradePickIds); }; x.ctx.setDealHqNotice = () => {};
        vm.runInContext(declarations.addPickRowToBuilder, x.ctx);
        assert.equal(x.ctx.addPickRowToBuilder({ id: 'PICK-2026-1-2', rosterId: 2, ownerId: 'b' }), true);
        assert.equal(x.ctx.tradeOwner.B, 'b'); assert.equal(x.ctx.tradePickIds.B[0], 'PICK-2026-1-2');
        assert.equal(x.ctx.addPickRowToBuilder({ id: 'PICK-2026-1-1', rosterId: 2, ownerId: 'b' }), false);
    },
    async actualAiCompletionCannotSaveOldAccountAnalysis() {
        for (const switchAccount of [false, true]) {
            const x = fixture(), state = await x.run(), held = deferred(), saves = [], updates = [];
            x.ctx.pickApi = x.api; x.ctx.pickInventory = state; x.ctx.tradeOwner = { A: 'a' }; x.ctx.tradePickIds = { A: [] };
            x.ctx.pickAccount = { current: x.api.capture() }; x.ctx.setAlexVerdict = value => updates.push(value);
            x.ctx.assessments = []; x.ctx.leagueId = league().id; x.ctx.buildTradeVerdictContext = () => ({ fixture: true });
            x.ctx.OD = { callAI: () => held.promise, saveAIAnalysis: (...args) => { saves.push(args); return Promise.resolve(); } };
            const source = fs.readFileSync(path.join(root, 'js/trade-calc.js'), 'utf8');
            const start = source.indexOf('        async function requestAlexVerdict('), end = source.indexOf('        function sendVerdictFeedback(', start);
            vm.runInContext(source.slice(start, end), x.ctx);
            const request = x.ctx.requestAlexVerdict({}, 'fixture-deal');
            if (switchAccount) x.storage.set('fw_session_v1', 'account-b');
            held.resolve({ analysis: 'Account A fixture analysis' }); await request;
            assert.equal(saves.length, switchAccount ? 0 : 1);
            assert.equal(updates.filter(update => update.text).length, switchAccount ? 0 : 1);
            if (switchAccount) { const before = updates.length; await x.ctx.requestAlexVerdict({}, 'later'); assert.equal(updates.length, before); }
        }
    },
    async staleSelectionRequiresRetryButPreservesIntent() {
        const x = fixture(), result = await x.run(), selections = { A: ['PICK-2026-1-1'], B: [] };
        assert.equal(x.api.selectionIssue(result, { A: 'a' }, selections), null);
        assert.match(x.api.selectionIssue({ ...result, status: 'stale' }, { A: 'a' }, selections), /preserved/);
        assert.equal(selections.A[0], 'PICK-2026-1-1');
        assert.equal(x.api.selectionIssue(result, { A: 'a' }, selections), null);
        assert.match(x.api.selectionIssue(result, { A: 'b' }, selections), /owner/);
    },
};
(async () => { for (const [name, test] of Object.entries(tests)) { await test(); console.log('PASS', name); } console.log(Object.keys(tests).length + ' actual shared/provider adapter groups passed.'); })().catch(error => { console.error(error); process.exitCode = 1; });
