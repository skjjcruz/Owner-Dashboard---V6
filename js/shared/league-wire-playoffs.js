// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-playoffs.js — window.WrWirePlayoffs (ported from C2,
// 2026-09-27, logic unchanged). Wire Studio's bracket / playoff path / race.
//   load({ league, signal?, force?, fetcher?, now? }) — Sleeper winners
//     bracket + only the round weeks it can verify. Requested on an explicit
//     Studio action, never on page load. Complete seasons cache 6h, else 60s.
//   race({ league, edition, remainingWeeks? }) — pure; clinch/elimination
//     only when divisions/custom seeding can't change the field.
// Sleeper owns advancement; roster ids are never shown as seeds.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const cache = new Map();
    const base = 'https://api.sleeper.app/v1/league/';
    const str = value => String(value);
    const integer = value => value != null && value !== '' && typeof value !== 'boolean' && Number.isInteger(Number(value)) && Number(value) >= 0;
    const rosterId = value => (typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(str(value)) && Number(value) > 0 ? str(value) : null;
    const aborted = signal => { if (signal?.aborted) { const error = new Error('Playoff loading was interrupted.'); error.name = 'AbortError'; throw error; } };
    const score = row => {
        const value = row?.custom_points == null ? row?.points : row.custom_points;
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    };
    const copy = value => JSON.parse(JSON.stringify(value));
    const roundLabel = (round, count, slots) => round === count ? 'Championship' : round === count - 1 ? 'Semifinals' : slots === 8 && round === 1 ? 'Quarterfinals' : round === 1 ? 'First round' : `Round ${round}`;
    const reference = (game, side) => game[side + '_from'] || (game[side] && typeof game[side] === 'object' ? game[side] : null);
    const teamName = (league, id) => {
        const roster = league.rosters?.find(r => str(r.roster_id) === str(id));
        const user = league.users?.find(u => str(u.user_id) === str(roster?.owner_id));
        return str(user?.metadata?.team_name || user?.display_name || user?.username || `Team ${id}`).trim();
    };
    async function load({ league, signal, force = false, fetcher = (...args) => root.fetch(...args), now = Date.now }) {
        aborted(signal);
        const leagueId = rosterId(league?.league_id || league?.id), season = str(league?.season || '');
        const initial = { league, season, checkedAt: null, status: 'error', message: '', provisional: false, rounds: [], paths: [], sources: [], notes: [] };
        if (!leagueId || !/^\d{4}$/.test(season)) return { ...initial, message: 'Choose a Sleeper league and season to see its playoff bracket.' };
        const key = `${leagueId}|${season}`, saved = cache.get(key);
        if (!force && saved && now() - saved.at >= 0 && now() - saved.at < saved.ttl) return copy(saved.value);
        const sources = [], notes = [];
        const jsonAt = async (url, label) => {
            aborted(signal);
            sources.push({ label, url });
            const response = await fetcher(url, { signal, cache: 'no-store' });
            aborted(signal);
            if (!response.ok) throw Error(`${label} could not load.`);
            const value = await response.json();
            aborted(signal);
            return value;
        };
        const json = (path, label) => jsonAt(base + leagueId + path, label);
        try {
            const info = await json('', `${season} league settings`);
            if (str(info?.league_id) !== leagueId || str(info?.season) !== season || (info?.sport && info.sport !== 'nfl')) throw Error('The returned league does not match this football season.');
            const [raw, rosters, users] = await Promise.all([json('/winners_bracket', `${season} championship bracket`), json('/rosters', `${season} roster ownership`), json('/users', `${season} team names`)]);
            if (!Array.isArray(raw) || !Array.isArray(rosters) || !rosters.length || !Array.isArray(users)) throw Error('The playoff bracket or its teams could not be verified.');
            const verified = { ...info, rosters, users };
            let nfl = null;
            try {
                nfl = await jsonAt('https://api.sleeper.app/v1/state/nfl', 'Current NFL calendar');
                if (!/^\d{4}$/.test(str(nfl?.season)) || !['pre', 'regular', 'post'].includes(nfl.season_type) || !integer(nfl.week)) throw Error('Unverified calendar');
            } catch (_) { aborted(signal); nfl = null; }
            const playoffStart = Number(info.settings?.playoff_week_start), calendarKnown = !!nfl;
            const provisional = !calendarKnown ? info.status !== 'complete' : Number(season) > Number(nfl.season) || (Number(season) === Number(nfl.season)
                && (['pre_draft', 'drafting'].includes(info.status) || nfl.season_type === 'pre' || (nfl.season_type !== 'post' && (!Number.isInteger(playoffStart) || Number(nfl.week) < playoffStart))));
            const provisionalMessage = provisional ? calendarKnown ? `If the season ended today: this is Sleeper’s current playoff field. Matchups and bye positions can change${Number.isInteger(playoffStart) && playoffStart > 0 ? ` before Week ${playoffStart}` : ''}; no place is clinched by this snapshot.` : 'The NFL calendar could not be verified. This bracket is shown as a provisional field; advancement and final scores are withheld until timing can be checked.' : '';
            if (provisional) notes.push(provisionalMessage);
            else if (!calendarKnown) notes.push('The live NFL calendar is unavailable. Sleeper marks this season complete; its official bracket and verified scores remain available.');
            const teams = new Map();
            for (const roster of rosters) {
                const id = rosterId(roster?.roster_id);
                if (!id || teams.has(id)) throw Error('The playoff teams could not be verified.');
                teams.set(id, { id, name: teamName(verified, id), ownerId: roster.owner_id == null ? null : str(roster.owner_id) });
            }
            const result = { ...initial, league: verified, sources, notes, provisional };
            const remember = value => {
                aborted(signal);
                const at = now(); value.checkedAt = at;
                if (value.status === 'ready' || value.status === 'empty') {
                    cache.set(key, { at, ttl: info.status === 'complete' && value.status === 'ready' && !provisional ? 6 * 3600000 : 60000, value: copy(value) });
                    while (cache.size > 24) cache.delete(cache.keys().next().value);
                }
                return value;
            };
            if (!raw.length) return remember({ ...result, status: 'empty', message: 'Sleeper has not published a championship bracket for this season yet.' });
            const nodes = new Map();
            for (const row of raw) {
                if (!row || !integer(row.m) || Number(row.m) < 1 || !integer(row.r) || Number(row.r) < 1 || Number(row.r) > 6 || nodes.has(str(row.m))) throw Error('The championship bracket has an unrecognized structure.');
                nodes.set(str(row.m), row);
            }
            // Placement games and loser-fed games are not part of a title path.
            const main = raw.filter(row => (row.p == null || Number(row.p) === 1) && !['t1', 't2'].some(side => reference(row, side)?.l != null));
            if (!main.length) return { ...result, status: 'unsupported', checkedAt: now(), message: 'A championship path could not be separated from placement games.' };
            const finals = main.filter(row => Number(row.p) === 1);
            if (finals.length !== 1) return { ...result, status: 'unsupported', checkedAt: now(), message: 'Sleeper has not identified a single championship final for this bracket.' };
            const final = finals[0], count = Number(final.r), slots = Number(info.settings?.playoff_teams);
            if (main.some(row => Number(row.r) > count) || ![2, 4, 6, 8].includes(slots) || count !== Math.ceil(Math.log2(slots))) return { ...result, status: 'unsupported', checkedAt: now(), message: 'This playoff structure is not yet verified for bracket coverage.' };
            const inconsistentNodes = new Set();
            const resolve = (node, side) => {
                const direct = rosterId(node[side]), ref = reference(node, side);
                if (provisional) return direct && teams.has(direct) ? direct : null;
                if (!ref) return direct && teams.has(direct) ? direct : null;
                const previous = ref.w != null ? nodes.get(str(ref.w)) : null;
                if (!previous || Number(previous.r) >= Number(node.r)) { inconsistentNodes.add(str(node.m)); return null; }
                const winner = rosterId(previous.w);
                if (!winner) return direct && teams.has(direct) ? direct : null;
                const entrants = ['t1', 't2'].map(priorSide => resolve(previous, priorSide));
                if (!entrants.every(Boolean) || entrants[0] === entrants[1] || !entrants.includes(winner) || (direct && direct !== winner)) {
                    inconsistentNodes.add(str(node.m)); return null;
                }
                return winner;
            };
            const start = Number(info.settings?.playoff_week_start);
            const durationKnown = info.settings?.playoff_round_type === 0 && Number.isInteger(start) && start >= 1 && start + count - 1 <= 18;
            if (!durationKnown) notes.push('This league uses a multiweek or unverified round format. Official advancement is shown, but week assignments and aggregate scores are unavailable.');
            notes.push('Advancement comes from Sleeper’s championship bracket. Placement and consolation games are excluded; roster IDs are not seeds.');
            const weeksByRound = new Map(Array.from({ length: count }, (_, i) => [i + 1, durationKnown ? [start + i] : []]));
            const scoreWeeks = [...new Set(main.filter(row => !provisional && rosterId(row.w)).flatMap(row => weeksByRound.get(Number(row.r)) || []))];
            const loadedWeeks = new Map();
            await Promise.all(scoreWeeks.map(async week => {
                try {
                    const rows = await json('/matchups/' + week, `${season} Week ${week} scores`);
                    if (!Array.isArray(rows)) throw Error('Invalid matchup rows');
                    const ids = rows.map(row => rosterId(row?.roster_id));
                    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw Error('Invalid matchup teams');
                    loadedWeeks.set(week, new Map(rows.map(row => [str(row.roster_id), row])));
                } catch (error) { aborted(signal); notes.push(`Week ${week} scores could not be verified. Official bracket advancement is still shown.`); }
            }));
            aborted(signal);
            const participating = new Set(), games = new Map();
            let incomplete = !durationKnown || (!calendarKnown && provisional);
            for (const node of main) {
                const ids = ['t1', 't2'].map(side => resolve(node, side));
                ids.filter(Boolean).forEach(id => participating.add(id));
                const known = ids.every(Boolean) && ids[0] !== ids[1];
                const officialWinner = provisional ? null : rosterId(node.w), winnerId = known && ids.includes(officialWinner) ? officialWinner : null;
                const weeks = weeksByRound.get(Number(node.r));
                let values = [null, null], status = known && !officialWinner ? 'scheduled' : 'pending', note = '';
                if (inconsistentNodes.has(str(node.m))) { incomplete = true; note = 'Sleeper’s matchup assignment conflicts with its recorded advancement. This round is withheld pending verification.'; }
                else if (known && winnerId && durationKnown) {
                    const rows = ids.map(id => loadedWeeks.get(weeks[0])?.get(id));
                    const matched = rows.every(Boolean) && rows[0].matchup_id != null && str(rows[0].matchup_id) === str(rows[1].matchup_id);
                    const totals = rows.map(score), valid = matched && totals.every(value => value != null);
                    const winnerIndex = ids.indexOf(winnerId);
                    if (valid && totals[winnerIndex] >= totals[1 - winnerIndex]) {
                        values = totals; status = 'final';
                        if (totals[0] === totals[1]) note = 'Level on points; Sleeper’s bracket records the advancing team. No tiebreak rule is inferred.';
                    } else { incomplete = true; note = valid ? 'The posted scores and official advancement disagree. The final score is withheld pending verification.' : 'Official advancement is available; the complete final score could not be verified.'; }
                } else if (officialWinner && !winnerId) { incomplete = true; note = 'The reported winner does not match the verified participants.'; }
                else if (winnerId && !durationKnown) note = 'Official advancement is available; this round’s scoring duration is not verified.';
                else if (!known) note = provisional ? 'A provisional field; later-round participants have not been decided.' : 'Waiting for the previous round or an official matchup assignment.';
                else if (provisional) note = 'A current-field matchup; playoff qualification and this assignment are not final.';
                const game = { id: str(node.m), teams: ids.map((id, i) => id ? { ...teams.get(id), points: values[i] } : { id: null, name: 'To be decided', ownerId: null, points: null }), winnerId, status, note };
                games.set(str(node.m), game);
            }
            if (inconsistentNodes.size) notes.push('Some bracket entries disagree with their previous-round winner references. Inconsistent paths and championship claims are withheld.');
            const rounds = Array.from({ length: count }, (_, i) => {
                const round = i + 1;
                return { id: str(round), label: roundLabel(round, count, slots), weeks: weeksByRound.get(round), games: main.filter(node => Number(node.r) === round).sort((a, b) => Number(a.m) - Number(b.m)).map(node => games.get(str(node.m))), byes: [] };
            });
            // A standard six-team bracket documents two direct semifinal entries.
            const firstIds = new Set(main.filter(node => Number(node.r) === 1).flatMap(node => ['t1', 't2'].map(side => resolve(node, side))).filter(Boolean));
            if (slots === 6 && firstIds.size === 4 && main.filter(node => Number(node.r) === 1).length === 2) {
                const byes = new Set();
                main.filter(node => Number(node.r) === 2).forEach(node => ['t1', 't2'].forEach(side => {
                    const id = resolve(node, side);
                    if (id && !firstIds.has(id) && !reference(node, side)) byes.add(id);
                }));
                if (byes.size === 2) rounds[0].byes = [...byes].map(id => ({ ...teams.get(id) }));
            }
            const championId = games.get(str(final.m))?.winnerId;
            const paths = [...participating].map(id => {
                const team = teams.get(id), path = [];
                rounds.forEach(round => {
                    if (round.byes.some(t => t.id === id)) path.push({ label: round.label, weeks: round.weeks, opponent: null, points: [null, null], status: provisional ? 'scheduled' : 'final', bye: true, caption: provisional ? 'Current bye position; qualification is not clinched.' : 'First-round bye' });
                    round.games.filter(game => game.teams.some(t => t.id === id)).forEach(game => {
                        const own = game.teams.find(t => t.id === id), opponent = game.teams.find(t => t.id !== id);
                        const outcome = game.winnerId ? game.winnerId === id ? 'Advanced' : 'Eliminated' : 'Matchup ahead';
                        path.push({ label: round.label, weeks: round.weeks, opponent: opponent?.id ? { id: opponent.id, name: opponent.name, ownerId: opponent.ownerId } : null, points: [own.points, opponent?.points ?? null], status: game.status, bye: false,
                            caption: game.status === 'final' ? game.note || `${game.winnerId === id ? 'Won' : 'Lost'} ${own.points.toFixed(2)}–${opponent.points.toFixed(2)}` : game.note || outcome });
                    });
                });
                return { team: { ...team }, champion: id === championId, rounds: path };
            }).sort((a, b) => Number(b.champion) - Number(a.champion) || a.team.name.localeCompare(b.team.name));
            return remember({ ...result, status: incomplete ? 'partial' : 'ready', message: provisionalMessage || (incomplete ? 'Official bracket available; some score details are not verified.' : ''), rounds, paths });
        } catch (error) {
            aborted(signal);
            return { ...initial, sources, notes, message: error.message || 'The playoff bracket could not load. Refresh to retry.' };
        }
    }
    function race({ league, edition, remainingWeeks }) {
        const settings = league?.settings || {}, start = Math.max(1, Number(settings.start_week) || 1), end = Number(settings.playoff_week_start) - 1;
        const throughWeek = Number(edition?.completedThrough), slots = Number(settings.playoff_teams), table = edition?.table;
        const baseResult = { supported: false, reason: '', throughWeek: Number.isInteger(throughWeek) ? throughWeek : null, remainingWeeks: null, slots: Number.isInteger(slots) ? slots : 0, rows: [], notes: [] };
        const no = reason => ({ ...baseResult, reason });
        if (root.App?.Chopped?.isChopped?.(league) || league?.type === 'chopped' || league?.leagueSkin?.type === 'chopped') return no('This format does not use a verified head-to-head playoff race.');
        if (!Number.isInteger(end) || end < start || end > 18 || !Number.isInteger(slots) || slots < 1) return no('A regular-season playoff cutoff has not been verified.');
        const median = Number(settings.league_average_match || 0);
        if (![0, 1].includes(median)) return no('The number of weekly standings decisions has not been verified.');
        if (!Number.isInteger(throughWeek) || throughWeek < start || throughWeek > end || !Array.isArray(table) || !table.length) return no('Complete regular-season results are needed before showing the playoff race.');
        const expectedThrough = edition?.expectedThrough ?? edition?.end;
        if (expectedThrough != null && Number(expectedThrough) !== throughWeek) return no('Some completed regular-season weeks are unavailable. Refresh the scores to update the race.');
        const left = end - throughWeek;
        if (remainingWeeks != null && (!integer(remainingWeeks) || Number(remainingWeeks) !== left)) return no('The remaining schedule does not match the verified regular-season cutoff.');
        const decisions = (throughWeek - start + 1) * (median + 1), rosterIds = (league.rosters || []).map(r => str(r.roster_id));
        const tableIds = table.map(row => str(row.rid ?? row.id));
        if (!rosterIds.length || new Set(rosterIds).size !== rosterIds.length || tableIds.length !== rosterIds.length || new Set(tableIds).size !== tableIds.length || rosterIds.some(id => !tableIds.includes(id))
            || table.some(row => ![row.wins, row.losses, row.ties].every(integer) || Number(row.wins) + Number(row.losses) + Number(row.ties) !== decisions)) return no('Every team needs a complete, comparable regular-season record.');
        if (slots >= table.length) return no('This league does not have a competitive playoff cutline.');
        const divisions = Number(settings.divisions || 0), custom = settings.playoff_seed_type !== 0 || (league.bracket_overrides_id != null && str(league.bracket_overrides_id) !== '0');
        const supported = divisions === 0 && !custom, futureDecisions = left * (median + 1);
        const rows = table.map(row => {
            const id = str(row.rid ?? row.id), wins = Number(row.wins), ties = Number(row.ties);
            const minimum = wins + ties / 2, maximum = minimum + futureDecisions;
            const other = table.filter(t => str(t.rid ?? t.id) !== id);
            const canReach = other.filter(t => Number(t.wins) + Number(t.ties) / 2 + futureDecisions >= minimum).length;
            const alreadyAhead = other.filter(t => Number(t.wins) + Number(t.ties) / 2 > maximum).length;
            const status = !supported ? 'Record range' : canReach < slots ? 'Clinched' : alreadyAhead >= slots ? 'Eliminated' : 'In the race';
            const rivalCeilings = other.map(t => Number(t.wins) + Number(t.ties) / 2 + futureDecisions).sort((a, b) => b - a);
            const sufficient = Math.max(0, Math.floor(rivalCeilings[slots - 1] - minimum) + 1);
            const ceiling = `${wins + futureDecisions} wins${ties ? ` and ${ties} tie${ties === 1 ? '' : 's'}` : ''}`;
            const winUnit = median ? `head-to-head or median win${sufficient === 1 ? '' : 's'}` : `win${sufficient === 1 ? '' : 's'}`;
            const needed = !supported ? `Winning out reaches ${ceiling}. Qualification still follows the league’s division and seeding rules.`
                : status === 'Clinched' ? `A playoff place is safe by record even without another win, under the current seeding rules.`
                    : status === 'Eliminated' ? `Even winning every remaining decision reaches only ${ceiling}; at least ${slots} other teams are already beyond that record.`
                        : sufficient <= futureDecisions ? `${sufficient} more ${winUnit} guarantee a top-${slots} record regardless of other results. Other routes may clinch with fewer.`
                            : futureDecisions ? `Winning out reaches ${ceiling}; results elsewhere or tiebreaks still decide the cutoff.` : 'No regular-season decisions remain. The cutoff depends on the official tiebreak rules.';
            return { id, name: teamName(league, id), record: `${wins}–${Number(row.losses)}${ties ? '–' + ties : ''}`, status, minWins: wins, maxWins: wins + futureDecisions, needed };
        });
        return { ...baseResult, supported, reason: supported ? '' : divisions > 0 ? 'Division qualification rules can change the playoff field. These are record ranges, not clinch or elimination calls.' : 'Custom or unverified seeding can change the playoff field. These are record ranges, not clinch or elimination calls.', remainingWeeks: left, rows,
            notes: [`Based on complete results through Week ${throughWeek}. Win ranges include ${median ? 'a head-to-head and median decision' : 'one head-to-head decision'} per remaining week.`, 'Clinch calls survive a winless finish; elimination calls survive winning every remaining decision. Ties at the cutoff remain unresolved; official seeding and commissioner changes still apply.'] };
    }
    root.WrWirePlayoffs = { load, race };
})(typeof window !== 'undefined' ? window : globalThis);
