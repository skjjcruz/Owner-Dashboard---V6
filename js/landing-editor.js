(function () {
  'use strict';

  const API_URL = 'api/landing-content';
  const state = {
    data: null,
    pageKey: '',
    dirty: false,
  };

  const statusEl = document.getElementById('status');
  const tabsEl = document.getElementById('tabs');
  const fieldsEl = document.getElementById('fields');
  const saveBtn = document.getElementById('saveBtn');
  const reloadBtn = document.getElementById('reloadBtn');
  const previewBtn = document.getElementById('previewBtn');
  const filterEl = document.getElementById('filter');
  const previewEl = document.getElementById('preview');

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = `status ${kind || ''}`.trim();
  }

  function labelFromPath(pathParts) {
    return pathParts
      .filter(part => part !== 'pages' && part !== state.pageKey)
      .map(part => String(part)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]/g, ' '))
      .join(' / ');
  }

  function labelFromEditPath(editPath) {
    return labelFromPath(String(editPath).split('.'));
  }

  function isEditablePrimitive(value) {
    return ['string', 'number', 'boolean'].includes(typeof value);
  }

  function flattenEditable(obj, pathParts) {
    if (isEditablePrimitive(obj)) {
      return [{ path: pathParts, value: obj }];
    }
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj).flatMap(([key, value]) => {
      if (key.startsWith('_')) return [];
      return flattenEditable(value, [...pathParts, key]);
    });
  }

  function getByPath(pathParts) {
    return pathParts.reduce((current, key) => current?.[key], state.data);
  }

  function setByPath(pathParts, value) {
    const finalKey = pathParts[pathParts.length - 1];
    const parent = pathParts.slice(0, -1).reduce((current, key) => current[key], state.data);
    const previous = parent[finalKey];
    if (typeof previous === 'number') {
      const parsed = Number(value);
      parent[finalKey] = Number.isNaN(parsed) ? previous : parsed;
    } else if (typeof previous === 'boolean') {
      parent[finalKey] = value === 'true';
    } else {
      parent[finalKey] = value;
    }
  }

  function getPageKeys() {
    return Object.keys(state.data?.pages || {});
  }

  function getPageMeta(key) {
    return state.data?.pages?.[key]?._editor || {};
  }

  function refreshPreview() {
    const meta = getPageMeta(state.pageKey);
    const path = meta.previewPath || 'landing.html';
    previewEl.src = `${path}?landingPreview=${Date.now()}`;
  }

  function findField(editPath) {
    return Array.from(fieldsEl.querySelectorAll('.field'))
      .find(field => field.dataset.editPath === editPath);
  }

  function focusField(editPath) {
    let field = findField(editPath);
    if (!field && filterEl.value) {
      filterEl.value = '';
      applyFilter();
      field = findField(editPath);
    }
    if (!field) {
      setStatus(`No editor field found for ${editPath}`, 'error');
      return;
    }
    fieldsEl.querySelectorAll('.field.active').forEach(el => el.classList.remove('active'));
    field.classList.add('active');
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const control = field.querySelector('input,textarea');
    if (control) {
      control.focus({ preventScroll: true });
      if (typeof control.select === 'function') control.select();
    }
    setStatus(`Editing: ${labelFromEditPath(editPath)}`, '');
  }

  function installPreviewClickTargets() {
    let doc;
    try {
      doc = previewEl.contentDocument;
    } catch (_err) {
      return;
    }
    if (!doc || doc.__dhqClickToEditInstalled) return;
    doc.__dhqClickToEditInstalled = true;

    const style = doc.createElement('style');
    style.textContent = `
      [data-dhq-edit-path] {
        cursor: pointer !important;
        outline-offset: 3px;
        transition: outline-color .12s ease, box-shadow .12s ease, background-color .12s ease;
      }
      [data-dhq-edit-path]:hover {
        outline: 2px solid #d4af37 !important;
        box-shadow: 0 0 0 6px rgba(212, 175, 55, .18) !important;
        background-color: rgba(212, 175, 55, .08) !important;
      }
      .dhq-edit-tooltip {
        position: fixed;
        z-index: 2147483647;
        max-width: 280px;
        padding: 7px 9px;
        border-radius: 7px;
        background: rgba(10,10,10,.92);
        color: #d4af37;
        border: 1px solid rgba(212,175,55,.45);
        font: 700 12px/1.3 Inter, system-ui, sans-serif;
        pointer-events: none;
        transform: translate(12px, 12px);
      }
    `;
    doc.head.appendChild(style);

    const tooltip = doc.createElement('div');
    tooltip.className = 'dhq-edit-tooltip';
    tooltip.hidden = true;
    doc.body.appendChild(tooltip);

    doc.addEventListener('mousemove', evt => {
      const target = evt.target.closest?.('[data-dhq-edit-path]');
      if (!target) {
        tooltip.hidden = true;
        return;
      }
      tooltip.hidden = false;
      tooltip.textContent = labelFromEditPath(target.dataset.dhqEditPath);
      tooltip.style.left = `${evt.clientX}px`;
      tooltip.style.top = `${evt.clientY}px`;
    }, true);

    doc.addEventListener('mouseleave', () => {
      tooltip.hidden = true;
    }, true);

    doc.addEventListener('click', evt => {
      const target = evt.target.closest?.('[data-dhq-edit-path]');
      if (!target) return;
      evt.preventDefault();
      evt.stopPropagation();
      evt.stopImmediatePropagation();
      focusField(target.dataset.dhqEditPath);
    }, true);
  }

  function markDirty() {
    state.dirty = true;
    setStatus('Unsaved changes', '');
  }

  function renderTabs() {
    const keys = getPageKeys();
    tabsEl.replaceChildren(...keys.map(key => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `tab ${key === state.pageKey ? 'active' : ''}`.trim();
      tab.textContent = getPageMeta(key).label || key;
      tab.addEventListener('click', () => {
        state.pageKey = key;
        render();
        refreshPreview();
      });
      return tab;
    }));
  }

  function createField(field) {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    wrapper.dataset.pathText = labelFromPath(field.path).toLowerCase();
    wrapper.dataset.editPath = field.path.join('.');

    const label = document.createElement('label');
    label.textContent = labelFromPath(field.path);

    const path = document.createElement('div');
    path.className = 'path';
    path.textContent = field.path.join('.');

    const control = String(field.value).length > 80
      ? document.createElement('textarea')
      : document.createElement('input');
    if (control.tagName === 'INPUT') control.type = 'text';
    control.value = String(getByPath(field.path));
    control.dataset.path = JSON.stringify(field.path);
    control.addEventListener('input', evt => {
      setByPath(JSON.parse(evt.target.dataset.path), evt.target.value);
      markDirty();
    });

    wrapper.append(label, path, control);
    return wrapper;
  }

  function applyFilter() {
    const query = filterEl.value.trim().toLowerCase();
    Array.from(fieldsEl.children).forEach(child => {
      child.style.display = !query || child.dataset.pathText.includes(query) ? '' : 'none';
    });
  }

  function renderFields() {
    const page = state.data?.pages?.[state.pageKey];
    if (!page) {
      fieldsEl.innerHTML = '<div class="empty">No editable page content found.</div>';
      return;
    }
    const fields = flattenEditable(page, ['pages', state.pageKey]);
    fieldsEl.replaceChildren(...fields.map(createField));
    applyFilter();
  }

  function render() {
    renderTabs();
    renderFields();
  }

  async function loadContent() {
    setStatus('Loading...', '');
    const res = await fetch(API_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Content load failed: ${res.status}`);
    state.data = await res.json();
    state.pageKey = state.pageKey || getPageKeys()[0] || '';
    state.dirty = false;
    render();
    refreshPreview();
    setStatus('Loaded', 'saved');
  }

  async function saveContent() {
    saveBtn.disabled = true;
    setStatus('Saving...', '');
    try {
      const res = await fetch(API_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Save failed: ${res.status}`);
      state.dirty = false;
      setStatus('Saved', 'saved');
      refreshPreview();
    } catch (err) {
      setStatus(err.message || 'Save failed', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  saveBtn.addEventListener('click', saveContent);
  reloadBtn.addEventListener('click', loadContent);
  previewBtn.addEventListener('click', refreshPreview);
  filterEl.addEventListener('input', applyFilter);
  previewEl.addEventListener('load', installPreviewClickTargets);
  window.addEventListener('beforeunload', evt => {
    if (!state.dirty) return;
    evt.preventDefault();
    evt.returnValue = '';
  });

  loadContent().catch(err => {
    fieldsEl.innerHTML = '<div class="empty">Start the local editor server with npm run landing:edit, then reload this page.</div>';
    setStatus(err.message || 'Load failed', 'error');
  });
})();
