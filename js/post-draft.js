// ══════════════════════════════════════════════════════════════════
// post-draft.js — Post-Draft protocol persistence (War Room)
// Owns the two post-draft artifacts and syncs them cross-device:
//   • recap archive  — the graded draft recaps listDraftRecaps reads
//   • UDFA craze      — the dynasty post-rookie-draft scramble state
// Local DhqStorage is the cache; Supabase `post_draft` is the sync layer,
// with graceful fallback when the table isn't provisioned (mirrors the
// shared/league-memory.js pattern). Loaded on both the draft and FA
// surfaces so draft:closed (draft page) → craze board (FA page) bridges.
// ══════════════════════════════════════════════════════════════════
(function () {
  window.App = window.App || {};
  if (window.App.PostDraft) return; // idempotent

  const POST_DRAFT_TABLE = 'post_draft';
  const RECAP_KEY  = lid => `wr_draft_recap_archive_${lid || 'default'}`; // matches state.js
  const CRAZE_KEY  = lid => `dhq_udfa_craze_${lid || 'default'}`;
  const MAX_RECAPS = 25;
  const FALLBACK_WINDOW_MS = 48 * 60 * 60 * 1000; // 48h when waiver cadence is unknown

  // ── SQL schema (logged once so the owner can provision the table) ──────────
  (function logSchema() {
    try {
      const k = 'dhq_post_draft_schema_logged';
      if (localStorage.getItem(k)) return;
      console.log(
        '%c[PostDraft] Run this SQL in Supabase to create the post_draft table:\n\n' +
        'create table if not exists public.post_draft (\n' +
        '  id uuid primary key default gen_random_uuid(),\n' +
        '  league_id text not null,\n' +
        '  username text not null references public.users(sleeper_username) on delete cascade,\n' +
        '  season text not null,\n' +
        '  kind text not null,            -- \'recap_archive\' | \'craze\'\n' +
        '  payload jsonb not null default \'{}\'::jsonb,\n' +
        '  updated_at timestamptz default now(),\n' +
        '  unique (league_id, username, season, kind)\n' +
        ');\n' +
        'create index idx_post_draft_lookup on post_draft(league_id, username, kind);\n',
        'color: #D4AF37; font-weight: bold'
      );
      localStorage.setItem(k, '1');
    } catch (e) {}
  })();

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _store() { return window.DhqStorage || null; }
  function _username() {
    try { return window.S?.user?.username || localStorage.getItem('dynastyhq_username') || ''; } catch (e) { return ''; }
  }
  function _season(league) {
    try { return String(league?.season || window.S?.nflState?.season || window.S?.season || new Date().getFullYear()); }
    catch (e) { return String(new Date().getFullYear()); }
  }
  function _db() { try { return window.OD?.getClient ? window.OD.getClient() : null; } catch (e) { return null; } }

  // localStorage cache layer (sync) ------------------------------------------
  function lsGet(key, fallback) {
    const s = _store();
    if (s) return s.get(key, fallback);
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    const s = _store();
    if (s) return s.set(key, value);
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  // Supabase sync layer (async, fire-and-forget) ------------------------------
  async function dbUpsert(leagueId, season, kind, payload) {
    if (window._postDraftDbDisabled) return false;
    const db = _db();
    if (!db) return false;
    try {
      const row = { league_id: leagueId, username: _username(), season: String(season), kind, payload: payload || {}, updated_at: new Date().toISOString() };
      const { error } = await db.from(POST_DRAFT_TABLE).upsert([row], { onConflict: 'league_id,username,season,kind' });
      if (error) { window._postDraftDbDisabled = true; return false; }
      return true;
    } catch (e) { window._postDraftDbDisabled = true; return false; }
  }
  async function dbFetch(leagueId, kind) {
    if (window._postDraftDbDisabled) return null;
    const db = _db();
    if (!db) return null;
    try {
      const { data, error } = await db.from(POST_DRAFT_TABLE)
        .select('payload, updated_at')
        .eq('league_id', leagueId).eq('username', _username()).eq('kind', kind)
        .order('updated_at', { ascending: false }).limit(1);
      if (error) { window._postDraftDbDisabled = true; return null; }
      return data && data[0] ? data[0].payload : null;
    } catch (e) { window._postDraftDbDisabled = true; return null; }
  }

  // ── Recap archive ───────────────────────────────────────────────────────────
  function getRecapArchive(leagueId) {
    const arr = lsGet(RECAP_KEY(leagueId), []);
    return Array.isArray(arr) ? arr : [];
  }
  function archiveRecap(recap) {
    if (!recap || !recap.leagueId) return getRecapArchive(recap && recap.leagueId);
    const key = RECAP_KEY(recap.leagueId);
    const existing = getRecapArchive(recap.leagueId);
    const id = recap.id || ('recap_' + (recap.savedAt || Date.now()));
    const next = [{ ...recap, id, archivedAt: Date.now() }, ...existing.filter(r => r && r.id !== id)]
      .sort((a, b) => Number(b.savedAt || b.archivedAt || 0) - Number(a.savedAt || a.archivedAt || 0))
      .slice(0, MAX_RECAPS);
    lsSet(key, next);
    dbUpsert(recap.leagueId, recap.season, 'recap_archive', { recaps: next }); // fire-and-forget
    return next;
  }
  async function pullRecapArchive(leagueId) {
    const remote = await dbFetch(leagueId, 'recap_archive');
    if (remote && Array.isArray(remote.recaps) && remote.recaps.length) {
      const local = getRecapArchive(leagueId);
      // Merge by id, newest-first, keep MAX.
      const byId = new Map();
      remote.recaps.concat(local).forEach(r => { if (r && (r.id)) byId.set(r.id, r); });
      const merged = Array.from(byId.values())
        .sort((a, b) => Number(b.savedAt || b.archivedAt || 0) - Number(a.savedAt || a.archivedAt || 0))
        .slice(0, MAX_RECAPS);
      lsSet(RECAP_KEY(leagueId), merged);
      return merged;
    }
    return getRecapArchive(leagueId);
  }

  // ── UDFA craze ───────────────────────────────────────────────────────────────
  function computeWindowEnd(league, openedAt) {
    const s = league?.settings || {};
    const clearDays = Number(s.waiver_clear_days);
    if (Number.isFinite(clearDays) && clearDays > 0) return openedAt + clearDays * 24 * 60 * 60 * 1000;
    const dow = Number(s.waiver_day_of_week); // Sleeper: 0=Sun..6=Sat
    if (Number.isFinite(dow) && dow >= 0 && dow <= 6) {
      const d = new Date(openedAt);
      let delta = (dow - d.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // next occurrence, not today
      return openedAt + delta * 24 * 60 * 60 * 1000;
    }
    return openedAt + FALLBACK_WINDOW_MS;
  }
  function getCraze(leagueId) {
    const c = lsGet(CRAZE_KEY(leagueId), null);
    if (!c) return null;
    // Auto-expire a stale window so the panel doesn't linger forever.
    if (c.open && c.windowEnd && Date.now() > Number(c.windowEnd)) {
      const closed = { ...c, open: false };
      lsSet(CRAZE_KEY(leagueId), closed);
      return closed;
    }
    return c;
  }
  function openCraze(leagueId, opts = {}) {
    const existing = getCraze(leagueId) || {};
    const openedAt = existing.openedAt || Date.now();
    const seed = (opts.seed || existing.seed || []).map(s => (s && s.pid != null ? { pid: String(s.pid), name: s.name, pos: s.pos, dhq: s.dhq } : { pid: String(s) }));
    const craze = {
      open: true,
      openedAt,
      windowEnd: opts.windowEnd || existing.windowEnd || computeWindowEnd(opts.league, openedAt),
      season: opts.season || existing.season || _season(opts.league),
      seed,
      stagedClaims: existing.stagedClaims || {},
      dismissed: false,
    };
    lsSet(CRAZE_KEY(leagueId), craze);
    dbUpsert(leagueId, craze.season, 'craze', craze); // fire-and-forget
    try { window.dispatchEvent(new CustomEvent('wr:udfa-craze-open', { detail: { leagueId, season: craze.season } })); } catch (e) {}
    return craze;
  }
  function closeCraze(leagueId) {
    const c = getCraze(leagueId);
    if (!c) return null;
    const next = { ...c, open: false, dismissed: true };
    lsSet(CRAZE_KEY(leagueId), next);
    dbUpsert(leagueId, next.season, 'craze', next);
    return next;
  }
  function stageClaim(leagueId, pid, bid) {
    const c = getCraze(leagueId) || openCraze(leagueId, {});
    const stagedClaims = { ...(c.stagedClaims || {}) };
    if (bid == null) delete stagedClaims[String(pid)];
    else stagedClaims[String(pid)] = Number(bid) || 0;
    const next = { ...c, stagedClaims };
    lsSet(CRAZE_KEY(leagueId), next);
    dbUpsert(leagueId, next.season, 'craze', next);
    return next;
  }
  function getStagedClaims(leagueId) {
    return (getCraze(leagueId) || {}).stagedClaims || {};
  }
  async function pullCraze(leagueId) {
    const remote = await dbFetch(leagueId, 'craze');
    if (remote && typeof remote === 'object') {
      const local = getCraze(leagueId);
      // Prefer the newer of the two by openedAt; merge staged claims.
      const useRemote = !local || Number(remote.openedAt || 0) >= Number(local.openedAt || 0);
      const base = useRemote ? remote : local;
      const merged = { ...base, stagedClaims: { ...(remote.stagedClaims || {}), ...((local && local.stagedClaims) || {}) } };
      lsSet(CRAZE_KEY(leagueId), merged);
      return getCraze(leagueId);
    }
    return getCraze(leagueId);
  }

  // ── draft:closed handler — fan out the protocol ──────────────────────────────
  function onDraftClosed(recap) {
    if (!recap) return;
    try { if (recap.leagueId) archiveRecap(recap); } catch (e) {}
    // A finished draft changes rosters/picks league-wide — revalidate the league
    // data (WR.Sync no-ops if a sync is already running or no league is open).
    try { window.WR?.Sync?.refresh?.('draft-complete'); } catch (e) {}
    // The UDFA craze is dynasty rookie-draft specific. variant==='rookie' implies a
    // dynasty rookie draft in practice; the craze board is dynasty-gated regardless.
    if (recap.variant === 'rookie' && recap.leagueId) {
      const seed = (recap.postDraftMoves && recap.postDraftMoves.waiverTargets) || [];
      const league = (typeof window.App.isDynastyLeague === 'function' && window.currentLeague) ? window.currentLeague : null;
      // Live path fires at actual completion, so computeWindowEnd's waiver-cadence
      // default (≤7d) is inherently inside the 21-day completion cap the late-flip
      // path enforces (free-agency.js observeUdfaCrazeFlip, owner ask 2026-07-12).
      try { openCraze(recap.leagueId, { seed, season: recap.season, league }); } catch (e) {}
    }
  }

  // ── Draft memorial ───────────────────────────────────────────────────────────
  // A completed LIVE draft is kept visible in War Room until the next draft is
  // scheduled. We store a small marker keyed by league; the full completed draft
  // state already lives in wr_draft_cc_current_live_${leagueId}.
  const MEMORIAL_KEY = lid => `wr_draft_memorial_${lid || 'default'}`;
  function getMemorial(leagueId) { return lsGet(MEMORIAL_KEY(leagueId), null); }
  function saveMemorial(leagueId, m) {
    if (!leagueId) return null;
    const cur = getMemorial(leagueId) || {};
    const next = { ...cur, ...m, savedAt: Date.now() };
    lsSet(MEMORIAL_KEY(leagueId), next);
    dbUpsert(leagueId, next.season, 'memorial', next); // fire-and-forget
    return next;
  }
  function clearMemorial(leagueId) {
    if (!leagueId) return;
    lsSet(MEMORIAL_KEY(leagueId), null);
    dbUpsert(leagueId, _season(), 'memorial', { cleared: true });
  }

  try {
    window.addEventListener('draft:closed', (e) => {
      try { onDraftClosed(e?.detail?.recap); } catch (err) {}
    });
  } catch (e) {}

  window.App.PostDraft = {
    crazeKey: CRAZE_KEY,
    getCraze, openCraze, closeCraze, stageClaim, getStagedClaims, pullCraze,
    getRecapArchive, archiveRecap, pullRecapArchive,
    getMemorial, saveMemorial, clearMemorial,
    onDraftClosed,
    computeWindowEnd,
  };
})();
