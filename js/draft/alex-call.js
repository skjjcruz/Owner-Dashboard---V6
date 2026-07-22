// ══════════════════════════════════════════════════════════════════
// js/draft/alex-call.js — "The Alex Call" cinematic lower-third (presence L2)
//
// A transient, ESPN-style lower-third that breaks in on high-signal draft
// moments (🔥 room run / ⛰ tier break / ⬇ value cliff) and on the user's
// on-the-clock rising edge, delivers Alex's call with a draining timer,
// then retracts. The permanent transcript still lives in AlexStreamPanel —
// this is purely the "breaking news" theater layer. It is NOT a standing
// window: it appears for a few seconds on a genuine moment, then is gone.
//
// Self-contained: derives its triggers from state.alex.stream (sharing the
// window.DraftCC.HIGH_SIGNAL_BADGES gate with the header whisper), so it
// needs no edits to the pick-effect dispatch path. Suppresses while a trade
// offer (state.activeOffer) or the Ask Alex window is open.
//
// Depends on: styles.js, alex-stream.js (HIGH_SIGNAL_BADGES export), theme (wrAlpha)
// Exposes:    window.DraftCC.AlexCall
// ══════════════════════════════════════════════════════════════════

(function () {
    const { FONT_UI, FONT_DISPL, panelCard } = window.DraftCC.styles;

    const ALEX = 'var(--k-9b8afb, #9b8afb)';
    const HIGH_SIGNAL = window.DraftCC.HIGH_SIGNAL_BADGES || new Set(['🔥', '⛰', '⬇']);
    const DECISION = new Set(['✦', '⚖', '◇', 'A', '↑', '↓']);
    const DWELL_SIGNAL = 7000;
    const DWELL_CLOCK = 4500;

    // One-time CSS injection: entrance/drain keyframes, responsive position,
    // reduced-motion fallback. Keeps the whole feature in this one file.
    function ensureCss() {
        if (typeof document === 'undefined' || document.getElementById('wr-alex-call-css')) return;
        const el = document.createElement('style');
        el.id = 'wr-alex-call-css';
        el.textContent = [
            '.wr-alex-call{position:fixed;bottom:14px;left:12px;right:392px;z-index:590;',
            'animation:wrAlexCallIn .42s cubic-bezier(.16,1,.3,1) both;}',
            '@media (max-width:1023px){.wr-alex-call{right:12px;}}',
            // Phone: clear the bottom dock (var resolves 0px on tablet/desktop).
            '@media (max-width:767px){.wr-alex-call{bottom:calc(14px + var(--wr-bottom-inset, 0px));}}',
            '@keyframes wrAlexCallIn{from{transform:translateY(118%);opacity:0;}to{transform:translateY(0);opacity:1;}}',
            '@keyframes wrAlexCallDrain{from{width:100%;}to{width:0%;}}',
            '@media (prefers-reduced-motion:reduce){',
            '.wr-alex-call{animation:wrAlexCallFade .2s ease both;}',
            '.wr-alex-call .wr-ac-drain{animation:none!important;}',
            '@keyframes wrAlexCallFade{from{opacity:0;}to{opacity:1;}}}',
        ].join('');
        document.head.appendChild(el);
    }

    // A single call card. Keyed by call.key in the parent, so every new call
    // gets a fresh instance — dwell timer, hover state and animations all reset
    // cleanly without manual bookkeeping.
    function CallCard({ call, onDone }) {
        const [hovered, setHovered] = React.useState(false);
        const remainingRef = React.useRef(call.dwell || DWELL_SIGNAL);
        const startedRef = React.useRef(0);
        const timerRef = React.useRef(null);

        // Dwell timer — pauses while hovered (so you can read it), banking the
        // remaining time; resumes on mouse-out.
        React.useEffect(() => {
            if (hovered) {
                clearTimeout(timerRef.current);
                if (startedRef.current) {
                    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedRef.current));
                }
                return;
            }
            startedRef.current = Date.now();
            timerRef.current = setTimeout(onDone, remainingRef.current);
            return () => clearTimeout(timerRef.current);
        }, [hovered]);

        const expand = () => {
            try {
                window.dispatchEvent(new CustomEvent('wr:ask-open', {
                    detail: { title: call.title, prompt: 'Tell me more: ' + call.title },
                }));
            } catch (_) {}
            onDone();
        };

        const displayTitle = (call.title || '').replace(/^Alex\s*[·:—-]?\s*/i, '') || call.title;

        const cardCss = panelCard({
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '11px 14px',
            cursor: 'pointer',
            overflow: 'hidden',
            borderTop: '2px solid ' + wrAlpha(call.color, 'cc'),
            background: 'linear-gradient(180deg, ' + wrAlpha(call.color, '1f') + ', var(--surf-solid, rgba(10,12,17,0.97)) 62%)',
            boxShadow: '0 -10px 34px rgba(0,0,0,0.5)',
        });

        return (
            <div className="wr-alex-call" style={cardCss} role="status"
                 onMouseEnter={() => setHovered(true)}
                 onMouseLeave={() => setHovered(false)}
                 onClick={expand}>
                {/* Badge medallion */}
                <div style={{
                    flexShrink: 0, width: 34, height: 34, borderRadius: 9, marginTop: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.15rem',
                    background: wrAlpha(call.color, '22'), border: '1px solid ' + wrAlpha(call.color, '66'),
                    color: call.color,
                }}>{call.badge}</div>

                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontFamily: FONT_DISPL, fontWeight: 800, letterSpacing: '0.14em', fontSize: '0.62rem', textTransform: 'uppercase', color: ALEX }}>
                            Alex on the call
                        </span>
                        <span style={{ flex: 1, height: 1, background: wrAlpha(call.color, '33') }} />
                    </div>
                    <div style={{ fontFamily: FONT_DISPL, fontWeight: 800, fontSize: '1.02rem', color: 'var(--white)', lineHeight: 1.12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {displayTitle}
                    </div>
                    {call.text && (
                        <div style={{ fontFamily: FONT_UI, fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.92, marginTop: 3, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {call.text}
                        </div>
                    )}
                </div>

                {/* Dismiss */}
                <button onClick={(e) => { e.stopPropagation(); onDone(); }} aria-label="Dismiss"
                    style={{ flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--silver)', opacity: 0.55, cursor: 'pointer', fontSize: '1.05rem', lineHeight: 1, padding: '2px 4px', fontFamily: FONT_UI }}>×</button>

                {/* Drain bar */}
                <div className="wr-ac-drain" style={{
                    position: 'absolute', left: 0, bottom: 0, height: 3, background: call.color,
                    animation: 'wrAlexCallDrain ' + (call.dwell || DWELL_SIGNAL) + 'ms linear forwards',
                    animationPlayState: hovered ? 'paused' : 'running',
                }} />
            </div>
        );
    }

    function AlexCall({ state, isUserTurn }) {
        const [queue, setQueue] = React.useState([]);
        const [askOpen, setAskOpen] = React.useState(false);
        const askOpenRef = React.useRef(false);
        const lastIdRef = React.useRef(null);
        const mountedRef = React.useRef(false);
        const prevTurnRef = React.useRef(false);
        const keyRef = React.useRef(0);

        React.useEffect(() => { ensureCss(); }, []);

        const enqueue = React.useCallback((call) => {
            if (state.activeOffer || askOpenRef.current) return;
            keyRef.current += 1;
            const item = Object.assign({ key: 'ac_' + keyRef.current }, call);
            // Show the current call (q[0]) and queue at most the newest pending —
            // bursts collapse to the latest rather than stacking up.
            setQueue(q => (q.length === 0 ? [item] : [q[0], item]));
        }, [state.activeOffer]);

        // Suppress + clear while the Ask Alex window is open.
        React.useEffect(() => {
            const onOpen = () => { askOpenRef.current = true; setAskOpen(true); setQueue([]); };
            const onClosed = () => { askOpenRef.current = false; setAskOpen(false); };
            window.addEventListener('wr:ask-open', onOpen);
            window.addEventListener('wr:ask-show', onOpen);
            window.addEventListener('wr:ask-closed', onClosed);
            return () => {
                window.removeEventListener('wr:ask-open', onOpen);
                window.removeEventListener('wr:ask-show', onOpen);
                window.removeEventListener('wr:ask-closed', onClosed);
            };
        }, []);

        // Clear when a trade offer takes over the screen.
        React.useEffect(() => { if (state.activeOffer) setQueue([]); }, [state.activeOffer]);

        // Trigger 1 — a new HIGH_SIGNAL stream item breaks in.
        const stream = state.alex && state.alex.stream;
        React.useEffect(() => {
            const top = (stream && stream[0]) || null;
            // Baseline at mount: ignore whatever is already in the stream so we
            // only fire for events that land *after* the room opens.
            if (!mountedRef.current) { mountedRef.current = true; lastIdRef.current = top ? top.id : null; return; }
            if (!top || top.id === lastIdRef.current) return;
            lastIdRef.current = top.id;
            if (HIGH_SIGNAL.has(top.badge)) {
                enqueue({ badge: top.badge, color: top.color || ALEX, title: top.title, text: top.text, dwell: DWELL_SIGNAL });
            }
        }, [stream, enqueue]);

        // Trigger 2 — the user goes on the clock (rising edge).
        React.useEffect(() => {
            const was = prevTurnRef.current;
            prevTurnRef.current = isUserTurn;
            if (isUserTurn && !was && state.phase === 'drafting') {
                const dec = ((stream || []).find(e => DECISION.has(e.badge)));
                enqueue({
                    badge: '◆', color: ALEX, title: 'YOU ARE ON THE CLOCK',
                    text: dec ? dec.text : 'Your pick. Lock the value or pivot — I have got your board read.',
                    dwell: DWELL_CLOCK,
                });
            }
        }, [isUserTurn, state.phase, enqueue]);

        const current = queue[0] || null;
        if (!current || state.activeOffer || askOpen || state.phase !== 'drafting') return null;

        return <CallCard key={current.key} call={current} onDone={() => setQueue(q => q.slice(1))} />;
    }

    window.DraftCC = window.DraftCC || {};
    // Alex draft theater is Scout Pro — free never mounts the lower-third
    // (clean absence; the stream panel carries the locked teaser). Wrapper keeps
    // the inner component's hooks unmounted rather than conditionally skipped.
    window.DraftCC.AlexCall = function GatedAlexCall(props) {
        if (typeof window.wrIsPro === 'function' && !window.wrIsPro()) return null;
        return <AlexCall {...props} />;
    };
})();
