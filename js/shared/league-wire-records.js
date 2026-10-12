// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-records.js — window.WrWireRecords
// The Wire's record book desk. Ported from C2 (1be683d) as-is.
// build({ edition, league, priorSeasons, complete }) turns the journal's
// season and archive records into cards whose every holder names its
// season and week, the owner (Sleeper account via WrWireIdentity) and a
// Sleeper matchups link as the score receipt. A verified 0.00 is a record;
// a missing value is no card. filter() narrows by search text and by owner
// (owner id follows a manager across roster slots; an unknown owner only
// matches its own current-season roster).
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const valid = value => typeof value === 'number' && Number.isFinite(value);
    function build({ edition, league, priorSeasons = [], complete = false }) {
        const archive = edition?.archive || {}, cards = [];
        const contexts = [league, ...priorSeasons.map(entry => entry.league)];
        const add = (id, title, value, holders, scope) => {
            if (!valid(value) || !holders?.length) return;
            cards.push({ id, title, value, scope, holders: holders.map(holder => {
                const season = String(holder.season || league.season);
                const matches = contexts.filter(item => String(item.season) === season);
                const source = matches.length === 1 ? matches[0] : null;
                const who = holder.ownerId ? null : source && holder.rosterId != null ? root.WrWireIdentity?.resolve(source, holder.rosterId) : null;
                return { ...holder, season, ownerId: holder.ownerId || who?.ownerId || null, ownerName: holder.ownerName || who?.ownerName || null,
                    teamName: holder.teamName || who?.teamName || holder.name || null,
                    sourceUrl: source && holder.week ? `https://api.sleeper.app/v1/league/${encodeURIComponent(source.league_id || source.id)}/matchups/${holder.week}` : null };
            }) });
        };
        add('season-high', 'Season scoring high', edition?.high, edition?.records, `${league.season} · through Week ${edition?.completedThrough || 0}`);
        add('archive-high', 'Archive scoring high', archive.high, archive.records, `${(archive.seasons || []).join(', ')} · matching scoring rules`);
        add('archive-margin', 'Largest archived win', archive.margin, archive.margins, `${(archive.seasons || []).join(', ')} · matching scoring rules`);
        if (archive.rulesChanged) add('original-high', 'High across scoring eras', archive.historicalHigh, archive.historicalRecords, `${(archive.allSeasons || []).join(', ')} · original-era points`);
        return { cards, complete, seasons: archive.allSeasons || [], rulesChanged: !!archive.rulesChanged, throughWeek: edition?.completedThrough || 0 };
    }
    function filter(book, { search = '', ownerFilter = null, season } = {}) {
        const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        return (book?.cards || []).map(card => ({ ...card, holders: card.holders.filter(holder => {
            const ownerMatch = !ownerFilter || (ownerFilter.ownerId ? String(holder.ownerId) === String(ownerFilter.ownerId) : String(holder.season) === String(season) && holder.rosterId != null && String(holder.rosterId) === String(ownerFilter.rosterId));
            const text = [card.title, card.scope, holder.ownerName, holder.teamName, holder.name, holder.season, holder.week].join(' ').toLocaleLowerCase();
            return ownerMatch && terms.every(term => text.includes(term));
        }) })).filter(card => card.holders.length);
    }
    root.WrWireRecords = { build, filter };
})(typeof window !== 'undefined' ? window : globalThis);
