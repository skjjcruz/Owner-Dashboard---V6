// ══════════════════════════════════════════════════════════════════
// saved-views.js — Shared "Saved List Views" infrastructure (SI-1)
// Reusable across My Roster, Free Agency, All Players, Big Board, Analytics.
//
// Public API (all on window.WR.SavedViews):
//   list(surface, leagueId)            → Array<View>
//   get(surface, leagueId, id)         → View | null
//   save(surface, leagueId, view)      → View  (upserts by id; generates id if missing)
//   remove(surface, leagueId, id)      → void
//   setDefault(surface, leagueId, id)  → void  (only one default per surface)
//   getDefault(surface, leagueId)      → View | null
//   SavedViewBar                       → React component
//
// View schema:
//   { id, name, surface, columns: string[], sort: { key, dir },
//     filters: object, isDefault: boolean, createdAt: number }
// ══════════════════════════════════════════════════════════════════
(function () {
    const WrStorage = window.App && window.App.WrStorage;
    if (!WrStorage) { console.warn('[SavedViews] WrStorage not available'); return; }

    const SURFACES = new Set(['roster', 'free_agency', 'all_players', 'big_board']);

    function storageKey(surface, leagueId) {
        return `wr_list_views_${surface}_${leagueId || 'global'}`;
    }

    function readAll(surface, leagueId) {
        if (!SURFACES.has(surface)) {
            console.warn('[SavedViews] unknown surface:', surface);
            return [];
        }
        const raw = WrStorage.get(storageKey(surface, leagueId), []);
        return Array.isArray(raw) ? raw : [];
    }

    function writeAll(surface, leagueId, views) {
        WrStorage.set(storageKey(surface, leagueId), views);
    }

    function genId() {
        return 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    const API = {
        list(surface, leagueId) {
            return readAll(surface, leagueId).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        },
        get(surface, leagueId, id) {
            return readAll(surface, leagueId).find(v => v.id === id) || null;
        },
        save(surface, leagueId, view) {
            if (!view || !view.name) throw new Error('saved view requires a name');
            const views = readAll(surface, leagueId);
            const now = Date.now();
            const cleaned = {
                id: view.id || genId(),
                name: String(view.name).trim().slice(0, 48),
                surface,
                columns: Array.isArray(view.columns) ? view.columns.slice() : [],
                sort: view.sort ? { key: view.sort.key, dir: view.sort.dir || 1 } : null,
                filters: view.filters && typeof view.filters === 'object' ? { ...view.filters } : {},
                isDefault: !!view.isDefault,
                createdAt: view.createdAt || now,
                updatedAt: now,
            };
            const idx = views.findIndex(v => v.id === cleaned.id);
            if (idx >= 0) views[idx] = { ...views[idx], ...cleaned };
            else views.push(cleaned);
            writeAll(surface, leagueId, views);
            return cleaned;
        },
        remove(surface, leagueId, id) {
            const views = readAll(surface, leagueId).filter(v => v.id !== id);
            writeAll(surface, leagueId, views);
        },
        setDefault(surface, leagueId, id) {
            const views = readAll(surface, leagueId).map(v => ({ ...v, isDefault: v.id === id }));
            writeAll(surface, leagueId, views);
        },
        getDefault(surface, leagueId) {
            return readAll(surface, leagueId).find(v => v.isDefault) || null;
        },
    };

    // ── React component: SavedViewBar ─────────────────────────────
    // Props:
    //   surface         — one of SURFACES
    //   leagueId        — current league id (or null for global)
    //   currentState    — { columns, sort, filters } — captured on "Save as"
    //   onApply(view)   — caller applies view.columns / view.sort / view.filters to their UI
    //   label           — optional button label prefix (default "VIEW")
    function SavedViewBar(props) {
        const { useState, useEffect, useMemo } = React;
        const { surface, leagueId, currentState, onApply, label } = props;
        const [views, setViews] = useState(() => API.list(surface, leagueId));
        const [activeId, setActiveId] = useState(null);
        const [menuOpen, setMenuOpen] = useState(false);
        const [saveDialog, setSaveDialog] = useState(null); // { name, replacingId? }

        // Apply default view on mount (once per league/surface)
        useEffect(() => {
            const def = API.getDefault(surface, leagueId);
            if (def) {
                setActiveId(def.id);
                if (typeof onApply === 'function') onApply(def);
            }
        }, [surface, leagueId]);

        function refresh() { setViews(API.list(surface, leagueId)); }

        function doApply(v) {
            setActiveId(v.id); setMenuOpen(false);
            if (typeof onApply === 'function') onApply(v);
        }
        function doSaveNew() {
            const name = (saveDialog.name || '').trim();
            if (!name) return;
            const saved = API.save(surface, leagueId, {
                name,
                columns: currentState.columns || [],
                sort: currentState.sort || null,
                filters: currentState.filters || {},
            });
            setSaveDialog(null); setActiveId(saved.id); refresh();
        }
        function doUpdate() {
            if (!activeId) return;
            const existing = API.get(surface, leagueId, activeId);
            if (!existing) return;
            API.save(surface, leagueId, {
                ...existing,
                columns: currentState.columns || [],
                sort: currentState.sort || null,
                filters: currentState.filters || {},
            });
            refresh();
        }
        function doDelete(id) {
            if (!confirm('Delete this saved view?')) return;
            API.remove(surface, leagueId, id);
            if (activeId === id) setActiveId(null);
            refresh();
        }
        function doToggleDefault(id) {
            const v = API.get(surface, leagueId, id);
            if (!v) return;
            if (v.isDefault) {
                // un-set default by saving with isDefault false
                API.save(surface, leagueId, { ...v, isDefault: false });
            } else {
                API.setDefault(surface, leagueId, id);
            }
            refresh();
        }

        const activeView = activeId ? views.find(v => v.id === activeId) : null;
        const lbl = label || 'VIEW';

        const btnBase = {
            padding: '3px 10px', fontSize: 'var(--text-label)', fontFamily: 'var(--font-body)',
            textTransform: 'uppercase', background: 'var(--ov-3, rgba(255,255,255,0.04))',
            color: 'var(--silver)', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))',
            borderRadius: 'var(--card-radius-sm)', cursor: 'pointer', letterSpacing: '0.03em',
            minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        };
        const btnActive = { ...btnBase, background: 'var(--gold)', color: 'var(--black)', border: '1px solid var(--gold)', fontWeight: 700 };

        return React.createElement('div', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', position: 'relative' } },
            React.createElement('span', { style: { fontSize: 'var(--text-label)', color: 'var(--silver)', opacity: 0.65, fontFamily: 'var(--font-body)' } }, lbl + ':'),
            // View selector (dropdown trigger)
            React.createElement('button', {
                onClick: () => setMenuOpen(!menuOpen),
                style: activeView ? btnActive : btnBase,
                title: 'Select saved view'
            }, (activeView ? activeView.name : 'Default') + ' \u25BE'),
            // Save as... (always visible)
            React.createElement('button', {
                onClick: () => setSaveDialog({ name: '' }),
                style: btnBase, title: 'Save current column/sort/filter selection as a new view'
            }, 'Save as'),
            // Update (only if an active view exists)
            activeView ? React.createElement('button', {
                onClick: doUpdate, style: btnBase, title: 'Update the active view with current settings'
            }, 'Update') : null,

            // Dropdown menu
            menuOpen ? React.createElement('div', {
                style: {
                    position: 'absolute', top: '28px', left: 0, zIndex: 50,
                    background: 'var(--k-0a0a0a, #0a0a0a)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))',
                    borderRadius: '6px', padding: '4px', minWidth: '240px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
                },
                onClick: (e) => e.stopPropagation()
            },
                views.length === 0
                    ? React.createElement('div', { style: { padding: '8px 10px', fontSize: 'var(--text-label)', color: 'var(--silver)', opacity: 0.6 } }, 'No saved views yet.')
                    : views.map(v => React.createElement('div', {
                        key: v.id,
                        style: {
                            display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px',
                            borderRadius: 'var(--card-radius-sm)', cursor: 'pointer', minHeight: '44px',
                            background: v.id === activeId ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent'
                        },
                        onClick: () => doApply(v)
                    },
                        React.createElement('span', { style: { flex: 1, fontSize: 'var(--text-body)', color: v.id === activeId ? 'var(--gold)' : 'var(--white)' } }, v.name),
                        v.isDefault ? React.createElement('span', { style: { fontSize: 'var(--text-micro)', color: 'var(--gold)', letterSpacing: '0.05em', textTransform: 'uppercase' } }, 'default') : null,
                        React.createElement('button', {
                            title: v.isDefault ? 'Unset as default' : 'Set as default for this league',
                            onClick: (e) => { e.stopPropagation(); doToggleDefault(v.id); },
                            style: { ...btnBase, padding: '1px 6px', fontSize: 'var(--text-label)', minWidth: '44px' }
                        }, v.isDefault ? '\u2605' : '\u2606'),
                        React.createElement('button', {
                            title: 'Delete view',
                            onClick: (e) => { e.stopPropagation(); doDelete(v.id); },
                            style: { ...btnBase, padding: '1px 6px', fontSize: 'var(--text-label)', minWidth: '44px', color: 'var(--bad)', border: '1px solid rgba(231,76,60,0.3)' }
                        }, '\u2715')
                    ))
            ) : null,

            // Save dialog
            saveDialog ? React.createElement('div', {
                style: {
                    position: 'absolute', top: '28px', left: 0, zIndex: 60,
                    background: 'var(--k-0a0a0a, #0a0a0a)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))',
                    borderRadius: '6px', padding: '10px', minWidth: '260px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)'
                },
                onClick: (e) => e.stopPropagation()
            },
                React.createElement('div', { style: { fontSize: 'var(--text-label)', color: 'var(--gold)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' } }, 'Save current view'),
                React.createElement('input', {
                    type: 'text', autoFocus: true,
                    value: saveDialog.name,
                    onChange: (e) => setSaveDialog({ ...saveDialog, name: e.target.value }),
                    onKeyDown: (e) => { if (e.key === 'Enter') doSaveNew(); if (e.key === 'Escape') setSaveDialog(null); },
                    placeholder: 'View name',
                    style: { width: '100%', padding: '6px 8px', fontSize: 'var(--text-body)', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 'var(--card-radius-sm)', color: 'var(--white)', marginBottom: '8px', fontFamily: 'var(--font-body)', minHeight: '44px' }
                }),
                React.createElement('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } },
                    React.createElement('button', { onClick: () => setSaveDialog(null), style: btnBase }, 'Cancel'),
                    React.createElement('button', { onClick: doSaveNew, style: btnActive, disabled: !saveDialog.name.trim() }, 'Save')
                )
            ) : null
        );
    }

    // ── Global click-outside handler for menu dismissal ────────────
    // (Simpler than per-component; we rely on click propagation to close.)
    if (typeof document !== 'undefined') {
        document.addEventListener('click', () => {
            // Menus close on next React tick via state — no-op here but reserved.
        }, false);
    }

    window.WR = window.WR || {};
    window.WR.SavedViews = { ...API, SavedViewBar };
    window.SavedViewBar = SavedViewBar; // convenience for legacy scope
})();
