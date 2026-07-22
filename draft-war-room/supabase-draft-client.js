/**
 * supabase-draft-client.js
 *
 * Provides functions for saving/loading draft board state and
 * querying mock draft prospects from Supabase.
 *
 * Depends on:
 *   - supabase-config.js (must be loaded first — defines SUPABASE_URL & SUPABASE_ANON_KEY)
 *   - @supabase/supabase-js CDN (loaded in index.html before this file)
 */

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _supabase = null;
let _supabaseToken = null;

function getSessionToken() {
  try {
    const raw = localStorage.getItem('od_session_v1');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.token || !s?.expiresAt) return null;
    if (Date.now() >= new Date(s.expiresAt).getTime() - 5 * 60 * 1000) return null;
    return s.token;
  } catch { return null; }
}

function getSupabaseClient() {
  if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    console.warn('[supabase-draft-client] Supabase credentials not configured. Edit supabase-config.js.');
    return null;
  }

  // supabase-js v2 exposes createClient on window.supabase when loaded via CDN
  if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
    console.error('[supabase-draft-client] Supabase JS library not loaded.');
    return null;
  }

  const token = getSessionToken();
  // Re-create client when token changes
  if (_supabase && _supabaseToken === token) return _supabase;
  const opts = token
    ? { global: { headers: { Authorization: `Bearer ${token}` } } }
    : {};
  _supabase      = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, opts);
  _supabaseToken = token;
  return _supabase;
}

// ---------------------------------------------------------------------------
// Draft Board — save / load
// ---------------------------------------------------------------------------

/**
 * Save (upsert) a draft board to Supabase.
 *
 * @param {object} opts
 * @param {object}  opts.picks            - draftPicks state object  { "1.01": playerId, … }
 * @param {string}  [opts.sleeperDraftId] - Sleeper draft_id (null for custom boards)
 * @param {string}  [opts.sleeperUsername]
 * @param {string}  [opts.leagueId]
 * @param {string}  [opts.draftYear]
 * @param {string}  [opts.boardName]      - optional user label
 * @param {number}  [opts.numTeams=16]
 * @param {number}  [opts.numRounds=7]
 * @param {string}  [opts.draftType='linear']
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
async function saveDraftBoard({
  picks,
  sleeperDraftId = null,
  sleeperUsername = null,
  leagueId = null,
  draftYear = null,
  boardName = null,
  numTeams = 16,
  numRounds = 7,
  draftType = 'linear',
}) {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('Supabase not configured') };

  const row = {
    sleeper_draft_id: sleeperDraftId,
    sleeper_username: sleeperUsername,
    league_id:        leagueId,
    draft_year:       draftYear,
    board_name:       boardName,
    picks,
    num_teams:        numTeams,
    num_rounds:       numRounds,
    draft_type:       draftType,
    updated_at:       new Date().toISOString(),
  };

  // Upsert: if a row with this sleeper_draft_id already exists, update it.
  // For custom (non-Sleeper) boards where sleeper_draft_id is null, always insert.
  if (sleeperDraftId) {
    const { data, error } = await client
      .from('draft_boards')
      .upsert(row, { onConflict: 'sleeper_draft_id' })
      .select()
      .single();
    return { data, error };
  } else {
    const { data, error } = await client
      .from('draft_boards')
      .insert(row)
      .select()
      .single();
    return { data, error };
  }
}

/**
 * Load a draft board by Sleeper draft_id.
 *
 * @param {string} sleeperDraftId
 * @returns {Promise<{ data: object|null, error: object|null }>}
 */
async function loadDraftBoardBySleeperDraftId(sleeperDraftId) {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('Supabase not configured') };

  const { data, error } = await client
    .from('draft_boards')
    .select('*')
    .eq('sleeper_draft_id', sleeperDraftId)
    .maybeSingle();

  return { data, error };
}

/**
 * Load all draft boards saved by a Sleeper username.
 *
 * @param {string} sleeperUsername
 * @returns {Promise<{ data: object[]|null, error: object|null }>}
 */
async function loadDraftBoardsByUsername(sleeperUsername) {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('Supabase not configured') };

  const { data, error } = await client
    .from('draft_boards')
    .select('*')
    .eq('sleeper_username', sleeperUsername)
    .order('updated_at', { ascending: false });

  return { data, error };
}

/**
 * Delete a saved draft board by its UUID.
 *
 * @param {string} id - UUID primary key
 * @returns {Promise<{ error: object|null }>}
 */
async function deleteDraftBoard(id) {
  const client = getSupabaseClient();
  if (!client) return { error: new Error('Supabase not configured') };

  const { error } = await client
    .from('draft_boards')
    .delete()
    .eq('id', id);

  return { error };
}

// ---------------------------------------------------------------------------
// Mock Draft Prospects
// ---------------------------------------------------------------------------

/**
 * Fetch all mock draft prospects, ordered by rank.
 *
 * @param {object} [opts]
 * @param {string} [opts.position] - optional position filter (e.g. 'QB')
 * @returns {Promise<{ data: object[]|null, error: object|null }>}
 */
async function getMockDraftProspects({ position } = {}) {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('Supabase not configured') };

  let query = client
    .from('mock_draft_prospects')
    .select('id, rank, player_name, position, college')
    .order('rank', { ascending: true });

  if (position) {
    query = query.eq('position', position);
  }

  const { data, error } = await query;
  return { data, error };
}

// ---------------------------------------------------------------------------
// Owner DNA — pre-load from Supabase so localStorage reads stay in sync.
// Called when a league is selected; the existing sync localStorage reads in
// buildMockContext() and the draft preview will automatically see fresh data.
// ---------------------------------------------------------------------------

function getCurrentUsername() {
  try {
    const raw = localStorage.getItem('od_auth_v1');
    if (!raw) return null;
    const auth = JSON.parse(raw);
    return auth?.sleeperUsername || auth?.username || null;
  } catch { return null; }
}

async function preloadDNAFromSupabase(leagueId) {
  const db = getSupabaseClient();
  const username = getCurrentUsername();
  if (!db || !username || !leagueId) return;

  const { data, error } = await db
    .from('owner_dna').select('dna_map')
    .eq('username', username).eq('league_id', leagueId).maybeSingle();

  if (error || !data) return;
  const dnaMap = data.dna_map || {};

  // Merge remote into localStorage (remote wins for keys present in both)
  let local = {};
  try { local = JSON.parse(localStorage.getItem(`od_owner_dna_v1_${leagueId}`) || '{}'); } catch {}
  const merged = { ...local, ...dnaMap };
  localStorage.setItem(`od_owner_dna_v1_${leagueId}`, JSON.stringify(merged));
}

// ---------------------------------------------------------------------------
// Exports (attached to window for use from inline Babel/React scripts)
// ---------------------------------------------------------------------------

window.SupabaseDraftClient = {
  saveDraftBoard,
  loadDraftBoardBySleeperDraftId,
  loadDraftBoardsByUsername,
  deleteDraftBoard,
  getMockDraftProspects,
  preloadDNAFromSupabase,
};
