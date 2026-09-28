'use strict';
// Connecting leagues and keeping them (audit T21–T24, T31, T32).
const { test, expect, seeds, inv, data } = require('../lib/harness.cjs');
const { X } = require('../lib/scenarios.cjs');

// A signed in, nothing linked anywhere (server empty) → the hub offers "Add a league".
function unlinked(app, email) {
  const A = app.backend.addAccount({ email });
  return { A, local: { fw_session_v1: app.backend.sessionFor(A), od_profile_v1: { onboardingComplete: true, platforms: ['sleeper'] } } };
}

test('T21 hub connect Sleeper → fw-profile POST completes before the reload (I3)', async ({ app }) => {
  const { A, local } = unlinked(app, 't21@x.test');
  await app.seed({ local });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: [] });
  await app.hubConnect('alpha_x');
  await app.expectFinal({ page: 'hub', leagues: X });
  const posts = app.backend.calls('fw-profile', 'POST');
  expect(posts.length, 'the hub sent the handle to fw-profile').toBeGreaterThan(0);
  await app.soft(() => inv.expectServerHandleMatchesLocal(app, A, 'alpha_x'));
});

test('T22 hub connect while fw-profile POST fails (500) → handle stays local, sync retried on the next launch', async ({ app }) => {
  const { A, local } = unlinked(app, 't22@x.test');
  app.backend.profilePostMode = 500;
  await app.seed({ local });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: [] });
  await app.hubConnect('alpha_x');
  await app.expectFinal({ page: 'hub', leagues: X });
  expect(app.backend.serverHandle(A)).toBeNull();
  // Server recovers; the queued write must land without the user re-connecting.
  app.backend.profilePostMode = 'ok';
  await app.relaunch('index.html');
  await app.expectFinal({ page: 'hub', leagues: X });
  await expect.poll(() => app.backend.serverHandle(A), { timeout: 8000, message: 'unsynced handle retried to fw-profile' }).toBe('alpha_x');
});

test('T23 ESPN private league, app relaunch (cookies gone) → reconnect prompt is reachable', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't23@x.test', sleeper: 'alpha_x' });
  await app.seed({
    local: { ...seeds.connectOnboarded(app.backend, A, 'alpha_x'), espn_league_id: '777002', espn_year: '2026', espn_team_id: '1' },
    session: { espn_s2: 'AEB-s2-cookie', espn_swid: '{AAAA-BBBB}' },
  });
  await app.relaunch('index.html');
  await app.expectFinal({ page: 'hub', includes: X });
  const reconnect = app.page.getByRole('link', { name: 'Reconnect ESPN' }).filter({ visible: true }).first();
  await expect(reconnect).toHaveAttribute('href', 'connect-sleeper.html?reconnect=espn');
  await expect(reconnect, 'a visible way to reconnect the private ESPN league').toBeVisible({ timeout: 8000 });
  app.mark('reconnect ESPN');
  await reconnect.click();
  await app.expectFinal({ page: 'connect', search: /reconnect=espn/ });
  await expect(app.page.locator('#espnLeagueId')).toBeVisible();
});

test('T24 MFL private league, app relaunch (API key gone) → reconnect prompt is reachable', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't24@x.test', sleeper: 'alpha_x' });
  await app.seed({
    local: { ...seeds.connectOnboarded(app.backend, A, 'alpha_x'), mfl_league_id: '66601', mfl_year: '2026', mfl_franchise_id: '0001' },
    session: { mfl_api_key: 'mfl-private-key' },
  });
  await app.relaunch('index.html');
  await app.expectFinal({ page: 'hub', includes: X });
  const reconnect = app.page.getByRole('link', { name: 'Reconnect MFL' }).filter({ visible: true }).first();
  await expect(reconnect).toHaveAttribute('href', 'connect-sleeper.html?reconnect=mfl');
  await expect(reconnect, 'a visible way to reconnect the private MFL league').toBeVisible({ timeout: 8000 });
  app.mark('reconnect MFL');
  await reconnect.click();
  await app.expectFinal({ page: 'connect', search: /reconnect=mfl/ });
  await expect(app.page.locator('#mflLeagueId')).toBeVisible();
});

test('T31 Demo League → not commissioner, no owner handle written, device not tagged internal', async ({ app, context }) => {
  // Real browsers have navigator.webdriver=false; landing/connect skip the
  // owner tag for automated browsers, which would make this check vacuous.
  await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });
  const { local } = unlinked(app, 't31@x.test');
  await app.seed({ local });
  await app.open('index.html');
  await app.expectFinal({ page: 'hub', leagues: [] });
  await app.openAddLeague();
  app.mark('Demo League');
  await app.page.getByRole('button', { name: 'Demo League' }).click();
  await app.expectFinal({ page: 'hub' });
  expect(await app.page.evaluate(() => window.getUserTier && window.getUserTier())).not.toBe('commissioner');
  const st = await app.storage();
  expect(inv.localHandleFrom(st.local), 'Demo must not write the owner handle as the user\'s identity').not.toBe('bigloco');
  await app.open('landing.html?home');
  await app.expectFinal({ page: 'landing' });
  const after = await app.storage();
  expect(after.local.dhq_internal_v1, 'device not tagged as an owner device').toBeUndefined();
});

test('T32 A with od_auth_v1 in the {sleeperUsername} shape only → relaunch at landing → app, not connect', async ({ app }) => {
  const A = app.backend.addAccount({ email: 't32@x.test' });
  const u = data.SLEEPER_USERS.alpha_x;
  await app.seed({ local: { fw_session_v1: app.backend.sessionFor(A), od_auth_v1: { sleeperUsername: u.username, sleeperUserId: u.user_id } } });
  await app.relaunch('landing.html');
  await app.expectFinal({ page: 'hub', leagues: X });
});
