// ══════════════════════════════════════════════════════════════════
// js/shared/waiver-tools.js — window.App.WaiverTools
//
// The pure half of the Free Agency waiver tools (C2 wave port, 2026-09-27).
// Everything here is deterministic and Node-testable; js/free-agency.js owns
// the rendering. Four reads, each built so it cannot say more than the data:
//
//   bidEvidence(txns, league, pos, playersData)
//       The league's own COMPLETED winning FAAB bids at a position this
//       season → the middle 50% (25th–75th percentile) and median. Needs
//       MIN_BIDS (5) bids; below that it reports the count and no range.
//       History, not a prediction (C2 waiverBidEvidence, position-normalised).
//
//   roleRead(player, { seasonal })
//       A backup is never sold as a starter. Quarterbacks are the position
//       where "backup" means "scores nothing": a QB not listed first on his
//       NFL depth chart is flagged. In seasonal formats (redraft / keeper /
//       chopped / best ball) he is not recommended at all; in dynasty he stays
//       a legitimate stash but may only be described as one (C2 waiverRoleRead).
//
//   streamUpgrades({...})
//       "Add X, drop Y: +N lineup points this week / rest of season." Runs the
//       app's own lineup solver (App.StartSit.optimalLineupWeekly — the same
//       one Game Day uses) on the roster before and after each legal add/drop.
//       Projections come from the caller and MUST already be Sleeper's (or the
//       league platform's) published line — the caller passes requireSleeper;
//       a player with no published line, or ruled out / on bye this week, is
//       never offered as a pickup for this week.
//
//   recentPoints / trendFor
//       Real weekly fantasy points (league scoring) from Sleeper's weekly NFL
//       stat lines, for the 2-week trend sparkline. A week counts only when the
//       player actually played (gp > 0); fewer than 2 such weeks → no line.
//       Reads App.SOS.getWeekStats (sessionStorage-cached, already warmed by
//       the SOS / DHQ projection boot) and falls back to App.LeagueStats.load.
//       At most one request per completed week per session, whatever the
//       league size; results are kept in memory, keyed season|week.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const MIN_BIDS = 5;
    // Ruled out for the week (StartSit OUT set + Sleeper's long forms). A
    // Doubtful tag is kept out of THIS WEEK's pickup list too: Sleeper still
    // projects him at a fraction, but "add him to start" would be a coin flip
    // sold as an upgrade.
    const OUT = new Set(['OUT', 'O', 'IR', 'INJURED RESERVE', 'PUP', 'SUS', 'SUSPENDED', 'NA', 'COV', 'DNP', 'BYE', 'DOUBTFUL', 'D']);
    const NON_START_SLOTS = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);
    const NOT_ROSTER_SLOTS = new Set(['IR', 'TAXI', 'RES']);
    const POS_MAP = { DST: 'DEF', 'D/ST': 'DEF', DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL', IDL: 'DL', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', OLB: 'LB', ILB: 'LB', MLB: 'LB' };

    function normPos(pos) {
        const raw = String(pos || '').trim().toUpperCase();
        if (!raw) return '';
        if (POS_MAP[raw]) return POS_MAP[raw];
        const viaApp = App.normPos ? App.normPos(raw) : null;
        return String(viaApp || raw).toUpperCase();
    }
    const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
    const uniq = arr => [...new Set((arr || []).filter(x => x != null && String(x) !== '' && String(x) !== '0').map(String))];

    // ── League shape ────────────────────────────────────────────────
    function leaguePlatform(league) {
        const lg = league || {};
        try {
            const reg = App.Platforms || root.Platforms;
            const prov = reg && reg.getForLeague ? reg.getForLeague(lg) : null;
            if (prov && prov.id) return String(prov.id);
        } catch (e) { /* fall through to the league's own markers */ }
        if (lg._platform) return String(lg._platform);
        if (lg._mfl || lg._source === 'mfl' || lg._mfl_id) return 'mfl';
        if (lg._espn || lg._source === 'espn') return 'espn';
        if (lg._yahoo || lg._source === 'yahoo') return 'yahoo';
        return 'sleeper';
    }
    // Sleeper stores a waiver_budget on EVERY league (100 by default) even when
    // the league runs rolling or reverse-standings waivers; waiver_type 2 is the
    // FAAB setting. Platforms that do not send waiver_type decide on budget.
    function isFaabLeague(league) {
        const st = (league && league.settings) || {};
        const budget = Number(st.waiver_budget) || 0;
        if (!(budget > 0)) return false;
        if (st.waiver_type == null || st.waiver_type === '') return true;
        return Number(st.waiver_type) === 2;
    }
    function isBestBall(league, skinType) {
        return skinType === 'best_ball' || Number(league && league.settings && league.settings.best_ball) === 1;
    }

    // ── Bid evidence ────────────────────────────────────────────────
    function quantile(sorted, q) {
        const x = (sorted.length - 1) * q, i = Math.floor(x);
        return sorted[i] + (sorted[Math.ceil(x)] - sorted[i]) * (x - i);
    }
    function bidEvidence(txns, league, pos, playersData) {
        const lg = league || {};
        const budget = Number(lg.settings && lg.settings.waiver_budget);
        const leagueId = String(lg.league_id || lg.id || '');
        const want = normPos(pos);
        const seen = new Set(), bids = [];
        for (const t of (txns || [])) {
            if (!t || t.type !== 'waiver' || t.status !== 'complete') continue;
            const ids = Object.keys(t.adds || {});
            if (ids.length !== 1) continue;                       // a bundled claim prices no single player
            const p = playersData && playersData[ids[0]];
            if (!p || normPos(p.position) !== want) continue;
            if (t.league_id && leagueId && String(t.league_id) !== leagueId) continue;
            const raw = t.settings && t.settings.waiver_bid;
            if (raw == null || raw === '') continue;
            const bid = Number(raw);
            if (!Number.isFinite(bid) || bid < 0 || (Number.isFinite(budget) && budget > 0 && bid > budget)) continue;
            const key = t.transaction_id || JSON.stringify([ids, t.roster_ids, t.created, t.leg, bid]);
            if (seen.has(key)) continue;
            seen.add(key);
            bids.push(bid);
        }
        bids.sort((a, b) => a - b);
        const enough = bids.length >= MIN_BIDS;
        return {
            pos: want,
            sampleSize: bids.length,
            enough,
            minNeeded: MIN_BIDS,
            low: enough ? Math.floor(quantile(bids, 0.25)) : null,
            median: enough ? Math.round(quantile(bids, 0.5)) : null,
            high: enough ? Math.ceil(quantile(bids, 0.75)) : null,
            basis: 'Middle 50% of this season’s completed winning bids at this position in this league — history, not a prediction.',
        };
    }

    // ── Role check ──────────────────────────────────────────────────
    function roleRead(player, opts) {
        const p = player || {};
        const seasonal = !!(opts && opts.seasonal);
        if (normPos(p.position) !== 'QB') return { eligible: true, backup: false, reason: null };
        const order = Number(p.depth_chart_order);
        const qbDepth = String(p.depth_chart_position || p.position || '').toUpperCase() === 'QB';
        if (qbDepth && order === 1) return { eligible: true, backup: false, reason: null };
        const reason = qbDepth && order > 1
            ? 'Backup QB (No. ' + order + ' on the depth chart) — a stash, not a starter.'
            : 'QB role unknown (not on a depth chart) — not a starter until that changes.';
        // Dynasty keeps him addable as a stash; seasonal formats do not
        // recommend him until there is a starting job.
        return { eligible: !seasonal, backup: true, reason };
    }

    // ── Streaming & season upgrades ─────────────────────────────────
    function injuryOf(p) { return String((p && p.injury_status) || '').trim().toUpperCase(); }
    function isOut(p) { return OUT.has(injuryOf(p)); }
    function positionsOf(p) {
        if (!p) return [];
        return [...new Set([normPos(p.position)].concat((p.fantasy_positions || []).map(normPos)).filter(Boolean))];
    }

    // o = { roster, league, playersData, candidates:[{pid,pos?}],
    //       projOf(pid) → { pts, available } | null   (published line only),
    //       rosOf(pid)  → number | null                 (optional),
    //       valueOf(pid)→ number | null,
    //       protectedPids: iterable, perPosition, minGain }
    // → { ok, reason?, week:{before}, season:{before}|null, rows:[…] }
    function streamUpgrades(o) {
        const SS = App.StartSit;
        const opts = o || {};
        const roster = opts.roster, league = opts.league || {}, pd = opts.playersData || {};
        if (!SS || !SS.optimalLineupWeekly) return { ok: false, reason: 'engine', rows: [] };
        const slots = (league.roster_positions || []).map(s => String(s || '').toUpperCase());
        const starterSlots = slots.filter(s => !NON_START_SLOTS.has(SS.normSlot ? SS.normSlot(s) : s));
        if (!roster || !Array.isArray(roster.players) || !starterSlots.length) return { ok: false, reason: 'roster', rows: [] };
        const capacity = slots.filter(s => !NOT_ROSTER_SLOTS.has(SS.normSlot ? SS.normSlot(s) : s)).length;
        const reserve = new Set(uniq([].concat(roster.reserve || [], roster.taxi || [])));
        const active = uniq(roster.players).filter(pid => !reserve.has(pid));
        if (active.length > capacity) return { ok: false, reason: 'overage', rows: [] };
        const openSpot = active.length < capacity;
        const protectedSet = new Set(uniq([...(opts.protectedPids || [])].concat(roster.keepers || [], roster.locked_players || [])));
        const perPosition = Math.max(1, Number(opts.perPosition) || 6);
        const minGain = Number.isFinite(Number(opts.minGain)) ? Number(opts.minGain) : 1;
        const hasRos = typeof opts.rosOf === 'function';

        const memoW = new Map(), memoR = new Map(), memoV = new Map();
        const wk = pid => {
            if (memoW.has(pid)) return memoW.get(pid);
            let r = null;
            try { r = opts.projOf ? opts.projOf(pid) : null; } catch (e) { r = null; }
            const p = pd[pid];
            const val = (r && finite(r.pts) && r.available !== false && !isOut(p)) ? { pts: Number(r.pts), available: Number(r.pts) > 0 } : null;
            memoW.set(pid, val);
            return val;
        };
        const ros = pid => {
            if (!hasRos) return null;
            if (memoR.has(pid)) return memoR.get(pid);
            let v = null;
            try { v = opts.rosOf(pid); } catch (e) { v = null; }
            v = finite(v) ? Math.max(0, Number(v)) : null;
            memoR.set(pid, v);
            return v;
        };
        const val = pid => {
            if (memoV.has(pid)) return memoV.get(pid);
            let v = null;
            try { v = opts.valueOf ? opts.valueOf(pid) : null; } catch (e) { v = null; }
            v = finite(v) ? Number(v) : null;
            memoV.set(pid, v);
            return v;
        };
        const base = pid => { const p = pd[pid]; return { pid, pos: normPos(p && p.position), positions: positionsOf(p) }; };
        const weekEntry = pid => { const w = wk(pid); return { ...base(pid), available: !!(w && w.available), pts: w ? w.pts : 0 }; };
        const rosEntry = pid => { const r = ros(pid); return { ...base(pid), available: r != null && r > 0, pts: r || 0 }; };
        // Coverage: could this roster field every starting slot in a normal
        // week? Injury only (a bye is one week, not a hole in the roster).
        const covEntry = pid => { const p = pd[pid]; return { ...base(pid), available: !!(p && p.team) && !isOut(p), pts: 1 }; };
        const solve = (pids, fn) => SS.optimalLineupWeekly(pids.map(fn), slots);

        const weekBefore = solve(active, weekEntry).total;
        const rosBefore = hasRos ? solve(active, rosEntry).total : null;
        const coverBefore = solve(active, covEntry).starters.length;

        // Candidates: the best few per position by this week's published
        // line (or ROS points when only ROS is known) — anyone out or on bye
        // this week has no weekly entry and cannot be a this-week pickup.
        const byPos = {};
        (opts.candidates || []).forEach(c => {
            const pid = String(c.pid);
            if (active.includes(pid) || reserve.has(pid)) return;
            const p = pd[pid];
            if (!p || !p.team) return;
            const w = wk(pid);
            const r = ros(pid);
            const score = (w && w.available) ? w.pts : 0;
            if (!(score > 0) && !(r > 0)) return;
            const pos = normPos(p.position);
            (byPos[pos] = byPos[pos] || []).push({ pid, score, ros: r });
        });
        const cands = [];
        Object.keys(byPos).forEach(pos => {
            const list = byPos[pos];
            const top = list.slice().sort((a, b) => b.score - a.score).slice(0, perPosition);
            const topR = hasRos ? list.slice().sort((a, b) => (b.ros || 0) - (a.ros || 0)).slice(0, perPosition) : [];
            const seen = new Set();
            top.concat(topR).forEach(x => { if (!seen.has(x.pid)) { seen.add(x.pid); cands.push(x.pid); } });
        });

        const dropPool = openSpot ? [null] : active.filter(pid => {
            if (protectedSet.has(pid)) return false;
            const p = pd[pid];
            if (!p) return false;
            if (injuryOf(p)) return false;     // never suggest cutting an injured player to stream
            return true;
        });

        const rows = [];
        cands.forEach(pid => {
            const addVal = val(pid);
            let best = null;
            for (const drop of dropPool) {
                if (drop) {
                    const dv = val(drop);
                    // Do not trade a better long-term asset for a one-week bump.
                    if (dv == null || addVal == null || dv > addVal) continue;
                }
                const after = active.filter(x => x !== drop).concat(pid);
                if (solve(after, covEntry).starters.length < coverBefore) continue;   // never open a hole to fill a slot
                const weekGain = Math.round((solve(after, weekEntry).total - weekBefore) * 10) / 10;
                const rosGain = hasRos ? Math.round((solve(after, rosEntry).total - rosBefore) * 10) / 10 : null;
                const cand = { drop, weekGain, rosGain, dropValue: drop ? val(drop) : null };
                const better = (a, b) => {
                    const ka = opts.horizon === 'season' ? (a.rosGain || 0) : a.weekGain;
                    const kb = opts.horizon === 'season' ? (b.rosGain || 0) : b.weekGain;
                    if (ka !== kb) return ka > kb;
                    const sa = opts.horizon === 'season' ? a.weekGain : (a.rosGain || 0);
                    const sb = opts.horizon === 'season' ? b.weekGain : (b.rosGain || 0);
                    if (sa !== sb) return sa > sb;
                    return (a.dropValue || 0) < (b.dropValue || 0);
                };
                if (!best || better(cand, best)) best = cand;
            }
            if (!best) return;
            const metric = opts.horizon === 'season' ? best.rosGain : best.weekGain;
            if (!(metric >= minGain)) return;
            const w = wk(pid);
            const dp = best.drop ? pd[best.drop] : null;
            const dw = best.drop ? wk(best.drop) : null;
            rows.push({
                pid,
                pos: normPos(pd[pid] && pd[pid].position),
                addPts: w && w.available ? w.pts : null,
                addRos: ros(pid),
                drop: best.drop ? {
                    pid: best.drop,
                    name: (dp && (dp.full_name || [dp.first_name, dp.last_name].filter(Boolean).join(' '))) || best.drop,
                    pos: normPos(dp && dp.position),
                    pts: dw && dw.available ? dw.pts : null,
                    ros: ros(best.drop),
                } : null,
                weekGain: best.weekGain,
                rosGain: best.rosGain,
            });
        });
        rows.sort((a, b) => opts.horizon === 'season'
            ? ((b.rosGain || 0) - (a.rosGain || 0)) || (b.weekGain - a.weekGain)
            : (b.weekGain - a.weekGain) || ((b.rosGain || 0) - (a.rosGain || 0)));
        return { ok: true, openSpot, rows, week: { before: weekBefore }, season: hasRos ? { before: rosBefore } : null };
    }

    // ── Real weekly points (trend sparkline) ────────────────────────
    const _weeks = new Map();      // season|week → { rows } | promise
    const _scored = new Map();     // scoringKey|season|week → { pid: pts }
    const _failedAt = new Map();   // season|week → ts of an empty/failed read
    function fetchWeekRows(season, week) {
        const SOS = App.SOS;
        if (SOS && typeof SOS.getWeekStats === 'function') return Promise.resolve(SOS.getWeekStats(String(season), Number(week)));
        const LS = App.LeagueStats;
        if (LS && typeof LS.load === 'function') return LS.load({ season: String(season), week: Number(week) }).then(r => (r && r.statsByPid) || {});
        return Promise.resolve({});
    }
    // Completed regular-season weeks before `currentWeek`, newest `count`.
    function completedWeeks(currentWeek, count) {
        const cw = Number(currentWeek) || 0;
        const out = [];
        for (let w = cw - 1; w >= 1 && out.length < (count || 2); w--) out.push(w);
        return out.reverse();
    }
    function weekRows(season, week) {
        const k = season + '|' + week;
        const hit = _weeks.get(k);
        return hit && !hit.then ? hit.rows : null;
    }
    // Loads (once) the stat lines for the given weeks. Resolves true when any
    // new week landed, so the caller knows to re-render.
    function loadWeeks(season, weeks) {
        const jobs = (weeks || []).map(week => {
            const k = season + '|' + week;
            const hit = _weeks.get(k);
            if (hit) return hit.then ? hit : Promise.resolve(false);
            const failed = _failedAt.get(k);
            if (failed && Date.now() - failed < 60000) return Promise.resolve(false);
            const job = fetchWeekRows(season, week).then(data => {
                const ok = data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 0;
                if (!ok) { _weeks.delete(k); _failedAt.set(k, Date.now()); return false; }
                // Keep only games actually played — nothing else is ever read.
                const rows = {};
                Object.keys(data).forEach(pid => {
                    if (pid.indexOf('TEAM_') === 0) return;
                    const r = data[pid];
                    if (r && typeof r === 'object' && Number(r.gp) > 0) rows[pid] = r;
                });
                _weeks.set(k, { rows });
                return true;
            }).catch(() => { _weeks.delete(k); _failedAt.set(k, Date.now()); return false; });
            _weeks.set(k, job);
            return job;
        });
        return Promise.all(jobs).then(r => r.some(Boolean));
    }
    function scoreRow(row, scoring, pos) {
        const calc = App.calcRawPts;
        if (typeof calc !== 'function') return null;
        let pts = calc(row, scoring || {});
        if (!Number.isFinite(pts)) return null;
        // calcRawPts is position-blind: TE premium rides here, as in weekly-proj.
        const teBonus = (pos === 'TE' && scoring && Number(scoring.bonus_rec_te)) || 0;
        if (teBonus && Number.isFinite(Number(row.rec))) pts += teBonus * Number(row.rec);
        return Math.round(pts * 10) / 10;
    }
    // [{ week, pts }] for the weeks given — only weeks he played, league-scored.
    function trendFor(pid, opts) {
        const o = opts || {};
        const season = String(o.season || '');
        const scoringKey = o.scoringKey || JSON.stringify(o.scoring || {});
        const pos = normPos(o.position || (o.playersData && o.playersData[pid] && o.playersData[pid].position));
        const out = [];
        (o.weeks || []).forEach(week => {
            const rows = weekRows(season, week);
            if (!rows) return;
            const row = rows[String(pid)];
            if (!row) return;
            const ck = scoringKey + '|' + season + '|' + week;
            let map = _scored.get(ck);
            if (!map) { map = {}; _scored.set(ck, map); if (_scored.size > 24) _scored.delete(_scored.keys().next().value); }
            if (!(pid in map)) map[pid] = scoreRow(row, o.scoring, pos);
            if (map[pid] != null) out.push({ week: Number(week), pts: map[pid] });
        });
        return out.length >= 2 ? out : [];
    }

    App.WaiverTools = App.WaiverTools || {
        MIN_BIDS, normPos, leaguePlatform, isFaabLeague, isBestBall,
        bidEvidence, roleRead, streamUpgrades,
        completedWeeks, loadWeeks, weekRows, trendFor, scoreRow,
        _reset() { _weeks.clear(); _scored.clear(); _failedAt.clear(); },
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.WaiverTools;
})(typeof window !== 'undefined' ? window : globalThis);
