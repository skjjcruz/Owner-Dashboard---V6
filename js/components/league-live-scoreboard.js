// ══════════════════════════════════════════════════════════════════
// js/components/league-live-scoreboard.js — "Around the league"
// Ported from C2 (WarRoom-sandbox js/components/league-live-scoreboard.js +
// League Central's live standings table and league-live-standings.css,
// 2026-09-27), re-themed onto Dynasty HQ tokens and card-radius tokens.
// Scores are provider snapshots from Sleeper's scored matchup feed — never
// projections, never inferred game completion, never recomputed from a
// league's current roster. Missing = "—", never 0.
//
// Exports:
//   window.LeagueLiveScoreboard(props)  — C2's weekly scoreboard (C2 props:
//     currentLeague, myRoster, playersData, getOwnerName, getPlayerName,
//     setActiveTab, selectedWeek, onWeekChange, onRefresh). Additive props:
//     board (share a parent's App.LeagueLiveScores.useScores snapshot),
//     interval (poll cadence, see league-live-scores.js), startedIds (Set of
//     roster ids whose week has begun — others read "—", not 0.00), games
//     (NFL games from App.NflContext.loadScores, for per-player "—"/BYE),
//     statusText (live/idle line), onOpenStandings.
//   window.LeagueLiveStandingsPanel(props) — the live table (C2 League
//     Central's lct-* table): { currentLeague, myRoster, board, playersData,
//     getOwnerName, active }.
//   window.WrAroundTheLeague(props) — Game Day's section: one shared score
//     subscription for both views, NFL kickoff schedule for live gating,
//     honest notes for ESPN/MFL. { currentLeague, myRoster, playersData, week }.
//
// Dropped from C2: the "NFL game scores" drawer. Our production NFL relay
// (nfl-scoreboard edge fn) caches a week for up to 3h, so its in-game scores
// would be stale while labelled live. Kickoff times (all we use) never are.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const CSS = `
.lls{border:1px solid var(--ov-4,rgba(255,255,255,.08));border-radius:var(--card-radius,10px);background:var(--black,#121217);padding:14px 16px;color:var(--white,#f5f2ea);margin-bottom:14px;min-width:0;max-width:100%;box-sizing:border-box;font-family:var(--font-body,'DM Sans',sans-serif)}
.lls *,.lls *::before,.lls *::after{box-sizing:border-box}
.lls-header,.lls-controls{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.lls-header{margin-bottom:10px}
.lls-heading{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;min-width:0}
.lls h3{margin:0;font-family:var(--font-title,'Rajdhani',sans-serif);font-size:var(--text-title,1.125rem);font-weight:700;letter-spacing:.03em;color:var(--white,#f5f2ea)}
.lls-note{font-size:var(--text-micro,.6875rem);line-height:1.55;color:var(--text-muted,#8d887e);margin:6px 0 10px;overflow-wrap:anywhere}
.lls-heading .lls-note{margin:0}
.lls-live{display:inline-flex;align-items:center;gap:6px;color:var(--good,#2ecc71);font-weight:600}
.lls-live::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.lls-controls{gap:8px}
.lls-controls label{font-size:var(--text-micro,.6875rem);color:var(--silver,#bdb8ad);display:inline-flex;align-items:center;gap:6px}
.lls button,.lls select{border:1px solid var(--acc-line1,rgba(212,175,55,.3));border-radius:var(--card-radius-sm,8px);background:var(--off-black,#1b1b22);color:var(--white,#f5f2ea);min-height:34px;padding:5px 10px;font:inherit;font-size:var(--text-micro,.6875rem);font-weight:600}
.lls button{cursor:pointer}.lls button:disabled{opacity:.55;cursor:wait}
.lls button:focus-visible,.lls select:focus-visible,.lls-matchups:focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:3px}
.lls-seg{display:inline-flex;gap:3px;padding:3px;border:1px solid var(--ov-4,rgba(255,255,255,.08));border-radius:var(--card-radius-sm,8px);background:var(--off-black,#1b1b22)}
.lls .lls-seg button{border:1px solid transparent;background:transparent;color:var(--silver,#bdb8ad);border-radius:var(--card-radius-xs,5px);min-height:30px}
.lls .lls-seg button[aria-pressed=true]{background:var(--acc-fill2,rgba(212,175,55,.12));border-color:var(--acc-line1,rgba(212,175,55,.3));color:var(--gold,#d4af37)}
.lls-grid{display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:10px}
.lls-card{border:1px solid var(--ov-4,rgba(255,255,255,.08));border-radius:var(--card-radius-sm,8px);background:var(--off-black,#1b1b22);padding:12px;min-width:0;color:inherit;text-align:left;font:inherit;width:100%}
.lls-card-own{border-color:var(--acc-line2,rgba(212,175,55,.42))}
button.lls-card{cursor:pointer;display:block}
button.lls-card:hover{border-color:var(--acc-line1,rgba(212,175,55,.3))}
.lls-team{display:flex;gap:10px;justify-content:space-between;align-items:center;padding:6px 0}
.lls-team-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-label,.75rem)}
.lls-team-name small,.lls-you{display:inline-block;margin-left:6px;font-size:var(--text-micro,.6875rem);letter-spacing:.06em;color:var(--gold,#d4af37);font-weight:700}
.lls-score{font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;font-size:1.2rem;white-space:nowrap;font-weight:600}
.lls-own .lls-score{color:var(--gold,#d4af37)}
.lls-rank{font-size:var(--text-micro,.6875rem);color:var(--text-muted,#8d887e);text-transform:uppercase;letter-spacing:.06em}
.lls-error{color:var(--warn,#f0a500)}
.lls-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px}
.lls-footer p{margin:0;flex:1;min-width:180px}
.lls-versus{display:grid;grid-template-columns:minmax(0,1fr) 22px minmax(0,1fr);gap:8px;align-items:stretch}
.lls-side{display:grid;grid-template-rows:1fr auto auto;min-width:0;gap:2px}
.lls-side-right{text-align:right}
.lls-owner{font-size:var(--text-label,.75rem);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.4}
.lls-side-label{font-size:var(--text-micro,.6875rem);letter-spacing:.04em;color:var(--text-muted,#8d887e)}
.lls-own .lls-side-label{color:var(--gold,#d4af37)}
.lls-side .lls-score{font-size:1.35rem;margin-top:2px}
.lls-vs{align-self:center;text-align:center;color:var(--text-muted,#8d887e);font-size:var(--text-micro,.6875rem);font-weight:600}
.lls-more{margin-top:8px;padding-top:8px;border-top:1px solid var(--ov-4,rgba(255,255,255,.08));font-size:var(--text-micro,.6875rem);color:var(--silver,#bdb8ad)}
.lls-compact .lls-matchups{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:4px;scrollbar-width:thin;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
.lls-compact .lls-matchups>.lls-card{flex:0 0 230px;scroll-snap-align:start;padding:10px 12px}
.lls-compact .lls-side .lls-score{font-size:1.1rem}
.lls-expanded .lls-matchups{grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))}
.lls-expanded .lls-open{grid-column:1/-1}
.lls-breakdown{margin-top:10px;border-top:1px solid var(--ov-4,rgba(255,255,255,.08))}
.lls-comparison-row{display:grid;grid-template-columns:minmax(0,1fr) 54px 46px 54px minmax(0,1fr);gap:8px;align-items:center;padding:8px 4px;border-top:1px solid var(--ov-3,rgba(255,255,255,.05))}
.lls-comparison-row:nth-child(even){background:var(--ov-1,rgba(255,255,255,.018))}
.lls-comparison-head{font-size:var(--text-micro,.6875rem);color:var(--text-muted,#8d887e);border-top:0}
.lls-comparison-head>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lls-comparison-head>span:not(:first-child):not(:last-child){text-align:center}
.lls-comparison-head>span:last-child{text-align:right}
.lls-player{min-width:0;display:flex;flex-direction:column;gap:2px}
.lls-player strong{font-size:var(--text-label,.75rem);font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lls-player small{font-size:var(--text-micro,.6875rem);color:var(--text-muted,#8d887e)}
.lls-player-right{text-align:right}
.lls-player-points{text-align:center;font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;font-size:var(--text-label,.75rem)}
.lls-slot{justify-self:center;max-width:100%;padding:3px 4px;font-size:var(--text-micro,.6875rem);font-weight:700;text-align:center;color:var(--gold,#d4af37);background:var(--acc-fill1,rgba(212,175,55,.09));border-radius:var(--card-radius-xs,5px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lls-starter-head,.lls-starter{display:flex;justify-content:space-between;gap:10px;padding:7px 0;font-size:var(--text-label,.75rem)}
.lls-starter-head{color:var(--gold,#d4af37);border-bottom:1px solid var(--ov-4,rgba(255,255,255,.08));font-weight:600}
.lls-starter>span{min-width:0;overflow-wrap:anywhere}
.lls-starter small{color:var(--text-muted,#8d887e);font-size:var(--text-micro,.6875rem)}
.lls-starter strong{font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums;white-space:nowrap}
.lls-team-block+.lls-team-block{margin-top:10px}
@media(max-width:767px){
 .lls{padding:12px}
 .lls button,.lls select{min-height:44px;padding:8px 12px}
 .lls .lls-seg button{min-height:44px}
 .lls-compact .lls-matchups>.lls-card{flex-basis:100%}
 .lls-comparison-row{grid-template-columns:minmax(0,1fr) 42px 36px 42px minmax(0,1fr);gap:4px;padding:8px 0}
}
/* Live standings table (C2 league-live-standings.css, re-tokened). */
.lct-live-panel{min-width:0;max-width:100%}
.lct-status{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.lct-status-copy{flex:1 1 170px;min-width:0}
.lct-status-copy strong{display:block;font-size:var(--text-label,.75rem);line-height:1.4;font-weight:700;color:var(--white,#f5f2ea)}
.lct-status-copy small{display:block;font-size:var(--text-micro,.6875rem);line-height:1.5;color:var(--text-muted,#8d887e);margin-top:2px}
.lct-table-wrap{width:100%;max-width:100%;min-width:0;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
.lct-live-panel table.lct-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:var(--text-label,.75rem)}
.lct-live-panel .lct-table th,.lct-live-panel .lct-table td{padding:9px 8px;vertical-align:middle;border:0;border-bottom:1px solid var(--ov-4,rgba(255,255,255,.08));text-align:right}
.lct-live-panel .lct-table th{color:var(--text-muted,#8d887e);font-size:var(--text-micro,.6875rem);line-height:1.4;font-weight:600;white-space:nowrap;text-transform:uppercase;letter-spacing:.04em}
.lct-live-panel .lct-table .lct-rank-col{width:40px;padding-left:4px;padding-right:4px;text-align:center}
.lct-live-panel .lct-table .lct-team-col{text-align:left}
.lct-live-panel .lct-table .lct-record{width:70px;white-space:nowrap;font-family:var(--font-mono,monospace);font-variant-numeric:tabular-nums}
.lct-live-panel .lct-table .lct-desktop{width:72px;font-variant-numeric:tabular-nums;font-family:var(--font-mono,monospace)}
.lct-live-panel .lct-table .lct-week{width:112px}
.lct-rank-number{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font:600 var(--text-label,.75rem)/1.15 var(--font-mono,monospace);font-variant-numeric:tabular-nums;color:var(--silver,#bdb8ad)}
.lct-movement{display:block;font:500 var(--text-micro,.6875rem)/1.1 var(--font-mono,monospace);white-space:nowrap}
.lct-movement[data-direction=up]{color:var(--good,#2ecc71)}
.lct-movement[data-direction=down]{color:var(--bad,#e74c3c)}
.lct-movement[data-direction=flat]{color:var(--text-muted,#8d887e)}
.lct-team-name{display:block;min-width:0;font-size:var(--text-label,.75rem);font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--white,#f5f2ea)}
.lct-team-meta{display:block;font-size:var(--text-micro,.6875rem);line-height:1.4;color:var(--text-muted,#8d887e);margin-top:2px}
.lct-live-panel .lct-table td.lct-record{color:var(--silver,#bdb8ad)}
.lct-result{display:inline-flex;justify-content:center;align-items:center;min-width:24px;min-height:22px;padding:2px 6px;border-radius:var(--card-radius-xs,5px);border:1px solid var(--ov-5,rgba(189,184,173,.18));background:var(--ov-1,rgba(189,184,173,.04));color:var(--silver,#bdb8ad);font:700 var(--text-micro,.6875rem)/1.2 var(--font-mono,monospace)}
.lct-result[data-result=W]{color:var(--good,#2ecc71);border-color:color-mix(in srgb,var(--good,#2ecc71) 30%,transparent);background:color-mix(in srgb,var(--good,#2ecc71) 9%,transparent)}
.lct-result[data-result=L]{color:var(--bad,#e74c3c);border-color:color-mix(in srgb,var(--bad,#e74c3c) 30%,transparent);background:color-mix(in srgb,var(--bad,#e74c3c) 8%,transparent)}
.lct-result[data-result=T]{color:var(--gold,#d4af37);border-color:var(--acc-line1,rgba(212,175,55,.3));background:var(--acc-fill1,rgba(212,175,55,.07))}
.lct-result[data-result=none]{color:var(--text-muted,#8d887e);background:transparent}
.lct-week-score{display:block;margin-top:3px;font:500 var(--text-micro,.6875rem)/1.35 var(--font-mono,monospace);font-variant-numeric:tabular-nums;color:var(--silver,#bdb8ad);white-space:nowrap}
.lct-live-panel .lct-table .lct-own>td{background:var(--acc-fill1,rgba(212,175,55,.05))}
.lct-live-panel .lct-table .lct-own>td:first-child{box-shadow:inset 2px 0 0 var(--gold,#d4af37)}
.lct-live-panel .lct-table .lct-own .lct-rank-number{color:var(--gold,#d4af37)}
.lct-live-panel .lct-table .lct-cutline>td{border-bottom:1px solid var(--acc-line3,rgba(212,175,55,.55))}
.lct-live-dot{display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;background:var(--good,#2ecc71);vertical-align:middle}
.lct-live-panel .lct-phone{display:none}
.lct-live-panel details summary{font-size:var(--text-micro,.6875rem);color:var(--silver,#bdb8ad);cursor:pointer;padding:10px 0;min-height:44px;display:flex;align-items:center}
@media(max-width:767px){
 .lct-live-panel .lct-desktop{display:none}
 .lct-live-panel .lct-phone{display:block}
 .lct-live-panel .lct-table th,.lct-live-panel .lct-table td{padding:9px 5px}
 .lct-live-panel .lct-table .lct-rank-col{width:34px;padding-left:2px;padding-right:2px}
 .lct-live-panel .lct-table .lct-record{width:62px}
 .lct-live-panel .lct-table .lct-week{width:96px}
}
@media(max-width:360px){
 .lct-live-panel .lct-table .lct-rank-col{width:28px}
 .lct-live-panel .lct-table .lct-record{width:56px}
 .lct-live-panel .lct-table .lct-week{width:86px}
}
`;
    // One <style> for every instance (the panel may mount more than once).
    function useStyles() {
        React.useEffect(() => {
            if (document.getElementById('wr-lls-styles')) return;
            const el = document.createElement('style');
            el.id = 'wr-lls-styles';
            el.textContent = CSS;
            document.head.appendChild(el);
        }, []);
    }

    const svc = () => window.App && window.App.LeagueLiveScores;
    const fmt = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2);
    const sameId = (a, b) => a != null && b != null && String(a) === String(b);
    const TEAM_ALIASES = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
    function defaultOwnerName(league, rosterId) {
        const roster = ((league && league.rosters) || []).find(r => sameId(r.roster_id, rosterId));
        const user = ((league && league.users) || []).find(u => roster && sameId(u.user_id, roster.owner_id));
        return (roster && roster.metadata && roster.metadata.team_name) || (user && user.metadata && user.metadata.team_name)
            || (user && user.display_name) || ('Team ' + rosterId);
    }
    function nflGameFor(games, playersData, pid) {
        const raw = String((playersData && playersData[pid] && playersData[pid].team) || '').toUpperCase();
        const team = TEAM_ALIASES[raw] || raw;
        if (!team || !games) return { team, game: null };
        return { team, game: games.find(g => g.home === team || g.away === team) || null };
    }

    // The league's real week span from Sleeper settings: start_week through the
    // last playoff week (rounds = ceil(log2(playoff_teams)); playoff_round_type
    // 1 = two-week final, 2 = two weeks per round). No playoffs (pws 0, e.g.
    // guillotine) or missing settings → week 18.
    function leagueWeekSpan(league) {
        const s = (league && league.settings) || {};
        const first = Math.max(1, Math.min(18, Number(s.start_week) || 1));
        const pws = Number(s.playoff_week_start) || 0, teams = Number(s.playoff_teams) || 0;
        let last = 18;
        if (pws > 0 && teams >= 2) {
            const rounds = Math.ceil(Math.log2(teams));
            const type = Number(s.playoff_round_type) || 0;
            const weeks = type === 2 ? rounds * 2 : type === 1 ? rounds + 1 : rounds;
            last = Math.min(18, pws + weeks - 1);
        } else if (pws > 0) last = Math.min(18, pws - 1);
        return { first, last: Math.max(first, last) };
    }

    // ── C2's scoreboard (adapted) ─────────────────────────────────────
    function LeagueLiveScoreboard(props) {
        const { currentLeague, myRoster, playersData, getOwnerName, getPlayerName, setActiveTab, selectedWeek, onWeekChange, onRefresh,
            board: boardProp, interval, startedIds, games, statusText, headerRight } = props;
        useStyles();
        const service = svc();
        const isPhone = !!window.WR?.useViewport?.().isPhone;
        const leagueId = currentLeague?.league_id || currentLeague?.id || '';
        const defaultWeek = service.currentWeek(currentLeague);
        const [selection, setSelection] = React.useState(null);
        const [expanded, setExpanded] = React.useState(false);
        const [openKey, setOpenKey] = React.useState(null);
        const week = selectedWeek != null ? selectedWeek : selection?.leagueId === leagueId ? selection.week : defaultWeek;
        const own = service.useScores({ league: currentLeague, week, enabled: !boardProp, interval });
        const board = boardProp || own;
        const chopped = !!window.App?.Chopped?.isChopped?.(currentLeague);
        const settings = currentLeague?.settings || {};
        const playoffStart = Number(settings.playoff_week_start) || 0;
        const isPlayoffWeek = !chopped && playoffStart > 0 && week >= playoffStart;
        const span = leagueWeekSpan(currentLeague);
        const weekOptions = Array.from({ length: span.last - span.first + 1 }, (_, i) => span.first + i);
        if (!weekOptions.includes(week)) { weekOptions.push(week); weekOptions.sort((a, b) => a - b); }
        const mine = row => myRoster?.roster_id != null && sameId(row.roster_id, myRoster.roster_id);
        const rosterFor = row => (currentLeague?.rosters || []).find(r => sameId(r.roster_id, row.roster_id));
        const ownerName = row => getOwnerName?.(row.roster_id) || defaultOwnerName(currentLeague, row.roster_id);
        // A team whose week has not begun reads "—" (Sleeper reports 0 before
        // kickoff — a fake 0-0). Without startedIds (C2 callers) the feed's
        // number is shown as-is.
        const begun = row => !startedIds || startedIds.has(String(row.roster_id));
        const teamPoints = row => begun(row) ? service.rosterPoints(row) : null;
        const gamesKnown = Array.isArray(games) && games.length > 0;
        const playerCell = (row, pid) => {
            const actual = service.playerPoints(row, pid);
            // Schedule unknown (relay outage): a plain 0 may just be "not played
            // yet", so it reads "—"; any real non-zero score (incl. negatives) shows.
            if (!gamesKnown) return { value: actual ? fmt(actual) : '—', note: null };
            const { team, game } = nflGameFor(games, playersData, pid);
            if (!game) return { value: actual ? fmt(actual) : '—', note: team ? 'BYE' : 'No NFL team' };
            const st = window.App?.NflContext?.gameStatus?.(game) || 'unknown';
            if (st === 'upcoming' && !actual) return { value: '—', note: null };
            return { value: fmt(actual), note: null };
        };
        const groups = (board.groups || []).slice().sort((a, b) => Number(b.teams.some(mine)) - Number(a.teams.some(mine)));
        const paired = groups.some(g => g.teams.length === 2);
        const ladder = (board.rows || []).filter(row => {
            const roster = rosterFor(row);
            return !roster || !window.App?.Chopped?.isAliveInWeek || window.App.Chopped.isAliveInWeek(roster, week);
        }).sort((a, b) => (teamPoints(b) ?? -Infinity) - (teamPoints(a) ?? -Infinity));
        const updated = board.updatedAt ? new Date(board.updatedAt) : null;
        const loading = ['loading', 'idle', 'refreshing'].includes(board.status);
        const hasRows = (board.rows || []).length > 0;
        // Every row unpaired outside a chopped league = Sleeper has not set this
        // week's schedule yet; N lonely "bye" cards would misstate that.
        // (Playoff weeks too: before the bracket is set every row is unpaired.)
        const unscheduled = hasRows && !chopped && !paired;
        const showCards = hasRows && !unscheduled;
        const visibleLadder = isPhone && !expanded ? ladder.slice().sort((a, b) => Number(mine(b)) - Number(mine(a))).slice(0, 3) : ladder;
        const visibleGroups = isPhone && !expanded ? groups.slice(0, 1) : groups;
        const boardId = 'lls-board-' + leagueId;
        const slotsList = (currentLeague?.roster_positions || []).filter(slot => !['BN', 'BE', 'BENCH', 'IR', 'RES', 'RESERVE', 'TAXI'].includes(String(slot).toUpperCase()));
        const slotLabels = { SUPER_FLEX: 'SF', REC_FLEX: 'W/T', WRRB_FLEX: 'W/R', IDP_FLEX: 'IDP', FLEX: 'FLX' };
        const playerName = pid => getPlayerName?.(pid) || playersData?.[pid]?.full_name
            || [playersData?.[pid]?.first_name, playersData?.[pid]?.last_name].filter(Boolean).join(' ') || ('Player ' + pid);

        const starters = row => <div className="lls-team-block">
            <div className="lls-starter-head"><span>{ownerName(row)}</span><span>Actual</span></div>
            {(row.starters || []).length ? row.starters.map((pid, index) => {
                const empty = !pid || String(pid) === '0';
                const player = playersData?.[pid];
                const cell = empty ? { value: '—', note: null } : playerCell(row, pid);
                return <div className="lls-starter" key={`${pid}-${index}`}>
                    <span>{empty ? 'Empty starter slot' : playerName(pid)}
                        {!empty && player?.position && <small> {player.position}{player.team ? ` · ${player.team}` : ''}{cell.note ? ' · ' + cell.note : ''}</small>}
                    </span>
                    <strong>{cell.value}</strong>
                </div>;
            }) : <p className="lls-note">Starter details have not been reported.</p>}
        </div>;
        const team = row => <div className={`lls-team${mine(row) ? ' lls-own' : ''}`} key={row.roster_id}>
            <span className="lls-team-name">{ownerName(row)}{mine(row) && <small>YOU</small>}</span>
            <strong className="lls-score">{fmt(teamPoints(row))}</strong>
        </div>;
        const matchupTeams = rows => rows.slice().sort((a, b) => Number(mine(b)) - Number(mine(a)));
        const matchupHeader = rows => {
            const [left, right] = matchupTeams(rows);
            return <div className="lls-versus">
                {[left, right].map((row, index) => <React.Fragment key={row.roster_id}>
                    {index === 1 && <span className="lls-vs" aria-hidden="true">VS</span>}
                    <div className={`lls-side${index ? ' lls-side-right' : ''}${mine(row) ? ' lls-own' : ''}`}>
                        <span className="lls-owner" title={ownerName(row)}>{ownerName(row)}</span>
                        <span className="lls-side-label">{mine(row) ? 'Your team' : begun(row) ? 'Points' : 'Not started'}</span>
                        <strong className="lls-score">{fmt(teamPoints(row))}</strong>
                    </div>
                </React.Fragment>)}
            </div>;
        };
        const matchupStarters = rows => {
            if (isPhone) return <div>{matchupTeams(rows).map(row => <React.Fragment key={row.roster_id}>{starters(row)}</React.Fragment>)}</div>;
            const [left, right] = matchupTeams(rows);
            const leftPids = left.starters || [], rightPids = right.starters || [];
            const count = Math.max(leftPids.length, rightPids.length);
            const cell = (row, pids, index, side) => {
                const pid = pids[index], reported = index < pids.length;
                const empty = !pid || String(pid) === '0';
                const player = !empty && playersData?.[pid];
                const name = !reported ? 'Not reported' : empty ? 'Empty slot' : playerName(pid);
                const pts = reported && !empty ? playerCell(row, pid) : { value: '—', note: null };
                const meta = player ? [player.position, player.team, pts.note].filter(Boolean).join(' · ') : '—';
                const person = <div role="cell" className={`lls-player lls-player-${side}`} title={name}><strong>{name}</strong><small>{meta}</small></div>;
                const score = <strong role="cell" className="lls-player-points">{pts.value}</strong>;
                return side === 'left' ? <>{person}{score}</> : <>{score}{person}</>;
            };
            if (!count) return <p className="lls-note">Starter details have not been reported.</p>;
            return <div className="lls-comparison" role="table" aria-label={`${ownerName(left)} versus ${ownerName(right)} starter scores`}>
                <div className="lls-comparison-row lls-comparison-head" role="row">
                    <span role="columnheader">{ownerName(left)}</span><span role="columnheader">PTS</span><span role="columnheader">SLOT</span><span role="columnheader">PTS</span><span role="columnheader">{ownerName(right)}</span>
                </div>
                {Array.from({ length: count }, (_, index) => <div className="lls-comparison-row" role="row" key={index}>
                    {cell(left, leftPids, index, 'left')}
                    <span role="cell" className="lls-slot" title={slotsList[index] || 'Starter slot'}>{slotLabels[slotsList[index]] || slotsList[index] || index + 1}</span>
                    {cell(right, rightPids, index, 'right')}
                </div>)}
            </div>;
        };
        // Tap a card → expand the board with that matchup's breakdown open.
        const cardKey = (group, i) => `${group.matchupId ?? 'unpaired'}-${i}`;
        const toggle = key => {
            if (!expanded) { setExpanded(true); setOpenKey(key); return; }
            setOpenKey(openKey === key ? null : key);
        };
        const pickWeek = value => { setOpenKey(null); if (onWeekChange) onWeekChange(value); else setSelection({ leagueId, week: value }); };
        const medianOn = Number(settings.league_average_match) === 1;
        const scored = (board.rows || []).map(teamPoints);
        const median = medianOn && hasRows && scored.every(v => v != null) ? (() => {
            const s = scored.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        })() : null;
        const every = interval === undefined ? 30000 : interval;
        const cadence = !every ? 'Refreshes when you come back to this page'
            : every < 60000 ? `Refreshes every ${Math.round(every / 1000)}s while visible`
            : `Refreshes every ${Math.round(every / 60000)} min while visible`;

        return <section className={`lls${expanded ? ' lls-expanded' : ' lls-compact'}`} aria-label="League scoreboard">
            <div className="lls-header">
                <div className="lls-heading">
                    <h3>{chopped ? 'Weekly scoring race' : 'Around the league'}</h3>
                    <span className="lls-note">{currentLeague?.season} · Week {week}{isPlayoffWeek ? ' · Playoffs' : ''} · Sleeper scores{statusText ? <> · {statusText}</> : null}</span>
                </div>
                <div className="lls-controls">
                    {headerRight || null}
                    <label>Week <select aria-label="Scoreboard week" value={week} onChange={event => pickWeek(Number(event.target.value))}>
                        {weekOptions.map(w => <option key={w} value={w}>{w}</option>)}
                    </select></label>
                    {(!isPhone || expanded || !hasRows || board.error) && <button type="button" disabled={loading || board.supported === false} onClick={() => { board.refresh?.(); onRefresh?.(); }}>{loading ? 'Updating…' : 'Refresh'}</button>}
                    {showCards && <button type="button" aria-expanded={expanded} aria-controls={boardId} onClick={() => { setExpanded(!expanded); setOpenKey(null); }}>{expanded ? (isPhone ? 'Show less' : 'Collapse') : `All ${chopped ? ladder.length + ' teams' : groups.length + (isPhone ? ' games' : ' matchups')}`}</button>}
                </div>
            </div>
            <div role="status" aria-live="polite">
                {board.supported === false ? <p className="lls-note">Live league scores are available for Sleeper leagues only for now.</p>
                    : board.error || board.status === 'error' ? <p className="lls-note lls-error">{hasRows ? 'Scores could not refresh. Showing the last successful update.' : 'Scores are temporarily unavailable. Try refreshing.'}</p>
                    : loading && !hasRows ? <p className="lls-note">Loading this week’s league scores…</p>
                    : !hasRows || unscheduled ? <p className="lls-note">Sleeper has not posted {isPlayoffWeek ? 'playoff ' : ''}matchups for Week {week} yet.</p> : null}
            </div>
            {showCards && <div id={boardId} className="lls-grid lls-matchups" tabIndex={expanded ? undefined : 0} role="region" aria-label={chopped ? 'Weekly team scores' : 'Weekly matchups'}>
                {chopped ? visibleLadder.map(row => {
                    const key = 'team-' + row.roster_id, open = expanded && openKey === key;
                    return <article className={`lls-card${mine(row) ? ' lls-card-own' : ''}${open ? ' lls-open' : ''}`} key={row.roster_id}>
                        <div className="lls-rank">{teamPoints(row) == null ? 'Awaiting score' : `Position ${ladder.findIndex(r => teamPoints(r) === teamPoints(row)) + 1} of ${ladder.length}`}</div>
                        {team(row)}
                        <button type="button" className="lls-more" style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '8px 0 0' }} aria-expanded={open} onClick={() => toggle(key)}>{open ? 'Hide starter scores' : 'Starter scores'}</button>
                        {open && <div className="lls-breakdown">{starters(row)}</div>}
                    </article>;
                }) : visibleGroups.map((group, i) => {
                    const key = cardKey(group, i), open = expanded && openKey === key;
                    const pair = group.teams.length === 2;
                    return <article className={`lls-card${pair ? ' lls-pair' : ''}${group.teams.some(mine) ? ' lls-card-own' : ''}${open ? ' lls-open' : ''}`} key={key}>
                        {pair ? matchupHeader(group.teams) : group.teams.map(team)}
                        {!pair && <p className="lls-note" style={{ margin: '4px 0 0' }}>{isPlayoffWeek ? 'No playoff matchup this week.' : 'No opponent this week.'}</p>}
                        <button type="button" className="lls-more" style={{ width: '100%', border: 0, borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.08))', borderRadius: 0, background: 'transparent', textAlign: 'left', padding: '8px 0 0', marginTop: 8 }} aria-expanded={open} onClick={() => toggle(key)}>{open ? 'Hide breakdown' : pair ? 'Matchup breakdown' : 'Starter scores'}</button>
                        {open && <div className="lls-breakdown">{pair ? matchupStarters(group.teams) : group.teams.map(row => <React.Fragment key={row.roster_id}>{starters(row)}</React.Fragment>)}</div>}
                    </article>;
                })}
            </div>}
            <div className="lls-footer">
                <p className="lls-note">{updated && !Number.isNaN(updated.getTime()) ? `Updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ` : ''}{cadence}.{expanded ? ' Scoring may be delayed or corrected. A dash means no score has been reported yet.' : ''}{median != null ? ` League median so far ${fmt(median)} (this league also plays the median).` : medianOn && expanded ? ' This league also plays the league median each week.' : ''}{Number(settings.best_ball) === 1 && expanded ? ' Best ball: Sleeper scores each team’s best lineup automatically.' : ''}{expanded && chopped ? ' Positions are provisional; eliminations follow league results.' : ''}{isPlayoffWeek ? ' Playoff weeks: these are the scored matchups Sleeper reports; its bracket decides who advances.' : ''}</p>
                {setActiveTab && <button type="button" onClick={() => setActiveTab('lineup')}>My Game Plan →</button>}
            </div>
        </section>;
    }

    // ── Live standings table (C2 League Central, adapted) ─────────────
    // Guarded shell: a failed engine load shows a note instead of crashing
    // (engine presence is fixed for the page's lifetime, so no hook hazard).
    function LeagueLiveStandingsPanel(props) {
        useStyles();
        const App = window.App || {};
        if (!App.LeagueLiveTable?.useContext || !App.LeagueLiveStandings?.compute || !App.LeagueLiveScores) {
            return <div className="lct-live-panel"><p className="lls-note">Standings are unavailable right now. Reload the page to try again.</p></div>;
        }
        return <LiveStandingsTable {...props} />;
    }
    function LiveStandingsTable({ currentLeague, myRoster, board, playersData, getOwnerName, active = true, games }) {
        const App = window.App || {};
        // games (optional): the parent's NFL schedule — reused so the table
        // adds no relay requests of its own.
        const ctx = App.LeagueLiveTable.useContext({ league: currentLeague, board, playersData, enabled: active, games });
        const [source, setSource] = React.useState('live');
        const settings = currentLeague?.settings || {};
        const official = React.useMemo(() => App.LeagueLiveStandings.compute({ league: currentLeague, week: 0 }).officialRows, [currentLeague]);
        const liveTable = React.useMemo(() => {
            if (!ctx.enabled || !App.LeagueLiveStandings) return null;
            if (!['ready', 'refreshing', 'stale'].includes(ctx.history.status) || !ctx.history.updatedAt) return null;
            return App.LeagueLiveStandings.compute({
                league: currentLeague, standings: [], priorWeeks: ctx.history.priorWeeks,
                board, week: board.week, currentWeek: ctx.currentWeek, started: false,
                startedRosterIds: ctx.startedRosterIds,
            });
        }, [currentLeague, board, ctx.history, ctx.startedRosterIds.join(',')]);
        const showLive = source === 'live' && ctx.enabled;
        const liveReady = showLive && liveTable && liveTable.status !== 'official' && board.updatedAt != null && board.rows.length > 0;
        const teams = liveReady ? liveTable.rows : official;
        const anyPlayed = official.some(t => t.wins + t.losses + t.ties > 0);
        const playoffTeams = Number(settings.playoff_teams) || 0;
        const hasDivisions = Number(settings.divisions) > 0;
        const name = id => getOwnerName?.(id) || defaultOwnerName(currentLeague, id);
        // A side whose week has not begun reads "—", not Sleeper's pre-kickoff 0.00.
        const startedSet = new Set(ctx.startedRosterIds);
        const weekPts = (id, value) => ctx.historical || startedSet.has(String(id)) ? fmt(value) : '—';
        const streakOf = id => {
            const r = (currentLeague?.rosters || []).find(x => sameId(x.roster_id, id));
            return (r && r.metadata && r.metadata.streak) || null;
        };
        const status = liveReady ? liveTable.status === 'baseline' ? `Entering Week ${board.week}` : ctx.historical ? `${liveTable.status === 'partial' ? 'Partial results ·' : 'Through'} Week ${board.week}` : `As it stands · Week ${board.week}` : 'Official record';
        const note = showLive ? board.status === 'error' ? 'Weekly scores could not load. Showing official records; refresh scores to retry.'
            : ctx.history.status === 'error' ? 'Past scores could not load. Showing official records; refresh scores to retry.'
            : board.status === 'stale' || ctx.history.status === 'stale' ? 'Refresh interrupted. Showing the last available scores; updates will retry automatically.'
            : board.status === 'ready' && !board.rows.length ? `Matchups for Week ${board.week} have not been reported. Showing official records.`
            : board.updatedAt == null ? 'Loading weekly scores. Official records are shown while they load.'
            : !liveTable ? 'Loading the weekly table. Official records are shown while it loads.'
            : liveTable.status === 'official' ? liveTable.message
            : ctx.historical && liveTable.status === 'live' ? `Weekly results through Week ${board.week}. Movement from the start of that week.`
            : liveTable.message
            : ctx.enabled ? 'Sleeper’s posted record. Live results appear here once Sleeper adds them to the standings.'
            : 'Sleeper’s posted record, ranked by wins, then points for.' + (board.week >= ctx.lastReg + 1 ? ' The regular season is over; this table does not follow the playoff bracket.' : '');
        if (!liveReady && !anyPlayed) {
            return <div className="lct-live-panel"><p className="lls-note">Standings begin once Week {Number(settings.start_week) || 1} has been scored.</p></div>;
        }
        return <div className="lct-live-panel">
            <div className="lct-status">
                <div className="lct-status-copy" role="status">
                    <strong>{liveReady && liveTable.status !== 'baseline' && board.status !== 'stale' && !ctx.historical && <i className="lct-live-dot" aria-hidden="true" />}{status}</strong>
                    <small>{showLive && board.updatedAt ? `Scores updated ${new Date(board.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Posted by Sleeper'}</small>
                </div>
                {ctx.enabled && <div className="lls-seg" role="group" aria-label="Standings source">
                    <button type="button" aria-pressed={source === 'live'} onClick={() => setSource('live')}>{ctx.historical ? `Week ${board.week}` : 'Live'}</button>
                    <button type="button" aria-pressed={source === 'official'} onClick={() => setSource('official')}>Official</button>
                </div>}
            </div>
            <p className="lls-note">{note}</p>
            <div className="lct-table-wrap">
                <table className="lct-table" aria-label={liveReady ? `Week ${board.week} live standings` : 'Official standings'}>
                    <thead><tr>
                        <th scope="col" className="lct-rank-col" aria-label="Rank">#</th><th scope="col" className="lct-team-col">Team</th>
                        <th scope="col" className="lct-record">W-L-T</th>
                        <th scope="col" className="lct-desktop" title="Points for">PF</th><th scope="col" className="lct-desktop" title="Head-to-head points against">PA</th>
                        <th scope="col" className="lct-week">{liveReady ? `Week ${board.week}` : 'Streak'}</th>
                    </tr></thead>
                    <tbody>{teams.map((t, idx) => {
                        const rank = t.rank;
                        const change = liveReady ? t.rankChange : null;
                        const outcome = t.currentResult;
                        const isOwn = sameId(t.rosterId, myRoster?.roster_id);
                        const cutline = !hasDivisions && playoffTeams > 0 && idx === playoffTeams - 1 && idx < teams.length - 1;
                        const streak = streakOf(t.rosterId);
                        return <tr key={t.rosterId} className={`${isOwn ? 'lct-own' : ''} ${cutline ? 'lct-cutline' : ''}`}>
                            <td className="lct-rank-col"><span className="lct-rank-number">{rank ?? '—'}{liveReady && <span className="lct-movement" data-direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'} aria-label={change == null ? 'No prior rank' : change ? `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)} since entering Week ${board.week}` : 'Rank unchanged'}>{change ? `${change > 0 ? '↑' : '↓'}${Math.abs(change)}` : '—'}</span>}</span></td>
                            <td className="lct-team-col"><span className="lct-team-name" title={name(t.rosterId)}>{name(t.rosterId)}</span><span className="lct-team-meta lct-phone">{fmt(t.pointsFor)} PF</span></td>
                            <td className="lct-record">{t.wins}-{t.losses}-{t.ties || 0}</td>
                            <td className="lct-desktop">{fmt(t.pointsFor)}</td><td className="lct-desktop">{fmt(t.pointsAgainst)}</td>
                            <td className="lct-week">{liveReady ? <>
                                <span className="lct-result" data-result={outcome || 'none'}>{outcome ? (ctx.historical ? outcome : { W: 'Leading', L: 'Trailing', T: 'Tied' }[outcome]) : t.opponentRosterId == null && t.currentPoints != null ? 'Bye' : 'Pending'}</span>
                                <span className="lct-week-score">{t.opponentRosterId != null && weekPts(t.rosterId, t.currentPoints) === '—' && weekPts(t.opponentRosterId, t.opponentPoints) === '—' ? '—' : <>{weekPts(t.rosterId, t.currentPoints)}{t.opponentRosterId != null && ` – ${weekPts(t.opponentRosterId, t.opponentPoints)}`}</>}</span>
                                {Number(settings.league_average_match) === 1 && !ctx.historical ? <small className="lct-team-meta">Median {t.medianResult || '—'}</small> : t.medianResult && <small className="lct-team-meta">Median {t.medianResult}</small>}
                            </> : <strong style={{ color: String(streak || '').slice(-1) === 'W' ? 'var(--good, #2ecc71)' : 'var(--text-muted, #8d887e)', fontFamily: 'var(--font-mono, monospace)' }}>{streak || '—'}</strong>}</td>
                        </tr>;
                    })}</tbody>
                </table>
            </div>
            {!hasDivisions && playoffTeams > 0 && teams.length > playoffTeams && <p className="lls-note">Gold line: {playoffTeams}-team playoff cutline by record — not official seeding.</p>}
            {liveReady && <details><summary>How the live table works</summary><p className="lls-note">Current scores are treated as results, then added once to all earlier regular-season weeks. Rank follows wins, fewer losses, then points for; tied records and points share a rank. Arrows show movement since entering Week {board.week}. This table does not apply custom playoff seeding or change your league’s official record.{Number(settings.league_average_match) === 1 ? ' Median results add a second decision once every matchup has started and all scores are available. Points for count once; points against show head-to-head opponents only.' : ''}</p></details>}
        </div>;
    }

    // ── Game Day section ──────────────────────────────────────────────
    const LIVE_WINDOW_MS = 4.5 * 60 * 60 * 1000; // a kicked-off game counts as live this long unless reported final
    const NFL_RELOAD_MS = 5 * 60 * 1000;          // kickoff schedule refresh while visible
    // Usual NFL game windows in US Eastern time, used only when the kickoff
    // schedule could not load: Thu/Mon night, Sunday from the London
    // kickoffs on, Saturday late season, a Friday opener — plus the hour
    // after midnight for late finishes.
    const ET_PARTS = (() => { try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }); } catch (_) { return null; } })();
    function inNflWindow(now, week) {
        if (!ET_PARTS) return true; // cannot tell → allow the slow poll
        const parts = ET_PARTS.formatToParts(new Date(now));
        const day = (parts.find(p => p.type === 'weekday') || {}).value;
        const hour = Number((parts.find(p => p.type === 'hour') || {}).value);
        if (!Number.isFinite(hour)) return true;
        if (hour < 1) return ['Fri', 'Sat', 'Sun', 'Mon', 'Tue'].includes(day);
        if (day === 'Sun') return hour >= 9;
        if (day === 'Thu' || day === 'Mon') return hour >= 19;
        if (day === 'Fri') return Number(week) === 1 && hour >= 19;
        if (day === 'Sat') return Number(week) >= 15 && hour >= 12;
        return false;
    }
    function WrAroundTheLeague({ currentLeague, myRoster, playersData, week: weekProp }) {
        useStyles();
        const App = window.App || {};
        const service = App.LeagueLiveScores;
        const leagueId = currentLeague?.league_id || currentLeague?.id || '';
        const season = String(currentLeague?.season || '');
        const supported = !!service && service.supported(currentLeague);
        const chopped = !!App.Chopped?.isChopped?.(currentLeague);
        const baseWeek = service ? (Number(weekProp) >= 1 && Number(weekProp) <= 18 ? Number(weekProp) : service.currentWeek(currentLeague)) : 1;
        const [pick, setPick] = React.useState(null);
        const week = pick && pick.leagueId === leagueId ? pick.week : baseWeek;
        const [view, setView] = React.useState('scores');
        const nflState = (window.S && window.S.nflState) || {};
        const liveSeason = String(nflState.season || new Date().getFullYear());
        const seasonType = String(nflState.season_type || 'regular');
        const isCurrent = supported && season === liveSeason && (seasonType === 'regular' || seasonType === 'post') && service && week === service.currentWeek(currentLeague);

        // NFL kickoff schedule for this week (server-cached relay; one shared
        // 60s client cache in NflContext). Drives live gating and "—" before kickoff.
        const [nfl, setNfl] = React.useState({ key: '', games: [], ok: false });
        const nflKey = season + '|' + week;
        React.useEffect(() => {
            const NC = App.NflContext;
            if (!supported || !NC?.loadScores || !/^\d{4}$/.test(season)) return undefined;
            let alive = true, busy = false;
            const load = () => {
                if (!alive || busy || document.hidden) return;
                busy = true;
                NC.loadScores(week, season, 2).then(games => {
                    if (alive) setNfl({ key: nflKey, games: games || [], ok: Array.isArray(games) && games.length > 0 });
                }).catch(() => {}).finally(() => { busy = false; });
            };
            load();
            const timer = isCurrent ? setInterval(load, NFL_RELOAD_MS) : null;
            const onVis = () => { if (!document.hidden) load(); };
            document.addEventListener('visibilitychange', onVis);
            return () => { alive = false; if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
        }, [nflKey, supported, isCurrent]);
        const games = nfl.key === nflKey ? nfl.games : [];
        const gamesOk = nfl.key === nflKey && nfl.ok;

        // A minute clock (no network) so polling switches on at kickoff and
        // off after the late window, without reloading anything.
        const [clock, setClock] = React.useState(() => Date.now());
        React.useEffect(() => {
            if (!isCurrent) return undefined;
            const t = setInterval(() => { if (!document.hidden) setClock(Date.now()); }, 60000);
            return () => clearInterval(t);
        }, [isCurrent]);
        const gameStatus = g => App.NflContext?.gameStatus?.(g, clock) || 'unknown';
        const liveGames = gamesOk ? games.filter(g => {
            const st = gameStatus(g);
            if (st === 'live') return true;
            if (st !== 'locked') return false;
            const k = Date.parse(g.kickoff || '');
            return Number.isFinite(k) && clock - k < LIVE_WINDOW_MS;
        }) : [];
        const liveNow = gamesOk ? liveGames.length > 0 : null;
        // Poll at C2's 30s only while an NFL game of this week is in progress;
        // unknown schedule (relay outage) → every 2 min, but only inside the
        // usual NFL game windows; otherwise fetch on open/return only.
        const interval = !isCurrent ? 0 : liveNow === true ? service.INTERVAL
            : liveNow === null ? (inNflWindow(clock, week) ? 4 * service.INTERVAL : 0) : 0;
        const board = service ? service.useScores({ league: currentLeague, week, enabled: supported, interval }) : { rows: [], groups: [], status: 'unsupported', supported: false };

        const startedIds = React.useMemo(() => {
            const T = App.LeagueLiveTable;
            if (!T || !supported) return null;
            const historical = Number(season) < Number(liveSeason) || (season === liveSeason && week < service.currentWeek(currentLeague));
            return new Set(T.startedRosters({ rows: board.rows || [], games, playersData: playersData || {}, historical, now: clock }));
        }, [board.rows, games, playersData, clock, week, season]);

        const allUpcoming = gamesOk && games.every(g => gameStatus(g) === 'upcoming');
        const firstKick = allUpcoming ? games.map(g => Date.parse(g.kickoff || '')).filter(Number.isFinite).sort((a, b) => a - b)[0] : null;
        const statusText = liveNow ? <span className="lls-live">Live</span>
            : firstKick ? 'Kickoff ' + new Date(firstKick).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
            : null;

        if (!supported) {
            return <section className="lls" aria-label="League scoreboard">
                <div className="lls-heading"><h3>Around the league</h3></div>
                <p className="lls-note" style={{ marginBottom: 0 }}>Live league scores and standings are available for Sleeper leagues only for now.</p>
            </section>;
        }
        const tabs = chopped ? null : <div className="lls-seg" role="group" aria-label="Around the league view">
            <button type="button" aria-pressed={view === 'scores'} onClick={() => setView('scores')}>Scores</button>
            <button type="button" aria-pressed={view === 'standings'} onClick={() => setView('standings')}>Standings</button>
        </div>;
        if (view === 'standings' && !chopped) {
            return <section className="lls" aria-label="League standings">
                <div className="lls-header">
                    <div className="lls-heading"><h3>Around the league</h3><span className="lls-note">{season} · Week {week} · Sleeper</span></div>
                    <div className="lls-controls">{tabs}</div>
                </div>
                <LeagueLiveStandingsPanel currentLeague={currentLeague} myRoster={myRoster} board={board} playersData={playersData} active games={nfl.key === nflKey ? games : null} />
            </section>;
        }
        return <LeagueLiveScoreboard key={leagueId + ':' + season} currentLeague={currentLeague} myRoster={myRoster} playersData={playersData}
            selectedWeek={week} onWeekChange={w => setPick({ leagueId, week: w })} board={board} interval={interval}
            startedIds={startedIds} games={gamesOk ? games : null} statusText={statusText} headerRight={tabs} />;
    }

    window.LeagueLiveScoreboard = LeagueLiveScoreboard;
    window.LeagueLiveStandingsPanel = LeagueLiveStandingsPanel;
    window.WrAroundTheLeague = React.memo(WrAroundTheLeague);
    window.WrAroundTheLeague._inNflWindow = inNflWindow; // for tests
})();
