// ══════════════════════════════════════════════════════════════════
// js/shared/update-sentinel.js — quiet self-updater (owner ruling
// 2026-08-27: users must receive shipped builds without force-quitting
// the app; no button, no banner).
//
// A long-lived page (WKWebView shell that is never force-quit, or a
// website tab left open for days) keeps running the build it booted
// with. This sentinel re-checks the server's build tag when the app
// returns to the foreground after a real absence — the one moment a
// reload reads as a normal app resume — and reloads onto the new build.
//
// Guard rails (all must pass before a reload):
//   • away ≥ 15 min (a quick app-switch never triggers it)
//   • no draft board mounted ([data-draft-pid] probe)
//   • no focused input/textarea/contenteditable
//   • no touch/keypress in the last 30s
//   • at most one check per hour, one reload per target tag per
//     session (sessionStorage; a stubborn cache can't loop us)
//   • offline → skip silently, try again next wake
// A slow 6-hour interval covers always-visible desktop tabs that never
// background; it additionally requires 5 minutes of idle.
//
// Plain JS (no JSX) — loads as a normal script before the babel chain.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    var doc = root.document;
    if (!doc) return;

    var LAST_CHECK_KEY = 'wr_update_last_check';
    var DONE_FOR_KEY = 'wr_update_done_for';

    function tuning() {
        var t = root.WR_UPDATE_TUNING || {};
        return {
            minAwayMs: t.minAwayMs != null ? t.minAwayMs : 15 * 60 * 1000,
            minTouchGapMs: t.minTouchGapMs != null ? t.minTouchGapMs : 30 * 1000,
            // 10 min, not an hour: the hour-long cool-down meant a wake inside
            // the window skipped the probe entirely and a fresh deploy could sit
            // unnoticed for most of an hour past its first wake (owner test
            // 2026-08-27 "didn't work"). One ~230KB probe per 10-min-spaced
            // wake is cheap; the reload rules are unchanged.
            minCheckGapMs: t.minCheckGapMs != null ? t.minCheckGapMs : 10 * 60 * 1000,
            intervalMs: t.intervalMs != null ? t.intervalMs : 6 * 60 * 60 * 1000,
            intervalIdleMs: t.intervalIdleMs != null ? t.intervalIdleMs : 5 * 60 * 1000,
        };
    }

    var lastTouch = Date.now();
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
        doc.addEventListener(ev, function () { lastTouch = Date.now(); }, { passive: true, capture: true });
    });

    function ownTag() {
        var el = doc.getElementById('dhq-build-tag');
        var t = el && el.textContent ? el.textContent.trim() : '';
        return /^b\d+$/.test(t) ? t : null;
    }

    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* full storage: degrade to no-loop-guard-persistence */ } }

    function typingNow() {
        var a = doc.activeElement;
        if (!a) return false;
        var tag = (a.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable === true;
    }

    var checking = false;
    function maybeCheck(idleRequiredMs) {
        var cfg = tuning();
        if (checking || doc.hidden) return;
        if (root.navigator && root.navigator.onLine === false) return;
        var mine = ownTag();
        if (!mine) return;
        // A mounted draft board means a draft could be live — never mid-draft.
        if (doc.querySelector('[data-draft-pid]')) return;
        if (typingNow()) return;
        var sinceTouch = Date.now() - lastTouch;
        if (sinceTouch < cfg.minTouchGapMs) return;
        if (idleRequiredMs && sinceTouch < idleRequiredMs) return;
        var lastCheck = parseInt(ssGet(LAST_CHECK_KEY) || '0', 10) || 0;
        if (Date.now() - lastCheck < cfg.minCheckGapMs) return;
        ssSet(LAST_CHECK_KEY, String(Date.now()));
        checking = true;
        fetch(location.pathname + (location.search ? location.search + '&' : '?') + 'wruc=' + Date.now(), { cache: 'no-store' })
            .then(function (res) { return res.ok ? res.text() : ''; })
            .then(function (html) {
                checking = false;
                var m = /dhq-build-tag[^>]*>\s*(b\d+)\s*</.exec(html || '');
                var server = m ? m[1] : null;
                if (!server || server === mine) return;
                if (ssGet(DONE_FOR_KEY) === server) return; // already tried this one
                // Re-verify the cheap guards right before pulling the trigger —
                // the fetch takes real time and the user may have started typing.
                if (doc.hidden || typingNow() || doc.querySelector('[data-draft-pid]')) return;
                if (Date.now() - lastTouch < tuning().minTouchGapMs) return;
                ssSet(DONE_FOR_KEY, server);
                // Cache-busting query so WKWebView can't re-serve the old HTML
                // (max-age=600); prior wru/wruc params are stripped, deep-link
                // params are preserved.
                var q = (location.search || '').replace(/[?&]wruc?=[^&]*/g, '').replace(/^&/, '?');
                location.replace(location.pathname + (q ? q + '&' : '?') + 'wru=' + encodeURIComponent(server));
            })
            .catch(function () { checking = false; /* offline or blocked — next wake retries */ });
    }

    var hiddenAt = null;
    doc.addEventListener('visibilitychange', function () {
        if (doc.hidden) { hiddenAt = Date.now(); return; }
        var away = hiddenAt ? Date.now() - hiddenAt : 0;
        hiddenAt = null;
        if (away >= tuning().minAwayMs) maybeCheck(0);
    });

    // Always-visible desktop tabs never fire the wake path — sweep slowly,
    // and only when the user has been idle for a while.
    setInterval(function () { maybeCheck(tuning().intervalIdleMs); }, Math.max(60 * 1000, tuning().intervalMs));
})(window);
