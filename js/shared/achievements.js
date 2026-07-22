// ══════════════════════════════════════════════════════════════════
// js/shared/achievements.js — Achievement system (first-class)
//
// Catalog of derived legacy badges. Earn-state and progress are
// computed from roster + LI.championships + season history + HOF.
// Used by:
//   - js/widgets/my-trophies.js   (sm count, tall summary, xxl full grid)
//   - js/tabs/trophy-room.js      (Achievements tab)
//
// Exposes:
//   window.WrAchievements.catalog                   — definition list
//   window.WrAchievements.computeStats(rosterId, …) — common stats
//   window.WrAchievements.evaluate(stats)           — per-achievement
//                                                     { earned, progress, value }
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── Achievement catalog ─────────────────────────────────────────
    // Each entry: { id, icon, label, description, tier, target, eval(stats) }
    //   tier: 'titles' | 'performance' | 'tenure' | 'misc'
    //   target: numeric goal used for progress bars
    //   eval(stats) → { value: number, progress: 0-1 }
    const CATALOG = [
        // ── Titles ────────────────────────────────────────────────
        {
            id: 'champion', tier: 'titles', icon: '👑',
            label: 'Champion', description: 'Won the league title',
            target: 1,
            eval: (s) => ({ value: s.championships, progress: Math.min(1, s.championships / 1) }),
        },
        {
            id: 'repeat', tier: 'titles', icon: '🥇',
            label: 'Repeat', description: 'Won back-to-back championships',
            target: 1,
            eval: (s) => {
                const sorted = [...s.champSeasons].map(Number).sort((a, b) => a - b);
                let backToBack = 0;
                for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i-1] === 1) backToBack++;
                return { value: backToBack, progress: backToBack >= 1 ? 1 : 0 };
            },
        },
        {
            id: 'dynasty', tier: 'titles', icon: '🏆',
            label: 'Dynasty', description: 'Won 3+ championships',
            target: 3,
            eval: (s) => ({ value: s.championships, progress: Math.min(1, s.championships / 3) }),
        },
        {
            id: 'bridesmaid', tier: 'titles', icon: '🥈',
            label: 'Bridesmaid', description: 'Lost the championship 2+ times',
            target: 2,
            eval: (s) => ({ value: s.runnerUps, progress: Math.min(1, s.runnerUps / 2) }),
        },
        {
            id: 'hof_owner', tier: 'titles', icon: '🎓',
            label: 'HOF Owner', description: 'Has inducted at least one Hall of Famer',
            target: 1,
            eval: (s) => ({ value: s.teamHof, progress: Math.min(1, s.teamHof / 1) }),
        },

        // ── Performance ───────────────────────────────────────────
        {
            id: 'winner', tier: 'performance', icon: '📈',
            label: 'Winner', description: '60%+ all-time win rate',
            target: 60,
            eval: (s) => ({
                value: Math.round(s.winPct),
                progress: s.totalGames < 10 ? 0 : Math.min(1, s.winPct / 60),
            }),
        },
        {
            id: 'underdog', tier: 'performance', icon: '📉',
            label: 'Underdog', description: 'Sub-40% all-time win rate (heart of a fighter)',
            target: 40,
            eval: (s) => ({
                value: Math.round(s.winPct),
                progress: s.totalGames < 10 ? 0 : (s.winPct < 40 ? 1 : 0),
            }),
        },
        {
            id: 'postseason', tier: 'performance', icon: '🎯',
            label: 'Postseason', description: 'Made the playoffs 5+ times',
            target: 5,
            eval: (s) => ({ value: s.playoffs, progress: Math.min(1, s.playoffs / 5) }),
        },
        {
            id: 'comeback', tier: 'performance', icon: '🎢',
            label: 'Comeback Kid', description: 'Made the playoffs after a losing season',
            target: 1,
            eval: (s) => {
                if (!s.hist || s.hist.length < 2) return { value: 0, progress: 0 };
                const playoffCutoff = s.playoffCutoff || 6;
                let count = 0;
                for (let i = 1; i < s.hist.length; i++) {
                    const prev = s.hist[i-1];
                    const curr = s.hist[i];
                    const prevTotal = (prev.wins || 0) + (prev.losses || 0);
                    const prevLosing = prevTotal && prev.wins / prevTotal < 0.5;
                    const currPlayoff = curr.place && curr.place <= playoffCutoff;
                    if (prevLosing && currPlayoff) count++;
                }
                return { value: count, progress: count >= 1 ? 1 : 0 };
            },
        },
        {
            id: 'undefeated', tier: 'performance', icon: '⚡',
            label: 'Undefeated', description: 'Won every regular-season game',
            target: 1,
            eval: (s) => {
                const won = (s.hist || []).filter(h => h.losses === 0 && h.wins > 0).length;
                return { value: won, progress: won >= 1 ? 1 : 0 };
            },
        },
        {
            id: 'sub_500_streak', tier: 'performance', icon: '🪦',
            label: 'In the Hole', description: 'Lost more than half of all games (10+ played)',
            target: 1,
            eval: (s) => ({
                value: s.totalGames,
                progress: s.totalGames >= 10 && s.winPct < 50 ? 1 : 0,
            }),
        },

        // ── Tenure ────────────────────────────────────────────────
        {
            id: 'veteran', tier: 'tenure', icon: '⏳',
            label: 'Veteran', description: 'Played 100+ games',
            target: 100,
            eval: (s) => ({ value: s.totalGames, progress: Math.min(1, s.totalGames / 100) }),
        },
        {
            id: 'patriarch', tier: 'tenure', icon: '🦴',
            label: 'Patriarch', description: 'Played 200+ games',
            target: 200,
            eval: (s) => ({ value: s.totalGames, progress: Math.min(1, s.totalGames / 200) }),
        },
        {
            id: 'tenured', tier: 'tenure', icon: '📅',
            label: 'Tenured', description: 'Tracked across 5+ seasons',
            target: 5,
            eval: (s) => ({ value: s.seasons, progress: Math.min(1, s.seasons / 5) }),
        },

        // ── Misc / fun ────────────────────────────────────────────
        {
            id: 'climbing', tier: 'misc', icon: '🌱',
            label: 'Climbing', description: 'Building your legacy from the ground up',
            target: 1,
            eval: (s) => ({
                value: 1,
                progress: (s.championships === 0 && s.teamHof === 0 && s.totalGames < 30) ? 1 : 0,
            }),
        },
    ];

    // ── Compute common stats from raw inputs ───────────────────────
    // Prefers historical totals (dhq_hist) when available, falls back to
    // current-season-only data from myRoster.settings.
    function computeStats({ myRoster, currentLeague, championships }) {
        const myRid = myRoster?.roster_id;
        const champs = championships || (window.App && window.App.LI && window.App.LI.championships) || {};
        let titles = 0, runnerUps = 0;
        const champSeasons = [], runnerUpSeasons = [];
        Object.entries(champs).forEach(([season, c]) => {
            if (c.champion === myRid) { titles++; champSeasons.push(season); }
            if (c.runnerUp === myRid) { runnerUps++; runnerUpSeasons.push(season); }
        });

        // History from dhq_hist_<leagueId> (populated by WrHistory)
        const leagueId = currentLeague?.league_id || currentLeague?.id || (window.S && window.S.leagues && window.S.leagues[0] && window.S.leagues[0].league_id);
        const hist = (() => {
            try {
                const raw = localStorage.getItem('dhq_hist_' + leagueId);
                if (!raw) return [];
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return [];
                return parsed
                    .filter(s => s.rosterId === myRid || s.roster_id === myRid)
                    .map(s => ({
                        season: s.season,
                        wins: s.wins || 0,
                        losses: s.losses || 0,
                        ties: s.ties || 0,
                        place: s.place || s.finalRank,
                        healthScore: s.healthScore,
                    }))
                    .sort((a, b) => (a.season || 0) - (b.season || 0));
            } catch { return []; }
        })();

        // Aggregate W/L from history if available; otherwise use current-season roster.
        let wins, losses, ties, totalGames;
        if (hist.length) {
            wins = hist.reduce((s, h) => s + (h.wins || 0), 0);
            losses = hist.reduce((s, h) => s + (h.losses || 0), 0);
            ties = hist.reduce((s, h) => s + (h.ties || 0), 0);
            totalGames = wins + losses + ties;
        } else {
            wins = myRoster?.settings?.wins || 0;
            losses = myRoster?.settings?.losses || 0;
            ties = myRoster?.settings?.ties || 0;
            totalGames = wins + losses + ties;
        }
        const winPct = totalGames ? (wins / totalGames * 100) : 0;

        // HOF inductees
        let teamHof = 0;
        try {
            const hof = JSON.parse(localStorage.getItem('wr_hof_' + leagueId) || '[]');
            teamHof = hof.filter(h => h.scope === 'team' && h.teamRosterId === myRid).length;
        } catch { /* swallow */ }

        const totalTeams = (currentLeague?.rosters || []).length || 12;
        const playoffCutoff = Math.ceil(totalTeams / 2);
        const playoffs = hist.filter(s => s.place && s.place <= playoffCutoff).length;

        const bestSeason = hist.length ? hist.reduce((b, s) => ((s.wins || 0) > (b?.wins || -1) ? s : b), null) : null;
        const worstSeason = hist.length ? hist.reduce((w, s) => ((s.losses || 0) > (w?.losses || -1) ? s : w), null) : null;

        return {
            championships: titles, runnerUps,
            champSeasons, runnerUpSeasons,
            wins, losses, ties, totalGames, winPct,
            teamHof, hist, playoffs, playoffCutoff,
            seasons: hist.length,
            bestSeason, worstSeason,
        };
    }

    // ── Evaluate every achievement against stats ──────────────────
    // Returns { earned: [], unearned: [] } each [{ ...achievement, value, progress }]
    function evaluate(stats) {
        const earned = [];
        const unearned = [];
        CATALOG.forEach(a => {
            const result = a.eval(stats);
            const item = { ...a, value: result.value, progress: result.progress };
            if (result.progress >= 1) earned.push(item);
            else unearned.push(item);
        });
        return { earned, unearned };
    }

    function tierLabel(tier) {
        return ({ titles: 'Titles', performance: 'Performance', tenure: 'Tenure', misc: 'Misc' })[tier] || tier;
    }

    function tierColor(tier) {
        return ({ titles: 'var(--k-d4af37, #d4af37)', performance: 'var(--k-2ecc71, #2ecc71)', tenure: 'var(--k-5dade2, #5dade2)', misc: 'var(--k-7c6bf8, #7c6bf8)' })[tier] || 'var(--k-d4af37, #d4af37)';
    }

    window.WrAchievements = {
        catalog: CATALOG,
        computeStats,
        evaluate,
        tierLabel,
        tierColor,
    };
})();
