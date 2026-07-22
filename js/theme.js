// ══════════════════════════════════════════════════════════════════
// js/theme.js — War Room Theme Engine
//
// Centralized theme system that replaces inline color/font literals
// throughout the dashboard. All widget components read from WrTheme
// instead of hardcoded values.
//
// Loads BEFORE any widget or dashboard script. Persists to localStorage.
// Coexists with themes.js (NFL team accent colors) — that system
// continues to set --gold/--silver CSS vars independently.
//
// Depends on: nothing (self-contained, runs first)
// Exposes:    window.WrTheme, window.wrAlpha
// ══════════════════════════════════════════════════════════════════

// ── wrAlpha(color, 'HH') ───────────────────────────────────────────
// Theme-safe replacement for the old `color + 'HH'` idiom (which built an
// 8-digit hex and only worked while `color` was a raw hex). Resolves any
// color form — hex OR var(--k-…, …) OR rgb()/named — to concrete rgb via a
// memoized off-screen probe, then applies the 2-digit-hex alpha. In dark
// mode the result is identical to the old concatenation; in light mode it
// tracks the themed value. Defined first so it exists before any render.
(function() {
    'use strict';
    const cache = new Map();
    let probe = null;
    function rootTheme() {
        return (document.documentElement.getAttribute('data-wr-theme') || 'default');
    }
    function resolveRGB(color) {
        if (!probe) {
            probe = document.createElement('span');
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = 'position:absolute!important;left:-99999px;top:0;width:0;height:0;pointer-events:none;';
            (document.body || document.documentElement).appendChild(probe);
        }
        probe.style.color = '';
        probe.style.color = color;            // invalid values are ignored -> stays ''
        return getComputedStyle(probe).color; // always an absolute rgb()/rgba()
    }
    window.wrAlpha = function(color, hh) {
        if (color == null || color === '') return color;
        const c = String(color);
        const key = rootTheme() + '|' + c + '|' + hh;
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        let out;
        try {
            const m = resolveRGB(c).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            const a = Math.round((parseInt(hh, 16) / 255) * 1000) / 1000;
            out = m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : c;
        } catch (e) { out = c; }
        cache.set(key, out);
        return out;
    };
    // Repaint-safe: drop memo when the theme flips so colors re-resolve.
    window.addEventListener('wr_theme_changed', () => cache.clear());
})();

(function() {
    'use strict';

    const LS_KEY = 'wr_dashboard_theme';
    const DYNAMIC_STYLE_ID = 'wr-theme-dynamic';
    // Light mode shipped to production (2026-06-04). Previously this was new Set(['light']),
    // which hid light mode everywhere except sandbox hosts / ?dev. Kept as an empty set so
    // future in-development themes can still be sandbox-gated by adding their id here.
    const SANDBOX_ONLY_THEMES = new Set([]);

    function isSandboxThemeMode() {
        const host = String(window.location.hostname || '').toLowerCase();
        const params = new URLSearchParams(window.location.search || '');
        return host.includes('sandbox') || params.has('dev') || params.get('mode') === 'sandbox' || params.get('sandbox') === 'true';
    }

    function isThemeAllowed(id) {
        return !!THEMES[id] && (!SANDBOX_ONLY_THEMES.has(id) || isSandboxThemeMode());
    }

    function normalizeThemeId(id) {
        return isThemeAllowed(id) ? id : 'default';
    }

    // ── Theme definitions ─────────────────────────────────────────
    const THEMES = {
        default: {
            id: 'default',
            name: 'Dynasty HQ',
            preview: '🏴',
            fonts: {
                display: 'Rajdhani, sans-serif',
                ui: "'DM Sans', sans-serif",
                mono: "'JetBrains Mono', monospace",
                sizeScale: 1.0,
            },
            colors: {
                bg:         '#08080B',
                card:       '#121217',
                cardHover:  'rgba(212,175,55,0.06)',
                accent:     '#D4AF37',
                accentDark: '#B8941E',
                text:       '#F5F2EA',
                textMuted:  '#BDB8AD',
                textFaint:  'rgba(189,184,173,0.62)',
                positive:   '#2ECC71',
                negative:   '#E74C3C',
                info:       '#5DADE2',
                warn:       '#F0A500',
                purple:     '#9B8AFB',
                border:     'rgba(212,175,55,0.2)',
                borderHover:'rgba(212,175,55,0.4)',
            },
            card: {
                background: '#121217',
                border:     '1px solid rgba(212,175,55,0.2)',
                borderHover:'1px solid rgba(212,175,55,0.4)',
                radius:     '10px',
                shadow:     'none',
                shadowHover:'0 4px 16px rgba(0,0,0,0.3)',
            },
            badge: {
                radius:     '10px',
                fontWeight:  700,
            },
            effects: {
                scanlines:   false,
                glow:        false,
                pixelate:    false,
                hoverScale:  1.0,
                transition:  '0.15s ease',
            },
        },

        // Tecmo Bowl + Madden 2005 themes parked for future rollout.
        // Infrastructure preserved — just add the objects back to re-enable.

        light: {
            id: 'light',
            name: 'Light Mode',
            preview: '☀️',
            fonts: {
                display: 'Rajdhani, sans-serif',
                ui: "'DM Sans', sans-serif",
                mono: "'JetBrains Mono', monospace",
                sizeScale: 1.0,
            },
            colors: {
                bg:         '#F6F4EF',
                card:       '#FFFFFF',
                cardHover:  '#ECE7DC',
                accent:     '#8C6410',
                accentDark: '#64480C',
                text:       '#15130F',
                textMuted:  '#4E4638',
                textFaint:  'rgba(21,19,15,0.58)',
                positive:   '#0E7A3A',
                negative:   '#B42318',
                info:       '#075E9E',
                warn:       '#A15C00',
                purple:     '#5B3EA6',
                border:     'rgba(90,74,42,0.22)',
                borderHover:'rgba(90,74,42,0.38)',
            },
            card: {
                background: '#FFFFFF',
                border:     '1px solid rgba(90,74,42,0.18)',
                borderHover:'1px solid rgba(90,74,42,0.34)',
                radius:     '10px',
                shadow:     '0 1px 4px rgba(35,28,18,0.08)',
                shadowHover:'0 6px 16px rgba(35,28,18,0.14)',
            },
            badge: {
                radius:     '10px',
                fontWeight:  700,
            },
            effects: {
                scanlines:   false,
                glow:        false,
                pixelate:    false,
                hoverScale:  1.0,
                transition:  '0.15s ease',
            },
        },
    };

    // ══════════════════════════════════════════════════════════════
    // Light-mode palette layer
    //
    // scripts/lightmode-codemod.cjs rewrote every hardcoded color literal
    // across the module JS to `var(--key, <original>)`. The fallback is the
    // exact original value, so DARK MODE renders byte-identical with no var
    // definitions at all. Light mode only needs to override the vars below —
    // one source of truth instead of per-component patching.
    //
    //   --k-RRGGBB   solid colors      (accents darkened for contrast on light)
    //   --ov-1..9    white overlays    (flip to dark-on-light surface tints)
    //   --acc-*      gold accent tints (themed line/fill on light)
    //   --surf-solid dark panel fills  (flip to light card)
    // ══════════════════════════════════════════════════════════════

    // Per-hex light values. Dark surfaces -> light cards; light/near-white
    // text -> dark text; saturated accents -> darkened to clear ~4.5:1 on the
    // warm off-white page (#F6F4EF). Hand-tuned; covers every key the codemod
    // emitted (anything missing falls back to its original via var() fallback).
    const LIGHT_HEX = {
        // dark surfaces -> light cards / recesses
        '000000':'#1a1814','050505':'#f1eee6','0a0a0a':'#f1eee6','0a0a0c':'#f1eee6',
        '0a0b0d':'#f1eee6','0d0b12':'#ffffff','0d0d0d':'#f1eee6','0d0d13':'#ffffff',
        '0f0f14':'#ffffff','111111':'#ffffff','111117':'#ffffff','111318':'#ffffff',
        '121217':'#ffffff','14121c':'#f3f0f8','14130f':'#f5f2e9','1a1a1a':'#ffffff',
        '1c1830':'#efebf7','201d12':'#f4efe1','10243f':'#e8eef6',
        // near-white / light text -> dark text
        'ffffff':'#1a1814','f4f1e8':'#1a1814','f7e9b0':'#6e5410','d8d8de':'#3a352c',
        'c7cdd7':'#3e4654','d0d0d0':'#44403a','c0c0c0':'#4a463e','a8acb8':'#4c5160',
        'd0e7fa':'#15577f',
        // mid greys -> slightly darker so they read on light
        '808080':'#57534b','85929e':'#4e5660','8d887e':'#57524a','95a5a6':'#4f595a',
        '7f8c8d':'#4c5658','6c7a7d':'#44504e','666666':'#4a4a4a',
        // greens
        '2ecc71':'#0e7a3a','27ae60':'#0c6e33','2e7d32':'#266b2a','1b5e20':'#1b5e20',
        '34d399':'#0c7a48','81c784':'#2e7d32','8ad17a':'#3a8030',
        // teals
        '1abc9c':'#0c8276','00c8b4':'#047a6e','4ecdc4':'#0c857c','147d8a':'#147d8a',
        '1a99aa':'#14707e',
        // golds / ambers / yellows
        'd4af37':'#8c6410','b8941e':'#6e4e0c','cd7f32':'#875322','f0a500':'#945600',
        'f1c40f':'#84680a','f39c12':'#8a5600','f7dc6f':'#7a6000','fbbf24':'#8a6200',
        '8b6914':'#8b6914','fb923c':'#b05312','e67e22':'#ae5414',
        // blues
        '3498db':'#15659e','5dade2':'#0e6398','45b7d1':'#0e7388','60a5fa':'#1e58be',
        '7db7e8':'#15619c','3fa7d6':'#0e6890',
        // reds / pinks
        'e74c3c':'#be3a2c','c0392b':'#b23022','cc0000':'#b00020','ff6b6b':'#c63a30',
        'f87171':'#c03a30','fca5a5':'#be5048','e86a5a':'#be4334','e91e63':'#c2185b',
        'f472b6':'#b23280',
        // purples
        '7c6bf8':'#5538c0','9b8afb':'#6048c8','bb8fce':'#74448e','a5b4fc':'#4f5fc0',
        'a78bfa':'#6244c8','a855f7':'#7a2ec0','c678dd':'#8636a4','9b59b6':'#743a8e',
    };

    // Overlay buckets: warm near-black on light, alpha tuned per elevation.
    const LIGHT_OV = {
        1:'rgba(20,16,8,0.035)', 2:'rgba(20,16,8,0.05)',  3:'rgba(20,16,8,0.06)',
        4:'rgba(20,16,8,0.075)', 5:'rgba(20,16,8,0.09)',  6:'rgba(20,16,8,0.11)',
        7:'rgba(20,16,8,0.2)',   8:'rgba(20,16,8,0.45)',  9:'rgba(20,16,8,0.62)',
    };

    // Gold accent buckets: darker gold so fills/borders show on white.
    const LIGHT_ACC = {
        fill1:'rgba(140,100,16,0.07)', fill2:'rgba(140,100,16,0.10)', fill3:'rgba(140,100,16,0.14)',
        line1:'rgba(140,100,16,0.30)', line2:'rgba(140,100,16,0.42)', line3:'rgba(140,100,16,0.55)',
        line4:'rgba(140,100,16,0.70)',
    };

    const LIGHT_SURF = { solid:'#ffffff', veil:'rgba(255,255,255,0.72)' };

    // Build the `:root[data-wr-theme="light"]` palette declarations.
    function buildLightPaletteCSS() {
        const lines = [];
        for (const k in LIGHT_HEX)  lines.push(`    --k-${k}: ${LIGHT_HEX[k]};`);
        for (const k in LIGHT_OV)   lines.push(`    --ov-${k}: ${LIGHT_OV[k]};`);
        for (const k in LIGHT_ACC)  lines.push(`    --acc-${k}: ${LIGHT_ACC[k]};`);
        for (const k in LIGHT_SURF) lines.push(`    --surf-${k}: ${LIGHT_SURF[k]};`);
        return `:root[data-wr-theme="light"] {\n${lines.join('\n')}\n}\n`;
    }

    // ── Dynamic CSS injection ────────────────────────────────────
    function injectDynamicCSS(themeId) {
        let styleEl = document.getElementById(DYNAMIC_STYLE_ID);
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = DYNAMIC_STYLE_ID;
            document.head.appendChild(styleEl);
        }

        const t = THEMES[themeId] || THEMES.default;
        const c = t.colors || {};

        // Override core CSS custom properties so the ENTIRE app (sidebar,
        // tabs, modals) picks up the theme's palette — not just dashboard
        // widgets that read from WrTheme directly.
        let css = `
:root[data-wr-theme="${themeId}"] {
    --gold: ${c.accent || '#D4AF37'};
    --dark-gold: ${c.accentDark || '#B8941E'};
    /* --page-bg is the backdrop; --black is now the card elevation tone above it. */
    --page-bg: ${c.bg || '#08080B'};
    --black: ${c.card || c.bg || '#14141A'};
    --off-black: ${c.cardHover && c.cardHover.startsWith('#') ? c.cardHover : '#1F1F26'};
    --charcoal: ${c.cardHover || '#2A2A2A'};
    --silver: ${c.textMuted || '#D0D0D0'};
    --white: ${c.text || '#FFFFFF'};
    --text-primary: ${c.text || '#FFFFFF'};
    --text-secondary: ${c.textMuted || '#D0D0D0'};
    --text-muted: ${c.textMuted || '#D0D0D0'};
    --text-faint: ${c.textFaint || 'rgba(255,255,255,0.4)'};
    --surface-0: ${c.bg || '#08080B'};
    --surface-1: ${c.card || c.bg || '#14141A'};
    --surface-2: ${c.cardHover && c.cardHover.startsWith('#') ? c.cardHover : '#1F1F26'};
    --surface-3: ${c.cardHover || '#2A2A2A'};
    --good: ${c.positive || '#2ECC71'};
    --warn: ${c.warn || '#F0A500'};
    --bad: ${c.negative || '#E74C3C'};
    --info: ${c.info || '#3498DB'};
    --purple: ${c.purple || '#7C6BF8'};
    --win-green: ${c.positive || '#2ECC71'};
    --loss-red: ${c.negative || '#E74C3C'};
    --font-title: ${t.fonts?.display || 'Rajdhani, sans-serif'};
    --font-display: var(--font-title);
    --font-body: ${t.fonts?.ui || "'DM Sans', sans-serif"};
    --font-ui: var(--font-body);
    --font-mono: ${t.fonts?.mono || "'JetBrains Mono', monospace"};
}
[data-wr-theme="${themeId}"] body { background: var(--page-bg) !important; }
`;

        // Body background for light mode
        if (c.bg && c.bg !== '#0A0A0A') {
            css += `
[data-wr-theme="${themeId}"] body { background: ${c.bg} !important; }
[data-wr-theme="${themeId}"] .wr-sidebar { background: ${c.card || c.bg} !important; border-color: ${c.border} !important; }
[data-wr-theme="${themeId}"] .wr-main-content { background: ${c.bg} !important; }
[data-wr-theme="${themeId}"] .header {
    background: ${c.card} !important;
    border-bottom-color: ${c.borderHover} !important;
    box-shadow: ${t.card.shadow} !important;
}
[data-wr-theme="${themeId}"] .wr-module-strip,
[data-wr-theme="${themeId}"] .wr-module-nav,
[data-wr-theme="${themeId}"] .wr-module-toolbar,
[data-wr-theme="${themeId}"] .wr-glass {
    background: ${c.card} !important;
    border-color: ${c.border} !important;
}
`;
        }

        if (themeId === 'light') {
            // Palette vars (see buildLightPaletteCSS) drive nearly all inline
            // colors. The class rules below remain as structural belt-and-
            // suspenders for shell containers that have no inline color.
            css += buildLightPaletteCSS();
            css += `
[data-wr-theme="light"] .wr-content-frame,
[data-wr-theme="light"] .wr-content-frame > div,
[data-wr-theme="light"] .wr-module-strip,
[data-wr-theme="light"] .wr-glass,
[data-wr-theme="light"] .tc-trade-root,
[data-wr-theme="light"] .tc-dhq-shell,
[data-wr-theme="light"] .analytics-shell {
    color: ${c.text} !important;
}

[data-wr-theme="light"] .tc-dhq-shell,
[data-wr-theme="light"] .tc-dhq-shell [class*="tc-dhq-"],
[data-wr-theme="light"] .tc-trade-root [class*="tc-card"],
[data-wr-theme="light"] .tc-trade-root [class*="tc-panel"],
[data-wr-theme="light"] .tc-trade-root [class*="tc-package"],
[data-wr-theme="light"] .tc-trade-root [class*="tc-partner"],
[data-wr-theme="light"] .draft-gm-command,
[data-wr-theme="light"] .draft-hq-panel,
[data-wr-theme="light"] .draft-hq-action-card,
[data-wr-theme="light"] .draft-rec-card,
[data-wr-theme="light"] .draft-run-list div,
[data-wr-theme="light"] .mock-draftcast-rail,
[data-wr-theme="light"] .mock-cast-clock,
[data-wr-theme="light"] .mock-cast-controls div,
[data-wr-theme="light"] .mock-status-row div,
[data-wr-theme="light"] .mock-panel,
[data-wr-theme="light"] .mock-opponent-shell,
[data-wr-theme="light"] .mock-trade-card {
    background: ${c.card} !important;
    color: ${c.text} !important;
    border-color: ${c.border} !important;
    box-shadow: ${t.card.shadow} !important;
}

[data-wr-theme="light"] .wr-content-frame [style*="color: var(--white)"],
[data-wr-theme="light"] .wr-content-frame [style*="color:var(--white)"],
[data-wr-theme="light"] .wr-content-frame [style*="color: var(--text-primary)"],
[data-wr-theme="light"] .wr-content-frame [style*="color:var(--text-primary)"] {
    color: ${c.text} !important;
}

[data-wr-theme="light"] .wr-content-frame [style*="color: var(--silver)"],
[data-wr-theme="light"] .wr-content-frame [style*="color:var(--silver)"],
[data-wr-theme="light"] .wr-content-frame [style*="color: var(--text-secondary)"],
[data-wr-theme="light"] .wr-content-frame [style*="color:var(--text-secondary)"] {
    color: ${c.textMuted} !important;
    opacity: 1 !important;
}

[data-wr-theme="light"] .wr-content-frame table,
[data-wr-theme="light"] .wr-content-frame tr,
[data-wr-theme="light"] .wr-content-frame td,
[data-wr-theme="light"] .wr-content-frame th {
    color: ${c.text} !important;
}

/* Analytics module: its structural panel/card/table CSS lives in index.html with
   hardcoded white/gold rgba fills (not codemod vars), so it does NOT flip on its own
   and renders washed-out (near-white on white) in light mode. Repaint the structural
   surfaces here. The semantic signal-severity (.analytics-signal-*) and delta indicator
   (.analytics-delta-fill/-benchmark) classes are intentionally left alone so their
   color coding survives. */
[data-wr-theme="light"] .analytics-panel,
[data-wr-theme="light"] .analytics-kpi,
[data-wr-theme="light"] .analytics-signal,
[data-wr-theme="light"] .analytics-readout,
[data-wr-theme="light"] .analytics-mini-table,
[data-wr-theme="light"] .analytics-evidence-head,
[data-wr-theme="light"] .analytics-embed-summary,
[data-wr-theme="light"] .analytics-embed-summary > div,
[data-wr-theme="light"] .analytics-pick-strip,
[data-wr-theme="light"] .analytics-pick-leaders,
[data-wr-theme="light"] .analytics-proof-card,
[data-wr-theme="light"] .analytics-era-card,
[data-wr-theme="light"] .analytics-lab-card,
[data-wr-theme="light"] .analytics-command-panel,
[data-wr-theme="light"] .analytics-report-lab,
[data-wr-theme="light"] .analytics-report-preview,
[data-wr-theme="light"] .analytics-report-templates,
[data-wr-theme="light"] .analytics-head-meta,
[data-wr-theme="light"] .analytics-data-row {
    background: ${c.card} !important;
    border-color: ${c.border} !important;
    color: ${c.text} !important;
    box-shadow: ${t.card.shadow} !important;
}
[data-wr-theme="light"] .analytics-room-chip,
[data-wr-theme="light"] .analytics-filter-row,
[data-wr-theme="light"] .analytics-definition,
[data-wr-theme="light"] .analytics-delta-track {
    background: ${c.cardHover} !important;
    border-color: ${c.border} !important;
    color: ${c.text} !important;
}
[data-wr-theme="light"] .analytics-shell {
    background: ${c.bg} !important;
}
`;
        }


        if (t.effects.scanlines) {
            css += `
[data-wr-theme="${themeId}"] .wr-widget {
    position: relative;
}
[data-wr-theme="${themeId}"] .wr-widget::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
        0deg,
        transparent 0px, transparent 2px,
        rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px
    );
    pointer-events: none;
    z-index: 10;
    border-radius: ${t.card.radius};
}
`;
        }

        if (t.effects.glow) {
            css += `
[data-wr-theme="${themeId}"] .wr-data-value {
    text-shadow: 0 0 6px currentColor;
}
[data-wr-theme="${themeId}"] .wr-widget {
    box-shadow: ${t.card.shadow};
}
`;
        }

        // Override dashboard background
        css += `
[data-wr-theme="${themeId}"] .wr-dashboard-grid {
    background: ${t.colors.bg} !important;
}
`;

        styleEl.textContent = css;
    }

    // ── Public API ───────────────────────────────────────────────
    const WrTheme = {
        /** All registered themes */
        themes: THEMES,

        /** Current theme ID */
        current: 'default',

        /** Get the active theme object */
        get: function() {
            return THEMES[normalizeThemeId(this.current)] || THEMES.default;
        },

        /** Switch theme by ID, persist, apply CSS */
        set: function(id) {
            if (!THEMES[id]) return;
            const nextId = normalizeThemeId(id);
            this.current = nextId;
            try { localStorage.setItem(LS_KEY, nextId); } catch (e) {}
            document.documentElement.setAttribute('data-wr-theme', nextId);
            injectDynamicCSS(nextId);
            // Dispatch event so React components can re-render
            window.dispatchEvent(new CustomEvent('wr_theme_changed', { detail: { theme: nextId } }));
        },

        /** List available theme IDs */
        list: function() {
            return Object.keys(THEMES).filter(themeId => isThemeAllowed(themeId));
        },

        /** List every registered theme, including sandbox-only repair themes. */
        listAll: function() {
            return Object.keys(THEMES);
        },

        /** Whether a theme is available in the current runtime. */
        isAvailable: function(id) {
            return isThemeAllowed(id);
        },

        /** Whether the current runtime can expose sandbox-only themes. */
        isSandboxMode: function() {
            return isSandboxThemeMode();
        },

        // ── Convenience accessors ────────────────────────────────
        color: function(key) { return this.get().colors[key]; },
        font:  function(key) { return this.get().fonts[key]; },

        /** Returns a full card style object for React inline styles */
        cardStyle: function(extra) {
            const t = this.get();
            return Object.assign({
                background: t.card.background,
                border: t.card.border,
                borderRadius: t.card.radius,
                boxShadow: t.card.shadow,
                overflow: 'hidden',
                height: '100%',
                transition: t.effects.transition,
            }, extra || {});
        },

        /** Returns a hover card style delta */
        cardHoverStyle: function() {
            const t = this.get();
            return {
                border: t.card.borderHover,
                boxShadow: t.card.shadowHover,
                background: t.colors.cardHover,
            };
        },

        /** Scale a font size by the theme's size multiplier */
        fontSize: function(baseRem) {
            return (baseRem * this.get().fonts.sizeScale) + 'rem';
        },

        /** Badge style (pills, chips) */
        badgeStyle: function(color, bg) {
            const t = this.get();
            return {
                fontSize: this.fontSize(0.6),
                fontWeight: t.badge.fontWeight,
                padding: '1px 6px',
                borderRadius: t.badge.radius,
                background: bg || (color + '18'),
                color: color || t.colors.accent,
                border: '1px solid ' + (color || t.colors.accent) + '44',
            };
        },
    };

    // ── Initialize from localStorage ─────────────────────────────
    try {
        const saved = localStorage.getItem(LS_KEY);
        if (saved && THEMES[saved]) {
            WrTheme.current = normalizeThemeId(saved);
            if (WrTheme.current !== saved) localStorage.setItem(LS_KEY, WrTheme.current);
        }
    } catch (e) {}

    // Apply initial theme
    document.documentElement.setAttribute('data-wr-theme', WrTheme.current);
    injectDynamicCSS(WrTheme.current);

    window.WrTheme = WrTheme;
})();
