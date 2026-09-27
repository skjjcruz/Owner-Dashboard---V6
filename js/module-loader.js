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
//   - Retries re-inject only scripts that never ran, and join tags that are
//     still queued instead of injecting twins.
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var promises = {};
  // src -> true once the script has executed. A retry skips these — re-running
  // an IIFE that already ran would double-register its listeners and reset its
  // module state.
  var executed = {};
  // src -> promise for a tag that is still in the browser's in-order queue.
  // After a stall the tag is still queued, and every async=false script
  // injected later waits behind it anyway. A retry therefore waits on the
  // existing tag instead of injecting a twin that would run the module a
  // second time when the slow original finally lands.
  var inflight = {};
  // A stalled request (no load, no error) is the common mobile failure: cellular
  // drops the connection and the browser never settles the tag. 45s with no
  // script finishing is a dead pipe, not a slow one (the timer restarts on
  // every script that lands).
  var STALL_MS = 45000;

  window.__wrModuleGroupsLoaded = {};
  window.__wrDraftLoaded = false; // legacy flag, kept in sync for the draft group

  window.wrModuleGroupLoaded = function wrModuleGroupLoaded(name) {
    return !!window.__wrModuleGroupsLoaded[name];
  };

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

  // Inject one deferred script, or join the tag already queued for it.
  function loadScript(src) {
    if (inflight[src]) return inflight[src];
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false; // parallel fetch, in-order execution
      s.onload = function () {
        delete inflight[src];
        executed[src] = true;
        resolve();
      };
      s.onerror = function () {
        delete inflight[src];
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

      // Count completions instead of hanging the resolve off the last tag's
      // onload: a counter still settles correctly when a retry skips tags that
      // ran on the first pass.
      var remaining = srcs.length;
      function oneDone() {
        if (--remaining === 0) complete();
        else armTimer(); // progress: restart the stall clock
      }
      srcs.forEach(function (src) {
        if (executed[src]) { oneDone(); return; }
        loadScript(src).then(oneDone, function (err) {
          fail(new Error('Module group "' + name + '" failed to load: ' + ((err && err.message) || src)));
        });
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
