'use strict';
// In-memory fake of every network dependency the sign-in lifecycle touches.
// One FakeBackend per test (no shared state between tests). Installed with
// context.route('**/*'), so every page of the context (including "relaunched"
// pages) talks to the same server store.
//
//   Supabase functions  fw-signin, fw-signup, fw-oauth-sync, fw-refresh-session,
//                       fw-profile GET/POST, get-session-token, fw-delete-account,
//                       fw-change-password, ai-analyze, mfl-proxy, espn-proxy, …
//   Supabase /auth/v1   authorize (OAuth round trip), user, logout, token
//   Supabase /rest/v1   analytics_events and everything else (empty 200s)
//   api.sleeper.app     deterministic users / leagues (lib/data.cjs)
//   MFL, ESPN           deterministic leagues
//   fonts / CDNs        empty responses
//   anything else       aborted and recorded in backend.unstubbed
//
// Request shapes and response shapes mirror the real code:
//   reconai-shared/supabase-client.js, landing.html, connect-sleeper.html,
//   login.html and supabase/functions/* in the app repo.

const { accountToken, legacyToken, supabaseAccessToken, decode, nowS } = require('./jwt.cjs');
const data = require('./data.cjs');

const SUPABASE_HOST = 'sxshiqyxhhifvtfqawbq.supabase.co';

function cors(req) {
  const origin = (req && req.headers && req.headers()['origin']) || '*';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, prefer, accept, accept-profile, content-profile, range, x-supabase-api-version',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-expose-headers': 'content-range',
  };
}

let _seq = 0;

class FakeBackend {
  constructor() {
    this.accounts = new Map();      // id -> account
    this.legacy = new Map();        // lowercased sleeper username -> { username, password }
    this.log = [];                  // every stubbed request
    this.unstubbed = [];            // aborted, unknown hosts
    this.oauthQueue = [];           // accounts (or {email,name}) for the next OAuth returns
    this.profileMode = 'ok';        // 'ok' | 'hang' | 401 | 500
    this.profilePostMode = 'ok';    // 'ok' | 500
    this.refreshMode = 'auto';      // 'auto' | 401
    this.writeLatencyMs = 150;      // server-side latency for writes (see _commitIfAlive)
    this.logoutScopes = [];
    this._hung = [];
    this._failed = new WeakSet();
    this._disposed = false;
  }

  // ── Server state ─────────────────────────────────────────────
  addAccount({ email, password = 'hunter2!!', provider = 'email', sleeper = null, espn = null, mfl = null, displayName = null, authUserId = null } = {}) {
    const id = 'acct-' + (++_seq).toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const acct = {
      id, email, password, provider, displayName: displayName || email.split('@')[0],
      authUserId: authUserId || ('auth-' + id),
      sessionVersion: 1,
      platforms: {},
      deleted: false,
    };
    if (sleeper) acct.platforms.sleeper = sleeper;
    if (espn) acct.platforms.espn = espn;
    if (mfl) acct.platforms.mfl = mfl;
    this.accounts.set(id, acct);
    return acct;
  }
  addLegacy(username, password = 'legacy-pw-1') {
    const rec = { username, password };
    this.legacy.set(username.toLowerCase(), rec);
    return rec;
  }
  findByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return [...this.accounts.values()].find(a => !a.deleted && a.email.toLowerCase() === e) || null;
  }
  // "Password reset / sign out everywhere on another device".
  revoke(acct) { acct.sessionVersion += 1; }
  // Stored fw_session_v1 value for an account, exactly what landing.html writes.
  sessionFor(acct, opts) {
    return { token: accountToken(acct, opts), user: this.userJson(acct) };
  }
  userJson(acct) {
    return { id: acct.id, email: acct.email, displayName: acct.displayName, tier: 'free', products: ['war_room', 'dynast_hq'] };
  }
  // Server-side handle, normalised: fw-profile stores a string today; the fix
  // design may store {username,userId}. (Guessed shape — see README.)
  serverHandle(acct) {
    const s = acct.platforms.sleeper;
    if (!s) return null;
    return typeof s === 'string' ? s : (s.username || null);
  }
  platformUsernamesJson(acct) {
    const out = {};
    for (const [k, v] of Object.entries(acct.platforms)) out[k] = v;
    return out;
  }
  // Queue the identity the next Google/Apple round trip returns as.
  nextOAuth(acctOrProfile) { this.oauthQueue.push(acctOrProfile); }

  calls(fn, method) {
    return this.log.filter(r => r.fn === fn && (!method || r.method === method));
  }

  // Validate an app-session bearer like requireActiveAppSession.
  _session(headers) {
    const auth = headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const claims = decode(token);
    const meta = claims && claims.app_metadata;
    if (!meta || !meta.user_id) return null;
    if (typeof claims.exp === 'number' && claims.exp < nowS()) return null;
    const acct = this.accounts.get(meta.user_id);
    if (!acct || acct.deleted) return null;
    if (Number(meta.session_version) !== acct.sessionVersion) return null;
    return acct;
  }
  _legacySession(headers) {
    const token = (headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const claims = decode(token);
    const u = claims && claims.app_metadata && claims.app_metadata.sleeper_username;
    if (!u || (typeof claims.exp === 'number' && claims.exp < nowS())) return null;
    return u;
  }

  // ── Installation ─────────────────────────────────────────────
  async install(context, appOrigin) {
    this.appOrigin = appOrigin;
    context.on('requestfailed', req => { this._failed.add(req); });
    await context.route('**/*', route => this._handle(route).catch(err => {
      if (!this._disposed) this.log.push({ fn: 'harness-error', url: route.request().url(), error: String(err && err.message || err) });
      return route.abort().catch(() => {});
    }));
  }
  async dispose() {
    this._disposed = true;
    for (const r of this._hung.splice(0)) { try { await r.abort(); } catch {} }
  }

  async _handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === this.appOrigin) {
      if (url.pathname === '/__e2e/blank') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>e2e</title><body>e2e</body>' });
      }
      return route.continue();
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(req) });
    if (url.hostname === SUPABASE_HOST) return this._supabase(route, req, url);
    if (url.hostname === 'api.sleeper.app') return this._sleeper(route, req, url);
    if (url.hostname === 'lm-api-reads.fantasy.espn.com') return this._espnDirect(route, req, url);
    if (/(^|\.)myfantasyleague\.com$/.test(url.hostname)) return this._json(route, req, 200, this._mflExport(url.toString()), 'mfl');
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '', headers: cors(req) });
    if (url.hostname === 'fonts.gstatic.com') return route.fulfill({ status: 404, body: '', headers: cors(req) });
    if (/(^|\.)espn\.com$/.test(url.hostname) || url.hostname === 'api.fantasycalc.com') return this._json(route, req, 200, {}, 'espn-misc');
    if (url.hostname === 'sleepercdn.com' || url.hostname.endsWith('.sleepercdn.com')) return route.fulfill({ status: 404, body: '' });
    this.unstubbed.push({ method: req.method(), url: req.url(), type: req.resourceType() });
    return route.abort('blockedbyclient');
  }

  async _json(route, req, status, body, fn, extra) {
    this.log.push({ fn, method: req.method(), url: req.url(), status, ...(extra || {}) });
    return route.fulfill({ status, contentType: 'application/json', headers: cors(req), body: body === undefined ? '' : JSON.stringify(body) });
  }

  // Writes land on the "server" only if the browser is still waiting for the
  // response after a realistic latency. A fetch the page cancelled (for
  // example by calling location.reload() without awaiting it, B2) never
  // commits, exactly as in production. keepalive fetches survive unload.
  async _commitIfAlive(req, commit) {
    await new Promise(r => setTimeout(r, this.writeLatencyMs));
    if (this._failed.has(req)) return false;
    try { if (req.frame() && req.frame().page().isClosed()) return false; } catch { /* service/keepalive request */ }
    commit();
    return true;
  }

  // ── Supabase ────────────────────────────────────────────────
  async _supabase(route, req, url) {
    const headers = await req.allHeaders();
    const path = url.pathname;
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }

    if (path.startsWith('/functions/v1/')) {
      const fn = path.slice('/functions/v1/'.length).split('/')[0];
      return this._fn(route, req, fn, headers, body, url);
    }
    if (path.startsWith('/auth/v1/')) return this._auth(route, req, url, headers, body);
    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length).split('?')[0];
      const fn = 'rest:' + table;
      if (req.method() === 'GET' || req.method() === 'HEAD') return this._json(route, req, 200, [], fn);
      return this._json(route, req, 201, [], fn, { body });
    }
    if (path.startsWith('/storage/v1/')) return this._json(route, req, 404, { error: 'not found' }, 'storage');
    return this._json(route, req, 404, { error: 'not stubbed' }, 'supabase-other');
  }

  async _fn(route, req, fn, headers, body, url) {
    const method = req.method();
    const J = (status, b, extra) => this._json(route, req, status, b, fn, { body, ...(extra || {}) });
    switch (fn) {
      case 'fw-signin': {
        const acct = this.findByEmail(body && body.email);
        if (!acct || acct.password !== (body && body.password)) return J(401, { error: 'Invalid email or password.' });
        return J(200, { token: accountToken(acct), user: this.userJson(acct), platformUsernames: this.platformUsernamesJson(acct) });
      }
      case 'fw-signup': {
        if (!body || !body.email || !body.password) return J(400, { error: 'Email and password are required.' });
        if (this.findByEmail(body.email)) return J(409, { error: 'An account with this email already exists.' });
        const acct = this.addAccount({ email: body.email, password: body.password });
        return J(200, { token: accountToken(acct), user: this.userJson(acct), platformUsernames: {} });
      }
      case 'fw-oauth-sync': {
        const claims = decode((headers['authorization'] || '').replace(/^Bearer\s+/i, ''));
        if (!claims || !claims.email) return J(401, { error: 'Invalid or expired session.' });
        let acct = this.findByEmail(claims.email);
        let isNew = false;
        if (!acct) { acct = this.addAccount({ email: claims.email, provider: 'google', authUserId: claims.sub }); isNew = true; }
        return J(200, { token: accountToken(acct), isNew, user: this.userJson(acct), platformUsernames: this.platformUsernamesJson(acct) }, { isNew, accountId: acct.id });
      }
      case 'fw-refresh-session': {
        const acct = this._session(headers);
        if (!acct || this.refreshMode === 401) return J(401, { error: 'Invalid or expired session.' });
        return J(200, { token: accountToken(acct), user: this.userJson(acct), platformUsernames: this.platformUsernamesJson(acct) });
      }
      case 'fw-profile': {
        if (this.profileMode === 'hang') {
          this.log.push({ fn, method, url: req.url(), status: 'hang' });
          this._hung.push(route);
          return undefined; // never answered; aborted at dispose()
        }
        const acct = this._session(headers);
        if (this.profileMode === 401 || !acct) return J(401, { error: 'Unauthorized' });
        if (this.profileMode === 500) return J(500, { error: 'Internal server error' });
        if (method === 'GET') {
          return J(200, { user: { ...this.userJson(acct) }, tutorialState: {}, platformUsernames: this.platformUsernamesJson(acct) });
        }
        if (method === 'POST') {
          if (this.profilePostMode === 500) return J(500, { error: 'Internal server error' });
          const pu = (body && body.platformUsernames) || null;
          const committed = await this._commitIfAlive(req, () => {
            if (pu && typeof pu === 'object') {
              // Merge semantics (fix design, fw-profile L63-66/L125-135).
              for (const [k, v] of Object.entries(pu)) {
                if (v === null || v === undefined || v === '') delete acct.platforms[k];
                else acct.platforms[k] = v;
              }
            }
          });
          this.log.push({ fn, method, url: req.url(), status: committed ? 200 : 'client-aborted', body, committed, keepalive: undefined });
          if (!committed) return route.abort().catch(() => {});
          return route.fulfill({ status: 200, contentType: 'application/json', headers: cors(req), body: JSON.stringify({ ok: true, platformUsernames: this.platformUsernamesJson(acct) }) }).catch(() => {});
        }
        return J(405, { error: 'Method not allowed' });
      }
      case 'get-session-token': {
        const u = String((body && body.username) || '').trim();
        const rec = this.legacy.get(u.toLowerCase());
        if (!rec) return J(401, { error: 'Passwordless Sleeper username sessions are disabled.', code: 'passwordless_sleeper_disabled' });
        if (!body.password) return J(401, { error: 'Password required for this account', isGifted: true });
        if (body.password !== rec.password) return J(401, { error: 'Incorrect password', isGifted: true });
        const token = legacyToken(rec.username);
        return J(200, { token, expiresAt: new Date(decode(token).exp * 1000).toISOString(), isGifted: false });
      }
      case 'fw-delete-account': {
        const acct = this._session(headers);
        if (!acct) return J(401, { error: 'Unauthorized' });
        if (!body || body.confirm !== true) return J(400, { error: 'Deletion not confirmed' });
        acct.deleted = true;
        acct.authUserDeleted = true; // fix design: the auth.users row goes too
        return J(200, { ok: true });
      }
      case 'fw-change-password': {
        const acct = this._session(headers);
        if (!acct) return J(401, { error: 'Sign in again before changing your password.' });
        if (!body || body.currentPassword !== acct.password) return J(400, { error: 'Current password is incorrect.' });
        acct.password = body.password;
        acct.sessionVersion += 1;
        return J(200, { ok: true, signInRequired: true });
      }
      case 'ai-analyze':
      case 'ai-feedback': {
        const ok = this._session(headers) || this._legacySession(headers);
        if (!ok) return J(401, { error: 'Valid session token required.' });
        return J(200, { analysis: 'stub analysis', text: 'stub analysis', usage: {} });
      }
      case 'mfl-proxy': {
        const target = body && body.url;
        return J(200, this._mflExport(target));
      }
      case 'espn-proxy': {
        const m = String((body && body.url) || '').match(/leagues\/(\d+)/);
        const lg = m && data.ESPN_LEAGUES[m[1]];
        if (!lg) return J(404, { error: 'not found' });
        if (lg.private && !(body.espnS2 && body.swid)) return J(401, { error: 'private' });
        return J(200, this._espnLeagueJson(m[1]));
      }
      default:
        return J(200, {}, { note: 'generic function stub' });
    }
  }

  async _auth(route, req, url, headers, body) {
    const p = url.pathname.replace('/auth/v1/', '');
    if (p === 'authorize') {
      // OAuth round trip: the provider signs in and bounces back to redirect_to
      // with an implicit-grant fragment, as Supabase does.
      const next = this.oauthQueue.shift();
      const redirectTo = url.searchParams.get('redirect_to');
      this.log.push({ fn: 'auth:authorize', method: req.method(), url: req.url(), status: 200, provider: url.searchParams.get('provider'), redirectTo });
      if (!next || !redirectTo) {
        const back = (redirectTo || this.appOrigin + '/landing.html') + '#error=access_denied&error_description=cancelled';
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><script>location.replace(${JSON.stringify(back)})</script>` });
      }
      const authUser = { id: next.authUserId || ('auth-' + next.email), email: next.email, name: next.displayName || next.name, provider: url.searchParams.get('provider') || 'google' };
      const at = supabaseAccessToken(authUser);
      const frag = `access_token=${at}&expires_at=${nowS() + 3600}&expires_in=3600&refresh_token=rt-${Math.random().toString(36).slice(2)}&token_type=bearer&provider_token=pt`;
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>provider</title><script>location.replace(${JSON.stringify(redirectTo + '#' + frag)})</script>` });
    }
    if (p === 'user') {
      const claims = decode((headers['authorization'] || '').replace(/^Bearer\s+/i, ''));
      if (!claims || !claims.email) return this._json(route, req, 401, { msg: 'invalid JWT' }, 'auth:user');
      return this._json(route, req, 200, {
        id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email,
        app_metadata: claims.app_metadata || { provider: 'google' }, user_metadata: claims.user_metadata || {},
        created_at: new Date().toISOString(), identities: [],
      }, 'auth:user');
    }
    if (p === 'logout') {
      this.logoutScopes.push(url.searchParams.get('scope') || 'global');
      return this._json(route, req, 204, undefined, 'auth:logout', { scope: url.searchParams.get('scope') || 'global' });
    }
    if (p === 'token') return this._json(route, req, 400, { error: 'invalid_grant' }, 'auth:token');
    return this._json(route, req, 200, {}, 'auth:' + p);
  }

  // ── Sleeper ─────────────────────────────────────────────────
  async _sleeper(route, req, url) {
    const p = url.pathname.replace(/^\/v1\//, '');
    const seg = p.split('/');
    const J = (b) => this._json(route, req, 200, b, 'sleeper', { path: p });
    if (seg[0] === 'user' && seg.length === 2) {
      const u = data.sleeperByName(decodeURIComponent(seg[1])) || data.sleeperById(seg[1]);
      return J(u ? { user_id: u.user_id, username: u.username, display_name: u.display_name, avatar: null } : null);
    }
    if (seg[0] === 'user' && seg[2] === 'leagues') {
      const u = data.sleeperById(seg[1]);
      const year = seg[4];
      if (!u || year !== data.SEASON) return J([]);
      return J(u.leagues.map(([league_id, name]) => this._sleeperLeague(league_id, name)));
    }
    if (seg[0] === 'league' && seg.length === 2) {
      const l = data.leagueById(seg[1]);
      return J(l ? this._sleeperLeague(l.league_id, l.name) : null);
    }
    if (seg[0] === 'league' && seg[2] === 'rosters') {
      const l = data.leagueById(seg[1]);
      if (!l) return J([]);
      return J([
        { roster_id: 1, owner_id: l.owner.user_id, league_id: l.league_id, players: [], starters: [], reserve: [], taxi: [], settings: { wins: 3, losses: 1, ties: 0, fpts: 400 } },
        { roster_id: 2, owner_id: '919999999999999999', league_id: l.league_id, players: [], starters: [], reserve: [], taxi: [], settings: { wins: 1, losses: 3, ties: 0, fpts: 350 } },
      ]);
    }
    if (seg[0] === 'league' && seg[2] === 'users') {
      const l = data.leagueById(seg[1]);
      if (!l) return J([]);
      return J([
        { user_id: l.owner.user_id, username: l.owner.username, display_name: l.owner.display_name, metadata: { team_name: l.owner.display_name + ' Team' } },
        { user_id: '919999999999999999', username: 'rival_r', display_name: 'RivalR', metadata: { team_name: 'Rival Team' } },
      ]);
    }
    if (seg[0] === 'state') return J({ season: data.SEASON, league_season: data.SEASON, previous_season: '2025', season_type: 'regular', week: 4, display_week: 4, leg: 4 });
    if (seg[0] === 'players') return J({});
    if (seg[0] === 'projections' || seg[0] === 'stats') return J([]);
    if (seg[0] === 'draft' && seg.length === 2) return J(null);
    return J([]);
  }
  _sleeperLeague(league_id, name) {
    return {
      league_id, name, season: data.SEASON, status: 'in_season', sport: 'nfl', total_rosters: 2, avatar: null,
      previous_league_id: null, draft_id: null,
      settings: { num_teams: 2, type: 2, playoff_week_start: 15, leg: 4 },
      scoring_settings: { rec: 1, pass_td: 4 },
      roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'],
    };
  }

  // ── MFL / ESPN ──────────────────────────────────────────────
  _mflExport(target) {
    let u;
    try { u = new URL(String(target || '')); } catch { return {}; }
    const type = u.searchParams.get('TYPE');
    const lid = u.searchParams.get('L');
    const lg = lid && data.MFL_LEAGUES[lid];
    if (type === 'players') return { players: { player: [] } };
    if (!lg) return type === 'league' ? { error: { $t: 'Invalid league' } } : {};
    if (type === 'league') {
      return { league: { id: lid, name: lg.name, franchises: { count: String(lg.franchises.length), franchise: lg.franchises.map(f => ({ id: f.id, name: f.name })) }, starters: { position: [] }, rosterSize: '20' } };
    }
    if (type === 'rosters') return { rosters: { franchise: lg.franchises.map(f => ({ id: f.id, player: [] })) } };
    return {};
  }
  _espnLeagueJson(id) {
    const lg = data.ESPN_LEAGUES[id];
    return {
      id: Number(id), seasonId: Number(lg.year), scoringPeriodId: 4,
      settings: { name: lg.name, size: lg.teams.length, rosterSettings: { lineupSlotCounts: {} }, scoringSettings: { scoringItems: [] }, draftSettings: {}, scheduleSettings: {} },
      status: { currentMatchupPeriod: 4 },
      draftDetail: { drafted: true },
      members: [],
      teams: lg.teams.map(t => ({ id: t.id, name: t.name, location: '', nickname: t.name, abbrev: 'T' + t.id, owners: [], roster: { entries: [] }, record: { overall: { wins: 2, losses: 2, ties: 0 } } })),
    };
  }
  async _espnDirect(route, req, url) {
    const m = url.pathname.match(/leagues\/(\d+)/);
    const lg = m && data.ESPN_LEAGUES[m[1]];
    if (!lg) return this._json(route, req, 404, { messages: ['not found'] }, 'espn');
    if (lg.private) return this._json(route, req, 401, { messages: ['private'] }, 'espn');
    return this._json(route, req, 200, this._espnLeagueJson(m[1]), 'espn');
  }
}

module.exports = { FakeBackend, SUPABASE_HOST };
