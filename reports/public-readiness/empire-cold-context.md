# Empire values in explicit league context

2026-09-20. Branch `codex/public-empire-engine-20260920`, based on actual-public `d4d3540`. Production changes are confined to `js/public-empire.js` and `js/tabs/global-view.js`. No app bootstrap, canonical source, shared pin, provider data, backend or deployment was changed.

Source candidate: `67cfdd6b6d00ffdc2cd855bb44c721330a24d7f2`. Deployment state: local only; independent consumer review and root integration pending.

## Reproduced and repaired

**HIGH — cold Empire had no team reads, and a warm Empire reused the active league's values for other leagues.** The actual baseline coordinator required `App.LI_LOADED` and called the generic assessment API; the model priced every holding with one `input.scores` map. The regression executes `d4d3540` and demonstrates both the missing cold assessment and a foreign active value accepted for an owned holding. [Original failure and regression evidence](evidence/empire-cold-context/consumer-regression.log).

The coordinator now calls the reviewed named `loadLeagueIntelContext` and `assessAllTeamsWithContext` capabilities with the selected league's rosters, scoring, format, season, verified draft rights, public player catalog, and a separately verified NFL season context. It never installs portfolio input or results into active `S`, `LI` or `DhqBrain`. An older shared bundle lacks these capability names and produces a visible retry state instead of invoking an API that could ignore the explicit context.

Value and assessment results live behind an account- and input-bound WeakMap. Rendering, owner reads and move pricing cannot adopt a prior account's ready results or results whose roster/scoring context changed. Cancellation and timeout remain sticky for late engine work. Settings/rosters are copied into the canonical input without the computed Empire object graph. Returned league ID, season and finite nonnegative values are validated before publication.

Each holding, province and buy candidate now uses its own league's map. Unknown values remain `null`; known zero and known empty roster values stay zero. Missing values cannot create a fabricated asset rank. Repeated-player detail shows the mean, range and known holding count; the index discloses its mean across available league contexts. The established Scout Board rule of showing the highest league value for each player is preserved and labeled. No player valuation, assessment, trade-premium, one-brain or injured-player formula was changed.

**MEDIUM — 320-pixel header collision.** The first-screen review showed the title overlapping the data badge, with flex shrink reducing the Back control below its touch target. The phone header now wraps its status/action row and preserves a 44-pixel Back control. The actual browser matrix asserts non-overlap and the narrow control dimensions.

## Verification

Canonical source used for build and actual-module/browser checks: `782eb0157b3fb5bfd94d7650a358c33ae81f4512` in `dhq-shared-readiness-integrated`, including the reviewed explicit engine/assessment capabilities. Root owns the coordinated shared pin/release.

- [14 new consumer groups](evidence/empire-cold-context/consumer-regression.log): baseline reproduction, cold calls, target-league buy price, duplicate holding mean/range, zero/empty handling, absent capability, malformed/foreign output, stale ready data, changed inputs, delayed response, timeout, season/source failure, and real canonical engine/assessment comparison. The actual canonical test uses different QB scoring and superflex settings, verifies distinct QB values, exact per-league assessment totals, retained injured-player value, and unchanged active bridge.
- [17 existing Empire evidence groups](evidence/empire-cold-context/existing-evidence.log) pass, including remaining rights, same roster IDs across leagues, malformed/failed stats, transaction/DNA truth and bootstrap cancellation.
- [Broad test command](evidence/empire-cold-context/broad.log): all 198 checks pass. The pure model fixture now supplies explicit per-league contexts; its prior allocation/exposure/age/missing-value assertions remain.
- [Preview build](evidence/empire-cold-context/build.log): 71 scripts compiled against the explicit canonical source.
- [Actual public Empire + canonical engine/assessment Chrome matrix](evidence/empire-cold-context/browser/result.json), [execution log](evidence/empire-cold-context/browser.log): 320×740, 390×844, 844×390. NFL-context outage remains unavailable; Retry cold-builds two leagues with distinct scoring, preserves `S`/`LI`, opens the correct league, survives reload, and cancels after account replacement. No horizontal overflow. All external GETs were controlled fixtures; all other external operations were blocked. [320 first screen](evidence/empire-cold-context/browser/320-first-screen.png), [390 first screen](evidence/empire-cold-context/browser/390-first-screen.png).
- [Existing rights/recovery Chrome matrix](evidence/empire-cold-context/rights-browser.log): three viewports pass unknown-rights detail, corrected draft horizon, denominator, retry, handoff and interruption.

Reproduce from this worktree:

```sh
EMPIRE_SHARED_SOURCE=/Users/jacobc/Projects/dhq-shared-readiness-integrated node tests/public-empire-engine.cjs
node tests/public-empire.cjs
DHQ_SHARED_SOURCE=/Users/jacobc/Projects/dhq-shared-readiness-integrated npm run build:preview
EMPIRE_SHARED_SOURCE=/Users/jacobc/Projects/dhq-shared-readiness-integrated node tests/public-empire-engine-browser.cjs tmp/public-empire-engine-browser
node tests/public-empire-browser.cjs
npm test
```

## Open launch gates and next steps

This closes the bounded cold-start/foreign-value dependency, **not Empire launch readiness**. UI explicitly calls these calculated reads provisional and the DHQ quality status remains partial. Independent review of this consumer batch is pending.

1. **HIGH — canonical input coverage/outage behavior:** the existing engine still swallows some historical-stat, draft/transaction, ledger and market failures. It does not expose enough complete source status for this consumer to certify every calculated value. Reproduce and preserve last-good/source status in the canonical implementation; only then promote the UI from provisional. Do not equate a fulfilled engine promise with verified current data.
2. **HIGH — historical and seasonal advice:** this consumer deliberately does not run a dynasty cold build for redraft/keeper, non-Sleeper providers or a league whose season differs from the verified current NFL season. Their existing holdings/rights remain visible with unavailable value/read status. Faithful seasonal health/needs and the canonical historical in-season interpretation remain required, not optional.
3. **HIGH — active-global action shield:** `buildEmpireMoves` still consults canonical `getPlayerAction` for its existing sell guard. That helper depends on active global metadata, manual calls and GM strategy; a separate explicit-context capability is needed to preserve those accepted rules for every portfolio league. Full Player Card and legacy grudge/saved-AI pathways also need their already documented ownership/context checks. No broad AI or action-context claim is made here.
4. Measure cold-engine latency with a realistic full catalog and provider failure/retry behavior. The current bounded timeout reports failure truthfully and prevents late continuation; the controlled fixture timing does not prove practical live performance.
5. Root must integrate/review this branch, update shared/script release metadata coherently, and verify the actual supported Empire destination. No live, authenticated real-league, native-install or physical-device evidence is added by these fixtures.

The canonical current market-engine switch, one-brain policy and injury handling remain untouched. Root's source review and final integrated/release checks are the next integration gates.

20:06UTC root independent review: source67cfdd6 reviewed and all14 actual consumer groups +3 actual UI/canonical Chrome viewports rerun independently, all pass. Inspected320 first-screen rendering. No unresolved material finding within the bounded per-league consumer fix. Broader open launch gates above remain. Integrated source8ed3fda is documented in `integrated-mfl-empire-20260920.md`; no release/pin claim.
