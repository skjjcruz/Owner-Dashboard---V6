'use strict';
// Flows shared by several specs: each T-scenario is run on its own (T3…T15),
// again with relaunch checks (T33) and on iPhone/iPad app profiles (T34).
// Every scenario ends with the expected final state asserted and returns
// { want } — the expectFinal() descriptor of that end state.
const { seeds, data, inv } = require('./harness.cjs');

const X = data.leagueNamesFor('alpha_x');
const Y = data.leagueNamesFor('bravo_y');
const G = data.leagueNamesFor('guest_g');
const alphaMarkers = (A) => ['alpha_x', A.email, A.id, ...data.SLEEPER_USERS.alpha_x.leagues.map(([id]) => id)];

const scenarios = {
  // T3 — empty device, Google sign-in to an existing account whose server
  // profile has Sleeper x → hub with x's leagues, never the connect page.
  async T3(app) {
    const A = app.backend.addAccount({ email: 't3@x.test', provider: 'google', sleeper: 'alpha_x' });
    await app.open('landing.html');
    await app.googleSignIn(A);
    const want = { page: 'hub', leagues: X };
    await app.expectFinal(want);
    const detour = app.navsSinceMark().filter(n => /connect-sleeper/.test(n.url));
    if (detour.length) throw new Error('T3: routed through the connect page: ' + app.navsSinceMark().map(n => n.url).join(' -> '));
    return { want, A };
  },

  // T4 — A onboarded via the connect page → Settings sign-out → Google A → hub x.
  async T4(app) {
    const A = app.backend.addAccount({ email: 't4@x.test', provider: 'google', sleeper: 'alpha_x' });
    await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
    await app.open('index.html');
    await app.expectFinal({ page: 'hub', leagues: X });
    await app.settingsSignOut();
    await app.expectFinal({ page: 'landing' });
    await app.soft(() => inv.expectSignedOutClean(app));
    await app.googleSignIn(A);
    const want = { page: 'hub', leagues: X };
    await app.expectFinal(want);
    return { want, A };
  },

  // T7 — A signed in → Settings sign-out → B (server y) signs in → hub y, no A keys.
  async T7(app) {
    const A = app.backend.addAccount({ email: 't7a@x.test', sleeper: 'alpha_x' });
    const B = app.backend.addAccount({ email: 't7b@x.test', sleeper: 'bravo_y' });
    await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
    await app.open('index.html');
    await app.expectFinal({ page: 'hub', leagues: X });
    await app.settingsSignOut();
    await app.expectFinal({ page: 'landing' });
    await app.soft(() => inv.expectSignedOutClean(app, { label: 'after Settings sign-out' }));
    await app.emailSignIn(B);
    const want = { page: 'hub', leagues: Y };
    await app.expectFinal(want);
    await app.soft(() => inv.expectNoForeignIdentity(app, alphaMarkers(A), { label: 'B signed in after A' }));
    return { want, A, B };
  },

  // T8 — A → sign-out → B with an empty server profile → connect page, no A leagues.
  async T8(app) {
    const A = app.backend.addAccount({ email: 't8a@x.test', sleeper: 'alpha_x' });
    const B = app.backend.addAccount({ email: 't8b@x.test' });
    await app.seed({ local: seeds.connectOnboarded(app.backend, A, 'alpha_x') });
    await app.open('index.html');
    await app.expectFinal({ page: 'hub', leagues: X });
    await app.settingsSignOut();
    await app.expectFinal({ page: 'landing' });
    await app.emailSignIn(B);
    const want = { page: 'connect', leagues: [] };
    await app.expectFinal(want);
    await app.soft(() => inv.expectNoForeignIdentity(app, alphaMarkers(A), { label: 'B (no server handle) signed in after A' }));
    return { want, A, B };
  },

  // T13 — guest with a league taps Billing → landing sign-in sheet, no loop.
  async T13(app) {
    await app.seed({ local: seeds.guestWithLeague('guest_g') });
    await app.open('index.html');
    await app.expectFinal({ page: 'hub', leagues: G });
    await app.clickBilling();
    const want = { page: 'landing', sheet: true, sheetMode: 'signin' };
    await app.expectFinal(want);
    return { want };
  },

  // T14 — guest with a league signs up (new account) → leagues kept and
  // uploaded to the new account, wr_guest_v1 gone.
  async T14(app) {
    await app.seed({ local: seeds.guestWithLeague('guest_g') });
    await app.open('index.html');
    await app.expectFinal({ page: 'hub', leagues: G });
    await app.open('landing.html?home', 'hub logo (landing ?home)');
    await app.expectFinal({ page: 'landing' });
    await app.emailSignUp('t14-new@x.test');
    const want = { page: 'hub', leagues: G };
    await app.expectFinal(want);
    const acct = app.backend.findByEmail('t14-new@x.test');
    if (!acct) throw new Error('T14: sign-up did not create the account');
    await app.soft(() => inv.expectServerHandleMatchesLocal(app, acct, 'guest_g'));
    const st = await app.storage();
    if (st.local.wr_guest_v1 != null) throw new Error('T14: wr_guest_v1 survived the sign-up');
    return { want, acct };
  },

  // T15 — guest (x = guest_g) signs in to an existing account B whose server
  // handle is y → server wins; guest keys cleared.
  async T15(app) {
    const B = app.backend.addAccount({ email: 't15b@x.test', sleeper: 'bravo_y' });
    await app.seed({ local: seeds.guestWithLeague('guest_g') });
    await app.open('index.html');
    await app.expectFinal({ page: 'hub', leagues: G });
    await app.open('landing.html?home', 'hub logo (landing ?home)');
    await app.expectFinal({ page: 'landing' });
    await app.emailSignIn(B);
    const want = { page: 'hub', leagues: Y };
    await app.expectFinal(want);
    await app.soft(() => inv.expectNoForeignIdentity(app, ['guest_g', ...data.SLEEPER_USERS.guest_g.leagues.map(([id]) => id)], { label: 'B signed in over a guest' }));
    return { want, B };
  },
};

// T33: relaunch the app at landing, index and connect: each must come back to
// the same end state (page kind, and the same leagues in the hub).
async function expectRelaunchStable(app, want) {
  const same = { page: want.page, ...(want.leagues ? { leagues: want.leagues } : {}) };
  for (const entry of ['landing.html', 'index.html', 'connect-sleeper.html']) {
    await app.relaunch(entry);
    await app.expectFinal(same, { label: `relaunch at ${entry}` });
  }
}

module.exports = { scenarios, expectRelaunchStable, X, Y, G, alphaMarkers };
