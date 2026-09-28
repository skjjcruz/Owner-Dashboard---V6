'use strict';
// Sign-in / sign-up entry paths (audit T1, T2, T3, T12; T34 via @native).
const { test, expect, inv } = require('../lib/harness.cjs');
const { scenarios, X } = require('../lib/scenarios.cjs');

test('T1 email sign-up → connect page → link Sleeper → hub; handle reaches the server (I3)', async ({ app }) => {
  await app.open('landing.html');
  await app.emailSignUp('t1-new@x.test');
  await app.expectFinal({ page: 'connect' });
  await app.connectPageSleeper('alpha_x');
  await app.expectFinal({ page: 'hub', leagues: X });
  const acct = app.backend.findByEmail('t1-new@x.test');
  expect(acct, 'account created by fw-signup').toBeTruthy();
  await inv.expectServerHandleMatchesLocal(app, acct, 'alpha_x');
});

test('T2 Google sign-in, brand-new account → connect page', async ({ app }) => {
  await app.open('landing.html');
  await app.googleSignIn({ email: 't2-new@x.test', name: 'T Two' });
  await app.expectFinal({ page: 'connect', leagues: [] });
  const acct = app.backend.findByEmail('t2-new@x.test');
  expect(acct, 'fw-oauth-sync created the account').toBeTruthy();
});

test('T3 Google sign-in, existing account with server handle x → hub x, no connect page @native', async ({ app }) => {
  await scenarios.T3(app);
});

test('T12 fresh device, sign-in A (server: Sleeper x + MFL + ESPN) → hub shows all three platforms', async ({ app }) => {
  // Server shape for espn[]/mfl[] pointers is from the fix design (guessed).
  const A = app.backend.addAccount({
    email: 't12@x.test', sleeper: 'alpha_x',
    mfl: [{ leagueId: '41208', year: '2026', franchiseId: '0001' }],
    espn: [{ leagueId: '777001', year: '2026', teamId: '1' }],
  });
  await app.open('landing.html');
  await app.emailSignIn(A);
  await app.expectFinal({ page: 'hub', leagues: [...X, 'Alpha MFL League', 'Alpha ESPN League'] });
});
