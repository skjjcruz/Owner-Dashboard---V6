// ══════════════════════════════════════════════════════════════════
// player-brief.js — the DHQ Composer (WR.PlayerBrief)
//
// Phase 1 of the Player Summary initiative. Composes a current, written,
// paragraph-length brief for EVERY player — the universal base layer the
// player card renders for 100% of players. Later phases stack richer
// sources (Rotowire/ESPN journalism, Alex's AI read) on top; this layer
// is the guarantee that no card ever opens without a real summary.
//
// Design (matches the house FLOOR pattern — deterministic, always works):
//   • Pure function over live data the app already holds (Sleeper player
//     record, DHQ value/meta, current + career PPG). Built at render time,
//     so it is current by construction and can never be missing or stale.
//   • Adaptive sentences: each sentence renders only when its data exists,
//     but identity + outlook always render — so even a name-and-position
//     stub yields a readable paragraph. No 'undefined', no NaN, ever.
//   • No AI, no network, no cache. Composition is deterministic: the same
//     input always produces the same paragraph.
//
// Plain JS (no JSX) so the contract suite can run it in a bare VM sandbox,
// the brief-pulse.js pattern. Exposed as window.WR.PlayerBrief.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (typeof window !== 'undefined') window.WR = window.WR || {};

    // ── Small safe formatters ────────────────────────────────────────
    function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
    function fmt1(v) { v = num(v); return v == null ? null : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, ''); }
    function fmtInt(v) { v = num(v); return v == null ? null : Math.round(v).toLocaleString(); }
    function ordinal(n) {
        n = num(n); if (n == null) return null;
        var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    function seasonWord(yearsExp) {
        var y = num(yearsExp);
        if (y == null) return null;
        if (y <= 0) return 'his rookie season';
        return 'his ' + ordinal(y + 1) + ' NFL season';
    }

    // Team display: Sleeper stores the abbreviation; a null team is a free agent.
    function teamPhrase(team) { return team ? String(team) : null; }

    // ── compose(input) → { text, sentences } ────────────────────────
    // input (all optional except it should carry what it has):
    //   player     — Sleeper player record (full_name, team, position, age,
    //                years_exp, college, depth_chart_order, injury_status,
    //                injury_body_part, injury_notes, practice_participation,
    //                status)
    //   pos        — normalized position (falls back to player.position)
    //   dhq        — DHQ value (number)
    //   meta       — engine playerMeta (ageCurvePhase, peakYrsLeft, roleLabel,
    //                opportunityLabel, opportunityBlockers, statusReason,
    //                lastYearPPG, careerPPG, starterSeasons, recentGP, trend)
    //   ppg        — current-scope PPG (league-scored)
    //   posRank    — rank at position by DHQ (1-based), posTotal — pool size
    //   phaseLabel — Rising | Prime | Veteran | Post-Window (card's age read)
    //   peakYrs    — peak years remaining
    function compose(input) {
        input = input || {};
        var p = input.player || {};
        var meta = input.meta || {};
        var pos = String(input.pos || p.position || 'player').toUpperCase();
        var name = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'This player';
        var last = p.last_name || name.split(' ').slice(-1)[0] || name;
        var age = num(p.age);
        var team = teamPhrase(p.team);
        var isK = pos === 'K';
        var sentences = [];

        // ── S1 · Identity + role ─────────────────────────────────────
        // depth_chart_order is 1-based on Sleeper (1 = the starter).
        var slot = num(p.depth_chart_order);
        var slotLabel = (slot != null && slot >= 1) ? (pos + slot) : null;
        var s1 = name;
        if (team && slotLabel) s1 += ' sits ' + (slot === 1 ? 'atop the depth chart as ' : 'at ') + slotLabel + ' for ' + team;
        else if (team) s1 += ' is on the ' + team + ' roster';
        else s1 += ' is currently an unsigned free agent';
        var idBits = [];
        if (age != null) idBits.push(age + ' years old');
        var sw = seasonWord(p.years_exp);
        if (sw) idBits.push('entering ' + sw);
        if (p.college && num(p.years_exp) != null && p.years_exp <= 2) idBits.push('out of ' + p.college);
        if (idBits.length) s1 += ' — ' + idBits.join(', ');
        sentences.push(s1 + '.');

        // ── S2 · Production ──────────────────────────────────────────
        var ppg = num(input.ppg) || num(meta.ppg);
        var career = num(meta.careerPPG);
        var lastYr = num(meta.lastYearPPG);
        var trend = num(meta.trend);
        if (ppg && ppg > 0) {
            var s2 = 'He’s producing ' + fmt1(ppg) + ' points per game in this league’s scoring';
            if (career && career > 0 && Math.abs(career - ppg) >= 0.1) {
                s2 += ppg >= career
                    ? ', ahead of his ' + fmt1(career) + ' career mark'
                    : ', off his ' + fmt1(career) + ' career pace';
            }
            if (trend && Math.abs(trend) >= 8) {
                s2 += trend > 0
                    ? ', with production trending up about ' + Math.round(Math.abs(trend)) + '% year-over-year'
                    : ', with production down about ' + Math.round(Math.abs(trend)) + '% year-over-year';
            }
            sentences.push(s2 + '.');
            var gp = num(meta.recentGP);
            var seasons = num(meta.starterSeasons);
            if (seasons && seasons >= 2 && gp != null) {
                sentences.push('He’s logged ' + seasons + ' starter-level season' + (seasons === 1 ? '' : 's') + (gp >= 15 ? ' and has stayed on the field, playing ' + gp + ' games in the last year' : gp > 0 ? ', appearing in ' + gp + ' games over the last year' : '') + '.');
            }
        } else if (lastYr && lastYr > 0) {
            sentences.push('He averaged ' + fmt1(lastYr) + ' points per game last season and is still looking to lock in a role this year.');
        } else {
            sentences.push('He has no meaningful NFL production on file yet, so his value rides on pedigree, athletic profile, and landing spot rather than results.');
        }

        // ── S3 · Health (only when something is flagged) ─────────────
        var inj = p.injury_status ? String(p.injury_status) : '';
        if (inj) {
            var s3 = 'Health is a live concern: he’s listed as ' + inj + (p.injury_body_part ? ' (' + String(p.injury_body_part).toLowerCase() + ')' : '');
            var note = p.injury_notes ? String(p.injury_notes).trim() : '';
            var prac = p.practice_participation ? String(p.practice_participation).trim() : '';
            if (note) s3 += ' — ' + note.replace(/\.$/, '');
            else if (prac) s3 += ', ' + prac.toLowerCase() + ' in practice';
            sentences.push(s3 + '.');
        }

        // ── S4 · Market value ────────────────────────────────────────
        var dhq = num(input.dhq);
        var rank = num(input.posRank), total = num(input.posTotal);
        var phase = input.phaseLabel || meta.ageCurvePhase || '';
        var peakYrs = num(input.peakYrs) != null ? num(input.peakYrs) : num(meta.peakYrsLeft);
        if (dhq && dhq > 0) {
            var s4 = 'The DHQ engine prices him at ' + fmtInt(dhq);
            if (rank && total) s4 += ' — ' + pos + rank + ' of ' + total + ' in this league’s format';
            if (phase) {
                var phaseTxt = phase === 'Rising' ? 'still on the rising side of his age curve'
                    : phase === 'Prime' ? 'squarely in his prime window'
                    : phase === 'Veteran' ? 'on the veteran back half of his curve'
                    : phase === 'Post-Window' ? 'past his positional age window' : '';
                if (phaseTxt) s4 += ', ' + phaseTxt;
            }
            if (peakYrs != null && peakYrs > 0 && phase !== 'Post-Window') s4 += ' with roughly ' + peakYrs + ' peak year' + (peakYrs === 1 ? '' : 's') + ' left';
            sentences.push(s4 + '.');
        } else {
            sentences.push('The DHQ engine carries no market value for him right now, which itself is the signal — he’s off the trade radar until production or opportunity says otherwise.');
        }

        // ── S4b · Market pulse (Phase 3, FantasyCalc — only when provided) ──
        // input.market = { value, trend30Day } from the daily FantasyCalc pull.
        var mkt = input.market;
        var mv = mkt && num(mkt.value), mt = mkt && num(mkt.trend30Day);
        if (mv && mv > 0 && mt != null) {
            var pct = (mt / mv) * 100;
            if (Math.abs(pct) >= 1) {
                sentences.push('The dynasty market agrees it’s moving: his FantasyCalc price is ' + (pct > 0 ? 'up' : 'down') + ' about ' + Math.abs(Math.round(pct)) + '% over the last 30 days.');
            } else {
                sentences.push('The dynasty market has his price holding steady over the last 30 days.');
            }
        }

        // ── S5 · Outlook / verdict ───────────────────────────────────
        // When the caller passes the CANONICAL engine action (getPlayerAction —
        // the single source of truth behind the Roster Call chip, the card's
        // Action cell, and Compare), the closing sentence keys off it so the
        // brief can never contradict the chip on the same screen. The phase
        // heuristics below remain the fallback when no action is supplied.
        var act = input.action && input.action.action && String(input.action.reason || '') !== 'Not enough data'
            ? input.action : null;
        var s5;
        if (meta.statusReason) {
            s5 = 'The situation to know: ' + String(meta.statusReason).replace(/\.$/, '') + ' — price any move around that reality';
        } else if (isK) {
            s5 = 'As a kicker he’s a streamable piece, not a dynasty asset — plug him in when the matchup is right, but don’t spend trade capital here';
        } else if (act) {
            var fam = String(act.action).toUpperCase();
            var actPhrase = fam === 'CORE' ? 'build around him — it takes an overpay, not an offer, to move a piece like this'
                : fam === 'BUY' ? 'buy — move before the market reprices him'
                : fam === 'SELL_HIGH' ? 'sell high — cash him out while the market still pays full price'
                : fam === 'SELL' ? 'sell — move him while there’s still value to collect'
                : fam === 'STASH' ? 'stash — cheap to hold, with room to pay off'
                : 'hold';
            var why = String(act.reason || '').trim().replace(/\.$/, '');
            if (/^[A-Z][a-z]/.test(why)) why = why.charAt(0).toLowerCase() + why.slice(1);
            s5 = 'The DHQ call is ' + actPhrase + (why ? ' (' + why + ')' : '');
        } else {
            var blockers = Array.isArray(meta.opportunityBlockers) ? meta.opportunityBlockers.filter(Boolean) : [];
            var role = meta.roleLabel ? String(meta.roleLabel) : '';
            var opp = meta.opportunityLabel ? String(meta.opportunityLabel) : '';
            // A depth-chart starter (slot 1, or a role label ending in "1" like
            // RB1/ROLB1) must never read as a "stash whose role hasn't come" —
            // that contradicts the identity sentence. Young cheap starters get
            // ascending-starter framing instead.
            var isStarter = (slot != null && slot === 1) || /(^|[^0-9])1$/.test(role);
            if (phase === 'Post-Window') s5 = 'At this stage he’s a production-only piece — whatever he gives you this season is the value, so treat him as a win-now rental, not a hold';
            else if (phase === 'Veteran') s5 = 'His dynasty value is tied to the near term — a win-now contributor whose price will only drift down, so contenders should use him and rebuilders should shop him';
            else if (phase === 'Rising' && dhq && dhq >= 4000) s5 = 'He’s an ascending asset — the kind of player whose price climbs faster than his production, which makes the buy window now and the hold easy';
            else if (phase === 'Rising' && isStarter) s5 = 'He’s already a starting piece with his age curve still climbing — young starters at his price tend to outrun their tag, so treat him as a buy before the production reprices him';
            else if (phase === 'Rising') s5 = 'He profiles as a developmental stash — cheap to hold, with the age runway to pay off if the role comes';
            else if (dhq && dhq >= 7000) s5 = 'He’s a core piece — the roster builds around players like this, and it takes an overpay, not an offer, to move him';
            else if (dhq && dhq >= 3000) s5 = 'He’s a solid contributor with real trade utility — strong enough to start, liquid enough to package when a consolidation move appears';
            else s5 = 'He’s a depth piece for now — roster-worthy in deep formats, but the market won’t pay much until the role or the production moves';
            var extra = [];
            if (role) extra.push(role.charAt(0).toLowerCase() + role.slice(1));
            if (blockers.length) extra.push('the path runs through ' + blockers.slice(0, 2).join(' and '));
            else if (opp && !role) extra.push(opp.charAt(0).toLowerCase() + opp.slice(1));
            if (extra.length) s5 += ' (' + extra.join('; ') + ')';
        }
        sentences.push(s5 + '.');

        var text = sentences.join(' ')
            .replace(/\s+/g, ' ')
            .replace(/undefined|NaN/g, '')
            .trim();
        return { text: text, sentences: sentences, name: name, lastName: last };
    }

    // ── posRank(pid, playersData, playerScores, normPos) ─────────────
    // 1-based DHQ rank within the player's normalized position + pool size.
    // Cheap single pass; callers memoize per card open.
    function posRank(pid, playersData, playerScores, normPosFn) {
        try {
            if (!pid || !playersData || !playerScores) return null;
            var me = playersData[pid];
            if (!me) return null;
            var norm = typeof normPosFn === 'function' ? normPosFn : function (x) { return x; };
            var myPos = norm(me.position) || me.position;
            var myVal = playerScores[pid] || 0;
            if (!myPos || !(myVal > 0)) return null;
            var better = 0, total = 0;
            for (var id in playerScores) {
                var v = playerScores[id];
                if (!(v > 0)) continue;
                var rec = playersData[id];
                if (!rec) continue;
                if ((norm(rec.position) || rec.position) !== myPos) continue;
                total++;
                if (v > myVal) better++;
            }
            return total > 0 ? { rank: better + 1, total: total } : null;
        } catch (_) { return null; }
    }

    var api = { compose: compose, posRank: posRank };
    if (typeof window !== 'undefined') window.WR.PlayerBrief = api;
})();
