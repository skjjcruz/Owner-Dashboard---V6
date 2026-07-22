// ══════════════════════════════════════════════════════════════════
// js/utils/gamelog-engine.js — window.App.GameLog
// Per-game player log for the player scouting card. Reuses the SOS engine's
// cached weekly stats (App.SOS.getWeekStats) + derived schedule, and league-
// scores each game via calcFantasyPts so the "Pts" column matches the league.
//
//   buildPlayerLog(pid, season, { playersData, scoring, upToWeek })
//     → Promise<[{ week, opp, isBye, played, pts, statLine }]>
//   keyStats(statLine, pos) → [{ l, v }]  (position-aware summary for a row)
//
// Warroom-local util (direct <script> tag), no vendored mirror.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const _cache = {};                 // cacheKey -> { ts, data }
    const TTL_MS = 30 * 60 * 1000;

    function currentWeek() {
        return (App.WeeklyProj && App.WeeklyProj.currentWeek && App.WeeklyProj.currentWeek()) || 18;
    }

    // Build a week-by-week log for one player, this season.
    async function buildPlayerLog(pid, season, opts) {
        opts = opts || {};
        const SOS = App.SOS;
        if (!SOS || !SOS.getWeekStats || !pid) return [];
        const playersData = opts.playersData || (root.S && root.S.players) || {};
        const scoring = opts.scoring || {};
        const player = playersData[pid] || {};
        const team = String(player.team || '').toUpperCase();
        const bye = Number(player.bye_week) || 0;
        const lastWeek = Math.min(18, Math.max(1, opts.upToWeek || currentWeek()));
        const calc = root.calcFantasyPts || (App.Sleeper && App.Sleeper.calcFantasyPts);

        // Cache key includes whether the SOS schedule is loaded, so opponents fill
        // in (recompute) once SOS initializes rather than serving a stale no-opp log.
        const cacheKey = [pid, season, lastWeek, SOS.schedule ? 's' : 'n'].join('|');
        const hit = _cache[cacheKey];
        if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

        const weeks = [];
        for (let w = 1; w <= lastWeek; w++) weeks.push(w);
        const weekStats = await Promise.all(weeks.map(w => Promise.resolve(SOS.getWeekStats(season, w)).catch(() => ({}))));
        const sched = SOS.schedule || {};

        const rows = weeks.map((w, i) => {
            const wd = weekStats[i] || {};
            const raw = wd[pid] || null;
            const opp = (sched[w] && sched[w][team]) || null;
            const isBye = bye ? (w === bye) : (!opp && !raw);
            let pts = null;
            if (raw) {
                if (typeof calc === 'function') pts = calc(raw, scoring);
                else if (raw.pts_half_ppr != null) pts = raw.pts_half_ppr;
                if (pts != null) pts = Math.round(pts * 10) / 10;
            }
            return { week: w, opp, isBye, played: !!raw, pts, statLine: raw };
        });

        _cache[cacheKey] = { ts: Date.now(), data: rows };
        return rows;
    }

    // Position-aware key stat summary for one game row.
    function keyStats(raw, pos) {
        if (!raw) return [];
        const P = String(pos || '').toUpperCase();
        const n = (v, d) => (v == null ? '—' : (d ? (+v).toFixed(d) : String(Math.round(+v))));
        const idp = k => raw['idp_' + k] != null ? raw['idp_' + k] : raw[k];
        if (P === 'QB') return [
            { l: 'Pass', v: n(raw.pass_yd) + ' / ' + n(raw.pass_td) + 'TD' + (raw.pass_int ? ' / ' + n(raw.pass_int) + 'INT' : '') },
            { l: 'Rush', v: n(raw.rush_yd) + ' / ' + n(raw.rush_td) + 'TD' },
        ];
        if (P === 'RB') return [
            { l: 'Rush', v: n(raw.rush_yd) + ' / ' + n(raw.rush_td) + 'TD' },
            { l: 'Rec', v: n(raw.rec) + '-' + n(raw.rec_yd) },
        ];
        if (P === 'WR' || P === 'TE') return [
            { l: 'Rec', v: n(raw.rec) + '-' + n(raw.rec_yd) + ' / ' + n(raw.rec_td) + 'TD' },
            { l: 'Tgt', v: n(raw.rec_tgt != null ? raw.rec_tgt : raw.tgt) },
        ];
        if (P === 'K') return [{ l: 'FG', v: n(raw.fgm) }, { l: 'XP', v: n(raw.xpm) }];
        // IDP (DL/LB/DB) + DEF fallback
        return [
            { l: 'Tkl', v: n((idp('tkl_solo') || 0) + (Number(idp('tkl_ast')) || 0) * 0) },
            { l: 'Sack', v: n(idp('sack'), 1) },
            { l: 'INT', v: n(idp('int')) },
        ];
    }

    // Targets/carries usage series for the trend strip (position-aware).
    function usageSeries(rows, pos) {
        const P = String(pos || '').toUpperCase();
        const field = (P === 'WR' || P === 'TE') ? 'rec_tgt' : (P === 'RB') ? 'rush_att' : null;
        if (!field) return null;
        const pts = rows.filter(r => r.played && r.statLine).map(r => {
            const raw = r.statLine;
            const v = raw[field] != null ? raw[field] : (field === 'rec_tgt' ? raw.tgt : raw.att);
            return { week: r.week, v: Number(v) || 0 };
        });
        if (!pts.length) return null;
        const label = field === 'rec_tgt' ? 'Targets/gm' : 'Carries/gm';
        const avg = Math.round((pts.reduce((s, x) => s + x.v, 0) / pts.length) * 10) / 10;
        return { label, avg, series: pts };
    }

    App.GameLog = App.GameLog || { buildPlayerLog, keyStats, usageSeries, _cache };
})(typeof window !== 'undefined' ? window : globalThis);
