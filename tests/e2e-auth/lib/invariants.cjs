'use strict';
// Invariants I1–I6 from the audit (section 6), as reusable assertions.
//   I1  final state within 8 s, nothing still "Loading"     → App.expectFinal
//   I2  no key belonging to a different owner survives a sign-in
//   I3  the server handle equals the local handle after any connect
//   I4  wr_guest_v1 is absent whenever fw_session_v1 holds an account
//   I5  no redirect loop (> 3 navigations without user input) → App.expectFinal
//   I6  sign-out leaves only device keys (no identity / session keys)

const { decode } = require('./jwt.cjs');

// Keys that carry who the user is. I2 scans these for another owner's
// markers; I6 requires them gone after sign-out. (DEVICE_KEEP_KEYS is not
// spelled out in the fix design; this deny-list is the guessed complement —
// see README "Guessed assertions".)
const IDENTITY_KEYS = [
  'fw_session_v1', 'od_session_v1', 'od_auth_v1', 'od_profile_v1', 'od_locked_username_v2',
  'wr_guest_v1', 'dhq_identity_v1', 'mfl_league_id', 'mfl_year', 'mfl_franchise_id',
  'espn_league_id', 'espn_year', 'espn_team_id', 'od_display_name', 'dhq_owner_club_v1',
];
const SECRET_KEYS = ['espn_s2', 'espn_swid', 'mfl_api_key', 'mfl_write_cookie', 'mfl_write_host', 'yahoo_session_id',
  'dynastyhq_ai_key', 'dynastyhq_xai_key', 'dynastyhq_gemini_key', 'dynastyhq_anthropic_key', 'dynastyhq_apikey'];
const SB_KEYS = ['sb-sxshiqyxhhifvtfqawbq-auth-token', 'sb-sxshiqyxhhifvtfqawbq-auth-token-code-verifier', 'sb-sxshiqyxhhifvtfqawbq-auth-token-user'];

function parse(v) { try { return JSON.parse(v); } catch { return v; } }

// The Sleeper handle the device currently holds, in any of the shapes the
// code base writes (dhq_identity_v1 from the fix design, both od_auth_v1
// shapes, the profile copy).
function localHandleFrom(local) {
  const id = parse(local.dhq_identity_v1);
  if (id && typeof id === 'object' && id.sleeper) return typeof id.sleeper === 'string' ? id.sleeper : (id.sleeper.username || null);
  const auth = parse(local.od_auth_v1);
  if (auth && typeof auth === 'object' && (auth.sleeperUsername || auth.username)) return auth.sleeperUsername || auth.username;
  const prof = parse(local.od_profile_v1);
  if (prof && typeof prof === 'object' && prof.sleeperUsername) return prof.sleeperUsername;
  return null;
}

function accountInSession(local) {
  const s = parse(local.fw_session_v1);
  if (!s || typeof s !== 'object' || !s.token) return null;
  const meta = (decode(s.token) || {}).app_metadata || {};
  return meta.user_id || (s.user && s.user.id) || null;
}

// ── I1 helpers (used by App.expectFinal) ────────────────────────
function stateMismatches(p, want) {
  const r = [];
  if (!p) return ['no page'];
  if (want.page && p.kind !== want.page) r.push(`page is ${p.kind}, want ${want.page}`);
  if (p.preboot && p.kind !== 'hub') r.push('page still hidden (pre-paint gate)');
  if (p.loading) r.push('still showing a loading indicator');
  if (want.page === 'hub' && !p.hubReady) r.push('hub not rendered yet');
  if (want.leagues) {
    const got = [...p.leagues].sort().join(' | '); const exp = [...want.leagues].sort().join(' | ');
    if (got !== exp) r.push(`leagues shown [${got}] want exactly [${exp}]`);
  }
  for (const n of want.includes || []) if (!p.leagues.includes(n)) r.push(`missing "${n}"`);
  for (const n of want.excludes || []) if (p.leagues.includes(n)) r.push(`must not show "${n}"`);
  if (want.sheet !== undefined && p.sheetOpen !== want.sheet) r.push(`sign-in sheet ${p.sheetOpen ? 'open' : 'closed'}, want ${want.sheet ? 'open' : 'closed'}`);
  if (want.sheetMode && p.sheetMode !== want.sheetMode) r.push(`sheet mode ${p.sheetMode}, want ${want.sheetMode}`);
  if (want.search && !want.search.test(p.search || '')) r.push(`location.search "${p.search}" !~ ${want.search}`);
  if (want.text && !want.text.test(p.text || '')) r.push(`text !~ ${want.text}`);
  if (want.noText && want.noText.test(p.text || '')) r.push(`text ~ ${want.noText} (must not)`);
  if (want.hubConnect !== undefined && p.hubConnect !== want.hubConnect) r.push(`hub connect card ${p.hubConnect ? 'shown' : 'hidden'}`);
  return r;
}
function describeWant(w) {
  const parts = [w.page || 'any page'];
  if (w.leagues) parts.push(`leagues=[${w.leagues.join(', ')}]`);
  if (w.includes) parts.push(`incl=[${w.includes.join(', ')}]`);
  if (w.excludes) parts.push(`excl=[${w.excludes.join(', ')}]`);
  if (w.sheet !== undefined) parts.push('sheet=' + w.sheet);
  if (w.search) parts.push('search~' + w.search);
  if (w.text) parts.push('text~' + w.text);
  return parts.join(' ');
}
function describeState(p) {
  if (!p) return '(none)';
  return `${p.kind} ${p.url} leagues=[${p.leagues.join(', ')}] loading=${p.loading} sheet=${p.sheetOpen} hubConnect=${p.hubConnect} text="${String(p.text || '').replace(/\s+/g, ' ').slice(0, 220)}"`;
}

// ── I2 ─────────────────────────────────────────────────────────
// markers: strings that identify the previous owner (handle, email, account
// id, league ids). Throws naming the key that still carries one.
async function expectNoForeignIdentity(app, markers, { label = 'after sign-in' } = {}) {
  const { local, session } = await app.storage();
  const hits = [];
  const ms = markers.filter(Boolean).map(m => String(m).toLowerCase());
  for (const k of IDENTITY_KEYS.concat(['dynastyhq_username'])) {
    const v = local[k];
    if (v == null) continue;
    for (const m of ms) if (String(v).toLowerCase().includes(m)) hits.push(`localStorage.${k} contains "${m}"`);
  }
  for (const k of SECRET_KEYS) if (session[k] != null || local[k] != null) hits.push(`${k} (secret) survived`);
  if (hits.length) throw new Error(`I2 ${label}: previous owner's data survived:\n  ${hits.join('\n  ')}`);
}

// ── I3 ─────────────────────────────────────────────────────────
async function expectServerHandleMatchesLocal(app, acct, expected) {
  const { local } = await app.storage();
  const localHandle = localHandleFrom(local);
  const serverHandle = app.backend.serverHandle(acct);
  if (!serverHandle || !localHandle || serverHandle.toLowerCase() !== localHandle.toLowerCase() || (expected && serverHandle.toLowerCase() !== expected.toLowerCase())) {
    const posts = app.backend.calls('fw-profile', 'POST').map(c => `${c.status}${c.committed === false ? '(client-aborted)' : ''}`);
    throw new Error(`I3: server handle "${serverHandle}" != local handle "${localHandle}"${expected ? ` (expected "${expected}")` : ''}; fw-profile POSTs: [${posts.join(', ') || 'none'}]`);
  }
}

// ── I4 ─────────────────────────────────────────────────────────
async function checkI4(app) {
  let st;
  try { st = await app.storage(); } catch { return; }
  if (accountInSession(st.local) && st.local.wr_guest_v1 != null) {
    throw new Error(`I4: wr_guest_v1="${st.local.wr_guest_v1}" is set while fw_session_v1 holds account ${accountInSession(st.local)}`);
  }
}

// ── I6 ─────────────────────────────────────────────────────────
async function expectSignedOutClean(app, { label = 'after sign-out' } = {}) {
  const { local, session } = await app.storage();
  const left = [];
  for (const k of IDENTITY_KEYS) {
    if (local[k] == null) continue;
    if (k === 'od_profile_v1') {
      const p = parse(local[k]) || {};
      if (p.sleeperUsername || p.onboardingComplete === true) left.push(`od_profile_v1 still holds ${p.sleeperUsername ? 'sleeperUsername=' + p.sleeperUsername : 'onboardingComplete=true'}`);
      continue;
    }
    left.push(k);
  }
  for (const k of SB_KEYS) if (local[k] != null) left.push(k);
  for (const k of SECRET_KEYS) if (local[k] != null || session[k] != null) left.push(k);
  if (left.length) throw new Error(`I6 ${label}: signed-in state left behind: ${left.join(', ')}`);
}

module.exports = {
  IDENTITY_KEYS, SECRET_KEYS, SB_KEYS, localHandleFrom, accountInSession,
  stateMismatches, describeWant, describeState,
  expectNoForeignIdentity, expectServerHandleMatchesLocal, checkI4, expectSignedOutClean,
};
