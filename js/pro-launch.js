// ══════════════════════════════════════════════════════════════════
// js/pro-launch.js — Pro upgrade entry point
// Owner ruling 2026-07-13: the full-screen pro-launch overlay is retired.
// Every upgrade tap goes straight to upgrade.html (billing picker → Stripe
// via fw-create-checkout, or Apple IAP when native). The showProLaunchPage /
// hideProLaunchPage / handleSubscribe exports stay because a dozen feature
// gates call them behind `if (window.showProLaunchPage)` guards.
// ══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Checkout runs through upgrade.html, which needs the user's session
  // token — a static payment link can't attach the subscription to the
  // right account.
  const CHECKOUT_URL = 'upgrade.html';
  const INTEREST_KEY = 'dhq_pro_interest';

  function goToUpgrade() {
    // Record conversion intent so we can follow up
    try {
      const entry = { ts: Date.now(), tier: typeof getTier === 'function' ? getTier() : 'unknown' };
      localStorage.setItem(INTEREST_KEY, JSON.stringify(entry));
    } catch {}
    window.OD?.track?.('checkout_started', {
      platform: 'reconai',
      module: 'upgrade',
      entityType: 'product',
      entityId: 'war_room',
      metadata: { source: 'pro_launch', tier: typeof getTier === 'function' ? getTier() : 'unknown' },
    });
    window.location.href = CHECKOUT_URL;
  }

  function showProLaunchPage() { goToUpgrade(); }
  function hideProLaunchPage() { /* nothing to hide — the overlay is gone */ }
  function handleSubscribe() { goToUpgrade(); }

  window.showProLaunchPage  = showProLaunchPage;
  window.hideProLaunchPage  = hideProLaunchPage;
  window.handleSubscribe    = handleSubscribe;
  window.App = window.App || {};
  window.App.showProLaunchPage = showProLaunchPage;
  window.App.hideProLaunchPage = hideProLaunchPage;
  window.App.handleSubscribe   = handleSubscribe;
})();
