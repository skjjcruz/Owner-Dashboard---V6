#!/usr/bin/env node
// Vendor the canonical shared browser engine from skjjcruz/DHQ-Shared into War Room.
//
// The canonical source of truth is the DHQ-Shared repo (modules live at its repo
// root; rookie CSVs under draft-war-room/). This script reads DHQ-Shared/manifest.json
// and:
//   - wipes + recopies the modules into reconai-shared/ (a 100%-vendored dir that
//     shared-loader.js serves same-origin), and
//   - refreshes the rookie CSVs into draft-war-room/ in place (copy-in-place, since
//     that dir also holds War-Room-only files like csv-loader.js / players-final.json).
//
// Source resolution order:
//   1. $DHQ_SHARED_SOURCE  (used in CI / deploy)
//   2. ../DHQ-Shared        (skjjcruz canonical, sibling checkout)
//   3. ../dhq-shared        (lowercase sibling fallback)
// If no source is found but the vendored reconai-shared/ snapshot already exists,
// the sync no-ops and uses what is on disk. Otherwise it fails the build.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'reconai-shared');

// Used only for the offline snapshot completeness check (no source available).
// Keep in lockstep with DHQ-Shared/manifest.json "modules".
const FALLBACK_MODULES = [
  'app-config.js', 'bug-capture.js', 'constants.js', 'utils.js', 'storage.js',
  'event-bus.js', 'platform-provider.js', 'sleeper-api.js', 'espn-api.js',
  'mfl-api.js', 'yahoo-api.js', 'supabase-client.js', 'tier.js',
  'pick-value-model.js', 'dhq-providers.js', 'dhq-core.js', 'intelligence-context.js',
  'dhq-engine.js', 'nfl-fit.js', 'team-assess.js', 'analytics-engine.js',
  'dhq-ai.js', 'assistant-tutorial.js', 'ai-dispatch.js', 'strategy.js',
  'trade-engine.js', 'mock-engine.js', 'gm-engine.js', 'player-modal.js', 'rookie-data.js',
];

function findSourceDir() {
  const candidates = [
    process.env.DHQ_SHARED_SOURCE,
    path.resolve(ROOT, '..', 'DHQ-Shared'),
    path.resolve(ROOT, '..', 'dhq-shared'),
  ].filter(Boolean);
  return candidates.find(dir => fs.existsSync(path.join(dir, 'manifest.json'))) || null;
}

function readManifest(sourceDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
  return {
    modules: Array.isArray(manifest.modules) ? manifest.modules : [],
    data: Array.isArray(manifest.data) ? manifest.data : [],
  };
}

function hasBundledSnapshot() {
  return FALLBACK_MODULES.every(file => fs.existsSync(path.join(TARGET, file)));
}

const SOURCE = findSourceDir();

if (!SOURCE) {
  if (hasBundledSnapshot()) {
    console.log('[sync-reconai-shared] DHQ-Shared source unavailable; using bundled reconai-shared snapshot');
    process.exit(0);
  }
  console.error('[sync-reconai-shared] Missing DHQ-Shared source and bundled snapshot.');
  console.error('[sync-reconai-shared] Check out skjjcruz/DHQ-Shared as ../DHQ-Shared or set $DHQ_SHARED_SOURCE.');
  process.exit(1);
}

const { modules, data } = readManifest(SOURCE);

// reconai-shared/ is 100% vendored, so a clean wipe + recopy is safe.
fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

for (const file of modules) {
  const src = path.join(SOURCE, file);
  if (!fs.existsSync(src)) {
    console.error(`[sync-reconai-shared] Missing module in source: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(TARGET, file));
}

// Refresh rookie CSVs in place (don't wipe draft-war-room/ — it holds WR-only files).
for (const rel of data) {
  const src = path.join(SOURCE, rel);
  if (!fs.existsSync(src)) {
    console.error(`[sync-reconai-shared] Missing data file in source: ${src}`);
    process.exit(1);
  }
  const dest = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

console.log(`[sync-reconai-shared] Vendored ${modules.length} modules into ${path.relative(ROOT, TARGET)}/ and refreshed ${data.length} data files from ${SOURCE}`);
