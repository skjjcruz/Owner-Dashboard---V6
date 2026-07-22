// ══════════════════════════════════════════════════════════════════
// js/widgets/league-calendar.js — League Calendar Home widget
//
// Surfaces the next league date + a running agenda of what's coming:
// draft, trade deadline, playoffs, championship, waivers, custom events.
//
// Sizes: sm (next event + countdown) / md / lg / tall / xl / xxl (agenda).
// Click any size → opens the Calendar sub-view inside the Trophy Room.
//
// Depends on: window.WrCalendar (js/tabs/calendar.js)
// Exposes:    window.LeagueCalendarWidget
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    function LeagueCalendarWidget({ size, currentLeague, leagueSkin, setActiveTab, navigateWidget }) {
        // Re-render when league data / drafts settle in.
        const leagueKey = currentLeague?.id || currentLeague?.league_id || '';
        const events = React.useMemo(() => {
            try { return (window.WrCalendar?.getUpcoming(currentLeague, leagueSkin)) || []; }
            catch (e) { return []; }
        }, [leagueKey, leagueSkin, currentLeague]);

        // Open the Calendar inside the Trophy Room (its new home).
        const jump = () => {
            try { window._wrTrophyView = 'calendar'; } catch (e) {}
            if (navigateWidget) navigateWidget('trophies');
            else if (setActiveTab) setActiveTab('trophies');
        };

        const base = {
            background: 'var(--off-black)',
            border: 'var(--card-border)',
            borderRadius: 'var(--card-radius)', padding: 'var(--card-pad, 14px 16px)',
            display: 'flex', flexDirection: 'column', gap: '8px',
            height: '100%', minHeight: 0, cursor: 'pointer', overflow: 'hidden',
        };

        const next = events[0] || null;

        // Countdown helpers — shared across sizes.
        function daysTo(date) { return Math.ceil((date.getTime() - Date.now()) / 86400000); }
        function countdownText(date) {
            const d = daysTo(date);
            if (d <= 0) return 'Today';
            if (d === 1) return 'Tomorrow';
            if (d <= 45) return d + ' days';
            const wk = Math.round(d / 7);
            return wk + ' wks';
        }
        function dateLabel(date) {
            return date.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric',
                year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
            });
        }
        // Urgency color: imminent = gold, this month = white, further = silver.
        function urgencyColor(date) {
            const d = daysTo(date);
            if (d <= 7) return 'var(--gold)';
            if (d <= 30) return 'var(--white)';
            return 'var(--silver)';
        }

        // Empty state — settings not loaded yet.
        if (!next) {
            return React.createElement('div', { style: { ...base, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }, onClick: jump },
                React.createElement('div', { style: { fontSize: '1.2rem' } }, '🗓️'),
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65 } }, 'No upcoming league dates yet — tap to open'),
            );
        }

        // ── SM: next event + countdown ──
        if (size === 'sm') {
            return React.createElement('div', { style: { ...base, justifyContent: 'center', gap: '4px' }, onClick: jump },
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.65, display: 'flex', alignItems: 'center', gap: '5px' } },
                    React.createElement('span', { style: { fontSize: '0.95rem' } }, next.icon),
                    'Next Up',
                ),
                React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, next.title),
                React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1.25rem', fontWeight: 700, color: urgencyColor(next.date), lineHeight: 1 } }, countdownText(next.date)),
                React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6 } }, dateLabel(next.date)),
            );
        }

        // ── Agenda row (md/lg/tall/xl/xxl) ──
        function agendaRow(event, highlight) {
            return React.createElement('div', {
                key: event.id,
                style: {
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '6px 8px', borderRadius: '6px',
                    background: highlight ? 'var(--acc-fill1, rgba(212,175,55,0.06))' : 'var(--ov-1, rgba(255,255,255,0.02))',
                    border: '1px solid ' + (highlight ? 'var(--acc-line1, rgba(212,175,55,0.25))' : 'var(--ov-3, rgba(255,255,255,0.05))'),
                },
            },
                React.createElement('span', { style: { fontSize: '0.95rem', flexShrink: 0 } }, event.icon),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                    React.createElement('div', { style: { fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, color: highlight ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                        event.title,
                        highlight && React.createElement('span', { style: { fontSize: '0.55rem', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: 'var(--gold)', color: 'var(--black)', marginLeft: '6px', verticalAlign: 'middle', letterSpacing: '0.04em' } }, 'NEXT'),
                    ),
                    React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, dateLabel(event.date) + (event.detail ? ' · ' + event.detail : '')),
                ),
                React.createElement('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: urgencyColor(event.date), flexShrink: 0 } }, countdownText(event.date)),
            );
        }

        // Header row (shared by agenda sizes).
        const header = React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
            React.createElement('span', { style: { fontSize: '1rem' } }, '🗓️'),
            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.88rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em', flex: 1 } }, 'League Calendar'),
            React.createElement('span', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.7 } }, 'open →'),
        );

        // How many agenda rows fit each size.
        const rowBudget = { md: 2, narrow: 8, lg: 4, tall: 7, xl: 4, xxl: 9 };
        const limit = rowBudget[size] || 4;
        const shown = events.slice(0, limit);
        const hidden = events.length - shown.length;

        return React.createElement('div', { style: base, onClick: jump },
            header,
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', overflow: 'hidden' } },
                ...shown.map((e, i) => agendaRow(e, i === 0)),
            ),
            hidden > 0 && React.createElement('div', { style: { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textAlign: 'center', flexShrink: 0 } }, '+' + hidden + ' more in Trophy Room'),
        );
    }

    window.LeagueCalendarWidget = LeagueCalendarWidget;
})();
