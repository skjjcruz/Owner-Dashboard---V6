'use strict';
// Deterministic fake world: Sleeper users + leagues, MFL and ESPN leagues.
// League names are unique strings so a test can assert "the hub shows x's
// leagues" (and "does NOT show y's") by plain text.

const SEASON = '2026';

const SLEEPER_USERS = {
  alpha_x: { user_id: '910000000000000001', username: 'alpha_x', display_name: 'AlphaX', leagues: [['930000000000000011', 'Alpha Dynasty League'], ['930000000000000012', 'Alpha Keeper League']] },
  bravo_y: { user_id: '910000000000000002', username: 'bravo_y', display_name: 'BravoY', leagues: [['930000000000000021', 'Bravo Dynasty League']] },
  zulu_z: { user_id: '910000000000000003', username: 'zulu_z', display_name: 'ZuluZ', leagues: [['930000000000000031', 'Zulu Scout League']] },
  guest_g: { user_id: '910000000000000004', username: 'guest_g', display_name: 'GuestG', leagues: [['930000000000000041', 'Guest Street League']] },
  legacy_l: { user_id: '910000000000000005', username: 'legacy_l', display_name: 'LegacyL', leagues: [['930000000000000051', 'Legacy Gift League']] },
  bigloco: { user_id: '910000000000000006', username: 'bigloco', display_name: 'bigloco', leagues: [['930000000000000061', 'Owner Demo League']] },
};

const MFL_LEAGUES = {
  '41208': { name: 'Alpha MFL League', year: SEASON, franchises: [{ id: '0001', name: 'Alpha MFL Team' }, { id: '0002', name: 'Other MFL Team' }] },
  '66601': { name: 'Private MFL League', year: SEASON, private: true, franchises: [{ id: '0001', name: 'Private MFL Team' }, { id: '0002', name: 'Rival MFL Team' }] },
  '55501': { name: 'Guest MFL League', year: SEASON, franchises: [{ id: '0001', name: 'Guest MFL Team' }, { id: '0002', name: 'Rival MFL Team' }] },
};

const ESPN_LEAGUES = {
  '777001': { name: 'Alpha ESPN League', year: SEASON, private: false, teams: [{ id: 1, name: 'Alpha ESPN Team' }, { id: 2, name: 'Other ESPN Team' }] },
  '777002': { name: 'Private ESPN League', year: SEASON, private: true, teams: [{ id: 1, name: 'Private ESPN Team' }, { id: 2, name: 'Other ESPN Team' }] },
};

function sleeperByName(name) {
  const k = String(name || '').toLowerCase();
  return SLEEPER_USERS[k] || null;
}
function sleeperById(id) {
  return Object.values(SLEEPER_USERS).find(u => u.user_id === String(id)) || null;
}
function leagueById(id) {
  for (const u of Object.values(SLEEPER_USERS)) {
    const hit = u.leagues.find(([lid]) => lid === String(id));
    if (hit) return { owner: u, league_id: hit[0], name: hit[1] };
  }
  return null;
}
function leagueNamesFor(handle) {
  const u = sleeperByName(handle);
  return u ? u.leagues.map(([, n]) => n) : [];
}
const ALL_LEAGUE_NAMES = [
  ...Object.values(SLEEPER_USERS).flatMap(u => u.leagues.map(([, n]) => n)),
  ...Object.values(MFL_LEAGUES).map(l => l.name),
  ...Object.values(ESPN_LEAGUES).map(l => l.name),
];

module.exports = { SEASON, SLEEPER_USERS, MFL_LEAGUES, ESPN_LEAGUES, sleeperByName, sleeperById, leagueById, leagueNamesFor, ALL_LEAGUE_NAMES };
