# DHQ Matchup Formula (version 1)

DHQ projected points for one player in one week. Shown beside Sleeper's number, never in place of it.

## The formula

    DHQ points = baseline × role × health × opponent × game × coaching × h2h × trench × trend × teamContext × luck

- **Baseline** is Sleeper's published line scored through the league's rules. When Sleeper has none, the engine's own estimate from season stats is used and labeled as an estimate.
- Each factor is a score from -1 (worst) to +1 (best), turned into a multiplier: `1 + score × weight/100 × 0.5`.
- A factor with no data scores 0 and is listed under "missing" so the owner can see what the grade did not know.
- A ruled-out or bye player projects 0 and is marked out.

## The factors

| Factor | Weight | Max swing | What feeds it |
|---|---|---|---|
| Role and opportunity | 22 | ±11% | Depth-chart slot, snap and target share |
| Health | 14 | ±7% | Injury tag, practice report, weeks since return |
| Opponent vs position | 14 | ±7% | Defense rank vs this position (offense rank vs IDP) |
| Game environment | 12 | ±6% | Implied total, spread, home/away/overseas, weather |
| Coaching staff | 8 | ±4% | Staff score, this team vs the opponent |
| Head-to-head history | 8 | ±4% | Team-vs-team record and margin, division counts more |
| Trench edge | 8 | ±4% | Offensive line vs defensive line, from the player's side |
| Trend line | 8 | ±4% | Last three weeks vs season average |
| Team context | 3 | ±1.5% | Quarterback grade, team record |
| Luck and regression | 3 | ±1.5% | Touchdown rate vs a sustainable rate |

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

- `js/shared/matchup-engine.js` is the math. It never fetches data.
- `js/shared/matchup-engine.test.js` proves the math. Run `node --test js/shared/matchup-engine.test.js`.
- Feeds that build the inputs from Sleeper, ESPN and the PFF snapshot come next.
