/* ============================================================
 * DHQ Feedback Hub  [v1]
 * One shared module that wires up:
 *   1. A floating "Feedback" launcher (bug report + feature board)
 *   2. "Report a bug" modal  -> report-bug edge function  (kind:'user')
 *   3. Global crash capture   -> report-bug edge function  (kind:'crash')
 *   4. Feature voting board    -> feature-requests edge function
 *
 * Depends only on window.OD.getClient() (the app's supabase-js client,
 * which carries the logged-in session JWT). Everything degrades quietly
 * if the client or a session isn't available yet.
 *
 * Public API (also usable from Settings, menus, etc.):
 *   window.WR.Feedback.reportBug()   -> open the bug modal
 *   window.WR.Feedback.openBoard()   -> open the voting board
 * ============================================================ */
(function () {
  'use strict';
  if (window.WR && window.WR.Feedback) return; // idempotent
  window.WR = window.WR || {};

  // ── tiny helpers ────────────────────────────────────────────────
  function getClient() {
    try { return (window.OD && typeof window.OD.getClient === 'function') ? window.OD.getClient() : null; }
    catch (e) { return null; }
  }
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ── auto-context (silently attached to every report) ────────────
  function tier() {
    try {
      if (typeof window.getUserTier === 'function') return window.getUserTier();
      if (window.OD && typeof window.OD.getUserTier === 'function') return window.OD.getUserTier();
      if (typeof window.isPro === 'function') return window.isPro() ? 'pro' : 'free';
    } catch (e) {}
    return 'unknown';
  }
  function username() {
    try { return (window.OD && window.OD.getCurrentUsername && window.OD.getCurrentUsername()) || null; }
    catch (e) { return null; }
  }
  function leagueId() {
    try { return (window.S && window.S.currentLeagueId) || null; } catch (e) { return null; }
  }
  function platform() {
    // Web-only build — the iOS app ships its own copy that reports its platform.
    return 'web';
  }
  function appVersion() {
    try {
      var m = document.querySelector('meta[name="app-version"]');
      return (window.APP_VERSION || (m && m.content) || 'unknown');
    } catch (e) { return 'unknown'; }
  }
  function pageRef() {
    // pathname + hash only — never the query string (may carry tokens/PII)
    try { return location.pathname + (location.hash || ''); } catch (e) { return ''; }
  }
  function baseContext() {
    return { url: pageRef(), leagueId: leagueId(), tier: tier(), platform: platform(), appVersion: appVersion() };
  }

  // ── styles (scoped, War Room tokens; sharp corners, mono labels) ─
  function injectStyles() {
    if (document.getElementById('dhqfb-styles')) return;
    var css = [
      ':root{--dhqfb-bg0:#0A0C10;--dhqfb-bg1:#12151B;--dhqfb-bg2:#1A1F27;--dhqfb-inset:#0C0E13;',
      '--dhqfb-bd:#232932;--dhqfb-bds:#333A45;--dhqfb-t1:#E6E9ED;--dhqfb-t2:#98A1AD;--dhqfb-t3:#5A626E;',
      '--dhqfb-forge:#FF6A1A;--dhqfb-forge2:#FF8742;--dhqfb-tac:#4A9DDE;--dhqfb-pos:#2FBF88;--dhqfb-neg:#F0495C;',
      "--dhqfb-mono:'IBM Plex Mono','SFMono-Regular',ui-monospace,monospace;--dhqfb-sans:'IBM Plex Sans',system-ui,-apple-system,sans-serif;}",
      '.dhqfb-launch{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;',
      'font:500 12px/1 var(--dhqfb-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--dhqfb-bg0);',
      'background:var(--dhqfb-forge);border:1px solid var(--dhqfb-forge);border-radius:2px;padding:9px 12px;cursor:pointer;',
      'box-shadow:0 4px 18px rgba(0,0,0,.45);transition:background 90ms ease}',
      '.dhqfb-launch:hover{background:var(--dhqfb-forge2)}',
      '.dhqfb-launch svg{width:14px;height:14px;display:block}',
      '.dhqfb-menu{position:fixed;right:16px;bottom:60px;z-index:2147483000;background:var(--dhqfb-bg1);border:1px solid var(--dhqfb-bds);',
      'border-radius:2px;min-width:210px;box-shadow:0 8px 32px rgba(0,0,0,.6);overflow:hidden}',
      '.dhqfb-menu button{display:flex;width:100%;align-items:center;gap:8px;background:transparent;border:0;border-bottom:1px solid var(--dhqfb-bd);',
      'color:var(--dhqfb-t1);font:400 13px/1.3 var(--dhqfb-mono);text-align:left;padding:11px 13px;cursor:pointer}',
      '.dhqfb-menu button:last-child{border-bottom:0}',
      '.dhqfb-menu button:hover{background:var(--dhqfb-bg2);color:var(--dhqfb-forge)}',
      '.dhqfb-ov{position:fixed;inset:0;z-index:2147483001;background:rgba(4,6,10,.72);display:flex;align-items:flex-start;',
      'justify-content:center;padding:5vh 16px;overflow-y:auto}',
      '.dhqfb-modal{background:var(--dhqfb-bg1);border:1px solid var(--dhqfb-bds);border-radius:2px;width:100%;max-width:460px;',
      'box-shadow:0 8px 32px rgba(0,0,0,.6);animation:dhqfb-in 140ms ease}',
      '.dhqfb-board{max-width:760px}',
      '@keyframes dhqfb-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
      '.dhqfb-hd{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;border-bottom:1px solid var(--dhqfb-bd);',
      'border-left:3px solid var(--dhqfb-forge)}',
      '.dhqfb-hd.tac{border-left-color:var(--dhqfb-tac)}',
      '.dhqfb-hd h3{margin:0;font:600 14px/1.2 var(--dhqfb-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--dhqfb-t1)}',
      '.dhqfb-x{background:transparent;border:0;color:var(--dhqfb-t2);font-size:20px;line-height:1;cursor:pointer;padding:2px 6px}',
      '.dhqfb-x:hover{color:var(--dhqfb-t1)}',
      '.dhqfb-bd{padding:14px}',
      '.dhqfb-lbl{display:block;font:500 11px/1.2 var(--dhqfb-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--dhqfb-t3);margin:0 0 5px}',
      '.dhqfb-in,.dhqfb-ta,.dhqfb-sel{width:100%;box-sizing:border-box;background:var(--dhqfb-inset);border:1px solid var(--dhqfb-bd);border-radius:2px;',
      'color:var(--dhqfb-t1);font:400 13px/1.4 var(--dhqfb-sans);padding:8px 10px;margin-bottom:12px}',
      '.dhqfb-in:focus,.dhqfb-ta:focus,.dhqfb-sel:focus{outline:2px solid var(--dhqfb-forge);outline-offset:1px;border-color:var(--dhqfb-forge)}',
      '.dhqfb-ta{min-height:96px;resize:vertical}',
      '.dhqfb-row{display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:4px}',
      '.dhqfb-btn{font:500 12px/1 var(--dhqfb-mono);letter-spacing:.04em;padding:9px 15px;border-radius:2px;border:1px solid transparent;cursor:pointer;transition:90ms ease}',
      '.dhqfb-btn.pri{background:var(--dhqfb-forge);color:var(--dhqfb-bg0)}.dhqfb-btn.pri:hover{background:var(--dhqfb-forge2)}',
      '.dhqfb-btn.sec{background:transparent;border-color:var(--dhqfb-bds);color:var(--dhqfb-t1)}.dhqfb-btn.sec:hover{border-color:var(--dhqfb-forge);color:var(--dhqfb-forge)}',
      '.dhqfb-btn:disabled{opacity:.5;cursor:default}',
      '.dhqfb-note{font:400 11px/1.4 var(--dhqfb-mono);color:var(--dhqfb-t3);margin:0 0 12px}',
      '.dhqfb-msg{font:400 12px/1.4 var(--dhqfb-sans);margin:0 14px 12px;padding:8px 10px;border-radius:2px;border:1px solid}',
      '.dhqfb-msg.ok{color:var(--dhqfb-pos);border-color:var(--dhqfb-pos);background:rgba(47,191,136,.08)}',
      '.dhqfb-msg.err{color:var(--dhqfb-neg);border-color:var(--dhqfb-neg);background:rgba(240,73,92,.08)}',
      // board
      '.dhqfb-filters{display:flex;gap:6px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--dhqfb-bd)}',
      '.dhqfb-chip{font:500 11px/1 var(--dhqfb-mono);letter-spacing:.06em;text-transform:uppercase;padding:5px 9px;border:1px solid var(--dhqfb-bd);',
      'border-radius:2px;background:transparent;color:var(--dhqfb-t2);cursor:pointer}',
      '.dhqfb-chip.on{border-color:var(--dhqfb-forge);color:var(--dhqfb-forge)}',
      '.dhqfb-list{max-height:52vh;overflow-y:auto}',
      '.dhqfb-item{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:12px 14px;border-bottom:1px solid var(--dhqfb-bd);align-items:start}',
      '.dhqfb-vote{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:46px;background:var(--dhqfb-inset);',
      'border:1px solid var(--dhqfb-bd);border-radius:2px;padding:6px 4px;cursor:pointer;color:var(--dhqfb-t2);transition:90ms ease}',
      '.dhqfb-vote:hover{border-color:var(--dhqfb-tac);color:var(--dhqfb-tac)}',
      '.dhqfb-vote.on{border-color:var(--dhqfb-forge);color:var(--dhqfb-forge)}',
      '.dhqfb-vote .ar{font-size:12px;line-height:1}',
      '.dhqfb-vote .ct{font:600 15px/1.1 var(--dhqfb-mono);font-variant-numeric:tabular-nums;color:var(--dhqfb-t1)}',
      '.dhqfb-it-title{font:500 14px/1.3 var(--dhqfb-sans);color:var(--dhqfb-t1);margin:0 0 3px}',
      '.dhqfb-it-desc{font:400 12px/1.45 var(--dhqfb-sans);color:var(--dhqfb-t2);margin:0 0 6px;white-space:pre-wrap}',
      '.dhqfb-pill{display:inline-block;font:500 10px/1 var(--dhqfb-mono);letter-spacing:.06em;text-transform:uppercase;padding:3px 6px;',
      'border:1px solid;border-radius:2px;margin-right:6px}',
      '.dhqfb-pill.open{color:var(--dhqfb-t2);border-color:var(--dhqfb-bds)}',
      '.dhqfb-pill.planned{color:var(--dhqfb-tac);border-color:var(--dhqfb-tac)}',
      '.dhqfb-pill.in_progress{color:var(--dhqfb-forge);border-color:var(--dhqfb-forge)}',
      '.dhqfb-pill.shipped{color:var(--dhqfb-pos);border-color:var(--dhqfb-pos)}',
      '.dhqfb-pill.declined{color:var(--dhqfb-t3);border-color:var(--dhqfb-bd)}',
      '.dhqfb-meta{font:400 10px/1.2 var(--dhqfb-mono);color:var(--dhqfb-t3)}',
      '.dhqfb-empty{padding:28px 14px;text-align:center;color:var(--dhqfb-t3);font:400 13px/1.5 var(--dhqfb-sans)}',
      '@media (max-width:520px){.dhqfb-launch{right:12px;bottom:12px}}',
      '@media (prefers-reduced-motion:reduce){.dhqfb-modal{animation:none}}',
    ].join('');
    var st = el('style', { id: 'dhqfb-styles' }); st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ── overlay plumbing ────────────────────────────────────────────
  var _openOverlay = null;
  function closeOverlay() { if (_openOverlay) { _openOverlay.remove(); _openOverlay = null; document.removeEventListener('keydown', onEsc); } }
  function onEsc(e) { if (e.key === 'Escape') closeOverlay(); }
  function mountOverlay(modal) {
    injectStyles(); // launcher no longer auto-mounts, so styles ride with any entry point
    closeOverlay();
    var ov = el('div', { class: 'dhqfb-ov', onclick: function (e) { if (e.target === ov) closeOverlay(); } }, [modal]);
    document.body.appendChild(ov);
    _openOverlay = ov;
    document.addEventListener('keydown', onEsc);
    return ov;
  }

  // ── 1) BUG REPORT MODAL ─────────────────────────────────────────
  function reportBug(prefill) {
    injectStyles();
    var msgBox = el('div');
    var titleIn = el('input', { class: 'dhqfb-in', type: 'text', maxlength: '140', placeholder: 'Short summary (e.g. "Trade calc crashes on empty roster")' });
    var sev = el('select', { class: 'dhqfb-sel' });
    [['normal', 'Normal — something is wrong'], ['high', 'High — blocks part of the app'], ['blocker', 'Blocker — I cannot use it'], ['low', 'Low — minor / cosmetic']]
      .forEach(function (o) { sev.appendChild(el('option', { value: o[0], text: o[1] })); });
    var desc = el('textarea', { class: 'dhqfb-ta', maxlength: '4000', placeholder: 'What happened? What did you expect? Steps to reproduce if you have them.' });
    if (prefill && prefill.message) desc.value = prefill.message;

    var submit = el('button', { class: 'dhqfb-btn pri', text: 'Send to staff' });
    var cancel = el('button', { class: 'dhqfb-btn sec', text: 'Cancel', onclick: closeOverlay });

    submit.addEventListener('click', function () {
      var message = (desc.value || '').trim();
      if (!message) { showMsg(msgBox, 'err', 'Tell us what went wrong first.'); return; }
      submit.disabled = true; submit.textContent = 'Sending…';
      var client = getClient();
      if (!client || !client.functions) { showMsg(msgBox, 'err', 'App not ready — try again in a moment.'); submit.disabled = false; submit.textContent = 'Send to staff'; return; }
      client.functions.invoke('report-bug', {
        body: {
          kind: 'user',
          title: (titleIn.value || '').trim() || undefined,
          severity: sev.value,
          message: message,
          context: baseContext(),
        },
      }).then(function (res) {
        if (res && res.error) throw res.error;
        showMsg(msgBox, 'ok', 'Thanks — it landed in the staff channel. We are on it.');
        setTimeout(closeOverlay, 1400);
      }).catch(function () {
        showMsg(msgBox, 'err', 'Could not send that. Please try again.');
        submit.disabled = false; submit.textContent = 'Send to staff';
      });
    });

    var modal = el('div', { class: 'dhqfb-modal' }, [
      el('div', { class: 'dhqfb-hd' }, [el('h3', { text: '🐞 Report a bug' }), el('button', { class: 'dhqfb-x', text: '×', onclick: closeOverlay })]),
      msgBox,
      el('div', { class: 'dhqfb-bd' }, [
        el('label', { class: 'dhqfb-lbl', text: 'Summary' }), titleIn,
        el('label', { class: 'dhqfb-lbl', text: 'Severity' }), sev,
        el('label', { class: 'dhqfb-lbl', text: 'Details' }), desc,
        el('p', { class: 'dhqfb-note', text: "We'll automatically attach your page, league, tier and app version." }),
        el('div', { class: 'dhqfb-row' }, [cancel, submit]),
      ]),
    ]);
    mountOverlay(modal);
    setTimeout(function () { titleIn.focus(); }, 30);
  }

  function showMsg(box, kind, text) {
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'dhqfb-msg ' + kind, text: text }));
  }

  // ── 2) FEATURE BOARD OVERLAY ────────────────────────────────────
  var STATUSES = [
    { key: '', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'planned', label: 'Planned' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'shipped', label: 'Shipped' },
  ];
  function statusLabel(s) { return ({ open: 'Open', planned: 'Planned', in_progress: 'In Progress', shipped: 'Shipped', declined: 'Declined' })[s] || s; }

  function openBoard() {
    injectStyles();
    var state = { status: '', items: [], signedIn: false };
    var listWrap = el('div', { class: 'dhqfb-list' });
    var msgBox = el('div');
    var filters = el('div', { class: 'dhqfb-filters' });

    function renderFilters() {
      filters.innerHTML = '';
      STATUSES.forEach(function (s) {
        filters.appendChild(el('button', {
          class: 'dhqfb-chip' + (state.status === s.key ? ' on' : ''),
          text: s.label,
          onclick: function () { state.status = s.key; renderFilters(); load(); },
        }));
      });
    }

    function renderList() {
      listWrap.innerHTML = '';
      if (!state.items.length) {
        listWrap.appendChild(el('div', { class: 'dhqfb-empty', text: 'No ideas here yet. Be the first to suggest one.' }));
        return;
      }
      state.items.forEach(function (it) {
        var voteBtn = el('button', {
          class: 'dhqfb-vote' + (it.my_vote ? ' on' : ''),
          title: it.my_vote ? 'Remove your vote' : 'Upvote',
        }, [el('span', { class: 'ar', text: '▲' }), el('span', { class: 'ct', text: String(it.vote_count) })]);
        voteBtn.addEventListener('click', function () { toggleVote(it, voteBtn); });

        var meta = el('div', {}, [
          el('span', { class: 'dhqfb-pill ' + it.status, text: statusLabel(it.status) }),
          el('span', { class: 'dhqfb-meta', text: (it.author_username ? '@' + it.author_username : 'a GM') + (it.category ? ' · ' + it.category : '') }),
        ]);
        var body = el('div', {}, [
          el('div', { class: 'dhqfb-it-title', text: it.title }),
          it.description ? el('div', { class: 'dhqfb-it-desc', text: it.description }) : null,
          meta,
        ]);
        listWrap.appendChild(el('div', { class: 'dhqfb-item' }, [voteBtn, body]));
      });
    }

    function toggleVote(it, btn) {
      var client = getClient();
      if (!client || !client.functions) return;
      var next = !it.my_vote;
      btn.disabled = true;
      client.functions.invoke('feature-requests', { body: { action: next ? 'vote' : 'unvote', id: it.id } })
        .then(function (res) {
          if (res && res.error) throw res.error;
          var d = res.data || {};
          if (d.ok) { it.my_vote = d.myVote; it.vote_count = d.voteCount; renderList(); }
          else if (d.error) { showMsg(msgBox, 'err', d.error); }
        })
        .catch(function () { showMsg(msgBox, 'err', 'Sign in to vote on ideas.'); })
        .then(function () { btn.disabled = false; });
    }

    function load() {
      listWrap.innerHTML = '';
      listWrap.appendChild(el('div', { class: 'dhqfb-empty', text: 'Loading…' }));
      var client = getClient();
      if (!client || !client.functions) { listWrap.innerHTML = ''; listWrap.appendChild(el('div', { class: 'dhqfb-empty', text: 'App not ready — reopen in a moment.' })); return; }
      client.functions.invoke('feature-requests', { body: { action: 'list', status: state.status || undefined } })
        .then(function (res) {
          if (res && res.error) throw res.error;
          var d = res.data || {};
          state.items = d.items || []; state.signedIn = !!d.signedIn;
          renderList();
        })
        .catch(function () { listWrap.innerHTML = ''; listWrap.appendChild(el('div', { class: 'dhqfb-empty', text: 'Could not load the board.' })); });
    }

    // submit form (inline, collapsible)
    var titleIn = el('input', { class: 'dhqfb-in', type: 'text', maxlength: '140', placeholder: 'Your idea in one line' });
    var descIn = el('textarea', { class: 'dhqfb-ta', maxlength: '2000', placeholder: 'Why it matters / how it should work (optional)' });
    var addBtn = el('button', { class: 'dhqfb-btn pri', text: 'Submit idea' });
    addBtn.addEventListener('click', function () {
      var title = (titleIn.value || '').trim();
      if (title.length < 4) { showMsg(msgBox, 'err', 'Give your idea a clear title.'); return; }
      var client = getClient();
      if (!client || !client.functions) { showMsg(msgBox, 'err', 'App not ready.'); return; }
      addBtn.disabled = true; addBtn.textContent = 'Submitting…';
      client.functions.invoke('feature-requests', { body: { action: 'submit', title: title, description: (descIn.value || '').trim() || undefined } })
        .then(function (res) {
          if (res && res.error) throw res.error;
          var d = res.data || {};
          if (d.ok) { titleIn.value = ''; descIn.value = ''; showMsg(msgBox, 'ok', 'Posted — thanks! It is live for voting.'); load(); }
          else { showMsg(msgBox, 'err', d.error || 'Could not submit.'); }
        })
        .catch(function () { showMsg(msgBox, 'err', 'Sign in to submit an idea.'); })
        .then(function () { addBtn.disabled = false; addBtn.textContent = 'Submit idea'; });
    });

    var submitPanel = el('div', { class: 'dhqfb-bd' }, [
      el('label', { class: 'dhqfb-lbl', text: 'Suggest a feature' }), titleIn, descIn,
      el('div', { class: 'dhqfb-row' }, [addBtn]),
    ]);

    var modal = el('div', { class: 'dhqfb-modal dhqfb-board' }, [
      el('div', { class: 'dhqfb-hd tac' }, [el('h3', { text: '💡 Feature Requests' }), el('button', { class: 'dhqfb-x', text: '×', onclick: closeOverlay })]),
      msgBox, filters, listWrap, submitPanel,
    ]);
    renderFilters();
    mountOverlay(modal);
    load();
  }

  // ── 3) GLOBAL CRASH CAPTURE ─────────────────────────────────────
  var CRASH_CAP = 8;               // per page-load, so a broken render can't spam
  var _crashCount = 0;
  var _crashSeen = Object.create(null);
  function sig(msg, src, line) { return (String(msg).slice(0, 120) + '|' + String(src || '').slice(0, 80) + '|' + (line || 0)); }

  function sendCrash(title, message, stack) {
    if (_crashCount >= CRASH_CAP) return;
    var client = getClient();
    if (!client || !client.functions) return; // no client yet — skip (can't report)
    _crashCount++;
    try {
      client.functions.invoke('report-bug', {
        body: {
          kind: 'crash',
          title: String(title || 'Uncaught error').slice(0, 200),
          severity: 'high',
          message: String(message || 'Unknown error').slice(0, 4000),
          stack: stack ? String(stack).slice(0, 3000) : undefined,
          context: baseContext(),
        },
      }).catch(function () {});
    } catch (e) {}
  }

  function installErrorHandlers() {
    window.addEventListener('error', function (e) {
      try {
        if (!e) return;
        var msg = e.message || (e.error && e.error.message) || 'Script error';
        var s = sig(msg, e.filename, e.lineno);
        if (_crashSeen[s]) return; _crashSeen[s] = 1;
        // ignore cross-origin "Script error." with no detail — not actionable
        if (msg === 'Script error.' && !e.error) return;
        var stack = e.error && e.error.stack ? e.error.stack : (msg + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
        sendCrash(msg, msg, stack);
      } catch (_) {}
    });
    window.addEventListener('unhandledrejection', function (e) {
      try {
        var r = e && e.reason;
        var msg = (r && (r.message || r.toString && r.toString())) || 'Unhandled promise rejection';
        var s = sig(msg, 'promise', 0);
        if (_crashSeen[s]) return; _crashSeen[s] = 1;
        var stack = (r && r.stack) ? r.stack : undefined;
        sendCrash('Unhandled promise rejection', msg, stack);
      } catch (_) {}
    });
  }

  // ── 4) LAUNCHER ─────────────────────────────────────────────────
  var _menu = null;
  function closeMenu() { if (_menu) { _menu.remove(); _menu = null; document.removeEventListener('click', onDocClick, true); } }
  function onDocClick() { closeMenu(); }
  function toggleMenu(anchorBtn) {
    if (_menu) { closeMenu(); return; }
    injectStyles();
    var menu = el('div', { class: 'dhqfb-menu' }, [
      el('button', { html: '🐞&nbsp; Report a bug', onclick: function () { closeMenu(); reportBug(); } }),
      el('button', { html: '💡&nbsp; Feature requests', onclick: function () { closeMenu(); openBoard(); } }),
    ]);
    // Anchor the menu just under the button that opened it (the header
    // feedback icon). Without an anchor it keeps the legacy bottom-right
    // float from the old floating launcher.
    if (anchorBtn && anchorBtn.getBoundingClientRect) {
      var r = anchorBtn.getBoundingClientRect();
      menu.style.top = Math.round(r.bottom + 8) + 'px';
      menu.style.bottom = 'auto';
      menu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    }
    document.body.appendChild(menu);
    _menu = menu;
    setTimeout(function () { document.addEventListener('click', onDocClick, true); }, 0);
  }

  function mountLauncher() {
    if (document.getElementById('dhqfb-launch')) return;
    injectStyles();
    var btn = el('button', {
      id: 'dhqfb-launch', class: 'dhqfb-launch', 'aria-label': 'Feedback',
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Feedback</span>',
    });
    btn.addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(btn); });
    document.body.appendChild(btn);
  }

  // ── boot ────────────────────────────────────────────────────────
  window.WR.Feedback = { reportBug: reportBug, openBoard: openBoard, toggleMenu: toggleMenu, mountLauncher: mountLauncher };

  installErrorHandlers(); // as early as possible
  // The floating bottom-right launcher no longer auto-mounts (owner ask —
  // it sat on top of the phone dock / content on every surface). Feedback
  // now opens from the league-header icon via WR.Feedback.toggleMenu(btn);
  // mountLauncher stays exported as an escape hatch for other pages.
})();
