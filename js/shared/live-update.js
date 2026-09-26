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
// is open, a draft is live/mounted, an AI call is in flight, or a screen holds
// updates (App.LiveUpdate.hold(reason)). No meta tag (local dev) → inert.
// Loop guard: a target that didn't land waits 10 min (retry bypasses caches via
// ?lu=), max 3 auto reloads/hour. Thresholds: window.WR_UPDATE_TUNING.
(function (root) {
    'use strict';

    var CFG = {
        minAwayMs: 120000, idleMs: 300000, critAwayMs: 0, critIdleMs: 60000,
        loadDelayMs: 10000, pollMs: 300000, beatMs: 15000, wakeGapMs: 60000, resumeWindowMs: 15000,
        minGapMs: 15000, maxBackoffMs: 1800000, staleMs: 600000, maxPerHour: 3,
    };

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
    // s: { own, latest, hidden, hiddenFor, resumeAway (ms away, null = not a
    //      fresh resume), idleFor, unsafe, loop }; c: thresholds
    function decide(s, c) {
        if (!s.own) return { act: 'none', why: 'dev' };
        if (!isPending(s.own, s.latest)) return { act: 'none', why: 'current' };
        if (s.loop) return { act: 'none', why: s.loop };
        if (s.unsafe) return { act: 'wait', why: s.unsafe };
        var crit = !!s.latest.critical, away = crit ? c.critAwayMs : c.minAwayMs, idle = crit ? c.critIdleMs : c.idleMs;
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
        var st = { own: null, latest: null, lastCheck: -1e15, errors: 0, nextAt: 0, busy: false, applying: false,
            hiddenAt: 0, resumeAt: 0, resumeAway: null, activity: 0, beatAt: 0, holds: {} };

        function snapshot(c) {
            var t = env.now(), pend = isPending(st.own, st.latest), hidden = env.hidden();
            var h = Object.keys(st.holds);
            return {
                own: st.own, latest: st.latest, hidden: hidden,
                hiddenFor: hidden && st.hiddenAt ? t - st.hiddenAt : 0,
                // a resume counts until the user touches something (or the window lapses)
                resumeAway: st.resumeAt && st.activity < st.resumeAt && t - st.resumeAt <= c.resumeWindowMs ? st.resumeAway : null,
                idleFor: t - st.activity,
                unsafe: h.length ? 'hold:' + h[0] : env.unsafe(),
                loop: pend ? loopBlock(env.store.get(), st.own, st.latest.build, t, c) : null,
            };
        }
        function evaluate(trig) {
            var d = decide(snapshot(cfg()), cfg());
            d.trigger = trig;
            return d.act === 'reload' ? apply(d.why, trig) : d;
        }
        function apply(why, trig) {
            if (st.applying) return Promise.resolve({ act: 'busy' });
            st.applying = true;
            var target = st.latest.build, own = st.own;
            return Promise.resolve().then(env.prefetch).then(null, function () { return null; }).then(function (served) {
                var c = cfg(), d = decide(snapshot(c), c); // the fetch took time: re-verify
                if (d.act !== 'reload') { st.applying = false; return d; }
                var t = env.now(), hist = lastHour(env.store.get(), t);
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
            var c = cfg(), t = env.now(), eager = trig === 'resume' || trig === 'online';
            var soon = eager || trig === 'hidden';
            if (st.busy || st.applying || t - st.lastCheck < (soon ? 5000 : c.minGapMs) || (!eager && t < st.nextAt)) {
                return Promise.resolve(evaluate(trig));
            }
            st.busy = true; st.lastCheck = t;
            return Promise.resolve().then(env.fetchLatest).then(function (v) {
                if (!v || typeof v.build !== 'string' || !v.build) throw new Error('bad version.json');
                st.busy = false; st.errors = 0; st.nextAt = 0; st.latest = v;
                return evaluate(trig);
            }).catch(function () { // 404 / offline / parse error: quiet exponential back-off
                st.busy = false; st.errors++;
                st.nextAt = env.now() + Math.min(c.maxBackoffMs, c.pollMs * Math.pow(2, st.errors - 1));
                return evaluate(trig);
            });
        }
        function hide() {
            if (!st.hiddenAt) st.hiddenAt = env.now();
            return check('hidden'); // learn about a deploy now; decide() waits out minAwayMs
        }
        function resume(away) {
            var t = env.now();
            st.resumeAway = away != null ? away : (st.hiddenAt ? t - st.hiddenAt : 0);
            st.resumeAt = st.beatAt = t; st.hiddenAt = 0;
            return check('resume');
        }
        // Heartbeat. Timers freeze while iOS backgrounds the shell: a wall-clock
        // gap far beyond the interval means we just woke (away ≈ the gap).
        function beat() {
            var c = cfg(), t = env.now(), gap = t - st.beatAt;
            st.beatAt = t;
            if (env.hidden()) { // desktop tabs keep (throttled) timers: reload once away long enough
                if (!st.hiddenAt || t - st.hiddenAt < (st.latest && st.latest.critical ? c.critAwayMs : c.minAwayMs)) return Promise.resolve(null);
                if (isPending(st.own, st.latest)) return Promise.resolve(evaluate('hidden-long'));
                return t - st.lastCheck >= c.pollMs ? check('hidden-long') : Promise.resolve(null);
            }
            if (gap > c.wakeGapMs) return resume(gap);
            if (t - st.lastCheck >= c.pollMs) return check('poll');
            return Promise.resolve(isPending(st.own, st.latest) ? evaluate('beat') : null); // idle rule
        }
        function arrived() { // runs on the reloaded page: log the applied update once
            var t = env.now(), hist = env.store.get(), last = hist[hist.length - 1];
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
                st.beatAt = st.activity = env.now();
                if (env.hidden()) st.hiddenAt = st.beatAt;
                arrived();
                env.after(c.loadDelayMs, function () { check('load'); });
                env.every(c.beatMs, beat);
                return true;
            },
            touch: function () { st.activity = env.now(); },
            focus: function () { return st.hiddenAt && !env.hidden() ? resume() : check('focus'); },
            hold: function (r) { st.holds[r || 'screen'] = 1; },
            release: function (r) { delete st.holds[r || 'screen']; return isPending(st.own, st.latest) ? evaluate('release') : null; },
        };
    }

    var api = { CFG: CFG, isPending: isPending, loopBlock: loopBlock, decide: decide, createUpdater: createUpdater };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    var doc = root && root.document;
    if (!doc || !root.fetch) return;

    // ── Browser wiring ────────────────────────────────────────────────────────
    var loc = root.location, KEY = 'dhq_lu_log_v1', aiN = 0;
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
        // only a rendered modal counts (landing.html keeps its closed auth sheet in a [hidden] parent)
        var m = doc.querySelectorAll('[aria-modal="true"],.wr-sheet-backdrop,dialog[open]');
        for (var i = 0; i < m.length; i++) if (m[i].getClientRects().length) return 'modal';
        var ls = root.DraftCC && root.DraftCC.liveSync;
        if (ls && typeof ls.isRunning === 'function' && ls.isRunning()) return 'live-draft';
        if (doc.querySelector('[data-draft-pid]')) return 'draft-board';
        return aiN > 0 ? 'ai' : null;
    }
    function metaBuild(html) {
        var m = /<meta\s+name=["']dhq-build["']\s+content=["']([^"']+)["']/i.exec(html || '');
        return m ? m[1] : null;
    }
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
    var lu = createUpdater({
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
        after: function (ms, fn) { root.setTimeout(fn, ms); },
        every: function (ms, fn) { return root.setInterval(fn, ms); },
    }, function () { return root.WR_UPDATE_TUNING; });

    // Tidy the ?lu= cache-bust param off the URL (hash route untouched).
    if (/[?&]lu=/.test(loc.search) && root.history && root.history.replaceState) {
        var q = loc.search.replace(/[?&]lu=[^&]*/g, '').replace(/^&/, '?');
        try { root.history.replaceState(root.history.state, '', loc.pathname + q + loc.hash); } catch (e) { /* ignore */ }
    }
    root.App = root.App || {};
    root.App.LiveUpdate = {
        hold: lu.hold, release: lu.release, check: function () { return lu.check('manual'); },
        state: function () { return lu.st; }, decide: decide, isPending: isPending,
    };
    if (!lu.start()) return; // unstamped page (local dev): stay inert
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
        doc.addEventListener(ev, lu.touch, { passive: true, capture: true });
    });
    root.addEventListener('scroll', lu.touch, { passive: true, capture: true });
    doc.addEventListener('visibilitychange', function () {
        if (doc.visibilityState === 'hidden') lu.hide(); else lu.resume();
    });
    root.addEventListener('pagehide', function () { lu.hide(); });
    root.addEventListener('pageshow', function (e) { if (e.persisted) lu.resume(); });
    root.addEventListener('focus', lu.focus);
    root.addEventListener('online', function () { lu.check('online'); });
})(typeof window !== 'undefined' ? window : globalThis);
