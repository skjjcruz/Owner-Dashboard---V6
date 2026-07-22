// js/shared/shared-loader.js
// Resolves ReconAI shared scripts for local War Room dev and production.

(function() {
    const REMOTE_BASE = (function () {
        try {
            const h = window.location.hostname || '';
            // ReconAI shared scripts are deployed at <origin>/ReconAI-sandbox-dev/ on the
            // skjjcruz Pages host. When War Room is served from skjjcruz.github.io the
            // ReconAI-sandbox-dev project site is same-origin, so load it relative to the
            // origin (covered by CSP 'self'). Any other host loads it cross-origin from
            // skjjcruz.github.io explicitly.
            if (h === 'skjjcruz.github.io') return `${window.location.origin}/ReconAI-sandbox-dev/shared/`;
        } catch (e) {}
        return 'https://skjjcruz.github.io/ReconAI-sandbox-dev/shared/';
    })();
    const DEFAULT_VERSION = 'e81917e9d1'; // fallback only — the deploy build stamps a content hash over this (scripts/build-deploy.cjs)
    const config = {
        localBase: null,
        remoteBase: REMOTE_BASE,
        version: DEFAULT_VERSION,
    };

    function params() {
        return new URLSearchParams(window.location.search || '');
    }

    function cleanBase(base) {
        return String(base || '').replace(/\/?$/, '/');
    }

    function isLocalHost() {
        return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(window.location.hostname || '');
    }

    function isGitHubPagesHost() {
        return /(^|\.)github\.io$/i.test(window.location.hostname || '');
    }

    function isLocalMode() {
        const shared = params().get('shared');
        if (shared === 'remote') return false;
        if (shared === 'local') return true;
        if (isGitHubPagesHost()) return false;
        return isLocalHost() || window.location.protocol === 'file:' || params().has('dev');
    }

    function defaultLocalBase() {
        const path = window.location.pathname || '';
        if (path.includes('/draft-war-room/') || path.includes('/dist-preview/')) return '../reconai-shared/';
        return 'reconai-shared/';
    }

    function resolveBase() {
        const explicit = params().get('sharedBase') || window.WARROOM_SHARED_BASE;
        if (explicit) return cleanBase(explicit);
        // War Room ships its own copy of the shared engine in reconai-shared/
        // (synced from the canonical ReconAI repo at build time and bundled into
        // the Pages artifact). Always load it same-origin from that vendored copy
        // so the app does NOT depend on the separate /ReconAI/ Scout deploy being
        // live. `?shared=remote` stays as a debug-only escape hatch.
        if (params().get('shared') === 'remote') return cleanBase(config.remoteBase);
        return cleanBase(config.localBase || defaultLocalBase());
    }

    function withVersion(url, version) {
        const v = version || config.version;
        if (!v) return url;
        return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(v)}`;
    }

    function src(file, version) {
        return withVersion(resolveBase() + String(file || '').replace(/^\//, ''), version);
    }

    function load(file, version) {
        document.write(`<script src="${src(file, version)}"><\/script>`);
    }

    function loadMany(files) {
        files.forEach(item => {
            if (Array.isArray(item)) load(item[0], item[1]);
            else load(item, config.version);
        });
    }

    // Fetch-warm shared modules from <head> so they download in parallel while
    // the (huge) inline stylesheet + body parse. Execution order is still owned
    // by the document.write chain in loadMany — preload links never execute.
    // URLs are built by the same src() used at load time, so they match exactly
    // and the browser serves the later <script> straight from the preload cache.
    function preloadMany(files) {
        files.forEach(item => {
            const href = Array.isArray(item) ? src(item[0], item[1]) : src(item, config.version);
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'script';
            link.href = href;
            document.head.appendChild(link);
        });
    }

    function configure(next = {}) {
        if (next.localBase) config.localBase = next.localBase;
        if (next.remoteBase) config.remoteBase = next.remoteBase;
        if (next.version) config.version = next.version;
        if (next.rookieDataBase && !window.ROOKIE_DATA_BASE) {
            window.ROOKIE_DATA_BASE = next.rookieDataBase;
        }
    }

    function setDefaultRookieDataBase() {
        if (window.ROOKIE_DATA_BASE) return;
        if (!window.location.origin || window.location.origin === 'null') return;
        const path = window.location.pathname || '';
        if (isLocalMode()) {
            window.ROOKIE_DATA_BASE = `${window.location.origin}/draft-war-room`;
            return;
        }
        // Hosted deployments resolve same-origin so the data load is covered by CSP 'self'.
        // GitHub Pages project sites serve under /<repo>/; root-domain deployments use the origin root.
        const firstSegment = window.location.hostname.endsWith('.github.io')
            ? path.split('/').filter(Boolean)[0]
            : '';
        window.ROOKIE_DATA_BASE = firstSegment
            ? `${window.location.origin}/${firstSegment}/draft-war-room`
            : `${window.location.origin}/draft-war-room`;
    }

    window.WRShared = {
        configure,
        src,
        load,
        loadMany,
        preloadMany,
        isLocalMode,
        resolveBase,
    };
    setDefaultRookieDataBase();
})();
