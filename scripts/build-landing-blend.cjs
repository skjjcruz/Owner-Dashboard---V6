/* Build the PRODUCTION DHQ landing blend in place: V6 landing.html (base) x DHQ-Web-Page brochure (donor).
 *
 * Forked from the approved artifact builder (scratchpad/blend/build.js). It reuses that model's
 * section-HTML constants and CSS strings VERBATIM (donor extracts are recomputed here so the visual
 * result is byte-identical to the approved artifact), but ships a real production page:
 *   - keeps landing.html's Google Fonts <link> tags (no data-URI font inlining)
 *   - keeps the real Supabase <script> and every auth/onboarding handler (no stub, no disabled form)
 *   - keeps the existing CSP <meta> and the professional footer intact
 *   - omits the "BLEND MODEL" banner entirely
 *   - self-hosts GSAP/ScrollTrigger/Lenis from js/vendor/*.js (no CDN, no ~130KB inline)
 *   - references img/dhq-brandwash.jpg and icon-192.png / img/dhq-crest.jpg as real assets
 *
 * Idempotency: reads the pristine V6 landing.html, refuses to run twice (it looks for the base
 * markers and bails if the blend is already applied). Restore from git before re-running.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LANDING = path.join(ROOT, 'landing.html');
const DONOR = fs.readFileSync('/home/user/DHQ-Web-Page/index.html', 'utf8');

let html = fs.readFileSync(LANDING, 'utf8');
if (html.indexOf('class="brandwash"') >= 0 || html.indexOf('class="topbar"') >= 0) {
  throw new Error('landing.html already blended — restore the pristine V6 landing.html from git before re-running');
}
if (html.indexOf('  <!-- Nav -->') < 0 || html.indexOf('  <!-- Ticker -->') < 0) {
  throw new Error('landing.html does not look like the pristine V6 base (missing Nav/Ticker markers)');
}

function cut(src, startMark, endMark, includeEnd) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('start marker not found: ' + startMark.slice(0, 60));
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('end marker not found: ' + endMark.slice(0, 60));
  return src.slice(a, includeEnd ? b + endMark.length : b);
}

/* ---------- donor engine JS extracts (verbatim, as in the approved model) ---------- */
const engA = cut(DONOR, '/* ============ DHQ ENGINE', '\n/* owner DNA — the five archetypes');
const engB = cut(DONOR, '/* ============ STATE + RENDER ============ */', '\n/* ---- owner archetype cards');
const engC = cut(DONOR, '/* ============ CONTROLS ============ */', 'init();', true);
const engineJS = engA.trimEnd() + '\n\n' + engB.trimEnd() + '\n\n' + engC.trimEnd() + '\n';
if (/renderOwners|renderExamples|OWNERS/.test(engineJS)) {
  const stripped = engineJS.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/renderOwners\(|renderExamples\(|OWNERS\[/.test(stripped)) throw new Error('engine JS still references owners/examples code');
}

/* ---------- donor engine markup (cfg + board panels, verbatim) ---------- */
const cfgInner = cut(DONOR, '        <div class="cfg__group">\n          <div class="cfg__row"><span class="lbl">League size</span>', '      </div>\n    </div>\n\n    <div class="panel board">');
const boardTabs = cut(DONOR, '<div class="board__tabs" id="board-tabs">', '</div>', true);
const boardHdr = cut(DONOR, '<div class="panelhdr"><div class="panelhdr__t">Your Board', '</div></div>', true);
const boardColHdr = cut(DONOR, '<div class="board__colhdr">', '</div>', true);
const boardNote = cut(DONOR, '<div class="board__note">', '</div>', true);

/* ---------- added CSS (ported sections, adapted to base palette) ────────────────────
 *  Identical to the approved model's addedCSS, with two PRODUCTION deltas:
 *    (a) the "BLEND MODEL banner" rule is omitted (no banner ships), and
 *    (b) the brandwash background references the real asset img/dhq-brandwash.jpg
 *        instead of an inlined data: URI.                                            */
const addedCSS = `
    /* ── Lenis smooth-scroll plumbing (ported) ──────── */
    html.lenis,html.lenis body{height:auto}
    .lenis.lenis-smooth{scroll-behavior:auto!important}
    .lenis.lenis-stopped{overflow:hidden}

    /* ── Ported vars: brochure tokens mapped onto the base palette ── */
    :root{--forge:var(--accent);--forge-bright:var(--accent-bright);--forge-dim:var(--accent-dim);--forge-tint:var(--accent-tint);--amber:var(--warn);--pos-tint:rgba(47,191,136,.12);--neg-tint:rgba(240,73,92,.12);--fs-label:11px;--fs-micro:10px;--sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:24px;--sp-6:32px;--sp-7:48px;--sp-8:72px;--sp-9:112px;--ease:cubic-bezier(0.25,0.1,0.25,1);--t-fast:200ms var(--ease);--t:280ms var(--ease);--font-serif:Georgia,'Times New Roman',serif}
    .gild{color:var(--accent)}

    /* ── Ported: brochure "A universe built around your league." ── */
    .universe{position:relative;overflow:hidden;border-top:1px solid var(--border);border-bottom:1px solid var(--border);background:var(--bg-0)}
    .universe .ember{z-index:0}
    .universe .fog{opacity:.7}
    .universe__grid{position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.4;background-image:linear-gradient(var(--border-faint) 1px,transparent 1px),linear-gradient(90deg,var(--border-faint) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(95% 95% at 50% 42%,#000 30%,transparent 78%);mask-image:radial-gradient(95% 95% at 50% 42%,#000 30%,transparent 78%)}
    .universe__orbits{position:absolute;inset:0;z-index:1;pointer-events:none}
    .universe__orbits .orbit{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);border:1px solid rgba(232,178,58,.16);border-radius:50%}
    .orbit--1{width:min(360px,74vw);height:min(360px,74vw);animation:orbitSpin 48s linear infinite}
    .orbit--2{width:min(600px,100vw);height:min(600px,100vw);border-color:rgba(232,178,58,.11);animation:orbitSpin 82s linear infinite reverse}
    .orbit--3{width:min(880px,132vw);height:min(880px,132vw);border-color:rgba(74,157,222,.10);animation:orbitSpin 124s linear infinite}
    @keyframes orbitSpin{to{transform:translate(-50%,-50%) rotate(360deg)}}
    .universe__orbits .node{position:absolute;display:block;top:-4px;left:50%;width:7px;height:7px;margin-left:-4px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px rgba(232,178,58,.75)}
    .universe__orbits .node--blue{background:var(--tactical);box-shadow:0 0 12px rgba(74,157,222,.7)}
    .universe__orbits .node--dim{opacity:.72;width:5px;height:5px}
    .universe__orbits .node--e{top:50%;left:100%;margin:-3px 0 0 -3px}
    .orbit-core{position:absolute;top:50%;left:50%;width:9px;height:9px;background:var(--accent);transform:translate(-50%,-50%) rotate(45deg);box-shadow:0 0 24px rgba(232,178,58,.55)}
    .universe__in{position:relative;z-index:3;max-width:840px;margin:0 auto;padding:118px 24px;text-align:center}
    .universe h2{font-family:var(--font-mono);font-size:clamp(30px,4.4vw,50px);font-weight:600;line-height:1.08;letter-spacing:-.015em;color:var(--text-1);margin-bottom:18px}
    .universe h2 .mk{color:var(--accent);text-shadow:0 0 34px rgba(232,178,58,.22)}
    .universe__sub{font-family:var(--font-serif);font-style:italic;font-size:clamp(16px,1.6vw,20px);line-height:1.55;color:var(--text-2);max-width:56ch;margin:0 auto 30px}
    .universe .hero-free{margin-top:16px}
    @media(max-width:680px){.universe__in{padding:76px 16px}}

    /* ── Ported: brochure value-simulator (#engine), scoped + repaletted ── */
    #engine button{font-family:var(--font-mono)}
    #engine .micro{font:400 var(--fs-micro)/1.4 var(--font-mono);color:var(--text-3)}
    #engine .readout{margin-bottom:var(--sp-5);border:1px solid var(--border);background:var(--bg-1);display:grid;grid-template-columns:auto 1fr auto;align-items:stretch}
    #engine .readout__tag{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-3) var(--sp-4);border-right:1px solid var(--border);background:var(--bg-2)}
    #engine .readout__tag .dot{width:7px;height:7px;border-radius:50%;background:var(--pos);box-shadow:0 0 8px var(--pos)}
    html.anim #engine .readout__tag .dot{animation:roPulse 2.2s ease-in-out infinite}
    @keyframes roPulse{0%,100%{opacity:1}50%{opacity:.35}}
    #engine .readout__kv{display:flex;flex-direction:column;gap:2px}
    #engine .readout__kv b{font:600 13px var(--font-mono);color:var(--text-1)}
    #engine .readout__kv span{font:500 var(--fs-micro) var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
    #engine .readout__stream{display:flex;align-items:center;gap:var(--sp-5);padding:var(--sp-3) var(--sp-4);overflow:hidden;white-space:nowrap}
    #engine .readout__top1{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-left:1px solid var(--border);background:var(--bg-2)}
    #engine .readout__top1 .v{font:600 28px var(--font-mono);color:var(--accent);line-height:1}
    #engine .panel{background:var(--bg-1);border:1px solid var(--border);padding:0}
    #engine .panelhdr{display:flex;justify-content:space-between;align-items:center;padding:var(--sp-3);border-bottom:1px solid var(--border);border-left:3px solid var(--accent);background:var(--bg-1)}
    #engine .panelhdr__t{font:600 14px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--text-1)}
    #engine .panelhdr__m{font:400 var(--fs-micro) var(--font-mono);color:var(--text-3)}
    #engine .engine{display:grid;grid-template-columns:340px 1fr;gap:var(--sp-4);align-items:start}
    #engine .cfg{padding:var(--sp-4);display:flex;flex-direction:column;gap:var(--sp-4)}
    #engine .cfg__group{display:flex;flex-direction:column;gap:var(--sp-2)}
    #engine .cfg__row{display:flex;align-items:center;justify-content:space-between;gap:var(--sp-3)}
    #engine .seg{display:inline-flex;border:1px solid var(--border-strong);border-radius:2px;overflow:hidden}
    #engine .seg button{background:var(--bg-inset);color:var(--text-2);border:none;padding:6px 11px;font:500 var(--fs-label) var(--font-mono);letter-spacing:.05em;text-transform:uppercase;transition:var(--t-fast)}
    #engine .seg button + button{border-left:1px solid var(--border)}
    #engine .seg button.on{background:var(--accent);color:var(--bg-0)}
    #engine .seg--blue button.on{background:var(--tactical);color:var(--bg-0)}
    #engine .seg--wild button.on{background:var(--amber);color:var(--bg-0)}
    #engine .stepper{display:inline-flex;align-items:center;border:1px solid var(--border-strong);border-radius:2px}
    #engine .stepper button{background:var(--bg-inset);border:none;color:var(--text-1);width:28px;height:28px;font-size:15px;line-height:1}
    #engine .stepper button:hover{color:var(--accent)}
    #engine .stepper b{min-width:34px;text-align:center;font:600 13px var(--font-mono);color:var(--text-1)}
    #engine .cfg__hint{font:400 var(--fs-micro)/1.5 var(--font-sans);color:var(--text-3)}
    #engine .divider{height:1px;background:var(--border-faint);margin:var(--sp-1) 0}
    #engine .rgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--sp-2)}
    #engine .ministep{display:flex;flex-direction:column;gap:4px;align-items:center;background:var(--bg-inset);border:1px solid var(--border);padding:var(--sp-2) var(--sp-1)}
    #engine .ministep--idp{border-color:#2c5e80}
    #engine .ministep--idp .ml{color:var(--tactical)}
    #engine .ministep .ml{font:500 9px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--text-3)}
    #engine .ministep .mc{display:inline-flex;align-items:center;gap:2px}
    #engine .ministep .mc button{background:transparent;border:none;color:var(--text-2);width:18px;height:18px;font-size:13px;line-height:1}
    #engine .ministep .mc button:hover{color:var(--accent)}
    #engine .ministep .mc b{min-width:16px;text-align:center;font:600 13px var(--font-mono);color:var(--text-1)}
    #engine .board{min-height:560px}
    #engine .board__tabs{display:flex;border-bottom:1px solid var(--border);flex-wrap:wrap}
    #engine .board__tabs button{flex:1;min-width:46px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-3);padding:var(--sp-3) var(--sp-1);font:500 var(--fs-label) var(--font-mono);letter-spacing:.05em;text-transform:uppercase;transition:var(--t-fast)}
    #engine .board__tabs button:hover{color:var(--text-1)}
    #engine .board__tabs button.on{color:var(--accent);border-bottom-color:var(--accent)}
    #engine .board__colhdr{display:grid;grid-template-columns:34px 1fr 96px 120px 66px;gap:var(--sp-3);padding:var(--sp-2) var(--sp-3);border-bottom:1px solid var(--border-strong);background:var(--bg-1)}
    #engine .board__colhdr span{font:500 var(--fs-label) var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--text-3)}
    #engine .board__colhdr .r{text-align:right}
    #engine .board__note{font:400 var(--fs-micro)/1.5 var(--font-mono);letter-spacing:.02em;color:var(--text-3);padding:var(--sp-3) var(--sp-4);border-top:1px solid var(--border-faint);display:flex;gap:8px;align-items:flex-start}
    #engine .board__note::before{content:"◆";color:var(--accent-dim);font-size:9px;line-height:1.9;flex:none}
    #engine .board__note b{color:var(--text-2);font-weight:600}
    #engine .row{display:grid;grid-template-columns:34px 1fr 96px 120px 66px;align-items:center;gap:var(--sp-3);padding:var(--sp-3);border-bottom:1px solid var(--border-faint);transition:background var(--t-fast)}
    #engine .row:hover{background:var(--bg-2)}
    #engine .row__rank{font:600 13px var(--font-mono);color:var(--text-3);text-align:center}
    #engine .row__rank b{color:var(--accent)}
    #engine .row__name{display:flex;flex-direction:column;gap:3px;min-width:0}
    #engine .row__name .nm{font:500 13px var(--font-mono);color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #engine .posage{display:inline-flex;align-items:center;gap:6px}
    #engine .tag{display:inline-flex;align-items:center;font:500 var(--fs-micro) var(--font-mono);letter-spacing:.04em;text-transform:uppercase;padding:1px 5px;border:1px solid;border-radius:2px;margin:0;color:var(--text-2);border-color:var(--border-strong)}
    #engine .tag--QB{color:var(--accent);border-color:var(--accent-dim)}
    #engine .tag--RB{color:var(--pos);border-color:#1f5f47}
    #engine .tag--WR{color:var(--tactical);border-color:#2c5e80}
    #engine .tag--TE{color:var(--amber);border-color:#7a5600}
    #engine .tag--K{color:#C9A2FF;border-color:#5a4a7a}
    #engine .posage .age{font:400 var(--fs-micro) var(--font-mono);color:var(--text-3)}
    #engine .row__pts{font:400 13px var(--font-mono);color:var(--text-2);text-align:right}
    #engine .row__val{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
    #engine .row__val .v{font:600 17px var(--font-mono);color:var(--accent);line-height:1}
    #engine .row .band{width:112px}
    #engine .row__delta{font:500 var(--fs-label) var(--font-mono);text-align:right;color:var(--text-3)}
    #engine .row__delta.up{color:var(--pos)}
    #engine .row__delta.down{color:var(--neg)}
    #engine .row__delta .d2{display:block;font-weight:400;color:var(--text-3);margin-top:2px}
    #engine .board__empty{padding:var(--sp-8) var(--sp-4);text-align:center;color:var(--text-3);font:400 15px/1.6 var(--font-sans)}
    #engine .vbar{width:100%;height:6px;background:var(--bg-inset);border:1px solid var(--border);border-radius:2px;overflow:hidden;margin-top:5px}
    #engine .vbar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent-dim),var(--accent));transform-origin:left;animation:vbarGrow .5s var(--ease) both}
    @keyframes vbarGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    #engine .aha-cta{margin-top:var(--sp-5);padding:var(--sp-6);border:1px solid var(--border-strong);background:var(--bg-1);text-align:center;display:flex;flex-direction:column;align-items:center;gap:var(--sp-3)}
    #engine .aha-cta__t{font:600 clamp(20px,2vw,26px) var(--font-mono);color:var(--text-1);margin:0}
    #engine .aha-cta__s{font:400 15px/1.5 var(--font-sans);color:var(--text-2);margin:0;max-width:46ch}
    @media(max-width:960px){#engine .engine{grid-template-columns:1fr}#engine .readout{grid-template-columns:1fr}#engine .readout__tag,#engine .readout__top1{border:none;border-bottom:1px solid var(--border)}}
    @media(max-width:680px){#engine .panelhdr__m{display:none}#engine .board__tabs button{min-width:40px;padding:var(--sp-3) 2px}#engine .board__colhdr{display:none}#engine .row{grid-template-columns:26px 1fr 86px 52px}#engine .row__pts{display:none}}
    @media(prefers-reduced-motion:reduce){.orbit--1,.orbit--2,.orbit--3,#engine .readout__tag .dot,#engine .vbar i{animation:none!important}}

    /* ── OWNER REVISION: brochure topbar + hero ─────── */
    /* ghost visibility: body paints over negative-z fixed layers — promote the
       page background to html so the brandwash slots between bg and content */
    html{background:var(--bg-0)}
    body{background:transparent !important}
    .brandwash{position:fixed;inset:0;z-index:-1;pointer-events:none;background:url('img/dhq-brandwash.jpg') no-repeat center 16% / min(720px,86vw) auto;opacity:.24;mix-blend-mode:screen;filter:blur(3px);-webkit-mask-image:radial-gradient(125% 105% at 50% 20%,#000 26%,transparent 74%);mask-image:radial-gradient(125% 105% at 50% 20%,#000 26%,transparent 74%)}
    html.anim .brandwash{animation:washfloat 44s ease-in-out infinite alternate}
    @keyframes washfloat{0%{background-position:center 15%}100%{background-position:center 20%}}
    .topbar{position:sticky;top:30px;z-index:40;background:rgba(10,12,16,.86);backdrop-filter:blur(10px);border-bottom:1px solid var(--border);padding-top:var(--sat);transition:background 280ms var(--ease),border-color 280ms var(--ease)}
    html.js-nav .topbar{background:transparent;backdrop-filter:blur(0px);border-bottom-color:transparent}
    html.js-nav .topbar--frosted{background:rgba(10,12,16,.86);backdrop-filter:blur(10px);border-bottom-color:var(--border)}
    .topbar__in{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:60px;padding:0 24px;gap:12px}
    .brand{display:flex;align-items:center;gap:12px;font:600 15px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--text-1);white-space:nowrap}
    .brand-logo{width:30px;height:30px;border-radius:7px;object-fit:cover;flex:none;border:1px solid var(--border-strong)}
    .brand small{color:var(--text-3);font-weight:500;letter-spacing:.14em}
    .beta-badge{font:600 9px var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent);background:var(--accent-tint);border:1px solid var(--accent-dim);border-radius:3px;padding:2px 6px;line-height:1;white-space:nowrap;flex:none}
    .topbar__r{display:flex;align-items:center;gap:8px}
    .btn--ghost{border-color:transparent;background:transparent;color:var(--text-1);padding:0 14px}
    .btn--ghost:hover{border-color:transparent;color:var(--accent)}
    .btn--lg{min-height:50px;padding:0 26px;font-size:14px}
    .hero{border-bottom:0;display:flex;flex-direction:column}
    .hero__in{position:relative;z-index:2;min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:36px 24px 44px}
    @media(max-width:960px){.hero-facer{grid-template-columns:1fr;gap:44px}.hero-facer .term{margin:0 auto}}
    .hero-copy{max-width:880px;width:100%}
    .eyebrow{display:inline-flex;align-items:center;justify-content:center;gap:12px;font:500 11px var(--font-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:32px}
    .eyebrow::before,.eyebrow::after{content:"";width:26px;height:1px;background:var(--accent)}
    .hero h1{font-family:var(--font-mono);font-size:clamp(52px,7.8vw,98px);font-weight:600;line-height:1.06;letter-spacing:-.02em;margin:0 0 24px;color:var(--text-1)}
    .hero h1 .f{color:var(--accent);display:block;text-shadow:0 0 38px rgba(232,178,58,.26)}
    .hero h1 .f--tag{font-size:.62em;letter-spacing:0;margin-top:22px;white-space:nowrap}
    @media(max-width:560px){.hero h1 .f--tag{white-space:normal;font-size:.56em}}
    .hero__sub{font:400 clamp(17px,1.5vw,20px)/1.5 var(--font-sans);color:var(--text-2);max-width:52ch;margin:0 auto 32px}
    .hero__sub b{color:var(--text-1);font-weight:500}
    .hero__cta{display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;margin-bottom:16px}
    .hero__fine{font:400 10px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--text-3)}
    /* facer split: original V6 hero layout (copy left, League Model rig right) */
    .hero-facer-sec{position:relative;z-index:2;padding:8px 0 4px}
    .hero-facer{position:relative;z-index:2;width:100%;max-width:var(--maxw);margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.02fr);gap:40px;align-items:center;padding:132px 24px 96px}
    .facer-sub{font-size:16px;line-height:1.62;color:var(--text-2);max-width:520px;margin:14px 0 24px}
    .facer-sub,.facer-copy .hero-eyebrow{text-align:left}
    .facer-copy .hero-eyebrow{margin-bottom:14px;font-size:17px;font-weight:600;letter-spacing:.14em;display:block}
    .facer-copy .hero-eyebrow::before{display:none}
    .ticker{border-top:1px solid var(--border)}
    @media(max-width:860px){.brand small{display:none}}
    @media(max-width:680px){
      .topbar__in{padding:0 16px;height:56px}
      .nav-features{display:none}
      .topbar__r .btn{padding:0 12px}
      .hero__in{min-height:calc(100vh - 60px);padding:40px 16px 40px}
      .hero h1{font-size:clamp(34px,9vw,46px);line-height:1.04}
      .hero__sub{font-size:16px}
      .eyebrow{display:block}
      .eyebrow::before,.eyebrow::after{display:none}
      .hero-facer{padding:0 16px 56px}
    }

    /* ── OWNER REVISION 2+3: shared terminal-rig chrome for the boxed showcases ── */
    .rig-box{background:var(--bg-1);border:1px solid var(--border-strong);box-shadow:0 18px 60px rgba(0,0,0,.5)}

    /* Owner DNA personas (#psych) */
    .preview-tag{display:inline-flex;align-items:center;gap:6px;font:500 11px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--tactical);border:1px solid #2c5e80;border-radius:2px;padding:2px 8px;vertical-align:middle;margin-left:6px}
    #psych .split{grid-template-columns:.85fr 1.15fr;align-items:center}
    .dna-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border-faint)}
    .dna-card{background:var(--bg-1);padding:13px 14px;border-left:2px solid var(--dna,var(--accent))}
    .dna-card--wide{grid-column:1 / -1}
    .dna-hd{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px}
    .dna-name{font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--text-1)}
    .dna-label{font-family:var(--font-mono);font-size:10px;font-weight:500;letter-spacing:.07em;text-transform:uppercase;color:var(--dna,var(--accent));white-space:nowrap}
    .dna-card .meter i{background:var(--dna,var(--accent))}
    @media(max-width:960px){#psych .split{grid-template-columns:1fr}}
    @media(max-width:560px){.dna-grid{grid-template-columns:1fr}}

    /* Draft room (#draft) — donor markup, repaletted + scoped */
    #draft .draftwrap{overflow:hidden;padding:0}
    #draft .draft-bar-r{display:flex;align-items:center;gap:8px}
    #draft .draft-round{font-family:var(--font-mono);font-size:10px;color:var(--text-3)}
    #draft .pill-live{font:600 9px var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--pos);border:1px solid var(--pos);border-radius:2px;padding:3px 7px}
    #draft .pill-dyn{font:600 9px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--tactical);border:1px solid #2c5e80;border-radius:2px;padding:3px 7px}
    #draft .tag{display:inline-flex;align-items:center;font:500 10px var(--font-mono);letter-spacing:.04em;text-transform:uppercase;padding:1px 5px;border:1px solid;border-radius:2px;margin:0;color:var(--text-2);border-color:var(--border-strong)}
    #draft .tag--QB{color:var(--accent);border-color:var(--accent-dim)}
    #draft .tag--RB{color:var(--pos);border-color:#1f5f47}
    #draft .tag--WR{color:var(--tactical);border-color:#2c5e80}
    #draft .tag--TE{color:var(--amber);border-color:#7a5600}
    #draft .drun{display:flex;align-items:center;flex-wrap:wrap;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--border);background:var(--bg-inset)}
    #draft .drun__lab{font:600 var(--fs-label) var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
    #draft .drun__strip{display:flex;gap:5px;flex-wrap:wrap}
    #draft .drun__cell{display:flex;align-items:center;gap:5px;background:var(--bg-1);border:1px solid var(--border);border-radius:4px;padding:5px 8px}
    #draft .drun__cell i{font:600 10px var(--font-mono);font-style:normal;color:var(--text-3)}
    #draft .drun__cell--run{border-color:var(--accent-dim);background:var(--accent-tint)}
    #draft .drun__cell--run i{color:var(--accent-bright)}
    #draft .drun__cell--now{border-color:var(--tactical);background:var(--tactical-tint)}
    #draft .drun__cell--now b{font:700 10px var(--font-mono);color:var(--tactical-bright)}
    #draft .drun__flag{font:700 9px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--bg-0);background:var(--accent);border-radius:999px;padding:5px 11px}
    #draft .acall{display:flex;gap:var(--sp-3);padding:var(--sp-4);border-bottom:1px solid var(--border);background:linear-gradient(180deg,var(--accent-tint),transparent)}
    #draft .aorb{position:relative;flex:none;width:40px;height:40px;border-radius:50%;background:radial-gradient(120% 120% at 30% 25%,var(--accent-bright),var(--accent-dim));display:grid;place-items:center;font:800 17px var(--font-mono);color:var(--bg-0)}
    #draft .aorb__pulse{position:absolute;inset:-4px;border-radius:50%;border:1.5px solid var(--accent);opacity:.5}
    html.anim #draft .aorb__pulse{animation:apulse 2.4s ease-out infinite}
    @keyframes apulse{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.4);opacity:0}}
    #draft .acall__body{min-width:0}
    #draft .acall__hd{font:700 var(--fs-label) var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:5px}
    #draft .acall__hd span{color:var(--text-3);font-weight:500}
    #draft .acall__txt{font:400 14px/1.55 var(--font-sans);color:var(--text-1);margin:0 0 var(--sp-3)}
    #draft .acall__txt b{color:var(--accent-bright);font-weight:600}
    #draft .acall__chips{display:flex;flex-wrap:wrap;gap:6px}
    #draft .dchip{font:500 9px var(--font-mono);letter-spacing:.05em;text-transform:uppercase;color:var(--accent);border:1px solid var(--accent-dim);border-radius:2px;padding:3px 7px}
    #draft .draft{display:grid;grid-template-columns:1.5fr 1fr;gap:0}
    #draft .dcol--you{border-left:1px solid var(--border);background:var(--bg-inset)}
    #draft .dcol__h{font:600 var(--fs-label) var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);padding:var(--sp-3) var(--sp-4);border-bottom:1px solid var(--border)}
    #draft .dpick{display:grid;grid-template-columns:48px 1fr 56px;align-items:center;gap:var(--sp-3);padding:11px var(--sp-4);border-bottom:1px solid var(--border-faint);transition:background var(--t-fast)}
    #draft .dpick:hover{background:var(--bg-2)}
    #draft .dpick__pk{font:600 15px var(--font-mono);color:var(--accent);line-height:1.1}
    #draft .dpick__pk small{display:block;font:400 9px var(--font-mono);letter-spacing:.04em;color:var(--text-3);margin-top:2px}
    #draft .dpick__m{min-width:0}
    #draft .dpick__nm{display:flex;align-items:center;gap:6px;font:500 13px var(--font-mono);color:var(--text-1);margin-bottom:3px}
    #draft .dpick__nm .dv{color:var(--accent)}
    #draft .dpick__rs{font:400 12px/1.4 var(--font-serif);font-style:italic;color:var(--text-2)}
    #draft .dpick__pb{text-align:right}
    #draft .dpick__pb b{font:600 13px var(--font-mono);color:var(--tactical);display:block}
    #draft .dpick__pb .pbar{height:4px;background:var(--bg-inset);border:1px solid var(--border);margin-top:4px}
    #draft .dpick__pb .pbar i{display:block;height:100%;background:var(--accent)}
    #draft .youbox{padding:var(--sp-4)}
    #draft .youbox__rec{font:500 var(--fs-label) var(--font-mono);letter-spacing:.05em;text-transform:uppercase;color:var(--text-3);margin-bottom:var(--sp-2)}
    #draft .youbox__name{display:flex;align-items:center;gap:8px;font:600 18px var(--font-mono);color:var(--text-1);margin:var(--sp-1) 0}
    #draft .youbox__val{font:600 34px/1 var(--font-mono);color:var(--accent);margin:var(--sp-2) 0 var(--sp-3)}
    #draft .youbox__line{font:400 13px/1.5 var(--font-sans);color:var(--text-2);margin-bottom:var(--sp-2)}
    #draft .youbox__line b{color:var(--neg)}
    #draft .dchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:var(--sp-3);padding-top:var(--sp-3);border-top:1px solid var(--border-faint)}
    @media(max-width:940px){#draft .draft{grid-template-columns:1fr}#draft .dcol--you{border-left:none;border-top:1px solid var(--border)}}
    @media(prefers-reduced-motion:reduce){#draft .aorb__pulse{animation:none!important}}
`;

/* ---------- ported universe section markup (verbatim) ---------- */
const universeHTML = `  <!-- Universe (ported from brochure closing section) -->
  <section class="universe" id="universe">
    <div class="ember" aria-hidden="true"></div>
    <div class="universe__grid" aria-hidden="true"></div>
    <div class="universe__orbits" aria-hidden="true">
      <div class="orbit orbit--1"><i class="node"></i></div>
      <div class="orbit orbit--2"><i class="node node--blue"></i><i class="node node--dim node--e"></i></div>
      <div class="orbit orbit--3"><i class="node node--dim"></i><i class="node node--blue node--dim node--e"></i></div>
      <span class="orbit-core"></span>
    </div>
    <div class="fog" aria-hidden="true">
      <svg class="fog__grain" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <filter id="fogTexC" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.017" numOctaves="4" seed="19" stitchTiles="stitch"/>
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 -0.2"/>
        </filter>
        <rect width="100%" height="100%" filter="url(#fogTexC)"/>
      </svg>
      <div class="fog__blob b"></div>
      <div class="fog__blob d"></div>
    </div>
    <div class="vignette" aria-hidden="true"></div>
    <div class="universe__in">
      <h2>A universe built around <span class="mk">your league.</span></h2>
      <p class="universe__sub">Your scoring. Your rivals. Your history. No other system cares this much about making the experience yours — and only yours.</p>
      <button class="hero-cta" onclick="document.getElementById('auth').scrollIntoView({behavior:'smooth'});document.getElementById('acctEmail').focus()">Start free with Sleeper</button>
      <p class="hero-free">Free on all your Sleeper leagues · no credit card</p>
    </div>
  </section>

`;

/* ---------- ported engine section markup (verbatim) ---------- */
const engineHTML = `  <!-- Value simulator (ported from brochure #engine) -->
  <section class="section" id="engine">
    <div class="sec-head">
      <div class="sec-kicker">Built for your league</div>
      <h2 class="sec-title">Your league, <span class="gild">your rankings.</span></h2>
      <p class="sec-sub">DHQ reads your league type, roster, and scoring, then rebuilds every player's value around the rules you actually play. Drag a slider on the left and watch the board rerank.</p>
    </div>

    <div class="readout">
      <div class="readout__tag"><span class="dot"></span><div class="readout__kv"><b>ENGINE LIVE</b><span id="ro-cfg">SF · FULL PPR</span></div></div>
      <div class="readout__stream" id="ro-stream"></div>
      <div class="readout__top1"><div class="readout__kv"><span>DHQ #1 OVERALL</span><b id="ro-name" class="mono">—</b></div><div class="v" id="ro-val">—</div></div>
    </div>

    <div class="engine">
      <div class="panel">
        <div class="panelhdr"><div class="panelhdr__t">League Configurator</div><div class="panelhdr__m" id="cfg-sig">12-TEAM</div></div>
        <div class="cfg">
${cfgInner.replace(/\s+$/, '')}
        </div>
      </div>

      <div class="panel board">
        ${boardHdr}
        ${boardTabs}
        ${boardColHdr}
        <div id="board-rows"></div>
        ${boardNote}
      </div>
    </div>

    <div class="aha-cta">
      <p class="aha-cta__t">That's your board — recomputed live on your settings.</p>
      <p class="aha-cta__s">Connect your Sleeper league to make it real — your rosters, your matchups, your market, season over season.</p>
      <button class="hero-cta" onclick="document.getElementById('auth').scrollIntoView({behavior:'smooth'});document.getElementById('acctEmail').focus()">Start free with Sleeper</button>
      <span class="hero-free" style="margin-top:0">Free on all your Sleeper leagues · no credit card</span>
    </div>
  </section>

`;

/* ---------- MOTION LAYER (verbatim from the approved model's modelJS; the model's
   Supabase stub + disabled-auth handlers are intentionally omitted here so the real
   page keeps its live Supabase client and auth/onboarding handlers) ---------- */
const motionJS = `
/* ═══ MOTION LAYER (ported polish) — Lenis smooth scroll + GSAP ScrollTrigger reveals.
   Gated on html.anim (set only when JS runs AND the user allows motion), and every hidden
   state is applied at runtime, so reduced-motion users always see the full page. ═══ */
function initMotion() {
  var html = document.documentElement;
  if (!(window.gsap && window.ScrollTrigger && window.Lenis && html.classList.contains('anim'))) return;
  gsap.registerPlugin(ScrollTrigger);

  var lenis = new Lenis({ lerp: 0.1, duration: 1.1, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.5, syncTouch: false });
  window.lenis = lenis;
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
  gsap.ticker.lagSmoothing(0);

  /* rewire every in-page scroll button to glide via Lenis (same destinations) */
  document.querySelectorAll('[onclick*="scrollIntoView"]').forEach(function (btn) {
    var oc = btn.getAttribute('onclick') || '';
    var m = oc.match(/getElementById\\((['"])([^'"]+)\\1\\)\\.scrollIntoView/);
    if (!m) return;
    var id = m[2];
    var wantsFocus = oc.indexOf("acctEmail") !== -1 && oc.indexOf('.focus') !== -1;
    btn.removeAttribute('onclick');
    btn.addEventListener('click', function () {
      var t = document.getElementById(id);
      if (!t) return;
      lenis.scrollTo(t, { offset: -84, duration: 1.1 });
      if (wantsFocus) setTimeout(function () {
        var e2 = document.getElementById('acctEmail');
        if (e2) { try { e2.focus({ preventScroll: true }); } catch (_) { e2.focus(); } }
      }, 1150);
    });
  });

  var once = 'play none none none';
  function rise(targets, trigger, o) {
    o = o || {};
    gsap.fromTo(targets, { opacity: 0, y: o.y == null ? 24 : o.y },
      { opacity: 1, y: 0, duration: o.d || 0.8, ease: o.e || 'power2.out', stagger: o.s || 0,
        scrollTrigger: { trigger: trigger, start: o.start || 'top 82%', toggleActions: once } });
  }

  /* topbar: transparent over the hero, frosted once you scroll past it (donor behavior) */
  var topbar = document.querySelector('.topbar');
  if (topbar) {
    html.classList.add('js-nav');
    ScrollTrigger.create({ trigger: '.hero', start: 'bottom top+=120',
      onEnter: function () { topbar.classList.add('topbar--frosted'); },
      onLeaveBack: function () { topbar.classList.remove('topbar--frosted'); } });
  }

  /* hero copy rises once on load */
  gsap.fromTo('.hero-copy', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 1.0, ease: 'expo.out' });

  /* facer split copy rises just after the title block (rig keeps its own sharpen/veil animation) */
  gsap.fromTo('.facer-copy', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 1.0, ease: 'expo.out', delay: 0.15 });

  gsap.utils.toArray('.sec-head').forEach(function (h) { rise(h, h, { y: 22 }); });
  rise('.wedge .vcard', '.wedge', { y: 26, s: 0.12 });

  /* universe: staggered payoff + the faint grid drifts behind the words (scrubbed) */
  rise('#universe .universe__in > *', '#universe .universe__in', { y: 26, d: 0.9, e: 'expo.out', s: 0.11, start: 'top 78%' });
  gsap.fromTo('#universe .universe__grid', { yPercent: 5, opacity: 0.25 }, { yPercent: -5, opacity: 0.5, ease: 'none',
    scrollTrigger: { trigger: '#universe', start: 'top bottom', end: 'bottom top', scrub: true } });

  gsap.utils.toArray('.split').forEach(function (sp) { rise(sp.children, sp, { y: 24, s: 0.12 }); });
  rise('#draft .rig-box', '#draft .rig-box', { y: 26, d: 0.85, start: 'top 82%' });
  rise('.creed__in', '.creed', { y: 26, d: 0.9, e: 'expo.out', start: 'top 76%' });
  rise('.cc-grid .cc', '.cc-grid', { y: 20, d: 0.6, s: 0.06 });

  /* engine (interactive — reveal stable wrappers only, never the live board rows) */
  rise('#engine .readout', '#engine .readout', { y: 20, d: 0.7, start: 'top 80%' });
  rise('#engine .engine > .panel', '#engine .engine', { y: 28, d: 0.85, s: 0.1, start: 'top 78%' });
  rise('#engine .aha-cta', '#engine .aha-cta', { y: 18, d: 0.7, e: 'expo.out', start: 'top 88%' });

  rise('.pricing-grid .price-card', '.pricing-grid', { y: 26, d: 0.7, s: 0.1, start: 'top 80%' });
  rise('.platform-band', '.platforms', { y: 20, d: 0.7, start: 'top 86%' });
  rise('#auth', '#auth', { y: 22, start: 'top 84%' });
  rise('.dhqf-grid', '.dhqf', { y: 16, d: 0.7, start: 'top 92%' });

  ScrollTrigger.refresh();
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initMotion); else initMotion();
`;

/* ---------- OWNER REVISION: capture the League Model rig from the original V6 hero ---------- */
const heroRegion = cut(html, '  <!-- Hero -->', '  <!-- Ticker -->');
const rigStart = heroRegion.indexOf('<div class="rig" aria-hidden="true">');
const rigEnd = heroRegion.lastIndexOf('    </div>\n  </section>');
if (rigStart < 0 || rigEnd < 0) throw new Error('rig extraction failed');
const rigHTML = heroRegion.slice(rigStart, rigEnd).replace(/\s+$/, '');
// mirror the value-simulator: Bowers 7,941 @ 12-team SF (TE-prem off), drop the misleading TE PREMIUM label
const rigHTMLfixed = rigHTML.replace('<div class="bigval">7,040</div>', '<div class="bigval">7,941</div>').replace('TE PREMIUM · 12-TEAM SF', '12-TEAM SF');
if (rigHTMLfixed === rigHTML) throw new Error('rig value fix did not apply');

/* ---------- brochure topbar + hero (icon referenced as a real asset, not inlined) ---------- */
const newTopHTML = `  <!-- Brandwash: brochure's blurred giant-logo background (real asset img/dhq-brandwash.jpg) -->
  <div class="brandwash" aria-hidden="true"></div>

  <!-- Topbar (ported from brochure) -->
  <header class="topbar"><div class="topbar__in">
    <div class="brand"><img class="brand-logo" src="icon-192.png" alt="Dynasty HQ">DYNASTY&nbsp;HQ <span class="beta-badge" title="In active development — features and data are still evolving">Beta</span> <small>// YOUR&nbsp;FRONT&nbsp;OFFICE</small></div>
    <div class="topbar__r">
      <button class="btn btn--ghost nav-features" onclick="document.getElementById('command').scrollIntoView({behavior:'smooth'})">Features</button>
      <button class="btn btn--ghost nav-features" onclick="document.getElementById('pricing').scrollIntoView({behavior:'smooth'})">Plans</button>
      <button class="btn btn--ghost nav-features" onclick="document.getElementById('universe').scrollIntoView({behavior:'smooth'})">Vision</button>
      <a class="btn btn--ghost nav-features" href="https://discord.gg/3VFRJbWVnH" target="_blank" rel="noopener">Discord</a>
      <button class="btn btn--ghost" onclick="document.getElementById('auth').scrollIntoView({behavior:'smooth'})">Sign in</button>
      <button class="btn btn--primary" onclick="document.getElementById('auth').scrollIntoView({behavior:'smooth'});document.getElementById('acctEmail').focus()">Start free</button>
    </div>
  </div></header>

  <!-- Hero (brochure title block + original V6 facer split with the League Model rig) -->
  <section class="hero">
    <div class="hero__in">
      <div class="hero-copy">
        <span class="eyebrow">Fantasy front office · Dynasty &amp; redraft · Free on Sleeper</span>
        <h1>Dynasty HQ<span class="f f--tag">Generic Advice Stops Here!</span></h1>
        <p class="hero__sub">Every other tool ranks players for a league that isn't yours. Dynasty HQ rebuilds every value, trade, and draft call around <b>your exact scoring and roster</b> — and reads <b>how each rival actually operates.</b></p>
      </div>
    </div>
  </section>

`;

/* ---------- OWNER REVISION 3: brochure draft room, terminal-rig chrome ---------- */
const drunHTML = cut(DONOR, '    <div class="drun">', '    <div class="acall">').replace(/\s+$/, '');
const acallHTML = cut(DONOR, '    <div class="acall">', '    <div class="draft">').replace(/\s+$/, '');
const draftGridHTML = cut(DONOR, '    <div class="draft">', '\n  </div>\n</div></section>\n\n<!-- STRATEGY ENGINE -->').replace(/\s+$/, '');
const draftHTML = `  <!-- Draft room (ported from brochure #draft; terminal-rig chrome) -->
  <section class="section" id="draft">
    <div class="sec-head">
      <div class="sec-kicker">The draft room · War Room · Mock · Live follow</div>
      <h2 class="sec-title">Walk in <span class="gild">knowing the room.</span></h2>
      <p class="sec-sub">The draft is three jobs, not one. Prep your big board in the War Room — built on your values and every owner's DNA. Mock it against rivals who pick — and trade — like they actually do. Then follow it live from the most advanced command center in fantasy.</p>
    </div>
    <div class="rig-box draftwrap">
      <div class="term__bar">
        <span class="term__brand">DYNASTY HQ // DRAFT COMMAND</span>
        <span class="draft-bar-r"><span class="pill-live">● Live</span><span class="pill-dyn">Dynasty</span><span class="draft-round">Round 1 · pick 1.09</span></span>
      </div>
${drunHTML}
${acallHTML}
${draftGridHTML}
    </div>
  </section>

`;

/* ---------- OWNER REVISION 2: brochure personas replace the base Owner DNA split ---------- */
function dnaCard(color, name, label, pct, panic, tell, wide) {
  return `            <div class="dna-card${wide ? ' dna-card--wide' : ''}" style="--dna:${color}">
              <div class="dna-hd"><span class="dna-name">${name}</span><span class="dna-label">${label}</span></div>
              <div class="trait"><span>Panic</span><div class="meter"><i style="width:${pct}%"></i></div><b>${panic}</b></div>
              <p class="tell">${tell}</p>
            </div>`;
}
const personasHTML = `  <!-- Owner DNA · brochure personas in a terminal-rig box -->
  <section class="section" id="psych">
    <div class="split">
      <div class="split-copy">
        <div class="sec-kicker">Owner DNA · Know who you're playing <span class="preview-tag">Preview</span></div>
        <h2>You're not playing the rankings. <span class="gild">You're playing the personas.</span></h2>
        <p>You don't really know your leaguemates. Dynasty HQ does — it profiles every manager from how they actually play: each trade, draft pick, waiver claim, and lineup they've ever set. You get their type, their tendencies, how rattled they are right now — and exactly how to play them. The difference between making an offer and making the one they'll take.</p>
      </div>
      <div class="split-media">
        <div class="rig-box">
          <div class="term__bar">
            <span class="term__brand">DYNASTY HQ // OWNER DNA</span>
            <span class="plat-pill live" style="padding:3px 8px;font-size:10px">LIVE</span>
          </div>
          <div class="dna-grid">
${dnaCard('#e74c3c', 'Derek Vaughn', 'The Fleecer', 18, '1/5', 'Hunts asymmetric value — lead with clean surplus.')}
${dnaCard('#e67e22', 'Tony Marchetti', 'The Dominator', 22, '1/5', 'High ego — frame it so he feels he won the deal.')}
${dnaCard('#5dade2', 'Sam Okafor', 'The Stalwart', 20, '1/5', 'Attached to his roster — never lowball, lead with value.')}
${dnaCard('#2ecc71', 'Jess Whitfield', 'The Acceptor', 20, '1/5', 'Rebuilding — offer youth and picks, buy stars cheap.')}
${dnaCard('#bb8fce', 'Ryan Kowalski', 'The Desperate', 80, '4/5', 'Empty starter slot — overpays now. Strike before his bye.', true)}
          </div>
        </div>
      </div>
    </div>
  </section>

`;

/* facer split (League-specific intel + League Model rig) — placed AFTER the ticker */
const facerHTML = `  <!-- Facer split (moved below the capabilities ticker) -->
  <section class="hero-facer-sec">
    <div class="hero-facer">
      <div class="facer-copy">
        <div class="hero-eyebrow">League-specific dynasty intelligence</div>
        <p class="facer-sub">Most tools stop at player rankings. Dynasty HQ turns your Sleeper league into the model: DHQ values, owner tendencies, draft history, trade memory, and Scout decisions in one operating system.</p>
        <div class="hero-actions">
          <button class="hero-cta" onclick="document.getElementById('auth').scrollIntoView({behavior:'smooth'});document.getElementById('acctEmail').focus()">Start free with Sleeper</button>
          <button class="hero-secondary" onclick="document.getElementById('pricing').scrollIntoView({behavior:'smooth'})">View plans</button>
        </div>
        <p class="hero-free">Free on all your Sleeper leagues · no credit card</p>
      </div>
      ${rigHTMLfixed}
    </div>
  </section>

`;

/* ═══════════════ ASSEMBLE (in-place edits on the real landing.html) ═══════════════ */

/* 1) swap the V6 nav + hero region for the brochure topbar + hero + displaced rig */
const topStart = html.indexOf('  <!-- Nav -->');
const topEnd = html.indexOf('  <!-- Ticker -->');
if (topStart < 0 || topEnd < 0) throw new Error('nav/hero region not found');
html = html.slice(0, topStart) + newTopHTML + html.slice(topEnd);

/* 2) move the facer split to sit right after the capabilities ticker, above the wedge */
html = html.replace('  <!-- Wedge -->', facerHTML + '  <!-- Wedge -->');
if (html.indexOf('hero-facer-sec') < 0) throw new Error('facer re-insertion failed');

/* 3) give the command-center section an anchor for the topbar "Features" link */
html = html.replace('  <!-- Command center -->\n  <section class="section">',
  '  <!-- Command center -->\n  <section class="section" id="command">');
if (html.indexOf('id="command"') < 0) throw new Error('command anchor failed');

/* 4) replace the base Owner DNA split with the brochure personas section */
const dnaStart = html.indexOf('  <!-- Owner DNA -->');
const dnaEnd = html.indexOf('  <!-- Alex -->');
if (dnaStart < 0 || dnaEnd < 0 || dnaEnd < dnaStart) throw new Error('owner DNA region not found');
html = html.slice(0, dnaStart) + personasHTML + html.slice(dnaEnd);
if (/Read your rivals|GM PROFILE · SEAT 04/.test(html)) throw new Error('base Owner DNA section still present');

/* 5) insert the draft room after Alex, before the creed */
html = html.replace('  <!-- Creed -->', draftHTML + '  <!-- Creed -->');
if (html.indexOf('id="draft"') < 0) throw new Error('draft insertion failed');

/* 6) insert universe after wedge (before the personas section) */
html = html.replace('  <!-- Owner DNA · brochure personas', universeHTML + '  <!-- Owner DNA · brochure personas');
/* 7) insert engine before pricing */
html = html.replace('  <!-- Pricing -->', engineHTML + '  <!-- Pricing -->');
if (html.indexOf('id="universe"') < 0 || html.indexOf('id="engine"') < 0) throw new Error('section insertion failed');

/* ---------- CSS: nav offset tweak + inject the ported addedCSS into the head style ---------- */
if (html.indexOf('.nav{position:sticky;top:0;') < 0) throw new Error('nav base rule not found for offset tweak');
html = html.replace('.nav{position:sticky;top:0;', '.nav{position:sticky;top:30px;');
// inject addedCSS right before the head style closes (the only "</style>\n</head>")
if (html.indexOf('  </style>\n</head>') < 0) throw new Error('head style close not found');
html = html.replace('  </style>\n</head>', addedCSS + '\n  </style>\n</head>');

/* ---------- head: enable motion only when JS on AND the user allows it ---------- */
const animScript = `  <script>/* enable motion only when JS on AND user allows it (no-JS => content visible, no flash) */
try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.classList.add('anim');}}catch(e){}</script>
</head>`;
html = html.replace('\n</head>', '\n' + animScript);

/* ---------- self-hosted vendor libs + engine + motion, appended before </body> ---------- */
const scriptsBlock = `
  <!-- Motion engine: self-hosted GSAP + ScrollTrigger + Lenis (CSP 'self') -->
  <script src="js/vendor/gsap.min.js"></script>
  <script src="js/vendor/ScrollTrigger.min.js"></script>
  <script src="js/vendor/lenis.min.js"></script>
  <!-- Value simulator engine (ported from brochure) -->
  <script>
${engineJS}
  </script>
  <!-- Scroll-reveal motion init (gated on html.anim / prefers-reduced-motion) -->
  <script>
${motionJS}
  </script>
`;
if ((html.match(/<\/body>/g) || []).length !== 1) throw new Error('expected exactly one </body>');
html = html.replace('</body>', scriptsBlock + '</body>');

fs.writeFileSync(LANDING, html);
console.log('WROTE', LANDING, (html.length / 1024).toFixed(1) + ' KB');

/* ---------- sanity checks (production-specific) ---------- */
const must = [
  'http-equiv="Content-Security-Policy"',
  'supabase-js@2.101.1',
  'function handleEmailAuth', 'function handleGoogle', 'function toggleAuthMode',
  'id="universe"', 'id="engine"', 'id="command"', 'id="psych"', 'id="draft"', 'board-rows',
  'class="topbar"', 'hero-facer', 'facer-copy',
  'League-specific dynasty intelligence', 'Most tools stop at player rankings',
  'Generic Advice Stops Here!', 'term__veil',
  'DYNASTY HQ // OWNER DNA', 'DYNASTY HQ // DRAFT COMMAND', 'knowing the room.',
  'Derek Vaughn', 'Tony Marchetti', 'Sam Okafor', 'Jess Whitfield', 'Ryan Kowalski',
  "You're playing the personas.",
  '<div class="bigval">7,941</div>',
  "url('img/dhq-brandwash.jpg')",
  'js/vendor/gsap.min.js', 'js/vendor/ScrollTrigger.min.js', 'js/vendor/lenis.min.js',
  'src="icon-192.png"', 'src="img/dhq-crest.jpg"',
];
must.forEach(m => { if (html.indexOf(m) < 0) throw new Error('missing in output: ' + m); });

const mustNot = [
  'BLEND MODEL', 'model-banner', 'window.supabase = {', 'modelDisabled',
  'TE PREMIUM · 12-TEAM SF', '<div class="bigval">7,040</div>',
  'Marcus Vale', 'Read your rivals', 'GM PROFILE · SEAT 04',
];
mustNot.forEach(m => { if (html.indexOf(m) >= 0) throw new Error('stale/forbidden content in output: ' + m); });

const openS = (html.match(/<script/g) || []).length;
const closeS = (html.match(/<\/script>/g) || []).length;
console.log('script tags', openS, closeS);
if (openS !== closeS) throw new Error('unbalanced script tags');
console.log('OK');
