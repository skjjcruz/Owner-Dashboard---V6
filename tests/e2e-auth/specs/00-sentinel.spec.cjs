'use strict';
// Harness sentinels. If these fail, every other result is meaningless:
//  S1  the gates are ON (non-localhost host): a vacuous pass is impossible.
//  S2  the stubbed world renders: Sleeper, MFL and ESPN fixture leagues show.
const { test, expect, seeds, data, HOST } = require('../lib/harness.cjs');

test.describe('harness sentinels', () => {
  test('S1 gates are active on the mapped host (index gate, DEV_MODE, tier) @native', async ({ app }) => {
    await app.open('index.html');
    // index.html pre-paint gate bounced a signed-out visitor.
    await app.expectFinal({ page: 'landing', sheet: false });
    expect(new URL(app.page.url()).hostname).toBe(HOST);
    // Signed in: components.js DEV_MODE banner must be absent and the hub must
    // NOT auto-log in as bigloco (the localhost behaviour).
    const A = app.backend.addAccount({ email: 's1@x.test' });
    await app.seed({ local: { fw_session_v1: app.backend.sessionFor(A), od_profile_v1: { onboardingComplete: true } } });
    await app.open('index.html');
    await app.expectFinal({ page: 'hub', leagues: [] });
    const dev = await app.page.evaluate(() => ({
      banner: !!document.querySelector('.wr-dev-banner'),
      host: location.hostname,
      sandbox: typeof window.isSandbox === 'function' ? window.isSandbox() : null,
      platformSandbox: window.PLATFORM_SANDBOX_ACCESS,
    }));
    expect(dev).toEqual({ banner: false, host: HOST, sandbox: false, platformSandbox: false });
    // tier.js takes its localhost shortcut only on localhost; getUserTier must
    // not be the sandbox 'commissioner'.
    expect(await app.page.evaluate(() => window.getUserTier && window.getUserTier())).not.toBe('commissioner');
    // An expired token is refused by the gate (it would pass on localhost).
    await app.seed({ local: { fw_session_v1: app.backend.sessionFor(A, { iat: 1700000000, exp: 1700000100 }) } });
    await app.open('index.html');
    await app.expectFinal({ page: 'landing' });
  });

  test('S2 stubbed Sleeper, MFL and ESPN fixtures render in the hub', async ({ app }) => {
    const A = app.backend.addAccount({ email: 's2@x.test' });
    await app.seed({ local: {
      ...seeds.connectOnboarded(app.backend, A, 'alpha_x'),
      mfl_league_id: '41208', mfl_year: '2026', mfl_franchise_id: '0001',
      espn_league_id: '777001', espn_year: '2026', espn_team_id: '1',
    } });
    await app.open('index.html');
    await app.expectFinal({ page: 'hub', leagues: [...data.leagueNamesFor('alpha_x'), 'Alpha MFL League', 'Alpha ESPN League'] });
  });
});
