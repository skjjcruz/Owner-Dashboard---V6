// ══════════════════════════════════════════════════════════════════
// js/tabs/calendar.js — League Calendar: Key Dates & Deadlines
// Shows trade deadlines, draft dates, playoffs, and custom events.
// Data from league settings + localStorage custom events.
//
// The event-building logic is exposed as window.WrCalendar so the Home
// dashboard "League Calendar" widget can reuse the exact same dates.
// ══════════════════════════════════════════════════════════════════

// ─── Shared calendar engine — window.WrCalendar ──────────────────────
const WrCalendar = (function () {
    function eventsKey(leagueId) { return 'wr_calendar_' + leagueId; }
    function readCustomEvents(leagueId) {
        try { return JSON.parse(localStorage.getItem(eventsKey(leagueId)) || '[]'); } catch { return []; }
    }

    // Build the full league calendar (league-derived events + custom events),
    // sorted ascending by date. Returns items with real Date objects so callers
    // can compute countdowns. Past events are included — callers filter.
    function build(currentLeague, leagueSkin, customEvents) {
        const items = [];
        const settings = currentLeague?.settings || {};
        const season = currentLeague?.season || new Date().getFullYear();
        const now = Date.now();
        const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
        const isSeasonalLeague = !!resolvedLeagueSkin?.state?.isSeasonal;
        const rosteredPlayerCount = resolvedLeagueSkin?.state?.rosterPlayerCount ?? (currentLeague?.rosters || []).reduce((sum, roster) => {
            const ids = []
                .concat(roster?.players || [])
                .concat(roster?.starters || [])
                .concat(roster?.reserve || [])
                .concat(roster?.taxi || [])
                .filter(id => id && String(id) !== '0');
            return sum + new Set(ids.map(String)).size;
        }, 0);
        const suppressSeasonalWaivers = isSeasonalLeague && (
            resolvedLeagueSkin?.phase === 'pre_draft' ||
            resolvedLeagueSkin?.phase === 'offseason' ||
            resolvedLeagueSkin?.phase === 'complete' ||
            rosteredPlayerCount === 0
        );
        const draftTitle = isSeasonalLeague ? 'League Draft' : 'Rookie Draft';

        // Phase 9: Draft date — prefer metadata, fall back to drafts[].start_time
        // so a scheduled draft shows up even when the league hasn't set metadata.draft_date.
        if (currentLeague?.draft_id || settings.draft_rounds) {
            let draftTs = currentLeague?.metadata?.draft_date;
            let draftType = currentLeague?.metadata?.draft_type;
            let draftRounds = Number(settings.draft_rounds || 0);
            let latestDraft = null;
            const drafts = (window.S && window.S.drafts) || currentLeague?.drafts || [];
            if (!draftTs) {
                const sameSeason = drafts.find(d => String(d.season) === String(season));
                latestDraft = sameSeason || drafts[0] || null;
                if (latestDraft) {
                    draftTs = latestDraft.start_time || latestDraft.scheduled_time || latestDraft.start_ts;
                    draftType = draftType || latestDraft.type || latestDraft.settings?.slot_type || 'snake';
                    draftRounds = Number(latestDraft.settings?.rounds || latestDraft.settings?.round_count || latestDraft.rounds || draftRounds || 0);
                }
            }
            draftRounds = window.App?.LeagueSkin?.resolveDraftRounds?.({
                league: currentLeague,
                leagueSkin: resolvedLeagueSkin,
                draft: latestDraft,
                drafts,
                fallbackRounds: draftRounds || settings.draft_rounds || 0,
            }) || draftRounds;
            if (draftTs) {
                items.push({
                    id: 'draft',
                    title: draftTitle,
                    date: new Date(Number(draftTs)),
                    icon: '🏈',
                    type: 'league',
                    detail: (draftRounds ? draftRounds + ' rounds' : 'Draft') + ', ' + (draftType || 'snake'),
                });
            } else {
                // Still surface a placeholder so the user knows a draft exists but the date isn't set
                items.push({
                    id: 'draft',
                    title: draftTitle,
                    date: new Date(season, 7, 15), // mid-August placeholder
                    icon: '🏈',
                    type: 'league',
                    detail: (draftRounds ? draftRounds + ' rounds' : 'Draft') + ' · date TBD',
                    tbd: true,
                });
            }
        }

        // Trade deadline
        const tradeDeadline = settings.trade_deadline;
        if (tradeDeadline && tradeDeadline > 0) {
            // Sleeper uses week number for trade deadline
            // Approximate: season start (Sept 5) + (week * 7 days)
            const seasonStart = new Date(season, 8, 5); // Sept 5
            const deadlineDate = new Date(seasonStart.getTime() + tradeDeadline * 7 * 86400000);
            items.push({
                id: 'trade-deadline',
                title: 'Trade Deadline',
                date: deadlineDate,
                icon: '🔒',
                type: 'league',
                detail: 'Week ' + tradeDeadline,
            });
        }

        // Playoff start
        const playoffStart = settings.playoff_week_start;
        if (playoffStart && playoffStart > 0) {
            const seasonStart = new Date(season, 8, 5);
            const playoffDate = new Date(seasonStart.getTime() + playoffStart * 7 * 86400000);
            items.push({
                id: 'playoffs',
                title: 'Playoffs Begin',
                date: playoffDate,
                icon: '⭐',
                type: 'league',
                detail: (settings.playoff_teams || 6) + ' teams qualify',
            });

            // Championship week (2-3 weeks after playoff start depending on bracket)
            const playoffWeeks = settings.playoff_round_type === 2 ? 4 : 3; // 2-week per round = 4 weeks
            const champDate = new Date(playoffDate.getTime() + (playoffWeeks - 1) * 7 * 86400000);
            items.push({
                id: 'championship',
                title: 'Championship Week',
                date: champDate,
                icon: '🏆',
                type: 'league',
            });
        }

        // Season start (Week 1)
        const seasonStartDate = new Date(season, 8, 5);
        if (seasonStartDate.getTime() > now - 30 * 86400000) {
            items.push({
                id: 'season-start',
                title: 'Season Kickoff',
                date: seasonStartDate,
                icon: '🚀',
                type: 'league',
                detail: season + ' NFL Season',
            });
        }

        // Waiver processing (ongoing — show next occurrence)
        const waiverType = settings.waiver_type;
        if (waiverType && !suppressSeasonalWaivers) {
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const waiverDay = settings.waiver_day_of_week || 3; // Default Wednesday
            const nextWaiver = new Date();
            nextWaiver.setDate(nextWaiver.getDate() + ((waiverDay - nextWaiver.getDay() + 7) % 7 || 7));
            nextWaiver.setHours(0, 0, 0, 0);
            items.push({
                id: 'waivers',
                title: 'Waivers Process',
                date: nextWaiver,
                icon: '💰',
                type: 'recurring',
                detail: 'Every ' + dayNames[waiverDay] + (settings.waiver_budget ? ' · $' + settings.waiver_budget + ' FAAB' : ''),
            });
        }

        // Custom events
        (customEvents || []).forEach(e => {
            items.push({
                id: e.id,
                title: e.title,
                date: new Date(e.date),
                icon: '📌',
                type: 'custom',
                isCustom: true,
            });
        });

        // Sort by date
        return items.sort((a, b) => a.date.getTime() - b.date.getTime());
    }

    // Full calendar for a league, reading custom events from localStorage.
    function getEvents(currentLeague, leagueSkin) {
        const leagueId = currentLeague?.id || currentLeague?.league_id || '';
        return build(currentLeague, leagueSkin, readCustomEvents(leagueId));
    }

    // Upcoming events only (now onward, with a small grace window so dates
    // earlier today — e.g. midnight waiver runs — still surface).
    function getUpcoming(currentLeague, leagueSkin) {
        const cutoff = Date.now() - 12 * 3600000;
        return getEvents(currentLeague, leagueSkin).filter(e => e.date.getTime() >= cutoff);
    }

    return { eventsKey, readCustomEvents, build, getEvents, getUpcoming };
})();
window.WrCalendar = WrCalendar;

function CalendarTab({ currentLeague, myRoster, leagueSkin }) {
    const { useState, useMemo } = React;
    const leagueId = currentLeague?.id || currentLeague?.league_id || '';
    const EVENTS_KEY = 'wr_calendar_' + leagueId;

    const [customEvents, setCustomEvents] = useState(() => {
        try { return JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]'); } catch { return []; }
    });
    const [showAdd, setShowAdd] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDate, setNewDate] = useState('');

    // ── Build calendar events from league settings + custom ──
    // Delegates to the shared engine (window.WrCalendar, defined above)
    // so the Home dashboard "League Calendar" widget shows the same dates.
    const events = useMemo(
        () => WrCalendar.build(currentLeague, leagueSkin, customEvents),
        [currentLeague, customEvents, leagueSkin]
    );

    // ── Add custom event ──
    function addEvent() {
        if (!newTitle.trim() || !newDate) return;
        const event = { id: 'custom_' + Date.now(), title: newTitle.trim(), date: newDate };
        const updated = [...customEvents, event];
        setCustomEvents(updated);
        localStorage.setItem(EVENTS_KEY, JSON.stringify(updated));
        setNewTitle('');
        setNewDate('');
        setShowAdd(false);
    }

    function removeEvent(id) {
        const updated = customEvents.filter(e => e.id !== id);
        setCustomEvents(updated);
        localStorage.setItem(EVENTS_KEY, JSON.stringify(updated));
    }

    // ── Styles ──
    const cardStyle = { background: 'var(--black)', border: 'var(--card-border)', borderRadius: 'var(--card-radius, 10px)', overflow: 'hidden' };
    const headerStyle = { fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-hero, 2rem)', fontWeight: 600, color: 'var(--gold)', letterSpacing: '0.06em' };

    const now = Date.now();

    return React.createElement('div', null,
        // Header with Add button
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '12px' } },
            React.createElement('div', { style: { ...headerStyle, flex: 1 } }, 'LEAGUE CALENDAR'),
            React.createElement('button', { title: 'Add custom calendar event', onClick: () => setShowAdd(!showAdd), style: { background: 'none', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 'var(--card-radius-sm)', color: 'var(--gold)', fontSize: 'var(--text-label)', fontWeight: 700, padding: '10px 14px', minHeight: '44px', cursor: 'pointer', fontFamily: 'inherit' } }, showAdd ? 'Cancel' : '+ Add Event'),
        ),

        // Add event form
        showAdd && React.createElement('div', { style: { ...cardStyle, padding: '12px', marginBottom: '12px' } },
            React.createElement('input', { value: newTitle, onChange: e => setNewTitle(e.target.value), placeholder: 'Event title (e.g. "League Meeting")', style: { width: '100%', padding: '8px 10px', minHeight: '44px', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius-sm)', color: 'var(--white)', fontSize: 'var(--text-label)', fontFamily: 'inherit', marginBottom: '8px', boxSizing: 'border-box' } }),
            React.createElement('input', { type: 'date', value: newDate, onChange: e => setNewDate(e.target.value), style: { width: '100%', padding: '8px 10px', minHeight: '44px', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius-sm)', color: 'var(--white)', fontSize: 'var(--text-label)', fontFamily: 'inherit', marginBottom: '8px', boxSizing: 'border-box' } }),
            React.createElement('button', { onClick: addEvent, style: { width: '100%', padding: '8px', minHeight: '44px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: 'var(--card-radius-sm)', fontSize: 'var(--text-label)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } }, 'Add to Calendar'),
        ),

        // Events timeline
        React.createElement('div', { style: cardStyle },
            events.length === 0
                ? React.createElement('div', { style: { padding: '30px', textAlign: 'center', color: 'var(--silver)', fontSize: 'var(--text-label)' } }, 'No events yet. League dates will appear here once your league settings load.')
                : React.createElement('div', null,
                    events.map((event, i) => {
                        const isPast = event.date.getTime() < now;
                        const isNext = !isPast && (i === 0 || events[i - 1].date.getTime() < now);
                        const daysAway = Math.ceil((event.date.getTime() - now) / 86400000);
                        const dateStr = event.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: event.date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
                        const countdown = !isPast && daysAway <= 30 ? (daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : daysAway + ' days') : null;

                        return React.createElement('div', { key: event.id, style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderBottom: i < events.length - 1 ? '1px solid var(--ov-3, rgba(255,255,255,0.04))' : 'none', opacity: isPast ? 0.4 : 1, background: isNext ? 'var(--acc-fill1, rgba(212,175,55,0.06))' : 'transparent' } },
                            // Timeline dot
                            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '28px', flexShrink: 0 } },
                                React.createElement('span', { style: { fontSize: '1.1rem' } }, event.icon),
                            ),
                            // Content
                            React.createElement('div', { style: { flex: 1 } },
                                React.createElement('div', { style: { fontSize: 'var(--text-body)', fontWeight: 600, color: isNext ? 'var(--gold)' : 'var(--white)' } }, event.title, isNext && React.createElement('span', { style: { fontSize: 'var(--text-micro)', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: 'var(--gold)', color: 'var(--black)', marginLeft: '6px' } }, 'NEXT')),
                                React.createElement('div', { style: { fontSize: 'var(--text-label)', color: 'var(--silver)', marginTop: '2px' } }, dateStr, event.detail ? ' \u00B7 ' + event.detail : ''),
                            ),
                            // Countdown or delete
                            countdown && React.createElement('span', { style: { fontSize: 'var(--text-label)', fontWeight: 700, color: 'var(--gold)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 } }, countdown),
                            event.isCustom && React.createElement('button', { title: 'Remove custom calendar event', onClick: () => removeEvent(event.id), style: { background: 'none', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: 'var(--text-body, 1rem)', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 0.7 } }, '\u2715'),
                        );
                    })
                ),
        ),
    );
}
