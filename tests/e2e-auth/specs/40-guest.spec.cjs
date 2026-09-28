'use strict';
// Guest lane ↔ accounts (audit T13–T17; T34 via @native).
const { test, expect, seeds } = require('../lib/harness.cjs');
const { scenarios, X } = require('../lib/scenarios.cjs');

test('T13 guest with a league → Billing → landing sign-in sheet, no loop', async ({ app }) => {
  await scenarios.T13(app);
});

test('T14 guest with a league signs up → leagues kept and uploaded, wr_guest_v1 gone @native', async ({ app }) => {
  await scenarios.T14(app);
});

test('T15 guest (x) signs in to an existing account (server y) → server wins, guest keys cleared', async ({ app }) => {
  await scenarios.T15(app);
});

test('T16 guest mid-setup (no league yet) relaunches → connect page', async ({ app }) => {
  await app.seed({ local: { wr_guest_v1: '1' } });
  await app.relaunch('landing.html');
  await app.expectFinal({ page: 'connect' });
  await app.relaunch('index.html');
  await app.expectFinal({ page: 'connect' });
});

test('T17 signed out on a device A used → landing one-box offers sign-in, not a silent guest', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't17@x.test', sleeper: 'alpha_x' });
  await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: X });
  await app.settingsSignOut();
  await app.expectFinal({ page: 'landing' });
  await app.page.fill('#league-key', 'alpha_x');
  app.mark('one-box submit');
  await app.page.click('#btnGuest');
  await app.expectFinal({ page: 'landing', sheet: true, sheetMode: 'signin' });
  const { local } = await app.storage();
  expect(local.wr_guest_v1, 'no silent guest flag').toBeUndefined();
});
