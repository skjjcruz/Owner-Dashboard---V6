// ══════════════════════════════════════════════════════════════════
// External-link escape hatch — every surface, no detection (owner
// directive 2026-08-14 after two failed shell-detection attempts).
//
// History: the App Store shell is a bare WKWebView (no tabs, no back
// button, no UIDelegate) whose customUserAgent mimics iPhone Safari. A
// target="_blank" rel="noopener" anchor navigates that one webview to
// the external site with no way back. Guard v1 keyed off the UA (fooled
// by the spoof), v2 keyed off window.ApplePaySession (Apple Pay exists
// in WKWebView since iOS 13, so that can be fooled too). Detection is a
// losing game — v3 removes it entirely:
//
//   RULE: clicking an external link NEVER navigates this page. Every
//   surface gets the same in-app overlay with a "Back to Dynasty HQ"
//   bar. There is no code path that leaves the app, so there is
//   nothing to detect and nothing to fool.
//
//   • Frameable hosts (verified 2026-08-14: fantasypros.com and
//     sleeper.com send no X-Frame-Options) render inside the overlay.
//   • Frame-refusing hosts (pro-football-reference, sports-reference,
//     youtube — all send X-Frame-Options: SAMEORIGIN) get a panel with
//     "Open in browser tab" (window.open: real tab in browsers, silent
//     no-op in the shell, which has no UIDelegate to service it) and
//     "Copy link" fallbacks.
//   • A future shell that services _blank natively should append
//     "DHQShell/<ver>" to its user agent; the guard steps aside there.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    if (/DHQShell\//.test(navigator.userAgent || '')) return; // v1.4+ shell opens Safari natively

    // Hosts verified to allow rendering inside another page. Everything
    // else gets the button panel — the safe default for future links.
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

    function openButtonPanel(url, host) {
        var ov = buildOverlay(host);
        var panel = document.createElement('div');
        panel.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;';
        var title = document.createElement('div');
        title.textContent = host + " won't display inside Dynasty HQ";
        title.style.cssText = 'font-weight:800;font-size:1.05rem;color:var(--text-primary,#e6edf3);';
        var sub = document.createElement('div');
        sub.textContent = 'That site blocks embedded viewing. Open it in a separate browser tab, or copy the link to use anywhere.';
        sub.style.cssText = 'max-width:34rem;font-size:0.9rem;line-height:1.5;color:var(--silver,#9aa4af);';
        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.textContent = 'Open in browser tab';
        openBtn.style.cssText = 'padding:12px 18px;font-weight:800;font-size:0.95rem;color:#0d1117;background:var(--gold,#d4af37);border:0;border-radius:8px;cursor:pointer;min-width:15rem;';
        openBtn.addEventListener('click', function () {
            // Browsers: real new tab (user-gesture click, so not popup-blocked).
            // The v1.3 shell has no UIDelegate, so window.open is a silent
            // no-op there — the user keeps the Back bar either way.
            var w = null;
            try { w = window.open(url, '_blank'); } catch (e) { /* fall through */ }
            if (!w) {
                openBtn.textContent = "Couldn't open a tab here — use Copy link";
                openBtn.style.background = 'var(--bg-secondary,#161b22)';
                openBtn.style.color = 'var(--silver,#9aa4af)';
                openBtn.style.border = '1px solid var(--border,rgba(255,255,255,0.2))';
            }
        });
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy link';
        copy.style.cssText = 'padding:12px 18px;font-weight:800;font-size:0.95rem;color:var(--gold,#d4af37);background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.35);border-radius:8px;cursor:pointer;min-width:15rem;';
        copy.addEventListener('click', function () {
            var done = function () { copy.textContent = 'Copied ✓'; };
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
                else done();
            } catch (e) { done(); }
        });
        panel.appendChild(title);
        panel.appendChild(sub);
        panel.appendChild(openBtn);
        panel.appendChild(copy);
        ov.appendChild(panel);
    }

    function onDocumentClick(ev) {
        try {
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
            else openButtonPanel(href, bareHost);
        } catch (e) { /* guard must never break normal clicks */ }
    }

    document.addEventListener('click', onDocumentClick, true);
})();
