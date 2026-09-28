'use strict';
// Sign-out, then sign back in as the same or a different person
// (audit T4–T8, T29, T30; T34 via @native).
const { test, expect, seeds, inv, data } = require('../lib/harness.cjs');
const { scenarios, X, Y } = require('../lib/scenarios.cjs');

test('T4 connect-page onboarded A → Settings sign-out → Google A → hub x', async ({ app }) => {
  await scenarios.T4(app);
});

test('T5 A connects Sleeper in the hub → Settings sign-out → sign in A → hub x (server copy written by the hub)', async ({ app }) => {
  // Start: A signed in, no handle anywhere (server empty) → the hub offers
  // "Add a league"; A connects there, which is what B2 loses.
  const A = app.backend.addAccount({ email: 't5@x.test' });
  await app.seed({ local: { fw_session_v1: app.backend.sessionFor(A), od_profile_v1: { onboardingComplete: true, platforms: ['sleeper'] } } });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: [] });
  await app.hubConnect('alpha_x');
  await app.expectFinal({ page: 'hub', leagues: X });
  await app.settingsSignOut();
  await app.expectFinal({ page: 'landing' });
  await app.emailSignIn(A);
  await app.expectFinal({ page: 'hub', leagues: X });
});

test('T6 A → landing ?signout → sign in A (server x) → hub x', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't6@x.test', sleeper: 'alpha_x' });
  await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: X });
  await app.logoSignOut();
  await app.expectFinal({ page: 'landing' });
  await app.soft(() => inv.expectSignedOutClean(app, { label: 'after ?signout' }));
  await app.emailSignIn(A);
  await app.expectFinal({ page: 'hub', leagues: X });
});

test('T7 A signs out → B (server y) signs in → hub y, none of A\'s keys survive (I2) @native', async ({ app }) => {
  await scenarios.T7(app);
});

test('T8 A signs out → B (empty server profile) signs in → connect page, no A leagues (I2)', async ({ app }) => {
  await scenarios.T8(app);
});

test('T29 Google user → landing ?signout → Supabase sign-out uses local scope (other devices keep their session)', async ({ app, newDevice }) => {
  const A = app.backend.addAccount({ email: 't29@x.test', provider: 'google', sleeper: 'alpha_x' });
  // Both devices signed in with Google earlier (app session + Supabase session).
  const d2 = await newDevice();
  await d2.seed({ local: { ...seeds.connectOnboarded(app.backend, A, 'alpha_x'), ...seeds.sbSession(A) } });
  await d2.open('index.html');
  await d2.expectFinal({ page: 'hub', leagues: X });
  // Device 1: the logo ?signout.
  await app.seed({ local: { ...seeds.connectOnboarded(app.backend, A, 'alpha_x'), ...seeds.sbSession(A) } });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: X });
  await app.logoSignOut();
  await app.expectFinal({ page: 'landing' });
  const scopes = app.backend.logoutScopes;
  expect(scopes.length, 'landing ?signout signed the Supabase session out').toBeGreaterThan(0);
  expect(scopes.filter(s => s !== 'local'), `Supabase /auth/v1/logout scopes seen: ${JSON.stringify(scopes)}`).toEqual([]);
  // Device 2 still holds its Supabase session and stays signed in.
  const st = await d2.storage();
  expect(Object.keys(st.local).some(k => /^sb-.*-auth-token$/.test(k)), 'device 2 Supabase session present').toBe(true);
  await d2.relaunch('index.html');
  await d2.expectFinal({ page: 'hub', leagues: X });
});

test('T30 native origin: Scout wrote dynastyhq_username=z; A signs out → B (server y) → hub never shows z @native', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't30a@x.test', sleeper: 'alpha_x' });
  const B = app.backend.addAccount({ email: 't30b@x.test', sleeper: 'bravo_y' });
  await app.seed({ local: { ...seeds.hubOnboarded(app.backend, A, 'alpha_x'), dynastyhq_username: 'zulu_z' } });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: X });
  await app.settingsSignOut();
  await app.expectFinal({ page: 'landing' });
  await app.emailSignIn(B);
  await app.expectFinal({ page: 'hub', leagues: Y, excludes: data.leagueNamesFor('zulu_z') });
  void A;
});
