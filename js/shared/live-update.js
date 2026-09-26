// js/shared/live-update.js — SILENT live update. Replaces update-sentinel.js.
// Owner ruling 2026-08-27: users must receive shipped builds without
// force-quitting the app; no button, no banner. So there is no UI at all —
// a running page (browser tab, or the iOS shell resumed from background)
// reloads onto a new deploy only at a moment that reads as a normal resume.
//
// The deploy stamps <meta name="dhq-build"> into each page and writes
// version.json beside it (scripts/build-deploy.cjs). This polls version.json
// (load +10s, every 5 min while visible, on resume/focus/online/hide); when the
// build differs, it reloads when:
//   a. hidden ≥ 2 min and timers still run (desktop tab)   → reload while hidden
//   b. resumed after ≥ 2 min away (visible / pageshow / focus after hidden /
//      heartbeat gap > 60s — iOS freezes timers, no native resume event)
//   c. visible, no pointerdown/keydown/touchstart/scroll for 5 min
//   d. critical:true → any resume, or idle ≥ 60s
// A quick app-switch (< 2 min) never reloads. Never while typing, a sheet/modal
// is open, a draft is live/mounted, an AI call is in flight, the device is
// offline, an OAuth/session handoff is in the URL, or a screen holds updates.
// No meta tag (local dev) → inert. The reload keeps the URL (hash route,
// query) and localStorage; in-memory React state is lost — hence holds.
//
// Holds (unsaved work): App.LiveUpdate.hold(reason) when a screen starts
// holding work only it knows about (an unapplied lineup, a half-built trade,
// an unsaved form); release(reason) when it is applied / cleared / unmounted.
// hold(reason, fn) is a live predicate hold (blocks while fn() is truthy) for
// plain pages. Calling either before this script loads is a harmless no-op
// (window.App?.LiveUpdate?.hold) — every page loads it before any holder.
// Hard cap: a hold on work untouched for 2 h is ignored once the user has been
// away ≥ 30 min (a forgotten screen can't block updates forever); focus,
// modal, draft, AI and auth guards are never capped.
//
// Loop guard: a target that didn't land waits 10 min (retry bypasses caches via
// ?lu=), max 3 auto reloads/hour. The page is re-fetched first and only a
// successful response navigates (offline never reloads into an error page).
// A backwards wall-clock jump is rebased; a stalled probe times out.
// Thresholds: window.WR_UPDATE_TUNING.
(function (root) {
    'use strict';

    var CFG = {
        minAwayMs: 120000, idleMs: 300000, critAwayMs: 0, critIdleMs: 60000,
        loadDelayMs: 10000, pollMs: 300000, beatMs: 15000, wakeGapMs: 60000, resumeWindowMs: 15000,
        minGapMs: 15000, maxBackoffMs: 1800000, staleMs: 600000, maxPerHour: 3,
        fetchTimeoutMs: 30000, prefetchTimeoutMs: 20000, retryApplyMs: 60000,
        holdMaxMs: 7200000, holdAwayMs: 1800000,
    };
    var UNREACHABLE = {};

    // ── Pure decision logic (unit-tested in live-update.test.js) ──────────────
    function isPending(own, latest) {
        return !!(own && latest && typeof latest.build === 'string' && latest.build && latest.build !== own);
    }
    // Reload history of the last hour. Entries stamped in the "future" were
    // written before the wall clock went backwards — they no longer count.
    function lastHour(hist, now) {
        return (Array.isArray(hist) ? hist : []).filter(function (h) {
            return h && typeof h.at === 'number' && now - h.at < 3600000 && h.at - now < 300000;
        });
    }
    // Why an automatic reload to `target` must not happen now (null = allowed).
    function loopBlock(hist, own, target, now, cfg) {
        var r = lastHour(hist, now), last = r[r.length - 1];
        if (r.length >= cfg.maxPerHour) return 'rate';
        if (last && last.to === target && own !== target && now - last.at < cfg.staleMs) return 'stale';
        return null;
    }
    // s: { own, latest, hidden, hiddenFor, resumeAway (ms away, null = not a
    //      fresh resume), idleFor, unsafe, loop }; c: thresholds
    function decide(s, c) {
        if (!s.own) return { act: 'none', why: 'dev' };
        if (!isPending(s.own, s.latest)) return { act: 'none', why: 'current' };
        if (s.loop) return { act: 'none', why: s.loop };
        if (s.unsafe) return { act: 'wait', why: s.unsafe };
        var crit = s.latest.critical === true, away = crit ? c.critAwayMs : c.minAwayMs, idle = crit ? c.critIdleMs : c.idleMs;
        if (s.hidden) return s.hiddenFor >= away ? { act: 'reload', why: 'hidden' } : { act: 'wait', why: 'away-short' };
        if (s.resumeAway != null && s.resumeAway >= away) return { act: 'reload', why: 'resume' };
        if (s.idleFor >= idle) return { act: 'reload', why: 'idle' };
        return { act: 'wait', why: 'active' };
    }

    // ── Controller over an injected environment (browser below, fakes in tests)
    // env: now, own, hidden, unsafe, fetchLatest, prefetch, navigate, track,
    //      store{get,set}, after, every.  tune: object or () => object (live).
    function createUpdater(env, tune) {
        function cfg() {
            var t = typeof tune === 'function' ? tune() : tune, c = {}, k;
            for (k in CFG) c[k] = t && t[k] != null ? t[k] : CFG[k];
            return c;
        }
        var st = { own: null, latest: null, lastCheck: -1e15, errors: 0, nextAt: 0, busy: false, busyAt: 0, seq: 0,
            applying: false, applyAfter: 0, hiddenAt: 0, resumeAt: 0, resumeAway: null, activity: 0, beatAt: 0,
            lastNow: 0, holds: {} };

        // Wall clock. iOS freezes timers, so elapsed time must be wall time —
        // but a clock set backwards (user / NTP) would freeze polling, the idle
        // rule and the hold ages until it caught up. Rebase every stamp instead.
        function now() {
            var t = env.now(), d = t - st.lastNow;
            if (st.lastNow && d < -5000) {
                ['lastCheck', 'nextAt', 'busyAt', 'applyAfter', 'hiddenAt', 'resumeAt', 'activity', 'beatAt'].forEach(function (k) {
                    if (st[k] > 0) st[k] += d;
                });
                Object.keys(st.holds).forEach(function (r) { var h = st.holds[r]; h.at += d; if (h.since) h.since += d; });
            }
            st.lastNow = t;
            return t;
        }
        // The first active hold ('hold:<reason>'), or null. `away` is how long
        // the user has been gone (hidden, or the resume just counted).
        function held(t, away, c) {
            var keys = Object.keys(st.holds);
            for (var i = 0; i < keys.length; i++) {
                var h = st.holds[keys[i]], on = true;
                if (h.fn) { try { on = !!h.fn(); } catch (e) { on = true; } }
                if (!on) { h.since = 0; continue; }
                if (h.fn && !h.since) h.since = t;
                var touched = Math.max(h.fn ? h.since : h.at, st.activity);
                if (t - touched >= c.holdMaxMs && away >= c.holdAwayMs) continue; // hard cap: stale hold
                return 'hold:' + keys[i];
            }
            return null;
        }
        function guard() {
            try { return env.unsafe(); } catch (e) { return 'guard-error'; } // unknown state: don't reload
        }
        function snapshot(c) {
            var t = now(), pend = isPending(st.own, st.latest), hidden = env.hidden();
            var hiddenFor = hidden && st.hiddenAt ? t - st.hiddenAt : 0;
            // a resume counts until the user touches something (or the window lapses)
            var resumeAway = st.resumeAt && st.activity < st.resumeAt && t - st.resumeAt <= c.resumeWindowMs ? st.resumeAway : null;
            return {
                own: st.own, latest: st.latest, hidden: hidden, hiddenFor: hiddenFor, resumeAway: resumeAway,
                idleFor: t - st.activity,
                unsafe: held(t, hidden ? hiddenFor : resumeAway || 0, c) || guard(),
                loop: pend ? loopBlock(env.store.get(), st.own, st.latest.build, t, c) : null,
            };
        }
        function evaluate(trig) {
            var c = cfg(), d = decide(snapshot(c), c);
            d.trigger = trig;
            if (d.act !== 'reload') return d;
            if (st.applyAfter && now() < st.applyAfter) return { act: 'wait', why: 'unreachable', trigger: trig };
            return apply(d.why, trig);
        }
        function apply(why, trig) {
            if (st.applying) return Promise.resolve({ act: 'busy' });
            st.applying = true;
            var target = st.latest.build, own = st.own;
            // Re-fetch the page first (refreshes the HTTP-cached copy and says which
            // build it serves). No answer (offline, 404, stalled) → don't navigate:
            // a reload now would land on an error page and wipe the app.
            var probe = new Promise(function (resolve) {
                env.after(cfg().prefetchTimeoutMs, function () { resolve(UNREACHABLE); });
                Promise.resolve().then(env.prefetch).then(resolve, function () { resolve(UNREACHABLE); });
            });
            return probe.then(function (served) {
                var c = cfg();
                if (served === UNREACHABLE) {
                    st.applying = false; st.applyAfter = now() + c.retryApplyMs;
                    return { act: 'wait', why: 'unreachable', trigger: trig };
                }
                var d = decide(snapshot(c), c); // the fetch took time: re-verify
                if (d.act !== 'reload') { st.applying = false; return d; }
                var t = now(), hist = lastHour(env.store.get(), t);
                var tried = hist.some(function (h) { return h.to === target; });
                // Served HTML is still the old build, or a plain reload already failed → cache-bust.
                var mode = served === own || tried ? 'bust' : 'reload';
                hist.push({ from: own, to: target, at: t, why: d.why, mode: mode });
                env.store.set(hist);
                env.navigate(mode, target);
                env.after(30000, function () { st.applying = false; }); // navigation never happened
                return { act: 'reload', why: d.why, mode: mode, trigger: trig };
            });
        }
        function check(trig) {
            if (!st.own) return Promise.resolve({ act: 'none', why: 'dev' });
            var c = cfg(), t = now(), eager = trig === 'resume' || trig === 'online';
            var soon = eager || trig === 'hidden';
            var busy = st.busy && t - st.busyAt < c.fetchTimeoutMs; // a probe that never settled can't wedge us
            if (busy || st.applying || t - st.lastCheck < (soon ? 5000 : c.minGapMs) || (!eager && t < st.nextAt)) {
                return Promise.resolve(evaluate(trig));
            }
            var seq = ++st.seq;
            st.busy = true; st.busyAt = st.lastCheck = t;
            return Promise.resolve().then(env.fetchLatest).then(function (v) {
                if (!v || typeof v.build !== 'string' || !v.build) throw new Error('bad version.json');
                if (seq === st.seq) { st.busy = false; st.errors = 0; st.nextAt = 0; st.latest = v; }
            }).then(null, function () { // 404 / offline / parse error: quiet exponential back-off
                if (seq !== st.seq) return; // superseded by a newer probe
                st.busy = false; st.errors++;
                st.nextAt = now() + Math.min(c.maxBackoffMs, c.pollMs * Math.pow(2, st.errors - 1));
            }).then(function () { return evaluate(trig); });
        }
        function hide() {
            if (!st.hiddenAt) st.hiddenAt = now();
            return check('hidden'); // learn about a deploy now; decide() waits out minAwayMs
        }
        function resume(away) {
            var t = now();
            st.resumeAway = away != null ? away : (st.hiddenAt ? t - st.hiddenAt : 0);
            st.resumeAt = st.beatAt = t; st.hiddenAt = 0;
            return check('resume');
        }
        // Heartbeat. Timers freeze while iOS backgrounds the shell: a wall-clock
        // gap far beyond the interval means we just woke (away ≈ the gap).
        function beat() {
            var c = cfg(), t = now(), gap = t - st.beatAt;
            st.beatAt = t;
            if (env.hidden()) { // desktop tabs keep (throttled) timers: reload once away long enough
                if (!st.hiddenAt) st.hiddenAt = t; // hidden without an event: start counting now
                if (t - st.hiddenAt < (st.latest && st.latest.critical === true ? c.critAwayMs : c.minAwayMs)) return Promise.resolve(null);
                if (isPending(st.own, st.latest)) return Promise.resolve(evaluate('hidden-long'));
                return t - st.lastCheck >= c.pollMs ? check('hidden-long') : Promise.resolve(null);
            }
            if (gap > c.wakeGapMs) return resume(gap);
            if (t - st.lastCheck >= c.pollMs) return check('poll');
            return Promise.resolve(isPending(st.own, st.latest) ? evaluate('beat') : null); // idle rule
        }
        function arrived() { // runs on the reloaded page: log the applied update once
            var t = now(), hist = env.store.get(), last = Array.isArray(hist) ? hist[hist.length - 1] : null;
            if (!last || last.rep || last.from === st.own || t - last.at > cfg().staleMs) return null;
            last.rep = 1;
            env.store.set(hist);
            var meta = { from: last.from, to: last.to, landed: st.own, ok: st.own === last.to, trigger: last.why, mode: last.mode };
            try { env.track('live_update_applied', meta); } catch (e) { /* tracking is best-effort */ }
            return meta;
        }
        return {
            cfg: cfg, st: st, check: check, evaluate: evaluate, beat: beat, hide: hide, resume: resume, arrived: arrived,
            start: function () {
                st.own = env.own() || null;
                if (!st.own) return false;
                var c = cfg();
                st.beatAt = st.activity = now();
                if (env.hidden()) st.hiddenAt = st.beatAt;
                arrived();
                env.after(c.loadDelayMs, function () { check('load'); });
                env.every(c.beatMs, beat);
                return true;
            },
            touch: function () { st.activity = now(); },
            focus: function () { return st.hiddenAt && !env.hidden() ? resume() : check('focus'); },
            // Re-holding an active hold keeps its start time (the cap measures the work's age).
            hold: function (r, fn) {
                r = r || 'screen';
                if (st.holds[r] && !fn && !st.holds[r].fn) return;
                st.holds[r] = { at: now(), fn: typeof fn === 'function' ? fn : null, since: 0 };
            },
            release: function (r) { delete st.holds[r || 'screen']; return isPending(st.own, st.latest) ? evaluate('release') : null; },
        };
    }

    var api = { CFG: CFG, isPending: isPending, loopBlock: loopBlock, decide: decide, createUpdater: createUpdater };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    var doc = root && root.document;
    if (!doc || !root.fetch) return;

    // ── Browser wiring ────────────────────────────────────────────────────────
    var loc = root.location, KEY = 'dhq_lu_log_v1', AI_STALL_MS = 180000, aiCalls = {}, aiSeq = 0;
    function noop() { /* swallow: the updater must never surface an error */ }
    function ss(k, v) {
        try {
            if (v === undefined) { var a = JSON.parse(root.sessionStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; }
            root.sessionStorage.setItem(k, JSON.stringify(v));
        } catch (e) { return []; }
    }
    function surface() {
        var ua = root.navigator.userAgent || '';
        return /iPhone|iPad|iPod|Macintosh/.test(ua) && /AppleWebKit/.test(ua) && !/Safari\//.test(ua) ? 'ios_app' : 'web';
    }
    // Count AI calls in flight (same promise returned, untouched). dhqAI and
    // callClaude are wrapped too: the BYO-key path never reaches OD.callAI, and
    // dhqAI awaits league memory before it does.
    function wrapFn(obj, key) {
        var f = obj && obj[key];
        if (typeof f !== 'function' || f.__lu) return;
        var w = function () {
            var id = ++aiSeq, done = function () { delete aiCalls[id]; }, p;
            aiCalls[id] = Date.now();
            try { p = f.apply(this, arguments); } catch (e) { done(); throw e; }
            Promise.resolve(p).then(done, done);
            return p;
        };
        w.__lu = 1;
        try { obj[key] = w; } catch (e) { /* read-only binding: leave it */ }
    }
    function wrapAI() {
        wrapFn(root.OD, 'callAI'); wrapFn(root, 'dhqAI'); wrapFn(root, 'callClaude'); wrapFn(root.App, 'callClaude');
    }
    function aiBusy() { // a call that never settles stops counting after 3 min
        var t = Date.now();
        return Object.keys(aiCalls).some(function (id) { return t - aiCalls[id] < AI_STALL_MS; });
    }
    // OAuth / session handoff in flight: tokens (or an error) in the URL, or a
    // PKCE ?code=. Reloading mid-callback could break sign-in.
    function handoff() {
        return /[#&](access_token|refresh_token|error_description|dhq_session)=/.test(loc.hash || '') ||
            /[?&](code|error_description)=/.test(loc.search || '');
    }
    function unsafe() {
        wrapAI();
        if (handoff()) return 'auth-handoff';
        var a = doc.activeElement, tag = a && a.tagName;
        if (a && (tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable ||
            (tag === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(a.type || '')))) return 'typing';
        // only a rendered modal counts (landing.html keeps its closed auth sheet in a [hidden] parent)
        var m = doc.querySelectorAll('[aria-modal="true"],.wr-sheet-backdrop,dialog[open]');
        for (var i = 0; i < m.length; i++) if (m[i].getClientRects().length) return 'modal';
        var ls = root.DraftCC && root.DraftCC.liveSync;
        if (ls && typeof ls.isRunning === 'function' && ls.isRunning()) return 'live-draft';
        if (doc.querySelector('[data-draft-pid]')) return 'draft-board';
        if (aiBusy()) return 'ai';
        return root.navigator.onLine === false ? 'offline' : null;
    }
    function metaBuild(html) {
        var m = /<meta\s+name=["']dhq-build["']\s+content=["']([^"']+)["']/i.exec(html || '');
        return m ? m[1] : null;
    }
    function timedFetch(url, opts, ms) {
        var ac = typeof root.AbortController === 'function' ? new root.AbortController() : null;
        if (ac) { opts.signal = ac.signal; root.setTimeout(function () { try { ac.abort(); } catch (e) { noop(); } }, ms); }
        return root.fetch(url, opts);
    }
    function track(name, meta) {
        meta.surface = surface();
        var tries = 0;
        (function go() {
            try {
                var od = root.OD, r;
                if (od && typeof od.track === 'function') r = od.track(name, { module: 'live-update', metadata: meta });
                else if (typeof root.trackConnectEvent === 'function') r = root.trackConnectEvent(name, null, meta);
                else if (typeof root.trackLandingEvent === 'function') r = root.trackLandingEvent(name, meta);
                else { if (++tries < 30) root.setTimeout(go, 2000); return; } // shared engine loads async
                if (r && typeof r.then === 'function') r.then(null, noop);
            } catch (e) { noop(); } // analytics is best-effort: never throws
        })();
    }
    var lu = createUpdater({
        now: function () { return Date.now(); },
        own: function () { var m = doc.querySelector('meta[name="dhq-build"]'); return m && m.content; },
        hidden: function () { return doc.visibilityState === 'hidden'; },
        unsafe: unsafe,
        fetchLatest: function () {
            return timedFetch('version.json?t=' + Date.now(), { cache: 'no-store' }, CFG.fetchTimeoutMs)
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
        },
        // Refresh the HTTP-cached page (max-age=600) and report which build it serves.
        prefetch: function () {
            return timedFetch(loc.pathname + loc.search, { cache: 'reload', credentials: 'same-origin' }, CFG.prefetchTimeoutMs)
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(metaBuild);
        },
        navigate: function (mode, target) {
            if (mode !== 'bust') return loc.reload();
            var q = loc.search.replace(/[?&]lu=[^&]*/g, '').replace(/^&/, '?');
            loc.replace(loc.pathname + (q ? q + '&' : '?') + 'lu=' + encodeURIComponent(target) + loc.hash);
        },
        track: track,
        store: { get: function () { return ss(KEY); }, set: function (v) { ss(KEY, v); } },
        after: function (ms, fn) { root.setTimeout(function () { safe(fn); }, ms); },
        every: function (ms, fn) { return root.setInterval(function () { safe(function () { wrapAI(); return fn(); }); }, ms); },
    }, function () { return root.WR_UPDATE_TUNING; });
    // Run an updater entry point from an event / timer / caller: never throws,
    // never leaves an unhandled rejection.
    function safe(fn) {
        try { var r = fn(); if (r && typeof r.then === 'function') r.then(null, noop); return r; } catch (e) { return null; }
    }

    // Tidy the ?lu= cache-bust param off the URL (hash route untouched).
    if (/[?&]lu=/.test(loc.search) && root.history && root.history.replaceState) {
        var q = loc.search.replace(/[?&]lu=[^&]*/g, '').replace(/^&/, '?');
        try { root.history.replaceState(root.history.state, '', loc.pathname + q + loc.hash); } catch (e) { /* ignore */ }
    }
    root.App = root.App || {};
    root.App.LiveUpdate = {
        hold: function (r, fn) { safe(function () { lu.hold(r, fn); }); },
        release: function (r) { safe(function () { return lu.release(r); }); },
        check: function () { return Promise.resolve(safe(function () { return lu.check('manual'); })); },
        state: function () { return lu.st; }, decide: decide, isPending: isPending,
    };
    if (!lu.start()) return; // unstamped page (local dev): stay inert
    function on(fn) { return function (e) { safe(function () { return fn(e); }); }; }
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
        doc.addEventListener(ev, lu.touch, { passive: true, capture: true });
    });
    root.addEventListener('scroll', lu.touch, { passive: true, capture: true });
    doc.addEventListener('visibilitychange', on(function () {
        return doc.visibilityState === 'hidden' ? lu.hide() : lu.resume();
    }));
    root.addEventListener('pagehide', on(function () { return lu.hide(); }));
    root.addEventListener('pageshow', on(function (e) { return e.persisted ? lu.resume() : null; }));
    root.addEventListener('focus', on(lu.focus));
    root.addEventListener('online', on(function () { return lu.check('online'); }));
})(typeof window !== 'undefined' ? window : globalThis);
