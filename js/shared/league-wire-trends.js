// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-trends.js — window.WrWireTrends
// "Who's moving now?" Ported from C2 (1be683d) as-is. Compares each rostered
// player's recent completed weeks with the weeks just before (up to 3 vs 3),
// in THIS league's scoring (calcFantasyPts), from Sleeper's weekly stats.
// Missing games are excluded, never zero; real zero and negative scores
// count; a change under 2 fantasy points per game is not reported. Loads at
// most 6 weeks, 2 at a time, only when the Trends section is opened.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const valid = value => typeof value === 'number' && Number.isFinite(value);
    const round = value => Math.round(value * 100) / 100;
    function windowFor(throughWeek, start = 1) {
        const end = Number(throughWeek), first = Number(start);
        if (!Number.isInteger(end) || !Number.isInteger(first) || end < first + 1 || end > 18 || first < 1) return [];
        const width = Math.min(3, Math.floor((end - first + 1) / 2));
        return Array.from({ length: width * 2 }, (_, index) => end - width * 2 + index + 1);
    }
    function build({ league, throughWeek, weeks, players = {}, calculate }) {
        const range = windowFor(throughWeek, Math.max(1, Number(league.settings?.start_week) || 1));
        const empty = { rows: [], range, priorWeeks: [], recentWeeks: [], reason: '' };
        if (!range.length) return { ...empty, reason: 'Two completed weeks are needed before comparing recent form.' };
        const scoring = league.scoring_settings;
        if (typeof calculate !== 'function' || !scoring || Array.isArray(scoring) || !Object.keys(scoring).length || !Object.values(scoring).every(valid)) return { ...empty, reason: 'This league’s scoring is unavailable. Refresh to try again.' };
        const width = range.length / 2, priorWeeks = range.slice(0, width), recentWeeks = range.slice(width);
        const byWeek = new Map((weeks || []).filter(entry => range.includes(entry.week)).map(entry => [entry.week, entry.stats]));
        if (range.some(week => !byWeek.get(week) || !Object.keys(byWeek.get(week)).length)) return { ...empty, reason: 'Some recent weekly statistics could not load. Retry to complete the comparison.' };
        const owned = new Map();
        (league.rosters || []).forEach(roster => (roster.players || []).forEach(pid => {
            if (!owned.has(String(pid))) owned.set(String(pid), []);
            owned.get(String(pid)).push(roster.roster_id);
        }));
        const minGames = width === 1 ? 1 : 2, rows = [];
        owned.forEach((rosterIds, pid) => {
            const player = players[pid];
            if (!player?.full_name || ['DEF', 'TEAM'].includes(player.position) || pid.startsWith('TEAM_')) return;
            const observations = range.map(week => {
                const raw = byWeek.get(week)[pid];
                if (!raw || !Object.values(raw).some(valid) || (valid(raw.gp) && raw.gp <= 0)) return null;
                const appeared = valid(raw.gp) ? raw.gp > 0 : ['off_snp', 'def_snp', 'st_snp', 'pass_att', 'rush_att', 'rec_tgt', 'fg_att', 'xpa', 'tkl', 'idp_tkl'].some(key => valid(raw[key]) && raw[key] > 0);
                if (!appeared) return null;
                const value = calculate(raw, scoring);
                return valid(value) ? { week, points: round(value) } : null;
            }).filter(Boolean);
            const prior = observations.filter(item => priorWeeks.includes(item.week)), recent = observations.filter(item => recentWeeks.includes(item.week));
            if (prior.length < minGames || recent.length < minGames) return;
            const avg = list => list.reduce((sum, item) => sum + item.points, 0) / list.length;
            const before = avg(prior), after = avg(recent), delta = round(after - before);
            if (Math.abs(delta) < 2) return;
            rows.push({ pid, name: player.full_name, position: player.position, rosterIds, prior: round(before), recent: round(after), delta, priorGames: prior.length, recentGames: recent.length, observations });
        });
        rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name));
        return { ...empty, rows, priorWeeks, recentWeeks };
    }
    async function load({ league, throughWeek, players, getWeekStats, calculate, signal }) {
        const range = windowFor(throughWeek, Math.max(1, Number(league.settings?.start_week) || 1)), weeks = [];
        if (!range.length) return build({ league, throughWeek, weeks, players, calculate });
        if (typeof getWeekStats !== 'function') throw Error('Weekly player statistics are unavailable. Try again shortly.');
        let cursor = 0;
        const check = () => { if (signal?.aborted) { const error = Error('Interrupted'); error.name = 'AbortError'; throw error; } };
        async function worker() { while (cursor < range.length) { check(); const week = range[cursor++]; const stats = await getWeekStats(league.season, week, 'regular'); check(); weeks.push({ week, stats }); } }
        await Promise.all([worker(), worker()]);
        return build({ league, throughWeek, weeks, players, calculate });
    }
    root.WrWireTrends = { windowFor, build, load };
})(typeof window !== 'undefined' ? window : globalThis);
