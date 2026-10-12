// Owner report 2026-10-12: Sign out did nothing in the native app. The
// browser's own confirm() / alert() / prompt() don't appear inside an app
// shell that doesn't support them (confirm silently answers "no"), so every
// screen uses the in-app boxes in js/shared/dhq-dialogs.js instead. The
// browser box survives only as a same-line fallback for when that file is
// missing (window.dhqX ? … : confirm(…)).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
const BARE = /(^|[^a-zA-Z0-9_.$])(window\.)?(confirm|alert|prompt)\s*\(/;

test('no screen calls the browser confirm / alert / prompt except as a fallback', () => {
    const files = walk('js').filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && !f.endsWith('dhq-dialogs.js')).concat(['admin.html']);
    const bad = [];
    for (const f of files) {
        read(f).split('\n').forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
            if (BARE.test(code) && !/dhq(Confirm|Notice|Prompt|CopyText)/.test(code)) bad.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 120));
        });
    }
    assert.deepEqual(bad, [], 'use window.dhqConfirm / dhqNotice / dhqPrompt / dhqCopyText:\n' + bad.join('\n'));
});

test('every page that uses the boxes loads js/shared/dhq-dialogs.js', () => {
    const index = read('index.html');
    const at = index.indexOf('js/shared/dhq-dialogs.js'), core = index.indexOf('src="js/core.js');
    assert.ok(at > 0 && at < core, 'index.html loads the boxes before core.js');
    assert.match(read('admin.html'), /js\/shared\/dhq-dialogs\.js/);
});

test('Sign out and Delete account ask through the in-app box', () => {
    const core = read('js/core.js');
    const fn = core.slice(core.indexOf('function handleLogout()'), core.indexOf('function handleLogout()') + 200);
    assert.match(fn, /askConfirm\(/);
    const s = read('js/settings.js');
    const del = s.slice(s.indexOf('async function dhqDeleteAccountFlow()'), s.indexOf('window.dhqDeleteAccountFlow = dhqDeleteAccountFlow;'));
    assert.match(del, /window\.dhqConfirm/); assert.match(del, /window\.dhqNotice/);
});

test('without a page (node), the boxes fall back to the browser functions with the same answers', async () => {
    const saved = { c: globalThis.confirm, p: globalThis.prompt, a: globalThis.alert };
    const seen = [];
    globalThis.confirm = m => { seen.push(['confirm', m]); return true; };
    globalThis.prompt = (m, v) => { seen.push(['prompt', m, v]); return ''; };
    globalThis.alert = m => { seen.push(['alert', m]); };
    try {
        delete require.cache[require.resolve('./dhq-dialogs.js')];
        const D = require('./dhq-dialogs.js');
        assert.equal(await D.dhqConfirm('Sure?'), true);
        assert.equal(await D.dhqPrompt('Tier:', { value: '3' }), '', 'blank stays blank (not Cancel)');
        assert.equal(await D.dhqNotice('Done'), undefined);
        assert.deepEqual(seen, [['confirm', 'Sure?'], ['prompt', 'Tier:', '3'], ['alert', 'Done']]);
        globalThis.prompt = () => null;
        assert.equal(await D.dhqPrompt('Tier:'), null, 'Cancel stays null');
    } finally { globalThis.confirm = saved.c; globalThis.prompt = saved.p; globalThis.alert = saved.a; }
});
