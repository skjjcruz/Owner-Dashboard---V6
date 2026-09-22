# Public league-connection recovery — September20

Candidate for actual public Owner-Dashboard---V6, based on fac5d81/db1701f, in warroom-readiness-public-connect. This batch repairs the existing connection page and ESPN guest entry gate. It does not implement the separate missing ESPN hub hydration path or establish a real provider-account journey.

## Reproduced failures and correction

Ten of the original twelve actual-script checks failed on the baseline: repeated submission issued duplicate provider requests; delayed A responses wrote connection data after account B or sign-out; malformed provider identity was accepted; a failed profile save still produced connection success; an old page signed out B; stalled requests had no retry timeout; malformed IDs silently selected another ID; partial ESPN credentials fell through to public lookup; and navigation proceeded while another connection remained pending. Original evidence: evidence/public-connect-baseline-sep20.log.

Each provider operation now captures its inputs, locks duplicate submission, uses an abortable twenty-second request/body timeout, and verifies the original session/guest/legacy connection binding before saving or navigating. Expired, malformed, and mismatched token-owner/user sessions return to account repair; the client guard supplements server authorization. Failures preserve editable fields and useful retry messages. Validated local/session storage writes roll back their own partial changes, including failed sign-out cleanup, without overwriting a replacement account. Failed storage is not a connection or activation acknowledgement.

Sleeper identity requires a valid provider ID and username; MFL/ESPN league and season inputs must be exact numeric identifiers. Private ESPN needs both cookies and retains them only in session storage. Successful connection leaves the completed platform visible and brings the enabled Enter action into view. Inputs have accessible names and readable16px text; safe-area padding and live error status support phones. ESPN-only guests now pass the same index gate as the other offered platforms. Sign-out enters the existing reviewed landing signout flow so provider credentials cannot immediately restore the account.

## Verification

- Eighteen actual production-script groups and four touch-emulated Chrome configurations pass at320×740,390×844,844×390, and390×430. Evidence: evidence/public-connect-combined-sep20.log. Tests cover the actual twenty-second timeout, failure/retry, duplicate Enter, expired/owner-mismatched sessions, stale account and legacy writes, storage rollback, failed sign-out retry, concurrent providers, exact IDs, private proxy request/session-only secrets, reachable current action, stored choices and reopening.
- Browser requests use isolated provider responses and a controlled destination page. External analytics and unrelated writes are blocked. The page scripts and real touch/scroll interactions execute in Chrome; provider fixtures and the destination fixture do not prove a completed live league journey or real private ESPN cookie exchange.
- The existing public npm test suite and preview build pass using actual shared dedbb161. Final candidate build and independent follow-up disposition are recorded separately; no C2 shared engine was substituted.
- Original independent review found provider sign-out and unhealthy-session gaps. Both were fixed with exact regression coverage before freeze. Final independent review cleared3d2826e and independently reran all18actual-script groups plus allfourphonebrowserjourneys; see public-session-connection-independent-review.md.

## Remaining work and release boundary

Actual public app.js explicitly enables MFL and ESPN. MFL has an existing stored-connection hydration path; ESPN has enabled infrastructure but no automatic hydration and its old connector card is hidden. The connection page's local success therefore does not establish an ESPN league on the franchise board. That is a separate known primary-journey blocker to repair and test with current source decisions preserved. Broad account-scoped legacy profile/provider-cache migration, real public signup/email/OAuth, provider-owned test accounts, and physical keyboard/device checks also remain open.

Integrate with reviewed public landing012a897, preserving both test scripts and the landing ESPN/sign-out parity. Candidate publication does not change the hosted backend or apply SQL. Existing draft publicPR1 can carry the reviewed combination; current configured identity cannot merge into the actual owning repository. No frontend deployment, purchase, account provisioning, email, or real provider mutation occurred in this lane.
