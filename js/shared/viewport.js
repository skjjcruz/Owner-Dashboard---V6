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

    function buildSnapshot() {
        var w = root.innerWidth;
        var kb = readKeyboard();
        return {
            width: w,
            height: root.innerHeight,
            isPhone: w < 768,
            isTablet: w >= 768 && w < 1024,
            isDesktop: w >= 1024,
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
