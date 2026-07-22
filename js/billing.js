/*
 * js/billing.js — Dynasty HQ billing shim (WEB-ONLY build)
 *
 * This repo ships the web app only. All purchases on the web go through
 * Stripe via the existing edge functions (fw-create-checkout /
 * fw-billing-portal) — see upgrade.html and js/settings.js. Apple In-App
 * Purchase lives exclusively in the separate iOS app repo; its webhook
 * writes the SAME public.subscriptions rows the Stripe webhook writes, so
 * entitlements stay unified server-side no matter where the user
 * subscribed.
 *
 * This module keeps the exact public API surface of the native-aware
 * original (window.DHQBilling) so index.html / upgrade.html / settings
 * keep working unchanged:
 *   available()      -> always false on web (no in-app purchase here)
 *   isNative()       -> always false
 *   identify()       -> resolves false (nothing to identify on web)
 *   purchase()       -> { ok:false, error } (callers fall back to Stripe)
 *   restore()        -> { ok:false, error } (App Store concept only)
 *   remintSession()  -> real implementation — re-mints the fw_session JWT
 *                       after a payment so the fresh Pro tier lands
 *   _nativeResult()  -> no-op (bridge callback that only the iOS shell calls)
 */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://sxshiqyxhhifvtfqawbq.supabase.co';
  const SESSION_KEY = 'fw_session_v1';

  function isNative() { return false; }
  function available() { return false; }

  async function identify() { return false; }

  // ── Session re-mint after a purchase ───────────────────────────
  // The stored JWT was minted before the purchase and still carries the old
  // tier. The Stripe webhook writes the subscription within seconds of the
  // payment; retry the re-mint briefly until the pro tier lands.
  async function remintSession() {
    for (const delayMs of [0, 4000, 10000]) {
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      try {
        const cur = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        if (!cur?.token) return false;
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/fw-refresh-session`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cur.token}` },
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data?.token && data?.user?.id) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(
            Object.assign({}, cur, { token: data.token, user: Object.assign({}, cur.user || {}, data.user) })
          ));
          if (data.user.tier === 'pro') return true;
        }
      } catch { /* transient — next attempt */ }
    }
    return false;
  }

  // In-app purchase never exists on the web build — callers detect this via
  // available() and route to the Stripe checkout flow instead.
  async function purchase() {
    return { ok: false, error: 'In-app purchase is only available in the iOS app. Use the secure Stripe checkout instead.' };
  }

  async function restore() {
    return { ok: false, error: 'Restore Purchases is only available in the iOS app.' };
  }

  function _nativeResult() { /* no-op on web — iOS shell bridge callback */ }

  window.DHQBilling = { available, isNative, identify, purchase, restore, remintSession, _nativeResult };
})();
