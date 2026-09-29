/*  alex-answer-chip.js — "Alex answered" chip
 *
 *  When Alex's answer lands after the owner has left the screen that asked
 *  (2026-09-29: a Lineup start/sit note arrived 26s later, on the Trades
 *  tab), the answer is kept (AlexVoice's cache holds it, so the screen shows
 *  it instantly on return) and this chip says so, one tap back to it.
 *
 *  Events:
 *    wr:alex-answered     { tab, label }  → show the chip (latest wins)
 *    wr:alex-answer-seen  { tab }         → hide it (the owner is back there)
 *  Navigation: window.wrNavigateTab(tab) (league-detail's shell seam).
 *
 *  Plain JS (no JSX/Babel). Exposes window.WR.AlexAnswerChip.
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var current = null;   // { tab, el }
  var timer = null;
  var AUTO_HIDE_MS = 45000;

  function hide() {
    clearTimeout(timer);
    if (current && current.el && current.el.parentNode) current.el.parentNode.removeChild(current.el);
    current = null;
  }

  function go(tab) {
    hide();
    try { if (typeof root.wrNavigateTab === 'function') root.wrNavigateTab(tab); } catch (e) { /* shell not ready */ }
  }

  function show(detail) {
    if (!doc || !doc.body || !detail || !detail.tab) return null;
    hide();
    var el = doc.createElement('div');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.className = 'wr-alex-answer-chip';
    el.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      // Top, under the header: tabs keep their own trays above the dock.
      'top:calc(var(--sat, 0px) + 80px)', 'z-index:160',
      'display:flex', 'align-items:center', 'gap:6px', 'max-width:calc(100vw - 32px)',
      'padding:6px 6px 6px 12px', 'background:var(--off-black, #1B1B22)',
      'border:1px solid rgba(212,175,55,0.45)', 'border-radius:var(--card-radius-sm, 8px)',
      'box-shadow:0 6px 20px rgba(0,0,0,0.5)', 'font-size:0.8rem', 'color:var(--white, #F5F2EA)',
    ].join(';');

    var open = doc.createElement('button');
    open.type = 'button';
    open.style.cssText = 'background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    var tag = doc.createElement('span');
    tag.textContent = 'ALEX · ';
    tag.style.cssText = 'color:var(--gold, #D4AF37);font-weight:800;letter-spacing:0.06em;font-size:0.68rem';
    open.appendChild(tag);
    open.appendChild(doc.createTextNode(String(detail.label || 'Alex answered your question') + ' — View'));
    open.onclick = function () { go(detail.tab); };

    var close = doc.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.style.cssText = 'background:none;border:0;color:var(--silver, #BDB8AD);font-size:1rem;line-height:1;cursor:pointer;padding:2px 6px';
    close.onclick = hide;

    el.appendChild(open);
    el.appendChild(close);
    doc.body.appendChild(el);
    current = { tab: detail.tab, el: el };
    timer = setTimeout(hide, AUTO_HIDE_MS);
    return el;
  }

  if (root.addEventListener) {
    root.addEventListener('wr:alex-answered', function (e) { show(e && e.detail); });
    root.addEventListener('wr:alex-answer-seen', function (e) {
      var tab = e && e.detail && e.detail.tab;
      if (current && (!tab || tab === current.tab)) hide();
    });
  }

  root.WR = root.WR || {};
  root.WR.AlexAnswerChip = { show: show, hide: hide, _current: function () { return current; } };
  /* global module */
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WR.AlexAnswerChip;
})(typeof window !== 'undefined' ? window : globalThis);
