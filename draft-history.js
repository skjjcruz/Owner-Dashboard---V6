// draft-history.js
// Fetches Sleeper dynasty draft history and computes per-owner Draft DNA profiles.
// Shared between Draft War Room and Trade Calculator via <script src>.
(function () {
  'use strict';

  const SEASONS_TO_FETCH = 3;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function posGroup(pos) {
    if (!pos) return 'UNK';
    const p = String(pos).toUpperCase().trim();
    if (p === 'QB') return 'QB';
    if (['RB', 'HB', 'FB'].includes(p)) return 'RB';
    if (p === 'WR') return 'WR';
    if (p === 'TE') return 'TE';
    if (['DE', 'DL', 'DT', 'NT', 'EDGE', 'OLB'].includes(p)) return 'EDGE';
    if (['LB', 'ILB', 'MLB'].includes(p)) return 'LB';
    if (['CB', 'DB'].includes(p)) return 'CB';
    if (['S', 'SS', 'FS'].includes(p)) return 'S';
    if (['K', 'P', 'PK'].includes(p)) return 'K';
    if (['OT', 'OG', 'OL', 'C', 'IOL', 'G', 'T'].includes(p)) return 'OL';
    return p;
  }

  const DEF_GROUPS = ['EDGE', 'LB', 'CB', 'S'];

  function isDefensive(pos) {
    return DEF_GROUPS.includes(pos);
  }

  // Label based on round-weighted behavior, not just overall %.
  // earlyDefPct = % of R1-R2 picks that are defensive (NFL baseline: ~9%, all Edge/OLB)
  // overallDefPct = % of ALL picks that are defensive (NFL baseline: ~32%)
  function deriveDraftLabel(posPct, avgQBRound, earlyDefPct) {
    const qb  = posPct.QB   || 0;
    const rb  = posPct.RB   || 0;
    const wr  = posPct.WR   || 0;
    const te  = posPct.TE   || 0;
    // DEF-Drafter only applies when owner consistently takes defenders EARLY (rounds 1-2),
    // which is genuinely unusual behavior (>9% baseline). Threshold: >20% of their R1-2 picks.
    if (earlyDefPct >= 20) return 'DEF-Early';
    if (avgQBRound !== null && avgQBRound <= 1.5) return 'QB-Hunter';
    if (qb >= 15)  return 'QB-Hungry';
    if (rb >= 38)  return 'RB-Heavy';
    if (wr >= 38)  return 'WR-First';
    if (te >= 15)  return 'TE-Premium';
    if (avgQBRound === null || avgQBRound >= 4.5) return 'QB-Avoider';
    return 'Balanced';
  }

  // Build a compact round-bucket profile string, e.g.:
  // "R1-2: WR 50% RB 33% QB 17% | R3-5: TE 30% WR 25% RB 25% | R6+: EDGE 18% LB 12% WR 15%"
  function buildRoundProfile(picks) {
    const buckets = {
      early: picks.filter(p => p.round <= 2),
      mid:   picks.filter(p => p.round >= 3 && p.round <= 5),
      late:  picks.filter(p => p.round >= 6),
    };
    const labels = { early: 'R1-2', mid: 'R3-5', late: 'R6+' };

    return Object.entries(buckets).map(([key, bPicks]) => {
      if (!bPicks.length) return null;
      const counts = {};
      for (const p of bPicks) counts[p.pos] = (counts[p.pos] || 0) + 1;
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([pos, cnt]) => `${pos} ${Math.round((cnt / bPicks.length) * 100)}%`)
        .join(' ');
      return `${labels[key]}: ${top}`;
    }).filter(Boolean).join(' | ');
  }

  // ── Sleeper fetching ──────────────────────────────────────────────────────────
  async function fetchLeagueDraftHistory(startLeagueId) {
    const allPicks = [];
    let leagueId = startLeagueId;
    const seen = new Set();

    for (let i = 0; i < SEASONS_TO_FETCH; i++) {
      if (!leagueId || seen.has(leagueId)) break;
      seen.add(leagueId);
      try {
        const [leagueData, drafts, users] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${leagueId}`).then(r => r.json()),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`).then(r => r.json()),
          fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`).then(r => r.json()),
        ]);

        const season = leagueData?.season || String(2024 - i);
        const userMap = {};
        (users || []).forEach(u => {
          userMap[String(u.user_id)] = u.display_name || u.username || u.user_id;
        });

        for (const draft of (drafts || [])) {
          // Only process snake/linear — skip auction drafts
          if (!['snake', 'linear'].includes(draft.type)) continue;
          const picks = await fetch(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`)
            .then(r => r.json());
          (picks || []).forEach(pick => {
            if (!pick.picked_by) return;
            const uid = String(pick.picked_by);
            allPicks.push({
              season,
              leagueId,
              draftId:     draft.draft_id,
              userId:      uid,
              displayName: userMap[uid] || uid,
              pos:         posGroup(pick.metadata?.position),
              round:       pick.round,
              slot:        pick.draft_slot,
              pickNo:      pick.pick_no,
              playerName:  ((pick.metadata?.first_name || '') + ' ' + (pick.metadata?.last_name || '')).trim(),
            });
          });
        }

        // Walk back to previous season's league
        leagueId = leagueData?.previous_league_id || null;
      } catch (e) {
        console.warn('[draft-history] Error fetching league', leagueId, e);
        break;
      }
    }
    return allPicks;
  }

  // ── DNA computation ───────────────────────────────────────────────────────────
  function computeOwnerDraftDNA(allPicks) {
    const byOwner = {};
    for (const pick of allPicks) {
      if (!byOwner[pick.userId]) {
        byOwner[pick.userId] = { userId: pick.userId, displayName: pick.displayName, picks: [], seasons: new Set() };
      }
      byOwner[pick.userId].picks.push(pick);
      byOwner[pick.userId].seasons.add(pick.season);
    }

    const result = {};
    for (const [userId, data] of Object.entries(byOwner)) {
      const picks = data.picks;
      if (!picks.length) continue;

      // Overall position frequency
      const counts = {};
      for (const p of picks) counts[p.pos] = (counts[p.pos] || 0) + 1;
      const total = picks.length;
      const posPct = {};
      for (const [pos, cnt] of Object.entries(counts)) posPct[pos] = Math.round((cnt / total) * 100);

      // Round-bucket picks
      const earlyPicks = picks.filter(p => p.round <= 2);   // R1-2: NFL baseline ~9% defenders
      const midPicks   = picks.filter(p => p.round >= 3 && p.round <= 5);
      const latePicks  = picks.filter(p => p.round >= 6);

      // Early-round defensive % (key signal — NFL average is ~9%, all Edge/OLB)
      const earlyDefPct = earlyPicks.length
        ? Math.round((earlyPicks.filter(p => isDefensive(p.pos)).length / earlyPicks.length) * 100)
        : 0;

      // Overall defensive % (NFL average ~32%, concentrated in late rounds)
      const overallDefPct = Math.round(
        (picks.filter(p => isDefensive(p.pos)).length / total) * 100
      );

      // First QB round per season+draft
      const qbFirstBySeason = {};
      for (const p of picks) {
        if (p.pos !== 'QB') continue;
        const key = `${p.season}_${p.draftId}`;
        if (!qbFirstBySeason[key] || p.round < qbFirstBySeason[key]) qbFirstBySeason[key] = p.round;
      }
      const qbRounds   = Object.values(qbFirstBySeason);
      const avgQBRound = qbRounds.length
        ? qbRounds.reduce((a, b) => a + b, 0) / qbRounds.length
        : null;

      const label = deriveDraftLabel(posPct, avgQBRound, earlyDefPct);

      // Human-readable overall top positions
      const topPos = Object.entries(posPct)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([pos, pct]) => `${pos}:${pct}%`)
        .join(', ');
      const qbStr = avgQBRound === null
        ? 'never drafts QB'
        : avgQBRound <= 1.5 ? 'QB in R1'
        : avgQBRound <= 2.5 ? 'QB in R2'
        : `first QB avg R${avgQBRound.toFixed(1)}`;

      // Round profile string for AI prompt
      const roundProfile = buildRoundProfile(picks);

      result[userId] = {
        label,
        tendency:        `${topPos} · ${qbStr}`,
        roundProfile,    // "R1-2: WR 40% RB 35% | R3-5: TE 28% RB 22% | R6+: EDGE 20% LB 15%"
        posPct,
        earlyDefPct,     // % of R1-R2 picks that are defenders (NFL baseline: ~9%)
        overallDefPct,   // % of all picks that are defenders (NFL baseline: ~32%)
        avgQBRound,
        r1Positions:     picks.filter(p => p.round === 1).map(p => p.pos),
        picksAnalyzed:   picks.length,
        seasons:         [...data.seasons].sort().reverse().join(', '),
        displayName:     data.displayName,
      };
    }
    return result;
  }

  // ── Storage ───────────────────────────────────────────────────────────────────
  const DRAFT_DNA_LS_KEY = id => `od_draft_dna_v1_${id}`;

  function saveDraftDNA(leagueId, map) {
    try { localStorage.setItem(DRAFT_DNA_LS_KEY(leagueId), JSON.stringify(map)); } catch (e) {}
  }

  function loadDraftDNA(leagueId) {
    try { return JSON.parse(localStorage.getItem(DRAFT_DNA_LS_KEY(leagueId)) || 'null'); } catch { return null; }
  }

  // ── Public sync ───────────────────────────────────────────────────────────────
  async function syncDraftDNA(leagueId) {
    const picks = await fetchLeagueDraftHistory(leagueId);
    if (!picks.length) throw new Error('No completed draft picks found for this league (3 seasons checked).');
    const map = computeOwnerDraftDNA(picks);
    saveDraftDNA(leagueId, map);
    return map;
  }

  // ── Global export ─────────────────────────────────────────────────────────────
  window.DraftHistory = {
    fetchLeagueDraftHistory,
    computeOwnerDraftDNA,
    saveDraftDNA,
    loadDraftDNA,
    syncDraftDNA,
  };
})();
