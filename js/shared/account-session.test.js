// Run with:  node --test js/shared/account-session.test.js
// Shared supabase-client.js (vendored in reconai-shared/): Settings password
// change and sign-out hygiene. No network — fetch is stubbed.
/* global Buffer */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'reconai-shared', 'supabase-client.js'), 'utf8');
const FW = 'fw_session_v1';
const OD_SESSION = 'od_session_v1';
const SB = 'sb-sxshiqyxhhifvtfqawbq-auth-token';

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function jwt(claims) { return b64url({ alg: 'HS256' }) + '.' + b64url(claims) + '.sig'; }
const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;
const accountToken = (id, extra) => jwt({ sub: id, exp: future(), iat: Math.floor(Date.now() / 1000), app_metadata: { user_id: id, email: id + '@x.test', session_version: 1, ...(extra || {}) } });
const legacyToken = (u, exp) => jwt({ sub: u, exp: exp || future(), app_metadata: { sleeper_username: u } });

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

function load({ local, session, fetchImpl } = {}) {
    const ls = makeStore(local), ss = makeStore(session);
    const calls = [];
    const ctx = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        localStorage: ls, sessionStorage: ss,
        setTimeout, clearTimeout, setInterval: () => 0, AbortController, URL, TextEncoder,
        atob: s => Buffer.from(s, 'base64').toString('binary'),
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
        navigator: { userAgent: 'node', sendBeacon: () => true },
        document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, referrer: '', visibilityState: 'visible', title: '' },
        location: { href: 'http://localhost/index.html', pathname: '/index.html', search: '', hash: '', hostname: 'localhost', origin: 'http://localhost', reload() { ctx.reloaded = true; } },
        addEventListener() {}, dispatchEvent() {},
        fetch: async (url, opts) => {
            calls.push({ url: String(url), opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
            const r = fetchImpl ? await fetchImpl(String(url), opts) : { status: 200, body: {} };
            return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => { if (r.body === undefined) throw new Error('no json'); return r.body; } };
        },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return { ctx, OD: ctx.OD, ls, ss, calls };
}

const SECRETS = { espn_s2: 'S2', espn_swid: '{SWID}', mfl_api_key: 'KEY', mfl_write_cookie: 'C', dynastyhq_ai_key: 'AI' };

// ── sign-out hygiene ────────────────────────────────────────────────────────
test('explicit sign-out clears sessions, platform logins, AI keys and Google session — keeps league ids', () => {
    const env = load({
        local: { [FW]: { token: accountToken('u1'), user: { id: 'u1' } }, [OD_SESSION]: { token: legacyToken('bob') }, od_auth_v1: { username: 'bob' },
            wr_guest_v1: '1', [SB]: { user: { email: 'u1@x.test' } }, espn_s2: 'OLD', espn_league_id: '687493', mfl_league_id: '10005', mfl_franchise_id: '0001',
            espn_creds_espn_687493: { leagueId: '687493', espnS2: 'LEAK', swid: 'LEAK' }, mfl_creds_mfl_10005: { leagueId: '10005' }, wr_bigboard_x: '[1]' },
        session: { ...SECRETS },
    });
    env.OD.clearSignedInState();
    for (const k of [FW, OD_SESSION, 'od_auth_v1', 'wr_guest_v1', SB, 'espn_s2']) assert.equal(env.ls.getItem(k), null, k);
    for (const k of Object.keys(SECRETS)) assert.equal(env.ss.getItem(k), null, k);
    assert.deepEqual(JSON.parse(env.ls.getItem('espn_creds_espn_687493')), { leagueId: '687493' }, 'secret fields stripped, record kept');
    assert.equal(env.ls.getItem('mfl_creds_mfl_10005'), '{"leagueId":"10005"}');
    for (const k of ['espn_league_id', 'mfl_league_id', 'mfl_franchise_id', 'wr_bigboard_x']) assert.notEqual(env.ls.getItem(k), null, k + ' kept');
});

test('OD.signOut clears everything and reloads', async () => {
    const env = load({ local: { [FW]: { token: accountToken('u1'), user: { id: 'u1' } } }, session: { ...SECRETS } });
    await env.OD.signOut();
    assert.equal(env.ls.getItem(FW), null);
    assert.equal(env.ss.getItem('espn_s2'), null);
    assert.equal(env.ctx.reloaded, true);
});

test('a guest with an ESPN private league keeps its cookies across page loads', () => {
    const env = load({ local: { wr_guest_v1: '1', espn_league_id: '1' }, session: { ...SECRETS } });
    assert.equal(env.ss.getItem('espn_s2'), 'S2');
    const again = load({ local: { wr_guest_v1: '1' }, session: Object.fromEntries(env.ss.m) });
    assert.equal(again.ss.getItem('espn_s2'), 'S2');
});

test('same account reloading keeps its logins; a different account in the tab does not inherit them', () => {
    const a = { token: accountToken('userA'), user: { id: 'userA' } };
    const first = load({ local: { [FW]: a }, session: { ...SECRETS } });
    assert.equal(first.ss.getItem('espn_s2'), 'S2');
    const same = load({ local: { [FW]: a }, session: Object.fromEntries(first.ss.m) });
    assert.equal(same.ss.getItem('espn_s2'), 'S2', 'same account: kept');
    const other = load({ local: { [FW]: { token: accountToken('userB'), user: { id: 'userB' } } }, session: Object.fromEntries(same.ss.m) });
    assert.equal(other.ss.getItem('espn_s2'), null, 'account B: cleared');
    assert.equal(other.ss.getItem('mfl_api_key'), null);
});

test('an expired token still identifies its owner (no clearing on a lapsed session)', () => {
    const lapsed = { token: jwt({ exp: past(), app_metadata: { user_id: 'userA' } }), user: { id: 'userA' } };
    const first = load({ local: { [FW]: { token: accountToken('userA'), user: { id: 'userA' } } }, session: { ...SECRETS } });
    const later = load({ local: { [FW]: lapsed }, session: Object.fromEntries(first.ss.m) });
    assert.equal(later.ss.getItem('espn_s2'), 'S2');
});

test('a guest who then creates an account keeps the ESPN league they just connected', () => {
    const guest = load({ local: { wr_guest_v1: '1' }, session: { ...SECRETS } });
    const signedUp = load({ local: { [FW]: { token: accountToken('new'), user: { id: 'new' } } }, session: Object.fromEntries(guest.ss.m) });
    assert.equal(signedUp.ss.getItem('espn_s2'), 'S2');
});

test('server-revoked account session clears device logins; a legacy token rejected by fw-refresh-session does not', async () => {
    const stale = { token: jwt({ exp: future(), iat: Math.floor(Date.now() / 1000) - 3 * 86400, app_metadata: { user_id: 'u1', session_version: 1 } }), user: { id: 'u1' } };
    const env = load({ local: { [FW]: stale }, session: { ...SECRETS }, fetchImpl: () => ({ status: 401, body: { error: 'Invalid or expired session.' } }) });
    await env.OD.ensureFreshAppSession();
    assert.equal(env.ls.getItem(FW), null);
    assert.equal(env.ss.getItem('espn_s2'), null);

    const legacy = load({ local: { [FW]: { token: legacyToken('bob'), user: { sleeperUsername: 'bob' } } }, session: { ...SECRETS }, fetchImpl: () => ({ status: 401, body: {} }) });
    await legacy.OD.ensureFreshAppSession();
    assert.equal(legacy.ss.getItem('espn_s2'), 'S2');
});

// ── password change ─────────────────────────────────────────────────────────
test('passwordAccount tells the session kinds apart', () => {
    assert.equal(load().OD.passwordAccount().kind, 'none');
    assert.equal(load({ local: { [FW]: { token: accountToken('u1'), user: { id: 'u1', email: 'u1@x.test' } } } }).OD.passwordAccount().kind, 'account');
    const g = load({ local: { [FW]: { token: accountToken('u1'), user: { id: 'u1', email: 'U1@x.test' } }, [SB]: { user: { email: 'u1@x.test', app_metadata: { provider: 'google' } } } } }).OD.passwordAccount();
    assert.equal(g.kind, 'account');
    assert.equal(g.provider, 'google');
    const leg = load({ local: { [FW]: { token: legacyToken('bob'), user: { sleeperUsername: 'bob' } } } }).OD.passwordAccount();
    assert.deepEqual([leg.kind, leg.username], ['legacy', 'bob']);
    assert.equal(load({ local: { [OD_SESSION]: { token: legacyToken('amy'), expiresAt: new Date(Date.now() + 864e5).toISOString() } } }).OD.passwordAccount().username, 'amy');
    assert.equal(load({ local: { [FW]: { token: jwt({ exp: past(), app_metadata: { user_id: 'u1' } }), user: { id: 'u1' } } } }).OD.passwordAccount().kind, 'expired');
});

function accountEnv(reply) {
    return load({ local: { [FW]: { token: accountToken('u1'), user: { id: 'u1', email: 'u1@x.test' } } }, fetchImpl: () => reply });
}
async function codeOf(p) { try { await p; return 'resolved'; } catch (e) { return e.code + ': ' + e.message; } }

test('email account: success only when fw-change-password confirms', async () => {
    const env = accountEnv({ status: 200, body: { ok: true, signInRequired: true } });
    const r = await env.OD.changePassword('old-password', 'new-password-1');
    assert.deepEqual([r.ok, r.kind], [true, 'account']);
    assert.equal(env.calls.length, 1);
    assert.match(env.calls[0].url, /\/functions\/v1\/fw-change-password$/);
    assert.deepEqual(env.calls[0].body, { currentPassword: 'old-password', password: 'new-password-1' });
    assert.match(env.calls[0].opts.headers.Authorization, /^Bearer ey/);
    assert.ok(env.calls[0].opts.headers.apikey);
    assert.ok(!env.calls.some(c => /set-password/.test(c.url)), 'never the legacy endpoint for an email account');
});

test('email account: every failure is reported, never success', async () => {
    assert.match(await codeOf(accountEnv({ status: 200, body: { ok: true } }).OD.changePassword('a-old-pass', 'b-new-pass')), /^uncertain/);
    assert.match(await codeOf(accountEnv({ status: 200, body: undefined }).OD.changePassword('a-old-pass', 'b-new-pass')), /^uncertain/);
    assert.match(await codeOf(accountEnv({ status: 400, body: { error: 'Current password is incorrect.' } }).OD.changePassword('a-old-pass', 'b-new-pass')), /^current: Current password is incorrect/);
    assert.match(await codeOf(accountEnv({ status: 400, body: { error: 'This account uses provider sign-in. Manage your password with your sign-in provider.' } }).OD.changePassword('a-old-pass', 'b-new-pass')), /^provider: .*Google or Apple/);
    assert.match(await codeOf(accountEnv({ status: 401, body: { error: 'Sign in again before changing your password.' } }).OD.changePassword('a-old-pass', 'b-new-pass')), /^signin/);
    assert.match(await codeOf(accountEnv({ status: 409, body: {} }).OD.changePassword('a-old-pass', 'b-new-pass')), /^signin/);
    assert.match(await codeOf(accountEnv({ status: 429, body: {} }).OD.changePassword('a-old-pass', 'b-new-pass')), /^rate/);
    assert.match(await codeOf(accountEnv({ status: 500, body: {} }).OD.changePassword('a-old-pass', 'b-new-pass')), /^uncertain/);
    const offline = load({ local: { [FW]: { token: accountToken('u1'), user: { id: 'u1' } } }, fetchImpl: () => { throw new TypeError('Failed to fetch'); } });
    assert.match(await codeOf(offline.OD.changePassword('a-old-pass', 'b-new-pass')), /^uncertain/);
});

test('client-side checks: 8+ characters, different from current, signed in', async () => {
    const env = accountEnv({ status: 200, body: { ok: true, signInRequired: true } });
    assert.match(await codeOf(env.OD.changePassword('old-password', 'short')), /^invalid/);
    assert.match(await codeOf(env.OD.changePassword('same-password', 'same-password')), /^invalid/);
    assert.match(await codeOf(env.OD.changePassword('', 'new-password-1')), /^invalid/);
    assert.equal(env.calls.length, 0, 'nothing sent');
    assert.match(await codeOf(load().OD.changePassword('old-password', 'new-password-1')), /^signin/);
});

test('legacy Sleeper login: current password verified on the server before set-password', async () => {
    const seen = [];
    const env = load({
        local: { [FW]: { token: legacyToken('bob'), user: { sleeperUsername: 'bob' } } },
        fetchImpl: (url, opts) => {
            seen.push(url);
            if (/get-session-token/.test(url)) return JSON.parse(opts.body).password === 'right-pass' ? { status: 200, body: { token: 'fresh.jwt.x' } } : { status: 401, body: { error: 'Incorrect password' } };
            if (/set-password/.test(url)) return { status: 200, body: { success: true } };
            return { status: 404, body: {} };
        },
    });
    assert.match(await codeOf(env.OD.changePassword('wrong-pass', 'new-password-1')), /^current/);
    assert.ok(!seen.some(u => /set-password/.test(u)), 'wrong current password never reaches set-password');
    const r = await env.OD.changePassword('right-pass', 'new-password-1');
    assert.deepEqual([r.ok, r.kind, r.username], [true, 'legacy', 'bob']);
    const setCall = env.calls.find(c => /set-password/.test(c.url));
    assert.equal(setCall.opts.headers.Authorization, 'Bearer fresh.jwt.x', 'uses the freshly verified token');
    assert.deepEqual(setCall.body, { username: 'bob', password: 'new-password-1' });
});
