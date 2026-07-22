// ══════════════════════════════════════════════════════════════════
// college-stats.js — College Career Stats (2026 Draft Class)
// Source: Sports-Reference.com CFB, manually curated.
// Usage: window.COLLEGE_STATS[sleeper_player_id] = { school, years, stats: [...] }
// Each stats entry: { year, gp, ...position-specific stats }
// Update each draft season with new prospect class.
//
// NOTE: For players not in this dataset, the Big Board "COLLEGE STATS"
// button links directly to Sports Reference search.
// ══════════════════════════════════════════════════════════════════

window.COLLEGE_STATS = {
  // Add 2026 draft class prospects here as Sleeper populates player IDs.
  // Format:
  // "sleeper_pid": { school: "School", conf: "Conference", years: "2023-2025", pos: "QB", stats: [
  //   { year: "2023", team: "School", gp: 13, pass_cmp: 250, pass_att: 380, pass_yd: 3200, pass_td: 28, pass_int: 5, rush_yd: 150, rush_td: 3 },
  //   { year: "2024", team: "School", gp: 14, pass_cmp: 280, pass_att: 400, pass_yd: 3800, pass_td: 35, pass_int: 4, rush_yd: 200, rush_td: 5 },
  //   { year: "2025", team: "School", gp: 15, pass_cmp: 310, pass_att: 450, pass_yd: 4200, pass_td: 40, pass_int: 6, rush_yd: 180, rush_td: 4 },
  // ]},
};

// ── Helper: build college stats HTML table ────────────────────
window.buildCollegeStatsTable = function(pid) {
  const data = window.COLLEGE_STATS?.[pid];
  if (!data || !data.stats?.length) return null;

  const isQB = data.pos === 'QB';
  const isRB = data.pos === 'RB';
  const isWR = data.pos === 'WR' || data.pos === 'TE';
  const isIDP = ['DL','LB','DB'].includes(data.pos);

  let cols;
  if (isQB) cols = [{k:'gp',l:'GP'},{k:'pass_cmp',l:'CMP'},{k:'pass_att',l:'ATT'},{k:'pass_yd',l:'YDS'},{k:'pass_td',l:'TD'},{k:'pass_int',l:'INT'},{k:'rush_yd',l:'RUSH'},{k:'rush_td',l:'RTD'}];
  else if (isRB) cols = [{k:'gp',l:'GP'},{k:'rush_att',l:'ATT'},{k:'rush_yd',l:'YDS'},{k:'rush_td',l:'TD'},{k:'rec',l:'REC'},{k:'rec_yd',l:'REC YD'},{k:'rec_td',l:'RTD'}];
  else if (isWR) cols = [{k:'gp',l:'GP'},{k:'rec_tgt',l:'TGT'},{k:'rec',l:'REC'},{k:'rec_yd',l:'YDS'},{k:'rec_td',l:'TD'},{k:'rush_yd',l:'RUSH'}];
  else if (isIDP) cols = [{k:'gp',l:'GP'},{k:'idp_tkl',l:'TKL'},{k:'idp_sack',l:'SACK'},{k:'idp_int',l:'INT'},{k:'idp_pass_def',l:'PD'},{k:'idp_ff',l:'FF'}];
  else return null;

  const gridCols = '50px 42px ' + cols.map(() => '1fr').join(' ');
  const gold = '#D4AF37';
  const green = '#2ECC71';
  const silver = '#7d8291';
  const text = '#f0f0f3';

  const fmt = (v, k) => {
    if (v == null || (v === 0 && k !== 'pass_int')) return '<span style="color:'+silver+'">\u2014</span>';
    if (['pass_yd','rush_yd','rec_yd'].includes(k)) return '<strong>' + Math.round(v).toLocaleString() + '</strong>';
    if (['pass_td','rush_td','rec_td'].includes(k) && v >= 10) return '<span style="color:'+green+';font-weight:600">' + v + '</span>';
    if (k === 'idp_sack' && v >= 5) return '<span style="color:'+green+';font-weight:600">' + (Number.isInteger(v)?v:v.toFixed(1)) + '</span>';
    if (k === 'idp_tkl' && v >= 60) return '<span style="color:'+green+';font-weight:600">' + Math.round(v) + '</span>';
    if (k === 'idp_int' && v >= 3) return '<span style="color:'+green+';font-weight:600">' + v + '</span>';
    return Number.isInteger(v) ? v : v.toFixed(1);
  };

  const totals = {};
  cols.forEach(c => { totals[c.k] = 0; });
  data.stats.forEach(row => { cols.forEach(c => { totals[c.k] = (totals[c.k]||0) + (row[c.k]||0); }); });

  let html = '<div style="font-size:13px">';
  html += '<div style="display:grid;grid-template-columns:'+gridCols+';gap:3px;padding:5px 0;border-bottom:2px solid rgba(212,175,55,0.2);margin-bottom:2px">';
  html += '<div style="font-size:13px;font-weight:700;color:'+silver+';text-transform:uppercase">YR</div>';
  html += '<div style="font-size:13px;font-weight:700;color:'+silver+';text-transform:uppercase">TM</div>';
  cols.forEach(c => { html += '<div style="font-size:13px;font-weight:700;color:'+silver+';text-transform:uppercase;text-align:right">'+c.l+'</div>'; });
  html += '</div>';

  data.stats.forEach(row => {
    html += '<div style="display:grid;grid-template-columns:'+gridCols+';gap:3px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)">';
    html += '<div style="font-weight:700;color:'+silver+'">'+row.year+'</div>';
    html += '<div style="font-weight:700;padding:1px 3px;border-radius:3px;background:rgba(212,175,55,0.08);color:'+silver+';text-align:center;font-size:13px">'+(row.team||data.school).substring(0,10)+'</div>';
    cols.forEach(c => { html += '<div style="font-weight:600;text-align:right;color:'+text+'">'+fmt(row[c.k], c.k)+'</div>'; });
    html += '</div>';
  });

  if (data.stats.length >= 2) {
    html += '<div style="display:grid;grid-template-columns:'+gridCols+';gap:3px;padding:6px 0;border-top:2px solid rgba(212,175,55,0.2);font-weight:700">';
    html += '<div style="font-size:13px;font-weight:800;color:'+gold+'">TOT</div>';
    html += '<div></div>';
    cols.forEach(c => { html += '<div style="text-align:right;color:'+text+'">'+fmt(totals[c.k], c.k)+'</div>'; });
    html += '</div>';
  }

  html += '</div>';
  return html;
};
