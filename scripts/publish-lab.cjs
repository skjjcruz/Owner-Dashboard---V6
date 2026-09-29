#!/usr/bin/env node
// publish-lab.cjs — build the website exactly as the Pages deploy does and
// publish that build into the DHQ Lab repo (skjjcruz/DHQ-Web-Page).
//
// The Lab is a MIRROR of this repo, not a fork: every file it serves is
// generated here, by this script, from the current checkout. Nothing is
// hand-edited in the Lab. The pipeline is
//
//   this repo (staging branch)  --publish-lab-->  Lab repo  --owner test-->
//   merge to main (website deploys)  --port-->  native app repo
//
// What it does, in order:
//   1. sync reconai-shared/ from DHQ-Shared (same as deploy.yml)
//   2. run build-deploy.cjs (precompiled entries + content-hashed scripts)
//   3. wipe the Lab working tree except its own plumbing (.git, .github,
//      .nojekyll, robots.txt, README.md)
//   4. copy the same artifact list deploy.yml ships — minus CNAME (the Lab
//      must never claim dhqfootball.com) and .nojekyll (the Lab has its own)
//   5. overlay dist-deploy/ on top, exactly like the Pages artifact
//   6. inject lab/gate.html (access code + noindex) into every root page
//   7. add the Lab-only extras kept under lab/: the Cutdown Desk script
//      (wired into the app page) and the ESPN test harness page
//   8. write trade-lab.html as a copy of index.html (the owner's bookmark)
//   9. mark the build tag "bNNN · LAB" in gold so a Lab page is never
//      mistaken for the website
//
// Usage:  node scripts/publish-lab.cjs [--no-build]
//   LAB_DIR             path to the Lab checkout   (default ../DHQ-Web-Page)
//   DHQ_SHARED_SOURCE   path to DHQ-Shared         (default ../DHQ-Shared)
//                       — check out the engine branch under test there; the
//                       Lab then carries that branch while the website keeps
//                       deploying from DHQ-Shared main
//   LAB_TAG             optional marker appended to the build tag, e.g.
//                       LAB_TAG=LAB33 renders "b125 · LAB33"
// --no-build skips steps 1-2 and publishes the dist-deploy/ already on disk.
//
// The build stamps js/shared/shared-loader.js in place (that stamp is what
// the deploy ships); this script restores the source file afterwards so the
// working tree stays clean.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LAB_DIR = path.resolve(process.env.LAB_DIR || path.join(ROOT, '..', 'DHQ-Web-Page'));
const SHARED_SRC = path.resolve(process.env.DHQ_SHARED_SOURCE || path.join(ROOT, '..', 'DHQ-Shared'));
const DIST = path.join(ROOT, 'dist-deploy');
const LAB_SRC = path.join(ROOT, 'lab');
const NO_BUILD = process.argv.includes('--no-build');

// Mirrors the artifact list in .github/workflows/deploy.yml. Keep the two in
// step: a path added there must be added here, or the Lab silently drifts.
const ARTIFACT_PATHS = [
  'index.html', 'landing.html', 'landing-editor.html', 'login.html', 'upgrade.html',
  'connect-sleeper.html', 'draft-warroom.html', 'free-agency.html', 'trade-calculator.html',
  'gift.html', 'ai-setup.html', 'reset-password.html', 'admin.html', 'our-vision.html',
  'img',
  'charts.js', 'college-stats.js', 'draft-history.js', 'themes.js',
  'manifest.json', 'icon-192.png', 'icon-512.png',
  'js', 'content', 'legal', 'vendor', 'reconai-shared', 'draft-war-room', 'team-comps',
];
// deploy.yml also ships these two; the Lab must not.
const NEVER_SHIP = ['CNAME', '.nojekyll'];

// The Lab's own plumbing — the only things this script never touches.
const LAB_KEEP = new Set(['.git', '.github', '.claude', '.nojekyll', 'robots.txt', 'README.md']);
// Lab-only work from other sessions lives beside the mirror and must survive
// every publish (the Matchup Grades lab, Sep 2026: its page, engine, feeds,
// snapshot data and job). Matching files are set aside before the wipe and
// put back after the overlay, untouched — no gate, no tag, no rewrite.
const LAB_PRESERVE = [
  /^matchup-lab\.html$/,
  /^landing-mock\.html$/,
  /^data\//,
  /^scripts\//,
  /^js\/shared\/(matchup-|MATCHUP-)/,
];
// ...except a file this repo now ships itself. The projection engine was
// ported to the website (Sep 2026: matchup-engine, matchup-inputs,
// matchup-feeds-espn, MATCHUP-FORMULA.md and their tests), so the Lab serves
// the website's copy: one engine on both, and a website fix reaches the Lab.
// The Lab keeps preserving what only it has (its page, data, jobs, scripts,
// any new matchup-* file).
function websiteOwns(rel) {
  return rel.startsWith('js/') && fs.existsSync(path.join(ROOT, rel));
}
// Engine files the Lab session also edits in place. The Lab's copy of one the
// website ships is fine to replace when it is some version this repo has
// committed (the website is simply ahead). A copy this repo never had is Lab
// work that was not ported: publishing would overwrite it, so stop and say
// which. Port it first, or set LAB_ENGINE_FROM_WEBSITE=1 to publish the
// website's copy over it on purpose.
const LAB_ENGINE_WATCH = /^js\/shared\/(matchup-|MATCHUP-|dhq-proj|dhq-baseline|nfl-context)/;
function gitOut(args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
function websiteHadIt(rel) {
  const labBlob = gitOut(['hash-object', path.join(LAB_DIR, rel)]).trim();
  const ours = gitOut(['log', '--no-abbrev', '--format=', '--raw', 'HEAD', '--', rel]);
  return ours.split('\n').some(l => l.split(/\s+/)[3] === labBlob);
}
function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), rel, out);
    else out.push(rel);
  }
  return out;
}

function log(msg) { console.log('[publish-lab] ' + msg); }
function fail(msg) { console.error('[publish-lab] ' + msg); process.exit(1); }
function contentHash(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 10); }
function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); }

function run(script, env) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', script)], {
    cwd: ROOT, stdio: 'inherit', env: Object.assign({}, process.env, env || {}),
  });
}

// ── preflight ──────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(LAB_DIR, '.git'))) fail('LAB_DIR is not a git checkout: ' + LAB_DIR);
if (!fs.existsSync(LAB_SRC)) fail('lab/ folder missing in this repo');
for (const f of ['gate.html', 'lab-cutdown.js', 'espn-lab.html']) {
  if (!fs.existsSync(path.join(LAB_SRC, f))) fail('lab/' + f + ' missing');
}
const labFiles = walk(LAB_DIR, '', []);
const unported = labFiles.filter(rel => LAB_ENGINE_WATCH.test(rel) && websiteOwns(rel)
  && !fs.readFileSync(path.join(LAB_DIR, rel)).equals(fs.readFileSync(path.join(ROOT, rel)))
  && !websiteHadIt(rel));
if (unported.length && !/^(1|true|yes)$/i.test(String(process.env.LAB_ENGINE_FROM_WEBSITE || ''))) {
  fail('the Lab has engine changes the website never had: ' + unported.join(', ')
    + ' — port them to the website first, or set LAB_ENGINE_FROM_WEBSITE=1 to publish the website\'s copy over them.');
}
if (unported.length) log('LAB_ENGINE_FROM_WEBSITE=1: the website\'s copy replaces the Lab\'s ' + unported.join(', '));

// ── 1-2. build exactly like the deploy ─────────────────────────────────────
const loaderPath = path.join(ROOT, 'js', 'shared', 'shared-loader.js');
const loaderBefore = read(loaderPath);
if (!NO_BUILD) {
  if (!fs.existsSync(SHARED_SRC)) fail('DHQ-Shared not found at ' + SHARED_SRC + ' (set DHQ_SHARED_SOURCE)');
  run('sync-reconai-shared.cjs', { DHQ_SHARED_SOURCE: SHARED_SRC });
  run('build-deploy.cjs');
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) fail('dist-deploy/index.html missing — build failed?');
// The stamped loader is what ships; the source file goes back to how it was.
const loaderStamped = read(loaderPath);
fs.writeFileSync(loaderPath, loaderBefore, 'utf8');

// ── 3. wipe the Lab, keep its plumbing ─────────────────────────────────────
// (labFiles and the unported-engine check: see preflight)
const preserved = labFiles.filter(rel => LAB_PRESERVE.some(re => re.test(rel)) && !websiteOwns(rel));
const stash = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-preserve-'));
for (const rel of preserved) {
  fs.mkdirSync(path.dirname(path.join(stash, rel)), { recursive: true });
  fs.copyFileSync(path.join(LAB_DIR, rel), path.join(stash, rel));
}
const removed = [];
for (const entry of fs.readdirSync(LAB_DIR)) {
  if (LAB_KEEP.has(entry)) continue;
  fs.rmSync(path.join(LAB_DIR, entry), { recursive: true, force: true });
  removed.push(entry);
}
log('cleared ' + removed.length + ' entries from the Lab (' + removed.join(', ') + ')');

// ── 4. copy the artifact list ──────────────────────────────────────────────
for (const p of ARTIFACT_PATHS) {
  if (NEVER_SHIP.includes(p)) continue;
  const src = path.join(ROOT, p);
  if (!fs.existsSync(src)) fail('missing artifact path: ' + p);
  fs.cpSync(src, path.join(LAB_DIR, p), { recursive: true });
}
// js/shared/shared-loader.js must carry the build's stamp, as on the website.
write(path.join(LAB_DIR, 'js', 'shared', 'shared-loader.js'), loaderStamped);
for (const p of NEVER_SHIP) {
  if (p === '.nojekyll') continue; // the Lab keeps its own
  if (fs.existsSync(path.join(LAB_DIR, p))) fail(p + ' must never reach the Lab');
}

// ── 5. overlay the precompiled build ───────────────────────────────────────
// (includes version.json + the build-stamped pages that live-update.js polls)
fs.cpSync(DIST, LAB_DIR, { recursive: true });
if (!fs.existsSync(path.join(LAB_DIR, 'version.json'))) fail('version.json missing from dist-deploy/ — live update would never fire');

// ── 6. gate every root page ────────────────────────────────────────────────
const gate = read(path.join(LAB_SRC, 'gate.html'));
function injectGate(html, name) {
  if (html.includes("var KEY = 'dhq_lab_key_v2'")) return html; // already gated
  const head = html.match(/<head[^>]*>/i);
  if (!head) fail(name + ': no <head> to gate');
  // Right after <meta charset> when the page has one, so the charset stays in
  // the first bytes of the document; otherwise straight after <head>.
  const charset = html.slice(head.index).match(/<meta\s+charset[^>]*>/i);
  const at = charset ? head.index + charset.index + charset[0].length : head.index + head[0].length;
  return html.slice(0, at) + '\n' + gate + html.slice(at);
}
const sharedLoaderTag = (read(path.join(LAB_DIR, 'index.html')).match(/js\/shared\/shared-loader\.js\?v=[0-9a-f]+/) || [])[0];
if (!sharedLoaderTag) fail('index.html: shared-loader tag with a version not found');

// ── 7. Lab-only extras ─────────────────────────────────────────────────────
const cutdown = read(path.join(LAB_SRC, 'lab-cutdown.js'));
write(path.join(LAB_DIR, 'js', 'lab-cutdown.js'), cutdown);
const cutdownTag = '<script src="js/lab-cutdown.js?v=' + contentHash(cutdown) + '"></script>';
let espn = read(path.join(LAB_SRC, 'espn-lab.html'));
// The harness loads the shared loader by hand; keep its version in step with the build.
espn = espn.replace(/js\/shared\/shared-loader\.js\?v=[0-9a-f]+/g, sharedLoaderTag);
write(path.join(LAB_DIR, 'espn-lab.html'), espn);

// ── 8-9. app page: cutdown desk + Lab build tag, then the bookmark copy ────
function labifyAppPage(html, name) {
  if (!html.includes('src="js/post-draft.js')) fail(name + ': post-draft.js tag not found (cutdown anchor)');
  html = html.replace(/(<script src="js\/post-draft\.js[^>]*><\/script>)/, cutdownTag + '\n$1');
  const tagRe = /(<div id="dhq-build-tag"[^>]*>)([^<]*)(<\/div>)/;
  if (!tagRe.test(html)) fail(name + ': build tag not found');
  html = html.replace(tagRe, function (_, open, text, close) {
    const mark = process.env.LAB_TAG ? String(process.env.LAB_TAG).trim() : 'LAB';
    return open.replace('rgba(255,255,255,0.30)', 'rgba(212,175,55,0.75)') + text.trim() + ' · ' + mark + close;
  });
  return html;
}

let gated = 0;
for (const entry of fs.readdirSync(LAB_DIR)) {
  if (!entry.endsWith('.html')) continue;
  const p = path.join(LAB_DIR, entry);
  let html = injectGate(read(p), entry);
  if (entry === 'index.html') html = labifyAppPage(html, entry);
  write(p, html);
  gated++;
}
fs.copyFileSync(path.join(LAB_DIR, 'index.html'), path.join(LAB_DIR, 'trade-lab.html'));

// ── 6. put the other sessions' Lab-only work back, byte for byte ───────────
for (const rel of preserved) {
  fs.mkdirSync(path.dirname(path.join(LAB_DIR, rel)), { recursive: true });
  fs.copyFileSync(path.join(stash, rel), path.join(LAB_DIR, rel));
}
fs.rmSync(stash, { recursive: true, force: true });
if (preserved.length) log('preserved ' + preserved.length + ' Lab-only files (' + preserved.slice(0, 6).join(', ') + (preserved.length > 6 ? ', …' : '') + ')');

const tag = (read(path.join(LAB_DIR, 'index.html')).match(/id="dhq-build-tag"[^>]*>([^<]*)</) || [])[1];
log('gated ' + gated + ' pages; app page tagged "' + tag + '"; trade-lab.html = index.html');
log('published to ' + LAB_DIR + ' — review with `git -C ' + LAB_DIR + ' status`, then commit and push.');
