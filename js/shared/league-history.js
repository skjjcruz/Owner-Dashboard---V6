// ══════════════════════════════════════════════════════════════════
// js/shared/league-history.js — Sleeper league history loader
//
// Walks the previous_league_id chain to fetch every season this league
// has existed, then aggregates per-owner records (wins/losses/points/
// place/champ/runner-up). Output is exposed via:
//
//   window.WrHistory.load(currentLeague)        — fetch + cache (Promise)
//   window.WrHistory.loadIfMissing(currentLeague) — fetch only if cache stale
//   window.buildOwnerHistory()                  — { rosterId: ownerHistory }
//                                                  read by Trophy Room
//   window.App.LI.championships                 — { season: { champion, runnerUp } }
//   localStorage['dhq_hist_<leagueId>']         — flat per-roster history
//                                                  read by achievements.js
//
// Emits a 'wr_history_loaded' window event when fresh data lands so
// React widgets can re-render.
//
// Cache TTL: 6 hours per league.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const SLEEPER = 'https://api.sleeper.app/v1';
    const CACHE_TTL = 6 * 60 * 60 * 1000;
    const CHAIN_MAX = 15;
    const CACHE_KEY = (lid) => 'wr_history_' + lid;
    const memoryCache = {};
    let activeLeagueId = null;

    function fetchJson(url) {
        return fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    }

    // Walk previous_league_id chain — returns array of { leagueId, season, info }
    async function walkChain(startId) {
        const out = [];
        let lid = startId;
        const seen = new Set();
        while (lid && lid !== '0' && out.length < CHAIN_MAX && !seen.has(lid)) {
            seen.add(lid);
            const info = await fetchJson(SLEEPER + '/league/' + lid);
            if (!info) break;
            out.push({ leagueId: lid, season: parseInt(info.season) || null, info });
            lid = info.previous_league_id;
        }
        return out;
    }

    async function fetchSeasonData(leagueId) {
        const [rosters, users, bracket] = await Promise.all([
            fetchJson(SLEEPER + '/league/' + leagueId + '/rosters'),
            fetchJson(SLEEPER + '/league/' + leagueId + '/users'),
            fetchJson(SLEEPER + '/league/' + leagueId + '/winners_bracket'),
        ]);
        return { rosters, users, bracket };
    }

    // Fetch championship-week matchups so we can capture the title-winning
    // lineup. The championship round is the highest round in the bracket;
    // its week = playoff_week_start + (numRounds - 1) for one-week-per-round
    // formats (the common case in dynasty leagues).
    async function fetchChampionshipMatchup(leagueInfo, bracket, championRosterId) {
        if (!leagueInfo || !Array.isArray(bracket) || !bracket.length || championRosterId == null) return null;
        const playoffStart = leagueInfo.settings?.playoff_week_start;
        if (!playoffStart) return null;
        const maxR = Math.max(...bracket.map(b => b.r || 1));
        const championshipWeek = playoffStart + maxR - 1;
        const matchups = await fetchJson(SLEEPER + '/league/' + leagueInfo.league_id + '/matchups/' + championshipWeek);
        if (!Array.isArray(matchups)) return null;
        const row = matchups.find(m => m.roster_id === championRosterId);
        if (!row) return null;
        return {
            week: championshipWeek,
            starters: row.starters || [],
            starterPoints: row.starters_points || [],
            totalPoints: row.points || 0,
            rosterPositions: leagueInfo.roster_positions || [],
        };
    }

    // Sleeper bracket entries: { r, m, t1, t2, w, l, t1_from, t2_from, p }
    // p === 1 → 1st-place game, p === 3 → 3rd, p === 5 → 5th, p === 7 → 7th
    function placementsFromBracket(bracket) {
        const out = {};
        if (!Array.isArray(bracket) || !bracket.length) return out;
        bracket.forEach(b => {
            if (!b || b.w == null) return;
            if (b.p === 1) { out[b.w] = 1; if (b.l != null) out[b.l] = 2; }
            else if (b.p === 3) { out[b.w] = 3; if (b.l != null) out[b.l] = 4; }
            else if (b.p === 5) { out[b.w] = 5; if (b.l != null) out[b.l] = 6; }
            else if (b.p === 7) { out[b.w] = 7; if (b.l != null) out[b.l] = 8; }
        });
        // Fallback: if no p field, infer champion from highest-round single matchup
        if (!Object.keys(out).length) {
            const maxR = Math.max(...bracket.map(b => b.r || 0));
            const finals = bracket.filter(b => b.r === maxR);
            if (finals.length === 1 && finals[0].w != null) {
                out[finals[0].w] = 1;
                if (finals[0].l != null) out[finals[0].l] = 2;
            }
        }
        return out;
    }

    // championshipPathMatchIds — the set of winners-bracket matchup numbers (m) on the
    // path to the title game (p===1), found by walking t#_from.w pointers backwards from it.
    // This is the only correct way to separate REAL playoff games from consolation /
    // placement (3rd/5th/7th) games: those descend from LOSER pointers and never feed the
    // final, so they're excluded — and it's robust to byes and two-week championship rounds.
    // NB: t1_from/t2_from.w are MATCHUP NUMBERS (m); t1/t2/w/l are ROSTER IDS. Never mix them
    // (the old per-tab tracing compared m to t1/t2 — different ID spaces — and broke).
    function championshipPathMatchIds(winners) {
        const ids = new Set();
        if (!Array.isArray(winners) || !winners.length) return ids;
        const byId = new Map(winners.map(m => [m.m, m]));
        let start = winners.find(m => m.p === 1);
        if (!start) {
            // No placement field: fall back to a lone highest-round game (a simple final).
            const maxR = Math.max(...winners.map(m => m.r || 0));
            const finals = winners.filter(m => (m.r || 0) === maxR);
            if (finals.length === 1) start = finals[0];
        }
        if (!start) return ids;
        const queue = [start];
        while (queue.length) {
            const g = queue.shift();
            if (!g || ids.has(g.m)) continue;
            ids.add(g.m);
            [g.t1_from, g.t2_from].forEach(fr => {
                if (fr && fr.w != null && byId.has(fr.w)) queue.push(byId.get(fr.w));
            });
        }
        return ids;
    }

    // playoffRecord — a roster's W-L across REAL playoff (championship-path) games only.
    // The single source of truth for playoff records across every tab/engine.
    function playoffRecord(winners, rosterId) {
        if (rosterId == null) return { w: 0, l: 0 };
        const ids = championshipPathMatchIds(winners);
        const rid = String(rosterId);
        let w = 0, l = 0;
        (winners || []).forEach(m => {
            if (!ids.has(m.m)) return;
            if (m.w != null && String(m.w) === rid) w++;
            else if (m.l != null && String(m.l) === rid) l++;
        });
        return { w, l };
    }

    // semiFinalistRosters — the (up to 4) season roster_ids that reached the semifinals:
    // the two games that FEED the p===1 final (via t#_from.w), and both participants of each.
    // Used to populate championships[].semiFinals so dynasty-score counts final-four berths.
    function semiFinalistRosters(bracket) {
        if (!Array.isArray(bracket) || !bracket.length) return [];
        const byId = new Map(bracket.map(m => [m.m, m]));
        let fin = bracket.find(m => m.p === 1);
        if (!fin) {
            const maxR = Math.max(...bracket.map(m => m.r || 0));
            const finals = bracket.filter(m => (m.r || 0) === maxR);
            if (finals.length === 1) fin = finals[0];
        }
        if (!fin) return [];
        const out = [];
        [fin.t1_from, fin.t2_from].forEach(fr => {
            if (fr && fr.w != null && byId.has(fr.w)) {
                const g = byId.get(fr.w);
                if (g.w != null) out.push(g.w);
                if (g.l != null) out.push(g.l);
            }
        });
        return out;
    }

    function rosterFinish(place, w, l, t) {
        if (place === 1) return 'Champion';
        if (place === 2) return 'Runner-Up';
        if (place === 3) return '3rd';
        if (place === 4) return '4th';
        if (place && place <= 8) return '#' + place;
        if ((w || 0) + (l || 0) + (t || 0) > 0) return w + '-' + l + (t ? '-' + t : '');
        return '—';
    }

    async function build(currentLeague) {
        const startId = currentLeague?.id || currentLeague?.league_id;
        if (!startId) return null;

        // Cache check
        try {
            const raw = localStorage.getItem(CACHE_KEY(startId));
            if (raw) {
                const cached = JSON.parse(raw);
                if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
                    populateGlobals(cached, startId);
                    return cached;
                }
            }
        } catch { /* fall through */ }

        const chain = await walkChain(startId);
        if (!chain.length) return null;

        const seasons = await Promise.all(chain.map(c => fetchSeasonData(c.leagueId).then(d => ({ ...c, ...d }))));

        // Second pass: for each season with a champion, fetch their championship-week lineup
        await Promise.all(seasons.map(async s => {
            if (!Array.isArray(s.bracket) || !s.bracket.length) return;
            const champEntry = s.bracket.find(b => b.p === 1) || (() => {
                const maxR = Math.max(...s.bracket.map(b => b.r || 0));
                const finals = s.bracket.filter(b => b.r === maxR);
                return finals.length === 1 ? finals[0] : null;
            })();
            if (!champEntry || champEntry.w == null) return;
            const matchup = await fetchChampionshipMatchup(s.info, s.bracket, champEntry.w);
            if (matchup) s.championshipMatchup = { ...matchup, championRosterId: champEntry.w };
        }));

        // Map current rosters: owner_id (user_id) → roster_id
        const currentRosterByOwner = {};
        (currentLeague?.rosters || []).forEach(r => {
            if (r.owner_id) currentRosterByOwner[r.owner_id] = r.roster_id;
        });

        const ownerHistory = {};
        const championships = {};
        const flatHist = [];

        seasons.forEach(s => {
            const season = s.season;
            const userById = {};
            (s.users || []).forEach(u => { userById[u.user_id] = u; });
            const rosterByRid = {};
            (s.rosters || []).forEach(r => { rosterByRid[r.roster_id] = r; });

            const placements = placementsFromBracket(s.bracket);
            // Every team that appears in the winners (championship) bracket made the playoffs —
            // including first-round losers who never reach a placement game.
            const bracketTeams = new Set();
            (s.bracket || []).forEach(g => { if (g && g.w != null) bracketTeams.add(g.w); if (g && g.l != null) bracketTeams.add(g.l); });

            // Championship record — capture both the current-roster mapping (for
            // achievements / "Dirty Mike has 2 titles") and the historical owner
            // name (for the championship timeline, especially when an owner has
            // left the league).
            const champRid = Object.keys(placements).find(rid => placements[rid] === 1);
            const runRid   = Object.keys(placements).find(rid => placements[rid] === 2);
            if (season) {
                const champRoster = champRid ? rosterByRid[champRid] : null;
                const runRoster   = runRid   ? rosterByRid[runRid]   : null;
                const champUser = champRoster?.owner_id ? userById[champRoster.owner_id] : null;
                const runUser   = runRoster?.owner_id   ? userById[runRoster.owner_id]   : null;
                const champCur = champRoster?.owner_id ? currentRosterByOwner[champRoster.owner_id] : null;
                const runCur   = runRoster?.owner_id   ? currentRosterByOwner[runRoster.owner_id]   : null;
                if (champRid != null || runRid != null) {
                    championships[season] = {
                        champion: champCur ?? null,
                        runnerUp: runCur ?? null,
                        // Final-four as CURRENT roster_ids (same space as champion/runnerUp), so
                        // league-detail dynasty-score reads c.semiFinals consistently (was undefined).
                        semiFinals: semiFinalistRosters(s.bracket)
                            .map(rid => { const ro = rosterByRid[rid]; return ro && ro.owner_id ? currentRosterByOwner[ro.owner_id] : null; })
                            .filter(x => x != null),
                        championName: champUser?.metadata?.team_name || champUser?.display_name || (champRid ? 'Team ' + champRid : null),
                        championAvatar: champUser?.avatar || null,
                        championOwnerId: champRoster?.owner_id || null,
                        championStillActive: champCur != null,
                        runnerUpName: runUser?.metadata?.team_name || runUser?.display_name || (runRid ? 'Team ' + runRid : null),
                        runnerUpAvatar: runUser?.avatar || null,
                        runnerUpOwnerId: runRoster?.owner_id || null,
                        runnerUpStillActive: runCur != null,
                    };
                }
            }

            // Per-roster aggregation
            (s.rosters || []).forEach(r => {
                const userId = r.owner_id;
                if (!userId) return;
                const user = userById[userId];
                if (!ownerHistory[userId]) {
                    ownerHistory[userId] = {
                        ownerId: userId,
                        ownerName: user?.metadata?.team_name || user?.display_name || ('Team ' + userId),
                        avatar: user?.avatar,
                        currentRosterId: currentRosterByOwner[userId] != null ? currentRosterByOwner[userId] : null,
                        rosterId: currentRosterByOwner[userId] != null ? currentRosterByOwner[userId] : null,
                        championships: 0,
                        runnerUps: 0,
                        playoffAppearances: 0,
                        wins: 0,
                        losses: 0,
                        ties: 0,
                        pointsFor: 0,
                        pointsAgainst: 0,
                        tenure: 0,
                        seasonHistory: [],
                        champSeasons: [],
                        runnerUpSeasons: [],
                        rivalries: [],
                        numberOnePicks: [],
                        draftHits: 0,
                        draftTotal: 0,
                        draftHitRate: 0,
                        totalTrades: 0,
                        tradesWon: 0,
                        totalDHQ: 0,
                        playoffRecord: '',
                    };
                }
                const oh = ownerHistory[userId];
                const w = r.settings?.wins || 0;
                const l = r.settings?.losses || 0;
                const t = r.settings?.ties || 0;
                const fpts = (r.settings?.fpts || 0) + ((r.settings?.fpts_decimal || 0) / 100);
                const fptsAg = (r.settings?.fpts_against || 0) + ((r.settings?.fpts_against_decimal || 0) / 100);

                oh.wins += w;
                oh.losses += l;
                oh.ties += t;
                oh.pointsFor += fpts;
                oh.pointsAgainst += fptsAg;
                oh.tenure += 1;

                const place = placements[r.roster_id] || null;
                if (place === 1) { oh.championships++; oh.champSeasons.push(String(season)); }
                else if (place === 2) { oh.runnerUps++; oh.runnerUpSeasons.push(String(season)); }
                if (bracketTeams.has(r.roster_id)) oh.playoffAppearances++;

                const finish = rosterFinish(place, w, l, t);
                oh.seasonHistory.push({ season: String(season), wins: w, losses: l, ties: t, fpts, fptsAg, place, finish, rosterId: r.roster_id });

                // flat history for achievements.js (keyed by current rosterId)
                const curRid = currentRosterByOwner[userId];
                if (curRid != null && season) {
                    flatHist.push({ rosterId: curRid, season, wins: w, losses: l, ties: t, place });
                }
            });
        });

        // Sort each season history ascending + compute derived per-owner fields
        Object.values(ownerHistory).forEach(oh => {
            oh.seasonHistory.sort((a, b) => Number(a.season) - Number(b.season));
            oh.record = oh.wins + '-' + oh.losses + (oh.ties ? '-' + oh.ties : '');
            const totalGames = oh.wins + oh.losses + oh.ties;
            oh.winPct = totalGames ? (oh.wins / totalGames) : 0;
            oh.avgPointsFor = oh.tenure ? (oh.pointsFor / oh.tenure) : 0;
            // Best & worst single-season finishes
            if (oh.seasonHistory.length) {
                oh.bestSeason = oh.seasonHistory.reduce((b, s) => ((s.wins || 0) > (b?.wins || -1) ? s : b), null);
                oh.worstSeason = oh.seasonHistory.reduce((w, s) => ((s.losses || 0) > (w?.losses || -1) ? s : w), null);
                // Highest single-season PF
                oh.highestPfSeason = oh.seasonHistory.reduce((h, s) => ((s.fpts || 0) > (h?.fpts || -1) ? s : h), null);
            }
        });

        // ── All-Time Team + Hall of Fame ──
        // Aggregate every starter from every championship-winning lineup.
        // allTimeTeam: { pid: { pid, appearances, championships: [{ season, ownerName, points }], totalPoints, bestSeason } }
        // hallOfFame:  pids appearing in 2+ championship lineups
        const allTimeTeam = {};
        seasons.forEach(s => {
            const m = s.championshipMatchup;
            if (!m) return;
            // Determine the owner name for the champion roster (this season's roster)
            const champRoster = (s.rosters || []).find(r => r.roster_id === m.championRosterId);
            const champUserId = champRoster?.owner_id;
            const champUser = (s.users || []).find(u => u.user_id === champUserId);
            const ownerName = champUser?.metadata?.team_name || champUser?.display_name || ('Team ' + m.championRosterId);
            const starters = m.starters || [];
            const starterPoints = m.starterPoints || [];
            const positions = m.rosterPositions || [];
            starters.forEach((pid, idx) => {
                if (!pid || pid === '0') return; // empty slot
                const slot = positions[idx] || null;
                const pts = starterPoints[idx] || 0;
                if (!allTimeTeam[pid]) {
                    allTimeTeam[pid] = {
                        pid,
                        appearances: 0,
                        championships: [],
                        totalPoints: 0,
                        slots: {}, // slot -> count
                    };
                }
                const entry = allTimeTeam[pid];
                entry.appearances += 1;
                entry.championships.push({ season: s.season, ownerName, ownerId: champUserId, points: pts, slot });
                entry.totalPoints += pts;
                if (slot) entry.slots[slot] = (entry.slots[slot] || 0) + 1;
            });
        });
        // Sort championships within each player by season desc
        Object.values(allTimeTeam).forEach(p => p.championships.sort((a, b) => (b.season || 0) - (a.season || 0)));
        const hallOfFame = Object.values(allTimeTeam).filter(p => p.appearances >= 2)
            .sort((a, b) => b.appearances - a.appearances || b.totalPoints - a.totalPoints);

        const cache = {
            fetchedAt: Date.now(), leagueId: startId,
            ownerHistory, championships, flatHist, seasonsLoaded: chain.length,
            allTimeTeam, hallOfFame,
        };
        try { localStorage.setItem(CACHE_KEY(startId), JSON.stringify(cache)); } catch { /* swallow quota */ }

        populateGlobals(cache, startId);
        return cache;
    }

    function ownerHistoryByRoster(cache) {
        // Trophy Room reads via global function. Active owners are keyed by
        // their current rosterId (so champion lookups via roster_id work).
        // Former owners (no longer in the league) are keyed by a synthetic
        // 'former:<ownerId>' so they still appear in iterations like the
        // All-Time Standings without colliding with current rosters.
        const byKey = {};
        Object.values(cache?.ownerHistory || {}).forEach(oh => {
            if (oh.currentRosterId != null) {
                byKey[oh.currentRosterId] = { ...oh, isFormer: false };
            } else {
                byKey['former:' + oh.ownerId] = {
                    ...oh,
                    isFormer: true,
                    rosterId: 'former:' + oh.ownerId, // stable React key
                };
            }
        });
        return byKey;
    }

    function readCache(leagueId) {
        if (!leagueId) return null;
        const key = String(leagueId);
        if (memoryCache[key]) return memoryCache[key];
        try {
            const raw = localStorage.getItem(CACHE_KEY(key));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed) memoryCache[key] = parsed;
            return parsed;
        } catch { return null; }
    }

    function isFresh(cache) {
        return !!(cache && Date.now() - cache.fetchedAt < CACHE_TTL);
    }

    function populateGlobals(cache, leagueId) {
        if (!cache || !leagueId) return;
        const key = String(leagueId);
        memoryCache[key] = cache;
        activeLeagueId = key;
        window.buildOwnerHistory = function (requestedLeagueId) {
            const lookupId = requestedLeagueId != null ? String(requestedLeagueId) : activeLeagueId;
            return ownerHistoryByRoster(readCache(lookupId));
        };

        // Achievements reads dhq_hist_<leagueId>
        try { localStorage.setItem('dhq_hist_' + leagueId, JSON.stringify(cache.flatHist || [])); } catch { /* swallow */ }

        // App.LI.championships is the active league snapshot. Do not merge
        // across leagues; identical season keys otherwise leak old champions.
        window.App = window.App || {};
        window.App.LI = window.App.LI || {};
        window.App.LI.championshipLeagueId = key;
        window.App.LI.championships = Object.assign({}, cache.championships || {});

        // Notify listeners (React widgets re-render via useState handler)
        try { window.dispatchEvent(new CustomEvent('wr_history_loaded', { detail: { leagueId, seasons: cache.seasonsLoaded } })); } catch {}
    }

    function loadIfMissing(currentLeague) {
        const lid = currentLeague?.id || currentLeague?.league_id;
        if (!lid) return Promise.resolve(null);
        const cached = readCache(lid);
        if (isFresh(cached)) {
            populateGlobals(cached, lid);
            return Promise.resolve(cached);
        }
        return build(currentLeague);
    }

    function getCached(leagueId) {
        return readCache(leagueId);
    }

    window.WrHistory = {
        load: build,
        loadIfMissing,
        getCached,
        playoffRecord,
        championshipPathMatchIds,
        getOwnerHistory: function (leagueId) {
            return ownerHistoryByRoster(readCache(leagueId));
        },
        getChampionships: function (leagueId) {
            const c = readCache(leagueId);
            return c?.championships || {};
        },
        getAllTimeTeam: function (leagueId) {
            const c = getCached(leagueId);
            return c?.allTimeTeam || {};
        },
        getHallOfFame: function (leagueId) {
            const c = getCached(leagueId);
            return c?.hallOfFame || [];
        },
        clear: function (leagueId) {
            try {
                localStorage.removeItem(CACHE_KEY(leagueId));
                localStorage.removeItem('dhq_hist_' + leagueId);
            } catch {}
        },
    };
})();
