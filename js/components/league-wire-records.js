// ══════════════════════════════════════════════════════════════════
// js/components/league-wire-records.js — window.WrWireRecordBook
// The Wire's Records desk (C2 1be683d, re-themed for Dynasty HQ). Shown at
// the top of the "Records" section. Cards come from WrWireRecords.build: the
// season high, the archive high and largest win under matching scoring, and
// the cross-era high when rules changed. Each holder names the owner (Sleeper
// display name) and team, with the season, week and a Sleeper matchups link
// as the score receipt. Search and the Team filter narrow the holders; the
// team filter follows the owner account across seasons.
// Props: book, league, search, ownerFilter ({ ownerId, rosterId } | null).
// ══════════════════════════════════════════════════════════════════
function WrWireRecordBook({ book, league, search = '', ownerFilter = null }) {
    const cards = window.WrWireRecords?.filter(book, { search, ownerFilter, season: league?.season }) || [];
    const unit = card => card.id === 'archive-margin' ? 'point margin' : 'fantasy points';
    return <section className="wr-wire-record-book" aria-label={(league?.name || 'League') + ' record book'}>
        <header><span className="wr-wire-feature-kicker">THE MARKS TO BEAT</span><h3>{league?.name || 'League'} record book</h3><p>Standing records from completed regular-season games{book?.throughWeek ? `, through Week ${book.throughWeek} of ${league.season}` : ''}.</p></header>
        {cards.length > 0 && <div className="wr-wire-record-grid">{cards.map(card => <article className="wr-journal-record" key={card.id}>
            <span>{card.title}</span><strong>{card.value.toFixed(2)}</strong><small>{unit(card)} · {card.scope}</small>
            <ul className="wr-wire-record-holders">{card.holders.map((holder, i) => {
                const label = holder.ownerName || holder.teamName || holder.name || 'Recorded holder';
                const team = holder.teamName && holder.teamName !== label ? holder.teamName : '';
                return <li key={i}><b>{label}</b>{team && <span>{team}</span>}<small>{holder.season} · Week {holder.week}</small>
                    {holder.sourceUrl && <a href={holder.sourceUrl} target="_blank" rel="noreferrer">Score receipt (Sleeper) ↗</a>}</li>;
            })}</ul>
        </article>)}</div>}
        {!cards.length && <p className="wr-journal-footnote">{book?.cards?.length ? 'No record holders match this selection. Clear the search or choose the whole league to see every mark.' : 'Records appear after the first completed week. Earlier seasons join the book as the archive loads.'}</p>}
        <details className="wr-journal-context"><summary>Record coverage</summary>
            <p>{book?.complete ? 'The connected Sleeper history chain has been checked.' : 'This book covers the loaded seasons; earlier history may still be missing.'} {(book?.seasons || []).length ? 'Seasons: ' + book.seasons.join(', ') + '.' : ''}</p>
            <p>{book?.rulesChanged ? 'Scoring or starting positions changed. Comparable records use matching rules; the cross-era high keeps each season’s original scoring.' : 'Point records use matching scoring and starting positions.'} Playoff games are not part of these records.</p>
        </details>
    </section>;
}
window.WrWireRecordBook = WrWireRecordBook;
