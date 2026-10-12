// Owner report 2026-10-12: Sign out did nothing in the native app. The
// browser's own confirm()/alert() silently answer "no" inside an app shell
// that does not support them, so the account actions use the in-app box
// (core.js dhqConfirm / dhqNotice) instead.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

test('Sign out uses the in-app box, never the browser confirm()', () => {
    const core = read('js/core.js');
    const fn = core.slice(core.indexOf('function handleLogout()'), core.indexOf('function handleLogout()') + 300);
    assert.match(fn, /dhqConfirm\(/);
    assert.doesNotMatch(fn, /[^.a-zA-Z]confirm\(/);
    assert.match(core, /window\.dhqConfirm = dhqConfirm;/);
});

test('Delete account uses the in-app box for both checks and the error', () => {
    const s = read('js/settings.js');
    const start = s.indexOf('async function dhqDeleteAccountFlow()');
    const fn = s.slice(start, s.indexOf('window.dhqDeleteAccountFlow = dhqDeleteAccountFlow;'));
    assert.match(fn, /window\.dhqConfirm/);
    assert.match(fn, /window\.dhqNotice/);
    assert.doesNotMatch(fn.replace(/\/\/.*$/gm, '').replace(/Promise\.resolve\(confirm\(m\)\)/, ''), /[^.a-zA-Z]confirm\(/, 'only the no-DOM fallback may use confirm()');
});
