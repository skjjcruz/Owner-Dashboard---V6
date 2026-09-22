// js/widgets/txn-ticker.js — shared Transaction Ticker rows (owner ask
// 2026-08-28: the Free Agency ticker is a direct lift of the home-tab
// widget, so both tabs render transaction rows through this one component
// instead of maintaining two designs).
//
// Presentational only. The dashboard keeps its card header, skeletons, and
// tap-to-expand detail overlay; Free Agency keeps its panel chrome. Props:
//   transactions  — flattened txn array, newest first, already capped
//   getOwnerName  — roster_id → display name
//   getPlayerName — pid → display name
//   timeAgo       — optional ts → label (built-in fallback matches the
//                   dashboard's format)
//   onRowTap      — optional; when present rows are tappable (dashboard
//                   passes its detail-overlay opener; Free Agency omits it)
//   colors        — optional { S, W, G } theme overrides (dashboard passes
//                   its WrTheme values so themed leagues stay identical)
(function () {
    'use strict';

    // A missing feed is different from a confirmed empty response. Keep this
    // status next to the rows so every current consumer can carry uncertainty.
    const tradeProviderLabel = provider => ({ espn: 'ESPN', yahoo: 'Yahoo' }[provider] || 'Provider');
    const confirmedEmptyTrades = status => 'No completed trades returned by ' + tradeProviderLabel(status?.provider) + '.';
    function resolveTransactionFeed(hydrated, league, providerId) {
        if (!['espn', 'yahoo'].includes(providerId)) return { transactions: hydrated.transactions || {}, status: null };
        const leagueId = String(league.id || league.league_id || '');
        const season = String(league.season || '');
        const supplied = hydrated.transactionStatus;
        const valid = supplied?.provider === providerId && supplied.leagueId === leagueId && supplied.season === season && supplied.scope === 'executed_trades'
            && ['ready', 'stale', 'unavailable'].includes(supplied.status)
            && Number.isInteger(supplied.excludedTradeCount) && supplied.excludedTradeCount >= 0
            && (supplied.status === 'unavailable' || Number.isFinite(supplied.lastSuccessAt) && supplied.lastSuccessAt > 0)
            && hydrated.transactions && !Array.isArray(hydrated.transactions) && typeof hydrated.transactions === 'object'
            && Object.values(hydrated.transactions).every(rows => Array.isArray(rows) && rows.every(row => row?.type === 'trade' && row.status === 'complete'));
        const status = valid ? { ...supplied } : { provider: providerId, leagueId, season, scope: 'executed_trades', status: 'unavailable', lastSuccessAt: null };
        const label = tradeProviderLabel(providerId);
        status.message = status.status === 'ready' ? 'Completed ' + label + ' trades only. Adds, drops and waivers are not included.'
            : status.status === 'stale' ? label + ' trades could not refresh. Showing the last confirmed feed.'
                : label + ' trades are unavailable. This does not mean there were no trades.';
        if (status.excludedTradeCount > 0) status.message += ' Other trade records were excluded because ' + label + ' did not mark them ' + (providerId === 'yahoo' ? 'successful.' : 'executed.');
        return { transactions: valid && status.status !== 'unavailable' ? hydrated.transactions : {}, status };
    }

    function WrTxnFeedStatus({ status, onRetry, retrying }) {
        if (!status) return null;
        return <div role="status" style={{ fontSize: '14px', lineHeight: 1.45, padding: '10px 0', color: 'var(--silver)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <span style={{ flex: '1 1 180px' }}>{status.message || 'Checking ' + tradeProviderLabel(status.provider) + ' trades…'}{status.status === 'stale' && status.lastSuccessAt ? <small style={{ display: 'block', fontSize: '13px' }}>Last confirmed {new Date(status.lastSuccessAt).toLocaleString()}</small> : null}</span>
            {onRetry && status.status !== 'ready' && <button type="button" onClick={onRetry} disabled={retrying || status.status === 'loading'} style={{ minHeight: '44px', padding: '8px 12px', fontSize: '14px', background: 'transparent', border: '1px solid var(--gold)', borderRadius: '6px', color: 'var(--gold)', cursor: 'pointer' }}>{retrying ? 'Checking trades…' : 'Retry ' + tradeProviderLabel(status.provider) + ' trades'}</button>}
        </div>;
    }
    window.App = window.App || {};
    window.App.TransactionFeed = { resolve: resolveTransactionFeed, label: tradeProviderLabel, emptyMessage: confirmedEmptyTrades };
    window.WrTxnFeedStatus = WrTxnFeedStatus;

    function defaultTimeAgo(ts) {
        if (!ts) return '';
        // Sleeper API returns seconds; convert to ms. Guard against already-ms values.
        const tsMs = ts > 1e12 ? ts : ts * 1000;
        const diff = Date.now() - tsMs;
        if (diff < 0) return 'just now';
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        const days = Math.floor(hrs / 24);
        if (days < 30) return days + 'd ago';
        return Math.floor(days / 30) + 'mo ago';
    }

    function openTickerPlayer(pid) {
        if (!pid) return;
        if (window.WR?.openPlayerCard) {
            window.WR.openPlayerCard(pid);
            return;
        }
        if (typeof window._wrSelectPlayer === 'function') {
            window._wrSelectPlayer(pid);
            return;
        }
        if (typeof window.openPlayerModal === 'function') {
            window.openPlayerModal(pid);
        }
    }

    // Position + NFL team for a ticker row (owner ask 2026-09-08). Read from
    // the same player store every other surface uses, so a pid the store
    // hasn't got yet simply renders the name alone rather than a broken tag.
    function tickerPlayerMeta(pid) {
        try {
            const players = window.S?.players || window.App?.S?.players || {};
            const p = players[String(pid)];
            if (!p) return null;
            const pos = window.App?.posLabel?.(p.position) || (p.position === 'DEF' ? 'D/ST' : p.position) || '';
            // A free agent has no NFL team; say so rather than printing nothing.
            const team = p.team || (pos ? 'FA' : '');
            if (!pos && !team) return null;
            return { pos, team, color: window.App?.posColor?.(p.position) || window.posColor?.(p.position) || null };
        } catch (e) { return null; }
    }

    function WrTxnTickerList({ transactions, getOwnerName, getPlayerName, timeAgo, onRowTap, colors }) {
        const ago = timeAgo || defaultTimeAgo;
        const S = colors?.S || 'var(--silver)';
        const W = colors?.W || 'var(--white)';
        const G = colors?.G || 'var(--gold)';
        function tickerPlayerProps(pid) {
            return {
                role: 'button',
                tabIndex: 0,
                title: 'Open player card',
                onClick: e => { e.stopPropagation(); openTickerPlayer(pid); },
                onKeyDown: e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    openTickerPlayer(pid);
                },
            };
        }
        // Rendered right after the name: position in its own colour (the
        // app-wide convention), NFL team muted beside it.
        function playerTag(pid) {
            const meta = tickerPlayerMeta(pid);
            if (!meta) return null;
            return (
                <span style={{ marginLeft: 4, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, letterSpacing: '0.02em' }}>
                    <span style={{ color: meta.color || S, opacity: meta.color ? 0.95 : 0.6 }}>{meta.pos}</span>
                    {meta.pos && meta.team ? <span style={{ color: S, opacity: 0.35 }}>·</span> : null}
                    <span style={{ color: S, opacity: 0.6 }}>{meta.team}</span>
                </span>
            );
        }
        function tickerRowProps(txn) {
            if (!onRowTap) return {};
            return {
                role: 'button',
                tabIndex: 0,
                title: 'See this transaction in full detail',
                onClick: () => onRowTap(txn),
                onKeyDown: e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    onRowTap(txn);
                },
            };
        }
        // Sleeper trades carry every traded player in BOTH adds{} (keyed to the
        // receiving roster) and drops{} (keyed to the sending roster) — without
        // a side split a 2-for-2 renders '+A +B -A -B'. Render the trade from
        // roster_ids[0]'s perspective (the owner named on the row): + what they
        // received, - what they sent. Non-trades are one-sided already.
        function tickerAddPids(txn) {
            const pids = Object.keys(txn.adds || {});
            if (txn.type !== 'trade' || txn.roster_ids?.[0] == null) return pids;
            return pids.filter(pid => String(txn.adds[pid]) === String(txn.roster_ids[0]));
        }
        function tickerDropPids(txn) {
            const pids = Object.keys(txn.drops || {});
            if (txn.type !== 'trade' || txn.roster_ids?.[0] == null) return pids;
            return pids.filter(pid => String(txn.drops[pid]) === String(txn.roster_ids[0]));
        }
        return (
            <React.Fragment>
                {(transactions || []).map((txn, ti) => (
                    <div key={ti} {...tickerRowProps(txn)} style={{ padding: '8px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.05))', cursor: onRowTap ? 'pointer' : 'default', outline: 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.55, minWidth: '36px' }}>{ago(txn.status_updated || txn.created)}</span>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                                background: txn.type === 'trade' ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : txn.type === 'waiver' ? 'rgba(52,211,153,0.15)' : 'rgba(96,165,250,0.15)',
                                color: txn.type === 'trade' ? G : txn.type === 'waiver' ? 'var(--k-34d399, #34d399)' : 'var(--k-60a5fa, #60a5fa)',
                            }}>{(txn.type === 'free_agent' ? 'FA' : txn.type || '').toUpperCase()}</span>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: S }}>{getOwnerName(txn.roster_ids?.[0])}</span>
                            {txn.type === 'trade' && txn.roster_ids?.[1] && (
                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: S, opacity: 0.6 }}>↔ {getOwnerName(txn.roster_ids[1])}</span>
                            )}
                        </div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: W, paddingLeft: '42px' }}>
                            {tickerAddPids(txn).map(pid => (
                                <span key={'a'+pid} style={{ color: 'var(--good)', cursor: 'pointer', marginRight: '5px' }}
                                    {...tickerPlayerProps(pid)}>
                                    +{getPlayerName(pid)}{playerTag(pid)}
                                </span>
                            ))}
                            {tickerDropPids(txn).map(pid => (
                                <span key={'d'+pid} style={{ color: 'var(--bad)', cursor: 'pointer', marginRight: '5px' }}
                                    {...tickerPlayerProps(pid)}>
                                    -{getPlayerName(pid)}{playerTag(pid)}
                                </span>
                            ))}
                            {txn.settings?.waiver_bid > 0 && <span style={{ color: 'var(--warn)', marginLeft: '2px' }}>${txn.settings.waiver_bid}</span>}
                            {txn.type === 'trade' && txn.draft_picks?.length > 0 && (
                                <span style={{ color: G, fontSize: 'var(--text-label, 0.75rem)', marginLeft: '4px' }}>+{txn.draft_picks.length} pick{txn.draft_picks.length !== 1 ? 's' : ''}</span>
                            )}
                        </div>
                    </div>
                ))}
            </React.Fragment>
        );
    }

    window.WrTxnTickerList = WrTxnTickerList;
})();
