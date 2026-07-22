// ══════════════════════════════════════════════════════════════════
// player-brief-block.js — the shared Player Brief box (WR.PlayerBriefBlock)
//
// One component, every surface: renders the full layered player summary
// (Alex's Read → The Wire → DHQ Read) in the gold brief box with a
// composed-at date/time stamp in the top-right (owner ruling). Used by
// the player card modal and the My Roster expanded row; any future
// surface mounts the same block and stays consistent.
//
// Self-contained: derives DHQ value/meta/age-phase from the engine
// globals, fetches The Wire + market pulse via WR.PlayerWire, and
// composes the floor paragraph via WR.PlayerBrief. Alex's Read is passed
// IN as `alexText` by surfaces that already run the dynasty_read fetch
// (the card's scouting pipeline, My Roster's per-row reader) — the block
// never fires its own AI call, so no surface can double-spend.
//
// Plain JS (React.createElement, no JSX) so it loads as a normal script.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    function stampLabel(d) {
        try {
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                + ' · '
                + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        } catch (_) { return ''; }
    }

    function PlayerBriefBlock(props) {
        var React = window.React;
        if (!React || !props || !props.pid) return null;
        var h = React.createElement;
        var pid = props.pid;
        var playersData = props.playersData || (window.App && window.App._playersCache) || {};

        var ref = React.useState(null); var wire = ref[0], setWire = ref[1];
        var ref2 = React.useState(null); var market = ref2[0], setMarket = ref2[1];
        React.useEffect(function () {
            setWire(null); setMarket(null);
            var PW = window.WR && window.WR.PlayerWire;
            if (!PW) return undefined;
            var alive = true;
            PW.fetchRead(pid, playersData).then(function (r) { if (alive && r && r.story) setWire(r); });
            if (typeof PW.marketFor === 'function') {
                PW.marketFor(pid).then(function (m) { if (alive && m) setMarket(m); });
            }
            return function () { alive = false; };
        }, [pid]);

        // Composed-at stamp: the brief is built from live data at render, so
        // the stamp is the moment this open composed it. Re-stamps per player.
        var stamp = React.useMemo(function () { return stampLabel(new Date()); }, [pid]);

        var brief = React.useMemo(function () {
            try {
                var PB = window.WR && window.WR.PlayerBrief;
                var p = playersData[pid];
                if (!PB || !p) return null;
                var A = window.App || {};
                var scores = (A.LI && A.LI.playerScores) || {};
                var meta = ((A.LI && A.LI.playerMeta) || {})[pid] || {};
                var dhq = scores[pid] || 0;
                var norm = typeof A.normPos === 'function' ? A.normPos : function (x) { return x; };
                var nPos = norm(p.position) || p.position;
                var age = p.age || 0;
                var curve = typeof A.getAgeCurve === 'function'
                    ? A.getAgeCurve(nPos)
                    : { peak: (A.peakWindows || {})[nPos] || [24, 29], decline: [30, 32] };
                var pLo = curve.peak[0], pHi = curve.peak[1];
                var declineHi = (curve.decline && curve.decline[1]) || (pHi + 3);
                var phaseLabel = age < pLo ? 'Rising' : age <= pHi ? 'Prime' : age <= declineHi ? 'Veteran' : 'Post-Window';
                var peakYrs = Math.max(0, pHi - age);
                var pr = PB.posRank(pid, playersData, scores, norm);
                // Canonical BUY/HOLD/SELL (getPlayerAction — the same single
                // source behind the Roster Call chip and the card's Action cell)
                // so the brief's closing call always matches the chips. Pro-gated
                // like those chips; free users keep the generic phase framing.
                var act = null;
                try {
                    var pro = typeof window.wrIsPro !== 'function' || window.wrIsPro();
                    if (pro && typeof window.getPlayerAction === 'function') act = window.getPlayerAction(pid);
                } catch (_) { act = null; }
                var out = PB.compose({
                    player: p, pos: nPos, dhq: dhq, meta: meta,
                    ppg: props.ppg != null ? props.ppg : undefined,
                    posRank: pr && pr.rank, posTotal: pr && pr.total,
                    phaseLabel: phaseLabel, peakYrs: peakYrs,
                    market: market,
                    action: act,
                });
                return out && out.text && out.text.length > 40 ? out.text : null;
            } catch (_) { return null; }
        }, [pid, market, props.ppg]);

        if (!brief) return null;
        var alexText = props.alexText && String(props.alexText).trim() ? String(props.alexText).trim() : null;

        var subhead = function (txt, gold) {
            return h('div', { style: { fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: gold ? 'var(--gold, #d4af37)' : 'var(--silver, #9aa4b2)', opacity: gold ? 0.85 : 0.75, marginBottom: '3px' } }, txt);
        };
        var para = function (txt) {
            return h('div', { style: { fontSize: 'var(--text-body, 0.95rem)', color: 'var(--k-d0d0d0, #d0d0d0)', lineHeight: 1.5 } }, txt);
        };
        var divider = h('div', { style: { borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.07))', marginTop: '9px', marginBottom: '9px' } });

        var kids = [
            h('div', { key: 'head', style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '5px' } },
                h('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold, #d4af37)' } }, 'Player Brief'),
                stamp ? h('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.64rem', color: 'var(--silver, #9aa4b2)', opacity: 0.7, whiteSpace: 'nowrap' } }, stamp) : null,
            ),
        ];
        if (alexText) {
            kids.push(h('div', { key: 'alex' }, subhead("Alex's Read", true), para(alexText), divider));
        }
        if (wire) {
            kids.push(h('div', { key: 'wire' },
                subhead('The Wire · ' + wire.source + (wire.dateLabel ? ' · ' + wire.dateLabel : '')),
                para(wire.story), divider));
        }
        if (alexText || wire) kids.push(h('div', { key: 'dhql' }, subhead('DHQ Read')));
        kids.push(h('div', { key: 'dhq' }, para(brief)));

        return h('div', {
            style: Object.assign({
                padding: '11px 13px',
                border: '1px solid var(--acc-fill3, rgba(212,175,55,0.16))',
                borderLeft: '2px solid var(--gold, #d4af37)',
                borderRadius: '7px',
                background: 'var(--ov-2, rgba(255,255,255,0.025))',
                minWidth: 0,
            }, props.style || {}),
        }, kids);
    }

    window.WR.PlayerBriefBlock = PlayerBriefBlock;
})();
