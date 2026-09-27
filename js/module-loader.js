// ══════════════════════════════════════════════════════════════════
// module-loader.js — generic lazy-loader for deferred module groups.
// Heavy feature modules are emitted INERT in the HTML (type="text/wr-deferred",
// data-wr-defer="<group>") by every build/serve pipeline, so the browser never
// parses or executes them at app boot. On first use (e.g. a tab open) the owning
// surface calls window.wrLoadModuleGroup('<group>'), which injects executable
// copies in DOM order. Groups: draft (~28 scripts, ~1.26MB), trade, fa,
// analysis (league-map + analytics, which embeds LeagueMapTab), alex, compare,
// trophies, empire.
//
// Execution within a group must be IN ORDER (e.g. 11 draft modules destructure
// window.DraftCC.styles at IIFE entry, so styles.js must run before them). All
// tags are injected at once with async=false — the browser fetches them in
// parallel but the in-order queue guarantees they execute in DOM order.
//
// Raw dev mode (serve-static without --compile) leaves the tags as
// type="text/babel"; Babel standalone executes them at boot, so there is
// nothing to inject and the loader resolves immediately.
//
// Bad signal (C2 port, 2026-09-27):
//   - STALL timer: the promise rejects when NO script of the group has
//     finished for STALL_MS (reset on every script that lands), so a slow but
//     moving download is never cut off, and a dead one turns into the retry UI.
//   - A rejected group is forgotten, so "Try again" re-requests it instead of
//     replaying the old failure until the app restarts.
//   - A group that still completes after its promise gave up (the stalled
//     request finally answered) is marked loaded and fires
//     'wr:module-group-loaded' like any other load — surfaces listen for that
//     event and recover without a tap.
//   - A script that fails — network error, OR it threw while starting (a
//     window 'error' whose filename is that script) — poisons everything
//     after it in the group: those scripts ran without their predecessor
//     (e.g. 11 draft modules destructure window.DraftCC.styles at startup).
//     "Try again" therefore re-runs the failed script PLUS every later script
//     of the group, in order. Scripts that ran successfully BEFORE the failure
//     are never run twice, and tags still in flight are waited for, never
//     duplicated (the retry injects the tail only after they settle).
//     A file with top-level const/let/class can't be evaluated twice in one
//     page (the engine refuses before running any of it): if its first run
//     succeeded that first run stands; if it had crashed, the group error
//     carries reloadRequired — only a page reload can redo it.
//   - A retry after a pure stall joins the still-queued tags.
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var promises = {};
  // src -> true once the script has executed WITHOUT throwing at startup.
  // Scripts before a group's failure point are skipped on retry — re-running
  // an IIFE that already ran would double-register its listeners and reset
  // its module state.
  var executed = {};
  // src -> promise for a tag that is still in the browser's in-order queue.
  var inflight = {};
  // group -> index of the earliest script that failed (load error or startup
  // throw). Everything from there on is re-run by the next attempt. Cleared
  // once the group completes.
  var failedAt = {};
  // absolute script URL -> src key, for tags between insertion and onload;
  // and the startup throws seen for them.
  var pendingUrl = {};
  var threwUrl = {};
  // A stalled request (no load, no error) is the common mobile failure: cellular
  // drops the connection and the browser never settles the tag. 45s with no
  // script finishing is a dead pipe, not a slow one (the timer restarts on
  // every script that lands).
  var STALL_MS = 45000;
  // Chrome/Edge, Firefox, Safari wording for a repeated top-level declaration.
  var REDECLARE = /already been declared|redeclaration of|duplicate variable/i;

  window.__wrModuleGroupsLoaded = {};
  window.__wrDraftLoaded = false; // legacy flag, kept in sync for the draft group

  window.wrModuleGroupLoaded = function wrModuleGroupLoaded(name) {
    return !!window.__wrModuleGroupsLoaded[name];
  };

  // A classic script that throws at top level reports a window 'error' whose
  // filename is the script URL, just before its load event. Same-origin
  // bundles only (cross-origin throws arrive as an anonymous "Script error.").
  try {
    window.addEventListener('error', function (e) {
      var f = e && e.filename;
      if (!f || !pendingUrl[f]) return;
      var msg = String((e.message || (e.error && e.error.message)) || 'error');
      if (!threwUrl[f]) threwUrl[f] = msg;
      // The expected refusal to re-evaluate a file that already ran fine is
      // not a crash: keep it out of the crash reporters (capture phase runs
      // before their listeners) and the console.
      if (executed[pendingUrl[f]] && REDECLARE.test(msg)) {
        try { e.stopImmediatePropagation(); e.preventDefault(); } catch (x) {}
      }
    }, true);
  } catch (e) {}

  // Idempotent: the first completion marks the group and announces it once.
  function markLoaded(name) {
    if (window.__wrModuleGroupsLoaded[name]) return;
    window.__wrModuleGroupsLoaded[name] = true;
    if (name === 'draft') window.__wrDraftLoaded = true;
    try {
      window.dispatchEvent(new CustomEvent('wr:module-group-loaded', { detail: { group: name } }));
      if (name === 'draft') window.dispatchEvent(new Event('wr:draft-loaded'));
    } catch (e) {}
  }

  function noteFailure(name, idx) {
    if (failedAt[name] == null || idx < failedAt[name]) failedAt[name] = idx;
  }

  // Inject one deferred script, or join the tag already queued for it.
  function loadScript(src) {
    if (inflight[src]) return inflight[src];
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false; // parallel fetch, in-order execution
      var url = s.src || src; // the browser resolves .src to the absolute URL
      pendingUrl[url] = src;
      function forget() { delete inflight[src]; delete pendingUrl[url]; }
      s.onload = function () {
        var threw = threwUrl[url];
        delete threwUrl[url];
        forget();
        if (threw) {
          // Re-running a file that declares top-level const/let/class (e.g.
          // draft-room.js, trade-calc.js, free-agency.js) is refused by the
          // engine before any of it runs ("already been declared"): its first
          // run is still in place. If that first run succeeded, the file is
          // fine as it is; if it had crashed, only a page reload can redo it.
          if (executed[src] && REDECLARE.test(threw)) { resolve(); return; }
          var err = new Error('Deferred script threw while starting: ' + src + ' (' + threw + ')');
          if (REDECLARE.test(threw)) err.reloadRequired = true;
          executed[src] = false;
          reject(err);
          return;
        }
        executed[src] = true;
        resolve();
      };
      s.onerror = function () {
        delete threwUrl[url];
        forget();
        try { if (s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
        reject(new Error('Deferred script failed to load: ' + src));
      };
      document.head.appendChild(s);
    });
    inflight[src] = p;
    return p;
  }

  window.wrLoadModuleGroup = function wrLoadModuleGroup(name) {
    if (promises[name]) return promises[name];
    if (window.__wrModuleGroupsLoaded[name]) {
      promises[name] = Promise.resolve();
      return promises[name];
    }
    var p = new Promise(function (resolve, reject) {
      var tags = Array.prototype.slice.call(
        document.querySelectorAll('script[data-wr-defer="' + name + '"]')
      );
      var settled = false;
      var timer = null;

      function stopTimer() { if (timer) { clearTimeout(timer); timer = null; } }
      function armTimer() {
        stopTimer();
        if (settled) return;
        timer = setTimeout(function () {
          fail(new Error('Module group "' + name + '" stalled: nothing arrived for ' + STALL_MS + 'ms'));
        }, STALL_MS);
      }

      function fail(err) {
        if (settled) return;
        settled = true;
        stopTimer();
        reject(err);
      }

      // Runs even after the promise gave up: a late group still counts.
      function complete() {
        delete failedAt[name];
        markLoaded(name);
        if (settled) return;
        settled = true;
        stopTimer();
        resolve();
      }

      // Only type="text/wr-deferred" tags are inert. Anything else (raw dev mode's
      // text/babel, or a pipeline that didn't defer) already executed at boot.
      var srcs = tags.filter(function (tag) {
        return (tag.getAttribute('type') || '').toLowerCase() === 'text/wr-deferred';
      }).map(function (tag) { return tag.getAttribute('src'); }).filter(Boolean);

      if (!srcs.length) return complete();

      armTimer();

      function run() {
        var from = failedAt[name];
        var rerunFrom = from == null ? srcs.length : from;
        // Count completions instead of hanging the resolve off the last tag's
        // onload: a counter still settles correctly when scripts are skipped.
        var remaining = srcs.length;
        function oneDone() {
          if (--remaining === 0) complete();
          else armTimer(); // progress: restart the stall clock
        }
        srcs.forEach(function (src, idx) {
          if (idx < rerunFrom && executed[src]) { oneDone(); return; }
          loadScript(src).then(oneDone, function (err) {
            noteFailure(name, idx);
            var groupErr = new Error('Module group "' + name + '" failed to load: ' + ((err && err.message) || src));
            // Only a page reload can recover this group (callers may show just "Reload").
            if (err && err.reloadRequired) groupErr.reloadRequired = true;
            fail(groupErr);
          });
        });
      }

      // Re-running the tail after a failure: tags of that tail still in the
      // browser's queue would execute BEFORE the re-injected failed script, so
      // let them settle first (never inject twins), then run the tail in order.
      var from = failedAt[name];
      var busy = from == null ? [] : srcs.slice(from).filter(function (src) { return inflight[src]; });
      if (!busy.length) { run(); return; }
      var ok = function () { armTimer(); };
      Promise.all(busy.map(function (src) { return inflight[src].then(ok, ok); })).then(function () {
        if (!settled) run();
      });
    });
    // Never let one dropped request poison the session: a rejected promise is
    // forgotten so a retry actually retries.
    p.catch(function () { if (promises[name] === p) delete promises[name]; });
    promises[name] = p;
    return p;
  };

  // Back-compat alias for the original draft-only loader.
  window.wrLoadDraft = function wrLoadDraft() {
    return window.wrLoadModuleGroup('draft');
  };
})();
