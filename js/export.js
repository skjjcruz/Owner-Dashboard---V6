// export.js — Screenshot export utilities + on-demand html2canvas loader
(function () {
  // capture(el, name) — render `el` to a PNG and download it as `name`.png.
  // Backs the trade-analysis Snapshot button (js/trade-calc.js) and the
  // league-map roster Share button (js/tabs/league-map.js). Best-effort:
  // resolves true on success, false when the element is missing, the lazy
  // html2canvas CDN load fails (offline), or rendering throws.
  window.wrExport = {
    capture: function (el, name) {
      if (!el) return Promise.resolve(false);
      return window.ensureHtml2Canvas()
        .then(function (html2canvas) {
          // Plain hex (not a CSS var): html2canvas parses this string itself,
          // outside any element context where a var() could resolve.
          return html2canvas(el, { backgroundColor: '#0a0a0a', scale: 2, useCORS: true, logging: false });
        })
        .then(function (canvas) {
          return new Promise(function (resolve) {
            canvas.toBlob(function (blob) {
              if (!blob) { resolve(false); return; }
              var url = URL.createObjectURL(blob);
              var a = document.createElement('a');
              a.href = url;
              a.download = (name || 'war-room-export') + '.png';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              resolve(true);
            }, 'image/png');
          });
        })
        .catch(function (e) {
          if (window.wrLog) window.wrLog('wrExport.capture', e);
          return false;
        });
    }
  };

  // html2canvas (~200KB) is only used by user-triggered exports (Trophy Room
  // image export + draft PNG pick card). Load it lazily on first use instead of
  // shipping it as an eager, render-blocking CDN <script> on every cold load.
  var _h2cPromise = null;
  window.ensureHtml2Canvas = function () {
    if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
    if (_h2cPromise) return _h2cPromise;
    _h2cPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.async = true;
      s.onload = function () { resolve(window.html2canvas); };
      s.onerror = function () { _h2cPromise = null; reject(new Error('html2canvas failed to load')); };
      document.head.appendChild(s);
    });
    return _h2cPromise;
  };
})();
