// Ask-your-AI coverage check (owner ruling 2026-10-10): opens a real league
// in the live Lab as a guest and runs every lookup the member's AI can use.
// Needs playwright-core (NODE_PATH) and the pre-installed Chromium.
//   LAB_KEY=<lab gate key> NODE_PATH=<dir with playwright-core>/node_modules node scripts/ask-coverage.cjs
// Coverage check: open a real league in the Lab as a guest and run every AI
// lookup with real arguments. Prints ok/empty/error per call.
const { chromium } = require('playwright-core');
const CALLS = [
  ['get_league_info', {}], ['get_standings', {}], ['get_team', {}], ['get_team', { team: 'mwitkowski' }],
  ['get_matchup', {}], ['get_matchup', { week: 2 }], ['get_lineup_advice', {}], ['get_schedule', {}], ['get_playoff_odds', {}],
  ['get_league_history', {}], ['get_head_to_head', { team_b: 'mwitkowski' }],
  ['get_player', { player: 'Courtland Sutton' }], ['get_player', { player: 'Sutton' }], ['compare_players', { players: ['Jonathan Taylor', 'Derrick Henry'] }],
  ['search_players', { position: 'WR', limit: 10 }], ['search_players', { position: 'RB', availability: 'free_agents', limit: 8 }],
  ['get_waiver_report', {}], ['get_waiver_bid', { player: 'Tyler Badie' }], ['get_news', { players: ['Courtland Sutton'] }], ['get_news', { nfl_team: 'DEN' }],
  ['get_transactions', { type: 'trade', limit: 5 }], ['get_transactions', { team: 'me', limit: 5 }],
  ['evaluate_trade', { give: ['Jonathan Taylor'], get: ['Puka Nacua'] }], ['find_trade_partners', {}], ['get_owner_profile', { team: 'mwitkowski' }],
  ['get_draft_info', {}],
  ['get_start_sit', {}], ['get_start_sit', { players: 'Sutton or Holani' }],
  ['trade_plan', { partner: 'bwit13', target: 'Jordan Love' }], ['trade_plan', { partner: 'bwit13', target: 'Jordan Love', give: ['Matthew Stafford', 'Mark Andrews'] }],
  ['evaluate_trade', { give: ['Matthew Stafford', 'Mark Andrews'], get: ['Jordan Love'] }],
  ['get_waiver_plan', {}], ['get_waiver_plan', { position: 'DEF' }], ['get_waiver_bid', { player: 'Parrish' }], ['roster_plan', {}],
];
(async () => {
  const b = await chromium.launch({ args: ['--ignore-certificate-errors-spki-list=PS48cX347wDVcRynzq+DFqswl2PLNE1sG6uQvxMCOS0='], executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await c.addInitScript(k => { try { if (k) localStorage.setItem('dhq_lab_key_v2', k); } catch (e) {} }, process.env.LAB_KEY || '');
  const p = await c.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  await p.goto('https://skjjcruz.github.io/DHQ-Web-Page/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  const inp = p.locator('input:visible').first();
  await inp.fill('skjjcruz');
  await p.locator('button:visible', { hasText: /see my league/i }).first().click();
  await p.waitForTimeout(8000);
  await p.getByText(process.env.LEAGUE || 'The Psycho League: Year VI', { exact: false }).first().click();
  await p.waitForFunction(() => window.App && App.LI_LOADED && window.S && S.rosters && S.rosters.length && App.AskTools, null, { timeout: 90000 });
  await p.waitForTimeout(12000);
  const names = await p.evaluate(() => App.AskTools.defs().map(d => d.name));
  console.log('tools:', names.length, names.join(', '));
  let ok = 0, bad = 0;
  for (const [name, args] of CALLS) {
    if (!names.includes(name)) { console.log('MISSING', name); bad++; continue; }
    const t0 = Date.now();
    const out = await p.evaluate(([n, a]) => App.AskTools.run(n, a).then(r => JSON.stringify(r)), [name, args]);
    const ms = Date.now() - t0;
    const err = /^\{"error"/.test(out);
    if (err) bad++; else ok++;
    console.log((err ? 'ERR ' : 'ok  ') + name + ' ' + JSON.stringify(args) + ' ' + ms + 'ms ' + out.length + 'b :: ' + out.slice(0, process.env.FULL ? 4000 : 260));
  }
  console.log('\n' + ok + ' ok, ' + bad + ' failed; page errors:', errs.slice(0, 5));
  await b.close();
})().catch(e => { console.error('HARNESS', e.message); process.exit(1); });
