# Sign-in / sign-out / session / identity E2E suite

Playwright regression suite for the account lifecycle: sign-in, sign-out,
session expiry and revocation, guest mode, legacy logins, and who owns the
device. The spec is sections 3 to 6 of the 2026-09-28 lifecycle audit: test
matrix T1 to T34 and invariants I1 to I6. Everything runs against a stubbed
network, so no real Supabase, Sleeper, MFL or ESPN call is ever made.

The suite is **not** part of `npm test`.

## Run

```bash
npm run test:e2e-auth                                  # working tree, all projects
npm run test:e2e-auth -- -g T7                         # one test (Playwright args pass through)
npm run test:e2e-auth -- --project=desktop
npm run test:e2e-auth -- --ref=a145e7a --shared-ref=6e6a6b2   # a clean snapshot of a commit
node tests/e2e-auth/summarize.cjs [--md]               # pass/fail matrix of the last run
```

- `run.cjs` looks for Playwright in this repo's `node_modules`, then in
  `NODE_PATH`, then in the global npm root. In this container it is the global
  `playwright@1.56.1`. The script never installs browsers.
- `--ref=<git ref>` serves `git archive <ref>` from a temp directory instead of
  the working tree. Use it when someone else is editing the app.
  `--shared-ref=<ref>` also vendors `../DHQ-Shared` (or `$DHQ_SHARED_SOURCE`)
  at that ref into the snapshot's `reconai-shared/`. Without it, the snapshot
  copies the working tree's `reconai-shared/`.
- Output goes to `output/e2e-auth/` (gitignored), or to `$E2E_AUTH_OUTPUT`.
  It holds `results.json`, and for each failed test a trace and a
  `network-log.json`. The network log records every stubbed call, the
  navigations, console errors and any requests that were blocked because no
  stub matched.
- Other environment variables: `E2E_AUTH_WORKERS` (default 2),
  `E2E_AUTH_BOOT_BUDGET_MS` (default 20000), `E2E_CHROMIUM` (browser path).

**Runtime:** about 9 to 10 minutes wall time for 53 test runs with 2 workers
on this 4-core container, which was shared with other work. A single test
takes 3 to 25 s. T18, which reloads the app five times, takes about 40 s.

## How it works

| Piece | File |
|---|---|
| Launcher (finds Playwright, picks a free port, handles `--ref`) | `run.cjs` |
| Config: projects `desktop`, `iphone-app`, `ipad-app` (the last two run `@native` tests only), web server, Chromium flags | `playwright.config.cjs` |
| Fake backend: Supabase functions, `/auth/v1`, `/rest/v1`, Sleeper, MFL, ESPN, fonts. Anything unstubbed is aborted and logged | `lib/backend.cjs` |
| Deterministic Sleeper users and leagues, MFL and ESPN leagues | `lib/data.cjs` |
| Unsigned test JWTs, same construction as `js/shared/legacy-session.test.js` | `lib/jwt.cjs` |
| `App` driver: seed, open, relaunch, `probe`, `expectFinal`, flows, fixtures | `lib/harness.cjs` |
| I1 to I6 | `lib/invariants.cjs`; I1, I4 and I5 run inside `expectFinal` |
| Shared scenarios (T3, T4, T7, T8, T13 to T15), reused by T33 and T34 | `lib/scenarios.cjs` |

- **The gates are on.** The site is served by
  `scripts/serve-static.cjs --compile` on `127.0.0.1`. Chromium reaches it as
  `http://dhq.test:<port>/` through `--host-resolver-rules`, so none of the
  `localhost` bypasses apply: the index.html gate, `DEV_MODE` in
  components.js and the tier.js shortcut. Sentinel **S1** fails if they ever
  switch back on.
- **Secure context.** Production runs on https. `http://dhq.test` would lose
  `crypto.subtle`, which login.html uses. The browser therefore runs with
  `--unsafely-treat-insecure-origin-as-secure`. Only full Chromium honours that
  flag (headless-shell does not), so the config always launches full Chromium.
- **One fake server per test**, holding accounts, `session_version` and
  `platform_usernames`. Tokens are checked the way `requireActiveAppSession`
  checks them, so `backend.revoke(acct)` behaves like a password reset on
  another device. The client does not verify JWT signatures (it only decodes
  them), so the tokens carry the signature placeholder `sig`.
- **Writes the page abandons never commit.** A `fw-profile` POST is committed
  only if the browser is still waiting after 150 ms of latency. This
  reproduces B2: the hub's `savePlatformUsernames` followed immediately by
  `location.reload()` shows up as `client-aborted`. A `keepalive` fetch
  survives the reload and commits.
- **OAuth** goes through the real button. The stubbed `/auth/v1/authorize`
  bounces back to `landing.html#access_token=…`. supabase-js then reads the
  fragment, calls the stubbed `/auth/v1/user`, and landing calls
  `fw-oauth-sync`.
- **App relaunch** opens a new page in the same context: localStorage is
  kept, sessionStorage is empty. A **second device** is a second context
  (`newDevice` fixture) talking to the same server.
- **Native app:** T3, T7, T14, T30 and S1 are tagged `@native` and also run
  as `iphone-app` and `ipad-app`. Those projects use a WKWebView-style user
  agent (`…Mobile/15E148`, no `Safari/`) and a mobile viewport. That covers
  T34.
- **Invariants.**
  - I1, I4 and I5 are checked every time `expectFinal()` settles.
  - I2, I3 and I6 are called explicitly.
  - I2, I3, I4 and I6 are *soft*: the flow keeps going, and the test fails at
    teardown with every violation listed.
  - I1 and I5 are hard. I5 also fails fast when a redirect loop is detected.

## Pass/fail on the current code

Baseline: app at `a145e7a` (branch tip before any fix commit) and DHQ-Shared
at `6e6a6b2`. Command: `--ref=a145e7a --shared-ref=6e6a6b2`. Two runs gave the
same matrix. "fail (expected)" means the test encodes the new behaviour from
the fix design.

| ID | Today | Why it fails today (audit ref) |
|---|---|---|
| S1, S2 | pass | Sentinels: gates on; fixtures render |
| T1 | fail (expected) | I3: connect-sleeper never writes the server (B1) |
| T2 | pass | |
| T3 (+iPhone, iPad) | fail (expected) | Google sign-in to an existing account on a fresh device goes to the connect page (B1) |
| T4 | fail (expected) | Flow reaches hub x. I6: Settings sign-out leaves `od_profile_v1.sleeperUsername` and `od_locked_username_v2` (B3) |
| T5 | fail (expected) | Hub connect POST is client-aborted by the reload, so after sign-in the hub has 0 leagues (B2) |
| T6 | fail (expected) | Flow reaches hub x. I6: `?signout` leaves `od_profile_v1.onboardingComplete` (B3, SF7) |
| T7 (+iPhone, iPad) | fail (expected) | B sees **A's** leagues (B3) |
| T8 | fail (expected) | B lands in the hub with A's leagues, not the connect page (B3) |
| T9 | fail (expected) | Gate goes to `landing.html` without `?reauth` and wipes `od_auth_v1` (B6) |
| T10 | fail (expected) | No "session ended" notice: `dhq:session-expired` has no listener (B6) |
| T11 | fail (expected) | `callAI` surfaces the raw "Valid session token required." (SF1) |
| T12 | fail (expected) | Fresh device goes to the connect page. MFL and ESPN pointers never restored (B1) |
| T13 | fail (expected) | Billing → upgrade → landing → back to the hub, and no sign-in sheet (B5) |
| T14 (+iPhone, iPad) | fail (expected) | Guest sign-up wipes the leagues and lands on the connect page (B5) |
| T15 | fail (expected) | The guest's local handle wins over the account's server handle (B3/B5) |
| T16 | pass | |
| T17 | fail (expected) | **Redirect loop** connect ⇄ index: A's leftover `onboardingComplete` plus a new guest flag with no league (I5; B3+B5). New finding |
| T18 | pass | Legacy login survives 5 reloads (b142/b144 plus DHQ-Shared d929aef/6e6a6b2) |
| T19 | fail (expected) | login.html local-hash branch: "Incorrect username or password" (SF4) |
| T20 | fail (expected) | Expired legacy session goes to `landing.html`, not `login.html?for=` |
| T21 | fail (expected) | `fw-profile` POST client-aborted by `location.reload()` (B2) |
| T22 | fail (expected) | No retry of the unsynced handle |
| T23, T24 | fail (expected) | No reconnect affordance for a private ESPN/MFL league after relaunch (SF2) |
| T25 | fail (expected) | Device 2's leftover Google session recreates the deleted account on a plain landing visit (SF3) |
| T26 | pass | |
| T27a/b/c | pass | Reload-invariant today: with and without the reload end the same (wrong for a/b) way |
| T28 | fail (expected) | Hung `fw-profile` leaves "Loading more leagues…" forever, with no retry (SF9) |
| T29 | fail (expected) | `?signout` calls `/auth/v1/logout?scope=global` (SF7) |
| T30 (+iPhone, iPad) | fail (expected) | After sign-out, B's hub shows Scout's `dynastyhq_username` leagues (B3) |
| T31 | fail (expected) | Demo League makes the user `commissioner` (SF8) |
| T32 | fail (expected) | `{sleeperUsername}`-shaped `od_auth_v1` is not recognised, so the user goes to the connect page (SF5) |
| T33-T3/T4/T7/T8/T14/T15 | fail (expected) | Inherit the scenario failures above |
| T33-signed-in | pass | Baseline relaunch from every entry page |

Totals: 12 of 53 test runs pass.

## Guessed assertions

These encode my reading of fix-design details that are ambiguous. Adjust them
when the implementation lands.

1. **T9.** An expired account token redirects to exactly
   `landing.html?reauth=1`. The test does not require the sheet to be open.
2. **T10, T11.** The notice text matches `/session (has )?ended|sign in again/i`.
   It has a button or link named `/sign in/i`, and clicking it leads to
   landing.
3. **T12.** The server keeps `espn: [{leagueId, year, teamId}]` and
   `mfl: [{leagueId, year, franchiseId}]` in `platformUsernames`. The stub
   returns `platformUsernames` from `fw-profile` GET and also from
   `fw-signin`, `fw-oauth-sync` and `fw-refresh-session`.
4. **I3.**
   - The server Sleeper handle may be a string or `{username}`.
   - The stub POST merges keys, and `null` deletes a key.
5. **T13.** A guest who taps Billing ends on landing with the sheet open in
   sign-in mode ("Welcome back").
6. **T14.**
   - A guest who signs up ends in the hub with the guest's leagues, not on the
     connect page.
   - The guest's entry to the sign-up sheet is `landing.html?home` (the hub
     logo). The design may add `?signin`.
7. **T17.**
   - The owner stamp survives sign-out.
   - The one-box then opens the sign-in sheet and does not set `wr_guest_v1`.
8. **T20.** An expired legacy session goes to `login.html?for=<handle>`.
9. **T22.** "Retry queued" means the next app launch re-sends the handle
   within 8 s. No flag name is asserted.
10. **T23, T24.**
    - The reconnect affordance is `a[href*="reconnect=espn|mfl"]` or a
      "Reconnect" button.
    - It lands on `connect-sleeper.html?reconnect=…` with that platform's
      input visible.
11. **T25.**
    - A plain landing visit (no fresh OAuth return) makes zero
      `fw-oauth-sync` calls.
    - The stub keeps today's server bug: the auth user is not deleted.
12. **T28.** The hub shows `/retry|try again/i` text and a button with that
    name within 8 s, and the button then loads x.
13. **T29.** At least one `/auth/v1/logout` call is made, and every such call
    uses `scope=local`.
14. **T31.**
    - The tier is read from `window.getUserTier()`.
    - The local handle is not `bigloco`.
    - `dhq_internal_v1` is unset after visiting landing. For this test only,
      `navigator.webdriver` is forced to `false`, because landing skips the
      owner tag for automated browsers.
15. **I2 and I6 key lists** (`IDENTITY_KEYS` in `lib/invariants.cjs`). The
    design never spells out `DEVICE_KEEP_KEYS`. I6 therefore allows every key
    except identity, session, secret and `sb-*` keys, with two exceptions:
    - `od_profile_v1` is allowed only if it has no handle and no
      `onboardingComplete`.
    - `dhq_owner_club_v1` is allowed only if it has no personal fields.
16. **T33.** "Same page" means the same page kind and the same leagues. T13 is
    left out because a guest relaunching into the guest hub is arguably
    correct.
17. **T27.** Checked as reload-invariance against a control device, not as an
    absolute outcome. T1 and T3 cover the absolute outcome.
18. **Settings actions.**
    - Settings sign-out is `window.dhqSignOut()`.
    - T26 calls `OD.changePassword`, then `OD.clearSignedInState`, then
      navigates to `landing.html?password=changed`, which is what Settings
      does on success.
    - T25 calls `window.dhqDeleteAccountFlow()` with the dialogs accepted.
    - None of these click through the Settings UI.

## Harness caveats

- **Dev build.**
  - serve-static serves about 90 separately compiled scripts, so the app shell
    takes 1 to 6 s to boot under load.
  - Time spent on the boot splash ("Opening the war room…") is not charged to
    the 8 s I1 budget, up to `E2E_AUTH_BOOT_BUDGET_MS`.
  - Everything after boot is held to 8 s.
- **Browser.** Full Chromium is required: the headless-shell build ignores the
  secure-origin flag.
- **iPad user agent.** It uses the `iPad` token plus `Mobile/15E148`, as
  requested. A real iPad WKWebView may send a desktop "Macintosh" UA. No auth
  code branches on device class.
- **Native origin.** The native origin (`skjjcruz.github.io`, shared with
  Scout) is modelled by seeding `dynastyhq_username`. The tests do not run on
  that origin.
- **Blocked by design.** Sentry's CDN script is blocked, and fonts are served
  empty. Every blocked request is listed in `network-log.json`.
- **Concurrent edits.** Another agent is editing the app on this branch. Use
  `--ref`/`--shared-ref` for a stable target, and give each concurrent run its
  own `E2E_AUTH_OUTPUT`: Playwright wipes its output directory at start.
