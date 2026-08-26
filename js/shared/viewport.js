// ══════════════════════════════════════════════════════════════════
// js/shared/viewport.js — WR.useViewport() / WR.viewport()
// Single shared viewport seam for the phone tier (plan D1/D5).
//
// One debounced (~100ms) window resize listener + visualViewport
// resize/scroll listeners feed a subscription store. Every consumer
// re-renders from the same snapshot, so JS and CSS agree on the
// canonical breakpoints (767 / 1023).
//
//   WR.useViewport() → { width, height, isPhone, isTablet, isDesktop,
//                        isCoarse, kbOpen, kbHeight }   (React hook)
//   WR.viewport()    → same shape, non-hook snapshot for vanilla code
//   WR.viewportSubscribe(fn) → unsubscribe   (vanilla listeners; fn
//                        receives the fresh snapshot on every change)
//
// Tiers: isPhone <768 · isTablet 768–1023 · isDesktop ≥1024.
// Keyboard: kbOpen = (window.innerHeight − visualViewport.height) > 120
// heuristic (iOS on-screen keyboard shrinks the visual viewport but not
// the layout viewport); kbHeight = that gap, 0 when closed.
//
// Plain JS (no JSX — loads as a normal script before the babel chain).
// Depends on React only at hook CALL time, so load order vs the React
// vendor tag is not load-bearing; window always exists in this app.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    var DEBOUNCE_MS = 100;
    var KB_MIN_GAP = 120; // px — smaller gaps are browser chrome, not a keyboard

    var coarseMq = typeof root.matchMedia === 'function' ? root.matchMedia('(pointer: coarse)') : null;

    // Tier media queries — the same 767/1023 breakpoints the stylesheet uses.
    // Deriving isPhone/isTablet from matchMedia (not a raw innerWidth compare)
    // makes JS structurally unable to disagree with CSS: a stale or zero
    // innerWidth at script-parse time can no longer route a 1366pt iPad to
    // the phone build while the stylesheet paints desktop (the half-screen
    // WKWebView bug, owner report 2026-07-26).
    var phoneMq = typeof root.matchMedia === 'function' ? root.matchMedia('(max-width: 767px)') : null;
    var tabletMq = typeof root.matchMedia === 'function' ? root.matchMedia('(min-width: 768px) and (max-width: 1023px)') : null;

    function readKeyboard() {
        var vv = root.visualViewport;
        if (!vv) return { kbOpen: false, kbHeight: 0 };
        // Pinch-zoom shrinks vv.height by the zoom factor with no keyboard
        // present — bail outright while zoomed so kbOpen can't false-positive
        // (which would unmount the phone dock and mis-lift every sheet).
        if ((vv.scale || 1) > 1.05) return { kbOpen: false, kbHeight: 0 };
        // vv.offsetTop: iOS pans the visual viewport to reveal the caret, but
        // fixed elements anchor to the LAYOUT viewport — the lift must include
        // the pan or sheets land offsetTop px away from the keyboard.
        var gap = Math.max(0, root.innerHeight - vv.height - (vv.offsetTop || 0));
        var open = gap > KB_MIN_GAP;
        return { kbOpen: open, kbHeight: open ? Math.round(gap) : 0 };
    }

    function readLayoutWidth() {
        // WKWebView can hand back 0/undefined innerWidth before first layout.
        // Fall back through progressively more stable sources and refuse to
        // classify absurd widths — a wrong read here used to stick for the
        // whole session (nothing re-read it unless the frame later changed).
        var w = root.innerWidth;
        if (!w || w < 320) w = (root.document && root.document.documentElement && root.document.documentElement.clientWidth) || 0;
        if (!w || w < 320) w = (root.screen && root.screen.width) || 0;
        return (!w || w < 320) ? 1024 : w;
    }

    function buildSnapshot() {
        var w = readLayoutWidth();
        var kb = readKeyboard();
        return {
            width: w,
            height: root.innerHeight,
            isPhone: phoneMq ? phoneMq.matches : w < 768,
            isTablet: tabletMq ? tabletMq.matches : (w >= 768 && w < 1024),
            isDesktop: (phoneMq && tabletMq) ? !(phoneMq.matches || tabletMq.matches) : w >= 1024,
            isCoarse: !!(coarseMq && coarseMq.matches),
            kbOpen: kb.kbOpen,
            kbHeight: kb.kbHeight,
        };
    }

    // Snapshot identity is stable between changes — required by
    // useSyncExternalStore (getSnapshot must return the same reference
    // until the store actually changes) and cheap for vanilla polling.
    var snapshot = buildSnapshot();
    var listeners = [];

    function sameSnapshot(a, b) {
        return a.width === b.width && a.height === b.height &&
            a.isPhone === b.isPhone && a.isTablet === b.isTablet &&
            a.isCoarse === b.isCoarse &&
            a.kbOpen === b.kbOpen && a.kbHeight === b.kbHeight;
    }

    function refresh() {
        var next = buildSnapshot();
        if (sameSnapshot(snapshot, next)) return;
        snapshot = next;
        // Iterate a copy: a listener may unsubscribe (or subscribe) mid-notify.
        listeners.slice().forEach(function (fn) {
            try { fn(snapshot); }
            catch (e) { if (root.wrLog) root.wrLog('viewport.notify', e); }
        });
    }

    var timer = null;
    function scheduleRefresh() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { timer = null; refresh(); }, DEBOUNCE_MS);
    }

    root.addEventListener('resize', scheduleRefresh);
    root.addEventListener('orientationchange', scheduleRefresh);
    if (root.visualViewport) {
        // Keyboard open/close & pinch-zoom land here, not on window.resize.
        root.visualViewport.addEventListener('resize', scheduleRefresh);
        root.visualViewport.addEventListener('scroll', scheduleRefresh);
    }
    if (coarseMq) {
        // Pointer coarseness can flip (e.g. iPad + trackpad). Older Safari
        // exposes addListener only.
        if (typeof coarseMq.addEventListener === 'function') coarseMq.addEventListener('change', scheduleRefresh);
        else if (typeof coarseMq.addListener === 'function') coarseMq.addListener(scheduleRefresh);
    }
    [phoneMq, tabletMq].forEach(function (mq) {
        if (!mq) return;
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', scheduleRefresh);
        else if (typeof mq.addListener === 'function') mq.addListener(scheduleRefresh);
    });

    // Post-layout self-heal: the boot snapshot is computed at script-parse
    // time, before first layout. Re-read once the document actually has
    // geometry, after full load, on every bfcache restore, and one frame
    // after first paint — so a bad boot read can never own the session.
    root.addEventListener('DOMContentLoaded', scheduleRefresh);
    root.addEventListener('load', scheduleRefresh);
    root.addEventListener('pageshow', scheduleRefresh);
    if (typeof root.requestAnimationFrame === 'function') {
        root.requestAnimationFrame(function () { refresh(); });
    }

    // WKWebView cold-boot rescue (owner reports 2026-07-28 and 2026-07-30,
    // iPad shell): a cold launch can leave the page mis-fitted two ways —
    //   (a) painted at ~0.5× visual scale (page correct, zoomed out), or
    //   (b) laid out against a HALF-WIDTH viewport at normal scale (the
    //       shell's frame settled after WebKit resolved the viewport), which
    //       routes an iPad to the phone tier squeezed into the left half.
    // Rotating the device fixed both because rotation re-runs WebKit's
    // viewport resolution against the real frame. Do the same
    // programmatically: TOGGLE the viewport meta's arguments (append
    // maximum-scale for one frame, then restore). Re-resolution only
    // happens when the arguments actually change — re-asserting the same
    // string (the previous fix) is a no-op, which is why variant (b)
    // survived it. Re-resolving against the CURRENT frame is idempotent:
    // on a healthy boot, or in a genuine Split View window, the computed
    // viewport is unchanged and nothing moves.
    var nudges = 0;        // per-wake budget — refilled by wakeSweep()
    var nudgeLogs = 0;     // session-lifetime log cap: a legit Split View
                           // window trips detection on every wake, and its
                           // no-op nudges must not flood the error table.
    function nudgeViewport() {
        var doc = root.document;
        var vv = root.visualViewport;
        if (!doc || doc.hidden || nudges >= 3) return;
        // Never fight a deliberate pinch-zoom-in, and never toggle the meta
        // while the keyboard is up — re-resolution can jump the focused caret.
        if (vv && (vv.scale || 1) > 1.05) return;
        if (readKeyboard().kbOpen) return;
        var zoomedOut = vv && vv.scale > 0 && vv.scale < 0.95;               // variant (a)
        var sw = (root.screen && root.screen.width) || 0;
        var sh = (root.screen && root.screen.height) || 0;
        var w = root.innerWidth || 0;
        var h = root.innerHeight || 0;
        // Window narrower than BOTH screen edges: either the half-width boot
        // bug or a real Split View window — the nudge is correct for the
        // first and a no-op for the second.                                  // variant (b)
        var suspectWidth = sw > 0 && sh > 0 && w > 0 &&
            (w + 40 < Math.max(sw, sh)) && (w + 40 < Math.min(sw, sh));
        // Half-HEIGHT twin of (b) (owner report 2026-08-26: half screen on
        // wake, rotation fixes it). Height needs a far bigger margin than
        // width because browser toolbars legitimately eat ~70–150px of
        // innerHeight; 220px clears any real chrome while still catching a
        // halved layout on every iPad (smallest edge: mini, 744pt → a halved
        // layout is 372px short).                                            // variant (c)
        var suspectHeight = sw > 0 && sh > 0 && h > 0 &&
            (h + 220 < Math.max(sw, sh)) && (h + 220 < Math.min(sw, sh));
        if (!zoomedOut && !suspectWidth && !suspectHeight) return;
        var meta = doc.querySelector && doc.querySelector('meta[name="viewport"]');
        if (!meta) return;
        nudges++;
        var content = meta.getAttribute('content') || 'width=device-width, initial-scale=1.0, minimum-scale=1.0';
        meta.setAttribute('content', content + ', maximum-scale=1.0');
        var restore = function () { meta.setAttribute('content', content); scheduleRefresh(); };
        if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(restore);
        else setTimeout(restore, 50);
        if (root.wrLog && nudgeLogs < 6) {
            nudgeLogs++;
            root.wrLog('viewport.nudge', { zoomedOut: zoomedOut, width: w, height: h, screen: sw + 'x' + sh });
        }
    }
    root.addEventListener('load', nudgeViewport);
    root.addEventListener('pageshow', nudgeViewport);
    // The broken state can settle after load (frame/scene animation) —
    // sweep a few times early in the session.
    [500, 1500, 3000, 6000].forEach(function (ms) { setTimeout(nudgeViewport, ms); });
    // …and sweep again on EVERY return to the foreground. iPads keep this
    // page alive for days; WebKit re-resolves the viewport on wake and a
    // wrong wake-time resolution used to stick until the user rotated
    // (owner report 2026-08-26 — the load-time sweeps above had stood down
    // long before). Each wake refills the nudge budget; late timers from a
    // wake that got backgrounded again bail on doc.hidden inside the nudge.
    function wakeSweep() {
        if (root.document && root.document.hidden) return;
        nudges = 0;
        scheduleRefresh();
        nudgeViewport();
        [300, 1000, 3000].forEach(function (ms) { setTimeout(nudgeViewport, ms); });
    }
    if (root.document) root.document.addEventListener('visibilitychange', wakeSweep);
    root.addEventListener('focus', wakeSweep);

    function subscribe(fn) {
        listeners.push(fn);
        return function unsubscribe() {
            var i = listeners.indexOf(fn);
            if (i !== -1) listeners.splice(i, 1);
        };
    }

    function getSnapshot() { return snapshot; }

    // React hook. React 18 ships useSyncExternalStore; the useState branch
    // is a same-behavior fallback for any stray page on an older vendor
    // copy (branch is fixed per React build, so hook order stays stable).
    function useViewport() {
        var R = root.React;
        if (R.useSyncExternalStore) return R.useSyncExternalStore(subscribe, getSnapshot);
        var pair = R.useState(getSnapshot);
        R.useEffect(function () {
            // Re-sync in case the viewport changed between render and mount.
            pair[1](getSnapshot());
            return subscribe(pair[1]);
        }, []);
        return pair[0];
    }

    var WR = root.WR = root.WR || {};
    WR.useViewport = useViewport;
    WR.viewport = getSnapshot;
    WR.viewportSubscribe = subscribe;
})(window);
