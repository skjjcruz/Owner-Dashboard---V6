// Run with:  node --test js/shared/device-secret-keys.test.js
// One canonical list of the platform logins + personal AI keys that sign-out
// clears: DEVICE_SECRET_KEYS in DHQ-Shared supabase-client.js. landing.html,
// connect-sleeper.html (they don't load the shared client) and the core.js
// fallback carry copies — this fails the build the moment one drifts.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strings = src => Array.from(src.matchAll(/'([^']+)'/g), m => m[1]);

function canonical() {
    const src = read('reconai-shared/supabase-client.js');
    const m = src.match(/const DEVICE_SECRET_KEYS = \[([\s\S]*?)\];/);
    assert.ok(m, 'DEVICE_SECRET_KEYS found in supabase-client.js');
    return strings(m[1].replace(/\/\/[^\n]*/g, ''));
}

// The array literal that starts with 'espn_s2' and is cleared with forEach.
function pageCopy(file) {
    const src = read(file);
    const m = src.match(/\[('espn_s2'[\s\S]*?)\]\.forEach/);
    assert.ok(m, 'secret-key list found in ' + file);
    return strings(m[1]);
}

test('canonical list covers ESPN, MFL, Yahoo and every BYO AI key', () => {
    const keys = canonical();
    for (const k of ['espn_s2', 'espn_swid', 'mfl_api_key', 'mfl_write_cookie', 'yahoo_session_id',
        'dynastyhq_ai_key', 'dynastyhq_xai_key', 'dynastyhq_gemini_key', 'dynastyhq_anthropic_key', 'dynastyhq_apikey']) {
        assert.ok(keys.includes(k), k);
    }
});

for (const file of ['landing.html', 'connect-sleeper.html']) {
    test(file + ' clears every canonical key on sign-out', () => {
        const copy = pageCopy(file);
        for (const k of canonical()) assert.ok(copy.includes(k), file + ' is missing ' + k);
    });
}

test('core.js dhqSignOut fallback clears every canonical key', () => {
    const src = read('js/core.js');
    const m = src.match(/if \(!cleared\) keys\.push\(([\s\S]*?)\);/);
    assert.ok(m, 'fallback list found in core.js');
    const copy = strings(m[1]);
    for (const k of canonical()) assert.ok(copy.includes(k), 'core.js fallback is missing ' + k);
});
