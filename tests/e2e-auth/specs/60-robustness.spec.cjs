'use strict';
// Reloads, hangs and relaunches (audit T27, T28, T33).
const { test, expect, seeds } = require('../lib/harness.cjs');
const { scenarios, expectRelaunchStable, X } = require('../lib/scenarios.cjs');

// T27 is reload-invariance: the same flow is run on a control device without
// the reload and on the test device with a reload at the risky moment; both
// must settle on the same page with the same leagues. (Absolute outcomes are
// asserted by T1/T3; this does not double-count them.)
async function settled(app) {
  const p = await app.expectFinal({});
  return { page: p.kind, leagues: [...p.leagues].sort() };
}

test.describe('T27 live-update reload mid-flow reaches the same final state', () => {
  test('T27a reload mid-OAuth (while fw-oauth-sync is in flight)', async ({ app, newDevice }) => {
    const control = await newDevice();
    const A1 = app.backend.addAccount({ email: 't27a-1@x.test', provider: 'google', sleeper: 'alpha_x' });
    await control.open('landing.html');
    await control.googleSignIn(A1);
    const want = await settled(control);

    const A2 = app.backend.addAccount({ email: 't27a-2@x.test', provider: 'google', sleeper: 'alpha_x' });
    app.backend.delays['fw-oauth-sync'] = 800;
    const arrived = app.backend.nextRequest('fw-oauth-sync', 'POST');
    await app.open('landing.html');
    await app.googleSignIn(A2);
    await arrived;
    delete app.backend.delays['fw-oauth-sync'];
    app.mark('live-update reload');
    await app.page.evaluate(() => location.reload()).catch(() => {});
    expect(await settled(app)).toEqual(want);
  });

  test('T27b reload mid-connect (Sleeper linked, Enter not tapped)', async ({ app, newDevice }) => {
    const control = await newDevice();
    await control.open('landing.html');
    await control.emailSignUp('t27b-1@x.test');
    await control.expectFinal({ page: 'connect' });
    await control.connectPageSleeper('alpha_x');
    const want = await settled(control);

    await app.open('landing.html');
    await app.emailSignUp('t27b-2@x.test');
    await app.expectFinal({ page: 'connect' });
    await app.page.waitForLoadState('load');
    await app.page.click('#tabSleeper');
    await app.page.fill('#sleeperName', 'alpha_x');
    await app.page.click('#btnSleeper');
    await app.page.waitForSelector('#enterBtn:not([disabled])');
    app.mark('live-update reload');
    await app.page.reload({ waitUntil: 'commit' });
    expect(await settled(app)).toEqual(want);
    // Whatever the control device sent to the server, the reloaded one did too.
    const c = app.backend.serverHandle(app.backend.findByEmail('t27b-1@x.test'));
    const t = app.backend.serverHandle(app.backend.findByEmail('t27b-2@x.test'));
    expect(t, 'server handle after a reload equals the no-reload server handle').toBe(c);
  });

  test('T27c reload mid-hydrate (fw-profile GET in flight at index boot)', async ({ app, newDevice }) => {
    const seedFor = (dev, A) => dev.seed({ local: { fw_session_v1: app.backend.sessionFor(A), od_profile_v1: { onboardingComplete: true, platforms: ['sleeper'] } } });
    const control = await newDevice();
    const A1 = app.backend.addAccount({ email: 't27c-1@x.test', sleeper: 'alpha_x' });
    await seedFor(control, A1);
    await control.open('index.html');
    const want = await settled(control);

    const A2 = app.backend.addAccount({ email: 't27c-2@x.test', sleeper: 'alpha_x' });
    await seedFor(app, A2);
    app.backend.delays['fw-profile'] = 1500;
    const arrived = app.backend.nextRequest('fw-profile', 'GET');
    await app.open('index.html');
    await arrived;
    delete app.backend.delays['fw-profile'];
    app.mark('live-update reload');
    await app.page.reload({ waitUntil: 'commit' });
    expect(await settled(app)).toEqual(want);
    expect(want).toEqual({ page: 'hub', leagues: [...X].sort() });
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
