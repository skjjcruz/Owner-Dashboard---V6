// ══════════════════════════════════════════════════════════════════
// js/draft/alex-edge-glow.js — "Peripheral Pulse" edge-glow (presence L3)
//
// A full-screen, pointer-events:none overlay that is invisible at rest and
// blooms the screen perimeter in Alex's accent colour when a high-signal
// moment lands (🔥 run / ⛰ tier break / ⬇ value cliff) — urgency felt in
// peripheral vision with zero panel real estate. A gentle gold inset also
// "breathes" while the user is on the clock.
//
// This is a free accessory to the Alex Call (L2): it fires on the SAME
// high-signal stream items, so the colour-only glow is always accompanied
// by the Call's labelled headline + matching colour (covers the colour-blind
// gap — the glow never fires alone). zIndex sits BELOW the Call and all
// modals; suppressed entirely while a trade offer is on screen.
//
// Depends on: alex-stream.js (HIGH_SIGNAL_BADGES export), theme (wrAlpha)
// Exposes:    window.DraftCC.AlexEdgeGlow
// ══════════════════════════════════════════════════════════════════

(function () {
    const GOLD = 'var(--gold)';
    const HIGH_SIGNAL = window.DraftCC.HIGH_SIGNAL_BADGES || new Set(['🔥', '⛰', '⬇']);
    const BLOOM_MS = 1500;

    function ensureCss() {
        if (typeof document === 'undefined' || document.getElementById('wr-alex-glow-css')) return;
        const el = document.createElement('style');
        el.id = 'wr-alex-glow-css';
        el.textContent = [
            '.wr-alex-glow{position:fixed;inset:0;pointer-events:none;}',
            '.wr-alex-glow-bloom{animation:wrAlexBloom 1.5s ease-out forwards;}',
            '.wr-alex-glow-breathe{animation:wrAlexBreathe 3.6s ease-in-out infinite;}',
            '@keyframes wrAlexBloom{0%{opacity:0;}18%{opacity:1;}100%{opacity:0;}}',
            '@keyframes wrAlexBreathe{0%,100%{opacity:0.30;}50%{opacity:0.70;}}',
            '@media (prefers-reduced-motion:reduce){',
            '.wr-alex-glow-bloom{animation:wrAlexGlowFade 0.3s ease forwards;}',
            '.wr-alex-glow-breathe{animation:none;opacity:0.4;}',
            '@keyframes wrAlexGlowFade{0%{opacity:0;}30%{opacity:0.85;}100%{opacity:0;}}}',
        ].join('');
        document.head.appendChild(el);
    }

    function AlexEdgeGlow({ state, isUserTurn }) {
        const [flash, setFlash] = React.useState(null);
        const lastIdRef = React.useRef(null);
        const mountedRef = React.useRef(false);
        const keyRef = React.useRef(0);
        const timerRef = React.useRef(null);

        React.useEffect(() => { ensureCss(); }, []);
        React.useEffect(() => () => clearTimeout(timerRef.current), []);

        // Bloom on a new HIGH_SIGNAL stream item (same gate as the Alex Call).
        const stream = state.alex && state.alex.stream;
        const activeOffer = state.activeOffer;
        React.useEffect(() => {
            const top = (stream && stream[0]) || null;
            if (!mountedRef.current) { mountedRef.current = true; lastIdRef.current = top ? top.id : null; return; }
            if (!top || top.id === lastIdRef.current) return;
            lastIdRef.current = top.id;
            if (activeOffer) return;
            if (HIGH_SIGNAL.has(top.badge)) {
                keyRef.current += 1;
                setFlash({ color: top.color || GOLD, key: 'gl_' + keyRef.current });
                clearTimeout(timerRef.current);
                timerRef.current = setTimeout(() => setFlash(null), BLOOM_MS);
            }
        }, [stream, activeOffer]);

        if (activeOffer || state.phase !== 'drafting') return null;

        return (
            <React.Fragment>
                {isUserTurn && (
                    <div className="wr-alex-glow wr-alex-glow-breathe" style={{
                        zIndex: 549,
                        boxShadow: 'inset 0 0 90px 6px ' + wrAlpha(GOLD, '33') + ', inset 0 0 0 2px ' + wrAlpha(GOLD, '3a'),
                    }} />
                )}
                {flash && (
                    <div key={flash.key} className="wr-alex-glow wr-alex-glow-bloom" style={{
                        zIndex: 550,
                        boxShadow: 'inset 0 0 130px 10px ' + wrAlpha(flash.color, '4d') + ', inset 0 0 0 2px ' + wrAlpha(flash.color, '80'),
                    }} />
                )}
            </React.Fragment>
        );
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.AlexEdgeGlow = AlexEdgeGlow;
})();
