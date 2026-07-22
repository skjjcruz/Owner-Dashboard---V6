/*  pro-gate.js — warroom-local Scout-free vs Pro gate helpers
 *
 *  One predicate, one chrome hook, one lock card:
 *   1. wrIsPro() — the ONLY condition new binary free-vs-Pro gates may use.
 *      Fail-open wrapper around shared tier.js isScoutPro(): if the tier
 *      chain is absent or throws (stale vendored copy, page without tier.js,
 *      odd embed contexts) the user is treated as Pro so nothing breaks.
 *      Trial counts as Pro (owner ruling 2026-07-05) — isScoutPro() is
 *      getTier() !== 'free' and trial !== 'free'. Never gate on
 *      window.canAccess (core.js hoists its own over it) or inline getTier().
 *   2. window._applyScoutProChrome — body class + wordmark chrome. Shared
 *      tier.js re-invokes this after loadUserTier() resolves the async server
 *      tier, so paid users never keep free chrome.
 *   3. wrLockCard() — warroom-styled lock card (HTML string) for
 *      innerHTML/vanilla surfaces. Do NOT use shared _tierGatePlaceholder in
 *      warroom: it styles with Scout CSS variables (--bg3/--border/--text)
 *      that warroom pages do not define.
 *
 *  Also the tier boot seam: kicks off loadUserTier() once per page. warroom
 *  never called it before, so in production every paying subscriber resolved
 *  trial-then-free and canAccess treated them as free.
 *
 *  Plain JS (no JSX/Babel). Script-tag AFTER the WRShared tier chain
 *  (reconai-shared tier.js), before any tab code that gates on wrIsPro().
 *  Loaded by index.html, free-agency.html, and draft-warroom.html.
 */
(function () {
  'use strict';

  // ── 1. The predicate ─────────────────────────────────────────────
  function wrIsPro() {
    try {
      // Owner/QA override accounts (core.js FULL_ACCESS_USERNAMES) are always
      // Pro even if their server profile tier is missing — otherwise the
      // account used most for QA split-brains: canAccess unlocked but Scout
      // chrome + free AI tripwire. Skipped under the localhost force-tier so
      // __DHQ_FORCE_TIER='free' QA still works on the owner account.
      var _host = window.location && window.location.hostname;
      var _forced = (_host === 'localhost' || _host === '127.0.0.1') && window.__DHQ_FORCE_TIER;
      if (!_forced) {
        try {
          var _u = window.OD && window.OD.getCurrentUsername ? window.OD.getCurrentUsername() : '';
          if (String(_u || '').toLowerCase() === 'bigloco') return true;
        } catch (_) { /* non-fatal */ }
      }
      if (typeof window.isScoutPro !== 'function') return true; // fail open
      return !!window.isScoutPro();
    } catch (_) {
      return true; // fail open
    }
  }
  window.wrIsPro = wrIsPro;

  // ── 2. Chrome: body class + wordmark ─────────────────────────────
  // Free wordmark = "DYNASTY HQ · SCOUT", driven by CSS on the elements that
  // carry .wr-wordmark (boot splash, hub header, league sidebar + skeleton
  // nav) so React re-renders keep it without any per-site JS. Keyed on
  // body.is-scout-free rather than body:not(.is-pro): the pre-resolve default
  // (no class at all) then renders the Pro wordmark, so a paying user never
  // flashes "· SCOUT" while loadUserTier() is in flight. Pro-only CSS should
  // scope to body.is-pro (reconai convention).
  var WR_PRO_GATE_CSS = '' +
    'body.is-scout-free .wr-wordmark::after{' +
      'content:" \\00B7 SCOUT";' +
      'font-size:.72em;' +
      'color:var(--silver,#98A1AD);' +
      'letter-spacing:.08em;' +
    '}' +
    // Pro mirror of the Scout suffix: gold "· PRO" after the wordmark, keyed on
    // body.is-pro so it only shows once the tier is confirmed Pro (never flashes
    // for a free user, whose pre-resolve default carries no class).
    'body.is-pro .wr-wordmark::after{' +
      'content:" \\00B7 PRO";' +
      'font-size:.72em;' +
      'color:var(--gold,#d4af37);' +
      'letter-spacing:.08em;' +
    '}';

  function _ensureProGateCss() {
    if (document.getElementById('wr-pro-gate-css')) return;
    var style = document.createElement('style');
    style.id = 'wr-pro-gate-css';
    style.textContent = WR_PRO_GATE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function _applyScoutProChrome() {
    try {
      _ensureProGateCss();
      if (!document.body) return;
      var pro = wrIsPro();
      document.body.classList.toggle('is-pro', pro);
      // Free chrome only AFTER the async server tier has resolved: a paying
      // subscriber whose 30-day local trial stamp has lapsed reads sync
      // getTier()='free' until the profile lands, and must not flash "· SCOUT"
      // on every boot.
      var resolved = !!(window.App && window.App._userTierResolved);
      document.body.classList.toggle('is-scout-free', !pro && resolved);
    } catch (_) { /* ignore */ }
  }
  window._applyScoutProChrome = _applyScoutProChrome;

  // ── 3. Lock card (vanilla/innerHTML surfaces) ────────────────────
  // Dense-terminal trim: slate layers, 1px border, near-zero radius, gold
  // structure accent + CTA (matches WrGatedMoreRow and the app's gold trim).
  // Hex fallbacks because the standalone pages define their own (different)
  // CSS variables.
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function wrLockCard(featureLabel, feature, sub) {
    var feat = String(feature || '').replace(/[^a-z0-9_\-]/gi, '');
    return '' +
      '<div class="wr-lock-card" style="background:var(--black,#121217);border:1px solid var(--charcoal,#27262E);border-left:3px solid var(--gold,#d4af37);border-radius:2px;padding:12px 14px;margin:8px 0">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span aria-hidden="true" style="font-size:0.9rem">🔒</span>' +
          '<span style="flex:1;font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--white,#E6E9ED)">' + _esc(featureLabel || 'Pro Feature') + '</span>' +
          '<span style="font-family:\'JetBrains Mono\',monospace;font-size:0.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--gold,#d4af37);border:1px solid rgba(212,175,55,.45);border-radius:2px;padding:1px 6px">Pro</span>' +
        '</div>' +
        (sub ? '<div style="font-size:0.8rem;color:var(--silver,#98A1AD);line-height:1.5;margin:8px 0 0 22px">' + _esc(sub) + '</div>' : '') +
        '<button onclick="if(window.showProLaunchPage){showProLaunchPage()}else if(window.showUpgradePrompt){showUpgradePrompt(\'' + feat + '\')}" ' +
          'style="display:block;margin:10px 0 0 22px;padding:6px 14px;background:var(--gold,#d4af37);color:#1a1000;border:none;border-radius:2px;font-family:\'JetBrains Mono\',monospace;font-size:0.72rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer">' +
          'Unlock with Pro' +
        '</button>' +
      '</div>';
  }
  window.wrLockCard = wrLockCard;

  // ── Boot ─────────────────────────────────────────────────────────
  // Apply chrome from the sync tier now (trial/paid resolve synchronously;
  // free chrome waits for the resolved flag below), then resolve the async
  // server tier. tier.js re-applies chrome inside loadUserTier(); the .then
  // re-applies once more with _userTierResolved set so genuinely-free users
  // get their chrome.
  _applyScoutProChrome();
  var _tierLoad = null;
  if (typeof window.loadUserTier === 'function') {
    try { _tierLoad = window.loadUserTier(); } catch (_) { /* ignore */ }
  }
  Promise.resolve(_tierLoad).catch(function () {}).then(function () {
    window.App = window.App || {};
    window.App._userTierResolved = true;
    _applyScoutProChrome();
    // Announce resolution: React surfaces that read getUserTier() during
    // their FIRST render (league picker banner/tiles) captured the
    // pre-resolution 'free' answer and never re-render on their own — a
    // Pro subscriber otherwise keeps seeing Scout copy until a reload.
    try { window.dispatchEvent(new CustomEvent('dhq:tier-resolved')); } catch (_) { /* ignore */ }
  });
})();
