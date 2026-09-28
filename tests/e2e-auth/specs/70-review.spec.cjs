'use strict';
// Review fixes (2026-09-28 independent review): B1 lapsed-token re-sign-in on
// a device from before owner stamping, S2 Demo residue, S4 guest lane on an
// unstamped cache.
const { test, expect, seeds, inv, data } = require('../lib/harness.cjs');
const { nowS, DAY } = require('../lib/jwt.cjs');
const { X, Y } = require('../lib/scenarios.cjs');

const lapsed = { tokenOpts: { iat: nowS() - 8 * DAY, exp: nowS() - DAY } };

test('B1a unstamped device, token lapsed → gate → sign in as the same account (nothing on the server) → hub x, cache kept and uploaded', async ({ app }) => {
  const A = app.backend.addAccount({ email: 'b1a@x.test' }); // no server handle
  const seed = seeds.connectOnboarded(app.backend, A, 'alpha_x', lapsed);
  seed.mfl_league_id = '41208'; seed.mfl_year = '2026'; seed.mfl_franchise_id = '0001';
  await app.seed({ local: seed }); // no dhq_identity_owner_v1: a device from before stamping
  await app.open('index.html');
  await app.expectFinal({ page: 'landing', search: /[?&]reauth=1\b/, sheet: true, sheetMode: 'signin' });
  const mid = await app.storage();
  expect(mid.local.dhq_identity_owner_v1, 'owner stamped from the lapsed token').toBe('account:' + A.id);
  await app.emailSignIn(A);
  await app.expectFinal({ page: 'hub', includes: X });
  const { local } = await app.storage();
  expect(inv.localHandleFrom(local)).toBe('alpha_x');
  expect(local.mfl_league_id, 'league pointer kept').toBe('41208');
  await expect.poll(() => app.backend.serverHandle(A), { timeout: 8000, message: 'the same owner\'s handle is uploaded' }).toBe('alpha_x');
});

test('B1b unstamped device, no token at all → fresh sign-in (server empty) → connect page offers the remembered handle; confirm → hub x', async ({ app }) => {
  const A = app.backend.addAccount({ email: 'b1b@x.test' });
  const seed = seeds.connectOnboarded(app.backend, A, 'alpha_x');
  delete seed.fw_session_v1; // signed out on an older build: no token, no stamp
  await app.seed({ local: seed });
  await app.open('landing.html');
  await app.expectFinal({ page: 'landing' });
  await app.emailSignIn(A);
  await app.expectFinal({ page: 'connect' });
  expect(app.backend.serverHandle(A), 'nothing uploaded before the user confirms').toBeNull();
  const box = app.page.locator('#confirmBox');
  await expect(box).toBeVisible();
  await expect(box).toContainText('@alpha_x');
  app.mark('confirm remembered');
  await app.page.click('#confirmYes');
  await app.expectFinal({ page: 'hub', leagues: X });
  expect(app.backend.serverHandle(A)).toBe('alpha_x');
});

test('S2 Demo residue (od_auth_v1 = bigloco) is never uploaded to a real account', async ({ app }) => {
  const A = app.backend.addAccount({ email: 's2@x.test' });
  await app.seed({ local: {
    fw_session_v1: app.backend.sessionFor(A),
    dhq_identity_owner_v1: 'account:' + A.id,
    od_auth_v1: { sleeperUsername: 'bigloco' },
    od_profile_v1: { onboardingComplete: true, platforms: ['sleeper'] },
  } });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: [] });
  const posted = app.backend.calls('fw-profile', 'POST').map(c => JSON.stringify(c.body || c));
  expect(posted.filter(b => /bigloco/i.test(b)), 'no fw-profile POST carries the demo handle').toEqual([]);
  expect(app.backend.serverHandle(A)).toBeNull();
  const { local } = await app.storage();
  expect(inv.localHandleFrom(local), 'residue dropped').not.toBe('bigloco');
});

test('S4 guest lane on an unstamped cache (A signed out on an older build) → the guest never sees A\'s leagues', async ({ app }) => {
  await app.seed({ local: {
    od_profile_v1: { sleeperUsername: 'alpha_x', onboardingComplete: true, platforms: ['sleeper'] },
    od_locked_username_v2: 'alpha_x',
  } });
  await app.open('landing.html');
  await app.expectFinal({ page: 'landing' });
  await app.page.fill('#league-key', 'bravo_y');
  app.mark('one-box submit');
  await app.page.click('#btnGuest');
  // The device remembers a league: sign-in is offered first.
  await app.expectFinal({ page: 'landing', sheet: true, sheetMode: 'signin' });
  app.mark('one-box submit again → guest');
  await app.page.evaluate(() => { document.getElementById('go').requestSubmit(); });
  await app.expectFinal({ page: 'hub', leagues: Y, excludes: X }, { within: 15000 });
  const { local } = await app.storage();
  expect(local.wr_guest_v1).toBe('1');
  expect(inv.localHandleFrom(local)).toBe('bravo_y');
  void data;
});
