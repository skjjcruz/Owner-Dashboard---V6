// Owner ask 2026-10-12 (AI-key security): no code is fetched live from an
// outside site. React, Supabase, Babel, Sentry and html2canvas are served
// from our own vendor/ copies, and every page's script-src allows only this
// site, so even injected markup can't pull in more code from elsewhere.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['index.html', 'landing.html', 'login.html', 'connect-sleeper.html', 'upgrade.html', 'gift.html', 'reset-password.html', 'admin.html', 'ai-setup.html', 'draft-war-room/index.html'];
const OUTSIDE = /https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|browser\.sentry-cdn\.com|cdn\.tailwindcss\.com)/i;

test('no page loads a script from an outside site (tags, backups or preconnects)', () => {
    for (const p of PAGES) {
        const html = read(p);
        assert.doesNotMatch(html, /<script[^>]+src=["']https?:\/\//i, p + ': <script src> points outside');
        assert.doesNotMatch(html, /document\.write\([^)]*https?:\/\//i, p + ': backup fetch from outside');
        assert.doesNotMatch(html, OUTSIDE, p + ': still references an outside code library');
    }
});

test('every page\'s script-src allows only this site', () => {
    for (const p of PAGES) {
        const m = read(p).match(/script-src([^;"]*)/);
        if (!m) continue; // admin.html has no policy of its own
        // The one exception: our own Lab's data folder (PFF matchup + usage
        // snapshots, built there because the PFF key lives only in that repo),
        // which DHQ projections read (js/shared/dhq-proj.js DATA_HOME).
        const extra = m[1].trim().split(/\s+/).filter(x => /https?:/i.test(x));
        assert.deepEqual(extra, p === 'index.html' ? ['https://skjjcruz.github.io/DHQ-Web-Page/data/'] : [], p + ' script-src: ' + m[1].trim());
    }
});

test('scripts that load other scripts use our own copies', () => {
    assert.match(read('js/export.js'), /s\.src = 'vendor\/html2canvas-1\.4\.1\/html2canvas\.min\.js'/);
    assert.match(read('index.html'), /sdkUrl: 'vendor\/sentry-8\.55\.0\/bundle\.min\.js'/);
    assert.match(read('index.html'), /<script src="vendor\/@babel\/standalone-7\.29\.7\/babel\.min\.js"><\/script>/);
    for (const f of ['vendor/sentry-8.55.0/bundle.min.js', 'vendor/html2canvas-1.4.1/html2canvas.min.js', 'vendor/@babel/standalone-7.29.7/babel.min.js', 'vendor/supabase.min.js', 'vendor/react.production.min.js', 'vendor/react-dom.production.min.js'])
        assert.ok(fs.statSync(path.join(ROOT, f)).size > 10000, f + ' is present');
    assert.match(read('vendor/sentry-8.55.0/bundle.min.js').slice(0, 80), /@sentry\/browser 8\.55\.0/);
});
