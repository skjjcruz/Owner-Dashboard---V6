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
// Bad signal (C2 port, 2026-09-27): a group that has not finished after
// GROUP_TIMEOUT_MS rejects, and a rejected group is forgotten, so the caller's
// "Try again" re-requests it instead of replaying the old failure until the
// app restarts. Retries only re-inject scripts that never ran.
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var promises = {};
  // src -> true once the script has run AFTER every earlier script of its group
  // ran. A retry skips these — re-running an IIFE that already ran would
  // double-register its listeners and reset its module state.
  var executed = {};
  // src -> promise for a tag that is still in the browser's in-order queue.
  // After a timeout the stalled tag is still queued, and every async=false
  // script injected later waits behind it anyway. A retry therefore waits on
  // the existing tag instead of injecting a twin that would run the module a
  // second time when the slow original finally lands.
  var inflight = {};
  // A stalled request (no load, no error) is the common mobile failure: cellular
  // drops the connection and the browser never settles the tag. Without a
  // deadline the tab sits on "Loading …" forever. 45s clears a cold 1.26MB draft
  // group on slow 3G with room to spare, and converts a hang into the retry UI.
  var GROUP_TIMEOUT_MS = 45000;

  window.__wrModuleGroupsLoaded = {};
  window.__wrDraftLoaded = false; // legacy flag, kept in sync for the draft group

  window.wrModuleGroupLoaded = function wrModuleGroupLoaded(name) {
    return !!window.__wrModuleGroupsLoaded[name];
  };

  // Inject one deferred script (or join the tag already queued for it).
  // `ranInOrder` says whether every earlier script of the group has run; a
  // script that ran after a predecessor failed may have crashed at IIFE entry,
  // so it is not marked executed and the next attempt runs it again, in order.
  function loadScript(src, ranInOrder) {
    if (inflight[src]) return inflight[src];
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false; // parallel fetch, in-order execution
      s.onload = function () {
        delete inflight[src];
        if (ranInOrder()) { executed[src] = true; resolve(); }
        else reject(new Error('Deferred script ran out of order: ' + src));
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
    var p = new Promise(function (resolve, reject) {
      var tags = Array.prototype.slice.call(
        document.querySelectorAll('script[data-wr-defer="' + name + '"]')
      );
      var settled = false;
      var timer = null;

      function fail(err) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      }

      function done() {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        window.__wrModuleGroupsLoaded[name] = true;
        if (name === 'draft') window.__wrDraftLoaded = true;
        try {
          window.dispatchEvent(new CustomEvent('wr:module-group-loaded', { detail: { group: name } }));
          if (name === 'draft') window.dispatchEvent(new Event('wr:draft-loaded'));
        } catch (e) {}
        resolve();
      }

      // Only type="text/wr-deferred" tags are inert. Anything else (raw dev mode's
      // text/babel, or a pipeline that didn't defer) already executed at boot.
      var srcs = tags.filter(function (tag) {
        return (tag.getAttribute('type') || '').toLowerCase() === 'text/wr-deferred';
      }).map(function (tag) { return tag.getAttribute('src'); }).filter(Boolean);

      if (!srcs.length) return done();

      timer = setTimeout(function () {
        fail(new Error('Module group "' + name + '" timed out after ' + GROUP_TIMEOUT_MS + 'ms'));
      }, GROUP_TIMEOUT_MS);

      // Count completions instead of hanging the resolve off the last tag's
      // onload: a counter still settles correctly when a retry skips tags that
      // ran on the first pass.
      var remaining = srcs.length;
      function oneDone() { if (--remaining === 0) done(); }
      srcs.forEach(function (src, idx) {
        if (executed[src]) { oneDone(); return; }
        var ranInOrder = function () {
          for (var i = 0; i < idx; i++) if (!executed[srcs[i]]) return false;
          return true;
        };
        loadScript(src, ranInOrder).then(oneDone, function (err) {
          fail(new Error('Module group "' + name + '" failed to load: ' + ((err && err.message) || src)));
        });
      });
    });
    // Never let one dropped request poison the session. The memoised promise
    // used to survive a rejection, so after a single flaky fetch every later
    // attempt on that tab returned the same failure and only a full page reload
    // recovered. Dropping the cache makes a retry actually retry.
    p.catch(function () { if (promises[name] === p) delete promises[name]; });
    promises[name] = p;
    return p;
  };

  // Back-compat alias for the original draft-only loader.
  window.wrLoadDraft = function wrLoadDraft() {
    return window.wrLoadModuleGroup('draft');
  };
})();
