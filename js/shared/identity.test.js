// Run with:  node --test js/shared/identity.test.js
// Shared identity.js (vendored in reconai-shared/ from DHQ-Shared): the
// device's identity cache (Sleeper handle, league pointers, display name) is
// stamped with its owner; every sign-in reconciles it against the server and
// the stamp; sign-out removes credentials only. No network — fetch is stubbed.
/* global Buffer */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SHARED = path.join(__dirname, '..', '..', 'reconai-shared');
const IDENTITY_SRC = fs.readFileSync(path.join(SHARED, 'identity.js'), 'utf8');
const CLIENT_SRC = fs.readFileSync(path.join(SHARED, 'supabase-client.js'), 'utf8');
const FW = 'fw_session_v1';
const STAMP = 'dhq_identity_owner_v1';

function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function jwt(claims) { return b64url({ alg: 'HS256' }) + '.' + b64url(claims) + '.sig'; }
const nowS = () => Math.floor(Date.now() / 1000);
const accountToken = (id, exp) => jwt({ sub: id, iat: nowS(), exp: exp || nowS() + 3600, app_metadata: { user_id: id, email: id + '@x.test', session_version: 1 } });
const legacyToken = (u, exp) => jwt({ sub: u, iat: nowS(), exp: exp || nowS() + 3600, app_metadata: { sleeper_username: u } });
const account = id => ({ token: accountToken(id), user: { id, email: id + '@x.test' } });

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

// server: undefined → GET answers 200 with no handle; a string → that handle;
// 'hang' → never answers; a number → that status.
function load({ local, session, server, withClient, extra } = {}) {
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
        location: { href: 'http://localhost/index.html', pathname: '/index.html', search: '', hash: '', hostname: 'localhost', origin: 'http://localhost', reload() {} },
        addEventListener() {}, dispatchEvent(ev) { events.push(ev); },
        fetch: (url, opts) => {
            const call = { url: String(url), opts: opts || {}, body: opts && opts.body ? JSON.parse(opts.body) : null };
            calls.push(call);
            const method = (opts && opts.method) || 'GET';
            let r = { status: 200, body: {} };
            if (/fw-profile/.test(url) && method === 'GET') {
                if (server === 'hang') return new Promise(() => {});
                if (typeof server === 'number') r = { status: server, body: { error: 'x' } };
                else r = { status: 200, body: { user: { id: 'x' }, platformUsernames: server && typeof server === 'object' ? server : (server ? { sleeper: server } : {}) } };
            } else if (/ai-analyze/.test(url)) {
                r = { status: 401, body: { error: 'Valid session token required.' } };
            }
            return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body });
        },
        ...(extra || {}),
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(IDENTITY_SRC, ctx);
    if (withClient) vm.runInContext(CLIENT_SRC, ctx);
    return { ctx, OD: ctx.OD, id: ctx.OD.identity, ls, ss, calls, events };
}
const posts = env => env.calls.filter(c => c.opts.method === 'POST' && /fw-profile/.test(c.url));
const authOf = env => JSON.parse(env.ls.getItem('od_auth_v1') || 'null');

// ── both od_auth_v1 shapes ──────────────────────────────────────────────────
test('both od_auth_v1 shapes are read, by identity.js and by OD.getCurrentUsername', () => {
    for (const auth of [{ username: 'alice' }, { sleeperUsername: 'alice' }, { username: '', sleeperUsername: 'alice' }]) {
        const env = load({ local: { od_auth_v1: auth }, withClient: true });
        assert.equal(env.id.localHandle(), 'alice', JSON.stringify(auth));
        assert.equal(env.id.localOnboarded(), true);
        assert.equal(env.OD.getCurrentUsername(), 'alice', JSON.stringify(auth));
    }
    const prof = load({ local: { od_profile_v1: { sleeperUsername: 'carol' } } });
    assert.equal(prof.id.localHandle(), 'carol', 'profile copy is the fallback');
});

test('writeHandle writes both shapes, the profile and the Team Comps key — and drops a different handle\'s extras', () => {
    const env = load({ local: { od_auth_v1: { username: 'old', passwordHash: 'h', sleeperUserId: '9' }, od_profile_v1: { sleeperUsername: 'old', sleeperUserId: '9', platforms: ['sleeper'] } } });
    env.id.writeHandle('new', { sleeperUserId: '42' });
    assert.deepEqual(authOf(env), { sleeperUserId: '42', username: 'new', sleeperUsername: 'new' });
    const prof = JSON.parse(env.ls.getItem('od_profile_v1'));
    assert.equal(prof.sleeperUsername, 'new');
    assert.equal(prof.sleeperUserId, '42');
    assert.equal(prof.onboardingComplete, true);
    assert.deepEqual(prof.platforms, ['sleeper']);
    assert.equal(env.ls.getItem('od_locked_username_v2'), 'new');
    // Same handle: extras (a legacy local hash) are kept.
    const same = load({ local: { od_auth_v1: { username: 'bob', passwordHash: 'h' } } });
    same.id.writeHandle('bob');
    assert.equal(authOf(same).passwordHash, 'h');
});

// ── reconcile ───────────────────────────────────────────────────────────────
test('reconcile, same owner: server agrees → nothing cleared, nothing uploaded', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'alice' }, mfl_league_id: '10005', mfl_year: '2026', mfl_franchise_id: '0001' },
        server: { sleeper: 'alice', mfl: [{ leagueId: '10005', year: 2026, franchiseId: '0001' }] } });
    const r = await env.id.reconcileAfterSignIn();
    assert.deepEqual([r.owner, r.handle, r.source, r.onboarded, r.cleared], ['account:u1', 'alice', 'server', true, false]);
    assert.equal(posts(env).length, 0);
    assert.equal(env.ls.getItem('mfl_league_id'), '10005', 'league pointers kept');
});

test('reconcile uploads a league only this device knows — merged into the server list, pointers only', async () => {
    const env = load({
        local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'alice' }, mfl_league_id: '10005', mfl_year: '2026', mfl_franchise_id: '1', mfl_api_key: 'SECRET' },
        session: { espn_s2: 'SECRET', espn_swid: '{SECRET}' },
        server: { sleeper: 'alice', mfl: [{ leagueId: '777', year: 2025, franchiseId: '0003' }] },
    });
    const r = await env.id.reconcileAfterSignIn();
    assert.equal(r.uploaded, true);
    const body = posts(env)[0].body;
    assert.deepEqual(body, { platformUsernames: { mfl: [{ leagueId: '10005', year: 2026, franchiseId: '0001' }, { leagueId: '777', year: 2025, franchiseId: '0003' }] } },
        'the other device\'s league is kept; the handle the server already has is not resent');
    assert.doesNotMatch(JSON.stringify(body), /SECRET/, 'no credentials, ever');
    assert.equal(posts(env)[0].opts.keepalive, true);
});

test('reconcile restores ESPN / MFL pointers from the server on a fresh device, and never sends an empty list', async () => {
    const env = load({ local: { [FW]: account('u1') },
        server: { sleeper: 'alice', sleeperUserId: '123456789012345678', espn: [{ leagueId: '555', year: 2025, teamId: '2' }, { leagueId: '687493', year: 2026, teamId: '4' }], mfl: [{ leagueId: '10005', year: 2026, franchiseId: null }] } });
    const r = await env.id.reconcileAfterSignIn();
    assert.deepEqual([r.handle, r.source, r.onboarded], ['alice', 'server', true]);
    assert.equal(JSON.stringify(r.restored), '["espn","mfl"]');
    assert.equal(env.ls.getItem('espn_league_id'), '687493', 'the latest season wins');
    assert.equal(env.ls.getItem('espn_year'), '2026');
    assert.equal(env.ls.getItem('espn_team_id'), '4');
    assert.equal(env.ls.getItem('mfl_league_id'), '10005');
    assert.equal(env.ls.getItem('mfl_franchise_id'), null);
    assert.equal(authOf(env).sleeperUserId, '123456789012345678');
    assert.equal(posts(env).length, 0, 'nothing new to upload');
    // A device with its own pointer keeps it (restore only fills empty keys).
    const own = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), espn_league_id: '42', espn_year: '2026' }, server: { espn: [{ leagueId: '687493', year: 2026, teamId: null }] } });
    await own.id.reconcileAfterSignIn();
    assert.equal(own.ls.getItem('espn_league_id'), '42');
    const sent = posts(own)[0].body.platformUsernames;
    assert.equal(JSON.stringify(sent.espn.map(e => e.leagueId)), '["42","687493"]');
    // No local league and none on the server: espn/mfl are never sent ([] would clear).
    const none = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'alice' } } });
    await none.id.reconcileAfterSignIn();
    assert.deepEqual(posts(none)[0].body, { platformUsernames: { sleeper: 'alice' } });
});

test('reconcile uses platformUsernames from the sign-in response and skips the fw-profile GET; null or absent → GET', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', od_auth_v1: { username: 'alice' } } });
    const r = await env.id.reconcileAfterSignIn({ ...account('u1'), platformUsernames: { sleeper: 'alice' } });
    assert.deepEqual([r.handle, r.source], ['alice', 'server']);
    assert.equal(env.calls.length, 0, 'no extra round trip');
    const empty = load({ local: { [STAMP]: 'account:u1', od_auth_v1: { username: 'alice' } } });
    await empty.id.reconcileAfterSignIn({ ...account('u1'), platformUsernames: {} });
    assert.equal(empty.calls.filter(c => c.opts.method === 'GET').length, 0, '{} = none on file: no GET');
    assert.deepEqual(posts(empty)[0].body, { platformUsernames: { sleeper: 'alice' } }, '… and the device handle is uploaded');
    for (const pu of [null, undefined]) {
        const s = account('u1'); if (pu === null) s.platformUsernames = null;
        const e = load({ local: { [STAMP]: 'account:u1' }, server: 'alice' });
        const r2 = await e.id.reconcileAfterSignIn(s);
        assert.equal(r2.handle, 'alice');
        assert.equal(e.calls.filter(c => (c.opts.method || 'GET') === 'GET').length, 1, 'fell back to the GET (' + pu + ')');
    }
});

test('pushIdentity (connect page / hub): reads the server list, posts the union; a failed read sends only the handle', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'alice', sleeperUserId: '99' }, espn_league_id: '1', espn_year: '2026' },
        server: { espn: [{ leagueId: '2', year: 2026, teamId: null }] } });
    assert.equal(await env.id.pushIdentity(), true);
    assert.deepEqual(posts(env)[0].body.platformUsernames, { sleeper: 'alice', sleeperUserId: '99', espn: [{ leagueId: '1', year: 2026, teamId: null }, { leagueId: '2', year: 2026, teamId: null }] });
    const down = load({ local: { [FW]: account('u1'), od_auth_v1: { username: 'alice' }, espn_league_id: '1' }, server: 503 });
    await down.id.pushIdentity();
    assert.deepEqual(posts(down)[0].body.platformUsernames, { sleeper: 'alice' });
    const guest = load({ local: { wr_guest_v1: '1', od_auth_v1: { username: 'g' } } });
    assert.equal(await guest.id.pushIdentity(), false, 'no account, nothing sent');
    assert.equal(guest.calls.length, 0);
});

test('reconcile, same owner, server empty → the local handle is uploaded with keepalive', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { sleeperUsername: 'alice' } } });
    const r = await env.id.reconcileAfterSignIn();
    assert.deepEqual([r.handle, r.source, r.uploaded, r.onboarded], ['alice', 'local', true, true]);
    const p = posts(env);
    assert.equal(p.length, 1);
    assert.equal(p[0].opts.keepalive, true, 'keepalive: survives the navigation that follows');
    assert.deepEqual(p[0].body, { platformUsernames: { sleeper: 'alice' } });
    assert.equal(authOf(env).username, 'alice', 'normalised to both shapes');
});

test('reconcile, server wins over a stale local handle (same owner)', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'oldname', sleeperUserId: '9' }, od_profile_v1: { sleeperUsername: 'oldname', sleeperUserId: '9' } }, server: 'newname' });
    const r = await env.id.reconcileAfterSignIn();
    assert.deepEqual([r.handle, r.source], ['newname', 'server']);
    assert.deepEqual(authOf(env), { username: 'newname', sleeperUsername: 'newname' }, 'stale sleeperUserId dropped');
    assert.equal(JSON.parse(env.ls.getItem('od_profile_v1')).sleeperUserId, undefined);
    assert.equal(posts(env).length, 0);
});

test('reconcile, different owner: A\'s cache is cleared before B\'s server handle is written', async () => {
    const env = load({
        local: {
            [STAMP]: 'account:uA', [FW]: account('uB'),
            od_auth_v1: { username: 'alice' }, od_profile_v1: { sleeperUsername: 'alice', onboardingComplete: true },
            od_locked_username_v2: 'alice', dynastyhq_username: 'alice', od_display_name: 'Alice', dhq_owner_club_v1: '{"name":"A"}',
            mfl_league_id: '1', mfl_year: '2026', mfl_franchise_id: '0001', espn_league_id: '2', espn_year: '2026', espn_team_id: '3',
            espn_creds_espn_2: { leagueId: '2' }, wr_guest_v1: '1', fw_preferred_view: 'warroom',
        },
        server: 'bob',
    });
    const r = await env.id.reconcileAfterSignIn();
    assert.deepEqual([r.owner, r.handle, r.source, r.cleared], ['account:uB', 'bob', 'server', true]);
    for (const k of ['mfl_league_id', 'mfl_year', 'mfl_franchise_id', 'espn_league_id', 'espn_year', 'espn_team_id', 'espn_creds_espn_2', 'dynastyhq_username', 'od_display_name', 'dhq_owner_club_v1', 'wr_guest_v1']) {
        assert.equal(env.ls.getItem(k), null, k + ' of the previous owner');
    }
    assert.deepEqual(authOf(env), { username: 'bob', sleeperUsername: 'bob' });
    assert.equal(env.ls.getItem(STAMP), 'account:uB');
    assert.equal(env.ls.getItem('fw_preferred_view'), 'warroom', 'device preferences are not identity');
    assert.equal(posts(env).length, 0, 'A\'s handle is never uploaded to B');
});

test('reconcile, different owner and an empty server → connect page (no inherited onboardingComplete)', async () => {
    const env = load({ local: { [STAMP]: 'account:uA', [FW]: account('uB'), od_auth_v1: { username: 'alice' }, od_profile_v1: { onboardingComplete: true } } });
    const r = await env.id.reconcileAfterSignIn();
    assert.deepEqual([r.handle, r.onboarded, r.cleared], [null, false, true]);
    assert.equal(posts(env).length, 0);
    assert.equal(env.ls.getItem('od_profile_v1'), null);
});

test('unstamped cache + a live session already on the device at BOOT → trusted: stamped and uploaded', async () => {
    const env = load({ local: { [FW]: account('u1'), od_profile_v1: { sleeperUsername: 'alice', onboardingComplete: true }, espn_league_id: '7' } });
    const r = await env.id.reconcileAfterSignIn(null, { boot: true });
    assert.deepEqual([r.handle, r.source, r.uploaded, r.cleared], ['alice', 'local', true, false]);
    assert.equal(env.ls.getItem(STAMP), 'account:u1');
    assert.equal(env.ls.getItem('espn_league_id'), '7');
    assert.equal(posts(env)[0].body.platformUsernames.sleeper, 'alice');
    assert.deepEqual(posts(env)[0].body.platformUsernames.espn.map(e => e.leagueId), ['7']);
});

test('unstamped cache + a FRESH sign-in → someone else\'s: cleared, never uploaded; server handle wins, else connect', async () => {
    const seed = { od_auth_v1: { username: 'prev' }, od_profile_v1: { sleeperUsername: 'prev', onboardingComplete: true }, mfl_league_id: '5', player_tags_123: '{}', draft_board_123: '[]', od_calendar_events: '[]' };
    const empty = load({ local: { ...seed } });
    const r = await empty.id.reconcileAfterSignIn(account('u1'));
    assert.deepEqual([r.handle, r.onboarded, r.cleared, r.uploaded], [null, false, true, false], 'server empty → connect page');
    assert.equal(posts(empty).length, 0, 'the unstamped handle is never uploaded');
    for (const k of Object.keys(seed)) assert.equal(empty.ls.getItem(k), null, k + ' cleared');
    assert.equal(empty.ls.getItem(STAMP), 'account:u1');
    const withServer = load({ local: { ...seed } });
    const r2 = await withServer.id.reconcileAfterSignIn({ ...account('u1'), platformUsernames: { sleeper: 'mine' } });
    assert.deepEqual([r2.handle, r2.source, r2.cleared], ['mine', 'server', true]);
    assert.equal(withServer.ls.getItem('mfl_league_id'), null);
    assert.equal(posts(withServer).length, 0);
    // Legacy: the handle is the credential — stamped, written.
    const legacy = load({ local: { ...seed, [FW]: { token: legacyToken('bob'), user: { sleeperUsername: 'bob' } } } });
    const r3 = await legacy.id.reconcileAfterSignIn();
    assert.deepEqual([r3.owner, r3.handle, r3.cleared], ['legacy:bob', 'bob', true]);
});

test('owner change clears per-league boards, tags, notes and targets (clean prefixes only)', async () => {
    const env = load({ local: { [STAMP]: 'account:uA', [FW]: account('uB'),
        player_tags_1: '{}', dhq_league_doc_notes_1: '{}', draft_board_1: '[]', od_fa_targets_v1_1: '[]', od_grudges_v1_1: '[]',
        wr_bigboard_1: '[]', wr_gm_strategy_1: '{}', wr_chat_1: '[]', wr_saved_trades_1: '[]', od_earnings_entries: '[]', scout_field_log_v1: '[]',
        wr_theme: 'dark', fw_preferred_view: 'warroom' } });
    await env.id.reconcileAfterSignIn();
    for (const k of ['player_tags_1', 'dhq_league_doc_notes_1', 'draft_board_1', 'od_fa_targets_v1_1', 'od_grudges_v1_1', 'wr_bigboard_1', 'wr_gm_strategy_1', 'wr_chat_1', 'wr_saved_trades_1', 'od_earnings_entries', 'scout_field_log_v1']) {
        assert.equal(env.ls.getItem(k), null, k);
    }
    assert.equal(env.ls.getItem('wr_theme'), 'dark', 'device preferences stay');
    assert.equal(env.ls.getItem('fw_preferred_view'), 'warroom');
});

test('reconcile, first run but this tab was another account\'s → treated as a different owner', async () => {
    const env = load({ local: { [FW]: account('uB'), od_auth_v1: { username: 'alice' } }, session: { dhq_credentials_owner_v1: 'account:uA' } });
    const r = await env.id.reconcileAfterSignIn();
    assert.equal(r.cleared, true);
    assert.equal(r.handle, null);
    assert.equal(posts(env).length, 0);
});

test('reconcile, guest signs up: leagues adopted, handle uploaded, guest flag gone', async () => {
    const env = load({ local: { [STAMP]: 'guest', wr_guest_v1: '1', [FW]: account('uNew'), od_auth_v1: { username: 'gina' }, mfl_league_id: '5', mfl_franchise_id: '0002' } });
    const r = await env.id.reconcileAfterSignIn(null, { isNew: true });
    assert.deepEqual([r.handle, r.uploaded, r.cleared, r.onboarded], ['gina', true, false, true]);
    assert.equal(env.ls.getItem('wr_guest_v1'), null);
    assert.equal(env.ls.getItem('mfl_league_id'), '5');
    assert.equal(env.ls.getItem(STAMP), 'account:uNew');
    assert.equal(posts(env)[0].body.platformUsernames.sleeper, 'gina');
    assert.deepEqual(posts(env)[0].body.platformUsernames.mfl, [{ leagueId: '5', year: new Date().getUTCFullYear(), franchiseId: '0002' }]);
    // An MFL-only guest (no handle) still enters the app, uploads nothing.
    const mflOnly = load({ local: { wr_guest_v1: '1', [FW]: account('uNew'), mfl_league_id: '5' } });
    const r2 = await mflOnly.id.reconcileAfterSignIn(null, { isNew: true });
    assert.deepEqual([r2.handle, r2.onboarded, r2.cleared], [null, true, false]);
});

test('reconcile, guest signs in to an EXISTING account with a different handle → server wins, guest keys cleared', async () => {
    const env = load({ local: { [STAMP]: 'guest', wr_guest_v1: '1', [FW]: account('u1'), od_auth_v1: { username: 'gina' }, espn_league_id: '9' }, server: 'yves' });
    const r = await env.id.reconcileAfterSignIn();
    assert.deepEqual([r.handle, r.source, r.cleared], ['yves', 'server', true]);
    assert.equal(env.ls.getItem('espn_league_id'), null);
    assert.equal(env.ls.getItem('wr_guest_v1'), null);
    assert.equal(env.ls.getItem(STAMP), 'account:u1');
});

test('reconcile, a new account on a used (non-guest) device starts clean', async () => {
    const env = load({ local: { [STAMP]: 'account:uA', [FW]: account('uNew'), od_auth_v1: { username: 'alice' }, mfl_league_id: '1' } });
    const r = await env.id.reconcileAfterSignIn(null, { isNew: true });
    assert.deepEqual([r.cleared, r.handle, r.onboarded], [true, null, false]);
    assert.equal(env.ls.getItem('mfl_league_id'), null);
});

test('reconcile, server unreachable: never hangs, never clears the same owner\'s cache', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'alice' } }, server: 'hang' });
    const t0 = Date.now();
    const r = await env.id.reconcileAfterSignIn(null, { timeoutMs: 60 });
    assert.ok(Date.now() - t0 < 2000);
    assert.deepEqual([r.handle, r.source, r.cleared, r.uploaded], ['alice', 'offline', false, false]);
    const five = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'alice' } }, server: 500 });
    const r5 = await five.id.reconcileAfterSignIn();
    assert.deepEqual([r5.handle, r5.source, r5.uploaded], ['alice', 'offline', false], 'a failed read is not "server empty"');
});

test('reconcile, legacy login: stamped legacy:<handle>, the handle written, another owner cleared', async () => {
    const env = load({ local: { [STAMP]: 'account:uA', [FW]: { token: legacyToken('Bob'), user: { sleeperUsername: 'Bob' } }, od_auth_v1: { username: 'alice' }, mfl_league_id: '1' } });
    const r = await env.id.reconcileAfterSignIn();
    assert.deepEqual([r.owner, r.handle, r.source, r.cleared], ['legacy:bob', 'Bob', 'legacy', true]);
    assert.equal(authOf(env).username, 'Bob');
    assert.equal(env.ls.getItem('mfl_league_id'), null);
    assert.equal(env.calls.length, 0, 'fw-profile is never called for a legacy token');
});

// ── getCurrentUsername under the stamp ─────────────────────────────────────
test('getCurrentUsername: another owner\'s cache is never returned; Scout\'s handle only without an account', () => {
    const other = load({ local: { [STAMP]: 'account:uA', [FW]: account('uB'), od_auth_v1: { username: 'alice' } }, withClient: true });
    assert.equal(other.OD.getCurrentUsername(), null);
    const scout = load({ local: { [FW]: account('u1'), dynastyhq_username: 'zed' }, withClient: true });
    assert.equal(scout.OD.getCurrentUsername(), null, 'Scout\'s dynastyhq_username ignored under an account session');
    const noSession = load({ local: { dynastyhq_username: 'zed' }, withClient: true });
    assert.equal(noSession.OD.getCurrentUsername(), 'zed', 'Scout itself (no account) still works');
});

// ── the guest lane ──────────────────────────────────────────────────────────
test('beginGuest clears an account-stamped cache; a guest\'s own cache survives', () => {
    const env = load({ local: { [STAMP]: 'account:uA', od_auth_v1: { username: 'alice' }, mfl_league_id: '1' } });
    env.id.beginGuest();
    assert.equal(env.ls.getItem('od_auth_v1'), null);
    assert.equal(env.ls.getItem('mfl_league_id'), null);
    assert.equal(env.ls.getItem(STAMP), 'guest');
    assert.equal(env.ls.getItem('wr_guest_v1'), '1');
    const guest = load({ local: { [STAMP]: 'guest', od_auth_v1: { username: 'gina' } } });
    guest.id.beginGuest();
    assert.equal(guest.id.localHandle(), 'gina');
});

// ── sign-out keep-list ──────────────────────────────────────────────────────
const SB = 'sb-sxshiqyxhhifvtfqawbq-auth-token';
test('signOutClear removes exactly the credentials and keeps the owner-stamped identity cache', async () => {
    let rcLoggedOut = 0;
    const sbCalls = [];
    const identityKeys = { [STAMP]: 'account:u1', od_auth_v1: { username: 'alice' }, od_profile_v1: { sleeperUsername: 'alice' }, od_locked_username_v2: 'alice',
        od_display_name: 'Alice', dhq_owner_club_v1: '{}', mfl_league_id: '1', mfl_year: '2026', mfl_franchise_id: '1', espn_league_id: '2', espn_year: '2026', espn_team_id: '3',
        draft_board_x: '[]', fw_preferred_view: 'warroom' };
    const env = load({
        local: { ...identityKeys, [FW]: account('u1'), od_session_v1: { token: legacyToken('bob') }, wr_guest_v1: '1', [SB]: '{}', [SB + '-code-verifier']: 'v', 'sb-other-auth-token': '{}',
            espn_creds_espn_2: { leagueId: '2', espnS2: 'LEAK' } },
        session: { espn_s2: 'S2', espn_swid: 'W', mfl_api_key: 'K', dynastyhq_ai_key: 'AI', dhq_credentials_owner_v1: 'account:u1' },
        extra: { Capacitor: { Plugins: { Purchases: { logOut: async () => { rcLoggedOut++; } } } } },
    });
    const client = { auth: { signOut: async (o) => { sbCalls.push(o); } } };
    await env.id.signOutClear({ supabase: client });
    for (const k of [FW, 'od_session_v1', 'wr_guest_v1', SB, SB + '-code-verifier', 'sb-other-auth-token']) assert.equal(env.ls.getItem(k), null, k);
    for (const k of ['espn_s2', 'espn_swid', 'mfl_api_key', 'dynastyhq_ai_key', 'dhq_credentials_owner_v1']) assert.equal(env.ss.getItem(k), null, k);
    for (const [k, v] of Object.entries(identityKeys)) assert.equal(env.ls.getItem(k), typeof v === 'string' ? v : JSON.stringify(v), k + ' kept');
    assert.deepEqual(JSON.parse(env.ls.getItem('espn_creds_espn_2')), { leagueId: '2' }, 'embedded secret stripped, pointer kept');
    assert.equal(JSON.stringify(sbCalls), '[{"scope":"local"}]', 'Supabase sign-out is local-scope only');
    assert.equal(rcLoggedOut, 1, 'RevenueCat logOut called');
});

test('OD.signOutClear (shared client) goes through the same clear', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'alice' }, wr_guest_v1: '1' }, session: { espn_s2: 'S2' }, withClient: true });
    await env.OD.signOutClear();
    assert.equal(env.ls.getItem(FW), null);
    assert.equal(env.ls.getItem('wr_guest_v1'), null);
    assert.equal(env.ss.getItem('espn_s2'), null);
    assert.equal(authOf(env).username, 'alice');
    assert.equal(env.OD.getSessionToken(), null);
});

test('identity.js and supabase-client.js carry the same DEVICE_SECRET_KEYS', () => {
    const m = CLIENT_SRC.match(/const DEVICE_SECRET_KEYS = \[([\s\S]*?)\];/);
    const canonical = Array.from(m[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g), x => x[1]).sort();
    const env = load();
    assert.deepEqual(Array.from(env.id.DEVICE_SECRET_KEYS).sort(), canonical);
});

// ── gates and dead sessions never destroy identity ─────────────────────────
test('an expired / revoked app session is cleared without touching the identity cache', async () => {
    const expired = load({ local: { [STAMP]: 'account:u1', [FW]: { token: accountToken('u1', nowS() - 60), user: { id: 'u1' } }, od_auth_v1: { username: 'alice' }, mfl_league_id: '1' }, withClient: true });
    await expired.OD.ensureFreshAppSession();
    assert.equal(expired.ls.getItem(FW), null, 'dead credential gone');
    assert.equal(authOf(expired).username, 'alice');
    assert.equal(expired.ls.getItem('mfl_league_id'), '1');
    assert.equal(expired.events.filter(e => e.type === 'dhq:session-expired').length, 1);
});

test('legacy re-hydration only for the stamped owner', async () => {
    const copy = { token: legacyToken('bob'), expiresAt: new Date((nowS() + 3600) * 1000).toISOString() };
    const other = load({ local: { [STAMP]: 'account:uA', od_session_v1: copy }, withClient: true });
    await other.OD.ensureFreshAppSession();
    assert.equal(other.ls.getItem(FW), null, 'another person\'s leftover legacy copy is not signed in');
    const mine = load({ local: { [STAMP]: 'legacy:bob', od_session_v1: copy }, withClient: true });
    await mine.OD.ensureFreshAppSession();
    assert.ok(mine.ls.getItem(FW), 'own legacy copy re-hydrated');
});

// ── durable writes / AI 401 ────────────────────────────────────────────────
test('OD.savePlatformUsernames uses keepalive and resolves once the server answered', async () => {
    const env = load({ local: { [FW]: account('u1') }, withClient: true });
    const ok = await env.OD.savePlatformUsernames({ sleeper: 'alice' });
    assert.equal(ok, true);
    assert.equal(posts(env)[0].opts.keepalive, true);
});

test('OD.callAI: a 401 reads as "session ended" and raises dhq:session-expired (nothing cleared)', async () => {
    const env = load({ local: { [FW]: account('u1'), od_auth_v1: { username: 'alice' } }, withClient: true });
    await assert.rejects(env.OD.callAI({ type: 'recon-chat', context: 'hi' }), (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.sessionExpired, true);
        assert.match(err.message, /session ended/i);
        assert.doesNotMatch(err.message, /Valid session token/);
        return true;
    });
    assert.equal(env.events.filter(e => e.type === 'dhq:session-expired').length, 1);
    assert.ok(env.ls.getItem(FW), 'a 401 can be transient: the session is not cleared here');
    const guest = load({ local: { wr_guest_v1: '1' }, withClient: true });
    await assert.rejects(guest.OD.callAI({ type: 'recon-chat', context: 'hi' }), (err) => /Sign in/.test(err.message) && err.sessionExpired === false);
    assert.equal(guest.events.filter(e => e.type === 'dhq:session-expired').length, 0, 'a guest is not told their session ended');
});

test('analytics events carry metadata.build only when the page knows its build', () => {
    const src = CLIENT_SRC;
    assert.match(src, /meta\.build = build/);
    assert.match(src, /window\.DHQ_BUILD/);
    assert.match(src, /meta\[name="dhq-build"\]/);
});

test('a failed account write is remembered and retried by the next reconcile', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'alice' } }, server: {} });
    // POST fails: override fetch for POSTs only.
    const realFetch = env.ctx.fetch;
    env.ctx.fetch = (url, opts) => (opts && opts.method === 'POST')
        ? Promise.resolve({ status: 500, ok: false, json: async () => ({}) })
        : realFetch(url, opts);
    assert.equal(await env.id.pushIdentity(), false);
    assert.equal(env.id.needsSync(), true, 'marked unsynced');
    env.ctx.fetch = realFetch;
    const r = await env.id.reconcileAfterSignIn();
    assert.equal(r.uploaded, true);
    assert.equal(env.id.needsSync(), false, 'cleared once the server confirmed');
});

test('window.__dhqBusy is held while a reconcile / account write is in flight', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'alice' } }, server: 'hang' });
    const p = env.id.reconcileAfterSignIn(null, { timeoutMs: 80 });
    assert.equal(env.ctx.__dhqBusy, 1, 'held during the reconcile');
    await p;
    assert.equal(env.ctx.__dhqBusy, 0, 'released after');
});

// ── review fixes (2026-09-28) ───────────────────────────────────────────────
test('B1: a token discarded on an unstamped device stamps its owner first — the same owner signing back in keeps the cache', async () => {
    const lapsed = { token: accountToken('u1', nowS() - 60), user: { id: 'u1' } };
    const cache = { od_auth_v1: { username: 'alice' }, od_profile_v1: { sleeperUsername: 'alice', onboardingComplete: true }, mfl_league_id: '5', mfl_year: '2026', player_tags_5: '{}' };
    // (a) the shared client clearing an expired session
    const env = load({ local: { [FW]: lapsed, ...cache }, withClient: true });
    await env.OD.ensureFreshAppSession();
    assert.equal(env.ls.getItem(FW), null);
    assert.equal(env.ls.getItem(STAMP), 'account:u1', 'stamped from the dead token');
    const r = await env.id.reconcileAfterSignIn(account('u1'));
    assert.deepEqual([r.cleared, r.handle, r.source, !!r.needsConfirm], [false, 'alice', 'local', false]);
    assert.equal(env.ls.getItem('player_tags_5'), '{}', 'per-league work kept');
    // (b) a sign-out on an unstamped device
    const so = load({ local: { [FW]: account('u1'), ...cache } });
    await so.id.signOutClear();
    assert.equal(so.ls.getItem(STAMP), 'account:u1');
    // (c) legacy
    const lg = load({ local: { [FW]: { token: legacyToken('Bob'), user: { sleeperUsername: 'Bob' } } } });
    lg.id.clearCredentials();
    assert.equal(lg.ls.getItem(STAMP), 'legacy:bob');
    // (d) the notice's discardSession
    const dn = load({ local: { [FW]: account('u9') } });
    dn.id.discardSession();
    assert.deepEqual([dn.ls.getItem(STAMP), dn.ls.getItem(FW)], ['account:u9', null]);
    // An existing stamp is never overwritten.
    const keep = load({ local: { [STAMP]: 'account:uA', [FW]: account('uB') } });
    keep.id.clearCredentials();
    assert.equal(keep.ls.getItem(STAMP), 'account:uA');
});

test('B1: unstamped device, no token, fresh sign-in, server has nothing → offered on the connect page, never auto-uploaded; confirm uploads', async () => {
    // landing stores the new session, then reconciles.
    const env = load({ local: { [FW]: account('u1'), od_auth_v1: { username: 'alice', sleeperUserId: '42' }, mfl_league_id: '5', mfl_year: '2026', mfl_franchise_id: '0002' } });
    const r = await env.id.reconcileAfterSignIn(account('u1'));
    assert.deepEqual([r.cleared, r.handle, r.needsConfirm, r.uploaded], [true, null, true, false]);
    assert.equal(posts(env).length, 0, 'nothing uploaded unconfirmed');
    assert.equal(env.ls.getItem('od_auth_v1'), null, 'not used unconfirmed');
    const p = env.id.pendingConfirm();
    assert.equal(p.handle, 'alice');
    assert.deepEqual(JSON.parse(JSON.stringify(p.mfl)), { leagueId: '5', year: 2026, franchiseId: '0002' });
    // Someone else signed in on this tab never sees it.
    const other = load({ local: { [FW]: account('u2'), dhq_identity_unconfirmed_v1: env.ls.getItem('dhq_identity_unconfirmed_v1') } });
    assert.equal(other.id.pendingConfirm(), null);
    await env.id.confirmPending();
    assert.equal(authOf(env).username, 'alice');
    assert.equal(env.ls.getItem('mfl_league_id'), '5');
    const body = posts(env).at(-1).body.platformUsernames;
    assert.equal(body.sleeper, 'alice');
    assert.equal(body.sleeperUserId, '42');
    assert.equal(body.mfl[0].leagueId, '5');
    assert.equal(env.id.pendingConfirm(), null);
});

test('B1: server has a handle but no ESPN/MFL → the handle is the server\'s, the remembered leagues are offered', async () => {
    const env = load({ local: { [FW]: account('u1'), od_auth_v1: { username: 'old' }, espn_league_id: '687493', espn_year: '2026' } });
    const r = await env.id.reconcileAfterSignIn({ ...account('u1'), platformUsernames: { sleeper: 'alice' } });
    assert.deepEqual([r.handle, r.source, r.needsConfirm], ['alice', 'server', true]);
    const p = env.id.pendingConfirm();
    assert.equal(p.handle, undefined, 'the server has a handle: the cached one is not offered');
    assert.equal(p.espn.leagueId, '687493');
    assert.equal(posts(env).length, 0);
    // Server already has leagues → nothing to offer.
    const full = load({ local: { od_auth_v1: { username: 'old' }, espn_league_id: '1' } });
    const r2 = await full.id.reconcileAfterSignIn({ ...account('u1'), platformUsernames: { sleeper: 'alice', espn: [{ leagueId: '9', year: 2026, teamId: null }] } });
    assert.equal(!!r2.needsConfirm, false);
});

test('S1: an unsynced local handle beats the server\'s older one and is uploaded; without the marker the server wins', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'newh' }, dhq_identity_unsynced_v1: 'account:u1' }, server: 'oldh' });
    const r = await env.id.reconcileAfterSignIn(null, { boot: true });
    assert.deepEqual([r.handle, r.source, r.uploaded], ['newh', 'local', true]);
    assert.equal(posts(env)[0].body.platformUsernames.sleeper, 'newh');
    assert.equal(env.id.needsSync(), false);
    const synced = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { username: 'newh' } }, server: 'backfilled' });
    const r2 = await synced.id.reconcileAfterSignIn(null, { boot: true });
    assert.deepEqual([r2.handle, r2.source, posts(synced).length], ['backfilled', 'server', 0], 'the backfill is never fought');
    // First boot of an unstamped cache with a live token: local wins.
    const first = load({ local: { [FW]: account('u1'), od_auth_v1: { username: 'newh' } }, server: 'oldh' });
    const r3 = await first.id.reconcileAfterSignIn(null, { boot: true });
    assert.deepEqual([r3.handle, posts(first)[0].body.platformUsernames.sleeper], ['newh', 'newh']);
});

test('S2: Demo residue (bigloco) is never adopted or uploaded unless the account\'s server handle is bigloco', async () => {
    const env = load({ local: { [STAMP]: 'account:u1', [FW]: account('u1'), od_auth_v1: { sleeperUsername: 'bigloco' }, od_locked_username_v2: 'bigloco' } });
    const r = await env.id.reconcileAfterSignIn(null, { boot: true });
    assert.equal(r.handle, null);
    assert.equal(posts(env).length, 0, 'never posted');
    assert.equal(env.ls.getItem('od_auth_v1'), null, 'residue dropped');
    assert.equal(env.ls.getItem('od_locked_username_v2'), null);
    const unstamped = load({ local: { [FW]: account('u1'), od_auth_v1: { sleeperUsername: 'bigloco' } } });
    await unstamped.id.reconcileAfterSignIn(null, { boot: true });
    assert.equal(posts(unstamped).length, 0);
    const owner = load({ local: { [STAMP]: 'account:u0', [FW]: account('u0'), od_auth_v1: { sleeperUsername: 'bigloco' } }, server: 'bigloco' });
    const ro = await owner.id.reconcileAfterSignIn(null, { boot: true });
    assert.deepEqual([ro.handle, ro.source], ['bigloco', 'server']);
    const push = load({ local: { [FW]: account('u1'), od_auth_v1: { sleeperUsername: 'bigloco' } } });
    await push.id.pushIdentity();
    assert.equal(posts(push).length, 0, 'pushIdentity refuses it too');
    const pend = load({ local: { od_auth_v1: { sleeperUsername: 'bigloco' } } });
    const rp = await pend.id.reconcileAfterSignIn(account('u1'));
    assert.equal(!!rp.needsConfirm, false, 'not even offered');
});

test('S4: beginGuest clears an unstamped cache when there is no guest flag (and keeps a flagged guest\'s own)', () => {
    const env = load({ local: { od_profile_v1: { sleeperUsername: 'alice', onboardingComplete: true }, mfl_league_id: '5' } });
    env.id.beginGuest();
    assert.equal(env.ls.getItem('od_profile_v1'), null);
    assert.equal(env.ls.getItem('mfl_league_id'), null);
    const guest = load({ local: { wr_guest_v1: '1', od_auth_v1: { username: 'gina' } } });
    guest.id.beginGuest();
    assert.equal(guest.id.localHandle(), 'gina');
});

test('nit: Scout\'s handle is adopted once at the boot migration only (live token, no other handle anywhere)', async () => {
    const boot = load({ local: { [FW]: account('u1'), dynastyhq_username: 'scouty' } });
    const r = await boot.id.reconcileAfterSignIn(null, { boot: true });
    assert.deepEqual([r.handle, posts(boot)[0].body.platformUsernames.sleeper], ['scouty', 'scouty']);
    const withServer = load({ local: { [FW]: account('u1'), dynastyhq_username: 'scouty' } , server: 'real' });
    assert.equal((await withServer.id.reconcileAfterSignIn(null, { boot: true })).handle, 'real');
    const fresh = load({ local: { dynastyhq_username: 'scouty' } });
    const rf = await fresh.id.reconcileAfterSignIn(account('u1'));
    assert.equal(rf.handle, null, 'never on a sign-in');
    assert.equal(posts(fresh).length, 0);
});

test('nit: RevenueCat logOut goes through the app\'s DHQBilling module when it has one', async () => {
    let n = 0;
    const env = load({ local: { [FW]: account('u1') }, extra: { DHQBilling: { logOut: async () => { n++; } } } });
    await env.id.signOutClear();
    assert.equal(n, 1);
});

test('B2: the shared sync refuses a DHQ-Shared source whose manifest lacks identity.js', () => {
    const { spawnSync } = require('node:child_process');
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhq-shared-old-'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ modules: ['supabase-client.js'], data: [] }));
    const res = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'sync-reconai-shared.cjs')], { env: { ...process.env, DHQ_SHARED_SOURCE: dir }, encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /identity\.js/);
    assert.ok(fs.existsSync(path.join(SHARED, 'identity.js')), 'the vendored snapshot is left intact');
});
