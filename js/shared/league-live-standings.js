// ══════════════════════════════════════════════════════════════════
// js/shared/league-live-standings.js — window.App.LeagueLiveStandings
// A standings snapshot reconstructed from completed matchup weeks. Official
// records are display-only: their posting time must never decide the baseline.
// Ported from C2 (WarRoom-sandbox, 2026-09-27) unchanged except that the
// provider check also reads our `_platform` marker. Pure: compute(options)
// → { rows, baselineRows, officialRows, week, status, median, complete,
// message }. status: 'official' (format/week/history not supported — the
// official Sleeper record is shown) | 'baseline' (entering the week) |
// 'live' (current scores applied) | 'partial' (some scores missing).
// Weeks with a missing/malformed/duplicate row are refused, never zeroed.
// Median (league_average_match) in a live week waits until every team has
// started when startedRosterIds is given (C2 applied it once every matchup
// had one started side, so a late team took a "Median L" at 0.00).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
    const id = v => String(v);
    const points = r => num(r?.custom_points) ?? num(r?.points);
    const result = (a, b) => a > b ? 'W' : a < b ? 'L' : 'T';
    function add(row, outcome) {
        row[outcome === 'W' ? 'wins' : outcome === 'L' ? 'losses' : 'ties']++;
    }
    function rank(rows) {
        // Remove addition noise before PF breaks record ties (e.g. 0.1 + 0.2).
        rows.forEach(r => { r.pointsFor = Math.round(r.pointsFor * 1e6) / 1e6; if (r.pointsAgainst != null) r.pointsAgainst = Math.round(r.pointsAgainst * 1e6) / 1e6; });
        const sorted = rows.slice().sort((a,b) => b.wins-a.wins || a.losses-b.losses || b.pointsFor-a.pointsFor || id(a.rosterId).localeCompare(id(b.rosterId)));
        const played = sorted.some(r => r.wins+r.losses+r.ties > 0);
        sorted.forEach((r,i) => {
            const prev = sorted[i-1];
            r.rank = !played ? null : prev && prev.wins === r.wins && prev.losses === r.losses && prev.pointsFor === r.pointsFor ? prev.rank : i+1;
            r.streak = r.form.length ? (() => { const last=r.form[r.form.length-1]; let n=0; for(let j=r.form.length-1;j>=0 && r.form[j]===last;j--) n++; return last+n; })() : null;
        });
        return sorted;
    }
    function compute(options) {
        const {league, standings = [], board, priorWeeks = [], started = false, startedRosterIds, currentWeek} = options || {};
        const week = Number(options?.week ?? board?.week);
        const rosters = league?.rosters || [];
        const source = rosters.length ? rosters : standings.map(r => ({roster_id:r.rosterId}));
        const officialRows = rank(source.map(roster => {
            const meta = standings.find(r => id(r.rosterId) === id(roster.roster_id)) || {};
            const s = roster.settings || {};
            return {...meta, rosterId:roster.roster_id, wins:num(s.wins) ?? num(meta.wins) ?? 0, losses:num(s.losses) ?? num(meta.losses) ?? 0, ties:num(s.ties) ?? num(meta.ties) ?? 0,
                pointsFor:num(s.fpts) !== null ? s.fpts+(num(s.fpts_decimal) ?? 0)/100 : num(meta.pointsFor) ?? 0,
                pointsAgainst:num(s.fpts_against) !== null ? s.fpts_against+(num(s.fpts_against_decimal) ?? 0)/100 : num(meta.pointsAgainst),
                form:[],currentResult:null,currentPoints:null,opponentPoints:null,opponentRosterId:null,medianResult:null,rankChange:null,baselineRank:null};
        }));
        const fallback = message => ({rows:officialRows,officialRows,baselineRows:[],week,status:'official',message,complete:false,median:null});
        const provider = String(league?._platform || league?.platform || league?.provider || '').toLowerCase();
        if (!league || league._mfl || league._mflLeagueId || league._espn || league._yahoo || (provider && provider !== 'sleeper') || App.Chopped?.isChopped?.(league) || options?.isChopped || league?.type === 'chopped' || league?.leagueSkin?.type === 'chopped') return fallback('Live standings are unavailable for this league format.');
        const start = Number(league.settings?.start_week) || 1;
        const playoff = Number(league.settings?.playoff_week_start) || 19;
        if (!Number.isInteger(week) || week < start || week > 18 || week >= playoff) return fallback('Official standings · outside the regular-season schedule.');
        const medianEnabled = Number(league.settings?.league_average_match) === 1;
        const rows = officialRows.map(r => ({...r,wins:0,losses:0,ties:0,pointsFor:0,pointsAgainst:0,form:[]}));
        const byId = new Map(rows.map(r => [id(r.rosterId),r]));
        if (byId.size !== rows.length || !rows.length) return fallback('The league roster list is unavailable.');
        const history = new Map(Array.isArray(priorWeeks) ? priorWeeks.map(w => [Number(w.week),w.rows]) : Object.entries(priorWeeks).map(([w,v]) => [Number(w),v]));
        function inspect(raw) {
            if (!Array.isArray(raw)) return null;
            const seen = new Set(), groups = new Map();
            for (const r of raw) {
                if (!r || !byId.has(id(r.roster_id)) || seen.has(id(r.roster_id))) return null;
                seen.add(id(r.roster_id));
                const key = r.matchup_id == null ? 'bye:'+r.roster_id : 'match:'+r.matchup_id;
                if (!groups.has(key)) groups.set(key,[]);
                groups.get(key).push(r);
            }
            if (seen.size !== rows.length || [...groups.values()].some(g => g.length > 2 || (g.length === 1 && g[0].matchup_id != null))) return null;
            return [...groups.values()];
        }
        function apply(groups, historical) {
            const startSet = startedRosterIds == null ? null : new Set(Array.from(startedRosterIds,id));
            let applied = false, pending = false;
            const all = groups.flat();
            const active = g => historical || (startSet ? g.some(r => startSet.has(id(r.roster_id))) : started);
            groups.forEach(g => {
                const valid = g.every(r => points(r) !== null), begun = active(g);
                if (!historical) g.forEach(r => {
                    const target=byId.get(id(r.roster_id)), opponent=g.find(x => x!==r);
                    target.currentPoints=points(r); target.opponentPoints=opponent ? points(opponent) : null; target.opponentRosterId=opponent?.roster_id ?? null;
                });
                if (!valid || !begun) { if (begun && !valid) pending=true; return; }
                applied=true;
                g.forEach(r => {
                    const target=byId.get(id(r.roster_id)), opponent=g.find(x => x!==r);
                    target.pointsFor+=points(r);
                    if (opponent) {
                        const outcome=result(points(r),points(opponent));
                        target.pointsAgainst+=points(opponent); add(target,outcome); target.form.push(outcome);
                        if (!historical) target.currentResult=outcome;
                    }
                });
            });
            let median=null;
            if (medianEnabled) {
                // The league-wide median needs every score, including bye teams.
                // Live weeks with started-roster evidence also need EVERY team
                // started: an unstarted team's 0 is not a score, so it must not
                // set the median or take a median loss (matches the scoreboard's
                // "League median so far", which waits for every team).
                const everyRowStarted = historical || !startSet || all.every(r => startSet.has(id(r.roster_id)));
                if (all.every(r => points(r)!==null) && groups.every(active) && everyRowStarted) {
                    const scores=all.map(points).sort((a,b)=>a-b), middle=Math.floor(scores.length/2);
                    median=scores.length%2 ? scores[middle] : (scores[middle-1]+scores[middle])/2;
                    all.forEach(r => {const target=byId.get(id(r.roster_id)), outcome=result(points(r),median); add(target,outcome); if(!historical) target.medianResult=outcome;});
                } else if (applied) pending=true;
            }
            return {applied,pending,median};
        }
        for (let w=start;w<week;w++) {
            const groups=inspect(history.get(w));
            if (!groups || groups.flat().some(r => points(r)===null)) return fallback('Complete scores before Week '+week+' are needed to calculate live standings.');
            apply(groups,true);
        }
        const baselineRows=rank(rows.map(r=>({...r,form:r.form.slice()})));
        const baselineRanks=new Map(baselineRows.map(r=>[id(r.rosterId),r.rank]));
        rows.forEach(r=>{r.baselineRank=baselineRanks.get(id(r.rosterId));});
        const groups=inspect(board?.rows ?? board?.groups?.flatMap(g=>g.teams));
        let state={applied:false,pending:false,median:null};
        const future=Number.isFinite(Number(currentWeek)) && week>Number(currentWeek);
        if (groups && !future && (board?.week == null || Number(board.week) === week)) state=apply(groups,false);
        else if (!future && (started || startedRosterIds?.length)) state.pending=true;
        const sorted=rank(rows);
        sorted.forEach(r=>{r.rankChange=r.rank!==null && r.baselineRank!==null ? r.baselineRank-r.rank : null;});
        const status=state.pending ? 'partial' : state.applied ? 'live' : 'baseline';
        return {rows:sorted,baselineRows,officialRows,week,status,median:state.median,complete:!state.pending,
            message:status==='partial' ? 'Some scores are unavailable or have not started; standings are provisional.' : status==='live' ? 'If the current scores hold · movement since entering Week '+week : 'Standings entering Week '+week};
    }
    App.LeagueLiveStandings={compute};
})(typeof window !== 'undefined' ? window : globalThis);
