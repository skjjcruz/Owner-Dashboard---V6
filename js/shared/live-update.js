// js/shared/live-update.js — live update: a running page (browser tab, or the
// iOS shell resumed from background) picks up a new deploy without a relaunch.
// Replaces update-sentinel.js. Plain JS, no build step, no dependencies.
//
// The deploy stamps <meta name="dhq-build"> into each page and writes
// version.json beside it (scripts/build-deploy.cjs). This polls version.json
// and, when the build differs, applies it only at a safe moment:
//   a. page hidden                        → reload now (nobody is looking)
//   b. just resumed, not touched yet      → "Updating DHQ…" overlay + reload
//   c. in use                             → toast (Refresh / ×); applies at the
//      next hidden/resume. critical:true  → 30s countdown, then first safe moment.
// Never auto-reloads while typing, a sheet/modal is open, a draft is live/mounted,
// an AI call is in flight, or a screen holds updates (App.LiveUpdate.hold(reason)).
// No meta tag (local dev) → does nothing. Loop guard: a target that didn't land
// waits 10 min; max 3 auto reloads/hour; the retry bypasses caches (?lu=).
(function (root) {
    'use strict';

    var CFG = {
        loadDelayMs: 10000, pollMs: 300000, beatMs: 15000, wakeGapMs: 60000,
        freshMs: 3000, resumeFreshMs: 15000, minGapMs: 15000, maxBackoffMs: 1800000,
        staleMs: 600000, maxPerHour: 3, criticalMs: 30000,
    };
    var RESUME = { visible: 1, pageshow: 1, wake: 1 };

    // ── Pure decision logic (unit-tested in live-update.test.js) ──────────────
    function isPending(own, latest) {
        return !!(own && latest && typeof latest.build === 'string' && latest.build && latest.build !== own);
    }
    function lastHour(hist, now) {
        return (hist || []).filter(function (h) { return h && now - h.at < 3600000; });
    }
    // Why an automatic reload to `target` must not happen now (null = allowed).
    function loopBlock(hist, own, target, now, cfg) {
        var r = lastHour(hist, now), last = r[r.length - 1];
        if (r.length >= cfg.maxPerHour) return 'rate';
        if (last && last.to === target && own !== target && now - last.at < cfg.staleMs) return 'stale';
        return null;
    }
    // s: { own, latest, hidden, fresh, unsafe, loop, dismissed, criticalDue }
    function decide(s) {
        if (!s.own) return { act: 'none', why: 'dev' };
        if (!isPending(s.own, s.latest)) return { act: 'none', why: 'current' };
        if (s.loop) return { act: 'none', why: s.loop };
        if (s.hidden) return s.unsafe ? { act: 'wait', why: s.unsafe } : { act: 'reload', why: 'hidden' };
        if (s.fresh && !s.unsafe) return { act: 'reload', overlay: true, why: 'resume' };
        if (s.latest.critical && s.criticalDue && !s.unsafe) return { act: 'reload', overlay: true, why: 'critical' };
        if (s.dismissed) return { act: 'wait', why: 'dismissed' };
        return { act: 'toast', critical: !!s.latest.critical, why: s.unsafe || 'active' };
    }

    // ── Controller over an injected environment (browser below, fakes in tests)
    // env: now, own, hidden, unsafe, fetchLatest, prefetch, navigate, track,
    //      store{get,set}, ui{toast,hideToast,overlay}, after, every
    function createUpdater(env, tune) {
        var cfg = {}, k;
        for (k in CFG) cfg[k] = tune && tune[k] != null ? tune[k] : CFG[k];
        var st = { own: null, latest: null, lastCheck: -1e15, errors: 0, nextAt: 0, busy: false,
            resumeAt: 0, touch: 0, dismissed: false, critAt: 0, applying: false, beatAt: 0, ticking: false, holds: {} };

        function unsafe() {
            var h = Object.keys(st.holds);
            return h.length ? 'hold:' + h[0] : env.unsafe();
        }
        function snapshot(fromResume) {
            var t = env.now(), L = st.latest, pend = isPending(st.own, L);
            if (pend && L.critical && !st.critAt) st.critAt = t;
            return {
                own: st.own, latest: L, hidden: env.hidden(), unsafe: unsafe(), dismissed: st.dismissed,
                fresh: st.resumeAt > 0 && st.touch < st.resumeAt && t - st.resumeAt <= (fromResume ? cfg.resumeFreshMs : cfg.freshMs),
                loop: pend ? loopBlock(env.store.get(), st.own, L.build, t, cfg) : null,
                criticalDue: !!(pend && L.critical && t - st.critAt >= cfg.criticalMs),
            };
        }
        function evaluate(trig) {
            var d = decide(snapshot(!!RESUME[trig]));
            d.trigger = trig;
            if (d.act === 'reload') return apply(d.why, d.overlay, false, trig);
            if (d.act === 'toast') {
                var left = d.critical ? Math.max(0, Math.ceil((st.critAt + cfg.criticalMs - env.now()) / 1000)) : null;
                env.ui.toast({ critical: d.critical, secs: left });
                if (d.critical && !st.ticking) {
                    st.ticking = true;
                    env.every(1000, function () { if (!st.ticking) return false; if (!st.applying) evaluate('tick'); });
                }
            } else if (d.act === 'none' || d.why === 'dismissed') {
                if (d.act === 'none') st.ticking = false; // a dismissed critical keeps counting down
                env.ui.hideToast();
            }
            return d;
        }
        function apply(why, overlay, manual, trig) {
            if (st.applying || !isPending(st.own, st.latest)) return Promise.resolve({ act: 'busy' });
            st.applying = true;
            var target = st.latest.build, own = st.own;
            if (overlay) env.ui.overlay(true);
            return Promise.resolve().then(env.prefetch).then(null, function () { return null; }).then(function (served) {
                if (!manual) { // the fetch took time: the user may have started typing or come back
                    var d = decide(snapshot(!!RESUME[trig]));
                    if (d.act !== 'reload') { st.applying = false; env.ui.overlay(false); return evaluate(trig); }
                    if (d.overlay) env.ui.overlay(true);
                }
                var t = env.now(), hist = lastHour(env.store.get(), t);
                var tried = hist.some(function (h) { return h.to === target; });
                // Served HTML is still the old build, or a plain reload already failed → cache-bust.
                var mode = served === own || tried ? 'bust' : 'reload';
                hist.push({ from: own, to: target, at: t, why: manual ? 'manual' : why, mode: mode });
                env.store.set(hist);
                st.ticking = false;
                env.ui.hideToast();
                env.navigate(mode, target);
                env.after(30000, function () { st.applying = false; env.ui.overlay(false); }); // navigation never happened
                return { act: 'reload', why: why, mode: mode };
            });
        }
        function check(trig) {
            if (!st.own) return Promise.resolve({ act: 'none', why: 'dev' });
            // resume/online bypass the error back-off; those + hidden (the best moment to apply) use a 5s gap
            var t = env.now(), eager = RESUME[trig] || trig === 'online', soon = eager || trig === 'hidden';
            if (st.busy || st.applying || t - st.lastCheck < (soon ? 5000 : cfg.minGapMs) || (!eager && t < st.nextAt)) {
                return Promise.resolve(evaluate(trig));
            }
            st.busy = true; st.lastCheck = t;
            return Promise.resolve().then(env.fetchLatest).then(function (v) {
                if (!v || typeof v.build !== 'string' || !v.build) throw new Error('bad version.json');
                st.busy = false; st.errors = 0; st.nextAt = 0;
                if (!st.latest || st.latest.build !== v.build) st.critAt = 0;
                st.latest = v;
                return evaluate(trig);
            }).catch(function () { // 404 / offline / parse error: quiet exponential back-off
                st.busy = false; st.errors++;
                st.nextAt = env.now() + Math.min(cfg.maxBackoffMs, cfg.pollMs * Math.pow(2, st.errors - 1));
                return evaluate(trig);
            });
        }
        function resume(trig) {
            st.resumeAt = st.beatAt = env.now(); st.dismissed = false;
            return isPending(st.own, st.latest) ? Promise.resolve(evaluate(trig)) : check(trig);
        }
        // Timers freeze while iOS backgrounds the shell (no native resume event):
        // a wall-clock gap far beyond the heartbeat interval means we just woke.
        function beat() {
            var t = env.now(), gap = t - st.beatAt;
            st.beatAt = t;
            if (gap > cfg.wakeGapMs && !env.hidden()) return resume('wake');
            if (!env.hidden() && t - st.lastCheck >= cfg.pollMs) return check('poll');
            return Promise.resolve(null);
        }
        function arrived() { // runs on the reloaded page: log the applied update once
            var t = env.now(), hist = env.store.get(), last = hist[hist.length - 1];
            if (!last || last.rep || last.from === st.own || t - last.at > cfg.staleMs) return null;
            last.rep = 1;
            env.store.set(hist);
            var meta = { from: last.from, to: last.to, landed: st.own, ok: st.own === last.to, trigger: last.why, mode: last.mode };
            try { env.track('live_update_applied', meta); } catch (e) { /* tracking is best-effort */ }
            return meta;
        }
        return {
            cfg: cfg, st: st, check: check, evaluate: evaluate, beat: beat, resume: resume, arrived: arrived,
            start: function () {
                st.own = env.own() || null;
                if (!st.own) return false;
                st.beatAt = env.now();
                arrived();
                env.after(cfg.loadDelayMs, function () { check('load'); });
                env.every(cfg.beatMs, beat);
                return true;
            },
            touch: function () { st.touch = env.now(); },
            hidden: function () { return isPending(st.own, st.latest) ? Promise.resolve(evaluate('hidden')) : check('hidden'); },
            apply: function () { return apply('manual', true, true, 'manual'); },
            dismiss: function () { st.dismissed = true; env.ui.hideToast(); },
            hold: function (r) { st.holds[r || 'screen'] = 1; },
            release: function (r) {
                delete st.holds[r || 'screen'];
                return isPending(st.own, st.latest) ? evaluate('release') : null;
            },
        };
    }

    var api = { CFG: CFG, isPending: isPending, loopBlock: loopBlock, decide: decide, createUpdater: createUpdater };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    var doc = root && root.document;
    if (!doc || !root.fetch) return;

    // ── Browser wiring ────────────────────────────────────────────────────────
    var loc = root.location, KEY = 'dhq_lu_log_v1', aiN = 0, toastEl = null, ovEl = null, lu;
    function ss(k, v) {
        try {
            if (v === undefined) return JSON.parse(root.sessionStorage.getItem(k) || '[]') || [];
            root.sessionStorage.setItem(k, JSON.stringify(v));
        } catch (e) { return []; }
    }
    function surface() {
        var ua = root.navigator.userAgent || '';
        return /iPhone|iPad|iPod|Macintosh/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua) ? 'ios_app' : 'web';
    }
    function wrapAI() { // count OD.callAI promises in flight (same promise returned, untouched)
        var od = root.OD;
        if (!od || typeof od.callAI !== 'function' || od.callAI.__lu) return;
        var orig = od.callAI, w = function () {
            var p = orig.apply(this, arguments), done = function () { aiN = Math.max(0, aiN - 1); };
            aiN++;
            Promise.resolve(p).then(done, done);
            return p;
        };
        w.__lu = 1;
        od.callAI = w;
    }
    function unsafe() {
        wrapAI();
        var a = doc.activeElement, tag = a && a.tagName;
        if (a && (tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable ||
            (tag === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(a.type || '')))) return 'typing';
        if (doc.querySelector('[aria-modal="true"],.wr-sheet-backdrop,dialog[open]')) return 'modal';
        var ls = root.DraftCC && root.DraftCC.liveSync;
        if (ls && typeof ls.isRunning === 'function' && ls.isRunning()) return 'live-draft';
        if (doc.querySelector('[data-draft-pid]')) return 'draft-board';
        return aiN > 0 ? 'ai' : null;
    }
    function metaBuild(html) {
        var m = /<meta\s+name=["']dhq-build["']\s+content=["']([^"']+)["']/i.exec(html || '');
        return m ? m[1] : null;
    }
    function css() {
        if (doc.getElementById('dhq-lu-css')) return;
        var s = doc.createElement('style');
        s.id = 'dhq-lu-css';
        s.textContent = '#dhq-lu-toast{position:fixed;z-index:var(--wr-z-toast,202);right:16px;bottom:calc(16px + var(--wr-bottom-inset,env(safe-area-inset-bottom,0px)));display:flex;align-items:center;gap:8px;max-width:calc(100vw - 32px);padding:6px 6px 6px 14px;background:var(--black,#0a0a0a);color:#e8e8e8;border:1px solid rgba(212,175,55,.5);border-radius:var(--card-radius-sm,8px);box-shadow:0 8px 24px rgba(0,0,0,.55);font:600 13px/1.3 var(--font-body,-apple-system,system-ui,sans-serif)}' +
            '#dhq-lu-toast button{font:inherit;cursor:pointer;border:0;border-radius:var(--card-radius-xs,5px);padding:7px 11px;min-height:32px}' +
            '#dhq-lu-toast .go{background:var(--gold,#D4AF37);color:#0a0a0a;font-weight:700}#dhq-lu-toast .x{background:none;color:#8a8a8a;padding:7px 9px}' +
            '@media (max-width:767px){#dhq-lu-toast{right:auto;bottom:auto;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 62px);width:max-content}}' +
            '#dhq-lu-ov{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(10,10,10,.9);color:var(--gold,#D4AF37);font:700 15px/1.4 var(--font-body,-apple-system,system-ui,sans-serif);letter-spacing:.03em}';
        (doc.head || doc.documentElement).appendChild(s);
    }
    var ui = {
        toast: function (o) {
            if (!doc.body) return;
            css();
            if (!toastEl) {
                toastEl = doc.createElement('div');
                toastEl.id = 'dhq-lu-toast';
                toastEl.setAttribute('role', 'status');
                toastEl.setAttribute('aria-live', 'polite');
                toastEl.innerHTML = '<span></span><button type="button" class="go">Refresh</button><button type="button" class="x" aria-label="Dismiss update notice">×</button>';
                toastEl.querySelector('.go').onclick = function () { lu.apply(); };
                toastEl.querySelector('.x').onclick = function () { lu.dismiss(); };
                doc.body.appendChild(toastEl);
            }
            // Phone: sit just under the app header when one is on screen (CSS fallback otherwise).
            var h = doc.querySelector('header'), r = h && h.getBoundingClientRect();
            toastEl.style.top = root.innerWidth <= 767 && r && r.bottom > 0 && r.bottom < 160 ? Math.round(r.bottom + 8) + 'px' : '';
            toastEl.firstChild.textContent = o.critical
                ? (o.secs > 0 ? 'Important DHQ update · applying in ' + o.secs + 's' : 'Important DHQ update · applying next pause')
                : 'DHQ has an update';
        },
        hideToast: function () { if (toastEl) { toastEl.remove(); toastEl = null; } },
        overlay: function (on) {
            if (!on) { if (ovEl) { ovEl.remove(); ovEl = null; } return; }
            if (ovEl || !doc.body) return;
            css();
            ovEl = doc.createElement('div');
            ovEl.id = 'dhq-lu-ov';
            ovEl.setAttribute('role', 'status');
            ovEl.textContent = 'Updating DHQ…';
            doc.body.appendChild(ovEl);
        },
    };
    function track(name, meta) {
        meta.surface = surface();
        var tries = 0;
        (function go() {
            var od = root.OD;
            if (od && typeof od.track === 'function') return od.track(name, { module: 'live-update', metadata: meta });
            if (typeof root.trackConnectEvent === 'function') return root.trackConnectEvent(name, null, meta);
            if (typeof root.trackLandingEvent === 'function') return root.trackLandingEvent(name, meta);
            if (++tries < 30) root.setTimeout(go, 2000); // shared engine loads async
        })();
    }
    lu = createUpdater({
        now: function () { return Date.now(); },
        own: function () { var m = doc.querySelector('meta[name="dhq-build"]'); return m && m.content; },
        hidden: function () { return doc.visibilityState === 'hidden'; },
        unsafe: unsafe,
        fetchLatest: function () {
            return root.fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
        },
        // Refresh the HTTP-cached page (max-age=600) and report which build it serves.
        prefetch: function () {
            return root.fetch(loc.pathname + loc.search, { cache: 'reload', credentials: 'same-origin' })
                .then(function (r) { return r.ok ? r.text() : ''; }).then(metaBuild);
        },
        navigate: function (mode, target) {
            if (mode !== 'bust') return loc.reload();
            var q = loc.search.replace(/[?&]lu=[^&]*/g, '').replace(/^&/, '?');
            loc.replace(loc.pathname + (q ? q + '&' : '?') + 'lu=' + encodeURIComponent(target) + loc.hash);
        },
        track: track,
        store: { get: function () { return ss(KEY); }, set: function (v) { ss(KEY, v); } },
        ui: ui,
        after: function (ms, fn) { root.setTimeout(fn, ms); },
        every: function (ms, fn) {
            var id = root.setInterval(function () { if (fn() === false) root.clearInterval(id); }, ms);
            return id;
        },
    }, root.DHQ_LU_TUNING);

    // Tidy the ?lu= cache-bust param off the URL (hash route untouched).
    if (/[?&]lu=/.test(loc.search) && root.history && root.history.replaceState) {
        var q = loc.search.replace(/[?&]lu=[^&]*/g, '').replace(/^&/, '?');
        try { root.history.replaceState(root.history.state, '', loc.pathname + q + loc.hash); } catch (e) { /* ignore */ }
    }
    root.App = root.App || {};
    root.App.LiveUpdate = {
        hold: lu.hold, release: lu.release, check: function () { return lu.check('manual'); },
        apply: lu.apply, state: function () { return lu.st; }, decide: decide, isPending: isPending,
    };
    if (!lu.start()) return; // unstamped page (local dev): stay inert
    var on = function (t, ev, fn) { t.addEventListener(ev, fn, { passive: true, capture: true }); };
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) { on(doc, ev, lu.touch); });
    doc.addEventListener('visibilitychange', function () {
        if (doc.visibilityState === 'hidden') lu.hidden(); else lu.resume('visible');
    });
    root.addEventListener('pageshow', function (e) { if (e.persisted) lu.resume('pageshow'); });
    root.addEventListener('focus', function () { lu.check('focus'); });
    root.addEventListener('online', function () { lu.check('online'); });
})(typeof window !== 'undefined' ? window : globalThis);
