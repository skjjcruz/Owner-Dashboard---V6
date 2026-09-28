'use strict';
// Playwright fixtures + the App driver used by every spec.
//
//   const { test, expect } = require('../lib/harness.cjs');
//   test('…', async ({ app, backend }) => { … });
//
// `app` wraps the current page of a fresh browser context whose network is
// fully stubbed by `backend` (lib/backend.cjs). The site is served by
// scripts/serve-static.cjs (started by playwright.config.cjs) and reached as
// http://dhq.test:<port>/ through Chromium's host-resolver mapping, so every
// "localhost" dev bypass (index.html gate, components.js DEV_MODE, tier.js)
// is OFF. tests/e2e-auth/specs/00-sentinel.spec.cjs fails if that ever stops
// being true.

const base = require('playwright/test');
const { FakeBackend } = require('./backend.cjs');
const data = require('./data.cjs');
const inv = require('./invariants.cjs');

const HOST = 'dhq.test';
const PORT = Number(process.env.E2E_AUTH_PORT);
const ORIGIN = `http://${HOST}:${PORT}`;

const PAGE_KIND = {
  '/': 'hub', '/index.html': 'hub', '/landing.html': 'landing', '/connect-sleeper.html': 'connect',
  '/login.html': 'login', '/upgrade.html': 'upgrade', '/ai-setup.html': 'ai-setup', '/__e2e/blank': 'blank',
};

// Text that means "not settled yet" (I1).
const LOADING_RE = /Loading more leagues|Signing you in|Finding your leagues|Loading Dynasty HQ|SYNCING FRANCHISES|Opening the war room/i;
// The app shell is still booting (dev server serves ~90 separately compiled
// scripts). Time spent here is NOT charged to the 8 s I1 budget, up to
// BOOT_BUDGET_MS — production ships one bundle; see README "Harness caveats".
const BOOT_RE = /Opening the war room/i;
const BOOT_BUDGET_MS = Number(process.env.E2E_AUTH_BOOT_BUDGET_MS || 20000);
// The hub has mounted (franchise board, empty state or connect card).
const HUB_READY_RE = /SELECT FRANCHISE|Add a league|Connect your account|FRANCHISES|Sleeper username/i;

class App {
  constructor({ context, page, backend, testInfo }) {
    this.context = context;
    this.page = page;
    this.backend = backend;
    this.testInfo = testInfo;
    this.origin = ORIGIN;
    this.navs = [];          // app-origin main-frame document loads
    this.marks = [{ at: 0, label: 'start' }];
    this.steps = [];
    this.softErrors = [];
    this.consoleErrors = [];
    this._watch(page);
    context.on('page', p => this._watch(p));
  }

  _watch(page) {
    page.on('request', req => {
      try {
        if (!req.isNavigationRequest() || req.frame() !== page.mainFrame()) return;
        const u = new URL(req.url());
        if (u.origin !== ORIGIN || u.pathname === '/__e2e/blank') return;
        this.navs.push({ t: Date.now(), url: u.pathname + u.search + u.hash, page });
      } catch { /* detached frame */ }
    });
    page.on('dialog', d => d.accept().catch(() => {}));
    page.on('pageerror', e => this.consoleErrors.push('pageerror ' + page.url() + ': ' + String(e && e.message).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') this.consoleErrors.push(m.type() + ' ' + page.url() + ': ' + m.text().slice(0, 300)); });
  }

  // Invariant checks that should not stop the flow: recorded, and the test
  // fails at teardown with all of them listed.
  async soft(fn) {
    try { await fn(); } catch (e) { this.softErrors.push(String(e && e.message || e)); }
  }

  url(path) { return ORIGIN + '/' + String(path || '').replace(/^\//, ''); }

  // A user action: everything after it is attributed to it for I5.
  mark(label) { this.marks.push({ at: this.navs.length, label, t: Date.now() }); this.steps.push(label); }
  navsSinceMark() { return this.navs.slice(this.marks[this.marks.length - 1].at); }

  // ── Storage ─────────────────────────────────────────────────
  // Seed a device: localStorage (+ optional sessionStorage) on the app origin,
  // written from a blank same-origin page so no app code runs while seeding.
  async seed({ local = {}, session = {} } = {}) {
    await this.page.goto(this.url('__e2e/blank'));
    await this.page.evaluate(([l, s]) => {
      localStorage.clear(); sessionStorage.clear();
      for (const [k, v] of Object.entries(l)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
      for (const [k, v] of Object.entries(s)) sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }, [local, session]);
  }

  async storage() {
    for (let i = 0; i < 20; i++) {
      try {
        if (!this.page.url().startsWith(ORIGIN)) await this.page.waitForURL(u => String(u).startsWith(ORIGIN), { timeout: 2000 }).catch(() => {});
        return await this.page.evaluate(() => ({
          local: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])),
          session: Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)])),
        }));
      } catch { await this.page.waitForTimeout(150); }
    }
    throw new Error('could not read storage (page kept navigating)');
  }
  async localJson(key) {
    const s = await this.storage();
    try { return JSON.parse(s.local[key]); } catch { return s.local[key] === undefined ? undefined : s.local[key]; }
  }

  // ── Navigation ──────────────────────────────────────────────
  async open(path, label) {
    this.mark(label || 'open ' + path);
    await this.page.goto(this.url(path), { waitUntil: 'commit' });
  }

  // App relaunch: the native shell / a new tab starts a fresh document with
  // localStorage intact and sessionStorage empty. Same context = same device.
  async relaunch(path = 'landing.html') {
    const old = this.page;
    const page = await this.context.newPage();
    this.page = page;
    await old.close().catch(() => {});
    this.mark('relaunch at ' + path);
    await page.goto(this.url(path), { waitUntil: 'commit' });
    return page;
  }

  // ── State probe ─────────────────────────────────────────────
  async probe() {
    const page = this.page;
    let url;
    try { url = new URL(page.url()); } catch { return { kind: 'none', url: page.url() }; }
    const kind = url.origin === ORIGIN ? (PAGE_KIND[url.pathname] || 'other:' + url.pathname) : (url.hostname === 'skjjcruz.github.io' ? 'scout' : 'external:' + url.hostname);
    let dom = null;
    try {
      dom = await page.evaluate((names) => {
        const vis = (el) => {
          if (!el) return false;
          if (el.closest('[hidden]')) return false;
          const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        };
        const text = document.body ? document.body.innerText : '';
        const sheet = document.getElementById('authSheet');
        const title = document.getElementById('authTitle');
        return {
          ready: document.readyState,
          text,
          leagues: names.filter(n => text.includes(n)),
          sheetOpen: !!(sheet && !sheet.hidden),
          sheetMode: title ? (/welcome back|sign in/i.test(title.textContent) ? 'signin' : 'signup') : null,
          hubConnect: vis(document.getElementById('wr-sleeper-input')),
          preboot: !!document.getElementById('preboot-hide'),
        };
      }, data.ALL_LEAGUE_NAMES);
    } catch { dom = null; }
    const text = dom ? dom.text : '';
    return {
      kind, url: url.pathname + url.search + url.hash, search: url.search,
      ready: dom ? dom.ready : 'unknown',
      leagues: dom ? dom.leagues : [],
      loading: dom ? LOADING_RE.test(text) : true,
      hubReady: kind === 'hub' && dom ? HUB_READY_RE.test(text) : false,
      booting: !dom || dom.ready === 'loading' || (kind === 'hub' && (BOOT_RE.test(text) || !HUB_READY_RE.test(text))),
      sheetOpen: dom ? dom.sheetOpen : false,
      sheetMode: dom ? dom.sheetMode : null,
      hubConnect: dom ? dom.hubConnect : false,
      preboot: dom ? dom.preboot : true,
      text,
    };
  }

  // I1 + I5 (+ I4): wait for the final state, which must be reached within
  // `within` ms (default 8 s) of the last user action and hold steady.
  //   want = { page: 'hub'|'landing'|'connect'|'login'|…,
  //            leagues: [exact fixture league names shown] ,
  //            includes: [names that must show], excludes: [names that must not],
  //            sheet: true|false, search: /regex/ on location.search,
  //            text: /regex/, noText: /regex/, maxNav: 3 }
  async expectFinal(want, { within = 8000, stableMs = 900, label } = {}) {
    const start = Date.now();
    let last = null; let okSince = 0; let navCountAtOk = -1; let reasons = [];
    let bootMs = 0; let prevT = start;
    while (Date.now() - start < within + Math.min(bootMs, BOOT_BUDGET_MS)) {
      // I5 fast path: a redirect loop never settles; say so directly.
      const sinceMark = this.navsSinceMark();
      const cap = (want.maxNav === undefined ? 3 : want.maxNav) + 3;
      if (sinceMark.length > cap) {
        throw new Error(`I5: redirect loop after "${label || this.marks[this.marks.length - 1].label}" — ${sinceMark.length} navigations without user input: ${sinceMark.slice(0, 12).map(n => n.url).join(' -> ')}${sinceMark.length > 12 ? ' -> …' : ''}`);
      }
      last = await this.probe();
      const now = Date.now();
      if (last.booting) bootMs += now - prevT;
      prevT = now;
      reasons = inv.stateMismatches(last, want);
      if (!reasons.length) {
        if (!okSince || this.navs.length !== navCountAtOk) { okSince = Date.now(); navCountAtOk = this.navs.length; }
        else if (Date.now() - okSince >= stableMs) break;
      } else okSince = 0;
      await this.page.waitForTimeout(150).catch(() => {});
    }
    const trail = this.navsSinceMark().map(n => n.url);
    const step = label || this.marks[this.marks.length - 1].label;
    if (reasons.length || !okSince) {
      throw new Error(`I1: after "${step}" expected ${inv.describeWant(want)} within ${within} ms (+${Math.round(Math.min(bootMs, BOOT_BUDGET_MS))} ms app boot).\n` +
        `  last state: ${inv.describeState(last)}\n  mismatch: ${reasons.join('; ') || 'state did not hold steady'}\n` +
        `  navigations since the action: ${trail.join(' -> ') || '(none)'}`);
    }
    // I5: no redirect loop.
    const maxNav = want.maxNav === undefined ? 3 : want.maxNav;
    if (trail.length > maxNav) {
      throw new Error(`I5: ${trail.length} navigations after "${step}" without user input (max ${maxNav}): ${trail.join(' -> ')}`);
    }
    // I4 on every settled state.
    if (!String(last.kind).startsWith('external')) await this.soft(() => inv.checkI4(this));
    return last;
  }

  // ── Flows (each is one user action) ─────────────────────────
  async _openSheet(mode) {
    await this.page.waitForLoadState('load').catch(() => {});
    const p = await this.probe();
    if (p.kind !== 'landing') throw new Error(`cannot sign in: expected the landing page, on ${p.kind} (${p.url})`);
    await this.page.waitForFunction(() => !document.getElementById('preboot-hide') && typeof window.openAuthSheet === 'function', null, { timeout: 8000 });
    await this.page.evaluate(m => window.openAuthSheet(m), mode);
    await this.page.waitForSelector('#authSheet:not([hidden]) #btnJoin', { timeout: 5000 });
  }
  // Email sign-in from the landing page the device is on (or opens it).
  async emailSignIn(acct, { password } = {}) {
    if ((await this.probe()).kind !== 'landing') await this.open('landing.html', 'open landing to sign in');
    await this.expectFinal({ page: 'landing' }, { label: 'landing before sign-in' });
    await this._openSheet('signin');
    await this.page.fill('#acctEmail', acct.email);
    await this.page.fill('#acctPassword', password || acct.password);
    this.mark('email sign-in ' + acct.email);
    await this.page.click('#btnJoin');
  }
  async emailSignUp(email, password = 'new-pass-123') {
    if ((await this.probe()).kind !== 'landing') await this.open('landing.html', 'open landing to sign up');
    await this.expectFinal({ page: 'landing' }, { label: 'landing before sign-up' });
    await this._openSheet('signup');
    await this.page.fill('#acctEmail', email);
    await this.page.fill('#acctPassword', password);
    this.mark('email sign-up ' + email);
    await this.page.click('#btnJoin');
  }
  // Google: the landing button → stubbed /auth/v1/authorize → back to
  // landing.html#access_token=… → landing's OAuth handler (getSession reads
  // the fragment and calls the stubbed /auth/v1/user) → fw-oauth-sync.
  async googleSignIn(acctOrProfile) {
    if ((await this.probe()).kind !== 'landing') await this.open('landing.html', 'open landing for Google');
    await this.expectFinal({ page: 'landing' }, { label: 'landing before Google' });
    await this._openSheet('signin');
    this.backend.nextOAuth(acctOrProfile);
    this.mark('Google sign-in ' + acctOrProfile.email);
    await this.page.click('#btnGoogle');
  }
  // Settings → Sign out (core.js dhqSignOut, which Settings calls).
  async settingsSignOut() {
    await this.page.waitForLoadState('load').catch(() => {});
    await this.page.waitForFunction(() => typeof window.dhqSignOut === 'function', null, { timeout: 8000 });
    this.mark('Settings sign-out');
    await this.page.evaluate(() => window.dhqSignOut());
  }
  // Hub logo → landing.html?signout path.
  async logoSignOut() { await this.open('landing.html?signout', '?signout'); }

  // Connect page: link Sleeper, then Enter.
  async connectPageSleeper(handle) {
    await this.page.waitForLoadState('load').catch(() => {});
    await this.page.waitForSelector('#tabSleeper', { state: 'visible', timeout: 8000 });
    if (!(await this.page.isVisible('#sleeperName'))) await this.page.click('#tabSleeper');
    await this.page.fill('#sleeperName', handle);
    this.mark('connect page: link Sleeper ' + handle);
    await this.page.click('#btnSleeper');
    await this.page.waitForSelector('#enterBtn:not([disabled])', { timeout: 8000 });
    this.mark('connect page: Enter');
    await this.page.click('#enterBtn');
  }
  // Hub "Add a league" card: type the handle, CONNECT.
  async openAddLeague() {
    await this.page.waitForLoadState('load').catch(() => {});
    const input = this.page.locator('#wr-sleeper-input');
    if (await input.isVisible().catch(() => false)) return input;
    const add = this.page.getByText('Add a league', { exact: true }).filter({ visible: true }).first();
    await add.waitFor({ state: 'visible', timeout: 8000 });
    await add.click();
    await input.waitFor({ state: 'visible', timeout: 8000 });
    return input;
  }
  // Legacy Sleeper-username login page (login.html).
  async legacyLogin(username, password) {
    if ((await this.probe()).kind !== 'login') await this.open('login.html', 'open login.html');
    await this.page.waitForLoadState('load').catch(() => {});
    await this.page.waitForFunction(() => window.OD && typeof window.OD.acquireSessionToken === 'function', null, { timeout: 8000 });
    await this.page.fill('#username', username);
    await this.page.fill('#password', password);
    this.mark('legacy login ' + username);
    await this.page.click('.login-btn');
  }
  async hubConnect(handle) {
    const input = await this.openAddLeague();
    await input.fill(handle);
    this.mark('hub connect ' + handle);
    await input.press('Enter');
  }
  async clickBilling() {
    const btn = this.page.getByRole('button', { name: /billing/i }).filter({ visible: true }).first();
    await btn.waitFor({ state: 'visible', timeout: 8000 });
    this.mark('Billing');
    await btn.click();
  }
}

// ── Seeds (device states) ─────────────────────────────────────
const seeds = {
  // A signed in, onboarded through connect-sleeper.html (its exact writes).
  connectOnboarded(backend, acct, handle, extra = {}) {
    const u = data.sleeperByName(handle);
    return {
      fw_session_v1: backend.sessionFor(acct, extra.tokenOpts),
      od_auth_v1: { username: u.username, sleeperUserId: u.user_id, createdAt: '2026-09-01T00:00:00.000Z' },
      od_locked_username_v2: u.username,
      od_profile_v1: { sleeperUsername: u.username, sleeperUserId: u.user_id, platforms: ['sleeper'], onboardingComplete: true },
    };
  },
  // A signed in, connected Sleeper from the hub card ({sleeperUsername} shape).
  hubOnboarded(backend, acct, handle, extra = {}) {
    const u = data.sleeperByName(handle);
    return {
      fw_session_v1: backend.sessionFor(acct, extra.tokenOpts),
      od_auth_v1: { sleeperUsername: u.username, sleeperUserId: u.user_id },
      od_locked_username_v2: u.username,
      od_profile_v1: { onboardingComplete: true, platforms: ['sleeper'] },
    };
  },
  // Supabase Auth session as supabase-js persists it after a Google sign-in.
  sbSession(acct) {
    const { supabaseAccessToken, nowS: now } = require('./jwt.cjs');
    const user = { id: acct.authUserId, email: acct.email, provider: 'google' };
    return {
      'sb-sxshiqyxhhifvtfqawbq-auth-token': {
        access_token: supabaseAccessToken(user), token_type: 'bearer', expires_in: 3600, expires_at: now() + 3600,
        refresh_token: 'rt-seeded', user: { id: user.id, aud: 'authenticated', role: 'authenticated', email: acct.email, app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: acct.displayName } },
      },
    };
  },
  // Guest (landing one-box) with a Sleeper league.
  guestWithLeague(handle) {
    const u = data.sleeperByName(handle);
    return {
      wr_guest_v1: '1',
      od_auth_v1: { username: u.username, sleeperUserId: u.user_id, createdAt: '2026-09-01T00:00:00.000Z' },
      od_locked_username_v2: u.username,
    };
  },
};

const test = base.test.extend({
  backend: async ({}, use) => { // eslint-disable-line no-empty-pattern
    const backend = new FakeBackend();
    await use(backend);
    await backend.dispose();
  },
  context: async ({ context, backend }, use) => {
    await backend.install(context, ORIGIN);
    await use(context);
  },
  // A second device (separate browser context = separate storage) talking to
  // the same fake server.
  newDevice: async ({ browser, backend }, use, testInfo) => {
    const made = [];
    await use(async () => {
      const u = testInfo.project.use || {};
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: u.viewport, userAgent: u.userAgent, isMobile: u.isMobile, hasTouch: u.hasTouch, deviceScaleFactor: u.deviceScaleFactor });
      made.push(ctx);
      await backend.install(ctx, ORIGIN);
      const page = await ctx.newPage();
      return new App({ context: ctx, page, backend, testInfo });
    });
    for (const c of made) await c.close().catch(() => {});
  },
  app: async ({ context, page, backend }, use, testInfo) => {
    const app = new App({ context, page, backend, testInfo });
    await use(app);
    // Evidence for every run: what was stubbed, what was blocked.
    const unstubbed = backend.unstubbed.filter(u => !/sentry|googletagmanager|gstatic/.test(u.url));
    if (unstubbed.length) testInfo.annotations.push({ type: 'unstubbed', description: unstubbed.map(u => u.method + ' ' + u.url).join('\n').slice(0, 2000) });
    const logPath = testInfo.outputPath('network-log.json');
    require('fs').writeFileSync(logPath, JSON.stringify({ steps: app.steps, navs: app.navs.map(n => n.url), console: app.consoleErrors, log: backend.log.map(l => ({ ...l, body: l.fn === 'fw-profile' ? l.body : undefined })), unstubbed: backend.unstubbed }, null, 2));
    await testInfo.attach('network-log.json', { path: logPath, contentType: 'application/json' });
    if (app.softErrors.length) throw new Error('Invariant violations during the flow:\n- ' + app.softErrors.join('\n- '));
    const errs = backend.log.filter(l => l.fn === 'harness-error');
    if (errs.length) throw new Error('harness route errors: ' + JSON.stringify(errs).slice(0, 500));
  },
});

module.exports = { test, expect: base.expect, App, seeds, data, inv, ORIGIN, HOST, PORT };
