// ══════════════════════════════════════════════════════════════════
// js/shared/dhq-dialogs.js — in-app dialog boxes (plain JS, no build step)
//
// Owner report 2026-10-12: Sign out did nothing in the native app. The
// browser's own confirm() / alert() / prompt() only appear inside an iPhone
// app when the app shell supports them; without that, confirm() silently
// answers "no", prompt() answers null and alert() shows nothing. These boxes
// are plain page content, so they behave the same on the website, the Lab
// and the native app.
//
//   dhqConfirm(message, { ok, cancel, danger }) → Promise<boolean>
//   dhqNotice(message, { ok })                  → Promise<void>
//   dhqPrompt(message, { value, ok, placeholder, maxLength })
//                                               → Promise<string|null>
//        ('' when OK is tapped on an empty box, null on Cancel / Escape —
//         the same contract as window.prompt, so "blank to clear" still works)
//   dhqCopyText(title, text)                    → Promise<boolean>
//        (shows the text selected with a Copy button; true once copied)
//
// Differences from the browser boxes that callers must allow for:
//   • They do not freeze the page. Code after the call must await it, and
//     anything that can change while the box is open (a live draft keeps
//     moving) must be captured before the box opens.
//   • role="alertdialog" + aria-modal="true": js/shared/live-update.js
//     treats an open box as a modal and never reloads under it.
//   • Escape / tapping outside = Cancel (never for a notice's only button).
//   • Messages keep their line breaks (white-space: pre-line).
// No DOM (node tests): falls back to the browser functions if they exist.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    if (root.dhqConfirm && root.dhqConfirm.__dhqDialogs) return;
    const doc = root.document;

    function fallback(kind, message, o) {
        try {
            if (kind === 'confirm') return Promise.resolve(typeof root.confirm === 'function' ? !!root.confirm(String(message)) : false);
            if (kind === 'prompt') return Promise.resolve(typeof root.prompt === 'function' ? root.prompt(String(message), o.value == null ? '' : String(o.value)) : null);
            if (kind === 'copy') { if (typeof root.prompt === 'function') root.prompt(String(message), String(o.text || '')); return Promise.resolve(false); }
            if (typeof root.alert === 'function') root.alert(String(message));
        } catch (e) { /* no box available */ }
        return Promise.resolve(kind === 'notice' ? undefined : kind === 'prompt' ? null : false);
    }

    function btn(label, kind, danger) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = 'min-height:44px;min-width:96px;padding:0 16px;border-radius:var(--card-radius-sm, 8px);font:700 14px var(--font-body, system-ui, sans-serif);cursor:pointer;' +
            (kind === 'primary'
                ? (danger ? 'background:#c0392b;color:#fff;border:1px solid #c0392b' : 'background:var(--gold, #D4AF37);color:#111;border:1px solid var(--gold, #D4AF37)')
                : 'background:transparent;color:var(--white, #fff);border:1px solid rgba(128,128,128,0.45)');
        return b;
    }

    // kind: 'confirm' | 'notice' | 'prompt' | 'copy'
    function open(kind, message, o) {
        o = o || {};
        if (!doc || !doc.createElement || !(doc.body || doc.documentElement)) return fallback(kind, message, o);
        return new Promise(resolve => {
            let done = false;
            const before = doc.activeElement;
            const wrap = doc.createElement('div');
            let field = null;
            const finish = val => {
                if (done) return;
                done = true;
                try { doc.removeEventListener('keydown', onKey, true); wrap.remove(); } catch (e) { /* gone */ }
                try { if (before && typeof before.focus === 'function' && doc.contains(before)) before.focus(); } catch (e) { /* focus lost */ }
                resolve(val);
            };
            const cancelValue = kind === 'prompt' ? null : kind === 'notice' ? undefined : false;
            const okValue = () => (kind === 'prompt' ? String(field ? field.value : '') : kind === 'notice' ? undefined : true);
            const onKey = e => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(kind === 'notice' ? undefined : cancelValue); }
                else if (e.key === 'Enter' && kind === 'prompt' && e.target === field) { e.preventDefault(); finish(okValue()); }
            };
            try {
                wrap.setAttribute('role', 'alertdialog');
                wrap.setAttribute('aria-modal', 'true');
                wrap.setAttribute('aria-label', String(message).slice(0, 160));
                wrap.className = 'dhq-dialog';
                wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.6)';
                const box = doc.createElement('div');
                box.style.cssText = 'width:100%;max-width:' + (kind === 'copy' ? 460 : 380) + 'px;max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:20px;background:var(--off-black, #141414);color:var(--white, #fff);border:1px solid var(--acc-line2, rgba(212,175,55,0.3));border-radius:var(--card-radius, 10px);box-shadow:0 12px 40px rgba(0,0,0,0.5);font:500 15px/1.5 var(--font-body, system-ui, sans-serif)';
                const p = doc.createElement('p');
                p.style.cssText = 'margin:0 0 14px;white-space:pre-line;overflow-wrap:anywhere';
                p.textContent = String(message);
                box.appendChild(p);
                if (kind === 'prompt' || kind === 'copy') {
                    field = doc.createElement(kind === 'copy' ? 'textarea' : 'input');
                    if (kind === 'prompt') {
                        field.type = 'text';
                        field.value = o.value == null ? '' : String(o.value);
                        if (o.placeholder) field.placeholder = String(o.placeholder);
                        if (o.maxLength) field.maxLength = o.maxLength;
                        field.setAttribute('aria-label', String(message).slice(0, 160));
                    } else {
                        field.readOnly = true;
                        field.rows = 6;
                        field.value = String(o.text || '');
                        field.setAttribute('aria-label', 'Text to copy');
                    }
                    // 16px so iPhones don't zoom the page when the box gets focus.
                    field.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:0 0 16px;padding:10px 12px;font:500 16px/1.4 var(--font-body, system-ui, sans-serif);color:var(--white, #fff);background:var(--black, #0A0A0A);border:1px solid rgba(128,128,128,0.45);border-radius:var(--card-radius-sm, 8px);resize:vertical';
                    box.appendChild(field);
                } else {
                    p.style.marginBottom = '18px';
                }
                const row = doc.createElement('div');
                row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap';
                if (kind === 'confirm' || kind === 'prompt') {
                    const cancel = btn(o.cancel || 'Cancel', 'secondary');
                    cancel.onclick = () => finish(cancelValue);
                    row.appendChild(cancel);
                }
                let ok;
                if (kind === 'copy') {
                    const close = btn(o.cancel || 'Close', 'secondary');
                    close.onclick = () => finish(false);
                    row.appendChild(close);
                    ok = btn(o.ok || 'Copy', 'primary');
                    ok.onclick = () => {
                        const select = () => { try { field.focus(); field.select(); field.setSelectionRange(0, field.value.length); } catch (e) { /* manual */ } };
                        const viaCommand = () => { select(); try { return !!(doc.execCommand && doc.execCommand('copy')); } catch (e) { return false; } };
                        const done2 = good => { if (good) { finish(true); } else { select(); p.textContent = String(message) + '\nSelect the text and copy it.'; } };
                        if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
                            root.navigator.clipboard.writeText(field.value).then(() => done2(true), () => done2(viaCommand()));
                        } else done2(viaCommand());
                    };
                } else {
                    ok = btn(o.ok || 'OK', 'primary', !!o.danger);
                    ok.onclick = () => finish(okValue());
                }
                row.appendChild(ok);
                box.appendChild(row);
                wrap.appendChild(box);
                wrap.addEventListener('click', e => { if (e.target === wrap && kind !== 'notice') finish(cancelValue); });
                doc.addEventListener('keydown', onKey, true);
                (doc.body || doc.documentElement).appendChild(wrap);
                try {
                    if (field && kind === 'prompt') { field.focus(); field.select(); }
                    else if (field && kind === 'copy') { field.focus(); field.select(); }
                    else ok.focus();
                } catch (e) { /* no focus */ }
            } catch (e) {
                try { wrap.remove(); } catch (e2) { /* never added */ }
                done = true;
                fallback(kind, message, o).then(resolve);
            }
        });
    }

    const dhqConfirm = (message, opts) => open('confirm', message, opts);
    const dhqNotice = (message, opts) => open('notice', message, opts);
    const dhqPrompt = (message, opts) => open('prompt', message, opts);
    const dhqCopyText = (title, text) => open('copy', title, { text });
    dhqConfirm.__dhqDialogs = true;
    root.dhqConfirm = dhqConfirm;
    root.dhqNotice = dhqNotice;
    root.dhqPrompt = dhqPrompt;
    root.dhqCopyText = dhqCopyText;
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = { dhqConfirm, dhqNotice, dhqPrompt, dhqCopyText };
})(typeof window !== 'undefined' ? window : globalThis);
