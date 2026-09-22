# Public ESPN provider follow-through

Source base: hub recovery `df769648608e0c17ca1764229b42c723a6be313b`. This follow-up adds only an `isCurrent` lifecycle callback to the foreground and background `LeagueDetail` hydration options plus actual-provider integration evidence. Shared `espn-api.js` changes live separately in `dhq-shared-readiness-espn`, branch `codex/readiness-espn-boundaries-20260920`, frozen at `d45b5f571d2508ae97163250dc89f8d1af52ce1c` from canonical `dedbb161`; no shared copies or consumer pin changes are committed here.

The shared correction rejects a different raw season/league, fences private requests to the captured account/token/connection/cookies, and stops follow-ups after invalidation. This caller adds same-account load-sequence/view cancellation. The original hub result guard alone could not prevent an unsafe request that had already occurred inside the provider.

Verification against explicit candidate shared bytes:

- **16 actual-source groups**, including actual `loadLeagueDetails` plus the real canonical provider (valid selected team, foreign season, app-account switch, closed view). Invalid paths do not publish and do not start the private transaction follow-up. [Source log](evidence/espn-provider-caller-source.log).
- Real Chrome hub journeys pass at **320×740, 390×844, 844×390**. Actual hub and mapper; LeagueDetail rendering remains an explicit handoff fixture. [Browser results](evidence/espn-provider-caller-browser.json).
- Existing **198 tests** and preview build pass with `DHQ_SHARED_SOURCE=/Users/jacobc/Projects/dhq-shared-readiness-espn` on Node20.20.2. [Tests](evidence/espn-provider-caller-existing.log), [build](evidence/espn-provider-caller-build.log).
- Focused ESLint has no errors; only the preexisting `buildDhqStarterSet` unused-function warning remains. [Lint](evidence/espn-provider-caller-lint.log).

The runtime fixture now supplies the browser's standard AbortController because the shared provider bounds its requests. Assertions are not weakened. No actual provider/account/backend operation or deployment occurred.

The original hub improvement may be integrated separately with explicit downstream holds. This lifecycle callback is compatible with the old provider, but closing the reproduced provider failures requires the **reviewed shared correction in served consumer assets**. Root must coordinate canonical integration and consumer deployment; this work does not advance a pin or claim deployment.

Full LeagueDetail rendering, actual provider accounts/historical payloads, generic transaction-outage truthfulness, legacy record ownership and downstream intel/tag/docs/tutorial callbacks remain outside the repaired evidence boundary. The independent review findings are recorded in report-only `8caf247`; the new actual-provider cases establish their bounded local correction, not whole ESPN readiness.
