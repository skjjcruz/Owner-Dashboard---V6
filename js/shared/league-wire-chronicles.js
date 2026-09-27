// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-chronicles.js — window.WrWireChronicles
// Championship history for The Wire, built ONLY from Sleeper's own records.
//
// Dynasty HQ adaptation of C2's chronicles (2026-09-27). C2 fed this module a
// hand-built data file (league-wire-chronicles-data.js) holding two private
// leagues' spreadsheet history — real names, owner ids and non-Sleeper
// "documented" facts. That file is NOT ported and nothing here reads one.
// Instead a "book" is derived from the league-history loader
// (js/shared/league-history.js → WrHistory cache: winners_bracket p=1
// placements per linked season, the same data the Trophy Room shows):
//   fromSleeperHistory({ league, history, seasons }) → book | null
//   syncFromHistory(league, seasons?) → reads WrHistory.getCached (no fetch),
//     builds + registers the book, returns it (or null)
//   register(book) / select(league) — registry keyed by every linked
//     Sleeper league id, so past-season editions find the same book.
//   enrich(edition, { league, board, end, nameFor }) — adds "Championship
//     history" lookbacks, back-to-back features, "Title watch" (forward-
//     looking, labelled: not seeds, not a forecast) and title-game rematch
//     context on recaps/previews.
// Facts carry: id 'sleeper-final-<season>', type 'final', classification
// 'sleeper', owners [champion, runner-up] (Sleeper user ids), that season's
// team names, scores null (the history summary does not keep both final
// scores — never guessed; Studio's bracket view loads verified scores on
// demand), and a Sleeper winners_bracket source when the season's league id
// is known. A season only counts once its title game has a winner.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const str = value => String(value);
    const score = value => Number(value).toFixed(2);
    const registry = new Map();
    const bookSignature = book => JSON.stringify([book.leagueIds, book.facts.map(f => [f.id, f.owners, f.winner, f.loser, f.sources])]);

    function fromSleeperHistory({ league, history, seasons = [] } = {}) {
        const leagueId = str(league?.league_id || league?.id || '');
        if (!leagueId || !history || typeof history !== 'object') return null;
        if (history.leagueId != null && str(history.leagueId) !== leagueId) return null;
        const champs = history.championships || {};
        const ids = new Map([[str(league.season || ''), leagueId]]);
        (seasons || []).forEach(s => { const l = s?.league || s; if (l?.season && (l.league_id || l.id)) ids.set(str(l.season), str(l.league_id || l.id)); });
        const facts = Object.keys(champs).map(Number).filter(Number.isFinite).sort((a, b) => b - a).map(season => {
            const c = champs[season] || champs[str(season)] || {};
            const winner = typeof c.championName === 'string' ? c.championName.trim() : '';
            if (!winner || !c.championOwnerId) return null; // no verified champion account → no fact
            const loser = typeof c.runnerUpName === 'string' && c.runnerUpName.trim() && c.runnerUpOwnerId ? c.runnerUpName.trim() : null;
            const lid = ids.get(str(season));
            return {
                id: 'sleeper-final-' + season, type: 'final', season, classification: 'sleeper',
                owners: [str(c.championOwnerId), loser ? str(c.runnerUpOwnerId) : null],
                winner, loser, scores: null,
                sources: [lid ? { label: `Sleeper ${season} playoff bracket`, url: `https://api.sleeper.app/v1/league/${encodeURIComponent(lid)}/winners_bracket` } : { label: `Sleeper ${season} playoff bracket` }],
            };
        }).filter(Boolean);
        if (!facts.length) return null;
        const years = facts.map(f => f.season);
        const leagueIds = [...new Set([leagueId, ...ids.values(), ...(league.previous_league_id ? [str(league.previous_league_id)] : [])])];
        return {
            name: league.name || 'League history', leagueIds, facts, excluded: [],
            coverage: `Title games from Sleeper's playoff brackets, ${Math.min(...years)}–${Math.max(...years)} (${facts.length} season${facts.length === 1 ? '' : 's'} with a decided final). Team names are as they were that season. Final scores are not stored in this summary.`,
        };
    }
    function register(book) {
        if (!book || !Array.isArray(book.leagueIds)) return false;
        const previous = registry.get(book.leagueIds[0]);
        if (previous && bookSignature(previous) === bookSignature(book)) return false;
        book.leagueIds.forEach(id => registry.set(str(id), book));
        return true;
    }
    function syncFromHistory(league, seasons = []) {
        const id = league?.league_id || league?.id;
        if (!id) return null;
        let history = null;
        try { history = root.WrHistory?.getCached?.(id) || null; } catch (_) { history = null; }
        const book = fromSleeperHistory({ league, history, seasons });
        if (book) register(book);
        return book || select(league);
    }
    function select(league) {
        const ids = [league?.league_id || league?.id, league?.previous_league_id].filter(Boolean).map(str);
        const matches = [...new Set(ids.map(id => registry.get(id)).filter(Boolean))];
        return matches.length === 1 ? matches[0] : null;
    }
    const citation = source => source.label;
    function enrich(edition, { league, board = null, end = 0, nameFor = rid => `Team ${rid}` }) {
        const book = select(league);
        if (!book) return edition;
        const year = Number(league.season);
        // Only seasons BEFORE this edition's season: a past edition never
        // knows a later title, and a current final still in play is absent.
        const eligible = book.facts.filter(f => f.classification === 'sleeper' && Number(f.season) < year);
        const owners = new Map((league.rosters || []).filter(r => r.owner_id).map(r => [str(r.owner_id), r.roster_id]));
        const rosterIds = facts => [...new Set(facts.flatMap(f => f.owners || []).filter(Boolean).map(str).filter(id => owners.has(id)).map(id => owners.get(id)))];
        const finals = eligible.filter(f => f.type === 'final').sort((a, b) => b.season - a.season);
        const stories = [];
        const story = (facts, category, text, body, weight = 45) => {
            const eventSeason = Math.max(...facts.map(f => f.season));
            const sources = [...new Map(facts.flatMap(f => f.sources).map(s => [JSON.stringify(s), s])).values()];
            const item = { id: 'chronicle:' + facts.map(f => f.id).join(':'), kind: 'story', category,
                text, body, season: str(league.season), eventSeason, week: end, documentary: true, classification: 'sleeper',
                label: `${eventSeason} · ${category.toUpperCase()}`, rosterIds: rosterIds(facts), weight, sources, related: [] };
            stories.push(item);
            return item;
        };
        finals.forEach(f => {
            story([f], 'Championship history', `Looking back: ${f.winner}’s ${f.season} title`,
                f.loser ? `${f.winner} beat ${f.loser} in the ${f.season} championship game, according to Sleeper’s playoff bracket. Team names are as they were that season.` : `Sleeper’s playoff bracket lists ${f.winner} as the ${f.season} champion. The runner-up could not be matched to a manager account.`);
            const earlier = finals.find(p => p.season === f.season - 1 && p.owners[0] && p.owners[0] === f.owners[0]);
            if (earlier) story([earlier, f], 'Dynasty watch', `Looking back: ${f.winner}’s ${earlier.season}–${f.season} back-to-back titles`,
                `${earlier.season} and ${f.season}: two consecutive titles for the same manager${earlier.loser && f.loser ? (earlier.owners[1] && earlier.owners[1] === f.owners[1] ? `, both against ${f.loser}` : `, beating ${earlier.loser} and then ${f.loser}`) : ''}.` + (earlier.owners[1] && earlier.owners[1] === f.owners[1] ? ' The same opponent reached both finals: a championship rematch in consecutive seasons.' : ''), 58);
        });
        // History becomes current news only when there is a current, completed
        // record for the same verified owner. Never use a roster slot as identity.
        if (edition.completedThrough === end && edition.table.length && end > 0) {
            const contenders = [];
            const record = team => `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`;
            const currentStory = (facts, teamIds, text, body, weight = 76) => {
                const item = story(facts, 'Title watch', text, body, weight);
                item.id = `title-watch:${year}:${end}:${teamIds.join(':')}`;
                item.documentary = false; item.contextual = true;
                item.label = `WK ${end} · TITLE WATCH`; item.rosterIds = teamIds;
                item.related.push({ label: 'History & current form', text: `Past titles come from Sleeper’s playoff brackets for the listed seasons. The ${year} record is through Week ${end}${Number(league.settings?.league_average_match) === 1 ? ', including median games' : ''}. The Wire’s standings use record, then points scored; they are not official playoff seeds or a championship forecast.` });
                return item;
            };
            owners.forEach((rid, account) => {
                const team = edition.table.find(t => str(t.rid) === str(rid));
                const titles = finals.filter(f => f.owners?.[0] && str(f.owners[0]) === account);
                if (!team || !titles.length) return;
                const latest = titles[0], name = String(nameFor(rid)).trim();
                const years = [...new Set(titles.map(f => Number(f.season)))].sort((a, b) => b - a);
                let streak = 0;
                while (years.includes(year - 1 - streak)) streak++;
                const headline = streak >= 2 ? `Can ${name} make it ${streak + 1} titles in a row?`
                    : streak === 1 ? `Can ${name} make it back-to-back?`
                        : team.wins < team.losses ? `Can ${name} get back to championship form?` : `Another title run for ${name}?`;
                const now = `${name} are ${record(team)} through Week ${end}${Number(league.settings?.league_average_match) === 1 ? ', including median results' : ''}, with ${score(team.pf)} points scored. That puts them at No. ${team.rank} in The Wire’s standings.`;
                const history = streak ? `${latest.winner} won the ${latest.season} title${streak > 1 ? ` after winning ${years.slice(1, streak).join(' and ')}` : ''}.`
                    : `${latest.winner}’s last title in Sleeper’s records came in ${latest.season}${years.length > 1 ? `, following ${years.slice(1).join(' and ')}` : ''}.`;
                const outlook = streak ? `The ${year} campaign is a bid for ${streak === 1 ? 'back-to-back championships' : `${streak + 1} consecutive titles`}.`
                    : team.wins < team.losses ? 'A return to that level starts with turning this season’s record around.' : 'Another title would add to that history; the current results are the next chapter.';
                currentStory(titles, [rid], headline, `${now}\n\n${history} ${outlook}`, streak >= 2 ? 81 : 76);
                if (years.length === 2) contenders.push({ rid, name, team, titles });
            });
            if (contenders.length >= 2) {
                const group = contenders.slice().sort((a, b) => a.team.rank - b.team.rank).slice(0, 3);
                currentStory(group.flatMap(c => c.titles), group.map(c => c.rid), 'The chase for title No. 3',
                    `${group.map(c => c.name).join(', ')} each have two titles in Sleeper’s championship record. Through Week ${end}: ${group.map(c => `${c.name} at ${record(c.team)}`).join('; ')}. Who adds the next chapter?`, 78);
            }
        }
        const rematchFacts = ids => {
            if (ids.length !== 2) return [];
            const a = league.rosters?.find(r => str(r.roster_id) === str(ids[0]))?.owner_id;
            const b = league.rosters?.find(r => str(r.roster_id) === str(ids[1]))?.owner_id;
            if (!a || !b || a === b) return [];
            return finals.filter(f => f.owners.length === 2 && f.owners.every(Boolean) && f.owners.includes(str(a)) && f.owners.includes(str(b)));
        };
        const context = facts => facts.map(f => `${f.winner} beat ${f.loser} in the ${f.season} final.`).join('\n\n');
        const titleScope = { label: 'About this history', text: 'These championship results are separate from the regular-season series. Names reflect the season in which each final was played.' };
        const decorate = item => {
            if (item.kind !== 'recap' && !item.preview) return item;
            const facts = rematchFacts(item.rosterIds || []);
            return !facts.length ? item : { ...item, related: [...(item.related || []), { label: 'Championship history', text: context(facts) }, titleScope], sources: [...(item.sources || []), ...facts.flatMap(f => f.sources)] };
        };
        const previews = edition.previews.map(decorate);
        const groups = new Map();
        (board?.rows || []).forEach(r => { if (r.matchup_id == null) return; const key = str(r.matchup_id); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
        if (root.WrWireStories && Number(board?.week) > edition.completedThrough && Number(board?.week) <= root.WrWireStories.bounds(league).end) groups.forEach(pair => {
            if (pair.length !== 2) return;
            const ids = pair.map(r => r.roster_id), facts = rematchFacts(ids);
            if (!facts.length) return;
            // One matchup gets one story: add title context to an existing
            // preview instead of publishing the same pair twice.
            const existing = previews.find(item => item.rosterIds?.length === 2 && ids.every(id => item.rosterIds.some(rid => str(rid) === str(id))));
            if (existing) {
                existing.category = 'Rivalry watch'; existing.label = `WK ${Number(board.week)} · CHAMPIONSHIP REMATCH`;
                existing.weight = Math.max(existing.weight || 0, 79);
                return;
            }
            // A title rematch never increments the regular-season rivalry count.
            previews.push({ id: `title-rematch:${league.league_id || league.id}:${board.week}:${ids.join(':')}`, kind: 'story', category: 'Rivalry watch', label: 'CHAMPIONSHIP REMATCH',
                text: `${nameFor(ids[0])} vs. ${nameFor(ids[1])}: a title-game rematch`,
                body: `${context(facts.slice(0, 1))} The matchup returns in Week ${Number(board.week)}.`,
                related: [...(facts.length > 1 ? [{ label: 'Earlier title meetings', text: context(facts.slice(1)) }] : []), titleScope],
                season: str(year), week: Number(board.week), rosterIds: ids, preview: true, weight: 79, sources: facts.flatMap(f => f.sources) });
        });
        return { ...edition, stories: edition.stories.map(decorate).concat(stories), previews,
            chronicle: { name: book.name, coverage: book.coverage, finals, records: [], sources: [...new Set(eligible.flatMap(f => f.sources).map(citation))], excluded: [] } };
    }
    root.WrWireChronicles = { fromSleeperHistory, register, syncFromHistory, select, enrich };
})(typeof window !== 'undefined' ? window : globalThis);
