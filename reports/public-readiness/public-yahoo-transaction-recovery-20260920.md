# Actual-public Yahoo trade availability and retry

Status: paired local consumer candidate from actual-public `a980bfc`, pending independent review. Canonical producer is `/Users/jacobc/Projects/dhq-shared-readiness-yahoo-transactions` from `f72c8e4`. No app.js, global-view.js, provider endpoint, consumer pin or deployment workflow changed.

The existing TransactionFeed boundary now handles Yahoo and ESPN explicitly. Both require matching provider/league/year, completed-trade scope and usable status metadata; missing/old producer metadata is unavailable. Untagged legacy LI history cannot fill a Yahoo outage or import another league's history. Ready, stale and unavailable remain distinct, and the UI labels each provider accurately. Confirmed empty Yahoo responses say no completed trades were returned, not no transactions ever occurred. Free Agency's ticker no longer labels this trade-only source as adds/drops.

LeagueDetail captures Yahoo's account/session/selected league context when the view is created. Retry remains single-flight, uses the existing transactionsOnly load path and cannot adopt a different account. Supersession displays the existing full-page league recovery view with back navigation. Background partial success applies truthful data then rejects the full-sync promise so last-sync metadata cannot claim a complete refresh. ESPN's existing guards and executed-only semantics remain intact.

## Evidence

- **11 actual Yahoo caller/UI groups** pass: actual mapper→publication→ticker, actual Trade Center received/sent asset helpers, unavailable/stale/ready/empty, metadata/row validation, other-provider compatibility, mounted provider-context retry guard and actual recovery-loader isolation from private follow-up jobs.
- **Chrome320×740,390×844,844×390**: actual canonical Yahoo provider→actual publication block/retry callback→actual ticker/details, plus actual error-view code. First503 differs from verified empty; reachable retry loads real normalized fixture assets; failed refresh retains labeled stale rows; confirmed empty clears them; details open/close; reload makes no fabricated cached success; account replacement issues no retry request and hides old rows behind recovery/back navigation. No horizontal overflow or page errors. [Results](evidence/yahoo-transactions/result.json), [320 stale](evidence/yahoo-transactions/320-stale.png), [short landscape](evidence/yahoo-transactions/844-stale.png).
- Existing **18 ESPN provider**, **10 ESPN caller**, and **3 ESPN Chrome viewport** cases pass unchanged. **16 public ESPN hub** checks pass.
- Existing **198 npm tests** pass; explicit shared-source preview compiles **71 scripts**, including a supported **Node20.20.2** build. ESLint has zero errors and the same two prior unused-variable warnings (`faColPreset`, `buildDhqStarterSet`). [Logs](evidence/yahoo-transactions/).
- Independent review requested from parent; pending at this commit. Native agent inspected320 stale screenshot for readable status and reachable44px retry.

Browser data and account credentials are disposable fixtures. Provider requests are intercepted and limited to read-only `action:api`; other external traffic aborts. This is not a real Yahoo-authenticated LeagueDetail journey, whole product readiness, physical-device evidence or a served deployment.

## Follow-through and release boundaries

Run `npm run test:yahoo-transactions` after `DHQ_SHARED_SOURCE=/Users/jacobc/Projects/dhq-shared-readiness-yahoo-transactions npm run sync:shared`; test fixture source is configurable with `YAHOO_SHARED_SOURCE`. Both producers use the same existing completed-trade status contract. Old Yahoo shared bytes fail visibly as unavailable; they cannot be labeled confirmed empty.

Root must integrate/pin the reviewed final shared union and review the actual release candidate. No final pin or Yahoo served-asset gate manifest was regenerated here. The active Scout legacy connect path still needs its separate authorized adaptation; the actual-public Trade Center's independent trade-history loading and downstream intelligence consumers remain outside this pair. Real private-provider credentials and ordinary authored Yahoo transaction evidence remain unavailable. No provider deployment or other hosted mutation occurred.
