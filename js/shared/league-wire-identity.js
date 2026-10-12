// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-identity.js — window.WrWireIdentity
// Owner identity for The Wire's bylines, record holders, League life and
// draft receipts. Ported from C2 (1be683d), adapted:
//   • Owner names are ONLY the Sleeper account's display name (else
//     username). C2 could swap in a real name from its private "sourcebook"
//     (league-wire-chronicles-data.js, hand-documented owner bindings). That
//     file is not ported and the name-binding code is removed, so no name can
//     come from anywhere but Sleeper. Our WrWireChronicles books (built from
//     Sleeper history) are still used to link a league's seasons.
//   • NO logos or avatars (owner ruling, Lab 015592e: initials only). C2's
//     logoSources/storyMarks are not ported; initials() is.
// Owner identity follows a verified account within its league family. Team
// names and roster slots are presentation, never evidence of the same person.
//   resolve(league, rosterId, { teamName }) → { ownerId, ownerName, teamName, ownerKnown }
//   forOwner(league, ownerId, { priorSeasons }) → same shape
//   initials(label) → 'AB'
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const text = value => typeof value === 'string' ? value.trim() : '';
    const id = value => (typeof value === 'string' || typeof value === 'number') && String(value).trim() && String(value) !== '0' ? String(value).trim() : null;
    const leagueId = league => id(league?.league_id || league?.id);
    const selectedBook = league => {
        try { return root.WrWireChronicles?.select?.(league) || null; } catch (_) { return null; }
    };
    function account(league, ownerId) {
        if (!ownerId) return { ownerName: null, teamName: null };
        const users = (league?.users || []).filter(user => id(user?.user_id) === ownerId);
        const names = [...new Set(users.map(user => text(user.display_name) || text(user.username)).filter(Boolean))];
        const teamNames = [...new Set(users.map(user => text(user.metadata?.team_name)).filter(Boolean))];
        return { ownerName: names.length === 1 ? names[0] : null, teamName: teamNames.length === 1 ? teamNames[0] : null };
    }
    function linkedSeasons(league, priorSeasons) {
        const year = Number(league?.season), currentId = leagueId(league), book = selectedBook(league);
        const candidates = (priorSeasons || []).map(entry => entry?.league).filter(prior => leagueId(prior) && leagueId(prior) !== currentId && Number(prior.season) < year);
        const grouped = new Map();
        candidates.forEach(prior => { const key = leagueId(prior); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(prior); });
        const allowed = new Set(), visited = new Set([currentId]);
        let cursor = league;
        while (cursor?.previous_league_id && visited.size <= 25) {
            const previousId = id(cursor.previous_league_id), matching = grouped.get(previousId);
            if (!previousId || visited.has(previousId) || matching?.length !== 1 || Number(matching[0].season) >= Number(cursor.season)) break;
            visited.add(previousId); allowed.add(previousId); cursor = matching[0];
        }
        // A registered history book can establish membership when intermediate
        // linked seasons have not loaded yet; matching names never can.
        if (book) candidates.forEach(prior => { if (grouped.get(leagueId(prior))?.length === 1 && book.leagueIds?.map(String).includes(leagueId(prior)) && selectedBook(prior) === book) allowed.add(leagueId(prior)); });
        return candidates.filter(prior => allowed.has(leagueId(prior))).sort((a, b) => Number(b.season) - Number(a.season));
    }
    function resolve(league, rid, { teamName } = {}) {
        const matches = (league?.rosters || []).filter(roster => id(roster?.roster_id) === id(rid));
        const roster = id(rid) && matches.length === 1 ? matches[0] : null;
        const ownerId = id(roster?.owner_id), user = account(league, ownerId);
        const ownerName = user.ownerName;
        return { ownerId, ownerName, teamName: text(teamName) || user.teamName || user.ownerName || (id(rid) ? `Team ${id(rid)}` : 'Team'), ownerKnown: !!ownerName };
    }
    function forOwner(league, owner, { priorSeasons = [] } = {}) {
        const ownerId = id(owner);
        if (!ownerId) return { ownerId: null, ownerName: null, teamName: null, ownerKnown: false };
        const candidates = [league, ...linkedSeasons(league, priorSeasons)];
        const present = candidates.find(candidate => (candidate?.rosters || []).some(roster => id(roster.owner_id) === ownerId));
        const season = present || league, matches = (season?.rosters || []).filter(roster => id(roster.owner_id) === ownerId), user = account(season, ownerId);
        const ownerName = user.ownerName;
        const teamName = matches.length === 1 ? resolve(season, matches[0].roster_id).teamName : null;
        return { ownerId, ownerName, teamName, ownerKnown: !!ownerName };
    }
    function initials(label) {
        const words = text(label).match(/[\p{L}\p{N}]+/gu) || [];
        return words.length > 1 ? (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toLocaleUpperCase() : words.length ? Array.from(words[0]).slice(0, 2).join('').toLocaleUpperCase() : 'WR';
    }
    root.WrWireIdentity = { resolve, forOwner, initials };
})(typeof window !== 'undefined' ? window : globalThis);
