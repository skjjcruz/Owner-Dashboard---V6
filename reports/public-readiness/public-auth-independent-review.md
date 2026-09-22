# Actual public auth/mobile independent review — 2026-09-20

Reviewed the root-owned candidate in `warroom-readiness-public-auth`, based on actual public `db1701f`. No source edits, account creation, external messages, backend mutations or deployment were performed by this review.

No unresolved material finding in the bounded navigation, email-auth and reset-request repair. Explicit Sign in/Start free navigation selects the intended mode, respects the actual header height, and works with reduced motion or missing motion libraries. Phone navigation fits the viewport; the sticky invitation is hidden over the form. Email attempts exclude duplicate Enter submissions, retain fields after failure, ignore responses after the current session changes, and recheck identity before delayed navigation. The 20-second abort covers response-body consumption as well as connection waiting and releases the form. Reset acknowledgment requires both HTTP success and `ok: true`; failed requests preserve input and expose retry.

Independently reran `npm run test:landing-auth`: all five actual Chrome touch-emulated cases passed (320×740, 390×844, 844×390, short 390×430 with reduced motion, and 390×844 with motion libraries unavailable). The narrow-phone case waited through the actual 20-second timeout; all cases checked reset 503 → confirmed retry, sign-in failure/retry, duplicate submission, late-account isolation and navigation to a controlled next-page fixture. [Independent output](evidence/public-auth-independent-review.log). `git diff --check` passed. Reviewed the root's 320-pixel screenshot; visible navigation and form controls fit and remain readable.

The harness intercepts auth POSTs and blocks every other non-GET/HEAD request, including analytics, so it cannot create live test accounts or send reset email. Signup **mode/navigation** is covered; account-creation POST and complete onboarding are not covered by this fixture. Browser emulation is not physical-device keyboard, native app or deployed proof.

Existing OAuth and automatic legacy-session refresh can still overwrite/remove a newer identity after an awaited response. Root explicitly keeps this required follow-up open with separate source ownership. The bounded pass must not be treated as complete public-auth readiness.

Reviewed bytes (SHA256):

- `landing.html`: `be8a47ef31d6b63058c969ad5e53e1f9568f58760c5b41ea6c14b43f34fcdb51`
- `tests/landing-auth-browser.cjs`: `d970135bbb9d7438f7fb44e1a9ae88a90b0b6593f661c65422e611e8ef5c074d`
- `scripts/serve-static.cjs`: `b9bcb951fbd411759c99ffd4da396787b583dcac0065228d3d043ef99936c2f6`
