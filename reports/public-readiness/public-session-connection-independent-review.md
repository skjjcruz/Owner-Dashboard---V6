# Independent public session and connection review — 2026-09-20

Read-only source review and isolated local tests of actual public source candidates. No real sign-in, provider mutation, private league request, payment or release was performed in this review. Root owns integration and deployment. Browser screenshots were redirected to `/tmp/public-connect-independent-{320,390}-sep20.png`, preserving the reviewed branch.

## Session lifecycle `012a897`

Reviewed `landing.html` and actual-script lifecycle regression against the public `fac5d81` base. Reproduced a material mismatch: the head redirect accepted token owner A with cached user B, while the body repair preferred B. The final head checks owner/expiry, and repair prefers the token's owner and rejects a different returned account. Exact standalone reproduction passes after the fix.

Independently ran all 26 lifecycle groups: late OAuth/refresh/provider navigation cannot overwrite the replacement account; old analytics completion cannot reset a newer profile; failed/expired/revoked repair is truthful; authoritative user metadata is preserved; forced sign-out captures the old provider token and avoids asynchronous SDK cleanup of a new account. The final provider storage-key listener supersedes an old attempt when another tab selects a provider account, without treating same-document SDK writes as a cross-tab account change.

The final ESPN/fresh-account delta was independently checked: guest and signed-in routing agree on the ESPN pointer, `isNew` handoff cannot be diverted by a stale guest flag, and fresh context cleanup removes ESPN pointers/cookies in local and session storage plus the old MFL API key. No unresolved blocker found within this bounded delta. Broad legacy profile ownership and real provider callback/refresh journeys remain separate.

## Connection `3d2826e`

Reviewed `connect-sleeper.html`, the index guest-routing parity change, VM tests and guarded browser fixture. Found and resolved two material issues before freeze: sign-out now enters `landing.html?signout` so a lingering Supabase session cannot immediately sign the user back in; both connection entry and post-await saves validate token expiry and token/cache owner consistency.

Independently reran all 18 actual-script groups, covering provider validation and retries, duplicate submission, pending Enter, changed account/legacy binding, saved local data and failed sign-out rollback/retry. Independently ran the actual page in Chrome at 320×740, 390×844, 844×390 and 390×430. All four journeys passed: real 20-second timeout on the narrow phone, retained input and retry, stale A response leaving B unchanged, private ESPN credentials only in session storage, no horizontal overflow, automatically visible Enter action, save and reopen. Screenshot inspection confirms the connected platform stays visible and Enter is reachable.

All nonlocal requests are intercepted with explicit controlled provider responses or aborted; the index destination is a fixture. This verifies the connection page and route intent, not actual ESPN/MFL hydration or full authenticated application readiness. Those limitations are correctly stated in the candidate report. No unresolved material finding in the reviewed connection-page batch.

## Build dependency follow-up

Read-only review of the isolated `warroom-readiness-public-dev-deps` lockfile change: only `brace-expansion` 5.0.7 → 5.0.12 and its matching integrity/Node engine requirement changed. The declared minimatch range and package.json remain unchanged. Actual CI/deploy both run Node 20, supported by the new dependency. Independently ran `npm audit` and observed zero reported vulnerabilities. The two upstream advisories confirm that the old version is affected and that the selected version is beyond both patched floors: [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895). No material finding in this scoped dev dependency update; author separately provided clean-install, Node 20 test/build evidence.
