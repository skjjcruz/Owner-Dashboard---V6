# Public sign-in and recovery — 2026-09-20

Candidate for `skjjcruz/Owner-Dashboard---V6`, from exact public baseline `db1701fd2e840e40184f645d1d50c4ec5a39d79c`. This is a bounded public-frontend fix, not full account or suite readiness.

## Reproduced behavior

The actual `dhqfootball.com` phone journey opened **Create your account** after tapping **Sign in**. At390px the top navigation clipped, while the fixed signup invitation covered the secondary sign-in control. Ordinary touch/scroll automation could not reach that control reliably. Original failure and screenshot are retained in `evidence/actual-public-signin-sep20.json` and `actual-public-signin-nav-390-sep20.png`.

## Changes

Sign in and Start free choose their requested form explicitly, including with animation libraries missing or reduced motion enabled. Navigation fits narrow phones and short landscape; secondary marketing sections remain on the page. The fixed invitation disappears while the account form is visible. The strategy demo now wraps its controls instead of expanding the phone viewport.

Email authentication has one pending request, a20-second timeout covering both response headers and JSON body, retained input/retry after failure, and an identity check before accepting a late response or navigating. Repeated Enter does not issue additional requests. Reset requests require a successful server acknowledgment before displaying the enumeration-safe confirmation; failures retain the email and permit retry. Email/password fields now have accessible names, account messages use live status semantics, and password autocomplete follows signup/signin mode.

The preview server reports its actual bound port, making isolated browser runs independent of existing previews. Playwright1.59.1 is pinned as a test-only dependency.

## Verification

- Existing public `npm test` passed after synchronization from actual canonical shared `dedbb1614f08459905eef27d0f0b7bce27cd4e15`; `npm run build:preview` compiled70 Babel scripts. See `evidence/public-auth-tests.log` and `evidence/public-auth-build.log`.
- `npm run test:landing-auth` passed320×740,390×844,844×390, short390×430 with reduced motion, and390×844 with the motion library unavailable. It uses ordinary touch interactions, rejects external writes, and tests explicit modes, scrolling, no horizontal viewport expansion, pending/duplicate submission, failures/retry, reset503 then confirmed recovery, and late account responses. A real20-second timeout is exercised at320px. Its successful navigation ends at a controlled next-page fixture, not a real league connection.
- The product-inventory reviewer independently ran all five browser cases and reviewed the pending/identity/reset logic. See `public-auth-independent-review.md` and its log. The review's recorded source hash precedes only the later accessible-name/live-status/autocomplete attributes; root checked those attributes with real browser locators at320 and390px and visually inspected the screenshots. No underlying auth logic changed after the independent review.
- A separate controlled browser run injected this candidate landing HTML on the public origin, submitted the exact internally provisioned QA account through the real hosted sign-in endpoint, verified its exact account identity and reached the actual `connect-sleeper.html` onboarding page without overflow or page errors. Other external writes were blocked. See `evidence/actual-public-signin-candidate-sep20.json`. This proves candidate-frontend/hosted-backend compatibility; it is not evidence that this landing page is deployed. No email was sent and no provider league or payment was mutated.

## Remaining boundaries

Real public signup with deliverable email, OAuth/provider completion, automatic session-repair account-switch races, full league connection/onboarding, physical keyboard/device behavior and whole-suite readiness remain open. This batch does not change backend signup policy, prices, account entitlements, or game rules. The configured GitHub identity has read access to the owning public repository; the candidate must be integrated and its served revision verified before claiming a public release.
