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
// ══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var promises = {};
  window.__wrModuleGroupsLoaded = {};
  window.__wrDraftLoaded = false; // legacy flag, kept in sync for the draft group

  window.wrModuleGroupLoaded = function wrModuleGroupLoaded(name) {
    return !!window.__wrModuleGroupsLoaded[name];
  };

  window.wrLoadModuleGroup = function wrLoadModuleGroup(name) {
    if (promises[name]) return promises[name];
    promises[name] = new Promise(function (resolve, reject) {
      var tags = Array.prototype.slice.call(
        document.querySelectorAll('script[data-wr-defer="' + name + '"]')
      );

      function done() {
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

      srcs.forEach(function (src, idx) {
        var s = document.createElement('script');
        s.src = src;
        s.async = false; // parallel fetch, in-order execution
        if (idx === srcs.length - 1) s.onload = done; // last script runs last
        s.onerror = function () {
          reject(new Error('Module group "' + name + '" failed to load: ' + src));
        };
        document.head.appendChild(s);
      });
    });
    return promises[name];
  };

  // Back-compat alias for the original draft-only loader.
  window.wrLoadDraft = function wrLoadDraft() {
    return window.wrLoadModuleGroup('draft');
  };
})();
