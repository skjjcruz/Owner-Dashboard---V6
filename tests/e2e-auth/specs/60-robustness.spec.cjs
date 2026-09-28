'use strict';
// Reloads, hangs and relaunches (audit T27, T28, T33).
const { test, seeds } = require('../lib/harness.cjs');
const { scenarios, expectRelaunchStable, X } = require('../lib/scenarios.cjs');

test.describe('T27 live-update reload mid-flow reaches the same final state', () => {
  test('T27a reload mid-OAuth (while fw-oauth-sync is in flight) → hub x', async ({ app }) => {
    const A = app.backend.addAccount({ email: 't27a@x.test', provider: 'google', sleeper: 'alpha_x' });
    app.backend.delays['fw-oauth-sync'] = 800;
    const arrived = app.backend.nextRequest('fw-oauth-sync', 'POST');
    await app.open('landing.html');
    await app.googleSignIn(A);
    await arrived;
    delete app.backend.delays['fw-oauth-sync'];
    app.mark('live-update reload');
    await app.page.evaluate(() => location.reload()).catch(() => {});
    await app.expectFinal({ page: 'hub', leagues: X });
  });

  test('T27b reload mid-connect (Sleeper linked, Enter not tapped) → hub x and the server has x', async ({ app }) => {
    await app.open('landing.html');
    await app.emailSignUp('t27b-new@x.test');
    await app.expectFinal({ page: 'connect' });
    await app.page.waitForSelector('#tabSleeper', { state: 'visible' });
    await app.page.click('#tabSleeper');
    await app.page.fill('#sleeperName', 'alpha_x');
    await app.page.click('#btnSleeper');
    await app.page.waitForSelector('#enterBtn:not([disabled])');
    app.mark('live-update reload');
    await app.page.reload({ waitUntil: 'commit' });
    await app.expectFinal({ page: 'hub', leagues: X });
    const acct = app.backend.findByEmail('t27b-new@x.test');
    const { inv } = require('../lib/harness.cjs');
    await inv.expectServerHandleMatchesLocal(app, acct, 'alpha_x');
  });

  test('T27c reload mid-hydrate (fw-profile GET in flight at index boot) → hub x', async ({ app }) => {
    const A = app.backend.addAccount({ email: 't27c@x.test', sleeper: 'alpha_x' });
    await app.seed({ local: { fw_session_v1: app.backend.sessionFor(A), od_profile_v1: { onboardingComplete: true, platforms: ['sleeper'] } } });
    app.backend.delays['fw-profile'] = 1500;
    const arrived = app.backend.nextRequest('fw-profile', 'GET');
    await app.open('index.html');
    await arrived;
    delete app.backend.delays['fw-profile'];
    app.mark('live-update reload');
    await app.page.reload({ waitUntil: 'commit' });
    await app.expectFinal({ page: 'hub', leagues: X });
  });
});

test('T28 fw-profile hangs → hub stops loading within 8 s and offers a retry', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't28@x.test', sleeper: 'alpha_x' });
  app.backend.profileMode = 'hang';
  await app.seed({ local: { fw_session_v1: app.backend.sessionFor(A), od_profile_v1: { onboardingComplete: true, platforms: ['sleeper'] } } });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', text: /retry|try again/i });
  // The retry works once the server answers.
  app.backend.profileMode = 'ok';
  const retry = app.page.getByRole('button', { name: /retry|try again/i }).filter({ visible: true }).first();
  app.mark('retry');
  await retry.click();
  await app.expectFinal({ page: 'hub', leagues: X });
});

test.describe('T33 app relaunch at landing / index / connect returns to the same end state', () => {
  for (const id of ['T3', 'T4', 'T7', 'T8', 'T14', 'T15']) {
    test(`T33-${id} relaunch after the ${id} end state`, async ({ app }) => {
      const { want } = await scenarios[id](app);
      await expectRelaunchStable(app, want);
    });
  }
  test('T33-signed-in A relaunch (baseline: hub x from every entry page)', async ({ app }) => {
    const A = app.backend.addAccount({ email: 't33@x.test', sleeper: 'alpha_x' });
    await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
    await app.open('index.html');
    await app.expectFinal({ page: 'hub', leagues: X });
    await expectRelaunchStable(app, { page: 'hub', leagues: X });
  });
});
