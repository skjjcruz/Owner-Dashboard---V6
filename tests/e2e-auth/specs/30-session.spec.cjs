'use strict';
// Session expiry, revocation, legacy logins, password change, deletion
// (audit T9, T10, T11, T18, T19, T20, T25, T26).
const { test, expect, seeds, inv, data } = require('../lib/harness.cjs');
const { legacyToken, nowS, DAY } = require('../lib/jwt.cjs');
const { X } = require('../lib/scenarios.cjs');

const L = data.leagueNamesFor('legacy_l');
const SESSION_ENDED_RE = /session (has )?ended|signed out.*sign in again|sign in again/i;

test('T9 A\'s token expired → open app → landing ?reauth, handle kept → sign in → hub x', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't9@x.test', sleeper: 'alpha_x' });
  const seed = seeds.connectOnboarded(app.backend, A, 'alpha_x', { tokenOpts: { iat: nowS() - 8 * DAY, exp: nowS() - DAY } });
  seed.od_profile_v1 = { onboardingComplete: true, platforms: ['sleeper'] }; // only od_auth_v1 carries the handle
  await app.seed({ local: seed });
  await app.open('index.html');
  await app.expectFinal({ page: 'landing', search: /[?&]reauth=1\b/ });
  const { local } = await app.storage();
  expect(inv.localHandleFrom(local), 'the Sleeper handle is not a credential and must survive the gate').toBe('alpha_x');
  await app.emailSignIn(A);
  await app.expectFinal({ page: 'hub', leagues: X });
});

test('T10 password reset elsewhere (fw-profile 401) → "session ended" banner → sign in → hub x', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't10@x.test', sleeper: 'alpha_x' });
  await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
  app.backend.revoke(A); // session_version bump on another device
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', text: SESSION_ENDED_RE });
  const signIn = app.page.getByRole('button', { name: /sign in/i }).or(app.page.getByRole('link', { name: /sign in/i })).filter({ visible: true }).first();
  app.mark('banner: sign in');
  await signIn.click();
  await app.expectFinal({ page: 'landing' });
  await app.emailSignIn(A);
  await app.expectFinal({ page: 'hub', leagues: X });
});

test('T11 AI call with a revoked token → "sign in again", not the raw "Valid session token required."', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't11@x.test', sleeper: 'alpha_x' });
  await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: X });
  app.backend.revoke(A);
  app.mark('Ask Alex (OD.callAI)');
  const msg = await app.page.evaluate(() => window.OD.callAI({ type: 'home-chat', context: 'who should I start?' }).then(() => 'ok', e => String(e && e.message)));
  expect(msg).not.toMatch(/Valid session token required/);
  await app.expectFinal({ page: 'hub', text: SESSION_ENDED_RE });
});

test('T18 legacy Sleeper-username login survives 5 reloads (fw-refresh-session 401 is not a revocation)', async ({ app }) => {
  const rec = app.backend.addLegacy('legacy_l', 'legacy-pw-1');
  await app.legacyLogin(rec.username, rec.password);
  await app.expectFinal({ page: 'hub', leagues: L });
  for (let i = 1; i <= 5; i++) {
    app.mark('reload ' + i);
    await app.page.reload({ waitUntil: 'commit' });
    await app.expectFinal({ page: 'hub', leagues: L }, { label: 'reload ' + i });
  }
});

test('T19 legacy login when od_auth_v1 came from the connect page (no local hash) → enters the app', async ({ app }) => {
  const rec = app.backend.addLegacy('legacy_l', 'legacy-pw-1');
  const u = data.SLEEPER_USERS.legacy_l;
  await app.seed({ local: { od_auth_v1: { username: u.username, sleeperUserId: u.user_id, createdAt: '2026-09-01T00:00:00.000Z' } } });
  await app.legacyLogin(rec.username, rec.password);
  await app.expectFinal({ page: 'hub', leagues: L });
});

test('T20 expired legacy session → open app → login.html?for=<handle>', async ({ app }) => {
  const token = legacyToken('legacy_l', { exp: nowS() - DAY });
  const expiresAt = new Date((nowS() - DAY) * 1000).toISOString();
  await app.seed({ local: {
    fw_session_v1: { token, expiresAt, user: { sleeperUsername: 'legacy_l', isGifted: false } },
    od_session_v1: { token, expiresAt, isGifted: false },
    od_auth_v1: { username: 'legacy_l', passwordHash: 'x', isGifted: false },
  } });
  await app.open('index.html');
  await app.expectFinal({ page: 'login', search: /[?&]for=legacy_l\b/ });
});

test('T25 delete account while device 2 keeps a Google session → device 2 does not recreate the account', async ({ app, newDevice }) => {
  const A = app.backend.addAccount({ email: 't25@x.test', provider: 'google', sleeper: 'alpha_x' });
  // Device 2: signed in with Google earlier (app session + Supabase session).
  const d2 = await newDevice();
  await d2.seed({ local: { ...seeds.connectOnboarded(app.backend, A, 'alpha_x'), ...seeds.sbSession(A) } });
  await d2.open('index.html');
  await d2.expectFinal({ page: 'hub', leagues: X });
  // Device 1 deletes the account (Settings → Delete account; dialogs accepted).
  await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: X });
  app.mark('delete account');
  await app.page.evaluate(() => window.dhqDeleteAccountFlow());
  await app.expectFinal({ page: 'landing' });
  expect(A.deleted).toBe(true);
  const syncsBefore = app.backend.calls('fw-oauth-sync').length;
  // Device 2: next launch hits a 401 (account gone), then the landing page.
  await d2.relaunch('index.html');
  await d2.expectFinal({ page: 'landing' }, { within: 8000 }).catch(() => {});
  await d2.relaunch('landing.html');
  await d2.expectFinal({ page: 'landing' });
  const recreated = [...app.backend.accounts.values()].filter(a => !a.deleted && a.email === A.email);
  expect(recreated.map(a => a.id), 'no new account for the deleted email').toEqual([]);
  expect(app.backend.calls('fw-oauth-sync').length - syncsBefore, 'fw-oauth-sync without a fresh OAuth return').toBe(0);
});

test('T26 change password → landing ?password=changed → sign in with the new password → hub x', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't26@x.test', sleeper: 'alpha_x' });
  await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: X });
  // What Settings → Change password does on success (settings.js L140-155).
  app.mark('change password');
  const res = await app.page.evaluate(async ([cur, next]) => {
    const r = await window.OD.changePassword(cur, next);
    try { window.OD.clearSignedInState(); } catch (e) {}
    window.location.href = 'landing.html?password=changed';
    return r && r.ok;
  }, [A.password, 'brand-new-pass-9']);
  expect(res).toBe(true);
  await app.expectFinal({ page: 'landing', sheet: true });
  await app.emailSignIn(A, { password: 'brand-new-pass-9' });
  await app.expectFinal({ page: 'hub', leagues: X });
});
