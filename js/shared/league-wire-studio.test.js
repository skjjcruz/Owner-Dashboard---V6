// Run with:  node --test js/shared/league-wire-studio.test.js
// Ported from C2 tests/league-wire-studio.cjs (2026-09-27; component logic
// unchanged). Fixture names are generic.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const babel = require('@babel/standalone');
test('C2 Wire Studio: explicit-only loading, roving tabs, season isolation, timeouts, retry, focus return', async () => {
    const compiled = babel.transform(fs.readFileSync(path.join(__dirname, '..', 'components', 'league-wire-studio.js'), 'utf8'), { presets: ['react'] }).code;
    const nodes = node => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
    const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children || []).map(text).join(' ').replace(/\s+/g, ' ');
    const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
    const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    function harness(name, props, load = async () => ({ status: 'empty', rounds: [], paths: [] })) {
        let cursor = 0, tree, closed = 0, focused = 0, shown = 0, timerId = 0;
        const slots = [], pending = [], timers = new Map();
        const dialog = { showModal: () => shown++ };
        const React = {
            createElement: (type, attributes, ...children) => {
                if (type === 'dialog' && attributes.ref) attributes.ref.current = dialog;
                return { type, props: attributes || {}, children: children.flat(Infinity) };
            },
            Fragment: 'fragment',
            useId: () => { cursor++; return ':studio-test:'; },
            useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
            useRef: initial => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
            useEffect: (fn, deps) => {
                const i = cursor++, prior = slots[i];
                if (!prior || deps.some((value, n) => value !== prior.deps[n])) {
                    slots[i] = { deps, cleanup: prior?.cleanup };
                    pending.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
                }
            },
        };
        const window = { AbortController, WrWirePlayoffs: { load }, requestAnimationFrame: fn => fn() };
        const context = { React, window, document: { activeElement: { isConnected: true, focus: () => focused++ } }, console,
            setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
        vm.createContext(context); vm.runInContext(compiled, context);
        props = { onClose: () => closed++, ...props };
        return {
            render(update) { if (update) props = { ...props, ...update }; cursor = 0; tree = context[name](props); return tree; },
            effects() { while (pending.length) pending.shift()(); },
            unmount() { slots.forEach(slot => slot?.cleanup?.()); },
            timeout() { [...timers.values()].filter(t => t.ms === 30000).forEach(t => t.fn()); },
            tab(label) { nodes(tree).find(n => n.props.role === 'tab' && text(n) === label).props.onClick(); },
            closed: () => closed, focused: () => focused, shown: () => shown,
        };
    }
    const league = { league_id: '2026-league', season: '2026', name: 'Sample League' };
    const priorLeague = { league_id: '2025-league', season: '2025', name: 'Sample League' };
    const model = { kind: 'comparison', headline: 'A rivalry with context', eyebrow: 'Rivalry profile', season: 2026, throughWeek: 2,
        teams: [{ name: 'Alpha Owner', ownerId: 'a', record: '2–2', h2hRecord: '1–1', average: 100 }, { name: 'Bravo Owner', ownerId: 'b', record: '2–2', h2hRecord: '1–1', average: 90 }],
        recordScope: 'Records include median results', series: [
            { id: 'finals', label: 'Title games', scope: '2023–24 finals only', wins: [2, 0], ties: 0, meetings: [
                { id: '2023', label: '2023 final', points: [128.73, 114.2], names: ['Original A', 'Original B'], caption: 'A 14.53-point win.' },
                { id: '2024', label: '2024 final', points: [164.02, 107.07], caption: 'A 56.95-point win.' },
            ] },
            { id: 'regular', label: 'Regular season', scope: 'Verified loaded meetings', wins: [1, 1], ties: 0, meetings: [{ id: 'zero', label: 'Week 1', points: [0, null] }] },
        ], notes: ['Title games are separate from the regular-season series.'], sources: [] };

        const requests = [];
        const app = harness('WrWireStudio', { league, seasons: [{ league: priorLeague }], story: { id: 'story', broadcast: model }, race: { supported: false, rows: [] } }, args => { const d = deferred(); requests.push({ ...args, ...d }); return d.promise; });
        let tree = app.render(); app.effects(); await settle();
        assert.equal(app.shown(), 1);
        assert.equal(requests.length, 0, 'comparison opens without a playoff request');
        assert.equal(nodes(tree).filter(n => n.props.role === 'tab' && n.props.tabIndex === 0).length, 1, 'one roving tab stop');
        let keyPrevented = false, keyFocused = -1;
        const nav = nodes(tree).find(n => n.props.role === 'tablist');
        nav.props.onKeyDown({ key: 'End', preventDefault: () => { keyPrevented = true; }, currentTarget: { querySelectorAll: () => Array.from({ length: 4 }, (_, i) => ({ focus: () => { keyFocused = i; } })) } });
        tree = app.render(); app.effects(); await settle();
        assert(keyPrevented); assert.equal(keyFocused, 3); assert.equal(requests.length, 0, 'Race is also local');
        app.tab('Bracket'); tree = app.render(); app.effects(); await settle();
        assert.equal(requests.length, 1); assert.equal(requests[0].league.league_id, league.league_id);
        requests[0].resolve({ league, season: '2026', status: 'ready', rounds: [{ label: 'Current round', games: [] }], paths: [] }); await settle();
        tree = app.render();
        assert(nodes(tree).some(n => n.type?.name === 'WrWireStudioBracket' && n.props.data.season === '2026'));
        app.tab('Playoff path'); tree = app.render(); app.effects(); await settle();
        assert.equal(requests.length, 1, 'switching bracket/path shares the loaded snapshot');
        nodes(tree).find(n => n.props['aria-label'] === 'Playoff season').props.onChange({ target: { value: '2025-league:2025' } });
        tree = app.render();
        assert(!nodes(tree).some(n => n.type?.name === 'WrWireStudioPath'), 'new season never displays previous season data even before effects');
        app.effects(); await settle(); assert.equal(requests.length, 2);
        app.tab('Comparison'); tree = app.render(); app.effects();
        assert.equal(requests[1].signal.aborted, true, 'inactive playoff fetch aborts');
        requests[1].resolve({ league: priorLeague, season: '2025', status: 'ready', rounds: [], paths: [] }); await settle();
        tree = app.render();
        assert(!nodes(tree).some(n => n.type?.name === 'WrWireStudioPath'), 'late completion cannot change the active comparison');
        let stopped = 0, prevented = 0;
        tree.props.onCancel({ stopPropagation: () => stopped++, preventDefault: () => prevented++ });
        assert.equal(stopped, 1); assert.equal(prevented, 1); assert.equal(app.closed(), 1, 'Escape closes only Studio');
        app.unmount(); assert.equal(app.focused(), 1, 'close restores the connected opener');

        const retries = [];
        const errors = harness('WrWireStudio', { league }, async args => { retries.push(args.force); return retries.length === 1 ? { league, status: 'error', message: 'Scores unavailable' } : { league, status: 'ready', rounds: [], paths: [] }; });
        errors.render(); errors.effects(); await settle(); tree = errors.render();
        assert.match(text(tree), /Scores unavailable/);
        nodes(tree).find(n => n.type === 'button' && text(n) === 'Try again').props.onClick();
        tree = errors.render(); errors.effects(); await settle(); tree = errors.render();
        assert.deepEqual(retries, [false, true]); assert.doesNotMatch(text(tree), /Scores unavailable/);
        const slow = harness('WrWireStudio', { league }, () => new Promise(() => {}));
        slow.render(); slow.effects(); await settle(); slow.timeout(); tree = slow.render();
        assert.match(text(tree), /took too long/); slow.unmount();
        const historical = harness('WrWireStudio', { league, story: { documentary: true, eventSeason: 2020 } });
        tree = historical.render(); assert.match(text(tree), /2020.*whose playoff bracket/);
        const historicalModel = { ...model, playoffSeasons: [{ league_id: 'verified-2024', season: 2024 }] };
        const historic = harness('WrWireStudio', { league, story: { documentary: true, eventSeason: 2024, broadcast: historicalModel }, initialTab: 'path' }, args => { assert.equal(args.league.league_id, 'verified-2024'); return Promise.resolve({ league: args.league, status: 'empty', rounds: [], paths: [] }); });
        tree = historic.render(); historic.effects(); await settle();
        assert.equal(nodes(tree).find(n => n.props['aria-label'] === 'Playoff season').props.value, 'verified-2024:2024');
        historic.unmount(); errors.unmount();

        const comparison = harness('WrWireStudioComparison', { model });
        tree = comparison.render();
        assert.match(text(tree), /2023–24 finals only/); assert.match(text(tree), /Records include median/); assert.match(text(tree), /Season H2H: 1–1/);
        assert.match(text(tree), /164.02/);
        nodes(tree).find(n => n.props['aria-label'] === 'Recorded meeting').props.onChange({ target: { value: '2023' } });
        tree = comparison.render(); assert.match(text(tree), /128.73/); assert.match(text(tree), /Original A/);
        nodes(tree).find(n => n.props['aria-label'] === 'Comparison scope').props.onChange({ target: { value: 'regular' } });
        tree = comparison.render(); assert.match(text(tree), /0.00/); assert.match(text(tree), /—/); assert(!nodes(tree).some(n => n.props.className === 'wr-studio-result-track'), 'missing result never becomes a score graphic');
        assert.doesNotMatch(text(tree), /128.73|164.02/, 'switching scopes never carries the title-game score over');

        const bracket = harness('WrWireStudioBracket', { data: { rounds: [{ label: 'First round', weeks: [15], byes: [{ id: 1, name: 'Team Seven' }], games: [{ id: 1, status: 'pending', winnerId: 2, note: 'Score not verified', teams: [{ id: 2, name: 'A', points: null }, { id: 3, name: 'B', points: null }] }] }] } });
        tree = bracket.render(); assert.match(text(tree), /Team Seven · Bye/); assert.match(text(tree), /Awaiting verification/); assert.doesNotMatch(text(tree), /Final|0.00/);
        tree = bracket.render({ data: { provisional: true, rounds: [{ label: 'First round', weeks: [15], byes: [{ id: 1, name: 'Team Seven' }], games: [{ id: 1, status: 'scheduled', winnerId: 2, teams: [{ id: 2, name: 'A', points: 100 }, { id: 3, name: 'B', points: 90 }] }] }] } });
        assert.match(text(tree), /Provisional playoff bracket/); assert.match(text(tree), /Team Seven · Provisional bye/); assert.match(text(tree), /Provisional matchup/); assert.doesNotMatch(text(tree), /Scheduled|Bracket winner|100.00|90.00/);
        const pathData = { season: '2025', paths: [{ champion: true, team: { id: 1, name: 'Team Seven' }, rounds: [{ label: 'First round', weeks: [15], bye: true }, { label: 'Semifinal', weeks: [16], status: 'final', opponent: { name: 'Team Nine' }, points: [134.98, 102.57] }, { label: 'Championship', weeks: [17], status: 'final', opponent: { name: 'Team Ten' }, points: [133.37, 92.4] }] }] };
        const pathApp = harness('WrWireStudioPath', { data: pathData });
        tree = pathApp.render(); assert.match(text(tree), /2025 champion/); assert.match(text(tree), /133.37/); assert.match(text(tree), /92.40/);
        nodes(tree).find(n => n.type === 'button' && text(n).includes('Semifinal')).props.onClick(); tree = pathApp.render(); assert.match(text(tree), /134.98/); assert.match(text(tree), /102.57/);
        nodes(tree).find(n => n.type === 'button' && text(n).includes('First round')).props.onClick(); tree = pathApp.render(); assert.match(text(tree), /First-round bye/); assert.doesNotMatch(text(tree), /133.37|134.98/);
        tree = pathApp.render({ data: { ...pathData, provisional: true } });
        assert.match(text(tree), /A provisional playoff path/); assert.match(text(tree), /Provisional bye/); assert.match(text(tree), /not a confirmed matchup or bye/); assert.doesNotMatch(text(tree), /2025 champion|First-round bye/);
        nodes(tree).find(n => n.type === 'button' && text(n).includes('Semifinal')).props.onClick(); tree = pathApp.render();
        assert.match(text(tree), /Provisional matchup/); assert.doesNotMatch(text(tree), /134.98|102.57|Final/);
        const race = harness('WrWireStudioRace', { season: 2026, race: { supported: false, reason: 'Division rules need confirmation', throughWeek: 0, slots: 6, remainingWeeks: 14, rows: [{ id: 1, name: 'A', record: '0–0', status: 'Record range', minWins: 0, maxWins: 28, needed: 'Includes median wins; tiebreaks still apply.' }] } });
        tree = race.render(); assert.match(text(tree), /Division rules need confirmation/); assert.match(text(tree), /Possible final win total/); assert.match(text(tree), /Includes median wins/); assert.doesNotMatch(text(tree), /Week 0|Clinched/);
        void ('PASS Wire Studio: lazy requests, scoped seasons, cancellation, retry/timeout, keyboard tabs, focus/Escape, comparisons, byes, verified scores and conservative race ranges');
});
