// ══════════════════════════════════════════════════════════════════
// js/shared/league-wire-reading.js — window.WrWireReading (ported from C2,
// 2026-09-27, unchanged). Reading helpers keep short summaries, search and
// freshness labels identical across the league Wire and the all-leagues Wire.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const paragraphs = body => String(body || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    function deck(story) {
        const first = paragraphs(story.body)[0] || '';
        const words = first.split(/\s+/);
        return words.length > 48 ? words.slice(0, 48).join(' ') + '…' : first;
    }
    function matches(story, query) {
        const terms = String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const text = [story.text, story.body, story.category, story.league?.name, ...(story.related || []).map(r => r.text)].filter(Boolean).join(' ').toLocaleLowerCase();
        return terms.every(term => text.includes(term));
    }
    function checked(at) {
        if (!at) return '';
        const date = new Date(at);
        return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    }
    function period(entry) {
        const results = Number(entry.completedThrough) > 0 ? `Results through Week ${entry.completedThrough}` : 'Awaiting the first completed results';
        return `${entry.historical ? `${entry.league.season} archive · ` : ''}${results}${!entry.historical && Number(entry.week) > Number(entry.completedThrough) && entry.week <= (root.WrWireStories?.bounds(entry.league).end || 18) ? ` · Week ${entry.week} matchups` : ''}`;
    }
    function retain(previous, next) {
        const same = previous && String(previous.league.league_id || previous.league.id) === String(next.league.league_id || next.league.id) && String(previous.league.season) === String(next.league.season);
        if (!same || !previous.currentReady || next.currentReady) return next;
        if (previous.week !== next.week) return { ...previous, status: next.status, currentError: next.currentError, error: next.error, stale: !!next.currentError, refreshing: next.status === 'loading' };
        // Results and the schedule can refresh independently. A failed source
        // keeps its last reporting; a successful source replaces only its part.
        const results = next.resultsReady ? next : previous;
        const schedule = next.scheduleReady ? next : previous;
        const times = [results.currentUpdatedAt, schedule.currentUpdatedAt].filter(t => Number(t) > 0);
        return { ...next, stories: [...results.stories.filter(s => !s.preview), ...schedule.stories.filter(s => s.preview)],
            race: results.race || null, rivalryProfiles: results.rivalryProfiles || [], completedThrough: results.completedThrough, currentReady: true, resultsReady: true, scheduleReady: true,
            currentUpdatedAt: times.length ? Math.min(...times) : null, stale: !!next.currentError || next.status === 'error', refreshing: next.status === 'loading' };
    }
    function finish(entry, league) {
        if (entry && entry.status !== 'loading') return entry;
        if (entry?.currentReady && !entry.refreshing && !entry.currentError) {
            const message = 'Earlier history took too long to load. Current news is available.';
            return { ...entry, status: 'partial', archiveError: message, error: message };
        }
        const message = 'The refresh took too long. Refresh news to try again.';
        return { ...(entry || { league, stories: [] }), status: 'partial', refreshing: false, stale: !!entry?.currentReady, currentError: entry?.currentError || message, error: entry?.currentError || message };
    }
    root.WrWireReading = { paragraphs, deck, matches, checked, period, retain, finish };
})(typeof window !== 'undefined' ? window : globalThis);
