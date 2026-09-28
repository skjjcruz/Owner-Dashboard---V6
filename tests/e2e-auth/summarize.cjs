#!/usr/bin/env node
'use strict';
// Compact pass/fail matrix from the last run (output/e2e-auth/results.json):
//   node tests/e2e-auth/summarize.cjs [--md]
const fs = require('fs');
const path = require('path');

const file = path.join(process.env.E2E_AUTH_OUTPUT || path.resolve(__dirname, '..', '..', 'output', 'e2e-auth'), 'results.json');
if (!fs.existsSync(file)) { console.error('no results at ' + file); process.exit(1); }
const md = process.argv.includes('--md');
const res = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = new Map();
const strip = s => String(s || '').replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex

function walk(suite) {
  for (const spec of suite.specs || []) {
    for (const t of spec.tests) {
      const r = t.results[t.results.length - 1] || {};
      const id = (spec.title.match(/^(S\d+|T\d+[a-z]?(?:-[\w-]+)?)/) || [spec.title])[0];
      const row = rows.get(id) || { id, title: spec.title, by: {} };
      const err = strip((r.errors && r.errors[0] && r.errors[0].message) || (r.error && r.error.message) || '');
      const firstLine = err.split('\n').find(l => l.trim()) || '';
      row.by[t.projectName] = { status: r.status === 'passed' ? 'pass' : (r.status || 'skipped'), why: firstLine.trim().slice(0, 160), ms: r.duration };
      rows.set(id, row);
    }
  }
  for (const s of suite.suites || []) walk(s);
}
for (const s of res.suites || []) walk(s);

const projects = ['desktop', 'iphone-app', 'ipad-app'];
const order = id => { const m = id.match(/^([ST])(\d+)([a-z]?)(?:-(.*))?/); return m ? [m[1] === 'S' ? 0 : 1, Number(m[2]), m[3] || '', m[4] || ''] : [2, 0, '', id]; };
const sorted = [...rows.values()].sort((a, b) => { const x = order(a.id), y = order(b.id); for (let i = 0; i < 4; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; });
if (md) {
  console.log('| ID | ' + projects.join(' | ') + ' | first failure |');
  console.log('|---|' + projects.map(() => '---').join('|') + '|---|');
  for (const r of sorted) {
    const why = (Object.values(r.by).find(v => v.status !== 'pass') || {}).why || '';
    console.log(`| ${r.id} | ${projects.map(p => (r.by[p] ? r.by[p].status : '')).join(' | ')} | ${why.replace(/\|/g, '/')} |`);
  }
} else {
  for (const r of sorted) {
    console.log(r.id.padEnd(16) + projects.map(p => (r.by[p] ? r.by[p].status : '-').padEnd(8)).join('') + ((Object.values(r.by).find(v => v.status !== 'pass') || {}).why || ''));
  }
}
const all = [...rows.values()].flatMap(r => Object.values(r.by));
console.log(`\n${all.filter(v => v.status === 'pass').length} passed, ${all.filter(v => v.status !== 'pass').length} failed; wall ${Math.round((res.stats && res.stats.duration || 0) / 1000)} s`);
