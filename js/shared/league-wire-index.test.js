// Run with:  node --test js/shared/league-wire-index.test.js
// index.html wiring for The Wire's deferred group. stat-catalog.js lives in
// BOTH the 'fa' and 'wire' groups; the module loader dedupes by src, so the
// two tags must carry the identical src (same ?v=) or it runs twice.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const tags = group => [...html.matchAll(new RegExp(`<script[^>]*data-wr-defer="${group}"[^>]*src="([^"]+)"`, 'g'))].map(m => m[1]);

test('stat-catalog.js has the identical src in the fa and wire groups', () => {
    const fa = tags('fa').filter(s => s.startsWith('js/shared/stat-catalog.js'));
    const wire = tags('wire').filter(s => s.startsWith('js/shared/stat-catalog.js'));
    assert.equal(fa.length, 1); assert.equal(wire.length, 1);
    assert.equal(wire[0], fa[0], 'bump both ?v= stamps together');
});

test('the wire group is complete, ordered, and ships no chronicle data file', () => {
    const wire = tags('wire').map(s => s.split('?')[0]);
    for (const f of ['league-wire-styles', 'league-wire-chronicles', 'league-wire-cache', 'league-wire-reading', 'league-wire-rivalries', 'league-wire-graphics', 'league-wire-playoffs', 'league-wire-journal', 'league-wire-portfolio', 'league-wire-nfl'])
        assert(wire.some(s => s.endsWith('/' + f + '.js')), f + ' is in the wire group');
    assert(wire.indexOf('js/shared/league-wire-chronicles.js') < wire.indexOf('js/shared/league-wire-journal.js'));
    assert.equal(wire[wire.length - 1], 'js/components/league-wire.js', 'the page component loads last');
    assert(!/league-wire-chronicles-data/.test(html));
    assert(/<script[^>]*src="js\/shared\/league-live-table\.js/.test(html), 'the live engines load at boot, before the group');
});
