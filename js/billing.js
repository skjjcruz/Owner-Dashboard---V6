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

  // Pin each operation to its initiating credential. A storage event also
  // invalidates an operation if another tab replaces the session with the same
  // bytes; neither a delayed refresh nor a retry may adopt a different account.
  let sessionVersion = 0;
  window.addEventListener('storage', event => {
    if (event.key === SESSION_KEY || event.key === null) sessionVersion++;
  });
  // This is a client consistency check, not signature verification. The
  // server authenticates every request; do not send A's token while displaying
  // B's cached profile, or save a response whose token contradicts its user.
  function tokenMatchesUser(token, userId) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const claims = JSON.parse(window.atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return claims.app_metadata?.user_id === userId && claims.sub === userId;
    } catch { return false; }
  }
  function captureSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const value = JSON.parse(raw || 'null');
      if (typeof value?.token !== 'string' || !value.token || typeof value?.user?.id !== 'string' || !value.user.id || !tokenMatchesUser(value.token, value.user.id)) return null;
      return { raw, token: value.token, userId: value.user.id, version: sessionVersion };
    } catch { return null; }
  }
  function isCurrentSession(context) {
    try { return !!context && context.version === sessionVersion && localStorage.getItem(SESSION_KEY) === context.raw; }
    catch { return false; }
  }

  // Bound the body read as well as the headers. Even a stalled connection must
  // leave a usable retry; late responses have no continuation that can save.
  async function requestJson(url, init = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, { ...init, signal: controller.signal });
          let data;
          try { data = await response.json(); } catch (error) { if (response.ok) throw error; }
          return { response, data };
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('The request timed out. Its result is not confirmed yet.'));
        }, timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  // Only a saved, same-account server response confirms access. A checkout
  // return URL is not payment or entitlement evidence. Preserve recoverable
  // credentials on outages and never clear a newer account on authorization
  // failure. Callers can distinguish a confirmed free tier from no response.
  async function remintSession(context = captureSession()) {
    for (const delayMs of [0, 4000, 10000]) {
      if (!isCurrentSession(context)) return false;
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      if (!isCurrentSession(context)) return false;
      try {
        const { response, data } = await requestJson(`${SUPABASE_URL}/functions/v1/fw-refresh-session`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${context.token}` },
        });
        if (!isCurrentSession(context)) return false;
        if (!response.ok) {
          if (response.status === 401) { context.authRejected = true; return false; }
          continue;
        }
        if (typeof data?.token !== 'string' || !data.token || data?.user?.id !== context.userId || !['free', 'pro'].includes(data.user.tier) || !tokenMatchesUser(data.token, context.userId)) return false;
        const current = JSON.parse(context.raw);
        const updated = JSON.stringify({ ...current, token: data.token, user: { ...current.user, ...data.user } });
        localStorage.setItem(SESSION_KEY, updated);
        context.raw = updated;
        context.token = data.token;
        context.confirmedTier = data.user.tier;
        if (data.user.tier === 'pro') return true;
      } catch { /* A failed request or save leaves explicit recovery available. */ }
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

  window.DHQBilling = { available, isNative, identify, purchase, restore, captureSession, isCurrentSession, requestJson, remintSession, _nativeResult };
})();
