# DHQ Matchup Formula (version 2, 2026-10-12)

DHQ projected points for one player in one week. Shown beside Sleeper's number, never in place of it.

## The formula

    DHQ points = baseline × role × health × opponent × game × coaching × h2h × trench × trend × cast × oppHealth × luck

- **Baseline** is DHQ's own stat line (`dhq-baseline.js`): volume from the role projection (targets, touches, attempts), efficiency pooled from the last three weeks (counted double), this season and last season, pulled toward the position norm by phantom opportunities, tilted by PFF grades. Sleeper's line is the baseline only when `baselineMode` is not `dhq`.
- Each factor is a score from -1 (worst) to +1 (best), turned into a multiplier: `1 + score × weight/100 × 0.5`.
- A factor with no data scores 0 and is listed under "missing" so the owner can see what the grade did not know.
- A ruled-out or bye player projects 0 and is marked out. Questionable trims the whole line by 8%.

## The factors (weights with the DHQ baseline)

| Factor | Weight | Max swing | What feeds it |
|---|---|---|---|
| Role and opportunity | 12 | ±6% | Depth-chart slot, snap and target share (most of it already lives in the baseline's volume) |
| Health | 11 | ±5.5% | Injury tag, practice report, weeks since return |
| Opponent vs position | 18 | ±9% | Defense rank vs this position, blended from four views |
| Game environment | 12 | ±6% | Implied total, spread, home/away/overseas, weather |
| Coaching staff | 8 | ±4% | Staff score, this team vs the opponent |
| Head-to-head history | 8 | ±4% | Team-vs-team record and margin, division counts more |
| Trench edge | 8 | ±4% | Offensive line vs defensive line, from the player's side |
| Trend line | 8 | ±4% | Last three weeks vs season average |
| Supporting cast | 6 | ±3% | Quarterback grade, team record |
| Opponent health | 6 | ±3% | Who the defense is missing |
| Luck and regression | 3 | ±1.5% | Touchdown rate vs a sustainable rate |

With Sleeper as the baseline the weights are `WEIGHTS` in `matchup-engine.js` (role 18, opponent 12, game 10, cast 8).

## Volume: the role projection

A player's share of his team's ball (targets for WR/TE, carries plus targets for RB, attempts for QB) blends what he has **earned** this season (60% last three weeks, 40% season) with a **base** (his own last season at 85%, the depth-chart slot norm at 15%). The earned share gets more say with every game: 30% before his first, 45% after one, 60% after two, 85% from three on.

The shares of a position room are summed and scaled down to the room's cap (backfields 48% of touches, receivers 60% of targets, tight ends 24%). Since 2026-10-12 the **guessed** part of each share (the slot norm) gives way first; a man's **measured** usage (this season's, and his last season's until this season's third game) is cut only when the measured shares alone overflow the cap by more than 10%. Replay of weeks 1-5 2026: before that, a starter's share paid for his bench's depth-chart guesses (Jeanty, week 1: cut 16%).

The team's pie is its per-game ball this season, blended with four phantom games of last season's pace, tilted by the spread.

## Shown week vs typical week

The roster row shows the **average week** (owner ruling 2026-10-12). The engine also carries a **typical week**: the average with the touchdown skew taken off (three quarters of a receiver's expected TD points, sliding to a quarter at 9+ targets; a Poisson skew term for backs; 60% of a lineman's splash plays). The typical week is graded in the Lab's closeness audit and sets the floor; lineups and totals add up the average. Replay of weeks 1-5 2026: the typical week sat 0.9 (RB) to 1.5 (TE) points under what happened, every week, while Sleeper's line and the L8 column beside it are averages.

## Grades

| Total multiplier | Grade | Quick read |
|---|---|---|
| 1.12 and up | A | start |
| 1.05 to 1.12 | B | start |
| 0.96 to 1.05 | C | flex |
| 0.88 to 0.96 | D | sit |
| below 0.88 | F | sit |

The lineup optimizer still makes the final start/sit call. The grade is the quick read on a roster row.

## Files

- `js/shared/matchup-engine.js` is the math. It never fetches data. `node --test js/shared/matchup-engine.test.js`
- `js/shared/dhq-baseline.js` builds the stat line. `node --test js/shared/dhq-baseline.test.js`
- `js/shared/matchup-inputs.js` builds the inputs from Sleeper, ESPN and the PFF/usage snapshots; `TUNE` at the top holds every calibrated number, overridable through `window.__DHQ_TUNE` for the test bed. `node --test js/shared/matchup-inputs.test.js`
- `scripts/build-projections-lock.mjs` locks each week's projections before kickoff (`data/locks/`); rows are `[shown, Sleeper, average, typical]`.
- `scripts/backtest-projections.mjs` replays past weeks with any `DHQ_TUNE` / `DHQ_NORM` override, caching every fetch; `scripts/compare-backtests.mjs` is the scorecard (bias, MAE, how often DHQ beats Sleeper, by position, tier and week).
