#!/usr/bin/env node
// Build a production-shaped local preview without browser-side Babel.
// It precompiles every index.html type="text/babel" script into dist-preview.

const fs = require('fs');
const path = require('path');
const Babel = require('@babel/standalone');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist-preview');
const COMPILED_DIR = path.join(OUT_DIR, 'compiled');
const INDEX_PATH = path.join(ROOT, 'index.html');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanOutput() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  ensureDir(COMPILED_DIR);
}

function splitUrl(src) {
  const idx = src.indexOf('?');
  return {
    pathname: idx >= 0 ? src.slice(0, idx) : src,
    query: idx >= 0 ? src.slice(idx) : '',
  };
}

function isRemoteUrl(value) {
  return /^(?:https?:)?\/\//i.test(value) || /^data:/i.test(value);
}

function rewriteRootRelative(value) {
  if (!value || value.startsWith('#') || isRemoteUrl(value) || value.startsWith('../') || value.startsWith('./compiled/')) {
    return value;
  }
  if (value.startsWith('/')) return '..' + value;
  return '../' + value;
}

function compileScript(src) {
  const { pathname, query } = splitUrl(src);
  const inputPath = path.join(ROOT, pathname);
  const relOutPath = path.join('compiled', pathname).replace(/\\/g, '/');
  const outputPath = path.join(OUT_DIR, relOutPath);
  const mapPath = outputPath + '.map';

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing Babel source: ${src}`);
  }

  ensureDir(path.dirname(outputPath));

  const source = fs.readFileSync(inputPath, 'utf8');
  const result = Babel.transform(source, {
    filename: pathname,
    sourceFileName: '../' + pathname,
    sourceMaps: true,
    presets: [['react', { runtime: 'classic' }]],
    sourceType: 'script',
    comments: false,
  });

  fs.writeFileSync(mapPath, JSON.stringify(result.map), 'utf8');
  fs.writeFileSync(outputPath, `${result.code}\n//# sourceMappingURL=${path.basename(mapPath)}\n`, 'utf8');

  return `./${relOutPath}${query}`;
}

function build() {
  cleanOutput();
  let html = fs.readFileSync(INDEX_PATH, 'utf8');
  const compiled = [];

  html = html.replace(/\n?<script[^>]+src=["'][^"']*@babel\/standalone[^"']*["'][^>]*><\/script>\s*/i, '\n');

  // data-wr-defer scripts (lazy-loaded module groups) are kept INERT
  // (type="text/wr-deferred") so the browser doesn't run them at boot; the module
  // loader injects executable copies on demand. They are still compiled like any
  // other JSX module so the compiled overlay exists for the loader to fetch.
  const deferType = (a, b, c) => /\bdata-wr-defer\b/i.test((a || '') + (b || '') + (c || '')) ? ' type="text/wr-deferred"' : '';

  html = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)type=["']text\/babel["']([^>]*)><\/script>/gi,
    (_match, before, src, between, after) => {
      const outSrc = compileScript(src);
      compiled.push(src);
      return `<script${deferType(before, between, after)}${before}src="${outSrc}"${between}${after}></script>`;
    });

  html = html.replace(/<script\b([^>]*?)type=["']text\/babel["']([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi,
    (_match, before, between, src, after) => {
      const outSrc = compileScript(src);
      compiled.push(src);
      return `<script${deferType(before, between, after)}${before}${between}src="${outSrc}"${after}></script>`;
    });

  html = html.replace(/\b(href|src)=["']([^"']+)["']/gi, (match, attr, value) => {
    if (value.startsWith('./compiled/')) return `${attr}="${value}"`;
    return `${attr}="${rewriteRootRelative(value)}"`;
  });

  html = html.replace(/url\((['"]?)([^'")]+)\1\)/gi, (match, quote, value) => {
    return `url(${quote}${rewriteRootRelative(value)}${quote})`;
  });

  html = html.replace(
    /\/\/ NON-JSX BOOTSTRAP:[\s\S]*?window\.addEventListener\('DOMContentLoaded', function\(\) \{ setTimeout\(check, 500\); \}\);\n\}\)\(\);/,
    `// COMPILED PREVIEW BOOTSTRAP: Verify precompiled modules loaded.
(function() {
  window.addEventListener('DOMContentLoaded', function() {
    if (typeof OwnerDashboard !== 'undefined') return;
    document.getElementById('root').innerHTML = '<div style="color:#E74C3C;padding:40px;text-align:center;font-family:sans-serif"><h2>Module Load Error</h2><p>Precompiled Dynasty HQ modules failed to load. Run npm run build:preview and check the terminal output.</p></div>';
  });
})();`
  );

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8');
  console.log(`Compiled ${compiled.length} Babel scripts into ${path.relative(ROOT, OUT_DIR)}/`);
}

try {
  build();
} catch (err) {
  console.error('[build-preview] failed:', err && err.message ? err.message : err);
  process.exit(1);
}
