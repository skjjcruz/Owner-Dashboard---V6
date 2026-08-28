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
                                    +{getPlayerName(pid)}
                                </span>
                            ))}
                            {tickerDropPids(txn).map(pid => (
                                <span key={'d'+pid} style={{ color: 'var(--bad)', cursor: 'pointer', marginRight: '5px' }}
                                    {...tickerPlayerProps(pid)}>
                                    -{getPlayerName(pid)}
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
