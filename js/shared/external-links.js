// ══════════════════════════════════════════════════════════════════
// External-link guard for the native iOS shell (owner report 2026-08-14).
//
// The App Store shell is a bare WKWebView: no tabs, no back button, no
// swipe-back, and no UIDelegate — so a target="_blank" (rel=noopener)
// anchor navigates the ONE webview to the external site and the user is
// stranded there until they force-quit the app. This module makes leaving
// the app impossible from a link:
//
//   • Global capture-phase click listener — catches every current AND
//     future external anchor, on every tab, no per-button wiring.
//   • Frameable hosts (checked 2026-08-14: fantasypros.com, sleeper.com
//     send no X-Frame-Options) open in a full-screen in-app overlay with
//     a "Back to Dynasty HQ" bar.
//   • Frame-refusing hosts (pro-football-reference / sports-reference /
//     youtube all send X-Frame-Options: SAMEORIGIN) get an in-app panel
//     with a copy-the-link option instead — never a dead webview.
//   • Browser surfaces are untouched: target=_blank already opens a real
//     new tab there. Guard activates only when detectSurface() says
//     'ios_app'.
//   • Future shells that implement a proper UIDelegate should append
//     "DHQShell/<ver>" to the custom user agent; the guard steps aside so
//     _blank links open Safari natively.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    function isNativeShell() {
        try {
            if (/DHQShell\//.test(navigator.userAgent)) return false; // v1.4+ shell opens Safari itself
            var surface = window.OD && typeof window.OD.detectSurface === 'function' ? window.OD.detectSurface() : null;
            if (surface) return surface === 'ios_app';
            // Fallback mirror of detectSurface: Apple WebKit with no Safari token = bare WKWebView.
            var ua = navigator.userAgent || '';
            return /iPhone|iPad|iPod|Macintosh/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua);
        } catch (e) { return false; }
    }

    // Hosts verified to allow being shown inside another page (no
    // X-Frame-Options / frame-ancestors). Everything NOT listed gets the
    // copy-link panel — safe default for unknown future links.
    var FRAMEABLE_HOSTS = /(^|\.)fantasypros\.com$|(^|\.)sleeper\.com$/i;

    var overlay = null;

    function closeOverlay() {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
    }

    function buildOverlay(headerText) {
        closeOverlay();
        overlay = document.createElement('div');
        overlay.id = 'dhq-external-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;background:var(--bg-primary,#0d1117);';
        var bar = document.createElement('div');
        bar.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;background:var(--bg-secondary,#161b22);border-bottom:1px solid var(--border,rgba(255,255,255,0.12));';
        var back = document.createElement('button');
        back.type = 'button';
        back.textContent = '‹ Back to Dynasty HQ';
        back.style.cssText = 'flex:0 0 auto;padding:10px 14px;font-weight:800;font-size:0.9rem;color:var(--gold,#d4af37);background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.35);border-radius:8px;cursor:pointer;';
        back.addEventListener('click', closeOverlay);
        var label = document.createElement('div');
        label.textContent = headerText;
        label.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;color:var(--silver,#9aa4af);';
        bar.appendChild(back);
        bar.appendChild(label);
        overlay.appendChild(bar);
        document.body.appendChild(overlay);
        return overlay;
    }

    function openFramed(url, host) {
        var ov = buildOverlay(host);
        var frame = document.createElement('iframe');
        frame.src = url;
        frame.style.cssText = 'flex:1 1 auto;width:100%;border:0;background:#fff;';
        frame.setAttribute('referrerpolicy', 'no-referrer');
        ov.appendChild(frame);
    }

    function openCopyPanel(url, host) {
        var ov = buildOverlay(host);
        var panel = document.createElement('div');
        panel.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;';
        var title = document.createElement('div');
        title.textContent = host + " won't display inside the app";
        title.style.cssText = 'font-weight:800;font-size:1.05rem;color:var(--text-primary,#e6edf3);';
        var sub = document.createElement('div');
        sub.textContent = 'That site blocks in-app viewing. Copy the link below and paste it into Safari to see it there.';
        sub.style.cssText = 'max-width:34rem;font-size:0.9rem;line-height:1.5;color:var(--silver,#9aa4af);';
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy link for Safari';
        copy.style.cssText = 'padding:12px 18px;font-weight:800;font-size:0.95rem;color:#0d1117;background:var(--gold,#d4af37);border:0;border-radius:8px;cursor:pointer;';
        copy.addEventListener('click', function () {
            var done = function () { copy.textContent = 'Copied ✓'; };
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
                else done();
            } catch (e) { done(); }
        });
        panel.appendChild(title);
        panel.appendChild(sub);
        panel.appendChild(copy);
        ov.appendChild(panel);
    }

    function onDocumentClick(ev) {
        try {
            if (!isNativeShell()) return;
            var node = ev.target;
            while (node && node !== document && !(node.tagName === 'A' && node.href)) node = node.parentNode;
            if (!node || node === document) return;
            var href = node.href || '';
            if (!/^https?:/i.test(href)) return; // mailto:/tel: keep native handling
            var host;
            try { host = new URL(href).hostname; } catch (e) { return; }
            if (host === location.hostname) return; // in-app navigation stays normal
            ev.preventDefault();
            ev.stopPropagation();
            var bareHost = host.replace(/^www\./i, '');
            if (FRAMEABLE_HOSTS.test(host)) openFramed(href, bareHost);
            else openCopyPanel(href, bareHost);
        } catch (e) { /* guard must never break normal clicks */ }
    }

    document.addEventListener('click', onDocumentClick, true);
})();
