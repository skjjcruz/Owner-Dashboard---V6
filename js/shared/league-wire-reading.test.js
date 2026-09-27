// Run with:  node --test js/shared/league-wire-reading.test.js
// Ported from C2 tests/league-wire-reading.cjs (2026-09-27): short decks,
// complete search, saved-snapshot scope, honest week/timestamps, and the
// all-leagues component's account isolation before effects run.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const babel = require('@babel/standalone');
test('C2 Wire reading + all-league account isolation / studio dialog', () => {
    const root = {}; vm.createContext(root); vm.runInContext(fs.readFileSync(path.join(__dirname, 'league-wire-reading.js'),'utf8'), root);
    const api = root.WrWireReading;
    assert.equal(api.deck({ body: 'The result.\n\nWhy it matters.' }), 'The result.');
    assert(api.deck({ body: Array(60).fill('word').join(' ') }).endsWith('…'));
    assert(api.matches({ text:'Alpha wins', body:'Bravo falls to 0–2', league:{name:'Sample League'} }, 'alpha sample'));
    assert(!api.matches({ text:'Alpha wins' }, 'alpha bravo'));
    assert.equal(api.checked(null), '');
    const league = { league_id:'a', season:'2026' };
    const prior = { league, currentReady:true, currentUpdatedAt:1000, completedThrough:2, week:3, stories:[{text:'Week 2 recap'}] };
    const failure = {league, currentReady:false, resultsReady:false, scheduleReady:false, status:'partial', currentError:'Failed', week:4, completedThrough:0, stories:[]};
    const retained = api.retain(prior, failure);
    assert.equal(retained.week,3, 'saved edition keeps its original week after rollover');
    assert.equal(retained.currentUpdatedAt,1000);
    assert.equal(retained.stale,true);
    assert.equal(retained.stories[0].text,'Week 2 recap');
    assert.match(api.period(retained),/Results through Week 2 · Week 3 matchups/);
    assert.equal(api.retain(prior, {...failure,league:{...league,league_id:'b'}}).stories.length,0);
    assert.equal(api.retain(prior, {...failure,league:{...league,season:'2027'}}).stories.length,0);
    const freshResults = {...failure, resultsReady:true, stories:[{text:'Fresh results'}]};
    assert.equal(api.retain(prior,freshResults).stories[0].text, 'Week 2 recap', 'keep old period on incomplete week rollover');
    assert.equal(api.retain(prior,{...freshResults,week:3}).stories[0].text, 'Fresh results', 'accept fresh results in the same period');
    const scheduleOnly=api.retain({...prior,stories:[{text:'Saved recap'},{text:'Old preview',preview:true}]},{...failure,week:3,scheduleReady:true,stories:[{text:'Fresh preview',preview:true}]});
    assert.equal(scheduleOnly.stories[0].text,'Saved recap');
    assert.equal(scheduleOnly.stories[1].text,'Fresh preview');
    const historyTimeout=api.finish({...prior,status:'loading'},league);
    assert(historyTimeout.archiveError); assert(!historyTimeout.currentError); assert(!historyTimeout.stale);
    assert(api.finish({...prior,status:'loading',refreshing:true},league).currentError);
    assert.match(api.period({...prior,historical:true}),/2026 archive/);
    assert(!api.period({...prior,historical:true}).includes('matchups'));
    void ('PASS Wire reading: short decks, complete search, saved-snapshot scope and honest week/timestamps');

    // An account change cannot expose the previous account's private story selection
    // during the render before effect cleanup runs.
    let cursor=0; const state=[];
    root.React={useState:initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useRef:initial=>({current:initial}),useEffect(){},createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})};
    root.window=root; root.document={activeElement:null};
    root.App={LeagueLiveScores:{supported:()=>true}};
    root.WrWirePortfolio={headlines:entries=>entries.flatMap(e=>e.stories.map(s=>({...s,league:e.league}))),lookback:()=>null};
    vm.runInContext(babel.transform(fs.readFileSync(path.join(__dirname, '..', 'components', 'league-wire-portfolio.js'),'utf8'),{presets:['react']}).code,root);
    const props={leagues:[league],accountId:'first',onClose(){},onOpenLeague(){}};
    const render=()=>{cursor=0;return root.WrAllLeaguesWire(props);};
    const treeText=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):n.children.map(treeText).join(' ');
    render();state[0]={a:{...prior,stories:[{text:'Private followed rivalry',body:'A saved story.'}]}};
    assert.match(treeText(render()),/Private followed rivalry/);
    props.accountId='second';assert.doesNotMatch(treeText(render()),/Private followed rivalry/);
    void ('PASS Wire account transition: previous private stories hidden before effects');

    // Portfolio keeps the newspaper text-only and opens graphics in a separate dialog.
    const allNodes = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(allNodes)] : [];
    root.WrWireStudio = function Studio() {};
    props.accountId = 'first';
    state[0] = { a: { ...prior, race: { throughWeek: 2 }, stories: [{ text: 'Rivalry report', body: 'The current story.', broadcast: { kind: 'comparison' } }] } };
    let portfolioTree = render();
    assert(!allNodes(portfolioTree).some(n => ['img','svg','canvas'].includes(n.type) || n.type === root.WrWireStudio));
    allNodes(portfolioTree).find(n => n.props.className === 'wr-wire-studio-link').props.onClick();
    portfolioTree = render();
    assert(allNodes(portfolioTree).some(n => n.type === root.WrWireStudio && n.props.story.broadcast));
    props.accountId = 'second';
    assert(!allNodes(render()).some(n => n.type === root.WrWireStudio), 'previous account studio is hidden before effects');
    const keptRace = api.retain({ ...prior, race: { throughWeek: 2 } }, { ...failure, week: 3, race: { throughWeek: 0 } });
    assert.equal(keptRace.race.throughWeek, 2, 'failed score refresh keeps original race evidence');
    void ('PASS all-league studio: text-only front page, separate dialog, account isolation and retained race scope');

    // App authentication, not only the linked provider identity, scopes private preferences.
    props.accountId = 'first';
    root.App.AccountStorage = { owner: () => 'account:other' };
    assert.doesNotMatch(treeText(render()), /Rivalry report/);
    assert(!allNodes(render()).some(n => n.type === root.WrWireStudio), 'different app owner with same provider cannot inherit studio');
    void ('PASS Wire authenticated-owner scope with an unchanged Sleeper account');
});
