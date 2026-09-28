'use strict';
// Unsigned test JWTs, same construction as js/shared/legacy-session.test.js
// (L29-48). The browser client never verifies signatures: supabase-client.js
// (_jwtClaims / _jwtExpired / _isLegacySessionToken), the index.html pre-paint
// gate (decodeJwt) and landing.html (jwtExpired) only base64-decode the payload
// to read exp / app_metadata. Signatures are checked server-side, and the
// server is stubbed here, so the "sig" segment is a fixed placeholder.

const SUPABASE_REF = 'sxshiqyxhhifvtfqawbq';
const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function jwt(claims) {
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url(claims) + '.sig';
}
function decode(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch { return null; }
}

// App-account session JWT, claim shape of _shared/entitlements.ts mintAppSessionJWT.
function accountToken(acct, { iat, exp } = {}) {
  const i = iat || nowS();
  return jwt({
    iss: `https://${SUPABASE_REF}.supabase.co/auth/v1`,
    sub: acct.id,
    role: 'authenticated',
    iat: i,
    exp: exp || i + 7 * DAY,
    app_metadata: {
      user_id: acct.id,
      email: acct.email,
      tier: 'free',
      products: ['war_room', 'dynast_hq'],
      session_version: acct.sessionVersion,
    },
  });
}

// Legacy Sleeper-username JWT, claim shape of get-session-token (7-day TTL).
function legacyToken(username, { exp, iat } = {}) {
  const e = exp || nowS() + 7 * DAY;
  return jwt({ iss: 'supabase', ref: SUPABASE_REF, role: 'anon', iat: iat || e - 7 * DAY, exp: e, sub: username, app_metadata: { sleeper_username: username, is_gifted: false } });
}

// Supabase Auth (GoTrue) access token for an OAuth user.
function supabaseAccessToken(authUser) {
  const i = nowS();
  return jwt({
    iss: `https://${SUPABASE_REF}.supabase.co/auth/v1`,
    sub: authUser.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: authUser.email,
    iat: i,
    exp: i + 3600,
    app_metadata: { provider: authUser.provider || 'google', providers: [authUser.provider || 'google'] },
    user_metadata: { full_name: authUser.name || authUser.email },
  });
}

module.exports = { jwt, decode, accountToken, legacyToken, supabaseAccessToken, nowS, DAY, SUPABASE_REF, b64url };
