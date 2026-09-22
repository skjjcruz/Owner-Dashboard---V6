# Public MFL lineup cookie and callback recovery

Candidate branch `codex/public-mfl-lineup-20260920`, worktree `warroom-readiness-public-mfl-lineup`, base actual-public integration `d4d3540`. Production source scope: `js/tabs/lineup.js` only. Canonical MFL dependency: `3a18406` plus documented import-target correction `e290fd7` in `dhq-shared-readiness-mfl`. Canonical pin unchanged. No deployed change, real provider login, private credential or lineup mutation.

## Reproduced high-severity boundary failures

The actual original LineupTab restored `mfl_write_cookie` and host with no app-owner metadata. Switching A→B and reloading exposed A's write session as B's connected MFL login. The original asynchronous login callback also stored A's returned cookie after B had taken over. `tests/mfl-lineup-before.cjs` executes those exact original callbacks; both failures reproduce against `d4d3540`.

The card now restores a cookie only when its stored metadata matches the current app owner, selected season, cookie bytes and host. Unowned old cookies remain preserved but are unavailable until explicit reconnection. The new `mfl_write_context_v1` tab record contains cookie provenance; it is a secret container and must be cleared with `mfl_write_cookie`/host on sign-out and account transitions. The separate app/connect owner has this handoff.

Actual handlers capture account, selected league/season/franchise/week and current working lineup. Observed view changes remain invalidated even if the user returns to the earlier view. Login and submit have synchronous duplicate-request guards; they pass a current-context predicate through the real provider and recheck after completion. Old account/view callbacks cannot persist a cookie, publish success, or clear the newer identity's login. An in-flight old-view request blocks another request until it settles, with a visible waiting state.

Login storage writes verify all three records and attempt synchronous rollback. Failed storage leaves the username/password available for a deliberate retry and does not claim connected. Even failed rollback leaves an actionable error; incomplete records cannot restore a connected state. The password is never written to storage. A submission uses the viewed target and an owner-verified cookie; it no longer reads a possibly foreign global/flat API key. Unconfirmed/unknown provider results remain errors requiring a check on MyFantasyLeague, without automatic resubmission.

The actual MFL card has44px controls and16px inputs in narrow portrait and short landscape. Essential help/status/button text is14px. Disconnect is a keyboard-accessible button. No surrounding lineup/projection/paywall behavior changed.

## Verification evidence

-14 actual helper + production callback groups pass on Node20.20.2: ownership/season reload, unknown legacy preservation, late login, late write/account/lineup changes, duplicate requests, quota/rollback failure/retry, exact viewed target, unknown outcome and stale disconnect. `evidence/mfl-lineup/callbacks.log`.
-3 actual Chrome cases at320×740,390×844 and844×390 pass: actual production MFL card/hooks/helper plus actual canonical provider; outage→retained input→quota→retry→owned reload→unknown write→explicit recovery, B reload isolation and delayed login discarded after C takeover. No page exceptions or horizontal overflow. `chrome.log` and viewport screenshots. Surrounding projections/lineup selection are controlled fixture inputs; this is not full LeagueDetail or real-provider proof.
-Actual-public preview build71 scripts and broad198 checks pass; browser-source lint and `git diff --check` pass. Explicit shared source is required for the preview; no consumer pin was changed.
-`tests/mfl-lineup-before.cjs` is an intentionally failing-behavior reproduction, not a readiness pass. It reads exact old source from Git or `MFL_LINEUP_BASELINE`.

Independent product_inventory review is clear for this bounded delta after independently rerunning all14 groups. The reviewer reproduced a hidden Disconnect failure while the card stayed connected; the final code displays that error in both states, attempts all removals, and exposes Retry disconnect through partial failures and expired-provider cleanup. The new exact regression and actual Chrome flows cover failure→visible recovery→successful removal→reconnection. The reviewer also confirmed44px/14px Confirm/Cancel in landscape. Parent independently reviews canonical MFL changes.

## Still open — do not call MFL ready

-Canonical MFL `position.limit`/aggregate starter counts are still mapped incorrectly; arbitrary min/max constraints and lineup replacement completeness require a separate repair. This cookie batch does not validate optimizer legality or claim successful real lineup submission.
-Direct flat-key readers in public `league-detail.js`, `draft-room.js` and `draft/live-sync.js` remain queued in this lane; app/standalone connection handling is a separate native-agent batch. All must integrate before a full MFL account-isolation claim.
-Optional transactions/draft/future-pick failures still need truthful missing/stale coverage and pending-transaction semantics. MFL draftResults can lag15minutes; no live draft timing claim.
-Real provider ownership/write permissions, persistence reopening after a real submission, physical devices and deployed served assets remain unverified. All browser provider calls were intercepted and answered with synthetic data.
