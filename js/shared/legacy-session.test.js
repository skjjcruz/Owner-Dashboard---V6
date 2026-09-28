// Run with:  node --test js/shared/legacy-session.test.js
// Shared supabase-client.js (vendored in reconai-shared/): a legacy Sleeper-
// username login (login.html → get-session-token) stores its JWT in
// fw_session_v1 (+ a copy in od_session_v1). That token has
// app_metadata.sleeper_username and no user_id / session_version, so every
// fw-* endpoint answers 401 to it. The client must recognise it, never send
// it to fw-refresh-session, never clear it on that 401, and let its own exp
// govern expiry. Bug: ensureFreshAppSession's repair branch (`needsRepair =
// !session.user.id`) sent the legacy token to fw-refresh-session on every
// load and cleared fw_session_v1 on the 401, so the index.html gate bounced
// legacy users to the landing page on their first reload. (fw-profile was
// never reached for a legacy session — getAppSession() already refused it.)
// Users bitten before the fix still hold the live od_session_v1 copy +
// od_auth_v1: the client re-hydrates fw_session_v1 from it (the index.html
// gate does the same before the app loads).
// No network — fetch is stubbed.
/* global Buffer */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'reconai-shared', 'supabase-client.js'), 'utf8');
// index.html loads identity.js right before supabase-client.js.
const IDENTITY_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'reconai-shared', 'identity.js'), 'utf8');
const FW = 'fw_session_v1';
const OD_SESSION = 'od_session_v1';

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function jwt(claims) { return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url(claims) + '.sig'; }
const nowS = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
// Exact claim shape get-session-token issues (7-day TTL, sub = username).
function legacyToken(username, { exp, iat } = {}) {
    const e = exp || nowS() + 7 * DAY;
    return jwt({ iss: 'supabase', ref: 'sxshiqyxhhifvtfqawbq', role: 'anon', iat: iat || e - 7 * DAY, exp: e, sub: username, app_metadata: { sleeper_username: username, is_gifted: false } });
}
// What login.html storeSession() + OD.acquireSessionToken() leave behind.
function legacyStore(username, opts) {
    const token = legacyToken(username, opts);
    const expiresAt = new Date(JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).exp * 1000).toISOString();
    return {
        [FW]: { token, expiresAt, user: { sleeperUsername: username, isGifted: false } },
        [OD_SESSION]: { token, expiresAt, isGifted: false },
        od_auth_v1: { username, passwordHash: 'x', isGifted: false },
    };
}
function accountToken(id, { iat } = {}) {
    return jwt({ sub: id, iat: iat || nowS(), exp: nowS() + 4 * DAY, app_metadata: { user_id: id, email: id + '@x.test', tier: 'free', products: [], session_version: 1 } });
}

function makeStore(seed) {
    const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        m,
        get length() { return m.size; },
        key: i => Array.from(m.keys())[i] ?? null,
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: k => { m.delete(k); },
    };
}

function load({ local, session, fetchImpl, noIdentity } = {}) {
    const ls = makeStore(local), ss = makeStore(session);
    const calls = [];
    const events = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        localStorage: ls, sessionStorage: ss,
        setTimeout, clearTimeout, setInterval: () => 0, AbortController, URL, TextEncoder,
        atob: s => Buffer.from(s, 'base64').toString('binary'),
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        navigator: { userAgent: 'node', sendBeacon: () => true },
        document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, referrer: '', visibilityState: 'visible', title: '' },
        location: { href: 'http://localhost/index.html', pathname: '/index.html', search: '', hash: '', hostname: 'localhost', origin: 'http://localhost', reload() { ctx.reloaded = true; } },
        addEventListener() {}, dispatchEvent(ev) { events.push(ev); },
        fetch: async (url, opts) => {
            calls.push({ url: String(url), opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
            const r = fetchImpl ? await fetchImpl(String(url), opts) : { status: 200, body: {} };
            return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } };
        },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    if (!noIdentity) vm.runInContext(IDENTITY_SRC, ctx);
    vm.runInContext(SRC, ctx);
    return { ctx, OD: ctx.OD, ls, ss, calls, events };
}

const refresh401 = () => ({ status: 401, body: { error: 'Invalid or expired session.' } });

// ── recognition ─────────────────────────────────────────────────────────────
test('a legacy Sleeper token in fw_session_v1 is not an app-account session, but is the RLS token', () => {
    const env = load({ local: legacyStore('bob') });
    assert.equal(env.OD.getAppSession(), null, 'getAppSession: no app account');
    assert.equal(env.OD.getCurrentUserId(), null);
    assert.equal(env.OD.getSessionToken(), JSON.parse(env.ls.getItem(FW)).token, 'getSessionToken still hands out the legacy JWT for RLS reads');
    assert.equal(env.OD.getCurrentUsername(), 'bob');
    const acct = env.OD.passwordAccount();
    assert.deepEqual([acct.kind, acct.username], ['legacy', 'bob'], 'password flow still sees the legacy login');
    assert.equal(env.ss.getItem('dhq_credentials_owner_v1'), 'legacy:bob', 'account-switch guard identity');
});

// ── the bug: no refresh call, no clearing ───────────────────────────────────
test('ensureFreshAppSession never sends a legacy token to fw-refresh-session and never clears it', async () => {
    const env = load({ local: legacyStore('bob'), fetchImpl: refresh401 });
    const before = env.ls.getItem(FW);
    assert.equal(await env.OD.ensureFreshAppSession(), null);
    assert.equal(env.calls.length, 0, 'no network call at all');
    assert.equal(env.ls.getItem(FW), before, 'fw_session_v1 intact');
    assert.ok(env.ls.getItem(OD_SESSION), 'od_session_v1 intact');
    assert.ok(env.ls.getItem('od_auth_v1'), 'legacy local login intact');
    assert.equal(env.events.filter(e => e.type === 'dhq:session-expired').length, 0, 'no "session expired" event');
});

test('a legacy token older than a day (the "stale → slide" rule) is still left alone', async () => {
    const env = load({ local: legacyStore('bob', { iat: nowS() - 5 * DAY, exp: nowS() + 2 * DAY }), fetchImpl: refresh401 });
    await env.OD.ensureFreshAppSession();
    assert.equal(env.calls.length, 0);
    assert.ok(env.ls.getItem(FW));
});

test('loadProfile (the boot path that triggered the bug) makes no app-account call for a legacy login and keeps the session', async () => {
    const env = load({ local: legacyStore('bob'), fetchImpl: refresh401 });
    await env.OD.loadProfile(); // falls through to the legacy users-table read (no Supabase CDN here → null)
    assert.ok(!env.calls.some(c => /fw-profile|fw-refresh-session/.test(c.url)), 'no app-account endpoint called');
    assert.ok(env.ls.getItem(FW), 'session survives');
});

// ── users bitten before the fix: fw_session_v1 gone, od_session_v1 + od_auth_v1 left ──
test('a missing fw_session_v1 is re-hydrated from a live legacy od_session_v1 copy, in login.html\'s shape, with no network call', async () => {
    const store = legacyStore('bob');
    const odCopy = store[OD_SESSION];
    delete store[FW];
    const env = load({ local: store, fetchImpl: refresh401 });
    assert.equal(await env.OD.ensureFreshAppSession(), null, 'still not an app-account session');
    assert.equal(env.calls.length, 0);
    assert.deepEqual(JSON.parse(env.ls.getItem(FW)), { token: odCopy.token, expiresAt: odCopy.expiresAt, user: { sleeperUsername: 'bob', isGifted: false } });
    assert.equal(env.OD.passwordAccount().kind, 'legacy');
    // Second load: it is an ordinary legacy session now.
    const again = load({ local: Object.fromEntries(env.ls.m), fetchImpl: refresh401 });
    await again.OD.ensureFreshAppSession();
    assert.equal(again.calls.length, 0);
    assert.ok(again.ls.getItem(FW));
});

test('re-hydration never uses an expired copy, never runs in the guest lane, and never replaces an app-account session', async () => {
    const expired = legacyStore('bob', { exp: nowS() - DAY });
    delete expired[FW];
    const e1 = load({ local: expired, fetchImpl: refresh401 });
    await e1.OD.ensureFreshAppSession();
    assert.equal(e1.ls.getItem(FW), null, 'expired copy: nothing re-hydrated');
    assert.equal(e1.calls.length, 0);

    const guest = legacyStore('olduser');
    delete guest[FW];
    guest.wr_guest_v1 = '1';
    const e2 = load({ local: guest, fetchImpl: refresh401 });
    await e2.OD.ensureFreshAppSession();
    assert.equal(e2.ls.getItem(FW), null, 'guest tab stays a guest tab');
    assert.equal(e2.ss.getItem('dhq_credentials_owner_v1'), null);

    const acct = { token: accountToken('u1'), user: { id: 'u1', email: 'u1@x.test' } };
    const e3 = load({ local: { [FW]: acct, [OD_SESSION]: legacyStore('bob')[OD_SESSION] }, fetchImpl: refresh401 });
    const s = await e3.OD.ensureFreshAppSession();
    assert.equal(s.user.id, 'u1');
    assert.deepEqual(JSON.parse(e3.ls.getItem(FW)), acct, 'app account untouched');
});

test('an app-account token that ALSO carries sleeper_username is not legacy: it still refreshes', async () => {
    const id = 'u1';
    const mixed = jwt({ sub: id, iat: nowS() - 3 * DAY, exp: nowS() + 4 * DAY, app_metadata: { user_id: id, email: 'u1@x.test', sleeper_username: 'bob', tier: 'free', products: [], session_version: 1 } });
    const env = load({
        local: { [FW]: { token: mixed, user: { id, email: 'u1@x.test' } } },
        fetchImpl: () => ({ status: 200, body: { token: accountToken(id), user: { id, email: 'u1@x.test', tier: 'free', products: [] } } }),
    });
    const s = await env.OD.ensureFreshAppSession();
    assert.equal(env.calls.length, 1, 'refresh called');
    assert.match(env.calls[0].url, /fw-refresh-session$/);
    assert.equal(s.user.id, id);
    assert.equal(env.OD.passwordAccount().kind, 'account');
});

test('the legacy session survives three page loads (the reported bug was one reload)', async () => {
    let local = legacyStore('bob');
    let session = { espn_s2: 'S2', espn_swid: '{SWID}' };
    for (let i = 0; i < 3; i++) {
        const env = load({ local, session, fetchImpl: refresh401 });
        await env.OD.loadProfile();
        assert.ok(env.ls.getItem(FW), 'load ' + (i + 1) + ': fw_session_v1 present');
        assert.equal(env.ss.getItem('dhq_credentials_owner_v1'), 'legacy:bob');
        assert.equal(env.ss.getItem('espn_s2'), 'S2', 'same person: ESPN login kept');
        local = Object.fromEntries(Array.from(env.ls.m, ([k, v]) => [k, v]));
        session = Object.fromEntries(env.ss.m);
    }
});

// ── expiry: the token's own exp governs ─────────────────────────────────────
test('an expired legacy token is cleared (both copies) and announced, with no network call', async () => {
    const env = load({ local: legacyStore('bob', { exp: nowS() - DAY }), fetchImpl: refresh401 });
    assert.equal(env.OD.getSessionToken(), null, 'expired: no RLS token either');
    assert.equal(env.OD.passwordAccount().kind, 'expired');
    assert.equal(await env.OD.ensureFreshAppSession(), null);
    assert.equal(env.calls.length, 0);
    assert.equal(env.ls.getItem(FW), null, 'fw_session_v1 removed → next gate sends them to sign in');
    assert.equal(env.ls.getItem(OD_SESSION), null, 'dead od_session_v1 copy removed too');
    // Only the old browser-local login (od_auth_v1) is left: "sign in again".
    assert.equal(env.OD.passwordAccount().kind, 'local');
    const ev = env.events.find(e => e.type === 'dhq:session-expired');
    assert.equal(ev && ev.detail.reason, 'expired');
});

test('clearing a dead app session does not touch a still-live od_session_v1 copy', async () => {
    const liveLegacy = legacyToken('amy');
    const env = load({
        local: { [FW]: { token: accountToken('u1', { iat: nowS() - 3 * DAY }), user: { id: 'u1' } }, [OD_SESSION]: { token: liveLegacy, expiresAt: new Date(Date.now() + 6 * 864e5).toISOString() } },
        fetchImpl: refresh401,
    });
    await env.OD.ensureFreshAppSession();
    assert.equal(env.ls.getItem(FW), null, 'revoked app session dropped');
    assert.ok(env.ls.getItem(OD_SESSION), 'unexpired legacy copy kept');
});

// ── app accounts keep their behaviour ───────────────────────────────────────
test('an app-account token older than a day still refreshes and stores the slid session', async () => {
    const fresh = accountToken('u1');
    const env = load({
        local: { [FW]: { token: accountToken('u1', { iat: nowS() - 3 * DAY }), user: { id: 'u1', email: 'u1@x.test' } } },
        fetchImpl: (url) => (/fw-refresh-session/.test(url) ? { status: 200, body: { token: fresh, user: { id: 'u1', email: 'u1@x.test', tier: 'pro', products: ['war_room'] } } } : { status: 404, body: {} }),
    });
    const s = await env.OD.ensureFreshAppSession();
    assert.equal(env.calls.length, 1);
    assert.match(env.calls[0].url, /\/functions\/v1\/fw-refresh-session$/);
    assert.equal(env.calls[0].opts.headers.Authorization.startsWith('Bearer '), true);
    assert.equal(JSON.parse(env.ls.getItem(FW)).token, fresh, 'new token stored');
    assert.equal(s.user.tier, 'pro');
});

test('an app-account session missing user.id (old Google OAuth save) is still repaired', async () => {
    const env = load({
        local: { [FW]: { token: accountToken('u1'), user: { email: 'u1@x.test' } } },
        fetchImpl: () => ({ status: 200, body: { token: accountToken('u1'), user: { id: 'u1', email: 'u1@x.test', tier: 'free', products: [] } } }),
    });
    await env.OD.ensureFreshAppSession();
    assert.equal(env.calls.length, 1, 'repair call made');
    assert.equal(JSON.parse(env.ls.getItem(FW)).user.id, 'u1');
});

test('a token with neither claim shape is still treated as a dead app session on 401', async () => {
    const env = load({ local: { [FW]: { token: jwt({ sub: 'x', exp: nowS() + DAY, iat: nowS() - 2 * DAY, app_metadata: {} }), user: { id: 'x' } } }, fetchImpl: refresh401 });
    await env.OD.ensureFreshAppSession();
    assert.equal(env.calls.length, 1);
    assert.equal(env.ls.getItem(FW), null);
});

// ── sign-out still removes everything for a legacy login ────────────────────
test('explicit sign-out removes a legacy login\'s credentials (the handle cache stays)', () => {
    const env = load({ local: legacyStore('bob'), session: { espn_s2: 'S2' } });
    env.OD.clearSignedInState();
    for (const k of [FW, OD_SESSION]) assert.equal(env.ls.getItem(k), null, k);
    assert.ok(env.ls.getItem('od_auth_v1'), 'identity cache kept');
    assert.equal(env.OD.getSessionToken(), null, 'nothing left that signs in');
    assert.equal(env.ss.getItem('espn_s2'), null);
});
